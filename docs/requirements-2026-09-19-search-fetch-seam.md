# Requirements — splitting search from fetch

- **Date:** 2026-09-19
- **Source:** `research/BRIEF.md` (state: authored), gate PASS at commit `ad26daf`
- **Status:** specified, not built

Every requirement below carries a trace. `E-##` means a row in `research/EVIDENCE.md`
that resolves to a cached page under `research/raw/`. `[judgment]` means nobody's
document says this — it is an engineering decision, and it is marked so it can be
argued with rather than mistaken for a fact.

## The problem in one paragraph

The kit binds search and fetch to one adapter (ADR-0005). One free allowance therefore
pays for both halves of a run: at `perQuery: 2`, a plan query costs 2 Firecrawl credits
to search and 2 to scrape — 4 of 1,000 a month (E-03, E-14), so every search spent is a
page not fetched. A second provider does not make searching cheaper; it makes searching
stop competing with fetching. That is the whole benefit, and the requirements below
exist to obtain it without damaging the provenance guarantees the corpus rests on.

---

## Functional requirements

| ID | Requirement | Trace |
|---|---|---|
| FR-1 | `selectTransport` resolves **two** providers independently: one that fetches pages, one that runs searches. Each resolves through the existing precedence — explicit flag, environment, machine config, auto-detect. | E-07 + E-03 (two meters) |
| FR-2 | A **search provider** implements `search(query, opts) -> { ok, query, results[], error }` and nothing else. It is never asked to fetch a page. | E-07 (SerpAPI sells search; it does not scrape) |
| FR-3 | A **fetch provider** implements the existing capture-producing contract (`scrape`, `runScrape`, `map`, `status`, `command`, `name`). Unchanged from today. | ADR-0005 |
| FR-4 | `lib/serpapi.mjs` implements the search contract against SerpAPI's Google Search endpoint. | E-07, E-09 |
| FR-5 | With no SerpAPI credential present, the search provider auto-resolves to the fetch provider, and behaviour is identical to today's. | [judgment] — an opt-in that changes the default is not an opt-in |
| FR-6 | `--search-transport <name>` on `bin/research.mjs` and `bin/decompose.mjs` overrides selection; `FETCHPROOF_SEARCH_TRANSPORT` and a `searchTransport` machine-config key sit below it in precedence. | mirrors the existing `--transport` ladder |
| FR-7 | `doctor` reports the search provider as its own line: name, why it was chosen, and whether it is credentialled. | [judgment] — an unreported provider is an unaudited one |
| FR-8 | `research.mjs --status` and `--dry-run` name both providers before spending anything. | E-07 (a free tier with a monthly cap deserves a preview) |
| FR-9 | A search result carries which provider produced it, through to the `from:` field of any source it promotes. | [judgment] — see DR-2 |

## Non-functional requirements

| ID | Requirement | Trace |
|---|---|---|
| NFR-1 | **Zero new runtime dependencies.** SerpAPI is reached over `node:https`, as `http-transport.mjs` already reaches the web. | existing kit constraint |
| NFR-2 | `selectTransport`'s return value stays backward-compatible: `{ name, adapter, why }` keep their current meaning (the **fetch** provider) and a `search` field is added alongside. No existing caller changes shape. | [judgment] — additive beats breaking |
| NFR-3 | No vendor name appears outside an adapter module, `TRANSPORTS`, and the checks that deliberately name one. | ADR-0005 |
| NFR-4 | Every network path is injectable, so the whole adapter is testable with no key, no network, and no credits. | ADR-0005 |

## Constraints

| ID | Constraint | Trace |
|---|---|---|
| C-1 | SerpAPI free tier: **250 searches/month, 50/hour**. | E-07 |
| C-2 | SerpAPI bills **per response, not per result** — "responses with 100 results or empty result sets will both count as 1 search". A wide search is therefore free where Firecrawl charges 2 credits per 10. | E-07 |
| C-3 | SerpAPI serves an identical query from its own cache for **1 hour, free and uncounted**; `no_cache` defaults to `false`. The kit must not set `no_cache=true`. | E-09 |
| C-4 | SerpAPI's $2M U.S. Legal Shield is **excluded on Free, Starter and Developer plans**. Free-tier collection carries no indemnity. | E-10 |
| C-5 | Storing results is **unprohibited, not granted**, by both SerpAPI and Tavily. Documentation must say it that way. | E-10, E-16 |
| C-6 | Tavily is **out of scope**: §6.5 has Tavily and its AI providers retaining inputs and outputs "for purposes of training", §6.7 adds those providers may not be bound to confidentiality. | E-16 |
| C-7 | Firecrawl free tier allows 10 `/search` requests per minute. Whatever throttle protects SerpAPI must not slow the Firecrawl path below this. | E-01 |

## Architecture requirements

| ID | Requirement | Trace |
|---|---|---|
| AR-1 | One reader for provider choice. `selectTransport` stays the single place that answers "which provider", for both sides. | ADR-0002's principle, ADR-0005 |
| AR-2 | The two contracts are **declared**, not implied: `SEARCH_SHAPE` and `FETCH_SHAPE` frozen lists, checked by a test, as `ADAPTER_SHAPE` is today. | ADR-0005 |
| AR-3 | A provider module declares which contracts it satisfies. `serpapi.mjs` declares search only, and asking it to scrape is an error naming the reason — not a missing-function `TypeError`. | [judgment] |
| AR-4 | `transport-provenance` is **not** modified. It judges captures, captures come from the fetch side, and SerpAPI never produces one. Touching it would widen a check whose narrowness is the point. | E-07 |

## Data requirements

| ID | Requirement | Trace |
|---|---|---|
| DR-1 | The usage log (`research/raw/.usage.jsonl`) records both providers per run, not one `transport` field. | [judgment] |
| DR-2 | A URL promoted from a search records **which provider ranked it**. Two providers' rankings are different provenance claims; `from: "query: …"` cannot carry both. | [judgment], and the reason ADR-0009 keeps extraction honest |
| DR-3 | ~~The fetch ledger is **unchanged**.~~ **Amended during Phase B.** A search still never becomes a ledger entry — that part stands and is the requirement's point. But a fetch entry gains one optional field, `discoveredBy`, naming the provider whose ranking chose the URL. `transport` says who fetched the page; with two providers that stopped being the same answer as who *chose* it, and DR-2 has to live somewhere durable. Optional exactly as `error` and `omitted` already are, so every entry written before the split keeps the hash it was written with. | ADR-0003, DR-2 |
| DR-4 | The failure log records `provider` alongside `op: 'search'`, so a provider outage is attributable. | [judgment] |
| DR-5 | Where a provider reports a cost, record it rather than infer it from a tier table — and where it does not, say so instead of inventing one. Firecrawl returns `creditsUsed`. SerpAPI's `search_metadata` carries `id`, `status`, `json_endpoint` and `total_time_taken` and **no cost field**; its cost is the flat "1 per successful response" of C-2, which the kit must count itself. | E-07, E-09, E-14 |
| DR-6 | Record `search_metadata.id` per search. It is SerpAPI's own handle for the response and the only way to reconcile the kit's count against the vendor's meter. | E-09 |

## Integration requirements

| ID | Requirement | Trace |
|---|---|---|
| IR-1 | SerpAPI is called at `https://serpapi.com/search` with exactly three parameters: `engine=google` (documented default, sent explicitly), `q`, and `api_key` (documented **Required**, "the SerpApi private key to use"). `output` defaults to `json` and is not sent. | E-09 |
| IR-2 | `no_cache` is never sent, so the free 1-hour cache applies. | C-3, E-09 |
| IR-3 | `async` is never sent. It requires the Searches Archive API to collect results later, which is a second integration for no benefit at this scale. | E-09 |
| IR-4 | **No result-count parameter is sent.** `num` is not in the captured parameter list — only `start`, for pagination — and this project has twice paid for assuming an undocumented vendor parameter. Since a response costs the same whatever it contains (C-2), there is no cost reason to ask for fewer: take the default page and apply `limit` client-side. | E-09, C-2, and the defect recorded in `research/BRIEF.md` |
| IR-5 | Results are read from `organic_results[]` and normalise to the kit's existing shape — `link`→`url`, `snippet`→`description`, `title`, `position` — so `selectCandidates` and every downstream consumer are untouched. The existing `normalizeSearch` already accepts `link`/`snippet`, so the mapping is not new code so much as a second caller. | E-09, `lib/firecrawl.mjs:209` |
| IR-6 | A non-200, a transport error, or a payload carrying SerpAPI's `error` key is a failed search that is **logged and skipped**, never a thrown exception that ends a run. | RR-1 |

## Security requirements

| ID | Requirement | Trace |
|---|---|---|
| SR-1 | The API key is read from `SERPAPI_API_KEY` or the machine config at `~/.agents/fetchproof.config.json`. It is **never** written into this repository, never into a capture, never into a log, never into `plan.json`. | Project Rule 6 |
| SR-2 | The key travels in the POST-equivalent position the vendor requires — a query parameter — and therefore **must not** be echoed. Every rendering of the request for humans (`--dry-run`, the `cmd` annotation, error text) redacts it. | SR-1 |
| SR-3 | A failed request's error text is scrubbed of the key before it reaches a log or the terminal. Vendors echo request URLs in errors. | SR-2 |
| SR-4 | `doctor`'s secret scan continues to pass over the whole repo with no new exclusion. A fixture that needs a key-shaped string assembles it at runtime. | existing hardening decision |
| SR-5 | The query text is sent to a third party. Document it plainly: SerpAPI retains search data for 31 days, then deletes it automatically (E-10). The escape hatch is **not available to us** — the pricing table lists ZeroTrace Mode as a plan feature, but the API reference is narrower: `zero_trace` is "Enterprise only". Say the narrower thing. | E-09, E-10, E-16 |

## Reliability requirements

| ID | Requirement | Trace |
|---|---|---|
| RR-1 | A search-provider failure **degrades to the fetch provider's search** for that query, once, and records that it did. A run must not die because a second meter went down. | [judgment] |
| RR-2 | The fallback is bounded: it does not retry in a loop, and it spends Firecrawl credits, so it is reported in the run summary rather than being silent. | C-2 vs E-14 (the fallback costs money) |
| RR-3 | Exhausting the monthly cap is a **normal** outcome, not a crash: SerpAPI answers with an error payload, the run degrades per RR-1, and the summary says the cap was hit. | C-1 |
| RR-4 | A request carries a timeout. A hung socket must not wedge a synchronous collector holding the corpus lock. | ADR-0025 |
| RR-5 | Throttle to stay under 50 requests/hour without slowing the Firecrawl path. | C-1, C-7 |

## Testing requirements

| ID | Requirement | Trace |
|---|---|---|
| TR-1 | Normal: a real SerpAPI response body, captured from this machine, pinned as a fixture and replayed. No test may invent a vendor payload — that defect has been paid for twice already. | E-15's lesson; `firecrawl-search-1.23.3.json` |
| TR-2 | Edge: empty results; one result; `num` larger than the results available; a query containing characters that must survive URL encoding. | C-2 |
| TR-3 | Invalid: missing key, malformed key, 401, 429, 5xx, non-JSON body, truncated JSON. | IR-5 |
| TR-4 | Failure: socket timeout, DNS failure, connection reset — each degrades per RR-1 and each is asserted to degrade *once*. | RR-1, RR-2 |
| TR-5 | Integration: `runResearch` end-to-end with a stub search provider and a stub fetch provider, asserting candidates flow through and captures are stamped with the **fetch** provider. | AR-4 |
| TR-6 | Configuration: all four precedence positions, an unknown name, a search provider that cannot fetch, a fetch provider asked to search. | FR-6, AR-3 |
| TR-7 | Security: the key never appears in `--dry-run` output, the `cmd` annotation, any log line, or any error string — asserted against a key-shaped sentinel, not by eye. | SR-2, SR-3 |
| TR-8 | Regression: with no SerpAPI credential, a full run produces byte-identical selection, stamping and logging to today's. | FR-5 |

## Acceptance criteria

| ID | Criterion | Verified by |
|---|---|---|
| AC-1 | `node fetchproof/bin/selftest.mjs` passes with the new tests, and the existing 348 still pass. | Phase C |
| AC-2 | With no key: `doctor` reports one provider doing both jobs, and a dry run is unchanged. | TR-8 |
| AC-3 | With a key: `doctor` reports two providers, and a real run spends SerpAPI searches and Firecrawl scrapes — confirmed against both meters, before and after. | live run, Phase C |
| AC-4 | `preflight` still PASSes and the ledger chain still verifies after a two-provider run. | DR-3 |
| AC-5 | The secret scan passes with no new exclusion. | SR-4 |
| AC-6 | `docs/ARCHITECTURE.md` and `LAYOUT` name the new module in the same commit that adds it. | ADR-0007 |
| AC-7 | Every requirement above maps to a test or an explicit "not verified, and here is why". | Phase D |

## Out of scope, stated so it is not silently dropped

- **Tavily** (C-6). Revisit if a no-training tier ships. **Re-read 2026-09-22 and the
  trigger is not met** - §6.5 and §6.7 are unchanged, and the document contains no
  no-training tier, no data opt-out and no "enterprise" anything. Corpus and brief:
  `docs/decisions/2026-09-22-tavily-terms/`.
  **Re-read again 2026-09-28** (asked as a fallback for exhausted Firecrawl credits): §6.5 and
  §6.7 unchanged; the FAQ's "zero data retention" is contradicted by the terms and the
  privacy policy, and is reachable only by a negotiated contract. Trigger still unmet.
  **Re-read a fourth time 2026-10-04** (the operator proposed Tavily as a fallback provider),
  now including the pricing and enterprise pages: terms and privacy policy byte-identical to
  2026-09-28; four tiers, privacy named only for Enterprise and only as four words that resolve
  to a sales form; the FAQ's "zero data retention" bullet recorded as a contradiction of §6.5.
  Trigger still unmet. Corpus and brief: `docs/decisions/2026-10-04-tavily-terms-reread/`.
  Corpus and brief: `docs/decisions/2026-09-28-fetch-fallback/`.
- **Any paid tier** of anything.
- **Reconciling the two caches** — SerpAPI's 1-hour server cache (C-3) against the kit's
  on-disk `--refresh-days`. They do not conflict today; unifying them is a separate
  decision that does not block this seam.
- **Non-Google SerpAPI engines.** `engine=google` only.
- **`json_restrictor`.** SerpAPI can trim the response server-side, which would cut a
  ~400 KB payload substantially. Worth doing; not worth coupling the first version to a
  second endpoint's documentation we have not captured.
- **`zero_trace`.** Enterprise only (SR-5). Not available, so not designed around.

## Corrections made while writing this document

Recorded because the framework's self-correction rule applies to requirements, not only
to code — and because all three would have become defects had they reached Phase B.

1. **`num` was specified, and is not documented.** The first draft of IR-1 sent
   `num=<limit>` by analogy with Google's own parameter. The captured API reference
   lists `start` for pagination and no `num`. Removed, and replaced with client-side
   slicing — which C-2 makes free anyway.
2. **A cost field was assumed.** DR-5 originally said SerpAPI "returns `search_metadata`
   per response" and implied a cost in it. It returns that object; it carries no cost.
   Corrected to count locally and to record `search_metadata.id` instead.
3. **ZeroTrace was described as a paid feature.** The pricing table makes it look like a
   plan column; the API reference says "Enterprise only". The narrower source wins.

