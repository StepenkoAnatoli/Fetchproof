// The keyless extractor as it was before 2026-09-30: lazy pair REGEXES, quadratic on unclosed
// tags. Kept as the oracle for test/http-linear.test.mjs - the linear scanner that replaced them
// must produce the same capture from the same page. Test fixture only; never imported by lib/.
/* eslint-disable */
const BLOCK_DROP = /<(script|style|noscript|svg|iframe|form|template)\b[\s\S]*?<\/\1>/gi;

/**
 * One numeric character reference. HTML reads 0, a surrogate, and anything past U+10FFFF
 * as U+FFFD: String.fromCodePoint THROWS on the last, so one malformed entity crashed the
 * whole scrape (Arena break test 8, 2026-09-28).
 */
function codePoint(n) {
  return Number.isSafeInteger(n) && n > 0 && n <= 0x10FFFF && (n < 0xD800 || n > 0xDFFF)
    ? String.fromCodePoint(n) : '\uFFFD';
}

export function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
  // One pass, like the converter (2026-10-03): `&#38;lt;` is the text `&lt;`, decoded once.
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ref) => {
    if (/^#x/i.test(ref)) return codePoint(parseInt(ref.slice(2), 16));
    if (ref[0] === '#') return codePoint(Number(ref.slice(1)));
    return named[ref.toLowerCase()] ?? all;
  });
}

/**
 * Word density picks the block a reader came for - but a page's critical sentence is
 * often in a SHORTER sibling (a quota exception, a footnote, a caveat box). Discarding
 * those and still calling the result `full` is how a capture loses the one fact a claim
 * rests on while reporting that nothing is missing.
 *
 * So this returns the chosen block AND what it left behind, and the caller grades
 * honestly on both.
 */
const BLOCKS = /<(article|main|section|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const SEMANTIC_MIN_WORDS = 100;

/**
 * The block the page itself declares as its content: the largest <main> or <article> with
 * at least SEMANTIC_MIN_WORDS words, or null.
 *
 * Searched on its own, not among the div blocks. That search is lazy and non-overlapping,
 * so when <main> sits inside wrapper divs - as it does on GitHub Docs - the outer div's
 * match ends at the first </div> inside <main>, and <main> is never a candidate. On
 * 2026-09-27 that kept the 262-character summary of a Docs article and dropped the
 * 17,385-character <main> around it; Firecrawl captured the same page whole.
 */
function declaredContent(html) {
  const candidates = [...html.matchAll(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => m[2])
    .filter((inner) => wordsOf(inner) >= SEMANTIC_MIN_WORDS);
  if (!candidates.length) return null;
  return candidates.reduce((best, inner) => (wordsOf(inner) > wordsOf(best) ? inner : best));
}

export function mainContent(html) {
  const cleaned = String(html).replace(BLOCK_DROP, ' ');

  // A page that marks its content, and puts real text in it, is believed. What is dropped
  // is then whatever has words OUTSIDE that block - navigation, sidebars, footers, and any
  // caveat box the page put elsewhere - counted the same way as below, so the grade stays
  // honest about what the capture left out.
  const declared = declaredContent(cleaned);
  if (declared) {
    const outside = cleaned.replace(declared, ' ');
    // Outside the declared content, a block that is mostly link text is navigation -
    // breadcrumbs, sidebars, "skip to content" - not content the capture lost. Counting it
    // graded every keyless docs capture `partial` (20 such blocks on the Docs page above).
    // A block of prose outside <main> is still reported: that is where a caveat box would be.
    const dropped = [...outside.matchAll(BLOCKS)]
      .map((m) => ({ words: wordsOf(m[2]), text: m[2] }))
      .filter((entry) => entry.words >= 5 && linkShare(entry.text) < 0.5);
    return { html: declared, dropped, chosenWords: wordsOf(declared), totalWords: wordsOf(cleaned), basis: 'declared' };
  }

  const blocks = [...cleaned.matchAll(BLOCKS)].map((m) => m[2]);

  // Selection considers only substantial blocks; the DROP analysis considers them all.
  // Filtering short blocks out of both is how a 60-character caveat box - exactly the
  // shape a quota exception takes - disappeared without ever being counted as missing.
  let best = cleaned;
  let bestScore = density(cleaned);
  for (const block of blocks) {
    if (block.length <= 200) continue;
    const value = density(block);
    if (value > bestScore) { best = block; bestScore = value; }
  }

  // A run of sections is the content, not a set of rivals for it (found 2026-09-28):
  // nodejs.org/api/fs.html is 314 <section>s with no <main>, and the densest one - 1,095
  // characters - was kept while ~40,500 words were graded away as outside it. When the
  // chosen block holds under a quarter of the page's words and the page's sections hold at
  // least half, the sections are taken together, in order.
  const totalWords = wordsOf(cleaned);
  const sections = [...cleaned.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)].map((m) => m[0]);
  const sectionWords = sections.reduce((sum, s) => sum + wordsOf(s), 0);
  let basis = 'densest';
  if (sections.length >= 3 && wordsOf(best) < totalWords / 4 && sectionWords >= totalWords / 2) {
    best = sections.join('\n');
    basis = 'sections';
  }

  const dropped = blocks
    .filter((block) => !best.includes(block) && !block.includes(best))
    .map((block) => ({ words: wordsOf(block), text: block }))
    // Around a run of sections, as around a declared <main>, a block that is mostly links is
    // navigation, not content the capture lost.
    .filter((entry) => entry.words >= 5 && (basis !== 'sections' || linkShare(entry.text) < 0.5));

  return { html: best, dropped, chosenWords: wordsOf(best), totalWords, basis };
}

/** The share of a block's words that sit inside links: near 1 for navigation, near 0 for prose. */
function linkShare(html) {
  const total = wordsOf(html);
  if (!total) return 0;
  const linked = [...String(html).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].reduce((sum, m) => sum + wordsOf(m[1]), 0);
  return linked / total;
}

function wordsOf(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).split(/\s+/).filter(Boolean).length;
}

function density(html) {
  const tags = (html.match(/<[^>]+>/g) ?? []).length + 1;
  const words = decodeEntities(html.replace(/<[^>]+>/g, ' ')).split(/\s+/).filter(Boolean).length;
  return words / tags;
}

export function htmlToMarkdown(html) {
  let text = String(html);
  text = text.replace(BLOCK_DROP, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  // Entities decoded once, at the end, as the linear converter does since 2026-10-03 (G3).
  text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) => `\n\n${'#'.repeat(Number(level))} ${inline(body, { decode: false })}\n\n`);
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => `\n- ${inline(body, { decode: false })}`);
  text = text.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => inline(m[1], { decode: false }));
    return cells.length ? `\n| ${cells.join(' | ')} |` : '\n';
  });
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|article|tbody|table|ul|ol|blockquote)>/gi, '\n\n');
  text = inline(text);
  return text.replace(/\n{3,}/g, '\n\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();
}

function inline(html, { decode = true } = {}) {
  const finish = (text) => (decode ? decodeEntities(text) : text);
  return finish(
    String(html)
      .replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
        const label = body.replace(/<[^>]+>/g, '').trim();
        return decodeEntities(label).trim() ? `[${label}](${href})` : '';
      })
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t]{2,}/g, ' ').trim();
}

export function titleOf(html) {
  const tag = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (tag) return decodeEntities(tag[1]).replace(/\s+/g, ' ').trim();
  const h1 = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? inline(h1[1]) : '';
}

/** The two result-link loops of the keyless search, as they were. */
export function searchLinks(body) {
  const results = [];
  for (const m of String(body ?? '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["']result-link["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    results.push({ href: m[1], title: inline(m[2]) });
  }
  if (!results.length) {
    for (const m of String(body ?? '').matchAll(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      results.push({ href: m[1], title: inline(m[2]) });
    }
  }
  return results;
}
