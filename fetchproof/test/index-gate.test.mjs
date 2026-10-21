// F08 — the commit gate judges the INDEX (ADR-0024).
//
// git hands the hook staged path NAMES and nothing else, so a gate that reads the corpus
// off disk judges different bytes from the ones about to be committed. These tests stage
// one thing and leave another in the working tree, then assert which one decided.

import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { test, describe, assert, makePassingProject, corrupt, tempDir, fs, path, requireCapability, requireGit, fixtureCommitArgs, fixtureInitArgs } from './harness.mjs';
import { PATHS, resolve, readText, writeText } from '../lib/core.mjs';
import { evaluate, materializeIndex } from '../lib/gate.mjs';
import { readCorpus } from '../lib/corpus.mjs';

describe('index-gate');

const GIT = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeRepo() {
  requireCapability(GIT, 'GIT-NOT-FOUND', 'git is not on PATH, so the index cannot be read');
  const dir = makePassingProject();
  git(dir, fixtureInitArgs());
  git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'Fixture']);
  git(dir, ['add', '-A', '-f']);
  git(dir, fixtureCommitArgs('the passing corpus'));
  return dir;
}

test('materializeIndex writes the index content to a scratch dir and touches nothing', () => {
  const dir = makeRepo();
  const before = readText(resolve(dir, PATHS.discovery));
  corrupt(dir, PATHS.discovery, (t) => t.replace('CLOSED', 'WORKING-TREE-ONLY'));

  const held = materializeIndex(dir);
  assert.equal(held.ok, true, held.detail);
  try {
    const staged = readText(path.join(held.dir, 'research', 'DISCOVERY.md'));
    assert.equal(staged, before, 'the scratch copy holds what git has, not what the editor has');
    assert.match(readText(resolve(dir, PATHS.discovery)), /WORKING-TREE-ONLY/, 'the working tree is untouched');
  } finally {
    fs.rmSync(held.dir, { recursive: true, force: true });
  }
});

test('F08: a staged OPEN contract BLOCKS even when the working tree says CLOSED', () => {
  const dir = makeRepo();

  // Stage the failing contract...
  corrupt(dir, PATHS.discovery, (t) => t.replace('CLOSED', 'OPEN'));
  writeText(resolve(dir, 'src/index.js'), 'export const x = 1;\n');
  git(dir, ['add', 'research/DISCOVERY.md', 'src/index.js']);
  // ...then put a passing one back in the working tree only.
  corrupt(dir, PATHS.discovery, (t) => t.replace('OPEN', 'CLOSED'));

  assert.match(git(dir, ['show', ':research/DISCOVERY.md']), /\| OPEN \|/, 'the index really does hold OPEN');
  assert.match(readText(resolve(dir, PATHS.discovery)), /\| CLOSED \|/, 'and the working tree really does hold CLOSED');

  const verdict = evaluate(dir, { gate: 'commit', stagedPaths: ['research/DISCOVERY.md', 'src/index.js'], record: false });
  assert.equal(verdict.judged, 'index');
  assert.equal(verdict.allow, false, 'the commit that is about to happen carries OPEN');
});

test('F08: the mirror case - a staged CLOSED contract passes over a broken working tree', () => {
  const dir = makeRepo();
  writeText(resolve(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', 'README.md']);
  // The working tree is mid-edit and would fail; the index is clean.
  corrupt(dir, PATHS.discovery, (t) => t.replace('CLOSED', 'OPEN'));

  const verdict = evaluate(dir, { gate: 'commit', stagedPaths: ['README.md'], record: false });
  assert.equal(verdict.judged, 'index');
  assert.equal(verdict.allow, true, 'work in progress on disk is not what is being committed');
});

test('F08: a staged DELETION of the contract is judged, and fails harder', () => {
  const dir = makeRepo();
  git(dir, ['rm', '-q', '--cached', 'research/DISCOVERY.md']);
  writeText(resolve(dir, 'src/index.js'), 'export const x = 1;\n');
  git(dir, ['add', 'src/index.js']);

  const verdict = evaluate(dir, { gate: 'commit', stagedPaths: ['research/DISCOVERY.md', 'src/index.js'], record: false });
  assert.equal(verdict.allow, false);
  assert.ok(
    verdict.findings.some((f) => f.rule === 'contract-missing'),
    'deleting the contract in the index is not an opt-out, and the file still on disk must not hide it',
  );
});

test('the EDIT gate keeps reading the working tree - it is the opposite question', () => {
  const dir = makeRepo();
  corrupt(dir, PATHS.discovery, (t) => t.replace('CLOSED', 'OPEN'));

  const edit = evaluate(dir, { gate: 'edit', record: false });
  assert.equal(edit.judged, 'working-tree');
  assert.equal(edit.allow, false, 'an interactive check is about what is in front of you');
});

test('outside a repository the gate says which bytes it judged, and never silently swaps', () => {
  const dir = makePassingProject(); // no git init
  const verdict = evaluate(dir, { gate: 'commit', stagedPaths: [], record: false });
  assert.equal(verdict.judged, 'working-tree');
  assert.match(verdict.indexNote, /not-a-repository/);
});

test('a caller that injects a corpus gets that corpus judged, not the index', () => {
  const dir = makeRepo();
  corrupt(dir, PATHS.discovery, (t) => t.replace('CLOSED', 'OPEN'));
  const injected = evaluate(dir, {
    gate: 'commit',
    stagedPaths: ['src/a.js'],
    corpus: readCorpus(dir),
    record: false,
  });
  assert.equal(injected.judged, 'working-tree');
  assert.equal(injected.allow, false);
});

// The count is taken in a PRIVATE temp directory. It used to be the shared one, where any
// commit on the machine (the gate makes the same directory) or a second suite running at
// the same time changed the count, and this test failed with nothing leaked (break-test,
// 2026-09-27). os.tmpdir() reads the environment on every call, so pointing it here for
// one evaluation is enough.
test('the scratch directory does not survive the verdict', () => {
  const dir = makeRepo();
  const scratch = tempDir('fp-index-tmp-');
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  Object.assign(process.env, { TMPDIR: scratch, TEMP: scratch, TMP: scratch });
  let seen;
  try {
    assert.equal(os.tmpdir(), scratch, 'the private temp directory was not taken up');
    evaluate(dir, { gate: 'commit', stagedPaths: [], record: false });
    seen = fs.readdirSync(scratch);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.deepEqual(seen, [], 'every commit would otherwise leak a copy of the corpus into the temp directory');
});

// Found 2026-09-28 (break-test): the empty-index verdict - a gated project whose
// research/ is not tracked yet, which is every fresh project's first commit - returned
// from evaluate before the scratch variable was assigned, so the finally that removes
// it never ran and every such verdict leaked one temp directory.
test('the empty-index verdict takes its scratch with it too', () => {
  // Declared, not assumed: the test spawns git through the fixture helper, and on a host
  // without it the failure was a raw `spawnSync git ENOENT` rather than the UNSUP this
  // harness exists to report (found 2026-09-29, break-test).
  requireGit('the empty-index verdict over an untracked corpus');
  const dir = makePassingProject();
  git(dir, fixtureInitArgs());                 // a repository whose research/ is UNTRACKED
  git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'Fixture']);
  const scratch = tempDir('fp-index-empty-');
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  Object.assign(process.env, { TMPDIR: scratch, TEMP: scratch, TMP: scratch });
  let seen;
  try {
    assert.equal(os.tmpdir(), scratch, 'the private temp directory was not taken up');
    const verdict = evaluate(dir, { gate: 'commit', stagedPaths: [], record: false });
    assert.equal(verdict.verdict, 'block', 'the fixture stopped being the untracked-corpus case');
    seen = fs.readdirSync(scratch);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.deepEqual(seen, [], 'every first commit of a fresh project would otherwise leak a temp directory');
});
