# MAP - topic decomposition

## Topic

Which skills from StepenkoAnatoli/SkillsMDs, plus a role-aware router, should Fetchproof ship for builders and collectors?

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-07 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | No account, key or login: every source is a public file on raw.githubusercontent.com, and the shipped skills hold no credential. |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | DISMISSED | Eight named pages, no search; nothing in the design runs on a cadence a quota could cap. |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | COVERED | U-01, U-04 |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | COVERED | U-02, U-06 |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | DISMISSED | The sources are pinned to one commit; a later SkillsMDs change is a new vendoring decision, not staleness of this one. |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | DISMISSED | No paid service: keyless collection, and skills are text files deployed by copy. |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | COVERED | U-03, U-08 |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | COVERED | U-02, U-03 |
| S-1 | Skill format and discovery | The installer's layout and the kit's skill test both follow from it | COVERED | U-02, U-03, U-06 |
| S-2 | Gate compatibility of each SkillsMDs skill | A skill that bypasses a gate cannot ship in the kit | COVERED | U-04, U-07 |
| S-3 | Routing: which skill routes models, which routes skills, which ones collect | Decides what the kit's router owns and what it forbids a builder | COVERED | U-05, U-08 |

## Coverage notes (per dimension)

- D-1: public raw files; the seven zipped `.skill` archives cannot be captured as text, so U-07 is a known unknown with its day-one check.
- D-4: Apache-2.0 (E-01); the captured text-form skills forbid `--no-verify` (E-04, E-06).
- D-5 / S-1: SKILL.md at the directory root, `name` equal to the directory (E-02); lead-orchestrator's file and its brief-template reference need renaming (E-04, E-05).
- D-8 / S-3: discovery scans subdirectories of a skills root (E-03); break-test collects keylessly (E-07, E-08), so a builder is not routed to its research step.
- D-9: the output is the kit's own skill tree; obtainable once U-02 and U-03 fix its shape.

## Candidate material

Gathered 2026-10-06.

_No material gathered - run without `--dry-run`, or add URLs to `research/plan.json`._

