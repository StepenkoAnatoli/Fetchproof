// What the commit gate does when it CANNOT read the index.
//
// The gate's contract is that it judges the bytes being committed (ADR-0024). Until
// 2026-09-21, a git failure while materialising the index made it judge the working tree
// instead, note that it had done so, and carry on to a normal verdict.
//
// Noting it is not enough. The two sources differ exactly when it matters: stage a corpus
// with an unproven unknown, fix it only in the working tree, and a gate reading the tree
// passes a commit whose staged contents it never saw. That is the defect ADR-0024 exists
// to prevent, reintroduced by an environmental failure rather than by a code path - and
// an environmental failure is the case nobody is watching for.

import { test, describe, assert, assertEqual, fs, path, makePassingProject, cleanup, tempDir } from './harness.mjs';
import { evaluate, materializeIndex } from '../lib/gate.mjs';

describe('gate-index-failure');

/** A git failure, in the shape materializeIndex reports one. */
const brokenIndex = () => ({ ok: false, reason: 'git-failed', detail: 'could not list the index' });

test('a git failure BLOCKS the commit gate; it does not fall back to the working tree', () => {
  const root = makePassingProject();
  try {
    // The corpus on disk passes. Before the fix this returned `pass` - the working tree
    // was judged and it was fine - while the staged bytes were never looked at.
    const good = evaluate(root, { gate: 'commit', stagedPaths: ['research/EVIDENCE.md'], record: false });
    assert(['pass', 'block'].includes(good.verdict), `unexpected baseline verdict: ${good.verdict}`);

    const verdict = evaluate(root, {
      gate: 'commit',
      stagedPaths: ['research/EVIDENCE.md'],
      record: false,
      materialize: brokenIndex,
    });

    assertEqual(verdict.verdict, 'block',
      'the gate could not read the staged bytes and did not block. Whatever it returned, '
      + 'it was a judgement of the working tree presented as a judgement of the commit.');
    assertEqual(verdict.allow, false, 'a gate that cannot do its job must not allow');
    assertEqual(verdict.judged, 'nothing',
      `judged=${verdict.judged}; it must not claim to have judged the index or the tree`);
    assert(/could not read the index/i.test(verdict.indexNote ?? ''),
      `the verdict does not say the index was unreadable: ${JSON.stringify(verdict.indexNote)}`);
    assert(/--no-verify/.test(verdict.fix ?? ''),
      'blocking without naming the recorded escape hatch leaves an operator stuck');
  } finally { cleanup(root); }
});

test('a project that is not a git repository still judges the working tree', () => {
  // The mirror, and the reason the fix is not simply "block on any non-ok". There is no
  // index to fail to read, so the working tree is the only thing there is, and judging it
  // is honest rather than a substitution.
  const root = makePassingProject();
  try {
    const verdict = evaluate(root, {
      gate: 'commit',
      stagedPaths: ['research/EVIDENCE.md'],
      record: false,
      materialize: () => ({ ok: false, reason: 'not-a-repository', detail: 'no .git here' }),
    });
    assert(verdict.verdict !== 'block' || !/could not read the index/.test(verdict.reason ?? ''),
      'a non-repository was treated as an unreadable index');
    // The note carries the REASON CODE, not a rephrasing of it. index-gate.test.mjs
    // already pins `/not-a-repository/`, and this test originally asserted the prose
    // instead — so a better-worded note would have satisfied one test and broken the
    // other. The code is the stable part; the sentence around it is not.
    assert(/not-a-repository/.test(verdict.indexNote ?? ''),
      `the note should name why the tree was judged: ${JSON.stringify(verdict.indexNote)}`);
  } finally { cleanup(root); }
});

test('the edit gate is unaffected: it reads the working tree on purpose', () => {
  // An interactive research check is about what you have in front of you, which is the
  // opposite question to the one the commit gate asks. Blocking it on an index failure
  // would be a regression of its own.
  const root = makePassingProject();
  try {
    const verdict = evaluate(root, { gate: 'edit', record: false, materialize: brokenIndex });
    assert(verdict.verdict !== 'block' || verdict.judged !== 'nothing',
      'the edit gate was blocked by an index failure it does not depend on');
  } finally { cleanup(root); }
});

test('index materialisation does not put every tracked path in one argv', () => {
  // The commit HOOK moved its staged list to stdin when argv proved quadratic and
  // bounded (ADR-0020), but this call still spread every tracked research path as an
  // argument. Windows caps a command line near 32k characters, so a large corpus failed
  // here for a reason unrelated to the index - and, before the fix above, that failure
  // then silently became a working-tree judgement.
  const root = tempDir('fetchproof-index-argv-');
  try {
    const many = Array.from({ length: 900 }, (_, i) => `research/raw/capture-${String(i).padStart(4, '0')}.md`);
    const batches = [];
    const run = (args) => {
      if (args[0] === 'ls-files') return many.join('\0');
      if (args[0] === 'checkout-index') {
        batches.push(args.filter((a) => a.startsWith('research/')).length);
        return '';
      }
      return '';
    };
    // isGitRepo reads the filesystem, so give it a .git to find.
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    const result = materializeIndex(root, { run });
    try {
      assertEqual(result.ok, true, JSON.stringify(result));
      assertEqual(result.files, many.length);
      assert(batches.length > 1, `900 paths went to git in ${batches.length} call(s); that is one argv again`);
      assert(Math.max(...batches) <= 500,
        `the largest batch was ${Math.max(...batches)} paths, which is heading back toward the limit`);
      assertEqual(batches.reduce((a, b) => a + b, 0), many.length, 'chunking lost or duplicated paths');
    } finally {
      // materializeIndex made a real scratch dir before the injected run answered; the
      // finally below removes the project, and this one the scratch (found 2026-09-28,
      // break-test: one fetchproof-index-* directory leaked per run from here).
      if (result && result.dir) { try { fs.rmSync(result.dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    }
  } finally { cleanup(root); }
});
