// lib/quotes.mjs - quote anchors (ADR-0087).
//
// A claim in an EVIDENCE Finding cell may carry `[quote: ...]`, a verbatim passage of the
// row's capture. The gate checks the passage is really there - a question about a string,
// never about prose, which is the only kind of question a gate here may ask. Whether the
// passage SUPPORTS the claim stays the reviewer's judgement.
//
// Research: docs/decisions/2026-09-28-quote-anchors. A real deep-research report carried six
// quotations attached to real citations, and none of the six occurred in the corpus (E-01).

/** A quote shorter than this proves almost nothing: "free plan" occurs on every pricing page. */
export const MIN_QUOTE_WORDS = 3;

/**
 * Unless it is long. A quote under MIN_QUOTE_WORDS words that holds at least this many
 * characters - a dependency map, a URL, an identifier - is as specific as a sentence. Words
 * were a proxy for length, and the warning's reason ("anchors almost nothing") was false for
 * a 130-character token quoted from a package manifest (found 2026-10-02, ADR-0126).
 */
export const MIN_QUOTE_CHARS = 40;

// The marker may hold balanced brackets one level deep - a code subscript (`calls[i].id`) or a
// Markdown link (`[v0.4.7](url)`). It ended at the first `]` until 2026-09-29, which cut such a
// quote short and then checked only the stub.
const QUOTE_RE = /\[quote:\s*((?:[^[\]]|\[[^[\]]*\])*)\]/gi;

/**
 * The quote markers in a Finding cell, each split into fragments on an ellipsis (`...` or
 * `…`), which stands for text the quoter left out. Prose in quotation marks is NOT a marker:
 * over this repository's 17 corpora a naive pairing of quotation marks read the text BETWEEN
 * two quotes as a quote, again and again.
 */
export function quoteAnchors(text) {
  const out = [];
  for (const match of String(text ?? '').matchAll(QUOTE_RE)) {
    const quote = unwrap(match[1].trim());
    const fragments = quote.split(/\s*(?:\.\.\.|…)\s*/).map((f) => f.trim()).filter(Boolean);
    if (fragments.length) out.push({ quote, fragments });
  }
  return out;
}

/** Quotation-mark pairs a writer puts around a whole passage: straight, curly and guillemets. */
const WRAPPERS = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['«', '»'], ['„', '“']];

/**
 * A quote with one pair of quotation marks around the whole of it taken off: they are how the
 * passage was written down, not part of it. `[quote: "the sentence"]` was quote-not-found for a
 * sentence the capture held word for word, and the agent who wrote it removed every quote rather
 * than learn why (found 2026-10-01 by a cold end-to-end trial). Taking marks off can only shorten
 * what is searched for, so it cannot make an invented passage match.
 */
function unwrap(quote) {
  const pair = WRAPPERS.find(([open, close]) => quote.length > 2 && quote.startsWith(open) && quote.endsWith(close));
  return pair ? quote.slice(pair[0].length, -pair[1].length).trim() : quote;
}

/**
 * Text as it is compared, and only compared - never stored (UAX #15: NFKC removes formatting
 * distinctions). It undoes what a capture does to a sentence and nothing more: compatibility
 * forms (the "fi" ligature), the invisible formatting characters a page's own tooling inserts,
 * curly quotes and long dashes, Markdown link syntax, emphasis, backticks and backslash escapes,
 * runs of whitespace, and case.
 */
export function normalizeForMatch(text) {
  return String(text ?? '')
    .normalize('NFKC')
    // Unicode's format characters (General_Category=Cf): the soft hyphen a PDF extractor
    // leaves at a line break, the zero-width space a docs site puts inside a heading's
    // anchor link, the word joiner, the directional marks, the joiners. None of them is
    // visible, NFKC does not remove them, and `\s` matches only U+FEFF of them - so a
    // passage quoted without one was quote-not-found against a capture holding it, which
    // is the same failure the unwrap below exists for, one character class wider.
    //
    // Not a hypothesis about vendor pages: of the 188 captures in this repository's own
    // corpora, 32 hold 558 zero-width spaces between them, and `## [\u200B](…#bundled-skills)
    // Bundled skills` in research/raw/2026-09-13-extend-claude-with-skills-claude-code-docs-*.md
    // made `[quote: ## Bundled skills]` unfound (found 2026-10-01, break-test).
    //
    // Dropping them can only shorten what is searched for, on BOTH sides, so it cannot make
    // an invented passage match: an invention differs in characters somebody can see.
    .replace(/\p{Cf}/gu, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[*_`\\]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Whether every fragment occurs in the body, in order. Exact after normalization, with no
 * fuzzy fallback: a 0.92 similarity accepts an invented word inside a real sentence, which
 * is the very failure this exists to catch (the brief's contradiction section).
 */
export function anchorFound(fragments, body) {
  const haystack = normalizeForMatch(body);
  let from = 0;
  let matched = false;
  for (const fragment of fragments) {
    const needle = normalizeForMatch(fragment);
    if (!needle) continue;
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    from = at + needle.length;
    matched = true;
  }
  return matched;
}

/** Words in a quote, across its fragments: what MIN_QUOTE_WORDS is measured against. */
export function quoteWords(anchor) {
  return anchor.fragments.join(' ').split(/\s+/).filter(Boolean).length;
}

/** Characters in a quote, across its fragments: what MIN_QUOTE_CHARS is measured against. */
export function quoteChars(anchor) {
  return anchor.fragments.join(' ').length;
}
