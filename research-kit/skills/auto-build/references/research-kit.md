# Research-Kit, as auto-build runs inside it

This file is added by the kit (ADR-0146). The auto-build files were received from the
upstream baseline recorded in NOTICE and carry marked kit adaptations. This file says
how each stage runs with Research-Kit. **Where the two differ, this file wins inside a
Research-Kit project.** The commands and hooks enforce their documented checks; they
do not verify owner replies or every prose obligation. Following these owner stops and
review duties remains the run's responsibility. Which skill to use is the `skill-router`
skill's table.

Commands below assume the kit at `$HOME/.agents/research-kit` (`KIT` for short):

```
KIT="$HOME/.agents/research-kit"
```

## Ask, and stop: the owner decides

This section **replaces the SKILL.md's "Autonomous decision rule" and its standing-mandate
shortcuts** inside a Research-Kit project. The run is secure before it is fast.

**Ask.** Whenever the run needs something only the owner can give - intent, a choice
between approaches, a budget, an account, a credential, permission, what "done" means -
it asks. Questions are collected and sent as one message at the next stop, each with the
options, the recommended one and what each costs, so one reply can answer them all. A fact
a document can answer is never a question: on a collector it is collected, on a builder it
is a `fact-request`.

**Stop and wait for the owner's reply** - not a default, not a timeout, not a standing
mandate - when any of these holds:

| Stop | Why it is the owner's |
|---|---|
| the Mandate is ready (every run, bounded or architectural) | it approves the current design and in-scope build |
| a decision is hard to reverse, changes the task's goal, or picks between approaches with different consequences | the design is the owner's |
| anything would spend money: paid pages, a paid service, a dependency with a licence cost, a budget raise | the account is the owner's |
| a secret, credential, token or personal data would be read, written, sent or logged | security and privacy |
| a change touches authentication, permissions, CI, deploy, the gate or its hooks, branch protection, or another repository | the blast radius is beyond the task |
| anything destructive: deleting data or branches, rewriting history, force-pushing, migrating data | it cannot be undone |
| the kit's gate fails, the suite is red, `handoff` fails, `doctor` is not READY | a red result stops work |
| break-test or an audit reports a Critical or S1 finding | the owner decides if it ships |
| a research claim the design rests on proves wrong, or a fact is missing | the plan changed under the run |
| the merge | the owner's word, for the exact head commit he saw (see Stage 8) |

At a stop the run writes `RUN.md` (state, what it found, the question, Next action
"awaiting owner") and **ends its turn**. It does not continue on a guess, and it does not
take "no answer" as consent. A decision it takes alone - reversible, cheap, inside the
approved Mandate and the evidence - is recorded under "Decisions and assumptions" so the
owner can overrule it.

Use authorization already recorded in the session for the same unchanged action and
artifact; do not repeatedly ask for it. A changed Mandate and an unapproved completed
head still require their own replies. At an unanswered required stop, end the turn;
silence and elapsed time never supply that reply.

The standing mandate may still pre-answer *preferences* (branch names, merge method, audit
depth, page budget for free transports). It never pre-approves a stop in the table above.

**No timeouts, no defaults that act.** A run that has waited a long time stays stopped; it
never proceeds because no answer came.

**A corrected Mandate needs a fresh approval.** A reply with corrections is not an approval:
the run presents the corrected Mandate again and waits. A `GO` given to an earlier version
does not carry over to a changed design.

**Unattended runs stop at the Mandate**, standing mandate or not. "Unattended" means the
owner has not replied in the current session. Before the Mandate the run only reads the
repository, plans and writes notes - and, on a collector, collects through the free
transports only; paid pages need the budget the owner gives in the Mandate. It leaves the
Mandate message ready to read, `RUN.md` Next action "awaiting owner", every question listed.

## Stage 0: Orient - start from the router, not from the task

Confirm the intended project before running diagnostics; if the cwd is wrong, ask
which project and wait (AGENTS.md). Then read the state and record actual results in
`RUN.md`:

```
node "$KIT/bin/doctor.mjs"       # verdict and machine role (collector | builder)
node "$KIT/bin/preflight.mjs"    # the gate: PASS, or what is unproven
node "$KIT/bin/handoff.mjs"      # did the corpus arrive whole (exit 0)
node "$KIT/bin/brief.mjs" --state # authored, with both judged sections answered
```

Also record the **kit version** (`doctor` prints it) and the **skill set that ran** (the
names under the skill root), so the run can be compared under ADR-0145.

An unresolved role or doctor blocker needs resolution. A chosen keyless collector
does not need Firecrawl (ADR-0095); key presence alone is not a readiness verdict.
Readiness also needs a classified MAP, rewritten extractor Findings and an authored
brief with both judged sections present and answered. A stamped brief's inputs must
match the current corpus; `brief.mjs --state` reports state/sections, not currency.
Authored unstamped briefs retain approval with currency unknown (ADR-0138). These
are the existing role-agnostic approval conditions; role controls collection.

Then take one path, from the router's "Step 2: route by state":

| Role | State | Path |
|---|---|---|
| collector | gate failing, or no corpus | Stage 1 as below (collector) |
| collector | handoff and gate pass, review complete/current under ADR-0138 | Stage 1 is SKIPPED ("the reviewed brief answers it"); start at Stage 2 |
| collector | gate PASS, but review incomplete or stamped brief stale | finish Stage 1 review from existing captures; fetch only a missing external fact |
| builder | handoff and gate pass, review complete/current under ADR-0138 | Stage 1 as below (builder): no collecting at all; then Stage 2 |
| builder | incomplete review, or `handoff` fails, or gate failing | **stop.** `RUN.md` records the review/delivery diagnosis; fact requests are only for missing external facts |

## Stage 1: Research

**On a collector**, Stage 1 runs as the SKILL.md says, through the `research-first` skill,
and the review steps use the kit's skills: `map-classifier` (the map's rows),
`finding-rewriter` (the Findings, with `[quote: ...]`), `source-grader` (P/S/L and
contradictions), `brief-writer` (the brief, `Reviewed by: agent`). The sufficiency gate is
an intact handoff, `preflight` exit 0 and the completed/current review above. PASS and
file presence alone do not authorize building (ADR-0150).

**On a builder**, Stage 1 is three steps and never fetches a page:

1. `node "$KIT/bin/handoff.mjs"` exits 0. If not, stop (see Stage 0).
2. `build-from-brief` reads `research/BRIEF.md` and `research/EVIDENCE.md`.
3. Read and judge the claims against the design. A missing external fact becomes a
   `fact-request`, saved in the run folder as `FACT-REQUESTS.md` or the accepted Git
   request file. Review-only gaps return to the collector in prose, without another
   fetch. For Git requests the collector records Findings, unknown closures, map and
   the current authored brief; `collected` means delivery, not review completion.

ADR-0052's local review and re-packaging of a received package remains available
without collection. It does not permit editing the collector's Git corpus; neither
workflow adds a machine-role predicate to derived authorization (ADR-0150).

If any request is blocking, the run goes on to the Mandate only to present it, and stops
there with Next action "awaiting collector" (and the owner). `research.mjs` and `decompose.mjs` refuse on a
builder (exit 2); a page fetched by hand, by browser or by another tool is not evidence and
is never used (ADR-0010).

## Stage 2: Requirements - every line rests on evidence

- Each row of `REQUIREMENTS.md` carries a **Rests on** cell: the evidence row(s) `E-##` it
  depends on, the unknown `U-##` it is waiting on, or `repository` when the code itself
  answers it. A row with none of these is an assumption and is listed as one.
- Each row also carries a **Volatile** cell, `yes` or `no`. A row is
  **volatile automatically** when any `E-##` it rests on states a price, a rate limit, a quota, an
  API or schema version, or a plan or tier boundary; the run may mark more rows volatile,
  never fewer. Only the owner can mark such a row `no`, in the Mandate, with his reason
  recorded beside it. Volatile evidence must be younger than the project's
  `research/plan.json` `refreshDays` (the stricter of that and `preflight`'s age limit),
  not only younger than the machine's `maxAgeDays`.
- `day-one-tasks` turns every `KNOWN-UNKNOWN` row's verification step into the first work
  units and smoke tests. They run before anything that depends on them.

## Stage 3 and 4: Design and the Mandate - the evidence is shown

The Mandate gains two things:

- a **Rests on** column on every design decision, naming its `E-##` rows;
- a **Known unknowns** section: each `KNOWN-UNKNOWN`, with its day-one check and the unit
  that runs it.

A design decision with no evidence row is either listed under "Assumptions" with what
breaks if it is wrong, or it **blocks the Mandate** when a wrong guess would change the
design. Open fact requests are listed as blocking questions.

Any decision that set an alternative aside is written as a record with `adr-writer`.

## Stage 5: Build - the code points back at the evidence

- `careful-coding` on every change.
- `cite-in-code`: every constant that came from research (a limit, endpoint, price, schema
  field, quota) carries a comment naming its `E-##` row.
- `contract-tests`: the verified claims and quotes become tests and fixtures.
- **One commit per unit**, each with the five-part report from `commit-report`, the
  got-wrong line included.
- `TRACEABILITY.md` links each requirement to its `E-##` row, then to the code, then to the
  test.

## Stage 8: Deliver and merge - stricter here

`GO MERGE` keeps every condition in `merge-protocol.md`, plus three, all checked on **the
exact head being merged**:

1. the kit's commit gate passed for every commit (no override taken);
2. the project's suite is green - a red suite stops work, it is not a line in the report;
3. `node "$KIT/bin/preflight.mjs"` still exits 0.

And:

- **Never `--no-verify`, never `research/GATE_OFF`, never a local `core.hooksPath` to step
  around the gate.** If the gate fails, the run stops and says why.
- Without `gh`, the run stops at a pushed branch or a patch, as the SKILL.md says.

### The merge approval is tied to the head commit

A standing mandate's `GO MERGE` or `Merge: allowed` is read as `GO`. The merge needs the
owner's word, and that word approves **one head commit**:

1. **Ask.** Stage 8 stops at the open pull request and sends the merge summary: the PR, its
   **head commit** (full sha), the checks, the gate, the suite, `preflight`, the findings,
   what was not verified, and **Stale, not relied on**: every `stale-evidence` warning
   `preflight` prints for a row no requirement rests on, by `E-##` and age. `RUN.md` Next
   action: "awaiting owner: merge <sha>".
2. **Record.** The owner's reply, word for word, and the sha it approves are written to
   `MANDATE.md` and `RUN.md` - who approved which code. When "Stale, not relied on" is not
   empty, the reply must also acknowledge it ("merge <sha>, stale acknowledged", or a
   request to re-check them first); a reply that does not is a question back, not an
   approval. The stale rows never ship unseen, and never start a collector round-trip
   unless the owner asks for one.
3. **The approval lapses** on any change to the head: a push, a rebase, a fix, a base
   update merged in. The run then stops again with a new summary for the new head. An
   approval never moves to a commit the owner did not see.
4. **The run folder, not the session, holds it.** The owner may reply hours later. The
   resumed run (`resume-from-disk`) reads the approval from `RUN.md`, checks that the PR's
   head is still the approved sha, re-runs the gate, the suite and `preflight` on it, and
   merges with `--match-head-commit <sha>` (or the method's equivalent), so a head that
   moved in between is refused rather than merged. Any mismatch or red result is a stop.

The same rule holds on a collector and a builder; merging collects nothing. **On a builder**
two more conditions hold before the merge summary is even sent:

- no `fact-request` in the run folder is still open;
- `preflight` reports no evidence older than its age limit for any `E-##` row a requirement
  rests on;
- every `E-##` row a **volatile** requirement rests on was retrieved within the project's
  `refreshDays` (read from `research/plan.json` and the row's Retrieved date - two files
  that already exist).

A builder cannot re-check a fact itself, so a stale one is a `fact-request` for a
`freshness-recheck` on the collector, and the run stops "awaiting collector".

## Before the merge: freshness

- **On a collector**, `freshness-recheck` re-collects the pages behind the `E-##` rows the
  code depends on (`research.mjs --refresh-days`), and behind every volatile requirement's
  rows with `--refresh-days <refreshDays>` from `research/plan.json`. If a fact changed, the run returns to
  Stage 1 for that topic and re-plans what depended on it; it does not merge.
- **On a builder**, a fact that may be stale becomes a `fact-request`, and the merge waits
  (see Stage 8's builder conditions).

## Resuming: "continue the auto-build"

Start with `resume-from-disk`: `RUN.md`, then `doctor`, `preflight`, `git status`, and the
last commit report. Uncommitted changes are the interrupted unit, unverified. Facts already
collected are reused (`--refresh-days`), never paid for twice.

## What this file does not change

The stages, their order, the Mandate replies, the self-correction rule and the stop
conditions are the SKILL.md's. This file only tightens them where the kit's rules apply.
