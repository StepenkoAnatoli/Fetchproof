#!/usr/bin/env node
// bin/bundle.mjs - how far has this repository moved from the archive it came from?
//
// The digests in BUNDLE_INDEX.md had never been checked by anything. ADR-0022 treated
// them as a constraint on editing; ADR-0028 treats them as a record, and this is what
// makes the record worth keeping.

import { parseFlags, refuseUnknownFlags, checkFlagValues } from '../lib/core.mjs';
import { verifyBundle, bundleSummary, BUNDLE_INDEX } from '../lib/bundle.mjs';
import { heading } from '../lib/render.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['all', 'help', 'json']);
// No flag here takes a value, so a word after one is an argument (#289).
checkFlagValues(flags, {});
const root = process.cwd();

if (flags.help) {
  process.stdout.write(`bundle - compare this project against the archive it was handed over as.

  node research-kit/bin/bundle.mjs [--all] [--json]

  --all    list every file, not only the ones that moved
  --json   print the report as JSON instead

${BUNDLE_INDEX} is a frozen record of a past state (ADR-0028), not a promise about the
present. A corpus that never changed would mean a kit nobody used. What this reports is
the difference between a file that moved because the project is alive and one that moved
without anybody noticing.
`);
  process.exit(0);
}

const result = verifyBundle(root);

if (flags.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

if (!result.present) {
  process.stdout.write(`${result.reason}\n`);
  process.exit(0);
}

process.stdout.write(`${heading('bundle')}\n${bundleSummary(result)}\n`);

if (result.drifted.length) {
  process.stdout.write(`\n${heading('changed, and expected to have')}\n`);
  for (const file of result.drifted) process.stdout.write(`  ${file}\n`);
}

if (result.unexpected.length) {
  process.stdout.write(`\n${heading('changed, and NOT expected to have')}\n`);
  for (const file of result.unexpected) process.stdout.write(`  ${file}\n`);
  process.stdout.write('\nNothing is wrong by definition - but each of these was a planning document\n'
    + 'the archive shipped, and the reason it moved should be in a commit message.\n');
}

if (result.missing.length) {
  process.stdout.write(`\n${heading('gone')}\n`);
  for (const file of result.missing) process.stdout.write(`  ${file}\n`);
}

if (flags.all) {
  process.stdout.write(`\n${heading('unchanged since 2026-09-17')}\n`);
  for (const file of result.unchanged) process.stdout.write(`  ${file}\n`);
}

// Reports; does not judge. A non-zero exit would make this a gate, and it is not one.
process.exit(0);
