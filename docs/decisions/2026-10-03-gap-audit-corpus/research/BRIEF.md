# Brief - How do table, citation, search and research-synthesis tools validate their inputs and judge their sources, as a benchmark for Fetchproof's corpus and gate

_Auto-drafted 2026-10-03 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
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

Benchmark Fetchproof's corpus parsing, source judgement and search merging against the
tools and specifications below. This is a decision about the repository (ADR-0030), read by
the lead of a gap audit of the kit: it compares what the kit's table parser, evidence rows,
search seam and source grading do with what the GitHub Flavored Markdown specification says
a table is, what a citation manager (Zotero) and the structured-data vocabulary (schema.org)
record about a page's dates, what a web-search API (Brave, Tavily) returns per result and
under which limits, how two research-synthesis tools (GPT Researcher, STORM) select, weigh
and cite sources, and how a hostname's registrable domain is determined (the Public Suffix
List). Nothing is built here: "done" means every unknown below is closed from the owner
page, and the brief carries the benchmark table the audit cites. The kit is feature-frozen
(ADR-0117): any change this benchmark suggests enters through an ADR, not through this
project.

## What we verified

| Claim | Source | Type |
|---|---|---|
| The GFM tables extension (section 4.10) defines a table as a header row, a required delimiter row and zero or more data rows [quote: consisting of a single header row, a delimiter row separating the header from the data, and zero or more data rows]. A pipe inside a cell is backslash-escaped, even inside code or emphasis (example 200) [quote: Include a pipe in a cell's content by escaping it, including inside other inline spans]. The header and delimiter rows must agree in cell count or no table is recognized (example 203) [quote: The header row must match the delimiter row in the number of cells. If not, a table will not be recognized]. Body rows may be ragged: short rows get empty cells, long rows lose the excess (example 204) [quote: If there are a number of cells fewer than the number of cells in the header row, empty cells are inserted. If there are greater, the excess is ignored]. Spec version 0.29-gfm (2019-04-06). | E-01 `github.github.com` (U-1) | P |
| Zotero's field reference separates the publication date from the access date: the general Date field is the date of publication, and Accessed is for when an electronic resource was accessed [quote: Date of publication. Use "Accessed" for the date an electronic resource was accessed.] [quote: Date an electronic resource was accessed. Typically filled automatically.]. URL is where the item was accessed [quote: URL (web-address) where the full item was accessed.], Website Title is the containing site [quote: The title of the blog or website containing a post or specific web page.], and Webpage is the item type for an online page [quote: An online page of a website. When possible, use one of the more specific item types above]. Date Added and Date Modified are Zotero's own record timestamps, filled automatically, distinct from both. The second owner page, support/kb/field_list, answered HTTP 404 on 2026-10-03 and is not in the corpus. | E-02 `zotero.org` (U-2) | P |
| schema.org's CreativeWork type lists the three dates side by side: dateCreated [quote: The date on which the CreativeWork was created or the item was added to a DataFeed.], dateModified [quote: The date on which the CreativeWork was most recently modified or when the item's entry was modified within a DataFeed.] and datePublished [quote: Date of first publication or broadcast.]. None of them is the date a reader accessed the page; that date belongs to the citation record (E-02), not to the work. | E-21 `schema.org` (U-2) | P |
| schema.org defines datePublished as the first publication [quote: Date of first publication or broadcast. For example the date a CreativeWork was broadcast or a Certification was issued.] - a property of the work, distinct from when a reader fetched it, which schema.org does not model on the work at all. | E-04 `schema.org` (U-2) | P |
| Partial capture (1331 characters): the dateModified property page came back with its header and usage count only, not its definition [quote: A Schema.org Property]. The definition is taken from E-21 (the CreativeWork type page), which lists dateModified with the same text schema.org publishes on this page. _(partial capture)_ | E-03 `schema.org` (U-2) | P |
| Brave's Web Search API reference, the owner of the result shape: count is 1..20, default 20 [quote: The maximum is 20. The actual number delivered may be less than requested.]; freshness filters by page age, which Brave derives from the content's published or last-modified date [quote: Filters search results by page age. The age of a page is determined by the most relevant date reported by the content, such as its published or last modified date.]. Each web.results item carries title (required) [quote: The title of the web page.], url (required) [quote: The URL where the page is served.], description (nullable) [quote: A description for the web page.], page_age (nullable) [quote: The page's date, based on its published or last modified date.] and age [quote: A human-readable representation of the web search result's age. For example, 2 days ago.]. Rate limiting answers 429 [quote: Too Many Requests]; the numeric rate is on the plans page (E-08, E-18). | E-20 `api-dashboard.search.brave.com` (U-3) | P |
| Brave's Web Search overview documents the freshness filter and the page size: freshness takes pd, pw, pm, py or a custom range [quote: Last 24 Hours (pd): Get the latest updates and recent content] [quote: Custom Date Range: Specify exact timeframes (e.g., 2022-04-01to2022-07-30)], and count is at most 20 per page [quote: count: Maximum number of results per page (max 20, default 20)] with offset 0..9 [quote: offset: Starting position for results (0-based, max 9)]. The per-result fields are on the API reference it links to (E-20); the overview shows title and description in its extra_snippets example only. | E-05 `api-dashboard.search.brave.com` (U-3) | P |
| Brave's plans page shows no separate free tier: the Search plan is metered at $5 per 1,000 requests [quote: $5 per 1,000 requests] with $5 of credit a month, i.e. 1,000 requests free [quote: Includes $5 in free credits every month], at a capacity of 50 queries per second [quote: 50 queries per second]; a card is required even for the free allowance [quote: The credit card requirement serves as an anti-fraud measure]. The Answers plan is $4 per 1,000 requests plus token fees at 2 queries per second. | E-08 `brave.com` (U-3) | P |
| Brave's pricing page in the dashboard: $5.00 per 1,000 requests [quote: $5.00 per 1,000 requests], $5 free credit a month [quote: Includes free $5 in credits every month.], 50 requests per second [quote: Capacity50requests per second]. Consistent with E-08. | E-18 `api-dashboard.search.brave.com` (U-3) | P |
| Tavily's search endpoint returns at most 20 results per query, default 10 [quote: The maximum number of search results to return.] [quote: Required range: 0 <= x <= 20]; each result in the example response carries title, url, content, score, raw_content and published_date. Freshness is time_range (day, week, month, year) or start_date/end_date, filtering on publish or last-updated date [quote: The time range back from the current date to filter results based on publish date or last updated date.]; published_date is an estimate that can post-date the original publication [quote: The date is Tavily's best estimate of when the source was published or last updated, so it can be later than the original publish date.]. Results are ranked by relevancy [quote: A list of sorted search results, ranked by relevancy.]; a basic search costs 1 credit, advanced 2 [quote: advanced: 2 API Credits]. | E-10 `docs.tavily.com` (U-3) | P |
| Tavily's documentation home links the credits and rate-limit pages but states no limit itself [quote: Understand Tavily's rate limits and policies]; the rate-limit page was not in the budget, so Tavily's documented rate limit is not in this corpus (named in the brief's known unknowns). | E-09 `docs.tavily.com` (U-3) | P |
| GPT Researcher's README states its source policy as breadth, not per-claim counts: it aggregates over 20 sources [quote: Aggregate over 20 sources for objective conclusions.], source-tracks each summarized resource [quote: Summarize and source-track each resource.], and treats agreement across many scraped sites as its accuracy mechanism [quote: We assume that the more sites we scrape the less chances of incorrect data. By scraping multiple sites per research, and choosing the most frequent information, the chances that they are all wrong is extremely low.]. Passage selection is a relevance filter (Jev by default), not a citation check [quote: Every research run scrapes dozens of pages, and only some of each page helps answer the question.]. No minimum sources per claim, no publisher-diversity rule and no verification of a citation against the page text are documented. | E-11 `github.com` (U-4) | P |
| GPT Researcher's docs introduction repeats the policy: over 20 web sources per research [quote: Aggregates over 20 web sources per research to form objective and factual conclusions], each scraped resource summarized with its source kept [quote: For each scraped resources, summarize based on relevant information and keep track of its sources.] [quote: Keeps track and context of visited and used web sources]. Citation here means the report keeps the URLs it summarized from; nothing is said about checking a citation's text. | E-12 `docs.gptr.dev` (U-4) | P |
| GPT Researcher's FAQ: accuracy rests on many sources plus a proprietary relevance ranker [quote: We do this by using multiple sources, and by using proprietary AI to score and rank the most relevant and accurate information.], over 20 sources per task [quote: scraping, filtering and aggregating over 20+ web sources per a single research task]. No citation-to-text verification is described. | E-19 `docs.gptr.dev` (U-4) | P |
| STORM's README describes a two-stage pipeline: research that collects references, then writing from them with citations [quote: The system conducts Internet-based research to collect references and generates an outline.] [quote: The system uses the outline and references to generate the full-length article with citations.]. Sources enter through a pluggable retrieval module over ten search back-ends [quote: YouRM, BingSearch, VectorRM, SerperRM, BraveRM, SearXNG, DuckDuckGoSearchRM, TavilySearchRM, GoogleSearch, and AzureAISearch] and the top-k retrieved per question; diversity comes from perspectives, not publishers [quote: STORM simulates a conversation between a Wikipedia writer and a topic expert grounded in Internet sources]. No minimum sources per claim and no verification of a citation against page text are documented. | E-13 `github.com` (U-4) | P |
| The STORM paper's abstract: sources are gathered by simulated multi-perspective conversations with an expert grounded on trusted Internet sources [quote: simulating conversations where writers carrying different perspectives pose questions to a topic expert grounded on trusted Internet sources], and the authors name source bias transfer as an open problem [quote: source bias transfer and over-association of unrelated facts] - i.e. the grounding is on retrieval, not on a per-citation check. NAACL 2024. | E-14 `arxiv.org` (U-4) | P |
| publicsuffix.org explains that a registrable domain cannot be computed from the name alone: registries' policies differ, so the boundary is a maintained list [quote: Since there was and remains no algorithmic method of finding the highest level at which a domain may be registered for a particular top-level domain (the policies differ with each registry), the only method is to create a list.]. The list tells software where the registrant-controlled part begins, which is what grouping by site rests on [quote: By knowing where the user-controlled section of the domain name begins and ends, browsers can group cookies and history entries by site]. A stale embedded copy misjudges domains [quote: If the PSL is incorporated in a static manner, and your software does not regularly receive PSL updates, it will erroneously think that valid TLDs are not valid]. | E-15 `publicsuffix.org` (U-5) | P |
| Partial capture (1441 characters, the page is short). It defines a public suffix as the part of a name outside the registrant's control [quote: A public suffix is a set of DNS names or wildcards concatenated with dots. It represents the part of a domain name which is not under the control of the individual registrant.], points to the wiki for the format and matching specification [quote: Please see the Public Suffix List Wiki at the following link for information on the formatting and specifications], and asks consumers to refresh at most daily [quote: have your app download the list no more than once per day]. _(partial capture)_ | E-17 `publicsuffix.org` (U-5) | P |
| The publicsuffix/list repository is the list's source of record; the README covers submissions and notices, not the matching algorithm [quote: All submissions must conform to the validation and acceptance factors, provide sufficient rationale, and be as complete as possible]. The format and matching rules are on the repository wiki (Format), which this corpus did not capture. | E-16 `github.com` (U-5) | P |

## Contradictions and how they were resolved

- **Brave's "free tier".** The lead's question assumed a free tier with its own rate
  limit. The plans page (E-08) and the dashboard pricing page (E-18) agree there is none:
  one metered Search plan at $5 per 1,000 requests, $5 of credit a month (so 1,000
  requests free), capacity 50 requests per second, and a card required to subscribe. Both
  are Brave's own pages, read the same day, and they agree; the older "2,000 queries a
  month, 1 per second" free plan that the kit's search-seam notes may remember is not on
  either page. Trusted: the two live pages.
- **Brave's three dashboard routes.** `/web-search/get-started`, `/web-search/query` and
  `/web-search/responses` (E-05, E-06, E-07) returned one identical body - the overview.
  The dashboard is a single-page app and served the overview for every route, so the
  "query parameters" and "response objects" pages the plan named do not exist as pages.
  Resolved by collecting the API reference the overview links to (E-20), which is the
  owner of `count`, `freshness` and the `web.results` fields. The three rows stay in the
  table because they were fetched and paid for; E-06 and E-07 say what they are.
- **Tavily's `published_date` versus Brave's `page_age`.** Both are the provider's
  estimate of "published or last modified" (E-10, E-20), and Tavily says outright that its
  estimate can be later than the original publication. Neither is the page's
  `datePublished`, and neither is an access date. Not a contradiction between the two
  vendors, but a contradiction with any design that treats a search result's date as the
  page's publication date: the vocabularies (E-02, E-21) keep three dates apart - published,
  modified, accessed - and the search APIs collapse the first two.
- **GPT Researcher's cost figures.** The README says $0.4 per research (o3-mini, high),
  the docs introduction says about $0.1, the FAQ says about $0.01 (GPT-4). Three pages,
  three numbers, each tied to a different model and date; none bears on the benchmark, so
  none is relied on. Noted so the reader does not take any one of them as current.
- **The GFM specification is its own only source** (preflight's `single-source` warning on
  U-1). There is no second owner of GFM's table rules; a second reading would be a
  write-up about the specification, which Rule 4 ranks below it. The warning stands and is
  accepted.

## Known unknowns

No blocking unknown is open, but four facts the audit may want are not in this corpus.
Each has a day-one step, and each is one page:

1. **Tavily's documented rate limit.** The docs home (E-09) links a Rate Limits page that
   the 22-page budget did not reach. Day one: capture
   `https://docs.tavily.com/documentation/rate-limits` and read the per-plan figure.
2. **The Public Suffix List's exact matching rules** - longest match, the `*.` wildcard,
   the `!` exception, and "registrable domain = public suffix plus one label". E-15 and
   E-17 establish that the list, not an algorithm, decides, and E-17 points to the owner:
   `https://github.com/publicsuffix/list/wiki/Format`. Day one: capture that page before
   writing or judging any eTLD+1 code.
3. **Zotero's `field_list` page** answered HTTP 404 on 2026-10-03. The same field
   descriptions are on `item_types_and_fields` (E-02), which closed U-2; if the audit wants
   the per-item-type field sets, the machine-readable owner is the Zotero schema
   (`https://api.zotero.org/schema`, the `webpage` item type).
4. **`schema.org/dateModified` as its own page** came back partial (E-03). Its definition
   is in E-21 word for word; a re-fetch is only needed if a citation must point at the
   property's own URL.

## Decision

Nothing is built from this project; it is the benchmark the gap audit cites. The decision
is the table below - what each reference does, and which kit mechanism it benchmarks -
and the first step is for the audit lead, not a builder.

### The benchmark table

| Area | Reference does | Kit mechanism it benchmarks | Rows |
|---|---|---|---|
| Table parsing | GFM: pipe escaped with a backslash, even inside code and emphasis; delimiter row required and must match the header's cell count or it is not a table; short body rows get empty cells, long rows lose the excess; a table ends at a blank line or another block | the Markdown table parser behind `EVIDENCE.md`, `DISCOVERY.md` and `MAP.md`: does it un-escape `\|`, refuse a header/delimiter mismatch, pad short rows and drop excess cells the same way GitHub renders them? | E-01 |
| Citation dates | Zotero: Date (publication) and Accessed (retrieval) are two fields, plus URL, Title, Website Title; schema.org: dateCreated, dateModified, datePublished on the work, no access date | the evidence row's single `Retrieved` column: it is Zotero's Accessed; the page's own published/modified date has no column, and a search result's `page_age`/`published_date` is an estimate of the latter, not a substitute for either | E-02, E-21, E-04, E-03 |
| Search results | Brave: title, url, description, page_age, age; count max 20, offset max 9; freshness pd/pw/pm/py or a date range; 429 on rate limit; $5 per 1,000 requests, $5 credit a month, 50 rps. Tavily: title, url, content, score, raw_content, published_date; max_results 0..20, default 10; time_range or start/end dates; results ranked by relevancy; 1 credit basic, 2 advanced | the search seam's merge: the fields it can rely on across providers are title, url and a snippet; a date exists on both but under different names and semantics; a page is at most 20 results on either, so "limit 25" is two calls | E-20, E-05, E-08, E-18, E-10, E-09 |
| Source judgement | GPT Researcher: over 20 sources per task, agreement across many sites as the accuracy mechanism, a relevance filter on passages, URLs kept with each summary; STORM: references collected by multi-perspective simulated conversations over a pluggable retriever, article written with citations, source bias transfer named as open. Neither documents a minimum of sources per claim, a publisher-diversity rule, or a check of a citation against the page text | the kit's P/S/L grading, the `corroboration/single-source` check, and the quote anchor (ADR-0087): the kit checks a citation against the capture, which neither reference tool documents; the reference tools have breadth (20+ sources) which the kit's per-unknown corroboration only partly has | E-11, E-12, E-19, E-13, E-14 |
| Publisher identity | PSL: no algorithm finds the registrable boundary - registry policies differ - so a maintained list marks where the registrant-controlled part begins; a public suffix is the part not under the registrant's control; embedding a stale copy misjudges domains; the matching rules live on the wiki Format page | any host comparison in the kit (`prefer` lists, "same publisher" in corroboration, the measurement's domain counts): a last-two-labels rule is wrong for `co.uk` and `github.io`, and a PSL copy needs a refresh policy | E-15, E-17, E-16 |

### First step for the audit

Read the five mechanisms named in the third column against the first, and for each
one write down which of three things is true: the kit already conforms, the kit differs
on purpose (cite the ADR), or the kit has a gap. The known unknowns above name the one
page per area still worth capturing before a gap is declared. Out of scope: any change to
the kit - the freeze (ADR-0117) stands, and a gap found here enters through an ADR.

## Next steps

1. The TODO sections are answered (Reviewed by: agent, ADR-0107).
2. Hand this file to the gap-audit lead (phase 2 here is the audit's reading, not a build). Re-running `node "/root/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.
<!-- fetchproof:brief-draft body=53e8b46cace76f83 inputs=d4b0dd3622e80c36 gate=pass -->
