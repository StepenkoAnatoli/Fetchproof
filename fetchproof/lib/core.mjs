// core.mjs - generic primitives and the artifact constants. Knows no semantics.
//
// Everything here is either a filesystem/path/date/string helper or a name: where an
// artifact lives and what its table header is. No module below this one decides
// anything about research, gates, or evidence.

import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// ---------------------------------------------------------------- paths

/**
 * Where this process stood when it started, and the names of the environment variables
 * that can move the temp folder. Both exist for `tempBase()` below.
 *
 * The cwd is read once, here, at module load - which is process start for every bin that
 * imports this file - because a relative TMPDIR means "relative to where I was when I
 * typed the command", and a later `chdir` must not change what it resolves to.
 */
const START_CWD = (() => {
  try { return process.cwd(); } catch { return '.'; }   // a deleted cwd makes process.cwd() throw
})();

/** TMPDIR is the POSIX name; TEMP and TMP are what Windows reads. */
const TEMP_ENV_NAMES = Object.freeze(['TMPDIR', 'TEMP', 'TMP']);

/** Every artifact the kit knows, project-relative and POSIX-spelled. */
/**
 * The kit's version - the one place it is stated (ADR-0116). The MCP server announces it, doctor
 * reports it, the changelog has an entry for it, and a release is tagged `v<KIT_VERSION>`.
 */
export const KIT_VERSION = '0.9.5';

/**
 * The one order for identifiers - slugs, file names, ids, ISO dates: by UTF-16 code unit
 * (`lib/release/order.mjs`, so the ported validators may use it too). `localeCompare` with no
 * locale named reads the machine's, and the order then differed from machine to machine
 * (break-test PR #185, 2026-10-01).
 */
export { compareText } from './release/order.mjs';

export const PATHS = Object.freeze({
  agents: 'AGENTS.md',
  architecture: 'docs/ARCHITECTURE.md',
  gitattributes: '.gitattributes',
  kit: 'research/kit.json',

  discovery: 'research/DISCOVERY.md',
  map: 'research/MAP.md',
  evidence: 'research/EVIDENCE.md',
  sources: 'research/SOURCES.md',
  timeline: 'research/TIMELINE.md',
  brief: 'research/BRIEF.md',
  plan: 'research/plan.json',
  // Opt-in third-party witnesses for captures (ADR-0106). Outside raw/ and the ledger, so a
  // witness can never alter or fail a capture; not a dotfile, so it travels with git.
  witnesses: 'research/witnesses.jsonl',

  raw: 'research/raw',
  audits: 'research/audits',

  ledger: 'research/raw/.fetches.jsonl',
  lock: 'research/raw/.fetches.lock',
  usage: 'research/raw/.usage.jsonl',
  failures: 'research/raw/.failures.jsonl',
  diagnostics: 'research/raw/.diagnostics.jsonl',

  overrides: 'research/overrides.log',
  gateOff: 'research/GATE_OFF',
});

/** The table headers the corpus reader and every writer agree on. */
export const HEADERS = Object.freeze({
  unknowns: ['ID', 'Unknown', 'Why it blocks the build', 'Status', 'Evidence'],
  evidence: ['ID', 'Retrieved', 'Type', 'URL', 'Finding', 'Raw'],
  sources: ['URL', 'Type', 'Title', 'Retrieved', 'Used for'],
  subtopics: ['ID', 'Subtopic', 'Why it matters', 'Status', 'Covered by'],
});

export const GENESIS = '0'.repeat(64);

/** Join project-relative POSIX names onto an absolute root. */
export function resolve(root, rel) {
  return path.join(root, ...String(rel).split('/'));
}

/**
 * A path the operator typed: absolute as it is, anything else inside the project. `resolve`
 * joins its argument onto the root, so `--plan /tmp/x/plan.json` became `<root>/tmp/x/...`
 * and "does not exist" (found 2026-09-28; `prior --file` had the same join).
 */
export function operatorPath(root, typed) {
  const text = String(typed);
  return path.isAbsolute(text) ? path.normalize(text) : resolve(root, text);
}

/** The inverse: an absolute path back to its POSIX project-relative name. */
export function relative(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

/** A name is inside the project when it does not climb out of it. */
/**
 * The user's home directory, absolute. HOME wins when it is set to an absolute path - tests
 * and operators redirect it that way - and otherwise the account's passwd entry is used.
 * os.homedir() returns HOME even when it is EMPTY, which made every machine path relative
 * to whatever folder a command ran in (found 2026-09-28). On Windows, with USERPROFILE
 * empty, it THROWS instead (uv_os_homedir ENOENT, seen on windows-latest CI) - and it was
 * called at import, so every kit command crashed there. Both fall back to the account.
 */
export function homeDir() {
  let home = '';
  try { home = os.homedir(); } catch { /* Windows, empty USERPROFILE: fall back below */ }
  if (home && path.isAbsolute(home)) return home;
  try {
    const passwd = os.userInfo().homedir;
    if (passwd && path.isAbsolute(passwd)) return passwd;
  } catch { /* no passwd entry: nothing better to offer */ }
  return home;
}

export function isInside(root, abs) {
  const rel = path.relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The temp folder, ABSOLUTE.
 *
 * `os.tmpdir()` hands back TMPDIR verbatim, and node accepts a RELATIVE one - `TMPDIR=.`,
 * `TMPDIR=./tmp`, a Makefile that exports the folder before it creates it. `fs.mkdtemp`
 * then resolves it against the cwd at the moment of the call, so a relative TMPDIR plus a
 * `process.chdir()` scatters scratch directories: each is created relative to whichever
 * directory was current at that call, and the path handed back is relative to a cwd that
 * has since moved.
 *
 * Worse, it disagrees across processes. Every child this kit spawns - git, sh, python, the
 * kit's own CLIs - re-resolves the same relative TMPDIR against ITS cwd, so the folder the
 * parent just made is not the folder the child looks in. On this kit that was 21 red tests,
 * and one worse than red: `materializeIndex` threw
 * `ENOENT: mkdtemp 'reltmp/fetchproof-index-XXXXXX'`, which the commit gate reports as an
 * internal error and FAILS OPEN on - a machine exporting a relative TMPDIR quietly stopped
 * being gated (found 2026-09-29, break-test).
 *
 * So: resolve against the cwd this process STARTED in, which is what the operator meant and
 * does not drift as the process moves; and publish the absolute answer back through the
 * environment, which is the only channel every descendant reads. With the platform default,
 * or any absolute TMPDIR, this is exactly what `os.tmpdir()` returned.
 *
 * Deliberately not memoised: tests legitimately repoint TMPDIR at a private folder mid-run
 * to count what a verdict leaves behind, and a cached answer would quietly judge a
 * directory nobody was looking at.
 */
export function tempBase() {
  const raw = os.tmpdir();
  if (path.isAbsolute(raw)) return path.resolve(raw);

  const abs = path.resolve(START_CWD, raw);
  for (const name of TEMP_ENV_NAMES) {
    if (process.env[name] !== undefined && !path.isAbsolute(process.env[name])) process.env[name] = abs;
  }
  return abs;
}

/**
 * How much room the temp folder actually has, in words.
 *
 * The probe in `bin/selftest.mjs` answers "can this folder be used at all". A volume that
 * is writable and full answers YES and then fails every test that writes anything - so
 * when a red suite is dominated by ENOSPC this is the number the reader needs, and
 * `statfsSync` is the only way to get it without writing until the disk says stop.
 *
 * It lives here, beside `tempBase()`, because this is the module that owns the temp folder
 * and the only one that already imports `node:os`. It was first written inside
 * `bin/selftest.mjs`, which does NOT - so the branch it exists for threw
 * `ReferenceError: os is not defined` and took the red summary down with it, leaving a
 * stack trace where the diagnosis belonged (found 2026-09-29, break-test, reproduced with
 * a 1 MiB TMPDIR: 659 of 671 failures ENOSPC, then the crash). A function whose whole job
 * is to explain a failure must not be able to fail.
 */
export function tempFreeSpace() {
  const base = tempBase();
  const measured = 'a green run of this suite peaked at 52 MiB of scratch, measured 2026-09-29';
  try {
    const stat = fs.statfsSync(base);
    const mib = (stat.bavail * stat.bsize) / 1048576;
    return `the temp folder ${base} has ${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MiB free, and ${measured}. `
      + 'Point TMPDIR (TEMP and TMP on Windows) at a folder with room, and run again.';
  } catch {
    return `check the free space on the volume holding ${base}; ${measured}. `
      + 'Point TMPDIR (TEMP and TMP on Windows) at a folder with room, and run again.';
  }
}

/**
 * Does `abs` REALLY land inside `root`, with every symlink on both sides resolved?
 * (ADR-0076.) `isInside` compares spellings; git stores symlinks, so a cloned corpus can
 * spell research/raw/x.md and land on ~/.ssh/id_rsa. Anything that cannot be resolved -
 * a dangling link, a vanished file - is not inside.
 */
export function realInside(root, abs) {
  try {
    return isInside(fs.realpathSync(root), fs.realpathSync(abs));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- filesystem

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A file this kit is willing to READ: a regular file, or a symlink pointing at one.
 *
 * Anything else has no end. `readFileSync` on a **fifo** blocks in `open()` until some
 * other process writes to it - forever, silently; on a character device such as
 * `dev/zero` or `dev/urandom` it allocates until the process is killed. Measured, not
 * supposed (found 2026-09-28,
 * break-test): with one fifo sitting in `research/raw/`, every entrypoint - `handoff`,
 * `preflight`, `audit`, `doctor`, `brief` and the commit `gate` - hung until killed, and
 * with the ledger symlinked to `/dev/zero` all of them died inside libstdc++ with
 * `std::bad_alloc` / SIGABRT. No diagnostic in either case: a hang prints nothing, and
 * SIGABRT prints a C++ exception rather than anything a person can act on.
 *
 * `statSync` follows symlinks on purpose. A symlink to a regular file outside the
 * project is still a file with an end, and refusing it here would be a behaviour change
 * for every caller that resolves a link today; what this rejects is only the kinds that
 * cannot be read to completion.
 */
export function isRegularFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Is this file's content binary? A NUL byte never occurs in text, in any encoding the kit
 * reads, so one in the first 8000 bytes - git's own heuristic, and its window - says the
 * bytes are an executable, an image, an archive: not prose to match credential patterns
 * against. Takes the bytes, or the string a UTF-8 read of them produced (NUL survives
 * that decode unchanged). A UTF-16 file reads as binary here, as it does to git without
 * an attribute saying otherwise.
 */
export const BINARY_PROBE_BYTES = 8000;

export function looksBinary(data) {
  if (Buffer.isBuffer(data)) return data.subarray(0, BINARY_PROBE_BYTES).includes(0);
  return String(data).slice(0, BINARY_PROBE_BYTES).includes('\u0000');
}

/**
 * May a path the corpus RECORDS - a ledger entry's raw, an evidence Raw cell - be read?
 * `{ abs, problem }`: problem is null, or the first rule it breaks, in order:
 *   'outside'  not inside the project by path, or (it exists) by real path - a link out
 *   'missing'  not on disk
 *   'not-file' a directory, fifo or device: no end to read to (ADR-0076, 2026-09-28)
 * One helper, because provenance and warc each re-implemented these steps and each had
 * missed one until 2026-09-30 - a ledger naming ../elsewhere was verified and exported.
 */
export function projectFile(root, rel) {
  const abs = resolve(root, String(rel ?? ''));
  if (!isInside(root, abs)) return { abs, problem: 'outside' };
  if (!exists(abs)) return { abs, problem: 'missing' };
  if (!realInside(root, abs)) return { abs, problem: 'outside' };
  if (!isRegularFile(abs)) return { abs, problem: 'not-file' };
  return { abs, problem: null };
}

export function readText(p, fallback = null) {
  // The guard is here rather than at each corpus call site because this is the one
  // funnel every text read in the kit goes through - captures, the ledger, the
  // contract, the config - and a fifo in ANY of those hangs the run just the same.
  if (!isRegularFile(p)) return fallback;
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return fallback;
  }
}

/**
 * The one line-ending fold for the bytes the kit writes and compares: CRLF and a lone CR
 * both become LF. The capture body before it is written and hashed (collect, since
 * e99d0ad), the scaffold template comparison (gate), the brief's draft stamp - one policy in
 * one place, because two folds that disagree are two answers to "is this the same bytes"
 * (ADR-0133). Deliberately NOT used by `provenance.isLineEndingRewrite`, which asks a
 * narrower question - did autocrlf explain this mismatch - and autocrlf never makes a lone
 * CR; nor by the release layer, which is hermetic and keeps its own.
 */
export function foldLineEndings(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/**
 * Write a file whole, or not at all.
 *
 * `fs.writeFileSync` opens with 'w', which EMPTIES the target before a byte is written, so a
 * write cut short - a full disk, a quota, EFBIG, a killed process - left a partial new file
 * where the old one had been (found 2026-09-28: a 6,300-byte file under a 4 KB limit became
 * 4,096 bytes of the new text). EVIDENCE.md and MAP.md are rewritten through here and hold
 * review work. So the text goes to a scratch dotfile beside the target - a dotfile, so
 * a leftover is never read as a capture - and is renamed over it, which replaces the file
 * in one step within a filesystem. The replaced file's mode is kept (a 0600 config stays
 * 0600); a symlinked target is written through to the file it names; a dangling link is
 * written directly, as before. The scratch file never outlives a failure.
 */
export function writeText(p, text) {
  return writeBytes(p, text, 'utf8');
}

/**
 * The same promise for BYTES, because the two files that matter most are not text.
 *
 * `writeText` is used for the corpus, the map and the config. The audit bundle and the
 * artifact package - the two things this kit hands to somebody else - are written as
 * Buffers by `lib/archive.mjs` and `lib/artifact.mjs`, and they went on calling
 * `fs.writeFileSync` directly until 2026-09-28. The same failure the text path was fixed
 * for therefore still applied to them: a full disk, a quota, EFBIG or a killed CI job
 * emptied the target before writing a byte, so a package that already existed was
 * destroyed and replaced by a truncated one. Measured, not supposed: a 2,679,013-byte
 * package re-created under a 512 KB file-size limit was left as 524,288 bytes of the new
 * one, with the package it replaced gone.
 *
 * Bytes and text share one implementation so the promise cannot drift between them.
 */
/**
 * The part of a target's name its scratch carries: at most 100 BYTES, cut on a character
 * boundary. The scratch adds `.` and `.tmp-<pid>-<hex>`, so carrying the whole name made it
 * LONGER than the file it replaces - a name the filesystem accepts (255 bytes on ext4 and
 * tmpfs) failed with ENAMETOOLONG where a plain write succeeded (found 2026-09-30,
 * break-test). Bytes, not characters: 100 characters of a CJK name are 300 bytes.
 */
function scratchStem(name) {
  const bytes = Buffer.from(name, 'utf8');
  if (bytes.length <= 100) return name;
  let end = 100;
  while (end > 0 && (bytes[end] & 0xC0) === 0x80) end -= 1;     // never split a character
  return bytes.subarray(0, end).toString('utf8');
}

/** How many times a held rename is tried again before its error stands. */
export const RENAME_RETRIES = 5;
const HELD = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * `fs.renameSync`, tried again while Windows holds the file for a moment.
 *
 * On Windows an antivirus scanner or the search indexer can open a file it has just seen
 * written, and a rename onto or from it then fails with EPERM, EBUSY or EACCES - where a moment
 * later it would succeed. Every write in this kit ends in this rename, so one such moment was a
 * failed write (break-test PR #182, a static finding: not reproduced, since no CI runner holds
 * files that way). Waits of 20 ms doubling, about 0.6 s in all. Anywhere else those codes are a
 * real refusal, and every other code is one everywhere: both fail at once.
 */
export function renameRetrying(from, to, { rename = fs.renameSync, sleep = sleepSync, platform = process.platform } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return rename(from, to);
    } catch (err) {
      if (platform !== 'win32' || !HELD.has(err?.code) || attempt >= RENAME_RETRIES) throw err;
      sleep(20 * 2 ** attempt);
    }
  }
}

/** How many times a held folder's removal is tried again before it is left. */
export const REMOVE_RETRIES = 6;

/**
 * Remove the folder `dir` and everything in it, tried again while it is held, and never throw:
 * true when it is gone (or `dir` is empty), false when it was left.
 *
 * A render's folder holds the browser's profile and net log (ADR-0185). The browser's helper
 * processes can still hold files in it for a moment after the browser exits - on Windows a
 * removal then fails with EPERM, EBUSY or EACCES, anywhere with ENOTEMPTY when a helper wrote
 * one more file while the folder was emptied. Waits of 25 ms doubling, about 1.6 s in all.
 * A folder that will not go is left: cleaning a temp folder never changes what a collection
 * found (ADR-0185).
 */
export function removeRetrying(dir, { rm = fs.rmSync, sleep = sleepSync, platform = process.platform } = {}) {
  if (!dir) return true;
  for (let attempt = 0; ; attempt += 1) {
    try {
      rm(dir, { recursive: true, force: true });
      return true;
    } catch (err) {
      const held = err?.code === 'ENOTEMPTY' || (platform === 'win32' && HELD.has(err?.code));
      if (!held || attempt >= REMOVE_RETRIES) return false;
      sleep(25 * 2 ** attempt);
    }
  }
}

export function writeBytes(p, data, encoding = null) {
  ensureDir(path.dirname(p));
  let target = p;
  let mode = null;
  try {
    target = fs.realpathSync(p);
    mode = fs.statSync(target).mode & 0o7777;
  } catch {
    try {
      if (fs.lstatSync(p).isSymbolicLink()) {                       // dangling link
        if (encoding === null) fs.writeFileSync(p, data);
        else fs.writeFileSync(p, data, encoding);
        return p;
      }
    } catch { /* p does not exist yet: a new file */ }
    target = p;
  }
  const scratch = path.join(path.dirname(target), `.${scratchStem(path.basename(target))}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    if (encoding === null) fs.writeFileSync(scratch, data);
    else fs.writeFileSync(scratch, data, encoding);
    if (mode !== null) fs.chmodSync(scratch, mode);
    renameRetrying(scratch, target);
  } catch (err) {
    try { fs.rmSync(scratch, { force: true }); } catch { /* already gone */ }
    err.target = p;   // the file the caller asked for, not the scratch name a rename reports
    throw err;
  }
  return p;
}

/**
 * Keep what a `--force` rewrite is about to replace: `<rel>.bak-<date>` beside it, then
 * `-2`, `-3` while that name is taken, so two forced rewrites on one day keep both.
 * Returns the backup's project-relative path. `brief --force` has kept the brief it
 * replaced since 2026-09-27; `new-project --force` and `decompose --force` wrote templates
 * over a collected corpus and a judged map and kept nothing (#301), so the three share this.
 */
export function keepBackup(root, rel, text, date = today()) {
  let backup = `${rel}.bak-${date}`;
  for (let n = 2; exists(resolve(root, backup)); n += 1) backup = `${rel}.bak-${date}-${n}`;
  writeText(resolve(root, backup), text);
  return backup;
}

/**
 * A stdout whose reader has gone away is not a failure of the command.
 *
 * `node bin/selftest.mjs | head -1` - or `| grep -m1`, or a pager somebody quits - closes
 * the pipe, and Node turns the next write into an unhandled 'error' event: the process
 * died with a raw stack and exit 1 while the suite was still running, so a healthy run
 * reported itself as broken and the result file was never written (found 2026-09-28,
 * break-test; the suite is the only entrypoint measured large enough to hit it - 99 KB of
 * output against a 64 KB pipe buffer). Dropping the writes lets the run finish with its
 * own verdict, which is the only exit code that means anything here.
 */
export function tolerateClosedStdout(stream = process.stdout, { exit = (code) => process.exit(code) } = {}) {
  let reported = false;
  // The write that replaces the stream's once its output is gone. It drops the chunk and
  // still answers the callback, a tick later, as a real write would: `exitAfterFlush` learns
  // that stdout has drained by writing an empty chunk and waiting for exactly that callback,
  // and a replacement that never called it left a green `selftest.mjs | head -1` on an
  // unsettled top-level await - exit 13 (found 2026-10-01, break-test PR #186).
  const dropWrite = (chunk, encoding, callback) => {
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') process.nextTick(done);
    return true;
  };
  stream.on('error', (err) => {
    if (err?.code === 'EPIPE') {
      stream.write = dropWrite;
      return;
    }
    // The ENVIRONMENT refusing the OUTPUT - a full disk, a quota, a read-only mount - is
    // not a verdict either. Throwing here surfaces as an uncaught exception in the middle
    // of the report: exit 1 and a raw stack trace, so a healthy run reads as a red suite
    // and the reader goes looking for a failure that is not there (found 2026-09-29,
    // break-test). Named in words instead, and exit 2 - the code that means "this was not
    // a verdict" - exactly as a refused FILE write is reported.
    //
    // An error the kit does NOT recognise is still thrown. Swallowing one nobody can name
    // is how a real defect goes quiet; the difference here is a code this table explains.
    const reason = WRITE_REFUSALS[err?.code];
    if (!reason) throw err;
    if (reported) return;                 // every later write fails the same way
    reported = true;
    stream.write = dropWrite;
    try {
      process.stderr.write(`fetchproof: could not write its output: ${err.code} (${reason}).\n`);
    } catch { /* stderr is gone too, and there is nothing left to say it with */ }
    exit(2);
  });
}

/**
 * Resolves once everything written to `stream` so far has left the process - or once nothing
 * more can, because the reader left or the stream is gone.
 *
 * `process.exit()` does not wait for a pipe. On POSIX, Node writes to one asynchronously: the
 * kernel takes what fits, the rest stays queued in the process, and exit discards it. A reader
 * slower than the writer got the first 65,536 bytes of a larger report and the exit status of
 * a command that succeeded - preflight's verdict, printed last, was the part that went (found
 * 2026-09-30, break-test). Write callbacks run in order, so an empty write's callback runs after
 * every earlier write has been handed to the OS.
 */
export function flushed(stream) {
  return new Promise((done) => {
    if (!stream || stream.destroyed || stream.writableEnded) { done(); return; }
    const settle = () => done();
    // Kept: a failed write reports through its callback first and emits 'error' a tick later,
    // and an unhandled 'error' is the raw stack this exists to prevent. The process exits next.
    stream.on('error', settle);
    stream.once('close', settle);
    try { stream.write('', settle); } catch { settle(); }
  });
}

/**
 * `await exitAfterFlush(code)`: end the process once stdout and stderr have flushed. For the
 * last line of a command that prints a report, where `process.exit(code)` cut it at the pipe.
 * `process.exitCode` is set first, so the status is the same however the wait ends.
 */
export async function exitAfterFlush(code = 0) {
  process.exitCode = code;
  await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
  process.exit(code);
}

/** Why a write was refused, in words, by error code (2026-09-28). */
const WRITE_REFUSALS = Object.freeze({
  EACCES: 'permission denied - the folder or the file is not writable by this user',
  EPERM: 'not permitted - the folder or the file is read-only or locked',
  EROFS: 'the filesystem is read-only',
  ENOSPC: 'no space is left on the disk',
  EDQUOT: 'the disk quota is used up',
  EFBIG: 'the file would exceed the size this process may write',
  EISDIR: 'a folder is where the file should be',
  ENAMETOOLONG: 'the name is longer than the filesystem allows - most allow 255 bytes per name',
  ENOTDIR: 'a file is where a folder should be',
  EEXIST: 'something already exists where a folder should be',
  EBUSY: 'the file is in use by another process',
  OUTSIDE_PROJECT: 'a link in the path leads out of the project, and the kit writes only inside it',
});

// A recursive mkdir raises ENOENT only when a component of the path cannot be created, as
// through a dangling symlink (found 2026-09-30, a dead ~/.agents link). ENOENT from any other
// call is not named: a missing copy SOURCE would be blamed on the destination.
const MKDIR_ENOENT = 'a folder on the path cannot be created - most often a link to something that no longer exists';

/**
 * One line naming a write the environment refused - `could not write <file>: <CODE>
 * (<why>).` - or null when `err` is not such a refusal. Entrypoints that write catch with
 * this and exit 2: an environment fact ("your folder is read-only") reached the top as a
 * Node stack trace, exit 1, which reads as a bug in the kit (found 2026-09-28). Anything
 * else is re-thrown by the caller, so a genuine bug keeps its stack.
 */
export function writeFailure(err, cwd = process.cwd()) {
  const why = WRITE_REFUSALS[err?.code] ?? (err?.code === 'ENOENT' && err.syscall === 'mkdir' ? MKDIR_ENOENT : undefined);
  if (!why) return null;
  const where = err.target ?? err.dest ?? err.path;
  const shown = where ? (isInside(cwd, path.resolve(cwd, where)) ? path.relative(cwd, path.resolve(cwd, where)) : where) : 'a file';
  return `could not write ${shown}: ${err.code} (${why}).`;
}

/**
 * The kit's OWN refusals: an error that arrives with its diagnosis and its remedy already
 * written, so all an entrypoint owes the operator is that message and a documented exit code.
 * `writeFailure` answers the environment's refusals by code; these are the kit's, and an
 * entrypoint that runs a collection catches on them for the same reason.
 *
 * Re-thrown instead, they print the sentence under a source line, a caret, six stack frames
 * and Node's version footer, and exit 1 - which this kit's vocabulary reserves for FAIL,
 * checked and wrong (found 2026-10-01, break-test: `research.mjs` on a ledger whose last line
 * was never finished, which is what an interrupted collection leaves behind, dumped its
 * internal `problems` array as a JavaScript object literal; `bin/prior.mjs` already answered
 * the same two refusals with their message and exit 2).
 */
export const NAMED_RUN_REFUSALS = Object.freeze(new Set([
  'LEDGER_DAMAGED',     // appendFetch: the chain holds lines that do not parse
  'LEDGER_TORN_TAIL',   // appendFetch: the last line was never finished
  'LEDGER_CHAIN_BROKEN', // assertAppendable: the hashes no longer link (ADR-0122)
  'LOCK_HELD',          // acquire: the section is held, and the wait ran out
  'LOCK_STUCK',         // acquire: judged stale, and this process cannot remove it
  // runResearch: the Firecrawl CLI on PATH is a major this adapter was not written against;
  // refused before any credit is spent. It was thrown with this code and answered with a
  // stack and an object dump under exit 1 (2026-10-02, break-test pass 3).
  'CLI_INCOMPATIBLE',
]));

/** Append one line, creating the file and its directory when absent. */
export function appendLine(p, line) {
  ensureDir(path.dirname(p));
  fs.appendFileSync(p, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
  return p;
}

/**
 * JSON.parse for a file a person may have saved: a leading byte-order mark is dropped.
 * Windows Notepad writes UTF-8 with one, and JSON.parse refuses it - so a plan, kit.json,
 * machine config or settings file saved there was reported as not parsing, with the
 * invisible mark quoted as the bad token (found 2026-09-27).
 */
export function parseJson(text) {
  const t = String(text ?? '');
  return JSON.parse(t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t);
}

export function readJson(p, fallback = null) {
  const text = readText(p);
  if (text === null) return fallback;
  try {
    return parseJson(text);
  } catch {
    return fallback;
  }
}

export function writeJson(p, value) {
  return writeText(p, `${JSON.stringify(value, null, 2)}\n`);
}

export function listFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- hashing

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Hash a file's exact bytes; null when it is not readable. */
export function sha256File(p) {
  // Same guard as readText, for the same measured reason: hashing a fifo hangs here and
  // hashing /dev/zero exhausts memory. A null is "could not hash it", which every caller
  // already handles, rather than a run that never returns.
  if (!isRegularFile(p)) return null;
  try {
    return sha256(fs.readFileSync(p));
  } catch {
    return null;
  }
}

/**
 * Canonical JSON: keys sorted at every depth, no insignificant whitespace.
 * The ledger's entry hash is taken over this rendering, so two writers on two
 * machines produce the same bytes for the same entry.
 *
 * NOT RECURSIVE, and that is a correctness property rather than an optimisation.
 *
 * The recursive form - `[${value.map(canonicalJson).join(',')}]` - overflowed the
 * JavaScript stack at a few thousand levels of nesting. Measured, not supposed: a
 * 3,000-deep object threw `RangeError: Maximum call stack size exceeded`, and the depth
 * at which it did moved with whatever else was on the stack, so it was not even a stable
 * limit to document. This function hashes the fetch ledger, a file that travels between
 * machines through git and that a person may hand-edit, so ONE deeply nested line ended
 * the process - `handoff.mjs`, the first command a builder runs, printed a bare V8 stack
 * trace and exited 1, the code that means "the corpus did not arrive" (found 2026-09-28,
 * break-test). Depth is a property of the input; it must not be able to end the run.
 *
 * The rendering is byte-for-byte what the recursive form produced, corners included,
 * because every hash in the ledger and in the conformance vectors depends on that
 * staying true. The corners are: keys sorted at every depth; an object key whose value is
 * `undefined` dropped; and a member `JSON.stringify` cannot encode rendered as an empty
 * string inside an ARRAY but as the four letters "undefined" inside an OBJECT - which is
 * what `join(',')` and a template literal respectively did, and which a rewrite has to
 * reproduce rather than tidy. Verified differentially against the recursive form over
 * 20,000 generated structures before this replaced it.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  /** One frame per open container: its members in canonical order, and how far through them. */
  const frameOf = (node) => (Array.isArray(node)
    ? { keys: null, node, at: 0 }
    : { keys: Object.keys(node).filter((k) => node[k] !== undefined).sort(), node, at: 0 });

  const parts = [];
  const stack = [];
  // The containers open on the way down. The recursive form failed fast on a cycle (a
  // stack overflow); a loop would walk one forever, so a cycle is refused by name. Only
  // ANCESTORS count: a value shared by two siblings is not a cycle and still renders.
  const open = new Set([value]);
  let frame = frameOf(value);
  parts.push(frame.keys === null ? '[' : '{');
  for (;;) {
    const isArray = frame.keys === null;
    const count = isArray ? frame.node.length : frame.keys.length;
    if (frame.at >= count) {
      parts.push(isArray ? ']' : '}');
      open.delete(frame.node);
      frame = stack.pop();
      if (!frame) return parts.join('');
      continue;
    }
    if (frame.at > 0) parts.push(',');
    const key = isArray ? frame.at : frame.keys[frame.at];
    frame.at += 1;
    if (!isArray) parts.push(`${JSON.stringify(key)}:`);
    const child = frame.node[key];
    if (child !== null && typeof child === 'object') {
      if (open.has(child)) throw new TypeError('canonicalJson: the value is cyclic - it contains itself, so it has no JSON rendering');
      open.add(child);
      stack.push(frame);
      frame = frameOf(child);
      parts.push(frame.keys === null ? '[' : '{');
      continue;
    }
    const encoded = JSON.stringify(child);
    // The two container kinds rendered a member JSON cannot encode (a hole in a sparse
    // array, a present `undefined`, a symbol, a function) DIFFERENTLY in the recursive
    // form, and both spellings are load-bearing for byte-equality, so both are kept:
    // an array went through `Array.prototype.join`, which renders `undefined` as an empty
    // string, while an object went through a template literal, which renders it as the
    // four letters "undefined".
    parts.push(encoded === undefined ? (isArray ? '' : 'undefined') : encoded);
  }
}

// ---------------------------------------------------------------- dates and strings

/** YYYY-MM-DD in UTC. */
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function nowIso(now = new Date()) {
  return now.toISOString();
}

/** Whole days between an ISO-ish date string and now; null when unparseable. */
export function ageInDays(value, now = new Date()) {
  if (!value) return null;
  const then = Date.parse(String(value).trim());
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86400000);
}

/**
 * A filename-safe slug, capped and never ending in a separator.
 *
 * The trim used to run BEFORE the truncation, so a cut that landed on a hyphen left one
 * dangling - which is why every audit file in this repository is named
 * `…-metered-primary--d-1-access-model-…`, with a double hyphen nobody chose. Order
 * matters: slice, then trim.
 */
export function makeSlug(text, fallback = 'topic', limit = 60) {
  const cut = (value) => String(value).slice(0, limit).replace(/-+$/g, '');
  const slug = cut(String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, ''));
  // The fallback keeps the same limit: it came back whole, longer than the caller allowed
  // (2026-09-29, Arena break test).
  const chosen = slug || cut(fallback);
  // A name Windows reserves for a device - `con`, `aux`, `lpt1` - is not creatable there
  // whatever follows it, so a "filename-safe" slug cannot be one (2026-10-01, break-test
  // PR #188; latent, no caller hands a bare slug to the filesystem). Prefixed inside the
  // slug's own alphabet and cut again: `name-` sliced to any limit is never reserved, so the
  // rule holds at every limit, including a cut that lands on one (`console` at 3).
  // Case-insensitive, because the fallback path keeps its case.
  return WINDOWS_RESERVED.test(chosen) ? cut(`name-${chosen}`) : chosen;
}

/** Device names Windows reserves as base names, whatever the extension (Win32 naming rules). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A short, stable id for a URL - used in capture filenames. */
export function urlDigest(url, length = 8) {
  return sha256(String(url)).slice(0, length);
}

export function hostOf(url) {
  try {
    return new URL(String(url)).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Suffixes under which each label belongs to a different owner: `example.co.uk` is a site,
 * `co.uk` is not; `alice.github.io` and `bob.github.io` are two people. A short list, not the
 * Public Suffix List - the kit has no dependencies - covering the suffixes seen in corpora.
 */
const SHARED_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.in', 'com.br', 'com.cn',
  'github.io', 'gitlab.io', 'pages.dev', 'netlify.app', 'vercel.app', 'herokuapp.com', 'blogspot.com', 'readthedocs.io',
  'substack.com', 'medium.com', 'wordpress.com',
]);

/**
 * The site a URL belongs to - its registrable domain - for judging independence. Hostnames
 * were compared, so docs.firecrawl.dev beside www.firecrawl.dev counted as two witnesses: one
 * company describing itself, "independent on hostname alone" (found 2026-09-28).
 */
export function siteOf(url) {
  const host = hostOf(url).toLowerCase().replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.includes(':') && !host.includes('.')) return host;
  const labels = host.replace(/:\d+$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return SHARED_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

export function titleFromUrl(url) {
  try {
    const u = new URL(String(url));
    const last = u.pathname.split('/').filter(Boolean).pop();
    return makeSlug(last || u.host, 'page');
  } catch {
    return 'page';
  }
}

export function uniq(items) {
  return [...new Set(items)];
}

// ---------------------------------------------------------------- argv

// What parseFlags saw beyond the flags themselves, for the two refusals below: the
// positionals, and each word a flag took from the next argument (#289).
const ARGV = Symbol('argv');

/**
 * Generic `--flag value` / `--flag` / positional splitting. It knows no flag names and
 * no semantics: an entrypoint reads meaning out of what this hands back.
 * Repeated flags collect into an array. A bare `--` ends the options, as POSIX has it:
 * everything after it is positional, even an argument that starts with `--`.
 * The positionals also ride on `flags`, under a symbol no `Object.keys` sees, so that
 * `refuseUnknownFlags` can refuse one a command does not take without every caller
 * having to remember to hand them over (#289). So does each word a flag took as its value
 * from the next argument: this knows no flag names, so `--dry-run word` gives --dry-run the
 * value "word", and only `checkFlagValues`, which knows the CLI's value flags, can give the
 * word back as the argument it was.
 */
export function parseFlags(argv) {
  const flags = Object.create(null);
  const positional = [];
  const took = [];
  Object.defineProperty(flags, ARGV, { value: { positional, took, takes: undefined } });
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    let value;
    if (eq > 0) value = arg.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      value = argv[i + 1];
      took.push({ name, word: value, at: positional.length });
      i += 1;
    } else value = true;
    if (name in flags) flags[name] = [].concat(flags[name], value);
    else flags[name] = value;
  }
  return { flags, positional };
}

/** Every value a flag was given, as an array - for repeatable flags like `--check`. */
export function flagList(value) {
  if (value === undefined || value === true) return [];
  return [].concat(value).filter((v) => typeof v === 'string');
}

/**
 * Refuse a flag this entrypoint does not know, instead of ignoring it.
 *
 * WHY THIS EXISTS, and it is not hypothetical. `parseFlags` deliberately knows no flag
 * names, so an entrypoint that does not check gets silence: the flag is parsed, stored,
 * never read, and the command proceeds to do whatever it does by default.
 *
 * On 2026-09-22 that cost 26 Firecrawl credits. `research.mjs --totally-made-up-flag` was
 * run to find out whether unknown flags were refused. They were not - it ignored the flag,
 * fell through to its default behaviour, and started a real collection against this
 * repository's own corpus. `audit.mjs` did the same and wrote twelve files. Both were
 * discovered by accident, while testing something else.
 *
 * The same survey found a DEAD FLAG this would have caught years earlier: `collect.yml`
 * passed `--max-scrapes` to `research.mjs`, which has no such flag. The page budget it
 * appeared to set was really coming from `plan.maxScrapes`, written by an earlier step. The
 * bound was real; the flag asserting it was decoration, and nothing said so.
 *
 * Three entrypoints already did this by hand (`artifact.mjs`, `collect-remote.mjs`,
 * `disclosure.mjs`). Eight did not. This is that check, in one place.
 *
 * Two more refusals of the same kind live here, because every CLI already calls this with
 * its whole flag list (found 2026-10-11):
 * - A known flag given twice is refused unless `repeatable` names it (#286). parseFlags
 *   collects a repeat into an array, and a CLI that reads `String(flags.out)` got "a,b" -
 *   `collect-remote --out a --out b` created a folder named `a,b`, and `new-project --topic a
 *   --topic b` scaffolded "Untitled topic" because the array was not a string.
 * - An argument the command does not take is refused (#289): `doctor /other/project`
 *   described the cwd in silence. `takes` is how many positionals the command reads. A word
 *   a bare flag took as its value (`--json word`) is given back and judged the same way by
 *   `checkFlagValues`, the one that knows which flags take a value.
 *
 * `report(problems, remedy)` replaces the stderr text - for a CLI whose failures are a JSON
 * payload in its `--json` mode (#294). The process still exits with `exit` if it returns.
 */
export function refuseUnknownFlags(flags, known, { help = '', exit = 2, note = null, repeatable = [], takes = 0, beside = null, report = null } = {}) {
  const allowed = new Set(known);
  const unknown = Object.keys(flags).filter((flag) => !allowed.has(flag));
  const problems = [];
  for (const flag of unknown) {
    problems.push(`unknown option --${flag}`);
    const why = note ? note(flag) : '';
    if (why) problems.push(why);
  }
  problems.push(...repeatedFlags(flags, repeatable));
  const argv = flags[ARGV];
  if (argv) Object.assign(argv, { takes, beside });
  const stray = (argv?.positional ?? []).slice(takes);
  if (stray.length) problems.push(strayArguments(stray, takes, beside));
  if (!problems.length) return;

  const remedy = unknown.length ? `known options: ${[...allowed].map((f) => `--${f}`).join(' ')}` : null;
  if (report) report(problems, remedy);
  else {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    if (remedy) process.stderr.write(`${remedy}\n`);
    if (remedy && help) process.stdout.write(help);
  }
  process.exit(exit);
}

/**
 * The line that refuses arguments a command does not read. `beside` names the flag that
 * leaves no room for one (`prior --file`, `evidence-context --all`): such a command does
 * take an argument, so "it runs on the current directory" would be the wrong advice.
 */
function strayArguments(stray, takes, beside = null) {
  const command = path.basename(process.argv[1] ?? 'this command', '.mjs');
  const quoted = stray.map((arg) => `"${arg}"`).join(', ');
  if (beside) return `${command} takes no arguments beside ${beside}, and ${quoted} would not be read`;
  return takes
    ? `${command} takes ${takes} argument${takes === 1 ? '' : 's'} at most, and ${quoted} would not be read`
    : `${command} takes no arguments, and ${quoted} would not be read: a gate or corpus command runs on the current directory - cd there first`;
}

// What `--flag=value` means on a flag that takes no value (2026-10-18): `--force=false` had
// read as TRUE, so `new-project --force=false` overwrote the files it was told to keep.
const BARE_ON = ['true', '1', 'yes', 'on'];
const BARE_OFF = ['false', '0', 'no', 'off'];

/**
 * The flags given more than once that are not `repeatable`, one problem line each. Exported
 * for the CLI that refuses unknown flags with its own wording (`artifact.mjs`).
 */
export function repeatedFlags(flags, repeatable = []) {
  return Object.keys(flags)
    .filter((name) => Array.isArray(flags[name]) && !repeatable.includes(name))
    .map((name) => `--${name} was given ${flags[name].length === 2 ? 'twice' : `${flags[name].length} times`} - give it once`);
}

/**
 * Refuse a flag given a bad value, or none, instead of replacing it with a default.
 *
 * `specs` maps a flag name to `'value'` (it must carry one), `{ choices: [...] }` or
 * `{ int: true, min }`. parseFlags reads a flag with no value as `true`, and each CLI
 * then fell back to its default in silence: `research --depth thorough` ran on quick's
 * budget, `install-hooks --mode block` saved a mode the edit gate reads as "ask", and
 * `new-project --topic` scaffolded "Untitled topic" (found 2026-09-27).
 *
 * `{ line: true }` is a value that names something on one line - a topic (#293): blank
 * after trimming is no value, and a line break is refused, because `"   "` scaffolded a
 * project decompose then called untitled, and `"a\nb"` broke the contract's heading in two.
 * The caller stores the trimmed value. `report` is refuseUnknownFlags' (#294).
 *
 * After refuseUnknownFlags, every known flag `specs` does not name takes no value, so a
 * word one of them took from the next argument is given back as the argument it was, in
 * its place, and refused unless the command `takes` it (#289): `doctor --json /other/project`
 * read the path as --json's value and described the cwd, and `new-project --force dir`
 * scaffolded the cwd. `--flag=value` on such a flag is read as asked: true, 1, yes or on
 * set it, false, 0, no or off leave it unset - `--force=false` had read as true and
 * overwritten files - and any other value is refused by name.
 */
export function checkFlagValues(flags, specs, { exit = 2, report = null } = {}) {
  const problems = [];
  const argv = flags[ARGV];
  if (argv?.takes !== undefined) {
    const freed = argv.took.filter(({ name }) => !(name in specs) && typeof flags[name] === 'string');
    for (const { name, word, at } of [...freed].reverse()) {
      flags[name] = true;
      argv.positional.splice(at, 0, word);
    }
    const stray = argv.positional.slice(argv.takes);
    argv.took.length = 0;
    if (stray.length) {
      for (const { name, word } of freed) if (stray.includes(word)) problems.push(`--${name} takes no value, so "${word}" after it is an argument`);
      problems.push(strayArguments(stray, argv.takes, argv.beside));
    }
    // What is left as a string on a bare flag was written `--flag=value`.
    for (const name of Object.keys(flags).filter((key) => !(key in specs) && typeof flags[key] === 'string')) {
      const said = flags[name].trim().toLowerCase();
      if (BARE_ON.includes(said)) flags[name] = true;
      else if (BARE_OFF.includes(said)) delete flags[name];
      else problems.push(`--${name} takes no value (or true or false), not "${flags[name]}"`);
    }
  }
  for (const [name, spec] of Object.entries(specs)) {
    if (!(name in flags)) continue;
    for (const value of [].concat(flags[name])) {
      if (value === true || value === '' || (spec?.line && !value.trim())) { problems.push(`--${name} needs a value`); continue; }
      if (spec?.line && /[\r\n]/.test(value)) {
        problems.push(`--${name} must be one line`);
      } else if (spec?.choices && !spec.choices.includes(value)) {
        problems.push(`--${name} must be one of ${spec.choices.join(', ')}, not "${value}"`);
      } else if (spec?.int && !(/^-?\d+$/.test(String(value)) && Number(value) >= (spec.min ?? -Infinity) && Number(value) <= (spec.max ?? Infinity))) {
        const range = spec.min !== undefined && spec.max !== undefined ? ` from ${spec.min} to ${spec.max}`
          : spec.min !== undefined ? ` of at least ${spec.min}` : spec.max !== undefined ? ` of at most ${spec.max}` : '';
        problems.push(`--${name} must be a whole number${range}, not "${value}"`);
      }
    }
  }
  if (!problems.length) return;
  if (report) report(problems, null);
  else for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(exit);
}

/**
 * Block for `ms`. The fetch adapters are synchronous by contract - they reach the vendor
 * through `spawnSync` - so a rate-limit wait cannot be awaited without changing that
 * contract everywhere. `Atomics.wait` on a private buffer is the sanctioned way to do
 * this; a spin loop would burn a core for the length of the wait.
 */
export function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A command that runs one of this kit's entrypoints, spelled so it works from any folder:
 * `node <full path of the running kit>/bin/<script>`.
 *
 * Every hint and remedy the kit prints to a terminal is built here. They used to say
 * "node fetchproof/bin/...", which exists only at the repository root - so from a project
 * folder, the very place the kit is used, copying a fix produced MODULE_NOT_FOUND (found
 * 2026-09-27 following the README on a fresh machine). Text written INTO a project's files
 * (the brief, the timeline) is spelled by `documentCommand` instead: those files travel.
 */
export function kitCommand(script, args = '') {
  return spellCommand(fileURLToPath(new URL(`../bin/${script}`, import.meta.url)), args);
}

/**
 * A command written INTO a project file that travels - the brief, the timeline.
 *
 * Those files said "node fetchproof/bin/...", which runs only at the kit repository's root,
 * and an absolute path runs only on the machine that wrote it. When the running kit is the
 * standard install it is spelled `"$HOME/.agents/fetchproof/..."`, which ADR-0050 showed
 * reaches node whole in PowerShell, bash and zsh on any machine with that install. A kit
 * anywhere else - a repository checkout - has only its real path. Compared by real path,
 * because node runs a symlinked kit from its target.
 */
export function documentCommand(script, args = '', { kit = fileURLToPath(new URL('..', import.meta.url)), home = homeDir(), root = null } = {}) {
  // The project's own spelling wins (ADR-0084): new-project records the --kit it wrote into
  // every scaffolded file, and a brief that named this machine's checkout instead sat in a
  // project whose AGENTS.md said $HOME (found 2026-09-28 on MoonAliza).
  const recorded = root ? projectKitPath(root) : null;
  if (recorded) return `node "${recorded}/bin/${script}"${args ? ` ${args}` : ''}`;
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  // A kit INSIDE the project - the kit's own repository, or a project that vendors it - travels
  // with the file, so it is spelled from the project root, where the kit's commands are run.
  // The absolute path made the committed research/TIMELINE.md unreproducible on any other
  // checkout (found 2026-09-29, break-test).
  if (root) {
    const inside = path.relative(real(root), real(kit));
    if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) {
      const rel = [...inside.split(path.sep), 'bin', script].join('/');
      return `node ${/\s/.test(rel) ? `"${rel}"` : rel}${args ? ` ${args}` : ''}`;
    }
  }
  if (real(kit) === real(path.join(home, '.agents', 'fetchproof'))) return homeCommand(script, args);
  return spellCommand(path.join(kit, 'bin', script), args);
}

/**
 * How this project spells the kit: `kitPath` in research/kit.json, written by new-project
 * from --kit. Null for a project scaffolded before it was recorded, or an unreadable file -
 * the caller then falls back to the running kit's spelling.
 */
export function projectKitPath(root) {
  try {
    const value = parseJson(readText(path.join(root, ...PATHS.kit.split('/'))) ?? 'null')?.kitPath;
    return typeof value === 'string' && value.trim() && !/[\r\n"]/.test(value) ? value.trim() : null;
  } catch { return null; }
}

/** `node "$HOME/.agents/fetchproof/bin/<script>"`: the standard install, spelled for any reader's shell (ADR-0050). */
export function homeCommand(script, args = '') {
  return `node "$HOME/.agents/fetchproof/bin/${script}"${args ? ` ${args}` : ''}`;
}

/**
 * `node <file> [args]`, the file double-quoted as it is when it holds a space (ADR-0050).
 * It was JSON.stringify, which doubled every backslash of a Windows path.
 */
export function spellCommand(file, args = '') {
  const spelled = /\s/.test(file) ? `"${file}"` : file;
  return `node ${spelled}${args ? ` ${args}` : ''}`;
}

/**
 * One page's identity across its spellings: host without www., path without a trailing
 * slash, query kept. Lives here so the checks can compare a row's URL with its capture's
 * without loading the collector (research-run re-exports it).
 */
export function urlKey(url) {
  try {
    const parsed = new URL(String(url));
    const host = parsed.host.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `//${host}${path}${parsed.search}`;
  } catch {
    return String(url ?? '');
  }
}
