#!/usr/bin/env node
// bin/doctor.mjs - name every problem and print the exact fix.
//
// It describes WHEREVER IT IS RUN. A clean report from the wrong directory is a clean
// report about the wrong project.

import { parseFlags, refuseUnknownFlags, checkFlagValues, writeFailure, exitAfterFlush, KIT_VERSION } from '../lib/core.mjs';
import { runDoctor } from '../lib/doctor.mjs';
import { repairLedgerTail } from '../lib/provenance.mjs';
import { renderTable, heading } from '../lib/render.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['fix-arity', 'help', 'json']);
// No flag here takes a value, so a word after one is an argument (#289).
checkFlagValues(flags, {});
const root = process.cwd();

if (flags.help) {
  process.stdout.write(`doctor - machine + project + gate + chain health, in one report.

  node research-kit/bin/doctor.mjs [--json] [--fix-arity]

  --fix-arity   drop a trailing partial ledger line, and only that

Run it, fix what it says, run it again. Stop at READY.
`);
  process.exit(0);
}

if (flags['fix-arity']) {
  let repair;
  try {
    repair = repairLedgerTail(root);
  } catch (err) {
    const why = writeFailure(err);
    if (!why) throw err;
    process.stderr.write(`${why} No repair was made.\n`);
    process.exit(2);
  }
  process.stdout.write(repair.repaired
    ? `repaired: dropped the torn tail at line ${repair.line}\n`
    : `no repair made: ${repair.reason}\n`);
  if (!repair.repaired && repair.reason === 'chain-broken-before-tail') {
    process.stderr.write('the chain is broken before its tail - this is not a torn write, and no repair may invent a link\n');
    process.exit(1);
  }
}

const report = { kitVersion: KIT_VERSION, ...runDoctor(root) };

if (flags.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await exitAfterFlush(report.ok ? 0 : 1);
}

const order = { critical: 0, fail: 1, warn: 2, info: 3, pass: 4 };
const rows = [...report.findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

process.stdout.write(`${heading(`doctor - ${root}`)}\n`);
process.stdout.write(`${renderTable(rows, [
  { header: '', value: (r) => r.severity },
  { header: 'check', value: (r) => r.name },
  { header: 'detail', value: (r) => String(r.detail).split('\n')[0] },
])}\n`);

const fixes = rows.filter((r) => r.fix);
if (fixes.length) {
  process.stdout.write(`${heading('fixes')}\n`);
  for (const row of fixes) process.stdout.write(`  ${row.name}\n    ${row.fix}\n`);
}

const remedy = report.findings.find((r) => r.name === 'handoff-remedy');
if (remedy) process.stdout.write(`${heading('handoff')}\n${remedy.detail}\n`);

process.stdout.write(`\n${report.ok ? 'READY' : `${report.blocking.length} blocker(s)`}  [role=${report.role}, kit ${KIT_VERSION}]\n`);
await exitAfterFlush(report.ok ? 0 : 1);
