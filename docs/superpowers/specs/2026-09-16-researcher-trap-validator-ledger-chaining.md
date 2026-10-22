# Trap-validator report chaining into the qualification ledger

**Status:** normative integration specification; documentation only  
**Applies to:** `GL-1` gold-lock trap validation, R29-04 calibration evidence, R29-06 gold-lock promotion, and all descendant pointers  
**Governing contracts:** [`trap-row offline validator`](./2026-09-16-researcher-benchmark-trap-row-offline-validator.md), [`gold-lock migration gate`](./2026-09-16-researcher-benchmark-gold-lock-migration-gate.md), and [`qualification ledger`](./2026-09-16-researcher-benchmark-qualification-ledger.md)  
**No execution:** this specification creates no fixtures, source captures, credentials, network calls, or paid requests.

The trap-validator report is an immutable qualification input, not an untracked sidecar. A `GL-1` report is committed to the append-only qualification ledger before it can support R29-06. The R29 pointer is a signed projection of that committed event; it is never the source of truth. A report, ledger event, or pointer that cannot be linked through hashes and sequence is not promotable.

## 1. Binding and ownership

| Object | Ledger identity | Owner | Promotion role |
|---|---|---|---|
| `GL-1` projection report | R29-04 append-only event family | Calibration adjudicator | Records the result of projecting all 24 human trap rows |
| Live-outcome approval record | Referenced immutable approval event | Gold reviewers A/B + source verifier | Supplies an exact outcome enum for each Live task; never authorizes execution |
| R29-06 gold-lock record | R29-06 sealed artifact event | Evidence custodian | Locks the complete task/gold/source/calibration set |
| R29 pointer | Signed `promotion-commit` projection | Evidence custodian | Publishes R29 only when the committed `GL-1` result is `PASS` |

The task author may prepare a report, but cannot be the calibration adjudicator, either gold reviewer, or pointer signer for the same task. Role-roster hashes in every event and pointer must equal the authenticated R28 roster root.

## 2. Canonical report payload

The report is canonical JSON under profile `researcher-benchmark-c14n-v1`. It has no generation timestamp, filesystem path, mtime, or nondeterministic identifier in its hashed body. All objects are strict; unknown keys, duplicate keys, non-finite numbers, and alternate field spellings are rejected.

```json
{
  "reportVersion": "1.0.0",
  "gateId": "GL-1",
  "benchmarkVersion": "1.0.0",
  "matrixVersion": "1.0.0",
  "registerSchemaId": "fetchproof/trap-register-v1",
  "inputHashes": {
    "benchmarkSpecSha256": "<64 lowercase hex>",
    "matrixSha256": "<64 lowercase hex>",
    "taskPacketSha256": "<64 lowercase hex>",
    "worksheetBundleSha256": "<64 lowercase hex>",
    "sourceManifestBundleSha256": "<64 lowercase hex>",
    "roleRosterSha256": "<64 lowercase hex>",
    "registerSchemaSha256": "<64 lowercase hex>"
  },
  "status": "PASS",
  "rowCount": 24,
  "rowResults": [
    {
      "taskId": "<task ID>",
      "trapId": "<task ID>-T",
      "status": "PASS",
      "claimIds": ["<task claim IDs in matrix order>"],
      "constraintIds": ["<task constraint IDs in matrix order>"],
      "outcomeId": "<exact outcome enum>",
      "outcomeSource": "matrix|live-approval",
      "hardFailureIds": ["<HF alias IDs in matrix order>"],
      "graderFieldRefs": {
        "claims": ["<exact Section 11 fields>"],
        "constraints": ["<exact Section 11 fields>"],
        "outcome": ["<exact Section 11 fields>"],
        "hardFailures": ["<exact Section 11 fields>"]
      },
      "liveApprovalIds": []
    }
  ],
  "liveOutcomeApprovals": [],
  "errors": [],
  "registerSha256": "<canonical trap-register hash>"
}
```

The example is schema-shaped, not a fixture or a gold assertion. Normative report rules are:

- `rowResults` contains exactly 24 entries in the approved task order. Each entry has the same `taskId`/`trapId` relationship as the register and the same ordered IDs, scores, outcome, hard-failure aliases, and field references.
- `status` is `PASS`, `INCOMPLETE`, `FAIL`, or `REOPEN`. A report with any row error cannot be `PASS`.
- `outcomeSource` is `matrix` for Frozen tasks and `live-approval` for Live tasks. A Live row must list exactly one matching `liveApprovalId`.
- `liveOutcomeApprovals` contains every approval used by a Live row, with its approval record hash and exact outcome. The report is invalid if an approval is missing, expired, conflicting, or tied to different source hashes.
- `errors` is an ordered list of stable validator errors. Failed reports retain their errors; they are never rewritten into a later pass.
- `registerSha256` is the hash of the canonical register bytes. The report does not embed a second register copy that could drift from the canonical file.

## 3. Ledger event family

The existing ledger envelope and physical chain rules remain authoritative. Trap validation uses the existing `prepare` and `commit` record kinds with a required `payload.eventKind: "trap-validation-report"`; no new physical record kind is introduced.

### 3.1 Prepare record

A `prepare` event contains the complete report body so that a committed result can be reconstructed from the ledger without trusting a mutable report path:

```json
{
  "ledgerVersion": "1.0.0",
  "physicalSequence": 0,
  "recordKind": "prepare",
  "txId": "<unique transaction ID>",
  "eventId": "GL1-<registerSha256>",
  "package": "R29",
  "artifactId": "R29-04",
  "recordId": "R29-04:GL-1:<registerSha256>",
  "benchmarkSpecVersion": "1.0.0",
  "benchmarkSpecSha256": "<genesis hash>",
  "roleRosterSha256": "<genesis roster hash>",
  "actorId": "<calibration-adjudicator>",
  "actorRole": "calibration-adjudicator",
  "createdAt": "<UTC envelope timestamp>",
  "prevChainHash": "<previous chain hash>",
  "payloadSha256": "<hash of canonical payload>",
  "recordHash": "<hash excluding recordHash, chainHash, and signature>",
  "chainHash": "<chain hash>",
  "state": "pending",
  "payload": {
    "eventKind": "trap-validation-report",
    "gateId": "GL-1",
    "reportSha256": "<hash of canonical report>",
    "report": "<the complete canonical report object>",
    "registerSha256": "<same value as report.registerSha256>"
  }
}
```

The complete report is shown as a string placeholder only to keep the example short; in the ledger payload it is the report object, not a path or an opaque unchecked URL. `reportSha256` is computed before the event envelope is created. `payloadSha256`, `recordHash`, and `chainHash` are then computed using the ledger contract.

### 3.2 Commit record

The `commit` event makes the report a qualification fact. It must refer to the exact prepare record and repeat the report hash and status:

```json
{
  "recordKind": "commit",
  "eventId": "GL1-<registerSha256>",
  "package": "R29",
  "artifactId": "R29-04",
  "recordId": "R29-04:GL-1:<registerSha256>",
  "state": "committed",
  "payload": {
    "eventKind": "trap-validation-report-commit",
    "prepareRecordHash": "<prepare recordHash>",
    "prepareChainHash": "<prepare chainHash>",
    "reportSha256": "<same report hash>",
    "registerSha256": "<same register hash>",
    "status": "PASS",
    "liveOutcomeApprovalHashes": ["<approval record hashes in task order>"],
    "inputHashes": {"<same seven keys and values as report.inputHashes>"}
  }
}
```

The commit is the report's qualification hash: later artifacts use the commit `chainHash`, never a filename, mtime, or report path. A committed `INCOMPLETE`, `FAIL`, or `REOPEN` report is retained evidence but cannot close GL-1 or satisfy an R29-06 predecessor selector.

### 3.3 Retry and duplicate rules

- Retrying the same `eventId` with the same `reportSha256` and input hashes is `NO-OP` after the existing committed event is verified.
- Reusing an `eventId` with any different report, register, input, or approval hash is `FAIL`; the second payload is not appended as a competing history.
- A durable prepare with no commit is resolved by an append-only `abort` or `recovery` event. It remains `INCOMPLETE` history and never qualifies the register.
- A report may have many historical failed commits, but exactly one current `PASS` commit can be selected by the R29-06 predecessor closure. A new pass after a reopen has a new register/gold version and event ID.

## 4. Live-outcome approval chaining

Each Live approval is sealed before the `GL-1` prepare. The approval record's hash is listed in both the report and the commit payload. The ledger validator requires:

1. The approval `taskId`, `trapId`, and exact `outcomeId` match the report row.
2. The approval's source-manifest and source-snapshot hashes equal the report's input hashes.
3. Reviewer A and B are distinct, authorized, and approve the same outcome; the source verifier is independent.
4. `validUntil` is later than the gold-lock validation instant and satisfies the task freshness rule.
5. An approval change, expiry, or source-hash drift appends a new approval/reopen event; it never edits the old approval or report.

Live approval is a gold decision only. `R32-01` remains the separate authorization event that must precede any live source access or candidate run.

## 5. Tamper-evident R29 promotion pointer

The R29 pointer uses the existing signed pointer envelope. Its `promotion.promotionCommitHash` must be the `chainHash` of a committed ledger `promotion-commit` whose payload names the exact `GL-1` commit:

```json
{
  "promotion": {
    "state": "ready",
    "package": "R29",
    "targetArtifactId": "R29-06",
    "targetHash": "<R29-06 sealed payload hash>",
    "predecessorClosureHash": "<ordered closure including GL-1 commit>",
    "requiredGate": "Q1",
    "publishedAt": "<UTC timestamp>",
    "previousPointerHash": "<prior pointerHash or null>",
    "promotionCommitHash": "<ledger promotion-commit chainHash>",
    "revokedDescendantHashes": []
  }
}
```

The associated ledger `promotion-commit` payload must contain:

| Field | Required value |
|---|---|
| `eventKind` | `promotion-pointer-commit` |
| `pointerHash` | Exact signed pointer hash |
| `pointerBytesSha256` | Hash of canonical pointer bytes |
| `qualificationCommitHash` | `GL-1` `commit.chainHash` with `status: PASS` |
| `reportSha256` | The report hash from that GL-1 commit |
| `targetArtifactId` / `targetHash` | `R29-06` and its sealed payload hash |
| `predecessorClosureHash` | Exact ordered closure containing the GL-1 commit and all R29 predecessors |
| `previousPointerHash` | Current pointer hash before the swap, or null for generation 1 |
| `requiredGate` | `Q1` |

The pointer validator verifies the chain in this order: pointer signature and hash; promotion-commit record and chain; referenced GL-1 commit; prepare record and embedded report; report hash and schema; input hashes and role roster; R29-06 target and complete predecessor closure. Any mismatch is `INCOMPLETE`, `FAIL`, or `REOPEN` and cannot be downgraded to `not-published`.

## 6. Atomic publication and crash behavior

The report and pointer are published through two separate append protocols. The report must be committed before the pointer intent is accepted.

| Crash point | Durable state | Recovery result |
|---|---|---|
| Report staged, no prepare | No ledger evidence | Remove only unreferenced temp bytes; `NO-OP` |
| Prepare durable, no commit | Full report is in an uncommitted prepare | Append `abort`/`recovery`; report remains `INCOMPLETE`, no pointer |
| Report commit durable, head old | Committed GL-1 event, stale head | Rebuild head; report remains eligible according to its committed status |
| Pointer intent durable, no pointer swap | Intent names pointer and GL-1 commit | Append promotion abort; old pointer remains current |
| Pointer swapped, no promotion commit | New bytes may be visible but uncommitted | Verify against intent; commit only if exact, otherwise quarantine and restore prior pointer |
| Promotion commit durable, head old | Pointer and ledger commit agree | Rebuild head; `PASS` survives |
| Pointer/report edited outside protocol | Hash or signature differs | Mark R29 `REOPEN`, retain ledger/report bytes, revoke descendants |

No recovery path edits a report, ledger line, or historical pointer. A current `PASS` exists only after the GL-1 commit, promotion-commit, pointer hash, signature, and head all agree.

## 7. Invalidation and rollback

Any GL-1 report, live approval, source hash, matrix row, task packet, worksheet, schema, or role-roster change after R29 promotion appends a `promotion-revoke` event. The revoke payload names the affected `qualificationCommitHash` and `reportSha256`, and lists every descendant pointer hash (`R30`, `R31`, `R32`, and `R33`) invalidated by the closure.

- A failed or reopened GL-1 report never becomes the predecessor of a new `ready` pointer.
- R29-06 and all descendant artifacts remain retained and marked superseded/revoked; no file is deleted to make the chain appear current.
- Requalification creates a new gold version, new report/register hashes, a new GL-1 event ID, and a new pointer generation whose `previousPointerHash` names the revoked pointer.
- A rollback that cannot prove the prior pointer and GL-1 commit is `BLOCKED`; it does not guess a prior state.

## 8. Ledger-only audit requirements

An offline auditor supplied only the genesis anchor, ledger segments, checkpoints, and current/historical pointers must be able to reconstruct:

1. Every GL-1 report attempt, including failed and aborted attempts.
2. The exact report and register hash selected by each committed GL-1 event.
3. Every Live approval hash and outcome used by a passing report.
4. The R29-06 promotion event, its pointer hash/signature, and the GL-1 commit in its closure.
5. Every revoke/reopen event and the descendant pointers it invalidated.

The auditor rejects missing prepares, commit/prepares with different report hashes, duplicate event IDs with different payloads, sequence gaps, chain forks, pointer commits without a matching GL-1 `PASS`, and any current pointer whose `previousPointerHash` or closure is inconsistent. It emits `PASS` only when the reconstructed promotion is hash-closed and the report status is `PASS`.

## 9. Review acceptance criteria

- [ ] Every `GL-1` report is stored in a retained ledger prepare/commit pair with an exact `reportSha256`.
- [ ] The commit payload repeats and verifies the report hash, register hash, input hashes, status, and Live approval hashes.
- [ ] Failed, incomplete, reopened, aborted, and superseded reports remain queryable history and cannot qualify R29.
- [ ] R29-06's predecessor closure includes the committed `GL-1` pass event and all required R29 artifacts.
- [ ] The R29 promotion-commit names the GL-1 commit hash, report hash, pointer hash, target hash, and closure hash.
- [ ] Pointer signature, `previousPointerHash`, generation, and atomic swap are verified before `ready` is accepted.
- [ ] A changed report, approval, input, or pointer causes `REOPEN` and transitive descendant invalidation; no old pointer is silently resurrected.
- [ ] Crash recovery is idempotent and never publishes a pointer from an uncommitted or mismatched report.
- [ ] A ledger-only auditor can reconstruct the full trap-validation-to-promotion history without trusting filenames or mutable report paths.
