# Output-reliability audit - 2026-10-03

Fetchproof has a strong evidence-integrity foundation, but this audit retained eight
material gaps between source capture and build authorization. The most consequential
reproductions let a requirement disappear from validation, authorize a brief without its
required review sections, or delete technical conditions while converting source HTML.

This report records findings and proposed corrections. It implements none of them and
does not adopt a new design or lift the feature freeze. Its quality standard is the kit's
own purpose: accurate capture, explicit coverage of blocking unknowns, and a reviewed
handoff before a builder relies on the research.

## 1. Current state and evidence boundaries

- **Audited source:** [`74c0791e1054e48d31c113eb269e58f09a5c2bb1`](https://github.com/StepenkoAnatoli/Fetchproof/tree/74c0791e1054e48d31c113eb269e58f09a5c2bb1).
- **Local suite revision:** `4e12f689fdb2e94f6ef501251b7f46003b99f32b`, on Windows with
  Node v24.20.0. The eight intervening commits were inspected. Final targeted probes
  loaded the changed library modules from the audited revision in memory, alongside the
  unchanged local modules; they did not modify corpus files.
- **Publication base:** `38e6136845eb72297d2db3d930b88c4ba118debe`. The subsequent
  Firecrawl CLI 1.25.3 update does not change the implementations cited by G1-G8. This is
  still a report of the pinned audit, not a claim that the entire publication base was
  independently audited or its full suite rerun.
- **Purpose, VERIFIED:** the kit collects a research corpus, connects evidence to
  declared unknowns, runs preflight, produces a brief, and derives a packaged handoff's
  `buildAuthorized` decision.
- **Inspection:** principal collection, corpus parsing, provenance, preflight, brief,
  and handoff paths; HTTP and browser extraction; relevant configuration and tests;
  portions of artifact packaging, WARC, MCP, workflows, and release validation; relevant
  architecture decisions and history. Not every file or historical document was read
  line by line. The optional release/FI validator received only partial inspection.

Evidence labels used below:

| State | Meaning in this report |
|---|---|
| VERIFIED | Directly inspected in project code and, for the ranked mechanisms, reproduced with targeted probes. This does not measure production incidence. |
| WELL-SUPPORTED | Official external documentation was fetched, but the comparison confidence is capped because no Fetchproof ledger-backed capture was created. |
| INFERRED | A consequence, priority, estimate, or recommendation derived from the observed mechanism. |
| UNKNOWN | Not established by the available inspection or execution. |

The audit ran the following local suite selection from the clean review checkout:

```text
node fetchproof/bin/selftest.mjs checks corpus quotes provenance brief handoff transport
```

**Recorded result: 267 passed, 0 failed, 1 unsupported, in 82.6 seconds.** The unsupported
case was `corpus > readText and sha256File refuse what is not a regular file, without
opening it`: Windows refused the required symlink (`SYMLINK-NOT-PERMITTED`). The runner
exited 1 because of that unsupported case. This is not a claim of an entirely green run
or a full-suite run on `74c0791`.

The installed kit's doctor reported collector readiness with no blockers. The original
audit's no-write constraint prevented creating the prescribed comparison corpus. Its
external comparisons are therefore **unledgered official-source fetches**, with no new
E-row identifiers. The code findings do not depend on competitors having more features.

The G1-G8 identifiers below are **local to this report**, not the G-prefixed rows in
[`review-2026-10-02-external-findings.md`](review-2026-10-02-external-findings.md).

## 2. Ranked gap list

Impact ranks and priorities are inferred from the reproduced behavior. Frequency in real
user corpora remains unknown.

| Rank | Gap | Affects | Impact | Project evidence | Confidence |
|---|---|---|---|---|---|
| G1 | Missing review sections and stale brief inputs can retain build authorization | Completeness, reliability | High | `briefState` and `deriveState`; both probes returned `APPROVED_BRIEF` and `buildAuthorized: true` | VERIFIED |
| G2 | Malformed identifiers silently remove requirements from validation | Completeness, reliability | High | `readCorpus` ID filters; 12 table rows became 11 unknowns without warnings or failures | VERIFIED |
| G3 | HTML conversion deletes comparison expressions | Accuracy, completeness | High | `htmlToMarkdown`; a list condition `x < 5 and y > 2` lost its middle terms | VERIFIED |
| G4 | Evidence supersession can select the wrong current capture | Accuracy, reliability | High | `supersededRows`; day-level date and table order disagree with an A -> B -> A fetch ledger | VERIFIED |
| G5 | Browser output omits origin status and can classify an error page as full | Accuracy, reliability | High | `browser-transport.scrape`; synthetic 403 DOM yielded `ok: true`, empty status, and `full` | VERIFIED mechanism; live incidence UNKNOWN |
| G6 | URL normalization merges unproven equivalents | Accuracy, completeness | High when affected | `urlKey` and `cacheDecision`; a cached `/api` satisfied `/api/` without an observed redirect | VERIFIED collision; affected-site impact INFERRED |
| G7 | Non-UTF-8 page bytes can be silently corrupted | Accuracy | Medium | `boundedText`; a declared Windows-1252 euro sign decoded to a replacement character | VERIFIED |
| G8 | Freshness trusts an editable table date without reconciling the fetch | Accuracy, reliability | Medium | `unknownClosure` and hygiene; changing only E-19's date removed its stale warning | VERIFIED |

### G1 - Brief approval survives missing review sections and stale inputs

**Evidence:** [`brief.mjs:64`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/brief.mjs#L64),
[`artifact.mjs:227`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/artifact.mjs#L227),
and [`checks.mjs:705`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/checks.mjs#L705).

`briefState` checks whether judged sections contain `**TODO**`. A missing section returns
empty text, so it contains no TODO. With the auto-draft marker present, that is enough to
return `authored`; `deriveState` treats that as completed brief review. The finding is
about missing review sections, not a wholly absent brief file.

Reproduction: read the repository's passing corpus and replace only the in-memory brief
text with `_Auto-drafted\n\n# Brief\nNo review sections remain.\n`. Pass that snapshot to
`deriveState`, using an absent config path for default policy. Observed:

```json
{"state":"APPROVED_BRIEF","buildAuthorized":true,"briefReviewed":true,"gate":"PASS"}
```

A separate snapshot supplied answered sections and a stamp with the original
`briefInputsHash`, then changed one evidence finding. The stamp no longer matched;
`hygiene/brief-stale` appeared as a warning, yet authorization remained true. Thus the
current approval boundary permits both missing required review and stale review inputs.

### G2 - Malformed identifiers silently remove requirements

**Evidence:** [`corpus.mjs:527`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/corpus.mjs#L527).

`readCorpus` filters unknown IDs through `/^U-\d+$/i` without recording a problem for
discarded data rows. Evidence and map rows have analogous filters. Downstream checks
receive only the accepted rows.

Reproduction: a read overlay appended this row to the existing unknown table:

```text
| U_99 | Is the service usable? | Blocks the design | OPEN | |
```

Observed: the Markdown table parser held 12 rows, including `U_99`; the corpus contained
11 unknowns; `problems` was empty; and `runChecks` had no warnings or failures. A typo can
therefore remove a blocking question instead of reporting that it needs correction.

### G3 - HTML conversion deletes comparison expressions

**Evidence:** [`http-transport.mjs:308`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/http-transport.mjs#L308)
and the browser's use of the same converter at
[`browser-transport.mjs:241`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/browser-transport.mjs#L241).

Some inner-element conversions decode entities before an outer pass strips markup. The
outer pass can then interpret decoded comparison operators as a tag. Direct calls to
`htmlToMarkdown` produced:

| Input context, using `&lt;` and `&gt;` in the HTML | Observed Markdown |
|---|---|
| Paragraph: `Allow when x < 5 and y > 2.` | `Allow when x < 5 and y > 2.` |
| List item with the same sentence | `- Allow when x 2.` |
| Table cell: `x < 5 and y > 2` | `x 2` |
| Heading: `When x < 5 and y > 2` | `## When x 2` |

This changes technical meaning before hashing. The ledger and quote checks can faithfully
verify the damaged capture without detecting what the converter removed.

### G4 - Supersession disagrees with actual fetch order

**Evidence:** [`checks.mjs:561`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/checks.mjs#L561)
and the collector's reuse of standing evidence rows at
[`collect.mjs:299`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/collect.mjs#L299).

`supersededRows` groups exact URLs and sorts by `retrieved`. Same-day ties retain table
order; it does not consult the fetch ledger. The collector can legitimately reuse the
same capture file and standing evidence row when identical content returns.

Reproduction: E-01 points at capture A, E-02 at B, both for one URL on October 3. The
ledger records successful fetches A, then B, then A. An unknown cites E-02. The check
marks E-01 superseded by E-02 and passes because E-01 is no longer cited, although the
latest fetch is A. Reordering the evidence rows changes the selected current row without
changing the fetches. The recent cache-ordering fixes do not change this separate check.

### G5 - Browser capture cannot enforce the collector's origin-status rule

**Evidence:** [`browser-transport.mjs:237`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/browser-transport.mjs#L237)
and [`collect.mjs:240`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/collect.mjs#L240).

The browser transport recognizes Chromium's own error pages, but accepted DOM output
carries `statusCode: ''` and the requested URL. It does not carry the final navigation
status or final URL. The collector rejects numeric HTTP status codes of 400 or above;
that protection cannot act on an empty status.

Reproduction: inject the transport's `render` seam with process status 0 and HTML having
a `403 Forbidden` title, heading, and more than 1,500 characters of refusal text inside
`main`. Observed: `ok: true`, `statusCode: ""`, `completeness: "full"`. This was a
synthetic DOM probe, not a live browser request to an HTTP 403 endpoint.

### G6 - URL keys conflate resources without observed equivalence

**Evidence:** [`core.mjs:994`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/core.mjs#L994)
and [`cacheDecision` in corpus.mjs](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/corpus.mjs).

`urlKey` drops scheme, `www.`, and trailing path slashes. Each of the following becomes
`//example.com/api`:

```text
https://example.com/api
https://example.com/api/
http://example.com/api
https://www.example.com/api
```

A synthetic index containing only a fresh capture of the first URL returned
`hit: true, reason: "fresh"` for the second, with the first URL's capture as the entry.
No redirect was supplied. This can substitute content or suppress a distinct planned
fetch. The incidence depends on the target sites; it was not measured.

The distinction is supported by [RFC 3986, section 6.2.4](https://www.rfc-editor.org/rfc/rfc3986#section-6.2.4):
trailing-slash equivalence can be learned from observed protocol behavior rather than
assumed for arbitrary resources. External-source confidence: WELL-SUPPORTED, unledgered.

### G7 - Declared page encodings are ignored

**Evidence:** [`runtime.mjs:128`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/runtime.mjs#L128)
and the HTTP fetch path in
[`http-transport.mjs`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/http-transport.mjs#L704).

`boundedText` uses `new TextDecoder()` without the page's charset. Reproduction: pass a
Response declaring `Content-Type: text/plain; charset=windows-1252`, containing ASCII
`Price: 10 `, byte `0x80`, and a final period. Observed output is `Price: 10 �.` rather
than `Price: 10 €.`, without an error. The finding is about page decoding; it does not
justify changing the encoding of JSON API responses.

### G8 - Table dates can change freshness without a supporting fetch

**Evidence:** [`checks.mjs:301`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/checks.mjs#L301)
and [`checks.mjs:722`](https://github.com/StepenkoAnatoli/Fetchproof/blob/74c0791e1054e48d31c113eb269e58f09a5c2bb1/research-kit/lib/checks.mjs#L722).

Freshness reads `row.retrieved`; it is not reconciled with the capture's supporting fetch.
Reproduction on October 3: run `runChecks(corpus, { maxAgeDays: 1 })`, then change only
E-19's in-memory `retrieved` value from `2026-09-20` to `2026-10-03`. The U-1 stale-evidence
warning disappears, without a fetch or date-mismatch finding. Other rows' stale warnings
remain. Blanking all retrieval dates also produces no missing-date diagnostic; the
observed remaining warnings concern duplicate URLs.

## 3. Error-reduction recommendations

These are proposed remedies, not approved implementation designs. Costs include focused
regression coverage and are rough **INFERRED** engineering estimates.

| Gap | Smallest supported correction and error prevented | Rough cost | Caveat |
|---|---|---|---|
| G1 | At the artifact approval boundary, require all judged sections to be present, answered, and TODO-free; reuse `judgedSection`. Require a current brief input hash before authorization. This prevents missing or stale review from becoming build permission. | 1-2 days | Older unstamped briefs need an explicit compatibility/review path. Research preflight need not require a brief before one can be drafted. |
| G2 | Validate every non-placeholder table row's ID before filtering; produce a blocking diagnostic with its line. This prevents dropped requirements. | 0.5-1 day | Preserve intentional template placeholders. Test malformed rows among valid ones, not just an entirely empty table. |
| G3 | Complete structural tag handling before decoding text, so decoded operators cannot re-enter tag stripping. Test lists, headings, tables, and code expressions. | 1-2 days | A focused correction may suffice; a new parser dependency is not established as necessary. Avoid double-decoding. |
| G4 | Share a ledger-backed latest-fetch rule between capture selection and supersession, including reused files. Exercise collect -> reopen -> preflight with A -> B -> A. | 1-2 days | Intentional historical citations need an explicit rule rather than accidental table-order semantics. |
| G5 | Obtain final navigation status and URL from browser instrumentation and feed the existing collector policy. Expose uncertainty until that metadata is available. | 2-4 days | Error responses can themselves be legitimate research subjects. A title blacklist is not a reliable substitute for status metadata. |
| G6 | Preserve scheme, hostname, and non-root trailing slash in identity; use observed redirects for aliases. This prevents substituting a different resource. | 1-2 days | May increase requests where the heuristic was right. Reindex existing captures rather than automatically refetching everything. |
| G7 | Honor supported charset declarations and byte-order marks at the page boundary; make invalid or unsupported decoding visible. | 1-2 days | Full browser-style encoding detection may be unnecessary. Explicit refusal is better than silent replacement. Keep API JSON behavior separate. |
| G8 | Derive or reconcile freshness through the successful fetch supporting a capture, and diagnose missing/contradictory dates. | 0.5-1 day | A later identical refetch can reuse an older file. Fetch recency still does not establish the publisher's claim is current. |

The strongest class-level checks are cross-stage invariants:

1. Every contract data row becomes either a validated requirement or an explicit error.
2. Reordering Markdown rows cannot change which evidence is current.
3. Changing evidence invalidates approval that depended on its previous state.
4. Equivalent visible text retains its factual content across paragraphs, lists,
   headings, and table cells.
5. Capture status, URL identity, retrieval date, and ledger history agree before they are
   used to justify collection success or freshness.

These target the demonstrated failure classes; isolated helper tests alone do not cover
disagreements between stages.

## 4. What is already solid

The following observations are **VERIFIED within the inspected and tested scope**, not
blanket guarantees about every input:

- The central thirteen-check registry covers unknown closure, citations, map coverage,
  provenance, capture completeness, supersession, corroboration, and corpus hygiene.
  The tests exercise missing citations, invalid statuses, uncovered map dimensions,
  duplicate identifiers, and malformed inputs. The unmodified corpus had no warnings
  or failures in the baseline probe. See [`checks.test.mjs`](../fetchproof/test/checks.test.mjs).
- [`provenance.mjs`](../fetchproof/lib/provenance.mjs) checks chain structure and capture
  hashes and refuses appending to a damaged chain. This detects inconsistent stored
  evidence; the documented boundary is self-attestation, not independent publisher
  authentication or proof of semantic truth.
- Quote anchors and the tested handoff path connect quoted text to captured material.
  They help identify unsupported quotations and missing evidence. Capture fidelity
  remains a prerequisite, as G3 demonstrates.
- Collection includes byte limits, bounded operations, error-status rejection when
  provided by a transport, path-boundary checks, and guarded ledger writes. G5 concerns
  missing browser metadata, not an absence of error handling across the collector.
- Newer cache-selection fixes and shared search-provider coordination resolve real
  consistency issues. Already-fixed cache selection and duplicate search orchestration
  were excluded; G4 uses a distinct supersession rule.
- Artifact authorization is derived by rerunning the gate and inspecting review state,
  rather than accepted as a caller assertion. Preserve that boundary while correcting
  G1's predicates.

No accidental removal of a crucial capability was proven in the history inspected.
The [feature freeze](adr/0117-feature-freeze-from-0-9-0.md) and
[separate validator layer](adr/0029-the-validator-layer-arrives-as-a-source-not-a-donor.md)
are deliberate design choices. The entire history was not audited.

## 5. Iteration log

These were **six sequential passes by one agent**, with later passes retaining earlier
findings. Comparisons used documentation alongside project inspection and probes, not
installed-product performance benchmarks. The log records discovery and promotion order;
the final report numbers are ranked by impact.

| Pass | Comparison set | New/promoted | Confirmed/refined | Retracted/excluded | Delta |
|---|---|---|---|---|---|
| 1 | Firecrawl, Crawl4AI | G3, G4, G5 | Capture fidelity, completeness, current evidence | Browser feature parity | Three material candidates |
| 2 | Scrapy, Zyte | G6, G7 | G5; API success versus page outcome | Broad transport success as proof of page success | Two additional gaps |
| 3 | Frictionless, Great Expectations | G2, G8; G1 candidate | Input validation and freshness | Generic validation advice without a failing input | Two gaps plus an approval candidate |
| 4 | DVC, lakeFS | G1 confirmed and promoted | G4; stale-input approval | Cache-selection defects already fixed upstream | One additional high-impact gap |
| 5 | bagit-python, in-toto | None | Integrity versus approval | Mandatory signatures; an MCP end-of-stream suspicion that did not reproduce | No new high-impact gap |
| 6 | Browsertrix, ArchiveBox | None | G3, G5, G7 | Full archival replay parity | No new high-impact gap |

The last two passes met the requested stopping rule. They are not independent reviews.

## 6. Final assessment and unresolved scope

**The remaining gaps are not negligible for the stated purpose.** This is an **INFERRED**
assessment grounded in the verified mechanisms: incompletely reviewed research can be
authorized, a declared blocking question can be omitted, and technical meaning can change
before a capture is preserved. Prioritize G1-G3, then identity and ordering in G4/G6,
followed by browser status, encoding, and freshness reconciliation.

- **UNKNOWN:** incidence and downstream harm in real user corpora.
- **Not exercised:** live paid-provider collection, authenticated GitHub collection
  workflows, or a live browser request returning an origin error response.
- **Not fully inspected:** optional release/FI validation, every workflow/export
  combination, and the entire architecture and ADR history.
- **Not completed:** a ledger-backed comparison corpus or the full suite on a complete
  checkout of the pinned audited revision.
- **Environment limitation:** the selected suite's symlink-dependent case remained
  unsupported on this Windows environment.

Corrected behavior for the reproduced cases, regressions spanning the affected stages,
and a full run on the corrected revision with filesystem-test support would change this
assessment. More passing happy-path tests alone would not settle these findings.

## 7. Optional improvements

None proposed. The evidence supports the targeted corrections without a broader redesign.

## 8. Source audit

All sources below were fetched from official primary documentation. Every comparison
claim is capped at **WELL-SUPPORTED** because its fetch is **unledgered**. **Fetchproof
evidence row: none for every entry.** No comparison claim below rests on recollection.
The ranked defects are supported by project code and observed behavior, not feature
differences between tools.

| Official source | Claim used in this audit | Source type |
|---|---|---|
| [Firecrawl: Scrape](https://docs.firecrawl.dev/features/scrape) | API success and target-page HTTP status are separate outcomes. | Product documentation |
| [Crawl4AI: Page interaction](https://docs.crawl4ai.com/core/page-interaction/) | Explicit wait conditions can define when dynamic content is ready for capture; a completeness lens, not a parity demand. | Project documentation |
| [Scrapy: Requests and responses](https://docs.scrapy.org/en/latest/topics/request-response.html) | Responses expose URL/status metadata and explicit text-encoding handling. | Framework documentation |
| [Zyte API: Errors](https://docs.zyte.com/zyte-api/usage/errors.html) | Successful API operations can return unsuccessful target-site responses. | Product documentation |
| [Frictionless: Validating data](https://framework.frictionlessdata.io/docs/guides/validating-data.html) | Structured diagnostics identify malformed rows and fields. | Framework documentation |
| [Great Expectations: Create an Expectation](https://docs.greatexpectations.io/docs/core/define_expectations/create_an_expectation/) | Data assumptions can be explicit assertions with visible validation failures. | Framework documentation |
| [DVC: Status](https://doc.dvc.org/command-reference/status) | Changed dependencies, missing outputs, and changed output hashes are distinct status conditions. | Tool documentation |
| [lakeFS: Internals](https://docs.lakefs.io/concepts/internals/) | Immutable committed states and references identify specific versions. | Project documentation |
| [Library of Congress: bagit-python](https://github.com/LibraryOfCongress/bagit-python) | Validation distinguishes checksum mismatches, missing files, and unexpected files. | Official repository documentation |
| [in-toto: Verify](https://in-toto.readthedocs.io/en/latest/command-line-tools/in-toto-verify.html) | Artifact integrity and satisfaction of declared workflow rules are separate verification concerns. | Project documentation |
| [Browsertrix Crawler](https://github.com/webrecorder/browsertrix-crawler) | Browser capture uses the Chrome DevTools Protocol; a concrete comparison for navigation instrumentation. | Official repository documentation |
| [ArchiveBox plugin contract](https://github.com/ArchiveBox/abx-plugins) | Successful, empty, skipped, and failed extraction outcomes are represented separately. | Official repository documentation |
| [RFC 3986, section 6.2](https://www.rfc-editor.org/rfc/rfc3986#section-6.2) | Resource equivalence follows justified normalization rules or observed protocol behavior. | Internet standard |

## 9. Outcome (2026-10-03, branch `main-axuse3`)

Every ranked gap was reproduced on this branch before it was changed, and each fix is one
commit through the kit's commit gate (the full suite, ADR-0120), red-first. The fixes were
then reviewed by four independent agents - a spec reviewer, a breaker, a mutation auditor
and an invariant auditor - and every finding of theirs was dispositioned below. The
suite went from 1,521 tests at the publication base to 1,570.

| Gap | Fix | Commit |
|---|---|---|
| G1 | A reviewed brief is complete and current: every judged section present and answered, a stamped brief's inputs hash matching the corpus. Unstamped briefs keep their approval (ADR-0138). | `97f021b` |
| G2 | A mistyped table ID is a `malformed-id` corpus problem and a hygiene FAIL, never a dropped row. | `c0ca043` |
| G3 | Entities are decoded once, at the end of the conversion; block passes convert without decoding. | `6c22c67` |
| G4 | Same-day supersession follows the fetch ledger's order, as the collector already did. | `4367ef6` |
| G5 | The browser transport reads the origin's status and final URL from Chromium's net log; a render with no status is graded partial (ADR-0137). | `844d887` (ADR), `6b0358e` (transport) |
| G6 | The URL identity merge stands, as a recorded decision with its trigger (ADR-0136). | `844d887` |
| G7 | A body is decoded in the charset its server declared, a byte-order mark first; an unknown label is a named fallback. | `f2859f0` |
| G8 | Freshness is judged by the capture's own date, and hygiene names a table date that disagrees. | `420b3a0` |

### Review of the fixes

| # | Finding (severity) | Disposition | Commit |
|---|---|---|---|
| R1 | The G3 fix left a paragraph's link label decoded inside the link pass: `[limit 2](/x)`, and `&amp;lt;` decoded twice (S1). | fixed: the label is never decoded on its own | `8494572` |
| B7 | A `&nbsp;`-only link survived in a list item (S3). | fixed: emptiness judged on the decoded label | `8494572` |
| B9 | `decodeEntities` decoded `&#38;lt;` twice (S3). | fixed: one pass over every reference kind | `8494572` |
| R2 / B5 | Bytes that are not valid UTF-8 under a UTF-8 label, or none (a `<meta>`-only charset), stayed silent U+FFFD graded full (S2). | fixed: a named fallback, graded partial | `4005083` |
| B3 | A `utf-16` label over an 8-bit body decoded to CJK garbage with no fallback (S2). | fixed: a UTF-16 label is believed only over NUL bytes | `4005083` |
| B4 | An unknown label over pure ASCII was graded partial; `charset="utf-8` kept its quote (S2). | fixed | `4005083` |
| R7 | `boundedText` honoured a legacy label for JSON answers (S3). | fixed: JSON reads UTF-8, as its callers always did | `4005083` |
| M-2a′ | No test reached the UTF-8 byte-order-mark rule on its own. | fixed: a test under a UTF-16 label | `4005083` |
| B2 | A row with a blank Raw cell was judged by the URL's latest capture, losing its stale warning and drawing a date-mismatch with the wrong remedy (S2). | fixed: judged by the capture it names | `941792e` |
| B6 / R5 / R9 | Supersession and the "fresher capture" hint still ordered by the table cell (S2). | fixed: by capture date | `941792e` |
| B10 | A future date in the capture hid the row's age (S3). | fixed: `future-date` reads the capture too | `941792e` |
| M-5h, M-5i | A timestamped capture against a day-only cell, and an unparseable cell, had no test. | fixed: two tests | `941792e` |
| R4 | An empty-ID row with content was dropped in silence; the "templates ship empty rows" premise was false (S2). | fixed: recorded unless every cell is empty | `11bcdf3` |
| B1 | A line appended after the draft stamp made a stale brief read as unstamped: re-approved, `brief-stale` silent (S2). | fixed: the stamp is found wherever it stands | `3016547` |
| R3 | The unstamped-brief compatibility path was silent and bypassable (S2). | fixed: `hygiene/brief-unstamped`, ADR-0138 | `3016547` |
| R6 | "Eleven decision briefs" miscounted (S3). | fixed: ten, root plus ten is eleven | `3016547` |
| R8 | A `?? true` assertion that could never fail (S3). | fixed: asserts over the gate's warnings | `3016547` |
| B8 | An `async search()` defeated the throw guard; its rejection ended the process (S3). | fixed: a Promise is a failed search that says so | `61a6248` |
| M-3b | The `transport` group alone does not catch the child dropping `decodeFallback`; the `runtime` group does. | rejected: both groups run in the suite | - |
| I2 | The root brief has no `Reviewed by:` line, so `review.by` is `undeclared`. | recorded: not an approval condition; the root brief predates ADR-0074 | - |
| I5 | G2, G8 and G4 change no verdict on the 29 real corpora, so their effect is proven by the suite alone. | recorded: expected, none of the corpora holds a malformed ID, a date mismatch or a same-day supersession | - |

Verified on the branch tip by the invariant auditor and again by the lead after the
review fixes: the root corpus and all 28 nested decision projects pass preflight (the
root and the eight nested projects whose briefs predate ADR-0055 now carry the single
`brief-unstamped` warning, by design); the root derives `APPROVED_BRIEF` with
`buildAuthorized: true` from inside `deriveState`; the ledger is byte-identical to the
base; every changed module has its row in `docs/ARCHITECTURE.md`; the diff holds no key.

Not verified here: the net log's status line under HTTP/2 and HTTP/3 (only HTTP/1.1 was
seen, on loopback; such a page would be graded partial, not misread), and the suite on
Windows and on Node 26, which CI runs.
