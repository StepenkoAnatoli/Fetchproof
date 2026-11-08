# ADR-0204 — A row is not written into a table the reader does not read

- **Date:** 2026-11-06 (amended 2026-11-07 and 2026-11-08)
- **Status:** accepted
- **Area:** `fetchproof/lib/corpus.mjs` (`appendRow` and `upsertRow`, the new `tableHidden`,
  `notATable` and `assertTablesWritable`, `headerAt` factored out of `parseTable`, `escapeCell`,
  `appendChecked`),
  `fetchproof/lib/collect.mjs`
  (`collectOne`), `fetchproof/lib/research-run.mjs` and `fetchproof/lib/decompose.mjs` (the checks
  before anything is spent, and the map a dry run keeps), `fetchproof/lib/core.mjs`
  (`NAMED_RUN_REFUSALS`), `fetchproof/bin/decompose.mjs` (its answer to a named refusal),
  `fetchproof/lib/auto-collect.mjs` (`collect`), `fetchproof/lib/requests.mjs` (`applyRequest`)
- **Prompted by:** the fresh-eyes review of PR #441 (2026-11-06), finding 1, the re-review of its
  fix (2026-11-06), finding 6, the re-review of 9b9afaa (2026-11-07), findings F-A, F-B and N1,
  the re-review of 88fe19a (2026-11-07), finding F1, the re-review of 116a2a3 (2026-11-07),
  findings 1, 2 and 5, the re-review of dde656a (2026-11-07), findings F-1, F-5 and F-6, and
  the re-review of 50b18d1 (2026-11-08), findings G-1 and G-5
- **Extends:** ADR-0203 (which lines GitHub shows as code or hides, and which headers it makes a
  table of), ADR-0122 (a collection that cannot be recorded is refused before the money)
- **Freeze (ADR-0117):** a bug fix. Since F01 the writer appended where no reader reads, and issued
  ids the file already held. The one new word is the refusal's code, which the named-refusal set
  needs so that the entry points answer it with its message and exit 2 rather than a stack.

## Context

F01 taught the header search to skip what GitHub shows as code or hides, and `appendRow` asks the
reader where the table is. With a fence or a comment above the table never closed - a pasted
command whose closing fence was forgotten - the reader finds no table, so the writer wrote a new
header, separator and row at the end of the file, still inside the unclosed region, and `nextId`,
counting the rows it could see, issued E-01 again on every run. The collector reports that id to
the builder, who cites it; once the fence is closed, the first table is read, the appended ones are
not, and every citation of the new E-01 resolves to the old E-01, another page (review of #441,
finding 1; `collect.mjs` names the harm itself: "a duplicated E-## silently changes what every
citation to it means"). `requests.mjs` appends an OPEN unknown to `DISCOVERY.md` the same way, and
`upsertRow` appends a source to `SOURCES.md` through `appendRow`.

The re-review of 9b9afaa (2026-11-07) found the writer following the reader's errors: where the
reader took an archived copy GitHub hides for the table, `appendRow` wrote into it (F-A), and a
header GitHub makes no table of was read, and written below (F-B). Found while fixing F-B: a row
appended to a table indented in a list item went in at column 0, where GitHub shows it after the
item, as text, and the reader, reading as GitHub does, no longer takes it as a row. And a comment
cut off where its item ends leaves the rest of the file hidden in the browser (N1), a table
started below it with it.

The re-review of 88fe19a (2026-11-07, F1) found the writer numbering past where the reader stops.
Where the reader found the table but stopped above rows GitHub still shows - a row at the column
where the item holding the table ends, indented 4 past it, holding a carriage return alone, or
below a blank line - `nextId` counted the rows above the stop and `appendRow` placed the new row
among them: a second U-2 or E-02 beside the one no check read. And `escapeCell` wrote a carriage
return alone into a cell, which GitHub reads as a line end: a fetched page title holding one split
the sources table it was written to, and a request's fact the contract. `decompose`'s dry run took
a map whose first row held one for the empty template, and wrote over it.

The re-review of 116a2a3 (2026-11-07) found the writer starting a second table beside one GitHub
shows (finding 2). A table whose header has no outer pipes, stands in a block quote, or whose lines
end with a carriage return alone is a table on GitHub, but the header search, which takes a header
by its leading pipe over a separator, passes it over: finding none, `appendRow` started a table at
the end of the file and numbered from U-1 or E-01 again, beside the rows GitHub shows first. Found
while fixing it: a header on the line of a list item's marker or a footnote definition's label is
passed over too. Where the reader took a table GitHub hides, in a footnote definition below a
comment the body leaves open, the writer wrote into it (finding 1, read as GitHub reads it by
ADR-0203); and a file that ends inside a `<pre>` or a `<script>` never closed took the new table
inside it (finding 5).

The re-review of dde656a (2026-11-07) found the writer writing below a table GitHub shows second
(F-1). A table the header search passes over was refused beside only where no table was read; with
an archived copy of the header further down, the reader read the copy, and the writer numbered
from the copy's rows and wrote below them, while GitHub showed the unread table first. A file whose
lines a carriage return alone ends was refused as one whose table GitHub shows, where GitHub hid
it, and the remedy led to another refusal (F-5). And `upsertRow` of a new key read the file and
judged it twice (F-6). Found while fixing them (ADR-0203, decisions 7 and 8): a reference whose
label holds an entity name the kit does not know, and a table a tag or a comment hides that GitHub
may close earlier, or one an HTML block above it may leave open on GitHub alone, cannot be judged.
A row written then may go to a table GitHub hides, or beside one it shows.

## Decision

1. **`appendRow` refuses, and writes nothing,** when it finds no table the reader reads and either
   the body ends inside a block never closed - a fence, an HTML block of type 1 or 3 to 5
   (`<pre>`, `<script>`, `<?`, `<![CDATA[` and the like), a comment, or a comment cut off where
   the block holding it ends, which GitHub leaves open to the end of the file - so that a table
   written at its end would be in it; or a table with this header that GitHub does not show as one
   holds rows, which a second table would leave unread and number again: one on lines GitHub
   shows as code or hides (a fence, a comment, indented code, an HTML block, a footnote definition
   nothing refers to, or that repeats the label of one GitHub keeps, or one a comment hides that a
   footnote definition leaves open - named with that definition), or over a delimiter row GitHub
   makes no table of (`not-a-table`, with the reason of ADR-0203's decision 5); or a table GitHub
   shows with this header that the header search passes over - its header without outer pipes,
   in a block quote, or on the line of a list item's marker or a footnote definition's label, or
   its lines ended by a carriage return alone (`unread`, with the shape) - rows or none, which a
   new table would stand beside, numbering its own from the first id again. `tableHidden(text,
   header)` says which, reading the file once with the reader; the error's code is
   `TABLE_HIDDEN`, and its message names the file, what hides the table, why GitHub makes none of
   it or why no check reads the one it shows, the line, and the remedy: close the block, move the
   table out of it, the remedy the reader names for that reason, in the reader's words
   (`notATable`), or the shape to write the table in.
2. **A header with no rows is left alone,** hidden or made no table of: an example of the table's
   header, commented out, holds nothing a new table would orphan, and the new table is read. A
   table GitHub shows is not left alone (decision 1): a new one would stand beside it on the page.
3. **Before anything is spent,** `runResearch` and `decompose` ask the same of
   `research/EVIDENCE.md` and `research/SOURCES.md` (`assertTablesWritable`), beside
   `assertAppendable`, dry runs too; auto-collect's `collect` asks before it reserves a request's
   pages, applies the request or runs research; and `collectOne` asks again under the lock, before
   its fetch, as `appendFetch` asks again of the ledger, so a file changed during a run is refused
   before the next page is paid for. A refusal by the writer alone comes after the fetch: the capture and its
   ledger entry stay on disk with no row, and the next run takes the capture as a cache hit and
   never writes the row.
4. **`TABLE_HIDDEN` is a named run refusal:** `research.mjs` answers it with its message and exit 2,
   as it answers a broken ledger. `decompose.mjs` now answers the named refusals the same way; it
   re-threw them - a broken or torn ledger, a held lock - as a stack trace and exit 1,
   which the kit reserves for FAIL (found while fixing this; older).
5. **A row is written at the indentation of the row it follows, or replaces.** A table in a list
   item holds the lines that reach the item's content column: `appendRow` gives its row the
   leading whitespace of the line it is written below, the table's last row or its separator, and
   `upsertRow` keeps that of the row it replaces. Both return the row without it, as before.
6. **Nor into a table the reader does not read whole.** Where the reader finds the table and
   names a `table-split` in it - a line that ended the table above rows GitHub shows, a row below
   a blank line, a malformed separator - `appendRow` and `upsertRow` refuse (`kind: 'split'`),
   with the table's line, the line named and the reader's words, and write nothing; so does
   `assertTablesWritable`. `applyRequest` asks it of the unknowns table in `DISCOVERY.md` before
   it writes a row or a plan, for a request naming its unknown too. A dry run of `decompose` counts
   such a map as drafted, and leaves it.
7. **A cell is written on one line:** `escapeCell` writes LF, CR LF and a carriage return alone
   as a space.
8. **Refused as well, whether or not the reader reads a table,** in this order (re-review of
   dde656a):
   - `uncertain`: a reference whose label holds an entity name the kit does not know, where the
     table is looked for among the footnotes (ADR-0203, decision 7), with the remedy: write the
     character itself or a numeric reference;
   - `unread`: a table GitHub shows with this header that the header search passes over, before
     the one read (`before`) or anywhere when none is read - a row written to the one read goes to
     the table GitHub shows second, and may repeat an id the first holds (F-1); and, wherever it
     stands, one whose lines a carriage return alone ends, which no check can place - named as one
     that cannot be judged, never as one GitHub shows (F-5);
   - `doubt`: a table with this header that no check can tell GitHub shows or hides (ADR-0203,
     decision 8), before the one read (`before`), that one itself (`same`), where the row could go
     to a table GitHub hides, or anywhere when none is read; the tag or the comment is named, with
     the remedy: close it inside its block, or write inline HTML in a code span or escape its `<`;
     and, with none read, the end of the file, where the table would be started, past what leaves
     the body in doubt (`end`; ADR-0203, decision 8; G-1, G-5).
9. **A write reads the file once.** `upsertRow` of a new key appends with the text and the
   reader's table it already holds (`appendChecked`), where it read the file and judged it again
   (F-6).

## Rejected alternatives

- **Close the open region, then append** (write the missing fence or `-->` at the end). It edits
  the structure of a file the operator wrote, and when the forgotten fence was around the real
  table, the table stays hidden with its rows while a new one starts beside it - the split this
  refusal exists to prevent, made silent.
- **Append and warn.** The row would still be hidden from every reader, and its id would still be
  one the file holds; a warning in a run's log is not read by the builder who cites the id.
- **`nextId` over every id in the file, hidden or not** (the review's option). It stops the
  duplicate ids, not the hidden rows; with the writer refusing, no row is appended that it would
  number - hidden, or below where the reader stops (F1). Numbered past them, the row would still
  go among the rows above the stop, and those below it stay unread by every check.
- **Refuse a request whose fact or reason holds a line end** (`requestProblems`). With
  `escapeCell` writing any line end as a space, the contract can hold such a request; refusing it
  would turn away a fact the kit can record.
- **Refuse any hidden header, rows or not** (the review's smallest fix). A commented-out example of
  the header loses nothing, and refusing it would block a file the reader reads correctly.
- **Refuse only in the writer, after the fetch.** The credits are spent and the capture stays on
  disk with no row; a re-run serves it from the cache and the row is never written.
- **Indent a row to the content column of the item holding the table**, computed from the
  containers `hiddenLines` opens. The row above it is one the reader read, so its indentation
  already reaches every container the table stands in; computed again, the column would be a
  second reading of what the first one settled.
- **Refuse only under the lock, in `collectOne`.** It is before each fetch, but not before the
  run's searches: phase 0 made four searches and a fetch on a damaged ledger before `collectOne`
  threw (ADR-0122's finding), and a run's queries are searched before its pages are fetched.
- **Read the tables the header search passes over** (the other option the re-review of 116a2a3
  named for finding 2: let `headerAt` take a header without outer pipes). The header search, the
  stray-row scan and both writers find a row by its leading pipe at the table's column and write
  one the same way; reading a quoted table means writing `> ` into its rows, and a file of lone
  carriage returns means writing its line ends - each a new way of writing the corpus, which the
  freeze reads as a feature (ADR-0117). Refused with the shape to fix, the table is rewritten in
  the one every reader reads.
- **Refuse beside such a table only when it holds rows,** as for a hidden one (decision 2). A
  hidden header without rows is not on the page; a table GitHub shows is, and a new table at the
  end of the file would be the second the page shows, its first rows written where none is read.
- **Refuse beside a table the header search passes over only where no table is read** (decision
  1 as first written). With a table read below it, the row went to that one, which GitHub shows
  second, and could repeat an id the first holds (F-1).

## Consequences

- A collection into a file whose table is hidden stops before it spends, with the line to fix;
  so does one into a file whose table GitHub makes none of, or that a cut-off comment hides, with
  the reason the reader names.
- A row appended to a table in a list item stays in it.
- A write into a table the reader stops in - evidence, sources, the contract, the map's dry run -
  is refused, or left, with the line to fix.
- A request auto-collect applies is refused - a `refused` result, committed and pushed - before it
  reserves pages, writes the request into `DISCOVERY.md` or runs research, when the evidence or
  sources table is hidden; and by the writer, before the request's plan is written, when the
  unknowns table in `DISCOVERY.md` is. `research.mjs` refused the first too, but only after
  auto-collect had reserved the pages, and with no accounting to settle them by: the pages were
  charged, the queue paused, and the request went back as failed (the re-review's finding 6).
- A second, visible table with the same header is still not read (the F01 residual, unchanged),
  but no table is started beside one GitHub shows that the header search passes over.
- `decompose.mjs` exits 2 with the message on every named refusal, where it printed a stack.
- No row is written below the table the checks read while GitHub shows another first, or may hide
  the one read; the refusal names the line and the remedy, and a correct file in doubt is refused
  until it is edited (ADR-0203, decision 8).

## Trigger to revisit

- A legitimate document is refused: a hidden table with rows that is meant to stay hidden while a
  new visible one is started.
