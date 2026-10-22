# Changelog and Recorded Lessons

<!-- Modified by Fetchproof on 2026-10-22: received as lead-orchestrator 2.0 (the owner's claude.ai account copy, dated 2026-10-04), which replaces the StepenkoAnatoli/SkillsMDs 3f2d2fc baseline (ADR-0190); the kit's old name, Research-Kit, is Fetchproof here, as are the paths and variables that spelled it (ADR-0186), dated entries included. -->

Dated, from runs of this skill and from reviews of it. Each lesson entry names the rule it changed,
so a reader can tell whether a rule is a principle or a scar. The version is recorded in `RUN.md`
so a resumed run knows which rules it was started under.

## 2.0 - 2026-10-04 - durable runs, careful execution, pipelined review

Motivation, from the operator: a run that stops at a usage limit or a context reset had to be
done twice, because its state lived in the conversation; sub-agent output was less reliable than
the rules assumed; and the skill should be faster without lowering quality.

Changes:

- **Run ledger** (`references/run-ledger.md`, SKILL.md "The run ledger"). Every task has a run
  folder with `RUN.md`, `briefs/` and `reports/`. `RUN.md` is written at ten named checkpoints and
  always carries a one-line **Next action**. Phase R (orient and resume) is now the first phase of
  every start, with a verify-against-disk procedure and a downgrade-only reconciliation rule.
  Sub-agents are re-launched with a **resume clause**, never restarted. Builders commit at every
  green step so a stopped builder leaves a checkpoint.
- **Careful execution** (`references/careful-execution.md`, SKILL.md "Careful execution"). The
  `careful-coding` discipline, compressed into a block pasted into every builder and fix brief
  (sub-agents cannot see skills), a self-review checklist, the mistake-report shape, the
  Verified / Untested / Expect status words, and stop-and-check phrases for builders and for the
  lead. Every report now states its working directory and commit and ends with the status-words
  block. The lead spot-checks one further claim per report besides the key test.
- **Pre-mortem per unit** (Phase 2, work breakdown). Two lines per unit on how it most likely
  fails review, carried into the builder's acceptance and the unit reviewer's first focus.
- **Pipelined review** (Phase 4a, new unit reviewer brief). Each landed unit is reviewed while
  later waves build; integration review (4b) runs once on the integrated branch. Light level uses
  the unit reviewer alone.
- **Speed without loss** (new section). The accepted ways to go faster, and the list of what is
  never cut. Briefs are all written in Phase 2; the gate is scoped per unit and run in full at
  integration points; repetition applies only to tests that can flake; baselines, explorer reports
  and research projects are reused while unchanged; incomplete reports are returned at the first
  gap.
- **Failure modes and recovery** (new table). What survives and what the lead does for each of
  nine interruptions.
- Definition of Done adds the COMPLETE ledger and branch/worktree cleanup; final report adds the
  ledger path and whether the run was fresh or resumed; project facts add the run folder
  convention; the description names "continue", "resume" and "pick up where it stopped".
- Recorded lessons moved here from SKILL.md.

## Lessons

- **2026-10-04, Fetchproof PR #236 (merge `a4f6d9d`).** Four reviewers passed a new filesystem
  test that then failed on the Windows CI leg: it planted a symlink to `/etc/hostname` without the
  project's symlink guard and compared the link's stored text, which Windows resolves to a drive
  path. The same test also stayed green with the guard it named removed, because an earlier rule
  caught its input - the mutation auditor had mutated the diff, not the guard the test named.
  Rules changed: operating principle 5, the breaker and mutation auditor bullets in Phase 4, the
  CI-legs bullet in Phase 6, builder report acceptance, the engineering standards for builders, S1
  in the triage table, and the Definition of Done; in the references, the builder, fix, breaker
  and mutation auditor briefs, the project facts environments, and the report templates.

## 1.0 - before 2026-10-04

Initial version: phases 0-6, model selection, engagement levels, roles, Fetchproof integration,
report acceptance, builder standards, finding triage, Definition of Done.
