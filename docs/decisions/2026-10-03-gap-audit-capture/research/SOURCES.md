# Sources

Every page this project has fetched, and what it was used for. `P` primary/official
carries the design, `S` secondary is context, `L` lead-only is a hint and never proof.

| URL | Type | Title | Retrieved | Used for |
|---|---|---|---|---|
| https://www.w3.org/TR/annotation-model/ | P | Web Annotation Data Model | 2026-10-03 | U-1: the Text Quote Selector (exact, prefix, suffix) as the W3C Recommendation defines it; re-fetched through Firecrawl because the phase-0 keyless capture is graded partial |
| https://w3c.github.io/web-annotation/model/fpwd/ | S | Web Annotation Data Model | 2026-10-03 | phase 0: What do web-capture, annotation and HTTP standards require of a faithful, re-anchorable and current capture, as a benchmark for Fetchproof's captures |
| https://web.hypothes.is/blog/fuzzy-anchoring/ | P | Fuzzy Anchoring : Hypothesis | 2026-10-03 | U-1: Hypothesis's own description of fuzzy anchoring - quote, prefix/suffix context, position, and the tolerance it accepts |
| https://raw.githubusercontent.com/hypothesis/client/main/src/annotator/anchoring/match-quote.ts | P | match-quote-ts | 2026-10-03 | U-1: the anchoring package's quote matcher in the hypothesis/client source - the algorithm and its error tolerance |
| https://html.spec.whatwg.org/multipage/parsing.html | P | HTML Standard | 2026-10-03 | U-2: 'determining the character encoding' and the prescan algorithm, as the WHATWG HTML Standard defines them |
| https://encoding.spec.whatwg.org/ | P | Encoding Standard | 2026-10-03 | U-2: the BOM rule ('BOM sniff') and the decode algorithm in the Encoding Standard |
| https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/ | P | The WARC Format | 2026-10-03 | U-3: WARC 1.1 record types, WARC-Date, WARC-Payload-Digest and the response record's Content-Type |
| https://specs.webrecorder.net/wacz/latest/ | P | Web Archive Collection Zipped (WACZ) | 2026-10-03 | U-3: what WACZ adds - datapackage.json, datapackage-digest.json and pages.jsonl |
| https://www.rfc-editor.org/rfc/rfc9111 | P | RFC 9111: HTTP Caching \| RFC Editor | 2026-10-03 | U-4: HTTP caching - freshness, validation with If-None-Match and If-Modified-Since, and 304 handling |
| https://www.rfc-editor.org/rfc/rfc9110 | P | RFC 9110: HTTP Semantics \| RFC Editor | 2026-10-03 | U-4: HTTP semantics - Last-Modified, ETag, Date and the conditional request fields |
| https://www.rfc-editor.org/rfc/rfc9309 | P | RFC 9309: Robots Exclusion Protocol \| RFC Editor | 2026-10-03 | U-5: the Robots Exclusion Protocol - group matching, rule evaluation, and how a 4xx or 5xx robots.txt is treated |
| https://github.com/hypothesis/anchoring-test-tools | S | GitHub - hypothesis/anchoring-test-tools: Tools for testing annotation anchoring with different documents and Hypothesis client environments · GitHub | 2026-10-03 | U-1: how Hypothesis re-anchors a quote on changed text, in its own words |
| https://web.hypothes.is/help/the-contents-of-a-web-page-i-annotated-changed-and-my-annotations-are-gone-what-can-i-do/ | S | The contents of a web page I annotated changed and my annotations are gone. What can I do? : Hypothesis | 2026-10-03 | U-1: how Hypothesis re-anchors a quote on changed text, in its own words |
| https://www.firecrawl.dev/glossary/web-crawling-apis/what-is-robots-txt-protocol | S | What is the robots.txt protocol? \| Firecrawl Glossary | 2026-10-03 | U-5: whether Firecrawl's documentation says its scrape honours robots.txt |
| https://www.firecrawl.dev/glossary/web-crawling-apis/how-does-a-web-crawler-work | S | How does a web crawler work? \| Firecrawl Glossary | 2026-10-03 | U-5: whether Firecrawl's documentation says its scrape honours robots.txt |
| https://www.firecrawl.dev/ | P | Firecrawl \| Web Data API for AI Agents | 2026-10-03 | U-5: Firecrawl's own FAQ on its home page - the robots.txt statement and the 'FirecrawlAgent' user-agent it names |
| https://docs.firecrawl.dev/api-reference/endpoint/scrape | P | Scrape - Firecrawl Docs | 2026-10-03 | U-5: the scrape endpoint's parameters - whether a robots.txt option exists on scrape at all |
| https://docs.firecrawl.dev/api-reference/endpoint/crawl-post | P | Crawl - Firecrawl Docs | 2026-10-03 | U-5: the crawl endpoint's ignoreRobotsTxt and robotsUserAgent parameters and their defaults |
| https://raw.githubusercontent.com/firecrawl/firecrawl/main/README.md | P | readme-md | 2026-10-03 | U-5: the vendor README's statement that Firecrawl respects robots.txt by default |
| https://web.hypothes.is/blog/showing-orphaned-annotations/ | S | Showing Orphaned Annotations : Hypothesis | 2026-10-03 | U-1: how Hypothesis re-anchors a quote on changed text, in its own words |
| https://web.hypothes.is/blog/stay-connected-to-every-annotation-with-unanchored-annotations/ | S | Stay Connected to Every Annotation with Unanchored Annotations : Hypothesis | 2026-10-03 | U-1: how Hypothesis re-anchors a quote on changed text, in its own words |
| https://www.quora.com/Do-web-crawlers-have-any-legal-obligation-to-respect-robots-txt | S | Do web crawlers have any legal obligation to respect robots.txt? - Quora | 2026-10-03 | U-5: whether Firecrawl's documentation says its scrape honours robots.txt |
| https://dzone.com/articles/respecting-robotstxt-in-web-scraping-1 | S | Respecting robots.txt in Web Scraping | 2026-10-03 | U-5: whether Firecrawl's documentation says its scrape honours robots.txt |
