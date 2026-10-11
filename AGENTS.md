# Research-first project bootstrap

Agent instructions for this project. Read this before planning, designing, or building anything here.

## How this project works: two phases, two roles

This project runs in two phases, and they are usually done by **different agents, or by an
agent and a person**. Know which one you are in before you act.

**Phase 1 - research (this kit).** Close every blocking unknown with fetched primary
sources, then pass the gate. The output is a briefing, not code: `research/DISCOVERY.md`
(the contract), `research/EVIDENCE.md` (claims with cached pages behind them), and
`research/BRIEF.md` (the handoff). Phase 1 never writes product code.

**Phase 2 - build (someone else's job).** A builder - another agent, a different model, or
a human - takes `research/BRIEF.md` plus `research/` and implements. They should not need
to re-research anything: if they do, phase 1 was incomplete, and the fix is to collect the
missing fact rather than to let the builder guess it.

The handoff needs a passing gate, an intact corpus, a classified map, rewritten Findings,
and an authored brief with its judged sections answered. For a stamped brief, its inputs
must still match the corpus. PASS or file presence alone does not complete phase 1.
An authored unstamped brief keeps the existing approval path, with currency unknown
(ADR-0138). Machine role controls collection, not the derived approval conditions.

## Two machines, two roles

Those phases usually run on **two machines**, and this kit knows which one it is on. The
role is machine config - `role: "collector" | "builder"` in
`~/.agents/research-kit.config.json`, default `collector`; declare it with
`node research-kit/bin/install-hooks.mjs --role builder`.

| | **collector machine** (the operator's PC) | **builder machine** (a sandbox, a CI box, a laptop) |
|---|---|---|
| holds | the Firecrawl key when that route is used; none is needed for a chosen keyless route | no collection key required, no Firecrawl egress |
| runs | `decompose.mjs`, `research.mjs` - it produces the corpus | `handoff.mjs`, `preflight.mjs`, the build - it consumes it |
| `doctor.mjs` says | missing Firecrawl CLI/auth fails with an unchosen or Firecrawl route; an explicitly chosen keyless route passes those findings (ADR-0095) | missing Firecrawl CLI/auth is expected: this machine does not collect |
| must | push `research/raw/` including its dotfiles, so the builder can receive the corpus | **not collect** - `research.mjs` and `decompose.mjs` refuse (exit 2) |

**If you are on a builder machine and there is no brief: you do not collect.** You are in
phase 2, and your input is a corpus somebody else collected. `research.mjs` and
`decompose.mjs` refuse to run on a builder (exit 2) rather than fall back on another
transport - a page fetched by hand is not evidence in this kit, and a builder that
"re-collects" a missing page forges a corpus instead of reporting a gap. If a fact is
missing, say which one and let it be collected on the collector machine; `--dry-run` and
`--status` still work here, because they spend nothing.

**The handoff.** The corpus travels through git: `research/` including the dotfiles under
`research/raw/` - `.fetches.jsonl` is the hash-chained ledger that proves every cached page
was actually fetched, and it is evidence, not a byproduct. Zip tools, sync tools, and some
git filters drop dotfiles; this repository lost its ledger exactly that way once. So a
builder's first command is:

```
node research-kit/bin/handoff.mjs
```

It checks that the ledger is present and non-empty, that `research/EVIDENCE.md` is there with
its table, that every capture an evidence row names is on disk, and that the chain verifies -
and exit 1 names whatever is missing.

**The remedy depends on the cause, and the command says which.** Do not assume the other
machine:

- *Something did not travel.* Then it is the collector's to push: **`git add research/`
  and `git add -f research/raw/.fetches.jsonl`** - the ledger by name, because a dotfile
  rule can hide it; not the whole folder with `-f`, which also commits the machine-local
  logs and lock the repository ignores - then the builder pulls or re-clones.
- *Everything travelled, and this machine rewrote it on checkout.* Then the body hashes
  fail only on line endings - `core.autocrlf=true`, the default on Windows, smudges every
  text file leaving the object store, and the hashes were taken over LF bytes. The corpus
  is whole; fix it **here**, with `.gitattributes` (`research/raw/* text eol=lf`), and
  check `research/` out again. Going to the collector fixes nothing, and re-collecting
  spends paid credits to reproduce a corpus that is already on disk.

This repository ships that `.gitattributes` at its root, so the second case should not
arise; `handoff.mjs` distinguishes the two anyway, because a project scaffolded before it
did, or one cloned onto a machine with a hostile `core.autocrlf`, still can.
`node research-kit/bin/doctor.mjs` reports the same thing on a builder, as a blocker.

For Git builder requests (ADR-0148), a `collected` result delivers captures, not completed
review. The builder reads and judges them and reports review-only gaps in prose; the
collector records the Findings, unknown closures, classified map and current authored
brief in this Git corpus. Request another fetch only for a missing external fact.
ADR-0052's local review and re-packaging of a received package remains available; it
does not authorize fetching or editing the collector's Git corpus (ADR-0150).

## Starting in the wrong place: ask which project, do not hunt for it

For gate and corpus commands, the project is the **current working directory**. Those
commands take no project argument: the gate resolves one project from where it stands, and every artifact it
judges - `research/DISCOVERY.md`, the corpus, the ledger - is read relative to that one
root. Getting this wrong is worse than doing nothing, because everything downstream is
then true of the wrong thing. The desktop panel's accepted `--project` flag
(ADR-0147) selects its project explicitly; confirm that effective project before
diagnostics instead of generalizing the flag to gate/corpus commands.

So if the cwd is not the project the operator means - it is the kit's own repo, a parent
folder holding several projects, an unrelated checkout - **ask which project**, and wait.
Do not search the filesystem for the one you think he meant, do not infer it from a name,
and do not look it up on a remote. Searching a person's disk to guess his intent is not
orientation: it reads directories nobody authorised - sooner or later, one holding a
credential - and the question it replaces takes one line. `doctor.mjs` and preflight
cannot settle it for you either: they describe wherever they are run, so a clean report
from the wrong directory is a clean report about the wrong project.

The signals are plain: no `AGENTS.md`, no `research/` directory, or a `research/` corpus
whose topic is plainly about something else. Any one of them is a reason to ask, and none
of them is a reason to search. An existing corpus about another topic is the signal doing
its job - the answer is not to write over it, and not to search past it, but to ask.

## Researching a decision ABOUT this repository: a nested project, never a scratch dir

This repository's contract (research/DISCOVERY.md) enumerates its unknowns (U-1 onward), all about
transports and vendors. A decision about the repository itself - how it should be
delivered, packaged, hosted - is a **different question**, and putting it in that contract
would leave one corpus asserting two unrelated sets of claims with `unknown-closure` and
`subtopic-coverage` judging them together.

**Scaffold a nested project instead** (ADR-0030):

```
node research-kit/bin/new-project.mjs docs/decisions/<date>-<decision-name> --topic "<question>"
cd docs/decisions/<date>-<decision-name>
```

Then work there exactly as in any project, and **commit the corpus including
`research/raw/.fetches.jsonl`**. Add the project's row to `docs/decisions/README.md` in the same commit (ADR-0102).
Nothing in `docs/decisions/` is ever moved or deleted; the index says which projects still
carry a decision. The worked example is
`docs/decisions/2026-09-21-delivery-architecture/`.

Two things this rule exists to prevent, both of which have already happened once:

- **Do not collect into a temporary directory.** The first attempt at that decision
  collected nine pages into a scratch project outside the repository, read the findings,
  and deleted the directory as routine cleanup - destroying the captures, the ledger and
  the provenance for every claim. Scratch projects stay legitimate for *experiments*: what
  they cannot do is support a committed decision. The moment a scratch finding is going to
  be cited, it belongs in a nested project.
- **Do not cite this repository's preflight as validation for a nested one.** The root
  verdict judges the root corpus. A nested project is verified with its own directory as
  the working directory, and nothing else counts.

## Resuming after an interruption: resume, do not restart

A session can die mid-task - the sandbox resets, the turn is cut, the working tree is
lost. What survives is the repository, and the gate is a pure function of repository
state, so a fresh agent should orient from disk before touching anything rather than
assume it must start over. `doctor.mjs` and preflight answer *where this project is*
without asking anyone - what is gated, what the corpus holds, which machine this is -
and the last commit report and `docs/ARCHITECTURE.md` say *what was happening and why*:
the report names the task and how it was verified, the map names the seams it touched.
`git status` answers what is unfinished, and its uncommitted changes are the
interrupted task itself, possibly partial and unverified - read them as work in
progress, never as state to trust. Resume from there: the corpus is already collected
and credits already spent are not spent again, so a restart would pay for both twice,
and if you cannot finish what was interrupted, say plainly what state you left it in.
There is no check for this, deliberately: whether an agent oriented before acting is
not something a gate can judge.

## Rule 1 - research first, then build

Before you propose a design or write code, the blocking unknowns must be closed with evidence. This is not advisory.

The sequence is decompose -> contract -> collect -> gate -> brief.

0. Decompose the topic first (**collector machine** - phase 0 gathers material with
   Firecrawl, so a builder machine refuses it): `node research-kit/bin/decompose.mjs` (the project's own topic, from `research/plan.json`; `--topic "<what is being researched>"` only while the project is untitled - a different topic is refused, ADR-0056) drafts `research/MAP.md` with the gathered material and the subtopic table SEEDED with the universal checklist (`research-kit/lib/dimensions.mjs`: access model, auth, rate limits, ToS/legality, schema stability, freshness, cost at volume, runtime limits, and output obtainability - the load-bearing one: if the data your "done" depends on cannot be obtained, the project dies in phase 1, not phase 2). The tool contains no judgment: it hands over a checklist with statuses blank, never an answer. A `--recipe` ADDS domain dimensions on top of the universal set - it never replaces it (a recipe that silently dropped legality would be worse than no recipe). Mark every row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist is not enough. A fact blocks the build when a wrong guess changes the design - API limits and pricing, auth model, data schemas, rate limits, licensing/ToS, platform behavior, current library versions, competitor pricing, data availability.
1. Write the intent in `research/DISCOVERY.md` under `## Build intent`, and enumerate the blocking unknowns FROM the map - each unknown should trace back to a subtopic.

   A contract written without a map is allowed, but it makes no coverage claim, and the gate will say so: preflight prints one warn - "no coverage claim" - because it cannot tell a thorough contract from a shallow one. `subtopic-coverage` fails a GAP row, a reasonless DISMISSED row, and a COVERED row citing unknowns that do not exist.
3. Collect primary evidence:

   ```
   node research-kit/bin/research.mjs --plan research/plan.json
   ```

   Prefer the page that *owns* the fact (official docs, repo, pricing page, statute) over any write-up about it. Raw page text is cached under `research/raw/`; rows are appended to `research/EVIDENCE.md`.
4. Rewrite each auto-extracted `Finding` cell into a real claim, with the URL and retrieval date that support it. Keep the `Raw` cell pointing at the cached page - that is what makes the claim checkable. Where a claim rests on one sentence, add it as `[quote: the sentence, copied from the capture]` - word for word; quotation marks around it are optional - and the gate checks the quote occurs in the capture (ADR-0087).
5. Run the gate:

   ```
   node research-kit/bin/preflight.mjs
   ```

   **Do not start building until it prints PASS.** A failed check names exactly which unknown is unproven.

   This gate is enforced, not advisory. Once the machine-wide hook is installed,
   `git commit` refuses any staged change outside `research/` while the gate fails -
   except the project's own scaffolding (`.gitattributes`, `.gitignore`, `AGENTS.md`,
   `START_HERE.md`, and `docs/ARCHITECTURE.md` while it is still the empty template,
   ADR-0048) - and the edit-time hook interrupts the agent's edits in the same state.
   Altered evidence is refused even inside `research/`: a capture edited after its fetch,
   a broken or unparseable chain, or a cited capture no fetch produced blocks every
   commit, whatever is staged (ADR-0093) - unfinished evidence is committable, altered
   evidence is not. A
   project is gated when any of `research/DISCOVERY.md`, `research/plan.json`,
   `research/EVIDENCE.md`, or `research/raw/` exists. There are exactly three
   overrides: `git commit --no-verify`, a deliberate `research/GATE_OFF` file
   for this repository, and a repository-local `core.hooksPath` (the third one
   is silent by nature - it disables the hook that would report it - so
   `doctor.mjs` and preflight detect it and log it to
   `research/overrides.log`; `husky`, `lefthook`, `simple-git-hooks`, and
   `pre-commit` all set a local hooksPath, and collide with the machine-wide
   gate for exactly that reason). The last two are recorded in
   `research/overrides.log` - a local log on the machine that took the
   override, never committed (ADR-0081) - and
   `node research-kit/bin/doctor.mjs`
   reports how many times each has been used; `--no-verify` skips the hook, and
   a hook git did not run records nothing, so that one is accounted for by your
   reply alone. If you take an override, say so in
   your reply. Deleting `DISCOVERY.md` does not turn the gate off - a gated project
   missing its contract fails harder.

   Evidence must be *fetched*, not typed - and by a named transport.
   `research/raw/.fetches.jsonl` is a hash-chained record written only by the
   collector: one entry per fetch, with the URL, the capture's sha256, a link to
   the previous entry, and the `transport` (the adapter that ran; `firecrawl-cli`
   when the CLI did). Preflight requires every cited page to appear there, with an
   unchanged body hash and an intact chain. A hand-written raw file, or an edit to
   a captured page after the fact, fails the gate. Claiming a fact without a
   cached, ledger-backed page is not evidence - and neither is a capture whose
   transport or completeness is not on record: captures are graded
   `completeness: full | partial` (partial names what was omitted), and a CLOSED
   unknown resting solely on a partial capture is flagged. Severity for both
   follows the machine's `evidencePolicy` (pluralist warns, strict fails). This
   repository's own ledger is honest about it: its first five entries were agent page fetch with no Firecrawl egress, collected in a sandbox on the collector machine, and the later entries are firecrawl-cli with completeness graded. A capture graded partial is flagged when a CLOSED unknown rests on it alone.

6. Hand off. On PASS, write `research/BRIEF.md` - intent, verified claims with sources,
   contradictions and how they were resolved, known unknowns with their day-one
   verification steps, and the first build step. That brief is what the builder (a
   different agent or a human) reads; phase 2 begins there, not here. Writing the brief
   is part of phase 1 and is not optional, because a passing gate with no handoff means
   the next agent re-researches everything you just verified.

   **The review is your job, not a person's.** Classifying the map (step 0), rewriting
   the findings (step 4) and answering the brief's **TODO** sections are the three review
   steps: they are checked by what they leave behind, never by who did them. Declare who
   did them in the brief with the line `Reviewed by: agent`; a package carries it as
   `review.by`, and says it is a declaration (ADR-0074). There is no human review step
   (ADR-0107).

## Rule 2 - questions are for intent, never for facts

- Ask at most **3** questions, once, up front, and only about things no document can answer: what the user actually wants, which accounts or budget they have, who the audience is, what "done" means.
- If a question's answer is in public documentation, it is a research task, not a question. Go and fetch it.
- **Never answer "insufficient info" and stop.** Either produce evidence, or name the single missing fact and then go collect it.

## Rule 3 - known unknowns are allowed, silence is not

If a fact is genuinely unreachable (login-walled, private, paywalled), mark the row `KNOWN-UNKNOWN` and write the day-one verification step in the `Evidence` cell. An honest, labeled gap is fine. An unlabeled gap is the failure mode this project exists to prevent.

## Rule 4 - source quality

- `P` primary/official carries the design. `S` secondary is context. `L` lead-only (forums, video, blogs) is a hint, never proof.
- Never invent a citation. Every row in `research/EVIDENCE.md` must have a cached raw file behind it.
- Flag contradictions instead of averaging them. Record both and say which you trust and why.

## Rule 5 - cost discipline

Firecrawl collection spends credits; chosen keyless transports do not spend Firecrawl
credits, but still use the planned page allowance and carry transport/policy warnings.
Plan the queries in `research/plan.json` before collecting, reuse the cache
(`--refresh-days`), and check the budget with:

```
node research-kit/bin/research.mjs --status
```

When the account runs out mid-run, the run stops and exits 2 with what is left (ADR-0129).
That decision is the operator's, not the agent's: report the balance and the uncollected
pages, and ask whether to top up or to finish on the free transports with `--fallback`.
Never pass `--fallback` on your own initiative.

Write the one-page handoff for a builder in `research/BRIEF.md` when discovery is done -
that file is the phase-1 deliverable and the only thing phase 2 is required to read.

## Rule 6 - secrets

The Firecrawl key lives in the CLI config or your environment. Never write it into this repository, and never run `firecrawl env` inside a repo - it writes a key into `.env`.

## Feature freeze (from 0.9.0)

The kit is feature-frozen (ADR-0117). Bring it bug fixes, gaps an ADR already deferred whose
trigger has fired, documentation, tests, and updates for a vendor, Node or git release. A new
command, flag, transport, provider, configuration key, file format or check is not added unless
an ADR lifts the freeze for that one item. When a change could be read either way, it is a
feature.

## The standing protocol

Five rules for how work in this project is committed and recorded. They bind
every contributor - agents and humans alike. This is documentation, not
enforcement: no check judges prose, because a gate that judges prose is a
gate that will be wrong. Rule 1 is enforced by the commit gate, and so is rule 5
in this repository (ADR-0120, a result file, not prose); the rest are carried by
review and by the record these rules produce.

1. **Architecture map current in the same commit.** A commit that touches a
   declared code path (declared in `research/kit.json`) stages
   `docs/ARCHITECTURE.md`, updated for what moved, in the same commit.
   Enforced - and a prompt, not a proof: the gate checks the map was
   *staged*, not that it is *current*, so keeping it current is a duty the
   rule makes deliberate rather than accidental.

2. **Commit report: five named parts.** Every commit - or the report that
   accompanies it - carries five parts, named:
   - **what changed** - the modules and the shape of the change;
   - **why** - the defect, decision, or order that made it necessary;
   - **what it touched** - the files, the map rows and ADRs it owes, the
     domain terms it added or sharpened;
   - **what you verified** - the commands run and their state (the suite,
     preflight, the acceptance of the change). Each claim carries one of
     three words: **verified** (run, and the result seen), **untested**
     (written, not run), **expected** (reasoned, not run) - so a reader can
     tell evidence from belief, which "the suite passes" and "this should
     pass" do not do on their own;
   - **what you got wrong and fixed** - the misread, the false assumption,
     the first attempt that had to be redone. A mistake is reported in six
     fields - **mistake** (what was wrong), **where** (the file and line, or
     the step), **impact** (what it broke or would have broken, and whether
     anything already delivered is affected), **cause** (one line), **fix**
     (what changed), **verified** (the command re-run, and its result) -
     because a line that says only what was wrong leaves the two facts a
     reader needs, the impact and the proof of the fix, to be guessed.
   The parts are named so nobody has to infer them: someone who has never
   seen the brief that produced the work must still be able to read the
   report. **The got-wrong line is not optional** - if nothing was gotten
   wrong, it is written as "nothing to report", never omitted, because a
   report that never admits a mistake cannot be distinguished from one that
   never checked. The three status words and the six fields are taken from
   Anthropic's careful-coding skill (2026-10-03); the rest of that discipline
   the protocol already carried, and the gate enforces the part a gate can.

   **The short form** (ADR-0075). A commit that touches no declared code path
   (`research/kit.json`) - tests, docs, wording, a fixture - may carry the
   same parts as one line each: **what changed**, **why**, **what you
   verified**, **what you got wrong**. The got-wrong line stays, for the
   reason above. Anything under a declared code path uses the full form.

3. **An ADR for any design choice with a rejected alternative.** When a
   decision about how the kit behaves, what it stores or what it promises -
   a module's responsibility, a format, a rule, a deferred refactor, a
   rejected design, a "not now" - set an alternative aside, it is recorded as
   an ADR, dated, with the reason a future explorer would need to avoid
   re-suggesting it, and (for dated calls) the trigger that expires it. Test
   mechanics, wording, and a bug fix with one obvious remedy do not need one:
   the commit report's **why** names any alternative that was set aside
   (ADR-0075). Existing ADRs are never re-litigated; a decision that is
   genuinely wrong is superseded by a new ADR that says so.

4. **One commit per task - the revert test.** A task is a change that can be
   reverted alone: `git revert <sha>` undoes it without breaking what was
   built before or after it. A task that cannot be reverted alone was not a
   task - it is two tasks wearing one commit, and it gets split. (The
   same-commit map update and the `CONTEXT.md` term a commit owes belong
   *with* that commit, which is why they do not break the test.)

5. **A red suite stops work.** A failing test is a stop-the-line event, not
   a bullet in a summary. It is reported immediately and alone - before any
   further building - **with the cwd recorded**, because some tests are
   cwd-sensitive and a red without a cwd is a failure that cannot be
   localised. Work resumes when the red is explained - fixed, or pinned as a
   recorded defect with the reason - never when it is averaged into a
   summary.

   In the kit's own repository this rule is enforced (ADR-0120): the commit gate runs
   the suite for any commit that stages something under `research-kit/`, and blocks
   while it is red. A docs-only commit owes nothing, an unsupported test is not red, and
   `git commit --no-verify` still goes through, and records nothing. Projects built on the kit carry
   this rule as prose, because the check does not apply to them.

The record this protocol produces: decisions as ADRs under `docs/adr/`
(including dated rejections with their expiry triggers), architecture
reviews under `docs/`, and the terms the rules are named in, in
`CONTEXT.md`.

## Orchestrator facts

For an agent that plans and delegates work on this repository (recorded 2026-10-03; correct
what has gone stale).

- **Gate.** `node research-kit/bin/selftest.mjs` (the offline suite, about 150 s on CI and 25 to
  30 minutes on the operator's Windows PC - 1409 to 1825 s measured, ADR-0142; a group by file name, e.g. `selftest.mjs checks transport`), `node research-kit/bin/preflight.mjs`
  (the research gate on the root corpus: PASS), `node research-kit/bin/handoff.mjs` (exit 0),
  `node research-kit/bin/doctor.mjs` (READY). The commit gate runs the suite for any commit
  that stages `research-kit/` and refuses a stale "N tests, offline" line in
  `research-kit/README.md` and a missing `docs/ARCHITECTURE.md` beside a `lib/`, `bin/`,
  `hooks/` or `githooks/` change. CI runs the same suite on ubuntu, ubuntu-26.04 and windows,
  on Node 24 and 26, plus an archive-tree check: seven jobs, all required.
- **Baseline.** `main` is green on all seven jobs. One intermittent failure is on record: on
  2026-10-11 the `node (24)` job's LIVE `browser-guard` meta-refresh test failed once on a
  documents-only commit (Chromium never made a request in 45 s, with D-Bus errors) and passed
  on re-run and in every sibling job; nothing else is known to flake. An UNSUP (an
  unsupported capability, ADR-0108) is not red.
- **Sources of truth.** `docs/ARCHITECTURE.md` (one row per module), `docs/adr/` (every
  decision with a rejected alternative), `CONTEXT.md` (the domain terms), `CHANGELOG.md`
  (Unreleased first), `docs/review-*.md` (audit findings and their outcomes).
- **Conventions.** One commit per task with the five-part report (rule 2 above); red-first
  tests; no `--no-verify`; the feature freeze (ADR-0117) admits bug fixes, already-deferred
  gaps whose recorded triggers fire, docs, tests and vendor updates, anything else
  through an ADR that lifts it for that one item. Classification is review, not a suite
  verdict; unrelated work remains frozen.
- **Invariants.** The ledger `research/raw/.fetches.jsonl` is evidence and is never edited;
  a package's `buildAuthorized` is derived, never supplied; captures are written only by the
  collector; no key is ever written into the repository; the root corpus and every project
  under `docs/decisions/` keep a passing gate.
- **Research-Kit.** This repository is the kit; record `doctor`'s actual verdict and chosen
  transport for the intended machine. ADR-0095 permits a chosen keyless collector;
  readiness is not inferred from key presence. A decision about the kit itself is a
  nested project under `docs/decisions/<date>-<slug>/research/` (ADR-0030), committed with
  its ledger. Delegated builders work in worktrees and leave uncommitted changes; the lead
  integrates one unit per commit through the gate.
