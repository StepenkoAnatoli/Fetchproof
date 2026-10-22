# ADR-0021 — The test harness awaits its tests

- **Date:** 2026-09-15
- **Status:** accepted
- **Area:** the test harness — the thing that decides whether anything else was checked
- **Discharges:** finding 1 of
  [`docs/architecture-review-2026-09-15-triaged.md`](../architecture-review-2026-09-15-triaged.md),
  and the deferral [ADR-0020](0020-five-trusted-boundaries-that-did-not-hold.md) recorded
  under "What this does not decide". Both are left in their own words.

## Context

`runPending` in `fetchproof/test/harness.mjs` ran each registered test with `fn()`
inside a `try`, caught a synchronous `throw`, and printed `ok` when nothing was caught.
An `async` test does not throw synchronously — it returns a pending promise. So `ok` was
printed the instant the test *started*, before any assertion inside it had run, and
`failures` was never incremented.

This was found while fixing the five boundaries in ADR-0020 and recorded there as
triaged but not scheduled. The operator escalated it out of that set, and the argument
was the right one: **the proof offered for those five fixes rested on a count this
harness produced.** "368 ok" is evidence only if `ok` cannot be printed for a test that
did not run and pass. Every reproduction in that round was re-run by hand, which is what
made them trustworthy — but the suite's own number was not independently checkable, and
two of the round's race tests had already been forced into synchronous contortions to
work around this, which was the tell.

The reproduction came out **worse than the triage document recorded**. A fixture holding
one test whose assertion fails inside an awaited promise, run through a runner shaped
exactly like `bin/selftest.mjs`:

```
  ok    async: an assertion that fails inside the promise

all tests passed
PROCESS_EXIT=0
```

Not a misattributed failure, not a noisy crash. The per-test verdict was wrong, the
summary was wrong, and the exit code was **0**, so any `&&` chain, any CI system and any
human reading the last line would have been satisfied. Node's default
`--unhandled-rejections=throw` does eventually surface the failure — but the runner's own
`process.exit(0)` runs first and pre-empts it, so even that safety net was removed by the
shape of the runner. The only circumstance in which the defect announces itself is when
something keeps the process alive past the summary, which the real runner never does.

One fact keeps this honest: **the bug was latent, not live.** The suite contained zero
async tests, so nothing was being masked — re-running all 368 under the fixed harness
surfaced no failures. That is luck rather than design, and it is the reason the fix is
still worth making: the next async test anyone wrote would have been silently unjudged,
and would have looked green doing it.

## Decision

**`runPending` is `async` and awaits every test. A verdict is printed only after the
test has settled, and the returned failure count includes async failures. Each test is
raced against a watchdog, and a test that times out has its promise swallowed so its
late rejection cannot crash the runner afterwards.**

- **One test at a time, in registration order.** Awaiting is `await`, not
  `Promise.all`: the tests share temp-project state, environment variables, and the
  harness's own module-level `registered` and `created` arrays. Serial execution is now
  a pinned property — a test asserts that two tests are never inside at once and that
  completion order equals registration order even when the first test is the slowest.
- **A watchdog per test** — `FETCHPROOF_TEST_TIMEOUT`, default 60 000 ms. An awaited
  test that never settles would otherwise hang the suite printing nothing, which is the
  same trap the commit gate fell into before C3 gave it a watchdog, and worse here: the
  suite is the instrument you trust to tell you about other failures. The bound was
  chosen by measurement, not by taste — the whole suite runs in 9.0 s and the slowest
  single *file* (which holds many tests) in 3.2 s, so 60 s is roughly nineteen times the
  slowest file. The failure names the bound and the knob that raises it.
- **A timed-out test's promise is swallowed, deliberately.** The test has already been
  judged and its failure attributed; a rejection arriving later would otherwise surface
  as an unhandled one and take the process down over a verdict that was already correct.
  Swallowing is scoped to that one promise, not installed globally.
- **Cleanup runs whatever the test did** — threw, rejected, or timed out — and runs
  before the verdict prints, so a failing cleanup cannot be mistaken for the test's own
  failure.
- **`bin/selftest.mjs` awaits it**, with the reason written at the call site: an
  un-awaited `runPending` in a `for` loop is not an error anyone can see.

## Rejected alternatives

**Detect and refuse.** Keep `runPending` synchronous and fail loudly when a test returns
a thenable — "async tests are not supported here". This does make the false green
impossible, and it is a much smaller change. Rejected because it makes async tests
impossible *too*, and the kit already needs them: `lib/http-transport.mjs` drives `fetch`
through a child-process rendezvous, and any test of it, of a network seam, or of a
runtime API that has no `Sync` variant is async by nature. A runner that forbids the
language's own concurrency pushes every such test into `spawnSync` contortions — which is
exactly what the two race tests in `provenance.test.mjs` had to do, and what their
comment now records as a choice rather than a workaround. Refusing is also still a policy
the harness enforces at runtime; awaiting is the harness simply being correct.

**Fire-and-forget with a global `unhandledRejection` handler**, attributing a late
rejection to whichever test ran last. Rejected because attribution by timing is a guess:
the rejection can land after three more tests have printed, so the wrong test is blamed —
a misattributed failure is worse than a missing one, because it sends the reader to the
wrong code. A rejection that lands after the summary cannot be counted at all, and the
exit code has already been decided, so this cannot fix the part that matters most.

**Await, with no watchdog.** Smaller, and sufficient for every test that eventually
settles. Rejected because the failure mode it leaves is the worst one available: a suite
that stops mid-run with no output, no verdict, and no way to tell a hanging test from a
broken runner. C3 established that an unbounded wait which prints nothing is
indistinguishable from a crash, and the same reasoning applies with more force to the
instrument everything else is verified by.

**Run the tests concurrently** (`Promise.all` over the batch). Rejected: it would make
failures order-dependent and unreproducible, in a suite whose entire value is that a
failure can be re-run and believed. Tests share temp state and process environment. This
was not left implicit — serial execution is asserted.

**Fix it in `bin/selftest.mjs` instead of the harness** — await at the call site and
leave `runPending` returning a promise. Rejected: the count is `runPending`'s, so the
awaiting belongs where the count is made. A harness whose verdict function hands back a
promise the caller may forget to await has moved the same trap up one level rather than
removing it, and `bin/selftest.mjs` is not the only caller it will ever have. The
forgotten-await case is pinned anyway, because it is worth knowing which way it fails:
`failures += runPending(...)` produces `0[object Promise]`, a visibly nonsense summary
and exit 1. Loud and wrong beats silent and green — but it is a test, not a hope.

## Consequences

**The suite is unchanged in size and speed.** 377 tests across 22 files (368 across 21
before), all passing; 9.0 s end to end. Nine tests were added, in a new
`test/harness.test.mjs`, and no existing test changed behaviour — awaiting a
non-promise is a no-op.

**`test/harness.test.mjs` runs its cases in child processes**, which is unlike every
other test file here, and necessarily so: a test that deliberately fails, or deliberately
hangs, cannot be registered in the suite that is supposed to stay green. Case 1 runs the
old loop and the new one side by side on the same failing async fixture, and asserts the
old prints `ok` / `all tests passed` / exit 0 while the new prints `FAIL` / counts one
failure / exits 1. That is the reproduction, made permanent: the false green cannot come
back without a test noticing.

**A timed-out test is not cancelled.** The watchdog stops *waiting*; it cannot stop the
test. Its promise, its timers and any child processes it started keep running until they
finish or the runner exits, and their side effects are not rolled back. This is the cost
of a bound in a language with no test cancellation, and it is why the bound is generous
rather than tight: a too-eager watchdog would leave more work running in the background
than a patient one.

**Async tests are now available**, and the two race tests in `provenance.test.mjs` stay
synchronous for a reason that is theirs — their barrier is a busy-wait on files written
by separate worker processes, which need nothing from this event loop. Their comment said
the harness forced it; it now says why they chose it.

**The trustworthiness of a test count is a property of the runner, not of the tests.**
That is the generalisable part, and it is the same shape as the other five boundaries in
ADR-0020: a guarantee the kit assumed about something it does not control — here, about
what `fn()` returning means — which was false, and which failed silently in the direction
that flatters the reader.
