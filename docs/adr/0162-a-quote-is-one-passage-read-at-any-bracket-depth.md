# ADR-0162 - A quote is one passage, read at any bracket depth, its floor measured per fragment

- **Date:** 2026-10-17
- **Status:** accepted; amended 2026-10-19 (review of the 2026-10-19 sweep): in the
  per-fragment floor a character of a script without word spaces weighs a third of a word, as
  in ADR-0176, and a fragment is short only when it is short both by that weight and on spaces
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
the same rule - a scattered quote is no longer counted as found there either. `quoteChars`
remains for measurement and orientation, but the check no longer uses it. `quoteWords`, whose
last caller was the check, is removed: an export nothing references fails `repo-hygiene` since
#297 (found when this branch was merged with it, 2026-10-19).

A quote whose fragments genuinely lie in one passage is unaffected: the repository's own
decision corpora hold four ellipsis quotes, and all three projects still pass their gates.

## Amendment, 2026-10-19 — a word is counted in every script, as ADR-0176 counts it

The review of the 2026-10-19 sweep (gaps and docs slice, F1) found that the per-fragment floor
stopped checking an elided quote in Japanese or Chinese. Those scripts put no space between
their words, so a fragment counted on spaces was ONE word, and a sentence of about 25
characters is under `MIN_QUOTE_CHARS` (40). Two full sentences joined by an ellipsis were
therefore "every fragment under both floors": the quote warned `quote-too-short`, the check
moved on without comparing it with the capture, and a quote with one figure changed passed
with a warning instead of failing `quote-not-found`. Measured over the joined text, before
this ADR, the same quote was 50 characters and was checked.

`quoteTooShort` now weighs each fragment the way `similarity.mjs` does (ADR-0176): one
character of a script without word spaces, with its marks, weighs `1/CHARS_PER_WORD` of a
word, and every other whitespace-separated run is a word. A fragment is short when it weighs
under `MIN_QUOTE_WORDS` words (nine such characters), has under `MIN_QUOTE_WORDS`
whitespace-separated words, AND is under `MIN_QUOTE_CHARS` characters. The character class
(`UNSPACED_CHARACTER`) and the weight (`CHARS_PER_WORD`) are imported from `similarity.mjs`,
not copied, so the two measurements cannot drift apart.
A fragment with no character of such a script weighs exactly what it did, so no quote in any
other script changes verdict.

Rejected: **measure the joined text again when a fragment is in such a script.** It would
check this quote, but it reopens what this ADR closed - three fragments none of which is
specific alone clearing the floor together - and it would make the rule depend on the script,
where the weight asks the same amount of text of every fragment in every script. **Split on
punctuation, as the shingles do.** ADR-0126 kept punctuation inside a word (a dependency map,
an identifier); here an ideographic comma or full stop counts as one character, so at most
seven ideographs and two stops clear the floor, which is still a clause.

Corrected the same day (second review of the 2026-10-19 sweep, F1): the weight first
REPLACED the count on spaces, and a spaced fragment in such a script weighs less than its
spaces say. `每月 20 美元` is three whitespace-separated words, so it was checked before this
amendment, but it weighs one word and four characters, under the floor: it warned
`quote-too-short`, and `每月 25 美元` against a capture saying `每月 20 美元` passed with that
warning instead of failing `quote-not-found`. So did `月額 1,980 円` and `API 料金 limits` -
the usual spacing of Chinese and Japanese pricing pages. The weight now only adds checking: a
fragment is short only when it is short on spaces too, so every fragment checked before this
amendment is still checked. Rejected: **weigh each whitespace-separated run as at least one
word.** It keeps a single measure, but it is a third definition of a word beside ADR-0126's
(on spaces) and ADR-0176's (by weight). Taking both existing counts needs no new one, and the
warning's "no fragment reaches 3 words" is then true by either.
