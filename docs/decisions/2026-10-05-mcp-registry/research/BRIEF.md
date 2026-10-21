# Brief - MCP Registry distribution research

_Auto-drafted 2026-10-06, then reviewed and authored by the agent._

Reviewed by: agent

Research completed 2026-10-06 against kit 0.9.5 and repository main c61b17c.
**Research gate: PASS under pluralist policy, with seven corroboration warnings.**
Nine public questions are closed within their stated scopes. U-10 remains a disclosed
known unknown about operator access and actual downstream catalog admission.
PASS checks this contract and corpus; it does not authorize publication, lift the kit's
freeze, prove source interpretation, or establish real client compatibility.

## Intent

Determine how the existing Node stdio MCP collector could be distributed and listed in
the official MCP Registry, with honest promises about Claude Code, Cursor and VS Code.
This completes the retained research scaffold. No package, server.json, publisher login,
Registry submission or MCP server change is part of this deliverable.

## What we verified

Sources are the 21 primary rows in [EVIDENCE.md](EVIDENCE.md), fetched on 2026-10-06 with
their captures, source siblings and hash-chained ledger in research/raw/.

| Question | Bounded result | Evidence |
|---|---|---|
| Registry role | Metadata points to a public installation route or accessible remote server; a repository link is not an executable distribution. | E-01 |
| Local delivery | npm, OCI and MCPB are among supported routes. npm needs matching mcpName ownership metadata; npm is not mandatory for every server. | E-02, E-03, E-06 |
| Metadata/configuration | The format describes stdio, arguments and secret environment variables; requirements include namespace/package proof and extension size limits. Declare the token requirement, never a token value. | E-03, E-05, E-06 |
| Publisher identity | GitHub or domain authentication establishes namespace access. The documented GitHub organization route requires owner/admin status. This is separate from the runtime Actions token. | E-04, E-06 |
| Freshness/lifecycle | Registry remains in preview. Current repository FAQ describes immutable version metadata and a reversible deleted visibility status that preserves history. Recheck before publication. | E-01, E-07 |
| Client behavior | Claude Code, Cursor and VS Code document explicit installation/configuration and trust or activation. Official Registry publication does not establish that this server appears in every client's catalog. | E-08, E-09, E-10, E-11, E-18 |
| npm access/cost | Scoped packages need explicit public visibility and publisher authentication. npm terms name no public-service usage charge; no Registry-fee or free-collection guarantee is inferred. | E-12, E-13, E-19 |
| License/service boundary | The kit is PolyForm Shield 1.0.0, with Required Notice and restrictions; cached third-party pages are excluded. Preserve those boundaries and review the actual host terms. Registry moderation is not a certification. | E-14, E-17, E-19 |
| Existing server | General launch floor is Node 22+; a configured environment proxy needs 22.21+ or 24+ to avoid direct requests. Environment credential and imported modules remain prerequisites. Remote collection also needs the fork/workflow and protected Firecrawl environment. | E-15, E-20, E-21 |
| Existing decisions | KIT_VERSION remains the version source; ADR-0116 rejects making the current kit an npm package merely to supply a version. ADR-0117 still governs implementation. | E-16; local ADR-0117 |

Warnings from the reviewed whole-project evaluation remain relevant:

- U-01 has one supporting reading (E-01).
- U-02, U-03, U-04, U-05 and U-09 use multiple rows hosted on githubusercontent.com;
  the site-based check counts each set as one voice.
- U-07's three readings belong to npmjs.com and count as one voice.

These are owning documentation/source claims, not independent outcome corroboration.
No extra source was added merely to suppress a warning. Re-run preflight after edits;
this is the evaluation observed while authoring the handoff.

## Contradictions and how they were resolved

The operator's npm assumption came from one tutorial. Package-types documentation
supports other routes (E-02), while E-06 explains its npm example. Therefore npm is a
candidate, not a universal Registry requirement. The earlier npm-name 404 was an
operator observation; it is not retained evidence of present availability or ownership.

E-11 describes automatic downstream updates but also asks for an initial inclusion
request and describes self-publication as future work. Current GitHub docs call the
catalog curated (E-18). Admission and update propagation are distinct; actual admission
of this server stays in U-10. An old prediction is not a current service guarantee.

The captured current repository FAQ describes deleted status as visibility management
and preserves historical metadata (E-07). Do not promise permanent erasure or assume
an older rendered guide supplies the current behavior. Any future publishing work must
validate against the then-current schema/API and retain its new observations.

## Known unknowns

**U-10:** private operator permissions, final scoped package identity/availability and
future catalog admission have not been exercised. Before publication, the operator
confirms the intended npm account/scope and 2FA, authenticates the intended Registry
namespace, and checks name ownership. After an authorized publication, verify the official
API entry and separately search each requested catalog. Until actual placement is
observed, distribute documented manual client configuration and report placement as
unverified. Do not turn a future inquiry or predicted inclusion into a CLOSED result.

Real npm/MCPB/OCI installation, entrypoint completeness, Windows/Linux client launch,
configuration prompts and an end-to-end remote collection are acceptance steps for a
later implementation. None was exercised here. Node smoke tests need no live token;
paid collection needs the operator's existing workflow controls and a small explicit
budget. Client-version and publisher-version changes require fresh verification.

## Decision

**Recommendation, not an accepted packaging design:** evaluate a scoped npm distribution
for the existing Node entrypoint as the first candidate. It matches the documented Node
client workflows. OCI introduces a container prerequisite; MCPB is a documented release
artifact alternative whose target-client support still needs testing. A remote service
changes deployment and authentication and is outside this local-stdio research intent.
These comparisons are engineering inferences from the collected requirements.

## Next steps

The first implementation step is a separate ADR resolving distribution scope, the
ADR-0116 version/package boundary and the exact ADR-0117 freeze exception, if any. It must
preserve KIT_VERSION as the authoritative version, use an explicit runtime-file allowlist,
retain LICENSE/Required Notice, and exclude research corpora, credentials and local logs.
Only after that decision should a builder prepare a reviewable package and server.json,
test installation/launch and perform the operator checks above. Publication is a later
explicit action. This briefing authorizes no publication and makes no catalog-placement
claim.
<!-- fetchproof:brief-draft body=af6be1ac2d12ef3f inputs=e4581fc861bbb81c gate=pass -->
