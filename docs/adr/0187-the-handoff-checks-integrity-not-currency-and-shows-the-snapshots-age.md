# ADR-0187 — The handoff checks integrity, not currency, and shows the snapshot's age

- **Date:** 2026-10-20
- **Status:** accepted
- **Area:** `fetchproof/lib/handoff.mjs` (`verifyHandoff`, the report's `fetched`),
  `fetchproof/bin/handoff.mjs` (the `handoff OK` line), `fetchproof/lib/checks.mjs`
  (`freshnessDay`, now exported; `supersededRows`, now also read by the handoff), the README's
  builder section, the `freshness-recheck` skill
- **Prompted by:** discussion #413 (comment of 2026-10-17)
- **Lifts the freeze (ADR-0117)** for one item: the capture date range on the `handoff OK`
  line, and the `fetched` field of the report the line is printed from. Unrelated work stays
  frozen.

## Context

The comment on discussion #413 asked that a handoff let the next agent tell a current
citation from a consistent but stale snapshot. An offline spike on main (cd11b49, a local HTTP
server, the `http-keyless` transport, temporary machine configs) collected a page saying "10
requests per minute", closed an unknown on it, and then changed the page to "2 requests per
minute":

- on the builder, `handoff.mjs` still said `handoff OK ... chain verifies` with exit 0, and
  preflight passed. The brief showed the old claim with no fetch date;
- on the collector, `research.mjs --refresh-days 0` re-collected nothing, because a capture
  made today is not older than 0 days; `--force` collected the new text as E-02, and the gate
  then failed with `evidence-supersession/cites-superseded-row` (E-01 to E-02) until the
  citation moved (ADR-0026).

So the kit does not confuse stale with current. These are two questions. Is the snapshot
consistent? The handoff answers that, correctly (ADR-0011). Is it current? Nothing on a builder
can answer that, because a builder cannot fetch. The gap was narrower: nothing showed the builder
**how old** the snapshot was. The dates existed (each capture's `retrieved`, the table's
`Retrieved` column, the ledger's `at`), but neither the brief nor the handoff output showed
them. The only age signal a builder met was `stale-evidence`, which warns only after
`maxAgeDays` (180 by default).

The plan proposed documentation and a regression test, both within the freeze, and recorded
showing the age as deferred. On 2026-10-20 the owner chose to show the age now, which is a
change to an output and so needs this ADR.

## Decision

1. **The handoff answers integrity, not currency.** `handoff.mjs` never fetches, and the age of
   a capture is never a handoff finding: it does not fail, warn or change the exit code. Checking
   currency is the collector's job. It re-collects (`--force`, or `--refresh-days n` for
   captures older than `n` days), and the gate then blocks every claim that still cites a superseded
   capture (ADR-0026). The README and the `freshness-recheck` skill say so.
2. **The report says how old the snapshot is.** `verifyHandoff` returns
   `fetched: { from, to, oldestDays }`. `from` and `to` are the earliest and latest days on which
   the captures the current evidence rows name were fetched, and `oldestDays` is the age of the
   earliest in whole days when the question is asked. It is `null` when no current row carries a
   date that parses; a day shaped like a date that is not one (`2026-00-13`) is left out. A
   capture dated after the asking machine's clock is 0 days old, never negative: hygiene's
   `future-date` allows the same day of slack.
3. **Each row is dated as freshness dates it.** The date is `freshnessDay` from `lib/checks.mjs`:
   the `retrieved` date of the capture the row's Raw cell names, which the collector wrote at
   the fetch and which is under the ledger's hash. The table's `Retrieved` cell is used when the
   Raw cell names no capture (a blank Raw cell included) or its capture has no parseable date.
   So editing the cell of a row whose Raw cell names its capture cannot make the snapshot look
   younger; a row whose Raw cell names none has only its cell. This is the rule `stale-evidence`
   already follows (output-reliability audit, G8), now read by two callers, so the two cannot
   date one row two ways.
4. **The scope is every current evidence row**: every row the line counts ("N evidence rows,
   every capture they cite on disk") except those a later capture of the same URL superseded
   (`supersededRows`, ADR-0026). A superseded row is history, and the collector's re-check
   should show as a younger snapshot. The scope is not limited to the rows the contract cites:
   an old row that no claim cites can only make the snapshot look older, never younger, and the
   arrival question stays free of the contract.
5. **The OK line prints it whatever the machine's role:** `handoff OK - ... chain verifies;
   captures fetched 2026-09-13..2026-10-02 (oldest 37 days).  [role=builder]`, or `; no capture
   date on record`. The builder is the reader who needs it. A collector checking its corpus
   before a push sees what the builder will see. `--json` carries the same `fetched`. Doctor's
   handoff line is unchanged.

## Rejected alternatives

- **Docs only, with showing the age deferred behind a trigger** (the plan's first
  recommendation, which fits the freeze without an exception). The README can say where the
  dates are, but a builder deciding whether to build would still have to open
  `research/EVIDENCE.md` and read a column it has no reason to look at. The owner chose to put
  the age where the builder already looks: the first command's output.
- **A `Retrieved` column in the brief's claims table (C2).** It changes the brief's format and
  its body hash. Existing briefs are fine until they are redrafted, but every redraft changes
  shape. It is bigger than C1 for the same information, and it puts into an authored, judged
  file a fact that the corpus already records and the kit can read.
- **The git commit recorded in the brief (C3).** A brief cannot name the commit it lands in,
  only the one before it. The draft stamp's inputs hash already pins the exact corpus more
  tightly than a commit would, and a builder knows its own checkout from `git log`.
- **A handoff warning or failure on an old capture.** The age threshold already belongs to
  preflight (`stale-evidence`, `maxAgeDays`), and a second threshold in another command would
  disagree with the first. The handoff answers whether the corpus arrived, and the gate judges
  whether it is fit to build on.
- **Dating rows by the table's `Retrieved` cell.** The cell can be edited by hand. Reading it
  is how editing E-19's cell once hid its stale warning (G8).
- **Dating a blank-Raw row by its URL's earliest capture**, so that the cell is never read when a
  capture of the URL exists. It would be a second dating rule beside `stale-evidence`'s, and the
  two would date one row two ways. The gap is the freshness rule's and predates this ADR; it is
  closed there or not at all.
- **Every row, superseded history included** (this ADR's first draft). A page the collector
  re-checked kept its first fetch's age for as long as the old row was kept, which is always
  (ADR-0026), so the line could not tell a re-checked snapshot from a stale one (review,
  2026-10-20).
- **Showing the line on a builder only.** It is the same arrival answer on both machines. A
  role condition would only hide the age from the collector that is about to push the corpus.

## Trigger to revisit

- A builder builds on a fact that had changed even though the OK line showed the snapshot's
  age: the line was not read, or not enough. Then consider a threshold here and how it agrees
  with `maxAgeDays`.
- A builder needed one claim's fetch date and could not find it from the line and
  `research/EVIDENCE.md`. Then reopen C2.
- The owner's 1.0 decision on the freeze (ADR-0117).
