# ADR-0051 — A command written into a project file is spelled for the machine that reads it

- **Date:** 2026-09-27
- **Status:** accepted
- **Area:** the brief, the timeline, `lib/core.mjs`
- **Extends:** ADR-0050 (a command that runs the kit is quoted, and a project that travels spells it `$HOME`)

## Context

The drafted brief and the regenerated timeline told their reader to run
`node fetchproof/bin/preflight.mjs`, `node bin/brief.mjs` and `node fetchproof/bin/timeline.mjs`.
Those paths exist only at the kit repository's root. From the project folder, where the files
are read, each command crashed with MODULE_NOT_FOUND. This was found on 2026-09-27 while reviewing
the package the collector returned from run 36300088606.

Terminal output was fixed the same day with `kitCommand`, which gives the running kit's absolute
path. That fix does not carry over to these files. The brief is the handoff to a builder, usually
on another machine, so a path from the machine that wrote it names nothing there.

## Decision

`documentCommand(script, args)` in `lib/core.mjs` spells every command written into a project
file:

- **The running kit is the standard install** (`<home>/.agents/fetchproof`, compared by real
  path): `node "$HOME/.agents/fetchproof/bin/<script>"`. ADR-0050 showed that this spelling
  reaches node whole in PowerShell, bash and zsh, including from a home folder with a space.
  It works on any machine with the documented install, which is where a brief is read.
- **Anywhere else**, such as a repository checkout: the kit's real path, quoted as
  `spellCommand` quotes it. `$HOME` would name an install this machine does not have.

## Rejected alternatives

- **The absolute path always** (`kitCommand`). It is right on the machine that wrote the file and
  wrong on the builder's machine, which the brief exists for.
- **`$HOME/.agents/fetchproof` always.** On a checkout with no standard install, every command
  in the file names nothing, including on the machine that wrote it.
- **Reading the spelling back from the project's scaffolded files.** That makes a sentence of the
  project's prose load-bearing, which ADR-0014 already declined for the brief's marker.

## Consequences

- A brief or timeline written from a checkout carries that checkout's path. The trigger below
  covers when this stops being acceptable.
- A test runs each command in the brief and the timeline from the project folder. Another holds
  both spellings.

## Trigger that would reopen this

A supported install location other than `<home>/.agents/fetchproof`, or briefs routinely
written from checkouts and read elsewhere.
