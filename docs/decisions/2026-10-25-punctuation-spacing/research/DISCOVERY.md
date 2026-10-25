# Discovery Contract - Punctuation spacing after inline HTML tags: what Firecrawl and the kit's keyless HTML-to-Markdown converter write before . , ; : ! ? % ) ] } and after ( [ {, and how Firecrawl documents its HTML-to-Markdown conversion

Started 2026-10-25. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

ADR-0192 (held) proposes a matcher-side fix in `normalizeForMatch` (`fetchproof/lib/quotes.mjs`):
remove whitespace before `. , ; : ! ? % ) ] }` and after `( [ {`, so that a `[quote: ...]` copied
from a Firecrawl capture still matches a keyless capture of the same page and the reverse
(plan v0.4 section 5.3, Mandate choice C6). The rule should rest on what the two transports
actually write, not on a guess. Done means: for real pages whose HTML has inline elements
directly followed (or preceded) by punctuation, the corpus holds a capture of the same page from
each transport, a builder can read per mark which transport put a space there, and the brief
says which marks the rule covers, which it does not, and where it could merge text it should not.
No product code is written here.

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
| U-01 | When an inline element is directly followed by `. , ; : ! ? % ) ] }`, or directly preceded by `( [ {`, what does the kit's keyless converter (`http-keyless`) write into the capture - a space or none - per mark, on a real page? | ADR-0192's rule removes exactly the spaces a transport inserts; a mark the converter spaces that the rule leaves out stays broken, and a rule wider than the observed cases adds leniency for nothing. | CLOSED | E-01, E-03: the keyless converter writes a space on both sides of every inline tag it strips (`span`, `sup`, `abbr`, the `span` inside Sphinx `code`, every Pygments token span), so a mark directly beside such a tag is spaced: before `. , ; : ! ? ) ] }` and after `( [ {` all seen. Links, bold, italics and plain code are rewritten whole and leave no space. The keyless capture of the Wikipedia page, kept as history beside its Firecrawl capture, shows the same on MediaWiki HTML (research/BRIEF.md, Decision). |
| U-02 | For the same kind of HTML, what does Firecrawl (`firecrawl-cli`, markdown format, only-main-content) write - a space before the closing mark or after the opening one, or none? | The rule exists because the two transports differ; if Firecrawl also spaces some marks, or spaces them differently, the rule's set of marks is wrong. | CLOSED | E-09: Firecrawl writes no space before a closing mark after an inline element, but writes one after `(` or `[` when a link or emphasis follows (`( [Mexico](...)`), and drops whitespace that sits in its own inline element (`U+332B㌫SQUARE`). The Firecrawl capture of the Python page, kept as history beside its keyless capture, shows the same on Sphinx HTML (research/BRIEF.md, Decision). |
| U-03 | Does Firecrawl document its HTML-to-Markdown conversion - which library or service converts, and how whitespace around inline elements is handled? | If the vendor names its converter, its behaviour can be checked and its changes tracked; if it does not, the brief must say the Firecrawl side is known only by measurement and may change silently. | CLOSED | E-03, E-04, E-05, E-06, E-07: the docs say only "converted to clean Markdown" and name no library or whitespace rule; the public source converts with Firecrawl's fork of JohannesKaufmann/html-to-markdown (GitHubFlavored + RobustCodeBlock plugins, pinned to a 2026-03 commit) behind an HTTP service, a Go shared library, then turndown, each followed by a Rust post-processor. Whether the hosted API runs this code is not shown by any page. |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.
