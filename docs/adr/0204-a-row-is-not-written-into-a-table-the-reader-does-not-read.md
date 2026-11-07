# ADR-0204 — A row is not written into a table the reader does not read

- **Date:** 2026-11-06 (amended 2026-11-07)
- **Status:** accepted
- **Area:** `fetchproof/lib/corpus.mjs` (`appendRow` and `upsertRow`, the new `tableHidden`,
  `notATable` and `assertTablesWritable`, `headerAt` factored out of `parseTable`, `escapeCell`),
  `fetchproof/lib/collect.mjs`
  (`collectOne`), `fetchproof/lib/research-run.mjs` and `fetchproof/lib/decompose.mjs` (the checks
  before anything is spent, and the map a dry run keeps), `fetchproof/lib/core.mjs`
  (`NAMED_RUN_REFUSALS`), `fetchproof/bin/decompose.mjs` (its answer to a named refusal),
  `fetchproof/lib/auto-collect.mjs` (`collect`), `fetchproof/lib/requests.mjs` (`applyRequest`)
- **Prompted by:** the fresh-eyes review of PR #441 (2026-11-06), finding 1, the re-review of its
  fix (2026-11-06), finding 6, the re-review of 9b9afaa (2026-11-07), findings F-A, F-B and N1, and
  the re-review of 88fe19a (2026-11-07), finding F1
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

## Decision

1. **`appendRow` refuses, and writes nothing,** when it finds no table the reader reads and either
   the document ends inside a block never closed - a fence, a comment, or a comment cut off where
   the block holding it ends, which GitHub leaves open to the end of the file - so that a table
   written at its end would be hidden with it; or a table with this header that GitHub does not
   show as one holds rows, which a second table would leave unread and number again: one on lines
   GitHub shows as code or hides (a fence, a comment, indented code, an HTML block, a footnote
   definition nothing refers to, or that repeats the label of one GitHub keeps), or over a
   delimiter row GitHub makes no table of (`not-a-table`, with the reason of ADR-0203's decision
   5). `tableHidden(text, header)` says which; the error's
   code is `TABLE_HIDDEN`, and its message names the file, what hides the table or why GitHub
   makes none of it, the line, and the remedy: close the block, move the table out of it, or the
   remedy the reader names for that reason, in the reader's words (`notATable`).
2. **A header with no rows is left alone,** hidden or made no table of: an example of the table's
   header, commented out, holds nothing a new table would orphan, and the new table is read.
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
- A second, visible table with the same header is still not read (the F01 residual, unchanged).
- `decompose.mjs` exits 2 with the message on every named refusal, where it printed a stack.

## Trigger to revisit

- A legitimate document is refused: a hidden table with rows that is meant to stay hidden while a
  new visible one is started.
