#!/usr/bin/env node
// bin/audit.mjs - render, list, resolve, and bundle audits.
//
// It PRINTS what lib/audit.mjs returns. It used to walk the raw index itself with a
// second sort, which made the reader below it dead code and the ordering unsettleable.

import { parseFlags, refuseUnknownFlags, checkFlagValues, PATHS, kitCommand, writeFailure, exitAfterFlush } from '../lib/core.mjs';
import { writeAudit, listVersions, resolveVersion, zipAudit, readAuditFile } from '../lib/audit.mjs';
import { heading } from '../lib/render.mjs';
import { isGated } from '../lib/gate.mjs';
import { GATE_MARKERS } from '../lib/scaffold.mjs';
const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['force', 'help', 'list', 'show', 'topic', 'version', 'zip']);
checkFlagValues(flags, { topic: 'value', show: 'value', version: 'value' });
// A flag that only means something beside another is refused alone: `audit --version v9`
// rendered a new audit and never mentioned v9, and --topic without --zip was dropped the
// same way (found 2026-09-27).
if (flags.version !== undefined && flags.show === undefined) {
  process.stderr.write('--version only works with --show <topic>: audit --show <topic> --version <v>\n');
  process.exit(2);
}
if (flags.topic !== undefined && !flags.zip) {
  process.stderr.write('--topic only works with --zip: audit --zip --topic <topic>\n');
  process.exit(2);
}
const root = process.cwd();

if (flags.help) {
  process.stdout.write(`audit - the immutable, pasteable snapshot of one research pass.

  node research-kit/bin/audit.mjs [options]

  (no flags)            render a new version if the corpus changed
  --list                list the topics and versions the manifest holds
  --show <topic>        print one topic's latest audit
  --version <v>         with --show, print that version
  --zip [--topic <s>]   bundle a topic's latest audits into one .zip attachment
  --force               render even when unchanged

An audit renders only when the gate passes: a snapshot of an unproven corpus is a
snapshot of a claim nobody checked.
`);
  process.exit(0);
}

if (flags.zip) {
  // --zip refuses these rather than ignoring them: they promise a regenerate or a
  // question, and packaging does neither.
  for (const flag of ['force', 'list', 'show']) {
    if (flags[flag]) {
      process.stderr.write(`--zip cannot be combined with --${flag}: packaging neither regenerates nor asks\n`);
      process.exit(2);
    }
  }
  let result;
  try {
    result = zipAudit(root, { topic: typeof flags.topic === 'string' ? flags.topic : '' });
  } catch (err) {
    const why = writeFailure(err, root);
    if (!why) throw err;
    process.stderr.write(`${why}\n`);
    process.exit(2);
  }
  if (!result.ok) {
    process.stderr.write(`${result.reason}\n`);
    if (result.known?.length) process.stderr.write(`known topics: ${result.known.join(', ')}\n`);
    if (result.fix) process.stderr.write(`${result.fix}\n`);
    process.exit(result.exit);
  }
  process.stdout.write(`${result.file}  (${result.count} file(s), ${result.bytes} bytes)\n`);
  process.exit(0);
}

if (flags.list) {
  const { topics } = listVersions(root);
  if (!topics.length) { process.stdout.write('no audits yet\n'); process.exit(0); }
  for (const topic of topics) {
    process.stdout.write(`${topic.slug}  latest v${topic.latest}  [${topic.versions.map((v) => `v${v}`).join(' ')}]  ${topic.topic}\n`);
  }
  await exitAfterFlush(0);
}

if (typeof flags.show === 'string') {
  const { known } = listVersions(root);
  const slug = known.includes(flags.show) ? flags.show : known.find((k) => k.startsWith(flags.show));
  if (!slug) {
    process.stderr.write(`no audits for "${flags.show}". Known topics: ${known.join(', ') || '(none)'}\n`);
    process.exit(1);
  }
  const held = resolveVersion(root, slug, typeof flags.version === 'string' ? flags.version : null);
  if (!held) { process.stderr.write(`no such version for "${slug}"\n`); process.exit(1); }
  if (!held.main) { process.stderr.write(`the manifest records no audit file for "${slug}" v${held.version}\n`); process.exit(1); }
  const read = readAuditFile(root, held.main);
  if (read.text === null) { process.stderr.write(`${read.reason}${read.outside ? ` - refusing to show it. Repair ${PATHS.audits}/index.json` : ''}\n`); process.exit(1); }
  process.stdout.write(read.text);
  await exitAfterFlush(0);
}

// Outside a research project there is no corpus to snapshot, and the render path would
// quote a preflight verdict that says the gate FAILS - a verdict for a folder with nothing
// to judge, where gate.mjs and preflight.mjs both say "not gated" and exit 0
// (found 2026-09-30, break-test). A writer refuses instead, in the words the other
// writers use.
if (!isGated(root)) {
  process.stderr.write(`audit: ${root} is not a research project - it holds none of ${GATE_MARKERS.join(', ')}. Nothing was written.\n`
    + `Run this from the project folder, or make one: ${kitCommand('new-project.mjs', '<dir> --topic "<topic>"')}\n`);
  process.exit(2);
}

// Read BEFORE the write, so the note below can tell a continuation of a chain from a new
// one. The slug comes from the map's topic line - the line phase 0 asks the operator to own -
// so refining a topic starts a chain of its own, and that used to happen in silence: the run
// printed `v0.1` and the next `audit.mjs --zip` refused with "several topics hold audits and
// none was named", which is the exact command the line below it had just recommended
// (found 2026-09-30, break-test).
const held = listVersions(root).known;

let result;
try {
  result = writeAudit(root, { force: Boolean(flags.force) });
} catch (err) {
  const why = writeFailure(err, root);
  if (!why) throw err;
  process.stderr.write(`${why}\n`);
  process.exit(2);
}
if (!result.written) {
  process.stdout.write(`${result.reason}\n`);
  process.exit(result.verdict && !result.verdict.pass ? 1 : 0);
}

process.stdout.write(`${heading(`audit v${result.version}`)}\n`);
process.stdout.write(`${result.main}\n`);
for (const file of result.subtopics) process.stdout.write(`${file}\n`);
if (result.continued) {
  process.stdout.write(`\ncontinuing ${result.continued.as} as v${result.version}: the slug spelling changed, the topic did not\n`
    + `  (it would be ${result.continued.from} today; audits keep the name they were first written under)\n`);
}
const others = held.filter((slug) => slug !== result.slug);
if (!held.includes(result.slug) && others.length) {
  process.stdout.write(`\nThis started a NEW topic, \`${result.slug}\` - the map's topic line decides the\n`
    + `slug, and it does not match the one audits are already held under: ${others.join(', ')}.\n`
    + 'Audits are never rewritten, so both chains stay; `audit.mjs --list` shows them, and\n'
    + '`--zip` needs to be told which one.\n');
}
const topicFlag = others.length ? ` --topic ${result.slug}` : '';
process.stdout.write(`\nOne attachment instead of ${result.subtopics.length + 1} pastes:\n  ${kitCommand('audit.mjs', `--zip${topicFlag}`)}\n`);
