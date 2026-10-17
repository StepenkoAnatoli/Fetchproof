# ADR-0162 - A quote is one passage, read at any bracket depth, its floor measured per fragment

- **Date:** 2026-10-17
- **Status:** accepted
- **Area:** `research-kit/lib/quotes.mjs`, `research-kit/lib/checks.mjs` (ADR-0087). A fix to
  the quote check's own reading, not a new capability: it adds no command, flag, transport,
  provider, configuration key or check.
- **Refines:** ADR-0087 (a `[quote: ...]` anchor must occur in the capture) and ADR-0126 (the
  short-quote floor is words AND characters). Both decisions stand.

## Context

The 2026-10-03 gap audit (`docs/review-2026-10-03-gap-audit.md`, rank 4, VERIFIED) found three
defects in the `[quote: ...]` check; the 2026-10-04 gap audit
(`docs/review-2026-10-04-gap-audit.md`, rank 4, which re-verified it) restated them:

- The marker regex read **one** level of brackets. A passage two levels deep - a Markdown link
  whose own text held brackets - was not read as a marker at all: `matchAll` found nothing, so
  the quote was not checked, and nothing said so.
- The fragments of one quote could be **arbitrarily far apart**. `anchorFound` searched each
  fragment from the end of the previous match with no upper bound, so
  `[quote: free ... requests ... credits]` anchored three words scattered over a pricing page
  and passed as verified.
- The short-quote floor was measured over the **joined** fragments. Three one-word fragments
  read as three "words" and cleared a floor none of them reaches alone.

The second audit named a fourth item in the same rank - "a quote that normalises to nothing is
counted as found". That was closed on 2026-10-08 (an anchor that normalises entirely to empty
cannot count as found; formatting-only fragments beside real text are still ignored). It is not
re-done here, and its behaviour is kept.

## Decision

The marker reader counts brackets instead of matching a fixed depth: a marker opens at
`[quote:` and closes at the `]` that balances it, so a passage may hold a code subscript, a
Markdown link, or a link whose own text holds brackets, with no depth limit.

A quote is one passage. `anchorFound` requires each fragment to start within `MAX_QUOTE_GAP`
(300 characters of the compared, normalised text, about a paragraph) of the end of the one
before it. Each fragment's placement is tried at every occurrence, not only the first: with a
bound, a first occurrence out of context would otherwise reject the passage the quote meant.

The short-quote floor is measured **per fragment**, by `quoteTooShort`: the quote is short only
when EVERY fragment is under both floors. A single long or multi-word fragment is enough for the
quote to be specific.

## Rejected alternatives

- **Keep the one-level regex and name an unreadable marker instead** (`quote-unparsed`). The
  audit allows either. Refused: a Finding may legitimately discuss the marker syntax - this
  repository's own decision projects write `[quote: ...]` as an example - and a warning on an
  empty or unterminated marker would fire on that prose. Counting brackets reads the real
  passage and does not fire there.
- **Bound the gap by "the same paragraph".** `normalizeForMatch` collapses runs of whitespace,
  so paragraph breaks are already gone from the compared text; checking them would need a second
  normalised form and a second matcher for one rule. The character bound is simpler and testable.
- **Bound the gap relative to the quote's own length.** A short quote would then get the
  tightest bound, where the scattered-word case lives, and it would read as more precise while
  being less predictable. A single documented constant is clearer.
- **Fuzzy-match within the bound.** ADR-0087 refused fuzzy matching (a 0.92 similarity accepts
  an invented word inside a real sentence). Nothing here reopens it.
- **Warn rather than fail when fragments are far apart.** Each fragment still occurs, so the
  outcome is not the same as a refuted quote. Kept as the existing `quote-not-found` fail: the
  quote AS A PASSAGE does not occur, which is what the check claims.

## Consequences

`MAX_QUOTE_GAP` and `quoteTooShort` are exported; `anchorFound` takes `{ maxGap }` so a caller
can tighten the bound. `measure.mjs` counts quotes through `anchorFound`, so its count follows
the same rule - a scattered quote is no longer counted as found there either. `quoteWords` and
`quoteChars` remain for measurement and orientation, but the check no longer uses them.

A quote whose fragments genuinely lie in one passage is unaffected: the repository's own
decision corpora hold four ellipsis quotes, and all three projects still pass their gates.
