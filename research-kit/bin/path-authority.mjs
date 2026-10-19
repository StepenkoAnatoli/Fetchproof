#!/usr/bin/env node
// Offline Git-origin/path-authority snapshot validator.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SNAPSHOT_SCHEMA,
  readPathAuthoritySnapshot,
  runPathAuthorityConformance,
  validatePathAuthoritySnapshot,
} from '../lib/path-authority-validator.mjs';

function usage() {
  return [
    'Usage:',
    '  node bin/path-authority.mjs validate --file <snapshot.json> [--schema <schema.json>] [--json]',
    '  node bin/path-authority.mjs conform --schema <schema.json> [--file <snapshot.json>]... [--json]',
  ].join('\n');
}

function parse(argv) {
  const result = { command: argv[0], files: [] };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { result.json = true; continue; }
    if (['--file', '--schema', '--root'].includes(arg)
      && (argv[i + 1] === undefined || argv[i + 1] === '' || argv[i + 1].startsWith('--'))) {
      return { error: `${arg} needs a value` };
    }
    if (arg === '--file') { result.files.push(argv[++i]); continue; }
    if (arg === '--schema') { result.schema = argv[++i]; continue; }
    if (arg === '--root') { result.root = argv[++i]; continue; }
    return { error: `unknown option ${arg}` };
  }
  return result;
}

function exitFor(status) {
  return status === 'PASS' ? 0 : (status === 'FAIL' || status === 'REOPEN' ? 1 : 2);
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(`${usage()}\n`); return 0; }
  const parsed = parse(argv);
  if (parsed.error) { console.error(`${parsed.error}\n${usage()}`); return 2; }
  const schemaPath = path.resolve(parsed.schema ?? SNAPSHOT_SCHEMA);
  let result;
  if (parsed.command === 'validate') {
    if (parsed.files.length !== 1) { console.error(usage()); return 2; }
    // JSON-READ is the read's code alone (#340): the validator returns a verdict for any
    // snapshot, so a throw from it is a defect - reported as VALIDATE-ERROR, INCOMPLETE,
    // exit 2 with a report on stdout, never as a read error and never as a bare stack.
    const incomplete = (code, error) => ({ validatorVersion: '1.0.0', status: 'INCOMPLETE', snapshotId: null, envelopeCanonicalSha256: null, errors: [{ code, message: error.message, path: parsed.files[0], status: 'INCOMPLETE' }] });
    let snapshot;
    try {
      snapshot = readPathAuthoritySnapshot(path.resolve(parsed.files[0]));
    } catch (error) {
      result = incomplete('JSON-READ', error);
    }
    if (!result) {
      try { result = validatePathAuthoritySnapshot(snapshot, { schemaPath }); } catch (error) { result = incomplete('VALIDATE-ERROR', error); }
    }
  } else if (parsed.command === 'conform') {
    const files = parsed.files.length ? parsed.files.map((file) => path.resolve(file)) : [];
    result = runPathAuthorityConformance({ files, schemaPath });
  } else {
    console.error(usage()); return 2;
  }
  if (parsed.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.status} (${result.errors.length} error(s))`);
    for (const error of result.errors) console.log(`- ${error.code}: ${error.message} [${error.path}]`);
  }
  return exitFor(result.status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());

export { usage };

