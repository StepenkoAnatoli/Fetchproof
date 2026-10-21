// Synthetic completed FI bundle builder for offline end-to-end validator tests only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './harness.mjs';
import { buildZip } from '../lib/archive.mjs';

const FI_IDS = Array.from({ length: 30 }, (_, index) => `FI-${String(index + 1).padStart(2, '0')}`);
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const FIXED_DATE = '2026-09-17T00:00:00.000Z';
const ROLLED_BACK = new Set(['FI-06', 'FI-21', 'FI-24', 'FI-25', 'FI-29', 'FI-30']);

function cell(ref, value) { return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`; }
function sheet(cells) { return `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData><row r="1">${cells.join('')}</row></sheetData></worksheet>`; }

function workbookBytes(statuses) {
  const status = (fiId) => statuses[fiId] ?? 'PASS';
  const sheets = ['Index', 'Roll-up', ...FI_IDS];
  const entries = [{
    name: 'xl/workbook.xml', date: FIXED_DATE,
    data: `<?xml version="1.0" encoding="UTF-8"?><workbook><sheets>${sheets.map((name, index) => `<sheet name="${name}" sheetId="${index + 1}"/>`).join('')}</sheets></workbook>`,
  }];
  entries.push({ name: 'xl/worksheets/sheet1.xml', date: FIXED_DATE, data: sheet(FI_IDS.map((fiId, index) => cell(`H${index + 5}`, status(fiId)))) });
  entries.push({ name: 'xl/worksheets/sheet2.xml', date: FIXED_DATE, data: sheet(FI_IDS.map((fiId, index) => cell(`B${index + 23}`, status(fiId)))) });
  for (let index = 0; index < FI_IDS.length; index += 1) entries.push({ name: `xl/worksheets/sheet${index + 3}.xml`, date: FIXED_DATE, data: sheet([cell('A1', 'Case disposition'), cell('D1', status(FI_IDS[index]))]) });
  return buildZip(entries);
}

function sidecar(fiId, workbookSha256, statusHash, status) {
  const statusId = `${fiId}-status`;
  return {
    recordVersion: '1.0.0', fiId, workbookPath: 'completed.xlsx', workbookSha256,
    packetVersion: '1.0.0', packetSha256: 'b'.repeat(64), matrixVersion: '1.0.0', matrixSha256: 'c'.repeat(64),
    identity: {
      releaseCandidateId: 'rc-1', disposableMachineId: 'machine-1', machineRole: 'reviewer', reviewCwd: 'C:/fixture/project', rootRelativeCwd: 'project', cwdContainmentProofEvidenceId: `${fiId}-containment`,
      operatorPrincipalId: 'operator-1', operatorStartedAt: '2026-09-16T10:00:00Z', operatorFinishedAt: '2026-09-16T10:05:00Z', independentReviewerPrincipalId: 'verifier-1', independentReviewerAt: '2026-09-16T10:06:00Z',
    },
    traceability: { artifactRows: 'A01', repairPackage: 'R6', migrationGate: 'M1', releaseConsequence: 'G4' },
    expectedOutcomeCode: 'REFUSE-FUTURE-SCHEMA', observedOutcomeCode: 'REFUSE-FUTURE-SCHEMA',
    fields: [{ label: 'Observed status', entrySha256: statusHash, evidenceIds: [statusId], evidenceHashes: [statusHash] }],
    containment: { network: 'NOT-ATTEMPTED', credentials: 'NOT-ATTEMPTED', paidCredits: 'NOT-ATTEMPTED', fixtureCreation: 'NOT-ATTEMPTED', proofEvidenceIds: [`${fiId}-containment`] },
    status, statusReasonSha256: status === 'ROLLED-BACK' ? 'd'.repeat(64) : null,
    rollback: status === 'ROLLED-BACK' ? { targetHash: 'e'.repeat(64), receiptEvidenceId: `${fiId}-rollback`, descendantClosureHash: 'f'.repeat(64) } : { targetHash: null, receiptEvidenceId: null, descendantClosureHash: null },
    signatures: {
      reviewer: { principalId: 'reviewer-1', role: 'fi-reviewer', signerKeyId: 'key-1', signedAt: '2026-09-16T10:07:00Z', statementSha256: 'a'.repeat(64), signature: 'A'.repeat(86) },
      independentVerifier: { principalId: 'verifier-1', role: 'fi-independent-verifier', signerKeyId: 'key-2', signedAt: '2026-09-16T10:08:00Z', statementSha256: 'a'.repeat(64), signature: 'A'.repeat(86) },
    },
  };
}

function entry(fiId, evidenceId, label, bytes) {
  return { evidenceId, fiId, fieldLabel: label, artifactId: `${fiId}-record`, path: `evidence/${evidenceId}.txt`, profile: 'opaque-bytes', byteLength: bytes.length, sha256: HASH(bytes), predecessorEvidenceIds: [] };
}

export function syntheticFiWorkbookProjection(statuses = {}) {
  const status = (fiId) => statuses[fiId] ?? 'PASS';
  return {
    sheets: ['Index', 'Roll-up', ...FI_IDS],
    caseStatuses: Object.fromEntries(FI_IDS.map((fiId) => [fiId, status(fiId)])),
    indexStatuses: Object.fromEntries(FI_IDS.map((fiId) => [fiId, status(fiId)])),
    rollupStatuses: Object.fromEntries(FI_IDS.map((fiId) => [fiId, status(fiId)])),
  };
}

export function createSyntheticFiEvidenceBundle({ workbookMode = 'xlsx', statuses = {}, tamperEvidenceId = null } = {}) {
  const root = tempDir('fetchproof-fi-e2e-');
  const recordsDir = path.join(root, 'records'); const evidenceDir = path.join(root, 'evidence');
  fs.mkdirSync(recordsDir); fs.mkdirSync(evidenceDir);
  const workbook = path.join(root, 'completed.xlsx'); const bytes = workbookMode === 'opaque' ? Buffer.from('synthetic-workbook') : workbookBytes(statuses); fs.writeFileSync(workbook, bytes);
  const workbookSha256 = HASH(bytes); const entries = [];
  for (const fiId of FI_IDS) {
    const status = statuses[fiId] ?? 'PASS';
    if (status === 'ROLLED-BACK' && !ROLLED_BACK.has(fiId)) throw new Error(`${fiId} cannot be rolled back in a synthetic FI bundle`);
    const statusId = `${fiId}-status`; const statusBytes = Buffer.from(`${fiId}:status`, 'utf8');
    fs.writeFileSync(path.join(evidenceDir, `${statusId}.txt`), statusBytes); entries.push(entry(fiId, statusId, 'Observed status', statusBytes));
    const containmentId = `${fiId}-containment`; const containmentBytes = Buffer.from(`${fiId}:containment`, 'utf8');
    fs.writeFileSync(path.join(evidenceDir, `${containmentId}.txt`), containmentBytes); entries.push(entry(fiId, containmentId, 'Containment proof', containmentBytes));
    if (status === 'ROLLED-BACK') { const rollbackId = `${fiId}-rollback`; const rollbackBytes = Buffer.from(`${fiId}:rollback`, 'utf8'); fs.writeFileSync(path.join(evidenceDir, `${rollbackId}.txt`), rollbackBytes); entries.push(entry(fiId, rollbackId, 'Rollback receipt', rollbackBytes)); }
    fs.writeFileSync(path.join(recordsDir, `${fiId}.json`), JSON.stringify(sidecar(fiId, workbookSha256, HASH(statusBytes), status)), 'utf8');
  }
  const manifest = path.join(root, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ manifestVersion: '1.0.0', root: 'evidence', entries }), 'utf8');
  if (tamperEvidenceId) fs.writeFileSync(path.join(evidenceDir, `${tamperEvidenceId}.txt`), 'tampered');
  return { root, workbook, recordsDir, manifest };
}
