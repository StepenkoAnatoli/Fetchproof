# research-kit

The research-first kit: a collector that turns a fetch into cached, citable evidence, and a
gate that checks the declared research contract. With the commit hook operating and no
override in effect, a gated project's commit is blocked while preflight fails if it stages
paths outside `research/` and the permitted project scaffolding.

PASS means the configured checks passed for the declared contract. The agent also writes
the contract and unknowns list: omitted blocking questions are not checked, and a trivially
easy unknown can pass. PASS does not establish completeness for the intended build or
the truth of the claims. Disclosed known unknowns and nonblocking warnings can remain.
Generated briefs, audits and package reading guides
carry the warning reasons from their evaluation; an unevaluated warning list says so.
These checks establish provenance and research structure. Source support, factual wording
and implemented behavior still need review and appropriate verification. The kit has no
controlled measurement of how much it reduces errors in research, code or writing.

When the current directory holds none of the four gate markers, preflight reports that
it is not gated and exits 0 in either output mode. With `--json`, this unjudged scope has
`pass:false`, counts `{ "pass": 0, "warn": 1, "fail": 0 }`, and one `warn/gate/not-gated`
notice; no research verdict or permission to build was established. Strict settings do
not promote this scope notice. This is the ungated CLI exception to the judged verdict's
`pass === (counts.fail === 0)` relationship (ADR-0153); gated verdicts retain it.

**The gate stops forgetful agents, not adversarial ones.** The edit hook matches
`Edit|Write|MultiEdit|NotebookEdit`, so shell redirection, `sed -i` and `tee` bypass it.
The commit hook is their backstop when it runs. `failOpen: true` is the default for a
missing or internally failing gate; an ordinary failing research verdict still blocks.
The active edit hook denies creation of `research/GATE_OFF`, with the same deliberate
off-switches as the `research/raw/` guard. Shell access, configuration access and hook
bypasses remain outside that protection. The ledger is self-attested and can be
recomputed by someone with write access; neither hook nor ledger is an adversarial sandbox.

Plain Node, no dependencies, no `package.json`. It installs with one command and runs
offline for everything except collection itself.

**That claim is about the repository, and collection is the exception in two ways.**
The kit itself pulls nothing from npm and has no lockfile — but the metered route
spawns a Firecrawl CLI that is installed globally and versioned outside this
repository, and the optional `live-collection` workflow installs that CLI from npm
at dispatch time. So the offline suite is reproducible from a clone alone; a live
collection additionally depends on npm being reachable, the package keeping its
name, the CLI staying on a supported major (`cliCompatibility` refuses otherwise,
before spending), and a configured credential.

**Supported on Linux and Windows; macOS is best-effort and untested.** "Supported" means
the full offline suite runs on that platform in CI on every commit — see
[the support policy](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/README.md#supported-platforms) for why the distinction is worded
that way and what it has already caught. Needs Node 22+ (22, 24 and 26 are each tested on
every commit), Git, and Python 3.11+ for the cross-language conformance runners.

New here? [Run it on a real project](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/README.md#run-it-on-a-real-project) is one ordered path
from nothing to a `preflight` verdict, and
[troubleshooting](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/README.md#troubleshooting) lists the failure modes that
actually happen.

## New here?

The getting-started guide lives on the [front page](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/README.md#install):
how to install the kit, how to run it on a project, how to hand it to an agent, and
[how to run a collection on GitHub](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/README.md#run-the-collector-on-github), token included.

It is there rather than here because that is the page GitHub shows someone who arrives at
the repository, and a second copy of a getting-started guide drifts - with the stale copy
always being the one the newcomer found.

This file is the reference: every command, the artifact format, the transports.

## Install

```
node research-kit/bin/install.mjs          # deploy to ~/.agents/research-kit + the skill root(s)
node research-kit/bin/install-hooks.mjs    # the commit gate and the edit-time gate
node research-kit/bin/doctor.mjs           # stop at READY
```

On a machine that builds rather than collects, say so once:

```
node research-kit/bin/install-hooks.mjs --role builder
```

The install also deploys the **skill set** (`skills/`, ADR-0146) beside the research-first
skill. Start from `skill-router`: it reads the machine role and the gate state and says which
skills may run here - a builder is never routed to one that collects.

## The sequence

The project is the **current working directory**. The kit takes no project argument.

```
node "$HOME/.agents/research-kit/bin/new-project.mjs" . --topic "<topic>"                # the canonical shape
node "$HOME/.agents/research-kit/bin/decompose.mjs"                                     # phase 0: the map of the project's topic, statuses blank
                                                             # then YOU mark COVERED/DISMISSED/GAP,
                                                             # write the unknowns into research/DISCOVERY.md
                                                             # and the queries/urls into research/plan.json
node "$HOME/.agents/research-kit/bin/prior.mjs" "<what you expect>"                      # optional, and only possible NOW
node "$HOME/.agents/research-kit/bin/research.mjs"                                       # collect (spends credits)
node "$HOME/.agents/research-kit/bin/preflight.mjs"                                      # do not build until PASS
node "$HOME/.agents/research-kit/bin/brief.mjs"                                          # the phase-1 -> phase-2 handoff
node "$HOME/.agents/research-kit/bin/audit.mjs" --zip                                    # one pasteable attachment
```

On a builder machine, the first command is instead:

```
node "$HOME/.agents/research-kit/bin/handoff.mjs"     # did the corpus arrive whole?
```

## Every command

| Command | What it answers |
|---|---|
| `doctor.mjs` | machine + project + gate + chain health, with the exact fix per problem (`--fix-arity` drops a torn ledger tail) |
| `preflight.mjs` | the verdict (`--checks`, `--check <name>`, `--strict`, `--json`) |
| `gate.mjs` | the verdict for a hook (`--gate commit\|edit`, `--staged-stdin`, `--posture`) |
| `research.mjs` | collect (`--depth`, `--refresh-days`, `--force`, `--dry-run`, `--status`, `--transport`, `--fallback`, `--witness`); stops and exits 2 when the account runs out (ADR-0129) |
| `prior.mjs` | register what you expect **before** collecting, chained so it cannot be moved or rewritten afterwards; with no argument, prints the one on record |
| `decompose.mjs` | phase 0 (`--topic`, `--recipe`, `--recipes`, `--max-scrapes`, `--dry-run`); the map shows the section headings of the pages it captured |
| `handoff.mjs` | the arrival question, with the remedy picked from the cause |
| `brief.mjs` | draft the handoff (`--state`, `--force`) |
| `audit.mjs` | render, `--list`, `--show`, `--zip` |
| `timeline.mjs` | regenerate the chronological review aid |
| `measure.mjs` | how this project's citations hold up, without a judge (`--json`); a report, never a gate |
| `export-warc.mjs` | this project's captures as one WARC 1.1 file for archive tools (`--out`); a copy, never a gate |
| `new-project.mjs` | scaffold the shape (`--layout`, `--force`) |
| `install.mjs` | deploy (`--dry-run`, `--into <project>`) |
| `install-hooks.mjs` | the two gates and the machine's role and posture |
| `panel.mjs` | the desktop panel: a page on 127.0.0.1 for keys, doctor, update, the topic and the builder hand-off (`--project`, `--port`, `--no-open`); collects only a builder's request, by auto-collect, on a collector (ADR-0147, ADR-0148) |
| `researcher-release.mjs` | release evidence (`validate`, `conform`, `fi-validate`), read-only |
| `path-authority.mjs` | Git-origin path-authority snapshots (`conform`, `validate`), read-only |
| `ledger-conformance.mjs` + `.py` | qualification-ledger vectors, in two languages |
| `fi-sidecar-conformance.mjs` + `.py` | FI sidecar and manifest vectors, in two languages |
| `property-vector-conformance.mjs` + `.py` | exported property vectors, in two languages |
| `property-replay.mjs` | replay a captured property failure deterministically |
| `evidence-context.mjs` | what one unknown rests on (`--unknown U-5`, `--all`, `--json`), read-only |
| `artifact.mjs` | the portable package: `create` (derives authorization, never takes it) and `validate` (offline, read-only) |
| `collect-remote.mjs` | run the collector on GitHub and bring the result back (`--repository`, `--topic`, `--query`, `--url`, `--prefer`, `--prior`, `--json`) |
| `mcp-server.mjs` | the collector as an MCP server over stdio, for an agent that speaks the protocol |
| `disclosure.mjs` | what a stranger can read of a workflow run (`--repository`, `--run`, `--topic`), unauthenticated and read-only |
| `selftest.mjs` | the whole suite, offline, under a scratch home with no `RESEARCH_KIT_*` variable or vendor key (ADR-0123) |

## The desktop panel

```
node "$HOME/.agents/research-kit/bin/panel.mjs" --project "C:\path\to\my-research"
```

It opens your browser at a page served from 127.0.0.1. Across the top it shows the
project's topic, this machine's role and a **Connect builder** button. Below are the
SerpAPI key (saved to the machine config and never shown again), **Doctor**, and
**Update**. Update installs the kit copy the panel was started from, so to update, start
the panel from the new download.

**Connect builder** is the hand-off. This machine collects and the builder builds. The
builder is any AI agent or a person, on its own machine. The panel runs preflight, handoff
and doctor and opens `BRIEF.md`. It then gives you the push lines for this machine and the
text to paste to the builder. That text tells the builder to declare its role, run handoff
and preflight, read the brief, and never collect. When it needs a fact, it asks for one.

**Builder requests (auto-collect).** The builder decides what gets collected, and this
machine collects it. The builder pushes one file per fact, `research/requests/<id>.json`:

```
{ "fact": "What is the burst limit of endpoint X on the free tier?",
  "blocks": "the retry and queue design",
  "urls": ["https://docs.example.com/limits"],
  "queries": ["example api free tier burst limit"] }
```

Optional fields: `prefer` (owner domains), `unknown` (an existing `U-n` row), `maxPages`,
and `topic` (a whole new project, created under the folder you approve in the panel).
Set **Auto-collect** to Automatic. On its interval, or when you press **Check now**, the
panel then:

1. pulls;
2. checks each new request: the fixed fields, http(s) pages only, nothing on this machine's
   network, and within the per-request cap;
3. adds the request's `U-n` row and its `plan.json` entries;
4. runs the same `research.mjs`, then preflight;
5. commits the corpus with its ledger, plus `<id>.result.json` beside the request, and pushes.

The builder pulls and reads the result. A refused request gets its reasons in the result.
The panel shows every request, the pages used or reserved today and the daily cap.
Accounting comes from a private message from the research child, separate from its bounded
diagnostic output. If its measurement is missing or invalid, collection pauses and reserves
that attempt's remaining page allowance against today's cap. The failed result and output
label those pages as reserved: actual spend is unknown. Resume allows other requests within
the remaining daily cap; it does not automatically retry that failed request or remove the
reservation. A valid received measurement remains counted even if the child exits unsuccessfully.

Before the research child starts, its entire newly admitted allowance and an in-flight
pause are saved atomically in the existing meter. A killed collector therefore leaves
that charge and pause for inspection on restart, including after switching projects.
A valid report refunds only unused allowance once. Continuation charges only its newly
admitted remaining pages. A failed meter write prevents the child from starting.
A run that completes across midnight never refunds yesterday against today: its
measured total, or full allowance when unmeasured, is conservatively charged to the
completion day. A single final total cannot date individual attempts, so a cross-day
run can be charged on two days; an over-cap completion remains paused for inspection
(ADR-0152). These are page-attempt allowances, not a provider billing balance.

It runs only on a collector. It never passes `--fallback`: when the credits run out, it
commits what it collected, pauses, and waits for you to top up and press **Resume**. While
`research/` has uncommitted changes it waits, because its commit takes everything under
`research/` (ADR-0148).

**A desktop shortcut on Windows.** Right-click the desktop, choose New > Shortcut, and
give it this target:

```
node "%USERPROFILE%\.agents\research-kit\bin\panel.mjs" --project "C:\path\to\my-research"
```

Ctrl+C in the window it opens stops the panel. The address it prints carries a one-time
token: anyone holding it can use the panel until it stops, so do not share it.

## The portable artifact

One versioned ZIP that an AI agent, a GitHub Actions workflow, a future Windows app and a
person with an unzip tool all read the same way. See
[ADR-0032](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/docs/adr/0032-one-artifact-contract-for-every-consumer.md).

```
node research-kit/bin/artifact.mjs create --root . \
  --repository OWNER/REPO --ref main --commit <sha40> \
  --workflow collect.yml --run-id <workflow_run_id>

node research-kit/bin/artifact.mjs validate --file research-kit-corpus-v1-<ref>.zip --json
```

**The rule the format exists to carry.** An AI or application may build only when:

```
state == "APPROVED_BRIEF"  AND  gate.verdict == "PASS"  AND  buildAuthorized == true
```

`validate` exiting **0 does not mean you may build.** It means the package is internally
consistent: the container is safe, the manifest matches its digest, every declared file is
present with the bytes it claims, and the provenance chain verifies. Permission is a
separate field, `buildAuthorized`, and a valid collected corpus reports `PASS` with
`buildAuthorized: false`.

| Exit | Meaning |
|---|---|
| 0 | the package is valid |
| 1 | the package is invalid |
| 2 | incomplete, or a format major this build does not implement |
| 3 | validation was blocked and reached no verdict |

**Authorization is derived, never requested.** There is no `--build-authorized`, and the
CLI **refuses** it rather than ignoring it:

```
unknown option --build-authorized
Authorization is derived from the project and cannot be supplied.
```

Accepting it silently would be safe and misleading - exit 0 plus a package back is every
reason to believe the option was honoured. `create` runs the real gate over the real
project and reads the real review state; a caller supplies identity (which repository,
which run) and nothing about permission.

**What a consuming agent must do, in order:**

1. Validate the ZIP.
2. Read `manifest.json`.
3. Confirm `clientRef` — or `source.workflowRunId` — matches the job you asked for.
4. Read `README-FIRST.md`.
5. Follow `nextActions` in order.
6. Read `project/AGENTS.md`.
7. **Do not build unless `buildAuthorized` is true.**

A package reading `{"state": "REVIEW_REQUIRED", "buildAuthorized": false}` is a
*successful collection that still forbids building*. Do not describe it as an approved
brief.

**Who does the review.** The agent. The three steps are checked by what they leave behind (a
classified map, rewritten findings, an authored brief), and the agent declares them done
with the line `Reviewed by: agent` in `BRIEF.md`; the manifest carries it as `review.by`
(`agent` or `undeclared`), and `validate --json` reports it as `reviewedBy`. It is a
declaration nothing verifies, and not an approval condition (ADR-0074). There is no human
review step (ADR-0107): format 2.0.0 renamed the state `HUMAN_REVIEW_REQUIRED` to
`REVIEW_REQUIRED` and retired `review.by: "human"`. The validator still reads 1.x packages,
and reports their `HUMAN_REVIEW_REQUIRED` as `REVIEW_REQUIRED`, so a consumer switches on
one name.

**Getting from a collected package to an approved one.** The manifest is written once. After
the review, run the `create` line the package's README-FIRST prints, from the package folder:
it re-packages `project/` under the identity the package arrived with, into `reviewed.zip`,
whose manifest is derived from the reviewed project (ADR-0052).

**States, and what a UI should call them:**

| `state` | Label for a person |
|---|---|
| `COLLECTION_FAILED` | Collection stopped |
| `REVIEW_REQUIRED` | Your sources are ready for the agent's review |
| `REVIEW_IN_PROGRESS` | Review is in progress |
| `PREFLIGHT_BLOCKED` | Research is not ready yet |
| `APPROVED_BRIEF` | Research approved — you may start building |

An application should drive its buttons from `nextActions`, its recovery text from
`gate.blockingFindings`, its warnings from `privacy`, its progress and cost lines from
`collection`, and enable the build action from `buildAuthorized` alone. Raw codes belong
under an "Advanced details" section.

**Two privacy properties, both deliberate.** The topic is in the manifest and **never in
the filename** — an artifact listing is readable by an anonymous caller on a public
repository, so a filename leaks before anybody opens anything. And
`safeForPublicDistribution` is `false` by default: a package with no secrets in it can
still disclose what was being researched.

## Collecting from GitHub Actions

`.github/workflows/collect.yml` is the collector a non-technical operator triggers. It is
**manual only** — ordinary CI can never start a paid run — and it runs on
`ubuntu-latest` or `windows-latest`. See
[ADR-0033](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/docs/adr/0033-the-collector-refuses-rather-than-degrades.md).

```
gh api -X POST repos/OWNER/REPO/actions/workflows/collect.yml/dispatches   -H "X-GitHub-Api-Version: 2026-03-10"   -f ref=main -f 'inputs[topic]=...' -f 'inputs[max_pages]=8'
→ 200 {"workflow_run_id": 35548135379, "run_url": "...", "html_url": "..."}
```

That run id is the correlation key, and it is what the artifact's manifest records. Under
the default `2022-11-28` the same call returns `204 No Content` and the caller learns
nothing.

**One-time setup** is on the front page:
[Run the collector on GitHub](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/README.md#run-the-collector-on-github).
The workflow refuses to spend until it exists. Not repeated here - a second copy of a
setup procedure drifts, and the stale copy is the one somebody follows.

**Why there is no required reviewer.** A reviewer approving a *dispatch* is a spend gate,
not a review: nothing has been collected yet, so there is nothing to judge, and a human in
that position cannot tell a good run from a bad one. The research review happens at the
end, where the corpus exists, and is carried by `buildAuthorized` - not by a button. A
required reviewer would also make autonomous dispatch impossible, which is the point of
having a collector at all.

**What bounds the spend instead:** `max_pages` (1-25 per run), the depth tier, and the
vendor account cap, which returns HTTP 402 at zero rather than billing over. Worst case is
a month's allowance, not an open-ended bill.

**What you accept:** anyone with write access - or any token carrying `actions: write` -
can spend credits unattended, up to that cap. If that trade stops being right, add required
reviewers to the environment; nothing in the workflow depends on their absence. A **wait
timer** is the middle option: a cancellation window with no human required.

If a reviewer is ever added, note that it must be a real principal - a user or a team - and
teams exist only inside an organization. Nothing in this repository names a reviewer, and
nothing should.

| environment **secret** `FIRECRAWL_API_KEY` | the metered credential |
| environment **variable** `RESEARCH_KIT_COLLECTION_ENV=research-collection` | proves the environment exists |

**Put the secret in the environment, not in repository secrets.** A repository secret
resolves too, and collection would work - but any workflow in the repository could read
it without a reviewer ever being asked. A `scope-check` job declaring no environment
fails the run if it can see the credential at all, which is how that is caught rather
than assumed.

The variable is not ceremony. A workflow naming an environment that does **not** exist does
not fail — GitHub creates one, with no protection rules and no secrets. A typo in the name
would remove the approval gate silently, so the collector requires a marker only a
configured environment can supply.

**The adapter test, `live-collection.yml`, has its own environment and needs the same two
things** - it is kept apart from `research-collection` on purpose (ADR-0033: "does the adapter
still work" and "collect this, for a person" have different approvers):

| in environment `live-collection` | why |
|---|---|
| **secret** `FIRECRAWL_API_KEY` | the metered credential for the transport test |
| **variable** `RESEARCH_KIT_LIVE_ENV=live-collection` | proves the environment exists (since 2026-09-26) |
| **secret** `SERPAPI_API_KEY` *(optional)* | present, the test searches SerpAPI and the fetch provider merged, which is what exercises `lib/serpapi.mjs` |

Without the variable a metered run refuses before it reads the key or spends anything. The
keyless route (`transport: http-keyless`) needs neither.

**A missing credential refuses; it never degrades.** There is no keyless fallback: that
would return a measurably worse corpus under the same artifact name, and the person who
asked for research would have no way to tell.

**`client_ref` is public.** If you pass one it becomes the run name *and* the artifact
name, both readable by anyone who can read the repository. Use an opaque job id
(`job-0417`); never put the subject in it. `layoff-plan-q3` fits the permitted shape
perfectly, which is why the workflow warns rather than pretending a regex could judge it.

**Privacy, measured rather than assumed.** An earlier version of this paragraph said
dispatch inputs are visible on the run page to anyone with read access. That was asserted,
not checked, and checking it found the opposite. Measure it yourself:

```bash
node research-kit/bin/disclosure.mjs --repository OWNER/REPO --run <id> --topic "..."
```

Unauthenticated, on this repository, 2026-09-21:

| probe | result |
|---|---|
| run metadata, step names, timing, artifact **listing** | `200` readable |
| artifact **download** | `401` refused |
| job **logs** | `403` refused |
| repository secrets | `401` refused |

The topic appeared in **none** of the readable responses. A stranger learns the *shape* of
a run — that one happened, when, how long, what the steps were called, that an artifact of
N bytes exists — and not its subject or its contents.

That is why keeping the topic out of the run name and the artifact name is the *primary*
control rather than a minor one: those names are the disclosure surface, and they are the
part the workflow governs.

**Measured 2026-09-22, and it is not safe: a signed-in reader sees the topic.** This used to
say the web UI was unknown. It is not. Actions prints a step's `env:` block into the job
log, and every dispatch input reaches a step through `env:` — so the log carries
`TOPIC: <your topic>` verbatim. Anonymously the log is refused (`403`, and the web UI says
*"Sign in to view logs"*), but on a **public repository that wall is authentication, not
need-to-know**: anyone with a GitHub account is through it.

The anonymous table above is still true, every row. What was wrong is the inference — a list
of refusals reads like "the subject is private", and it is not.

This is not worked around, deliberately: passing inputs through `env:` is the same rule that
keeps them out of a shell, and routing around the log would mean routing around that. And
`disclosure.mjs` cannot see it *by design* — it probes unauthenticated, because a probe that
quietly authenticated would answer a different question. Read a clean report as **"a
stranger learns the shape"**, never as "nobody learns the subject".

**So: to research something you would not publish, do not use this route.** Use a private
repository, or collect locally.

**Going private is not the reflex fix.** On a GitHub Free plan — which this account is on —
converting a repository to private makes its protection rules and environment secrets
**ignored** rather than refused. The collector would stop working, safely but confusingly.
That is a plan change, not a visibility toggle.

**An artifact is transport, not archival storage.** Workflow artifacts last at most 90
days on a public repository and vanish with the run that produced them. Anything that must
persist gets committed.

## Transports

Three adapters behind one seam, chosen by `--transport`, `RESEARCH_KIT_TRANSPORT`, the machine
config, or a probe:

- **`firecrawl-cli`** — metered, spawned as an argv array with no shell.
- **`http-keyless`** — no key, no credits, grades its own capture completeness honestly. A page on the web may not redirect it into this machine's network - loopback, private or link-local addresses - unless the URL you asked for was internal itself; `RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS=1` lifts that (ADR-0110).
- **`browser`** — a local Chromium or Chrome renders the page (`--transport browser`); free, reads pages built by JavaScript or refused to non-browser clients; fetch only (ADR-0088).

When Firecrawl's credits run out mid-run, a local run stops, reports what is left as
`uncollected`, prints the decision and exits 2 (ADR-0129): top up and run the same command,
or run it with `--fallback`, which switches the rest of the run to `browser` when a browser
is installed, else `http-keyless`, each capture's ledger entry naming the transport that
fetched it (ADR-0086). The unattended collectors pass `--fallback`. Tavily is not a fallback: its terms
reserve training on what is sent (C-6, re-checked 2026-09-28). A Firecrawl scrape is a live fetch: the adapter passes `--max-age 0`, because the vendor otherwise answers from a copy up to two days old; a cached answer, if one is sent anyway, is recorded in the capture's front matter and the ledger entry as `cacheState` and `cachedAt` (ADR-0139). Beside each capture the collector keeps the text it was converted from, `<capture>.source.html`, named and hashed in the same ledger entry (ADR-0140), so a conversion can be checked or redone later; it is never cited or graded itself.

## What is built

Everything the protocol needs: the corpus, the chain, the thirteen checks, the verdict,
both gates, all three transports, phase 0, the brief, the audit and its bundle.

And, since 2026-09-20, the **release-evidence validator layer** — which this file said
was "not built, deliberately" until it was. It was deferred by
[ADR-0022](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/docs/adr/0022-build-the-protocol-kit-first-defer-the-release-evidence-validators.md)
because the sealed records and fixtures it validates were unavailable; they turned out to
be on this machine, and it was ported module by module under
[ADR-0029](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/docs/adr/0029-the-validator-layer-arrives-as-a-source-not-a-donor.md).

| Validator | Answers |
|---|---|
| `release-validator.mjs` | R28–R32 release evidence: envelope, predecessor, role, visibility, promotion, path containment → `PASS` / `INCOMPLETE` / `FAIL` / `REOPEN` |
| `path-authority-validator.mjs` | Git-origin path-authority snapshots: schema, self-excluding envelope hashes, root containment, required origin proof |
| `fi-validator.mjs` | FI bundles: evidence manifest, sign-off sidecars, workbook projection |
| `r29-workbook-linkage-validator.mjs` | the R29 reviewer-workbook register: cross-task links, duplicate identities, pointer readiness |
| `ledger-conformance.mjs` | canonical-JSON, self-excluding, chain-hash and Ed25519 vectors |
| `fi-sidecar-conformance.mjs` | FI sidecar and manifest vectors: valid / malformed / tampered |
| `property-vector-conformance.mjs` | the property suite's findings, exported as fixed vectors |
| `property-replay.mjs` | capture a failing property seed once; replay it deterministically |

Every one of them is **read-only and offline**. No validator opens a socket, spawns a
shell, calls `eval`, or reads an environment variable — so none of them can use a
credential even by accident. The single exception is deliberate and narrow:
`property-replay` writes a captured failure with `flag: 'wx'` (`O_EXCL`), so a second
failure on the same seed cannot overwrite the first.

```
node research-kit/bin/researcher-release.mjs validate --root <records> --package R29 …
node research-kit/bin/researcher-release.mjs conform --root <dir> --schema <schema.json>
node research-kit/bin/researcher-release.mjs fi-validate --root … --workbook … [--report out.json]
node research-kit/bin/path-authority.mjs          conform | validate
node research-kit/bin/ledger-conformance.mjs      --vectors <packet.json> --json
node research-kit/bin/fi-sidecar-conformance.mjs  --vectors <packet.json> --json
node research-kit/bin/property-vector-conformance.mjs --vectors <packet.json> --json
node research-kit/bin/property-replay.mjs         --case <case-id>
```

Status maps to exit code — `PASS` 0, `FAIL`/`REOPEN` 1, `INCOMPLETE` 2, `BLOCKED` 3 — and
`--json` output is byte-deterministic across runs. The only command that writes anything
is `fi-validate --report <file>`, and only when you name the file.

**`validate` checks a package, not a file, so start from the worked example** rather than
from the schemas — the schemas give you the shape of each file but not how they refer to
each other:

```
node research-kit/examples/release-evidence/run-example.mjs
```

[`examples/release-evidence/`](examples/release-evidence/README.md) is six synthetic
packages: the smallest one that passes, four that fail one way each with the error code
named, and one that **passes** in order to show that a record the registry does not list
is never validated at all. All offline, no credential, and a test asserts they still
behave as their README says.

### Two languages, one answer

Three of the conformance runners ship **twice**, in Node and in Python:

```
bin/ledger-conformance.mjs          bin/ledger_conformance.py
bin/fi-sidecar-conformance.mjs      bin/fi_sidecar_conformance.py
bin/property-vector-conformance.mjs bin/property_vector_conformance.py
```

They read the same vector packets and must agree per vector, which the suite asserts.
The Python runners are **standard library only** — `ledger_conformance.py` implements
Ed25519 verification by hand rather than importing a crypto package, which is why it is
298 lines against Node's 140. Two independent implementations agreeing is a stronger
claim than one implementation tested twice.

Report hashes are *not* compared across languages, and deliberately: `reportSha256`
covers `implementation.runtime`, so it is a within-runtime determinism check. Equivalence
is asserted per vector.

### Two files that are deliberately absent

`trap-register.schema.json` and `dashboard-status-vectors.json` exist in the tree this
layer was ported from and are **not here**. Nothing ported references either — no module,
binary, test or fixture names them. Under ADR-0029 rule 4 nothing enters ahead of its
dependents, and a schema no code validates against is a file that will drift silently
until someone trusts it. They come with the code that needs them, or not at all.

## Credentials

**No credentials ship with this repository.** See the root
[README](https://github.com/StepenkoAnatoli/Research-Kit/blob/main/README.md#keys-and-cost) for where keys go; the summary is that the kit
reads one from the environment or `~/.agents/research-kit.config.json`, never from the
repository, and `--transport http-keyless` runs the whole collector with no key at all.

The validator layer needs none of this. `selftest.mjs`, `preflight.mjs` and every
validator CLI run offline with no credential — which is the point of a conformance suite
that a reviewer has to be able to re-run.

## Tests

```
node research-kit/bin/selftest.mjs            # all of it
node research-kit/bin/selftest.mjs gate hook  # just these files
```

1782 tests, offline, no key and no network. The runner **awaits** every test, so `ok` means
the assertions settled (ADR-0021), and each test is raced against a watchdog
(`RESEARCH_KIT_TEST_TIMEOUT`, default 60s).

A prerequisite this host cannot provide - no POSIX shell, no git, no python, and no
Chromium or Chrome for the two LIVE browser tests (`NO-BROWSER`) - is reported as `UNSUP`
with its reason code and **blocks**. It is never a silent skip: a test that
returns early on a missing prerequisite prints `ok` having asserted nothing, which is
the same false green one layer up.

A full pass therefore needs a browser on PATH; the hosted CI images carry one, and a
runner image that dropped it would block CI rather than pass without the two tests. For a
local run on a machine without one of them - most often Python, or Chromium - set
`RESEARCH_KIT_ALLOW_UNSUP=1`: a run whose only blockers are unsupported tests then exits 0,
still lists each one, and ends `NOT a full pass` rather than `all tests passed`. A failed
test is never waived, and the option is ignored when `CI` is set, so the merge check still
blocks (ADR-0108).

`test/hardening.test.mjs`, `test/index-gate.test.mjs` and `test/concurrency.test.mjs`
pin the defects confirmed in the 2026-09-16 researcher review, each named by its
F-number, so none of them can return unnoticed. The concurrency suite runs two real node
processes at one corpus.
