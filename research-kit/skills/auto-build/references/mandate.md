# The Mandate

<!-- Modified by Research-Kit: ADR-0146 standing-mandate corrections and 2026-10-08 corrections to approval summaries, reply/default tables and saved consent. Received baseline: StepenkoAnatoli/SkillsMDs at 3f2d2fc; Architectural tasks: proceed remains withdrawn. -->

The Mandate presents the current design for the owner's approval. Inside a Research-Kit
project, `research-kit.md` also requires the owner's reply at consequential stops and a
separate approval of the completed head before merge. The Mandate is presented after
the research is reviewed and the design is
on disk, because that is the first moment the user can make an informed decision, and before any
code meant to be kept is written, because that is the last moment a wrong decision is cheap.

It batches the design questions and authorizes in-scope implementation once the owner
approves. It does not replace completed-head merge approval or the stops in the governing
Research-Kit note.

## Contents

1. The message template
2. The reply vocabulary
3. The stop-list (what no Mandate authorizes)
4. The standing mandate section
5. Saving `MANDATE.md`

---

## 1. The message template

Keep each section to what the task needs. A Bounded task fits in a screen; an Architectural one
links to its spec and summarizes. Every blocking question from Stages 1–3 appears here, numbered,
so one reply answers all of them.

```markdown
# Mandate: <task slug>

**Classification:** <spike / bounded / architectural> (brainstorming's test: <one line>). Override if wrong.
**Engagement:** <Light / Full> (lead-orchestrator's table: <the reason>).
**Run ledger:** <path to RUN.md>

## What the research proved
| Topic | Project | Gate | Claims the design rests on |
|-------|---------|------|----------------------------|
| <topic> | <path> | preflight 0 | E-03 (<one-line claim>), E-07 (<claim>); U-2 KNOWN-UNKNOWN: verify on day one by <step> |
Or: "Research SKIPPED: <the sentence from the stage table>."

## Requirements
<path to REQUIREMENTS.md>; <n> rows. The ones that drive the design:
- R-01 <text> (E-03)
- R-04 <text> (engineering judgment: <why>)

## Design
<Bounded: approach, files touched, how it is tested, in a few lines.>
<Architectural: spec at <path>; the approaches compared and the recommendation, with the
strongest case against it; one line per section of the spec.>

**Assumptions I am carrying** (reject any that are wrong):
- A1 <assumption> (assumed)
- A2 <inference> (inferred from <path>)

**Decision records:** <ids and one line each>, or "none expensive to reverse".

## Work breakdown
| Unit | Description | Owns | Depends on | Wave | Pre-mortem |
|------|-------------|------|------------|------|------------|

## Delivery
- Base branch: <name>; working branch: <name>
- Merge method: <repository default / squash / merge / rebase>
- After merge: delete working branch <yes/no>; wait for base CI <yes/no>
- Audit depth: <full / scoped / off (reason)>
- Harden: break-test <standard / with these probes skipped: ...>

## Budgets
- Research pages: <n> collected; <m> more allowed before asking again
- Sub-agent concurrency: <n>
- Longest probe: <minutes>

## Stop-list
Nothing in this Mandate authorizes: scope beyond the task statement; changing an invariant;
deleting data; touching a production system or real external service; force-pushing; bypassing
a gate or a hook; merging a pull request this run did not open; spending beyond the budgets
above. These stop the run and ask.

## Questions that block
1. <question> - options and recommendation: <choice and consequence>
2. ...

## Reply
`GO` - build, open the pull request, hold the merge.
`GO MERGE` - build and open the pull request; merge is intended, but still needs the
owner's separate reply approving its completed head and the required checks.
Corrections require a revised Mandate and fresh approval; an earlier reply does not
approve changed design. An unanswered question or required stop stays awaiting owner.
```

## 2. The reply vocabulary

| Reply                         | Meaning                                                                           |
|-------------------------------|-----------------------------------------------------------------------------------|
| `GO`                          | Approves the current design and in-scope build; Stage 8 holds the merge for the owner's completed-head reply |
| `GO MERGE`                    | Approves the same build and records merge intent; it does not approve a future head |
| `GO` or `GO MERGE` + corrections | Present the corrected Mandate and wait for fresh approval; a correction is not approval of the revision |
| `STOP AFTER DESIGN`           | Stages 5–9 do not run; the run ends COMPLETE with the research, requirements and design delivered. For a user who wanted the thinking, not the code |
| Anything else                 | Not an approval. Incorporate what it says; present again                           |

Record the owner's actual answers to blocking questions. Standing preferences may settle
ordinary choices inside the approved design; defaults never answer an owner stop.

## 3. The stop-list

These are the user's decisions in every delegated skill, and the Mandate does not move them:

- expanding scope beyond the task statement recorded in `RUN.md`
- changing a project invariant (lead-orchestrator)
- deleting data, modifying a production system, reaching a real external service in a probe
  (break-test)
- force-pushing a shared branch; `--no-verify`; a gate-off file; an admin override of branch
  protection (lead-orchestrator; Research-Kit; merge protocol)
- merging anything this run did not open (merge protocol)
- spending a metered budget beyond what the Mandate agreed (Research-Kit)
- a gap-audit gap that needs a design change (gap-audit)

At a required stop, record Next action "awaiting owner" and end the turn. Resume from
the recorded reply for that unchanged action. Unattended mode, silence and timeout do
not supply permission; use the complete stop table in `research-kit.md`.

## 4. The standing mandate section

A project that runs auto-build often can record the stable decisions in its agent instructions
(`CLAUDE.md`, `AGENTS.md` or equivalent), next to lead-orchestrator's "Orchestrator facts":

```markdown
## Auto-build mandate
- Default reply offered for bounded tasks: GO MERGE (merge intent; the run still waits for the owner's reply)
- Architectural tasks: wait
- Base branch: main; working branch pattern: auto/<slug>
- Merge method: repository default; delete branch after merge: yes; wait for base CI: yes
- Check timeout: 45 minutes
- Research page budget proposed in the Mandate: 30; paid collection waits for the owner's authorization
- Unanswered owner questions: wait
- Audit depth: scoped at Light, full at Full
- Design-change gaps from the audit: record as open items | wait
- Break-test: standard; never probe against <service>
- Queue: <path to a plan file, next unchecked item | issue label | directory> ; continuous | one per run
- Stop-list additions: <project-specific items, or "none">
```

These lines record preferences; they remove no required owner stop:

| Line                          | Stop it removes                                      | What it trades away                                           |
|-------------------------------|------------------------------------------------------|---------------------------------------------------------------|
| Default reply `GO MERGE`      | none - it is the reply offered; the Mandate wait holds | nothing: the user still replies, and may correct the design |
| `Unanswered owner questions: wait` | none | the run waits for an actual reply |
| `Design-change gaps: record`  | none | record the gap; dependent work waits for approval of the changed design |
| `Queue: ...`                  | the "what next?" question on a bare invocation       | the user's choice of order; the queue's order is used         |
| `Queue: continuous`           | choosing the next queued task | each new Mandate still waits for approval |
| A proposed page budget        | repeating the preference | paid spend still needs authorization |

With this section present, the run still presents the Mandate and **waits** for the user's
reply, every task, bounded or architectural: the lines pre-answer preferences, never the
Mandate. List every preference the lines settled under "Decisions made without asking".

**Stops no standing mandate removes**, so the user knows which ones to expect:

- the Mandate itself, every run, and a corrected Mandate;
- the merge, approved separately for the completed head; a changed head lapses that approval;

- the stop-list (section 3): scope beyond the task, invariants, data deletion, production,
  real services, force-push, gate bypass, foreign pull requests, budget overrun;
- a required human review or approval on the base branch's protection rules: only a person can
  give it; the run ends BLOCKED naming who. To avoid it, the protection must be satisfiable by
  checks alone;
- Research-Kit not `READY` when the task needs an external fact;
- a research project INCOMPLETE or BLOCKED; a unit that used both retries; a required check that
  cannot run from here; a secret found in the diff.

The section is the user's; auto-build never writes or edits it. Tell the user it exists as an
option when a run had to stop at Stage 4 unattended.

**Working-and-reporting block.** The section may also carry standing instructions on tone and
honesty (for example: label observed / inferred / assumed; "verified" only after running it;
lead with what went wrong; ask once and only for the stop-list; no reassurance or padding).
Auto-build applies them to every message and report of the run; they never loosen a rule in
this skill or a delegated one.

## 5. Saving `MANDATE.md`

Save the message as sent and the reply as received (verbatim, with timestamp) to
`MANDATE.md` in the run folder, and record the path and the reply token in the stage table. For
a run with standing preferences, record those separately from the owner's actual reply.
At merge, record the summary's full head SHA and the owner's reply verbatim here and in
`RUN.md`. Check both on resume; a moved head needs a new summary and reply.
