#!/usr/bin/env node
// bin/selftest.mjs - the whole suite.
//
// The harness AWAITS every test (ADR-0021), so `ok` means the assertions settled and
// the failure count includes async failures. A red suite exits non-zero: a failing test
// is a stop-the-line event, and the cwd is printed with it because some tests are
// cwd-sensitive and a red without a cwd is a failure that cannot be localised.

import fs from 'node:fs';
import path from 'node:path';
import { parseFlags, listFiles, refuseUnknownFlags, checkFlagValues, exists, kitCommand, tolerateClosedStdout, tempBase, tempFreeSpace, exitAfterFlush } from '../lib/core.mjs';
import { runPending, TEST_TIMEOUT, importTestFiles, describe, test, dominantFailureCause, tempDir, createTempFolder } from '../test/harness.mjs';
import { KIT_ROOT } from '../lib/scaffold.mjs';
import { checkNode, REQUIRED_NODE_MAJOR } from '../lib/runtime.mjs';

// Before the first write: a reader that quits early (`| head -1`) must not turn this run
// into an EPIPE crash, because that reads exactly like a red suite (2026-09-28).
tolerateClosedStdout();

const { flags, positional } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['help'], { takes: Infinity });
// No flag here takes a value, so a word after one is an argument (#289).
checkFlagValues(flags, {});
const dir = path.join(KIT_ROOT, 'test');

if (flags.help) {
  process.stdout.write(`selftest - run the kit's suite.

  node fetchproof/bin/selftest.mjs [name...]

  name   run only the test files whose name contains this text

Every test runs offline: no key, no credits, no network - and none of this machine's
  settings: the run has a scratch home and no FETCHPROOF_* variable (ADR-0123).
`);
  process.exit(0);
}

// The README promises Node 22 or newer, and the kit's commands refuse below it by name. The
// suite did not: on Node 20 it ran, and 28 tests went red, each carrying the same "this kit
// needs 22 or newer" where one refusal up front would do (break-test 2026-10-02). Exit 2:
// misuse, not a red suite, as for a run outside the checkout. FETCHPROOF_TEST_NODE_VERSION
// is the harness's seam, so the refusal can be exercised on the Node that runs the suite.
const nodeFloor = checkNode(process.env.FETCHPROOF_TEST_NODE_VERSION ?? process.versions.node);
if (!nodeFloor.ok) {
  process.stderr.write(`selftest runs on Node ${REQUIRED_NODE_MAJOR} or newer: ${nodeFloor.detail}.\n${nodeFloor.fix ? `${nodeFloor.fix}\n` : ''}`);
  process.exit(2);
}

const testFiles = listFiles(dir).filter((name) => name.endsWith('.test.mjs'));
const unmatched = positional.filter((needle) => !testFiles.some((name) => name.includes(needle)));
if (unmatched.length) {
  process.stderr.write(`selftest: ${unmatched.map((name) => JSON.stringify(name)).join(', ')} matches no test file in ${dir}; groups are named by file, e.g. warc for warc.test.mjs\n`);
  process.exit(2);
}

const files = testFiles
  .filter((name) => !positional.length || positional.some((needle) => name.includes(needle)))
  .sort();

if (!files.length) {
  process.stderr.write(`no test files in ${dir}\n`);
  process.exit(2);
}

// Tests name kit files as `fetchproof/...`, relative to the repository root, so the suite
// runs from there whatever folder it was started in - otherwise one import-time read from
// another cwd crashed the run before any test ran. A relative result file is the caller's,
// so it is resolved against the folder they started in, before the move.
const invokedFrom = process.cwd();
if (process.env.FETCHPROOF_RESULT_FILE) {
  process.env.FETCHPROOF_RESULT_FILE = path.resolve(invokedFrom, process.env.FETCHPROOF_RESULT_FILE);
}
process.chdir(path.resolve(KIT_ROOT, '..'));

// The suite is not portable away from its checkout: its tests judge repository fixtures
// the deploy mirror does not ship - the CI workflows, the ADRs and decision documents, the
// front README and AGENTS.md, this repository's collected corpus. From an INSTALLED kit
// (install.mjs -> ~/.agents/fetchproof) every one of those tests failed ENOENT - 100+
// red on a healthy deployment, indistinguishable from a genuinely broken kit, with doctor
// the only check that verifies an install (found 2026-09-28, break-test). Refuse there,
// naming what is missing and the check to run instead. Exit 2: misuse, not a red suite.
const missingAnchors = ['.github/workflows', 'docs/adr', 'AGENTS.md']
  .filter((rel) => !exists(path.join(KIT_ROOT, '..', rel)));
if (missingAnchors.length) {
  process.stderr.write(`selftest runs in the repository checkout; ${missingAnchors.join(', ')} ${missingAnchors.length === 1 ? 'is' : 'are'} not beside fetchproof/, so the tests that read repository fixtures would fail on a healthy deployment.\n`);
  process.stderr.write(`run it in a clone of the repository. To verify a DEPLOYED kit: ${kitCommand('doctor.mjs')}\n`);
  process.exit(2);
}

// Almost every test needs a scratch folder. When the temp folder cannot be used (a
// read-only TMPDIR, a TMPDIR naming a file) the run used to report hundreds of failures
// with one cause and never say it (found 2026-09-28: 541 x EACCES). Try it once, first,
// and name it at the top and again under a red summary. The run still happens, so the
// count and the result file stay honest.
const tempProblem = (() => {
  const base = tempBase();
  try {
    // Through the harness, which removes at exit whatever folder it had to create (and only that).
    createTempFolder(base);
    fs.rmSync(fs.mkdtempSync(path.join(base, 'fp-selftest-')), { recursive: true, force: true });
    return null;
  } catch (err) {
    return `the temp folder ${base} cannot be used (${err.code ?? err.message}), so every test that needs a scratch folder fails. `
      + 'Point TMPDIR (TEMP and TMP on Windows) at a folder this user can write, and run again.';
  }
})();
if (tempProblem) process.stderr.write(`\n${tempProblem}\n\n`);

// The suite describes the kit, not the machine it runs on (ADR-0123). A test that reads
// the operator's own settings - the machine config under ~/.agents, a deployed kit there,
// the Firecrawl CLI's login, FETCHPROOF_* variables, a vendor key - describes that
// machine, and this container's `transport: http-keyless` config hid, for weeks, that two
// cli tests go red on any host with the CLI installed and not logged in; a `strict`
// posture config turned 18 gate, preflight and cli tests red (found 2026-10-02,
// break-test). So the run gets a scratch home of its own and none of those variables.
// What stays is what describes the HOST or this RUN rather than the operator's setup: the
// result file and the unsupported opt-in (this runner's), the browser the operator pointed
// the kit at, the gate timeout, the live-test opt-ins, and the harness's own
// FETCHPROOF_TEST_* seams. If the scratch home cannot be made the temp problem above has
// already said why, and the real home stays.
const RUN_VARIABLES = new Set(['FETCHPROOF_RESULT_FILE', 'FETCHPROOF_ALLOW_UNSUP', 'FETCHPROOF_BROWSER', 'FETCHPROOF_GATE_TIMEOUT', 'FETCHPROOF_COLLECTION_ENV']);
const VENDOR_KEYS = new Set(['FIRECRAWL_API_KEY', 'SERPAPI_API_KEY', 'TAVILY_API_KEY']);
const describesTheRun = (name) => RUN_VARIABLES.has(name) || name.startsWith('FETCHPROOF_TEST_') || name.startsWith('FETCHPROOF_LIVE');
for (const name of Object.keys(process.env)) {
  if ((name.startsWith('FETCHPROOF_') && !describesTheRun(name)) || VENDOR_KEYS.has(name)) delete process.env[name];
}
if (!tempProblem) {
  // Through the harness's tempDir, so the run removes it with its other scratch when it ends.
  const home = tempDir('fp-selftest-home-');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  if (process.platform === 'win32') {
    process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
    process.env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
  }
}

/**
 * How much room the temp folder actually has, in words - `tempFreeSpace()` in core.mjs,
 * beside `tempBase()`, which owns the folder and already imports `node:os`.
 *
 * It was written here, and this file does not import `node:os`, so the ENOSPC branch it
 * was written for threw `ReferenceError: os is not defined` and took the red summary down
 * with it: a stack trace where the diagnosis belonged, on the one run that needed a
 * diagnosis (found 2026-09-29, break-test). See the note on the function itself.
 */

const started = Date.now();
// A file that throws while loading is a named FAIL, not the end of the run.
for (const { file, error } of await importTestFiles(dir, files)) {
  describe(file.replace(/\.test\.mjs$/, ''));
  test('the test file loads', () => {
    throw new Error(`${file} threw while it was imported, so none of its tests ran: ${error?.message ?? error}`);
  });
}

const { failures, failed, passed, unsupported, blocking: allBlocking, errorCodes } = await runPending();

// FETCHPROOF_ALLOW_UNSUP=1 (ADR-0108): a contributor without Python can get a green LOCAL
// run - unsupported tests are still listed, and the last line says the run was not a full
// pass. Only unsupported tests are waived, never a failure; and CI ignores the opt-in, so a
// missing interpreter there still blocks the merge.
const inCi = Boolean(process.env.CI) && process.env.CI !== 'false';
const optIn = process.env.FETCHPROOF_ALLOW_UNSUP === '1';
const waiveUnsupported = optIn && !inCi && failures === 0 && unsupported.length > 0;
const blocking = waiveUnsupported ? 0 : allBlocking;

/**
 * Write the result as DATA, when asked.
 *
 * CI used to scrape this program's stdout for `N passed, M failed`, which cannot tell a
 * failing suite from a suite that died before printing anything - a startup error, an
 * import-time throw, an OOM kill and a truncated log all render as "suite produced no
 * count". A reviewer then sees a generic message and has to go hunting for the real
 * diagnostic.
 *
 * Absence of this file is itself the signal: if the runner crashed before emission there
 * is nothing to read, which is distinguishable from a suite that ran and failed.
 */
function writeResultFile(code) {
  const target = process.env.FETCHPROOF_RESULT_FILE;
  if (!target) return;
  try {
    fs.writeFileSync(target, `${JSON.stringify({
      passed, failures, failed, unsupported: unsupported.length, unsupportedWaived: waiveUnsupported, blocking, exit: code,
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      files: files.length, node: process.versions.node, platform: process.platform,
    }, null, 2)}
`, 'utf8');
  } catch (err) {
    // A report that cannot be written must not fail the run it reports on - but it must
    // not be silent either.
    //
    // CI reads the ABSENCE of this file as "the runner crashed before reporting". If an
    // unwritable path (bad permissions, a full disk, a typo in the variable) produced the
    // same absence, CI would report a crash that did not happen, and the real cause -
    // which is right here - would be invisible. Saying so on stderr costs nothing and
    // makes the two indistinguishable cases distinguishable again.
    //
    // And a green run then exits 2 (2026-10-02, break-test): the report was asked for and
    // not delivered, and a step that exits 0 beside a summary reading "crashed before
    // reporting" is two statements that cannot both be true. A red run keeps its 1 - red is
    // the louder fact, and its cause is in the log either way.
    resultUnwritten = true;
    process.stderr.write(
      `FETCHPROOF_RESULT_FILE was set to ${JSON.stringify(target)} and could not be written: ${err.message}\n`
      + 'The suite result below is still authoritative; only the machine-readable copy is missing - and a green run exits 2 for it.\n');
  }
}
let resultUnwritten = false;

const seconds = ((Date.now() - started) / 1000).toFixed(1);

process.stdout.write(`\n${passed} passed, ${failures} failed${unsupported.length ? `, ${unsupported.length} unsupported` : ''} in ${seconds}s (watchdog ${TEST_TIMEOUT}ms/test)\n`);

if (unsupported.length) {
  // A host that cannot provide a required capability is not falsely green: the report
  // says exactly which capability, and why, and it blocks.
  process.stdout.write('\nThis host could not run:\n');
  for (const entry of unsupported) process.stdout.write(`  ${entry.code}  ${entry.label}\n    ${entry.reason}\n`);
  if (optIn && inCi) process.stdout.write('\nFETCHPROOF_ALLOW_UNSUP is ignored in CI: an unsupported test blocks there.\n');
  else if (!optIn) process.stdout.write('\nTo pass a LOCAL run anyway, set FETCHPROOF_ALLOW_UNSUP=1; CI still blocks.\n');
}
if (blocking) {
  writeResultFile(1);
  if (failures === 0) {
    // Every blocker is a test this host could not run. That is not a red suite, and the
    // runner must not call it one: "A red suite stops work" is the standing protocol's
    // stop-the-line sentence, and an agent that read it over "0 failed, 2 unsupported"
    // stopped a whole break-test at its baseline on a host with no Chromium (2026-10-02).
    // An incomplete run is still not a pass (ADR-0108), so the exit code stays 1.
    process.stdout.write(`\nNo test failed. ${unsupported.length} test${unsupported.length === 1 ? '' : 's'} could not run on this host, and an incomplete run is not a pass (ADR-0108) - this is not a red suite. `
      + 'For a local run here, set FETCHPROOF_ALLOW_UNSUP=1: every test that can run still runs, and CI still blocks. '
      + `cwd: ${process.cwd()} (started in ${invokedFrom})\n`);
    await exitAfterFlush(1);
  }
  process.stdout.write(`\nA red suite stops work. cwd: ${process.cwd()} (started in ${invokedFrom})\n`);
  if (tempProblem) process.stdout.write(`Likely cause: ${tempProblem}\n`);
  // 653 failures with one cause behind them is one broken machine, not 653 broken tests,
  // and a reader told only the count goes looking in 653 places (found 2026-09-29:
  // a 1 MiB TMPDIR, 646 of 653 failures ENOSPC, no cause named anywhere).
  const cause = dominantFailureCause({ failures, errorCodes });
  if (cause) {
    const percent = Math.round(cause.share * 100);
    process.stdout.write(`Likely single cause: ${cause.count} of ${failures} failures (${percent}%) open with ${cause.code}.\n`);
    process.stdout.write(`  ${cause.code === 'ENOSPC' || cause.code === 'EDQUOT' ? tempFreeSpace() : `one code behind most of a red suite points at one broken thing, not ${failures} broken tests.`}\n`);
  }
  await exitAfterFlush(1);
}

// The README states a test count in the present tense, and it has now gone stale TWICE:
// it said 326 when there were 565, and 565 when there were 582. No test could catch it,
// because the true number only exists here - after the run - and a test cannot count a
// suite it is part of without importing every file a second time.
//
// So the check lives where the number is. Only on a FULL run: a filtered run
// (`selftest.mjs gate hook`) legitimately produces a smaller count and must not rewrite
// the claim or fail against it.
if (!positional.length) {
  const readme = path.join(KIT_ROOT, 'README.md');
  try {
    const text = fs.readFileSync(readme, 'utf8');
    const claim = text.match(/^(\d[\d,]*) tests, offline/m);
    const actual = passed + unsupported.length;
    if (claim && Number(claim[1].replace(/,/g, '')) !== actual) {
      process.stdout.write(
        `\nfetchproof/README.md claims ${claim[1]} tests; this run has ${actual}.\n`
        + `A stale count is the first claim a reader checks, and the cheapest one to lose trust over.\n`
        + `Fix: change "${claim[1]} tests, offline" to "${actual} tests, offline" in fetchproof/README.md\n`);
      writeResultFile(1);
      await exitAfterFlush(1);
    }
  } catch { /* no README (a scaffolded or partial copy) - nothing to keep honest */ }
}

writeResultFile(0);
process.stdout.write(waiveUnsupported
  ? `NOT a full pass: every test that ran passed, and ${unsupported.length} could not run on this host (FETCHPROOF_ALLOW_UNSUP=1)\n`
  : 'all tests passed\n');
await exitAfterFlush(resultUnwritten ? 2 : 0);
