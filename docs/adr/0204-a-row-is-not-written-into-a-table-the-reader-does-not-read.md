# ADR-0204 — A row is not written into a table the reader does not read

- **Date:** 2026-11-06
- **Status:** accepted
- **Area:** `fetchproof/lib/corpus.mjs` (`appendRow`, the new `tableHidden` and
  `assertTablesWritable`, `headerAt` factored out of `parseTable`), `fetchproof/lib/collect.mjs`
  (`collectOne`), `fetchproof/lib/research-run.mjs` and `fetchproof/lib/decompose.mjs` (the checks
  before anything is spent), `fetchproof/lib/core.mjs` (`NAMED_RUN_REFUSALS`),
  `fetchproof/bin/decompose.mjs` (its answer to a named refusal), `fetchproof/lib/auto-collect.mjs`
  (`collect`)
- **Prompted by:** the fresh-eyes review of PR #441 (2026-11-06), finding 1, and the re-review of
  its fix (2026-11-06), finding 6
- **Extends:** ADR-0203 (which lines GitHub shows as code or hides), ADR-0122 (a collection that
  cannot be recorded is refused before the money)
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

## Decision

1. **`appendRow` refuses, and writes nothing,** when it finds no table the reader reads and either
   the document ends inside a fence or a comment (a table written at its end would be inside it),
   or a table with this header stands on hidden lines and holds rows (the rows it would continue
   are hidden, and a second table would split them). `tableHidden(text, header)` says which; the
   error's code is `TABLE_HIDDEN`, and its message names the file, what hides the table, the line
   that opened it, and the remedy: close the fence or comment, or move the table out of it.
2. **A hidden header with no rows is left alone:** an example of the table's header, commented
   out, holds nothing a new table would orphan, and the new table is read.
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

## Rejected alternatives

- **Close the open region, then append** (write the missing fence or `-->` at the end). It edits
  the structure of a file the operator wrote, and when the forgotten fence was around the real
  table, the table stays hidden with its rows while a new one starts beside it - the split this
  refusal exists to prevent, made silent.
- **Append and warn.** The row would still be hidden from every reader, and its id would still be
  one the file holds; a warning in a run's log is not read by the builder who cites the id.
- **`nextId` over every id in the file, hidden or not** (the review's option). It stops the
  duplicate ids, not the hidden rows; with the writer refusing, no row is appended that it would
  number.
- **Refuse any hidden header, rows or not** (the review's smallest fix). A commented-out example of
  the header loses nothing, and refusing it would block a file the reader reads correctly.
- **Refuse only in the writer, after the fetch.** The credits are spent and the capture stays on
  disk with no row; a re-run serves it from the cache and the row is never written.
- **Refuse only under the lock, in `collectOne`.** It is before each fetch, but not before the
  run's searches: phase 0 made four searches and a fetch on a damaged ledger before `collectOne`
  threw (ADR-0122's finding), and a run's queries are searched before its pages are fetched.

## Consequences

- A collection into a file whose table is hidden stops before it spends, with the line to fix.
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
