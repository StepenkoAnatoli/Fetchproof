// ADR-0087: a claim may carry `[quote: ...]`, and the gate checks the quote is really in the
// row's capture. Research: docs/decisions/2026-09-28-quote-anchors.

import { test, describe, assert, makePassingProject, corrupt } from './harness.mjs';
import { PATHS } from '../lib/core.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { runCheck } from '../lib/checks.mjs';
import { quoteAnchors, normalizeForMatch, anchorFound, quoteChars, MIN_QUOTE_CHARS } from '../lib/quotes.mjs';

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

  // The floor is on short AND few: the helper measures characters across the fragments, and a
  // token one character under the floor still warns.
  const under = 'x'.repeat(MIN_QUOTE_CHARS - 1);
  assert.equal(quoteChars(quoteAnchors(`[quote: ${under}]`)[0]), MIN_QUOTE_CHARS - 1);
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
