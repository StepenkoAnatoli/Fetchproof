#!/usr/bin/env node
// Run synthetic, offline qualification-ledger hash/signature vectors.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalReportJson,
  loadLedgerVectors,
  runLedgerConformance,
} from '../lib/ledger-conformance.mjs';

const DEFAULT_VECTORS = fileURLToPath(new URL('../conformance/qualification-ledger-vectors.json', import.meta.url));

export function usage() {
  return 'Usage: node bin/ledger-conformance.mjs [--vectors <qualification-ledger-vectors.json>] [--json]';
}

export function main(argv = process.argv.slice(2)) {
  let vectors = DEFAULT_VECTORS;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    // --help as the Python twin and property-vector-conformance answer it: usage on stdout, exit 0.
    if (argv[index] === '--help' || argv[index] === '-h') { process.stdout.write(`${usage()}\n`); return 0; }
    if (argv[index] === '--json') { json = true; continue; }
    if (argv[index] === '--vectors' && argv[index + 1]) { vectors = path.resolve(argv[++index]); continue; }
    console.error(usage());
    return 2;
  }
  try {
    const report = runLedgerConformance(loadLedgerVectors(vectors));
    if (json) process.stdout.write(canonicalReportJson(report));
    else {
      console.log(`${report.status} (${report.vectorCount} vector(s))`);
      for (const vector of report.vectors) console.log(`- ${vector.vectorId}: ${vector.result}${vector.reason ? ` (${vector.reason})` : ''}`);
    }
    return report.status === 'PASS' ? 0 : 1;
  } catch (error) {
    const report = { validatorVersion: '1.0.0', profile: 'researcher-benchmark-c14n-v1', vectorCount: 0, status: 'FAIL', vectors: [], errors: [{ code: error.code ?? 'VECTOR-PACKET', message: error.message }] };
    if (json) process.stdout.write(canonicalReportJson(report));
    else console.error(`${report.status}: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
