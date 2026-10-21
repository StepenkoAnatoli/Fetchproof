# ADR-0050 — A command that runs the kit is quoted, and a project that travels spells it `$HOME`

- **Date:** 2026-09-27
- **Status:** accepted
- **Area:** scaffold, templates, the collector's packages
- **Evidence:** [`docs/decisions/2026-09-27-kit-path-spelling`](../decisions/2026-09-27-kit-path-spelling/research/BRIEF.md)

## Context

Every project the kit scaffolds tells its reader to run the kit, e.g. `node {{KIT}}/bin/doctor.mjs`.
`{{KIT}}` is this machine's absolute kit path, or, for a project that travels, whatever `--kit`
says. The Actions collector said `~/.agents/fetchproof`, so every remote package told its reader
`node ~/.agents/fetchproof/bin/doctor.mjs`. The operator reads those packages on Windows.

The corpus shows that spelling reaches node unexpanded in most Windows shells. On Windows,
PowerShell passes an unquoted `~` to a native command literally unless PSNativeWindowsTildeExpansion
is on. That feature is experimental in 7.5 and mainstream only from 7.6 (E-01 to E-03), and
Windows PowerShell 5.1 predates it. cmd has no `~` at all (E-08). The commands were also unquoted,
so a kit path with a space, common in Windows user names, split the command. Quoting a `~` does
not help: bash and zsh expand a tilde only when it is unquoted (E-06, E-13).

## Decision

1. **Every command that runs the kit double-quotes its path:** `node "{{KIT}}/bin/doctor.mjs"`.
   This covers the template files, the kit-root START_HERE.md and the skill. PowerShell requires
   quotes around an argument containing spaces (E-05, E-11), and bash and zsh would split an
   unquoted expansion.
2. **A project that travels spells the kit `$HOME/.agents/fetchproof`.** `collect.yml` passes
   it to `new-project --kit`. `"$HOME/.agents/fetchproof/bin/doctor.mjs"` reaches node as one
   absolute path:
   - in Windows PowerShell 5.1 and every PowerShell 7 (`$HOME` is USERPROFILE, and a double-quoted
     string expands its variables: E-04, E-05, E-10, E-11);
   - in bash and zsh (`$` expands inside double quotes: E-07, E-12);
   - with a space in the home folder, in all of them.

   A locally scaffolded project keeps its absolute path, now quoted.
3. **START_HERE says what cmd needs:** `%USERPROFILE%` where a command says `$HOME` (E-08, E-09).
   cmd expands neither `~` nor `$HOME`.
4. The kit-root START_HERE.md, the skill and `scaffoldProject`'s default use the same spelling.
   new-project's help shows `--kit '$HOME/.agents/fetchproof'`, single-quoted so the typing
   shell leaves it for the reader's shell.

## Rejected alternatives

- **Keep `~`.** It fails in Windows PowerShell 5.1, which Windows ships, in 7.4, and in 7.5
  unless an experimental feature is enabled (U-1). It also cannot be quoted against spaces
  (U-3).
- **`%USERPROFILE%` everywhere.** Only cmd expands it; PowerShell, bash and zsh would pass it
  literally.
- **A launcher on PATH** (a `fetchproof` command). That is a new installed artifact with its
  own failure modes, when quoting plus `$HOME` already reach every shell the kit's readers use.
- **One line per shell in every document.** That quadruples every command for a difference
  only cmd needs. START_HERE carries the one cmd line instead.

## Consequences

- Tests:
  - A travelling project's commands are run through the shell a reader would use: Windows
    PowerShell 5.1 on Windows, sh elsewhere. They start from a home folder with a space, and
    the test checks the file node receives.
  - A text test holds U-1 where no Windows PowerShell exists: no document spells the kit with a
    bare `~`, and `collect.yml` passes the `$HOME` spelling.
- Packages collected before this change still say `~`. They are corrected only by collecting
  again.

## Trigger that would reopen this

Windows PowerShell 5.1 ceasing to be the shell Windows ships, with every supported PowerShell
expanding `~` by default. Or the operator settling on cmd, which would make `%USERPROFILE%` the
primary spelling.
