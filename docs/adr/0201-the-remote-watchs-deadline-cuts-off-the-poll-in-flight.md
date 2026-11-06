# ADR-0201 — The remote watch's deadline cuts off the poll in flight, and no poll starts after it

- **Date:** 2026-11-06
- **Status:** accepted
- **Area:** `fetchproof/lib/dispatch.mjs` (`waitForRun`; `getRun`'s new `signal`; the new
  `unlessAborted`; `callApi`, `readJsonBody`, `readError` and `rateLimitError`, which pass it on)
- **Prompted by:** the independent audit of `532c696` (Codex, 2026-11-04), finding F06 (Medium,
  confirmed)
- **Freeze (ADR-0117):** a bug fix. `--timeout` already says how long the watch waits; this makes the
  watch keep to it while a request hangs. No new flag, error code, exit or format: a poll cut off at
  the deadline ends in the TIMEOUT the watch already gives, which `collect-remote` already maps to
  exit 4.

## Context

`waitForRun` checked its deadline only after a poll had answered, and before the wait that followed.
The audit held a fetch's promise open with a 25 ms deadline: the watch was still pending after
150 ms, and when the fixture then released a completed run, the watch returned it. Nothing bounded a
request: `callApi` awaited `fetch` with no signal, and `readJsonBody` awaited the body the same way.
A proxy that takes the connection and never answers, or a response whose body stalls, held
`collect-remote` past its `--timeout` for as long as the request hung - until some lower layer's own
timeout, if any, not the operator's. The wait between polls was a full interval whatever was left,
and the poll after the wait that crossed the deadline still ran ("the poll after the sleep that
crosses the deadline is the last", as a test put it).

## Decision

1. **One AbortController per watch**, aborted by one timer at `timeoutMs` and cleared when the watch
   ends, however it ends. A setTimeout holds at most 2^31-1 ms (about 24.8 days); given more, it fires
   after 1 ms with a warning, and `AbortSignal.timeout` does the same (checked on Node 24.20.0:
   `setTimeout` given 2^31 ms fired after 3 ms with a `TimeoutOverflowWarning`, and
   `AbortSignal.timeout(2 ** 31)` aborted after 11 ms). A longer watch re-arms the timer for what is
   left rather than ending at its start.
2. **Its signal goes to each poll.** `getRun` takes an optional `signal` and passes it to `fetch`,
   which cancels a real request and the reading of its body (checked on Node 24.20.0 against a local
   server, aborting 100 ms in: a request with no headers yet and a body stalled half-way both
   rejected within 15 ms, with the signal's own `AbortError`). It also races each await on the response
   against it (`unlessAborted`): the fetch, the JSON body, and a 403's text, read for the rate-limit
   check. A fetch or a body that does not honour the signal is cut off too - no longer waited for,
   though not cancelled.
3. **A poll cut off at the deadline ends the watch with TIMEOUT**, naming the run and the status it
   had at the poll before (when one answered), with the remedy the timeout already gave: the run's
   page, and `--run-id <n>` with a longer `--timeout`. `callApi` and `readJsonBody` rethrow an abort as
   it is, so a cut-off request is never NETWORK or BAD_BODY, which the watch would retry and
   `collect-remote` would report as RUN_FAILED (exit 2) for a run that may be fine.
4. **A wait ends at the deadline at the latest, and no poll starts at or after it.** A wait is the
   smaller of the interval and the time left. When the deadline comes after a poll that answered, the
   watch ends with the TIMEOUT it gave before ("run N was still S after Ns"); when it comes while a
   transient failure is being retried, with that failure, as before ("no retry outlasts the
   deadline").
5. **An answer in hand is taken.** A poll the deadline did not cut off answered in time, and a
   completed run it returns is returned, whatever the clock reads once it is parsed.
6. **The scope is the watch.** `dispatchCollection`, `listArtifacts`, `downloadArtifact` and
   `getRunSummary` (the MCP server's one read of a run) pass no signal and behave as before.

## Rejected alternatives

- **A fixed timeout per request.** It bounds each poll but not the watch: a poll cut at its own limit
  is NETWORK, retried, and the watch can still end up to one such limit past `--timeout`. The audit's
  point is that a lower layer's default does not enforce the deadline the operator chose; a second
  number would be one more of them.
- **`AbortSignal.timeout(timeoutMs)`.** One line, but it overflows as above - a watch of more than
  24.8 days would end at once - and its timer cannot be cleared when the watch ends early.
- **The signal passed to `fetch` only, with no race.** A real fetch honours it, through the body, but
  a caller's injected fetch, or a dispatcher that ignores the signal, would hang as before; the race
  costs one listener per await.
- **A completed answer refused once the deadline has passed.** It is final and in hand; refusing it
  sends the operator back with `--run-id` to read the same thing. With the poll cut off at the
  deadline, an answer arrives that late only when it was delivered before the timer could run.
- **One last poll after the deadline** (the old behaviour). It is work started after expiry, and with
  the poll cut off at the deadline it would have no time to answer.
- **A failure being retried at the deadline reported as TIMEOUT.** The failure is what the watch knows
  of the run, its remedy already points back to it, and the change would move `collect-remote`'s exit
  for a case the audit did not raise.
- **A deadline for the other requests** - the dispatch POST, the artifact list and download. They are
  outside the watch the audit confirmed; a dispatch that may have been accepted must not be retried
  blindly (a duplicate paid run); and a budget for them is a new limit under the freeze. Named below
  as not covered.
- **A clock seam for the timer** (an injected `setTimeout`, so the tests could drive it from the fake
  clock). A parameter added only for tests; the tests run real deadlines of 50 ms instead, because
  what is under test is a timer cutting off an await.

## Consequences

- `collect-remote`'s watch ends within its `--timeout`, plus the time an abort takes to settle, whatever
  the network does; the dispatch before it and the download after it are not bounded (below). Exit 4
  now also covers a poll cut off at the deadline, and its remedy picks the run up again.
- A watch whose deadline falls in a wait ends at the deadline, not up to one interval past it, and
  makes one poll fewer than before at the boundary.
- Cost: one timer per watch, and one abort listener per await of a poll, removed when it settles.
- Not covered, named so it is not taken as fixed: the requests outside the watch have no deadline of
  their own; the MCP server's dispatch and its read of a run are not the watch, and are unchanged; a
  deadline under a second is still reported rounded ("after 0s").

## Trigger to revisit

- A watch ends in TIMEOUT with a poll cut off while GitHub was answering, slowly but within reason:
  give the last poll a floor rather than only the time left, with the timings in hand.
- A request outside the watch is found to hang an operator's run: give it a budget of its own, through
  an ADR, since that is a new limit.
