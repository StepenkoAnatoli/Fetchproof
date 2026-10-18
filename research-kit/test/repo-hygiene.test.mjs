// Properties of the REPOSITORY, not of the kit's code.
//
// The defect these exist for: `research/raw/.diagnostics.jsonl` was tracked from this
// repository's first commit until 2026-09-20 — added in the very same commit as the
// `.gitignore` rule that excludes it. `.gitignore` only governs UNTRACKED files, so a
// path that reaches the index once is tracked forever, silently, no matter what the
// ignore file says.
//
// The consequence was small per occurrence and endless in aggregate: `bin/gate.mjs`
// appends a line to that file on every invocation, so every commit-gate run, every
// edit-gate run, and every verification left the working tree dirty. A read-only check
// that modifies the repository it is checking is a contradiction, and under branch
// protection it becomes an obstruction as well.
//
// Neither the kit's tests nor its own gate could see it: both judge the corpus, and this
// is a fact about git's index.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, fs, path, KIT_ROOT, requireGit } from './harness.mjs';
import { missingKitLines } from '../lib/scaffold.mjs';

describe('repo-hygiene');

const REPO = path.resolve(KIT_ROOT, '..');

/** git, run in this repository. Returns null when git cannot answer. */
function git(args) {
  const result = spawnSync('git', ['-c', 'core.longpaths=true', ...args], {
    cwd: REPO, encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? '');
}

/**
 * Whether this checkout is a git repository at all, so the index-reading tests have
 * something to judge. A `git archive` tree (the ZIP download, CI's archive-tree job)
 * and a scaffolded copy have no `.git`, and there is genuinely nothing to check.
 *
 * `requireGit` comes FIRST, and it is the difference between a named UNSUP and a
 * silent pass. `git rev-parse` fails with the same shape for "git is not on PATH"
 * (spawn ENOENT, status null) as for "there is no repository here" (status 128), so
 * the old `if (!inGitRepo) return;` guard could not tell them apart: on a host with no
 * git every test in this file printed `ok` having asserted nothing - eleven green
 * lines over an unchecked repository, which is exactly the false green ADR-0021 and
 * the `Unsupported` mechanism exist to prevent (reproduced 2026-10-02, break-test:
 * `PATH` without git, `node research-kit/bin/selftest.mjs`).
 */
function inRepository() {
  requireGit("reading this repository's index");
  if (git(['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') return false;
  // Inside SOME work tree is not inside THIS repository's. A `git archive` tree or a ZIP
  // unpacked under a folder that is itself a repository - a monorepo, a home directory under
  // git - answers `true` here and every `git ls-files` below then describes that outer
  // repository, where the kit's files are untracked: "the fetch ledger is not tracked", "no
  // git hook is tracked", three red tests about a repository the kit is not in (found
  // 2026-10-02, break-test: the archive tree extracted into a scratch folder with a .git).
  const top = git(['rev-parse', '--show-toplevel'])?.trim();
  if (!top) return false;
  const same = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; } };
  return same(top, REPO);
}

/** Each path, with the ignore rule that matched it and the file that declared it. */
function whyIgnored(paths) {
  return paths.map((p) => {
    // `-v` prints `<source>:<line>:<pattern>`; `--no-index` because every offender here
    // is tracked, and check-ignore does not judge a tracked path without it.
    const why = git(['check-ignore', '-v', '--no-index', p]);
    return `${p}\n      ${why ? why.trim().split('\n').join('\n      ') : '(git could not say which rule matched)'}`;
  });
}

test('no ignored file is tracked', () => {
  if (!inRepository()) return;          // a scaffolded copy is not a git repository; nothing to check

  // `git ls-files -i -c --exclude-standard` lists exactly the contradiction: paths that
  // are in the index AND matched by an ignore rule.
  //
  // `core.excludesFile=` drops the USER-GLOBAL exclude file - `~/.config/git/ignore`, or
  // whatever `core.excludesFile` names. It is not a property of this repository, and it
  // used to turn this test red on a healthy one: a developer who globally ignores
  // `*.jsonl` got a failure over `docs/measurements/.../results.jsonl`, a tracked file
  // this repository's own .gitignore says nothing about, under a message telling them
  // to fix .gitignore (reproduced 2026-10-02, break-test, with `HOME` pointing at a
  // directory whose `.config/git/ignore` holds `*.jsonl`). The defect this test exists
  // for - `.diagnostics.jsonl` tracked AND matched by the repository's own .gitignore -
  // is still caught, because .gitignore is untouched by the override.
  // `.git/info/exclude` stays in scope: it is local to this repository, so a developer
  // can see and remove it.
  const listed = git(['-c', 'core.excludesFile=', 'ls-files', '-i', '-c', '--exclude-standard']);
  // `git()` answers null when git FAILED, and an empty list is the PASS here, so a git
  // that could not run used to look exactly like a repository with nothing to report.
  // Distinguish them: a check that could not run is not a pass (ADR-0021).
  assert.notEqual(listed, null,
    'git could not list this repository\'s index, so nothing was checked - fix git (a '
    + '30s timeout, a permission, or a "dubious ownership" refusal) and run again');
  const tracked = (listed ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

  assert.deepEqual(tracked, [],
    'these files are ignored by .gitignore and tracked anyway, so the ignore rule does '
    + 'nothing and they will keep appearing in every diff:\n  '
    // Name WHERE each one is ignored, so the cause is read rather than guessed at. A
    // `.gitignore` here is this repository's to fix; a `.git/info/exclude` is local to
    // this clone and is not. The plain list is in the diff below.
    + whyIgnored(tracked).join('\n  '));
});

test('the fetch ledger is tracked, and is NOT ignored', () => {
  if (!inRepository()) return;

  // The mirror of the test above. The ledger is the one dotfile under research/raw/ that
  // must travel — a corpus that arrives without it cannot pass its own gate. If a future
  // ignore rule swept it up with its neighbours, nothing else here would notice.
  const ledger = 'research/raw/.fetches.jsonl';
  const listed = (git(['ls-files', '--', ledger]) ?? '').trim();
  assert.equal(listed, ledger, `${ledger} is not tracked - the provenance chain would not travel`);

  // `--no-index` is load-bearing, not decoration. `git check-ignore` SKIPS tracked
  // paths unless it is given that flag - "tracked paths are not shown at all since
  // they are not subject to exclude rules" - and the ledger is tracked. Without it
  // this assertion answered "not ignored" for every rule anybody could write, so the
  // one regression it exists to catch (an ignore rule sweeping the ledger up with
  // its neighbours) sailed straight through. Reproduced 2026-10-02 (break-test):
  // deleting the `!research/raw/.fetches.jsonl` negation from .gitignore turned the
  // ledger into an ignored, tracked path, `git check-ignore -q` still exited 1, and
  // this test still printed `ok`.
  const ignored = git(['check-ignore', '-q', '--no-index', ledger]);
  assert.equal(ignored, null, `${ledger} is matched by an ignore rule; it is evidence and must travel`);

  // And the flag is still being passed. `-v` names the pattern that decided it; in a
  // healthy repository that is the negation in .gitignore, so a drop of `--no-index`
  // (empty output) and a positive rule (no `!`) both fail here rather than leaving a
  // check that cannot fail again.
  const decided = git(['check-ignore', '-v', '--no-index', ledger]);
  assert.match(decided ?? '', /:!research\/raw\/\.fetches\.jsonl\b/,
    `the ledger is decided by a positive ignore rule, or by nothing at all - the negation that keeps it travelling is gone:\n  ${decided ?? '(no output: git cannot answer, or --no-index was dropped)'}`);
});

test('the gate writes only to paths git is told to ignore', () => {
  // bin/gate.mjs appends to the diagnostics log on every run. That is acceptable ONLY
  // because the path is ignored; if the log ever moves somewhere tracked, every
  // verification starts dirtying the tree again and this test is the thing that says so.
  const source = fs.readFileSync(path.join(KIT_ROOT, 'bin', 'gate.mjs'), 'utf8');
  assert.ok(source.includes('recordDiagnostic'), 'the gate no longer records diagnostics; this test needs rewriting');

  if (!inRepository()) return;
  const ignored = git(['check-ignore', '-q', 'research/raw/.diagnostics.jsonl']);
  assert.notEqual(ignored, null,
    'the gate appends to research/raw/.diagnostics.jsonl on every invocation, and that '
    + 'path is no longer ignored - so every verification will dirty the working tree');
});

test('the kit README has no parent-relative link, because it ships standalone', () => {
  // `install.mjs` deploys research-kit/ to ~/.agents/research-kit with its README. There
  // is no ~/.agents/README.md, so a `](../README.md)` link is broken for everybody using
  // the installed kit - which is everybody not reading the repository. Absolute URLs
  // resolve from both places; a relative one resolves from exactly one.
  const readme = path.join(KIT_ROOT, 'README.md');
  if (!fs.existsSync(readme)) return;
  const text = fs.readFileSync(readme, 'utf8');
  const broken = text.split('\n')
    .map((line, i) => ({ line, at: i + 1 }))
    .filter(({ line }) => /\]\(\.\.\//.test(line))
    .map(({ line, at }) => `README.md:${at}  ${line.trim()}`);

  assert.deepEqual(broken, [],
    'these links assume a parent directory that does not exist in a deployed kit:\n  ' + broken.join('\n  '));
});

test('no collector byproduct is tracked at any depth', () => {
  // `.gitignore` rules with a slash in them are anchored to the file that declares them,
  // so the root rules cover `research/raw/` and nothing else. A NESTED decision project
  // (ADR-0030) is covered by its own `.gitignore` - which protects it only once that
  // project is committed.
  //
  // The window between is real and it caught me: a byproduct written into a nested
  // project on one branch survives the switch away as an untracked orphan, because it was
  // ignored there and so was never removed. `git add -A` on a branch that has not got
  // the nested ignore file yet then commits it.
  //
  // This asserts the invariant rather than the rules: these four are machine-local state,
  // they are never evidence, and they must not be in the index anywhere.
  if (!inRepository()) return;

  const byproducts = /(^|\/)\.(usage|diagnostics|failures)\.jsonl$|(^|\/)\.fetches\.lock$|(^|\/)overrides\.log$/;
  const index = git(['ls-files']);
  // Same guard as above: null is "git could not answer", not "the index is empty".
  assert.notEqual(index, null,
    'git could not list this repository\'s index, so nothing was checked - fix git (a '
    + '30s timeout, a permission, or a "dubious ownership" refusal) and run again');
  const tracked = (index ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const offenders = tracked.filter((f) => byproducts.test(f));

  assert.deepEqual(offenders, [],
    'these are machine-local byproducts and must never be tracked:\n  ' + offenders.join('\n  '));
});

// Found 2026-09-28 (Arena break test 7): ADR-0081 added `research/overrides.log` to the
// template and every nested project, but the root got only the any-depth form, which
// missingKitLines does not read as the template's line - so doctor warned
// shape-kit-rules-missing on every clean checkout of this repository.
test('every project in this repository carries the template .gitignore rules', () => {
  if (!inRepository()) return;
  const repo = path.resolve(KIT_ROOT, '..');
  const decisions = path.join(repo, 'docs', 'decisions');
  const projects = [repo, ...fs.readdirSync(decisions).map((d) => path.join(decisions, d))
    .filter((d) => fs.existsSync(path.join(d, 'research')))];
  const gaps = projects.map((d) => [path.relative(repo, d) || '.', missingKitLines(d, '.gitignore')])
    .filter(([, missing]) => missing.length).map(([d, missing]) => `${d}: ${missing.join(', ')}`);
  assert.deepEqual(gaps, [], 'doctor warns shape-kit-rules-missing for:\n  ' + gaps.join('\n  '));
});

// Found 2026-09-28, break-test: the root .gitattributes was replaced with one line and
// the suite stayed green. That file is the shield for every body hash in every corpus -
// a capture's hash is taken over LF bytes, and a default Windows checkout (core.autocrlf)
// smudges them to CRLF, so each hash stops recomputing and handoff and preflight report
// the corpus as damaged when nothing is wrong with it. The template's copy is pinned
// (scaffold.test.mjs) and the remedy is documented (ADR-0062), but the repository's own
// pin lines could be deleted silently - the failure they guard only appears on the next
// Windows checkout, as six named blockers about hashes nobody touched.
test('every project in this repository carries the template .gitattributes pins', () => {
  if (!inRepository()) return;
  const repo = path.resolve(KIT_ROOT, '..');
  const decisions = path.join(repo, 'docs', 'decisions');
  const projects = [repo, ...fs.readdirSync(decisions).map((d) => path.join(decisions, d))
    .filter((d) => fs.existsSync(path.join(d, 'research')))];
  const gaps = projects.map((d) => [path.relative(repo, d) || '.', missingKitLines(d, '.gitattributes')])
    .filter(([, missing]) => missing.length).map(([d, missing]) => `${d}: ${missing.join(', ')}`);
  assert.deepEqual(gaps, [],
    'these projects lose every corpus body-hash on a default Windows checkout:\n  ' + gaps.join('\n  '));
});

test('the ADR log has one file per number, and the index names them all', () => {
  // `docs/adr/README.md` is what a reviewer reads BEFORE suggesting a decision - a
  // recorded one that is missing from the index gets re-proposed, and two files with the
  // same number make every reference to it ambiguous ("per ADR-0042" - which one?).
  // Nothing judged this: adding `0042-duplicate-number.md` beside the real 0042, or a new
  // ADR that never reaches the index, left the suite green (found 2026-09-28, break-test).
  // The realistic path is two branches each adding "the next ADR" and merging cleanly.
  // A link may REPEAT (rows refine and supersede each other in prose); a FILE may not.
  const dir = path.join(path.resolve(KIT_ROOT, '..'), 'docs', 'adr');
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f));
  assert.ok(files.length >= 40, `expected a substantial ADR log, found ${files.length} files`);

  const byNumber = new Map();
  for (const f of files) {
    const list = byNumber.get(f.slice(0, 4)) ?? [];
    list.push(f);
    byNumber.set(f.slice(0, 4), list);
  }
  const forked = [...byNumber.entries()].filter(([, list]) => list.length > 1)
    .map(([n, list]) => `${n}: ${list.join(', ')}`);
  assert.deepEqual(forked, [], 'two ADRs share one number, so every reference to it is ambiguous:\n  ' + forked.join('\n  '));

  const index = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  const links = new Set([...index.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)].map((m) => m[1]));
  const unlisted = files.filter((f) => !links.has(f));
  assert.deepEqual(unlisted, [], 'these ADRs exist but are absent from docs/adr/README.md:\n  ' + unlisted.join('\n  '));
  const dangling = [...links].filter((f) => !fs.existsSync(path.join(dir, f)));
  assert.deepEqual(dangling, [], 'the index links ADRs that do not exist:\n  ' + dangling.join('\n  '));

  const brokenBodyLinks = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [, href] of source.matchAll(/\]\(([^)]+)\)/g)) {
      const target = href.trim().replace(/^<|>$/g, '').split('#', 1)[0];
      if (!target || target.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      const decoded = decodeURIComponent(target);
      if (!fs.existsSync(path.resolve(dir, decoded))) brokenBodyLinks.push(`${file}: ${href}`);
    }
  }
  assert.deepEqual(brokenBodyLinks, [], 'the ADRs link files that do not exist:\n  ' + brokenBodyLinks.join('\n  '));
});

test('the ledger is still not swept up by the broader rules', () => {
  // The mirror of the test above, and the reason it is worded as a denylist of four names
  // rather than "ignore everything hidden under research/raw". The chain is evidence and
  // must travel - including in a nested project.
  if (!inRepository()) return;
  const ledgers = (git(['ls-files']) ?? '').split('\n').map((l) => l.trim())
    .filter((f) => f.endsWith('research/raw/.fetches.jsonl'));

  assert.ok(ledgers.length >= 1, 'no fetch ledger is tracked anywhere; the corpus cannot prove itself');
  for (const ledger of ledgers) {
    // `--no-index` for the same reason as above: every one of these is TRACKED, and
    // `git check-ignore` does not judge a tracked path without it.
    assert.equal(git(['check-ignore', '-q', '--no-index', ledger]), null, `${ledger} is matched by an ignore rule; it is evidence and must travel`);
  }
});

test('every shipped git hook is tracked executable', () => {
  // ADR-0001's defect, asserted where a contributor meets it rather than only in CI.
  //
  // `githooks/pre-commit` shipped as mode 100644. git SILENTLY SKIPS a hook without the
  // executable bit - no warning, no non-zero exit - so the gate that is supposed to
  // refuse a bad commit reports a clean one instead. The mode is a property of git's
  // INDEX, not of the working tree, so a `chmod +x` on disk does not fix it and nothing
  // in the kit's own code can observe it.
  //
  // The offline suite checks this on Linux runners, which is a real guard but a late one:
  // the author's machine, and Windows, cannot see the regression before it is pushed.
  // Here it fails in `selftest`, which is the command the contributing docs name.
  if (!inRepository()) return;      // a scaffolded copy has no index to read modes from

  const hooks = (git(['ls-files', '-s', '--', 'research-kit/githooks']) ?? '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split('\t');
      return { mode: meta.split(/\s+/)[0], file };
    });

  assert.ok(hooks.length >= 1, 'no git hook is tracked; this test would pass vacuously');

  const notExecutable = hooks.filter((h) => h.mode !== '100755').map((h) => `${h.file} is mode ${h.mode}`);
  assert.deepEqual(notExecutable, [],
    'git SKIPS a non-executable hook without saying so, which reports a bad commit as clean.\n'
    + '  fix: git update-index --chmod=+x <path>\n  ' + notExecutable.join('\n  '));
});

// ADR-0116: the kit has one version, KIT_VERSION, and everything that states a version reads it.
// The MCP server announced 1.0.0 while nothing else named a version at all, so a tag, the
// server and the changelog could each say something different.
test('one kit version: the MCP server, doctor and the changelog all state KIT_VERSION', async () => {
  const { KIT_VERSION } = await import('../lib/core.mjs');
  const { SERVER_INFO } = await import('../lib/mcp.mjs');
  assert.match(KIT_VERSION ?? '', /^\d+\.\d+\.\d+$/, `KIT_VERSION is not a version: ${KIT_VERSION}`);
  assert.equal(SERVER_INFO.version, KIT_VERSION, 'the MCP server announces a different version');
  const changelog = fs.readFileSync(path.join(KIT_ROOT, '..', 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## ${KIT_VERSION.replace(/\./g, '\\.')} `, 'm'), 'the changelog has no entry for this version');
  const doctor = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'doctor.mjs'), '--json'], { cwd: KIT_ROOT, encoding: 'utf8' });
  assert.equal(JSON.parse(doctor.stdout).kitVersion, KIT_VERSION, 'doctor does not report the version it is');
});

// #297 (2026-10-17): ten `lib/` exports were referenced nowhere - not by a command, a hook, a
// test or another module - and two of them were named in the architecture map as part of
// their module's contract (`stagedPathsFromStdin`, `PROTOCOL_VERSION`) while the shipped code
// did the work another way. An export nothing calls is surface the freeze (ADR-0117) is meant
// to keep from growing, and a map row that names one misdirects its reader. This reads the
// files, not git's index, so it judges an archive tree the same way.
const UNREFERENCED_ON_PURPOSE = new Map([
  // ADR-0012's register of retired names: a future rename adds the old name here, and the
  // ADR's procedure names these constants. Nothing reads them yet.
  ['RETIRED_FLAGS', 'ADR-0012 register of retired CLI flags'],
  ['RETIRED_PROJECT_SKILL_DIRS', 'ADR-0012 register of retired project skill folders'],
]);

test('every lib/ export is referenced somewhere besides its own definition', () => {
  const THIS_FILE = fileURLToPath(import.meta.url);
  const counts = new Map();
  const readable = /\.(mjs|js|cjs|py|sh|ya?ml|html|json)$/;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      // githooks carry no extension; every other file is judged by its type.
      if (!readable.test(entry.name) && path.basename(dir) !== 'githooks') continue;
      // This file names the removed exports in prose; it is no reference to them.
      if (full === THIS_FILE) continue;
      let text;
      try { text = fs.statSync(full).size > 4 * 1024 * 1024 ? '' : fs.readFileSync(full, 'utf8'); } catch { continue; }
      for (const word of text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
  };
  for (const part of ['lib', 'bin', 'hooks', 'githooks', 'test', 'panel', 'conformance']) walk(path.join(KIT_ROOT, part));
  walk(path.join(REPO, '.github'));

  const lib = path.join(KIT_ROOT, 'lib');
  const unused = [];
  for (const file of fs.readdirSync(lib).filter((f) => f.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(lib, file), 'utf8');
    for (const [, name] of text.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if ((counts.get(name) ?? 0) < 2 && !UNREFERENCED_ON_PURPOSE.has(name)) unused.push(`lib/${file}: ${name}`);
    }
  }
  assert.deepEqual(unused, [], `exported and referenced nowhere else - delete it, or call it:\n  ${unused.join('\n  ')}`);
});
