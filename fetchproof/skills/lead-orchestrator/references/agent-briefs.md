# Sub-agent Brief Templates

<!-- Modified by Fetchproof on 2026-10-22: received as lead-orchestrator 2.0 (the owner's claude.ai account copy, dated 2026-10-04), which replaces the StepenkoAnatoli/SkillsMDs 3f2d2fc baseline (ADR-0190); the kit's old name, Research-Kit, is Fetchproof here, as are the paths and variables that spelled it (ADR-0186). -->

Sub-agents start without any knowledge of the conversation, the plan, prior decisions or this
skill. A brief must therefore be complete on its own: real file paths, real commands, real
identifiers, and the working discipline written in. Vague briefs are the most common cause of weak
sub-agent output.

Each brief covers exactly one unit of work or one review responsibility. Briefs are written in
Phase 2 to `briefs/` in the run folder and launched by reading the file. Before launching, the
lead selects the model for the agent according to the rule in SKILL.md ("Model selection and
capacity"): the most capable model available unless the role's correctness cannot depend on
capability.

## Contents

1. Standard brief structure
2. Explorer
3. Researcher
4. Builder
5. Fix
6. Unit reviewer
7. Spec reviewer
8. Breaker
9. Mutation auditor
10. Invariant auditor
11. Documentation
12. The resume clause

---

## 1. Standard brief structure

Every brief contains these sections, in this order. RESUME appears only on a re-launch.

| Section      | Content                                                                  |
|--------------|--------------------------------------------------------------------------|
| Objective    | What to achieve, and the task or plan item it belongs to                 |
| Rationale    | Why it matters; the requirement or invariant it serves                   |
| Context      | Frozen contracts, relevant files with paths, prior findings, project facts |
| Scope        | Files that may be changed; everything else is read-only; worktree, branch, scratch dir |
| Resume       | (re-launch only) what exists, what remains, first action - see section 12 |
| Pre-mortem   | The lead's two lines on how this unit most likely fails review           |
| Acceptance   | Concrete, checkable criteria for completion                              |
| Discipline   | The block from `careful-execution.md` section 1 (builders and fixers)    |
| Verification | Exact commands, isolated resources, the baseline and what "pass" means   |
| Report       | Required return format and word limit; no full files or raw logs; always ends with the status-words block |

Every report, from every role, states the **working directory** and **commit** it worked on, and
ends with the status-words block (`careful-execution.md` section 4). A report without them is
returned.

---

## 2. Explorer

```
OBJECTIVE    Map <area> for the task "<task>".
RATIONALE    The lead needs an accurate picture of this area before planning.
SCOPE        Read-only. Do not modify files or run commands that write.
FOCUS        Entry points; functions and types involved; callers; existing tests and fixtures;
             contracts (schemas, error codes, file formats); fragile or surprising code.
REPORT       Maximum 300 words:
             - Working directory and commit inspected
             - Relevant files and symbols, with paths
             - Current behaviour, stated plainly
             - Contracts the task must respect
             - Risks
             - Open questions
             - What you did not look at
```

## 3. Researcher

```
OBJECTIVE    Run Fetchproof phase 1 for the topic "<topic>" to a passing gate and a brief.
RATIONALE    The design depends on these external facts: <list>. They must be collected as
             cited evidence, not assumed.
CONTEXT      Kit: <kit path>. Research folder: <project-root>/<research-dir>. Machine role:
             <collector/builder>. Transport: <name>. Build intent: <what will be built and why>.
             Existing research that may already cover part of this: <paths or "none">.
SCOPE        Create and edit files only inside <research-dir>. Write no product code. Do not
             edit captures, kit-generated evidence rows or the ledger by hand.
BUDGET       At most <n> pages and <m> searches. Run `research.mjs --dry-run` and report the
             plan before collecting anything metered. If the folder already holds a corpus,
             run `research.mjs --status` first: cached pages cost nothing and are not re-fetched.
PROTOCOL     Follow references/fetchproof.md section 3 and the scaffolded AGENTS.md:
             scaffold, decompose, classify every map row, write the contract (U-1, U-2, ...)
             and the plan, collect, rewrite every finding with a word-for-word [quote: ...],
             mark unreachable facts KNOWN-UNKNOWN with a day-one verification step, pass
             preflight (exit 0), write the brief, commit research/ and
             `git add -f research/raw/.fetches.jsonl`. Commit after the contract and after
             collection, not only at the end, so an interruption keeps the corpus.
QUESTIONS    Ask the lead at most three questions about intent, all at once, before collecting.
REPORT       Maximum 400 words. A report missing any item below is returned:
             - Research folder path (as cwd) and commit ID
             - `preflight` exit code and the check names it printed
             - Each unknown: id, status (CLOSED / KNOWN-UNKNOWN), evidence rows (E-nn)
             - Pages collected, credits or budget used, transport per capture
             - Contradictions found and how they were resolved
             - Kit findings (command, expected, observed, exit code), or "none"
             - Verified / Untested / Mistakes / Open risks
```

## 4. Builder

```
OBJECTIVE    Implement unit <ID>: <one-line description>.
RATIONALE    <plan item>; serves <requirement or invariant>.
CONTEXT      Contracts: <paths / commit>. Related code: <paths>. Discovery notes: <summary or
             reports/<file>>. Research brief: <path to research/BRIEF.md, or "none">; the
             claims and evidence rows this unit implements: <E-nn list>.
SCOPE        Owned files: <list>. All other files are read-only.
             Worktree: <path>. Branch: <name>. Temporary directory: <path>.
             Commit only to your branch, and commit each time a step is green.
PRE-MORTEM   This unit most likely fails review because: <line 1>; <line 2>. Test for both.
ACCEPTANCE   <criteria>. Tests must exist for: <cases, including the pre-mortem cases>.
DISCIPLINE   <paste careful-execution.md section 1 here, verbatim>
STANDARDS    - Write the test first; confirm it fails for the intended reason.
             - Use real collaborators; substitute only at process or network boundaries,
               using recorded real outputs where available.
             - Repeat concurrency- or timing-sensitive tests <30> times; any failure is a defect.
             - Mutate or revert the guarded code to show each new test fails; then restore.
               The mutation is of the guard the test names, and the test's own input must
               reach that guard: a test that stays green with its guard removed is not a test.
             - A test that touches the filesystem must hold on every CI platform: make links
               only through the project's own guard (<guard>, per project facts); where the
               guard refuses, take the project's unsupported result (<e.g. UNSUP>) rather
               than linking another way. Target the test's scratch directory and never a
               fixed host path, and assert by lstat and real path, never by a link's stored
               text.
             - Assert against actual output, never a value the test built and compares to itself.
             - Implement externally sourced behaviour from the brief's claims. Do not fetch
               pages by hand. If a needed fact is missing, stop and report which one.
             - Never weaken, skip or delete a test. Never commit debug code, local flags or secrets.
             - Before reporting, walk the self-review checklist: <paste careful-execution.md
               section 2, or its path if the agent can read files>.
VERIFICATION <gate commands for affected files>. Baseline: <known failures>; pass means no
             failures outside the baseline. Full suite is not required; the lead runs it at
             integration.
REPORT       Maximum 400 words. A report missing any item below is returned:
             - Working directory, branch and commit ID
             - Commit body in the project format (default in report-templates.md)
             - Commands run, each with its observed result (counts, not "passed")
             - For each new test: the guard it names, and the removal of that guard that
               made it fail on the test's own input
             - Acceptance criteria: each one met, or named as not met
             - Verified / Untested / Mistakes / Open risks
```

## 5. Fix

```
OBJECTIVE    Resolve finding <ID> (severity <S1/S2>) in unit <ID>.
PROBLEM      <observed behaviour, with the reviewer's reproduction>
EXPECTED     <correct behaviour>
SCOPE        <minimum set of files required>. Worktree: <path>. Branch: <name>.
ACCEPTANCE   The reproduction passes. A test exists that fails on the previous code and
             fails again with the guard it names removed, on its own input. A test that
             touches the filesystem follows the builder brief's cross-platform rule.
             The gate for affected files is clean against the baseline. Never patch a test
             until a red CI leg happens to pass.
DISCIPLINE   <paste careful-execution.md section 1 here, verbatim>
REPORT       Maximum 200 words: working directory and commit; root cause in one sentence; the
             fix; verification performed; any similar defects observed elsewhere (list them,
             do not fix them); Verified / Untested / Mistakes / Open risks.
```

## 6. Unit reviewer

Used in Phase 4a for each landed unit, and as the single reviewer at Light level. Combines the
spec check and the adverse-condition probe for one unit; integration-wide concerns belong to
Phase 4b.

```
OBJECTIVE    Review unit <ID> (<commit or range> on <branch>) against its brief and under
             adverse conditions. Assume a defect exists. You did not author this change.
SOURCES      Builder brief: briefs/<ID>-builder.md. Builder report: reports/<ID>-builder-<n>.md.
             Task statement and plan: <RUN.md path>. Specification: <path>. Research brief
             and evidence: <paths, or "none">.
PRE-MORTEM   The lead expected this unit to fail on: <line 1>; <line 2>. Check these first.
SCOPE        May add tests and scratch files under <temporary directory>. Product code is
             read-only.
FOCUS        1. Spec: required behaviour missing or different; behaviour present that the brief
                does not describe; limits, error codes and edge cases that differ; a design
                decision resting on an assumption rather than a cited claim.
             2. Report: re-run two of the builder's claimed commands; confirm the guard-removal
                proof for one new test by removing the guard yourself.
             3. Adverse conditions, for this unit's code paths only: termination and restart;
                retries and duplicates; malformed, empty and oversized input; limits; path and
                platform differences (for every filesystem test: a link made outside the
                project's guard, a fixed host path, an assertion on a link's stored text,
                separators, case, line endings - a finding even if green here).
REPORT       Maximum 400 words:
             - Working directory and commit reviewed
             - For each finding: location (file:line), reproduction (command or failing test),
               impact, proposed severity (S1/S2/S3/Rejected)
             - Builder claims re-run, with results
             - Scenarios tested that held
             - What you did not check
             - Verified / Untested / Mistakes / Open risks
```

## 7. Spec reviewer

```
OBJECTIVE    Verify the integrated change <commit range> against its requirements.
SOURCES      Task: <text or RUN.md path>. Plan: <path>. Specification: <path>. Design notes:
             <path>. Research brief and evidence: <research/BRIEF.md, research/EVIDENCE.md,
             or "none">. Unit review reports: reports/<...>.
SCOPE        Read-only. You did not author this change.
FOCUS        Required behaviour that is missing or different; behaviour present that the
             specification does not describe; differences in limits, error codes and edge
             cases; documentation that misdescribes the code; design decisions that rest on an
             assumption rather than a cited claim, or that contradict a claim in the brief;
             interactions between units that no unit review could see.
REPORT       Maximum 400 words. Working directory and commit reviewed. For each divergence:
             location (file:line), the requirement, the actual behaviour, and a proposed
             severity (S1/S2/S3/Rejected). What you did not check.
             Verified / Untested / Mistakes / Open risks.
```

## 8. Breaker

```
OBJECTIVE    Find failures in <commit range> under adverse conditions, across unit boundaries.
             Assume a defect exists.
FOCUS        Process termination and restart at each step; races and reordering; retries and
             duplicate delivery; lost or ambiguous responses; malformed, empty and oversized
             input; limits; platform and path differences; alternate working directories;
             stale build artifacts; slow or loaded CI; missing configuration; one unit's output
             as another unit's input at the edges.
             This host is one platform. For every new test that touches the filesystem, also
             read for what another platform does: a symlink made outside the project's guard,
             a fixed host path (`/etc/...`, `/tmp`) as a target, an assertion on a link's
             stored text, separators, case, line endings. Report each as a finding even
             though the test is green here.
SCOPE        May add tests and scratch files under <temporary directory>. Product code is
             read-only.
REPORT       Maximum 400 words. Working directory and commit reviewed. For each finding: a
             reproduction (command or failing test), the impact, and a proposed severity.
             Then the scenarios tested that held, and what you did not check.
             Verified / Untested / Mistakes / Open risks.
```

## 9. Mutation auditor

```
OBJECTIVE    Demonstrate that the test suite detects defects in <commit range>.
METHOD       For each guard, condition, branch and invariant in the diff, apply one small
             mutation (remove a check, invert a condition, reorder two steps, skip a call),
             run the relevant tests, record the result, and restore. Leave the tree clean
             (`git status` must show no changes when you finish; say so).
             Then, for every NEW test in the diff, remove the guard that test names and run
             that test alone: green means SURVIVED, whatever other rule caught its input.
REPORT       Maximum 300 words. Working directory and commit audited. A table of mutation ->
             detecting test, or SURVIVED. For each survivor, describe the test that should
             exist, or the input the existing test must feed so that it reaches the guard.
             Confirmation the tree is clean. Verified / Untested / Mistakes / Open risks.
```

## 10. Invariant auditor

```
OBJECTIVE    Demonstrate that these invariants hold after <commit range>: <list>.
METHOD       For each invariant, identify the code paths that could violate it, then run or
             write a check that would fail on violation (for example: byte scans for secrets in
             files, logs, hashes and outputs - including the run folder's reports/; counts of
             side effects that must occur at most once; tests at crash and restart points).
REPORT       Maximum 300 words. Working directory and commit audited. For each invariant:
             HOLDS, VIOLATED or UNPROVEN, with evidence. Verified / Untested / Mistakes /
             Open risks.
```

## 11. Documentation

```
OBJECTIVE    Update <specification / architecture / plan files> for <task>.
STYLE        Match the existing pages at <paths>.
STANDARDS    Every identifier mentioned must exist in the source (verify each one). Every link
             must resolve. Run <documentation checks>. State differences between design and
             implementation explicitly. Do not describe behaviour the code does not have.
             Externally sourced facts cite the research brief and evidence row.
REPORT       Maximum 250 words: working directory and commit; files changed; checks run and
             their results; anything in the code that could not be explained.
             Verified / Untested / Mistakes / Open risks.
```

## 12. The resume clause

When a sub-agent is re-launched after an interruption, its original brief is reused with this
section inserted after SCOPE. It is filled from the disk, not from memory: read the branch's log
and `git status` in the worktree first.

```
RESUME       This unit was started and interrupted. Do not start over.
             Branch <name> (worktree <path>) exists with commits:
               <sha> <subject>
               <sha> <subject>
             Present and passing: <tests or files>. Present and failing: <...>.
             Uncommitted at interruption: <files, or "none">; treat as unverified draft -
             read it, keep what the tests prove, discard the rest.
             Remaining: <which acceptance criteria are still open>.
             First action: run <key test command> and report its state before changing
             anything.
```

For a researcher: the research folder, the unknowns already CLOSED with their evidence rows, the
output of `research.mjs --status`, and the protocol step to resume at. Cached pages are never
fetched twice.
