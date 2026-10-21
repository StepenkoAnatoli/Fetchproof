// End-to-end FI validation against a complete, disposable synthetic evidence bundle.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, describe, assertEqual, cleanup } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('fi-validator-e2e');
import { createSyntheticFiEvidenceBundle } from './fi-e2e-bundle.mjs';

function treeHash(root) {
  const rows = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name); const relative = path.relative(root, file).replaceAll('\\', '/');
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else rows.push(`${relative}\0${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`);
    }
  }
  walk(root);
  return crypto.createHash('sha256').update(rows.join('\n')).digest('hex');
}

function validate(input) {
  return spawnSync(process.execPath, [
    'fetchproof/bin/researcher-release.mjs', 'fi-validate',
    '--root', input.root, '--workbook', input.workbook, '--records', input.recordsDir,
    '--manifest', input.manifest, '--json',
  ], { encoding: 'utf8' });
}

function validateTwiceWithoutMutation(input, expectedExitCode, mutationMessage) {
  const before = treeHash(input.root);
  const first = validate(input);
  const second = validate(input);
  assertEqual(first.status, expectedExitCode, first.stderr || first.stdout);
  assertEqual(second.status, expectedExitCode, second.stderr || second.stdout);
  assertEqual(first.stdout, second.stdout, 'FI validator JSON report must be byte-identical');
  assertEqual(treeHash(input.root), before, mutationMessage);
  return JSON.parse(first.stdout);
}

test('FI CLI validates a complete disposable bundle twice without mutating inputs or changing its JSON report', () => {
  const input = createSyntheticFiEvidenceBundle();
  try {
    const report = validateTwiceWithoutMutation(input, 0, 'fi-validate must not mutate the synthetic evidence bundle');
    assertEqual(report.status, 'PASS', JSON.stringify(report));
    assertEqual(report.cases.length, 30, JSON.stringify(report));
    assertEqual(report.errors.length, 0, JSON.stringify(report));
  } finally { cleanup(input.root); }
});

test('FI CLI validates a completed rolled-back bundle deterministically without mutating inputs', () => {
  const input = createSyntheticFiEvidenceBundle({ statuses: { 'FI-06': 'ROLLED-BACK' } });
  try {
    assertEqual(JSON.parse(fs.readFileSync(path.join(input.recordsDir, 'FI-06.json'), 'utf8')).status, 'ROLLED-BACK');
    const report = validateTwiceWithoutMutation(input, 0, 'fi-validate must not mutate the synthetic evidence bundle');
    assertEqual(report.status, 'PASS', JSON.stringify(report));
    assertEqual(report.cases.find((entry) => entry.fiId === 'FI-06')?.status, 'PASS', JSON.stringify(report));
    assertEqual(report.errors.length, 0, JSON.stringify(report));
  } finally { cleanup(input.root); }
});

test('FI CLI fails closed when a rolled-back receipt evidence byte is corrupted without mutating inputs', () => {
  const input = createSyntheticFiEvidenceBundle({ statuses: { 'FI-06': 'ROLLED-BACK' } });
  try {
    fs.writeFileSync(path.join(input.root, 'evidence', 'FI-06-rollback.txt'), 'corrupted rollback receipt', 'utf8');
    const report = validateTwiceWithoutMutation(input, 1, 'fi-validate must not mutate the corrupted synthetic evidence bundle');
    assertEqual(report.status, 'FAIL', JSON.stringify(report));
    assertEqual(report.errors.length, 1, JSON.stringify(report));
    assertEqual(report.errors[0]?.fiId, 'FI-06', JSON.stringify(report));
    assertEqual(report.errors[0]?.code, 'EVIDENCE-HASH', JSON.stringify(report));
    assertEqual(report.errors[0]?.status, 'FAIL', JSON.stringify(report));
  } finally { cleanup(input.root); }
});

test('FI CLI blocks a rolled-back bundle when its receipt manifest entry is absent without mutating inputs', () => {
  const input = createSyntheticFiEvidenceBundle({ statuses: { 'FI-06': 'ROLLED-BACK' } });
  try {
    const sidecar = JSON.parse(fs.readFileSync(path.join(input.recordsDir, 'FI-06.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(input.manifest, 'utf8'));
    const receiptId = sidecar.rollback.receiptEvidenceId;
    const receipt = manifest.entries.find((entry) => entry.evidenceId === receiptId);
    assertEqual(sidecar.status, 'ROLLED-BACK');
    assertEqual(receipt?.fiId, 'FI-06');
    assertEqual(receipt?.fieldLabel, 'Rollback receipt');
    fs.writeFileSync(input.manifest, JSON.stringify({ ...manifest, entries: manifest.entries.filter((entry) => entry.evidenceId !== receiptId) }), 'utf8');
    assertEqual(fs.existsSync(path.join(input.root, receipt.path)), true, 'receipt bytes must remain valid but unmanifested');
    const report = validateTwiceWithoutMutation(input, 2, 'fi-validate must not mutate the unmanifested receipt bundle');
    assertEqual(report.status, 'INCOMPLETE', JSON.stringify(report));
    assertEqual(report.errors.length, 1, JSON.stringify(report));
    assertEqual(report.errors[0]?.fiId, 'FI-06', JSON.stringify(report));
    assertEqual(report.errors[0]?.code, 'EVIDENCE-MISSING', JSON.stringify(report));
    assertEqual(report.errors[0]?.status, 'INCOMPLETE', JSON.stringify(report));
  } finally { cleanup(input.root); }
});
