# Research-Kit

[![offline suite](https://github.com/StepenkoAnatoli/Research-Kit/actions/workflows/offline-suite.yml/badge.svg)](https://github.com/StepenkoAnatoli/Research-Kit/actions/workflows/offline-suite.yml)

**Research first, build second.** Research-Kit gives AI agents a workflow for collecting
sources, declaring blocking unknowns, and handing traceable research artifacts to a builder.
It keeps cached pages and a tamper-evident fetch record. With the commit hook operating
and no override in effect, a gated project's commit is blocked while preflight fails if
it stages paths outside `research/` and the permitted project scaffolding.

It exists for the facts an agent would otherwise guess: API limits, pricing, what a licence
permits, whether a platform can do the thing the design depends on. Plain Node, no
dependencies, no `package.json`. Everything except the collection itself runs offline.

**What PASS means.** The configured checks passed for the declared research contract.
The agent also writes the contract and unknowns list: an omitted blocking question is
not checked, and a contract with a trivially easy unknown can pass. PASS does not prove
that the unknowns cover the intended build or that the claims are true.
A pass can retain disclosed known unknowns and warnings. Generated briefs, audits and
package reading guides preserve those warnings and their reasons. The gate checks
provenance and research structure; an agent still has to check whether a source supports
a claim and whether an implementation behaves correctly. No controlled evaluation has
yet measured how much this kit reduces mistakes in research, code or writing.

For daily research, coding and writing, see the optional
[Work with evidence](docs/WORK-WITH-EVIDENCE.md) guide.

**In a hurry?** [`QUICKSTART.md`](QUICKSTART.md) is the two-minute setup: the agent collects
through GitHub with one token, and you only read the brief.

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Try it in five minutes](#try-it-in-five-minutes)
- [Run it on a real project](#run-it-on-a-real-project)
- [Working with an AI agent](#working-with-an-ai-agent)
- [Hand the research to a builder](#hand-the-research-to-a-builder)
- [Keys and cost](#keys-and-cost)
- [Run the collector on GitHub](#run-the-collector-on-github)
- [Command reference](#command-reference)
- [Machine configuration](#machine-configuration)
- [Troubleshooting](#troubleshooting)
- [Supported platforms](#supported-platforms)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [License](#license)

## How it works

One loop, run inside the project folder:

```
 topic ──► decompose ──► contract ──► collect ──► gate ──► brief ──► build
           (the map)    (unknowns)   (pages +    (PASS or  (handoff)  (phase 2)
                                      ledger)     FAIL)
```

| Step | Command | Who does it | What it leaves behind |
|---|---|---|---|
| Decompose | `decompose.mjs` | the agent | `research/MAP.md`: the topic split into subtopics, statuses blank |
| Contract | by hand | the agent | `research/DISCOVERY.md`: the blocking unknowns, `U-1`, `U-2`, ... |
| Plan | by hand | the agent | `research/plan.json`: the searches and pages that close them |
| Collect | `research.mjs` | the kit | cached pages under `research/raw/`, each with the text it was converted from beside it, rows in `research/EVIDENCE.md`, a hash-chained ledger |
| Review | by hand | the agent | every finding rewritten into a claim, with a quote from the page |
| Gate | `preflight.mjs` | the kit | `PASS`, or the name of the unknown that is still unproven |
| Brief | `brief.mjs` | the agent | `research/BRIEF.md`: the one file a builder has to read |

Two ideas carry the whole design:

- **Evidence is fetched, never typed.** Every cited page is on disk, and the ledger
  (`research/raw/.fetches.jsonl`) records its hash and the transport that fetched it. A
  hand-written capture, or a page edited after the fact, fails the gate.
- **The gate has executable hooks.** In gated projects, the operating commit hook blocks
  staged changes outside `research/` and permitted project scaffolding while preflight
  fails, unless overridden. It classifies paths, not whether their contents are product
  code. Claude Code also has an edit hook: its default `ask` mode requests permission
  for gated edits; `hard-block` denies them.

The work splits into **two phases**, usually done by different agents. Phase 1 is research:
it ends with a passing gate and a brief, and never writes product code. Phase 2 is the
build: a builder reads the brief and implements, and should never need to re-research.

**The gate stops forgetful agents, not adversarial ones.** It is a workflow check, not a
security boundary. The edit hook matches `Edit|Write|MultiEdit|NotebookEdit`; shell writes
such as `>`, `sed -i` and `tee` do not reach it. For those writes, the commit hook is the
backstop when it runs. Its default `failOpen: true` permits a commit when the gate cannot
run or fails internally; an ordinary failing research verdict still blocks the commit.
The active edit hook denies creating `research/GATE_OFF`, like edits into `research/raw/`,
but an agent with shell or configuration access can still create an override or bypass a
hook. The existing `editGate.mode=off` and present `GATE_OFF` overrides remain deliberate
operator controls.

**What the gate does not stop, so you know where to look.** Three overrides exist. `git commit
--no-verify` skips the hook, and a hook git did not run cannot record anything, so that one
leaves no trace beyond the commit itself. The other two are recorded in a local log that
`doctor` counts: a `research/GATE_OFF` file, and a repository-local `core.hooksPath`, which tools such as
husky set and which displaces the machine-wide hook in that repository: `install-hooks.mjs`
reports it when run inside such a repository, and `doctor` reports and records it. The gate's
default posture is fail-open: a broken installation lets a commit through with one line
on stderr rather than locking you out, and `install-hooks.mjs --fail-closed` inverts that.
The ledger is self-attested: it proves nobody edited a capture by accident, and a chain
recomputed consistently by someone with write access passes, which is why CI runs
preflight on every commit and a forged chain has to survive review. The edit-time gate
exists for Claude Code only; every other agent gets the commit gate.

## Requirements

| | Needed for | Notes |
|---|---|---|
| Node 22+ | everything | Node 22, 24 and 26 are each tested on every commit |
| Git | everything | projects are git repositories; the commit gate is a git hook |
| Python 3.11+ | the test suite only | the cross-language conformance runners; without it the suite blocks rather than passing |
| Firecrawl CLI 1.25.3 and a Firecrawl account | metered collection | `npm install -g firecrawl-cli@1.25.3`, then `firecrawl login`. Free tier: 1,000 credits a month, no card |
| Chromium or Chrome | the `browser` transport | free; reads pages built by JavaScript |
| SerpAPI key or a SearXNG instance | searching, optional | a second meter, so search stops competing with fetching |

Nothing is required beyond Node and Git to run the kit with the free keyless transport.

## Install

**1. Clone and deploy.** The kit is copied to `~/.agents/research-kit` once, and every
project on the machine runs it from there.

```bash
git clone https://github.com/StepenkoAnatoli/Research-Kit.git
cd Research-Kit
node research-kit/bin/install.mjs
node research-kit/bin/install-hooks.mjs
node research-kit/bin/doctor.mjs
```

`doctor` must end with `READY`. Anything else names the problem and prints its fix. Run it,
fix what it says, run it again.

**2. Choose the transport.** With a Firecrawl login, nothing more to do. Without one, tell
the machine to use the free route, and `doctor` stops asking for a key:

```json
{ "transport": "http-keyless" }
```

That file is `~/.agents/research-kit.config.json`. The other keys it takes are under
[Machine configuration](#machine-configuration).

**What the install touches**

| Path | What it is |
|---|---|
| `~/.agents/research-kit/` | the deployed kit; `install.mjs` overwrites it on every run |
| `~/.agents/research-kit.config.json` | this machine's settings: transport, role, evidence policy |
| `~/.claude/skills/` | `research-first` and the shipped skill set, including `skill-router`, as siblings |
| `~/.claude/settings.json` | the edit-time gate, a Claude Code hook |
| git `core.hooksPath` | the commit gate, machine-wide, every agent and every human |

Pass `--into <project>` to `install.mjs` to also bind `research-first` and the skill set into
that project's skill directory.

**Update.** Pull and deploy again. `doctor` reports when the deployed copy no longer
matches the checkout, and its last line names the version this machine runs (`kit 0.9.5`).
Each release is tagged `v<version>` and has its entry in [`CHANGELOG.md`](CHANGELOG.md).

```bash
git pull origin main
node research-kit/bin/install.mjs
```

**Uninstall.** `node research-kit/bin/install-hooks.mjs --uninstall` restores the hooks
and the git setting; the folder under `~/.agents` can then be deleted.

**Windows.** The commands in this file work in PowerShell and Git Bash as written, with
`$HOME` expanding to `C:\Users\<you>`. In `cmd.exe` write `%USERPROFILE%` instead. Windows
PowerShell 5.1 does not accept `&&` between commands: run them one per line.

## Try it in five minutes

No account, no key. This runs the whole loop once: collect one page, say what it proves,
and get a verdict from the gate.

```bash
mkdir try-it
cd try-it
git init -q
node "$HOME/.agents/research-kit/bin/new-project.mjs" . --topic "Is fetch a global in Node.js?"
```

**Name the page to read.** Open `research/plan.json` and set its `urls`:

```json
"urls": [{ "url": "https://nodejs.org/api/globals.html", "type": "P", "why": "U-01" }]
```

**Collect it.** This writes the page under `research/raw/`, a row `E-01` in
`research/EVIDENCE.md`, and an entry in the ledger that proves it was fetched.

```bash
node "$HOME/.agents/research-kit/bin/research.mjs" --transport http-keyless
```

**Ask the gate.**

```bash
node "$HOME/.agents/research-kit/bin/preflight.mjs"
```

It prints `FAIL` with `discovery-contract/no-unknowns`: the contract does not yet say what
you need to know. Add one row under the table in `research/DISCOVERY.md`:

```
| U-01 | Is `fetch` a global in Node.js? | Decides whether the code needs a dependency | CLOSED | E-01 |
```

Run `preflight` again. It prints `PASS`, with three honest warnings: the page came through
the keyless transport, there is no subtopic map yet, and one source carries the claim.

That is the whole loop. Decide what you need to know, fetch the page that owns it, and let
the gate check that the claim points at a real capture.

## Run it on a real project

A project is its own folder, and it is the **current working directory**. The kit takes no
project argument. `cd` into the project first, every time.

**1. Scaffold.** From inside the project folder (a git repository):

```bash
node "$HOME/.agents/research-kit/bin/new-project.mjs" . --topic "<what is being researched>"
```

This writes `AGENTS.md` (the rules every agent follows here), `START_HERE.md` (notes for
you), `research/` with the contract, plan and evidence files, and `docs/ARCHITECTURE.md`.
If the project will be read on another machine, add `--kit '$HOME/.agents/research-kit'`
so its files spell the kit's location portably, single-quoted so your shell leaves it alone.

**2. Decompose the topic.** The map is seeded with nine universal dimensions: access model,
auth, rate limits, terms and legality, schema stability, freshness, cost at volume, runtime
limits, and whether the output can be obtained at all.

```bash
node "$HOME/.agents/research-kit/bin/decompose.mjs"
```

Then open `research/MAP.md` and mark every row `COVERED` (naming the unknowns that cover
it), `DISMISSED` (with a reason) or `GAP`. This judgement is the one step the kit never
automates.

**3. Write the contract and the plan.** In `research/DISCOVERY.md`, state the build intent
and list the blocking unknowns, each tracing back to a map row. In `research/plan.json`,
list the searches and pages that close them. Prefer the page that owns the fact: official
docs, the repository, the pricing page, the statute.

```json
{
  "topic": "<what is being researched>",
  "queries": [{ "q": "<what to search for>", "why": "U-1", "prefer": ["<the domain that owns the fact>"] }],
  "urls": [{ "url": "https://<a page you already know>", "why": "U-1", "type": "P" }]
}
```

**4. Collect.** The only step that spends credits. Preview first.

```bash
node "$HOME/.agents/research-kit/bin/research.mjs" --dry-run
node "$HOME/.agents/research-kit/bin/research.mjs"
```

A page already in the cache is never fetched twice, so re-running a finished project costs
nothing. `--status` shows the budget and what the corpus holds.

**5. Review the findings.** Rewrite each auto-extracted `Finding` cell in
`research/EVIDENCE.md` into the claim the page supports. Where a claim rests on one
sentence, add `[quote: the sentence]`, copied word for word; the gate checks the sentence
is really in the capture. A fact that is genuinely unreachable gets the status
`KNOWN-UNKNOWN` and a day-one verification step, never silence.

**6. Ask the gate.**

```bash
node "$HOME/.agents/research-kit/bin/preflight.mjs"
```

`PASS` means the configured checks passed for the declared research contract. Read any
remaining warnings and known unknowns. A failure names the blocking findings and a
remedy. Do not build before `PASS`.

**7. Write the brief and commit.**

```bash
node "$HOME/.agents/research-kit/bin/brief.mjs"
git add research/
git add -f research/raw/.fetches.jsonl
git commit -m "research: <topic>"
```

`research/BRIEF.md` is the handoff: intent, verified claims with sources, contradictions
and how they were resolved, known unknowns with their verification steps, and the first
build step. The ledger is added by name because it is a dotfile, and a dotfile rule can
hide it; it is evidence, not a byproduct.

**Cost.** About one Firecrawl credit per page and two per search. Decompose runs four
searches. A project of twenty pages costs roughly thirty credits; the free tier is 1,000 a
month and stops at zero rather than billing.

## Working with an AI agent

The kit is agent-agnostic. What an agent needs is in the project: `AGENTS.md` carries the
rules and the sequence, the commands are plain `node` invocations, and the commit gate is
a git hook that applies to every tool alike. The differences between agents are only in
how each one finds `AGENTS.md`, and whether it gets the edit-time gate.

### Claude Code

Nothing to configure. The install puts the `research-first` skill under
`~/.claude/skills`, so Claude Code starts the protocol on its own when a task depends on
external facts, reads `AGENTS.md` in the project, and is interrupted by the edit-time gate
if it tries to write product code while the gate fails. Open the project folder and ask:

> Research this before we design anything: `<the question>`. Follow AGENTS.md. Ask me at
> most three questions about intent, fetch every fact, and stop at a passing preflight and
> a written brief. Do not write product code.

### Gemini CLI

Gemini CLI reads `GEMINI.md`, not `AGENTS.md`, so tell it where the rules are. Either is
enough:

- **Point Gemini at `AGENTS.md`.** In the project's `.gemini/settings.json` (or in
  `~/.gemini/settings.json` for every project on the machine):

  ```json
  { "context": { "fileName": ["AGENTS.md", "GEMINI.md"] } }
  ```

- **Or leave a pointer.** A one-line `GEMINI.md` in the project folder:

  ```
  Read AGENTS.md in this folder and follow it exactly.
  ```

Then install the kit on that machine as in [Install](#install). The commit gate works for
Gemini as it does for everyone. The edit-time gate is a Claude Code hook and does not
apply, and there is no skill to trigger the protocol, so say it in the prompt:

> Read AGENTS.md. Run phase 1 of the research-first protocol for the topic in
> `research/plan.json`: decompose, classify the map, write the contract and the plan,
> collect, rewrite every finding with a quote, pass preflight, write the brief. Ask me at
> most three questions about intent first. Do not write product code.

If the machine should only build from a corpus someone else collected, declare it a
builder, and collection refuses there by design:

```bash
node "$HOME/.agents/research-kit/bin/install-hooks.mjs" --role builder
```

### Codex, Cursor and others

Codex reads `AGENTS.md` natively. For a tool that reads a differently named file
(`CLAUDE.md`, `.cursorrules`, a custom instructions setting), the one-line pointer above
works everywhere: a file in its name that says to read `AGENTS.md` and follow it.

### Example: a research project inside MoonAliza

MoonAliza keeps its research under `docs/research/<date>-<topic>/`, one project per
question, each with its own `AGENTS.md` and corpus. To research a new question there with
Gemini:

```bash
cd MoonAliza
node "$HOME/.agents/research-kit/bin/new-project.mjs" docs/research/2026-10-03-payment-provider --topic "Which payment provider fits MoonAliza's checkout" --kit '$HOME/.agents/research-kit'
cd docs/research/2026-10-03-payment-provider
gemini
```

Give it the Gemini prompt above. When it reports a passing preflight and a brief, read
`research/BRIEF.md`, then commit the project including the ledger:

```bash
git add docs/research/2026-10-03-payment-provider
git add -f docs/research/2026-10-03-payment-provider/research/raw/.fetches.jsonl
git commit -m "research: payment provider"
```

The project folder is the working directory for every kit command, so `cd` into it before
running `doctor`, `preflight` or `research`. From MoonAliza's root they would describe the
root, which has no corpus.

### Give an agent the GitHub collector as a tool

If collection runs on GitHub ([below](#run-the-collector-on-github)), an agent that speaks
the Model Context Protocol can have it as a tool. Claude Code reads this from `.mcp.json`
in the project; Gemini CLI from `mcpServers` in `~/.gemini/settings.json`.

```json
{
  "mcpServers": {
    "research-kit": {
      "command": "node",
      "args": ["/home/you/.agents/research-kit/bin/mcp-server.mjs"],
      "env": { "RESEARCH_KIT_GITHUB_TOKEN": "github_pat_..." }
    }
  }
}
```

Write the absolute path of the deployed kit: `~/.agents/research-kit` on Linux and macOS,
`C:\\Users\\you\\.agents\\research-kit` inside JSON on Windows. MCP clients do not expand
`~` or `$HOME` in `args`. Two tools: `collect` starts a run and returns its id,
`fetch_corpus` returns a link to the validated package. The token is described in the
GitHub section.

**What every agent must do with a result:** read `buildAuthorized` and stop if it is
`false`. It is `false` for every freshly collected corpus, because nobody has reviewed it
yet. Exit 0 means the package is intact, never that building may start.

## Hand the research to a builder

The kit runs on two kinds of machine, and each one declares which it is (`role` in the
machine config, default `collector`).

| | **collector** (your PC) | **builder** (a sandbox, a CI box, another agent's machine) |
|---|---|---|
| holds | the Firecrawl key when using that route; none for a chosen keyless route | no collection key required |
| runs | `decompose.mjs`, `research.mjs` | `handoff.mjs`, `preflight.mjs`, then the build |
| `doctor` says | absent Firecrawl CLI/auth fails for an unchosen or Firecrawl route; a chosen keyless route passes those findings (ADR-0095) | absent Firecrawl CLI/auth is expected |
| must | push `research/` including the ledger | not collect; `research.mjs` and `decompose.mjs` refuse there |

The corpus travels through git. The builder's first command, inside the project:

```bash
node "$HOME/.agents/research-kit/bin/handoff.mjs"
```

It checks that the ledger is present, that `research/EVIDENCE.md` is there with its table,
that every capture a row cites is on disk, and that the chain verifies. Exit 1 names what is
missing and which machine the fix lives on: something did not travel (the collector pushes
`research/raw/.fetches.jsonl` by name), or the checkout rewrote line endings (fix it on the
builder with `.gitattributes`: `research/raw/* text eol=lf`). The scaffold ships that
`.gitattributes`.

A builder who finds a fact missing reports which one and lets the collector fetch it. A
page fetched by hand is not evidence in this kit.

An intact handoff and PASS are necessary, but do not by themselves finish review. Check
the classified MAP, rewritten Findings, and an authored brief with both judged sections
answered and current stamped inputs; authored unstamped briefs retain ADR-0138's
compatibility path with currency unknown. Approval is derived from that work on either
machine, never from a builder-role predicate.

A Git request result marked `collected` means captures were delivered. The builder
reads and judges them; the collector records their Findings, unknown closures, map and
brief. Send review-only gaps back in prose instead of paying for another fetch. Local
review and re-packaging of a received package still follows ADR-0052 (ADR-0150).

## Keys and cost

**No credentials ship with this repository, and none ever will.** The kit reads a key from
the environment or from `~/.agents/research-kit.config.json`, never from a project, and
`doctor` scans every project it runs in for a committed key.

**Transports**

| Transport | Cost | What it gives |
|---|---|---|
| `firecrawl-cli` (default when logged in) | about 1 credit a page, 2 a search | the fullest capture; the gate's preferred evidence |
| `http-keyless` | free | a direct fetch; captures are graded `partial` when the page needed a browser |
| `browser` | free | a local Chromium renders the page; reads JavaScript-built pages and pages that refuse plain clients |

A Firecrawl scrape is always a live fetch: the kit passes `--max-age 0`, because the vendor
otherwise answers from a copy up to two days old, and a capture stamped with today's date
could be yesterday's page. The credit is the same either way
([ADR-0139](docs/adr/0139-a-firecrawl-scrape-is-a-live-fetch-and-a-cached-answer-says-so.md)).
Every transport also returns the text it converted the page from, and the kit keeps it beside
the capture as `<capture>.source.html`, named and hashed in the same ledger entry, so a
conversion can be checked or redone later
([ADR-0140](docs/adr/0140-the-pages-source-text-is-kept-beside-the-capture.md)).

Pick one per run with `--transport`, or per machine with `transport` in the config. When
Firecrawl's credits run out mid-run, the run stops and says what is left, and you decide:
top up and run the same command, which pays only for the pages still missing, or run it
with `--fallback`, which fetches them through `browser` where one is installed, else
`http-keyless`. The GitHub collector passes `--fallback` on its own, since nobody is there
to decide. Each capture's ledger entry names the transport that fetched it.

**Search providers**

| Provider | Cost | How to enable |
|---|---|---|
| Firecrawl (default) | 2 credits a search | the same login |
| SerpAPI | 250 free searches a month | `SERPAPI_API_KEY` in the environment, or `serpapiKey` in the config |
| SearXNG | free, an instance you run | `SEARXNG_URL`, or `searxngUrl` in the config, then `--search-transport searxng` |

A search sends the query text to the provider. SerpAPI retains it for 31 days. Tavily was
evaluated and deliberately not wired in, because its terms allow retention for training.

**Firecrawl setup**

```bash
npm install -g firecrawl-cli@1.25.3
firecrawl login
```

The package is `firecrawl-cli`; `firecrawl` is a different one. Never run `firecrawl env`
inside a repository: it writes the key into `.env`.

**What the gate accepts** is set by `evidencePolicy` in the config. `pluralist`, the
default, passes a keyless capture with a warning. `strict` fails any cited capture not
fetched by the metered CLI; `preflight --strict` applies it to one run.

**A witness, opt-in.** `research --witness` asks the Wayback Machine for its snapshot of
each newly collected page and records the answer. It sends each URL to the Internet
Archive, so it is off by default.

## Run the collector on GitHub

Optional. The same collector runs as a GitHub Actions workflow in your fork, from the
website, for a person who installs nothing.

1. **Fork** this repository, open the fork's **Actions** tab, and enable workflows.
2. **Get a Firecrawl key** at [firecrawl.dev](https://www.firecrawl.dev).
3. **Put the key where only the collector can read it.** In the fork: **Settings** →
   **Environments** → **New environment** named `research-collection`. Add the secret
   `FIRECRAWL_API_KEY` and the variable `RESEARCH_KIT_COLLECTION_ENV` with the value
   `research-collection`. Both are needed: the variable proves the environment exists,
   because GitHub silently creates an unprotected one when a workflow names a missing name.
   Do not put the key under repository secrets, where every workflow can read it; the
   collector refuses to run if it finds it there.
4. **Run a collection.** **Actions** → **collect** → **Run workflow**. Type the topic and
   start small: `max_pages: 1` and `depth: probe` costs about three credits. Download the
   ZIP under **Artifacts** when it finishes.
5. **Read `README-FIRST.md`** in the ZIP. It says the corpus is collected and the review is
   required. That is the correct result: the three review steps remain, and the agent does
   them. `manifest.json` says `"buildAuthorized": false` until then.

**Letting an agent run it.** It needs one token that can do one thing. Create a
fine-grained personal access token at
[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
with repository access limited to the fork and the single permission **Actions: Read and
write**. It can then start a collection and read the result, and nothing else. Set it in
the environment, never on a command line:

```bash
export RESEARCH_KIT_GITHUB_TOKEN=github_pat_...
node "$HOME/.agents/research-kit/bin/collect-remote.mjs" --repository OWNER/REPO --topic "<topic>" --max-pages 5 --json
```

| Exit | Meaning |
|---|---|
| 0 | collected and valid; still does not authorize building |
| 1 | the package is invalid |
| 2 | the run failed, or the package is incomplete |
| 3 | could not start: no token, bad repository, or no permission |
| 4 | still running when the wait ran out; `--run-id <n>` picks it up again |

**Privacy.** The topic never appears in a run name or an artifact name. It does appear in
the job log, which anyone signed in to GitHub can read on a public repository. To research
something you would not publish, use a private repository or collect locally. The details,
measured rather than assumed, are in the
[kit reference](research-kit/README.md#collecting-from-github-actions).

## Command reference

Every command runs from inside the project folder. The main ones:

| Command | What it does |
|---|---|
| `doctor.mjs` | machine, project, gate and chain health in one report, with the fix for each problem |
| `new-project.mjs <dir> --topic "..."` | scaffold a project (`--kit` to spell the kit path portably) |
| `decompose.mjs` | draft the subtopic map, seeded with the universal checklist (`--dry-run` spends nothing) |
| `research.mjs` | collect the plan (`--dry-run`, `--status`, `--depth`, `--refresh-days`, `--force`, `--transport`, `--search-transport`, `--fallback`, `--witness`) |
| `preflight.mjs` | the gate (`--checks`, `--check <name>`, `--strict`, `--json`) |
| `brief.mjs` | write the handoff brief |
| `handoff.mjs` | on a builder: did the corpus arrive whole? |
| `audit.mjs` | one pasteable snapshot of a passing corpus (`--zip`) |
| `evidence-context.mjs --unknown U-5` | what one unknown rests on |
| `measure.mjs` | how the citations hold up, as a report |
| `export-warc.mjs` | the captures as one WARC file for archive tools |
| `collect-remote.mjs` | run the collector on GitHub and bring the result back |
| `mcp-server.mjs` | the collector as an MCP server over stdio |
| `install.mjs` | deploy the kit (`--dry-run`, `--into <project>` to bind skills into a project) |
| `install-hooks.mjs` | install the gates and declare the machine's role |
| `selftest.mjs` | the whole suite, offline |

The full table, including the release-evidence validators and the artifact format, is in
[`research-kit/README.md`](research-kit/README.md#every-command).

**Reading a verdict.** Every validating command maps its status to an exit code.

| Status | Exit | Means |
|---|---:|---|
| `PASS` | 0 | the command's checked conditions passed |
| `FAIL` / `REOPEN` | 1 | one or more checked conditions failed |
| `INCOMPLETE` | 2 | could not be checked, which is not the same as wrong |
| `BLOCKED` | 3 | refused to start |

## Machine configuration

`~/.agents/research-kit.config.json`, read by every command. Every key is optional.

| Key | Values | Default | What it decides |
|---|---|---|---|
| `role` | `collector`, `builder` | `collector` | whether this machine may collect; set it with `install-hooks.mjs --role` |
| `transport` | `firecrawl-cli`, `http-keyless`, `browser` | probed | how pages are fetched |
| `searchTransport` | `firecrawl-cli`, `http-keyless`, `serpapi`, `searxng` | the fetch transport | how searches run |
| `evidencePolicy` | `pluralist`, `strict` | `pluralist` | whether a keyless or partial capture passes the gate with a warning or fails it |
| `serpapiKey` | a key | none | SerpAPI search; the environment variable `SERPAPI_API_KEY` works too |
| `searxngUrl` | a URL | none | a SearXNG instance for search |
| `failOpen` | `true`, `false` | `true` | what the gate does when it cannot run at all |
| `editGate.mode` | `ask`, `hard-block`, `off` | `ask` | the Claude Code edit-time gate; `install-hooks.mjs --mode` sets it |
| `editGate.settingsPath` | a path | `~/.claude/settings.json` | where the edit-time gate is registered |
| `skillRoots` | a list of paths | `~/.claude/skills` | where the skill is installed |

Environment variables take precedence where one exists: `RESEARCH_KIT_TRANSPORT`,
`SERPAPI_API_KEY`, `SEARXNG_URL`, `RESEARCH_KIT_HOME` (where the kit is deployed).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `doctor` reports problems about files or a corpus you do not recognise | it describes the folder it runs in, and that folder is not the project | `cd` into the project, run it again |
| `Cannot find module '...\research-kit\bin\...'` | a relative path from the wrong folder | use the full path: `node "$HOME/.agents/research-kit/bin/doctor.mjs"` |
| `fatal: not a git repository` | the project folder is not a repository, or the prompt is outside it | `git init` the project, `cd` into it |
| PowerShell: `The token '&&' is not a valid statement separator` | Windows PowerShell 5.1 has no `&&` | one command per line |
| `preflight` fails with `discovery-contract/no-unknowns` | the contract lists no unknowns yet | add `U-` rows to `research/DISCOVERY.md` |
| `research.mjs` refuses the plan | `research/plan.json` has neither queries nor urls | fill it in; the shape is under [Run it on a real project](#run-it-on-a-real-project) |
| `preflight` or `handoff` fails with `ledger-missing` | `research/raw/.fetches.jsonl` did not travel; zip and sync tools drop dotfiles | on the collector: `git add -f research/raw/.fetches.jsonl` and push |
| the run stops with `credits ran out` and exits 2 | the Firecrawl account is empty | top up and run the same command, or run it with `--fallback` to finish on the free transports; `research --status` shows the budget |
| `research.mjs` or `decompose.mjs` exits 2 with "builder" | this machine is declared a builder | collect on the collector, or `install-hooks.mjs --role collector` |
| tests print `UNSUP PYTHON-NOT-FOUND` and block | no Python 3.11+ | install it; a green suite without it would claim two languages agree while testing one |
| Windows: `git add` refuses with a long-path error | `MAX_PATH` | `git config core.longpaths true` |
| the commit gate blocks with "is not staged with them" | in this repository, a declared code path changed without `docs/ARCHITECTURE.md` | update the map in the same commit |

## Supported platforms

**Linux and Windows are supported. macOS is best-effort and untested.** "Supported" means
one thing: the full offline suite runs on that platform in CI on every commit
([`offline-suite.yml`](.github/workflows/offline-suite.yml)). Until GitHub's
`ubuntu-latest` finishes moving to Ubuntu 26.04 (2026-11-19), Linux is checked on both
images, 24.04 and 26.04
([ADR-0043](docs/adr/0043-the-suite-runs-on-ubuntu-26-04-through-the-migration.md)).

| | Linux | Windows | macOS |
|---|---|---|---|
| full suite on every commit | yes | yes | no |
| platform behaviour asserted | executable hook bit | LF checkout, `.cmd` argument guard | none |

macOS is excluded on purpose
([ADR-0101](docs/adr/0101-macos-is-best-effort-and-has-no-ci-leg.md)): a CI leg nobody
intends to fix teaches people to ignore red. Requirements: Node 22+ and Git, with Python
3.11+ for the conformance runners in the test suite. Behind an HTTPS proxy, the kit's own
requests need Node 22.21+ or 24+; `doctor` says so when yours cannot.

## Repository layout

```
research-kit/            the kit: what install.mjs deploys
  bin/                   every command
  lib/                   the modules behind them
  hooks/, githooks/      the edit-time gate and the commit gate
  skill/                 the research-first skill for Claude Code
  skills/                the role-aware router and the shipped skill set
  template/              what new-project.mjs writes into a project
  recipes/               domain dimensions decompose.mjs adds with --recipe
  schemas/               the JSON schemas of the portable artifact
  conformance/           the cross-language test vectors
  examples/              worked release-evidence packages, passing and failing
  test/                  the offline suite
  README.md              the reference: every command, the artifact format, the transports
  START_HERE.md          the operator page a deployed kit carries
research/                this repository's own corpus (it is gated by its own kit)
docs/
  README.md              the reading map: which document to read for what
  ARCHITECTURE.md        what each module owns, kept current with the code
  adr/                   every design decision, with what it rejected
  decisions/             nested research projects about the kit itself, with their corpora
  measurements/          dated measurements of the kit on real runs
  architecture-history/  what the architecture map used to say, and when it changed
  review-*.md and other dated files: past reviews, audits and build reports
AGENTS.md                the rules every agent follows in this repository
CONTEXT.md               the domain vocabulary
CHANGELOG.md             what changed in each release
QUICKSTART.md            the GitHub route with one token
START_HERE.md            the operator page, as a scaffolded project receives it
LICENSE, LICENSES/, NOTICE, REUSE.toml   the licence of the code, and the one the captured pages are under
BUNDLE_INDEX.md, RESEARCH_REPORT.md      the archive this repository was received as, frozen (ADR-0028)
```

## Documentation

- [`QUICKSTART.md`](QUICKSTART.md): the two-minute setup through the MCP server, where the
  agent collects on GitHub and you hand over one token.
- [`docs/README.md`](docs/README.md): the reading map, which document to read for what,
  and in what order.
- [`research-kit/README.md`](research-kit/README.md): the reference for every command,
  the portable artifact, the GitHub collector, and the test suite.
- [`AGENTS.md`](AGENTS.md): the rules an agent follows, and the standing protocol for
  changes to the kit.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): what each module owns.
- [`docs/adr/`](docs/adr/README.md): why things are the way they are, including what was
  rejected.
- [`docs/decisions/`](docs/decisions/README.md): the research behind each decision about
  the kit itself, one nested project per question, each with its own passing gate.
- [`docs/review-2026-10-04-gap-audit.md`](docs/review-2026-10-04-gap-audit.md): the latest
  audit of the kit against comparable tools, and what it changed; the earlier one is
  [`docs/review-2026-10-03-gap-audit.md`](docs/review-2026-10-03-gap-audit.md).
- [`CHANGELOG.md`](CHANGELOG.md): release notes. The kit is feature-frozen since 0.9.0;
  it takes bug fixes, documentation, tests and vendor updates.

## License

The code, tests and documentation are licensed under the
[PolyForm Shield License 1.0.0](LICENSE): you may install, run, modify and distribute the
kit for any purpose, commercial use included, except providing a product that competes
with it. Keep the required notice line with any copy. The reasoning, and the alternatives
weighed, are in [ADR-0130](docs/adr/0130-the-kit-is-licensed-under-polyform-shield-and-its-captures-are-not.md)
and the decision project behind it.

The web pages cached under every `research/raw/` directory are **not** covered by that
licence. They are other people's pages, reproduced as research evidence so that every
claim can be checked against the page it rests on. Copyright stays with their owners, this
repository grants no licence over them, and [`NOTICE`](NOTICE) says which hosts' own
licences permit redistribution with attribution. `REUSE.toml` marks those paths.
