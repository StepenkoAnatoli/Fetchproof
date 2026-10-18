// Read-only R28–R32 release validation, and the facade over its primitives.
//
// The release contract intentionally has no runtime dependency on Ajv or a package
// manager, so the JSON Schema subset is implemented here rather than installed.
//
// WHAT MOVED, AND WHAT DID NOT (2026-09-20)
//
// Four primitives now live in ./release/ and are re-exported unchanged at the bottom of
// this file, so every existing import of `release-validator.mjs` keeps working:
//
//   release/json.mjs       duplicate-key-safe parsing
//   release/canonical.mjs  canonical JSON, hashing, flat-vs-nested record shape
//   release/schema.mjs     the JSON Schema subset
//   release/paths.mjs      containment
//
// They were chosen because they are genuinely SHARED - fi-validator, the three
// conformance libraries and path-authority all reuse them - and because duplication of
// exactly this code has already cost this repository once, when three Python runners each
// carried their own canonicaliser and two of them drifted.
//
// The R28–R32 semantics below - ledger anchoring, envelope checks, promotion pointers and
// the status reduction - deliberately stayed together. They are one concern, they share a
// dozen small helpers (`add`, `resultStatus`, `metaOf`, `readJson`), and splitting them
// would replace a long file with a web of cross-imports and no clearer boundary. A split
// that makes the dependency graph worse is not a decomposition.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { parseJsonNoDuplicates } from './release/json.mjs';
import { compareText } from './release/order.mjs';
import {
  canonicalJson, sha256, payloadHash, same,
  metaOf, payloadOf, nestedRecord,
  recordHash, qualificationRecordHash, qualificationChainHash,
} from './release/canonical.mjs';
import { validateJsonSchema } from './release/schema.mjs';
import { inside, safePath } from './release/paths.mjs';

// Re-exported so this module's public API is byte-for-byte what it was before the split.
// Consumers import from here; the move is an internal fact, not a migration.
export { parseJsonNoDuplicates } from './release/json.mjs';
export {
  canonicalJson, sha256, payloadHash,
  recordHash, qualificationRecordHash, qualificationChainHash,
} from './release/canonical.mjs';
export { validateJsonSchema } from './release/schema.mjs';
export { safePath } from './release/paths.mjs';

export const VALIDATOR_VERSION = '1.0.0';
export const DEFAULT_SCHEMA_DIR = fileURLToPath(new URL('../schemas/', import.meta.url));
const HASH = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PACKAGES = new Set(['R28', 'R29', 'R30', 'R31', 'R32', 'R33']);
const GATES = { R28: 'Q0', R29: 'Q1', R30: 'Q2', R31: 'Q3', R32: 'Q4', R33: 'Q5' };
const PACKAGE_ORDER = { R28: 28, R29: 29, R30: 30, R31: 31, R32: 32, R33: 33 };
// Snapshot evidence is intentionally bounded. A release may override this in
// an offline validator invocation, but promotion always checks the bound.
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ROLES = new Set([
  'contract-custodian', 'harness-maintainer', 'report-maintainer', 'evidence-custodian',
  'task-author', 'gold-reviewer-a', 'gold-reviewer-b', 'calibration-adjudicator',
  'warm-manifest-steward', 'run-operator', 'grader-a', 'grader-b', 'adjudicator',
  'comparison-steward', 'live-authorization-owner', 'source-verifier', 'cost-meter-owner',
]);

// --------------------------------------------------------------------- JSON




function resultStatus(errors) {
  if (errors.some((error) => error.status === 'REOPEN' || error.code === 'REOPEN')) return 'REOPEN';
  if (errors.some((error) => error.status === 'FAIL' || !error.status)) return 'FAIL';
  if (errors.length) return 'INCOMPLETE';
  return 'PASS';
}

function add(errors, code, message, pathName, status = 'FAIL') {
  errors.push({ code, message, path: pathName || '$', status });
}

function readJson(file) {
  try { return { value: parseJsonNoDuplicates(fs.readFileSync(file, 'utf8')), error: null }; }
  catch (error) {
    const duplicate = /duplicate object key/i.test(String(error?.message));
    return { value: null, error, code: duplicate ? 'JSON-DUPLICATE-KEY' : 'JSON-READ' };
  }
}

function markdownBytes(file) {
  const body = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').replace(/\n*$/, '\n');
  return Buffer.from(body, 'utf8');
}

function readArtifactRecord(file) {
  if (!/\.md$/i.test(file)) return { ...readJson(file), sidecar: null, contentHash: null };
  const sidecar = `${file}.envelope.json`;
  const loaded = readJson(sidecar);
  if (loaded.error) return { ...loaded, sidecar, contentHash: null };
  try {
    return { value: loaded.value, error: null, sidecar, contentHash: sha256(markdownBytes(file)) };
  } catch (error) {
    return { value: null, error, code: 'RECORD-READ', sidecar, contentHash: null };
  }
}


function normalizeArtifacts(registry) {
  if (Array.isArray(registry?.artifacts)) return registry.artifacts;
  if (registry?.artifacts && typeof registry.artifacts === 'object') return Object.entries(registry.artifacts).map(([artifactId, entry]) => ({ artifactId, ...entry }));
  return [];
}


function pointerHashFor(pointer) {
  const unsigned = nestedRecord(pointer)
    ? { envelope: { ...pointer.envelope }, payload: { ...pointer.payload } }
    : { ...pointer };
  if (nestedRecord(pointer)) {
    delete unsigned.payload.pointerHash;
    delete unsigned.payload.signature;
  } else {
    delete unsigned.pointerHash;
    delete unsigned.signature;
  }
  return sha256(canonicalJson(unsigned));
}

function pointerSigningFields(pointer) {
  const payload = nestedRecord(pointer) ? pointer.payload : pointer;
  return {
    pointerHash: payload?.pointerHash,
    signerKeyId: payload?.signerKeyId,
    signature: payload?.signature,
  };
}

/**
 * Compute the deterministic, hash-closed descendant set used by rollback
 * planning. This is a pure graph operation: it validates duplicate identities
 * and cycles before emitting any affected pointer or revocation record.
 */
export function computeDescendantInvalidation({ pointers = [], invalidationRoots = [] } = {}) {
  const fail = (primaryReason, message) => ({
    status: 'FAIL',
    primaryReason,
    message,
    affectedPointers: [],
    revocations: [],
    closures: {},
    rank: {},
  });
  if (!Array.isArray(pointers) || !Array.isArray(invalidationRoots)) return fail('graph.input', 'pointers and invalidationRoots must be arrays');
  const identities = new Set();
  const byTarget = new Map();
  const packageRank = { R26: 26, R27: 27, R28: 28, R29: 29, R30: 30, R31: 31, R32: 32, R33: 33 };
  const rank = Object.create(null); // a recordId "__proto__" is a key here, not the prototype
  for (const pointer of pointers) {
    if (!pointer || typeof pointer !== 'object' || typeof pointer.recordId !== 'string' || typeof pointer.package !== 'string' || !Number.isInteger(pointer.generation) || typeof pointer.targetHash !== 'string' || !Array.isArray(pointer.predecessorHashes)) return fail('graph.input', 'pointer shape is incomplete');
    const identity = `${pointer.package}\0${pointer.generation}\0${pointer.recordId}`;
    if (identities.has(identity)) return fail('graph.duplicate-record', `duplicate pointer identity ${pointer.recordId}`);
    identities.add(identity);
    rank[pointer.recordId] = Object.hasOwn(packageRank, pointer.package) ? packageRank[pointer.package] : Number.MAX_SAFE_INTEGER;
    const matches = byTarget.get(pointer.targetHash) ?? [];
    matches.push(pointer);
    byTarget.set(pointer.targetHash, matches);
  }
  const roots = [...new Set(invalidationRoots.map(String))];
  const knownHashes = new Set([...byTarget.keys(), ...pointers.flatMap((pointer) => pointer.predecessorHashes)]);
  const missingRoot = roots.find((root) => !knownHashes.has(root));
  if (missingRoot) return fail('graph.missing-root', `invalidation root ${missingRoot} is not authenticated by the graph`);
  const closures = {};
  let cyclePath = null;
  const closureFor = (pointer) => {
    const visited = new Set();
    const active = [];
    const values = [];
    const walk = (value) => {
      if (active.includes(value)) {
        cyclePath = [...active.slice(active.indexOf(value)), value];
        return;
      }
      if (visited.has(value)) return;
      visited.add(value);
      values.push(value);
      const owners = byTarget.get(value) ?? [];
      for (const owner of owners) {
        active.push(value);
        for (const predecessor of owner.predecessorHashes) walk(predecessor);
        active.pop();
        if (cyclePath) return;
      }
    };
    for (const predecessor of pointer.predecessorHashes) walk(predecessor);
    walk(pointer.targetHash);
    return values;
  };
  for (const pointer of pointers) {
    const closure = closureFor(pointer);
    if (cyclePath) return { ...fail('graph.cycle', `cycle ${cyclePath.join('->')}`), cycle: cyclePath };
    closures[pointer.recordId] = closure;
  }
  const affected = pointers.filter((pointer) => roots.some((root) => closures[pointer.recordId].includes(root)));
  affected.sort((left, right) => (rank[left.recordId] - rank[right.recordId]) || (left.generation - right.generation) || compareText(left.recordId, right.recordId));
  const affectedPointers = affected.map((pointer) => pointer.recordId);
  const revocations = affected.map((pointer) => ({
    recordId: pointer.recordId,
    package: pointer.package,
    generation: pointer.generation,
    invalidationRoots: roots.filter((root) => closures[pointer.recordId].includes(root)).sort(),
    state: 'revoked',
  }));
  return { status: 'PASS', primaryReason: affected.length ? 'descendants.invalidated' : 'descendants.none', affectedPointers, revocations, closures, rank };
}

function readQualificationLedger(ledgerPath) {
  const files = [];
  if (ledgerPath && fs.existsSync(ledgerPath)) {
    const stat = fs.statSync(ledgerPath);
    if (stat.isDirectory()) {
      for (const file of collectJsonFiles(ledgerPath)) if (file.endsWith('.qlog')) files.push(file);
      // collectJsonFiles intentionally only returns JSON; qlog segments need a
      // small deterministic walk of their own.
      for (const item of fs.readdirSync(ledgerPath, { withFileTypes: true })) {
        if (item.isFile() && item.name.endsWith('.qlog')) files.push(path.join(ledgerPath, item.name));
      }
      const segments = path.join(ledgerPath, 'segments');
      if (fs.existsSync(segments)) for (const item of fs.readdirSync(segments, { withFileTypes: true })) {
        if (item.isFile() && item.name.endsWith('.qlog')) files.push(path.join(segments, item.name));
      }
    } else files.push(ledgerPath);
  }
  const uniqueFiles = [...new Set(files)].sort(compareText);
  const records = [];
  const errors = [];
  for (const file of uniqueFiles) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (error) { errors.push({ code: 'LEDGER-READ', message: error.message, path: file, status: 'INCOMPLETE' }); continue; }
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      try { records.push({ record: parseJsonNoDuplicates(line), file, line: index + 1 }); }
      catch (error) {
        const isTail = index === lines.length - 1 && !text.endsWith('\n');
        errors.push({ code: isTail ? 'LEDGER-TAIL-TRUNCATED' : 'LEDGER-JSON', message: error.message, path: `${file}:${index + 1}`, status: isTail ? 'INCOMPLETE' : 'FAIL' });
      }
    }
  }
  return { records, errors, files: uniqueFiles };
}

function validateSegmentRotation(files, errors) {
  const segments = files.filter((file) => /(?:^|[\\/])\d+\.qlog$/i.test(file));
  if (!segments.length) return;
  const numbers = segments.map((file) => Number(path.basename(file, '.qlog'))).sort((a, b) => a - b);
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) add(errors, 'LEDGER-SEGMENT-ROTATION', 'duplicate ledger segment number detected', '.segments', 'FAIL');
  for (let index = 0; index < numbers.length; index += 1) if (numbers[index] !== index + 1) {
    add(errors, 'LEDGER-SEGMENT-ROTATION', `ledger segments must be contiguous from 1 (missing ${String(index + 1).padStart(8, '0')})`, '.segments', 'FAIL');
    break;
  }
}

function publicKeyFor(publicKeys, keyId) {
  if (!publicKeys || !keyId) return null;
  const value = publicKeys instanceof Map ? publicKeys.get(keyId) : publicKeys[keyId];
  if (!value) return null;
  try { return value?.type ? value : crypto.createPublicKey(value); } catch { return null; }
}

function ed25519SignatureBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('signature must be unpadded base64url');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 64 || decoded.toString('base64url') !== value) throw new Error('signature must be canonical 64-byte base64url');
  return decoded;
}

function hashBytes(value) {
  if (!HASH.test(String(value ?? ''))) throw new Error('signature digest must be a lowercase SHA-256 hash');
  return Buffer.from(value, 'hex');
}

function signedAnchorHash(anchor, hashField) {
  const unsigned = { ...anchor };
  delete unsigned[hashField];
  delete unsigned.signature;
  return sha256(canonicalJson(unsigned));
}

function anchorSignatureValid(anchor, digest, publicKeys) {
  const key = publicKeyFor(publicKeys, anchor?.signerKeyId);
  if (!key || typeof anchor?.signature !== 'string') return false;
  try { return crypto.verify(null, hashBytes(digest), key, ed25519SignatureBytes(anchor.signature)); }
  catch { return false; }
}

/** Build a stable, non-sensitive projection of promotion and recovery history. */
export function summarizeLedgerHistory(records = []) {
  const packages = ['R28', 'R29', 'R30', 'R31', 'R32', 'R33'];
  const promotionTimelines = Object.fromEntries(packages.map((packageName) => [packageName, []]));
  const recoveryReceipts = [];
  const seenReceipts = new Set();
  for (const input of (Array.isArray(records) ? records : [])) {
    const record = input?.record && typeof input.record === 'object' ? input.record : input;
    if (!record || typeof record !== 'object') continue;
    if (record.recordKind === 'recovery') {
      const receiptId = record.recordId ?? record.eventId ?? record.txId;
      if (receiptId !== undefined && receiptId !== null && !seenReceipts.has(String(receiptId))) {
        seenReceipts.add(String(receiptId));
        recoveryReceipts.push({ id: String(receiptId), sequence: Number.isInteger(record.physicalSequence) ? record.physicalSequence : Number.MAX_SAFE_INTEGER });
      }
    }
    if (!['promotion-intent', 'promotion-commit', 'promotion-revoke'].includes(record.recordKind)) continue;
    const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
    const packageName = record.package ?? payload.package;
    if (!promotionTimelines[packageName]) continue;
    const entry = {
      recordId: record.recordId ?? null,
      eventId: record.eventId ?? null,
      recordKind: record.recordKind,
      state: record.state ?? null,
      physicalSequence: Number.isInteger(record.physicalSequence) ? record.physicalSequence : null,
      createdAt: record.createdAt ?? null,
      chainHash: HASH.test(String(record.chainHash ?? '')) ? record.chainHash : null,
      targetArtifactId: payload.targetArtifactId ?? null,
      targetHash: HASH.test(String(payload.targetHash ?? '')) ? payload.targetHash : null,
      pointerHash: HASH.test(String(payload.pointerHash ?? '')) ? payload.pointerHash : null,
      requiredGate: payload.requiredGate ?? null,
    };
    promotionTimelines[packageName].push(entry);
  }
  for (const packageName of packages) promotionTimelines[packageName].sort((left, right) => (left.physicalSequence ?? Number.MAX_SAFE_INTEGER) - (right.physicalSequence ?? Number.MAX_SAFE_INTEGER) || compareText(left.recordId, right.recordId));
  recoveryReceipts.sort((left, right) => left.sequence - right.sequence || compareText(left.id, right.id));
  return { promotionTimelines, recoveryReceiptIds: recoveryReceipts.map((entry) => entry.id) };
}

/** Verify an immutable signed genesis and signed checkpoints used at segment rotation. */
export function verifyLedgerAnchors({ genesis, checkpoints = [], records = [], publicKeys = {}, expectedBenchmarkSpecSha256, expectedRoleRosterSha256, genesisSchemaPath = path.join(DEFAULT_SCHEMA_DIR, 'qualification-ledger-genesis.schema.json'), checkpointSchemaPath = path.join(DEFAULT_SCHEMA_DIR, 'qualification-ledger-checkpoint.schema.json') } = {}) {
  const errors = [];
  if (!genesis || typeof genesis !== 'object' || Array.isArray(genesis)) {
    add(errors, 'LEDGER-GENESIS-MISSING', 'signed genesis anchor is required for anchor verification', '.genesis', 'INCOMPLETE');
    return { status: resultStatus(errors), genesisHash: null, checkpoints: [], errors };
  }
  if (genesis.ledgerVersion !== '1.0.0') add(errors, 'LEDGER-GENESIS-VERSION', 'genesis ledgerVersion must be exactly 1.0.0', '.genesis.ledgerVersion', 'INCOMPLETE');
  if (genesis.benchmarkSpecVersion !== '1.0.0') add(errors, 'LEDGER-GENESIS-VERSION', 'genesis benchmarkSpecVersion must be exactly 1.0.0', '.genesis.benchmarkSpecVersion', 'INCOMPLETE');
  if (typeof genesis.releaseId !== 'string' || !genesis.releaseId) add(errors, 'LEDGER-GENESIS-IDENTITY', 'genesis releaseId is required', '.genesis.releaseId', 'INCOMPLETE');
  if (!HASH.test(String(genesis.benchmarkSpecSha256 ?? ''))) add(errors, 'LEDGER-GENESIS-HASH', 'genesis benchmarkSpecSha256 is invalid', '.genesis.benchmarkSpecSha256', 'INCOMPLETE');
  if (!HASH.test(String(genesis.registrySha256 ?? ''))) add(errors, 'LEDGER-GENESIS-HASH', 'genesis registrySha256 is invalid', '.genesis.registrySha256', 'INCOMPLETE');
  if (!HASH.test(String(genesis.roleRosterSha256 ?? ''))) add(errors, 'LEDGER-GENESIS-HASH', 'genesis roleRosterSha256 is invalid', '.genesis.roleRosterSha256', 'INCOMPLETE');
  if (expectedBenchmarkSpecSha256 && genesis.benchmarkSpecSha256 !== expectedBenchmarkSpecSha256) add(errors, 'LEDGER-GENESIS-CONTRACT', 'genesis benchmarkSpecSha256 does not match the release contract', '.genesis.benchmarkSpecSha256', 'REOPEN');
  if (expectedRoleRosterSha256 && genesis.roleRosterSha256 !== expectedRoleRosterSha256) add(errors, 'LEDGER-GENESIS-ROLE-ROSTER', 'genesis roleRosterSha256 does not match the release roster', '.genesis.roleRosterSha256', 'REOPEN');
  if (genesisSchemaPath) {
    const loadedSchema = readJson(genesisSchemaPath);
    if (loadedSchema.error) add(errors, 'LEDGER-GENESIS-SCHEMA', loadedSchema.error.message, genesisSchemaPath, 'INCOMPLETE');
    else for (const error of validateJsonSchema(genesis, loadedSchema.value, { errors: [] })) add(errors, `LEDGER-GENESIS-SCHEMA-${error.code}`, error.message, `.genesis${error.path.slice(1)}`, 'FAIL');
  }
  const computedGenesisHash = signedAnchorHash(genesis, 'genesisHash');
  if (!HASH.test(String(genesis.genesisHash ?? '')) || genesis.genesisHash !== computedGenesisHash) add(errors, 'LEDGER-GENESIS-HASH', 'genesisHash does not match canonical genesis bytes', '.genesis.genesisHash', 'INCOMPLETE');
  if (!anchorSignatureValid(genesis, genesis.genesisHash, publicKeys)) add(errors, 'LEDGER-GENESIS-SIGNATURE', 'genesis Ed25519 signature is missing or invalid', '.genesis.signature', 'INCOMPLETE');

  const rows = Array.isArray(records) ? records : [];
  const byChain = new Map(rows.map((row) => [row?.chainHash, row]));
  const seenSequences = new Set();
  const seenHashes = new Set();
  const verified = [];
  for (const input of (Array.isArray(checkpoints) ? checkpoints : [])) {
    const checkpoint = input?.payload?.checkpoint && typeof input.payload.checkpoint === 'object' ? input.payload.checkpoint : input;
    const at = `.checkpoints[${verified.length}]`;
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) { add(errors, 'LEDGER-CHECKPOINT-INVALID', 'checkpoint must be an object', at, 'INCOMPLETE'); continue; }
    if (checkpoint.ledgerVersion !== '1.0.0') add(errors, 'LEDGER-CHECKPOINT-VERSION', 'checkpoint ledgerVersion must be exactly 1.0.0', `${at}.ledgerVersion`, 'INCOMPLETE');
    if (checkpointSchemaPath && !checkpoint.recordKind) {
      const loadedSchema = readJson(checkpointSchemaPath);
      if (loadedSchema.error) add(errors, 'LEDGER-CHECKPOINT-SCHEMA', loadedSchema.error.message, checkpointSchemaPath, 'INCOMPLETE');
      else for (const error of validateJsonSchema(checkpoint, loadedSchema.value, { errors: [] })) add(errors, `LEDGER-CHECKPOINT-SCHEMA-${error.code}`, error.message, `${at}${error.path.slice(1)}`, 'FAIL');
    }
    if (checkpoint.releaseId !== genesis.releaseId) add(errors, 'LEDGER-CHECKPOINT-LINK', 'checkpoint releaseId does not match genesis', `${at}.releaseId`, 'INCOMPLETE');
    if (checkpoint.genesisHash !== genesis.genesisHash) add(errors, 'LEDGER-CHECKPOINT-LINK', 'checkpoint genesisHash does not match signed genesis', `${at}.genesisHash`, 'INCOMPLETE');
    if (!Number.isInteger(checkpoint.physicalSequence) || checkpoint.physicalSequence < 1) add(errors, 'LEDGER-CHECKPOINT-SEQUENCE', 'checkpoint physicalSequence must be a positive integer', `${at}.physicalSequence`, 'INCOMPLETE');
    else if (seenSequences.has(checkpoint.physicalSequence)) add(errors, 'LEDGER-CHECKPOINT-DUPLICATE', `checkpoint sequence ${checkpoint.physicalSequence} appears more than once`, `${at}.physicalSequence`, 'INCOMPLETE');
    else seenSequences.add(checkpoint.physicalSequence);
    if (!Number.isInteger(checkpoint.byteOffset) || checkpoint.byteOffset < 0) add(errors, 'LEDGER-CHECKPOINT-OFFSET', 'checkpoint byteOffset must be a non-negative integer', `${at}.byteOffset`, 'INCOMPLETE');
    if (!HASH.test(String(checkpoint.chainHash ?? ''))) add(errors, 'LEDGER-CHECKPOINT-LINK', 'checkpoint chainHash must be a lowercase SHA-256 value', `${at}.chainHash`, 'INCOMPLETE');
    if (!HASH.test(String(checkpoint.snapshotHash ?? ''))) add(errors, 'LEDGER-CHECKPOINT-SNAPSHOT', 'checkpoint snapshotHash must be a lowercase SHA-256 value', `${at}.snapshotHash`, 'INCOMPLETE');
    const computed = signedAnchorHash(checkpoint, 'checkpointHash');
    if (!HASH.test(String(checkpoint.checkpointHash ?? '')) || checkpoint.checkpointHash !== computed) add(errors, 'LEDGER-CHECKPOINT-HASH', 'checkpointHash does not match canonical checkpoint bytes', `${at}.checkpointHash`, 'INCOMPLETE');
    if (!anchorSignatureValid(checkpoint, checkpoint.checkpointHash, publicKeys)) add(errors, 'LEDGER-CHECKPOINT-SIGNATURE', 'checkpoint Ed25519 signature is missing or invalid', `${at}.signature`, 'INCOMPLETE');
    if (seenHashes.has(checkpoint.checkpointHash)) add(errors, 'LEDGER-CHECKPOINT-DUPLICATE', `checkpoint hash ${checkpoint.checkpointHash} appears more than once`, `${at}.checkpointHash`, 'INCOMPLETE');
    else if (HASH.test(String(checkpoint.checkpointHash ?? ''))) seenHashes.add(checkpoint.checkpointHash);
    const row = byChain.get(checkpoint.chainHash);
    if (!row) add(errors, 'LEDGER-CHECKPOINT-LINK', 'checkpoint chainHash is not present in the verified ledger records', `${at}.chainHash`, 'INCOMPLETE');
    else {
      if (row.physicalSequence !== checkpoint.physicalSequence) add(errors, 'LEDGER-CHECKPOINT-LINK', 'checkpoint sequence does not match the referenced ledger record', `${at}.physicalSequence`, 'INCOMPLETE');
      if (row.__file && checkpoint.segment && path.basename(row.__file) !== checkpoint.segment) add(errors, 'LEDGER-CHECKPOINT-LINK', 'checkpoint segment does not contain the referenced ledger record', `${at}.segment`, 'INCOMPLETE');
    }
    verified.push(checkpoint);
  }
  verified.sort((left, right) => (left.physicalSequence ?? 0) - (right.physicalSequence ?? 0));
  for (let index = 1; index < verified.length; index += 1) {
    const prior = verified[index - 1];
    const current = verified[index];
    if (current.previousCheckpointHash !== undefined && current.previousCheckpointHash !== prior.checkpointHash) add(errors, 'LEDGER-CHECKPOINT-LINK', 'checkpoint previousCheckpointHash does not link to the prior rotation checkpoint', `.checkpoints[${index}].previousCheckpointHash`, 'INCOMPLETE');
  }
  return { status: resultStatus(errors), genesisHash: genesis.genesisHash, checkpoints: verified, errors };
}

/**
 * Verify a signed R28–R32 pointer against the append-only qualification
 * ledger. The function is pure when `records` is supplied; `ledgerPath` is a
 * read-only convenience for qlog files/directories. Any unresolved prepare,
 * stale head, missing commit, or signature failure is fail-closed.
 */
export function verifyQualificationLedger({ records: suppliedRecords, ledgerPath, pointer, publicKeys = {}, genesisHash = '0'.repeat(64), genesis: suppliedGenesis = null, genesisPath = null, checkpoints: suppliedCheckpoints = null, checkpointsDir = null, genesisSchemaPath = path.join(DEFAULT_SCHEMA_DIR, 'qualification-ledger-genesis.schema.json'), checkpointSchemaPath = path.join(DEFAULT_SCHEMA_DIR, 'qualification-ledger-checkpoint.schema.json'), expectedBenchmarkSpecSha256, expectedRoleRosterSha256, roster, head, schemaPath = path.join(DEFAULT_SCHEMA_DIR, 'qualification-ledger-record.schema.json'), now = Date.now() } = {}) {
  const errors = [];
  const loaded = suppliedRecords ? { records: suppliedRecords.map((record) => ({ record })), errors: [], files: [] } : readQualificationLedger(ledgerPath);
  errors.push(...loaded.errors);
  let genesis = suppliedGenesis;
  if (!genesis && genesisPath) {
    const loadedGenesis = readJson(genesisPath);
    if (loadedGenesis.error) add(errors, 'LEDGER-GENESIS-READ', loadedGenesis.error.message, genesisPath, 'INCOMPLETE');
    else genesis = loadedGenesis.value;
  }
  if (!genesis && ledgerPath && fs.existsSync(ledgerPath) && fs.statSync(ledgerPath).isDirectory()) {
    const candidate = path.join(ledgerPath, 'genesis.json');
    if (fs.existsSync(candidate)) {
      const loadedGenesis = readJson(candidate);
      if (loadedGenesis.error) add(errors, 'LEDGER-GENESIS-READ', loadedGenesis.error.message, candidate, 'INCOMPLETE');
      else genesis = loadedGenesis.value;
    } else add(errors, 'LEDGER-GENESIS-MISSING', 'ledger directory is missing immutable genesis.json', candidate, 'INCOMPLETE');
  }
  let effectiveGenesisHash = genesisHash;
  if (genesis?.genesisHash) {
    if (genesisHash !== '0'.repeat(64) && genesisHash !== genesis.genesisHash) add(errors, 'LEDGER-GENESIS-LINK', 'supplied genesisHash does not match signed genesis', '.genesisHash', 'REOPEN');
    effectiveGenesisHash = genesis.genesisHash;
  }
  if (!HASH.test(String(effectiveGenesisHash))) add(errors, 'LEDGER-GENESIS', 'genesisHash must be a lowercase SHA-256 value', '.genesisHash', 'INCOMPLETE');
  const rows = loaded.records;
  validateSegmentRotation(loaded.files, errors);
  let previous = effectiveGenesisHash;
  let expectedSequence = 1;
  const eventPayloads = new Map();
  const byChain = new Map();
  const byRecordHash = new Map();
  const prepares = new Map();
  const resolvedPrepares = new Set();
  const committed = [];
  let checkpoints = Array.isArray(suppliedCheckpoints) ? [...suppliedCheckpoints] : [];
  if (!checkpoints.length && checkpointsDir && fs.existsSync(checkpointsDir)) checkpoints = collectJsonFiles(checkpointsDir).map((file) => readJson(file)).filter((entry) => !entry.error).map((entry) => entry.value);
  if (!checkpoints.length && ledgerPath && fs.existsSync(ledgerPath) && fs.statSync(ledgerPath).isDirectory()) {
    const dir = path.join(ledgerPath, 'checkpoints');
    if (fs.existsSync(dir)) checkpoints = collectJsonFiles(dir).map((file) => readJson(file)).filter((entry) => !entry.error).map((entry) => entry.value);
  }
  const embeddedCheckpoints = rows.map((row) => row.record).filter((record) => record?.recordKind === 'checkpoint');
  if (embeddedCheckpoints.length) checkpoints = [...checkpoints, ...embeddedCheckpoints];
  if (genesis) {
    const anchorResult = verifyLedgerAnchors({ genesis, checkpoints, records: rows.map((row) => ({ ...row.record, __file: row.file })), publicKeys, expectedBenchmarkSpecSha256, expectedRoleRosterSha256, genesisSchemaPath, checkpointSchemaPath });
    for (const error of anchorResult.errors) errors.push(error);
  }
  const schemaLoaded = schemaPath ? readJson(schemaPath) : { value: null, error: null };
  if (schemaLoaded.error) add(errors, 'LEDGER-SCHEMA', `ledger record schema is unreadable: ${schemaLoaded.error.message}`, schemaPath, 'INCOMPLETE');
  for (const row of rows) {
    const record = row.record;
    const at = row.file ? `${row.file}:${row.line}` : `sequence:${record?.physicalSequence ?? '?'}`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) { add(errors, 'LEDGER-RECORD', 'ledger record must be an object', at, 'INCOMPLETE'); continue; }
    if (schemaLoaded.value) {
      const schemaErrors = [];
      validateJsonSchema(record, schemaLoaded.value, { errors: schemaErrors });
      for (const error of schemaErrors) add(errors, `LEDGER-SCHEMA-${error.code}`, error.message, `${at}:${error.path}`, 'FAIL');
    }
    if (record.ledgerVersion !== '1.0.0') add(errors, 'LEDGER-VERSION', 'ledgerVersion must be exactly 1.0.0', `${at}.ledgerVersion`, 'INCOMPLETE');
    if (expectedBenchmarkSpecSha256 && record.benchmarkSpecSha256 !== expectedBenchmarkSpecSha256) add(errors, 'LEDGER-CONTRACT', 'benchmarkSpecSha256 does not match the release registry', `${at}.benchmarkSpecSha256`, 'REOPEN');
    if (expectedRoleRosterSha256 && record.roleRosterSha256 !== expectedRoleRosterSha256) add(errors, 'LEDGER-ROLE-ROSTER', 'roleRosterSha256 does not match the release roster', `${at}.roleRosterSha256`, 'REOPEN');
    if (roster?.assignments && !roster.assignments.some((assignment) => assignment.principalId === record.actorId && assignment.roleId === record.actorRole && (assignment.package === '*' || assignment.package === record.package))) add(errors, 'LEDGER-ROLE', `actor ${record.actorId}/${record.actorRole} is not authorized for ${record.package}`, `${at}.actorId`, 'FAIL');
    if (typeof record.createdAt === 'string' && !Number.isNaN(Date.parse(record.createdAt)) && Date.parse(record.createdAt) > now) add(errors, 'LEDGER-TIME-FUTURE', 'ledger record is dated in the future', `${at}.createdAt`, 'FAIL');
    if (!Number.isInteger(record.physicalSequence) || record.physicalSequence !== expectedSequence) add(errors, 'LEDGER-SEQUENCE', `expected physicalSequence ${expectedSequence}`, `${at}.physicalSequence`, 'FAIL');
    expectedSequence = Number.isInteger(record.physicalSequence) ? record.physicalSequence + 1 : expectedSequence;
    if (record.prevChainHash !== previous) add(errors, 'LEDGER-CHAIN', 'prevChainHash does not match the verified prefix', `${at}.prevChainHash`, 'FAIL');
    if (record.payloadSha256 !== payloadHash(record.payload)) add(errors, 'LEDGER-PAYLOAD-HASH', 'payloadSha256 does not match canonical payload', `${at}.payloadSha256`, 'FAIL');
    if (record.recordHash !== qualificationRecordHash(record)) add(errors, 'LEDGER-RECORD-HASH', 'recordHash does not match canonical record bytes', `${at}.recordHash`, 'FAIL');
    if (record.chainHash !== qualificationChainHash(record)) add(errors, 'LEDGER-CHAIN', 'chainHash does not match canonical chain bytes', `${at}.chainHash`, 'FAIL');
    previous = record.chainHash;
    if (record.chainHash) byChain.set(record.chainHash, record);
    if (record.recordHash) byRecordHash.set(record.recordHash, record);
    if (record.eventId) {
      const prior = eventPayloads.get(record.eventId);
      if (prior && prior !== record.payloadSha256) add(errors, 'LEDGER-EVENT-DUPLICATE', `eventId ${record.eventId} has different payload hashes`, `${at}.eventId`, 'FAIL');
      eventPayloads.set(record.eventId, record.payloadSha256);
    }
    if (record.recordKind === 'prepare') prepares.set(record.recordHash, record);
    if (record.recordKind === 'commit' || record.recordKind === 'abort' || record.recordKind === 'recovery') {
      const ref = record.payload?.prepareRecordHash ?? record.prepareRecordHash;
      if (ref) resolvedPrepares.add(ref);
    }
    if (record.recordKind === 'promotion-intent') prepares.set(record.recordHash, record);
    if (record.recordKind === 'promotion-commit' || record.recordKind === 'promotion-revoke') {
      const ref = record.payload?.intentRecordHash ?? record.payload?.prepareRecordHash;
      if (ref) resolvedPrepares.add(ref);
    }
    if (record.recordKind === 'recovery' && record.payload?.action === 'rebuild-head') {
      const reconciled = record.payload.reconciledChainHash ?? record.payload.afterHeadChainHash;
      if (!HASH.test(String(reconciled ?? '')) || (reconciled !== record.prevChainHash && !byChain.has(reconciled))) add(errors, 'LEDGER-RECOVERY-LINK', 'head-rebuild recovery must name a verified chain hash', `${at}.payload.reconciledChainHash`, 'INCOMPLETE');
    }
    if (record.state === 'committed') committed.push(record);
    if (record.recordKind === 'promotion-commit' && record.state !== 'committed') add(errors, 'LEDGER-PROMOTION-STATE', 'promotion-commit must be committed', `${at}.state`, 'INCOMPLETE');
    if (record.recordKind === 'prepare' && record.state !== 'pending') add(errors, 'LEDGER-STATE', 'prepare must be pending', `${at}.state`, 'FAIL');
  }
  for (const [recordHashValue, record] of prepares) {
    if (!resolvedPrepares.has(recordHashValue)) add(errors, 'LEDGER-UNRESOLVED-PREPARE', `durable ${record.recordKind} has no commit, abort, or recovery resolution`, `.recordHash:${recordHashValue}`, 'INCOMPLETE');
  }

  const fields = pointerSigningFields(pointer);
  if (!fields.pointerHash || pointerHashFor(pointer) !== fields.pointerHash) add(errors, 'PTR-SIGNATURE', 'pointerHash does not verify', '.pointerHash', 'INCOMPLETE');
  const key = publicKeyFor(publicKeys, fields.signerKeyId);
  if (!fields.signerKeyId || !fields.signature) add(errors, 'PTR-SIGNATURE', 'signed pointer requires signerKeyId and signature', '.signature', 'INCOMPLETE');
  else if (!key) add(errors, 'PTR-SIGNATURE', `unknown or invalid signer key ${fields.signerKeyId}`, '.signerKeyId', 'INCOMPLETE');
  else {
    try {
      const signature = ed25519SignatureBytes(fields.signature);
      if (!crypto.verify(null, hashBytes(fields.pointerHash), key, signature)) add(errors, 'PTR-SIGNATURE', 'Ed25519 pointer signature is invalid', '.signature', 'INCOMPLETE');
    } catch (error) { add(errors, 'PTR-SIGNATURE', `signature could not be verified: ${error.message}`, '.signature', 'INCOMPLETE'); }
  }

  const promotion = pointerPayload(pointer);
  const pointerPackage = metaOf(pointer).package ?? pointer.package ?? promotion?.package;
  if (promotion?.package && pointerPackage && promotion.package !== pointerPackage) add(errors, 'LEDGER-PROMOTION-LINK', 'pointer and promotion packages do not match', '.promotion.package', 'INCOMPLETE');
  if (promotion?.package && GATES[promotion.package] && promotion.requiredGate !== GATES[promotion.package]) add(errors, 'LEDGER-PROMOTION-LINK', `promotion requiredGate must be ${GATES[promotion.package]}`, '.promotion.requiredGate', 'INCOMPLETE');
  const promotionCommit = byChain.get(promotion?.promotionCommitHash);
  if (!promotionCommit || promotionCommit.recordKind !== 'promotion-commit' || promotionCommit.state !== 'committed') {
    add(errors, 'LEDGER-PROMOTION-MISSING', 'promotionCommitHash does not resolve to a committed promotion-commit record', '.promotion.promotionCommitHash', 'INCOMPLETE');
  } else {
    const payload = promotionCommit.payload ?? {};
    const checks = [
      ['package', promotion.package, payload.package],
      ['targetArtifactId', promotion.targetArtifactId, payload.targetArtifactId],
      ['targetHash', promotion.targetHash, payload.targetHash],
      ['pointerHash', fields.pointerHash, payload.pointerHash],
      ['predecessorClosureHash', promotion.predecessorClosureHash, payload.predecessorClosureHash],
    ];
    // `pointerHash` is optional in legacy promotion records because including
    // both it and promotionCommitHash in each other's preimage is circular.
    // When present it is authenticated and must agree; target/closure links
    // remain mandatory through the pointer fields above.
    for (const [name, expected, actual] of checks) if (actual !== undefined && expected !== actual) add(errors, 'LEDGER-PROMOTION-LINK', `promotion-commit payload ${name} does not match pointer`, `.promotionCommit.payload.${name}`, 'INCOMPLETE');
    if (promotion?.package === 'R29' && promotion.state === 'ready') {
      const qualification = byChain.get(payload.qualificationCommitHash);
      if (!qualification || qualification.recordKind !== 'commit' || qualification.state !== 'committed') {
        add(errors, 'LEDGER-QUALIFICATION-MISSING', 'R29 ready promotion must resolve a committed qualification commit', '.promotionCommit.payload.qualificationCommitHash', 'INCOMPLETE');
      } else if (qualification.payload?.status !== undefined && qualification.payload.status !== 'PASS') {
        add(errors, 'LEDGER-QUALIFICATION-STATUS', 'R29 ready promotion requires qualification status PASS', '.promotionCommit.payload.qualificationCommitHash', 'INCOMPLETE');
      }
      if (payload.eventKind !== undefined && payload.eventKind !== 'promotion-pointer-commit') add(errors, 'LEDGER-PROMOTION-LINK', 'R29 promotion eventKind must be promotion-pointer-commit', '.promotionCommit.payload.eventKind', 'INCOMPLETE');
      if (payload.reportSha256 !== undefined && qualification?.payload?.reportSha256 !== undefined && payload.reportSha256 !== qualification.payload.reportSha256) add(errors, 'LEDGER-PROMOTION-LINK', 'R29 reportSha256 does not match qualification commit', '.promotionCommit.payload.reportSha256', 'INCOMPLETE');
    }
  }

  if (head) {
    const lastChain = rows.length ? rows[rows.length - 1].record.chainHash : effectiveGenesisHash;
    const lastCommitted = committed.length ? committed[committed.length - 1].recordHash : null;
    const headChain = head.lastChainHash ?? head.lastPhysicalChainHash;
    const headSequence = head.physicalSequence;
    if (headChain !== lastChain || (headSequence !== undefined && headSequence !== (rows.length ? rows[rows.length - 1].record.physicalSequence : 0)) || (head.lastCommittedEventHash !== undefined && head.lastCommittedEventHash !== lastCommitted)) {
      add(errors, 'LEDGER-HEAD-MISMATCH', 'cached head disagrees with the verified physical chain; recovery is required', '.head', 'INCOMPLETE');
    }
  }
  const status = resultStatus(errors);
  const history = summarizeLedgerHistory(rows);
  return {
    validatorVersion: VALIDATOR_VERSION,
    status,
    files: loaded.files,
    records: rows.length,
    lastChainHash: rows.length ? rows[rows.length - 1].record.chainHash : effectiveGenesisHash,
    promotionCommit: promotionCommit ?? null,
    promotionTimelines: history.promotionTimelines,
    recoveryReceiptIds: history.recoveryReceiptIds,
    errors,
  };
}

function roleAuthorized(record, roster, errors, entry) {
  const meta = metaOf(record);
  if (!ROLES.has(meta.ownerRole)) add(errors, 'ROLE-01', `unknown owner role ${meta.ownerRole}`, '.ownerRole');
  if (entry?.ownerRoles?.length && !entry.ownerRoles.includes(meta.ownerRole)) {
    add(errors, 'ROLE-01', `owner role ${meta.ownerRole} is not allowed for ${meta.artifactId}`, '.ownerRole');
  }
  const assignment = (roster?.assignments ?? []).find((item) => item.principalId === meta.ownerId
    && item.roleId === meta.ownerRole
    && (item.package === '*' || item.package === meta.package)
    && (!item.validFrom || Date.parse(item.validFrom) <= Date.parse(meta.createdAt))
    && (!item.validUntil || Date.parse(meta.createdAt) <= Date.parse(item.validUntil))
    && (item.scope === '*' || String(meta.recordId).includes(String(item.scope))));
  if (!assignment) add(errors, 'ROLE-01', `owner ${meta.ownerId}/${meta.ownerRole} is not authorized for ${meta.artifactId}`, '.ownerId');
}

function checkCandidateVisibility(record, errors) {
  const meta = metaOf(record);
  if (meta.visibility !== 'candidate-visible') return;
  const forbidden = /(gold|grader|reviewer|adjudicat|calibration|hidden.?locator|pointer.?hash)/i;
  const visit = (value, at) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.test(key)) add(errors, 'VIS-GOLD-LEAK', `candidate-visible record contains grader-only field ${key}`, `${at}.${key}`);
      visit(child, `${at}.${key}`);
    }
  };
  visit(payloadOf(record), '.payload');
}

function checkRoleSeparation(record, errors, conflicts) {
  const payload = payloadOf(record);
  if (!payload || typeof payload !== 'object') return;
  const pairs = [
    ['taskAuthorId', 'goldReviewerAId', 'ROLE-02'],
    ['taskAuthorId', 'goldReviewerBId', 'ROLE-02'],
    ['taskAuthorId', 'calibrationAdjudicatorId', 'ROLE-02'],
    ['goldReviewerAId', 'goldReviewerBId', 'ROLE-03'],
    ['graderAId', 'graderBId', 'ROLE-05'],
    ['runOperatorId', 'graderAId', 'ROLE-04'],
    ['runOperatorId', 'graderBId', 'ROLE-04'],
    ['runOperatorId', 'adjudicatorId', 'ROLE-04'],
    ['costMeterOwnerId', 'runOperatorId', 'ROLE-07'],
    ['liveAuthorizationOwnerId', 'runOperatorId', 'ROLE-07'],
  ];
  for (const [left, right, code] of pairs) {
    if (payload[left] && payload[right] && payload[left] === payload[right]) {
      const message = `${left} and ${right} resolve to the same principal ${payload[left]}`;
      add(errors, code, message, `.payload.${left}`);
      conflicts.push({ code, artifactId: metaOf(record).artifactId, left, right, principalId: payload[left] });
    }
  }
}

function checkArtifactSemantics(record, errors) {
  const meta = metaOf(record);
  const payload = payloadOf(record);
  if (!payload || typeof payload !== 'object') return;
  if (meta.artifactId === 'R28-03') {
    for (const key of ['localThreshold', 'thresholdOverride', 'outcomeOverride']) {
      if (key in payload) add(errors, 'ENV-LOCAL-OVERRIDE', `${key} is not permitted in the report schema`, `.payload.${key}`);
    }
  }
  if (meta.artifactId === 'R29-06') {
    const tasks = payload.tasks ?? payload.taskRecords ?? payload.taskKeys;
    if (Array.isArray(tasks)) {
      if (tasks.length !== 24) add(errors, 'R29-TASK-COUNT', `gold lock contains ${tasks.length} task(s), expected 24`, '.payload.tasks');
      const labels = tasks.flatMap((task) => (Array.isArray(task?.calibrationLabels) ? task.calibrationLabels : []));
      if (labels.length && ![0, 0.5, 1].every((label) => labels.includes(label))) add(errors, 'R29-LABEL-COVERAGE', 'calibration labels must include 0, 0.5, and 1', '.payload.tasks');
    }
  }
  if (meta.artifactId === 'R30-05' && pointerPayload(record)?.state === 'ready') add(errors, 'PTR-STATE', 'R30-05 may publish provisional-cold only', '.promotion.state');
  if (meta.artifactId === 'R31-03' && pointerPayload(record)?.state === 'provisional-cold') add(errors, 'PTR-STATE', 'R31-03 must publish the frozen-release ready state', '.promotion.state');
  if (meta.artifactId === 'R31-03' && payload.eligibleWarmCost !== undefined && payload.eligibleWarmCost !== 0) add(errors, 'R31-COST', 'eligible warm cost must be zero', '.payload.eligibleWarmCost');
  if (meta.artifactId === 'R32-05' && pointerPayload(record)?.state === 'ready') {
    const expiry = pointerPayload(record)?.liveVerifiedUntil ?? payload.liveVerifiedUntil;
    if (!expiry || Number.isNaN(Date.parse(expiry))) add(errors, 'PTR-EXPIRY', 'R32 ready roll-up requires liveVerifiedUntil', '.payload.liveVerifiedUntil');
  }
}

function snapshotRefs(record) {
  const payload = payloadOf(record);
  const meta = metaOf(record);
  return payload?.pathAuthoritySnapshots
    ?? payload?.path_authority_snapshots
    ?? payload?.snapshotHashes
    ?? payload?.snapshot_hashes
    ?? meta?.pathAuthoritySnapshots
    ?? meta?.path_authority_snapshots
    ?? meta?.snapshotHashes
    ?? meta?.snapshot_hashes
    ?? null;
}

function snapshotHash(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const unsigned = { ...snapshot };
  delete unsigned.envelope_canonical_sha256;
  return sha256(canonicalJson(unsigned));
}

function snapshotRefValue(ref) {
  if (typeof ref === 'string') return { envelopeCanonicalSha256: ref };
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
  return ref;
}

/**
 * Validate the path-authority snapshot references attached to a promotion
 * target. This is deliberately exported so release tooling can run the same
 * check before writing a pointer. It is read-only; referenced files are read
 * below `root` and never rewritten.
 */
export function validateSnapshotEvidence(record, { root = null, now = Date.now(), maxAgeMs = SNAPSHOT_MAX_AGE_MS } = {}) {
  const errors = [];
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    add(errors, 'INPUT-SNAPSHOT-MAX-AGE', 'snapshot age allowance must be a finite non-negative number', '--snapshot-max-age-ms', 'INCOMPLETE');
    return { status: resultStatus(errors), errors };
  }
  const meta = metaOf(record);
  const refs = snapshotRefs(record);
  if (!refs || typeof refs !== 'object' || Array.isArray(refs)) {
    add(errors, 'SNAPSHOT-MISSING', 'promotion requires before, after, and recovery path-authority snapshots', '.payload.pathAuthoritySnapshots', 'INCOMPLETE');
    return { status: resultStatus(errors), errors };
  }
  const phases = ['before', 'after', 'recovery'];
  const expectedGate = GATES[meta.package];
  const seenIds = new Set();
  for (const phase of phases) {
    const ref = snapshotRefValue(refs[phase]);
    const at = `.payload.pathAuthoritySnapshots.${phase}`;
    if (!ref) { add(errors, 'SNAPSHOT-MISSING', `${phase} path-authority snapshot reference is missing`, at, 'INCOMPLETE'); continue; }
    const declaredHash = ref.envelopeCanonicalSha256 ?? ref.envelope_canonical_sha256 ?? ref.hash;
    const snapshotId = ref.snapshotId ?? ref.snapshot_id;
    const capturedAt = ref.capturedAt ?? ref.captured_at;
    const status = ref.status;
    if (!HASH.test(String(declaredHash ?? ''))) add(errors, 'SNAPSHOT-HASH', `${phase} snapshot reference must contain a lowercase SHA-256 hash`, `${at}.envelopeCanonicalSha256`, 'INCOMPLETE');
    if (typeof snapshotId !== 'string' || !snapshotId) add(errors, 'SNAPSHOT-MISSING', `${phase} snapshotId is required`, `${at}.snapshotId`, 'INCOMPLETE');
    else if (seenIds.has(snapshotId)) add(errors, 'SNAPSHOT-DUPLICATE', `snapshotId ${snapshotId} is reused`, `${at}.snapshotId`);
    else seenIds.add(snapshotId);
    if (status !== 'PASS') add(errors, 'SNAPSHOT-STATUS', `${phase} snapshot must have status PASS`, `${at}.status`);
    const capturedMs = typeof capturedAt === 'string' && UTC.test(capturedAt) ? Date.parse(capturedAt) : NaN;
    if (!Number.isFinite(capturedMs)) add(errors, 'SNAPSHOT-TIME', `${phase} capturedAt must be UTC ISO-8601 with Z`, `${at}.capturedAt`, 'INCOMPLETE');
    else if (capturedMs > now) add(errors, 'SNAPSHOT-FUTURE', `${phase} snapshot is dated in the future`, `${at}.capturedAt`);
    else if (now - capturedMs > maxAgeMs) add(errors, 'SNAPSHOT-STALE', `${phase} path-authority snapshot is older than the allowed ${maxAgeMs}ms`, `${at}.capturedAt`);

    const fileName = ref.path ?? ref.file ?? ref.evidencePath;
    if (fileName === undefined) {
      add(errors, 'SNAPSHOT-EVIDENCE-MISSING', `${phase} snapshot evidence path is required for promotion`, `${at}.path`, 'INCOMPLETE');
      continue;
    }
    if (fileName !== undefined) {
      if (!root) { add(errors, 'SNAPSHOT-EVIDENCE-MISSING', `${phase} snapshot path cannot be resolved without a record root`, `${at}.path`, 'INCOMPLETE'); continue; }
      let file;
      try { file = safePath(root, fileName); }
      catch (error) { add(errors, 'SNAPSHOT-EVIDENCE-MISSING', error.message, `${at}.path`, 'INCOMPLETE'); continue; }
      const loaded = readJson(file);
      if (loaded.error) { add(errors, 'SNAPSHOT-EVIDENCE-MISSING', loaded.error.message, file, 'INCOMPLETE'); continue; }
      const value = loaded.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) { add(errors, 'SNAPSHOT-INVALID', `${phase} snapshot must be a JSON object`, file); continue; }
      if (value.snapshot_kind !== 'git-origin-path-authority') add(errors, 'SNAPSHOT-INVALID', `${phase} snapshot has an unsupported snapshot_kind`, `${at}.snapshotKind`);
      if (typeof value.gate_id !== 'string' || typeof value.package !== 'string' || typeof value.phase !== 'string') add(errors, 'SNAPSHOT-INVALID', `${phase} snapshot is missing gate/package/phase identity`, file);
      if (value.snapshot_id !== snapshotId) add(errors, 'SNAPSHOT-LINK', `${phase} snapshotId does not match the referenced envelope`, `${at}.snapshotId`);
      if (value.phase !== phase) add(errors, 'SNAPSHOT-LINK', `${phase} reference points to a ${value.phase ?? 'missing'} snapshot`, `${at}.phase`);
      if (meta.package && value.package !== meta.package) add(errors, 'SNAPSHOT-LINK', `${phase} snapshot package does not match release package`, `${at}.package`);
      if (expectedGate && value.gate_id !== expectedGate) add(errors, 'SNAPSHOT-LINK', `${phase} snapshot gate does not match release gate ${expectedGate}`, `${at}.gateId`);
      if (value.status !== 'PASS') add(errors, 'SNAPSHOT-INVALID', `${phase} snapshot envelope is not PASS`, file);
      if (value.envelope_canonical_sha256 !== declaredHash || snapshotHash(value) !== declaredHash) add(errors, 'SNAPSHOT-HASH', `${phase} snapshot envelope hash does not match the release reference`, `${at}.envelopeCanonicalSha256`);
      if (capturedAt && value.captured_at !== capturedAt) add(errors, 'SNAPSHOT-LINK', `${phase} capturedAt does not match the referenced envelope`, `${at}.capturedAt`);
    }
  }
  return { status: resultStatus(errors), errors };
}

function checkPredecessors(record, entry, context, errors) {
  const meta = metaOf(record);
  context.closure.checked ??= new Set();
  context.closure.active ??= new Set();
  if (context.closure.checked.has(meta.artifactId)) return;
  if (context.closure.active.has(meta.artifactId)) {
    add(errors, 'PRE-CYCLE', `predecessor cycle reaches ${meta.artifactId}`, '.predecessorHashes');
    context.closure.mismatched.push(meta.artifactId);
    return;
  }
  context.closure.active.add(meta.artifactId);
  context.closure.checked.add(meta.artifactId);
  const expected = [];
  for (const selector of entry.predecessors ?? []) {
    if (!selector || typeof selector !== 'object') { add(errors, 'PRE-MISMATCH', 'invalid predecessor selector', '.predecessors'); continue; }
    if (selector.kind === 'external') {
      const hash = selector.hash ?? context.registry?.externalRoots?.[selector.id];
      if (!HASH.test(String(hash ?? ''))) {
        add(errors, 'PRE-MISSING', `missing external root ${selector.id ?? ''}`, '.predecessorHashes', 'INCOMPLETE');
        context.closure.missing.push(selector.id ?? 'external');
        continue;
      }
      expected.push(hash);
      context.closure.rootHashes.push(hash);
      continue;
    }
    if (selector.kind === 'artifact') {
      const predecessor = context.records.get(selector.artifactId);
      if (!predecessor) {
        add(errors, 'PRE-MISSING', `missing predecessor artifact ${selector.artifactId}`, '.predecessorHashes', 'INCOMPLETE');
        context.closure.missing.push(selector.artifactId);
        continue;
      }
      const predecessorMeta = metaOf(predecessor.record);
      if ((PACKAGE_ORDER[predecessorMeta.package] ?? Infinity) > (PACKAGE_ORDER[meta.package] ?? -Infinity)) {
        add(errors, 'PRE-ORDER', `predecessor ${selector.artifactId} is from a later package`, '.predecessorHashes');
      }
      const hash = selector.hash ?? predecessorMeta.recordHash ?? predecessorMeta.payloadSha256;
      expected.push(hash);
      context.closure.visited.push(metaOf(predecessor.record).artifactId);
      if (metaOf(predecessor.record).state !== 'sealed') add(errors, 'PRE-STATE', `predecessor ${selector.artifactId} is not sealed`, '.predecessorHashes');
      const recomputed = predecessorMeta.recordHash
        ? recordHash(predecessor.record)
        : payloadHash(payloadOf(predecessor.record));
      if (recomputed !== hash) {
        add(errors, 'PRE-HASH', `predecessor ${selector.artifactId} payload hash does not verify`, '.predecessorHashes');
        context.closure.mismatched.push(selector.artifactId);
      }
      if (predecessor.entry) checkPredecessors(predecessor.record, predecessor.entry, context, errors);
      continue;
    }
    add(errors, 'PRE-MISMATCH', 'unknown predecessor selector kind', '.predecessors');
  }
  if (!same(meta.predecessorHashes ?? [], expected)) {
    add(errors, 'PRE-MISMATCH', 'predecessorHashes do not match registry order', '.predecessorHashes');
    context.closure.mismatched.push(meta.artifactId);
  }
  const seen = new Set();
  for (const hash of meta.predecessorHashes ?? []) {
    if (!HASH.test(String(hash))) add(errors, 'ENV-HASH', `invalid predecessor hash ${hash}`, '.predecessorHashes');
    if (seen.has(hash)) add(errors, 'PRE-DUPLICATE', `duplicate predecessor hash ${hash}`, '.predecessorHashes');
    seen.add(hash);
  }
  context.closure.active.delete(meta.artifactId);
}

export function validateEnvelope(record, entry, context = {}) {
  const errors = [];
  context.registry ??= {};
  context.records ??= new Map();
  context.closure ??= { rootHashes: [], visited: [], missing: [], mismatched: [] };
  const allowed = new Set([
    'artifactId', 'schema', 'benchmarkSpecVersion', 'benchmarkSpecSha256', 'package', 'recordId',
    'ownerRole', 'ownerId', 'roleRosterSha256', 'createdAt', 'predecessorHashes', 'payloadSha256',
    'state', 'visibility', 'payload', 'pathAuthoritySnapshots', 'promotion', 'pointerHash', 'signature', 'recordHash',
  ]);
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    add(errors, 'ENV-TYPE', 'record must be a JSON object', '$', 'INCOMPLETE');
    return { artifactId: entry?.artifactId ?? null, recordId: null, status: resultStatus(errors), checks: [], errors };
  }
  const meta = metaOf(record);
  if (nestedRecord(record)) {
    for (const key of Object.keys(record)) if (!new Set(['envelope', 'payload']).has(key)) add(errors, 'ENV-UNKNOWN-KEY', `unknown record key ${key}`, `.${key}`);
    for (const key of Object.keys(meta)) if (!allowed.has(key)) add(errors, 'ENV-UNKNOWN-KEY', `unknown envelope key ${key}`, `.envelope.${key}`);
  } else {
    for (const key of Object.keys(record)) if (!allowed.has(key)) add(errors, 'ENV-UNKNOWN-KEY', `unknown envelope key ${key}`, `.${key}`);
  }
  const required = ['artifactId', 'schema', 'benchmarkSpecVersion', 'benchmarkSpecSha256', 'package', 'recordId', 'ownerRole', 'ownerId', 'roleRosterSha256', 'createdAt', 'predecessorHashes', 'payloadSha256', 'state', 'visibility', 'payload'];
  for (const key of required) {
    const present = key === 'payload' ? (context.contentHash ? true : ('payload' in record)) : (key in meta);
    if (!present) add(errors, 'ENV-MISSING', `missing envelope field ${key}`, nestedRecord(record) ? `.envelope.${key}` : `.${key}`, 'INCOMPLETE');
  }
  if (entry && meta.artifactId !== entry.artifactId) add(errors, 'ENV-ARTIFACT', `artifactId ${meta.artifactId} does not match registry ${entry.artifactId}`, nestedRecord(record) ? '.envelope.artifactId' : '.artifactId');
  if (!Number.isInteger(meta.schema) || meta.schema < 1) add(errors, 'ENV-SCHEMA', 'schema must be a positive integer', nestedRecord(record) ? '.envelope.schema' : '.schema');
  else if (entry?.schema && meta.schema > entry.schema) add(errors, 'ENV-FUTURE-SCHEMA', `schema ${meta.schema} is newer than supported ${entry.schema}`, nestedRecord(record) ? '.envelope.schema' : '.schema');
  if (meta.benchmarkSpecVersion !== '1.0.0') add(errors, 'ENV-CONTRACT', 'benchmarkSpecVersion must be 1.0.0', '.benchmarkSpecVersion');
  if (context.registry?.benchmarkSpecSha256 && meta.benchmarkSpecSha256 !== context.registry.benchmarkSpecSha256) add(errors, 'ENV-CONTRACT', 'benchmarkSpecSha256 does not match registry', '.benchmarkSpecSha256');
  if (meta.package !== entry?.package) add(errors, 'ENV-PACKAGE', `package ${meta.package} does not match registry`, '.package');
  if (!HASH.test(String(meta.benchmarkSpecSha256 ?? ''))) add(errors, 'ENV-HASH', 'benchmarkSpecSha256 must be lowercase SHA-256', '.benchmarkSpecSha256');
  if (!HASH.test(String(meta.roleRosterSha256 ?? ''))) add(errors, 'ENV-HASH', 'roleRosterSha256 must be lowercase SHA-256', '.roleRosterSha256');
  if (context.registry?.roleRosterSha256 && meta.roleRosterSha256 !== context.registry.roleRosterSha256) add(errors, 'ROLE-10', 'role roster hash does not match registry', '.roleRosterSha256', 'REOPEN');
  if (typeof meta.recordId !== 'string' || !meta.recordId) add(errors, 'ENV-RECORD-ID', 'recordId must be non-empty', '.recordId', 'INCOMPLETE');
  if (typeof meta.createdAt !== 'string' || !UTC.test(meta.createdAt) || Number.isNaN(Date.parse(meta.createdAt))) add(errors, 'ENV-TIME', 'createdAt must be UTC ISO-8601 with Z', '.createdAt');
  else if (context.now && Date.parse(meta.createdAt) > context.now) add(errors, 'ENV-TIME-FUTURE', 'createdAt is in the future', '.createdAt');
  if (meta.state !== 'sealed') add(errors, 'ENV-STATE', 'evidence record must be sealed', '.state');
  if (meta.visibility !== entry?.visibility) add(errors, 'ENV-VISIBILITY', 'visibility does not match registry', '.visibility');
  if (!Array.isArray(meta.predecessorHashes)) add(errors, 'ENV-PREDECESSORS', 'predecessorHashes must be an array', '.predecessorHashes', 'INCOMPLETE');
  if (!HASH.test(String(meta.payloadSha256 ?? ''))) add(errors, 'ENV-HASH', 'payloadSha256 must be lowercase SHA-256', '.payloadSha256');
  else if (context.contentHash) {
    if (context.contentHash !== meta.payloadSha256) add(errors, 'ENV-HASH', 'payloadSha256 does not match canonical Markdown bytes', '.payloadSha256');
  } else if ('payload' in record) {
    try { if (payloadHash(record.payload) !== meta.payloadSha256) add(errors, 'ENV-HASH', 'payloadSha256 does not match canonical payload bytes', '.payloadSha256'); }
    catch (error) { add(errors, 'ENV-PAYLOAD', error.message, '.payload'); }
  }
  if (meta.recordHash && recordHash(record) !== meta.recordHash) add(errors, 'ENV-RECORD-HASH', 'recordHash does not match canonical record bytes', '.recordHash');
  if (context.roster) roleAuthorized(record, context.roster, errors, entry);
  checkCandidateVisibility(record, errors);
  checkRoleSeparation(record, errors, context.roleConflicts ?? []);
  checkArtifactSemantics(record, errors);
  if (entry) checkPredecessors(record, entry, context, errors);
  return {
    artifactId: meta.artifactId,
    recordId: meta.recordId,
    status: resultStatus(errors),
    checks: errors.map((error) => error.code),
    errors,
  };
}

function pointerPayload(pointer) { return pointer?.promotion ?? pointer?.payload?.promotion ?? null; }

function validatePointer(pointer, entry, context, errors) {
  const meta = metaOf(pointer);
  const promotion = pointerPayload(pointer);
  if (!promotion || typeof promotion !== 'object') { add(errors, 'PTR-STATE', 'promotion object is missing', '.promotion'); return; }
  if (meta.artifactId !== entry.artifactId) add(errors, 'PTR-LINK', 'pointer artifactId does not match registry', '.artifactId');
  if (meta.package !== entry.package) add(errors, 'PTR-PACKAGE', 'pointer envelope package does not match registry', '.package');
  if (meta.state !== undefined && meta.state !== 'sealed') add(errors, 'PTR-STATE', 'pointer envelope must be sealed', '.state');
  if (context.registry?.benchmarkSpecSha256 && meta.benchmarkSpecSha256 && meta.benchmarkSpecSha256 !== context.registry.benchmarkSpecSha256) add(errors, 'PTR-LINK', 'pointer benchmark hash does not match registry', '.benchmarkSpecSha256');
  if (context.registry?.roleRosterSha256 && meta.roleRosterSha256 && meta.roleRosterSha256 !== context.registry.roleRosterSha256) add(errors, 'ROLE-10', 'pointer role roster hash does not match registry', '.roleRosterSha256', 'REOPEN');
  if (meta.payloadSha256 && 'payload' in pointer && payloadHash(pointer.payload) !== meta.payloadSha256) add(errors, 'PTR-LINK', 'pointer payload hash does not verify', '.payloadSha256');
  if (meta.recordHash && recordHash(pointer) !== meta.recordHash) add(errors, 'PTR-HASH', 'pointer recordHash does not verify', '.recordHash');
  const declaredPointerHash = pointer.payload?.pointerHash ?? pointer.pointerHash;
  if (declaredPointerHash) {
    const unsigned = nestedRecord(pointer)
      ? { envelope: { ...pointer.envelope }, payload: { ...pointer.payload } }
      : { ...pointer };
    if (nestedRecord(pointer)) {
      delete unsigned.payload.pointerHash;
      delete unsigned.payload.signature;
    } else {
      delete unsigned.pointerHash;
      delete unsigned.signature;
    }
    if (sha256(canonicalJson(unsigned)) !== declaredPointerHash) add(errors, 'PTR-HASH', 'pointerHash does not verify', '.payload.pointerHash');
  }
  const expectedGate = GATES[entry.package];
  if (promotion.package !== entry.package) add(errors, 'PTR-PACKAGE', 'pointer package does not match registry', '.promotion.package');
  if (promotion.requiredGate !== expectedGate) add(errors, 'PTR-GATE', `requiredGate must be ${expectedGate}`, '.promotion.requiredGate');
  const target = context.records.get(entry.artifactId);
  if (!target) { add(errors, 'PTR-TARGET', 'pointer target record is missing', '.promotion.targetHash', 'INCOMPLETE'); return; }
  if (promotion.targetArtifactId && promotion.targetArtifactId !== entry.artifactId) add(errors, 'PTR-TARGET', 'targetArtifactId does not match registry', '.promotion.targetArtifactId');
  if (promotion.targetHash !== metaOf(target.record).payloadSha256) add(errors, 'PTR-TARGET', 'targetHash does not equal sealed target payload hash', '.promotion.targetHash');
  const expectedClosure = sha256(canonicalJson(metaOf(target.record).predecessorHashes ?? []));
  if (promotion.predecessorClosureHash !== expectedClosure) add(errors, 'PTR-CLOSURE', 'predecessorClosureHash does not match ordered predecessor hashes', '.promotion.predecessorClosureHash');
  const states = new Set(['not-published', 'provisional-cold', 'ready', 'revoked']);
  if (!states.has(promotion.state)) add(errors, 'PTR-STATE', `unknown promotion state ${promotion.state}`, '.promotion.state');
  if (!HASH.test(String(promotion.promotionCommitHash ?? ''))) add(errors, 'PTR-COMMIT', 'promotionCommitHash must identify a committed ledger event', '.promotion.promotionCommitHash', 'INCOMPLETE');
  if (entry.package === 'R30' && promotion.state === 'ready') add(errors, 'PTR-STATE', 'R30 may publish provisional-cold only', '.promotion.state');
  if (entry.package === 'R32' && promotion.state === 'ready') {
    const expiry = promotion.liveVerifiedUntil ?? pointer.payload?.liveVerifiedUntil;
    if (!expiry || Number.isNaN(Date.parse(expiry)) || Date.parse(expiry) <= (context.now ?? Date.now())) add(errors, 'PTR-EXPIRY', 'R32 ready pointer requires an unexpired liveVerifiedUntil', '.promotion.liveVerifiedUntil');
  }
  if (!('previousPointerHash' in promotion)) add(errors, 'PTR-ATOMIC', 'previousPointerHash is required', '.promotion.previousPointerHash', 'INCOMPLETE');
  if (!Array.isArray(promotion.revokedDescendantHashes)) add(errors, 'PTR-ATOMIC', 'revokedDescendantHashes must be an array', '.promotion.revokedDescendantHashes', 'INCOMPLETE');
  if (promotion.generation !== undefined && (!Number.isInteger(promotion.generation) || promotion.generation < 1)) add(errors, 'PTR-ATOMIC', 'generation must be a positive integer', '.promotion.generation', 'INCOMPLETE');
  if (promotion.state === 'revoked' && !HASH.test(String(promotion.rollbackRecordHash ?? ''))) add(errors, 'PTR-ROLLBACK', 'revoked pointer requires rollbackRecordHash', '.promotion.rollbackRecordHash', 'INCOMPLETE');
}

function collectJsonFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const result = [];
  const walk = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile() && item.name.endsWith('.json')) result.push(full);
    }
  };
  walk(dir);
  return result.sort(compareText);
}

export function listJsonFiles(dir) {
  return collectJsonFiles(dir);
}

export function runSchemaConformance({ files = [], schemaPath, schema } = {}) {
  const errors = [];
  let actualSchema = schema;
  if (!actualSchema && schemaPath) {
    const loaded = readJson(schemaPath);
    if (loaded.error) return { validatorVersion: VALIDATOR_VERSION, status: 'INCOMPLETE', files: [], errors: [{ code: 'SCHEMA-READ', message: loaded.error.message, path: schemaPath, status: 'INCOMPLETE' }] };
    actualSchema = loaded.value;
  }
  if (!actualSchema) return { validatorVersion: VALIDATOR_VERSION, status: 'INCOMPLETE', files: [], errors: [{ code: 'SCHEMA-READ', message: 'schema is required', path: '$', status: 'INCOMPLETE' }] };
  if (!files.length) return { validatorVersion: VALIDATOR_VERSION, status: 'INCOMPLETE', files: [], errors: [{ code: 'SCHEMA-NO-FILES', message: 'at least one JSON file is required', path: '$', status: 'INCOMPLETE' }] };
  for (const file of [...files].sort(compareText)) {
    const loaded = readJson(file);
    if (loaded.error) { errors.push({ code: loaded.code ?? 'SCHEMA-READ', message: loaded.error.message, path: file, status: 'INCOMPLETE' }); continue; }
    const local = [];
    validateJsonSchema(loaded.value, actualSchema, { errors: local });
    for (const error of local) errors.push({ ...error, path: `${file}:${error.path}`, status: 'FAIL' });
  }
  return { validatorVersion: VALIDATOR_VERSION, status: resultStatus(errors), files: [...files].sort(), errors };
}

function loadSchema(schemaDir, name) {
  const loaded = readJson(path.join(schemaDir, name));
  return loaded.error ? { value: null, error: loaded.error } : loaded;
}

export function validateRelease({ root, package: packageName, registryPath, rolesPath, pointersDir, schemaDir = DEFAULT_SCHEMA_DIR, ledgerPath = null, headPath = null, genesisPath = null, checkpointsDir = null, genesisHash = '0'.repeat(64), publicKeys = {}, now = Date.now(), snapshotMaxAgeMs = SNAPSHOT_MAX_AGE_MS } = {}) {
  const errors = [];
  const output = {
    validatorVersion: VALIDATOR_VERSION,
    package: packageName ?? null,
    status: 'INCOMPLETE',
    contract: { benchmarkSpecVersion: '1.0.0', benchmarkSpecSha256: null },
    artifacts: [],
    predecessorClosure: { rootHashes: [], visited: [], missing: [], mismatched: [] },
    roles: { checked: [], conflicts: [] },
    promotion: { pointer: null, state: 'not-published', status: 'INCOMPLETE' },
    ledger: { checked: false, status: 'NOT-CHECKED', records: 0, lastChainHash: null },
    promotionTimelines: Object.fromEntries(['R28', 'R29', 'R30', 'R31', 'R32', 'R33'].map((name) => [name, []])),
    recoveryReceiptIds: [],
    errors,
  };
  if (!Number.isFinite(snapshotMaxAgeMs) || snapshotMaxAgeMs < 0) {
    add(errors, 'INPUT-SNAPSHOT-MAX-AGE', 'snapshot age allowance must be a finite non-negative number', '--snapshot-max-age-ms', 'INCOMPLETE');
    return output;
  }
  if (!root || !fs.existsSync(root) || !inside(process.cwd(), root) && !path.isAbsolute(root)) add(errors, 'INPUT-ROOT', 'root must name an existing directory', '--root', 'INCOMPLETE');
  if (!PACKAGES.has(packageName)) add(errors, 'INPUT-PACKAGE', 'package must be R28, R29, R30, R31, or R32', '--package', 'INCOMPLETE');
  const registryLoaded = readJson(registryPath);
  const rosterLoaded = readJson(rolesPath);
  if (registryLoaded.error) add(errors, registryLoaded.code === 'JSON-DUPLICATE-KEY' ? registryLoaded.code : 'INPUT-REGISTRY', registryLoaded.error.message, registryPath, 'INCOMPLETE');
  if (rosterLoaded.error) add(errors, rosterLoaded.code === 'JSON-DUPLICATE-KEY' ? rosterLoaded.code : 'INPUT-ROLES', rosterLoaded.error.message, rolesPath, 'INCOMPLETE');
  const registry = registryLoaded.value;
  const roster = rosterLoaded.value;
  if (!registry || !roster || errors.length) {
    output.status = resultStatus(errors);
    return output;
  }
  output.contract = { benchmarkSpecVersion: registry.benchmarkSpecVersion ?? null, benchmarkSpecSha256: registry.benchmarkSpecSha256 ?? null };
  const registrySchema = loadSchema(schemaDir, 'artifact-registry.schema.json');
  const rosterSchema = loadSchema(schemaDir, 'role-roster.schema.json');
  if (registrySchema.error || rosterSchema.error) add(errors, 'INPUT-SCHEMA', 'validator schemas are unreadable', schemaDir, 'INCOMPLETE');
  else {
    for (const error of runSchemaConformance({ files: [registryPath], schema: registrySchema.value }).errors) errors.push(error);
    for (const error of runSchemaConformance({ files: [rolesPath], schema: rosterSchema.value }).errors) errors.push(error);
  }
  const allArtifacts = normalizeArtifacts(registry);
  const artifacts = allArtifacts.filter((entry) => entry.package === packageName);
  if (pointersDir && fs.existsSync(pointersDir) && !inside(root, pointersDir)) add(errors, 'PATH-CONTAINMENT', 'pointer directory escapes record root', pointersDir);
  if (ledgerPath && (!fs.existsSync(ledgerPath) || !inside(root, ledgerPath))) add(errors, 'LEDGER-PATH', 'ledger path must exist below record root', ledgerPath, 'INCOMPLETE');
  if (headPath && (!fs.existsSync(headPath) || !inside(root, headPath))) add(errors, 'LEDGER-PATH', 'head path must exist below record root', headPath, 'INCOMPLETE');
  if (genesisPath && (!fs.existsSync(genesisPath) || !inside(root, genesisPath))) add(errors, 'LEDGER-PATH', 'genesis path must exist below record root', genesisPath, 'INCOMPLETE');
  if (checkpointsDir && (!fs.existsSync(checkpointsDir) || !inside(root, checkpointsDir))) add(errors, 'LEDGER-PATH', 'checkpoints path must exist below record root', checkpointsDir, 'INCOMPLETE');
  // Only the ledger branch reads them: given without --ledger they would be dropped in silence,
  // which is how both flags went unread before 2026-10-11.
  if ((genesisPath || checkpointsDir) && !ledgerPath) add(errors, 'LEDGER-PATH', 'genesis and checkpoints are verified only with --ledger', genesisPath ?? checkpointsDir, 'INCOMPLETE');
  if (!artifacts.length) add(errors, 'INPUT-ARTIFACTS', `registry has no artifacts for ${packageName}`, '.artifacts', 'INCOMPLETE');
  if (!HASH.test(String(roster.rosterSha256 ?? ''))) add(errors, 'ROLE-ROSTER', 'role roster hash is invalid', '.rosterSha256');
  const records = new Map();
  // Load every registered artifact, not only the requested package: a package
  // validator must be able to authenticate cross-package predecessors such as
  // R28-04 when validating R29.
  for (const entry of allArtifacts) {
    let file;
    try { file = safePath(root, entry.path); } catch (error) { add(errors, 'PATH-CONTAINMENT', error.message, entry.path); continue; }
    if (/\.md$/i.test(entry.path)) {
      try { safePath(root, `${entry.path}.envelope.json`); } catch (error) { add(errors, 'PATH-CONTAINMENT', error.message, `${entry.path}.envelope.json`); continue; }
    }
    const loaded = readArtifactRecord(file);
    if (loaded.error) { add(errors, loaded.code === 'JSON-DUPLICATE-KEY' ? loaded.code : 'RECORD-READ', loaded.error.message, entry.path, 'INCOMPLETE'); continue; }
    records.set(entry.artifactId, { record: loaded.value, entry, file, contentHash: loaded.contentHash, sidecar: loaded.sidecar });
  }
  const context = { registry, roster, records, now, root, snapshotMaxAgeMs, closure: output.predecessorClosure, roleConflicts: output.roles.conflicts };
  const envelopeSchema = loadSchema(schemaDir, 'r28-r32-envelope.schema.json');
  for (const entry of artifacts) {
    const item = records.get(entry.artifactId);
    if (!item) continue;
    const result = validateEnvelope(item.record, entry, { ...context, contentHash: item.contentHash });
    output.artifacts.push(result);
    for (const error of result.errors) errors.push(error);
    if (!envelopeSchema.error && !item.contentHash) {
      const conformance = runSchemaConformance({ files: [item.file], schema: envelopeSchema.value });
      for (const error of conformance.errors) errors.push(error);
    }
    const meta = metaOf(item.record);
    if (meta.ownerRole && meta.ownerId) output.roles.checked.push(`${meta.artifactId}:${meta.ownerRole}:${meta.ownerId}`);
  }
  const pointerEntries = artifacts.filter((entry) => entry.pointer === true);
  for (const entry of pointerEntries) {
    const pointerFiles = collectJsonFiles(pointersDir).filter((file) => path.basename(file, '.json') === entry.artifactId || path.basename(file, '.pointer.json') === entry.artifactId);
    if (pointerFiles.length === 0) { add(errors, 'PTR-MISSING', `current pointer for ${entry.artifactId} is missing`, entry.artifactId, 'INCOMPLETE'); continue; }
    if (pointerFiles.length > 1) add(errors, 'PTR-SOLE', `multiple current pointers for ${entry.artifactId}`, entry.artifactId);
    const pointer = readJson(pointerFiles[0]);
    if (pointer.error) { add(errors, 'PTR-READ', pointer.error.message, pointerFiles[0], 'INCOMPLETE'); continue; }
    const pointerSchema = loadSchema(schemaDir, 'promotion-pointer.schema.json');
    if (!pointerSchema.error) for (const error of runSchemaConformance({ files: [pointerFiles[0]], schema: pointerSchema.value }).errors) errors.push(error);
    validatePointer(pointer.value, entry, context, errors);
    const promotion = pointerPayload(pointer.value);
    if (promotion && ['ready', 'provisional-cold'].includes(promotion.state)) {
      const target = records.get(entry.artifactId);
      if (target) {
        const snapshotResult = validateSnapshotEvidence(target.record, { root, now, maxAgeMs: snapshotMaxAgeMs });
        for (const error of snapshotResult.errors) errors.push(error);
      }
    }
    if (ledgerPath) {
      const loadedHead = headPath ? readJson(headPath) : { value: undefined, error: null };
      if (loadedHead.error) add(errors, 'LEDGER-HEAD-READ', loadedHead.error.message, headPath, 'INCOMPLETE');
      const ledgerResult = verifyQualificationLedger({
        ledgerPath,
        head: loadedHead.value,
        pointer: pointer.value,
        publicKeys,
        genesisHash,
        genesisPath,
        checkpointsDir,
        expectedBenchmarkSpecSha256: registry.benchmarkSpecSha256,
        expectedRoleRosterSha256: registry.roleRosterSha256,
        genesisSchemaPath: path.join(schemaDir, 'qualification-ledger-genesis.schema.json'),
        checkpointSchemaPath: path.join(schemaDir, 'qualification-ledger-checkpoint.schema.json'),
        roster,
        now,
      });
      output.ledger = {
        checked: true,
        status: ledgerResult.status,
        records: ledgerResult.records,
        lastChainHash: ledgerResult.lastChainHash,
      };
      output.promotionTimelines = ledgerResult.promotionTimelines;
      output.recoveryReceiptIds = ledgerResult.recoveryReceiptIds;
      for (const error of ledgerResult.errors) errors.push(error);
    }
    output.promotion = { pointer: pointerFiles[0], state: pointerPayload(pointer.value)?.state ?? 'not-published', status: resultStatus(errors) };
  }
  output.predecessorClosure.rootHashes = [...new Set(output.predecessorClosure.rootHashes)].sort();
  output.predecessorClosure.visited = [...new Set(output.predecessorClosure.visited)].sort();
  output.predecessorClosure.missing = [...new Set(output.predecessorClosure.missing)].sort();
  output.predecessorClosure.mismatched = [...new Set(output.predecessorClosure.mismatched)].sort();
  delete output.predecessorClosure.checked;
  output.status = resultStatus(errors);
  output.roles.checked.sort();
  return output;
}
