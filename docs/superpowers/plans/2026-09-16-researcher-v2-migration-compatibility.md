# Researcher v2 migration compatibility and fault-injection plan

> For agentic workers: read the referenced specification and repository guidance before implementation. Keep each task independently revertable.

**Status:** review packet; documentation only; no migration, fixture creation, credit spend, or code change is authorized by this document.

The reviewer sign-off form is [`2026-09-16-researcher-v2-migration-reviewer-signoff.md`](../specs/2026-09-16-researcher-v2-migration-reviewer-signoff.md). It is the blank attestation surface for the artifact rows, migration/release gates, rollback rules, and FI-01–FI-30 cases defined here.

Future-schema handling is governed by [`2026-09-16-researcher-v3-schema-drift-policy.md`](../specs/2026-09-16-researcher-v3-schema-drift-policy.md); a detected v3 artifact remains `BLOCKED` until its ADR, matrix update, and rollback proof are approved.

**Goal:** define an artifact-by-artifact v1-to-v2 compatibility contract, deterministic rollback rules, and a complete fault-injection catalogue for the researcher reliability repair plan.

**Architecture:** legacy artifacts are read through a read-only adapter; v2 is the only write format. Migration is snapshot-first, validate-before-publish, idempotent, and refusal-oriented. Immutable evidence and append-only history are never rewritten in place. Shared pointers and manifests publish atomically after their referenced bytes are durable.

**Tech Stack:** the repository's dependency-free Node.js modules, Markdown/JSON/JSONL artifacts, Git hooks, and the benchmark v1.0.0 contract.

**Normative inputs:**

- `docs/superpowers/specs/2026-09-16-researcher-benchmark-design.md` v1.0.0 is the sole authority for benchmark hierarchy, scoring, validity precedence, cold/warm rules, cost accounting, calibration, and release thresholds.
- `docs/superpowers/plans/2026-09-16-researcher-reliability-repair.md` is the package and migration-gate authority (R6–R25 and R26–R33).
- This packet specifies migration compatibility and failure handling only; it cannot relax either input.

## Global compatibility contract

1. **Read old, write v2.** Legacy versions are accepted only by a read-only adapter. Any successful write, pointer update, or append produced by migration is canonical v2 and carries the migration version.
2. **Unknown future versions refuse.** A version greater than the supported v2, an unknown required field, or an unrecognised discriminator yields `BLOCKED` with no destination mutation.
3. **Snapshot before mutation.** Before the first write, capture bytes, mode, relative path, and SHA-256 for every artifact in the migration set. The snapshot itself is immutable and authenticated by a manifest.
4. **Validate before publish.** Parse and normalize legacy input, validate semantic invariants, render to a temporary destination, fsync the bytes, verify the v2 hash, then publish with an atomic rename or pointer swap. A partially written destination is never considered v2.
5. **Idempotence.** Re-running migration against an already canonical v2 set is `NO-OP`; it must not change bytes, versions, sequence numbers, timestamps that are part of the artifact, or usage totals.
6. **No silent meaning changes.** Dropped, merged, defaulted, or reinterpreted fields are listed in the migration manifest with a disposition (`preserved`, `derived`, `quarantined`, or `requires-review`). A `requires-review` row cannot become approved through migration.
7. **Containment.** All project artifacts resolve below the project root. Absolute paths, traversal, symlink escapes, destination collisions, and out-of-root rollback targets refuse before a write.
8. **History is append-only.** Raw captures, the verified ledger prefix, audits, review decisions, and benchmark run evidence remain addressable after migration. Rollback removes only a derived current pointer/status, never history.
9. **One manifest per migration.** The manifest records artifact ID/path, legacy schema and hash, v2 schema and hash, source snapshot hash, dependency versions, conversion disposition, validation result, rollback token, actor, and UTC time.
10. **Outcomes are explicit.** Every attempt ends in exactly one of `MIGRATED`, `NO-OP`, `BLOCKED`, or `ROLLED-BACK`. `BLOCKED` means zero destination/pointer writes; `ROLLED-BACK` means the pre-migration bytes or pointer state was restored and the failure is retained.

## Artifact-by-artifact v2 compatibility matrix

The `legacy input` column describes what the adapter may read; it is not permission to preserve an unsafe or ambiguous interpretation. Exact field names are frozen by the owning repair package and benchmark v1.0.0 where applicable.

| ID | Artifact family and examples | Legacy input accepted | v2 canonical write | Owner/package and dependencies | Compatibility invariants and refusal rules | Rollback unit | Required gate |
|---|---|---|---|---|---|---|---|
| A01 | Discovery contract: `research/DISCOVERY.md` | v1 headings, question lists, build intent, and known-unknown markers | Versioned front matter plus canonical intent/unknown sections; dispositions retain source wording | `corpus.mjs`, R6/R10; R1/R2 | Every blocking unknown has a map reference; unresolved markers remain unresolved; duplicate question IDs or future schema refuse | One file plus migration manifest row | M1, M2 |
| A02 | Research map: `research/MAP.md` | Seeded universal/topic subtopic rows and legacy status spellings | Canonical subtopic IDs, status enum, evidence references, and coverage claim | `corpus.mjs`, R6/R7 | `COVERED` cites existing unknowns; `DISMISSED` has a reason; `GAP` is not upgraded; duplicate IDs and orphan citations refuse | One map file | M1, M2 |
| A03 | Collection plan: `research/plan.json` | Legacy query/URL entries, budgets, refresh settings, and transport hints | Canonical schema/version, deterministic ordering, operation IDs, explicit cap/transport fields, input fingerprint | `research-run.mjs`, R6/R10/R24 | Numeric limits are finite/non-negative; no hidden operations; fingerprint is stable; unknown transport or future schema refuses | Plan file and its fingerprint pointer | M1, M3/M4 |
| A04 | Evidence table: `research/EVIDENCE.md` | Legacy rows with URL, finding/raw reference, dates, and quality labels | Canonical claim/source row representation with stable IDs and explicit completeness/omission state | `corpus.mjs`, R6/R20–R23 | Raw reference and ledger row must exist; partial capture cannot close a claim under strict policy; no automatic approval | Evidence table plus derived claim links | M1, M2, M4 |
| A05 | Handoff brief: `research/BRIEF.md` | Existing prose, headings, citations, and handoff metadata | Canonical versioned brief retaining authored bytes and adding generated metadata separately | `brief.mjs`, R6/R10/R25 | Authored prose hash is preserved; deterministic regeneration cannot overwrite reviewed text; unresolved markers remain visible | Brief destination (or generated sidecar only) | M1, M2, M4 |
| A06 | Source registry/authority records | Legacy source URLs, labels, and retrieval dates, including rows embedded in evidence | Stable source IDs, anchored ownership group, authority class, published/updated/retrieval dates, cache metadata | `corpus.mjs`/semantic seam, R20–R22 | Host lookalikes are not merged; missing locator/date is `requires-review`; source ownership is explicit | Source row(s), never raw body | M4 |
| A07 | Raw captures: `research/raw/*.md` and front matter | Captures with older front matter; body bytes and filenames | Body bytes preserved; v2 front matter adds named transport, operation, completeness, and omission metadata | transport/collection seam, R5/R6/R21 | Body hash is computed over captured bytes; missing transport/operation or unexplained partiality blocks closure; no recapture during migration | Each capture file and front matter sidecar | M1, M2, M4 |
| A08 | Fetch ledger: `research/raw/.fetches.jsonl` | Verified legacy hash chain with older entry fields | Existing verified prefix byte-for-byte retained; only a verified truncated tail may be repaired with v2 entries | `provenance.mjs`, R6/R9/R11 | Previous-hash chain, body hash, URL, transport, and sequence validate; middle-prefix edits, duplicate sequence, or unknown transport refuse | Verified prefix is immutable; tail repair is one append transaction | M1, M2 |
| A09 | Usage/cost log and cache accounting | Legacy operation totals, cache hits, retries, and cost units | Append-only operation records with attempt ID, cache disposition, transport, units, and total-cap reconciliation | `collect.mjs`/`research-run.mjs`, R6/R24 | Every attempt is counted; cache hits cost zero but are not failures; no negative/NaN totals; duplicate attempt IDs refuse | Current append tail or derived total pointer | M3/M4 |
| A10 | Audit records and rendered audit files | Legacy audit versions, input lists, findings, decisions, and brief hash | Immutable versioned audit file with canonical dependency fingerprint and render inputs | `audit.mjs`, R6/R11/R12 | Any rendered-input change creates a new version; filename/H1/front matter/index agree; old audit remains readable | Newly created audit file only; prior audit untouched | M1, M2, M4 |
| A11 | Audit index/current pointer | Legacy index or current-version marker | Atomic v2 index/pointer referencing only durable, hash-verified audit files | `audit.mjs`/`archive.mjs`, R13 | Pointer never references missing, duplicate, or unverified file; orphan recovery is deterministic | Pointer/index file, not audit history | M2 |
| A12 | Machine configuration | Legacy `role`, transport, path, or feature keys | v2 schema with validated enums, canonical paths, and authenticated last-good snapshot | `machine.mjs`, R6/R14 | `collector`, `builder`, `unknown` are the only roles; unknown/misspelled keys do not authorize collection; copied config without matching snapshot is untrusted | Config file plus last-good snapshot and pointer | M1, M2 |
| A13 | Installer/hooks state | Legacy install marker, hook path, and selected-hook metadata | Versioned install state recording selected hook, hashes, and unrelated-setting preservation | `installer.mjs`/`doctor.mjs`, R14/R18/R26 | Existing hook settings are preserved; configured hook path is explicit; local hooksPath conflict is diagnosed, not silently replaced | Install-state pointer and generated hook files as one package | M2, G2, R26 |
| A14 | Boundary scan/secret diagnostics | Legacy scan report and ignore assumptions | Bounded scan manifest with redacted diagnostics and explicit skipped-content reasons | `doctor.mjs`, R6/R15 | `.env`, `.env.*`, `.firecrawl`, hidden/oversized/skipped files are represented; secrets never appear in output; skipped is not clean | Scan report only; source files untouched | M2 |
| A15 | Stable IDs and table semantics | Count-based IDs, reordered headers, duplicate/missing columns | Highest-existing-ID allocation and header-name-to-column writes | `corpus.mjs`/`collect.mjs`, R7 | Sparse IDs are retained; duplicate IDs/headers and missing required headers refuse; row order does not change meaning | Newly generated row/table output | M2 |
| A16 | Writer lease and recovery state | Legacy lock/PID/age marker | Tokenized lease with heartbeat, PID/liveness evidence, bounded abandoned-lock state | `provenance.mjs`, R8/R9 | Token compare required for release; unknown liveness is not dead; age alone cannot evict an active holder | Lease file/token; data files untouched | M2 |
| A17 | Claim records | Evidence rows that can be normalized to claims; legacy claims without review fields | v2 claim record: question ID, kind, scope, source IDs/groups, locator, dates, reviewer actor/time, status | semantic seam, R20 | Missing locator/source/date is `requires-review`; legacy rows are historical; no claim becomes approved by default; future discriminator refuses | Claim record(s) and derived status only | M4 |
| A18 | Review decisions | Legacy approval/rejection notes and reviewer metadata | Immutable review event with actor, UTC time, decision, rationale, claim/source version, and supersession link | semantic seam, R20/R23 | Decision binds to exact claim/source hashes; missing actor/time or stale target is non-approving; edits append a superseding event | New review event; prior decision retained | M4 |
| A19 | Supersession/lifecycle links | Refresh markers and old active rows | Explicit active/superseded evidence links and dependent-claim invalidations | `corpus.mjs`/`audit.mjs`, R23 | Refresh never silently validates an old claim; dependent claims transition to `review-required`; old evidence remains readable | Lifecycle pointer/status events | M4 |
| A20 | Readiness and handoff status | Implicit “clean/complete” checks and legacy handoff marker | Enum `structurally-valid`, `review-required`, `handoff-approved` with transition evidence | `checks.mjs`/`preflight.mjs`, R25 | Missing review is not “none found”; approval requires reviewed brief, answered plan, coverage dispositions, contradiction decision, and no unresolved markers | Readiness pointer only | M4 |
| A21 | Plan/input fingerprints and run manifests | Legacy run metadata and implicit working-tree state | Canonical plan hash, input hash, environment identity, operation list, and sealed outcome | `research-run.mjs`, R24/R27 | Changed plan fingerprint refuses execution; environment and candidate inputs are separated; manifest is sealed before grading | Run manifest/pointer; source corpus untouched | M3, G4 |
| A22 | Benchmark contract pin | Unpinned or pre-v1.0 task/run records | Exact v1.0.0 spec version and SHA-256 recorded in harness and every derived record | `fetchproof/test/benchmark/`, R28 | Missing, superseded, or mismatched hash blocks authoring, grading, and promotion; no local threshold override | Harness promotion pointer | Q0/R28 |
| A23 | Task/gold/calibration records | Authoring drafts and prior calibration batches | 24 task records, grader-only gold, reviewer decisions, agreement metrics, and warm manifests with contract hash | benchmark seam, R29 | Role separation; gold hidden from candidate; Section 12 agreement and universal-dimension coverage; failed batches remain history | R29 promotion pointer | Q1/R29 |
| A24 | Cold/warm/live qualification records | Prior run outputs and component reports | Sealed per-task results, track roll-ups, cost reconciliation, and release pointers | benchmark seam, R30–R33 | Validity precedence and warm manifest-only rule match v1.0.0; live requires explicit authorization; reports are append-only | Track/release pointer only | Q2–Q5 |

### Compatibility dispositions

| Disposition | Meaning | Allowed automatically |
|---|---|---|
| `preserved` | Same bytes or same normalized meaning with no loss | Yes, after hash and invariant checks |
| `derived` | New v2 field computed solely from authenticated legacy data | Yes, if derivation is deterministic and recorded |
| `quarantined` | Data is retained but excluded from active/approved state | Yes; visible in manifest |
| `requires-review` | Human decision is needed to establish meaning, authority, or approval | No approval or release promotion |

## Migration transaction and rollback rules

### Universal transaction

1. Resolve and inventory only in-root paths; reject symlink escapes and duplicate logical artifact IDs.
2. Acquire the package writer lease and record the lease token. A lost or ambiguous lease is `BLOCKED`.
3. Snapshot every source byte and relevant metadata. Write the snapshot manifest to an isolated, durable location and verify its own hash.
4. Parse legacy input with the owning adapter. Validate schema, chain/pointer references, semantic invariants, and dependency versions before creating a destination.
5. Render v2 bytes into a sibling temporary path. Never write the legacy path in this phase. Verify encoding, canonical ordering, permissions, and expected hash.
6. Run semantic equivalence checks and disposition checks. Any unlisted loss, default, merge, or approval transition blocks.
7. Fsync the temporary bytes and containing directory. Publish by atomic rename or by writing a new immutable pointer followed by an atomic current-pointer swap.
8. Re-read the published artifact through the v2 reader, verify hashes and references, and append the migration manifest outcome.
9. Release the lease using the compare-token rule. A release race is recorded as a recovery condition and never deletes another holder's lock.

### Failure classes and response

| Phase | Failure | Required response | Permitted state after response |
|---|---|---|---|
| Inventory/parse | Invalid path, malformed input, unknown future version, chain/hash failure | `BLOCKED`; do not create or replace destination | Legacy bytes unchanged; diagnostics and manifest may be written outside the artifact set |
| Snapshot | Read error, snapshot hash mismatch, storage failure | `BLOCKED`; discard incomplete snapshot | Legacy bytes unchanged |
| Render/validate | Conversion error, invariant failure, unlisted disposition | `BLOCKED`; remove only unpublised temporary files after recording their hashes | Legacy bytes and current pointer unchanged |
| Pre-publish write | Short write, encoding/permission error, process interruption | `ROLLED-BACK`; verify legacy hash against snapshot | Legacy bytes exactly restored/unchanged; temporary path inaccessible |
| Publish | Rename/pointer crash, directory fsync failure, destination collision | Recover from authenticated snapshot/pointer; if state cannot be proven, mark `BLOCKED` and quarantine ambiguous destination | Current pointer references old or fully validated v2, never an ambiguous mix |
| Post-publish validation | Hash/reference mismatch | Atomically restore prior pointer or move new file to quarantine; retain evidence | Legacy/current known-good state; failure record retained |
| Append-only tail | Verified truncated tail only | Repair by one authenticated append transaction; revalidate chain | Original verified prefix unchanged |
| Append-only middle/prefix | Any byte/hash/sequence alteration | No repair; `BLOCKED`, preserve forensic copy | Original prefix retained; no new active ledger |

### Per-family rollback rules

- **Markdown/JSON documents (A01–A05, A10):** restore the exact pre-migration bytes, mode, and path. A generated sidecar may be removed; authored prose and prior audits are never regenerated from a lossy v2 output.
- **Raw captures and ledger (A07–A08):** never recapture or rewrite a body. Rollback truncates only an uncommitted tail; an intact ledger prefix is immutable. A suspected middle corruption blocks and escalates to collector-side remediation.
- **Pointers and indexes (A11, A20–A24):** rollback swaps the pointer to the previously authenticated value. It does not delete target files, run records, gold, calibration decisions, or reports.
- **Machine/install state (A12–A14):** restore the last-good authenticated snapshot and preserve unrelated hook/config settings. If the snapshot is absent or fails authentication, remain `unknown`/`not-ready`; do not guess.
- **Claims/reviews/lifecycle (A17–A19):** rollback removes only newly derived active links/status; claim history and review events remain immutable. An approval transition is never undone by editing history; append a compensating review event if a human authorizes it.
- **Plans, budgets, usage, and run manifests (A03, A09, A21):** restore the prior plan/pointer and retain operation attempts. Never refund, erase, or recalculate paid usage during rollback.
- **Benchmark qualification (A22–A24):** revert the package promotion pointer (R28–R33) only. Candidate outputs, source captures, gold, calibration, cold/warm results, live cost evidence, and failed batches remain auditable.

### Migration gates and promotion

| Gate | Scope | Compatibility evidence required |
|---|---|---|
| M0 | Matrix review | Every artifact has an owner, legacy input, v2 output, refusal rule, rollback unit, and fault cases; exact schema owners are named |
| M1 | R6 framework | Synthetic legacy/current round trips, future-version refusal, byte/hash manifest, interruption recovery, and idempotent `NO-OP` |
| M2 | Durable state | R6–R15 corpus/config snapshots, ledger-prefix proof, audit publication recovery, brief preservation, and unknown-authority denial |
| M3 | Execution accounting | Plan fingerprint, retry/cache accounting, total-cap reconciliation, and dry-run byte purity |
| M4 | Semantic state | R20–R25 representative migration, no automatic approval, supersession invalidation, and readiness transition proof |
| Q0 | Benchmark contract | Human-approved v1.0.0 SHA-256 is present and identical in harness/task/gold/calibration/warm records |
| Q1–Q5 | Release qualification | R29–R33 use only sealed, hash-matching artifacts; rollback removes promotion status without mutating evidence |

No gate may be closed by a green aggregate that hides a failed artifact row. A gate report lists every row as `MIGRATED`, `NO-OP`, or `BLOCKED`, with hashes and rollback evidence.

## Fault-injection catalogue

The compact traceability view is [`2026-09-16-researcher-v2-fault-traceability-matrix.md`](../specs/2026-09-16-researcher-v2-fault-traceability-matrix.md); it maps every FI case to its artifact row, owning repair package, migration gate, and release-gate consequence.

Fault tests are deterministic, isolated to disposable project roots, and offline. They may use synthetic bytes and injected filesystem/process failures; they must not touch the user's real `research/`, machine config, Git hooks, credentials, or paid transports. Each case is run once at the named boundary and once on an already recovered state to prove idempotence.

| FI | Target | Injection point | Expected result | Required rollback/evidence assertion | Gate/package |
|---|---|---|---|---|---|
| FI-01 | Any versioned artifact | Reader sees schema `v3` or unknown required field | `BLOCKED`, zero destination/pointer writes | Legacy hash unchanged; refusal names field/version | M1/R6 |
| FI-02 | A01–A05 Markdown/JSON | Malformed header, JSON, or invalid UTF-8 | `BLOCKED` | No temp publish; parse diagnostic retained | M1/R6 |
| FI-03 | A01–A05 | Short write/zero-byte temp output | `ROLLED-BACK` | Source bytes equal snapshot; temp hash recorded/quarantined | M1/R6 |
| FI-04 | A01–A05 | Failure after temp fsync but before rename | `ROLLED-BACK` | Current path and pointer remain old; rerun is deterministic | M1/R6 |
| FI-05 | A01–A05 | Rename succeeds, directory fsync fails | Recovery chooses old or fully validated new state | Exactly one known-good pointer; no mixed bytes | M1/R6 |
| FI-06 | A11/A20–A24 | Crash between pointer write and pointer swap | Recover old pointer; new target remains orphan evidence | Pointer never references missing/unverified file | M2/Q gates |
| FI-07 | A10–A11 | Power-loss simulation between audit, index, and current writes | `ROLLED-BACK` or deterministic orphan recovery | Prior audit/index readable; orphan is listed, not deleted | M2/R13 |
| FI-08 | Snapshot/manifest | Snapshot or destination hash is tampered | `BLOCKED` | No restore from unauthenticated bytes; tamper hash retained | M1/R6 |
| FI-09 | A01–A05/A10 | CRLF/LF or Unicode normalization drift | `BLOCKED` unless canonicalization is explicitly specified | Authored-byte hash proves no silent rewrite | M1/R6/R10 |
| FI-10 | A02/A15 | Duplicate, sparse, reordered, missing, or duplicate-header rows | `BLOCKED` | Existing rows and IDs untouched; offending row named | M2/R7 |
| FI-11 | A07 | Capture omits transport, operation, completeness, or omission reason | `BLOCKED` for claim closure; capture retained as partial/quarantined | Body hash and omission metadata remain available | M1/M4/R21 |
| FI-12 | A08 | Ledger previous-hash break, duplicate sequence, wrong body hash, or unknown transport | `BLOCKED` | Verified prefix byte-identical; no automatic repair | M2/R11 |
| FI-13 | A08 | Truncated final JSONL line only | Tail repair allowed if prior prefix and capture hash verify | Prefix hash unchanged; one append manifest row | M2/R11 |
| FI-14 | A08 | Middle-line deletion or edit | `BLOCKED`; no repair | Forensic copy and first bad sequence recorded | M2/R11 |
| FI-15 | A09/A21 | Duplicate attempt ID, negative/NaN units, or total-cap undercount | `BLOCKED` | Existing usage remains; no refund/erase | M3/R24 |
| FI-16 | A12 | Misspelled role, invalid enum, copied config without matching snapshot | `unknown`/`BLOCKED`; collection denied | Last-good config or explicit unknown status preserved | M2/R14 |
| FI-17 | A13 | Local hooksPath conflict or hook write failure | `BLOCKED`/`not-ready` | Unrelated hook settings unchanged; install pointer old | M2/G2/R14 |
| FI-18 | A14 | Secret in `.env*`, hidden log, oversized or skipped file | Scan reports redacted finding or explicit skipped reason | No secret value in diagnostics; skipped is not clean | M2/R15 |
| FI-19 | A16 | Lease token race, heartbeat loss, live/unknown PID, or age threshold | `BLOCKED`; no eviction of uncertain holder | Token compare prevents deleting another lease | M2/R8–R9 |
| FI-20 | A17–A18 | Claim lacks locator/source/date or review actor/time | `requires-review`, never approved | Legacy row and missing-field diagnostic retained | M4/R20 |
| FI-21 | A19 | Source refresh supersedes evidence with dependent approved claim | Dependent claim becomes `review-required` | Old evidence/review remains history; no silent validation | M4/R23 |
| FI-22 | A20 | Missing brief/plan/disposition, pending contradiction, or unresolved marker | `review-required` | Approval pointer is absent; reason is explicit | M4/R25 |
| FI-23 | A03/A21 | Plan fingerprint changes between dry-run and execution | `BLOCKED` before request/state write | Original plan and usage unchanged | M3/R24 |
| FI-24 | A22–A24 | Benchmark spec version/hash mismatch, candidate-visible gold, or local threshold override | `BLOCKED`; no promotion | Hash mismatch and exposure evidence retained; gold remains grader-only | Q0–Q1/R28–R29 |
| FI-25 | A23 | Role conflict: author grades own gold or candidate sees calibration labels | `BLOCKED` | Role/audit records retained; no task promotion | Q1/R29 |
| FI-26 | A24 | Invalid candidate result, invalid environment, or cost discrepancy in cold/warm/live run | Apply v1.0.0 validity precedence; do not count invalid run toward threshold | Sealed run remains; roll-up/pointer not promoted | Q2–Q5/R30–R33 |
| FI-27 | A24 | Warm run has non-manifest network access or eligible cost | `BLOCKED` warm qualification | Warm pointer absent; network/cost evidence retained | Q3/R31 |
| FI-28 | Any artifact | Rollback destination collision, symlink, traversal, or out-of-root path | `BLOCKED` before restore | No unrelated path touched; attempted target named | M1–M4 |
| FI-29 | Any artifact | Process interruption at every write/fsync/publish boundary | `ROLLED-BACK` or `BLOCKED` with known-good state | Byte/hash/pointer comparison proves atomic outcome | M1–M4 |
| FI-30 | Any artifact | Re-run after successful migration and after rollback | `NO-OP` or identical deterministic migration | No byte, sequence, cost, or approval drift | M1–Q5 |

## Package-to-fault coverage and safe parallelism

| Package | Primary artifact rows | Mandatory fault cases | Parallelism rule |
|---|---|---|---|
| R6/M1 | A01–A14, A17–A21 framework portions | FI-01–FI-09, FI-28–FI-30 | Design may proceed beside G0; migration tests begin only after G0. Shared snapshot/manifest code is one lane |
| R7–R9 | A08, A15–A16 | FI-10, FI-12–FI-14, FI-19 | R7 and R8 may run in parallel; R9 waits for both; no shared fixture edits |
| R10–R13 | A03/A05/A10–A11 | FI-03–FI-07, FI-09 | R10→R11 and R12→R13 are separate lanes; R13 waits for R11 and R12 |
| R14–R15 | A12–A14 | FI-16–FI-18 | Parallel only with disjoint config/scan fixtures; M2 is serial |
| R20–R25/M4 | A04/A06/A17–A22 | FI-11, FI-15, FI-20–FI-23 | One semantic lane in order R20→R21→R22→R23→R24→R25 |
| R28 | A22 | FI-24, FI-26–FI-27 | Starts only after R26/R27 and Q0 approval; harness promotion is serial |
| R29 | A23 | FI-24–FI-25 | Task authoring can split by task after schema/role lock; promotion and calibration roll-up are serial |
| R30–R33 | A24 | FI-26–FI-27, FI-30 | Qualification runs are serial at package boundaries; reports are append-only |

## Review and acceptance checklist

- [ ] M0 reviewer confirms all 24 artifact rows have a named owner, accepted legacy input, canonical v2 output, invariant/refusal rule, rollback unit, and at least one fault case.
- [ ] R6 freezes the migration manifest and outcome enum before any format-specific migration work.
- [ ] Every migration test proves source-byte preservation on `BLOCKED`, exact restoration on `ROLLED-BACK`, and byte/semantic stability on `NO-OP`.
- [ ] Append-only artifacts prove prefix immutability; only an authenticated final tail may be repaired.
- [ ] Pointer rollback is separated from evidence rollback; no history, gold, calibration, cost, or review record is deleted or edited.
- [ ] A representative legacy corpus reaches M2 and M4 without automatic claim approval or handoff approval.
- [ ] Benchmark records pin the exact benchmark v1.0.0 SHA-256 from Q0; mismatches block R29–R33.
- [ ] FI-01–FI-30 run offline in disposable roots with deterministic injected failures; each result records status, hashes, pointer state, and recovery evidence.
- [ ] No fixture files, product code, credentials, live requests, or paid credits are created or consumed by this packet.

## Later implementation handoff (not executed here)

When a builder is authorized to implement the repair plan, the first commit must add the R6 migration manifest contract and M0 review record. Subsequent commits follow the package order in the repair plan and cite the applicable artifact IDs and FI cases. A package cannot be promoted when its preceding gate is open, its rollback evidence is missing, or its artifact rows diverge from this packet without a superseding ADR and review.

## Self-review

- The matrix covers source, plan, evidence, provenance, audit, machine/install, semantic, readiness, and benchmark-release artifacts rather than treating “the corpus” as one opaque file.
- Rollback distinguishes mutable derived pointers from immutable history and explicitly handles the verified ledger-prefix exception.
- Fault cases cover parse, hash, encoding, write, fsync, pointer publication, concurrency, authority, semantic review, cost, benchmark contract, and idempotence failures.
- This is a review artifact only; it does not claim that any migration or fault-injection test has run.
