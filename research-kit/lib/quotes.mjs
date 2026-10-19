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

/**
 * The `[quote: ...]` markers in a cell, each `{ start, end, content }`. A marker opens at
 * `[quote:` and closes at the `]` that brings the bracket depth back to zero.
 *
 * It ended at the first `]` until 2026-09-29, which cut a code subscript (`calls[i].id`) or a
 * Markdown link (`[v0.4.7](url)`) to a stub and then checked only the stub. A regex bounded to
 * ONE level of brackets did not even read a passage two levels deep - a link whose own text
 * held brackets - so such a marker was not a marker at all, and a quote the gate cannot read is
 * a quote it does not check (rank 4, 2026-10-03 gap audit). Counting brackets has no limit.
 */
function markersOf(s) {
  const starts = [...s.matchAll(/\[quote:/gi)].map((m) => m.index);
  const out = [];
  for (const start of starts) {
    if (out.length && start < out[out.length - 1].end) continue; // inside a marker already taken
    const end = closeOf(s, start);
    if (end >= 0) out.push({ start, end, content: s.slice(start + '[quote:'.length, end) });
  }
  return out;
}

/** The index of the `]` that brings the bracket depth opened at `start` back to zero, or -1. */
function closeOf(s, start) {
  let depth = 0;
  for (let j = start; j < s.length; j += 1) {
    const ch = s[j];
    if (ch === '[') depth += 1;
    else if (ch === ']') { depth -= 1; if (depth === 0) return j; }
  }
  return -1;
}

/**
 * The attempts at a quote marker that `quoteAnchors` cannot read, each `{ start, text }` with the
 * attempt's first 40 characters: a `[quote` (any case) that opens no marker - no closing bracket,
 * a space before the colon (`[Quote :`), no colon at all (`[quote the sentence]`). Each read as a
 * Finding with no quote, so an invented sentence in one of these shapes passed where the same
 * sentence written `[quote: ...]` failed - ADR-0087's six unchecked quotations again (#319).
 * Not attempts: a `[quote` inside a marker already read, inside a code span or a URL, and a
 * Markdown link whose text starts with the word (`[Quote of the day](https://...)`).
 */
export function unreadableQuoteMarkers(text) {
  const s = String(text ?? '');
  const spans = [
    ...markersOf(s).map((m) => [m.start, m.end + 1]),
    ...[...s.matchAll(/(`+)[\s\S]*?\1/g), ...s.matchAll(/https?:\/\/\S+/gi)].map((m) => [m.index, m.index + m[0].length]),
  ];
  const out = [];
  for (const m of s.matchAll(/\[\s*quote\b/gi)) {
    if (spans.some(([from, to]) => m.index >= from && m.index < to)) continue;
    const end = closeOf(s, m.index);
    if (end >= 0 && s[end + 1] === '(') continue;
    out.push({ start: m.index, text: s.slice(m.index, m.index + 40) });
  }
  return out;
}

/**
 * The quote markers in a Finding cell, each split into fragments on an ellipsis (`...` or
 * `…`), which stands for text the quoter left out. Prose in quotation marks is NOT a marker:
 * over this repository's 17 corpora a naive pairing of quotation marks read the text BETWEEN
 * two quotes as a quote, again and again.
 */
export function quoteAnchors(text) {
  const out = [];
  for (const marker of markersOf(String(text ?? ''))) {
    const quote = unwrap(marker.content.trim());
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
 * How far apart an ellipsis may leave two fragments, in the compared (normalized) text, which
 * has its runs of whitespace collapsed: an ellipsis stands for text left out of ONE passage, not
 * for a jump across the page. `[quote: free ... requests ... credits]` anchored three words
 * scattered over a pricing page and passed as a verified quote (rank 4, 2026-10-03 gap audit).
 * The bound is about a paragraph; a page's length is what made the scatter look plausible.
 */
export const MAX_QUOTE_GAP = 300;

/**
 * Whether every fragment occurs in the body, in order, each starting no more than `maxGap`
 * characters after the previous one ends. Exact after normalization, with no fuzzy fallback: a
 * 0.92 similarity accepts an invented word inside a real sentence, which is the very failure
 * this exists to catch (the brief's contradiction section). A fragment that normalizes to
 * nothing is skipped, and an anchor with no fragment left is not found (2026-10-08). A placement
 * is TRIED at each occurrence, not only at the first: a word that appears earlier out of context
 * must not hide the passage the quote meant, which a bounded first-occurrence match would.
 */
export function anchorFound(fragments, body, { maxGap = MAX_QUOTE_GAP } = {}) {
  const haystack = normalizeForMatch(body);
  const parts = fragments.map((f) => normalizeForMatch(f)).filter(Boolean);
  if (!parts.length) return false;
  const place = (i, from, first) => {
    if (i === parts.length) return true;
    const needle = parts[i];
    for (let at = haystack.indexOf(needle, from); at >= 0; at = haystack.indexOf(needle, at + 1)) {
      // Occurrences are increasing, so once one is past the bound every later one is too.
      if (!first && at - from > maxGap) return false;
      if (place(i + 1, at + needle.length, false)) return true;
    }
    return false;
  };
  return place(0, 0, true);
}

/**
 * Whether a quote anchors almost nothing, measured over EACH fragment rather than the joined
 * text. An ellipsis joining three one-word fragments (`free ... requests ... credits`) has three
 * "words" between them and cleared a floor none of the fragments reaches alone (rank 4,
 * 2026-10-03 gap audit). A single long or multi-word fragment is enough for the quote to be
 * specific; only when EVERY fragment is under both floors is the whole quote too short.
 */
export function quoteTooShort(anchor) {
  return anchor.fragments.every((f) => f.split(/\s+/).filter(Boolean).length < MIN_QUOTE_WORDS
    && f.length < MIN_QUOTE_CHARS);
}

/** Characters in a quote, across its fragments: what MIN_QUOTE_CHARS was measured against. */
export function quoteChars(anchor) {
  return anchor.fragments.join(' ').length;
}
