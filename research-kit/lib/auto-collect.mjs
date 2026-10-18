// auto-collect.mjs - the collector listening for builder requests (ADR-0148).
//
// One cycle: pull, read `research/requests/`, and for each request without a result either
// refuse it (with the reasons, written beside it) or collect it - the SAME research.mjs an
// operator runs, then preflight - and commit the corpus with its ledger and push. The builder
// pulls and reads the result.
//
// What it never does, because the kit's rules say so:
//   - collect on a machine that may not (collectionPolicy, ADR-0010) - it refuses to start;
//   - pass --fallback. When the credits run out the run stops (ADR-0129), auto-collect pauses,
//     and the operator decides; nothing is retried until he resumes;
//   - spend past the daily page cap or the per-request cap;
//   - commit over somebody's unfinished work: research/ must be clean before a run, because
//     the commit takes everything under it;
//   - write a new topic over an existing project (ADR-0056): a topic request gets a new
//     folder under the one the operator approved, and waits while none is (ADR-0173).
// Every command it runs is a fixed argument list; nothing from a request reaches one except
// through the files it writes.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readJson, today, urlKey, writeJson } from './core.mjs';
import { collectionPolicy } from './machine.mjs';
import { readLedger } from './corpus.mjs';
import {
  REQUESTS_DIR, REQUEST_LIMITS, listRequests, requestProblemsResolved, requestPages, contractUnknownStatus, applyRequest, writeResult,
  readAutoCollect, reserveCollection, settleCollection, setPaused, recordTrustedResult, isTrustedResult,
} from './requests.mjs';

export const RUN_OUTPUT_BYTES = 64 * 1024;
const LEDGER = 'research/raw/.fetches.jsonl';
const USAGE = 'research/raw/.usage.jsonl';
const NO_TOPICS_FOLDER = 'this collector has no folder approved for new topics; the operator sets one in the panel';
const DIRTY = 'research/ has uncommitted changes; auto-collect waits until they are committed, because its commit takes everything under research/';

// The fixed research child sends this private packet, not a line a query/URL can print.
// Keep the packet's type, sizes and admitted page allowance checked at the parent boundary.
function accountingProblem(message, pages) {
  if (!message || typeof message !== 'object' || Array.isArray(message)
    || Object.keys(message).length !== 3 || message.type !== 'research-kit-accounting'
    || !Number.isSafeInteger(message.spent) || message.spent < 0
    || typeof message.stoppedOn !== 'string' || message.stoppedOn.length > 80
    || (message.stoppedOn !== '' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(message.stoppedOn))) {
    return 'invalid collection accounting message';
  }
  return message.spent > pages ? 'collection accounting exceeds the admitted page allowance' : '';
}

/** `node`/`git` as a child: resolves `{ code, output }`, never rejects.
 * `accountingPages` is private to the fixed research child; other commands have no IPC.
 */
export function execFile(command, args, { cwd, env, timeout = 30 * 60 * 1000, accountingPages = null } = {}) {
  return new Promise((resolve) => {
    let output = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let accounting = null;
    let accountingError = '';
    let messages = 0;
    const expectsAccounting = Number.isSafeInteger(accountingPages) && accountingPages >= 0;
    // Other commands retain their historical larger prefix (git's output is also data).
    // Research diagnostics use a smaller tail; neither buffer supplies its accounting.
    const outputLimit = expectsAccounting ? RUN_OUTPUT_BYTES : RUN_OUTPUT_BYTES * 4;
    const keep = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      if (!expectsAccounting) {
        const room = outputLimit - output.length;
        truncated ||= bytes.length > room;
        output = Buffer.concat([output, bytes.subarray(0, room)]);
      } else if (bytes.length >= outputLimit) {
        truncated ||= output.length + bytes.length > outputLimit;
        output = Buffer.from(bytes.subarray(-outputLimit));
      } else {
        const room = outputLimit - bytes.length;
        truncated ||= output.length > room;
        output = Buffer.concat([output.subarray(-room), bytes]);
      }
    };
    const result = (code, signal = null) => ({
      code, signal, timedOut, truncated,
      output: `${truncated ? `[... ${expectsAccounting ? 'earlier' : 'later'} output truncated ...]\n` : ''}${output.toString('utf8')}`,
      ...(expectsAccounting ? { accounting, accountingError: accountingError || (messages === 0 ? 'missing collection accounting message' : '') } : {}),
    });
    let child;
    try {
      child = spawn(command, args, { cwd, env, windowsHide: true,
        stdio: expectsAccounting ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      keep(`could not start ${command}: ${err.message}\n`);
      resolve(result(null));
      return;
    }
    if (expectsAccounting) child.on('message', (message) => {
      messages += 1;
      if (messages !== 1) {
        accounting = null;
        accountingError = 'multiple collection accounting messages';
        return;
      }
      accountingError = accountingProblem(message, accountingPages);
      if (!accountingError) accounting = { type: message.type, spent: message.spent, stoppedOn: message.stoppedOn };
    });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (err) => keep(`could not start ${command}: ${err.message}\n`));
    // Receipt, not exit zero or the child's send callback, establishes the measurement.
    child.on('close', (code, signal) => { clearTimeout(timer); resolve(result(code, signal)); });
  });
}

const tail = (s, n = RUN_OUTPUT_BYTES) => {
  const text = String(s ?? '');
  const bytes = Buffer.from(text, 'utf8');
  return bytes.length > n ? `[... earlier output truncated ...]\n${bytes.subarray(-n).toString('utf8')}` : text;
};
const lastLine = (s) => tail(String(s ?? '').trim().split(/\r?\n/).filter(Boolean).pop() ?? '', 1000);
// Git puts the cause before multi-line advice; kit run summaries still use lastLine.
const gitReason = (output) => {
  const cause = String(output ?? '').split(/\r?\n/).find((line) => /^(fatal|error):/.test(line));
  return cause === undefined ? lastLine(output) : tail(cause, 1000);
};
const posix = (p) => p.split(path.sep).join('/');
const byteSize = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };
/** The JSON lines appended to `file` after it was `before` bytes long; an unreadable line is skipped. */
function appendedLines(file, before) {
  let text = '';
  try { text = fs.readFileSync(file).subarray(before).toString('utf8'); } catch { return []; }
  return text.split(/\r?\n/).filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/** Legacy diagnostic parser. Collection accounting never trusts human-readable logs. */
export function spentPages(output) {
  const m = /^spent\s+(\d+)/m.exec(String(output));
  return m ? Number(m[1]) : 0;
}

/** Legacy diagnostic parser. The collection pause decision uses the private child packet. */
export function creditsStopped(output) {
  return /^stopped\s+credits ran out on (\S+)/m.exec(String(output))?.[1] ?? '';
}

/**
 * Build the listener. `project` is a function, because the panel's project can change;
 * `exec` and `git` are injectable so tests drive it with stand-in scripts.
 */
export function createAutoCollect({
  project,
  env = process.env,
  kitRoot,
  nodePath = process.execPath,
  exec = execFile,
  redact = (s) => s,
  lock = null,
} = {}) {
  // One mutex shared with whatever else touches the project (the panel's command runs and
  // project switch): a cycle mutates the corpus, so nothing else runs beside it.
  let held = '';
  const mutex = lock ?? {
    take(name) { if (held) return false; held = name; return true; },
    release(name) { if (held === name) held = ''; },
  };
  let busy = false;
  let timer = null;
  let lastCheck = '';
  const notes = [];
  const runs = new Map();
  const delivered = new Set();

  const note = (line) => { notes.push(`${new Date().toISOString()} ${redact(line)}`); if (notes.length > 50) notes.shift(); };
  const kit = (script, args, cwd, commandEnv = env, accountingPages = null) => exec(nodePath, [path.join(kitRoot, 'bin', script), ...args],
    { cwd, env: commandEnv, ...(accountingPages === null ? {} : { accountingPages }) });
  const git = (args, cwd) => exec('git', args, { cwd, env });

  const cacheKey = (dir, id) => `${canonical(dir)}\0${id}`;

  async function repoTop(dir) {
    const r = await git(['rev-parse', '--show-toplevel'], dir);
    if (r.truncated) { note('repository inspection was refused: Git output was truncated; inspect it manually'); return ''; }
    return r.code === 0 ? canonical(r.output.trim()) : '';
  }

  // git reports the top level by its final path; the project may arrive by another spelling
  // of the same folder (a Windows 8.3 short name such as RUNNER~1, a symlinked temp dir), and
  // path.relative between two spellings walks out of the repository.
  function canonical(dir) {
    try { return fs.realpathSync.native(dir); } catch { return path.resolve(dir); }
  }

  /**
   * Stage only this run's paths in a private index, leaving every existing staged file alone.
   * `pushOnly` pushes a delivery commit already made and never stages: a retry for a result
   * that is committed must not fall through to staging when the commit is not where it looked.
   */
  async function commitAndPush(top, paths, report, { pushOnly = false } = {}) {
    const upstreamBefore = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], top);
    if (upstreamBefore.truncated) return 'could not inspect upstream: Git output was truncated; deliver manually';
    if (pushOnly && upstreamBefore.code !== 0) return 'no upstream to push to';
    if (upstreamBefore.code === 0) {
      const ahead = await git(['rev-list', '--count', '@{u}..HEAD'], top);
      if (ahead.truncated) return 'could not inspect local commits: Git output was truncated; deliver manually';
      const count = Number(ahead.output.trim());
      if (ahead.code !== 0) return `could not inspect local commits: ${gitReason(ahead.output)}`;
      if (!/^\d+$/.test(ahead.output.trim()) || !Number.isSafeInteger(count)) {
        return 'could not inspect local commits: invalid Git ahead count; deliver manually';
      }
      if (count > 0) {
        if (count !== 1) return 'local commits are ahead of the upstream; push them manually before auto-collect delivery';
        const subject = await git(['log', '-1', '--format=%s'], top);
        if (subject.truncated) return 'could not inspect pending commit subject: Git output was truncated; deliver manually';
        if (subject.code !== 0 || subject.output.trim() !== report.subject) {
          return 'an unrelated local commit is ahead of the upstream; push it manually before auto-collect delivery';
        }
        const changed = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'], top);
        if (changed.truncated) return 'could not inspect pending commit paths: Git output was truncated; deliver manually';
        if (changed.code !== 0) return `could not inspect pending delivery commit: ${gitReason(changed.output)}`;
        const allowed = changed.output.split('\0').filter(Boolean).every((file) => paths.some((base) => (
          file === base || file.startsWith(`${base.replace(/\/$/, '')}/`)
        )));
        if (!allowed) return 'the pending auto-collect commit contains paths outside this request; push it manually';
        const pushed = await git(['push'], top);
        return pushed.code === 0 ? 'pushed' : `push failed: ${gitReason(pushed.output)}`;
      }
      if (pushOnly) return 'delivery blocked: no delivery commit is ahead of the upstream; inspect it manually';
    }
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'research-kit-autocollect-index-'));
    const indexEnv = { ...env, GIT_INDEX_FILE: path.join(scratch, 'index') };
    const isolatedGit = (args) => exec('git', args, { cwd: top, env: indexEnv });
    try {
      const initialized = await isolatedGit(['read-tree', 'HEAD']);
      if (initialized.code !== 0) return `could not initialize isolated git index: ${gitReason(initialized.output)}`;
      for (const p of paths) {
        const r = await isolatedGit(['add', '--', p]);
        if (r.code !== 0) return `git add ${p} failed: ${gitReason(r.output)}`;
      }
      for (const p of paths) {
        if (!(p === 'research' || p.endsWith('/research'))) continue;
        const ledger = path.posix.join(p.slice(0, -'research'.length) || '.', LEDGER);
        if (fs.existsSync(path.join(top, ledger))) {
          const r = await isolatedGit(['add', '-f', '--', ledger]);
          if (r.code !== 0) return `git add -f ${ledger} failed: ${gitReason(r.output)}`;
        }
      }
      const staged = await isolatedGit(['diff', '--cached', '--quiet']);
      if (staged.code !== 0 && staged.code !== 1) return `could not inspect isolated git index: ${gitReason(staged.output)}`;
      const hasChanges = staged.code !== 0;
      if (hasChanges) {
        const c = await isolatedGit(['commit', '-m', report.subject, '-m', report.body]);
        if (c.code !== 0) return `commit refused: ${gitReason(c.output)}`;
        const reset = await git(['reset', '--quiet', 'HEAD', '--', ...paths], top);
        if (reset.code !== 0) return `committed; could not refresh staged paths: ${gitReason(reset.output)}`;
      }
      const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], top);
      if (upstream.truncated) return `${hasChanges ? 'committed; ' : ''}could not inspect upstream: Git output was truncated; deliver manually`;
      if (upstream.code !== 0) return hasChanges ? 'committed; no upstream to push to' : 'no upstream to push to';
      const pushed = await git(['push'], top);
      if (pushed.code !== 0) return hasChanges ? `committed; push failed: ${gitReason(pushed.output)}` : `push failed: ${gitReason(pushed.output)}`;
      return hasChanges ? 'committed and pushed' : 'pushed';
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  const report = (subject, changed, why, verified, wrong = 'nothing to report') => ({
    subject,
    // Reports enter Git history; presentation-only scrubbing is too late for them.
    body: redact(`what changed: ${changed}\nwhy: ${why}\nwhat you verified: verified ${verified}\nwhat you got wrong: ${wrong}`),
  });

  function inside(root, target) {
    const rel = path.relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  function throughExistingAncestor(target) {
    let current = path.resolve(target);
    const suffix = [];
    for (;;) {
      try {
        fs.lstatSync(current);
        return path.resolve(fs.realpathSync.native(current), ...suffix);
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return path.resolve(current, ...suffix);
        suffix.unshift(path.basename(current));
        current = parent;
      }
    }
  }

  function hasSymlinkComponent(root, target) {
    let current = root;
    for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try { if (fs.lstatSync(current).isSymbolicLink()) return true; } catch { /* not created yet */ }
    }
    return false;
  }

  async function safeTopicTarget(top, target, topicsFolder) {
    const lexical = path.resolve(target);
    const relative = path.relative(top, lexical);
    if (!inside(top, lexical)) return { problem: 'the folder for new topics is outside the repository' };
    if (relative.split(path.sep).some((part) => part.toLowerCase() === '.git')) {
      return { problem: 'new topics cannot be created in Git metadata' };
    }
    if (hasSymlinkComponent(top, lexical)) return { problem: 'new topics cannot be created through a symbolic link' };
    const physical = throughExistingAncestor(lexical);
    if (!inside(canonical(top), physical)) return { problem: 'the approved topics folder resolves outside the repository' };
    const gitDir = await git(['rev-parse', '--absolute-git-dir'], top);
    if (gitDir.truncated) return { problem: 'could not inspect Git metadata: Git output was truncated; inspect the target manually' };
    if (gitDir.code !== 0) return { problem: `could not inspect Git metadata: ${gitReason(gitDir.output)}` };
    if (gitDir.code === 0 && inside(canonical(gitDir.output.trim()), physical)) {
      return { problem: 'new topics cannot be created in Git metadata' };
    }
    if (topicsFolder) {
      const topics = throughExistingAncestor(path.resolve(top, ...topicsFolder.split('/')));
      if (!inside(topics, physical)) return { problem: 'the target resolves outside the approved topics folder' };
    }
    return { target: physical };
  }

  async function requestTopicTarget(top, target, topicsFolder, id) {
    const safe = await safeTopicTarget(top, target, topicsFolder);
    if (safe.problem) return safe;
    const topics = throughExistingAncestor(path.resolve(top, ...topicsFolder.split('/')));
    const base = path.basename(safe.target);
    const match = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(base);
    const date = match?.[1] ?? '';
    const parsedDate = date ? new Date(`${date}T00:00:00.000Z`) : null;
    const validDate = parsedDate && !Number.isNaN(parsedDate.valueOf())
      && parsedDate.toISOString().slice(0, 10) === date;
    if (path.dirname(safe.target) !== topics || !validDate || match[2] !== id) {
      return { problem: 'topic target is not the dated folder generated for this request' };
    }
    return safe;
  }

  function collectionPaths(top, dir, target) {
    const paths = [path.posix.join(relTo(top, target), 'research')];
    if (target !== dir) paths.unshift(relTo(top, target)), paths.push(path.posix.join(relTo(top, dir), REQUESTS_DIR));
    return paths;
  }

  async function deliveryFingerprint(top, paths, excludedPath) {
    const pathspecs = [...paths, `:(exclude)${excludedPath}`];
    const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...pathspecs], top);
    if (status.truncated) throw new Error('could not inspect pending delivery: Git output was truncated; deliver manually');
    if (status.code !== 0) throw new Error(`could not inspect pending delivery: ${gitReason(status.output)}`);
    const hash = crypto.createHash('sha256');
    hash.update(status.output);
    const diff = await git(['diff', '--binary', 'HEAD', '--', ...pathspecs], top);
    if (diff.truncated) throw new Error('could not fingerprint pending delivery: Git output was truncated; deliver manually');
    if (diff.code !== 0) throw new Error(`could not fingerprint pending delivery: ${gitReason(diff.output)}`);
    hash.update(diff.output);
    for (const record of status.output.split('\0')) {
      if (!record.startsWith('?? ')) continue;
      const file = record.slice(3);
      const absolute = path.resolve(top, file);
      const relative = posix(path.relative(top, absolute));
      if (relative === excludedPath) continue;
      let contents;
      try {
        const stat = fs.lstatSync(absolute);
        contents = stat.isSymbolicLink() ? fs.readlinkSync(absolute) : fs.readFileSync(absolute);
      } catch (err) { throw new Error(`could not fingerprint ${relative}: ${err.message}`); }
      hash.update(relative);
      hash.update(contents);
    }
    return hash.digest('hex');
  }

  /**
   * Where a trusted result stands against git: `uncommitted` (it never reached a commit),
   * `unpushed` (committed, not on the upstream yet), `delivered` (on the upstream, or committed
   * with no upstream to push to), or `{ problem }` when git's answer cannot be trusted.
   */
  async function pendingDelivery(top, resultRelative) {
    const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', resultRelative], top);
    if (status.truncated) return { problem: 'delivery blocked: Git output was truncated while inspecting the result; deliver manually' };
    if (status.code !== 0) return { problem: `could not inspect pending delivery: ${gitReason(status.output)}` };
    if (status.output) return { state: 'uncommitted' };
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], top);
    if (upstream.truncated) return { problem: 'could not inspect upstream: Git output was truncated; deliver manually' };
    if (upstream.code !== 0) return { state: 'delivered' };
    const diff = await git(['diff', '--quiet', '@{u}', 'HEAD', '--', resultRelative], top);
    if (diff.code === 0) return { state: 'delivered' };
    if (diff.code !== 1) return { problem: `could not compare the result with the upstream: ${gitReason(diff.output)}` };
    // A difference is a delivery to push only while HEAD is ahead of the upstream. A fetch
    // since the pull (an editor's autofetch) can move the upstream past HEAD with the
    // builder's own change to the result, and that is not this collector's to push over.
    const behind = await upstreamNotBehind(top);
    if (behind.notPulled) return { problem: `the upstream changed ${resultRelative} since the last pull; delivery waits for the next pull` };
    if (behind.problem) return behind;
    return behind.ahead > 0 ? { state: 'unpushed' } : { problem: `could not tell whether ${resultRelative} still has to be pushed; deliver manually` };
  }

  /** `{ ahead }` when the upstream is an ancestor of HEAD, else `{ problem }`. */
  async function upstreamNotBehind(top) {
    const ancestor = await git(['merge-base', '--is-ancestor', '@{u}', 'HEAD'], top);
    if (ancestor.code === 1) return { problem: 'the upstream has commits this checkout has not pulled; delivery waits for the next pull', notPulled: true };
    if (ancestor.code !== 0) return { problem: `could not compare HEAD with the upstream: ${gitReason(ancestor.output)}` };
    const count = await git(['rev-list', '--count', '@{u}..HEAD'], top);
    if (count.truncated) return { problem: 'could not inspect local commits: Git output was truncated; deliver manually' };
    const ahead = Number(count.output.trim());
    if (count.code !== 0) return { problem: `could not inspect local commits: ${gitReason(count.output)}` };
    if (!/^\d+$/.test(count.output.trim()) || !Number.isSafeInteger(ahead)) {
      return { problem: 'could not inspect local commits: invalid Git ahead count; deliver manually' };
    }
    return { ahead };
  }

  function relTo(top, abs) {
    const rel = posix(path.relative(top, abs));
    return rel === '' ? '.' : rel;
  }

  async function resumeInfo(top, dir, item, settings) {
    if (item.result?.status !== 'partial') return null;
    const resume = item.result.resume;
    if (!resume || typeof resume.target !== 'string' || typeof resume.unknown !== 'string'
      || !Number.isInteger(resume.remainingPages) || resume.remainingPages < 0 || resume.remainingPages > REQUEST_LIMITS.maxPages
      || !Number.isInteger(resume.pagesSpent) || resume.pagesSpent < 0) {
      throw new Error('partial request has invalid continuation state');
    }
    let target = path.resolve(top, resume.target);
    const relative = path.relative(top, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('partial request target is outside the repository');
    }
    if (item.request.topic) {
      if (!settings.topicsFolder) throw new Error('this collector has no folder approved for new topics');
      const safe = await requestTopicTarget(top, target, settings.topicsFolder, item.id);
      if (safe.problem) throw new Error(safe.problem);
      target = safe.target;
    } else if (target !== path.resolve(dir)) {
      throw new Error('partial request target does not match this project');
    }
    if (!fs.existsSync(path.join(target, `${REQUESTS_DIR}/${item.id}.plan.json`))) {
      throw new Error('partial request plan is missing');
    }
    const unknownStatus = contractUnknownStatus(target, resume.unknown);
    if (!unknownStatus) {
      throw new Error(`${resume.unknown} is not a row of research/DISCOVERY.md`);
    }
    if (unknownStatus === 'CLOSED') throw new Error(`${resume.unknown} is already CLOSED; a partial request cannot resume collection`);
    return { ...resume, target };
  }

  async function refuse(top, dir, item, problems) {
    problems = problems.map((problem) => redact(String(problem)));
    writeResult(dir, item.id, { status: 'refused', problems });
    recordTrustedResult(dir, item.id, env);
    const committed = await commitAndPush(top, [path.posix.join(relTo(top, dir), REQUESTS_DIR, `${item.id}.result.json`)],
      report(`research: refuse request ${item.id}`, `recorded request ${item.id} as refused`,
        'the request failed collector validation', `request validation named ${problems.length} problem(s)`));
    if (committed === 'committed and pushed' || committed === 'pushed') delivered.add(cacheKey(dir, item.id));
    runs.set(cacheKey(dir, item.id), { status: 'refused', detail: problems.join('; '), git: committed });
    note(`refused ${item.id}: ${problems.join('; ')}`);
  }

  async function collect(top, dir, item, settings, pages, resume) {
    const request = item.request;
    let target = resume?.target ?? dir;
    if (!resume && request.topic) {
      // The cycle holds such a request back; never scaffold at the repository's top instead.
      if (!settings.topicsFolder) { runs.set(cacheKey(dir, item.id), { status: 'waiting', detail: NO_TOPICS_FOLDER }); return; }
      const candidate = path.join(top, ...settings.topicsFolder.split('/'), `${today()}-${item.id}`);
      const safe = await safeTopicTarget(top, candidate, settings.topicsFolder);
      if (safe.problem) return refuse(top, dir, item, [safe.problem]);
      target = safe.target;
      if (fs.existsSync(target)) return refuse(top, dir, item, [`${relTo(top, target)} already exists; a new topic never goes over an existing project`]);
      const made = await kit('new-project.mjs', [target, `--topic=${request.topic}`], top);
      if (made.code !== 0) return fail(top, dir, item, target, `new-project failed: ${lastLine(made.output)}`, made.output);
      // The map's seeded checklist, searched but no page scraped: classifying it is the
      // builder's review step, and the pages are the request's to name.
      const mapped = await kit('decompose.mjs', ['--max-scrapes', '0'], target);
      if (mapped.code !== 0) return fail(top, dir, item, target, `decompose failed: ${lastLine(mapped.output)}`, mapped.output);
    } else if (!fs.existsSync(path.join(dir, 'research', 'plan.json')) || !fs.existsSync(path.join(dir, 'research', 'DISCOVERY.md'))) {
      return refuse(top, dir, item, ['this project has no research/plan.json and research/DISCOVERY.md to add the fact to']);
    }

    let applied;
    try {
      if (resume) {
        const planFile = `${REQUESTS_DIR}/${item.id}.plan.json`;
        const planPath = path.join(target, planFile);
        const plan = readJson(planPath, null);
        if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('partial request plan is invalid');
        plan.maxScrapes = pages;
        writeJson(planPath, plan);
        applied = { unknown: resume.unknown, planFile };
      } else {
        applied = applyRequest(target, item.id, request, pages);
      }
    } catch (err) { return refuse(top, dir, item, [err.message]); }
    runs.set(cacheKey(dir, item.id), { status: 'collecting', detail: `${pages} page(s) for ${applied.unknown}` });
    note(`collecting ${item.id}: up to ${pages} page(s) for ${applied.unknown}`);

    // Where this run's ledger entries start: what its fetches came to is read from them (#321).
    const ledgerBefore = readLedger(target).entries.length;
    const usageBefore = byteSize(path.join(target, USAGE));
    const requestEnv = { ...env, RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS: '0' };
    const reservation = reserveCollection(pages,
      redact(`collection is in flight for request ${item.id}; ${pages} page(s) reserved for the daily cap. Inspect the run before pressing Resume.`), env);
    const run = await kit('research.mjs', ['--plan', applied.planFile], target, requestEnv, pages);
    const paths = collectionPaths(top, dir, target);
    const measurementProblem = run.accountingError || accountingProblem(run.accounting, pages);
    if (measurementProblem) {
      const detail = `collection accounting unavailable (${measurementProblem}); ${pages} page(s) reserved for the daily cap, actual spend unknown`;
      settleCollection(reservation, null, redact(`${detail} during request ${item.id}. Inspect the run before pressing Resume.`), env);
      return fail(top, dir, item, target, detail, run.output, paths, (resume?.pagesSpent ?? 0) + pages, 'reserved');
    }
    const spent = run.accounting.spent;
    const stoppedOn = run.accounting.stoppedOn;
    const pauseReason = stoppedOn
      ? `credits ran out on ${stoppedOn} during request ${item.id}. Top up and press Resume, `
        + 'or finish it in a terminal - auto-collect never switches to the free transports by itself.'
      : run.timedOut || run.signal
        ? `research.mjs was interrupted during request ${item.id}; ${spent} page(s) measured this attempt. Inspect the run before pressing Resume.` : '';
    settleCollection(reservation, spent, redact(pauseReason), env);
    const output = `Accounting: ${spent} page(s) measured this attempt${stoppedOn ? `; credits ran out on ${stoppedOn}` : ''}.\n\nDiagnostic output (not accounting):\n${redact(tail(run.output))}`;

    if (stoppedOn) {
      // A stopped request keeps its target, contract row and unused allowance for the next cycle.
      const totalSpent = (resume?.pagesSpent ?? 0) + spent;
      const remainingPages = Math.max(0, pages - spent);
      const plan = readJson(path.join(target, applied.planFile), {});
      plan.maxScrapes = remainingPages;
      writeJson(path.join(target, applied.planFile), plan);
      writeResult(dir, item.id, {
        status: 'partial',
        detail: redact(`credits ran out on ${stoppedOn}`),
        pages: totalSpent,
        resume: { target: relTo(top, target), unknown: applied.unknown, remainingPages, pagesSpent: totalSpent },
      });
      // A fingerprint refusal must not turn a collector-written partial result into an
      // untrusted builder result after restart and spend the same allowance again.
      recordTrustedResult(dir, item.id, env);
      const resultRelative = path.posix.join(relTo(top, dir), REQUESTS_DIR, `${item.id}.result.json`);
      let fingerprint;
      try { fingerprint = await deliveryFingerprint(top, paths, resultRelative); } catch (err) {
        const refused = `delivery blocked: ${err.message}`;
        runs.set(cacheKey(dir, item.id), { status: 'partial', detail: `credits ran out on ${stoppedOn}`, pages: totalSpent, output, git: refused });
        note(`partial delivery for ${item.id} was not staged: ${err.message}`);
        return;
      }
      writeResult(dir, item.id, {
        status: 'partial',
        detail: redact(`credits ran out on ${stoppedOn}`),
        pages: totalSpent,
        resume: { target: relTo(top, target), unknown: applied.unknown, remainingPages, pagesSpent: totalSpent },
        deliveryFingerprint: fingerprint,
      });
      recordTrustedResult(dir, item.id, env);
      const committed = await commitAndPush(top, paths, report(
        `research: request ${item.id} partly collected`,
        `recorded partial collection for ${item.id} (${spent} page(s))`,
        'the provider stopped because its credits ran out',
        `research.mjs reported ${spent} page(s) spent and ${remainingPages} page(s) remaining`,
      ));
      runs.set(cacheKey(dir, item.id), { status: 'stopped', detail: `credits ran out on ${stoppedOn}`, pages: totalSpent, output, git: committed });
      note(`paused: credits ran out on ${stoppedOn} during ${item.id}`);
      return;
    }
    if (run.code !== 0 || run.timedOut || run.signal) return fail(top, dir, item, target,
      `research.mjs ${run.timedOut || run.signal ? 'was interrupted' : `exited ${run.code}`}: ${lastLine(run.output)}`,
      run.output, paths, (resume?.pagesSpent ?? 0) + spent, 'measured');

    const outcome = runOutcome(target, { ledgerBefore, usageBefore }, request, spent);
    const prior = resume?.pagesSpent ?? 0;
    // Nothing to read is a failed request, not a collection - unless an earlier attempt of a
    // resumed request already delivered pages (its partial result said so when it stopped).
    if (outcome.nothing && !prior) {
      return fail(top, dir, item, target, `no page was collected: ${outcome.named.join('; ')}`,
        run.output, paths, spent, 'measured', {
          pages: 0,
          failed: outcome.failed,
          next: 'the page could not be fetched (detail names why). Change the request - another owner page in "urls", or a search in "queries" - and push it; a changed request is processed again',
        });
    }

    const gate = await kit('preflight.mjs', [], target);
    const preflight = { code: gate.code, verdict: redact(lastLine(gate.output)) };
    // `pages` counts collected pages and `failed` the attempts that failed; together they are
    // the pages used, which is what the panel shows.
    const held = outcome.cached && !outcome.collected
      ? `nothing new was fetched: ${outcome.cached} page(s) this request asked for or its searches found were already captured (${outcome.heldUrls.slice(0, 5).join(', ')}${outcome.cached > 5 ? ', ...' : ''}) - read them in research/EVIDENCE.md and research/raw/. `
      : '';
    await recordResult(top, dir, item, {
      status: 'collected', unknown: applied.unknown, project: relTo(top, target), pages: prior + outcome.collected,
      ...(outcome.failed ? { failed: outcome.failed } : {}), ...(outcome.cached ? { cached: outcome.cached } : {}), preflight,
      next: `${held}pull and read the captures; report review-only gaps to the collector in prose. The collector records Findings, unknown closures, classified MAP and the current authored BRIEF. Run handoff, preflight and brief --state; build only after complete/current review. Request another fetch only for a missing external fact (ADR-0150)`,
    }, paths);
    const committed = await commitAndPush(top, paths, report(
      `research: collect request ${item.id}`,
      `collected ${item.id} for ${applied.unknown} (${outcome.collected} page(s)${outcome.failed ? `, ${outcome.failed} failed` : ''})`,
      'the builder requested a verified fact and the collector gathered its evidence',
      `research.mjs exited 0 and preflight exited ${gate.code}`,
    ));
    if (committed === 'committed and pushed' || committed === 'pushed') delivered.add(cacheKey(dir, item.id));
    runs.set(cacheKey(dir, item.id), { status: 'collected', detail: `${applied.unknown}; preflight exit ${gate.code}`, pages: prior + spent, output, git: committed });
    note(`collected ${item.id}: ${outcome.collected} page(s)${outcome.failed ? `, ${outcome.failed} failed` : ''}; ${committed}`);
  }

  /**
   * What a successful run's fetches came to (#321). Exit 0 and `spent` said "collected, 1 page"
   * for a request whose one URL did not resolve, and the builder was told to read captures that
   * were never written. Two records the run writes say more, and neither is accounting
   * (ADR-0149): the ledger (a failed fetch is an `op: 'fail'` entry with the transport's error -
   * a page attempt, not a page; the attempts stay charged as measured), and its usage line
   * (`.usage.jsonl`), whose `searchOutcomes` say what each search returned: the results it made
   * targets, the matching results already captured (`held`), none at all, or a failed ask. The
   * usage line is read only when this run appended exactly one, so another run's is never
   * taken for it.
   *
   * Only failures on this request's own targets count - its named pages and the pages its
   * searches returned - since an operator's run in a terminal can append to the same ledger.
   * A page already captured is there to read: a named page whose ledger's last word is a fetch,
   * or a held search result. `failed` needs positive evidence for every part of the request -
   * each named page failed or is gone by the ledger, each search failed, returned nothing, or
   * every page it made a target failed - never just "nothing new was fetched"; `named` then
   * says why, part by part.
   */
  function runOutcome(target, { ledgerBefore, usageBefore }, request, spent) {
    const entries = readLedger(target).entries;
    const asked = (request.urls ?? []).filter((url) => typeof url === 'string');
    const askedKeys = new Set(asked.map((url) => urlKey(url)));
    const usage = appendedLines(path.join(target, USAGE), usageBefore);
    const searches = usage.length === 1 && Array.isArray(usage[0]?.searchOutcomes) ? usage[0].searchOutcomes : null;
    const urlsOf = (list) => (Array.isArray(list) ? list.filter((url) => typeof url === 'string') : []);
    const searchTargets = new Set((searches ?? []).flatMap((o) => urlsOf(o?.targets)).map((url) => urlKey(url)));
    const searched = (request.queries ?? []).length > 0;
    const ours = (entry) => askedKeys.has(urlKey(entry.url))
      || (searches ? searchTargets.has(urlKey(entry.url)) : searched && Boolean(entry.discoveredBy));
    const failures = entries.slice(ledgerBefore).filter((entry) => entry.op === 'fail' && typeof entry.url === 'string' && ours(entry));
    const failed = Math.min(failures.length, spent);
    const collected = spent - failed;
    const lastWord = (url) => entries.filter((entry) => (entry.op === 'fail' || entry.op === 'scrape')
      && typeof entry.url === 'string' && urlKey(entry.url) === urlKey(url)).pop();
    const heldNamed = collected ? [] : asked.filter((url) => lastWord(url)?.op === 'scrape');
    const heldKeys = new Set(heldNamed.map((url) => urlKey(url)));
    const heldSearched = [...new Set((searches ?? []).flatMap((o) => urlsOf(o?.held)))].filter((url) => !heldKeys.has(urlKey(url)));
    const heldUrls = [...heldNamed, ...heldSearched];
    const cached = heldUrls.length;
    const said = (entry) => `${String(entry.url).slice(0, 200)} - ${String(entry.error ?? 'unknown failure').slice(0, 300)}`;
    const named = failures.slice(0, 5).map(said);
    if (failures.length > named.length) named.push(`and ${failures.length - named.length} more`);
    const kept = { collected, failed, cached, heldUrls, named, nothing: false };
    if (collected || cached) return kept;

    // Nothing landed and nothing is held: failed only where each part has its evidence.
    const failedHere = new Set(failures.map((entry) => urlKey(entry.url)));
    for (const url of asked) {
      if (failedHere.has(urlKey(url))) continue;
      const last = lastWord(url);
      if (last?.op !== 'fail') return kept;
      named.push(`${String(url).slice(0, 200)} - not fetched again; its last fetch failed: ${String(last.error ?? 'unknown failure').slice(0, 300)}`);
    }
    for (const query of (request.queries ?? []).map((q) => String(q).trim())) {
      const outcome = (searches ?? []).find((o) => o?.query === query.slice(0, 200));
      if (!outcome) return kept;
      const targets = urlsOf(outcome.targets);
      if (outcome.failed) named.push(`the search "${query.slice(0, 200)}" failed`);
      else if (outcome.results === 0) named.push(`the search "${query.slice(0, 200)}" returned no results`);
      else if (!(targets.length && targets.every((url) => failedHere.has(urlKey(url))))) return kept;
    }
    return { ...kept, nothing: true };
  }

  /**
   * Write a terminal result with the state of its collection paths beside it, as a partial
   * result is written (#325): a retry after a failed commit can then tell this run's own corpus
   * from anything written since. Without a fingerprint, a pending retry waits for the operator.
   */
  async function recordResult(top, dir, item, result, paths) {
    writeResult(dir, item.id, result);
    recordTrustedResult(dir, item.id, env);
    try {
      const fingerprint = await deliveryFingerprint(top, paths, path.posix.join(relTo(top, dir), REQUESTS_DIR, `${item.id}.result.json`));
      writeResult(dir, item.id, { ...result, deliveryFingerprint: fingerprint });
      recordTrustedResult(dir, item.id, env);
    } catch (err) {
      note(`${item.id}: no delivery fingerprint (${err.message}); a failed delivery will wait for the operator`);
    }
  }

  async function fail(top, dir, item, target, detail, output, paths = null, spent = 0, measurement = 'none', fields = {}) {
    detail = redact(String(detail));
    await recordResult(top, dir, item, { status: 'failed', detail, project: relTo(top, target), pages: spent, ...fields },
      collectionPaths(top, dir, target));
    const committed = await commitAndPush(top, paths ?? [path.posix.join(relTo(top, dir), REQUESTS_DIR)], report(
      `research: request ${item.id} failed`,
      `recorded request ${item.id} as failed with ${spent} page(s) ${measurement === 'reserved' ? 'used or reserved' : 'accounted'}`,
      detail,
      measurement === 'reserved' ? 'no valid accounting measurement was received; the remaining admitted allowance was reserved, not measured'
        : measurement === 'measured' ? 'the failed run retained its received accounting and any prior measured attempts'
          : 'the failure occurred before page collection',
    ));
    if (committed === 'committed and pushed' || committed === 'pushed') delivered.add(cacheKey(dir, item.id));
    const accountingLabel = measurement === 'reserved' ? detail
      : measurement === 'measured' ? `Accounting: ${spent} page(s) measured across this request's attempts.` : '';
    runs.set(cacheKey(dir, item.id), { status: 'failed', detail, pages: spent,
      output: `${accountingLabel ? `${redact(accountingLabel)}\n\n` : ''}Diagnostic output (not accounting):\n${redact(tail(output))}`, git: committed });
    note(`failed ${item.id}: ${detail}`);
  }

  /** Why auto-collect cannot run here, or ''. */
  function blocked() {
    const policy = collectionPolicy(env);
    return policy.mayCollect ? '' : `${policy.reason} - auto-collect runs only on the collector`;
  }

  /** One pass. `force` runs it while the mode is off (the panel's "Check now"). */
  async function cycle({ force = false } = {}) {
    if (busy) return status();
    const state = readAutoCollect(env);
    if (state.settings.mode === 'off' && !force) return status();
    const why = blocked();
    if (why) { note(why); return status(); }
    if (!mutex.take('auto-collect')) { note('another run holds the project; this check waits for the next one'); return status(); }
    busy = true;
    try {
      lastCheck = new Date().toISOString();
      const dir = canonical(project());
      const top = await repoTop(dir);
      if (!top) { note(`${dir} is not in a git repository; requests travel by git`); return status(); }
      const pulled = await git(['pull', '--ff-only'], top);
      if (pulled.code !== 0) note(`git pull did not run cleanly (${gitReason(pulled.output)}); collection blocked until synchronization succeeds`);
      const requests = pulled.code === 0 ? listRequests(dir) : [];

      for (const item of requests) {
        if (item.ignored) continue;
        if (item.result && !isTrustedResult(dir, item.id, env)) {
          note(`ignored untrusted result for ${item.id}; the collector will process the request`);
          item.result = null;
        }
        if (item.result && ['collected', 'failed', 'refused'].includes(item.result.status)) {
          const key = cacheKey(dir, item.id);
          if (!delivered.has(key)) {
            const resultRelative = path.posix.join(relTo(top, dir), REQUESTS_DIR, `${item.id}.result.json`);
            // `delivered` is a cache that a restart empties; git says whether the result
            // still has to travel (#325). One already upstream - or committed, with no
            // upstream to push to - has nothing to deliver, and staging for it would only
            // find the operator's work in progress.
            const pending = await pendingDelivery(top, resultRelative);
            if (pending.problem) {
              runs.set(key, { git: pending.problem });
              note(`delivery for ${item.id} was not retried: ${pending.problem}`);
              continue;
            }
            if (pending.state === 'delivered') { delivered.add(key); continue; }
            let pendingPaths = [resultRelative];
            if (typeof item.result.project === 'string' && ['collected', 'failed', 'refused'].includes(item.result.status)) {
              const target = path.resolve(top, item.result.project);
              const settings = readAutoCollect(env).settings;
              const safe = item.request?.topic
                ? settings.topicsFolder
                  ? await requestTopicTarget(top, target, settings.topicsFolder, item.id)
                  : { target: '', problem: 'no approved topic folder is configured' }
                : { target: target === path.resolve(dir) ? target : '', problem: '' };
              if (!safe.problem && safe.target && path.resolve(safe.target) === target) {
                pendingPaths = collectionPaths(top, dir, target);
              }
            }
            if (pending.state === 'uncommitted') {
              // The result never reached a commit. If it stands alone, it is staged alone. If its
              // run's corpus is beside it, the fingerprint written with the result says whether
              // that is still exactly what the run left: then it is staged; if anything was written
              // since - the operator's work - nothing is staged and the operator commits it.
              const others = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--',
                ...pendingPaths, `:(exclude)${resultRelative}`], top);
              let blocked = others.truncated ? 'delivery blocked: Git output was truncated while inspecting research/; deliver manually'
                : others.code !== 0 ? `could not inspect pending delivery: ${gitReason(others.output)}` : '';
              if (!blocked && others.output) {
                let now = '';
                try { now = await deliveryFingerprint(top, pendingPaths, resultRelative); } catch (err) { blocked = `delivery blocked: ${err.message}`; }
                if (!blocked && (typeof item.result.deliveryFingerprint !== 'string' || now !== item.result.deliveryFingerprint)) {
                  blocked = `delivery waiting: ${resultRelative} and the corpus its run wrote are uncommitted, and something else under research/ changed after that run (another request's pending result, or an edit); nothing was staged. Once the other change is committed or delivered this delivery is retried, or commit it with git`;
                }
              } else if (!blocked) {
                pendingPaths = [resultRelative];
              }
              if (!blocked) {
                // Never commit on top of an upstream this checkout has not pulled.
                const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], top);
                if (upstream.truncated) blocked = 'could not inspect upstream: Git output was truncated; deliver manually';
                else if (upstream.code === 0) blocked = (await upstreamNotBehind(top)).problem ?? '';
              }
              if (blocked) {
                runs.set(key, { git: blocked });
                note(`delivery for ${item.id} was not staged: ${blocked}`);
                continue;
              }
            }
            const resultSubject = {
              collected: `research: collect request ${item.id}`,
              refused: `research: refuse request ${item.id}`,
              failed: `research: request ${item.id} failed`,
            }[item.result.status] ?? `research: deliver request ${item.id}`;
            const delivery = await commitAndPush(top, pendingPaths, report(
              resultSubject,
              `delivered the result and any pending corpus changes for ${item.id}`,
              'a previous collection, failure, or refusal recorded a result that still needs to reach the builder',
              'the result and associated corpus paths were staged in an isolated index and pushed when an upstream was available',
            ), { pushOnly: pending.state === 'unpushed' });
            if (delivery === 'committed and pushed' || delivery === 'pushed') delivered.add(key);
            runs.set(key, { git: delivery });
          }
          continue;
        }
        const current = readAutoCollect(env);
        if (item.parseError) { await refuse(top, dir, item, [item.parseError]); continue; }
        const problems = await requestProblemsResolved(item.request, current.settings);
        if (problems.length) { await refuse(top, dir, item, problems); continue; }
        // A missing topics folder is this collector's configuration, not the request's content:
        // the request waits for the operator, as it does while paused or over today's cap, and
        // nothing is written beside it (#323, ADR-0173). A refusal here was final, and the only
        // way back was for the builder to edit a request that was fine.
        if (item.request.topic && !current.settings.topicsFolder) {
          runs.set(cacheKey(dir, item.id), { status: 'waiting', detail: NO_TOPICS_FOLDER });
          continue;
        }
        let resume;
        try { resume = await resumeInfo(top, dir, item, current.settings); } catch (err) {
          await refuse(top, dir, item, [err.message]);
          continue;
        }
        const key = cacheKey(dir, item.id);
        if (item.result?.status === 'partial') {
          const pendingPaths = collectionPaths(top, dir, resume.target);
          const resultRelative = path.posix.join(relTo(top, dir), REQUESTS_DIR, `${item.id}.result.json`);
          let fingerprint;
          const pendingStatus = await git([
            'status', '--porcelain=v1', '-z', '--untracked-files=all', '--',
            ...pendingPaths, `:(exclude)${resultRelative}`,
          ], top);
          if (pendingStatus.truncated) {
            const detail = 'partial delivery blocked: Git output was truncated; deliver manually';
            note(`${item.id}: ${detail}`);
            runs.set(key, { status: 'partial', detail, git: detail });
            continue;
          }
          if (pendingStatus.code !== 0) {
            note(`partial delivery for ${item.id} could not inspect pending paths`);
            continue;
          }
          try { fingerprint = await deliveryFingerprint(top, pendingPaths, resultRelative); } catch (err) {
            note(`partial delivery for ${item.id} was not staged: ${err.message}`);
            runs.set(key, { status: 'partial', detail: 'delivery is pending; no further pages were collected', git: `delivery blocked: ${err.message}` });
            continue;
          }
          if (pendingStatus.output && (typeof item.result.deliveryFingerprint !== 'string' || fingerprint !== item.result.deliveryFingerprint)) {
            runs.set(key, { status: 'partial', detail: 'research/ changed since the failed delivery; review and commit it manually', git: 'delivery blocked by unexpected changes' });
            note(`partial delivery for ${item.id} was not staged because research/ changed after the failed attempt`);
            continue;
          }
          const delivery = await commitAndPush(top, pendingPaths, report(
            `research: request ${item.id} partly collected`,
            `committed or pushed the existing partial state for ${item.id}`,
            'the previous credit-limited run must reach the builder before resuming',
            'delivery was retried before pause, dirty-tree, and spend checks; no pages were fetched',
          ));
          runs.set(key, { status: 'partial', detail: 'retrying delivery before resume', git: delivery });
          if (delivery !== 'committed and pushed' && delivery !== 'pushed') {
            note(`partial delivery for ${item.id} is still pending: ${delivery}`);
            runs.set(key, { status: 'partial', detail: 'delivery is pending; no further pages were collected', git: delivery });
            continue;
          }
        }
        if (current.paused) {
          runs.set(key, { status: 'waiting', detail: 'auto-collect is paused', ...(runs.get(key)?.git ? { git: runs.get(key).git } : {}) });
          continue;
        }
        const pages = resume
          ? Math.min(resume.remainingPages, requestPages(item.request, current.settings.perRequestPages))
          : requestPages(item.request, current.settings.perRequestPages);
        if (current.spent.pages + pages > current.settings.dailyPages) {
          runs.set(key, { status: 'waiting', detail: `today's cap: ${current.spent.pages} of ${current.settings.dailyPages} page(s) used or reserved, this needs ${pages}` });
          continue;
        }
        const dirty = await git(['status', '--porcelain', '--', '.'], path.join(dir, 'research'));
        if (dirty.truncated) {
          runs.set(key, { status: 'waiting', detail: 'collection blocked: Git output was truncated while inspecting research/; inspect it manually' });
          continue;
        }
        if (dirty.code !== 0 || dirty.output.trim()) {
          runs.set(key, { status: 'waiting', detail: DIRTY });
          continue;
        }
        await collect(top, dir, item, current.settings, pages, resume);
      }
    } finally {
      busy = false;
      mutex.release('auto-collect');
    }
    return status();
  }

  function status() {
    const state = readAutoCollect(env);
    const dir = canonical(project());
    const requests = listRequests(dir).map((item) => {
      const run = runs.get(cacheKey(dir, item.id)) ?? {};
      const fact = item.request && typeof item.request.fact === 'string' ? item.request.fact.slice(0, 300) : '';
      if (item.ignored) return { id: item.id, status: 'ignored', detail: item.ignored };
      const result = item.result && isTrustedResult(dir, item.id, env) ? item.result : null;
      // Pages used: collected pages and failed attempts (#321).
      if (result) return { id: item.id, fact, status: result.status,
        pages: (Number.isInteger(result.pages) ? result.pages : 0) + (Number.isInteger(result.failed) ? result.failed : 0),
        detail: redact(result.status === 'refused' ? (result.problems ?? []).join('; ') : String(result.detail ?? result.unknown ?? '')),
        output: redact(run.output ?? ''), git: redact(run.git ?? '') };
      return { id: item.id, fact, status: run.status ?? 'queued', detail: redact(run.detail ?? ''), pages: run.pages ?? 0,
        output: redact(run.output ?? ''), git: redact(run.git ?? '') };
    });
    return {
      settings: state.settings,
      spent: state.spent,
      paused: redact(state.paused),
      blocked: redact(blocked()),
      busy,
      lastCheck,
      folder: posix(path.join(dir, REQUESTS_DIR)),
      requests,
      notes: notes.map((line) => redact(line)),
    };
  }

  /** (Re)arm the timer from the settings; off clears it. */
  function schedule() {
    if (timer) clearInterval(timer);
    timer = null;
    const { settings } = readAutoCollect(env);
    if (settings.mode === 'off') return;
    timer = setInterval(() => { cycle().catch((err) => note(`cycle failed: ${err.message}`)); }, settings.intervalMinutes * 60 * 1000);
    timer.unref?.();
  }

  function resume() {
    setPaused('', env);
    note('resumed by the operator');
    return status();
  }

  return { cycle, status, schedule, resume, stop() { if (timer) clearInterval(timer); timer = null; } };
}

/** The request file a builder writes, as text - for the panel's builder instructions. */
export function requestExample() {
  return `${JSON.stringify({
    fact: 'What is the burst limit of endpoint X on the free tier?',
    blocks: 'the retry and queue design',
    urls: ['https://docs.example.com/limits'],
    queries: ['example api free tier burst limit'],
    prefer: ['docs.example.com'],
  }, null, 2)}\n`;
}
