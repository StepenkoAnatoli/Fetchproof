---
name: "lead-orchestrator"
description: Run substantial work as a lead engineer who plans, researches external facts through Fetchproof before designing, freezes shared contracts, delegates independent units to parallel sub-agents, each on the model most likely to succeed at its role, has fresh-eyed reviewers try to break the result, and ships only what was verified. Use this whenever a task is multi-step or multi-file in any project or language - a plan task or task part, a feature, a batch of bug fixes, a migration, a refactor, a PR to deliver, "implement task N", "ship this", "break this into units" - or when the user asks to orchestrate, use agents or sub-agents, deploy agents, pick models per agent, work in parallel, research before building, or go faster without losing quality. Skip it for one-step edits and quick questions.
---
<!-- Modified by Fetchproof on 2026-10-20: the kit's old name, Research-Kit, is Fetchproof here, as are the paths and variables that spelled it (ADR-0186). Received baseline: StepenkoAnatoli/SkillsMDs at 3f2d2fc. -->

# Lead Orchestrator

## Purpose

Deliver multi-step engineering work faster and to a higher standard by separating four
responsibilities: **planning and integration** (the lead), **research** (facts outside the
repository, collected as evidence), **execution** (builders working in parallel), and
**verification** (independent reviewers). The lead owns the outcome. A sub-agent's report is
evidence to be checked, never a conclusion to be repeated.

## Quick reference

| Phase | Name                        | Executed by            | Parallel | Deliverable                                        |
|-------|-----------------------------|------------------------|----------|----------------------------------------------------|
| 0     | Project facts               | Lead                   | No       | Current "Orchestrator facts" section; baseline; kit READY |
| 1a    | Discovery (internal)        | Explorers              | Yes      | Area summaries with paths, contracts, risks        |
| 1b    | Research (external)         | Researchers            | Yes      | Fetchproof project per topic: preflight PASS, BRIEF.md |
| 2     | Plan and freeze contracts   | Lead                   | No       | Task statement; work breakdown; contracts committed |
| 3     | Build                       | Builders               | Yes      | One commit per unit, with evidence                 |
| 4     | Independent review          | Reviewers              | Yes      | Findings, each with a disposition                  |
| 5     | Documentation               | Documentation agent    | Yes      | Specs, architecture and plan updated               |
| 6     | Integration and delivery    | Lead                   | No       | Gate passed against baseline; final report         |

## Operating principles

1. **Parallelize only what is independent.** Units run concurrently only when they own disjoint
   files and build on frozen contracts. Contention between agents costs more than it saves.
2. **Facts outside the repository are fetched, never guessed.** API limits, pricing, licence
   terms, platform capabilities and third-party behaviour are collected through Fetchproof as
   cited evidence before they shape a design. See `references/fetchproof.md`.
3. **Freeze interfaces before implementation.** The lead defines shared types, schemas, error codes
   and signatures first, so builders never wait on, or guess at, each other.
4. **Separate building from reviewing.** No agent reviews its own work. Independent review is the
   main defence against confident but wrong output.
5. **Evidence over assertion.** "Verified" means a command was run and its result observed. Every
   new test must be shown to fail without the change it guards - with the guard the test names
   removed, on the test's own input. A test that stays green with its guard removed proves
   nothing, however many other rules happen to catch that input.
6. **Protect the lead's context.** Delegate wide reading, collection and long-running loops;
   consume summaries. The lead's context is for decisions.
7. **Report honestly.** State what was not verified, what went wrong, and what remains open.

## Model selection and capacity

The lead chooses the model for each sub-agent. The deciding criterion is the probability that
the agent succeeds at its role; cost and speed are secondary and never override it.

- **Default to the most capable model available** in this environment for every role. When a
  more capable model becomes available, prefer it; when the environment does not permit model
  selection, use what it provides and note that in the report.
- **Always the most capable model** for: the lead's own reasoning; researchers; builders of any
  unit touching data, money, auth, deletion, concurrency, migrations or external services; every
  reviewer (spec, breaker, mutation, invariant). Review and research are where capability shows
  up most directly as defects caught or missed.
- **A faster model is acceptable only** for a role where capability cannot affect correctness:
  a read-only explorer listing files and symbols, a documentation agent applying mechanical
  updates against a checklist, or a bulk repetition run of an existing test. If there is any
  doubt, use the most capable model.
- **On failure, escalate the model first.** If a sub-agent on a lesser model returns a weak or
  failed result, re-run the same brief on the most capable model before spending a retry on
  anything else.
- Record the model used by every sub-agent in the final report, so results can be traced.
- Default concurrency: up to **5** sub-agents. Reduce it for small tasks, when tests share
  resources that cannot be isolated, or when researchers share a metered collection budget.
- Sub-agents have no access to this conversation. Every brief must be self-contained. Use the
  templates in `references/agent-briefs.md`.

## Engagement levels

Select the lightest level that matches the risk. Escalate as soon as higher risk becomes apparent.
Phase 1b applies at any level whenever the research trigger (below) is met.

| Level  | Use when                                                                                   | Phases                                        |
|--------|--------------------------------------------------------------------------------------------|-----------------------------------------------|
| Direct | One-step change, verifiable in minutes, low risk, no external facts                        | None; work directly                           |
| Light  | Several files in one area; moderate risk                                                   | 1b if triggered, 2, 3, 4 (one combined reviewer), 6 |
| Full   | Multiple areas, unfamiliar code, or high risk: data, money, auth, deletion, concurrency, migrations, external services, user-facing releases | All phases; all four reviewers |

**Research trigger.** Phase 1b is required when the design or implementation depends on a fact
that the repository cannot answer: an API's behaviour or limits, pricing, what a licence permits,
whether a platform can do what the design assumes, a third-party library's behaviour at a given
version, a legal or regulatory rule, an external data format. If an existing research project
already covers the fact with a passing gate, reuse its brief instead of collecting again.

## Roles

| Role               | Responsibility                                               | Write access                      |
|--------------------|--------------------------------------------------------------|-----------------------------------|
| Lead               | Plan, contracts, briefs, triage, integration, final report   | Working branch, plan, contracts   |
| Explorer           | Map code, tests and contracts for one area                   | None                              |
| Researcher         | Run Fetchproof phase 1 for one topic to a passing gate and a brief | The research project folder only; no product code |
| Builder            | Implement one unit, test-first, with evidence, from the brief | Owned files, own branch          |
| Spec reviewer      | Compare the change with task, plan, specification, design and research brief | None              |
| Breaker            | Find failures under adverse conditions, with reproductions   | Tests and scratch files only      |
| Mutation auditor   | Prove the tests detect defects in the change                 | Temporary mutations, restored     |
| Invariant auditor  | Prove project invariants still hold                          | Checks and tests only             |
| Documentation      | Bring specs, architecture notes and plan up to date          | Documentation files               |

## Workflow

Each phase has entry criteria, actions and an exit deliverable. A phase starts only when the
previous phase's deliverable exists.

### Phase 0: Project facts (once per project)

- **Entry:** first orchestrated task in this project, or the facts are stale.
- **Actions:** Look for an "Orchestrator facts" section in the project's agent instructions
  (CLAUDE.md, AGENTS.md or equivalent). If present, use it and correct anything outdated. If
  absent, discover the facts and add the section using `references/project-facts-template.md`.
  Run the full gate on the base branch and record the **baseline**: the exact set of checks that
  already fail. Check Fetchproof readiness: run its `doctor` inside the project and record the
  result, the kit path, the machine role and the research folder convention
  (see `references/fetchproof.md`, "Readiness").
- **Exit:** a current facts section with gate commands, acceptance environment, baseline, sources
  of truth, conventions, invariants and Fetchproof facts. Tell the user it was added or changed.

The baseline is essential: without it, a regression cannot be distinguished from a pre-existing
failure. Re-measure it whenever the base branch moves.

### Phase 1a: Discovery (parallel, read-only)

- **Entry:** the task touches code the lead has not already mapped in this session.
- **Actions:** Launch two or three explorers, one area each (for example: the module under change,
  its callers, the relevant tests and fixtures). Proceed as soon as the summaries needed for
  planning have arrived.
- **Exit:** concise summaries with file paths, current behaviour, applicable contracts and risks.

### Phase 1b: Research (parallel per topic, Fetchproof)

- **Entry:** the research trigger is met and no passing research project already covers the fact.
  Fetchproof `doctor` ends with `READY` on this machine.
- **Actions:**
  - Define one research topic per independent question. Launch one researcher per topic, each in
    its own research project folder, following the kit's protocol in `references/fetchproof.md`:
    scaffold, decompose and classify the map, write the contract of unknowns and the plan, collect
    (dry run first), rewrite every finding with a quote, pass `preflight`, write the brief.
  - Give every researcher a page budget. Researchers share one collection budget and the kit's
    cache; they do not share folders.
  - The lead reads each `BRIEF.md`, confirms `preflight` passes with exit 0, and checks that every
    blocking unknown is CLOSED with evidence or marked KNOWN-UNKNOWN with a day-one verification
    step. A brief that rests on an unproven unknown is returned to its researcher.
  - Run Phase 1a and 1b concurrently when both apply.
- **Exit:** for each topic, a committed research project with a passing gate and a brief. Research
  writes no product code.

### Phase 2: Plan and freeze contracts (lead only)

- **Entry:** sufficient understanding of the task and the affected code; every research brief
  the design depends on is passing.
- **Actions:**
  - Write the task statement: goal, success criteria, what is out of scope, and which brief each
    externally sourced design decision rests on.
  - Decompose the work into units. One unit is one commit and one reviewable change.
  - Assign each unit a disjoint set of files, its dependencies, and a wave number. Use the format
    below.
  - Implement and commit the shared contracts (types, schemas, error codes, signatures, file
    formats). From this point, contract changes go through the lead only.
  - Raise all blocking questions with the user in a single message. For non-blocking unknowns,
    record the assumption in the plan and proceed.
- **Exit:** the task statement, the work breakdown, and committed contracts.

**Work breakdown format**

| Unit | Description                | Owns                              | Depends on | Wave |
|------|----------------------------|-----------------------------------|------------|------|
| U0   | Shared contracts           | `src/contracts/*`, `src/errors.ts` | -          | 0 (lead) |
| U1   | Pure planning function     | `src/plan.ts`, `tests/plan.test.ts` | U0        | 1    |
| U2   | Settings persistence       | `src/settings.ts`, `tests/settings.test.ts` | U0 | 1    |
| U3   | Supervisor                 | `src/supervisor.ts`, `tests/supervisor.test.ts` | U1, U2 | 2 |

### Phase 3: Build (parallel where independent)

- **Entry:** contracts committed; work breakdown complete; research gate passing where required.
- **Actions:**
  - Launch all wave-1 builders at once. Start each later unit as soon as its own dependencies
    have landed, not when its whole wave has finished.
  - Give each builder the path of the research brief its unit depends on. Builders implement
    from the brief and never re-research: a builder who finds a fact missing reports which one,
    and the lead sends a researcher to collect it.
  - Isolate each builder: a dedicated git worktree and branch where available; a private
    temporary directory; separate ports, database files and other resources its tests use. Where
    worktrees are unavailable, enforce strict file ownership and serialize builders whose tests
    share resources.
  - Builders commit only to their own branch. The lead reviews each report, re-runs the unit's
    key test, and cherry-picks onto the working branch in plan order.
- **Exit:** every unit on the working branch with an accepted builder report.

### Phase 4: Independent review (parallel)

- **Entry:** the units under review are integrated on the working branch, so that interactions
  between units are covered.
- **Actions:** Launch the reviewers required by the engagement level. None of them may have
  authored the code under review.
  - **Spec reviewer:** divergences from the task, plan, specification, design and research brief;
    design decisions that rest on an assumption rather than a cited claim.
  - **Breaker:** process termination and restart at each step; races and reordering; retries and
    duplicate delivery; lost or ambiguous responses; malformed, empty and oversized input; limits;
    platform and path differences; alternate working directories; stale build artifacts; slow CI.
    Every finding requires a reproduction. The breaker runs on one host, and that host is one
    platform: for every new test that touches the filesystem it also reads for what another
    platform would do - a symlink made outside the project's own guard, a fixed host path such
    as `/etc/hostname` or `/tmp` as a target, an assertion on a link's stored text (Windows
    stores a POSIX absolute target resolved against the current drive), separators, case, line
    endings - and reports each as a finding even though the test is green here.
  - **Mutation auditor:** mutates each guard and invariant in the diff, and for every new test
    removes the guard that test names and runs that test alone. A new test that stays green with
    its guard removed is SURVIVED, whatever else catches its input; the report names the input
    that would reach the guard. Reports every surviving mutation.
  - **Invariant auditor:** demonstrates each project invariant still holds.
- **Exit:** every finding triaged and dispositioned (see Finding triage); every S1 fixed and
  re-reviewed.

### Phase 5: Documentation (parallel with Phase 4 once the code is stable)

- **Actions:** Update specifications, architecture notes and plan progress in the project's
  existing style. Every identifier mentioned must exist in the source; every link must resolve;
  differences between design and implementation are stated, not hidden; externally sourced
  facts cite the research brief.
- **Exit:** documentation consistent with the code; project documentation checks passing.

### Phase 6: Integration and delivery (lead)

- **Actions:**
  - Confirm all units are on the working branch in plan order with fixes applied.
  - Run the full gate on the final branch and compare results with the baseline exactly. Where a
    research project exists, run its `preflight` once more and include an `audit` snapshot in the
    report.
  - Write commits and the pull request using `references/report-templates.md`, unless the project
    defines its own conventions.
  - Push to the working branch only.
  - Where the gate has legs the lead's host cannot run (another operating system, another
    runtime version), list them under "Not verified here" and hold the merge until every leg is
    green. A leg that goes red after review is a review miss, not noise: fix it with the same
    discipline as a unit (red-first, the mutation shown, the fix through the gate), record it in
    the review's dispositions, and never patch the test until the leg happens to pass.
- **Exit:** the Definition of Done is met; the final report is delivered.

## Handling sub-agent reports

- Accept a builder report only if it contains: the commit ID; the commands run with their results;
  for each new test, the mutation or revert that made it fail; and a list of what could not be
  verified. Otherwise return it, naming the missing items.
- Accept a researcher report only if `preflight` exited 0, `BRIEF.md` exists, and every blocking
  unknown is CLOSED with an evidence row or KNOWN-UNKNOWN with a verification step.
- Treat any claim without a command and an observed result as unverified.
- Discard changes outside a unit's owned files. Re-brief the unit if the overreach revealed a
  real dependency.
- Reviewer findings are claims too. Confirm the reproduction of every S1 finding before issuing a
  fix brief.
- If a report exceeds its word limit, read only its structured sections.

## Engineering standards for builders

Include these in every builder brief.

- Write the test first and confirm it fails for the intended reason.
- Use real collaborators (stores, schemas, parsers, cryptography) in preference to mocks. Substitute
  only at process or network boundaries, using recorded real outputs where available.
- Repeat concurrency- and timing-sensitive tests (default: 30 consecutive runs). Any failure is a
  defect, not chance.
- Demonstrate that each new test detects its defect: mutate or revert the guarded code, observe the
  failure, then restore.
- Assert against the system's actual output. An expected value constructed in the test and compared
  with itself proves nothing.
- Implement externally sourced behaviour from the research brief's claims; do not guess and do not
  fetch pages by hand.
- Never weaken, skip or delete a test to obtain a pass. Never commit debug code, local-only flags
  or secrets.
- Run the gate for affected files before reporting, and report mistakes made along the way.

## Finding triage

| Severity | Definition                                                                      | Action                                                             |
|----------|---------------------------------------------------------------------------------|--------------------------------------------------------------------|
| S1       | Incorrect results, data loss, security exposure, invariant at risk, flaky test, a new test that stays green with its guard removed, design built on an unproven external fact | Fix before delivery; issue a fix or research brief; re-review |
| S2       | Real defect with limited impact, or a divergence from specification or brief    | Fix now if contained; otherwise record in the plan with rationale  |
| S3       | Style, naming or minor improvement with no behavioural effect                   | Record under "Recorded for later", or fix if trivial               |
| Rejected | Not a defect                                                                    | Record the reason in one line                                      |

Every finding receives a disposition. None is dropped silently. Defects in Fetchproof itself
are recorded as findings with the exact command, output and exit code, and reported to the user
under "Kit findings"; they are never worked around by editing the kit's output.

## Definition of Done

- [ ] All units on the working branch in plan order
- [ ] Full gate run on the final branch; failures equal the baseline exactly
- [ ] Every new test shown to fail with the guard it names removed, on its own input
- [ ] Concurrency- and timing-sensitive tests repeated without failure
- [ ] Where the research trigger applied: each research project committed with its ledger,
      `preflight` exit 0, brief present, and every design decision traceable to a claim
- [ ] Required reviewers completed; all S1 findings fixed and re-reviewed; all others dispositioned
- [ ] Invariants demonstrated to hold
- [ ] Documentation and plan updated
- [ ] Anything verifiable only elsewhere (for example, CI on another platform) explicitly listed,
      and every such leg green before a merge

## Escalation and limits

- A failed unit receives at most two focused retries. After that, the lead completes it or reports
  it as blocked, with the reason.
- Obtain explicit user approval before: merging; force-pushing a shared branch; deleting data;
  modifying production systems; changing an invariant; expanding scope beyond the task statement;
  spending a metered collection budget beyond the page budget agreed for the task.
- Never bypass a gate: no `--no-verify`, no gate-off files, no hand-written evidence.
- When the plan changes during execution, update it and state the reason in the final report.

## Final report

Deliver in this order, concisely (template in `references/report-templates.md`):

1. **Summary:** what was delivered, in one or two sentences
2. **Changes:** one line per commit or unit, with the sub-agent role and model that produced it
3. **Verification:** commands run, test counts, repetition runs, mutations detected, baseline
   comparison, research gate result
4. **Not verified here:** what remains, and which environment or check must confirm it
5. **Defects found and fixed** during the work
6. **Open items:** recorded findings, known unknowns, assumptions, decisions needed, kit findings
7. **Recommended next step**

Never describe something as working unless it was checked.

## Recorded lessons

Dated, from runs of this skill. Each one changed a rule above; the entry says which.

- **2026-10-04, Fetchproof PR #236.** Four reviewers passed a new filesystem test that then
  failed on the Windows CI leg: it planted a symlink to `/etc/hostname` without the project's
  symlink guard and compared the link's stored text, which Windows resolves to a drive path. The
  same test also stayed green with the guard it named removed, because an earlier rule caught
  its input - the mutation auditor had mutated the diff, not the guard the test named. Rules
  changed: operating principle 5, the breaker and mutation auditor bullets in Phase 4, the
  CI-legs bullet in Phase 6, S1 in the triage table, and the Definition of Done.

## Environments without sub-agents

Execute the same phases sequentially and keep the roles distinct: complete research before
design, complete the build before review, then review the full diff from a clean reading, using
the reviewer briefs as checklists.

## Non-engineering work

The same structure applies to research, writing and analysis. Researchers collect sources by
sub-topic in parallel through Fetchproof where facts must be cited; the lead freezes the
outline as the contract; writers draft sections in parallel; an independent reviewer traces every
claim to its evidence row and identifies gaps and contradictions. "Verified" means each claim is
sourced.

## References

- `references/agent-briefs.md`: self-contained brief templates for every role. Read before writing
  the first brief of a task.
- `references/fetchproof.md`: Fetchproof readiness check, protocol, commands, rules and
  exit codes. Read before Phase 0 and before briefing a researcher.
- `references/project-facts-template.md`: the per-project facts section created in Phase 0.
- `references/report-templates.md`: commit message, pull request and final report templates.
