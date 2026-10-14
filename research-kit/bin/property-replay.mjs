#!/usr/bin/env node
// Read-only deterministic replay for persisted graph and canonical-hash seeds.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectory } from '../lib/core.mjs';
import {
  DEFAULT_PROPERTY_REGRESSION_DIR,
  listPropertyRegressions,
  loadPropertyRegression,
  replayPropertyRegression,
} from '../lib/property-replay.mjs';

export function usage() {
  return [
    'Usage:',
    '  node bin/property-replay.mjs --case <property-regression.json> [--json]',
    '  node bin/property-replay.mjs --all [--directory <property-regressions>] [--json]',
  ].join('\n');
}

function parse(argv) {
  const result = { json: false, all: false, directory: DEFAULT_PROPERTY_REGRESSION_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--help' || argv[index] === '-h') return { help: true };
    if (argv[index] === '--json') { result.json = true; continue; }
    if (argv[index] === '--all') { result.all = true; continue; }
    if (argv[index] === '--case' && argv[index + 1]) { result.file = path.resolve(argv[++index]); continue; }
    if (argv[index] === '--directory' && argv[index + 1]) { result.directory = path.resolve(argv[++index]); continue; }
    return { error: `unknown or incomplete option ${argv[index]}` };
  }
  if (result.all === Boolean(result.file)) return { error: 'specify exactly one of --case or --all' };
  return result;
}

export function main(argv = process.argv.slice(2)) {
  const parsed = parse(argv);
  if (parsed.help) { process.stdout.write(`${usage()}\n`); return 0; }
  if (parsed.error) { console.error(`${parsed.error}\n${usage()}`); return 2; }
  if (parsed.all && !isDirectory(parsed.directory)) {
    const message = `no property-regressions directory at ${parsed.directory} - pass --directory <folder>`;
    const result = {
      profile: 'researcher-property-replay-v1', status: 'INCOMPLETE',
      directory: parsed.directory, regressionCount: 0,
      errors: [{ code: 'PROPERTY-REGRESSION-DIR', message }],
    };
    if (parsed.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else console.error(`INCOMPLETE: ${message}`);
    return 2;
  }
  try {
    const reports = parsed.all
      ? listPropertyRegressions(parsed.directory).map((file) => replayPropertyRegression(loadPropertyRegression(file)))
      : [replayPropertyRegression(loadPropertyRegression(parsed.file))];
    const result = parsed.all
      ? { profile: 'researcher-property-replay-v1', directory: parsed.directory, regressionCount: reports.length, status: reports.every((report) => report.status === 'PASS') ? 'PASS' : 'FAIL', regressions: reports }
      : reports[0];
    if (parsed.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      console.log(parsed.all && reports.length === 0
        ? `PASS (0): no regressions captured under ${parsed.directory}`
        : `${result.status} (${parsed.all ? result.regressionCount : result.caseId})`);
      for (const report of reports) for (const check of report.checks) console.log(`- ${report.caseId} ${check.name}: ${check.passed ? 'PASS' : 'FAIL'}`);
    }
    return result.status === 'PASS' ? 0 : 1;
  } catch (error) {
    const result = { profile: 'researcher-property-replay-v1', status: 'FAIL', errors: [{ code: error.code ?? 'PROPERTY-REGRESSION', message: error.message }] };
    if (parsed.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else console.error(`FAIL: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
