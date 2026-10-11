# ADR-0151: Bounded Git output cannot authorize delivery

- **Date:** 2026-10-08
- **Status:** accepted
- **Area:** the auto-collect listener's existing Git inspection and delivery boundary;
  a bug fix within ADR-0148. No public command, option, key, result format or provider is
  added. ADR-0149's private collection accounting and reservations remain separate.

## Context

The listener retained a bounded prefix of combined child output and returned only its
exit code and that prefix. It used Git output as both a diagnostic log and an answer:
the repository and metadata paths, upstream, ahead count, commit subject and changed
paths, dirty state, and the binary diff used to fingerprint a pending partial delivery.

A real local-Git probe reproduced a false match with two tracked files. A fixed large
change in `research/a.txt` filled the retained prefix; a later change from A to B in
`research/z.txt` changed the complete binary diff while the retained diff, porcelain
status and resulting delivery fingerprint stayed identical. The complete diff was
400,326 bytes. A successful Git exit therefore did not establish that the answer used
to authorize staging or pushing was complete.

Refusing the fingerprint also exposed an interruption boundary: the listener writes a
partial result before computing its fingerprint, but previously recorded collector
trust only afterward. If inspection failed at that point, a new loop could treat the
already written result as untrusted and collect the request again.

## Decision

1. `execFile` retains a bounded byte buffer and reports a private `truncated` boolean.
   Output larger than the retained buffer still drains; it is not accumulated without
   a bound. The human-readable truncation notice is not the machine signal.
2. Every Git output used for a path, scope, eligibility, pending-commit inspection or
   delivery fingerprint is refused when this flag is true. It is not hashed or parsed
   as if it were a complete answer. The listener names the failed inspection and asks
   for manual inspection or delivery. Commands whose output is diagnostic only still
   use their exit status: bounded pull or push logs do not by themselves invalidate a
   successful operation. An invalid ahead count or absent quiet-diff exit likewise
   cannot establish delivery eligibility.
3. The partial result's collector trust is recorded immediately after it is written,
   before attempting the fingerprint. A refused fingerprint leaves the result, spend,
   remaining allowance and paused state intact; it stages nothing and performs no
   further collection. Trust is updated again if a complete fingerprint is stored.
   On restart, delivery remains pending until the data can be inspected completely or
   the operator completes it manually.
4. The nine offline regressions use real local Git and fixed child stand-ins, including
   an oversized two-file binary diff and a restarted partial request. Other cases
   inject the private truncation flag at each data boundary. No provider is contacted.

## Rejected alternatives

- **Hash or parse the retained prefix.** It omits later changes and can authorize an
  unrelated path or incorrectly treat a dirty tree as clean.
- **Remove or greatly increase the output bound.** An unattended loop must not keep an
  arbitrary Git diff in memory. A larger limit only moves the same failure boundary.
- **Add a streaming digest path now.** A streamed digest could cover a large diff,
  but path and status inspections also need complete answers and would still require
  refusal or a separately bounded structured parser. The current authorized repair is
  explicit refusal; a future need for unattended large-corpus delivery can justify a
  separately tested design for all of these boundaries.
- **Discard the new partial result on inspection failure.** The request already spent
  pages; discarding its trust would let a restart collect it again.

## Expires when

The owner needs unattended delivery of a corpus whose Git inspection exceeds the bound.
That change must retain bounded memory and test later-file and changed-path completeness
across every consumer, plus interruption before result delivery.
