# ADR-0195 — Measure reports how many closed unknowns rest on a checked quote

- **Date:** 2026-10-25
- **Status:** accepted; amends ADR-0089 (one more line in a report that never gates)
- **Area:** `fetchproof/lib/measure.mjs` (`measureCorpus`'s new `quoteCoverage`,
  `renderMeasure`'s new line), `fetchproof/bin/measure.mjs` (its help text). No check, finding,
  verdict, flag or exit code changes; `--json` gains one field and renames none.
- **Prompted by:** the reasoning-layer plan v0.4 (owner-approved), sections 2 ("Quote coverage
  is not reported") and 9, item R-15.
- **Lifts the hold (ADR-0157) and the freeze (ADR-0117)** for this one item, by the owner's
  ruling of 2026-10-25: "spend credit but in a new chat for 192/195", read as the range
  0192-0195. Unrelated work stays held.

## Context

`measure.mjs` (ADR-0089) reports quote-anchored rows and the share of their quotes found. It
does not say how much of the *closure* a reader can check: a corpus can carry many quotes on
rows no CLOSED unknown cites, or close every unknown on rows without one. The second figure is
the one the quote-level refresh (ADR-0193) depends on, because a refresh can only be rechecked
quote by quote where a closure has a quote to recheck. The dossier behind the plan (section
11) put it at 108 of 183 closed unknowns across the 41 corpora - 75, about 41%, with no quote
that can be checked - and the plan published that figure without re-counting it.

Why this item could not wait for the ADR-0145 comparison: it is the denominator of the
recheck's value. The plan's section 12 study and ADR-0193's rollout (section 7.6) both ask how
many closures a quote-level recheck can reach; without the line, that number is a figure in a
dossier nobody can reproduce, and each corpus collected while the comparison waits adds
closures nobody counted. The line changes no verdict, so it cannot move what the comparison
measures.

Testimonium (github.com/noahogbi/testimonium, MIT) makes the related point that a gate which
passes when nothing was checked is its top risk (its `--allow-unclaimed`); this record borrows
that reasoning for a report, not its behaviour. No code or fixture of it is copied.

## Decision

1. **One line, one field.** `measureCorpus` returns `quoteCoverage: { count, of, percent }`,
   the shape `quotesFound` already has, and `renderMeasure` prints, after the closed-unknowns
   line:
   `quote coverage         N / M CLOSED unknowns cite at least one row with a usable quote (not too short, ADR-0191) found in its capture - a coverage metric, not truth`.
   It is a report line in the house format (lower-case label, column 23) rather than the
   plan's `Quote coverage:` spelling, which no other line of the report uses.
2. **M is every CLOSED unknown**, read by `readCorpus` as the gate reads it - the same set as
   the report's `closed unknowns` line. OPEN, KNOWN-UNKNOWN and any other status are not in M.
3. **N counts an unknown once** when ANY row it cites (`citedIds` of its Evidence cell, review
   notes stripped, looked up by ID as `unknown-closure` does) holds a quote that is:
   - **usable:** `quoteTooShort(anchor)` is false - ADR-0191's predicate itself, measured on
     the compared text, never a second floor;
   - **found in its capture:** `anchorFound(anchor.fragments, parseCapture(...).body)` over the
     capture `captureOf` resolves - exactly the `citations` check's resolution and order.
   An unknown citing two quoted rows, or one row twice, is one closure. An unreadable marker
   (#319) is not a usable quote.
4. **Capture resolution: `captureOf`, with its `byUrl` fallback for a blank Raw cell.** That is
   what the `citations` check uses to decide `quote-not-found`, and what `measure.mjs` already
   used for `quotes found`. A row the gate accepts as a checked quote therefore counts, and one
   the gate warns or fails on does not. The fallback is a known weakness for a *refresh*
   recheck (the old capture vouches for itself, plan section 2), but here it describes the
   corpus as the gate judges it today; if the gate's resolution changes, this line follows it,
   because it calls the same function.
5. **It never gates.** No check reads it, no exit code depends on it. A corpus with no
   `DISCOVERY.md` prints `0 / 0` (percent `null` in `--json`); a corpus with closures and no
   quotes prints `0 / M`, which is the honest figure; `measure` exits 0 in both, as before.

## Rejected alternatives

- **Count rows, or quotes, instead of unknowns.** The report already has rows and quotes. The
  question is how much of the closure is checkable, and a row cited by two unknowns, or two
  rows behind one unknown, would bend a row count either way.
- **Count any quote marker, found or not, short or not** (the looser reading of "checkable").
  A quote the gate fails or only warns on is not one a reader can rely on; the line must agree
  with the gate. On today's corpora the two counts agree (below), so the strict reading costs
  nothing now and will not drift later.
- **Re-implement the short floor or the matcher here.** ADR-0191 exists because two measures
  of "short" drifted apart; a third would repeat it.
- **Resolve captures from the Raw cell only.** Stricter than the gate, so the line would call a
  closure unchecked that the gate checked. Rejected for agreement with the gate (decision 4).
- **Exclude corpora without a contract, or print nothing for them.** A missing line is
  ambiguous between "no closures" and "not computed"; `0 / 0` says which.
- **Gate on it, or ratchet new closures** (dossier section 11 "later"). ADR-0089 rejected a
  gating threshold for this report; an opt-in ratchet is a new rule and is not in this plan.

## Consequences

The re-count at the base of this change (`3282cf3` with ADR-0191 applied), over every corpus
`git ls-files '*research/EVIDENCE.md'` lists except `fetchproof/template` (the scaffold, not a
corpus), with this code:

| Corpus | N / M |
|---|---|
| `research/` (root) | 0 / 11 |
| 2026-09-21-agent-interface | 0 / 8 |
| 2026-09-21-delivery-architecture | 0 / 8 |
| 2026-09-21-public-run-visibility | 0 / 4 |
| 2026-09-21-sea-assets | 0 / 2 |
| 2026-09-22-build-sea | 0 / 1 |
| 2026-09-22-eudr-dates | 0 / 3 |
| 2026-09-22-tavily-privacy | 0 / 2 |
| 2026-09-22-tavily-terms | 0 / 2 |
| 2026-09-22-wx-lock | 0 / 2 |
| 2026-09-26-actions-node24 | 0 / 4 |
| 2026-09-26-actions-sept-changes | 0 / 4 |
| 2026-09-27-kit-path-spelling | 0 / 4 |
| 2026-09-27-mcp-protocol-versions | 0 / 5 |
| 2026-09-27-node-support | 0 / 3 |
| 2026-09-28-browser-transport | 2 / 2 |
| 2026-09-28-collection-cost-model | 0 / 5 |
| 2026-09-28-fetch-fallback | 0 / 4 |
| 2026-09-28-kit-measurement | 2 / 2 |
| 2026-09-28-quote-anchors | 3 / 3 |
| 2026-09-28-warc-export | 3 / 3 |
| 2026-09-29-chromium-sandbox-userns | 3 / 3 |
| 2026-09-29-perspective-discovery | 3 / 3 |
| 2026-09-30-searxng-search | 4 / 4 |
| 2026-09-30-wayback-witness | 2 / 2 |
| 2026-10-02-firecrawl-cli-1-25 | 6 / 6 |
| 2026-10-02-github-plain-fetch-refusal | 5 / 5 |
| 2026-10-02-licence-and-captured-pages | 7 / 7 |
| 2026-10-02-similar-tools-survey | 5 / 5 |
| 2026-10-03-gap-audit-capture | 5 / 5 |
| 2026-10-03-gap-audit-corpus | 5 / 5 |
| 2026-10-04-gap-audit-citation | 6 / 6 |
| 2026-10-04-gap-audit-extraction | 7 / 7 |
| 2026-10-04-gap-audit-provenance | 7 / 7 |
| 2026-10-04-tavily-terms-reread | 3 / 3 |
| 2026-10-05-agent-reliability | 5 / 5 |
| 2026-10-05-mcp-registry | 9 / 9 |
| 2026-10-06-builder-skills | 7 / 7 |
| 2026-10-06-kit-vs-prompt-evaluation | 4 / 4 |
| 2026-10-07-break-test-external-facts | 5 / 5 |
| 2026-10-13-portable-artifact-authorization | 0 / 3 |
| **The 41 baseline corpora** | **108 / 183** |
| 2026-10-25-first-quoted-refresh (new) | 3 / 3 |
| 2026-10-25-punctuation-spacing (new) | 3 / 3 |
| 2026-10-25-refresh-recheck-study (new) | 1 / 1 |
| **All 44 corpora** | **115 / 190** |

- **The dossier's 108 / 183 reproduces exactly** on the 41 corpora; 75 closures (41%) have no
  checked quote. The looser count (any quote marker on a cited row) is also 108 in every
  corpus, so no closure rests only on a short, unfound or unreadable quote, and ADR-0191's
  stricter floor moved none of them.
- Coverage is all-or-nothing per corpus: 16 corpora dated 2026-09-21 to 2026-09-28, the
  2026-10-13 one and the root corpus (the kit's own, 0 / 11) carry no quote on any cited row;
  every other corpus covers every closure.
- The three 2026-10-25 projects add 7 / 7; they are reported apart because they were collected
  for this run.
- Each later corpus changes these numbers; the table is a dated measurement, not a target.

## Trigger to revisit

- ADR-0193's rollout or the section 12 study needs coverage per refresh rather than per
  corpus.
- The gate's capture resolution for quotes changes (for example, `byUrl` is dropped): this
  line follows it, and the table above is re-counted.
- The owner asks for the opt-in ratchet, or the owner's 1.0 decision on the freeze (ADR-0117).
