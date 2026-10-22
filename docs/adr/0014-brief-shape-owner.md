# ADR-0014 — The brief's shape has one owner, and its "not yet drafted" state is a structural marker

- **Date:** 2026-09-15
- **Status:** accepted
- **Area:** the brief (`lib/brief.mjs`, `template/research/BRIEF.md`), the audit's reader, scaffolding
- **Recorded by:** the 2026-09-15 architecture review
  (`/tmp/architecture-review-20260914-214629.html`, candidate 2), shipped in commit `49ae26c`

## Context

`research/BRIEF.md` is the phase-1 → phase-2 handoff and the only file phase 2 is
required to read (CONTEXT: **brief**). Five places knew its shape and none shared a
definition with another: the template carried the section names and a placeholder
sentence; `lib/brief.mjs` rendered the sections and *guessed* whether it was allowed
to overwrite the file; `lib/audit.mjs` re-read two sections with two regexes of its
own; `lib/scaffold.mjs` validated placeholders against a hardcoded file list while its
declared `TEMPLATE_TOKENS` went unused; `bin/brief.mjs` restated the TODO advice.

The load-bearing half was the guess. `writeBrief` decided "this is still the scaffold,
safe to write over" by matching the template's own prose — `One page. Written when
preflight passes.` — because `scaffoldProject` substitutes `{{TOPIC}}` and no
placeholder survives to be checked. Two silent failures followed:

1. **Editing that sentence in the template** made the drafter stop recognising its own
   scaffold. `bin/brief.mjs` printed `SKIP - exists` and **exited 0**, so phase 1 could
   end with no brief and no error.
2. **Keeping that sentence while writing the document** made the drafter overwrite a
   person's work: the marker for "not yet drafted" was copy they were allowed to leave
   in place.

Neither had a fixture, because the rule lived in an expression no test could reach.

## Decision

**`lib/brief.mjs` owns the brief's shape, and the scaffold says "not yet drafted"
structurally rather than in prose.**

- `BRIEF_SECTIONS` — the six sections, with the two the corpus cannot fill
  (Contradictions, Decision) marked `judged`. `renderBrief` writes its headings **from**
  it, and `lib/audit.mjs` reads those sections through `briefSection` / `judgedSection`
  instead of regexes of its own.
- `briefState(text)` → `template | legacy | draft | authored`. Only `template` and
  `draft` are safe to draft over; `authored` is preserved unless `--force`.
- `BRIEF_FILE_MARKER` (`<!-- fetchproof:brief-template -->`) ships in the template and
  survives substitution, because the substitution pass only replaces `{{TOKEN}}`s.
- A scaffold written **before** the marker shipped is its own state, `legacy`. The text
  cannot tell it from a brief someone wrote in while leaving the template's prose, so
  the drafter **refuses loudly** (`reason: 'legacy'`, exit 1) and names the two ways
  forward: delete the untouched scaffold, or `--force`.

### Rejected: a front-matter `status:` field

The nearest convention in this kit is the raw capture's front-matter, and it would have
been the most explicit signal. Rejected because it changes the *shape of the one file
phase 2 reads*: the brief is prose a person reads and edits first, and a header block is
one more thing to keep in sync (and one more thing for a hand edit to break) in the
document whose whole job is to be read. The marker is invisible to the reader and
cannot be lost by a normal edit, which is the property the decision needed.

### Rejected: a separate `lib/brief-format.mjs`

Splitting the shape from the renderer. Rejected because it would put a document's
grammar and its writer in different files with no second consumer to justify the seam —
a smaller module owning one constant table, deeper only in appearance. `lib/scaffold.mjs`
owns project *structure* and `template/` owns file *content* (ADR-0001); the brief's
internal grammar belongs with the code that writes it.

## Consequences

- A reworded template can no longer silently end phase 1, and a kept boilerplate line can
  no longer silently cost a person their writing: `briefState` is a pure function on text,
  so both are fixtures (`test/brief.test.mjs`), not hopes.
- `test/brief.test.mjs` also pins that a **scaffolded** project's `BRIEF.md` still reads
  as `template` with `{{TOPIC}}` gone — the reason the marker exists.
- `judgedSection` treats an empty section and a section opening with `**TODO**` or a bare
  `TODO`/`TBD` as unfilled, case-sensitively: a real decision beginning with the word
  "Todo" is not silently emptied.
- A pre-marker scaffold is one extra manual step on first use after this change. That is
  the deliberate trade for never overwriting prose the tool cannot account for.
- PLACEHOLDER/`TEMPLATE_TOKENS` remain `lib/scaffold.mjs`'s business; the brief's marker is
  deliberately not in that vocabulary, because it is not a placeholder to be substituted —
  it is a marker to be *preserved*.
