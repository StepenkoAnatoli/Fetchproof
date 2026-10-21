# Brief - MCP Model Context Protocol specification 2025-11-25 changelog vs 2025-06-18 version negotiation

_Auto-drafted 2026-09-27 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## The prior, registered before anything was collected

_Ledger seq 1, chained: neither this text nor its place before the evidence
can be changed now. Read it against the findings below - it may well be wrong, and a wrong
prior that was recorded in advance is worth more than a right one remembered afterwards._

> Expect: the 2025-11-25 changelog lists authorization and discovery changes (OpenID Connect, client ID metadata documents), icons, URL-mode elicitation, sampling with tools and experimental tasks - none of which touches initialize, tools/list, tools/call, ping or cancellation for a stdio server that uses no authorization. Expect the 2025-06-18 changelog to be where structured tool output (structuredContent, outputSchema) and resource links in tool results arrived, and where JSON-RPC batching was removed - so a 2025-03-26 client cannot read this server's results and must not be offered 2025-03-26. Expect the lifecycle page to say a server MUST echo a requested version it supports, and otherwise MUST answer with another it supports, SHOULD be its latest; a client that does not support the answer SHOULD disconnect. Already seen while locating sources, so not a prediction: SDK 1.24.0 declares LATEST 2025-06-18 without 2025-11-25 in its supported list, and 1.25.0 is the first with 2025-11-25. Cannot know yet: whether any shipped client still runs an SDK older than 1.25.0 - no document says what a vendor bundles.

## Intent

The kit's MCP server (`fetchproof/bin/mcp-server.mjs`, ADR-0034) serves protocol revisions
`2026-07-28` and `2025-11-25`. On the legacy `initialize` handshake it echoes a requested revision
it serves, and answers anything else with `2025-11-25`. On 2026-09-27 a round trip from a cloud
container asked for `2025-06-18` and got `2025-11-25` back. A client whose newest revision is
`2025-06-18`, and that does not list `2025-11-25`, refuses that reply and disconnects - the same
failure ADR-0034 names for the modern revision. The server uses four protocol features:
`initialize`, `tools/list`, `tools/call` (results with `structuredContent` and
`resource_link` content), and `ping`.

"Done" is:

1. the server echoes every revision whose rules, for what this server does, are the ones it
   already follows, and no revision whose rules differ;
2. for a revision it cannot serve, it answers as the specification says a server must;
3. the decision records which clients each revision reaches, from the SDK they are built on.

## What we verified

| Claim | Source | Type |
|---|---|---|
| Revision 2025-11-25 changed, relative to 2025-06-18: authorization and its discovery (OpenID Connect, incremental scope consent, Client ID Metadata Documents, RFC 9728), icons and an optional Implementation description, tool-name guidance, elicitation (URL mode, enum schemas, defaults), sampling with tools, experimental tasks, Streamable HTTP and SSE rules, JSON Schema 2020-12 as the default dialect, and SEP-1303 - "input validation errors should be returned as Tool Execution Errors rather than Protocol Errors". Nothing in it changes the initialize handshake, tools/list, the shape of a tools/call result, ping or cancellation. | E-01 `modelcontextprotocol.io` (U-1, U-5) | P |
| Revision 2025-06-18 changed, relative to 2025-03-26: JSON-RPC batching removed; structured tool output and resource links in tool call results added; a title field; elicitation; OAuth resource-server rules; the MCP-Protocol-Version header on HTTP. structuredContent and resource_link content both first appear here, so a 2025-03-26 client knows neither. | E-02 `modelcontextprotocol.io` (U-2) | P |
| Version negotiation (2025-11-25 lifecycle): the client MUST send a version it supports, SHOULD be its latest. If the server supports the requested version it MUST respond with the same version; otherwise it MUST respond with another version it supports, SHOULD be its latest. A client that does not support the version in the response SHOULD disconnect. | E-03 `modelcontextprotocol.io` (U-3) | P |
| The official TypeScript SDK at 1.24.0 declares LATEST_PROTOCOL_VERSION = 2025-06-18 and SUPPORTED_PROTOCOL_VERSIONS = [2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07]: a client built on it asks for 2025-06-18 and does not accept 2025-11-25. | E-04 `cdn.jsdelivr.net` (U-4) | P |

## Contradictions and how they were resolved

**The specification and ADR-0034 disagree on the fallback, deliberately.** E-03 says a server
that cannot serve the requested version SHOULD answer with its latest, which is 2026-07-28.
ADR-0034 answers with 2025-11-25 instead, because a client asking for a version this server
cannot place is a legacy client, and neither SDK release here lists 2026-07-28 (E-04, E-05). That is a documented
departure from a SHOULD, and this corpus gives no reason to reopen it.

**An SDK release on a revision's publication date need not carry it.** 1.23.0 was published on
2025-11-25, the revision's own date, and still declared 2025-06-18. This was seen while locating
sources and is not captured; the corpus proves the boundary with 1.24.0 (E-04) and 1.25.0 (E-05).

**The SDK captures read `LATEST\_PROTOCOL\_VERSION`.** Firecrawl turned the JavaScript into
markdown and escaped its underscores and brackets. The values are unchanged; E-04 and E-05
quote them unescaped.

## How the prior held

Right on the four things it predicted, blind to the one that matters most. The 2025-11-25
changelog lists authorization, icons, URL-mode elicitation, sampling with tools and
experimental tasks, and nothing that touches the handshake or tool results. 2025-06-18 is where
structured output and resource links arrived and batching left. The negotiation rules read as
expected. What the prior did not foresee is SEP-1303 (E-01): input validation errors SHOULD be
tool execution errors. This server answers them with JSON-RPC -32602 today, so it breaks a rule
of a revision it already serves.

## Known unknowns

None. Every blocking unknown was closed with primary-source evidence.

## Decision

**Serve 2025-06-18.** `SUPPORTED_VERSIONS` in `fetchproof/lib/mcp.mjs` becomes `2026-07-28,
2025-11-25, 2025-06-18`. The echo rule already in `initialize` then answers a 2025-06-18 client
with 2025-06-18, as E-03 requires of a server that supports it. That server already follows
2025-06-18's rules (U-1). The fallback for anything else stays 2025-11-25 (ADR-0034).

**Report invalid arguments as a tool result.** A `tools/call` whose arguments fail the tool's
schema returns `isError: true` with the reason as text (SEP-1303, U-5). An unknown tool stays
JSON-RPC -32602. This is a separate commit, because it changes what every revision's client
sees.

**Out of scope:** 2025-03-26 and older. This server's results carry `structuredContent` and
`resource_link` content, which those clients do not know (U-2). Serving them would mean a
second result shape. Nobody has asked for it, and both SDK releases in this corpus already ask for
2025-06-18 or newer (E-04, E-05).

**First step:** a test that `initialize` with 2025-06-18 is answered 2025-06-18, and with
2025-03-26 still 2025-11-25. Then the constant.

## Next steps

1. Reviewed 2026-09-27; no **TODO** remains.
2. Hand this file to the builder (phase 2). Re-running `node bin/brief.mjs`
   after edits will refuse without `--force` so your judgements are preserved.
