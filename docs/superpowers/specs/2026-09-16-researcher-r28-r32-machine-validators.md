# R28–R32 machine-checkable artifact validators

**Status:** normative validator specification; read-only implementation and offline conformance tests are present
**Governing contract:** benchmark v1.0.0 and the R28–R32 artifact inventory in the reliability repair plan
**Scope:** every R28–R32 artifact envelope, predecessor hash, role constraint, and package promotion pointer

This document turns the release evidence contract into deterministic checks. A validator must fail closed: an absent, malformed, future, mutable, unowned, hash-inconsistent, or prematurely promoted record is never treated as evidence.

## Validator interface

The eventual validator has one read-only entry point:

```text
researcher-release validate --root <record-root> --package R28|R29|R30|R31|R32 \
  --registry <artifact-registry.json> --roles <role-roster.json> \
  --pointers <pointer-directory> --json
```

The implementation is `fetchproof/lib/release-validator.mjs`, the CLI is
`fetchproof/bin/researcher-release.mjs`, and the checked-in schemas are under
`fetchproof/schemas/`. The companion `conform` command validates explicit JSON
files against one schema without loading a registry or writing the input tree.

Inputs are the package records, the immutable artifact registry, the role roster, the approved benchmark contract hash, and the current pointer set. The command never rewrites records or pointers. Exit codes are:

| Exit | Meaning |
|---:|---|
| `0` | Every required check is `PASS`; the package may be considered for promotion. |
| `1` | A present record violates a rule (`FAIL`), or a locked predecessor changed (`REOPEN`). |
| `2` | Evidence is absent, incomplete, unreadable, or the validator input itself is invalid (`INCOMPLETE`). |

The JSON result is deterministic except for an optional diagnostic timestamp:

```json
{
  "validatorVersion": "1.0.0",
  "package": "R29",
  "status": "PASS|INCOMPLETE|FAIL|REOPEN",
  "contract": {"benchmarkSpecVersion": "1.0.0", "benchmarkSpecSha256": "<64 lowercase hex>"},
  "artifacts": [{"artifactId": "R29-01", "recordId": "...", "status": "PASS", "checks": []}],
  "predecessorClosure": {"rootHashes": [], "visited": [], "missing": [], "mismatched": []},
  "roles": {"checked": [], "conflicts": []},
  "promotion": {"pointer": "...", "state": "not-published|provisional|ready|revoked", "status": "PASS"},
  "promotionTimelines": {"R28": [], "R29": [], "R30": [], "R31": [], "R32": [], "R33": []},
  "recoveryReceiptIds": [],
  "errors": []
}
```

When ledger evidence is supplied, `promotionTimelines` contains a redacted,
physical-sequence-ordered projection of each package's promotion intent,
commit, and revoke records (including record/event IDs, target and pointer
hashes, gate, state, timestamp, and chain hash). `recoveryReceiptIds` lists
unique recovery record IDs in ledger order, falling back to event or
transaction IDs. Payloads and secrets are never copied into the report; when
no ledger is checked the six package arrays and receipt list are empty.

The status reduction is fixed: `REOPEN` (locked-input drift) outranks `FAIL`, which outranks `INCOMPLETE`, which outranks `PASS`. The validator emits all findings, not only the first one.

## Canonical bytes and envelope hash

The complete cross-artifact profile is [`researcher-benchmark-release-canonical-serialization.md`](./2026-09-16-researcher-benchmark-release-canonical-serialization.md), profile `researcher-benchmark-c14n-v1`. The rules below are its R28–R32 envelope subset.

1. JSON is UTF-8 without BOM, uses LF line endings, and is parsed as JSON. Object keys are sorted recursively by UTF-16 code unit; array order is significant and never sorted.
2. The envelope is `{ "envelope": { ... }, "payload": { ... } }`. `payloadSha256` is SHA-256 over canonical UTF-8 bytes of `payload` only; the hash field is therefore not self-referential.
3. Markdown artifacts use the same envelope in an adjacent `<artifact>.envelope.json`; `payloadSha256` is SHA-256 over the canonical Markdown body (UTF-8, LF, exactly one final LF). The sidecar's `recordId` and relative path must match the body.
4. Every hash is lowercase hexadecimal, exactly 64 characters. Hashes are compared byte-for-byte; path names are never accepted as a substitute for a hash.
5. `state: "sealed"` is required for promotion evidence. A draft, mutable, superseded, or revoked record remains readable history but cannot satisfy a predecessor or pointer check.
6. Unknown positive schema revisions are a hard `FAIL` (`ENV-FUTURE-SCHEMA`); a non-positive or non-integer revision is `FAIL` (`ENV-SCHEMA`).

## Common envelope checks

Every R28–R32 record must contain these fields, with no duplicate or ambiguous spelling:

| Field | Machine rule |
|---|---|
| `artifactId` | Exact registry ID and path family, one of R28-01..04, R29-01..06, R30-01..05, R31-01..05, or R32-01..07. |
| `schema` | Positive integer supported by the registry entry. |
| `benchmarkSpecVersion` | Exactly `1.0.0`; no local or patch threshold version is valid. |
| `benchmarkSpecSha256` | Exactly the approved R28-01 contract hash. Every transitive record must match it. |
| `package` | Exact owning package (`R28`, `R29`, `R30`, `R31`, or `R32`). |
| `recordId` | Stable, unique within the artifact family; path-derived IDs must round-trip to the canonical path. |
| `ownerRole` / `ownerId` | Role and principal authorized by the role roster for this artifact and package. |
| `roleRosterSha256` | Exact hash of the authenticated role roster used for authorization and conflict checks. |
| `createdAt` | UTC ISO-8601 with `Z`; future timestamps and non-UTC offsets are rejected. |
| `predecessorHashes` | Ordered, unique lowercase SHA-256 list matching the registry selector exactly. |
| `payloadSha256` | Recomputed hash of canonical payload bytes. |
| `state` | Exactly `sealed` for evidence; pointer records additionally carry a permitted promotion state. |
| `visibility` | Registry value; candidate-visible records must contain no grader-only field or gold hash. |

The validator rejects unknown envelope keys, duplicate JSON keys, absolute/traversal paths, hashes of mutable working-tree files, and payload fields not allowed by the R28-02 schema manifest.

## Artifact registry and predecessor selectors

The registry is the machine-readable form of this table. `SELF` means the record's own payload hash; `ALL(...)` expands to every matching sealed record in canonical path order. External package checkpoints (`R26`, `R27`, `G3`, the approved v1.0.0 text, task-outline packet, and role roster) are supplied as authenticated hashes in the registry input; they are not guessed from filenames.

| Artifact | Required owner role | State / visibility | Required predecessor selector (ordered) | Pointer rule |
|---|---|---|---|---|
| R28-01 contract-pin | `contract-custodian` | sealed / grader-only | approved benchmark v1.0.0 text | no pointer field |
| R28-02 schema-manifest | `harness-maintainer` | sealed / grader-only | R28-01 | no pointer field |
| R28-03 report-schema | `report-maintainer` | sealed / grader-only template | R28-01, R28-02 | no pointer field |
| R28-04 release-manifest | `evidence-custodian` | sealed / grader-only | R26 checkpoint, R27 qualification, R28-01, R28-02, R28-03 | sole R28 pointer; `promotion.state=ready` only after Q0 checks |
| R29-01 task-visible | `task-author` | sealed / candidate-visible | R28-04, task-outline packet, expanded task/calibration packet | no promotion field |
| R29-02 gold | `gold-reviewer-a` or `gold-reviewer-b` | sealed / grader-only | R28-04, matching R29-01, matching R29-03 | no promotion field |
| R29-03 source-manifest | `gold-reviewer-a` or `gold-reviewer-b` | sealed / grader-only | R28-04, matching R29-01, source captures | no promotion field |
| R29-04 calibration batch/grades | `calibration-adjudicator` | sealed / grader-only append-only family | R28-04, matching R29-02, R29-03, role roster | no promotion field |
| R29-05 warm-manifest | `warm-manifest-steward` | sealed / grader-only | R28-04, matching R29-01, R29-03 | no promotion field |
| R29-06 gold-lock | `evidence-custodian` | sealed / grader-only | R28-04, ALL(R29-01..05) | sole R29 pointer; `promotion.state=ready` only after Q1 checks |
| R30-01 frozen-cold run | `run-operator` | sealed / grader-only | R29-06, R28-04, G3 closure | no promotion field |
| R30-02 run artifact manifest | `run-operator` | sealed / grader-only | matching R30-01 candidate/artifact hashes | no promotion field |
| R30-03 frozen-cold grade | `grader-a` or `grader-b` | sealed / grader-only append-only | matching R30-01, R30-02, R29-02 | no promotion field |
| R30-04 frozen-cold adjudication | `adjudicator` | sealed / grader-only append-only | matching R30-03 pair, R29-02 | no promotion field |
| R30-05 provisional-cold roll-up | `evidence-custodian` | sealed / grader-only | ALL(R30-01..04), R29-06 | sole R30 pointer; `promotion.state=provisional-cold`, never release-ready |
| R31-01 frozen-warm run | `run-operator` | sealed / grader-only | matching R30-01, R29-05, R29-06, G3 closure | no promotion field |
| R31-02 cold/warm comparison | `comparison-steward` | sealed / grader-only append-only | matching R30-01, R31-01, R29-05 | no promotion field |
| R31-03 frozen-release roll-up | `evidence-custodian` | sealed / grader-only | ALL(R30-01..05), ALL(R31-01,02,04,05), R29-06 | sole R31 pointer; `promotion.state=ready` only after Q3 checks |
| R31-04 frozen-warm grade | `grader-a` or `grader-b` | sealed / grader-only append-only | matching R31-01, R29-02 | no promotion field |
| R31-05 frozen-warm adjudication | `adjudicator` | sealed / grader-only append-only | matching R31-04 pair, R31-02, R29-02 | no promotion field |
| R32-01 live authorization | `live-authorization-owner` | sealed / grader-only | R31-03, R29-06, R28-04, G3 closure, explicit approval record | no package pointer; approval must precede every live run |
| R32-02 source pre/post capture | `source-verifier` | sealed / grader-only | R32-01, R29-03, R29-06 | no promotion field |
| R32-03 live-cold run | `run-operator` | sealed / grader-only | R32-01, R32-02, R29-06, R31-03 | no promotion field |
| R32-04 cost reconciliation | `cost-meter-owner` | sealed / grader-only append-only | R32-01, matching R32-03 set | no promotion field |
| R32-05 live-release roll-up | `evidence-custodian` | sealed / grader-only | ALL(R32-01..04,06,07), R31-03, R29-06 | sole R32 pointer; `promotion.state=ready` plus unexpired `live-verified-until` |
| R32-06 live-cold grade | `grader-a` or `grader-b` | sealed / grader-only append-only | matching R32-03, R29-02 | no promotion field |
| R32-07 live-cold adjudication | `adjudicator` | sealed / grader-only append-only | matching R32-06 pair, R32-02, R32-04 | no promotion field |

For a family artifact, the selector expands only records with the same task/run/repetition key. A missing member, extra member, duplicate member, or out-of-order hash is `PRE-MISSING`, `PRE-EXTRA`, `PRE-DUPLICATE`, or `PRE-ORDER` respectively.

## Predecessor-closure validator

For each artifact:

1. Resolve the registry selectors to authenticated record hashes; do not discover predecessors by scanning arbitrary files.
2. Compare the record's ordered `predecessorHashes` to the resolved list exactly.
3. Recompute each predecessor's payload hash and envelope hash, verify `state: sealed`, then recurse until an authenticated external root.
4. Require a single benchmark version/hash across the entire closure.
5. Reject cycles, missing roots, duplicate hashes, superseded records used as current inputs, and a predecessor whose package is later than its consumer.
6. Compare the previously sealed closure stored in the package pointer. Any changed hash is `REOPEN`, even when the new record is otherwise valid.

## Role and separation validator

The role roster is an authenticated, append-only record. Each assignment has `principalId`, `roleId`, `package`, `scope` (task/run/repetition or `*`), validity interval, and approval signature. The validator enforces:

Canonical `roleId` values are: `contract-custodian`, `harness-maintainer`, `report-maintainer`, `evidence-custodian`, `task-author`, `gold-reviewer-a`, `gold-reviewer-b`, `calibration-adjudicator`, `warm-manifest-steward`, `run-operator`, `grader-a`, `grader-b`, `adjudicator`, `comparison-steward`, `live-authorization-owner`, `source-verifier`, and `cost-meter-owner`. A registry entry may allow a two-value set (for example, `grader-a` or `grader-b`), but never an unqualified free-form role.

| Rule | Check | Failure |
|---|---|---|
| ROLE-01 | `ownerRole` and `ownerId` are authorized for the artifact and timestamp. | `FAIL` |
| ROLE-02 | R29 task author differs from both gold reviewers and the calibration adjudicator for the same task. | `FAIL` |
| ROLE-03 | Gold reviewer A differs from B; each review is blind to the other review and to candidate grades. | `FAIL` |
| ROLE-04 | R30/R31/R32 run operator differs from both graders and adjudicator for the same run. | `FAIL` |
| ROLE-05 | Grader A differs from grader B; neither sees the other sheet before sealing. | `FAIL` |
| ROLE-06 | Adjudicator is authorized and receives only the two sealed sheets plus the applicable gold/rule hashes. | `FAIL` |
| ROLE-07 | R32 cost-meter owner and live-authorization owner are independent of run operator and graders. | `FAIL` |
| ROLE-08 | A principal's package/scope interval does not overlap a prohibited role assignment, including aliases and service-account IDs. | `FAIL` |
| ROLE-09 | An expired authorization cannot sign a new live run or pointer. | `FAIL` |
| ROLE-10 | Role roster hash in every R28–R32 envelope and package pointer equals the reviewed roster hash. | `REOPEN` on drift; otherwise `FAIL` |

Candidate-visible R29-01 records may name the task author but must not include reviewer IDs, gold hashes, source locators marked grader-only, calibration labels, or pointer hashes for R29-02..06.

## Promotion-pointer validator

Descendant invalidation and atomic package rollback semantics for the pointer validator are defined in [`2026-09-16-researcher-r26-r33-descendant-invalidation-atomic-rollback.md`](./2026-09-16-researcher-r26-r33-descendant-invalidation-atomic-rollback.md).

Trap-validator report chaining into the ledger and the R29 promotion pointer is defined in [`2026-09-16-researcher-trap-validator-ledger-chaining.md`](./2026-09-16-researcher-trap-validator-ledger-chaining.md). The pointer validator must resolve `promotionCommitHash` to a committed `GL-1` `PASS` event before accepting R29 `ready`.

Only the pointer artifacts in the registry may publish a package state. Each pointer has this exact logical shape:

The current pointer is a projection of a committed ledger promotion event; its `promotionCommitHash` must resolve in the append-only ledger contract defined by [`2026-09-16-researcher-benchmark-qualification-ledger.md`](./2026-09-16-researcher-benchmark-qualification-ledger.md). A signed pointer without a committed ledger event is not promotable.

```json
{
  "artifactId": "R31-03",
  "promotion": {
    "state": "ready",
    "package": "R31",
    "targetHash": "<SELF payloadSha256>",
    "predecessorClosureHash": "<hash of ordered closure>",
    "requiredGate": "Q3",
    "publishedAt": "<UTC timestamp>",
    "previousPointerHash": "<hash or null>",
    "revokedDescendantHashes": []
  }
}
```

Pointer checks:

- `targetHash` equals the pointer record's sealed payload hash; filename-only or mutable aliases are rejected.
- The pointer's `package`, `requiredGate`, benchmark hash, role-roster hash, and predecessor closure equal the registry and gate matrix.
- `ready` is permitted only when every required artifact and gate is `PASS`; R30-05 may publish only `provisional-cold`.
- R32 `ready` requires an unexpired authorization and `live-verified-until` later than the validation instant. Expiry is a deterministic `FAIL`, not a warning.
- There is exactly one current pointer per package. A second `ready` pointer, a pointer to an unsealed record, or a pointer whose target is not the latest authenticated package record is `PTR-SOLE`, `PTR-STATE`, or `PTR-TARGET`.
- Publication is atomic: the validator requires a complete pointer, matching target/closure hashes, and a recorded prior pointer hash. A half-written or zero-byte pointer is `INCOMPLETE` and cannot be repaired in place.
- Revocation records name every descendant pointer whose transitive closure includes the revoked hash. A surviving descendant `ready` pointer is `FAIL`.
- Pointer rollback removes only the package promotion state and derived roll-up; immutable evidence and failure records remain present. The validator flags deletion of retained evidence as `PTR-RETENTION`.

## Artifact-specific semantic checks

After envelope, predecessor, and role checks, the validator applies the payload schema:

- **R28:** R28-01 approval is present and unsuperseded; R28-02 parser/self-test hashes and validity precedence match v1.0.0; R28-03 contains no local threshold/outcome override; R28-04 names authenticated R26/R27 identities and is the sole Q0 pointer.
- **R29:** exactly 24 task keys; 20 Frozen/4 Live; task/category/difficulty balance; candidate/gold visibility separation; two independent gold approvals; calibration labels include 0, 0.5, and 1; warm manifests exclude synthesis/claims/briefs/audits/notes; the R29-04 `GL-1` report is a committed ledger event with `PASS`; R29-06's closure includes that event and its Live-outcome approval hashes; R29-06 lock hash covers every member.
- **R30:** exactly one valid cold run per frozen task; no warm result; every run has artifact/cost/environment/prohibited-access evidence; independent grades and adjudications are present; R30-05 remains `provisional-cold`.
- **R31:** exactly one warm run per frozen task; each names immutable R29-05 and a matching R30 cold run; normalized outcome/claims/constraints/source-locator comparison is complete; eligible warm cost is zero; R31-03 contains no live result.
- **R32:** one authorization precedes access; four Live tasks × three repetitions; source pre/post hashes and material-drift decisions are complete; cost reconciliation is independent; all repetitions and grades are retained; `live-verified-until` is present and unexpired.

## Conformance fault cases

These cases are validator tests, not fixtures. Each must produce the listed result without modifying the input tree:

| Case | Mutation | Expected code/status |
|---|---|---|
| V-01 | Change one payload byte without updating `payloadSha256`. | `ENV-HASH` / `FAIL` |
| V-02 | Replace one predecessor hash with a valid hash from another task. | `PRE-MISMATCH` / `FAIL` |
| V-03 | Remove a transitive R28-01 predecessor. | `PRE-MISSING` / `INCOMPLETE` |
| V-04 | Set `benchmarkSpecVersion` to `1.0.1` or a future schema revision. | `ENV-CONTRACT` or `ENV-FUTURE-SCHEMA` / `FAIL` |
| V-05 | Assign the task author as gold reviewer B. | `ROLE-02` / `FAIL` |
| V-06 | Swap grader A/B sheets after sealing. | `ROLE-05` or `PRE-MISMATCH` / `FAIL` |
| V-07 | Add a gold locator to candidate-visible R29-01. | `VIS-GOLD-LEAK` / `FAIL` |
| V-08 | Publish R30-05 as `ready`. | `PTR-STATE` / `FAIL` |
| V-09 | Publish R32-05 after `live-verified-until`. | `PTR-EXPIRY` / `FAIL` |
| V-10 | Change a locked R29-03 source hash while retaining the old R29-06 pointer. | `REOPEN` / `REOPEN` |
| V-11 | Create a second current `ready` pointer for R31. | `PTR-SOLE` / `FAIL` |
| V-12 | Delete a retained failed R30 run during rollback. | `PTR-RETENTION` / `FAIL` |

Approval requires the validator to pass the registry, all predecessor closures, the role roster, and every conformance case. No implementation, fixture, network request, credential, or paid operation is part of this specification.
