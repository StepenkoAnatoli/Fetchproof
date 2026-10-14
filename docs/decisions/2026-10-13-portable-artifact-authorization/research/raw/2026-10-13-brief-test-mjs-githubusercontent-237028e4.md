---
url: https://raw.githubusercontent.com/StepenkoAnatoli/Research-Kit/3bac1f26ddbf8cb6a794626e53dc2af313860940/research-kit/test/brief.test.mjs
retrieved: 2026-10-13
command: http-keyless scrape https://raw.githubusercontent.com/StepenkoAnatoli/Research-Kit/3bac1f26ddbf8cb6a794626e53dc2af313860940/research-kit/test/brief.test.mjs
statusCode: 200
transport: http-keyless
completeness: full
---
// The brief's shape has one owner (ADR-0014): the renderer writes its headings FROM the
// definition, and the audit reads the judged sections THROUGH it.

import { test, describe, assert, makePassingProject, corrupt, fs, path } from './harness.mjs';
import { PATHS, resolve, readText, writeText } from '../lib/core.mjs';
import {
  BRIEF_SECTIONS, JUDGED_SECTIONS, BRIEF_FILE_MARKER, TODO_MARK,
  briefState, briefSection, judgedSection, renderBrief,
} from '../lib/brief.mjs';

describe('brief');

test('six sections, two of them judged', () => {
  assert.equal(BRIEF_SECTIONS.length, 6);
  assert.deepEqual(JUDGED_SECTIONS, ['contradictions', 'decision']);
});

test('the scaffold ships the marker, and the marker is what says "still the scaffold"', () => {
  const dir = makePassingProject();
  const text = readText(resolve(dir, PATHS.brief));
  assert.ok(text.includes(BRIEF_FILE_MARKER));
  assert.equal(briefState(text), 'template');
});

test('the marker survives the substitution pass, so no sentence of English is load-bearing', () => {
  const dir = makePassingProject();
  assert.match(readText(resolve(dir, PATHS.brief)), /research-kit:brief=scaffold/);
});

test('a drafted brief with TODOs reads as draft; one with them answered reads as authored', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  const drafted = readText(resolve(dir, PATHS.brief));
  assert.equal(briefState(drafted), 'draft');

  const answered = drafted
    .split(TODO_MARK).join('Resolved:')
    .replace(/Resolved: - what to build first/, 'Build the collector first;');
  writeText(resolve(dir, PATHS.brief), answered);
  assert.equal(briefState(readText(resolve(dir, PATHS.brief))), 'authored');
});

test('a LEGACY brief - the shape without the marker - refuses loudly rather than guessing', () => {
  const dir = makePassingProject();
  writeText(resolve(dir, PATHS.brief), '# Brief - something\n\n## Intent\n\nSomebody wrote this by hand.\n\n## Decision\n\nBuild it.\n');
  assert.equal(briefState(readText(resolve(dir, PATHS.brief))), 'legacy');

  const refused = renderBrief(dir);
  assert.equal(refused.written, false);
  assert.match(refused.reason, /LEGACY/);
  assert.match(readText(resolve(dir, PATHS.brief)), /by hand/, 'the file is untouched');

  assert.equal(renderBrief(dir, { force: true }).written, true, '--force is the deliberate act');
});

test('drafting over a draft refuses without --force, so judgements are preserved', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  writeText(resolve(dir, PATHS.brief), readText(resolve(dir, PATHS.brief)).replace(TODO_MARK, 'My own judgement:'));

  const refused = renderBrief(dir);
  assert.equal(refused.written, false);
  assert.match(readText(resolve(dir, PATHS.brief)), /My own judgement/);
});

test('the renderer writes its headings FROM the section definition', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  const text = readText(resolve(dir, PATHS.brief));
  for (const section of BRIEF_SECTIONS) {
    assert.match(text, new RegExp(`^## ${section.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `missing heading: ${section.heading}`);
  }
});

test('the verified table carries the claim, the source and its type', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  const verified = briefSection(readText(resolve(dir, PATHS.brief)), 'verified');
  assert.match(verified, /10 requests per minute/);
  assert.match(verified, /E-01/);
  assert.match(verified, /example\.invalid/);
  assert.match(verified, /\| P \|/);
});

test('two unknowns closed by the same row make ONE verified row that names both', () => {
  // Found 2026-09-26 in docs/decisions/2026-09-26-actions-node24: U-2 and U-4 both led with
  // E-02, and the brief listed that row's finding twice, word for word, with nothing saying
  // which unknown either copy closed.
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(
    /^(\| U-1 \|.*\|)$/m,
    '$1\n| U-2 | Is the limit per key? | Sets the budget per machine | CLOSED | E-01: per key |',
  ));
  renderBrief(dir, { force: true });
  const verified = briefSection(readText(resolve(dir, PATHS.brief)), 'verified');
  const rows = verified.split('\n').filter((line) => /\| E-01/.test(line));
  assert.equal(rows.length, 1, `the same source is listed ${rows.length} times:\n${rows.join('\n')}`);
  assert.match(rows[0], /U-1, U-2/, 'the row does not say which unknowns it closes');
});

test('a claim resting on a partial capture says so in the brief', () => {
  const dir = makePassingProject();
  corrupt(dir, `research/raw/${fs.readdirSync(resolve(dir, PATHS.raw)).find((n) => n.endsWith('.md'))}`,
    (text) => text.replace('completeness: full', 'completeness: partial\nomitted: chunk 0 of 3'));
  renderBrief(dir, { force: true });
  assert.match(briefSection(readText(resolve(dir, PATHS.brief)), 'verified'), /partial capture/);
});

test('known unknowns are listed with their day-one steps, or the section says none', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  assert.match(briefSection(readText(resolve(dir, PATHS.brief)), 'unknowns'), /None\./);

  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED |', '| KNOWN-UNKNOWN |').replace(/E-01:[^|]*/, 'day one: log in and read the billing page '));
  renderBrief(dir, { force: true });
  const unknowns = briefSection(readText(resolve(dir, PATHS.brief)), 'unknowns');
  assert.match(unknowns, /U-1/);
  assert.match(unknowns, /Day-one verification: day one: log in/);
});

// Found 2026-09-27 reviewing a package the collector returned: from the project folder, the
// brief's "Run node research-kit/bin/preflight.mjs" and "node bin/brief.mjs" named files that
// exist only at the kit repository's root, so each crashed with MODULE_NOT_FOUND.
test('every command the brief prints runs from the project folder', () => {
  const dir = makePassingProject();
  const commands = [];
  for (const verdict of [{ pass: true }, { pass: false, counts: { fail: 1 } }]) {
    renderBrief(dir, { force: true, verdict });
    for (const [, arg] of readText(resolve(dir, PATHS.brief)).matchAll(/\bnode\s+("[^"]+"|\S+?\.mjs)/g)) commands.push(arg);
  }
  assert.ok(commands.length >= 2, `only ${commands.length} commands found: ${commands.join(', ')}`);
  for (const arg of commands) {
    const file = path.resolve(dir, arg.replace(/^"|"$/g, ''));
    assert.ok(fs.existsSync(file), `the brief says "node ${arg}", and from the project folder that is ${file}, which does not exist`);
  }
});

// Found the same day: a corpus whose one source was typed S drafted "Every blocking unknown was
// closed with primary-source evidence".
test('a closure resting on no primary source is not called primary', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => text.replace(/\| P \|/, '| S |'));
  renderBrief(dir, { force: true });
  const unknowns = briefSection(readText(resolve(dir, PATHS.brief)), 'unknowns');
  assert.doesNotMatch(unknowns, /primary-source evidence/, 'the only source is secondary');
  assert.match(unknowns, /U-1 rests on no primary \(P\) source/);
});

// Found 2026-09-27: --force over an answered brief put the TODOs back and kept nothing of the
// judgements it replaced. Forcing is still allowed; losing the answers is not.
test('drafting over a brief with --force keeps the brief it replaced', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  const answered = readText(resolve(dir, PATHS.brief)).replace(/\*\*TODO\*\* - review the primary sources[\s\S]*?noted here\./, 'We trust the vendor page over the blog.');
  writeText(resolve(dir, PATHS.brief), answered);
  const first = renderBrief(dir, { force: true, date: '2026-09-27' });
  assert.ok(first.backup, 'no backup was reported');
  assert.equal(readText(resolve(dir, first.backup)), answered, 'the backup is not the brief that was replaced');
  const second = renderBrief(dir, { force: true, date: '2026-09-27' });
  assert.notEqual(second.backup, first.backup, 'a second force the same day overwrote the first backup');
  assert.equal(readText(resolve(dir, first.backup)), answered);
  const fresh = makePassingProject();
  assert.equal(renderBrief(fresh, { force: true }).backup, undefined, 'the scaffold is not worth a backup');
});

test('judgedSection is the reader the audit consumes instead of a regex of its own', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  const text = readText(resolve(dir, PATHS.brief));
  assert.equal(judgedSection(text, 'decision').answered, false);
  assert.equal(judgedSection(text, 'intent'), null, 'only the judged sections are judged');

  writeText(resolve(dir, PATHS.brief), text.replace(/## Decision\n\n\*\*TODO\*\*[\s\S]*?\n\n## Next steps/, '## Decision\n\nBuild the collector first.\n\n## Next steps'));
  assert.equal(judgedSection(readText(resolve(dir, PATHS.brief)), 'decision').answered, true);
});

// Found 2026-09-27: a brief drafted while the gate failed said "Gate: FAIL" after the
// project passed, and brief.mjs refused to redraft it without --force - though nobody
// had written a word in it. An untouched draft holds no judgement to protect.
test('an unedited draft is redrafted without --force, and nothing is backed up', () => {
  const dir = makePassingProject();
  renderBrief(dir, { verdict: { pass: false, counts: { fail: 3 } } });
  assert.match(readText(resolve(dir, PATHS.brief)), /Gate: FAIL/);
  const again = renderBrief(dir, { verdict: { pass: true, counts: { fail: 0 } } });
  assert.equal(again.written, true, again.reason);
  assert.equal(again.backup, undefined, 'an untouched draft is not worth a backup');
  assert.match(readText(resolve(dir, PATHS.brief)), /Gate: PASS/);
});

test('a draft with any edit still refuses without --force', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  const text = readText(resolve(dir, PATHS.brief));
  writeText(resolve(dir, PATHS.brief), text.replace('## Intent\n\n', '## Intent\n\nA sentence somebody added.\n\n'));
  assert.equal(renderBrief(dir).written, false, 'an edit outside the TODO sections was overwritten');
});

