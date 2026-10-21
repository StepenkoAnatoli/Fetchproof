# Discovery Contract - How do table, citation, search and research-synthesis tools validate their inputs and judge their sources, as a benchmark for Fetchproof's corpus and gate

Started 2026-10-03. This file is the definition of "enough information to build".
`node "/root/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

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

## Unknowns

A fact belongs here when guessing it wrong changes the design: API limits and pricing,
auth model, data schemas, rate limits, licensing/ToS, platform behavior, current library
versions, competitor pricing, data availability.

Status is exactly one of:
- `CLOSED` - proven by an `E-##` row in `research/EVIDENCE.md` (which must point at cached raw text).
- `KNOWN-UNKNOWN` - unreachable now; the `Evidence` cell names the day-one verification step.

Anything else (`OPEN`, blank, "in progress") fails the gate.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-1 | Per the GFM specification's tables extension (D-10): how is a pipe character escaped inside a cell, what happens to a row with fewer cells than the header and with more cells than the header, and is the delimiter row required? | The kit parses and writes GFM tables (EVIDENCE.md, DISCOVERY.md, MAP.md); a parser that disagrees with the specification on escaped pipes or ragged rows silently drops or merges a cell, and the audit cannot say whether the kit's parser is conforming without the owner text. | CLOSED | E-01: pipes are backslash-escaped even inside inline spans; the delimiter row is required and must match the header's cell count or no table is recognized; a short body row gets empty cells, a long one loses the excess (GFM 0.29-gfm, section 4.10). |
| U-2 | What fields does a Zotero item record for a web page (accessDate versus date, url, title, websiteTitle), and how do Zotero's documentation and schema.org (dateModified, datePublished) distinguish the date a page was accessed from the date its content was published or modified (D-11)? | The kit records one date per evidence row (Retrieved); whether that is enough, or whether a published/modified date belongs beside it, depends on what the reference vocabularies separate and why. | CLOSED | E-02, E-21, E-04, E-03: Zotero records Date (publication) separately from Accessed (when the resource was accessed), with URL, Title and Website Title; schema.org separates dateCreated, dateModified and datePublished on the work and models no access date. The field_list page answered 404; item_types_and_fields carries the same field descriptions. |
| U-3 | For the Brave Search API (and Tavily, if its docs are reachable): what does a web result carry (title, url, description, page age / published date), what freshness filter the API offers, how many results one query returns at most, and the free tier's documented rate limits (D-3, D-12)? | The kit's search seam merges results from several providers into one ranked list; the fields it can rely on, the freshness it can ask for, the page size and the rate ceiling bound that design. Bing Web Search was retired in 2025 and is out of scope unless a live page says otherwise. | CLOSED | E-20, E-05, E-08, E-18, E-10, E-09: Brave returns title, url, description, page_age (published or last-modified) and age per result, at most 20 per query, with freshness pd/pw/pm/py or a date range; no free tier as such - $5 per 1,000 requests with $5 credit a month and 50 queries per second. Tavily: at most 20 results, time_range or start/end dates, published_date as an estimate; its rate-limit page was not captured (brief, known unknowns). Bing Web Search is retired and out of scope. |
| U-4 | How do GPT Researcher and Stanford STORM select and weigh sources - minimum number of sources per claim, source diversity, how they cite, and whether they verify a citation against the page text (D-13)? | The kit grades sources P/S/L and checks quotes against captures (ADR-0087); whether the two best-known open research-synthesis tools do more (or less) is the benchmark for the kit's source judgement. | CLOSED | E-11, E-12, E-19, E-13, E-14: GPT Researcher aggregates over 20 sources and trusts agreement across sites, filters passages by relevance, and keeps the URLs it summarized; STORM collects references by multi-perspective simulated conversations over a pluggable retriever and writes with citations. Neither documents a minimum of sources per claim, a publisher-diversity rule, or a check of a citation against the page text. |
| U-5 | Per publicsuffix.org and the list's maintainers: how is a hostname's registrable domain (eTLD+1) determined, so that two hostnames can be judged "the same publisher" (D-14)? | The kit's `prefer` lists and source diversity judgements compare hosts; a rule that treats `a.co.uk` and `b.co.uk` as one publisher, or `x.github.io` and `y.github.io` as one, gets diversity wrong in both directions. | CLOSED | E-15, E-17, E-16: the registrable domain is not computable from the name - registries' policies differ - so the Public Suffix List marks where the registrant-controlled part begins; a public suffix is the part not under the registrant's control, and a stale copy misjudges domains. The exact matching rules (longest match, wildcards, exceptions) are on the list's wiki Format page, not captured here (brief, known unknowns). |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

None. The lead set the intent, the five unknowns and the owner pages; every remaining
question is a fact on a public page.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- This is a nested decision project (ADR-0030); it writes nothing outside its own folder
  except its row in `docs/decisions/README.md` (ADR-0102).
- Budget: at most 22 pages, collected through the Firecrawl CLI; no `--fallback`.
- The review is the agent's (ADR-0107): the brief is authored and declared `Reviewed by: agent`.
