# Gap audit of Research-Kit, 2026-10-04 (second audit)

Answer-only audit of the kit at `a4ae8f6` (kit 0.9.3, after ADR-0139 and ADR-0140), run with the
lead-orchestrator posture: three explorers mapped the collection path, the gate and the consumer
outputs; three researchers collected rotated comparison sets through the kit itself as nested
decision projects (ADR-0030); the lead ran the passes, probed every high-ranked candidate, and
re-verified ranks 4 to 15 of the audit of 2026-10-03
([`review-2026-10-03-gap-audit.md`](review-2026-10-03-gap-audit.md)). A review the user received
from another tool on a copy of the repository was re-verified here too (section 8). Nothing was
changed: the only writes are the three research projects and this document.

Evidence rows are cited as `P:E-nn` ([`decisions/2026-10-04-gap-audit-provenance`](decisions/2026-10-04-gap-audit-provenance/research/BRIEF.md)),
`X:E-nn` ([`decisions/2026-10-04-gap-audit-extraction`](decisions/2026-10-04-gap-audit-extraction/research/BRIEF.md))
and `C:E-nn` ([`decisions/2026-10-04-gap-audit-citation`](decisions/2026-10-04-gap-audit-citation/research/BRIEF.md)).
File references are to `research-kit/`.

## 1. Current state summary

**What it is.** A research-first gate for coding agents: `decompose` drafts a map, the agent writes
a contract of unknowns, `research.mjs` fetches pages through one of three transports and writes
captures, evidence rows and a hash-chained ledger, thirteen preflight checks judge the corpus,
`brief.mjs` writes the phase-1 handoff, and the commit and edit gates refuse product code while the
gate fails. Its outputs, in the order a consumer meets them: the capture and its ledger entry, the
evidence row, the verdict, the brief, the audit snapshot, the portable package and its validator,
the MCP server's answer, the WARC export.

**Quality standard audited against.** The kit's own: evidence is fetched, never typed; a capture
is the page asked for; a CLOSED unknown rests on a real, fresh, primary row the agent rewrote;
a passing gate plus a reviewed brief is a handoff a builder should not need to re-research; the
package's `buildAuthorized` is derived, never supplied.

**Inspected.** Every module on the collection path, the gate, the corpus reader, the quote
anchor, the ledger, the brief, the audit, the artifact producer and validator, the handoff, the
WARC export, the measurement, the MCP server, the remote collector (file:line in the explorer
tables summarised below); the 31 real corpora in the repository (all PASS, 0 failures, 1,032
warnings of nine kinds: `transport-not-metered` 31, `one-voice` 22, `brief-unstamped` 9,
`raw-thin` 5, `single-source` 3, `secondary-only` 2, `single-witness-stale` 2, `partial-only` 2,
`partial-render` 1; 14 corpora older than 2026-09-28 carry no `[quote:]` anchor; none predating
2026-10-04 has a source sibling); the suite (1,585 tests, three consecutive green runs in an
isolated worktree, 145 s each). **Not inspected:** the Python conformance runners, the XLSX
reader, `dispatch.mjs` beyond its token and corpus paths, `artifact-zip.mjs`, the GitHub
workflows as run, Windows behaviour (no Windows host here), the browser transport on a real PDF
URL, any live GitHub path.

## 2. Gap list (only gaps that survived qualification)

| Rank | Gap | Affects | Impact | Evidence | Confidence |
|---|---|---|---|---|---|
| 1 | The brief - the one file a builder is required to read - says `**Gate: PASS.** Every blocking unknown is closed with evidence` whatever the warnings: `counts.warn` is never read, so single-source closures, closures resting only on partial captures, lead-only rows, uncited captures and a stale or unstamped brief leave no trace in the handoff. 29 of the 31 real corpora carry warnings; every one of their briefs reads clean. The Verified table flags `_(partial capture)_` per row only when the Raw cell names the capture. | completeness (of the handoff) | high | `lib/brief.mjs:271-279` (gate line from `verdict.pass` and `counts.fail` only); probed: a passing project with an uncited capture and a single-source closure, 2 warnings, brief contains no "warn"; the Contradictions section is a bare TODO. No test covers a warned corpus's gate line. | VERIFIED |
| 2 | Package authorization is asserted, not re-derived: the validator checks that the manifest's approval fields agree with each other (`authorizationProblems`) and re-runs the handoff on the materialised copy, but never preflight or `deriveState`, so a package whose `DISCOVERY.md` was edited after creation (digests recomputed) validates `PASS, buildAuthorized: true`; `findingsReviewState` skips every row with a blank Raw cell, so blanking the cells makes extractor-text findings count as reviewed; a planted file under `research/raw/` that no ledger entry and no row names travels with role `RAW_CAPTURE`, indistinguishable from a capture, through a validation that passes with an empty `warnings` array. | reliability (of `buildAuthorized` as a gate) | high | `lib/artifact-validator.mjs:385-396`, `:436-458`, `:494` (handoff only); `lib/artifact.mjs:309` (`if (!row.raw) continue;`), `:94` (role by path); `lib/artifact-validator.mjs:83`, `:395` (warnings never populated). Probed by the lead: the planted file case (validate PASS, errors [], warnings [], role RAW_CAPTURE, `collection.completeness: PARTIAL` because the planted file has no completeness front matter). The edited-contract and blank-Raw cases were reproduced by the external reviewer and verified here by reading the code path. | VERIFIED |
| 3 | No capture is judged by its content: only a numeric status of 400 or more is refused, so a 200 with an empty body, a challenge page ("Just a moment...", "Making sure you're not a bot!"), a consent banner, or the landing page of a silent cross-host redirect becomes a capture and an evidence row; the `full` grade is a 1,500-character bar on Firecrawl and "no dropped siblings" on the keyless transport (a 33-byte page is `full`); Firecrawl's `metadata.error` is never read; a browser capture with no observed status is still `ok`. The real corpora hold a bot wall (licence project, E-45), a 12-character terms page (wayback project, E-05) and a 503 error page captured before the status rule (browser project, E-04); each was caught by the reviewing agent, none by the gate. Every extractor in the comparison set grades by content (X:E-01, E-02, E-04, E-05), Google defines a soft 404 by content (X:E-10), Cloudflare documents a one-header signal (X:E-15), and Firecrawl itself does no content check (X:E-07), so the vendor will not do it for the kit. The widened form of rank 6 and rank 8 of the previous audit. | accuracy | high | `lib/collect.mjs:286-299`, `:305-317`; `lib/http-transport.mjs:494-509` (ok for `''`), `:719-746` and `:501` (cross-host redirect, row URL = landing host, no test); `lib/firecrawl.mjs:239-248` (bar), `:253-274` (error never read, missing status accepted); `lib/browser-transport.mjs:358`; the only bot-check detector is for search (`http-transport.mjs:523-528`). Explorer probes: 200 "Just a moment..." gives a row whose Finding is "Enable JavaScript and cookies to continue"; 200 empty body gives a capture with an empty body. Real captures listed above. | VERIFIED |
| 4 | The quote anchor accepts what it should not: fragments may be arbitrarily far apart and the length bar is measured over the joined fragments (`[quote: free ... requests ... credits]` passes); a quote with brackets nested two deep is silently unchecked; a quote that normalises to nothing (`[quote: ** **]`) is counted as "1 quote found" because an empty needle is skipped. Rank 4 of the previous audit, plus the empty-needle case. | accuracy | medium | `lib/quotes.mjs:25` (one-level regex), `:98-108` (unbounded `indexOf`, `if (!needle) continue`), `lib/checks.mjs:151` (length over `fragments.join(' ')`). Probed by the explorer (all three), by the lead for the empty needle by reading. No test for any of the three. | VERIFIED |
| 5 | A PDF is evidence only through Firecrawl, which parses it at one credit a page and reveals truncation as `numPages < totalPages`; the kit never reads either field, so a statute cut at `maxPages` is graded by the length bar and reads `full`. The keyless transport refuses PDFs by name (honest); the browser path is uninspected. | completeness | medium | `lib/firecrawl.mjs:253-274` (reads `markdown`, `metadata.sourceURL`, `statusCode`, `cacheState`, `cachedAt`, `rawHtml` only; no `numPages`/`totalPages` anywhere in `lib/`); `lib/http-transport.mjs:488-493`. X:E-07, E-08, E-14, E-16. | VERIFIED |
| 6 | A blank Raw cell bypasses two judgements: freshness falls back to the editable Retrieved cell (an old capture with the cell edited to today passes with no finding), and the findings-review check skips the row (part of rank 2). The collector always writes the Raw cell; this is the hand-edited corpus the gate exists to catch. | reliability | medium | `lib/checks.mjs:45-60` (`ownCapture` null for a blank cell); `lib/artifact.mjs:309`. Explorer probe for freshness; external reproduction for review. | VERIFIED |
| 7 | Nothing records what the source says about its own date: no `Last-Modified`, `ETag` or `Date` header is kept, `<time datetime>` and every `<meta>` are stripped by the converter, and search providers' `page_age` is dropped, so freshness is retrieval alone. Rank 10, still open. trafilatura and htmldate separate original from updated date, Readability returns `publishedTime` (X:E-01, E-04). | accuracy (secondary sources) | medium | grep of `lib/` for last-modified, etag, dateModified, `<time`, page_age: no reader; `lib/collect.mjs:108-124` (front-matter fields); `lib/http-transport.mjs:312-356`. | VERIFIED |
| 8 | A page captured through search is never refreshed: every captured URL is excluded from candidates whatever its age, and `--refresh-days`/`--force` reach plan URLs only. Rank 5, still open. | reliability | medium | `lib/research-run.mjs:388`, `:253`, `:416`, `:242-258`, `:480`; `test/collect.test.mjs:657` pins the exclusion. | VERIFIED |
| 9 | The ledger's `at` for every scrape is `${date}T00:00:00.000Z`: a day written as a millisecond timestamp. Failed fetches use the real time, so the two sort against each other wrongly; the WARC export writes that midnight as `WARC-Date` and the timeline prints it. The provenance standards treat generation time as the evidence that a hash existed before a time (P:E-04, E-09). Verdicts are unaffected since same-day supersession follows `seq`. | reliability (of the record) | medium-low | `lib/collect.mjs:334` vs `lib/provenance.mjs:402`; `lib/warc.mjs:115`, `:123`. Observed in every ledger of the three new projects. | VERIFIED |
| 10 | Supersession, duplicate-url and the fresher-row hint key on the exact URL string while hygiene's own counts use `urlKey`: `/docs/limits` and `/docs/limits/` citing one capture draw no supersession and no duplicate warning. Rank 12, now probed. | reliability | medium-low | `lib/checks.mjs:610`, `:733`, `:374` vs `:717`, `:723`. Explorer probe (identical spelling fails as expected, trailing slash passes). | VERIFIED |
| 11 | A table header matched on its first cell alone accepts renamed columns, and a renamed column reads as empty with no problem; the universal-dimension check matches map rows by id alone. Rank 9. | completeness | medium-low | `lib/corpus.mjs:103-105`, `:132`; `lib/dimensions.mjs:82`. Explorer probe (`Retrieved date` gives `retrieved: ""`, 0 problems). | VERIFIED |
| 12 | A row-shaped unknown line under a later heading of the same level is dropped with no problem: the table-split scan of rank 1 ends at the section boundary. The blank-line case the previous audit found is fixed; this is its residue, and arguably prose by the GFM reading. | completeness | low | `lib/corpus.mjs:162-163`. Explorer probe (`## Notes` holding a U-2 row: 1 unknown, 0 problems, PASS). | VERIFIED |
| 13 | The MCP server: `validateArgs` types strings and integers only, so `queries: 42` or an object is stringified by `queriesInput` into a paid search; `resourceLink` builds `file:///` by concatenation, so a `#` in a file name becomes a fragment and a relative path becomes a root path; a PASS-but-unauthorized corpus is `isError: false`, and a FAIL still hands the client a link to the invalid package with `state` echoing the manifest's claim. | reliability | low | `lib/mcp.mjs:392-412`, `:202-210`, `:356-380`; `lib/dispatch.mjs:73-82`. External reproductions (first two), explorer probe (third), verified by reading. | VERIFIED |
| 14 | `audit --force` renders and registers an immutable audit of a failing corpus while its help text says `--force` means "render even when unchanged"; `brief --force` on a failing gate suppresses the "drafting anyway" notice. | reliability | low | `lib/audit.mjs:291`, `bin/audit.mjs:38-41`; `bin/brief.mjs:50`. Explorer probes. | VERIFIED |
| 15 | WARC export: `capture-sha256` is the hash of the whole capture file while the resource block is the body alone, so a consumer cannot verify a block against the ledger; a missing `at` writes an empty mandatory `WARC-Date`; skipped captures exit 0; the written file is not re-read (the in-memory bytes now are). Rank 7, three of four parts still open. | reliability | low | `lib/warc.mjs:118`, `:133`, `:115`, `:123`, `:49`; `bin/export-warc.mjs:40`, `:50-51`. | VERIFIED |
| 16 | Package metadata presented as collection facts are not: `collection.captures` counts evidence rows with a Raw cell, `searchProvider` is the fetch transport, `startedAt` and `finishedAt` are the packaging time, `creditsUsed` is null. | reliability | low | `lib/artifact.mjs:545`, `:555-556`, `:560-561`. Lead probe (1 capture counted against 2 ledger entries and 3 files; `searchProvider: firecrawl-cli` on a project that searched nothing). | VERIFIED |
| 17 | Still open from the previous audit, unchanged: the 23-entry suffix list for "same site" (rank 11, `lib/core.mjs:768-786`); non-Latin pages give a null MinHash sketch so two copies read as independent (rank 14, `lib/similarity.mjs:24`); lenient `Date.parse` and a string `maxAgeDays` silently becoming 180 (rank 13, `lib/core.mjs:714-719`, `lib/machine.mjs:170`); the commit gate's integrity rules omit `raw-missing`, `raw-outside`, `raw-unreadable` so deleting a cited capture commits when the commit is confined to `research/` (rank 15, `lib/gate.mjs:495`, now probed). | reliability | low | as cited; all probed by the explorer except rank 11's list, read. | VERIFIED |

## 3. Error-reduction recommendations (smallest change each; none required until you say so)

| For | Change | Where | Prevents | Cost | What would make it wrong |
|---|---|---|---|---|---|
| 1 | Write the warning count and each warned rule into the brief's gate line and a "Warnings the builder should know" list drafted from `verdict.findings` (rule, the row or unknown it names); keep the TODO sections. | `lib/brief.mjs` draft; `test/brief.test.mjs` | a builder reading a single-source or partial-only closure as a clean one | small | if the brief is meant to be read only after the audit snapshot, which already lists warnings; it is not, the brief is "the only file phase 2 is required to read" |
| 2 | In the validator, after the handoff on the materialised copy, re-run `deriveState` there and require its `buildAuthorized` to equal the manifest's; in `findingsReviewState`, resolve a blank Raw cell through `captureOf` as the checks do, and count an unresolved row as not reviewed; refuse a file under `research/raw/` that no ledger entry names (`raw-unledgered`, a corpus problem the validator and `handoff` fail on, hygiene warns on). **Two conditions, verified after an external review raised them:** (a) the re-derivation must not read the consumer machine's policy or hooks - `promote()` (`lib/preflight.mjs:49-53`) fails every warning under the CLI's `--strict` and only `transport-provenance`, `capture-completeness` and `corroboration` under a machine's `evidencePolicy=strict`, the manifest records neither (no policy field in `schemas/artifact-manifest.schema.json`), and the producer's `deriveState` ran under its own machine's policy (`lib/artifact.mjs:236` passes `env`); so the validator judges the unpromoted findings as a portable baseline and says so, never the producer's exact verdict; (b) the brief's inputs hash changed inside format 1.x (ADR-0069, 2026-09-27, added the map rows and the ledger and capture counts; a stamp without `gate=` still parses as `unknown`), so a historical approved package's stamp will not match today's hash and must not be read as stale on that ground alone - settle the treatment of pre-0069 stamps on real historical fixtures (unstamped, early-stamped, current) before building, and never upgrade a package that declares `buildAuthorized: false`. | `lib/artifact-validator.mjs`, `lib/artifact.mjs`, `lib/corpus.mjs`, `lib/handoff.mjs` | a package whose authorization contradicts its contents, and an unfetched file travelling as a capture | medium (re-deriving needs the materialised copy to be a full project, which it already is for the handoff) | if the package is meant to be trusted on its manifest alone (a signed package would be); it is not signed, and the README says the ledger is self-attested |
| 3 | Grade by content, never refuse by it: a hygiene problem `suspect-capture` on a capture whose body is under a floor (Readability's 500 characters, X:E-04), whose title or first line matches the challenge and error patterns the search bot-check already uses, whose keyless response carried `cf-mitigated: challenge` (X:E-15), whose final host differs from the asked host, or whose Firecrawl payload carried `metadata.error`; record the signal in the front matter; `unknown-closure` fails a CLOSED unknown resting solely on a suspect capture under strict policy and warns under pluralist. An empty JSON list is a legitimate capture (the actions project's E-08 proves its point by being empty), which is why this is a grade and a warning, not a refusal. | `lib/collect.mjs`, `lib/http-transport.mjs`, `lib/firecrawl.mjs`, `lib/checks.mjs` | a bot wall, an empty page or a redirect landing page cited as evidence without a word from the gate | medium | if real corpora never carry such captures; they carry three, and the reviewing agent caught them by hand each time |
| 4 | Bound fragment gaps (the next fragment must start within N characters of the previous match, or within the same paragraph); measure the length bar per fragment; parse nested brackets or refuse them by name; treat an empty normalised needle as not found. | `lib/quotes.mjs`, `lib/checks.mjs` | a scattered-word "quote" or an empty one counted as a verified anchor | small | nothing found: ADR-0087 asks for an exact anchor, and all three accept something weaker |
| 5 | Read `numPages` and `totalPages` from the Firecrawl payload; `completeness: partial` with `omitted: "pages N to M not parsed"` when they differ; record both in the front matter. | `lib/firecrawl.mjs`, `lib/collect.mjs` | a truncated statute graded full | small | if the fields are not in the CLI's JSON output; X:E-14 documents them on the parse endpoint, and one live scrape of a long PDF would confirm the scrape endpoint carries them (1 credit a page) |
| 6 | Judge freshness and review through the same resolver: when the Raw cell is blank, use the URL's latest capture (`captureOf`, `lib/corpus.mjs:746-751` - an explicit Raw path stays authoritative and a broken one does not fall back) and raise `date-mismatch` against it. Regression fixtures need several captures of one URL, not one, because the resolved capture is the latest, not the one a row previously named. | `lib/checks.mjs`, `lib/artifact.mjs` | an editable cell deciding freshness and review | small | nothing found |
| 7 | Keep the response's `Last-Modified`, `ETag` and `Date` headers and the page's `<meta property="article:published_time">`, `<meta name="date">` and first `<time datetime>` in the front matter as `sourceDate*` fields; keep a search result's `page_age`/`published_date` on the row; never use them for the verdict, show them beside `retrieved` in the brief and audit. | `lib/http-transport.mjs`, `lib/firecrawl.mjs` (metadata), `lib/collect.mjs`, `lib/brief.mjs` | a 2019 article fetched today reading as current | medium | if the kit's claim is only "what the page said on the day", which is what the ledger proves; the brief still presents the row as fresh |
| 8 | Let `--refresh-days` and `--force` reach captured URLs that search found: exclude a captured URL from candidates only while its capture is within the refresh window. | `lib/research-run.mjs:242-258`, `:388` | a stale search-captured row that can never be re-collected by the documented remedy | small | if ADR-0127's "a search is not re-run while every unknown is CLOSED" is read as covering fetches too; it covers searches |
| 9 | Write the real `nowIso()` as `at` for scrapes as the collector already does for failures; keep `retrieved` as the day. | `lib/collect.mjs:334` | a midnight timestamp in the ledger, the WARC and the timeline | trivial | nothing found; the day is still in `retrieved` |
| 10 | Key supersession, duplicate-url and the fresher-row hint on `urlKey`, as hygiene's counts and the cache already do (ADR-0136 made that the identity). | `lib/checks.mjs:610`, `:733`, `:374` | two spellings of one page escaping supersession | small | nothing found |
| 11 | Match a header on every cell, or report `table-header-renamed` naming the column that did not bind. | `lib/corpus.mjs:103-132` | a renamed column reading as empty | small | if first-cell matching is relied on by old corpora; `corpus.test.mjs:28` pins it, so the test says it was intended, and a problem (not a refusal) keeps them readable |
| 12 | Extend the split scan past a same-level heading only for lines that parse as a row of the table's arity, naming them `table-split` as now. | `lib/corpus.mjs:146-181` | a stray unknown row under a later section | small | if a row-shaped line in another section is prose on purpose; naming it a problem still lets the operator decide |
| 13 | Type-check array arguments and their items in `validateArgs`; build the link with `pathToFileURL(resolve(file))`; make `isError` true when `buildAuthorized` is false and omit the link on FAIL. | `lib/mcp.mjs` | a paid search from a malformed call, a wrong link | small | nothing found |
| 14 | `audit --force` only when the gate passes, or name the verdict in the file name and the help; print the "drafting anyway" notice under `--force` too. | `bin/audit.mjs`, `lib/audit.mjs:291`, `bin/brief.mjs:50` | an immutable audit of a failing corpus taken for a snapshot | trivial | nothing found |
| 15 | Hash the block that is written (body) or write the block the hash covers (whole file); write `WARC-Date` from `at` and refuse an entry without one; exit 2 when a capture was skipped; re-read the written file. | `lib/warc.mjs`, `bin/export-warc.mjs` | an archive a consumer cannot verify against the ledger | small | ADR-0090's resource-record choice is kept; only the digest's subject changes |
| 16 | Derive `collection.captures` from the ledger's scrape entries whose capture is on disk, `searchProvider` from the search transport actually configured, `startedAt`/`finishedAt` from the first and last ledger `at`, and leave `creditsUsed` absent rather than null. | `lib/artifact.mjs:545-561` | a consumer reading packaging time as collection time | small | nothing found |
| 17 | As recommended on 2026-10-03: the Public Suffix List as a data file; UTF-aware shingling; `Date.parse` replaced by a strict ISO parse; `maxAgeDays` ill-typed reported; `raw-missing`/`raw-outside`/`raw-unreadable` added to the commit gate's integrity rules. | as cited there | as recorded there | small each | as recorded there |

**Class-level checks that would catch the classes, not the instances.** (a) One resolver for "the capture behind a row" used by every check and by the artifact (ranks 2, 6): three places today resolve it three ways. (b) One content grade written once by the collector and read by every consumer (rank 3, 5): the grade is a transport's word today. (c) One place that renders the verdict for consumers - brief, audit, package README, MCP text - from the same `verdict` object including its warnings (ranks 1, 13, 14). (d) A single URL identity (`urlKey`) in every check (rank 10). (e) A test per consumer output over a warned, a partial-only and a planted-file corpus, which none has.

## 4. What is already solid (with evidence)

- The ledger's canonical form matches RFC 8785's rules where it matters for reproducibility: keys sorted by UTF-16 code units (`Object.keys().sort()`), ECMAScript number and string serialisation (`JSON.stringify`), no whitespace, duplicates impossible from objects (`lib/core.mjs:652-690`); pinned in two languages by `conformance/qualification-ledger-vectors.json` (329 lines) and the Node and Python runners (P:E-11 for the standard).
- Tamper evidence and the gate's enforcement of it: an edited capture, an edited source sibling, a removed ledger line, a hand-typed raw file and a late prior all fail; the commit gate blocks altered evidence whatever is staged; a CRLF rewrite is named as line endings, not tampering (`test/provenance.test.mjs`, `test/prior.test.mjs`, `test/hook.test.mjs`, `test/gate.test.mjs`, `test/handoff.test.mjs:124`; the lead's own gate run on every commit of this audit).
- Source siblings (ADR-0140, three days old): written LF-folded beside the capture, named and hashed in the same entry, verified like the capture by `verifyLedger` and the handoff, never indexed as a capture, an unnamed one a `source-unnamed` problem; an edited sibling fails the package (`CAPTURE-HASH-MISMATCH`) and the handoff (`handoff-chain-broken`). The first real corpora with siblings are the two new provenance and extraction projects (29 siblings, 9 MB).
- Capture boundaries: bodies over 16 MiB refused declared or streamed rather than truncated (the WARC standard records truncation, X:E-12; the kit refuses instead), binary responses refused by name, redirects into internal addresses refused, DNS rebinding pinned (`test/large-response.test.mjs`, `test/redirect-guard.test.mjs`, `test/transport.test.mjs:531`).
- Live fetch (ADR-0139): `--max-age 0` is in the Firecrawl argv and pinned (`test/transport.test.mjs:1132`); the pinned 1.25.3 fixture carries `rawHtml` and `cacheState`.
- Charset: BOM over header, legacy labels honoured, invalid bytes named, UTF-16 label without a NUL disbelieved (G7 tests in `test/transport.test.mjs`, `test/runtime.test.mjs`).
- Token hygiene: every error path redacts (`lib/dispatch.mjs:55-60`, `lib/mcp.mjs:163`, `:386`, `bin/collect-remote.mjs:106-111`); the explorer's thrown `Bearer ghp_...` came back redacted; stderr prints the variable's name only.
- Quote matching normalisation (NFKC, format characters, quotes, dashes, Markdown, wrappers, case) and the exact-match rule (`test/quotes.test.mjs`); a fabricated quote blocks under every policy.
- Freshness by the named capture's own date and supersession by the ledger's order (G8, G4; `test/checks.test.mjs`); future dates refused.
- Authorization derived at creation, never supplied: a missing judged section, a stale stamp, an ambient `GATE_OFF` each keep `buildAuthorized` false (`test/artifact-producer.test.mjs:98-161`).
- The thirteen checks are thirteen (`lib/checks.mjs:1047-1061`), each with a named rule and a test group; the review's own corpora (31) all pass with the warnings listed in section 1, which are the honest ones (keyless transports, single owner pages).

## 5. Iteration log (sequential passes by the lead; later passes knew earlier findings)

| Pass | Comparison set | New gaps | Confirmed | Retracted | Delta |
|---|---|---|---|---|---|
| 1 | W3C PROV-DM, in-toto attestation (P:E-04..07) | 9 (generation time: the ledger's `at` is a day written as a timestamp) | the ledger names the used entity (url), the generated one (raw, hash), the activity (transport, cmd); no agent/responsibility and no signature | "no signature" - the README states the ledger is self-attested and CI re-verifies; a decided limit, not an output gap | one medium-low |
| 2 | Sigstore Rekor, RFC 3161, RFC 6962 (P:E-08, E-09, E-10, E-13) | none | 9; the `--witness` option witnesses the page, not the ledger (ADR, decided) | third-party inclusion proofs and consistency proofs: a feature of a public log, not of a self-attested corpus | empty of new gaps; the kit finding on E-13 (a 9.7 KB capture of a 20 KB file graded `full`) feeds rank 3 |
| 3 | RFC 8785 JCS, SLSA provenance (P:E-11, E-12) | none | `canonicalJson` matches JCS (solid) | builder identity: the remote collector's run id is in the package; a local collector has none, optional | empty |
| 4 | trafilatura and htmldate, Mozilla Readability, jusText (X:E-01..06) | none beyond 3 and 7, both widened | 3 (every extractor grades by content: character floors, link density, stop-word density, readerability score), 7 (extractors keep the publication date) | the previous audit's rank 8 as a separate gap - it is the same gap as rank 6, merged into 3 | two confirmed |
| 5 | Firecrawl scrape, parse and advanced guide; Cloudflare challenge detection; Google soft 404; WARC response and truncation (X:E-07, E-08, E-14, E-16, E-15, E-09, E-10, E-13, E-12) | 5 (PDF truncation invisible) | 3 (Firecrawl does no content check; the `cf-mitigated` header is the documented signal; a soft 404 is defined by content) | WARC-Truncated as a gap: the kit refuses oversize bodies rather than truncating, named in section 4 | one medium |
| 6 | Wikipedia Verifiability, Reliable sources, No original research; Crossref (C:E-04..08) | none | the quote anchor is the kit's form of "directly supports" and rank 4 is where it falls short of that standard; the P/S/L grade mirrors the primary/secondary distinction but is editable and never validated against the host (section 9) | "secondary sources preferred" as a gap: the kit's purpose is the owner page, the opposite rule, by design | empty |
| 7 | UAX #15, UTS #46, WHATWG URL equivalence (C:E-09..11) | none | 10 (the checks that compare exact strings where `urlKey` is the kit's serialization); captures are hashed as bytes without normalisation, which is the right record; quotes normalise NFKC both sides (solid) | "normalise captures to NFC": a byte record must not be rewritten | empty |
| 8 | datasketch MinHash; Elicit and Perplexity citation practice (C:E-12..14) | none | 17 (an empty shingle set gives no judgement: the non-Latin sketch is null by construction); the kit's per-row quote anchor is at least Elicit's per-decision quote, and stronger than Perplexity's per-domain source rating | | empty |
| - | Project inspection (three explorers, lead probes, the external review re-verified) | 1, 2, 4 (empty needle), 6, 12, 13, 14, 16 | 8, 10, 11, 15, 17 | GATE_OFF passing (a documented override), fail-open when preflight throws (documented posture), `--refresh-days` semantics (ADR-0127), an empty JSON list captured as `full` (it is the fact) | the high ranks |

Passes 6 to 8 added no gap; passes 2 and 3 added none beyond rank 9. The audit converged on the comparison sets available: the three high ranks come from inspecting the kit's own outputs, which the comparison sets confirm (extractors grade by content, the handoff standards show what a consumer should be told) rather than discover. Gaps 1, 2, 4 (in part), 6, 12 to 16 came from project inspection, not from a comparison set.

## 6. Final assessment

Not negligible for the stated purpose, on three counts, each one contained change: the handoff
reads clean whatever the gate warned (rank 1), a package's authorization is believed rather
than re-derived and an unfetched file can ride in it as a capture (rank 2), and a capture is
never judged by its content, which the real corpora show mattering three times and the reviewing
agent catching by hand each time (rank 3). The twelve medium and low gaps are the previous audit's
open ranks, re-verified unchanged, plus five found by inspecting the consumer outputs. Nothing
found contradicts what the ledger proves; the gaps are in what the kit says about a passing
corpus, not in whether the pages were fetched.

**Unresolved.** Whether the Firecrawl scrape endpoint's JSON carries `numPages`/`totalPages`
as the parse endpoint does (one live scrape of a long PDF, about 60 credits, would tell); the
status code of a Cloudflare challenge response (X:E-15 names the header only); how SimHash forms
its features (C:U-7, KNOWN-UNKNOWN); Readability's behaviour when it returns null; whether
Common Crawl keeps non-200 responses (X:U-8). Whether rank 12's row-shaped line in a later
section is a table row or prose is a reading, not a fact.

**Not inspected.** Listed in section 1. In particular no Windows host ran here, so rank 17's
casing note is by reading.

**What would change the assessment.** A real corpus whose brief was handed to a builder who
acted on a single-source or partial-only closure (rank 1 from latent to observed); a package
validated PASS on a builder machine whose contract had changed after creation (rank 2); a
blocking unknown closed on a challenge page or an empty body in a real corpus (rank 3 from
"caught by hand" to "reached the gate"). Conversely, a reading of the brief as a draft the
builder is expected to verify against the audit snapshot would lower rank 1 to medium.

## 7. Optional improvement ideas (not required for accuracy, completeness or reliability)

- Source siblings are large: 13 siblings weigh 3.6 MB in the provenance project and 16 weigh 5.4 MB
  in the extraction project (a GitHub blob page's HTML is 485 KB). ADR-0140 chose to keep them; a
  per-corpus size line in `research.mjs --status` and the brief would make the cost visible.
- The collector's identity (machine, account or workflow run) is not in the ledger; PROV-DM's agent
  and SLSA's `builder.id` record it (P:E-04, E-12). The remote collector's run id reaches the package,
  the local one leaves nothing. A field, not a gap in outputs.
- A third-party witness of the ledger itself (a signed git tag, an RFC 3161 token over the chain
  head, P:E-09) would turn "self-attested" into "existed before"; the `--witness` option witnesses
  the page instead (decided).
- `research.mjs --status` prints search counts and an estimate; the balance is in `doctor`, which
  refuses `--transport`. AGENTS.md rule 5 and the README send the operator to `--status` for the
  budget. Documentation, or one line in `--status`.
- `decompose.mjs --dry-run` writes `research/MAP.md` with nine empty rows; a dry run that writes
  surprises. Documentation, or a `--dry-run` that prints the map it would write.
- The keyless converter emits `<table>` rows without a delimiter row, numbers ordered lists as
  bullets, drops `<img alt>` and leaves relative links unresolved (`lib/http-transport.mjs:312-356`).
  Readable, GFM-incorrect; the quote anchor still matches. Rank 10 covers the dates it drops.
- Re-fetch identity is the whole file including front matter (`lib/collect.mjs:137-143`): the same
  bytes through another transport produce a `.r2` capture and a new superseding row.
- Documentation drift still open from 2026-10-03: `research-kit/README.md:119` names
  `start-research.yml` (no such workflow); `README.md:389` documents `property-replay --case
  <case-id>` while the flag takes a `.json` file; `researcher-release validate --genesis/
  --checkpoints` are accepted and dropped (`bin/researcher-release.mjs:71-72` vs
  `lib/release-validator.mjs:974`); `docs/ARCHITECTURE.md` rows for `warc.mjs`, `artifact.mjs`,
  `handoff.mjs`, `audit.mjs` and `mcp.mjs` do not mention how they treat ADR-0140's siblings.

## 8. Source audit

Every external claim this audit rests on was collected through the kit into one of the three
nested projects; each project's gate is PASS and its handoff exits 0, so every cited page is on
disk with its ledger entry (and, for the first time, its source sibling). Owner pages throughout,
type P; `full` captures except where the row says otherwise.

| Claim | Source | Verifies | Row | Confidence |
|---|---|---|---|---|
| A derivation record names the generated and used entity; activity, agent and generation time are what let a consumer judge trust | W3C PROV-DM | ranks 9, optional agent field | P:E-04 | VERIFIED |
| An attestation binds subject digests to a predicate and is signed; canonicalization should not be relied on for security | in-toto attestation spec | what a signed statement adds to a self-attested ledger | P:E-05..07 | VERIFIED |
| Inclusion proofs and third-party monitors are what a transparency log adds | Sigstore Rekor overview and openapi.yaml | optional witness idea; kit finding on E-13's grade | P:E-08, E-13 | VERIFIED (signed entry timestamp: UNKNOWN, text only in the sibling) |
| A time-stamp token proves a hash existed before a time, from a trustworthy clock | RFC 3161 | rank 9 | P:E-09 | VERIFIED |
| Merkle tree hash and consistency proofs | RFC 6962 | retracted comparison (public log feature) | P:E-10 | VERIFIED |
| Canonical JSON: sorted keys, ECMAScript numbers, no whitespace | RFC 8785 | section 4 (solid) | P:E-11 | VERIFIED |
| Build provenance records the builder's identity | SLSA v1.0 | optional idea | P:E-12 | VERIFIED |
| Extractors grade by content: cascades, precision and recall presets, readerability thresholds (140 chars per node, score 20, 500 chars to return), paragraph classes by length and stop-word density; keep-everything converters sit near 0.53 precision | trafilatura usage and evaluation pages, Mozilla Readability README, jusText | rank 3 | X:E-01..06 | VERIFIED |
| Firecrawl parses PDFs at one credit a page, caps with maxPages, reports numPages and totalPages; treats 2xx/304 as a clean load and does no content check | Firecrawl scrape, parse, API reference, advanced guide | ranks 3, 5 | X:E-07, E-08, E-14, E-16 | VERIFIED |
| Every challenge response carries `cf-mitigated: challenge` | Cloudflare developers | rank 3 | X:E-15 | VERIFIED (status code UNKNOWN) |
| A soft 404 is a 2xx whose content suggests an error, is empty or is an error message | Google Search Central | rank 3 | X:E-10 | VERIFIED |
| A WARC response record keeps the full response; truncation is recorded with a reason | WARC 1.1 / IIPC | section 4 (the kit refuses instead) | X:E-12, E-13 | VERIFIED |
| A source must directly support the material; primary sources only for straightforward facts; no synthesis | Wikipedia Verifiability, Reliable sources, No original research | the P/S/L grade and the quote anchor as the kit's form of "directly supports" (section 4); rank 4's weak anchors fail that standard | C:E-04..06 | VERIFIED |
| A work is keyed by DOI and carries its landing URL and dates | Crossref REST API | optional (DOI as identity for scholarly pages) | C:E-07, E-08 | VERIFIED |
| Canonically equivalent strings differ in bytes; compare after NFC | UAX #15 | section 4 (quotes NFKC both sides); captures are not normalised before hashing, which is correct for a byte record | C:E-09 | VERIFIED |
| Host mapping and URL equivalence by serialization: lowercase host, default port dropped, empty path to "/", trailing dot kept | UTS #46, WHATWG URL | rank 10 (`urlKey` is the kit's serialization; the checks that bypass it) | C:E-10, E-11 | VERIFIED |
| MinHash estimates Jaccard over the set the caller forms; an empty set gives no judgement | datasketch | rank 17 (non-Latin sketches) | C:E-12 | VERIFIED |
| Elicit shows the supporting quote for every decision; Perplexity rates sources per domain | Elicit help centre, Perplexity help centre | the quote anchor compared (section 4) | C:E-13, E-14 | VERIFIED |
| The four findings of the external review (validator trusts the manifest, blank Raw skips review, MCP arrays unchecked, MCP link concatenation) | a review the user pasted, tool and copy version unstated | ranks 2, 6, 13 | none (not a fetched page); re-verified here by reading the code paths, two also probed | VERIFIED by reading |
| The external review's follow-up: machine `evidencePolicy=strict` promotes three checks while CLI `--strict` promotes all; the brief inputs hash changed within format 1.x (ADR-0069); a blank Raw cell resolves to the URL's latest capture | the same review, second message, read-only probes on a copy that then vanished | the two conditions on rank 2 and the fixture note on rank 6 | none (not a fetched page); verified here against `lib/preflight.mjs:49-53`, ADR-0069, `lib/brief.mjs:85-120`, `lib/artifact.mjs:236`, the manifest schema | VERIFIED by reading |

Everything about the kit itself was read in the repository at `a4ae8f6`; no claim about the kit
rests on a fetched page.

## 9. Kit findings from this run (the kit used on itself)

| Finding | Command and observation | Disposition |
|---|---|---|
| `research.mjs --status` prints no account balance, only this project's search counts and an estimate; AGENTS.md rule 5 and the README call it the budget check | `research.mjs --status --transport firecrawl-cli` in three projects; the balance appears in `doctor` (`firecrawl-auth  authenticated, 1020 credits`), which refuses `--transport` | documentation, section 7 |
| `decompose.mjs --dry-run` writes `research/MAP.md` | "wrote research/MAP.md", exit 0, nine rows, zero pages | documentation or behaviour, section 7 |
| A plan search re-runs on every collection run and spends again; a researcher's second run over an "all cached" plan collected one more page and went one scrape over budget | extraction project, run 2 | ADR-0127 (decided); the researcher's own mistake recorded in its commit |
| A GitHub blob page's capture (9.7 KB of a 20 KB file) is graded `full`; the missing text is in the 485 KB sibling | provenance project E-13 | feeds rank 3: the grade is the transport's, not the content's |
| A `[quote:]` copied from a capture's front-matter title is `quote-not-found` | citation project, during review | by design (the body is the page); worth one line in the README |
| `collection-attempts/unknown-attempted` warns for a KNOWN-UNKNOWN that budgeted no fetch | citation project U-7 | the check's intent; accepted in the brief |
| Search-derived rows are typed `S` even for a vendor's own documentation page; the researcher retyped them `P` by hand and the gate accepted it | extraction project | the P/S/L grade is editable and unvalidated (section 2 of the explorer's gate report); not a gap in itself, the review step owns it |
| `doctor` without the 1.25.3 CLI first on PATH reports the machine's 1.24.6 | citation project | correct behaviour; the pin is a documented requirement |
| `doctor`'s committed-key scan read the nested projects' captures: its skip matched the relative path `research/raw`, so only the root's raw folder was outside it, and the F26 self-scan test went red on every CI leg of PR #238 when a Google page's source sibling (ADR-0140) carried Google's own public Maps keys | the archive-tree leg on 5c158a3; reproduced with `git archive HEAD` and the suite | fixed in this PR (9b177bd): the skip applies at any depth; a capture is page content wherever the project sits |
| decompose's compound-topic split (ADR-0085) searched the fragment "How provenance" alone and spent three scrapes on secondary pages (a museum, the FAIR Cookbook, Springer); the researcher kept them as context rows, one was cited as context, and the RR-9 floor test then rejected it on every CI leg | provenance project E-01..E-03; `selftest search-seam` | the citation was dropped (fd779a2); the split is a kit defect candidate: a fragment of two common words is not a query, and the floor that guards scrapes at run time does not guard decompose's |
| `brief.mjs --force` redrafts from scratch: the reviewed Contradictions, Known unknowns and Decision survive only in the `.bak`, and the ADR-0055 remedy text says "carry your judgements over" without saying that means by hand | redrafting the provenance brief after the contract changed | documented behaviour; a redraft that keeps answered judged sections under a fresh stamp would remove the hand step (optional idea) |
| The suite judges the repository's own corpora (F26 self-scan, RR-9 floor), but the commit gate runs the suite only for commits that stage `research-kit/`; four docs-only corpus commits therefore passed the gate and turned CI red | PR #238's first head | a documentation note at least: a corpus commit in this repository is a suite-relevant change; whether the gate should run the suite for `docs/decisions/**/research/` is a decision for an ADR |

Credits spent by this audit: `doctor` read 1,020 before the first collection and 953 after the
last, so 67 in all; the three ledgers record 43 scrapes (16, 13 and 14), two refused fetches
and seven searches (the kit estimates a search at two credits), which the researchers' own
per-run tallies do not add up to exactly - the balance is the vendor's number, the tallies are
estimates. Overrides taken: none.

## 10. Fresh-eyes design review (brainstorming, Review mode; ideas, not requirements)

Run after the audit by a reviewer who had not written the kit, over both audits, the architecture
map, the ADR index and the code cited. Ranked by value for cost; none is required for accuracy,
completeness or reliability beyond what section 3 already asks, and none is implemented.

1. **One verdict summary, rendered once.** `lib/render.mjs` owns `renderFindings` with one caller
   (`bin/preflight.mjs`). A `verdictSummary(verdict)` - the gate line plus warnings grouped by rule,
   naming the row or unknown - consumed by the brief (`lib/brief.mjs:271-279`), the audit
   (`lib/audit.mjs:190`), the package README-FIRST (`lib/artifact.mjs:440`) and the MCP text
   (`lib/mcp.mjs:379`) removes class (c) and ranks 1, 14 and part of 13 in one place. Small; the
   brief grows one non-judged section (an amendment to BRIEF_SECTIONS, ADR-0014); no new command
   or check. Shape: a `warnedProject` fixture (one uncited capture, one partial-only closure, one
   single-source closure) reused by the brief, audit, artifact and MCP tests; the renderer with its
   own test; then each consumer in its own commit with its map row; verified by `selftest brief
   audit artifact mcp`, the root and nested gates unchanged, and one real brief redrafted and
   compared.
2. **Grade the capture in one place, from facts the transports report.** Three adapters each
   compute `completeness` today (`firecrawl.mjs:239-248`, `http-transport.mjs:372-397`,
   `browser-transport.mjs:359`) and the collector stamps what they declare. Adapters return facts
   (status, final host, dropped siblings, `metadata.error`, `numPages`/`totalPages`, the challenge
   header); one collector-side grader writes `completeness` and `omitted`. Removes class (b) and
   ranks 3 and 5. Medium; the `suspect-capture` rule is a new hygiene kind, so it needs an ADR under
   ADR-0117, and ADR-0037 is honoured by grading on what the page or vendor says, never on word
   counts.
3. **Finish ADR-0015: one capture resolver, one URL identity.** ADR-0015 made `captureOf` the owner
   and rejected per-consumer predicates "because they drift"; they drifted again (`checks.mjs:56`
   `ownCapture`, `corpus.mjs:746-751` `captureOf`, `artifact.mjs:309`). `captureOf` returning
   `{ capture, named }` lets freshness and review resolve through it; `urlKey` in `checks.mjs:610`,
   `:374` and `:733` as `:717-727` already does. Removes classes (a) and (d), ranks 6 and 10 and the
   blank-Raw half of rank 2. Small; a bug fix of a decided design, no ADR.
4. **Decide the release-validator path.** About 3,900 lines of code and 2,900 of tests, twelve
   schemas, three vector files, the Python floor (ADR-0078) and a cross-language CI step - roughly a
   sixth of the kit - imported by nothing on the research path, "an open decision" in
   `docs/ARCHITECTURE.md:76-79` since 2026-09-30 and "not inspected" by both audits. Either its own
   repository or an ADR that says "stays, reference-only". No audit rank; simplicity and suite time.

The reviewer's order: 1 first (the one high rank in the handoff, smallest cost, no freeze
question), 3 second (cheapest, two classes, prepares 2). Not to touch, with the reviewer's
evidence: the thirteen-check registry and the one verdict function (do not add a fourteenth check
for rank 3; grade at collection); the ledger; ADR-0037's refusal of a thin-capture heuristic; the
transport seam's pinned shape; the freeze.

## 10. Outcome (rank 9 fixed 2026-10-17; the rest re-probed 2026-10-17)

A rank's line numbers describe the code it was written against, so every rank below was
re-probed against `dd5026f` - thirteen days and 253 commits after this audit's base
(`a4ae8f6`). A rank is closed when the probe finds the defect gone, and a rank the audit
left UNRESOLVED stays unresolved until its named observation is made.

| Rank | State at `dd5026f` | Evidence |
|---|---|---|
| 1 | **closed upstream** - the drafted brief names the warnings and their count | `renderGateWarnings` (`lib/render.mjs`) writes the count and each warned rule with its row or unknown; `lib/brief.mjs:301` calls it, and the PASS line (`lib/brief.mjs:276-277`) says disclosed unknowns and gate warnings still apply |
| 2 | **closed upstream** - approval is re-derived from the checked corpus, and its blank-Raw half resolves through `captureOf` | `lib/artifact-validator.mjs:418-421` derives `buildAuthorized: status === 'PASS' && claimed` (ADR-0160, `dfaf34c`); `lib/artifact-state.mjs:131-132` counts a row it cannot resolve as not reviewed rather than skipping it |
| 3, 5, 7, 8, 11, 12, 13, 14, 16, 17 | **open** by probe - the token the named remedy would have introduced is absent from `lib/` and `bin/` | no `suspect-capture`, `numPages`/`totalPages`, `page_age`/`sourceDate`, `table-header-renamed` or `pathToFileURL`; `INTEGRITY_RULES` (`lib/gate.mjs:613`) still omits `raw-missing`, `raw-outside`, `raw-unreadable` |
| 6 | **not open as written** - its named remedy is contradicted by a later decision | `lib/checks.mjs:50-58` judges freshness by the capture the row NAMES (`ownCapture`) and deliberately does not fall back to `captureOf`: judged by the URL's latest capture, a row with a blank Raw cell "borrowed a fresh fetch's date, lost its stale warning, and drew a date-mismatch telling the operator to write the later date into the row" (found 2026-10-03, review of G8). Doing what rank 6 asks would restore that defect |
| 9 | **fixed** | `dd5026f`: a fetch's ledger `at` is the moment it happened (`nowIso(now)`), not midnight of its day; the `retrieved` day is unchanged |
| 10 | **closed upstream** | `d997b85 fix(checks): compare evidence URLs by adopted page identity` keys supersession, the duplicate-url rule and the fresher-row hint on `urlKey` |

Two of these need a decision before they can be built, and neither is a bug fix of a decided
design: rank 3's remedy is the `suspect-capture` hygiene rule, a new kind and so an ADR under
ADR-0117, grading on what the page or the vendor says and never on word counts (ADR-0037);
and rank 5 stays UNRESOLVED because whether the Firecrawl scrape endpoint's JSON carries
`numPages`/`totalPages` (not only the parse endpoint's) is unverified.

This is a probe of the ranks, not a re-audit: it has re-read the named code, not re-run the
audit's explorers.
