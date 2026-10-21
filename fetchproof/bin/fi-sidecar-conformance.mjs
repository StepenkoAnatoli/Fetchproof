#!/usr/bin/env node
// Run synthetic, offline FI sidecar/evidence-manifest schema conformance vectors.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalReportJson, loadFiSchemaVectors, runFiSchemaConformance } from '../lib/fi-sidecar-conformance.mjs';

const DEFAULT_VECTORS = fileURLToPath(new URL('../conformance/fi-sidecar-evidence-manifest-vectors.json', import.meta.url));
export function usage() { return 'Usage: node bin/fi-sidecar-conformance.mjs [--vectors <fi-sidecar-evidence-manifest-vectors.json>] [--json]'; }
export function main(argv = process.argv.slice(2)) {
  let vectors = DEFAULT_VECTORS; let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    // --help as the Python twin and property-vector-conformance answer it: usage on stdout, exit 0.
    if (argv[index] === '--help' || argv[index] === '-h') { process.stdout.write(`${usage()}\n`); return 0; }
    if (argv[index] === '--json') { json = true; continue; }
    if (argv[index] === '--vectors' && argv[index + 1]) { vectors = path.resolve(argv[++index]); continue; }
    console.error(usage()); return 2;
  }
  try {
    const report = runFiSchemaConformance(loadFiSchemaVectors(vectors));
    if (json) process.stdout.write(canonicalReportJson(report));
    else { console.log(`${report.status} (${report.vectorCount} vector(s))`); for (const row of report.vectors) console.log(`- ${row.vectorId}: ${row.result}${row.result === 'FAIL' ? ` (${row.observedCode})` : ''}`); }
    return report.status === 'PASS' ? 0 : 1;
  } catch (error) {
    const report = { validatorVersion: '1.0.0', profile: 'researcher-fi-schema-conformance-v1', vectorCount: 0, status: 'FAIL', vectors: [], errors: [{ code: error.code ?? 'VECTOR-PACKET', message: error.message }] };
    if (json) process.stdout.write(canonicalReportJson(report)); else console.error(`FAIL: ${error.message}`);
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
