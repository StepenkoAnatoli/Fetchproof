# Discovery Contract - How Fetchproof should be delivered to a non-technical user

Started 2026-09-21. This file is the definition of "enough information to build".
`node ../../../fetchproof/bin/preflight.mjs` reads it and blocks the build until every
unknown below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Decide how Fetchproof reaches an operator who does not use a terminal, and record the
decision with evidence behind it rather than with a recommendation behind it. The four
candidate shapes are: a **GitHub Actions collector** the operator triggers from a web page
and downloads a ZIP from; a **local Windows `.exe`** built with Node's single-executable
feature; a **hybrid** that collects remotely and does the judgement locally; and a
**REST/API seam** exposing the kit to some other front end.

"Done" for this project is not a built delivery mechanism. It is a brief a builder can
implement from without re-researching the platform: what the dispatch API actually returns,
how long an artifact survives, what a run costs, what leaks when the repository is public,
whether an approval can gate a paid run, and whether Node can package this kit as an `.exe`
on the operator's platform at all.

**Why this project exists at a nested path.** It is the worked example of a convention this
repository adopted on 2026-09-21: research supporting a repository-level architectural
decision lives in a self-contained project at `docs/decisions/<date>-<decision-name>/`.
The convention exists because the first attempt at this research was collected into a
temporary scratch directory, read, and then deleted along with its captures, its ledger and
its provenance - leaving a recommendation with nothing under it. See
`../../../docs/preliminary-2026-09-21-delivery-architecture.md`, which is that note, kept
and labelled rather than quietly promoted.

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
| U-1 | Does `POST /actions/workflows/{id}/dispatches` return anything identifying the run it created? | Decides whether a caller can follow its own run, and therefore whether the hybrid and REST options need a caller-chosen correlation token designed in from the first release | CLOSED | E-01: **yes, under API version `2026-03-10`** - `200` with `{workflow_run_id, run_url, html_url}`. Under `2022-11-28` the same call returns `204 No Content` and the caller learns nothing. Both verified on this machine against this repository; run `35548135379` came back from the 200 and resolves. The correlation race a caller faces on the old version disappears entirely by pinning the header. **Corroborated by E-10**, independently: "Requests without the `X-GitHub-Api-Version` header will default to use the `2022-11-28` version" - so the 204 was a three-year-old API version answering correctly, not a broken endpoint. E-10 also dates the exposure: unpinned requests fall to "the next oldest supported version" as older ones retire, so an unpinned client changes behaviour on a schedule rather than staying still **Corroborated 2026-09-21 by E-13 and E-14** (github.blog), which supply the mechanism and its date. E-13 appears to contradict this row - it says the `200` comes from a `return_run_details` parameter and that without it the endpoint "will continue to return the current `204`". Four measured calls resolved it: the API version is the seam, and there are TWO routes to a run id. See the BRIEF. |
| U-2 | How long does a workflow artifact survive, and is that period configurable? | Decides whether a ZIP may be treated as delivery only, or also as storage. If artifacts expire, evidence that must persist has to be committed or kept elsewhere | CLOSED | E-03: 90 days by default, configurable 1-90 on a public repository and 1-400 on a private one, non-retroactively; a single artifact may set its own shorter period. E-02: deleting a run deletes its artifacts. So a ZIP is delivery, never storage - evidence that must persist is committed, as this project's own corpus is **Corroborated by E-15**, the `actions/upload-artifact` README on github.com: "The retention period must be between 1 and 90 inclusive" - the same bound, from the maintainers rather than the docs team. |
| U-3 | What does a run of this collector cost on GitHub-hosted runners, for a public repository and for a private one? | The privacy analysis argues this repository should go private for sensitive topics; if that flips the cost from zero to metered, the recommendation changes with it | CLOSED | E-04: free on standard GitHub-hosted runners for public repositories; private repositories draw on a monthly quota (Free 2,000 minutes / 500 MB, Pro 3,000 / 1 GB, Team 3,000 / 2 GB) billed to the repository owner rather than the triggering user. Going private costs runner minutes - but E-06 shows it costs more than that on a free plan. **Corroborated by E-12**, and strengthened: "Use of the standard GitHub-hosted runners is free and **unlimited** on public repositories" - there is no minute quota to exhaust here, so the only meter on this repository is the Firecrawl credit **Partially corroborated by E-16** (github.com/pricing), which independently lists the private-repository minute quotas (Free 2,000, Team 3,000, Enterprise 50,000) but **does not state that public repositories are free**. The half that decides this design is still single-sourced. |
| U-4 | What is the stability and platform support of Node's single-executable applications feature? | Decides whether the local `.exe` option is buildable today on the operator's Windows machine, and how much the packaging story is likely to move underneath a shipped product | CLOSED | E-05: "Stability: 1.1 - Active development"; Windows is supported and macOS **x64** is the exclusion ("not currently supported and is skipped in the tests"). Buildable for this operator today. The caveat the page supplies against itself: the bundled-asset virtual filesystem this kit would need to read its own files is newer (v26.9.0) and weaker - "Stability: 1.0 - Early development" [single-witness: a stability marker is the Node.js project's statement about its own API. No second party can witness it - they can only report it. The sea-assets corpus corroborated that the assets API EXISTS and dated it independently, and still could not corroborate the marker] |
| U-5 | Can a workflow run be gated behind a human approval or a wait period before it spends anything? | This collector spends real credits. Without a mechanism to require approval, an Actions-first delivery hands the meter to anyone with write access | CLOSED | E-06: yes - environment protection rules give required reviewers (up to 6, one approval suffices, optional prevent-self-review) and a wait timer, and environment secrets stay unreadable until those rules pass. **Conditioned on plan and visibility:** on GitHub Free, Pro or Team those rules exist only for public repositories, and a Free repository converted to private has its protection rules and environment secrets *ignored* rather than refused. **Corroborated by E-11**, which states the rule as availability rather than as consequence: "If you are using GitHub Free, environment secrets are only available in public repositories", with the same note for required reviewers, wait timers, administrator bypass and custom rules. E-11 adds what E-06 lacked - environment **variables** are restricted the same way, so a Free repository gone private would also lose `FETCHPROOF_COLLECTION_ENV` and fail at the environment check rather than the credential one **Corroborated by E-17** (github.blog, 2020-12-15), which adds the ordering this ADR depends on: required reviewers "automatically pause a job trying to deploy" - so a paused job has not read the secret. |
| U-6 | What of a workflow run is exposed by a public repository - secrets, logs, artifacts - and to whom? | Collected URLs, topics and evidence text are the research subject. If they become public on reaching a log or an artifact listing, Actions-first delivery is unsafe for sensitive topics regardless of cost | CLOSED | E-07 for the credential: secrets are sealed-box encrypted and log-redacted, with the redaction stated as not guaranteed and job-scoped. E-08 for the subject, measured unauthenticated against this public repository rather than read: run metadata, the job listing with step names, and the artifact listing all return `200` to an anonymous caller; `/actions/secrets` returns `401` and raw job logs `403`. So the credential is protected and the *shape* of the run is not - and artifact and step names alone disclose a topic [single-witness: GitHub describing its own permission model, so a second page is another team at the same company restating the first. What replaced corroboration here is measurement - lib/disclosure.mjs probes the live endpoints, and the public-run-visibility project measured the signed-in case] |
| U-7 | Who may trigger a `workflow_dispatch`, and what inputs may it declare? | Decides whether "the operator clicks a button" is a real workflow for a non-technical user, and what the dispatch contract can carry | CLOSED | E-08 and E-01: the Run workflow button appears only once the workflow file is on the default branch; API dispatch needs "Actions" repository permissions (**write**). Inputs are declared in the workflow file with `description`, `required`, `default`, and `type` including `choice`/`options`, capped at 25 top-level properties and 65,535 characters of payload **Partially corroborated by E-18** (github.blog, 2020-07-06) for the Run workflow button and for inputs rendered as form elements. WHO may press it is still E-08 alone. |
| U-8 | Can a run name or an artifact name be built from a dispatch input? | This is the mechanism a correlation token would use. If run names cannot interpolate inputs, U-1's remedy has to live somewhere else - in the artifact name, or in the artifact itself | CLOSED | E-09: yes - `run-name` "can include expressions and can reference the `github` and `inputs` contexts", documented with `run-name: Deploy to ${{ inputs.deploy_target }} by @${{ github.actor }}`. Given U-1 this is now a fallback for callers pinned to `2022-11-28` rather than a requirement of the design **Corroborated by E-19** (github.blog, 2022-09-26): `run-name` "will accept expressions and be displayed on the list of workflow runs". |

### A note on corroboration, added 2026-09-21

Every unknown above originally rested on **exactly one capture**, and the corpus passed
preflight and `--strict` anyway: no check in this kit notices single-sourcing. The gate was
structurally blind to it.

The three unknowns that carry decisions - U-1 behind ADR-0031, U-3 behind the cost
argument, U-5 behind ADR-0035 - now cite a second, independent page each. All three
**agreed** with the original, and each added a fact the original did not carry, which is
the outcome worth recording: corroboration that confirms is not a wasted collection, it is
the only way to tell a single correct source from a single lucky one.

The other five remain single-sourced. They are GitHub documenting its own product on pages
that link to each other, and nothing rests on them that a second reading of the same
vendor would test. Named here rather than quietly left.

## Two unknowns left single-sourced on purpose, 2026-09-21

The corroboration pass closed six of eight. These two were considered and left:

- **U-4 (Node SEA stability and platform support).** The stability marker is Node's statement
  about Node, and no second party can witness it - the same limit recorded in
  `docs/decisions/2026-09-21-sea-assets/`, where pull requests corroborated that the assets
  API EXISTS and independently dated it, but could not corroborate the marker. Adding a row
  that repeats nodejs.org would raise the count without raising the support.
- **U-6 (what a public run exposes, and to whom).** GitHub describing its own permission
  model. The strongest available check is not a second page but a measurement, and it was
  already run: `lib/disclosure.mjs` probes the live endpoints, and
  `docs/decisions/2026-09-21-public-run-visibility/` measured the signed-in case. Those are
  better than corroboration and they are deliberately not filed as evidence rows, because a
  probe is not a fetched page and dressing one up as the other is the error
  `unknown-closure/no-evidence` exists to catch.

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in the
table above.

1. Is the intended operator expected to have a GitHub account and to be comfortable
   downloading and unzipping an artifact? The evidence can establish what Actions makes
   possible; it cannot establish what this person will actually do.
2. Should the repository become private for research whose subject is sensitive, accepting
   the cost that U-3 will quantify, or does topic-level sensitivity stay out of scope?

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- Research supporting a repository-level architectural decision lives in a self-contained
  project at `docs/decisions/<date>-<decision-name>/`. Temporary scratch projects may be
  used for experiments, but their findings cannot support a committed decision unless the
  complete evidence corpus and ledger are preserved.
- This project's corpus is committed, including `research/raw/.fetches.jsonl`. A decision
  project whose ledger does not travel is the failure that caused this convention.
- Verification runs with this directory as the current working directory. The parent
  repository's preflight judges the parent corpus and is not evidence about this one.
- The REST/API seam is not a delivery option and is not weighed as one. It is the interface
  whichever collector ships would expose, so it belongs inside that option rather than
  beside it.
