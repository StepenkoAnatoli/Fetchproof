# Brief - Perspective discovery for topic decomposition: how STORM finds perspectives from related articles' outlines, and whether it needs a language model

_Auto-drafted 2026-09-29 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## The prior, registered before anything was collected

_Ledger seq 1, chained: neither this text nor its place before the evidence
can be changed now. Read it against the findings below - it may well be wrong, and a wrong
prior that was recorded in advance is worth more than a right one remembered afterwards._

> I expect STORM to discover perspectives by retrieving related Wikipedia articles and using their tables of contents, with an LLM turning those outlines into perspectives and questions. The headings-harvesting part needs no model; the question-asking part does, so only the outline harvest fits a kit whose tools contain no judgment.

## Intent

A zero-model version of STORM's perspective discovery for `decompose`: the phase-0 map
would show the outlines of the pages it gathered, so the person classifying subtopics sees
the facets related material covers. Done means knowing how STORM discovers perspectives,
which of its steps need a language model, and how much perspectives add over reading the
material - the kit's tools contain no judgment, so only a model-free step can be adopted.

## What we verified

| Claim | Source | Type |
|---|---|---|
| STORM (Shao et al., Stanford): an LLM lists related topics, the tables of contents of their Wikipedia articles are extracted through the Wikipedia API, and an LLM names perspectives from them; a basic-facts writer is always added. Ablation (Table 3, heading soft recall): STORM 86.26 / 92.73 (GPT-3.5 / GPT-4), without perspectives 84.49 / 92.39, without conversation 77.97 / 88.75. [quote: STORM prompts an LLM to generate a list of related topics and subsequently extracts the tables of contents from their corresponding Wikipedia articles] [quote: These tables of contents are concatenated to create a context to prompt the LLM to identify] [quote: indicating reading relevant information is crucial to generating effective questions] | E-01 `arxiv.org` (U-01, U-02, U-03) | P |

## Contradictions and how they were resolved

None between the sources: the paper and its repository describe the method in the same
words. They are one voice, not two (the U-01 note says so).

The prior was half right. The outline harvest does need no model, and naming perspectives
does need one. What the prior missed is the ablation. Perspectives are STORM's headline
idea, yet removing them costs 0.3 to 1.8 points of heading recall, while removing the
grounded conversation costs 4 to 8. So the step that carries the gain is reading related
material, and that is the step the kit can copy.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**`decompose` shows the outlines of the material it gathered: STORM's table-of-contents
step, without the model.**

- **Source:** the captures on disk for the material's URLs. These are pages this run scraped
  under `--max-scrapes`, or pages the corpus already held. No extra search or scrape is
  spent.
- **Content:** each page's `##` and `###` headings, read from the capture body. Both
  transports write headings as Markdown.
- **The map section:** a new `## Outlines seen in the material` section in `MAP.md`, placed
  after the candidate material.
  - Per page: its title and link, then its headings as a short list.
  - Headings are deduplicated and capped per page.
  - Headings that are page furniture (GitHub's "Permalink:" anchors, navigation words) are
    dropped.
  - Pages are capped too.
- **No verdict:** the section is unjudged. Like the checklist, it hands the person
  classifying the map the facets that related pages cover. Any heading worth a row becomes
  a subtopic by their hand.
- **When there is nothing to show:** with no captures for the material, the section says
  so, and names `--max-scrapes` as the way to get outlines.

**Out of scope:**

- An LLM naming perspectives or asking questions. The kit's tools contain no judgment
  (Rule 1, step 0).
- The simulated conversations. They are the research phase itself, which the kit already
  runs as contract, collect and gate.
- Fetching Wikipedia's tables of contents. The gathered pages are the related articles
  here.

**First build step:** `outlineOf(body)` in `lib/decompose.mjs`, plus the map section. Test
it on a fixture capture that has headings, `Permalink:` furniture and duplicates, and on a
run with no captures.

## Next steps

1. Build the outline section above, with its ADR, in the same commit.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=a4f22af0d767126e inputs=05e0810e0e099b8b gate=pass -->
