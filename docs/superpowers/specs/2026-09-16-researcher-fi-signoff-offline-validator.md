# FI-01–FI-30 completed-sheet offline validator

**Status:** normative validator contract; specification only  
**Validator version:** `1.0.0`  
**Applies to:** completed FI-01–FI-30 execution/evidence workbook, normalized FI records, evidence manifest, authenticated role roster, and retained rollback/containment evidence  
**Traceability authority:** [`2026-09-16-researcher-v2-fault-traceability-matrix.md`](2026-09-16-researcher-v2-fault-traceability-matrix.md)  
**Form authority:** [`FI-01–FI-30 execution and evidence sign-off packet`](2026-09-16-researcher-v2-fi-execution-evidence-signoff/README.md)  
**Hash profile:** `researcher-benchmark-c14n-v1`

This contract defines a deterministic, offline, read-only validator for the completed
FI-01–FI-30 spreadsheet workbook. The workbook is the human attestation source. A strict
normalized sidecar for each case and a content-addressed evidence manifest supply the
machine-checkable representation needed for hashes, containment, signatures, and role
independence. The validator never fills a cell, repairs a hash, creates a fixture, recaptures
a source, opens a socket, reads a credential, changes a pointer, or spends a benchmark credit.

## 1. Invocation, isolation, and exit contract

The eventual command surface is:

```text
researcher-benchmark fi-signoff-validate \
  --workbook <completed-fi-workbook.xlsx> \
  --records <normalized-fi-record-directory> \
  --packet <FI-01-FI-30-execution-evidence-signoff.md> \
  --matrix <fault-traceability-matrix.md> \
  --evidence <evidence-manifest.json> \
  --roles <authenticated-role-roster.json> \
  --root <approved-release-root> \
  --at <UTC-validation-time> \
  --report <report.json>
```

The command reads only the explicitly supplied files and files named by the evidence
manifest. `--root` is the only authority for path containment. The validator must:

- run with network access disabled or provably unused; it must not resolve DNS, open sockets,
  invoke a browser, call an external service, or read environment secrets;
- accept only a regular, unencrypted `.xlsx` file; reject macros, external links, embedded
  objects, unsupported relationships, encrypted packages, and hidden FI sheets;
- reject absolute, drive-letter, UNC, traversal, NUL-containing, or symlink-escaping evidence
  paths before opening a file;
- parse workbook cells, JSON, and Markdown with duplicate-key detection and explicit UTF-8/LF
  rules; it must not silently repair malformed bytes;
- write only the requested `--report` path; and
- record hashes of every input and every manifest-named evidence object.

Exit status is fixed:

| Exit | Result | Meaning |
|---:|---|---|
| 0 | `PASS` | All 30 case sheets, projections, evidence, containment proofs, statuses, roles, and signatures pass. |
| 1 | `FAIL` | Present material is malformed, contradictory, tampered, unauthorized, unsafe, or not qualified. `REOPEN` is also a release rejection. |
| 2 | `INCOMPLETE` | A required sheet, field, record, evidence item, hash, containment proof, or signature is absent. |
| 3 | `BLOCKED` | Recovery, rollback, ledger, pointer, or containment state is ambiguous and cannot be authenticated safely. |
| 4 | `USAGE` | Invocation, root, version, profile, or validation-time arguments are invalid. |

`ROLLED-BACK` is a valid per-case disposition only when rollback evidence proves its target;
it never contributes to an overall `PASS`. A report with any non-`PASS` effective case status
is not a passing release qualification.

## 2. Workbook contract

### 2.1 Required workbook shape

The workbook must contain exactly 32 visible worksheets in this order:

1. `Index`
2. `Roll-up`
3. `FI-01` through `FI-30`, in numeric order

The validator rejects a missing, duplicate, renamed, hidden, reordered, or extra worksheet.
`Index` is a navigation and status projection; it is not an alternate source of evidence.

Each FI sheet must contain the fixed labels and sections from the approved packet:

- title containing the exact FI ID and case title;
- the `Common execution identity` block;
- the exact `Traceability:` line for the FI row;
- the exact `Expected safe handling:` line for the FI row;
- the `Execution / evidence fields` block with the case-specific row labels in packet order;
- `Reviewer signature / UTC`; and
- `Independent verifier signature / UTC`.

Unknown labels, duplicate labels, reordered rows, missing sections, non-empty cells outside the
approved template range, formulas in entry cells, and hidden rows that conceal required content
are rejected. Merged entry ranges are read from their top-left cell; the other cells in the
merge must remain empty.

### 2.3 Roll-up projection

`Roll-up` is the second visible worksheet and is a blank reviewer aggregation of the 30 FI
case sheets. It must contain the fixed sections `Roll-up identity`, `Blocker precedence and
release rule`, `FI-01–FI-30 case roll-up`, and `Reviewer attestations`. The case table must
contain exactly one row for each FI ID in numeric order, with columns for case
status/disposition, blocker IDs, observed precedence, evidence-manifest hash, containment
proof hash, rollback/closure hash, reviewer, independent verifier, and notes.

The roll-up status/disposition cells use the same per-case vocabulary and restrictions as the
matching FI sheet. They are a projection, not a second authority: a non-blank value must equal
the matching `Case disposition` cell, and a blank value is allowed only while the matching case
is blank and the workbook is being reported `INCOMPLETE`. The roll-up must not contain formulas
that manufacture `PASS` from blanks or replace any case evidence.

The static precedence table is normative and must state exactly:
`REOPEN > FAIL > BLOCKED > ROLLED-BACK > INCOMPLETE > PASS`.
`ROLLED-BACK` remains retained evidence and never contributes to a passing release. The roll-up
may show a computed decision only as `PASS` when all 30 case statuses and all required controls
pass; otherwise it is `NOT-READY`.

The attestation text and two signature fields are reviewer-facing evidence. The roll-up carries
the same common attestation as the approved release sign-off form:

> I attest that the evidence cited above is hash-consistent and independently reviewed, that role/secrecy separation holds, that rollback records are preserved, and that this form makes no claim for an unrun test, unverified locator, missing gold value, or unapproved live result.

### 2.2 Workbook hash and structural extraction

`workbookSha256` is the lowercase 64-hex SHA-256 of the exact `.xlsx` byte sequence supplied to
the command. XLSX is treated as an opaque binary artifact for this hash; ZIP member discovery
order, timestamps, and rendered previews are not substituted for the file hash.

The validator separately computes a structural projection for each sheet:

```text
projection = ordered visible sheet names + ordered approved labels + extracted top-left cell text
```

The projection is compared to the normalized sidecar. It is not itself a release hash and is
never used to rewrite the workbook. The sidecar carries `workbookSha256` and must repeat the
same value for all 30 records. A record naming a different workbook hash is a projection error.

### 2.3 Index projection

For each FI row, `Index` must match the matrix and the corresponding FI sheet on:

| Index column | Required authority |
|---|---|
| FI | Exact `FI-01`–`FI-30` identifier |
| Fault case | Matrix short-form case title |
| Repair package | Matrix repair package, including ranges and separators |
| Migration gate | Matrix migration gate, including `—` where none applies |
| Release gate / consequence | Matrix release consequence |
| Expected safe handling | Packet expected-handling sentence |
| Sheet | Exact matching sheet name |
| Completion status | Exact `Case disposition` from the matching FI sheet |

Any mismatch is `FI-INDEX-MISMATCH`. The Index status cell may be blank only when the matching
case sheet is also blank and the workbook is being reported as `INCOMPLETE`; a completed case
must project a non-empty status to both locations.

## 3. Normalized record bundle

There must be exactly one strict JSON sidecar per FI ID. The records directory must contain no
unowned extra record. Records use UTF-8 without BOM, canonical JSON, and
`additionalProperties: false` at every object level.

The machine-readable shape is shipped in
[`fetchproof/schemas/fi-signoff-sidecar.schema.json`](../../../fetchproof/schemas/fi-signoff-sidecar.schema.json).
The schema is intentionally shape-only: workbook projection equality, the FI-specific outcome
code, sidecar-to-manifest ownership, signature authorization, and cross-record identity checks
remain validator semantics and cannot be inferred from one standalone JSON document.

The following is the required logical shape; angle-bracket values are placeholders, not
fixtures or source values:

```json
{
  "recordVersion": "1.0.0",
  "fiId": "FI-01",
  "workbookPath": "relative/path/to/completed-fi-workbook.xlsx",
  "workbookSha256": "<64 lowercase hex>",
  "packetVersion": "1.0.0",
  "packetSha256": "<64 lowercase hex>",
  "matrixVersion": "1.0.0",
  "matrixSha256": "<64 lowercase hex>",
  "identity": {
    "releaseCandidateId": "<opaque ID>",
    "disposableMachineId": "<opaque machine ID>",
    "machineRole": "collector|builder|reviewer|verifier|other-approved-role",
    "reviewCwd": "<exact recorded cwd>",
    "rootRelativeCwd": "<canonical path under --root>",
    "cwdContainmentProofEvidenceId": "<manifest evidence ID>",
    "operatorPrincipalId": "<principal ID>",
    "operatorStartedAt": "<UTC ISO-8601>",
    "operatorFinishedAt": "<UTC ISO-8601>",
    "independentReviewerPrincipalId": "<principal ID>",
    "independentReviewerAt": "<UTC ISO-8601>"
  },
  "traceability": {
    "artifactRows": "<exact matrix value>",
    "repairPackage": "<exact matrix value>",
    "migrationGate": "<exact matrix value>",
    "releaseConsequence": "<exact matrix value>"
  },
  "expectedOutcomeCode": "<registered FI outcome code>",
  "observedOutcomeCode": "<registered FI outcome code>",
  "fields": [
    {
      "label": "<exact packet row label>",
      "entrySha256": "<64 lowercase hex>",
      "evidenceIds": ["<manifest evidence ID>"],
      "evidenceHashes": ["<lowercase SHA-256 values in the same order>"]
    }
  ],
  "containment": {
    "network": "NOT-ATTEMPTED|PROHIBITED-AND-BLOCKED|VIOLATION",
    "credentials": "NOT-ATTEMPTED|PROHIBITED-AND-BLOCKED|VIOLATION",
    "paidCredits": "NOT-ATTEMPTED|PROHIBITED-AND-BLOCKED|VIOLATION",
    "fixtureCreation": "NOT-ATTEMPTED|PROHIBITED-AND-BLOCKED|VIOLATION",
    "proofEvidenceIds": ["<manifest evidence ID>"]
  },
  "status": "PASS|INCOMPLETE|FAIL|REOPEN|BLOCKED|ROLLED-BACK",
  "statusReasonSha256": "<64 lowercase hex or null>",
  "rollback": {
    "targetHash": "<64 lowercase hex or null>",
    "receiptEvidenceId": "<manifest evidence ID or null>",
    "descendantClosureHash": "<64 lowercase hex or null>"
  },
  "signatures": {
    "reviewer": {
      "principalId": "<principal ID>",
      "role": "fi-reviewer",
      "signerKeyId": "<active key ID>",
      "signedAt": "<UTC ISO-8601>",
      "statementSha256": "<64 lowercase hex>",
      "signature": "<Ed25519 base64url without padding>"
    },
    "independentVerifier": {
      "principalId": "<principal ID>",
      "role": "fi-independent-verifier",
      "signerKeyId": "<active key ID>",
      "signedAt": "<UTC ISO-8601>",
      "statementSha256": "<64 lowercase hex>",
      "signature": "<Ed25519 base64url without padding>"
    }
  }
}
```

The sidecar is a machine projection, not a second attestation source. Every `label` must be
present exactly once on the corresponding FI sheet, and every `entrySha256` must equal the
SHA-256 of the exact UTF-8 cell text extracted from that entry cell (empty text is not a valid
completed entry). `fields` must appear in packet row order. The validator never places entry text
in its report; it reports only the label, hash, and error code.

The `Case disposition` row is represented by `status`, not duplicated as a free-text field in
`fields`. Its workbook cell and sidecar status must match exactly after ASCII trimming of only
the outer cell boundary; internal whitespace and case are significant and are not repaired.

## 4. Traceability and FI outcome registry

### 4.1 Source hashes and exact values

The validator recomputes `packetSha256` and `matrixSha256` under the canonical Markdown/text
profile. The packet and matrix versions must be `1.0.0`. A record cannot choose a different
repair package, artifact row, migration gate, or release consequence. The validator parses the
approved matrix and compares all four values exactly, including range punctuation.

The packet's case title, expected-safe-handling sentence, field labels, and status vocabulary are
also authoritative. A prose paraphrase, a shortened artifact range, a synonym for a status, or a
free-text replacement for a migration gate is not accepted.

### 4.2 Stable expected-outcome codes

To avoid grading a natural-language message, the normalized record must use the one registered
outcome code for its FI row. The code is a validator vocabulary, not a new fixture or expected
source value:

| FI | Required `expectedOutcomeCode` |
|---|---|
| FI-01 | `REFUSE-FUTURE-SCHEMA` |
| FI-02 | `REFUSE-MALFORMED-INPUT` |
| FI-03 | `QUARANTINE-INCOMPLETE-TEMP` |
| FI-04 | `RECOVER-OLD-UNRENAMED` |
| FI-05 | `RECONCILE-AMBIGUOUS-PUBLICATION` |
| FI-06 | `RECOVER-POINTER-OR-BLOCK-Q` |
| FI-07 | `REBUILD-VERIFIED-PREFIX` |
| FI-08 | `REJECT-HASH-TAMPER` |
| FI-09 | `REJECT-CANONICAL-DRIFT` |
| FI-10 | `REJECT-SPARSE-TABLE` |
| FI-11 | `BLOCK-INCOMPLETE-PROVENANCE` |
| FI-12 | `FREEZE-LEDGER-CHAIN` |
| FI-13 | `QUARANTINE-TORN-TAIL` |
| FI-14 | `FREEZE-MIDDLE-CHAIN-BREAK` |
| FI-15 | `REJECT-USAGE-INCONSISTENCY` |
| FI-16 | `DENY-UNAUTHORIZED-ROLE` |
| FI-17 | `BLOCK-HOOK-OVERRIDE` |
| FI-18 | `FAIL-CLOSED-SCAN` |
| FI-19 | `REFUSE-UNSAFE-LEASE-TAKEOVER` |
| FI-20 | `BLOCK-INCOMPLETE-CLAIM` |
| FI-21 | `REOPEN-DEPENDENTS` |
| FI-22 | `BLOCK-INCOMPLETE-HANDOFF` |
| FI-23 | `REFUSE-PLAN-FINGERPRINT-DRIFT` |
| FI-24 | `REJECT-BENCHMARK-GOLD-VIOLATION` |
| FI-25 | `INVALIDATE-CALIBRATION-ROLE-LEAK` |
| FI-26 | `EXCLUDE-INVALID-RUN` |
| FI-27 | `BLOCK-WARM-COST-OR-NETWORK` |
| FI-28 | `BLOCK-UNSAFE-ROLLBACK-TARGET` |
| FI-29 | `RECOVER-OR-BLOCK-AMBIGUOUS-BOUNDARY` |
| FI-30 | `NO-OP-OR-REQUALIFY` |

`observedOutcomeCode` must equal the expected code for `PASS`. An explicitly registered
secondary code may be used only when the case status is `BLOCKED`, `REOPEN`, `FAIL`, or
`ROLLED-BACK` and the sidecar includes a non-empty `statusReasonSha256`. A prose message alone
does not satisfy the outcome check.

## 5. Evidence manifest and hash enforcement

The evidence manifest is canonical JSON under `researcher-benchmark-c14n-v1`. Each entry has:

```json
{
  "evidenceId": "<unique ID>",
  "fiId": "FI-01",
  "fieldLabel": "<exact packet row label>",
  "artifactId": "<registered artifact or receipt ID>",
  "path": "<repository-relative POSIX path>",
  "profile": "researcher-benchmark-c14n-v1-json|researcher-benchmark-c14n-v1-text|researcher-benchmark-c14n-v1-jsonl|opaque-bytes",
  "byteLength": 0,
  "sha256": "<64 lowercase hex>",
  "predecessorEvidenceIds": []
}
```

The strict root and entry shape is shipped in
[`fetchproof/schemas/fi-evidence-manifest.schema.json`](../../../fetchproof/schemas/fi-evidence-manifest.schema.json).
The schema rejects unknown properties, invalid FI identifiers, unsupported profiles, malformed
hashes, unsafe relative paths, negative byte lengths, and duplicate predecessor IDs. Entry-ID
uniqueness, FI/field ownership, predecessor resolution, byte/hash verification, and
sidecar-to-manifest equality remain semantic validator checks.

The example is schema-shaped only. Normative rules are:

- every evidence ID is unique and belongs to exactly one FI row and one packet field;
- every sidecar evidence ID resolves to a manifest entry, and every `evidenceHashes` item
  equals the corresponding manifest hash in the same order;
- the validator reads bytes without text-mode conversion, checks byte length, applies the
  declared profile, and recomputes the declared SHA-256;
- evidence paths are repository-relative POSIX paths with no leading slash, drive/UNC prefix,
  traversal, NUL, or symlink escape; case and separators are compared exactly;
- a manifest-named file that is not referenced by any FI record is
  `EVIDENCE-UNREFERENCED`; it cannot silently satisfy a blank row;
- a field must carry at least one evidence ID unless the field is explicitly marked
  `NOT-APPLICABLE` by the approved packet. The FI packet has no optional evidence row by default;
- hashes are lowercase ASCII SHA-256, exactly 64 hex characters. Uppercase, shortened, base64,
  algorithm-prefixed, or filename-only values are invalid; and
- a valid hash proves byte identity only. The FI outcome, containment, role, and status checks
  remain mandatory.

The required evidence families are the packet's actual rows plus these cross-cutting checks:

1. injector/mutation identity and hash;
2. before/after snapshot or artifact hashes;
3. observed validator/migration status and registered outcome code;
4. case-specific receipt, pointer, ledger, recovery, rollback, or requalification evidence;
5. containment proof for network, credentials, paid credits, and fixture creation; and
6. independent reviewer and verifier signatures.

The validator must not accept a hash copied into a notes cell without its manifest entry and
recomputed bytes. Failed, invalid, torn, and quarantined evidence is retained and may be
referenced; it is not promoted merely because it has a hash.

## 6. Containment checks

Containment is a first-class gate, not an advisory note. For every FI case, the record must
state all four dimensions:

| Dimension | Passing declaration | Failing declaration |
|---|---|---|
| Network | `NOT-ATTEMPTED` or `PROHIBITED-AND-BLOCKED` | `VIOLATION`, missing, or unexplained external call |
| Credentials | `NOT-ATTEMPTED` or `PROHIBITED-AND-BLOCKED` | `VIOLATION`, secret read, or unredacted secret evidence |
| Paid credits | `NOT-ATTEMPTED` or `PROHIBITED-AND-BLOCKED` | `VIOLATION`, eligible request, or unaccounted spend |
| Fixture creation | `NOT-ATTEMPTED` or `PROHIBITED-AND-BLOCKED` | `VIOLATION` or an unapproved fixture path |

Every declaration must reference an evidence-manifest proof ID. A proof may be a signed process
audit, disposable-machine transcript, firewall/no-egress receipt, credential-access denial,
credit ledger snapshot, or filesystem containment record. The validator checks only the declared
bytes and their signer/role; it does not infer containment from an empty directory or from the
absence of a log.

The exact recorded `reviewCwd` remains in the human sheet for localization. The normalized
record additionally carries a canonical root-relative path proof. The validator requires the
recorded project root to resolve under `--root`, rejects path escapes and symlink escapes, and
reports the cwd only as a redacted hash or normalized relative form. It never expands a user
path by searching elsewhere on disk.

If a containment proof says a prohibited action was attempted but blocked, the case may still
be `PASS` only when the FI expected outcome is the refusal/block itself and no credential or
paid request escaped the boundary. An actual network, credential, fixture, or paid-credit
violation is `FAIL` and blocks every dependent release gate.

## 7. Status and dependency semantics

### 7.1 Per-case status rules

The workbook cell and normalized `status` must be one of the values permitted by the packet.
The allowed vocabulary is:

`PASS`, `INCOMPLETE`, `FAIL`, `REOPEN`, `BLOCKED`, and, only on FI-06, FI-21, FI-24, FI-25,
FI-29, and FI-30, `ROLLED-BACK`.

The validator applies these meanings:

- `PASS`: required fields/evidence are complete, all hashes and signatures verify, containment
  is clean, and the observed outcome equals the registered expected outcome;
- `INCOMPLETE`: the case was not run or a required field, evidence, hash, role, or signature is
  absent; it is never treated as a warning-only state;
- `FAIL`: an unsafe state was accepted, evidence was tampered or contradictory, a hard
  containment violation occurred, or the outcome/status does not satisfy the contract;
- `REOPEN`: a locked predecessor, benchmark/gold input, source, plan fingerprint, or dependent
  approval changed after the case was locked;
- `BLOCKED`: recovery, rollback, pointer, ledger, or containment state is ambiguous and cannot
  prove one authenticated known-good state; and
- `ROLLED-BACK`: a rollback was executed and its target, receipt, and descendant closure verify.
  A rollback is retained evidence, not a passing fault execution.

### 7.2 Dominant status and release decision

For deterministic workbook roll-up and report ordering, use:

`REOPEN > FAIL > BLOCKED > ROLLED-BACK > INCOMPLETE > PASS`.

The computed FI decision is `PASS` only when all 30 cases are `PASS`, all sidecars project
losslessly from the workbook, all required evidence and containment proofs verify, all roles and
signatures verify, and no rollback/reopen/descendant blocker is open. A non-`PASS` case may not
be hidden by an Index edit, a later rerun, or a reviewer note.

### 7.3 Dependency consequences

The validator does not invent release gates; it projects the matrix consequence:

- FI-01–FI-23, FI-28, FI-29, and FI-30 carry a transitive `G4` consequence. Any non-`PASS`
  result blocks Q0–Q5 or leaves the affected gate open as stated in the matrix.
- FI-24 blocks Q0–Q1 and revokes descendants.
- FI-25 blocks Q1 and R30–R33 descendants.
- FI-26 blocks Q2–Q5 roll-up promotion under validity precedence.
- FI-27 blocks Q3 and leaves the frozen release unqualified.

The validator reports the matrix consequence; it does not mutate a pointer or ledger. A
dependent FI record claiming `PASS` while an applicable predecessor is `INCOMPLETE`, `FAIL`,
`REOPEN`, `BLOCKED`, or `ROLLED-BACK` is `STATUS-PRECEDENCE` failure.

## 8. Signature and role enforcement

The two workbook signature cells remain the visible attestation fields. Their companion sidecar
signatures are cryptographic and machine-checkable. A completed signature cell must contain the
same principal ID, key ID, UTC time, and statement hash represented by its sidecar signature;
the Ed25519 signature itself is carried in the sidecar so the workbook stays printable.

Each sidecar signature is Ed25519 over the 32 raw digest bytes represented by
`statementSha256`. The statement is canonical JSON containing the FI ID, workbook hash, record
hash, status, ordered evidence IDs/hashes, containment declarations, and traceability values,
with the signature and its own hash omitted from the signed domain. The validator recomputes the
statement hash before checking the signature.

Role rules:

- reviewer and independent verifier must be authorized in the supplied role roster and valid at
  their recorded UTC times;
- reviewer and verifier must be distinct principals, distinct active keys, and distinct from the
  case operator where the roster requires independence;
- a principal/key may not sign two incompatible identities for the same FI record;
- a signer outside the assignment interval, a revoked/expired key, a copied statement hash, an
  invalid base64url signature, or a signature over a different workbook hash is invalid;
- a rollback actor or recovery actor may not be the independent verifier for that recovery
  evidence; and
- role roster, signature, and assignment files are themselves evidence with recomputed hashes.

Human initials or a typed name without a matching authenticated sidecar signature are
`SIGNATURE-MISSING`, not a passing attestation.

## 9. Validation pipeline

The implementation runs every stage and reports all errors, but later stages cannot promote an
earlier hard failure:

1. **Invocation and root:** validate arguments, version/profile, root containment, validation
   time, and report destination.
2. **Workbook package:** reject macros, external links, hidden FI sheets, malformed OOXML,
   formulas in entry cells, unsupported relationships, and non-32-sheet layouts.
3. **Template shape:** match exact titles, sections, labels, row order, merged ranges, and
   Index projections against the packet and matrix.
4. **Workbook hash:** compute exact opaque workbook SHA-256 and compare all sidecars.
5. **Sidecar schema/projection:** parse strict JSON, require exactly 30 FI IDs, recompute every
   entry-cell hash, and compare traceability, identity, status, and signature-cell tokens.
6. **Packet/matrix hashes:** apply canonical Markdown hashing and prove source versions and
   values match the sidecars.
7. **Evidence bytes:** resolve manifest entries, check path/length/profile/hash and ordered
   predecessor IDs, and reject unreferenced or missing evidence.
8. **Containment:** verify four declarations and their signed proof evidence; classify a
   violation as `FAIL` and an absent/ambiguous proof as `INCOMPLETE` or `BLOCKED`.
9. **Roles/signatures:** resolve principals and keys, verify intervals and independence, and
   check Ed25519 statements.
10. **Outcome semantics:** compare each observed outcome code with the FI registry and the
    packet's expected-safe-handling rule.
11. **Status/dependencies:** compute dominant status, apply matrix consequences, detect hidden
    non-`PASS` predecessors, and require rollback/reopen closure where applicable.
12. **Report:** emit the deterministic canonical JSON report and its report hash. Never overwrite
    a retained failed report with a later passing report.

## 10. Stable error vocabulary

Every error includes FI ID when known, a JSON Pointer or sheet/row label, expected form, observed
type or digest, and supporting evidence IDs. Reports never echo source values, candidate answers,
credentials, or protected gold content.

| Code | Condition | Effective result |
|---|---|---|
| `WB-MISSING` / `WB-READ` | Workbook absent, unreadable, encrypted, or not `.xlsx` | `INCOMPLETE`/`USAGE` |
| `WB-SHEET-COUNT` / `WB-SHEET-ID` | Missing, duplicate, extra, hidden, or reordered sheet | `FAIL` |
| `WB-PACKAGE-UNTRUSTED` | Macro, external link, unsupported relationship, or entry-cell formula | `FAIL` |
| `FI-TEMPLATE-SHAPE` / `FI-FIELD-MISSING` / `FI-FIELD-DUPLICATE` | Section, label, merge, or row-order defect | `FAIL`/`INCOMPLETE` |
| `FI-TRACEABILITY-MISMATCH` / `FI-EXPECTED-MISMATCH` | Title, artifact row, repair, migration, consequence, or expected handling differs | `FAIL` |
| `FI-INDEX-MISMATCH` | Index row differs from matrix or case sheet | `FAIL` |
| `RECORD-MISSING` / `RECORD-SCHEMA` / `RECORD-DUPLICATE` | Missing/extra/invalid sidecar or FI ID | `INCOMPLETE`/`FAIL` |
| `FI-PROJECTION-MISMATCH` | Sidecar hash/status/identity/evidence projection differs from workbook | `FAIL` |
| `HASH-FORMAT` / `HASH-MISMATCH` | Non-canonical or changed workbook/packet/matrix/evidence hash | `FAIL` |
| `EVIDENCE-MISSING` / `EVIDENCE-UNREFERENCED` | Missing referenced evidence or unowned manifest entry | `INCOMPLETE`/`FAIL` |
| `EVIDENCE-PATH` / `EVIDENCE-LENGTH` / `EVIDENCE-HASH` | Path escape, wrong byte length, profile, or digest | `FAIL` |
| `CONTAINMENT-MISSING` / `CONTAINMENT-AMBIGUOUS` | Required proof is absent or cannot establish the boundary | `INCOMPLETE`/`BLOCKED` |
| `CONTAINMENT-VIOLATION` | Network, credential, fixture, or paid-credit violation | `FAIL` |
| `OUTCOME-MISSING` / `OUTCOME-INVALID` / `OUTCOME-MISMATCH` | Missing, unregistered, or unexpected FI outcome code | `INCOMPLETE`/`FAIL` |
| `STATUS-MISSING` / `STATUS-INVALID` | Blank or unpermitted case disposition | `INCOMPLETE`/`FAIL` |
| `STATUS-PRECEDENCE` | Non-`PASS` predecessor hidden by a later status or Index value | `FAIL` |
| `ROLE-UNAUTHORIZED` / `ROLE-COLLISION` | Signer/operator not authorized or independence violated | `FAIL` |
| `SIGNATURE-MISSING` / `SIGNATURE-INVALID` | Missing, copied, expired, or cryptographically invalid signature | `INCOMPLETE`/`FAIL` |
| `ROLLBACK-EVIDENCE` / `DESCENDANT-OPEN` | Rolled-back target/receipt/closure missing or descendant still promoted | `BLOCKED`/`FAIL` |
| `REPORT-HASH` / `FINAL-DECISION-MISMATCH` | Report or computed decision does not match supplied status | `FAIL` |

## 11. Deterministic report shape

`recordsManifestSha256` is not an implicit directory or filesystem-walk hash. It is the
SHA-256 of a canonical JSON manifest containing the ordered list of the 30 record paths,
record IDs, byte lengths, and record hashes. The list is sorted by FI number and the manifest
uses the same strict JSON profile as the records themselves.

The report is canonical JSON under `researcher-benchmark-c14n-v1-json`:

```json
{
  "validatorVersion": "1.0.0",
  "validatedAt": "<supplied UTC time>",
  "inputs": {
    "workbookSha256": "<64 lowercase hex>",
    "packetSha256": "<64 lowercase hex>",
    "matrixSha256": "<64 lowercase hex>",
    "recordsManifestSha256": "<64 lowercase hex>",
    "evidenceManifestSha256": "<64 lowercase hex>",
    "roleRosterSha256": "<64 lowercase hex>"
  },
  "sheetResults": [],
  "effectiveStatus": "PASS|INCOMPLETE|FAIL|REOPEN|BLOCKED|ROLLED-BACK",
  "releaseConsequences": [],
  "containment": {"network": "PASS", "credentials": "PASS", "paidCredits": "PASS", "fixtureCreation": "PASS"},
  "signatureSummary": {"reviewed": 30, "verified": 30, "independent": true},
  "errors": [],
  "decision": "PASS|INCOMPLETE|FAIL|REOPEN|BLOCKED|ROLLED-BACK",
  "reportSha256": "<64 lowercase hex>"
}
```

`sheetResults` is in FI numeric order. Each result contains only `fiId`, computed status,
expected/observed outcome codes, evidence IDs and hashes, traceability match booleans, role and
signature booleans, and error codes. It does not contain entry prose. Errors are sorted by
stable stage order, FI number, sheet row, JSON Pointer, and error code. The report hash excludes
`reportSha256` itself. Re-running with identical bytes, inputs, and `--at` must produce
byte-identical output.

## 12. Conformance cases

The future implementation test plan must use disposable synthetic mutations of a valid completed
bundle. It must not create benchmark fixtures, fetch sources, access credentials, or spend
credits. The reviewable matrix is
[`FI validator fixture-free conformance matrix`](2026-09-16-researcher-fi-validator-conformance-matrix.md),
and its executable implementation is
[`fetchproof/test/fi-validator-conformance.test.mjs`](../../../fetchproof/test/fi-validator-conformance.test.mjs):
it keeps all mutations in memory, asserts deterministic mutation construction, and runs every
schema-backed case against the shipped sidecar/manifest schemas. Workbook projection, byte,
containment, role, signature, predecessor, and report assertions are recorded with their
required semantic error code so the eventual FI validator can consume the same matrix without
changing the cases. Each mutation exits nonzero and emits the listed code:

| Mutation | Required code |
|---|---|
| Remove `FI-17` sheet | `WB-SHEET-ID` |
| Rename or duplicate an FI sheet | `WB-SHEET-ID` |
| Hide a case sheet or add a macro/external link | `WB-PACKAGE-UNTRUSTED` |
| Change a matrix repair package in one sheet | `FI-TRACEABILITY-MISMATCH` |
| Change the expected-safe-handling sentence | `FI-EXPECTED-MISMATCH` |
| Change the Index status only | `FI-INDEX-MISMATCH` |
| Remove an identity or evidence entry | `FI-FIELD-MISSING` or `INCOMPLETE` |
| Replace a status with `done` or lowercase `pass` | `STATUS-INVALID` |
| Mark `PASS` while one evidence ID is absent | `EVIDENCE-MISSING` / `STATUS-PRECEDENCE` |
| Use uppercase, shortened, or algorithm-prefixed SHA-256 | `HASH-FORMAT` |
| Alter a manifest-named evidence byte | `EVIDENCE-HASH` |
| Add `..`, absolute, UNC, or symlink-escaping evidence path | `EVIDENCE-PATH` |
| Remove a network/credential/credit/fixture proof | `CONTAINMENT-MISSING` |
| Record a prohibited paid request or credential read | `CONTAINMENT-VIOLATION` |
| Change a sidecar entry hash or status without changing the workbook | `FI-PROJECTION-MISMATCH` |
| Copy the reviewer signature to the verifier or use an expired key | `ROLE-COLLISION` or `SIGNATURE-INVALID` |
| Mark `ROLLED-BACK` without a valid target/receipt/closure | `ROLLBACK-EVIDENCE` |
| Reopen a locked predecessor while leaving this case `PASS` | `STATUS-PRECEDENCE` / `DESCENDANT-OPEN` |
| Replace the registered outcome code with prose | `OUTCOME-INVALID` |
| Validate the same bundle twice with the same `--at` | Byte-identical report and hash |

## 13. Acceptance and promotion gate

The contract is accepted when all of the following are true:

- exactly one `Index`, one `Roll-up`, 30 FI sheets, and exactly 30 normalized records are
  validated in the required order;
- the Roll-up contains all 30 FI IDs once, uses the fixed blocker precedence, mirrors each
  case disposition without inventing a status, and retains the common attestation/signatures;
- blank required identity, evidence, hash, containment, or signature cells are `INCOMPLETE`
  and cannot be promoted;
- every case's title, traceability, expected handling, field labels, and Index row match the
  approved packet/matrix hashes;
- every evidence ID resolves to a manifest entry whose profile, path, byte length, predecessor
  order, and recomputed SHA-256 pass;
- every case has an authenticated disposable-machine/cwd record and four clean containment
  proofs, or a fail-closed refusal proof appropriate to its expected outcome;
- statuses use the approved vocabulary, reduce under the stated precedence, and cannot hide a
  non-`PASS` predecessor;
- reviewer and independent-verifier signatures verify against the workbook/record/evidence
  statement and the authenticated role roster, with no forbidden collision;
- `ROLLED-BACK`, `REOPEN`, and `BLOCKED` results retain their rollback, descendant, and recovery
  evidence and never count as `PASS`;
- the report is deterministic, canonical, redacted, hash-addressed, and written only to the
  requested path; and
- execution is offline, read-only, fixture-free, credential-free, and credit-free.

Only a report with exit `0`, computed decision `PASS`, zero errors, all 30 case statuses `PASS`,
and no open matrix consequence may be consumed by a release qualification gate. This
specification adds no implementation, fixture, source capture, credential, network call, or
paid request.
