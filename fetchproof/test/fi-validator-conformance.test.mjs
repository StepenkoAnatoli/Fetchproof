// Fixture-free FI validator conformance matrix.
// The matrix is an executable contract for the eventual workbook/evidence validator:
// mutations are synthesized in memory, and no benchmark fixture, source, credential,
// network, or paid transport is used.
import fs from 'node:fs';
import path from 'node:path';
import { test, describe, assert, assertEqual } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('fi-validator-conformance');
import { validateJsonSchema } from '../lib/release-validator.mjs';

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const FI_IDS = Array.from({ length: 30 }, (_, index) => `FI-${String(index + 1).padStart(2, '0')}`);
const SIDEcar_SCHEMA = JSON.parse(fs.readFileSync(path.resolve('fetchproof/schemas/fi-signoff-sidecar.schema.json'), 'utf8'));
const MANIFEST_SCHEMA = JSON.parse(fs.readFileSync(path.resolve('fetchproof/schemas/fi-evidence-manifest.schema.json'), 'utf8'));

function sidecar() {
  return {
    recordVersion: '1.0.0', fiId: 'FI-01', workbookPath: 'records/completed.xlsx', workbookSha256: HASH,
    packetVersion: '1.0.0', packetSha256: HASH, matrixVersion: '1.0.0', matrixSha256: HASH,
    identity: {
      releaseCandidateId: 'rc-1', disposableMachineId: 'machine-1', machineRole: 'reviewer',
      reviewCwd: 'C:\\work\\repo', rootRelativeCwd: 'review', cwdContainmentProofEvidenceId: 'FI-01-cwd',
      operatorPrincipalId: 'operator-1', operatorStartedAt: '2026-09-16T10:00:00Z',
      operatorFinishedAt: '2026-09-16T10:05:00Z', independentReviewerPrincipalId: 'verifier-1',
      independentReviewerAt: '2026-09-16T10:06:00Z',
    },
    traceability: { artifactRows: 'Cross-cutting snapshot/manifest', repairPackage: 'R6', migrationGate: 'M1', releaseConsequence: 'G4' },
    expectedOutcomeCode: 'REFUSE-FUTURE-SCHEMA', observedOutcomeCode: 'REFUSE-FUTURE-SCHEMA',
    fields: [{ label: 'Observed status', entrySha256: HASH, evidenceIds: ['FI-01-status'], evidenceHashes: [HASH] }],
    containment: { network: 'NOT-ATTEMPTED', credentials: 'NOT-ATTEMPTED', paidCredits: 'NOT-ATTEMPTED', fixtureCreation: 'NOT-ATTEMPTED', proofEvidenceIds: ['FI-01-containment'] },
    status: 'PASS', statusReasonSha256: null,
    rollback: { targetHash: null, receiptEvidenceId: null, descendantClosureHash: null },
    signatures: {
      reviewer: { principalId: 'reviewer-1', role: 'fi-reviewer', signerKeyId: 'key-1', signedAt: '2026-09-16T10:07:00Z', statementSha256: HASH, signature: 'A'.repeat(86) },
      independentVerifier: { principalId: 'verifier-1', role: 'fi-independent-verifier', signerKeyId: 'key-2', signedAt: '2026-09-16T10:08:00Z', statementSha256: HASH, signature: 'A'.repeat(86) },
    },
  };
}

function manifest() {
  return {
    manifestVersion: '1.0.0', root: 'release-evidence', entries: [{
      evidenceId: 'FI-01-status', fiId: 'FI-01', fieldLabel: 'Observed status', artifactId: 'FI-01-record',
      path: 'evidence/FI-01-status.json', profile: 'researcher-benchmark-c14n-v1-json', byteLength: 12,
      sha256: HASH, predecessorEvidenceIds: [],
    }],
  };
}

function baseline() {
  return {
    sheets: [...FI_IDS],
    workbookTrusted: true,
    matrixRepairPackage: 'R6',
    expectedHandling: 'Expected safe handling',
    indexStatus: 'PASS',
    workbookStatus: 'PASS',
    sidecar: sidecar(),
    manifest: manifest(),
    evidenceBytesHash: HASH,
    containment: { network: 'NOT-ATTEMPTED', credentials: 'NOT-ATTEMPTED', paidCredits: 'NOT-ATTEMPTED', fixtureCreation: 'NOT-ATTEMPTED' },
    containmentProofs: ['proof-1'],
    reviewerPrincipalId: 'reviewer-1', verifierPrincipalId: 'verifier-1', verifierKeyExpired: false,
    predecessorStatus: 'PASS', descendantStatus: 'PASS',
    expectedOutcomeCode: 'REFUSE-FUTURE-SCHEMA', observedOutcomeCode: 'REFUSE-FUTURE-SCHEMA',
  };
}

const CASES = [
  { id: 'CF-01', mutation: 'Remove FI-17 sheet', expectedCode: 'WB-SHEET-ID', result: 'FAIL', mutate: (b) => { b.sheets = b.sheets.filter((id) => id !== 'FI-17'); }, probe: (b) => !b.sheets.includes('FI-17') },
  { id: 'CF-02', mutation: 'Rename or duplicate an FI sheet', expectedCode: 'WB-SHEET-ID', result: 'FAIL', mutate: (b) => { b.sheets[16] = 'FI-18'; }, probe: (b) => new Set(b.sheets).size !== b.sheets.length },
  { id: 'CF-03', mutation: 'Hide a case sheet or add a macro/external link', expectedCode: 'WB-PACKAGE-UNTRUSTED', result: 'FAIL', mutate: (b) => { b.workbookTrusted = false; }, probe: (b) => b.workbookTrusted === false },
  { id: 'CF-04', mutation: 'Change a matrix repair package in one sheet', expectedCode: 'FI-TRACEABILITY-MISMATCH', result: 'FAIL', mutate: (b) => { b.matrixRepairPackage = 'R99'; }, probe: (b) => b.matrixRepairPackage !== 'R6' },
  { id: 'CF-05', mutation: 'Change the expected-safe-handling sentence', expectedCode: 'FI-EXPECTED-MISMATCH', result: 'FAIL', mutate: (b) => { b.expectedHandling = 'Paraphrased handling'; }, probe: (b) => b.expectedHandling !== 'Expected safe handling' },
  { id: 'CF-06', mutation: 'Change the Index status only', expectedCode: 'FI-INDEX-MISMATCH', result: 'FAIL', mutate: (b) => { b.indexStatus = 'FAIL'; }, probe: (b) => b.indexStatus !== b.workbookStatus },
  { id: 'CF-07', mutation: 'Remove an identity or evidence entry', expectedCode: 'FI-FIELD-MISSING', result: 'INCOMPLETE', mutate: (b) => { delete b.sidecar.identity; }, probe: (b) => !b.sidecar.identity },
  { id: 'CF-08', mutation: 'Replace a status with done or lowercase pass', expectedCode: 'STATUS-INVALID', result: 'FAIL', mutate: (b) => { b.sidecar.status = 'done'; }, probe: (b) => !['PASS', 'INCOMPLETE', 'FAIL', 'REOPEN', 'BLOCKED', 'ROLLED-BACK'].includes(b.sidecar.status) },
  { id: 'CF-09', mutation: 'Mark PASS while one evidence ID is absent', expectedCode: 'EVIDENCE-MISSING', result: 'INCOMPLETE', mutate: (b) => { b.sidecar.fields[0].evidenceIds = []; }, probe: (b) => b.sidecar.status === 'PASS' && b.sidecar.fields[0].evidenceIds.length === 0 },
  { id: 'CF-10', mutation: 'Use uppercase, shortened, or algorithm-prefixed SHA-256', expectedCode: 'HASH-FORMAT', result: 'FAIL', mutate: (b) => { b.sidecar.workbookSha256 = HASH.toUpperCase(); }, probe: (b) => !/^[0-9a-f]{64}$/.test(b.sidecar.workbookSha256) },
  { id: 'CF-11', mutation: 'Alter a manifest-named evidence byte', expectedCode: 'EVIDENCE-HASH', result: 'FAIL', mutate: (b) => { b.evidenceBytesHash = OTHER_HASH; }, probe: (b) => b.evidenceBytesHash !== b.manifest.entries[0].sha256 },
  { id: 'CF-12', mutation: 'Add traversal, absolute, UNC, or symlink-escaping evidence path', expectedCode: 'EVIDENCE-PATH', result: 'FAIL', mutate: (b) => { b.manifest.entries[0].path = '../outside.json'; }, probe: (b) => b.manifest.entries[0].path.startsWith('../') },
  { id: 'CF-13', mutation: 'Remove a network/credential/credit/fixture proof', expectedCode: 'CONTAINMENT-MISSING', result: 'INCOMPLETE', mutate: (b) => { b.containmentProofs = []; }, probe: (b) => b.containmentProofs.length === 0 },
  { id: 'CF-14', mutation: 'Record a prohibited paid request or credential read', expectedCode: 'CONTAINMENT-VIOLATION', result: 'FAIL', mutate: (b) => { b.containment.paidCredits = 'VIOLATION'; }, probe: (b) => b.containment.paidCredits === 'VIOLATION' },
  { id: 'CF-15', mutation: 'Change a sidecar entry hash or status without changing the workbook', expectedCode: 'FI-PROJECTION-MISMATCH', result: 'FAIL', mutate: (b) => { b.sidecar.fields[0].entrySha256 = OTHER_HASH; }, probe: (b) => b.sidecar.fields[0].entrySha256 !== b.sidecar.workbookSha256 },
  { id: 'CF-16', mutation: 'Copy the reviewer signature to the verifier or use an expired key', expectedCode: 'ROLE-COLLISION', result: 'FAIL', mutate: (b) => { b.verifierPrincipalId = b.reviewerPrincipalId; }, probe: (b) => b.verifierPrincipalId === b.reviewerPrincipalId || b.verifierKeyExpired },
  { id: 'CF-17', mutation: 'Mark ROLLED-BACK without a valid target/receipt/closure', expectedCode: 'ROLLBACK-EVIDENCE', result: 'BLOCKED', mutate: (b) => { b.sidecar.fiId = 'FI-06'; b.sidecar.status = 'ROLLED-BACK'; b.sidecar.rollback.targetHash = null; }, probe: (b) => b.sidecar.status === 'ROLLED-BACK' && b.sidecar.rollback.targetHash === null },
  { id: 'CF-18', mutation: 'Reopen a locked predecessor while leaving this case PASS', expectedCode: 'STATUS-PRECEDENCE', result: 'FAIL', mutate: (b) => { b.predecessorStatus = 'REOPEN'; }, probe: (b) => b.predecessorStatus !== 'PASS' && b.sidecar.status === 'PASS' },
  { id: 'CF-19', mutation: 'Replace the registered outcome code with prose', expectedCode: 'OUTCOME-INVALID', result: 'FAIL', mutate: (b) => { b.sidecar.observedOutcomeCode = 'the validator refused it'; }, probe: (b) => !/^[A-Z0-9-]+$/.test(b.sidecar.observedOutcomeCode) },
  { id: 'CF-20', mutation: 'Validate the same bundle twice with the same at time', expectedCode: 'BYTE-IDENTICAL', result: 'PASS', deterministic: true, mutate: (b) => b, probe: (b, again) => JSON.stringify(b) === JSON.stringify(again) },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function schemaErrors(value, schema) {
  return validateJsonSchema(value, schema, { errors: [] });
}

test('FI conformance matrix contains every documented mutation exactly once', async () => {
  assertEqual(CASES.length, 20);
  assertEqual(new Set(CASES.map((row) => row.id)).size, CASES.length);
  for (const row of CASES) {
    assert(row.mutation && row.expectedCode && row.result && typeof row.mutate === 'function' && typeof row.probe === 'function', row.id);
  }
});

test('every FI conformance mutation executes deterministically without filesystem fixtures', async () => {
  for (const row of CASES) {
    const first = clone(baseline());
    const second = clone(baseline());
    row.mutate(first);
    row.mutate(second);
    assert(row.probe(first, second), `${row.id}: ${row.mutation}`);
    assertEqual(JSON.stringify(first), JSON.stringify(second), `${row.id} is not deterministic`);
  }
});

test('schema-backed FI mutations produce executable strict-schema failures', async () => {
  const checks = [
    { id: 'CF-07', value: (() => { const v = sidecar(); delete v.identity; return v; })(), schema: SIDEcar_SCHEMA, code: 'SCHEMA-REQUIRED' },
    { id: 'CF-08', value: (() => { const v = sidecar(); v.status = 'done'; return v; })(), schema: SIDEcar_SCHEMA, code: 'SCHEMA-ENUM' },
    { id: 'CF-09', value: (() => { const v = sidecar(); v.fields[0].evidenceIds = []; return v; })(), schema: SIDEcar_SCHEMA, code: 'SCHEMA-MIN-ITEMS' },
    { id: 'CF-10', value: (() => { const v = sidecar(); v.workbookSha256 = HASH.toUpperCase(); return v; })(), schema: SIDEcar_SCHEMA, code: 'SCHEMA-PATTERN' },
    { id: 'CF-12', value: (() => { const v = manifest(); v.entries[0].path = '../outside.json'; return v; })(), schema: MANIFEST_SCHEMA, code: 'SCHEMA-PATTERN' },
    { id: 'CF-17', value: (() => { const v = sidecar(); v.fiId = 'FI-06'; v.status = 'ROLLED-BACK'; v.rollback.targetHash = null; return v; })(), schema: SIDEcar_SCHEMA, code: 'SCHEMA-ONE-OF' },
    { id: 'CF-19', value: (() => { const v = sidecar(); v.observedOutcomeCode = 'the validator refused it'; return v; })(), schema: SIDEcar_SCHEMA, code: 'SCHEMA-ENUM' },
  ];
  for (const check of checks) {
    const errors = schemaErrors(check.value, check.schema);
    assert(errors.some((error) => error.code === check.code), `${check.id}: ${JSON.stringify(errors)}`);
  }
});

test('matrix preserves explicit nonzero outcomes and the sole deterministic PASS case', async () => {
  assert(CASES.filter((row) => row.result !== 'PASS').every((row) => row.expectedCode !== 'BYTE-IDENTICAL'));
  assertEqual(CASES.filter((row) => row.deterministic).map((row) => row.id).join(','), 'CF-20');
  assert(CASES.filter((row) => row.result === 'INCOMPLETE').length >= 2);
  assert(CASES.some((row) => row.result === 'BLOCKED' && row.expectedCode === 'ROLLBACK-EVIDENCE'));
});

export { CASES as FI_VALIDATOR_CONFORMANCE_CASES };
