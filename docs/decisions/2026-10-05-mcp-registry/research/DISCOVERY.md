# Discovery Contract - How should Fetchproof be distributed and listed in the official MCP Registry?

Started 2026-10-05. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Determine a supported way to list Fetchproof's existing stdio MCP server in the
official MCP Registry (registry.modelcontextprotocol.io), so developers using Claude
Code, Cursor and VS Code can find it. The research deliverable is an evidence-backed
decision and builder handoff covering distribution, Registry publication and client
discoverability, including the server's GitHub-token requirement. This task completes
phase-1 research. It does not publish a package or Registry entry, change the MCP server,
or authorize a packaging design. Expected volume is one manually reviewed initial
listing, not an aggregator or scheduled publication system.

Starting assumptions supplied by the operator, not collected evidence: the Registry
requires a server.json pointing to a published package; Fetchproof is not published;
`npm view fetchproof` returned 404 on 2026-10-05. Verify these against primary sources
during research rather than treating them as closed unknowns or choosing npm upfront.

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
| U-01 | What does the Registry host, and must an installation route be public? (D-1, D-9) | A GitHub checkout may not supply a supported installation route. | CLOSED | E-01 |
| U-02 | Which distributions describe the existing local stdio server, and how is package ownership proved? (D-9, D-10) | npm is a candidate, not an assumed requirement. | CLOSED | E-02, E-03, E-06 |
| U-03 | What metadata describes stdio execution and secret configuration? (D-5, D-8) | A listing must launch the intended program without embedding credentials. | CLOSED | E-03, E-05, E-06 |
| U-04 | What publisher accounts and namespace authentication are required? (D-2) | Repository access and the runtime token are different from namespace ownership. | CLOSED | E-04, E-06 |
| U-05 | What preview, version and lifecycle behavior affects freshness and rollback? (D-5, D-6) | Metadata may be immutable or a schema may change. | CLOSED | E-01, E-07 |
| U-06 | How do Claude Code, Cursor and VS Code install and discover MCP servers? (D-8, D-11) | Official listing cannot promise automatic installation in all clients. | CLOSED | E-08, E-09, E-10, E-11, E-18 |
| U-07 | What npm public cost, account and publishing requirements apply? (D-2, D-7) | A recommended candidate needs explicit public visibility and publisher access. | CLOSED | E-12, E-13, E-19 |
| U-08 | What license and service conditions bound redistribution and metadata? (D-4) | Preserve the kit's notice and check host conditions. | CLOSED | E-14, E-17, E-19 |
| U-09 | Which runtime, token and version constraints must later packaging preserve? (D-2, D-8, D-10, D-12) | Distribution is separate from changing the existing frozen server. | CLOSED | E-15, E-16, E-20, E-21; local tracked-source inspection confirms ADR-0117 remains in force |
| U-10 | Can this operator publish the chosen package/namespace and gain desired catalog placement? (D-2, D-9, D-11) | Private account privileges and future catalog admission cannot be invented. | KNOWN-UNKNOWN | Private account privileges, final package-name ownership and future catalog admission were not exercised. Day-one: operator confirms npm identity/scope and 2FA, authenticates publisher for the intended namespace, verifies package-name availability, and after an approved publication checks the official API and each desired catalog. Use manual client configuration until actual admission is observed. E-04, E-11, E-12, E-18 supply public requirements, not this operator's result. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- Keep this decision's contract and eventual corpus in this nested project, separate
  from the repository's root transport/vendor research (ADR-0030).
- ADR-0116 rejected a package.json version field because the kit is not an npm package.
  It remains in force; this scaffold does not supersede it.
- The feature freeze in ADR-0117 remains in force. Any implementation that requires
  lifting it needs an explicit ADR for that item after research, not an implicit
  exception in this scaffold.
- Use the existing MCP server at `fetchproof/bin/mcp-server.mjs` as the starting
  point; do not include credentials in committed research or package metadata.
