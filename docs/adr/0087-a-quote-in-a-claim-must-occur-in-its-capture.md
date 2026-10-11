# ADR-0087 — A quote in a claim must occur in its capture

- **Date:** 2026-09-28
- **Status:** accepted; amended by ADR-0126 (a quote under three words but at least 40 characters is not short)
- **Area:** `lib/quotes.mjs`, `lib/checks.mjs` (`citations`: `quote-not-found`, `quote-too-short`)
- **Evidence:** `docs/decisions/2026-09-28-quote-anchors/` (U-01..U-03)

## Context

The kit proves that a cited page was fetched and not edited. It cannot tell whether a claim
reads that page correctly, and a gate that judged prose would be wrong. One part of that gap
needs no judgement at all: whether a quoted passage actually occurs in the cited page.

- **The failure is real.** A deep-research report attached six quotations to real, well-placed
  citations, and none of the six occurred anywhere in its corpus (E-01).
- **Working links are not supported claims.** Across 14 models, working and relevant
  citations supported their specific claim only 24-77% of the time (E-04).

## Decision

- **The marker:** an EVIDENCE Finding may carry `[quote: ...]`, the same shape as
  `[render-reviewed: ...]`. A row may carry several. An ellipsis (`...` or `…`) separates
  fragments, and every fragment must occur in the row's capture, in order.
- **Matching:** exact after normalization, for comparison only. At least one normalized
  fragment must be nonempty and match; formatting-only fragments alongside real text are
  ignored, while an anchor with no remaining text cannot be reported as found.
  - **Normalization:** NFKC, curly quotes and long dashes to plain ones, Markdown link
    syntax to its text, emphasis, backticks and escapes removed, whitespace collapsed, case
    folded.
  - **Where it applies:** to the capture body, after its front matter.
- **Severity:**
  - A quote not found is `citations/quote-not-found`, blocking under every policy. The
    capture refutes a claim about itself, the same class as an edited capture.
  - A quote under three words is `citations/quote-too-short`, a warning.
  - A row with no marker is not a finding. Anchors are opt-in.
- **Proven on real captures:** in the research project's own corpus, five quotes, taken from
  pages with Markdown links, backticks and footnotes, were all found.

## Rejected alternatives

- **A fuzzy fallback (0.92 similarity, as OpenContracts uses).** There, a failed quote only
  loses its quotation marks. Here it fails the gate, and a 0.92 match accepts an invented
  word inside a real sentence, which is the failure being caught.
- **Checking quotation marks in free prose.** Across this repository's 17 corpora, a naive
  pairing of quotation marks read the text between two quotes as a quote, again and again.
  That makes a checker that is wrong about prose.
- **Judging whether the quote supports the claim.** That is prose judgement, and it stays
  with the reviewer (AGENTS.md: no gate judges prose).
- **A new EVIDENCE column.** It would change a table format that every corpus and parser
  shares. The marker fits in the existing Finding cell, as `[render-reviewed: ...]` already
  does.
