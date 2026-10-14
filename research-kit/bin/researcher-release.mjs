#!/usr/bin/env node
// researcher-release - read-only R28–R32 artifact validation and schema conformance.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { writeText, writeFailure } from '../lib/core.mjs';
import {
  DEFAULT_SCHEMA_DIR,
  listJsonFiles,
  parseJsonNoDuplicates,
  runSchemaConformance,
  validateRelease,
} from '../lib/release-validator.mjs';
import { validateFiBundle } from '../lib/fi-validator.mjs';

function usage() {
  return [
    'Usage:',
    '  node bin/researcher-release.mjs validate --root <record-root> --package R28|R29|R30|R31|R32|R33',
    '    --registry <artifact-registry.json> --roles <role-roster.json> --pointers <pointer-directory> [--schemas <dir>] [--ledger <ledger.qlog|ledger-dir>] [--genesis <genesis.json>] [--checkpoints <checkpoint-directory>] [--head <head.json>] [--keys <public-keys.json>] [--genesis-hash <sha256>] [--snapshot-max-age-ms <milliseconds>] [--json]',
    '  node bin/researcher-release.mjs conform --root <directory> --schema <schema.json> [--file <record.json>]... [--json]',
    '  node bin/researcher-release.mjs fi-validate --root <approved-root> --workbook <completed.xlsx> --records <sidecar-directory> --manifest <evidence-manifest.json> [--report <report.json>] [--json]',
  ].join('\n');
}

function argsAfterCommand(argv) {
  const command = argv[0];
  const result = { command, _: [] };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { result.json = true; continue; }
    if (arg.startsWith('--')
      && (argv[i + 1] === undefined || argv[i + 1] === '' || argv[i + 1].startsWith('--'))) {
      return { error: `${arg} needs a value` };
    }
    if (arg === '--file') { result.files ??= []; result.files.push(argv[++i]); continue; }
    if (arg.startsWith('--')) { result[arg.slice(2).replaceAll('-', '')] = argv[++i]; continue; }
    result._.push(arg);
  }
  return result;
}

function exitFor(status) {
  if (status === 'PASS') return 0;
  if (status === 'FAIL' || status === 'REOPEN') return 1;
  if (status === 'INCOMPLETE') return 2;
  if (status === 'BLOCKED') return 3;
  return 4;
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(`${usage()}\n`); return 0; }
  const parsed = argsAfterCommand(argv);
  if (parsed.error) { console.error(`${parsed.error}\n${usage()}`); return 2; }
  let result;
  if (parsed.command === 'validate') {
    if (!parsed.root || !parsed.package || !parsed.registry || !parsed.roles || !parsed.pointers) {
      console.error(usage());
      return 2;
    }
    let publicKeys = {};
    if (parsed.keys) {
      try { publicKeys = parseJsonNoDuplicates(fs.readFileSync(path.resolve(parsed.keys), 'utf8')); }
      catch (error) {
        result = { status: 'INCOMPLETE', errors: [{ code: 'LEDGER-KEYS-READ', message: error.message, path: parsed.keys, status: 'INCOMPLETE' }] };
      }
    }
    if (!result) result = validateRelease({
      root: path.resolve(parsed.root),
      package: parsed.package,
      registryPath: path.resolve(parsed.registry),
      rolesPath: path.resolve(parsed.roles),
      pointersDir: path.resolve(parsed.pointers),
      schemaDir: parsed.schemas ? path.resolve(parsed.schemas) : DEFAULT_SCHEMA_DIR,
      ledgerPath: parsed.ledger ? path.resolve(parsed.ledger) : null,
      genesisPath: parsed.genesis ? path.resolve(parsed.genesis) : null,
      checkpointsDir: parsed.checkpoints ? path.resolve(parsed.checkpoints) : null,
      headPath: parsed.head ? path.resolve(parsed.head) : null,
      genesisHash: parsed.genesishash ?? '0'.repeat(64),
      publicKeys,
      snapshotMaxAgeMs: parsed.snapshotmaxagems === undefined ? undefined : Number(parsed.snapshotmaxagems),
    });
  } else if (parsed.command === 'conform') {
    if (!parsed.schema) { console.error(usage()); return 2; }
    const root = parsed.root ? path.resolve(parsed.root) : process.cwd();
    const files = parsed.files?.length ? parsed.files.map((file) => path.resolve(file)) : listJsonFiles(root);
    result = runSchemaConformance({
      files,
      schemaPath: path.resolve(parsed.schema),
    });
  } else if (parsed.command === 'fi-validate') {
    // 2, like `validate` and `conform` above. It returned 4 until 2026-09-20, which meant
    // the SAME mistake - forgetting a required flag - reported a different code depending
    // on which subcommand you typed. 4 is this CLI's "unrecognised status" fallback, so a
    // caller branching on it was being told the validator produced something unknown,
    // when in fact it had never run.
    if (!parsed.root || !parsed.workbook || !parsed.records || !parsed.manifest) { console.error(usage()); return 2; }
    result = validateFiBundle({
      root: path.resolve(parsed.root),
      workbook: path.resolve(parsed.workbook),
      recordsDir: path.resolve(parsed.records),
      manifest: path.resolve(parsed.manifest),
    });
    if (parsed.report) {
      // A report the environment refuses is named and exits 2: uncaught it was a stack trace
      // and exit 1, which is this command's code for FAIL (found 2026-09-30).
      try { writeText(path.resolve(parsed.report), `${JSON.stringify(result, null, 2)}\n`); }   // whole or not at all (ADR-0079)
      catch (err) {
        const why = writeFailure(err);
        if (!why) throw err;
        console.error(why);
        return 2;
      }
    }
  } else {
    console.error(usage());
    return 2;
  }
  if (parsed.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.status} (${result.errors.length} error(s))`);
    for (const error of result.errors) console.log(`- ${error.code}: ${error.message} [${error.path}]`);
  }
  return exitFor(result.status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());

export { main, usage };
