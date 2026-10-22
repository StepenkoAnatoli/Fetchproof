# ADR-0006 — The Cowork binding is the project's own skill directory

- **Date:** 2026-09-13
- **Status:** accepted
- **Area:** installer (`bin/install.mjs`), skill deployment, Cowork binding

## Context

The kit's skill has been deployed to two home-directory roots, mirrored "until the question
resolved" — that question was U-2, and it is now closed with evidence (E-04,
`code.claude.com/docs/en/skills`). The closed finding is brutal for the old layout:

| Root | What E-04 says about it |
|---|---|
| `~/.agents/skills/` | Not a discovery path in **any** runtime. A skill there loads nowhere, ever. |
| `~/.claude/skills/` | The documented personal root — read by local Claude sessions across all local projects, but **not** by Cowork or cloud sessions, routines included. A personal-only skill reports skill-not-found in a routine. |
| `<project>/.claude/skills/` | The one root Cowork *does* read, discovered from the start directory up to the repo root. |

So the installer was maintaining two copies of the skill, and the runtimes this project most
wants to bind — Cowork, cloud, routines — could see neither. The binding problem was never
"which home folder"; it was "the home folders are not on Cowork's path at all."

One mechanism could bind everywhere at once: a skill folder holding
`.claude-plugin/plugin.json` loads as a plugin named `<name>@skills-dir` and can bundle
agents, hooks, and MCP servers. That is the credible alternative, and it was considered
seriously — see Alternatives.

## Decision

**The project skill directory is the binding surface.** `install.mjs` gains
`--into <project-dir>`, which writes `<project>/.claude/skills/research-first/SKILL.md`.
The `~/.agents/skills/` mirror is deleted; `~/.claude/skills/` stays as the personal-root
deploy for local sessions.

Rules of the new flag:

- **A project is a checkout, not any directory.** `--into` refuses a path with none of
  `.git`, `AGENTS.md`, or `research/` in it. A typo must fail loudly, not scatter copies of
  the protocol across the filesystem.
- **One canonical kit behind every deployed skill.** The `{{KIT}}` template token still
  substitutes to the deployed `~/.agents/fetchproof` path, so a project skill points at
  the same deployed copy the personal skill does. Re-running `install.mjs` updates all of
  them; the idempotence, `--dry-run`, and `--skip-existing` behaviour are unchanged.
- **The project skill is knowledge, not enforcement.** A skill carries the research
  protocol as text; it ships no hooks. What that costs in runtimes where the gates do not
  reach is recorded below, in The Cowork gap — it is accepted there, with a named trigger
  for revisiting, not left implied.

## The Cowork gap

In Cowork, cloud sessions, and routines, **neither gate runs**.

| Gate | Why it is silent there |
|---|---|
| Commit gate (`githooks/pre-commit` via machine-wide `core.hooksPath`) | Machine-local by construction — it lives in one machine's git config. A cloud session never touches that machine's git; a routine may never run `git commit` at all. |
| Edit-time gate (`hooks/claude-pretooluse.mjs` via Claude Code `PreToolUse`) | Ships only with a plugin, and this decision ships no plugin. A project `.claude/skills/` binding carries skills, not hooks. |

What binds in those runtimes is the protocol as text: the `--into` skill, the project's
`AGENTS.md`, and `research/DISCOVERY.md`'s already-decided block. `skill/SKILL.md` says
this in as many words, because someone reading the skill in Cowork must not assume the
gate is watching.

### Is an unenforced protocol in Cowork acceptable?

Yes — deliberately, and with a named trigger for changing the answer.

Text binding delivers most of the protocol's value on its own: the core move — collect
primary evidence before designing — works whenever the model follows the skill, hook or
no hook. And the gates were never the only detector. Preflight is a pure function of
repository state, so an un-gated session cannot make the corpus lie *quietly*: the lie
surfaces the next time preflight or doctor runs. That catch-late path is not hypothetical —
this repo's pre-kit corruption (hand-written rows, a ledger that did not travel) was found
exactly that way, and the T1–T4 repair proved the recovery costs one repair session, not
the project.

Distributing the existing PreToolUse hook as a plugin would be the same enforcement
surface with wider distribution — not a new mechanism, and not forbidden by anything. It
stays undone for the reasons recorded under Alternatives: home-directory state invisible
to version control, and the workspace-trust dialog per session and machine. We pay the
repair when it happens rather than the toll in advance.

**Trigger for revisiting:** the first time a Cowork, cloud, or routine session is the
origin of a corpus violation that only a later preflight catches — the second incidence
of the pre-kit pattern. One occurrence starts the plugin work. Until then the gap is
recorded here and in the skill, not closed.

## Consequences

Binding inside Cowork is now one command per project (`node bin/install.mjs --into .`),
needs no workspace-trust dialog, and leaves the skill reviewable inside the repo tree. The
cost is honesty about scale: binding is per-repo, so N projects means N runs, and a project
skill is visible to everyone who clones the repo — which is also the point.

Deleting the mirror means a machine that was relying on `~/.agents/skills/` silently stops
receiving updates there — but that copy never loaded in anything, so "silently stops
receiving updates to a file nothing reads" is the correct outcome.

## Alternatives considered

- **`~/.agents/skills/research-first/.claude-plugin/plugin.json` (the plugin).** Loads as
  `research-first@skills-dir` and could carry the PreToolUse hook. Rejected on two
  grounds. First, the plugin lives in the home directory, so it is per-machine state
  invisible to version control — the exact shape that let this machine accumulate five
  unmaintained firecrawl skills. Second, enabling a plugin requires the workspace-trust
  dialog per session and machine — friction the binding step exists to remove. The
  project skill directory is the one root Cowork reads, and it needs no trust dialog at
  all. (That the plugin could bundle the hook is real capability, not a reason to prefer
  it here; what we do about enforcement in Cowork instead is decided in The Cowork gap.)
- **Keep both home mirrors and wait for runtime support.** Rejected: U-2 is closed, not
  pending. A copy at a path no runtime reads is not a fallback, it is ballast.
- **Document manual copying into projects.** Rejected: no idempotence, no overwrite
  discipline, and no refusal guard — the three properties `install.mjs` exists to provide.
