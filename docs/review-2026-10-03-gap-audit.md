# Gap audit of Research-Kit (2026-10-03, main e1868fb, answer-only)

Lead-orchestrated: three read-only explorers (opus), two researchers running the kit (fable), the lead
(this session) ran every comparison pass, reproduced every gap it lists, and wrote this report.
At the time of the audit nothing in the kit was changed; the two research corpora are committed as cb0a0b3. The user then authorised ranks 1, 2 and 3 (`IMPLEMENT THE RESEARCH`); section 9 records their outcome.

## 1. Current state summary

Research-Kit (0.9.3, 60 lib modules, 1,570 offline tests) collects web pages into a corpus
(captures as markdown under research/raw, a hash-chained fetch ledger, evidence and contract
tables), gates a build on that corpus (13 checks), drafts a brief and packages the result with a
derived `buildAuthorized`. Its consumers are an agent or a person building from the brief. The
quality standard audited against: a cited claim must rest on a page that was really fetched, kept
faithfully, current, and checkable; a blocking question must never leave the gate unnoticed; the
gate's verdict must be a function of the repository.

Inspected: every lib module in the collection path, the corpus and gate, and delivery (explorer
reports, then the lead's own reading of each cited line); 266 real captures across the root corpus
and 28 nested projects; the tests named below. Probed (read-only, in temp projects): table
parsing, quote matching, dates, the gate. Not inspected: the Python conformance scripts' bodies,
the release validator's XLSX reader beyond its structure, the workflow runs on GitHub.

Comparison claims were collected through the kit into two nested projects (both preflight PASS,
handoff OK): `docs/decisions/2026-10-03-gap-audit-capture` (E-nn cited as C:E-nn) and
`docs/decisions/2026-10-03-gap-audit-corpus` (K:E-nn).

## 2. Gap list (only gaps that survived qualification)

| Rank | Gap | Affects | Impact | Evidence | Confidence |
|---|---|---|---|---|---|
| 1 | A blank line inside a table ends it; every row after it vanishes with no problem recorded. A blocking unknown written below a blank line drops out of the gate, which prints PASS. | completeness | high | `research-kit/lib/corpus.mjs:115` (`parseTable` stops at the first non-row line); probe: a U-2 row after a blank line gives 1 unknown, 0 problems, PASS. GFM breaks a table at an empty line too (K:E-01), so GitHub renders the lost rows as prose while an editor shows them as rows. Same class as G2, which was fixed today. No real corpus holds the case today (checked all 29). | VERIFIED |
| 2 | A Firecrawl scrape is served from the vendor's cache for up to two days by default, and the kit asks for nothing fresher: `--max-age` is never passed and `metadata.cacheState`/`cachedAt` are dropped. A capture stamped `retrieved: today`, or a `--force`/`--refresh-days` re-fetch meant to detect a change, can be a copy up to 48 h old. | accuracy, reliability | high | `research-kit/lib/firecrawl.mjs:353` (argv `scrape <url> --only-main-content --json`); the kit's own fixture `test/fixtures/firecrawl-scrape-1.25.3.json` carries `cacheState: hit`, `cachedAt`; vendor rule C:E-18 [quote: Defaults to 2 days.]; the CLI has `--max-age` (`firecrawl scrape --help`). | VERIFIED |
| 3 | A capture is a derived markdown; the bytes the server sent are not kept by any transport, so a converter defect is unrecoverable and the ledger proves the derivation, not the page. G3 showed it: every capture made before 6c22c67 holds damaged text that the chain certifies. | accuracy, reliability | high | `research-kit/lib/collect.mjs:59-109` (`writeRaw` stores `result.markdown` only); `http-transport.mjs:439` returns markdown; Firecrawl argv requests no `rawHtml` (the CLI supports `--format markdown,rawHtml`); WARC export writes the derivation (`warc.mjs:117`, by ADR-0090). WARC 1.1 keeps the HTTP message (C:E-08). Firecrawl's pricing page says only JSON, Question and Highlight formats add credits (root E-02, 2026-09-13), so rawHtml costs no credit. | VERIFIED (cost claim WELL-SUPPORTED) |
| 4 | A quote's fragments may be arbitrarily far apart and the length bar is measured over the joined fragments, so `[quote: free ... requests ... credits]` anchors three scattered words and passes as a verified quote. A quote with brackets nested two deep is silently not checked at all. | accuracy | medium | `research-kit/lib/quotes.mjs:25` (QUOTE_RE one level), `:98-112` (`anchorFound`, unbounded gap); `checks.mjs:151` (joined length); probes: both reproduced. W3C anchors `exact` plus prefix and suffix (C:E-03); Hypothesis bounds its fuzzy search by the quote's length (C:E-05). None of the 92 quotes in the real corpora uses an ellipsis, so it is latent. | VERIFIED |
| 5 | A page captured through search is never refreshed: every captured URL is excluded from search candidates whatever its age, and `--refresh-days` reaches only plan URLs. The stale warning's remedy ("re-collect with --refresh-days") cannot work for such a row. | reliability, accuracy | medium | `research-kit/lib/research-run.mjs:388` (`seen` = every capture), `:253` (filter), `checks.mjs:383` (the remedy text). | VERIFIED |
| 6 | A soft 404, a login page or a bot wall answered 200 becomes a capture and an evidence row; no transport detects any of them, and the auto-finding falls back to the page's title ("Just a moment..."). Firecrawl and the keyless transport refuse only a numeric status >= 400. | accuracy | medium | `research-kit/lib/collect.mjs:240-243`, `http-transport.mjs:737-745`; render failures are the only markers (`corpus.mjs:183`); real incidence: `research/raw/2026-09-19-page-not-found-tavily-6a631c67.md` is a 404 the row E-15 names on purpose (the status rule caught that one). | VERIFIED, incidence low |
| 7 | The WARC export's `capture-sha256` is the hash of the whole capture file, but the resource block is the body without front matter, so a consumer cannot verify a block against the ledger; the file is never read back; a missing ledger `at` writes an empty mandatory `WARC-Date`; skipped captures exit 0. | reliability | medium (export only) | `research-kit/lib/warc.mjs:118` vs `:133`, `:49`; `bin/export-warc.mjs:50`. WARC 1.1: WARC-Date mandatory, the capture instant (C:E-08). | VERIFIED |
| 8 | The Firecrawl `full` grade is a length bar: 1,500 characters of main content is `full` whatever `--only-main-content` dropped, while the keyless grade names dropped siblings. | completeness (of the grade) | medium-low | `research-kit/lib/firecrawl.mjs:241`; `http-transport.mjs:372`. 209 of 266 real captures are Firecrawl's. | VERIFIED |
| 9 | A table header that matches on its first cell alone is accepted with its other columns renamed, and a renamed column reads as empty with no problem. | completeness | medium-low | `research-kit/lib/corpus.mjs:103-132`; probe: `Retrieved date` gives `retrieved: ""`, 0 problems (only date-mismatch noticed, because the capture carries a date). GFM requires header and delimiter to agree (K:E-01), not column names. | VERIFIED |
| 10 | Nothing records what the source says about its own date: no Last-Modified, ETag or Date header is kept, no schema.org or `<meta>` date, and search rows drop the provider's `page_age`/`published_date`. Freshness is retrieval alone, so a 2019 article fetched today is current. | accuracy (secondary sources) | medium-low | grep of lib for published/last-modified/etag: none; capture front matter `collect.mjs:66-76`; search rows `search-session.mjs`; RFC 9110 fields (C:E-11), Zotero's Date vs Accessed (K:E-02), schema.org (K:E-21), Brave `page_age` (K:E-20), Tavily `published_date` (K:E-10). | VERIFIED |
| 11 | "Same site" for corroboration comes from a 23-entry suffix list, not the Public Suffix List; hosts under any other shared suffix (`co.za`, `web.app`, ...) are grouped or split wrongly. | reliability (warn only) | low | `research-kit/lib/core.mjs:768-786`; publicsuffix.org: no algorithmic method exists, only the list (K:E-15). | VERIFIED |
| 12 | Supersession, duplicate-url and the fresher-row hint key on the exact URL string, so `www.`/trailing-slash spellings escape them while the cache treats the spellings as one page (ADR-0136). | reliability | low | `research-kit/lib/checks.mjs:610, :733, :374`. | VERIFIED by reading, not probed |
| 13 | Lenient `Date.parse`: `2026-02-30` rolls over, `"foo 12"` parses, so `unparseable-date` misses them; a mistyped `maxAgeDays` string silently becomes 180. | reliability | low | `research-kit/lib/core.mjs:714`; probe: `2026-02-30` gives no unparseable-date; `machine.mjs:170`. | VERIFIED |
| 14 | Non-Latin pages give a null MinHash sketch, so two copies of one document on two hosts count as independent witnesses. | reliability (warn) | low here | `research-kit/lib/similarity.mjs:24` (ASCII shingles). | VERIFIED by reading |
| 15 | The commit gate's integrity rules omit `raw-missing`, `raw-outside`, `raw-unreadable`: deleting a cited capture commits when the commit is confined to research/, although preflight fails. | reliability | low | `research-kit/lib/gate.mjs:495`. | VERIFIED by reading |

## 3. Error-reduction recommendations (smallest change each; none required until you say so)

1. Rank 1: in `parseTable`, after the table ends, record a `table-split` corpus problem for any later line that looks like a row (`| ... |`) before the next heading, naming the line; make it a hygiene FAIL like `malformed-id`. Cost: an hour. Wrong if a corpus legitimately holds a second same-shaped table after a blank line (none does today).
2. Rank 2: pass `--max-age 0` on a `--force` or refresh re-fetch and `--max-age <refreshDays in ms>` otherwise; record `cacheState` and `cachedAt` in the capture's front matter and the ledger, and let `retrieved` be the vendor's `cachedAt` day when the answer was a cache hit. Cost: half a day plus one ADR (the retrieval date's meaning changes). Wrong if the CLI's `--max-age` does not reach the API's `maxAge` (verify on one page: 1 credit).
3. Rank 3: keep the bytes the server sent beside the capture (`<capture>.html`, hashed in the same ledger entry) for the keyless and browser transports, and request `--format markdown,rawHtml` from Firecrawl; the gate still reads the markdown. Cost: a day plus an ADR (storage, the format-cost claim re-checked). Wrong if storage or the licence decision (2026-10-02-licence-and-captured-pages) forbids keeping page bytes.
4. Rank 4: bound the gap between fragments (the W3C prefix/suffix idea in reverse: at most N characters between fragments) and measure the length bar per fragment; let QUOTE_RE nest two levels or report an unparsed `[quote:` as a warning. Cost: two hours.
5. Rank 5: include stale captured URLs in the search candidates when `--refresh-days` is given, or make the stale-evidence remedy say "add the URL to the plan". Cost: an hour.
6. Rank 6: mark a 200 capture whose title or first heading matches a short list (page not found, 404, sign in, just a moment, access denied) as `partial` with `omitted` naming the suspicion, so `capture-completeness` sees it. Cost: two hours; false positives on pages about those phrases are the risk.
7. Rank 7: write `capture-sha256` over the block it accompanies (or add `body-sha256`), refuse an export whose entry has no `at`, and exit 1 when captures were skipped. Cost: an hour.
8. Rank 8: once rank 3 keeps the HTML, grade Firecrawl captures with the keyless sibling rule; until then, name the grade's basis in `omitted` ("length only").
9. Rank 9: accept a header only when every canonical column name is present; report a renamed column as `table-header`. Cost: an hour.
10. Rank 10: record Last-Modified and Date from the keyless response and the provider's date from search rows as informational fields (never as the judged date). Cost: half a day.
11. Ranks 11 to 15: low; fix when the module is next opened, or record.

Class-level: ranks 1, 9 and 13 are one class, "a corpus input the parser accepts without saying what it did", and one rule closes it: every row-shaped or date-shaped cell the gate cannot use is a named problem. Ranks 2, 3 and 10 are one class, "the capture records less than the fetch knew", closed by writing what the transport already had (status, cache state, headers, bytes) into the front matter and the ledger.

## 4. What is already solid (with evidence)

- Tamper evidence: an edited capture, a removed ledger line, a hand-typed raw file and a late prior all fail, and a CRLF rewrite is named as line endings, not tampering (`provenance.test.mjs`, `prior.test.mjs`); the commit gate blocks altered evidence whatever is staged (`hook.test.mjs`, `gate.test.mjs`).
- Capture boundaries: 16 MiB bodies refused declared or streamed, binary responses refused by name, redirects into internal addresses refused, DNS rebinding pinned (`large-response.test.mjs`, `redirect-guard.test.mjs`, `transport.test.mjs`).
- Quote matching normalisation: NFKC, format characters, curly quotes, dashes, Markdown, wrappers, ellipses, case (`quotes.test.mjs`); a fabricated quote blocks under every policy.
- Charset and browser status as of today's PR #235: BOM over header, legacy labels honoured, invalid bytes named, origin status from Chromium's net log, a 403 page refused (`runtime.test.mjs`, `browser-transport.test.mjs`).
- Freshness and supersession by the capture's date and the ledger's order (`checks.test.mjs`), dates in the future refused.
- Package authorization derived inside `deriveState`, never supplied; the validator refuses a package whose fields disagree (`artifact-validator.test.mjs`).
- Compared with GPT Researcher and STORM (K:E-11 to E-14, E-19), neither documents a per-claim citation check or a publisher-diversity rule; the kit's quote anchor and corroboration check are stronger than both.
- All 29 real corpora pass preflight; the suite is 1,570 tests, 0 failures; CI green on seven jobs.

## 5. Iteration log (sequential passes by the lead; later passes knew earlier findings)

| Pass | Comparison set | New gaps | Confirmed | Retracted | Delta |
|---|---|---|---|---|---|
| 1 | W3C Web Annotation, Hypothesis (C:E-03..05, E-14, E-21, E-22) | 4 | ADR-0087's exact match stands | "fuzzy re-anchoring needed": a changed page should fail, and does | one medium |
| 2 | WHATWG HTML and Encoding (C:E-06, E-07) | none | today's G7 fixes match the spec's BOM order | "undeclared should be windows-1252": the kit names a fallback instead, honest | empty |
| 3 | WARC 1.1, WACZ (C:E-08, E-09) | 7 | ADR-0090's resource-record decision | "no response records", "no package digest": decided in ADR-0090 | one medium |
| 4 | RFC 9111/9110, RFC 9309, Firecrawl references (C:E-10..12, E-17..20) | 2, 3, 10 | | conditional requests (cost, not output); robots (compliance, not output: see section 7) | two high |
| 5 | GFM tables (K:E-01) | 1, 9 | ragged rows repaired as GFM pads them; the fold of extras differs from GFM's "ignored" but is warned | | one high |
| 6 | Zotero, schema.org (K:E-02, E-04, E-21) | none new | 10 | | empty |
| 7 | Brave, Tavily (K:E-05, E-08, E-10, E-18, E-20) | search rows drop dates (part of 10) | merge caps | freshness filters (feature) | empty of high impact |
| 8 | GPT Researcher, STORM (K:E-11..14, E-19) | none | the kit is stronger per claim | | empty |
| 9 | Public Suffix List (K:E-15..17) | 11 | | | one low |

Passes 6 to 9 added no high-impact gap; the audit converged. Gaps 5, 6, 8, 12 to 15 came from project inspection, not from a comparison set.

## 6. Final assessment

Not negligible for the stated purpose, on three counts: a blocking question can leave the gate on a blank line (rank 1), a "retrieved today" capture can be a vendor copy two days old (rank 2), and the record cannot repair a converter defect because the page's bytes are gone (rank 3). Each is one contained change. Everything else is medium or low and mostly latent in the real corpora.

Unresolved: whether the CLI's `--max-age` reaches the API's `maxAge` (one live scrape would tell); whether Firecrawl's scrape honours robots.txt at all (C:E-17/E-19/E-20 speak of crawl and of a default; the scrape reference has no option: CONTESTED). Not inspected: the Python conformance scripts, the XLSX reader, live workflow runs. What would change the assessment: a real corpus with a blank-line-split table (raises rank 1 to critical), or vendor confirmation that cache hits never serve a page older than the request's intent (lowers rank 2).

Documentation drift found by the delivery explorer and verified by the lead: `researcher-release validate --genesis/--checkpoints` are accepted and dropped (`bin/researcher-release.mjs:70-71` vs `lib/release-validator.mjs:974`); ADR-0132 is cited by ADR-0133 but absent (it is on the PC, unpushed); README names `start-research.yml` (:119) and `property-replay --case` (:389), neither exists; QUICKSTART says the collector stops at the cap while collect.yml passes `--fallback` (ADR-0129); collect.yml's error text still names required reviewers (ADR-0033 amended); the validator range reads R28–R32 while R33 is in PACKAGES. None affects an output; all are completeness of the record.

## 7. Optional improvement ideas (not required for accuracy, completeness or reliability)

- robots.txt: no transport consults it; the keyless and browser transports fetch regardless (RFC 9309, C:E-12). A compliance choice for an ADR, not an output gap.
- Conditional requests on refresh (If-None-Match / If-Modified-Since, C:E-10) would make a keyless refresh free when the page is unchanged.
- Search results are not persisted; only the pages scraped survive, and plan searches are re-paid on every run while an unknown is OPEN (ADR-0127).
- A present `FIRECRAWL_API_KEY` is silently ignored when the machine config pins a transport; `doctor` could say so.
- Byte-identical bodies under different URLs (an SPA serving one page for three routes) are three rows and three credits; the ledger already holds the hash.
- `--refresh-days 0` does not refresh a same-day capture (`0 > 0`).
- The brief drafts "Known unknowns: None" without a TODO when every unknown is CLOSED, so a finding that names an uncaptured page is not surfaced there.

## 8. Source audit

Every external claim above rests on a ledgered capture in one of the two nested projects (preflight PASS, chains verify); the kit's own code is read directly. C:E-01, E-02, E-13, E-15, E-16, E-23, E-24 and K:E-06, E-07 are uncited search-return rows, kept as the record of what the searches returned. One claim rests on an older capture of the root corpus: Firecrawl format pricing (root E-02, 2026-09-13, type S). One claim is CONTESTED (Firecrawl scrape and robots.txt). One researcher used the session's Firecrawl MCP search once to locate pages, then fetched them through the kit; the located pages are ledgered, the locating search is not. Spend: 1,175 to 1,061 credits.

## 9. Outcome (ranks 1 to 3 authorised 2026-10-03; rank 7 fixed 2026-10-17)

| Rank | Change | Commit |
|---|---|---|
| 1 | `parseTable` records a `table-split` problem for every row-shaped line between a table's end and the next heading; `hygiene` fails it; a second blank-separated table is not one. | 9ca9fc1 |
| 2 | Every Firecrawl scrape passes `--max-age 0`; a cached answer's `cacheState`/`cachedAt`, if sent, go into the capture's front matter and the ledger entry (ADR-0139). Verified live: the vendor served a previous day's copy as today's scrape; `--max-age 0` fetched live at the same credit. | c6c5377 |
| 3 | Every transport returns the text it converted as `source`; the collector keeps it LF-folded as `<capture>.source.html`, the ledger names and hashes it, `verifyLedger` checks it like the capture, `readCaptures` never indexes it (ADR-0140, lifts the freeze for that file and two ledger fields). Firecrawl's `rawHtml` verified live at no extra credit. | bed6bc0 |
| 7 | The `metadata` record carries `body-sha256`, the block's own hash, beside `capture-sha256` (unchanged - the whole file, which is what the ledger holds), so a consumer can check a block against the export; a ledger `scrape` entry with no `at` is left out and named instead of writing a record with an empty mandatory `WARC-Date`; a partial export exits 2 (`INCOMPLETE`, rank 15 of the 2026-10-04 gap audit); and the written file is re-read from disk before success. ADR-0161 (lifts the freeze for `body-sha256`). | 8ee1be4 |

Ranks 4 to 6 and 8 to 15 remain as recorded above, not implemented.

### Review of the three commits (breaker and mutation auditor, 2026-10-04)

| # | Finding (severity) | Disposition | Commit |
|---|---|---|---|
| B1 | A row inside a fenced code block or an HTML comment after a table failed the gate as `table-split` (S2). | fixed: fences and comments are skipped | b997749 |
| B2 | A `###` note or `#tag` prose stopped the split scan, so a stray row below it was still dropped in silence (S2). | fixed: the scan runs to the end of the table's section | b997749 |
| B3 | A link planted at the sibling's name made `writeSource` throw after the capture was written: an orphan capture, no ledger entry, a false cache hit next run (S2). | fixed: the write is inside the try; the fetch is ledgered with `sourceOmitted` | b997749 |
| B4 | A planted `*.source.html` no entry names was invisible to every check (S3). | fixed: `source-unnamed` corpus problem | b997749 |
| B5 | An oversized source vanished without a trace (S3). | fixed: `sourceOmitted` names the reason | b997749 |
| B6 | `--max-age` is not in the pinned 1.25.3 fixture's option table (S3). | rejected: verified against the 1.25.3 CLI's own `--help` and a live scrape | - |
| B7 | A second table with a malformed separator was reported as three splits of the first (S3). | fixed: named once, as a malformed separator | b997749 |
| M1, M27, M25 | Mutation survivors: a later section's heading ending the scan, a lone separator, the capture's own path as sibling name. | fixed: three tests pin them; 24 of 27 mutations were already caught | b997749 |
| CI-1 | The planted-link test of B3 went red on the windows-latest leg: it linked to `/etc/hostname` without the harness's symlink guard and compared the link's stored text, which Windows resolves to a drive path (`D:\etc\hostname`). The same test stayed green with `writeSource`'s path guard removed - its input was caught by the "sibling already differs" rule first - so the review's mutation pass had not proved that guard (S1: a review miss, found by CI, not by the four reviewers). | fixed: links into the test's scratch through `requireSymlink`, a dangling link that only the path guard refuses, lstat and real-path assertions; the mutant now fails the test; the oversized case is its own test | ff6e13c |
