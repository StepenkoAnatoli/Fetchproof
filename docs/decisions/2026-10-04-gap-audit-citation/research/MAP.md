# MAP - topic decomposition

## Topic

How citation-integrity and text-identity standards decide that a claim is supported and that two texts or URLs are the same, as a benchmark for Fetchproof's evidence rows, corroboration and URL identity

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-1, U-2, U-3, U-4, U-5, U-6 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | a documentation benchmark reads public pages; no account is created and no API is called with a credential (the Crossref record is a public, keyless GET), so no credential enters the design |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | DISMISSED | nothing in this project calls an API on a cadence; the only quota is this project's own collection, capped at 14 scrapes and 3 searches once |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | DISMISSED | the pages are read once as documentation and cached under the repository's NOTICE for captured third-party pages (ADR-0130); Wikipedia text is CC BY-SA, Unicode and WHATWG texts carry their own open licences, and nothing is redistributed as a product |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | COVERED | U-2 |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | DISMISSED | the standards benchmarked here (UAX #15, UTS #46, WHATWG URL, Wikipedia policy) change slowly and the brief records the version or revision each capture carries; a 30-day refresh covers the audit |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | DISMISSED | a documentation benchmark reads public pages; the only spend is this project's own collection, capped at 14 scrapes and 3 searches once |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | DISMISSED | a documentation benchmark reads public pages; nothing executes against these standards, the kit's behaviour is compared with their documented rules |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | DISMISSED | the output is the benchmark table in the brief, which exists as soon as the owner pages are captured; every owner page is public and keyless |
| D-10 | Source support and source tiers (Wikipedia V, RS, NOR) | The kit grades sources P/S/L and closes an unknown on an evidence row; what a mature verifiability standard requires of "directly supports", when a primary source may carry a claim, and what counts as forbidden synthesis is the benchmark for the kit's closure rule | COVERED | U-1 |
| D-11 | Work identity across URLs (Crossref record, DOI) | Two URLs can name one work; what a scholarly metadata record carries to say so (DOI, URL, dates, citation count) and how a DOI resolves is the benchmark for the kit's URL identity key | COVERED | U-2 |
| D-12 | Text identity under Unicode normalization (UAX #15) | The kit hashes capture bodies and compares quotes byte for byte; whether two strings that look identical can hash differently, and which form is recommended for identifiers, decides whether a quote anchor or a body hash can fail on an invisible difference | COVERED | U-3 |
| D-13 | Host and URL equivalence (UTS #46, WHATWG URL) | The kit's corroboration check judges "same site" by host suffix and its URL key is an exact string or a normalised key; the owner rules for case, trailing dot, percent-encoding, default port and empty path decide where two spellings of one page are counted twice | COVERED | U-4 |
| D-14 | Near-duplicate detection (MinHash, shingles, non-Latin text) | The kit's corroboration sketch is MinHash over ASCII word shingles; what MinHash estimates and how shingles are formed decides whether two non-Latin copies can be judged at all | COVERED | U-5, U-7 |
| D-15 | Citation practice in AI research tools (Elicit, Perplexity) | Whether a shipped research tool shows the supporting passage and what it does with a claim it cannot anchor, and whether it rates a source per page or per site, is the benchmark for the kit's quote anchor and host-level judgement | COVERED | U-6 |

## Coverage notes (per dimension)

- D-1 COVERED: every owner page is public and keyless (Wikipedia policy pages, Crossref documentation and the public REST API, unicode.org reports, the WHATWG living standard, the datasketch docs, the Elicit and Perplexity help centres); each unknown names its page. Rests on the plan's urls.
- D-2, D-3, D-7, D-8 DISMISSED: a documentation benchmark; nothing is called with a credential, on a cadence, at volume or on a runtime. The spend is this collection, capped by the lead at 14 scrapes and 3 searches.
- D-4 DISMISSED: single documentary reads cached under the repository's NOTICE (ADR-0130); the texts are openly licensed.
- D-5 COVERED by U-2: the Crossref work record is the one schema this project reads, and the question is what it carries, not how it drifts.
- D-6 DISMISSED: standards texts; the brief records the revision each capture carries.
- D-9 DISMISSED: the benchmark table exists once the owner pages are on disk.
- D-10 to D-15: the six topic-specific subtopics, one per unknown, from the lead's comparison set. The three decompose captures (an EvidenceBench paper on arXiv, a Nisos blog post and an NHI glossary entry on "corroboration") are off-topic for the audit's sense of corroboration (independent witnesses for one claim about a page) except the arXiv paper, which is secondary context for D-15; none is cited as evidence.

## Candidate material

Gathered 2026-10-04.

Likely owners of these facts (by how often a search pointed at them):

- `arxiv.org` (2)
- `pmc.ncbi.nlm.nih.gov` (1)
- `cvlibs.net` (1)
- `nisos.com` (1)
- `citeintegrity.org` (1)
- `nhimg.org` (1)

Candidate pages:

- [Assessing citation integrity in biomedical publications - PMC - NIH](https://pmc.ncbi.nlm.nih.gov/articles/PMC11231046/)
- [The KITTI Vision Benchmark Suite - Andreas Geiger](https://www.cvlibs.net/datasets/kitti/)
- [Identity Corroboration Beyond Background Checks - Nisos](https://nisos.com/blog/identity-corroboration-beyond-background-checks/)
- [CiteIntegrity | Citation Checker, Reference Verifier and Source Finder](https://citeintegrity.org/)
- [A Benchmark for Extracting Evidence from Biomedical Papers - arXiv](https://arxiv.org/html/2504.18736v1)
- [What Is Source Corroboration? Definition & Examples](https://nhimg.org/glossary/source-corroboration/)
- [Guidelines for Citations and References - Boise State University](https://www.boisestate.edu/cobe/cobe-writing-style-guide/citations-and-references/)
- [A Benchmark for Extracting Evidence from Biomedical Papers](https://openreview.net/forum?id=NPDnRLFhc0)
- [Identity corroboration methods key to reducing fraud, report says](https://fedscoop.com/identity-verification-reduce-fraud-gartner-report/)
- [Citation Quick Guide - Scientific Style and Format Online](https://www.scientificstyleandformat.org/Tools/SSF-Citation-Quick-Guide.html)
- [Research graph — questions, experiments, evidence and claims](https://www.codesota.com/research)
- [[PDF] Market Guide for Identity Proofing and Corroboration | StateScoop](https://statescoop.com/briefs/gartner-guide-identity-proofing-corroboration-2018/)
- [: Citation Verification with AI-Powered Full-Text Analysis and Evidence ...](https://arxiv.org/html/2511.16198v1)
- [[PDF] BenchBrowser: Retrieving Evidence for Evaluating Benchmark Validity](https://harshitadd.netlify.app/assets/pdf/BenchBrowser_Preprint__Arxiv_Final_Version.pdf)
- [The Court of Appeals Should Abandon the Corroboration Rule ...](https://academicworks.cuny.edu/clr/vol24/iss1/5/)
- [Understanding Citations - Academic Integrity (psu.edu)](https://integrity.psu.edu/citations)
- [A Benchmark for Extracting Experiments from Literature](https://www.radical-ai.com/news/litxbench-a-benchmark-for-extracting-experiments-from-materials-literature)
- [[PDF] Theorizing Corroboration - Cornell Law School](https://publications.lawschool.cornell.edu/lawreview/wp-content/uploads/sites/2/2023/07/Wittlin-final.pdf)
- [Understanding Citations, Plagiarism, and Paraphrasing - Honor Committee](https://honor.virginia.edu/understanding-fraud)
- [[PDF] Establishing a Benchmark Dataset for Traceability Link Recovery between ...](https://publikationen.bibliothek.kit.edu/1000151962/149528996)

## Outlines seen in the material

The section headings of the gathered pages that are captured - what related material
covers, as its own tables of contents say (STORM's perspective step, without the model).
Not a verdict: a heading worth a subtopic becomes a row by your hand.

- [Identity Corroboration Beyond Background Checks - Nisos](https://nisos.com/blog/identity-corroboration-beyond-background-checks/)
  - What is Identity Integrity?
  - Nothing is required from the individual.
  - It surfaces risk. It doesn’t make decisions.
  - It’s built for volume, not just your highest-risk roles.
  - Where identity corroboration fits across the workforce
  - Pre-hire.
  - Employee investigation.
  - Identity assurance at scale.
  - How independent sources reveal identity inconsistencies
  - From identity risk signals to further investigation
  - Frequently Asked Questions About Identity Corroboration
  - About Nisos®
- [A Benchmark for Extracting Evidence from Biomedical Papers - arXiv](https://arxiv.org/html/2504.18736v1)
  - 1 Introduction
  - 2 Task Formulation
  - 2.1 Definitions
  - 2.2 Task Definition
  - 2.3 Evaluation Metrics
  - 3 Dataset Construction Pipeline
  - 3.1 Data Sources
  - 3.2 Dataset Pipeline Overview
  - 3.3 Hypothesis Generation
  - 3.4 Alignment Annotation of Study Aspects and Sentences
  - 4 Experiment Setup
  - 4.1 Evaluation strategies
  - _and 34 more_
- [What Is Source Corroboration? Definition & Examples](https://nhimg.org/glossary/source-corroboration/)
  - Expanded Definition
  - Examples and Use Cases
  - Why It Matters in NHI Security
  - Standards & Framework Alignment
  - Related resources from NHI Mgmt Group
  - Deepen Your Knowledge
  - Subscribe to the NHI & AI Identity Journal

