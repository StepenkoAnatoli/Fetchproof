# FI Validator Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an offline, read-only FI validator that checks workbook projection, FI sidecar/manifest references, evidence bytes, and status precedence.

**Architecture:** `fetchproof/lib/fi-validator.mjs` owns parsing, projection and semantic checks. `fetchproof/bin/researcher-release.mjs` exposes it as `fi-validate`; it only reads named inputs and emits a deterministic report. Existing schema checking and canonical hashing remain in `release-validator.mjs`.

**Tech Stack:** Node.js standard library, existing release validator helpers, XLSX ZIP/XML reader, existing test harness.

**Spec:** `docs/superpowers/specs/2026-09-16-researcher-fi-signoff-offline-validator.md`

## Global Constraints

- The validator opens only explicit inputs and manifest-contained paths under `--root`.
- It performs no network, credential, fixture, ledger, pointer, or workbook mutation.
- It emits stable ordered JSON, and only writes the optional report path.
- Status precedence is `REOPEN > FAIL > BLOCKED > ROLLED-BACK > INCOMPLETE > PASS`.

---

### Task 1: FI sidecar/manifest semantic validator

**Files:**
- Create: `fetchproof/lib/fi-validator.mjs`
- Test: `fetchproof/test/fi-validator-adapter.test.mjs`

**Interfaces:**
- Consumes: an exact workbook byte hash, parsed FI sidecars, one evidence manifest, an evidence root.
- Produces: `validateFiBundle(options) -> { status, errors, cases, summary }`.

- [ ] **Step 1: Write failing tests** for a valid sidecar/manifest, an unresolved evidence ID, a mismatched evidence byte hash, and a precedence downgrade.
- [ ] **Step 2: Run** `node fetchproof/test/fi-validator-adapter.test.mjs` and confirm it fails because `fi-validator.mjs` is absent.
- [ ] **Step 3: Implement** schema validation, cross-reference ownership, root-contained byte hashing, and precedence reduction.
- [ ] **Step 4: Run** `node fetchproof/test/fi-validator-adapter.test.mjs` and confirm all new cases pass.

### Task 2: Read-only XLSX projection and command adapter

**Files:**
- Modify: `fetchproof/lib/fi-validator.mjs`
- Modify: `fetchproof/bin/researcher-release.mjs`
- Test: `fetchproof/test/fi-validator-adapter.test.mjs`

**Interfaces:**
- Consumes: `.xlsx` workbook and `fi-validate` CLI arguments.
- Produces: 30 case projections and deterministic CLI report/exit status.

- [ ] **Step 1: Write failing tests** for Index/case status mismatch, missing required FI sheet, and deterministic JSON command output.
- [ ] **Step 2: Run** the adapter test and confirm these fail before projection/CLI support exists.
- [ ] **Step 3: Implement** safe ZIP/XML workbook extraction, Index-to-case status comparison, and `fi-validate` argument handling.
- [ ] **Step 4: Run** the adapter test and confirm all cases pass.

### Task 3: Regression verification and architecture record

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Test: `fetchproof/test/fi-validator-conformance.test.mjs`, `fetchproof/test/fi-signoff-schema.test.mjs`, `fetchproof/test/fi-validator-adapter.test.mjs`

- [ ] **Step 1: Run** all FI schema/conformance/adapter tests.
- [ ] **Step 2: Run** the command with a deliberately incomplete public workbook bundle and confirm no files outside the requested report path change.
- [ ] **Step 3: Record** the new read-only validator seam in the architecture map.
- [ ] **Step 4: Re-run** the focused suite after the documentation change.
