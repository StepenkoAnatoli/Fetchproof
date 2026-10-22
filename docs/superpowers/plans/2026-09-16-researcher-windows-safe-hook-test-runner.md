# Windows-safe hook test runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define a platform-neutral hook runner that executes direct programs and explicit shell routes inside the R1 disposable machine/Git fixture, while making unavailable shells an explicit blocking evidence outcome.

**Architecture:** The runner is a test-only adapter with a small invocation planner, capability probes, and a containment/evidence recorder. It always launches through Node's process API with `shell: false`; a Windows `.cmd`/`.bat` route names `ComSpec` as the program and passes `/d`, `/s`, `/c`, the full shim path, and each argument as separate argv elements. The runner never concatenates a command string, mutates the parent environment, or treats an unavailable shell as a pass.

**Tech Stack:** Node.js built-in test runner, `child_process.spawnSync`/`spawn`, `fs`, `path`, `crypto`, existing `machineFixture`/`gitFixture`, and JSONL evidence. No third-party shell, network, or credential dependency.

**Spec:** `docs/superpowers/specs/2026-09-16-researcher-r1-machine-git-fixture-contract-tests.md`

## Global Constraints

- Every process receives `machine.env()` and `cwd: machine.projectRoot`; the parent environment is never patched.
- Every write, temporary file, hook target, config path, and evidence output is below the fixture root; the outside sentinel is read-only.
- Every launch has `shell: false`, `windowsHide: true`, and an argv array; `windowsVerbatimArguments` is absent.
- Only a full-path `cmd.exe` invocation may interpret a `.cmd`/`.bat` shim on Windows; shell metacharacters are refused before spawn.
- A required but unavailable shell produces `UNSUPPORTED_SHELL` with a blocking error code and nonzero process exit; it is never silently skipped or downgraded to `PASS`.
- The runner is offline, credit-free, and must not read or write the operator's profile, global/system Git config, credentials, or network.
- Every result records exact fixture cwd, platform/architecture/runtime versions, before/after snapshot hashes, shell capability, child cleanup, and external-write findings.

---

## Runner contract

### CLI

The eventual test-only command is:

```text
node fetchproof/test/run-hook-contract.mjs --case <case-id> [--case <case-id> ...] [--json] [--evidence <path>]
```

With no `--case`, it runs the complete matrix. `--evidence` must resolve below
the disposable root (or an explicitly approved release-evidence root) and is
written atomically. No output path may be inferred from the operator profile.

### Invocation planner

The planner consumes:

```text
planHook({ program, args, cwd, env, platform, requiredShell }) -> InvocationPlan
```

and returns:

```text
{
  route: "direct" | "windows-cmd" | "posix-sh",
  program: absolute executable path,
  args: string[],
  interpreter: null | { name: "cmd.exe" | "sh", path: absolute path },
  shell: false,
  capability: "available" | "unsupported",
  refusal: null | { code, reason }
}
```

Rules:

1. A direct executable (`.exe`, `.com`, Node, or a POSIX executable) is passed
   directly with `shell: false` and no shell-character validation.
2. On Windows, a `.cmd`/`.bat` is resolved to a full path and launched only as
   `[ComSpec, "/d", "/s", "/c", fullShimPath, ...args]`. `ComSpec`/`COMSPEC`
   must be an existing file whose basename is `cmd.exe`; the route is refused
   if the path is absent or untrusted.
3. Before the Windows interpreter route, every argument (including the shim
   path) must pass the existing CMD-safe policy. Empty values, `%`, `&`, `|`,
   `<`, `>`, `^`, parentheses, quotes, CR, LF, and tabs are refused. Refusal is
   `FAIL` with `HOOK-CMD-UNSAFE-ARGV` and no child is spawned.
4. On POSIX, a shell-script case requires an explicit `sh` capability probe and
   uses `[shPath, scriptPath, ...args]` with `shell: false`. A missing/failed
   probe is `UNSUPPORTED_SHELL`, not a fallback to a guessed shell.
5. The planner never passes a rendered display string to a process API and
   never sets `shell: true`.

### Shell capability probe

`probeShell({ kind, env, platform })` returns:

```text
{
  status: "available" | "unsupported",
  kind: "cmd.exe" | "sh",
  path: absolute path | null,
  probeArgv: string[],
  exitCode: number | null,
  stderr: string,
  reasonCode: null | "SHELL-NOT-FOUND" | "SHELL-NOT-FILE" | "SHELL-PROBE-FAILED" | "SHELL-POLICY-DENIED"
}
```

The probe itself uses the fixture environment, a contained temporary cwd, an
argv array, `shell: false`, and `windowsHide: true`. Its stdout/stderr is
redacted for secrets and retained in the evidence record. `UNSUPPORTED_SHELL`
is emitted when a required probe is unavailable; no alternate shell is tried
unless the matrix row explicitly names that alternate route.

### Evidence result

Each case emits one JSON object with this required shape:

```json
{
  "runnerVersion": "1.0",
  "testId": "HR-03",
  "status": "PASS",
  "blocking": false,
  "failureCode": null,
  "platform": "win32",
  "arch": "x64",
  "node": "exact process.version",
  "git": "exact git --version result",
  "cwd": "absolute fixture projectRoot",
  "fixtureRoot": "absolute disposable root",
  "route": "windows-cmd",
  "program": "absolute ComSpec path",
  "argvSha256": "lowercase SHA-256 of canonical argv",
  "shell": { "required": true, "kind": "cmd.exe", "status": "available", "path": "...", "reasonCode": null },
  "beforeSnapshotSha256": "lowercase SHA-256",
  "afterSnapshotSha256": "lowercase SHA-256",
  "externalWrites": [],
  "child": { "pid": 0, "exitCode": 0, "timedOut": false, "treeTerminated": true },
  "stdoutSha256": "lowercase SHA-256",
  "stderrSha256": "lowercase SHA-256",
  "notes": ""
}
```

For an unsupported shell, the normative shape is:

```json
{
  "status": "UNSUPPORTED_SHELL",
  "blocking": true,
  "failureCode": "HOOK-SHELL-UNAVAILABLE",
  "shell": { "required": true, "status": "unsupported", "reasonCode": "SHELL-NOT-FOUND" },
  "externalWrites": [],
  "child": { "pid": null, "exitCode": null, "timedOut": false, "treeTerminated": true }
}
```

The exact probe reason must be retained. `UNSUPPORTED_SHELL` blocks R1 release
qualification but is reported separately from a product assertion `FAIL`.

## Hook contract-test matrix

These cases are test drafts, not implementation work. IDs, routes, and hard
outcomes are normative.

| ID | Route/input | Required assertions | Hard outcome |
|---|---|---|---|
| HR-01 | Direct Node executable with benign argv | `shell:false`; argv and cwd are exact; fixture env is inherited | `FAIL` on shell use, argv split, or host cwd |
| HR-02 | Windows `.exe` with spaces, Unicode, and metacharacters as data | `.exe` selected before shim; no interpreter; exact argv bytes | `FAIL` on `.cmd` fallback or data mutation |
| HR-03 | Windows `.cmd` shim with safe arguments | Full `ComSpec` path, `/d /s /c`, shim path and args are separate; probe evidence retained | `FAIL` on concatenation or shell flag; `UNSUPPORTED_SHELL` if ComSpec probe fails |
| HR-04 | Windows `.bat` shim with safe arguments | Same as HR-03, with `.bat` route recorded | Same as HR-03 |
| HR-05 | POSIX `sh` hook script | Explicit `sh` path, `shell:false`, exact argv, fixture cwd | `FAIL` on guessed shell or host environment |
| HR-06 | Required shell path absent/non-file | No child spawn; before/after snapshots equal; reason code recorded | `UNSUPPORTED_SHELL` and nonzero runner exit |
| HR-07 | Required shell probe exits nonzero | Probe stderr/hash retained; no hook execution | `UNSUPPORTED_SHELL` and nonzero runner exit |
| HR-08 | Direct route hostile argv (`$(...)`, backticks, `%`, `&`, newline, empty) | Every value reaches child as one argv element; no marker file/process | `FAIL` on shell interpretation or mutation |
| HR-09 | Windows shim hostile argv | Unsafe values rejected before spawn; no marker file/process; refusal is evidenced | `FAIL` if any child starts; otherwise `PASS` for the refusal row |
| HR-10 | Hook child sleeps beyond timeout and spawns a descendant | Parent and descendants terminate; no listeners/processes or fixture writes survive | `FAIL` on leaked process/listener; timeout is a named result |
| HR-11 | Hook writes only to fixture path | Before/after snapshot records expected contained change; outside sentinel unchanged | `FAIL` on outside write or missing snapshot delta |
| HR-12 | Hook attempts an outside absolute/traversal/symlink path | `assertContained` rejects before write; forensic snapshot retained | `FAIL` if write occurs or rejection is unrecorded |
| HR-13 | Git pre-commit hook with staged safe change | Git cwd/config origins are fixture paths; hook exit status propagates; no host state | `FAIL` on host Git read/write or status mismatch |
| HR-14 | Repository-local `core.hooksPath` conflict | Local value is preserved and reported; global fixture value is not silently used | `FAIL` on overwrite or ambiguous origin |
| HR-15 | Direct hook command with `ComSpec`/PATH hostile values | Runtime lookup uses explicit fixture PATH and allowlisted interpreter only | `FAIL` on PATH escape or shell string execution |
| HR-16 | Runner itself is invoked from a path containing spaces/Unicode | `cwd`, script path, and argv remain exact; evidence paths stay contained | `FAIL` on quoting/splitting or host-path leakage |

## Windows process and cleanup rules

- Use `spawn`/`spawnSync` with an array and `shell:false` for every route.
- Set `windowsHide:true`; never open a visible console window for a test child.
- On timeout, call `child.kill()` first. If a process tree remains, use an
  explicitly allowlisted `taskkill.exe /PID <childPid> /T /F` invocation with
  `shell:false`, recording its argv and result. Never issue a broad PID or image
  kill.
- Record child PID, descendant termination result, timeout, and post-run process
  probe. A cleanup failure is `FAIL` even when the hook exit code was zero.
- Teardown always removes only `machine.root` and then verifies the
  `outsideRoot/sentinel` hash. Cleanup errors cannot replace the original case
  result; both are retained.

## R1 acceptance gates

| Gate | Evidence | PASS condition | Blocking result |
|---|---|---|---|
| HR-G0 launch safety | Per-case invocation plan and argv hash | Zero launches with `shell:true`; all routes use arrays | Any shell-string launch |
| HR-G1 containment | Before/after snapshots, attempted paths, sentinel hash | No host/profile/Git/system writes; all writes contained | External write or missing containment proof |
| HR-G2 shell capability | Probe records for every required shell | Available shells pass; unavailable shells are explicit blocking `UNSUPPORTED_SHELL` | Silent skip, fallback, or missing probe |
| HR-G3 Windows shim safety | HR-03/04/09 evidence | Safe argv reaches cmd; hostile argv refuses before spawn | Metacharacter reaches interpreter or argv is concatenated |
| HR-G4 child cleanup | PID/tree/timeout evidence | No child, descendant, listener, or temp file survives | Cleanup leak or ambiguous timeout |
| HR-G5 Git origin | HR-13/14 origin records | Local/global/system resolution is fixture-only and precedence is proven | Host origin or overwritten local setting |
| HR-G6 portability | OS/arch/Node/Git matrix | All applicable rows pass; unsupported rows are named and block promotion | Platform-specific assumptions or unrecorded unsupported shell |

R1 promotion requires every applicable row to be `PASS`, zero blocking
`UNSUPPORTED_SHELL` records, and no missing evidence. A host that cannot provide
the required shell is not falsely green; the release report says exactly which
shell, probe, platform, and cwd prevented qualification.

## Future implementation tasks (not executed in this draft)

### Task 1: Freeze runner and evidence interfaces

**Files:** Create `fetchproof/test/hook-runner.mjs`; test `fetchproof/test/hook-runner-contract.test.mjs`; update `docs/ARCHITECTURE.md` and add an ADR if a rejected shell strategy is recorded.

- [ ] Add unit cases for invocation planning, CMD-safe refusal, capability result reduction, and deterministic evidence serialization.
- [ ] Verify no production module is imported for side effects and no parent environment mutation occurs.
- [ ] Stop if the evidence shape or status precedence differs from this packet.

### Task 2: Add disposable hook cases

**Files:** Extend `fetchproof/test/machine-fixture.mjs` only if the frozen contract requires a new contained path; add `fetchproof/test/hook-runner-contract.test.mjs` cases HR-01–HR-16.

- [ ] Run every case through `machineFixture`/`gitFixture` with exact cwd and injected environment.
- [ ] Add capability probes and unsupported-shell evidence; do not skip silently.
- [ ] Verify outside sentinel and snapshot hashes for pass, refusal, timeout, and unsupported outcomes.

### Task 3: Wire the R1 release gate

**Files:** Add an offline matrix entry under `fetchproof/test/`; update the R1 release evidence specification and architecture map.

- [ ] Require HR-G0–HR-G6 before hook/installer qualification.
- [ ] Emit a deterministic JSONL evidence file and a summary whose exit status is nonzero for `FAIL` or blocking `UNSUPPORTED_SHELL`.
- [ ] Run the matrix twice per supported host, retaining cwd and runtime versions.

This plan intentionally specifies future test work only. It does not implement
the runner or change production code.
