// R29 workbook linkage: strict shape and explicit offline cross-reference checks.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, describe, assert, assertEqual, cleanup, tempDir } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('r29-workbook-linkage');
import { runSchemaConformance } from '../lib/release-validator.mjs';

const SCHEMA = path.resolve('fetchproof/schemas/r29-workbook-linkage.schema.json');
const IDS = ['ST-01','ST-02','ST-03','ST-04','VO-01','VO-02','VO-03','VO-04','CO-01','CO-02','CO-03','CO-04','UN-01','UN-02','UN-03','UN-04','CC-01','CC-02','CC-03','CC-04','AE-01','AE-02','AE-03','AE-04'];
const LIVE_REASON = 'Live task excluded by R29-05 Frozen-only warm-manifest scope';
const h = (value) => crypto.createHash('sha256').update(value).digest('hex');

function link(artifactId, taskId, memberHash = h(`${artifactId}:${taskId}:member`)) {
  return { artifactId, recordId: `${artifactId}:${taskId}`, recordHash: h(`${artifactId}:${taskId}:record`), payloadSha256: h(`${artifactId}:${taskId}:payload`), memberKey: taskId, memberHash };
}

function bundle() {
  const rows = IDS.map((taskId) => {
    const track = taskId.startsWith('VO-') ? 'Live' : 'Frozen';
    const task = link('R29-01', taskId);
    const source = link('R29-03', taskId);
    const gold = link('R29-02', taskId);
    const calibration = link('R29-04', taskId);
    const warm = link('R29-05', taskId, track === 'Live' ? null : h(`R29-05:${taskId}:member`));
    const lock = { ...link('R29-06', taskId), predecessorClosureHash: h(`closure:${taskId}`) };
    return {
      taskId, worksheetPath: `worksheets/${taskId}.json`, worksheetHash: h(`worksheet:${taskId}`), track, rowVersion: '1.0.0',
      links: { task, gold, source, calibration, warm: { ...warm, memberState: track === 'Live' ? 'NOT-APPLICABLE' : 'PRESENT', warmScopeReason: track === 'Live' ? LIVE_REASON : null }, lock },
      rowStatus: 'PASS', ownerId: 'evidence-owner', independentVerifierId: 'release-verifier', lastVerifiedAt: '2026-09-16T00:00:00Z', blockerIds: [], rollbackRecordId: null,
    };
  });
  const records = [];
  for (const row of rows) {
    const { task, gold, source, calibration, warm, lock } = row.links;
    records.push({ ...task, state: 'sealed', predecessorRecordHashes: [h('R28-04')] });
    records.push({ ...source, state: 'sealed', predecessorRecordHashes: [task.recordHash] });
    records.push({ ...gold, state: 'sealed', predecessorRecordHashes: [task.recordHash, source.recordHash] });
    records.push({ ...calibration, state: 'sealed', trapId: `${row.taskId}-T`, predecessorRecordHashes: [gold.recordHash, source.recordHash] });
    records.push({ ...warm, state: 'sealed', predecessorRecordHashes: [task.recordHash, source.recordHash] });
    records.push({ ...lock, state: 'sealed', predecessorRecordHashes: [task.recordHash, gold.recordHash, source.recordHash, calibration.recordHash, warm.recordHash] });
  }
  return { register: { registerVersion: '1.0.0', profile: 'researcher-benchmark-c14n-v1', rows }, catalog: { catalogVersion: '1.0.0', records }, pointer: { package: 'R29', state: 'ready', targetHashes: rows.map((row) => row.links.lock.payloadSha256) } };
}

function schemaResult(value) {
  const root = tempDir('r29-linkage-schema-');
  const file = path.join(root, 'register.json');
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
  const result = runSchemaConformance({ files: [file], schemaPath: SCHEMA });
  cleanup(root);
  return result;
}

test('strict R29 linkage schema accepts a complete 24-row register and rejects unknown link fields', async () => {
  const { register } = bundle();
  const accepted = schemaResult(register);
  assertEqual(accepted.status, 'PASS', JSON.stringify(accepted));
  register.rows[0].links.gold.extra = true;
  const rejected = schemaResult(register);
  assertEqual(rejected.status, 'FAIL', JSON.stringify(rejected));
  assert(rejected.errors.some((error) => error.code === 'SCHEMA-ADDITIONAL'), JSON.stringify(rejected));
});

test('offline linkage validator closes all explicit R29 references for a valid 24-row register', async () => {
  const { validateR29WorkbookLinkage } = await import('../lib/r29-workbook-linkage-validator.mjs');
  const input = bundle();
  const result = validateR29WorkbookLinkage(input);
  assertEqual(result.status, 'PASS', JSON.stringify(result));
  assertEqual(result.rows.length, 24, JSON.stringify(result));
  assert(result.rows.every((row) => row.status === 'PASS'), JSON.stringify(result));
});

test('offline linkage validator rejects a gold link that resolves to another task', async () => {
  const { validateR29WorkbookLinkage } = await import('../lib/r29-workbook-linkage-validator.mjs');
  const input = bundle();
  input.register.rows[0].links.gold.memberKey = 'ST-02';
  const result = validateR29WorkbookLinkage(input);
  assertEqual(result.status, 'FAIL', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'R29-LINK-MEMBER-KEY'), JSON.stringify(result));
});

test('offline linkage validator rejects an invented Live warm member and reopens a revoked lock pointer', async () => {
  const { validateR29WorkbookLinkage } = await import('../lib/r29-workbook-linkage-validator.mjs');
  const live = bundle();
  live.register.rows[4].links.warm.memberState = 'PRESENT';
  live.register.rows[4].links.warm.memberHash = h('invented-live-warm');
  const invalid = validateR29WorkbookLinkage(live);
  assertEqual(invalid.status, 'FAIL', JSON.stringify(invalid));
  assert(invalid.errors.some((error) => error.code === 'R29-WARM-LIVE'), JSON.stringify(invalid));

  const revoked = bundle();
  revoked.pointer.state = 'revoked';
  const reopened = validateR29WorkbookLinkage(revoked);
  assertEqual(reopened.status, 'REOPEN', JSON.stringify(reopened));
  assert(reopened.errors.some((error) => error.code === 'R29-POINTER-STATE'), JSON.stringify(reopened));
});

test('offline linkage validator rejects duplicate explicit catalog identities', async () => {
  const { validateR29WorkbookLinkage } = await import('../lib/r29-workbook-linkage-validator.mjs');
  const input = bundle();
  input.catalog.records.push({ ...input.catalog.records[0] });
  const result = validateR29WorkbookLinkage(input);
  assertEqual(result.status, 'FAIL', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'R29-CATALOG-DUPLICATE'), JSON.stringify(result));
});
