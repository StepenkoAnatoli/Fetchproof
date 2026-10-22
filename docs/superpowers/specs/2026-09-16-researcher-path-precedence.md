# Researcher path and Git-origin precedence

**Status:** normative reference and test contract  
**Applies to:** machine paths, installer APIs/CLIs, runtime settings, and Git hook discovery  
**Tests:** `fetchproof/test/path-precedence.test.mjs`
**Release evidence packet:** [`2026-09-16-researcher-git-origin-path-authority-evidence-snapshots.md`](./2026-09-16-researcher-git-origin-path-authority-evidence-snapshots.md)

This policy defines which authority wins when an explicit path, Windows profile variable, machine configuration, or Git configuration origin supplies the same setting. A higher-precedence value is never silently replaced by a lower-precedence value.

## Precedence order

### Kit and runtime paths

For a path accepted as an explicit API/CLI argument, precedence is:

1. **Explicit argument** (`settingsPath`, `gitConfigPath`, `statePath`, `configPath`, `kitDir`, or equivalent).
2. **Purpose-specific environment variable** (`FETCHPROOF_EDIT_GATE_SETTINGS`, `FETCHPROOF_CONFIG`, `FETCHPROOF_INSTALL_STATE`, `FETCHPROOF_HOME`).
3. **Machine configuration file** values (`editGate.settingsPath`, `skillRoots`, `projectSkillDir`, and other declared keys).
4. **The operating system's profile authority** returned by `os.homedir()` when expanding `~` or deriving the default `.agents` location. On Windows, the runtime may consult `USERPROFILE`, `HOMEDRIVE` + `HOMEPATH`, or `HOME`; the kit does not reimplement or monkey-patch that platform resolution.
5. **Compiled/runtime anchors and current production defaults.**

The explicit argument is evaluated by the function that receives it; it wins even when an environment variable or machine config points elsewhere. `runtimePaths(file)` treats `file` as the explicit machine-config source, then applies `FETCHPROOF_EDIT_GATE_SETTINGS` over that file’s `editGate.settingsPath`, then the runtime anchor. A blank or malformed optional machine-config value falls through to the next lower authority and is reported as such.

`FETCHPROOF_HOME` selects the machine's `.agents` root and therefore outranks the OS-derived Windows profile result, regardless of which profile variables produced it. It must not be inferred from a stale profile variable after the explicit environment override is present. Production code must not monkey-patch `os.homedir()` or mutate the parent process environment to achieve this precedence. A child-process test that cannot control the OS profile API with `HOMEDRIVE`/`HOMEPATH` or `HOME` is recorded as `INCOMPLETE` for those lower-level authorities, not treated as evidence that the kit reordered them.

### Git configuration origins

There are two distinct reads:

| Operation | Precedence |
|---|---|
| Installer read/write of the machine-wide hook value | Explicit `gitConfigPath` passed as `git config --file` > `GIT_CONFIG_GLOBAL` for the child process > Git’s user-global file derived from the profile; system and repository-local origins are not consulted by this isolated operation. |
| Effective hook value for a repository (`readHooksPathAt(cwd)`) | Repository-local > global > system. `GIT_CONFIG_NOSYSTEM=1` removes the system tier. |
| Explicit global-file read (`readHooksPath({ gitConfigPath })`) | The explicit file only; it must not be affected by local, global, or system origin values. |

The local value is an override, not an installer target: installation must never overwrite repository-local `core.hooksPath`. `git config --show-origin` evidence must identify the file that supplied each global/local/system value. A system value must never leak into an isolated test when `GIT_CONFIG_NOSYSTEM=1` is set.

## Required test assertions

- [ ] Explicit API paths beat environment, machine config, profile variables, and defaults for settings, install state, Git config, and kit directory.
- [ ] `FETCHPROOF_EDIT_GATE_SETTINGS` beats `editGate.settingsPath`; removing it restores the config value; removing that restores the runtime anchor.
- [ ] `FETCHPROOF_HOME` beats the OS-derived Windows profile result (including any `USERPROFILE`, `HOMEDRIVE`/`HOMEPATH`, or `HOME` inputs) when deriving machine paths.
- [ ] Child processes receive the complete isolated profile/config environment and no host value for the keys under test.
- [ ] Effective Git resolution is local > global > system; `GIT_CONFIG_NOSYSTEM=1` suppresses system; explicit `--file` reads only its file.
- [ ] Installer writes land in the explicit or `GIT_CONFIG_GLOBAL` global file and state path; repository-local hooks remain unchanged.
- [ ] Every test restores process environment and removes only its disposable directories.

## Failure interpretation

| Result | Meaning |
|---|---|
| `PASS` | The observed value comes from the highest applicable authority and the origin/evidence agrees. |
| `FAIL` | A lower authority wins, a local override is overwritten, or an origin cannot be proven. |
| `INCOMPLETE` | The test could not establish the origin (for example, Git is unavailable or a profile variable is not controllable); it is not a pass. |

Any failure that changes a host profile, host Git config, system config, repository-local config, or runtime settings file is a containment incident and stops the suite. The failure report records the test cwd, the exact authority values, and a before/after snapshot of every disposable and external-sentinel path.
