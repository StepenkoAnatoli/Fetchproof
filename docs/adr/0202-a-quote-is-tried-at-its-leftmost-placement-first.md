# ADR-0202 — A quote is tried at its leftmost placement first, and the set pass reads only what a placement can reach

- **Date:** 2026-11-06
- **Status:** accepted
- **Area:** `fetchproof/lib/quotes.mjs` (`anchorFound`)
- **Prompted by:** the fresh-eyes review of PR #442 (2026-11-06), finding 2
- **Extends:** the F04 fix of the same branch (independent audit 2026-11-04, F04: the search for a
  quote's fragments was exponential in their count), which had no ADR; ADR-0162 (a placement is
  tried at each occurrence of every fragment)
- **Freeze (ADR-0117):** a bug fix. No verdict moves; the time and memory the search takes do. No
  new check, flag, limit or format.

## Context

F04 replaced a recursion over every chain of occurrences - exponential in the fragment count when a
quote repeats a phrase over a page that repeats it - with a set pass: `ends` holds where each
placement of the fragments so far ends, and each fragment extends them over its occurrences. The
review of #442 measured that pass where the recursion had been cheap. It listed every occurrence of
every distinct fragment before any was needed, and read all of them for every fragment, even when a
single placement was all there was:

- a found quote of a thousand one-word fragments over a 200 KB page: 3637 ms, where the recursion
  took 40 ms; with a final fragment the page lacks, 3140 ms;
- 2000 fragments over 4.77 MiB: 56176 ms;
- 101 distinct fragments over 200 KB: 2599 ms and 201 MiB, where the recursion took 36 ms and 57 MiB.

The audit's own bar was 3 s for twenty fragments. `check` (the citations check, which preflight and
the commit gate run), the quote recheck and `measure.mjs` all call the search.

## Decision

1. **The leftmost chain first:** each fragment at its first occurrence at or after the end of the
   one before it, one `indexOf` per fragment. A chain whose every gap is within the bound is a
   placement, and the quote is found. The chain goes on past a gap over the bound, so each end it
   reaches is the earliest any placement of those fragments can reach: a fragment that does not
   occur after it occurs after no placement, and the quote is not found. The review's found and
   missing cases both end here.
2. **Only a complete chain that goes past the bound somewhere runs the set pass,** and the pass
   reads, for each fragment, only its occurrences from the first end to the last end plus the bound:
   none outside them extends a placement.
3. **A fragment's occurrences are listed when the set pass first needs them, once per distinct
   text, as 32-bit positions.** A quote that repeats one fragment lists it once; a quote the
   leftmost chain decides lists nothing.
4. **The residual is named in the function's comment:** a crafted quote whose leftmost chain goes
   past the bound costs up to one read of every occurrence per fragment, O(fragments x occurrences).

Measured on the operator's Windows PC, Node 24.20.0, with the review's scripts
(`E:/Temp/review-pr442/scripts/`) and a crafted case of 1000 fragments `a` and a final `omega`
past a 400-character run, over 200 KB of `a a a ...`:

| case | recursion (before F04) | F04's set pass | this |
|---|---|---|---|
| 1000 fragments over 200 KB, found | 51 ms | 3637 ms | 47 ms |
| the same with a final fragment the page lacks | 5 fragments: not done in 20 s | 3140 ms | 38 ms |
| 2000 fragments over 4.77 MiB, found | - | 56176 ms | 1523 ms |
| 101 distinct fragments over 200 KB | 44 ms, 57 MiB | 2599 ms, 201 MiB | 38 ms, 57 MiB |
| crafted: the leftmost chain past the bound | not done in 30 s | 4250 ms | 2079 ms |

The review's differential fuzz, the recursion against this over 400,000 random cases (two seeds),
gives no verdict that differs, but for one: a `maxGap` that compares as NaN (a word, `NaN`) places no
quote of two fragments or more, as in F04's set pass, where the recursion placed it. A one-fragment
quote has no gap to bound and is found whatever the bound, and a numeric string or `null` compares as
its number; no caller passes `maxGap`. Over the repository's 44 corpora, all 557 anchors are found by
both.

## Rejected alternatives

- **A cap on a quote's fragments** (the review's alternative). It would bound the crafted residual
  outright, but it is a limit of its own - a rule on what a Finding may quote, which the freeze
  admits only through an ADR that lifts it - and it refuses quotes the search can judge. Not taken
  here; the residual is named, and the cap waits on its trigger below.
- **The recursion, memoized on (fragment, occurrence).** It stops at its first success, so the found
  case is cheap, but its table of failed states grows to fragments x occurrences - for the crafted
  case about 10^8 entries - and its depth to the fragment count.
- **The leftmost chain alone.** A first-occurrence match misses the placement ADR-0162 requires: a
  later occurrence of a middle fragment that lets the next one follow within the bound.
- **Finding each fragment's occurrences again with `indexOf`, keeping no lists** (this fix's first
  draft). No lists in memory, but the crafted case took 6748 ms against F04's 4629 ms in the same
  run: every occurrence was found again for every fragment.
- **The set of ends kept as runs of reach, not positions.** It would make the crafted case cost per
  run rather than per occurrence where occurrences are dense, at the price of a second structure
  over the occurrence lists to get right, for a case the cap would close more simply.

## Consequences

- A quote the leftmost chain decides costs one search per fragment and lists nothing, found or not.
- The crafted residual remains, at about half F04's time: about 2 s for 1001 fragments over 200 KB,
  growing with fragments x occurrences.
- The set pass holds one 32-bit position per occurrence of each distinct fragment it reaches, and
  one set of ends at a time.

## Trigger to revisit

- A real Finding's quote takes the set pass and is slow, or a crafted quote is used to hold a gate:
  take the fragment cap, through an ADR that lifts the freeze for it.
