# ADR-0121 — An ill-typed posture key resolves to its restrictive state

- **Date:** 2026-10-02
- **Status:** accepted
- **Area:** `lib/machine.mjs` (`shape`, `readMachineConfig`, `posture`), `lib/doctor.mjs`
  (`config-ill-typed`), `githooks/pre-commit` (the sh posture reader)
- **Refines:** [ADR-0020](0020-five-trusted-boundaries-that-did-not-hold.md) and
  [ADR-0023](0023-an-unestablished-role-does-not-collect.md), one level down
- **Lifts the freeze (ADR-0117)** for one item: the `config-ill-typed` doctor finding.

## Context

The machine config is hand-edited; the front README says so. Its three posture keys each
had a type check, and a value that failed it fell back to the default:

| key | typed | resolved to |
|---|---|---|
| `"failOpen": "false"` | a string, not the boolean | fail-open |
| `"evidencePolicy": "STRICT"` | not one of the two policies | pluralist |
| `"editGate": {"mode": "HARD-BLOCK"}` | not one of the three modes | ask |

Every default is the lax state. The `role` key beside them already went the other way: a
value that is present and not a role resolves to `unknown`, which refuses to collect
(ADR-0023), on the argument that a misspelling is an operator who meant something, and
guessing which is how a machine silently becomes one that may spend. A config that does not
parse at all fails closed (ADR-0020). Only the middle case, a config that parses with one
posture key the kit cannot read as typed, loosened the machine - and the hook's own sh
reader agreed with it, looking for the bare word `false` and reading a quoted `"false"` as
fail-open. Found by the arena break-test of 2026-10-02 (PR #198, F-2-1).

## Decision

A posture key that is **present and not of its type** resolves to its **restrictive**
state, and is **named**:

- `failOpen`: anything but the boolean `true` or `false` resolves to `false`;
- `evidencePolicy`: anything but `pluralist` or `strict` resolves to `strict`;
- `editGate.mode`: anything but `ask`, `hard-block` or `off` resolves to `hard-block`;
- `role` keeps ADR-0023's `unknown`.

An **absent** key keeps its default: absence is not a typo. `readMachineConfig` returns
`illTypedKeys` beside `retiredKeys`, the snapshot path shapes the same way, and `doctor`
reports each as a `config-ill-typed` warning naming the key, the values the kit reads, and
the state it resolved to. The hook's sh reader applies the same rule to `failOpen`: present
and not the unquoted word `true` is fail-closed; the parity table pins the two readers on a
quoted `"false"`, a quoted `"true"`, and a snapshot holding one.

## Alternatives rejected

- **Keep the default.** It is the state before this ADR, and it is the only place in the
  config where a typo relaxes a gate in silence.
- **Treat the whole config as unreadable** (ADR-0020's fail-closed, role `unknown`, a held
  snapshot). Consistent, but it discards the keys the operator typed correctly, and a
  snapshot would hold an older config over a newer one for a single quoted word.
- **Coerce** (`"false"` to `false`, `"STRICT"` to `strict`). Guessing what was meant is the
  thing ADR-0023 refused to do for `role`, and `"False"`, `"no"`, `0` and `"off"` would each
  need their own guess.
- **Name it without tightening it.** A warning the operator reads after the gate let the
  commit through is a warning that arrived late.

## Consequences

- A typo in a posture key can only make the machine stricter. The commit gate blocks, the
  edit gate hard-blocks, the evidence policy fails what it warned on - until `doctor`'s
  finding is acted on, and it says exactly which key.
- `posture()`'s exit code for a quoted `"false"` is 1, "a config that parses says
  fail-closed", in both readers.
- The `evidencePolicy` pin that read an unknown value as pluralist is superseded by this ADR.
