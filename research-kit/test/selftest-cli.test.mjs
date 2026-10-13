// The suite must run every requested group, or refuse before any tests start.
import { spawnSync } from 'node:child_process';
import { test, describe, assert, tempDir, path, KIT_ROOT, fs } from './harness.mjs';

describe('selftest-cli');

function runGroups(groups, env = process.env) {
  const childEnv = { ...env };
  delete childEnv.RESEARCH_KIT_RESULT_FILE;
  return spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'selftest.mjs'), ...groups], {
    cwd: tempDir('rk-selftest-groups-'), env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
}

test('unknown groups are named and refused, alone or mixed with valid groups', () => {
  for (const groups of [['no-such-group'], ['warc', 'no-such-group'], ['no-such-group', 'warc']]) {
    const result = runGroups(groups);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /no-such-group/);
    assert.match(result.stderr, /matches no test file/);
    assert.doesNotMatch(result.stdout, /^ok\s|all tests passed|passed, \d+ failed/m);
  }
});

test('multiple valid groups still run every matching test file', () => {
  const result = runGroups(['warc', 'similarity']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^ok\s+warc >/m);
  assert.match(result.stdout, /^ok\s+similarity >/m);
  assert.match(result.stdout, /all tests passed/);
});

test('regression subprocesses cannot overwrite the parent suite report', () => {
  const file = path.join(tempDir('rk-parent-report-'), 'parent-report.json');
  fs.writeFileSync(file, 'PARENT REPORT\n');
  const result = runGroups(['warc', 'similarity'], { ...process.env, RESEARCH_KIT_RESULT_FILE: file });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(file, 'utf8'), 'PARENT REPORT\n');
});
