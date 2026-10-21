# ADR-0072 — The commit hook finds the home directory without HOME

- **Date:** 2026-09-27
- **Status:** accepted
- **Area:** `githooks/pre-commit`

## Context

The hook runs under `set -u` and spells its defaults as `$HOME/.agents/fetchproof` and
`$HOME/.agents/fetchproof.config.json`. A break-test on 2026-09-27 ran it with HOME unset,
which is what a cron job, a systemd unit or some CI agents get. The hook stopped at that line
with "HOME: parameter not set" and exit 2. So every commit was refused by a shell error,
which breaks the hook's first property: fail open, loudly, when the gate cannot run. Seven
posture-agreement tests went red for the same reason. `lib/machine.mjs` has no such problem:
`os.homedir()` falls back to the passwd entry.

## Decision

When HOME is unset or empty, the hook sets it from
`node -e 'process.stdout.write(require("os").homedir())'`. The hook and `lib/machine.mjs` then
look in the same place. With no node, HOME stays empty, and the existing path reports "node
is not on PATH" and applies the posture, which fails open by default. A test runs the real
hook with HOME unset.

## Rejected alternatives

- **`~`.** dash, `/bin/sh` on Debian and Ubuntu, leaves `~` unexpanded when HOME is unset.
- **`${HOME:-}`.** It stops the crash, but it looks for the kit and the config under
  `/.agents`. The machine's real config, possibly fail-closed, would then be ignored.
- **`getent passwd`.** macOS has no `getent`.

## Trigger that would reopen this

The hook no longer calling node, or `lib/machine.mjs` no longer using `os.homedir()`.
