# Build report — phase 2, 2026-09-17

The five named parts. Someone who has never seen the brief that produced this work must
still be able to read it.

---

## What changed

`fetchproof/` was built from nothing — this checkout was the planning bundle, and
`BUNDLE_INDEX.md` states that implementation code is outside its inclusion boundary.

**26 modules under `lib/`** (24 modules plus the two compatibility shims):

| Module | What it owns |
|---|---|
| `core.mjs` | fs/path/date/slug primitives, the artifact constants (`PATHS`, `HEADERS`), canonical JSON, argv splitting. No semantics. |
| `corpus.mjs` | The research corpus: one reader, one writer family, the table machinery, the capture index and its one constructor, `cacheDecision`, and the joins `traceOf` / `captureOf` / `claimOf`. |
| `provenance.mjs` | The hash-chained fetch ledger: `appendFetch`, `verifyLedger`, `repairLedgerTail`, `rebuildLedger`, the `O_EXCL` exclusive section, and `isLineEndingRewrite`. |
| `checks.mjs` | The ordered registry of 11 contract checks, pure over a corpus snapshot. |
| `preflight.mjs` | The verdict and `verdictContext` — corpus, gate state and evidence policy read together. |
| `gate.mjs` | `isGated`, `evaluate`, the diff-scope rule, the architecture-map rule, `splitPathList`. |
| `machine.mjs` | Everything outside the project: the config in three states, the runtime anchors, the role, the collection policy, git `core.hooksPath`. |
| `scaffold.mjs` | `LAYOUT` (12), `GATE_MARKERS` (4), template rendering, `validateProject`, `hookExecutability`. |
| `installer.mjs` | Both gates: install, repair a retired registration, uninstall, deploy with pruning. |
| `doctor.mjs` | Machine + project + gate + chain in one role-aware report. |
| `handoff.mjs` | The arrival question, and one remedy per cause. |
| `collect.mjs` | One URL's journey: `collectOne`, `writeRaw`. |
| `finding.mjs` | `firstFinding(markdown, fallback)` — the auto-extracted Finding cell. |
| `research-run.mjs` | Many URLs, one run: fan-out, candidate ranking, budget tiers. |
| `transport.mjs` | Adapter selection, and the one reader of the operator's choice. |
| `firecrawl.mjs` | All vendor knowledge: the argv-array `exec` seam, the Windows `.cmd` route, payload normalisation. |
| `http-transport.mjs` | The keyless adapter, same seven-function shape, via a child-process rendezvous. |
| `decompose.mjs` | Phase 0: gather, seed, draft the map. No judgment. |
| `dimensions.mjs` | The 9 universal dimensions and `coverageOfUniversals`. |
| `brief.mjs` | The brief's shape: 6 sections, the 2 judged, `briefState`, the renderer. |
| `audit.mjs` | The audit family, the manifest reader, and `zipAudit`. |
| `archive.mjs` | One container format: CRC-32, `buildZip`, `writeZip`, `entryName`. |
| `render.mjs` | Terminal tables. |
| `timeline.mjs` | `TIMELINE.md` and the diagnostics log. |
| `config.mjs`, `git-config.mjs` | Compatibility shims → `machine.mjs`. |

**13 entrypoints under `bin/`**: `preflight`, `gate`, `research`, `decompose`, `doctor`,
`handoff`, `install`, `install-hooks`, `new-project`, `audit`, `brief`, `timeline`,
`selftest`. Each parses flags, injects adapters and renders; none owns policy.

**Not lib, not bin:** `githooks/pre-commit` (POSIX sh, fail-open posture reader, piped
staged list, watchdog), `hooks/edit-gate.mjs`, `template/` (13 files including
`.gitattributes` and the `.gitignore` negation that keeps the chain committed),
`skill/SKILL.md`, `recipes/` ×5, `START_HERE.md`, and the repository's own
`.gitattributes` and `research/kit.json`.

**18 test files**, 265 tests, ~8,800 lines of code and tests in total.

---

## Why

The bundle is planning-only by design. Every operator-facing document in it —
`START_HERE.md`, `README.md`, `AGENTS.md` — instructs the reader to run commands
(`node .../doctor.mjs`, `.../preflight.mjs`, `.../handoff.mjs`) that did not exist. The
brief's own Next steps put phase 2 here. The instruction was to build it from the project
files, and the project files specify it down to the number of checks, the number of gate
markers, and which module owns which decision.

---

## What it touched

- **New files:** everything under `fetchproof/`, plus `.gitattributes` and
  `research/kit.json` at the repository root.
- **ADR owed and written:** [ADR-0022](adr/0022-build-the-protocol-kit-first-defer-the-release-evidence-validators.md)
  — the release-evidence validator layer (R28–R33, the FI workbook join, path-authority
  snapshots, property replay, the conformance vectors) is deferred, with its rejected
  alternatives recorded.
- **ADRs implemented, not re-litigated:** 0001 (LAYOUT owns the shape, 12 entries, 4
  markers), 0002 + 0020 (the posture in three states), 0003 (one corpus owner), 0004 (the
  check registry, order pinned), 0005 (two adapters behind one seam), 0007/0008 (the
  architecture-map rule over declared code paths), 0010 (machine roles), 0011 + 0020 (the
  handoff, one remedy per cause), 0012 (runtime anchors, retired names), 0014 (the brief's
  shape), 0015 (the trace joins), 0016 (the extractor's own module), 0019 (the audit
  bundle), 0021 (the harness awaits its tests).
- **Map row owed:** `docs/ARCHITECTURE.md` describes a superset of what was built. It is
  byte-preserved by `BUNDLE_INDEX.md`'s SHA-256 inventory, so it was **not** edited; the
  delta is this document and the reason is in ADR-0022. That is a stated exception to the
  same-commit map rule, not an oversight.
- **Domain terms used as `CONTEXT.md` defines them**, with no new ones coined. One
  function name was added to the machine vocabulary: `namesHook`, below.

---

## What I verified

```
node fetchproof/bin/selftest.mjs
265 passed, 0 failed in 30.1s (watchdog 60000ms/test)
```

cwd: the repository root. Every test runs offline — no Firecrawl key, no credits, no
network.

The acceptance criteria of the gate-hardening design, §10, each by a test that asserts a
process exit status rather than a return value:

| # | Criterion | Where |
|---|---|---|
| 1 | A staged non-`research/` change is blocked by the real `githooks/pre-commit`, with the fix printed | `test/hook.test.mjs` |
| 2 | A commit confined to `research/` is allowed while the verdict fails | `test/hook.test.mjs`, `test/gate.test.mjs` |
| 4 | A hand-typed raw file fails with `fetch-entry-exists` | `test/provenance.test.mjs` |
| 5 | Editing a capture after fetch fails with `body-unmodified` | `test/provenance.test.mjs` |
| 6 | Removing a ledger line fails naming the line | `test/provenance.test.mjs` |
| 7 | `doctor` reports hooks path, hook presence, chain integrity and override count | `test/doctor.test.mjs` |
| 9 | The suite covers 1, 2, 4, 5 and 6 automatically with no key present | the whole run above |

Criterion 3 (the live edit-time prompt) stays manual, as the design says. Criterion 8 is
covered for the edit gate; the commit-gate round trip writes machine-global git config and
is left to the operator.

Verified by hand as well:

- `bin/new-project.mjs` scaffolds 13 files and repairs `research/raw/`; the fresh project
  fails preflight with 15 named blockers and 8 passing checks — an honest red.
- On the fixture that deserves it: `preflight` prints **PASS 0 blocking, 11 passing**;
  `brief` writes a draft and reports its two TODOs; `audit` renders 6 files; `audit --zip`
  bundles them.
- The archive was opened with **Python's `zipfile`**, not only with the kit's own test
  reader: `testzip()` returned OK and all six entries read back at their recorded sizes.
- `bin/handoff.mjs`, run against **this repository**, correctly reports its own state:
  `handoff-ledger-missing` plus six `handoff-capture-missing` rows, with the collector-side
  push remedy — which is exactly right, because the bundle excluded `research/raw/**`.

---

## What I got wrong and fixed

Five things, four of them found by the tests they were supposed to pass.

1. **The posture exit code carried the config's *state*, not its *resolved* posture.** An
   unreadable config whose last-good snapshot said fail-closed exited 2 ("unreadable and
   resolved to blocking") when the snapshot is a config that parsed and so means 1. The
   agreement test against the sh reader caught it on the row that sets both files. Fixed by
   threading `resolvedFrom` through `readMachineConfig`, and the six-row pin now passes in
   both readers.

2. **The edit-gate registration was written with a native path and matched with a POSIX
   one.** On Windows the installer wrote `...\hooks\edit-gate.mjs` while every detector
   looked for `hooks/edit-gate.mjs`, so `settingsState()` answered `none` for a gate that
   was installed, and a second install added a second registration beside its own — a stale
   entry next to a new one, the exact failure ADR-0012 §4 forbids. Fixed at the owner:
   `namesHook()` in `lib/machine.mjs` normalises separators, and the installer and doctor
   both route through it. This is the one name added to the machine vocabulary.

3. **Phase 0's budget bounded candidates instead of scrapes.** `decompose` sliced the
   material list to `maxScrapes` before consulting the cache, so a second pass re-read the
   same two cached pages and reached nothing new — "a cache hit is not an attempt" was in
   the comment and not in the loop. Fixed to walk the list and break on spend.

4. **The test watchdog timer was `unref`'d.** A test that never settles then left the
   watchdog as the only work in the event loop, so node exited 13 ("await never settled")
   *before* the watchdog fired — a hang reported as a runtime error instead of as the named
   test that hung, which is most of the value of having a watchdog. Fixed by not unref'ing;
   it is cleared in the `finally` either way.

5. **Two tests asserted the wrong thing and were corrected rather than accommodated.** The
   handoff read-only test snapshotted the directory *before* deleting the ledger it was
   about to delete; two transport tests edited ledger JSON by hand, which breaks the entry
   hash, so the failure under test would have been `chain-intact` rather than the transport
   finding — they now re-chain through `rebuildLedger`, the sanctioned migration path.

One thing worth naming that was **not** wrong but looked it: the `Write` tool emitted a NUL
byte in place of a space inside a string literal in `lib/checks.mjs`, which made the file
match as binary and every subsequent edit fail to anchor. Repaired in place; the line it
damaged was rewritten to the clearer form it should have had.
