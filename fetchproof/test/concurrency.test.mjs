// F14, F13 and F12's residual — the collection critical section, and the lease that
// decides who holds it (ADR-0025).

import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { test, describe, assert, makeProject, makePassingProject, tempDir, cleanup, fs, path, KIT_ROOT } from './harness.mjs';
import { PATHS, resolve, readText, writeText } from '../lib/core.mjs';
import { readCorpus, readLedger } from '../lib/corpus.mjs';
import { repairLedgerTail } from '../lib/provenance.mjs';
import { withLock, holdsLock, appendFetch, verifyLedger, lockRecoverable } from '../lib/provenance.mjs';
import { collectOne } from '../lib/collect.mjs';

describe('concurrency');

const PAGE = 'A documented limit of 10 requests per minute applies to the free plan. '.repeat(20);
const adapter = (url) => ({ ok: true, url, title: 'T', markdown: PAGE, statusCode: 200, transport: 'stub', completeness: 'full', cmd: 'stub' });

// --- F14: the whole durable operation is inside one boundary -----------------------

test('F14: collectOne holds the exclusive section across the ENTIRE operation', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  let heldDuringFetch = false;

  collectOne(dir, 'https://x.invalid/a', {
    corpus,
    runScrape: (url) => {
      // The adapter call is the slow part. If the section is not held here, another
      // collector can pick the same filename and the same E-## while we are away.
      heldDuringFetch = holdsLock(dir);
      return adapter(url);
    },
  });

  assert.equal(heldDuringFetch, true, 'a ledger-only lock leaves the capture write and the row updates racing');
  assert.equal(holdsLock(dir), false, 'and it is released afterwards');
});

test('F14: the cache is re-read INSIDE the section, so a queued URL is not paid for twice', () => {
  const dir = makeProject();
  // One collector finishes while another holds a corpus snapshot from before it did.
  const first = readCorpus(dir);
  const second = readCorpus(dir);
  collectOne(dir, 'https://x.invalid/a', { corpus: first, runScrape: adapter });

  let fetched = 0;
  const outcome = collectOne(dir, 'https://x.invalid/a', {
    corpus: second, // stale: it was read before the first collection existed
    runScrape: (url) => { fetched += 1; return adapter(url); },
  });

  assert.equal(outcome.status, 'cached', 'the decision must be made from disk, under the lock');
  assert.equal(fetched, 0, 'every re-fetch here is a credit spent on a page already collected');
});

test('F14: ids are allocated from the table on disk, so two collectors cannot collide', () => {
  const dir = makeProject();
  const stale = readCorpus(dir);
  collectOne(dir, 'https://x.invalid/a', { corpus: readCorpus(dir), runScrape: adapter });
  collectOne(dir, 'https://x.invalid/b', { corpus: stale, runScrape: adapter });

  const ids = readCorpus(dir).evidence.map((row) => row.id);
  assert.deepEqual(ids, ['E-01', 'E-02'], 'a duplicated E-## silently changes what every citation to it means');
  assert.equal(new Set(ids).size, ids.length);
});

test('F14: a dry run takes no lock at all - it decides and writes nothing', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  collectOne(dir, 'https://x.invalid/a', { corpus, runScrape: adapter, dryRun: true });
  assert.equal(fs.existsSync(resolve(dir, PATHS.lock)), false);
});

// Rewritten 2026-09-28 (Arena break test 8): this ran its two children with spawnSync, one
// AFTER the other, so they never competed for the lock and the test passed with the lock
// removed. Now both start together behind a barrier file, each reports when it asked for
// the section and when it held it, and the test asserts they really overlapped in time
// while never overlapping inside the section.
test('F14: two collectors in separate PROCESSES serialise, and neither loses its row', async () => {
  const dir = makeProject();
  const scratch = tempDir('fetchproof-conc-');
  const go = path.join(scratch, 'go');
  const child = (name) => `
import fs from 'node:fs';
import { readCorpus } from ${JSON.stringify(pathToFileURL(path.join(KIT_ROOT, 'lib', 'corpus.mjs')).href)};
import { collectOne } from ${JSON.stringify(pathToFileURL(path.join(KIT_ROOT, 'lib', 'collect.mjs')).href)};
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
fs.writeFileSync(${JSON.stringify(path.join(scratch, name + '.ready'))}, '');
while (!fs.existsSync(${JSON.stringify(go)})) nap(5);
const times = { asked: Date.now() };
collectOne(${JSON.stringify(dir)}, ${JSON.stringify('https://x.invalid/' + name)}, {
  corpus: readCorpus(${JSON.stringify(dir)}),
  runScrape: (u) => {
    times.entered = Date.now();
    nap(400); // hold the section long enough that the other process must wait for it
    times.left = Date.now();
    return { ok: true, url: u, title: 'T', markdown: ${JSON.stringify(PAGE)}, statusCode: 200, transport: 'stub', completeness: 'full', cmd: 'stub' };
  },
});
process.stdout.write(JSON.stringify(times));
`;
  const names = ['a', 'b'];
  const exits = names.map((name) => {
    const file = path.join(scratch, `${name}.mjs`);
    writeText(file, child(name));
    const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    return new Promise((done) => proc.on('close', (status) => done({ status, out, err })));
  });
  const deadline = Date.now() + 30_000;
  while (!names.every((name) => fs.existsSync(path.join(scratch, `${name}.ready`)))) {
    assert.ok(Date.now() < deadline, 'the children never reached the start barrier');
    await new Promise((r) => setTimeout(r, 10));
  }
  fs.writeFileSync(go, '');
  const results = await Promise.all(exits);
  for (const result of results) assert.equal(result.status, 0, result.err);
  const [first, second] = results.map((r) => JSON.parse(r.out)).sort((x, y) => x.entered - y.entered);

  assert.ok(second.asked < first.left,
    'the second collector asked only after the first had finished - they never competed, and this test proves nothing');
  assert.ok(second.entered >= first.left, 'both were inside the section at once');
  const after = readCorpus(dir);
  assert.equal(after.evidence.length, 2, 'both rows survived - neither read-modify-write clobbered the other');
  assert.deepEqual(after.evidence.map((r) => r.id).sort(), ['E-01', 'E-02']);
  assert.equal(after.captures.entries.length, 2);
  assert.equal(verifyLedger(dir).ok, true, 'and the chain still verifies');
});

// --- F13: a lease, not an age -----------------------------------------------------

test('F13: a LIVE holder is never recoverable, however old its lock is', () => {
  const dir = makeProject();
  const lock = resolve(dir, PATHS.lock);
  const holder = { pid: process.pid, host: os.hostname(), nonce: 'mine', at: new Date().toISOString() };
  writeText(lock, JSON.stringify(holder));

  // Backdate it far past any bound a lease would have used. A run that takes an hour is
  // a long run, not a crash, and evicting it is how two collectors end up interleaved.
  const ancient = new Date(Date.now() - 6 * 60 * 60_000);
  fs.utimesSync(lock, ancient, ancient);

  const verdict = lockRecoverable(lock, holder);
  assert.equal(verdict.recoverable, false, 'the holder still exists - age says nothing about that');
  assert.match(verdict.why, /is alive/);
  fs.rmSync(lock);
});

test('F13: the section is held for the WHOLE of a slow call, with no heartbeat to miss', () => {
  const dir = makeProject();
  const lock = resolve(dir, PATHS.lock);
  withLock(dir, () => {
    // The collector is synchronous, so the event loop is blocked here. A renewal timer
    // could not fire during exactly this stretch - which is why liveness, not renewal,
    // is what decides.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    assert.equal(fs.existsSync(lock), true);
    assert.equal(lockRecoverable(lock, JSON.parse(readText(lock))).recoverable, false);
  });
  assert.equal(fs.existsSync(lock), false);
});

test('F13: a holder on another host is waited for, not broken - we cannot ask about it', () => {
  const dir = makeProject();
  const lock = resolve(dir, PATHS.lock);
  const foreign = { pid: 1234, host: 'some-other-box', nonce: 'theirs', at: new Date().toISOString() };
  writeText(lock, JSON.stringify(foreign));

  assert.equal(lockRecoverable(lock, foreign).recoverable, false, 'a pid on another machine means nothing here');

  const old = new Date(Date.now() - 30 * 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal(lockRecoverable(lock, foreign).recoverable, true, 'but it cannot hold the section forever either');
  fs.rmSync(lock);
});

test('F13: a lock whose process is gone is recovered, not waited on', () => {
  const dir = makeProject();
  const lock = resolve(dir, PATHS.lock);
  // A holder that crashed: a plausible file naming a pid that does not exist.
  writeText(lock, JSON.stringify({ pid: 999_999, host: os.hostname(), nonce: 'dead', at: new Date().toISOString() }));

  let entered = false;
  withLock(dir, () => { entered = true; });
  assert.equal(entered, true, 'age alone would have made this wait out the full timeout');
});

test('F13: an UNIDENTIFIABLE holder reaches the staleness test instead of blocking forever', () => {
  const dir = makeProject();
  const lock = resolve(dir, PATHS.lock);
  writeText(lock, ''); // the window between create and write, or a crash that left a stub
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);

  let entered = false;
  withLock(dir, () => { entered = true; });
  assert.equal(entered, true, 'the branch that could not read a pid used to skip the age check entirely');
});

test('F13: release removes only this acquisition', () => {
  const dir = makeProject();
  const lock = resolve(dir, PATHS.lock);
  withLock(dir, () => {
    // Somebody else's lock replaced ours mid-section (the pathological case).
    writeText(lock, JSON.stringify({ pid: process.pid, host: 'elsewhere', nonce: 'theirs', at: new Date().toISOString() }));
  });
  assert.equal(fs.existsSync(lock), true, "a release must not delete a lock it does not hold");
  fs.rmSync(lock);
});

// --- F12 residual: never append onto a damaged chain -------------------------------

test('F12: appendFetch REFUSES a torn tail instead of welding a valid entry to it', () => {
  const dir = makePassingProject();
  const file = resolve(dir, PATHS.ledger);
  writeText(file, `${readText(file)}{"seq":2,"at":"2026-01-0`);

  assert.throws(
    () => appendFetch(dir, { op: 'scrape', url: 'https://x.invalid/paid-for' }),
    (err) => err.code === 'LEDGER_TORN_TAIL' || err.code === 'LEDGER_DAMAGED',
    'appending here makes the torn line unrecoverable and loses the fetch it recorded',
  );
  assert.doesNotMatch(readText(file), /paid-for/, 'nothing was written');
});

// ADR-0122 (2026-10-02, arena break-test #198, F-1-2): the two refusals above cover a ledger
// that does not PARSE. A ledger that parses and whose hashes no longer link - an entry edited
// after the fact, a line dropped, a prev that points nowhere - was appended to without a
// word, so the collector spent credits on fetches that handoff and preflight then refused as
// chain-broken. The chain is tamper-evidence; appending onto a broken one records a paid-for
// fetch nobody can vouch for.
test('appendFetch refuses a chain whose hashes no longer link, and names the break', () => {
  const dir = makePassingProject();
  const file = resolve(dir, PATHS.ledger);
  // Edit the first entry's url without recomputing its hash: it parses, and it is a lie.
  const lines = readText(file).split('\n');
  const first = JSON.parse(lines[0]);
  lines[0] = JSON.stringify({ ...first, url: 'https://x.invalid/edited-after-the-fact' });
  writeText(file, lines.join('\n'));
  const before = readText(file);

  assert.throws(
    () => appendFetch(dir, { op: 'scrape', url: 'https://x.invalid/paid-for' }),
    (err) => {
      assert.equal(err.code, 'LEDGER_CHAIN_BROKEN', err.message);
      assert.match(err.message, /seq 1/, 'the break is named by its entry');
      assert.match(err.message, /entrySha256 does not recompute|prev does not link/, 'and by what is wrong with it');
      assert.match(err.message, /git checkout -- research\/raw\/\.fetches\.jsonl/, 'the remedy is restoring the ledger that verified');
      return true;
    },
  );
  assert.equal(readText(file), before, 'nothing was written onto the broken chain');
});

test('F12: a collection refuses before it spends, when the chain cannot record it', () => {
  const dir = makePassingProject();
  const file = resolve(dir, PATHS.ledger);
  writeText(file, `${readText(file)}not json at all\n`);

  let fetched = 0;
  assert.throws(() => collectOne(dir, 'https://x.invalid/new', {
    corpus: readCorpus(dir),
    runScrape: (url) => { fetched += 1; return adapter(url); },
  }), /damaged chain|never finished/);
  assert.equal(fetched, 1, 'the adapter ran once; the refusal is at the record, which is where it can still be repaired');
});

test('F12: after the documented repair, collection resumes', () => {
  const dir = makePassingProject();
  const file = resolve(dir, PATHS.ledger);
  writeText(file, `${readText(file)}{"seq":2,"at":"2026-01-0`);

  assert.equal(repairLedgerTail(dir).repaired, true);

  const outcome = collectOne(dir, 'https://x.invalid/after', { corpus: readCorpus(dir), runScrape: adapter });
  assert.equal(outcome.status, 'collected');
  assert.equal(verifyLedger(dir).ok, true);
  assert.equal(readLedger(dir).entries.length, 2);
});

// ---------------------------------------------------------------- lock ownership
//
// Added 2026-09-21. `release()` read the lock, and if it could not PARSE it, unlinked it
// anyway:
//
//     try { holder = JSON.parse(readText(file, '')); } catch { holder = null; }
//     if (holder && holder.nonce !== token.nonce) return;   // <- skipped when null
//     fs.unlinkSync(file);
//
// The dangerous case is not a missing lock, it is a REPLACED one. While a collector
// works, its lock can be truncated, recovered as stale by a second collector, and
// replaced by that collector's own lock. Releasing then deleted the second collector's
// lock and opened the section to a third - duplicate sequence numbers, conflicting
// ledger appends, a torn chain.

test('release does not remove a lock it cannot prove it owns', async () => {
  const dir = makeProject();
  const lock = path.join(dir, 'research', 'raw', '.fetches.lock');
  try {
    let observed = null;
    withLock(dir, () => {
      // Someone else's lock is now at the path this holder is about to release.
      fs.writeFileSync(lock, JSON.stringify({ nonce: 'a-different-collector', pid: process.pid, host: 'elsewhere' }), 'utf8');
      observed = fs.readFileSync(lock, 'utf8');
    });
    assert.equal(fs.existsSync(lock), true, 'release deleted a lock belonging to another holder');
    assert.equal(fs.readFileSync(lock, 'utf8'), observed, 'the other holder\'s lock was modified');
  } finally { cleanup(dir); }
});

test('release does not remove an UNREADABLE lock', () => {
  // The exact shape of the defect: an unparseable lock used to fall through the ownership
  // check. Leaving it behind is the safe direction - the staleness path recovers a lock
  // nobody holds, and no path recovers a lock that was wrongly deleted.
  const dir = makeProject();
  const lock = path.join(dir, 'research', 'raw', '.fetches.lock');
  try {
    withLock(dir, () => {
      fs.writeFileSync(lock, '{ truncated', 'utf8');   // a torn write, or another holder mid-write
    });
    assert.equal(fs.existsSync(lock), true,
      'an unreadable lock was deleted on release; if it belonged to another collector, two are now inside the section');
  } finally { cleanup(dir); }
});

test('release DOES remove the lock it actually owns', () => {
  // The other half. A fix that never releases is not a fix - it would wedge every
  // subsequent collection behind a lock that only times out.
  const dir = makeProject();
  const lock = path.join(dir, 'research', 'raw', '.fetches.lock');
  try {
    withLock(dir, () => {
      assert.equal(fs.existsSync(lock), true, 'the lock was not created inside the section');
    });
    assert.equal(fs.existsSync(lock), false, 'the holder did not release its own lock');
  } finally { cleanup(dir); }
});

// Found 2026-09-28 (checking an outside break-test, F-04): a lock write that failed - a full
// disk - leaked the descriptor and left the EMPTY lock file just created, which the next run
// then found as a lock it could not read. The failure still reaches the caller, and leaves
// neither behind.
test('a lock whose write fails closes its descriptor, removes its own file, and reports the failure', () => {
  const root = makeProject();
  const realWrite = fs.writeSync;
  const realClose = fs.closeSync;
  const closed = [];
  let failed = false;
  fs.writeSync = (fd, ...rest) => {
    if (!failed) { failed = true; const err = new Error('ENOSPC: no space left on device, write'); err.code = 'ENOSPC'; throw err; }
    return realWrite(fd, ...rest);
  };
  fs.closeSync = (fd) => { closed.push(fd); return realClose(fd); };
  let error = null;
  try { withLock(root, () => {}); } catch (err) { error = err; } finally { fs.writeSync = realWrite; fs.closeSync = realClose; }
  assert.ok(error && error.code === 'ENOSPC', `the write failure did not reach the caller: ${error?.message}`);
  assert.ok(closed.length >= 1, 'the lock descriptor was never closed');
  const lockDir = resolve(root, PATHS.raw);
  const leftovers = fs.existsSync(lockDir) ? fs.readdirSync(lockDir).filter((n) => /lock/i.test(n)) : [];
  assert.deepEqual(leftovers, [], `an empty lock file was left behind: ${leftovers.join(', ')}`);
});

// Found 2026-10-01 (break-test). `acquire()` judged a lock stale, tried to remove it, and on
// any failure that was not "already gone" fell through to `continue` - which skipped BOTH the
// deadline check and the 50 ms sleep below it. The run then spun forever: a whole core, nothing
// printed, no exit code, and not even answerable with `--report-on-signal`, because a
// synchronous loop never returns to the event loop. Two ways in, both measured: a `research/raw`
// this process cannot write, holding a lock whose pid is dead (EACCES on the removal - 8 s of
// wall time costing 6.1 s user and 1.8 s sys), and a `.fetches.lock` that is a DIRECTORY (EISDIR
// - killed from outside at 250 s). The commit gate has a 120 s watchdog; `research.mjs` and
// `prior.mjs` have none, so a spin ends only when a person kills it.

/**
 * One `withLock` attempt, in a CHILD process with its own deadline.
 *
 * The failure these pin is a synchronous spin, which is the one thing the harness's watchdog
 * cannot catch: the callback that would time the test out is queued on an event loop the spin
 * never returns to. In-process, a regression here hangs the whole suite printing nothing - the
 * exact trap the runner's own header names. So the attempt is contained, killed at its deadline,
 * and its answer read back as data.
 */
function lockAttempt(dir, body) {
  const script = `
    const dir = process.argv[1];
    const { withLock } = await import(${JSON.stringify(pathToFileURL(path.join(KIT_ROOT, 'lib', 'provenance.mjs')).href)});
    ${body}
    let entered = false;
    let error = null;
    const started = Date.now();
    try { withLock(dir, () => { entered = true; }); }
    catch (err) { error = { code: err.code ?? null, message: String(err.message ?? err) }; }
    process.stdout.write(JSON.stringify({ entered, error, ms: Date.now() - started }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, dir], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true,
    env: { ...process.env, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE },
  });
  assert.equal(child.signal, null, `the attempt was still spinning when it was killed at 20s: ${child.stderr?.slice(0, 200)}`);
  assert.equal(child.status, 0, `the attempt died instead of answering: ${String(child.stderr).slice(0, 300)}`);
  return JSON.parse(String(child.stdout));
}

test('a stale lock this process cannot remove is named, not spun on forever', () => {
  const dir = makeProject();
  const lock = resolve(dir, PATHS.lock);
  writeText(lock, JSON.stringify({ pid: 999_999, host: os.hostname(), nonce: 'dead', at: new Date().toISOString() }));
  assert.equal(lockRecoverable(lock, JSON.parse(readText(lock))).recoverable, true,
    'the premise: a holder whose pid is gone is recoverable at once');

  // A read-only research/raw, a mount that went away, or Windows holding the file open: each
  // reaches the removal as something other than ENOENT. Stubbed rather than chmod-ed, because
  // a directory's permission bits do not mean the same thing on every supported platform.
  const attempt = lockAttempt(dir, `
    const fs = (await import('node:fs')).default;
    fs.unlinkSync = (target) => { const err = new Error('EACCES: permission denied, unlink ' + target); err.code = 'EACCES'; throw err; };
  `);

  assert.equal(attempt.entered, false, 'the section was entered through a lock that was never removed');
  assert.equal(attempt.error?.code, 'LOCK_STUCK', `the refusal was not named: ${JSON.stringify(attempt.error)}`);
  assert.match(attempt.error.message, /EACCES/, 'why the removal failed is the operator\'s clue');
  assert.match(attempt.error.message, /\brm\b|\bdel\b/, 'and so is the command that clears it');
  assert.ok(attempt.ms < 10_000, `${attempt.ms}ms: the loop spun instead of refusing`);
});

test('a .fetches.lock that is a DIRECTORY is named, not a hang', () => {
  const dir = makeProject();
  const lock = resolve(dir, PATHS.lock);
  fs.mkdirSync(lock, { recursive: true });
  // Past the stub bound, so a holder-less lock is judged recoverable and the removal is tried.
  // A sync tool, or a `mkdir -p` one level too deep, leaves exactly this.
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);

  let attempt = null;
  try {
    attempt = lockAttempt(dir, '');
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }

  assert.equal(attempt.entered, false, 'a directory is not a lock, and it is not the section either');
  assert.equal(attempt.error?.code, 'LOCK_STUCK', `a directory where the lock goes was not named: ${JSON.stringify(attempt.error)}`);
  assert.ok(attempt.ms < 10_000, `${attempt.ms}ms: the run spun instead of refusing`);
});

test('a lock held by a live process names itself when the wait runs out', () => {
  const dir = makeProject();
  const lock = resolve(dir, PATHS.lock);
  // This process as the holder: same host, pid alive, so never recoverable - the case ADR-0025
  // refuses to evict however old the lock looks. No spin here: the wait sleeps, so this one is
  // safe to run in-process.
  writeText(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), nonce: 'unreleased', at: new Date().toISOString() }));

  let error = null;
  const started = Date.now();
  // `waitMs` is the seam: the production wait is 120 s, and a refusal reachable only by waiting
  // it out is a refusal no test can afford to pin.
  try { withLock(dir, () => {}, { waitMs: 100 }); } catch (err) { error = err; } finally { fs.rmSync(lock, { force: true }); }

  assert.equal(error?.code, 'LOCK_HELD', `the wait ran out without naming itself: ${error?.message ?? 'no error at all'}`);
  assert.match(error.message, /still held/, 'the message is the diagnosis');
  assert.match(error.message, /delete the lock file/, 'and it says the way out');
  assert.ok(Date.now() - started < 10_000, 'the seam did not shorten the wait');
});
