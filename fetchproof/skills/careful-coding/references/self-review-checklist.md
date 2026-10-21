# Self-review checklist

Walk this after the diff is complete and before reporting done. Read the diff as if a stranger wrote it. Each item is something that routinely survives a first read.

## Correctness

- Every changed signature: all callers updated? Grep for them; do not rely on memory.
- Boundaries: empty collection, zero, negative, single element, maximum size, off-by-one in ranges and loops.
- Null / None / undefined on every path, including optional fields in external data (API responses, config, user input).
- Every error path handled deliberately. Nothing swallowed, nothing caught-and-logged where the caller needed to know.
- Shared state, retries, and idempotency, if the code can run concurrently or be retried.
- Encoding, timezone, and locale assumptions, if the change touches strings, dates, or I/O.
- Return types still match what callers expect. No silent change from list to generator, sync to async, value to Optional.

## Scope

- The diff contains only the requested change. No drive-by renames, reformatting, or refactors.
- No unrelated files touched. Check `git status`.
- The original request, re-read now, is actually satisfied. Not an adjacent problem solved instead.

## Safety

- No secrets, tokens, or credentials in code, logs, test fixtures, or the commit.
- No hardcoded paths, URLs, ports, or environment-specific values that belong in config.
- New dependencies, config changes, schema or migration changes, and public-interface changes were called out to the user before being made.
- Nothing destructive ran without confirmation (deletes, drops, force-push, history rewrite, migrations on shared data).

## Cleanliness

- No debug output: `print`, `console.log`, `dbg!`, `breakpoint()`, `debugger`, leftover logging at the wrong level.
- No commented-out code, no "temporary" hacks, no TODOs that should have been done now.
- No `type: ignore`, `@ts-ignore`, `eslint-disable`, `as any`, or broad catch added to make a real error go away.
- Imports and variables that are now unused are removed.
- Names and style match the surrounding code.

## Verification

- Tests ran with the project's own command. The output was read, not just the exit code.
- The number of tests collected and run is what you expected: not 0, not fewer than before the change.
- For a bug fix: the test demonstrably fails without the fix.
- Lint and type-check ran, if the project has them.
- Everything not run is listed under Not verified, with the command the user can run.

## Communication

- Status uses Verified / Untested / Expect accurately.
- Every mistake made along the way is disclosed, not smoothed over.
- Assumptions, open risks, and follow-ups are listed.
