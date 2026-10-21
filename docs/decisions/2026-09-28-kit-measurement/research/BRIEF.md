# Brief - Measuring Fetchproof: citation accuracy metrics from deep research benchmarks

_Auto-drafted 2026-09-28 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
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

> I expect DeepResearch Bench's FACT to score citation accuracy as supported claim-URL pairs over all pairs, judged by an LLM, plus effective citations per task; and the attribution paper to separate link works, relevance and fact check. I expect the kit to score near 100% on link works by construction, and not to be measurable on fact check without a judge.

## Intent

The kit's effectiveness has never been measured. Benchmarks for deep-research agents score
citations; the kit can compute the parts of those scores that need no judge over its own
corpora, and say plainly which part needs one. Done means the metric definitions are
known and a `measure.mjs` report can be built from them.

## What we verified

| Claim | Source | Type |
|---|---|---|
| DeepResearch Bench (repo): FACT is its citation-trustworthiness framework; its README badges link the Hugging Face dataset muset-ai/DeepResearch-Bench-Dataset and a leaderboard, and the official evaluator uses judge LLMs. | E-01 `github.com` (U-01) | P |
| "Cited but Not Verified": each citation-claim pair is scored on Link Works (URL accessible, judged without an LLM), Relevant Content and Fact Check. [quote: Link Works assesses URL accessibility without LLM inference] | E-03 `arxiv.org` (U-02) | P |

## Contradictions and how they were resolved

None between the sources. Their definitions differ in grain, and the kit uses the finer one.
FACT (E-02) folds everything into one support judgment. The attribution paper (E-03) splits
out Link Works, which needs no judge, so a deterministic tool can compute it honestly.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**`bin/measure.mjs`: a report over the current project's corpus, computed without a judge.**
It never gates.

**What it computes:**
- **Link Works, in the kit's terms:** the share of evidence rows whose capture is on disk,
  in the ledger, unmodified, and not an error page. It is the kit's guarantee made visible,
  and it should read 100% on any corpus that passes the gate.
- **Grounding evidence a reviewer can check:** the share of rows carrying `[quote: ...]`,
  and the share of those quotes found in their capture (ADR-0087).
- **Capture quality:** full versus partial captures.
- **Closure strength:** how many CLOSED unknowns rest on at least one `P` row, and on at
  least two hosts.

**What it names but does not compute:** Fact Check, the FACT "support" share. The report
says it needs a judge, and it gives the anchored-quote share as the part a reviewer can
verify in seconds.

**`--json`** for machines, and a table for people.

**Out of scope:** calling a model to judge support; any threshold that fails a run.

**First build step:** `lib/measure.mjs` (pure, over `readCorpus`) and `bin/measure.mjs`.
Test on a fixture with a quote found, a quote missing, a partial capture and a
single-host closure. Then run it on all 17 corpora in this repository and MoonAliza's.

## Next steps

1. Build `measure.mjs` above, with its ADR, in the same commit.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.
<!-- fetchproof:brief-draft body=7a8e07c9d9800647 inputs=b004f65e028a68e3 gate=pass -->
