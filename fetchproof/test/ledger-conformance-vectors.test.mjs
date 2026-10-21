// Cross-language qualification-ledger canonical hash and Ed25519 vectors.
// The vector packet is synthetic and safe to run offline.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, assertEqual, requirePython } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('ledger-conformance-vectors');

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const VECTOR_FILE = path.join(ROOT, 'conformance', 'qualification-ledger-vectors.json');

function runNodeCli() {
  return spawnSync(process.execPath, [
    path.join(ROOT, 'bin', 'ledger-conformance.mjs'), '--vectors', VECTOR_FILE, '--json',
  ], { encoding: 'utf8' });
}

test('Node conformance runner passes every canonical hash and Ed25519 vector', async () => {
  const { loadLedgerVectors, runLedgerConformance } = await import('../lib/ledger-conformance.mjs');
  const packet = loadLedgerVectors(VECTOR_FILE);
  const result = runLedgerConformance(packet);
  assertEqual(result.status, 'PASS', JSON.stringify(result));
  assertEqual(result.profile, 'researcher-benchmark-c14n-v1', JSON.stringify(result));
  assertEqual(result.vectorCount, packet.vectors.length, JSON.stringify(result));
  assert(/^[0-9a-f]{64}$/.test(result.vectorPacketSha256), JSON.stringify(result));
  assert(/^[0-9a-f]{64}$/.test(result.reportSha256), JSON.stringify(result));
  assertEqual(result.implementation.language, 'node', JSON.stringify(result));
  assert(result.vectors.every((vector) => vector.result === 'PASS'), JSON.stringify(result));
  const negative = result.vectors.find((vector) => vector.vectorId === 'QL-S-04');
  assertEqual(negative?.reason, 'signature.invalid', JSON.stringify(result));
});

test('CLI conformance report is deterministic and byte-identical to the Node runner', async () => {
  const { loadLedgerVectors, runLedgerConformance, canonicalReportJson } = await import('../lib/ledger-conformance.mjs');
  const packet = loadLedgerVectors(VECTOR_FILE);
  const expected = canonicalReportJson(runLedgerConformance(packet));
  const first = runNodeCli();
  const second = runNodeCli();
  assertEqual(first.status, 0, first.stderr || first.stdout);
  assertEqual(second.status, 0, second.stderr || second.stdout);
  assertEqual(first.stdout, second.stdout, 'CLI report must be byte-deterministic');
  assertEqual(JSON.stringify(JSON.parse(first.stdout)), JSON.stringify(JSON.parse(expected)), 'CLI and library reports must agree');
});

test('Python conformance runner agrees with Node on every vector', async () => {
  const python = spawnSync(requirePython('ledger Node/Python agreement'), [
    path.join(ROOT, 'bin', 'ledger_conformance.py'), '--vectors', VECTOR_FILE, '--json',
  ], { encoding: 'utf8' });
  assertEqual(python.status, 0, python.stderr || python.stdout);
  const node = runNodeCli();
  assertEqual(node.status, 0, node.stderr || node.stdout);
  const nodeReport = JSON.parse(node.stdout);
  const pythonReport = JSON.parse(python.stdout);
  assertEqual(pythonReport.status, 'PASS', python.stdout);
  assertEqual(pythonReport.profile, nodeReport.profile, python.stdout);
  assertEqual(pythonReport.vectorCount, nodeReport.vectorCount, python.stdout);
  assertEqual(JSON.stringify(pythonReport.vectors), JSON.stringify(nodeReport.vectors), 'Python and Node vector rows must agree');
});

test('negative signature mutation is rejected by the Node runner', async () => {
  const { loadLedgerVectors, runLedgerConformance } = await import('../lib/ledger-conformance.mjs');
  const packet = loadLedgerVectors(VECTOR_FILE);
  const mutated = JSON.parse(JSON.stringify(packet));
  const signatureVector = mutated.vectors.find((vector) => vector.kind === 'ed25519');
  signatureVector.signature = `${signatureVector.signature.slice(0, -1)}${signatureVector.signature.endsWith('A') ? 'B' : 'A'}`;
  const result = runLedgerConformance(mutated);
  assertEqual(result.status, 'FAIL', JSON.stringify(result));
  assert(result.vectors.some((vector) => vector.result === 'FAIL' && vector.reason === 'signature.invalid'), JSON.stringify(result));
});

test('vector packet contains no private key material', async () => {
  const packet = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
  assert(!JSON.stringify(packet).toLowerCase().includes('privatekey'), 'private key field must not be shipped');
  assert(!JSON.stringify(packet).toLowerCase().includes('seed'), 'private seed material must not be shipped');
});
