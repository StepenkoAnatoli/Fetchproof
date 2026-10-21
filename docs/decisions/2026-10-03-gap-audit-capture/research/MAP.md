# MAP - topic decomposition

## Topic

What do web-capture, annotation and HTTP standards require of a faithful, re-anchorable and current capture, as a benchmark for Fetchproof's captures

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-1, U-2, U-3, U-4, U-5 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | a standards benchmark reads public specifications |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | DISMISSED | a standards benchmark reads public specifications |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | COVERED | U-5 |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | DISMISSED | a standards benchmark reads public specifications |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | COVERED | U-4 |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | DISMISSED | a standards benchmark reads public specifications |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | DISMISSED | a standards benchmark reads public specifications |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | DISMISSED | a standards benchmark reads public specifications |
| D-10 | Re-anchoring a quotation after the page changes | The kit's quote anchor is an exact substring test against one capture; the annotation standards carry context and tolerate edits, and whether the kit's anchor survives a changed page is a fidelity property of the evidence | COVERED | U-1 |
| D-11 | Character-encoding determination | A capture decoded under the wrong encoding is a faithful copy of the wrong text; the standards fix the order of BOM, header, meta and default | COVERED | U-2 |
| D-12 | What an archival capture records per response | WARC and WACZ fix the record set (request, response, capture instant, payload digest, package digest) that the kit's ledger is measured against | COVERED | U-3 |
| D-13 | Currency: revalidation instead of a day count | HTTP's validators and conditional requests say whether a page changed; the kit's refresh rule is a day count | COVERED | U-4 |
| D-14 | Crawl rules the publisher states | RFC 9309 and the vendor's statement decide whether a capture taken without consulting robots.txt is a gap | COVERED | U-5 |

## Coverage notes (per dimension)

- D-1: the owner pages are public specifications and the vendors' own documentation;
  every unknown reads one, so the access model is the same for all five.
- D-4: U-5 - the one legality question a capture carries is the publisher's crawl rules,
  RFC 9309, and whether the transport the kit pays for consults them.
- D-6: U-4 - staleness is HTTP's currency model: validators, conditional requests, 304.
- D-2, D-3, D-5, D-7, D-8, D-9: dismissed, with the reason in the row - a standards
  benchmark reads public specifications; nothing is collected behind an account, metered,
  schema-bound, priced, platform-limited or unobtainable.
- D-10 to D-14: added for the topic; each is one of the five standards and maps to one
  unknown.
- Phase 0 is on the record: the compound topic was split into four fragments (ADR-0085),
  of which "What do web-capture" found Microsoft Edge screenshot pages and "as a benchmark
  for Fetchproof's captures" found exome capture kits; the two pages collected are the
  W3C annotation model (Recommendation, keyless, graded partial) and its 2014 first public
  working draft. The plan names the owner pages by hand.

## Candidate material

Gathered 2026-10-03.

Likely owners of these facts (by how often a search pointed at them):

- `developer.mozilla.org` (4)
- `arxiv.org` (3)
- `sciencedirect.com` (3)
- `w3.org` (2)
- `w3c.github.io` (2)
- `explore.microsoft.com` (1)

Candidate pages:

- [Screenshot Tool in Microsoft Edge | Capture Full Webpages](https://explore.microsoft.com/en-us/edge/features/screenshot)
- [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- [Capturing the calendering u-shape in lithium-ion electrode thermal ...](https://arxiv.org/pdf/2607.11521)
- [Insights in the application of research-grade diagnostic kits for ...](https://www.sciencedirect.com/science/article/pii/S0731708508005025)
- [Introducing web capture for Microsoft Edge](https://techcommunity.microsoft.com/discussions/edgeinsiderannouncements/introducing-web-capture-for-microsoft-edge/1721318)
- [Web Annotation Data Model - w3c.github.io](https://w3c.github.io/web-annotation/model/fpwd/)
- [Capturing the calendering u-shape in lithium-ion electrode thermal ...](https://arxiv.org/html/2607.11521v1)
- [Benchmark Antibodies - Diagnostic Quality, Research Use](https://benchmarkantibodies.com/)
- [How to Take a Screenshot of a Webpage Using Microsoft Edge | Microsoft Edge](https://www.microsoft.com/en-us/edge/learning-center/screenshot-webpage)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [Specific anchoring of large topologically closed DNA for single ...](https://www.sciencedirect.com/science/article/pii/S266707472400003X)
- [From Bench to Breakthrough: How Custom Kitting Fuels Precision Trials](https://www.precisionformedicine.com/blog/from-bench-to-breakthrough-how-custom-kitting-fuels-precision-trials)
- [How to Use the Web Capture Tool in Microsoft Edge for Screenshots](https://www.groovypost.com/howto/use-the-web-capture-tool-in-microsoft-edge-for-screenshots/)
- [Web Annotation Protocol](https://www.w3.org/TR/annotation-protocol/)
- [Re-entrainment mechanism of submicron particles during electrostatic ...](https://www.sciencedirect.com/science/article/pii/S0009250925002404)
- [systematic analysis of contemporary whole exome sequencing capture kits ...](https://academic.oup.com/nargab/article/7/3/lqaf115/8245222)
- [Web Capture in Microsoft Edge: How To Use? - Auslogics](https://www.auslogics.com/en/articles/use-web-capture-in-edge/)
- [HTTP resources and specifications - HTTP | MDN - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Resources_and_specifications)
- [PDF A programmable and site-specific anchoring system for ... - bioRxiv](https://www.biorxiv.org/content/biorxiv/early/2023/05/14/2023.05.12.540605.full.pdf)
- [Comparison of Mendeliome exome capture kits for use in clinical ...](https://pmc.ncbi.nlm.nih.gov/articles/PMC7039898/)

Skipped on the likely owner - the relevance floor passed these over, because a terse
title and an off-topic page look the same to it. If one is the page that owns the fact,
name it in `research/plan.json` `urls` (ADR-0097):

- [HTTP resources and specifications - HTTP | MDN - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Resources_and_specifications) - `developer.mozilla.org`

## Outlines seen in the material

The section headings of the gathered pages that are captured - what related material
covers, as its own tables of contents say (STORM's perspective step, without the model).
Not a verdict: a heading worth a subtopic becomes a row by your hand.

- [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
  - Abstract
  - Status of This Document
  - 1. Introduction
  - 1.1 Aims of the Model
  - 1.2 Serialization of the Model
  - 1.3 Conformance
  - 1.4 Terminology
  - 2. Web Annotation Principles
  - 3. Web Annotation Framework
  - 3.1 Annotations
  - Model
  - Example
  - _and 31 more_
- [Web Annotation Data Model - w3c.github.io](https://w3c.github.io/web-annotation/model/fpwd/)
  - Introduction
  - Aims of the Model
  - Diagrams and Examples
  - Terminology
  - Web Annotation Principles
  - Core Annotation Framework
  - Annotation
  - Body and Target
  - Simple Textual Body
  - Body and Target Classes
  - Body and Target Metadata
  - Embedded Textual Body
  - _and 36 more_

