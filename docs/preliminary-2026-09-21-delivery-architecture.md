# PRELIMINARY note — how Fetchproof should be delivered

**Question:** Actions-only collector, local Windows `.exe`, hybrid desktop-over-Actions, or
REST/API seam only?

> ## SUPERSEDED, later the same day — and its headline finding was wrong about the cause
>
> The formal collection this note said was outstanding has since been done, through the
> gate, at **`docs/decisions/2026-09-21-delivery-architecture/`** — nine captures, a
> committed ledger, eight unknowns CLOSED, preflight PASS from that directory. The decision
> is recorded as **ADR-0031**, and the convention that made a committed home for it exists
> as **ADR-0030**.
>
> **What the evidence overturned.** The headline finding below — that
> `POST .../dispatches` returns `204 No Content`, that a caller "cannot learn which run it
> started", and that a `client_ref` correlation token is therefore required — is correct
> about what was observed and wrong about why. The response shape is **API-version
> dependent**: `204` under the default `2022-11-28`, and `200` with
> `{workflow_run_id, run_url, html_url}` under `2026-03-10`. Both were run against this
> repository to settle it. The correlation race is a property of an unpinned client, not of
> the endpoint, and the real requirement is smaller and firmer: pin
> `X-GitHub-Api-Version`.
>
> This note is kept as written rather than corrected in place. It is the record of a claim
> that survived reading and failed running, which is the most useful thing in the decision
> it led to.
>
> Everything below this line is the note as it stood before that collection.

---

> ## This is NOT a completed Phase 1 handoff
>
> **Formal Phase 1 collection remains outstanding.** This note has no discovery contract,
> no evidence rows, no cached captures and no ledger entries in this repository, so it
> has not passed — and cannot pass — the gate this project applies to research.
>
> **Why, plainly: I deleted the evidence.** Nine pages were collected on 2026-09-21
> through the metered route into a scratch project outside the repository, to avoid mixing
> a second research question into the corpus that answers this kit's own unknowns. The
> findings below were read from those captures. Then the scratch project was removed as
> routine cleanup, and with it the captures, the hash-chained ledger and the provenance
> for every claim here.
>
> That is the exact failure this kit exists to prevent, committed while using the kit. The
> repository's clean preflight validates its EXISTING corpus; it says nothing about this
> note.

## What is and is not independently checkable

The findings are not equally weak, and the difference matters more than the label:

| Finding | Status |
|---|---|
| `dispatches` returns `204 No Content` | **Independently re-verifiable in one command** — `gh api -X POST .../dispatches -f ref=main -i`. Does not depend on my captures at all. |
| Two dispatches are distinguishable only by timestamp | **Re-verifiable** — run IDs `35546279728` and `35546293660` are in GitHub's API and can be listed today. |
| Artifact retention, Actions billing, SEA stability, environment protection rules | **Citations, not evidence.** Live vendor URLs anyone can re-read, but with no capture, no hash and no chain behind them. Treat as leads to confirm, not as proven. |

The recommendation below rests mostly on the first two, which is why it survives the
downgrade. The supporting facts want re-collecting before anything is built on them.

---

## The finding that changes the design

**`POST /actions/workflows/{id}/dispatches` returns `204 No Content`. There is no body,
no run ID, no run URL.**

This was verified empirically, not read:

```
$ gh api -X POST repos/.../actions/workflows/offline-suite.yml/dispatches -f ref=main -i
HTTP/2.0 204 No Content
```

The proposal that prompted this research stated the response "includes the workflow-run ID
and run URL, allowing another program to monitor the run." It does not. A caller that
dispatches a run **cannot learn which run it started**. It must poll
`/actions/workflows/{id}/runs` and correlate by `created_at`.

That correlation is racy, and the race was demonstrated rather than assumed — two
dispatches 15 seconds apart:

```
35546293660  queued       workflow_dispatch  2026-09-21T00:00:48Z  actor=<dispatcher>
35546279728  in_progress  workflow_dispatch  2026-09-21T00:00:33Z  actor=<dispatcher>
```

Same event, same actor, nothing but a timestamp between them. (The `actor` field is
redacted to `<dispatcher>` rather than removed: both runs were dispatched by the same
account, which is the part the finding rests on. The identity of that account is not.) Two users of a future
desktop app dispatching at once would be indistinguishable to each other's clients.

**Consequence:** any option that returns results *asynchronously to a caller* needs a
correlation token the caller chooses. The workable shape is a required
`client_ref` input, echoed into the run name or the artifact name, so a poller can
identify its own run by something it supplied rather than by guessing from time.

Also observed: the dispatch response carries `Deprecation: Tue, 10 Mar 2026` with
`Sunset: Fri, 10 Mar 2028` — this applies to **API version `2022-11-28`**, not to the
endpoint. Integrations should pin a current `X-GitHub-Api-Version`.

## The other four findings

| # | Finding | Source |
|---|---|---|
| 1 | **Actions is free for public repositories** on standard GitHub-hosted runners. Cost is not a discriminator while this repo stays public — it becomes one immediately if it goes private, which the privacy analysis below argues it should. | GitHub billing docs |
| 2 | **Artifact retention is 90 days maximum**, configurable downward per repository. A ZIP is not archival; evidence that must persist has to be committed or stored elsewhere. | Actions settings / artifact docs |
| 3 | **Node's single-executable feature is Stability 1.1 — "Active development"**, and **macOS x64 is explicitly unsupported** ("skipped in the tests"). Windows is supported. | nodejs.org SEA docs |
| 4 | **Environments support deployment protection rules** — required reviewers and wait timers — which is the mechanism for gating a paid run behind an approval. | Actions environments docs |

Finding 3 is the one that most constrains the local `.exe` option, and it cuts *for* it
rather than against for this use: the target is Windows, which SEA supports. The
unsupported platform is macOS x64, which is not in scope. But "Active development" means
the packaging story may move under a shipped product.

## How the three human steps fare under each option

This is the axis the decision actually turns on, because it is the axis the kit's protocol
constrains. The steps are: **(a)** classify each map row `COVERED`/`DISMISSED`/`GAP`,
**(b)** rewrite each auto-extracted Finding into a defensible claim, **(c)** review and
approve the brief. ADR-0013 and ADR-0017 record that enforcing these was considered and
**rejected** — a check that judged whether an agent reasoned properly would be wrong.

| Option | Where (a), (b), (c) happen | Honest verdict |
|---|---|---|
| **Actions-only collector** | Nowhere in the run. The ZIP is a collected corpus; all three happen afterwards, wherever the user edits files. | Works, *provided the artifact says so.* The corpus it returns fails its own preflight by design — `discovery-contract/no-unknowns` — and the package must say that in words. |
| **Local Windows `.exe`** | In the app, as guided editing against the local corpus. | Best fit for the protocol: the three steps are editing tasks, and an editor is what they want. Costs a packaging story on Stability-1.1 tooling. |
| **Hybrid** | Collection remote, judgement local — the app pulls the artifact and guides (a)–(c). | Strongest long-term shape, and the most work. Also the option most exposed to the 204 finding. |
| **REST/API seam only** | Out of scope by construction. | Not a delivery option; it is the *interface* the other three would use. Should be built into whichever collector ships, not instead of one. |

## Recommendation

**Actions-only collector first, with an honestly labelled artifact and a `client_ref`
input** — which matches the sequence already chosen, with two additions the evidence
forces:

1. The artifact must carry the label at its top, in the package, not only in the workflow
   summary:
   ```
   COLLECTED CORPUS — HUMAN REVIEW REQUIRED
   Evidence has been collected. This is not an approved brief and does not
   authorize building. Three steps remain, and none of them is automated:
     1. classify each row in research/MAP.md
     2. rewrite each Finding in research/EVIDENCE.md into a claim you would defend
     3. run preflight, then write and review the brief
   ```
2. A required `client_ref` dispatch input, echoed into the run name and artifact name.
   Without it the API seam cannot tell one caller's run from another's — and adding it
   later means changing the integration contract after something depends on it.

**Do not go private-repo-blind.** This repository is **public**. Actions secrets are not
exposed, and `workflow_dispatch` requires write access — so credits are not open to the
world. But topics, collected URLs, evidence text and error output all become public the
moment they reach a log, an artifact listing, or a PR. Research whose *subject* is
sensitive should run in a private repository, where finding 1 stops being free.

## The structural gap that caused this, which will recur

The scratch project was not carelessness — it was the only option the kit offers, and that
is worth fixing before the next decision needs evidence.

`readCorpus(root)` reads `research/` relative to one project root, and a project has
exactly one discovery contract. This repository's contract enumerates U-1..U-8, all about
transports. Architecture-decision unknowns are a *different question*, and putting them in
the same contract would mean one corpus asserting two unrelated sets of claims, with
`unknown-closure` and `subtopic-coverage` judging them together.

So there are three options and the kit currently supports none of them well:

1. **A nested project** — `docs/decisions/<name>/research/...`, self-contained and
   committed, runnable by `cd`-ing into it. Works with the kit as built, since the project
   is the working directory. Costs a convention nobody has agreed.
2. **A second repository** per decision. Clean, heavyweight, and scatters the reasoning
   away from the thing it reasons about.
3. **One contract, multiple topics** — a change to the protocol, not to a directory
   layout, and the most invasive.

Option 1 is the cheapest and needs no code. What it needs is a decision that decision
research lives there, so the next person does not reach for a scratch directory and
delete the evidence as I did.

## What this note does not establish

- The runner-side `npm install -g firecrawl@1.23.3` path, which has still never executed.
- Whether artifact download is ergonomic enough for the intended beginner; that is a
  usability question and no amount of vendor documentation answers it.
- Anything about the desktop app's own architecture beyond the constraint that the 204
  finding imposes on it.
