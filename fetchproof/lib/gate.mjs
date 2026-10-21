// gate.mjs - gate policy (ADR-0002, ADR-0007, ADR-0008, ADR-0020).
//
// `isGated` (the four markers), `evaluate` (commit and edit), the GATE_OFF recording,
// and the architecture-map rule. Contains no repo-specific path.
//
// Explicit staged-path lists arrive as DATA ON A PIPE, because argv was O(n^2) to
// build and bounded besides. The hook's default CLI reads one actual Git list in Node.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PATHS, resolve, exists, isDirectory, readJson, readText, tempBase, foldLineEndings } from './core.mjs';
import { GATE_MARKERS, TEMPLATE_DIR } from './scaffold.mjs';
import { runPreflight, verdictContext, readGateState, fixCommand } from './preflight.mjs';
import { readCorpus } from './corpus.mjs';
import { isGitRepo } from './machine.mjs';
import { recordOverride } from './provenance.mjs';
import { CORPUS_ADD } from './handoff.mjs';

export const DEFAULT_CODE_PATHS = Object.freeze(['src', 'lib', 'bin', 'scripts', 'app']);

/**
 * The project's own scaffolding, which the commit gate lets through while the verdict fails
 * (ADR-0048): how the corpus travels, and the rules that bind whoever opens it. None of it is
 * product. Root paths only.
 *
 * Found 2026-09-27: after new-project, `git add -A && git commit` was refused because these
 * files sit outside research/. So for the whole of phase 1 the corpus travelled without the
 * .gitattributes that keeps its hashes valid on a Windows checkout (ADR-0020), and without
 * the rules that bind an agent opening it mid-research.
 */
export const SCAFFOLDING = Object.freeze(['.gitattributes', '.gitignore', 'AGENTS.md', 'START_HERE.md']);

/**
 * Whether an edit to one file is phase-1 work: the corpus under research/, or the project's own
 * scaffolding. The edit gate asks this about the file an edit names. It did not look at the
 * file at all, so while phase 1 was open it interrupted every edit to research/MAP.md and
 * DISCOVERY.md - the work AGENTS.md tells the agent to do (found 2026-09-27). The map is not
 * here: an edit gives it content, and a map with content is phase 2 (ADR-0048).
 */
export function isPhaseOneEdit(root, file) {
  const rel = path.relative(path.resolve(root), path.resolve(root, String(file))).split(path.sep).join('/');
  if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return false;
  return rel.startsWith('research/') || SCAFFOLDING.includes(rel);
}

/**
 * The architecture map is a map of CODE, and in phase 1 there is none. The scaffold's empty
 * map may travel with the corpus; a map with a design in it is phase 2 and stays gated. The
 * template carries no token, so "empty" is "the template's bytes", line endings aside.
 */
export function isEmptyArchitectureMap(text) {
  if (typeof text !== 'string') return false;
  const template = readText(path.join(TEMPLATE_DIR, 'docs', 'ARCHITECTURE.md'));
  if (template === null) return false;
  return foldLineEndings(text) === foldLineEndings(template);
}

/**
 * One staged file's text: the index's bytes, or, outside a repository, the working tree's.
 * `top` is the repository's top level when the project is below it (#309): git runs there,
 * and the index names the file by its path from there.
 */
export function readStagedText(root, rel, { run = gitCapture, top = null } = {}) {
  const at = top ?? root;
  if (!isGitRepo(at)) return readText(resolve(root, rel));
  return run(['show', `:${projectPrefix(top, root)}${rel}`], { cwd: at });
}

/** A project is gated when ANY of the four markers exists. */
export function isGated(root) {
  return GATE_MARKERS.some((marker) => {
    const abs = resolve(root, marker);
    return marker.endsWith('/') || marker === PATHS.raw ? isDirectory(abs) : exists(abs);
  });
}

/** The project's path from the top level, as git spells it, with a trailing slash; '' at the top. */
function projectPrefix(top, root) {
  if (!top) return '';
  const rel = path.relative(top, root).split(path.sep).join('/');
  return rel ? `${rel}/` : '';
}

/**
 * Whether a contract's text is one new-project rendered: the kit's heading, with the template's
 * {{TOPIC}} token filled in. The kit's own template/ - vendored into other repositories - keeps
 * the token; a markdown note that happens to be called DISCOVERY.md lacks the heading.
 */
export function isKitContract(text) {
  if (typeof text !== 'string') return false;
  const body = text.replace(/^﻿/, '');
  return body.startsWith('# Discovery Contract - ') && !body.includes('{{TOPIC}}');
}

/**
 * Whether a directory BELOW the repository's top level is a kit project (#309, ADR-0182): it
 * holds research/DISCOVERY.md, and either research/raw/ or a contract new-project rendered
 * (`isKitContract`). Any one of the four gate markers is not enough there: a data folder's
 * research/raw/survey.csv or an experiment's research/plan.json, in a repository that never
 * heard of the kit, made the machine-wide hook block its commits, and so did a vendored copy of
 * the kit's template/ (review of #309, 2026-10-18). raw/ alone is not the second signal either:
 * a repository that ignores raw/ folders never carries it to a clone, and the project escaped
 * both gates on the builder's machine (second review, the same day). The top level keeps the
 * four markers. `named` is the set of paths a caller already knows of, such as the staged list,
 * whose deletions are still this project's: `git rm research/DISCOVERY.md` does not ungate it.
 */
export function isProjectBelowTop(dir, { named = null, rel = null } = {}) {
  const contract = resolve(dir, PATHS.discovery);
  const namedContract = Boolean(named && rel !== null && named.contracts.has(rel));
  if (!exists(contract) && !namedContract) return false;
  if (isDirectory(resolve(dir, PATHS.raw)) || Boolean(named && rel !== null && named.rawDirs.has(rel))) return true;
  return isKitContract(readText(contract));
}

/**
 * The gated projects a commit's staged paths belong to, when the top level the hook runs at
 * is not one (#309): each path goes to its NEAREST project below `top` (`isProjectBelowTop`),
 * and keeps its path relative to that project. A path under no project is in no group. Not a
 * search: the directories asked about are the staged paths' own parents, remembered per
 * directory. `contracts` - the directories whose research/DISCOVERY.md the index tracks
 * (`trackedContracts`, one git call) - makes them string lookups: 30,000 staged paths in 9,060
 * folders had cost 25 s on a loaded host at four existsSync calls each, near the hook's 120 s
 * watchdog, in a repository that has no project at all. A candidate with no research/raw/ on
 * disk has its contract read (`contractText`). Without `contracts` (git could not list them)
 * each directory with a research/ folder is asked of the disk, one stat for one without.
 *
 * Found 2026-10-13: git runs pre-commit with the top level as cwd, which carried no marker, so
 * the gate answered "not-gated" before it read a staged path - code staged in a failing
 * packages/a, or in the README's docs/research/... example, was never judged.
 */
export function stagedProjects(top, stagedPaths, { contracts = null, readContract = (rel) => contractText(top, rel) } = {}) {
  const normal = (name) => {
    const text = String(name);
    const slashed = text.includes('\\') ? text.split('\\').join('/') : text;
    return slashed.includes('//') || slashed.startsWith('./') || slashed.includes('/./')
      ? slashed.split('/').filter((p) => p && p !== '.').join('/') : slashed;
  };
  const names = stagedPaths.map(normal);
  // What the staged list itself names, deletions included.
  const named = { contracts: new Set(), rawDirs: new Set() };
  const rawMark = `/${PATHS.raw}/`;
  for (const n of names) {
    if (n.endsWith(`/${PATHS.discovery}`)) named.contracts.add(n.slice(0, -(PATHS.discovery.length + 1)));
    for (let at = n.indexOf(rawMark); at > 0; at = n.indexOf(rawMark, at + 1)) named.rawDirs.add(n.slice(0, at));
  }
  const candidates = Array.isArray(contracts) ? new Set([...contracts, ...named.contracts]) : null;
  const known = new Map();
  const isProject = (rel) => {
    let answer = known.get(rel);
    if (answer === undefined) {
      if (candidates) {
        // raw/ when it is there; otherwise the contract itself, read from the index - a clone
        // whose repository ignores raw/ folders has none, and the project is still one.
        answer = candidates.has(rel) && (named.rawDirs.has(rel) || isDirectory(resolve(resolve(top, rel), PATHS.raw))
          || isKitContract(readContract(rel)));
      } else {
        const dir = resolve(top, rel);
        answer = (isDirectory(resolve(dir, 'research')) || named.contracts.has(rel) || named.rawDirs.has(rel))
          && isProjectBelowTop(dir, { named, rel });
      }
      known.set(rel, answer);
    }
    return answer;
  };
  const groups = new Map();
  for (const n of names) {
    // Each parent of the path, nearest first; the top level itself ('') is never one.
    for (let cut = n.lastIndexOf('/'); cut > 0; cut = n.lastIndexOf('/', cut - 1)) {
      const dir = n.slice(0, cut);
      if (!isProject(dir)) continue;
      if (!groups.has(dir)) groups.set(dir, { project: dir, root: resolve(top, dir), stagedPaths: [] });
      groups.get(dir).stagedPaths.push(n.slice(cut + 1));
      break;
    }
  }
  return [...groups.values()];
}

/**
 * The directories below `top` whose research/DISCOVERY.md the index tracks, top-relative, or
 * null when git could not list them: one `git ls-files` for the whole repository (#309).
 */
export function trackedContracts(top, { run = gitCapture } = {}) {
  // The pattern is magic on purpose. GIT_LITERAL_PATHSPECS=1 (or GIT_NOGLOB_PATHSPECS) in the
  // committer's environment made it match nothing - an empty list, not a failure - and judging
  // below the top level turned itself off (second review of #309, 2026-10-18).
  const env = { ...process.env };
  delete env.GIT_LITERAL_PATHSPECS;
  delete env.GIT_NOGLOB_PATHSPECS;
  const text = run(['ls-files', '-z', '--', `:(glob)**/${PATHS.discovery}`], { cwd: top, env });
  if (typeof text !== 'string') return null;
  return text.split('\0').filter((name) => name.endsWith(`/${PATHS.discovery}`))
    .map((name) => name.slice(0, -(PATHS.discovery.length + 1)));
}

/**
 * The contract of a project below `top`, as the commit would carry it: the index's bytes; HEAD's
 * for a contract this commit deletes; the working tree's outside a repository. null if none.
 */
export function contractText(top, rel, { run = gitCapture } = {}) {
  const name = `${rel}/${PATHS.discovery}`;
  if (isGitRepo(top)) {
    for (const spec of [`:${name}`, `HEAD:${name}`]) {
      const text = run(['show', spec], { cwd: top });
      if (typeof text === 'string') return text;
    }
    return null;
  }
  return readText(resolve(top, name));
}

/** Guarded paths are project configuration (ADR-0008). */
export function loadGateConfig(root) {
  const config = readJson(resolve(root, PATHS.kit), null);
  const declared = config?.architecture?.codePaths;
  return {
    codePaths: Array.isArray(declared) && declared.length ? declared : [...DEFAULT_CODE_PATHS],
    declared: Array.isArray(declared) && declared.length > 0,
  };
}

function withinAny(pathName, dirs) {
  const normalized = String(pathName).split('\\').join('/').replace(/^\.\//, '');
  return dirs.some((dir) => normalized === dir || normalized.startsWith(`${dir.replace(/\/$/, '')}/`));
}

/**
 * The architecture-map rule: a commit touching a declared code path stages
 * `docs/ARCHITECTURE.md` in the SAME commit. What it proves is deliberately modest -
 * the map was staged, not that it is current. A prompt, not a proof.
 */
export function architectureMapBreach(root, stagedPaths) {
  if (!Array.isArray(stagedPaths)) {
    return {
      rule: 'architecture-map-same-commit',
      touched: [],
      detail: 'could not list the staged paths, so the gate cannot check whether a code change stages docs/ARCHITECTURE.md with it',
      fix: 'check that git can list the staged paths (git diff --cached --name-only --no-renames), then commit again; '
        + 'git commit --no-verify overrides, and records nothing - say so in your reply',
    };
  }
  if (!stagedPaths.length) return null;
  const { codePaths } = loadGateConfig(root);
  const touched = stagedPaths.filter((p) => withinAny(p, codePaths));
  if (!touched.length) return null;
  if (stagedPaths.some((p) => String(p).split('\\').join('/') === PATHS.architecture)) return null;
  return {
    rule: 'architecture-map-same-commit',
    touched,
    detail: `${touched.length} staged path(s) are inside a declared code path, and ${PATHS.architecture} is not staged with them`,
    // It said "git add docs/ARCHITECTURE.md", which stages nothing while the map is unchanged:
    // followed exactly, the commit stayed blocked (found 2026-09-27).
    fix: `update ${PATHS.architecture} for what ${touched.length === 1 ? touched[0] : 'these paths'} changed, then git add ${PATHS.architecture}`,
  };
}

/**
 * The suite rule (ADR-0120): in the kit's OWN checkout, a commit touching `fetchproof/`
 * needs a green suite. "A red suite stops work" was prose, and in one afternoon an agent
 * committed twice while the suite was red - once reading the result through a pipe that
 * hid the exit code, once trusting a `set -e` that did not stop. Prose did not hold; the
 * gate does.
 *
 * Scope is deliberately narrow. The rule fires only where all four markers of the kit's
 * checkout exist - a scaffolded project has none of them, so no other project ever pays
 * for a suite it does not own - and only for a commit that stages something under
 * `fetchproof/`: a docs-only commit owes no suite. The runner is the commit's own
 * `bin/selftest.mjs`, run in a scratch repository built from the index (ADR-0183), and read
 * through its result file, not its stdout: an unsupported test (no Chromium, no Python -
 * ADR-0108) is not red, and a runner that died before reporting is a block, never a pass.
 */
export const SUITE_RULE = 'suite-green-before-commit';

/**
 * The suite's budget (ADR-0142) is a backstop for a hang, never a forecast of a run. The default
 * is twice the slowest honest run measured on a supported host - 1825 s, the operator's Windows
 * PC, 2026-10-05 - rounded up to five minutes. It was 20 minutes, and that PC's green suite met
 * it on every commit touching fetchproof/: a budget below an honest run blocks a green tree,
 * and the only way through it is the override the rule exists to make rare.
 */
export const SUITE_TIMEOUT_MS = 65 * 60_000;

/**
 * The rest of the gate's allowance: what the hook's own default watchdog gives a gate that runs
 * no suite (`githooks/pre-commit`, 120 s). In the kit's checkout the hook's watchdog is the
 * suite's budget plus this, so the gate stops an overrunning suite and reports it before the
 * watchdog fires - a watchdog kill is an internal error, decided by posture, and a fail-open
 * machine allows it (ADR-0142, ADR-0020).
 */
export const GATE_REST_S = 120;

// The one grammar both layers read FETCHPROOF_GATE_TIMEOUT in: seconds, with an optional fraction
// and an optional s, m, h or d, and at most nine digits before the point. timeout(1) takes more - a
// sign, an exponent, hex - and a value this side could not read kept its own budget while the
// watchdog took the operator's, so the watchdog fired first; the hook now checks the same grammar
// (gate_timeout_readable) and treats a value outside it as unset, as this side does. The nine
// digits keep every value far below the 2^63 s that Git for Windows' timeout(1) reads as already
// expired (exit 124 at once). A test holds the two readers to one table (ADR-0142).
const DURATION = /^(\d{1,9}(?:\.\d+)?|\.\d+)([smhd]?)$/;
const DURATION_UNIT_S = Object.freeze({ '': 1, s: 1, m: 60, h: 3_600, d: 86_400 });
// The longest timer Node keeps exactly (setTimeout's bound); spawnSync refuses Infinity outright.
const MAX_TIMER_MS = 2 ** 31 - 1;

/** The operator's gate timeout in seconds, or null for unset, empty, or outside the grammar. */
export function gateTimeoutSeconds(value) {
  const parsed = DURATION.exec(String(value ?? ''));
  return parsed ? Number(parsed[1]) * DURATION_UNIT_S[parsed[2]] : null;
}

/**
 * The suite's budget in ms. `FETCHPROOF_GATE_TIMEOUT` is the operator's bound on the whole gate,
 * and the hook gives it to the watchdog; it reached only the watchdog, so an operator who raised it
 * for a slow suite was still stopped at the node side's budget (ADR-0142). One setting now governs
 * both layers: the suite gets that watchdog less `GATE_REST_S`, and never more than half of a
 * watchdog too short for the allowance, so the gate reports first whenever its own work before
 * and after the suite fits what is left - a watchdog too short for even that is decided by
 * posture, as it is for every rule (ADR-0020). 0 disables timeout(1)'s watchdog and leaves the
 * default: with no watchdog to stay under, the budget is still the one backstop for a hang. Unset,
 * empty, or outside the grammar leaves the default, as it leaves the hook's.
 */
export function suiteBudgetMs(env = process.env) {
  const watchdogS = gateTimeoutSeconds(env.FETCHPROOF_GATE_TIMEOUT);
  if (watchdogS === null || watchdogS === 0) return SUITE_TIMEOUT_MS;
  // Never 0 for a positive watchdog - spawnSync reads 0 as no bound - and never past a timer's reach.
  return Math.min(MAX_TIMER_MS, Math.max(1, Math.round(Math.max(watchdogS - GATE_REST_S, watchdogS / 2) * 1000)));
}

const KIT_DIR = 'fetchproof';
const KIT_CHECKOUT_MARKERS = Object.freeze([`${KIT_DIR}/lib/core.mjs`, `${KIT_DIR}/bin/gate.mjs`, `${KIT_DIR}/bin/selftest.mjs`, `${KIT_DIR}/test`]);

/** True only in a checkout of the kit's repository: the runner, the gate, and the tests are all here. */
export function isKitCheckout(root) {
  return KIT_CHECKOUT_MARKERS.every((rel) => exists(resolve(root, rel)));
}

/** Whether a commit owes the suite: the kit's checkout, and a staged path under fetchproof/ (or the list unknown). */
export function suiteOwed(root, stagedPaths) {
  if (!isKitCheckout(root)) return false;
  // With the staged list unknown the gate judges the index as a whole, and runs the suite.
  return !Array.isArray(stagedPaths) || stagedPaths.some((p) => withinAny(p, [KIT_DIR]));
}

// git exports its repository location to a hook (GIT_DIR, GIT_INDEX_FILE - the index being
// committed, or a temporary one for a partial commit - GIT_PREFIX, and their kin). A suite that
// inherited them would run every scratch repository's `git add` against THIS commit's index.
// The same list the edit hook strips before asking git where it is (2026-09-28).
const REPOSITORY_LOCATION = Object.freeze(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX']);

/**
 * Run the checkout's own suite and return its result (`{ passed, failures, unsupported, exit,
 * ... }`), `{ timedOut: true, seconds }` when it did not finish, or null when the runner
 * produced none. The result file is the contract, as in CI: stdout is for people, and a count
 * scraped from it cannot tell a red suite from one that never printed.
 *
 * The runner's exit code is read with the gate's own definition of red: an unsupported test
 * (no Chromium, no Python - ADR-0108) is not red, so the run is given the local opt-in. The
 * budget is `suiteBudgetMs()`: the operator's gate timeout, when set, governs it (ADR-0142).
 */
export function runSuiteHere(root, { timeout = suiteBudgetMs() } = {}) {
  const resultFile = path.join(tempBase(), `fp-suite-${process.pid}-${Date.now()}.json`);
  const env = { ...process.env, FETCHPROOF_RESULT_FILE: resultFile, FETCHPROOF_ALLOW_UNSUP: '1' };
  for (const name of REPOSITORY_LOCATION) delete env[name];
  try {
    // SIGKILL, not spawnSync's SIGTERM: the runner's harness listens for SIGTERM to remove its
    // scratch, and a listener runs only when the event loop turns, so a runner blocked
    // synchronously outlived its budget on POSIX until the hook's watchdog killed the gate and the
    // posture decided (ADR-0142). Its scratch is left behind in the temp folder on a stop; Windows
    // terminates the process whatever the signal.
    const run = spawnSync(process.execPath, [resolve(root, `${KIT_DIR}/bin/selftest.mjs`)], {
      cwd: root, stdio: 'ignore', timeout, killSignal: 'SIGKILL', windowsHide: true, env,
    });
    if (run.error?.code === 'ETIMEDOUT') return { timedOut: true, seconds: Math.round(timeout / 100) / 10 };
    const result = readJson(resultFile);
    return result && typeof result === 'object' ? result : null;
  } catch {
    return null;
  } finally {
    try { fs.rmSync(resultFile, { force: true }); } catch { /* best effort */ }
  }
}

const SCRATCH_PREFIX = 'fetchproof-commit-';
const SCRATCH_NAME = /^fetchproof-commit-[A-Za-z0-9]{6}$/;
/** Older than this, a commit's scratch was left by a gate that was killed (Ctrl-C, the hook's watchdog). */
export const ABANDONED_SCRATCH_MS = 24 * 60 * 60 * 1000;

/**
 * Remove the commit scratches a killed gate left in `tmp`: its `finally` never ran, and each one is
 * a copy of the checkout. Only `runSuiteOnCommit`'s own folders - its name, a .git inside - and only
 * past a day, so a gate still running in another checkout keeps its scratch.
 */
export function sweepAbandonedScratches(tmp, { now = Date.now() } = {}) {
  let names;
  try {
    names = fs.readdirSync(tmp);
  } catch {
    return;
  }
  for (const name of names) {
    if (!SCRATCH_NAME.test(name)) continue;
    const dir = path.join(tmp, name);
    try {
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || now - stat.mtimeMs < ABANDONED_SCRATCH_MS || !exists(path.join(dir, '.git'))) continue;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch { /* best effort */ }
  }
}

const asBytes = (out) => (Buffer.isBuffer(out) ? out : Buffer.from(String(out)));
// git knows the empty tree in every repository without storing it.
const EMPTY_TREE = {
  sha1: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
  sha256: '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321',
};

/**
 * Run the suite on the commit (ADR-0183): in a scratch repository built from the index being
 * committed, not in the working tree. Every other commit check judges the index (ADR-0024), and
 * the suite had read the working tree - an unstaged red edit blocked a green commit, and a red
 * file staged and then fixed on disk only was allowed.
 *
 * The index is read in the hook's environment, so a partial commit's temporary GIT_INDEX_FILE is
 * the one read; `ls-files` and `diff-index` only read it (`write-tree` may write the cache-tree back
 * into the index being committed), and an intent-to-add entry, which the commit leaves out, is left out. The scratch is a repository of its own - `git init` in the commit's object
 * format, the real object store as an alternate, the entries put in with `update-index
 * --index-info`, checked out, HEAD set to the real HEAD - so the suite's repo-hygiene tests find a
 * repository whose top level is the checkout they judge, and its `git status` is the commit's.
 * Without .git there is no index, and the files here are what is judged, as before.
 *
 * Returns the runner's result as `runSuiteHere` does - with `indexChanged: true` when the index
 * was no longer the one tested by the time the suite finished - or `{ unbuilt: true, detail }`
 * when the scratch could not be built. `suiteBreach` blocks both.
 */
export function runSuiteOnCommit(root, { top = null, git = gitCapture, tmp = tempBase(), timeout = suiteBudgetMs(),
  runHere = (dir) => runSuiteHere(dir, { timeout }) } = {}) {
  const cwd = top ?? root;
  if (!isGitRepo(cwd)) return runHere(root);
  const errors = [];
  const unbuilt = (why) => {
    // git's own line, when it gave one: the step alone does not say a path was too long or a disk full.
    // Its verdict (`fatal:`, else `error:`) before its first line: a filter's progress line came first
    // ("Downloading assets.bin (2.0 KB)", git-lfs) and was quoted as git's words (review of PR #430).
    const lines = String(errors.at(-1) ?? '').split(/\r?\n/).filter((line) => line.trim());
    const said = lines.find((line) => line.startsWith('fatal:')) ?? lines.find((line) => line.startsWith('error:')) ?? lines[0] ?? '';
    const words = said.slice(0, 200).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return { unbuilt: true, detail: `could not build the commit's tree to run the suite on: ${why}${words ? ` (${words})` : ''}` };
  };
  // Bytes, not text: a path is put back exactly as git listed it.
  const listIndex = () => git(['ls-files', '--stage', '-z'], { cwd, encoding: 'buffer', errors });
  const listed = listIndex();
  if (listed === null) return unbuilt('git ls-files failed');
  const entries = asBytes(listed);
  // `git commit` refuses an unmerged index before its hook runs; a gate run by hand on one would
  // test a tree without the conflicted paths, which checkout-index skips without an error.
  if (/(?:^|\0)\d+ [0-9a-f]+ [1-3]\t/.test(entries.toString('latin1'))) return unbuilt('the index has unmerged paths');
  const objects = git(['rev-parse', '--git-path', 'objects'], { cwd, errors });
  if (objects === null || !String(objects).trim()) return unbuilt('git rev-parse failed');
  // The commit's object format, not the machine's default (init.defaultObjectFormat,
  // GIT_DEFAULT_HASH): a sha256 scratch refuses a sha1 index. A git too old to say has only sha1.
  const format = String(git(['rev-parse', '--show-object-format'], { cwd }) ?? '').trim();
  // The paths the commit holds, by git's own reckoning: ls-files lists an intent-to-add entry
  // (`git add -N`) as the empty blob, and the commit leaves it out. The index against the empty
  // tree, with those entries invisible, is that list - and, unlike write-tree, only a read.
  const held = git(['diff-index', '--cached', '--ita-invisible-in-index', '--ignore-submodules=none', '--no-renames', '--name-only', '-z',
    format === 'sha256' ? EMPTY_TREE.sha256 : EMPTY_TREE.sha1], { cwd, encoding: 'buffer', errors });
  if (held === null) return unbuilt('git diff-index failed');
  const inCommit = new Set(asBytes(held).toString('latin1').split('\0').filter(Boolean));
  const commit = Buffer.from(entries.toString('latin1').split('\0')
    .filter((entry) => entry && inCommit.has(entry.slice(entry.indexOf('\t') + 1)))
    .map((entry) => `${entry}\0`).join(''), 'latin1');
  // A sparse checkout's skip-worktree entries (`ls-files -t` tags them S) stay skipped in the scratch:
  // `--index-info` drops the bit, and `checkout-index --all` then asked for every blob outside the
  // cone, which a partial clone never fetched - every kit commit there blocked (review of PR #430).
  // Only those absent from the working tree: the user sets the bit too (`update-index --skip-worktree`
  // keeps local edits out of `git status`), and skipping such a file left one the commit holds out of
  // the suite's tree - a test that read it blocked the commit (check (c), F3). git lists the name as
  // UTF-8 bytes, carried here as latin1, so it is decoded before the disk is asked; a path the disk
  // will not answer for (not ENOENT or ENOTDIR) is checked out, as every entry was before.
  const absent = (name) => {
    try {
      return fs.lstatSync(path.join(cwd, Buffer.from(name, 'latin1').toString('utf8')), { throwIfNoEntry: false }) === undefined;
    } catch {
      return false;
    }
  };
  const tagged = git(['ls-files', '-t', '-z'], { cwd, encoding: 'buffer', errors });
  if (tagged === null) return unbuilt('git ls-files failed');
  const skipped = Buffer.from(asBytes(tagged).toString('latin1').split('\0')
    .filter((entry) => entry.startsWith('S ') && inCommit.has(entry.slice(2)) && absent(entry.slice(2)))
    .map((entry) => `${entry.slice(2)}\0`).join(''), 'latin1');
  // Empty as well when HEAD is unborn - a first commit - and the scratch's HEAD stays unborn too.
  const head = String(git(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { cwd }) ?? '').trim();
  sweepAbandonedScratches(tmp);
  let scratch;
  try {
    scratch = fs.mkdtempSync(path.join(tmp, SCRATCH_PREFIX));
  } catch {
    return unbuilt(`no folder could be created in ${tmp}`);
  }
  // The long spelling: Windows hands a temp folder over as an 8.3 short name (RUNNER~1 on CI) and
  // git reports the long one, so repo-hygiene's tests would not know the scratch for the repository
  // it is, and would return early - green, and silent.
  try { scratch = fs.realpathSync.native(scratch); } catch { /* the name as made */ }
  // The scratch is its own repository: the hook's GIT_DIR and GIT_INDEX_FILE must not reach it.
  const env = { ...process.env };
  for (const name of REPOSITORY_LOCATION) delete env[name];
  // checkout-index runs the smudge filters the machine's config defines. git-lfs, for an object the
  // clone does not hold, went to the network from the commit hook and then blocked; its own switch
  // leaves the pointer, as a clone made with it does (review of PR #430). The suite's env is its own.
  env.GIT_LFS_SKIP_SMUDGE = '1';
  const inScratch = (args, options = {}) => git(args, { cwd: scratch, env, errors, ...options });
  // The step that failed, or null once the scratch holds the commit.
  const build = () => {
    const init = ['-c', 'init.templateDir=', 'init', '-q', ...(/^sha(1|256)$/.test(format) ? [`--object-format=${format}`] : [])];
    if (inScratch(init) === null) return 'git init failed';
    // Relative to where git ran (`.git/objects` in the hook), and absolute in the alternates file.
    const store = path.resolve(cwd, String(objects).trim()).split(path.sep).join('/');
    fs.mkdirSync(path.join(scratch, '.git', 'objects', 'info'), { recursive: true });
    fs.writeFileSync(path.join(scratch, '.git', 'objects', 'info', 'alternates'), `${store}\n`);
    if (inScratch(['update-index', '-z', '--index-info'], { input: commit }) === null) return 'git update-index failed';
    if (skipped.length && inScratch(['update-index', '--skip-worktree', '-z', '--stdin'], { input: skipped }) === null) return 'git update-index failed';
    // Windows refuses a path past 260 characters unless core.longpaths is set, and a temp root
    // plus a deep tracked path can pass it (found 2026-10-19 under a 110-character root). A path
    // still too long fails the checkout, and so blocks.
    if (inScratch(['-c', 'core.longpaths=true', 'checkout-index', '--all', '--force', '-u']) === null) return 'git checkout-index failed';
    if (head && inScratch(['update-ref', 'HEAD', head]) === null) return 'git update-ref failed';
    return null;
  };
  try {
    let failed;
    try {
      failed = build();
    } catch {
      failed = 'the scratch repository could not be written';
    }
    if (failed) return unbuilt(failed);
    const inRepo = projectPrefix(top, root);
    const result = runHere(inRepo ? path.join(scratch, ...inRepo.split('/').filter(Boolean)) : scratch);
    // A plain `git commit` holds no lock on the index while its hook runs, and commits what the
    // index holds when the hook returns: a `git add` from another terminal during the run would
    // reach the commit untested. Stat data is not listed, so a refresh is not a change.
    const after = listIndex();
    if (result && typeof result === 'object' && (after === null || !asBytes(after).equals(entries))) return { ...result, indexChanged: true };
    return result;
  } finally {
    // A suite stopped at its budget may leave a child holding a file here; the rest still goes,
    // and the next run's sweep takes what is left after a day.
    try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
  }
}

// The scratch result is removed after reading it. Preserve enough of its failing
// identifiers in the verdict to diagnose a red without an unbounded/control-filled log.
function suiteFailureIdentifiers(failed) {
  const labels = Array.isArray(failed) ? failed : [];
  const shown = labels.slice(0, 5).flatMap((label) => {
    if (typeof label !== 'string') return [];
    const prefix = label.slice(0, 160).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return prefix ? [`${JSON.stringify(prefix)}${label.length > 160 ? ' (truncated)' : ''}`] : [];
  });
  if (!shown.length) return '; failing test identifiers unavailable';
  return `; failing tests: ${shown.join('; ')}${labels.length > 5 ? `; ${labels.length - 5} more identifiers omitted` : ''}`;
}

export function suiteBreach(root, stagedPaths, { top = null, run = () => runSuiteOnCommit(root, { top }), announce = null } = {}) {
  if (!suiteOwed(root, stagedPaths)) return null;
  const fix = `make the suite green (node ${KIT_DIR}/bin/selftest.mjs), then commit again; git commit --no-verify overrides, and records nothing - say so in your reply`;
  // Called right before the run, so what a caller says about the suite running is true.
  if (announce) announce();
  const result = run();
  if (!result) {
    return { rule: SUITE_RULE, detail: 'the suite was run and the runner produced no result - it crashed before reporting', fix };
  }
  if (result.unbuilt) {
    // As an index the gate cannot read blocks (ADR-0024): a suite not run on the commit is not green.
    return {
      rule: SUITE_RULE,
      detail: `${result.detail} - a suite that did not run on the commit is not green (ADR-0183)`,
      fix: `read git's words in the detail: check that git can read the index (git ls-files --stage), that no path is unmerged (git ls-files --unmerged), and that the temp folder (${tempBase()}) is writable with room for a copy of the checkout, then commit again; git commit --no-verify overrides, and records nothing - say so in your reply`,
    };
  }
  if (result.timedOut) {
    // A slow host and a hung test read the same here; the remedy for the first is the operator's
    // setting, not the override (ADR-0142).
    return {
      rule: SUITE_RULE,
      detail: `the suite did not finish within ${result.seconds} s and was stopped - a suite that cannot report is not green`,
      fix: `if the suite is only slow on this host, time a run (node ${KIT_DIR}/bin/selftest.mjs prints its seconds, and names a test that hangs) and set FETCHPROOF_GATE_TIMEOUT to twice that plus ${GATE_REST_S} for the commit (FETCHPROOF_GATE_TIMEOUT=<seconds> git commit ...) - the hook's watchdog; the suite gets it less ${GATE_REST_S} s, or half of one under ${2 * GATE_REST_S} s (ADR-0142); git commit --no-verify overrides, and records nothing - say so in your reply`,
    };
  }
  const failures = Number(result.failures) || 0;
  const unsupported = Number(result.unsupported) || 0;
  if (failures > 0) {
    return {
      rule: SUITE_RULE,
      detail: `the suite is red: ${failures} failed, ${Number(result.passed) || 0} passed${unsupported ? `, ${unsupported} unsupported` : ''}${suiteFailureIdentifiers(result.failed)} - a red suite stops work (ADR-0120)`,
      fix,
    };
  }
  // No failure, and still not a pass: the runner's own last check (the README's test count
  // against the run) exits 1 with the suite green. Its output names what to fix.
  const exit = result.exit === undefined ? 0 : Number(result.exit);
  if (exit !== 0) {
    return { rule: SUITE_RULE, detail: `every test passed and the runner still exited ${exit} - run it and read its last lines (a stale test count in ${KIT_DIR}/README.md exits 1 on a green run)`, fix };
  }
  // Green, on an index that is no longer the commit's: what was staged during the run was not tested.
  if (result.indexChanged) {
    return {
      rule: SUITE_RULE,
      detail: 'the suite is green, and the index changed while the suite ran - what was staged since was not tested (ADR-0183)',
      fix: 'stage nothing while the commit\'s suite runs, then commit again; git commit --no-verify overrides, and records nothing - say so in your reply',
    };
  }
  return null;
}

// ---------------------------------------------------------------- staged paths as data

/** null means "stdin could not be read"; [] means "read, and empty". Never conflate them. */
export function splitPathList(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text);
  const parts = raw.includes('\0') ? raw.split('\0') : raw.split(/\r?\n/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function stdinIsReadable(stdin = process.stdin) {
  try {
    // isatty(0) rather than inferring from the file type: a socketpair is not a FIFO,
    // and /dev/null is a character device that reads as immediate EOF.
    return !stdin.isTTY;
  } catch {
    return false;
  }
}

/**
 * One actual, successful Git read, never a probe followed by an unchecked pipeline.
 * gitCapture returns null for nonzero exit and maxBuffer failure, so partial stdout
 * cannot become a list. Git -z ends every path with NUL; no paths is exactly ''.
 * Preserve names verbatim rather than the explicit stdin adapter's legacy trimming.
 */
export function readStagedPaths(root, { run = gitCapture } = {}) {
  let text;
  try {
    text = run(['diff', '--cached', '--name-only', '--no-renames', '-z'], { cwd: root });
  } catch { return null; }
  if (typeof text !== 'string') return null;
  if (text === '') return [];
  if (!text.endsWith('\0')) return null;
  const paths = text.slice(0, -1).split('\0');
  return paths.every((name) => name.length > 0) ? paths : null;
}

// ---------------------------------------------------------------- the index snapshot

/**
 * THE COMMIT GATE JUDGES THE INDEX, NOT THE WORKING TREE (ADR-0024).
 *
 * git hands the hook a list of staged path NAMES and nothing else. Reading the corpus off
 * disk therefore judged different bytes from the ones about to be committed: stage an
 * `OPEN` contract, restore `CLOSED` in the working tree only, and the gate allowed a
 * commit whose `git show :research/DISCOVERY.md` still said OPEN.
 *
 * `git checkout-index` materialises the index's own content into a scratch directory, and
 * the same verdict then runs over that. The working tree is never touched, and the edit
 * gate keeps reading it - an interactive research check is about what you have in front
 * of you, which is exactly the opposite question.
 *
 * A project below the top level (#309) passes `top`: git runs there - where the hook runs it,
 * with the index git handed the hook - and the project's corpus is listed and written by its
 * path from there. The returned `root` is where the project's own research/ landed.
 */
export function materializeIndex(root, { run = gitCapture, tmp = tempBase(), top = null } = {}) {
  const cwd = top ?? root;
  if (!isGitRepo(cwd)) {
    return { ok: false, reason: 'not-a-repository', detail: 'no .git here, so there is no index to read' };
  }

  const dir = fs.mkdtempSync(path.join(tmp, 'fetchproof-index-'));
  const inRepo = projectPrefix(top, root);
  // Only the corpus is materialised. The gate judges research/, and copying a whole
  // checkout to answer a question about one directory is a cost paid on every commit.
  const listed = run(['ls-files', '-z', '--', `${inRepo}research`], { cwd });
  if (listed === null) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: 'git-failed', detail: 'could not list the index' };
  }

  const paths = String(listed).split('\0').map((p) => p.trim()).filter(Boolean);
  if (!paths.length) {
    return { ok: true, dir, root: dir, files: 0, empty: true };
  }

  // Chunked, because the whole path list used to go into one argv.
  //
  // The commit HOOK already moved its staged list to stdin when argv construction proved
  // quadratic (ADR-0020), but this call kept spreading every tracked research path as an
  // argument. A large corpus therefore hit the platform's command-line limit here —
  // Windows caps a command line at ~32k characters — and `git checkout-index` failed for
  // a reason that has nothing to do with the index being unreadable. Paired with the
  // fallback above, that turned a big corpus into a blocked commit.
  //
  // `--stdin` would be tidier, but it is not available in every git that ships on a
  // supported platform, and a gate is the wrong place to discover that. Chunking works
  // everywhere and the arithmetic is visible.
  const prefix = `${dir.split(path.sep).join('/')}/`;
  const CHUNK = 250;
  let written = '';
  for (let at = 0; at < paths.length; at += CHUNK) {
    const batch = paths.slice(at, at + CHUNK);
    const result = run(['checkout-index', '--prefix', prefix, '-f', '--', ...batch], { cwd });
    if (result === null) { written = null; break; }
    written += result;
  }
  if (written === null) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: 'git-failed', detail: 'could not materialise the index' };
  }
  return { ok: true, dir, root: inRepo ? path.join(dir, ...inRepo.split('/').filter(Boolean)) : dir, files: paths.length, empty: false };
}

// `errors`, when given, collects what git wrote to stderr on a failure, for a caller that names it.
function gitCapture(args, { cwd, env = process.env, input = undefined, encoding = 'utf8', errors = null }) {
  try {
    return execFileSync('git', args, { cwd, env, input, encoding, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', errors ? 'pipe' : 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    if (errors) errors.push(String(error?.stderr ?? ''));
    return null;
  }
}

// ---------------------------------------------------------------- the verdict

/**
 * `evaluate(root, { gate, stagedPaths })` -> one verdict object.
 *
 * Verdict shapes: `not-gated`, `override` (GATE_OFF), `pass`, `block`.
 * While the verdict fails, the commit gate blocks staged changes OUTSIDE `research/`
 * and allows changes confined to it: committing collected evidence is the workflow, and
 * blocking it would make the gate a nuisance and guarantee its removal.
 */
export function evaluate(root, { gate = 'commit', stagedPaths = undefined, corpus = null, env = process.env, record = true,
  // Only the CLI's default commit invocation supplies this private lazy acquisition.
  // Explicit lists/null retain their meaning; overrides and edit never invoke it.
  listStaged = null,
  // Injectable so the index-read FAILURE can be tested. A gate whose behaviour on a
  // broken git is untestable is a gate whose most dangerous path is unexercised.
  materialize = materializeIndex,
  // The repository's top level, when the project is below it (#309): where git runs, and
  // what the index's paths are relative to. null: the project is the top level, as before.
  top = null,
  // Injectable for the same reason: the staged text of one path (the architecture map).
  stagedText = (rel) => readStagedText(root, rel, { top }),
  // The staged deletions under the project's research/raw/, relative to the project, or null
  // when git could not list them (#312). Injectable for the same reason as `materialize`.
  listDeleted = () => stagedRawDeletions(root, { top }),
  // HEAD's ledger text, or null when HEAD has none (#312): what the commit may not take away.
  headLedger = () => readHeadLedger(root, { top }),
  // The suite rule's runner (ADR-0120); null means the checkout's own selftest.mjs. The
  // announcement runs right before it, so a caller can break the minutes of silence.
  runSuite = null, announceSuite = null } = {}) {
  const base = { gate, root, fix: fixCommand() };

  // What the commit takes from the evidence HEAD holds, asked where research/ has left the disk
  // or the index (ADR-0184). Not of an injected corpus, and not by the edit gate.
  const headTaken = () => (gate === 'commit' && !corpus
    ? headEvidenceRemoval(root, { top, stagedPaths, stagedText, listDeleted, headLedger }) : null);
  const removedWhole = (taken) => ({ ...base, verdict: 'not-gated', allow: true, reason: taken.movedTo ? movedReason(taken.movedTo) : REMOVED_WHOLE, findings: [] });
  const takenBlock = (taken) => ({ ...base, verdict: 'block', allow: false, judged: 'index', reason: taken.reason, fix: taken.fix, findings: [] });

  // No marker left on disk is not "nothing to judge" when the commit takes HEAD's evidence:
  // `rm -rf research && git add -A` turned the gate off without a record (ADR-0184).
  const gated = isGated(root);
  const taken = gated ? null : headTaken();
  if (!gated && !taken) return { ...base, verdict: 'not-gated', allow: true, reason: 'no gate marker in this project', findings: [] };
  if (taken?.whole) return removedWhole(taken);

  if (exists(resolve(root, PATHS.gateOff))) {
    if (record) { try { recordOverride(root, 'GATE_OFF', `${gate} gate`); } catch { /* read-only checkout */ } }
    return {
      ...base, verdict: 'override', allow: true,
      reason: `${PATHS.gateOff} is present - the gate is off for this repository, and it is recorded`,
      findings: [],
    };
  }

  if (taken) return takenBlock(taken);

  if (gate === 'commit' && stagedPaths === undefined && listStaged !== null) {
    let listed;
    try { listed = listStaged(); } catch { listed = null; }
    // A bad acquisition answer is unknown scope, not an internal exception that a
    // fail-open hook may waive. Empty [] is valid; an empty or non-string name is not.
    stagedPaths = Array.isArray(listed) && listed.every((name) => typeof name === 'string' && name.length > 0)
      ? listed : null;
  }

  // The commit gate judges the INDEX; every other caller judges the working tree.
  // A caller that injected its own corpus has already decided what it wants judged.
  let snapshot = corpus;
  let judged = 'working-tree';
  let indexNote = null;
  let scratch = null;

  if (gate === 'commit' && !corpus) {
    const materialised = materialize(root, { top });
    if (materialised.ok && materialised.empty) {
      // materializeIndex made its scratch dir before it knew the index held no corpus,
      // and this return happens before `scratch` is assigned - the finally below cleans
      // only what got assigned. Every verdict on a gated project whose research/ is not
      // yet tracked, which is every fresh project's first commit, leaked one temp
      // directory (found 2026-09-28, break-test).
      try { fs.rmSync(materialised.dir, { recursive: true, force: true }); } catch { /* best effort, matching the finally */ }
      // Unless HEAD holds the evidence: then the commit removes it. `git rm -r research` leaves
      // the gate's own research/raw/.diagnostics.jsonl on disk, so the project is still gated
      // here, and "git add research/" was a fix that exits 128 (ADR-0184).
      const removal = headTaken();
      // A move with the old research/ left on disk blocks until it goes (check (e) of the
      // 2026-10-19 review, E1).
      if (removal?.movedTo) return takenBlock(movedLeftover(root, removal.movedTo));
      if (removal?.whole) return removedWhole(removal);
      if (removal) return takenBlock(removal);
      // The working tree is gated and the index holds no corpus at all: research/ is
      // untracked. Reporting that as "your contract is missing" sends the operator to
      // look for a file that is sitting right there. The real defect is that the
      // evidence is not in the repository, so it cannot travel (ADR-0011).
      return {
        ...base,
        verdict: 'block',
        allow: false,
        judged: 'index',
        reason: 'this project is gated, but no part of research/ is tracked - the evidence is not in the repository and cannot travel',
        fix: CORPUS_ADD.join(' && '),
        findings: [],
      };
    }
    if (materialised.ok) {
      scratch = materialised.dir;
      snapshot = readCorpus(materialised.root ?? materialised.dir);
      judged = 'index';
    } else if (materialised.reason === 'not-a-repository') {
      // No index exists to read, which is not a failure to read one. A gated project
      // that is not a git repository has no staged bytes, so the working tree is the
      // only thing there is and judging it is honest.
      indexNote = `${materialised.reason}: no .git here, so there is no index to read - judging the working tree`;
    } else {
      // The index exists and could not be read. DO NOT judge the working tree instead.
      //
      // The commit gate's whole contract is that it judges the bytes being committed
      // (ADR-0024). Falling back to the working tree silently changes which bytes those
      // are, and the two differ exactly when it matters: stage a corpus with an unproven
      // unknown, fix it only in the working tree, and a gate reading the tree passes a
      // commit whose staged contents it never saw. That is the defect ADR-0024 exists to
      // prevent, reintroduced by an environmental failure rather than by a code path.
      //
      // So this blocks, and says which failure it was. Blocking is the safe direction for
      // a gate: a commit refused because the gate could not do its job is recoverable in
      // one command, and an unnoticed commit of unproven evidence is not. The escape
      // hatches remain what they always were - `--no-verify`, which git takes without running
      // this hook and so records nothing, or `research/GATE_OFF`, which is recorded.
      return {
        ...base,
        verdict: 'block',
        allow: false,
        judged: 'nothing',
        indexNote: `could not read the index: ${materialised.detail ?? materialised.reason}`,
        reason: `the commit gate judges the staged bytes and could not read them (${materialised.reason})`,
        fix: 'check that git works here (git status), then commit again; '
          + 'git commit --no-verify overrides, and records nothing - say so in your reply',
        findings: [],
      };
    }
  }

  try {
    return commitVerdict();
  } finally {
    if (scratch) { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  function commitVerdict() {
  // The corpus may come from the scratch index, but the GATE STATE is the machine's and
  // the repository's - GATE_OFF and a repository-local hooksPath are facts about here.
  const context = verdictContext(root, { corpus: snapshot, env });
  context.gate = readGateState(root, env);
  const preflight = runPreflight(root, { context, env });
  base.judged = judged;
  if (indexNote) base.indexNote = indexNote;

  // A removal is an alteration of the evidence set (#312), and it is checked before the pass
  // branch: a capture deleted with the ledger line that names it leaves a chain that verifies.
  // A capture the ledger names and the commit removes from HEAD - `git rm`, the deleting half
  // of a rename, `git rm -r research/raw` with its ledger - left a raw-missing no collecting
  // can finish, since the ledger is append-only; it committed as phase-1 work while an edit to
  // the same file was refused, and the builder's handoff then said "something did not travel".
  // ADR-0093's two committable raw-missing cases stay so: a capture never in HEAD is
  // mid-collection, and an unstaged one is part-staged.
  const removal = gate === 'commit' && judged === 'index' ? evidenceRemoval(snapshot, stagedPaths, { listDeleted, headLedger }) : null;
  if (removal) return { ...base, verdict: 'block', allow: false, preflight, ...removal, findings: preflight.failures };

  if (preflight.pass) {
    const breach = gate === 'commit' ? architectureMapBreach(root, stagedPaths) : null;
    if (breach) {
      return {
        ...base, verdict: 'block', allow: false, preflight, breach,
        reason: breach.detail, fix: breach.fix, findings: preflight.failures,
      };
    }
    // The suite rule runs LAST, because it is the expensive one: a map breach is answered
    // in a millisecond, and the suite is only paid for by a commit that can otherwise pass.
    const suite = gate === 'commit' ? suiteBreach(root, stagedPaths, { top, ...(runSuite ? { run: runSuite } : {}), announce: announceSuite }) : null;
    if (suite) {
      return {
        ...base, verdict: 'block', allow: false, preflight, breach: suite,
        reason: suite.detail, fix: suite.fix, findings: preflight.failures,
      };
    }
    return { ...base, verdict: 'pass', allow: true, preflight, reason: 'the gate passes', findings: [] };
  }

  // What phase 1 may commit: the corpus, and the project's own scaffolding (ADR-0048).
  const phaseOne = (p) => {
    const rel = String(p).split('\\').join('/');
    if (rel.startsWith('research/') || SCAFFOLDING.includes(rel)) return true;
    return rel === PATHS.architecture && isEmptyArchitectureMap(stagedText(rel));
  };
  const outsideResearch = Array.isArray(stagedPaths) ? stagedPaths.filter((p) => !phaseOne(p)) : null;

  // Integrity is not completeness (ADR-0093). ADR-0048 lets unfinished evidence be committed -
  // an open unknown, a gap, a missing brief are the normal state of phase 1. Evidence whose
  // bytes or chain no longer match what was fetched is not unfinished, it is altered, and it
  // never enters history: whether it did used to depend on what else was staged.
  const altered = preflight.failures.filter((f) => f.check === 'provenance' && INTEGRITY_RULES.includes(f.rule));

  if (gate === 'commit' && altered.length) {
    return {
      ...base,
      verdict: 'block',
      allow: false,
      preflight,
      reason: `the evidence was altered after it was fetched (${altered.slice(0, 3).map((f) => `${f.check}/${f.rule}`).join(', ')}) - an integrity failure is never committable, whatever else is staged`,
      fix: 'restore the capture or the ledger from git (git restore --staged --worktree <file>), or re-collect the page; '
        + 'a capture you typed is not evidence - cite a fetched one',
      findings: preflight.failures,
      staged: outsideResearch,
    };
  }

  if (gate === 'commit' && Array.isArray(outsideResearch) && outsideResearch.length === 0) {
    return {
      ...base, verdict: 'pass', allow: true, preflight,
      reason: 'the verdict fails, and this commit is confined to research/ and the project\'s own scaffolding - committing evidence is the workflow',
      findings: preflight.failures,
    };
  }

  return {
    ...base,
    verdict: 'block',
    allow: false,
    preflight,
    reason: `${preflight.failures.length} blocking finding(s): ${preflight.failures.slice(0, 3).map((f) => `${f.check}/${f.rule}`).join(', ')}`,
    findings: preflight.failures,
    staged: outsideResearch,
  };
  }
}

/**
 * Provenance findings that mean the evidence is not what was fetched (ADR-0093): a capture
 * edited after its fetch, a broken or unparseable chain, a cited capture no fetch produced.
 * Each has a remedy - restore from git, or re-collect. Deliberately NOT here: a missing
 * ledger or capture (a corpus mid-collection or part-staged), and the prior's order rules
 * (a claim recorded in an immutable chain; holding it would lock the project out for good).
 */
export const INTEGRITY_RULES = Object.freeze(['body-unmodified', 'chain-intact', 'ledger-unparsed', 'fetch-entry-exists']);

/**
 * The staged deletions under a project's research/raw/ - in HEAD, gone from the index -
 * relative to the project, or null when git could not list them (#312). `top` as for
 * `materializeIndex`.
 */
export function stagedRawDeletions(root, { top = null, run = gitCapture } = {}) {
  const inRepo = projectPrefix(top, root);
  const text = run(['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=D', '-z', '--', `${inRepo}${PATHS.raw}`], { cwd: top ?? root });
  if (typeof text !== 'string') return null;
  return text.split('\0').filter(Boolean).map((name) => ({ gitPath: name, rel: name.slice(inRepo.length) }));
}

/** HEAD's ledger text for a project, or null when HEAD has none (or there is no HEAD yet). */
export function readHeadLedger(root, { top = null, run = gitCapture } = {}) {
  const text = run(['show', `HEAD:${projectPrefix(top, root)}${PATHS.ledger}`], { cwd: top ?? root });
  return typeof text === 'string' ? text : null;
}

/** A path as a shell reads one word: as it is when plain, else double-quoted. */
export function shellWord(word) {
  return /^[\w./@+=:,-]+$/.test(word) ? word : `"${String(word).replace(/(["\\$`])/g, '\\$1')}"`;
}

/** A ledger entry as a commit keeps it (#312): by seq and the files it names, so the sanctioned
 *  `rebuildLedger` migration, which keeps both, keeps the entry. */
function ledgerKey(entry) {
  const posix = (p) => String(p).split('\\').join('/').replace(/^\.\//, '');
  return `${entry.seq}\0${posix(entry.raw ?? '')}\0${posix(entry.source ?? '')}`;
}

function ledgerEntries(text) {
  const entries = [];
  for (const line of String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) entries.push(entry);
    } catch { /* an unparsed line is not an entry; ledger-unparsed judges it */ }
  }
  return entries;
}

/**
 * What a commit takes away from the evidence HEAD holds (#312), as a block's reason and fix, or
 * null when it takes nothing. Three ways: the ledger itself deleted; an entry HEAD records gone
 * from the staged ledger (by seq and file, so the sanctioned `rebuildLedger` migration, which
 * keeps both, passes); a staged deletion of a capture or its ADR-0140 source that HEAD's or the
 * staged ledger names. git is asked only when the staged list names a path under research/raw/,
 * or is unknown; deletions git cannot list block, since none can be assumed.
 */
function evidenceRemoval(snapshot, stagedPaths, { listDeleted, headLedger }) {
  const posix = (p) => String(p).split('\\').join('/').replace(/^\.\//, '');
  if (Array.isArray(stagedPaths) && !stagedPaths.some((p) => posix(p).startsWith(`${PATHS.raw}/`))) return null;
  let headText;
  try { headText = headLedger(); } catch { headText = null; }
  const head = ledgerEntries(headText);
  const staged = snapshot?.ledger?.present ? snapshot.ledger.entries : [];
  const restore = (files) => `restore ${files.length === 1 ? 'it' : 'them'} (git checkout HEAD -- ${files.slice(0, 5).map(shellWord).join(' ')}); `
    + 'collecting a page again adds a capture and a ledger line beside the old ones, and never replaces one';
  const integrity = 'a capture is never removed, and an integrity failure is never committable, whatever else is staged';

  if (head.length && !snapshot?.ledger?.present) {
    return { reason: `${PATHS.ledger} is in HEAD and is being deleted - the ledger is the proof every capture was fetched; ${integrity}`,
      fix: restore([PATHS.ledger]) };
  }
  const kept = new Set(staged.map(ledgerKey));
  const dropped = head.filter((entry) => !kept.has(ledgerKey(entry)));
  if (dropped.length) {
    return { reason: `${PATHS.ledger} loses ${dropped.length === 1 ? 'the entry' : 'entries'} HEAD records (seq ${dropped.slice(0, 5).map((e) => e.seq).join(', ')}${dropped.length > 5 ? ', ...' : ''}) - the ledger is append-only; ${integrity}`,
      fix: restore([PATHS.ledger, ...dropped.flatMap((e) => [e.raw, e.source]).filter((f) => typeof f === 'string' && f).map(posix)]) };
  }
  const named = new Map();
  for (const entry of [...head, ...staged]) {
    if (entry.op === 'fail') continue;
    for (const file of [entry.raw, entry.source]) {
      if (typeof file === 'string' && file && !named.has(posix(file))) named.set(posix(file), entry.seq);
    }
  }
  if (!named.size) return null;
  let deletions;
  try { deletions = listDeleted(); } catch { deletions = null; }
  if (!Array.isArray(deletions)) {
    return { reason: 'the commit stages changes under research/raw/, and git could not list which of them are deletions - a ledgered capture is never removed, so the gate cannot assume none is',
      fix: 'check that git works here (git diff --cached --name-only --diff-filter=D), then commit again; '
        + 'git commit --no-verify overrides, and records nothing - say so in your reply' };
  }
  const deleted = deletions.filter((d) => named.has(d.rel)).map((d) => ({ file: d.rel, seq: named.get(d.rel) }));
  if (!deleted.length) return null;
  const one = deleted.length === 1;
  return {
    reason: `${deleted.slice(0, 3).map((d) => `${d.file} (seq ${d.seq})`).join(', ')}${deleted.length > 3 ? ` and ${deleted.length - 3} more` : ''} ${one ? 'is' : 'are'} recorded in the ledger and being deleted - ${integrity}`,
    fix: restore(deleted.map((d) => d.file)),
  };
}

const REMOVED_WHOLE = 'no path in this project stays tracked after the commit - a project deleted or moved whole is not judged where it was (ADR-0184)';
const RESEARCH = path.posix.dirname(PATHS.raw);
const movedText = (prefix) => `the evidence HEAD holds here moves to ${prefix}/${PATHS.raw}/ - the ledger with every entry HEAD records, and each capture HEAD holds, unchanged`;
const movedReason = (prefix) => `${movedText(prefix)} - so it is not judged where it was (ADR-0184)`;

/**
 * The block for a move whose old research/ is still on disk at a gated top level, holding only
 * files git does not track - the gate's own ignored log after a copy and `git rm -r research`
 * (check (e) of the 2026-10-19 review, E1). The top stays gated, and a gated top is the only
 * project the hook judges (ADR-0182), so allowing it would let the moved project in unjudged.
 * The files are named (a count and the first three) so the operator can check them before
 * deleting anything; the printed `git clean` deletes only what git does not track. With research/
 * gone the top level is ungated, and the moved project is judged where it went. One literal
 * `git ls-files -o`.
 */
function movedLeftover(root, prefix, { run = gitCapture } = {}) {
  const text = run(['ls-files', '-o', '-z', '--', RESEARCH], { cwd: root, env: literalPathspecs() });
  const files = typeof text === 'string' ? text.split('\0').filter(Boolean) : [];
  const named = files.length ? ` (${files.length}: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ', ...' : ''})` : '';
  return {
    reason: `${movedText(prefix)} - but ${RESEARCH}/ is still here, holding only files git does not track${named}, so this top level stays gated and ${prefix} would not be judged where it went (ADR-0184)`,
    fix: `check those files and move out any you keep, then delete ${RESEARCH}/ here (git clean -f -d -x -- ${RESEARCH} deletes only what git does not track; -n in place of -f lists it), and commit again - with ${RESEARCH}/ gone this top level is not gated, and ${prefix} is judged where it went`,
  };
}

/**
 * What a commit takes from the evidence HEAD holds for a project whose research/ has left the
 * disk or the index (ADR-0184): `evidenceRemoval` over the staged ledger, asked where `evaluate`
 * had answered without it - no gate marker left on disk ("not-gated"), or no part of research/
 * left in the index ("not tracked", whose `git add` fix exits 128 for a deleted ledger). The
 * removal as a block's reason and fix; `{ whole: true }` for a project below the top level that
 * keeps no tracked path - deleted or moved whole, so nothing there rests on the evidence, and it
 * is not judged where it was. The top level always stays, but its ledger deleted is a move, not a
 * removal, when the staged list names one other folder's ledger that holds the evidence
 * (`evidenceMovedTo`) and the index keeps no path under research/ here (`researchRemains`):
 * `{ whole: true, movedTo }`. null when nothing is taken, when no staged path
 * is under research/raw/ (no git call), or with no repository at the project, where git would
 * answer for one above it. bin/gate.mjs asks it of an ungated top level, so the hook's choice of
 * what to judge and the verdict cannot disagree.
 */
export function headEvidenceRemoval(root, { top = null, stagedPaths = null,
  stagedText = (rel) => readStagedText(root, rel, { top }),
  listDeleted = () => stagedRawDeletions(root, { top }),
  headLedger = () => readHeadLedger(root, { top }),
  remains = () => projectRemains(root, { top }),
  movedTo = (headText) => evidenceMovedTo(root, stagedPaths, headText),
  keepsResearch = () => researchRemains(top ?? root) } = {}) {
  const posix = (p) => String(p).split('\\').join('/').replace(/^\.\//, '');
  if (Array.isArray(stagedPaths) && !stagedPaths.some((p) => posix(p).startsWith(`${PATHS.raw}/`))) return null;
  if (!isGitRepo(top ?? root)) return null;
  let text;
  try { text = stagedText(PATHS.ledger); } catch { text = null; }
  const ledger = typeof text === 'string' ? { present: true, entries: ledgerEntries(text) } : { present: false, entries: [] };
  // HEAD's ledger is read once: the move below compares against the same text.
  let headText;
  const head = () => {
    if (headText === undefined) { try { headText = headLedger() ?? null; } catch { headText = null; } }
    return headText;
  };
  const removal = evidenceRemoval({ ledger }, stagedPaths, { listDeleted, headLedger: head });
  if (!removal) return null;
  if (projectPrefix(top, root)) return remains() ? removal : { whole: true };
  // At the top level only the ledger's own deletion can be a move: a ledger kept in place stays
  // the top's, and what it names is judged here. An unknown staged list names no candidate. A
  // move takes research/ out of the index whole: raw/ moved while the top keeps its other files
  // tracked leaves a corpus whose evidence is gone, #312's harm (check (e) of the 2026-10-19
  // review, E2).
  const prefix = !ledger.present && Array.isArray(stagedPaths) ? movedTo(head()) : null;
  return prefix && !keepsResearch() ? { whole: true, movedTo: prefix } : removal;
}

/**
 * Where the top level's evidence went when the commit moves it below the top (check (c) of the
 * 2026-10-19 review, F2): the one folder P for which the index stages P/research/raw/.fetches.jsonl
 * holding every entry of HEAD's ledger (by `ledgerKey`, as `evidenceRemoval` keeps them), and, at
 * P/<the same path>, every capture and source HEAD's ledger names and HEAD holds, as the same blob -
 * moved, not changed. `git mv research packages/x/research` is one; a ledger copied with a capture
 * dropped, edited or put elsewhere is not. The candidates are the staged paths that end in
 * /research/raw/.fetches.jsonl, so a commit that stages none asks git nothing; each asks one
 * `git ls-files -s` (literal pathspecs) and reads its ledger by blob id, after one `git ls-tree` of
 * HEAD's research/raw/. null when no folder holds it all, or git cannot say - the blocking direction.
 */
function evidenceMovedTo(root, stagedPaths, headText, { run = gitCapture } = {}) {
  const posix = (p) => String(p).split('\\').join('/').replace(/^\.\//, '');
  const tail = `/${PATHS.ledger}`;
  const candidates = [...new Set(stagedPaths.map(posix).filter((p) => p.endsWith(tail)).map((p) => p.slice(0, -tail.length)))];
  if (!candidates.length || typeof headText !== 'string') return null;
  const env = literalPathspecs();
  // `<mode> <type> <id>\t<path>` (ls-tree) and `<mode> <id> <stage>\t<path>` (ls-files -s), NUL-ended.
  const blobs = (args, idAt) => {
    const text = run(args, { cwd: root, env });
    if (typeof text !== 'string') return null;
    const ids = new Map();
    for (const record of text.split('\0')) {
      const tab = record.indexOf('\t');
      if (tab > 0) ids.set(record.slice(tab + 1), record.slice(0, tab).split(' ')[idAt]);
    }
    return ids;
  };
  const inHead = blobs(['ls-tree', '-r', '-z', 'HEAD', '--', PATHS.raw], 2);
  if (!inHead) return null;
  const head = ledgerEntries(headText);
  const held = [...new Set(head.filter((entry) => entry.op !== 'fail')
    .flatMap((entry) => [entry.raw, entry.source]).filter((file) => typeof file === 'string' && file).map(posix))]
    .filter((file) => inHead.has(file));
  for (const prefix of candidates) {
    const staged = blobs(['ls-files', '-s', '-z', '--', `${prefix}/${PATHS.raw}`], 1);
    const ledgerId = staged?.get(`${prefix}/${PATHS.ledger}`);
    if (!ledgerId || !held.every((file) => staged.get(`${prefix}/${file}`) === inHead.get(file))) continue;
    const text = run(['cat-file', 'blob', ledgerId], { cwd: root });
    if (typeof text !== 'string') continue;
    const kept = new Set(ledgerEntries(text).map(ledgerKey));
    if (head.every((entry) => kept.has(ledgerKey(entry)))) return prefix;
  }
  return null;
}

/**
 * The environment for a git call whose pathspec is a path, read literally whatever pathspec
 * settings the committer's environment carries, so a folder whose name holds a glob character is
 * that folder; git cannot combine literal with the other three, so they are dropped.
 */
function literalPathspecs() {
  const env = { ...process.env, GIT_LITERAL_PATHSPECS: '1' };
  for (const name of ['GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS']) delete env[name];
  return env;
}

/**
 * Whether the top level's index keeps a path under research/ after the commit: one literal
 * `git ls-files`, asked only once `evidenceMovedTo` named a folder - the top level's counterpart of
 * `projectRemains` (check (e) of the 2026-10-19 review, E2). A git that cannot answer counts as
 * kept, which blocks.
 */
function researchRemains(root, { run = gitCapture } = {}) {
  const text = run(['ls-files', '-z', '--', RESEARCH], { cwd: root, env: literalPathspecs() });
  return typeof text !== 'string' || text.length > 0;
}

/**
 * Whether a project below `top` keeps a tracked path after the commit: one `git ls-files` of its
 * folder in the index, asked only once a removal was found, with literal pathspecs. A git that
 * cannot answer counts as kept - the blocking direction. The top level is always kept.
 */
function projectRemains(root, { top = null, run = gitCapture } = {}) {
  const prefix = projectPrefix(top, root);
  if (!prefix) return true;
  const text = run(['ls-files', '-z', '--', prefix], { cwd: top, env: literalPathspecs() });
  return typeof text !== 'string' || text.length > 0;
}

export { GATE_MARKERS, fixCommand };
