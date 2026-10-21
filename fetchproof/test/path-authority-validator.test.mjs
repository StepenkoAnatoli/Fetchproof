// Offline conformance and semantic tests for Git-origin/path-authority
// snapshot envelopes. All paths and transcripts are synthetic and disposable.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, describe, assert, assertEqual, cleanup, tempDir } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('path-authority-validator');

const HASH = 'a'.repeat(64);

function tempRoot() {
  return tempDir('fetchproof-path-authority-');
}

function validSnapshot(overrides = {}) {
  const fixture = 'C:/disposable/research-fixture';
  const row = {
    setting: 'configPath',
    explicit: 'C:/disposable/research-fixture/config/explicit.json',
    environment: 'C:/disposable/research-fixture/config/env.json',
    machine_config: 'C:/disposable/research-fixture/config/machine.json',
    profile: 'C:/disposable/research-fixture/profile/config.json',
    runtime_default: 'C:/disposable/research-fixture/default/config.json',
    expected_winner: 'explicit',
    observed_path: 'C:/disposable/research-fixture/config/explicit.json',
    realpath: 'C:/disposable/research-fixture/config/explicit.json',
    contained: true,
    evidence_ref: 'EVID-PATH-01',
    status: 'PASS',
  };
  const environment = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'FETCHPROOF_HOME', 'FETCHPROOF_CONFIG', 'FETCHPROOF_INSTALL_STATE', 'FETCHPROOF_EDIT_GATE_SETTINGS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']
    .map((key) => ({ key, expected_isolated_value: `C:/disposable/research-fixture/env/${key}`, observed_value: `C:/disposable/research-fixture/env/${key}`, host_value_deliberately_absent: true, evidence_ref: `EVID-ENV-${key}` }));
  const gitReads = [
    ['repository-local-core-hooksPath', 'local'], ['user-global-core-hooksPath', 'global'], ['system-core-hooksPath', 'system'],
    ['effective-repository-core-hooksPath', 'local > global > system'], ['nosystem-effective-core-hooksPath', 'system suppressed'],
    ['explicit-file-core-hooksPath', 'explicit file only'], ['installer-write-target', 'explicit file'], ['repository-local-preservation', 'unchanged'],
  ].map(([read, expected_origin], i) => ({ read, command: `git config --show-origin --get core.hooksPath # ${read}`, transcript_ref: `EVID-GIT-${i + 1}`, expected_origin, observed_origin: expected_origin, origin_proven: true, status: 'PASS' }));
  return {
    schema_version: 1,
    snapshot_kind: 'git-origin-path-authority',
    snapshot_id: 'SNAP-20260916-Q0-before-01',
    gate_id: 'Q0',
    overlay_gate: 'BM-1',
    package: 'R28',
    phase: 'before',
    release_candidate_id: 'candidate-test-01',
    captured_at: '2026-09-16T00:00:00Z',
    cwd: fixture,
    fixture_root: fixture,
    project_root: `${fixture}/project`,
    external_sentinel: { path: 'C:/disposable/research-sentinel/sentinel.txt', expected_sha256: HASH },
    platform: { os: 'windows', arch: 'x64', node_version: 'v22.0.0', git_version: '2.50.0' },
    producer: { id: 'alice', role: 'evidence-custodian' },
    independent_verifier: { id: 'bob', role: 'release-reviewer' },
    path_authority: [row],
    environment,
    git_origin: gitReads,
    artifact_diff: [{ relative_path: 'config/explicit.json', authority: 'explicit', before_mode: '0644', before_bytes: 10, before_sha256: HASH, after_mode: '0644', after_bytes: 10, after_sha256: HASH, difference_class: 'NO-CHANGE', expected: true, evidence_ref: 'EVID-DIFF-01' }],
    containment: { all_paths_contained: true, symlink_ancestor: false, external_sentinel_unchanged: true, host_state_touched: false, candidate_grader_boundary_preserved: true, before_after_manifest_sha256: HASH, recovery_result: null },
    status: 'PASS',
    notes: 'synthetic offline conformance record',
    envelope_canonical_sha256: HASH,
    ...overrides,
  };
}

test('path-authority schema accepts a complete snapshot envelope and self-excluding hash', async () => {
  const { canonicalEnvelopeHash, validatePathAuthoritySnapshot } = await import('../lib/path-authority-validator.mjs');
  const snapshot = validSnapshot();
  snapshot.envelope_canonical_sha256 = canonicalEnvelopeHash(snapshot);
  const result = validatePathAuthoritySnapshot(snapshot);
  assertEqual(result.status, 'PASS', JSON.stringify(result));
  assertEqual(result.envelopeCanonicalSha256, snapshot.envelope_canonical_sha256);
});

test('path-authority validator rejects unknown keys, gate/package drift, and duplicate rows', async () => {
  const { validatePathAuthoritySnapshot } = await import('../lib/path-authority-validator.mjs');
  const unknown = validSnapshot({ extra: true });
  let result = validatePathAuthoritySnapshot(unknown);
  assertEqual(result.status, 'FAIL', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'SCHEMA-ADDITIONAL'), JSON.stringify(result.errors));
  result = validatePathAuthoritySnapshot(validSnapshot({ package: 'R29' }));
  assert(result.errors.some((error) => error.code === 'SNAP-GATE-PACKAGE'), JSON.stringify(result.errors));
  const duplicate = validSnapshot({ path_authority: [validSnapshot().path_authority[0], validSnapshot().path_authority[0]] });
  result = validatePathAuthoritySnapshot(duplicate);
  assert(result.errors.some((error) => error.code === 'SNAP-DUPLICATE-SETTING'), JSON.stringify(result.errors));
});

test('path-authority validator rejects out-of-root paths, symlink claims, host mutation, and unproven origins', async () => {
  const { validatePathAuthoritySnapshot } = await import('../lib/path-authority-validator.mjs');
  const bad = validSnapshot({
    path_authority: [{ ...validSnapshot().path_authority[0], observed_path: 'C:/Users/Real User/profile.json', realpath: 'C:/Users/Real User/profile.json', contained: false, status: 'FAIL' }],
    containment: { ...validSnapshot().containment, all_paths_contained: false, symlink_ancestor: true, host_state_touched: true },
    git_origin: validSnapshot().git_origin.map((row) => ({ ...row, origin_proven: false, status: 'INCOMPLETE' })),
    status: 'FAIL',
  });
  const result = validatePathAuthoritySnapshot(bad);
  assert(result.errors.some((error) => error.code === 'SNAP-PATH-CONTAINMENT'), JSON.stringify(result.errors));
  assert(result.errors.some((error) => error.code === 'SNAP-HOST-MUTATION'), JSON.stringify(result.errors));
  assert(result.errors.some((error) => error.code === 'SNAP-ORIGIN-UNPROVEN'), JSON.stringify(result.errors));
});

test('path-authority names a missing value before validating any input', () => {
  for (const flag of ['--file', '--schema', '--root']) {
    for (const tail of [[], ['--json']]) {
      const args = ['fetchproof/bin/path-authority.mjs', 'validate', flag, ...tail];
      const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
      const output = `${run.stdout}${run.stderr}`;
      assertEqual(run.status, 2, `${args.join(' ')}: ${output}`);
      assert(run.stderr.includes(`${flag} needs a value`), output);
      assert(run.stderr.includes('Usage:'), output);
      assert(!/TypeError|paths\[0\]|ERR_INVALID_ARG_TYPE/.test(output), output);
    }
  }
});

test('path-authority CLI conform and validate are offline, deterministic, and read-only', async () => {
  const root = tempRoot();
  try {
    const snapshotFile = path.join(root, 'snapshot.json');
    const snapshot = validSnapshot();
    const { canonicalEnvelopeHash } = await import('../lib/path-authority-validator.mjs');
    snapshot.envelope_canonical_sha256 = canonicalEnvelopeHash(snapshot);
    fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    const schema = path.resolve('fetchproof/schemas/git-origin-path-authority-snapshot.schema.json');
    const before = fs.readFileSync(snapshotFile, 'utf8');
    let run = spawnSync(process.execPath, ['fetchproof/bin/path-authority.mjs', 'conform', '--schema', schema, '--file', snapshotFile, '--json'], { encoding: 'utf8' });
    assertEqual(run.status, 0, run.stderr || run.stdout);
    assertEqual(JSON.parse(run.stdout).status, 'PASS');
    run = spawnSync(process.execPath, ['fetchproof/bin/path-authority.mjs', 'validate', '--file', snapshotFile, '--json'], { encoding: 'utf8' });
    assertEqual(run.status, 0, run.stderr || run.stdout);
    assertEqual(JSON.parse(run.stdout).status, 'PASS');
    assertEqual(fs.readFileSync(snapshotFile, 'utf8'), before, 'validator must be read-only');
  } finally {
    cleanup(root);
  }
});

test('path-authority conform is schema-only while validate applies semantic gate rules', async () => {
  const root = tempRoot();
  try {
    const { canonicalEnvelopeHash, runPathAuthorityConformance, validatePathAuthoritySnapshot } = await import('../lib/path-authority-validator.mjs');
    const snapshot = validSnapshot({ package: 'R29' });
    snapshot.envelope_canonical_sha256 = canonicalEnvelopeHash(snapshot);
    const file = path.join(root, 'snapshot.json');
    fs.writeFileSync(file, `${JSON.stringify(snapshot)}\n`, 'utf8');
    const schema = path.resolve('fetchproof/schemas/git-origin-path-authority-snapshot.schema.json');
    assertEqual(runPathAuthorityConformance({ files: [file], schemaPath: schema }).status, 'PASS');
    assertEqual(validatePathAuthoritySnapshot(snapshot, { schemaPath: schema }).status, 'FAIL');
  } finally {
    cleanup(root);
  }
});

// #340 (2026-10-17): a section holding a non-object row, or a section that is not an
// array, made the semantic pass throw ("Cannot read properties of null", "...entries is
// not a function") after the schema pass had already judged it, and the CLI labelled the
// throw JSON-READ, INCOMPLETE, exit 2 - for a document that was read and found invalid,
// where `conform` on the same file says FAIL, exit 1.
test('path-authority validate judges a null row or a non-array section FAIL, from the library and the CLI', async () => {
  const root = tempRoot();
  try {
    const { canonicalEnvelopeHash, validatePathAuthoritySnapshot } = await import('../lib/path-authority-validator.mjs');
    const cases = [
      ['path_authority', [null]], ['path_authority', {}], ['environment', 'x'],
      ['git_origin', [null]], ['artifact_diff', [null]], ['path_authority', [7, 'row']],
    ];
    for (const [section, value] of cases) {
      const label = `${section}: ${JSON.stringify(value)}`;
      const snapshot = validSnapshot({ [section]: value });
      snapshot.envelope_canonical_sha256 = canonicalEnvelopeHash(snapshot);
      let result;
      try { result = validatePathAuthoritySnapshot(snapshot); } catch (error) { assert(false, `${label} threw ${error.stack}`); }
      assertEqual(result.status, 'FAIL', `${label}: ${JSON.stringify(result)}`);
      assert(result.errors.some((error) => error.code === 'SCHEMA-TYPE'), `${label}: ${JSON.stringify(result.errors)}`);
      const file = path.join(root, 'snapshot.json');
      fs.writeFileSync(file, `${JSON.stringify(snapshot)}\n`, 'utf8');
      const run = spawnSync(process.execPath, ['fetchproof/bin/path-authority.mjs', 'validate', '--file', file, '--json'], { encoding: 'utf8' });
      assertEqual(run.status, 1, `${label}: ${run.stderr || run.stdout}`);
      const report = JSON.parse(run.stdout);
      assertEqual(report.status, 'FAIL', label);
      assert(!report.errors.some((error) => error.code === 'JSON-READ'), `${label}: ${run.stdout}`);
    }
  } finally {
    cleanup(root);
  }
});

// The other half of #340: the CLI's read catch covers the read alone, so a file that is
// not JSON is still JSON-READ, INCOMPLETE, exit 2; a throw from validation itself (here a
// malformed schema) is the separate VALIDATE-ERROR, never a read error.
test('path-authority validate reports an unreadable file as JSON-READ and a validator throw apart from it', () => {
  const root = tempRoot();
  try {
    const file = path.join(root, 'snapshot.json');
    fs.writeFileSync(file, '{"schema_version":', 'utf8');
    let run = spawnSync(process.execPath, ['fetchproof/bin/path-authority.mjs', 'validate', '--file', file, '--json'], { encoding: 'utf8' });
    assertEqual(run.status, 2, run.stderr || run.stdout);
    let report = JSON.parse(run.stdout);
    assertEqual(report.status, 'INCOMPLETE');
    assertEqual(report.errors[0]?.code, 'JSON-READ', run.stdout);
    fs.writeFileSync(file, JSON.stringify(validSnapshot()), 'utf8');
    const schema = path.join(root, 'bad.schema.json');
    fs.writeFileSync(schema, '{"enum":5}', 'utf8');
    run = spawnSync(process.execPath, ['fetchproof/bin/path-authority.mjs', 'validate', '--file', file, '--schema', schema, '--json'], { encoding: 'utf8' });
    assertEqual(run.status, 2, run.stderr || run.stdout);
    report = JSON.parse(run.stdout);
    assertEqual(report.status, 'INCOMPLETE');
    assertEqual(report.errors[0]?.code, 'VALIDATE-ERROR', run.stdout);
  } finally {
    cleanup(root);
  }
});

// Review of #340 (2026-10-18): `conform` - path-authority's and researcher-release's -
// crashed with a stack and exit 1 on a lone surrogate in an enum field, because the
// schema subset's canonical comparison refuses it by throwing. Both report a FAIL finding.
test('both conform commands report a lone surrogate in an enum field as FAIL, never a stack', () => {
  const root = tempRoot();
  try {
    const file = path.join(root, 'snapshot.json');
    fs.writeFileSync(file, JSON.stringify(validSnapshot({ status: '\ud800' })), 'utf8');
    const schema = path.resolve('fetchproof/schemas/git-origin-path-authority-snapshot.schema.json');
    for (const [bin, code] of [['path-authority.mjs', 'SNAP-CANONICAL'], ['researcher-release.mjs', 'SCHEMA-CANONICAL']]) {
      const run = spawnSync(process.execPath, [`fetchproof/bin/${bin}`, 'conform', '--schema', schema, '--file', file, '--json'], { encoding: 'utf8' });
      assert(!/at .*\.mjs:\d+/.test(run.stderr), `${bin} crashed:\n${run.stderr.slice(-400)}`);
      let report;
      try { report = JSON.parse(run.stdout); } catch { assert(false, `${bin}: stdout is not JSON:\n${run.stdout}`); }
      assertEqual(report.status, 'FAIL', `${bin}: ${run.stdout}`);
      assertEqual(run.status, 1, bin);
      assert(report.errors.some((error) => error.code === code), `${bin}: ${run.stdout}`);
    }
  } finally {
    cleanup(root);
  }
});

// Review of the #340 fix (2026-10-18): with the CLI's catch narrowed to the read, every
// input the validator still threw on crashed with a stack and exit 1 - FAIL's code - and
// nothing on stdout: a lone surrogate (canonical JSON refuses it, in the envelope hash and
// in an enum comparison) and a member that cannot become a string (an object whose
// toString is not callable, read by a regex or a message template). The library returns a
// verdict for each, and the CLI prints it.
test('path-authority validate returns a verdict for values that cannot be canonicalised or stringified', async () => {
  const root = tempRoot();
  try {
    const { validatePathAuthoritySnapshot } = await import('../lib/path-authority-validator.mjs');
    const hostile = { toString: 1 };
    const cases = [
      ['a lone surrogate in notes', validSnapshot({ notes: '\ud800' })],
      ['a lone surrogate in an enum field', validSnapshot({ status: '\ud800' })],
      ['an unstringifiable captured_at', validSnapshot({ captured_at: hostile })],
      ['an unstringifiable gate_id', validSnapshot({ gate_id: hostile })],
      ['an unstringifiable envelope hash', validSnapshot({ envelope_canonical_sha256: hostile })],
      ['an unstringifiable row setting', validSnapshot({ path_authority: [{ ...validSnapshot().path_authority[0], setting: hostile }] })],
      ['unstringifiable row keys', validSnapshot({
        environment: [{ ...validSnapshot().environment[0], key: hostile }],
        git_origin: [{ ...validSnapshot().git_origin[0], read: hostile }],
        artifact_diff: [{ ...validSnapshot().artifact_diff[0], relative_path: hostile, expected: false }],
      })],
    ];
    for (const [label, snapshot] of cases) {
      let result;
      try { result = validatePathAuthoritySnapshot(snapshot); } catch (error) { assert(false, `${label} threw ${error.stack}`); }
      assertEqual(result.status, 'FAIL', `${label}: ${JSON.stringify(result)}`);
      const file = path.join(root, 'snapshot.json');
      fs.writeFileSync(file, JSON.stringify(snapshot), 'utf8');
      const run = spawnSync(process.execPath, ['fetchproof/bin/path-authority.mjs', 'validate', '--file', file, '--json'], { encoding: 'utf8' });
      let report;
      try { report = JSON.parse(run.stdout); } catch { assert(false, `${label}: stdout is not JSON:\n${run.stdout}${run.stderr.slice(-400)}`); }
      assertEqual(report.status, 'FAIL', `${label}: ${run.stdout}`);
      assertEqual(run.status, 1, `${label}: ${run.stderr}`);
    }
    const surrogate = validatePathAuthoritySnapshot(validSnapshot({ notes: '\ud800' }));
    assert(surrogate.errors.some((error) => error.code === 'SNAP-ENVELOPE-HASH'), JSON.stringify(surrogate.errors));
    // The schema subset still refuses the value by throwing (the FI runners rely on it);
    // the snapshot validator turns that refusal into a FAIL finding.
    const inEnum = validatePathAuthoritySnapshot(validSnapshot({ status: '\ud800' }));
    assert(inEnum.errors.some((error) => error.code === 'SNAP-CANONICAL'), JSON.stringify(inEnum.errors));
  } finally {
    cleanup(root);
  }
});
