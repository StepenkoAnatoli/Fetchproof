# Brief - How should portable artifact authorization be derived without consumer policy and while preserving historical brief stamps?

_Auto-drafted 2026-10-13 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require the reviewing agent's judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

## Intent

Fix issue #357 by re-deriving claimed artifact approval from its materialized corpus using
the producer's review rules and an unpromoted portable gate baseline. Consumer machine
policy, hooks and credentials must not affect the result. Preserve a declared false
authorization and settle compatibility for unstamped, pre-ADR-0069 and current briefs
against historical source profiles before implementation. This project records the
compatibility decision and its source/fixture evidence; it does not collect vendor data.

## What we verified

| Claim | Source | Type |
|---|---|---|
| runPreflight uses an explicitly supplied context instead of verdictContext; runChecks findings are promoted only for CLI strict or machine evidencePolicy strict. A supplied pluralist context with no local hook path evaluates the portable unpromoted baseline without calling the machine context reader. | E-01 `raw.githubusercontent.com` (U-1) | P |
| The shared registry runs each named check over the supplied corpus and options. Unknown closure uses options.maxAgeDays or the fixed 180-day default; the portable context can retain this shared default rather than a consumer customization. | E-02 `raw.githubusercontent.com` (U-1) | P |
| The machine defaults also use maxAgeDays 180, while loadConfig reads the configured machine file and evidencePolicy can promote warnings. Portable validation must avoid those consumer reads, not merely pass an empty environment. | E-03 `raw.githubusercontent.com` (U-1) | P |
| At the pre-0069 commit, briefInputsHash hashes topic, intent, unknown ID/text/status/evidence and evidence ID/date/type/URL/finding/raw fields. The emitted draft marker has body and inputs hashes with no gate field. | E-04 `raw.githubusercontent.com` (U-2) | P |
| The current input hash adds map ID/status/coverage rows and ledger/capture counts. Current markers can include gate=pass, fail or unknown; draftStamp returns unknown both for an absent gate field and for an explicit unknown value, so those profiles must be distinguished from the literal marker. | E-05 `raw.githubusercontent.com` (U-2) | P |
| ADR-0069 expands the hash within the existing format era and adds the gate field; it explicitly retains parsing of old markers without gate, represented as unknown. Thus current-hash mismatch alone cannot establish staleness for that historical profile. | E-06 `raw.githubusercontent.com` (U-2) | P |
| The actual historical artifact writer emits formatVersion 1.0.0 and derives approval from gate, map, brief and findings review. The isolated profile probe generated approved unstamped and pre-0069 packages with this exact writer, using explicitly synthetic passing corpora. | E-07 `raw.githubusercontent.com` (U-3) | P |
| The current validator supports format majors 1 and 2, separates PASS from buildAuthorized and returns authorization only when the incoming claim is true and status is PASS. Re-derivation must preserve a declared false claim instead of upgrading it. | E-08 `raw.githubusercontent.com` (U-3) | P |
| The historical brief regression uses the actual renderer to distinguish an unedited draft from an edited authored brief. The retained profile probe likewise obtains the early marker from that real renderer rather than inventing its syntax or hash. | E-09 `raw.githubusercontent.com` (U-3) | P |

## Contradictions and how they were resolved

The historical writer and current reader both accept the early format-1.0 approved fixture, while current producer derivation rejects its old input hash. This is a profile change, not evidence that its covered inputs changed: the actual historical writer emitted a hash covering fewer fields. The current marker can explicitly say gate=unknown, so parsed gate=unknown alone does not identify the old profile. Check the literal absence of that field and verify the historical hash only for format major 1. The profile probe uses disclosed synthetic corpora and actual pinned writers; it does not claim an archived user's corpus. Source authority is the pinned code, supported by the retained probe results.

## Known unknowns

None. No unknown is declared KNOWN-UNKNOWN.

## Decision

Extract the shared approval derivation to a module usable by producer and validator without an import cycle. The validator re-derives only an incoming true approval from the materialized corpus with a supplied unpromoted pluralist context, no consumer policy or hooks, and the shared 180-day freshness default. A false claim remains false. Preserve current matching stamps and authored unstamped briefs. For a format-1 marker without a gate field, accept currency only when its historical input hash matches the covered inputs, with an explicit compatibility warning; apply current gate and review checks to its actual corpus. Reject mismatched legacy covered inputs and all inconsistent claimed approvals. Use captureOf for blank Raw cells and count unresolved rows as not reviewed. Record this compatibility choice in ADR-0160 and test the actual-writer profile cases before publishing.

## Next steps

1. Record ADR-0160 and the research index entry, retaining the nine source captures, ledger, profile records and collection trace.
2. Add red-first forged-approval regressions and shared portable derivation with literal-profile checks; preserve the producer API and declared false package result.
3. Run focused validator/producer/CLI tests, the required full commit gate and the supported CI matrix. Open a separate fix PR without merging.

<!-- fetchproof:brief-draft body=c8367a8dbc327ac8 inputs=50bf283cc764893e gate=pass -->
