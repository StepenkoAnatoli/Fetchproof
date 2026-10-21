# Discovery Contract - Which licence should Fetchproof publish under so that people and agents may install and run it, and may the cached third-party pages in its research corpora be redistributed under it

Started 2026-10-02. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

A decision about this repository (ADR-0030): which licence the kit should publish under,
given that its own README tells people and agents to clone it and install it machine-wide
while LICENSE says all rights are reserved and no licence is granted - and whether the
cached third-party pages under every `research/raw/` in `docs/decisions/` may be
redistributed with it. Raised by an outside review on 2026-10-02. Done means the corpus
says what a public repository with no licence grants today, what the candidate licences
grant and withhold (permissive, and source-available with a commercial restriction), what
the most-cached sources licence their pages under, what copyright law allows for whole
copies kept as evidence, how web archives and crawl corpora handle the same question, and
whether a per-path split - the code under one licence, the captures excluded and labelled -
can be expressed and is recognised. The output is an ADR naming the licence and the
wording of a NOTICE for the captures; the choice between the candidates is the owner's.

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
| U-01 | What does a public GitHub repository with no licence grant - what do GitHub's terms say a visitor may do with it, and what does the no-licence default mean for use, copying and modification? | If viewing and forking are already permitted by the platform, the contradiction is narrower than it reads; if not, every install the README describes is unlicensed. | CLOSED | E-25, E-26: the platform grants viewing and forking on GitHub and nothing else; with no licence the default is exclusive copyright and no permission to copy, modify or run. The README's install instruction is therefore unlicensed under the present LICENSE. |
| U-02 | What do MIT and Apache-2.0 grant and require - the permissions, the conditions, and the patent grant that separates them? | The permissive option has to be stated from the licence texts, not from memory; the patent clause is the one difference that matters for a tool other people build on. | CLOSED | E-27, E-28, E-29, E-47: MIT and Apache-2.0 both permit commercial use, modification and distribution with notice preserved; Apache-2.0 adds an express patent grant (section 3) and a state-changes condition. [single-witness: a licence is one fixed text, so choosealicense.com, apache.org and opensource.org necessarily publish the same words and the checker groups them as one voice; the sameness across three hosts is itself the fact this unknown rests on] |
| U-03 | Which source-available licences permit installing, running and modifying while restricting commercial use or a competing offering - PolyForm Noncommercial and Shield, Business Source 1.1, Elastic 2.0 - and on what terms, including any change date? | The owner's stated wish is use without resale; the terms decide whether such a licence exists that still lets an agent on someone else's machine run the kit. | CLOSED | E-44, E-46, E-30, E-31: PolyForm Noncommercial permits noncommercial use only; PolyForm Shield permits every purpose except a competing product; Business Source 1.1 restricts production use until a change date at most four years out, then converts; Elastic 2.0 forbids only hosting it as a managed service. Shield is the one that says "use, but do not resell as a competing product". |
| U-04 | Under what licences or terms do the most-cached sources publish their pages - GitHub Docs, Google developer sites, nodejs.org, the npm documentation, arXiv, Wikipedia? | A capture of a CC-BY page may be redistributed with attribution; a capture of an all-rights-reserved page may not, whatever this repository's licence says. | CLOSED | E-32, E-33, E-34, E-24, E-35, E-36: GitHub Docs and the npm documentation are CC BY 4.0; Google developer documentation is CC BY 4.0; nodejs.org is MIT; Wikipedia is CC BY-SA 4.0; arXiv papers carry a per-paper licence, by default arXiv's non-exclusive one that licenses arXiv, not readers. Captures from the first five hosts may be redistributed with attribution; a paper and any terms page need a per-capture check. |
| U-05 | What does United States copyright law allow for a whole copy of a page kept as evidence - the fair use factors of 17 U.S.C. 107, and what the Internet Archive lending case decided about whole-copy archiving? | Whether a full-page capture can rest on fair use at all decides whether the captures can stay in a public repository or must be excluded from distribution. | CLOSED | E-37, E-38, E-39: fair use is a four-factor defence decided case by case, research is a named example, and the whole-copy archiving precedent (Hachette v. Internet Archive, affirmed 2024) went against the archive. A NOTICE can claim no licence it does not have; it can state the purpose and grant nothing. |
| U-06 | On what terms do the Internet Archive and Common Crawl redistribute whole captured pages? | They are the nearest practice to this kit's captures; their terms say what a careful archive claims and disclaims. | CLOSED | E-40, E-41: both archives redistribute whole captured pages, limit the grant to research purposes, disclaim any licence over the content and place the duty to respect third-party rights on the user - the wording a NOTICE for research/raw can follow. |
| U-07 | Can a repository carry one licence for its code and exclude a path from it, and is that recognised - GitHub's licensing guidance, and the REUSE specification for per-file licensing? | The likely answer is a split; it has to be expressible in a way GitHub and tooling read correctly, or the LICENSE file will again say something the tree contradicts. | CLOSED | E-42, E-43: GitHub detects a single licence from LICENSE and says to keep the file simple and note complexity in the README; REUSE 3.3 marks files and whole directories with SPDX identifiers through REUSE.toml. A split is expressible: one licence in LICENSE, research/raw marked separately and excluded in the README and a NOTICE. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- The choice between the candidate licences is the owner's; this project establishes what each grants, and recommends.
- Nothing under `docs/decisions/` is deleted; if captures must leave distribution, the remedy is labelling and exclusion from the licence grant, decided in the ADR, never a history rewrite.
