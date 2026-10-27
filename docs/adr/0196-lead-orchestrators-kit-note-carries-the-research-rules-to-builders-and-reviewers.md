# ADR-0196 - lead-orchestrator's kit note carries the research rules to builders and reviewers

- **Date:** 2026-10-25
- **Status:** accepted
- **Area:** `fetchproof/skills/lead-orchestrator/references/fetchproof.md` (new section 5,
  "Briefs and reviewers in a Fetchproof project"), `fetchproof/skills/skill-router/SKILL.md`
  (Step 3's opening paragraph and its `lead-orchestrator` row), `fetchproof/test/skill-set.test.mjs`
- **Prompted by:** the quote-level refresh plan (v0.4, §10 and §13's first bullet), from the
  review of 2026-10-25 that found lead-orchestrator's research-to-code link the weakest in the
  kit; the design was approved by the owner on 2026-10-25
- **Freeze (ADR-0117):** inside the item ADR-0146 lifted ("the kit ships a skill set plus a
  role-aware router skill"). A new role could be read as a feature, and AGENTS.md says "When a
  change could be read either way, it is a feature"; what settles it is the owner's approval of
  plan v0.4 on 2026-10-25, whose §15 marks this item (row 1c, the kit-note fix) "free" of the
  hold and whose §3 classes it as skill text inside ADR-0146's lifted item, not held by
  ADR-0157. This changes the text of two kit-authored skill files and adds pin tests. No
  command, flag, format, check, configuration key or line of the kit's code changes, and no
  received text is edited (ADR-0146, ADR-0190).

## Context

lead-orchestrator separates building from reviewing. Its principle 4 is "No agent reviews its
own work" (`SKILL.md:45-46`), and its phases 4a and 4b run a unit reviewer, a spec reviewer, a
breaker and two auditors (the role table, `SKILL.md:134-143`). Two gaps sat between that
skill and the kit's rules.

**The research phase is the one place principle 4 does not reach.** One researcher collects,
rewrites its own Findings (`finding-rewriter`), grades its own sources (`source-grader`), writes
the brief and declares `Reviewed by: agent` (ADR-0074, ADR-0107). Code gets an independent
second look; research does not. The gate cannot fill the gap: whether a quote supports its
claim needs a judge, which ADR-0089 names and leaves uncomputed, and ADR-0087's gate checks only
that a quoted passage occurs in its capture. A quote can occur, word for word, and still not
say what the claim says: a paid tier's limit stated as the free tier's, a qualifier cut by an
ellipsis or sitting one sentence away, a number in the claim that the quote does not carry.

**The research-to-code rules never reached a parallel builder.** A sub-agent has no access to
the lead's conversation (`SKILL.md:84`). The received builder brief carries "the claims and
evidence rows this unit implements: <E-nn list>" (`references/agent-briefs.md:111-113`), but
only says "implement ... from the brief's claims" (`:134`); Phase 2's task statement names
"which brief" a decision rests on, not which row (`SKILL.md:217-218`). The kit's `cite-in-code`
and `contract-tests` rules are separate router rows, so a builder briefed by lead-orchestrator
alone never saw them. auto-build enforces them in its own Stage 5
(`auto-build/references/fetchproof.md`); lead-orchestrator run on its own did not. The kit note
had pointed readers at the router (its section 2) and no further.

The same review asked whether lead-orchestrator belongs in the kit at all. auto-build cannot
run without it (`auto-build/references/stage-handoffs.md:207`: "Stop. ... there is no acceptable
inline substitute"), and no other shipped skill does its job, so it stays; but the default
builder path is `build-from-brief` with `day-one-tasks`, `cite-in-code` and `contract-tests`,
and the router did not say so.

## Decision

1. **Builder briefs carry the rules.** In a Fetchproof project, Phase 2's task statement names
   the `E-##` rows each externally sourced decision rests on, and every builder brief pastes the
   unit's `E-##` rows (claim, quote and source), the `cite-in-code` rule (an `E-##` comment on
   the definition of each research-derived constant, naming its `EVIDENCE.md` path when the
   project is not the repository root, since Phase 1b's projects repeat row IDs) and the
   `contract-tests` rule (one red-first test per claim, named `E-##: ...`, fixtures from the
   quote).
2. **A research reviewer, as a role in the kit note.** A fresh-context sub-agent, read-only on
   `research/`, that never sees the researcher's conversation, runs where the corpus was
   collected: after preflight PASS, at Phase 1b's exit, before Phase 2 relies on the brief. The
   researcher has written the brief by then (the received researcher template passes preflight,
   writes the brief and commits in one run), and the first draft's "before handoff" read as
   both phase 1's hand-off and `handoff.mjs`. For each evidence row that closes an unknown it
   checks five things: the quote supports the claim as written; scope, tier, region and
   version; qualifiers clipped by an ellipsis or just outside the quote; every number in the
   claim appears in the quote; the source owns the fact. Findings go into the run's `RUN.md` and
   back to the researcher, who changes the claim, adds evidence or marks the unknown
   KNOWN-UNKNOWN. The reviewer never edits `research/`.
3. **No gate token and no approval condition.** The reviewer writes nothing the gate reads.
   Preflight, `brief.mjs --state` and handoff behave exactly as before; ADR-0087's string-only
   gate and ADR-0074's "a declaration is not a condition" stand, and the reviewer is an agent
   (ADR-0107).
4. **The spec reviewer (Phase 4b) gets a research-conformance duty.** Every research-derived
   constant or behaviour in the diff traces to an `E-##` row whose quote supports it; the
   `cite-in-code` comment, with its `EVIDENCE.md` path outside the root, is the trace. A
   missing or unsupported trace is a finding.
5. **The router names the default build path** - `build-from-brief` with `day-one-tasks`,
   `cite-in-code` and `contract-tests` - and marks lead-orchestrator optional, for independent
   units that need parallel agents. It stays shipped, because auto-build runs through it.
6. **Pin tests** in `test/skill-set.test.mjs` hold each of these to the note's and the router's
   text: the note's section 5 items (Phase 2, Builder brief, Research reviewer, Spec reviewer),
   and the router's Step 3 paragraph and row. Because a pin only proves words are present, the
   reviewer item is also held to the absence of sign-off, "until the reviewer" and approval
   wording.

## Rejected alternatives

- **The gate-token variant** (Grok's proposal: a second process writes SUPPORTS /
  DOES_NOT_SUPPORT / UNCLEAR / OPEN per row, and the gate checks only that a token is present),
  and any form in which a review declaration becomes an approval condition:
  - ADR-0089 names factual support as something the kit does not compute, because it needs a
    judge;
  - ADR-0074 rejected making a review declaration an approval condition: "a fifth step that
    proves nothing";
  - ADR-0107 (the operator's decision, 2026-09-30) made the review the agent's alone;
  - a presence-checked token is the same unverifiable declaration in a new place, and it would
    add a format and a check under the freeze (ADR-0117).
- **Editing the received lead-orchestrator text** (the role table, the builder template, Phase
  2). ADR-0146 ships received text as written and ADR-0190 keeps the kit's rules in the kit
  note; an edited received file would also have to be re-marked under Apache-2.0 4(b) and would
  drift from its recorded receipt.
- **Restating the protocol in the note** (lead-orchestrator 2.0's own integration reference).
  ADR-0190 rejected shipping it because a restated protocol drifts from the kit's rules. Section
  5 adds only what a sub-agent cannot otherwise see, and points at the skills by name.
- **Removing lead-orchestrator, or making the reviewer a new skill.** Removing it breaks
  auto-build, whose fallback is "Stop". A new skill directory is growth of ADR-0146's item that
  ADR-0157's hold says must wait for the ADR-0145 comparison; a role in an existing note is text
  inside that item, which the approved plan's §15 marks "free" (the Freeze bullet above).
- **Extending the reviewer to single-agent `research-first` runs now.** That is a router or
  skill change under ADR-0146, and it waits for the measurement below.

## Consequences

- A parallel builder in a Fetchproof project receives the research-to-code rules in its brief,
  and the spec reviewer checks the traces they leave.
- Research gets an independent reader at Phase 1b's exit, before Phase 2 relies on the brief,
  at a cost in tokens there only, not on every preflight.
- Limits: the reviewer runs only when lead-orchestrator or auto-build drives research; a
  single-agent `research-first` run does not get it. An agent reviewer may share the
  researcher's blind spots (it may be the same model); that is measured, not assumed.
- Nothing the gate, the handoff or a package reports changes. `Reviewed by: agent` stays the
  researcher's declaration.

## Trigger to revisit

- **Measured promotion, into the default route and never into the gate.** The reviewer is run,
  fresh context and blinded to labels, over the misleading-quote suite's expected-miss cases
  and an equal number of non-misleading controls, in at least two independent runs. If expected
  misses are at least 25% of the labelled cases, and the reviewer catches at least 50% of them
  with at most 10% false flags on the controls, in every run, then `skill-router` routes every
  collector handoff through it by default (an ADR records the numbers). If not, it stays an
  optional lead-orchestrator role, and the numbers are recorded here. Whatever the numbers, it
  never becomes a gate rule.
- The ADR-0145 comparison reports: lead-orchestrator, with auto-build, is kept, simplified or
  dropped there (ADR-0146's trigger), and this note goes with it.
- An agent acts on a disagreement between this note and the received skill's text.
