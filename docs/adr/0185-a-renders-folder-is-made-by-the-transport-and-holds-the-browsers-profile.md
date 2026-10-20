# ADR-0185 - A render's folder is made by the transport and holds the browser's profile

- **Date:** 2026-10-19
- **Status:** accepted
- **Area:** `research-kit/lib/browser-transport.mjs` (`renderGuarded`),
  `research-kit/lib/browser-guard.mjs` (`makeRenderFolder`, `renderThroughGuard`),
  `research-kit/lib/core.mjs` (`removeRetrying`)
- **Defect:** break-test of the 2026-10-19 review, finding B1
- **Freeze (ADR-0117):** a bug fix. The browser is given one more Chromium flag; no command,
  flag, config key or check of the kit's is added.

## Context

The guard child (ADR-0118) launched Chromium without `--user-data-dir`, and had it write its net
log (ADR-0137) to a private `rk-netlog-` folder that the child removed in its own `finally`.

The break-test found both left behind in the temp folder:

- After one suite run, the suite's private TEMP held 8 `HeadlessChrome<pid><n>` folders
  (52 KB to 6.3 MB) and one `rk-netlog-*` folder. The operator's real `%TEMP%` held 1841
  `HeadlessChrome*` folders (656 MB) and 72 `rk-netlog-*` folders, in steps of 8 for each hour a
  suite ran. Production renders leave them the same way.
- `rk-netlog-*`: when the transport kills the guard child at `guardChildTimeout`, the child's
  `finally` never runs.
- `HeadlessChrome*`: the report's direct control saw none after a clean exit, and put them down
  to browsers killed at a deadline. Re-checked for this ADR with one direct run at a time on the
  operator's PC (Chrome stable, the transport's flags, TEMP an empty folder). A clean exit
  (code 0) also left `HeadlessChrome<n>` holding `first_party_sets.db` and its `-journal`
  (52 KB). With `--user-data-dir` given, no `HeadlessChrome*` folder appeared; Chrome left the
  given folder in place at exit, and it could be removed 160-210 ms after the exit.

These are external facts about Chromium, observed on one machine; Chromium's documentation was
not consulted. The decision below does not rest on them: whatever Chromium does with its own
temporary profile, it is not asked to make one.

## Decision

1. **One folder per render.** `makeRenderFolder()` makes `rk-render-` and six characters under
   `tempBase()` (the same base the net log used). The browser's profile is `<folder>/profile`,
   given as `--user-data-dir`, and the net log is `<folder>/net-log.json`. Both flags go after
   the guard's flags and before `--dump-dom <url>`. A folder that cannot be made means neither
   flag: the browser runs on a profile of its own choosing and without a net log, as before
   (status not observed). A render is never refused for it.
2. **The transport makes it, and removes it.** `renderGuarded` makes the folder before it
   spawns the guard child, passes it as the job's `folder`, and removes it once spawnSync
   returns, in a `finally`. That covers a child that ended normally, one killed at
   `guardChildTimeout`, and one killed by anything else. Because the parent made the folder, it
   knows the path without hearing from the child, so a SIGKILL of the child loses nothing.
   The child accepts a `folder` only if it is an absolute path named `rk-render-...`;
   otherwise, and when it is run without one, it makes its own.
3. **The child removes it too**, in the `finally` where it removed the net-log folder, after
   the guard has closed. The transport's removal after it is then a no-op.
4. **Removal is retried, and never fails anything.** `removeRetrying(dir)` in `core.mjs` uses
   `rmSync(dir, { recursive: true, force: true })`.
   - It tries again on EPERM, EBUSY or EACCES on Windows, and on ENOTEMPTY anywhere (a helper
     wrote one more file while the folder was being emptied).
   - It waits 25 ms, doubling each time, up to 6 more tries: about 1.6 s.
   - It returns false and leaves the folder when the folder will not go, and never throws.
     A render's result, and the collection's, are the same whether or not its folder went.

## Alternatives rejected

- **The child tells the parent its paths.** The parent runs the child under spawnSync, which
  returns only when the child is gone, so a path would have to be written to a side file. That
  file is itself a leftover after a SIGKILL. A parent that makes the folder needs no message.
- **Sweep old `HeadlessChrome*`, `rk-netlog-*` or `rk-render-*` folders from the temp folder.**
  The temp folder is shared. A sweep by name could remove a folder that another process, or
  another render running at the same moment, is using. The 1841 existing folders are the
  operator's to remove; the CHANGELOG names the command.
- **`fs.rmSync`'s own `maxRetries`.** Its retry codes and backoff are Node's. They were not
  checked on Node 24 for this decision, and an injected `rm` and `sleep` cannot test them.
  `renameRetrying` (break-test PR #182) is the precedent for a loop of the kit's own.
- **Pointing the browser's TEMP into the render's folder.** A direct, unproxied run also left
  `chrome_chrome_url_fetcher_<pid>_<n>` in TEMP. Through the guard, the browser's service
  traffic is dropped (ADR-0124), and none was found in the suite's TEMP or the real one. It
  would change the environment of every render for a leftover not seen in use.
- **The parent kills the browser's process tree when it gives up on the child.** That would
  stop an orphaned browser from holding its folder (see Consequences), but it is a separate
  change to how renders are stopped, with its own LIVE runs. Not part of this fix.

## Consequences

- A render no longer adds a `HeadlessChrome*` or `rk-netlog-*` folder to the temp folder. While
  it runs, it has one `rk-render-*` folder, and that folder goes when the render ends.
- On Windows, a browser killed at the deadline did not stop at once on the operator's PC:
  `child.kill()` returned true, and 11 Chrome processes were still alive about 3 s later. The
  exit came 6 to 7.5 s after the kill. The child waits for the exit before it removes the folder, so
  this costs time, not a leftover.
- A guard child killed by the transport leaves its browser running: the browser is its own
  process group on POSIX, and Windows does not kill a process tree. On Windows that browser
  holds its profile, so the transport's removal can fail after its 1.6 s and leave part of an
  `rk-render-*` folder. On POSIX the removal succeeds, but a browser still running can write
  into a profile path again. This happens only after a render ran past
  `2 x timeout + 10 s`, and is less than before, when every render left a folder.
- The parent makes the folder under its own `tempBase()`, not under the TEMP of the `env` it
  passes to the child. The child's own fallback uses the child's.

## Trigger that would reopen this

- A Chromium release that refuses or ignores `--user-data-dir` in headless mode.
- A LIVE run that still finds `HeadlessChrome*` in the suite's TEMP.
- Partly removed `rk-render-*` folders seen in the temp folder in normal use. Killing the
  browser's process tree is then the next step.
