# Git-origin and path-authority snapshot validator

**Status:** v1.0 machine-checkable contract; offline and read-only  
**Source packet:** [`Git-origin and path-authority evidence snapshots`](2026-09-16-researcher-git-origin-path-authority-evidence-snapshots.md)  
**Schema:** [`git-origin-path-authority-snapshot.schema.json`](../../../fetchproof/schemas/git-origin-path-authority-snapshot.schema.json)  
**Implementation:** [`path-authority-validator.mjs`](../../../fetchproof/lib/path-authority-validator.mjs)  
**CLI:** `node fetchproof/bin/path-authority.mjs`

The validator checks a snapshot envelope produced by the disposable machine/Git
fixture or an explicitly approved release checkout. It never writes the snapshot,
transcript, profile, Git configuration, artifact, pointer, or ledger. It does not
contact the network and does not require a credential.

## Commands

Validate one complete envelope, including semantic and cross-reference rules:

```text
node fetchproof/bin/path-authority.mjs validate \
  --file <snapshot.json> [--schema <schema.json>] [--json]
```

Validate one or more files against the strict JSON Schema only:

```text
node fetchproof/bin/path-authority.mjs conform \
  --schema fetchproof/schemas/git-origin-path-authority-snapshot.schema.json \
  --file <snapshot.json> [--file <another.json>] [--json]
```

Exit status is `0` for `PASS`, `1` for `FAIL` or `REOPEN`, and `2` for
`INCOMPLETE` (missing input, unreadable JSON/schema, or missing required evidence).
The JSON result includes `validatorVersion`, `status`, `snapshotId`, the submitted
envelope hash, and stable `{code,message,path,status}` errors.

## Envelope shape

The schema is Draft 2020-12 shaped and rejects unknown properties at every object.
It requires identity/execution context, the external sentinel, path-authority rows,
all eleven isolated environment keys, all eight required Git-origin reads, artifact
before/after diff rows, containment assertions, a gate status, notes, and a
self-excluding canonical envelope SHA-256.

Hashes are lowercase SHA-256. `canonicalEnvelopeHash(snapshot)` removes only
`envelope_canonical_sha256` and hashes the recursive key-sorted canonical JSON
defined by the release canonicalization profile. Array order is retained.

## Semantic rules beyond JSON Schema

| Rule | Rejection |
|---|---|
| Gate/package mapping | `Q0→R28`, `Q1→R29`, `Q2→R30`, `Q3→R31`, `Q4→R32`, `Q5→R33` (`SNAP-GATE-PACKAGE`) |
| Snapshot phase | `recovery` requires `containment.recovery_result` (`SNAP-RECOVERY-MISSING`) |
| Principal separation | Producer and independent verifier IDs must differ (`SNAP-ROLE-COLLISION`) |
| Path authority | Settings are unique; observed and real paths are portable absolute paths below `fixture_root`; recorded `contained` must be true (`SNAP-DUPLICATE-SETTING`, `SNAP-PATH-*`) |
| Root boundaries | `cwd` and `project_root` are below `fixture_root`; the external sentinel is outside it (`SNAP-CWD-CONTAINMENT`, `SNAP-PROJECT-CONTAINMENT`, `SNAP-SENTINEL-CONTAINMENT`) |
| Environment isolation | All eleven keys appear once and host values are deliberately absent (`SNAP-ENV-*`, `SNAP-HOST-ENV`) |
| Git proof | All eight reads appear once and `origin_proven` is true (`SNAP-GIT-*`, `SNAP-ORIGIN-UNPROVEN`) |
| Artifact diff | Paths are safe relative paths; no unexpected or out-of-root change is accepted (`SNAP-DIFF-PATH`, `SNAP-UNEXPECTED-DIFF`) |
| Containment assertions | No symlink/junction escape, host mutation, sentinel mutation, or candidate/grader boundary break (`SNAP-SYMLINK`, `SNAP-HOST-MUTATION`, `SNAP-SENTINEL`, `SNAP-BOUNDARY`) |
| PASS consistency | A `PASS` envelope has no semantic errors and every path/Git row is `PASS` (`SNAP-PASS-*`) |
| Hash integrity | The self-excluding envelope hash recomputes exactly (`SNAP-ENVELOPE-HASH`) |

`INCOMPLETE` is reserved for absent, unreadable, or unproven evidence. A valid
containment, mutation, hash, precedence, or boundary violation is `FAIL`; a
post-lock change that requires descendant invalidation is represented as
`REOPEN` in the envelope and result. The validator does not infer a missing
origin or path from the host machine.

## Review and migration gates

The snapshot is attached to the matching Q0–Q5 envelope and BM overlay. Reviewers
must verify the snapshot hash, then inspect the raw Git transcript and before/after
manifest named by the envelope. A `PASS` snapshot does not itself close a release
gate; it is required evidence for the gate matrix. Any change to a snapshot,
transcript, fixture root, role, path authority, or Git origin receives a new
snapshot ID and hash. Prior bytes remain retained and any affected descendants are
reopened/revoked under the release rollback policy.

## Release-envelope binding

Every promotable R28–R33 target envelope carries a `pathAuthoritySnapshots`
object (in the envelope or payload) with `before`, `after`, and `recovery`
references. Each reference records `snapshotId`,
`envelopeCanonicalSha256`, `capturedAt`, `status: "PASS"`, and (when the
snapshot is stored below the release root) a safe relative `path`; promotion
requires that path so the validator can read and hash the evidence.

Before a `ready` or `provisional-cold` pointer is accepted, the release
validator requires all three references, rejects duplicate IDs and non-PASS
statuses, verifies the referenced self-excluding snapshot hash and its
package/gate/phase links, and applies a seven-day freshness window by default.
The CLI exposes this bound as `--snapshot-max-age-ms`; a missing, unreadable,
hash-drifted, or stale snapshot leaves promotion `INCOMPLETE` or `FAIL` and
never changes the release files.
