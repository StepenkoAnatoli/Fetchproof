# Brief - Model Context Protocol MCP server transports authentication and long running tool calls

_Auto-drafted 2026-09-21 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
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

## Intent

Decide whether Fetchproof should expose its collector as a **Model Context Protocol
server**, and if so on which transport, or whether the REST-and-CLI seam that already
exists (`bin/collect-remote.mjs`, `lib/dispatch.mjs`) is the right interface for an agent.

The operator's goal is that any agent they build can run a collection. Today that means
handing the agent a fine-grained GitHub token and letting it run one command. MCP is the
standard way an agent acquires a tool, so the question is whether adopting it buys
anything the current seam does not already provide - and what it would cost.

"Done" is a decision a builder can act on: which transport, what the credential story is,
and whether a collection that takes minutes fits the protocol's request model at all.

## What we verified

| Claim | Source | Type |
|---|---|---|
| **Two standard transports, one set of semantics, and servers cannot speak first.** "Protocol semantics are identical on every transport. A transport is a **binding**: it defines how messages are framed and delivered ... It does not define what the messages mean." The two standard bindings are `stdio` - "newline-delimited messages over the standard streams of a client-launched subprocess" - and `Streamable HTTP`, where "each message is an HTTP POST to a single MCP endpoint; replies arrive as a JSON object or a request-scoped SSE stream". The constraint that shapes any long-running tool: a binding "**MUST** deliver client-sent *requests* and *notifications* to the server, and server-sent *responses* and *notifications* to the client. No other message direction exists: ... servers do not initiate JSON-RPC requests and clients do not send JSON-RPC responses." Cancellation is per-binding - "on stdio the client sends a `notifications/cancelled` notification; on Streamable HTTP it closes the request's response stream" - while "the protocol-level rules are the same everywhere". Custom transports are permitted but "**MUST** preserve the JSON-RPC message format, the message patterns, and the per-request metadata model", and one over a reliable byte stream "**SHOULD** reuse the stdio framing". Note for anyone reading older material: this revision removed the connection-scoped `initialize` session and the server's ability to initiate requests, both of which earlier revisions had. Re-graded **P** from the collector's S: this is the specification. | E-03 `modelcontextprotocol.io` (U-1, U-2, U-5) | P |
| **Authorization is optional, and a local server may use the credential it already has.** The page states it plainly - "While authorization for MCP servers is **optional**, it is strongly recommended when" the server touches user-specific data, needs an audit trail, grants API access requiring consent, targets enterprise environments, or meters per user. The clause that decides this project: "For MCP servers using the STDIO transport, you can use environment-based credentials or credentials provided by third-party libraries embedded directly in the MCP server instead. Because a STDIO-built MCP server runs locally, it has access to a range of flexible options ... that may or may not rely on in-browser authentication". OAuth is scoped to the other case: "OAuth flows, in turn, are designed for HTTP-based transports where the MCP server is remotely-hosted". A **remote** server must implement the whole chain, and the page walks all five steps: a `401` carrying `WWW-Authenticate: Bearer realm="mcp", resource_metadata="..."`; a Protected Resource Metadata document (RFC 9728) at a well-known path listing `authorization_servers` and `scopes_supported`; authorization-server metadata discovery via OIDC Discovery or RFC 8414; client registration, either pre-registered or Dynamic Client Registration, with the page noting that where neither exists "it's the responsibility of the client developer to provide an affordance for the end-user to enter client information manually"; then a browser authorization-code exchange. Re-graded **P** from the collector's S: modelcontextprotocol.io is the protocol's own documentation site, not a commentator. | E-01 `modelcontextprotocol.io` (U-3, U-4) | P |
| **A tool returns a LINK to a large artifact, not the bytes - and the spec sets no size limit.** Tool results carry "structured or unstructured content"; unstructured content is a `content` array that "can contain multiple content items of different types" - text, image, audio, resource links and embedded resources. The item that answers this project: `resource_link`, where "A tool **MAY** return links to Resources ... the tool will return a URI that can be subscribed to or fetched by the client", shaped `{"type":"resource_link","uri":"file:///...","name":...,"mimeType":...}`. An `embedded resource` also exists, inlining the content, and a server using one "**SHOULD** implement the `resources` capability". Two cautions a builder needs. First, **no maximum size appears anywhere on this page** - the mechanism is defined, the ceiling is not, so a 71 KB corpus ZIP is not known to be safe to embed and a link is the defensible choice. Second, a returned link "is not guaranteed to appear in the results of a `resources/list` request", so the client must use the URI it was handed rather than expecting to rediscover it. Also relevant to credential hygiene: parameters may be mirrored into HTTP headers via `x-mcp-header`, and the page warns developers "**SHOULD NOT** mark sensitive parameters (passwords, API keys, tokens, PII)" that way "as header values are visible to network intermediaries". | E-04 `modelcontextprotocol.io` (U-6) | P |
| **Version is declared per request, there is no handshake, and the rejection is a typed error a client can act on.** "There is no negotiation handshake. Every request carries its protocol version, and the server accepts or rejects each request independently." The version travels in `_meta`, and on HTTP also in an `MCP-Protocol-Version` header. A server that does not implement the requested version "**MUST** respond with an `UnsupportedProtocolVersionError`" - JSON-RPC code `-32022` - carrying `data.supported` and `data.requested`, and the client "**SHOULD** select a mutually supported version from the `supported` list and retry". Servers "**MUST** implement `server/discover`" so a client MAY learn supported versions up front, but is not required to. The page also names the break E-03 alluded to, and dates it: **modern** revisions (`2026-07-28` and later) carry version, identity and capabilities as per-request metadata; **legacy** ones (`2025-11-25` and earlier) establish a session with an `initialize` handshake; a **dual-era** implementation supports both. This closes D-11 only partly and honestly: it settles how a version mismatch is DETECTED and recovered from, which is what a builder needs. It says nothing about who governs the specification or how often a break may arrive - see the brief. | E-05 `modelcontextprotocol.io` (U-7) | P |
| **The fact the website does not lead with: MCP is not Anthropic's to change alone.** "Model Context Protocol has been established as Model Context Protocol a Series of LF Projects, LLC", and "changes approved as per the provisions of this governance document must also be approved by LF Projects, LLC." A second, legally distinct party sits above the maintainers. **This row is short and it earns its place**: at 4.7 KB it is a stub next to E-09's 11 KB, it mentions Core Maintainer once where E-09 says it twenty-four times, and it carries the one fact E-09 does not - which is why the two are not the same document despite covering the same subject. | E-10 `github.com` (U-8) | P |

## Contradictions and how they were resolved

**One, and it is the reason E-02 is graded secondary rather than primary.**

E-02, a community MCP server-development guide, says a sender whose request times out
"**SHOULD** issue a `$/cancelRequest` notification (as defined in the spec's Utilities
section)".

E-03, the specification itself, says cancellation is per-binding: "on stdio the client
sends a `notifications/cancelled` notification; on Streamable HTTP it closes the
request's response stream".

`$/cancelRequest` is **Language Server Protocol** syntax, not MCP. The guide is
describing the right idea with the wrong wire format, and it attributes it to a
specification section that does not say that. Resolved in favour of E-03 without
hesitation: one source is the protocol and the other is a reading of it.

The row is kept rather than deleted, for two reasons. It carries operational detail the
two spec pages collected do not - timeouts SHOULD exist, MAY reset on
`notifications/progress`, SHOULD have an overall maximum; `ping` works as a keep-alive;
Streamable HTTP uses SSE when one request produces many messages. And it is the clearest
demonstration in this corpus of why the primary/secondary grading is load-bearing: a
secondary source restating a spec can restate it wrongly, and the only thing that settles
it is going to the spec.

No other disagreement was found. E-01, E-03, E-04 and E-05 are four pages of one
specification site and are consistent with each other.

## Known unknowns

None. Every blocking unknown was closed with primary-source evidence.

## Decision

**Build the MCP server as a local `stdio` server, wrapping the collector the REST seam
already drives. Do not build a remote HTTP server.**

The evidence makes this a short decision:

1. **stdio, not Streamable HTTP.** Protocol semantics are identical on both (E-03), so
   this is not a capability trade - it is an operational one. A stdio server is "a
   client-launched subprocess" on the operator's own machine. A remote one needs hosting
   and, per E-01, the entire OAuth 2.1 chain before an agent can say hello: a `401` with
   `WWW-Authenticate`, a PRM document at a well-known path (RFC 9728), authorization
   server metadata discovery, client registration or DCR, and a browser consent round
   trip. That is an identity product, and nothing in the operator's stated goal - "any
   agent I create should be able to use the collector" - asks for one.

2. **The credential needs no new mechanism.** E-01 permits a stdio server to use
   "environment-based credentials". `tokenFromEnv` already does exactly that and already
   refuses to take a token as an argument (ADR-0033). The MCP server inherits both
   properties by calling the existing seam rather than reimplementing it.

3. **Return a `resource_link`, never the bytes.** E-04 defines the mechanism and,
   importantly, sets **no maximum size** for an embedded resource. A 71 KB corpus ZIP is
   not known to be safe to inline, and a `file://` URI on the client's own machine is
   both defensible and trivially correct for a local server. The client must use the URI
   it is handed: a returned link "is not guaranteed to appear in the results of a
   `resources/list` request".

4. **Model the collection as one held-open request with progress, and pin the revision.**
   A server cannot speak first - "servers do not initiate JSON-RPC requests" (E-03) - so
   there is no "I will call you back". The work happens inside the `tools/call` while
   `notifications/progress` keep the client's timeout alive (E-02), and cancellation is
   `notifications/cancelled` on stdio (E-03). Declare `2026-07-28` on every request and
   handle `UnsupportedProtocolVersionError` / `-32022` by reading `data.supported` and
   retrying (E-05) - the same discipline as pinning `X-GitHub-Api-Version`, and for the
   same reason.

**The tool surface should be two calls, not one.** `collect` starts a run and returns the
`workflow_run_id` immediately; `fetch_corpus` takes that id and returns a
`resource_link` to the validated package. That mirrors what `collect-remote.mjs` already
does internally, keeps a several-minute collection from depending on one unbroken
connection, and gives an agent something to retry against if its process dies.

**Explicitly out of scope:**

- **A remote/hosted MCP server**, until somebody other than the operator needs to reach
  it. The whole of E-01's OAuth chain is deferred with it.
- **Embedded-resource returns**, until the specification states a size limit.
- **Replacing `collect-remote.mjs`.** The MCP server should call the same
  `lib/dispatch.mjs` seam. Two implementations of the dispatch logic is how the package
  name ended up wrong in two workflows at once.
- **Anything about `buildAuthorized`.** A corpus returned over MCP is
  `HUMAN_REVIEW_REQUIRED` exactly as one downloaded by hand is. The transport does not
  review research.

**What this decision does not settle:** who governs the specification and how often a
breaking revision arrives. D-11 records that as dismissed rather than answered - it
changes the planning horizon, not the architecture, because the architecture has to pin a
revision and handle `-32022` whatever the cadence is.

## Next steps

1. Review the **TODO** sections above (Contradictions, Decision) before handing off.
2. Hand this file to the builder (phase 2). Re-running `node bin/brief.mjs`
   after edits will refuse without `--force` so your judgements are preserved.

## Corroboration pass, 2026-09-21

Three captures into the same ledger - eight entries, one chain. Five warnings became two,
and the two that remain were **attempted and failed** rather than skipped.

**U-4 got the best kind of second source there is: the standard itself.** E-06 is RFC 9728,
"OAuth 2.0 Protected Resource Metadata" - the IETF document MCP defers to for the `401` ->
`WWW-Authenticate` -> metadata chain. Different standards body, different process, normative
rather than explanatory. It is the one document that could have *contradicted* the spec
instead of repeating it, which is what separates corroboration from echo.

**U-1 and U-3 got running code.** E-07, the reference TypeScript SDK, ships transports for
exactly the two bindings the spec calls standard, and its minimal stdio server exposes a tool
with **no authorization layer at all** - which is what "authorization is optional" looks like
when somebody implements it.

### The part worth keeping: what the SDK did not corroborate

The SDK was collected expecting it to close U-6 and U-7 as well. It does not. Searched over
the capture rather than assumed:

- **no occurrence of `resource_link`** - so U-6, how a tool returns a 71 KB corpus, still
  rests on `modelcontextprotocol.io` alone
- **no occurrence of `protocolVersion` or version negotiation** - so U-7 does too

One row cited for four unknowns when it supports two is exactly how a corpus inflates, and
the temptation was real: both citations would have gone green and nobody reading the tally
would have known. The row is cited for U-1 and U-3, and `EVIDENCE.md` states the negative.

### U-7 has something better than a second page anyway

It was **measured**. Building this server against the specification produced a server no
client could reach - `-32601: unknown method initialize` - because the shipped SDK implements
the older handshake. That is the whole reason `lib/mcp.mjs` is dual-era, and it is stronger
evidence about "how does a client find out and recover" than any page could be.

It is deliberately **not** filed as an evidence row. A measurement is not a fetched page, and
`unknown-closure/no-evidence` exists to catch precisely that substitution - the same call
made for U-6 of the delivery corpus, and for U-3 of the sea-assets contract.
