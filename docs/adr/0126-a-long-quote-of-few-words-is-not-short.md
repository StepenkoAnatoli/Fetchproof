# ADR-0126: A long quote of few words is not short

Date: 2026-10-02
Status: accepted; amends ADR-0087 (`quote-too-short`); amended by ADR-0191 (2026-10-25): the
floor is measured on the compared text, and a quote short only there is still compared

## Context

ADR-0087 warns `citations/quote-too-short` for a quote under three words, with the reason
"anchors almost nothing": `free plan` occurs on every pricing page. The measure was words
split on whitespace.

Running the kit on its own decision project (`docs/decisions/2026-10-02-firecrawl-cli-1-25`,
2026-10-02), two rows quoted a package manifest's dependency map -
`"dependencies":{"yaml":"^2.9.0","commander":"^14.0.2",...}`, 130 characters, no whitespace -
and both were warned as anchoring almost nothing. The quote anchors one exact line of one
file; the warning's reason was false for it. A warning whose reason is false teaches the
operator to ignore the rule, which is worse than no warning.

## Decision

- A quote is `quote-too-short` when it is under `MIN_QUOTE_WORDS` (3) words **and** under
  `MIN_QUOTE_CHARS` (40) characters, measured across its fragments. Words were a proxy for
  length; length is what the warning is about.
- The message names both floors.
- Severity and everything else in ADR-0087 stand.

## Rejected alternatives

- **Split words on punctuation as well as whitespace.** `v1.25.2` would then be three words
  and pass a floor it should not: a version string occurs on every page that mentions the
  release. Tokenising does not measure specificity; length does, roughly, and roughly is what
  a warning may be.
- **Exempt code-shaped quotes.** A check cannot tell code from prose without judging prose,
  which the gate may not do (ADR-0087).
- **Leave it.** It is a warning, not a block; but a warning that is wrong about its own
  reason is the kind of noise that gets every warning dismissed.
