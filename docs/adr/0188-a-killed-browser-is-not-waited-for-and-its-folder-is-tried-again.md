# ADR-0188 - A killed browser is not waited for, and its render's folder is tried again

- **Date:** 2026-10-21
- **Status:** accepted
- **Area:** `fetchproof/lib/browser-guard.mjs` (`renderThroughGuard`, `startGuard`'s `close`,
  the child's clock),
  `fetchproof/lib/browser-transport.mjs` (`renderGuarded`), `fetchproof/lib/core.mjs`
  (`removeRetrying`)
- **Defect:** the LIVE test `browser-transport > LIVE: a page whose resource never arrives is
  captured whole and marked partial under its deadline` failed on the operator's Windows PC,
  alone and under load: "the guard child did not finish within 70 s".
- **Supersedes in part:** ADR-0185, in two places: its Windows consequence ("The child waits for
  the exit before it removes the folder, so this costs time, not a leftover"), and the next step
  its third trigger named ("Killing the browser's process tree is then the next step"). That
  trigger has fired: partly removed `rk-render-*` folders (`fp-render-*` since the rename,
  ADR-0186) were found in the temp folder. ADR-0185's folder, its removal by the child and by the
  transport, and its rejection of a sweep by name stand. Also ADR-0119, in one place: the launch
  allowance runs from the guard child's own start, not from the browser's launch. Its
  first-request clock, the render budget and the parent's `2 x timeout + 10 s` stand.
- **Freeze (ADR-0117):** a bug fix, and the gap ADR-0185 deferred, whose trigger has fired. No
  command, flag, config key or check of the kit's is added.

## Context

On 2026-10-21, from 05:36 to 05:45, Chromium 154.0.8037.98 printed the whole `/stalled` page
about 21 s after its first request, and then did not exit, in 6 of 7 runs through the real
guard child. The guard's kill came on time, at the first request plus the render timeout
(ADR-0119). `process.kill(pid, 0)` failed within 2 s of the kill, so Windows had marked the
process as terminating, but Node's `exit` came 15 s to more than 35 s after the kill.

The guard child waited for that exit with no limit of its own. The parent allows the child
`2 x timeout + 10 s` (`guardChildTimeout`, 70 s at the test's 30 s), and the 10 s are for killing
the browser and reporting, not for waiting on the OS. So the parent gave the child up, and the
page the browser had already printed was thrown away with it.

The cause of the hang is not known, and it comes and goes. It did not reproduce from about 06:15
to the PC's restart at about 11:30, in 18 or more runs: standalone, one level down under
spawnSync like the kit, with the test's environment or the full one, with and without
`--log-net-log`, and through the real guard. After the restart it was back: in every timed run
that afternoon, and in 4 of 5 runs of the transport's tests. Chrome was not updated that day
(154.0.8037.98 since 2026-10-06, no update staged). It depends on a state of the PC that was not
identified.

The first fix waited 3 s for the exit and then reported the page. The review that followed found
that this brings back ADR-0185's leak: on the stuck path the child's removal ran while the browser
still held its profile, failed after its 1.6 s, and so did the transport's. Each such render left
a 2.7 to 2.9 MB `rk-render-*` folder of about 150 files in the real `%TEMP%`; 6 of 6 kill-path
runs did. The same review found that `startGuard`'s `close` could wait for ever on a CONNECT
socket the browser kept open, and the grace now reaches `close` while the browser may still run.

With those fixed, one run of the transport's tests under four CPU burners still lost the page the
same way (2026-10-21, 07:37, the test group taking 224.6 s against about 100 s alone). The child's
record died with it. Timed with the parent's cutoff lifted, 10 runs that day (6 under four
burners, 4 under ten, on 4 cores) took 40.8 to 47.6 s of the 70 s, and in every one the browser
hung after the kill and the grace fired: the child's boot took 2.5 to 5.0 s, the first request
4.4 to 8.2 s, and everything after the browser was let go 0.4 to 1.2 s. After the kill, every
step is now bounded. What is not is the time before it: ADR-0119 starts the launch allowance at
the browser's spawn, while the parent counts from the child's. The child's own boot, reading its
job and starting the guard, is in none of the times the parent allows. A boot of 7 s or more
beside a first request near the launch limit is past `2 x timeout + 10 s`; that run's record was
lost, so this is the explanation the measurements leave, not one observed.

## Decision

1. **A killed browser is waited for `KILL_GRACE_MS` (3 s), no longer.** `kill()` arms the grace
   first and then asks for the kill, so an exit the kill reports at once clears it. If no exit
   has come when it fires, the render is reported with what was read, status and signal null. A
   timed-out whole dump is already the render (`scrape`), so the page stands.
   - The budget: the grace and the cleanup must stay inside the parent's 10 s. The child's boot
     before the launch (up to 5 s measured under load) is inside the launch allowance
     (decision 5).
2. **The child tries the folder once when it never saw the exit.** `removeRetrying(dir,
   { retries: 0 })` is one try with no wait. A browser not yet gone holds the folder for longer
   than the retries' 1.6 s, so they only spent the parent's margin. When the exit was seen, the
   retries stay as ADR-0185 decided.
3. **The transport tries a folder it could not remove again.** `renderGuarded` keeps, for this
   process only, the folders it made and whose removal failed. It tries each once, with no wait,
   before every later render and once as the process exits. A folder that goes leaves the list.
   This is not a sweep: only paths this process made and passed to its own child are tried, so
   ADR-0185's reason for rejecting a sweep by name, a shared temp folder, still holds.
4. **`close` ends every socket the guard accepted.** A CONNECT socket leaves the HTTP server's own
   bookkeeping when it is handed over, so `closeAllConnections` does not reach it. A refusal or
   a drop the browser never closed, or a CONNECT still being judged, kept `server.close` from
   calling back. `startGuard` now tracks every accepted socket and destroys them in `close`.
5. **The launch allowance runs from the guard child's own start.** The child passes
   `since: 0`, its start on its monotonic clock (`performance.now()` counts from it), and the
   kill at launch is armed for `timeout` less the time already spent. The wall clock is not
   used: a step of it while the child starts, a time sync after the PC wakes, would move the
   kill, and the parent's own cutoff does not move with it. The first request re-arms it for
   `timeout`, as ADR-0119 decided. The child then reports within `2 x timeout`, plus the grace
   and its cleanup, whatever its boot took. A caller in the same process passes no `since`, and
   its launch has the whole allowance.

## Alternatives rejected

- **Widening the test's timeout.** The guard bug stays: a real collection on this PC loses its
  page the same way, and the test gets slower.
- **Raising the parent's allowance (`guardChildTimeout`).** It moves the limit. The child still
  waits with no limit of its own, and a hung exit took more than 35 s; and its boot is still
  counted by the parent and not by the child.
- **A shorter grace, to give the boot the time back.** On this PC a killed browser's exit came
  6 to 7.5 s after the kill (ADR-0185) or 15 s and more, so a grace short enough to matter
  waits for no exit it would not also miss at 3 s, and the boot is still unbounded.
- **The parent waits longer for a folder still held, for example up to 20 s.** No leftover, but
  it blocks the collection for up to 20 s for each render that hung, and while the hang lasted
  it came in 6 of 7 runs.
- **Sweeping `fp-render-*` folders from the temp folder by name.** Rejected by ADR-0185 for the
  reason that still holds: the temp folder is shared, and another process or a render running at
  the same moment could be using one.
- **Killing the browser's process tree (`taskkill /T /F` on Windows), the step ADR-0185's trigger
  named.** Measured on 2026-10-21 while the hang reproduced, through the real guard under four
  CPU burners, four runs of each kill, alternating; the browser hung after the kill in all eight.
  After `child.kill()` its exit came 44.6, 46.0, 46.3 and 53.3 s after the kill. After
  `taskkill /T /F` it came 13.3, 29.8, 48.2 and 51.2 s after, and `taskkill` itself took 2.6 to
  5.0 s and returned 128 each time. Neither ends the browser within the grace, so the grace and
  the folder retry are needed with either. A tree kill would add a call of seconds to every
  killed render for a gain seen in 2 of 4 runs, and it is not taken under the freeze. In every
  run the folder could be removed about 0.2 s after the exit, and `close` had already ended the
  guard's sockets 3 s after the kill, so the sockets the browser held are not what kept it.

## Consequences

- A render whose browser the kill has not ended within 3 s keeps the page it printed. On the
  operator's PC that was the whole page every time. Such a browser lived on for 45 to 53 s after
  the kill in the measured runs.
- Its folder is tried by the child once, by the transport with retries, then before each later
  render and at exit. A folder still held when the process exits is left, partly removed, for
  the operator to remove. A collection of one render that hung can still leave its folder; one
  of many renders gives the browser the rest of the run to go.
- A browser not yet gone can still write into its profile path until it ends, also after a try
  removed the folder. This is ADR-0185's POSIX case, now on Windows too.
- Each folder in the list costs one `rmSync` try per later render, with no wait.
- The browser's launch has the allowance less the child's boot: on the operator's PC under
  load, 2.5 to 5 s of the 30 s the LIVE test gives and of the 60 s default.
- The net log is read while a browser that did not exit may still be writing it. `readNetLog`
  then reads a log that does not parse, and the status is not observed, as for a missing log.

## Trigger that would reopen this

- A killed browser's exit comes within the grace again in most renders, or the tree kill,
  measured again (after a Chrome or Windows update), ends it within the grace where
  `child.kill()` does not: then the grace or the tree kill is worth revisiting.
- `fp-render-*` folders keep accumulating in the temp folder in normal use after this change.
- The grace fires in more than a few renders of one collection.
- A guard child given up at `2 x timeout + 10 s` again: then the time between the parent's spawn
  and the child's `timeOrigin` is the next thing to measure.
