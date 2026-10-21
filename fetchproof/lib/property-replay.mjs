// Deterministic persistence and replay for property-test regressions.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compareText } from './release/order.mjs';
import {
  canonicalJson,
  computeDescendantInvalidation,
  parseJsonNoDuplicates,
  qualificationChainHash,
  qualificationRecordHash,
  payloadHash,
  sha256,
  validateEnvelope,
} from './release-validator.mjs';

export const PROPERTY_REPLAY_PROFILE = 'researcher-property-replay-v1';
export const PROPERTY_REPLAY_VERSION = '1.0.0';
export const DEFAULT_PROPERTY_REGRESSION_DIR = fileURLToPath(new URL('../conformance/property-regressions/', import.meta.url));

const FAMILIES = new Set(['canonical-hashing', 'predecessor-closure', 'descendant-invalidation']);
const HASH_ZERO = '0'.repeat(64);
const SPEC_HASH = 'a'.repeat(64);
const ROSTER_HASH = 'b'.repeat(64);

function fail(message) {
  const error = new Error(`invalid property regression: ${message}`);
  error.code = 'PROPERTY-REGRESSION';
  return error;
}

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function token(label) { return hash(`researcher-graph-test-v1\0${label}`); }

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 7), 61 | state) ^ state;
    value = (value ^ (value >>> 14)) >>> 0;
    return value / 0x100000000;
  };
}

function shuffledKeys(object, random) {
  const keys = Object.keys(object);
  for (let i = keys.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

function shuffled(values, random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function graph(iteration, random) {
  const pointers = [];
  const roots = [token(`R26-${iteration}`), token(`R27-${iteration}`)];
  const target = (label) => token(`${label}-${iteration}`);
  pointers.push({ package: 'R28', generation: 1, recordId: `P28-${iteration}`, targetHash: target('T28'), predecessorHashes: [roots[0], roots[1]] });
  pointers.push({ package: 'R29', generation: 1, recordId: `P29A-${iteration}`, targetHash: target('T29A'), predecessorHashes: [target('T28')] });
  if (random() > 0.25) pointers.push({ package: 'R29', generation: 2, recordId: `P29B-${iteration}`, targetHash: target('T29B'), predecessorHashes: [target('T28')] });
  const r29Targets = pointers.filter((pointer) => pointer.package === 'R29').map((pointer) => pointer.targetHash);
  pointers.push({ package: 'R30', generation: 1, recordId: `P30-${iteration}`, targetHash: target('T30'), predecessorHashes: r29Targets });
  pointers.push({ package: 'R31', generation: 1, recordId: `P31-${iteration}`, targetHash: target('T31'), predecessorHashes: [target('T30')] });
  pointers.push({ package: 'R32', generation: 1, recordId: `P32-${iteration}`, targetHash: target('T32'), predecessorHashes: [target('T31')] });
  pointers.push({ package: 'R33', generation: 1, recordId: `P33-${iteration}`, targetHash: target('T33'), predecessorHashes: [target('T32')] });
  return { pointers, roots };
}

function closureEnvelope(artifactId, payload, predecessorHashes) {
  return {
    artifactId,
    schema: 1,
    benchmarkSpecVersion: '1.0.0',
    benchmarkSpecSha256: SPEC_HASH,
    package: 'R28',
    recordId: `${artifactId}:property`,
    ownerRole: 'contract-custodian',
    ownerId: 'alice',
    roleRosterSha256: ROSTER_HASH,
    createdAt: '2026-01-01T00:00:00Z',
    predecessorHashes,
    payloadSha256: payloadHash(payload),
    state: 'sealed',
    visibility: 'grader-only',
    payload,
  };
}

function closureInput(seed, iteration) {
  const random = rng(seed);
  let result;
  for (let current = 0; current <= iteration; current += 1) {
    const count = 2 + Math.floor(random() * 8);
    const rootHash = token(`root-${current}`);
    const entries = [];
    for (let index = 0; index < count; index += 1) {
      const artifactId = `R28-P${current}-${index}`;
      const payload = { iteration: current, index, marker: token(`${current}-${index}`) };
      const predecessorHashes = index === 0 ? [rootHash] : [entries[index - 1].record.payloadSha256];
      const record = closureEnvelope(artifactId, payload, predecessorHashes);
      const entry = {
        artifactId,
        package: 'R28',
        visibility: 'grader-only',
        predecessors: index === 0
          ? [{ kind: 'external', id: `root-${current}`, hash: rootHash }]
          : [{ kind: 'artifact', artifactId: entries[index - 1].artifactId }],
      };
      entries.push({ artifactId, record, entry });
    }
    result = { rootHash, entries };
  }
  return result;
}

function canonicalInput(seed, iteration) {
  const random = rng(seed);
  let result;
  for (let index = 0; index <= iteration; index += 1) {
    const base = { z: index, a: { nested: index % 7, list: [index, index + 1] }, m: `case-${index}` };
    result = { base, permuted: shuffledKeys(base, random), reordered: { ...base, a: { ...base.a, list: [...base.a.list].reverse() } } };
  }
  return result;
}

function graphInput(seed, iteration) {
  const random = rng(seed);
  let result;
  for (let index = 0; index <= iteration; index += 1) {
    const generated = graph(index, random);
    const root = generated.roots[Math.floor(random() * generated.roots.length)];
    result = { pointers: generated.pointers, root, shuffled: shuffled(generated.pointers, random) };
  }
  return result;
}

export function propertyInput({ family, seed, iteration }) {
  const normalizedSeed = normalizeSeed(seed);
  const normalizedIteration = normalizeIteration(iteration);
  if (!FAMILIES.has(family)) throw fail(`unknown family ${family}`);
  if (family === 'canonical-hashing') return canonicalInput(normalizedSeed, normalizedIteration);
  if (family === 'predecessor-closure') return closureInput(normalizedSeed, normalizedIteration);
  return graphInput(normalizedSeed, normalizedIteration);
}

function inputHash(family, seed, iteration) {
  return sha256(canonicalJson({ family, seed, iteration, input: propertyInput({ family, seed, iteration }) }));
}

function normalizeSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw fail('seed must be an unsigned 32-bit integer');
  return seed >>> 0;
}

function normalizeIteration(iteration) {
  if (!Number.isInteger(iteration) || iteration < 0) throw fail('iteration must be a non-negative integer');
  return iteration;
}

function caseId(family, seed, iteration) {
  return `PREG-${family}-${seed.toString(16).padStart(8, '0')}-${String(iteration).padStart(6, '0')}`;
}

function failureFor(error) {
  return {
    name: String(error?.name ?? 'Error').slice(0, 80),
    message: String(error?.message ?? error ?? 'property assertion failed').slice(0, 2000),
  };
}

function hashRegression(regression) {
  const unsigned = { ...regression };
  delete unsigned.regressionSha256;
  return sha256(canonicalJson(unsigned));
}

function regressionPath(directory, regression) {
  return path.resolve(directory, `${regression.caseId}.json`);
}

export function persistPropertyFailure({ directory = DEFAULT_PROPERTY_REGRESSION_DIR, family, seed, iteration, error } = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const normalizedIteration = normalizeIteration(iteration);
  if (!FAMILIES.has(family)) throw fail(`unknown family ${family}`);
  const regression = {
    profile: PROPERTY_REPLAY_PROFILE,
    schemaVersion: PROPERTY_REPLAY_VERSION,
    generatorVersion: PROPERTY_REPLAY_VERSION,
    caseId: caseId(family, normalizedSeed, normalizedIteration),
    family,
    seed: normalizedSeed,
    iteration: normalizedIteration,
    inputSha256: inputHash(family, normalizedSeed, normalizedIteration),
    failure: failureFor(error),
  };
  regression.regressionSha256 = hashRegression(regression);
  const resolvedDirectory = path.resolve(directory);
  const file = regressionPath(resolvedDirectory, regression);
  fs.mkdirSync(resolvedDirectory, { recursive: true });
  if (fs.existsSync(file)) return { file, created: false, regression: loadPropertyRegression(file) };
  try {
    fs.writeFileSync(file, `${canonicalJson(regression)}\n`, { encoding: 'utf8', flag: 'wx' });
    return { file, created: true, regression };
  } catch (error) {
    if (error?.code === 'EEXIST') return { file, created: false, regression: loadPropertyRegression(file) };
    throw error;
  }
}

export function loadPropertyRegression(file) {
  let value;
  try { value = parseJsonNoDuplicates(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw fail(error.message); }
  return validateRegression(value);
}

function validateRegression(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('envelope must be an object');
  if (value.profile !== PROPERTY_REPLAY_PROFILE || value.schemaVersion !== PROPERTY_REPLAY_VERSION || value.generatorVersion !== PROPERTY_REPLAY_VERSION) throw fail('unsupported profile or version');
  const seed = normalizeSeed(value.seed);
  const iteration = normalizeIteration(value.iteration);
  if (!FAMILIES.has(value.family) || value.caseId !== caseId(value.family, seed, iteration)) throw fail('family or caseId is invalid');
  if (!/^[0-9a-f]{64}$/.test(String(value.inputSha256 ?? '')) || !/^[0-9a-f]{64}$/.test(String(value.regressionSha256 ?? ''))) throw fail('hash fields must be lowercase SHA-256');
  if (!value.failure || typeof value.failure.name !== 'string' || typeof value.failure.message !== 'string') throw fail('failure details are required');
  if (value.regressionSha256 !== hashRegression(value)) throw fail('regressionSha256 does not match canonical envelope bytes');
  return value;
}

function check(name, passed) { return { name, passed: Boolean(passed) }; }

function replayHashing(regression, input) {
  const { base, permuted, reordered } = input;
  const record = { ledgerVersion: '1.0.0', physicalSequence: regression.iteration + 1, recordKind: 'commit', payload: base, prevChainHash: HASH_ZERO, recordHash: '', chainHash: '', signature: 'ignored' };
  record.recordHash = qualificationRecordHash(record);
  record.chainHash = qualificationChainHash(record);
  const changedDerived = { ...record, recordHash: 'f'.repeat(64), chainHash: 'e'.repeat(64), signature: 'different' };
  const expectedChain = sha256(`benchmark-ledger-chain-v1\0${record.recordHash}\0${record.prevChainHash}\0${record.physicalSequence}`);
  return [
    check('canonical.object-order', canonicalJson(base) === canonicalJson(permuted)),
    check('canonical.hash-order', sha256(canonicalJson(base)) === sha256(canonicalJson(permuted))),
    check('canonical.array-order', sha256(canonicalJson(base)) !== sha256(canonicalJson(reordered))),
    check('ledger.record-self-exclusion', qualificationRecordHash(record) === qualificationRecordHash(changedDerived)),
    check('ledger.chain-domain', record.chainHash === expectedChain),
  ];
}

function replayClosure(_regression, input) {
  const records = new Map(input.entries.map(({ artifactId, record, entry }) => [artifactId, { record, entry }]));
  const context = {
    registry: { externalRoots: { [input.entries[0].entry.predecessors[0].id]: input.rootHash } },
    roster: { assignments: [{ principalId: 'alice', roleId: 'contract-custodian', package: '*', scope: '*' }] },
    records,
    closure: { rootHashes: [], visited: [], missing: [], mismatched: [] },
  };
  const results = input.entries.map(({ artifactId }) => validateEnvelope(records.get(artifactId).record, records.get(artifactId).entry, context));
  return [
    check('closure.envelopes-pass', results.every((result) => result.status === 'PASS')),
    check('closure.visits-unique', new Set(context.closure.visited).size === context.closure.visited.length),
    check('closure.root-authenticated', context.closure.rootHashes.includes(input.rootHash)),
  ];
}

function replayGraph(regression, input) {
  const { pointers, root, shuffled: permuted } = input;
  const first = computeDescendantInvalidation({ pointers, invalidationRoots: [root, root] });
  const second = computeDescendantInvalidation({ pointers: permuted, invalidationRoots: [root] });
  const cycle = pointers.map((pointer) => ({ ...pointer, predecessorHashes: [...pointer.predecessorHashes] }));
  cycle[cycle.length - 1].predecessorHashes = [cycle[0].targetHash];
  cycle[0].predecessorHashes = [cycle[cycle.length - 1].targetHash];
  const rejected = computeDescendantInvalidation({ pointers: cycle, invalidationRoots: [root] });
  const missing = computeDescendantInvalidation({ pointers, invalidationRoots: [token(`missing-${regression.iteration}`)] });
  const duplicate = computeDescendantInvalidation({ pointers: [...pointers, { ...pointers[0] }], invalidationRoots: [root] });
  const expectedOrder = [...first.affectedPointers].sort((left, right) => first.rank[left] - first.rank[right] || compareText(left, right));
  return [
    check('graph.base-pass', first.status === 'PASS'),
    check('graph.affected-unique', new Set(first.affectedPointers).size === first.affectedPointers.length),
    check('graph.one-revocation-per-pointer', first.revocations.length === first.affectedPointers.length),
    check('graph.package-order', first.affectedPointers.join(',') === expectedOrder.join(',')),
    check('graph.root-order', first.revocations.every((entry) => entry.invalidationRoots.join(',') === [...entry.invalidationRoots].sort().join(','))),
    check('graph.permutation-invariant', second.affectedPointers.join(',') === first.affectedPointers.join(',') && second.revocations.map((entry) => entry.recordId).join(',') === first.revocations.map((entry) => entry.recordId).join(',')),
    check('graph.cycle-rejected', rejected.status === 'FAIL' && rejected.affectedPointers.length === 0),
    check('graph.missing-root-rejected', missing.primaryReason === 'graph.missing-root'),
    check('graph.duplicate-rejected', duplicate.primaryReason === 'graph.duplicate-record'),
  ];
}

export function replayPropertyRegression(regression) {
  const loaded = typeof regression === 'string' ? loadPropertyRegression(regression) : regression;
  const normalized = validateRegression(loaded);
  const input = propertyInput(normalized);
  const actualInputSha256 = sha256(canonicalJson({ family: normalized.family, seed: normalized.seed, iteration: normalized.iteration, input }));
  const checks = actualInputSha256 === normalized.inputSha256
    ? (normalized.family === 'canonical-hashing'
      ? replayHashing(normalized, input)
      : normalized.family === 'predecessor-closure'
        ? replayClosure(normalized, input)
        : replayGraph(normalized, input))
    : [check('generator.input-hash', false)];
  return {
    profile: PROPERTY_REPLAY_PROFILE,
    caseId: normalized.caseId,
    family: normalized.family,
    seed: normalized.seed,
    iteration: normalized.iteration,
    inputSha256: actualInputSha256,
    status: checks.every((entry) => entry.passed) ? 'PASS' : 'FAIL',
    checks,
  };
}

export function listPropertyRegressions(directory = DEFAULT_PROPERTY_REGRESSION_DIR) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(directory, entry.name))
    .sort(compareText);
}
