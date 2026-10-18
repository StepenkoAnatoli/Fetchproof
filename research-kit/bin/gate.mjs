#!/usr/bin/env node
// bin/gate.mjs - the CLI adapter over lib/gate.mjs's verdict.
//
// Exit codes: 0 allow, 1 block, 2 internal error.
// `--posture` answers the machine's posture without making any shell parse JSON:
//   0 allow / 1 a config that parses says fail-closed / 2 unreadable and resolved to blocking.

import fs from 'node:fs';
import { parseFlags, flagList, refuseUnknownFlags, checkFlagValues, PATHS, resolve, isDirectory } from '../lib/core.mjs';
import { evaluate, readStagedPaths, splitPathList, stdinIsReadable, isGated, stagedProjects, trackedContracts, shellWord, SUITE_RULE } from '../lib/gate.mjs';
import { posture } from '../lib/machine.mjs';
import { recordDiagnostic } from '../lib/timeline.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['gate', 'help', 'json', 'posture', 'quiet', 'staged', 'staged-stdin'], { repeatable: ['staged'] });
checkFlagValues(flags, { gate: { choices: ['commit', 'edit'] }, staged: 'value' });

if (flags.help) {
  process.stdout.write(`gate - the verdict, for a hook.

  node research-kit/bin/gate.mjs [options]

  --gate commit|edit   which gate is asking (default commit)
  --staged-stdin       read the staged path list from stdin, as DATA on a pipe
  --staged <path>      one staged path (repeatable) - for callers with a short list
  --posture            print this machine's posture and exit with its code
  --json               machine-readable verdict
  --quiet              say nothing when the answer is allow

Without a staged option, a commit invocation reads the actual Git staged list once.
Exit codes: 0 allow, 1 block, 2 internal error.
--posture exits 0 allow / 1 a config that parses says fail-closed / 2 unreadable and
resolved to blocking - so no shell has to parse JSON.
`);
  process.exit(0);
}

if (flags.posture) {
  const state = posture();
  process.stdout.write(`${state.failOpen ? 'fail-open' : 'fail-closed'} (config ${state.configState})\n`);
  process.exit(state.exitCode);
}

const cwd = process.cwd();
const gate = flags.gate === 'edit' ? 'edit' : 'commit';

// Short-circuit on the gating predicate first: the edit gate pays node's startup on
// every tool call, and an ungated project must cost as little as possible.
if (!isGated(cwd) && gate === 'edit') notGated();

function notGated() {
  if (flags.json) process.stdout.write(`${JSON.stringify({ verdict: 'not-gated', allow: true })}\n`);
  process.exit(0);
}

// The staged list a caller supplied: undefined when none was, an array otherwise.
function suppliedStaged() {
  if (flags['staged-stdin']) {
    if (!stdinIsReadable()) {
      process.stderr.write('gate: --staged-stdin was given but stdin is a terminal - refusing to guess an empty staged set\n');
      process.exit(2);
    }
    let text = null;
    try {
      text = fs.readFileSync(0, 'utf8');
    } catch (err) {
      // "no paths" and "could not read the paths" must not both mean allow.
      process.stderr.write(`gate: could not read the staged path list from stdin (${err.message})\n`);
      process.exit(2);
    }
    const paths = splitPathList(text);
    if (paths === null) {
      process.stderr.write('gate: the staged path list could not be read\n');
      process.exit(2);
    }
    return paths;
  }
  return flags.staged !== undefined ? flagList(flags.staged) : undefined;
}

const UNLISTED = 'research gate: git could not list the staged paths - staged scope is unknown, so the gate cannot assume an empty commit. Check git diff --cached --name-only --no-renames, or override: git commit --no-verify\n';
const announceSuite = () => process.stderr.write(
  'research gate: the rest of the gate passes; this is the kit\'s own checkout and the commit touches research-kit/, so the suite runs before the commit is allowed (ADR-0120) ...\n');

// What is judged: the cwd when it is a gated project; otherwise (#309) each gated project
// below it that a staged path belongs to - git runs the hook at the repository's top level,
// and a project scaffolded below it was never judged. `project` names it in what is printed.
let judged;
if (isGated(cwd)) {
  judged = [{ root: cwd, project: null, stagedPaths: suppliedStaged() }];
} else {
  let staged = suppliedStaged();
  if (staged === undefined) staged = readStagedPaths(cwd);
  if (staged === null) {
    // Nothing here is gated, and without the list nothing below can be found: the hook stays
    // what it was for an ungated repository, and says what it could not judge.
    process.stderr.write('research gate: git could not list the staged paths, so no project below this top level was judged\n');
    notGated();
  }
  // One git ls-files names every tracked research/DISCOVERY.md, so a repository with no project
  // pays one call and no per-folder disk reads (#309); null falls back to asking the disk.
  judged = stagedProjects(cwd, staged, { contracts: trackedContracts(cwd) }).map((group) => ({ ...group, top: cwd }));
  if (!judged.length) notGated();
}

const verdicts = [];
for (const one of judged) {
  let stagedPaths = one.stagedPaths;
  // Acquisition happens inside evaluate after ungated/GATE_OFF checks. It does not
  // replace an explicitly supplied stdin/list, and an edit has no staged set to read.
  const listStaged = gate === 'commit' && stagedPaths === undefined
    ? () => {
      stagedPaths = readStagedPaths(one.root);
      if (stagedPaths === null) process.stderr.write(UNLISTED);
      return stagedPaths;
    } : null;
  let verdict;
  try {
    // Minutes of silence from a commit hook read as git being broken (the hook says the same of
    // its watchdog), so the suite rule says the suite is running, as it starts it (ADR-0120).
    verdict = evaluate(one.root, { gate, ...(listStaged ? { listStaged } : { stagedPaths }), ...(one.top ? { top: one.top } : {}), announceSuite });
  } catch (err) {
    process.stderr.write(`gate: internal error${one.project ? ` in ${one.project}` : ''} - ${err.message}\n`);
    process.exit(2);
  }
  // Only where research/raw/ already is: the log lives there, and creating that folder makes a
  // directory gated - the hook wrote one into a data folder of a repository without the kit.
  try {
    if (isDirectory(resolve(one.root, PATHS.raw))) recordDiagnostic(one.root, { gate, verdict: verdict.verdict, staged: stagedPaths?.length ?? null });
  } catch { /* a read-only checkout must not break the gate */ }
  verdicts.push({ ...one, verdict });
}

const blocked = verdicts.filter((v) => !v.verdict.allow);
const where = (v) => (v.project ? ` in ${v.project}` : '');

if (flags.json) {
  // One verdict: the first that blocks, or the first. `project` only when it is below the cwd.
  const { verdict, project } = blocked[0] ?? verdicts[0];
  process.stdout.write(`${JSON.stringify({
    ...(project ? { project } : {}),
    verdict: verdict.verdict,
    allow: verdict.allow,
    reason: verdict.reason,
    fix: verdict.fix,
    findings: verdict.findings.map(({ severity, check, rule, detail }) => ({ severity, check, rule, detail })),
  }, null, 2)}\n`);
  process.exit(blocked.length ? 1 : 0);
}

for (const v of verdicts) {
  if (v.verdict.verdict === 'override') process.stdout.write(`research gate: OFF${where(v)} - ${v.verdict.reason}\n`);
  else if (v.verdict.allow && !flags.quiet) process.stdout.write(`research gate: allow${where(v)} - ${v.verdict.reason}\n`);
}
if (!blocked.length) process.exit(0);

for (const v of blocked) {
  const verdict = v.verdict;
  process.stderr.write(`
research gate: BLOCKED${where(v)} - ${verdict.reason}

`);
  for (const finding of verdict.findings.slice(0, 10)) {
    process.stderr.write(`  ${finding.severity}  ${finding.check}/${finding.rule}  ${finding.detail}\n`);
  }
  // A project below the cwd is where its fix runs, and its GATE_OFF is its own (#309).
  const command = /^(node|git) /.test(verdict.fix);
  const fix = !v.project ? verdict.fix
    : command ? `cd ${shellWord(v.project)} && ${verdict.fix}` : `(from ${shellWord(v.project)}) ${verdict.fix}`;
  process.stderr.write(`
Fix: ${fix}
`);
}
// A rule block happens only when the gate PASSES, so the phase-1 line would be false there.
const { breach } = blocked[0].verdict;
const gateOff = blocked[0].project ? `${blocked[0].project}/${PATHS.gateOff}` : PATHS.gateOff;
const why = breach?.rule === SUITE_RULE
  ? 'The research gate passes. This is the suite rule: in the kit\'s own checkout, a commit\ntouching research-kit/ needs a green suite (ADR-0120). Overrides:'
  : breach
    ? 'The research gate passes. This is the architecture-map rule: the gate needs a known\nstaged path list to check that declared code changes stage docs/ARCHITECTURE.md with them. Overrides:'
    : 'Phase 1 is not done until preflight prints PASS. Overrides:';
process.stderr.write(`
${why}
  git commit --no-verify        the native escape hatch - git skips this hook, so nothing records it; say so in your reply
  ${gateOff.padEnd(29)} turn the gate off for ${blocked[0].project ? 'that project' : 'this repository'}, deliberately - recorded in ${blocked[0].project ? `${blocked[0].project}/` : ''}research/overrides.log
`);
process.exit(1);
