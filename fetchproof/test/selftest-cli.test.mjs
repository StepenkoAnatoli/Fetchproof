// The suite must run every requested group, or refuse before any tests start.
import { spawnSync } from 'node:child_process';
import { test, describe, assert, tempDir, path, KIT_ROOT, fs, TEST_TIMEOUT } from './harness.mjs';

describe('selftest-cli');

// The child runs two small groups that read only the kit (a few seconds) and gets the suite's
// own per-test time: a fixed 60 s around warc and similarity (31-34 s idle) ran out under the
// gate's load (2026-10-21).
const GROUPS = ['ordering', 'witness'];

function runGroups(groups, env = process.env) {
  const childEnv = { ...env };
  delete childEnv.FETCHPROOF_RESULT_FILE;
  return spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'selftest.mjs'), ...groups], {
    cwd: tempDir('fp-selftest-groups-'), env: childEnv, encoding: 'utf8', windowsHide: true, timeout: TEST_TIMEOUT,
  });
}

function output(result) {
  const error = result.error ? `${result.error.code ?? result.error.message}\n` : '';
  return `${error}${result.stdout}\n${result.stderr}`;
}

test('unknown groups are named and refused, alone or mixed with valid groups', () => {
  for (const groups of [['no-such-group'], ['warc', 'no-such-group'], ['no-such-group', 'warc']]) {
    const result = runGroups(groups);
    assert.equal(result.status, 2, output(result));
    assert.match(result.stderr, /no-such-group/);
    assert.match(result.stderr, /matches no test file/);
    assert.doesNotMatch(result.stdout, /^ok\s|all tests passed|passed, \d+ failed/m);
  }
});

test('multiple valid groups still run every matching test file', () => {
  const result = runGroups(GROUPS);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /^ok\s+ordering >/m);
  assert.match(result.stdout, /^ok\s+witness >/m);
  assert.match(result.stdout, /all tests passed/);
});

test('regression subprocesses cannot overwrite the parent suite report', () => {
  const file = path.join(tempDir('fp-parent-report-'), 'parent-report.json');
  fs.writeFileSync(file, 'PARENT REPORT\n');
  const result = runGroups(GROUPS, { ...process.env, FETCHPROOF_RESULT_FILE: file });
  assert.equal(result.status, 0, output(result));
  assert.equal(fs.readFileSync(file, 'utf8'), 'PARENT REPORT\n');
});
