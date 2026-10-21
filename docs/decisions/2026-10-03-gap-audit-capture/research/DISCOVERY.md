# Discovery Contract - What do web-capture, annotation and HTTP standards require of a faithful, re-anchorable and current capture, as a benchmark for Fetchproof's captures

Started 2026-10-03. This file is the definition of "enough information to build".
`node "/root/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Benchmark Fetchproof's capture fidelity against the standards and tools below. A
decision about this repository (ADR-0030), feeding the 2026-10-03 gap audit of the kit:
the lead reads this brief as evidence for what a faithful (bytes and encoding), re-anchorable
(a quotation that can be found again after the page changes) and current (revalidated
rather than assumed fresh) capture requires, and compares it with what `research/raw/`,
the ledger and the quote-anchor check (ADR-0087) actually record. The benchmark is five
published standards and two tools: the W3C Web Annotation Data Model and Hypothesis's
anchoring for re-anchoring; the WHATWG HTML and Encoding standards for character-encoding
determination; WARC 1.1 and WACZ for what an archival capture records and how it is
verified; RFC 9110 and RFC 9111 for revalidation and currency; RFC 9309 and Firecrawl's
own documentation for robots.txt. Done means each unknown below is closed from the
page that owns the fact, with a quotation the gate can find in the capture, and
`research/BRIEF.md` names, per standard, what the kit records today and what it does not.
No product code is written here; the gap audit decides what, if anything, changes.

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
| U-1 | How does the W3C Web Annotation Data Model's TextQuoteSelector anchor a quotation (exact, prefix, suffix), and how does Hypothesis re-anchor a quote when the page text has changed (fuzzy matching, tolerance)? | The kit's quote anchor (ADR-0087) is an exact substring test against one capture; whether a benchmark anchor carries context (prefix, suffix) and tolerates edits decides whether the kit's anchor is a subset of the standard or a different thing. | CLOSED | E-03, E-04, E-05, E-14, E-21, E-22: the W3C anchor is exact + prefix + suffix over normalized text (exact mandatory, context recommended); Hypothesis stores 32-character prefix/suffix plus a position and re-anchors in four strategies ending in a fuzzy search that allows up to min(256, length/2) edits, scoring quote, prefix, suffix and position; text that is gone orphans the annotation. The kit's anchor is the exact part alone, with zero tolerance and no context. |
| U-2 | Per the WHATWG HTML Standard, how is a document's character encoding determined when the HTTP header names none - the BOM, the prescan for a meta charset, and the default (windows-1252 for most locales) - and what does the Encoding Standard say about the BOM? | A capture decoded with the wrong encoding is a faithful copy of the wrong text; the kit's keyless transport decodes bytes itself, and the order of the rules (BOM first, then header, then meta, then default) is what it has to be measured against. | CLOSED | E-06, E-07: the order is BOM (certain), then the transport-layer charset (certain), then a meta-charset prescan of the first 1024 bytes (tentative), then parent/history/autodetect, then the locale default, windows-1252 for all other locales; the Encoding Standard makes the BOM more authoritative than the Content-Type header. |
| U-3 | What does WARC 1.1 require for a captured HTTP response - the record types (warcinfo, request, response, metadata), WARC-Date semantics, WARC-Payload-Digest, and the response record's Content-Type - and what does WACZ add for verification (the datapackage digest, pages.jsonl)? | The kit exports WARC (ADR-0090) and keeps its own ledger; what the archival formats record per capture (the request as well as the response, the capture instant, a payload digest, a package-level digest) is the list the kit's ledger is benchmarked against. | CLOSED | E-08, E-09: WARC 1.1 keeps a request record and a response record per capture (eight types in all), a mandatory WARC-Date that is the capture instant, a Content-Type of application/http; msgtype=response describing the whole archived message, and an optional WARC-Payload-Digest naming its algorithm; WACZ adds pages.jsonl (url, ts), a datapackage.json listing every file with a sha256 hash, and a datapackage-digest.json whose hash verifies the entire package. |
| U-4 | Per RFC 9111 and RFC 9110, how does a client revalidate a stored response (If-None-Match with ETag, If-Modified-Since with Last-Modified; 304 Not Modified), and what do Last-Modified and Date say about a page's currency? | The kit's refresh rule is a day count (`refreshDays`); the HTTP currency model is a validator and a conditional request, and whether the kit records ETag, Last-Modified and Date at capture decides whether a re-fetch can ask "has it changed?" instead of re-spending. | CLOSED | E-10, E-11, E-18: a client revalidates with If-None-Match (ETag) or If-Modified-Since (Last-Modified), If-None-Match taking precedence, and a 304 says the stored response is current; Last-Modified is the origin's belief of last change, ETag an opaque validator more reliable than a date, Date the message's origination time. Firecrawl's own scrape serves cached pages up to maxAge, 2 days by default. |
| U-5 | Per RFC 9309, what must an automated client do with robots.txt (which rules, which user-agent group, how 4xx and 5xx answers are treated), and does Firecrawl's documentation say whether its scrape respects robots.txt? | A capture taken against the publisher's crawl rules is evidence with a legality question attached (D-4); the kit fetches through Firecrawl and its own keyless client, and neither consults robots.txt today, so the standard's rule and the vendor's statement decide whether that is a gap. | CLOSED | E-12, E-17, E-18, E-19, E-20: RFC 9309 binds a crawler to its named group (else *), longest match wins, a 4xx robots.txt allows everything and a 5xx disallows everything. Firecrawl says it respects robots.txt by default (README) and, for crawl, the rules set for the FirecrawlAgent group (FAQ); crawl has an ignoreRobotsTxt switch (default false, enterprise only); the scrape endpoint documents no robots.txt option at all, so the vendor's statement about a single scrape is the README's general sentence, not an endpoint parameter. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- This project benchmarks; it changes nothing. The gap audit the lead runs decides what,
  if anything, is built, and the kit is feature-frozen (ADR-0117): any change goes through
  an ADR that lifts the freeze for that one item.
- The benchmark is read from the page that owns each fact (the specification or the
  vendor's own documentation), never from a write-up about it.
