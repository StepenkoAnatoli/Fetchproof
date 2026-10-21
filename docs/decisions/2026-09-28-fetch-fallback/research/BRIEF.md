# Brief - Fetch fallback when Firecrawl credits run out: Firecrawl out-of-credits error, Tavily terms of service data training, Tavily search and extract API credits

_Auto-drafted 2026-09-28 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
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

## The prior, registered before anything was collected

_Ledger seq 1, chained: neither this text nor its place before the evidence
can be changed now. Read it against the findings below - it may well be wrong, and a wrong
prior that was recorded in advance is worth more than a right one remembered afterwards._

> I expect Tavily's terms still allow training on customer input (C-6 unchanged, no no-training tier), so Tavily stays excluded; and Firecrawl signals exhausted credits with HTTP 402 Payment Required, which the CLI surfaces as an error the kit can detect.

## Intent

When Firecrawl credits run out mid-run, the kit should keep collecting through another
transport instead of recording every remaining page as failed, without breaking the ledger's
per-capture record of which transport fetched what. The operator asked whether Tavily, or
another API, should be that fallback. Done means: the signal to detect is known, the
Tavily question is answered against the existing exclusion (C-6 in
`docs/requirements-2026-09-19-search-fetch-seam.md`), and the fallback is chosen.

## What we verified

| Claim | Source | Type |
|---|---|---|
| Firecrawl billing: on the Free plan (no pay-as-you-go), "Requests that consume credits return HTTP 402 (Payment Required) until the monthly reset"; paid plans with pay-as-you-go off also return 402. Scrape and Search also work with no key through the keyless free tier, capped per IP per day. | E-01 `docs.firecrawl.dev` (U-01) | P |
| Tavily Platform Terms, re-read 2026-09-28: §6.5 still lets Tavily and its AI providers "use, process, analyze, and retain Customer Input ... for purposes of training"; §6.7 still has third-party providers access inputs under their own agreements. "Enterprise" appears 0 times; "opt out" 3 times, all about arbitration. The C-6 trigger (a no-training tier) is not met. | E-03 `tavily.com` (U-02) | P |
| Tavily credits: 1,000 free credits a month, no card; basic search 1 credit, advanced 2; basic extract 1 credit per 5 successful URLs, advanced 2; "You never get charged if a URL extraction fails." Pay-as-you-go $0.008 a credit. | E-05 `docs.tavily.com` (U-03) | P |
| Firecrawl API source at 24b827e, apps/api/src/routes/shared.ts: when credits are exhausted the API returns HTTP 402 with `error: "Insufficient credits to perform this request. For more credits, you can upgrade your plan at https://firecrawl.dev/pricing or try changing the request limit to a lower value."` - the words "Insufficient credits" are the stable part. | E-10 `raw.githubusercontent.com` (U-04) | P |

## Contradictions and how they were resolved

- **Tavily's FAQ (E-09) says "zero data retention"; its Terms §6.5 (E-03) keep the right to
  retain and train on inputs, and its privacy policy (E-04) says query data may be used to
  improve future responses and shared with third-party search indexes.**
  - **What I trust:** the terms and the privacy policy. They are the contract; the FAQ is a
    marketing bullet with no scope or conditions.
  - **How they can be reconciled:** the privacy policy's "unless otherwise specified under
    the contract" suggests zero retention is something a negotiated contract can buy. That
    is a paid, negotiated arrangement, not a tier the kit could use, and paid tiers are out
    of scope. So the C-6 trigger ("a no-training tier ships") is still not met.
- **The Firecrawl docs say 402 (E-01, E-02); the kit never sees 402 (E-10, E-11).** Both
  are true. The status stops at the SDK, which passes on only the response's error text.
  Detection must therefore match the words "Insufficient credits", not the number.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**Tavily stays out (C-6 unchanged).** Six days after the last reading, §6.5 and §6.7 of its
terms are unchanged: it still reserves the right to train on what is sent, and in this kit
what is sent is the research subject. What it would have offered is on record (U-03:
1,000 free credits a month, 1 credit a basic search, extract failures free). So if a
no-training tier ever ships, the adapter is small.

**The fallback is the kit's own `http-keyless` transport.** When Firecrawl reports
"Insufficient credits", the rest of the run fetches through `http-keyless`, and the run
says so once. It is free, involves no new vendor, and is already a named transport. Every
capture already records the transport that fetched it in the ledger, so the corpus stays
honest about which pages came from where.

**Out of scope:** a paid tier of anything; making Firecrawl's own keyless tier the fallback.
The CLI reads a stored credential, so the kit cannot reliably force a keyless call per
process.

**First build step:**
- `lib/firecrawl.mjs` classifies a failed scrape whose error text matches
  `/insufficient credits/i` as `creditsExhausted`.
- `lib/research-run.mjs` switches the remaining fetches to `http-keyless` on the first such
  failure, re-fetches that page, and logs one line naming both transports.
- Test it with a stub adapter that returns the E-10 message.

## Next steps

1. Build the fallback above (ADR in the same commit).
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=e5811775491d132d inputs=b0c6f1e37427af57 gate=pass -->
