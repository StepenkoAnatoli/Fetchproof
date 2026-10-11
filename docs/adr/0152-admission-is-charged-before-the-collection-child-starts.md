# ADR-0152: Admission is charged before the collection child starts

Date: 2026-10-08
Status: accepted. Repairs the existing auto-collect daily page cap under ADR-0148 and
ADR-0149. Supersedes only ADR-0149's claim that durable admission is unnecessary. Its
private IPC measurement channel and rejection of a new public measurement interface
remain in force. No public flag, configuration key, request/result field or persisted
format is added under ADR-0117.

## Context

ADR-0149 replaced untrusted diagnostic parsing with a received private child report, but
charged the machine-local meter only after the collector awaited that child. Killing the
collector before it resumed forgot already admitted page attempts. A fresh collector for
another project shared the unchanged meter and could admit those pages again.

An offline real-process fixture with a one-page daily cap recorded one synthetic attempt,
killed its collector, then started another project using the same disposable machine
home. The saved meter was zero with no pause after termination. A second synthetic
attempt ran; the final meter counted one while the two attempt markers totalled two.
Git and preflight were explicit stand-ins, and no page was fetched. This measures the
admission defect, not a provider's billing balance or persistence across power loss.

The first regression failed with the saved allowance zero rather than one. The existing
atomic `writeJson` writer already persists settings, daily spend, pause and trusted-result
records together; another durable file or measurement format is not needed.

## Decision

1. After request preparation and immediately before starting the fixed research child,
   atomically add its entire newly admitted allowance to the existing daily meter and
   save an in-flight pause. A failed admission write prevents that child from starting.
   Pre-collection validation or scaffolding failures do not acquire this reservation.
2. Keep an internal in-memory reservation token with the admission day, allowance, exact
   owned pause reason and settlement state. It is not written as a new JSON field. The
   private receipt validator from ADR-0149 remains the authority for measured spend.
3. A valid report settles that token once. On the admission day, refund only unused
   allowance; preserve earlier measured attempts and other existing charges. Settlement
   and the final owned pause are saved in one atomic write. Ordinary failed exit with a
   valid report still counts measured spend; exhaustion and interruption keep their
   explicit operator-review pauses.
4. Missing, invalid, duplicate or over-allowance reporting retains the full admitted
   charge and an actual-spend-unknown pause. A spawn failure without a valid report follows
   the same conservative policy, even if it might have attempted no page. A valid measured
   zero refunds unused allowance. Operator Resume clears a pause, never its charge.
5. Whole collector termination cannot execute settlement, so its saved allowance and
   in-flight pause survive a same-day restart or project switch. A restarted collector
   cannot automatically start another request while that pause is present. Existing
   result delivery remains separate from collection; a trusted result is not collected
   again merely because its push is pending.
6. A continuation reserves only its newly admitted remaining allowance. Its earlier
   attempts remain counted once; neither charging the original allowance again nor
   charging the fallback reservation a second time is allowed.
7. Never refund a previous day's unused allowance from today's independent meter. A run
   completing across the date boundary adds its measured total, or its full allowance
   when unmeasured, to today's completion-day meter. This is conservative: the single
   final report cannot date every individual attempt, so a cross-day run may be charged
   on two days. A completion-day charge exceeding the current cap keeps an inspect pause.
   The existing daily reset preserves a saved in-flight pause; it cannot silently resume
   an unmeasured run.
8. Clear or replace only the reservation's own pause, or set a required final pause when
   the current pause is empty. A distinct existing pause is preserved. New pause reasons
   pass through the caller's existing redactor before persistence.

## Rejected alternatives

- **Charge after the child's report only.** It loses admission if the collector itself
  terminates, even when the child's eventual packet would have been valid.
- **Rely on dirty research files.** That can block the interrupted project, but another
  clean project uses the same machine-local daily meter.
- **Treat restart as zero measured spend.** Neither an absent result nor a dead collector
  proves that its child attempted no pages.
- **Add a public reservation file or meter key.** Existing atomic spend and pause fields
  can conservatively protect admission. The reservation token is internal and ephemeral.
- **Subtract unused allowance through negative `recordSpend`.** That compatibility helper
  clamps negatives to zero and cannot settle a reservation. Scoped reservation/settlement
  helpers express the boundary instead.
- **Refund yesterday's allowance against today's total.** It can erase unrelated current
  spend. Day-aware completion charging preserves the existing completion-day convention
  without claiming a timestamp for each provider attempt.

## Verification boundaries

Eight offline regressions exercise actual collector/child termination and restart, one
settlement/refund, unknown measurement plus Resume, deterministic day rollover, distinct
pause preservation, an unwritable meter destination, real child spawn failure, and failed
exit with valid measured spend. The unchanged 60-second per-test watchdog applies. The
original kill/restart case was red before the repair; a subsequent null-measurement guard
was also red before its correction. These fixtures spend no provider credits.

The project's existing single-instance mutex remains unchanged. Atomic file replacement
is not a cross-process read-modify-write transaction; this repair does not certify racing
independent collector instances or power-loss durability. Revisit that boundary if the
supported collector model requires several independent instances sharing one machine
meter. Cross-day accounting remains a conservative page-attempt count, not a vendor bill.
