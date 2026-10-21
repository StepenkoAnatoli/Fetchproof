// Offline conformance runner for exported synthetic property graph/hash vectors.
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  canonicalJson,
  computeDescendantInvalidation,
  parseJsonNoDuplicates,
  qualificationChainHash,
  qualificationRecordHash,
  sha256,
} from './release-validator.mjs';

export const PROPERTY_VECTOR_PROFILE = 'researcher-property-vector-v1';
export const PROPERTY_VECTOR_VERSION = '1.0.0';

function fail(message) {
  const error = new Error(`invalid property vector packet: ${message}`);
  error.code = 'PROPERTY-VECTOR-PACKET';
  return error;
}

function row(vector, fields = {}) {
  return {
    vectorId: vector.vectorId,
    kind: vector.kind,
    result: 'FAIL',
    canonicalBytesHex: null,
    sha256: null,
    status: null,
    primaryReason: null,
    affectedPointers: [],
    revocationRecordIds: [],
    reason: '',
    ...fields,
  };
}

function hashVector(vector) {
  const canonical = canonicalJson(vector.value);
  const digest = sha256(canonical);
  const reordered = sha256(canonicalJson(vector.reorderedValue));
  const matches = canonical === vector.expectedCanonical
    && canonicalJson(vector.permutedValue) === canonical
    && digest === vector.expectedSha256
    && reordered === vector.expectedReorderedSha256
    && digest !== reordered;
  return row(vector, {
    result: matches ? 'PASS' : 'FAIL',
    canonicalBytesHex: Buffer.from(canonical, 'utf8').toString('hex'),
    sha256: digest,
    reason: matches ? '' : 'hash.mismatch',
  });
}

function recordVector(vector) {
  const recordHash = qualificationRecordHash(vector.value);
  const chainHash = qualificationChainHash({ ...vector.value, recordHash });
  const matches = recordHash === vector.expectedRecordHash && chainHash === vector.expectedChainHash;
  return row(vector, {
    result: matches ? 'PASS' : 'FAIL',
    sha256: recordHash,
    reason: matches ? '' : 'record-chain.mismatch',
  });
}

function graphPointers(packet, vector) {
  const source = packet.graphs?.[vector.graphId];
  if (!Array.isArray(source) || !source.length) throw fail(`${vector.vectorId} names an unknown graph`);
  const pointers = JSON.parse(JSON.stringify(source));
  if (!vector.mutation) return pointers;
  const index = pointers.findIndex((pointer) => pointer.recordId === vector.mutation.recordId);
  if (index < 0) throw fail(`${vector.vectorId} mutation names an unknown record`);
  if (vector.mutation.kind === 'self-cycle') {
    pointers[index].predecessorHashes = [pointers[index].targetHash];
    return pointers;
  }
  if (vector.mutation.kind === 'duplicate') return [...pointers, { ...pointers[index], predecessorHashes: [...pointers[index].predecessorHashes] }];
  throw fail(`${vector.vectorId} has unknown mutation kind`);
}

function graphVector(packet, vector) {
  const result = computeDescendantInvalidation({ pointers: graphPointers(packet, vector), invalidationRoots: vector.invalidationRoots });
  const affectedPointers = result.affectedPointers ?? [];
  const revocationRecordIds = (result.revocations ?? []).map((entry) => entry.recordId);
  const matches = result.status === vector.expectedStatus
    && result.primaryReason === vector.expectedPrimaryReason
    && JSON.stringify(affectedPointers) === JSON.stringify(vector.expectedAffectedPointers)
    && JSON.stringify(revocationRecordIds) === JSON.stringify(vector.expectedRevocationRecordIds);
  return row(vector, {
    result: matches ? 'PASS' : 'FAIL',
    status: result.status,
    primaryReason: result.primaryReason,
    affectedPointers,
    revocationRecordIds,
    reason: matches ? '' : 'graph.mismatch',
  });
}

function runVector(packet, vector) {
  if (!vector || typeof vector !== 'object' || Array.isArray(vector) || typeof vector.vectorId !== 'string' || !vector.vectorId || typeof vector.kind !== 'string') throw fail('each vector needs vectorId and kind');
  if (vector.kind === 'canonical-hash') return hashVector(vector);
  if (vector.kind === 'record-chain') return recordVector(vector);
  if (vector.kind === 'graph-invalidation') return graphVector(packet, vector);
  throw fail(`${vector.vectorId} has unknown vector kind`);
}

export function loadPropertyVectors(file) {
  let raw;
  let packet;
  try {
    raw = fs.readFileSync(file);
    packet = parseJsonNoDuplicates(raw.toString('utf8'));
  } catch (error) { throw fail(error.message); }
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw fail('packet must be an object');
  if (packet.packetVersion !== PROPERTY_VECTOR_VERSION || packet.profile !== PROPERTY_VECTOR_PROFILE || packet.generatorProfile !== 'researcher-property-replay-v1') throw fail('unsupported packet, profile, or generator profile');
  if (!Array.isArray(packet.vectors) || !packet.vectors.length || !packet.graphs || typeof packet.graphs !== 'object' || Array.isArray(packet.graphs)) throw fail('vectors and graphs are required');
  const ids = new Set();
  for (const vector of packet.vectors) {
    if (!vector || typeof vector.vectorId !== 'string' || !vector.vectorId || ids.has(vector.vectorId)) throw fail('vector IDs must be present and unique');
    ids.add(vector.vectorId);
  }
  Object.defineProperty(packet, '__vectorPacketSha256', { value: crypto.createHash('sha256').update(raw).digest('hex'), enumerable: false });
  return packet;
}

export function runPropertyVectorConformance(packet) {
  if (!packet || packet.profile !== PROPERTY_VECTOR_PROFILE || !Array.isArray(packet.vectors)) throw fail('packet profile or vectors are invalid');
  const vectors = packet.vectors.map((vector) => runVector(packet, vector));
  const report = {
    validatorVersion: PROPERTY_VECTOR_VERSION,
    profile: PROPERTY_VECTOR_PROFILE,
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
