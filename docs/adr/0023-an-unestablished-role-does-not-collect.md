# ADR-0023 — A role the kit cannot establish does not collect

- **Date:** 2026-09-17
- **Status:** accepted; the `ROLE_STATES` constant was removed 2026-10-17 (#297) - nothing read it; `unknown` stays a state `machineRole()` resolves to, never a declarable role
- **Area:** machine policy, collection
- **Refines:** [ADR-0010](0010-machine-roles.md) — one clause of it, named below. ADR-0010 is left unedited, in its own words.

## Context

ADR-0010 settled the two-machine model and chose a default:

> **The default is `collector`.** A missing, unknown, or corrupt value reads as
> `collector`. That is the stricter role (a collector without a key *is* blocked), so a
> machine that was never told its role is held to the higher standard.

The reasoning holds for **missing**. It does not hold for the other two, and the 2026-09-16
researcher review (F16) reproduced why: with a corrupt config and no last-good snapshot,
`machineRole()` returned `collector` and `collectionPolicy()` returned `mayCollect: true`.

Two things had been conflated.

**"Stricter" points the other way for collection.** A collector without a key is blocked
from collecting *by the credential*, which is what made `collector` look like the cautious
answer. But a collector **with** a key is the role that may spend the operator's credits,
and a builder is the role that may not. Read as a collection permission — which is the only
thing the role decides — `collector` is the *permissive* value, and it was being handed to
every machine whose config could not be read.

**The snapshot rationale does not cover the cases that matter.** ADR-0020's fallback rests
on "a machine can only have set those knobs in a config that parsed, and every parse
snapshots it." That is true of configs this kit wrote. It is not true of a hand-written
config, a machine image copied with a half-written file, a home directory where the
snapshot write was denied, or a restore that brought the config without its sidecar — and
those are precisely the situations where a corrupt config appears.

A third case sat underneath both: a config that parses perfectly and says
`"role": "collecter"`. The kit silently substituted `collector` — the permissive value —
for a word whose author plainly meant something and may have meant `builder`.

## Decision

**`unknown` is a third role STATE, and an unknown role does not collect.**

- `machineRole()` returns `collector | builder | unknown`. `ROLES` stays the two an
  operator may **declare**; `ROLE_STATES` names the three the kit may **resolve to**.
  Nobody can write `"role": "unknown"` into a config and have it mean something.
- A role resolves to `unknown` in exactly two cases: the config is unreadable and there is
  no last-good snapshot, or the config parses and names a role the kit does not know.
- `collectionPolicy()` returns `mayCollect: false` for `unknown`, carrying the reason (which
  file, which parse error, or which unrecognised word) and the remedy
  (`install-hooks.mjs --role collector|builder`). `research.mjs` and `decompose.mjs`
  already refuse on that answer, before any adapter or credential is consulted.
- `doctor` reports `machine-role: unknown` as a **blocker**, not a note.
- **An absent config is untouched**: it still reads `collector` and still collects. ADR-0010's
  default is the right answer for a machine that was never configured, and it is the only
  one of the three cases whose state the kit can actually infer.

`failOpen` and `role` are now the two knobs the no-snapshot fallback tightens. The others
(`evidencePolicy`, `editGate.mode`, `transport`) keep ADR-0020's treatment: they have no
safe restrictive default, so they fall back to the documented one.

## Consequences

- A machine whose config was corrupted between runs stops spending credits and says why,
  instead of quietly adopting the role that may spend them.
- The cost is one more state an operator can land in, and one command to leave it. That is
  the right trade: the failure it replaces is silent and paid for in credits, and the
  recovery is a single declaration that is recorded in a config file.
- A typo in `role` is now visible instead of absorbed. Some operator somewhere will hit
  this and find it pedantic; the alternative is the kit deciding, on their behalf and
  without saying so, that a misspelling meant the permissive value.
- ADR-0010's table still describes the two machines correctly. Only its default clause is
  narrowed, to "missing".

## Rejected alternatives

- **Keep `collector` and rely on the missing key.** This is ADR-0010's position, and it is
  what F16 reproduced. It only protects a machine that happens to be unauthenticated —
  a collector with a key, which is the normal case on the operator's own PC, collects
  freely on a role nobody established.
- **Fall back to `builder` instead.** Superficially attractive: `builder` is the
  non-spending role, so a corrupt config would fail safe. Rejected because it is still a
  guess, and a wrong one in the opposite direction — it would silently disable collection
  on the collector machine, and the operator would be debugging a kit that refuses to work
  rather than reading a line that says the role could not be established. `unknown` refuses
  the same work and names the cause.
- **Refuse everything (treat an unknown role as a broken machine).** Rejected: `--dry-run`,
  `--status`, `preflight`, `doctor` and `handoff` spend nothing and are exactly what an
  operator needs in order to diagnose the config. Only the metered half stops.
- **Accept a misspelled role case-insensitively, or fuzzy-match it.** Rejected for the same
  reason the kit refuses rather than re-quotes an unsafe argument: a near-miss is a signal,
  and repairing it in silence removes the signal along with the typo.
