# Build report — break-test, 2026-10-04 (pass 4)

The fourth adversarial pass over the build and the suite, run on `main` at `a4ae8f6` (kit 0.9.3,
after ADR-0139 and ADR-0140) with the break-test discipline: probes in an isolated worktree and
throwaway clones, every finding reproduced with a command whose output was observed, the smallest
fix for each as its own commit through the repository's gate, and everything that could not be
fixed under those conditions reported as a risk. The probing was delegated to a breaker agent;
the lead confirmed each reproduction before fixing. Nothing in the user's checkout was touched by
a probe.

**How the build is run.** `node fetchproof/bin/selftest.mjs` (the full offline suite),
`node fetchproof/bin/preflight.mjs` (PASS on the root corpus), `node fetchproof/bin/handoff.mjs`
(exit 0), `node fetchproof/bin/doctor.mjs` (READY). Node 22.22.2, Python 3.11.15, four cores.
CI runs the suite on ubuntu-latest, ubuntu-26.04 and windows-latest on Node 22, on Node 24 and 26
on ubuntu, and from a `git archive` tree.

**Baseline.** Five consecutive full runs in the worktree: `1585 passed, 0 failed`, 142 to 153 s
each; eight further full runs during the probes, no failure in any of them.

## What was probed, and what held

- Fresh clone: full suite green; `git status --ignored` after a run shows only
  `fetchproof/bin/__pycache__/` (finding 1); `timeline.mjs`, `export-warc.mjs` and the example
  run leave `git status --porcelain` empty, also under `TZ=Pacific/Kiritimati`,
  `TZ=America/St_Johns` and `LC_ALL=tr_TR.UTF-8`.
- Read-only checkout as an unprivileged user: 1585/0, no file newer than the run's start.
- Toolchain: Node 20 and 21 are refused by name (`selftest runs on Node 22 or newer`, exit 2);
  `preflight` on Node 20 still prints PASS and `doctor` names `fail node`; Python absent is
  `11 tests could not run`, exit 1, not a pass (ADR-0108).
- Environment: twenty variants of TMPDIR, HOME, LANG, TZ, NO_COLOR, CI, FORCE_COLOR, a stray
  `FETCHPROOF_*`, GIT_DIR and GIT_CONFIG_GLOBAL over four groups, all exit 0; the full suite
  under `LC_ALL=tr_TR.UTF-8 TZ=Pacific/Kiritimati`: 1585/0.
- Order and concurrency: all 76 groups individually green; the suite in reversed file order and
  two suites concurrently from two clones: green apart from `architecture-map` counting the
  probe's own copied runner (an artefact of the probe, not a defect).
- Limits: `ulimit -n 256` and `NODE_OPTIONS=--max-old-space-size=256`: 1585/0.
- The code merged on 2026-10-04: a deleted sibling is `raw-missing`, a CRLF-rewritten one is
  `line-endings` with the right remedy, a directory in its place `raw-unreadable`, a 16 MiB source
  `sourceOmitted`, a planted sibling `source-unnamed`, a sibling path out of the project
  `raw-outside`, a dangling link at the sibling's name left untouched; a stacked second table is
  `malformed-id`, a table ending at EOF without a newline parses whole, a stray row at EOF is
  `table-split`.
- Paths with spaces and non-ASCII characters, a symlinked parent, CRLF contract files, an
  EVIDENCE.md without a trailing newline, a `core.autocrlf=true` clone: PASS and handoff OK.
- All 30 nested corpora: preflight PASS, handoff exit 0.

## Discovered failures, and what was done

### 1. The suite's Python bytecode cache was deployed with the kit and counted as drift

**Repro**

```
node fetchproof/bin/selftest.mjs      # the conformance runners import conformance_common.py
node fetchproof/bin/doctor.mjs
```

**Observed.** `warn deploy the deployed kit is NOT this one - kit: 1 stale (e.g.
bin/__pycache__/conformance_common.cpython-311.pyc)`.

**Root cause.** `copyTree` and `listTree` in `lib/installer.mjs` skipped only `node_modules` and
`.git`; CPython writes `bin/__pycache__/` when the runners import `conformance_common.py`,
`.gitignore` hides it from git but not from the mirror.

**Severity: Low to medium, high likelihood.** Every developer machine that ran the suite before
`doctor` or `install` saw the warning.

**Fix.** Both walks skip `__pycache__`. **Tests:** `hardening > a Python bytecode cache in the
checkout is neither deployed nor counted as drift`. **Status: applied** (b672926). Suite green.

### 2. An old or broken Python was reported as "no python or python3 on this host"

**Repro**

```
PATH=<a folder whose python3 prints "Python 3.8.10">:<a folder with no python> \
  node fetchproof/bin/selftest.mjs ledger-conformance
```

**Observed.** `PYTHON-NOT-FOUND ... no python or python3 on this host`, the same words for an
interpreter that exits 1 and for one that hangs.

**Root cause.** `requirePython` in `test/harness.mjs` used one fixed sentence and dropped the
detail `checkPython` composes. **Severity: Low, medium likelihood** (Ubuntu 20.04 ships 3.8).

**Fix.** The reason carries `checkPython`'s detail: `python3 3.8.10; the conformance runners need
3.11+`. **Tests:** `harness > requirePython names the interpreter it rejected, not only its
absence`. **Status: applied** (64fe5ac). Suite green.

### 3. The runner creates whatever path TMPDIR names, recursively, and leaves it

**Repro.** `TMPDIR=/nonexistent/dir/xyz node fetchproof/bin/selftest.mjs checks` (exit 0);
`TMPDIR=relative-tmp ...` from the repository root.

**Observed.** The directory is created and left empty after the run; the relative one inside the
checkout (empty, so `git status` stays clean).

**Root cause.** `fs.mkdirSync(base, { recursive: true })` in `bin/selftest.mjs`, written on purpose:
the harness documents that TMPDIR may name a directory that does not exist yet (a CI job exports
RUNNER_TEMP before creating it) and that creating the parent turns a suite-wide abort into
nothing at all. **Severity: Low, low likelihood.** **Status: recorded, then fixed at the operator's
request.** The trade-off stands - the folder is still created - and what the run created it now
removes: `createTempFolder` in the harness records the ancestors that did not exist and `rmdir`s
them, deepest first, with the scratch at exit; non-recursive, so a folder that existed or that
holds somebody else's file stays. **Tests:** `harness > a temp folder the run had to create goes
with its scratch, and only while empty`. Both repros leave nothing behind.

### 4. A ledger entry naming a source without its hash passed with the sibling altered

**Repro.** Collect a page with a source sibling; rewrite the entry without `sourceSha256` and
recompute its `entrySha256`; overwrite the sibling.

**Observed.** `verifyLedger ok=true`, `handoff.mjs` exit 0.

**Root cause.** `if (!hash) continue;` in `verifyLedger` was written for the first ledgers'
captures, which carry no hash, and applied to sources, which never had a hashless era: a
rechained entry could name an unverifiable sibling. **Severity: Low, very low likelihood** (the
collector never writes that shape; defence in depth).

**Fix.** A source without a hash is a `body-unmodified/unhashed` problem, which the commit gate's
integrity rules already block on. **Tests:** `collect > ADR-0140: a ledger entry that names a
source without its hash is refused, not skipped`. **Status: applied** (92adaa8). Suite green;
all 31 real ledgers still verify.

### 5. Two wording defects

**(a)** A file under `research/raw` that no fetch produced drew `uncited-capture: ... was collected
but no evidence row cites it`. **Fix.** The sentence follows the ledger: a file no scrape entry
names is "under research/raw but no ledger entry records a fetch of it". **Tests:** `checks >
hygiene: an uncited capture no fetch produced is named as such, a collected one as collected`.
**Status: applied** (c722306). Suite green.

**(b)** A capture altered after its fetch gets the "something did not travel ... the remedy lives
on the COLLECTOR machine" remedy. **Status: decided against at first, then fixed at the operator's
request.** The pinned test (`a genuinely tampered capture still gets the PUSH remedy`) rested on
"the restoration is the collector's commit", which holds only when the change was committed - and
then a push sends the same bytes again; a change local to the checkout is one `git checkout HEAD --`
away. `alteredRemedy` in `lib/handoff.mjs` prints both cases, per file, and the report carries the
captures as `altered` instead of "did not travel". **Tests:** `handoff > a capture changed after its
fetch gets the ALTERED remedy, and no push remedy`; `handoff > the altered-capture remedy, run as
printed, restores a capture changed in this checkout`.

## External review of the F3 and F5b fixes (2026-10-04)

A second reader reviewed PR #241 on the PC checkout and reported five defects, each with a
reproduction; all five were verified here against the code before anything changed, and each
was fixed in its own commit, red-first, through the commit gate.

| # | Finding | Fix |
|---|---|---|
| 1 | An unquoted capture path holding a space is two pathspecs in cmd, PowerShell and sh: `git checkout HEAD --` restored two unrelated files and discarded their uncommitted work. Needs a ledger rewritten by hand; the collector's own names hold no whitespace. | `pathspec(file)` quotes such a path in every printed git command of both remedies (c93a15d). |
| 2 | `createTempFolder` recorded the missing folders from an existence check before a recursive mkdir, so a folder another process created in between was removed at exit. | One non-recursive mkdir per ancestor; only a mkdir that succeeded is recorded (c3eee95). |
| 3 | A dirty `git status` was read as "the committed copy is the fetched one"; a capture committed altered and edited again is dirty too, and restoring HEAD left it failing. | The checkout is followed by handoff again; the committed case points at `git log` for the commit that held the fetched bytes (2793021). |
| 4 | Re-collecting with `--force` was offered as a repair; a new fetch writes a new capture beside this one and the ledger still names this one. | The line is gone from both branches; the text says why (2793021). |
| 5 | A nested decision project has no `.git` of its own and was told it had no git metadata. | `insideRepository` looks above the project (the commit that adds it). |

### Second external review (2026-10-04)

The same reader reviewed PR #242 and reported six more defects, each with a reproduction; all
six were verified here and fixed, one commit each, red-first, through the gate.

| # | Finding | Fix |
|---|---|---|
| 1 | Inside double quotes PowerShell expands `$copy` to nothing, so the quoted checkout restored a neighbour. | A capture name outside letters, digits, `.`, `_`, `-`, `/` is named but never printed as a command; the note says to type it quoted for the shell and prefixed `:(literal)` (490c494). |
| 2 | `[12]` in a quoted pathspec is a git glob whatever the shell did; a neighbour was restored. | Same fix (490c494). |
| 3 | A mkdir that failed part-way threw before the sort that ordered the removal; an ancestor the run created was left behind. | Each created folder goes to the front of the record, so it is deepest-first at every moment (89c251c). |
| 4 | The walk up for `.git` walked past a bare repository the project sat inside and printed a checkout git refused. | `insideRepository` asks `git rev-parse --is-inside-work-tree`; the walk remains only without git, and honours `GIT_CEILING_DIRECTORIES` (the commit before this one). |
| 5 | The no-metadata assertions called the branch directly, so a detection that always said "repository" passed every test. | They go through `handoffRemedy` again, under a `GIT_CEILING_DIRECTORIES` set above the fixture (same commit). |
| 6 | The committed-alteration test passed with the printed checkout deleted: handoff was failing before the restore too. | The test counts the checkout it ran and checks the local edit is gone (this commit). |

The reviewer's full suite on the PC was red on four timing tests in browser-guard, browser-transport
and http-linear, files none of these PRs touch, in a run that took 1247 s against about 150 s on
CI; the Windows CI leg passed the same commit. Not reproduced here; recorded as the known
sensitivity of those tests to a loaded host.

### Third external review (2026-10-04)

The same reader reviewed PR #243 and reported six more defects; all six were verified here and
fixed, one commit each, red-first, through the gate.

| # | Finding | Fix |
|---|---|---|
| 1 | The safety check ran over the five names the text lists, so an unsafe sixth name got no note and "handle the remaining files the same way". | `classify(files)` runs over every affected file (a957525). |
| 2 | "Quote it for your shell and prefix `:(literal)`" was not enough: cmd expands `%NAME%` inside double quotes. | Unsafe names go in `handoff-names.txt`; the printed `git --literal-pathspecs checkout HEAD --pathspec-from-file=...` types no name (c1c311a). |
| 3 | Without git, the fallback walked a junction's lexical parents. | It walks the physical path (realpath) first (7847470). |
| 4 | Without git, relative ceiling entries became ceilings and an empty entry lost its meaning. | Absolute entries only; realpath until an empty entry, as git reads them (7847470). |
| 5 | A git refusal (`dubious ownership`) was explained as "no git metadata". | `repositoryState` carries git's first line; the remedy says git refused, and to fix that first (ef8d11f). |
| 6 | The claim that only a hand-rewritten ledger names an unsafe file: `captureName` embeds a URL's host as it is. | Comment and map corrected; the behaviour (named, never typed) already covers it. |

## Remaining risks

- Findings 3 and 5(b), fixed after the report at the operator's request.
- Windows case-insensitive filesystems: a case-only twin of a capture would be one file on NTFS
  and git would check out whichever came last; not run (no Windows host here). Reading only.
- Not probed: a slow disk (no tool here), a real old Python (stubbed), the real Firecrawl
  `--max-age 0` path (no credits spent by the probes), `ulimit -u` (root exempt).

## Summary

Thirteen full runs, no unrelated failure, no order or concurrency sensitivity, and a clean tree
after CI's extra steps: the suite is stable. One real defect, the bytecode cache deployed with the
kit, is fixed; two diagnostics and one defence-in-depth gap are fixed; one leftover directory and
one remedy wording are recorded as decided trade-offs. To review: the four commits named above,
each with its red-first test.
