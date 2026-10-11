# Stage Handoffs

<!-- Modified by Research-Kit on 2026-10-08: approval handoffs and unattended owner stops align with the governing Research-Kit note and ADR-0146; ADR-0150 adds complete-review/Git-ownership handoff guidance. Received baseline: StepenkoAnatoli/SkillsMDs at 3f2d2fc. -->

How auto-build hands each stage to the skill that owns it, what that skill must leave behind
before the next stage may start, where auto-build adapts the skill's rules (and why), and what
to do when the skill is not installed. Design questions are batched into the Mandate;
the governing Research-Kit note keeps separate owner stops and completed-head merge approval.

## Contents

1. Locating a delegated skill
2. Stage 0: Orient (lead-orchestrator R, 0)
3. Stage 1: Research (Research-Kit via lead-orchestrator 1a, 1b)
4. Stage 3: Design (brainstorming)
5. Stage 5: Build (lead-orchestrator 2–5)
6. Stage 6: Harden (break-test)
7. Stage 7: Audit (gap-audit)
8. Stage 9: Validate (four-dimension-audit)
9. Writing a brief for a delegated stage
10. Fallbacks when a skill is missing

---

## 1. Locating a delegated skill

Skills appear in the environment's skill list by name: `lead-orchestrator`, `brainstorming`,
`break-test`, `gap-audit`, `four-dimension-audit`. Some installations prefix a plugin id
(`<uuid>:brainstorming`); match on the final segment. Read the skill's `SKILL.md` when the stage
starts, not from memory: these skills change, and their changelogs record rules learned from
runs that memory will not have.

Record in `RUN.md` under "Decisions and assumptions" which skills were found and which fell back,
with their versions where the frontmatter gives one.

## 2. Stage 0: Orient

**Invoke:** lead-orchestrator Phase R, then Phase 0, exactly as written there.

**Must leave:** `RUN.md` with the header table, the auto-build stage table, the task statement
(the invocation verbatim), the baseline (base commit and the exact failing set), the
"Orchestrator facts" section present in the project's agent instructions, and the Research-Kit
`doctor` result with its date.

**Adaptation:** the stage table (SKILL.md, "The run ledger") is added after the header. Nothing
else.

**Credential rule:** if the task's input contains a secret, note "input contained a credential;
not copied; user told" in the log line for Stage 0, without the value.

## 3. Stage 1: Research

**Invoke:** lead-orchestrator Phases 1a and 1b, including its `references/research-kit.md` for
the protocol, exit codes, machine roles and kit-finding format. One researcher per independent
question, each in its own research project folder, each with a page budget.

**Must leave, per topic:** the research project folder under the project's convention (default
`docs/research/<YYYY-MM-DD>-<topic>/`), handoff and `preflight` exit 0 recorded,
classified MAP, rewritten Findings and an authored brief with both judged sections
answered and current stamped inputs (authored unstamped compatibility remains under
ADR-0138), plus a row in `RUN.md`'s Research table with status BRIEFED or COMMITTED.
File presence or a Git request result marked `collected` alone is not this handoff.

**Sufficiency gate** (the lead's check, after the kit's): read each brief against the task and
write under "Decisions and assumptions" one line per design-critical question with the claim
that answers it (`E-nn`). A question with no claim is either a KNOWN-UNKNOWN with a verification
step the design will include, or a reason to return the brief.

For Git requests, the builder reads and judges the returned captures, while the
collector records Findings, closures, the map and current authored brief. Return a
review-only gap in prose; fetch only a missing fact. ADR-0052's received-package local
review and re-packaging remains available without collection (ADR-0150).

**Adaptation:** the governing Research-Kit note keeps the owner stops and the separate
completed-head approval. A standing budget is a preference; paid collection requires
the owner's authorization for that unchanged collection. Without it, use only free
transports (`http-keyless`, `browser`) and record the actual evidence policy and
keyless warnings. Free collection does not change the configured policy to pluralist.

**When the trigger is not met:** SKIPPED, with the one-sentence reason in the stage table. The
reason must be checkable ("all behaviour depends on code under `src/` and the project's own
tests; no third-party behaviour, pricing or licence shapes the design").

## 4. Stage 3: Design

**Invoke:** `brainstorming`, Design mode, with the task statement, `REQUIREMENTS.md` and the
briefs as input. Say the classification out loud in the Mandate so the user can override it.

**Must leave:** for Bounded, the design (approach, files touched, how it will be tested) as a
section of the Mandate; for Architectural, the committed spec at brainstorming's path, the two or
three approaches compared, and the decision records; for Spike, the probe plan, and then the
finding - a spike's output is an answer, and keeping its code is a new auto-build run.

**Adaptations, with reasons:**

- Brainstorming asks "does this look right so far?" after each section and asks for a spec
  review as a separate question. Auto-build batches these into the Mandate because the user asked
  for one design approval. The content is unchanged: every section is presented, every assumption
  is labelled, the recommendation leads with the case against it.
- Brainstorming's one-way ratchet is kept. Hidden complexity discovered after the Mandate
  upgrades the classification; the lead stops, says what it found, and presents a revised
  Mandate. Approval of the smaller design does not cover the larger one.

## 5. Stage 5: Build

**Invoke:** lead-orchestrator from Phase 2 (plan and freeze contracts) through Phase 5
(documentation), at the engagement level its table selects. Pass it: the task statement, the
approved design or spec path, `REQUIREMENTS.md`, every brief path, and the Mandate's stop-list.

**Must leave:** everything lead-orchestrator's Phases 2–5 require, plus one addition in each
builder brief: the requirement rows (`R-nn`) the unit satisfies and the research brief and claims
it implements from. The unit reviewer checks the unit against those rows as well as the brief.

**Adaptation:** lead-orchestrator asks for explicit approval before merging and before expanding
scope. The Mandate approves work inside the task statement, while merge still requires
the owner's separate reply for the completed head. Scope beyond the task statement,
invariant changes, data deletion, production changes and force-pushes remain owner stops.
At any unanswered required stop, record "awaiting owner" and end the turn, including
an unattended run. A changed Mandate requires fresh approval.

## 6. Stage 6: Harden

**Invoke:** `break-test` with its full procedure, including its own Research-Kit binding for any
external fact a finding rests on.

**Set-up differences from a standalone run:**

- The checkout break-test starts from is the integrated working branch at the commit recorded in
  `RUN.md` after Phase 5, not the user's checkout. Its worktree and `break-test/<date>` branch
  are created from that commit.
- Its baseline is the working branch's gate at that commit, which should equal the project
  baseline; a difference is itself the first finding.
- It commits retained fixes to its own branch as its procedure says. The lead then cherry-picks
  each fix onto the working branch as its own commit (never squashed), re-runs the gate, and
  records each as a finding in `RUN.md` with disposition FIXED and the working-branch commit.

**Must leave:** the break-test report saved under `reports/break-test-1.md` in its own template;
its findings copied into the `RUN.md` Findings table with severities mapped (Critical → S1,
High → S1 if Likely else S2, Medium → S2, Low → S3); remaining risks listed under open items;
every "decision required" item named for the user.

**Adaptation:** break-test asks the user before probes that could reach real services and before
fixes that need an owner's decision. Under a Mandate with the user present, ask in one message.
With nobody present, follow break-test's own unattended rule (skip, record, continue) - the
Mandate does not pre-authorize reaching a real service.

## 7. Stage 7: Audit

**Invoke:** `gap-audit` on the delivered system. The purpose it audits against is the task
statement's; the outputs are the ones the task touches; the comparison sets are chosen for those
outputs. Its research project for comparison claims goes under the project's research
convention beside the Stage 1 projects.

**Depth** (from the Mandate's `Audit` line):

- `full`: gap-audit's own stopping rule; expect several passes.
- `scoped`: the same passes and the same stopping rule, but comparison dimensions limited to
  the outputs the change affects. Say so in the audit's Current State Summary.
- `off`: SKIPPED, with the user's reason from the Mandate. Not available at Full engagement.

**Must leave:** the audit report saved under `reports/gap-audit-1.md` in gap-audit's required
structure; each surviving gap copied into the `RUN.md` Findings table with a disposition.

**Adaptation, with reason:** gap-audit changes nothing until the user writes `IMPLEMENT THE
RESEARCH`, and then hands the design to brainstorming for approval. Inside auto-build the user
has already approved the requirements and the design; a gap that would make an output inside
the task statement inaccurate, incomplete or unreliable is a defect against that approval, so:

- in-scope gap, closable without a new component or a changed interface → a lead-orchestrator
  fix brief, built and reviewed like any S1, recorded with "authorized by MANDATE.md";
- in-scope gap that needs a design change → stop and present the change if the user is present;
  otherwise an open item with the recommendation, status RECORDED;
- gap outside the task statement → reported under open items; never fixed on the way through;
- a clean audit → a result, recorded as such.

Gap-audit's rule against inventing gaps and its evidence states are unchanged; the Mandate is
not an invitation to find something.

## 8. Stage 9: Validate

**Invoke:** `four-dimension-audit` on the merged change (or the pull request head under `GO`),
with the original invocation from `RUN.md` as the request it grades against. The auditor must
not have authored the code: in an environment with sub-agents, a fresh reviewer; without them,
the lead grades from the diff and a clean run and says at the top of the scorecard that it graded
its own work, as that skill requires.

**Must leave:** the scorecard, unedited, in `REPORT.md` and `RUN.md`.

**Adaptation:** none. A low score is reported, not negotiated; the next run acts on it.

## 9. Writing a brief for a delegated stage

A delegated skill run by a sub-agent cannot see this conversation or this skill. Every brief
says, in this order: the skill to read and follow (by path); the working directory and branch
or commit; the inputs (task statement, `REQUIREMENTS.md`, brief paths, Mandate stop-list); the
artifact to leave and where; the word limit; and lead-orchestrator's status-words block
(Verified / Untested / Mistakes / Open risks). Use lead-orchestrator's `references/agent-briefs.md`
templates and add the stage-specific items above. The brief goes to `briefs/` before launch.

## 10. Fallbacks when a skill is missing

Say in `RUN.md` and the report which fallback was used. Each fallback is the skill's core rule
set, not its full text; the result is weaker, and the report says so.

| Missing skill         | Fallback                                                                                   |
|-----------------------|--------------------------------------------------------------------------------------------|
| lead-orchestrator     | Stop. Auto-build's ledger, briefs, review structure and research protocol are its; there is no acceptable inline substitute. Tell the user to install it. |
| brainstorming         | Classify the task (spike / bounded / architectural, heavier when in doubt); read the project before asking; propose two or three approaches with trade-offs and a recommendation that includes the case against it; label observed / inferred / assumed; present in the Mandate and build nothing before the reply. |
| break-test            | Run, in an isolated worktree, at least: clean-checkout install and build; the gate with the declared toolchain version; tests under `TZ=Pacific/Kiritimati` and a non-UTF-8 locale; tests in randomized order; the gate offline after a warm cache; a missing-env-var probe. Reproduce before reporting; control for probe defects; fixes as separate commits; report null results. Mark the stage "fallback" in the report. |
| gap-audit             | Read the delivered outputs against the task statement's purpose; list only gaps that point at a file, a flow or an observed behaviour; compare against two real equivalents per pass for at least two passes; label evidence states; state what is solid with evidence. Change nothing in this step. |
| four-dimension-audit  | Grade SPEC, DESIGN, CORRECTNESS, QUALITY 0–10 from the diff and a clean run, strictly against the invocation; name every addition nobody asked for; say the grade is self-assessed. |
| Research-Kit not deployed | No fallback for build-critical facts: Stage 1 stops with a kit finding and the install commands from the kit's README. Gap-audit's own fallback (environment fetch tools, claims capped at WELL-SUPPORTED) applies to its comparison claims only. |
