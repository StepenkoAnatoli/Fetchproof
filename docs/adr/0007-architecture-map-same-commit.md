# ADR-0007 — The architecture map changes in the same commit as the code

- **Date:** 2026-09-13
- **Status:** accepted
- **Area:** commit gate (`lib/gate.mjs`), docs, protocol discipline

## Context

The kit grew through review loops in which the answer to "what does this module own, and
which decision governs that?" lived in commit messages, ADRs, and session memory. Nothing
wrong with any of those — but none of them is a map, and a new contributor reading
`lib/` cold has to reconstruct the seams from scratch.

A map only helps if it is true when the code is. The failure mode is well known: the map
gets updated "later", the later never quite arrives, and between the code change and the
doc change the repo carries a map that is wrong. A stale map is worse than none — it is
documentation that actively lies with the repo's own authority attached.

## Decision

1. `docs/ARCHITECTURE.md` is the map of the code: what each module owns, the seams
   between them, and which ADR governs each decision. It is deliberately not a map of
   the research — `research/MAP.md` is that artifact, judged by `subtopic-coverage`.
2. **Same-commit rule, enforced:** a commit touching `fetchproof/lib/` or
   `fetchproof/bin/` without carrying an update to `docs/ARCHITECTURE.md` is refused.
   The rule lives in `lib/gate.mjs` (`architectureMapBreach`), runs in `evaluate()`
   **before** the research-scope skip (a commit mixing `research/` files with kit code
   owes the map either way), and reports as the `architecture-map` blocker with a fix
   message naming the rule and the overrides.
3. **Same override rules as every other gate** — recorded, never silent: `--no-verify`,
   a deliberate `research/GATE_OFF`, or the third override (repository-local
   `core.hooksPath`, which silently bypasses the hook that would report it and is
   therefore detected and logged by doctor and preflight). No new override kind.

Scope, recorded: the rule applies to **gated** projects and the **commit** gate only.
A repository that merely vendors the kit without opting into the contract gets no
opinions from the machine-wide hook; the edit-time hook judges edits, and map currency
is a property of commits.

## Amendment — the rule became project configuration (A7.1, ADR-0008)

The original rule hardcoded this repository's paths (`fetchproof/lib/`,
`fetchproof/bin/`), which made it kit-shaped law: every project the kit scaffolds
keeps its code elsewhere and was silently exempt. ADR-0008 generalises the mechanism —
the guarded paths are now read from the project's `research/kit.json` — and this
repository declares its own, including the two enforcement surfaces (`fetchproof/hooks/`,
`fetchproof/githooks/`) that the hardcoded version wrongly exempted.

## What this rule does NOT prove

Amended 2026-09-13 (A7.3), the way CONTEXT.md states the chain is tamper-*evidence* and
not truth: **the gate checks the map was STAGED with the code, not that it is CURRENT.**
A whitespace edit to this file satisfies the check. The rule cannot mechanically verify
that the prose describes the diff — that is not fixable by a script, and pretending
otherwise would be the map lying about itself. What enforcement buys is narrower and
still real: a stale map now requires a **deliberate act** (staging a touch, taking a
recorded override) rather than mere forgetting. It is a prompt, not a proof. The docs —
this ADR, `docs/ARCHITECTURE.md`, the gate's fix message, the scaffold template — state
it this way and no further.

## Consequences

The map rots structurally slower: it cannot drift silently past a commit. The cost is
honest and paid where the work is: a kit-code change now also writes a paragraph saying
what moved. The rule's own first adoption was its own commit — gate code and map
together, so the enforcement is self-consistent from its first commit.

## Alternatives considered

- **Advisory map ("keep it current, please").** Rejected: advisory maps rot on exactly
  the schedule that makes them dangerous — updated often enough to look maintained,
  rarely enough to be wrong between changes.
- **CI or a separate doc-check script.** Rejected: the kit's enforcement surface is its
  gate, and the point is that enforcement and override discipline live in one place.
  A second, weaker checker would be the "map updated later" failure with extra steps.
- **Extend the edit-time hook too.** Rejected for now: edit sessions touch many files in
  arbitrary order; the commit is where a change is atomic and the map update can be
  judged against the whole diff. Revisit if map drift is observed at commit time.
- **Trigger on more paths (recipes, skill, hooks).** Rejected as scope creep for v1:
  the protocol names `fetchproof/lib/` and `fetchproof/bin/`; those are the modules
  whose seams the map describes. Widening the trigger is cheap later if the map misses.
