# ADR-0182 - The gates judge a path by the project it belongs to in its repository

- **Date:** 2026-10-17 (revised 2026-10-18, after review)
- **Status:** accepted
- **Area:** `bin/gate.mjs`, `lib/gate.mjs`, `hooks/edit-gate.mjs`, `lib/doctor.mjs`
- **Supersedes:** ADR-0053's rejection of "take the root from the target file's location"
- **Defect:** #309

## Context

git runs `pre-commit` with the repository's top level as its cwd, and `bin/gate.mjs` took that
cwd as the project. A project scaffolded below the top level - a monorepo's `packages/a`, or the
README's own `docs/research/...` example - was never judged: the top level carried no marker, so
the gate answered `not-gated` before it read a staged path, and code committed while that
project's preflight failed. `doctor`, run inside the project, said `gate-commit pass`.

The edit gate judged by the agent's cwd (ADR-0053): the cwd if gated, else its repository's top
level. From the top level a `Write` to `packages/a/src/app.js` was "not a gated project"; from
inside `packages/a` it asked. From inside a failing project, a `Write` to `~/.bashrc` asked "the
build is not ready" too. Whether the build was guarded depended on where the agent stood.

Both hooks run machine-wide, in every repository on the machine, most of which never heard of
the kit. The first version of this decision took any one of the four gate markers as a project
below the top level; review found that a data folder's `research/raw/survey.csv`, an
experiment's `research/plan.json` or a vendored copy of the kit's own `template/` then blocked
unrelated commits, and the gate wrote `research/raw/.diagnostics.jsonl` into them.

## Decision

- **What a project is below the top level.** A folder holding `research/DISCOVERY.md` and a
  second signal the kit's `template/` lacks (`isProjectBelowTop`): `research/raw/`, or a contract
  `new-project` rendered - the kit's heading with the template's `{{TOPIC}}` token filled in
  (`isKitContract`). The rendered contract is the signal that travels: a repository that ignores
  `raw/` folders never carries `research/raw/` to a clone, and with raw/ as the only second
  signal the project escaped both gates on a builder's machine. For the commit gate the contract
  must be tracked in the index (`trackedContracts`, one `git ls-files` per commit, with
  `GIT_LITERAL_PATHSPECS`/`GIT_NOGLOB_PATHSPECS` removed so its glob is a glob) or named by the
  staged list, so a deletion staged in the same commit still counts; its text is read from the
  index (HEAD's for a deletion) only when no `research/raw/` is on disk or staged. The top level
  keeps the four markers (ADR-0002) unchanged.
- **Commit gate.** When the cwd is gated, nothing changes. When it is not, each staged path is
  assigned to its nearest project below the cwd (`stagedProjects`), and each such project is
  judged by `evaluate` with its own staged paths, relative to it, and with `top` set to the cwd:
  git runs there, so the index is read there. Any project that blocks blocks the commit, and the
  message names it ("BLOCKED in packages/a"), with the fix run from the project and the
  project's own `research/GATE_OFF` as the override. No staged path under a project is
  `not-gated`, as before. If git cannot list the staged paths at an ungated top level, the commit
  is not judged, as before, and the gate says so. The gate writes its diagnostics only into a
  `research/raw/` that already exists.
- **Edit gate.** A named file is judged by its repository's top level when that is gated - the
  commit gate then asks the top level's verdict alone - and otherwise by its nearest project
  below the top. Outside a repository the cwd's project is the bound. The `research/raw/` and
  `GATE_OFF` refusals hold for every project above the file within the bound, not only the one
  that judges: a decoy `research/research/` must not move them. A file under no project is not
  gated. A call that names no file is judged by the cwd, as ADR-0053 decided.
- **doctor.** From a project below its repository's top level, `gate-commit` says where git runs
  the gate: a pass saying it judges this project's staged paths; a warn when the folder is not a
  project by the rule above; a warn when its contract is not tracked or staged, naming
  `git add research/DISCOVERY.md`; a warn when the top level is itself gated, because then that
  root's verdict is the only one asked.

This is not the search ADR-0017 forbids. The directories asked about are the staged path's or
the edited file's own ancestors, and the repository bounds them.

## Rejected alternatives

- **Keep judging by the cwd** (ADR-0053's choice for the edit gate). The verdict then depends on
  where the agent `cd`s, and the commit gate never judges a project below the top level at all,
  which breaks AGENTS.md Rule 1's promise for every monorepo.
- **Any one of the four markers below the top level** (this ADR's first version). It judged data
  folders and vendored templates in repositories without the kit, machine-wide.
- **`research/DISCOVERY.md` or `research/kit.json` alone.** The kit's `template/` carries both, so
  every repository vendoring the kit would be judged on it.
- **`research/raw/` on disk as the only second signal** (this ADR's second version). It does not
  travel where a repository ignores `raw/`; nor would tracked `plan.json` or `EVIDENCE.md`, which
  the template carries too.
- **Disk markers only, for the commit gate.** Each folder of every staged path then costs a
  stat: 30,000 staged paths in 9,060 folders took 25 s on a loaded host, near the hook's 120 s
  watchdog, in a repository with no project. One `git ls-files` replaces them. The cost is that
  a project whose `research/DISCOVERY.md` was never committed or staged is not judged until it
  is - the corpus must be tracked to travel anyway.
- **Walk up from the file without a bound.** It could reach a gated folder above the file's
  repository - another project the commit gate would never consult.
- **Judge nested projects even when the top level is gated.** Every commit in a gated root that
  holds nested projects - this repository and its `docs/decisions/*` - would change verdict.
  Deferred; doctor's warning makes that case visible instead, and the edit gate follows the
  commit gate.
- **Only make doctor warn** (the issue's fallback). It shows the gap and leaves it open.

## Consequences

- At an ungated top level, every commit now pays one `git diff --cached` and one `git ls-files`;
  folders are then string lookups. A gated top level pays nothing new.
- An edit naming a file with a gated ancestor spawns `git rev-parse` once to find the file's
  repository; an edit naming a file with none spawns nothing.
- `bin/gate.mjs --json` carries `project` when the verdict is about a project below the cwd.

## Trigger that would reopen this

A gated root holding a nested project with code of its own - the deferred alternative above -
or the runtime's payload carrying a project root distinct from the cwd.
