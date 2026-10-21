# Discovery Contract - Which similar agent-research and evidence-provenance tools on GitHub and Hugging Face do something this kit should take

Started 2026-10-02. This file is the definition of "enough information to build".
`node "/root/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

A decision about this repository (ADR-0030): whether any mechanism found in similar
open-source tools - citation and quote verification, provenance ledgers of fetched pages,
a gate that blocks building until the evidence is in - should be taken into this kit, or
whether the kit stays as it is. The kit is feature-frozen (ADR-0117): one item enters only
through an ADR that lifts the freeze for it, so "take" means an ADR with the mechanism
named, and "leave" is a legitimate outcome. Done means a dated list of the closest tools
on GitHub and Hugging Face with what each verifies and how, their licences, and for each
mechanism whether the kit already has it, does it differently on purpose (which ADR), or
lacks it - and the decision, with its reason, in the brief.

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
| U-01 | Which open-source tools verify that an agent's citations or quotes are really supported by the cited page, and by what method (string match, LLM judge, both)? | The kit's quote anchor (ADR-0087) is a string check and refuses LLM judgement; a tool that checks support another way is either something to take or a design the kit rejected on purpose - without the method, neither can be said. | CLOSED | E-02, E-04, E-05, E-06, E-07: three verify support with a model after the fact (ProvenanceGuard with NLI, hyperresearch with an LLM spot-check, the arXiv framework with LLM judges), the citation-verification repositories check references against scholarly databases, and VeriRepro carries page/quote support with deterministic verification - the kit's own method. Bounded to the pages reached. |
| U-02 | Which tools keep a tamper-evident record of fetched pages - a hash chain, signatures, WARC with digests - and what does the record prove that the kit's ledger does not? | The kit's ledger proves a capture was fetched and unedited; if a tool proves more (who fetched, when, from where, with a third-party witness), that is the mechanism to weigh. | CLOSED | E-03, E-08, E-09: hash-chained logs of agent actions, some anchored with OpenTimestamps or third parties, and one ledger with optional Ed25519 signatures; AgentHub signs agent manifests. Beyond this kit's ledger they offer a signature on each entry and anchoring of the chain head; none records fetched evidence. |
| U-03 | What does Hugging Face host for this niche - deep-research agents, source-attribution write-ups, datasets or Spaces for citation verification - and which of it is a mechanism rather than a model? | The question names Hugging Face; a survey that only looked at GitHub would answer a narrower question than asked. | CLOSED | E-01, E-02, E-10, E-11: Hugging Face hosts the open-deep-research agent (no verification mechanism) and the ProvenanceGuard write-up (a model-judged verifier); its papers search is client-side and not collectable as a page. |
| U-04 | Under which licences are the candidate tools published? | The kit is all-rights-reserved (LICENSE); copying code from a copyleft or share-alike project is not an option, and the answer decides whether "take" can mean code or only the idea. | CLOSED | E-04 (MIT), E-05 (Apache-2.0), E-12 (MIT); the topic listings (E-06, E-08, E-09) do not show licences, and nothing from them is proposed as code. |
| U-05 | Does any tool gate a build or a commit on research evidence - a hook, a CI check, a status that refuses to proceed - the way this kit's commit gate does? | If none does, the gate is the kit's distinct contribution and there is nothing to take there; if one does, its design is the comparison the decision needs. | CLOSED | E-04, E-06, E-12: hyperresearch gates the end of a session, citegate gates CI on BibTeX references, pre-commit-hooks ships generic hooks; none of the pages reached gates a commit or a build on fetched web evidence. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- The survey is bounded: one phase-0 search, four planned searches and at most twelve
  pages. Tools it does not reach are out of scope, and the brief says so.
- A mechanism is "taken" only through an ADR that lifts the freeze for that one item
  (ADR-0117); the brief recommends, it does not implement.
