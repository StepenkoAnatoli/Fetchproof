#!/usr/bin/env node
// bin/measure.mjs - how well this project's citations hold up, without a judge (ADR-0089).

import { parseFlags, refuseUnknownFlags, checkFlagValues, kitCommand } from '../lib/core.mjs';
import { measureCorpus, renderMeasure } from '../lib/measure.mjs';
import { isGated } from '../lib/gate.mjs';
import { GATE_MARKERS } from '../lib/scaffold.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['help', 'json']);
// No flag here takes a value, so a word after one is an argument (#289).
checkFlagValues(flags, {});

if (flags.help) {
  process.stdout.write(`measure - how well this project's citations hold up, computed without a judge.

  node fetchproof/bin/measure.mjs [--json]

Reports link works, quote anchors found, full captures, closure strength and quote coverage
(how many CLOSED unknowns cite a row with a quote that is not too short and is found in its
capture). Whether a page SUPPORTS its claim needs a judge and is named, not computed. A
report: it never gates.
`);
  process.exit(0);
}

if (!isGated(process.cwd())) {
  process.stderr.write(`measure: ${process.cwd()} is not a research project - it holds none of ${GATE_MARKERS.join(', ')}.\n`
    + `Run this from the project folder, or make one: ${kitCommand('new-project.mjs', '<dir> --topic "<topic>"')}\n`);
  process.exit(2);
}

const m = measureCorpus(process.cwd());
process.stdout.write(flags.json ? `${JSON.stringify(m, null, 2)}\n` : `${renderMeasure(m).join('\n')}\n`);
