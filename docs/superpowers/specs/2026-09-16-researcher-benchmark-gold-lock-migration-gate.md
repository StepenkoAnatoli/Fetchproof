# Researcher benchmark gold-lock migration gate

**Status:** normative review specification; documentation only  
**Gate:** `GL-1`, the projection subgate of `BM-2`  
**Governing benchmark:** `2026-09-16-researcher-benchmark-design.md` v1.0.0  
**Inputs:** the approved calibration-trap matrix, 24 expanded task packets, 24 blank task worksheets after authoring, source manifests, and the role roster  
**Outputs:** a projection report, 24-row canonical trap register, live-outcome approval records, and the R29-06 gold-lock payload  
**Machine contract:** [`trap-register.schema.json`](../../../fetchproof/schemas/trap-register.schema.json)  
**No execution:** this gate authorizes no candidate run, source recapture, credential use, fixture creation, or paid request.

This gate converts the human review record into the machine register used by validation and release promotion. It is a migration, not a second grading decision: the human matrix remains the authority for trap intent, while the canonical register is the only machine input after lock. The projection must be lossless for identifiers, scores, outcomes, hard-failure consequences, and grader-field routing. A prose cell never supplies an identifier by inference.

## 1. Gate authority and separation

`GL-1` is closed only by the evidence custodian after two independent gold reviewers have approved every task and the calibration adjudicator has resolved any disagreement. The task author may prepare the projection but may not approve the projection for their task.

The gate is separate from live execution:

| Decision | Owned by | Meaning | Does not mean |
|---|---|---|---|
| Gold-lock projection | Evidence custodian + independent gold reviewers | The human trap rows have been faithfully projected into the canonical register | Candidate execution or live-source access |
| Live-outcome approval | Gold reviewer A and B, with source-verifier evidence | The exact outcome enum for a volatile task is approved for the locked source window | Authorization to run the task |
| Live-run authorization | `live-authorization-owner` under R32 | A bounded execution window may access approved live sources | Permission to change the gold register |

The author, gold reviewer A, gold reviewer B, calibration adjudicator, and evidence custodian are distinct principals for each task. A role collision is a gate failure even when the content is otherwise correct.

## 2. Inputs and immutable snapshot

Before projection, the custodian creates one read-only input snapshot. The snapshot records the canonical UTF-8/LF byte hash of each input and the repository-relative path; it never follows an unregistered path.

| Input | Required identity | Snapshot requirement |
|---|---|---|
| Benchmark specification | v1.0.0 text hash | Exact approved hash in the R28 contract pin |
| Human trap matrix | version and SHA-256 | Exactly 24 `TASK-T` rows, one per task |
| Expanded task/calibration packet | version and SHA-256 | Claim and constraint registries for every task |
| Task worksheets | 24 task IDs and per-file hashes | Trap ID and traceability block agree with the matrix; source-dependent cells may be blank only before authoring |
| Source manifests and captures | per-task source IDs, locators, retrieval/freshness metadata, hashes | Every locked claim has a replayable locator or an explicit bounded unknown procedure |
| Role roster | roster SHA-256 | All author/reviewer/adjudicator identities and validity intervals are authorized |
| Register schema | schema ID and SHA-256 | [`trap-register.schema.json`](../../../fetchproof/schemas/trap-register.schema.json) is the schema used for validation |

The snapshot itself is immutable. Any input byte change after snapshot invalidates `GL-1` and requires a new gold version; it is never silently re-read.

## 3. Projection contract

The projection consumes one human matrix row and its matching worksheet/packet record at a time. The output key order is fixed by the schema and the trap order is the approved task order:

`ST-01..ST-04`, `VO-01..VO-04`, `CO-01..CO-04`, `UN-01..UN-04`, `CC-01..CC-04`, `AE-01..AE-04`.

### 3.1 Field mapping

| Human record | Canonical register field | Projection rule |
|---|---|---|
| Matrix trap row label `TASK-T` | `trapId` | Copy exactly; reject a missing, duplicate, or differently prefixed label |
| Worksheet/task packet ID | `taskId` | Copy exactly; require `trapId == taskId + "-T"` |
| Matrix claim cells such as `TASK-C3=0` | `claims[].id`, `claims[].expectedScore` | Parse only the registered ID and numeric score; preserve one object per named unit |
| Matrix constraint cells such as `TASK-K1=0` | `constraints[].id`, `constraints[].expectedScore` | Parse only the registered ID and numeric score; preserve one object per named unit |
| Locked outcome cell | `outcomeId` | Copy exactly one of `answered`, `contradiction`, `known-unknown`, `no-go`, `review-required` |
| Named hard-failure checklist consequence | `hardFailureIds[]` | Map only through the Section 13.1 alias registry; ambiguous prose blocks the gate |
| Worksheet traceability block | `graderFieldRefs` | Copy only exact Section 11 field strings; reject synonyms, free text, and unregistered fields |
| Matrix rationale and worksheet reviewer note | Projection report, not the register | Retain as evidence; never substitute prose for an ID or field reference |

Scores are JSON numbers in `{0, 0.5, 1}`. A numeric score without its unit ID is incomplete. A unit ID from another task is a cross-reference failure even if its suffix is valid.

### 3.2 Lossless and non-inferential rules

1. Every matrix row produces exactly one canonical row; no row may be merged, split, reordered, or dropped.
2. Every named claim and constraint is copied with its locked score. The projector does not recalculate a score from prose or from a grader note.
3. A row with an outcome cell reading `Gold-locked live outcome`, `build-ready`, `supported`, or similar prose is not projectable. It remains `INCOMPLETE` until a live-outcome approval record supplies the exact enum.
4. A hard-failure consequence must map to one or more `HF-01`–`HF-11` aliases, or to the mutually exclusive `HF-00-NONE` statement. “Critical hard failure” without a named checklist meaning is not projectable.
5. The canonical field reference list is copied from the worksheet traceability block and checked against the schema enum. A missing field is a failure; an irrelevant cost field is omitted unless the trap names usage or credits.
6. The projector rejects duplicate unit IDs, duplicate trap IDs, duplicate task IDs, unknown IDs, cross-task IDs, unknown outcomes, and unknown grader fields.
7. Projection is deterministic: the same snapshot, schema, and versions produce byte-identical register and report bytes. Timestamps belong in the envelope, not in the canonical payload.

## 4. Live-outcome approval record

Frozen tasks carry their locked outcome directly from the reviewed matrix. A Live task cannot pass `GL-1` on a provisional phrase. It requires a separate approval record for the exact outcome selected at the source review boundary.

Each live-outcome approval is an append-only, grader-only record with this logical shape:

```json
{
  "approvalId": "LOA-VO-01-<gold-version>",
  "taskId": "VO-01",
  "trapId": "VO-01-T",
  "taskTrack": "Live",
  "outcomeId": "answered",
  "decisiveCondition": "<single locked condition>",
  "sourceManifestHash": "<64 lowercase hex>",
  "sourceSnapshotHash": "<64 lowercase hex>",
  "retrievedAt": "<UTC timestamp>",
  "freshnessRule": "<copied from the task gold record>",
  "validUntil": "<UTC timestamp or null when the task rule has no expiry>",
  "reviewerA": {"principalId": "<id>", "approvedAt": "<UTC timestamp>"},
  "reviewerB": {"principalId": "<id>", "approvedAt": "<UTC timestamp>"},
  "sourceVerifier": {"principalId": "<id>", "verifiedAt": "<UTC timestamp>"},
  "decision": "APPROVED",
  "recordHash": "<64 lowercase hex>"
}
```

The example is a shape illustration, not a fixture or an outcome assertion. The record must satisfy these rules:

- `taskId` is one of the four Live tasks in the approved inventory and `trapId` is its exact `<taskId>-T` form.
- `outcomeId` is the exact five-value enum and is not inferred from `decisiveCondition`.
- `sourceManifestHash` and `sourceSnapshotHash` match the locked task/source inputs; a URL or retrieval date alone is insufficient.
- Reviewer A and B are distinct, authorized, and blind to the other approval before sealing. The source verifier is independent of both reviewers.
- Both reviewers approve the same outcome and source window. A disagreement, missing approval, expired `validUntil`, or changed source hash is `INCOMPLETE` before lock and `REOPEN` after lock.
- No credential, token, candidate output, or paid-collection result is stored in the approval record.
- This approval does not authorize a live run. R32-01 must separately precede every live execution.

## 5. Gate procedure and statuses

The implementation may use any offline tool, but it must expose these ordered phases and retain each phase result:

| Phase | Check | Evidence | Failure status |
|---|---|---|---|
| GL-1.0 Snapshot | Resolve only registered inputs and hash their canonical bytes | Input snapshot and manifest hash | `INCOMPLETE` for missing/unreadable input; `FAIL` for path/hash mismatch |
| GL-1.1 Inventory | Match 24 matrix rows, 24 worksheets, and 24 task packets | Count and ID crosswalk | `FAIL` for duplicate/unknown/missing task or trap |
| GL-1.2 Unit projection | Project claim/constraint IDs and scores | Per-row projection log | `FAIL` for unknown, cross-task, duplicate, or score mismatch |
| GL-1.3 Outcome projection | Resolve frozen outcomes and attach Live approval records | Outcome approval crosswalk | `INCOMPLETE` for missing live approval; `FAIL` for enum/conflict/staleness |
| GL-1.4 Field projection | Validate exact grader-field refs and hard-failure aliases | Field/hard-failure crosswalk | `FAIL` for unknown, missing, or code/ref mismatch |
| GL-1.5 Schema conformance | Validate the complete register against the strict JSON Schema | Validator report | `FAIL` on any schema error |
| GL-1.6 Independent review | Two reviewers compare projection log to the human matrix without editing either | Signed review records | `FAIL` for role collision or unresolved disagreement |
| GL-1.7 Seal | Canonicalize, hash, and atomically publish the R29-06 candidate payload | Payload hash, envelope hash, predecessor closure | `FAIL` on non-determinism or hash mismatch |

`GL-1 PASS` requires all phases to pass, exactly 24 rows, exactly one row per task, complete Live approvals, zero unresolved critical disagreements, and matching input/projection/register hashes. `INCOMPLETE` means required evidence is absent and no lock pointer may be written. `FAIL` means a supplied value is wrong or inconsistent and requires correction plus a new projection attempt. `REOPEN` means an already sealed input or approval changed; the existing lock remains historical but cannot support a new promotion.

## 6. Projection report and R29-06 payload

The projection report is retained beside the canonical register and is itself hash-linked. It contains:

| Report field | Required content |
|---|---|
| `gateId` | `GL-1` |
| `status` | `PASS`, `INCOMPLETE`, `FAIL`, or `REOPEN` |
| `inputHashes` | Specification, matrix, packet, worksheet, source, roster, and schema hashes |
| `rowResults` | One result per task/trap with source pointers, projected IDs/scores, outcome source, hard-failure codes, and field refs |
| `liveOutcomeApprovals` | Approval IDs and hashes for every Live task; no prose-only outcome |
| `errors` | Stable code, JSON pointer or source row, expected form, observed form, and status |
| `registerSha256` | SHA-256 of canonical register bytes |
| `projectionReportSha256` | SHA-256 of the report with this field excluded during calculation |
| `reviewSignatures` | Two gold-review approvals, adjudicator disposition when needed, and evidence-custodian seal |
| `createdAt` | UTC envelope timestamp; never part of canonical payload bytes |

R29-06 may reference the report and register only after all hashes verify. Its ordered predecessor closure must include R28-04 and every sealed R29-01 through R29-05 record. The R29 promotion pointer is not written for `INCOMPLETE`, `FAIL`, or `REOPEN`.

## 7. Stable failure codes

| Code | Condition |
|---|---|
| `GL-INPUT-MISSING` | A required matrix, packet, worksheet, source, roster, or schema input is absent |
| `GL-INPUT-HASH` | An input changed after the snapshot or does not match its authenticated hash |
| `GL-ROW-COUNT` / `GL-ROW-DUPLICATE` | The projection is not exactly 24 unique task/trap rows |
| `GL-TASK-MISMATCH` / `GL-TRAP-MISMATCH` | Task, worksheet, and trap suffix do not agree |
| `GL-UNIT-MISSING` / `GL-UNIT-UNKNOWN` / `GL-UNIT-CROSS-TASK` | Claim or constraint identifier is absent, unregistered, or owned by another task |
| `GL-SCORE-INVALID` / `GL-SCORE-MISMATCH` | Score is not 0, 0.5, or 1, or disagrees with the matrix |
| `GL-OUTCOME-MISSING` / `GL-OUTCOME-INVALID` / `GL-OUTCOME-STALE` | Live outcome is absent, not an enum, or outside its approved freshness window |
| `GL-OUTCOME-CONFLICT` | Live reviewers or source records do not agree on one exact outcome |
| `GL-HF-UNKNOWN` / `GL-HF-CONFLICT` / `GL-HF-REF-MISSING` | Hard-failure alias is unknown, `HF-00-NONE` is combined with another code, or its field reference is absent |
| `GL-FIELD-UNKNOWN` / `GL-FIELD-MISSING` | Grader-field reference is not an exact Section 11 registry string or required group is empty |
| `GL-ROLE-COLLISION` | Author, reviewer, verifier, adjudicator, or custodian separation is violated |
| `GL-SCHEMA` | Canonical register fails the strict schema |
| `GL-NONDETERMINISTIC` | Reprojection from the same snapshot is not byte-identical |
| `GL-HASH-CLOSURE` | Register, report, envelope, or predecessor closure hash does not match |

The report emits every applicable error, not only the first. A failure is never hidden by using a later phase’s result.

## 8. Atomic lock and rollback

Projection writes use a disposable staging directory. The lock protocol is:

1. Read and hash the immutable input snapshot.
2. Generate register, live approvals, and projection report in staging.
3. Re-run projection from the same snapshot and require byte-identical canonical payloads.
4. Validate schema, role separation, matrix agreement, and all hashes.
5. `fsync` staged files and the staging directory, then atomically rename the complete R29-06 package into its final location.
6. Publish the R29 pointer only after the package and predecessor closure are sealed.

If any phase fails, the prior R29-06 pointer and immutable records are untouched; staged bytes are quarantined as a failed attempt. A crash before pointer publication leaves no new promotable state. A crash after pointer publication is recovered from the append-only ledger and either the complete new pointer or the authenticated prior pointer is selected—never a mixture.

After `GL-1 PASS`, any change to the matrix, packet, worksheet, source manifest, live approval, schema, or role roster causes `REOPEN`. The old R29-06 register and report remain immutable history. The custodian creates a new gold version, new hashes, and a new projection; all R30–R33 descendants are invalidated until requalified. No rollback edits a sealed register or deletes a failed projection.

## 9. Reviewer sign-off and acceptance criteria

The release reviewer signs the following attestations from the sealed evidence bundle:

- [ ] Input snapshot names exactly the approved specification, matrix, packet, 24 worksheets, source manifests, roster, and register schema, with matching hashes.
- [ ] Every human trap row projects exactly once to the matching task/trap ID; no row was inferred, merged, reordered, or dropped.
- [ ] Every projected claim and constraint ID exists in the matching task packet, has the matrix score, and has no duplicate or cross-task reference.
- [ ] Every hard-failure alias and exact grader-field reference passes the Section 11/13.1 registries and the strict JSON Schema.
- [ ] Every Live task has two independent, same-outcome, unexpired live-outcome approvals tied to source-manifest and snapshot hashes.
- [ ] Live-outcome approval is recorded as a gold decision only; separate R32 authorization is still required for execution.
- [ ] Two independent gold reviewers and the calibration adjudicator (when applicable) are authorized and role-separated.
- [ ] Reprojection is byte-identical, the register/report/envelope hashes close, and the R29 predecessor closure is complete.
- [ ] Failed attempts and prior locks are retained; no candidate bytes, credentials, fixtures, network results, or paid requests were introduced.

The gate is `PASS` only when every checkbox is evidenced and the R29-06 pointer is atomically published. Any unchecked item is `INCOMPLETE` before lock, `FAIL` when contradicted by supplied evidence, or `REOPEN` after a sealed input changes.
