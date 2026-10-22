# ADR-0008 — Guarded code paths are project configuration

- **Date:** 2026-09-13
- **Status:** accepted
- **Area:** commit gate (`lib/gate.mjs`), scaffold (`LAYOUT`, `template/`), per-project configuration

## Context

ADR-0007's enforcement hardcoded `fetchproof/lib/` and `fetchproof/bin/` — paths
that exist only in this repository. Every project the kit scaffolds keeps its code
somewhere else, so in those projects the rule never fired and no map was ever required.
The standing protocol was meant for every project, not for the kit alone. Worse, the
hardcoded list wrongly exempted this repo's own enforcement surfaces — a change to
`fetchproof/githooks/pre-commit` or `fetchproof/hooks/claude-pretooluse.mjs` (the
gates themselves) owed no map.

## Decision

1. **`research/kit.json` declares the guarded paths** (per project, version-controlled):

   ```json
   { "architecture": { "codePaths": ["src", "lib", "bin", "scripts", "app"] } }
   ```

2. **Defaults without setup:** an absent, empty, or corrupt `research/kit.json` means
   the defaults — `src/`, `lib/`, `bin/`, `scripts/`, `app/` — so a scaffolded project
   is guarded from commit one with zero configuration, the same tolerance the machine
   config reader applies.
3. **The scaffold ships both halves:** `new-project.mjs` writes
   `docs/ARCHITECTURE.md` (empty module table, empty seams section, the rule stated —
   including what it does *not* prove) and `research/kit.json` (the defaults, in plain
   sight and obvious to edit). Both in LAYOUT; **neither** in GATE_MARKERS — still
   exactly four (ADR-0001).
4. **This repository declares its own paths:** `fetchproof/lib`, `fetchproof/bin`,
   `fetchproof/hooks`, `fetchproof/githooks` — the enforcement surfaces included.
   `lib/gate.mjs` contains no repo-specific path, pinned by test.

## Consequences

The rule is now kit-shaped law that applies wherever the kit is installed, with the
guard list as reviewable project state. Costs, honestly: the guard is only as good as
the declaration (a project that puts code in `server/` and never declares it is
unguarded there — the defaults catch the common layouts, not all), and two more LAYOUT
entries mean two more scaffold artifacts to maintain. Accepted: an undeclared code path
is a configuration gap a human can see in the reviewable `kit.json`, not a silent
exemption baked into the gate.

## Alternatives considered

- **Hardcode more paths.** Rejected: still this repo's law, still useless everywhere
  else — the actual bug being fixed.
- **Config in the map file (frontmatter or a fenced block).** Rejected: scraping
  configuration out of prose couples the gate to documentation formatting, and the map
  is the artifact the rule judges, not the declaration of what it judges.
- **A key in `research/plan.json`.** Rejected: the plan is the *research* plan — what to
  collect and at what budget. Gate configuration in it muddles two owners (ADR-0003's
  one-owner-per-artifact instinct applies to configuration too).
- **Machine-level configuration (the `~/.agents` config).** Rejected: code layout is a
  property of the *project*, not the machine — it must travel with the repo, in version
  control, reviewable by every contributor.
- **Configurable map path.** Rejected as scope creep: `docs/ARCHITECTURE.md` is one
  well-known path; a second knob buys nothing this project needs.
