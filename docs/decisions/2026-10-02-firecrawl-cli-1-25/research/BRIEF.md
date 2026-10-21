# Brief - Firecrawl CLI 1.25 against the 1.24.6 pin: what changed in scrape, search and map and their JSON output

_Auto-drafted 2026-10-02 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require the reviewing agent's judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

A decision about this repository (ADR-0030): whether `TESTED_CLI_VERSION` in
`fetchproof/lib/firecrawl.mjs` should move from 1.24.6 to 1.25.2, the version the CLI's
own update banner now advertises on an operator's PC (2026-10-02). The adapter drives the
`firecrawl` binary with specific flags (`scrape <url> --only-main-content --json`,
`search <q> --limit n --json`, `map <url> --limit n --json`, `--status`) and reads a
specific JSON shape (`data.markdown`, `data.metadata.sourceURL`, `data[].url/title/
description/position`, `links`) and a specific `--status` rendering; it also relies on the
bundled SDK's HTTP client tunnelling through `HTTPS_PROXY` (the 1.23.3 to 1.24.6 move was
forced by exactly that). Done means a reader knows, from the vendor's own pages: what
1.25.0 to 1.25.2 changed, whether any of those flags, fields or renderings changed, what
the new build bundles and requires, and therefore whether the pin can move without a
contract change - or must stay until a fixture is re-captured.

## What we verified

| Claim | Source | Type |
|---|---|---|
| The CLI's releases page lists v1.25.1 (2026-09-30 19:17) and v1.25.0 (2026-09-30 14:53) above v1.24.6; neither note names scrape, search, map, `--status` or `--json`. 1.25.0: print the API's keyless signup link as-is and send `X-Origin: cli`, the Alexandria skill in the Claude plugin manifest, separately billed enrichment credits shown in CLI receipts, keyless signup links tagged; 1.25.1: `--objective` for alexandria feedback. v1.25.2 has no release on this page at capture time. [render-reviewed: the 40 "Sorry, something went wrong" notices are GitHub's per-release Compare widget failing to load; the release headings, dates, commit ids and note bullets rendered whole] [quote: feat: print the API's keyless signup link as-is and send X-Origin: cli] | E-01 `github.com` (U-01, U-02, U-03, U-04, U-06) | P |
| npm's version list at capture: 1.25.2 published 43 minutes earlier and tagged latest (0 weekly downloads yet), 1.25.1 and 1.25.0 two days earlier (705 and 855), 1.24.6 seven days earlier (20,407). The pin is one minor and seven days behind the tag `latest`. [quote: 1.25.2 • Public • Published 43 minutes ago] | E-05 `npmjs.com` (U-01) | P |
| The vendor changelog is organised by API feature, not by CLI version: it carries no 1.25 entry. Its CLI-relevant items are keyless access for core endpoints from official MCP, CLI and SDK clients, lockdown mode as a flag on every surface including the CLI, and the developer and research search indexes reachable through the CLI - none a change to the scrape, search or map output the adapter reads. [quote: without an API key from official MCP, CLI, and SDK clients] | E-03 `firecrawl.dev` (U-01) | P |
| The CLI reference documents the flags the adapter sends: `scrape` takes `--only-main-content` and `--json` (force JSON output even with a single format), `search` takes `--limit` (default 5, max 100) and `--json`, `map` takes `--limit` and `--json`; authentication is `firecrawl login`, `--api-key`, or the `FIRECRAWL_API_KEY` environment variable; `--status` prints the authentication line, concurrency and credits. The page's `--status` sample still shows v1.16.2 and a plain credits line, so it is not a rendering contract for the current build. [quote: Force JSON output even with single format] | E-02 `docs.firecrawl.dev` (U-02, U-03, U-04, U-06) | P |
| The README (main, at capture) confirms the key sources in order - browser login, `firecrawl login --api-key`, the `FIRECRAWL_API_KEY` environment variable, or `--api-key` per command - and that a custom API URL skips authentication. `scrape` of several URLs saves each result under `.firecrawl/` in the working directory; `--json` is documented on scrape, search, developer, research and map alike. [quote: Tip: You can also set FIRECRAWL_API_KEY environment variable] | E-04 `raw.githubusercontent.com` (U-02, U-03, U-04, U-06) | P |
| The registry manifest of 1.25.2: engines `node >=22.0.0`; dependencies `firecrawl` 4.40.0 (the SDK, exact), `commander` ^14.0.2, `yaml` ^2.9.0, `@inquirer/prompts` ^8.2.1, `zod-to-json-schema` 3.24.6; bin `firecrawl` -> dist/index.js; unpacked size 1,976,774 bytes. The same SDK as 1.24.6, so the same bundled HTTP client. [quote: "dependencies":{"yaml":"^2.9.0","commander":"^14.0.2","firecrawl":"4.40.0","@inquirer/prompts":"^8.2.1","zod-to-json-schema":"3.24.6"}] | E-06 `registry.npmjs.org` (U-05) | P |
| The registry manifest of the pinned 1.24.6: engines `node >=22.0.0`; the same five dependencies at the same ranges as 1.25.2, `firecrawl` 4.40.0 exact; unpacked size 1,926,352 bytes - 1.25.2 adds about 50 KB of CLI code on an unchanged SDK. [quote: "dependencies":{"yaml":"^2.9.0","commander":"^14.0.2","firecrawl":"4.40.0","@inquirer/prompts":"^8.2.1","zod-to-json-schema":"3.24.6"}] | E-07 `registry.npmjs.org` (U-05) | P |

## Contradictions and how they were resolved

None on substance. Two gaps that are not disagreements: npm lists 1.25.2 (published 43
minutes before capture, tagged latest) while GitHub's releases page ends at v1.25.1 (E-05
against E-01) - a publication lag, so 1.25.2's own notes are unread here and the fixture
capture below is what reads its behaviour. The CLI reference's `--status` sample shows
v1.16.2 with a bare credits line (E-02), stale against both builds; the adapter's own
fixture (`test/fixtures/*-1.24.6.*`) is the rendering contract, not the docs page. U-05
rests on two readings of the one registry (the gate's one-voice warning), which is the
nature of a manifest: npm is the only publisher of what a version bundles. E-06 and E-07
were fetched keylessly as verbatim JSON because the registry serves JSON, not a page; the
other five went through Firecrawl.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

Move the pin to 1.25.2 as a vendor update under the freeze (ADR-0117), but only after
the same check that moved it from 1.23.3 to 1.24.6 - the notes say nothing about the
adapter's contract, and silence is not a fixture:

1. **Capture the new build's output, not its notes.** Install `firecrawl-cli@1.25.2`
   into a scratch npm prefix (never over the tested global), then with a real key run
   `firecrawl --status`, one `search --limit 3 --json` and one `scrape <url>
   --only-main-content --json` - about three credits - and save stdout and stderr as
   `test/fixtures/*-1.25.2.*` beside the 1.24.6 ones.
2. **Read them with the adapter's parsers** (`parseStatus`, `normalizeSearch`,
   `normalizeScrape`) through the fixture tests: the same fields must come back, and
   stdout must hold nothing after the JSON - the 1.25.0 note on enrichment credits in
   "CLI receipts" (E-01) is the one change that could print on stdout and break
   `parsePayload`, which skips a leading banner but not a trailing receipt.
3. **If the parsers read them unchanged**, move `TESTED_CLI_VERSION`, the install spec
   the workflows use (`cliInstallSpec`), the README's install line and the fixture
   names in one commit, with the comment block in `lib/firecrawl.mjs` extended by this
   decision's path. The bundle is unchanged (E-06, E-07: SDK 4.40.0, node >=22), so
   the proxy behaviour that forced the last move is not in question.
4. **If anything differs**, stay at 1.24.6, record the difference in this project's
   evidence, and open the adapter change as its own bug fix.

Out of scope: keyless mode (the vendor refuses keyless search, ADR on T1), Alexandria,
lockdown mode, the Claude plugin manifest.

First build step: step 1, the fixture capture - three credits, a scratch prefix, and the
files land beside the 1.24.6 fixtures before any version string moves.

## Next steps

1. Review the **TODO** sections above (Contradictions, Decision) before handing off.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

## Outcome (2026-10-02, after the handoff)

Step 1 was done the same day: `firecrawl-cli@1.25.2` installed into a scratch prefix,
`--status`, `scrape --only-main-content --json` and `search --limit 3 --json` run once each
with the key given per command (three credits), stdout and stderr kept apart. Read by the
kit's own parsers (`fetchproof/test/fixtures/*-1.25.2.*`, tests in
`fetchproof/test/transport.test.mjs`): stdout is one JSON value for scrape - the receipt,
`Scrape ID: ...`, goes to stderr, so the trailing-receipt case in U-03 does not arise;
search's `data.tools` is populated now (three Alexandria providers, no `url`) and none
reaches a result; `--status` is the same text as 1.24.6's. Step 3 followed:
`TESTED_CLI_VERSION` is 1.25.2 (kit 0.9.3). Step 4 was not needed.
<!-- fetchproof:brief-draft body=39df3fe401b747f2 inputs=fa8225c9b47e2673 gate=pass -->
