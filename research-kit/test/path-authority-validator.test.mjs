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
  return tempDir('research-kit-path-authority-');
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
  const environment = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'RESEARCH_KIT_HOME', 'RESEARCH_KIT_CONFIG', 'RESEARCH_KIT_INSTALL_STATE', 'RESEARCH_KIT_EDIT_GATE_SETTINGS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']
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
      const args = ['research-kit/bin/path-authority.mjs', 'validate', flag, ...tail];
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
    const schema = path.resolve('research-kit/schemas/git-origin-path-authority-snapshot.schema.json');
    const before = fs.readFileSync(snapshotFile, 'utf8');
    let run = spawnSync(process.execPath, ['research-kit/bin/path-authority.mjs', 'conform', '--schema', schema, '--file', snapshotFile, '--json'], { encoding: 'utf8' });
    assertEqual(run.status, 0, run.stderr || run.stdout);
    assertEqual(JSON.parse(run.stdout).status, 'PASS');
    run = spawnSync(process.execPath, ['research-kit/bin/path-authority.mjs', 'validate', '--file', snapshotFile, '--json'], { encoding: 'utf8' });
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
    const schema = path.resolve('research-kit/schemas/git-origin-path-authority-snapshot.schema.json');
    assertEqual(runPathAuthorityConformance({ files: [file], schemaPath: schema }).status, 'PASS');
    assertEqual(validatePathAuthoritySnapshot(snapshot, { schemaPath: schema }).status, 'FAIL');
  } finally {
    cleanup(root);
  }
});
