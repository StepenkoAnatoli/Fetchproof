# Sources

Every page this project has fetched, and what it was used for. `P` primary/official
carries the design, `S` secondary is context, `L` lead-only is a hint and never proof.

| URL | Type | Title | Retrieved | Used for |
|---|---|---|---|---|
| https://umfa.utah.edu/what-is-provenanceand-why-does-it-matter/ | S | What Is Provenance—and Why Does It Matter? - Utah Museum of Fine Arts | 2026-10-04 | phase 0: How provenance, attestation and integrity standards record and verify evidence, as a benchmark for Fetchproof's hash-chained ledger |
| https://faircookbook.elixir-europe.org/content/recipes/reusability/provenance.html | S | 5. Provenance information | 2026-10-04 | phase 0: How provenance, attestation and integrity standards record and verify evidence, as a benchmark for Fetchproof's hash-chained ledger |
| https://link.springer.com/chapter/10.1007/978-3-031-12423-5_8 | S | Why- and How-Provenance in Distributed Environments \| Springer Nature Link | 2026-10-04 | phase 0: How provenance, attestation and integrity standards record and verify evidence, as a benchmark for Fetchproof's hash-chained ledger |
| https://www.w3.org/TR/prov-dm/ | P | PROV-DM: The PROV Data Model | 2026-10-04 | U-1: W3C PROV-DM, the provenance data model - Entity, Activity, Agent, wasGeneratedBy, wasDerivedFrom, generation time |
| https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md | P | attestation/spec/v1/statement.md at main · in-toto/attestation · GitHub | 2026-10-04 | U-2: the in-toto Statement - _type, subject digests, predicateType, predicate |
| https://github.com/in-toto/attestation/blob/main/spec/v1/envelope.md | P | attestation/spec/v1/envelope.md at main · in-toto/attestation · GitHub | 2026-10-04 | U-2: the in-toto Envelope - the DSSE signing envelope, payloadType and signatures |
| https://github.com/in-toto/attestation/blob/main/spec/README.md | P | attestation/spec/README.md at main · in-toto/attestation · GitHub | 2026-10-04 | U-2: the attestation framework overview - the layers (Envelope, Statement, Predicate, Bundle) and what each binds |
| https://docs.sigstore.dev/logging/overview/ | P | Rekor - Sigstore | 2026-10-04 | U-3: Rekor overview - the transparency log, the signed entry timestamp and the inclusion proof |
| https://www.rfc-editor.org/rfc/rfc3161 | P | RFC 3161: Internet X.509 Public Key Infrastructure Time-Stamp Protocol (TSP) \| RFC Editor | 2026-10-04 | U-4: RFC 3161 Time-Stamp Protocol - what a time-stamp token proves about when a datum's hash existed |
| https://www.rfc-editor.org/rfc/rfc6962 | P | RFC 6962: Certificate Transparency \| RFC Editor | 2026-10-04 | U-5: RFC 6962 Certificate Transparency - the Merkle tree hash, the audit path and the consistency proof |
| https://www.rfc-editor.org/rfc/rfc8785 | P | RFC 8785: JSON Canonicalization Scheme (JCS) \| RFC Editor | 2026-10-04 | U-6: RFC 8785 JSON Canonicalization Scheme - number serialization, string escaping, property sorting, Unicode |
| https://slsa.dev/spec/v1.0/provenance | P | SLSA • Provenance | 2026-10-04 | U-7: SLSA provenance predicate v1.0 - buildDefinition, runDetails, builder, resolvedDependencies |
| https://github.com/sigstore/rekor/blob/main/openapi.yaml | P | rekor/openapi.yaml at main · sigstore/rekor · GitHub | 2026-10-04 | U-3: Rekor's OpenAPI definition - the owner of inclusionProof (logIndex, rootHash, treeSize, hashes, checkpoint) and signedEntryTimestamp (signature over logID, logIndex, body and integratedTime); collected in a second run because /logging/sign-verify/ answered HTTP 404 |
