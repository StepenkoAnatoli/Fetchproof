# Brief - What do web-capture, annotation and HTTP standards require of a faithful, re-anchorable and current capture, as a benchmark for Fetchproof's captures

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

## What we verified

| Claim | Source | Type |
|---|---|---|
| The Text Quote Selector anchors a quotation by copying it and its immediate context: [quote: This Selector describes a range of text by copying it, and including some of the text immediately before (a prefix) and after (a suffix) it to distinguish between multiple copies of the same sequence of characters.] The exact property is mandatory and holds [quote: A copy of the text which is being selected, after normalization.]; the context is recommended and bounded: [quote: Each TextQuoteSelector SHOULD have exactly 1 prefix property, and MUST NOT have more than 1.] The copied text is normalized before it is recorded: [quote: The text MUST be normalized before recording in the Annotation. Thus HTML/XML tags SHOULD be removed, and character entities SHOULD be replaced with the character that they encode.] So the standard anchor is exact + prefix + suffix over normalized text; the kit's anchor (ADR-0087) is the exact part alone. | E-03 `w3.org` (U-1) | P |
| Hypothesis (2013, its own blog) stores a TextQuoteSelector whose context is fixed-width - the prefix is [quote: the (32-char long) text immediately before the selected text] - beside a TextPositionSelector, and re-anchors in four strategies in order: exact range, position, context-first fuzzy, selector-only fuzzy. The third [quote: This strategy can handle both structure and content changes. First, searching around the expected start position (as stored in the PositionSelector, if any), we try to locate the prefix (stored in the TextQuoteSelector), with a fuzzy search]; the fuzzy matcher is named: [quote: For the fuzzy text search and comparison, we are using a modified version of the google-diff-match-patch library, which uses the Bitap matching algorithm]. | E-04 `web.hypothes.is` (U-1) | P |
| The current hypothesis/client anchoring package (match-quote.ts) fixes the tolerance and the scoring: an approximate search allows up to half the quote's length in edits, capped - [quote: const maxErrors = Math.min(256, quote.length / 2);] - and each candidate is scored by the quote's error rate ([quote: const quoteScore = 1 - match.errors / quote.length;]) combined with prefix, suffix and position similarity (weights prefixWeight = 20, suffixWeight = 20), after which the code says [quote: Choose match with the highest score.]. The kit's quote check has tolerance zero: a changed page fails rather than re-anchors. | E-05 `raw.githubusercontent.com` (U-1) | P |
| Hypothesis's help page on changed pages, in the vendor's words: annotations whose text has gone become orphans - [quote: if the text to which they anchored has vanished, Hypothesis can no longer attach them.] Fuzzy anchoring tolerates edits, not deletion. | E-14 `web.hypothes.is` (U-1) | S |
| Hypothesis's own blog on orphans (2016): fuzzy anchoring [quote: which can cleverly locate the original annotated selection even if it or its surrounding context has changed slightly or been moved around.], and its limit: [quote: When annotations fail to anchor, we call them orphans]. Context for U-1. | E-21 `web.hypothes.is` (U-1) | S |
| Hypothesis's 2025 blog on unanchored annotations, which defines an orphan as [quote: an annotation that's lost the text it was originally anchored to on the page.] Context for U-1; the mechanism is E-04 and E-05. | E-22 `web.hypothes.is` (U-1) | S |
| The HTML Standard's encoding sniffing algorithm fixes the order when the header is silent. Step 1: [quote: If the result of BOM sniffing is an encoding, return that encoding with confidence certain.] Step 4: [quote: If the transport layer specifies a character encoding, and it is supported, return that encoding with the confidence certain.] Step 5 is the meta-charset prescan, bounded: [quote: User agents are therefore encouraged to use the prescan algorithm below (as invoked by these steps) on the first 1024 bytes, but not to stall beyond that.] The locale default table ends [quote: All other locales \| windows-1252], and decoding itself honours the BOM over the argument: [quote: A leading Byte Order Mark (BOM) causes the character encoding argument to be ignored and will itself be skipped.] | E-06 `html.spec.whatwg.org` (U-2) | P |
| The Encoding Standard's BOM rule: [quote: For compatibility with deployed content, the byte order mark is more authoritative than anything else. In a context where HTTP is used this is in violation of the semantics of the Content-Type header.] and, of labels generally, [quote: A byte order mark has priority over a label as it has been found to be more accurate]. A capture that decoded by the Content-Type header while a BOM said otherwise would be the wrong text. | E-07 `encoding.spec.whatwg.org` (U-2) | P |
| WARC 1.1 records an HTTP capture as a request record and a response record (plus warcinfo and metadata), among eight types: [quote: WARC-Type is the type of WARC record. Record types defined in this International Standard are:] warcinfo, response, resource, request, metadata, revisit, conversion, continuation. WARC-Date is mandatory and is the capture instant, not the write time: [quote: The timestamp shall represent the instant that data capture for record creation began.] and [quote: All records shall have a WARC-Date field.] The record's Content-Type for an HTTP message is application/http with msgtype=response or msgtype=request, and [quote: the content-type is not the value of the HTTP Content-Type header in a HTTP response but a MIME type to describe the full archived HTTP message]. The payload digest is optional and names its algorithm: [quote: A WARC-Payload-Digest is an optional parameter indicating the algorithm name and calculated value of a digest applied to the payload referred to or contained by the record, which is not necessarily equivalent to the record block.] | E-08 `iipc.github.io` (U-3) | P |
| WACZ (latest resolves to 1.1.1) wraps WARCs with a CDXJ index, a page list and a verifiable manifest: pages/pages.jsonl is mandatory, [quote: where each line MUST contain at least the following properties:] [quote: url - a URL for the page] and a ts RFC 3339 timestamp; datapackage.json lists every resource with a sha256 hash; and a datapackage-digest.json [quote: file SHOULD be included in the root of the WACZ to verify the datapackage.json manifest with a hash and thus for the entire contents of the WACZ.], carrying [quote: hash: a cryptographic hash for the datapackage.json file]. That is a package-level digest over per-file digests; the kit's ledger is a per-capture chain with no package digest. | E-09 `specs.webrecorder.net` (U-3) | P |
| RFC 9111 revalidates a stored response with the validators it stored: [quote: One such validator is the timestamp given in a Last-Modified header field], used in If-Modified-Since, and the entity tag used in If-None-Match; when both are sent, [quote: If-None-Match takes precedence over If-Modified-Since]. The answer that nothing changed is a 304: [quote: A 304 (Not Modified) response status code indicates that the stored response can be updated and reused]. Without Last-Modified, [quote: a cache SHOULD use the stored response's Date field value (or, if no Date field is present, the time that the stored response was received) to evaluate the conditional.] A re-fetch that asks this question costs a header exchange, not a page. | E-10 `rfc-editor.org` (U-4) | P |
| RFC 9110 defines the three currency fields. Last-Modified: the [quote: header field in a response provides a timestamp indicating the date and time at which the origin server believes the selected representation was last modified]. ETag: [quote: An entity tag is an opaque validator for differentiating between multiple representations of the same resource], and [quote: An entity tag can be more reliable for validation than a modification date]. Date: the [quote: header field represents the date and time at which the message was originated]. A capture that keeps none of the three cannot say when the page last changed, only when it was fetched. | E-11 `rfc-editor.org` (U-4) | P |
| The scrape endpoint's body parameters (onlyMainContent, maxAge, skipTlsVerification, lockdown, and the rest) include no robots.txt option at all: the page has zero occurrences of the word. It does fix the vendor's own currency rule: maxAge defaults to 172800000 milliseconds, and [quote: Returns a cached version of the page if it is younger than this age in milliseconds. If a cached version of the page is older than this value, the page will be scraped. If you do not need extremely fresh data, enabling this can speed up your scrapes by 500%. Defaults to 2 days.] A default scrape may therefore be served from Firecrawl's cache up to two days old. | E-18 `docs.firecrawl.dev` (U-4, U-5) | P |
| RFC 9309 binds an automated client to the group that names it: [quote: Crawlers MUST use case-insensitive matching to find the group that matches the product token and then obey the rules of the group.] With no match, [quote: crawlers MUST obey the group with a user-agent line with the] * value, if present; rules are evaluated by longest match: [quote: The most specific match found MUST be used.] A 4xx robots.txt opens the site: [quote: If a server status code indicates that the robots.txt file is unavailable to the crawler, then the crawler MAY access any resources on the server.] A 5xx closes it: [quote: If the robots.txt file is unreachable due to server or network errors, this means the robots.txt file is undefined and the crawler MUST assume complete disallow.] | E-12 `rfc-editor.org` (U-5) | P |
| Firecrawl's home-page FAQ makes its robots statement about crawl, under the question [quote: Does Firecrawl support crawling entire sites?]: [quote: It also respects robots.txt rules set for the 'FirecrawlAgent' directive.] It names the user-agent group (FirecrawlAgent) a publisher would have to write to address it. | E-17 `firecrawl.dev` (U-5) | P |
| The crawl endpoint carries the robots switch, closed by default and not self-service: ignoreRobotsTxt (default false), described as [quote: Ignore the website's robots.txt rules. Enterprise only - contact support@firecrawl.com to enable.], beside a robotsUserAgent string. The option exists on crawl, not on scrape (E-18). | E-19 `docs.firecrawl.dev` (U-5) | P |
| The vendor README's statement, in its licence section: [quote: By default, Firecrawl respects robots.txt directives.] - preceded by [quote: It is the sole responsibility of end users to respect websites' policies when scraping.] The vendor claims a default and places the duty on the user. | E-20 `raw.githubusercontent.com` (U-5) | P |

## Contradictions and how they were resolved

- **Firecrawl and robots.txt - three statements, one endpoint silent.** The README says
  [quote: By default, Firecrawl respects robots.txt directives.] in general (E-20); the FAQ
  says it of `/crawl`, for rules [quote: set for the 'FirecrawlAgent' directive] (E-17); the
  crawl API reference carries the switch, `ignoreRobotsTxt`, default false and enterprise-only
  (E-19); the scrape API reference has no robots option and never uses the word (E-18). These
  do not contradict each other, but the most specific source - the endpoint the kit actually
  calls - says nothing. Trusted: the API references over the README, because a parameter is a
  behaviour and a licence-section sentence is a policy. What the kit can honestly say is "the
  vendor states a default, for crawl explicitly and for scrape only by the README's general
  sentence"; it cannot say that a single scrape consulted robots.txt.
- **BOM against Content-Type.** The Encoding Standard admits that honouring the BOM over the
  header [quote: is in violation of the semantics of the Content-Type header] (E-07), and the
  HTML Standard puts the BOM first anyway (E-06). Both standards resolve it the same way, for
  deployed content; the kit does too (`decoderFor`), so there is no gap on this point.
- **Hypothesis 2013 against Hypothesis now.** The blog (E-04) describes a diff-match-patch /
  Bitap matcher with 32-character prefix and suffix; the current client (E-05) uses
  `approx-string-match` with `maxErrors = Math.min(256, quote.length / 2)` and weighted
  scoring. The strategy order is the blog's; the tolerance figures are the source's. Trusted:
  the source for numbers, the blog for the design, and neither contradicts the W3C model (E-03).
- **`wacz/latest` is a floating pointer.** The URL resolved to 1.1.1 on 2026-10-03; the
  capture's own links name that version. A later reader checks the version before citing it.
- **One voice on U-2 (preflight warn).** Both encoding sources are WHATWG, which owns both
  standards; there is no second owner to cite. Accepted, not resolved.

## Known unknowns

None blocking. Two day-one verifications are named in the Decision: whether this
repository's Firecrawl captures are cache hits (`metadata.cacheState`), and whether the
FirecrawlAgent group is what a publisher's robots.txt would have to name for a scrape as
well as a crawl - the vendor's documentation says it only of crawl.

## What the kit records today, against each standard

Read from the kit's own code on 2026-10-03 (`lib/firecrawl.mjs`, `lib/runtime.mjs`,
`lib/http-transport.mjs`, the ledger of this project); these are the repository's facts, not
fetched evidence, and the audit should re-read the code before acting on them.

| Benchmark | The standard requires | The kit records or does | Gap |
|---|---|---|---|
| Re-anchoring (E-03, E-04, E-05) | exact + prefix + suffix over normalized text; a tolerant re-match scored on quote, context and position; a failed match is an orphan, not an error | `[quote: ...]` is an exact substring test after `normalizeForMatch` (NFKC, markup and whitespace folded); no prefix or suffix, tolerance zero, against one frozen capture | The kit's anchor is the standard's `exact` alone. Against a frozen capture that is sufficient; against a re-fetched or changed page it cannot re-anchor and cannot tell a moved sentence from a deleted one. |
| Character encoding (E-06, E-07) | BOM, then transport charset, then a meta-charset prescan of the first 1024 bytes, then the locale default (windows-1252) | `decoderFor`: UTF-8/UTF-16 BOM first, then the declared charset, with a valid-UTF-8 override for high bytes; no meta prescan; default UTF-8; a fallback reason is graded and recorded | Step 5 is missing: a page with no header charset and a `<meta charset>` naming a legacy encoding is decoded as UTF-8 and reads as U+FFFD; the ledger grades it only if the bytes are not valid UTF-8. Firecrawl captures arrive as markdown and skip the question. |
| Archival record (E-08, E-09) | request + response records, WARC-Date = capture instant, payload digest with a named algorithm, package digest over a per-file manifest | ledger entry: `seq, at, op, url, type, raw, bodySha256, transport, completeness, cmd, prev, entrySha256`; no request record, no response headers, no status beyond the capture header's `statusCode`; chain head but no package digest (`export-warc.mjs` writes response records only) | The ledger is a stronger chain than WARC's per-record digest and a weaker record: it keeps the text, not the HTTP message, so the response headers that currency and encoding rest on are gone at capture. |
| Currency (E-10, E-11, E-18) | ETag / Last-Modified / Date kept so a re-fetch can ask If-None-Match / If-Modified-Since and take a 304 | `refreshDays` (a day count) and `--force`; no validator kept; the Firecrawl adapter sends `scrape <url> --only-main-content --json` with no `--max-age`, and keeps `url, title, markdown, statusCode` from the CLI's JSON, dropping `metadata.cacheState` and `cachedAt`, which the kit's own 1.25.x fixtures show as `"cacheState":"hit"` | Two gaps. A re-fetch always pays for a page it could have revalidated. And a Firecrawl capture may be the vendor's cached copy up to two days old (`maxAge` default 172800000 ms) while the ledger's `at` reads as the fetch instant; the field that would say so is discarded. |
| Crawl rules (E-12, E-17 to E-20) | consult robots.txt for the named group (else `*`), longest match, 4xx allows, 5xx disallows | no transport reads robots.txt; the Firecrawl route relies on the vendor's stated default; the keyless and browser routes consult nothing | For the metered route the kit can cite the vendor's sentence; for its own two transports it cannot cite anything. Whether a research collector of single pages is a "crawler" under RFC 9309 is a legality question (D-4) the audit should put to the owner, not settle in code. |

## Decision

This project changes nothing; the kit is feature-frozen (ADR-0117), and the lead's gap audit
decides what, if anything, an ADR lifts the freeze for. In the order the evidence supports:

1. **First step - measure, do not build.** For five pages of this corpus, run
   `firecrawl scrape <url> --json` and read `metadata.cacheState` and `cachedAt`. If any is a
   hit, the currency gap is real for this repository's own corpora, not only in the vendor's
   docs; the number says how often. Record the five results in the audit. Cost: five credits.
2. **Record what is cheap to record.** The CLI already returns `cacheState`, `cachedAt` and
   `statusCode`; the keyless child already sees `ETag`, `Last-Modified` and `Date`. Keeping
   them in the capture header and the ledger entry is a change to what an entry holds and
   needs an ADR; it spends nothing and makes the `at` field honest.
3. **Weigh, do not adopt, the rest.** A prefix/suffix anchor (W3C) and a tolerant re-match
   (Hypothesis) answer a question the kit does not yet ask - re-anchoring against a changed
   page - because the kit anchors against a frozen capture. A meta-charset prescan closes a
   decoding hole only for legacy pages reached keyless. A robots.txt reader is a legality
   decision first. Each is an ADR with a trigger, not a task.

Out of scope: any change to `fetchproof/`, any new check in preflight, and any claim that a
Firecrawl scrape consulted robots.txt - the vendor's documentation does not say so for scrape.

## Next steps

1. Reviewed: the Contradictions and Decision sections are the agent's; `Reviewed by: agent` above.
2. Hand this file to the builder (phase 2). Re-running `node "/root/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.
<!-- fetchproof:brief-draft body=f50edf80f8de489d inputs=74a500f104d590e3 gate=pass -->
