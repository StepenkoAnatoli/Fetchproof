# Discovery Contract - How content extractors grade their output, how web tools read PDFs, and how challenge pages and soft 404s are detected, as a benchmark for Fetchproof's converter, completeness grade and capture acceptance

Started 2026-10-04. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Benchmark three of Fetchproof's capture mechanisms against the tools and specifications
that own the comparable behaviour. This is a decision about the repository (ADR-0030), read
by the lead of a gap audit of the kit, and it is a documentation benchmark: nothing is built
here. The three mechanisms are (1) the kit's HTML-to-markdown converter, benchmarked
against how main-content extractors judge their own output - trafilatura's precision and
recall settings and fallback chain, Mozilla Readability's readerability test and parse
result, jusText's paragraph classification; (2) the kit's `completeness` grade (`full` or `partial`)
grade, benchmarked against what those extractors and a web archive (Common Crawl, the WARC
format) record when a body is doubtful or truncated, and against whether a metered web tool
(Firecrawl) can read a PDF at all and at what cost; and (3) the kit's acceptance of any HTTP
200 body as a capture, benchmarked against how Cloudflare says a challenge page can be
recognised and how Google Search Central defines a soft 404. "Done" means every unknown
below is closed from the owner page, and the brief carries the benchmark table the audit
cites, with the three audit questions answered from evidence: would a boilerplate-only
capture be graded `full`, would a PDF statute be uncollectable keyless, and would a challenge
page be cited as evidence. The kit is feature-frozen (ADR-0117): any change this benchmark
suggests enters through an ADR, not through this project.

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
| U-1 | Per trafilatura's own documentation (D-10, D-11): how does it grade or fall back when extraction is doubtful (the precision/recall-oriented settings `favor_precision` and `favor_recall`, the fallback to readability-lxml and jusText), what metadata does it extract beside the body (title, author, date, sitename), and how does it find the publication date (htmldate)? | The kit's converter turns a fetched body into markdown and grades the capture `full` unless something was omitted; if a reference extractor knows when its own output is doubtful and the kit does not, a boilerplate-only capture is graded `full` where trafilatura would have fallen back or returned nothing. | CLOSED | E-01, E-02, E-03: `extract()` runs its own extractor and falls back to readability and jusText when the result is too short; `favor_precision` prunes harder and skips the fallbacks, `favor_recall` relaxes link-density thresholds; `is_probably_readerable()` is exposed; metadata is title, author, date, url, sitename and more, and `only_with_metadata` discards a document lacking date, title or url; dates come from htmldate, which separates original from updated dates and reads header markup, structural markers, then text heuristics. On trafilatura's own benchmark a keep-everything converter scores about 0.53 precision. |
| U-2 | Per the mozilla/readability README (D-10, D-11): what does `isProbablyReaderable` decide, on what thresholds (character counts, score), what does `parse()` return (title, byline, excerpt, siteName, publishedTime, textContent, length), and when does it return null? | A readerability test is a yes/no on "is there an article here" taken before extraction; a parse that returns null instead of boilerplate is the behaviour the kit's `full` grade lacks, and the metadata fields are the shape an evidence row could carry beyond the retrieval date. | CLOSED | E-04: `isProbablyReaderable` returns a boolean from nodes of at least `minContentLength` 140 characters accumulating a `minScore` of 20, and the README says it yields false positives and negatives; `parse()` needs `charThreshold` 500 characters to return a result and returns title, content, textContent, length, excerpt, byline, dir, siteName, lang, publishedTime, preferring JSON-LD metadata. The README does not spell out the null return; that sentence is in Readability.js (brief, known unknowns). |
| U-3 | Per jusText's repository and algorithm description (D-10): how are paragraphs classified (good / bad / short / near-good), and which stop-word density and length heuristics decide boilerplate? | jusText's classification is the simplest documented rule for telling body text from boilerplate; it is the benchmark for whether the kit's converter can tell a navigation-only capture from a page with content. | CLOSED | E-06, E-05: four context-free classes (bad, good, short, near-good) from block length (LENGTH_LOW 70, LENGTH_HIGH 200 characters), link density (MAX_LINK_DENSITY 0.2) and stop-word density (STOPWORDS_LOW 0.30, STOPWORDS_HIGH 0.32); only a long block with high stop-word density is good; short and near-good blocks are resolved from neighbours, a run of short blocks is bad, and document edges count as bad. The Python port exposes it as `paragraph.is_boilerplate`. |
| U-4 | Per Firecrawl's scrape documentation and API reference (D-7, D-9, D-12): is a PDF URL parsed to markdown, how (the `parsers` option, `maxPages`), what are the limits, and what is the credit cost per PDF page? | A statute, a standard or a paper is often a PDF; whether the kit's metered transport parses it, how many pages, and at what cost decides whether such a source is collectable, and a keyless transport that reads only HTML leaves the PDF statute uncollectable. | CLOSED | E-07, E-08, E-14, E-16: `/scrape` auto-detects a PDF URL and returns markdown; `parsers` defaults to pdf, an empty array returns base64 for a flat 1 credit; parsing is billed 1 credit per PDF page on top of the scrape; `maxPages` caps the pages and the response reports `numPages` against `totalPages` so a truncated parse is visible; modes fast, auto, ocr (OCR for image-only pages); actions fail on PDFs. Firecrawl also separates the API status from `data.metadata.statusCode` and treats 2xx or 304 as a clean load with no content check. |
| U-5 | Per Cloudflare's challenge documentation (D-9, D-13): how can an automated client recognise that it received a challenge page instead of the content - the `cf-mitigated: challenge` response header and any other documented signal - and what HTTP status code does the challenge return? | The kit accepts any HTTP 200 body as a capture; if a challenge page is served with a 200-class or a 403 status and the only reliable signal is a header, a challenge page is cited as evidence unless the collector reads that header. | CLOSED | E-15, E-09: every Challenge Page response carries the header `cf-mitigated: challenge`, the only valid value, set for all challenge types, and Cloudflare calls it the reliable way to tell a challenge from the content. Neither captured page states the HTTP status code of a challenge response (brief, known unknowns); the signal Cloudflare documents is the header. The path the lead named answered HTTP 404 and was re-targeted to detect-response/. |
| U-6 | Per Google Search Central's HTTP and network errors page (D-9, D-14): what is a soft 404, and what signals identify one? | A "not found" page served with HTTP 200 is a capture the kit grades `full`; Google's definition and signals are the benchmark for whether the kit could tell a soft 404 from the page asked for. | CLOSED | E-10: a soft 404 is a 2xx response whose content suggests an error, is an empty page, or is an error message - Google processes 2xx content and lets Search Console flag it afterwards, whereas any 4xx except 429 tells the next system the content does not exist. The page no longer has a `#soft-404-errors` section; the longer signal list is on the Search Console help page it links, not captured (brief, known unknowns). |
| U-7 | Per the WARC 1.1 specification and Common Crawl's get-started page (D-5, D-15): what does an archive record hold for a fetched response, and how is a truncated body recorded (the `WARC-Truncated` header and its reasons)? | The kit's ledger records a fetch and its body hash and grades completeness `full \| partial`; an archive format that keeps the whole protocol response and marks truncation with a named reason is the benchmark for what the ledger and the grade should carry. | CLOSED | E-13, E-12: a WARC response record holds the full HTTP response including headers, with no condition on the status code; any record may carry `WARC-Truncated` with reason `length`, `time`, `disconnect` or `unspecified`, and a truncated response shall carry it while Content-Length reports the truncated size. Common Crawl stores the raw response with its headers as WARC response, request and metadata records and the extracted text as WET. |
| U-8 | Per Common Crawl's own pages (D-15): does the published crawl keep non-200 responses and challenge pages as records, or drop them? | Whether a public web archive keeps a 404 or a challenge page as a record (with its status) or discards it is the benchmark for whether the kit's ledger should record a refused fetch as a capture or as a failure; a wrong guess changes what the ledger means. | KNOWN-UNKNOWN | Not on the captured FAQ (E-11) or get-started (E-12) pages: neither says whether non-200 responses are written to the WARC, and neither mentions challenge pages. Day one: read the Common Crawl index documentation for the `status` / `fetch_status` field of the columnar index (https://commoncrawl.org/blog/index-to-warc-files-and-urls-in-columnar-format) and one crawl's release notes; if the index carries a status column with non-200 values, the crawl keeps them. One page, not collected here because the 16-scrape budget was spent. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

None. The lead set the intent, the seven unknowns and the owner pages; every remaining
question is a fact on a public page.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- This is a nested decision project (ADR-0030); it writes nothing outside its own folder
  except its row in `docs/decisions/README.md` (ADR-0102), which the lead adds.
- Budget: at most 16 scrapes and 3 searches on the metered transport (Firecrawl CLI 1.25.3);
  no `--fallback`.
- The review is the agent's (ADR-0107): the brief is authored and declared `Reviewed by: agent`.
- The kit is feature-frozen (ADR-0117); this project judges nothing and changes nothing.
