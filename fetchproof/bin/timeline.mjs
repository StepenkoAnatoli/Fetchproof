#!/usr/bin/env node
// bin/timeline.mjs - regenerate research/TIMELINE.md.

import { parseFlags, refuseUnknownFlags, checkFlagValues, kitCommand, writeFailure } from '../lib/core.mjs';
import { renderTimeline } from '../lib/timeline.mjs';
import { isGated } from '../lib/gate.mjs';
import { GATE_MARKERS } from '../lib/scaffold.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['help']);
// No flag here takes a value, so a word after one is an argument (#289).
checkFlagValues(flags, {});

if (flags.help) {
  process.stdout.write(`timeline - regenerate the chronological review aid.

  node fetchproof/bin/timeline.mjs

Derived, and deliberately outside the chain: never part of a gate decision.
`);
  process.exit(0);
}

// Outside a research project there is nothing to put on a timeline, and writing research/ there
// litters a folder that is not a project - a later new-project in it kept the stray file
// (found 2026-09-28). preflight already says "not gated"; a writer refuses instead.
if (!isGated(process.cwd())) {
  process.stderr.write(`timeline: ${process.cwd()} is not a research project - it holds none of ${GATE_MARKERS.join(', ')}. Nothing was written.\n`
    + `Run this from the project folder, or make one: ${kitCommand('new-project.mjs', '<dir> --topic "<topic>"')}\n`);
  process.exit(2);
}

try {
  const result = renderTimeline(process.cwd());
  process.stdout.write(`wrote ${result.file} (${result.events} events)\n`);
} catch (err) {
  const why = writeFailure(err);
  if (!why) throw err;
  process.stderr.write(`${why} Nothing was changed.\n`);
  process.exit(2);
}
