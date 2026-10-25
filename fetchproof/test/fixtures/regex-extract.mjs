// The keyless extractor's rules in their regex form: lazy pair REGEXES, quadratic on unclosed
// tags, as the extractor was written before 2026-09-30, and changed since with the converter's
// rules - entities decoded once (G3, 2026-10-03) and tags that end outside quoted attribute values
// (B3 and its review, 2026-10-25). Kept as the oracle for test/http-linear.test.mjs: the linear
// scanner must produce the same capture from the same page as this reading of the same rules,
// written independently of it. Test fixture only; never imported by lib/.
/* eslint-disable */
const BLOCK_DROP = /<(script|style|noscript|svg|iframe|form|template)\b[\s\S]*?<\/\1>/gi;

// One tag, as the converter strips it since 2026-10-25 (B3): the first '>' outside a `"…"` or
// `'…'` value that opens right after `=`, where `/<[^>]+>/g` took the first '>' of all. Written
// as a regex on its own, not taken from lib/, so the two readings check each other. A quote whose
// partner has no '>' after it fails the quoted branch, and the regex backtracks to reading it as
// text - the converter's "a quote that ends no tag is no quote". Only a '<' then a letter, '/',
// '!' or '?' reads quoted values; any other (`a <= "x > y"` in text) ends at its first '>', as
// `/<[^>]+>/g` read it (F2 of the review). The quoted branch and `[^>]` overlap at '=', so with
// no '>' left the regex tries every split of a run of `=""` before it fails - about 2x per `=""`,
// harmless on the generated pages, which never end in such a run.
const QUOTED = String.raw`=[\t\n\f\r ]*"[^"]*"|=[\t\n\f\r ]*'[^']*'`;
const TAG = new RegExp(String.raw`<(?:(?=[A-Za-z/!?])(?:${QUOTED}|[^>])+|[^>]+)>`, 'g');

// A pair, `<name ...>BODY</name>`, whose opening tag ends where TAG ends one (2026-10-25, review
// of the B3 fix): the rest of the tag is read inside a lookahead, which JavaScript never
// backtracks into, and then consumed by its backreference. Without that, a pair with no closing
// tag after its real '>' would back into reading a quote as text and end at a '>' inside the
// quoted value instead - the very leak. `names` is an alternation and `close` the closing tag's
// source, the opening name's by default; `m.groups.body` is the body.
const pair = (names, close = String.raw`<\/\k<name>>`) => new RegExp(String.raw`<(?<name>${names})\b(?=(?<rest>(?:${QUOTED}|[^>])*>))\k<rest>(?<body>[\s\S]*?)${close}`, 'gi');

/**
 * The <a> pairs whose opening tag, read as TAG reads it, holds `attribute` (a regex source whose
 * groups are the caller's), at the RIGHTMOST place it matches inside the tag, as
 * `<a\b[^>]*href=...` backtracked to it. A loop around regexes, because one regex cannot say
 * "inside the tag that lookahead read"; it does what the engine does with a pair regex: fail at
 * this `<a` and try again from the next character. Quadratic, which a fixture may be.
 */
function linkPairs(html, attribute) {
  const pairs = [];
  const open = /<a\b/gi;
  const tagAt = new RegExp(TAG.source, 'y');
  const inside = new RegExp(String.raw`^<a\b[\s\S]*${attribute}`, 'i');
  for (let pos = 0; ;) {
    open.lastIndex = pos;
    const m = open.exec(html);
    if (!m) break;
    tagAt.lastIndex = m.index;
    const tag = tagAt.exec(html);
    if (!tag) break;                                   // no '>' after this '<a': none after a later one
    const hit = inside.exec(tag[0].slice(0, -1));
    const close = /<\/a>/gi;
    close.lastIndex = m.index + tag[0].length;
    const c = hit && close.exec(html);
    if (!c) { pos = m.index + 1; continue; }
    pairs.push({ index: m.index, end: c.index + c[0].length, hit, body: html.slice(m.index + tag[0].length, c.index) });
    pos = c.index + c[0].length;
  }
  return pairs;
}

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
const BLOCKS = pair('article|main|section|div');
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
  const candidates = [...html.matchAll(pair('main|article'))]
    .map((m) => m.groups.body)
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
      .map((m) => ({ words: wordsOf(m.groups.body), text: m.groups.body }))
      .filter((entry) => entry.words >= 5 && linkShare(entry.text) < 0.5);
    return { html: declared, dropped, chosenWords: wordsOf(declared), totalWords: wordsOf(cleaned), basis: 'declared' };
  }

  const blocks = [...cleaned.matchAll(BLOCKS)].map((m) => m.groups.body);

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
  const sections = [...cleaned.matchAll(pair('section'))].map((m) => m[0]);
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
  const linked = [...String(html).matchAll(pair('a'))].reduce((sum, m) => sum + wordsOf(m.groups.body), 0);
  return linked / total;
}

function wordsOf(html) {
  return decodeEntities(String(html).replace(TAG, ' ')).split(/\s+/).filter(Boolean).length;
}

function density(html) {
  const tags = (html.match(TAG) ?? []).length + 1;
  const words = decodeEntities(html.replace(TAG, ' ')).split(/\s+/).filter(Boolean).length;
  return words / tags;
}

export function htmlToMarkdown(html) {
  let text = String(html);
  text = text.replace(BLOCK_DROP, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  // Entities decoded once, at the end, as the linear converter does since 2026-10-03 (G3).
  // The groups object is the last argument of a replacer when a regex has named groups.
  text = text.replace(pair('h[1-6]'), (...m) => `\n\n${'#'.repeat(Number(m.at(-1).name[1]))} ${inline(m.at(-1).body, { decode: false })}\n\n`);
  text = text.replace(pair('li'), (...m) => `\n- ${inline(m.at(-1).body, { decode: false })}`);
  text = text.replace(pair('tr'), (...m) => {
    const cells = [...m.at(-1).body.matchAll(pair('t[dh]', String.raw`<\/t[dh]>`))].map((c) => inline(c.groups.body, { decode: false }));
    return cells.length ? `\n| ${cells.join(' | ')} |` : '\n';
  });
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|article|tbody|table|ul|ol|blockquote)>/gi, '\n\n');
  text = inline(text);
  return text.replace(/\n{3,}/g, '\n\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();
}

function inline(html, { decode = true } = {}) {
  const finish = (text) => (decode ? decodeEntities(text) : text);
  let linked = '';
  let kept = 0;
  for (const link of linkPairs(String(html), String.raw`href=["']([^"']*)["']`)) {
    const label = link.body.replace(TAG, '').trim();
    linked += String(html).slice(kept, link.index) + (decodeEntities(label).trim() ? `[${label}](${link.hit[1]})` : '');
    kept = link.end;
  }
  return finish(
    (linked + String(html).slice(kept))
      .replace(pair('strong|b'), '**$<body>**')
      .replace(pair('em|i'), '*$<body>*')
      .replace(pair('code'), '`$<body>`')
      .replace(TAG, ' '),
  ).replace(/[ \t]{2,}/g, ' ').trim();
}

export function titleOf(html) {
  const [tag] = String(html).matchAll(pair('title'));
  if (tag) return decodeEntities(tag.groups.body).replace(/\s+/g, ' ').trim();
  const [h1] = String(html).matchAll(pair('h1'));
  return h1 ? inline(h1.groups.body) : '';
}

/** The two result-link loops of the keyless search, their tags read as every other tag. */
export function searchLinks(body) {
  const results = [];
  for (const link of linkPairs(String(body ?? ''), String.raw`href=["']([^"']+)["'][^>]*class=["']result-link["']`)) {
    results.push({ href: link.hit[1], title: inline(link.body) });
  }
  if (!results.length) {
    for (const link of linkPairs(String(body ?? ''), String.raw`href=["'](https?:\/\/[^"']+)["']`)) {
      results.push({ href: link.hit[1], title: inline(link.body) });
    }
  }
  return results;
}
