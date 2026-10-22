# ADR-0018 — The operator's file ships from template, and is not part of the canonical shape

- **Date:** 2026-09-15
- **Status:** accepted
- **Area:** project shape, the kit's operator-facing surface

## Context

A11 fixed what an agent does when it starts in the wrong directory (ADR-0017). The same
round exposed the operator's half of the confusion: he could not say where files land, or
what "start research" means as an action. The kit's text is written for agents —
`AGENTS.md`, `skill/SKILL.md`, the two-machine tables in the READMEs — and the one
human-facing file, `START_HERE.md`, lived in this repository only and was never scaffolded.
So a project the operator opened had nothing addressed to him: 250 lines of instructions
for the AI, and a guess about where the kit's own copy was installed.

The gap is not missing capability. Every question the file answers already has an answer
somewhere: `doctor` prints where the kit is, `audit.mjs` writes the snapshots, the resume
block is in the repository's own `START_HERE.md`. What was missing is one page, in the
place the operator is standing, that says them in his language.

## Decision

**`fetchproof/START_HERE.md`, and the same file at `fetchproof/template/START_HERE.md`
so every scaffolded project ships one.** Table-first, plain language, no protocol
vocabulary: where things are (the kit's install path, `research/`, `research/audits/`),
the three lines of starting research — open the project folder, say what to research, run
`audit.mjs` when it is finished — the four-command resume block, and one line on credits.

It is the short human-readable twin of `AGENTS.md`, with the same relationship to it that
`bin/audit.mjs` has to the five working files: one frozen answer to a question a reader
asks repeatedly, rather than a second source of rules. `AGENTS.md` is untouched by this
ADR — a file addressed to a person must not dilute the one addressed to the agent.

The two copies differ in exactly one respect: how the kit path is spelled. The template
says `{{KIT}}`, substituted at scaffold time; the kit's own copy says
`~/.agents/fetchproof`, because that is where the deployed copy is read. Everything else
is byte-identical, and deploy copies both (`install.mjs` ships the source tree).

## Consequences

- Every project scaffolded from now on has a page addressed to the person who owns it, in
  the folder he is already in, and it names the one path he kept losing.
- The kit's own copy is readable at `~/.agents/fetchproof/START_HERE.md` — the place he
  arrives at when he goes looking for the kit itself.
- The file carries no protocol vocabulary, so it cannot drift out of step with `CONTEXT.md`
  by re-defining a term; it can only drift on a path, and there is one path in it.
- Both copies must be edited together. The duplication is the cost of shipping one into
  every project while keeping a readable one in the installed kit; the alternative — a
  generator — was rejected below.
- The file is not required by any rule, so it is not in `LAYOUT`, and a project without it
  reports nothing. That is deliberate and is the main thing this ADR records.

## Rejected alternatives

- **Adding `START_HERE.md` to `LAYOUT`.** Then it would be part of the canonical shape:
  scaffolded, repaired, and reported by `validateProject` and doctor when missing.
  Rejected: `LAYOUT` holds the structure a *rule* needs — `docs/ARCHITECTURE.md` is an
  entry because the same-commit rule (ADR-0007) is meaningless without the file. Nothing
  needs `START_HERE.md` to exist: it gates nothing, no check reads it, and no command
  writes it. Making it required would have every project scaffolded before today — this
  repository included — report a missing artifact for a file that is a convenience, which
  is how a diagnostic stops being read.
- **Generating it (`bin/start-here.mjs`).** Rejected: the file is a fixed answer, and a
  generator needs a reason to differ per project. The only thing that varies is the kit
  path, which `{{KIT}}` already substitutes at scaffold time — so a command would add a
  third copy of a sentence doctor already prints.
- **Folding it into `fetchproof/README.md`.** Rejected as the wrong reader in the wrong
  place: the README is the manual for whoever installs the kit, and it is not in the
  project the operator opens. This file has to be inside his project, beside `AGENTS.md`.
- **Writing it in the kit's own vocabulary, with cross-references to `CONTEXT.md`.**
  Rejected because the vocabulary *is* the barrier — a page that says "the corpus" and
  "the ledger" answers nobody who asked where his files went. For the same reason no
  `CONTEXT.md` term was added for it: a glossary entry would pull the file's language back
  toward the protocol it exists to translate.
