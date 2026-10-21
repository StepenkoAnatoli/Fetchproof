// The brief's shape has one owner (ADR-0014): the renderer writes its headings FROM the
// definition, and the audit reads the judged sections THROUGH it.

import { test, describe, assert, makePassingProject, corrupt, fs, path } from './harness.mjs';
import { PATHS, resolve, readText, writeText } from '../lib/core.mjs';
import { runPreflight } from '../lib/preflight.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import {
  draftStamp,
  BRIEF_SECTIONS, JUDGED_SECTIONS, BRIEF_FILE_MARKER, TODO_MARK,
  briefState, briefSection, judgedSection, renderBrief,
} from '../lib/brief.mjs';

describe('brief');

test('failed verification qualifies CLOSED claims even when their citation or capture is missing', () => {
  for (const missing of ['citation', 'capture']) {
    const dir = makePassingProject();
    if (missing === 'citation') {
      corrupt(dir, PATHS.discovery, (text) => text.replace('E-01:', 'E-99:'));
    } else {
      fs.rmSync(resolve(dir, readCorpus(dir).evidence[0].raw));
    }
    const verdict = runPreflight(dir, { env: {} });
    assert.equal(verdict.pass, false, `${missing} must fail the real gate`);
    renderBrief(dir, { verdict });
    const section = briefSection(readText(resolve(dir, PATHS.brief)), 'verified');
    assert.match(section, /declared CLOSED claims/i, 'the section must identify declarations rather than successful verification');
    assert.match(section, /verification has not succeeded/i);
    assert.match(section, missing === 'citation' ? /E-99/ : /1,000 credits/, 'retain the claimed closure for review');
  }
});

test('an unevaluated brief does not present declared closures as successful verification', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  const section = briefSection(readText(resolve(dir, PATHS.brief)), 'verified');
  assert.match(section, /declared CLOSED claims/i);
  assert.match(section, /verification has not been evaluated/i);
  assert.match(section, /10 requests per minute/, 'the draft still contains the claim to review');
});

// A structural PASS can retain a disclosed gap; the handoff must not turn it into closure.
test('a passing brief retains a known unknown without claiming every unknown is closed', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => `${text.trimEnd()}\n| U-2 | What is the private account quota? | Sets the production budget | KNOWN-UNKNOWN | E-01 does not establish the private quota. Day one: log in and inspect the account quota. |\n`);
  const verdict = runPreflight(dir, { env: {} });
  assert.equal(verdict.pass, true);
  renderBrief(dir, { verdict });
  const brief = readText(resolve(dir, PATHS.brief));
  assert.match(brief, /Gate: PASS/);
  assert.match(brief, /U-2/);
  assert.match(brief, /log in and inspect the account quota/);
  assert.doesNotMatch(brief, /Every blocking unknown is closed/);
});

test('a passing brief preserves the reason for its nonblocking gate warning', () => {
  const dir = makePassingProject();
  const verdict = runPreflight(dir, { env: {} });
  assert.equal(verdict.pass, true);
  const warning = verdict.warnings.find((f) => f.check === 'corroboration' && f.rule === 'single-source');
  assert.ok(warning, 'the real fixture has a single-source warning');
  renderBrief(dir, { verdict });
  const brief = readText(resolve(dir, PATHS.brief));
  assert.match(brief, /Gate: PASS/);
  assert.match(brief, /corroboration\/single-source/);
  assert.ok(brief.includes(warning.detail), 'the builder receives the complete warning');
  assert.doesNotMatch(brief, /Two independent sources agree unless noted here/);
});

test('an incomplete contract is not described as fully closed in the known-unknown section', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED |', '| OPEN |'));
  const verdict = runPreflight(dir, { env: {} });
  assert.equal(verdict.pass, false);
  renderBrief(dir, { verdict });
  const brief = readText(resolve(dir, PATHS.brief));
  assert.match(brief, /Gate: FAIL/);
  assert.doesNotMatch(briefSection(brief, 'unknowns'), /Every blocking unknown was closed/);
});

test('a warning-free evaluation does not acquire a single-source caution in the brief', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('E-01: 10 requests per minute, 1,000 credits',
    'E-01: 10 requests per minute, 1,000 credits [single-witness: only the vendor defines its own quota; this fixture uses the official limit]'));
  const verdict = runPreflight(dir, { env: {} });
  assert.equal(verdict.pass, true);
  assert.equal(verdict.warnings.length, 0);
  renderBrief(dir, { verdict });
  const brief = readText(resolve(dir, PATHS.brief));
  assert.match(brief, /Gate: PASS/);
  assert.match(brief, /Gate warnings[^\n]*0/);
  assert.doesNotMatch(brief, /corroboration\/single-source/);
});

test('six sections, two of them judged', () => {
  assert.equal(BRIEF_SECTIONS.length, 6);
  assert.deepEqual(JUDGED_SECTIONS, ['contradictions', 'decision']);
});

test('a brief distinguishes unavailable warning observations from an evaluated zero', () => {
  for (const verdict of [null, { pass: true }]) {
    const dir = makePassingProject();
    renderBrief(dir, { verdict });
    const brief = readText(resolve(dir, PATHS.brief));
    assert.match(brief, /Gate warnings: not (evaluated|supplied)/);
    assert.doesNotMatch(brief, /Gate warnings[^\n]*\b0\b/);
  }
});

test('every warning reaches the brief when a passing evaluation has several', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => text.replace(/\| P \|/, '| S |'));
  const verdict = runPreflight(dir, { env: {} });
  assert.equal(verdict.pass, true);
  assert.ok(verdict.warnings.length >= 2);
  renderBrief(dir, { verdict });
  const brief = readText(resolve(dir, PATHS.brief));
  for (const warning of verdict.warnings) {
    assert.ok(brief.includes(warning.detail), `${warning.check}/${warning.rule} was dropped`);
    if (warning.fix) assert.ok(brief.includes(warning.fix), 'the suggested remedy was dropped');
  }
});

test('the scaffold ships the marker, and the marker is what says "still the scaffold"', () => {
  const dir = makePassingProject();
  const text = readText(resolve(dir, PATHS.brief));
  assert.ok(text.includes(BRIEF_FILE_MARKER));
  assert.equal(briefState(text), 'template');
});

test('the marker survives the substitution pass, so no sentence of English is load-bearing', () => {
  const dir = makePassingProject();
  assert.match(readText(resolve(dir, PATHS.brief)), /fetchproof:brief=scaffold/);
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

test('every row an unknown cites reaches the verified table, not only the first', () => {
  // Found 2026-09-29 on MoonAliza's Ollama /v1 corpus: U-01 cited E-03 and E-06, U-03 cited
  // E-03, E-04 and E-02, and the brief showed E-03 alone - the row saying how Ollama numbers
  // parallel calls, which the closure rested on, never reached the builder.
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-01 \|.*\| )([^|]*) \|$/m,
    (line, head, raw) => `${line}\n| E-02 | 2026-09-29 | P | https://example.invalid/limits | The limit is counted per API key, not per account. | ${raw} |`));
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED | E-01: 10 requests per minute, 1,000 credits |',
    '| CLOSED | E-01: 10 requests per minute, 1,000 credits; E-02: counted per key |'));
  renderBrief(dir, { force: true });
  const verified = briefSection(readText(resolve(dir, PATHS.brief)), 'verified');
  assert.match(verified, /10 requests per minute/);
  const second = verified.split('\n').filter((line) => /\| E-02/.test(line));
  assert.equal(second.length, 1, verified);
  assert.match(second[0], /counted per API key/);
  assert.match(second[0], /\(U-1\)/);
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
  assert.match(unknowns, /Day-one verification: log in and read the billing page/, 'the step, labelled once');
});

// Found 2026-09-27 reviewing a package the collector returned: from the project folder, the
// brief's "Run node fetchproof/bin/preflight.mjs" and "node bin/brief.mjs" named files that
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
  const drafted = readText(resolve(dir, PATHS.brief));
  const answered = drafted.replace(briefSection(drafted, 'contradictions'), 'We trust the vendor page over the blog.');
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

test('a passing brief retains full reasons and targets from the whole warning evaluation', () => {
  const dir = makePassingProject();
  renderBrief(dir, {
    verdict: {
      pass: true,
      counts: { fail: 0, warn: 5 },
      warnings: [
        { severity: 'warn', check: 'unknown-closure', rule: 'single-witness-stale', unknown: 'U-1', detail: 'The single witness is older than policy.', fix: 'Refresh its capture.' },
        { severity: 'warn', check: 'citations', rule: 'raw-thin', row: 'E-1', detail: 'The capture contains too little page text.' },
        { severity: 'warn', check: 'hygiene', rule: 'brief-stale', detail: 'The brief predates the current inputs.' },
        { severity: 'warn', check: 'hygiene', rule: 'brief-unstamped', detail: 'The brief currency cannot be checked.' },
        { severity: 'warn', check: 'gate-integrity', rule: 'local-hooks-path', detail: 'The repository hooks path displaces the machine gate.' },
      ],
    },
  });
  const text = readText(resolve(dir, PATHS.brief));
  assert.match(text, /Gate: PASS\./);
  const warnings = text.slice(text.indexOf('Gate warnings from'), text.indexOf('## Intent'));
  assert.match(warnings, /evaluation: 5/);
  assert.match(warnings, /unknown-closure\/single-witness-stale[^\n]*U-1/);
  assert.match(warnings, /citations\/raw-thin[^\n]*E-1/);
  assert.match(warnings, /brief-stale/);
  assert.match(warnings, /brief-unstamped/);
  assert.match(warnings, /local-hooks-path/);
  assert.match(warnings, /The single witness is older than policy/);
  assert.match(warnings, /Refresh its capture/);
  assert.equal(briefState(text), 'draft', 'presenting warnings does not finish the review');
});

test('a passing brief labels brief and machine warnings as retained observations without changing its review state', () => {
  const dir = makePassingProject();
  renderBrief(dir, {
    verdict: {
      pass: true,
      counts: { fail: 0, warn: 3 },
      warnings: [
        { severity: 'warn', check: 'hygiene', rule: 'brief-stale', detail: 'The brief predates the current inputs.' },
        { severity: 'warn', check: 'hygiene', rule: 'brief-unstamped', detail: 'The brief currency cannot be checked.' },
        { severity: 'warn', check: 'gate-integrity', rule: 'local-hooks-path', detail: 'The repository hooks path displaces the machine gate.' },
      ],
    },
  });
  const text = readText(resolve(dir, PATHS.brief));
  assert.match(text, /\*\*Gate: PASS\.\*\*/);
  assert.match(text, /whole corpus at the time of this evaluation/);
  assert.match(text, /Re-run\npreflight after edits/);
  assert.match(text, /brief-stale/);
  assert.match(text, /brief-unstamped/);
  assert.match(text, /local-hooks-path/);
  assert.equal(briefState(text), 'draft', 'warning visibility does not approve the handoff');
});

// The stamp was anchored to the end of the file until 2026-10-03, so a line appended after
// it - the `Reviewed by: agent` line AGENTS.md asks for - made `draftStamp` return null: the
// draft read as unstamped, and the edit went unseen (review of the G1 fix).
test('a stamp is found wherever it stands, and a line appended after it is an edit', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  const text = readText(resolve(dir, PATHS.brief));
  const stamp = draftStamp(text);
  assert.ok(stamp && stamp.edited === false, 'the freshly rendered draft is unedited');
  const appended = draftStamp(`${text}\nReviewed by: agent\n`);
  assert.ok(appended, 'a line after the stamp hid the stamp');
  assert.equal(appended.inputs, stamp.inputs);
  assert.equal(appended.edited, true, 'text after the stamp is an edit');
  assert.equal(draftStamp(`${text}\n\n   \n`)?.edited, false, 'trailing blank lines are not an edit');
  writeText(resolve(dir, PATHS.brief), `${text}\nReviewed by: agent\n`);
  assert.equal(renderBrief(dir).written, false, 'a draft with a line appended after the stamp was redrafted without --force');
});

test('a draft with any edit still refuses without --force', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  const text = readText(resolve(dir, PATHS.brief));
  writeText(resolve(dir, PATHS.brief), text.replace('## Intent\n\n', '## Intent\n\nA sentence somebody added.\n\n'));
  assert.equal(renderBrief(dir).written, false, 'an edit outside the TODO sections was overwritten');
});

// Found 2026-09-27: an Evidence cell written as "Day one: measure lag under load" was
// rendered "Day-one verification: Day one: measure lag under load".
test('a known unknown\'s day-one step is not labelled twice', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(/^(\| U-1 \|.*)$/m,
    '$1\n| U-2 | What is the lag budget? | Sizes the standby | KNOWN-UNKNOWN | Day one: measure lag under load |'));
  renderBrief(dir, { force: true });
  const text = readText(resolve(dir, PATHS.brief));
  assert.match(text, /Day-one verification: measure lag under load/);
  assert.doesNotMatch(text, /Day-one verification: Day one/i);
});

// Found 2026-09-29 using the kit on MoonAliza: a cell that says what IS known and then labels
// its step mid-sentence ("E-05 says X. Day-one verification: do Y") was rendered with the
// label twice - "Day-one verification: E-05 says X. Day-one verification: do Y".
test('a day-one label inside the cell splits what is known from the step, and appears once', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(/^(\| U-1 \|.*)$/m,
    '$1\n| U-2 | How is it chunked? | Picks the parser | KNOWN-UNKNOWN | E-05 says streaming is supported but shows no chunk. Day-one verification: log every delta against a local server. |'));
  renderBrief(dir, { force: true });
  const text = readText(resolve(dir, PATHS.brief));
  assert.equal((text.match(/Day-one verification:/g) ?? []).length, 1, text.slice(text.indexOf('## Known unknowns'), text.indexOf('## Decision')));
  assert.match(text, /Day-one verification: log every delta against a local server\./);
  assert.match(text, /Known so far: E-05 says streaming is supported but shows no chunk\./);
});

test('a "Known so far" label the author wrote in the cell appears once', () => {
  // Found 2026-09-29 on MoonAliza's context-overflow corpus: the author wrote the cell the way
  // the brief itself prints it, and the brief printed "Known so far: Known so far: ...".
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(/^(\| U-1 \|.*)$/m,
    '$1\n| U-2 | Is output reserved? | Sets the budget | KNOWN-UNKNOWN | Known so far: the docs say nothing. Day-one verification: send one oversized request. |'));
  renderBrief(dir, { force: true });
  const text = readText(resolve(dir, PATHS.brief));
  assert.equal((text.match(/Known so far:/g) ?? []).length, 1, text.slice(text.indexOf('## Known unknowns'), text.indexOf('## Decision')));
  assert.match(text, /Known so far: the docs say nothing\./);
});

// Found 2026-09-28 running the kit from a repository checkout on MoonAliza: the project was
// scaffolded with --kit '$HOME/.agents/fetchproof' so it could travel, and every scaffolded
// file said so - but the drafted brief named this machine's checkout path, which exists
// nowhere else. The files written later must spell the kit the way the scaffold did.
test('the brief and the timeline spell the kit the way the project was scaffolded', async () => {
  const { renderTimeline } = await import('../lib/timeline.mjs');
  const { KIT_ROOT } = await import('../lib/scaffold.mjs');
  const dir = makePassingProject();
  const kit = JSON.parse(readText(resolve(dir, PATHS.kit)));
  kit.kitPath = 'D:/Tools/Fetchproof kit';
  writeText(resolve(dir, PATHS.kit), `${JSON.stringify(kit, null, 2)}\n`);

  renderBrief(dir, { force: true });
  const brief = readText(resolve(dir, PATHS.brief));
  assert.ok(brief.includes('node "D:/Tools/Fetchproof kit/bin/brief.mjs"'), brief.split('\n').filter((l) => l.includes('brief.mjs')).join('\n'));
  renderTimeline(dir);
  const timeline = readText(resolve(dir, PATHS.timeline));
  assert.ok(timeline.includes('node "D:/Tools/Fetchproof kit/bin/timeline.mjs"'), timeline.slice(0, 400));
  for (const [name, text] of [['brief', brief], ['timeline', timeline]]) {
    assert.ok(!text.includes(KIT_ROOT), `${name} names this machine's kit path`);
  }
});

test('a new project records the spelling it was scaffolded with', async () => {
  const { scaffoldProject } = await import('../lib/scaffold.mjs');
  const { tempDir } = await import('./harness.mjs');
  for (const [kit, expected] of [[undefined, '$HOME/.agents/fetchproof'], ['C:\\Users\\Jo "Q"\\kit', 'C:\\Users\\Jo "Q"\\kit']]) {
    const dir = tempDir();
    scaffoldProject(dir, { topic: 't', ...(kit ? { kit } : {}) });
    assert.equal(JSON.parse(readText(resolve(dir, PATHS.kit))).kitPath, expected);
  }
});

// Found 2026-09-29 regenerating the root research/TIMELINE.md: a migration entry has no url
// and no capture, and the row read "undefined -> undefined" - the one line that should say
// why the chain was rewritten said nothing. A prior has a file but no url.
test('the timeline says what a migration and a prior were, not "undefined -> undefined"', async () => {
  const { buildTimeline } = await import('../lib/timeline.mjs');
  const corpus = { evidence: [], overrides: [], ledger: { entries: [
    { at: '2026-09-13T18:28:29Z', op: 'migration', reason: 'retro-record: seqs 1-5 were rebuilt to backfill transport' },
    { at: '2026-09-17T11:44:16Z', op: 'migration', url: '', raw: '', note: 'adopt the kit canonical entry hash' },
    { at: '2026-09-20T09:00:00Z', op: 'prior', url: '', raw: 'research/PRIOR.md' },
    { at: '2026-09-21T09:00:00Z', op: 'scrape', url: 'https://x.invalid/a', raw: 'research/raw/a.md', transport: 'browser' },
  ] } };
  const details = buildTimeline('/nowhere', { corpus }).map((e) => e.detail);
  assert.equal(details[0], 'retro-record: seqs 1-5 were rebuilt to backfill transport');
  assert.equal(details[1], 'adopt the kit canonical entry hash');
  assert.equal(details[2], 'research/PRIOR.md');
  assert.equal(details[3], 'https://x.invalid/a -> research/raw/a.md (browser)');
  for (const d of details) assert.doesNotMatch(d, /undefined|^ -> $/);
});
