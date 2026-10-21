# Brief - How content extractors grade their output, how web tools read PDFs, and how challenge pages and soft 404s are detected, as a benchmark for Fetchproof's converter, completeness grade and capture acceptance

_Auto-drafted 2026-10-04 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
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

## What we verified

| Claim | Source | Type |
|---|---|---|
| trafilatura 2.3.0's `extract()` is a cascade with a self-check on its own output: it [quote: runs Trafilatura's own rule-based extractor, then falls back to readability and jusText if the result is too short]. Two presets move the trade-off: `favor_precision` means [quote: Comments are pruned more aggressively, link-heavy sections are discarded, and fallback stages are skipped.]; `favor_recall` means [quote: Lists inside discarded sections are kept, text tails are preserved, and link density thresholds are relaxed.]. `fast=True` skips the fallbacks. A readerability guess is exposed separately: `is_probably_readerable()` (ported from Readability.js) [quote: provides a way to guess if a page probably has a main text to extract]. Metadata: `bare_extraction` [quote: returns a Document object with metadata as string attributes (.title, .author, .text, .comments, etc.)]; `only_with_metadata=True` will [quote: only output documents featuring all essential metadata (date, title, url)] and otherwise discards the document - the example shows [quote: content discarded since necessary metadata couldn't be extracted]. Dates come from an external module: [quote: dates are handled by an external module: htmldate. By default, focus is on original dates and the extraction replicates the fast option.], with `extensive_search`, `original_date` and `max_date` as parameters. | E-01 `trafilatura.readthedocs.io` (U-1) | P |
| trafilatura's own benchmark (results dated 2026-10-02, [quote: 990 documents, 2951 text & 2966 boilerplate segments, Python 3.13]) scores extractors on segments chosen as boilerplate versus text: [quote: Decisive document segments are singled out which are not statistically representative but very significant in the perspective of working with the texts]. The table puts the converters that keep everything at a precision near one half - html2text 2025.4.15 at 0.525 precision and 0.900 recall, and raw HTML at 0.528 precision - against readability-lxml 0.9 at 0.892 precision and 0.817 recall, justext 3.0.2 (custom) at 0.864 and 0.859, and trafilatura 2.3.0 (standard) at 0.906 and 0.946; its precision preset reaches 0.924 and its recall preset 0.942 recall. The page also records that [quote: justext is highly configurable and tweaking its configuration (as it is done here) can lead to better performance than its generic settings] and that [quote: Rule-based approaches such as trafilatura's obtain balanced results despite a lack of precision]. For the kit, the half-precision rows are the benchmark for a converter that keeps the whole body: on this test set about half of what such a converter keeps is boilerplate. | E-02 `trafilatura.readthedocs.io` (U-1) | P |
| htmldate, the module trafilatura uses for dates, is built to [quote: Find original and updated publication dates of any web page.] because [quote: It is often not possible to do it using just the URL or the server response.]. It works in three stages: header markup - [quote: Markup in header: Common patterns are used to identify relevant elements (e.g. link and meta elements) including Open Graph protocol attributes and a large number of CMS idiosyncrasies] - then structural markers in the HTML (`abbr`, `time`, attributes such as `postmetadata`), then text heuristics, where [quote: in extensive mode all potential dates are collected and a disambiguation algorithm determines the most probable one]. [quote: The output is thoroughly verified in terms of plausibility and adequateness.] and the result is either the last update or the original publication (the default). So a reference extractor distinguishes published from updated dates and derives them from the page, not from the fetch - neither of which the kit's evidence row records beside its retrieval date. | E-03 `htmldate.readthedocs.io` (U-1) | P |
| Mozilla Readability's README documents two thresholds. For the parser: [quote: charThreshold (number, default 500): the number of characters an article must have in order to return a result.]. For the pre-check `isProbablyReaderable(document, options)`: [quote: minContentLength (number, default 140): the minimum node content length used to decide if the document is readerable;] and [quote: minScore (number, default 20): the minimum cumulated 'score' used to determine if the document is readerable;]; [quote: The function returns a boolean corresponding to whether or not we suspect Readability.parse() will succeed at returning an article object.] and the README warns [quote: It is likely to produce both false positives and false negatives.]. `parse()` returns `title`, `content`, `textContent`, [quote: length: length of an article, in characters;], [quote: excerpt: article description, or short excerpt from the content;], [quote: byline: author metadata;], `dir`, [quote: siteName: name of the site;], `lang` and [quote: publishedTime: published time;]; for metadata [quote: Readability gives precedence to Schema.org fields specified in the JSON-LD format]. The README does not state what `parse()` returns when the threshold is not met (the null case the lead asked about); that is in `Readability.js`, not on the captured page. | E-04 `github.com` (U-2) | P |
| The jusText algorithm page (by its authors at corpus.tools, last modified 2015) gives the classification the lead asked for. Blocks are split on block-level tags; the observations are [quote: Short blocks which contain a link are almost always boilerplate.] and [quote: Long blocks which contain grammatical text are almost always good whereas all other long block are almost always boilerplate.], where grammaticality is a stop-word proportion: [quote: The stop words density is the proportion of stop list words (the text is tokenized into "words" by splitting at spaces).]. Preprocessing drops header, style and script content, and [quote: The contents of <select> tags are immediately labeled as bad (boilerplate). The same applies to blocks containing a copyright symbol (©).]. Context-free classification assigns four classes - bad, good, [quote: short -- too short to make a reliable decision about the class] and [quote: near-good -- somewhere in-between short and good] - from five parameters with defaults MAX_LINK_DENSITY 0.2, LENGTH_LOW 70, LENGTH_HIGH 200, STOPWORDS_LOW 0.30 and STOPWORDS_HIGH 0.32: [quote: The former two set the thresholds for dividing the blocks by length into short, medium-size and long. The latter two divide the blocks by the stop words density into low, medium and high.]; only a long block with high stop-word density is good, and medium or long blocks with low density are bad. Context-sensitive classification then resolves short and near-good blocks from their neighbours, and [quote: If all the blocks in the sequence are short (there is no near-good block) they are all classified as bad.]; document edges are treated as bad. | E-06 `corpus.tools` (U-3) | P |
| The jusText repository README states the purpose and the unit of judgement: [quote: Program jusText is a tool for removing boilerplate content, such as navigation links, headers, and footers from HTML pages.], and it is [quote: designed to preserve mainly text containing full sentences and it is therefore well suited for creating linguistic resources such as Web corpora]. The API classifies per paragraph - the usage example filters on [quote: if not paragraph.is_boilerplate:] - and the README links the algorithm description (doc/algorithm.rst; the author's own page is E-06). This is a fork of the original Google Code project, with C++, Go and Java ports listed. | E-05 `github.com` (U-3) | P |
| Firecrawl's scrape feature page: a PDF URL is parsed to markdown by default - [quote: /scrape auto-detects PDFs, DOCX, and other document types from URLs. Pass a PDF URL the same way you would any webpage — Firecrawl parses it and returns clean markdown.] - and the cost is per page: [quote: PDF parsing costs 1 credit per PDF page] on top of the scrape's 1 credit. The page also separates two status layers, which is the benchmark for the kit's acceptance of a 200: [quote: An accepted and processed request returns HTTP 200 with success: true, even if the target page underneath returned a non-2xx code.]; the page's own status is `data.metadata.statusCode`, and [quote: Firecrawl treats a statusCode of 2xx or 304 as a clean page load; anything else means the page did not load cleanly.]; [quote: When a page returns an error status, data.metadata.error may carry additional detail.]. Firecrawl documents no content-based check of the page - a challenge page or a soft 404 served with 200 is a clean load by this rule. | E-07 `docs.firecrawl.dev` (U-4) | P |
| The scrape API reference defines the `parsers` body parameter: [quote: When "pdf" is included (default), the PDF content is extracted and converted to markdown format, with billing based on the number of pages (1 credit per page).] and [quote: When an empty array is passed, the PDF file is returned in base64 encoding with a flat rate of 1 credit for the entire PDF.]. So on the metered transport a 60-page statute costs 60 credits as markdown or 1 credit as base64 bytes. The reference also lists proxy tiers for bot-walled sites - [quote: Enhanced proxies for scraping sites with advanced anti-bot solutions.] - billed at the basic cost, and `maxAge` 1000..300000 ms for cache reuse. The `maxPages` cap is not on this page; it is on the parse and advanced-guide pages (E-14, E-16). | E-08 `docs.firecrawl.dev` (U-4) | P |
| Firecrawl's parse feature page (found by the plan's one search; Firecrawl's own documentation, so P) carries the PDF limits and cost: [quote: PDF parsing is billed at 1 credit per page; the pages, blocks, and pageMarkers options add no cost.]; `maxPages` will [quote: Cap the number of pages to parse.]; and the response makes truncation visible: [quote: numPages is the number of pages actually parsed; totalPages is the document's true page count.] [quote: so totalPages > numPages tells you the output was truncated. totalPages is omitted when the page count can't be determined.]. Image-only pages are handled: [quote: Scans included: native text extraction with OCR fallback for image-only pages]. Supported inputs are PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, CSV and HTML. For the kit's `completeness` grade, this is a vendor reporting partiality as two numbers rather than a word. | E-14 `docs.firecrawl.dev` (U-4) | P |
| Firecrawl's advanced scraping guide (found by the plan's one search on its second run; Firecrawl's own documentation, so P) adds the PDF parser's options: [quote: Firecrawl supports PDFs. Use the parsers option] with a `mode` of fast, auto or ocr and a page cap, as in [quote: { "type": "pdf", "mode": "fast", "maxPages": 50 }]; an empty `parsers` array is [quote: to skip parsing and return base64 (1 credit flat).]; and browser actions do not apply: [quote: Actions are not supported for PDFs. If the URL resolves to a PDF the request will fail.]. Consistent with E-07, E-08 and E-14 on the per-page credit. | E-16 `docs.firecrawl.dev` (U-4) | P |
| Cloudflare's own detection rule for automated clients (page last updated May 5, 2026): [quote: the Challenge Page response (regardless of the Challenge Page type) will have the cf-mitigated header present and set to challenge]; [quote: For the cf-mitigated header, challenge is the only valid value. The header is set for all Challenge Page types.]; and [quote: This header provides a reliable way to identify whether a response is a Challenge or not]. The example reads `response.headers.get("cf-mitigated") === "challenge"`. The page does not state the HTTP status code a challenge response carries, so the header, not the status, is the documented signal; a collector that keeps only the body and the status cannot apply it. | E-15 `developers.cloudflare.com` (U-5) | P |
| The Cloudflare challenges landing page (a 2.4 KB capture, graded `full` by the kit because the page is that short) defines the mechanism: [quote: Challenges are security mechanisms used by Cloudflare to verify whether a visitor to your site is a real human and not a bot or automated script.] and [quote: Most visitors will pass Challenges automatically without interaction.]. It names no detection method or status code itself; its navigation links the page that does, challenge-types/challenge-pages/detect-response/ (E-15). The path the lead named, .../detect-challenge-page/, answered HTTP 404 on 2026-10-04 and the kit refused it as evidence (ledger seq 10). | E-09 `developers.cloudflare.com` (U-5) | P |
| Google Search Central defines a soft 404 by the content of a 2xx response, not its status: for 2xx, [quote: Google considers the content for processing (for example, in the case of Google Search, for indexing).] and [quote: If the content suggests an error for Google Search, an empty page or an error message, Search Console will show a soft 404 error.]. The general rule is [quote: If the server responded with a 2xx status code, the content received in the response may be considered for indexing.], while for real errors [quote: All 4xx errors, except 429, are treated the same:] [quote: Google crawlers inform the next processing system that the content doesn't exist.]. The three signals on this page are therefore: content that suggests an error, an empty page, and an error message. The page no longer carries a `#soft-404-errors` section; the detailed Search Console signal list is on the help page it links (support.google.com/webmasters/answer/7440203), which is not in this corpus. | E-10 `developers.google.com` (U-6) | P |
| The WARC 1.1 specification records truncation explicitly: [quote: Any record may indicate that truncation of its content block has occurred and give the reason with a WARC-Truncated field.], with four reason tokens - `length` (exceeds configured max length), `time` (exceeds configured max time), `disconnect` (network disconnect) and `unspecified` (other/unknown reason) - and [quote: Other reasons may be defined in extensions of the core format.]. For responses: [quote: When a 'response' is known to have been truncated, this shall be noted using the WARC-Truncated field.], and [quote: The WARC-Truncated field may be used on any WARC record. The WARC Content-Length field shall still report the actual truncated size of the record block.]. A response record holds the protocol message whatever its status: [quote: a 'response' record block should contain the full HTTP response received over the network, including headers], and the specification warns that [quote: neither the use of the 'response' record with a 'http' target-URI nor the 'application/http' content-type serves as an absolute guarantee that the contained material is a legal HTTP response.]. No clause conditions a response record on a 2xx status. | E-13 `iipc.github.io` (U-7) | P |
| Common Crawl's get-started page describes what a record holds: [quote: Not only does the format store the HTTP response from the websites it contacts (WARC-Type: response), it also stores information about how that information was requested (WARC-Type: request) and metadata on the crawl process itself (WARC-Type: metadata).] and [quote: For the HTTP responses themselves, the raw response is stored. This not only includes the response itself, (what you would get if you downloaded the file) but also the HTTP header information, which can be used to glean a number of interesting insights.]. Beside the WARC, [quote: WET files which store extracted plaintext from the data stored in the WARC] carry the text and WAT files the computed metadata. The page's example record is a 200 response; it does not state whether non-200 or challenge responses are written, nor how truncation is marked (U-8). | E-12 `commoncrawl.org` (U-7) | P |

## Contradictions and how they were resolved

- **Cloudflare's detection page moved.** The path the lead named
  (`.../challenge-pages/detect-challenge-page/`) answered HTTP 404 on 2026-10-04; the kit
  refused the error page as evidence (ledger seq 10) and the landing page's own navigation
  (E-09) links the current owner, `.../challenge-pages/detect-response/` (E-15). Resolved by
  re-targeting; the failed fetch stays in the ledger as a failure, not a capture. Not a
  contradiction between sources - a stale URL.
- **Cloudflare documents a header, not a status code.** The lead's question assumed a
  documented status for a challenge response. Neither captured Cloudflare page states one;
  E-15 says the signal is `cf-mitigated: challenge`, "regardless of the Challenge Page type".
  Trusted: the page. The status code is a known unknown below, and it does not change the
  benchmark - a collector that discards response headers cannot apply Cloudflare's own rule
  whatever the status is.
- **Google's soft-404 anchor is gone.** The lead's URL carried `#soft-404-errors`; the live
  page (E-10) has no such section and defines a soft 404 in one sentence under 2xx, linking
  the Search Console help page for the rest. Trusted: the captured sentence, which is the
  definition; the longer signal list is a known unknown below.
- **Firecrawl's PDF cost appears on four pages and agrees.** E-07 ("1 credit per PDF page"),
  E-08 ("1 credit per page", empty `parsers` = 1 credit flat for base64), E-14 and E-16 say
  the same; `maxPages` is on E-14 and E-16 only, not on the API reference (E-08). No
  contradiction; noted so the audit cites the page that owns each option.
- **Readability's null return is not on the README.** E-04 documents `charThreshold` (500
  characters "in order to return a result") but not what `parse()` returns otherwise. The
  README is the owner page the lead named; the sentence is in `Readability.js`. Recorded as
  a known unknown rather than asserted from memory.
- **Common Crawl's pages do not answer the non-200 question.** The FAQ (E-11) and
  get-started (E-12) describe robots, redirects, back-off and the WARC record types, and
  never say whether a 404 or a challenge page is written to the crawl. U-7 was narrowed to
  what the pages own (record shape, truncation per the WARC specification, E-13) and the
  unanswered half became U-8, KNOWN-UNKNOWN, with its day-one step.
- **Preflight's four corroboration warnings** (U-2 and U-6 single-source, U-4 and U-5
  one-voice) are accepted: each fact's owner is one project or vendor, and a second reading
  would be a write-up ranked below the owner (Rule 4). The warnings stand.

## Known unknowns

- **U-8** - Per Common Crawl's own pages (D-15): does the published crawl keep non-200 responses and challenge pages as records, or drop them?
  - Known so far: Not on the captured FAQ (E-11) or get-started (E-12) pages: neither says whether non-200 responses are written to the WARC, and neither mentions challenge pages.
  - Day-one verification: read the Common Crawl index documentation for the `status` / `fetch_status` field of the columnar index (https://commoncrawl.org/blog/index-to-warc-files-and-urls-in-columnar-format) and one crawl's release notes; if the index carries a status column with non-200 values, the crawl keeps them. One page, not collected here because the 16-scrape budget was spent.
- **The HTTP status code of a Cloudflare challenge response.** Not on E-09 or E-15. Day one:
  issue one request to a URL known to be challenged and read the status line beside the
  `cf-mitigated` header, or capture Cloudflare's WAF "challenge" action reference. One
  observation; the documented signal is the header either way.
- **Google's full soft-404 signal list.** E-10 gives three (content suggesting an error, an
  empty page, an error message) and links `https://support.google.com/webmasters/answer/7440203`
  for Search Console's list. Day one: capture that page. One page.
- **What `Readability.parse()` returns under `charThreshold`.** The README (E-04) does not
  say. Day one: read `Readability.js` in the mozilla/readability repository for the return
  path when no candidate reaches the threshold. One file.

## Decision

Nothing is built from this project; it is the benchmark the gap audit cites, and the kit is
feature-frozen (ADR-0117). The decision is the table below and the three answers under it.
The first step is the audit lead's reading, not a builder's.

### The benchmark table

| Area | Reference does | Kit mechanism it benchmarks | Rows |
|---|---|---|---|
| Extraction confidence | trafilatura: own extractor first, readability and jusText as fallbacks when the result is too short; `favor_precision` prunes link-heavy sections and skips fallbacks, `favor_recall` relaxes link-density thresholds; `is_probably_readerable()` exposed; `only_with_metadata` discards a document without date, title and url. Readability: `isProbablyReaderable` from nodes of 140+ characters reaching score 20, `parse()` needs 500 characters to return a result. jusText: four classes per block from length (70, 200), link density (0.2) and stop-word density (0.30, 0.32); a run of short blocks is boilerplate; edges are boilerplate | the kit's HTML-to-markdown converter, which keeps the body it is given and has no "too short", "too link-dense" or "too few stop words" rule; trafilatura's benchmark puts a keep-everything converter at about 0.53 precision (E-02) | E-01, E-02, E-04, E-05, E-06 |
| Metadata beside the body | trafilatura: title, author, date, url, sitename and more; htmldate separates original from updated date and derives it from header markup, structural markers, then text. Readability: title, byline, excerpt, siteName, publishedTime, length, lang, dir, preferring JSON-LD | the evidence row's `Retrieved` column, the only date it records; no title, author, published or modified date is recovered from the page | E-01, E-03, E-04 |
| Non-HTML sources (PDF) | Firecrawl: a PDF URL is parsed to markdown by default (`parsers: ["pdf"]`), billed 1 credit per page on top of the scrape; `maxPages` caps the pages and the response reports `numPages` against `totalPages`; empty `parsers` returns base64 for 1 credit; modes fast, auto, ocr; actions fail on PDFs | the metered transport inherits all of this through the CLI, so a PDF statute is collectable keyed, at one credit a page; what the keyless transport does with `application/pdf` is a kit question this corpus does not answer (it benchmarks the vendor, not the kit) | E-07, E-08, E-14, E-16 |
| Challenge pages | Cloudflare: every Challenge Page response carries `cf-mitigated: challenge`, the only valid value, for all challenge types; status code not documented | the kit's acceptance of a fetch by status and body: a capture that keeps no response headers cannot apply the one signal Cloudflare documents | E-15, E-09 |
| Soft 404s | Google: a 2xx response whose content suggests an error, is empty, or is an error message is a soft 404; 4xx other than 429 means the content does not exist | the kit's acceptance of any HTTP 200 body as a capture, with no content check; the three signals are content-level, and two of them (empty page, error message) are checkable without a search engine | E-10 |
| What an archive keeps and how it marks truncation | WARC 1.1: a response record holds the full HTTP response including headers, no condition on status; any record may carry `WARC-Truncated` with reason `length`, `time`, `disconnect` or `unspecified`, and Content-Length reports the truncated size. Common Crawl stores raw responses with headers as response, request and metadata records; Firecrawl reports PDF truncation as `numPages` versus `totalPages` | the ledger entry (URL, body hash, transport, `completeness: full` or `partial` with what was omitted) and the capture, which keeps the body and the status but not the headers; the grade is a word where WARC gives a reason token and Firecrawl two numbers | E-13, E-12, E-14 |

### The three audit questions, answered from the evidence

1. **Would a boilerplate-only capture be graded `full`?** The grade means "nothing omitted
   by the transport", not "there is content here"; none of the references' tests (too
   short, readerable, stop-word density) is applied. On trafilatura's benchmark a converter
   that keeps everything is at about 0.53 precision (E-02), and Readability refuses to
   return an article under 500 characters (E-04). A navigation-only page is `full` to the
   kit and nothing to the references.
2. **Would a PDF statute be uncollectable keyless?** Keyed, no: Firecrawl parses it at one
   credit a page with a page cap and reports truncation (E-07, E-08, E-14). Keyless, the
   corpus does not say what the kit's own transport does with a PDF body; that is a reading
   of the kit's code, not a fact a vendor page owns, and it is out of scope here.
3. **Would a challenge page be cited as evidence?** Cloudflare's documented signal is a
   response header (E-15); Google's soft-404 signals are content-level (E-10); Firecrawl
   itself treats any 2xx or 304 as a clean load with no content check (E-07). A capture
   that records status and body only has neither signal available to it.

### First step for the audit

Read the six kit mechanisms in the third column against the second and write down, for
each, which of three things is true: the kit already conforms, the kit differs on purpose
(cite the ADR), or the kit has a gap. The known unknowns above name the one page or file
per area still worth reading before a gap is declared. Out of scope: any change to the
kit - the freeze (ADR-0117) stands, and a gap found here enters through an ADR.

## Next steps

1. The TODO sections are answered (Reviewed by: agent, ADR-0107).
2. Hand this file to the gap-audit lead (phase 2 here is the audit's reading, not a build).
   Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"` redrafts this file while it
   is unedited; after any edit it refuses without `--force`, so your judgements are preserved.
<!-- fetchproof:brief-draft body=57a2a1673606792f inputs=2248490c366c8ea3 gate=pass -->
