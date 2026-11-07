# ADR-0203 — Which lines GitHub shows as code or hides is read in columns, inside list items

- **Date:** 2026-11-06 (amended 2026-11-07)
- **Status:** accepted
- **Area:** `fetchproof/lib/corpus.mjs` (`hiddenLines`, `parseTable`, `notATable`, `tableHidden`)
- **Prompted by:** the fresh-eyes review of PR #441 (2026-11-06), findings 3 and 4, the
  re-review of its fix (2026-11-06), findings 1-5, the re-review of 9b9afaa (2026-11-07),
  findings F-A to F-E and N1, the re-review of 88fe19a (2026-11-07), findings F2-F6, and the
  re-review of 116a2a3 (2026-11-07), findings 1 and 3-5
- **Extends:** the F01 fix of the same branch (independent audit 2026-11-04, F01: a table in a
  code block or an HTML comment is not the table), which had no ADR
- **Freeze (ADR-0117):** a bug fix. F01's rule is that a table GitHub shows as code or hides is
  not the table; as written it hid tables GitHub shows and still read some GitHub hides. No new
  check, flag, error code or format.

## Context

F01 made the header search skip what the stray-row scan already skipped: the lines of a fence or
an HTML comment, both decided by one `blockContext`, fed each line trimmed. The review of #441
found two defects in that reading.

- **Trimmed, an indented line opened what it cannot open.** Four spaces and ```` ``` ```` or
  `<!--` is indented code on GitHub, which opens nothing; trimmed, it opened a fence or a comment
  that ran to the end of the file. An example of how a fence is written, indented above the
  table, hid every table below it: a correct contract was read as having no unknowns (twelve
  failures on a real project of this repository), a correct `EVIDENCE.md` as holding no table,
  with the remedy "restore the file", which changes nothing. With the example's `-->` indented
  below the live table, the visible OPEN table was passed over for an archived CLOSED copy
  further down, and the gate passed.
- **Five shapes of an archived CLOSED copy were still read** (on `main` as well): an opener after
  a list marker (`- <!--`, `` 1. ``` ``), whose indented closer, trimmed, then opened a fence; a
  line indented four inside a fence, which is its content and was taken as its closer; and a
  comment reopened by a `<!--` after the `-->` on the same line, which cmark ends with that line
  and GitHub's sanitizer keeps open to the next raw `-->`.
- **The re-review of the fix found five more** (2026-11-06). A byte-order mark - Windows
  PowerShell 5's `-Encoding utf8` writes one - led the first line, so a fence or a comment opened
  there was not seen. An item opened on an empty line was held open across a blank line, and a
  run of `=` or `-` below a paragraph was read as the paragraph's next line; GitHub ends the item
  and the paragraph there, so a copy indented four below them, shown as code, was read as the
  contract. A lazy continuation line - a paragraph's next line, indented less than its item's
  content - ended the item, so a table indented in the item, which GitHub shows, was read as code
  and a correct contract as having no unknowns. And each list marker on a line asked the rest of
  the line whether it was a thematic break: a line of 40,000 markers took 18-23 s, and a
  package's files reach the reader through the validator.
- **The re-review of 9b9afaa found six more** (2026-11-07), in the reading that fix kept: block
  rules of its own beside CommonMark's, with a "safe way" for the shapes it did not model.
  - F-A: the safe way failed open. Where it ended an item GitHub keeps - one whose paragraph is
    led by an autolink, inline code or an inline tag, or holds a lazy line of those, or a
    delimiter row of another width - a comment or a fence opened right below, at the item's
    column (indented 4 or 5), was read as the paragraph's text. An archived CLOSED copy in it
    passed preflight over the live OPEN table, and `appendRow` wrote into it.
  - F-B: a header and delimiter row written as lazy lines below an item's paragraph were read as a
    table, where GitHub reads more of the paragraph; and rows at column 0 below a table indented
    in an item were read as its rows, where GitHub shows them after the item, as text.
  - F-C: a footnote definition held nothing, so a comment or a fence at column 4 below `[^x]:`
    was read as text; and a definition nothing refers to, which GitHub leaves out with all it
    holds, was read.
  - F-D: a carriage return alone, which ends a line on GitHub, was part of the line, so a fence
    opener followed by one (CR CR LF) was not seen, and the copy in the fence was read.
  - F-E: `isSeparator`'s pattern backtracked over a long line, and the stray-row scan walked back
    over the rows below a named line for each of them: time in the square of either's size.
  - N1: a comment opened in an item and cut off where the item ends - its `-->` at column 0 -
    was taken as closed. GitHub ends the block there but leaves the `<!--` open in its page, and
    the browser hides what follows: the table below it was read.
- **The re-review of 88fe19a found five more in the reading** (2026-11-07; its F1 is the
  writer's, ADR-0204):
  - F2: GitHub shows footnote definitions below the body, in the order of their first reference,
    wherever they stand; the reader took a table in a referenced definition above the body's
    table, and an archived CLOSED copy there passed preflight over the live OPEN table.
  - F3: a comment reopened by a `<!--` after the `-->` that ended its block was closed at any
    `-->`, where GitHub writes one in a paragraph or in code as `--&gt;` and the browser's comment
    stays open: the archived copy below such a line was read. A header in a block the file never
    closes was not named.
  - F4: nested footnote definitions nothing refers to were each marked over all their lines:
    7,200 nested over 200,000 lines took 3.9 s.
  - F5: a header taken in lazily keeps its leading space, which GitHub reads as an empty first
    cell. It was named for its cell counts, with a remedy - one more delimiter cell - that makes a
    table of shifted columns.
  - F6: a header and delimiter row lazy below a footnote definition's paragraph were named in a
    list item's words.
  - Found while fixing them: a label defined twice - GitHub keeps the definition that ends first
    and drops the other, with all it holds; of two nested, the inner one ends first - was read in
    both.
- **The re-review of 116a2a3 found four more in the reading** (2026-11-07; its finding 2 is the
  writer's, ADR-0204):
  - 1: a comment's reach was read in file order, where GitHub shows the footnotes below the body.
    A comment the body leaves open hides them too, but a table in a referenced definition was
    still read: an archived CLOSED copy there passed preflight where GitHub shows no table. And a
    comment reopened in a footnote definition hid the body below it, which GitHub shows: the live
    OPEN table was passed over for the copy, and a contract with no copy was named hidden.
  - 3: a `[^label]` in a code span or an inline comment, which GitHub reads as no reference, kept
    a definition GitHub leaves out, and the table it holds was read.
  - 4: a line of nested referenced definitions was ordered with the outermost. GitHub moves each
    out to its own place, so the table it shows second was read.
  - 5: a file that ends inside an HTML block of type 1 or 3 to 5 - `<pre>`, `<script>`, `<?`,
    `<![CDATA[` - takes in what is written at its end, which `open` did not say.
  - Found while fixing them, each checked on GitHub's renderer: a comment the body reopened stays
    open past a `-->` in a footnote definition, which GitHub shows below the body; and a comment
    cut off inside a footnote definition hides the rest of that definition and the definitions
    GitHub shows after it - a table in either was read - but not one it shows before it.

## Decision

1. **One pass over the raw lines, `hiddenLines(lines)`,** returns, line by line: `at`, the block
   that hides a line - `{ kind: 'fence' | 'indented' | 'comment' | 'html' (with its `type`) |
   'footnote', line }`, naming the line that opened it, for a reopened comment the line of the
   `-->` it was reopened after (`reopened`), and for a comment a footnote definition leaves open
   that definition's line (`footnote`); `open`, a fence, an HTML block of type 1 or 3 to 5, a
   comment or a reopened comment the body ends inside, or a comment cut off in the body where the
   block holding it ends (`runaway`); `heads`, whether GitHub makes a table of a header there, or
   why not; `rowOf`, the table a line is a row of; `segs`, how many lines GitHub reads in it;
   `endWhy`, why a table ended there; `note`, the innermost footnote definition GitHub shows that
   holds a line, with its place in the footnotes' order; and `tables`, every table GitHub makes,
   with its header as GitHub read it. The header search, the stray-row scan, the search for the
   heading above a table and the writer (ADR-0204) all ask it.
2. **cmark-gfm's block parser, line by line** - the parser GitHub renders with; `blocks.c` and
   `table.c` read on 2026-11-07:
   - a line ends at LF, CR LF or a carriage return alone; a NUL reads as U+FFFD; a byte-order mark
     is skipped on the first line only; a tab advances to the next multiple of 4 columns;
   - containers - block quotes, list items, footnote definitions, each measured from its parent's
     offset - hold the lines that continue them: a quote, a line with `>` indented 0-3; an item, a
     line indented past its parent's to its content, or a blank line once it holds a block; a
     footnote definition, a line indented 4, or an empty one. A line that continues none and is
     no lazy line closes them, with all they hold;
   - openers, in cmark's order: `>`, an ATX heading, a fence (a backtick fence's info string holds
     no backtick), an HTML block of the seven types (the seventh not over a paragraph), a setext
     underline, a thematic break, a footnote definition `[^label]:` (its content 4 past its
     parent's), a list item (indented 0-3; over a paragraph only non-empty and, ordered, from 1;
     at most 100 opened on a line), indented code (not over a paragraph), a table's header over a
     paragraph's last line, and a table's rows;
   - leaves: a paragraph runs to a blank line; a fence to a run of its own character at least as
     long, indented 0-3, with nothing after it; indented code over lines indented 4 and blank
     lines; an HTML block of types 1-5 to its end condition, checked on its first line too, and
     of types 6 and 7 to a blank line; a heading and a thematic break end with their line;
   - a lazy line - one that continues no container, opens no block and is not blank, below an
     open paragraph - is more of the paragraph. A table takes no lazy line;
   - a table is a paragraph's last line over a delimiter row with as many cells - cells of `-`
     with an optional `:` at either end, between pipes or with none (`:--`); after one failed
     attempt that paragraph makes none. Its rows are the lines below it that are not blank and
     start no block, to a cap on its cells;
   - a comment's `-->` ends its block. A `<!--` after it reopens the comment in GitHub's page,
     which keeps it open to the next `-->` GitHub writes as it stands, an HTML block's - one in a
     paragraph or in code is written `--&gt;` (F3) - and a comment cut off where its container
     ends (N1) hides the rest of the file;
   - a comment's reach is read in the order GitHub shows the page: the body, then the footnote
     definitions. One the body leaves open hides every definition too, and a `-->` in a definition,
     shown below the body, closes it for none of the body. One a definition leaves open - cut off,
     never closed or reopened - hides the rest of that definition and the definitions shown after
     it, and nothing of the body (finding 1);
   - a footnote definition nothing refers to - no `[^label]`, matched without regard to case,
     where GitHub reads one: in a paragraph, a heading or a table's cell, not in a code span, an
     autolink or inline HTML (a tag, a comment, a processing instruction, a declaration, CDATA),
     not escaped (`\[^label]`, `[^label\]`), and not followed by `(` (finding 3) - is left out,
     with all it holds, and so is a label's definition that ends after another of it: the second,
     or the one holding a nested one (cmark-gfm's `process_footnotes` keeps the first to end). The
     others are shown below the body, in the order of their first reference (F2), a nested one
     moved out to its own place in that order, and a line is the innermost definition's that
     holds it (finding 4).
3. **A table in indented code is not the table.** GitHub shows it as code. It was read before F01
   and after it, and below an item a blank line ended or a heading's underline until the
   re-review.
4. **A heading in a code block or a comment heads no section.** Taken as one, a `# example` in a
   fence above the table set the section the stray-row scan runs to.
5. **A header GitHub makes no table of is not the table, and is named with why.** The header the
   reader takes is the first with the table's columns that GitHub makes a table of, outside a
   block that hides it, in the order GitHub shows them: the body's first, else the first in the
   footnote definition GitHub shows first, a header counted in the innermost definition that
   holds it (F2, finding 4). With none, the first such header GitHub makes no
   table of is a `table-split` problem, with the reason and the remedy: its header and delimiter
   row are lazy lines below a list item's paragraph, a footnote definition's or a block quote's,
   each named in its own words (F6); its header alone is, and GitHub reads its leading space as
   an empty first cell (F5); its delimiter row is indented 4 past the header; GitHub does not read
   the delimiter row; an earlier delimiter row in the paragraph had another number of cells, or
   this one has; a carriage return alone stands in either line; or it stands straight below
   another table's rows, of which GitHub makes it one more. The writer refuses in the same words
   (`notATable`, ADR-0204). With no header but one a block the body never closes hides - a fence,
   an HTML block of type 1 or 3 to 5, a comment, a reopened comment, or a comment cut off where
   its block ends - that block is named: a header in the body before one in a footnote definition,
   which is named as one GitHub shows below the body; below a cut-off comment, the first header
   below the cut (F3). A header hidden by a comment a footnote definition leaves open is not
   named here, as the body ends inside no block; the writer names it (ADR-0204). The table's rows
   are the
   lines GitHub reads as its rows
   (`rowOf`); the line that ends them, when GitHub shows it apart from the table - at a column
   where the item or footnote holding the table ends, indented 4 past it, after a carriage return
   alone, or holding no cell - is named once, with why, and the rows run on below it are its
   consequence.
6. **Not followed, and named here.** Eight shapes are read more strictly than GitHub shows them,
   so a project is blocked, or a row refused, that GitHub would show: a table inside a block
   quote, whose lines start with `>`, which the header search does not take (the writer refuses
   beside it, ADR-0204); what follows a comment cut off where its block ends, hidden to the end of
   the file, where the browser shows text again after the next raw `-->`; the rows below a line
   of prose straight below a table, which GitHub reads as one more row and which ends the table
   here; a reopened comment, closed only by a `-->` in an HTML block, where the browser also
   closes it at an inline comment in a paragraph, which GitHub writes as it stands (F3); a
   comment the body leaves open, which hides every footnote definition, where the browser shows
   text again after a raw `-->` in one; a comment a footnote definition leaves open, which hides
   all GitHub shows after it, past such a `-->` too; a footnote definition the body's reopened
   comment reaches in the file, hidden though the body closes the comment further down, where
   GitHub shows the definition below the body; and a `[^label]` followed by `(`, no reference
   here, where GitHub reads one unless a link follows (a `(` with no link after it leaves it
   one), so a definition it shows may be left out. One errs the other way: a `[^label]` in a link's
   destination, a bare URL or a link reference definition is a reference here and on GitHub is
   none, so a definition GitHub leaves out is read, with any table in it - modelling it needs
   GitHub's inline link and autolink parse, for a shape that needs an archived table referred to
   only from inside a URL. Three are not modelled: link reference definitions, read as a
   paragraph's text; the rows of an HTML block of type 1, skipped by the stray-row scan though the
   browser shows a `<pre>`'s; and a second table with the header, also shown (ADR-0204).

## Rejected alternatives

- **The review's smallest fix: the raw line, and a line indented 4 or more after a blank line
  opens nothing, outside list items.** Without the items' content columns, a fence written inside
  a list item - its lines indented 2 or 3, its content more - is either not seen, and the
  archived copy in it that trimmed lines did hide (the review's case 01) is read again, or every
  4-column line in an item is taken as code. The columns make both right, and the same machinery
  closes finding 4's list-marker shapes.
- **Keep trimming, and strip list markers before looking for an opener** (the review's 4a).
  It mends `- <!--` and `` 1. ``` `` and nothing else: an indented example still opens a fence,
  which is finding 3.
- **A Markdown parser as a dependency** (markdown-it, micromark, cmark-gfm's bindings). The kit is
  plain Node with no dependencies and no `package.json` (`fetchproof/README.md`), so the reading
  ports the block rules of the parser GitHub runs instead. And no parser models what GitHub's
  sanitizer and the browser do with a comment left open, so that rule would stay ours.
- **Hide every line indented 4 or more.** A line indented four in an open paragraph, or in a list
  item whose content starts at column 4, is shown as text on GitHub, not as code.
- **Narrow F01's words and list the shapes as residuals** (the review's alternative to 4). It
  leaves the false PASS of an indented comment example, which F01 introduced, and correct
  projects blocked.
- **End a list item at any line indented less than its content** (this ADR's first version).
  GitHub continues the item's paragraph with such a line when it starts no block, so a table
  indented in the item, which GitHub shows, was read as code (the re-review's finding 4).
- **Take a line holding a `|` as a table's, never lazy** (the first version of the lazy rule).
  GitHub continues a paragraph with `a | b` when no delimiter row follows it, and makes a table of
  a paragraph line with a delimiter row below it that holds no pipe (`:--`): keyed on the pipe,
  the reader hid text GitHub shows, and read lazily past a table at which GitHub ends the item.
  The delimiter row decides, as in GFM.
- **Keep the safe way, and take it for more shapes** (the 9b9afaa re-review's second option).
  An item ended where GitHub keeps it lets a comment or a fence at its column be read as text,
  so the safe way read tables GitHub hides (F-A); it still read tables GitHub makes none of
  (F-B), and blocked tables GitHub shows. Read by cmark-gfm's own rules, no shape is left to take
  a way about.
- **Strip one carriage return from the end of each line.** A carriage return alone inside a line
  still ends a line on GitHub, so a fence or a row after it would still be read as more of the
  line before it.
- **Hide a cut-off comment only to its next raw `-->`, as the browser does.** Which `-->` reaches
  GitHub's page raw depends on its inline parsing - one in a paragraph is escaped, one in an HTML
  block or inline HTML is not - which this reading does not model. Hidden to the end of the
  file, a table the browser may show is refused, and none it hides is read.
- **Close a reopened comment at any `-->`, as before; or at an inline comment in a paragraph too,
  as the browser does.** The first read the archived copy below a `-->` GitHub escapes (F3). The
  second needs the inline parse - code spans, backslash escapes, which comments are valid inline
  HTML - that this reading does not do. Closed only by an HTML block's `-->`, a table the browser
  shows may be refused, and none it hides is read.
- **Hide every footnote definition once a comment is left open anywhere** (the simpler fix the
  re-review of 116a2a3 offered for finding 1). A comment a definition leaves open hides only what
  GitHub shows after it, and nothing of the body; hidden as well, the body's table and a
  definition GitHub shows before it, whole on its renderer, would block a contract GitHub shows.

## Consequences

- The header search, the stray scan, the section heading and the writer are judged by one
  reading, so a table is hidden or shown wherever it stands by the same rule.
- The residuals of decision 6 remain, each named with the way it errs.
- Each rule the re-reviews raised was checked on GitHub's own renderer (`gh api markdown`): 22
  synthetic cases on 2026-11-06 - an empty item before a blank line, `===` and `--` under a
  paragraph, lazy lines of text, of `===`, of `:--`, of `>`, `#` and `[^x]:`, delimiter rows with
  pipes and without, a byte-order mark before a comment - and 55 on 2026-11-07: lazy lines led by
  an autolink, inline code or a tag; the HTML block types, their tags and their ends; footnote
  definitions, referenced and not, and what they hold; a carriage return alone; comments and
  other HTML blocks cut off by their item; the lines that end a table. For the re-review of
  116a2a3, the same day: comments left open, cut off and reopened in the body and in footnote
  definitions shown before and after one another; `[^label]` in code spans, comments, tags,
  processing instructions, autolinks, links, bare URLs, link reference definitions, headings and
  table cells, escaped or not, and followed by `(`; nested definitions both referred to; and the
  shapes of a table the header search passes over. Where the reader departs from it, decision 6
  names the departure.
- The reading is linear in the file. Each line is read once; a line left blank by its containers'
  prefixes finds the containers it ends by a binary search over two lists kept as they open, not
  by walking each; `isSeparator` reads a line in one pass; and the stray-row scan finds once where
  the rows run on below a named line end; a line of nested footnote definitions is marked once,
  in one sweep over the definitions as they nest, with the innermost (F4, finding 4); and a
  paragraph's references are found in one pass, a code span's closer by a pointer kept for each
  length of backtick run, a quote's and a `-->`'s next place remembered. 40,000 markers on a line
  with 40,000 lazy lines below, 40,000 characters of a delimiter row's, 16,000 rows below a line
  that ended the table, a tag of 50,000 attributes, 7,200 nested footnote definitions over
  200,000 lines, and a paragraph of 4,000 backtick runs or of 100,000 to 200,000 comments, tags
  or labels never closed are each read within the tests' 2 s bound.
- `open`, `heads` and `tables` let the writer refuse a row that would be hidden, left in a table
  GitHub does not show, or written beside one it shows that the reader does not read (ADR-0204).

## Trigger to revisit

- A table GitHub shows is reported missing, or one it hides is read, in a shape decision 6 does
  not name: model that shape, or name it there.
- GitHub renders with another cmark-gfm release, or another parser, whose block or table rules
  differ. The sixth HTML type's tags (`source` among them, `search` not) and a fourth type opened
  only by `<!` and an uppercase letter are read as GitHub's cmark-gfm reads them on 2026-11-07,
  not as the newest CommonMark does.
- GitHub changes how it renders a comment left open.
