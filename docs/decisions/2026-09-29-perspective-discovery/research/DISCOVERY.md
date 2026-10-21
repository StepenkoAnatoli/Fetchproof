# Discovery Contract - Perspective discovery for topic decomposition: how STORM finds perspectives from related articles' outlines, and whether it needs a language model

Started 2026-09-29. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

A zero-model version of STORM's perspective discovery for `decompose`: the phase-0 map
would show the outlines of the pages it gathered, so the person classifying subtopics sees
the facets related material covers. Done means knowing how STORM discovers perspectives,
which of its steps need a language model, and how much perspectives add over reading the
material - the kit's tools contain no judgment, so only a model-free step can be adopted.

## Unknowns

A fact belongs here when guessing it wrong changes the design: API limits and pricing,
auth model, data schemas, rate limits, licensing/ToS, platform behavior, current library
versions, competitor pricing, data availability.

Status is exactly one of:
- `CLOSED` - proven by an `E-##` row in `research/EVIDENCE.md` (which must point at cached raw text).
- `KNOWN-UNKNOWN` - unreachable now; the `Evidence` cell names the day-one verification step.

Anything else (`OPEN`, blank, "in progress") fails the gate.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-01 | How does STORM discover perspectives? | The kit can only copy a step it can run without a model. | CLOSED | E-01, E-02: it surveys articles on related topics and extracts their tables of contents; an LLM then names perspectives from them. [single-witness: the authors describing their own system, in the paper and in its repository] |
| U-02 | Which of those steps need a language model? | A step that needs a model would put judgment into a kit whose tools contain none. | CLOSED | E-01: listing related topics and naming perspectives are LLM prompts; extracting the tables of contents is a Wikipedia API call. [single-witness: the paper is the only description of its method] |
| U-03 | How much do perspectives add over reading related material? | If perspectives add little, copying only the reading step loses little. | CLOSED | E-01: the ablation - removing perspectives costs 0.3 to 1.8 points of heading recall; removing the grounded conversation costs 4 to 8. [single-witness: the paper's own ablation - it is the only published run of STORM with and without perspectives] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.
