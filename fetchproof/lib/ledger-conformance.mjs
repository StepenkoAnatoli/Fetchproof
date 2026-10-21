// Offline cross-language qualification-ledger conformance runner.
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  canonicalJson,
  parseJsonNoDuplicates,
  qualificationChainHash,
  sha256,
} from './release-validator.mjs';

export const LEDGER_CONFORMANCE_PROFILE = 'researcher-benchmark-c14n-v1';
export const LEDGER_CONFORMANCE_VERSION = '1.0.0';
const HEX = /^[0-9a-f]+$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function packetError(message) {
  const error = new Error(`invalid qualification-ledger vector packet: ${message}`);
  error.code = 'VECTOR-PACKET';
  return error;
}

function validHex(value, bytes) {
  return typeof value === 'string' && value.length === bytes * 2 && HEX.test(value);
}

function base64urlBytes(value) {
  if (typeof value !== 'string' || !BASE64URL.test(value) || value.length % 4 === 1) throw new Error('signature is not unpadded base64url');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('signature is not canonical base64url');
  return decoded;
}

function omitted(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw packetError('self-excluding vector value must be an object');
  if (!Array.isArray(fields) || !fields.length || fields.some((field) => typeof field !== 'string' || !field)) throw packetError('self-excluding vector needs omitFields');
  const copy = { ...value };
  for (const field of fields) delete copy[field];
  return copy;
}

function hashRow(vector, canonical) {
  const digest = sha256(canonical);
  const bytesHex = Buffer.from(canonical, 'utf8').toString('hex');
  const matches = canonical === vector.expectedCanonical && digest === vector.expectedSha256;
  return {
    vectorId: vector.vectorId,
    kind: vector.kind,
    result: matches ? 'PASS' : 'FAIL',
    canonicalBytesHex: bytesHex,
    sha256: digest,
    signatureValid: null,
    reason: matches ? '' : 'hash.mismatch',
  };
}

function ed25519Row(vector) {
  let valid = false;
  try {
    if (!validHex(vector.messageHex, 32) || !validHex(vector.publicKeyHex, 32)) throw new Error('message or public key is not fixed-width lowercase hex');
    const signature = base64urlBytes(vector.signature);
    if (signature.length !== 64) throw new Error('Ed25519 signature must be 64 bytes');
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(vector.publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    valid = crypto.verify(null, Buffer.from(vector.messageHex, 'hex'), key, signature);
  } catch {
    valid = false;
  }
  const observedReason = valid ? '' : 'signature.invalid';
  const expectedResult = vector.expectedResult ?? 'PASS';
  const expectedReason = vector.expectedReason ?? '';
  const matches = expectedResult === 'FAIL'
    ? !valid && observedReason === expectedReason
    : expectedResult === 'PASS' && valid && expectedReason === '';
  return {
    vectorId: vector.vectorId,
    kind: vector.kind,
    result: matches ? 'PASS' : 'FAIL',
    canonicalBytesHex: vector.messageHex ?? null,
    sha256: null,
    signatureValid: valid,
    reason: observedReason,
  };
}

function runVector(vector) {
  if (!vector || typeof vector !== 'object' || Array.isArray(vector) || typeof vector.vectorId !== 'string' || !vector.vectorId || typeof vector.kind !== 'string') throw packetError('each vector needs vectorId and kind');
  if (vector.kind === 'canonical-json') return hashRow(vector, canonicalJson(vector.value));
  if (vector.kind === 'canonical-float') {
    // See the matching note in bin/ledger_conformance.py. Only "normalize" is
    // expressible: this side has one number type, so `1.0` has already become `1` by
    // the time the packet is parsed, and a "reject" vector would pass here for a
    // reason unrelated to the policy it claims to test.
    if (vector.floatPolicy !== 'normalize') throw packetError(`${vector.vectorId} must declare floatPolicy "normalize"`);
    return hashRow(vector, canonicalJson(vector.value));
  }
  if (vector.kind === 'self-excluding-hash') return hashRow(vector, canonicalJson(omitted(vector.value, vector.omitFields)));
  if (vector.kind === 'chain-hash') {
    if (!validHex(vector.recordHash, 32) || !validHex(vector.prevChainHash, 32) || !Number.isInteger(vector.physicalSequence) || vector.physicalSequence < 1) throw packetError(`${vector.vectorId} has invalid chain fields`);
    const record = { recordHash: vector.recordHash, prevChainHash: vector.prevChainHash, physicalSequence: vector.physicalSequence };
    const canonical = `benchmark-ledger-chain-v1\0${record.recordHash}\0${record.prevChainHash}\0${record.physicalSequence}`;
    const row = hashRow(vector, canonical);
    if (qualificationChainHash(record) !== row.sha256) return { ...row, result: 'FAIL', reason: 'chain.implementation-mismatch' };
    return row;
  }
  if (vector.kind === 'ed25519') return ed25519Row(vector);
  throw packetError(`unknown vector kind ${vector.kind}`);
}

export function loadLedgerVectors(file) {
  let raw;
  let parsed;
  try {
    raw = fs.readFileSync(file);
    parsed = parseJsonNoDuplicates(raw.toString('utf8'));
  }
  catch (error) { throw packetError(error.message); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw packetError('packet must be an object');
  if (parsed.packetVersion !== LEDGER_CONFORMANCE_VERSION) throw packetError(`packetVersion must be ${LEDGER_CONFORMANCE_VERSION}`);
  if (parsed.profile !== LEDGER_CONFORMANCE_PROFILE) throw packetError(`profile must be ${LEDGER_CONFORMANCE_PROFILE}`);
  if (parsed.signatureAlgorithm !== 'Ed25519' || parsed.signatureEncoding !== 'base64url-no-padding') throw packetError('signature profile must be Ed25519/base64url-no-padding');
  if (!Array.isArray(parsed.vectors) || parsed.vectors.length === 0) throw packetError('vectors must be a non-empty array');
  const ids = new Set();
  for (const vector of parsed.vectors) {
    if (!vector || typeof vector.vectorId !== 'string' || !vector.vectorId || ids.has(vector.vectorId)) throw packetError('vector IDs must be present and unique');
    ids.add(vector.vectorId);
  }
  Object.defineProperty(parsed, '__vectorPacketSha256', { value: crypto.createHash('sha256').update(raw).digest('hex'), enumerable: false });
  return parsed;
}

export function runLedgerConformance(packet) {
  if (!packet || packet.profile !== LEDGER_CONFORMANCE_PROFILE || !Array.isArray(packet.vectors)) throw packetError('packet profile or vector list is invalid');
  const vectors = packet.vectors.map(runVector);
  const report = {
    validatorVersion: LEDGER_CONFORMANCE_VERSION,
    profile: LEDGER_CONFORMANCE_PROFILE,
    vectorPacketSha256: packet.__vectorPacketSha256 ?? null,
    implementation: { language: 'node', runtime: process.version },
    vectorCount: vectors.length,
    status: vectors.every((vector) => vector.result === 'PASS') ? 'PASS' : 'FAIL',
    vectors,
  };
  return { ...report, reportSha256: sha256(canonicalJson(report)) };
}

export function canonicalReportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
