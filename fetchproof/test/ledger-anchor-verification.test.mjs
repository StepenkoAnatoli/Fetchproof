// Signed genesis/checkpoint verification for rotated ledger segments.
import crypto from 'node:crypto';
import { test, describe, assert, assertEqual } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('ledger-anchor-verification');

const HASH = 'a'.repeat(64);
const ZERO = '0'.repeat(64);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function signedGenesis(privateKey) {
  const genesis = {
    ledgerVersion: '1.0.0', releaseId: 'release-1', benchmarkSpecVersion: '1.0.0',
    benchmarkSpecSha256: HASH, registrySha256: 'b'.repeat(64), roleRosterSha256: 'c'.repeat(64),
    externalRoots: { R26: 'd'.repeat(64), R27: 'e'.repeat(64), G3: 'f'.repeat(64) },
    genesisHash: '', signerKeyId: 'release-key', signature: '',
  };
  const unsigned = { ...genesis }; delete unsigned.genesisHash; delete unsigned.signature;
  genesis.genesisHash = digest(canonical(unsigned));
  genesis.signature = crypto.sign(null, Buffer.from(genesis.genesisHash, 'hex'), privateKey).toString('base64url');
  return genesis;
}

function signedCheckpoint(privateKey, genesisHash, chainHash = '1'.repeat(64)) {
  const checkpoint = {
    ledgerVersion: '1.0.0', releaseId: 'release-1', segment: '00000001.qlog', byteOffset: 128,
    physicalSequence: 1, chainHash, lastCommittedEventHash: null, snapshotHash: '2'.repeat(64),
    genesisHash, checkpointHash: '', signerKeyId: 'release-key', signature: '',
  };
  const unsigned = { ...checkpoint }; delete unsigned.checkpointHash; delete unsigned.signature;
  checkpoint.checkpointHash = digest(canonical(unsigned));
  checkpoint.signature = crypto.sign(null, Buffer.from(checkpoint.checkpointHash, 'hex'), privateKey).toString('base64url');
  return checkpoint;
}

test('signed genesis and rotated checkpoint anchors verify against the supplied key', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const { verifyLedgerAnchors } = await import('../lib/release-validator.mjs');
  const genesis = signedGenesis(privateKey);
  const checkpoint = signedCheckpoint(privateKey, genesis.genesisHash);
  const result = verifyLedgerAnchors({ genesis, checkpoints: [checkpoint], publicKeys: { 'release-key': publicKey }, records: [{ chainHash: checkpoint.chainHash, physicalSequence: 1 }] });
  assertEqual(result.status, 'PASS', JSON.stringify(result));
});

test('anchor verification rejects a tampered genesis signature and checkpoint rotation link', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const { verifyLedgerAnchors } = await import('../lib/release-validator.mjs');
  const genesis = signedGenesis(privateKey);
  genesis.signature = Buffer.from('tampered').toString('base64url');
  const checkpoint = signedCheckpoint(privateKey, genesis.genesisHash, '9'.repeat(64));
  const result = verifyLedgerAnchors({ genesis, checkpoints: [checkpoint], publicKeys: { 'release-key': publicKey }, records: [{ chainHash: '1'.repeat(64), physicalSequence: 1 }] });
  assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'LEDGER-GENESIS-SIGNATURE'), JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'LEDGER-CHECKPOINT-LINK'), JSON.stringify(result));
});

test('rotated checkpoints reject duplicate sequence numbers and hash drift', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const { verifyLedgerAnchors } = await import('../lib/release-validator.mjs');
  const genesis = signedGenesis(privateKey);
  const first = signedCheckpoint(privateKey, genesis.genesisHash, '1'.repeat(64));
  const second = signedCheckpoint(privateKey, genesis.genesisHash, '3'.repeat(64));
  second.physicalSequence = 1;
  second.checkpointHash = HASH;
  const result = verifyLedgerAnchors({ genesis, checkpoints: [first, second], publicKeys: { 'release-key': publicKey }, records: [{ chainHash: first.chainHash, physicalSequence: 1 }] });
  assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'LEDGER-CHECKPOINT-DUPLICATE'), JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'LEDGER-CHECKPOINT-HASH'), JSON.stringify(result));
});
