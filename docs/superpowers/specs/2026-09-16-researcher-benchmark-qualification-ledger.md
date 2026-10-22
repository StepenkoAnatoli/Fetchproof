# Append-only benchmark qualification ledger and promotion pointers

**Status:** normative design; no implementation, fixture, network, or credit spend
**Applies to:** R28–R32 qualification records and their package promotion views
**Companion validator:** [`2026-09-16-researcher-r28-r32-machine-validators.md`](./2026-09-16-researcher-r28-r32-machine-validators.md)
**Companion rollback gates:** [`2026-09-16-researcher-benchmark-migration-rollback-gates.md`](./2026-09-16-researcher-benchmark-migration-rollback-gates.md)
**Trap-validator chaining:** [`2026-09-16-researcher-trap-validator-ledger-chaining.md`](./2026-09-16-researcher-trap-validator-ledger-chaining.md)
**Reopen/rollback log template:** [`2026-09-16-researcher-release-reopen-rollback-requalification-log-template.md`](./2026-09-16-researcher-release-reopen-rollback-requalification-log-template.md)

Offline graph, closure, cycle, duplicate, and concurrent-rollback checks are specified in
[`2026-09-16-researcher-offline-graph-conformance-tests.md`](./2026-09-16-researcher-offline-graph-conformance-tests.md).

The reviewer evidence form for crash-point rollback recovery is [`2026-09-16-researcher-crash-rollback-evidence-bundle-template.md`](./2026-09-16-researcher-crash-rollback-evidence-bundle-template.md).

The qualification ledger is the authoritative history of benchmark evidence and promotion decisions. It is append-only: a correction, rollback, or recovery outcome adds a new record and never edits or deletes a prior record. The package pointer files are tamper-evident, recoverable projections of that history; they are not the history themselves.

`GL-1` trap-validator reports use the existing `prepare`/`commit` event pair as the R29-04 calibration evidence family. The full canonical report is retained in the prepare payload, its hash is repeated by the commit, and R29-06 promotion is permitted only when the signed R29 pointer resolves through its promotion-commit to that committed `GL-1 PASS` event. See the [trap-validator chaining contract](./2026-09-16-researcher-trap-validator-ledger-chaining.md) for the report payload, Live-outcome approval linkage, and crash/rollback rules.

## Design invariants

1. A qualification `PASS` exists only when a committed ledger event and a matching, signed promotion pointer both exist.
2. A torn write, missing commit marker, invalid signature, predecessor mismatch, or ambiguous recovery state never yields `PASS`; it yields `INCOMPLETE`, `FAIL`, or `REOPEN`.
3. Every committed event has one immutable canonical payload, one payload hash, one predecessor closure, one actor, and one ledger position.
4. Rollback revokes a derived promotion and its descendants. It retains task prompts, gold, sources, runs, grades, failures, and all ledger history.
5. Recovery is idempotent. Re-running recovery after a successful recovery produces `NO-OP` and byte-identical state.
6. A validator can reconstruct the current qualification state from the ledger alone and can prove that each pointer is the projection of a committed event.
7. A ledger or pointer is never trusted merely because its filename, mtime, or JSON parses. Hashes, signatures, sequence, and closure are required.

## Logical storage layout

The canonical logical root is `fetchproof/test/benchmark/records/qualification/`; an equivalent backend is permitted only when R28-04 records a one-to-one path and hash mapping.

```text
qualification/
  ledger/
    segments/00000001.qlog       # append-only UTF-8 records, one record per line
    segments/00000002.qlog
    genesis.json                  # immutable release/contract anchor
    head.json                     # atomic, recoverable projection of the log head
    checkpoints/                   # immutable signed head checkpoints
    quarantine/                    # torn/invalid bytes, never evidence
    recovery/                      # append-only recovery receipts
  pointers/
    R28.json                      # current package promotion view or revoked tombstone
    R29.json
    R30.json
    R31.json
    R32.json
    history/<package>/<generation>.json  # immutable prior pointer bytes
  locks/
    ledger.lock                   # exclusive writer lease with owner token/expiry
```

`segments/*.qlog`, `genesis.json`, checkpoints, recovery receipts, and prior pointer bytes are retained. `head.json` and `pointers/Rxx.json` are replaceable projections, but every replacement is authenticated by the ledger and retains the previous hash.

## Canonical encoding and hash domains

The cross-artifact serialization profile is [`researcher-benchmark-release-canonical-serialization.md`](./2026-09-16-researcher-benchmark-release-canonical-serialization.md), profile `researcher-benchmark-c14n-v1`. This section fixes the ledger-specific domains.

- All records are UTF-8 without BOM, LF-delimited, with exactly one LF after each complete line.
- JSON object keys are sorted recursively by UTF-16 code unit; array order is significant. Duplicate keys, non-finite numbers, and non-canonical escape forms are rejected before hashing.
- `payloadSha256` is SHA-256 over canonical bytes of the event payload only.
- `recordHash` is SHA-256 over canonical bytes of the complete record excluding the derived `recordHash` and `chainHash` fields and the optional signature bytes; excluding both derived fields avoids a circular preimage and is the rule enforced by the offline validator.
- `chainHash` is SHA-256 over `recordHash || prevChainHash || physicalSequence` using the UTF-8 strings and decimal sequence encoding shown in the record schema.
- `pointerHash` is SHA-256 over the canonical pointer excluding `pointerHash` and `signature`.
- `predecessorClosureHash` is SHA-256 over the ordered list of authenticated predecessor hashes, including external roots, with no path names substituted for hashes.
- Signatures use Ed25519 over `pointerHash`; the ledger stores `signerKeyId`, algorithm, and signature bytes, never private keys or credentials.

The validator compares lowercase 64-character hashes byte-for-byte. A line-ending conversion, reordered predecessor list, changed array order, or altered Unicode normalization is a content change and therefore a new record, not an in-place repair.

## Immutable genesis anchor

`genesis.json` is created once for a release stream and is itself signed by the release authority. It contains:

```json
{
  "ledgerVersion": "1.0.0",
  "releaseId": "benchmark-v1.0.0",
  "benchmarkSpecVersion": "1.0.0",
  "benchmarkSpecSha256": "<R28-01 hash>",
  "registrySha256": "<R28 schema/registry hash>",
  "roleRosterSha256": "<authenticated roster hash>",
  "externalRoots": {
    "R26": "<checkpoint hash>",
    "R27": "<qualification hash>",
    "G3": "<gate-closure hash>"
  },
  "genesisHash": "<hash excluding this field>",
  "signerKeyId": "<release-key-id>",
  "signature": "<Ed25519 signature over genesisHash>"
}
```

The genesis anchor is the only permitted root without a predecessor ledger record. Changing the contract, registry, role roster, or external roots starts a new `releaseId` and ledger; it never rewrites this genesis file.

## Ledger record envelope

Every physical line is one of the record kinds below and contains this envelope:

| Field | Rule |
|---|---|
| `ledgerVersion` | Exactly `1.0.0`; unknown future versions refuse recovery and promotion. |
| `physicalSequence` | Positive integer, contiguous within a segment chain. |
| `recordKind` | One of `prepare`, `commit`, `abort`, `promotion-intent`, `promotion-commit`, `promotion-revoke`, `recovery`, or `checkpoint`. |
| `txId` | Unique 128-bit transaction identifier; prepare/commit/abort and pointer intent/commit records share it. |
| `eventId` | Stable ID for a logical qualification or recovery event; retries reuse the same ID and are `NO-OP`. |
| `package` | `R28`, `R29`, `R30`, `R31`, `R32`, or `ledger`. |
| `artifactId` | Registry ID for artifact events; `null` for ledger-only records. |
| `recordId` | Immutable artifact/run/pointer record identifier, or `null` for ledger-only records. |
| `benchmarkSpecVersion` / `benchmarkSpecSha256` | Exact genesis values. |
| `roleRosterSha256` | Exact genesis value. |
| `actorId` / `actorRole` | Authenticated roster assignment valid at `createdAt`. |
| `createdAt` | UTC ISO-8601 timestamp with `Z`; future timestamps are rejected. |
| `prevChainHash` | Previous physical record's `chainHash`; genesis uses the genesis hash. |
| `payloadSha256` | Hash of canonical payload. |
| `recordHash` | Hash of the complete record excluding this field. |
| `chainHash` | Hash linking this record to the previous physical record and sequence. |
| `state` | `pending`, `committed`, `aborted`, `revoked`, or `recovered`, as permitted by `recordKind`. |

The ledger rejects unknown envelope fields, duplicate event IDs with different payload hashes, sequence gaps, chain forks, role-roster drift, and records whose package/artifact pair does not exist in the R28 registry.

## Two-phase append protocol

Qualification events use a prepare/commit pair. The pair prevents a crash after data durability but before publication from being mistaken for a qualified result.

### Phase A — prepare

1. Acquire `ledger.lock` with a random owner token, process ID, host, start time, and bounded expiry. A live lease cannot be stolen; a stale lease requires a recovery receipt.
2. Read and verify `head.json`, then verify the ledger suffix from its recorded segment/offset to the physical end. A middle-chain break stops the operation.
3. If `eventId` is already committed with the same payload hash, return `NO-OP`; if it is committed with a different hash, return `FAIL` and do not append.
4. Validate the artifact envelope, role assignment, predecessor closure, and package-specific semantic rules using the companion validator.
5. Assign a new `txId`, construct a `prepare` record with the proposed event payload and expected predecessor closure, canonicalize it, write it to a temporary file in the same segment directory, flush, and `fsync` the temporary file.
6. Append the complete prepare line to the segment, flush, and `fsync` the segment. Only after this point may recovery see a durable prepare.

### Phase B — commit

1. Re-read the segment tail and verify the prepare's `recordHash`, chain hash, and payload hash.
2. Assign the next logical qualification sequence from the verified committed projection, construct a `commit` record referring to the prepare hash, and include the exact resulting status (`PASS`, `INCOMPLETE`, `FAIL`, or `REOPEN`).
3. Append, flush, and `fsync` the commit line. The event is now committed evidence; the pair cannot be edited or removed.
4. Atomically write `head.json.tmp`, flush and `fsync` it, rename it to `head.json`, then `fsync` the containing directory. The head stores the last physical chain hash, last committed event hash, segment, byte offset, and logical qualification sequence.
5. Release the lock only after the head replacement is durable. A failure to release is recoverable from the lease token and does not invalidate the committed event.

`abort` is used only for a durable prepare that will not be committed. It references the prepare hash and reason; it does not erase the prepare. A prepare with no commit or abort is `INCOMPLETE` until recovery resolves it.

## Promotion pointer protocol

Promotion pointers are signed, hash-linked projections. They are not written directly as a source of truth.

### Pointer envelope

```json
{
  "envelope": {
    "artifactId": "R31-03",
    "schema": 1,
    "benchmarkSpecVersion": "1.0.0",
    "benchmarkSpecSha256": "<R28-01 hash>",
    "package": "R31",
    "recordId": "R31-03:generation-3",
    "ownerRole": "evidence-custodian",
    "ownerId": "<principal>",
    "roleRosterSha256": "<genesis roster hash>",
    "createdAt": "<UTC timestamp>",
    "predecessorHashes": ["<ordered hashes>"],
    "payloadSha256": "<canonical payload hash>",
    "state": "sealed",
    "visibility": "grader-only"
  },
  "payload": {
    "pointerVersion": "1.0.0",
    "promotion": {
      "state": "ready|provisional-cold|revoked|not-published",
      "package": "R31",
      "generation": 3,
      "targetArtifactId": "R31-03",
      "targetHash": "<target payloadSha256>",
      "promotionCommitHash": "<ledger promotion-commit chainHash>",
      "predecessorClosureHash": "<ordered closure hash>",
      "requiredGate": "Q3",
      "publishedAt": "<UTC timestamp>",
      "liveVerifiedUntil": null,
      "previousPointerHash": "<prior pointerHash or null>",
      "rollbackRecordHash": null,
      "revokedDescendantHashes": []
    },
    "pointerHash": "<hash excluding pointerHash/signature>",
    "signerKeyId": "<release-key-id>",
    "signature": "<Ed25519 signature over pointerHash>"
  }
}
```

Pointer-specific rules:

- R28-04, R29-06, R30-05, R31-03, and R32-05 are the only package pointer artifacts. R30-05 is limited to `provisional-cold`; it cannot publish a release-ready state.
- `targetHash` must equal the sealed target artifact payload hash, and `promotionCommitHash` must identify a committed ledger event naming the same target and closure.
- `previousPointerHash` must equal the prior current pointer's hash, or `null` only for generation 1. A generation decrement or pointer replacement that skips a prior hash is invalid.
- `ready` requires every required gate and predecessor closure to be `PASS`; R32 additionally requires an unexpired authorization and `liveVerifiedUntil` later than validation time.
- `revoked` requires a committed `promotion-revoke` record and `rollbackRecordHash`; a revoked pointer is never eligible as a predecessor for a new `ready` pointer.
- Exactly one current pointer file exists per package. Historical pointers are ledger payloads/checkpoints, not competing current files.
- Pointer bytes are replaced only through the atomic protocol below. A zero-byte, unsigned, or hash-mismatched file is `INCOMPLETE`/`FAIL`, never an implicit `not-published` success.

### Atomic publication

1. Validate the target artifact, all transitive predecessors, role roster, gate status, and the current pointer hash.
2. Build and sign the pointer; verify its signature and `pointerHash` locally.
3. Append and `fsync` a `promotion-intent` containing the complete canonical pointer bytes, pointer hash, target hash, previous pointer hash, and required gate. Storing the bytes in the intent makes recovery independent of a mutable pointer file.
4. Write `pointers/<package>.json.tmp`, flush and `fsync`, atomically rename it over the current pointer, and `fsync` the pointer directory.
5. Copy the replaced pointer bytes to `pointers/history/<package>/<generation>.json` with exclusive-create semantics, flush and `fsync`; an existing different byte sequence is a tamper failure.
6. Append and `fsync` a `promotion-commit` containing the pointer hash and exact pointer path.
7. Atomically advance `head.json` and release the lock.

The pointer validator accepts `ready` only after step 5. Before that, the pointer is a pending projection and the package remains `INCOMPLETE`.

## Crash-recovery state machine

Recovery runs before any new append or promotion and is itself serialized by `ledger.lock`. It never edits an existing ledger line.

| Crash point | Durable state | Recovery action | Result |
|---|---|---|---|
| Before prepare `fsync` | No authenticated prepare | Remove only the unreferenced temp file; append no record. | `NO-OP` |
| After prepare `fsync`, before commit | Prepare is valid; no commit | Append `abort` with reason `interrupted-prepare` unless a valid retry owns the same `txId`. | `INCOMPLETE` history; no qualification |
| After commit `fsync`, before head replace | Commit is valid; head is old | Rebuild head from the verified suffix and append a recovery receipt. | Committed event restored; idempotent |
| During head temp write | Old head valid; temp may be partial | Verify old head, quarantine/delete only the temp, rebuild from ledger. | Prior committed state or recovered commit |
| After head rename, before lock release | New head and commit valid | Verify and release/reap the lease token. | `NO-OP` |
| After promotion intent, before pointer rename | Intent valid; old pointer current | Append `recovery`/`promotion-abort`; retain intent. | No new promotion |
| After pointer rename, before promotion commit | New pointer may be visible but uncommitted | Verify pointer signature/hash against the intent's canonical bytes. If valid, append promotion-commit; otherwise copy the bytes to quarantine, restore the authenticated previous pointer, and append abort. | `PASS` only for a completed commit; otherwise `INCOMPLETE` |
| After promotion commit, before head replace | Pointer and commit valid; head old | Rebuild head and append recovery receipt. | Promotion survives |
| Torn final ledger line | Prefix and prior head valid; final bytes fail newline/parse | Quarantine the exact torn bytes, truncate only the uncommitted final partial line to the last verified LF, record the byte ranges, and append recovery receipt. | Prefix preserved; no data invented |
| Middle-line corruption or chain fork | Verified prefix cannot reach physical end | Do not truncate or append. Freeze all promotion and require authenticated operator repair from an external checkpoint. | `FAIL` |
| Pointer deletion or replacement outside protocol | Ledger pointer event does not match bytes | Keep historical bytes, mark current package `REOPEN`, and block descendants until a new signed pointer is published. | `REOPEN` |

Recovery is complete only when the physical chain, committed projection, head, and every current pointer agree. A recovery receipt contains the before/after head hashes, segment offsets, affected `txId`/pointer hash, reason, actor, and validator version.

## Head and checkpoint rules

`head.json` is a cache, not an authority. It contains:

```json
{
  "ledgerVersion": "1.0.0",
  "segment": "00000002.qlog",
  "byteOffset": 18432,
  "physicalSequence": 118,
  "lastChainHash": "<hash>",
  "lastCommittedEventHash": "<hash>",
  "logicalQualificationSequence": 42,
  "lastRecoveryReceiptHash": "<hash or null>",
  "headHash": "<hash excluding headHash>"
}
```

The validator recomputes the head by scanning from the genesis anchor when the cache is absent or inconsistent. Every checkpoint records a segment, byte offset, chain hash, last committed event hash, and signed snapshot hash. A checkpoint never authorizes skipping an unverified suffix; it only bounds recovery work.

Segment rotation is append-only: acquire the lock, write a signed `checkpoint`, `fsync` the old segment and checkpoint, create the next numbered segment whose first record names the checkpoint hash, then update the head. A missing or duplicate segment number is a chain failure.

## Qualification projection and status precedence

The validator projects only committed qualification events. It ignores prepares, aborted events, and uncommitted pointer intents. For each package, status is reduced in this order:

`REOPEN` > `FAIL` > `INCOMPLETE` > `PASS`.

The projection must retain the latest valid event for every artifact plus all retained failures. A later `PASS` cannot erase a prior valid `FAIL`; it can only be a new run/requalification event whose predecessor closure names the failure disposition. A pointer may promote only a projection whose required artifacts and gates are all `PASS`.

## Rollback and descendant invalidation

The complete R26–R33 descendant and atomic package rollback semantics are defined in [`2026-09-16-researcher-r26-r33-descendant-invalidation-atomic-rollback.md`](./2026-09-16-researcher-r26-r33-descendant-invalidation-atomic-rollback.md). This section remains the ledger-specific projection of that contract.

Rollback is a new ledger transaction:

1. Verify the target pointer, its signed previous pointer, and the complete descendant closure.
2. Append a `promotion-revoke` event naming the affected pointer hash, rollback reason, actor, and authenticated rollback proof hash.
3. Atomically replace the current pointer with a signed `revoked` tombstone containing `rollbackRecordHash` and `previousPointerHash`.
4. Append a `promotion-commit` for the revoked tombstone and advance the head.
5. Append descendant `promotion-revoke` events in topological order. No descendant remains `ready`, `PASS`, or live-verified while an ancestor is revoked/reopened.

Rollback never deletes or rewrites a ledger segment, artifact record, run, grade, calibration decision, source capture, or failure. Re-promotion requires a new generation and a fresh predecessor/role/gate validation; an old pointer is never resurrected by filename replacement.

## Tamper and equivocation detection

The validator reports a distinct code for each integrity failure:

| Code | Detection |
|---|---|
| `LEDGER-GENESIS` | Genesis signature/hash or release anchor differs. |
| `LEDGER-PARSE` | Duplicate key, malformed JSON, invalid encoding, or non-canonical line. |
| `LEDGER-SEQUENCE` | Gap, duplicate, out-of-order, or cross-segment sequence. |
| `LEDGER-CHAIN` | `prevChainHash`, `recordHash`, or `chainHash` mismatch. |
| `LEDGER-COMMIT` | Commit references absent/different prepare, or event is projected without commit. |
| `LEDGER-DUPLICATE` | Event ID reused with a different payload or transaction. |
| `LEDGER-HEAD` | Cached head disagrees with verified physical chain. |
| `LEDGER-ROLE` | Actor, role, or roster hash is unauthorized or expired. |
| `LEDGER-CLOSURE` | Predecessor hash, benchmark hash, or external root mismatch. |
| `PTR-SIGNATURE` | Pointer signature or signer key is invalid. |
| `PTR-LINK` | Pointer target, promotion commit, previous pointer, or closure does not match. |
| `PTR-SOLE` | More than one current pointer or an untracked replacement exists. |
| `PTR-STATE` | State is ahead of the required gate, or R30 is published as release-ready. |
| `PTR-EXPIRY` | R32 live authorization or `liveVerifiedUntil` is expired. |
| `PTR-RETENTION` | Rollback removed immutable evidence or retained failure history. |

Any code above is a package-blocking result. `LEDGER-CHAIN`, `LEDGER-GENESIS`, `PTR-SIGNATURE`, and `PTR-LINK` are `FAIL`; a locked-input change is `REOPEN`; absent evidence or an unresolved prepare is `INCOMPLETE`.

## Recovery and pointer conformance cases

These are machine-checkable test obligations, not fixtures. Each case starts from a sealed checkpoint, injects one fault, runs recovery twice, and verifies the stated result plus byte/hash preservation:

| Case | Injection | Required result |
|---|---|---|
| L-01 | Kill before prepare `fsync`. | No ledger/pointer change; `NO-OP`. |
| L-02 | Kill after prepare `fsync`. | Prepare retained; abort receipt; no PASS. |
| L-03 | Kill after commit `fsync` before head update. | Head rebuilt; committed event present exactly once. |
| L-04 | Corrupt `head.json.tmp`. | Temp quarantined; head rebuilt from ledger. |
| L-05 | Kill after pointer rename before promotion commit. | Valid pointer completes only through authenticated commit; invalid pointer is restored/revoked. |
| L-06 | Truncate the final partial ledger line. | Exact torn suffix quarantined; verified prefix unchanged. |
| L-07 | Flip a byte in the middle of a segment. | `LEDGER-CHAIN` / `FAIL`; no truncation or promotion. |
| L-08 | Replay a committed `eventId` with identical payload. | `NO-OP`; no duplicate event or sequence. |
| L-09 | Replay an `eventId` with different payload. | `LEDGER-DUPLICATE` / `FAIL`; no append. |
| L-10 | Replace pointer target with another sealed hash. | `PTR-LINK` / `FAIL`; current pointer not accepted. |
| L-11 | Publish a second current pointer for one package. | `PTR-SOLE` / `FAIL`; descendants blocked. |
| L-12 | Revoke R29 while leaving R31 ready. | Descendant `REOPEN`; R31 pointer revoked; immutable records retained. |
| L-13 | Advance R32 pointer beyond live expiry. | `PTR-EXPIRY` / `FAIL`; no live PASS. |
| L-14 | Change role-roster bytes after a pointer commit. | `LEDGER-ROLE` / `REOPEN`; requalification required. |
| L-15 | Run recovery twice after each successful case. | Second run `NO-OP`; hashes and bytes identical. |

## Acceptance gate

The ledger design is accepted only when an implementation can demonstrate, in a disposable root:

- canonical hash/signature verification for every R28–R32 envelope and pointer;
- prepare/commit recovery at every write boundary, including pointer swap;
- preservation of every verified prefix and immutable failure record;
- deterministic head reconstruction and idempotent second recovery;
- sole-pointer and descendant-revocation enforcement;
- no `PASS` from an uncommitted, unsigned, expired, hash-mismatched, or role-invalid state;
- no mutation outside the disposable ledger/pointer root and no paid/network operation.

This document defines the storage and recovery contract only. It authorizes no fixtures, implementation, benchmark run, credential access, or credit spend.

## Offline signed-verification implementation seam

The read-only `fetchproof/lib/release-validator.mjs` implementation exposes
`verifyQualificationLedger({ records | ledgerPath, pointer, publicKeys, head,
genesisHash, genesis | genesisPath, checkpoints | checkpointsDir })`. When a
genesis anchor is supplied (or discovered beside a ledger directory), it
verifies the canonical self-excluding digest and Ed25519 signature. Rotated
segments may supply signed checkpoint files; each checkpoint digest/signature,
genesis link, sequence, chain hash, snapshot hash, and duplicate/ordering rule
is checked before promotion. It verifies each qlog record against
`qualification-ledger-record.schema.json`, recomputes payload/record/chain hashes,
rejects duplicate event IDs with divergent payloads, verifies Ed25519 pointer
signatures, resolves `promotionCommitHash` to a committed `promotion-commit`, and
checks package/target/closure links. A durable prepare or promotion intent without
an append-only resolution, a missing commit, a malformed/torn tail, a signature/key
failure, or a cached head that disagrees with the verified suffix returns
`INCOMPLETE`; it never infers `PASS` from a pointer file alone. The CLI accepts
`--ledger`, `--head`, `--keys` (a JSON map of key IDs to public-key PEM/DER), and
`--genesis-hash` on `researcher-release validate`. No command writes ledger, head,
pointer, key, or recovery state.

For rotated ledgers, the CLI also accepts `--genesis <genesis.json>` and
`--checkpoints <checkpoint-directory>`. If `--ledger` names a directory, it
auto-discovers `genesis.json` and `checkpoints/*.json`; missing genesis,
duplicate/non-contiguous segment numbers, invalid signatures, hash drift, or a
checkpoint that does not resolve to the verified segment chain are fail-closed.
