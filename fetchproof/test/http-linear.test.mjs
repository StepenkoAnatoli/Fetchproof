// The keyless extractor finds tag pairs in linear time, and finds exactly what the regex form of
// its rules finds.
//
// Found 2026-09-30 (break-test, PR #176): the lazy pair regexes - `<div\b[^>]*>([\s\S]*?)</div>`
// and a dozen like it - were quadratic on unclosed tags. Each opening tag with no closing tag
// after it scanned to the end of the page and failed, and the next one scanned again: 9.4 s for
// 391 KB of `<div>word`, 13 s for 156 KB of `<script`, in the collecting process, after the
// fetch's own timeout had passed. The scanner that replaced them (tagPairs) changed the COST and
// nothing else, so the old regex extractor was kept as an oracle. The rules have changed since -
// entities decoded once (G3, 2026-10-03), tags that end outside quoted attribute values (B3 and
// its review, 2026-10-25) - each time in both, written independently, so the oracle is now the
// regex form of the current rules, not the extractor as it was. Both are run over thousands of
// generated pages that lean on the edges: unclosed and stray tags, upper case, a '>' inside a
// quoted attribute, several hrefs in one tag, a '<' that starts no tag, comments, entities.

import { test, describe, assert } from './harness.mjs';
import * as linear from '../lib/http-transport.mjs';
import * as regex from './fixtures/regex-extract.mjs';

describe('http-linear');

/** A small seeded PRNG: the same pages on every run, on every host. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const TAGS = ['div', 'DIV', 'main', 'article', 'section', 'p', 'a', 'A', 'b', 'strong', 'em', 'i', 'code', 'li', 'tr', 'td', 'th',
  'h1', 'h2', 'H3', 'h6', 'title', 'script', 'style', 'svg', 'form', 'template', 'span', 'br', 'table', 'ul'];
const WORDS = ['limit', 'quota', 'requests', 'per', 'minute', 'the', 'free', 'plan', '1,000', '&amp;', '&#x41;', '&lt;', 'caveat', 'x>y', "it's", '"q"',
  // A '<' that starts no tag, before a quoted '>' (B3 review, F2, 2026-10-25).
  '<= "x > y"', '< 3'];
const ATTRS = ['', ' class="x"', ' href="/docs"', " href='https://a.example/p'", ' href="https://b.example/q" class="result-link"',
  ' class="result-link" href="https://c.example"', ' href="x>y"', ' data-v="a>b" href="/z"', ' href="/1" href="/2"', ' HREF="https://d.example"', ' id=main',
  // Quoted values that hide a '>' and tags, an apostrophe in an unquoted value, and a quote that
  // never closes (B3, 2026-10-25); a quoted '>' after the href, and before it (its review, F1).
  " title=O'Brien", ' alt="x > <b>y</b>"', " data-x = 'a > b'", ' title="unclosed', ' href="/q" title="p > q"',
  ' title="r > s" href="/t"'];

function page(next) {
  const pick = (list) => list[Math.floor(next() * list.length)];
  const parts = [];
  const n = 5 + Math.floor(next() * 60);
  for (let i = 0; i < n; i += 1) {
    const r = next();
    if (r < 0.30) parts.push(`<${pick(TAGS)}${pick(ATTRS)}>`);
    else if (r < 0.50) parts.push(`</${pick(TAGS)}>`);
    else if (r < 0.53) parts.push('<!--');
    else if (r < 0.56) parts.push('-->');
    else if (r < 0.58) parts.push(`<${pick(TAGS)}`);            // a tag that never reaches its '>'
    else parts.push(` ${Array.from({ length: 1 + Math.floor(next() * 12) }, () => pick(WORDS)).join(' ')} `);
  }
  return parts.join('');
}

test('the linear extractor gives the same capture as the regex one on 3,000 edge-heavy pages', () => {
  const next = rng(20260930);
  const differ = [];
  for (let i = 0; i < 3000 && differ.length < 3; i += 1) {
    const html = page(next);
    const got = linear.mainContent(html);
    const want = regex.mainContent(html);
    const same = JSON.stringify(got) === JSON.stringify(want)
      && linear.htmlToMarkdown(got.html) === regex.htmlToMarkdown(want.html)
      && linear.htmlToMarkdown(html) === regex.htmlToMarkdown(html)
      && linear.titleOf(html) === regex.titleOf(html)
      && JSON.stringify(linear.resultLinks(html).map(({ href, title }) => ({ href, title }))) === JSON.stringify(regex.searchLinks(html));
    if (!same) differ.push(html);
  }
  assert.deepEqual(differ, [], 'the linear extractor captured a page differently from the regexes it replaced');
});

/** The whole extraction of one page. */
function extractAll(html) {
  const main = linear.mainContent(html);
  linear.htmlToMarkdown(main.html);
  linear.htmlToMarkdown(html);
  linear.titleOf(html);
  linear.resultLinks(html);
}

/**
 * Eight small pages against one page holding the text of all eight: EQUAL WORK, timed in
 * alternating rounds, the fastest of each kept (noise only ever adds time). Returns ms for both.
 */
function equalWorkMs(small, large, { bound }) {
  let eight = Infinity;
  let one = Infinity;
  for (let round = 0; round < 3; round += 1) {
    let t = performance.now();
    for (let i = 0; i < 8; i += 1) extractAll(small);
    eight = Math.min(eight, performance.now() - t);
    t = performance.now();
    extractAll(large);
    one = Math.min(one, performance.now() - t);
    // A large page over the bound in two rounds has answered: a quadratic regression would
    // otherwise spend minutes repeating it, where no watchdog reaches synchronous code. One round
    // does not answer: a single run preempted under load read 7.4x and 15.6x on linear code
    // (2026-10-27, review of PR #440), so the fastest of two rounds, an eight-page run apart, must
    // be over the bound too.
    if (round >= 1 && one > bound * Math.max(eight, 1)) break;
  }
  return { eight: Math.max(eight, 1), one };
}

// EQUAL WORK, so the ratio does not depend on how busy the machine is. Linear extraction takes
// about as long for one page as for eight pages an eighth its size; quadratic extraction takes
// about eight times as long. Both sides last about as long, and the rounds alternate, so a loaded
// machine slows them alike. Measured 2026-10-01 on two cores: linear code reads 1.0-1.5x idle and
// at most 3.2x under six busy loops, and the regex extractor kept as the oracle reads 7.5-8.7x, so
// the bound of 4 sits between them (0 red in 30 loaded runs; at a bound of 3, 1 in 15).
//
// The two designs before this timed one small page against one page eight (earlier, four) times
// its size, against bounds of 9 and then 24. A ~10 ms run slips through a scheduler slice while a
// ~200 ms run is preempted all the way through, so CPU contention inflated exactly the ratio under
// test: 8.2x of 9 in CI (2026-10-01), then 24-40x of 24 on correct code with six busy loops on two
// cores (break-test PR #182, 1 to 3 runs in 10-12 red).
test('extraction time grows linearly with a page of unclosed tags, not quadratically', () => {
  const shapes = {
    'unclosed <div>': (n) => '<div>word '.repeat(n),
    'unclosed <script': (n) => '<script>x '.repeat(n),
    'unclosed <p><b>': (n) => '<p><b>word '.repeat(n),
    'unclosed <!--': (n) => '<!-- x '.repeat(n),
    'unclosed <li>': (n) => '<li>item '.repeat(n),
    'unclosed <a href>': (n) => '<a href="/x">link '.repeat(n),
    'tags with no >': (n) => '<li <a <div '.repeat(n),
    // The six shapes below run on a fraction of n (2026-10-26, Phase 4b breaker F4). At full n
    // they nearly doubled this test, 44-48 s under load against 24-25 s for the seven above, and
    // the test is synchronous, so the 60 s watchdog cannot stop it. With its guard removed, each
    // shape still reads 5.5-11.6x against the bound of 4 (the 4b-fix report lists the mutations).
    // 'unterminated quote' keeps half: at a quarter its guards read only 4.0-4.5x. 'quoted > in
    // attributes' fails under none of the mutations tried, and stays, at a quarter, for the
    // common case.
    //
    // The tag stripper skips quoted attribute values (2026-10-25, B3). A quote that never closes
    // ends nothing: the tag falls back to its first '>'. Failing the tag there instead, and
    // trying the next '<', would look for the quote's partner again from every '<' before it,
    // each time through the rest of the page.
    'quoted > in attributes': (n) => '<span title="a > b">word '.repeat(n / 4),
    'unterminated quote after a run of <': (n) => `${'<i word '.repeat(n / 2)}title="x> ${'<b>tail</b> '.repeat(n / 2)}`,
    'a quote in every tag, closed by the next tag': (n) => '<b title="x> word '.repeat(n / 4),
    // The passes that read a tag by name end it as the stripper does (2026-10-25, review of the B3
    // fix, F1). A pair with no closing tag is tried again from the next character, so tags start
    // inside one another: along one long tag, and inside a quoted value of the tag before.
    // Without the tag ends remembered by '=', each of these list items scans every attribute after
    // it - 30 s for 10,000, so an eighth as many here.
    'attributes of one long tag, each the start of a list item': (n) => `${"<li y='a' ".repeat(n / 8)}>`,
    // Without the href hits listed once, each link after one inside a value lists the long tag's
    // hits again.
    'links inside quoted values of one long link': (n) => `${"<a href='/x' t='<a href=/y>' ".repeat(n / 32)}>`,
    // Without the closing tags listed once, a closing tag for the long tag is searched for again,
    // from its end to the end of the page, after each list item inside it. The text after is one
    // long word, which the other passes read quickly, so that search is most of the work.
    'closed list items inside quoted values, text after': (n) => `${"<li t='<li></li>' ".repeat(n / 32)}>${'x'.repeat(10 * n)}`,
    // A comment ends at its '-->' (2026-10-27, review of PR #440, BR-2). One with none after it
    // ends at its first '>', and that no '-->' follows is remembered: searched for again from each
    // such comment, it took 8.7 s for 10,000 of these.
    //
    // These two are cheap per character, so they take more of n than the shapes above, for the
    // eight pages to last about as long as those do. At an eighth of n they lasted 20-40 ms, and
    // one preempted round of the large page read 4.6x and 15.6x on correct code under load (2 runs
    // in 11), when one round over the bound still answered (equalWorkMs).
    'unterminated <!-- with a ">" after each': (n) => '<!-- x> '.repeat(n),
    // A tag inside a comment reads no quoted value (R-1 of that fix), so every tag asks where the
    // last `<!--` before it is. The `<!--` are listed once: looked for backwards from each tag, it
    // took 5.6 s for 10,000 of these tags after one comment.
    'one comment, then tags with quoted values': (n) => `<!-- x -->${'<div class="a">w '.repeat(n / 4)}`,
    // Every tag after a `<!--` of its own, with no `-->` anywhere and the page's one '>' at its end:
    // each tag asks where that comment ends. The `-->` and the '>' are remembered, and so is the
    // span of the last `<!--` asked about: with any of the three searched for again, it read
    // 6.0-8.0x (2026-10-27, review of PR #440, FRA-1 of the BR-2 fix).
    'unterminated <!-- before each tag, one > at the end': (n) => `${'<!-- <div class="a" w '.repeat(n / 2)}>`,
    // A tag inside an <xmp>, a <textarea> or a <title> reads no quoted value (FRA-2), so every tag
    // asks whether it lies in such an element. Here an <xmp> comes before each tag and no `</xmp>`
    // follows any: the first runs to the end of the page, and the elements found are remembered.
    'unclosed <xmp> before each tag': (n) => '<xmp><b class="a">w '.repeat(n / 4),
    // Inside one, nothing opens another (FRA3-1): the elements are found forward, each after the
    // last one's closing tag, and listed once, and each tag finds the one before it by binary
    // search. Here a closed <xmp> comes before each tag: looked up along the list instead, it read
    // 6.2-6.4x. It runs on half of n: at a quarter, that read only 5.0-5.2x.
    'a closed <xmp> before each tag': (n) => '<xmp>x</xmp><b class="a">w '.repeat(n / 2),
    // Nor does one open inside a comment (FRA4-1): looking for them, each comment is stepped over to
    // where it ends. Here each tag follows a `<!--` that ends at its '>', with no `-->` anywhere:
    // that none follows is remembered, and searched for again from each comment, it read 7.7-8.0x.
    'an unterminated <!-- with a ">" before each tag': (n) => '<!-- x> <b class="a">w '.repeat(n / 4),
  };
  const BOUND = 4;
  const slow = [];
  for (const [name, make] of Object.entries(shapes)) {
    const small = `<title>t</title>${make(10_000)}`;
    // Extraction is synchronous, so the watchdog cannot stop it: a quadratic regression would
    // spend minutes on the large page. A small page this slow twice has already answered (once
    // could be a preempted run: the first passes take 0.1-0.6 s under load).
    const timed = () => { const t = performance.now(); extractAll(small); return performance.now() - t; };
    let first = timed();
    if (first > 1500) first = Math.min(first, timed());
    if (first > 1500) { slow.push(`${name}: ${first.toFixed(0)} ms for ~100 KB - superlinear, the large page was not tried`); continue; }
    const { eight, one } = equalWorkMs(small, `<title>t</title>${make(80_000)}`, { bound: BOUND });
    const ratio = one / eight;
    if (ratio > BOUND) slow.push(`${name}: one page with the text of eight took ${ratio.toFixed(1)}x as long as the eight (${eight.toFixed(0)} ms -> ${one.toFixed(0)} ms)`);
  }
  assert.deepEqual(slow, [], `extraction is superlinear:\n  ${slow.join('\n  ')}`);
});
