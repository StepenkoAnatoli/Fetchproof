# ADR-0203 — Which lines GitHub shows as code or hides is read in columns, inside list items

- **Date:** 2026-11-06 (amended 2026-11-07)
- **Status:** accepted
- **Area:** `fetchproof/lib/corpus.mjs` (`hiddenLines`, `parseTable`, `notATable`, `tableHidden`)
- **Prompted by:** the fresh-eyes review of PR #441 (2026-11-06), findings 3 and 4, the
  re-review of its fix (2026-11-06), findings 1-5, and the re-review of 9b9afaa (2026-11-07),
  findings F-A to F-E and N1
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

## Decision

1. **One pass over the raw lines, `hiddenLines(lines)`,** returns, line by line: `at`, the block
   that hides a line - `{ kind: 'fence' | 'indented' | 'comment' | 'html' (with its `type`) |
   'footnote', line }`, naming the line that opened it; `open`, a fence or a comment the document
   ends inside, or a comment cut off where the block holding it ends (`runaway`); `heads`, whether
   GitHub makes a table of a header there, or why not; `rowOf`, the table a line is a row of;
   `segs`, how many lines GitHub reads in it; and `endWhy`, why a table ended there. The header
   search, the stray-row scan, the search for the heading above a table and the writer
   (ADR-0204) all ask it.
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
     which keeps it open to the next raw `-->`, and a comment cut off where its container ends
     (N1) hides the rest of the file;
   - a footnote definition nothing refers to - no `[^label]`, matched without regard to case, on
     a line GitHub shows - is left out, with all it holds.
3. **A table in indented code is not the table.** GitHub shows it as code. It was read before F01
   and after it, and below an item a blank line ended or a heading's underline until the
   re-review.
4. **A heading in a code block or a comment heads no section.** Taken as one, a `# example` in a
   fence above the table set the section the stray-row scan runs to.
5. **A header GitHub makes no table of is not the table, and is named with why.** The header the
   reader takes is the first with the table's columns that GitHub makes a table of, outside a
   block that hides it. With none, the first such header GitHub makes no table of is a
   `table-split` problem, with the reason and the remedy: its header and delimiter row are lazy
   lines below a list item's paragraph or a block quote's; its delimiter row is indented 4 past
   the header; GitHub does not read the delimiter row; an earlier delimiter row in the paragraph
   had another number of cells, or this one has; a carriage return alone stands in either line;
   or it stands straight below another table's rows, of which GitHub makes it one more. The
   writer refuses in the same words (`notATable`, ADR-0204). With no header but one a cut-off
   comment hides, the cut is named. The table's rows are the lines GitHub reads as its rows
   (`rowOf`); the line that ends them, when GitHub shows it apart from the table - at a column
   where the item or footnote holding the table ends, indented 4 past it, after a carriage return
   alone, or holding no cell - is named once, with why, and the rows run on below it are its
   consequence.
6. **Not followed, and named here.** Three shapes are read more strictly than GitHub shows them,
   so a project is blocked, or a row refused, that GitHub would show: a table inside a block
   quote, whose lines start with `>`, which the header search does not take; what follows a
   comment cut off where its block ends, hidden to the end of the file, where the browser shows
   text again after the next raw `-->`; and the rows below a line of prose straight below a table,
   which GitHub reads as one more row and which ends the table here. Four are not modelled: link
   reference definitions, read as a paragraph's text; a comment cut off inside a footnote
   definition, which GitHub moves to the end of the page; the rows of an HTML block of type 1,
   skipped by the stray-row scan though the browser shows a `<pre>`'s; and a second table with
   the header, also shown (ADR-0204).

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
  other HTML blocks cut off by their item; the lines that end a table. Where the reader departs
  from it, decision 6 names the departure.
- The reading is linear in the file. Each line is read once; a line left blank by its containers'
  prefixes finds the containers it ends by a binary search over two lists kept as they open, not
  by walking each; `isSeparator` reads a line in one pass; and the stray-row scan finds once where
  the rows run on below a named line end. 40,000 markers on a line with 40,000 lazy lines below,
  40,000 characters of a delimiter row's, 16,000 rows below a line that ended the table, and a
  tag of 50,000 attributes are each read within the tests' 2 s bound.
- `open` and `heads` let the writer refuse a row that would be hidden, or left in a table GitHub
  does not show (ADR-0204).

## Trigger to revisit

- A table GitHub shows is reported missing, or one it hides is read, in a shape decision 6 does
  not name: model that shape, or name it there.
- GitHub renders with another cmark-gfm release, or another parser, whose block or table rules
  differ. The sixth HTML type's tags (`source` among them, `search` not) and a fourth type opened
  only by `<!` and an uppercase letter are read as GitHub's cmark-gfm reads them on 2026-11-07,
  not as the newest CommonMark does.
- GitHub changes how it renders a comment left open.
