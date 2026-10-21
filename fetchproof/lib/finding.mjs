// finding.mjs - the auto-extracted Finding cell (ADR-0016, superseding ADR-0009).
//
//   firstFinding(markdown, fallback) -> one line of prose
//
// Two arguments over the heuristics behind them. Pure by construction: no filesystem,
// no corpus, no adapter - the one module a caller can exercise with a string.
//
// What it produces is a DRAFT. The agent must rewrite it into a real claim before the
// gate; this only has to beat a blank cell.

const MAX_CHARS = 220;

// Boilerplate families. A line matching any of these is never a finding.
const BOILERPLATE = [
  /^\s*(home|docs?|documentation|search|menu|navigation|skip to|on this page|table of contents)\s*$/i,
  /^\s*(sign in|sign up|log ?in|log ?out|get started|contact (us|sales)|book a demo|talk to sales)\b/i,
  /^\s*(cookie|we use cookies|accept all|privacy preferences|manage preferences)\b/i,
  /^\s*(copyright|\(c\)|©|all rights reserved)\b/i,
  /^\s*(previous|next|back to top|edit this page|was this (page )?helpful)\b/i,
  /^\s*(follow us|share on|subscribe|newsletter|join our)\b/i,
];

const TRACKING = [
  /utm_[a-z]+=/i,
  /\b(gclid|fbclid|mc_cid|ref=)\b/i,
  /\bgoogle-?analytics\b|\bgtag\(|\bdataLayer\b/i,
];

const CAMPAIGN = [
  /\b(free trial|no credit card|limited time|save \d+%|try it (free|now))\b/i,
  /\b(trusted by|loved by|join \d[\d,]* (developers|teams|companies))\b/i,
];

const NAV_LIKE = /^[\w\s/|·—–-]{0,40}$/;

/** A tier-hero block: a pricing card's stacked fragments, not a sentence about price. */
const TIER_HERO = /^\s*\$?\d[\d,.]*\s*(\/\s*(mo|month|yr|year|user))?\s*$/i;

function stripMarkdown(line) {
  return String(line)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')        // links keep their text
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')          // code spans
    .replace(/[*~]{1,3}/g, '')                       // emphasis
    // An underscore is emphasis only at a word's edge; inside a word it is the word -
    // `return_run_details` read as "returnrundetails" named a parameter that does not exist,
    // and a quote copied from that draft could never be found in the capture (2026-10-02).
    .replace(/(^|[^A-Za-z0-9])_{1,3}(?=[^\s_])|(?<=[^\s_])_{1,3}(?=$|[^A-Za-z0-9])/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/, '')                // heading marks
    .replace(/^\s{0,3}[-*+]\s+/, '')                 // bullets
    .replace(/^\s{0,3}>\s?/, '')                     // quotes
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoise(line) {
  if (!line) return true;
  if (BOILERPLATE.some((re) => re.test(line))) return true;
  if (TRACKING.some((re) => re.test(line))) return true;
  if (CAMPAIGN.some((re) => re.test(line))) return true;
  if (TIER_HERO.test(line)) return true;
  if (line.length < 25 && NAV_LIKE.test(line)) return true;
  return false;
}

/** Split a paragraph into sentences without breaking on `e.g.`, `v2.1`, or `1,000.` */
export function sentences(text) {
  const out = [];
  let current = '';
  const source = String(text);
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    current += ch;
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const before = source.slice(Math.max(0, i - 4), i + 1);
    const after = source.slice(i + 1, i + 3);
    if (/\b(e\.g|i\.e|etc|vs|no|fig|approx|inc|ltd)\.$/i.test(before)) continue;
    if (/\d\.$/.test(before) && /^\s*\d/.test(after)) continue; // 1.5, v2.1
    if (!/^\s|^$/.test(after)) continue;                         // mid-token dot
    out.push(current.trim());
    current = '';
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/** A markdown table's first data row, rendered as prose. Pricing pages are tables. */
function fromTable(lines, index) {
  const header = lines[index];
  if (!header.trim().startsWith('|')) return null;
  const sep = lines[index + 1] ?? '';
  if (!/^\|?[\s:|-]+\|/.test(sep) || !sep.includes('-')) return null;
  const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => stripMarkdown(c));
  const head = cells(header);
  for (let i = index + 2; i < lines.length; i += 1) {
    const row = lines[i];
    if (!row.trim().startsWith('|')) break;
    const values = cells(row);
    if (values.every((v) => !v)) continue;
    const pairs = head
      .map((name, at) => (name && values[at] ? `${name}: ${values[at]}` : ''))
      .filter(Boolean);
    if (pairs.length >= 2) return pairs.join(', ');
  }
  return null;
}

/**
 * The ranking policy, in one table.
 *
 * Every weight the extractor applies is declared here, named, with the reason beside it.
 * It used to be a run of `if (...) value += n` statements in one function and a second
 * run of them inside the selector, which meant nobody could state the priority order
 * without executing the code — and adding a signal meant guessing how it interacted with
 * the eight already there.
 *
 * Read it top to bottom and the policy is legible: a measured quantity is the strongest
 * single signal, where the sentence sits on the page is worth as much as what it says,
 * and the things that look concrete but are not — a price in a comparison table, a
 * number inside a sign-up prompt — are pushed down hard enough to lose to plain prose.
 *
 * `context` carries what the sentence alone cannot say: the heading it sits under, and
 * whether it came from a table row.
 */
export const RULES = [
  // --- what the sentence says -------------------------------------------------------
  { name: 'measured-quantity', weight: 4, why: 'a counted limit is the thing a design rests on',
    test: (t) => /\b\d[\d,]*\s*(credits?|requests?|pages?|calls?|tokens?|rpm|per (minute|second|hour|day|month))\b/i.test(t) },
  { name: 'retention', weight: 3, why: 'how long data is kept is a decision input, and pages state it plainly',
    test: (t) => /\b(retain(s|ed)?|retention|delete[sd]?|stored? for|for \d+ days?)\b/i.test(t) },
  { name: 'metering-rule', weight: 4, why: 'HOW usage is counted decides a collector design as much as the limit itself, and such sentences often carry no digit at all',
    test: (t) => /\b(count(s|ed|ing)? (toward|as|against)|are not counted|billed|charged|consumed|deducted|does not count)\b/i.test(t) },
  { name: 'limit-vocabulary', weight: 3, why: 'the words a page uses when it is stating a bound',
    test: (t) => /\b(limit|quota|rate|maximum|max|minimum|per team|per key|concurrent)\b/i.test(t) },
  { name: 'price', weight: 3, why: 'a currency amount is concrete and checkable, in every form a page writes one - Stripe states its rate as "2.9% + 30 cents per successful card charge", which a leading-symbol pattern cannot see at all',
    test: (t) => /[$€£¥]\s?\d/.test(t) || /\d\s?[¢€£]/.test(t) || /\d+(\.\d+)?%\s*\+/.test(t) || /\bper (successful|transaction|charge)\b/i.test(t) },
  { name: 'obligation', weight: 2, why: 'must/requires/prohibits is a rule, not a description',
    test: (t) => /\b(must|requires?|supports?|returns?|allows?|prohibit(s|ed)?|permitted|includes?)\b/i.test(t) },
  { name: 'version', weight: 2, why: 'a version pins a claim to something that can be re-checked',
    test: (t) => /\bv?\d+\.\d+(\.\d+)?\b/.test(t) },
  { name: 'number', weight: 2, why: 'any digit beats none, weakly',
    test: (t) => /\d/.test(t) },
  { name: 'percentage', weight: 2, why: 'a rate or share, usually from a terms page',
    test: (t) => /\b\d+(\.\d+)?\s*%/.test(t) },
  { name: 'date', weight: 1, why: 'a claim that dates itself can be re-checked against the page later, weakly',
    test: (t) => /\b\d{4}-\d{2}-\d{2}\b|\b(19|20)\d{2}\b/.test(t) },

  // --- where it sits ----------------------------------------------------------------
  { name: 'answers-a-question', weight: 3, why: 'an FAQ answer states terms plainly, and the question above it is usually plain text rather than a heading - so the heading rules cannot see it',
    test: (t, c) => c.answersQuestion === true },
  { name: 'evidence-heading', weight: 3, why: 'the cheapest signal a page gives about which claims are load-bearing',
    test: (t, c) => EVIDENCE_HEADING.test(c.headings ?? c.heading ?? '') },
  { name: 'chrome-heading', weight: -3, why: 'blog and careers copy is not terms, however concrete it sounds',
    test: (t, c) => CHROME_HEADING.test(c.headings ?? c.heading ?? '') },

  // --- shape ------------------------------------------------------------------------
  { name: 'full-sentence', weight: 3, why: 'long enough to carry a claim, short enough to be one',
    test: (t) => t.length >= 60 && t.length <= MAX_CHARS },
  { name: 'short-sentence', weight: 1, why: 'a claim can be brief, and brevity alone should not disqualify it',
    test: (t) => t.length >= 35 && t.length < 60 },
  { name: 'over-length', weight: -1, why: 'past the cap it will be truncated anyway',
    test: (t) => t.length > MAX_CHARS },

  // --- things that look like evidence and are not -----------------------------------
  { name: 'account-or-consent', weight: -4, why: 'a sign-up prompt carrying a number is the classic false positive',
    test: (t) => /\b(sign in|sign up|log in|create an account|cookie|consent|subscribe)\b/i.test(t) },
  { name: 'comparison-row', weight: -4, why: 'one row of a pricing matrix describes ONE tier, and rarely the one being asked about',
    test: (t, c) => c.fromTable === true && COMPARISON_ROW.test(t) },
  { name: 'question', weight: -3, why: 'an FAQ heading asks; it does not answer',
    test: (t) => /\?$/.test(t) },
  { name: 'marketing-voice', weight: -2, why: 'first person and superlatives are the vendor talking about itself',
    test: (t) => /\b(we|our|you'll love|amazing|powerful|simply)\b/i.test(t) },
  { name: 'table-row', weight: 2, why: 'a table states terms densely - but only when it is not a comparison matrix, or this bonus would cancel the penalty below',
    test: (t, c) => c.fromTable === true && !COMPARISON_ROW.test(t) },
];

/**
 * A pricing-matrix row: several tier fields strung together by the table reader.
 *
 * This is the SerpApi pricing case, which was a known weakness — the extractor picked
 * "Plan: Starter$25 / month, Searches / month: 1,000, Throughput / hour: 200" over the
 * prose that actually answered the question. Such a row is dense with numbers and scores
 * well on every other rule, so it needs a penalty of its own rather than a smaller bonus
 * for tables generally: a table of endpoint limits is still worth reading.
 */
function COMPARISON_ROW_TEST(text) {
  // Counted, not matched by repetition.
  //
  // This was `(:\s*\S+[,;].*){2,}`, then `(:[^,;]+[,;]){2,}`, and both failed on real
  // rows for the same reason: `{2,}` requires the matches to be ADJACENT, and a row reads
  // `Free: 100, Pro: No limit, Scale: No limit` — there is a tier name between one pair
  // and the next, so the second repetition never starts where the first ended.
  //
  // The table reader builds these rows itself, joining `name: value` with ", ". So the
  // honest test is to count the pairs it made, not to describe them with a pattern that
  // has now been wrong twice.
  const source = String(text);
  const pairs = (source.match(/: /g) ?? []).length;
  return pairs >= 3 || tierThenPeriodThenDigit(source);
}

/**
 * A tier word, then a period word, then a digit, in that order and on one line - the
 * question `/\b(plan|tier)\b.*\b(month|year|user)\b.*\d/i` asked, answered in three
 * linear scans instead of one backtracking match.
 *
 * That regex is QUADRATIC in the row's length. On a row that does not match, every tier
 * word starts a scan that runs to the end of the row before it can fail, so the cost is
 * the number of tier words times the length. Measured on this machine, one row:
 *
 *    50 KB      0.4 s
 *   100 KB      1.6 s
 *   200 KB      6.0 s
 *   400 KB     24.1 s     <- and the rule runs TWICE per row, as `comparison-row` and
 *                            again, negated, as `table-row`
 *
 * The row is a captured page's own content, so its length is the vendor's choice, and
 * this is inside the extractor the collector runs over EVERY page it fetches
 * (`lib/collect.mjs`) and the artifact producer runs over every row (`lib/artifact.mjs`).
 * This repository's own corpus already holds a capture with a single 308,705-character
 * line, so a row of that size is not a hypothesis (found 2026-10-01, break-test).
 *
 * Splitting on `\n` first keeps the answer identical: `.` does not cross a line, so the
 * regex only ever matched inside one.
 */
function tierThenPeriodThenDigit(text) {
  for (const line of String(text).split('\n')) {
    const tier = line.search(/\b(?:plan|tier)\b/i);
    if (tier < 0) continue;
    const afterTier = line.slice(tier);
    const period = afterTier.search(/\b(?:month|year|user)\b/i);
    if (period < 0) continue;
    if (/\d/.test(afterTier.slice(period))) return true;
  }
  return false;
}
const COMPARISON_ROW = { test: COMPARISON_ROW_TEST };

/**
 * Score a candidate against the rule table.
 *
 * Returns the total only, so the existing callers and tests are unaffected. Use
 * `explainScore` when the reason matters — the selector does, because the signals it
 * reports to a reviewer must be the ones that actually moved the number.
 */
export function score(text, context = {}) {
  return explainScore(text, context).total;
}

/** The same scoring, with the rules that fired. One evaluation, so the two cannot differ. */
export function explainScore(text, context = {}) {
  const fired = [];
  let total = 0;
  for (const rule of RULES) {
    if (!rule.test(text, context)) continue;
    fired.push(rule.name);
    total += rule.weight;
  }
  return { total, signals: fired };
}

/**
 * Page markdown in, one line of prose out.
 * `fallback` is returned verbatim when nothing in the page beats noise.
 */
/**
 * Headings under which a page states its actual terms.
 *
 * A sentence about a rate limit sitting under "Rate limits" is far more likely to BE the
 * rate limit than the same sentence in a feature tour. This is the cheapest signal a
 * page gives about which of its claims are load-bearing, and it costs one regex.
 */
const EVIDENCE_HEADING = /\b(pricing|plans?|limits?|rate limits?|quotas?|usage|api|endpoints?|terms|policy|policies|privacy|retention|billing|credits?|authentication|errors?)\b/i;

/** Headings that mark the parts of a page nobody is citing. */
/**
 * Headings that mark the parts of a page nobody is citing.
 *
 * Two families, and the second was missing entirely until the 2026-09-20 generalization
 * probe. Headings were classified as evidence-bearing, chrome, or *nothing* — and the
 * "nothing" class is where marketing copy lives. Under "Key features" or "Build with the
 * power of the web", a capability boast ("our index includes over 30 billion pages")
 * scored level with a rate limit, because neither heading family claimed it. Leaving
 * that middle unclassified was a modelling choice nobody made deliberately.
 */
const CHROME_HEADING = new RegExp([
  // the obviously-not-terms parts of a site
  '\\b(blog|news|announcements?|careers|about us|community|testimonials?|customers?)\\b',
  '|\\b(get started free|sign ?up|newsletter)\\b',
  // the marketing middle: a section selling the product rather than stating its terms
  '|\\b(key |special |core |top )?features?\\b|\\bwhy (choose|use)\\b|\\bbuild with\\b',
  '|\\bcapabilit(y|ies)\\b|\\bwhat you can build\\b|\\buse cases?\\b|\\bhow it works\\b',
].join(''), 'i');

/**
 * The extractor, with its reasoning kept.
 *
 * `firstFinding` returns only the sentence, which is what the collector writes into the
 * evidence table. But a one-line finding is exactly the thing a person has to go and
 * verify by hand, so this also returns WHERE it came from: the heading it sat under, the
 * surrounding paragraph, and which signals fired. Same selection, more of the working
 * shown — `firstFinding` is now a thin wrapper over it, so the two cannot disagree.
 */
export function findingWithContext(markdown, fallback = '') {
  const source = String(markdown ?? '');
  const none = { finding: fallback, excerpt: '', heading: '', signals: [], score: 0 };
  if (!source.trim()) return none;

  const lines = source.split(/\r?\n/);
  const candidates = [];
  let inFence = false;
  let heading = '';
  const stack = [];
  let blockStart = 0;
  let block = [];
  let lastLine = '';

  // NOT a candidate: the joined paragraph.
  //
  // Tried on 2026-09-20 and reverted the same hour, because it was measured. Stripe
  // splits one claim over two lines - `**2.9% + 30 cents**` then `per successful
  // transaction for domestic cards` - and joining adjacent lines recovers it. But on a
  // marketing page adjacent lines are LIST ITEMS, not continuations, so the same join
  // produced collages: Algolia went from "10,000 requests/mo included then $0.60 per
  // additional 1K requests" to "NeuralSearch AI Collections Smart Groups Real-time
  // personalization 99.99% availability", which scores well and says nothing.
  //
  // The idea is not wrong, the representation is: recovering a split claim needs to know
  // a continuation from a list item, and line adjacency does not carry that.
  const flushBlock = () => { const text = block.join(' ').trim(); block = []; return text; };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    // Excerpts use physical paragraph boundaries, including ones inside skipped fences.
    // Remember the start while scanning so recovery never inserts each line at the front.
    if (!raw.trim() || /^\s{0,3}#{1,6}\s/.test(raw)) blockStart = i + 1;
    if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;

    // A heading STACK, not the last heading seen.
    //
    // Pages nest: `## Plans` / `### Search` / `#### Capacity`, with the pricing under the
    // deepest one. Remembering only the last heading meant "Plans" - the word that makes
    // the section evidence-bearing - was overwritten twice before anything under it was
    // scored. A section's context survived exactly as long as no subheading appeared
    // inside it, which on a marketing page is never.
    const head = raw.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (head) {
      const depth = head[1].length;
      stack.length = Math.min(stack.length, depth - 1);
      stack[depth - 1] = stripMarkdown(head[2]);
      heading = stripMarkdown(head[2]);
      flushBlock();
      continue;
    }
    if (!raw.trim()) { flushBlock(); continue; }

    if (raw.trim().startsWith('|')) {
      const row = fromTable(lines, i);
      // A table row is its own context: the row IS the excerpt.
      if (row && !isNoise(row)) candidates.push({ text: row, fromTable: true, heading, headings: stack.filter(Boolean).join(' / '), excerpt: row });
      continue;
    }

    const line = stripMarkdown(raw);
    // An FAQ question is usually plain text, not a heading, so the heading rules cannot
    // see it. Remember whether the previous non-empty line asked something.
    const answersQuestion = lastLine.endsWith('?');
    if (line) { block.push(line); lastLine = line; }
    if (isNoise(line)) continue;
    for (const sentence of sentences(line)) {
      const text = sentence.trim();
      if (text.length < 25) continue;
      if (isNoise(text)) continue;
      // The excerpt is resolved after the paragraph closes, so a sentence carries the
      // whole paragraph it came from rather than just itself.
      candidates.push({ text, fromTable: false, heading, headings: stack.filter(Boolean).join(' / '), answersQuestion, lineIndex: i, blockStart });
    }
  }
  flushBlock();

  if (!candidates.length) return none;

  // One evaluation, against the one table. The selector used to apply a second run of
  // weights of its own on top of score(), so the number a reviewer saw and the number
  // that chose the sentence were computed by two pieces of code that could disagree.
  let best = null;
  for (const candidate of candidates) {
    const { total, signals } = explainScore(candidate.text, {
      heading: candidate.heading,
      headings: candidate.headings ?? candidate.heading ?? '',
      fromTable: candidate.fromTable === true,
      answersQuestion: candidate.answersQuestion === true,
    });
    if (!best || total > best.value) best = { ...candidate, value: total, signals };
  }
  if (!best || best.value <= 0) return none;

  // Recover the paragraph the winner sat in, bounded. A table row already has one.
  let excerpt = best.excerpt ?? '';
  if (!excerpt && best.lineIndex !== undefined) {
    for (let i = best.blockStart; i < lines.length && lines[i]?.trim() && !/^\s{0,3}#{1,6}\s/.test(lines[i]); i += 1) {
      const line = stripMarkdown(lines[i]);
      if (!line) continue;
      excerpt += `${excerpt ? ' ' : ''}${line}`;
      // One character beyond the cap proves truncation, including an exact-cap prefix.
      if (excerpt.length > EXCERPT_CHARS) break;
    }
  }
  if (excerpt.length > EXCERPT_CHARS) excerpt = `${excerpt.slice(0, EXCERPT_CHARS).trimEnd()}…`;

  return { finding: cap(best.text), excerpt, heading: best.heading ?? '', signals: best.signals, score: best.value };
}

/** How much of the surrounding paragraph a reviewer needs to confirm the sentence. */
export const EXCERPT_CHARS = 420;

/**
 * Page markdown in, one line of prose out.
 *
 * A wrapper over `findingWithContext`, so the sentence the collector writes and the
 * excerpt a reviewer reads are chosen by one piece of code and cannot drift apart.
 */
export function firstFinding(markdown, fallback = '') {
  return findingWithContext(markdown, fallback).finding;
}

function cap(text) {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= MAX_CHARS) return one;
  const cut = one.slice(0, MAX_CHARS - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 80 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

export { MAX_CHARS };
