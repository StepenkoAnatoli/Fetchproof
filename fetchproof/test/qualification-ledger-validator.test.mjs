// Signed qualification-ledger verification tests. These use only disposable,
// in-memory records and generated Ed25519 keys; no benchmark fixtures or
// network/paid transport are involved.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, describe, assert, assertEqual, tempDir } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('qualification-ledger-validator');

const ZERO = '0'.repeat(64);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function ledgerRecord({ physicalSequence, prevChainHash = ZERO, recordKind = 'promotion-commit', state = 'committed', packageName = 'R28', payload = {} }) {
  const record = {
    ledgerVersion: '1.0.0',
    physicalSequence,
    recordKind,
    txId: `tx-${physicalSequence}`,
    eventId: `event-${physicalSequence}`,
    package: packageName,
    artifactId: `${packageName}-04`,
    recordId: `record-${physicalSequence}`,
    benchmarkSpecVersion: '1.0.0',
    benchmarkSpecSha256: 'a'.repeat(64),
    roleRosterSha256: 'b'.repeat(64),
    actorId: 'ledger-owner',
    actorRole: 'evidence-custodian',
    createdAt: '2026-01-01T00:00:00.000Z',
    prevChainHash,
    payloadSha256: hash(canonical(payload)),
    recordHash: '',
    chainHash: '',
    state,
    payload,
  };
  const unsigned = { ...record };
  delete unsigned.recordHash;
  delete unsigned.chainHash;
  delete unsigned.signature;
  record.recordHash = hash(canonical(unsigned));
  record.chainHash = hash(`benchmark-ledger-chain-v1\0${record.recordHash}\0${record.prevChainHash}\0${record.physicalSequence}`);
  return record;
}

function signedPointer({ packageName = 'R28', targetArtifactId = `${packageName}-04`, targetHash = 'c'.repeat(64), promotionCommitHash, signerKeyId = 'release-key', state = 'ready', predecessorClosureHash = 'd'.repeat(64) }) {
  const pointer = {
    package: packageName,
    promotion: {
      state,
      package: packageName,
      generation: 1,
      targetArtifactId,
      targetHash,
      promotionCommitHash,
      predecessorClosureHash,
      requiredGate: 'Q0',
      publishedAt: '2026-01-01T00:00:00.000Z',
      previousPointerHash: null,
      revokedDescendantHashes: [],
    },
    pointerHash: '',
    signerKeyId,
    signature: '',
  };
  const unsigned = { ...pointer };
  delete unsigned.pointerHash;
  delete unsigned.signature;
  pointer.pointerHash = hash(canonical(unsigned));
  return pointer;
}

function signPointer(pointer, privateKey) {
  pointer.signature = crypto.sign(null, Buffer.from(pointer.pointerHash, 'hex'), privateKey).toString('base64url');
  return pointer;
}

test('signed promotion pointer resolves its committed promotion event and head', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = {
    package: 'R28',
    targetArtifactId: 'R28-04',
    targetHash: 'c'.repeat(64),
    predecessorClosureHash: 'd'.repeat(64),
  };
  const promotion = ledgerRecord({ physicalSequence: 1, payload });
  const pointer = signPointer(signedPointer({ promotionCommitHash: promotion.chainHash }), privateKey);
  const result = (await import('../lib/release-validator.mjs')).verifyQualificationLedger({
    records: [promotion],
    pointer,
    publicKeys: { 'release-key': publicKey },
    genesisHash: ZERO,
    head: {
      lastPhysicalChainHash: promotion.chainHash,
      lastCommittedEventHash: promotion.recordHash,
      physicalSequence: 1,
    },
  });
  assertEqual(result.status, 'PASS', JSON.stringify(result));
  assertEqual(result.promotionCommit.chainHash, promotion.chainHash);
});

test('qualification ledger verifies unpadded base64url signatures over raw pointer-hash bytes', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = {
    package: 'R28', targetArtifactId: 'R28-04', targetHash: 'c'.repeat(64), predecessorClosureHash: 'd'.repeat(64),
  };
  const promotion = ledgerRecord({ physicalSequence: 1, payload });
  const pointer = signedPointer({ promotionCommitHash: promotion.chainHash });
  pointer.signature = crypto.sign(null, Buffer.from(pointer.pointerHash, 'hex'), privateKey).toString('base64url');
  const result = (await import('../lib/release-validator.mjs')).verifyQualificationLedger({
    records: [promotion], pointer, publicKeys: { 'release-key': publicKey }, genesisHash: ZERO,
  });
  assertEqual(result.status, 'PASS', JSON.stringify(result));
});

test('qualification-ledger record schema is strict and canonical fields remain machine-checkable', async () => {
  const { runSchemaConformance } = await import('../lib/release-validator.mjs');
  const record = ledgerRecord({ physicalSequence: 1, payload: { operation: 'promotion' } });
  const file = `fetchproof/schemas/qualification-ledger-record.schema.json`;
  // Exercise the schema runner directly without writing a fixture file.
  const schema = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'));
  const good = (await import('../lib/release-validator.mjs')).validateJsonSchema(record, schema);
  assertEqual(good.length, 0, JSON.stringify(good));
  const bad = { ...record, unexpected: true };
  const errors = (await import('../lib/release-validator.mjs')).validateJsonSchema(bad, schema);
  assert(errors.some((error) => error.code === 'SCHEMA-ADDITIONAL'), JSON.stringify(errors));
});

test('qlog-path verification is read-only and preserves the authenticated bytes', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const promotion = ledgerRecord({ physicalSequence: 1, payload: { package: 'R28', targetArtifactId: 'R28-04', targetHash: 'c'.repeat(64), predecessorClosureHash: 'd'.repeat(64) } });
  const pointer = signPointer(signedPointer({ promotionCommitHash: promotion.chainHash }), privateKey);
  const root = tempDir('qualification-ledger-qlog-');
  const file = path.join(root, '00000001.qlog');
  try {
    fs.writeFileSync(file, `${JSON.stringify(promotion)}\n`, 'utf8');
    const before = fs.readFileSync(file);
    const result = (await import('../lib/release-validator.mjs')).verifyQualificationLedger({
      ledgerPath: file, pointer, publicKeys: { 'release-key': publicKey }, genesisHash: ZERO,
    });
    assertEqual(result.status, 'PASS', JSON.stringify(result));
    assert(before.equals(fs.readFileSync(file)), 'ledger verification must not rewrite qlog bytes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ledger verification fails closed for a missing promotion commit and unresolved prepare', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const prepare = ledgerRecord({ physicalSequence: 1, recordKind: 'prepare', state: 'pending', payload: { operation: 'promotion' } });
  const pointer = signPointer(signedPointer({ promotionCommitHash: 'e'.repeat(64) }), privateKey);
  const result = (await import('../lib/release-validator.mjs')).verifyQualificationLedger({
    records: [prepare],
    pointer,
    publicKeys: { 'release-key': publicKey },
    genesisHash: ZERO,
  });
  assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'LEDGER-PROMOTION-MISSING'), JSON.stringify(result.errors));
  assert(result.errors.some((error) => error.code === 'LEDGER-UNRESOLVED-PREPARE'), JSON.stringify(result.errors));
});

test('ledger verification rejects a tampered pointer signature even when the commit is present', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const promotion = ledgerRecord({ physicalSequence: 1, payload: { package: 'R28', targetArtifactId: 'R28-04', targetHash: 'c'.repeat(64), predecessorClosureHash: 'd'.repeat(64) } });
  const pointer = signPointer(signedPointer({ promotionCommitHash: promotion.chainHash }), privateKey);
  pointer.signature = Buffer.from('tampered').toString('base64url');
  const result = (await import('../lib/release-validator.mjs')).verifyQualificationLedger({
    records: [promotion], pointer, publicKeys: { 'release-key': publicKey }, genesisHash: ZERO,
  });
  assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'PTR-SIGNATURE'), JSON.stringify(result.errors));
});

test('stale head after a durable promotion commit is incomplete until recovery reconciles it', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const promotion = ledgerRecord({ physicalSequence: 1, payload: { package: 'R28', targetArtifactId: 'R28-04', targetHash: 'c'.repeat(64), predecessorClosureHash: 'd'.repeat(64) } });
  const pointer = signPointer(signedPointer({ promotionCommitHash: promotion.chainHash }), privateKey);
  const stale = (await import('../lib/release-validator.mjs')).verifyQualificationLedger({
    records: [promotion], pointer, publicKeys: { 'release-key': publicKey }, genesisHash: ZERO,
    head: { lastPhysicalChainHash: ZERO, lastCommittedEventHash: ZERO, physicalSequence: 0 },
  });
  assertEqual(stale.status, 'INCOMPLETE', JSON.stringify(stale));
  assert(stale.errors.some((error) => error.code === 'LEDGER-HEAD-MISMATCH'), JSON.stringify(stale.errors));
  const recovery = ledgerRecord({
    physicalSequence: 2,
    prevChainHash: promotion.chainHash,
    recordKind: 'recovery',
    state: 'recovered',
    payload: { action: 'rebuild-head', reconciledChainHash: promotion.chainHash, prepareRecordHash: null },
  });
  const recovered = (await import('../lib/release-validator.mjs')).verifyQualificationLedger({
    records: [promotion, recovery], pointer, publicKeys: { 'release-key': publicKey }, genesisHash: ZERO,
    head: { lastPhysicalChainHash: recovery.chainHash, lastCommittedEventHash: promotion.recordHash, physicalSequence: 2 },
  });
  assertEqual(recovered.status, 'PASS', JSON.stringify(recovered));
});
