// The quote-level refresh recheck (ADR-0193, plan v0.4 §7): an unknown that still cites a row a
// later capture superseded passes `evidence-supersession/quote-survived-refresh` only when every
// usable quote anchor of the old row is found in the old row's OWN capture and in the replacing
// row's OWN capture, which is readable and not an HTTP error page. Every other state stays
// `cites-superseded-row` (ADR-0026), with the reason in the detail. The citation is never moved.
//
// Numbered as plan §7.5 numbers them. Each refresh goes through the real collector (`collectOne`)
// with only the page's answer stubbed - the network boundary - so the row, the capture and the
// ledger entry the gate reads are the ones a refresh writes. A state the collector no longer
// writes (an error page kept as a capture, before 2026-09-28) is written the way it was then.

import path from 'node:path';
import crypto from 'node:crypto';
import { test, describe, assert, makePassingProject, corrupt, fs, tempDir, KIT_ROOT } from './harness.mjs';
import { PATHS, resolve, readText } from '../lib/core.mjs';
import { collectOne, writeRaw } from '../lib/collect.mjs';
import { readCorpus, parseCapture } from '../lib/corpus.mjs';
import { runCheck, supersededRows } from '../lib/checks.mjs';
import { verifyLedger, appendFetch } from '../lib/provenance.mjs';
import { runPreflight } from '../lib/preflight.mjs';
import { quoteAnchors, quoteTooShort, MAX_QUOTE_GAP } from '../lib/quotes.mjs';

describe('quote-recheck');

const LIMITS_URL = 'https://example.invalid/docs/limits';
const DAY1 = '2026-10-01';
const DAY2 = '2026-10-20';
const DAY3 = '2026-10-22';
// makePassingProject's E-01: its Finding, and the sentence its capture repeats thirty times.
const FINDING = 'The free plan allows 10 requests per minute and includes 1,000 credits.';
const SENTENCE = 'The free plan allows 10 requests per minute and includes 1,000 credits.';
const SAME_PAGE = `# Limits\n\n${`${SENTENCE} `.repeat(30)}`;
const PAID = 'Paid plans start at 20 dollars a month and allow 600 requests per minute.';
const LIMIT_LINE = 'Refresh confirmation detects whether the quoted words are still in the new capture, never whether the claim is still true.';

function snapshot(dir) {
  const corpus = readCorpus(dir);
  corpus.chain = verifyLedger(dir, { corpus });
  return corpus;
}

/** makePassingProject on DAY1, with E-01's Finding carrying these quote markers. */
function quotedProject(quotes = [SENTENCE], { finding = FINDING } = {}) {
  const dir = makePassingProject(tempDir('fp-recheck-'), { date: DAY1 });
  const cell = [finding, ...quotes.map((q) => `[quote: ${q}]`)].join(' ');
  corrupt(dir, PATHS.evidence, (text) => text.replace(`| ${FINDING} |`, `| ${cell} |`));
  assert.equal(readCorpus(dir).evidence[0].finding, cell, 'the fixture did not write the quote, so it proves nothing');
  return dir;
}

/** Re-collect the limits page through the real collector; `markdown` is what the page now says. */
function refresh(dir, markdown, { transportName = 'firecrawl-cli', date = DAY2, completeness = 'full', omitted = '', source } = {}) {
  const result = collectOne(dir, LIMITS_URL, {
    runScrape: (url) => ({ ok: true, url, title: 'Limits', markdown, statusCode: 200, transport: transportName,
      cmd: `stub scrape ${url}`, completeness, omitted, ...(source === undefined ? {} : { source }) }),
    corpus: readCorpus(dir), force: true, type: 'P', transportName, date, maxRateLimitRetries: 0, sleep: () => {},
  });
  assert.equal(result.status, 'collected', `the refresh was not collected: ${result.reason}`);
  return result;
}

/** A capture written as the collector wrote one before it refused error pages (2026-09-28), with its row. */
function legacyRefresh(dir, markdown, { statusCode, date = DAY2, id = 'E-02' }) {
  const entry = writeRaw(dir, { url: LIMITS_URL, title: 'Not Found', markdown, statusCode,
    cmd: `firecrawl scrape ${LIMITS_URL} --only-main-content --json`, transport: 'firecrawl-cli', completeness: 'full' }, { date });
  appendFetch(dir, { op: 'scrape', url: LIMITS_URL, type: 'P', raw: entry.file, transport: 'firecrawl-cli', completeness: 'full',
    bodySha256: crypto.createHash('sha256').update(fs.readFileSync(resolve(dir, entry.file))).digest('hex'),
    cmd: entry.command, at: `${date}T00:00:00.000Z` });
  fs.appendFileSync(resolve(dir, PATHS.evidence), `| ${id} | ${date} | P | ${LIMITS_URL} | Not Found | ${entry.file} |\n`);
  return entry;
}

/** The findings of evidence-supersession about one citation. */
function about(dir, { unknown = 'U-1', cited = 'E-01' } = {}) {
  const findings = runCheck('evidence-supersession', snapshot(dir));
  return { findings, mine: findings.filter((f) => f.row === unknown && (f.superseded === cited || f.cited === cited)) };
}

/** Exactly one finding about U-1's citation of E-01, and it is a reopen; returns its detail. */
function reopened(dir, what, { moved = false } = {}) {
  const { findings, mine } = about(dir);
  assert.equal(mine.length, 1, `${what}: ${JSON.stringify(findings)}`);
  assert.equal(mine[0].rule, 'cites-superseded-row', `${what} passed: ${mine[0].detail}`);
  assert.equal(mine[0].severity, 'fail');
  // A refresh that landed on another URL superseded nothing by URL, so its reopen leads with the
  // move instead (ADR-0193 decision 8); the callers assert the rest of that sentence.
  const lead = moved ? 'U-1 rests on E-01, and the refresh on '
    : `U-1 rests on E-01, which has been superseded by ${mine[0].by} - a fresher capture of the same URL `;
  assert.ok(mine[0].detail.startsWith(lead), `the reopen must lead with ${moved ? 'the move' : 'ADR-0026\'s message'}: ${mine[0].detail}`);
  assert.ok(mine[0].detail.endsWith(LIMIT_LINE), `a reopen must end with what the recheck can and cannot say: ${mine[0].detail}`);
  return mine[0].detail;
}

/** Exactly one finding about U-1's citation of E-01, and it is the pass; returns it. */
function survived(dir, what) {
  const { findings, mine } = about(dir);
  assert.equal(mine.length, 1, `${what}: ${JSON.stringify(findings)}`);
  assert.equal(mine[0].rule, 'quote-survived-refresh', `${what} reopened: ${mine[0].detail}`);
  assert.equal(mine[0].severity, 'pass');
  // A pass ends with the limit line too (U8 review F2, RUN.md D-v): shown with --show-pass or in
  // --json, it is the line that says what the pass did not measure.
  assert.ok(mine[0].detail.endsWith(LIMIT_LINE), `a pass must end with what the recheck can and cannot say: ${mine[0].detail}`);
  assert.equal(findings.filter((f) => f.severity === 'fail').length, 0, JSON.stringify(findings));
  return mine[0];
}

const rowOf = (dir, id) => readCorpus(dir).evidence.find((row) => row.id === id);
const blankRaw = (dir, id) => {
  corrupt(dir, PATHS.evidence, (text) => text.replace(new RegExp(`^(\\| ${id} \\|.*\\| )research/raw/\\S+( \\|)$`, 'm'), '$1$2'));
  assert.equal(rowOf(dir, id).raw, '', `the fixture did not blank ${id}'s Raw cell, so it proves nothing`);
};

// ---------------------------------------------------------------- plan §7.5, tests 1-15

test('recheck 1: every usable quote is still in a changed page - quote-survived-refresh, and the citation stays where it was', () => {
  const dir = quotedProject([SENTENCE, 'includes 1,000 credits ... The free plan allows']);
  const { entry } = refresh(dir, `# Limits (updated)\n\nWe redesigned this page.\n\n${`${SENTENCE} `.repeat(3)}\n\n${PAID}\n`);
  const discovery = fs.readFileSync(resolve(dir, PATHS.discovery));
  const evidence = fs.readFileSync(resolve(dir, PATHS.evidence));
  const pass = survived(dir, 'two usable quotes, both in the new capture');
  assert.deepEqual([pass.superseded, pass.by, pass.capture], ['E-01', 'E-02', entry.file]);
  assert.equal(pass.detail, `E-01's quoted words occur in E-02's capture ${entry.file}. `
    + `That says the words survived, not that the claim still holds. Re-read E-02 when you next touch U-1. ${LIMIT_LINE}`);
  assert.deepEqual(fs.readFileSync(resolve(dir, PATHS.discovery)), discovery, 'the recheck moved or rewrote a citation');
  assert.deepEqual(fs.readFileSync(resolve(dir, PATHS.evidence)), evidence, 'the recheck rewrote the evidence table');
  assert.deepEqual(readCorpus(dir).unknowns[0].cites, ['E-01'], 'U-1 must still cite E-01: moving it is the researcher\'s act');
});

test('recheck 2: the one quote is gone from the new page - reopen, naming the quote and the capture', () => {
  const dir = quotedProject();
  const { entry } = refresh(dir, `# Limits\n\n${'The free plan now allows 20 requests per minute and includes 500 credits. '.repeat(30)}`);
  const detail = reopened(dir, 'a quote missing from the replacement');
  assert.ok(detail.includes(`E-01's quote "${SENTENCE}" is not in E-02's capture ${entry.file}. `
    + 'The page changed, or the converter changed without being recorded. Both are possible.'), detail);
});

test('recheck 3: a row with no quote reopens exactly as ADR-0026 did, and says there was nothing to recheck', () => {
  const dir = makePassingProject(tempDir('fp-recheck-'), { date: DAY1 });
  refresh(dir, SAME_PAGE);
  const detail = reopened(dir, 'an unquoted row');
  assert.ok(detail.includes('Re-read it, then move the citation or record why the earlier reading still holds. E-01 carries no quote to recheck.'), detail);
});

test('recheck 4: a row whose every quote is too short reopens - a two-word quote anchors nothing', () => {
  const dir = quotedProject(['free plan', '1,000 credits']);
  refresh(dir, SAME_PAGE);
  const detail = reopened(dir, 'only too-short quotes');
  assert.ok(detail.includes('Every quote E-01 carries is too short to anchor anything (quote-too-short), so none can be rechecked.'), detail);
});

test('recheck 5: the replacement\'s capture file is missing - reopen, never read as an empty page', () => {
  const dir = quotedProject();
  const { entry } = refresh(dir, SAME_PAGE);
  fs.rmSync(resolve(dir, entry.file));
  const detail = reopened(dir, 'a replacement capture that is not on disk');
  assert.ok(detail.includes(`E-02 names ${entry.file}, which is not on disk or could not be read as a capture, so the recheck could not look.`), detail);
});

test('recheck 6: the replacement row\'s Raw cell is blank - reopen, with no fallback to the URL\'s capture', () => {
  const dir = quotedProject();
  refresh(dir, SAME_PAGE);
  blankRaw(dir, 'E-02');
  assert.equal(supersededRows(readCorpus(dir)).get('E-01')?.id, 'E-02', 'E-02 must still supersede E-01, or this proves nothing');
  const detail = reopened(dir, 'a replacement naming no capture');
  assert.ok(detail.includes('E-02 names no capture in its Raw cell, and the recheck reads only the capture a row names, so the recheck could not look.'), detail);
});

test('recheck 7: the replacement is an HTTP error page that holds the words - reopen', () => {
  // 400 as well as 404: an error page is a status of 400 or more (found 2026-10-26, Phase 4b
  // mutation C22: with 404 alone, "> 400" passed a 400 page holding the words).
  for (const statusCode of [400, 404]) {
    const dir = quotedProject();
    const entry = legacyRefresh(dir, `# Not Found\n\nThis page has moved. Cached text follows.\n\n${SENTENCE}\n`, { statusCode });
    assert.ok(readText(resolve(dir, entry.file)).includes(SENTENCE), 'the error page must hold the words, or this proves nothing');
    const detail = reopened(dir, `an HTTP ${statusCode} error page holding the words`);
    assert.ok(detail.includes(`E-02's capture ${entry.file} is an HTTP ${statusCode} page - words found on an error page are not the page's.`), detail);
  }
});

// Found 2026-10-25 (Phase 4b breaker, F2): the error-page test read the status with Number(), and a
// status kept as text - "404 Not Found", "HTTP 404", a quoted "404" in a capture header - is NaN, so
// the capture counted as "not an error page" and an error page holding the old words PASSED. The
// Firecrawl adapter keeps a string status as it came; the collector reads it with the same Number(),
// so it keeps such an answer as a capture. A status that cannot be read is a state the §7.1 table
// does not list, so it defaults to the reopen. An empty status (5 committed captures) says nothing,
// and a numeric 200 is the page: both still pass.
test('a replacement whose HTTP status cannot be read as a number reopens, and says so; an empty status or a numeric 200 still passes', () => {
  const cached = `# Not Found\n\nCached copy: ${`${SENTENCE} `.repeat(30)}`;
  for (const statusCode of ['404 Not Found', 'HTTP 404', '4O4']) {
    const dir = quotedProject();
    const result = collectOne(dir, LIMITS_URL, {
      runScrape: (url) => ({ ok: true, url, title: 'Not Found', markdown: cached, statusCode, transport: 'firecrawl-cli', cmd: 'stub', completeness: 'full', omitted: '' }),
      corpus: readCorpus(dir), force: true, type: 'P', transportName: 'firecrawl-cli', date: DAY2, maxRateLimitRetries: 0, sleep: () => {},
    });
    assert.equal(result.status, 'collected', `${statusCode}: the collector refused the page, so the recheck never sees it and this proves nothing`);
    const detail = reopened(dir, `a capture whose status is "${statusCode}"`);
    assert.ok(detail.includes(`E-02's capture ${result.entry.file} records its HTTP status as "${statusCode}", which is not a number, `
      + 'so the recheck cannot tell whether it is an error page - and words found on an error page are not the page\'s.'), detail);
  }
  // The header form of a pre-2026-09-28 capture: a status written with its quote marks.
  const quoted = quotedProject();
  const entry = legacyRefresh(quoted, cached, { statusCode: '"404"' });
  assert.equal(readCorpus(quoted).captures.byFile.get(entry.file).statusCode, '"404"', 'the header does not carry the quoted status, so this proves nothing');
  assert.ok(reopened(quoted, 'a quoted status in the capture header').includes('records its HTTP status as ""404"", which is not a number'));

  for (const statusCode of ['', 200]) {
    const dir = quotedProject();
    legacyRefresh(dir, SAME_PAGE, { statusCode });
    survived(dir, `a replacement whose status is ${JSON.stringify(statusCode)}`);
  }
});

test('recheck 8: several quotes, one gone - reopen, naming the one that is gone', () => {
  // E-01's own capture must hold both quotes, or the old row has no baseline: give it one.
  const dir = quotedProject([SENTENCE, PAID]);
  legacyBaseline(dir, `# Limits\n\n${`${SENTENCE} `.repeat(10)}\n\n${PAID}\n`);
  const { entry } = refresh(dir, SAME_PAGE);
  const detail = reopened(dir, 'one of two quotes gone');
  assert.ok(detail.includes(`E-01's quote "${PAID}" is not in E-02's capture ${entry.file}.`), detail);
  assert.equal(detail.includes(`"${SENTENCE}" is not in`), false, `the surviving quote was named as gone: ${detail}`);
});

/**
 * Make E-01 rest on a capture holding `markdown`: a second DAY1 capture of the page, which E-01's
 * Raw cell then names. Returns the capture. (makePassingProject's page carries one sentence.)
 */
function legacyBaseline(dir, markdown) {
  const entry = writeRaw(dir, { url: LIMITS_URL, title: 'Limits', markdown, statusCode: 200,
    cmd: `firecrawl scrape ${LIMITS_URL} --only-main-content --json`, transport: 'firecrawl-cli', completeness: 'full' }, { date: DAY1 });
  appendFetch(dir, { op: 'scrape', url: LIMITS_URL, type: 'P', raw: entry.file, transport: 'firecrawl-cli', completeness: 'full',
    bodySha256: crypto.createHash('sha256').update(fs.readFileSync(resolve(dir, entry.file))).digest('hex'),
    cmd: entry.command, at: `${DAY1}T01:00:00.000Z` });
  const old = rowOf(dir, 'E-01').raw;
  corrupt(dir, PATHS.evidence, (text) => text.replace(`| ${old} |`, `| ${entry.file} |`));
  assert.equal(rowOf(dir, 'E-01').raw, entry.file, 'E-01 does not name the baseline capture');
  return entry;
}

// A quote too short to anchor anything is left out of the recheck on both sides, the baseline and
// the replacement (found 2026-10-26, Phase 4b mutations C20 and C20b: looked for among every
// anchor, a too-short quote missing from either capture reopened a citation whose usable quote
// survived - the stricter direction).
test('a too-short quote beside a usable one is not rechecked: missing from the replacement, or from the old capture, the citation still passes', () => {
  const SHORT = 'hourly burst';
  assert.equal(quoteTooShort(quoteAnchors(`[quote: ${SHORT}]`)[0]), true, 'the short quote must be quote-too-short, or this proves nothing');
  const withShort = `${SAME_PAGE}\n\nThe ${SHORT} is 50 requests.\n`;

  const goneFromNew = quotedProject([SENTENCE, SHORT]);
  legacyBaseline(goneFromNew, withShort);
  const { entry } = refresh(goneFromNew, SAME_PAGE);
  assert.equal(readText(resolve(goneFromNew, entry.file)).includes(SHORT), false, 'the replacement must lack the short quote, or this proves nothing');
  survived(goneFromNew, 'a too-short quote missing from the replacement');

  const neverInOld = quotedProject([SENTENCE, SHORT]);
  assert.equal(readText(resolve(neverInOld, rowOf(neverInOld, 'E-01').raw)).includes(SHORT), false,
    'E-01\'s own capture must lack the short quote, or this proves nothing');
  refresh(neverInOld, withShort);
  survived(neverInOld, 'a too-short quote its own capture never held');
});

test('recheck 9: a byte-identical replacement with a usable quote passes', () => {
  const dir = quotedProject();
  const { entry } = refresh(dir, SAME_PAGE);
  const body = (file) => parseCapture(readText(resolve(dir, file))).body;
  assert.notEqual(entry.file, rowOf(dir, 'E-01').raw, 'the refresh reused E-01\'s file, so no row superseded it');
  assert.equal(body(entry.file), body(rowOf(dir, 'E-01').raw), 'the two capture bodies must be byte-identical, or this proves nothing');
  survived(dir, 'a byte-identical refresh');
});

test('recheck 10: the old row\'s Raw cell is blank - reopen; the URL\'s capture (the new one) never vouches for it', () => {
  const dir = quotedProject();
  refresh(dir, SAME_PAGE);
  blankRaw(dir, 'E-01');
  assert.equal(supersededRows(readCorpus(dir)).get('E-01')?.id, 'E-02', 'E-02 must still supersede E-01, or this proves nothing');
  const detail = reopened(dir, 'an old row naming no capture');
  assert.ok(detail.includes('E-01 names no capture in its Raw cell, and the recheck reads only the capture a row names, so its quote has no baseline to recheck.'), detail);
});

test('recheck 11: a link-syntax two-word quote (B1, ADR-0191) is too short - reopen', () => {
  const dir = quotedProject(['[Free plan](https://example.invalid/docs/limits#free-plan-details)']);
  refresh(dir, SAME_PAGE);
  const detail = reopened(dir, 'a link-syntax quote that anchors "free plan"');
  assert.ok(detail.includes('Every quote E-01 carries is too short to anchor anything (quote-too-short)'), detail);
});

// U9 (B2, ADR-0192) makes the matcher ignore spacing before closing punctuation; it landed first
// (2d831ca), so the quote survives. Before it this line read 'cites-superseded-row'.
const TRANSPORT_SPACING_OUTCOME = 'quote-survived-refresh';
const TRANSPORT_LINE = 'Captured by firecrawl-cli then, http-keyless now. A transport change alone can lose a quote.';
const MOVED_PAGE = `# Limits\n\n${'Rate limits are listed on the account page now. '.repeat(30)}`;
const DEFAULT_CAUSE = 'The page changed, or the converter changed without being recorded. Both are possible.';

test('recheck 12: Firecrawl to keyless, the quote lost only to a space before the full stop - outcome pinned', () => {
  const dir = quotedProject();
  refresh(dir, `# Limits\n\n${'The free plan allows 10 requests per minute and includes 1,000 credits . '.repeat(30)}`, { transportName: 'http-keyless' });
  const { findings, mine } = about(dir);
  assert.equal(mine.length, 1, JSON.stringify(findings));
  assert.equal(mine[0].rule, TRANSPORT_SPACING_OUTCOME, mine[0].detail);
  // Dormant while the outcome is the pass (since ADR-0192), and kept: a matcher change that makes
  // this a reopen again must still name the transport. Case 3 is pinned on its own by "7.3 case 3"
  // below (U8 review F1: with only this branch, removing case 3 left the suite green).
  if (mine[0].rule === 'cites-superseded-row') {
    assert.ok(mine[0].detail.includes(TRANSPORT_LINE), mine[0].detail);
  }
});

test('recheck 13: the page\'s source is unchanged and the capture differs - reopen, saying the conversion changed', () => {
  // E-01 has no source (it predates ADR-0140), so the chain starts at E-02, which has one.
  const dir = quotedProject();
  const html = `<html><body><h1>Limits</h1><p>${SENTENCE}</p></body></html>`;
  const first = refresh(dir, SAME_PAGE, { source: html });
  corrupt(dir, PATHS.evidence, (text) => text.replace(new RegExp(`^(\\| E-02 \\|.*\\| )[^|]*( \\| ${first.entry.file} \\|)$`, 'm'), `$1${FINDING} [quote: ${SENTENCE}]$2`));
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED | E-01', '| CLOSED | E-02'));
  const second = refresh(dir, '# Limits\n\nThe free plan allows ten requests a minute.\n', { source: html, date: DAY3 });
  const ledger = readCorpus(dir).ledger.entries;
  const sha = (file) => ledger.find((e) => e.raw === file)?.sourceSha256;
  assert.ok(sha(first.entry.file) && sha(first.entry.file) === sha(second.entry.file), 'the two fetches must record one source hash, or this proves nothing');
  const { findings, mine } = about(dir, { cited: 'E-02' });
  assert.equal(mine.length, 1, JSON.stringify(findings));
  assert.equal(mine[0].rule, 'cites-superseded-row', mine[0].detail);
  assert.ok(mine[0].detail.includes('The page\'s source is unchanged; the capture differs because the conversion did. '
    + 'This is not a defect in your research. Re-read before concluding anything about the page.'), mine[0].detail);
});

test('recheck 14: a refresh the page answered 404 fails the citation as cites-gone-page (ADR-0194), and nothing passes', () => {
  const dir = quotedProject();
  const result = collectOne(dir, LIMITS_URL, {
    runScrape: (url) => ({ ok: true, url, title: 'Not Found', markdown: '# Not Found', statusCode: 404, transport: 'firecrawl-cli', cmd: 'stub', completeness: 'full', omitted: '' }),
    corpus: readCorpus(dir), force: true, type: 'P', transportName: 'firecrawl-cli', date: DAY2, maxRateLimitRetries: 0, sleep: () => {},
  });
  assert.equal(result.status, 'failed', 'the collector kept the 404 as a capture');
  const { findings, mine } = about(dir);
  assert.deepEqual(mine.map((f) => [f.rule, f.severity]), [['cites-gone-page', 'fail']], JSON.stringify(findings));
  assert.equal(findings.some((f) => f.severity === 'pass'), false, JSON.stringify(findings));
});

test('KNOWN GAP: recheck 15 (E6) - a redesign keeps the sentence under a new "Enterprise only" heading, and it passes', () => {
  // A string check cannot see that the heading above the sentence changed what it means. The
  // recheck spares this re-read wrongly; plan §12 measures what that costs. Pinned so the gap
  // cannot change size silently.
  const dir = quotedProject();
  refresh(dir, `# Limits\n\n## Enterprise only\n\n${`${SENTENCE} `.repeat(3)}\n\nThe free plan has been discontinued.\n`);
  survived(dir, 'the E6 redesign');
});

// Found 2026-10-26 (Stage 7 gap audit, gap 2): Firecrawl writes struck-through text as ~~...~~,
// the matcher keeps the tildes, and its indexOf finds a quote inside the span. The shape is the
// EUDR corpus's (docs/decisions/2026-09-22-eudr-dates, the Wikipedia capture), where a postponed
// application date is struck through beside the new one. The matcher is not changed here.
test('KNOWN GAP: a quote found only inside a struck-through span of the new capture passes (gap 2, EUDR shape)', () => {
  const DATED = 'Large operators must comply with the regulation from 30 December 2025.';
  const dir = quotedProject([DATED]);
  legacyBaseline(dir, `# Application\n\n${`${DATED} `.repeat(10)}\n`);
  const struck = `# Application\n\n~~${DATED}~~ (postponed)\n\nLarge operators must comply with the regulation from 30 December 2026.\n\n${'The regulation applies to seven commodities. '.repeat(5)}`;
  const { entry } = refresh(dir, struck);
  const body = parseCapture(readText(resolve(dir, entry.file))).body;
  assert.equal(body.replace(/~~[^~]*~~/g, '').includes(DATED.slice(0, -1)), false, 'the quote occurs outside the struck span, so this proves nothing');
  survived(dir, 'a quote that is struck through on the refreshed page');
});

// Found 2026-10-26 (Stage 7 gap audit, gap 3): the recheck uses the matcher's ellipsis rule, so
// text between two fragments - up to MAX_QUOTE_GAP compared characters - can change and the
// pass still says the quoted words occur. 3 of the baseline's 517 anchors carry an ellipsis.
test('KNOWN GAP: text changed inside an ellipsis gap passes the recheck (gap 3)', () => {
  const dir = quotedProject(['The free plan allows 10 requests per minute ... includes 1,000 credits']);
  const changed = 'The free plan allows 10 requests per minute for the first week only, and after that no longer includes 1,000 credits.';
  const { entry } = refresh(dir, `# Limits\n\n${`${changed} `.repeat(30)}`);
  const body = readText(resolve(dir, entry.file));
  assert.equal(body.includes(SENTENCE), false, 'the old sentence is still in the new capture, so this proves nothing');
  assert.ok(changed.indexOf('includes 1,000') - changed.indexOf('per minute') < MAX_QUOTE_GAP, 'the change is not inside the gap, so this proves nothing');
  survived(dir, 'a sentence changed between the two fragments');
});

// ---------------------------------------------------------------- the rest of the table

test('the old row\'s quote must be found in its OWN capture first (the baseline rule), or the recheck has nothing to compare', () => {
  const dir = quotedProject([PAID]);
  const { entry } = refresh(dir, `${SAME_PAGE}\n\n${PAID}\n`);
  assert.ok(readText(resolve(dir, entry.file)).includes(PAID), 'the new capture must hold the quote, or this proves nothing');
  const detail = reopened(dir, 'a quote its own capture never held');
  assert.ok(detail.includes(`E-01's quote "${PAID}" is not in its own capture ${rowOf(dir, 'E-01').raw}, so it has no baseline to recheck against.`), detail);

  const gone = quotedProject();
  refresh(gone, SAME_PAGE);
  const own = rowOf(gone, 'E-01').raw;
  fs.rmSync(resolve(gone, own));
  const missing = reopened(gone, 'an old row whose capture is not on disk');
  assert.ok(missing.includes(`E-01 names ${own}, which is not on disk or could not be read as a capture, so its quote has no baseline to recheck.`), missing);
});

test('the reopen says why it could not tell, case by case: a partial capture names what it left out; a thin one could not be looked at', () => {
  const partial = quotedProject();
  refresh(partial, `# Limits\n\n${'Pricing is listed in the table below, which this capture left out. '.repeat(10)}`, { completeness: 'partial', omitted: 'the pricing table' });
  assert.ok(reopened(partial, 'a partial capture').includes('E-02\'s capture is partial; the words may be in the part not captured: the pricing table.'));

  const thin = quotedProject();
  refresh(thin, '# Limits\n\nLoading...\n');
  assert.ok(reopened(thin, 'a thin capture').includes('The recheck could not look. This is not evidence the words are gone.'));

  // Thin is under MIN_CAPTURE_CHARS (200) bytes of body: 199 is thin, 200 is not (found
  // 2026-10-26, Phase 4b mutation C26: the boundary was unpinned).
  for (const [bytes, isThin] of [[199, true], [200, false]]) {
    const dir = quotedProject();
    const { entry } = refresh(dir, `# Limits\n\n${'z'.repeat(bytes - 11)}`);
    assert.equal(readCorpus(dir).captures.byFile.get(entry.file).bytes, bytes, 'the capture body is not the size this case is about, so it proves nothing');
    const detail = reopened(dir, `a ${bytes}-byte capture`);
    assert.equal(detail.includes(`E-02's capture is ${bytes} bytes, too thin to tell.`), isThin, detail);
    assert.equal(detail.includes(DEFAULT_CAUSE), !isThin, detail);
  }
});

/**
 * A capture and its ledger entry written by hand, so the capture header and the ledger can say
 * different things. `row` 'E-01' makes it E-01's own capture (its Raw cell is renamed);
 * any other id appends that row.
 */
function handFetch(dir, markdown, { row, date, header = {}, ledger = {} }) {
  const entry = writeRaw(dir, { url: LIMITS_URL, title: 'Limits', markdown, statusCode: 200, cmd: 'stub',
    transport: 'firecrawl-cli', completeness: 'full', ...header }, { date });
  appendFetch(dir, { op: 'scrape', url: LIMITS_URL, type: 'P', raw: entry.file, cmd: entry.command, at: `${date}T01:00:00.000Z`, ...ledger });
  if (row === 'E-01') {
    const old = rowOf(dir, 'E-01').raw;
    corrupt(dir, PATHS.evidence, (text) => text.replace(`| ${old} |`, `| ${entry.file} |`));
  } else {
    fs.appendFileSync(resolve(dir, PATHS.evidence), `| ${row} | ${date} | P | ${LIMITS_URL} | Rate limits moved. | ${entry.file} |\n`);
  }
  assert.equal(rowOf(dir, row).raw, entry.file, `${row} does not name the hand-written capture`);
  return entry;
}

// Plan §7.3's attribution reads each field from the ledger entry and, where the ledger is silent,
// from the capture's header, and names a cause only when both sides record it (found 2026-10-26,
// Phase 4b mutations C24, C25, C27b, C43, C46: those presence checks and header fallbacks were
// unpinned). Wording only: every case reopens with or without them.
test('the attribution names a cause only when both sides record it, and reads the capture header where the ledger is silent', () => {
  const cases = [
    { what: 'neither scrape records bodySha256, so nothing says the bytes are the same',
      old: { ledger: { transport: 'firecrawl-cli', completeness: 'full' } },
      now: { ledger: { transport: 'firecrawl-cli', completeness: 'full' } },
      cause: DEFAULT_CAUSE },
    { what: 'only the replacement records a transport, so no transport change is named',
      old: { header: { transport: '' } },
      now: { header: { transport: 'http-keyless' }, ledger: { transport: 'http-keyless' } },
      cause: DEFAULT_CAUSE },
    { what: 'neither ledger entry records a transport and both capture headers do',
      old: { header: { transport: 'firecrawl-cli' } },
      now: { header: { transport: 'http-keyless' } },
      cause: TRANSPORT_LINE },
    { what: 'the capture header says partial while the ledger entry says full',
      old: { ledger: { transport: 'firecrawl-cli' } },
      now: { header: { completeness: 'partial', omitted: 'the pricing table' }, ledger: { transport: 'firecrawl-cli', completeness: 'full' } },
      cause: 'E-02\'s capture is partial; the words may be in the part not captured: the pricing table.' },
  ];
  for (const { what, old, now, cause } of cases) {
    const dir = quotedProject();
    handFetch(dir, SAME_PAGE, { row: 'E-01', date: DAY1, ...old });
    handFetch(dir, MOVED_PAGE, { row: 'E-02', date: DAY2, ...now });
    assert.equal(supersededRows(readCorpus(dir)).get('E-01')?.id, 'E-02', `${what}: E-02 must supersede E-01, or this proves nothing`);
    const detail = reopened(dir, what);
    assert.ok(detail.includes(`E-01's quote "${SENTENCE}" is not in E-02's capture`), `${what}: ${detail}`);
    assert.ok(detail.includes(cause), `${what}: ${detail}`);
  }
});

// A state the §7.1 table does not list, so it defaults to a reopen: the quote survived into E-02,
// then a later refresh found the page gone (ADR-0194). A pass beside cites-gone-page would tell
// the reader the words survived on a page that no longer exists.
test('the words survived into the replacement, then a later refresh found the page gone - reopen beside cites-gone-page, no pass', () => {
  const dir = quotedProject();
  refresh(dir, SAME_PAGE);
  const result = collectOne(dir, LIMITS_URL, {
    runScrape: (url) => ({ ok: true, url, title: 'Gone', markdown: '# Gone', statusCode: 410, transport: 'firecrawl-cli', cmd: 'stub', completeness: 'full', omitted: '' }),
    corpus: readCorpus(dir), force: true, type: 'P', transportName: 'firecrawl-cli', date: DAY3, maxRateLimitRetries: 0, sleep: () => {},
  });
  assert.equal(result.status, 'failed', 'the collector kept the 410 as a capture');
  const { findings, mine } = about(dir);
  assert.deepEqual(mine.map((f) => [f.rule, f.severity]), [['cites-superseded-row', 'fail'], ['cites-gone-page', 'fail']], JSON.stringify(findings));
  assert.ok(mine[0].detail.includes('found the page gone (HTTP 410), so no capture of it is current.'), mine[0].detail);
  assert.ok(mine[0].detail.endsWith(LIMIT_LINE), mine[0].detail);
  assert.equal(findings.some((f) => f.rule === 'quote-survived-refresh'), false, JSON.stringify(findings));
});

// The same state, with the old row's Finding naming the status as content ("return HTTP 404").
// ADR-0194 exempts such a row from cites-gone-page (the row said so itself), and until 2026-10-25
// (U8 review F3, RUN.md D-v) the recheck asked the same exempting question, so the citation PASSED
// with no finding at all on a page the newest fetch found gone. The recheck asks something else -
// did a fetch after the replacement fail - which the old row's text cannot answer. cites-gone-page
// and its exemption are unchanged, so here it stays silent and the reopen is the only finding.
test('the old Finding names HTTP 404 as content, the words survived, then a refresh answered 404 - reopen, not a pass', () => {
  const dir = quotedProject([SENTENCE], { finding: `${FINDING} Unknown plan ids return HTTP 404.` });
  refresh(dir, SAME_PAGE);
  const result = collectOne(dir, LIMITS_URL, {
    runScrape: (url) => ({ ok: true, url, title: 'Not Found', markdown: '# Not Found', statusCode: 404, transport: 'firecrawl-cli', cmd: 'stub', completeness: 'full', omitted: '' }),
    corpus: readCorpus(dir), force: true, type: 'P', transportName: 'firecrawl-cli', date: DAY3, maxRateLimitRetries: 0, sleep: () => {},
  });
  assert.equal(result.status, 'failed', 'the collector kept the 404 as a capture');
  assert.match(rowOf(dir, 'E-01').finding, /\b404\b/, 'E-01\'s Finding must name the status, or this proves nothing');
  const detail = reopened(dir, 'a page found gone after the replacement, under a Finding that names 404');
  // The day is the fail entry's real time, not the stubbed DAY3 (a fail records when it ran).
  assert.ok(detail.includes('found the page gone (HTTP 404), so no capture of it is current.'), detail);
  const { findings } = about(dir);
  assert.equal(findings.some((f) => f.rule === 'cites-gone-page'), false, `ADR-0194's exemption must be unchanged: ${JSON.stringify(findings)}`);
});

// Plan §7.3 case 1: the ledger hashes the whole capture file (`bodySha256`), so two fetches with
// equal hashes are one file's bytes, and a quote found in one is found in the other. Assert it
// never reaches the attribution: the honest equal case passes. A ledger that claims equal bytes
// for files that differ has had a capture edited after its fetch, and that still reopens.
test('7.3 case 1: equal bodySha256 never reaches the attribution - one capture named twice passes; a forged equal hash reopens', () => {
  const same = quotedProject();
  const own = rowOf(same, 'E-01').raw;
  fs.appendFileSync(resolve(same, PATHS.evidence), `| E-02 | ${DAY2} | P | ${LIMITS_URL} | The same capture, cited again. | ${own} |\n`);
  assert.equal(supersededRows(readCorpus(same)).get('E-01')?.id, 'E-02', 'E-02 must supersede E-01, or this proves nothing');
  survived(same, 'two rows naming one capture');

  const forged = quotedProject();
  const oldHash = readCorpus(forged).ledger.entries.find((e) => e.raw === own)?.bodySha256;
  const entry = writeRaw(forged, { url: LIMITS_URL, title: 'Limits', markdown: '# Limits\n\nThe free plan was withdrawn.\n',
    cmd: 'stub', statusCode: 200, transport: 'firecrawl-cli', completeness: 'full' }, { date: DAY2 });
  appendFetch(forged, { op: 'scrape', url: LIMITS_URL, type: 'P', raw: entry.file, bodySha256: oldHash, transport: 'firecrawl-cli',
    completeness: 'full', cmd: 'stub', at: `${DAY2}T00:00:00.000Z` });
  fs.appendFileSync(resolve(forged, PATHS.evidence), `| E-02 | ${DAY2} | P | ${LIMITS_URL} | Withdrawn. | ${entry.file} |\n`);
  assert.ok(reopened(forged, 'a forged equal hash').includes('The ledger records the same bytes for both captures, yet the words are in one and not the other: '
    + 'one of them was changed after its fetch, and provenance names which.'));
});

// Plan §7.3 case 3. Recheck 12 named the transport only while its outcome was a reopen; ADR-0192
// made it a pass, so until 2026-10-25 (U8 review F1) nothing failed when this case was removed.
// Here the sentence is really gone and only the transport differs, so case 3 is the first match.
test('7.3 case 3: the quote is really gone and the transport changed - the reopen names both transports', () => {
  const dir = quotedProject();
  refresh(dir, `# Limits\n\n${'Rate limits are listed on the account page now. '.repeat(30)}`, { transportName: 'http-keyless' });
  const detail = reopened(dir, 'a lost quote across transports');
  assert.ok(detail.includes(TRANSPORT_LINE), detail);
});

// ---------------------------------------------------------------- a refresh that landed elsewhere
//
// Found 2026-10-26 (Stage 7 gap audit, gap 1): a refresh that follows a redirect files its row
// under the URL the bytes came from (collect.mjs), and `supersededRows` joins rows by urlKey, so
// the cited row was never superseded - no recheck, no reopen, no gone, and a green gate over a
// page that no longer held the quoted words. The owner ruled it fixed in this PR, joined on the
// ledger's requestedUrl, with `supersededRows` unchanged (ADR-0193 decision 8). Each refresh here
// is a keyless fetch through the real collector, with only the page's answer stubbed.

const LANDED = 'https://example.invalid/';
const RENAMED = 'https://example.invalid/docs/rate-limits';
const HOMEPAGE = `# Example\n\n${'Welcome to Example. Our products have moved. '.repeat(20)}`;

/** A keyless refresh that asked for `asked` and got its bytes from `landed`; `at` is the ledger's time. */
function redirected(dir, landed, markdown, { asked = LIMITS_URL, date = DAY2, at = `${date}T10:00:00.000Z`, statusCode = 200 } = {}) {
  return collectOne(dir, asked, {
    runScrape: (url) => ({ ok: true, url: landed, title: 'Moved', markdown, statusCode, transport: 'http-keyless',
      cmd: `http-keyless scrape ${url}`, completeness: 'full', omitted: '' }),
    corpus: readCorpus(dir), force: true, type: 'P', transportName: 'http-keyless', date, now: new Date(at),
    maxRateLimitRetries: 0, sleep: () => {},
  });
}

const MOVE_LINE = (landed, day = DAY2) => `the refresh on ${day} asked for ${LIMITS_URL} and landed on ${landed}, a different page`;

test('a refresh that asked for the cited URL and landed on a homepage reopens the citation, and the gate fails (Stage 7 gap 1)', () => {
  const dir = quotedProject();
  const result = redirected(dir, LANDED, HOMEPAGE);
  assert.equal(result.status, 'collected', result.reason);
  assert.equal(rowOf(dir, 'E-02').url, LANDED, 'the collector did not file the row under the landed URL, so this proves nothing');
  assert.equal(supersededRows(readCorpus(dir)).size, 0, 'supersededRows must stay a join by URL: nothing superseded E-01');
  const detail = reopened(dir, 'a refresh that landed on a homepage', { moved: true });
  assert.ok(detail.startsWith(`U-1 rests on E-01, and ${MOVE_LINE(LANDED)}, recorded as E-02. `
    + 'Re-read it, then move the citation or record why the earlier reading still holds. '), detail);
  assert.ok(detail.includes(`E-01's quote "${SENTENCE}" is not in E-02's capture ${result.entry.file}.`), detail);
  const verdict = runPreflight(dir, { env: pluralistEnv() });
  assert.deepEqual(verdict.failures.map((f) => `${f.check}/${f.rule}`), ['evidence-supersession/cites-superseded-row'],
    `the gate must fail on the moved citation, and on nothing else: ${JSON.stringify(verdict.failures)}`);
  assert.equal(verdict.pass, false);
});

test('a refresh that landed on another URL holding the quoted words passes, and the pass names the move', () => {
  const dir = quotedProject();
  const { entry } = redirected(dir, RENAMED, SAME_PAGE);
  const discovery = fs.readFileSync(resolve(dir, PATHS.discovery));
  const pass = survived(dir, 'the quote is on the page the refresh landed on');
  assert.deepEqual([pass.superseded, pass.by, pass.capture, pass.asked, pass.landed], ['E-01', 'E-02', entry.file, LIMITS_URL, RENAMED]);
  assert.equal(pass.detail, `E-01's quoted words occur in E-02's capture ${entry.file}, and ${MOVE_LINE(RENAMED)}, recorded as E-02. `
    + `That says the words survived, not that the claim still holds. Re-read E-02 when you next touch U-1. ${LIMIT_LINE}`);
  assert.deepEqual(fs.readFileSync(resolve(dir, PATHS.discovery)), discovery, 'the recheck moved a citation');
});

test('a refresh that landed elsewhere, with no evidence row naming its capture, reopens and says so', () => {
  const dir = quotedProject();
  const { entry } = redirected(dir, RENAMED, SAME_PAGE);
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^\| E-02 \|.*\r?\n/m, ''));
  assert.equal(rowOf(dir, 'E-02'), undefined, 'the fixture did not remove E-02, so this proves nothing');
  const detail = reopened(dir, 'a landed capture no row names', { moved: true });
  assert.ok(detail.startsWith(`U-1 rests on E-01, and ${MOVE_LINE(RENAMED)}, and no evidence row names its capture ${entry.file}. `
    + 'Re-read it, then move the citation or record why the earlier reading still holds. '), detail);
});

test('a refresh that landed elsewhere, then a refresh the page answered 404 - the move reopens beside cites-gone-page, no pass', () => {
  const dir = quotedProject();
  redirected(dir, RENAMED, SAME_PAGE);
  const failed = redirected(dir, RENAMED, '# Not Found', { date: DAY3, statusCode: 404 });
  assert.equal(failed.status, 'failed', 'the collector kept the 404 as a capture');
  const { findings, mine } = about(dir);
  assert.deepEqual(mine.map((f) => [f.rule, f.severity]), [['cites-superseded-row', 'fail'], ['cites-gone-page', 'fail']], JSON.stringify(findings));
  assert.ok(mine[0].detail.includes(MOVE_LINE(RENAMED)), mine[0].detail);
  assert.ok(mine[0].detail.includes('found the page gone (HTTP 404), so no capture of it is current.'), mine[0].detail);
});

test('silent (a): asked for the cited URL, landed on it with a trailing slash - one page, an ordinary refresh', () => {
  const dir = quotedProject();
  const { entry } = redirected(dir, `${LIMITS_URL}/`, SAME_PAGE);
  assert.equal(rowOf(dir, 'E-02').url, `${LIMITS_URL}/`, 'the row is not under the slashed URL, so this proves nothing');
  const pass = survived(dir, 'a trailing slash');
  assert.equal(pass.detail, `E-01's quoted words occur in E-02's capture ${entry.file}. `
    + `That says the words survived, not that the claim still holds. Re-read E-02 when you next touch U-1. ${LIMIT_LINE}`);
  assert.equal(pass.landed, undefined, 'a trailing slash is not a move');
});

const OLD = 'https://example.invalid/limits-old';

/** A quoted project whose cited row E-02 was first captured through a redirect: asked OLD, filed under LIMITS_URL. */
function redirectFirstProject() {
  const dir = quotedProject();
  redirected(dir, LIMITS_URL, SAME_PAGE, { asked: OLD });
  assert.equal(rowOf(dir, 'E-02').url, LIMITS_URL, 'the redirect did not write E-02 under the landed URL, so this proves nothing');
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-02 \|[^|]*\|[^|]*\|[^|]*\| )[^|]*( \|)/m, `$1${FINDING} [quote: ${SENTENCE}]$2`));
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED | E-01', '| CLOSED | E-02'));
  assert.deepEqual(readCorpus(dir).unknowns[0].cites, ['E-02'], 'U-1 does not cite E-02, so this proves nothing');
  return dir;
}

test('silent (b): a row first captured through a redirect, refreshed from where it landed or through the redirect again - an ordinary refresh', () => {
  for (const asked of [LIMITS_URL, OLD]) {
    const dir = redirectFirstProject();
    const { entry } = redirected(dir, LIMITS_URL, SAME_PAGE, { asked, date: DAY3 });
    const { findings, mine } = about(dir, { cited: 'E-02' });
    assert.deepEqual(mine.map((f) => [f.rule, f.by, f.landed]), [['quote-survived-refresh', 'E-03', undefined]], `asked ${asked}: ${JSON.stringify(findings)}`);
    assert.ok(mine[0].detail.startsWith(`E-02's quoted words occur in E-03's capture ${entry.file}. That says`), mine[0].detail);
  }
});

test('silent (c): a refresh that asked for the cited URL and failed is not a move - a 404 stays cites-gone-page\'s', () => {
  const dir = quotedProject();
  const failed = redirected(dir, RENAMED, '# Not Found', { statusCode: 404 });
  assert.equal(failed.status, 'failed', 'the collector kept the 404 as a capture');
  const { findings, mine } = about(dir);
  assert.deepEqual(mine.map((f) => f.rule), ['cites-gone-page'], JSON.stringify(findings));
  // The collector files a failure under the URL it asked for, so the shape above could never look
  // like a move. A fail recorded under where it ended - asked the cited URL, filed under another -
  // is the shape that pins the scrape-only rule itself (G1-fix review 1, E): still no move.
  const other = quotedProject();
  appendFetch(other, { op: 'fail', url: RENAMED, type: 'P', transport: 'http-keyless', cmd: `http-keyless scrape ${LIMITS_URL}`,
    error: 'the page answered HTTP 404 (Not Found) - an error page is not evidence', at: `${DAY2}T10:00:00.000Z` });
  const elsewhere = about(other);
  assert.deepEqual(elsewhere.mine, [], `a failure filed under another URL was read as a move: ${JSON.stringify(elsewhere.findings)}`);
});

test('a moved page that came back - asked for directly, or reached from another address - is an ordinary refresh again', () => {
  for (const asked of [LIMITS_URL, OLD]) {
    const dir = quotedProject();
    redirected(dir, LANDED, HOMEPAGE);
    const { entry } = redirected(dir, LIMITS_URL, SAME_PAGE, { asked, date: DAY3 });
    const pass = survived(dir, `the page is back at its URL, asked for ${asked}`);
    assert.deepEqual([pass.by, pass.capture, pass.landed], ['E-03', entry.file, undefined]);
  }
});

test('a refreshed row whose page then moved is rechecked against where it landed, not against the earlier refresh', () => {
  const dir = quotedProject();
  refresh(dir, SAME_PAGE);
  assert.equal(supersededRows(readCorpus(dir)).get('E-01')?.id, 'E-02', 'E-02 must supersede E-01, or this proves nothing');
  const { entry } = redirected(dir, LANDED, HOMEPAGE, { date: DAY3 });
  const detail = reopened(dir, 'a refresh, then a move to a homepage', { moved: true });
  assert.ok(detail.startsWith(`U-1 rests on E-01, and ${MOVE_LINE(LANDED, DAY3)}, recorded as E-03. `), detail);
  assert.ok(detail.includes(`E-01's quote "${SENTENCE}" is not in E-03's capture ${entry.file}.`), detail);
});

// A row whose capture no fetch recorded has no scrape for a move to come after; provenance fails
// it already. Round 1 called this guard equivalent - true of its ledger walk, which started at
// NaN; the keyed lookup of round 2 would read every later scrape as after it.
test('a row whose capture no fetch recorded gets no move: there is no scrape of its own to come after', () => {
  const dir = quotedProject();
  const unrecorded = writeRaw(dir, { url: LIMITS_URL, title: 'Limits', markdown: `${SAME_PAGE}\n\nUnrecorded.`, statusCode: 200,
    cmd: `stub scrape ${LIMITS_URL}`, transport: 'firecrawl-cli', completeness: 'full' }, { date: DAY1 });
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-01 \|.*\| )research\/raw\/\S+( \|)\r?$/m, `$1${unrecorded.file}$2`));
  assert.equal(rowOf(dir, 'E-01').raw, unrecorded.file, 'E-01 does not name the unrecorded capture, so this proves nothing');
  redirected(dir, LANDED, HOMEPAGE);
  const { findings, mine } = about(dir);
  assert.deepEqual(mine, [], JSON.stringify(findings));
});

// G1-fix review 1, finding A: the row naming the landed capture can itself be superseded - the
// next step after seeing a move is to collect the new address directly. The recheck is against
// the newest row of that address, as an ordinary refresh's is (decisions 1-3).
test('a move holding the quote, then a direct collect of where it landed without it - rechecked against the newest row there, so it reopens', () => {
  const dir = quotedProject();
  redirected(dir, RENAMED, SAME_PAGE);
  const { entry } = redirected(dir, RENAMED, MOVED_PAGE, { asked: RENAMED, date: DAY3 });
  assert.equal(supersededRows(readCorpus(dir)).get('E-02')?.id, 'E-03', 'E-03 must supersede E-02, or this proves nothing');
  const detail = reopened(dir, 'a move, then the new address lost the quote', { moved: true });
  assert.ok(detail.startsWith(`U-1 rests on E-01, and ${MOVE_LINE(RENAMED)}, recorded as E-02 and since superseded by E-03. `), detail);
  assert.ok(detail.includes(`E-01's quote "${SENTENCE}" is not in E-03's capture ${entry.file}.`), detail);
  assert.equal(about(dir).mine[0].by, 'E-03');
  const verdict = runPreflight(dir, { env: pluralistEnv() });
  assert.deepEqual(verdict.failures.map((f) => `${f.check}/${f.rule}`), ['evidence-supersession/cites-superseded-row'], JSON.stringify(verdict.failures));
});

// Finding B, by the owner's ruling of 2026-10-26 ("Cover them"): a row first captured through a
// redirect is refreshed through the address its own fetch asked for (the plan's URL), so that
// address is joined too. Silent (b) - the redirect lands on the row's URL again - stays silent.
const THROUGH = (day, landed) => `the refresh on ${day} asked for ${OLD} - the address E-02's own fetch asked for before it landed on ${LIMITS_URL} - and landed on ${landed}, a different page`;

test('a row first captured through a redirect, whose redirect now lands on a homepage, reopens (owner ruling 2026-10-26)', () => {
  const dir = redirectFirstProject();
  const { entry } = redirected(dir, LANDED, HOMEPAGE, { asked: OLD, date: DAY3 });
  const { findings, mine } = about(dir, { cited: 'E-02' });
  assert.deepEqual(mine.map((f) => [f.rule, f.severity, f.by, f.asked, f.landed]), [['cites-superseded-row', 'fail', 'E-03', OLD, LANDED]], JSON.stringify(findings));
  assert.ok(mine[0].detail.startsWith(`U-1 rests on E-02, and ${THROUGH(DAY3, LANDED)}, recorded as E-03. `), mine[0].detail);
  assert.ok(mine[0].detail.includes(`E-02's quote "${SENTENCE}" is not in E-03's capture ${entry.file}.`), mine[0].detail);
  assert.ok(mine[0].detail.endsWith(LIMIT_LINE), mine[0].detail);
  const verdict = runPreflight(dir, { env: pluralistEnv() });
  assert.deepEqual(verdict.failures.map((f) => `${f.check}/${f.rule}`), ['evidence-supersession/cites-superseded-row'], JSON.stringify(verdict.failures));
});

// Gap 4's shape, which the same join closes without knowing what Firecrawl records on a redirect:
// a keyless row filed under where it landed, then a refresh of the plan's URL filed under that URL.
test('a keyless row filed under where its redirect landed, then a refresh filed under the address it asked for, without the quote - reopens (gap 4)', () => {
  const dir = redirectFirstProject();
  const fc = collectOne(dir, OLD, {
    runScrape: (url) => ({ ok: true, url, title: 'Limits', markdown: MOVED_PAGE, statusCode: 200, transport: 'firecrawl-cli',
      cmd: `firecrawl scrape ${url} --only-main-content --max-age 0 --format markdown,rawHtml --json`, completeness: 'full', omitted: '' }),
    corpus: readCorpus(dir), force: true, type: 'P', transportName: 'firecrawl-cli', date: DAY3, now: new Date(`${DAY3}T10:00:00.000Z`),
    maxRateLimitRetries: 0, sleep: () => {},
  });
  assert.equal(fc.status, 'collected', fc.reason);
  assert.equal(rowOf(dir, 'E-03').url, OLD, 'the refresh was not filed under the address it asked for, so this proves nothing');
  const { findings, mine } = about(dir, { cited: 'E-02' });
  assert.deepEqual(mine.map((f) => [f.rule, f.severity, f.by]), [['cites-superseded-row', 'fail', 'E-03']], JSON.stringify(findings));
  assert.ok(mine[0].detail.startsWith(`U-1 rests on E-02, and ${THROUGH(DAY3, OLD)}, recorded as E-03. `), mine[0].detail);
});

// Finding C: a 404, then a later refresh that asked for the same URL and got content at another
// one. The page moved; it is not gone (ADR-0194), so the move is judged and cites-gone-page is quiet.
// The reverse order - moved, then 404 - is two failures, pinned above.
test('a 404, then a refresh that asked for the same URL and landed elsewhere holding the quote - one pass naming the move, no gone', () => {
  const dir = quotedProject();
  const failed = redirected(dir, RENAMED, '# Not Found', { statusCode: 404 });
  assert.equal(failed.status, 'failed', 'the collector kept the 404 as a capture');
  assert.deepEqual(about(dir).mine.map((f) => f.rule), ['cites-gone-page'], 'the 404 alone must be gone, or this proves nothing');
  const { entry } = redirected(dir, RENAMED, SAME_PAGE, { date: DAY3 });
  const pass = survived(dir, 'a 404, then a move holding the quote');
  assert.deepEqual([pass.by, pass.capture, pass.landed], ['E-02', entry.file, RENAMED]);
  assert.ok(pass.detail.includes(`, and ${MOVE_LINE(RENAMED, DAY3)}, recorded as E-02. `), pass.detail);
});

// G1-fix review 2, R2-1 and R2-5: the row's own URL is the first word on its page. The address
// its own fetch asked for is read only when nothing has asked for or landed on that URL since.
// Until then the latest of the three joins won, whichever address it came through, so in L the
// row's URL lost the quote and the plan address's later move holding it PASSED (with a 404 first,
// L2, fix C had cleared the gone state through the very scrape that was then not judged), and in
// K the row's URL held the quote and one plan address's later move to a homepage reopened.
test('a redirect-first row whose own URL, asked for directly, landed elsewhere without the quote reopens, whatever the old address does later (R2-1, L and L2)', () => {
  for (const first404 of [false, true]) {
    const dir = redirectFirstProject();
    if (first404) {
      const failed = redirected(dir, RENAMED, '# Not Found', { date: '2026-10-21', statusCode: 404 });
      assert.equal(failed.status, 'failed', 'the collector kept the 404 as a capture');
    }
    const { entry } = redirected(dir, RENAMED, MOVED_PAGE, { date: DAY3 });
    redirected(dir, `${LIMITS_URL}-v2`, SAME_PAGE, { asked: OLD, date: '2026-10-24' });
    const { findings, mine } = about(dir, { cited: 'E-02' });
    assert.deepEqual(mine.map((f) => [f.rule, f.severity, f.by, f.asked, f.landed]),
      [['cites-superseded-row', 'fail', 'E-03', LIMITS_URL, RENAMED]], `404 first: ${first404}: ${JSON.stringify(findings)}`);
    assert.ok(mine[0].detail.startsWith(`U-1 rests on E-02, and ${MOVE_LINE(RENAMED, DAY3)}, recorded as E-03. `), mine[0].detail);
    assert.ok(mine[0].detail.includes(`E-02's quote "${SENTENCE}" is not in E-03's capture ${entry.file}.`), mine[0].detail);
  }
});

test('two old addresses redirect to the row\'s URL; one is re-pointed to a homepage after the other confirmed the quote there - an ordinary pass (R2-5, K)', () => {
  const dir = redirectFirstProject();
  const { entry } = redirected(dir, LIMITS_URL, SAME_PAGE, { asked: 'https://example.invalid/limits-legacy', date: DAY3 });
  redirected(dir, LANDED, HOMEPAGE, { asked: OLD, date: '2026-10-24' });
  const { findings, mine } = about(dir, { cited: 'E-02' });
  assert.deepEqual(mine.map((f) => [f.rule, f.by, f.capture, f.landed]), [['quote-survived-refresh', 'E-03', entry.file, undefined]], JSON.stringify(findings));
  assert.equal(runPreflight(dir, { env: pluralistEnv() }).pass, true);
});

/** The day of the ledger's newest entry: a failure carries the collector's own clock, not the stub's. */
const failDay = (dir) => String(readCorpus(dir).ledger.entries.at(-1).at).slice(0, 10);

// G1-fix review 2, R2-2: the page a move landed on can itself be found gone - the next step after
// seeing a move is to fetch the new address directly. Its 404 is filed under that address, which
// the row's own gone state never reads, so until round 3 the move PASSED on a capture of a page
// the newest fetch found gone. The landed page's gone state is read by ADR-0194's rule, against
// the current row of that page. A redirect that ends on a 404 is filed under the address it
// asked for (collect.mjs), so it is the row's own gone state, as before.
test('a move holding the quote, then a direct fetch of where it landed answered 404 - reopen naming the move and the gone page, no pass (R2-2)', () => {
  const dir = quotedProject();
  redirected(dir, RENAMED, SAME_PAGE);
  survived(dir, 'the move before the landed page was found gone');
  const failed = redirected(dir, RENAMED, '# Not Found', { asked: RENAMED, date: DAY3, statusCode: 404 });
  assert.equal(failed.status, 'failed', 'the collector kept the 404 as a capture');
  const detail = reopened(dir, 'a move to a page found gone since', { moved: true });
  assert.ok(detail.startsWith(`U-1 rests on E-01, and ${MOVE_LINE(RENAMED)}, recorded as E-02. `
    + 'Re-read it, then move the citation or record why the earlier reading still holds. '
    + `A refresh on ${failDay(dir)} found ${RENAMED}, where the page landed, gone (HTTP 404), so no capture of it is current. `), detail);
  const verdict = runPreflight(dir, { env: pluralistEnv() });
  assert.deepEqual(verdict.failures.map((f) => `${f.check}/${f.rule}`), ['evidence-supersession/cites-superseded-row'], JSON.stringify(verdict.failures));
  // The landed row's Finding naming the status as content does not exempt it: the question is
  // the ledger's, as for the cited row's own gone state in the recheck (U8 review F3).
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-02 \|[^|]*\|[^|]*\|[^|]*\| )[^|]*( \|)/m, '$1Unknown keys return HTTP 404.$2'));
  assert.match(rowOf(dir, 'E-02').finding, /HTTP 404/, 'E-02\'s Finding does not name the status, so this proves nothing');
  assert.equal(about(dir).mine[0]?.rule, 'cites-superseded-row', 'the landed row\'s Finding exempted its page from being gone');
});

// Found 2026-10-26 by the round-3 builder's probe (M, M2): the landed page can move on in turn.
// Asked for directly, it now lands on a homepage, and that scrape is filed under the homepage, so
// the first landing's row stayed current and the move PASSED on its capture - with a 404 at the
// landed page first, too, because the ask that moved on cleared that gone state. A move of a move
// is not followed; it reopens, naming the second move.
test('a move holding the quote, then where it landed moved on to a homepage - reopen naming both moves, with or without a 404 there first', () => {
  for (const first404 of [false, true]) {
    const dir = quotedProject();
    redirected(dir, RENAMED, SAME_PAGE);
    if (first404) redirected(dir, RENAMED, '# Not Found', { asked: RENAMED, date: DAY3, statusCode: 404 });
    redirected(dir, LANDED, HOMEPAGE, { asked: RENAMED, date: '2026-10-24' });
    const detail = reopened(dir, `a move of a move, 404 first: ${first404}`, { moved: true });
    assert.ok(detail.startsWith(`U-1 rests on E-01, and ${MOVE_LINE(RENAMED)}, recorded as E-02. `
      + 'Re-read it, then move the citation or record why the earlier reading still holds. '
      + `${RENAMED} has moved on since: the refresh on 2026-10-24 asked for ${RENAMED} and landed on ${LANDED}. `
      + 'A move after a move is not followed, so E-02\'s capture is not rechecked. '), detail);
  }
});

// G1-fix review 2, R2-3 (finding I): a redirect-first row moved through its old address, then
// that address answered 404 (filed under it). For a row whose refreshes ask its own URL, the
// same order is two failures (above); here the 404 is filed under an address the row's cell does
// not name, so `cites-gone-page` stays quiet (ADR-0194's alias consequence, unchanged) and the
// move reopens, naming that the address it came through was found gone.
test('a redirect-first row moved through its old address, then the old address answered 404 - the move reopens, no pass (R2-3)', () => {
  const dir = redirectFirstProject();
  redirected(dir, RENAMED, SAME_PAGE, { asked: OLD, date: DAY3 });
  assert.deepEqual(about(dir, { cited: 'E-02' }).mine.map((f) => f.rule), ['quote-survived-refresh'], 'the move alone must pass, or this proves nothing');
  const failed = redirected(dir, OLD, '# Not Found', { asked: OLD, date: '2026-10-24', statusCode: 404 });
  assert.equal(failed.status, 'failed', 'the collector kept the 404 as a capture');
  const { findings, mine } = about(dir, { cited: 'E-02' });
  assert.deepEqual(mine.map((f) => [f.rule, f.severity, f.by]), [['cites-superseded-row', 'fail', 'E-03']], JSON.stringify(findings));
  assert.ok(mine[0].detail.startsWith(`U-1 rests on E-02, and ${THROUGH(DAY3, RENAMED)}, recorded as E-03. `
    + 'Re-read it, then move the citation or record why the earlier reading still holds. '
    + `A refresh on ${failDay(dir)} found ${OLD}, the address the move asked for, gone (HTTP 404), so no capture of it is current. `), mine[0].detail);
  assert.equal(runPreflight(dir, { env: pluralistEnv() }).pass, false);
});

// ---------------------------------------------------------------- the real fixture (Mandate C3)
//
// docs/decisions/2026-10-25-first-quoted-refresh is the kit's first refresh of rows that carry
// quotes. Its committed state carries the researcher's review (citations moved to E-03/E-04); its
// REFRESH-RECORD.md says what the state just after the refresh was. That state is rebuilt here in
// a scratch copy - the project itself is never edited - and judged.

const DECISIONS = path.join(KIT_ROOT, '..', 'docs', 'decisions');
const FIXTURE = path.join(DECISIONS, '2026-10-25-first-quoted-refresh');
// The record: DISCOVERY.md was identical to the original project's at ab2e605, and E-03 and E-04
// carried the auto-extracted Findings, verbatim.
const ORIGINAL_DISCOVERY = path.join(DECISIONS, '2026-09-28-warc-export', 'research', 'DISCOVERY.md');
const AUTO_FINDINGS = {
  'E-03': 'NOTE: in WARC 1.0 standard (ISO 28500:2009), uri was defined as “<”',
  'E-04': 'By default, warcio creates WARC 1.0 records for maximum compatibility with existing tools.',
};

function justRefreshed({ quotes = true } = {}) {
  const dir = tempDir('fp-first-quoted-refresh-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.copyFileSync(ORIGINAL_DISCOVERY, resolve(dir, PATHS.discovery));
  corrupt(dir, PATHS.evidence, (text) => {
    let out = text;
    for (const [id, finding] of Object.entries(AUTO_FINDINGS)) {
      out = out.replace(new RegExp(`^(\\| ${id} \\|[^|]*\\|[^|]*\\|[^|]*\\| )[^|]*( \\| research/raw/[^|]+ \\|)$`, 'm'), `$1${finding}$2`);
    }
    return quotes ? out : out.replace(/ \[quote: [^\]]*\]/g, '');
  });
  const corpus = readCorpus(dir);
  assert.deepEqual(corpus.unknowns.map((u) => [u.id, u.cites]), [['U-01', ['E-01']], ['U-02', ['E-01']], ['U-03', ['E-02']]],
    'the rebuilt contract is not the one the record describes');
  assert.deepEqual(corpus.evidence.filter((r) => AUTO_FINDINGS[r.id]).map((r) => r.finding), Object.values(AUTO_FINDINGS));
  assert.equal(corpus.evidence.filter((r) => /\[quote:/.test(r.finding)).length, quotes ? 2 : 0);
  return dir;
}

function pluralistEnv() {
  const home = tempDir('fp-recheck-policy-');
  const config = path.join(home, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ evidencePolicy: 'pluralist' }));
  return { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, FETCHPROOF_CONFIG: config };
}

test('the first real quoted refresh: both quotes survived, so the three citations pass, nothing blocks, and nothing is moved', () => {
  const pairs = (findings, rule) => findings.filter((f) => f.rule === rule).map((f) => [f.row, f.superseded, f.by]);
  const expected = [['U-01', 'E-01', 'E-03'], ['U-02', 'E-01', 'E-03'], ['U-03', 'E-02', 'E-04']];

  // The same corpus with its quote markers taken out is ADR-0026's case: three reopens, as the
  // record's preflight said of the state.
  const unquoted = runCheck('evidence-supersession', snapshot(justRefreshed({ quotes: false })));
  assert.deepEqual(pairs(unquoted, 'cites-superseded-row'), expected, JSON.stringify(unquoted));

  const dir = justRefreshed();
  const discovery = fs.readFileSync(resolve(dir, PATHS.discovery));
  const evidence = fs.readFileSync(resolve(dir, PATHS.evidence));
  const verdict = runPreflight(dir, { env: pluralistEnv() });
  assert.equal(verdict.evidencePolicy, 'pluralist', 'the config did not select the policy, so this proves nothing');
  assert.deepEqual(pairs(verdict.findings, 'quote-survived-refresh'), expected, JSON.stringify(verdict.findings));
  assert.deepEqual(verdict.failures.map((f) => `${f.check}/${f.rule}: ${f.detail}`), [], 'the refreshed state still blocks');
  assert.equal(verdict.pass, true);
  assert.deepEqual(fs.readFileSync(resolve(dir, PATHS.discovery)), discovery, 'DISCOVERY.md changed on disk: a citation was moved');
  assert.deepEqual(fs.readFileSync(resolve(dir, PATHS.evidence)), evidence, 'EVIDENCE.md changed on disk');
});
