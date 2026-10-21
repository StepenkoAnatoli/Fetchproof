# ADR-0119 — The render timeout starts at the browser's first request

- **Date:** 2026-10-01
- **Status:** superseded in part by ADR-0188 (the launch allowance runs from the guard child's own start, not from the browser's launch, so the child's boot is inside what the parent counts; the first-request clock and the render budget stand)
- **Area:** `lib/browser-guard.mjs` (the child's clock), `lib/browser-transport.mjs` (the
  timeout message, the deadline judgment)

## Context

The browser transport gives a render one timeout, 60 s by default, counted from the moment
Chromium is spawned, and kills the browser when it runs out. ADR-0118 put a guard proxy
between Chromium and the network, and PR #190 gave Chromium its own deadline ten seconds
under the kill, so a page that never settles is dumped as it stands.

On the CI runners, 2026-10-01, the suite's first Chromium launch ran the kill timeout out
seven times in an afternoon, on Windows and once on Ubuntu, and the guard's record (PR #191,
#192) showed why: the browser had made **no request at all**. Chromium's own log put profile
creation 43 s after one launch, and in another the renderer had not asked for the page 5 s
after the browser was ready. The time went into process startup on a slow or busy runner,
before any navigation. Chromium's deadline counts from when it is ready, so it never fired;
the kill counts from the launch, so it did. The page was lost without having been asked for,
and the message said only "did not finish".

## Decision

The render timeout starts at the browser's **first request through the guard**. The launch
is allowed as long again, and no more:

- the child arms the kill at launch for `timeout` ms; when the guard sees the first request
  it re-arms the kill for `timeout` ms from that moment. A browser that never makes a
  request is killed at `timeout`; one that does has at most `2 × timeout` of wall time.
- the child reports `startupMs`, launch to first request, or null when there was none.
- the transport judges "ran to the deadline" from the render's own time, elapsed minus
  startup, and a timeout's message says what the launch cost: "the browser took N s to make
  its first request", or "the browser never made a request in N s".

`timeout` keeps its name and default. What it bounds is the render; the launch is bounded
separately, by the same number.

## Alternatives rejected

- **Count the launch inside the timeout** (the state before this ADR). On a slow runner the
  page is killed before it is asked for, and the loss is charged to the page.
- **A separate launch timeout, as a setting.** A new configuration key, which the freeze
  (ADR-0117) does not allow, for a number nobody can choose better than "as long as the
  render itself".
- **A larger fixed timeout.** A hang is not slow, and a 43 s launch beside a 60 s render is
  not served by 90 s either; it is served by not charging the one to the other.
- **Diagnose and cure the slow launch itself.** The log of a hung launch shows the browser
  process reaching profile creation tens of seconds in, and a renderer slow to start; the
  cause is the runner, not the kit, and the kit cannot make a runner fast. It can stop losing
  the page over it.

## Consequences

- A render on a slow machine completes instead of being killed; the first capture of a run on
  a cold Windows box, where process starts are slowest, is no longer the one lost.
- Wall time per render is bounded by twice the timeout, not once. The default is 60 s, so a
  browser that starts and then hangs can hold a collection for 120 s before the kill.
- `startupMs` on the child's report is the measurement a future change would start from.
