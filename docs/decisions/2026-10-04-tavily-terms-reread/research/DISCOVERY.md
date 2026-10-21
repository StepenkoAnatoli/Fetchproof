# Discovery Contract - Has Tavily's C-6 trigger been met: a no-training tier in Tavily's Platform Terms, privacy policy, FAQ or pricing, re-read 2026-10-04

Started 2026-10-04. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Nothing is built from this project. It answers one question for the operator, who asked on
2026-10-04 whether Tavily should join Firecrawl and SerpAPI as a fallback provider: has the
trigger that reopens constraint C-6 (`docs/requirements-2026-09-19-search-fetch-seam.md:55`,
"revisit if a no-training tier ships") been met since the last re-read on 2026-09-28? C-6
excluded Tavily because its Platform Terms §6.5 let Tavily and its AI providers retain Customer
Input "for purposes of training" and §6.7 says those providers may not be bound to
confidentiality; in this kit the query string is the research subject. Done means: the terms,
the privacy policy, the pricing page and the FAQ have been fetched today and read for a tier or
clause under which inputs are not trained on, the absence or presence is counted rather than
skimmed, and `research/BRIEF.md` records the decision. If the trigger is met, a separate ADR
lifts the freeze (ADR-0117) for one provider and the adapter is built from that brief; if not,
C-6 stands and no code changes.

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
| U-01 | Do Tavily's Platform Terms still reserve the right to train on Customer Input (§6.5) and release third-party providers from confidentiality (§6.7), and do they contain any no-training or zero-retention clause or tier? | C-6 rests on these two sections; only their change reopens Tavily. | CLOSED | E-01: no. §6.5 and §6.7 are unchanged word for word since 2026-09-28; no no-training or zero-retention clause, `enterprise` appears zero times. |
| U-02 | Does Tavily's privacy policy still say query data may be used to improve future responses and be shared with third-party search index providers, and has an opt-out of training appeared? | The 2026-09-22 narrowing said a vendor claim needs the vendor's documents, plural; the privacy policy is the second one. | CLOSED | E-02: no change. Query data may still be used to improve future responses and shared with third-party index providers; the only route is a GDPR objection, which is not an opt-out of training. |
| U-03 | Does Tavily's pricing page or FAQ now offer a tier (enterprise, zero data retention, no-training) under which inputs are not used for training? | A no-training tier is the written trigger; the pricing page was never read and is where a tier would be sold. | CLOSED | E-03, E-04, E-05: no tier. Pricing names four tiers and only Enterprise says "enterprise-grade security and privacy", which resolves to a sales form that says nothing; the FAQ's "zero data retention" bullet contradicts §6.5 and is recorded as a contradiction, not a tier. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

None. The operator approved this re-read on 2026-10-04 and the one intent question (a fallback
when Firecrawl runs out, not a specific Tavily feature) was answered by the request itself.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- C-6 (Tavily out of scope) stands unless its own trigger is met; this project re-checks the
  trigger, it does not re-argue the exclusion.
- The baseline is the three earlier readings: `2026-09-22-tavily-terms`,
  `2026-09-22-tavily-privacy`, `2026-09-28-fetch-fallback` (U-02 there). What they established
  is not re-researched here; only whether it changed.
- No adapter, flag or configuration key is written from this project (ADR-0117). If the trigger
  is met, that is a new ADR and a new task.
- Fetch and search fallbacks that exist already (`http-keyless`, `browser`, SerpAPI, SearXNG,
  ADR-0086, ADR-0129) are not in question here.
