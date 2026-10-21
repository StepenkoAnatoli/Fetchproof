# Brief - How provenance, attestation and integrity standards record and verify evidence, as a benchmark for Fetchproof's hash-chained ledger

_Auto-drafted 2026-10-04 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
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

## What we verified

| Claim | Source | Type |
|---|---|---|
| W3C PROV-DM (Recommendation of 30 April 2013) defines provenance as what lets a consumer judge trust [quote: Provenance is information about entities, activities, and people involved in producing a piece of data or thing, which can be used to form assessments about its quality, reliability or trustworthiness]. Its three core types: [quote: An entity is a physical, digital, conceptual, or other kind of thing with some fixed aspects] [quote: An activity is something that occurs over a period of time and acts upon or with entities] [quote: An agent is something that bears some form of responsibility for an activity taking place, for the existence of an entity, or for another agent's activity]. Generation binds an entity to the activity that produced it and to a time [quote: Generation is the completion of production of a new entity by an activity] [quote: written wasGeneratedBy(id; e, a, t, attrs) in PROV-N] [quote: an OPTIONAL identifier (a) for the activity that creates the entity] [quote: the time at which the entity was completely created]. Derivation binds a new entity to the one it came from, with the activity, generation and usage optional [quote: A derivation is a transformation of an entity into another, an update of an entity resulting in a new one, or the construction of a new entity based on a pre-existing entity] [quote: usedEntity: the identifier (e1) of the entity used by the derivation] [quote: an OPTIONAL identifier (a) for the activity using and generating the above entities]; a bare wasDerivedFrom(e2, e1) is allowed but then [quote: no information is provided as to the identity of the activity (and usage and generation) underpinning the derivation]. Responsibility is a separate relation [quote: Attribution is the ascribing of an entity to an agent]. Read against the kit's ledger entry: the capture is e2, the page at the URL is e1, the fetch is the activity (named only by its transport), the day-granular `at` is the generation time, and the source HTML beside the capture (ADR-0140) is an intermediate entity; PROV's agent - who or what ran the collector and bears responsibility - has no field in the entry. | E-04 `w3.org` (U-1) | P |
| The in-toto Statement (spec v1) is the layer that binds an attestation to what it is about [quote: The Statement is the middle layer of the attestation, binding it to a particular subject and unambiguously identifying the types of the Predicate]. Its fields: `_type` [quote: Identifier for the schema of the Statement], `subject` [quote: Set of software artifacts that the attestation applies to] where [quote: Each element MUST have digest set] and [quote: Subjects are assumed to be immutable]; matching is by digest alone [quote: Subject artifacts are matched purely by digest, regardless of]; `predicateType` [quote: URI identifying the type of the Predicate]; `predicate` is optional. The producer's identity is not a Statement field - it is carried by the Envelope's signature (E-06). Read against the kit: a ledger entry's `bodySha256` plus `raw` is a one-element subject; the entry has no `_type` or `predicateType` naming its own schema version. | E-05 `github.com` (U-2) | P |
| The in-toto Envelope is where authentication lives [quote: The Envelope is the outermost layer of the attestation, handling serialization and authentication (via digital signatures)], and its recommended form is DSSE [quote: The RECOMMENDED format and protocol for Envelopes are defined per DSSE v1.0]. Requirements: [quote: signatures (or equivalent) is REQUIRED and MUST be defined as an array of digital signatures]; [quote: payloadType (or equivalent) MUST be signed along with the payload]; a key hint [quote: SHOULD support a hint indicating what signing key was used, i.e., a KEYID]; and a design rule the kit's chain hash bears on [quote: SHOULD avoid depending on canonicalization for security]. A consumer gets authenticated predicate data only through the signature [quote: To obtain predicate information that is authenticated, consumers MUST parse the Envelope's payload, and verify it against its signatures]. Read against the kit: the ledger has no envelope, no signature and no key id; its entries are authenticated by nothing but the repository they travel in. | E-06 `github.com` (U-2) | P |
| The framework's README defines an attestation as authenticated metadata [quote: An in-toto attestation is authenticated metadata about one or more software artifacts] meant for machines [quote: The intended consumers are automated policy engines], in four layers: [quote: Statement: Binds the attestation to a particular subject and unambiguously identifies the types of the predicate] and [quote: Envelope: Handles authentication and serialization], plus Predicate and Bundle. Versioning is explicit: the Statement's `_type` stays `https://in-toto.io/Statement/v1` across minor releases and changes only on a major [quote: A new v2 directory is added to /spec and the _type of a Statement becomes https://in-toto.io/Statement/v2]. Latest version v1.2 at retrieval. | E-07 `github.com` (U-2) | P |
| Rekor's overview (owner page) states what the log is for [quote: Rekor aims to provide an immutable, tamper-resistant ledger of metadata generated within a software project's supply chain] and what a third party gets from it [quote: Other parties can then query this metadata, enabling them to make informed decisions on trust and non-repudiation]. The CLI can [quote: query the log for inclusion proof, integrity verification of the log or retrieval of entries], and the append-only property is externally checkable [quote: Auditors can monitor the log for consistency, meaning that the log remains append-only and entries are never mutated or removed] - by the Rekor monitor or an omniwitness, i.e. parties other than the writer. This page does not define the signed entry timestamp; the inclusion proof's fields are in E-13. Read against the kit: the ledger's chain is verified only by re-reading the whole file on the machine that holds it; nobody outside can be asked whether an entry was ever there or whether the head moved. | E-08 `docs.sigstore.dev` (U-3) | P |
| Rekor's OpenAPI definition (sigstore/rekor, main) defines the inclusion proof a verifier receives: `logIndex` [quote: The index of the entry in the transparency log], `rootHash` [quote: The hash value stored at the root of the merkle tree at the time the proof was generated], `treeSize` [quote: The size of the merkle tree at the time the inclusion proof was generated], `hashes` [quote: A list of hashes required to compute the inclusion proof, sorted in order from leaf to root], and `checkpoint` [quote: The checkpoint (signed tree head) that the inclusion proof is based on] - all five required. The signed entry timestamp is NOT in this markdown capture: GitHub's blob view renders only part of a 670-line file as text and keeps the rest in an embedded JSON payload, so the capture (graded full by the collector) stops before the LogEntry definition. The page's source HTML beside the capture (`.source.html`, same ledger entry, ADR-0140) does carry it - `signedEntryTimestamp`, described as a signature over the logID, logIndex, body and integratedTime, verified by canonicalizing the entry per RFC 8785 against Rekor's public key - but that file is not a capture and is not cited as evidence; the brief names it as a known unknown with the day-one step. | E-13 `github.com` (U-3) | P |
| RFC 3161 (August 2001, Standards Track) states what a time-stamp proves [quote: A time-stamping service supports assertions of proof that a datum existed before a particular time] [quote: The TSA's role is to time-stamp a datum to establish evidence indicating that a datum existed before a particular time]. The authority is required [quote: to use a trustworthy source of time], [quote: to include a trustworthy time value for each time-stamp token], [quote: to only time-stamp a hash representation of the datum], and [quote: not to examine the imprint being time-stamped in any way] - so the token proves when a hash existed, not what the datum says. Each token is signed [quote: The TSA MUST sign each time-stamp message with a key reserved] for that purpose, and its time is the authority's [quote: genTime is the time at which the time-stamp token has been created by the TSA], in UTC, with a serial number unique per TSA. Read against the kit: the ledger's `at` is written by the collector's own clock, at day granularity, with no signature; it asserts a time, it does not prove one. | E-09 `rfc-editor.org` (U-4) | P |
| RFC 6962 (June 2013, Experimental) defines the log as [quote: publicly auditable, append-only, untrusted logs] and says what makes append-only provable [quote: The append-only property of each log is technically achieved using Merkle Trees, which can be used to show that any particular version of the log is a superset of any particular previous version]; equivocation is detectable [quote: if a log attempts to show different things to different people, this can be efficiently detected by comparing tree roots and consistency proofs]. The Merkle Tree Hash: leaves are the hashed entries [quote: The hashing algorithm is SHA-256] [quote: The output is a single 32-byte Merkle Tree Hash], an empty tree hashes the empty string, a leaf is SHA-256(0x00 \|\| d) and an interior node SHA-256(0x01 \|\| left \|\| right) (section 2.1). An audit path proves membership [quote: If the root computed from the audit path matches the true root, then the audit path is proof that the leaf exists in the tree]; a consistency proof proves the prefix relation between two sizes [quote: Merkle consistency proofs prove the append-only property of the tree] [quote: is the list of nodes in the Merkle Tree required to verify that the first m inputs D[0:m] are equal in both trees]. Read against the kit: a linear hash chain gives a holder of an old head no way to check the new head extends it short of re-hashing every entry, and no way to detect two different ledgers served to two readers; the Merkle construction is what provides both in logarithmic size. | E-10 `rfc-editor.org` (U-5) | P |
| RFC 8785 (June 2020, Informational) fixes a serialization so a hash or signature over JSON is reproducible. Preconditions: [quote: JSON objects MUST NOT exhibit duplicate property names], numbers are IEEE 754 doubles, and [quote: parsed JSON string data MUST NOT be altered during subsequent serializations]. Rules: [quote: Whitespace between JSON tokens MUST NOT be emitted]; strings [quote: each Unicode code point MUST be serialized as described below] - control characters as lowercase \uhhhh except the predefined escapes, everything else as is except backslash and double quote; numbers per ECMAScript's Number-to-string algorithm, and [quote: occurrences of NaN or Infinity MUST cause a compliant JCS implementation to terminate with an appropriate error]; properties sorted because otherwise [quote: JSON object properties are not in lexicographic (alphabetical) order] - [quote: Property name strings to be sorted are formatted as arrays of UTF-16] and [quote: The sorting is based on pure value comparisons, where code units are treated as unsigned integers, independent of locale settings], while [quote: but array element order MUST NOT be changed]; finally [quote: the result of the preceding step MUST be encoded in UTF-8]. Read against the kit: whether the chain hash is taken over a JCS-canonical form of the entry or over whatever JSON.stringify emitted decides whether the Python conformance runner, or any other verifier, can recompute it; the lead reads lib/provenance.mjs for that. | E-11 `rfc-editor.org` (U-6) | P |
| SLSA's provenance predicate v1.0 [quote: "predicateType": "https://slsa.dev/provenance/v1"] is [quote: Provenance is an attestation that a particular build platform produced a set of software artifacts through execution of the buildDefinition]. The builder is an identity, not a tool name [quote: The builder.id identifies this platform, representing the transitive closure of all entities that are trusted to faithfully run the build and record the provenance] [quote: URI indicating the transitive closure of the trusted build platform]. Required at Build L1 [quote: REQUIRED for SLSA Build L1: buildDefinition, runDetails]: the buildDefinition (buildType, externalParameters, internalParameters, resolvedDependencies - [quote: Unordered collection of artifacts needed at build time]) and runDetails (builder, metadata with [quote: Identifies this particular build invocation, which can be useful for finding] logs, [quote: The timestamp of when the build started] and finished, byproducts); the definition's completeness is vouched for by the builder [quote: The accuracy and completeness are implied by] runDetails.builder.id. Read against the kit: a ledger entry names the transport (a buildType) and the URL (an external parameter) and the capture (the subject), but no builder identity, no invocation id, no CLI version as a resolved dependency, and - the field SLSA uses for the converted-from text - no byproduct. | E-12 `slsa.dev` (U-7) | P |

## Contradictions and how they were resolved

- **Rekor's "sign-verify" page.** The lead's related-pages hint and the Rekor overview's own
  navigation suggested a sign-and-verify page under `/logging/`; `/logging/sign-verify/`
  answered HTTP 404 on 2026-10-04 (E-08's run, recorded in the ledger as a failed fetch). The
  overview (E-08) carries the append-only and inclusion-proof facts, and the spare scrape went
  to Rekor's OpenAPI definition (E-13), which owns the inclusion proof's fields. Trusted: the
  two captured pages; the 404 is not evidence of anything but the URL.
- **A capture graded `full` that is not the whole page.** The collector graded E-13 (Rekor's
  `openapi.yaml` on github.com) `completeness: full`, and the markdown capture is 9.7 KB of
  a 20.1 KB, 670-line file: GitHub's blob view puts the file's lines in an embedded JSON
  payload and renders only part of them as text, so the `LogEntry` definition with
  `signedEntryTimestamp` is in the `.source.html` beside the capture (485 KB, same ledger
  entry, ADR-0140) and not in the capture. The two are not in contradiction about the
  standard; they disagree about the capture's completeness, and the ledger's grade is the
  one that is wrong. Resolved by citing only what the capture holds and naming the rest as a
  known unknown. This is a finding about the kit, reported to the lead: `full` is a
  transport-level grade (HTTP 200, a body), not a content-level one.
- **PROV-DM's optional fields versus the audit's "must state".** The lead's question asked what
  a provenance record *must* state about a derivation. PROV-DM (E-04) makes the activity,
  generation, usage and generation time all OPTIONAL on `wasDerivedFrom` and `wasGeneratedBy`;
  what it requires is the two entities. So the standard does not fail a record that names only
  source and result - it says such a record provides no information about how. Recorded as
  PROV's position, not averaged with a stricter reading.
- **Corroboration warnings.** Preflight warns that U-4, U-5, U-6 and U-7 each rest on one row
  and that U-2's three rows are all github.com. Each is an RFC or a specification read from its
  owner; a second page would be a page *about* the RFC, which the kit's own rule 4 ranks
  below it. Left as warnings, deliberately.
## Known unknowns

- **Rekor's signed entry timestamp (U-3).** What the SET binds - per the page's source HTML
  beside E-13, a signature over the logID, logIndex, body and integratedTime, verified by
  canonicalizing the entry per RFC 8785 against Rekor's public key - is not in any capture
  of this corpus, so it is not cited as verified. Day-one step: fetch
  `https://raw.githubusercontent.com/sigstore/rekor/main/openapi.yaml` (the raw file, which
  no blob view truncates) on the collector machine and add the row; or read the
  `signedEntryTimestamp` description in
  `research/raw/2026-10-04-rekor-openapi-yaml-at-main-sigstore-reko-github-0459a01e.source.html`,
  which is on disk and hashed in ledger entry 14 but is not a capture.
- **Whether the kit's chain hash is JCS-canonical (U-6).** RFC 8785's rules are verified
  (E-11); whether `lib/provenance.mjs` hashes a canonical form or `JSON.stringify` output is
  a reading of the kit's code, not of a page, and belongs to the lead's audit. Day-one step:
  read the hashing function and compare field order, number handling and escaping with
  E-11's rules; the kit's `ledger-conformance.mjs` vectors say what the kit *claims*.
- **The ledger's time granularity.** Every entry in this project's ledger carries
  `at: 2026-10-04T00:00:00.000Z` - a day, not an instant. Whether that is a deliberate
  privacy choice (an ADR) or an omission is a reading of the kit's record, not a page. It
  matters to U-4: a day-granular, unsigned, self-reported time is further from an RFC 3161
  token than an instant would be.

## Decision

Nothing is built from this project (ADR-0030, ADR-0117). The deliverable is the benchmark
below, which the gap-audit lead reads against `research/raw/.fetches.jsonl` and
`lib/provenance.mjs`; the agent collected, the lead judges. Any change it suggests enters
through an ADR that lifts the freeze for that one item.

**The benchmark: what each standard makes a verifier's trust rest on, and what the ledger entry carries.**

| Standard | What a verifier is given | Ledger entry today (as this corpus's ledger shows) | Source |
|---|---|---|---|
| PROV-DM (U-1) | derived entity, source entity, the activity, the agent responsible, the generation time - activity/agent/time optional, but a record without them provides no information about *how* | capture hash and path (e2), URL (e1), transport (activity type), day-granular `at`; no agent | E-04 |
| in-toto Statement (U-2) | subject digests (required, matched by digest alone), `_type` schema id, `predicateType` | `bodySha256` + `raw` (a subject); no schema id, no predicate type | E-05, E-07 |
| DSSE Envelope (U-2) | an array of signatures over `payloadType` + `payload`, a key id; authenticated data only through the signature; do not depend on canonicalization for security | no signature, no key id, no producer identity; integrity rests on the hash chain and on git | E-06 |
| Rekor (U-3) | an append-only log that auditors and witnesses other than the writer monitor; an inclusion proof (logIndex, rootHash, treeSize, leaf-to-root hashes, signed checkpoint); a signed entry timestamp (not in a capture - known unknown) | a local chain verified by re-reading the file on the machine that holds it; no third party can be asked whether an entry existed or whether the head moved | E-08, E-13 |
| RFC 3161 (U-4) | a signed token from a TSA with a trustworthy time source, over the hash only, that proves the hash existed before `genTime` | `at` written by the collector's own clock, at day granularity, unsigned | E-09 |
| RFC 6962 (U-5) | a Merkle Tree Hash; an audit path proving membership; a consistency proof proving size n extends size m; equivocation detectable by comparing roots | a linear chain: proving the new head extends an old one means re-hashing every entry; two ledgers served to two readers cannot be told apart | E-10 |
| RFC 8785 (U-6) | a canonical serialization (no whitespace, sorted keys by UTF-16 code units, ECMAScript numbers, fixed string escaping, UTF-8) so a hash over JSON is reproducible across implementations | the entry is JSON; whether the chain hash is over a canonical form is a reading of `lib/provenance.mjs` (known unknown) | E-11 |
| SLSA provenance (U-7) | `builder.id` as the trusted platform's identity, `buildType`, external and internal parameters, resolved dependencies, invocation id, start and finish timestamps, byproducts | transport (a build type), URL (an external parameter), capture (subject), `.source.html` (a byproduct, hashed); no builder identity, invocation id or CLI version | E-12 |

**Out of scope.** Implementing any of the above; choosing between them; whether the kit
*should* sign, witness or time-stamp - those are the lead's and an ADR's. Rekor's SET and the
kit's canonicalization are the two facts this corpus does not settle (Known unknowns).

**First step for the lead.** Read `lib/provenance.mjs` with E-11 open and the ledger's `at`
with E-09 open; then decide, per row of the table, whether the gap is accepted (and say so in
the audit) or lifted by an ADR.
## Next steps

1. The TODO sections (Contradictions, Decision) are answered above; the lead reads the benchmark table and the two known unknowns.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.
<!-- fetchproof:brief-draft body=23b35e5b2b4875e6 inputs=abb059bed59d035b gate=pass -->
