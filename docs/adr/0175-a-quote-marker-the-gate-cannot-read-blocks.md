# ADR-0175 - A quote marker the gate cannot read blocks, as a quote it refutes does

- **Date:** 2026-10-19
- **Status:** accepted
- **Area:** `fetchproof/lib/quotes.mjs`, `fetchproof/lib/checks.mjs` (`citations`),
  `fetchproof/lib/measure.mjs`. One more rule in a check that already owns two quote rules
  (`quote-not-found`, `quote-too-short`); no command, flag, format or configuration key. A new
  finding under the feature freeze (ADR-0117), hence this record.
- **Refines:** ADR-0087 (a `[quote: ...]` anchor must occur in the capture) and ADR-0162 (a
  marker is read at any bracket depth). Both stand.

## Context

Issue #319 measured, on a copy of this repository's corpus, six Finding endings against the gate
and `measure`. Two were read: a real passage passed, an invented one failed `quote-not-found`.
Four were not markers at all, so the row passed as one with no quote and `measure` counted it
among the unanchored rows:

- `[quote: calls[a[0]].id is read on billing]` - brackets two levels deep;
- `[quote: Billing is credit-based` - no closing bracket;
- `[Quote : Billing is credit-based]` - a space before the colon;
- `[quote Billing is credit-based]` - no colon.

From the writer's side each is a quotation that was written down and never checked: an invented
sentence in any of these shapes passed, where the same sentence in the exact shape failed. That
is ADR-0087's own case - a report whose six quotations, attached to real citations, occurred
nowhere in the corpus - reproduced by a typo an agent writing the marker by hand makes.

ADR-0162 closed the first shape by counting brackets, and refused to name an unreadable marker
instead, because a Finding may discuss the marker syntax and a warning on an empty or
unterminated marker would fire on that prose. Counting brackets cannot close the other three: no
reading of `[Quote :` or `[quote the sentence]` recovers the passage without guessing where it
starts and ends.

## Decision

`unreadableQuoteMarkers(text)` in `quotes.mjs` returns every `[quote` (any case, any spacing
after the bracket, with or without a colon, closed or not) that does not open a marker
`quoteAnchors` reads. `citations` reports each as `quote-unreadable`, **fail**, naming the row,
the first 40 characters of the attempt, and both repairs: write it as `[quote: the passage]`, or
drop the marker and paraphrase. It blocks for the reason `quote-not-found` blocks: in both cases
the quotation is unverified, and a reader of the brief cannot tell.

`measure` counts each as a quote, not found, and its row as anchored: the row carries a quotation,
and the quotation was not found in the capture.

Not attempts, so not reported:

- a `[quote` inside a marker already read (a passage that quotes the syntax);
- a `[quote` inside a code span or a URL, the one false-positive shape #319 names;
- a Markdown link whose text starts with the word (`[Quote of the day](https://...)`), which is
  a link, not a marker;
- `[quotes]`, `[quoted]` and the like (`\bquote\b`).

ADR-0162's concern is answered by measurement rather than by staying silent: over the 41
research projects in this repository (the root corpus and every `docs/decisions/*` project),
417 EVIDENCE rows and their 517 readable anchors, the rule fires 0 times. The prose that writes
the syntax as an example writes `[quote: ...]`, which is a read marker, or puts it in backticks.

## Rejected alternatives

- **Read the typo shapes as if they were well-formed** (accept `[Quote :` and `[quote `, or close
  an unterminated marker at the cell's end). A tolerant parser guesses the passage: without a
  colon, where does the claim's own text stop and the quote start, and without a closing bracket,
  is the rest of the cell part of it? A guessed passage that happens to match proves nothing, and
  one that does not produces a `quote-not-found` on text the writer never quoted. Naming the
  attempt and the one shape that is read is exact.
- **Warn instead of fail.** A warning leaves the brief passing with a quotation nothing checked,
  which is the case this check exists to stop; `quote-not-found` is blocking for the same reason.
  The repair is one character, and the detail names it.
- **Count it as an unanchored row in `measure`** (the old behaviour, unchanged). The row is not
  without a quote - its writer wrote one - and leaving it out of the quotes raised the "quotes
  found" share with every quotation written wrongly.
- **Report it in `quoteAnchors`' return value** (an `unreadable` field beside the anchors). Every
  caller of `quoteAnchors` would have to learn to look; a separate function keeps the anchors'
  shape, and the two callers that need the attempts ask for them.

## Consequences

`unreadableQuoteMarkers` is exported. `citations` holds three quote rules: `quote-not-found` and
`quote-unreadable` (fail), `quote-too-short` (warn). A brief that passed before can now fail, only
by holding a `[quote` the gate did not read - which, measured on this repository, none does.
