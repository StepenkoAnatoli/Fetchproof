# Discovery Contract - GitHub Actions changes of September 2026 that touch this kit: run-query results, expired artifacts, workflow execution protections, cache-mode

Started 2026-09-26. This file is the definition of "enough information to build".
`node fetchproof/bin/preflight.mjs` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

GitHub shipped four Actions changes between 2026-09-10 and 2026-09-25 that name surfaces this
kit uses: run query results (Sep 25), expired artifacts in the UI and API (Sep 24), workflow
execution protections (Sep 17) and cache-mode (Sep 10). The kit drives Actions from outside
through `lib/dispatch.mjs` and `bin/collect-remote.mjs` - dispatch with `return_run_details`,
GET one run, list that run's artifacts, download one - and runs two workflows that hold API keys.

"Done" is, for each change, a yes or no on whether it reaches a call or a job in this repository,
and for each yes, the smallest change that keeps the kit correct - or the reason none is needed.

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
| U-1 | What changed in workflow-run query results on 2026-09-25, and does it touch any endpoint the kit calls (dispatch, GET a run, list a run's artifacts, download an artifact)? | If run lookup changed shape, collect-remote could lose its run or read the wrong one | CLOSED | E-01. The change is to counts when LISTING runs by filter ("2,500+" past 2,500). The kit never lists runs: `lib/dispatch.mjs` takes the run id from the dispatch response (`return_run_details`, ADR-0031) and then GETs that run by id. No effect [single-witness: GitHub on its own API; a third party can only restate it] |
| U-2 | Since 2026-09-24, does listing a run's artifacts omit expired ones, and what does downloading an expired artifact return? | dispatch.mjs filters `expired` and maps HTTP 410 to EXPIRED; if expired artifacts vanish, the kit cannot tell "never produced" from "expired" and may say the wrong one | CLOSED | E-02, E-05, E-08. Answer, measured 2026-09-28: "List workflow run artifacts" - the endpoint `listArtifacts` calls - **omits** an expired artifact. Artifact 10638148916 (run 35600022797, collect "smoke-0003") was listed with `expired: false` on 2026-09-26 and expired at 2026-09-28T12:32:20Z; the same call now returns `{"total_count":0,"artifacts":[]}` (E-08). The repository-level list and "get an artifact" stop returning it too (E-02). The path that applies in `dispatch.mjs`: an expired package now reaches the kit as an EMPTY list, so its empty-list message ("the run produced no package, or its artifact has expired") is what the operator sees, and the `!a.expired` filter no longer fires in practice (kept: harmless, and correct if GitHub reverts). `downloadArtifact` maps `410` to EXPIRED, the documented answer for downloading an expired artifact |
| U-3 | What are workflow execution protections (2026-09-17), and do they offer a native control for what ADR-0033 does by hand - refusing a run whose environment was auto-created, or limiting who may dispatch a paid run? | A native control could replace or back up the marker check; one that restricts dispatch could break collect-remote | CLOSED | E-03, E-07. An allowlist of actors and events, now per workflow file - so the two paid workflows can be restricted to the repository owner and `workflow_dispatch` natively. It complements ADR-0033 and does not replace it: it limits who and what may START a run, while the marker check refuses a run whose environment GitHub auto-created. It is a repository SETTING (or its REST API), not workflow syntax, so it is the operator's to apply. The new `pull_request_target` default does not touch this repository: no workflow here uses that trigger Configuring it (E-07): Settings > Actions > Policies, as a repository administrator; evaluate (shadow) mode is GitHub Enterprise Cloud only, so on this repository a rule is active as soon as it is saved - corrected 2026-09-26, the first version of this row and of the brief advised evaluate mode first |
| U-4 | What does cache-mode (2026-09-10) allow a job to set, what is the default, and should the two key-holding jobs set it? | Jobs here log `Cache mode: write`; a cache is a path between runs, and two jobs hold credentials | CLOSED | E-04, E-06. `cache-mode: none` at the top of a workflow denies every job all cache access, and a denied cache operation "logs an informational message and continues" - the job does not fail. The two key-holding workflows use no cache (setup-node's is off since ADR-0041), so declaring `none` costs nothing and removes the cache as a path between runs of a job that can read a credential. Omitted, trusted triggers default to `write` - these jobs log `Cache mode: write` today |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.
