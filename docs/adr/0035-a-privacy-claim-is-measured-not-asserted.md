# ADR-0035 — A privacy claim is measured, not asserted; and this repository stays public

- **Date:** 2026-09-21
- **Status:** accepted
- **Area:** disclosure, plan, credentials
- **Depends on:** ADR-0031 (Actions-first delivery), ADR-0033 (the collector refuses rather than degrades)
- **Evidence:** `docs/decisions/2026-09-21-delivery-architecture/` E-06 and E-08, plus the measurement below

## Context

Two questions were open and had been answered in prose rather than by checking.

**"Should this repository go private for sensitive research?"** ADR-0031 recorded the
constraint and nothing acted on it. **"What does a public run expose?"** The collector's own
header answered it, confidently and wrongly: *"`workflow_dispatch` inputs are themselves
visible on the run page to anyone with read access."*

That sentence was written by me, from reasoning, and never tested.

## The measurement

Unauthenticated requests against this repository, run `35608301287`, on 2026-09-21. The
topic was `GitHub Actions workflow artifact retention period`, and every response body was
searched for it:

| probe | status | topic present |
|---|---|---|
| run metadata | `200` readable | no |
| jobs and step names | `200` readable | no |
| run timing | `200` readable | no |
| artifact **listing** | `200` readable | no |
| repository secrets | `401` refused | — |
| artifact **download** | `401` refused | — |
| job **logs** | `403` refused | — |

**A stranger learns the shape of a run and not its subject.** That one happened, when, how
long it took, what its steps were called, that an artifact of N bytes exists with a given
name — and nothing about what was researched or what came back.

The claim in the header was wrong in the direction that feels safe, which is still wrong.
An overstated warning is the same defect as an understated one: a reader who finds a
warning false once discounts the next, and the next may be the true one.

## Decision

### 1. This repository stays public

Going private is the reflex answer and it is the wrong one here, for a reason that is
recorded rather than assumed. This account is on the **free** plan — checked, not inferred:
`gh api user --jq .plan.name` returns `free`. Per E-06, converting a GitHub Free repository
from public to private makes its protection rules **and environment secrets** *ignored*
rather than refused.

The collector's credential lives in the `research-collection` environment. Going private
would make it unreadable, the collector would fail its credential check, and the failure
would look like a broken workflow rather than a plan limitation. The next move — adding the
key as a repository secret to "fix" it — is refused by the `scope-check` canary, correctly
and confusingly.

So privacy for sensitive subjects is a **plan change**, not a visibility toggle, and it is
not needed for what is measured above.

### 2. The naming rules are the primary control, not a minor one

The measurement says the names are the disclosure surface. Everything the workflow does to
keep the topic out of `run-name` and the artifact name is therefore the main defence rather
than a nicety, and `client_ref` being public (it becomes both names) is the sharpest edge
in the design.

### 3. The claim becomes executable

`lib/disclosure.mjs` and `bin/disclosure.mjs` make the measurement repeatable by anyone:

```
node fetchproof/bin/disclosure.mjs --repository OWNER/REPO --run <id> --topic "..."
```

Unauthenticated by construction — there is no token parameter, and an unknown flag matching
token/auth/key/secret is refused with that reason, because a probe that quietly
authenticated would answer a different question while looking like this one.

Exit codes are the finding: `0` shape only, `1` content readable, `2` subject leaked, `3`
could not measure. A documentation paragraph goes stale silently; a command does not.

### 4. An unchecked thing is never reported as a clean thing

`needleChecked` exists so that "the subject was not exposed" cannot be printed when no
subject was searched for. Without `--topic`, the report says **not checked**. An
unreachable endpoint is likewise a refusal to conclude, not a pass. This is the same
failure the ADR is about, one level down: the probe must not do to its reader what the
header did to me.

## What is NOT measured, and is therefore not claimed

> **This section is superseded.** It was written before the gap was closed; see the
> amendment below, which measured it and found the less comfortable answer. Kept as written
> because the gap being named here is why it got closed.

**What a signed-in user sees in the web UI.** That is a different surface from the REST
API, and it could not be tested from here — the browser available to this session cannot
reach github.com. The logs contain the topic (the step prints `TOPIC:` in its `env:`
group), and the API refuses them to a stranger with `403 Must have admin rights to
Repository`. Whether the UI is equally strict for a signed-in reader is **unknown**, and
"unknown" is what the documentation now says rather than "safe".

### Corroborated, 2026-09-21 — and going private fails earlier than this ADR said

Decision 1 rested on E-06 alone. E-11, an independent reference page, states the same rule
as availability rather than as consequence: "If you are using GitHub Free, environment
secrets are only available in public repositories", with the identical note for required
reviewers, wait timers, administrator bypass and custom protection rules.

It also carries the part E-06 did not, and it changes the predicted failure. Environment
**variables** are governed the same way — available for all public repositories, and for
private ones only on Pro or Team. So a Free repository converted to private loses
`FETCHPROOF_COLLECTION_ENV` as well as `FIRECRAWL_API_KEY`.

This ADR predicted the collector would stop at the **credential** check. It would in fact
stop one step earlier, at "the protected environment is the one that approved this run",
reporting that the environment did not supply its marker — which reads as a missing or
auto-created environment rather than as a plan limitation. Still a refusal rather than a
silent spend, and a worse diagnostic than expected. The step's message already names the
right fix for the wrong reason; anybody hitting it on a Free private repository should read
this paragraph first.

### The unmeasured half, measured — 2026-09-21, later the same day

The section above says what a signed-in user sees "is **unknown**, and 'unknown' is what
the documentation now says rather than 'safe'". That was the right posture and it did not
survive contact with the documentation.

Collected through the collector itself, into
`docs/decisions/2026-09-21-public-run-visibility/`:

- "You must be logged in to a GitHub account to view workflow run information, **including
  for public repositories**." That is why an anonymous probe saw so little — the web
  surface *starts* at an account.
- Viewing logs, searching logs, downloading logs and downloading artifacts each carry the
  same requirement: "**Read access to the repository is required to perform these steps.**"

**On a public repository, read access is universal.** So any person with a free GitHub
account can open a collector run, read the logs — which echo the dispatched topic in the
`env:` group the runner prints — and download the artifact, which is the entire collected
corpus.

**The `401` and `403` this ADR measured are refusals of ANONYMITY, not of strangers.** The
measurement was accurate about what it measured; the population it measured is not the
population that matters.

Three consequences:

1. **The naming rules are demoted, not discarded.** This ADR called them "the primary
   control". They cover the anonymous surface — listing-scrapers, a glance over a shoulder
   — and nothing beyond it.
2. **`retention-days: 7` on the collector now has a recorded reason.** It bounds the
   window; it removes nothing. The comment in `collect.yml` says so rather than leaving
   seven days looking like a tidy default.
3. **Decision 1 stands, with a different caveat.** Staying public was decided on *plan*
   grounds — a free private repository has its environment secrets and variables ignored,
   so going private breaks the collector rather than protecting it. That is untouched. What
   changes is the sentence attached to it: not "the exposure is limited to shape" but "the
   exposure is total to anyone with an account, and the remedy is a paid plan, not a
   toggle".

The gap was named in this ADR and closed by the kit this ADR is about, which is the first
time that loop has run on a question this repository asked of itself.

## Alternatives considered

**Go private anyway, to be safe.** Breaks the collector on this plan, for an exposure the
measurement does not show.

**Reword the warning.** Cheaper, and it would have left the next claim just as unchecked.
The problem was not the wording.

**Refuse to run when the topic looks sensitive.** A judgement about meaning, which a regex
cannot make — the same reason `client_ref` warns rather than refuses.

## Consequences

- `collect.yml`, `README.md` and `fetchproof/README.md` now carry the measured table and
  the command, and each states what was not measured.
- Both corrected passages **quote the claim they replaced**. A correction that erases what
  it corrected teaches nobody, and this one is the second time in two days that something
  built from documentation turned out untrue when run.
- `bin/disclosure.mjs` is read-only and unauthenticated, so it is safe to run against a
  repository you do not own — which is also the only way to check somebody else's claim
  about their own exposure.

## Amendment, 2026-09-22 — the signed-in surface was measured, and it is not safe

This ADR left a hole and named it: *"what a signed-in user with read access sees in the web
UI, which is a different surface from the REST API. Treat that as unknown rather than safe."*

It is no longer unknown. Runs `35762363585` and `35762574315`, checked both ways:

| surface | result |
|---|---|
| anonymous, web UI **run page** | the dispatch input values appear **nowhere** in 236 KB of HTML, not even collapsed |
| anonymous, web UI **job log** | *"Sign in to view logs"* — refused, agreeing with the REST `403` |
| **signed in**, job log | **every input passed through `env:` is echoed verbatim** |

The third row is the finding. GitHub Actions prints a step's `env:` block into the log, so
the log carries:

```
TOPIC: probe
PRIOR: PROBE-START length=1200 xxxxxxxx...
```

**On a public repository, that makes the topic readable by anyone with a GitHub account.**
Not by a passer-by — the `403` is real — but the wall is authentication, not need-to-know.

### What this changes, and what it does not

**The measurement in the body above stands.** Every row of it was scoped to unauthenticated
REST and every row is still true. What was wrong is the inference a reader would draw from
it, and this ADR is the reason they would draw it: a table of refusals invites the
conclusion that the subject is private, and it is not.

**It is not fixed here, deliberately.** Passing an input through `env:` is the same rule
that keeps it out of a shell (ADR-0020). Routing it around the log would mean routing it
around that protection, and trading a disclosure to signed-in readers for a code-execution
surface is a bad trade. The honest response is the accurate claim, not a workaround.

**`bin/disclosure.mjs` is unchanged and should be.** It probes unauthenticated on purpose —
a probe that quietly authenticated would answer a different question while looking like this
one. What changes is how its output must be read: a clean report means *a stranger learns
the shape*, never *nobody learns the subject*.

### The rule this is the third instance of

Twice this ADR has recorded something that felt settled and turned out untrue when run —
first the header's claim that inputs are visible, then this. Both times the error was in the
step from *what was measured* to *what it means*, not in the measurement.

So the standing correction is narrower than "measure it": **state the scope of the
measurement in the same breath as its result**, because a true finding with its scope left
off is how an overstatement gets built on top of honest work.

**Practical consequence:** research a subject you would not publish, and this route is the
wrong one. Use a private repository, or collect locally.
