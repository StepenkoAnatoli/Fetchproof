# ADR-0033 — The collector refuses rather than degrades, and inputs never reach a shell

- **Date:** 2026-09-21
- **Status:** accepted
- **Area:** delivery, CI, credentials, input handling
- **Implements:** ADR-0031 (Actions-first delivery) against ADR-0032 (the artifact contract)
- **Depends on:** ADR-0020 (no data reaches a shell), ADR-0019, ADR-0010
- **Evidence basis:** `docs/decisions/2026-09-21-delivery-architecture/research/BRIEF.md`

## Context

ADR-0031 chose an Actions collector; ADR-0032 settled what it returns. This is the
workflow that connects them, and it is the first thing in this repository that spends a
person's money on their behalf, unattended, from a button.

`live-collection.yml` already exists and is deliberately **not** this. It is a test of the
transport — "does the adapter still work" — and its approvers, its cadence and its failure
meaning are all different from "collect this, for a person, now". One file doing both would
have one approval list for two audiences.

## Decision

### The spend gate is the environment, and the environment is checked for existence

`environment: research-collection` is the only enforcement in the file that does not depend
on a step behaving: GitHub evaluates protection rules — required reviewers, a wait timer —
before the first step runs.

It also has a hole, and the corpus names it. E-06, verbatim: *"Running a workflow that
references an environment that does not exist will create an environment with the
referenced name … the newly created environment will not have any protection rules or
secrets configured."* So a typo in the environment name, or a deleted environment, does not
fail — it silently produces an unprotected one and the job runs straight past the approval
that was supposed to guard it.

So the environment must **prove it exists** before anything is spent:
`vars.FETCHPROOF_COLLECTION_ENV` must equal `research-collection`. An auto-created
environment has no variables, so the marker is absent and the run stops.

**The honest limit, stated in the file rather than implied.** GitHub does not tell a
workflow which *scope* a secret or variable came from. `secrets.X` resolves
environment-first and falls back to repository and organization, and no syntax and no API
available to the job distinguishes them. The marker therefore proves the environment was
configured for this purpose; it **cannot** prove a repository-level value did not serve the
request. Setting a repository-level variable of that name would defeat it — which makes
circumvention a deliberate, visible act, and leaves the enforcement that matters where it
belongs: on the environment's protection rules.

### Amendment, 2026-09-21 — the required reviewer is dropped; the environment stays

The paragraph above calls the environment's protection rules "the only enforcement in this
file that does not depend on a step behaving". That was true and it conflated two things
the operator was right to separate.

**A reviewer approving a dispatch is a spend gate, not a review.** Nothing has been
collected at that moment, so there is nothing to judge; asking a person to approve it asks
them to certify something that does not exist. The research review is the three human steps
and `buildAuthorized`, at the end, where the corpus is. A required reviewer also makes
autonomous dispatch impossible - and an agent that must wait for a click is the thing this
collector exists to avoid.

**The environment is kept, because it was never about approval.** It is the only place the
credential can live such that every other workflow in the repository cannot read it, which
`scope-check` proves on every run. Dropping the reviewer does not touch that.

What bounds the spend without a reviewer: `max_pages` (1..25), the depth tier, and the
vendor cap returning 402 at zero rather than billing over. The exposure accepted is that
anyone with write access, or any token carrying `actions: write`, can spend up to a month's
allowance unattended. That is a bounded, deliberate trade rather than an inherited default,
and adding required reviewers later needs no change to the workflow.

### Correction, 2026-09-21 — the limit above was real but the conclusion was too weak

The paragraph above is correct that GitHub tells a job nothing about where a resolved
secret came from. It was wrong to conclude that the question is therefore unanswerable.
**It does not have to be answered directly: it can be answered by asking from a context
that can only see one scope.**

A job that declares **no** `environment:` cannot see environment secrets. It sees
repository and organization secrets and nothing else. So a `scope-check` job with no
environment that finds `secrets.FIRECRAWL_API_KEY` non-empty has proved the credential
exists at a scope no protection rule guards — and the workflow fails before a reviewer is
asked and before a credit is spent.

What remains genuinely undecidable is **repository versus organization**, and that
distinction does not matter here: neither is behind the approval gate.

This was found the way the rest of this file's defects were — by running it. The first
real configuration put both keys in as *repository* secrets. Collection would have
succeeded, the required reviewer would have approved a job, and the credential would have
been readable without approval by any workflow in the repository, including one added in a
pull request. Nothing in the design as originally written would have said so.

The `scope-check` job runs first, `collect` declares `needs: scope-check`, and the failure
message gives the three-step fix in order: add the environment secret, delete the
repository one, re-run.

### A missing credential refuses; it never degrades

> **Measured 2026-09-22 — the decision holds; half the sentence below does not.**
>
> "Measurably worse" was asserted when this was written. It is now measured, on three URLs
> this repository already holds metered captures of, re-collected through `http-keyless`:
>
> | page | Firecrawl prose | keyless prose | keyless share |
> |---|---|---|---|
> | `github.com/actions/upload-artifact` | 2,279 words | **34** | 1% |
> | `modelcontextprotocol.io/community/governance` | 932 words | **8** | 1% |
> | `nodejs.org/api/single-executable-applications.html` | 2,254 words | **202** | 9% |
>
> Shingle similarity between the two captures of the same page: **0.004 to 0.064** — far below
> the 0.25 mirror threshold, so by this repository's own measure they are barely the same
> document. "Measurably worse" understated it: keyless returns one to nine per cent of the
> readable content.
>
> **But "the person who asked would have no way to tell" is wrong, and that was the
> load-bearing half of the argument.** Every keyless capture graded `completeness: partial`
> unprompted, each carrying a specific `omitted:` line — *"only 434 characters of main content
> were extracted (below the 1500-character bar); 51 sibling section(s) totalling ~1356 words
> were outside the densest block"*. Independently, `transport-provenance` warned on all three
> rows: *"collected by http-keyless, not the metered Firecrawl CLI"*. The artifact name would
> be the same; nothing else would be.
>
> **So the decision stands on a better reason than the one recorded.** Refusing is right
> because a corpus carrying one per cent of its pages is near-useless and the operator asked
> for metered quality — not because the degradation would be invisible. It would be loudly
> visible, in two independent places, which is exactly what those two checks exist for.
>
> Recorded as a measurement rather than a corpus, for the reason four other projects here
> give: a probe is not a fetched page. No credits were spent, which is the whole point of the
> keyless adapter.

There is no `http-keyless` fallback in this workflow, and a test asserts the string does
not appear. The tempting design is to fall back so the run "still works" — it would return
a measurably worse corpus under the same artifact name, and the person who asked for
research would have no way to tell. A beginner asking for research should get the metered
quality or a clear refusal.

### No dispatch input reaches a shell

`${{ inputs.topic }}` inside a `run:` block is **textual substitution performed before the
shell parses the script**. A topic containing a backtick or `$(…)` executes on the runner.
Every input arrives through `env:` and is read as a variable; where it must reach a
program, it goes through an argv **array**, never a command line. This is ADR-0020's rule —
data is not an argument channel — applied to the one place in this repository where the
data is typed by a stranger.

The test that enforces this scans **every** workflow, not only the collector, and found
that `live-collection.yml` had been interpolating four inputs into shell bodies since it
was written. `max_pages` is free text. That is fixed in the same change.

### Names disclose nothing; the run page still does

Neither `run-name` nor the artifact name carries the topic. E-08 measured the reason: on a
public repository an anonymous caller reads run metadata, the job listing and the artifact
listing (`200`), while secrets are `401` and raw logs `403`. A name leaks before anybody
opens anything.

**This does not make a public run private, and the workflow says so.** `workflow_dispatch`
inputs are visible on the run page to anyone with read access. Keeping the topic out of
names reduces incidental exposure in listings. Research whose *subject* is sensitive
belongs in a private repository on a plan that supports environments there — and per E-06,
converting a GitHub Free repository from public to private makes its protection rules and
environment secrets **ignored** rather than refused, so that is a plan change and not a
visibility toggle.

### Correlation is the run id, under a pinned API version

The manifest records `github.run_id` and `apiVersion: 2026-03-10`. A caller that pins
`X-GitHub-Api-Version: 2026-03-10` receives `workflow_run_id` in the dispatch response and
identifies its own artifact by a number it already holds. `client_ref` is optional
insurance for a caller stuck on `2022-11-28`, validated against the producer's own shape
and **refused rather than rewritten** — a sanitised token means the caller polls for a
reference the artifact does not carry.

### The workflow cannot assert authorization

It packages with `artifact.mjs create`, which derives every authorization field from the
corpus and refuses `--build-authorized` outright (ADR-0032). A freshly collected corpus is
`HUMAN_REVIEW_REQUIRED` with `buildAuthorized: false`, and the ZIP says so at its top. The
workflow's job is to collect and hand over, not to judge.

### Integrity is required; research sufficiency is not

The same predicate correction `live-collection.yml` needed, and for the same reason found
the same way — by running it. `preflight` answers *"is the research sufficient to build"*,
a human-authored question, and a freshly collected project has no closed unknowns, so it
fails `discovery-contract/no-unknowns` however perfectly collection worked. The five
integrity checks are required individually instead.

## A defect this work surfaced outside itself

Feeding the collector a deliberately hostile topic found a bug in `lib/scaffold.mjs` that
had nothing to do with workflows: `template/research/plan.json` holds `"topic": "{{TOPIC}}"`
and the substitution is textual, so a topic containing a double quote wrote a `plan.json`
that does not parse. `research.mjs` then reads an empty plan, collects nothing, and reports
a corpus problem about a file the operator never edited.

Any operator typing `Why "agentic" search costs more` hit this. Tokens are now JSON-escaped
for `.json` templates and left verbatim for markdown — escaping everywhere would put `\"`
into prose. Two regression tests, both confirmed red against the unfixed module before the
fix was restored.

### The agent seam, 2026-09-21 — a token that can do one thing

With no required reviewer, the control that replaces it is the **scope of the token an
agent holds**. A fine-grained personal access token restricted to this repository with
repository permission **Actions: read and write** - and nothing else - can start a
collection and read the result. It cannot read or change code, read secrets, alter
settings, or reach any other repository. Revoking it is one click and breaks nothing else.

That is a better control than the reviewer was, because it bounds *what* rather than
gating *when*, and it does not require a person to be awake.

`lib/dispatch.mjs` and `bin/collect-remote.mjs` are that seam. Three properties are
enforced rather than documented:

- **No token may be passed as an argument.** `tokenFromEnv` is the only way in, and a test
  asserts the source contains no token flag. A credential on a command line reaches the
  shell history, `ps`, and any log that echoes its own command. An unknown flag matching
  token/auth/key/secret/pat is refused with that reason rather than with a spelling hint.
- **Redaction is pattern-based**, not "remove the token we hold", so it also catches a
  credential the process was never given - one echoed back by a server, a proxy or a
  redirect. That is the case a hand-written message forgets.
- **A `204` is a named failure**, `NO_RUN_ID`, explaining that the server served
  `2022-11-28` despite the pinned header. Returning a partial result would hand the caller
  "the run started and I cannot tell which one", which is the failure they are least
  equipped to diagnose from a status code.

Every request goes through an injectable `fetch`, so the whole seam is tested offline: what
header was actually sent, that a token never reaches an error, that `waiting` is reported as
a status rather than a stall. The live path is verified by running it, separately.

## Alternatives considered

**One workflow for both testing and collecting.** Fewer files, one approval list for two
audiences with different risk. Rejected.

**A keyless fallback when the credential is missing.** Makes a failure look like a success
and ships a worse corpus under the same name.

**Proving the secret came from the environment.** Not available. Documented as a limit
rather than claimed as a property.

**Validating inputs by interpolating them into a shell `case` first.** That is the
vulnerability: the substitution happens before the validation can run.

## Consequences

- The repository owner must create the `research-collection` environment, add required
  reviewers, add `FIRECRAWL_API_KEY` as an **environment** secret, and set
  `FETCHPROOF_COLLECTION_ENV=research-collection` as an environment **variable**. The
  workflow refuses to spend until all of that exists. Creating it is the owner's decision
  and is deliberately not automated.
- `collect.yml` is `workflow_dispatch`-only: ordinary CI can never trigger a paid run, and
  a test asserts `push`, `pull_request` and `schedule` do not appear.
- `live-collection.yml` loses four shell interpolations and gains four `env:` blocks.
- The collector runs on `ubuntu-latest` and `windows-latest`, with `shell: bash` pinned so
  one script serves both.
- **The runner path was unproven when this was written, and is now closed.** It needed the
  environment, the secret and one real dispatch, all of which were the owner's to provide —
  and all of which arrived the same day. Runs `35600022797` and `35608301287` both executed
  `npm install -g firecrawl-cli@1.23.3` and `cliCompatibility()` against the CLI the runner
  installed, successfully.

  The first attempt failed, which is the point of having run it at all: both workflows had
  been installing a package called `firecrawl` since they were written. On npm that is the
  JavaScript SDK, and it ships no binary. The CLI is `firecrawl-cli`. Nothing offline could
  have caught it — every test drives a stub.

## What this ADR does not claim

That a collected artifact is good research. It is a corpus, honestly labelled, with three
human steps outstanding. The workflow's contribution is that it cannot pretend otherwise.

## Amendment, 2026-09-26 — the live adapter test is held to the same existence check

The marker rule above was written for `collect.yml` and never applied to `live-collection.yml`,
which declares its own environment for the reason this ADR gives: different audience,
different approvers. The first ever dispatch of `live-collection.yml` (run 36275687141) named
`live-collection` before anyone had created it. Per E-06 GitHub created it — empty — and the
run stopped only at "FIRECRAWL_API_KEY is not set". It failed safely by luck of an empty
environment, not by design: a key present at repository scope would have been read through it.

`live-collection.yml` now requires `vars.FETCHPROOF_LIVE_ENV == live-collection` before it
reads the key or spends, on the metered route (the keyless route reads no credential). The
same honest limit applies: a repository-level variable of that name defeats it, deliberately
and visibly. Pinned by `architecture-map.test.mjs`. Setup: `fetchproof/README.md`.

**Found in the same pass, and worse: the workflow could never have passed.** Its scratch project
is scaffolded from the template, whose plan has no queries and no URLs, and the step that edits
the plan only set budgets - so `research.mjs` collected nothing, wrote no ledger, and the next
step failed "collection produced no fetch ledger" whatever keys were present. Confirmed by
running the workflow's own step scripts locally, before and after. The plan now gets one fixed
public query about the vendor. And only `FIRECRAWL_API_KEY` reached the collection step, so the
merged search the header promised to test after a `lib/serpapi.mjs` change was never exercised;
`SERPAPI_API_KEY` is now passed through, optional.
