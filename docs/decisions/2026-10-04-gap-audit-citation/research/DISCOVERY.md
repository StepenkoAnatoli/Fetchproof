# Discovery Contract - How citation-integrity and text-identity standards decide that a claim is supported and that two texts or URLs are the same, as a benchmark for Fetchproof's evidence rows, corroboration and URL identity

Started 2026-10-04. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Benchmark Fetchproof's evidence rows, corroboration check and URL identity against the
standards below. This is a decision about the repository (ADR-0030), read by the lead of a
gap audit of the kit: it compares what the kit does - a claim is CLOSED on an evidence row
(claim + URL + cached page, an optional `[quote: ...]` anchor checked byte for byte against
the capture, P/S/L source grades); two pages corroborate unless they are the "same site" by
host suffix or near-duplicates under a MinHash sketch over ASCII word shingles; two URLs are
one page by exact string or by a normalised key - with what Wikipedia's verifiability,
reliable-sources and no-original-research pages require of a source that "directly
supports" a claim, what a Crossref work record carries to say that two URLs name one work,
what UAX #15 guarantees about two strings that look alike, how UTS #46 and the WHATWG URL
Standard decide that two hosts or URLs are equal, what MinHash over shingles estimates, and
whether two shipped research tools (Elicit, Perplexity) show the supporting passage and
rate a source per page or per site. Nothing is built here: "done" means every unknown
below is closed from the owner page, and the brief carries the benchmark table the audit
cites. The kit is feature-frozen (ADR-0117): any change this benchmark suggests enters
through an ADR, not through this project. The lead judges; this project collects.

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
| U-1 | Per Wikipedia's Verifiability policy, Reliable sources guideline and No original research policy (D-10): what makes a source primary, secondary or tertiary; when a primary source may be used; what "the source must directly support the material" requires; and what the rule against original synthesis forbids. | The kit marks an unknown CLOSED on one evidence row of any grade and lets a P/S/L grade stand without a rule for when S may carry a claim; if a mature verifiability standard would refuse a CLOSED unknown resting on a secondary source, or a claim assembled from two pages that neither states, the kit's closures are wrong where the standard would have caught it. | CLOSED | E-04, E-05, E-06: "directly supports" means the information is present explicitly in the source, independent of where the citation sits; a primary source is allowed only for straightforward descriptive facts verifiable by any educated reader, secondary sources are preferred for everything else; joining A from one source and B from another into C that neither states is forbidden synthesis. |
| U-2 | Per Crossref's REST API documentation and a live work record (D-11): what a work record carries that identifies the same work across URLs (DOI, URL, published dates, is-referenced-by-count), and how a DOI resolves to a page. | The kit keys a page by its URL string (or a normalised key); if the scholarly record of identity is a DOI that resolves to one of several URLs, two URLs of one work are counted twice by the kit where Crossref would count one. | CLOSED | E-07, E-08: a work record is keyed by DOI; one record carries the resolver URL (https://doi.org/...), the publisher landing page (resource.primary.URL) and a full-text link, dates as date-parts (published, issued, created, deposited, indexed) and is-referenced-by-count; the docs page does not describe resolution, the record shows it (DOI -> doi.org URL -> landing page). |
| U-3 | Per UAX #15, Unicode Normalization Forms (D-12): what NFC and NFKC guarantee, why two strings that look identical can hash or compare differently, and which form is recommended for identifiers and comparison. | The kit's quote anchor is a byte-for-byte search in the capture and its ledger hashes the body bytes; if canonically equivalent strings differ in bytes, a quote copied from a rendered page can fail against the capture and two equal texts can hash apart, and the audit needs the owner text to say which form a comparison should normalise to. | CLOSED | E-09: canonically equivalent strings look the same and differ in code points; a binary comparison decides equivalence only after normalisation; NFC is recommended for content, NFKC for restricted domains such as identifiers and must not be applied blindly to text; ASCII is untouched by every form. |
| U-4 | Per UTS #46 (IDNA compatibility processing) and the WHATWG URL Standard's host parsing and URL equivalence sections (D-13): how two spellings of a host or URL are judged equal - case, trailing dot, percent-encoding, default port, empty path, and Unicode hosts. | The kit's "same site" rule compares host suffixes as strings and its URL identity is exact or a home-grown normalisation; where the owner rules fold case, drop a default port, map an empty path to "/", or map a Unicode host to its ASCII form, two spellings of one page are two witnesses to the kit and one to the standard. | CLOSED | E-10, E-11: a Unicode host is mapped (case folding plus compatibility mapping) and converted by ToASCII before comparison; the URL Standard defines equality as equality of serializations - ASCII hosts lowercased, default port dropped, host percent-encoding decoded, a special URL's empty path serialized as "/", fragments optionally excluded - while a trailing dot and path/query percent-encoding are preserved and so distinguish. |
| U-5 | Per the datasketch MinHash documentation (D-14): what MinHash estimates (Jaccard similarity over sets), how a document becomes a set (shingles) and what resolution the sketch has; and, if reachable in one page, how a web-corpus deduplicator (SimHash) forms its features. | The kit's near-duplicate sketch shingles ASCII words; if a shingle set is empty for non-Latin text, the Jaccard estimate is undefined and two copies of a non-Latin page are counted as independent witnesses; the owner text says what the sketch needs as input. | CLOSED | E-12: MinHash estimates Jaccard similarity between the sets it is given; the caller forms the set (the example feeds UTF-8 word tokens) and sets accuracy with num_perm (default 128); shingle formation and script handling are outside the library, so an empty shingle set yields no judgement. SimHash is U-7. |
| U-6 | Per Elicit's help centre and Perplexity's help centre (D-15): whether the tool shows the supporting passage behind an extracted answer or decision, how it treats a claim it cannot anchor, and whether it rates a source per page or per site. | The kit's quote anchor is optional and its source grade is per row; if shipped research tools show the supporting quote for every answer and rate sources at the domain level, the kit's optional anchor and row-level grade are the gap the audit must name. | CLOSED | E-13, E-14: Elicit shows the supporting quote for every screening decision and every extracted cell and does not document the no-quote case on this page; Perplexity rates sources per domain, not per page, cites by numbered link and tells the reader to check the source. |
| U-7 | How a web-corpus deduplicator based on SimHash forms its features (D-14): what is hashed (words, shingles, bytes), and whether the published descriptions (Manku, Jain and Sarma, WWW 2007; Common Crawl's dedup notes) say anything about non-Latin scripts. | The lead's U-5 asked for this "if reachable in one page"; it decides whether the ASCII-shingle gap in the kit's sketch is a defect shared by the field or particular to the kit. | KNOWN-UNKNOWN | Not collected: the lead's budget of 14 scrapes was spent on the eleven owner pages above and decompose's three; no search credit remained to locate a one-page owner description. Day-one step: on the collector machine, add https://www2007.org/papers/paper215.pdf (Manku et al., "Detecting near-duplicates for web crawling") to plan.json and collect it (1 scrape), then read section 2 for the feature set; if the PDF transport fails, use the ACM DL abstract page for the same paper. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

None. The lead set the intent, the six unknowns and the owner pages; every remaining
question is a fact on a public page.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- This is a nested decision project (ADR-0030); it writes nothing outside its own folder
  except its row in `docs/decisions/README.md`, which the lead adds (ADR-0102).
- Budget: at most 14 scrapes and 3 searches, collected through the Firecrawl CLI; no
  `--fallback`. Decompose spent 3 searches and 3 scrapes; the plan spends the rest on
  owner pages with no searches.
- The review is the agent's (ADR-0107): the brief is authored and declared `Reviewed by: agent`.
- Source grades: P for an owner page (the standard's own text, the tool's own help centre,
  a live record from the API that owns it). The three decompose captures are not cited.
