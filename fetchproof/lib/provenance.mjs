// provenance.mjs - the tamper-evident fetch ledger and the collector's exclusive section.
//
// `research/raw/.fetches.jsonl` is append-only, one JSON object per line, hash-chained:
//   entrySha256 = sha256(canonical entry with entrySha256 omitted)
//   prev        = the previous entry's entrySha256, 64 zeroes at genesis
//
// The chain is tamper-EVIDENCE, not truth: it proves collection happened, never that a
// page says what a claim asserts.
//
// Every writer of the chain holds one O_EXCL lock while it does its read-modify-write
// (ADR-0020). An unlocked append is not a smaller version of the same operation - it is
// the operation with the guarantee removed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  PATHS, GENESIS, resolve, exists, projectFile, readText, ensureDir, appendLine,
  canonicalJson, sha256, nowIso, writeText,
} from './core.mjs';
import { readCorpus, readLedger } from './corpus.mjs';

import { kitCommand } from './core.mjs';
// LIVENESS, not age (ADR-0025).
//
// Age alone cannot tell an abandoned lock from a live writer, and a collection run
// legitimately holds the section across many slow requests - so evicting on age evicted
// the correct holder. The real question is whether the holder still exists, and on the
// machine that wrote the lock that question has an exact answer: `kill(pid, 0)`.
//
// A holder that is alive is NEVER broken, however long it has been there. A holder whose
// process is gone is recovered at once. Only a holder we cannot ask about - a foreign
// hostname on a shared filesystem, or a stub with no pid in it - falls back to a bound,
// and the two bounds differ because the two situations do.
//
// Deliberately NOT a renewed lease: the collector is synchronous (the adapter is a
// `spawnSync`), so the event loop is blocked for exactly the stretch a renewal timer
// would need to fire. A heartbeat that cannot beat when it matters is worse than none -
// it would expire precisely during the slow fetch it exists to protect.
const STUB_STALE_MS = 30_000;
const FOREIGN_STALE_MS = 15 * 60_000;
const LOCK_WAIT_MS = 120_000;
const held = new Map(); // root -> { token, depth }

// ---------------------------------------------------------------- hashing

/** The entry hash: canonical JSON of the entry with `entrySha256` and `line` omitted. */
export function entryHash(entry) {
  const { entrySha256, line, ...rest } = entry;
  return sha256(canonicalJson(rest));
}

export function hashText(text) {
  return sha256(Buffer.from(text, 'utf8'));
}

/**
 * Did git's smudge filter do this? Folding CRLF back to LF either reproduces the
 * recorded hash or it does not - so a genuinely tampered capture stays `modified`.
 */
export function isLineEndingRewrite(bytes, recordedHash) {
  if (!recordedHash) return false;
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  if (!text.includes('\r\n')) return false;
  // CRLF only, deliberately NOT core's `foldLineEndings` (2026-10-03): the question here is
  // whether git's autocrlf smudge explains the mismatch, and that smudge turns LF into CRLF
  // and nothing else. A capture written before e99d0ad could hold a lone CR of the page's
  // own, hashed as such; folding it too would turn a true "rewritten on checkout" into a
  // false "altered after fetch".
  return hashText(text.replace(/\r\n/g, '\n')) === recordedHash;
}

// ---------------------------------------------------------------- the exclusive section

function lockFile(root) {
  return resolve(root, PATHS.lock);
}

function lockAge(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return Infinity;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Acquire with `flag: 'wx'` so the kernel refuses a second creator. Staleness is judged
 * only AFTER EEXIST proves someone holds the file, and a fresh lock naming no pid - the
 * window O_EXCL leaves between create and write - is waited for, never broken.
 *
 * VERIFIED, AND CONDITIONAL. Measured 2026-09-22 rather than assumed: 24 processes racing
 * to create one path produced exactly one winner and 23 `EEXIST`, on win32 / Node v24.20.0.
 *
 * The condition is the part ADR-0020 never stated, and it comes from Node's own reference:
 * **"The exclusive flag might not work with network file systems."** So this lock is sound
 * on a local filesystem and is NOT promised over NFS or SMB - and nothing here detects
 * which one it is standing on. A project directory on a network share could admit two
 * collectors to the section at once, which is the one failure the hash chain cannot repair,
 * because both would be appending validly.
 *
 * Not fixed here, because detecting the filesystem type portably is a larger change than
 * the risk currently justifies, and guessing would be worse than saying so. Evidence and
 * the full caveat: `docs/decisions/2026-09-22-wx-lock/`.
 */
/** Is this process still alive? Signal 0 asks the kernel without delivering anything. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to somebody else - alive for our purposes.
    return err.code === 'EPERM';
  }
}

/**
 * May this holder be broken?
 *
 *   same host, pid alive  -> NEVER. However old the lock is, somebody is using it.
 *   same host, pid gone   -> yes, at once. It crashed.
 *   another host          -> only after a generous bound; we cannot ask, so we wait.
 *   no pid at all         -> a stub from a crash or the create/write window; a short bound.
 */
export function lockRecoverable(file, holder) {
  const since = lockAge(file);
  if (!holder || !Number.isInteger(holder.pid)) {
    return since > STUB_STALE_MS
      ? { recoverable: true, why: `a holder with no pid, untouched for ${Math.round(since / 1000)}s` }
      : { recoverable: false, why: 'a holder with no pid, possibly mid-write' };
  }
  if (holder.host === os.hostname()) {
    // ADR-0025, and it is load-bearing: a live holder is NEVER broken, however old the
    // lock is. Age-based eviction was tried and rejected because a collection legitimately
    // holds the section across many slow requests, so evicting on age evicted the CORRECT
    // holder and interleaved two collectors.
    //
    // A 2026-09-21 audit proposed a bound here for pid reuse - a dead collector whose
    // number the OS later handed to an unrelated process leaves a lock that reads as held
    // forever. The concern is real and the remedy is not eviction: any bound short enough
    // to catch a reused pid is short enough to evict a long run, which is the worse
    // failure and the one this decision already weighed. `test/concurrency.test.mjs`
    // backdates a live lock six hours and requires it to survive.
    //
    // So pid reuse is made DIAGNOSABLE instead, in the timeout message below.
    return pidAlive(holder.pid)
      ? { recoverable: false, why: `pid ${holder.pid} is alive` }
      : { recoverable: true, why: `pid ${holder.pid} is gone` };
  }
  return since > FOREIGN_STALE_MS
    ? { recoverable: true, why: `held by ${holder.host}, untouched for ${Math.round(since / 60_000)}m` }
    : { recoverable: false, why: `held by ${holder.host}, which this machine cannot ask about` };
}

function acquire(root, { waitMs = LOCK_WAIT_MS } = {}) {
  const file = lockFile(root);
  ensureDir(path.dirname(file));
  const token = { pid: process.pid, host: os.hostname(), nonce: crypto.randomBytes(8).toString('hex'), at: nowIso() };
  // `waitMs` is a test seam in the same spirit as `materializeIndex`'s injectable git: the
  // wait is 120 s, and a refusal that can only be reached by waiting it out is a refusal no
  // test can afford to pin. Nothing outside the suite passes it.
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      try {
        fs.writeSync(fd, JSON.stringify(token));
      } catch (writeErr) {
        // A write that fails (a full disk) must not leak the descriptor or leave the EMPTY
        // lock just created, which the next run would find as a lock it cannot read
        // (2026-09-28). It is ours - 'wx' made it - so removing it races with nobody.
        try { fs.closeSync(fd); } catch { /* already gone */ }
        try { fs.unlinkSync(file); } catch { /* already gone */ }
        throw writeErr;
      }
      fs.closeSync(fd);
      return token;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const body = readText(file, '');
      let holder = null;
      try { holder = JSON.parse(body); } catch { holder = null; }

      // An unidentifiable holder reaches the staleness test too. It used to be waited on
      // forever: the branch that could not read a pid never got there, so an abandoned
      // empty lock timed out instead of being recovered.
      const { recoverable, why } = lockRecoverable(file, holder);
      if (recoverable) {
        try {
          fs.unlinkSync(file);
        } catch (err) {
          // Already gone is the race this loop exists to retry: another process recovered it
          // a moment ago, and the next open either takes the section or finds who did.
          if (err.code !== 'ENOENT') {
            // Anything else is a lock this process has judged stale and CANNOT remove - and
            // the `continue` below skipped both the deadline check and the sleep, so the run
            // spun forever: a whole core, nothing printed, no exit, and not even reachable by
            // `--report-on-signal`, because a synchronous loop never returns to the event loop
            // (found 2026-10-01, break-test: a read-only research/raw holding a stale lock, and
            // a .fetches.lock that is a DIRECTORY, each hung until they were killed from
            // outside - 250 s and 8 s measured, at 100% of a core).
            const stuck = new Error(
              `the collector's lock looks stale (${why}) but could not be removed (${err.code}): ${file}. Nothing was collected.\n`
              + `No collector is holding it, so remove it by hand: ${process.platform === 'win32' ? `del "${file}"` : `rm ${file}`}`,
            );
            stuck.code = 'LOCK_STUCK';
            throw stuck;
          }
        }
        continue;
      }

      if (Date.now() > deadline) {
        // Names pid reuse explicitly, because the operator is the only one who can tell.
        //
        // `pidAlive` asks whether a process with that NUMBER exists, not whether it is the
        // one that took the lock - and operating systems reuse numbers. A collector that
        // died and whose pid was later handed to an unrelated process leaves a lock that
        // reads as held forever, and nothing in a bare "still held" message would suggest
        // the holder is now a text editor.
        //
        // Eviction is deliberately NOT the answer (ADR-0025): any bound short enough to
        // catch a reused pid would evict a legitimately long collection, which is worse.
        // So the message hands over the one check a person can make and a machine cannot.
        const age = Math.round(lockAge(file) / 60_000);
        const held = new Error(
          `the collector's exclusive section is still held (${why}): ${file}. Nothing was collected.\n`
          + `The lock is ${age}m old.\n`
          + (holder?.pid
            ? `If pid ${holder.pid} is not a fetchproof run, its number has been REUSED and the lock is stale:\n`
              + `  ${process.platform === 'win32' ? `tasklist /FI "PID eq ${holder.pid}"` : `ps -p ${holder.pid} -o pid,lastcomm,args`}\n`
              + 'A live pid is never evicted automatically, because a long collection looks identical to a hung one.\n'
            : '')
          + 'If that holder is genuinely gone, delete the lock file.',
        );
        // Coded, so an entrypoint can tell a refusal the kit wrote from a bug: this message
        // already carries the diagnosis, the pid check and the remedy, and re-throwing it as
        // an uncaught error buried all three under a stack trace (found 2026-10-01).
        held.code = 'LOCK_HELD';
        throw held;
      }
      sleep(50);
    }
  }
}

function release(root, token) {
  const file = lockFile(root);
  let holder = null;
  try { holder = JSON.parse(readText(file, '')); } catch { holder = null; }

  // Ownership must be POSITIVELY confirmed. An unreadable lock is not permission to
  // remove one.
  //
  // This read `if (holder && holder.nonce !== token.nonce) return;` - so a lock that
  // failed to parse fell through to the unlink. That is the dangerous case, not the
  // harmless one: while this process worked, its lock could have been truncated, then
  // recovered as stale by a second collector, which acquired its OWN lock. Releasing
  // here would delete that second collector's lock, and a third could then enter the
  // section beside it - duplicate sequence numbers, conflicting ledger appends, a torn
  // chain.
  //
  // Failing to release is the safe direction: the lock is left behind and the existing
  // staleness path recovers it. Deleting someone else's is not recoverable.
  if (!holder || holder.nonce !== token.nonce) return;
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

/**
 * Reentrant in-process: an append inside a run that already holds the lock reuses it.
 *
 * The section is held for as long as `fn` runs, so the whole of one page's journey (cache
 * decision, capture write, ID allocation, ledger append, row updates) sits inside ONE
 * boundary. A slow fetch never looks like a crash, because what is asked is whether the
 * holder still EXISTS, not how long it has been there.
 */
export function withLock(root, fn, { waitMs } = {}) {
  const key = path.resolve(root);
  const current = held.get(key);
  if (current) {
    current.depth += 1;
    try { return fn(); } finally { current.depth -= 1; }
  }

  const token = acquire(root, waitMs === undefined ? {} : { waitMs });
  held.set(key, { token, depth: 1 });

  try {
    return fn();
  } finally {
    const entry = held.get(key);
    if (entry) {
      entry.depth -= 1;
      if (entry.depth <= 0) {
        held.delete(key);
        release(root, token);
      }
    }
  }
}

/** Does this process currently hold the section for that project? */
export function holdsLock(root) {
  return held.has(path.resolve(root));
}

// ---------------------------------------------------------------- append

/**
 * Append one fetch to the chain. `seq` and `prev` are derived from the ledger as read
 * UNDER the lock, which is the whole reason the lock exists.
 */
/**
 * The chain's own links - seq, prev, entrySha256 - over parsed entries, without reading a
 * capture: what `verifyLedger` checks first, and what `assertAppendable` refuses on.
 */
export function chainProblems(entries) {
  const problems = [];
  let prev = GENESIS;
  let expected = 1;
  for (const entry of entries) {
    if (entry.seq !== expected) {
      problems.push({ rule: 'seq', line: entry.line, detail: `expected seq ${expected}, found ${entry.seq}` });
    }
    expected = (entry.seq ?? expected) + 1;

    if (entry.prev !== prev) {
      problems.push({ rule: 'prev', line: entry.line, detail: `prev does not link to entry ${entry.seq - 1}` });
    }
    const recomputed = entryHash(entry);
    if (entry.entrySha256 !== recomputed) {
      problems.push({ rule: 'entry-hash', line: entry.line, detail: `entrySha256 does not recompute for seq ${entry.seq}` });
    }
    prev = entry.entrySha256 ?? prev;
  }
  return problems;
}

/**
 * The ledger, once it is established that an entry can be recorded onto it - or a coded
 * refusal (LEDGER_DAMAGED, LEDGER_TORN_TAIL, LEDGER_CHAIN_BROKEN), each with its remedy.
 *
 * Appending onto an unfinished line welds a valid entry to a torn one: the combined line
 * then ends in a newline, so it is no longer a tail `repairLedgerTail` will touch, and the
 * paid-for fetch it recorded is unrecoverable. Appending onto a chain whose hashes no
 * longer link records a paid-for fetch that handoff and preflight will refuse with the
 * rest of the chain (ADR-0122; found 2026-10-02, break-test: the collector spent, appended
 * seq 4 onto a broken chain, and handoff refused the corpus). Never spend before
 * establishing that the result can be recorded - so `runResearch` asks this before its
 * first fetch, and `appendFetch` asks it again under the lock.
 */
export function assertAppendable(root) {
  const ledger = readLedger(root);
  if (ledger.problems.length) {
    const err = new Error(
      `${PATHS.ledger} has ${ledger.problems.length} unparsed line(s) - refusing to append onto a damaged chain. `
      + `Repair it first: ${kitCommand('doctor.mjs', '--fix-arity')}`,
    );
    err.code = 'LEDGER_DAMAGED';
    err.problems = ledger.problems;
    throw err;
  }
  const tail = readText(resolve(root, PATHS.ledger), '');
  if (tail && !tail.endsWith('\n')) {
    const err = new Error(
      `${PATHS.ledger} does not end with a newline - its last line was never finished. `
      + `Repair it first: ${kitCommand('doctor.mjs', '--fix-arity')}`,
    );
    err.code = 'LEDGER_TORN_TAIL';
    throw err;
  }
  const broken = chainProblems(ledger.entries);
  if (broken.length) {
    const first = broken[0];
    const err = new Error(
      `${PATHS.ledger}'s chain is broken at line ${first.line}: ${first.detail}${broken.length > 1 ? ` (and ${broken.length - 1} more)` : ''} - refusing to append onto it: `
      + 'every fetch recorded after the break is refused by handoff and preflight with the rest of the chain. '
      + 'The chain is tamper-evidence, and the kit cannot repair what it cannot vouch for: restore the ledger that verified '
      + `(git checkout -- ${PATHS.ledger}), or start the corpus again. Nothing was collected.`,
    );
    err.code = 'LEDGER_CHAIN_BROKEN';
    err.problems = broken;
    throw err;
  }
  return ledger;
}

export function appendFetch(root, fields) {
  return withLock(root, () => {
    // Validate the ledger BEFORE writing to it (the reasons are on assertAppendable).
    const ledger = assertAppendable(root);

    const last = ledger.entries[ledger.entries.length - 1] ?? null;
    const entry = {
      seq: (last?.seq ?? 0) + 1,
      at: fields.at ?? nowIso(),
      op: fields.op ?? 'scrape',
      url: fields.url ?? '',
      type: fields.type ?? '',
      raw: fields.raw ?? '',
      bodySha256: fields.bodySha256 ?? '',
      transport: fields.transport ?? '',
      completeness: fields.completeness ?? 'unspecified',
      cmd: fields.cmd ?? '',
      prev: last?.entrySha256 ?? GENESIS,
    };
    if (fields.error) entry.error = String(fields.error);
    if (fields.omitted) entry.omitted = String(fields.omitted);
    // WHICH search provider ranked this URL, when a search is why it was fetched
    // (ADR-0027, DR-2). `transport` says who fetched the page; this says who chose it,
    // and with two providers those stopped being the same answer.
    //
    // Optional, like the two above, so every entry written before the split keeps the
    // hash it was written with - the chain covers the canonical entry, and an absent
    // field was never in it.
    if (fields.discoveredBy) entry.discoveredBy = String(fields.discoveredBy);
    if (fields.cacheState) entry.cacheState = String(fields.cacheState);   // ADR-0139
    if (fields.cachedAt) entry.cachedAt = String(fields.cachedAt);
    if (fields.source && fields.sourceSha256) {                            // ADR-0140
      entry.source = String(fields.source);
      entry.sourceSha256 = String(fields.sourceSha256);
    }
    if (fields.sourceOmitted) entry.sourceOmitted = String(fields.sourceOmitted);
    entry.entrySha256 = entryHash(entry);
    appendLine(resolve(root, PATHS.ledger), JSON.stringify(entry));
    return entry;
  });
}

/** Overrides are unchained and go to their own log - nothing else maintains the chain. */
export function recordOverride(root, kind, detail = '') {
  return appendLine(resolve(root, PATHS.overrides), `${nowIso()}\t${kind}\t${detail}`);
}

// ---------------------------------------------------------------- verify

/**
 * Walk the chain and the captures behind it.
 * Problems: `ledger-unparsed`, `seq`, `prev`, `entry-hash`, `body-unmodified`
 * (each carrying `kind: 'line-endings' | 'modified'`), `raw-missing`.
 */
export function verifyLedger(root, { corpus = null } = {}) {
  const snapshot = corpus ?? readCorpus(root);
  const ledger = snapshot.ledger;
  const problems = [...ledger.problems.map((p) => ({ rule: 'ledger-unparsed', ...p }))];

  if (!ledger.present) {
    return { present: false, ok: false, entries: [], problems: [{ rule: 'ledger-missing', detail: `${PATHS.ledger} is absent` }], lineEndings: [] };
  }

  const lineEndings = [];
  problems.push(...chainProblems(ledger.entries));
  // Every file an entry names is checked the same way: the capture (`raw`, `bodySha256`) and,
  // since ADR-0140, the source it was converted from (`source`, `sourceSha256`).
  const named = [];
  for (const entry of ledger.entries) {
    if (entry.op === 'fail' || !entry.raw) continue;
    named.push({ entry, file: entry.raw, hash: entry.bodySha256, what: 'capture' });
    if (entry.source) named.push({ entry, file: entry.source, hash: entry.sourceSha256, what: 'source' });
  }
  for (const { entry, file, hash, what } of named) {
    const { abs, problem } = projectFile(root, file);
    if (problem === 'outside') {
      problems.push({ rule: 'raw-outside', line: entry.line, file,
        detail: `${file}, named by seq ${entry.seq}, is outside the project - not read` });
      continue;
    }
    if (problem === 'missing') {
      problems.push({ rule: 'raw-missing', line: entry.line, file, detail: `${what} named by seq ${entry.seq} is not on disk` });
      continue;
    }
    if (!hash) {
      // A capture of the first ledgers carries no hash and is accepted as it always was. A
      // SOURCE never had that history: ADR-0140 writes `source` and `sourceSha256` together, so
      // an entry naming one without the other was rechained by hand, and a sibling nobody can
      // verify is refused rather than nodded through (break-test pass 4, F4, 2026-10-04).
      if (what === 'source') {
        problems.push({ rule: 'body-unmodified', kind: 'unhashed', line: entry.line, file,
          detail: `${file}, named by seq ${entry.seq}, carries no sourceSha256 - a source that cannot be verified is not kept on trust` });
      }
      continue;
    }
    // A capture that is not a regular file is refused BY NAME before it is opened: a fifo
    // here blocks in open() until another process writes to it, and /dev/zero allocates
    // until libstdc++ kills the process with std::bad_alloc (found 2026-09-28,
    // break-test). Both ended the run of every entrypoint that verifies a corpus,
    // including the commit gate, with no diagnostic at all.
    if (problem === 'not-file') {
      problems.push({ rule: 'raw-unreadable', line: entry.line, file,
        detail: `${file}, named by seq ${entry.seq}, could not be read (it is not a regular file, `
          + 'so it has no end to read to) - check what it is' });
      continue;
    }
    // A capture that cannot be read (permissions, a directory in its place) is a named
    // failure, not a crash: it threw out of preflight with a raw stack trace (2026-09-28).
    let bytes;
    try {
      bytes = fs.readFileSync(abs);
    } catch (err) {
      problems.push({ rule: 'raw-unreadable', line: entry.line, file,
        detail: `${file}, named by seq ${entry.seq}, could not be read (${err.code ?? err.message}) - check its permissions` });
      continue;
    }
    if (sha256(bytes) === hash) continue;
    const rewrite = isLineEndingRewrite(bytes, hash);
    if (rewrite) lineEndings.push({ file, seq: entry.seq });
    problems.push({
      rule: 'body-unmodified',
      kind: rewrite ? 'line-endings' : 'modified',
      line: entry.line,
      file,
      detail: rewrite
        ? `${file} differs only by CRLF line endings`
        : `${file} does not match the hash recorded at fetch`,
    });
  }

  return { present: true, ok: problems.length === 0, entries: ledger.entries, problems, lineEndings };
}

// ---------------------------------------------------------------- repair and migration

/**
 * Drop a trailing partial line, and only that. A chain broken in the middle is not a
 * torn tail, and inventing a link is the one thing a repair must never do.
 */
export function repairLedgerTail(root) {
  const file = resolve(root, PATHS.ledger);
  // Look before locking: the lock lives in research/raw/, and creating that folder makes
  // any directory a gated project (a gate marker). No ledger, nothing to repair.
  if (!exists(file)) return { repaired: false, reason: 'ledger-missing' };
  return withLock(root, () => {
    const text = readText(file);
    if (text === null) return { repaired: false, reason: 'ledger-missing' };
    const lines = text.split(/\r?\n/);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return { repaired: false, reason: 'ledger-empty' };

    const tail = lines[lines.length - 1];
    let torn = false;
    // A one-entry ledger can carry the same leading editor BOM readLedger tolerates.
    // It is not a torn append; later-line BOMs remain invalid and the file is untouched.
    try { JSON.parse(lines.length === 1 ? tail.replace(/^\uFEFF/, '') : tail); } catch { torn = true; }
    if (!torn) return { repaired: false, reason: 'tail-parses' };

    const head = lines.slice(0, -1).join('\n');
    writeText(file, head ? `${head}\n` : '');
    const after = verifyLedger(root);
    if (!after.ok) {
      writeText(file, text);
      return { repaired: false, reason: 'chain-broken-before-tail' };
    }
    return { repaired: true, reason: 'tail-dropped', line: lines.length };
  });
}

/**
 * The one sanctioned rewrite: re-chain entries after a metadata migration, recording
 * per-entry `migrations` and a chained `op: 'migration'` boundary. It refuses a chain
 * that is broken for any reason other than the hashes it is about to recompute.
 */
export function rebuildLedger(root, migrate, { note = 'metadata migration' } = {}) {
  // As repairLedgerTail: taking the lock would create research/raw/ where no ledger is.
  if (!exists(resolve(root, PATHS.ledger))) {
    return { rebuilt: false, reason: 'ledger-missing', problems: [{ rule: 'ledger-missing', detail: `${PATHS.ledger} is absent` }] };
  }
  return withLock(root, () => {
    const before = verifyLedger(root);
    const blocking = before.problems.filter((p) => p.rule !== 'entry-hash' && p.rule !== 'prev' && p.rule !== 'body-unmodified');
    if (blocking.length) return { rebuilt: false, reason: 'chain-broken', problems: blocking };

    const file = resolve(root, PATHS.ledger);
    const entries = readLedger(root).entries;
    const out = [];
    let prev = GENESIS;
    let changed = 0;
    for (const original of entries) {
      const { line, ...entry } = original;
      const next = { ...entry, ...(migrate ? migrate({ ...entry }) : {}) };
      const migrations = Array.isArray(entry.migrations) ? [...entry.migrations] : [];
      const fields = Object.keys(next).filter((k) => k !== 'entrySha256' && k !== 'prev' && k !== 'migrations' && canonicalJson(next[k]) !== canonicalJson(entry[k]));
      if (fields.length) { migrations.push({ at: nowIso(), note, fields }); changed += 1; }
      if (migrations.length) next.migrations = migrations;
      next.prev = prev;
      delete next.entrySha256;
      next.entrySha256 = entryHash(next);
      prev = next.entrySha256;
      out.push(next);
    }
    const boundary = {
      seq: (out[out.length - 1]?.seq ?? 0) + 1,
      at: nowIso(), op: 'migration', url: '', type: '', raw: '', bodySha256: '',
      transport: '', completeness: 'unspecified', cmd: '', note, entries: out.length, changed,
      prev,
    };
    boundary.entrySha256 = entryHash(boundary);
    out.push(boundary);
    writeText(file, `${out.map((e) => JSON.stringify(e)).join('\n')}\n`);
    return { rebuilt: true, entries: out.length, changed };
  });
}

export { GENESIS, os };
