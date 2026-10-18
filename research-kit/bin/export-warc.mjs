#!/usr/bin/env node
// bin/export-warc.mjs - the corpus as one .warc.gz, a copy for archive tools (ADR-0090).

import { parseFlags, refuseUnknownFlags, kitCommand, operatorPath, writeBytes, writeFailure } from '../lib/core.mjs';
import { exportWarc, readWarc } from '../lib/warc.mjs';
import { evidenceAt } from '../lib/corpus.mjs';
import { isGated } from '../lib/gate.mjs';
import { GATE_MARKERS } from '../lib/scaffold.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['help', 'out']);

if (flags.help) {
  process.stdout.write(`export-warc - this project's captures as one WARC 1.1 file, for archive tools.

  node research-kit/bin/export-warc.mjs [--out <file>]

  --out   where to write (default research-corpus.warc.gz in the project folder)

One warcinfo record, then per fetched capture a resource record (the page text the kit
kept - never an HTTP exchange it did not store) and a metadata record (transport,
completeness, the ledger's hash and sequence number). A capture changed since its fetch is
left out and named. The corpus and its ledger remain the evidence; this is a copy.
`);
  process.exit(0);
}

const root = process.cwd();
if (!isGated(root)) {
  process.stderr.write(`export-warc: ${root} is not a research project - it holds none of ${GATE_MARKERS.join(', ')}.\n`
    + `Run this from the project folder, or make one: ${kitCommand('new-project.mjs', '<dir> --topic "<topic>"')}\n`);
  process.exit(2);
}
if (flags.out === true || flags.out === '') {
  process.stderr.write('export-warc: --out needs a file name\n');
  process.exit(2);
}

const out = operatorPath(root, typeof flags.out === 'string' ? flags.out : 'research-corpus.warc.gz');
// Over the ledger, a cited capture or anything in research/raw/ is refused before a byte is read (#330).
const refusal = evidenceAt(root, out);
if (refusal) { process.stderr.write(`export-warc: refused - ${refusal}\n`); process.exit(2); }
const { bytes, records, captures, skipped } = exportWarc(root);
readWarc(bytes); // a self-check: an export this reader cannot split is never written
try {
  writeBytes(out, bytes);
} catch (err) {
  const why = writeFailure(err);
  if (!why) throw err;
  process.stderr.write(`export-warc: ${why}\n`);
  process.exit(2);
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
process.stdout.write(`export-warc: wrote ${plural(records.length, 'record')} (${plural(captures, 'capture')}) to ${out}\n`);
for (const s of skipped) process.stdout.write(`  left out ${s.file} (ledger seq ${s.seq}): ${s.reason}\n`);
