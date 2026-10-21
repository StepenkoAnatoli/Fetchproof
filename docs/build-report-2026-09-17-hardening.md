# Build report — hardening pass, 2026-09-17

The second pass. Same five named parts. It follows
[the build report](build-report-2026-09-17.md), which records the kit being written.

---

## What changed

The kit was audited against `docs/researcher-review-2026-09-16.md` — a review of the
**previous** implementation of this same kit, which the first pass had not mined — and
against `docs/superpowers/specs/2026-09-16-researcher-path-precedence.md`, a normative
test contract for the core kit that the first pass had not read either.

Eleven of the review's twenty-seven confirmed findings were **reproduced by execution**
in the new build. All eleven are now fixed, each pinned by a test in the new
`fetchproof/test/hardening.test.mjs` (30 tests, named by F-number).

| Finding | What it was | What it is now |
|---|---|---|
| **F16** | An unreadable config still permitted metered collection: `role` fell back to `collector`, the role that may spend credits | `unknown` is a third role STATE; an unknown role refuses collection and names the cause. A misspelled role is unknown too. [ADR-0023](adr/0023-an-unestablished-role-does-not-collect.md) |
| **F10** | A manifest entry of `../../private-canary.txt` was read and **bundled** — entry names were sanitised only after the read | Containment is checked on the SOURCE PATH, before the read, against `research/audits/`, including a realpath check for symlink escape |
| **F15** | A corrupt `index.json` read as "no audits yet", restarting at v0.1 and overwriting the existing v0.1 with different bytes | `readManifestState` distinguishes absent / readable / **corrupt**; corrupt is refused. Audit files are written through `writeImmutable`, which allows identical bytes and refuses different ones |
| **F22** | Writers inserted cells positionally into whatever header was on disk — with `URL`/`Retrieved` swapped, a row put the date in the URL cell | `alignToHeader` maps canonical values onto the on-disk header; an uncovered header is refused. `parseTable` now recognises a header by its **column set**, so the reader handles reordering too |
| **F06** | The audit fingerprint omitted claim text, intent, and the brief's judged sections — which the audit *renders* | The fingerprint covers every rendered input, including the two judged sections and the capture grades |
| **F19** | A dry run ignored the budget: cap 1, three URLs, three previewed | `attempts` (what the budget counts) is separate from `spent` (what it cost). The cap binds in a dry run, and preview and execution now make the same call on every URL |
| **F20** | `--max-scrapes abc` → NaN → uncapped; every search failing still returned success | Numeric flags are refused before a transport is chosen. `failures[]` and `gathered` are returned, so a quiet topic and a failed run stop looking alike |
| **F04** | The keyless extractor discarded sibling sections and still graded `full` at ≥1500 chars | `mainContent` reports what it dropped; `gradeCompleteness` grades on **length AND completeness**, naming the omitted sections. The drop analysis sees short blocks the selection ignores — a 30-character caveat box is exactly what was being lost |
| **F24** | Every auto-collected row was stamped `P` — primary, the only type that carries a design | Rows are born `S`; a plan entry may declare `P`, because a person wrote that URL down. Host signals in `rankCandidate` are anchored, so `notgithub.com.example.org` no longer scores as the owner |
| **F07** | The drafted brief announced "Phase 1 is complete" over unanswered TODOs | The brief states the gate verdict it actually has, and says plainly that a valid corpus, a reviewed one and an approved handoff are three different states |
| **F27** | The line-ending remedy printed `git rm --cached -r research/` + a re-checkout — a recursive discard of uncommitted evidence | Scoped to the affected files, `git status --porcelain` first, `git add --renormalize` per file, nothing removed. With no git metadata it refuses to print a command at all |

Also fixed, from the path-precedence contract and from the suite itself:

- **`FETCHPROOF_HOME`** is now honoured by `lib/machine.mjs` (`kitHome`, `agentsHome`),
  not only by the shell hook — the two no longer disagree about where the kit lives.
- **An explicit argument** outranks the environment variable in `configPath`.
- **A secret scan** in `doctor` (8 credential patterns, **dotfiles included**), reporting
  its coverage rather than implying completeness. There was none before.
- **Six hook tests silently returned** when no POSIX shell was found, printing `ok`
  having asserted nothing. The harness gained `Unsupported` / `requireCapability`: an
  unavailable capability is reported under its own `UNSUP` label with a reason code, and
  it **blocks** — `runPending` returns it and `selftest` exits non-zero.
- **The hook tests were not hermetic**: they passed `...process.env` to the child, so most
  read the operator's real machine config. Every hook child now gets an isolated one.
- A root `.gitignore` (the template shipped one; the repository had none).

---

## Why

The first pass built from the architecture and the ADRs. It did not read the review that
had already found these defects in the previous implementation, so it reproduced eleven of
them — some, like F16 and F22, faithfully enough that the tests I wrote *asserted the
defect as intended behaviour*. Finding the review is what made a second pass worth running.

---

## What it touched

- `lib/machine.mjs` (role states, `kitHome`/`agentsHome`, `configPath` precedence),
  `lib/corpus.mjs` (`alignToHeader`, `headerOf`, set-based header recognition),
  `lib/audit.mjs` (manifest states, `writeImmutable`, fingerprint, containment),
  `lib/research-run.mjs` (`attempts`, anchored ranking, source type),
  `lib/decompose.mjs` (validation, `failures`, `gathered`), `lib/http-transport.mjs`
  (extraction record, grading), `lib/collect.mjs` (`DEFAULT_SOURCE_TYPE`),
  `lib/brief.mjs` (the gate line), `lib/handoff.mjs` (the scoped remedy),
  `lib/doctor.mjs` (secret scan, role blocker), `bin/decompose.mjs`, `bin/selftest.mjs`,
  `test/harness.mjs`.
- **ADR owed and written:** [ADR-0023](adr/0023-an-unestablished-role-does-not-collect.md)
  — `unknown` is a role state and does not collect. It **refines one clause** of ADR-0010
  (the "missing, unknown, or corrupt value reads as collector" default), narrowing it to
  "missing"; ADR-0010 is left unedited, in its own words, as ADR-0020 did to ADR-0002.
- **Tests updated rather than accommodated:** three earlier tests asserted behaviour that
  turned out to be the defect (the role fallback, the remedy text, `mainContent`'s return).
  They now assert the corrected contract and say why.
- The map rule's exception continues as recorded in ADR-0022: `docs/ARCHITECTURE.md` is
  byte-preserved by `BUNDLE_INDEX.md`, so the delta lives in these dated reports.

---

## What I verified

```
node fetchproof/bin/selftest.mjs
300 passed, 0 failed in 24.4s (watchdog 60000ms/test)
```

cwd: the repository root. Offline — no key, no credits, no network.

Every fix was re-probed by **re-running the script that originally reproduced the defect**,
not by re-reading the code:

```
F16 FIXED  role=unknown mayCollect=false        F19  FIXED  dry-run: spent=0 attempts=1, 2 over budget
F10 FIXED  refused: resolves outside            F20a FIXED  NaN budget refused, scraped=0
F15 FIXED  refused; v0.1 intact                 F20b FIXED  failed searches recorded: 4, gathered=false
F22 FIXED  URL cell holds the URL               F04  FIXED  graded partial, omitted named
F06 FIXED  bumped to v0.2                       F24  FIXED  type="S"
F27 FIXED  no destructive command               PP-1 FIXED  kitHome honours FETCHPROOF_HOME
```

End to end afterwards: `preflight` PASS (11 checks), `brief` states the gate verdict,
`audit --zip` produces a 6-file archive, and `decompose --max-scrapes abc` now exits 2
with `--max-scrapes must be a whole number, not "abc"` **before** choosing a transport.

---

## What I got wrong and fixed

Four, all inside this pass.

1. **I introduced a cross-project data leak while fixing F15.** `readManifest` spread a
   module-level `EMPTY_MANIFEST` whose inner `topics` object was shared by reference, so
   the first project to record a version mutated the template and every later project
   inherited its topics — versions climbing to 0.3 in a fresh directory. It is now a
   function returning a new object. Caught by the suite within a minute; it would have
   been invisible in a single-project run, which is exactly how it got written.

2. **My first F22 fix was half of the problem.** I fixed the writer and left the reader:
   `parseTable` located a header by its FIRST CELL, so a table whose lead column had moved
   was not found at all — `headerOf` then returned the canonical order, the alignment was
   a no-op, and `appendRow` spliced its row in at line 0, above the document's title. The
   reader now recognises a header by its column set, which is what the review's "pin both
   reader/writer round trips" was asking for.

3. **My first F04 fix detected nothing.** The drop analysis reused the selection's
   `length > 200` filter, so the short sibling sections — the whole point — were never
   candidates and never counted as dropped. Selection and analysis now use different
   thresholds, and the test pins the short-block case specifically.

4. **Two of my own tests were wrong, not the code.** The handoff read-only test snapshotted
   a directory *before* deleting the file it was about to delete, and the dry-run parity
   test compared `status` (which is `skipped` for everything in a dry run) instead of the
   budget decision. Both now assert what they meant to.

One thing worth naming that was not a mistake: `decompose`'s flag validation initially sat
*after* the "map already holds judged rows" guard, so a bad `--max-scrapes` was masked by
an unrelated refusal. Input validation now runs first, in the CLI, before a transport is
even selected.
