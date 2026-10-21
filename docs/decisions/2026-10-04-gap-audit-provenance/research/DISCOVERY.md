# Discovery Contract - How provenance, attestation and integrity standards record and verify evidence, as a benchmark for Fetchproof's hash-chained ledger

Started 2026-10-04. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Benchmark Fetchproof's evidence ledger against the provenance, attestation and integrity
standards below. The ledger is `research/raw/.fetches.jsonl`: one entry per fetch with the
URL, the sha256 of the capture, a link to the previous entry and the transport that ran, in
a chain that the collector writes and that `preflight.mjs` verifies by recomputing the hashes.
It is self-attested: the machine that fetched is the machine that vouches, with its own clock
and no signature. This is a documentation benchmark for a gap audit of the kit - a decision
about the repository (ADR-0030), read by the audit's lead: it compares what the ledger
records with what W3C PROV-DM says a derivation must state, what an in-toto attestation
binds and how a DSSE envelope signs it, what a Sigstore Rekor inclusion proof and signed
entry timestamp give a verifier that a local chain cannot, what an RFC 3161 time-stamp token
proves about when a hash existed, how RFC 6962 proves an append-only log consistent between
two sizes, which RFC 8785 canonicalization rules a reproducible hash over JSON must follow,
and (budget permitting) what a SLSA provenance predicate records about inputs and the
builder. Nothing is built here: "done" means every unknown below is closed from the owner
page, and the brief carries the benchmark table the audit cites. The kit is feature-frozen
(ADR-0117): any change this benchmark suggests enters through an ADR, not through this
project. The agent collects; the lead judges.

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
| U-1 | Per W3C PROV-DM (D-10): what must a provenance record state about an entity's derivation - wasDerivedFrom, wasGeneratedBy, the activity, the agent and the time - so that a derived artifact (the markdown conversion of a captured page) can be traced to its source? | The kit's ledger entry names a URL, a capture hash, a transport and, since ADR-0140, the source HTML beside the capture; whether that is a complete derivation record or omits something PROV considers necessary (the generating activity, the responsible agent, the generation time) decides whether a consumer can trace a capture to its source without trusting the collector's word. | CLOSED | E-04: PROV-DM records a derivation as wasDerivedFrom(e2, e1) with an optional activity, generation and usage, a generation as wasGeneratedBy(e, a, t) with an optional generation time, and responsibility as attribution to an agent; a bare derivation without activity leaves the how unprovenanced. The ledger entry carries e2 (capture hash), e1 (URL), an activity type (transport), a day-granular time, and no agent. |
| U-2 | Per the in-toto attestation framework (D-11): what does an attestation bind - the subject digests, the predicate type, the producer - and how is it signed (the DSSE envelope)? | The ledger binds a hash to a URL but names no producer identity and carries no signature; if the standard treats the signed envelope and the producer as what makes an attestation verifiable, a consumer's trust in an unsigned ledger entry rests only on the repository it travelled in. | CLOSED | E-05, E-06, E-07: a Statement binds subject digests (required, matched purely by digest), a `_type` schema id and a `predicateType`; the Envelope (DSSE recommended) carries an array of signatures over payloadType plus payload, with a key id hint, and authenticated predicate data is obtained only by verifying the signature. The ledger has no schema id, no predicate type, no signature and no key id. |
| U-3 | Per Sigstore's Rekor documentation (D-12): what do an inclusion proof and a signed entry timestamp give a verifier that a local hash chain cannot - an independent time and an append-only witness? | The kit's chain proves only that nobody edited the file after the last entry the collector wrote; whether an independent log is what the field considers necessary for a verifier to trust that an entry existed at a time, and was not silently rewritten and re-chained, is the audit's central question. | CLOSED | E-08, E-13: Rekor is an append-only log whose consistency auditors and witnesses other than the writer can monitor, and whose inclusion proof hands a verifier logIndex, rootHash, treeSize, the leaf-to-root hashes and a signed checkpoint (signed tree head). The signed entry timestamp's definition is not in a capture (GitHub's blob view omitted it from the rendered text; it is in the source HTML beside E-13) - named in the brief as a known unknown with its day-one step. The ledger offers neither a proof to a third party nor a witness. |
| U-4 | Per RFC 3161 (D-13): what does a time-stamp token prove about when a hash existed, and what does it not prove? | The ledger's `at` is written by the collector's own clock (and at day granularity); a time-stamp token is the standard's answer to "this hash existed before time T" from a party other than the author, and the audit needs the exact claim the token makes to say what the ledger's timestamp lacks. | CLOSED | E-09: a time-stamp token is a TSA's signed assertion that a hash existed before genTime, issued over the hash only (the TSA may not examine the datum), from a trustworthy time source, with a per-TSA serial number. It proves when, not what. The ledger's `at` is self-reported, unsigned and day-granular. |
| U-5 | Per RFC 6962 (D-14): how is the Merkle tree hash defined, and how does a consistency proof show that an append-only log at one size is a prefix of the log at a later size? | A hash chain proves that entry n commits to entry n-1, but a holder of yesterday's chain head cannot check that today's chain extends it without re-reading every entry; the Merkle consistency proof is the standard mechanism for that, and the audit needs the definition to say whether the kit's chain can offer the same property. | CLOSED | E-10: the Merkle Tree Hash (SHA-256, leaf prefix 0x00, node prefix 0x01, empty tree = SHA-256 of empty string); an audit path proves a leaf is in the tree; a consistency proof is the node list proving the first m inputs are equal in both trees, i.e. that size n is a superset of size m, and comparing roots and consistency proofs detects a log showing different things to different people. The ledger's linear chain has no equivalent of either proof. |
| U-6 | Per RFC 8785 (D-15): which canonicalization rules must a hash over a JSON document follow to be reproducible - number formatting, string escaping, property ordering and Unicode handling? | The ledger's `bodySha256` hashes the capture's bytes, but the chain hash covers a JSON entry; if that entry is hashed as whatever `JSON.stringify` emitted, a second implementation (the kit's Python conformance runner, or a verifier in another language) can reproduce the hash only if the serialization is canonical, and the audit needs the rules to judge the kit's. | CLOSED | E-11: no inter-token whitespace, no duplicate names, strings serialized per ECMAScript with lowercase \uhhhh for controls and only backslash and quote escaped, numbers per ECMAScript Number-to-string with NaN and Infinity rejected, object properties sorted by UTF-16 code units as unsigned integers (array order unchanged), output UTF-8. Whether the kit's chain hash is over such a form is for the lead to read in lib/provenance.mjs. |
| U-7 | Per SLSA's provenance predicate (D-16): what does build provenance record about the builder and the inputs (materials, build definition, run details), and at which level is it signed? | SLSA is the industry's predicate for "this artifact was produced by this builder from these inputs"; the kit's ledger entry is a provenance claim of the same shape (this capture by this transport from this URL), so the audit needs the predicate's fields to name what the ledger omits. Optional, budget permitting. | CLOSED | E-12: the predicate requires buildDefinition (buildType, externalParameters, internalParameters, resolvedDependencies) and runDetails (builder.id as the trusted platform's identity, invocationId, startedOn, finishedOn, byproducts); completeness is vouched for by builder.id and the predicate is carried in an in-toto Statement signed by the Envelope (U-2). The ledger has a buildType (transport), an external parameter (URL) and a subject (capture), but no builder identity, invocation id, resolved dependency (CLI version) or byproduct. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

None. The lead set the intent, the seven unknowns and the owner pages; every remaining
question is a fact on a public page.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- This is a nested decision project (ADR-0030); it writes nothing outside its own folder
  except its row in `docs/decisions/README.md` (ADR-0102), which the lead adds.
- Budget: at most 14 scrapes and 3 searches, collected through the Firecrawl CLI; no `--fallback`.
- The review is the agent's (ADR-0107): the brief is authored and declared `Reviewed by: agent`.
- The agent collects and reports; the lead judges whether the ledger lacks what the standards require.
