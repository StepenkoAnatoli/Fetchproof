# ADR-0173: A topic request waits for an approved topics folder

Date: 2026-10-17
Status: accepted. Amends the last sentence of ADR-0148 decision 4 ("With no folder approved,
topic requests are refused"). A bug fix under ADR-0117: no command, flag, configuration
key, request/result field or file format is added; the listener's existing `waiting` state
carries the condition.

## Context

A builder's request with a `topic` gets a new project in a dated folder under the folder
the operator approved in the panel (ADR-0148, ADR-0056). With no folder approved, the
listener wrote a `refused` result beside the request, recorded it as trusted, committed and
pushed it. A trusted `refused` result is final: the cycle never looks at the request again.
Measured on `main` at 9a47439 (#323): setting the folder afterwards changed nothing, and the
request was collected only after the builder edited its content, which makes the result
untrusted - an edit that, for a request without a topic, also added a duplicate contract
row (#322).

The listener already treats two collector-side conditions as states, not results: while
auto-collect is paused a request is `waiting | auto-collect is paused`, and a request over
today's cap is `waiting` with the cap; nothing is written beside it and it runs when the
condition clears. A missing topics folder is the same kind of condition - the operator
fixes it on the collector, and the refusal text itself said so.

## Decision

1. A topic request on a collector with no approved topics folder is reported `waiting`,
   with the reason "this collector has no folder approved for new topics; the operator sets
   one in the panel". No result is written, nothing is committed, and the request runs on
   the first cycle after the operator sets the folder, with no change to the request file.
2. The condition is checked after the request's content (`requestProblemsResolved`), so a
   request that is wrong in itself is still refused with its reasons, and before any
   scaffolding, so a topic is never created at the repository's top.
3. Every other refusal is unchanged: a `maxPages` over the collector's per-request cap
   (ADR-0148 rejected trimming it), and the target-safety refusals - an approved folder that
   resolves outside the repository, through a link or into Git metadata, and a dated folder
   that already exists. This decision does not reopen them.
4. A topic request refused under the old rule keeps its trusted `refused` result: it is not
   re-queued when a folder is set, because the refusal was delivered to the builder as an
   answer. Editing the request queues it again, as for any changed request.

## Rejected alternatives

- **Keep the refusal.** The builder receives a final answer to a request that was fine,
  and the one remedy - changing the request's content - is a workaround that re-processes
  it as untrusted.
- **Refuse, and re-queue refused topic requests when the folder setting changes.** A
  refusal is committed, pushed and read by the builder, then retracted; two commits and a
  wrong answer in the history for a condition the collector knew was temporary.
- **Treat every refusal as retryable.** A content problem does not fix itself on the
  collector; retrying it every cycle only repeats the same reasons.

## Trigger to revisit

Revisit if the panel gains a way to approve a folder per request, or if a waiting request
must be surfaced to the builder through Git rather than in the collector's panel.
