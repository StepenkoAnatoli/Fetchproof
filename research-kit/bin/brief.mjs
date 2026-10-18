#!/usr/bin/env node
// bin/brief.mjs - draft the phase-1 -> phase-2 handoff, and report the brief's state.

import { parseFlags, PATHS, refuseUnknownFlags, checkFlagValues, kitCommand, writeFailure } from '../lib/core.mjs';
import { renderBrief, briefState, JUDGED_SECTIONS, judgedSection } from '../lib/brief.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { runPreflight } from '../lib/preflight.mjs';
import { isGated } from '../lib/gate.mjs';
import { GATE_MARKERS } from '../lib/scaffold.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['force', 'help', 'state']);
// No flag here takes a value, so a word after one is an argument (#289).
checkFlagValues(flags, {});
const root = process.cwd();
const corpus = readCorpus(root);

if (flags.help) {
  process.stdout.write(`brief - write research/BRIEF.md, the only file phase 2 is required to read.

  node research-kit/bin/brief.mjs [--force] [--state]

  --state   report the brief's state (template | legacy | draft | authored) and exit
  --force   overwrite a draft or authored brief (the old one is kept as BRIEF.md.bak-<date>)

Writing the brief is part of phase 1 and is not optional: a passing gate with no handoff
means the next agent re-researches everything you just verified.
`);
  process.exit(0);
}

if (flags.state) {
  const state = briefState(corpus.brief.text);
  process.stdout.write(`${PATHS.brief}: ${state}\n`);
  for (const key of JUDGED_SECTIONS) {
    const section = judgedSection(corpus.brief.text, key);
    process.stdout.write(`  ${key.padEnd(16)}${section?.answered ? 'answered' : 'still TODO'}\n`);
  }
  process.exit(0);
}

// Outside a research project there is nothing to draft a brief from, and writing research/ there
// litters a folder that is not a project - a later new-project in it kept the stray file
// (found 2026-09-28). preflight already says "not gated"; a writer refuses instead.
if (!isGated(root)) {
  process.stderr.write(`brief: ${root} is not a research project - it holds none of ${GATE_MARKERS.join(', ')}. Nothing was written.\n`
    + `Run this from the project folder, or make one: ${kitCommand('new-project.mjs', '<dir> --topic "<topic>"')}\n`);
  process.exit(2);
}

const verdict = runPreflight(root, { corpus });
if (!verdict.pass && !flags.force) {
  process.stdout.write(`the gate fails (${verdict.counts.fail} blocking finding(s)) - drafting anyway, but phase 2 does not start until it passes.\n\n`);
}

let result;
try {
  result = renderBrief(root, { force: Boolean(flags.force), corpus, verdict });
} catch (err) {
  const why = writeFailure(err);
  if (!why) throw err;
  process.stderr.write(`${why} The brief was not changed.\n`);
  process.exit(2);
}
if (!result.written) {
  process.stderr.write(`${result.reason}\n`);
  process.exit(1);
}

if (result.backup) process.stdout.write(`kept the brief it replaced at ${result.backup}\n`);
if (result.replacedUnedited) process.stdout.write('replaced the previous draft, which nobody had edited\n');
process.stdout.write(`wrote ${result.file} (${result.state})\n\nReview the TODO sections - the corpus cannot fill them - then hand this file to the builder.\n`);
