# Two-minute setup: the agent collects, you only hand over a token

This is the shortest path. The agent does the research. GitHub does the fetching, with
your Firecrawl key kept there. You set up once, in three steps, and after that the only
thing you type is the question.

```
you: "research X"  ──►  agent calls collect  ──►  GitHub runs the collector  ──►  agent calls fetch_corpus
                                                                                         │
            brief for you  ◄──  agent reviews, and collects again if a fact is missing  ◄──┘
```

The full guide is [`README.md`](README.md). Nothing here replaces it; this page is the
subset you need to get the first result back.

## One time, by you

**1. Put the kit on the machine where the agent runs** (one minute). The MCP server is a
file inside the deployed kit, so the agent needs the kit on its own machine, even though
the collection runs on GitHub.

```bash
git clone https://github.com/StepenkoAnatoli/Research-Kit.git
node Research-Kit/research-kit/bin/install.mjs
```

**2. Give the agent one token** (one minute). Create a fine-grained personal access token at
[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
repository access limited to the repository that holds the collector, and the single
permission **Actions: Read and write**. Nothing else. With that it can start a collection
and read the result, and it cannot read your code or your secrets.

Paste it into the agent's own settings file, the one place it lives. Never into a
repository, never on a command line.

Claude Code: a file named `.mcp.json` in the folder you open Claude Code in.
Gemini CLI: `~/.gemini/settings.json`.
The block is the same in both:

```json
{
  "mcpServers": {
    "research-kit": {
      "command": "node",
      "args": ["/home/you/.agents/research-kit/bin/mcp-server.mjs"],
      "env": { "RESEARCH_KIT_GITHUB_TOKEN": "github_pat_...your token..." }
    }
  }
}
```

Replace the path with the deployed kit on this machine: `~/.agents/research-kit` on Linux
and macOS; on Windows, written inside JSON, `C:\\Users\\you\\.agents\\research-kit`. MCP
clients do not expand `~` or `$HOME`.

**3. The Firecrawl key lives in the repository that runs the collector, not with the
agent.** If that repository is this one, and you own it, this is already done. For your
own fork, it is three clicks, once: **Settings → Environments → New environment** named
`research-collection`, with the secret `FIRECRAWL_API_KEY` and the variable
`RESEARCH_KIT_COLLECTION_ENV` set to `research-collection`. The README section
[Run the collector on GitHub](README.md#run-the-collector-on-github) has the detail and
the one place not to put it.

That is the setup. Restart the agent so it loads the server.

## Every time, by the agent

Open the agent and say what you want to know. One prompt is enough:

> Research this before we design anything: `<the question>`. Use the research-kit tools:
> collect on `OWNER/REPO`, then fetch_corpus, then review the package. If a fact is still
> missing, collect again with the exact pages. Stop at a passing preflight and a written
> brief. Do not build while buildAuthorized is false.

What the agent does with the two tools, in order:

| Step | Tool | What happens |
|---|---|---|
| 1 | `collect` with `repository` and `topic` (and `queries`, `urls`, `prefer`, `max_pages`, `depth` when it knows them) | GitHub starts the collector; the agent gets a run id at once |
| 2 | `fetch_corpus` with that `workflow_run_id` | While the run is going it says so. When done, it downloads the package, validates it, and returns a link to the ZIP on the agent's machine with `buildAuthorized: false` |
| 3 | no tool | The agent unpacks the ZIP, reads `README-FIRST.md`, classifies the map, rewrites every finding with a quote from its page, runs `preflight`, and writes the brief |
| 4 | `collect` again, when needed | A fact the gate says is unproven gets a targeted run: `urls` for the exact pages that own it, `max_pages` small. Then step 2 and 3 on that package |

Your part in all of this is reading `research/BRIEF.md` when the agent says it passed.

## What it costs, and what it refuses

- A run costs about one Firecrawl credit a page and two a search; the defaults (8 pages,
  depth `quick`) come to roughly ten. A targeted follow-up with three `urls` is about
  three. The free tier is 1,000 a month, and the collector stops at the cap.
- `buildAuthorized` is `false` for every freshly collected package, on purpose. The review
  in step 3 is what turns research into something a build may rest on, and the agent does
  it, not the collector.
- The topic is visible to anyone who can read the repository, in the run's log. For a
  question you would not publish, use a private repository, or run the kit locally with
  the key on the machine ([README: Run it on a real project](README.md#run-it-on-a-real-project)).
- Nothing in the token can touch code, secrets or settings. Revoke it at GitHub when the
  agent is done, and make another next time.

## If something does not work

| You see | Do |
|---|---|
| the agent says the server refuses: "no GitHub token in the environment" | the `env` block is missing or the agent was not restarted after you saved the settings |
| `collect` answers 403 or 404 | the token lacks **Actions: Read and write** on that repository, or the repository name is wrong |
| `fetch_corpus` says the run finished `failure` | open the run link it gives; the first failing step names the cause, most often the Firecrawl environment not yet set up in that repository |
| the agent wants to build and the package says `buildAuthorized: false` | it skipped step 3; tell it to review first |

### A certificate error on a network with TLS inspection

If Node cannot verify a certificate and your network uses TLS inspection, obtain its
approved CA certificate from the network owner. When that trusted root is what is
missing, set `NODE_EXTRA_CA_CERTS` to its PEM file in the environment of the Node
process **before starting it**. For the MCP server above, add it to that server's `env`
block and restart the agent. The file must exist on the machine running Node; a client
setting does not configure a collector running on GitHub.

Node reads this variable only at process launch. A missing or malformed file produces
a warning once, with other extra-certificate errors ignored. The variable is ignored
for setuid-root execution or Linux file capabilities; an explicit TLS/HTTPS `ca`
option bypasses the default and extra certificates. This addresses a missing approved
trust root, not every certificate error. Keep certificate verification enabled.
See the [Node v24.20.0 CLI reference](https://raw.githubusercontent.com/nodejs/node/v24.20.0/doc/api/cli.md);
the retained evidence is E-03/E-06 in `docs/decisions/2026-10-07-break-test-external-facts/`.
