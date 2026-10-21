# Discovery Contract - How an AI agent should invoke the Fetchproof collector

Started 2026-09-21. This file is the definition of "enough information to build".
`preflight.mjs` reads it and blocks the build until every unknown below is either `CLOSED`
with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Decide whether Fetchproof should expose its collector as a **Model Context Protocol
server**, and if so on which transport, or whether the REST-and-CLI seam that already
exists (`bin/collect-remote.mjs`, `lib/dispatch.mjs`) is the right interface for an agent.

The operator's goal is that any agent they build can run a collection. Today that means
handing the agent a fine-grained GitHub token and letting it run one command. MCP is the
standard way an agent acquires a tool, so the question is whether adopting it buys
anything the current seam does not already provide - and what it would cost.

"Done" is a decision a builder can act on: which transport, what the credential story is,
and whether a collection that takes minutes fits the protocol's request model at all.

## Unknowns

A fact belongs here when guessing it wrong changes the design.

Status is exactly one of:
- `CLOSED` - proven by an `E-##` row in `research/EVIDENCE.md`.
- `KNOWN-UNKNOWN` - unreachable now; the `Evidence` cell names the day-one verification step.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-1 | Which transports does MCP define, and are protocol semantics the same on each? | Decides whether the collector must be written once or twice, and whether a local and a hosted deployment can share an implementation | CLOSED | E-03: exactly two standard bindings - `stdio` and `Streamable HTTP` - and "Protocol semantics are identical on every transport. A transport is a **binding**". One implementation serves both **Corroborated by E-07**, the reference TypeScript SDK, which ships transports for exactly those two bindings - the spec's claim, in running code on a different host. |
| U-2 | Can an MCP server tell a client that long-running work has finished, or must the client wait on the open request? | A collection takes minutes. If the server cannot initiate contact, the shape is either a held-open stream or polling - and that decides the whole interface | CLOSED | E-03: "servers do not initiate JSON-RPC requests and clients do not send JSON-RPC responses" - no other message direction exists. So a server cannot announce completion out of band. E-02 (secondary) describes the in-band route: a Streamable HTTP reply may be "a request-scoped SSE stream" carrying `notifications/progress` while the request stays open |
| U-3 | Is authorization required, and what does a **local** stdio server need? | Decides whether shipping an MCP server means also shipping an identity system, or whether the existing environment-variable credential is sufficient | CLOSED | E-01: authorization is "**optional**", and for stdio "you can use environment-based credentials or credentials provided by third-party libraries embedded directly in the MCP server instead". The kit's existing `tokenFromEnv` already satisfies this **Corroborated by E-07**: the SDK's minimal stdio server exposes a tool with no authorization layer at all, which is what "optional" looks like when implemented. |
| U-4 | What does a **remote** HTTP MCP server need before an agent can authenticate to it? | This is the cost of the hosted option, and it is the difference between a feature and a product | CLOSED | E-01: the full OAuth 2.1 chain - `401` with `WWW-Authenticate: Bearer resource_metadata=...`, a Protected Resource Metadata document at `/.well-known/oauth-protected-resource` (RFC 9728), authorization-server metadata discovery (RFC 8414 or OIDC Discovery), client registration either pre-arranged or via Dynamic Client Registration, then a browser authorization-code exchange. "OAuth flows ... are designed for HTTP-based transports where the MCP server is remotely-hosted" **Corroborated by E-06**, RFC 9728 itself - the IETF standard this chain is built from, and the one document that could have contradicted the spec rather than repeating it. |
| U-5 | How does a client cancel work in flight, and does the mechanism differ per transport? | The collector spends money. An agent that gives up must be able to stop a run rather than abandon a request and let it bill | CLOSED | E-03: it differs by binding - "on stdio the client sends a `notifications/cancelled` notification; on Streamable HTTP it closes the request's response stream", while "the protocol-level rules are the same everywhere". E-02 names this `$/cancelRequest`, which is wrong; see the brief's contradictions section |
| U-6 | How does a tool hand back an artifact the size of a corpus ZIP? | The output of this collector is a 71 KB package. A tool that cannot return it is not a design, and this was the one load-bearing GAP the gate refused the first brief over | CLOSED | E-04: a `resource_link` content item returns a URI rather than bytes - `{"type":"resource_link","uri":"file:///...","mimeType":...}` - which suits a file on the client machine exactly. Embedding is also permitted but **the spec states no maximum size anywhere on that page**, so a link is the defensible choice rather than the merely available one [single-witness: the reference TypeScript SDK was collected specifically to close this and contains no occurrence of resource_link - searched over the capture, not assumed. The specification is the only document that describes how a tool returns a URI instead of bytes] |
| U-7 | When the protocol changes under a shipped server, how does a client find out and recover? | The protocol has already broken once. If a mismatch is silent or unrecoverable, anything built here rots quietly | CLOSED | E-05: version is declared per request with no handshake, and a server that cannot serve it **MUST** return `UnsupportedProtocolVersionError` (JSON-RPC `-32022`) carrying `data.supported`; the client **SHOULD** pick a mutually supported version and retry. `server/discover` is mandatory on servers so a client MAY ask up front. A break is therefore typed, detectable and recoverable at runtime [single-witness: the reference SDK mentions no version negotiation either. Stronger evidence exists and is not a page - building against the spec produced a server no client could reach, -32601 unknown method initialize, which is why lib/mcp.mjs is dual-era] |
| U-8 | Who controls the MCP specification, and how much warning does a shipped server get before a breaking change? | This project ships an MCP server against a protocol that has ALREADY broken under it once - `lib/mcp.mjs` is dual-era because the spec ran ahead of every client. If the owner can remove a feature without notice, anything built here rots on someone else's schedule | CLOSED | E-10: the project is "a Series of LF Projects, LLC" and governance changes "must also be approved by LF Projects, LLC", so it is not Anthropic's alone. E-09: a published ladder - Lead Maintainers as final authority, Core Maintainers able to veto by majority - and changes arrive through SEPs, a written proposal process. E-11 answers the part that actually binds: deprecated features "keep working for at least twelve months", and the legacy HTTP+SSE transport has "a year-long offramp". A shipped server gets about a year, not a release |

## Questions for the human (maximum 3)

1. Is the intent to publish this collector for other people's agents, or only for agents
   the operator runs? That is the difference between needing the OAuth chain at U-4 and
   never needing it.

## Already decided

- The credential never travels in a tool argument. `tokenFromEnv` is the only way in
  (ADR-0033), and U-3 shows the protocol permits exactly that for a local server.
- Authorization is derived from the corpus, not asserted by a caller (ADR-0032). An MCP
  tool returning an artifact does not change that: the manifest still says
  `buildAuthorized: false` on a fresh corpus.

## Two unknowns left single-sourced, and what was actually tried, 2026-09-21

The corroboration pass closed three of five. The other two were **attempted and failed**,
which is a different thing from not trying, and the corpus should say which.

- **U-6 (returning a corpus-sized artifact).** The reference SDK was collected expecting it
  to show `resource_link` in use. It contains **no occurrence of the term** - checked by
  search over the capture, not assumed. So the claim still rests on
  `modelcontextprotocol.io` alone. The SDK row is cited for U-1 and U-3 only; stretching it
  to cover U-6 would have bought a green check with a citation that does not support it.
- **U-7 (recovering from a protocol version mismatch).** Same outcome from the same capture:
  no `protocolVersion`, no version negotiation. But this unknown has something better than a
  second page - **it was measured.** Building the server against the spec produced a server
  no client could reach (`-32601: unknown method initialize`), because the shipped SDK
  implements the older handshake. That is recorded in ADR-0034 and is why `lib/mcp.mjs` is
  dual-era. It is deliberately **not** filed as an evidence row: a measurement is not a
  fetched page, and `unknown-closure/no-evidence` exists to catch exactly that substitution.

## D-11 closed, 2026-09-22 - the gap this corpus admitted to

`MAP.md` carried D-11 as **GAP - "Not reached for."** It was the only explicit GAP left in
any committed corpus here, and ADR-0034 dismissed it in prose: "Who governs the specification
was never collected and is dismissed with that said plainly: it moves the planning horizon,
not the architecture."

**That dismissal was half right.** It does not change the architecture - the server is still
dual-era stdio either way. It does change the *maintenance* answer, and by a number nobody
had: **twelve months**. A protocol owner who can remove a feature at will and one who owes a
year of notice are different risks to ship against, and the corpus could not tell them apart
while the row said "not reached for".

Three captures, into the same ledger - eleven entries, one chain.
