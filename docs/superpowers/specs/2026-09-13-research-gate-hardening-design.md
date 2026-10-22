# Research Gate Hardening — Design

- **Date:** 2026-09-13
- **Status:** approved in brainstorm, awaiting user review of this document
- **Path classification:** architectural (new subsystem: enforcement + provenance)
- **Scope decision:** one machine, every agent the owner uses
- **Success criterion chosen:** *"The gate cannot be skipped or faked."*

## 1. Problem

Fetchproof (`~/.agents/fetchproof`, source in this project under `fetchproof/`)
installs a Discovery Contract and a `preflight.mjs` gate. Two defects make that gate weaker
than it looks:

1. **Enforcement is advisory.** `AGENTS.md` and the `research-first` skill *ask* an agent to
   run preflight before building. Nothing prevents a build, an edit, or a commit when the
   verdict is failing. Freebuff Desktop exposes no hook mechanism, so on that host the
   instruction is the entire mechanism.
2. **Evidence integrity is unverified.** Preflight confirms a cited raw file exists and is
   larger than 200 characters. It never confirms the file was *fetched*. A hand-typed
   markdown file with a plausible URL passes the gate. The collector already records `url`,
   `retrieved`, and `command` in front-matter, but nothing reads them back.

### Verified environment facts

| Fact | Value | Consequence |
|---|---|---|
| git | 2.55.0.windows.5 | `core.hooksPath` supported (2.9+) |
| global `core.hooksPath` | unset | Setting it displaces nothing |
| husky / lefthook / simple-git-hooks in the authoring machine\u0027s projects dir `[path elided 2026-09-13]` | none | A machine-wide hooks dir is safe here |
| Repos present | `research bot- dropshipping`, `research bot- stock trader` | Both are commit-time gate candidates |
| This project's repo | **none** | Cannot host a git gate, and this spec cannot be committed here |
| Claude runtime | 2.1.257 | After the 2.1.214 exit-2 blocking fix |
| `~/.claude/settings.json` | **invalid JSON** (line 11 is `For Windows;-`) | Claude hooks cannot load until repaired |

Hook semantics confirmed against the Claude Code hooks reference: a `PreToolUse` hook can
return JSON `permissionDecision` of `allow` / `deny` / `ask`, and exit code 2 blocks the tool
call as "the one outcome JSON can't override". Two known risks are recorded in §7.

## 2. Threat model

The actors are **laziness, not malice**: an agent that forgets the gate, or a human in a
hurry. An adversary who wants to bypass enforcement can delete a hook or re-derive the
ledger chain; no local mechanism prevents that, and this design does not pretend otherwise.

Therefore "cannot be skipped or faked" is specified precisely as:

- **Default-deny**: in a gated project, work is blocked until the verdict passes.
- **Non-silent override**: bypassing requires a deliberate, visible act, and is recorded.
- **Tamper-evident evidence**: fabricated or edited captures fail the gate.

## 3. Scope

### In scope

- A single verdict function, called by all gates and by preflight, so they cannot disagree.
- A commit-time gate on every repo on this machine.
- An edit-time gate for the Claude runtime.
- A hash-chained fetch ledger and the preflight checks that consume it.
- Tests that prove each gate **blocks**, not merely that it returns a value.
- Install, verification, and uninstall paths for both gates.

### Out of scope (deferred, from the same hardening audit)

| Deferred item | Why it is deferred | Risk of deferring |
|---|---|---|
| Absolute `{{KIT}}` paths baked into scaffolded projects | Not part of the chosen criterion | Move or rename the kit and every scaffolded `AGENTS.md` points at a dead path |
| POSIX-hostile quoting in `lib/cli.mjs` | Not part of the chosen criterion | **Demonstrated bug**: `quoteArg('…a%20b…')` emits `a%%20b`. Percent-encoded URLs break off Windows, and the collector has run zero real fetches so far, so this is the most likely first failure |
| Verifying which agents load the `research-first` skill | Not part of the chosen criterion | The protocol may be running on `AGENTS.md` alone; acceptable, but unproven |
| Repairing `~/.claude/settings.json` | Requires separate approval (outside this project) | Blocks the Claude gate only; the git gate is unaffected |

Deliberately **not** built (YAGNI): cryptographic signing, a verification daemon, network
re-verification of pages, CI wiring, a spend dashboard, ledger backfill.

## 4. Architecture

**One verdict, three callers.** `bin/gate.mjs` answers exactly two questions — *is this
project gated?* and *does the verdict pass?* — and prints an actionable fix. The git hook,
the Claude hook, and `preflight.mjs` all route through it. It performs no network access and
depends on nothing in the collector.

```
git pre-commit ─┐
                ├─→ bin/gate.mjs ─→ lib/preflight checks ─→ lib/provenance.mjs
Claude PreToolUse┘        │
                          └─→ prints verdict + exact fix command
```

| Path | Status | Responsibility |
|---|---|---|
| `bin/gate.mjs` | new | The verdict. Exports `evaluate(projectDir)`; CLI wrapper prints human or JSON output. Exit codes: `0` allow, `1` block, `2` internal error; the Claude hook translates the verdict object rather than trusting the exit code. Short-circuits on the gating predicate first, because the Claude hook pays node's startup on every edit |
| `lib/provenance.mjs` | new | Append and verify the chained fetch ledger |
| `githooks/pre-commit` | new | `node <kit>/bin/gate.mjs --gate commit`; propagates the block |
| `hooks/claude-pretooluse.mjs` | new | Parses the PreToolUse payload from stdin, emits `permissionDecision` |
| `bin/install-hooks.mjs` | new | Installs/removes both gates; validates and repairs the Claude settings file |
| `~/.agents/fetchproof.config.json` | new | Machine-level knobs: `failOpen`, `claudeGate`. Deliberately **outside** the deployed tree so `install.mjs` can never clobber it |
| `bin/research.mjs` | changed | One ledger entry per fetch attempt (success and failure) |
| `bin/preflight.mjs` | changed | Adds the provenance checks in §6 |
| `bin/doctor.mjs` | changed | Reports gate health: hooksPath, hook presence, chain integrity, override count |
| `bin/selftest.mjs` | changed | Covers provenance, gate verdicts, diff-scope rule, and a real block |
| `template/AGENTS.md`, `skill/SKILL.md` | changed | State that the gate is enforced, and how to override it honestly |
| `template/.gitignore` | changed | Keep `.fetches.jsonl` and `.overrides.log` committed, with an explicit `!.fetches.jsonl` negation so a broader dotfile rule cannot silently exclude the chain later; continue ignoring `.usage.jsonl`, `.failures.jsonl` |

### Blast radius

- One machine-wide git setting: `core.hooksPath` → `~/.agents/fetchproof/githooks`.
- One file outside this project: `~/.claude/settings.json`, **backed up before writing**, and
  only after separate approval.
- The kit itself, and this project's `docs/` and `research/`.

No other repository is modified.

## 5. Gate semantics

### Gating predicate

A project is gated when **any** of these exist:

- `research/DISCOVERY.md`
- `research/plan.json`
- `research/EVIDENCE.md`
- `research/raw/`

A `research/` directory containing none of them is *not* gated, so unrelated repos with a
notes folder are untouched. `research/GATE_OFF` opts out.

Inside a gated project, a **missing** artifact is a failure, not an opt-out: deleting
`DISCOVERY.md` makes the gate fail harder rather than disabling it.

### Diff-scope rule

While the verdict fails, the commit gate blocks staged changes outside `research/` and
**allows** changes confined to `research/`. Committing collected evidence is part of the
workflow; blocking it would make the gate a nuisance and guarantee its removal.

### Override

| Mechanism | Effect | Visibility |
|---|---|---|
| `research/GATE_OFF` | Both gates no-op | Printed by both gates on every run; counted by `doctor`; appended to `research/overrides.log` |
| `git commit --no-verify` | Bypasses the git gate | Native git escape hatch; cannot be removed, so it is documented rather than fought |
| Gate config `claudeGate: "ask"` | The Claude gate asks the human | The human sees the reason each time |

### Per-gate behaviour

| Gate | Not gated | Gated, failing | Gated, passing |
|---|---|---|---|
| git `pre-commit` | no-op | **block** (non-zero) + fix command | allow |
| Claude `PreToolUse` | no-op, immediate exit | `permissionDecision: "ask"` + reason | allow |

The Claude hook is registered as `node "<kit>/hooks/claude-pretooluse.mjs"` with matcher
`Edit|Write|MultiEdit|NotebookEdit`. It reads the payload on stdin, so the same code is
exercised by the offline tests.

**The `ask` choice is deliberate.** Exit 2 is the stronger block, but a known bug makes it
stop the session instead of letting the model adapt, and there is a Windows report of hooks
not blocking at all. `ask` keeps the human in the loop, cannot wedge a session, and still
makes silent continuation impossible. `claudeGate: "hard-block"` is available in config once
Windows behaviour has been verified by the negative test in §8.

## 6. Provenance: the chained fetch ledger

**File:** `research/raw/.fetches.jsonl` — append-only, one JSON object per line, **committed
with the evidence** so a clone carries the chain.

```json
{"seq":1,"at":"2026-09-13T05:12:00.000Z","op":"scrape","url":"https://example.com/docs",
 "type":"P","raw":"research/raw/2026-09-13-doc-ab12cd34.md","bodySha256":"…",
 "cmd":"firecrawl scrape https://example.com/docs --only-main-content --json -o …",
 "prev":"0000…","entrySha256":"…"}
```

- `entrySha256` = sha256 of the canonical (sorted-key) entry with `entrySha256` omitted.
- `prev` = the previous entry's `entrySha256`; 64 zeros at genesis.
- Failures are recorded as `op:"fail"` with the error text.

Preflight gains:

| Check | Fails when |
|---|---|
| `chain-intact` | a line does not parse, `seq` skips, a `prev` link mismatches, or an `entrySha256` does not recompute |
| `fetch-entry-exists` | a cited `Raw` path has no entry with the same URL |
| `body-unmodified` | the file's current sha256 differs from `bodySha256` |
| `timestamp-agreement` | the raw file's `retrieved:` differs from the entry's `at`, or `command:` lacks `firecrawl` |
| `unknown-attempted` | *(warn)* a `KNOWN-UNKNOWN` row has no recorded fetch attempt |

The whole raw file is hashed, including front-matter: annotations belong in `EVIDENCE.md`,
not in the capture. A file needing trimming is re-fetched, not edited.

**Catches:** hand-typed raw files, post-hoc edits to captures, fabricated ledger rows,
citations whose evidence was deleted.

**Does not catch:** a misleading claim laid over a genuinely fetched page — a reading-quality
problem no local check can identify — nor a forger who re-derives the chain deliberately, at
which point they have reimplemented the collector. Provenance is tamper-evidence, not truth,
and the docs say so.

**No backfill.** The two existing project-brains contain no `raw/` files, and this kit has
completed zero fetches, so nothing is grandfathered. Pre-existing claims must be re-fetched
to count. A `--backfill` flag would only invite fabricated history, so none exists.

**Single writer.** `research/raw/.fetches.jsonl` is written **only** by the collector. Gate
overrides and gate-absent warnings go to `research/overrides.log` (append-only, unchained,
committed) so nothing else ever has to maintain the chain.

**Concurrency:** the collector takes `research/raw/.fetches.lock` (PID + stale timeout) and
appends with a single write, so a crash cannot interleave two entries.

## 7. Failure handling

The governing rule: **a broken gate must not brick the machine.** Default is fail-open,
loud, and visible to `doctor`; `~/.agents/fetchproof.config.json` can set `failOpen: false`.

| Failure | Behaviour |
|---|---|
| Kit missing, or `node` not on PATH (GUI git clients) | Pre-commit warns loudly, **allows** the commit, appends to `research/overrides.log`; `doctor` reports FAIL |
| Claude payload shape changes upstream | Hook exits 0 (allow) and logs the unparsed payload |
| Ledger truncated mid-write by a crash | Preflight fails naming the line; `--repair` drops a trailing partial line only when the chain is otherwise intact, and never invents a link |
| Two collectors at once | Lock file with PID and stale timeout |
| `~/.claude/settings.json` corrupt | `install-hooks.mjs` validates, backs up to `settings.json.bak-<date>`, repairs the `For Windows;-` line, re-parses, and confirms the hook loaded. Any other corruption stops and asks |

## 8. Testing

Every test below runs **without a Firecrawl key**, so they all pass today.

**Provenance**
- Happy path: entry appended, chain verifies, preflight passes.
- Tampered body → `body-unmodified` fails.
- One ledger row deleted → `chain-intact` fails at the right line.
- Hand-typed raw file with no entry → `fetch-entry-exists` fails.
- Truncated tail → fails naming the line; `--repair` accepted only for an intact tail.

**Gate verdict**
- Gated and passing → allow. Gated and failing → block. Not gated → no-op.
- `GATE_OFF` → no-op, reported, and appended to `overrides.log`.
- Missing `DISCOVERY.md` inside a gated project → FAIL, not opt-out.
- The ledger is written by the collector alone: the gate never appends to the chain.

**Diff-scope rule**
- Staged change only under `research/` → allow.
- Staged code change while failing → block. Code and research together → block.

**It actually blocks**
- Run `githooks/pre-commit` inside a temp repo with a staged code file; assert non-zero exit
  and that the fix command appears in stdout. A gate that only satisfies its unit test is the
  self-deception this design exists to prevent.

**Claude hook, offline**
- Synthetic PreToolUse payloads into `hooks/claude-pretooluse.mjs`; assert the emitted
  `permissionDecision` for gated-passing, gated-failing, ungated, and malformed input.

**Manual, handed to the owner**
- In a live Claude session in a gated failing project, attempt an edit and confirm the prompt
  appears. Not automatable from here. Required before `hard-block` is enabled.

## 9. Rollout and uninstall

1. Implement gate, provenance, hooks, and tests; extend the selftest.
2. `node bin/install-hooks.mjs --dry-run` — show the `core.hooksPath` change and the settings
   diff. Nothing written.
3. Repair approval: ask before touching `~/.claude/settings.json`. Declining leaves the git
   gate fully functional and defers only the edit-time layer.
4. `--git-only` install, then run the negative tests, then `doctor`.
5. Enable the Claude layer separately.

**Uninstall:** `install-hooks.mjs --uninstall` restores the previous `core.hooksPath` (recorded
at install), removes the Claude hook entry, and restores `settings.json` from the timestamped
backup. Every artefact this design adds is removable by one command.

## 10. Acceptance criteria

1. In a gated failing project, a staged non-`research/` change is blocked by the pre-commit
   hook, with the exact fix command printed.
2. A staged commit confined to `research/` is allowed while the verdict fails.
3. *(conditional on O-1 approval)* `~/.claude/settings.json`'s `PreToolUse` hook causes an edit
   in a gated failing project to prompt the human (`permissionDecision: "ask"`), and is a no-op
   in ungated projects.
4. A hand-typed raw evidence file fails preflight with `fetch-entry-exists`.
5. Editing a captured file after fetch fails preflight with `body-unmodified`.
6. Removing a ledger line fails preflight with `chain-intact` naming the line.
7. `doctor` reports hooks path, hook presence, chain integrity, and override count.
8. `install-hooks.mjs --uninstall` returns the machine to its pre-design state.
9. `selftest.mjs` covers criteria 1, 2, 4, 5, and 6 automatically and passes with no Firecrawl
   key present. Criterion 3 is manual; criterion 7 is asserted directly by `doctor`; criterion 8
   is checked by an install/uninstall round trip in the temp fixture.

## 11. Open items

| # | Item | Owner |
|---|---|---|
| O-1 | Approval to repair `~/.claude/settings.json` (backup first). Declining defers only the Claude layer | owner |
| O-2 | This project has no git repo, so this spec cannot be committed and the project cannot be gated. Options: `git init` here, or accept it as an ungated scratch project | owner |
| O-3 | The `%`-doubling quoting bug will break the first real fetch of any percent-encoded URL. Recommend scheduling it immediately after this work | owner |
| O-4 | Firecrawl is still unauthenticated, so the collector's parsers remain unvalidated against real payloads | owner |
