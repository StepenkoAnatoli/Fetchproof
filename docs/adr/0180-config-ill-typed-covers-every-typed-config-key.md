# ADR-0180 — `config-ill-typed` covers every typed config key

- **Date:** 2026-10-18
- **Status:** accepted
- **Area:** `lib/machine.mjs` (`shape`, `readMachineConfig`), `lib/doctor.mjs` (`config-ill-typed`)
- **Extends:** [ADR-0121](0121-an-ill-typed-posture-key-resolves-to-its-restrictive-state.md),
  which lifted the freeze (ADR-0117) for the `config-ill-typed` finding on the posture keys
- **Lifts the freeze (ADR-0117)** for one item: the same finding, raised for the keys it skipped.

## Context

ADR-0121 named an ill-typed key only when it was a posture key: `failOpen`, `evidencePolicy`,
`editGate.mode`. Every other key read with a type test took its default when the type was
wrong, and nothing said so (#310, measured on `main` at 9a47439):

| config | what happened |
|---|---|
| `{"transport": ["http-keyless"]}` | the probed default ran; doctor failed `firecrawl-cli` on a machine its operator had configured for the keyless route |
| `{"skillRoots": "/one/path"}` | the root was never read; doctor checked the default root and passed |
| `{"serpapiKey": 12345}` | the search meter moved to another provider |
| `{"editGate": "hard-block"}` (the retired flat `claudeGate`, renamed by hand) | `ask`, with nothing named |

A misspelled *string* was already caught (`"transport": "firecrawl"` fails as an unknown
transport), so the gap was the non-string case, which JSON makes easy. The architecture map
recorded the narrower position for `skillRoots`: "a dropped entry is silent; naming it would
be a new finding, which the freeze does not allow". When a change can be read as a feature it
is one (AGENTS.md), so widening the finding needs this record.

## Decision

`config-ill-typed` covers **every key `shape()` reads with a type test**: `transport`,
`searchTransport`, `serpapiKey`, `searxngUrl`, `browserPath`, `projectSkillDir`, `maxAgeDays`,
`editGate.settingsPath` and `skillRoots` beside the three posture keys. A `skillRoots` list
that loses an entry is named too. Doctor says what each key should hold, for example
`"skillRoots" is present and not a list of paths`.

- A **non-posture** key keeps its default. A path, a transport or a credential has no
  restrictive value; the finding is the point.
- A **posture** key keeps ADR-0121's restrictive state. An `editGate` that is not an object
  is the mode key ill-typed one level up: `editGate.mode` is named and resolves to
  `hard-block`.
- An **absent** key, and the empty `settingsPath` the installer itself writes, name nothing.

## Alternatives rejected

- **Posture keys only** (ADR-0121 as it stood). That is the defect: a wrong type was treated
  as absent in silence, and the operator who meant something learned nothing until a
  collection ran on the wrong route or a skill went unchecked.
- **A new finding name for non-posture keys.** One finding with per-key wording already says
  which key and what it should hold. A second name would be a new check, which the freeze
  forbids, for no information the first does not carry.
- **Treat the whole config as unreadable on a wrong type.** ADR-0121 rejected this for the
  posture keys, for the same reason it fails here: it discards the keys the operator typed
  correctly.
- **Leave a non-object `editGate` at `ask`.** The likeliest cause is a hand rename of the
  retired `"claudeGate": "hard-block"`, an operator tightening the gate; `ask` loosened it in
  silence, the case ADR-0121 exists to prevent.

## Consequences

- `doctor` names a wrong-typed key once per key, with its expected shape, and the default in
  force. Nothing that was well-typed or absent changes.
- JSON that parses to a non-object is a separate #310 change, not this finding: the config is
  `unreadable` (held from the snapshot, else fail-closed with role `unknown`).
