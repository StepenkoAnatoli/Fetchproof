# Offline R26-R33 graph-conformance tests

**Status:** normative test specification; fixture-free and offline  
**Profile:** `researcher-benchmark-c14n-v1`  
**Applies to:** predecessor registries, promotion pointers, descendant invalidation, and rollback requests  
**Companions:** [descendant invalidation and atomic rollback](2026-09-16-researcher-r26-r33-descendant-invalidation-atomic-rollback.md) and [qualification ledger](2026-09-16-researcher-benchmark-qualification-ledger.md)

This packet defines deterministic tests for the hash-closed R26-R33 graph. Test graphs are
synthetic in-memory values: no benchmark fixture, source capture, credential, network call,
or paid request is created. A conforming implementation must produce the same closure,
affected-pointer order, ledger decision, and rollback state in every supported language.

## 1. Test representation and oracle

### 1.1 Synthetic hash tokens

To keep vectors reviewable, tables use labels such as `R26`, `T28`, and `T29A` instead of
64-character hashes. The harness expands each label exactly as:

```text
h(label) = SHA-256(UTF-8("researcher-graph-test-v1\0" + label))
```

Labels are case-sensitive; the resulting lowercase digest is the only value placed in a
machine graph. The labels are test inputs, not release artifacts.

### 1.2 Pointer node

Each synthetic pointer has `{package, generation, recordId, targetHash, predecessorHashes}`.
`predecessorHashes` is an ordered list. The registry separately authenticates roots `R26`,
`R27`, and `G3`. An edge exists from a pointer to every predecessor hash and to its target
hash, as defined by the rollback contract. A test registry must reject duplicate
`(package,generation,recordId)` identities and more than one current pointer per package.

### 1.3 Closure oracle

For pointer `p`, `closure(p)` is a depth-first walk of its ordered predecessor list, visiting
each hash once, then considering the pointer target ancestry. The oracle:

1. authenticates every root and pointer hash;
2. rejects a cycle before emitting any closure or invalidation record;
3. uses a `visited` set for duplicate convergence;
4. sorts affected current pointers by package rank `R28` through `R33`, then generation,
   then `recordId`;
5. sorts multiple invalidation-root hashes lexicographically inside each record; and
6. emits exactly one revocation/rollback record per affected current pointer.

The expected affected set is the fixed point of the descendant predicate, not merely direct
package neighbors. Repeating an identical request with the same transaction ID is `NO-OP`;
it must not append another revocation record.

### 1.4 Result envelope

Every test returns one canonical result envelope:

```json
{
  "testId": "G-01",
  "graphHash": "<hash of canonical synthetic registry>",
  "requestIds": ["<request ids>"],
  "status": "PASS|FAIL|BLOCKED|NO-OP|CONFLICT",
  "primaryReason": "<stable reason code>",
  "affectedPointers": ["<record ids in required order>"],
  "revocationRecordIds": ["<ledger record ids in append order>"],
  "ledgerHeadBefore": "<hash>",
  "ledgerHeadAfter": "<hash or unchanged>",
  "currentPointersAfter": {"R28": "<pointer hash or revoked>", "R29": "<...>"}
}
```

Unknown test IDs, reason codes, statuses, or omitted affected descendants are failures. A
negative test passes only when no unauthorized pointer or ledger write occurs.

The synthetic registry is serialized as `{"roots":[...],"pointers":[...]}` under the
canonical JSON profile. `roots` are sorted by root ID; `pointers` are sorted by package rank,
generation, and `recordId`; each pointer's `predecessorHashes` remains in authored order.
`graphHash` is SHA-256 over those canonical bytes with no final LF. This makes the input
snapshot hash reproducible without depending on map iteration or filesystem order.

## 2. Shared-ancestor vectors

All rows below use `h(label)` expansion. `T28BASE` is the target of `P28`; `T28` is a
shared predecessor artifact consumed by both R29 branches.

| ID | Synthetic pointers (predecessors in authored order) | Invalidation request | Required affected order | Required result |
|---|---|---|---|---|
| `G-01` | `P28(R28,g1,T28BASE,[R26,R27])`; `P29A(R29,g1,T29A,[T28])`; `P29B(R29,g2,T29B,[T28])`; `P30(R30,g1,T30,[T29A,T29B])`; `P31(R31,g1,T31,[T30])`; `P32(R32,g1,T32,[T31])`; `P33(R33,g1,T33,[T32])` | Revoke `R26` | `P28,P29A,P29B,P30,P31,P32,P33` | `PASS`; one revocation record per pointer; no `ready` descendant |
| `G-02` | Same graph as `G-01` | Revoke shared artifact `T28` | `P29A,P29B,P30,P31,P32,P33` (not `P28`) | `PASS`; shared ancestor appears once in every closure |
| `G-03` | `P28(...,[R26,R27])`; `P29A(...,[T28])`; `P29B(...,[T28])`; `P30(...,[T29A,T29B])` | Revoke both `T29A` and `T29B` in one request | `P30` once | `PASS`; roots sorted lexicographically; no duplicate revocation |

`G-01` proves that one invalidated root fans out through two R29 branches. `G-02`
proves transitive invalidation from a shared target. `G-03` proves that multiple paths to
one descendant do not duplicate records or change package ordering.

## 3. Cycle and duplicate-identity vectors

| ID | Injected graph defect | Required status/reason | Required side effect |
|---|---|---|---|
| `G-04` | Self-cycle: `P29(T29,[T29])` | `FAIL`, `graph.cycle` | No closure, pointer replacement, or ledger append |
| `G-05` | Two-node cycle: `P29(T29,[T30])`; `P30(T30,[T29])` | `FAIL`, `graph.cycle` | Report the deterministic cycle path `T29->T30->T29`; freeze all promotion |
| `G-06` | Same `recordId` appears twice with different target or predecessor list | `FAIL`, `graph.duplicate-record` | Do not choose a winner; retain input snapshot only |
| `G-07` | Two current pointers claim package `R30` | `FAIL`, `graph.multiple-current` | No rollback plan is valid; require registry repair |
| `G-08` | A closure visits `T28` through both `T29A` and `T29B` | `PASS` with one `T28` visit | Deduplicate by hash, while preserving first DFS encounter order |
| `G-09` | Same invalidation request is replayed after commit | `NO-OP`, `request.idempotent` | Ledger head and current pointers byte-identical; zero new revocation records |

Cycle detection occurs before descendant selection. A cycle is not treated as a harmless
duplicate, and a duplicate identity is not resolved by filename, timestamp, generation
guessing, or last-writer-wins behavior.

## 4. Concurrent rollback request vectors

### 4.1 Lock and stale-plan rules

Every request carries `requestId`, `baseHeadHash`, `invalidationRoots`, and a proposed
rollback plan hash. Writers acquire the global ledger lock first, then package locks in
ascending order `R28` through `R33`; no other lock order is permitted. While holding the
locks, the writer rechecks the head and all current pointer hashes.

- If `baseHeadHash` differs from the authenticated head, the request performs no write,
  returns `CONFLICT` with `rollback.stale-plan`, releases locks, and may be retried with a
  newly hashed plan.
- If the new request has the same authenticated root and payload as a committed request,
  it returns `NO-OP`.
- If two roots are independently valid, a retry may union them into one new plan. The union
  is sorted and rehashed; it is not an in-place edit of the first transaction.
- A request whose target becomes invalid after the other request commits is `BLOCKED` and
  must not publish a replacement pointer.
- Exactly one request linearizes at each ledger head. Physical completion order is the
  order of committed ledger sequence, never wall-clock arrival order.

### 4.2 Concurrency cases

| ID | Initial state and requests | Allowed schedules | Required outcome |
|---|---|---|---|
| `C-01` | `R29` and descendants are ready. `Q-A` revokes `T29A`; `Q-B` revokes `T29B`; both use the same `baseHeadHash`. | Either request acquires the lock first | First request commits; second returns `CONFLICT`, then may retry as a union. Final affected closure equals `P30` and every later descendant exactly once. |
| `C-02` | `Q-A` revokes `R26`; `Q-B` rolls back `R31` to a target that depends on `R26`. | `Q-B` wins first or second | If `Q-B` wins first, `Q-A` invalidates it transitively. If `Q-A` wins first, `Q-B` is `BLOCKED` unless its rebased target is closure-valid. No final `ready` descendant survives. |
| `C-03` | Two clients submit the same `requestId`, plan hash, and root concurrently. | Both arrive before either response | One commit; the other `NO-OP` after re-reading the ledger. Exactly one transaction ID and one revocation set exist. |
| `C-04` | `Q-A` targets R29 and `Q-B` targets R32 with independent valid roots. | Both contend for the global lock | One deterministic ledger order; the loser detects stale head and rebases or returns `CONFLICT`; no deadlock, lost update, or mixed pointer set. |
| `C-05` | A request holds the lock, then crashes after prepare and before pointer publication. A second client submits a rollback. | Recovery runs before the second request | Recovery resolves the first transaction (`ABORT` or committed completion); second client observes the recovered head and never appends over an unresolved prepare. |
| `C-06` | A request has renamed some pointers but has no commit; another client reads current files. | Read occurs during partial publication | Reader reports `INCOMPLETE`/`BLOCKED`, never `PASS`; recovery restores or completes the authenticated post-hash set before new promotion. |

## 5. Concurrency invariants and linearizability checks

The offline harness must assert all of the following for every permitted interleaving:

1. At most one writer owns `ledger.lock`; lock acquisition order cannot deadlock.
2. Every committed transaction names the exact `baseHeadHash`, old pointer hashes,
   replacement/tombstone hashes, invalidation roots, and rollback-plan hash.
3. Ledger physical sequence and chain hashes are contiguous; no request reuses a sequence.
4. A stale plan never writes a pointer. A retry writes only after recomputing the complete
   closure against the current head.
5. The final current pointer set is one of the serial executions permitted by the lock
   order, or a deterministic union transaction explicitly recorded in the ledger.
6. The affected set is duplicate-free, transitively complete, and sorted by the rollback
   contract. Every invalidated descendant is revoked or replaced; no unaffected pointer is
   changed without an explicitly named root.
7. A cycle, duplicate identity, missing root, or ambiguous current pointer freezes promotion
   and leaves the snapshot and ledger unchanged.
8. Recovery is idempotent: repeating recovery after any `C-05`/`C-06` outcome returns
   `NO-OP` and produces byte-identical head, pointer, and ledger state.

## 6. Evidence and release gate

`GRAPH-GATE-01` is PASS only when all `G-01` through `G-09` and `C-01` through `C-06`
pass using at least two independent implementations or one implementation plus a
language-independent oracle. The evidence bundle contains:

- canonical synthetic registry input and its graph hash;
- test result envelopes and implementation versions;
- closure traces, cycle paths, duplicate checks, and affected-pointer ordering;
- lock/transaction traces with base-head, stale-plan, rebase, and idempotency outcomes;
- ledger head/chain proofs and before/after current-pointer hashes;
- recovery receipts for partial publication cases.

Any cycle accepted as a valid graph, duplicate descendant record, lost concurrent update,
deadlock, mixed old/new pointer set, stale-plan write, or surviving descendant `PASS` is a
hard release blocker. The graph report is canonicalized, hashed, and appended to the
qualification ledger before BM-5/BM-6 or R33-03 approval.

### 6.1 Persisted property regressions

The canonical-hashing, predecessor-closure, and descendant-invalidation property loops use
fixed unsigned-32-bit seeds. If an iteration fails, the harness creates exactly one canonical JSON envelope at
`fetchproof/conformance/property-regressions/PREG-<family>-<seed-hex>-<iteration>.json`.
It records the replay profile/version, family, seed, iteration, regenerated-input SHA-256,
bounded failure name/message, and a self-excluding envelope SHA-256. Existing envelopes are
immutable: a subsequent failure for the same case may read it but must not replace it.

Replay is intentionally narrower than the suite and is read-only:

```text
node fetchproof/bin/property-replay.mjs --case <case.json> --json
node fetchproof/bin/property-replay.mjs --all --json
```

The replay implementation must reject duplicate-key JSON, unsupported profiles, invalid
envelope hashes, and regenerated-input hash drift. It returns `FAIL` rather than silently
using a changed generator. These cases are synthetic conformance records, not benchmark
fixtures or release evidence; a recorded failure remains a release blocker until the replay
passes and the underlying correction is independently reviewed.

### 6.2 Exported cross-language vectors

`fetchproof/conformance/property-graph-hash-vectors.json` exports static, synthetic
values from declared canonical-hashing and descendant-invalidation seeds. It includes an
object-order/array-order hash case, a self-excluding record and chain-hash case, and one
R28–R33 graph with base, self-cycle, and duplicate-identity outcomes. The source-case map is
part of the packet so reviews can reproduce the export without treating a live test run as
evidence.

Both runners consume the checked-in bytes and never regenerate or rewrite them:

```text
node fetchproof/bin/property-vector-conformance.mjs --json
python fetchproof/bin/property_vector_conformance.py --json
```

They must agree on every normalized vector row (not runtime metadata), reject malformed or
duplicate-key packets, and fail a vector when canonical bytes, hash domains, closure order,
or failure reason diverges. The packet contains no benchmark fixture, source capture,
credential, or private signing material.

## 7. Reviewer attestations

| Attestation | Reviewer entry |
|---|---|
| Synthetic hash expansion and graph hash were reproduced offline |  |
| Shared-ancestor closures are complete and duplicate-free |  |
| Cycles and duplicate identities were rejected before any write |  |
| Concurrent requests obeyed global/package lock order and stale-plan rules |  |
| Final state is linearizable and no descendant remained promotable |  |
| Recovery outcomes were idempotent and append-only |  |
| Evidence hashes and implementation versions are recorded |  |
| Final disposition (`PASS` / `FAIL` / `BLOCKED`) |  |
| Independent verifier / identity / UTC timestamp |  |
