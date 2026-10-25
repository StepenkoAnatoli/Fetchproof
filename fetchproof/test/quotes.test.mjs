// ADR-0087: a claim may carry `[quote: ...]`, and the gate checks the quote is really in the
// row's capture. Research: docs/decisions/2026-09-28-quote-anchors.

import { test, describe, assert, makePassingProject, corrupt } from './harness.mjs';
import { PATHS } from '../lib/core.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { runCheck } from '../lib/checks.mjs';
import { runPreflight } from '../lib/preflight.mjs';
import { quoteAnchors, normalizeForMatch, anchorFound, quoteTooShort, unreadableQuoteMarkers, MIN_QUOTE_CHARS } from '../lib/quotes.mjs';

describe('quotes');

test('quote markers are read from a Finding cell, fragments split on an ellipsis', () => {
  assert.deepEqual(quoteAnchors('No marker here, "just prose" in quotes.'), []);
  assert.deepEqual(quoteAnchors('Claim. [quote: the free plan allows 10 requests] and [quote: a ... b c]').map((q) => q.fragments),
    [['the free plan allows 10 requests'], ['a', 'b c']]);
  assert.deepEqual(quoteAnchors('[quote: one … two]')[0].fragments, ['one', 'two']);
});

// Found 2026-09-29, real use on MoonAliza: the marker ended at the first `]`, so a quote of
// code (`toolCalls[i].Index = ...`) was cut to "toolCalls[i" - which the capture did contain,
// so a quote nobody had checked in full passed - and a quoted Markdown link failed on its `[`.
test('a quote may contain balanced brackets: code subscripts and Markdown links', () => {
  assert.deepEqual(quoteAnchors('Claim. [quote: toolCalls[i].Index = tc.Function.Index] rest').map((q) => q.quote),
    ['toolCalls[i].Index = tc.Function.Index']);
  assert.deepEqual(quoteAnchors('[quote: just released - [v0.4.7](https://x.invalid/v0.4.7)] and [quote: a b c]').map((q) => q.quote),
    ['just released - [v0.4.7](https://x.invalid/v0.4.7)', 'a b c']);
  assert.equal(anchorFound(quoteAnchors('[quote: just released - [v0.4.7](https://x.invalid/v0.4.7)]')[0].fragments,
    'we just released - [v0.4.7](https://x.invalid/v0.4.7) today'), true);
});

test('matching survives what a capture does to text, and nothing looser', () => {
  const body = 'The **ﬁrst** plan — see [the docs](https://x.invalid/a) — says \\*“don’t   stop”\\*.';
  assert.equal(normalizeForMatch('The FIRST plan - see the docs - says "don\'t stop".'), normalizeForMatch(body));
  assert.equal(anchorFound(['first plan - see the docs'], body), true, 'ligature, emphasis, dash and link text');
  assert.equal(anchorFound(['says "don\'t stop"'], body), true, 'curly quotes, escapes, runs of spaces');
  assert.equal(anchorFound(['first plan', 'says'], body), true, 'fragments in order');
  assert.equal(anchorFound(['says', 'first plan'], body), false, 'fragments out of order');
  assert.equal(anchorFound(['the second plan'], body), false, 'an invented word is not drift');
});

function quoted(finding) {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (t) => t.replace(
    '| The free plan allows 10 requests per minute and includes 1,000 credits. |', `| ${finding} |`));
  return runCheck('citations', readCorpus(dir));
}

test('a quote found in its capture passes; a fabricated one blocks; a short one warns', () => {
  const real = quoted('Free tier limits. [quote: The free plan allows 10 requests per minute]');
  assert.ok(!real.some((f) => f.severity !== 'pass'), JSON.stringify(real));
  assert.ok(real.some((f) => /1 quote/.test(f.detail)), 'the pass message counts the anchored quotes');

  const fake = quoted('Free tier limits. [quote: The free plan allows 100 requests per minute]');
  const blocked = fake.find((f) => f.rule === 'quote-not-found');
  assert.equal(blocked?.severity, 'fail', JSON.stringify(fake));
  assert.match(blocked.detail, /E-01.*100 requests per minute/);

  const short = quoted('Free tier limits. [quote: free plan]');
  assert.equal(short.find((f) => f.rule === 'quote-too-short')?.severity, 'warn', JSON.stringify(short));
});

// #319: a `[quote` the parser could not read was not a marker at all - no closing bracket, a
// space before the colon, no colon - so the cell read as one with no quote and nothing checked it.
test('the attempts at a marker the parser cannot read are found, and a readable one is still read', () => {
  const at = (s) => unreadableQuoteMarkers(s).map((a) => a.text);
  assert.deepEqual(at('[quote: no closing bracket'), ['[quote: no closing bracket']);
  assert.deepEqual(at('Claim [Quote : a space before the colon]'), ['[Quote : a space before the colon]']);
  assert.deepEqual(at('Claim [quote no colon at all]'), ['[quote no colon at all]']);
  assert.deepEqual(at('[quote: read] and [QUOTE: read too] and [quote: a [b [c]] d]'), []);
  assert.deepEqual(at('Write it as [quote: ...] or [quote: …] in the cell'), []);
  assert.deepEqual(at('Not attempts: `[quote x`, https://x.invalid/?q=[quote and [Quote of the day](https://x.invalid/q), [quotes] and [quoted]'), []);
  const cell = 'Two. [quote: the free plan allows ten] then [quote the paid plan allows more]';
  assert.deepEqual(quoteAnchors(cell).map((x) => x.quote), ['the free plan allows ten']);
  assert.deepEqual(at(cell), ['[quote the paid plan allows more]']);
});

test('a quote marker the gate cannot read blocks, naming the row; a readable one does not', () => {
  const invented = 'The free plan allows 100 requests per minute';
  for (const marker of [`[quote: ${invented}`, `[Quote : ${invented}]`, `[quote ${invented}]`]) {
    const judged = quoted(`Free tier limits. ${marker}`);
    const blocked = judged.find((f) => f.rule === 'quote-unreadable');
    assert.equal(blocked?.severity, 'fail', `${marker}: ${JSON.stringify(judged)}`);
    assert.match(blocked.detail, /^E-01 holds a quote marker the gate cannot read/);
  }
  const real = quoted('Free tier limits. [quote: The free plan allows 10 requests per minute]');
  assert.equal(real.find((f) => f.rule === 'quote-unreadable'), undefined, JSON.stringify(real));
  // Two levels of brackets are read since ADR-0162, so this one is checked, and not found.
  const nested = quoted('Free tier limits. [quote: calls[a[0]].id is read on billing]');
  assert.equal(nested.find((f) => f.rule === 'quote-unreadable'), undefined, JSON.stringify(nested));
  assert.equal(nested.find((f) => f.rule === 'quote-not-found')?.severity, 'fail', JSON.stringify(nested));
});

// Found 2026-10-02 (C1, the firecrawl-cli-1-25 decision project): a quote of a package
// manifest's dependency map - 130 characters, one whitespace-separated "word" - was warned
// "under 3 words anchors almost nothing". It anchors one exact line of one file. Words were
// a proxy for length, and the warning's reason was false for a long token (ADR-0126).
function quotedToken(token, finding) {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0].file;
  corrupt(dir, capture, (t) => `${t}\n${token}\n`);
  corrupt(dir, PATHS.evidence, (t) => t.replace(
    '| The free plan allows 10 requests per minute and includes 1,000 credits. |', `| ${finding} |`));
  return runCheck('citations', readCorpus(dir));
}

test('a long quote of few words is specific: the short-quote warning is about length, words were its proxy', () => {
  const manifest = '"dependencies":{"yaml":"^2.9.0","commander":"^14.0.2","firecrawl":"4.40.0"}';
  const judged = quotedToken(manifest, `Pinned deps. [quote: ${manifest}]`);
  assert.deepEqual(judged.filter((f) => f.rule === 'quote-too-short' || f.rule === 'quote-not-found').map((f) => f.detail), [],
    'a quote of one 75-character token, found word for word, was warned as anchoring almost nothing');
  assert.ok(judged.some((f) => /1 quote/.test(f.detail)), 'it is counted as an anchored quote');

  // The floor is on short AND few, and a token one character under it still warns. The length
  // is the compared text's (ADR-0191), so the pin is on the predicate, not on a raw count.
  const under = 'x'.repeat(MIN_QUOTE_CHARS - 1);
  assert.equal(quoteTooShort(quoteAnchors(`[quote: ${under}]`)[0]), true);
  assert.equal(quoteTooShort(quoteAnchors(`[quote: ${'x'.repeat(MIN_QUOTE_CHARS)}]`)[0]), false);
  assert.equal(quotedToken(under, `Short. [quote: ${under}]`).find((f) => f.rule === 'quote-too-short')?.severity, 'warn',
    'one character under the floor, one word: still almost nothing');
  const at = 'y'.repeat(MIN_QUOTE_CHARS);
  assert.equal(quotedToken(at, `Long. [quote: ${at}]`).find((f) => f.rule === 'quote-too-short'), undefined,
    'at the floor, one word: specific enough');
});

// The same finding, for a corpus collected before error pages were refused: a row that
// cites one is flagged, not blocked - some corpora cite a 404 on purpose, as the record of
// an attempted lookup.
test('a row citing an error-status capture is flagged', async () => {
  const dir = makePassingProject();
  corrupt(dir, (await import('../lib/corpus.mjs')).readCorpus(dir).captures.entries[0].file, (t) => t.replace('statusCode: 200', 'statusCode: 404'));
  const { rebuildLedger } = await import('../lib/provenance.mjs');
  rebuildLedger?.(dir);
  const findings = runCheck('citations', readCorpus(dir));
  assert.equal(findings.find((f) => f.rule === 'raw-error-status')?.severity, 'warn', JSON.stringify(findings));

  // A row that says the page failed, naming the status, has acknowledged it: this
  // repository's E-15 keeps a 404 on purpose as the record of a failed guess.
  corrupt(dir, PATHS.evidence, (t) => t.replace('| The free plan allows', '| The guessed URL answered HTTP 404; kept as the record of a failed lookup. The free plan allows'));
  assert.equal(runCheck('citations', readCorpus(dir)).find((f) => f.rule === 'raw-error-status'), undefined);
});

// Found 2026-10-01 by a cold end-to-end trial: an agent wrote
// `[quote: "The primary rate limit for unauthenticated requests is 60 requests per hour."]` -
// the sentence word for word, in quotation marks, as one writes a quotation - and the gate said
// quote-not-found. The agent concluded quotes were too strict and removed every one, leaving
// claims the gate could no longer check. Quotation marks around the whole passage are how it
// was written down, not part of it.
test('quotation marks around the whole passage are not part of the quote', () => {
  const body = 'The primary rate limit for unauthenticated requests is 60 requests per hour. Authenticated: 5,000.';
  for (const marker of [
    '[quote: "The primary rate limit for unauthenticated requests is 60 requests per hour."]',
    '[quote: “The primary rate limit for unauthenticated requests is 60 requests per hour.”]',
    "[quote: 'The primary rate limit for unauthenticated requests is 60 requests per hour.']",
    '[quote: «The primary rate limit for unauthenticated requests is 60 requests per hour.»]',
  ]) {
    const [anchor] = quoteAnchors(marker);
    assert.ok(anchorFound(anchor.fragments, body), `not found once wrapped: ${marker}`);
  }
  // Only a wrapping pair: quotation marks inside the passage are the capture's, and still checked.
  const [inner] = quoteAnchors('[quote: the "primary" rate limit for unauthenticated requests]');
  assert.equal(anchorFound(inner.fragments, body), false, 'quotation marks the capture does not have were ignored');
  // And a passage the capture does not hold is still refused, quoted or not.
  const [invented] = quoteAnchors('[quote: "The primary rate limit for unauthenticated requests is 600 requests per hour."]');
  assert.equal(anchorFound(invented.fragments, body), false, 'an invented quote was accepted');
});

// Found 2026-10-01 (break-test), on this repository's own corpus rather than on a hypothesis:
// 32 of its 188 captures hold 558 zero-width spaces between them, and one heading in
// research/raw/2026-09-13-extend-claude-with-skills-claude-code-docs-*.md reads
// `## [<U+200B>](https://code.claude.com/docs/en/skills#bundled-skills)  Bundled skills`, so
// `[quote: ## Bundled skills]` - the heading the page displays - was quote-not-found. A soft
// hyphen left by a PDF extractor and a word joiner do the same. This is the unwrap above one
// character class wider: what a page's own tooling inserts, and nobody can see.
test('invisible formatting characters are not part of the passage either', async () => {
  const heading = '## [\u200B](https://x.invalid/docs#bundled-skills)  Bundled skills';
  assert.equal(anchorFound(['## Bundled skills'], heading), true, 'the zero-width space inside a heading anchor');

  const sentence = 'The free plan allows 10 requests per minute.';
  for (const [name, mark] of [['a soft hyphen', '\u00AD'], ['a zero-width space', '\u200B'],
    ['a word joiner', '\u2060'], ['a zero-width non-joiner', '\u200C']]) {
    // Both directions: a converter leaves them in the CAPTURE, a copy-paste puts them in the QUOTE.
    assert.equal(anchorFound(['The free plan allows 10 requests'], sentence.replace('free', `free${mark}`)), true, `${name} in the capture`);
    assert.equal(anchorFound([`The free${mark} plan allows 10 requests`], sentence), true, `${name} in the quote`);
  }

  // Nothing looser. Dropping what nobody can see shortens both sides alike, so an invented
  // passage is still invented - the property the unwrap fix is argued on.
  assert.equal(anchorFound(['the second plan allows 10 requests'], sentence), false, 'an invented word is not drift');
  assert.equal(anchorFound(['The free plan allows 100 requests'], sentence), false, 'an invented number is not drift');
  assert.equal(normalizeForMatch('a\u200Bb'), normalizeForMatch('ab'), 'the class is dropped, not merely matched');

  // And end to end, through the check the gate runs: the capture holds the character, the
  // Finding cell quotes the sentence the way a person would type it.
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0].file;
  corrupt(dir, capture, (t) => t.replace('The free plan allows', 'The free\u200B plan allows'));
  const { rebuildLedger } = await import('../lib/provenance.mjs');
  rebuildLedger?.(dir);
  const judged = quoted('Free tier limits. [quote: The free plan allows 10 requests per minute]');
  assert.deepEqual(judged.filter((f) => f.rule === 'quote-not-found').map((f) => f.detail), [],
    'a passage the capture holds word for word was refused over a character nobody can see');
});

test('a quote with no normalized text cannot be found', () => {
  const sentence = 'The free plan allows 10 requests per minute.';
  for (const [name, raw] of [
    ['emphasis only', '*'.repeat(40)],
    ['invisible format only', '\u200B'.repeat(40)],
    ['three raw formatting words', '**** **** ****'],
    ['empty Markdown label', `[](https://x.invalid/${'q'.repeat(40)})`],
  ]) {
    const [anchor] = quoteAnchors(`[quote: ${raw}]`);
    assert.ok(anchor, name);
    assert.equal(normalizeForMatch(anchor.quote), '', name);
    assert.equal(anchorFound(anchor.fragments, sentence), false, `${name} was reported as found without matching text`);
    assert.equal(anchorFound(anchor.fragments, ''), false, `${name} was found in an empty body`);
  }
  assert.equal(anchorFound([], sentence), false, 'an empty fragment list proves no occurrence');
  assert.equal(anchorFound(['***', 'The free plan', '\u200B', 'allows 10 requests'], sentence), true,
    'formatting-only fragments alongside actual quoted text are still ignored');
  assert.equal(anchorFound(['allows 10 requests', '***', 'The free plan'], sentence), false,
    'the remaining nonempty fragments must occur in order');
  assert.equal(anchorFound(['***', 'The free plan allows 100 requests'], sentence), false,
    'an invented visible number remains unfound');
});

test('citations refuse a formatting-only quote that clears a raw length or word floor', () => {
  for (const [name, raw] of [
    ['forty emphasis characters', '*'.repeat(40)],
    ['forty invisible format characters', '\u200B'.repeat(40)],
    ['three raw formatting words', '**** **** ****'],
    ['long empty Markdown label', `[](https://x.invalid/${'q'.repeat(40)})`],
  ]) {
    const judged = quoted(`No literal passage. [quote: ${raw}]`);
    assert.equal(judged.find((f) => f.rule === 'quote-not-found')?.severity, 'fail', `${name}: ${JSON.stringify(judged)}`);
    assert.equal(judged.find((f) => f.rule === 'quote-too-short'), undefined,
      `${name}: the raw floors are unchanged`);
    assert.ok(!judged.some((f) => f.severity === 'pass' && /quote.*found/.test(f.detail)),
      `${name}: the PASS message must not claim a quote was found`);
  }
  const short = quoted('Below both raw floors. [quote: ***]');
  assert.equal(short.find((f) => f.rule === 'quote-too-short')?.severity, 'warn');
  assert.equal(short.find((f) => f.rule === 'quote-not-found'), undefined,
    'the existing short-quote warning still stops the matching path');
  const token = 'x'.repeat(40);
  assert.deepEqual(quotedToken(token, `Real token at the raw floor. [quote: ${token}]`)
    .filter((f) => f.rule === 'quote-too-short' || f.rule === 'quote-not-found'), [],
    'a found forty-character token keeps its existing exemption');
});

// Rank 4 of the 2026-10-03 gap audit (restated as rank 4 of the 2026-10-04 gap audit): the
// marker regex read ONE level of brackets, so a passage holding a Markdown link whose own text
// held brackets was not read as a marker at all - and a quote the gate cannot read is a quote it
// does not check. A scanner that counts brackets has no depth limit.
test('a quote may hold brackets more than one level deep, and is actually checked', () => {
  const deep = 'see [the docs](https://x.invalid/a) and [the list [1]] here';
  assert.deepEqual(quoteAnchors(`[quote: ${deep}]`).map((q) => q.quote), [deep]);
  assert.equal(anchorFound(quoteAnchors(`[quote: ${deep}]`)[0].fragments, `We ${deep} today.`), true);
  assert.deepEqual(quoteAnchors('[quote: a [b [c] d] e] and [quote: x]').map((q) => q.quote), ['a [b [c] d] e', 'x']);
});

// Rank 4: a quote's "fragments may be arbitrarily far apart", so `[quote: free ... requests ...
// credits]` anchored three scattered words and passed as verified. An ellipsis stands for text
// left out of ONE passage, not for a jump across the page.
test('an ellipsis does not bridge a page: the fragments must lie in one passage', () => {
  const page = `The free plan allows 10 requests. ${'x'.repeat(4000)} A note about credits.`;
  assert.equal(anchorFound(quoteAnchors('[quote: The free plan ... A note about credits]')[0].fragments, page), false,
    'an ellipsis bridged 4000 characters');
  const passage = 'The free plan allows 10 requests per minute, and the paid plan grants credits.';
  assert.equal(anchorFound(quoteAnchors('[quote: The free plan allows ... grants credits]')[0].fragments, passage), true,
    'fragments within one passage still anchor');
  // A word earlier in the page, out of context, must not hide the passage the quote meant.
  const twice = `The free plan starts at $0. ${'y'.repeat(1000)} The free plan grants credits.`;
  assert.equal(anchorFound(quoteAnchors('[quote: The free plan ... grants credits]')[0].fragments, twice), true,
    'the placement is searched, not the first occurrence only');
});

// Rank 4: the length floor was measured over the JOINED fragments, so three one-word fragments
// read as three "words" and cleared a floor none of them reaches alone. Measured per fragment,
// only a quote whose every fragment is weak is short.
test('the short-quote floor is measured over each fragment, not the joined text', () => {
  const scattered = quoted('Pricing tiers. [quote: free ... requests ... credits]');
  assert.equal(scattered.find((f) => f.rule === 'quote-too-short')?.severity, 'warn', JSON.stringify(scattered));
  const mixed = quoted('Pricing tiers. [quote: free ... includes 1,000 credits]');
  assert.equal(mixed.find((f) => f.rule === 'quote-too-short'), undefined, JSON.stringify(mixed));
  assert.equal(mixed.find((f) => f.rule === 'quote-not-found'), undefined, JSON.stringify(mixed));
});

// Review of the 2026-10-19 sweep: Japanese and Chinese put no space between their words, so
// under the per-fragment floor each fragment of an elided quote was one "word" under 40
// characters. Two full sentences joined by an ellipsis warned quote-too-short and were never
// compared with the capture, so an invented figure in them passed. A character of such a
// script weighs a third of a word, as in similarity.mjs (ADR-0176).
test('an elided quote in a script without word spaces is checked, and a short one still warns', () => {
  const page = '無料プランでは一分あたり六十回までリクエストできます。上限を超えるとサービスはエラー429を返します。';
  const real = '[quote: 無料プランでは一分あたり六十回までリクエストできます ... 上限を超えるとサービスはエラー429を返します]';
  const rules = (judged) => judged.filter((f) => f.rule === 'quote-too-short' || f.rule === 'quote-not-found');
  assert.deepEqual(rules(quotedToken(page, `Rate limit. ${real}`)), [], 'two real sentences, elided, are a quote found');
  const invented = quotedToken(page, `Rate limit. ${real.replace('六十', '六百')}`);
  assert.equal(invented.find((f) => f.rule === 'quote-too-short'), undefined, JSON.stringify(invented));
  assert.equal(invented.find((f) => f.rule === 'quote-not-found')?.severity, 'fail', JSON.stringify(invented));

  const short = quotedToken(page, 'Rate limit. [quote: 無料プラン ... エラー429]');
  assert.equal(short.find((f) => f.rule === 'quote-too-short')?.severity, 'warn', JSON.stringify(short));
  // Nine characters are three words; eight are not. A Thai consonant keeps its marks.
  assert.equal(quoteTooShort(quoteAnchors('[quote: 一分あたり六十回ま ... 上限]')[0]), false);
  assert.equal(quoteTooShort(quoteAnchors('[quote: 一分あたり六十回 ... 上限]')[0]), true);
  assert.equal(quoteTooShort(quoteAnchors('[quote: Vim は、このチュー]')[0]), false, 'one word and seven characters are a mix');
  assert.equal(quoteTooShort(quoteAnchors('[quote: ที่นี่ที่นี่]')[0]), true, 'four letters with their marks are four characters, not twelve code points');
  // A quote in no such script weighs what it did: two words stay short, three do not.
  assert.equal(quoteTooShort(quoteAnchors('[quote: free plan]')[0]), true);
  assert.equal(quoteTooShort(quoteAnchors('[quote: the free plan]')[0]), false);
});

// Second review of the 2026-10-19 sweep, F1: the weight above made a spaced Chinese or Japanese
// fragment lighter than its spaces said. `每月 20 美元` is three whitespace words, so it was
// checked; weighed, it is one word and four characters, under the floor, so it warned
// quote-too-short and was never compared with the capture - an altered figure passed with a
// warning. A fragment is short only when it is short by both counts.
test('a spaced fragment of three words in a script without word spaces is still checked', () => {
  for (const quote of ['每月 20 美元', '月額 1,980 円', 'API 料金 limits']) {
    assert.equal(quoteTooShort(quoteAnchors(`[quote: ${quote}]`)[0]), false, `${quote}: three words on spaces are not short`);
  }
  assert.equal(quoteTooShort(quoteAnchors('[quote: 每月 美元]')[0]), true, 'short by both counts stays short');

  const page = '专业版每月 20 美元，包含 10,000 次请求。';
  const rules = (judged) => judged.filter((f) => f.rule === 'quote-too-short' || f.rule === 'quote-not-found');
  assert.deepEqual(rules(quotedToken(page, 'Pro price. [quote: 每月 20 美元]')), [], 'the real figure is a quote found');
  const altered = quotedToken(page, 'Pro price. [quote: 每月 25 美元]');
  assert.equal(altered.find((f) => f.rule === 'quote-too-short'), undefined, JSON.stringify(altered));
  assert.equal(altered.find((f) => f.rule === 'quote-not-found')?.severity, 'fail', JSON.stringify(altered));
});

// ADR-0191 (2026-10-25, plan section 5.1): the floor was measured on the RAW fragment, while
// anchorFound compares the normalized one. `[Free plan](https://...#free-plan-details)` is 65 raw
// characters, so it was not short, and it anchored `free plan`, which occurs on every pricing
// page; zero-width spaces padded `**Free** plan` past the floor the same way, and so did a
// formatting-only fragment beside a two-word one. The floor now reads the text the matcher reads.
test('the short-quote floor is measured on the compared text, not the raw marker', () => {
  const link = '[Free plan](https://vendor.example.com/pricing#free-plan-details)';
  const padded = `**Free**${'\u200B'.repeat(35)} plan`;
  for (const [name, quote] of [
    ['a Markdown link whose URL is long', link],
    ['emphasis padded with zero-width spaces', padded],
    ['a formatting-only fragment beside two words', `${'*'.repeat(40)} ... free plan`],
    ['an invisible fragment beside two words', `${'\u200B'.repeat(40)} ... free plan`],
    ['plain two words', 'Free plan'],
  ]) {
    assert.ok(quote.length >= MIN_QUOTE_CHARS || name === 'plain two words', `${name}: the case clears the raw floor`);
    assert.equal(quoteTooShort(quoteAnchors(`[quote: ${quote}]`)[0]), true, `${name}: anchors only "free plan"`);
    const judged = quoted(`Free tier. [quote: ${quote}]`);
    assert.equal(judged.find((f) => f.rule === 'quote-too-short')?.severity, 'warn', `${name}: ${JSON.stringify(judged)}`);
    assert.equal(judged.find((f) => f.rule === 'quote-not-found'), undefined, `${name}: found in the capture, so a warning only`);
  }
  // A raw length made of characters the comparison drops does not count either.
  assert.equal(quoteTooShort(quoteAnchors(`[quote: ${'x'.repeat(MIN_QUOTE_CHARS - 1)}__]`)[0]), true);

  // ADR-0126's case keeps its exemption: a long token of one word is as specific as a sentence.
  const manifest = `"dependencies":{"yaml":"^2.9.0","commander":"^14.0.20","firecrawl":"^4.40.0","undici":"^7.16.0","semver":"^7.7.3","zod":"^4.1.12"}`;
  assert.equal(manifest.length, 130);
  assert.equal(quoteTooShort(quoteAnchors(`[quote: ${manifest}]`)[0]), false);
  assert.deepEqual(quotedToken(manifest, `Pinned deps. [quote: ${manifest}]`)
    .filter((f) => f.rule === 'quote-too-short' || f.rule === 'quote-not-found'), [], 'the 130-character token is checked and found');
});

// ADR-0191's one branch: an anchor with NO compared text is measured raw, exactly as before it,
// so the four long formatting-only quotes (2026-10-08) keep their quote-not-found failure with no
// warning beside it, and `***` keeps its warning: their result does not move at all (D-d).
test('a quote with no compared text keeps the raw measure, so its result does not move', () => {
  for (const [raw, short] of [
    ['*'.repeat(40), false],
    ['\u200B'.repeat(40), false],
    ['**** **** ****', false],
    [`[](https://x.invalid/${'q'.repeat(40)})`, false],
    ['***', true],
    ['\u200B\u200B', true],
    ['** ... __', true],
  ]) {
    const [anchor] = quoteAnchors(`[quote: ${raw}]`);
    assert.equal(anchor.fragments.map(normalizeForMatch).join(''), '', `${JSON.stringify(raw)} has no compared text`);
    assert.equal(quoteTooShort(anchor), short, `${JSON.stringify(raw)}: short only as it was on raw text`);
  }
});

/** The whole gate (every check, through runPreflight) on the passing project with one Finding replaced. */
function gated(finding) {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (t) => t.replace(
    '| The free plan allows 10 requests per minute and includes 1,000 credits. |', `| ${finding} |`));
  const verdict = runPreflight(dir, { env: {} });
  const quoteRules = verdict.findings.filter((f) => f.rule === 'quote-too-short' || f.rule === 'quote-not-found')
    .map((f) => `${f.severity} ${f.rule}`).sort();
  return { pass: verdict.pass, quoteRules, failures: verdict.failures.map((f) => f.rule) };
}

// Review of ADR-0191 (2026-10-25, U1 review F1; run decision D-l): the floor moved to the compared
// text, but the check still stopped at the short warning, so a quote long on its raw fragments
// and short on the compared ones was no longer compared at all. `[Enterprise plan](https://...)`
// with no "enterprise plan" in the capture failed quote-not-found before ADR-0191 and passed the
// gate with a warning after it: a gate failure removed by a change classed as a bug fix in the
// strict direction. Such a quote now warns AND is compared. Only a quote that was short on its
// raw fragments too - short before ADR-0191 - is left uncompared, as ADR-0087 always did.
test('a quote short only on its compared text still warns and is still compared: an invented one fails the gate', () => {
  for (const [name, quote] of [
    ['a Markdown link whose URL is long', '[Enterprise plan](https://vendor.example.com/pricing#enterprise-plan-details)'],
    ['emphasis padded with zero-width spaces', `**Enterprise**${'​'.repeat(35)} plan`],
    ['a formatting-only fragment beside two words', `${'*'.repeat(40)} ... enterprise plan`],
  ]) {
    assert.ok(quote.length >= MIN_QUOTE_CHARS, `${name}: the case clears the raw floor, so it was compared before ADR-0191`);
    assert.equal(quoteTooShort(quoteAnchors(`[quote: ${quote}]`)[0]), true, `${name}: short on the compared text`);
    const invented = gated(`Enterprise tier exists. [quote: ${quote}]`);
    assert.deepEqual(invented.quoteRules, ['fail quote-not-found', 'warn quote-too-short'], `${name}: ${JSON.stringify(invented)}`);
    assert.equal(invented.pass, false, `${name}: the invented quote blocks the gate, as it did before ADR-0191`);
    assert.deepEqual(invented.failures, ['quote-not-found'], `${name}: and nothing else does`);

    const real = gated(`Free tier exists. [quote: ${quote.replace('Enterprise', 'Free').replace('enterprise', 'free')}]`);
    assert.deepEqual(real.quoteRules, ['warn quote-too-short'], `${name}, found in the capture: ${JSON.stringify(real)}`);
    assert.equal(real.pass, true, `${name}, found in the capture: a warning only`);
  }
  // Short on the raw text as well: ADR-0087's behaviour, unchanged - warned, never compared.
  const plain = gated('Enterprise tier exists. [quote: enterprise plan]');
  assert.deepEqual(plain.quoteRules, ['warn quote-too-short'], JSON.stringify(plain));
  assert.equal(plain.pass, true, 'a quote short on its raw text is still not compared');
});

// U1 review F3 (2026-10-25): the compared text is not always the shorter one. NFKC and case
// folding can lengthen a fragment - `㍿` is one character and folds to `株式会社` - so a quote
// that was short on its raw text (and so warned and was never compared) is not short on the
// compared text, and is now compared: an invented one fails. The strict direction, on contrived
// input; no quote in the 44 committed corpora moves this way.
test('a quote short on its raw text but long once folded is compared, and fails when invented', () => {
  const quote = '㍿㍿㍿';
  assert.ok(quote.length < MIN_QUOTE_CHARS && !/\s/.test(quote), 'one raw word of three characters: short before ADR-0191');
  assert.equal(normalizeForMatch(quote), '株式会社株式会社株式会社');
  assert.equal(quoteTooShort(quoteAnchors(`[quote: ${quote}]`)[0]), false, 'twelve Han characters are four words by weight');
  const invented = gated(`Company form. [quote: ${quote}]`);
  assert.deepEqual(invented.quoteRules, ['fail quote-not-found'], JSON.stringify(invented));
  assert.equal(invented.pass, false);
});

// The pre-mortem of ADR-0191: NFKC folds full-width forms and the half-width katakana before the
// weight is taken. A full-width figure is not a character of an unspaced script on either side,
// so the CJK verdicts of ADR-0176 and F1 hold when the figure is written full-width.
test('full-width forms fold without moving a script-without-spaces verdict', () => {
  assert.equal(quoteTooShort(quoteAnchors('[quote: 月額 １，９８０ 円]')[0]), false, 'three words on spaces, as `月額 1,980 円`');
  assert.equal(quoteTooShort(quoteAnchors('[quote: 月額１，９８０円]')[0]), true, 'one figure and three characters, as `月額1,980円`');
  assert.equal(quoteTooShort(quoteAnchors('[quote: 一分あたり六十回ま ... 上限]')[0]), false);
  assert.equal(quoteTooShort(quoteAnchors('[quote: 一分あたり六十回 ... 上限]')[0]), true);
});

// ADR-0192 (2026-10-25, plan section 5.3): the two transports space punctuation beside an inline
// tag differently. The keyless converter writes a space on both sides of every tag it strips
// (`<span>`, `<sup>`, a Sphinx code token), so a mark right after one is spaced; Firecrawl writes
// none before a closing mark, and one after `(` or `[` when a link or emphasis follows. A quote
// copied from one transport's capture was quote-not-found against the other's capture of the
// same page. Each case below is a short synthetic string in the shape the research measured
// (docs/decisions/2026-10-25-punctuation-spacing, E-01/E-02 keyless against E-08/E-09
// Firecrawl), with only the one mark's spacing differing. Guard: the mark is in the rule's set
// in `normalizeForMatch`; take it out of the set and its case is not found.
const SPACED_MARKS = [
  // [mark, keyless shape, Firecrawl shape, where the shape was measured]
  ['.', 'archived on 3 May 2024 . Retrieved 9 June 2024 .', 'archived on 3 May 2024. Retrieved 9 June 2024.', 'E-02/E-09 citation dates'],
  [',', 'as in *alpha* , *beta* and gamma', 'as in _alpha_, _beta_ and gamma', 'E-02/E-09 primo, secondo'],
  [';', 'as in *alpha* ; it is similar', 'as in _alpha_; it is similar', 'E-02/E-09 primo, secondo'],
  [':', "if key == 'x' : return none", "if key == 'x': return none", "E-01/E-08 == '-' :"],
  ['!', 'the field {value !r} is shown', 'the field {value!r} is shown', 'E-01/E-08 value !r'],
  ['?', 'the lazy form ` a+ ? ` matches less', 'the lazy form `a+?` matches less', 'E-01/E-08 a Sphinx code span keeps its spaces'],
  ['%', 'a rise of 50 % in one year', 'a rise of 50% in one year', 'E-02/E-09 a no-break-space span Firecrawl drops'],
  [')', '(for example *a rise* ), but often', '(for example _a rise_), but often', 'E-02/E-09 50 %* ),'],
  [']', 'the [optional *pos* ] argument', 'the [optional _pos_] argument', 'E-01/E-08 a signature built of em and span'],
  ['}', 'on line {lineno } of the file', 'on line {lineno} of the file', 'E-01/E-08 { line_num }'],
  ['(', 'spoken in the north ([Sonora](../s) and the coast)', 'spoken in the north ( [Sonora](https://x.invalid/s) and the coast)', 'E-01/E-09 Firecrawl spaces ( before a link'],
  ['[', 'the optional [ *pos*] argument', 'the optional [_pos_] argument', 'E-01 [ , * pos'],
  ['{', 'formatted as { value} in the log', 'formatted as {value} in the log', 'E-01/E-08 { value !r}'],
];

for (const [mark, keyless, firecrawl, measured] of SPACED_MARKS) {
  test(`ADR-0192: a quote matches across the transports' spacing at \`${mark}\` (${measured})`, () => {
    assert.notEqual(keyless, firecrawl, 'the two shapes differ in the raw text');
    assert.equal(anchorFound([keyless], `Before it. ${firecrawl} After it.`), true,
      `keyless spacing in the quote, Firecrawl spacing in the capture, at ${mark}`);
    assert.equal(anchorFound([firecrawl], `Before it. ${keyless} After it.`), true,
      `Firecrawl spacing in the quote, keyless spacing in the capture, at ${mark}`);
    assert.equal(normalizeForMatch(keyless), normalizeForMatch(firecrawl), `one compared text at ${mark}`);
  });
}

// The plan's own pins (section 5.3): the rule removes whitespace only BEFORE a closing mark and
// only AFTER an opening one, never after a closing mark, so a space after a point or a comma
// still separates two numbers. Guard: no space after a closing mark is removed; add that
// removal to the rule and the two pairs with a space after the mark merge (`1.5` with `1. 5`,
// `1,5` with `1, 5`). The other two (`15` with `1,5`, `1000` with `1,000`) hold no space at all:
// they pin that the rule removes no character but whitespace - the comma deletion of ADR-0192's
// rejected alternatives would merge both (U9 review F6, 2026-10-25).
test("ADR-0192: the spacing rule never joins two numbers - the plan's four pins stay distinct", () => {
  for (const [a, b] of [
    ['the disk holds 1.5 GB of logs', 'the disk holds 1. 5 GB of logs'],
    ['a fee of 15 units per call', 'a fee of 1,5 units per call'],
    ['up to 1000 requests per day', 'up to 1,000 requests per day'],
    ['a fee of 1,5 units per call', 'a fee of 1, 5 units per call'],
  ]) {
    assert.notEqual(normalizeForMatch(a), normalizeForMatch(b), `${a} | ${b}`);
    assert.equal(anchorFound([a], `x ${b} y`), false, `${a} is not found in ${b}`);
    assert.equal(anchorFound([b], `x ${a} y`), false, `${b} is not found in ${a}`);
  }
  // The plan's case: the Firecrawl-shaped and the keyless-shaped capture of one page both
  // match the one quote, and its figure keeps its comma.
  const quote = 'The free tier allows 1,000 requests. Paid plans start at $5 a month.';
  assert.equal(anchorFound([quote], 'Pricing. The free tier allows **1,000** requests. Paid plans start at $5 a month. More.'), true, 'Firecrawl shape');
  assert.equal(anchorFound([quote], 'Pricing. The free tier allows 1,000 requests . Paid plans start at $5 a month . More.'), true, 'keyless shape');
  assert.equal(anchorFound([quote], 'Pricing. The free tier allows 1000 requests . Paid plans start at $5 a month . More.'), false, 'not 1000');
});

// The merges the rule accepts. A space BEFORE a closing mark goes, so a mark that starts a token
// joins the word before it. Across the repository's 430 captures no number is written
// `<digit> .<digit>` or `<digit> ,<digit>`; `.claude` paths are the common case (ADR-0192;
// research Decision, "Where the rule would merge text it should not"). Pinned so that narrowing
// the rule is a decision, not an accident. Guard: the removal of whitespace before a closing mark.
test('ADR-0192 KNOWN MERGE: 1 .5 = 1.5, 1 ,5 = 1,5 and at .claude = at.claude', () => {
  for (const [a, b] of [
    ['a ratio of 1 .5 units', 'a ratio of 1.5 units'],
    ['a ratio of 1 ,5 units', 'a ratio of 1,5 units'],
    ['the skills live at .claude/skills now', 'the skills live at.claude/skills now'],
  ]) {
    assert.equal(normalizeForMatch(a), normalizeForMatch(b), `KNOWN MERGE: ${a} | ${b}`);
    assert.equal(anchorFound([b], `x ${a} y`), true, `KNOWN MERGE: ${b} is found in ${a}`);
  }
});

// What the rule must NOT rescue (ADR-0192; research Decision, "What the rule does NOT cover"):
// quote marks are outside the set; the keyless converter's space AFTER `.` in tokenized code
// stays; the space BEFORE `(` stays; whitespace Firecrawl drops where there is no mark stays.
// Each would be a separate, deliberate widening. Guards, one per pair: `'` is in neither set (the
// two gloss pairs each differ on one side of a quote mark only, so each fails if `'` joins the
// closing or the opening set; the measured f-string shape also differs where no rule reaches);
// no space after a closing mark is removed; `(` is only an opening mark; only whitespace beside
// a mark of the set is removed.
test('ADR-0192: the spacing rule does not rescue quote marks, `re . escape`, `search (` or dropped whitespace', () => {
  for (const [keyless, firecrawl, why] of [
    ["a gloss ('an increase ') here", "a gloss ('an increase') here", 'a space before a closing straight quote'],
    ["a gloss (' an increase') here", "a gloss ('an increase') here", 'a space after an opening straight quote'],
    ["raise error ( f ' {value} ' ) here", "raise error(f'{value}') here", 'straight quotes in a tokenized f-string'],
    ['then calls re . escape on the chars', 'then calls re.escape on the chars', 'the space after . in tokenized code'],
    ['returns pattern.search (string) first', 'returns pattern.search(string) first', 'the space before ('],
    ['U+00B6 ¶ PILCROW SIGN is', 'U+00B6¶PILCROW SIGN is', 'whitespace Firecrawl drops beside no mark'],
  ]) {
    assert.equal(anchorFound([keyless], `x ${firecrawl} y`), false, `${why}: not found`);
    assert.equal(anchorFound([firecrawl], `x ${keyless} y`), false, `${why}: not found, reverse`);
  }
});

// The gate's view of plan section 7.5 case 12 ("Firecrawl to keyless, the quote lost only to
// spacing"): a quote copied from a Firecrawl capture is checked against a keyless capture of
// the same page, and the reverse. Before ADR-0192 it was quote-not-found, a failure under every
// policy; now it is found. Guard: the spacing rule in `normalizeForMatch`.
test('ADR-0192: the citations check finds a quote whose capture came through the other transport', () => {
  const firecrawl = 'Retrieved 16 May 2024. The limit is 50% of the quota (per key), as in _alpha_, _beta_; see {value!r}.';
  const keyless = 'Retrieved 16 May 2024 . The limit is 50 % of the quota ( per key ) , as in *alpha* , *beta* ; see {value !r} .';
  for (const [capture, quote, name] of [
    [keyless, firecrawl, 'Firecrawl quote, keyless capture'],
    [firecrawl, keyless, 'keyless quote, Firecrawl capture'],
  ]) {
    const judged = quotedToken(capture, `Quota rule. [quote: ${quote}]`);
    assert.equal(judged.find((f) => f.rule === 'quote-not-found'), undefined, `${name}: ${JSON.stringify(judged)}`);
    assert.ok(judged.some((f) => f.severity === 'pass' && /1 quote/.test(f.detail)), `${name}: counted as found`);
  }
});

// The floor reads the ruled text (ADR-0192 decision 1, ADR-0191). `quoteTooShort` measures
// `normalizeForMatch(f)`, the text `anchorFound` looks for, so the spacing rule moves the floor:
// `free ( plan )` is four words on spaces before the rule and `free (plan)`, two words and 11
// characters, after it. A real quote of that shape newly warns quote-too-short, and ADR-0195's
// quote coverage stops counting it as usable; it is still compared, because its raw text clears
// the floor. One word more, `free (plan) tier`, is three words and not short. Found by the U9
// review (2026-10-25, F7): with the floor counted on the pre-rule text, every quotes test still
// passed. Guard: `quoteTooShort` counts on the same normalized text as `anchorFound`; count it on
// the text before the spacing rule and `free ( plan )` is not short, so this test fails.
test('ADR-0192: the short-quote floor counts the text after the spacing rule', () => {
  assert.equal(normalizeForMatch('free ( plan )'), 'free (plan)');
  assert.equal(quoteTooShort(quoteAnchors('[quote: free ( plan )]')[0]), true, 'two words of the compared text');
  assert.equal(quoteTooShort(quoteAnchors('[quote: free ( plan ) tier]')[0]), false, 'three words of the compared text');

  const short = quotedToken('The free ( plan ) includes support.', 'Plan name. [quote: free ( plan )]');
  assert.deepEqual(short.filter((f) => f.rule === 'quote-too-short' || f.rule === 'quote-not-found').map((f) => `${f.severity} ${f.rule}`),
    ['warn quote-too-short'], `short on the compared text, long on the raw text: warned, and found: ${JSON.stringify(short)}`);
  const invented = quotedToken('The free ( plan ) includes support.', 'Plan name. [quote: paid ( plan )]');
  assert.deepEqual(invented.filter((f) => f.rule === 'quote-too-short' || f.rule === 'quote-not-found').map((f) => `${f.severity} ${f.rule}`).sort(),
    ['fail quote-not-found', 'warn quote-too-short'], `still compared, so an invented one fails: ${JSON.stringify(invented)}`);
  const long = quotedToken('The free ( plan ) tier includes support.', 'Plan name. [quote: free ( plan ) tier]');
  assert.ok(!long.some((f) => f.severity !== 'pass'), JSON.stringify(long));
});
