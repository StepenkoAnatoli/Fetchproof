# ADR-0034 — The collector speaks MCP over stdio, and the brief that decided it passed the gate first

- **Date:** 2026-09-21
- **Status:** accepted; the `createStdioLoop` consequence (one promise chain for every chunk) is superseded by ADR-0172 (2026-10-17): framing is synchronous, `tools/call` keeps its own chain and every other answer is served while a call is in flight (#346, #347)
- **Area:** agent interface, protocol, credentials
- **Evidence basis:** `docs/decisions/2026-09-21-agent-interface/research/BRIEF.md` — gate PASS, 7 unknowns closed, 5 cited captures, chain verifies
- **Depends on:** ADR-0030 (decision research lives in a nested project), ADR-0032 (the artifact contract), ADR-0033 (no token in an argument)

## Context

The operator's goal is that any agent they build can run a collection. `collect-remote.mjs`
already does that with a fine-grained token, so the question was not *can* an agent reach
the collector — it was whether MCP, the standard way an agent acquires a tool, buys
anything that seam does not, and what it would cost.

**This is the first thing in the repository built from research that passed the gate.**
Every decision below cites an `E-` row in the nested project, each of which points at a
cached page committed beside it. That is the arrangement the whole kit exists to produce,
and this ADR is the first time it has been used rather than described.

## Decision

**A local `stdio` MCP server wrapping the seam `lib/dispatch.mjs` already drives.**

### stdio, not Streamable HTTP

E-03: "Protocol semantics are identical on every transport. A transport is a **binding**."
So this is an operational choice, not a capability one. A stdio server is a subprocess the
client launches on the operator's own machine.

A remote one costs the whole OAuth 2.1 chain before an agent can say hello (E-01): a `401`
with `WWW-Authenticate: Bearer resource_metadata=...`, a Protected Resource Metadata
document at a well-known path (RFC 9728), authorization-server metadata discovery via
RFC 8414 or OIDC, client registration either pre-arranged or through DCR, and a browser
authorization-code exchange. That is an identity product. Nothing asked for one.

### The credential is the one we already have

E-01, on stdio specifically: "you can use environment-based credentials or credentials
provided by third-party libraries embedded directly in the MCP server instead." So
`tokenFromEnv` is not a shortcut here — it is the documented route for this transport, and
ADR-0033's rule that no token may be an argument survives unchanged.

`x-mcp-header` is deliberately unused: E-04 warns that developers "**SHOULD NOT** mark
sensitive parameters (passwords, API keys, tokens, PII)" that way, "as header values are
visible to network intermediaries".

### Two tools, not one

E-03: "servers do not initiate JSON-RPC requests and clients do not send JSON-RPC
responses. No other message direction exists." A server therefore cannot announce that a
collection finished.

The alternative to two calls is one call held open for several minutes, kept alive by
`notifications/progress` (E-02). That works, and it means an agent whose process dies
mid-call has lost a run it paid for. `collect` returns the run id immediately;
`fetch_corpus` takes that id. An agent that crashes has something to retry against.

### A link, never the bytes

E-04 defines both `resource_link` and embedded resources — and **states no maximum size
anywhere on the page**. A corpus ZIP is tens of kilobytes. A `file://` URI is the
defensible option rather than the merely available one, and it suits a local server
exactly. The spec also warns that a returned link "is not guaranteed to appear in the
results of a `resources/list` request", so the URI is the handle and there is nothing to
rediscover it by.

### The protocol version is pinned

E-05: version is declared per request with no handshake, and a server that cannot serve one
**MUST** answer `UnsupportedProtocolVersionError` (`-32022`) carrying `data.supported`.
This protocol has already broken compatibility once — modern revisions (`2026-07-28`+)
carry version and capabilities as per-request metadata, legacy ones (`2025-11-25` and
earlier) establish a session with an `initialize` handshake. Pinning is the same discipline
ADR-0031 applied to `X-GitHub-Api-Version`, for the same reason.

### One implementation of bringing the corpus home

`fetchCorpus` lives in `lib/dispatch.mjs` and is called by both `bin/collect-remote.mjs`
and the MCP server. The brief is explicit about why: a second copy of dispatch logic is how
the vendor package name came to be wrong in two workflows at once (ADR-0033).

## What the gate refused, and why that is recorded here

The first attempt at this brief **failed preflight**. Two map rows were `GAP`, one
load-bearing: nothing in the first three captures said how a tool returns a 71 KB artifact,
which is the whole output of this design.

Two more pages were collected **into the same ledger** — five entries, one unbroken
sequence, rather than two chains that could never honestly be merged. `resource_link` came
from that second pass, and so did the versioning rule above. Had the row been marked
`DISMISSED` instead, the gate would have passed and this ADR would be recommending an
interface with an unanswered question at its centre.

The other `GAP` was **split** rather than fudged. How a break is detected and survived is a
design question and is closed. Who governs the specification was never collected and is
dismissed with that said plainly: it moves the planning horizon, not the architecture.

> **Amendment, 2026-09-22 — collected at last, and the dismissal was half right.**
> Evidence: U-8 and E-09/E-10/E-11 of `docs/decisions/2026-09-21-agent-interface/`, three
> distinct documents across three hosts.
>
> It does not change the architecture; the server is dual-era stdio either way. **It changes
> the maintenance answer, by a number nobody here had: twelve months.** Deprecated features
> "still work, and they'll keep working for at least twelve months", and the legacy HTTP+SSE
> transport has "a year-long offramp". A protocol owner who can remove a feature at will and
> one who owes a year of notice are different risks to ship against, and "not reached for"
> could not tell them apart.
>
> **The specification is also not Anthropic's alone.** MCP "has been established as … a
> Series of LF Projects, LLC", and governance changes "must also be approved by LF Projects,
> LLC". Decisions run a published ladder — Lead Maintainers as final authority, Core
> Maintainers able to veto by majority — and changes arrive as written SEPs.
>
> **What this means for `lib/mcp.mjs`, checked rather than assumed:** the 2026-07-28 release
> deprecates Roots, Sampling and Logging (SEP-2577) and the legacy HTTP+SSE transport. This
> server uses **none of them** — grepped, no match — so nothing here is on an offramp today.
> Its legacy support is the `initialize` handshake of the older protocol version, which is a
> different axis from the deprecated transport, and the twelve-month rule is what governs how
> long that stays serveable.
>
> D-11 was the only explicit `GAP` left in any committed corpus in this repository. Closing it
> cost three credits.

### Amendment, 2026-09-21 — the server is DUAL-ERA, because the spec is ahead of every client

The decision above says "the protocol version is pinned" and pins `2026-07-28`. That was
correct about the specification and useless in practice, and the only thing that could have
revealed it was running the server against a client somebody else wrote.

Driven by the official SDK at v1.30.0, the first version of this server answered, in full:

```
MCP error -32601: unknown method initialize
```

The SDK declares `LATEST_PROTOCOL_VERSION = '2025-11-25'` and supports
`2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07`. Every one of those is what
E-05 calls **legacy** — session-based, opening with an `initialize` handshake, which
`2026-07-28` removed. Claude Desktop and Claude Code are built on that SDK.

**A server nothing can call is not a conformant server; it is an unreachable one.** This is
the same failure shape as building the workflow against an npm package named `firecrawl`:
read from documentation, never exercised against reality, wrong in the one way that
matters. Both were found by running the thing, and neither could have been found any other
way.

E-05 already named the remedy, in the corpus, in the brief, and in the paragraph of this
ADR that quotes it — **"a dual-era implementation that supports both"**. I cited the term
and did not implement it, because until a real client refused the connection nothing forced
the question.

So `SUPPORTED_VERSIONS` is `['2026-07-28', '2025-11-25']`, `initialize` is implemented
beside `server/discover`, and one session object per connection holds what the handshake
agreed. Two rules follow from how the official client behaves:

- **Echo the requested version** when it is serveable. The client refuses a reply carrying
  a version it does not support — `SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)`
  or it throws — so answering with this server's preference disconnects it.
- **Fall back to legacy, not to preference,** for a version we cannot place. Answering an
  unknown client with `2026-07-28` is a true statement about this server and a guaranteed
  disconnection, because no shipped client lists it.

Verified end to end afterwards, through the official client rather than by hand: connect,
`tools/list`, a real `collect` that spent credits, polling `fetch_corpus` through the tool
because the server cannot call back, and a `resource_link` to a package that validated
`PASS` with `buildAuthorized: false`.

## Alternatives considered

**A remote/hosted MCP server.** Deferred with the whole of E-01's OAuth chain, until
somebody other than the operator needs to reach it.

**One tool that blocks until the corpus is ready.** Simpler to call and loses a paid run
whenever a client times out or restarts.

**Embedding the corpus in the tool result.** Permitted, and the specification names no size
limit, so "permitted" is not the same as "known to work".

**Replacing `collect-remote.mjs`.** The CLI is the right shape for a human and for CI. Both
now call the same `fetchCorpus`.

## Consequences

- `lib/mcp.mjs` is pure apart from injected transport, so the whole protocol surface is
  tested offline — including what a real server process answers, driven over its own stdio.
- `createStdioLoop` serialises chunk processing through one promise chain. Overlapping
  `data` events were mutating the read buffer concurrently, which drops or doubles a
  message; a test caught it, and the fix costs concurrency a stdio server has no use for.
- A corpus returned over MCP is `HUMAN_REVIEW_REQUIRED` exactly as one downloaded by hand
  is. Both tool descriptions say so, because a description is the only text a model
  reliably reads before calling, and a test asserts the warning is present.
- `new-project.mjs` gains `--kit`, and `collect.yml` passes the documented install location
  rather than the runner's resolved one. Found by reading a real returned corpus: every
  package the collector produced carried `C:\Users\runneradmin\.agents\research-kit`, a
  path that existed on nothing but that runner, for the ten minutes it lived.

## What this ADR does not claim

That MCP is better than the CLI. It is a second door onto the same room, opened because
agents know how to find that kind of door. The CLI remains the right interface for a person
and for CI, and both go through the same seam.
