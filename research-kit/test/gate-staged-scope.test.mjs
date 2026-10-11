// ADR-0154: an unknown staged set is not an empty staged set. These cases use the
// real verdict with an injected corpus/list reader and do not run a suite or hook.
import { test, describe, assert, makePassingProject, tempDir, fs, path } from './harness.mjs';
import { PATHS, resolve, writeText, writeJson } from '../lib/core.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import * as gate from '../lib/gate.mjs';

describe('gate-staged-scope');

test('unknown staged scope cannot clear the architecture-map rule; a known empty set can', () => {
  const root = tempDir('rk-staged-proof-');
  for (const unknown of [null, undefined, '', {}, 0]) {
    const breach = gate.architectureMapBreach(root, unknown);
    assert.equal(breach?.rule, 'architecture-map-same-commit', `unknown ${JSON.stringify(unknown)} was treated as no code change`);
    assert.match(breach.detail, /could not list the staged paths/i);
    assert.match(breach.fix, /git diff|git status/);
  }
  assert.equal(gate.architectureMapBreach(root, []), null, 'a genuinely empty staged list owes no map');
  assert.equal(gate.architectureMapBreach(root, ['README.md']), null);
  assert(gate.architectureMapBreach(root, ['src/app.js']));
  assert.equal(gate.architectureMapBreach(root, ['src/app.js', PATHS.architecture]), null);
});

test('a green commit with unknown staged scope is an ordinary block even with fail-open configured', () => {
  const root = makePassingProject();
  const config = path.join(root, 'machine-config.json');
  writeJson(config, { failOpen: true });
  const corpus = readCorpus(root);
  const options = { gate: 'commit', corpus, record: false, env: { ...process.env, RESEARCH_KIT_CONFIG: config } };
  let suiteCalls = 0;
  const result = gate.evaluate(root, { ...options, stagedPaths: null, runSuite: () => { suiteCalls += 1; throw new Error('a cheap scope breach must be first'); } });
  assert.equal(result.preflight.pass, true, 'the fixture must reach the green map branch');
  assert.equal(result.verdict, 'block');
  assert.equal(result.allow, false);
  assert.equal(result.breach.rule, 'architecture-map-same-commit');
  assert.equal(suiteCalls, 0);
  assert.equal(gate.evaluate(root, { ...options, stagedPaths: [] }).allow, true);
  assert.equal(gate.evaluate(root, { ...options, stagedPaths: ['src/app.js', PATHS.architecture] }).allow, true);
});

test('one successful actual Git list read preserves NUL-delimited names and needs no probe', () => {
  const root = tempDir('rk-staged-list-');
  const names = ['src/ leading and trailing ', 'src/a\nb.js', PATHS.architecture];
  let calls = 0;
  const paths = gate.readStagedPaths(root, { run: (args, options) => {
    calls += 1;
    assert.deepEqual(args, ['diff', '--cached', '--name-only', '--no-renames', '-z']);
    assert.equal(options.cwd, root);
    if (calls > 1) throw Object.assign(new Error('the second read fails'), { status: 1, stdout: '' });
    return `${names.join('\0')}\0`;
  } });
  assert.equal(calls, 1, 'a successful probe must not cause a second unverified read');
  assert.deepEqual(paths, names, 'Git names must remain data, including spaces and newlines');
});

test('failed, over-buffer, and malformed actual list reads are unknown; successful zero-byte output is empty', () => {
  const root = tempDir('rk-staged-list-error-');
  assert.deepEqual(gate.readStagedPaths(root, { run: () => '' }), []);
  for (const answer of [null, undefined, 0, {}, ['src/app.js'], 'src/app.js', 'src/app.js\0\0']) {
    assert.equal(gate.readStagedPaths(root, { run: () => answer }), null, `${JSON.stringify(answer)} became an empty successful list`);
  }
  for (const error of [
    Object.assign(new Error('failed diff'), { status: 1, stdout: 'docs/ARCHITECTURE.md\0' }),
    Object.assign(new Error('stdout maxBuffer exceeded'), { code: 'ENOBUFS', stdout: 'docs/ARCHITECTURE.md\0' }),
  ]) {
    assert.equal(gate.readStagedPaths(root, { run: () => { throw error; } }), null, 'partial stdout from a failed process must not clear scope');
  }
});

test('lazy acquisition refuses thrown or malformed answers without converting them into internal errors', () => {
  const root = makePassingProject();
  const corpus = readCorpus(root);
  const options = { gate: 'commit', corpus, record: false };
  for (const answer of [null, undefined, {}, '', [''], [null], ['src/app.js', {}]]) {
    let calls = 0;
    const result = gate.evaluate(root, { ...options, listStaged: () => { calls += 1; return answer; } });
    assert.equal(calls, 1);
    assert.equal(result.verdict, 'block');
    assert.equal(result.breach?.rule, 'architecture-map-same-commit');
  }
  const thrown = gate.evaluate(root, { ...options, listStaged: () => { throw new Error('Git failed'); } });
  assert.equal(thrown.verdict, 'block');
  assert.equal(thrown.breach.rule, 'architecture-map-same-commit');
});

test('lazy acquisition respects ungated, GATE_OFF and edit ordering; known empty answers remain valid', () => {
  let calls = 0;
  const listStaged = () => { calls += 1; return []; };
  assert.equal(gate.evaluate(tempDir('rk-ungated-staged-'), { gate: 'commit', listStaged, record: false }).verdict, 'not-gated');
  assert.equal(calls, 0);
  const root = makePassingProject();
  const corpus = readCorpus(root);
  writeText(resolve(root, PATHS.gateOff), 'deliberate fixture override\n');
  assert.equal(gate.evaluate(root, { gate: 'commit', corpus, listStaged, record: false }).verdict, 'override');
  assert.equal(calls, 0);
  fs.rmSync(resolve(root, PATHS.gateOff));
  assert.equal(gate.evaluate(root, { gate: 'edit', corpus, listStaged, record: false }).allow, true);
  assert.equal(calls, 0);
  assert.equal(gate.evaluate(root, { gate: 'commit', corpus, stagedPaths: [], listStaged, record: false }).allow, true);
  assert.equal(calls, 0, 'a supplied list must not be replaced by acquisition');
  assert.equal(gate.evaluate(root, { gate: 'commit', corpus, listStaged, record: false }).allow, true);
  assert.equal(calls, 1);
});
