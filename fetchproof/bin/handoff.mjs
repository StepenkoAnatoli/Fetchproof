#!/usr/bin/env node
// bin/handoff.mjs - the builder's FIRST command.
//
// It asks the arrival question and names whatever is missing. It cannot repair anything:
// the machine that asks cannot collect the missing bytes.

import { parseFlags, refuseUnknownFlags, checkFlagValues, kitCommand, exitAfterFlush } from '../lib/core.mjs';
import { verifyHandoff, handoffRemedy } from '../lib/handoff.mjs';
import { machineRole } from '../lib/machine.mjs';
import { heading } from '../lib/render.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['help', 'json']);
// No flag here takes a value, so a word after one is an argument (#289).
checkFlagValues(flags, {});
const root = process.cwd();

if (flags.help) {
  process.stdout.write(`handoff - did the corpus arrive whole?

  node fetchproof/bin/handoff.mjs [--json]

Checks that research/raw/.fetches.jsonl is present and non-empty, that research/EVIDENCE.md
is here with its table, that every capture an evidence row names is on disk, and that the
chain verifies. Exit 1 names what is missing, and the remedy depends on the cause.

It checks integrity, not currency: OK means the corpus arrived as it was fetched, not that
the pages still say the same today. The OK line ends with the days the captures were
fetched and the oldest one's age.
`);
  process.exit(0);
}

const report = verifyHandoff(root);

if (flags.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await exitAfterFlush(report.ok ? 0 : 1);
}

if (report.ok) {
  // How old the snapshot is, never whether it is current: this machine cannot fetch to know
  // (ADR-0187).
  const { fetched } = report;
  const age = fetched
    ? `captures fetched ${fetched.from}..${fetched.to} (oldest ${fetched.oldestDays} day${fetched.oldestDays === 1 ? '' : 's'})`
    : 'no capture date on record';
  process.stdout.write(`handoff OK - ${report.entries} ledger entries, ${report.rows} evidence rows, every capture they cite on disk, chain verifies; ${age}.  [role=${machineRole()}]\n`);
  // The corpus arrived whole; whether anyone reviewed the handoff is a separate fact, and
  // phase 2 starts from the brief.
  if (report.brief.state === 'draft') {
    process.stdout.write(`\nnote: research/BRIEF.md is a draft - ${report.brief.todo.join(', ')} still TODO. It is not a reviewed\n`
      + 'handoff: ask whoever ran phase 1 to answer those sections before building on it.\n');
  } else if (report.brief.state === 'template') {
    process.stdout.write('\nnote: research/BRIEF.md has not been drafted - there is no handoff to build from yet.\n');
  }
  process.exit(0);
}

// On a collector, an empty project is not a corpus that failed to arrive: it is one that
// has not been collected yet, on this very machine (the doctor says the same).
if (report.nothingCollected && machineRole() === 'collector') {
  process.stdout.write(`handoff: nothing to hand off yet - nothing has been collected in this project.\n\n`
    + `Collect it here, then commit research/ including research/raw/ and its dotfiles:\n  ${kitCommand('research.mjs')}\n`);
  process.exit(1);
}

process.stdout.write(`${heading('handoff FAILED')}\n`);
for (const finding of report.findings.filter((f) => f.name !== 'handoff-remedy')) {
  process.stdout.write(`  ${finding.name}  ${finding.detail}\n`);
}
const remedy = handoffRemedy(report);
if (remedy) process.stdout.write(`\n${remedy}\n`);
await exitAfterFlush(1);
