// Cross-language FI sidecar/evidence-manifest schema vectors.
// Every case is embedded synthetic JSON; no workbook, evidence directory, credential,
// network, or benchmark fixture is consulted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, assertEqual, requirePython } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('fi-sidecar-conformance-vectors');

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const VECTOR_FILE = path.join(ROOT, 'conformance', 'fi-sidecar-evidence-manifest-vectors.json');

function runCli() {
  return spawnSync(process.execPath, [
    path.join(ROOT, 'bin', 'fi-sidecar-conformance.mjs'), '--vectors', VECTOR_FILE, '--json',
  ], { encoding: 'utf8' });
}

test('FI sidecar and evidence-manifest vectors classify valid, malformed, and tampered documents consistently', async () => {
  const { loadFiSchemaVectors, runFiSchemaConformance } = await import('../lib/fi-sidecar-conformance.mjs');
  const packet = loadFiSchemaVectors(VECTOR_FILE);
  const report = runFiSchemaConformance(packet);
  assertEqual(report.status, 'PASS', JSON.stringify(report));
  assertEqual(report.profile, 'researcher-fi-schema-conformance-v1');
  assertEqual(report.vectorCount, packet.vectors.length);
  assert(report.vectors.every((row) => row.result === 'PASS'), JSON.stringify(report));
  assert(report.vectors.some((row) => row.expectedCode === 'SCHEMA-ONE-OF'));
  assert(report.vectors.some((row) => row.expectedCode === 'JSON-DUPLICATE-KEY'));
});

test('FI Node CLI is byte-deterministic and agrees with the Node library', async () => {
  const { canonicalReportJson, loadFiSchemaVectors, runFiSchemaConformance } = await import('../lib/fi-sidecar-conformance.mjs');
  const expected = canonicalReportJson(runFiSchemaConformance(loadFiSchemaVectors(VECTOR_FILE)));
  const first = runCli();
  const second = runCli();
  assertEqual(first.status, 0, first.stderr || first.stdout);
  assertEqual(second.status, 0, second.stderr || second.stdout);
  assertEqual(first.stdout, second.stdout, 'CLI report must be byte-identical');
  assertEqual(first.stdout, expected, 'CLI must render the library report exactly');
});

test('FI Python runner agrees with Node on every vector row and expected code', () => {
  const python = spawnSync(requirePython('FI sidecar Node/Python agreement'), [
    path.join(ROOT, 'bin', 'fi_sidecar_conformance.py'), '--vectors', VECTOR_FILE, '--json',
  ], { encoding: 'utf8' });
  const node = runCli();
  assertEqual(python.status, 0, python.stderr || python.stdout);
  assertEqual(node.status, 0, node.stderr || node.stdout);
  const pythonReport = JSON.parse(python.stdout);
  const nodeReport = JSON.parse(node.stdout);
  assertEqual(pythonReport.status, 'PASS', python.stdout);
  assertEqual(pythonReport.profile, nodeReport.profile);
  assertEqual(pythonReport.vectorPacketSha256, nodeReport.vectorPacketSha256);
  assertEqual(JSON.stringify(pythonReport.vectors), JSON.stringify(nodeReport.vectors), 'Python and Node rows must agree');
});

test('FI Node and Python runners agree on patches past the first array index', async () => {
  const { loadFiSchemaVectors, runFiSchemaConformance } = await import('../lib/fi-sidecar-conformance.mjs');
  const packet = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
  const second = { ...packet.documents.manifest.entries[0], evidenceId: 'FI-02-status', fieldLabel: 'Second status', path: 'release-evidence/FI-02-status.json' };
  packet.documents.manifest.entries.push(second);
  packet.vectors = [
    { vectorId: 'X-IDX1', target: 'manifest', base: 'manifest', patches: [{ op: 'remove', path: '/entries/1/sha256' }], expectedCode: 'SCHEMA-REQUIRED' },
    { vectorId: 'X-IDX0', target: 'manifest', base: 'manifest', patches: [{ op: 'remove', path: '/entries/0/sha256' }], expectedCode: 'SCHEMA-REQUIRED' },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-sidecar-idx-'));
  try {
    const file = path.join(dir, 'packet.json');
    fs.writeFileSync(file, JSON.stringify(packet));
    const nodeRows = runFiSchemaConformance(loadFiSchemaVectors(file)).vectors;
    const python = spawnSync(requirePython('FI sidecar array index agreement'), [
      path.join(ROOT, 'bin', 'fi_sidecar_conformance.py'), '--vectors', file, '--json',
    ], { encoding: 'utf8' });
    assertEqual(python.status, 0, python.stderr || python.stdout);
    const pythonRows = JSON.parse(python.stdout).vectors;
    for (const id of ['X-IDX1', 'X-IDX0']) {
      const nodeRow = nodeRows.find((row) => row.vectorId === id);
      const pythonRow = pythonRows.find((row) => row.vectorId === id);
      assertEqual(nodeRow.observedCode, 'SCHEMA-REQUIRED', `Node ${id}: ${JSON.stringify(nodeRow)}`);
      assertEqual(pythonRow.observedCode, nodeRow.observedCode, `Python ${id} must match Node`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Review of #336 (2026-10-18): the patch walk tested `part in parent` and assigned with
// `parent[key] =`, so "/__proto__/polluted" walked into Object.prototype and the set
// polluted it for the whole process - ({}).polluted was 'yes' afterwards - while Python
// refused the path as absent. A path segment is an own member, as in Python.
test('FI patch paths walk own members only and cannot reach Object.prototype', async () => {
  const { loadFiSchemaVectors, runFiSchemaConformance } = await import('../lib/fi-sidecar-conformance.mjs');
  const packet = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
  const base = Object.keys(packet.documents).find((name) => packet.documents[name] && typeof packet.documents[name] === 'object' && !Array.isArray(packet.documents[name]));
  const target = packet.vectors.find((vector) => vector.base === base)?.target ?? 'sidecar';
  packet.vectors = [
    ['X-PROTO-SET', [{ op: 'set', path: '/__proto__/polluted', value: 'yes' }]],
    ['X-CTOR-SET', [{ op: 'set', path: '/constructor/prototype/polluted', value: 'yes' }]],
    ['X-PROTO-REMOVE', [{ op: 'remove', path: '/toString' }]],
  ].map(([vectorId, patches]) => ({ vectorId, target, base, patches, expectedCode: 'VECTOR-PACKET' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-sidecar-proto-'));
  try {
    const file = path.join(dir, 'packet.json');
    fs.writeFileSync(file, JSON.stringify(packet));
    // Node only: the Python twin refuses these paths as absent too, but names any absent
    // path JSON-PARSE today (its PacketError is a ValueError, caught first), which is the
    // Python runner's own fix to make.
    const nodeRows = runFiSchemaConformance(loadFiSchemaVectors(file)).vectors;
    assertEqual(({}).polluted, undefined, 'a vector patch polluted Object.prototype');
    assertEqual(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
    for (const row of nodeRows) assertEqual(row.observedCode, 'VECTOR-PACKET', `Node ${row.vectorId}: ${JSON.stringify(row)}`);
  } finally {
    delete Object.prototype.polluted;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('FI vector packet remains synthetic and does not carry completed evidence', () => {
  const packet = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
  const source = JSON.stringify(packet).toLowerCase();
  assert(!source.includes('research/raw'), 'source captures are not conformance data');
  assert(!source.includes('privatekey'), 'private key material is not conformance data');
  assert(!source.includes('completed.xlsx'), 'completed workbook paths are not conformance data');
});
