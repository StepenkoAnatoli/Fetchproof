# Brief - Which similar agent-research and evidence-provenance tools on GitHub and Hugging Face do something this kit should take

_Auto-drafted 2026-10-02 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require the reviewing agent's judgement; everything else is assembled from evidence already
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

## Intent

A decision about this repository (ADR-0030): whether any mechanism found in similar
open-source tools - citation and quote verification, provenance ledgers of fetched pages,
a gate that blocks building until the evidence is in - should be taken into this kit, or
whether the kit stays as it is. The kit is feature-frozen (ADR-0117): one item enters only
through an ADR that lifts the freeze for it, so "take" means an ADR with the mechanism
named, and "leave" is a legitimate outcome. Done means a dated list of the closest tools
on GitHub and Hugging Face with what each verifies and how, their licences, and for each
mechanism whether the kit already has it, does it differently on purpose (which ADR), or
lacks it - and the decision, with its reason, in the brief.

## What we verified

| Claim | Source | Type |
|---|---|---|
| ProvenanceGuard (Multiverse Computing, Hugging Face blog, 2026-09-29) is a post-generation verification layer over a black-box MCP agent: it decomposes an answer into claims, routes each to the sources the agent used, scores support with an NLI model and checks that the supporting source is the one the answer attributes - the same concern as this kit's url-mismatch and quote checks, done with a model after the fact rather than with a string check at gate time; evaluated on 281 medical traces with local models. [quote: ProvenanceGuard is a post-generation verification layer that sits on top of a black-box MCP agent.] [quote: supported somewhere is not the same as supported by the right source] | E-02 `huggingface.co` (U-01, U-03) | S |
| hyperresearch (MIT) verifies citations with a model: a skeptical cite-checker audits whether each cited source supports its sentence (step 14.5, a skeptical LLM spot-check), an independence audit clusters syndicated copies, and a Stop hook blocks the Codex session from ending mid-pipeline - a gate on the session, not on a commit or a build. The judge is an LLM, which ADR-0087 set aside for this kit's gate. [quote: A skeptical cite-checker audits whether each cited source actually supports its sentence.] [quote: Verify citation-sentence bindings; skeptical LLM spot-check; second surgical patch pass] The page links its MIT license. | E-04 `github.com` (U-01, U-04, U-05) | P |
| VeriRepro (Apache-2.0) reproduces computational papers; its principle is the closest to this kit's - models propose, deterministic code verifies - and its claims carry page/quote support with unverifiable claims left visibly unverified, which is what KNOWN-UNKNOWN does here. It verifies experiments in Docker, not web evidence; nothing to take as code, and the principle is already the kit's. [quote: Models may propose. Deterministic code must verify.] [quote: Paper claims can carry page/quote support, and unverifiable claims remain visibly unverified.] | E-05 `github.com` (U-01, U-04) | P |
| GitHub's citation-verification topic lists 186 public repositories; the ones the page describes check bibliographic references against scholarly databases (Crossref, OpenAlex, PubMed) for existence and retraction - chrisyangsong/citegate runs that as a CI gate on BibTeX, Hylouis233/bibverify and Moonweave-Research/ref-verify do it for assistants. None verifies that a quote occurs in a fetched web page; the gate they offer is on academic references, not on evidence for a build. [quote: Citation integrity as a CI gate: verify BibTeX references against Crossref & OpenAlex, catch hallucinated citations, get alerted when a cited paper is retracted.] | E-06 `github.com` (U-01, U-04, U-05) | S |
| Cited but Not Verified (arXiv 2605.06635v1, May 2026) parses inline citations out of LLM research reports, fetches each cited page and judges Link Works, Relevant Content and Fact Check with LLM judges calibrated by humans. Across 14 models, links worked above 94% and content was relevant above 80%, yet factual accuracy was only 39-77%, and it fell about 42% as tool calls grew from 2 to 150. A working link is not a supported claim - the measurement behind this kit's rule that a claim cites a fetched capture with a quote that occurs in it. [quote: yet achieve only 39–77% factual accuracy] [quote: demonstrating that more retrieval does not produce more accurate citations] | E-07 `arxiv.org` (U-01) | S |
| AgentHub (arXiv 2510.03495v2, ICSE 2026) proposes a registry for AI agents with signed manifests and reproducibility attestations, modelled on npm and PyPI provenance; it is about distributing and governing agents, not about the evidence an agent collects - nothing here applies to a research corpus. [quote: Signed manifests and reproducibility attestations] | E-03 `arxiv.org` (U-02) | S |
| GitHub's hash-chain topic lists 296 repositories; the agent-related ones log agent ACTIONS - chain-of-consciousness/chain-of-consciousness (tamper-evident hash chains anchored with Bitcoin OpenTimestamps), bbismm/receipt (publicly verifiable agent activity logs, third-party anchored), JohnSilly1/mcp-audit-proxy (hash-chained logs of MCP calls). This kit's ledger hash-chains fetched EVIDENCE instead, and its opt-in witness anchors the page at the Wayback Machine; the one thing these add is anchoring the chain head itself with a third party. [quote: Cryptographic provenance protocol for autonomous AI agents — tamper-evident hash chains with Bitcoin OpenTimestamps anchoring.] [quote: Open standard for publicly-verifiable AI agent activity logs. Hash-chained, externally reconciled, third-party anchored.] | E-08 `github.com` (U-02, U-04) | S |
| The tamper-evident-hash-chain-integrity topic holds two repositories; felipewatter/tamper-evident-audit-ledger is a Node.js hash-chain ledger with optional Ed25519 signatures and a CLI verifier - the signature is the one mechanism this kit's ledger lacks (its chain proves no later edit, not who appended), and it would need a key the collector holds. [quote: Tamper-evident audit ledger (hash chain + optional Ed25519 signatures) with CLI verification for Node.js/TypeScript.] | E-09 `github.com` (U-02, U-04) | S |
| Hugging Face's open-deep-research is a 24-hour reproduction of OpenAI's Deep Research on the GAIA benchmark with smolagents; the post is about agent performance and tool use, and says nothing about verifying citations or recording where a page came from - no mechanism for this kit here. [quote: So we decided to embark on a 24-hour mission to reproduce their results and open-source the needed framework along the way!] | E-01 `huggingface.co` (U-03) | P |
| Hugging Face's papers search is client-side: the page fetched for the query 'source citations' is the unfiltered Daily Papers listing (the query term occurs nowhere in the capture), so this route reaches no paper on the question; kept as the record of a route that does not work through a fetch. [quote: Get trending papers in your email inbox once a day!] | E-10 `huggingface.co` (U-03) | S |
| The same for the query 'authorship': the capture is the unfiltered Daily Papers listing again (its first entry is a 2020 authorship-attribution paper only by coincidence of the day's list); a Hugging Face papers query cannot be collected as a page. [quote: Get trending papers in your email inbox once a day!] | E-11 `huggingface.co` (U-03) | S |
| pre-commit/pre-commit-hooks, the hook framework the search surfaced for 'gate', ships generic hooks (trailing whitespace, merge conflicts, large files) under MIT; it carries no hook that reads evidence before a commit, and none of the pages this survey reached does - the commit gate on research evidence is this kit's own. [quote: Some out-of-the-box hooks for pre-commit.] | E-12 `github.com` (U-04, U-05) | S |

## Contradictions and how they were resolved

The sources do not contradict each other; they divide by method, and the division is the
finding. Three verify support with a model after the fact: ProvenanceGuard scores support
with an NLI model and checks the attributed source (E-02), hyperresearch's cite-checker is a
skeptical LLM spot-check (E-04), and the arXiv framework judges Link Works, Relevant Content
and Fact Check with calibrated LLM judges (E-07). One verifies deterministically and says so
as a principle - VeriRepro's "models may propose, deterministic code must verify" (E-05),
which is this kit's rule (ADR-0087 rejected a model judge for the gate). The
citation-verification repositories (E-06) check references against scholarly databases,
a different object (a bibliography, not a fetched page). The measurement that settles which
side to trust is E-07's own: with links working above 94% and content relevant above 80%,
factual accuracy was 39-77% and fell as retrieval grew - a working citation is not a
supported claim, so a gate that checks the capture and the quote, not the link, is the
right side. Two warnings stand and are read as such: U-02 rests on topic listings (S), not
on the ledger projects' own pages, and U-03..U-05 each rest on one host, because GitHub and
Hugging Face are the hosts the question named.

## Known unknowns

None. Every blocking unknown was closed with cited evidence. U-02 rests on no primary (P) source; the Type column above shows what carries it.

## Decision

Leave the kit as it is. Nothing reached by this survey is a mechanism to take as code:
the closest tools either judge support with a model (E-02, E-04, E-07), which the gate may
not do (ADR-0087), or verify a different object - bibliographic references against Crossref
and OpenAlex (E-06), agent actions in a hash-chained log (E-08), experiments in Docker
(E-05). The commit gate on fetched evidence appears in none of them (U-05); the quote
anchor and the url-mismatch check already do deterministically what ProvenanceGuard does
with NLI. Licences would not have stopped a take (MIT, Apache-2.0), and were not the reason.

Two mechanisms were weighed and are deferred, each needing an ADR that lifts the freeze
(ADR-0117) for that one item, with its trigger:

1. **A signature on each ledger entry** (Ed25519, as in E-09). The chain proves no later
   edit; a signature would prove who appended. Trigger: a corpus must be verifiable by a
   party who distrusts the collector - today the collector is the operator, and the
   handoff travels through the operator's own git history, which already names the author.
2. **Anchoring the chain head with a third party** (OpenTimestamps or an archive, as in
   E-08). `--witness` already anchors each page at the Wayback Machine; anchoring the
   ledger itself would date the whole corpus. Trigger: a dispute about when a corpus
   existed, not only about what it holds.

Out of scope: a model-judged support check (rejected, ADR-0087), bibliographic verification
(the kit cites pages, not papers), and any tool this survey did not reach - four searches
and twelve pages are the bound, and the GitHub topic pages name hundreds more.

First build step: none. The next action on this question is the trigger above firing.

## Next steps

1. Review the **TODO** sections above (Contradictions, Decision) before handing off.
2. Hand this file to the builder (phase 2). Re-running `node "/root/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=46e7fa12e19a1120 inputs=0ecc8c88115dc006 gate=pass -->
