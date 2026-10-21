# Brief - How citation-integrity and text-identity standards decide that a claim is supported and that two texts or URLs are the same, as a benchmark for Fetchproof's evidence rows, corroboration and URL identity

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

## What we verified

| Claim | Source | Type |
|---|---|---|
| Wikipedia's Verifiability policy requires an inline citation to a source that directly supports challenged material and all quotations [quote: must include an inline citation to a reliable source that directly supports], and defines "directly supports" as the information being present explicitly in the source [quote: A source "directly supports" a given piece of material if the information is present explicitly in the source] - a property of the source text, not of where the citation sits [quote: The location of any citation—including whether one is present in the article at all—is unrelated to whether a source directly supports the material.]. The burden is on whoever adds the claim [quote: The burden to demonstrate verifiability lies with the editor who adds or restores material], and unsupported claims may be removed [quote: Facts or claims without an inline citation to a reliable source that directly supports]. Benchmark for the kit's evidence row: the standard asks for the supporting passage to exist explicitly, which is what the kit's optional `[quote: ...]` anchor records. | E-04 `en.wikipedia.org` (U-1) | P |
| The Reliable sources guideline repeats the direct-support rule [quote: Sources should directly support the information as it is presented in the Wikipedia article.] and ranks source tiers: secondary sources are preferred and primary sources carry a caution [quote: When relying on primary sources, extreme caution is advised.] [quote: Although specific facts may be taken from primary sources, secondary sources that present the same material are preferred.]. Its worked example shows what "directly" excludes: a source that supports "climate change is caused by human activity" cannot support "there is an academic consensus" [quote: because the source does not directly say anything about an academic consensus]. Benchmark: Wikipedia's P/S preference runs the opposite way from the kit's (the kit prefers the page that owns the fact; Wikipedia prefers the secondary account) because the questions differ - the kit closes a fact about a vendor's own product or spec, where the owner page is the primary source permitted for straightforward descriptive facts (E-06). | E-05 `en.wikipedia.org` (U-1) | P |
| The No original research policy defines the tiers: a primary source is close to the event [quote: a scientific paper documenting a new experiment conducted by the author is a primary source for the outcome of that experiment], a secondary source [quote: provides thought and reflection based on primary sources, generally at least one step removed from an event], and a tertiary source summarises both [quote: Reliable tertiary sources can help provide broad summaries of topics that involve many primary and secondary sources]; articles [quote: should be based on reliable, published secondary sources, and to a lesser extent, on tertiary sources and primary sources]. A primary source is allowed for exactly the kind of claim the kit closes [quote: A primary source may be used on Wikipedia only to make straightforward, descriptive statements of facts that can be verified by any educated person with access to the primary source but without further, specialized knowledge.]. The synthesis rule forbids assembling a claim from pages that do not each state it [quote: Do not synthesize meaning from multiple sources to state or imply a conclusion not explicitly stated by any of those sources.] [quote: If one reliable source says A and another reliable source says B, do not join A and B together to imply a conclusion C not mentioned by either of the sources.]. Benchmark: a CLOSED unknown whose Evidence cell joins two rows into a conclusion neither capture states is what this policy names original synthesis; the kit has no check for it. | E-06 `en.wikipedia.org` (U-1) | P |
| Crossref's REST API documentation: the API exposes member-deposited metadata [quote: Our publicly available REST API exposes the scholarly metadata that members and trusted sources deposit with Crossref.] [quote: The metadata is deposited directly by our members, who publish the content represented by each metadata record.], keyed by DOI - /works/{doi} returns [quote: A single metadata record for a Crossref DOI.] - with https://api.crossref.org/ as the base URL, and the same record is available in several formats by content negotiation [quote: The REST API can return single metadata records in a variety of formats through a process known as content negotiation.]. The page does not describe how a DOI resolves to a landing page; that is read from the record itself (E-08). | E-07 `crossref.org` (U-2) | P |
| A live Crossref work record (the DOI the documentation's own quick start uses; JSON captured in full, 200). The record's identity is the DOI, and it carries two distinct URLs for one work: the resolver form [quote: "URL":"https://doi.org/10.1128/mbio.01735-25"] and the publisher's landing page [quote: "resource":{"primary":{"URL":"https://journals.asm.org/doi/10.1128/mbio.01735-25"}}], plus a full-text link under "link" (https://journals.asm.org/doi/pdf/10.1128/mbio.01735-25), dates as date-parts arrays ("published", "published-print", "issued" all 2025-08-13; "created" 2025-07-22; "deposited" 2025-08-13; "indexed" 2026-07-30), and a citation count [quote: "source":"Crossref","is-referenced-by-count":0]. Benchmark: the scholarly record of "same work" is an identifier that resolves to a URL, not the URL; a kit keyed on URL strings would hold the doi.org form, the landing page and the PDF as three pages. | E-08 `api.crossref.org` (U-2) | P |
| UAX #15 (revision 58, Unicode 18.0.0) defines two equivalences: canonical [quote: Canonical equivalence is a fundamental equivalency between characters or sequences of characters which represent the same abstract character, and which when correctly displayed should always have the same visual appearance and behavior.] and compatibility (same abstract character, possibly different appearance). Two strings that look identical can therefore differ in code points and in bytes; normalization makes them comparable [quote: A binary comparison of the transformed strings will then determine equivalence.]. NFC is the form recommended for content [quote: recommend using Normalization Form C for all content, because this form avoids potential interoperability problems arising from the use of canonically equivalent, yet different, character sequences in document formats on the Web.]; NFKC additionally folds compatibility variants (halfwidth and fullwidth katakana, Roman numerals) but [quote: Normalization Forms KC and KD must not be blindly applied to arbitrary text.] - they suit restricted-character domains such as identifiers. ASCII is untouched by every form [quote: Text exclusively containing ASCII characters (U+0000..U+007F) is left unaffected by all of the Normalization Forms.]. Benchmark: the kit's body hash is over raw bytes (two canonically equivalent captures hash apart - correct for a tamper check, wrong for "same text"), and its quote matcher normalises to NFKC on both sides before comparing (lib/quotes.mjs). | E-09 `unicode.org` (U-3) | P |
| UTS #46 (revision 36, Unicode 18.0.0) defines IDNA compatibility processing: a mapping phase makes Unicode domain names case-insensitive the way ASCII ones are [quote: Users are accustomed to having both CNN.com and cnn.com work identically.] [quote: By using this Compatibility Processing, a domain name such as ÖBB.at will be mapped to the valid domain name öbb.at, thus matching user expectation for case behavior in domain names.]; the mapping is case folding plus compatibility mapping (halfwidth katakana to katakana), and [quote: Note that case-folding generates a stable form of a string that erases functional case-differences. It is not the same as lowercasing.]. Labels are separated by four full stops, not one [quote: U+FF0E ( ． ) FULLWIDTH FULL STOP], and ToASCII (section 4.2) produces the Punycode wire form (xn--...). Benchmark: "same host" for a Unicode host is decided after mapping and ToASCII; a suffix comparison on the raw string counts ÖBB.at and öbb.at and xn--bb-eka.at as three hosts. | E-10 `unicode.org` (U-4) | P |
| The WHATWG URL Standard [quote: Living Standard — Last Updated 10 September 2026]. URL equivalence is defined by the serializer: two URLs are equal when their serializations are equal, optionally ignoring fragments [quote: Return true if serializedA is serializedB; otherwise false.]. The equalities are therefore the ones the parser performs before serializing: an ASCII domain is lowercased [quote: the algorithm returns domain lowercased regardless of Unicode ToASCII’s outcome, due to web compatibility.], a Unicode domain goes through UTS #46 ToASCII (the domain parser), percent-encoded bytes in a host are decoded [quote: Let domain be the result of running UTF-8 decode without BOM on the percent-decoding of input.], a default port is dropped [quote: Set url’s port to null, if port is url’s scheme’s default port; otherwise to port.], and a special URL's empty path becomes "/" (path start state sends a special URL to the path state, so http://example.com serializes as http://example.com/). Two things are NOT folded: a trailing dot [quote: The example.com and example.com. domains are not equivalent and typically treated as distinct.] (certificate matching ignores it, URLs do not [quote: Certificate comparison requires a host equivalence check that ignores the trailing dot of a domain (if any).]), and percent-encoding in paths and queries, which the serializer preserves. Host equality is identity of the parsed host [quote: return true if A is B, and false otherwise.]. Benchmark: a URL key that is the WHATWG serialization folds case, default port, empty path and IDN form; one that is the raw string folds none of them. | E-11 `url.spec.whatwg.org` (U-4) | P |
| datasketch 2.0.0's MinHash page: MinHash estimates Jaccard similarity [quote: arbitrary sizes in linear time using a small and fixed memory space] [quote: It can also be used to compute Jaccard similarity between data streams.], after Broder [quote: MinHash is introduced by Andrei Z. Broder in this paper]. The input is a set the caller forms: the example tokenises two sentences into word lists and feeds each token as UTF-8 bytes [quote: for d in data1: m1.update(d.encode('utf8'))], and the "actual Jaccard" it compares against is computed over the Python sets of those tokens. Accuracy is set by the number of permutations [quote: You can adjust the accuracy by customizing the number of permutation functions used in MinHash.] [quote: This will give better accuracy than the default setting (128).]. The page says nothing about shingle size or about scripts - the tokeniser is outside the library. Benchmark: MinHash judges whatever set it is given; a shingler that emits no shingles for non-Latin text gives it an empty set, and the Jaccard of two empty sets is undefined, so two non-Latin copies are not judged at all. | E-12 `ekzhu.com` (U-5) | P |
| Elicit's help centre, Systematic Reviews: every screening decision carries the passage behind it [quote: Elicit screens every gathered paper against your criteria. A paper that fails any one of them is excluded, and every decision shows the quote from the paper behind it.] [quote: Click any paper to see its per-criterion decisions, exclusion reasons, and source quotes from the abstract supporting each decision], and every extracted cell does too [quote: Click on any cell in the finished data extraction table to view supporting quotes from the paper and check the AI-generated answers for accuracy.]. The page does not say what Elicit shows when no supporting quote can be found. Benchmark: the supporting quote is mandatory per decision and per cell in Elicit, optional per row in the kit. | E-13 `support.elicit.com` (U-6) | P |
| Perplexity's help centre, source labels: a source is rated at the site level, never the page [quote: Perplexity rates the whole website a source comes from, not each individual page.] [quote: A label describes the website as a whole, not any single article or claim on it.] [quote: Labels reflect the type or category of an overall website, not the accuracy of any single article or claim on it.]; three labels (Government, Academic, Trusted) are given by a review of the domain, most domains have none [quote: Most domains on the web do not have a label.], and the reader is told to check the source [quote: reviewing the original sources yourself remains the best way to build confidence in an answer.]. The page shows citations as numbered links to a domain, not a supporting passage. Benchmark: Perplexity's unit of trust is the domain (as the kit's "same site" rule assumes), while its unit of support is the link, weaker than the kit's quote anchor. | E-14 `perplexity.ai` (U-6) | P |

## Contradictions and how they were resolved

Three places where the sources pull against each other or against the kit; none is a
disagreement between two owner pages about the same fact.

1. **Which source tier carries a claim.** Wikipedia prefers secondary sources and cautions
   against primary ones (E-05, E-06); the kit's rule 4 says `P` primary/official carries
   the design. Resolved: not a contradiction but a different question. Wikipedia's primary
   sources are witnesses to an event (a lab's own paper, a court filing); the kit's `P` is
   the page that *owns* a fact about a product or a standard (a vendor's pricing page, the
   spec itself), which is exactly the case NOR allows a primary source for - "straightforward,
   descriptive statements of facts that can be verified by any educated person with access"
   (E-06). The lead should read the kit's `S` grade the way Wikipedia reads a primary
   source: allowed for descriptive facts the page states explicitly, never for an
   interpretation. Trusted: E-06, because it names the permitted use.
2. **Host equality, trailing dot.** The URL Standard keeps `example.com` and `example.com.`
   distinct (E-11), while certificate matching ignores the dot, and UTS #46 treats four
   different full stops as the same label separator (E-10). Resolved: for a URL key, the
   WHATWG serialization is the owner rule (distinct); for "same site" a trailing dot is a
   DNS artefact and the lead may fold it, but that is a choice the standard does not make.
   Trusted: E-11 for the URL key, E-10 for host mapping; they do not cover the same step.
3. **What "corroboration" means.** The three decompose captures (E-01..E-03) use the word
   for identity vetting and evidence extraction; the audit uses it for independent
   witnesses to one claim about a page. Resolved by not citing them: the owner pages for the
   audit's sense are E-04..E-06 (one source must directly support; two sources may not be
   joined into a third claim) and E-14 (trust is rated per domain). Also noted: the kit's
   own quote matcher (`lib/quotes.mjs`) already normalises to NFKC and strips Markdown on
   both sides, so for quote anchors the kit is ahead of a byte comparison - but the ledger's
   body hash and any body-equality check are over raw bytes (E-09).

## Known unknowns

- **U-7** - How a web-corpus deduplicator based on SimHash forms its features (D-14): what is hashed (words, shingles, bytes), and whether the published descriptions (Manku, Jain and Sarma, WWW 2007; Common Crawl's dedup notes) say anything about non-Latin scripts.
  - Day-one verification: Not collected: the lead's budget of 14 scrapes was spent on the eleven owner pages above and decompose's three; no search credit remained to locate a one-page owner description. Day-one step: on the collector machine, add https://www2007.org/papers/paper215.pdf (Manku et al., "Detecting near-duplicates for web crawling") to plan.json and collect it (1 scrape), then read section 2 for the feature set; if the PDF transport fails, use the ACM DL abstract page for the same paper.

## Decision

Nothing is built from this project: it is a benchmark the gap-audit lead reads, and the kit
is feature-frozen (ADR-0117). The decision is what the benchmark table says and where the
audit should look first.

### The benchmark table

| Kit behaviour | Standard | What the standard requires | Where the kit's output would differ | Evidence |
|---|---|---|---|---|
| An unknown is CLOSED on an evidence row of any grade; `[quote: ...]` is optional | Wikipedia V / NOR | The source must directly support the claim: the information is present explicitly in the source, regardless of where the citation sits; a primary source only for straightforward descriptive facts; secondary sources for anything interpretive | A CLOSED unknown whose row paraphrases without an anchor cannot be told from one whose capture states the claim; an `S`-graded row closing an interpretive claim would be refused by the standard | E-04, E-05, E-06 |
| The Evidence cell of an unknown may join several rows | Wikipedia NOR (synthesis) | Do not join A from one source and B from another into C that neither states | A CLOSED unknown assembled from two captures that each state half - the kit has no check for it, and none is possible by string matching; it is the reviewer's duty | E-06 |
| Quote anchor matched after NFKC + Markdown stripping on both sides | UAX #15 | Canonically equivalent strings look alike and differ in bytes; compare after normalising; NFC for content, NFKC for restricted domains, never blindly on text | The anchor is right; the body hash (raw bytes) is right for tamper detection but wrong as a "same text" test; a near-duplicate check over un-normalised text sees ligatures and width variants as different words | E-09 |
| URL identity by exact string, or a normalised key | WHATWG URL | Equal when the serializations are equal: lowercase ASCII host, IDN via ToASCII, host percent-decoding, default port dropped, empty path -> "/", fragment optionally excluded; trailing dot and path/query percent-encoding preserved | Exact-string keys count `HTTP://Example.com:80` and `http://example.com/` twice; a home-grown key that strips a trailing dot or decodes path percent-encoding merges what the standard keeps apart | E-11 |
| "Same site" by host suffix on the raw host string | UTS #46 | A Unicode host is case-folded and mapped, then ToASCII'd; `ÖBB.at`, `öbb.at` and `xn--bb-eka.at` are one host | Two spellings of a non-ASCII host count as two sites; a Punycode host and its Unicode form count as two | E-10 |
| Work identity by URL | Crossref record | Identity is the DOI; one record carries the doi.org URL, the landing page and the full-text link | The three URLs of one work are three witnesses to the kit | E-07, E-08 |
| MinHash over ASCII word shingles | datasketch MinHash | Estimates Jaccard over the sets it is given; the caller forms the set; accuracy by num_perm | An empty shingle set for non-Latin text gives no estimate; two copies of a Cyrillic or CJK page pass as independent witnesses | E-12, U-7 open for SimHash |
| Quote anchor optional per row | Elicit | A supporting quote for every screening decision and every extracted cell | A row without an anchor is a weaker claim than any Elicit cell | E-13 |
| Source grade per row; "same site" per host | Perplexity | Trust rated per domain, not per page; citation is a numbered link, no passage | The kit's per-domain "same site" matches the field; the kit's quote anchor is stronger than a link where it is present | E-14 |

### First step for the audit

Read E-04 and E-06 first: the gap most likely to make a kit output wrong is a CLOSED
unknown whose row has no `[quote: ...]` and whose capture does not state the claim, and
the second is a closure assembled from two rows (synthesis). Then E-11 and E-10 for the
URL key and the host rule, and E-12 for the sketch. Out of scope: any change to the kit
(feature freeze, ADR-0117); the SimHash half of U-5 (U-7, known unknown with its day-one
step); Perplexity's "how it works" page, which was not captured (the source-labels page was
chosen over it because it answers the per-site question; the numbered-citation claim in
E-14 rests on that page's own description of citations, not on the how-it-works page).

## Next steps

1. The TODO sections are answered (Reviewed by: agent, ADR-0107). The lead adds this project's row to `docs/decisions/README.md` (ADR-0102) and commits the corpus with `git add -f research/raw/.fetches.jsonl`.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.
<!-- fetchproof:brief-draft body=55844c05eb7259eb inputs=19c97bb688972587 gate=pass -->
