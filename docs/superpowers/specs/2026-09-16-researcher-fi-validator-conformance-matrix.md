# FI validator fixture-free conformance matrix

**Status:** executable conformance contract; no benchmark fixtures
**Validator contract:** [`2026-09-16-researcher-fi-signoff-offline-validator.md`](2026-09-16-researcher-fi-signoff-offline-validator.md)
**Executable matrix:** [`fetchproof/test/fi-validator-conformance.test.mjs`](../../../fetchproof/test/fi-validator-conformance.test.mjs)

## Purpose and isolation

This matrix expands the validator contract's conformance table into deterministic, in-memory
mutations. It creates no checked-in fixture, source capture, workbook, credential, network call,
or paid request. Every mutation starts from a synthetic valid bundle, is applied twice, and must
produce the same result. Schema-backed mutations run against the shipped strict FI sidecar and
evidence-manifest schemas. Workbook, byte, containment, role, signature, predecessor, and report
rows retain their required semantic error code for the eventual full validator adapter.

Run it from the repository root:

```text
node --input-type=module -e "import('./fetchproof/test/fi-validator-conformance.test.mjs').then(async()=>{const {runPending}=await import('./fetchproof/test/harness.mjs'); const n=await runPending('fi-validator-conformance.test.mjs'); process.exit(n?1:0);})"
```

The repository self-test also discovers the matrix automatically:

```text
node fetchproof/bin/selftest.mjs
```

## Case matrix

| ID | Synthetic mutation | Required code | Effective result | Execution scope |
|---|---|---|---|---|
| CF-01 | Remove `FI-17` sheet | `WB-SHEET-ID` | `FAIL` | semantic workbook projection |
| CF-02 | Rename or duplicate an FI sheet | `WB-SHEET-ID` | `FAIL` | semantic workbook projection |
| CF-03 | Hide a case sheet or add a macro/external link | `WB-PACKAGE-UNTRUSTED` | `FAIL` | semantic package trust |
| CF-04 | Change a matrix repair package in one sheet | `FI-TRACEABILITY-MISMATCH` | `FAIL` | semantic matrix projection |
| CF-05 | Change the expected-safe-handling sentence | `FI-EXPECTED-MISMATCH` | `FAIL` | semantic packet projection |
| CF-06 | Change the Index status only | `FI-INDEX-MISMATCH` | `FAIL` | semantic workbook projection |
| CF-07 | Remove an identity or evidence entry | `FI-FIELD-MISSING` | `INCOMPLETE` | sidecar schema + semantic completeness |
| CF-08 | Replace a status with `done` or lowercase `pass` | `STATUS-INVALID` | `FAIL` | sidecar schema + semantic status |
| CF-09 | Mark `PASS` while one evidence ID is absent | `EVIDENCE-MISSING` | `INCOMPLETE` | sidecar schema + manifest resolution |
| CF-10 | Use uppercase, shortened, or algorithm-prefixed SHA-256 | `HASH-FORMAT` | `FAIL` | sidecar schema |
| CF-11 | Alter a manifest-named evidence byte | `EVIDENCE-HASH` | `FAIL` | semantic byte/hash check |
| CF-12 | Add traversal, absolute, UNC, or symlink-escaping evidence path | `EVIDENCE-PATH` | `FAIL` | manifest schema + root containment |
| CF-13 | Remove a network/credential/credit/fixture proof | `CONTAINMENT-MISSING` | `INCOMPLETE` | semantic containment completeness |
| CF-14 | Record a prohibited paid request or credential read | `CONTAINMENT-VIOLATION` | `FAIL` | semantic containment violation |
| CF-15 | Change a sidecar entry hash or status without changing the workbook | `FI-PROJECTION-MISMATCH` | `FAIL` | semantic sidecar/workbook projection |
| CF-16 | Copy the reviewer signature to the verifier or use an expired key | `ROLE-COLLISION` | `FAIL` | semantic role/signature authorization |
| CF-17 | Mark `ROLLED-BACK` without a valid target/receipt/closure | `ROLLBACK-EVIDENCE` | `BLOCKED` | sidecar schema + rollback semantics |
| CF-18 | Reopen a locked predecessor while leaving this case `PASS` | `STATUS-PRECEDENCE` | `FAIL` | semantic predecessor closure |
| CF-19 | Replace the registered outcome code with prose | `OUTCOME-INVALID` | `FAIL` | sidecar schema + outcome registry |
| CF-20 | Validate the same bundle twice with the same `--at` time | `BYTE-IDENTICAL` | `PASS` | deterministic report contract |

`CF-20` is the sole non-rejection case: it proves byte-identical output and hash stability. All
other rows must reject or block promotion with the listed code; a schema pass alone never
overrides the semantic validator gate.

## Review assertions

- The matrix has exactly 20 unique case IDs and no undocumented mutation.
- Every row declares a required code, effective result, deterministic in-memory mutation, and
  executable probe.
- Schema-backed rows fail against the checked-in schemas for the expected strict-schema reason.
- All mutations are applied to cloned in-memory objects; no filesystem fixture is written.
- The full offline self-test must finish with `all tests passed` before the validator is promoted.
