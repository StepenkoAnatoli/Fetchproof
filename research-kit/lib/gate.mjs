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

/** One staged file's text: the index's bytes, or, outside a repository, the working tree's. */
export function readStagedText(root, rel, { run = gitCapture } = {}) {
  if (!isGitRepo(root)) return readText(resolve(root, rel));
  return run(['show', `:${rel}`], { cwd: root });
}

/** A project is gated when ANY of the four markers exists. */
export function isGated(root) {
  return GATE_MARKERS.some((marker) => {
    const abs = resolve(root, marker);
    return marker.endsWith('/') || marker === PATHS.raw ? isDirectory(abs) : exists(abs);
  });
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
 * The suite rule (ADR-0120): in the kit's OWN checkout, a commit touching `research-kit/`
 * needs a green suite. "A red suite stops work" was prose, and in one afternoon an agent
 * committed twice while the suite was red - once reading the result through a pipe that
 * hid the exit code, once trusting a `set -e` that did not stop. Prose did not hold; the
 * gate does.
 *
 * Scope is deliberately narrow. The rule fires only where all four markers of the kit's
 * checkout exist - a scaffolded project has none of them, so no other project ever pays
 * for a suite it does not own - and only for a commit that stages something under
 * `research-kit/`: a docs-only commit owes no suite. The runner is the checkout's own
 * `bin/selftest.mjs`, read through its result file, not its stdout: an unsupported test
 * (no Chromium, no Python - ADR-0108) is not red, and a runner that died before reporting
 * is a block, never a pass.
 */
export const SUITE_RULE = 'suite-green-before-commit';

/**
 * The suite's budget (ADR-0142) is a backstop for a hang, never a forecast of a run. The default
 * is twice the slowest honest run measured on a supported host - 1825 s, the operator's Windows
 * PC, 2026-10-05 - rounded up to five minutes. It was 20 minutes, and that PC's green suite met
 * it on every commit touching research-kit/: a budget below an honest run blocks a green tree,
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

// The one grammar both layers read RESEARCH_KIT_GATE_TIMEOUT in: seconds, with an optional fraction
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
 * The suite's budget in ms. `RESEARCH_KIT_GATE_TIMEOUT` is the operator's bound on the whole gate,
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
  const watchdogS = gateTimeoutSeconds(env.RESEARCH_KIT_GATE_TIMEOUT);
  if (watchdogS === null || watchdogS === 0) return SUITE_TIMEOUT_MS;
  // Never 0 for a positive watchdog - spawnSync reads 0 as no bound - and never past a timer's reach.
  return Math.min(MAX_TIMER_MS, Math.max(1, Math.round(Math.max(watchdogS - GATE_REST_S, watchdogS / 2) * 1000)));
}

const KIT_DIR = 'research-kit';
const KIT_CHECKOUT_MARKERS = Object.freeze([`${KIT_DIR}/lib/core.mjs`, `${KIT_DIR}/bin/gate.mjs`, `${KIT_DIR}/bin/selftest.mjs`, `${KIT_DIR}/test`]);

/** True only in a checkout of the kit's repository: the runner, the gate, and the tests are all here. */
export function isKitCheckout(root) {
  return KIT_CHECKOUT_MARKERS.every((rel) => exists(resolve(root, rel)));
}

/** Whether a commit owes the suite: the kit's checkout, and a staged path under research-kit/ (or the list unknown). */
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
  const resultFile = path.join(tempBase(), `rk-suite-${process.pid}-${Date.now()}.json`);
  const env = { ...process.env, RESEARCH_KIT_RESULT_FILE: resultFile, RESEARCH_KIT_ALLOW_UNSUP: '1' };
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

export function suiteBreach(root, stagedPaths, { run = () => runSuiteHere(root), announce = null } = {}) {
  if (!suiteOwed(root, stagedPaths)) return null;
  const fix = `make the suite green (node ${KIT_DIR}/bin/selftest.mjs), then commit again; git commit --no-verify overrides, and records nothing - say so in your reply`;
  // Called right before the run, so what a caller says about the suite running is true.
  if (announce) announce();
  const result = run();
  if (!result) {
    return { rule: SUITE_RULE, detail: 'the suite was run and the runner produced no result - it crashed before reporting', fix };
  }
  if (result.timedOut) {
    // A slow host and a hung test read the same here; the remedy for the first is the operator's
    // setting, not the override (ADR-0142).
    return {
      rule: SUITE_RULE,
      detail: `the suite did not finish within ${result.seconds} s and was stopped - a suite that cannot report is not green`,
      fix: `if the suite is only slow on this host, time a run (node ${KIT_DIR}/bin/selftest.mjs prints its seconds, and names a test that hangs) and set RESEARCH_KIT_GATE_TIMEOUT to twice that plus ${GATE_REST_S} for the commit (RESEARCH_KIT_GATE_TIMEOUT=<seconds> git commit ...) - the hook's watchdog; the suite gets it less ${GATE_REST_S} s, or half of one under ${2 * GATE_REST_S} s (ADR-0142); git commit --no-verify overrides, and records nothing - say so in your reply`,
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

export function stagedPathsFromStdin(readSync) {
  if (!stdinIsReadable()) return null;
  try {
    return splitPathList(readSync());
  } catch {
    return null;
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
 */
export function materializeIndex(root, { run = gitCapture, tmp = tempBase() } = {}) {
  if (!isGitRepo(root)) {
    return { ok: false, reason: 'not-a-repository', detail: 'no .git here, so there is no index to read' };
  }

  const dir = fs.mkdtempSync(path.join(tmp, 'research-kit-index-'));
  // Only the corpus is materialised. The gate judges research/, and copying a whole
  // checkout to answer a question about one directory is a cost paid on every commit.
  const listed = run(['ls-files', '-z', '--', 'research'], { cwd: root });
  if (listed === null) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: 'git-failed', detail: 'could not list the index' };
  }

  const paths = String(listed).split('\0').map((p) => p.trim()).filter(Boolean);
  if (!paths.length) {
    return { ok: true, dir, files: 0, empty: true };
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
    const result = run(['checkout-index', '--prefix', prefix, '-f', '--', ...batch], { cwd: root });
    if (result === null) { written = null; break; }
    written += result;
  }
  if (written === null) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: 'git-failed', detail: 'could not materialise the index' };
  }
  return { ok: true, dir, files: paths.length, empty: false };
}

function gitCapture(args, { cwd }) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
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
  // Injectable for the same reason: the staged text of one path (the architecture map).
  stagedText = (rel) => readStagedText(root, rel),
  // The suite rule's runner (ADR-0120); null means the checkout's own selftest.mjs. The
  // announcement runs right before it, so a caller can break the minutes of silence.
  runSuite = null, announceSuite = null } = {}) {
  const base = { gate, root, fix: fixCommand() };

  if (!isGated(root)) {
    return { ...base, verdict: 'not-gated', allow: true, reason: 'no gate marker in this project', findings: [] };
  }

  if (exists(resolve(root, PATHS.gateOff))) {
    if (record) { try { recordOverride(root, 'GATE_OFF', `${gate} gate`); } catch { /* read-only checkout */ } }
    return {
      ...base, verdict: 'override', allow: true,
      reason: `${PATHS.gateOff} is present - the gate is off for this repository, and it is recorded`,
      findings: [],
    };
  }

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
    const materialised = materialize(root);
    if (materialised.ok && materialised.empty) {
      // materializeIndex made its scratch dir before it knew the index held no corpus,
      // and this return happens before `scratch` is assigned - the finally below cleans
      // only what got assigned. Every verdict on a gated project whose research/ is not
      // yet tracked, which is every fresh project's first commit, leaked one temp
      // directory (found 2026-09-28, break-test).
      try { fs.rmSync(materialised.dir, { recursive: true, force: true }); } catch { /* best effort, matching the finally */ }
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
      snapshot = readCorpus(materialised.dir);
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
    const suite = gate === 'commit' ? suiteBreach(root, stagedPaths, { ...(runSuite ? { run: runSuite } : {}), announce: announceSuite }) : null;
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

export { GATE_MARKERS, fixCommand };
