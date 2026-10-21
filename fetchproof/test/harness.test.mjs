// The runner's own test, in child processes: the false green must not come back
// unnoticed (ADR-0021).
//
// The old runner was synchronous. A fixture holding one FAILING async test printed `ok`,
// then `all tests passed`, then exited 0. That is the defect these tests pin, with the
// old runner standing beside the new one so the difference is demonstrated, not asserted
// from memory.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test, describe, assert, tempDir, fs, path, KIT_ROOT, importTestFiles, LEAKED_GIT_CONTEXT, stripLeakedGitContext, findPython, requirePython, errorCodeOf, dominantFailureCause, requireGit, fixtureInitArgs } from './harness.mjs';

describe('harness');

const HARNESS = pathToFileURL(path.join(KIT_ROOT, 'test', 'harness.mjs')).href;

// `env` is merged over this process's own, so a probe can be run under a hostile
// environment (a TMPDIR pointing into the checkout) without losing PATH or HOME.
function runChild(source, env = null) {
  const dir = tempDir('fetchproof-harness-');
  const file = path.join(dir, 'child.mjs');
  fs.writeFileSync(file, source, 'utf8');
  const result = spawnSync(process.execPath, [file], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The runner as it used to be: synchronous, catching only a synchronous throw. */
const OLD_RUNNER = `
function runPendingSync(pending, log) {
  let failures = 0;
  for (const entry of pending) {
    try { entry.fn(); log('ok    ' + entry.name); }
    catch (err) { failures += 1; log('FAIL  ' + entry.name); }
  }
  return failures;
}
`;

test('the OLD runner prints ok for a failing async test and exits 0 - the defect', () => {
  const child = runChild(`${OLD_RUNNER}
const pending = [{ name: 'an async test that fails', fn: async () => { throw new Error('boom'); } }];
const failures = runPendingSync(pending, (l) => console.log(l));
console.log(failures ? 'red' : 'all tests passed');
process.exit(0);
`);
  assert.equal(child.status, 0);
  assert.match(child.stdout, /ok {4}an async test that fails/);
  assert.match(child.stdout, /all tests passed/);
});

test('the CURRENT runner awaits it, reports FAIL, and returns a non-zero count', () => {
  const child = runChild(`
import { test, runPending } from ${JSON.stringify(HARNESS)};
test('an async test that fails', async () => { throw new Error('boom'); });
const { failures, failed } = await runPending({ log: (l) => console.log(l) });
console.log('failures=' + failures);
console.log('failed=' + JSON.stringify(failed));
process.exit(failures ? 1 : 0);
`);
  assert.match(child.stdout, /FAIL {2}an async test that fails/);
  assert.match(child.stdout, /failures=1/);
  // The NAMES, not only the count (break-test pass 5, 2026-10-04): a count cannot show one
  // test starting to fail while another starts to pass, and the result file CI publishes
  // carried only the count.
  assert.match(child.stdout, /failed=\["an async test that fails"\]/);
  assert.equal(child.status, 1, 'a red suite must exit non-zero');
});

test('an async assertion that fails after a tick is still caught', () => {
  const child = runChild(`
import { test, runPending, assert } from ${JSON.stringify(HARNESS)};
test('settles late, then fails', async () => {
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(1, 2);
});
const { failures } = await runPending({ log: (l) => console.log(l) });
process.exit(failures ? 1 : 0);
`);
  assert.equal(child.status, 1);
  assert.match(child.stdout, /FAIL {2}settles late, then fails/);
});

test('a test that never settles is killed by the watchdog and attributed', () => {
  const child = runChild(`
process.env.FETCHPROOF_TEST_TIMEOUT = '300';
const { test, runPending } = await import(${JSON.stringify(HARNESS)});
test('never settles', () => new Promise(() => {}));
const { failures } = await runPending({ log: (l) => console.log(l) });
console.log('failures=' + failures);
process.exit(failures ? 1 : 0);
`);
  assert.equal(child.status, 1, 'a hung test must not hang the suite printing nothing');
  assert.match(child.stdout, /FAIL {2}never settles/);
  assert.match(child.stdout, /timed out/);
});

test("a timed-out test's late rejection cannot crash the runner afterwards", () => {
  const child = runChild(`
process.env.FETCHPROOF_TEST_TIMEOUT = '150';
const { test, runPending } = await import(${JSON.stringify(HARNESS)});
test('rejects long after it was judged', () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 400)));
test('a healthy test after it', () => {});
const { failures, passed } = await runPending({ log: (l) => console.log(l) });
await new Promise((r) => setTimeout(r, 500));
console.log('survived failures=' + failures + ' passed=' + passed);
process.exit(0);
`);
  assert.match(child.stdout, /survived failures=1 passed=1/);
  assert.equal(child.status, 0);
});

test('a passing suite still passes, and the count is earned', () => {
  const child = runChild(`
import { test, runPending, assert } from ${JSON.stringify(HARNESS)};
test('sync', () => assert.equal(1, 1));
test('async', async () => { await new Promise((r) => setTimeout(r, 10)); assert.equal(2, 2); });
const { failures, passed } = await runPending({ log: () => {} });
console.log('passed=' + passed + ' failures=' + failures);
process.exit(failures ? 1 : 0);
`);
  assert.equal(child.status, 0);
  assert.match(child.stdout, /passed=2 failures=0/);
});

// Found 2026-09-28 (gap sweep): a test file that throws while it is being imported - an
// unwritable TMPDIR, a missing fixture, a read at module scope - aborted the whole RUNNER,
// so no test ran, no count printed, and CI saw "crashed before reporting". The loader now
// returns the failure, and the runner reports it as a named FAIL and runs everything else.
test('a test file that throws at import is returned as broken, not thrown', async () => {
  const dir = tempDir('fp-import-');
  fs.writeFileSync(path.join(dir, 'fine.test.mjs'), 'export const loaded = true;\n');
  fs.writeFileSync(path.join(dir, 'boom.test.mjs'), "throw new Error('boom at import');\n");
  const broken = await importTestFiles(dir, ['boom.test.mjs', 'fine.test.mjs']);
  assert.deepEqual(broken.map((b) => b.file), ['boom.test.mjs']);
  assert.match(broken[0].error.message, /boom at import/);
});

// Found 2026-09-28 (break-test): with GIT_DIR and GIT_WORK_TREE exported - a wrapper that
// saved `git rev-parse --git-dir` once, a hook that runs the tests - every scratch
// repository the suite built was bypassed and the fixture commits landed in the
// repository the variables named instead: a "the corpus" commit appeared on the host
// repository's own branch, carrying its __pycache__. The harness now strips the leaked
// git context from its process before any test runs; this pins the list, so a future
// variable cannot be added to git and quietly miss the sweep.
test('the suite strips a leaked git context, and only that', () => {
  const env = {
    PATH: '/usr/bin',
    GIT_DIR: '/elsewhere/.git',
    GIT_WORK_TREE: '/elsewhere',
    GIT_INDEX_FILE: '/elsewhere/index',
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/elsewhere'",
    UNRELATED: 'kept',
  };
  const removed = stripLeakedGitContext(env);
  assert.deepEqual(removed.sort(),
    ['GIT_CONFIG_PARAMETERS', 'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'],
    'a variable in the list but absent from the environment must not be reported');
  for (const name of LEAKED_GIT_CONTEXT) {
    assert.equal(name in env, false, `${name} survived the strip`);
  }
  assert.equal(env.UNRELATED, 'kept', 'the strip touches nothing but git context');
  assert.equal(env.PATH, '/usr/bin', 'the strip touches nothing but git context');

  // The module already applied itself to the real process this run is part of, so a
  // leaked context cannot survive into any git child the suite spawns.
  for (const name of LEAKED_GIT_CONTEXT) {
    assert.equal(name in process.env, false,
      `${name} is still in this process's environment: the strip at module scope did not run`);
  }
});

// Found 2026-09-28 (break-test): a full run made ~1,400 scratch directories - about
// 100 MB - and removed almost none, so /tmp grew without bound on a machine that runs
// the suite (and where /tmp is tmpfs, the growth is RAM). The harness now removes
// exactly the directories its own process created, on exit, whatever the exit was.
test('a run takes its scratch with it when it ends', () => {
  const child = runChild(`
import { tempDir, fs } from ${JSON.stringify(HARNESS)};
const dir = tempDir('fp-leakprobe-');
fs.writeFileSync(dir + '/proof.txt', 'scratch');
console.log(dir);
`);
  assert.equal(child.status, 0, `the probe child failed:\n${child.stderr}`);
  // Any absolute path: a Windows temp dir is C:\...\fp-leakprobe-*, often in 8.3 short form,
  // and console.log ends its line with CRLF there.
  const dir = child.stdout.trim().split(/\r?\n/).pop();
  assert.ok(path.isAbsolute(dir) && dir.includes('fp-leakprobe-'), `the probe child did not report its scratch dir: ${child.stdout}`);
  assert.equal(fs.existsSync(dir), false,
    `the scratch dir ${dir} outlived the process that made it - every run leaks its scratch`);
});

// Found 2026-09-29 (break-test). A TMPDIR that resolves INSIDE the checkout - `TMPDIR=.`
// is the plainest spelling - put the suite's scratch in the tree the suite JUDGES, and
// `doctor`'s own secret scan then reported the credential-shaped fixtures every test
// writes: F26 went red on a machine that had merely exported an unusual temp folder. The
// suite's scratch cannot live in the thing being judged, so it moves to the platform
// default and says so.
test('scratch never lands inside the checkout, whatever TMPDIR points at', () => {
  const repoRoot = path.resolve(KIT_ROOT, '..');
  const child = runChild(`
import { tempDir, fs } from ${JSON.stringify(HARNESS)};
const dir = tempDir('fp-inside-probe-');
fs.writeFileSync(dir + '/proof.txt', 'scratch');
console.log(dir);
`, { TMPDIR: repoRoot, TEMP: repoRoot, TMP: repoRoot });

  assert.equal(child.status, 0, `the probe child failed:\n${child.stderr}`);
  const dir = child.stdout.trim().split(/\r?\n/).pop();
  assert.ok(path.isAbsolute(dir) && dir.includes('fp-inside-probe-'), `the probe child did not report its scratch dir: ${child.stdout}`);
  // Not realpath'd: the child takes its scratch with it when it ends, so the directory is
  // already gone by now. mkdtemp hands back an absolute path with no symlink in it, and the
  // question is only whether it sits under the checkout.
  const rel = path.relative(repoRoot, dir);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  assert.equal(inside, false, `scratch went to ${dir}, inside the checkout the suite judges`);
  assert.match(child.stderr, /inside this checkout/, 'the move was silent, so nobody learns why their TMPDIR was not used');
});

// Found 2026-10-04 (break-test pass 4, F3). A TMPDIR naming a folder that does not exist yet
// is created on purpose - a CI job exports RUNNER_TEMP before creating it, and mkdtemp at
// module scope would otherwise abort the runner - and the run left the folder behind, empty:
// `TMPDIR=/nonexistent/dir/xyz` left /nonexistent/dir/xyz, and a relative TMPDIR an empty
// folder inside the checkout. What the run created is the run's to remove, and only that:
// a folder that existed before is never touched, and one something else used meanwhile stays.
test('a temp folder the run had to create goes with its scratch, and only while empty', () => {
  const outside = tempDir('fp-created-base-');
  const asked = path.join(outside, 'missing', 'deeper');
  const env = { TMPDIR: asked, TEMP: asked, TMP: asked };
  const probe = (extra) => runChild(`
import { tempDir, fs, path } from ${JSON.stringify(HARNESS)};
const dir = tempDir('fp-created-probe-');
fs.writeFileSync(path.join(dir, 'proof.txt'), 'scratch');
${extra}
console.log(path.dirname(dir));
`, env);

  let child = probe('');
  assert.equal(child.status, 0, `the probe child failed:\n${child.stderr}`);
  const used = path.resolve(child.stdout.trim().split(/\r?\n/).pop());
  assert.equal(used, path.resolve(asked), 'the probe did not use the folder it was given');
  assert.equal(fs.existsSync(path.join(outside, 'missing')), false, 'the run left the folder it created');
  assert.ok(fs.existsSync(outside), 'a folder that existed before the run is not the run\'s to remove');

  // Something else put a file in the created folder meanwhile: the folder stays, with it.
  child = probe(`fs.writeFileSync(path.join(path.dirname(dir), 'somebody-elses.txt'), 'kept');`);
  assert.equal(child.status, 0, `the probe child failed:\n${child.stderr}`);
  assert.equal(fs.readFileSync(path.join(asked, 'somebody-elses.txt'), 'utf8'), 'kept', 'a folder holding somebody else\'s file was removed');
});

// Found 2026-10-04 by an external review of the fix above: the folders were recorded as
// created BEFORE the mkdir, from an existence check, so a process that created the same
// missing chain in between was never seen - this run made nothing, recorded everything, and
// removed the other process's empty folder at exit. A non-recursive rmdir protects contents,
// not ownership. Ownership is the mkdir that succeeded, so that is what gets recorded.
test('a folder another process created between the check and the mkdir is not this run\'s to remove', () => {
  const outside = tempDir('fp-raced-base-');
  const asked = path.join(outside, 'missing', 'deeper');
  const child = runChild(`
import { createTempFolder, fs } from ${JSON.stringify(HARNESS)};
// The other process wins the race: the folder exists by the time this run's mkdir runs.
createTempFolder(${JSON.stringify(asked)}, { mkdir: (p) => { fs.mkdirSync(p); fs.mkdirSync(p); } });
console.log('made');
`);
  assert.equal(child.status, 0, `the probe child failed:\n${child.stderr}`);
  assert.ok(fs.existsSync(asked), 'the run removed a folder another process created');
});

// Found 2026-10-04 by the second external review: a mkdir that failed part-way (ENOSPC on
// the third of three missing ancestors) threw before the deepest-first sort ran, so the two
// folders already recorded were tried shallowest first - the parent refused while its child
// stood, the child went, and the parent was left behind, empty.
test('ancestors created before a mkdir failed part-way are still removed, deepest first', () => {
  const outside = tempDir('fp-partial-base-');
  const asked = path.join(outside, 'one', 'two', 'three');
  const child = runChild(`
import { createTempFolder, fs } from ${JSON.stringify(HARNESS)};
try {
  createTempFolder(${JSON.stringify(asked)}, { mkdir: (p) => {
    if (p.endsWith('three')) { const err = new Error('no room'); err.code = 'ENOSPC'; throw err; }
    fs.mkdirSync(p);
  } });
} catch (err) { console.log('threw ' + err.code); }
`);
  assert.equal(child.status, 0, `the probe child failed:\n${child.stderr}`);
  assert.match(child.stdout, /threw ENOSPC/, 'the failure still reaches the caller');
  assert.equal(fs.existsSync(path.join(outside, 'one')), false, 'the run left an ancestor it created');
});

// Found 2026-09-28 (Arena break test 7): findPython took the first of `python`, `python3`
// that answered --version, and never read the version. On the most common Linux and older
// macOS layout - `python` an alias for 2.7 or 3.8, `python3` the real one - every
// cross-language test ran the old interpreter and failed with its syntax errors, although
// lib/runtime.mjs checkPython, which the kit itself uses, would have picked python3.
test('findPython picks the interpreter checkPython would, and none too old', () => {
  const hosts = (versions) => (exe) => (versions[exe]
    ? { status: 0, stdout: exe === 'python' && versions[exe].startsWith('2.') ? '' : `Python ${versions[exe]}\n`,
      stderr: versions[exe].startsWith('2.') ? `Python ${versions[exe]}\n` : '' }
    : { error: Object.assign(new Error(`spawn ${exe} ENOENT`), { code: 'ENOENT' }) });
  assert.equal(findPython({ run: hosts({ python: '2.7.18', python3: '3.12.1' }) }), 'python3');
  assert.equal(findPython({ run: hosts({ python: '3.8.10', python3: '3.12.1' }) }), 'python3');
  assert.equal(findPython({ run: hosts({ python: '3.12.1' }) }), 'python', 'a Windows host has only `python`');
  assert.equal(findPython({ run: hosts({ python: '3.8.10' }) }), null, 'an interpreter too old for the runners was chosen');
  assert.equal(findPython({ run: hosts({}) }), null);
});

// Found 2026-10-04 (break-test pass 4, F2): a host whose python3 is 3.8, or a stub that exits
// 1, was reported as "no python or python3 on this host" - the one message, whatever
// checkPython had actually found. The operator on Ubuntu 20.04 reads "no python" with a
// python3 on PATH and looks in the wrong place; the detail checkPython already composes
// names the interpreter and the floor.
test('requirePython names the interpreter it rejected, not only its absence', () => {
  const hosts = (versions) => (exe) => (versions[exe]
    ? { status: 0, stdout: `Python ${versions[exe]}\n`, stderr: '' }
    : { error: Object.assign(new Error(`spawn ${exe} ENOENT`), { code: 'ENOENT' }) });
  assert.equal(requirePython('the probe', { run: hosts({ python3: '3.12.1' }) }), 'python3', 'a usable interpreter is returned as before');
  assert.throws(() => requirePython('the probe', { run: hosts({ python3: '3.8.10' }) }),
    (err) => err.name === 'Unsupported' && err.code === 'PYTHON-NOT-FOUND' && /python3 3\.8\.10; the conformance runners need 3\.11\+/.test(err.reason) && /the probe cannot be checked/.test(err.reason));
  assert.throws(() => requirePython('the probe', { run: hosts({}) }),
    (err) => err.name === 'Unsupported' && /no python on PATH/.test(err.reason));
});

// Found 2026-09-29 (break-test): with TMPDIR on a 1 MiB volume - a full disk, a small
// tmpfs, a CI runner that ran out of space - the suite printed `585 passed, 653 failed`,
// 646 of those failures `ENOSPC: no space left on device`, and NOTHING named the cause.
// stderr was empty and the runner's own temp probe passed, because that probe only
// creates and removes an EMPTY directory, which fits in no room at all. This is the same
// defect the read-only-TMPDIR fix closed on 2026-09-28 (541 x EACCES, one cause, never
// stated), reached by capacity rather than by permission. The runner now tallies the
// error code each failure opens with, so a red suite can say which machine is broken.
test('failures are tallied by the error code they open with, and nothing else is', () => {
  const child = runChild(`
import { test, runPending } from ${JSON.stringify(HARNESS)};
test('the disk is full', () => { throw new Error('ENOSPC: no space left on device, write'); });
test('still full', () => { throw new Error('ENOSPC: no space left on device, write'); });
test('a genuine assertion', () => { throw new Error('expected 1 to equal 2'); });
const { failures, errorCodes } = await runPending({ log: () => {} });
console.log(JSON.stringify({ failures, errorCodes }));
process.exit(1);
`);
  const out = JSON.parse(child.stdout.trim().split(/\r?\n/).pop());
  assert.equal(out.failures, 3, 'all three failures still count, whatever their shape');
  assert.deepEqual(out.errorCodes, [{ code: 'ENOSPC', count: 2 }],
    'a failure with no error code must not be invented one');
});

test('errorCodeOf reads the code a libuv message opens with, and nothing else', () => {
  assert.equal(errorCodeOf(new Error('ENOSPC: no space left on device, write')), 'ENOSPC');
  assert.equal(errorCodeOf(new Error("EACCES: permission denied, mkdir '/tmp/x'")), 'EACCES');
  assert.equal(errorCodeOf(new Error('expected 1 to equal 2')), null, 'an assertion is prose, not a code');
  assert.equal(errorCodeOf(new Error('test timed out after 60000ms')), null, 'the watchdog message is not a code');
  assert.equal(errorCodeOf(new Error('')), null);
  assert.equal(errorCodeOf(null), null, 'a failure with no error at all must not throw here');
});

test('one code behind most of a red suite is named; a minority of one is not', () => {
  // The measured case: a 1 MiB TMPDIR, 646 of 653 failures ENOSPC.
  assert.deepEqual(
    dominantFailureCause({ failures: 653, errorCodes: [{ code: 'ENOSPC', count: 646 }] }),
    { code: 'ENOSPC', count: 646, share: 646 / 653 });
  assert.equal(dominantFailureCause({ failures: 653, errorCodes: [{ code: 'ENOSPC', count: 3 }] }), null,
    'three of 653 is not one cause, and saying so would send the reader to the wrong place');
  assert.equal(dominantFailureCause({ failures: 2, errorCodes: [{ code: 'ENOSPC', count: 2 }] }), null,
    'two failures are not a pattern');
  assert.equal(dominantFailureCause({ failures: 0, errorCodes: [] }), null);
  assert.equal(dominantFailureCause({}), null, 'an absent tally must not throw');
  // Unsorted input is answered by the largest code, not whichever arrived first.
  assert.equal(dominantFailureCause({
    failures: 10,
    errorCodes: [{ code: 'EACCES', count: 2 }, { code: 'ENOSPC', count: 8 }],
  }).code, 'ENOSPC');
});

// Found 2026-09-29 (Arena break test): scratch cleanup ran on 'exit' only, and 'exit' does not
// run when the process is killed by a signal - one Ctrl-C left 110 scratch directories behind.
test('a run stopped by SIGTERM or SIGINT still removes its scratch, and exits 128+signal', async () => {
  if (process.platform === 'win32') return; // Windows has no catchable SIGTERM: kill() is TerminateProcess
  const { spawn } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const harnessUrl = pathToFileURL(path.join(KIT_ROOT, 'test', 'harness.mjs')).href;
  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      `const h = await import(${JSON.stringify(harnessUrl)}); console.log(h.tempDir('fp-signal-')); setInterval(() => {}, 1000);`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const dir = await new Promise((resolveDir, reject) => {
      child.stdout.on('data', (d) => { out += d; if (out.includes('\n')) resolveDir(out.trim()); });
      child.on('exit', () => reject(new Error(`child exited before printing its scratch dir: ${out}`)));
    });
    assert.ok(fs.existsSync(dir), `the child did not create ${dir}`);
    const exited = new Promise((r) => child.on('exit', (status, sig) => r({ status, sig })));
    child.kill(signal);
    const { status, sig } = await exited;
    assert.equal(fs.existsSync(dir), false, `${signal} left ${dir} behind`);
    assert.equal(status, code, `${signal}: exit ${status} (signal ${sig}), expected ${code}`);
  }
});

// A host whose global git config names an `init.templateDir` (what `pre-commit
// init-templatedir` writes) hands every `git init` the template's hooks. The kit's hook
// hands on to the repository's own (ADR-0112), so a fixture carrying the host's failing
// pre-commit reported seven allowed commits as refused (found 2026-10-02, break-test).
test('a fixture repository is initialised without the host\'s init.templateDir', () => {
  requireGit('initialising a fixture repository under a hostile global config');
  const template = tempDir('fp-template-');
  fs.mkdirSync(path.join(template, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(template, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
  const home = tempDir('fp-template-home-');
  const cfg = path.join(home, 'gitconfig');
  fs.writeFileSync(cfg, `[init]\n\ttemplateDir = ${template.replace(/\\/g, '/')}\n`);
  const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  stripLeakedGitContext(env);   // mutates in place; returns the names it removed

  // The probe: a plain init on this host copies the template's hook.
  const plain = tempDir('fp-template-plain-');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: plain, env }).status, 0);
  assert.equal(fs.existsSync(path.join(plain, '.git', 'hooks', 'pre-commit')), true, 'the probe did not reproduce: git init ignored init.templateDir');

  const fixture = tempDir('fp-template-fixture-');
  const r = spawnSync('git', fixtureInitArgs(), { cwd: fixture, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(fixture, '.git', 'HEAD')), true, 'the fixture was not initialised');
  assert.equal(fs.existsSync(path.join(fixture, '.git', 'hooks', 'pre-commit')), false, 'the fixture repository carries the host\'s template hook');
});

// Found 2026-10-02 (outside review, on a Windows machine without Developer Mode): a file
// symlink needs a privilege there, and six tests made one with `fs.symlinkSync` unguarded,
// so the collect group went red with EPERM on a host where the code under test never ran.
// The privilege is a host prerequisite like Python (ADR-0108): `requireSymlink` reports it
// as UNSUP with the reason, and the runner counts it apart from a failure. The seam
// `FETCHPROOF_TEST_NO_SYMLINK=1` reproduces the refusal on every platform.
test('requireSymlink reports a refused file symlink as UNSUP, not as a failed test', () => {
  const source = `
    import { test, runPending, requireSymlink, tempDir, fs, path } from ${JSON.stringify(HARNESS)};
    const dir = tempDir('fp-symlink-');
    fs.writeFileSync(path.join(dir, 'real.txt'), 'x');
    test('links a file', () => { requireSymlink(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'), 'the link case'); });
    const r = await runPending();
    console.log(JSON.stringify({ failures: r.failures, passed: r.passed, unsupported: r.unsupported }));
  `;
  const refused = runChild(source, { FETCHPROOF_TEST_NO_SYMLINK: '1' });
  assert.equal(refused.status, 0, refused.stderr);
  const seen = JSON.parse(refused.stdout.trim().split('\n').pop());
  assert.equal(seen.failures, 0, 'a refused symlink was counted as a failure');
  assert.equal(seen.passed, 0, 'a refused symlink passed having asserted nothing');
  assert.equal(seen.unsupported.length, 1);
  assert.equal(seen.unsupported[0].code, 'SYMLINK-NOT-PERMITTED');
  assert.match(seen.unsupported[0].reason, /Developer Mode/);
  assert.match(seen.unsupported[0].reason, /the link case cannot be checked/);
  assert.match(refused.stdout, /^UNSUP .*links a file/m);

  // Without the seam the link is made where the host allows it, and the host that refuses
  // reports the same UNSUP from the real EPERM.
  const allowed = runChild(source, { FETCHPROOF_TEST_NO_SYMLINK: '' });
  assert.equal(allowed.status, 0, allowed.stderr);
  const real = JSON.parse(allowed.stdout.trim().split('\n').pop());
  assert.equal(real.failures, 0, 'a real file symlink was a failure');
  assert.ok((real.passed === 1 && real.unsupported.length === 0) || (real.passed === 0 && real.unsupported[0]?.code === 'SYMLINK-NOT-PERMITTED'),
    `expected one pass or one SYMLINK-NOT-PERMITTED: ${JSON.stringify(real)}`);
});
