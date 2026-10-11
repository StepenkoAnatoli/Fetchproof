# Research-first project bootstrap

Agent instructions for this project. Read this before planning, designing, or building
anything here.

## How this project works: two phases, two roles

**Phase 1 - research (this kit).** Close every blocking unknown with fetched primary
sources, then pass the gate. The output is a briefing, not code: `research/DISCOVERY.md`
(the contract), `research/EVIDENCE.md` (claims with cached pages behind them), and
`research/BRIEF.md` (the handoff). Phase 1 never writes product code.

**Phase 2 - build (someone else's job).** A builder - another agent, a different model, or
a human - takes `research/BRIEF.md` plus `research/` and implements. They should not need
to re-research anything: if they do, phase 1 was incomplete, and the fix is to collect the
missing fact rather than to let the builder guess it.

The handoff needs PASS, an intact corpus, classified MAP, rewritten Findings, and an
authored brief with its judged sections answered and current stamped inputs. PASS or
file presence alone does not complete phase 1. An authored unstamped brief keeps the
existing approval path with currency unknown; role controls collection, not approval.

## Two machines, two roles

The role is machine config - `role: "collector" | "builder"` in
`~/.agents/research-kit.config.json`, default `collector`; declare it with
`node "{{KIT}}/bin/install-hooks.mjs" --role builder`.

| | **collector** (the operator's PC) | **builder** (a sandbox, a CI box, a laptop) |
|---|---|---|
| holds | the Firecrawl key when using that route; none for a chosen keyless route | no collection key required, no Firecrawl egress |
| runs | `decompose.mjs`, `research.mjs` | `handoff.mjs`, `preflight.mjs`, the build |
| absent Firecrawl CLI/auth is | a **FAIL** for an unchosen or Firecrawl route; passes those findings for an explicitly chosen keyless route | expected: this machine does not collect |
| must | push `research/raw/` including its dotfiles | **not collect** - the collection CLIs refuse (exit 2) |

**If you are on a builder machine and there is no brief: you do not collect.** A page
fetched by hand is not evidence in this kit, and a builder that "re-collects" a missing
page forges a corpus instead of reporting a gap. Name the missing fact instead.

A builder's first command is:

```
node "{{KIT}}/bin/handoff.mjs"
```

The remedy depends on the cause, and the command says which: something that did not
travel is the collector's to push (`git add research/` then `git add -f research/raw/.fetches.jsonl`,
the ledger by name - `-f` on the whole folder also commits the machine-local logs);
a corpus that travelled whole and was rewritten on checkout here is fixed **here**, with
`.gitattributes`, and costs no credits.

A Git builder-request result marked `collected` delivers captures, not completed
review. The builder reads and judges; the collector records Findings, unknown closures,
the map and current authored brief. Send review-only gaps in prose; request a fetch
only for a missing external fact. Local review/re-packaging of a received package
remains available; it does not permit collection or edits to the collector's Git corpus.

## Starting in the wrong place: ask which project, do not hunt for it

For gate and corpus commands, the project is the **current working directory**; those
commands take no project argument. The desktop panel has its own `--project` selector:
confirm that effective project before running its diagnostics. If the cwd is not the
project the operator means - the kit's own repo, a
parent folder, an unrelated checkout - **ask which project**, and wait. Do not search the
filesystem, do not infer it from a name, do not look it up on a remote. Searching a
person's disk to guess his intent reads directories nobody authorised, and the question
it replaces takes one line.

Signals: no `AGENTS.md`, no `research/` directory, or a `research/` corpus plainly about
something else. An existing corpus about another topic is the signal doing its job.

## Resuming after an interruption: resume, do not restart

The gate is a pure function of repository state, so orient from disk before touching
anything. `doctor.mjs` and preflight answer *where this project is*; the last commit
report and `docs/ARCHITECTURE.md` say *what was happening and why*; `git status` answers
what is unfinished, and its uncommitted changes are the interrupted task - partial and
unverified, work in progress, never state to trust. The corpus is already collected and
spent credits are not spent again.

## Rule 1 - research first, then build

The sequence is decompose -> contract -> collect -> gate -> brief.

0. **Decompose** (collector machine): `node "{{KIT}}/bin/decompose.mjs"` - it maps the project's own topic from `research/plan.json`; pass `--topic "<topic>"` only while the project is untitled, since a different topic is refused -
   drafts `research/MAP.md` seeded with the universal checklist. The tool contains no
   judgment. Mark every row COVERED (citing U-## rows), DISMISSED (reason required), or
   GAP.
1. **Write the intent** in `research/DISCOVERY.md` under `## Build intent`, and enumerate
   the blocking unknowns FROM the map.
2. **Collect**: `node "{{KIT}}/bin/research.mjs" --plan research/plan.json`. Prefer the page
   that *owns* the fact over any write-up about it.
3. **Rewrite** each auto-extracted `Finding` cell into a real claim, keeping the `Raw`
   cell pointing at the cached page. Where a claim rests on one sentence, add it as
   `[quote: the sentence, copied from the capture]` - the gate checks it is really there.
4. **Gate**: `node "{{KIT}}/bin/preflight.mjs"`. **Do not start building until it prints
   PASS.** Evidence must be *fetched*, not typed, and by a named transport.
5. **Hand off**: write `research/BRIEF.md`.

Steps 0, 3 and 5 are the review, and **the review is your job** - classifying the map,
rewriting the findings and answering the brief's **TODO** sections are what make a corpus
approved research. Declare it in the brief with the line `Reviewed by: agent`; a package
carries it as `review.by`. There is no human review step.

There are exactly three overrides - `git commit --no-verify`, a deliberate
`research/GATE_OFF`, and a repository-local `core.hooksPath`. The last two are recorded in
`research/overrides.log`, a local log that is never committed; `--no-verify` records nothing,
because git does not run the hook it skips. If you take one, say so in your reply.

## Rule 2 - questions are for intent, never for facts

At most **3** questions, once, up front, and only about things no document can answer. If
a question's answer is in public documentation, it is a research task. **Never answer
"insufficient info" and stop.**

## Rule 3 - known unknowns are allowed, silence is not

Mark a genuinely unreachable fact `KNOWN-UNKNOWN` and write the day-one verification step
in the `Evidence` cell. An unlabeled gap is the failure mode this project exists to
prevent.

## Rule 4 - source quality

`P` primary/official carries the design. `S` secondary is context. `L` lead-only is a
hint, never proof. Never invent a citation. Flag contradictions instead of averaging them.

## Rule 5 - cost discipline

Firecrawl collection spends credits; chosen keyless pages still use the planned page
allowance and carry policy warnings. Plan queries in `research/plan.json` first, reuse the
cache (`--refresh-days`), and check the budget with `node "{{KIT}}/bin/research.mjs" --status`.

When the account runs out mid-run, the run stops and exits 2 with what is left (ADR-0129).
That decision is the operator's, not the agent's: report the balance and the uncollected
pages, and ask whether to top up or to finish on the free transports with `--fallback`.
Never pass `--fallback` on your own initiative.

## Rule 6 - secrets

The key lives in the CLI config or the environment. Never write it into this repository.

## The standing protocol

Five rules for how work here is committed and recorded. Documentation, not enforcement:
no check judges prose, because a gate that judges prose is a gate that will be wrong.

1. **Architecture map current in the same commit.** A commit touching a declared code
   path (`research/kit.json`) stages `docs/ARCHITECTURE.md` with it. Enforced - and a
   prompt, not a proof: the gate checks the map was *staged*, not that it is *current*.
2. **Commit report: five named parts** - what changed / why / what it touched / what you
   verified / what you got wrong and fixed. Each verification claim says **verified** (run,
   result seen), **untested** (written, not run) or **expected** (reasoned, not run), so a
   reader can tell evidence from belief. A mistake is reported in six fields - mistake,
   where, impact, cause, fix, verified - because what was wrong alone leaves the impact and
   the proof of the fix to be guessed. The got-wrong line is not optional; if nothing was
   gotten wrong it is written as "nothing to report". A commit that touches no declared
   code path (tests, docs, wording) may give the parts as one line each - what changed,
   why, verified, got wrong - and keeps the got-wrong line.
3. **An ADR for any design choice with a rejected alternative** - how the project behaves,
   what it stores or promises - dated, with the reason a future explorer would need to avoid
   re-suggesting it. Test mechanics, wording and a bug fix with one obvious remedy do not
   need one; the commit report's *why* names any alternative set aside.
4. **One commit per task - the revert test.** `git revert <sha>` undoes it alone.
5. **A red suite stops work**, reported immediately and alone, **with the cwd recorded**.
