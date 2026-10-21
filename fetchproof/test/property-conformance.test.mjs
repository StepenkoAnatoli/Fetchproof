// Deterministic property-style conformance tests. The generator is a tiny
// seeded PRNG so this suite needs no third-party dependency, fixture corpus,
// network, credentials, or paid transport.
import crypto from 'node:crypto';
import { test, describe, assert, assertEqual } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('property-conformance');
import { persistPropertyFailure, propertyInput } from '../lib/property-replay.mjs';

const HASH_ZERO = '0'.repeat(64);
const HASHING_SEED = 0xC14A0001;
const CLOSURE_SEED = 0xC14A0002;
const GRAPH_SEED = 0xC14A0003;

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function token(label) { return hash(`researcher-graph-test-v1\0${label}`); }

function persistFailure(family, seed, iteration, error) {
  const persisted = persistPropertyFailure({ family, seed, iteration, error });
  error.message = `${error.message}\nreplay: node fetchproof/bin/property-replay.mjs --case ${persisted.file} --json`;
  throw error;
}

test('canonical hashing is invariant under object insertion order and sensitive to authored arrays', async () => {
  const { canonicalJson, sha256, qualificationRecordHash, qualificationChainHash } = await import('../lib/release-validator.mjs');
  for (let i = 0; i < 300; i += 1) {
    try {
      const { base, permuted, reordered } = propertyInput({ family: 'canonical-hashing', seed: HASHING_SEED, iteration: i });
      assertEqual(canonicalJson(base), canonicalJson(permuted), `canonical object case ${i}`);
      assertEqual(sha256(canonicalJson(base)), sha256(canonicalJson(permuted)), `canonical hash case ${i}`);
      assert(sha256(canonicalJson(base)) !== sha256(canonicalJson(reordered)), `array order must matter case ${i}`);

      const record = { ledgerVersion: '1.0.0', physicalSequence: i + 1, recordKind: 'commit', payload: base, prevChainHash: HASH_ZERO, recordHash: '', chainHash: '', signature: 'ignored' };
      const recordHash = qualificationRecordHash(record);
      record.recordHash = recordHash;
      record.chainHash = qualificationChainHash(record);
      const changedDerived = { ...record, recordHash: 'f'.repeat(64), chainHash: 'e'.repeat(64), signature: 'different' };
      assertEqual(qualificationRecordHash(record), qualificationRecordHash(changedDerived), `self-excluding record hash case ${i}`);
    } catch (error) {
      persistFailure('canonical-hashing', HASHING_SEED, i, error);
    }
  }
});

test('predecessor closure validation remains complete across generated authenticated chains', async () => {
  const { validateEnvelope } = await import('../lib/release-validator.mjs');
  for (let iteration = 0; iteration < 120; iteration += 1) {
    try {
      const { rootHash, entries } = propertyInput({ family: 'predecessor-closure', seed: CLOSURE_SEED, iteration });
      const records = new Map(entries.map(({ artifactId, record, entry }) => [artifactId, { record, entry }]));
      const context = {
        registry: { externalRoots: { [`root-${iteration}`]: rootHash } },
        roster: { assignments: [{ principalId: 'alice', roleId: 'contract-custodian', package: '*', scope: '*' }] },
        records,
        closure: { rootHashes: [], visited: [], missing: [], mismatched: [] },
      };
      for (const entry of entries.map((item) => item.entry)) {
        const result = validateEnvelope(records.get(entry.artifactId).record, entry, context);
        assertEqual(result.status, 'PASS', `generated closure ${iteration}/${entry.artifactId}: ${JSON.stringify(result)}`);
      }
      assertEqual(new Set(context.closure.visited).size, context.closure.visited.length, `closure visits are duplicate-free ${iteration}`);
      assert(context.closure.rootHashes.includes(rootHash), `closure retains authenticated root ${iteration}`);
    } catch (error) {
      persistFailure('predecessor-closure', CLOSURE_SEED, iteration, error);
    }
  }
});

test('descendant rollback invalidation is transitive, sorted, duplicate-free, and permutation-invariant', async () => {
  const { computeDescendantInvalidation } = await import('../lib/release-validator.mjs');
  for (let iteration = 0; iteration < 120; iteration += 1) {
    try {
      const { pointers, root, shuffled } = propertyInput({ family: 'descendant-invalidation', seed: GRAPH_SEED, iteration });
      const first = computeDescendantInvalidation({ pointers, invalidationRoots: [root, root] });
      assertEqual(first.status, 'PASS', JSON.stringify(first));
      assertEqual(new Set(first.affectedPointers).size, first.affectedPointers.length, `affected pointers unique ${iteration}`);
      assertEqual(first.revocations.length, first.affectedPointers.length, `one revocation per pointer ${iteration}`);
      assertEqual(first.affectedPointers.join(','), [...first.affectedPointers].sort((a, b) => first.rank[a] - first.rank[b] || a.localeCompare(b)).join(','), `package order ${iteration}`);
      for (const revocation of first.revocations) assertEqual(revocation.invalidationRoots.join(','), [...revocation.invalidationRoots].sort().join(','), `root order ${iteration}`);
      const second = computeDescendantInvalidation({ pointers: shuffled, invalidationRoots: [root] });
      assertEqual(second.affectedPointers.join(','), first.affectedPointers.join(','), `input permutation ${iteration}`);
      assertEqual(second.revocations.map((entry) => entry.recordId).join(','), first.revocations.map((entry) => entry.recordId).join(','), `revocation permutation ${iteration}`);

      const cycle = pointers.map((pointer) => ({ ...pointer, predecessorHashes: [...pointer.predecessorHashes] }));
      cycle[cycle.length - 1].predecessorHashes = [cycle[0].targetHash];
      cycle[0].predecessorHashes = [cycle[cycle.length - 1].targetHash];
      const rejected = computeDescendantInvalidation({ pointers: cycle, invalidationRoots: [root] });
      assertEqual(rejected.status, 'FAIL', `cycle status ${iteration}`);
      assertEqual(rejected.affectedPointers.length, 0, `cycle has no affected output ${iteration}`);
      const missing = computeDescendantInvalidation({ pointers, invalidationRoots: [token(`missing-${iteration}`)] });
      assertEqual(missing.primaryReason, 'graph.missing-root', `missing root is rejected ${iteration}`);
      const duplicate = computeDescendantInvalidation({ pointers: [...pointers, { ...pointers[0] }], invalidationRoots: [root] });
      assertEqual(duplicate.primaryReason, 'graph.duplicate-record', `duplicate identity is rejected ${iteration}`);
    } catch (error) {
      persistFailure('descendant-invalidation', GRAPH_SEED, iteration, error);
    }
  }
});
