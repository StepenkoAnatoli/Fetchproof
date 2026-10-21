// evidence-context answers, and must never decide.
//
// The whole protocol rests on a person judging whether evidence closes an unknown. A
// command that gathers that evidence is a convenience; a command that hints at the
// verdict is a way to launder a machine's guess into the corpus. So the tests here are
// split in two: that it gathers the right things, and that it changes nothing and
// concludes nothing.

import { spawnSync } from 'node:child_process';
import { test, describe, assert, assertEqual, fs, path, os, KIT_ROOT, tempDir, cleanup, makePassingProject, requireSymlink } from './harness.mjs';
import { findingsReviewState } from '../lib/artifact.mjs';
import { resolve, PATHS } from '../lib/core.mjs';
import { runPreflight } from '../lib/preflight.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { evidenceContext, renderContext, excerptFor } from '../lib/evidence-context.mjs';

describe('evidence-context');

test('Raw cells cannot read or print a private project file directly or by traversal', () => {
  const root = fixture();
  const privateFile = path.join(root, '.env');
  const sentinel = 'PRIVATE_SENTINEL_FROM_ENV';
  fs.writeFileSync(privateFile, sentinel);
  const evidenceFile = path.join(root, PATHS.evidence);
  const original = fs.readFileSync(evidenceFile, 'utf8');
  for (const raw of ['.env', 'research/raw/../../.env']) {
    fs.writeFileSync(evidenceFile, original.replace('research/raw/page.md', raw));
    const corpus = readCorpus(root);
    const real = fs.readFileSync;
    let privateReads = 0;
    fs.readFileSync = (file, ...args) => { if (String(file) === privateFile) privateReads++; return real(file, ...args); };
    let context;
    try { context = evidenceContext(corpus, 'U-1'); findingsReviewState(root, corpus); }
    finally { fs.readFileSync = real; }
    assert.equal(privateReads, 0);
    assert.equal(context.cited[0].excerpt, '');
    assert.equal(context.cited[0].extractor, null);
    assert.match(context.cited[0].excerptProblem, /outside research\/raw/);
    for (const args of [[], ['--json']]) {
      const result = spawnSync(process.execPath, [CLI, 'U-1', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(!result.stdout.includes(sentinel));
      if (args.length) JSON.parse(result.stdout);
    }
  }
});

test('a directory Raw cell is named as a directory instead of a missing capture', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, PATHS.raw, 'folder'));
  const corpus = readCorpus(root);
  corpus.evidence[0].raw = `${PATHS.raw}/folder`;
  const row = evidenceContext(corpus, 'U-1').cited[0];
  assert.equal(row.excerpt, '');
  assert.match(row.excerptProblem, /directory.*not a capture/);
  assert.doesNotMatch(row.excerptProblem, /not on disk/);
});

test('a capture link to a private file inside the project is unread by all capture consumers', () => {
  const root = fixture();
  const privateFile = path.join(root, '.env');
  fs.writeFileSync(privateFile, 'PRIVATE_SENTINEL_FROM_LINK');
  const link = path.join(root, PATHS.raw, 'link.md');
  requireSymlink(privateFile, link, 'a capture link to a private project file');
  const real = fs.readFileSync;
  let privateReads = 0;
  fs.readFileSync = (file, ...args) => { if ([link, privateFile].includes(String(file))) privateReads++; return real(file, ...args); };
  try {
    const corpus = readCorpus(root);
    corpus.evidence[0].raw = `${PATHS.raw}/link.md`;
    const context = evidenceContext(corpus, 'U-1');
    findingsReviewState(root, corpus);
    assert.equal(context.cited[0].excerpt, '');
    assert.match(context.cited[0].excerptProblem, /outside research\/raw/);
  } finally { fs.readFileSync = real; }
  assert.equal(privateReads, 0);
});

const REPO = path.resolve(KIT_ROOT, '..');
const CLI = path.join(KIT_ROOT, 'bin', 'evidence-context.mjs');

/** A small synthetic corpus, so these tests do not depend on this repo's own research. */
function fixture() {
  const root = tempDir('fetchproof-evidence-context-');
  const raw = path.join(root, 'research', 'raw');
  fs.mkdirSync(raw, { recursive: true });

  fs.writeFileSync(path.join(raw, 'page.md'),
    '---\nurl: https://example.invalid/limits\n---\n\n'
    + '# Acme\n\nTrusted by 10,000 developers. Sign in to get started.\n\n'
    + '## Rate limits\n\nThe free plan allows 10 requests per minute per team. '
    + 'Requests beyond that return HTTP 429.\n', 'utf8');

  fs.writeFileSync(path.join(root, 'research', 'DISCOVERY.md'),
    '# Discovery\n\n## Build intent\n\nA thing.\n\n## Unknowns\n\n'
    + '| ID | Unknown | Why it blocks | Status | Evidence |\n|---|---|---|---|---|\n'
    + '| U-1 | What is the rate limit? | Sets the budget | CLOSED | E-01 |\n'
    + '| U-2 | Something unproven | Blocks a default | OPEN |  |\n', 'utf8');

  fs.writeFileSync(path.join(root, 'research', 'EVIDENCE.md'),
    '# Evidence\n\n| ID | Retrieved | Type | URL | Finding | Raw |\n|---|---|---|---|---|---|\n'
    + '| E-01 | 2026-09-01 | P | https://example.invalid/limits | Free plan: 10 requests per minute per team. | research/raw/page.md |\n',
    'utf8');

  fs.writeFileSync(path.join(root, 'research', 'SOURCES.md'),
    '# Sources\n\n| URL | Type | Title | Retrieved | Used for |\n|---|---|---|---|---|\n'
    + '| https://example.invalid/limits | P | Acme Rate Limits | 2026-09-01 | U-1 |\n', 'utf8');

  return root;
}

test('it gathers the unknown, its rows, the source title and a bounded excerpt', () => {
  const root = fixture();
  try {
    const context = evidenceContext(readCorpus(root), 'U-1');
    assertEqual(context.ok, true, JSON.stringify(context));
    assertEqual(context.unknown.id, 'U-1');
    assertEqual(context.cited.length, 1);

    const row = context.cited[0];
    assertEqual(row.id, 'E-01');
    assertEqual(row.typeLabel, 'Primary', 'a bare P helps nobody reading a report');
    assertEqual(row.title, 'Acme Rate Limits', 'the title comes from SOURCES.md, not the evidence row');
    assertEqual(row.retrieved, '2026-09-01');
    assert(row.excerpt.includes('10 requests per minute'), `excerpt missed the claim: ${row.excerpt}`);
    assert(!row.excerpt.includes('Sign in to get started'), 'the excerpt quoted page chrome');
  } finally { cleanup(root); }
});

test('the excerpt is bounded, so the command cannot print the page', () => {
  const body = `${'padding. '.repeat(200)}\n\nThe free plan allows 10 requests per minute.`;
  const excerpt = excerptFor(body, 'free plan requests per minute', { limit: 120 });
  assert(excerpt.length <= 121, `excerpt is ${excerpt.length} chars, which is not bounded`);
});

// Found 2026-09-27 reviewing collector run 36300088606: its capture was one JSON document with
// no blank line, so the whole page was one block and the excerpt was its first 420 characters
// (Node v0.8, v0.10) - never the v22 and v24 dates the finding quoted.
test('a long single-block page is excerpted where the finding points, not from its top', () => {
  const lines = [];
  for (let v = 0; v <= 30; v += 1) lines.push(`  "v${v}": {`, `    "start": "20${10 + (v % 10)}-04-01",`, `    "end": "20${20 + (v % 10)}-04-30"`, '  },');
  lines.push('  "v22": {', '    "codename": "Jod",', '    "end": "2027-04-30"', '  }');
  const body = `{\n${lines.join('\n')}\n}`;
  const excerpt = excerptFor(body, 'Node 22 (Jod) ends 2027-04-30: `"v22": {... "end": "2027-04-30"`', { limit: 200 });
  assert(excerpt.includes('Jod') && excerpt.includes('2027-04-30'), `the excerpt missed what the finding quotes:\n${excerpt}`);
  assert(excerpt.length <= 203, `excerpt is ${excerpt.length} chars, which is not bounded`);
});

test('a lowercase or mistyped id is handled, not thrown', () => {
  const root = fixture();
  try {
    const corpus = readCorpus(root);
    assertEqual(evidenceContext(corpus, 'u-1').ok, true, 'ids should not be case-sensitive to a person');
    const missing = evidenceContext(corpus, 'U-99');
    assertEqual(missing.ok, false);
    assert(missing.known.includes('U-1'), 'a wrong id should say which ids exist');
  } finally { cleanup(root); }
});

test('it reports gaps rather than filling them', () => {
  const root = fixture();
  try {
    // U-2 cites nothing. That is a real state of a real corpus, and the answer is to say
    // so - not to go looking for a row that might fit.
    const context = evidenceContext(readCorpus(root), 'U-2');
    assertEqual(context.ok, true);
    assertEqual(context.cited.length, 0);
    assert(context.gaps.some((g) => /cites no evidence row/.test(g)), JSON.stringify(context.gaps));
  } finally { cleanup(root); }
});

test('it offers no verdict about whether the unknown is closed', () => {
  // The line this guards is the one that matters. Gathering evidence for a human is
  // useful; implying the conclusion is how a machine's guess ends up in the corpus
  // wearing a person's authority.
  const root = fixture();
  try {
    const text = renderContext(evidenceContext(readCorpus(root), 'U-1'));
    const verdicts = [
      /\bthis (unknown )?(is|looks) (closed|answered|sufficient|proven)\b/i,
      /\bevidence (is )?(sufficient|enough|adequate|supports)\b/i,
      /\b(recommend|suggest)s? (closing|marking)\b/i,
      /\bsafe to (close|build|proceed)\b/i,
    ];
    for (const verdict of verdicts) {
      assert(!verdict.test(text), `the rendering draws a conclusion it has no business drawing: ${verdict}`);
    }
    assert(/your call/i.test(text), 'the rendering should say plainly that the judgement is the reader\'s');
  } finally { cleanup(root); }
});

test('an extractor suggestion is labelled a suggestion, and never replaces the row', () => {
  const root = fixture();
  try {
    const before = fs.readFileSync(path.join(root, 'research', 'EVIDENCE.md'), 'utf8');
    const context = evidenceContext(readCorpus(root), 'U-1');
    const text = renderContext(context);
    if (context.cited[0].extractor) {
      assert(/Suggestion only/.test(text), 'an extractor pick was shown without saying it is only a suggestion');
    }
    assertEqual(fs.readFileSync(path.join(root, 'research', 'EVIDENCE.md'), 'utf8'), before,
      'reading an unknown modified the evidence table');
  } finally { cleanup(root); }
});

test('the CLI is read-only and its exit codes distinguish the cases', () => {
  const root = fixture();
  try {
    const before = new Map();
    for (const rel of ['research/DISCOVERY.md', 'research/EVIDENCE.md', 'research/SOURCES.md', 'research/raw/page.md']) {
      before.set(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
    }

    const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    });

    assertEqual(run(['--unknown', 'U-1']).status, 0, 'a known unknown should exit 0');
    assertEqual(run(['--unknown', 'U-99']).status, 1, 'an unknown that is not there should exit 1');
    assertEqual(run([]).status, 2, 'no argument should exit 2, not 0 with empty output');
    assertEqual(run(['--help']).status, 0);

    for (const [rel, content] of before) {
      assertEqual(fs.readFileSync(path.join(root, rel), 'utf8'), content, `${rel} was modified by a read-only command`);
    }
  } finally { cleanup(root); }
});

// Found 2026-09-29 (break-test report, F3): on a contract with no unknowns yet, --all exited
// 2 with "name an unknown: --unknown U-5, or --all" - asking for the flag it was given.
test('--all on a contract with no unknowns says so, and is not a usage error', () => {
  const root = tempDir('fetchproof-evidence-context-empty-');
  try {
    fs.mkdirSync(path.join(root, 'research'), { recursive: true });
    fs.writeFileSync(path.join(root, 'research', 'DISCOVERY.md'), '# Discovery\n\n## Build intent\n\nNothing yet.\n');
    const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    });
    const text = run(['--all']);
    assertEqual(text.status, 0, `--all with nothing to explain exited ${text.status}: ${text.stderr}`);
    assert.doesNotMatch(text.stderr + text.stdout, /or --all/, 'it asked for the flag it was given');
    assert.match(text.stdout, /no unknowns/i);
    const json = run(['--all', '--json']);
    assertEqual(json.status, 0);
    assert.deepEqual(JSON.parse(json.stdout), [], '--all --json is a list, and an empty one here');
  } finally { cleanup(root); }
});

test('--json is byte-deterministic across runs', () => {
  // The report is meant to be pasteable into a review and diffable between sessions.
  const root = fixture();
  try {
    const run = () => spawnSync(process.execPath, [CLI, 'U-1', '--json'], {
      cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    }).stdout;
    assertEqual(run(), run(), 'two runs over one corpus produced different bytes');
  } finally { cleanup(root); }
});

test('it reads no environment variable, so it cannot use a credential', () => {
  // The same property every validator in this kit has. Asserted on the source because a
  // runtime check can only prove the paths it happened to walk.
  for (const file of ['lib/evidence-context.mjs', 'bin/evidence-context.mjs']) {
    const source = fs.readFileSync(path.join(KIT_ROOT, file), 'utf8');
    assert(!/process\.env/.test(source), `${file} reads the environment; it must not be able to see a key`);
    assert(!/fetch\(|https?\.request|spawn/.test(source), `${file} reaches the network or spawns; it is meant to read the corpus`);
  }
});

test('this repository answers for its own unknowns', () => {
  // The fixture proves the shape; this proves it works on a real corpus, which is where
  // the awkward cases live - superseded rows, multi-row unknowns, long findings.
  const corpus = readCorpus(REPO);
  if (!corpus.discovery.present || !corpus.unknowns.length) return;   // a scaffolded copy
  for (const unknown of corpus.unknowns) {
    const context = evidenceContext(corpus, unknown.id);
    assertEqual(context.ok, true, `${unknown.id} could not be explained`);
    assert(typeof renderContext(context) === 'string');
  }
});

// ---------------------------------------------------------------- structural guards
//
// The "no verdict" test above forbids a list of conclusion PHRASES, which catches an
// obvious regression and cannot catch a newly worded one - "the supplied evidence
// strongly supports moving forward" passes every phrase check ever written. Wording tests
// are a tripwire, not a property.
//
// These are the property: the module cannot reach the machinery that produces verdicts,
// and cannot write. A conclusion it is architecturally unable to compute is one nobody
// has to notice in a code review.

test('it cannot import the machinery that decides anything', () => {
  const source = fs.readFileSync(path.join(KIT_ROOT, 'lib', 'evidence-context.mjs'), 'utf8');
  const imports = [...source.matchAll(/^import\s+(?:.+?)\s+from\s+'([^']+)'/gm)].map((m) => m[1]);

  // checks.mjs is imported for supersededRows - a pure lookup of which row replaced which.
  // The verdict lives in preflight/gate, and reaching either would let a future edit turn
  // "here is the evidence" into "here is the answer" without anything structural objecting.
  const forbidden = ['./preflight.mjs', './gate.mjs', './doctor.mjs', './brief.mjs'];
  const reached = imports.filter((name) => forbidden.includes(name));
  assertEqual(reached.length, 0,
    `evidence-context imports verdict machinery (${reached.join(', ')}); it is meant to gather, not decide`);

  // Comments are stripped first. The first version of this test scanned the raw file for
  // the word "verdict" and went red on the module's own comment saying it offers none -
  // the guard caught the prose explaining the absence of the thing it guards against.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  for (const banned of ['runPreflight', 'runChecks', 'evaluate(', 'verdict']) {
    assert(!code.includes(banned), `evidence-context calls ${banned}, which is verdict machinery`);
  }
});

test('it contains no write call at all', () => {
  // Read-only asserted structurally rather than by watching one run: a runtime check can
  // only prove the paths it happened to walk.
  for (const file of ['lib/evidence-context.mjs', 'bin/evidence-context.mjs']) {
    const source = fs.readFileSync(path.join(KIT_ROOT, file), 'utf8');
    for (const write of ['writeFile', 'appendFile', 'mkdir', 'rm(', 'rmSync', 'unlink', 'rename', 'appendJsonLine']) {
      assert(!source.includes(write), `${file} calls ${write}; this command must not change the corpus`);
    }
  }
});

test('the recorded status is labelled as a recording, and comes after the evidence', () => {
  // It used to head the report as "Status: CLOSED". Read from the corpus, decided by
  // nothing - but a verdict printed BEFORE the evidence is an anchor, and a reviewer who
  // sees CLOSED first reads to confirm rather than to judge.
  const root = fixture();
  try {
    const text = renderContext(evidenceContext(readCorpus(root), 'U-1'));
    assert(/Recorded status/.test(text), 'the status is no longer labelled as a recording');
    assert(!/^Status:/m.test(text), 'the bare "Status:" line is back, and it anchors the reader');

    const statusAt = text.indexOf('Recorded status');
    const evidenceAt = text.indexOf('E-01');
    assert(evidenceAt >= 0 && statusAt > evidenceAt,
      'the recorded status appears before the evidence it is supposed to be judged against');
    assert(/not a judgement by this command/i.test(text), 'the status is shown without saying whose it is');
  } finally { cleanup(root); }
});

// Found 2026-09-28 (checking an outside break-test, F-02): an EVIDENCE Raw cell spelled
// "../<elsewhere>/secret.md" made `evidence-context --all` print the OUTSIDE file into its
// output - an agent's context. The gate failed, but only through `citations`, and the row
// still read as present. It is now a blocking raw-outside problem and is never read.
test('a Raw cell that lands outside the project is never read, and blocks as raw-outside', () => {
  const root = makePassingProject();
  const secret = path.join(tempDir('fp-outside-'), 'secret.md');
  fs.writeFileSync(secret, '---\nurl: https://example.com/x\n---\nTOP SECRET OUTSIDE THE PROJECT\n');
  const evidence = resolve(root, PATHS.evidence);
  const text = fs.readFileSync(evidence, 'utf8');
  const cited = text.match(/research\/raw\/[^\s|]+\.md/)[0];
  fs.writeFileSync(evidence, text.replace(cited, path.relative(root, secret).split(path.sep).join('/')));
  const corpus = readCorpus(root);
  assert.ok(corpus.problems.some((p) => p.kind === 'raw-outside'), `no raw-outside problem: ${JSON.stringify(corpus.problems)}`);
  const rendered = JSON.stringify(corpus.unknowns.map((u) => evidenceContext(corpus, u.id)));
  assert.ok(!rendered.includes('TOP SECRET'), 'evidence-context carried the outside file');
  assert.match(rendered, /outside the project/);
  assert.ok(runPreflight(root).findings.some((f) => f.severity === 'fail' && f.rule === 'raw-outside'), 'the gate did not block on raw-outside');
});
