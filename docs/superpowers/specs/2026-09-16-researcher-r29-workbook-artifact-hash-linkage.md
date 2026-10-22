# R29 workbook row to artifact-hash linkage

**Status:** design-only reviewer contract; no completed values or fixtures
**Bundle:** researcher benchmark v1.0.0, 24-task gold-authoring worksheets
**Purpose:** make every workbook row resolve to the sealed R29 evidence for the same task
**Profile:** `researcher-benchmark-c14n-v1`
**Governing contracts:** R28-R32 machine validators, GL-1 gold-lock gate, and release
canonical serialization

This document defines the row-level linkage that a reviewer workbook must carry after R29
completion. The checked-in worksheet bundle remains blank. A builder may materialize a
spreadsheet from this contract, but must not invent hashes, copy source values, or treat a
filename as evidence.

## 1. Row identity and scope

The workbook has exactly 24 data rows, in the approved task order:

`ST-01..ST-04`, `VO-01..VO-04`, `CO-01..CO-04`, `UN-01..UN-04`,
`CC-01..CC-04`, `AE-01..AE-04`.

`taskId` is the immutable primary key. It is copied from the worksheet filename and the
matching R29-01 task record; it is never generated from the row number. Row numbers are
display-only and may change when a workbook is sorted. Duplicate, missing, unknown, or
cross-task IDs fail closed.

The workbook is a derived, reviewer-only index. R29 records, manifests, the role roster,
and the qualification ledger remain authoritative and read-only. A workbook cell is not
evidence unless its hash resolves to an authenticated sealed record.

## 2. Canonical row contract

Each row contains the following groups. All `recordHash` and `payloadSha256` values are
lowercase 64-character SHA-256 strings over the canonical bytes in the release
serialization profile. Blank required fields mean `INCOMPLETE`; `N/A` is permitted only
where this contract explicitly marks a member as out of scope and a reason is recorded.

| Group | Required row fields | Meaning |
|---|---|---|
| Identity | `taskId`, `worksheetPath`, `worksheetHash`, `track`, `rowVersion` | Stable task key and the completed worksheet bytes. `worksheetHash` is the hash of the sealed worksheet artifact, not its filename. |
| R29 task | `taskArtifactId=R29-01`, `taskRecordId`, `taskRecordHash`, `taskPayloadSha256`, `taskMemberKey` | Candidate-visible task record for this exact `taskId`. `taskMemberKey` must equal `taskId`; no gold/source fields may be present in this record. |
| Gold | `goldArtifactId=R29-02`, `goldRecordId`, `goldRecordHash`, `goldPayloadSha256`, `goldMemberKey` | Grader-only gold record for the same task. `goldMemberKey` must equal `taskId`; its predecessor list must name this row's R29-01 and R29-03 records. |
| Source | `sourceArtifactId=R29-03`, `sourceRecordId`, `sourceRecordHash`, `sourcePayloadSha256`, `sourceMemberKey` | Source-manifest record and replayable locator set for the same task. `sourceMemberKey` must equal `taskId`; the workbook stores no source values or credentials. |
| Calibration | `calibrationArtifactId=R29-04`, `calibrationRecordId`, `calibrationRecordHash`, `calibrationPayloadSha256`, `calibrationMemberKey` | Sealed calibration/grade/adjudication record for the same task and trap. `calibrationMemberKey` must equal `taskId` (and, where present, `trapId` must be `${taskId}-T`). |
| Warm manifest | `warmArtifactId=R29-05`, `warmRecordId`, `warmRecordHash`, `warmPayloadSha256`, `warmMemberKey`, `warmMemberState`, `warmScopeReason` | The sealed warm-manifest family and its task member. The aggregate artifact hash is required for every row. A member hash is required for Frozen rows; Live rows use `warmMemberState=NOT-APPLICABLE` and the fixed reason below. |
| Lock anchor | `lockArtifactId=R29-06`, `lockRecordId`, `lockRecordHash`, `lockPayloadSha256`, `lockMemberKey`, `predecessorClosureHash` | The gold-lock record that binds all five R29 families. `lockMemberKey` equals `taskId`; `predecessorClosureHash` is recomputed from the ordered R28-04 and R29-01..05 closure. |
| Review state | `rowStatus`, `ownerId`, `independentVerifierId`, `lastVerifiedAt`, `blockerIds`, `rollbackRecordId` | Derived status and accountability. `lastVerifiedAt` is UTC and is not part of an artifact hash. |

`recordHash` is the canonical envelope hash. `payloadSha256` is retained alongside it
when the record exposes that secondary digest. A member hash is the canonical hash of the
task entry inside an aggregate R29 family; it is never substituted with a row number,
path, URL, or display label. If a family is physically one record per task, the member
hash equals that record's payload/member hash and the `recordId` must still be recorded.

## 3. Required links for every row

The following five links are mandatory for a completed row. Each link must resolve through
the authenticated R29 registry and the row's `taskId`; a hash that resolves only by
scanning an arbitrary directory is invalid.

| Workbook link | R29 family | Matching key | Required predecessor/equality check |
|---|---|---|---|
| Completed task | R29-01 | `taskMemberKey == taskId` | R28-04, task-outline packet, and expanded packet are the registered predecessors. |
| Gold | R29-02 | `goldMemberKey == taskId` | Gold record names the exact R29-01 and R29-03 record hashes; two independent gold approvals are sealed. |
| Source | R29-03 | `sourceMemberKey == taskId` | Source record names the exact R29-01 and authenticated source captures; every required locator replays or has the approved bounded-unknown procedure. |
| Calibration | R29-04 | `calibrationMemberKey == taskId` and trap `${taskId}-T` | Calibration record names the matching R29-02/R29-03 hashes, role roster hash, grader observations, and adjudication when required. |
| Warm manifest | R29-05 | `warmMemberKey == taskId` for Frozen only | Warm record names the exact R29-01/R29-03 hashes. It contains no synthesis, claims, briefs, audits, notes, or candidate answers. |

The row also carries the R29-06 lock anchor so that a reviewer can prove all five links
were sealed together. A row is not `PASS` merely because each individual hash is valid:
the lock's ordered predecessor closure and promotion state must also be valid.

### Warm-manifest applicability

R29-05 covers the 20 Frozen tasks. `VO-01`, `VO-02`, `VO-03`, and `VO-04` are Live and
therefore do not have a warm-run member. Their rows still record the R29-05 aggregate
`warmRecordHash` and use exactly:

```text
warmMemberState = NOT-APPLICABLE
warmScopeReason = "Live task excluded by R29-05 Frozen-only warm-manifest scope"
```

The Live row remains eligible for R29 PASS only when its R29-06 lock and separate
same-outcome, unexpired dual live-outcome approval are valid. A blank warm aggregate hash
or an invented Live member hash is `INCOMPLETE` (before lock) or `REOPEN` (after lock).

## 4. Blank workbook row template

This is the column contract, not a populated workbook. The 24 rows must use the task IDs
listed in Section 1 and leave all source-dependent values empty until the corresponding
R29 record is sealed.

| taskId | worksheetHash | R29-01 recordHash | R29-02 recordHash | R29-03 recordHash | R29-04 recordHash | R29-05 recordHash | warmMemberHash | warmMemberState | warmScopeReason | R29-06 lockHash | closureHash | rowStatus | blockerIds |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ST-01 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| ST-02 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| ST-03 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| ST-04 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| VO-01 |  |  |  |  |  |  |  | NOT-APPLICABLE | Live task excluded by R29-05 Frozen-only warm-manifest scope |  |  | INCOMPLETE |  |
| VO-02 |  |  |  |  |  |  |  | NOT-APPLICABLE | Live task excluded by R29-05 Frozen-only warm-manifest scope |  |  | INCOMPLETE |  |
| VO-03 |  |  |  |  |  |  |  | NOT-APPLICABLE | Live task excluded by R29-05 Frozen-only warm-manifest scope |  |  | INCOMPLETE |  |
| VO-04 |  |  |  |  |  |  |  | NOT-APPLICABLE | Live task excluded by R29-05 Frozen-only warm-manifest scope |  |  | INCOMPLETE |  |
| CO-01 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| CO-02 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| CO-03 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| CO-04 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| UN-01 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| UN-02 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| UN-03 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| UN-04 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| CC-01 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| CC-02 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| CC-03 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| CC-04 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| AE-01 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| AE-02 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| AE-03 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |
| AE-04 |  |  |  |  |  |  |  |  |  |  |  | INCOMPLETE |  |

The compact table shows the required `recordHash` columns. Companion/hidden columns must
also retain, for every R29-01..05 link, the `artifactId`, `recordId`, `memberKey`,
`memberHash`, and `payloadSha256` (and `contentSha256` for a body-only artifact when the
registry emits it). The R29-06 lock link similarly retains `recordId`, `memberKey`,
`memberHash`, and `payloadSha256`. These secondary fields prevent an aggregate hash from
being mistaken for a task member hash.

For auditability, the workbook also retains hidden or companion columns for each link's
`artifactId`, `recordId`, `memberKey`, and relative registry path. A visible hash without
these identifiers is not sufficient to disambiguate aggregate records.

## 5. Completion and status reduction

The row status is derived, never hand-selected:

1. `REOPEN` if any sealed input, linked record, role-roster hash, predecessor closure,
   warm applicability decision, or lock pointer changed after the row was sealed.
2. `FAIL` if a supplied hash mismatches, a link resolves to another task, a record is
   revoked/superseded/unsealed, a role or visibility rule fails, or a required member is
   absent where the source claims it exists.
3. `INCOMPLETE` if a required record, hash, member identifier, approval, locator, or
   blocker disposition is absent; this includes the blank template state.
4. `PASS` only if all five R29 links and the R29-06 lock anchor close, the row is covered
   by a current `R29-06 promotion.state=ready`, and no blocker or descendant revocation
   affects it.

The portfolio status is the maximum of row statuses using
`REOPEN > FAIL > INCOMPLETE > PASS`. A row-level `N/A` warm member does not lower the
portfolio status; it is valid only with the fixed Live rationale and a valid aggregate
R29-05 hash. `N/A` in any other required link is invalid.

## 6. Verification and migration gates

The reviewer or offline validator performs these checks without mutating the workbook or
the source tree:

- exactly 24 unique task IDs and one worksheet hash per row;
- every R29-01 through R29-05 artifact ID, record ID, member key, and hash resolves through
  the authenticated registry;
- all five member keys equal the row `taskId`, with no cross-task or duplicate member;
- record and payload hashes recompute from canonical bytes; aggregate and member hashes are
  not confused;
- R29-02 through R29-05 predecessor hashes equal the registered R29-01/R29-03 members;
- R29-04 trap key is `${taskId}-T`, role separation is valid, and calibration evidence is
  sealed;
- R29-05 member scope is Frozen-only and Live rows carry the exact not-applicable reason;
- R29-06 lock hash and ordered `predecessorClosureHash` include R28-04 and all five R29
  families for the row;
- no row contains candidate answers, source values, credentials, or grader-only content
  in the candidate-visible R29-01 link;
- any changed hash, missing member, duplicate row, or revoked descendant produces the
  status reduction above and blocks promotion.

`GL-1`/Q1 cannot pass while any row is `INCOMPLETE`, `FAIL`, or `REOPEN`. The workbook is
an index of evidence, not a replacement for the R29-06 register, projection report, or
qualification ledger.

## 7. Reopen, rollback, and retention

Workbook rows are append-only by version. A corrected artifact creates a new workbook
version with a new row hash set; it does not overwrite the historical row. On R29 reopen,
the affected row and every row whose lock closure contains the changed record become
`REOPEN`, the current R29 pointer is revoked, and R30-R33 descendants are invalidated
according to the descendant-closure contract. The row records the `rollbackRecordId` and
retains the prior hashes for audit.

An atomic rollback changes only the current promotion projection. Sealed task, gold,
source, calibration, warm-manifest, failed-attempt, and ledger records remain addressable.
If a crash occurs during workbook generation, the prior complete workbook remains current;
a partial file is quarantined and cannot supply hashes or a PASS decision.

## 8. Acceptance checklist (design review)

- [ ] The workbook has exactly the 24 approved task rows and stable `taskId` keys.
- [ ] Every row has dedicated R29-01, R29-02, R29-03, R29-04, and R29-05 link groups,
  including record/member identifiers and canonical hashes.
- [ ] Frozen rows require a warm-manifest member hash; the four Live rows use the exact
  documented not-applicable state and still carry the aggregate R29-05 hash.
- [ ] R29-06 lock and predecessor-closure hashes are present as the row integrity anchor.
- [ ] Blank or unresolved links reduce to `INCOMPLETE`; no placeholder hash can pass.
- [ ] Hash, task, role, visibility, predecessor, and revocation checks are read-only and
  fail closed.
- [ ] Reopen and rollback retain historical rows and invalidate affected descendants.
- [ ] No fixtures, source values, candidate outputs, credentials, network requests, or
  paid operations are introduced by this workbook contract.

## 9. Machine-checkable register and offline resolver

The strict register shape is [`r29-workbook-linkage.schema.json`](../../../fetchproof/schemas/r29-workbook-linkage.schema.json).
It rejects unknown fields at every row/link object, requires exactly 24 rows, constrains
hashes and relative worksheet paths, and permits only the R29-01 through R29-06 artifact
families. Task-set completeness, task uniqueness, per-family identity, and the Frozen/Live
warm rule remain semantic checks because they are cross-row/cross-record properties.

`validateR29WorkbookLinkage({ register, catalog, pointer })` in
[`r29-workbook-linkage-validator.mjs`](../../../fetchproof/lib/r29-workbook-linkage-validator.mjs)
is the read-only cross-reference resolver. `catalog.records` is an explicit authenticated
projection with record/member identifiers, hashes, seal state, predecessors, and calibration
trap key; `pointer` is the explicit current R29 projection. The resolver never discovers
records by walking a directory or trusting a filename. It returns deterministic row errors
and a portfolio `PASS` / `INCOMPLETE` / `FAIL` / `REOPEN` reduction.

Stable semantic codes include `R29-LINK-RESOLVE`, `R29-LINK-MEMBER-KEY`,
`R29-GOLD-PREDECESSOR`, `R29-CALIBRATION-LINK`, `R29-WARM-LIVE`,
`R29-WARM-FROZEN`, `R29-LOCK-CLOSURE`, and `R29-POINTER-STATE`. The conformance test uses
only in-memory synthetic records and proves a valid 24-row closure plus cross-task gold,
invented Live warm-member, and revoked-pointer failures.
