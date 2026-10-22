# ADR-0002 — The fail-open posture has exactly one reader

- **Date:** 2026-09-13
- **Status:** accepted
- **Area:** machine policy, gate enforcement

## Context

The gate fails **open** and loudly by default: a broken gate must not brick every commit on
a machine. That posture is recorded in `research/DISCOVERY.md` under "Already decided" and
in the approved hardening design, and it is not up for revision here.

What *is* a defect is how many places implemented it. `~/.agents/fetchproof.config.json`
was read by:

1. `lib/config.mjs · loadConfig()` — 30 lines, the intended reader;
2. `githooks/pre-commit · fail_closed()` — an inline `node -e` CommonJS one-liner that
   re-derived the config path from `FETCHPROOF_CONFIG` or `os.homedir()`, re-parsed the
   JSON, and re-applied the default in shell;
3. `lib/doctor.mjs · gateHealth()` — again, for reporting;
4. `lib/installer.mjs` — indirectly, via `saveConfig`.

Copy (2) is the consequential one: it decides whether a commit is blocked when the kit is
missing, and it is the least testable copy in the kit — the only `require()`-style code in
an otherwise all-ESM project, exercising its logic only through a real git hook in a real
repository.

Alongside it, `lib/git-config.mjs` was a fifteen-line module wrapping one `execFileSync`
(read `core.hooksPath`), while `lib/installer.mjs` kept a private `git()` writer beside it.
The machine's git configuration had a reader and a writer that did not know about each
other. By the deletion test, `lib/git-config.mjs` was shallow: deleting it moved one line
into the installer rather than concentrating anything.

## Decision

`fetchproof/lib/machine.mjs` owns everything machine-scoped, and is the only reader of
the posture:

- `posture()` → `{ failOpen, claudeGate, source }`, defaulting to fail-open when the config
  is missing, unreadable, or corrupt. A broken config never blocks work.
- `hooksPath` → `{ read, set, unset }`, one adapter for git `core.hooksPath`, used by the
  installer and by `doctor`. `lib/git-config.mjs` folds in.
- `installState` → `{ read, patch, replace }` over `~/.agents/fetchproof.install.json`.
- `settingsPath` / `CONFIG_PATH` — the machine-scoped locations, declared once. Both stay
  **outside** the deployed kit tree, so `install.mjs` can never clobber them.
- `bin/gate.mjs --posture` prints the posture for shell consumers. `githooks/pre-commit`
  asks the kit instead of parsing JSON in shell.

What cannot be delegated stays in shell and stays honest: when node is missing, or the kit
is missing, the hook cannot consult the module that lives inside the kit. Those two branches
remain in `githooks/pre-commit`, fail open, print why, and are covered by
`test/hooks.test.mjs` driving real git.

## Consequences

- The posture is testable as a unit: "fail-closed blocks a commit when the kit is missing"
  no longer requires a repository and a git binary to assert.
- `test/install-hooks.test.mjs` stops depending on a real `git` on `PATH` for the
  configuration cases; it keeps git only where git itself is the thing under test.
- One module to read when asking "what does this kit touch on my machine?" — the config,
  the install state, global git config, and the Claude settings file.
- Cost accepted: the shell hook retains a residue of duplicated default-posture logic for
  the missing-kit case. That residue is deliberate, small, and tested through real git.

## Alternatives considered

- **Leave the shell one-liner.** It works, and it is only one line of policy. Rejected: it
  is the copy that decides whether commits are blocked, it cannot be unit-tested, and it
  already disagrees with `lib/config.mjs` about nothing at all — which is exactly how a
  second implementation starts to disagree about something.
- **Have the hook call `bin/gate.mjs` and let the verdict decide fail-open.** Rejected: when
  the kit is missing there is no `bin/gate.mjs` to call. The missing-kit branch is
  irreducibly shell.
- **Revisit the posture itself.** Out of scope, and forbidden by the recorded decision:
  fail-open and loud is the default, `--fail-closed` is the deliberate opt-in.
