# Sub-agent Brief Templates

<!-- Modified by Fetchproof on 2026-10-20: the kit's old name, Research-Kit, is Fetchproof here, as are the paths and variables that spelled it (ADR-0186). Received baseline: StepenkoAnatoli/SkillsMDs at 3f2d2fc. -->

Sub-agents start without any knowledge of the conversation, the plan or prior decisions. A brief
must therefore be complete on its own: real file paths, real commands, real identifiers. Vague
briefs are the most common cause of weak sub-agent output.

Each brief covers exactly one unit of work or one review responsibility. Before launching,
the lead selects the model for the agent according to the rule in SKILL.md ("Model selection
and capacity"): the most capable model available unless the role's correctness cannot depend on
capability.

## Contents

1. Standard brief structure
2. Explorer
3. Researcher
4. Builder
5. Fix
6. Spec reviewer
7. Breaker
8. Mutation auditor
9. Invariant auditor
10. Documentation

---

## 1. Standard brief structure

Every brief contains these sections, in this order.

| Section      | Content                                                                  |
|--------------|--------------------------------------------------------------------------|
| Objective    | What to achieve, and the task or plan item it belongs to                 |
| Rationale    | Why it matters; the requirement or invariant it serves                   |
| Context      | Frozen contracts, relevant files with paths, prior findings, project facts |
| Scope        | Files that may be changed; everything else is read-only                  |
| Acceptance   | Concrete, checkable criteria for completion                              |
| Verification | Exact commands, isolated resources, the baseline and what "pass" means   |
| Report       | Required return format and word limit; no full files or raw logs         |

---

## 2. Explorer

```
OBJECTIVE    Map <area> for the task "<task>".
RATIONALE    The lead needs an accurate picture of this area before planning.
SCOPE        Read-only. Do not modify files or run commands that write.
FOCUS        Entry points; functions and types involved; callers; existing tests and fixtures;
             contracts (schemas, error codes, file formats); fragile or surprising code.
REPORT       Maximum 300 words:
             - Relevant files and symbols, with paths
             - Current behaviour, stated plainly
             - Contracts the task must respect
             - Risks
             - Open questions
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
             plan before collecting anything metered.
PROTOCOL     Follow references/fetchproof.md section 3 and the scaffolded AGENTS.md:
             scaffold, decompose, classify every map row, write the contract (U-1, U-2, ...)
             and the plan, collect, rewrite every finding with a word-for-word [quote: ...],
             mark unreachable facts KNOWN-UNKNOWN with a day-one verification step, pass
             preflight (exit 0), write the brief, commit research/ and
             `git add -f research/raw/.fetches.jsonl`.
QUESTIONS    Ask the lead at most three questions about intent, all at once, before collecting.
REPORT       Maximum 400 words. A report missing any item below is returned:
             - Research folder path and commit ID
             - `preflight` exit code and the check names it printed
             - Each unknown: id, status (CLOSED / KNOWN-UNKNOWN), evidence rows (E-nn)
             - Pages collected, credits or budget used, transport per capture
             - Contradictions found and how they were resolved
             - Kit findings (command, expected, observed, exit code), or "none"
```

## 4. Builder

```
OBJECTIVE    Implement unit <ID>: <one-line description>.
RATIONALE    <plan item>; serves <requirement or invariant>.
CONTEXT      Contracts: <paths / commit>. Related code: <paths>. Discovery notes: <summary>.
             Research brief: <path to research/BRIEF.md, or "none">; the claims and evidence
             rows this unit implements: <E-nn list>.
SCOPE        Owned files: <list>. All other files are read-only.
             Worktree: <path>. Branch: <name>. Temporary directory: <path>.
             Commit only to your branch.
ACCEPTANCE   <criteria>. Tests must exist for: <cases>.
STANDARDS    - Write the test first; confirm it fails for the intended reason.
             - Use real collaborators; substitute only at process or network boundaries,
               using recorded real outputs where available.
             - Repeat concurrency- or timing-sensitive tests <30> times; any failure is a defect.
             - Mutate or revert the guarded code to show each new test fails; then restore.
               The mutation is of the guard the test names, and the test's own input must
               reach that guard: a test that stays green with its guard removed is not a test.
             - A test that touches the filesystem must hold on every CI platform: make links
               only through the project's own guard (UNSUP where refused), target the test's
               scratch directory and never a fixed host path, and assert by lstat and real
               path, never by a link's stored text.
             - Assert against actual output, never a value the test built and compares to itself.
             - Implement externally sourced behaviour from the brief's claims. Do not fetch
               pages by hand. If a needed fact is missing, stop and report which one.
             - Never weaken, skip or delete a test. Never commit debug code, local flags or secrets.
VERIFICATION <gate commands for affected files>. Baseline: <known failures>; pass means no
             failures outside the baseline.
REPORT       Maximum 400 words. A report missing any item below is returned:
             - Branch and commit ID
             - Commit body in the project format (default in report-templates.md)
             - Commands run, each with its observed result
             - For each new test: the mutation or revert that made it fail
             - Items not verifiable in this environment, with the reason
             - Risks and open questions
```

## 5. Fix

```
OBJECTIVE    Resolve finding <ID> (severity <S1/S2>) in unit <ID>.
PROBLEM      <observed behaviour, with the reviewer's reproduction>
EXPECTED     <correct behaviour>
SCOPE        <minimum set of files required>
ACCEPTANCE   The reproduction passes. A test exists that fails on the previous code.
             The gate is clean against the baseline.
REPORT       Maximum 200 words: root cause in one sentence; the fix; verification performed;
             any similar defects observed elsewhere (list them, do not fix them).
```

## 6. Spec reviewer

```
OBJECTIVE    Verify the change <commit range> against its requirements.
SOURCES      Task: <text or link>. Plan: <path>. Specification: <path>. Design notes: <path>.
             Research brief and evidence: <research/BRIEF.md, research/EVIDENCE.md, or "none">.
SCOPE        Read-only. You did not author this change.
FOCUS        Required behaviour that is missing or different; behaviour present that the
             specification does not describe; differences in limits, error codes and edge
             cases; documentation that misdescribes the code; design decisions that rest on an
             assumption rather than a cited claim, or that contradict a claim in the brief.
REPORT       Maximum 400 words. For each divergence: location (file:line), the requirement,
             the actual behaviour, and a proposed severity (S1/S2/S3/Rejected).
```

## 7. Breaker

```
OBJECTIVE    Find failures in <commit range> under adverse conditions. Assume a defect exists.
FOCUS        Process termination and restart at each step; races and reordering; retries and
             duplicate delivery; lost or ambiguous responses; malformed, empty and oversized
             input; limits; platform and path differences; alternate working directories;
             stale build artifacts; slow or loaded CI; missing configuration.
             This host is one platform. For every new test that touches the filesystem, also
             read for what another platform does: a symlink made outside the project's guard,
             a fixed host path (`/etc/...`, `/tmp`) as a target, an assertion on a link's
             stored text, separators, case, line endings. Report each as a finding even
             though the test is green here.
SCOPE        May add tests and scratch files under <temporary directory>. Product code is
             read-only.
REPORT       Maximum 400 words. For each finding: a reproduction (command or failing test),
             the impact, and a proposed severity. Then list the scenarios tested that held.
```

## 8. Mutation auditor

```
OBJECTIVE    Demonstrate that the test suite detects defects in <commit range>.
METHOD       For each guard, condition, branch and invariant in the diff, apply one small
             mutation (remove a check, invert a condition, reorder two steps, skip a call),
             run the relevant tests, record the result, and restore. Leave the tree clean.
             Then, for every NEW test in the diff, remove the guard that test names and run
             that test alone: green means SURVIVED, whatever other rule caught its input.
REPORT       Maximum 300 words. A table of mutation → detecting test, or SURVIVED.
             For each survivor, describe the test that should exist, or the input the
             existing test must feed so that it reaches the guard.
```

## 9. Invariant auditor

```
OBJECTIVE    Demonstrate that these invariants hold after <commit range>: <list>.
METHOD       For each invariant, identify the code paths that could violate it, then run or
             write a check that would fail on violation (for example: byte scans for secrets in
             files, logs, hashes and outputs; counts of side effects that must occur at most
             once; tests at crash and restart points).
REPORT       Maximum 300 words. For each invariant: HOLDS, VIOLATED or UNPROVEN, with evidence.
```

## 10. Documentation

```
OBJECTIVE    Update <specification / architecture / plan files> for <task>.
STYLE        Match the existing pages at <paths>.
STANDARDS    Every identifier mentioned must exist in the source (verify each one). Every link
             must resolve. Run <documentation checks>. State differences between design and
             implementation explicitly. Do not describe behaviour the code does not have.
REPORT       Maximum 250 words: files changed, checks run and their results, anything in the
             code that could not be explained.
```
