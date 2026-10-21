#!/usr/bin/env node
// bin/export-warc.mjs - the corpus as one .warc.gz, a copy for archive tools (ADR-0090).

import fs from 'node:fs';
import { parseFlags, refuseUnknownFlags, checkFlagValues, kitCommand, operatorPath, writeBytes, writeFailure } from '../lib/core.mjs';
import { exportWarc, readWarc } from '../lib/warc.mjs';
import { evidenceAt } from '../lib/corpus.mjs';
import { isGated } from '../lib/gate.mjs';
import { GATE_MARKERS } from '../lib/scaffold.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['help', 'out']);
checkFlagValues(flags, { out: 'value' });

if (flags.help) {
  process.stdout.write(`export-warc - this project's captures as one WARC 1.1 file, for archive tools.

  node fetchproof/bin/export-warc.mjs [--out <file>]

  --out   where to write (default research-corpus.warc.gz in the project folder)

One warcinfo record, then per fetched capture a resource record (the page text the kit
kept - never an HTTP exchange it did not store) and a metadata record (transport,
completeness, the capture file's hash, the block's own hash and the ledger's sequence
number). A capture changed since its fetch, or a ledger entry with no date, is left out and
named, and the command exits 2 (INCOMPLETE); a clean export exits 0. The corpus and its
ledger remain the evidence; this is a copy.
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
// The bytes on disk are re-read, not assumed from the ones in hand (rank 15, 2026-10-04 gap
// audit): a write that landed corrupted is refused, never reported as an archive. writeBytes
// writes a scratch file and renames it, so the window is small; the check is cheap and the
// file is the product.
try {
  readWarc(fs.readFileSync(out));
} catch (err) {
  process.stderr.write(`export-warc: the written file could not be read back as WARC (${err.message})\n`);
  process.exit(2);
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
process.stdout.write(`export-warc: wrote ${plural(records.length, 'record')} (${plural(captures, 'capture')}) to ${out}\n`);
for (const s of skipped) process.stdout.write(`  left out ${s.file} (ledger seq ${s.seq}): ${s.reason}\n`);
// Rank 7 (2026-10-03 gap audit; rank 15, 2026-10-04 gap audit): a capture left out used to
// exit 0, so a caller could not tell a partial export from a whole one. A partial export is
// INCOMPLETE, and README.md maps INCOMPLETE to 2 (FAIL/REOPEN is 1). The file it could write
// is still written.
process.exit(skipped.length ? 2 : 0);
