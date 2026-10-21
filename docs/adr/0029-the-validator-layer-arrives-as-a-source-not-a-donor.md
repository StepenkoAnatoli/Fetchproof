# ADR-0029 — The validator layer arrives as a source, not a donor

- **Date:** 2026-09-20
- **Status:** accepted
- **Area:** release-evidence validation, provenance, porting
- **Discharges:** ADR-0022's deferral, for the four modules named below
- **Depends on:** ADR-0007 (the map moves with the code), ADR-0028 (the map has no exception)

## Context

ADR-0022 deferred the release-evidence validator layer because "the validator specs are
defined against sealed records, signed promotion pointers, gold worksheets and evidence
packets that this archive excludes by policy". That was true of the archive.

It is not true of the machine. An inventory on 2026-09-20 found the layer **built** at
`FreeBuff/Deep-Research-Agent-main/fetchproof`:

| | |
|---|---|
| `lib/release-validator.mjs` | 1,324 lines |
| `lib/path-authority-validator.mjs` | 195 lines |
| `lib/fi-validator.mjs` | 122 lines |
| `bin/property-replay.mjs` | 59 lines |
| JSON schemas | 12 |
| Test files | 12 |
| Conformance runners | Node **and** Python |

Its validator tests were run in that tree and pass: **61 passed, 0 failed, 0 unsupported.**

And it is unprovenanced. That directory is **not a git repository** — no history, no
authorship, no record of what changed when or why. It has also diverged from this
repository: `lib/checks.mjs` and `lib/transport.mjs` differ, and it has no
`lib/serpapi.mjs`. Its *full* suite does not pass here; it stops in `machine.test.mjs`
on an EPERM unrelated to the validators.

So the layer is neither absent nor ready. It is working code with no account of itself,
sitting six days behind this repository — and this repository's entire premise is that a
claim without provenance is not evidence. Absorbing 1,700 lines of it in one commit would
be the project failing its own test in the most direct way available.

## Decision

**The other tree is a SOURCE to be read, not a donor to be transfused.** Code enters
under the same discipline any other code here would face.

Six rules, and they bind every module in this port:

1. **One module per commit**, with its tests and its schemas. A commit that lands two
   modules makes the second one unreviewable.
2. **Tests pass in THIS repository's runner**, under `bin/selftest.mjs`, not merely in
   the tree they came from. A test that only passes at home is a test about home.
3. **Every module is read before it is committed.** Defects found are fixed or recorded
   in the commit that carries them — never inherited silently. The source passing its own
   tests is evidence about the source, not a warrant.
4. **Nothing enters that depends on something unported.** The dependency order is fixed
   by the imports, not by convenience.
5. **`docs/ARCHITECTURE.md` moves in the same commit** (ADR-0007), and each ported module
   loses its `NOT BUILT IN THIS REPOSITORY` marker exactly when it becomes true.
6. **The provenance is this ADR and these commits.** The source cannot supply one, so the
   record of where this code came from, what was verified, and what was changed, is
   written here rather than assumed.

The import graph makes the order unambiguous, and is better than feared — all four are
**node-builtins only**, except one:

```
release-validator.mjs        node:crypto, fs, path, url          → first
path-authority-validator.mjs node:fs, path                       → independent
fi-validator.mjs             ./release-validator.mjs + builtins  → after the first
bin/property-replay.mjs      node:path, url                      → independent
```

None of them import `core.mjs`, `corpus.mjs`, `checks.mjs` or `transport.mjs`. The
divergence between the two trees does not touch them, which is why this port is tractable
at all.

## Alternatives considered

**Copy the tree wholesale.** One commit, done in a minute, and it makes the repository a
place where code appears without account. The kit refuses that from a *capture* — a page
fetched by hand is not evidence (ADR-0023) — and it would be incoherent to hold pages to
a standard the code is exempt from.

**Rebuild from the specs.** Maximum provenance, and it discards 1,700 lines that already
work and 61 tests that already pass, to re-derive them less well. Provenance is obtainable
here by reading and testing; it does not require retyping.

**Leave it deferred.** Defensible until 2026-09-20 and no longer: the reason ADR-0022
gave was that the artifacts were unavailable, and they are on this machine.

## Consequences

- Four modules, twelve schemas and twelve test files enter over several commits.
- `test/harness.mjs` gains `assertEqual` and `cleanup` — the only two helpers the ported
  tests use that this harness lacks. They are five and three lines.
- The ported tests do not call `describe()`; each gains one, so the runner attributes them
  to the right file instead of to whichever file ran last.
- `fetchproof/README.md` stops saying the layer is unbuilt, when it stops being true —
  and not before.
- ADR-0022 keeps its decision about *everything else* it deferred. This discharges it only
  for the four modules named above.

## Scope, measured — updated 2026-09-20

The plan this port began from named four modules. Those are the four the specs name, and
the layer is about twice that. Counted against the filesystem rather than estimated:

**Ported (5 commits, each independently revertible):**

| | Tests |
|---|---|
| `test/harness.mjs` — `assertEqual`, `cleanup` | — |
| `lib/release-validator.mjs` + 7 schemas | 10 |
| `lib/path-authority-validator.mjs` + `bin/path-authority.mjs` + 1 schema | 5 |
| `lib/fi-validator.mjs` + 2 schemas | 4 |
| `bin/researcher-release.mjs` | (unblocked 2 of the 10) |

**Remaining:**

- **5 library modules** — `fi-sidecar-conformance.mjs` (82), `ledger-conformance.mjs`
  (140), `property-replay.mjs` (326), `property-vector-conformance.mjs` (143),
  `r29-workbook-linkage-validator.mjs` (58)
- **7 binaries** — `property-replay.mjs`; three Node conformance runners
  (`fi-sidecar-conformance`, `ledger-conformance`, `property-vector-conformance`); and
  **three Python runners** (`fi_sidecar_conformance.py`, `ledger_conformance.py`,
  `property_vector_conformance.py`), which exist so cross-language equivalence is a test
  rather than a claim
- **2 schemas** — `r29-workbook-linkage`, `trap-register`
- **4 fixture sets** — `conformance/`: dashboard-status, fi-sidecar-evidence-manifest,
  property-graph-hash, qualification-ledger vectors
- **11 test files**, not 8. Beyond the nine already identified there are
  `hostile-argv-property.test.mjs` and `ledger-anchor-verification.test.mjs`, which no
  earlier count had caught — including mine. Both are named for behaviour this repository
  should want.

Plus at least one test helper (`test/fi-e2e-bundle.mjs`) that the adapter and e2e tests
share. Helpers are why two of those test files could not travel with `fi-validator.mjs`.

**Next milestone: the conformance foundation** — `ledger-conformance.mjs` and
`fi-sidecar-conformance.mjs` with their vectors and both language runners. That settles
the shared evidence format before replay and R29 linkage are ported on top of it, which
is the right order: the format is the thing the other modules agree about.

## Final scope — the port is complete, 2026-09-20

Eleven commits, each independently revertible, each with its tests green in this
repository before the next began.

| | Landed |
|---|---|
| Library modules | **9** — release-validator, path-authority-validator, fi-validator, r29-workbook-linkage-validator, ledger-conformance, fi-sidecar-conformance, property-vector-conformance, property-replay, plus the `unsafeCmdArgs` guard |
| Binaries | **8** — researcher-release, path-authority, property-replay, three Node conformance runners, and **three Python runners** |
| Schemas | **11** of 12 |
| Vector packets | **3** of 4 |
| Test files | **13**, and the suite is at **556 passing** |

### The two artifacts that did not come, and why

`trap-register.schema.json` and `dashboard-status-vectors.json` are **excluded on
purpose**. Nothing ported references either — no module, binary, test or fixture names
them, checked by grep across `.mjs`, `.json` and `.py`.

Rule 4 says nothing enters ahead of its dependents. These are the mirror case: artifacts
with no dependent at all. A schema that no code validates against is worse than a missing
one, because it looks authoritative while nothing keeps it true — it will drift with the
format it describes and nobody will notice until somebody trusts it. They arrive with the
code that needs them, or they do not arrive.

### The hostile-argv corpus, which also did not come

The source tree ships a 128-case hostile argv corpus with shrinking. It was copied in,
evaluated, and removed, and the reason is a compatibility boundary worth recording
permanently.

Its generator asserts every value it emits is hostile. Against this kit's guard it throws
on **case 4 of 128**. The two guards were then compared character by character:

- **Agree hostile:** `"` `%` `&` `|` `<` `>` `^` `(` `)` `` ` `` tab newline — every
  character that can actually break out of cmd quoting.
- **Disagree:** `'` `{` `}` `\` and **every non-ASCII character**.

That tree guards with a regex **allowlist**, so anything unlisted is hostile by
construction. This kit guards with a **denylist**, after the allowlist here was found
refusing every search query containing a space. The practical consequence of theirs:
it refuses `cafés`, `naïve`, and any Cyrillic or CJK query — the same defect as the space
exclusion, hit less often and therefore harder to find.

**This repository's contract explicitly permits `cafés and naïve façades`**, and there is
a test asserting it. Reusing their corpus would have imported the opposite contract
silently. The deterministic corpus in `test/hostile-argv.test.mjs` and the
`unsafeCmdArgs` guard are the correct boundary: same intent, our semantics, and
`resolveInvocation` calls the guard rather than filtering inline so the two cannot drift.

## What this ADR does not claim

That the ported code is good. It claims only that it will have been read, tested here, and
accounted for. A module that turns out to be wrong is a defect to fix in a later commit;
what this ADR prevents is the repository not knowing where it came from.
