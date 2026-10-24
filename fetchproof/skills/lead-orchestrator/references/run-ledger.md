# The Run Ledger

The run ledger is what makes an orchestrated task survive an interruption. It is a folder on disk,
committed with the work, whose `RUN.md` always answers three questions: what is done, what is in
flight, and what the lead does next. A fresh session that can answer those three from disk resumes;
one that cannot restarts, and pays for everything twice.

## Contents

1. Run folder layout
2. `RUN.md` schema
3. Status vocabulary
4. Checkpoints: when `RUN.md` is written
5. Resume procedure (Phase R)
6. The resume clause for sub-agents
7. Committing the ledger
8. What the ledger is not

---

## 1. Run folder layout

Default location: `docs/orchestration/<YYYY-MM-DD>-<task-slug>/`. Use the project's convention if
the "Orchestrator facts" section records one. One folder per task; a task resumed across sessions
keeps its folder.

```
docs/orchestration/2026-10-04-settings-persistence/
├── RUN.md                    the ledger (section 2)
├── briefs/
│   ├── U1-builder.md         written in Phase 2, before any launch
│   ├── U1-unit-review.md
│   ├── U2-builder.md
│   ├── integration-spec.md
│   ├── integration-breaker.md
│   └── docs.md
└── reports/
    ├── explorer-settings-1.md    verbatim sub-agent returns, numbered per attempt
    ├── U1-builder-1.md
    ├── U1-builder-2.md           the retry, if there was one
    ├── U1-unit-review-1.md
    └── fix-F3-1.md
```

Briefs are written once and launched by reading the file. Reports are saved verbatim **before** the
lead evaluates them, so a lead whose context resets mid-evaluation finds the report where it left
it.

## 2. `RUN.md` schema

Markdown, in this order. Tables are preferred to prose because they are read back under pressure.

```markdown
# Run: <task slug>

| Field           | Value                                                         |
|-----------------|---------------------------------------------------------------|
| Status          | ACTIVE / BLOCKED (<reason>) / COMPLETE                        |
| Started         | <YYYY-MM-DD HH:MM, timezone>                                  |
| Last checkpoint | <YYYY-MM-DD HH:MM> - <what was recorded>                      |
| Engagement      | Light / Full                                                  |
| Working branch  | <name>, based on <base branch> @ <commit>                     |
| Skill           | lead-orchestrator <version from changelog.md>                 |

## Next action
<One line, concrete enough to execute without re-reading anything else:
 "Launch briefs/U3-builder.md; U1 (a1b2c3d) and U2 (d4e5f6a) are integrated."
 "Triage reports/U2-unit-review-1.md: two findings, F4 confirmed, F5 unconfirmed."
 "Run the full gate on the working branch and compare with the baseline below.">

## Task statement
- Goal:
- Success criteria:
- Out of scope:
- Research briefs relied on: <path -> decisions it supports>, or "none"

## Baseline
- Base: <branch> @ <commit>, measured <date>
- Gate: <commands, in order>
- Known failures: <count>; list or pointer
- Pass criterion: no failures outside this set; none hidden or skipped

## Research
| Topic | Folder | Gate (exit) | Brief | Status |
|-------|--------|-------------|-------|--------|

## Contracts
- Commit <sha>: <files>

## Units
| Unit | Owns | Depends on | Wave | Pre-mortem | Status | Branch / worktree | Commit | Report | Model |
|------|------|------------|------|------------|--------|-------------------|--------|--------|-------|

## Reviews
| Scope (unit / integration) | Role | Model | Status | Report | Findings |
|----------------------------|------|-------|--------|--------|----------|

## Findings
| ID | Severity | Source (report) | Summary | Disposition | Fix unit / commit | Status |
|----|----------|-----------------|---------|-------------|-------------------|--------|

## Decisions and assumptions
- <date> <decision or assumption, and why>

## Kit findings
- <command, expected, observed, exit code>, or "none"

## Log
- <YYYY-MM-DD HH:MM> started / resumed at <checkpoint> / phase 2 exit / launched U1 / saved reports/U1-builder-1.md / accepted U1 @ <sha> / integrated U1 @ <sha> / F3 -> S1, fix brief issued / ...
```

The **Next action** line is the most important line in the file. It is rewritten at every
checkpoint. If a resuming lead can execute it without asking anyone, the ledger has done its job.

## 3. Status vocabulary

Units move forward through these states; they are never written as a later state without the
evidence named in the third column.

| Status      | Meaning                                                   | Evidence required to record it                    |
|-------------|-----------------------------------------------------------|---------------------------------------------------|
| PLANNED     | In the work breakdown                                     | the row                                           |
| BRIEFED     | Brief written to `briefs/`                                | the file exists                                   |
| BUILDING    | Builder launched                                          | branch or worktree name recorded                  |
| REPORTED    | Report saved to `reports/`                                | the file exists                                   |
| ACCEPTED    | Report met the acceptance rules; key test re-run by lead  | commit sha on the builder branch; the re-run result |
| INTEGRATED  | Cherry-picked onto the working branch                     | commit sha on the working branch                  |
| REVIEWED    | Unit review complete, findings dispositioned              | review report path                                |
| BLOCKED     | Cannot proceed                                            | the reason, and what unblocks it                  |
| RETRY n/2   | Returned to a builder; n of two retries used              | the returned report path and the missing items    |

Reviews: PLANNED, LAUNCHED, REPORTED, TRIAGED. Findings: OPEN, CONFIRMED, FIX-ISSUED, FIXED,
RE-REVIEWED, RECORDED (S2 or S3 deferred into the plan), REJECTED. Research: SCAFFOLDED,
COLLECTING, GATE-FAIL, PASS, BRIEFED, COMMITTED.

## 4. Checkpoints: when `RUN.md` is written

Write `RUN.md` (and rewrite Next action) at every one of these. Each takes seconds.

1. End of Phase R: "started" or "resumed at <checkpoint>".
2. Baseline measured.
3. Every phase exit.
4. Every brief launched (unit -> BUILDING, with branch).
5. Every report saved (-> REPORTED, with path), **before** reading it in full.
6. Every acceptance and every integration (with commit sha).
7. Every finding disposition.
8. Every decision, assumption or plan change.
9. **Before any launch once the conversation has grown long**, or when the environment warns
   about usage or context. Checkpoint first, launch second.
10. Completion: Status COMPLETE; the final report appended under a `## Final report` heading.

A checkpoint is a small write, not a ceremony. If writing it would take longer than the work it
protects, the ledger has too much prose in it; move the prose to a report file and keep the table.

## 5. Resume procedure (Phase R)

Run this at the start of every orchestrated task, before any other action. It costs one minute and
is the difference between resuming and repeating.

1. **Find the ledger.** Check the project's run folder convention; then
   `git log --all --oneline -- docs/orchestration` (or the convention's root); then the user's
   own reference ("continue the settings task"). If several run folders match, ask which; do not
   guess. If none exists, create the folder, write the stub with Status ACTIVE and Next action
   "Phase 0: measure the baseline", and continue as a fresh run.
2. **Read Next action, Units, Reviews, Findings.** Do not read the log first; it is history, not
   state.
3. **Verify the ledger against the disk.** The ledger records intentions; the disk records what
   happened. For each row:
   - a commit sha: `git log -1 <sha>` on the branch the row names;
   - a BUILDING or REPORTED unit: `git branch --list <branch>` and `git worktree list`; read the
     branch's log to see what the builder actually committed;
   - an ACCEPTED but not INTEGRATED unit: re-run its key test on its branch;
   - a research folder: `preflight --json` from inside it (cheap; spends nothing);
   - a report path: the file exists and its structured sections are intact.
4. **Treat uncommitted changes as the interrupted unit's work in progress.** `git status` on the
   working tree and on every builder worktree. Attribute each change to the unit whose owned files
   it touches. It is partial and unverified: it goes into that unit's resume clause, never into
   the working branch untested.
5. **Reconcile downwards only.** Any status the disk does not confirm is downgraded to the last
   state it does confirm, with a log line saying so. Nothing is upgraded without the evidence in
   section 3.
6. **Re-measure the baseline only if the base commit moved.** Compare the recorded base commit
   with the branch head.
7. **Write the checkpoint:** log "resumed at <state>", rewrite Next action if the reconciliation
   changed it, and continue from there.

Never redo a phase whose deliverable is on disk and verified. Never re-collect a research project
whose gate passes. Never rebuild a unit whose commit is on the working branch and whose key test
passes.

## 6. The resume clause for sub-agents

A builder, fixer or researcher that stopped is re-launched with its original brief plus this
section, placed directly after SCOPE:

```
RESUME       This unit was started and interrupted. Do not start over.
             Branch <name> (worktree <path>) exists with commits: <sha> <subject>, ...
             Present and passing: <tests or files>. Present and failing: <...>.
             Uncommitted at interruption: <files, or "none">; treat as unverified draft.
             Remaining: <what the acceptance criteria still require>.
             First action: run <key test command> and report its state before changing anything.
```

For a researcher: name the research folder, the unknowns already CLOSED, the pages already cached
(`research.mjs --status`), and the step of the protocol to resume at. Cached pages are never
fetched twice, so resuming spends nothing on what was already collected.

## 7. Committing the ledger

Commit the run folder on the working branch alongside the work it describes. Two acceptable
patterns, chosen by the project's conventions:

- **Ride along:** the `RUN.md` update for a unit goes into that unit's integration commit, as the
  architecture-map update does in projects that require one. The revert test still holds: reverting
  the unit reverts its ledger row.
- **Separate:** `chore(orchestration): checkpoint <what>` commits between units. Simpler, noisier.

If the project forbids committing such files, keep the run folder in an ignored path (for example
`.orchestration/`) and state in the final report that resumption depends on the same machine.

Sub-agent reports may contain paths, hostnames or snippets the project does not want in history.
Before committing `reports/`, scan them for secrets as the invariant auditor would; redact and note
the redaction.

## 8. What the ledger is not

- Not a transcript. Decisions and state, not conversation.
- Not a substitute for commits. A unit's checkpoint is its commit; the ledger points at it.
- Not evidence. A row saying ACCEPTED is a claim; the commit and the re-run are the evidence.
- Not optional at Light level. A Light run is short, which is exactly when a lead is tempted to
  keep state in its head and lose it.
