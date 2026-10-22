# ADR-0190 - The kit vendors lead-orchestrator 2.0, and break-test's parallel-shell lesson

- **Date:** 2026-10-22
- **Status:** accepted
- **Area:** `fetchproof/skills/lead-orchestrator/` (`SKILL.md` and its references),
  `fetchproof/skills/break-test/SKILL.md` and `references/probe-recipes.md`, one pointer in
  `fetchproof/skills/auto-build/SKILL.md`; `REUSE.toml`, `NOTICE`
- **Order:** the owner, 2026-10-22, who started this follow-up from the review of the claude.ai
  account's skills after the rename: bring the account's lead-orchestrator 2.0 and break-test's
  extra lesson into the kit's vendored skills
- **Amends:** [ADR-0146](0146-the-kit-ships-a-skill-set-and-a-role-aware-router.md), decision 3,
  for two of its ten received skills. lead-orchestrator's received baseline is now the account's
  2.0, recorded below by hash, and no longer SkillsMDs at `3f2d2fc`. The kit note's "two
  references it names are not in the source" no longer holds. auto-build's adaptation "the
  missing `references/run-ledger.md` is replaced by lead-orchestrator's `SKILL.md`" is
  withdrawn. The other eight skills, and the rest of ADR-0146, stand.
- **Freeze (ADR-0117):** inside the item ADR-0146 lifted (the skill set). This changes skill text,
  licence records and documentation only. No command, flag, format, check, configuration key or
  line of the kit's code changes.

## Context

ADR-0146 vendored lead-orchestrator from `StepenkoAnatoli/SkillsMDs` at `3f2d2fc`. There the
skill is the file `leadorchastratorv2.md`, but the "v2" is only part of the file's name. Its text
is the skill's 1.x: two files, 569 lines as received, with no run ledger. The owner's claude.ai
account held **version 2.0** (updated 2026-10-04 12:49Z): eight files, 1579 lines. SkillsMDs never
received it. What 2.0 adds:

- **The run ledger.** An on-disk `RUN.md` plus Phase R (orient and resume), so a run that stops
  is resumed from its last checkpoint, not repeated.
- **Careful execution** for builders, fixers and the lead.
- **A pre-mortem per unit.**
- **Pipelined review**, with a unit reviewer.
- **A failure-recovery table.**
- **Five new references:** `run-ledger.md`, `careful-execution.md`, `changelog.md` (the recorded
  lessons moved there), `project-facts-template.md` and `report-templates.md`.

The kit's vendored auto-build was written against 2.0. It names things 1.x does not have:

- `SKILL.md` stage 0 runs "lead-orchestrator Phase R and Phase 0";
- it keeps its stage table in lead-orchestrator's `RUN.md`;
- `references/stage-handoffs.md` asks for lead-orchestrator's status-words block;
- `references/merge-protocol.md` writes the pull request body from lead-orchestrator's
  `references/report-templates.md`.

The kit's 1.x has none of these: no Phase R, no `RUN.md`, no status-words block, no
`report-templates.md` and no `run-ledger.md`. ADR-0146 pointed auto-build's ledger reference at
lead-orchestrator's `SKILL.md`, but 1.x's `SKILL.md` describes no ledger. So an agent running the
kit's auto-build followed references that led nowhere. The kit note beside lead-orchestrator
recorded half of this gap in its "Not shipped" section.

The owner's account copy of break-test (updated 2026-10-03 23:43Z) is SkillsMDs' text plus one
sentence and one table row. They hold a lesson from a run: shell calls issued in parallel share
one working directory. In that run, three edits issued at once wrote nothing, because another
call had changed the directory first.

Both account copies were backed up on 2026-10-22, before the owner re-uploads or deletes them in
claude.ai.

## Decision

1. **lead-orchestrator 2.0 replaces 1.x.** The kit ships its `SKILL.md` and the references
   `agent-briefs.md`, `careful-execution.md`, `changelog.md`, `project-facts-template.md`,
   `report-templates.md` and `run-ledger.md`.
   - **The rename.** The text is the account copy with ADR-0186's spelling map applied, the same
     rename the kit gave 1.x. Nothing else is changed. The dated changelog entries are renamed
     too, as ADR-0186 renames dated records: "Fetchproof PR #236 (merge `a4f6d9d`)" and "Fetchproof
     integration".
   - **Markers.** Four files carry an Apache-2.0 section 4(b) notice at the top: `SKILL.md`,
     `agent-briefs.md`, `changelog.md` and `project-facts-template.md`. The other three are
     byte-identical to the account copy and carry none.
   - **Nothing of the kit's lost.** The only text the kit had adapted in 1.x was the rename, and
     2.0 carries it. 1.x's other lines are the author's earlier wording of the same rules. Its one
     recorded lesson (PR #236) is in `references/changelog.md`.
2. **The kit's own `references/fetchproof.md` stays and governs.** 2.0's own integration
   reference (received as `references/research-kit.md`, 180 lines) is not shipped.
   - **Header.** The kit note now says why it is not shipped.
   - **Section 4.** It now says the two templates ship. In a Fetchproof project, the project's own
     conventions come first: `AGENTS.md`'s "Orchestrator facts", the five-part report and
     `commit-report`. 2.0's `SKILL.md` allows this ("unless the project defines its own
     conventions").
   - **2.0's pointers still resolve.** 2.0's `SKILL.md` names the note's "Readiness" section, and
     its researcher brief names the note's section 3. Those are the kit note's §1 and §3.
3. **auto-build's ledger pointer goes back to the received meaning.** It now names
   lead-orchestrator's `references/run-ledger.md` for `RUN.md`. The other half of the same
   sentence is unchanged: lead-orchestrator's `references/fetchproof.md` remains the authority for
   the kit protocol. Its `merge-protocol.md` pointer to `references/report-templates.md` now
   resolves without an edit.
4. **break-test takes the lesson where the account copy has it.** The sentence ends section 0
   item 4 of `SKILL.md`. The row in `references/probe-recipes.md`, "What the first run taught",
   goes just before "Fix step 6". Apart from the rename, the rest of the account copy is the
   kit's text. Both files' notices name this change.
5. **Licence records.**
   - `REUSE.toml` moves lead-orchestrator out of the SkillsMDs annotation into an Apache-2.0
     annotation of its own, which lists its seven received files and leaves out the kit's note.
   - `NOTICE` says where lead-orchestrator 2.0 and the break-test lesson came from.
   - The account copies have the same author as SkillsMDs and carry no licence file of their own.
     They are the author's later text of the same Apache-2.0 skills, and ship under Apache-2.0
     like the rest of the set. The owner's approval of this change confirms that.

**Provenance.** sha256 of the account copies as backed up on 2026-10-22 (claude.ai skill IDs
`skill_01BoUMCzWwfgXGFG4zYhmgwr`, lead-orchestrator, and `skill_019gNGwCYbHebxa3PBzFSeE4`,
break-test):

- lead-orchestrator `SKILL.md` `22882116f35d6a3ec8334ff58adcf11d837ce63011afe6ff132c8a69a39fac96`
- `references/agent-briefs.md` `d923b73f6556f9f7b4ea4464a2b555093032bbfbf3f6f9bbe1a6837bb668ef61`
- `references/careful-execution.md` `94884225b2a35a6b8d32ce46b8416d1fa6b6b3a219602cb98251cdfd6caab987`
- `references/changelog.md` `ab8c4ba645599547eb1047cd991d89208b53bfd5ae0efa330122e1c291932556`
- `references/project-facts-template.md` `67926d63fcf40fb77d58efb45832088a84e3194ce9c1476606c0144f7633dcc6`
- `references/report-templates.md` `46e7f1bc6cfc475ba32e8e2f25e4070d3d36192b7ed331cece47ff4cd8a6c609`
- `references/run-ledger.md` `888ddb387ae030294d92299740d2ccfeb4474acd386a5b80691c45bf8ae0d59f`
- `references/research-kit.md` (not shipped) `f55a781f1570f97a8451838a3d1ea7aee0823f4fa4bec4b8bfb544f47ae01cc9`
- break-test `SKILL.md` `bf961976b3b4956516824b2f30a4fb030119420028399fc77ff5f4264892a39c`
- break-test `references/probe-recipes.md` `e9203e6fdcf72a37da8a0d6b02bdd9a0d7766375c98893062c93c02042ee8f92`

## Rejected alternatives

- **Ship 2.0's integration reference as `references/fetchproof.md`, replacing the kit note.**
  - **It has drifted.** It restates the kit's protocol, and the kit has moved on since it was
    written. Its step 9 is `brief.mjs` alone, but a brief is approved only when it is authored,
    with both judged sections answered (ADR-0138, ADR-0150). Its role table says a collector
    "holds the key", but a chosen keyless collector needs none (ADR-0095).
  - **It leaves rules out.** It has no complete-review condition and no Git corpus ownership for
    builder requests (ADR-0150).
  - **It reopens a fixed contradiction.** Shipped text would again disagree with the note that
    governs it, which is the contradiction ADR-0146 fixed in auto-build.
  - **Not lost.** Its content stays in the owner's backup.
- **Ship it beside the kit note, under another name** (for example
  `references/fetchproof-integration.md`). That would be two texts on one protocol, one of them
  stale. Nothing names the second file, so an agent would read it only by accident.
- **Keep 1.x, and fit auto-build to it.** auto-build's Phase R, `RUN.md`, status-words and
  `report-templates.md` pointers would still lead nowhere, or the received auto-build would need a
  larger rewrite than taking the version it was written for. 1.x is also older than the copy the
  owner's runs use.
- **Rewrite 2.0 in the kit's vocabulary**, for example by merging its report templates into
  `commit-report`. ADR-0146 rejected an unrestricted rewrite of received text. The kit note
  carries the kit's rules instead.
- **Leave auto-build's pointer at lead-orchestrator's `SKILL.md`.** 2.0's `SKILL.md` outlines
  `RUN.md`, but the schema, the checkpoint rules and the resume procedure are in
  `references/run-ledger.md`. That is the file the received text named. Once it ships, the
  adaptation has no reason left.
- **Wait for SkillsMDs to receive 2.0, then vendor it from a commit.** Nothing is scheduled to
  update SkillsMDs. The account copy is the owner's current text, backed up and recorded here by
  hash.

## Consequences

- **Machines that installed the kit.** `install.mjs` replaces 1.x with 2.0 wherever the deployed
  `SKILL.md` is the one the kit last wrote there (`skillSetHashes` in the install state). The
  deploy mirrors the set skill, so the five new references arrive with it. The same holds for
  break-test's and auto-build's changed `SKILL.md`.
  - **A user's own copy is kept.** Where the deployed `SKILL.md` is anything else, the folder is
    left as it is and listed in `skillConflicts`, as before. That covers a 2.0 copied there by
    hand, or another project's vendored copy.
  - **No migration step.** Until `install.mjs` runs again, the deployed copies stay as they were.
  - **The operator's PC.** All three recorded hashes equal the deployed files, and no project is
    bound, so the next `install.mjs` replaces them cleanly.
- **ADR-0146's receipt record is history now.** Its receipt hashes and its SkillsMDs baseline
  stay as historical evidence. For lead-orchestrator the current baseline is the one recorded
  here.
- **Section names other skills use still resolve in 2.0.** skill-router and the brief preamble
  name lead-orchestrator's model rule, and auto-build names its engagement table, its research
  trigger, "Not verified here", its fix brief and "Orchestrator facts". 2.0 still has every one
  of them.

## Trigger to revisit

- SkillsMDs publishes lead-orchestrator 2.0 or later: vendor from that commit and record it.
- The owner's account copy, or MoonAliza's, moves past 2.0.
- An agent acts on a disagreement between the kit note and 2.0's text, as one could with
  auto-build before ADR-0146 fixed it.
- The owner prefers to ship 2.0's own integration reference. Its content is in the 2026-10-22
  backup.
