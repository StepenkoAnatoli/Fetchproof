# ADR-0191 — The short-quote floor is measured on the compared text

- **Date:** 2026-10-25
- **Status:** accepted; amends ADR-0126 (what the floor measures) and ADR-0162 (removes
  `quoteChars`, which that record kept "for measurement and orientation")
- **Area:** `fetchproof/lib/quotes.mjs` (`quoteTooShort`; `quoteChars` removed). No command,
  flag, format, configuration key, check or finding changes; `citations/quote-too-short` keeps
  its severity and message.
- **Prompted by:** the reasoning-layer plan v0.4 (owner-approved), section 5.1, items R-01 and
  R-02 (B1).
- **A bug fix under the freeze (ADR-0117).** It makes the rule do what ADR-0087 and ADR-0126
  already say ("a quote under three words warns"), and only in the strict direction: it adds
  warnings and removes no failure. It lifts no freeze or hold. It is not one of the 0192-0195
  items that carry the owner's ruling of 2026-10-25.

## Context

ADR-0087 warns `citations/quote-too-short` for a quote that anchors almost nothing: `free plan`
occurs on every pricing page. ADR-0126 measured that as "under 3 words and under 40
characters", and ADR-0162 measured it per fragment, with ADR-0176's weight for scripts that
put no space between words. Each of those counts was taken on the **raw** fragment, as written
in the Finding cell. `anchorFound` searches for something else: `normalizeForMatch(f)`, the
fragment after NFKC, with format characters dropped, Markdown link syntax and emphasis taken
off, whitespace collapsed and case folded.

So the floor and the matcher measured two different texts, and the raw text is the longer one:

- `[quote: [Free plan](https://vendor.example.com/pricing#free-plan-details)]` is 65 raw
  characters, so it was not short. It anchors `free plan`.
- `[quote: **Free** plan]` with 35 U+200B characters after `**Free**` is 48 raw characters, so
  it was not short. It anchors `free plan`.
- `[quote: **************************************** ... free plan]` has a 40-character fragment,
  so the quote was not short. The first fragment compares as nothing and `anchorFound` skips it
  (2026-10-08), so the quote anchors `free plan`.
- A 40-character token ending in `__` is 39 compared characters.

Each one passed as a checked quote that anchors two words. That contradicts what ADR-0087 and
ADR-0126 say the rule does.

The fix copies the prior art of Testimonium (github.com/noahogbi/testimonium, MIT), whose
`belowClaimFloor` rule puts the floor on the text that is compared. No code or fixture of it is
copied; this is re-implemented from the plan's description.

## Decision

1. **`quoteTooShort` takes every count on `normalizeForMatch(f)`**: the words on spaces,
   ADR-0176's weight (`fragmentWeight`) and the length. A fragment is short when the compared
   text is short by all three, as before. The quote is short when every fragment is short
   (ADR-0162). It is one predicate, and the message in `checks.mjs` is unchanged.
2. **A fragment that compares as nothing is short.** It anchors nothing, so it cannot make a
   quote specific.
3. **One documented branch: an anchor with no compared text at all is measured on its raw
   fragments, exactly as before this ADR.**
   - If it were measured on compared text it would always be short. The check stops at the
     short warning (`continue`), so it would never reach `anchorFound`.
   - That would turn the 2026-10-08 failures into warnings. Forty `*`, forty U+200B,
     `**** **** ****` and a long empty-label link all fail `quote-not-found` today.
   - B1's stated effect is warnings only (plan section 5.1 "Effect"; section 16, Risks: "Warnings,
     not failures").
   - With the branch, an all-empty anchor gets the same result as before: `***` warns, and the
     four long ones fail as not found, because `anchorFound` refuses an anchor with no compared
     text. That test (`quotes.test.mjs`, "citations refuse a formatting-only quote...") is
     untouched.
4. **`quoteChars` is deleted.**
   - Since ADR-0162 it had no caller in `lib/` or `bin/`. Its one caller was a test pinning
     the raw length (`quotes.test.mjs:116`).
   - Aligning it to the compared text would have kept a second, test-only definition of "the
     length the floor measures", and that is how the floor and the matcher drifted apart here.
   - The pin now goes through `quoteTooShort`: 39 characters are short and 40 are not.
   - An export nothing references would fail `repo-hygiene` (#297).

## Rejected alternatives

- **Measure every anchor on compared text, all-empty ones included (option A).** It is the
  literal "an empty fragment is short". It turns four `quote-not-found` failures into
  `quote-too-short` warnings, which goes in the lenient direction and against B1's stated
  effect.
- **Treat an all-empty anchor as never short, so it always goes to `anchorFound` and fails
  (option B).** It is stricter and has no branch on raw text. But it turns the pinned
  `[quote: ***]` warning into a failure. That is a verdict change in the failure direction,
  which goes beyond the plan's stated effect ("adds warnings"). It would also rewrite an
  expected value the 2026-10-08 test chose on purpose ("the existing short-quote warning still
  stops the matching path").
- **Fail an all-empty anchor in `checks.mjs` before the short check (option D).** It moves the
  rule out of the predicate into its caller, so there would be two places that decide what an
  empty quote is. It also has the same failure-direction change as B for `***`.
- **Keep `quoteChars` and align it to the compared text.** It has no caller in the kit, so
  keeping it would only keep a second measure to drift.
- **Lower `MIN_QUOTE_CHARS`, or count raw and compared text and take the smaller.** That is
  two measures where the matcher has one, and the 130-character token of ADR-0126 is already
  measured correctly on compared text: ASCII outside `*_\`` is left as it is.

## Consequences

- Corpora get new `quote-too-short` warnings, and no new failure, for quotes whose specificity
  came from link URLs, emphasis, backslashes, underscores, invisible characters or a
  formatting-only fragment.
  - U3's movement script lists every quoted row across the 41 corpora that moves from checked
    to warned. This record does not.
  - A row that moves stops being compared with its capture, which is ADR-0087's behaviour for
    any short quote.
- NFKC runs before ADR-0176's weight, so a quote's form can change its weight. A full-width
  figure is not a character of a script without spaces on either side, so `月額 １，９８０ 円`
  keeps the verdict of `月額 1,980 円` (tested). Half-width katakana with a separate voiced
  mark (`ｶﾞ`, two code points) folds to one character (`ガ`). Such a fragment can weigh less
  and become short: a warning, in the strict direction.
- `MIN_QUOTE_WORDS`, `MIN_QUOTE_CHARS`, `CHARS_PER_WORD` and the message are unchanged.
  `measure.mjs` counts quotes through `anchorFound` and does not call `quoteTooShort`, so its
  numbers do not move.

## Trigger to revisit

- A real quote that names one exact passage warns because its specificity lived only in
  characters the comparison drops, for example a URL quoted as link syntax where the URL is
  the fact. Then decide whether the matcher, not the floor, should keep link targets.
- B2 (ADR-0192) changes `normalizeForMatch`. The floor follows it automatically, and that
  movement has to be counted with B2's.
- The owner's 1.0 decision on the freeze (ADR-0117).
