# Discovery Contract - Which Node.js versions Fetchproof must run on as of 2026-09-27, and from which versions Node's built-in fetch honours HTTPS_PROXY through NODE_USE_ENV_PROXY

Started 2026-09-27. This file is the definition of "enough information to build".
`node fetchproof/bin/preflight.mjs` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

The kit promises "Node 22+" in both READMEs and in `lib/runtime.mjs`, but CI runs only Node 22
(`node-version: '22'` in all three workflows). An operator's machine runs whatever Node their
installer gave them, and nothing has checked the kit on any other line. Separately, the keyless
transport's proxy support (dd7569d, 2026-09-27) depends on `NODE_USE_ENV_PROXY`, which some
Node releases do not have: on those, the transport goes around a configured proxy and fails with
a bare HTTP 403, as it did in this container before the fix.

"Done" is:

1. the Node lines the kit states and CI tests match the lines supported upstream on 2026-09-27;
2. before anything is collected, the kit tells an operator whose Node cannot route the keyless
   transport through their configured proxy, naming the version to upgrade to;
3. the proxy variables `fetchEnv` looks for are the ones Node actually reads.

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
| U-1 | Which Node.js release lines are supported on 2026-09-27 (Current, Active LTS, Maintenance LTS), and when does each reach end of life? | Decides which lines CI must test and what floor the kit states. Testing only a line near its end of life leaves the operator's likely version unverified | CLOSED | E-01, E-05. On 2026-09-27 three lines are supported: 26 Current (to LTS on 2026-10-28, end 2029-04-30), 24 Active LTS (to Maintenance on 2026-10-20, end 2028-04-30), 22 Maintenance LTS (end 2027-04-30). 20, 21, 23 and 25 are end-of-life. The kit's floor of 22 is still a supported line; CI tests only one of the three |
| U-2 | From which Node versions, on each supported line, does NODE_USE_ENV_PROXY exist, and what does it cover - fetch, the http/https modules, both? | The doctor warning must name the right minimum. The wrong version is a false warning or a silent failure | CLOSED | E-02, E-03, E-04. NODE_USE_ENV_PROXY exists from v24.0.0 on the 24 line and from v22.21.0 on the 22 line, and every 26.x has it. On 22.21.0 it covers fetch (E-04, #57165) and the http/https modules; on 24, fetch from 24.0.0 and the http/https modules from 24.5.0 (E-03). The keyless transport uses fetch, so it needs 22.21+ or 24.0+ to honour a proxy [single-witness: Node is the only authority on which of its releases carry the flag; a third party can only restate nodejs.org, and the brief records a measurement that agrees - 22.20.0 fails through the proxy, 24.21.0 does not] |
| U-3 | With NODE_USE_ENV_PROXY set, which variables does Node read - HTTPS_PROXY/HTTP_PROXY/NO_PROXY, in which case, and which wins when both cases are set? | fetchEnv sets the flag when any of four names is set. If Node reads only one case, an operator with only the other gets the flag and still no proxy | CLOSED | E-02, E-03. Node reads HTTP_PROXY/http_proxy, HTTPS_PROXY/https_proxy and NO_PROXY/no_proxy - both cases - and lowercase wins when both are set (E-03). fetchEnv already sets the flag when any of the four proxy names is set, which is right: whichever case the operator used, Node will read it [single-witness: Node is the only authority on which variables its own runtime reads; a third party can only restate nodejs.org] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.
