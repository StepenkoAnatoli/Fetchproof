# Requirements, Decision Records, Traceability and the Report

<!-- Modified by Fetchproof on 2026-10-20: the kit's old name, Research-Kit, is Fetchproof here, as are the paths and variables that spelled it (ADR-0186). Received baseline: StepenkoAnatoli/SkillsMDs at 3f2d2fc. -->

Four documents, one chain: a requirement names the claim it came from; a decision names the
requirements it serves; a unit names the requirements it satisfies; a traceability row names
the test that proves it; the report names the rows that were not proven. Break the chain
anywhere and the completion standard fails, by design.

All four live in the run folder (`docs/orchestration/<date>-<slug>/`) and are committed with it.

## Contents

1. `REQUIREMENTS.md`
2. Decision records
3. `TRACEABILITY.md`
4. `REPORT.md`
5. Source vocabulary

---

## 1. `REQUIREMENTS.md`

```markdown
# Requirements: <task slug>

Task statement: <copied from RUN.md, verbatim>
Research briefs: <paths>, or "none (research SKIPPED: <reason>)"

| ID   | Category     | Requirement                                              | Source            | Acceptance (how it is shown to hold)                  |
|------|--------------|----------------------------------------------------------|-------------------|-------------------------------------------------------|
| R-01 | functional   | Export writes one row per order in the window           | request, line 1   | tests/export.test.ts: window with 3 orders → 3 rows   |
| R-02 | integration  | Calls the provider's batch endpoint, max 100 ids per call| E-04 (brief A)    | test asserts chunking at 100; E-04 quoted limit       |
| R-03 | reliability  | A timeout retries at most twice with backoff             | E-07 (brief A)    | test with a stubbed timeout: 3 attempts, then error   |
| R-04 | security     | The provider key is read from the environment only       | judgment: <why>   | grep for the key name in the repo; none in files       |
| R-05 | non-functional | 10k orders export in under 60 s on the CI runner        | request, line 4   | measured in CI job <name>; "not verified here" if not |
| R-06 | constraint   | No new runtime dependency                                | judgment: <why>   | diff of the manifest                                  |
| R-07 | data         | Dates are stored in UTC and rendered in the user's zone  | repo: src/time.ts | existing tests + new TZ test                           |
| R-08 | testing      | Every new test fails with its guard removed              | lead-orchestrator | builder reports, guard-removal lines                   |
| R-09 | acceptance   | A reviewer can export from the staging UI                | request, line 6   | UNTESTED here: staging only; step listed in report     |
```

Categories: functional, non-functional, constraint, architecture, data, integration, security,
reliability, testing, acceptance. Use only the categories the task needs; an empty category is
not listed.

Rules:

- A row with a Source of "guess" does not exist; it becomes a Mandate question.
- A KNOWN-UNKNOWN from a brief (`U-nn`) can be a source; the acceptance column then names the
  day-one verification step, and the traceability row stays UNTESTED until it runs.
- The acceptance column is written before the build, so the test is written to it and not the
  other way round.
- Requirements change only through the self-correction procedure: the old row is kept, struck
  through, with the reason and date, so the audit can see what moved.

## 2. Decision records

One per decision that would be expensive to reverse: a dependency, a schema, a protocol, a
boundary between components, an interface other code will depend on. Short ones live in
`REQUIREMENTS.md` under a "Decisions" heading; long ones go to `decisions/D-nn.md` in the run
folder, or to the project's own ADR location if it has one.

```markdown
### D-01: <decision in one line>
- Serves: R-02, R-03
- Rests on: E-04, E-07 (brief A); repo: src/http/client.ts
- Alternatives considered: <A: one line, why not>; <B: one line, why not>
- Why this wins: <the reason, in terms of the requirements>
- Trade-offs: <what is given up>
- Risks: <what could make this wrong, and the signal that would show it>
- Reversal cost: <low / medium / high, and what reversing would take>
```

A decision that rests on an assumption rather than a claim or a repository fact is labelled
`assumed` in the "Rests on" line and listed among the Mandate's assumptions.

## 3. `TRACEABILITY.md`

Written at Stage 9, from `REQUIREMENTS.md`, `RUN.md` and the reports. One row per requirement;
no requirement is dropped between the two files.

```markdown
# Traceability: <task slug>

| ID   | Source       | Unit / commit            | Evidence (test or command, with result)                     | Review                     | Status    |
|------|--------------|--------------------------|-------------------------------------------------------------|----------------------------|-----------|
| R-01 | request l.1  | U1 / a1b2c3d             | tests/export.test.ts "3 orders → 3 rows": pass; guard removed → fail | U1 unit review; spec review | VERIFIED  |
| R-02 | E-04         | U2 / d4e5f6a             | tests/provider.test.ts "chunks at 100": pass; guard removed → fail | U2 unit review; mutation auditor: killed | VERIFIED |
| R-05 | request l.4  | U1, U2 / a1b2c3d, d4e5f6a| CI job perf-export: 41 s (run #318)                         | -                          | VERIFIED  |
| R-09 | request l.6  | -                        | staging export not reachable from here; step: <how>          | -                          | UNTESTED  |
| R-10 | E-09         | U3 / 7g8h9i0             | test exists but passes with guard removed (F6)              | breaker                    | NOT MET: F6 open |

Hardening: reports/break-test-1.md - <n> findings, <m> fixed (<commits>), <k> risks remaining (<ids>)
Audit: reports/gap-audit-1.md - <n> gaps, <m> fixed (<commits>), <k> open (<ids>), <s> solid
Final gate: <command> on <sha>: failing set <equals baseline / differs: ...>
Research: <project>: preflight exit 0 at <date>; audit snapshot in REPORT.md
```

Status vocabulary: VERIFIED (a command ran and showed it); UNTESTED (could not run here; the
step and environment are named); NOT MET (with the finding id and why). Nothing else.

## 4. `REPORT.md`

The final output the user reads. Lead-orchestrator's final report template is the spine; the
auto-build sections are added in the order below. Keep it to what the user needs to decide
whether to trust the run; the details are one path away in the run folder.

```markdown
# Auto-build report: <task slug>

**Summary:** <what was built, in two sentences>; run <fresh / resumed at "<checkpoint>">; merged as <sha> on <base> / pull request #<n> open, merge held by <Mandate / condition>.

## What was built and why this way
<three to six lines: the design in plain words, the decision records by id, and the alternative
that was closest>

## Files and components
<one line per unit: files, purpose, commit; then break-test and gap fixes by commit>

## Research-to-implementation traceability
<TRACEABILITY.md path>; <n> requirements: <v> VERIFIED, <u> UNTESTED, <m> NOT MET.
<every UNTESTED and NOT MET row listed with its reason>

## Tests performed
<suites and counts; repetition runs; mutations detected; break-test probes run (incl. null
results, by count); gap-audit passes; gate against baseline on the merged head>

## Failures discovered and fixes applied
<one line each: finding id, what failed, root cause, fix commit; include the lead's own
mistakes>

## Remaining limitations and known risks
<break-test remaining risks by severity; open gaps; KNOWN-UNKNOWNs with their verification
steps; anything not verifiable here and the environment that must confirm it>

## Four-dimension scorecard
<pasted unedited, or "four-dimension-audit not installed; self-assessed: ...">

## Final validation status
COMPLETE / BLOCKED (<reason>) - against the completion standard in SKILL.md, line by line:
- requirements: <v>/<n> VERIFIED ...
- gate equals baseline on merged head: <yes / no>
- break-test: <DONE / SKIPPED (reason)>; gap-audit: <DONE / SKIPPED (reason)>
- S1 and Critical findings: <all FIXED and RE-REVIEWED / list>

## Decisions made without asking
<from RUN.md "Decisions and assumptions"; each reversible and why>

## Open items and decisions needed
<recorded findings; kit findings; stop-list items hit; what the user should decide next>

## Run ledger
<RUN.md path>; MANDATE.md reply: <token> at <time>; research projects: <paths>
```

Never describe something as working unless the traceability row says VERIFIED. Never round a
count. Never omit the "Decisions made without asking" section, even when it says "none".

## 5. Source vocabulary

| Source form                 | Means                                                                 |
|-----------------------------|-----------------------------------------------------------------------|
| `request, line n`           | the user's invocation, as recorded verbatim in `RUN.md`                |
| `E-nn (brief X)`            | an evidence row in a Fetchproof project's `EVIDENCE.md`, cited through its brief |
| `U-nn (brief X)`            | a KNOWN-UNKNOWN; the requirement carries its verification step          |
| `repo: <path>`              | a fact read in the repository at that path                              |
| `judgment: <why>`           | an engineering judgment, with its reason, open to the user's override   |
| `MANDATE.md`                | a correction or answer the user gave in the Mandate reply               |
| `lead-orchestrator` etc.    | a standard a delegated skill imposes                                    |
