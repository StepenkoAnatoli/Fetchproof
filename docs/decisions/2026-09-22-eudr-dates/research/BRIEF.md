# Brief - EU Deforestation Regulation 2023/1115 application date large operators SMEs current after delay

_Auto-drafted 2026-09-29 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

A compliance question with a date answer, chosen deliberately from a domain this project
knows nothing about, to test whether the kit produces research a builder could act on
rather than research that merely passes its own checks.

"Done" is the operative application dates as of today, from the authority that sets them,
with the amending instrument named.

**A prior was registered before any collection, so the corpus could contradict it.** It did.
The prior said 30 December 2025 for large operators and 30 June 2026 for micro and small
enterprises, at high confidence, with an explicit note that a second postponement decided
after May 2026 could not be known. There was a second postponement.

## What we verified

| Claim | Source | Type |
|---|---|---|
| **The authority, stating the operative dates without qualification.** "The entry into application is: - Large and medium operators: **30 December 2026** - Micro and small operators: **30 June 2027** - Micro and small operators already covered by the EU Timber Regulation (EUTR): **30 December 2026**." The third line is the finding a summary loses: being small is not sufficient for the later date, and an operator already inside EUTR scope is on the earlier one. This is the European Commission on a regulation the European Commission administers. | E-01 `environment.ec.europa.eu` (U-1, U-3) | P |
| **Kept for the sequence it records, and cited with a warning about the rest of it.** Its infobox strikes through BOTH 30 December 2024 and 30 December 2025, which is what establishes two postponements rather than one. **Its body text is stale**: it still asserts "The regulation's obligations apply from 30 December 2025 for large operators and traders, and from 30 June 2026 for micro and small enterprises" - the exact dates this project's registered prior held, and they are superseded. One page, internally inconsistent, current in its structured data and wrong in its prose. A reader taking the paragraph would have been confidently a year out. | E-06 `en.wikipedia.org` (U-2) | S |

## Contradictions and how they were resolved

**The encyclopedia disagrees with itself (E-06).**
- Its infobox strikes through 30 December 2024 and 30 December 2025. That establishes two
  postponements.
- Its body text still says 30 December 2025 applies.

Trust the infobox for the sequence and the Commission (E-01) for the dates. The body text is
stale, and the brief quotes it only to warn against it.

**The prior was contradicted.** It predicted 30 December 2025 and 30 June 2026. The authority
says 30 December 2026 and 30 June 2027. Registering the prediction first is what made that
visible.

## Known unknowns

None. Every blocking unknown was closed with cited evidence. U-2 rests on no primary (P) source; the Type column above shows what carries it.

## Decision

**Written retroactively on 2026-09-29.** This corpus tested the kit on a domain it knows
nothing about. It is not a kit design decision.

**Operative dates, per the European Commission (E-01):**
- large and medium operators: **30 December 2026**;
- micro and small operators: **30 June 2027**;
- micro and small operators already covered by the EU Timber Regulation: **30 December
  2026**. Being small is not enough for the later date.

**Known gap:** U-2 (how many postponements, by what instrument) rests on secondary rows. The
owning source is the amending regulation on EUR-Lex, which was never collected. A builder
scheduling against these dates should fetch that instrument first.

**Out of scope:** any compliance plan. This corpus answers the dates only.

## Next steps

1. Read the Decision above; it records what was already decided, and when.
2. Hand this file to the builder (phase 2). Re-running `node /home/user/Fetchproof/fetchproof/bin/brief.mjs`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=fceef0226d380b6c inputs=30eb71c9950b59e9 gate=pass -->
