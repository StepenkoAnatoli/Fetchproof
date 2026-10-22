# Researcher release-review dashboard — approval revision

**Status:** design revised for approval; implementation remains deferred  
**Scope:** deterministic, read-only HTML presentation of a sealed release-review projection and an explicitly unqualified reviewer overlay  
**Non-scope:** validator execution, ledger access, source/fixture access, promotion, report mutation, credentials, network, or paid transport

## 1. Decision and trust boundary

The dashboard is a derived reviewer artifact. It may make qualification evidence legible;
it never creates, repairs, recomputes, or authorizes that evidence. The only accepted input
is one complete `researcher-dashboard-input-v1` projection. It is emitted upstream from
already-validated release reports. The renderer does **not** accept arbitrary
`researcher-release validate --json` output, aliases, filenames, or inferred task/gate
relationships.

The generated HTML is deterministic for identical input bytes. Browser-local reviewer
changes are a separate, unqualified overlay and never alter the source projection, its
hash, the validator reports, or the qualification ledger.

## 2. Canonical input contract

The input is UTF-8 JSON without a BOM or duplicate keys. Unknown top-level, task, gate,
timeline, receipt, snapshot, and error fields are invalid. All hash fields are lowercase
SHA-256 strings. The projection contains:

```text
profile                    exactly researcher-dashboard-input-v1
schemaVersion              exactly 1.0.0
sourceReportSha256         SHA-256 of canonical input with this field omitted
releaseId                  non-empty stable identifier
validatorEvidence          sealed evidence projection
tasks                      non-empty array of task rows
gates                      non-empty array of gate rows
requiredGateIds            non-empty, unique gate-ID array
```

`validatorEvidence` contains only display-safe, already-verified evidence:

```text
validatorVersion
packageReportHashes        exact keys R28, R29, R30, R31, R32, R33
packageStatuses            exact keys R28, R29, R30, R31, R32, R33
promotionTimelines         exact keys R28, R29, R30, R31, R32, R33
recoveryReceiptIds         unique ordered receipt-ID array
predecessorClosure
pointerLedgerState
snapshotEvidence
rollbackRecoveryEvidence
errors
```

Each task has exactly `taskId`, `ownerId`, `gateId`, `sourceStatus`, `reviewStatus`,
`closureHashes`, and `rollbackRecordId`. Each gate has exactly `gateId`, `ownerId`,
`sourceStatus`, `required`, and `requiredTaskIds`.

Task IDs and gate IDs are unique. Every task names one declared, required gate. Every
required gate appears exactly once in `requiredGateIds`, has a non-empty task list, and
lists each of its tasks once. A task belongs to exactly one gate, every listed task exists,
and every task's `gateId` agrees with that membership. An optional gate must be source-only
with an empty task list. Any violation is `INPUT-INVALID`; the renderer emits no HTML.

`sourceReportSha256` binds the complete projection, excluding only itself. The renderer
must recompute and verify it before rendering. It is not a hash of presentation bytes.

## 3. Status and decision rules

The only task, gate, package, and evidence statuses are:

```text
PASS, NOT-REVIEWED, INCOMPLETE, ROLLED-BACK, BLOCKED, FAIL, REOPEN
```

Their immutable precedence is:

```text
REOPEN > FAIL > BLOCKED > ROLLED-BACK > INCOMPLETE > NOT-REVIEWED > PASS
```

`NOT-READY` is a portfolio decision only, never a status. Unknown status text is input
invalid rather than mapped to a convenient default.

The effective task status is the higher-precedence value of immutable `sourceStatus` and
the reviewer overlay's `reviewStatus`. An overlay can escalate a concern but can never
clear, lower, or replace source evidence.

The effective required-gate status is the highest-precedence value among its
`sourceStatus` and the effective statuses of all of its required task IDs. Optional
source-only gates are displayed but do not participate in qualification. The portfolio
status is the highest-precedence status among every required gate and every task. The
portfolio decision is `PASS` only when every task and required gate is `PASS`; otherwise it
is `NOT-READY`.

Task counts use seven fixed buckets in this order: `PASS`, `NOT-REVIEWED`, `INCOMPLETE`,
`ROLLED-BACK`, `BLOCKED`, `FAIL`, `REOPEN`. Each task contributes to exactly one bucket.

## 4. Evidence rendering rules

The dashboard contains these four review sections, in this order.

1. **Gate and status matrix.** Release ID, source hash, renderer version, package report
   hashes/statuses, fixed task counts, required-gate owner/status, and portfolio decision.
2. **Owner accountability.** One deterministic owner grouping with assigned task and gate
   IDs, effective highest status, and unresolved task count.
3. **Predecessor, snapshot, and promotion evidence.** Closure hashes; pointer and ledger
   state; each R28–R33 snapshot triplet with declared hash integrity, capture time, age,
   allowed age, and freshness status; and one promotion timeline per package.
4. **Rollback and recovery evidence.** Ordered recovery receipt IDs, rollback/reopen IDs,
   descendant closure, emergency-age exception IDs, and all validator error codes.

Every R28–R33 timeline is shown even when empty. A timeline row has only the projection's
whitelisted `physicalSequence`, `createdAt`, `recordKind`, `state`, `recordId`, `eventId`,
`targetArtifactId`, `targetHash`, `pointerHash`, and `requiredGate` fields. The renderer
sorts by `physicalSequence`, then `recordId`, then `eventId`; duplicates or malformed
sequence values are `INPUT-INVALID`. It never displays raw ledger payloads.

A snapshot field not provided by the sealed projection renders as `NOT-REPORTED`; it never
renders as fresh, valid, or passing. Missing required snapshot evidence already represented
as a validator error is shown in the blocker table and prevents a green package/portfolio
cell under the precedence rules.

## 5. Reviewer overlay

The generated page initializes each controlled selector to the input `reviewStatus` and
offers only the seven status values. A change recalculates the task counts, gates, owner
groups, and portfolio using Section 3. The overlay is visibly labeled
`UNQUALIFIED-REVIEW-OVERLAY`.

The optional export is a separate canonical JSON document containing the source hash,
dashboard version, task source/review/effective statuses, portfolio status/decision, and
blank reviewer identity/signature fields. It is not a ledger event, sign-off, or promotion
record. Applying an overlay to a different source hash is refused.

## 6. CLI, output, and exit contract

```text
node fetchproof/bin/researcher-release.mjs dashboard \
  --input <researcher-dashboard-input-v1.json> \
  --output <dashboard.html> [--json]
```

The command reads only the input and writes only the requested HTML output. It does not
rerun validation or inspect artifact paths. It returns:

| Condition | Exit | Output |
|---|---:|---|
| Valid input and effective portfolio `PASS` | 0 | Complete HTML and optional JSON summary |
| Valid input but portfolio `NOT-READY` | 2 | Complete HTML and optional JSON summary |
| Input-invalid, duplicate-key, BOM, or source-hash failure | 3 | No HTML, structured diagnostic only |

The JSON summary includes `sourceReportSha256`, `renderSha256`, renderer version, effective
portfolio status/decision, fixed counts, and error codes. `renderSha256` is SHA-256 of the
exact emitted HTML bytes. It identifies the archival rendering but does not authorize the
source report.

## 7. Security, accessibility, and print rules

- Escape all report-controlled text for its exact HTML context. Serialize embedded data so
  it cannot terminate a script element.
- Use no network requests, external fonts, current time, randomness, filesystem order, or
  browser-specific layout data in generated bytes.
- Use semantic tables, table captions, visible status text in addition to colour, controlled
  selector labels, keyboard-operable controls, and concise tooltips for abbreviated hashes.
- Provide print CSS for A4 and Letter: monochrome-safe statuses, repeated table headers,
  no control widgets in print, selected overlay values printed as text, and no row break
  where the renderer can prevent it. Page count is browser-rendered and is never part of
  the hashed HTML contract.

## 8. Conformance and release gate

The implementation is accepted only when fixture-free tests prove:

- every `dashboard-status-vectors.json` case yields identical host and browser formulas;
- source hash, invalid IDs/membership, unknown statuses, duplicate keys, BOMs, malformed
  timelines, duplicate receipts, and missing required evidence fail closed with no output;
- immutable source failures cannot be cleared by the overlay;
- package timeline, recovery receipt, snapshot, closure, pointer, rollback, and error-code
  rendering is complete, escaped, deterministic, and contains no raw protected payload;
- identical input yields byte-identical HTML and render hash;
- generated HTML preserves the input bytes unchanged and uses no external dependency;
- print CSS includes the stated page, table, and control rules.

The dashboard is a replaceable derived package. Rolling it back removes only generated HTML
and the renderer version from review evidence; it never alters validator reports, ledger
records, pointers, or reviewer evidence. Any change to this input schema, status reduction,
hash domain, evidence field, or overlay export version requires a new renderer version and
fresh dashboard evidence.

## 9. Approval request

This revision resolves the prior conflicting status/input contracts, makes evidence absence
fail closed, binds timelines and recovery receipts explicitly, and separates source truth
from reviewer interaction. Review and approve this document before implementation planning
begins.
