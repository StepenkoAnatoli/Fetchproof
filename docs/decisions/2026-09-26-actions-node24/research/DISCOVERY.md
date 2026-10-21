# Discovery Contract - Moving this repository's pinned GitHub Actions off the deprecated Node 20 runtime

Started 2026-09-26. This file is the definition of "enough information to build".
`node fetchproof/bin/preflight.mjs` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Every workflow run in this repository warns: "Node.js 20 is deprecated. The following actions
target Node.js 20 but are being forced to run on Node.js 24" - naming `actions/checkout`,
`actions/setup-node`, `actions/setup-python` and `actions/upload-artifact`, pinned by commit in
`offline-suite.yml`, `collect.yml` and `live-collection.yml` since 2026-09-21. They work only
because the runner forces a newer runtime; if that stops, CI and both collection workflows stop
together. Which release of each action runs on Node 24 was read from git at each exact commit,
before collecting (`action.yml` `runs.using`), and is recorded in the brief as a measurement.

"Done" is a pin per action - a release on `node24`, as a full commit SHA with its tag - that the
three workflows can move to without behaving differently, and the reason each breaking change
between our pins and those releases does or does not reach this repository.

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
| U-1 | What is GitHub's timeline for Node 20 on Actions runners - when did forcing Node 24 start, and when do Node 20 actions stop running at all? | Sets the urgency, and whether moving is maintenance or an outage in waiting | CLOSED | E-07, E-01. Node 24 became the runner default on 2026-06-16 and Node 20 was removed on 2026-09-23: "Runners now use Node 24 for JavaScript actions. The temporary `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` opt-out is no longer available." So these workflows' node20 actions already run on Node 24 - as releases never built or tested for it. The move is to supported code, not away from an outage [single-witness: GitHub on its own runners; nobody else can state what GitHub's runners do] |
| U-2 | For each of the four actions, which release is the first on `node24`, and what are its breaking changes up to the latest major? | Decides which version to pin: the latest carries the most fixes, and every major between us and it is a behaviour change to check against these workflows | CLOSED | E-02, E-03, E-04, E-05. First node24 major: checkout v5, setup-node v5, setup-python v6, upload-artifact v6 (its v5 still defaulted to Node 20). Latest: all four at v7. Every breaking change from our pins to v7, checked against this repository: checkout v6 moves persisted credentials to `$RUNNER_TEMP` (no workflow change) and v7 refuses fork PR code under `pull_request_target`/`workflow_run` (neither trigger is used here); setup-node V6 removes `always-auth` (not set here) and V7 removes a dummy `NODE_AUTH_TOKEN` (no `registry-url` here); setup-python V7 changes nothing observable; upload-artifact v7's `archive` is opt-in and the default still zips. `runs.using` at each exact commit was also read from git, not only from the prose (brief) [single-witness: each action's own maintainers; a release note has one author] |
| U-3 | Does setup-node's automatic caching (on by default since v5) apply to these workflows, which hold credentials, and how is it turned off? | Two workflows carry API keys; the vendor recommends disabling automatic caching for privileged workflows, and a cache is a path between runs | CLOSED | E-03. Automatic caching exists since V5 and triggers on package-manager detection; since V6, npm caching triggers on `packageManager`/`devEngines.packageManager` in `package.json`. This repository has no `package.json` (measured: `git ls-files`), so it is inert today - but the vendor says "For workflows with elevated privileges or access to sensitive information, we recommend disabling automatic caching by setting `package-manager-cache: false`", and two of these workflows hold API keys. Set it there, explicitly [single-witness: a recommendation about setup-node's own default can only come from setup-node's maintainers, and a third party quoting it would be the same witness read twice. The half this project adds - that the repository has no `package.json` - is measured, not cited] |
| U-4 | What minimum Actions Runner version do the node24 releases require, and do GitHub-hosted runners meet it? | A release the runner cannot execute fails every job; this repository runs only on GitHub-hosted ubuntu-latest and windows-latest | CLOSED | E-02, E-03, E-04, E-05, and a measurement. Every node24 release requires Actions Runner v2.327.1 or later (checkout's v6 needs v2.329.0 only for authenticated git inside a Docker container action, which is not used here). GitHub-hosted runners are well past it: live-collection run 36276869434 (2026-09-26) logged `Current runner version: '2.337.0'` on image `ubuntu-24.04` [single-witness: the vendors on their own minimums, and one run log for the hosted version] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.
