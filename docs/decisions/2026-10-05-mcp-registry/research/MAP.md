# MAP - topic decomposition

## Topic

How should Fetchproof be distributed and listed in the official MCP Registry?

## Subtopics

Phase 0 ran on the collector on 2026-10-06. The agent classified the seeded dimensions
after reviewing the fetched primary pages; topic-specific dimensions follow below.

| ID | Subtopic | Why it matters | Status | Covered by |
|---|---|---|---|---|
| D-1 | Access model | Public pages, an official API, an auth-walled app, or a paywall - each is a different collection design | COVERED | U-01 |
| D-2 | Auth and credentials | What accounts, keys, or logins the collection and the product need, and who holds them | COVERED | U-04, U-07, U-09, U-10 |
| D-3 | Rate limits and quotas | Caps every cadence in the design, and caps the research collection itself | DISMISSED | One manually reviewed initial listing; no polling, aggregation or automated publication is designed here. Numeric cadence limits are not load-bearing for this handoff. Reopen before any automation. |
| D-4 | ToS, licensing, legality of the intended use | A prohibition on automated collection, storage, or display ends the design for that source - and sometimes the project | COVERED | U-08 |
| D-5 | Data schema and its stability | How the data is shaped, and how often the source changes the shape without asking | COVERED | U-03, U-05 |
| D-6 | Freshness and staleness | How fast the data goes stale, and what staleness costs the product that depends on it | COVERED | U-05 |
| D-7 | Cost at expected volume | The economics at real usage, not the pricing page's first row - this decides viability | COVERED | U-07 |
| D-8 | Runtime and platform limits | Where this actually executes - OS, runtime version, desktop app, cloud - and what those limits forbid | COVERED | U-03, U-06, U-09 |
| D-9 | Output obtainability | Does the data your stated "done" depends on exist, and can you actually get it? Load-bearing: a project whose output cannot be produced should die in phase 1, not phase 2 | COVERED | U-01, U-02, U-10 |
| D-10 | Existing distribution/version boundary | A package must preserve the existing server and explicit ADR constraints | COVERED | U-02, U-09 |
| D-11 | Client discovery versus catalog admission | Official metadata publication is not automatic installation or catalog acceptance | COVERED | U-06, U-10 |
| D-12 | Publication authority and scope | Completing research must not silently lift the freeze or publish a service | COVERED | U-09 |

## Coverage notes (per dimension)

D-1/D-9: public metadata and distribution are documented; actual account privileges and catalog admission remain disclosed in U-10.

D-2: namespace, npm publishing and runtime credentials have separate requirements. No authentication was exercised.

D-3: initial manual publication does not depend on a numeric rate. This dismissal does not authorize an automated client.

D-4: preserve PolyForm Shield/Required Notice; exclude third-party captures from a runtime package; host terms and moderation do not certify legality or correctness.

D-5/D-6: use the reviewed schema examples, preserve immutable versions and recheck preview documentation before implementation.

D-7: npm documents no usage charge for its public service; Firecrawl/Actions costs remain part of the existing collector workflow, not a new promise of free research. No Registry fee guarantee was found or assumed.

D-8: existing Node stdio server and each client's explicit configuration are the execution boundary. Client-version smoke tests belong to the later package implementation.

D-10/D-12: npm is a candidate for a separate decision; ADR-0116 and the freeze still apply.

D-11: catalogs and clients are separate from official metadata; U-10 records the actual-placement verification.

## Candidate material

Gathered 2026-10-06.

Likely owners of these facts (by how often a search pointed at them):

- `docs.github.com` (4)
- `registry.modelcontextprotocol.io` (1)
- `truefoundry.com` (1)
- `jfrog.com` (1)
- `blog.modelcontextprotocol.io` (1)
- `konghq.com` (1)

Candidate pages:

- [Official MCP Registry](https://registry.modelcontextprotocol.io/)
- [Claude MCP Registry: A Complete Guide for 2026 - Truefoundry](https://www.truefoundry.com/blog/claude-mcp-registry)
- [What is an MCP Registry? - JFrog](https://jfrog.com/learn/ai-security/mcp-registry/)
- [Introducing the MCP Registry | Model Context Protocol Blog](https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/)
- [What is an MCP Registry? The Centralized Directory for AI Agents](https://konghq.com/blog/learning-center/what-is-an-mcp-registry)
- [MCP Registry - Model Context Protocol （MCP）](https://modelcontextprotocol.info/tools/registry/)
- [The MCP Registry - Model Context Protocol](https://modelcontextprotocol.io/registry/about)
- [Model Context Protocol (MCP) Tool Descriptions Are Smelly ... - arXiv](https://arxiv.org/html/2602.14878v1)
- [Restrict MCP server access to a custom registry - GitHub Docs](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/restrict-based-on-registry)

## Outlines seen in the material

_No outlines - none of these pages is captured yet. `--max-scrapes <n>` captures the first n; their headings appear here._
