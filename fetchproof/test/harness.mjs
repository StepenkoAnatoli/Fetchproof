// test/harness.mjs - the runner, and the project fixture.
//
// A TEST VERDICT IS EARNED, NOT PRINTED (ADR-0021). `runPending` is async and AWAITS
// every test, so `ok` is printed only once the assertions have settled and the returned
// failure count includes async failures.
//
// The old runner was synchronous and caught only a synchronous throw, so an async test
// printed `ok` the instant it returned its promise - before any assertion inside it had
// run - its failure arrived later as an unhandled rejection, and the runner's own
// `process.exit(0)` pre-empted even that.
//
// Each test is raced against a watchdog, because an awaited test that never settles
// would hang the suite printing nothing - the trap the commit gate fell into before it
// got one.

import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEmptyProject, scaffoldProject, KIT_ROOT } from '../lib/scaffold.mjs';
import { appendFetch } from '../lib/provenance.mjs';
import { writeRaw } from '../lib/collect.mjs';
import { PATHS, resolve, writeText, appendLine, today, tempBase } from '../lib/core.mjs';
import { checkPython } from '../lib/runtime.mjs';

// --- this suite does not inherit the git context it was started in -----------------
//
// GIT_DIR, GIT_WORK_TREE and their kin are how git redirects EVERY child git process to
// a repository other than the one its cwd names. From git's own mouth - a hook, which
// receives GIT_INDEX_FILE and is judged on that index - they are the data path. Arriving
// in THIS process they are ambient state from wherever the suite was started: a wrapper
// that exported GIT_DIR once and never unset it, a hook that runs the tests, an editor
// integration. Every scratch repository the suite builds is then bypassed, and its
// fixture commits land in the repository the variables name instead (found 2026-09-28,
// break-test: with GIT_DIR and GIT_WORK_TREE exported, `git add -A -f` in hook.test.mjs's
// fixture staged this repository's own __pycache__ and COMMITTED to it - 16 red tests,
// and a "the corpus" commit on a branch nobody asked for).
//
// So the suite removes them from its own process before any test runs, and says so on
// stderr: a variable silently ignored is a variable nobody learns to unset. The commit
// gate itself (bin/gate.mjs) deliberately still honours these - it runs from inside
// git's hook, where they point at the repository being committed. The suite is the
// opposite case: it judges this checkout and its own scratch repositories, never a
// repository named by the environment it happened to be started in.
export const LEAKED_GIT_CONTEXT = Object.freeze([
  'GIT_DIR',                       // redirects the repository itself
  'GIT_WORK_TREE',                 // redirects the working tree git operates on
  'GIT_INDEX_FILE',                // redirects the index (also how `git add -A -f` escapes)
  'GIT_OBJECT_DIRECTORY',          // redirects where objects are written
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',                    // a hook's cwd prefix, wrong for every scratch spawn
  'GIT_CEILING_DIRECTORIES',       // can stop discovery of the very checkout being judged
  'GIT_CONFIG_PARAMETERS',         // an outer `git -c ...` speaking to its own children
]);

/** Remove the leaked git context from `env`, returning the names that were there. */
export function stripLeakedGitContext(env) {
  const removed = [];
  for (const name of LEAKED_GIT_CONTEXT) {
    if (name in env) {
      delete env[name];
      removed.push(name);
    }
  }
  return removed;
}

const leakedGitContext = stripLeakedGitContext(process.env);
if (leakedGitContext.length) {
  process.stderr.write(
    `${leakedGitContext.join(', ')} found in the environment and removed for this run. `
    + 'They redirect every git child process to a repository other than the one its cwd names, '
    + 'so the suite would judge - and commit to - that repository instead of this checkout.\n');
}

/**
 * The per-test watchdog, in milliseconds.
 *
 * Validated rather than coerced. `Number(...)` accepted anything: `0` made every test
 * time out instantly and report as a mass product failure, `not-a-number` produced `NaN`
 * — and `setTimeout(fn, NaN)` fires immediately, so a typo in an environment variable
 * turned a green suite red with no indication that the cause was the typo. A malformed
 * knob should be a named configuration error, not a hundred confusing failures.
 *
 * Bounds are deliberate, and the lower one is 50ms rather than something comfortable:
 * harness.test.mjs drives the watchdog itself with 150ms and 300ms, because a test that
 * proves a timeout works must be allowed to time out quickly. The floor exists to reject
 * 0 - which fires instantly and reports as a mass product failure - not to enforce taste.
 */
export const TEST_TIMEOUT = (() => {
  const raw = process.env.FETCHPROOF_TEST_TIMEOUT;
  if (raw === undefined || raw === '') return 60_000;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 50 || value > 3_600_000) {
    process.stderr.write(
      `FETCHPROOF_TEST_TIMEOUT=${JSON.stringify(raw)} is not usable. `
      + 'It must be a whole number of milliseconds between 50 and 3600000.\n'
      + 'Unset it to use the default of 60000.\n');
    process.exit(2);
  }
  return value;
})();

const pending = [];
let currentFile = '';

/**
 * A capability this host cannot provide - a missing POSIX shell, an absent git.
 *
 * It is NOT a skip. A test that returns early on a missing prerequisite prints `ok`
 * having asserted nothing, which is the same false green ADR-0021 exists to prevent,
 * one layer up: the suite goes green on a host where the thing under test never ran.
 * An unsupported capability is reported under its own label, with the reason code, and
 * it BLOCKS - `runPending` counts it and the runner exits non-zero.
 */
export class Unsupported extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = 'Unsupported';
    this.code = code;
    this.reason = reason;
  }
}

/** `requireCapability(SH, 'SHELL-NOT-FOUND', 'no POSIX sh on this host')` */
export function requireCapability(value, code, reason) {
  if (value) return value;
  throw new Unsupported(code, reason);
}

let pythonProbe;
/**
 * The Python interpreter the conformance runners need on this host, or null: whichever
 * `checkPython` chooses - `python3` first, then `python`, each only at 3.11 or newer. Stock
 * Ubuntu and macOS ship only `python3`, and three conformance tests that called `python` by
 * name went red there (break-test, 2026-09-27); the fix took the first that answered, so an
 * old `python` alias hid a usable `python3` (Arena break test 7). `run` is for tests.
 */
export function findPython({ run } = {}) {
  if (run) return checkPython({ run }).exe ?? null;
  // Test fixture only: a host with no Python, simulated on every platform, so the
  // FETCHPROOF_ALLOW_UNSUP test needs no PATH surgery (ADR-0108).
  if (process.env.FETCHPROOF_TEST_NO_PYTHON === '1') return null;
  if (pythonProbe === undefined) pythonProbe = checkPython().exe ?? null;
  return pythonProbe;
}

let gitProbe;
/** Is git on this host? Probed once. A test that needs a repository requires it. */
export function requireGit(what) {
  if (gitProbe === undefined) {
    const probe = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    gitProbe = !probe.error && probe.status === 0;
  }
  return requireCapability(gitProbe, 'GIT-NOT-FOUND', `git is not on PATH, so ${what} cannot be checked`);
}

/**
 * The interpreter to run, or UNSUPPORTED (it blocks) naming what could not be checked - and
 * what WAS found: "python3 3.8.10; the conformance runners need 3.11+" sends the operator to
 * the right place, "no python on this host" sent them to the wrong one when a too-old or
 * broken interpreter was on PATH (break-test pass 4, F2, 2026-10-04). The detail is
 * checkPython's own, so the suite and the kit describe the host in the same words.
 */
export function requirePython(what, { run } = {}) {
  const found = findPython(run ? { run } : {});
  if (found) return found;
  const probe = process.env.FETCHPROOF_TEST_NO_PYTHON === '1' && !run ? { detail: 'no python on PATH' } : checkPython(run ? { run } : {});
  return requireCapability(null, 'PYTHON-NOT-FOUND', `${probe.detail}, so ${what} cannot be checked`);
}

/**
 * A FILE symlink the test under way needs, or UNSUPPORTED (it blocks) naming what could not
 * be checked. On Windows a file symlink needs Developer Mode or an elevated shell, and
 * `fs.symlinkSync(..., 'file')` throws EPERM without either; an outside review ran the collect
 * group on such a machine (2026-10-02) and read the EPERM as a red test, which it is not: the
 * code under test never ran. The privilege is a host prerequisite like Python or git
 * (ADR-0108), so it is reported under the UNSUP label with the reason, and CI, whose Windows
 * runner has the privilege, still runs the test. A junction needs no privilege, so a test
 * that links a DIRECTORY calls `fs.symlinkSync(..., 'junction')` directly.
 *
 * `FETCHPROOF_TEST_NO_SYMLINK=1` is the harness's seam: it makes the refusal reproducible
 * on every platform, as `FETCHPROOF_TEST_NO_PYTHON` does for the interpreter.
 */
export function requireSymlink(target, at, what) {
  const refuse = () => { throw new Unsupported('SYMLINK-NOT-PERMITTED', `this host refuses to create a file symlink (on Windows: Developer Mode or an elevated shell), so ${what} cannot be checked`); };
  if (process.env.FETCHPROOF_TEST_NO_SYMLINK === '1') refuse();
  try {
    fs.symlinkSync(target, at, 'file');
  } catch (err) {
    if (err?.code === 'EPERM') refuse();
    throw err;
  }
}

/**
 * Import each test file, and RETURN the ones that throw while loading.
 *
 * An import-time throw - an unwritable TMPDIR under a module-scope tempDir(), a missing
 * fixture, a read at module scope - used to abort the RUNNER: no test ran, no count was
 * printed, and CI reported "crashed before reporting" for one file's problem (found
 * 2026-09-28). The runner reports each broken file as a named failure instead, and runs
 * everything that did load.
 */
export async function importTestFiles(dir, files) {
  const broken = [];
  for (const file of files) {
    try {
      await import(pathToFileURL(path.join(dir, file)).href);
    } catch (error) {
      broken.push({ file, error });
    }
  }
  return broken;
}

export function test(name, fn) {
  pending.push({ name, fn, file: currentFile });
}

export function describe(file) {
  currentFile = file;
}

function watchdog(name, promise) {
  let timer;
  const bound = new Promise((_, reject) => {
    // Deliberately NOT unref'd: a test that never settles leaves the watchdog as the
    // only work in the loop, and an unref'd timer would let node exit 13 ("await never
    // settled") before it fired - a hang reported as a runtime error instead of as the
    // named test that hung. It is cleared in the `finally` below either way.
    timer = setTimeout(() => reject(new Error(`test timed out after ${TEST_TIMEOUT}ms`)), TEST_TIMEOUT);
  });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
}

/**
 * The error code a failure message opens with, or null.
 *
 * A libuv/Node system error renders as `CODE: message, syscall 'path'` - `ENOSPC: no space
 * left on device, write`. An assertion renders as prose. Telling the two apart is what
 * lets a red suite say whether it found 653 broken behaviours or one broken machine.
 */
export function errorCodeOf(err) {
  const match = /^([A-Z][A-Z0-9]{2,}): /.exec(String(err?.message ?? ''));
  return match ? match[1] : null;
}

/**
 * When one error code sits behind most of a red suite, name it - otherwise null.
 *
 * Found 2026-09-29 (break-test): with TMPDIR on a 1 MiB volume - a full disk, a small
 * tmpfs, a CI runner out of space - the suite printed `585 passed, 653 failed`, 646 of
 * those failures `ENOSPC`, and NOTHING named the cause. stderr was empty and the temp
 * probe passed, because it only created and removed an EMPTY directory, which fits in no
 * room at all. That is the same defect the read-only-TMPDIR fix closed on 2026-09-28
 * (541 x EACCES, one cause, never stated), reached by capacity instead of permission.
 *
 * So the failures are grouped by the code they open with and the runner can say which one
 * dominates. Thresholds are deliberately high: two failures are not a pattern, and three
 * of 653 are not one cause. A shared code is evidence, never a verdict - the failures
 * still print, and the suite is still red.
 */
export function dominantFailureCause({ failures = 0, errorCodes = [] } = {}) {
  if (!Array.isArray(errorCodes) || !errorCodes.length) return null;
  const [top] = [...errorCodes].sort((a, b) => b.count - a.count);
  if (failures < 3 || top.count < 3) return null;
  const share = top.count / failures;
  if (share < 0.5) return null;
  return { code: top.code, count: top.count, share };
}

/**
 * Runs every queued test, awaiting each. Returns the failure count and, since 2026-10-04
 * (break-test pass 5), the failing tests' labels: a count cannot show one test starting to
 * fail while another starts to pass, and the result file CI publishes carried only the count.
 */
export async function runPending({ log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  let failures = 0;
  let passed = 0;
  const failed = [];
  const unsupported = [];
  const codes = new Map();
  for (const entry of pending.splice(0)) {
    const label = entry.file ? `${entry.file} > ${entry.name}` : entry.name;
    let settled;
    try {
      settled = entry.fn();
      // A timed-out test's promise is swallowed, so its late rejection cannot crash the
      // runner over a test already judged and attributed.
      if (settled && typeof settled.then === 'function') settled.catch(() => {});
      await watchdog(label, Promise.resolve(settled));
      passed += 1;
      log(`ok    ${label}`);
    } catch (err) {
      if (err instanceof Unsupported) {
        // Reported separately from a product assertion failure, and still blocking.
        unsupported.push({ label, code: err.code, reason: err.reason });
        log(`UNSUP ${label}\n        ${err.code}: ${err.reason}`);
        continue;
      }
      failures += 1;
      failed.push(label);
      const code = errorCodeOf(err);
      if (code) codes.set(code, (codes.get(code) ?? 0) + 1);
      log(`FAIL  ${label}\n        ${String(err.message).split('\n').join('\n        ')}`);
    }
  }
  return {
    failures, failed, passed, unsupported, blocking: failures + unsupported.length,
    errorCodes: [...codes].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
  };
}

export { assert };

/**
 * The two helpers the ported validator tests use that this harness lacked (ADR-0029).
 *
 * They come from the tree those tests were written in. Reproduced here rather than
 * imported, because that tree is not a dependency of this one and must not become one -
 * a port that leaves an import pointing at an unprovenanced directory has not ported
 * anything.
 *
 *  is strict equality with a readable message. Deliberately NOT an alias
 * for : the ported tests pass a message as the third argument and read
 * the JSON of both sides on failure, and silently changing that would make their
 * failures harder to read than they were at home.
 */
export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message ?? 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Remove a temp directory a test made.  here tracks nothing, so this is the whole job. */
export function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- fixtures

/**
 * The folder this run's scratch goes in. Computed once, and never inside the checkout.
 *
 * A TMPDIR that resolves INSIDE the repository - `TMPDIR=.` is the plainest spelling -
 * puts the suite's scratch in the tree it is JUDGING. That is not a tidy point:
 * `doctor`'s secret scan, which F26 asserts stays clean about the kit itself, then
 * reports the credential-shaped fixtures every test writes, and the suite goes red on a
 * machine that simply exports an unusual temp folder (found 2026-09-29, break-test).
 *
 * The product must not second-guess TMPDIR - an operator who points it at a folder means
 * it - but the suite's scratch is the suite's own business, and it cannot live in the
 * thing being judged. It moves to the platform default, and says so once: a variable
 * silently ignored is a variable nobody learns to unset.
 */
let scratchRoot;
function scratchBase() {
  if (scratchRoot !== undefined) return scratchRoot;

  const repoRoot = path.resolve(KIT_ROOT, '..');
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const asked = tempBase();
  const rel = path.relative(real(repoRoot), real(asked));
  const insideRepo = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));

  if (!insideRepo) {
    scratchRoot = asked;
    return asked;
  }

  // The platform default: whatever os.tmpdir() answers with the temp variables unset.
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  for (const name of Object.keys(saved)) delete process.env[name];
  let fallback;
  try { fallback = path.resolve(os.tmpdir()); } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  // Published, so every child agrees - the same reason tempBase() does it.
  for (const name of Object.keys(saved)) {
    if (saved[name] !== undefined) process.env[name] = fallback;
  }
  process.stderr.write(
    `the temp folder ${asked} is inside this checkout, so this run's scratch goes to ${fallback} instead. `
    + 'Point TMPDIR outside the repository and this stops.\n');
  scratchRoot = fallback;
  return fallback;
}

export function tempDir(prefix = 'fetchproof-') {
  // TMPDIR is allowed to name a directory that does not exist yet - a container with a
  // cleaned /tmp, a CI job that exports RUNNER_TEMP before creating it. `mkdtemp` then
  // throws ENOENT, and where that call sits at module scope it aborts the RUNNER rather
  // than failing a test: no result file, no count, just a stack trace. Creating the
  // parent first costs one syscall and turns a suite-wide abort into nothing at all.
  //
  // tempBase(), not os.tmpdir(): a RELATIVE TMPDIR is legal and, resolved per call against
  // whichever cwd is current, scatters scratch directories across the filesystem - and it
  // made the COMMIT GATE's index snapshot throw ENOENT and fail open (2026-09-29).
  const base = scratchBase();
  createTempFolder(base);
  const dir = fs.mkdtempSync(path.join(base, prefix));
  scratchDirs.push(dir);
  return dir;
}

// Every directory this process made through tempDir(), so the run can take its scratch
// with it when it ends (found 2026-09-28, break-test: a full run made ~1,400 scratch
// directories - about 100 MB - and removed almost none of them, so /tmp grew without
// bound on a machine that runs the suite, and where /tmp is tmpfs that growth is RAM).
// Only the directories THIS process created are touched, each by the exact path
// mkdtemp returned, so two suites running at once cannot sweep each other's scratch.
// On 'exit', not at the end of the test list: an import-time throw, a red run and a
// process.exit(1) all pass through here too, and none of those should leak either.
const scratchDirs = [];

/**
 * Create the temp folder when it does not exist yet, and remember what was created.
 *
 * A folder the run created is the run's to remove, and ONLY that: the ancestors that did
 * not exist are recorded, deepest first, and each goes with the scratch at exit through a
 * non-recursive rmdir, which refuses a folder holding anything else. A TMPDIR that existed
 * is never touched, and one something else used meanwhile stays. Until 2026-10-04 the
 * created chain was left behind, empty: `TMPDIR=/nonexistent/dir/xyz` left
 * /nonexistent/dir/xyz, and a relative TMPDIR an empty folder inside the checkout
 * (break-test pass 4, F3). The runner's temp probe creates its folder through here too.
 */
const createdDirs = [];
export function createTempFolder(dir, { mkdir = (p) => fs.mkdirSync(p) } = {}) {
  const missing = [];
  for (let p = path.resolve(dir); !fs.existsSync(p); p = path.dirname(p)) {
    missing.push(p);
    if (path.dirname(p) === p) break;
  }
  // Shallowest first, one non-recursive mkdir each, and ONLY a mkdir that succeeded is
  // recorded: ownership is the creation, not the existence check before it. Recording from
  // the check left a window in which another process created the same chain and this run,
  // having made nothing, removed that process's empty folder at exit (found 2026-10-04 by
  // an external review of the fix). EEXIST is that other process; anything else is the
  // caller's to hear about, as before.
  // Each created folder goes to the FRONT, so the list is deepest first at every moment - a
  // sort after the loop was skipped by a mkdir that threw part-way, and the parent already
  // recorded was then tried before its child and left behind, empty (found 2026-10-04 by
  // the second external review).
  for (const p of missing.reverse()) {
    try {
      mkdir(p);
      createdDirs.unshift(p);
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
  }
}

function removeScratch() {
  for (const dir of scratchDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a scratch dir that cannot be removed must not fail the run's own exit */ }
  }
  // Deepest first, as recorded. rmdir is deliberately not recursive: a folder that holds
  // anything the run did not make stays, with what it holds.
  for (const dir of createdDirs.splice(0)) {
    try { fs.rmdirSync(dir); } catch { /* not empty, or already gone: either way not this run's to remove */ }
  }
}
process.on('exit', removeScratch);
// 'exit' does not run when a signal ends the process, so one Ctrl-C left every scratch dir the
// run had made (found 2026-09-29, Arena break test: 110 directories). A listener replaces the
// default action, so it exits with the code the shell would have reported: 128 + the signal.
for (const [signal, number] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) {
  process.once(signal, () => { removeScratch(); process.exit(128 + number); });
}

/** The fixture and the scaffolder are the same call, which is what stops them drifting. */
export function makeProject(dir = tempDir(), { topic = 'Fixture topic', content = false } = {}) {
  if (content) scaffoldProject(dir, { topic, kit: KIT_ROOT });
  else createEmptyProject(dir);
  return dir;
}

/**
 * The argv for a fixture's own corpus commit, immune to the host machine's git config.
 *
 * A scratch repository reads the operator's GLOBAL config unless a command says otherwise,
 * and two settings there run on every commit: `core.hooksPath` (what `husky install` and
 * corporate hook frameworks write) and `commit.gpgsign` (a mandated-signing machine with
 * no key reachable from a test). A fixture commit that dies on either reports a kit
 * defect that does not exist - 12 and 13 red tests respectively on an otherwise healthy
 * checkout (found 2026-09-28, break-test). The fixture is not signed and runs no hooks:
 * the gate is exercised by running the hook file directly, and a corpus commit is setup,
 * not the thing under test.
 *
 * The `-c` precedes the subcommand because after it, `git commit -c <arg>` means "take
 * that commit's message as a template" - a different, quiet kind of breakage.
 */
export function fixtureCommitArgs(message) {
  return ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', message];
}

/**
 * The argv for a fixture's `git init`, immune to the host machine's `init.templateDir`.
 *
 * `git init` copies the template folder the global config names into every new repository.
 * `pre-commit init-templatedir` and corporate setups point it at a folder whose `hooks/`
 * holds a hook, so a fixture repository carried the host's hook; the kit's own hook hands
 * on to the repository's (ADR-0112), and seven hook tests reported the kit refusing a
 * commit it had allowed. A custom template ships no `info/exclude` either, and two handoff
 * tests died on ENOENT (found 2026-10-02, break-test: GIT_CONFIG_GLOBAL naming such a
 * template). An empty templateDir copies nothing - no hooks, no description, no
 * `info/exclude` - and a fixture that needs one of those creates it.
 */
export function fixtureInitArgs(...extra) {
  return ['-c', 'init.templateDir=', 'init', '-q', ...extra];
}

/** A project that passes the gate: one unknown, one row, one capture, one ledger entry. */
export function makePassingProject(dir = tempDir(), { date = today() } = {}) {
  makeProject(dir, { content: true });

  const entry = writeRaw(dir, {
    url: 'https://example.invalid/docs/limits',
    title: 'Limits',
    markdown: `# Limits\n\n${'The free plan allows 10 requests per minute and includes 1,000 credits. '.repeat(30)}`,
    cmd: 'firecrawl scrape https://example.invalid/docs/limits --only-main-content --json',
    statusCode: 200,
    transport: 'firecrawl-cli',
    completeness: 'full',
  }, { date });

  appendFetch(dir, {
    op: 'scrape',
    url: entry.url,
    type: 'P',
    raw: entry.file,
    bodySha256: sha256Of(path.join(dir, ...entry.file.split('/'))),
    transport: 'firecrawl-cli',
    completeness: 'full',
    cmd: entry.command,
    at: `${date}T00:00:00.000Z`,
  });

  writeText(resolve(dir, PATHS.discovery), `# Discovery Contract - Fixture topic

## Build intent

A fixture project that passes its own gate, so a test can prove the gate says PASS for a
corpus that deserves it.

## Unknowns

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-1 | What does the free tier allow? | Sets the collector's budget | CLOSED | E-01: 10 requests per minute, 1,000 credits |
`);

  writeText(resolve(dir, PATHS.evidence), `# Evidence

| ID | Retrieved | Type | URL | Finding | Raw |
|---|---|---|---|---|---|
| E-01 | ${date} | P | ${entry.url} | The free plan allows 10 requests per minute and includes 1,000 credits. | ${entry.file} |
`);

  writeText(resolve(dir, PATHS.map), `# MAP - topic decomposition

## Topic

Fixture topic

## Subtopics

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Decides the collection design | COVERED | U-1 |
| D-2 | Auth and credentials | Who holds the key | COVERED | U-1 |
| D-3 | Rate limits and quotas | Caps every cadence | COVERED | U-1 |
| D-4 | ToS, licensing, legality of the intended use | A prohibition ends the design | DISMISSED | public docs, personal research, no redistribution |
| D-5 | Data schema and its stability | Shape drift | DISMISSED | captures are frozen point-in-time; there is no extraction layer |
| D-6 | Freshness and staleness | What staleness costs | DISMISSED | handled structurally by retrieval dates and --refresh-days |
| D-7 | Cost at expected volume | Decides viability | COVERED | U-1 |
| D-8 | Runtime and platform limits | Where this executes | DISMISSED | one runtime, one machine, fixed by the fixture |
| D-9 | Output obtainability | Load-bearing | COVERED | U-1 |
`);

  writeText(resolve(dir, PATHS.sources), `# Sources

| URL | Type | Title | Retrieved | Used for |
|---|---|---|---|---|
| ${entry.url} | P | Limits | ${date} | U-1 |
`);

  return dir;
}

function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Append a line to a project file, for tests that need to break something. */
export function corrupt(dir, rel, transform) {
  const file = resolve(dir, rel);
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, transform(text), 'utf8');
  return file;
}

export function here(url) {
  return path.dirname(fileURLToPath(url));
}

export { fs, path, os, appendLine, KIT_ROOT };
