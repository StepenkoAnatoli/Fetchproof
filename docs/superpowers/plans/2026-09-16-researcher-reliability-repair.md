# Researcher Reliability Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore trustworthy Windows collection, protect durable research state, make enforcement evaluate the state it claims to evaluate, and qualify the researcher against the approved benchmark without data loss or false readiness.

**Architecture:** Keep the dependency-free Node.js CLI and existing module boundaries, but split the repair into independently revertable packages. A versioned compatibility layer precedes every persisted-format change; one writer owns durable collection; readiness is a state machine; release qualification is a sequence of separately revertable packages that consume benchmark specification v1.0 as their normative contract rather than inventing a smaller rubric.

**Tech Stack:** Node.js 24 ESM, the repository custom asynchronous test harness, Git 2.55 hooks, Markdown/JSON/JSONL artifacts, Firecrawl CLI transport, and the dependency-free HTTP transport.

**Spec:** `docs/researcher-review-2026-09-16.md`; benchmark contract: `docs/superpowers/specs/2026-09-16-researcher-benchmark-design.md` v1.0.0.

## Normative benchmark dependency

`docs/superpowers/specs/2026-09-16-researcher-benchmark-design.md` v1.0.0 is the sole normative contract for benchmark schema, task/run/track/release hierarchy, outcomes, hard-failure and invalid-environment precedence, cold/warm rules, scoring formulas, cost accounting, calibration agreement, and release thresholds. The task outlines, gold-authoring packet, and expanded task/calibration packets are authoring inputs subordinate to that contract; they cannot relax or replace it.

- R28 must pin the approved specification version and SHA-256 in the harness manifest. A missing human approval or version/hash mismatch blocks qualification.
- R29 must pin the same version/hash in every task, gold, calibration, and warm-manifest record. It may fill source-dependent values but may not alter scoring, thresholds, or outcome vocabulary.
- `docs/superpowers/specs/2026-09-16-researcher-benchmark-migration-rollback-gates.md` is normative for benchmark-artifact migration, hash-closed predecessor checks, descendant-pointer invalidation, and R28-R33 rollback evidence.
- `docs/superpowers/specs/2026-09-16-researcher-benchmark-v1-release-gate-evidence-matrix.md` is the reviewer-facing crosswalk for Q0-Q5 evidence, accountable owners, independent verifiers, and failure statuses.
- `docs/superpowers/specs/2026-09-16-researcher-v3-schema-drift-policy.md` governs automatic future-schema detection and blocks any v3 migration until its ADR, matrix update, and rollback proof are approved.
- R30–R33 consume only sealed artifacts carrying that version/hash. A superseding benchmark specification pauses the chain, requires a new plan/ADR, and invalidates derived qualification reports without rewriting prior run records.
- Any plan text that appears to add a benchmark threshold is interpreted as an execution check required by v1.0, not as an alternative gate. If the wording cannot be reconciled, execution stops at the affected package.

## Global Constraints

- Preserve the collector/builder role split; builders never collect.
- URLs, queries, output paths, and fixture data remain argv/data, never shell source.
- Do not add runtime dependencies without an ADR showing why the dependency-free design is unsafe.
- Automated tests use disposable machine roots, Git config, runtime settings, credentials, network stubs, and paid-credit-free adapters.
- Live Firecrawl smoke is a separate operator-authorized check with a declared cap.
- Research repair remains possible while a gate fails; product handoff remains blocked until review is complete.
- Existing evidence is immutable history; refresh/supersession never silently changes an evidence ID’s meaning.
- Every package touching a declared code path updates `docs/ARCHITECTURE.md`; changed decisions get a superseding ADR.
- One package equals one independently revertable commit. A package cannot require a later package to remain safe.
- Release qualification packages publish append-only derived records; reverting one removes only its derived status/report and never edits or deletes earlier candidate runs, gold, source captures, or calibration evidence.
- Revoking or reopening any promotion pointer transitively revokes every descendant pointer whose predecessor closure includes that pointer; retained evidence is never silently re-promoted.
- Every package checkpoint report names: what changed, why, what it touched, what was verified, and what was gotten wrong and fixed (or “nothing to report”).
- The current folder has no `.git`; commit commands below are named checkpoints until a real checkout exists.
- Every failure report records cwd `C:\Users\PC\Desktop\FreeBuff\Deep-Research-Agent-main`.

## Package lifecycle and migration gates

Each package follows the same five-step test cycle: write a failing regression, run the focused test and record the failure, implement only the package contract, run the focused test plus `node fetchproof/bin/selftest.mjs`, then update the architecture map/ADR and create the package checkpoint. No package is marked complete on a green test alone.

Persisted artifacts use `artifactSchema` fields and the following compatibility policy:

| Artifact family | Current owner | Migration rule |
|---|---|---|
| Discovery, map, evidence, sources, brief | `corpus.mjs`, `brief.mjs` | Read legacy headers/markers; write canonical v2; refuse unknown future schemas |
| Raw capture front matter and usage log | transport/collection seam | Preserve old fields; require named transport, operation, completeness, and omission metadata for v2 |
| Fetch ledger | `provenance.mjs` | Never rewrite an intact prefix; only a verified truncated tail may be repaired |
| Audit and audit index | `audit.mjs`/`archive.mjs` | Immutable versioned files plus an atomic current pointer/index |
| Machine config/install state | `machine.mjs`/`installer.mjs` | Read legacy keys, validate enums, write v2 with an authenticated last-good snapshot |
| Claim/review/readiness records | semantic seam | Introduced only after the v2 claim schema is frozen and legacy rows have a read-only adapter |

Every migration gate must: snapshot all bytes and hashes; prove read-old/write-new; prove idempotence; test unknown/future schema refusal; test interruption at each write boundary; verify rollback from the snapshot; and record the migration version. A gate fails if any legacy artifact is silently dropped, reinterpreted, or marked approved without review.

## Dependency graph and release gates

| Gate | Required packages | Exit condition |
|---|---|---|
| G0 — trusted execution | R1–R5 | Isolated tests and Windows search/map/scrape reach stubs; transport results are honest; no external mutation |
| G1 — durable-state migration | R6–R15 | Legacy corpus/config migrates losslessly; briefs/audits/writes are recoverable and contained |
| G2 — enforcement | R16–R19 | Staged bytes/paths are exact; hooks preserve unrelated settings; recovery is non-destructive |
| G3 — semantic readiness | R20–R25 | Claim/review schema is migrated; freshness, supersession, budgets, and readiness states agree |
| G4 — release qualification | R26–R33 | Deployment identity, offline flow, benchmark v1.0, frozen cold/warm qualification, and explicitly authorized live smoke agree |

No later gate compensates for an earlier failure. Safe parallelism is listed per wave; shared files make otherwise independent logic serial.

## Wave 0 — Trusted execution

### Task R1: Disposable machine and Git containment

**Findings:** F02.  
**Files:**
- Create: `fetchproof/test/machine-fixture.mjs` (disposable machine/Git environment factory)
- Create: `fetchproof/test/machine-fixture.test.mjs` (factory contract and containment tests)
- Modify: `fetchproof/test/install.test.mjs`, `fetchproof/test/install-hooks.test.mjs`, `fetchproof/test/machine.test.mjs`, `fetchproof/test/hooks.test.mjs` (consume the factory; remove ad-hoc host-dependent setup)
- Modify: `fetchproof/lib/machine.mjs`, `fetchproof/lib/installer.mjs`, `fetchproof/bin/install-hooks.mjs` (only the minimum path/config injection required by the failing tests)
- Modify: `docs/ARCHITECTURE.md` (R1 seam and ownership row)

**Consumes:** the existing `fetchproof/test/harness.mjs` (`test`, `assert`, `assertEqual`, `cleanup`, `KIT`) and the public machine/installer APIs. **Produces:** `machineFixture(options)` and `gitFixture(options)` test interfaces; no production API is broadened unless a failing containment test proves it is required.

**Precedence contract:** path and Git-origin authority is normative in [`docs/superpowers/specs/2026-09-16-researcher-path-precedence.md`](../specs/2026-09-16-researcher-path-precedence.md), with focused executable coverage in `fetchproof/test/path-precedence.test.mjs`. R1 must preserve these rules while adding containment fixtures.

**Artifact validator contract:** every R28–R32 envelope, predecessor closure, role assignment, and promotion pointer is checked by the normative [`docs/superpowers/specs/2026-09-16-researcher-r28-r32-machine-validators.md`](../specs/2026-09-16-researcher-r28-r32-machine-validators.md). Package promotion is invalid unless the validator reports `PASS` for the complete closure.

**Qualification ledger contract:** append, crash recovery, pointer publication, tamper evidence, and descendant revocation follow the normative [`docs/superpowers/specs/2026-09-16-researcher-benchmark-qualification-ledger.md`](../specs/2026-09-16-researcher-benchmark-qualification-ledger.md). The ledger is the history; package pointers are authenticated projections only.

**Interfaces to freeze before implementation:**

```js
machineFixture({ role = 'collector', projectMarkers = true } = {})
// -> {
//   root, projectRoot, home, userProfile, homeDrive, homePath,
//   agentsDir, kitHome, configPath, statePath, settingsPath,
//   globalGitConfig, systemGitConfig, outsideRoot, env,
//   snapshot(), assertContained(path), cleanup(), cleanupOutside()
// }

gitFixture(machine, { localHooksPath = '', globalHooksPath = '' } = {})
// -> { repoRoot, localConfig, before, after, runGit(args, options = {}),
//      originSnapshot(options), writeSnapshotSet(directory, options), cleanup() }
```

`env()` returns a fresh child-process environment on every call. It sets `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `FETCHPROOF_HOME`, `FETCHPROOF_CONFIG`, `FETCHPROOF_INSTALL_STATE`, `FETCHPROOF_EDIT_GATE_SETTINGS`, `GIT_CONFIG_GLOBAL`, and `GIT_CONFIG_NOSYSTEM=1`; it does not inherit any host value for those keys. `assertContained()` resolves the candidate path and fails if it is outside `root`, if it traverses through a symlink, or if it is an absolute path unrelated to the fixture. `snapshot()` records sorted relative paths and SHA-256 bytes for the fixture plus the external sentinel; it never snapshots or enumerates the operator's home directory. `cleanup()` removes only `root`; `cleanupOutside()` removes the sibling sentinel directory after the sentinel assertion has run.

`writeSnapshotSet(directory, options)` is the deterministic evidence seam: it writes
`before.json`, `after.json`, and `recovery.json` below the disposable fixture only, with
fixed default IDs/timestamp/principals, validates each envelope against the snapshot
schema before writing, and refuses an outside-root destination. The recovery envelope
records `containment.recovery_result: PASS`; all three envelopes explicitly record
`host_state_touched: false` and retain the external-sentinel hash.

#### Test-first sequence

- [ ] **Step 1: Write the fixture contract tests before changing production code.** Add `fetchproof/test/machine-fixture.test.mjs` with these named tests:

```js
import fs from 'node:fs';
import nodeAssert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, assert, assertEqual, KIT } from './harness.mjs';
import { installGitHooks } from '../lib/installer.mjs';
import { gitFixture, machineFixture } from './machine-fixture.mjs';

test('machineFixture assigns every machine path below one disposable root', () => {
  const machine = machineFixture();
  for (const value of [machine.home, machine.userProfile, machine.agentsDir,
    machine.kitHome, machine.configPath, machine.statePath, machine.settingsPath,
    machine.globalGitConfig, machine.systemGitConfig, machine.projectRoot]) {
    machine.assertContained(value);
  }
});

test('machineFixture replaces all profile and Git environment authorities', () => {
  const machine = machineFixture();
  const env = machine.env();
  assertEqual(env.HOME, machine.home);
  assertEqual(env.USERPROFILE, machine.userProfile);
  assertEqual(env.GIT_CONFIG_GLOBAL, machine.globalGitConfig);
  assertEqual(env.GIT_CONFIG_NOSYSTEM, '1');
  assert(!env.FETCHPROOF_CONFIG.includes(os.homedir()), 'real config path leaked');
});

test('hostile absolute and traversal paths are rejected before any write', () => {
  const machine = machineFixture();
  const before = machine.snapshot();
  nodeAssert.throws(() => machine.assertContained('C:\\Users\\Real User\\.gitconfig'));
  nodeAssert.throws(() => machine.assertContained(path.join(machine.root, '..', 'escape')));
  nodeAssert.deepEqual(machine.snapshot(), before);
});

test('a symlink that resolves outside the fixture is rejected', () => {
  const machine = machineFixture();
  const link = path.join(machine.root, 'project-link');
  fs.symlinkSync(machine.outsideRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  nodeAssert.throws(() => machine.assertContained(path.join(link, 'sentinel')));
});

test('machine cleanup removes the disposable root and leaves the outside sentinel', () => {
  const machine = machineFixture();
  const sentinel = fs.readFileSync(path.join(machine.outsideRoot, 'sentinel'), 'utf8');
  machine.cleanup();
  assert(!fs.existsSync(machine.root));
  assertEqual(fs.readFileSync(path.join(machine.outsideRoot, 'sentinel'), 'utf8'), sentinel);
  machine.cleanupOutside();
});
```

Use Node's `node:assert/strict` for exception and deep-snapshot assertions; do not add a swallowing wrapper to the shared harness.

Every test that creates a machine uses this exact teardown shape, including when an assertion or child process fails:

```js
const machine = machineFixture();
try {
  // assertions and the operation under test
} finally {
  machine.cleanup();
  machine.cleanupOutside();
}
```

The five named tests below must apply this wrapper; the snippets show their assertions, not an exemption from teardown.

- [ ] **Step 2: Run the suite and record the expected red from the new fixture tests.**

Run: `node fetchproof/bin/selftest.mjs`  
Expected: FAIL in the `machine-fixture.test.mjs` section because `machineFixture`, `gitFixture`, or the containment assertion is not defined. The failure report includes cwd `C:\Users\PC\Desktop\FreeBuff\Deep-Research-Agent-main` and names the first missing interface; it must not create a file under the real profile.

- [ ] **Step 3: Implement the disposable factory with explicit roots.** Create `fetchproof/test/machine-fixture.mjs` using `fs.mkdtempSync(path.join(os.tmpdir(), 'fetchproof-machine-'))`. Derive every path from `root`; create `projectRoot` with `AGENTS.md` and a minimal `research/` only when `projectMarkers` is true. Create `outsideRoot` as a sibling temporary directory containing a sentinel whose bytes are fixed (`R1 outside sentinel\n`). Implement `env()` as a new object, `assertContained()` with `path.resolve` plus `fs.realpathSync` checks for existing ancestors, `snapshot()` with sorted relative paths and SHA-256, `cleanup()` that removes only `root`, and `cleanupOutside()` that removes only `outsideRoot`.

```js
export function machineFixture({ role = 'collector', projectMarkers = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchproof-machine-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchproof-outside-'));
  // Derive every returned path from root. Create only the fixed sentinel in outsideRoot.
  // Return env(), assertContained(), snapshot(), cleanup(), and cleanupOutside().
}
```

- [ ] **Step 4: Re-run the fixture tests and require green before integrating callers.**

Run: `node fetchproof/bin/selftest.mjs`  
Expected: PASS for all five fixture tests, with no path outside the two temporary directories changed. Run it twice; the second run must use a different root and produce the same assertions.

- [ ] **Step 5: Add Git global/system containment tests.** Extend `machine-fixture.test.mjs` with these cases:

```js
const runInstallWithEnv = (machine, args) => {
  const result = spawnSync(
    process.execPath,
    [path.join(KIT, 'bin', 'install.mjs'), ...args],
    { encoding: 'utf8', env: machine.env() },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const statusName = result.status === 0 ? 'NO-OP' : /blocked|refus|outside|rollback/i.test(output) ? 'BLOCKED' : 'ROLLED-BACK';
  return { ...result, output, statusName };
};

test('gitFixture makes global hooksPath writes land only in fixture config', () => {
  const machine = machineFixture();
  const git = gitFixture(machine, { globalHooksPath: path.join(machine.kitHome, 'githooks') });
  const result = installGitHooks({
    kitDir: machine.kitHome,
    gitConfigPath: machine.globalGitConfig,
    statePath: machine.statePath,
    dryRun: false,
  });
  assertEqual(result.after, path.join(machine.kitHome, 'githooks').replaceAll(path.sep, '/'));
  assertEqual(git.runGit(['config', '--global', '--get', 'core.hooksPath']).trim(), result.after);
  assert(git.runGit(['config', '--global', '--show-origin', '--get', 'core.hooksPath']).includes(machine.globalGitConfig));
  assertEqual(git.runGit(['config', '--system', '--get', 'core.hooksPath'], { env: machine.env() }), '');
  machine.assertContained(machine.globalGitConfig);
  machine.assertContained(machine.statePath);
});

test('repository-local hooksPath is visible as an override and is never overwritten', () => {
  const machine = machineFixture();
  const git = gitFixture(machine, { localHooksPath: path.join(machine.outsideRoot, 'other-hooks') });
  const before = git.runGit(['config', '--local', '--get', 'core.hooksPath']).trim();
  installGitHooks({ kitDir: machine.kitHome, gitConfigPath: machine.globalGitConfig, statePath: machine.statePath, dryRun: false });
  assertEqual(git.runGit(['config', '--local', '--get', 'core.hooksPath']).trim(), before);
  assertEqual(git.runGit(['config', '--get', 'core.hooksPath']).trim(), before);
});

test('dry-run installer is byte-pure for config, state, settings, and sentinel', () => {
  const machine = machineFixture();
  const before = machine.snapshot();
  runInstallWithEnv(machine, ['--dry-run']);
  nodeAssert.deepEqual(machine.snapshot(), before);
});
```

`gitFixture` must initialize a disposable repository with test identity, write local config only under `projectRoot/.git/config`, and expose `runGit(args, options = {})`, which always merges `machine.env()` with the supplied options and returns stdout while treating an expected missing key as an empty string. The test must inspect `git config --show-origin` and assert the global origin is `machine.globalGitConfig`; it must never call Git with the host's default environment.

- [ ] **Step 6: Run the Git containment tests to capture the pre-fix leak.**

Run: `node fetchproof/bin/selftest.mjs`  
Expected: FAIL only where an installer or Git helper still resolves the host profile/global config or overwrites repository-local `core.hooksPath`. A failure that changes the outside sentinel is a stop-the-line containment defect, not a test expectation to relax.

- [ ] **Step 7: Thread the minimum injection points through production callers.** Add optional `configPath`, `statePath`, `settingsPath`, and `gitConfigPath` parameters to the existing installer/machine call boundaries, defaulting exactly to current production paths. Ensure every child process receives the caller's environment and `GIT_CONFIG_NOSYSTEM=1` in tests. Reject path arguments that fail the fixture's containment policy before `mkdir`, `writeFile`, `git config`, or hook installation. Preserve the repository-local `core.hooksPath`; report it as an override instead of replacing it.

```js
// Production defaults remain unchanged; tests pass the disposable paths explicitly.
installGitHooks({ kitDir = KIT, gitConfigPath = undefined, statePath = undefined, dryRun = false });
installEditGate({ settingsPath = runtimePaths().settingsPath, kitDir = KIT, dryRun = false });
readMachineConfig(file = CONFIG_PATH);
```

The implementation must pass `gitConfigPath` to the existing `git` adapter, pass `env()` to every spawned CLI, and perform path validation before the first filesystem or Git write. Do not monkey-patch `os.homedir()` or mutate `process.env` globally; fixture state travels through explicit arguments and child-process environments.

- [ ] **Step 8: Migrate existing tests to one fixture and add hostile-path sentinels.** Replace `fakeHome()`/`tempEnv()` in `install.test.mjs` and `install-hooks.test.mjs` with `machineFixture()`/`gitFixture()`. Update `machine.test.mjs` to set `FETCHPROOF_CONFIG` and `FETCHPROOF_INSTALL_STATE` from `machine.env()`. Update `hooks.test.mjs` so every spawned hook receives the fixture environment and a project path containing spaces and Unicode. For each test that invokes an installer or hook, capture `before = machine.snapshot()` and assert that all differences are contained; include a hostile `C:\Users\Real User\AppData\Roaming\fetchproof` value in argv/config data and assert refusal plus byte-pure state.

- [ ] **Step 9: Run the callers and prove no host leakage.**

Run: `node fetchproof/bin/selftest.mjs`  
Expected: PASS; output names the disposable root for any failure; no test creates or modifies a host `.gitconfig`, profile settings file, real `.agents` path, or real runtime settings file. In PowerShell, repeat with `$env:FETCHPROOF_TEST_TIMEOUT='5000'; node fetchproof/bin/selftest.mjs; Remove-Item Env:FETCHPROOF_TEST_TIMEOUT`, and with a project path containing spaces and non-ASCII characters.

- [ ] **Step 10: Add interruption and cleanup fault tests.** Inject failures immediately before config write, after temporary-file write, before Git config rename, after hook deployment, and during cleanup. Each test must assert either `BLOCKED` with zero artifact mutation or `ROLLED-BACK` to the byte/hash snapshot. Add a child-process test that exits while holding a fixture lease; the next test must be able to remove the root without waiting on the child. Do not use the real machine config as the failure target.

```js
const faultPlan = Object.freeze([
  'before-config-write', 'after-temp-write', 'before-git-rename',
  'after-hook-deploy', 'during-cleanup',
]);
for (const point of faultPlan) {
  test(`R1 rollback: ${point}`, () => {
    const machine = machineFixture({ faultPoint: point });
    const before = machine.snapshot();
    const result = runInstallWithEnv(machine, ['--confirm']);
    assert(['BLOCKED', 'ROLLED-BACK'].includes(result.statusName));
    nodeAssert.deepEqual(machine.snapshot(), before);
  });
}
```

The fixture's injected failure must be deterministic and scoped to one operation; a failure that cannot prove the pre/post snapshot is not an accepted fault test.

- [ ] **Step 11: Run the full offline suite twice and inspect the path ledger.**

Run: `node fetchproof/bin/selftest.mjs` (twice, from `C:\Users\PC\Desktop\FreeBuff\Deep-Research-Agent-main`)  
Expected: both runs pass; the test output contains no network request, Firecrawl invocation, or paid operation. Compare the fixture snapshot summaries and verify every created path is below the disposable roots. Any red test stops R1 and records its cwd and first failing assertion before other work continues.

- [ ] **Step 12: Update the architecture map and checkpoint R1.** Document that `machine-fixture.mjs` owns disposable machine/Git state, that production modules accept explicit test paths without changing defaults, and that installer tests never use host configuration. If this introduces a rejected alternative (for example, process-wide monkey-patching of `os.homedir()`), record it in a dated ADR with the trigger for revisiting it. Produce the required checkpoint report naming what changed, why, touched paths/map rows/ADR, verification commands, and “nothing to report” or the concrete mistake corrected.

```powershell
git diff --check
git add fetchproof/test/machine-fixture.mjs fetchproof/test/machine-fixture.test.mjs fetchproof/test/install.test.mjs fetchproof/test/install-hooks.test.mjs fetchproof/test/machine.test.mjs fetchproof/test/hooks.test.mjs fetchproof/lib/machine.mjs fetchproof/lib/installer.mjs fetchproof/bin/install-hooks.mjs docs/ARCHITECTURE.md
git commit -m "test: contain disposable machine and git state"
```

In a real checkout, verify the new commit in a disposable clone by running `git revert --no-commit <R1-sha>` and the pre-R1 suite; the revert must remove only R1's fixture/injection behavior and leave the pre-existing tests/buildable tree intact. This repository currently has no `.git`, so these are named checkpoint commands, not commands to run in this working folder.

**R1 acceptance gate:** all focused and full offline tests pass twice; every child process receives isolated profile/config/runtime/Git variables; Git global/system/local origins are proven from fixture files; hostile absolute/traversal/symlink paths refuse before a write; dry-run and injected failures are byte-pure or restore the authenticated snapshot; cleanup removes only disposable roots; no real machine path, credential, network transport, or paid credit is touched.

### Task R2: Harness child-process cleanup

**Findings:** async timeout boundary noted in review.  
**Files:** `fetchproof/test/harness.mjs`, harness tests, `docs/ARCHITECTURE.md`.

**Consumes:** R1 fixture environment. **Produces:** timeout cancellation/child cleanup with a named `timed-out` result.

- [ ] Add a failing test where a timed-out child attempts a later write and a listener remains open.
- [ ] Run it and record leaked-process behavior.
- [ ] Implement per-case cancellation/cleanup or subprocess isolation for persistent work.
- [ ] Run harness and full selftest twice; checkpoint `R2`.

**Acceptance:** timed-out work cannot overlap later cases; no child process, listener, or fixture file survives a test run.

### Task R3: Shell-free Windows Firecrawl entrypoint

**Findings:** F01.  
**Files:** `fetchproof/lib/firecrawl.mjs`, doctor/firecrawl tests, new ADR `0022-windows-firecrawl-entrypoint.md`, architecture map.

**Consumes:** R1/R2 isolation. **Produces:** `resolveInvocation(argv)` selecting a validated Node package bin and `defaultExec(argv)` with `shell:false`.

- [ ] Add failing fake npm-layout tests for search/map/scrape, spaces, Unicode, hostile argv, traversal, and mismatched package names.
- [ ] Run focused Firecrawl tests and confirm the current `.cmd` refusal.
- [ ] Implement package-name/bin containment validation and direct `process.execPath` spawning; never parse shim text.
- [ ] Run focused tests and isolated selftest; checkpoint `R3`.

**Acceptance:** all three production operations reach the stub byte-for-byte; unsupported layouts fail closed; no shell marker process/file is created.

### Task R4: Versioned transport-result and provenance contract

**Findings:** F03.  
**Files:** `transport.mjs`, `firecrawl.mjs`, `http-transport.mjs`, `collect.mjs`, `checks.mjs`, transport/collect/check tests, architecture map.

**Consumes:** R3. **Produces:** `TransportResultV2 { transport, operation, requestSummary, completeness, omitted, content }` and an authoritative transport/operation registry.

- [ ] Add contract tests for both adapters covering success, malformed result, refused request, and missing transport.
- [ ] Run them against the legacy implementation and record mismatches.
- [ ] Implement V2 normalization, explicit optional command annotation, and legacy read compatibility.
- [ ] Verify keyless provenance passes under its real identity and forged transports fail; checkpoint `R4`.

**Acceptance:** provenance never depends on display strings; unknown transport/operation or evidence-ledger mismatch blocks; old captures remain readable.

### Task R5: Transport network and body safety

**Findings:** loopback/private-address, redirect, body-limit, binary, and body-read timeout boundary.  
**Files:** `http-transport.mjs`, Firecrawl normalization, transport tests, architecture map, ADR if private-network policy changes.

**Consumes:** R4. **Produces:** explicit network policy, redirect limit, maximum bytes, content-type handling, and header/body deadlines.

- [ ] Add loopback/private-IP, redirect chain, oversized body, binary body, slow body, and DNS-rebind fixture tests.
- [ ] Run focused tests and document current unsafe behavior.
- [ ] Implement the approved policy with classified refusal/partial results; do not broaden access implicitly.
- [ ] Run transport tests and selftest; checkpoint `R5`.

**Acceptance:** policy is visible in diagnostics; body limits/deadlines are enforced; unsupported content is preserved with an honest grade or refused; no private-network behavior is accidental.

## Wave 1 — Durable-state migration and persistence

### Task R6: Persisted artifact schema and migration framework

**Findings:** cross-cutting migration gap.  
**Files:** `core.mjs`, `corpus.mjs`, `brief.mjs`, `machine.mjs`, migration tests, templates, architecture map, ADR `0023-artifact-schema-compatibility.md`.

**Consumes:** R1/R2 and `docs/superpowers/plans/2026-09-16-researcher-v2-migration-compatibility.md` (M0 compatibility matrix). **Produces:** `readArtifactVersion()`, `migrateToV2(root, snapshot)`, and a migration manifest with old/new hashes, schema, and rollback path.

- [ ] Add fixtures for every legacy artifact family, unknown future schema, truncated write, and idempotent rerun.
- [ ] Run migration tests and confirm legacy interpretation/unknown-schema behavior.
- [ ] Implement read-old/write-v2 adapters and snapshot/rollback without mutating source bytes until validation completes.
- [ ] Run the framework migration matrix and checkpoint `R6`; use the artifact IDs and FI-01–FI-30 catalogue in `2026-09-16-researcher-v2-migration-compatibility.md` as the review checklist.

**Migration Gate M1 — framework acceptance:** all synthetic legacy/current fixtures round-trip semantically, hashes are recorded, unknown future versions refuse, interruption/rollback restores every byte, and no real project artifact is changed.

### Task R7: Stable IDs and table semantics

**Findings:** F11, F22.  
**Files:** `corpus.mjs`, `collect.mjs`, `checks.mjs`, corpus/collect/check tests, architecture map.

**Consumes:** R6. **Produces:** highest-existing `nextId()` allocation, duplicate-ID refusal, and header-name-to-column writers.

- [ ] Add failing sparse-ID, duplicate-ID, reordered-header, missing-header, and duplicate-header tests.
- [ ] Run focused tests against current count-based allocation/writer behavior.
- [ ] Implement normalized header mapping and pre-write duplicate/schema validation.
- [ ] Run migration round-trip plus selftest; checkpoint `R7`.

**Acceptance:** E-01/E-03 allocates E-04; duplicates never select “last”; all supported header permutations preserve meaning; invalid headers cause no write.

### Task R8: Lease liveness and recovery

**Findings:** F13.  
**Files:** `provenance.mjs`, provenance tests, architecture map, ADR `0024-writer-lease.md`.

**Consumes:** R6. **Produces:** tokenized lease with heartbeat, PID/liveness state, bounded abandoned-lock recovery, and compare-token release.

- [ ] Add deterministic live-PID, dead-PID, unidentifiable, heartbeat, token-race, and long-running-holder tests.
- [ ] Run focused tests and record age-only eviction behavior.
- [ ] Implement lease acquisition/recovery/release without evicting a live writer by age alone.
- [ ] Run stress/fault tests and selftest; checkpoint `R8`.

**Acceptance:** live writer beyond ten minutes remains owner; bounded abandoned empty locks recover; stale token cannot unlink a replacement lock.

### Task R9: Durable collection transaction and recovery journal

**Findings:** F12, F14 and partial-write boundary.  
**Files:** `provenance.mjs`, `collect.mjs`, `research-run.mjs`, `decompose.mjs`, related tests, architecture map, ADR `0025-durable-collection-transaction.md`.

**Consumes:** R4, R7, R8. **Produces:** `withCollectionWrite(root, operation)` covering fresh cache lookup, ID allocation, temp capture, ledger, evidence/source rows, usage, publication, and recovery journal.

- [ ] Add fault-injection tests at every journal boundary, malformed-ledger-before-request, verified-tail repair, middle-chain break, concurrent collectors, and process termination.
- [ ] Run focused tests to capture orphan/lost-update behavior.
- [ ] Implement one coordinator; resume completed operations from receipts without another paid request.
- [ ] Run two-process stress, migration matrix, and selftest; checkpoint `R9`.

**Acceptance:** no request occurs before ledger validity; only verified tail repair; all concurrent rows/IDs/captures survive; each interruption resolves to complete, rollback, or refusal.

### Task R10: Non-destructive reviewed briefs

**Findings:** F05.  
**Files:** `brief.mjs`, `bin/brief.mjs`, brief tests, architecture map.

**Consumes:** R6. **Produces:** draft destination/ownership hash and `writeBrief()` refusal on authored byte drift.

- [ ] Add failing edited-brief, marker-only, deterministic-regeneration, backup, and force-replacement tests.
- [ ] Run focused tests and confirm reviewed prose is overwritten today.
- [ ] Implement separate draft output or exact generated-byte comparison; force creates exclusive backup.
- [ ] Run brief migration tests and selftest; checkpoint `R10`.

**Acceptance:** normal rerun never removes authored text; marker cannot authorize replacement; force reports hash-verified backup and destination.

### Task R11: Audit input fingerprint and version semantics

**Findings:** F06, F18.  
**Files:** `audit.mjs`, audit tests, architecture map.

**Consumes:** R6, R10. **Produces:** fingerprint of every rendered input and next-version computation before rendering.

- [ ] Add one-change-per-input tests for findings, intent, questions, decisions, contradictions, failures, provenance, and reviewed brief.
- [ ] Run focused tests and confirm changed claims currently produce “unchanged.”
- [ ] Implement canonical dependency fingerprint and version-consistent render inputs.
- [ ] Run audit migration matrix and selftest; checkpoint `R11`.

**Acceptance:** any rendered-input change creates a new version; no rendered-input change creates none; filename/H1/front matter/index/parent agree.

### Task R12: Audit manifest and source containment

**Findings:** F10.  
**Files:** `audit.mjs`, `archive.mjs`, audit/archive tests, architecture map.

**Consumes:** R6. **Produces:** `resolveAuditPath()` rejecting absolute/traversal/missing/directory/symlink escapes.

- [ ] Add failing manifest traversal, absolute, symlink, directory, missing, and valid-relative fixtures.
- [ ] Run focused tests and confirm outside-project reads.
- [ ] Implement resolved and realpath containment before reading bytes; preserve plain relative ZIP names.
- [ ] Run focused tests and selftest; checkpoint `R12`.

**Acceptance:** no manifest can read outside `research/audits`; valid bundles remain byte-correct.

### Task R13: Crash-safe audit publication

**Findings:** F15 and audit concurrency boundary.  
**Files:** `audit.mjs`, `archive.mjs`, tests, architecture map, ADR `0026-audit-publication.md`.

**Consumes:** R11, R12. **Produces:** immutable audit files plus atomic current-pointer/index publication and orphan recovery.

- [ ] Add injected-failure tests between audit write, pointer switch, index write, and bundle read; add concurrent slug/version tests.
- [ ] Run focused tests and record half-published states.
- [ ] Implement the named publication protocol; recovery chooses old valid or new valid state and records orphans.
- [ ] Run archive/audit suite and selftest; checkpoint `R13`.

**Acceptance:** every interruption leaves a readable old/new state; corrupt index never resets versions; bundle membership is deterministic.

### Task R14: Machine authority and config migration

**Findings:** F16.  
**Files:** `machine.mjs`, `doctor.mjs`, machine/doctor tests, architecture map, ADR `0027-unknown-machine-authority.md`.

**Consumes:** R1, R6. **Produces:** `collector | builder | unknown` authority with validated enums and authenticated last-good snapshot.

- [ ] Add malformed, unreadable, copied-without-snapshot, misspelled-field, valid-collector, and builder fixtures.
- [ ] Run focused tests and confirm corrupt config can authorize collection.
- [ ] Implement v2 config read/write, snapshot binding/integrity, and collection denial for unknown authority.
- [ ] Run migration matrix and selftest; checkpoint `R14`.

**Acceptance:** unknown authority cannot probe credentials or collect; valid collector works; doctor names source, state, snapshot, and recovery.

### Task R15: Secret scanner coverage and ignore protection

**Findings:** F26.  
**Files:** `doctor.mjs`, doctor tests, `.gitignore`, template ignore/scaffold source, architecture map.

**Consumes:** R1, R6. **Produces:** bounded scan manifest, redacted diagnostics, `.env`/`.env.*`/`.firecrawl` protections.

- [ ] Add synthetic `.env`, `.env.local`, hidden-log, oversized, skipped-file, and redaction fixtures.
- [ ] Run focused tests and record false-clean coverage.
- [ ] Implement declared path/pattern bounds and explicit skipped-coverage warnings.
- [ ] Verify scaffold output and selftest; checkpoint `R15`.

**Acceptance:** secrets are detected without output; skipped content is not reported clean; scaffolded projects ship protective ignores.

**Migration Gate M2 — durable-state acceptance:** run R6–R15 against legacy corpus/config snapshots; verify hashes, duplicate IDs, audit publication recovery, brief preservation, and unknown-authority denial before Wave 2.

## Wave 2 — Enforcement and recovery

### Task R16: Lossless staged status/path protocol

**Findings:** F09.  
**Files:** `githooks/pre-commit`, `gate.mjs`, `bin/gate.mjs`, hook/gate tests, architecture map.

**Consumes:** R6. **Produces:** NUL-delimited status/path decoder covering A/M/C/R/D/T and old/new paths.

- [ ] Add failing paths with spaces, tabs, newlines, quotes, Unicode, deletion, rename, copy, and type change; include 3k/30k scale fixtures.
- [ ] Run focused tests and record quoted-path/deletion bypasses.
- [ ] Implement `git diff --cached --name-status -z` parsing with literal paths and linear processing.
- [ ] Run performance and selftest; checkpoint `R16`.

**Acceptance:** exact identity for all statuses; deletion-only changes invoke enforcement; scaling stays within a recorded absolute ceiling and ratio.

### Task R17: Evaluate the exact staged corpus

**Findings:** F08.  
**Files:** `gate.mjs`, `bin/gate.mjs`, pre-commit hook, gate/hook tests, architecture map, ADR `0028-staged-corpus-verdict.md`.

**Consumes:** R6, R16. **Produces:** read-only index-tree materialization used only by commit verdicts; interactive preflight remains working-tree based.

- [ ] Add staged-open/working-closed, staged-closed/working-open, rename/type-change, symlink/filter, and materialization-failure fixtures.
- [ ] Run focused tests and confirm working-tree bytes currently decide staged verdicts.
- [ ] Implement contained index snapshot and cleanup; failure follows machine posture, never working-tree fallback.
- [ ] Run gate/hook suite and selftest; checkpoint `R17`.

**Acceptance:** verdict evaluates committed bytes exactly; staged/unstaged divergence cannot alter it; materialization failure is named internal error.

### Task R18: Owned hook mutation and research repair access

**Findings:** F17, F23.  
**Files:** `installer.mjs`, `hooks/edit-gate.mjs`, install/hook tests, architecture map.

**Consumes:** R14, R16/R17. **Produces:** owned-entry settings patcher and project-root-aware research-path allow rule.

- [ ] Add mixed-group, unrelated-property, idempotence/backup, payload-shape, hard-block research-edit, outside-project, and product-edit fixtures.
- [ ] Run focused tests and record unrelated-hook deletion/research repair denial.
- [ ] Implement entry-scoped mutation and allow only evaluated project research paths while gate fails.
- [ ] Run hook/install suite and selftest; checkpoint `R18`.

**Acceptance:** unrelated settings preserve exact objects; backups are exclusive; research repair is allowed; non-research product edits are blocked/asked per posture.

### Task R19: Preservation-first handoff recovery

**Findings:** F27.  
**Files:** `handoff.mjs`, `bin/handoff.mjs`, `doctor.mjs`, handoff/doctor tests, architecture map.

**Consumes:** R6, R15. **Produces:** non-destructive line-ending remedy with verified backup inventory.

- [ ] Add non-Git, untracked/modified research, verified line-ending, genuine tamper, symlink, and backup-collision fixtures.
- [ ] Run focused tests and confirm the old recursive-delete advice.
- [ ] Implement repository prerequisite, tracked/untracked inventory, exclusive backup, affected-file-only restore proposal, and tamper remedy.
- [ ] Run handoff/selftest; checkpoint `R19`.

**Acceptance:** no delete command for non-Git or unpreservable state; only verified rewritten files are proposed; tampering receives collector remedy.

**Migration Gate M3:** run exact staged and handoff checks on migrated artifacts; no enforcement package may approve a corpus whose migration manifest is incomplete.

## Wave 3 — Semantic quality and readiness

### Task R20: Freeze claim/evidence/review schema

**Findings:** F04/F07/F21/F24 semantic gaps.  
**Files:** `core.mjs`, `corpus.mjs`, templates, checks/tests, architecture map, ADR `0029-claim-review-schema.md`.

**Consumes:** M2/M3. **Produces:** versioned claim records with question ID, kind, scope, source IDs/ownership groups, locator, source/retrieval dates, review actor/time, and status.

- [ ] Add legacy-row, unknown-future, missing-locator, and claim-review migration fixtures.
- [ ] Run schema tests and record which legacy claims cannot be upgraded without review.
- [ ] Implement read-only legacy adapter and v2 writes; no legacy row becomes approved by default.
- [ ] Run migration matrix; checkpoint `R20` and freeze the semantic interface.

**Acceptance:** old evidence remains history; new claims cannot omit review-critical fields; future schemas refuse visibly.

### Task R21: Claim-aware extraction and locators

**Findings:** F04.  
**Files:** `http-transport.mjs`, `firecrawl.mjs`, `collect.mjs`, transport/check tests, architecture map.

**Consumes:** R5, R20. **Produces:** meaningful-section extraction, completeness/omission grade, and media-specific locators; no `full-for-claim` from length alone.

- [ ] Add two-section, buried-exception, navigation-only, malformed, redirect/error, binary, and 4,000-character-missing-locator fixtures.
- [ ] Run focused tests and record dropped sibling content.
- [ ] Implement section/link preservation and claim-support validation against the frozen schema.
- [ ] Run both adapters, migration checks, and selftest; checkpoint `R21`.

**Acceptance:** decisive short sections survive; unsupported long captures cannot close claims; adapter differences are explicit.

### Task R22: Source authority, freshness, and ownership groups

**Findings:** F24 and freshness portion of F21.  
**Files:** `core.mjs`, `corpus.mjs`, `collect.mjs`, `checks.mjs`, Firecrawl/corpus tests, architecture map.

**Consumes:** R20/R21. **Produces:** anchored hostname handling, ownership group, claim-specific authority review, published/updated date, retrieval time, and upstream cache metadata.

- [ ] Add lookalike-host, docs-hint, same-owner multi-URL, stale-publication, future-date, and cache-state fixtures.
- [ ] Run focused tests and record provisional-primary misclassification.
- [ ] Implement authority as reviewed claim/source data; discovery preference never proves authority.
- [ ] Run freshness suite and selftest; checkpoint `R22`.

**Acceptance:** lookalike hosts never become authoritative; retrieval is distinct from publication/upstream time; unsupported fresh-fetch options refuse visibly.

### Task R23: Supersession and review invalidation

**Findings:** F21.  
**Files:** `corpus.mjs`, `collect.mjs`, `checks.mjs`, `audit.mjs`, lifecycle tests, architecture map, ADR `0030-evidence-supersession.md`.

**Consumes:** R20–R22. **Produces:** immutable evidence history, active/superseded links, dependent-claim invalidation, and `review-required` transitions.

- [ ] Add refresh, stale citation, changed-claim, prior-audit, and reviewed-brief preservation fixtures.
- [ ] Run lifecycle tests and confirm refresh leaves stale active rows.
- [ ] Implement supersession graph and invalidate dependent approval without overwriting history.
- [ ] Run audit/readiness migration checks and selftest; checkpoint `R23`.

**Acceptance:** refresh preserves old evidence, marks active citation, and requires claim review; no new capture silently validates an old claim.

### Task R24: Pure execution plans, budgets, and usage accounting

**Findings:** F19, F20, F25.  
**Files:** `research-run.mjs`, `decompose.mjs`, `collect.mjs`, CLIs, related tests, architecture map.

**Consumes:** R5, R9, R21, R23. **Produces:** immutable execution plan/inputs fingerprint, operation/retry budget, cache-hit events, thin-content grades, and classified failure log.

- [ ] Add dry-run purity, invalid numeric limits, all-search-failed, blank-map redraft, retry-after, permanent failure, cache hit, thin page, and total-cap fixtures.
- [ ] Run focused tests and record state writes and undercounted spend.
- [ ] Implement plan-before-write/request, fingerprint check, bounded retries, and operation-level accounting.
- [ ] Run two-transport end-to-end and selftest; checkpoint `R24`.

**Acceptance:** dry-run filesystem is byte-pure; execution refuses changed plan fingerprint; total cap includes every attempt; cache hits cost zero and are not failures.

### Task R25: Structural/review/handoff readiness state machine

**Findings:** F07.  
**Files:** `brief.mjs`, `audit.mjs`, `checks.mjs`, `preflight.mjs`, CLIs, tests, architecture map, ADR `0031-readiness-states.md`.

**Consumes:** R10, R13, R20, R23, R24. **Produces:** `structurally-valid | review-required | handoff-approved` with explicit transition predicates and reviewer records.

- [ ] Add missing brief/plan/findings, pending contradiction, unresolved marker, unreviewed authority, superseded claim, and approved handoff fixtures.
- [ ] Run focused tests and record affirmative completion from missing review.
- [ ] Implement one state evaluator; collection remains permitted in non-approved states.
- [ ] Run full semantic suite and selftest; checkpoint `R25`.

**Acceptance:** missing review never means “none found”; handoff approval requires reviewed brief, answered plan, coverage dispositions, contradictions decision, and no unresolved markers.

**Migration Gate M4:** migrate a representative legacy corpus through R20–R25, verify no automatic approval, and compare old/new audit outputs and claim links before release work.

## Wave 4 — Release qualification

Release qualification is a one-way evidence chain, not one monolithic task. Each package seals its own append-only records and promotion pointer. Reverting a package marks that pointer reverted and removes only the package’s derived qualification status; it does not edit or delete candidate output, gold, source captures, calibration results, or an earlier package’s records.

| Package | Qualification boundary | Revert effect |
|---|---|---|
| R26 | Deployment identity and parity | Status returns to `not-ready`; diagnostics remain |
| R27 | Offline end-to-end flow | Offline qualification pointer is removed; run artifacts remain |
| R28 | Benchmark v1.0 schema and pinned contract | Harness promotion is removed; no run or gold artifact is reinterpreted |
| R29 | Gold lock and grader calibration | Task/gold promotion is removed; authoring and failed calibration history remain |
| R30 | Frozen cold qualification | Frozen-cold roll-up is removed; 20 sealed cold runs remain |
| R31 | Frozen warm qualification | Frozen-warm roll-up is removed; 20 sealed warm runs remain |
| R32 | Authorized live canary | `live-verified-until` is removed or expires; live records and cost evidence remain |
| R33 | Final release report and status | Release pointer is removed; component reports remain auditable |

Promotion gates are monotone and blocking:

| Gate | Closes after | Required evidence | If it fails |
|---|---|---|---|
| Q0 — contract pin | R28 | Human approval plus one v1.0.0 specification hash in the harness | No gold authoring or qualification promotion |
| Q1 — gold/calibration lock | R29 | 24 task records, role separation, Section 12 agreement, and matching v1.0.0 hashes | Return affected task packages to authoring; do not run candidates |
| Q2 — frozen cold | R30 | 20 valid cold task results with no contract-invalid run | Do not construct or promote the frozen roll-up |
| Q3 — frozen warm | R31 | 20 valid warm results matching cold under the manifest-only rule and zero eligible warm cost | Frozen track remains unqualified |
| Q4 — live authorization | R32 | Explicit operator approval, 12 passing repetitions, source pre/post hashes, and cost reconciliation | Status remains `offline-verified`; no live claim |
| Q5 — release publication | R33 | All prior gates, matching hashes, and an auditable report | No release pointer is published |

### Task R26: Release identity and deployment parity

**Findings:** deployment/readiness gap.  
**Files:** `doctor.mjs`, `bin/doctor.mjs`, `bin/install.mjs`, install/doctor tests, architecture map.

**Consumes:** R3, R14, R18, R25. **Produces:** source/deployed/hook/runtime release hashes and `offline-verified | live-verified-until | not-ready` status.

- [ ] Add divergent-source/deployed/hook/runtime fixtures and configured-hook selection tests.
- [ ] Run focused tests and record source/deployed diagnostic disagreement.
- [ ] Implement release hash recording and readiness that names exact divergent paths.
- [ ] Run install/doctor suite and selftest; checkpoint `R26`.

**Acceptance:** all selected components agree on hash or readiness fails; authentication is not confused with collection readiness.

**Rollback:** revert only the R26 readiness pointer; retain component hashes and divergence diagnostics.

### Task R27: Offline end-to-end qualification

**Findings:** release integration gap.  
**Files:** new isolated fixtures under `fetchproof/test/e2e/`, adapters, docs/architecture map.

**Consumes:** R5, R9, R13, R19, R24, R25, R26. **Produces:** deterministic decompose → plan → collect → preflight → reviewed brief → audit → handoff run for both transports.

- [ ] Add failing end-to-end fixture for each transport, migration state, refusal, and recovery branch.
- [ ] Run it and record the first failing stage.
- [ ] Implement only integration glue required by earlier package contracts.
- [ ] Run twice consecutively with sentinels and selftest; checkpoint `R27`.

**Acceptance:** both transports complete offline; no external mutation, leaked process, or paid request; readiness state matches actual review state.

**Rollback:** revert only the R27 offline-qualification pointer; retain deterministic run artifacts and failure diagnostics.

## Release qualification artifact contract (R28–R33)

This section defines the evidence chain consumed by benchmark PASS. The logical paths below are canonical package paths under `fetchproof/test/benchmark/records/`; an implementation may use an equivalent storage backend only when the release manifest records a one-to-one path mapping and SHA-256 for every item. Records are append-only and sealed before the next role receives access.

### Ownership and access rules

| Role | Owns | Must not do |
|---|---|---|
| Contract custodian | R28 contract pin, schema manifest, and release manifest | Change benchmark v1.0.0 text, scoring, thresholds, or outcome vocabulary |
| Task author | Candidate-visible task package and source-independent task metadata | See or approve their own gold; edit a locked task |
| Gold reviewer A/B | Independent gold review and calibration labels | Review a package they authored or see the other review before sealing |
| Calibration adjudicator | Recorded resolution of grader disagreement during R29 | Rewrite a candidate output or silently average labels |
| Run operator | Environment identity, process control, run sealing, and cost/source capture | Grade the candidate or edit sealed candidate artifacts |
| Grader A/B | Independent score sheets and rationales | See the other grader's sheet before sealing or use prior scores |
| Release evidence custodian | Hash inventory, promotion pointers, and package roll-ups | Delete valid failures, replace runs, or weaken a gate |
| Live authorization owner | Explicit R32 approval and account/source window | Grant approval retroactively or expose credentials in a record |

Role IDs, UTC timestamps, and conflict checks are recorded in every package manifest. The task author, two gold reviewers, two graders, and adjudicator remain distinct for a task as required by benchmark v1.0.0.

### Canonical artifact inventory

| Artifact ID and canonical path | Package / owner | Visibility and mutability | Evidence required before promotion |
|---|---|---|---|
| R28-01 `contract-pin.json` | R28 / contract custodian | Grader-only; immutable | Human approval identity/time, spec version `1.0.0`, SHA-256 of the exact approved spec, approval scope, and supersession check |
| R28-02 `schema-manifest.json` | R28 / harness maintainer | Grader-only; immutable | Run/task/track/release schemas, validity precedence, score formulas, cap fields, and parser self-test hashes match the approved spec |
| R28-03 `report-schema.md` | R28 / report maintainer | Template; versioned | Required run, grade, cost, validity, roll-up, and release-decision fields are present; no field permits local thresholds |
| R28-04 `release-manifest.json` | R28 / evidence custodian | Grader-only; atomic pointer | R26/R27 identities, R28-01..03 hashes, benchmark version/hash, record roots, and `promotion: ready` only after Q0 |
| R29-01 `tasks/<task-id>/task-visible.json` | R29 / task author | Candidate-visible; locked bytes | Prompt/output contract hash, track/category/difficulty, caps, allowed access, stop conditions, and no gold-only values |
| R29-02 `gold/<task-id>/gold.json` | R29 / task author + reviewers | Grader-only; immutable after lock | Expected outcome, atomic required claims/constraints, weights/criticality, disallowed claims, traps, source IDs/groups/locators, and v1.0 hash |
| R29-03 `sources/<task-id>/source-manifest.json` | R29 / gold reviewers | Grader-only; immutable | Owner/publisher, ownership group, authority rationale, locator type/value, retrieval/publication scope, freshness rule, and SHA-256 for every source/capture |
| R29-04 `calibration/<task-id>/batch.json` plus `grades/*.json` | R29 / calibration adjudicator | Grader-only; append-only | Conforming and non-conforming/gaming cards, two blind grader sheets, per-task agreement, adjudications, and pooled observations covering labels 0/0.5/1 |
| R29-05 `warm-manifests/<task-id>.json` | R29 / warm-manifest steward | Grader-only; immutable | Exact eligible raw/provenance/cache paths and hashes, task version/freshness window, and explicit exclusion of synthesis, claims, briefs, audits, and grader notes |
| R29-06 `gold-lock.json` | R29 / evidence custodian | Grader-only; atomic pointer | 24 task/gold/source/calibration/warm hashes, two gold approvals per task, role conflicts clear, Section 12 agreement, and frozen/live inventory (20/4) |
| R30-01 `runs/frozen-cold/<task-id>/<run-id>.json` | R30 / run operator | Grader-only; sealed immutable | Complete v1.0 run record: release/task/gold hashes, environment, transport, caps, timings, counts, cost meter, prohibited-access result, outcome, artifact manifest, and external-mutation check |
| R30-02 `artifacts/<run-id>/manifest.json` | R30 / run operator | Grader-only; immutable | SHA-256 and relative path for every candidate artifact, capture, provenance row, usage record, and sealed run record; no gold path exposed |
| R30-03 `grades/frozen-cold/<run-id>/<grader-id>.json` | R30 / grader A/B | Grader-only; append-only | Atomized assertions, required-claim/constraint labels, support components, hard-failure checks, outcome, rationales for 0/0.5, and grader role identity |
| R30-04 `adjudications/<run-id>.json` | R30 / adjudicator | Grader-only; append-only | Only material disagreements, exact rule applied, final label, pass/fail effect, and gold-defect/invalid-run decision |
| R30-05 `rollups/frozen-cold.json` | R30 / evidence custodian | Grader-only; atomic pointer | Exactly 20 valid cold records, all per-run gates, task IDs/versions, retained failures, and explicit `track: provisional-cold` (not a frozen task PASS until R31) |
| R31-01 `runs/frozen-warm/<task-id>/<run-id>.json` | R31 / run operator | Grader-only; sealed immutable | Warm run record with R29-05 manifest hash, zero eligible new collection cost, environment/cap fields, outcome, artifact hashes, and no synthesis access |
| R31-02 `comparisons/<task-id>.json` | R31 / comparison steward | Grader-only; append-only | Cold/warm normalized outcome, required-claim dispositions, required-constraint dispositions, active source/locator set, ignored metadata list, and mismatch adjudication |
| R31-03 `rollups/frozen-release.json` | R31 / evidence custodian | Grader-only; atomic pointer | 20 cold + 20 warm valid passing runs, normalized equivalence, zero eligible warm cost, frozen aggregate thresholds, critical-claim/constraint checks, and zero false build-ready decisions |
| R31-04 `grades/frozen-warm/<run-id>/<grader-id>.json` | R31 / grader A/B | Grader-only; append-only | Independent atomized warm claims/constraints, component scores, hard-failure checks, outcome, rationales, and grader role identity |
| R31-05 `adjudications/frozen-warm/<run-id>.json` | R31 / adjudicator | Grader-only; append-only | Material warm disagreements, exact rule applied, final label, pass/fail effect, and cold/warm mismatch decision |
| R32-01 `live/authorization.json` | R32 / live authorization owner | Grader-only; immutable | Explicit operator approval, account identity without credentials, permitted domains/scope, locked meter/unit/window/tolerance, task IDs, and expiry |
| R32-02 `live/source-captures/<task-id>/<rep>-pre-post.json` | R32 / source verifier | Grader-only; immutable | Pre/post hashes and locators for every material gold passage, retrieval timestamps, material-drift decision, and invalidation reason when applicable |
| R32-03 `runs/live-cold/<task-id>/<rep>/<run-id>.json` | R32 / run operator | Grader-only; sealed immutable | Three repetitions per live task, complete v1.0 run records, candidate/grader hashes, validity, caps, source-window binding, and retained failures |
| R32-04 `live/cost-reconciliation/<task-id>.json` | R32 / cost-meter owner | Grader-only; append-only | Authoritative meter export, attribution window, starting/ending balance, operation counts, accepted-required-unit denominator, tolerance result, and unrelated-traffic check |
| R32-05 `rollups/live-release.json` | R32 / evidence custodian | Grader-only; atomic pointer | 12 valid passing repetitions, per-run gates, median correctness/support/coverage, critical checks, source-drift results, cost reconciliation, and `live-verified-until` expiry |
| R32-06 `grades/live-cold/<run-id>/<grader-id>.json` | R32 / grader A/B | Grader-only; append-only | Independent atomized live claims/constraints, component scores, hard-failure checks, outcome, source-window binding, rationales, and grader role identity |
| R32-07 `adjudications/live-cold/<run-id>.json` | R32 / adjudicator | Grader-only; append-only | Material live disagreements, exact rule applied, final label, pass/fail effect, source-drift/invalid-run decision, and no dropped repetition proof |
| R33-01 `release/release-report.md` | R33 / release owner | Grader-only; immutable | Deterministic report from sealed R26-R32 predecessors, retained failures, score/cost/calibration evidence, status, expiry, and full predecessor hash closure |
| R33-02 `release/status.json` | R33 / release owner | Grader-only; immutable | One canonical readiness state with precedence, benchmark PASS eligibility, live expiry, and hashes for R33-01 and all required gates |
| R33-03 `release/promotion.json` | R33 / evidence custodian | Grader-only; atomic pointer | Sole release promotion pointer; `ready` only when Q0-Q5 and BM-0-BM-6 pass; revoked descendants and rollback record hashes |

### Common record envelope and sealing

Every JSON record and Markdown report listed above carries this envelope before its package-specific payload:

| Field | Required value |
|---|---|
| `artifactId` | One of the R28-01..R33-03 IDs in the inventory |
| `schema` | Positive integer schema revision; unknown future revisions refuse |
| `benchmarkSpecVersion` | Exactly `1.0.0` for this release |
| `benchmarkSpecSha256` | 64 lowercase hexadecimal characters equal to R28-01 |
| `package` | Owning package ID (`R28`, `R29`, `R30`, `R31`, or `R32`) |
| `recordId` | Unique immutable identifier within the package |
| `ownerRole` | One role from the ownership table, matching the package operation |
| `roleRosterSha256` | Hash of the authenticated role roster used for authorization and conflict checks |
| `createdAt` | UTC ISO-8601 timestamp |
| `predecessorHashes` | Ordered SHA-256 list for every sealed input consumed |
| `payloadSha256` | 64 lowercase hexadecimal characters over canonical payload bytes |
| `state` | Exactly `sealed`; drafts are not promotion evidence |

Promotable R28–R33 target envelopes additionally bind a
`pathAuthoritySnapshots` object containing `before`, `after`, and `recovery`
snapshot references. Each reference carries the snapshot ID, canonical
self-excluding SHA-256, UTC capture time, `status: "PASS"`, and a safe path to
the immutable evidence below the release root. The release validator verifies
those hashes and package/gate/phase links and rejects missing, unreadable,
future, or stale snapshots (seven days by default; configurable offline).

The implementation canonicalizes field ordering before hashing, writes the payload to a temporary path, verifies the payload hash, and atomically publishes the sealed record. A record with a missing predecessor, mismatched benchmark hash, mutable state, or unaccounted field is not evidence. Promotion pointers reference sealed record hashes rather than filenames alone. Candidate-visible exports contain only R29-01 and permitted run inputs; R29-02/03/04/05, all grader sheets, adjudications, and release pointers remain grader-only.

### Evidence rules for benchmark PASS

1. **R28 contract proof:** R28 PASS requires R28-01..04 to carry the same approved benchmark v1.0.0 version and SHA-256 (each artifact also has its own payload hash). A missing approval, superseded spec, or hash mismatch blocks all later packages.
2. **R29 lock proof:** R29 PASS requires all 24 task-visible and gold records, source manifests, calibration batches, and warm manifests to carry the same R28 version/hash. Each task has two independent gold approvals, role separation, required dimension coverage, and Section 12 per-task plus pooled agreement. A failed calibration task returns to `draft`; it is not promoted with an average.
3. **R30 cold proof:** R30 produces 20 independently sealed cold run records and grades. Each valid run satisfies v1.0 Sections 13 and 14.1, retains failures, and has complete artifact/cost/environment manifests. R30's roll-up is provisional cold evidence; it cannot claim frozen task or track PASS without R31 warm evidence.
4. **R31 frozen proof:** R31 adds exactly one warm run per frozen task from its hash-verified warm manifest. Every warm run independently passes, matches cold on normalized outcome/claims/constraints/source-locator set, and incurs zero eligible new collection cost. The R31 roll-up alone is the frozen-track evidence and must meet v1.0 Sections 14.2 and 14.3.
5. **R32 live proof:** R32 requires explicit authorization before access, three cold repetitions for each of four live tasks within seven days, material source pre/post hashes, valid cost attribution, and independent grades. All 12 repetitions pass; medians meet v1.0 Section 14.4; no repetition is dropped or rescued by a median; expiry is recorded.
6. **Overall benchmark PASS:** benchmark PASS means Q0–Q4 are closed: R28 contract pin, R29 gold/calibration lock, R30/R31 frozen release, and R32 live release all pass. `offline-verified` without R32 is a deliberate incomplete release state, not benchmark PASS. R33 may publish only when this chain and the v1.0 cost gate pass.
7. **Invalid versus failed:** an invalid environment record is retained and makes the affected package `INCOMPLETE` until corrected and rerun. A valid failed run remains `FAIL` and cannot be replaced for release credit. Candidate hard failures take precedence over environment invalidation.
8. **Rollback:** reverting R28, R29, R30, R31, or R32 removes only that package's promotion pointer/derived roll-up. It never edits or deletes task prompts, gold, source captures, calibration decisions, sealed runs, grades, cost evidence, or prior failure records.

### Task R28: Benchmark v1.0 harness and report schema

**Findings:** benchmark integration requirement.  
**Files:** `fetchproof/test/benchmark/` harness, report templates, architecture map.

**Consumes:** approved benchmark spec v1.0, R26/R27. **Produces:** R28-01..04 (`contract-pin.json`, `schema-manifest.json`, `report-schema.md`, and `release-manifest.json`), sealed run-record loader, fixture isolation, scoring-sheet loader, result hierarchy, and append-only report writer.

- [ ] Add harness tests for package/gold separation, run sealing, validity precedence, metric formulas, cap checks, and report immutability.
- [ ] Run them against intentionally invalid fixtures and record leaks/ambiguities.
- [ ] Verify R28-01's human approval record and pin the exact v1.0.0 specification SHA-256; refuse a candidate, superseded, or hash-mismatched contract.
- [ ] Implement the v1.0 schema without LLM final judging or live credentials.
- [ ] Run harness tests twice and checkpoint `R28`.

**Acceptance:** run/task/track/release hierarchy and candidate-vs-environment failure rules match the pinned v1.0.0 specification exactly; no gold exposure; any version/hash mismatch blocks promotion.

**Rollback:** revert only the R28 harness-promotion pointer; retain sealed harness tests and contract-mismatch evidence.

### Task R29: Task/gold authoring and calibration batch

**Findings:** benchmark governance requirement.  
**Files:** candidate-visible and grader-only packages for the 24 outlined tasks, manifests, reviewer rubric.

**Consumes:** R28, `docs/superpowers/specs/2026-09-16-researcher-benchmark-task-outlines.md`, `docs/superpowers/specs/2026-09-16-researcher-benchmark-gold-authoring-calibration.md`, `docs/superpowers/specs/2026-09-16-researcher-benchmark-expanded-task-calibration-packets.md`, and the normative [`docs/superpowers/specs/2026-09-16-researcher-benchmark-release-review-checklist.md`](../specs/2026-09-16-researcher-benchmark-release-review-checklist.md). **Produces:** R29-01..06 (24 task-visible packages, gold/source manifests, calibration batches, warm manifests, and `gold-lock.json`).

- [ ] Author task-visible prompts, gold claims/constraints, ownership groups, locators, caps, outcomes, and warm manifests.
- [ ] Run two independent gold reviews and role-conflict checks before candidate execution.
- [ ] Pilot conforming, incomplete, incorrect, and gaming outputs; compute pooled kappa and raw agreement.
- [ ] Verify every task, gold, calibration, and warm-manifest record carries the R28 v1.0.0 version/hash; reject local threshold or outcome changes.
- [ ] Lock R29-01..06 hashes only after the release-review checklist’s per-task, portfolio, locator, hash, and calibration gates pass; checkpoint `R29`.

**Acceptance:** 20 frozen/4 live, 6/12/6 difficulty, required universal-dimension coverage, at least eight non-affirmative outcomes, and no unresolved rubric ambiguity; all records match the pinned v1.0.0 version/hash.

**Rollback:** revert only the R29 task/gold promotion pointer; retain authoring records, reviewer decisions, and failed calibration batches.

### Task R30: Frozen cold benchmark qualification

**Findings:** benchmark release gate.  
**Files:** benchmark runner/report fixtures, no product code.

**Consumes:** R28/R29, G3. **Produces:** R30-01..05 (20 sealed frozen-cold run records, artifact manifests, independent grades, adjudications, and the provisional-cold roll-up).

- [ ] Execute each of the 20 frozen tasks once under a clean cold condition; do not create warm manifests in this package.
- [ ] Independently grade and adjudicate required disagreements; retain all valid failures.
- [ ] Apply v1.0 per-run gates and record required-unit cost diagnostics in R30-01..04; do not mark the provisional R30-05 roll-up as a frozen-track PASS.
- [ ] Verify the specification version/hash, report immutability, and checkpoint `R30`.

**Acceptance (authoritative for R30):** all 20 frozen-cold runs are valid and pass v1.0 Section 14.1; zero critical misses, false build-ready decisions, prohibited access, or contract-invalid runs; every R30-01..04 record is sealed; the R30-05 roll-up contains no warm result and makes no frozen-task or aggregate frozen-track claim until R31.

**Rollback:** revert only the R30 promotion pointer and frozen-cold roll-up; retain all sealed cold run records and grades for audit.

<!-- The former aggregate acceptance line below is retained as historical text only; warm qualification belongs to R31.

**Acceptance:** all frozen tasks pass; thresholds are ≥90% correctness, ≥90% citation support, ≥95% constraint coverage; zero critical misses, false build-ready decisions, prohibited access, or nonzero eligible warm collection cost.

**Clarification:** the legacy aggregate acceptance sentence immediately above is superseded by the authoritative cold-only acceptance; warm cost and warm-result checks are owned by R31.

-->

### Task R31: Frozen warm benchmark qualification

**Findings:** benchmark cold/warm repeatability gate.  
**Files:** benchmark runner/report fixtures, warm-manifest checks, no product code.

**Consumes (authoritative):** sealed R30 cold records, immutable R29-05 warm manifests, R28/R29, and G3. **Produces:** R31-01..05 (20 sealed frozen-warm records, independent warm grades/adjudications, normalized comparisons, and the frozen-release roll-up).

<!-- Superseded live-canary consumes/produces line retained only in the document history.
**Consumes:** R30 and explicit operator approval. **Produces:** four tasks × three repetitions, source pre/post hashes, cost reconciliation, and `live-verified-until` expiry.
-->

- [ ] Consume the immutable, hash-verified R29-05 warm manifest; derive only a per-run eligibility digest from each sealed cold run, excluding synthesis artifacts, claims, briefs, audits, and grader notes.
- [ ] Execute each frozen task once under manifest-only warm conditions and independently grade it into R31-04/R31-05; do not rerun or replace the R30 cold result.
- [ ] Write R31-02 comparisons for normalized outcome, required claims, constraints, and active source/locator set against cold; verify zero new eligible-cache collection cost in every R31-01 record.
- [ ] Adjudicate mismatches, verify the specification version/hash, and checkpoint `R31`.

**Acceptance (authoritative for R31):** all 20 warm tasks pass v1.0 Sections 14.1 and 14.2; each normalized warm result matches its cold counterpart except permitted run metadata; no warm run consults cold synthesis; eligible warm collection cost is zero; the frozen aggregate thresholds and critical-claim/constraint checks pass; no critical disagreement or contract-invalid run remains.

**Rollback:** revoke only the R31 warm promotion pointer and roll-up; retain sealed warm records, independent grades, comparisons, adjudications, and any failed history.

**Clarification:** the legacy live-canary acceptance sentence below is superseded; live canary qualification is owned by R32.
<!-- superseded legacy acceptance follows
**Acceptance:** all 12 repetitions pass; medians ≥90% correctness/support and ≥95% coverage; every cap and source scope passes; no credentials enter artifacts.

-->

### Task R32: Live canary and smoke authorization

**Findings:** live qualification boundary.  
**Files:** operator runbook, live manifest/report templates; no automatic credential or product-code changes.

**Consumes (authoritative):** sealed R28/R29 contract and gold-lock hashes, R31 frozen-release evidence, G3, and explicit operator approval. **Produces:** R32-01..07 (authorization, material source pre/post hashes, twelve sealed live-cold records, independent live grades/adjudications, cost reconciliations, and the expiring live-release roll-up).

**Clarification:** the legacy final-report consumes/produces sentence below is superseded; final report publication is owned by R33.
<!-- superseded legacy consumes/produces follows
**Consumes:** R26–R31. **Produces:** one auditable release report and operator status vocabulary.

-->

- [ ] Write R32-01 before launch: prepare a zero-unrelated-traffic account and verify the locked meter/cap, specification version/hash, and live-source window.
- [ ] Run three cold repetitions per live task within seven days; invalidate only material source drift outside candidate control.
- [ ] Independently grade every repetition into R32-06/R32-07; apply all per-run gates and median stability gates; write R32-04 credits/accepted-required-unit separately and retain every valid failure in R32-03.
- [ ] Checkpoint `R32`; without approval, record `offline-verified` only and do not claim live qualification.

**Acceptance (authoritative for R32):** all 12 repetitions pass; medians are at least 90% correctness/support and at least 95% coverage; every cap and source scope passes; no credentials enter artifacts; the expiry is recorded.

**Rollback:** revoke the `live-verified-until` promotion and live summary only; retain the 12 sealed runs, independent grades, adjudications, source hashes, approval, and cost reconciliation.

**Clarification:** the legacy final-report acceptance sentence below is superseded; final report publication is owned by R33.
<!-- superseded legacy acceptance follows
**Acceptance:** source/deployed/hooks agree; offline E2E and benchmark gates pass; live status is explicit/expiring; doctor, preflight, and handoff agree; credits change only for the authorized smoke.
-->

### Task R33: Release report, operator docs, and final gate

**Findings:** cross-cutting release qualification.  
**Files:** `fetchproof/README.md`, `START_HERE.md`, templates, `AGENTS.md`, `CONTEXT.md`, architecture map, release report.

**Consumes:** R26–R32, the pinned benchmark v1.0 manifest, and the migration/rollback gates specification. **Produces:** R33-01..03 (sealed release report, canonical status record, and atomic promotion pointer).

- [ ] Add failing documentation/consistency checks for hash identity, readiness states, destructive recovery advice, benchmark thresholds, and credit claims.
- [ ] Run all four final commands from the project root and record known red-suite limitations if any remain.
- [ ] Implement documentation-only corrections and release report generation; do not waive a failed gate.
- [ ] Run the complete isolated suite twice, doctor, preflight, handoff, and report checks; verify that every release package references the same v1.0 hash; checkpoint `R33`.

**Acceptance:** source/deployed/hooks agree; offline E2E, frozen cold, frozen warm, and v1.0 benchmark gates pass; `live-verified-until` is unexpired when Q4/R32 is included, otherwise the report is explicitly offline-only and cannot claim benchmark PASS; doctor, preflight, and handoff agree; credits change only for the authorized smoke; no release pointer is published when any component package is reverted or hash-mismatched.

**Rollback:** revoke R33-03 and mark R33-01/R33-02 `revoked`; retain report bytes, component package records, and their audit history intact.

## Finding coverage matrix

| Finding | Primary package |
|---|---|
| F01 | R3 |
| F02 | R1 |
| F03 | R4 |
| F04 | R21 |
| F05 | R10 |
| F06 | R11 |
| F07 | R25 |
| F08 | R17 |
| F09 | R16 |
| F10 | R12 |
| F11 | R7 |
| F12 | R9 |
| F13 | R8 |
| F14 | R9 |
| F15 | R13 |
| F16 | R14 |
| F17 | R18 |
| F18 | R11 |
| F19 | R24 |
| F20 | R24 |
| F21 | R22/R23 |
| F22 | R7 |
| F23 | R18 |
| F24 | R22 |
| F25 | R24 |
| F26 | R15 |
| F27 | R19 |

Additional review boundaries are owned by R2 (harness cleanup), R5 (network/body safety), R6 (schema migration), R13 (audit concurrency), and R26–R33 (release/baseline qualification).

## Safe parallelism

- **G0:** serial R1 → R2 → R3 → R4 → R5. R6 may be designed beside R3–R5 but cannot migrate artifacts until G0 passes.
- **G1:** at most four lanes after R6: R7 ∥ R8 → R9; R10 → R11; R12 → R13; R14 → R15. R9 waits for R7 and R8; R13 waits for R11 and R12. Do not edit shared test files concurrently.
- **G2:** R16 → R17; R18 and R19 may run beside R16 only if hook/doctor test ownership is disjoint; otherwise serialize. G2 closes before semantic work.
- **G3:** one code lane: R20 → R21 → R22 → R23 → R24 → R25. Benchmark prose/reviewer preparation may run beside it after R20’s schema is frozen.
- **G4:** R26 → R27 → R28 → R29 → R30 → R31 → R32 → R33. Gold review can parallelize by task only after R28 and role rules are locked; qualification runs remain serial at package boundaries.

## Final verification sequence

Run only after R1–R33 and the applicable migration gates pass:

```powershell
node fetchproof/bin/selftest.mjs
node fetchproof/bin/doctor.mjs
node fetchproof/bin/preflight.mjs
node fetchproof/bin/handoff.mjs
```

Then verify twice-consecutive isolated execution, unchanged machine sentinels, exact release hashes, distinct readiness states, valid handoff chain, benchmark PASS, and unchanged credits unless R32 was explicitly approved.

## Explicitly out of scope

- Replacing Markdown/files with a database before the single-writer design is proven insufficient.
- Replacing human graders with an LLM judge.
- Adding collection vendors before both transport contracts are correct.
- Treating provenance hashes as semantic truth or origin signatures.
- Automatic observation of `git commit --no-verify`; documentation may claim only observable overrides.
- Broad platform hardening beyond the scoped transport safety tests in R5.

## Plan self-review

- Every F01–F27 has one primary package; cross-cutting boundaries have explicit owners.
- R6 precedes all persisted-format changes; M1–M4 block later meanings until round-trip, rollback, and unknown-version tests pass.
- R7/R8 precede the shared writer in R9; R16 precedes staged verdicts in R17; R20 freezes the semantic schema before R21–R25.
- R28/R29 depend on the approved benchmark v1.0 and the 24-task outline; R30–R33 keep cold, warm, live, and final-report qualification in independently revertable packages.
- Each package has a focused failure-first test cycle, an independently revertable boundary, and a named acceptance gate.
- No product code, fixture, credential, or paid collection is created by this planning document.
