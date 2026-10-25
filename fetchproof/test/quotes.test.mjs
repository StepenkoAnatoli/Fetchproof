// ADR-0087: a claim may carry `[quote: ...]`, and the gate checks the quote is really in the
// row's capture. Research: docs/decisions/2026-09-28-quote-anchors.

import { test, describe, assert, makePassingProject, corrupt } from './harness.mjs';
import { PATHS } from '../lib/core.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { runCheck } from '../lib/checks.mjs';
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
  const padded = `**Free**${'​'.repeat(35)} plan`;
  for (const [name, quote] of [
    ['a Markdown link whose URL is long', link],
    ['emphasis padded with zero-width spaces', padded],
    ['a formatting-only fragment beside two words', `${'*'.repeat(40)} ... free plan`],
    ['an invisible fragment beside two words', `${'​'.repeat(40)} ... free plan`],
    ['plain two words', 'Free plan'],
  ]) {
    assert.ok(quote.length >= MIN_QUOTE_CHARS || name === 'plain two words', `${name}: the case clears the raw floor`);
    assert.equal(quoteTooShort(quoteAnchors(`[quote: ${quote}]`)[0]), true, `${name}: anchors only "free plan"`);
    const judged = quoted(`Free tier. [quote: ${quote}]`);
    assert.equal(judged.find((f) => f.rule === 'quote-too-short')?.severity, 'warn', `${name}: ${JSON.stringify(judged)}`);
    assert.equal(judged.find((f) => f.rule === 'quote-not-found'), undefined, `${name}: a warning, never a new failure`);
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

// ADR-0191's one branch: an anchor with NO compared text is measured raw, exactly as before it.
// Measured on compared text it would be short, and the check's `continue` after the warning
// would turn the four long formatting-only quotes' quote-not-found failure (2026-10-08) into a
// warning - the lenient direction, which B1 must not take.
test('a quote with no compared text keeps the raw measure, so its result does not move', () => {
  for (const [raw, short] of [
    ['*'.repeat(40), false],
    ['​'.repeat(40), false],
    ['**** **** ****', false],
    [`[](https://x.invalid/${'q'.repeat(40)})`, false],
    ['***', true],
    ['​​', true],
    ['** ... __', true],
  ]) {
    const [anchor] = quoteAnchors(`[quote: ${raw}]`);
    assert.equal(anchor.fragments.map(normalizeForMatch).join(''), '', `${JSON.stringify(raw)} has no compared text`);
    assert.equal(quoteTooShort(anchor), short, `${JSON.stringify(raw)}: short only as it was on raw text`);
  }
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
