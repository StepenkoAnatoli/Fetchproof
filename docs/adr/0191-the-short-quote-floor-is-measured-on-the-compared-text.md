# ADR-0191 — The short-quote floor is measured on the compared text

- **Date:** 2026-10-25
- **Status:** accepted; amends ADR-0126 (what the floor measures) and ADR-0162 (removes
  `quoteChars`, which that record kept "for measurement and orientation")
- **Area:** `fetchproof/lib/quotes.mjs` (`quoteTooShort`, `quoteTooShortOnRaw`; `quoteChars`
  removed) and the quote-anchor loop of `fetchproof/lib/checks.mjs`. No command, flag, format,
  configuration key, check or finding is added; `citations/quote-too-short` keeps its severity,
  and its message gains one clause saying the count is taken on the compared text.
- **Prompted by:** the reasoning-layer plan v0.4 (owner-approved), section 5.1, items R-01 and
  R-02 (B1). Decision 5 and the corrections to this record come from its review the same day
  (U1 review F1-F7, run decision D-l).
- **A bug fix under the freeze (ADR-0117).** It makes the rule do what ADR-0087 and ADR-0126
  already say ("a quote under three words warns"), in the strict direction: it removes no
  failure, because every quote compared before it is still compared (decision 5). It adds
  warnings. It can add a failure, and drop a warning, only for a few contrived quotes that NFKC
  or case folding lengthens: they are compared now instead of warned (Consequences). It lifts
  no freeze or hold. It is not one of the 0192-0195 items that carry the owner's ruling of
  2026-10-25.

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
- A 40-character token ending in `__` is 38 compared characters.

Each one passed as a checked quote that anchors two words. That contradicts what ADR-0087 and
ADR-0126 say the rule does.

The fix copies the prior art of Testimonium (github.com/noahogbi/testimonium, MIT), whose
`belowClaimFloor` rule puts the floor on the text that is compared. No code or fixture of it is
copied; this is re-implemented from the plan's description.

## Decision

1. **`quoteTooShort` takes every count on `normalizeForMatch(f)`**: the words on spaces,
   ADR-0176's weight (`fragmentWeight`) and the length. A fragment is short when the compared
   text is short by all three, as before. The quote is short when every fragment is short
   (ADR-0162). It is one predicate. The message in `checks.mjs` stays one message, with one
   clause added: the count is of "the compared text (link targets, emphasis and invisible
   characters do not count)". Without it the warning told an agent that a 77-character
   `[Enterprise plan](https://...)` reached no 40 characters (review F7).
2. **A fragment that compares as nothing is short.** It anchors nothing, so it cannot make a
   quote specific.
3. **One documented branch: an anchor with no compared text at all is measured on its raw
   fragments, exactly as before this ADR.**
   - If it were measured on compared text it would always be short. Forty `*`, forty U+200B,
     `**** **** ****` and a long empty-label link all fail `quote-not-found` today (2026-10-08).
     Decision 5 would keep that failure, but each would gain a warning beside it.
   - B1's stated effect is warnings only (plan section 5.1 "Effect"; section 16, Risks: "Warnings,
     not failures"), and nothing is gained by warning a quote that already fails.
   - With the branch, an all-empty anchor gets the same result as before: `***` warns, and the
     four long ones fail as not found, with no warning, because `anchorFound` refuses an anchor
     with no compared text. That test (`quotes.test.mjs`, "citations refuse a formatting-only
     quote...") is untouched.
4. **`quoteChars` is deleted.**
   - Since ADR-0162 it had no caller in `lib/` or `bin/`. Its one caller was a test pinning
     the raw length (`quotes.test.mjs:116`).
   - Aligning it to the compared text would have kept a second, test-only definition of "the
     length the floor measures", and that is how the floor and the matcher drifted apart here.
   - The pin now goes through `quoteTooShort`: 39 characters are short and 40 are not.
   - An export nothing references would fail `repo-hygiene` (#297).
5. **A short quote is left uncompared only when it was short on its raw text too.**
   `checks.mjs` warns when `quoteTooShort` says so, and then skips `anchorFound` only when
   `quoteTooShortOnRaw` (the measure before this ADR, on the fragments as written) agrees.
   - Without it, decisions 1-3 stopped at the warning, as the check always had. A quote long
     on raw text and short on compared text was then no longer compared at all. The review's
     reproduction: `[quote: [Enterprise plan](https://vendor.example.com/pricing#enterprise-plan-details)]`,
     with no "enterprise plan" in the capture, failed `quote-not-found` before this ADR. Under
     decisions 1-3 alone it warned and the gate passed. The same held for zero-width padding,
     a formatting-only fragment beside two words, a soft-hyphenated long word and `ｶﾞ`x5.
   - So the set of quotes the gate compares only grows. Every quote compared before this ADR
     is still compared, and every failure it could produce is still produced. A quote short on
     both measures keeps ADR-0087's behaviour: warned, never compared.
   - Pinned at the gate level: "a quote short only on its compared text still warns and is
     still compared" in `quotes.test.mjs`.

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
  measured correctly on compared text: ASCII outside `*_\`` is left as it is. Decision 5 does
  read the raw measure, but not for the floor: the warning is decided on compared text alone,
  and the raw measure only keeps the set of compared quotes what it was before this ADR.
- **Accept that a quote long raw and short compared is no longer compared (review F1, option
  a).** It is consistent with ADR-0087, under which a short quote is never compared, and a
  plain invented `[quote: free plan]` already only warned. Rejected (run decision D-l,
  2026-10-25): it removes a gate failure - an invented quote that blocked now passes with a
  warning - in a change classed as a bug fix on the claim that it goes only in the strict
  direction. Under the freeze (AGENTS.md) a change that could be read either way is a feature.

## Consequences

- Corpora get new `quote-too-short` warnings for quotes whose specificity came from link URLs,
  emphasis, backslashes, underscores, invisible characters or a formatting-only fragment.
  - U3's movement script lists every quoted row across the 41 corpora that moves. This record
    does not. One committed anchor outside those 41 moves: E-02 of
    `docs/decisions/2026-10-25-punctuation-spacing` (`MOVEMENT-2026-10-25-B1.md`).
  - A row that moves keeps being compared with its capture (decision 5), so it gains a warning
    and keeps any failure it had.
- The measure moves in both directions. NFKC and `toLowerCase()` usually shorten a fragment,
  but they can lengthen it: `㍿` folds to `株式会社`, `ﬃ` to `ffi`, `İ` to `i̇` (two code
  points). So `[quote: ㍿㍿㍿]`, fourteen `ﬃ` or twenty `İ` were short on raw text - warned and
  never compared - and are long on compared text: they are compared now, lose the warning and
  fail `quote-not-found` when the capture lacks them. The strict direction, on contrived input
  only; no committed corpus has such a quote (review F3). `㍿㍿㍿` is pinned in
  `quotes.test.mjs`.
- NFKC runs before ADR-0176's weight, so a quote's form can change its weight. A full-width
  figure is not a character of a script without spaces on either side, so `月額 １，９８０ 円`
  keeps the verdict of `月額 1,980 円` (tested). Half-width katakana with a separate voiced
  mark (`ｶﾞ`, two code points) folds to one character (`ガ`). Such a fragment can weigh less
  and become short: it warns, and, long on raw text, it is still compared (decision 5).
- `MIN_QUOTE_WORDS`, `MIN_QUOTE_CHARS` and `CHARS_PER_WORD` are unchanged; the message gains
  one clause (decision 1).
  `measure.mjs` counts quotes through `anchorFound` and does not call `quoteTooShort`, so its
  numbers do not move.

## Trigger to revisit

- A real quote that names one exact passage warns because its specificity lived only in
  characters the comparison drops, for example a URL quoted as link syntax where the URL is
  the fact. Then decide whether the matcher, not the floor, should keep link targets.
- B2 (ADR-0192) changes `normalizeForMatch`. The floor follows it automatically, and that
  movement has to be counted with B2's.
- The owner's 1.0 decision on the freeze (ADR-0117).
