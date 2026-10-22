# R1 platform-neutral machineFixture and gitFixture contract tests

**Status:** draft contract-test packet; no production implementation is included

**Scope:** disposable machine state, profile/path authority, Git global/local/system
configuration isolation, containment, snapshots, subprocess inheritance, and cleanup

**Out of scope:** changing `fetchproof/lib/**`, changing installer/doctor behavior,
real profile or Git state, network access, credentials, paid research credits, and
creating benchmark fixtures.

The existing fixture helpers are the implementation seam under review:
`fetchproof/test/machine-fixture.mjs` and
`fetchproof/test/machine-fixture.test.mjs`. This packet defines the portable
contract those helpers must satisfy before R1 production work resumes.

## Safety and portability rules

1. Every test creates one `machineFixture()` and runs all child commands with the
   environment returned by `machine.env()`. No test reads `os.homedir()`, the
   operator's Git config, or an ambient `HOME`/`USERPROFILE` value as an authority.
2. Every path assertion uses `path.resolve`, `path.relative`, and the host path
   module. Test data contains no hard-coded drive letters, slash direction, or
   Windows-only profile names.
3. A path is safe only when its existing ancestor resolves inside the fixture root
   and does not pass through a symlink/junction/reparse point to `outsideRoot`.
   A missing ancestor is rejected; a path under a contained existing directory is
   allowed only when the contract explicitly says it is a prospective write.
4. Git reads and writes use `gitFixture.runGit(args, options)`, which injects the
   fixture environment. Direct `execFileSync('git', ...)` calls are forbidden in
   contract tests unless they pass the same environment and cwd explicitly.
5. Assertions compare normalized semantic paths, while snapshots retain the
   original platform path in a `path` field and a `/`-normalized `portablePath`
   field. Byte hashes are lowercase SHA-256.
6. Every test records `process.platform`, `process.arch`, Node version, Git version,
   fixture root, project cwd, and an input/output snapshot hash. A failure without
   cwd and snapshot context is not reviewable.
7. Tests are offline and credit-free. A command attempting a network transport,
   credential path, or paid operation is a hard failure, not a skip.

## Fixture interfaces

### `machineFixture(options)`

The draft contract is:

```text
machineFixture({ role = "collector", projectMarkers = true }) -> MachineFixture
```

`MachineFixture` exposes these values, all rooted below one disposable `root`:

| Value | Required meaning |
|---|---|
| `root` | Disposable machine root; the only permitted machine-state ancestor |
| `outsideRoot` | Separate disposable directory containing an untouched sentinel |
| `home`, `userProfile` | Profile authorities, both inside `root` |
| `homeDrive`, `homePath` | Host-derived profile components for Windows-compatible consumers |
| `agentsDir`, `kitHome` | Personal agent and kit roots inside `home` |
| `configPath`, `statePath`, `settingsPath` | Config, install-state, and edit-gate files inside `root` |
| `globalGitConfig`, `systemGitConfig` | Isolated Git config files inside `root` |
| `projectRoot` | Disposable repository/project root inside `root` |
| `env()` | Fresh child-process environment with all supported authorities replaced |
| `snapshot()` | Deterministically sorted file/symlink inventory plus outside sentinel |
| `assertContained(candidate)` | Resolve, no-follow-check, and reject unsafe paths |
| `cleanup()` | Remove only `root`; safe to call once in teardown |
| `cleanupOutside()` | Remove only `outsideRoot`; safe to call once in teardown |

The environment must replace `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`,
`FETCHPROOF_HOME`, `FETCHPROOF_CONFIG`, `FETCHPROOF_INSTALL_STATE`,
`FETCHPROOF_EDIT_GATE_SETTINGS`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`,
`GIT_CONFIG_NOSYSTEM`, and `CLAUDE_SETTINGS_PATH`. The parent process environment
must be unchanged before and after each test.

### `gitFixture(machine, options)`

The draft contract is:

```text
gitFixture(machine, { localHooksPath = "", globalHooksPath = "" }) -> GitFixture
```

`GitFixture` must initialize `machine.projectRoot` as a repository using the
fixture environment and expose:

| Value | Required meaning |
|---|---|
| `repoRoot` | Same path as `machine.projectRoot` |
| `localConfig` | `<repoRoot>/.git/config`, contained by `machine.root` |
| `before` | Snapshot captured after initialization/configuration |
| `after` | Fresh snapshot getter; never a cached value |
| `runGit(args, options)` | Git subprocess with fixture cwd/env and deterministic missing-key behavior |
| `cleanup()` | Removes only the disposable repository root |

The fixture sets local identity values and disables system config through the
fixture environment. Optional global/local `core.hooksPath` values are explicit
test inputs; a local value must not be silently overwritten by a global install.

## Contract-test matrix

Each row is an independent test with a stable ID. The implementation may use the
Node test runner or another runner, but these names, inputs, and hard outcomes are
normative.

### Machine containment and lifecycle

| ID | Test input | Required assertion | Hard failure |
|---|---|---|---|
| MF-01 | Every declared machine path | `assertContained` accepts all paths and every resolved path is below `root` | Any declared path escapes or is missing |
| MF-02 | Absolute path from a separate temp directory | Assert throws before any write | External path is accepted or snapshot changes |
| MF-03 | `path.join(root, "..", "escape")` | Assert throws; before/after snapshots are identical | Traversal is accepted or mutation occurs |
| MF-04 | Path with a missing ancestor under `root` | Assert throws with a missing-ancestor reason | Helper guesses or creates an ancestor |
| MF-05 | Link/reparse path from `root/project-link` to `outsideRoot` | If the host can create a link, assert the outside target is rejected and sentinel is unchanged | Link escape is accepted or sentinel changes |
| MF-06 | Host without link capability | Record explicit capability `unsupported`; run the non-link traversal case and require MF-02/MF-03/MF-04 to pass | Link test is silently skipped or treated as PASS without capability evidence |
| MF-07 | `machine.snapshot()` twice without mutation | Deep equality and deterministic path ordering | Snapshot changes between reads |
| MF-08 | Create, modify, remove a contained file | Snapshot records type, byte length, and SHA-256 transitions | Hash/length/type is missing or stale |
| MF-09 | `machine.cleanup()` followed by sentinel read | `root` is gone; `outsideRoot/sentinel` bytes are unchanged | Cleanup deletes outside state or leaves root |
| MF-10 | Call cleanup in a `finally` block after an assertion failure | Cleanup remains bounded to the two fixture roots | Teardown touches a host path or masks the original failure |
| MF-11 | Capture parent environment before/after `machine.env()` | Deep equality; only child env is changed | Parent process variables are mutated |

### Machine authority and subprocess inheritance

| ID | Test input | Required assertion | Hard failure |
|---|---|---|---|
| MF-12 | `machine.env()` authority map | Every supported profile/config/Git key points inside the fixture, and `GIT_CONFIG_NOSYSTEM=1` | Any key is absent, host-derived, or outside root |
| MF-13 | Child process prints the selected authority variables | Printed values equal `machine.env()` values, not the parent process | Child inherits a real profile/config value |
| MF-14 | `role="collector"`, `role="builder"`, invalid role, and missing role | The role input is passed only through the fixture environment; no test changes production defaults | Role leaks between fixtures or invalid role authorizes collection |
| MF-15 | Two fixtures alive concurrently | Their roots, env maps, snapshots, and project cwd values are pairwise distinct | Cross-fixture state or environment is shared |
| MF-16 | Hostile argv containing spaces, quotes, Unicode, `..`, and leading `-` | Child receives exact argv vector; no shell interpolation | Argument splitting, option injection, or shell execution occurs |

### Git authority and origin

| ID | Test input | Required assertion | Hard failure |
|---|---|---|---|
| GF-01 | `gitFixture(machine)` | Repository initializes in `projectRoot`; local config and all Git files are contained | Git writes outside fixture root |
| GF-02 | Global hooks path under `machine.kitHome` | `git config --global --get core.hooksPath` returns normalized fixture path | Host global value wins or output points outside |
| GF-03 | `git config --global --show-origin --get core.hooksPath` | Parsed origin names `machine.globalGitConfig`; path normalization is platform-neutral | Origin is host config, system config, or ambiguous |
| GF-04 | `git config --system --get core.hooksPath` with `GIT_CONFIG_NOSYSTEM=1` | Empty result and no system-file read/write | System config is consulted or mutated |
| GF-05 | Local hooks path under `outsideRoot` | Local value remains unchanged; installer/diagnostic contract reports conflict rather than replacing it | Local config is overwritten or outside path is used silently |
| GF-06 | Unqualified Git read through injected env | `readHooksPath({ env: machine.env() })` resolves fixture global/local precedence | Read resolves the operator's global config |
| GF-07 | Global and local values set simultaneously | Local value wins for repository-local read; global value remains in isolated global file | Precedence differs by platform or read path |
| GF-08 | Missing `--get` key and an invalid Git command | Missing key returns documented empty result; invalid command throws with exit/status evidence | Missing and invalid cases are conflated |
| GF-09 | `gitFixture.before` and `gitFixture.after` around a read-only command | Snapshots remain byte-identical | A read-only query mutates config, hooks, or project files |
| GF-10 | Re-run `gitFixture` initialization in the same disposable repository only when explicitly requested | Second initialization is either an explicit deterministic refusal or a documented idempotent no-op | Partial reinitialization changes unrelated state |
| GF-11 | Git origin output with spaces and platform-specific separators | Parser handles quoted `file:` origins and normalizes only for comparison | Origin parsing truncates or misidentifies a path |
| GF-12 | Child Git command with fixture cwd/env and hostile argv | Effective cwd is `repoRoot`, config origins remain fixture paths, and argv is exact | Git consults a host authority or shell-expands argv |

## Shared test oracle

Every test returns an evidence record with this shape:

```json
{
  "testId": "GF-03",
  "status": "PASS",
  "platform": "win32",
  "arch": "x64",
  "node": "vX.Y.Z",
  "git": "git version X.Y.Z",
  "cwd": "<fixture projectRoot>",
  "root": "<fixture root>",
  "beforeSnapshotSha256": "<lowercase sha256>",
  "afterSnapshotSha256": "<lowercase sha256>",
  "authorities": {
    "global": "<normalized fixture path>",
    "local": "<normalized fixture path or empty>",
    "system": "suppressed"
  },
  "externalWrites": [],
  "notes": ""
}
```

`status` is limited to `PASS`, `FAIL`, or `INCOMPLETE`. `INCOMPLETE` is allowed
only for an explicitly recorded host capability such as unavailable symlink
creation; it cannot be used for a failed assertion, missing cwd, missing snapshot
hash, or an unverified authority.

## Release and migration gates

| Gate | Entry condition | Evidence required | Stop condition |
|---|---|---|---|
| R1-G0 harness safety | MF-01..MF-11 pass on the target host | Parent-env hash, fixture roots, cleanup proof, capability record | Any host path touched or teardown ambiguity |
| R1-G1 authority isolation | MF-12..MF-16 and GF-01..GF-06 pass | Authority map, Git origin records, child-env capture, cwd | Any real profile/system/global config observed |
| R1-G2 precedence | GF-07, GF-11, and path-precedence compatibility cases pass | Local/global/system resolution table and normalized origins | A lower-precedence source overrides an explicit source |
| R1-G3 no-op purity | GF-09 plus installer/doctor dry-run consumers pass | Before/after snapshot hashes and outside sentinel hash | Any unrelated file, config, or sentinel changes |
| R1-G4 hostile input | MF-02..MF-06, MF-16, GF-05, GF-08, GF-12 pass | Rejected path/argv evidence and retained forensic snapshot | Unsafe path, symlink escape, or option injection is accepted |
| R1-G5 portability | All non-capability rows pass on Windows, macOS, and Linux; link capability is explicit | Matrix by OS/arch/Node/Git and per-row evidence | Platform-specific assertion or silent skip |

R1 is not releasable when any gate is `FAIL` or when a required evidence field is
missing. A red result must include the exact fixture cwd before any subsequent
production implementation work resumes.

## Draft execution order (no production edits)

1. Freeze the interface and evidence record above in review.
2. Add only contract-test cases MF-01..MF-16 and GF-01..GF-12 to the test lane,
   using the existing fixture seam; do not edit production modules.
3. Run the matrix on each supported host and record capability-based outcomes.
4. Review failures as containment defects, not as flaky-test noise; retain the
   fixture snapshot and exact cwd for each failure.
5. Approve R1-G0 through R1-G5 before any implementation package changes machine
   path resolution, Git configuration, installer, hook, or doctor behavior.

This is a test contract and review packet only. It intentionally leaves the
production implementation untouched.
