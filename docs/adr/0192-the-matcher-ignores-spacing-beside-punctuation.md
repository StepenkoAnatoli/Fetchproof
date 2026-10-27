# ADR-0192 — The quote matcher ignores the spacing beside punctuation

- **Date:** 2026-10-25
- **Status:** accepted; changes what ADR-0087's matcher compares, and with it ADR-0191's floor
- **Area:** `fetchproof/lib/quotes.mjs` (`normalizeForMatch` only). No command, flag, format,
  configuration key, check or finding changes; `citations/quote-not-found` and
  `citations/quote-too-short` keep their severity and message.
- **Prompted by:** the reasoning-layer plan v0.4 (owner-approved), section 5.3 (B2), Mandate
  choice C6, requirement R-15; research project `docs/decisions/2026-10-25-punctuation-spacing/`.
- **Lifts the hold (ADR-0157) and the freeze (ADR-0117)** for this one item, by the owner's ruling of
  2026-10-25: "spend credit but in a new chat for 192/195", read as the range 0192-0195. Unrelated
  work stays held.

## Context

ADR-0087's `[quote: ...]` check compares a passage with the row's capture after
`normalizeForMatch`. Two transports write the same page with different spacing beside
punctuation. The research project measured one page from each of two page builds (Sphinx, the
Python `re` page; MediaWiki, Wikipedia "Percent sign"), each fetched through both transports
from the same HTML (E-01 and E-02 keyless, E-08 and E-09 Firecrawl):

- **The keyless converter** writes a space on both sides of every inline tag it strips (`<span>`,
  `<sup>`, `<abbr>`, a Sphinx code token). So `2019</span>.` reads `2019 .` and
  `<em>primo</em></i>,` reads `*primo* ,`. Nine closing marks, `. , ; : ! ? ) ] }`, and all three
  opening marks were seen spaced this way (E-01, E-02, U-01). `%` was not. It is in the rule
  because Firecrawl drops the no-break space a page writes before `%`, which the keyless capture
  keeps (E-02 against E-09, `50 %* ),`); E-01's capture also spaces it once from Pygments spans,
  unquoted (its line 2098). Corrected 2026-10-26 (Phase 4b spec review S3-3): this said all ten
  closing marks were seen spaced by the converter.
- **Firecrawl** writes no space before a closing mark after an inline element (E-08, E-09). It
  does write one after `(` or `[` when a link or emphasis follows (`( [Mexico](https://...)`), where the
  keyless converter writes `([Mexico](https://...)`. So the space after `(` comes from both transports.

A quote copied from one capture was `quote-not-found` in the other transport's capture of the
same page: a failure under every policy, for text that is word for word the same.

**Why this could not wait for the ADR-0145 comparison.** ADR-0193's recheck compares a quote
across a row's old capture and its refreshed one, and the two may come from different
transports (a key that ran out, `--fallback`, a builder's request served keyless). Without this
rule, spacing noise alone reopens a citation the refresh did not change. The plan ships B2 with
ADR-0193 for that reason (section 3).

Prior art: Testimonium (github.com/noahogbi/testimonium, MIT) also normalizes punctuation in its
matcher, by deleting commas and folding numbers (both rejected below), and the method of
re-running a frozen anchor table to list what moved is its. Nothing is copied; this is
re-implemented from the plan's description.

## Decision

1. **After its existing steps, `normalizeForMatch` removes whitespace before
   `. , ; : ! ? % ) ] }` and after `( [ {`** - exactly the rule the research measured:
   `.replace(/\s+([.,;:!?%)\]}])/g, '$1').replace(/([([{])\s+/g, '$1')`.
   It runs last, on both the quote and the capture, so `anchorFound` and the floor of ADR-0191
   read one text. The code comment above it names this ADR and the research project.
2. **It never removes a space AFTER a closing mark.** The plan's pins stay distinct (tested):
   `1.5` and `1. 5`, `15` and `1,5`, `1000` and `1,000`, `1,5` and `1, 5`. The comma is the kit's
   own addition to the set: removing the space before a comma cannot merge `1,5` with `15`, which
   deleting commas would.
3. **The merges it accepts are pinned as KNOWN MERGE tests:** `1 .5` = `1.5`, `1 ,5` = `1,5`,
   `at .claude` = `at.claude`. Over the repository's 430 captures the research found no number
   written `<digit> .<digit>` or `<digit> ,<digit>`. The other "word, space, mark, word" shapes it
   counted: `.` 674 times (mostly `.claude` paths), `:` 74, `%` 56, `!` 17, `,` twice; a mark
   before a digit 7 times (`needs .75`, `:443`, `%` five times). French spacing (`Quoi ?` =
   `Quoi?`) is leniency, not a wrong merge.
4. **Tests derived from the measured captures**, as short synthetic strings in each measured
   shape (`quotes.test.mjs`): one per mark in the set, each in both directions (keyless spacing
   in the quote and Firecrawl spacing in the capture, and the reverse); the four pins; the
   KNOWN MERGE pins; a passage the rule must NOT rescue, pinned as not found; and the gate's view
   of the plan's section 7.5 case 12 through the `citations` check.

## Rejected alternatives

- **Fixing only the keyless converter** (keep a stripped tag adjacent to its punctuation). It
  leaves every capture already on disk as it is - captures are records and are never rewritten -
  and every Firecrawl-to-keyless switch still broken. It also cannot help with whitespace
  Firecrawl drops. Rejected by the plan (section 5.3); the research names it as the builder's
  alternative and finds the same limit.
- **Testimonium's comma deletion and number folding (`bn`, `mn`).** Deleting commas merges `15`
  with `1,5`; folding numbers adds leniency a frozen capture does not need. Rejected by the plan.
- **Running the floor's skip on the pre-rule text** (deciding whether to compare a short quote
  on the text before this rule, so that a quote at the floor's edge stays compared; Consequences,
  `quoteTooShort`). It would close the fail-to-warn path at the edge, but the floor would then
  measure a text `anchorFound` does not search - the split ADR-0191 removed - and every caller
  would need a second normalized form beside the one they share. The edge needs a quote short on
  its raw text that NFKC or case folding lengthened to exactly the floor, and none of the 557
  quote anchors in the 44 tracked corpora is short on its raw text at all (2026-10-25). The lead
  kept the floor on the compared text (U9 review F2, run decision D-t, 2026-10-25).

Each of the next three is a shape the research saw keep a passage unmatched even with the rule
("What the rule does NOT cover"), and put out of scope as needing "its own decision". The merge
counts in Decision 3 were taken for this set and no wider one, so widening it would first need
its own merge count. Each is pinned as not found in `quotes.test.mjs`, so widening is deliberate.

- **Quote marks in the set** (`'` and `"`, straight or curly). Keyless writes `f ' {` and `' )`
  (E-01) and `' an increase of 50% ' ).` from a `<span class="gloss-quot">` (E-02); Firecrawl
  writes `f'{` and `')`. A quote mark opens and closes with one character, so a rule could not
  tell which side of it to tighten.
- **The space AFTER `.`, `,` or `:` in tokenized code** (`re . escape` against `re.escape`, E-01
  against E-08). Removing a space after a closing mark is exactly what would merge `1. 5` with
  `1.5`, the plan's first pin.
- **The space BEFORE `(`** (`search (` and `group (` keyless, `search(` Firecrawl). The rule only
  removes the space after `( [ {`; the research found this space only where the keyless converter
  splits code into tokens.

## Deferred

- **Whitespace Firecrawl drops beside no mark** (`U+332B㌫SQUARE` against the source's
  `U+332B ㌫ SQUARE`, E-09). There is no mark there, so no punctuation rule reaches it, and
  removing all whitespace would match invented text. Deferred until a real quote fails on it.
- **The link-rewrite quirk on `\[…\]` before `(PDF)`.** Firecrawl escapes a bracketed citation as
  `\[ _Guide_\]` directly followed by `(PDF)`; once the backslash is removed, `normalizeForMatch`'s link rewrite reads it
  as a link and deletes `(PDF)`. Not about spacing; a separate follow-up, not fixed here.
- **Marks outside the set** (`…`, `»`, `/`, dashes, `*`, CJK punctuation) were not measured. NFKC
  folds full-width `（）` to `()`, so those are covered in effect.

## Consequences

- **Callers of `normalizeForMatch`**, by grep of `fetchproof/` and `docs/` on 2026-10-25:
  - `anchorFound` (`fetchproof/lib/quotes.mjs`) normalizes both the capture and each fragment,
    so the rule applies on both sides. Its callers: the `citations` check (`lib/checks.mjs`),
    `lib/measure.mjs`, the movement script, and ADR-0193's recheck when it lands.
  - `lib/measure.mjs` reads both functions. Its quote count (`quotesFound`) can only rise. Its
    quote coverage (`quoteCoverage`, ADR-0195) counts a row as usable only when its quote is
    found AND not `quoteTooShort`, so a found quote the rule makes short (below) stops counting
    and coverage can fall. Over the 44 tracked corpora neither number moves: no anchor changes
    `found` or `tooShort` (2026-10-25).
  - `quoteTooShort` (`fetchproof/lib/quotes.mjs`) measures `normalizeForMatch(f)` since ADR-0191:
    the floor reads the ruled text, so the rule moves the floor, in both directions. The
    `citations` check warns `quote-too-short` on it, and skips the comparison only when
    `quoteTooShortOnRaw` agrees.
    - **It can add a warning.** Words are counted on spaces, so `free ( plan )` (four words) is
      `free (plan)` (two words, 11 characters) with the rule. A real quote of that shape newly
      warns `quote-too-short`, and is still compared, because its raw text clears the floor.
      Pinned in `quotes.test.mjs` ("the short-quote floor counts the text after the spacing
      rule").
    - **At the floor's edge it can remove a comparison.** ADR-0191 compares a quote that is
      short on its raw text but long on the compared text, which NFKC or case folding
      lengthened. The rule removes characters from the compared text, so such a quote can drop
      back under the floor and is not compared again: an invented one goes from
      `fail quote-not-found` to `warn quote-too-short`. The U9 review's examples are contrived:
      `İ` nineteen times then ` .` (21 units raw; 40 compared before the rule, because
      lowercasing writes `İ` as two units, and 39 after it), and `x(´y(´z` (NFKC writes `´` as
      a space and U+0301; three words before the rule, one after). The edge needs a quote short
      on its raw text and lengthened to exactly the floor, and none of the 557 quote anchors in
      the 44 tracked corpora is short on its raw text at all (2026-10-25). The floor stays on
      the compared text (ADR-0191); running its skip on the pre-rule text is rejected above.
  - `docs/decisions/2026-10-25-punctuation-spacing/measure-spacing.mjs` imports it and applies
    the same two `.replace` calls after it (the regexes are identical). From this ADR on, the
    text it searches for spaced passages already has none, so every count it prints is 0 (run
    2026-10-25). Its numbers in the research brief describe the matcher before this ADR, at the
    base commit its header names; they stay the record. The project is not edited. To
    reproduce them, run the script from a checkout of the commit before this ADR's
    (`2d831ca~1`, d788545 on the run branch): `git worktree add --detach <dir> 2d831ca~1`, then,
    from that worktree's root, `node docs/decisions/2026-10-25-punctuation-spacing/measure-spacing.mjs`.
    Re-run that way on 2026-10-25, it printed every per-mark count and every join count of the
    brief; it counted 431 captures where the brief says 430. `normalizeForMatch` there is
    byte-identical to the one at 8c63e77, the base the header names, which does not yet hold
    the project. On Windows give the worktree a short path: under a deep folder, git could not
    write the corpus files ("Filename too long").
  - `quoteAnchors` (the parser) does not call it, so a quote's fragments are split exactly as
    before.
- **A found quote stays found.** The rule only deletes whitespace that sits beside a mark, and a
  fragment is trimmed, so wherever a fragment occurred in the capture, its normalized form occurs
  in the normalized capture. Gaps between fragments can only shrink, so `MAX_QUOTE_GAP` still
  holds. For matching the change is lenient: `quote-not-found` can turn into found. The floor
  that decides whether a quote is compared moves both ways (`quoteTooShort`, above).
- **Movement over the baseline corpora** (`docs/measurements/2026-10-refresh-baseline/movement.mjs`,
  compare mode, 2026-10-25, on U1's tree with and without this rule): **zero movement in the 41
  baseline corpora.** None of the 517 baseline anchors changes `found` or `tooShort`, so none
  moves from checked to `quote-too-short` through ADR-0191's floor either, and no verdict moves.
  The script prints 47 lines and exits 1, and those 47 lines are identical, byte for byte, with
  and without the rule. Each is an `added` line for a corpus committed after the baseline
  (ab2e605), so the baseline has nothing to compare it with:
  - `corpus ... added` for `2026-10-25-first-quoted-refresh`, `2026-10-25-punctuation-spacing`
    and `2026-10-25-refresh-recheck-study` (3 lines);
  - `anchor ... added` for their 40 anchors: 39 `found`, and one `quote-too-short`, the
    research's own `[ [edit](https://...) ]` (E-02 [5]), which compares as `[edit ]` without the
    rule and `[edit]` with it, short either way;
  - `refresh ... added` for their 4 superseded pairs.
  That the spacing project's anchors are found either way is expected: each quote was copied
  from the capture it is checked in, so its spacing is that capture's own.
- **What that zero does not prove.** The baseline's 517 anchors were written against the
  captures they were checked in, so none was lost to spacing in the first place, and the 27
  historical refreshes carry no quote. The lenient side of this rule shows only when a quote
  crosses transports - the case ADR-0193 creates. The baseline measures that it moves no
  existing verdict, not that it rescues a real one; the research's per-mark counts are that
  measure.
- **Movement across transports: the superseded pairs.** `movement.mjs` cannot show it: it
  checks each anchor against its own row's capture, and for the 3 corpora committed after
  ab2e605 it prints only `added`. ADR-0193's question does move - is an old row's quote found in
  the capture of the row that replaced it? The 4 superseded pairs in the tracked corpora hold 12
  quote anchors. The 2 of `2026-10-25-first-quoted-refresh` are found with and without the rule.
  The 10 of `docs/decisions/2026-10-25-punctuation-spacing` are each Firecrawl's spacing against
  keyless spacing of the same HTML, and **6 of them go from not found to found**, each the rule
  working as intended:
  - E-08 -> E-01, ``Repetition operators or quantifiers (`*`, `+`, `?`, `{m,n}`, etc)``: the
    keyless capture keeps the spaces inside each code span (`` ` * ` ``); the `(`, `,` and `?`
    cases.
  - E-08 -> E-01, ``can be Unicode strings ( [`str`](https://...)``: Firecrawl writes a
    space after `(` before a link and the keyless capture does not; the `(` case, from the other
    side.
  - E-02 -> E-09, `from the original on 28 December 2019 . Retrieved 16 March 2023 .`: a
    stripped span before `.`; the `.` case.
  - E-02 -> E-09, `as in *primo* , *secondo* ; it is analogous`: emphasis before `,` and `;`.
  - E-02 -> E-09, `SQUARE PAASENTO , パーセント ( *pāsento* , from English`: `,` after a word and
    after emphasis, and the space after `(` before emphasis.
  - E-02 -> E-09, `*een stijging van 50 %* ), but most of the time`: `%` after the page's own
    no-break space, which Firecrawl drops (both sides lose it), and `)` after emphasis.

  The other 4 stay not found, each a shape listed under Rejected or Deferred, or not spacing:
  - E-08 -> E-01, `raise RuntimeError(f'{value!r} unexpected on line {line_num}')`: the quote
    marks (`f '`, `' )`) and the space before `(`.
  - E-08 -> E-01, `Pattern.search( _string_\[, _pos_\[, _endpos_\]\])`: the space after `.` in
    tokenized code (`Pattern. search`) and the space before `(`.
  - E-02 -> E-09, `' an increase of 50% ' ).`: the quote marks.
  - E-02 -> E-09, `[ [edit](https://...) ]`: not spacing; E-09's capture has no edit link at all.

  Reproduction: for each pair `supersededRows` (`lib/checks.mjs`) returns, `anchorFound` of the
  old row's anchors in the replacing row's capture body, with `lib/quotes.mjs` from `2d831ca~1`
  and from this ADR's commit. The U9 review's scratch script (`pairs-all.mjs`) does this; re-run
  over all 44 tracked corpora on 2026-10-25, it printed `corpora 44, anchors 557, moved
  base->head 0; superseded-pair anchors 12, moved 6`.

## Trigger to revisit

- A real quote is not found because of a shape listed under Rejected or Deferred (quote marks,
  `re . escape`, `search (`, dropped whitespace, `(PDF)`).
- A real numeric quote is wrongly matched through a KNOWN MERGE (`1 .5`, `1 ,5`).
- A real quote stops being compared at the floor's edge (Consequences, `quoteTooShort`): reopen
  the rejected "floor's skip on the pre-rule text".
- Firecrawl changes its converter (its fork of JohannesKaufmann/html-to-markdown, pinned to a
  2026-03 commit, E-06) or the hosted service is shown to take another path (E-04), so that its
  spacing changes.
- The keyless converter (`lib/http-transport.mjs`) stops spacing stripped tags.
- The owner's 1.0 decision on the freeze (ADR-0117).
