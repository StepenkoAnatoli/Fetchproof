#!/usr/bin/env node
// Validates every checked-in example package and checks it got the expected answer.
//
//   node fetchproof/examples/release-evidence/run-example.mjs          # human output
//   node fetchproof/examples/release-evidence/run-example.mjs --json   # machine output
//
// This reads the files on disk. It never regenerates them - `build.mjs` does that, and
// keeping the two apart is deliberate: if a schema or hash rule changes and the checked-in
// examples go stale, this goes red and names the package, instead of a build step quietly
// papering over the change.
//
// Offline, read-only, no credential. Nothing here is a real sign-off.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRelease } from '../../lib/release-validator.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every package, and the answer it must produce.
 *
 * `code` is the primary error code expected, or null for a package that passes. Pinning
 * the CODE rather than the message is deliberate - a message is prose and may be reworded,
 * while a code is the contract a caller branches on.
 */
const EXPECTED = [
  {
    dir: '01-minimal-pass',
    status: 'PASS', exit: 0, code: null,
    teaches: 'the smallest complete R28 package: one record, its registry entry, one role grant',
  },
  {
    dir: '02-fail-payload-hash',
    status: 'FAIL', exit: 1, code: 'ENV-HASH',
    teaches: 'the payload was edited after sealing - the check the envelope format exists for',
  },
  {
    dir: '03-behaviour-unregistered-record-is-ignored',
    status: 'PASS', exit: 0, code: null,
    teaches: 'a record the registry does not list is never validated - PASS does not mean "no stray files"',
  },
  {
    dir: '04-fail-missing-record',
    status: 'INCOMPLETE', exit: 2, code: 'RECORD-READ',
    teaches: 'the registry declares a record that is not on disk - INCOMPLETE, not FAIL, because nothing was judged',
  },
  {
    dir: '05-fail-owner-role-not-granted',
    status: 'FAIL', exit: 1, code: 'ROLE-01',
    teaches: 'the roster never granted the owner that role - correct hashes do not make a record authorised',
  },
  {
    dir: '06-fail-future-schema',
    status: 'FAIL', exit: 1, code: 'ENV-FUTURE-SCHEMA',
    teaches: 'a schema revision this validator was not taught - refuse rather than guess',
  },
];

/** The CLI's status -> exit-code contract, mirrored so the example asserts it too. */
const EXIT_FOR = { PASS: 0, FAIL: 1, REOPEN: 1, INCOMPLETE: 2, BLOCKED: 3 };

function runOne(entry) {
  const root = path.join(HERE, entry.dir);
  const result = validateRelease({
    root,
    package: 'R28',
    registryPath: path.join(root, 'artifact-registry.json'),
    rolesPath: path.join(root, 'role-roster.json'),
    pointersDir: path.join(root, 'pointers'),
  });
  const codes = result.errors.map((error) => error.code);
  const exit = EXIT_FOR[result.status] ?? 4;
  const problems = [];
  if (result.status !== entry.status) problems.push(`expected status ${entry.status}, got ${result.status}`);
  if (exit !== entry.exit) problems.push(`expected exit ${entry.exit}, got ${exit}`);
  if (entry.code && !codes.includes(entry.code)) problems.push(`expected error code ${entry.code}, got [${codes.join(', ') || 'none'}]`);
  if (!entry.code && codes.length) problems.push(`expected no errors, got [${codes.join(', ')}]`);
  return { dir: entry.dir, teaches: entry.teaches, status: result.status, exit, codes, ok: problems.length === 0, problems };
}

export function runExamples() {
  const rows = EXPECTED.map(runOne);
  return { status: rows.every((row) => row.ok) ? 'PASS' : 'FAIL', count: rows.length, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runExamples();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const row of report.rows) {
      console.log(`${row.ok ? 'ok   ' : 'FAIL '} ${row.dir}`);
      console.log(`        ${row.status} (exit ${row.exit})${row.codes.length ? ` ${row.codes.join(', ')}` : ''}`);
      console.log(`        ${row.teaches}`);
      for (const problem of row.problems) console.log(`        -> ${problem}`);
    }
    console.log(`\n${report.status}: ${report.rows.filter((r) => r.ok).length}/${report.count} examples behaved as documented`);
  }
  process.exit(report.status === 'PASS' ? 0 : 1);
}
