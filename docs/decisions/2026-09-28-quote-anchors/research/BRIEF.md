# Brief - Quote-anchored claims: how research tools verify quotations against cited sources, Unicode normalization for matching quoted text

_Auto-drafted 2026-09-28 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
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

## The prior, registered before anything was collected

_Ledger seq 1, chained: neither this text nor its place before the evidence
can be changed now. Read it against the findings below - it may well be wrong, and a wrong
prior that was recorded in advance is worth more than a right one remembered afterwards._

> I expect prior art to verify quotes by exact substring after light normalization (whitespace, case, quote marks), sometimes with a fuzzy threshold; I expect NFKC to be the right Unicode form for matching, with the caveat that it folds compatibility characters, so it is for comparison only, never for storage.

## Intent

The kit proves a cited page was fetched and not edited; it cannot tell whether a claim reads
that page correctly. A small, deterministic part of that gap can be closed: a claim may
carry a verbatim quote of its page, and the gate checks the quote is really there. Done
means the kit knows how others verify quotes, how to normalize text for matching, and what
the marker, threshold and severity should be - without the gate ever judging prose.

## What we verified

| Claim | Source | Type |
|---|---|---|
| OpenContracts issue #2189: steered to quote its cited passages, a deep-research agent produced quotations that "do not occur anywhere in the corpus" - an exact-substring search for six quoted strings returned 0 matches each - attached to real, well-placed citations, so the report "looks rigorously cited". [quote: exact-substring search across every document's text layer for the report's six quoted strings returned 0 matches for all six] | E-01 `github.com` (U-01) | S |
| OpenContracts PR #2193 verifies each quoted passage against the cited source's text: "whitespace-/case-normalized substring" with a difflib fuzzy fallback at threshold 0.92; a quote that fails is demoted to paraphrase (quotation marks stripped) with a warning; quotes shorter than a minimum word count are skipped as the main source of false positives. [render-reviewed: the PR description paragraphs cited here are present in full at lines 42-69; the failures are GitHub widget notices] [quote: whitespace-/case-normalized substring, with a difflib.SequenceMatcher longest-contiguous-block fuzzy fallback] | E-02 `github.com` (U-02) | S |
| MDN String.prototype.normalize: forms NFC, NFD, NFKC, NFKD; NFKC is "Compatibility Decomposition, followed by Canonical Composition" - available in Node without dependencies. [quote: Compatibility Decomposition, followed by Canonical Composition] | E-05 `developer.mozilla.org` (U-03) | P |

## Contradictions and how they were resolved

- **A fuzzy fallback (E-02) or not.** OpenContracts accepts a quote at 0.92 similarity to
  tolerate "trivial drift". The kit will not use one, because the two settings differ.
  - **Why fuzzy suits OpenContracts:** it demotes a failed quote to paraphrase, so a false
    rejection costs a pair of quotation marks.
  - **Why it doesn't suit the kit:** a failed quote here fails the gate. A 0.92 match
    accepts an invented word inside a real sentence, which is exactly the failure being
    caught.
  - **How the kit covers the drift instead:** it normalizes before comparing (below). That
    handles the drift a capture really introduces, and nothing looser is needed.
- **Skip short quotes (E-02) or refuse them.** OpenContracts skips them because it cannot
  tell a scare-quote from a quotation. The kit's marker is explicit, so a short quote there
  is deliberate but proves almost nothing. The kit therefore refuses a marker under three
  words as too short to anchor a claim, rather than skipping it silently.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**A `[quote: ...]` marker in an EVIDENCE Finding cell, checked by the gate.**

- **Syntax:** the same shape as `[render-reviewed: ...]`. A row may carry several markers.
  Inside one, `...` or `…` separates fragments. Every fragment must occur in the row's
  capture, in order.
- **Normalization, for comparison only:**
  - NFKC (E-05, E-06).
  - Curly quotes to straight, en and em dashes to `-`.
  - Markdown link syntax reduced to its text, and emphasis, backticks and backslash
    escapes removed.
  - Whitespace collapsed, case folded.
  - The same normalization is applied to the capture body, after its front matter.
- **Severity:** a quote not found is **blocking** under every policy. A fabricated quote
  is a claim about the capture that the capture refutes, the same class as an edited
  capture. A marker under three words is a warning. No marker is not a finding: anchors
  are opt-in, and nothing judges unanchored prose.
- **What it does not do:** it does not decide whether the quote *supports* the claim
  (E-03, E-04). That is judgement, and it stays with the reviewer.

**Out of scope:** checking quotation marks in free prose. A survey of this repository's 17
corpora found 282 quote-mark pairs, and a naive pairing mis-read many of them as the text
*between* two quotes. That is why the marker is explicit.

**First build step:** a `quote-anchors` check in `lib/checks.mjs` over `corpus.evidence`,
tested with a real quote, a fabricated one, one split by an ellipsis, one hit by NFKC and
curly quotes, and one too short.

## Next steps

1. Build the check above, with its ADR, in the same commit.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=a678830ab20c5673 inputs=34671ad698db7fc2 gate=pass -->
