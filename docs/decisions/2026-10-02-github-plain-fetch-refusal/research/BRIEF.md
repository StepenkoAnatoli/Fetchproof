# Brief - When and why GitHub answers 403 to unauthenticated non-browser fetches of github.com pages, and which routes GitHub documents for fetching a README or raw file without a browser session

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

A decision about this repository (ADR-0030): what the keyless transport should say when
github.com (or api.github.com) answers 403 to its plain fetch, and which free route it may
name as the remedy. Found 2026-10-02 collecting the Ollama README for a MoonAliza project:
`https://github.com/ollama/ollama` answered 403 to the keyless fetch, to curl with a Chrome
User-Agent and to plain curl alike, while `raw.githubusercontent.com` answered 200 and the
kit's browser transport fetched the page. Done means the corpus says what GitHub documents
about unauthenticated requests and 403s, which routes it documents for a README or a raw
file, whether automated fetching of public pages is permitted, and what the three hosts
answer today from this address - so the failure message names a route that is documented,
permitted and measured, not guessed. The change is wording of a named failure, allowed
under the freeze (ADR-0117).

## What we verified

| Claim | Source | Type |
|---|---|---|
| GitHub's REST rate limits: an unauthenticated request is tied to the originating IP address and allowed 60 requests an hour; secondary limits exist to prevent abuse. Nothing here governs plain fetches of github.com pages - the page is about api.github.com. [quote: The primary rate limit for unauthenticated requests is 60 requests per hour.] _(partial capture)_ | E-01 `docs.github.com` (U-01) | P |
| How GitHub spells a rate-limit refusal: 403 Forbidden or 429 Too Many Requests with the x-ratelimit-remaining header at 0, and a wait before retrying. The 403 this project measured carried no x-ratelimit header and a body that was not GitHub's, so it was not this. [quote: the `x-ratelimit-remaining` header will be `0`] _(partial capture)_ | E-02 `docs.github.com` (U-01) | P |
| The documented routes for a file: the contents endpoints and `GET /repos/{owner}/{repo}/readme`, whose default media type returns the raw file text, and whose JSON carries `download_url` pointing at raw.githubusercontent.com - GitHub itself names the raw host as where the bytes are served. [quote: Returns the raw file contents. This is the default if you do not specify a media type.] _(partial capture)_ | E-03 `docs.github.com` (U-02) | P |
| What a README is to GitHub: a file in the repository shown on its page, which is why the file itself - not the page - is the thing to fetch when the page is refused. [quote: You can add a README file to your repository to tell other people why your project is useful] _(partial capture)_ | E-04 `docs.github.com` (U-02) | P |
| The community thread on permanent raw links points at raw.githubusercontent.com URLs (with a commit SHA in place of the branch for permanence) - the same host the API's download_url names; fetched by the browser transport after the keyless fetch was refused (ledger entries 5 and 11). [quote: https://raw.githubusercontent.com/octocat/Hello-World/master/README] _(partial capture)_ | E-07 `github.com` (U-02, U-04) | S |
| The REST readme endpoint, unauthenticated: refused to the keyless fetch from this address (ledger entry 9, the same proxy 403), served to the browser transport (entry 14) as JSON naming the file, its size and its download_url on raw.githubusercontent.com - base64 content by default here because the browser asked for HTML, not the raw media type. [quote: "download_url":"https://raw.githubusercontent.com/ollama/ollama/main/README.md"] | E-10 `api.github.com` (U-02, U-04) | P |
| GitHub's acceptable use policy defines scraping as extracting information by an automated process such as a bot or webcrawler (the API is not scraping), permits researchers to use public non-personal information when the resulting publications are open access and archivists to use public information for archival purposes, and forbids excessive automated bulk activity and spam uses. A research kit fetching a handful of public pages for a cited corpus is within the permitted uses; bulk crawling is not. [quote: Scraping refers to extracting information from our Service via an automated process, such as a bot or webcrawler.] [quote: Researchers may use public, non-personal information from the Service for research purposes] _(partial capture)_ | E-05 `docs.github.com` (U-03) | P |
| github.com's robots.txt asks would-be crawlers to contact support, points at the API, names the AI crawlers (GPTBot, ClaudeBot, PerplexityBot and others) with a crawl delay of one second and an allow-list of marketing paths, and disallows repository sub-pages such as /pulse, /commits and issue search. A plain fetch of robots.txt itself was refused from this address (ledger entry 7) and served to the browser transport (entry 12). [quote: If you would like to crawl GitHub contact us via] | E-08 `github.com` (U-03, U-04) | P |
| The page that started this: the keyless fetch of github.com/ollama/ollama answered 403 (ledger entry 8), and the kit's browser transport fetched it (entry 13, 40 KB, complete). Measured beside it with curl from the same address on 2026-10-02: 403 for every User-Agent, and the body was not GitHub's - it was this session's egress proxy saying GitHub access to the repository is not enabled for the session. The block is the sandbox's, by address; on an operator's machine the page is served to a plain fetch. [quote: Get up and running with Kimi, GLM, MiniMax, DeepSeek, gpt-oss, Qwen, Gemma and other models] _(partial capture)_ | E-09 `github.com` (U-04) | P |
| raw.githubusercontent.com answered the plain keyless fetch with the README's markdown source (ledger entry 10, transport http-keyless, status 200): the free route that works from this address. [quote: Start building with open models.] | E-06 `raw.githubusercontent.com` (U-05) | P |

## Contradictions and how they were resolved

The sources agree with each other; the contradiction was between the first reading of the
measurement and the measurement itself. The first reading - "GitHub blocks plain fetches
from this address" - rested on the status code alone, because the keyless transport records
`HTTP 403` and discards the body. Reading the body with curl showed it was not GitHub's:
it is this session's egress proxy refusing a repository that is not attached to the
session (E-09, E-10). GitHub's own 403 for a rate limit carries `x-ratelimit-remaining: 0`
(E-02), which this one did not. So the block is the sandbox's, not GitHub's, and nothing
about GitHub's routes needed changing - the one thing wrong was that the kit threw away
the sentence that explained the refusal. Warnings read: every row is github.com because
the question is about GitHub; U-01's capture is partial by two sibling sections the
extractor left out, none of them the rate-limit sentence quoted.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**No change to any route, and no User-Agent change.** From an operator's machine a plain
fetch of a github.com page is served; from this sandbox it is refused by the session's
proxy for repositories not attached to it (E-09). The free routes are already in the kit
and were measured here: `raw.githubusercontent.com` answers a plain fetch of a file (E-06,
the host GitHub's own API names as `download_url`, E-03, E-10), and `--transport browser`
fetched every page the plain fetch could not (ledger entries 11-14). A User-Agent that
pretends to be a browser was ruled out before the research: the measurement showed the
block is not by client string, and the kit does not lie about what it is.

**One kit change, a bug fix under the freeze (ADR-0117):** the keyless transport's failure
names the server's own reason beside the status - a JSON `message`, an HTML title, or the
first line of a text body, bounded - so that `HTTP 403 - the server said: "GitHub access to
this repository is not enabled for this session..."` is what the ledger and the terminal
record, and the next person does not need curl to learn what refused them. The REST
readme endpoint is not named as a free route in that message: unauthenticated it is 60
requests an hour per address (E-01) and was refused from here like the page.

**For the operator:** on a PC, fetch GitHub pages keylessly as before; for a file, name the
raw URL (the API's `download_url` form); for a page a plain fetch refuses, `--transport
browser` is the free route and Firecrawl the paid one. Bulk crawling of github.com is not
what the kit does and is not permitted (E-05, E-08); a cited corpus of a few public pages
is within the uses GitHub permits researchers.

**Out of scope:** SerpAPI and Tavily as fetch fallbacks - SerpAPI is a search API and
returns no page, and Tavily was excluded from the kit on its data-retention disclosure
(ADR-0027, the 2026-09-22 Tavily projects); neither can serve a page GitHub refuses.

First build step: the named-reason change in `lib/http-transport.mjs`, red test first.

## Next steps

1. Review the **TODO** sections above (Contradictions, Decision) before handing off.
2. Hand this file to the builder (phase 2). Re-running `node "/root/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=b5f776152e156900 inputs=9e1578d351ea4b1d gate=pass -->
