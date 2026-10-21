# Discovery Contract - Which skills from StepenkoAnatoli/SkillsMDs, plus a role-aware router, should Fetchproof ship for builders and collectors?

Started 2026-10-06. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Fetchproof ships a skill set beside `research-first`: the owner's skills from
StepenkoAnatoli/SkillsMDs (pinned at commit 3f2d2fc6627d63ea93ff97d4d33845a753db16cc),
a set of kit-authored phase skills, and a `skill-router` that sends an agent to a skill by
the machine's role and the project's gate state - never a builder to a skill that
collects. `install.mjs` deploys every skill to every skill root and, with `--into`, to the
project skill directory. Done means: every shipped skill is a valid skill directory (its
SKILL.md `name` equals its directory name, its description fits the limit), the installer
places each one where a runtime discovers it, the router's table is tested against the
collecting skills, and the vendored text keeps its licence. Phase 2 is this repository's
own build; this project only decides what to ship and why.

## Unknowns

A fact belongs here when guessing it wrong changes the design: API limits and pricing,
auth model, data schemas, rate limits, licensing/ToS, platform behavior, current library
versions, competitor pricing, data availability.

Status is exactly one of:
- `CLOSED` - proven by an `E-##` row in `research/EVIDENCE.md` (which must point at cached raw text).
- `KNOWN-UNKNOWN` - unreachable now; the `Evidence` cell names the day-one verification step.

Anything else (`OPEN`, blank, "in progress") fails the gate.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-01 | Under which licence are the SkillsMDs skills, and what must travel with a vendored copy? (D-4) | A licence that forbids redistribution ends vendoring; one that permits it decides the notice and REUSE annotation. | CLOSED | E-01 |
| U-02 | What makes a directory a valid skill: file name, `name` rules, description limit? (D-5, S-1) | Decides whether each SkillsMDs skill ships as received or needs renaming, and what the kit's own test checks. | CLOSED | E-02 |
| U-03 | How do runtimes discover skills under a skills root - one directory per skill, or nested? (D-8, S-1) | Decides the installer's layout: each skill as a sibling under the root, not inside `research-first`. | CLOSED | E-03 |
| U-04 | Do the SkillsMDs skills already forbid gate bypass and bind to Fetchproof? (D-4, S-2) | A skill that told an agent to skip the gate could not ship in the kit. | CLOSED | E-04, E-06, E-07 |
| U-05 | Which SkillsMDs skill is the "smart router", and does it route skills or models? (S-3) | Model routing named in kit code would break ADR-0012; skill routing is the kit's own router's job. | CLOSED | E-04, E-05, E-06 |
| U-06 | Which files does lead-orchestrator name, and are they present under those names? (D-5, S-1) | A skill pointing at a file that is not there sends the agent nowhere; vendoring must rename or say so. | CLOSED | E-04, E-05 |
| U-07 | What do the zipped `.skill` files (careful-coding, brainstorming, architecture-pass, improve-codebase-architecture, four-dimension-audit, gap-audit, subproject-discovery) say? (D-1, S-2) | Their conflict with the gate cannot be judged from a capture: a text transport cannot read a zip archive. | KNOWN-UNKNOWN | Attempted 2026-10-06: the keyless fetch of careful-coding.skill failed, the response being application/octet-stream (a zip archive), which a text transport refuses. Day one: unzip each archive at the pinned commit, check its SKILL.md frontmatter with the kit's skill-set test, and read it for `--no-verify`, gate-off files or hand-fetched evidence before it ships; the vendoring commit records the archive's sha256. |
| U-08 | Which SkillsMDs skills collect evidence themselves, so a builder must not be routed to them? (D-8, S-3) | The router's one hard rule - a builder never collects (ADR-0010) - needs the list. | CLOSED | E-07, E-08, E-06 |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

None asked: the owner named the source (SkillsMDs) and ordered the plan implemented.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- The owner ordered the skill set and the router built (2026-10-06); the freeze (ADR-0117)
  is lifted for that one item by its own ADR.
- The router routes skills by role and gate state, in text. Model choice stays in
  lead-orchestrator's rule, which names no model; the kit adds no router command, no model
  configuration and no plugin.
- The `.docx` files in SkillsMDs (Teacher / Guided-Build Mode, Writing-Plans) are not skill
  directories and are not shipped in this round.

