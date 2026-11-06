# ADR-0203 — Which lines GitHub shows as code or hides is read in columns, inside list items

- **Date:** 2026-11-06
- **Status:** accepted
- **Area:** `fetchproof/lib/corpus.mjs` (`hiddenLines`, `parseTable`)
- **Prompted by:** the fresh-eyes review of PR #441 (2026-11-06), findings 3 and 4, and the
  re-review of its fix (2026-11-06), findings 1-5
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

## Decision

1. **One pass over the raw lines, `hiddenLines(lines)`,** says for each line whether GitHub shows
   it as code or hides it - `{ kind: 'fence' | 'comment' | 'indented', line }`, naming the line
   that opened it - and `open`, the fence or comment a document ends inside. The header search,
   the stray-row scan and the search for the heading above a table all ask it.
2. **CommonMark's block rules, in columns** (a tab to the next multiple of 4), each line measured
   from the content column of the list items it stays inside:
   - a list item opens at `-`, `+`, `*`, or 1-9 digits and `.` or `)`, indented 0-3 and followed
     by a space, a tab or the line's end, unless the line is a thematic break; its content starts
     after 1-4 columns of space (after one, when there are 5 or more or none); a non-blank line
     indented less than an item's content ends the item, and a fence in it, unless it is a lazy
     continuation line: the next line of a paragraph in the item that starts no block - a
     thematic break, a list item, a block quote, an ATX heading, a fence, a footnote definition
     (`[^label]:`), a line led by `<` (decision 5) - at its indentation in the container it would
     fall back to; a paragraph line above a table's delimiter row - cells of `-` with an optional
     `:` at either end, between pipes or with none (`:--`) - is the table's header, and a table
     has no lazy continuation line; an item opened on an empty line ends at a blank line whose
     spaces stop short of its content, unless a line has gone into it first; an item that is
     empty, or ordered from a number other than 1, does not interrupt a paragraph;
   - a fence opens at three or more backticks or tildes indented 0-3 (a backtick fence's info
     string holds no backtick), closes at a run of its own character at least as long, indented
     0-3, with nothing after it, and never closed runs to the end of its container;
   - a line indented 4 or more opens nothing: it is indented code when no paragraph is open, and
     the paragraph's next line when one is; a run of `=` or of `-` under a paragraph, indented
     0-3, makes it a heading and ends it, so a line indented 4 below it is code;
   - an HTML comment opens at `<!--` where a line's content starts, after a list marker too, and
     runs to the line holding its `-->`, whatever the indentation between; a `<!--` after that
     `-->` reopens it; `<!-->` and `<!--->` close as they open;
   - a byte-order mark at the start of the file is not the first line's content.
3. **A table in indented code is not the table.** GitHub shows it as code. It was read before F01
   and after it, and below an item a blank line ended or a heading's underline until the
   re-review.
4. **A heading in a code block or a comment heads no section.** Taken as one, a `# example` in a
   fence above the table set the section the stray-row scan runs to.
5. **Not read, and named in the function's comment:** a block quote's own blocks, HTML blocks
   other than comments, footnote definitions - which GitHub leaves out, with all they hold, when
   nothing refers to them - a `<!--` after other text on its line, and a `-->` GitHub escapes
   inside a reopened comment. A table there is taken as shown. **Taken the safe way:** a line led
   by `<`, or by three backticks or tildes, is not lazy, though GitHub can read it as a
   paragraph's text; neither is a line after a paragraph line led by `<`, which can make the
   paragraph an HTML block, nor one after a delimiter row whose header has another number of
   cells, which makes no table. The item ends there where GitHub may keep it, so a table GitHub
   shows in such an item can be read as hidden: the project is blocked, or the row refused,
   rather than passed - unless a second table with the header, also shown, stands below it,
   which is then read (the two-tables residual, ADR-0204).

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
- **A Markdown parser** (markdown-it, micromark, cmark-gfm). The kit is plain Node with no
  dependencies and no `package.json` (`fetchproof/README.md`). And no parser models what GitHub's
  sanitizer does with a reopened comment, so that rule would stay ours.
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

## Consequences

- The header search, the stray scan and the section heading are judged by one reading, so a table
  is hidden or shown wherever it stands by the same rule.
- The residuals of decision 5 remain. A shape not read is one GitHub renders that this reading
  does not model, so a table kept in one is read as if shown - a table in a footnote nothing
  refers to among them, as on `main`; a shape taken the safe way ends an item GitHub may keep.
- Each rule the re-review raised was checked on GitHub's own renderer (`gh api markdown`, 22
  synthetic cases, 2026-11-06): an empty item before a blank line, with and without spaces that
  reach its content; `===` and `--` under a paragraph; lazy lines of text, of `===`, of `:--`,
  of `>`, `#` and `[^x]:`; delimiter rows with pipes and without; a byte-order mark before a
  comment. Where the reader departs from it, decision 5 names the departure.
- The reading is linear in the file: a line's thematic-break test is asked once (`breakSpan`),
  and the item a lazy line falls back to is found by a binary search over the open items'
  columns (`baseAt`). 40,000 markers on a line, with 40,000 lazy lines below, are read within
  the test's 2 s bound, where the markers alone had taken 18-23 s.
- `open` lets a writer refuse to append into a table that a fence or comment hides to the end of
  the file (the next fix on this branch).

## Trigger to revisit

- A table GitHub shows is reported missing, or one it hides is read, in a shape decision 5 does
  not name: model that shape, or name it there.
- GitHub changes how it renders a reopened comment or a list item's fence.
