#!/usr/bin/env node
// Read-only Node conformance CLI for exported property graph/hash vectors.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalReportJson, loadPropertyVectors, runPropertyVectorConformance } from '../lib/property-vector-conformance.mjs';

const DEFAULT_VECTORS = fileURLToPath(new URL('../conformance/property-graph-hash-vectors.json', import.meta.url));

export function usage() {
  return 'Usage: node bin/property-vector-conformance.mjs [--vectors <property-graph-hash-vectors.json>] [--json]';
}

export function main(argv = process.argv.slice(2)) {
  let vectors = DEFAULT_VECTORS;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--json') { json = true; continue; }
    if (argv[index] === '--vectors' && argv[index + 1]) { vectors = path.resolve(argv[++index]); continue; }
    if (argv[index] === '--help' || argv[index] === '-h') { process.stdout.write(`${usage()}\n`); return 0; }
    console.error(usage());
    return 2;
  }
  try {
    const report = runPropertyVectorConformance(loadPropertyVectors(vectors));
    if (json) process.stdout.write(canonicalReportJson(report));
    else {
      console.log(`${report.status} (${report.vectorCount} vector(s))`);
      for (const vector of report.vectors) console.log(`- ${vector.vectorId}: ${vector.result}${vector.reason ? ` (${vector.reason})` : ''}`);
    }
    return report.status === 'PASS' ? 0 : 1;
  } catch (error) {
    const report = { validatorVersion: '1.0.0', profile: 'researcher-property-vector-v1', vectorCount: 0, status: 'FAIL', vectors: [], errors: [{ code: error.code ?? 'PROPERTY-VECTOR-PACKET', message: error.message }] };
    if (json) process.stdout.write(canonicalReportJson(report));
    else console.error(`FAIL: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
