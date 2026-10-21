# Release evidence, by example

Everything here is **synthetic**. No record is a real sign-off, no signature is a real
signature, and the two anchor hashes are literally `aaaa…` and `bbbb…` so that nobody can
mistake one of these files for a production template.

Run all of it, offline, with no credential:

```bash
node fetchproof/examples/release-evidence/run-example.mjs
```

## Why this exists

`researcher-release validate` checks a *package* — a set of files that refer to each
other. Reading the schemas one at a time tells you the shape of each file but not how they
connect, so the usual way in was to assemble something plausible and learn the
relationships from error messages. These six packages are the shortcut.

## The smallest package that passes

`01-minimal-pass/` is four things:

```
01-minimal-pass/
  artifact-registry.json     the INDEX: which artifacts exist, who owns them, where they live
  role-roster.json           the AUTHORITY: which principal holds which role, and when
  records/R28-01.json        the RECORD: an envelope wrapping a payload, with its hash
  pointers/                  required, and legitimately empty for a sealed R28 package
```

Validate it:

```bash
node fetchproof/bin/researcher-release.mjs validate \
  --root fetchproof/examples/release-evidence/01-minimal-pass \
  --package R28 \
  --registry fetchproof/examples/release-evidence/01-minimal-pass/artifact-registry.json \
  --roles fetchproof/examples/release-evidence/01-minimal-pass/role-roster.json \
  --pointers fetchproof/examples/release-evidence/01-minimal-pass/pointers
```

### How the four files refer to each other

```
role-roster.json ──── rosterSha256 ─────┐
                                        ├──> both must match, or the record is
records/R28-01.json ─ roleRosterSha256 ─┘    anchored to a roster nobody agreed to

artifact-registry.json
  artifacts[0].artifactId  ──> must equal the record's artifactId
  artifacts[0].path        ──> where the record is found, RELATIVE TO --root
  artifacts[0].ownerRoles  ──> must contain the record's ownerRole
                               ...and the roster must grant that role to ownerId

records/R28-01.json
  payload                  ──> the actual content
  payloadSha256            ──> sha256(canonicalJson(payload)) - computed, never typed
```

The one rule worth internalising: **`payloadSha256` is derived.** It is the SHA-256 of the
canonical JSON of `payload` — keys sorted, no whitespace. Edit the payload by hand and the
record stops verifying, which is the entire point. `build.mjs` computes it; never write one
by hand.

## The other five packages

Each is `01-minimal-pass` with exactly one thing changed, so a `diff` shows you the defect:

| Package | Result | Exit | Code | What it teaches |
|---|---|---:|---|---|
| `01-minimal-pass` | PASS | 0 | — | the shape of a complete package |
| `02-fail-payload-hash` | FAIL | 1 | `ENV-HASH` | payload edited after sealing |
| `03-behaviour-unregistered-record-is-ignored` | **PASS** | 0 | — | see below — this one is not a failure |
| `04-fail-missing-record` | INCOMPLETE | 2 | `RECORD-READ` | registry declares a record that is absent |
| `05-fail-owner-role-not-granted` | FAIL | 1 | `ROLE-01` | correct hashes do not make a record authorised |
| `06-fail-future-schema` | FAIL | 1 | `ENV-FUTURE-SCHEMA` | refuse an unknown revision rather than guess |

```bash
diff -r 01-minimal-pass 02-fail-payload-hash
```

### Read `03` before you rely on a PASS

`03` has a second record, `R28-02`, sitting on disk. The registry does not list it. **It
passes.**

The registry is the index: validation walks the artifacts the registry *declares*, so a
file it does not name is never opened, never hashed, and never mentioned. `validate`
answers:

> is everything the registry declares present, intact, and owned by someone authorised?

It does **not** answer "is this directory free of anything unexpected". A stray, stale, or
planted record is invisible to it. If you need that second question answered, the registry
itself has to be the artifact you review.

### INCOMPLETE is not FAIL

`04` returns `INCOMPLETE` (exit 2), not `FAIL` (exit 1), and the distinction is load-bearing:

- **FAIL** — something was judged, and it was wrong.
- **INCOMPLETE** — something could not be judged at all.

A missing record produces no verdict about that record, so claiming `FAIL` would assert
more than the validator knows. Scripts should branch on all three.

## Adapting this for real evidence

1. Copy `01-minimal-pass/` and rename it.
2. Replace `benchmarkSpecSha256` and `roleRosterSha256` / `rosterSha256` with your real
   anchor hashes — they are `aaaa…`/`bbbb…` here precisely so this step cannot be skipped
   by accident.
3. Replace `principalId`, `roleId`, and the approval with real roster entries.
4. Put your real content in `payload`, then **recompute** `payloadSha256`:
   ```js
   import { canonicalJson, sha256 } from './fetchproof/lib/release-validator.mjs';
   sha256(canonicalJson(payload))
   ```
5. Add one registry entry per record.
6. Re-run `validate` and work through the codes.

This is a **teaching example, not a production template.** It covers one sealed R28
package with a single record and no promotion pointers. Real packages may carry pointer
directories, qualification ledgers, checkpoints, signed heads, and FI bundles — all of
which `validate` accepts through further flags (`--ledger`, `--head`, `--keys`,
`--genesis`, `--checkpoints`). Those are deliberately out of scope here; adding them would
make the smallest example stop being small.

## Regenerating

```bash
node fetchproof/examples/release-evidence/build.mjs
```

The packages are **checked in** rather than generated on demand, because the point of an
example is that you can open the files. `build.mjs` exists so their hashes stay correct
when a rule changes: run it, and `git diff` shows exactly which bytes moved.

`run-example.mjs` validates what is on disk and never calls `build.mjs`. If the two
disagree, that is a finding — not a build step somebody forgot.
