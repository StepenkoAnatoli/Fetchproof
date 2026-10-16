// The extractor is the one module a caller can exercise with a string (ADR-0016).
// Page markdown in, one line of prose out.

import { test, describe, assert , fs, path, KIT_ROOT } from './harness.mjs';
import { firstFinding, findingWithContext, sentences, score, explainScore, RULES, MAX_CHARS, EXCERPT_CHARS } from '../lib/finding.mjs';

describe('finding');

test('it is pure: a string in, a string out, no filesystem and no corpus', () => {
  assert.equal(firstFinding('', 'fallback'), 'fallback');
  assert.equal(firstFinding(null, 'fallback'), 'fallback');
  assert.equal(typeof firstFinding('# Title\n\nA sentence long enough to be a claim about limits.', ''), 'string');
});

test('a concrete sentence beats a vague one', () => {
  const page = `# Plans

We believe in building great software for everyone, everywhere.

The free plan allows 10 scrape requests per minute and includes 1,000 credits per month.
`;
  assert.match(firstFinding(page, 'x'), /10 scrape requests per minute/);
});

test('navigation, cookie banners and campaign copy are never the finding', () => {
  const page = `Home
Docs
Sign in
We use cookies to improve your experience. Accept all.
Trusted by 50,000 developers
Start your free trial - no credit card required

The API returns 429 when the per-minute limit of 10 requests is exceeded.
`;
  const finding = firstFinding(page, 'x');
  assert.match(finding, /429/);
  assert.doesNotMatch(finding, /cookies|free trial|Trusted by/);
});

test('a tracking-laden line is dropped', () => {
  const page = 'Read more at https://x.invalid/a?utm_source=nav&utm_campaign=header for details about things.\n\nRate limits are enforced per team and not per key, at 10 requests per minute.';
  assert.match(firstFinding(page, 'x'), /per team/);
});

test('a pricing table\'s first data row is read as prose', () => {
  const page = `# Pricing

| Plan | Credits | Price |
|---|---|---|
| Free | 1,000 | $0 |
| Hobby | 5,000 | $16 |
`;
  const finding = firstFinding(page, 'x');
  assert.match(finding, /Plan: Free/);
  assert.match(finding, /Credits: 1,000/);
});

test('a bare price fragment from a tier hero block is not a finding', () => {
  const page = '$16\n/month\nHobby\n\nThe Hobby plan includes 5,000 credits per month and 5 concurrent requests.';
  assert.match(firstFinding(page, 'x'), /5,000 credits/);
});

test('fenced code is not prose', () => {
  const page = '```js\nconst limit = 10; // this sentence-like comment is not a claim about anything\n```\n\nThe documented limit is 10 requests per minute on the free plan.';
  const finding = firstFinding(page, 'x');
  assert.match(finding, /documented limit/);
  assert.doesNotMatch(finding, /const limit/);
});

test('an underscore inside an identifier is the identifier, not emphasis', () => {
  // A GitHub changelog, read keyless on 2026-10-02: the drafted finding said
  // "returnrundetails" and "checksuiteid", names no page carries, and a quote copied from
  // the draft would never be found in the capture. One sentence per page, so the finding IS
  // that sentence and not the best of several.
  const first = firstFinding('Now, you can pass in a new optional boolean parameter, `return_run_details`, which will return a `200 OK` response containing the workflow ID.');
  assert.match(first, /return_run_details/, first);
  const filters = firstFinding('This endpoint will return up to 1,000 results for each search when using the parameters `check_suite_id`, `head_sha` and `snake_case_name`.');
  assert.match(filters, /check_suite_id/, filters);
  assert.match(filters, /head_sha/, filters);
  assert.match(filters, /snake_case_name/, filters);
  const emphasis = firstFinding('The limit is _5,000 requests_ per hour with __no exception__ for 3 retries.');
  assert.equal(emphasis, 'The limit is 5,000 requests per hour with no exception for 3 retries.', 'emphasis at a word\'s edge still goes');
});

test('links keep their text and lose their target', () => {
  const page = 'See the [rate limits reference](https://docs.x.invalid/rate-limits) for the per-minute caps of 10 requests.';
  const finding = firstFinding(page, 'x');
  assert.match(finding, /rate limits reference/);
  assert.doesNotMatch(finding, /https:/);
});

test('the output is capped, and the cap does not cut a word in half', () => {
  const long = `A documented limit of 10 requests per minute applies, ${'and there is a great deal more detail after it '.repeat(20)}`;
  const finding = firstFinding(long, 'x');
  assert.ok(finding.length <= MAX_CHARS, `${finding.length} > ${MAX_CHARS}`);
  if (finding.endsWith('…')) {
    // It breaks on a space, so the last word it kept is a whole word from the page.
    const lastWord = finding.slice(0, -1).trim().split(/\s+/).pop();
    assert.match(long, new RegExp(`\\b${lastWord}\\b`), 'the cap must not cut a word in half');
  }
});

test('a page with nothing worth saying returns the fallback verbatim', () => {
  assert.equal(firstFinding('Home\nDocs\nSign in\nNext\n', 'the page title'), 'the page title');
});

test('the sentence splitter does not break on e.g., v2.1, or 1,000.', () => {
  assert.deepEqual(sentences('Use it, e.g. for docs. Version v2.1 ships now. That is 1,000.5 credits.'), [
    'Use it, e.g. for docs.',
    'Version v2.1 ships now.',
    'That is 1,000.5 credits.',
  ]);
});

test('score rewards numbers, limits and prices, and penalises questions and marketing', () => {
  assert.ok(score('The free plan allows 10 requests per minute and 1,000 credits.') > score('It is a great product for teams.'));
  assert.ok(score('Pricing starts at $16 per month for the Hobby plan.') > 0);
  assert.ok(score('What are the rate limits for the free plan on this service?') < score('The rate limit is 10 requests per minute.'));
});

// ---------------------------------------------------------------- evidence-first ranking
//
// Added 2026-09-20. The extractor already preferred concrete sentences; these cover the
// signals it gained - where a sentence sits on the page, and what kind of claim it makes -
// and the excerpt, which is what lets a reviewer confirm a finding without opening the
// capture.

test('a heading that promises terms outranks one that promises news', () => {
  // The cheapest signal a page gives about which of its claims are load-bearing. The
  // announcement below is longer, has a year in it, and would otherwise compete.
  const page = [
    '# Acme',
    '',
    '## Blog',
    '',
    'We announced our Series B in 2024 and processed 5,000,000 requests that quarter.',
    '',
    '## Rate limits',
    '',
    'The free plan allows 10 requests per minute per team.',
  ].join('\n');
  const result = findingWithContext(page, 'x');
  assert.match(result.finding, /10 requests per minute/);
  assert.equal(result.heading, 'Rate limits');
  assert.ok(result.signals.includes('evidence-heading'), JSON.stringify(result.signals));
});

test('a retention period beats a bare number elsewhere on the page', () => {
  const page = [
    '## Features',
    '',
    'Our dashboard shows 12 charts and refreshes every 30 seconds for every account.',
    '',
    '## Data retention',
    '',
    'Search data is retained for 31 days after the search is completed, then deleted.',
  ].join('\n');
  const result = findingWithContext(page, 'x');
  assert.match(result.finding, /31 days/);
  assert.ok(result.signals.includes('retention'), JSON.stringify(result.signals));
});

test('sign-in and consent text is pushed down even when it carries a number', () => {
  const page = [
    '## Limits',
    '',
    'Sign in to unlock 500 requests per minute on your account today.',
    '',
    'The free plan allows 10 requests per minute per team.',
  ].join('\n');
  assert.match(findingWithContext(page, 'x').finding, /10 requests per minute/);
});

test('the excerpt carries the surrounding paragraph, bounded, so a reviewer can confirm it', () => {
  const page = [
    '## Rate limits',
    '',
    'The free plan allows 10 requests per minute per team.',
    'Requests beyond that return HTTP 429 with a Retry-After header.',
  ].join('\n');
  const result = findingWithContext(page, 'x');
  assert.ok(result.excerpt.includes('HTTP 429'), `the excerpt lost the sentence that qualifies the claim: ${result.excerpt}`);
  assert.ok(result.excerpt.length <= EXCERPT_CHARS + 1, `excerpt is ${result.excerpt.length} chars, which is not bounded`);
});

test('long unbroken paragraphs retain the same bounded excerpt without quadratic recovery', () => {
  const claim = 'The free plan allows 1,000 requests per minute and retains logs for 30 days.';
  const line = '- item is listed here\n';
  const count = Math.ceil(8 * 1024 * 1024 / line.length);
  const page = line.repeat(count) + claim;
  const started = Date.now();
  const result = findingWithContext(page, 'fallback');
  const elapsed = Date.now() - started;
  assert.equal(result.finding, claim);
  const prefix = 'item is listed here '.repeat(count).trim();
  assert.equal(result.excerpt, `${prefix.slice(0, EXCERPT_CHARS).trimEnd()}…`);
  // The reported recovery takes tens of seconds at the accepted capture size. Leave a
  // generous bound for loaded machines while keeping that failure clearly outside it.
  assert.ok(elapsed < 8000, `an 8 MB unbroken paragraph took ${elapsed}ms`);
});

test('paragraph recovery preserves empty Markdown lines, heading boundaries and the exact cap', () => {
  const claim = 'The free plan allows 1,000 requests per minute and retains logs for 30 days.';
  const cases = [
    [`# Old heading\nIgnored before the boundary.\n## Limits\n**\n${claim}\nRequests beyond that return HTTP 429.\n\nNot this paragraph.`, `${claim} Requests beyond that return HTTP 429.`],
    [`   \n${claim}\n## Other\nNot this heading.`, claim],
    [`${'x'.repeat(EXCERPT_CHARS - 1)}\n${claim}`, `${'x'.repeat(EXCERPT_CHARS - 1)}…`],
    [`${'x'.repeat(EXCERPT_CHARS)}\n**\n${claim}`, `${'x'.repeat(EXCERPT_CHARS)}…`],
    [`${claim}\n${'x'.repeat(EXCERPT_CHARS)}`, `${(`${claim} ${'x'.repeat(EXCERPT_CHARS)}`).slice(0, EXCERPT_CHARS).trimEnd()}…`],
    [`${claim}\n\`\`\`\nunchosen code\n\`\`\`\n   `, `${claim} unchosen code`],
  ];
  for (const [page, excerpt] of cases) {
    const result = findingWithContext(page, 'fallback');
    assert.equal(result.finding, claim);
    assert.equal(result.excerpt, excerpt, JSON.stringify(page));
  }
});

test('firstFinding is exactly findingWithContext.finding, so the two cannot drift', () => {
  // firstFinding is what the collector writes into the evidence table; findingWithContext
  // is what a reviewer reads. If they ever selected differently, the excerpt would be
  // supporting a sentence nobody recorded.
  const pages = [
    '## Pricing\n\nThe Starter plan costs $25 per month for 1,000 searches.',
    '',
    'No headings here, just one sentence about a 10 request per minute limit.',
    '## Blog\n\nWe are excited to announce our new brand and our 2024 results.',
  ];
  for (const page of pages) {
    assert.equal(firstFinding(page, 'fb'), findingWithContext(page, 'fb').finding, JSON.stringify(page));
  }
});

test('a page with nothing concrete still returns the fallback, and says so', () => {
  const page = '## About us\n\nWe are a team that loves building things people want.';
  const result = findingWithContext(page, 'the fallback');
  assert.equal(result.finding, 'the fallback');
  assert.equal(result.excerpt, '', 'a fallback finding must not carry an excerpt that supports something else');
});

// ---------------------------------------------------------------- the rule table
//
// The ranking used to be a run of `value += n` statements in score() and a SECOND run of
// them inside the selector. Nobody could state the priority order without executing the
// code, and the number a reviewer saw could differ from the number that chose the
// sentence. RULES is now the only place a weight is declared.

test('every weight lives in RULES, and nowhere else', () => {
  // The structural guard. A stray `value += 2` somewhere would restore exactly the
  // condition this refactor removed: a policy you cannot read.
  const source = fs.readFileSync(path.join(KIT_ROOT, 'lib', 'finding.mjs'), 'utf8');
  const strays = source.split('\n')
    .filter((line) => /\b(value|total|score)\s*[+-]=\s*\d/.test(line))
    .filter((line) => !/rule\.weight/.test(line));
  assert.deepEqual(strays, [], `these lines apply a weight outside RULES:\n  ${strays.join('\n  ')}`);
});

test('each rule is named, weighted, explained and testable', () => {
  // `why` is not decoration: a weight without a reason is one nobody can argue with later.
  for (const rule of RULES) {
    assert.ok(rule.name && /^[a-z][a-z-]*$/.test(rule.name), `bad rule name: ${rule.name}`);
    assert.ok(Number.isInteger(rule.weight) && rule.weight !== 0, `${rule.name} has weight ${rule.weight}`);
    assert.ok(rule.why && rule.why.length > 20, `${rule.name} does not say why it exists`);
    assert.equal(typeof rule.test, 'function', `${rule.name} has no test`);
  }
  assert.equal(new Set(RULES.map((r) => r.name)).size, RULES.length, 'two rules share a name');
});

test('the signals reported are exactly the rules that moved the score', () => {
  // A reviewer is shown `signals`. If those were computed separately from the total, the
  // explanation could be of a different calculation than the one that chose the sentence.
  const text = 'The free plan allows 10 requests per minute per team.';
  const { total, signals } = explainScore(text, { heading: 'Rate limits' });
  const sum = signals.reduce((n, name) => n + RULES.find((r) => r.name === name).weight, 0);
  assert.equal(total, sum, `signals ${signals.join(', ')} sum to ${sum}, but the score is ${total}`);
  assert.equal(score(text, { heading: 'Rate limits' }), total, 'score() and explainScore() disagree');
});

test('a comparison-matrix row loses to prose that answers the question', () => {
  // The SerpApi pricing case. A row like "Plan: Starter$25 / month, Searches: 1,000" is
  // dense with numbers and scores well on every generic rule, but it describes ONE tier -
  // rarely the one being asked about. It must not beat a sentence stating the actual rule.
  const page = [
    '## All plans',
    '',
    '| Plan | Searches / month | Price / month |',
    '| --- | --- | --- |',
    '| Starter | 1,000 | $25 |',
    '',
    'How are searches counted?',
    '',
    'Only successful searches are counted toward your monthly searches. Cached and failed searches are not.',
  ].join('\n');
  const result = findingWithContext(page, 'x');
  assert.match(result.finding, /counted toward/, `a pricing-matrix row won: ${result.finding}`);
  assert.ok(result.signals.includes('metering-rule'), JSON.stringify(result.signals));
});

test('an FAQ answer is found even though its question is not a heading', () => {
  // Pages write FAQ questions as plain text far more often than as headings, so the
  // heading rules cannot see them. Without this the answer scores as orphan prose.
  const page = [
    '## Support',
    '',
    'What happens when I hit the limit?',
    '',
    'Requests beyond the limit are rejected and are not billed to your account.',
  ].join('\n');
  const result = findingWithContext(page, 'x');
  assert.ok(result.signals.includes('answers-a-question'), JSON.stringify(result.signals));
});

// ---------------------------------------------------------------- generalization probe
//
// Added 2026-09-20 after running the extractor against ten vendors it had never seen
// (docs/extractor-generalization-2026-09-20.md). Every failure was a thing the model
// could not REPRESENT, not a weight it got wrong, and these pin the four representations
// that were fixed. The captures themselves are deliberately not in the repository - they
// are not evidence for any unknown here - so each test carries the shape, not the page.

test('a comparison row is detected even when its cells are phrases', () => {
  // Resend and Twilio both lost to rows like this. The detector required a single token
  // before each separator, so `Pro: No limit,` - a phrase - was invisible, and the row
  // collected the table bonus instead of the comparison penalty.
  const page = [
    '## Sending & receiving',
    '',
    '| | Free | Pro | Scale |',
    '| --- | --- | --- | --- |',
    '| Daily limit | 100 | No limit | No limit |',
    '',
    'Resend automatically charges your plan overage rate for each additional bucket of emails.',
  ].join('\n');
  const result = findingWithContext(page, 'x');
  assert.match(result.finding, /overage rate/, `a phrase-celled comparison row won: ${result.finding}`);
});

test('a heading keeps its section context through nested subheadings', () => {
  // The extractor remembered the LAST heading at any level, so `#### Capacity` under
  // `## Pricing` scored as if it were under nothing. A section's context survived exactly
  // as long as no subheading appeared inside it.
  const page = [
    '## Pricing',
    '',
    '### Search',
    '',
    '#### Capacity',
    '',
    'Each query beyond the included allowance costs 40 cents per thousand requests.',
  ].join('\n');
  const result = findingWithContext(page, 'x');
  assert.ok(result.signals.includes('evidence-heading'),
    `"Pricing" was lost by the time the line under "Capacity" was scored: ${JSON.stringify(result.signals)}`);
});

test('money is recognised in the forms pages actually write it', () => {
  // `[$]\d` could not see Stripe's rate at all. The page carries "2.9% + 30¢" eight times.
  for (const text of [
    'Processing costs 2.9% + 30¢ per successful transaction for domestic cards today.',
    'Each additional lookup is billed at 45¢ under the standard agreement terms.',
  ]) {
    assert.ok(explainScore(text, {}).signals.includes('price'), `not seen as money: ${text}`);
  }
});

test('a marketing heading is chrome, not neutral', () => {
  // Headings were evidence-bearing, chrome, or NOTHING - and "nothing" is where marketing
  // lives. Under "Key features" a capability boast competed level with a rate limit.
  const page = [
    '## Key features',
    '',
    'Our index includes over 30 billion pages, refreshed by 100 million updates daily.',
    '',
    '## Rate limits',
    '',
    'The free tier allows 60 requests per hour per key.',
  ].join('\n');
  const result = findingWithContext(page, 'x');
  assert.match(result.finding, /60 requests per hour/, `a capability boast won: ${result.finding}`);
});

test('the joined paragraph is NOT a candidate, and the comment says why', () => {
  // A reverted experiment, pinned so it is not re-tried blind. Joining adjacent lines
  // recovers a claim split across two lines - but on a marketing page adjacent lines are
  // list items, and the join produced collages that outscored real claims.
  const source = fs.readFileSync(path.join(KIT_ROOT, 'lib', 'finding.mjs'), 'utf8');
  assert.ok(/NOT a candidate: the joined paragraph/.test(source),
    'the note explaining why paragraphs are not candidates is gone; without it this gets re-tried');

  const page = [
    '## Plan',
    '',
    'NeuralSearch AI',
    'Smart Groups',
    '99.99% availability',
    '',
    'Requests beyond 10,000 per month are billed at $0.60 per additional thousand.',
  ].join('\n');
  const result = findingWithContext(page, 'x');
  assert.match(result.finding, /0\.60 per additional/, `a feature-list collage won: ${result.finding}`);
});

// Found 2026-10-01 (break-test): the `comparison-row` rule's second test was
// `\b(plan|tier)\b.*\b(month|year|user)\b.*\d`, which is QUADRATIC in the row's length -
// on a row that does not match, every tier word starts a scan that runs to the end of the
// row before it can fail. One 400 KB table row took 24.1 s in `firstFinding`, and the rule
// runs twice per row (as `comparison-row`, and negated as `table-row`). The row is a
// captured page's own content, so its length is the vendor's choice, and this repository's
// corpus already holds a capture with a single 308,705-character line. The collector runs
// the extractor over every page it fetches, and the commit gate has a 120 s watchdog: a
// page big enough turns one commit into a killed gate and one collection into a stall.
//
// The rule is now three linear scans that answer the same question. Both halves of that
// claim are pinned here: the SAME answers, and a bounded cost.
test('the comparison-row rule is linear in the row, and answers what the regex answered', () => {
  // The rule as it was written, kept here as the oracle. `: ` counting short-circuits it in
  // the implementation, so the oracle carries that too - the two must agree on every row.
  const asItWas = (text) => {
    const source = String(text);
    return (source.match(/: /g) ?? []).length >= 3 || /\b(plan|tier)\b.*\b(month|year|user)\b.*\d/i.test(source);
  };
  // `comparison-row` weighs -4 and `table-row` +2, and the latter is the negation of the
  // former, so the difference between the two contexts is -4 for a comparison row and +2
  // for any other table row. That is the rule, read out through the public scorer.
  const comparisonRow = (text) => {
    const diff = score(text, { fromTable: true }) - score(text, { fromTable: false });
    assert.ok(diff === -4 || diff === 2, `the two table rules no longer differ by exactly one of them: ${diff}`);
    return diff === -4;
  };

  // Deterministic: a linear congruential generator over an alphabet made of the words the
  // rule looks for, their near-misses (`users`, `monthly`, `PLAN`), the `: ` the counter
  // looks for, a newline (`.` does not cross one) and filler. 4,000 rows, both positive and
  // negative, chosen by a seed rather than by hand - a rewrite of a rule is exactly where a
  // hand-picked example set passes for the wrong reason.
  const alphabet = ['plan', 'tier', 'month', 'year', 'user', '7', ' ', 'x', '\n', 'PLAN', 'Tier',
    'users', 'monthly', ': ', 'plan tier', 'per user', 'a-b', '.'];
  let seed = 987654321;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let positives = 0;
  for (let i = 0; i < 4000; i += 1) {
    let row = '';
    const parts = 1 + Math.floor(next() * 16);
    for (let k = 0; k < parts; k += 1) row += alphabet[Math.floor(next() * alphabet.length)];
    const mine = comparisonRow(row);
    if (mine) positives += 1;
    assert.equal(mine, asItWas(row), `the linear rule and the regex disagree on ${JSON.stringify(row)}`);
  }
  assert.ok(positives > 20, `only ${positives} of 4,000 rows were comparison rows - the oracle is not being exercised both ways`);

  // And the cost. A row the size this repository's own corpus already holds, through the
  // extractor the collector runs on every page: 24.1 s before this fix, tens of
  // milliseconds after. The bound is loose enough for a loaded CI runner and far below the
  // cost that made the gate's watchdog a real risk.
  const cell = 'a storage tier or a plan for the tier '.repeat(12000).slice(0, 400_000);
  const page = `# Pricing\n\n| Term | Value |\n|---|---|\n| ${cell} | none |\n`;
  const started = Date.now();
  firstFinding(page, 'fallback');
  const ms = Date.now() - started;
  assert.ok(ms < 4000, `a 400 KB table row took ${ms}ms in the extractor - the rule is not linear`);
});
