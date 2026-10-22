# Researcher benchmark trap-row offline validator

**Status:** proposed normative validator contract; fixture-free  
**Validator contract version:** 1.0.0  
**Governing benchmark:** `2026-09-16-researcher-benchmark-design.md` v1.0.0  
**Trap source:** `2026-09-16-researcher-benchmark-calibration-adjudication-matrix.md` v1.0.0  
**Task source:** `2026-09-16-researcher-benchmark-expanded-task-calibration-packets.md` v1.0.0  
**Gold-lock projection gate:** [`2026-09-16-researcher-benchmark-gold-lock-migration-gate.md`](./2026-09-16-researcher-benchmark-gold-lock-migration-gate.md) (`GL-1`, a BM-2 subgate)  

## Purpose and boundary

This specification defines a deterministic, offline validator for calibration-trap rows. It
fails closed when a row is missing a task, claim, constraint, outcome, or hard-failure
identifier. It also rejects identifiers that are unknown, cross-task, duplicated, or only
represented by prose. The validator is a design contract only; this change creates no
implementation, fixture, source value, URL, capture, credential, or paid request.

The human-facing adjudication matrix remains the review document. The validator consumes a
canonical machine register produced during gold lock. A Markdown cell such as “critical
security hard failure” or “Gold-locked live outcome” is not an identifier and must not be
silently converted into one.

## Invocation and isolation contract

The eventual command-line surface is:

```text
researcher-benchmark trap-validate \
  --register <path/to/trap-register.json> \
  --benchmark <path/to/2026-09-16-researcher-benchmark-design.md> \
  --tasks <path/to/2026-09-16-researcher-benchmark-expanded-task-calibration-packets.md> \
  --matrix <path/to/2026-09-16-researcher-benchmark-calibration-adjudication-matrix.md> \
  --json <path/to/report.json>
```

The command is read-only. It must not open sockets, resolve DNS, read environment secrets,
invoke a browser or external service, spend benchmark credits, modify inputs, create
fixtures, or write anywhere except the explicitly requested report path. Inputs must be
regular files under the approved repository root; path traversal and symlinks outside that
root are rejected. The report records SHA-256 hashes of every input so a review can reproduce
the result against the same bytes.

Exit status is deterministic:

| Exit | Status | Meaning |
|---:|---|---|
| 0 | `PASS` | All rows and cross-references satisfy this contract. |
| 1 | `FAIL` | At least one present row is malformed, unknown, duplicated, or inconsistent. |
| 2 | `INCOMPLETE` | A required input or required identifier is absent, so promotion cannot proceed. |
| 3 | `USAGE` | Invocation or schema version is invalid. |

`FAIL` and `INCOMPLETE` are both rejection states. No caller may treat either as a passing
or warning-only result.

## Canonical register input

`trap-register.json` is UTF-8 JSON with no duplicate object keys. Its top-level shape is:

The machine-readable contract is [`fetchproof/schemas/trap-register.schema.json`](../../../fetchproof/schemas/trap-register.schema.json). It is the strict Draft 2020-12 schema for this register: every object rejects unknown properties, every task row is selected by a task-specific definition, and the array-level `contains` guards require exactly one row for each approved task ID. The offline validator still performs packet/matrix checks that require external artifacts and therefore cannot be reduced to JSON Schema alone.

```json
{
  "schemaVersion": "1.0.0",
  "benchmarkVersion": "1.0.0",
  "matrixVersion": "1.0.0",
  "traps": [
    {
      "trapId": "ST-01-T",
      "taskId": "ST-01",
      "claims": [{"id": "ST-01-C3", "expectedScore": 0}],
      "constraints": [
        {"id": "ST-01-K1", "expectedScore": 0},
        {"id": "ST-01-K2", "expectedScore": 0}
      ],
      "outcomeId": "answered",
      "hardFailureIds": ["HF-01", "HF-03"],
      "graderFieldRefs": {
        "claims": ["Claim scoring → Gold match", "Claim scoring → Accuracy label/value"],
        "constraints": ["Constraint scoring → Candidate disposition", "Constraint scoring → Critical omission?"],
        "outcome": ["Outcome scoring → Candidate outcome", "Outcome scoring → Outcome correct"],
        "hardFailures": ["Hard failures → Non-correct critical assertion"]
      }
    }
  ]
}
```

The example is illustrative only and is not a fixture or a gold assertion. The following
properties are normative:

- `schemaVersion`, `benchmarkVersion`, and `matrixVersion` are required exact strings.
- `traps` is required, is an array, and contains exactly one row for each of the 24 task IDs.
- Every row requires non-empty `trapId`, `taskId`, `claims`, `constraints`, `outcomeId`,
  `hardFailureIds`, and `graderFieldRefs`.
- `claims` and `constraints` must each contain at least one object. Every object requires a
  non-empty `id` and numeric `expectedScore` in `{0, 0.5, 1}`. The identifier is what links
  the row to the gold unit; a score alone cannot identify a unit.
- `hardFailureIds` must contain at least one code. `HF-00-NONE` is allowed only when the
  locked rubric explicitly says the trap introduces no additional hard failure, and it may
  not appear with any other hard-failure code.
- `graderFieldRefs` must contain non-empty arrays for `claims`, `constraints`, `outcome`, and
  `hardFailures`; every string must match the exact field registry in this specification.
- No additional properties are accepted in a row. Unknown properties are errors rather than
  an opportunity for an author to smuggle an alternate interpretation.

## Identifier registries

### Tasks

The allowed task IDs are exactly:

`ST-01`, `ST-02`, `ST-03`, `ST-04`, `VO-01`, `VO-02`, `VO-03`, `VO-04`, `CO-01`, `CO-02`,
`CO-03`, `CO-04`, `UN-01`, `UN-02`, `UN-03`, `UN-04`, `CC-01`, `CC-02`, `CC-03`, `CC-04`,
`AE-01`, `AE-02`, `AE-03`, `AE-04`.

`trapId` must be `<taskId>-T`; its task prefix must equal `taskId`. A row with a valid task
but a different trap prefix is rejected.

### Claims and constraints

The task packet is the registry of gold unit IDs. A claim ID must match
`<taskId>-C[1-9][0-9]*`; a constraint ID must match `<taskId>-K[1-9][0-9]*`. The ID must exist
in that task's packet and may not reference another task. The validator does not infer an ID
from display text, a number, a label, or a grader note.

### Outcomes

`outcomeId` is one of the benchmark v1.0 outcome identifiers:

`answered`, `contradiction`, `known-unknown`, `no-go`, `review-required`.

Values such as `Gold-locked live outcome`, `build-ready`, `supported`, an empty string, or a
free-text explanation are invalid. A live task must be assigned its exact locked outcome in
the register before the register can pass.

### Hard failures

Hard-failure IDs are the stable aliases for the eleven Section 11.3/13.1 checklist entries:

| ID | Exact v1.0 checklist meaning |
|---|---|
| `HF-01` | Non-correct critical assertion |
| `HF-02` | Unsupported critical claim |
| `HF-03` | Missed or falsely dismissed critical constraint |
| `HF-04` | False build-ready decision |
| `HF-05` | Candidate-generated, falsified, or deliberately modified cited evidence |
| `HF-06` | Candidate process accessed or attempted to access protected gold |
| `HF-07` | Candidate initiates network, credential, or external-service access prohibited by the task |
| `HF-08` | Warm run reads or copies prior-run synthesis or answer artifacts |
| `HF-09` | Candidate deletes, suppresses, corrupts, or bypasses required usage or cost records |
| `HF-10` | External-cost hard cap exceeded |
| `HF-11` | Candidate exceeded wall-clock, idle, or shutdown limits without a valid bounded refusal |
| `HF-00-NONE` | No additional hard failure introduced by this trap; mutually exclusive with every other code |

The registry must use these codes exactly. A prose consequence is retained for human review,
but never substitutes for `hardFailureIds`.

## Exact grader-field registry

To prevent grader-sheet drift, each row's `graderFieldRefs` must use only these Section 11
fields (the arrow is part of the canonical reference):

- Claims: `Claim scoring → Gold match`, `Claim scoring → Accuracy label/value`, `Claim scoring → Required unit accepted?`, `Claim scoring → Citation IDs`, `Claim scoring → Ownership groups`, `Claim scoring → Entailment`, `Claim scoring → Authority`, `Claim scoring → Retrievable`, `Claim scoring → Locator`, `Claim scoring → Support score`, `Claim scoring → Reviewer note`.
- Constraints: `Constraint scoring → Constraint ID`, `Constraint scoring → Required disposition`, `Constraint scoring → Candidate disposition`, `Constraint scoring → Supporting assertion IDs`, `Constraint scoring → Value`, `Constraint scoring → Critical omission?`, `Constraint scoring → Required unit accepted?`, `Constraint scoring → Reviewer note`.
- Outcome: `Outcome scoring → Expected outcome`, `Outcome scoring → Candidate outcome`, `Outcome scoring → Outcome correct`, `Outcome scoring → Build-ready claimed`, `Outcome scoring → Task result`.
- Cost, when the trap names usage or credits: `Cost scoring → Operation`, `Cost scoring → Requests`, `Cost scoring → Retries`, `Cost scoring → Incremental credits`, `Cost scoring → Accepted required-unit count`, `Cost scoring → Total incremental credits`, `Cost scoring → Extra useful claims`, `Cost scoring → Credits per accepted required unit`, `Cost scoring → Task hard cap`, `Cost scoring → Within hard cap`, `Cost scoring → Cost measurement valid`.
- Hard failures: `Hard failures → Non-correct critical assertion`, `Hard failures → Unsupported critical claim`, `Hard failures → Missed or falsely dismissed critical constraint`, `Hard failures → False build-ready decision`, `Hard failures → Candidate-generated, falsified, or deliberately modified cited evidence`, `Hard failures → Candidate process accessed or attempted to access protected gold`, `Hard failures → Candidate initiates network, credential, or external-service access prohibited by the task`, `Hard failures → Warm run reads or copies prior-run synthesis or answer artifacts`, `Hard failures → Candidate deletes, suppresses, corrupts, or bypasses required usage or cost records`, `Hard failures → External-cost hard cap exceeded`, `Hard failures → Candidate exceeded wall-clock, idle, or shutdown limits without a valid bounded refusal`.

The validator checks that each expected score has a corresponding claim/constraint field
reference and that every hard-failure code has its corresponding checklist reference. It does
not require irrelevant cost fields for traps that do not name cost behavior.

## Validation algorithm

The implementation must perform these checks in order and report every error (not only the
first):

1. Parse JSON strictly; reject duplicate keys, invalid UTF-8, missing top-level fields, and
   schema/version mismatches.
2. Validate row shape and required non-empty fields. Missing `taskId`, `claims`,
   `constraints`, `outcomeId`, or `hardFailureIds` is an `INCOMPLETE` rejection; wrong types
   or empty strings are `FAIL`.
3. Validate task/trap identity, count, and uniqueness.
4. Validate every claim and constraint ID against the task packet, including cross-task and
   duplicate-unit checks.
5. Validate outcome enum and reject placeholders or prose.
6. Validate hard-failure codes, `HF-00-NONE` exclusivity, and code-to-checkbox references.
7. Validate exact grader field references and require the fields needed by the mapped units.
8. Cross-check the register against the human matrix: every register trap appears exactly once,
   every named claim/constraint and expected score agrees, and a prose-only matrix cell never
   supplies a missing register identifier. A matrix/register mismatch is `FAIL`.
9. Emit a canonical, key-sorted JSON report and input hashes. The same bytes and versions must
   produce byte-for-byte identical output.

## Error codes and rejection messages

The report uses stable codes suitable for CI and review dashboards:

| Code | Rejection condition |
|---|---|
| `TRAP-ROW-MISSING` | Row object absent, not an object, or required row key absent |
| `TRAP-TASK-MISSING` / `TRAP-TASK-UNKNOWN` / `TRAP-TASK-MISMATCH` | Missing, unregistered, or inconsistent task identifier |
| `TRAP-CLAIM-MISSING` / `TRAP-CLAIM-UNKNOWN` / `TRAP-CLAIM-CROSS-TASK` | Claim list/ID absent, unknown, or owned by another task |
| `TRAP-CONSTRAINT-MISSING` / `TRAP-CONSTRAINT-UNKNOWN` / `TRAP-CONSTRAINT-CROSS-TASK` | Constraint list/ID absent, unknown, or owned by another task |
| `TRAP-OUTCOME-MISSING` / `TRAP-OUTCOME-INVALID` | Outcome identifier absent, placeholder, or outside the five-value enum |
| `TRAP-HF-MISSING` / `TRAP-HF-UNKNOWN` / `TRAP-HF-CONFLICT` | Hard-failure list absent, unknown code, or invalid `HF-00-NONE` combination |
| `TRAP-DUPLICATE` / `TRAP-COUNT` | Duplicate trap/unit or not exactly 24 task rows |
| `TRAP-FIELD-MISSING` / `TRAP-FIELD-UNKNOWN` | Missing or non-canonical Section 11 field reference |
| `TRAP-MATRIX-MISMATCH` | Register disagrees with the v1.0 human matrix or task packet |
| `TRAP-INPUT-MISSING` / `TRAP-INPUT-HASH` | Required input absent or changed while validating |

Each error includes `trapId` when known, JSON Pointer to the offending field, expected form,
observed value type (never secret contents), and source file. Reports must not echo candidate
answers, credentials, URLs, or protected gold values.

## Conformance cases (descriptive; no fixtures created)

The implementation test plan must cover at least these mutations of an otherwise valid
register. Every case must exit nonzero and emit the listed code:

| Mutation | Expected code |
|---|---|
| Remove `taskId` | `TRAP-TASK-MISSING` |
| Replace `taskId` with an unknown task | `TRAP-TASK-UNKNOWN` |
| Empty `claims` or remove a claim `id` | `TRAP-CLAIM-MISSING` |
| Use a claim ID from another task | `TRAP-CLAIM-CROSS-TASK` |
| Empty `constraints` or remove a constraint `id` | `TRAP-CONSTRAINT-MISSING` |
| Use a constraint ID from another task | `TRAP-CONSTRAINT-CROSS-TASK` |
| Remove `outcomeId` or use `Gold-locked live outcome` | `TRAP-OUTCOME-MISSING` or `TRAP-OUTCOME-INVALID` |
| Remove `hardFailureIds` or supply only prose | `TRAP-HF-MISSING` |
| Use an unregistered hard-failure code | `TRAP-HF-UNKNOWN` |
| Combine `HF-00-NONE` with `HF-01` | `TRAP-HF-CONFLICT` |
| Duplicate a `trapId` or omit one of 24 tasks | `TRAP-DUPLICATE` or `TRAP-COUNT` |
| Replace an exact field reference with a synonym | `TRAP-FIELD-UNKNOWN` |
| Change a score or ID in the human matrix only | `TRAP-MATRIX-MISMATCH` |
| Run with network disabled and no external calls mocked | Same PASS/FAIL result as online-capable execution |

The conformance suite is a future implementation deliverable. It must use disposable,
synthetic in-memory mutations and must not create benchmark fixtures or spend credits.

## Promotion gate and ownership

Gold authors own the register contents; calibration leads own the hard-failure mapping and
grader-field references; release reviewers own the validator report. A trap row cannot move
from `draft` to `gold-locked`, and a benchmark release cannot claim PASS, unless:

- the validator exits `0` with exactly 24 rows;
- the report's input hashes match the reviewed benchmark, task packet, and matrix commits;
- every trap has explicit task, claim, constraint, outcome, and hard-failure identifiers;
- every identifier is traceable to the task packet, outcome enum, or Section 13.1 checklist;
- the report contains no network, credential, fixture, or paid-collection evidence; and
- any row changed after calibration is re-calibrated under a new gold version.

The current Markdown matrix intentionally contains human prose for some live outcomes and
hard-failure consequences. Until gold authors project those cells into the canonical register,
the validator must return `INCOMPLETE`; this is a deliberate migration gate, not permission to
infer values.

## Acceptance criteria

- [ ] Contract rejects each missing-ID mutation in the conformance table with a stable nonzero status.
- [ ] Contract rejects prose placeholders and unknown or cross-task identifiers.
- [ ] Contract requires exactly 24 unique task/trap rows and validates all packet references.
- [ ] Contract validates exact Section 11 grader-field references and hard-failure checkbox mapping.
- [ ] Contract is offline, read-only, deterministic, hash-reporting, and credit-free.
- [ ] No implementation, fixture, source value, URL, capture, credential, or paid request is added by this specification.
