# ADR-0148: The collector serves builder requests (auto-collect)

- **Date:** 2026-10-07
- **Status:** accepted
- **Area:** lifts the feature freeze (ADR-0117) for one item: **the collector serves builder
  requests**. That one item has three parts: the request file format
  `research/requests/<id>.json` and its result file `<id>.result.json`; the auto-collect
  mode of the desktop panel (`lib/auto-collect.mjs`, `lib/requests.mjs`); and its machine-local
  settings file `research-kit.autocollect.json`, beside the machine config. No command, flag,
  transport, provider or check is added. ADR-0010 (only the collector fetches), ADR-0056 (the
  topic is the project's), ADR-0110 (no fetch into this machine's network) and ADR-0129 (on
  exhaustion the run stops and the operator decides) stay in force.
- **Amends:** ADR-0147, decision 3 ("the panel never collects"): the panel still runs no
  collection on a command from the page. It runs one only for a builder's validated request,
  on a collector, within the caps the operator set.

## Context

The owner (2026-10-07) wants the builder - any AI agent or a person - to decide what to
research and have it collected without his typing commands: "collector listens to whatever
the builder asked". He asked for the kit's rules to stay as they are. The kit already let
the builder decide what is collected (the `fact-request` skill writes the request) and kept
only the fetching on the collector (ADR-0010). What it lacked was the collector acting on a
request without the operator copying it into `plan.json` and running `research.mjs` by
hand. Other agent research systems split the work the same way: a planner that writes the
questions and an executor that gathers the pages, with every source tracked. What they have
and the kit lacked is a request queue, a loop that runs it, and a budget cap. The owner
chose: run automatically within a daily cap; requests by git first, then the MCP tool, then
perhaps GitHub Actions.

## Decision

1. **A request is a file the builder pushes.** `research/requests/<id>.json` (the id is
   lower-case letters, digits and dashes) holds `fact` and `blocks` (both required, at most
   300 characters each), `urls` (the owner pages, http(s)), `queries` (to search when no page
   is known), and optionally `prefer`, `unknown` (an existing `U-n` row), `maxPages` and
   `topic`. Any other field is refused. This is the `fact-request` skill's request, made
   machine-readable. The builder writes only under `research/requests/`; the rest of
   `research/` stays the collector's.
2. **A request is untrusted input.** It arrives over git, so it is validated before anything
   acts on it: the fixed fields, bounded sizes, and no URL with a user name or password, and
   none naming this machine or an internal address (ADR-0110) - the collector must not be
   aimed at its own panel or a cloud metadata endpoint. A request asking for more pages than
   the per-request cap is **refused, not trimmed**, so the builder learns the limit. A refusal
   is written to `<id>.result.json` with every reason and pushed back.
3. **The collector listens.** In mode `auto` the panel's loop, on its interval (or on "Check
   now"), runs `git pull --ff-only`. For each request without a result it validates the
   request, writes its contract row (a new OPEN `U-n`, or the row it names) and its
   `plan.json` entries, and writes a plan for that run alone (`<id>.plan.json`, `maxScrapes`
   = the request's pages). It then runs the same `research.mjs --plan <that file>` and then
   `preflight.mjs`, writes the result, stages `research/` and the ledger by name
   (`git add -f research/raw/.fetches.jsonl`), commits and pushes. Preflight's verdict is
   recorded in the result, not acted on: closing the unknown follows the builder's review of
   the evidence (`Reviewed by: agent`, ADR-0107).
4. **The rules it keeps.**
   - It refuses to run unless the machine may collect (`collectionPolicy`). A builder never
     collects, whatever its settings say.
   - It never passes `--fallback`. When the credits run out, `research.mjs` stops (exit 2,
     ADR-0129). Auto-collect commits what was collected, leaves the request open, and
     **pauses**. Nothing runs until the operator presses Resume.
   - It spends at most the per-request cap and the daily cap; a request over today's cap
     waits, it is not refused.
   - It does not run while `research/` has uncommitted changes, because its commit takes
     everything under `research/`, and that would sweep the operator's unfinished review
     into it.
   - A request with a `topic` gets a new project (`new-project.mjs`, then `decompose.mjs
     --max-scrapes 0`, which searches but scrapes nothing). It goes in a dated folder under
     the one the operator approved in the panel (a path inside the repository), never over
     an existing project (ADR-0056). With no folder approved, topic requests are refused.
     *(Amended by ADR-0173: with no folder approved, a topic request waits, with the reason,
     and runs once the operator sets one.)*
5. **The modes are `off` and `auto`.** The owner chose automatic; "approve each request" was
   offered and declined. `off` is the default, so installing the kit starts nothing.

## Rejected alternatives

- **The builder runs `research.mjs` itself.** That breaks ADR-0010: the ledger is the proof
  only because one kind of machine writes it.
- **The builder edits `plan.json` and `DISCOVERY.md` directly.** Two writers of the
  contract, and a merge conflict on every request. The request file is the builder's; the
  collector turns it into rows.
- **Trim an over-budget request to the cap.** The builder would get less than it asked for
  without being told; refusing names the limit.
- **Switch to the free transports when the credits run out.** ADR-0129 makes that the
  operator's decision; an unattended loop deciding it is exactly what that ADR rejected.
- **An approve-each-request mode.** Offered; the owner chose automatic within a daily cap.
- **A request-queue service or database.** Git already carries the corpus between the two
  machines, so the requests travel the same way, and the history records them.

## Deferred, with triggers

- **The MCP tool `request_facts`** (the owner's option b), which writes the same file for a
  builder speaking MCP. The trigger: (a) is in use. The tool must write the file and fetch
  nothing.
- **Running requests on GitHub Actions** (option c), so the collector need not be switched
  on. The trigger: the owner asks for it. The hosted collector, `collect.yml`, already exists (ADR-0042), so
  this would be a workflow that reads `research/requests/`.

## Expires when

The owner decides on 1.0, or option b or c is built - each gets its own ADR.
