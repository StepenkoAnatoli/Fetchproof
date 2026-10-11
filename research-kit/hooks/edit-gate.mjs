#!/usr/bin/env node
// hooks/edit-gate.mjs - the edit-time adapter (ADR-0012, E-05 semantics).
//
// Reads the runtime's PreToolUse payload on stdin and emits a permissionDecision. The
// wire keys (`hookEventName`, `hookSpecificOutput`, `permissionDecision`) are the
// RUNTIME's protocol, not the kit's vocabulary: the kit does not get to rename them.
//
// It exits 0 and emits the wrapper rather than exiting 2. Exit 2 routes the same as
// deny with stderr as the reason, but a hook whose JSON fails schema validation used to
// be treated as a non-blocking error before v2.1.214 - emitting the wrapper is the
// correct side of that fix. `hard-block` stays behind editGate.mode.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluate, isGated, isPhaseOneEdit, stdinIsReadable } from '../lib/gate.mjs';
import { loadConfig } from '../lib/machine.mjs';
import { PATHS } from '../lib/core.mjs';

function emit(decision, reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  })}\n`);
  process.exit(0);
}

// Started from a terminal, with nothing piped in, there is no payload: reading would wait for an
// end of file that never comes (break-test PR #185, 2026-10-01 - alive with no output ten seconds
// later on a held pty). The same question bin/gate.mjs asks; a terminal carries nothing to judge.
if (!stdinIsReadable()) {
  process.stderr.write('edit gate: stdin is a terminal, so there is no payload to judge - allowing\n');
  emit('allow', 'the edit gate was started from a terminal with no payload on stdin, and did not judge');
}

let payload = {};
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch (err) {
  // A payload shape that changes upstream must not block the operator's work.
  process.stderr.write(`edit gate: unparsed payload (${err.message}) - allowing\n`);
  emit('allow', 'the edit gate could not read this payload and did not judge it');
}

// Valid JSON that is not an object (`null`, a number, an array) is no payload, and only a
// string is a path: either had crashed the hook with a raw stack on every Edit (2026-09-29,
// Arena break test), where an unparsable payload is allowed with a note.
if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};
const pathOf = (value) => (typeof value === 'string' && value ? value : '');
const cwd = path.resolve(pathOf(payload.cwd) || pathOf(payload.project_dir) || process.cwd());

// A cwd in a subfolder is judged by the repository it is in: that top level is where git runs
// the commit gate. Looking only at the cwd found no markers in src/ and allowed every edit
// there as "not a gated project" (found 2026-09-27). Not a search: git names the one
// repository this directory belongs to, and outside a repository the cwd is all there is.
//
// The question is about THIS directory, so git answers it from the directory alone. GIT_DIR,
// GIT_WORK_TREE and their kin override the cwd in every git child, and an editor process can
// carry them from wherever it was started: git then named another repository, whose top level
// is no ancestor of the cwd, and the hook allowed code as "not a gated project" - the gate
// failing open (found 2026-09-28, Arena break test 6). GIT_CEILING_DIRECTORIES is kept: it is
// the operator's own limit on discovery, not another repository's name.
const REPOSITORY_LOCATION = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX'];
function discoveryEnv() {
  const env = { ...process.env };
  for (const name of REPOSITORY_LOCATION) delete env[name];
  return env;
}
function projectRoot(dir) {
  if (isGated(dir)) return dir;
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, env: discoveryEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    // git names the top level by its real path (macOS: /private/tmp for /tmp; Windows: the
    // long name where the cwd may carry an 8.3 one, C:\Users\RUNNER~1). Walk up from the cwd
    // to the same directory instead, so the root keeps the spelling the targets use. The
    // native realpath is the one that expands 8.3 names, and Windows compares without case.
    const real = (p) => {
      try { return fs.realpathSync.native(p); } catch { /* fall through */ }
      try { return fs.realpathSync(p); } catch { return path.resolve(p); }
    };
    const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    const target = real(top);
    for (let d = dir; ; d = path.dirname(d)) {
      if (same(real(d), target)) return isGated(d) ? d : dir;
      if (path.dirname(d) === d) break;
    }
  } catch { /* not a repository, or no git: the cwd is all there is */ }
  return dir;
}
const root = projectRoot(cwd);

if (!isGated(root)) emit('allow', 'not a gated project');

// The file this call edits. Every target must be phase-1 work to pass unjudged; a call that
// names no file is judged as it always was.
const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
const targets = [input.file_path, input.notebook_path].filter((t) => typeof t === 'string' && t);

// research/raw/ is written by the collector and nothing else: captures and the ledger are
// fetched, never typed (AGENTS.md), and a ledger line forged with a correct hash and chain
// link would pass preflight. So an edit there is denied whatever the verdict - only the
// two deliberate off-switches, editGate.mode=off and research/GATE_OFF, let it through.
const rawDir = path.resolve(root, PATHS.raw);
const inRaw = (t) => {
  const rel = path.relative(rawDir, path.resolve(cwd, t));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
if (targets.some(inRaw) && loadConfig().editGate.mode !== 'off' && !fs.existsSync(path.resolve(root, PATHS.gateOff))) {
  emit('deny', `${PATHS.raw}/ holds fetched evidence: captures and the hash-chained ledger are written only by `
    + `research.mjs, never by hand. Collect the page with research.mjs (it records the fetch), and put `
    + `your reading of it in ${PATHS.evidence}.`);
}
// GATE_OFF is an operator override, not phase-1 research. Creating it through Write
// had disabled both gates before any failing verdict was judged (2026-10-10 audit).
// Descendants count too: creating GATE_OFF/note creates the directory that existsSync
// accepts as the override. Keep the same deliberate off-switches as the raw guard.
const gateOff = path.resolve(root, PATHS.gateOff);
const inGateOff = (t) => {
  const rel = path.relative(gateOff, path.resolve(cwd, t));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};
if (targets.some(inGateOff) && loadConfig().editGate.mode !== 'off' && !fs.existsSync(gateOff)) {
  emit('deny', `${PATHS.gateOff} is an operator override that disables both gates, not phase-1 research. `
    + 'Ask the operator to choose an override; close the unknowns with fetched evidence to pass the gate.');
}
if (targets.length && targets.every((t) => isPhaseOneEdit(root, path.resolve(cwd, t)))) {
  emit('allow', 'phase-1 work: research/ and the project\'s own scaffolding are what phase 1 edits');
}

let verdict;
try {
  verdict = evaluate(root, { gate: 'edit' });
} catch (err) {
  process.stderr.write(`edit gate: internal error (${err.message}) - allowing\n`);
  emit('allow', 'the edit gate failed and did not judge this call');
}

if (verdict.allow) emit('allow', verdict.reason);

const mode = loadConfig().editGate.mode;
if (mode === 'off') emit('allow', `the edit gate is off (editGate.mode=off); the verdict was: ${verdict.reason}`);

const lines = [
  'Research gate: the build is not ready.',
  '',
  verdict.reason,
  '',
  ...verdict.findings.slice(0, 5).map((f) => `  ${f.check}/${f.rule}: ${f.detail}`),
  '',
  `Close the unknown with fetched evidence, then: ${verdict.fix}`,
];
emit(mode === 'hard-block' ? 'deny' : 'ask', lines.join('\n'));
