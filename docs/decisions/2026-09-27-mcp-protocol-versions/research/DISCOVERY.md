# Discovery Contract - Which MCP protocol revisions the kit's stdio server should serve on 2026-09-27: what changed between 2025-06-18 and 2025-11-25 for a tools-only server, and what version negotiation requires

Started 2026-09-27. This file is the definition of "enough information to build".
`node fetchproof/bin/preflight.mjs` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

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
| U-1 | What did revision 2025-11-25 change relative to 2025-06-18, and does any change touch the handshake, tools/list, tools/call results (structuredContent, resource_link), ping or cancellation? | If nothing this server does changed, it serves 2025-06-18 already and can say so. If something did, echoing 2025-06-18 would promise rules it does not follow | CLOSED | E-01. Nothing 2025-11-25 changed touches the handshake, tools/list, the tools/call result shape, ping or cancellation; the additions are optional (icons, an Implementation description) or features this server does not use (authorization, HTTP, elicitation, sampling, tasks). Two rules touch it and hold under both revisions: JSON Schema 2020-12 as the default dialect - the tool schemas use only type, properties, required, additionalProperties, enum, items, minimum and maximum, whose meaning is the same in draft-07 and 2020-12 - and SEP-1303 (U-5). So this server already follows 2025-06-18 [single-witness: the specification's own changelog is the only authority on what its revisions changed; a third party can only restate modelcontextprotocol.io] |
| U-2 | What did revision 2025-06-18 change relative to 2025-03-26 - in particular, is that where structuredContent and resource_link content were introduced? | Decides whether 2025-03-26 is also servable, or whether this server's results use things a 2025-03-26 client does not know | CLOSED | E-02. structuredContent and resource_link content first appear in 2025-06-18, and this server returns both (fetch_corpus). A 2025-03-26 client knows neither, so 2025-03-26 is not servable without changing the results, and is not offered [single-witness: the specification's own changelog is the only authority on what its revisions changed] |
| U-3 | What does version negotiation require of a server on initialize: when must it echo the requested version, what must it answer otherwise, and what does a client do with a version it does not support? | Decides both the echo set and the fallback. The fallback today is the legacy revision, chosen from how one SDK behaves (ADR-0034) | CLOSED | E-03. A server that supports the requested version MUST respond with the same version; otherwise it MUST respond with another it supports, SHOULD be its latest; a client that does not support the reply SHOULD disconnect. So a server that follows 2025-06-18's rules must echo 2025-06-18. The fallback stays 2025-11-25, not the latest (2026-07-28): a documented departure from a SHOULD (ADR-0034), because neither SDK release in this corpus lists 2026-07-28 (U-4) [single-witness: the specification is the only authority on its own negotiation rules] |
| U-4 | Which revisions does the official TypeScript SDK's client request and accept, and from which release does it request 2025-11-25? | Says which real clients the current answer disconnects - how old they are and how many releases - and so whether the change reaches anybody | CLOSED | E-04, E-05, E-06. The official TypeScript SDK asks for 2025-06-18 and does not accept 2025-11-25 up to and including 1.24.0 (published 2025-12-02); 1.25.0 (2025-12-15) is the first that asks for 2025-11-25, and it still accepts 2025-06-18. So a client built on any SDK release before 2025-12-15 disconnects from this server today |
| U-5 | How must a server report a tools/call whose arguments fail the tool's input schema - a JSON-RPC protocol error, or a tool result with isError? | This server answers invalid arguments with JSON-RPC -32602. If the revisions it serves say otherwise, a model that sent a bad argument gets an exception instead of something it can correct | CLOSED | E-01. SEP-1303, in 2025-11-25: "input validation errors should be returned as Tool Execution Errors rather than Protocol Errors to enable model self-correction". An unknown tool stays a protocol error; an argument that fails the schema becomes a tool result with isError [single-witness: the specification's own changelog is the only authority on its rules] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.
