# Brief - Punctuation spacing after inline HTML tags: what Firecrawl and the kit's keyless HTML-to-Markdown converter write before . , ; : ! ? % ) ] } and after ( [ {, and how Firecrawl documents its HTML-to-Markdown conversion

_Auto-drafted 2026-10-25 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require the reviewing agent's judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** The configured research checks passed. Disclosed known unknowns
and gate warnings still apply; PASS does not establish that every claim is correct.

**Gate warnings from this evaluation: 9.**

These findings apply to the whole corpus at the time of this evaluation. Re-run
preflight after edits; this list is not a fresh evaluation of the resulting document.

- **transport-provenance/transport-not-metered** (E-01): E-01 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-03): E-03 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-04): E-04 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-05): E-05 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-06): E-06 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-07): E-07 was collected by "http-keyless", not the metered Firecrawl CLI
- **capture-completeness/partial-only** (U-01): U-01 rests solely on partial captures (omitted: 2 sibling section(s) totalling ~416 words were outside the densest block and are not in this capture; 1 sibling section(s) totalling ~24 words were outside the page's main content and are not in this capture)
- **hygiene/duplicate-url** (E-08): E-08 cites the same URL as E-01 on the same day - one row per fetched page
- **corroboration/single-source** (U-02): U-02 rests on E-09 alone - one reading, so a correct source and a lucky one look the same

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## The prior, registered before anything was collected

_Ledger seq 1, chained: neither this text nor its place before the evidence
can be changed now. Read it against the findings below - it may well be wrong, and a wrong
prior that was recorded in advance is worth more than a right one remembered afterwards._

> I expect the keyless converter to write a space before a closing mark only after a tag it strips to a space (span, sup, abbr, and the span inside a Sphinx code element, which survives as a space inside the backticks), and after an opening mark that is directly followed by such a tag; links, bold, italics and plain code it rewrites whole, so no space there. I expect Firecrawl to write no space before closing marks in any case. I expect Firecrawl's docs not to name the converter library, and its public source to call a Go html-to-markdown library or turndown. I cannot know yet whether Firecrawl's hosted service runs the same code as its public repository.

## Intent

ADR-0192 (held) proposes a matcher-side fix in `normalizeForMatch` (`fetchproof/lib/quotes.mjs`):
remove whitespace before `. , ; : ! ? % ) ] }` and after `( [ {`, so that a `[quote: ...]` copied
from a Firecrawl capture still matches a keyless capture of the same page and the reverse
(plan v0.4 section 5.3, Mandate choice C6). The rule should rest on what the two transports
actually write, not on a guess. Done means: for real pages whose HTML has inline elements
directly followed (or preceded) by punctuation, the corpus holds a capture of the same page from
each transport, a builder can read per mark which transport put a space there, and the brief
says which marks the rule covers, which it does not, and where it could merge text it should not.
No product code is written here.

## What we verified

| Claim | Source | Type |
|---|---|---|
| Keyless capture (`http-keyless`, the current capture of this URL; same HTML as E-08's source) of a Sphinx page. The converter writes a space on BOTH sides of every inline tag it strips, so marks directly beside a tag are spaced. Inline `<code><span class=pre>` keeps the span's spaces inside the backticks, so after normalization the mark is spaced: [quote: Repetition operators or quantifiers (` * `, ` + `, ` ? `, ` {m,n} `, etc)] (`, before` and `?` inside code). Pygments-highlighted code (one `<span>` per token) is spaced at every token: [quote: raise RuntimeError ( f ' { value !r} unexpected on line { line_num } ' )] (space after `(` and `{`, before `!`, `}` and `)`), [quote: if matchobj . group ( 0 ) == '-' : return ' '] (before `.` and `:`, and a space AFTER `.` too), [quote: print ( '[ %s ]+' % re . escape ( legal_chars ))] (after `[`, before `]`). A signature built of `<em>` and `<span class=optional>`: [quote: Pattern. search ( * string * [ , * pos * [ , * endpos * ] ] )] (after `(` and `[`, before `,` `]` `)`). Links, `<strong>`/`<b>`, `<em>`/`<i>` and `<code>` themselves are rewritten whole, so a mark directly after one is not spaced: [quote: can be Unicode strings ([str](../builtins/stdtypes.html#str))]. _(partial capture)_ | E-01 `docs.python.org` (U-01) | P |
| Firecrawl's Advanced Scraping Guide (keyless capture, graded partial: one 24-word sibling section omitted) describes the markdown format only as [quote: Page content converted to clean Markdown.] and main-content extraction as [quote: When `onlyMainContent` is `true` (the default), boilerplate (nav, footer, etc.) is stripped.] It names no converter library and says nothing about whitespace around inline elements. The same capture shows the keyless converter spacing a highlighted code block at every token: [quote: console . log ( doc . markdown );] (before `.` `)` `;`, after `(`). _(partial capture)_ | E-03 `docs.firecrawl.dev` (U-01, U-03) | P |
| Firecrawl capture (`firecrawl-cli`, markdown, only-main-content) of the Wikipedia page, the current capture of this URL (E-02 is the keyless one, same HTML). No space before a closing mark after an inline element: [quote: from the original on 28 December 2019. Retrieved 16 March 2023.], [quote: as in _primo_, _secondo_; it is analogous], [quote: (e.g. _een stijging van 50%_), but most of the time]. A space after `(` (and `[`) when a link or emphasis follows: [quote: in North American Spanish ( [Mexico](https://en.wikipedia.org/wiki/Mexican_Spanish "Mexican Spanish") and the] (source `(<a ...>Mexico</a>`). It also DROPS whitespace the page has when the whitespace sits in its own inline element (`<span> </span>`, a no-break space entity): [quote: U+332B㌫SQUARE PAASENTO, パーセント (_pāsento_, from English "percent")] and the 50%-with-no-break-space example above, which the source writes `50<span typeof="mw:Entity"> </span>%`. | E-09 `en.wikipedia.org` (U-02) | P |
| Firecrawl's open-source API (`apps/api/src/lib/html-to-markdown.ts`, main branch) converts HTML to Markdown in one of three ways, in order: [quote: // Try HTTP service first if enabled] when `HTML_TO_MARKDOWN_SERVICE_URL` is set, then the Go shared library [quote: if (config.USE_GO_MARKDOWN_PARSER) {] and finally [quote: // Fallback to TurndownService if Go parser fails or is not enabled]; each path's output then goes through [quote: markdownContent = await postProcessMarkdown(markdownContent);] from `@mendable/firecrawl-rs`. Which path the hosted service takes is configuration this file does not show. | E-04 `raw.githubusercontent.com` (U-03) | P |
| The HTTP conversion service (`apps/go-html-to-md-service/converter.go`) uses Firecrawl's own fork of a Go library, [quote: md "github.com/firecrawl/html-to-markdown"], configured with two plugins and nothing else: [quote: converter.Use(plugin.GitHubFlavored()) converter.Use(plugin.RobustCodeBlock())]. No whitespace option is set. | E-05 `raw.githubusercontent.com` (U-03) | P |
| The service pins the fork by commit, [quote: github.com/firecrawl/html-to-markdown v0.0.0-20260312013131-1af9901a5d61], and redirects the upstream module to the fork: [quote: replace github.com/JohannesKaufmann/html-to-markdown => github.com/firecrawl/html-to-markdown v0.0.0-20260305014655-0ec744e89d3c]. So the converter is a fork of JohannesKaufmann/html-to-markdown, pinned to a 2026-03 commit. | E-06 `raw.githubusercontent.com` (U-03) | P |
| The Go shared library the API falls back to (`apps/api/sharedLibs/go-html-to-md/html-to-markdown.go`) builds the same converter the same way - [quote: converter := md.NewConverter("", true, nil)] with the GitHubFlavored and RobustCodeBlock plugins - and exports it as [quote: //export ConvertHTMLToMarkdown func ConvertHTMLToMarkdown(html *C.char) *C.char {]. Both Go paths therefore run one library with one configuration. | E-07 `raw.githubusercontent.com` (U-03) | P |

## Contradictions and how they were resolved

1. **The two transports disagree, which is the reason for the rule.** For the same HTML on the
   same day, the keyless converter writes a space on both sides of every inline tag it strips
   (E-01, E-02, E-03), and Firecrawl writes none before a closing mark (E-09, E-08). Both
   readings are trusted as what each transport wrote, because both captures sit next to the
   `.source.html` they were converted from. Neither is "the page".
2. **Firecrawl is not simply the tighter one.** It adds a space after `(` when a link or emphasis
   follows, where the keyless converter adds none: E-09 [quote: in North American Spanish ( [Mexico](https://en.wikipedia.org/wiki/Mexican_Spanish "Mexican Spanish") and the],
   and E-08 [quote: can be Unicode strings ( [`str`](https://docs.python.org/3/builtins/stdtypes.html#str "str"))]
   against E-01 [quote: can be Unicode strings ([str](../builtins/stdtypes.html#str))]. So the
   space after `(` comes from Firecrawl as well as from the keyless converter.
3. **Firecrawl drops whitespace the page has** when that whitespace is its own inline element
   (`<span> </span>`, a no-break-space entity span). E-09 [quote: U+332B㌫SQUARE PAASENTO, パーセント (_pāsento_, from English "percent")]
   and `50%` for the source's `50<span typeof="mw:Entity"> </span>%`. Here the keyless capture
   (`U+332B ㌫ SQUARE`, `50 %`) is truer to the source. The rule reconciles the `%` case only by
   accident, because `%` is in its set. It cannot reconcile `㌫SQUARE`: there is no mark there.
4. **Docs against source.** The docs (E-03) say only [quote: Page content converted to clean Markdown.]
   and name no converter. The public repository (E-04 to E-07) names Firecrawl's fork of
   JohannesKaufmann/html-to-markdown, pinned to a 2026-03 commit. Its order is an HTTP service,
   then a Go shared library, then turndown, and each path's output goes through `postProcessMarkdown`
   from `@mendable/firecrawl-rs`. The two do not contradict each other; the docs are silent.
   **Not established:** whether the hosted API runs this code and which of the three paths it
   takes (that is configuration), and what `postProcessMarkdown` does to whitespace. That
   function's source was not collected. So the Firecrawl side is known only by measurement and
   may change without notice.
5. **Against the prior.** The prior expected Firecrawl to write no space at all. That was wrong
   for the space after `(` (point 2). The prior also did not foresee Firecrawl dropping whitespace
   (point 3). The keyless part of the prior held.
6. **Corroboration.** Each transport was read on two independent page builds: Sphinx (Python `re`)
   and MediaWiki (Wikipedia "Percent sign"). U-02's gate warning `single-source` is correct about
   the contract. Only E-09 is current, because E-08 is superseded by the later keyless re-fetch
   of the same URL. E-08 still shows the same behaviour on the other site's HTML. Both readings
   come from one day and one version of each transport.

## Known unknowns

None. No unknown is declared KNOWN-UNKNOWN.

## Decision

This section feeds ADR-0192's rule, which runs after `normalizeForMatch`:
`.replace(/\s+([.,;:!?%)\]}])/g,'$1').replace(/([([{])\s+/g,'$1')`.

It rests on two pairs of captures. Each pair is one page fetched through both transports from
the same HTML:

- the Python `re` page: E-01 keyless (current) and E-08 Firecrawl (history);
- Wikipedia "Percent sign": E-02 keyless (history) and E-09 Firecrawl (current).

E-02 and E-08 are superseded rows. This brief reads them as the other half of each pair; no
unknown cites them.

The "Measured" column comes from `measure-spacing.mjs` in this project's folder (run it from the
repo root). Each passage is a window of about 24 characters on either side of a spaced mark,
taken from the keyless capture and searched in the Firecrawl capture of the same page. A cell
reads "found now → found with the rule, of N spaced passages", for Python, then Wikipedia.

### Per mark

| Mark | Keyless (`http-keyless`) | Firecrawl (`firecrawl-cli`) | Rule covers it? | Measured: Python / Wikipedia |
|---|---|---|---|---|
| `.` before | Space. E-02 [quote: from the original on 28 December 2019 . Retrieved 16 March 2023 .] | No space. E-09 [quote: from the original on 28 December 2019. Retrieved 16 March 2023.] | Yes. **Not** the space keyless writes AFTER `.` in highlighted code: E-01 [quote: if matchobj . group ( 0 ) == '-' : return ' '] stays `matchobj. group` | 15→68 of 214 / 0→27 of 48 |
| `,` | Space. E-02 [quote: as in *primo* , *secondo* ; it is analogous] | No space. E-09 [quote: as in _primo_, _secondo_; it is analogous] | Yes | 1→136 of 322 / 0→4 of 7 |
| `;` | Space. Same E-02 quote | No space. Same E-09 quote | Yes | 0→1 of 1 / 0→1 of 2 |
| `:` | Space. E-01 [quote: if matchobj . group ( 0 ) == '-' : return ' '] | No space. E-08 [quote: if matchobj.group(0) == '-': return ' '] | Yes at the mark. This passage still fails, because of `. group` and `group (` | 4→12 of 19 / 0→0 of 1 |
| `!` | Space. E-01 [quote: raise RuntimeError ( f ' { value !r} unexpected on line { line_num } ' )] | No space. E-08 [quote: raise RuntimeError(f'{value!r} unexpected on line {line_num}')] | Yes at the mark. The passage still fails on the straight quotes `f '` and `' )` | 0→0 of 1 / 0→0 of 2 |
| `?` | Space, inside backticks. E-01 [quote: Repetition operators or quantifiers (` * `, ` + `, ` ? `, ` {m,n} `, etc)] | No space. E-08 [quote: Repetition operators or quantifiers (`*`, `+`, `?`, `{m,n}`, etc)] | Yes (this pair becomes equal) | 2→9 of 9 / 0→0 of 2 |
| `%` | Space in code, E-01 [quote: print ( '[ %s ]+' % re . escape ( legal_chars ))]. Also the page's own no-break space, E-02 [quote: *een stijging van 50 %* ), but most of the time] | E-08 [quote: print('[%s]+' % re.escape(legal_chars))] keeps the code's own space. E-09 drops the no-break space: [quote: (e.g. _een stijging van 50%_), but most of the time] | Yes, but it also removes a real space (`x % y`, `50 %`). Harmless for matching, because both sides lose it | 7→15 of 28 / 7→13 of 27 |
| `)` | Space. E-01 RuntimeError quote; E-02 `50 %* ),` | No space. E-08, E-09 above | Yes | 0→35 of 198 / 0→3 of 8 |
| `]` | Space. E-02 [quote: [ [edit](/w/index.php?title=Percent_sign&action=edit&section=1) ]] and E-01 [quote: Pattern. search ( * string * [ , * pos * [ , * endpos * ] ] )] | No space. E-08 [quote: Pattern.search( _string_\[, _pos_\[, _endpos_\]\])] | Yes at the mark. The signature still fails on `Pattern. search` and `search (` | 0→2 of 27 / 0→7 of 23 |
| `}` | Space. E-01 RuntimeError quote (`{ line_num }`) | No space. E-08 `{line_num}` | Yes | 0→2 of 3 / 0→0 of 2 |
| `(` after | Space before a stripped tag: E-01 `RuntimeError ( f`. No space before a link: E-01 `strings ([str]` | No space before code tokens. **Space** before a link or emphasis: E-09 `( [Mexico]`, E-08 ``strings ( [`str`]``, `search( _string_` | Yes, on both sides | 0→10 of 207 / 0→1 of 3. The reverse direction, Firecrawl passages in keyless: 0→6 of 31 / 0→5 of 6 |
| `[` after | Space: E-02 edit links, E-01 `[ , * pos` | Space before emphasis: E-09 ``\[ _Guide to the main typographic rules_\](PDF)`` | Yes, on both sides | 1→4 of 32 / 0→0 of 11 |
| `{` after | Space: E-01 `{ value !r}` | No space: E-08 `{value!r}` | Yes | 0→2 of 4 / 0→0 of 1 |

All ten closing marks and all three opening marks were seen spaced in a keyless capture. In
Firecrawl captures, the only space beside a mark came after `(` or `\[` before a link or
emphasis. In the quoted passages, Firecrawl never put a space before a closing mark after an
inline element.

The Firecrawl captures do contain spaced closing marks: in the Python capture, 27 before `.`,
22 before `%` and 9 before `?`. These are counted in the reverse measurement in
`measure-spacing.mjs`, but they were not traced one by one to the source HTML. The reading that
they are the page's own spaces (code such as `x % y`) is likely but unverified.

### What the rule does NOT cover

Each of these keeps a passage from matching even with the rule. They are the reason the
"with the rule" counts stay well below N.

- **Quote marks** `'` and `"`, straight or curly. Keyless writes `f ' {`, `' )` and
  E-02 [quote: ' an increase of 50% ' ).] from `<span class="gloss-quot">`. Firecrawl writes `f'{`
  and `')`.
- **The space AFTER `.`, `,` or `:`** where keyless splits code into tokens. `re . escape`
  becomes `re. escape`, not `re.escape`.
- **The space BEFORE an opening mark.** `search (` and `group (` (keyless) against `search(`
  (Firecrawl). The rule only removes the space after `( [ {`.
- **Whitespace that Firecrawl drops** where there is no mark: `U+332B㌫SQUARE` against
  `U+332B ㌫ SQUARE`. These stay different under the rule.
- **Marks outside the set** were not tested: `…`, `»`, `/`, dashes, `*`, CJK punctuation.
  NFKC folds full-width `（）` to ASCII `()`, so those are covered in effect.
- **A separate matcher quirk, not about spacing.** Firecrawl escapes a bracketed citation as
  `\[…\](PDF)`. After the backslash is removed, `normalizeForMatch`'s link rewrite reads it as a
  link and deletes "(PDF)". This is an open risk for the builder.

### Where the rule would merge text it should not

These checks ran under `normalizeForMatch` followed by the rule:

- `1 .5` becomes `1.5`, and `1 ,5` becomes `1,5`, so they are treated as equal. Across the 430
  captures in this repository, no number appears as `<digit> .<digit>` or `<digit> ,<digit>`.
- Other "word, space, mark, word" joins counted over those 430 captures:
  - `.` 674 times, mostly `.claude` paths, so a quote `at.claude` matches `at .claude`;
  - `:` 74 times, `%` 56 times, `!` 17 times, `,` twice;
  - `.` before a digit once (`needs .75`), `:` before a digit once (`:443`), `%` before a digit
    5 times.
- French-spaced `Quoi ?` equals `Quoi?`, and `a ? b : c` equals `a? b: c`. This is leniency, not
  a wrong merge.
- The plan's pins stay distinct: `1.5` against `1. 5`, `15` against `1,5`, `1000` against `1,000`,
  and `1,5` against `1, 5`. The rule never removes a space AFTER a closing mark.

So the rule's only real merge risk is a closing mark that starts a token (`.5`, `.txt`, `:443`)
and comes after a space. That shape did not occur in a numeric quote anywhere in this corpus.

### First build step

Write the ADR-0192 tests in the quote-matcher tests (`fetchproof/lib/quotes.mjs`) before
changing the function. There are three groups.

1. **Pairs that must match with the rule.** Take each Firecrawl quote above and its keyless
   counterpart:
   - E-09 and E-02 `Retrieved 16 March 2023.`;
   - `primo`;
   - the `?` quantifier pair from E-08 and E-01;
   - the `( [Mexico]` and `( [str]` pairs.
2. **Pins that must stay distinct:** `1.5` against `1. 5`, `15` against `1,5`, `1000` against
   `1,000`, and `1,5` against `1, 5`.
3. **Documented limits, asserted as NOT matching:**
   - the straight-quote pair;
   - `re . escape` against `re.escape`;
   - `search (` against `search(`;
   - `U+332B ㌫ SQUARE` against `U+332B㌫SQUARE`.

   Asserting these means that widening the rule later is a decision someone makes on purpose.

Then add the two `.replace` calls and re-run `measure-spacing.mjs`. The "with the rule" counts
above are what it should reproduce.

### Out of scope

- Product code. This project wrote none.
- Changing what either transport writes. A keyless-side fix that keeps tags adjacent to
  punctuation unspaced is an alternative for the builder to weigh. It would not help with
  Firecrawl's dropped whitespace.
- Quote-mark spacing, the space before `(`, and the `(PDF)` link quirk. Each needs its own
  decision.

## Next steps

1. Review the **TODO** sections above (Contradictions, Decision) before handing off.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=b0cc0f941d7d8837 inputs=0067c1165fd4e8cd gate=pass -->
