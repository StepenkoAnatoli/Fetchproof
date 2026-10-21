# MAP - topic decomposition

## Topic

How provenance, attestation and integrity standards record and verify evidence, as a benchmark for Fetchproof's hash-chained ledger

## Subtopics

Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each
row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing
is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist
is not enough.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-1, U-2, U-3, U-4, U-5, U-6, U-7 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | DISMISSED | a documentation benchmark reads public specifications; no account is created, no key is issued and no log or timestamp authority is called, so no credential enters the design |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | DISMISSED | no API is called; the only cadence is this project's own collection, capped at 14 scrapes and 3 searches once |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | DISMISSED | the pages are W3C, IETF, OpenSSF/in-toto, Sigstore and SLSA specifications read once as documentation and cached under the repository's NOTICE for captured third-party pages (ADR-0130); nothing is redistributed as a product |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | COVERED | U-2, U-6 |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | COVERED | U-3, U-4 |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | DISMISSED | a documentation benchmark reads public pages; the only spend is this project's own collection, at most 14 Firecrawl scrapes and 3 searches |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | DISMISSED | nothing executes against these standards; the kit's ledger format is compared with what the specifications require of a record and a verifier |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | DISMISSED | the output is the benchmark table in the brief, which exists as soon as the owner pages are captured; every page is a public specification |
| D-10 | Derivation record (what a provenance record states about an entity's origin) | The kit's ledger says a capture came from a URL by a transport; PROV-DM says what a derivation must name (source entity, generating activity, agent, time) so a markdown conversion of a page can be traced to its source | COVERED | U-1 |
| D-11 | Attestation binding and signing (subject digests, predicate, producer, envelope) | The kit's ledger entries are unsigned and name no producer identity; the in-toto Statement and DSSE envelope say what a verifiable attestation binds and how it is signed | COVERED | U-2 |
| D-12 | Third-party witness: transparency log inclusion proof and signed entry timestamp | A local hash chain is self-attested; Rekor documents what an inclusion proof and a signed entry timestamp add (an independent time and an append-only witness) | COVERED | U-3 |
| D-13 | Trusted time: what a time-stamp token proves | The ledger's `at` is the collector's own clock; RFC 3161 says what an authority's token proves about when a hash existed | COVERED | U-4 |
| D-14 | Append-only proof: Merkle tree hash and consistency proof | The kit's chain links entries by previous hash; RFC 6962 defines how an append-only log is proven consistent between two sizes, the property a hash chain alone cannot show to a third party | COVERED | U-5 |
| D-15 | Canonical serialization of the hashed JSON record | The kit hashes a JSON ledger entry; RFC 8785 says which canonicalization rules (number formatting, string escaping, key ordering, Unicode) make such a hash reproducible across implementations | COVERED | U-6 |
| D-16 | Build provenance predicate (inputs, builder, materials) | SLSA's provenance predicate records inputs and the builder for an artifact; it is the closest industry analogue to "which transport produced this capture from which URL" | COVERED | U-7 |

## Coverage notes (per dimension)

- **D-1 Access model** - COVERED: every owner page is a public specification (W3C TR, IETF RFC at rfc-editor.org, the in-toto attestation repository on GitHub, Sigstore's documentation site, slsa.dev); U-1..U-7 each read one or more of them and nothing is auth-walled by design. If a page turns out to be bot-walled, that unknown becomes KNOWN-UNKNOWN with a day-one step.
- **D-2 Auth** - DISMISSED: nothing is signed, logged or time-stamped by this project; the standards' key and identity models are described, not exercised.
- **D-3 Rate limits** - DISMISSED: no API is called; Rekor's and a TSA's limits do not bound a documentation benchmark.
- **D-4 ToS/legality** - DISMISSED: the captures are specification pages cached under the repository's existing NOTICE (ADR-0130); nothing is built on them as data.
- **D-5 Schema stability** - COVERED by U-2 (the in-toto Statement is versioned by `_type` and the predicate by `predicateType`) and U-6 (JCS fixes the serialization so a hash survives re-encoding); the benchmark question is whether the kit's unversioned, uncanonicalized ledger entry is a stable thing to hash.
- **D-6 Freshness** - COVERED by U-3 and U-4: both say what an independent time (a signed entry timestamp, a time-stamp token) proves that a self-reported `at` cannot.
- **D-7 Cost** - DISMISSED: at most 14 Firecrawl scrapes and 3 searches once; 3 and 3 were spent by phase 0.
- **D-8 Runtime** - DISMISSED: nothing executes; the standards are read, not implemented.
- **D-9 Output obtainability** - DISMISSED: the output is the benchmark table, obtainable from the owner pages alone.
- **D-10..D-16** - the topic-specific rows, one per unknown, so every unknown traces to a subtopic and every subtopic to an unknown. The three phase-0 captures (a museum's provenance explainer, the FAIR Cookbook's provenance recipe, a Springer chapter abstract) are secondary context: the FAIR Cookbook page points at PROV-DM as the model, which U-1 reads from the owner.

## Candidate material

Gathered 2026-10-04.

Likely owners of these facts (by how often a search pointed at them):

- `umfa.utah.edu` (1)
- `entro.security` (1)
- `mdpi.com` (1)
- `faircookbook.elixir-europe.org` (1)
- `mend.io` (1)
- `ethresear.ch` (1)

Candidate pages:

- [What Is Provenance—and Why Does It Matter? - Utah Museum of Fine Arts](https://umfa.utah.edu/what-is-provenanceand-why-does-it-matter/)
- [Attestation - Entro Security](https://entro.security/glossary/attestation/)
- [Data-Tracking in Blockchain Utilizing Hash Chain: A Study of Structured ...](https://www.mdpi.com/2073-8994/16/1/62)
- [5. Provenance information - FAIR Cookbook](https://faircookbook.elixir-europe.org/content/recipes/reusability/provenance.html)
- [Attestation in Cybersecurity: Types, Uses & Best Practices - Mend.io](https://www.mend.io/blog/cybersecurity-attestation/)
- [Cheap hash functions for zkSNARK merkle-tree proofs, which can be ...](https://ethresear.ch/t/cheap-hash-functions-for-zksnark-merkle-tree-proofs-which-can-be-calculated-on-chain/3176)
- [Why- and How-Provenance in Distributed Environments](https://link.springer.com/chapter/10.1007/978-3-031-12423-5_8)
- [What Is Remote Attestation? Enhancing Data Governance with ...](https://confidentialcomputing.io/2024/10/02/what-is-remote-attestation-enhancing-data-governance-with-confidential-computing/)
- [Benchmarking ZK-Friendly Hash Functions and SNARK Proving ...](https://arxiv.org/html/2409.01976v1)
- [Data Provenance - NNLM](https://www.nnlm.gov/resources/data/data-glossary/data-provenance)
- [Attestation-based verification of SBOM integrity via consumer-side ...](https://www.sciencedirect.com/science/article/pii/S2405959526001086)
- [A scoping review of distributed ledger technology in genomics - PMC - NIH](https://pmc.ncbi.nlm.nih.gov/articles/PMC9277639/)
- [Getting Started with Provenance Research - Artwork Archive](https://www.artworkarchive.com/blog/getting-started-with-provenance-research)
- [Attestation vs. integrity in a zero-trust world - Red Hat](https://www.redhat.com/en/blog/attestation-vs-integrity-zero-trust-world)
- [[EN] Scientific Evaluation of Blockchain Data Structures as a ...](https://medium.com/@daudonheres/en-scientific-evaluation-of-blockchain-data-structures-as-a-modern-distributed-ledger-system-8829dc1794a4)
- [Collecting and Provenance Research: Methodology](https://guides.library.yale.edu/c.php?g=296149&p=1973820)
- [RI.1.1.4.1 Evidence of Record Entry Attestation Event (Function) - HL7.org](http://hl7.org/ehrs/uv/ehrsfmr2/Normative1/Requirements-EHRSFMR2-RI.1.1.4.1.html)
- [[PDF] Benchmarking Blockchains: The case of XRP Ledger and Beyond](https://scholarspace.manoa.hawaii.edu/bitstreams/29ef303a-820e-44fb-b659-cdd8f39c478a/download)
- [What is art provenance? A Getty Research Institute case studyGetty ...](https://smarthistory.org/art-provenance/)
- [Attestations: An Introduction to the Backbone of Compliance - Fianu](https://www.fianu.io/blog/attestations-an-introduction-to-the-backbone-of-compliance)

## Outlines seen in the material

The section headings of the gathered pages that are captured - what related material
covers, as its own tables of contents say (STORM's perspective step, without the model).
Not a verdict: a heading worth a subtopic becomes a row by your hand.

- [What Is Provenance—and Why Does It Matter? - Utah Museum of Fine Arts](https://umfa.utah.edu/what-is-provenanceand-why-does-it-matter/)
  - A Story of One Artwork Reunited with Its Rightful Owner
- [5. Provenance information - FAIR Cookbook](https://faircookbook.elixir-europe.org/content/recipes/reusability/provenance.html)
  - 5.1. Main Objectives ¶
  - 5.2. Provenance: a definition ¶
  - 5.2.1. OPM Open Provenance Model ¶
  - 5.2.2. The PROV Data Model ¶
  - 5.2.3. PROV vocabulary: ¶
  - 5.3. Tools for creating provenance metadata ¶
  - 5.3.1. CamFLow ¶
  - 5.3.2. Computational workflows and Provenance information: ¶
  - 5.3.3. Provenance and distributed ledger technology ¶
  - 5.4. Conclusion ¶
  - 5.4.1. What to read next? ¶
  - 5.5. References ¶
  - _and 2 more_
- [Why- and How-Provenance in Distributed Environments](https://link.springer.com/chapter/10.1007/978-3-031-12423-5_8)
  - Search
  - Navigation
  - Abstract
  - Access this chapter
  - Subscribe and save
  - Buy Now
  - Similar content being viewed by others
  - Distributed query optimization strategies for cloud environment
  - Approach to Effective Query Execution
  - Fuzzy Logic Algorithm for Index Optimization in Database Query
  - Explore related subjects
  - References
  - _and 15 more_

