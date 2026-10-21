// http-transport.mjs - the KEYLESS adapter, and the second one.
//
// A seam with one implementation is a hypothesis. This is what makes the transport seam
// real: the same seven-function shape as the Firecrawl adapter, pinned by test.
//
// Pure Node ESM, no dependencies. Built-in `fetch` is asynchronous and the adapter shape
// is synchronous, so the module re-execs ITSELF with a JSON job on stdin and reads the
// answer back - a child-process rendezvous, not a second protocol.
//
// It never reads an API key, never charges a credit, stamps `transport: 'http-keyless'`,
// and grades its own completeness honestly: `full` only at >= 1500 characters of
// markdown, otherwise `partial` with the reason named.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import dns from 'node:dns';
import { fetchEnv, CHILD_OUTPUT_LIMIT, boundedBody, outputOverflow, fetchFailure, internalRedirectsSetting } from './runtime.mjs';
import { MAX_RATE_LIMIT_WAIT_MS } from './firecrawl.mjs';

export const name = 'http-keyless';
export const FULL_THRESHOLD = 1500;
const USER_AGENT = 'fetchproof/1.0 (+keyless transport; https://example.invalid/fetchproof)';

// ---------------------------------------------------------------- the rendezvous

const SELF = fileURLToPath(import.meta.url);

// The child's fetch uses a configured proxy only when told to: fetchEnv (runtime.mjs).
function runJob(job, { timeout = 60_000, spawn = spawnSync, nodePath = process.execPath, env = process.env, allowInternalRedirects } = {}) {
  // ADR-0110: undefined lets the child decide from the URL asked for; the operator's opt-out,
  // or a caller's explicit choice, overrides it.
  // An unreadable value is a refusal, never the default (#290, internalRedirectsSetting).
  const allow = allowInternalRedirects ?? internalRedirectsSetting(env).value;
  const result = spawn(nodePath, [SELF], {
    input: JSON.stringify(allow === undefined ? job : { ...job, allowInternalRedirects: allow }),
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: fetchEnv(env),
    maxBuffer: CHILD_OUTPUT_LIMIT,
  });
  // The page did not answer in time; say that, not "spawnSync ETIMEDOUT" (found 2026-09-27).
  if (result.error?.code === 'ETIMEDOUT') return { ok: false, error: `no answer within ${timeout / 1000}s - the request was abandoned; a retry may succeed` };
  const overflow = outputOverflow(result, 'the keyless fetch');
  if (overflow) return { ok: false, error: overflow };
  if (result.error) return { ok: false, error: result.error.message };
  const text = String(result.stdout ?? '').trim();
  if (!text) return { ok: false, error: String(result.stderr || 'keyless transport produced no output').trim() };
  try {
    return JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `keyless transport emitted unparseable output: ${err.message}` };
  }
}

// ---------------------------------------------------------------- tag pairs, in linear time

/**
 * Every span a lazy pair regex would match - `/<(names)\b[^>]*>([\s\S]*?)<\/\1>/gi` and its
 * relatives - in order and non-overlapping, found in time linear in the page.
 *
 * The regexes themselves were quadratic on a page with unclosed tags (found 2026-09-30,
 * break-test): an opening tag with no closing tag after it scans to the end of the page, fails,
 * and the next opening tag scans again - 9.4 s for 391 KB of `<div>word`, minutes for a larger
 * page, in the collecting process with no timeout. Here the next '>' and the next closing tag
 * are remembered as the scan moves forward, so no stretch of the page is searched twice.
 *
 *   open   a global regex for where a pair may start; `close(match)` names its closing tag
 *   tag    'attributes' - `[^>]*>` follows: the tag ends at the first '>' after the name
 *          'none'       - the body starts right after the name (`<script\b[\s\S]*?</script>`)
 *          { find, match } - `[^>]*` then a required attribute: `find` (global) locates where
 *          the attribute may start, `match` (sticky) matches from there to the tag's end
 *   close  (openMatch) => the closing pattern's regex source, searched case-insensitively
 *
 * The attribute form is the one that needs care. `<a\b[^>]*href=...` backtracks to the
 * RIGHTMOST href before the first '>' where the rest matches - and every `<a` before that same
 * '>' searches the same stretch. So the stretch is searched once, and each `<a` in it takes the
 * rightmost hit after itself; without that, `<a <a <a ...` with one '>' was quadratic again.
 */
function tagPairs(text, { open, tag = 'attributes', close }) {
  const pairs = [];
  const closers = new Map();
  const nextClose = (source, from) => {
    let c = closers.get(source);
    if (!c) { c = { re: new RegExp(source, 'gi'), from: -1, at: -1, len: 0 }; closers.set(source, c); }
    // No closer starts inside [c.from, c.at), so for any `from` in that range the next is c.at.
    if (c.from === -1 || from < c.from || (c.at !== -1 && from > c.at)) {
      c.re.lastIndex = from;
      const m = c.re.exec(text);
      c.from = from;
      c.at = m ? m.index : -1;
      c.len = m ? m[0].length : 0;
    }
    return { at: c.at, len: c.len };
  };
  let gtFrom = -1;
  let gtAt = -1;
  let region = { gt: -1, hits: [] };
  const nextGt = (from) => {
    if (gtFrom === -1 || from < gtFrom || (gtAt !== -1 && from > gtAt)) { gtFrom = from; gtAt = text.indexOf('>', from); }
    return gtAt;
  };
  const starts = new RegExp(open.source, open.flags.includes('g') ? open.flags : `${open.flags}g`);
  let pos = 0;
  while (pos < text.length) {
    starts.lastIndex = pos;
    const m = starts.exec(text);
    if (!m) break;
    const at = m.index;
    let bodyStart;
    let tagMatch = null;
    if (tag === 'none') {
      bodyStart = at + m[0].length;
    } else if (tag === 'attributes') {
      const gt = nextGt(at + m[0].length);
      if (gt === -1) break;                 // no '>' from here on: no later tag can end either
      bodyStart = gt + 1;
    } else {
      const from = at + m[0].length;
      const gt = nextGt(from);
      if (gt === -1) break;
      if (region.gt !== gt) {
        region = { gt, hits: [] };
        tag.find.lastIndex = from;
        for (let f = tag.find.exec(text); f && f.index < gt; f = tag.find.exec(text)) {
          tag.match.lastIndex = f.index;
          const hit = tag.match.exec(text);
          if (hit) region.hits.push({ at: f.index, hit });
          tag.find.lastIndex = f.index + 1;
        }
      }
      // Rightmost first, as the regex backtracks; an earlier hit is tried only if a later one
      // leaves no closing tag after it.
      let found = null;
      for (let h = region.hits.length - 1; h >= 0 && region.hits[h].at >= from; h -= 1) {
        const end = region.hits[h].at + region.hits[h].hit[0].length;
        const c = nextClose(close(m), end);
        if (c.at !== -1) { found = { hit: region.hits[h].hit, end, c }; break; }
      }
      if (!found) { pos = at + 1; continue; }
      tagMatch = found.hit;
      bodyStart = found.end;
    }
    const c = nextClose(close(m), bodyStart);
    if (c.at === -1) { pos = at + 1; continue; }   // as the regex does: fail here, try the next position
    const end = c.at + c.len;
    pairs.push({ index: at, end, open: m, tag: tagMatch, body: text.slice(bodyStart, c.at), whole: text.slice(at, end) });
    pos = end;
  }
  return pairs;
}

/**
 * `text.replace(/<[^>]+>/g, by)`, and the number of tags it replaced. After the last '>' no tag
 * can end, and there each '<' made the regex scan to the end of the page and fail - quadratic in
 * a run of `<li <a ...` with no '>' (found 2026-09-30). So it runs only up to that last '>'.
 */
function stripTags(text, by) {
  const last = text.lastIndexOf('>');
  if (last === -1) return { text, tags: 0 };
  let tags = 0;
  const head = text.slice(0, last + 1).replace(/<[^>]+>/g, () => { tags += 1; return by; });
  return { text: head + text.slice(last + 1), tags };
}

/** `text.replace(pairRegex, fn)`, through tagPairs. */
function replacePairs(text, spec, fn) {
  const parts = [];
  let last = 0;
  for (const pair of tagPairs(text, spec)) {
    parts.push(text.slice(last, pair.index), fn(pair));
    last = pair.end;
  }
  parts.push(text.slice(last));
  return parts.join('');
}

/** `<name\b[^>]*>BODY</name>` for any of `names`, the closing tag matching the opening one. */
const named = (names) => ({ open: new RegExp(`<(${names})\\b`, 'gi'), close: (m) => `<\\/${m[1]}>` });

// ---------------------------------------------------------------- html -> markdown

const BLOCK_DROP = { ...named('script|style|noscript|svg|iframe|form|template'), tag: 'none' };

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
  // One pass over every reference kind at once: three passes in turn decoded `&#38;lt;` to
  // `&lt;` and then to `<`, so a page spelling an ampersand numerically was read twice
  // (found 2026-10-03, review of the G3 fix).
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
const BLOCKS = named('article|main|section|div');
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
  const candidates = tagPairs(html, named('main|article'))
    .map((p) => p.body)
    .filter((inner) => wordsOf(inner) >= SEMANTIC_MIN_WORDS);
  if (!candidates.length) return null;
  return candidates.reduce((best, inner) => (wordsOf(inner) > wordsOf(best) ? inner : best));
}

export function mainContent(html) {
  const cleaned = replacePairs(String(html), BLOCK_DROP, () => ' ');

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
    const dropped = tagPairs(outside, BLOCKS)
      .map((p) => ({ words: wordsOf(p.body), text: p.body }))
      .filter((entry) => entry.words >= 5 && linkShare(entry.text) < 0.5);
    return { html: declared, dropped, chosenWords: wordsOf(declared), totalWords: wordsOf(cleaned), basis: 'declared' };
  }

  const blocks = tagPairs(cleaned, BLOCKS).map((p) => p.body);

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
  const sections = tagPairs(cleaned, named('section')).map((p) => p.whole);
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
  const linked = tagPairs(String(html), named('a')).reduce((sum, p) => sum + wordsOf(p.body), 0);
  return linked / total;
}

function wordsOf(html) {
  return decodeEntities(stripTags(String(html), ' ').text).split(/\s+/).filter(Boolean).length;
}

function density(html) {
  const stripped = stripTags(html, ' ');
  const tags = stripped.tags + 1;
  const words = decodeEntities(stripped.text).split(/\s+/).filter(Boolean).length;
  return words / tags;
}

export function htmlToMarkdown(html) {
  let text = String(html);
  text = replacePairs(text, BLOCK_DROP, () => ' ');
  text = replacePairs(text, { open: /<!--/g, tag: 'none', close: () => '-->' }, () => ' ');
  // The block passes convert their bodies WITHOUT decoding entities: the page-level pass
  // below strips every tag that is left, and a `<` decoded here would be read there as the
  // start of one. A list item holding `x &lt; 5 and y &gt; 2` came out as `x 2`, a table cell
  // and a heading the same, while a paragraph - converted once - survived (found 2026-10-03,
  // output-reliability audit G3). Entities are decoded exactly once, at the end.
  text = replacePairs(text, { open: /<h([1-6])\b/gi, close: (m) => `<\\/h${m[1]}>` },
    (p) => `\n\n${'#'.repeat(Number(p.open[1]))} ${inline(p.body, { decode: false })}\n\n`);
  text = replacePairs(text, named('li'), (p) => `\n- ${inline(p.body, { decode: false })}`);
  text = replacePairs(text, named('tr'), (p) => {
    const cells = tagPairs(p.body, { open: /<t[dh]\b/gi, close: () => '<\\/t[dh]>' }).map((c) => inline(c.body, { decode: false }));
    return cells.length ? `\n| ${cells.join(' | ')} |` : '\n';
  });
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|article|tbody|table|ul|ol|blockquote)>/gi, '\n\n');
  text = inline(text);
  return text.replace(/\n{3,}/g, '\n\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();
}

// An opening tag that must carry an attribute cannot end at the first '>': the attribute's
// quoted value is matched as the regex matched it, anchored where the tag starts.
const LINK = { open: /<a\b/gi, tag: { find: /href=/gi, match: /href=["']([^"']*)["'][^>]*>/iy }, close: () => '<\\/a>' };

/**
 * Inline markup to Markdown. `decode: false` leaves entities as written, for a body that a
 * later pass will strip tags from and decode (the block passes above); the page-level pass
 * decodes once. A link's label is never decoded on its own: the tag-stripping pass below
 * runs over it afterwards, and a `<` decoded first was read there as a tag (`[limit 2](/x)`
 * for `limit &lt; 10 and burst &gt; 2`, in a paragraph; found 2026-10-03, review of the G3
 * fix). Its emptiness is judged on the decoded text, so `&nbsp;` alone is as empty as a space.
 */
function inline(html, { decode = true } = {}) {
  const finish = (text) => (decode ? decodeEntities(text) : text);
  let text = replacePairs(String(html), LINK, (p) => {
    const label = stripTags(p.body, '').text.trim();
    return decodeEntities(label).trim() ? `[${label}](${p.tag[1]})` : '';
  });
  text = replacePairs(text, named('strong|b'), (p) => `**${p.body}**`);
  text = replacePairs(text, named('em|i'), (p) => `*${p.body}*`);
  text = replacePairs(text, named('code'), (p) => `\`${p.body}\``);
  return finish(stripTags(text, ' ').text).replace(/[ \t]{2,}/g, ' ').trim();
}

export function titleOf(html) {
  const [tag] = tagPairs(String(html), named('title'));
  if (tag) return decodeEntities(tag.body).replace(/\s+/g, ' ').trim();
  const [h1] = tagPairs(String(html), named('h1'));
  return h1 ? inline(h1.body) : '';
}

/**
 * An honest self-assessment. `capture-completeness` then judges it.
 *
 * Length alone is not completeness: an extraction can be long and still have dropped
 * the section a claim needs. A capture is `full` only when it is substantial AND the
 * extractor discarded nothing a reader would have seen.
 */
export function gradeCompleteness(markdown, extraction = null) {
  const length = String(markdown).length;
  const reasons = [];

  if (length < FULL_THRESHOLD) {
    reasons.push(`only ${length} characters of main content were extracted (below the ${FULL_THRESHOLD}-character bar)`);
  }
  const dropped = extraction?.dropped ?? [];
  if (dropped.length) {
    const words = dropped.reduce((sum, entry) => sum + entry.words, 0);
    reasons.push(
      `${dropped.length} sibling section(s) totalling ~${words} words were outside ${extraction?.basis === 'declared' ? "the page's main content" : 'the densest block'} and are not in this capture`,
    );
  }

  if (!reasons.length) return { completeness: 'full', omitted: '' };
  return { completeness: 'partial', omitted: reasons.join('; ') };
}

/**
 * The grade with the child's charset fallback beside it. Found 2026-10-03 (output-reliability
 * audit, G7): a body the child could only read as UTF-8, against a charset it did not know,
 * was graded like one read as declared. It is not known to be the page, whatever its length,
 * and the reason names the charset the server declared.
 */
function withDecodeFallback(grade, job) {
  if (!job.decodeFallback) return grade;
  return { completeness: 'partial', omitted: [grade.omitted, job.decodeFallback].filter(Boolean).join('; ') };
}

// ---------------------------------------------------------------- the adapter

export function command(argv) {
  return ['http-keyless', ...argv].map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(' ');
}

/**
 * What a response's Content-Type says about how to keep it.
 *
 * `html` - a page: extract the main content, and grade by what extraction kept (the length
 * bar and the dropped siblings). A response with no Content-Type is treated as html, which
 * is what every response was before the type was read.
 * `text` - JSON, XML, CSV, plain text, Markdown: kept verbatim, and graded on whether the
 * body arrived at all. Nothing was extracted, so nothing can have been dropped. Found
 * 2026-09-26: a complete 748-character GitHub API response was graded `partial` by the
 * HTML length bar.
 * `binary` - PDF, images, archives: `response.text()` is not a faithful copy of these, so
 * `scrape` refuses them by name and keeps no capture (ADR-0105). They had been kept and
 * graded partial, which put megabytes of unrecoverable text into a committed corpus.
 */
export function bodyKind(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!type || type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (type.startsWith('text/')) return 'text';
  if (/^application\/([\w.+-]+\+)?(json|xml|yaml|x-yaml|x-ndjson|csv|javascript)$/.test(type)) return 'text';
  return 'binary';
}

function verbatim(url, job, argv) {
  const body = job.body ?? '';
  const reasons = [];
  if (!body.length) reasons.push('the response body was empty');
  if (job.decodeFallback) reasons.push(job.decodeFallback);
  return {
    ok: true,
    url: job.url ?? url,
    title: '',
    markdown: body,
    statusCode: job.statusCode ?? '',
    transport: name,
    cmd: command(argv),
    completeness: reasons.length ? 'partial' : 'full',
    omitted: reasons.join('; '),
  };
}

/** How long a server's own reason may run in a failure message: one line, not its page. */
export const REASON_MAX = 160;

/**
 * What the server said when it refused: a JSON `message`, an HTML title, or the first line
 * of a text body - one line, bounded, '' when it said nothing readable. Found 2026-10-02: a
 * keyless fetch of a github.com page answered 403 and the kit recorded "HTTP 403", nothing
 * else; the body named the refuser (a sandbox proxy, not GitHub), and it took curl to learn
 * that (docs/decisions/2026-10-02-github-plain-fetch-refusal). The reason rides beside the
 * status, in the ledger and on the terminal, so the next refusal explains itself.
 */
export function serverReason({ contentType = '', body = '' } = {}) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  const text = String(body ?? '');
  let reason = '';
  if (/json/.test(type)) {
    try { const parsed = JSON.parse(text); if (parsed && typeof parsed.message === 'string') reason = parsed.message; } catch { /* not JSON after all: nothing to quote */ }
  } else if (/html/.test(type)) {
    reason = titleOf(text) ?? '';
  } else if (/^text\//.test(type)) {
    reason = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  }
  reason = reason.replace(/\s+/g, ' ').trim();
  if (!reason) return '';
  return reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX)}...` : reason;
}

/** The job's failure, with the server's own reason beside the status when it gave one. */
function refusal(job) {
  const said = serverReason(job);
  return said ? `${job.error} - the server said: "${said}"` : job.error;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * An HTTP-date as epoch milliseconds, or null: the three forms RFC 9110 (5.6.7) has a recipient
 * accept, each read as UTC - IMF-fixdate `Sun, 06 Nov 1994 08:49:37 GMT`, the obsolete RFC 850
 * `Sunday, 06-Nov-94 08:49:37 GMT` (a two-digit year more than 50 years ahead is the previous
 * century, as 5.6.7 says) and asctime `Sun Nov  6 08:49:37 1994`.
 *
 * Date.parse was the reader, and it is too lenient and too local: it took "-5", "1.5" and
 * "5, 10" for dates long past, so a 429 was retried at once, and it read an asctime date - which
 * names no zone - as this machine's local time, three hours early on a +0300 PC (reviews of
 * #313, 2026-10-18). Anything that is not one of the three forms is no date.
 */
export function httpDate(value, now = Date.now()) {
  const text = String(value ?? '').trim();
  const clock = (h, m, s) => [Number(h), Number(m), Number(s)];
  let day; let month; let year; let time;
  let m = /^[A-Za-z]{3}, (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text);
  if (m) { [day, month, year, time] = [Number(m[1]), m[2], Number(m[3]), clock(m[4], m[5], m[6])]; }
  else if ((m = /^[A-Za-z]{6,9}, (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text))) {
    [day, month, time] = [Number(m[1]), m[2], clock(m[4], m[5], m[6])];
    year = 2000 + Number(m[3]);
    if (year > new Date(now).getUTCFullYear() + 50) year -= 100;
  } else if ((m = /^[A-Za-z]{3} ([A-Za-z]{3}) ( \d|\d{2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text))) {
    [day, month, year, time] = [Number(m[2]), m[1], Number(m[6]), clock(m[3], m[4], m[5])];
  } else {
    return null;
  }
  const index = MONTHS.indexOf(month.toLowerCase());
  if (index === -1 || day < 1 || day > 31 || time[0] > 23 || time[1] > 59 || time[2] > 60) return null;
  const at = Date.UTC(year, index, day, ...time);
  // A day past the month's end (31 Feb) rolls into the next month; that is not a date either.
  return new Date(at).getUTCDate() === day ? at : null;
}

/**
 * How long a server that refused for load asks to be left alone, or null (#313): `{ ms, capped }`.
 *
 * A 429 is an instruction to wait, and a 503 is one when it carries `Retry-After`. The header
 * is delta-seconds or an HTTP-date (RFC 9110, 10.2.3); a 429 without a usable one waits the
 * minute the Firecrawl parser falls back to (`rateLimitWaitMs`). The number is the server's,
 * so it is capped as the vendor's is, at MAX_RATE_LIMIT_WAIT_MS, and `capped` says the server
 * asked for longer - the wait loop then tries once more, not until its bound. Found
 * 2026-10-11: the header was read nowhere, and on the keyless route - the one capped per IP -
 * a one-second 429 lost the page, a ledger entry and a `--force` each time.
 */
export function retryAfter(statusCode, header, { now = Date.now() } = {}) {
  const status = Number(statusCode);
  if (status !== 429 && status !== 503) return null;
  const value = String(header ?? '').trim();
  let asked = null;
  if (/^\d+$/.test(value)) asked = Number(value) * 1000;
  else {
    const at = httpDate(value, now);
    if (at !== null) asked = Math.max(0, at - now);
  }
  if (asked === null) return status === 429 ? { ms: MAX_RATE_LIMIT_WAIT_MS, capped: false, said: '' } : null;
  const ms = Math.min(asked, MAX_RATE_LIMIT_WAIT_MS);
  return { ms, capped: asked > ms, said: `${Math.ceil(asked / 1000)}s` };
}

/** A failed job as the adapter answers it: the error, and the wait the server asked for. */
function failedJob(job) {
  return {
    error: refusal(job),
    ...(Number.isFinite(job.retryAfterMs) ? { retryAfterMs: job.retryAfterMs } : {}),
    ...(job.retryAfterCapped ? { retryAfterCapped: true } : {}),
  };
}

export function scrape(url, opts = {}) {
  const argv = ['scrape', String(url)];
  const job = runJob({ kind: 'fetch', url: String(url) }, opts);
  if (!job.ok) return { ok: false, url, ...failedJob(job), cmd: command(argv), transport: name };
  const kind = bodyKind(job.contentType);
  // A binary body is refused, not kept (ADR-0105). Read as text it loses every byte UTF-8
  // cannot hold, so the capture could neither be reopened as the file nor hold a quote.
  if (kind === 'binary') {
    const type = String(job.contentType ?? '').split(';')[0].trim();
    return { ok: false, url, cmd: command(argv), transport: name,
      error: `the response is ${type}, which is not text - the keyless transport cannot keep a faithful copy of it. `
        + 'Fetch it with --transport firecrawl-cli, which converts documents such as PDFs to text, or cite an HTML page that carries the same text.' };
  }
  if (kind !== 'html') return verbatim(url, job, argv);
  const html = job.body ?? '';
  const extraction = mainContent(html);
  const markdown = htmlToMarkdown(extraction.html);
  const grade = withDecodeFallback(gradeCompleteness(markdown, extraction), job);
  return {
    ok: true,
    url: job.url ?? url,
    title: titleOf(html),
    markdown,
    source: html,          // the text this Markdown was converted from (ADR-0140)
    statusCode: job.statusCode ?? '',
    transport: name,
    cmd: command(argv),
    ...grade,
  };
}

/** DuckDuckGo-lite: the keyless route to a result list, parsed from its HTML. */
export function search(query, { limit = 8, ...opts } = {}) {
  const argv = ['search', String(query)];
  const endpoint = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const job = runJob({ kind: 'fetch', url: endpoint }, opts);
  if (!job.ok) return { ok: false, query, ...failedJob(job), cmd: command(argv), results: [] };
  // DuckDuckGo answers an automated-looking request with a bot check, not an error: HTTP 200,
  // an anomaly modal, no result links. Parsed as a page, that was "no results" and ok: true,
  // so a refused search looked like a quiet topic (found 2026-09-27). It is a failed search,
  // reported with its reason. The user agent stays honest: getting past the check is not
  // this adapter's business.
  if (/anomaly-modal|bots use DuckDuckGo too/i.test(String(job.body ?? '')) && !/class=["']result-link["']/i.test(String(job.body ?? ''))) {
    return {
      ok: false, query, cmd: command(argv), results: [],
      error: 'DuckDuckGo served its bot check instead of results - the keyless search was refused from this network; retry later, or use a keyed search provider',
    };
  }
  const results = [];
  for (const link of resultLinks(job.body)) {
    const href = unwrapRedirect(hrefOf(link.href));
    if (!link.marked && /duckduckgo\.com/.test(href)) continue;
    results.push({ url: href, title: link.title, description: '' });
  }
  const seen = new Set();
  const unique = results.filter((r) => r.url && !seen.has(r.url) && seen.add(r.url));
  return { ok: true, query, cmd: command(argv), results: unique.slice(0, limit) };
}

/**
 * The result links of a keyless search page: those DuckDuckGo marks `result-link`, or, when it
 * marks none, every absolute link. Raw hrefs and inline titles, in page order.
 */
export function resultLinks(body) {
  const text = String(body ?? '');
  const marked = tagPairs(text, { open: /<a\b/gi, tag: { find: /href=/gi, match: /href=["']([^"']+)["'][^>]*class=["']result-link["'][^>]*>/iy }, close: () => '<\\/a>' });
  if (marked.length) return marked.map((p) => ({ href: p.tag[1], title: inline(p.body), marked: true }));
  return tagPairs(text, { open: /<a\b/gi, tag: { find: /href=/gi, match: /href=["'](https?:\/\/[^"']+)["'][^>]*>/iy }, close: () => '<\\/a>' })
    .map((p) => ({ href: p.tag[1], title: inline(p.body), marked: false }));
}

/**
 * An href attribute is HTML, so its value is decoded before it is a URL: `?a=1&amp;b=2`
 * means `b=2`. Taken raw, search and map returned URLs whose second parameter was
 * "amp;b" (Arena break test 8, 2026-09-28).
 */
function hrefOf(attribute) {
  return decodeEntities(attribute).trim();
}

function unwrapRedirect(href) {
  const match = String(href).match(/[?&]uddg=([^&]+)/);
  if (match) { try { return decodeURIComponent(match[1]); } catch { /* fall through */ } }
  return String(href);
}

/** Same-domain link mapping from one page. */
export function map(url, { limit = 50, ...opts } = {}) {
  const argv = ['map', String(url)];
  const job = runJob({ kind: 'fetch', url: String(url) }, opts);
  if (!job.ok) return { ok: false, url, error: refusal(job), cmd: command(argv), links: [] };
  let origin;
  try { origin = new URL(job.url ?? url); } catch { return { ok: false, url, error: 'unparseable url', cmd: command(argv), links: [] }; }
  const links = new Set();
  // The whole attribute, then decoded: the old pattern refused any href holding a '#', so
  // `&#38;` and every link to a section of another page were dropped. A link to a section
  // of THIS page names no new page; any other fragment is dropped from the page it names.
  for (const m of String(job.body ?? '').matchAll(/href=["']([^"']*)["']/gi)) {
    const href = hrefOf(m[1]);
    if (!href || href.startsWith('#')) continue;
    try {
      const resolved = new URL(href, origin);
      resolved.hash = '';
      if (resolved.host !== origin.host) continue;
      if (!/^https?:$/.test(resolved.protocol)) continue;
      links.add(resolved.toString());
    } catch { /* not a link we can use */ }
  }
  return { ok: true, url, cmd: command(argv), links: [...links].slice(0, limit) };
}

/** No key, no credits, nothing to ask about. */
export function status() {
  return { ok: true, transport: name, authenticated: false, credits: null, raw: 'keyless transport: no API key, no credits, no metering' };
}

export function runScrape(url, opts = {}) {
  return scrape(url, opts);
}

export default { name, scrape, search, map, command, status, runScrape };

// ---------------------------------------------------------------- internal addresses

/**
 * Where a page on the web may not send the collector (ADR-0110): loopback, the private ranges,
 * link-local (the cloud metadata endpoint, 169.254.169.254), carrier-grade NAT, unspecified,
 * multicast and reserved space, their IPv6 counterparts, and IPv4 written as IPv6.
 */
const INTERNAL = (() => {
  const list = new net.BlockList();
  for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) {
    list.addSubnet(address, prefix, 'ipv4');
  }
  for (const [address, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
    list.addSubnet(address, prefix, 'ipv6');
  }
  return list;
})();

export const isInternal = (address) => {
  // IPv4 written as IPv6 (`::ffff:127.0.0.1`, which the URL parser spells `::ffff:7f00:1`) is
  // judged as the IPv4 it is. A ::ffff:0:0/96 rule would not do: BlockList applies it to every
  // IPv4 address, which made 8.8.8.8 internal.
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(address);
  if (mapped) {
    const v4 = mapped[1] ?? [parseInt(mapped[2], 16) >> 8, parseInt(mapped[2], 16) & 255, parseInt(mapped[3], 16) >> 8, parseInt(mapped[3], 16) & 255].join('.');
    return INTERNAL.check(v4, 'ipv4');
  }
  const family = net.isIP(address);
  return family !== 0 && INTERNAL.check(address, family === 6 ? 'ipv6' : 'ipv4');
};

/**
 * Why `hostname` is internal, or null. A name is resolved, and is internal if any address it
 * resolves to is. A name this machine cannot resolve is not judged: through a proxy the proxy
 * resolves it, and a name nothing here can reach is not this machine's network.
 */
export async function internalTarget(hostname) {
  const host = String(hostname ?? '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return `${host} is this machine`;
  if (net.isIP(host)) return isInternal(host) ? `${host} is an internal address` : null;
  let addresses;
  try { addresses = await dns.promises.lookup(host, { all: true, verbatim: true }); } catch { return null; }
  const inside = addresses.find((a) => isInternal(a.address));
  return inside ? `${host} resolves to ${inside.address}, an internal address` : null;
}

/**
 * `lookup`, refusing an internal answer (ADR-0114). Node's fetch resolves a name through
 * `dns.lookup` when it connects, so the fetch child wraps it: the addresses judged are the
 * addresses connected to. `internalTarget` alone resolved a name to judge it, and fetch resolved
 * it again - a name server answering "public" first and "internal" second got the collector
 * into this machine's network (DNS rebinding, left open by ADR-0110).
 *
 * `allowInternal()` is read at each lookup: an internal URL the operator asked for is theirs.
 * `exempt` names the proxy hosts: behind a proxy the connection goes to the proxy, which may well
 * sit on an internal network, and the proxy resolves the target.
 */
export function guardedLookup(lookup, { allowInternal = () => false, exempt = [] } = {}) {
  const skip = new Set(exempt.map((h) => String(h).toLowerCase()));
  return function lookupGuarded(hostname, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : options;
    lookup(hostname, opts, (err, address, family) => {
      if (err || allowInternal() || skip.has(String(hostname).toLowerCase())) return cb(err, address, family);
      const found = (Array.isArray(address) ? address : [{ address }]).find((a) => isInternal(a.address));
      if (!found) return cb(null, address, family);
      return cb(Object.assign(new Error(`${hostname} resolved to ${found.address}, an internal address, when it was fetched - `
        + 'a page on the web may not send the collector into this machine\'s network'), { code: 'EINTERNAL', hostname }));
    });
  };
}

/** The hosts of the proxy variables: the connection behind a proxy goes to one of them. */
function proxyHosts(env) {
  return ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].flatMap((name) => {
    try { return env[name] ? [new URL(env[name].includes('://') ? env[name] : `http://${env[name]}`).hostname.replace(/^\[|\]$/g, '')] : []; } catch { return []; }
  });
}

// ---------------------------------------------------------------- the child half

/**
 * When this file is the process entry point it IS the job runner: read one JSON job on
 * stdin, do the async work, print one JSON line.
 */
async function child() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let job;
  try {
    job = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: `unparseable job: ${err.message}` }));
    return;
  }
  if (job.kind !== 'fetch') {
    process.stdout.write(JSON.stringify({ ok: false, error: `unknown job kind "${job.kind}"` }));
    return;
  }
  try {
    // Redirects are followed here, one hop at a time, so each hop's destination can be judged
    // (ADR-0110): a page on the web redirecting to 127.0.0.1 or 169.254.169.254 was captured,
    // with whatever that internal page held (found 2026-09-30, break-test). An internal URL
    // the operator asked for is theirs, and so are the redirects that stay inside it.
    const allowInternal = job.allowInternalRedirects === true
      || (job.allowInternalRedirects !== false && await internalTarget(new URL(job.url).hostname) !== null);
    // A caller that said `false` refused this machine's network for the whole fetch, and a NAME
    // asked for is judged by what it resolves to before anything is fetched (ADR-0155): a
    // literal address the caller spelled out is the caller's, as it is at the guard. The name
    // is judged again at connection time, where its addresses are the ones used (ADR-0114);
    // this earlier judgment names the refusal plainly and opens no connection.
    if (job.allowInternalRedirects === false) {
      const asked = new URL(job.url);
      const why = net.isIP(asked.hostname.replace(/^\[|\]$/g, '')) ? null : await internalTarget(asked.hostname);
      if (why) {
        process.stdout.write(JSON.stringify({ ok: false, url: job.url, error: `refused to fetch ${asked.host} - ${why}. `
          + 'This fetch was asked to stay out of this machine\'s network; if you meant that address, fetch it as your own '
          + '(the default policy), or set FETCHPROOF_ALLOW_INTERNAL_REDIRECTS=1.' }));
        return;
      }
    }
    // Every connection fetch makes is judged where it is made: a second resolution of a name
    // cannot answer differently from the one judged (ADR-0114).
    dns.lookup = guardedLookup(dns.lookup, { allowInternal: () => allowInternal, exempt: proxyHosts(process.env) });
    const init = {
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(job.timeout ?? 45_000),
    };
    let url = job.url;
    let response = await fetch(url, init);
    for (let hops = 0; [301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location'); hops += 1) {
      if (hops === 20) throw new Error('redirect count exceeded');
      const next = new URL(response.headers.get('location'), url);
      await response.body?.cancel();
      if (!/^https?:$/.test(next.protocol)) throw new Error(`a redirect to a ${next.protocol} URL is not followed`);
      const why = allowInternal ? null : await internalTarget(next.hostname);
      if (why) {
        process.stdout.write(JSON.stringify({ ok: false, url: job.url, error: `refused to follow a redirect from ${new URL(url).host} to ${next.host} - ${why}. `
          + 'A page on the web may not send the collector into this machine\'s network. If you meant that address, fetch it directly, '
          + 'or set FETCHPROOF_ALLOW_INTERNAL_REDIRECTS=1.' }));
        return;
      }
      url = next.href;
      response = await fetch(url, init);
    }
    // Read in the charset the server declared, and a charset the decoder did not know is
    // named on the answer, so the parent can grade the capture by it (G7, 2026-10-03).
    const { text: body, fallback: decodeFallback } = await boundedBody(response, 'the page');
    // A 429, or a 503 with Retry-After, carries the server's wait to the parent's loop (#313).
    const retry = response.ok ? null : retryAfter(response.status, response.headers.get('retry-after'));
    const asks = !retry ? ''
      : response.status === 429 ? ` - rate limited, ${retry.said ? `the server asks for a retry after ${retry.said}` : 'the server named no retry time'}`
        : ` - the server asks for a retry after ${retry.said}`;
    process.stdout.write(JSON.stringify({
      ok: response.ok,
      url,
      statusCode: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body,
      decodeFallback,
      error: response.ok ? '' : `HTTP ${response.status}${asks}`,
      ...(retry ? { retryAfterMs: retry.ms, ...(retry.capped ? { retryAfterCapped: true } : {}) } : {}),
    }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, url: job.url, error: fetchFailure(err) }));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await child();
}
