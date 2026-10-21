# ADR-0084 — A project records how it spells the kit, and later files reuse it

- **Date:** 2026-09-28
- **Status:** accepted
- **Area:** `template/research/kit.json` (`kitPath`), `lib/core.mjs` (`projectKitPath`, `documentCommand`), `lib/brief.mjs`, `lib/timeline.mjs`

## Context

`new-project --kit` sets how a project's files spell the kit. A project that travels passes
`'$HOME/.agents/fetchproof'`, and every scaffolded file used that spelling (ADR-0050).
Files written *later* ignored the choice. `brief.mjs` and `timeline.mjs` spell their
commands with `documentCommand` (ADR-0051), which looks at the *running* kit: `$HOME` when
it is the standard install, its real path otherwise.

On 2026-09-28 the kit ran from a repository checkout to research MoonAliza's open gaps. The
project was scaffolded with the `$HOME` spelling, but the drafted `BRIEF.md` said
`node /home/user/Fetchproof/fetchproof/bin/brief.mjs`. That path exists only in that
container, and the brief is the one file phase 2 must read. It was corrected by hand
before the commit.

## Decision

- **Recording:** the scaffold writes the spelling into `research/kit.json` as `kitPath`,
  from the same `{{KIT}}` token as every other scaffolded file.
- **Reuse:** `documentCommand` takes the project root and prefers that recorded spelling,
  written as the templates write it: `node "<kitPath>/bin/<script>"`.
- **Fallback:** a project without `kitPath`, or with a value that cannot be quoted safely
  (a newline or a double quote), falls back to the running kit, exactly as before. That
  covers every project scaffolded before this ADR.

## Rejected alternatives

- **Read the spelling back out of the scaffolded `AGENTS.md` or `DISCOVERY.md`.** That
  makes a sentence of prose load-bearing (the same objection as ADR-0014), and an operator
  editing their own AGENTS.md would silently change what the brief prints.
- **Always write `$HOME/.agents/fetchproof` into project files.** On a machine where the
  kit lives elsewhere and the project never travels, the brief would name a path that does
  not exist there. The operator's `--kit` choice is the only thing that knows which case
  applies.
- **Leave it, and document "edit the brief's command by hand".** The brief is the handoff.
  A command that fails on the builder's machine is the defect, and this one was found in
  real use.
