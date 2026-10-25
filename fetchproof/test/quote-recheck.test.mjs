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
function reopened(dir, what) {
  const { findings, mine } = about(dir);
  assert.equal(mine.length, 1, `${what}: ${JSON.stringify(findings)}`);
  assert.equal(mine[0].rule, 'cites-superseded-row', `${what} passed: ${mine[0].detail}`);
  assert.equal(mine[0].severity, 'fail');
  assert.ok(mine[0].detail.startsWith(`U-1 rests on E-01, which has been superseded by ${mine[0].by} - a fresher capture of the same URL `),
    `ADR-0026's message must lead the detail: ${mine[0].detail}`);
  assert.ok(mine[0].detail.endsWith(LIMIT_LINE), `a reopen must end with what the recheck can and cannot say: ${mine[0].detail}`);
  return mine[0].detail;
}

/** Exactly one finding about U-1's citation of E-01, and it is the pass; returns it. */
function survived(dir, what) {
  const { findings, mine } = about(dir);
  assert.equal(mine.length, 1, `${what}: ${JSON.stringify(findings)}`);
  assert.equal(mine[0].rule, 'quote-survived-refresh', `${what} reopened: ${mine[0].detail}`);
  assert.equal(mine[0].severity, 'pass');
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
    + 'That says the words survived, not that the claim still holds. Re-read E-02 when you next touch U-1.');
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
  const dir = quotedProject();
  const entry = legacyRefresh(dir, `# Not Found\n\nThis page has moved. Cached text follows.\n\n${SENTENCE}\n`, { statusCode: 404 });
  assert.ok(readText(resolve(dir, entry.file)).includes(SENTENCE), 'the error page must hold the words, or this proves nothing');
  const detail = reopened(dir, 'an error page holding the words');
  assert.ok(detail.includes(`E-02's capture ${entry.file} is an HTTP 404 page - words found on an error page are not the page's.`), detail);
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
// (2d831ca), so the quote survives. Before it this line read 'cites-superseded-row'; the transport
// assertion below runs only while the outcome is a reopen.
const TRANSPORT_SPACING_OUTCOME = 'quote-survived-refresh';

test('recheck 12: Firecrawl to keyless, the quote lost only to a space before the full stop - outcome pinned, the transport named', () => {
  const dir = quotedProject();
  refresh(dir, `# Limits\n\n${'The free plan allows 10 requests per minute and includes 1,000 credits . '.repeat(30)}`, { transportName: 'http-keyless' });
  const { findings, mine } = about(dir);
  assert.equal(mine.length, 1, JSON.stringify(findings));
  assert.equal(mine[0].rule, TRANSPORT_SPACING_OUTCOME, mine[0].detail);
  if (mine[0].rule === 'cites-superseded-row') {
    assert.ok(mine[0].detail.includes('Captured by firecrawl-cli then, http-keyless now. A transport change alone can lose a quote.'), mine[0].detail);
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
