# ADR-0172 - The MCP stdio loop frames synchronously and answers pings while a call is in flight

- **Date:** 2026-10-17
- **Status:** accepted
- **Area:** `lib/mcp.mjs` (`createStdioLoop`)
- **Supersedes:** the `createStdioLoop` consequence of ADR-0034 (one promise chain for every chunk)
- **Defects:** #346, #347

## Context

ADR-0034 put every stdin chunk through one promise chain: overlapping `data` events had
mutated the read buffer concurrently, dropping or doubling a message. It said the chain
cost "concurrency a stdio server has no use for". It had a use. Each chunk's handling
awaited the handler, so everything behind a tool call waited for the call:

- **#347.** A `ping`, which the same file calls the keep-alive for a long operation and
  which the specification says a receiver answers promptly, went unanswered for as long as
  `fetch_corpus` took. Measured on the real server, two pings and a `tools/list` were
  unanswered for nine seconds behind a hung call.
- **#346.** The 4 MiB line cap was checked inside the chained drain, so while a call was
  in flight it was not checked at all: 150 MB without a newline stayed in memory (526 MB
  RSS) until the call ended.

## Decision

- **The framing is synchronous.** Each `data` event cuts its chunk into lines, applies the
  cap and parses, with no await, so no other chunk can interleave with it. The race
  ADR-0034 fixed cannot recur, and the buffer holds at most the cap plus one chunk
  whatever is in flight.
- **Answers go on two chains.** `tools/call` keeps a chain of its own and runs one call at
  a time, in arrival order. Everything else - `ping`, `tools/list`, `initialize`, parse
  errors - goes on a second chain that never waits for a call, so those answers keep their
  order among themselves and may overtake a call. JSON-RPC permits that: every response
  carries its id.
- **Calls stay serialised** because two `fetch_corpus` for one run write the same file,
  and one stdio client gains nothing from its network round trips interleaved.
- **`settled()` waits on every outstanding answer** and re-reads the set until it is empty,
  so ADR-0034's end-of-input guarantees hold: `exitWhenSettled` waits for every answer, and
  the unterminated tail is still served.

## Rejected alternatives

- **Every answer fully concurrent**, the second remedy #347 offered. Calls would overlap
  and could reorder, and two downloads of one run would race on the same file, for no gain
  to a single client.
- **`input.pause()` while a drain is pending and `resume()` when it settles**, the
  alternative #346 offered. It gives the pipe back-pressure, but pausing the input also
  stops the pings #347 needs answered, so it fixes one defect by keeping the other.
- **Non-call answers written as soon as each resolves, with no chain.** A parse error then
  overtook the `ping` before it, which the existing "one line per response" test pins. The
  second chain keeps their order at no cost.

## Consequences and trigger

A newline-terminated `tools/call` queued behind a slow call is still held in memory until
its turn, as it was before. #346 was about unterminated input, and that is bounded now.
Reopen this decision if the server gains a cancellable or long-running tool that a client
is expected to call concurrently, or if a client is seen queuing tool calls faster than
they complete. Either one would call for a bound on the call queue or for concurrent calls.
