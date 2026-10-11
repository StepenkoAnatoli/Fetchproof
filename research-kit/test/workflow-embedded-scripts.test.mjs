// The JavaScript embedded in workflow YAML must actually be JavaScript.
//
// WHY THIS FILE EXISTS, precisely.
//
// The first live collection died on this line:
//
//   console.log(`::warning::client_ref "${value}" is PUBLIC: it is this run's name ...`)
//
// Every `node -e '...'` block in a workflow is a SINGLE-QUOTED SHELL STRING. A single
// quote inside it ends the string, so the apostrophe in "run's" handed node a truncated
// program and the step failed with `Unterminated template`. It cost no credits only
// because it happened to sit before the credential check.
//
// The existing workflow tests could not have caught it. They assert properties of the
// YAML as TEXT - that a string is present, that an input is not interpolated - and this
// defect is invisible at that level: the text was exactly what was intended. The bug is
// in what the shell does to the text before node sees it.
//
// So this file does the one thing text assertions cannot: it extracts each embedded
// script the way the shell would deliver it, and parses it. A syntax error here is a step
// that will fail on a runner, found offline instead of after an approval.

import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { test, describe, assert, fs, path, KIT_ROOT, requireCapability } from './harness.mjs';

describe('workflow-embedded-scripts');

const WORKFLOWS = path.join(path.resolve(KIT_ROOT, '..'), '.github', 'workflows');

/**
 * Every `node -e '<script>'` block, as the shell would hand it over.
 *
 * The opening line ends with `node -e '` and the block ends at a line whose only
 * non-whitespace character is the closing quote. Deliberately simple: a parser clever
 * enough to handle the escaped-quote dance would be able to parse the very thing this
 * test exists to forbid.
 */
export function embeddedScripts(text, file) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/node\s+-e\s+'\s*$/.test(lines[i])) continue;
    const start = i + 1;
    let end = -1;
    for (let j = start; j < lines.length; j += 1) {
      if (lines[j].trim() === "'" || /^\s*'\s*\S/.test(lines[j])) { end = j; break; }
    }
    assert.ok(end !== -1, `${file}:${i + 1} opens an embedded script that is never closed`);
    out.push({ file, line: start + 1, body: lines.slice(start, end).join('\n') });
    i = end;
  }
  return out;
}

const all = fs.readdirSync(WORKFLOWS)
  .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
  .flatMap((n) => embeddedScripts(fs.readFileSync(path.join(WORKFLOWS, n), 'utf8'), n));

test('there are embedded scripts to check, so this file is not vacuously green', () => {
  assert.ok(all.length >= 5, `expected several embedded scripts across the workflows, found ${all.length}`);
});

test('no embedded script contains an apostrophe, which would end its shell string', () => {
  // The rule in its simplest form, and the one that actually failed. It covers comments
  // too: a possessive in a comment breaks the script exactly as one in a string does,
  // and that is the version a reviewer is least likely to notice.
  const offenders = all
    .flatMap((script) => script.body.split('\n').map((text, offset) => ({
      file: script.file,
      // The script's first line, plus how far into it this line sits. Spelled out because
      // the first attempt collapsed both into one `line` field and printed `:NaN` - a
      // guard that cannot say WHERE is half a guard, and nobody trusts the other half.
      at: script.line + offset,
      text,
    })))
    .filter(({ text }) => text.includes("'"))
    .map(({ file, at, text }) => `${file}:${at}  ${text.trim()}`);

  assert.deepEqual(offenders, [],
    'an apostrophe inside `node -e \'...\'` ends the shell string early and hands node a '
    + 'truncated program. Rewrite the wording; do not try to escape it:\n  ' + offenders.join('\n  '));
});

test('every embedded script parses as JavaScript', () => {
  // The stronger check, and the one that survives a future quoting style this test does
  // not anticipate. `new vm.Script` compiles without running: no side effects, no network,
  // nothing from the workflow executes here.
  const broken = [];
  for (const script of all) {
    try {
      new vm.Script(script.body, { filename: `${script.file}:${script.line}` });
    } catch (err) {
      broken.push(`${script.file}:${script.line}  ${err.message}`);
    }
  }
  assert.deepEqual(broken, [],
    'an embedded script does not compile, so the step will fail on a runner:\n  ' + broken.join('\n  '));
});

test('the regression that produced this file is pinned', () => {
  // The exact shape, asserted directly rather than only through the general rule above,
  // so that weakening the general rule cannot silently un-fix this.
  const collect = fs.readFileSync(path.join(WORKFLOWS, 'collect.yml'), 'utf8');
  const warning = collect.split('\n').find((l) => l.includes('::warning::client_ref'));
  assert.ok(warning, 'the client_ref warning is gone; it was the point of the change that introduced this bug');
  assert.ok(!warning.includes("'"),
    `the client_ref warning carries an apostrophe again, which is what broke the first live run: ${warning.trim()}`);
});

test('the extractor finds a deliberately broken script, so the check is not asleep', () => {
  // A test whose subject is another test. `embeddedScripts` returning nothing would make
  // every assertion above pass for the worst possible reason, and that failure is silent.
  const fixture = [
    '      - name: made up',
    "        run: |",
    "          node -e '",
    '            const x = "unterminated',
    "          '",
  ].join('\n');
  const found = embeddedScripts(fixture, 'fixture.yml');
  assert.equal(found.length, 1, 'the extractor did not find an obvious embedded script');
  assert.throws(() => new vm.Script(found[0].body), 'a broken script compiled cleanly, so the parse check proves nothing');
});

test('no workflow uses the GitHub Actions falsy-ternary footgun', () => {
  // `${{ cond && '' || value }}` does NOT mean "empty when cond". In GitHub Actions the
  // empty string is falsy, so the true-branch collapses and the expression yields the
  // THIRD operand. collect.yml used it to blank an 'auto' input and instead passed the
  // literal string "auto" into RESEARCH_KIT_SEARCH_TRANSPORT, so every DEFAULT dispatch
  // died with `unknown search provider "auto"`.
  //
  // It survived review because the comparison runs that exercised the feature all pinned
  // an explicit provider. The default path - the one almost every real dispatch takes -
  // was never run until a research collection tried it.
  // COMMENT LINES ARE SKIPPED, and finding that out is why this comment exists: the first
  // version of this guard flagged the sentence above, which describes the footgun in order
  // to warn about it. A check that cannot tell a value from prose about the value reports
  // the documentation as the defect.
  const dir = path.join(KIT_ROOT, '..', '.github', 'workflows');
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.trim().startsWith('#')) return;
      for (const m of line.matchAll(/\$\{\{[^}]*&&\s*''\s*\|\|[^}]*\}\}/g)) {
        offenders.push(`${file}:${i + 1}: ${m[0].trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    'a ternary whose true-branch is the empty string yields its third operand instead');
});

// ---------------------------------------------------------------- the shell around them
//
// Added 2026-09-28 (Arena break test 13, residual risk). The `node -e` scripts above are
// parsed; the bash each `run:` block IS was not, so a shell typo - an unclosed `if`, a
// stray quote - failed only when a runner reached that step, which on the collector is
// after the approval and possibly after the credits. Every run block in this repository
// runs under bash (Git Bash on Windows, offline-suite.yml says why), so `bash -n` parses
// each one offline. `${{ ... }}` is GitHub's, substituted before bash sees the text, so
// it is replaced by a plain word first.

/** Every `run:` block, dedented, as bash will receive it once GitHub has substituted it. */
export function runBlocks(text, file) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m || lines[i].trim().startsWith('#')) continue;
    const keyIndent = m[1].length + (lines[i].trim().startsWith('-') ? 2 : 0);
    const at = i + 1;   // the `run:` line itself, before i moves past the block
    let body;
    if (/^[|>][-+]?\s*$/.test(m[2])) {
      const block = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const line = lines[j];
        if (line.trim() !== '' && line.length - line.trimStart().length <= keyIndent) break;
        block.push(line);
      }
      const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
      body = block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
      i = j - 1;
    } else {
      body = m[2];
    }
    out.push({ file, line: at, body: body.replace(/\$\{\{[\s\S]*?\}\}/g, 'GH_EXPR') });
  }
  return out;
}

const BASH = ['bash', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']
  .find((candidate) => spawnSync(candidate, ['-c', 'echo ok'], {
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  }).stdout?.trim() === 'ok') ?? null;

function bashSyntax(body) {
  const r = spawnSync(BASH, ['-n'], { input: body, encoding: 'utf8', timeout: 20_000, windowsHide: true });
  return r.status === 0 ? null : (r.stderr || `bash -n exited ${r.status}`).trim();
}

const runs = fs.readdirSync(WORKFLOWS)
  .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
  .flatMap((n) => runBlocks(fs.readFileSync(path.join(WORKFLOWS, n), 'utf8'), n));

test('every run block in every workflow is valid bash', () => {
  // A real installed Git Bash must not be reported as unavailable just because its
  // executable is absent from PATH. Exercise the workflows with it below.
  const installed = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']
    .find((candidate) => spawnSync(candidate, ['-c', 'echo ok'], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
    }).stdout?.trim() === 'ok');
  if (installed) assert.ok(BASH, 'working installed Git Bash was lost by interpreter detection');
  requireCapability(BASH, 'BASH-NOT-FOUND', 'no bash on this host to parse the workflow run blocks with');
  assert.ok(runs.length >= 40, `expected the workflows' run blocks, found ${runs.length}`);
  const broken = runs.map((r) => ({ ...r, error: bashSyntax(r.body) })).filter((r) => r.error)
    .map((r) => `${r.file}:${r.line}  ${r.error.split('\n')[0]}`);
  assert.deepEqual(broken, [], 'these run blocks will fail on the runner before doing anything:\n  ' + broken.join('\n  '));
});

test('the run-block check catches a real shell syntax error, so it is not vacuously green', () => {
  requireCapability(BASH, 'BASH-NOT-FOUND', 'no bash on this host to parse the workflow run blocks with');
  const yaml = [
    'jobs:', '  x:', '    steps:',
    '      - name: fine', '        run: |', '          echo "${{ inputs.value }}"', '          if [ -n "$A" ]; then echo a; fi',
    '      - name: broken', '        run: |', '          if [ -n "$A" ]; then', '            echo never closed',
  ].join('\n');
  const blocks = runBlocks(yaml, 'probe.yml');
  assert.equal(blocks.length, 2);
  assert.equal(bashSyntax(blocks[0].body), null, `a valid block was refused: ${bashSyntax(blocks[0].body)}`);
  assert.notEqual(bashSyntax(blocks[1].body), null, 'an unclosed if was accepted');
});
