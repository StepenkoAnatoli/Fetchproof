// One URL's journey, and many URLs in one run. Offline: the adapter is a stub behind
// the runScrape seam, so no key, no credits, no network.

import { test, describe, assert, makeProject, makePassingProject, fs, path, KIT_ROOT, tempDir, requireSymlink } from './harness.mjs';
import { PATHS, resolve, readText, writeText, writeJson, today } from '../lib/core.mjs';
import { readCorpus, parseTable, cacheDecision, CAPTURE_MAX_BYTES } from '../lib/corpus.mjs';
import { HEADERS } from '../lib/core.mjs';
import { collectOne, writeRaw, writeSource, captureName, bodyHashOf } from '../lib/collect.mjs';
import { rateLimitWaitMs } from '../lib/firecrawl.mjs';
import { topicMatch } from '../lib/research-run.mjs';
import { verifyLedger, entryHash } from '../lib/provenance.mjs';
import * as checksModule from '../lib/checks.mjs';
import { supersededRows } from '../lib/checks.mjs';
import { runResearch, readPlan, rankCandidate, selectCandidates, parsePreference, urlKey, DEPTH_SCRAPES, usageSummary } from '../lib/research-run.mjs';

describe('collect');

const PAGE = `# Rate limits\n\n${'The free plan allows 10 scrape requests per minute and includes 1,000 credits. '.repeat(25)}`;

function stubAdapter({ fail = false, results = [] } = {}) {
  return {
    name: 'stub-transport',
    runScrape: (url) => (fail
      ? { ok: false, url, error: 'HTTP 429', transport: 'stub-transport', cmd: `stub scrape ${url}` }
      : {
        ok: true, url, title: 'Rate limits', markdown: PAGE, statusCode: 200,
        transport: 'stub-transport', completeness: 'full', omitted: '',
        cmd: `stub scrape ${url}`,
      }),
    search: (query) => ({ ok: true, query, cmd: `stub search ${query}`, results }),
  };
}

test('captureName is dated, slugged, and keyed by a digest of the URL', () => {
  const name = captureName('https://docs.example.com/rate-limits', { date: '2026-09-13', title: 'Rate limits' });
  assert.match(name, /^2026-09-13-rate-limits-example-[0-9a-f]{8}\.md$/);
  assert.equal(
    captureName('https://a.invalid/x', { date: '2026-01-01' }) === captureName('https://b.invalid/x', { date: '2026-01-01' }),
    false,
    'two URLs never collide on one filename',
  );
});

test('writeRaw hands back the corpus\'s own index entry', () => {
  const dir = makeProject();
  const entry = writeRaw(dir, {
    url: 'https://x.invalid/p', title: 'P', markdown: PAGE, cmd: 'stub scrape', statusCode: 200,
    transport: 'stub-transport', completeness: 'partial', omitted: 'chunk 0 of 3',
  });
  const text = readText(resolve(dir, entry.file));
  assert.match(text, /^---\nurl: https:\/\/x\.invalid\/p/);
  assert.match(text, /completeness: partial/);
  assert.match(text, /omitted: chunk 0 of 3/);
  assert.equal(entry.bytes, Buffer.byteLength(PAGE, 'utf8'));
  assert.equal(readCorpus(dir).captures.byUrl.get('https://x.invalid/p').file, entry.file);
});

test('collectOne writes the capture, the ledger entry, the evidence row and the source row', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const outcome = collectOne(dir, 'https://x.invalid/limits', {
    runScrape: stubAdapter().runScrape, corpus, usedFor: 'U-1', transportName: 'stub-transport',
  });

  assert.equal(outcome.status, 'collected');
  assert.equal(outcome.spent, 1);

  const after = readCorpus(dir);
  assert.equal(after.captures.entries.length, 1);
  assert.equal(after.evidence.length, 1);
  assert.equal(after.evidence[0].id, 'E-01');
  assert.match(after.evidence[0].finding, /10 scrape requests per minute/, 'the Finding cell arrives auto-extracted');
  assert.equal(after.ledger.entries.length, 1);
  assert.equal(after.ledger.entries[0].transport, 'stub-transport');
  assert.equal(verifyLedger(dir).ok, true);

  const sources = parseTable(readText(resolve(dir, PATHS.sources)), HEADERS.sources).rows;
  assert.equal(sources[0]['Used for'], 'U-1');
});

test('the collector stamps what the ADAPTER declared and invents neither field', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  collectOne(dir, 'https://x.invalid/partial', {
    corpus,
    runScrape: () => ({ ok: true, url: 'https://x.invalid/partial', markdown: PAGE, transport: 'http-keyless', completeness: 'partial', omitted: 'below the bar', cmd: 'x' }),
  });
  const capture = readCorpus(dir).captures.entries[0];
  assert.equal(capture.transport, 'http-keyless');
  assert.equal(capture.completeness, 'partial');
  assert.equal(capture.omitted, 'below the bar');
});

test('a failure is recorded as a fail entry and writes no capture or row', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const outcome = collectOne(dir, 'https://x.invalid/nope', { runScrape: stubAdapter({ fail: true }).runScrape, corpus });

  assert.equal(outcome.status, 'failed');
  const after = readCorpus(dir);
  assert.equal(after.captures.entries.length, 0);
  assert.equal(after.evidence.length, 0);
  assert.equal(after.ledger.entries[0].op, 'fail');
  assert.equal(after.ledger.entries[0].error, 'HTTP 429');
});

test('an adapter that THROWS becomes a fail entry, not a crashed run', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const outcome = collectOne(dir, 'https://x.invalid/boom', {
    corpus,
    runScrape: () => { throw new Error('socket hang up'); },
  });
  assert.equal(outcome.status, 'failed');
  assert.match(readCorpus(dir).ledger.entries[0].error, /socket hang up/);
});

test('a cache hit spends nothing and never touches the adapter', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  collectOne(dir, 'https://x.invalid/limits', { runScrape: stubAdapter().runScrape, corpus });

  let called = 0;
  const outcome = collectOne(dir, 'https://x.invalid/limits', {
    corpus,
    runScrape: (url) => { called += 1; return stubAdapter().runScrape(url); },
  });
  assert.equal(outcome.status, 'cached');
  assert.equal(outcome.spent, 0);
  assert.equal(called, 0);
});

test('a page whose fetch redirected is a cache hit under the URL the plan asked for', () => {
  // The capture records where the bytes came from (the landed URL); the plan keeps naming
  // the URL it asked for. Without the alias the next run missed the cache and paid for the
  // page again as a "first capture" - twice in the ledger and twice in the table (found
  // 2026-10-02, running the kit on MoonAliza: two docs.github.com pages, every run).
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const asked = 'https://x.invalid/old-path';
  const landed = 'https://x.invalid/new-path';
  const redirecting = (url) => ({ ...stubAdapter().runScrape(url), url: landed, cmd: `stub scrape ${url}` });
  const first = collectOne(dir, asked, { runScrape: redirecting, corpus, usedFor: 'U-1' });
  assert.equal(first.status, 'collected');
  assert.equal(first.entry.url, landed, 'the capture records where the bytes came from');

  let called = 0;
  const again = collectOne(dir, asked, { corpus, runScrape: (url) => { called += 1; return redirecting(url); } });
  assert.equal(again.status, 'cached', `the asked-for URL finds the capture its fetch landed on (got ${again.status}: ${again.reason})`);
  assert.equal(called, 0);
  assert.equal(again.spent, 0);
  assert.equal(collectOne(dir, asked, { corpus, dryRun: true }).status, 'cached', 'the dry run agrees, from the in-memory index');

  const fresh = readCorpus(dir);
  assert.equal(fresh.captures.byUrl.get(asked)?.file, first.entry.file, 'the index read from disk carries the alias');
  assert.equal(fresh.captures.byUrl.get(landed)?.file, first.entry.file);
  assert.equal(fresh.ledger.entries.filter((e) => e.op === 'scrape').length, 1, 'one fetch, one ledger entry');
  assert.equal(fresh.evidence.length, 1, 'one fetch, one row');
});

test('a page is a cache hit under any spelling of its URL, from the in-memory index and from disk', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const first = collectOne(dir, 'https://x.invalid/a', { runScrape: stubAdapter().runScrape, corpus });
  assert.equal(first.status, 'collected');
  let called = 0;
  for (const spelling of ['https://x.invalid/a/', 'https://WWW.x.invalid/a', 'http://x.invalid/a#frag']) {
    const again = collectOne(dir, spelling, { corpus, runScrape: (url) => { called += 1; return stubAdapter().runScrape(url); } });
    assert.equal(again.status, 'cached', `${spelling}: ${again.status} (${again.reason})`);
    assert.equal(again.entry?.file, first.entry.file);
  }
  assert.equal(called, 0);
  const fresh = readCorpus(dir);
  assert.equal(cacheDecision(fresh.captures, 'https://x.invalid/a/').hit, true, 'the index read from disk answers by key too');
  assert.equal(cacheDecision(fresh.captures, 'https://x.invalid/b').hit, false, 'another page is still another page');
  assert.equal(cacheDecision(fresh.captures, 'https://x.invalid/a?page=2').hit, false, 'a query string can be a different page');
});

// Found 2026-10-02 (break-test pass 3): a 40 MB answer from the fetch adapter was written as a
// capture, a ledger entry and an evidence row - and the corpus reader then refused the file as
// `capture-too-large` (CAPTURE_MAX_BYTES, 10 MB), blocking the gate on a page the collector
// itself had accepted. A page the reader will never read is not a capture.
test('a page over the capture size limit is a failed fetch, never a capture the reader refuses', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const huge = 'w'.repeat(CAPTURE_MAX_BYTES + 1);
  const outcome = collectOne(dir, 'https://x.invalid/huge', {
    corpus, usedFor: 'U-1',
    runScrape: (url) => ({ ...stubAdapter().runScrape(url), markdown: huge }),
  });
  assert.equal(outcome.status, 'failed', outcome.reason);
  assert.match(outcome.reason, /10 MB/);
  assert.match(outcome.reason, /over the/);
  assert.equal(fs.readdirSync(path.join(dir, PATHS.raw)).filter((f) => f.endsWith('.md')).length, 0, 'no capture written');
  const fresh = readCorpus(dir);
  assert.equal(fresh.ledger.entries.length, 1);
  assert.equal(fresh.ledger.entries[0].op, 'fail');
  assert.equal(fresh.evidence.length, 0, 'no row');
});

// Found 2026-10-02 (break-test pass 3, F6, then profiled): each collectOne re-read EVERY
// capture on disk inside the lock - parsed and MinHash-sketched it - and pushed every entry
// into the in-memory index again. 2000 pages took 585 s, 41% of it sketching pages the run
// had already indexed; the entries array held n(n+1)/2 copies. A refresh reads only what
// the snapshot does not hold, and a capture it holds is remembered once.
test('collecting many pages through one snapshot keeps one index entry per capture, and the refresh reads only new files', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const n = 30;
  for (let i = 0; i < n; i += 1) {
    collectOne(dir, `https://x.invalid/p${i}`, { corpus, runScrape: stubAdapter().runScrape });
  }
  assert.equal(corpus.captures.entries.length, n, 'one entry per capture, however many refreshes ran');
  assert.equal(new Set(corpus.captures.entries.map((e) => e.file)).size, n);
  assert.equal(readCorpus(dir).captures.entries.length, n, 'the disk agrees');
});

test('--force collects again; the cache is a decision, not a law', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  collectOne(dir, 'https://x.invalid/limits', { runScrape: stubAdapter().runScrape, corpus });
  const forced = collectOne(dir, 'https://x.invalid/limits', { runScrape: stubAdapter().runScrape, corpus, force: true, date: '2026-12-01' });
  assert.equal(forced.status, 'collected');
});

// Found 2026-10-02 (break-test pass 3, F4): `--force` the same day on a page that came back
// byte-identical reused the capture file (writeRaw never overwrites) and still appended a
// second row citing it - rows=2, ledger=2, captures=1. The second row superseded the first,
// so every unknown citing E-01 then failed evidence-supersession over content that had not
// changed. The fetch is evidence (ledger); a row is a reading, and the reading stands.
test('--force on an unchanged page records the fetch and lets its row stand; a changed page gets a new row', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const first = collectOne(dir, 'https://x.invalid/limits', { runScrape: stubAdapter().runScrape, corpus });
  assert.equal(first.row.id, 'E-01');

  const again = collectOne(dir, 'https://x.invalid/limits', { runScrape: stubAdapter().runScrape, corpus, force: true });
  assert.equal(again.status, 'collected');
  assert.equal(again.spent, 1, 'the fetch was paid for and is counted');
  assert.equal(again.row.id, 'E-01', 'the standing row is the one reported');
  assert.match(again.reason, /unchanged.*E-01 stands/);
  let fresh = readCorpus(dir);
  assert.equal(fresh.evidence.length, 1, 'one row: the content did not change');
  assert.equal(fresh.ledger.entries.filter((e) => e.op === 'scrape').length, 2, 'two fetches on record');
  assert.equal(fresh.captures.entries.length, 1, 'one capture');
  assert.equal(corpus.evidence.length, 1, 'the in-memory table agrees with the disk');

  // The page changed: a new capture beside the first, a new row, and the first is superseded.
  const changed = collectOne(dir, 'https://x.invalid/limits', {
    corpus, force: true,
    runScrape: (u) => ({ ...stubAdapter().runScrape(u), markdown: `${PAGE}\n\nUpdated today: the free plan now allows 20.` }),
  });
  assert.equal(changed.status, 'collected');
  assert.equal(changed.row.id, 'E-02');
  assert.match(changed.entry.file, /\.r2\.md$/, 'a changed page is a second capture, never an overwrite');
  fresh = readCorpus(dir);
  assert.equal(fresh.evidence.length, 2);
  assert.equal(fresh.captures.entries.length, 2);
  assert.equal(supersededRows(fresh).get('E-01')?.id, 'E-02', 'the earlier reading is superseded by the later one');
});

// Found 2026-10-03 (outside audit): the index picked the newest capture of a URL by retrieval
// DATE, and on the same date by the order `listFiles().sort()` happened to give - so twelve
// same-day revisions reopened with `.r9.md` as current (lexically after `.r12.md`), and a page
// re-titled "API v10" reopened under its "API v9" capture (`api-v10` sorts before `api-v9`).
// The collector's own run was right (`rememberCapture` makes the new capture current); the
// disk disagreed with it the moment the corpus was reopened. Same date: the ledger's order
// decides when the reader knows it, then a higher revision of the same name.
test('reopening a corpus keeps the LAST same-day capture current: by revision, and by ledger order', () => {
  const url = 'https://x.invalid/revisions';
  const dir = makeProject();
  for (let n = 1; n <= 12; n += 1) writeRaw(dir, { url, title: 'Limits', markdown: `${PAGE}\n\nrevision ${n}`, statusCode: 200 });
  const reopened = readCorpus(dir);
  assert.equal(reopened.captures.entries.length, 12);
  assert.match(reopened.captures.byUrl.get(url).file, /\.r12\.md$/, `reopened under ${reopened.captures.byUrl.get(url).file}`);
  assert.match(cacheDecision(reopened.captures, url).entry.file, /\.r12\.md$/);

  const other = makeProject();
  const corpus = readCorpus(other);
  const page = 'https://x.invalid/api';
  const titled = (title, body) => (u) => ({ ...stubAdapter().runScrape(u), title, markdown: body });
  const v9 = collectOne(other, page, { runScrape: titled('API v9', PAGE), corpus });
  const v10 = collectOne(other, page, { runScrape: titled('API v10', `${PAGE}\n\nv10`), corpus, force: true });
  assert.notEqual(v9.entry.file, v10.entry.file);
  assert.equal(corpus.captures.byUrl.get(page).file, v10.entry.file, 'the run itself must hold the new capture current');
  const again = readCorpus(other);
  assert.equal(again.captures.byUrl.get(page).file, v10.entry.file, 'reopened, the older title came back as current');
  assert.equal(cacheDecision(again.captures, page).entry.file, v10.entry.file);
});

// Found 2026-10-03 (outside audit, second round): the reopen was fixed and the RUN was not. A
// collector refreshes its snapshot under the lock before each fetch (`refreshCaptures`), and
// that path read the new captures without the ledger's order and remembered each one as
// current in filename order - so a collector whose snapshot predated another writer's twelve
// same-day revisions reported `.r9.md` as its cache hit, and "API v9" over "API v10". One
// ordering rule now, `newer`, with the ledger's rank on both paths.
test('a collector with a stale snapshot sees the LAST capture another writer saved, by revision and by ledger order', () => {
  const url = 'https://x.invalid/stale';
  const dir = makeProject();
  const stale = readCorpus(dir);                       // this collector's snapshot, taken first
  const other = readCorpus(dir);                       // another collector on the same corpus
  for (let n = 1; n <= 12; n += 1) {
    collectOne(dir, url, { corpus: other, force: true, runScrape: (u) => ({ ...stubAdapter().runScrape(u), markdown: `${PAGE}\n\nrevision ${n}` }) });
  }
  const seen = collectOne(dir, url, { corpus: stale, runScrape: stubAdapter().runScrape });
  assert.equal(seen.status, 'cached');
  assert.match(seen.entry.file, /\.r12\.md$/, `the stale collector took ${seen.entry.file} as current`);

  const page = 'https://x.invalid/stale-title';
  const dir2 = makeProject();
  const stale2 = readCorpus(dir2);
  const other2 = readCorpus(dir2);
  const titled = (title, body) => (u) => ({ ...stubAdapter().runScrape(u), title, markdown: body });
  collectOne(dir2, page, { corpus: other2, runScrape: titled('API v9', PAGE) });
  const v10 = collectOne(dir2, page, { corpus: other2, force: true, runScrape: titled('API v10', `${PAGE}\n\nv10`) });
  const seen2 = collectOne(dir2, page, { corpus: stale2, runScrape: stubAdapter().runScrape });
  assert.equal(seen2.status, 'cached');
  assert.equal(seen2.entry.file, v10.entry.file, `the stale collector took ${seen2.entry.file} as current`);
});

// Found 2026-10-03 (outside audit, fourth round): two cases where the run and the reopen still
// disagreed. (1) A -> B -> A: the third fetch REUSES the first capture's file (identical bytes
// are never written twice) and records it last in the ledger, so the reopen said A while the
// run - `rememberCapture` returning early for a known file, the refresh skipping known files -
// kept B. (2) A direct capture arriving through the refresh after a redirect alias of the same
// URL was compared by ledger rank and lost; the reopen keeps a direct capture over any alias.
// One rule now, on every path: direct over alias, the fetch that just happened, then rank.
test('refetching earlier content makes its reused capture current again, in the run and for a stale snapshot', () => {
  const url = 'https://x.invalid/aba';
  const dir = makeProject();
  const writer = readCorpus(dir);
  const stale = readCorpus(dir);
  const body = (text) => (u) => ({ ...stubAdapter().runScrape(u), markdown: `${PAGE}\n\n${text}` });
  const a1 = collectOne(dir, url, { corpus: writer, runScrape: body('A') });
  const b = collectOne(dir, url, { corpus: writer, force: true, runScrape: body('B') });
  const a2 = collectOne(dir, url, { corpus: writer, force: true, runScrape: body('A') });
  assert.equal(a2.entry.file, a1.entry.file, 'identical bytes reuse the first capture');
  assert.notEqual(b.entry.file, a1.entry.file);
  assert.equal(cacheDecision(writer.captures, url).entry.file, a1.entry.file, `the writing run holds ${cacheDecision(writer.captures, url).entry.file} current`);
  const seen = collectOne(dir, url, { corpus: stale, runScrape: stubAdapter().runScrape });
  assert.equal(seen.status, 'cached');
  assert.equal(seen.entry.file, a1.entry.file, `a stale snapshot refreshed to ${seen.entry.file}`);
  assert.equal(readCorpus(dir).captures.byUrl.get(url).file, a1.entry.file);
});

test('a direct capture stays current over a redirect alias of the same URL, through the refresh as on reopen', () => {
  const asked = 'https://x.invalid/asked';
  const landing = 'https://x.invalid/landing';
  const dir = makeProject();
  const writer = readCorpus(dir);
  const stale = readCorpus(dir);
  // A direct capture of the asked URL, titled to sort LAST; then a fetch of the same URL that
  // redirected, its capture titled to sort FIRST, so the refresh meets the alias before the direct.
  const direct = collectOne(dir, asked, { corpus: writer, runScrape: (u) => ({ ...stubAdapter().runScrape(u), title: 'Z original direct page' }) });
  collectOne(dir, asked, { corpus: writer, force: true, runScrape: (u) => ({ ...stubAdapter().runScrape(u), url: landing, title: 'A redirect landing', markdown: `${PAGE}\n\nlanded`, cmd: `stub scrape ${u}` }) });
  const reopened = readCorpus(dir);
  assert.equal(reopened.captures.byUrl.get(asked).file, direct.entry.file, 'the reopen must keep the direct capture');
  const seen = collectOne(dir, asked, { corpus: stale, runScrape: stubAdapter().runScrape });
  assert.equal(seen.status, 'cached');
  assert.equal(seen.entry.file, direct.entry.file, `the refresh let the alias displace the direct capture: ${seen.entry.file}`);
});

test('a collected page says WHY it was fetched, in words, not as a cache code', () => {
  // Found 2026-09-26 in a live-collection log: "collected https://docs.firecrawl.dev/... -
  // not-collected". The reason was cacheDecision's internal code for "no capture yet",
  // printed verbatim beside the word "collected" - a line that reads as its own contradiction.
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const first = collectOne(dir, 'https://x.invalid/limits', { runScrape: stubAdapter().runScrape, corpus });
  assert.equal(first.reason, 'first capture');
  const forced = collectOne(dir, 'https://x.invalid/limits', { runScrape: stubAdapter().runScrape, corpus, force: true });
  // The stub page is byte-identical, so the forced fetch is on record and the row stands (2026-10-02).
  assert.equal(forced.reason, 'refreshed: --force; the page is unchanged, so E-01 stands');
  // A stale refresh happens on a later day, so the capture is a new file and the row is new.
  const later = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const stale = collectOne(dir, 'https://x.invalid/limits', {
    runScrape: stubAdapter().runScrape, corpus, refreshDays: 1, date: later, now: new Date(later),
  });
  assert.match(stale.reason, /^refreshed: the last capture was \d+ days old$/);
  const preview = collectOne(dir, 'https://x.invalid/other', { runScrape: stubAdapter().runScrape, corpus, dryRun: true });
  assert.equal(preview.reason, 'would collect (first capture)');
});

test('dry-run says what would happen and writes nothing at all', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  const outcome = collectOne(dir, 'https://x.invalid/limits', { runScrape: stubAdapter().runScrape, corpus, dryRun: true });
  assert.equal(outcome.status, 'skipped');
  assert.equal(readCorpus(dir).captures.entries.length, 0);
  assert.equal(fs.existsSync(resolve(dir, PATHS.ledger)), false);
});

test('bodyHashOf is taken over the exact bytes on disk', () => {
  const dir = makeProject();
  const entry = writeRaw(dir, { url: 'https://x.invalid/p', markdown: PAGE, cmd: '', statusCode: 200 });
  const hash = bodyHashOf(dir, entry.file);
  assert.match(hash, /^[0-9a-f]{64}$/);
  fs.appendFileSync(resolve(dir, entry.file), 'x');
  assert.notEqual(bodyHashOf(dir, entry.file), hash);
});

// --- the run coordinator -----------------------------------------------------------

test('the budget tiers are named and bounded', () => {
  assert.deepEqual(Object.keys(DEPTH_SCRAPES), ['probe', 'quick', 'normal', 'deep']);
  assert.ok(DEPTH_SCRAPES.probe < DEPTH_SCRAPES.quick);
  assert.ok(DEPTH_SCRAPES.normal < DEPTH_SCRAPES.deep);
});

test('readPlan fills every default rather than handing back undefined', () => {
  const dir = makeProject();
  const plan = readPlan(dir);
  assert.equal(plan.depth, 'quick');
  assert.deepEqual(plan.queries, []);
  assert.equal(plan.refreshDays, 30);
});

test('rankCandidate prefers the page that OWNS the fact', () => {
  const prefer = ['docs.example.com'];
  assert.ok(rankCandidate('https://docs.example.com/rate-limits', { prefer }) > rankCandidate('https://blog.other.com/how-to', { prefer }));
  assert.ok(rankCandidate('https://example.com/pricing', { prefer: [] }) > rankCandidate('https://example.com/blog/post', { prefer: [] }));
  assert.ok(rankCandidate('https://example.com/login', { prefer: [] }) < 0);
});

// Found 2026-09-30 (break-test). `why` was spliced into `new RegExp(why.split(/\s+/)
// .slice(0, 2).join('|'), 'i')`, so a reason holding an unbalanced metacharacter threw a raw
// SyntaxError out of an exported ranking function, and a reason of only whitespace built the
// pattern `|` - an empty alternative, which matches every URL - so every candidate silently
// earned the bonus and the ranking became noise. Neither is reachable from the collector
// today (no caller passes `why`), which is exactly why it was still there.
const whyBonus = (url, why) => rankCandidate(url, { why }) - rankCandidate(url);

test('a reason is matched as words, never compiled as a pattern', () => {
  for (const why of ['rate limits (api)', 'a(b', '[x', '*', '\\', '(?:', 'a{2,1}', '(?<n>', '{{', '\\d+']) {
    assert.equal(whyBonus('https://example.com/zebra', why), 0, `${JSON.stringify(why)} must not decide the ranking`);
  }
  assert.equal(whyBonus('https://example.com/pricing', 'pricing tier'), 1, 'a word the URL names still scores');
  assert.equal(whyBonus('https://example.com/tier', 'pricing tier'), 1, 'either of the first two words scores');
});

test('a blank reason scores nothing, rather than scoring everything', () => {
  for (const why of ['', ' ', '   ', '\t\n']) {
    assert.equal(whyBonus('https://example.com/zebra', why), 0, JSON.stringify(why));
  }
});

// ---------------------------------------------------------------- prefer: a path on a shared host
//
// Found 2026-09-26, collect run 36279879229: dispatched with `prefer: github.com` to collect
// actions/upload-artifact's release notes, it captured an unrelated repository's Actions run
// page. On a host that serves everyone, the host is not the owner - every page on GitHub got
// the owner's bonus. The kit's topic signal caught it; the ranking should not have needed to.

const bonus = (url, prefer) => rankCandidate(url, { prefer }) - rankCandidate(url, { prefer: [] });

test('a preference with a path ranks that repository, not the whole shared host', () => {
  const prefer = ['github.com/actions/upload-artifact'];
  assert.equal(bonus('https://github.com/actions/upload-artifact/releases', prefer), 10);
  assert.equal(bonus('https://github.com/actions/upload-artifact', prefer), 10, 'the repository root is the repository');
  assert.equal(bonus('https://github.com/bitnami/support/actions/runs/24548123711', prefer), 0,
    'another repository on the same host was ranked as the owner');
  assert.equal(bonus('https://github.com/actions/upload-artifact-v2/readme', prefer), 0,
    'a path matches at a segment boundary, not as a string prefix');
  assert.equal(bonus('https://gist.github.com/actions/upload-artifact', prefer), 0,
    'a path belongs to one host; it does not extend to subdomains');
});

test('the incident, replayed: the owner is selected over a stranger on the same host', () => {
  const results = [
    { url: 'https://github.com/bitnami/support/actions/runs/24548123711' },
    { url: 'https://github.com/actions/upload-artifact/releases' },
  ];
  const [picked] = selectCandidates(results, { prefer: ['github.com/actions/upload-artifact'], perQuery: 1, seen: new Set() });
  assert.equal(picked.url, 'https://github.com/actions/upload-artifact/releases');
});

test('a preference is read the way people write it: scheme, www, case and a trailing slash are ignored', () => {
  for (const entry of ['https://github.com/actions/upload-artifact/', 'www.github.com/Actions/Upload-Artifact', 'github.com/actions/upload-artifact#readme']) {
    assert.deepEqual(parsePreference(entry), { host: 'github.com', path: '/actions/upload-artifact' }, entry);
  }
  assert.equal(bonus('https://github.com/Actions/Upload-Artifact/releases', ['github.com/actions/upload-artifact']), 10);
  assert.equal(parsePreference('  '), null, 'an empty entry is no preference, not a match-everything');
  assert.equal(parsePreference('/actions/upload-artifact'), null, 'a path with no host is no preference');
});

test('a bare domain still covers the host and its subdomains, exactly as before', () => {
  assert.deepEqual(parsePreference('tavily.com'), { host: 'tavily.com', path: '' });
  assert.equal(bonus('https://docs.tavily.com/api', ['tavily.com']), 10);
  assert.equal(bonus('https://tavily.com/pricing', ['tavily.com']), 10);
  assert.equal(bonus('https://nottavily.com/pricing', ['tavily.com']), 0, 'a suffix is not a subdomain');
});

test('every place that explains `prefer` offers the path form', () => {
  // The fix is invisible unless the person typing the preference knows a path is allowed:
  // each of these told them "domains" and nothing else, which is how github.com got typed.
  const repo = path.resolve(KIT_ROOT, '..');
  const places = {
    'collect.yml prefer input': fs.readFileSync(path.join(repo, '.github', 'workflows', 'collect.yml'), 'utf8')
      .split('\n').find((line) => /^\s+description: .*OWN the fact/.test(line)) ?? '',
    'collect-remote --help': fs.readFileSync(path.join(KIT_ROOT, 'bin', 'collect-remote.mjs'), 'utf8')
      .split('--prefer <')[1]?.split('--query')[0] ?? '',
    'MCP tool schema': fs.readFileSync(path.join(KIT_ROOT, 'lib', 'mcp.mjs'), 'utf8')
      .split('\n').find((line) => /prefer: \{ type: 'string'/.test(line)) ?? '',
  };
  for (const [where, text] of Object.entries(places)) {
    assert.ok(text, `could not find the prefer description in ${where} - this test is vacuous`);
    assert.match(text, /github\.com\/[a-z-]+\/[a-z-]+/, `${where} does not show a path on a shared host`);
  }
});

// ---------------------------------------------------------------- one page, one fetch
//
// Found 2026-09-27, collect run 36283114657: the dispatched URL .../ui-and-api was fetched,
// and then the search returned .../ui-and-api/ and it was fetched again - two credits, one
// page. Plan URLs never entered the "seen" set before searching, and the set compared
// exact strings.

test('urlKey names one page one way', () => {
  assert.equal(urlKey('HTTPS://WWW.Example.com/Path/?q=1#frag'), urlKey('https://example.com/Path?q=1'));
  assert.equal(urlKey('http://example.com/a/'), urlKey('https://example.com/a'), 'http and https serve one page');
  assert.notEqual(urlKey('https://example.com/a?page=2'), urlKey('https://example.com/a'), 'a query string can be a different page');
  assert.notEqual(urlKey('https://example.com/A'), urlKey('https://example.com/a'), 'paths are case-sensitive');
  assert.equal(urlKey('https://example.com/'), urlKey('https://example.com'), 'the root is one page');
});

test('a page given by URL is not fetched again when a search returns its other spelling', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 1, maxScrapes: 10,
    prefer: ['x.example'],
    urls: [{ url: 'https://x.example/page', why: 'U-1', type: 'S' }],
    queries: [{ q: 'the page', why: 'U-1' }],
  });
  // The variant outranks the other result on its own (the prefer bonus), so only the
  // dedupe can stop it being chosen.
  const adapter = stubAdapter({ results: [{ url: 'https://x.example/page/' }, { url: 'https://y.example/other' }] });
  const run = runResearch(dir, { adapter });
  const urls = readCorpus(dir).evidence.map((row) => row.url);
  assert.deepEqual(urls.sort(), ['https://x.example/page', 'https://y.example/other']);
  assert.equal(run.spent, 2, 'one page was paid for twice');
});

// Found 2026-10-02 (break-test pass 3): a plan naming one page in four spellings - with and
// without `www.`, a trailing slash, a fragment - fetched it four times, four ledger entries
// and four rows. The same-page rule already stopped a SEARCH result from re-fetching a plan
// URL; it never compared the plan's own URLs with each other, and the cache looked a URL up
// by its exact spelling.
test('a plan naming one page in several spellings fetches it once, and the other spellings say so', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 1, maxScrapes: 10, prefer: [], queries: [],
    urls: ['https://x.example/page', 'https://www.x.example/page/', { url: 'https://x.example/page#top', why: 'U-2' }, 'https://x.example/other'],
  });
  const run = runResearch(dir, { adapter: stubAdapter() });
  assert.equal(run.spent, 2, `one page was paid for ${run.spent - 1} times (results: ${run.results.map((r) => `${r.url}=${r.status}`).join(', ')})`);
  assert.deepEqual(readCorpus(dir).evidence.map((row) => row.url).sort(), ['https://x.example/other', 'https://x.example/page']);
  const same = run.results.filter((r) => r.status === 'skipped' && /same page/.test(r.reason));
  assert.deepEqual(same.map((r) => r.url), ['https://www.x.example/page/', 'https://x.example/page#top'], 'each other spelling is named, not dropped');
  assert.match(same[0].reason, /https:\/\/x\.example\/page/, 'the reason names the spelling that was fetched');

  // The next run names the page in a new spelling: a cache hit, nothing spent.
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 1, maxScrapes: 10, prefer: [], queries: [],
    urls: ['http://www.x.example/page/'],
  });
  const again = runResearch(dir, { adapter: stubAdapter() });
  assert.equal(again.spent, 0, 'a page in the corpus under another spelling is a cache hit');
  assert.equal(again.results[0].status, 'cached');
});

// Found 2026-10-02 running the kit five times over MoonAliza's seven finished projects: one
// plan carries a query whose `why` names U-01 and U-04, both CLOSED, and every real run would
// pay that search again (about 2 credits) and fetch up to perQuery pages nobody asked for.
// Credits already spent are not spent again (the resume rule); a search for an answered
// question is spent again on every run. `--force` means "spend again", for searches too.
function contractWith(dir, status) {
  writeText(resolve(dir, PATHS.discovery), [
    '# Discovery Contract - Fixture topic', '', '## Build intent', '', 'A fixture.', '', '## Unknowns', '',
    `| ${HEADERS.unknowns.join(' | ')} |`, `|${HEADERS.unknowns.map(() => '---').join('|')}|`,
    `| U-1 | What does the free tier allow? | Sets the budget | ${status} | ${status === 'CLOSED' ? 'E-01' : 'day one: ask'} |`,
    `| U-2 | What is the rate limit? | Sets the cadence | OPEN | |`, '',
  ].join('\n'));
}

test('a search whose unknowns are all CLOSED is not run again; --force runs it; an open unknown still searches', () => {
  const plan = (why) => ({
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 1, maxScrapes: 10, urls: [],
    queries: [{ q: 'free tier', why }],
  });
  const searching = () => {
    let searches = 0;
    const adapter = stubAdapter({ results: [{ url: 'https://docs.example.com/free-tier' }] });
    const counted = { ...adapter, search: (q) => { searches += 1; return adapter.search(q); } };
    return { counted, count: () => searches };
  };

  const dir = makeProject();
  contractWith(dir, 'CLOSED');
  writeJson(resolve(dir, PATHS.plan), plan('U-1: the tier page'));
  const { counted, count } = searching();
  const run = runResearch(dir, { adapter: counted });
  assert.equal(count(), 0, 'a search for a closed unknown was paid for again');
  assert.equal(run.spent, 0);
  assert.equal(readCorpus(dir).evidence.length, 0, 'no page was fetched for it either');
  const note = run.discovered.find((d) => d.query === 'free tier');
  assert.match(String(note?.note), /U-1 is closed/i, 'the skipped search is named in the results');
  assert.match(String(note?.note), /--force/, 'and the way to run it anyway');

  const preview = runResearch(dir, { adapter: counted, dryRun: true });
  assert.equal(preview.wouldSearch, 0, 'the dry run previews the same skip');
  assert.match(String(preview.discovered.find((d) => d.query === 'free tier')?.note), /U-1 is closed/i);

  const forced = runResearch(dir, { adapter: counted, force: true });
  assert.equal(count(), 1, '--force spends again, for a search as for a page');
  assert.equal(forced.spent, 1);

  const open = makeProject();
  contractWith(open, 'CLOSED');
  writeJson(resolve(open, PATHS.plan), plan('U-1, U-2: both'));
  const second = searching();
  runResearch(open, { adapter: second.counted });
  assert.equal(second.count(), 1, 'one cited unknown still open: the search runs');

  const untagged = makeProject();
  contractWith(untagged, 'CLOSED');
  writeJson(resolve(untagged, PATHS.plan), plan('context, no unknown named'));
  const third = searching();
  runResearch(untagged, { adapter: third.counted });
  assert.equal(third.count(), 1, 'a query that names no unknown runs as before');
});

test('two queries that find the same page each still contribute a page of their own', () => {
  // The single-provider path queued its picks without recording them, so the second query
  // took the same top result again - collected once, "cached" once - and its own next-best
  // page was never fetched.
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 1, maxScrapes: 10, urls: [],
    queries: [{ q: 'first', why: 'U-1' }, { q: 'second', why: 'U-2' }],
  });
  const adapter = stubAdapter({ results: [{ url: 'https://docs.example.com/shared' }, { url: 'https://docs.example.com/other' }] });
  runResearch(dir, { adapter });
  assert.deepEqual(readCorpus(dir).evidence.map((row) => row.url).sort(),
    ['https://docs.example.com/other', 'https://docs.example.com/shared']);
});

test('a page already in the corpus is not re-offered in another spelling, nor twice in one list', () => {
  const seen = new Set([urlKey('https://x.example/page')]);
  const picked = selectCandidates([
    { url: 'https://www.x.example/page/#top' },
    { url: 'https://z.example/p' },
    { url: 'https://z.example/p/' },
  ], { perQuery: 3, seen });
  assert.deepEqual(picked.map((c) => c.url), ['https://z.example/p']);
});

test('selectCandidates keeps the best per query and never re-offers what is collected', () => {
  const seen = new Set(['https://docs.example.com/a']);
  const picked = selectCandidates([
    { url: 'https://docs.example.com/a' },
    { url: 'https://docs.example.com/pricing' },
    { url: 'https://blog.other.com/x' },
  ], { prefer: ['docs.example.com'], perQuery: 1, seen });
  assert.deepEqual(picked.map((r) => r.url), ['https://docs.example.com/pricing']);
});

test('a run collects the plan\'s urls and stops at the budget', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'probe', refreshDays: 30, limit: 8, perQuery: 3, maxScrapes: 10, prefer: [],
    queries: [],
    urls: ['https://x.invalid/a', 'https://x.invalid/b', 'https://x.invalid/c'],
  });

  const run = runResearch(dir, { adapter: stubAdapter() });
  assert.equal(run.budget, DEPTH_SCRAPES.probe);
  assert.equal(run.spent, DEPTH_SCRAPES.probe);
  assert.ok(run.results.some((r) => r.status === 'skipped' && /budget exhausted/.test(r.reason)),
    'the third URL is named, not silently dropped');
});

// Found 2026-09-27 reading the merge in runResearch: a per-query `prefer` written as a
// string was spread into single characters ("d", "o", "c", ...) and matched nothing, and a
// top-level `prefer` written as a string was dropped by readPlan. Both silently: the run
// looked like it had a preference and ranked as if it had none.

const preferRun = (plan) => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 1, maxScrapes: 10, urls: [], ...plan,
  });
  // The competitor outranks the owner on its own (+8 for a docs/pricing path); only a
  // preference that actually works (+10) puts the owner first. The first version used a
  // blog as the competitor, which lost on its own penalty - and the test passed on the
  // broken code.
  const adapter = stubAdapter({
    results: [
      { url: 'https://other.com/docs/pricing', title: 'Other' },
      { url: 'https://owner.example.com/facts', title: 'Facts' },
    ],
  });
  runResearch(dir, { adapter });
  return readCorpus(dir).evidence.map((row) => row.url);
};

test('the prefer fixture is not vacuous: with no preference, the competitor wins', () => {
  assert.deepEqual(preferRun({ queries: [{ q: 'facts', why: 'U-1' }] }), ['https://other.com/docs/pricing']);
});

test('a per-query prefer written as a string is a preference, not a list of letters', () => {
  assert.deepEqual(preferRun({ queries: [{ q: 'facts', why: 'U-1', prefer: 'owner.example.com' }] }),
    ['https://owner.example.com/facts']);
});

test('a top-level prefer written as a string is kept, split the way the workflow input is', () => {
  assert.deepEqual(preferRun({ prefer: 'owner.example.com', queries: [{ q: 'facts', why: 'U-1' }] }),
    ['https://owner.example.com/facts']);
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), { prefer: 'docs.x.com, github.com/actions/upload-artifact  other.org' });
  assert.deepEqual(readPlan(dir).prefer, ['docs.x.com', 'github.com/actions/upload-artifact', 'other.org']);
});

test('a run fans a query out through the adapter and collects what it selects', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 2, maxScrapes: 10,
    prefer: ['docs.example.com'],
    queries: [{ q: 'example rate limits', why: 'U-1' }],
    urls: [],
  });
  const adapter = stubAdapter({
    results: [
      { url: 'https://docs.example.com/rate-limits', title: 'Limits' },
      { url: 'https://blog.other.com/opinion', title: 'Opinion' },
      { url: 'https://docs.example.com/pricing', title: 'Pricing' },
    ],
  });

  const run = runResearch(dir, { adapter });
  assert.equal(run.spent, 2, 'perQuery caps what one query may cost');
  const urls = readCorpus(dir).evidence.map((row) => row.url).sort();
  assert.deepEqual(urls, ['https://docs.example.com/pricing', 'https://docs.example.com/rate-limits']);
});

test('a dry run spends nothing and does not even search', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 2, maxScrapes: 10, prefer: [],
    queries: ['anything'], urls: ['https://x.invalid/a'],
  });
  let searched = 0;
  const adapter = { ...stubAdapter(), search: (q) => { searched += 1; return { ok: true, query: q, results: [] }; } };

  const run = runResearch(dir, { adapter, dryRun: true });
  assert.equal(run.spent, 0);
  assert.equal(searched, 0, 'a search costs credits too');
  assert.equal(readCorpus(dir).captures.entries.length, 0);
});

test('a failed search is logged to the failures file and does not stop the run', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 2, maxScrapes: 10, prefer: [],
    queries: ['anything'], urls: ['https://x.invalid/a'],
  });
  const adapter = { ...stubAdapter(), search: () => ({ ok: false, error: 'HTTP 402', results: [] }) };

  const run = runResearch(dir, { adapter });
  assert.equal(run.spent, 1, 'the plan URL is still collected');
  assert.match(readText(resolve(dir, PATHS.failures)), /HTTP 402/);
});

test('usage is written after a run that spent, and read back as a summary', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), { topic: 'x', depth: 'quick', urls: ['https://x.invalid/a'], queries: [] });
  runResearch(dir, { adapter: stubAdapter() });
  assert.match(readText(resolve(dir, PATHS.usage)), /"spent":1/);

  const usage = usageSummary(dir);
  assert.equal(usage.captures, 1);
  assert.equal(usage.scrapes, 1);
  assert.equal(usage.evidence, 1);
});

// ---------------------------------------------------------------- rate limits

test('rateLimitWaitMs reads the vendor number, and refuses to invent one', () => {
  // The real error text, verbatim from run 35715485734.
  const real = 'Rate limit exceeded. Consumed (req/min): 11, Remaining (req/min): 0. '
    + 'Upgrade your plan at https://firecrawl.dev/pricing for increased rate limits or '
    + 'please retry after 13s, resets at Tue Sep 22 2026 10:21:38 GMT+0000';
  assert.equal(rateLimitWaitMs(real), 14_000, 'the stated 13s plus a second of margin');

  // A rate limit with no stated delay still waits; one minute clears a per-minute window.
  assert.equal(rateLimitWaitMs('Rate limit exceeded'), 60_000);

  // Everything that is NOT a rate limit must return null, so ordinary failures are not
  // retried. A 404 does not become a 404 if you wait.
  assert.equal(rateLimitWaitMs('404 not found'), null);
  assert.equal(rateLimitWaitMs(''), null);
  assert.equal(rateLimitWaitMs(undefined), null);
});

test('collectOne retries a rate limit and keeps the page it eventually gets', () => {
  // Six of eight fetches were lost this way on 2026-09-22, reported as plain failures.
  const dir = makeProject();
  let calls = 0;
  const outcome = collectOne(dir, 'https://example.invalid/limited', {
    corpus: readCorpus(dir),
    runScrape: () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, url: 'https://example.invalid/limited', error: 'Rate limit exceeded. please retry after 0s, resets at now' };
      }
      return { ok: true, url: 'https://example.invalid/limited', title: 'Limited', markdown: `# Limited\n\n${'body text here. '.repeat(40)}`, statusCode: 200, transport: 'stub', completeness: 'full' };
    },
  });

  assert.equal(calls, 2, 'the rate limit must be retried, not reported');
  assert.equal(outcome.status, 'collected');
  assert.equal(outcome.waits, 1, 'the wait is counted so a slow run explains itself');
});

test('collectOne does NOT retry an ordinary failure', () => {
  // The other half. Retrying a 404 spends budget to be told the same thing again.
  const dir = makeProject();
  let calls = 0;
  const outcome = collectOne(dir, 'https://example.invalid/gone', {
    corpus: readCorpus(dir),
    runScrape: () => { calls += 1; return { ok: false, url: 'https://example.invalid/gone', error: '404 not found' }; },
  });

  assert.equal(calls, 1, 'a non-rate-limit failure must be reported immediately');
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.waits, 0);
});

test('collectOne gives up after a bounded number of rate-limit retries', () => {
  // A vendor that keeps refusing is a different problem from a busy minute, and the
  // retry runs inside the collector lock - forever here would be forever for everyone.
  const dir = makeProject();
  let calls = 0;
  const outcome = collectOne(dir, 'https://example.invalid/always', {
    corpus: readCorpus(dir),
    maxRateLimitRetries: 2,
    runScrape: () => { calls += 1; return { ok: false, url: 'https://example.invalid/always', error: 'Rate limit exceeded. please retry after 0s' }; },
  });

  assert.equal(calls, 3, 'the first attempt plus two retries');
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.reason, /Rate limit exceeded/);
});

// ---------------------------------------------------------------- topic match

test('topicMatch separates the off-topic collection from the on-topic one', () => {
  // The real pair, from the same query on 2026-09-22: SerpApi returned eight pages about US
  // financial regulation, Firecrawl returned eight about the EU Deforestation Regulation.
  // The off-topic corpus passed every structural check in this kit.
  const topic = 'EU Deforestation Regulation 2023/1115 application date large operators SMEs current after delay';

  const offTopic = [
    'Regulation D exempt offerings for small businesses. The application date for filing...',
    'Regulation Z truth in lending. Large creditors must apply...',
    'California water efficiency legislation and conservation regulation...',
  ];
  const onTopic = [
    'The EUDR, Regulation (EU) 2023/1115 on deforestation-free products. Application for large operators and SMEs...',
    'EU Deforestation Regulation 2023/1115: application postponed. Large operators and SMEs face a delay...',
  ];

  const off = topicMatch(topic, offTopic);
  const on = topicMatch(topic, onTopic);
  assert.equal(off.strong, 0, 'nothing in the off-topic set should match strongly');
  assert.ok(on.strong > 0, 'the on-topic set must match');
  assert.ok(on.best > off.best, `on-topic must outscore off-topic: ${on.best} vs ${off.best}`);
});

test('topicMatch declines to judge a topic with too few distinctive terms', () => {
  // Refusing is not scoring zero. A two-word topic makes the share 0, 0.5 or 1 and the
  // number means nothing - reporting it would invite a reader to act on noise.
  assert.equal(topicMatch('the EU', ['anything at all']), null);
  assert.equal(topicMatch('', ['x']), null);
  assert.equal(topicMatch('EU Deforestation Regulation dates', []), null, 'no captures, nothing to measure');
});

test('topicMatch REPORTS and never decides - the thresholds that were rejected', () => {
  // Pinned so nobody promotes this into a gate later. Measured 2026-09-22 across every
  // corpus in this repository:
  //
  //   per-capture >= 0.5 flags RFC 9728 in the agent-interface corpus, which never says
  //   "MCP" - and not saying it is what makes it an independent witness.
  //
  //   per-corpus "at least one strong capture" flags delivery-architecture, whose topic is
  //   "How Research-Kit should be delivered to a non-technical user" and whose evidence is
  //   GitHub Actions docs. It scores max 0.25 with zero strong captures - IDENTICAL to the
  //   genuine failure. No threshold separates them.
  //
  // So the shape of the return value is the contract: numbers, no verdict.
  const m = topicMatch('EU Deforestation Regulation 2023/1115 operators', ['deforestation regulation for operators']);
  assert.deepEqual(Object.keys(m).sort(), ['best', 'strong', 'terms']);
  assert.equal(typeof m.best, 'number');
  assert.equal(m.pass, undefined, 'a pass/fail field would make this a gate');
  assert.equal(m.severity, undefined);
});

test('topicMatch scores high on a generic topic even when the corpus is off-topic', () => {
  // The limitation, pinned so the number is never read as a quality score. The first real
  // use after shipping reported 0.92 with eight of eight above threshold, on a corpus where
  // seven of eight captures were generic "zero data retention" marketing from unrelated
  // vendors and only one was the document being researched.
  //
  // The arithmetic was right. Every one of those pages genuinely contains "data",
  // "retention", "training" and "zero" - so a topic built from common words matches
  // anything, and this function cannot tell a distinctive term from a common one.
  const genericTopic = 'terms of service data retention training on inputs outputs zero retention enterprise';
  const unrelated = [
    'Zero data retention explained: how enterprise AI vendors handle training data and service inputs and outputs.',
    'What is zero data retention? A glossary entry about training, retention and enterprise service terms.',
  ];
  const m = topicMatch(genericTopic, unrelated);
  assert.ok(m.best >= 0.5, `a generic topic matches unrelated pages: got ${m.best}`);
  assert.ok(m.strong > 0, 'and they clear the threshold, which is exactly the problem');

  // The contrast: distinctive terms behave the way the signal is useful for.
  const distinctive = 'EU Deforestation Regulation 2023/1115 operators SMEs';
  assert.equal(topicMatch(distinctive, unrelated).strong, 0,
    'a distinctive topic does NOT match unrelated pages');
});

// Found 2026-09-27: a forced re-collection on the same day wrote to the same file name,
// because the name is date + title + URL digest. A page that had changed in between
// replaced the earlier reading, and its ledger entry no longer verified - an honest
// refresh read as a capture edited after the fact.
test('a same-day re-collection of a changed page keeps the earlier capture and both verify', () => {
  const dir = makeProject();
  const page = (markdown) => ({ runScrape: (url) => ({
    ok: true, url, title: 'Rate limits', markdown, statusCode: 200,
    transport: 'stub-transport', completeness: 'full', omitted: '', cmd: `stub scrape ${url}`,
  }) });
  const url = 'https://x.invalid/limits';
  const first = collectOne(dir, url, { ...page(PAGE), corpus: readCorpus(dir), transportName: 'stub-transport' });
  const firstText = readText(resolve(dir, first.entry.file));
  const second = collectOne(dir, url, { ...page(`${PAGE}\n\nUpdated: the limit is now 20.`), corpus: readCorpus(dir), force: true, transportName: 'stub-transport' });
  assert.equal(second.status, 'collected', second.reason);
  assert.notEqual(second.entry.file, first.entry.file, 'the refresh wrote over the earlier capture');
  assert.equal(readText(resolve(dir, first.entry.file)), firstText, 'the earlier reading changed');
  assert.equal(verifyLedger(dir).ok, true, JSON.stringify(verifyLedger(dir).problems));
  assert.equal(readCorpus(dir).captures.byUrl.get(url).file, second.entry.file, 'the fresher capture is not the one the corpus holds for the URL');
});

test('a same-day re-collection of an unchanged page reuses its capture', () => {
  const dir = makeProject();
  const url = 'https://x.invalid/limits';
  const first = collectOne(dir, url, { runScrape: stubAdapter().runScrape, corpus: readCorpus(dir), transportName: 'stub-transport' });
  const second = collectOne(dir, url, { runScrape: stubAdapter().runScrape, corpus: readCorpus(dir), force: true, transportName: 'stub-transport' });
  assert.equal(second.entry.file, first.entry.file);
  assert.equal(verifyLedger(dir).ok, true);
});

// ADR-0086. Firecrawl answers exhausted credits with 402 and the text below, and the CLI
// passes on only the text (docs/decisions/2026-09-28-fetch-fallback, E-10, E-11). Until
// 2026-09-28 every page after that point was recorded as failed.
const EXHAUSTED = 'Error: Insufficient credits to perform this request. For more credits, you can upgrade your plan at https://firecrawl.dev/pricing or try changing the request limit to a lower value.';

function exhaustingAdapter({ afterScrapes = 1, searchExhausted = false } = {}) {
  let scrapes = 0;
  const ok = stubAdapter();
  return {
    name: 'firecrawl-cli',
    creditsExhausted: (text) => /insufficient credits/i.test(String(text ?? '')),
    runScrape: (url) => {
      scrapes += 1;
      if (scrapes > afterScrapes) return { ok: false, url, error: EXHAUSTED, transport: 'firecrawl-cli', cmd: `firecrawl scrape ${url}` };
      return { ...ok.runScrape(url), transport: 'firecrawl-cli' };
    },
    search: (query) => (searchExhausted
      ? { ok: false, query, error: EXHAUSTED, results: [] }
      : { ok: true, query, results: [] }),
  };
}

function keylessStub(results = []) {
  const ok = stubAdapter({ results });
  return { ...ok, name: 'http-keyless', runScrape: (url) => ({ ...ok.runScrape(url), transport: 'http-keyless' }) };
}

test('when Firecrawl runs out of credits, the rest of the run fetches through the fallback, and says so', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'normal', refreshDays: 30, limit: 8, perQuery: 3, maxScrapes: 10, prefer: [], queries: [],
    urls: ['https://x.invalid/a', 'https://x.invalid/b', 'https://x.invalid/c'],
  });
  const lines = [];
  const run = runResearch(dir, { adapter: exhaustingAdapter({ afterScrapes: 1 }), fallbackAdapter: keylessStub(), log: (l) => lines.push(l) });

  assert.deepEqual(run.results.map((r) => r.status), ['collected', 'collected', 'collected'], JSON.stringify(run.results, null, 1));
  assert.equal(run.failed, 0, 'the refused request cost nothing and is not a failed page');
  assert.deepEqual(run.fellBack, { from: 'firecrawl-cli', to: 'http-keyless', reason: 'credits exhausted' });
  assert.equal(lines.filter((l) => /credits ran out on firecrawl-cli.*http-keyless/.test(l)).length, 1, lines.join('\n'));

  // The ledger records which transport fetched each page, and keeps the refused request.
  const entries = readCorpus(dir).ledger.entries;
  assert.deepEqual(entries.filter((e) => e.op === 'scrape').map((e) => e.transport), ['firecrawl-cli', 'http-keyless', 'http-keyless']);
  assert.deepEqual(entries.filter((e) => e.op === 'fail').map((e) => e.transport), ['firecrawl-cli']);
  assert.ok(readText(resolve(dir, PATHS.failures)).includes('"op":"credits-exhausted"'));
});

test('an exhausted search falls back too, and no fallback is taken on any other failure or when none is given', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'normal', refreshDays: 30, limit: 8, perQuery: 3, maxScrapes: 10, prefer: [], urls: [],
    queries: [{ q: 'rate limits plan' }],
  });
  const found = [{ url: 'https://docs.example.com/rate-limits-plan', title: 'Rate limits plan', description: 'rate limits for each plan' }];
  const run = runResearch(dir, { adapter: exhaustingAdapter({ searchExhausted: true }), fallbackAdapter: keylessStub(found) });
  assert.equal(run.fellBack?.to, 'http-keyless');
  assert.deepEqual(run.results.map((r) => [r.status, r.url]), [['collected', found[0].url]]);

  // A page that fails for another reason is a failed page, not a reason to switch.
  const other = makeProject();
  writeJson(resolve(other, PATHS.plan), {
    topic: 'Fixture', depth: 'normal', refreshDays: 30, limit: 8, perQuery: 3, maxScrapes: 10, prefer: [], queries: [],
    urls: ['https://x.invalid/a'],
  });
  const flaky = { ...exhaustingAdapter({ afterScrapes: 0 }), runScrape: (url) => ({ ok: false, url, error: 'HTTP 500', cmd: 'x' }) };
  const r2 = runResearch(other, { adapter: flaky, fallbackAdapter: keylessStub() });
  assert.equal(r2.fellBack, null);
  assert.equal(r2.failed, 1);

  // No fallback given (the default since ADR-0129): the run stops, and the refused page is
  // neither failed nor spent - a 402 is not charged.
  const none = makeProject();
  writeJson(resolve(none, PATHS.plan), {
    topic: 'Fixture', depth: 'normal', refreshDays: 30, limit: 8, perQuery: 3, maxScrapes: 10, prefer: [], queries: [],
    urls: ['https://x.invalid/a'],
  });
  const r3 = runResearch(none, { adapter: exhaustingAdapter({ afterScrapes: 0 }) });
  assert.equal(r3.fellBack, null);
  assert.equal(r3.failed, 0);
  assert.equal(r3.stopped?.reason, 'credits exhausted');
});

// ADR-0129 (2026-10-02). The operator's rule: when the account runs out, the person decides
// between topping up and the free transports. Until then the kit decided for them - the
// switch of ADR-0086 was the default, announced in one log line of a run nobody may have
// been watching. Without `--fallback` the run now STOPS: nothing after the refusal is
// attempted, nothing is counted as failed, and the result says what is left.
test('without a fallback, exhausted credits stop the run: the rest is uncollected, not failed, not attempted', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'normal', refreshDays: 30, limit: 8, perQuery: 3, maxScrapes: 10, prefer: [], queries: [],
    urls: ['https://x.invalid/a', 'https://x.invalid/b', 'https://x.invalid/c'],
  });
  const lines = [];
  let scrapesAsked = 0;
  const adapter = exhaustingAdapter({ afterScrapes: 1 });
  const counting = { ...adapter, runScrape: (url) => { scrapesAsked += 1; return adapter.runScrape(url); } };
  const run = runResearch(dir, { adapter: counting, log: (l) => lines.push(l) });

  assert.deepEqual(run.results.map((r) => r.status), ['collected', 'uncollected', 'uncollected'], JSON.stringify(run.results, null, 1));
  assert.equal(scrapesAsked, 2, 'one page collected, one refused, and the third never asked for');
  assert.equal(run.failed, 0, 'a refusal is not charged and is not a failed page');
  assert.equal(run.spent, 1);
  assert.equal(run.collected, 1);
  assert.equal(run.fellBack, null);
  assert.deepEqual(run.stopped, { reason: 'credits exhausted', provider: 'firecrawl-cli', during: 'fetch https://x.invalid/b', uncollected: 2, skippedSearches: 0 });
  assert.equal(lines.filter((l) => /credits ran out on firecrawl-cli.*stopped/.test(l)).length, 1, lines.join('\n'));
  assert.ok(run.results[2].reason.includes('not attempted'), run.results[2].reason);
  // The one refusal is kept in the ledger; nothing after it is.
  const entries = readCorpus(dir).ledger.entries;
  assert.deepEqual(entries.filter((e) => e.op === 'scrape').map((e) => e.transport), ['firecrawl-cli']);
  assert.equal(entries.filter((e) => e.op === 'fail').length, 1);
  const stops = readText(resolve(dir, PATHS.failures)).trim().split('\n').map((l) => JSON.parse(l)).filter((f) => f.op === 'credits-exhausted');
  assert.equal(stops.length, 1);
  assert.equal(stops[0].action, 'stopped');

  // Exhaustion during a SEARCH stops the searches that follow and every fetch.
  const searched = makeProject();
  writeJson(resolve(searched, PATHS.plan), {
    topic: 'Fixture', depth: 'normal', refreshDays: 30, limit: 8, perQuery: 3, maxScrapes: 10, prefer: [],
    queries: [{ q: 'rate limits plan' }, { q: 'quota per minute' }],
    urls: ['https://x.invalid/a'],
  });
  const r2 = runResearch(searched, { adapter: exhaustingAdapter({ searchExhausted: true }) });
  assert.equal(r2.stopped?.during, 'search "rate limits plan"');
  assert.equal(r2.stopped.skippedSearches, 1);
  assert.equal(r2.stopped.uncollected, 1);
  assert.deepEqual(r2.results.map((r) => r.status), ['uncollected']);
  assert.ok(r2.discovered.some((d) => d.query === 'quota per minute' && /not run/.test(d.note ?? '')), JSON.stringify(r2.discovered));
});

// Found 2026-09-28 collecting the browser-transport research: Firecrawl returned Google's
// "Error 503 (Service Unavailable)" page for a Chromium doc, with statusCode 503 in its
// metadata, and the kit counted it "collected" and wrote an EVIDENCE row for it. The status
// was recorded and never read. An error page is a failed fetch, not a capture.
test('a page that answers an HTTP error status is a failed fetch, not evidence', () => {
  const dir = makeProject();
  const errorPage = {
    name: 'stub-transport',
    runScrape: (url) => ({ ok: true, url, title: 'Error 503 (Service Unavailable)!!1', markdown: '**503.** That’s an error.',
      statusCode: 503, transport: 'stub-transport', completeness: 'partial', omitted: 'thin', cmd: `stub scrape ${url}` }),
  };
  const outcome = collectOne(dir, 'https://x.invalid/doc', { runScrape: errorPage.runScrape, corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal(outcome.status, 'failed', JSON.stringify(outcome));
  assert.match(outcome.reason, /HTTP 503/);
  const corpus = readCorpus(dir);
  assert.equal(corpus.evidence.length, 0, 'no evidence row for an error page');
  assert.equal(corpus.captures.entries.length, 0, 'no capture written');
  assert.deepEqual(corpus.ledger.entries.map((e) => e.op), ['fail'], 'the attempt is still on record');
});

// Found 2026-09-29 on MoonAliza's secret-masking corpus: a plan URL that answered 404 was
// fetched again ten minutes later, and paid for again. A page that is gone stays gone within
// the refresh window; a transient failure is still retried, and --force retries anything.
test('a page that answered 404 is not fetched again within the refresh window', () => {
  const dir = makeProject();
  let calls = 0;
  const answer = (statusCode) => (url) => { calls += 1; return { ok: true, url, title: 'x', markdown: 'gone', statusCode, transport: 'stub-transport', completeness: 'full', cmd: `stub scrape ${url}` }; };
  const url = 'https://x.invalid/moved.go';
  assert.equal(collectOne(dir, url, { runScrape: answer(404), corpus: readCorpus(dir), transportName: 'stub-transport' }).status, 'failed');
  const again = collectOne(dir, url, { runScrape: answer(404), corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal(again.status, 'gone', JSON.stringify(again));
  assert.equal(again.spent, 0);
  assert.match(again.reason, /HTTP 404 on \d{4}-\d{2}-\d{2}.*--force/);
  assert.equal(calls, 1, 'the second attempt fetched nothing');
  assert.equal(collectOne(dir, url, { runScrape: answer(404), corpus: readCorpus(dir), transportName: 'stub-transport', force: true }).status, 'failed');
  assert.equal(calls, 2, '--force retries');
  const flaky = 'https://x.invalid/busy';
  collectOne(dir, flaky, { runScrape: answer(503), corpus: readCorpus(dir), transportName: 'stub-transport' });
  collectOne(dir, flaky, { runScrape: answer(503), corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal(calls, 4, 'a 503 is transient and is retried');
});

test('a remembered 404 takes no slot of the scrape budget', () => {
  const dir = makeProject();
  const gone = 'https://x.example/moved';
  collectOne(dir, gone, { runScrape: (url) => ({ ok: true, url, title: 'x', markdown: 'x', statusCode: 404, transport: 'stub-transport', completeness: 'full', cmd: 'stub' }), corpus: readCorpus(dir), transportName: 'stub-transport' });
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 1, maxScrapes: 1,
    urls: [{ url: gone, why: 'U-1', type: 'P' }, { url: 'https://x.example/page', why: 'U-1', type: 'P' }], queries: [],
  });
  const run = runResearch(dir, { adapter: stubAdapter() });
  assert.deepEqual(run.results.map((r) => r.status), ['gone', 'collected'], JSON.stringify(run.results.map((r) => [r.url, r.status, r.reason])));
  assert.equal(run.spent, 1);
});

// Found 2026-10-01 (break-test, PR #178): the browser transport fetches and does not search
// (ADR-0088), and two paths still called .search() on it - degrading a failed search to the
// fetch provider, and switching searches to an out-of-credits fallback - so an ordinary
// outage (DuckDuckGo's bot check) or a spent Firecrawl balance ended the run with
// "provider.search is not a function". A provider that cannot search is never asked to; the
// failure that happened is the one recorded.
test('a fetch-only transport is never asked to search, and the real search failure is the one recorded', () => {
  const failuresOf = (dir) => readText(resolve(dir, PATHS.failures)).trim().split('\n').map((line) => JSON.parse(line));
  const plan = { topic: 'Fixture', depth: 'normal', queries: [{ q: 'rate limits plan' }], urls: [] };
  const browser = { name: 'browser', runScrape: (url) => ({ ok: false, url, error: 'not fetched in this test', transport: 'browser' }) };

  // A separate search provider fails; the fetch provider beside it cannot search.
  const outage = makeProject();
  writeJson(resolve(outage, PATHS.plan), plan);
  const bot = { name: 'http-keyless', search: () => ({ ok: false, error: 'DuckDuckGo served its bot check' }) };
  runResearch(outage, { adapter: browser, searchAdapter: bot });
  const searched = failuresOf(outage).filter((f) => f.op === 'search');
  assert.ok(searched.some((f) => f.provider === 'http-keyless' && /bot check/.test(f.error)), JSON.stringify(searched));
  assert.ok(!searched.some((f) => f.provider === 'browser'), `the browser was asked to search: ${JSON.stringify(searched)}`);

  // Credits run out on the search; the fallback fetches but cannot search.
  const spent = makeProject();
  writeJson(resolve(spent, PATHS.plan), { ...plan, queries: [{ q: 'rate limits plan' }, { q: 'quota per minute' }] });
  runResearch(spent, { adapter: exhaustingAdapter({ searchExhausted: true }), fallbackAdapter: browser });
  const after = failuresOf(spent);
  assert.ok(after.some((f) => f.op === 'credits-exhausted'), JSON.stringify(after));
  assert.equal(after.filter((f) => f.op === 'search').length, 2, `each query's search failure is recorded: ${JSON.stringify(after)}`);
});

// Found 2026-10-01 (break-test, PR #180): the capture's own path was trusted. A corpus checked
// out from someone else can carry a link at the name the collector will generate - dangling,
// it was followed and the page was CREATED outside the project; pointing at a file, that file
// was read for the duplicate check - or a research/raw that is itself a link out, and every
// capture was written there. The name is the kit's: a link there is refused, as is a folder
// whose real path leaves the project. A project that merely LIVES under a link (macOS /tmp
// is one) is judged by real path and still writes.
test('a capture is never written or read through a link out of the project, and a linked project still writes', () => {
  const url = 'https://x.invalid/linked';
  const date = '2026-10-01';
  const elsewhere = tempDir('rk-capture-outside-');
  const victim = path.join(elsewhere, 'victim.txt');
  fs.writeFileSync(victim, 'DO NOT TOUCH\n');
  const name = (dir) => resolve(dir, `${PATHS.raw}/${captureName(url, { date })}`);
  const refused = (err) => err?.code === 'OUTSIDE_PROJECT' && /link/.test(err.message);

  const dangling = makeProject();
  requireSymlink(path.join(elsewhere, 'created.md'), name(dangling), 'a capture name that is a link out of the project');
  assert.throws(() => writeRaw(dangling, { url, markdown: PAGE, statusCode: 200 }, { date }), refused);
  assert.equal(fs.existsSync(path.join(elsewhere, 'created.md')), false, 'the capture was created outside the project');

  const pointing = makeProject();
  requireSymlink(victim, name(pointing), 'a capture name that is a link out of the project');
  assert.throws(() => writeRaw(pointing, { url, markdown: PAGE, statusCode: 200 }, { date }), refused);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'DO NOT TOUCH\n');

  const linkedRaw = makeProject();
  fs.rmSync(resolve(linkedRaw, PATHS.raw), { recursive: true, force: true });
  fs.mkdirSync(path.join(elsewhere, 'raw'));
  fs.symlinkSync(path.join(elsewhere, 'raw'), resolve(linkedRaw, PATHS.raw), 'junction');
  assert.throws(() => writeRaw(linkedRaw, { url, markdown: PAGE, statusCode: 200 }, { date }), refused);
  assert.deepEqual(fs.readdirSync(path.join(elsewhere, 'raw')), [], 'a capture was written through a linked research/raw');

  const real = makeProject();
  const viaLink = path.join(tempDir('rk-linked-project-'), 'project');
  fs.symlinkSync(real, viaLink, 'junction');
  const entry = writeRaw(viaLink, { url, markdown: PAGE, statusCode: 200 }, { date });
  assert.ok(fs.existsSync(resolve(real, entry.file)), 'a project reached through a link could not write its own capture');
});

// Found 2026-10-01 (break-test, PR #180): front matter is one field per line, and the values
// came from the adapter as they were - so a page title "T\nurl: https://attacker.invalid/\n
// retrieved: 1999-01-01" wrote two more fields, and the corpus indexed the capture under a URL
// and date the ledger never recorded. Each value is one line now; the page itself is evidence
// and stays byte for byte.
test('a value with a line break cannot add a field to a capture\'s front matter', async () => {
  const { parseCapture } = await import('../lib/corpus.mjs');
  const dir = makeProject();
  const url = 'https://x.invalid/metadata';
  const body = `${PAGE}\nretrieved: 1999-01-01\nurl: https://in-the-body.invalid/\n`;
  const entry = writeRaw(dir, {
    url,
    title: 'A title\nurl: https://attacker.invalid/claimed\r\nretrieved: 1999-01-01',
    cmd: 'collector\ntransport: forged',
    statusCode: '200\ncompleteness: full',
    transport: 'stub',
    completeness: 'partial',
    omitted: 'first line\nsecond line',
    markdown: body,
  }, { date: '2026-10-01' });
  const text = readText(resolve(dir, entry.file));
  const { front } = parseCapture(text);
  assert.equal(front.url, url, 'a title replaced the URL the capture records');
  assert.equal(front.retrieved, '2026-10-01');
  assert.equal(front.transport, 'stub');
  assert.equal(front.completeness, 'partial');
  for (const key of ['title', 'command', 'omitted', 'statusCode']) assert.doesNotMatch(String(front[key]), /[\r\n]/, `${key} spans lines`);
  assert.ok(text.endsWith(`---\n${body}\n`), 'the page body was changed');
  assert.equal(readCorpus(dir).captures.byUrl.get(url)?.file, entry.file, 'the corpus does not index the capture under its own URL');
});

// Found 2026-10-01 (break-test, PR #180): the wait came straight from the vendor's text, and
// "retry after 999999999999s" is 31,000 years - slept in collectOne and searchPatiently while
// the corpus lock is held, so every other run on this project would wait too. A minute clears
// a per-minute window, which is what the documented limit is.
test('a vendor-stated rate-limit wait is capped at one minute', () => {
  assert.equal(rateLimitWaitMs('Rate limit exceeded; please retry after 999999999999s'), 60_000);
  assert.equal(rateLimitWaitMs('Rate limit exceeded; retry after 59s'), 60_000, 'a stated wait under the cap is kept');
  assert.equal(rateLimitWaitMs('Rate limit exceeded; retry after 5s'), 6_000);
});

// Found 2026-10-01 (break-test, PR #180): a search result's URL is the vendor's text, and
// selectCandidates queued `javascript:` and `file:` rows beside real pages - the browser
// transport hands a queued URL to Chromium as it is. Plan URLs were checked; search results
// were not. Only an http(s) URL with a host reaches a fetch adapter.
test('only an http(s) search result with a host is queued for a fetch', () => {
  const rows = ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'ftp://ftp.example/r', 'https://', 'not a url',
    'https://docs.example.com/rate-limits', 'http://plain.example/rate-limits']
    .map((url) => ({ url, title: 'Rate limits' }));
  assert.deepEqual(selectCandidates(rows, { perQuery: 10 }).map((row) => row.url),
    ['https://docs.example.com/rate-limits', 'http://plain.example/rate-limits']);
});

// Found 2026-10-02 committing a decision corpus: a keyless capture of copyright.gov carried
// the CR bytes the page was served with, the ledger hashed them, and the scaffold's own
// .gitattributes (research/raw/* text eol=lf) made git store the file as LF - so a fresh
// clone failed handoff with "does not match the hash recorded at fetch" on a capture nobody
// had touched. The attributes file says what the design assumed: the hash is over LF bytes.
// The writer now makes that true, whatever the transport received.
test('a capture is written with LF line endings only, so git normalisation cannot change the bytes the ledger hashed', () => {
  const dir = makeProject();
  const entry = writeRaw(dir, { url: 'https://x.invalid/crlf', markdown: '# Title\r\n\r\nline one\r\nline two\rline three\n', cmd: 'x', transport: 'http-keyless', completeness: 'full' });
  const text = readText(resolve(dir, entry.file));
  assert.equal(text.includes('\r'), false, 'a CR survived into the capture');
  assert.ok(text.includes('\n---\n# Title\n\nline one\nline two\nline three\n'), JSON.stringify(text.slice(-60)));
  assert.equal(entry.bytes, Buffer.byteLength('# Title\n\nline one\nline two\nline three\n', 'utf8'), 'bytes counts the normalised body');
});

// ADR-0139: a vendor's cached answer travels into the capture's front matter and the ledger.
test('ADR-0139: a cached vendor answer is written into the capture and its ledger entry', () => {
  const dir = makeProject();
  const url = 'https://x.invalid/cached';
  const scrape = (u) => ({ ok: true, url: u, title: 'Cached', markdown: `# Cached\n\n${'The free plan allows 10 requests per minute. '.repeat(40)}`, statusCode: 200,
    transport: 'stub-transport', completeness: 'full', omitted: '', cmd: `stub scrape ${u}`, cacheState: 'hit', cachedAt: '2026-10-02T16:46:39.718Z' });
  const outcome = collectOne(dir, url, { runScrape: scrape, corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal(outcome.status, 'collected', outcome.reason);
  const capture = readText(resolve(dir, outcome.entry.file));
  assert.match(capture, /^cacheState: hit$/m, capture.slice(0, 400));
  assert.match(capture, /^cachedAt: 2026-10-02T16:46:39\.718Z$/m);
  const entry = readCorpus(dir).ledger.entries.at(-1);
  assert.equal(entry.cacheState, 'hit');
  assert.equal(entry.cachedAt, '2026-10-02T16:46:39.718Z');
  // A live answer writes neither field.
  const live = collectOne(dir, 'https://x.invalid/live', { runScrape: (u) => ({ ...scrape(u), cacheState: '', cachedAt: '' }), corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.doesNotMatch(readText(resolve(dir, live.entry.file)), /cacheState|cachedAt/);
  assert.equal('cacheState' in readCorpus(dir).ledger.entries.at(-1), false);
});

// ADR-0140 (gap audit 2026-10-03, rank 3): the text a capture was converted from is kept beside
// it as `<capture>.source.html`, named and hashed in the ledger, verified like the capture,
// and never a capture itself.
test('ADR-0140: a source is written beside the capture, named in the ledger, verified, and never indexed as a capture', () => {
  const dir = makeProject();
  const url = 'https://x.invalid/limits';
  const html = `<html>\r\n<body><main><p>${'The free plan allows 10 requests per minute. '.repeat(40)}</p></main></body>\r\n</html>`;
  const scrape = (u) => ({ ok: true, url: u, title: 'Limits', markdown: `# Limits\n\n${'The free plan allows 10 requests per minute. '.repeat(40)}`, source: html, statusCode: 200,
    transport: 'stub-transport', completeness: 'full', omitted: '', cmd: `stub scrape ${u}` });
  const outcome = collectOne(dir, url, { runScrape: scrape, corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal(outcome.status, 'collected', outcome.reason);
  const sibling = outcome.entry.file.replace(/\.md$/, '.source.html');
  const kept = readText(resolve(dir, sibling));
  assert.equal(kept, html.replace(/\r\n/g, '\n'), 'the source is kept LF-folded, like the body');
  const corpus = readCorpus(dir);
  const entry = corpus.ledger.entries.at(-1);
  assert.equal(entry.source, sibling);
  assert.equal(entry.sourceSha256, bodyHashOf(dir, sibling));
  assert.equal(corpus.captures.entries.some((e) => e.file === sibling), false, 'a source is not a capture');
  assert.deepEqual(corpus.problems.filter((p) => /source/.test(JSON.stringify(p))), []);
  assert.equal(verifyLedger(dir, { corpus }).ok, true, JSON.stringify(verifyLedger(dir, { corpus }).problems));
  // The gate names nothing about the sibling: not uncited, not dangling.
  const { runChecks } = checksModule;
  const findings = runChecks(corpus, { localHooksPath: null }).filter((f) => /source\.html/.test(f.detail));
  assert.deepEqual(findings, [], JSON.stringify(findings));

  // Edited after the fetch: refused by name, like a capture. Deleted: missing, like a capture.
  writeText(resolve(dir, sibling), `${kept}<!-- edited -->`);
  const edited = verifyLedger(dir, { corpus: readCorpus(dir) });
  assert.ok(edited.problems.some((p) => p.rule === 'body-unmodified' && p.file === sibling), JSON.stringify(edited.problems));
  fs.unlinkSync(resolve(dir, sibling));
  const gone = verifyLedger(dir, { corpus: readCorpus(dir) });
  assert.ok(gone.problems.some((p) => p.rule === 'raw-missing' && p.file === sibling), JSON.stringify(gone.problems));
});

test('ADR-0140: no source is kept for a verbatim answer, an absent one, an oversized one, or a sibling that already differs', () => {
  const dir = makeProject();
  const markdown = `# Limits\n\n${'The free plan allows 10 requests per minute. '.repeat(40)}`;
  const base = (u, extra) => ({ ok: true, url: u, title: 'Limits', markdown, statusCode: 200, transport: 'stub-transport', completeness: 'full', omitted: '', cmd: `stub scrape ${u}`, ...extra });
  const entryOf = () => readCorpus(dir).ledger.entries.at(-1);
  const verbatim = collectOne(dir, 'https://x.invalid/text', { runScrape: (u) => base(u, { source: markdown }), corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal(verbatim.status, 'collected');
  assert.equal('source' in entryOf(), false, 'a source that is the capture is not kept twice');
  assert.equal(fs.existsSync(resolve(dir, verbatim.entry.file.replace(/\.md$/, '.source.html'))), false);
  const absent = collectOne(dir, 'https://x.invalid/none', { runScrape: (u) => base(u, {}), corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal('source' in entryOf(), false);
  assert.equal(fs.existsSync(resolve(dir, absent.entry.file.replace(/\.md$/, '.source.html'))), false);
  const big = collectOne(dir, 'https://x.invalid/big', { runScrape: (u) => base(u, { source: `<p>${'x'.repeat(CAPTURE_MAX_BYTES + 10)}</p>` }), corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal(big.status, 'collected', 'an oversized source does not refuse the capture');
  assert.equal('source' in entryOf(), false);
  // Same markdown, same day, a different source: the capture file is reused and the sibling
  // is not overwritten; the second fetch names no source.
  const first = collectOne(dir, 'https://x.invalid/same', { runScrape: (u) => base(u, { source: '<html>one</html>' }), corpus: readCorpus(dir), transportName: 'stub-transport' });
  const sibling = first.entry.file.replace(/\.md$/, '.source.html');
  assert.equal(readText(resolve(dir, sibling)), '<html>one</html>');
  const second = collectOne(dir, 'https://x.invalid/same', { runScrape: (u) => base(u, { source: '<html>two</html>' }), corpus: readCorpus(dir), force: true, transportName: 'stub-transport' });
  assert.equal(second.entry.file, first.entry.file, 'identical text reuses the capture');
  assert.equal(readText(resolve(dir, sibling)), '<html>one</html>', 'the first source stands');
  assert.equal('source' in entryOf(), false, 'the second fetch names no source it did not write');
  assert.equal(verifyLedger(dir, { corpus: readCorpus(dir) }).ok, true);
});


// Breaker review of bed6bc0 (2026-10-04): a link planted at the sibling's name made `writeSource`
// throw AFTER the capture was written, leaving an orphan capture with no ledger entry that the
// next run took for a cache hit; and an oversized source vanished without a trace.
// Breaker finding (2026-10-04): a link planted at the sibling's name. Two links, because
// they test two different guards: a DANGLING link is caught only by the path check (a
// write through it would create a file outside the project), while a link to an existing
// file is also caught by the "sibling already differs" rule. The targets live in the
// test's own scratch, never at a fixed host path - Windows stores a POSIX absolute target
// resolved against the current drive (`/etc/hostname` read back as `D:\etc\hostname`, CI
// 2026-10-04) - so the assertions compare real paths, and the links are made through
// requireSymlink: a host that refuses file symlinks reports UNSUP, not red.
test('ADR-0140: a sibling that cannot be written leaves the fetch ledgered without a source', () => {
  const markdown = `# Limits\n\n${'The free plan allows 10 requests per minute. '.repeat(40)}`;
  const base = (u, extra) => ({ ok: true, url: u, title: 'Limits', markdown, statusCode: 200, transport: 'stub-transport', completeness: 'full', omitted: '', cmd: `stub scrape ${u}`, ...extra });
  const elsewhere = tempDir('rk-source-outside-');
  const collect = (dir, url) => {
    const outcome = collectOne(dir, url, { runScrape: (u) => base(u, { source: '<html>x</html>' }), corpus: readCorpus(dir), transportName: 'stub-transport' });
    assert.equal(outcome.status, 'collected', outcome.reason);
    const entry = readCorpus(dir).ledger.entries.at(-1);
    assert.equal(entry.raw, outcome.entry.file, 'the fetch is in the ledger');
    assert.equal('source' in entry, false, 'a sibling that could not be written is not named');
    assert.match(entry.sourceOmitted, /outside|link|not kept/i, entry.sourceOmitted);
    assert.equal(verifyLedger(dir, { corpus: readCorpus(dir) }).ok, true);
    return entry;
  };
  const siblingName = (url) => captureName(url, { date: today(), title: 'Limits' }).replace(/\.md$/, '.source.html');

  const dangling = makeProject();
  const url = 'https://x.invalid/dangling';
  const danglingLink = resolve(dangling, `${PATHS.raw}/${siblingName(url)}`);
  requireSymlink(path.join(elsewhere, 'created.html'), danglingLink, 'a source name that is a link out of the project');
  const entry = collect(dangling, url);
  assert.match(entry.sourceOmitted, /could not be written/, 'a dangling link is refused by the path guard, not by content');
  assert.equal(fs.existsSync(path.join(elsewhere, 'created.html')), false, 'the source was written through the link, outside the project');
  assert.equal(fs.lstatSync(danglingLink).isSymbolicLink(), true, 'the link was replaced');

  const pointing = makeProject();
  const victim = path.join(elsewhere, 'victim.txt');
  fs.writeFileSync(victim, 'DO NOT TOUCH\n');
  const url2 = 'https://x.invalid/pointing';
  const link = resolve(pointing, `${PATHS.raw}/${siblingName(url2)}`);
  requireSymlink(victim, link, 'a source name that is a link out of the project');
  collect(pointing, url2);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'the link was replaced');
  assert.equal(fs.realpathSync(link), fs.realpathSync(victim), 'the link was redirected');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'DO NOT TOUCH\n', 'the link was followed');
});

test('ADR-0140: an oversized source is not kept, and the omission names the limit', () => {
  const dir = makeProject();
  const markdown = `# Limits\n\n${'The free plan allows 10 requests per minute. '.repeat(40)}`;
  const big = collectOne(dir, 'https://x.invalid/big', { runScrape: (u) => ({ ok: true, url: u, title: 'Limits', markdown, statusCode: 200, transport: 'stub-transport', completeness: 'full', omitted: '', cmd: `stub scrape ${u}`, source: `<p>${'x'.repeat(CAPTURE_MAX_BYTES + 10)}</p>` }), corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal(big.status, 'collected', big.reason);
  const bigEntry = readCorpus(dir).ledger.entries.at(-1);
  assert.equal('source' in bigEntry, false);
  assert.match(bigEntry.sourceOmitted, /CAPTURE_MAX_BYTES|MB/, bigEntry.sourceOmitted);
  assert.deepEqual(fs.readdirSync(resolve(dir, PATHS.raw)).filter((f) => f.endsWith('.source.html')), [], 'an oversized source was written');
  assert.equal(verifyLedger(dir, { corpus: readCorpus(dir) }).ok, true);
});

// Break-test pass 4, F4 (2026-10-04): `verifyLedger` skipped the hash check for ANY named file
// whose entry carried no hash - a rule written for captures of the first ledgers, which have
// none. A rechained ledger that names a source but drops its `sourceSha256` therefore passed
// with the sibling altered: a verifier that cannot verify a source must say so, never nod.
test('ADR-0140: a ledger entry that names a source without its hash is refused, not skipped', () => {
  const dir = makeProject();
  const url = 'https://x.invalid/unhashed';
  const markdown = `# Limits\n\n${'The free plan allows 10 requests per minute. '.repeat(40)}`;
  const outcome = collectOne(dir, url, { runScrape: (u) => ({ ok: true, url: u, title: 'Limits', markdown, source: '<html>x</html>', statusCode: 200, transport: 'stub-transport', completeness: 'full', omitted: '', cmd: `stub scrape ${u}` }), corpus: readCorpus(dir), transportName: 'stub-transport' });
  assert.equal(outcome.status, 'collected', outcome.reason);
  const ledger = resolve(dir, 'research/raw/.fetches.jsonl');
  const entries = readText(ledger).trim().split('\n').map((line) => JSON.parse(line));
  const last = entries.at(-1);
  assert.ok(last.source && last.sourceSha256, 'the fixture entry names a hashed source');
  delete last.sourceSha256;
  last.entrySha256 = entryHash(last);                       // a forged chain, rehashed so chain-intact holds
  fs.writeFileSync(ledger, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.writeFileSync(resolve(dir, last.source), '<html>TAMPERED</html>\n');
  const chain = verifyLedger(dir, { corpus: readCorpus(dir) });
  assert.equal(chain.ok, false, 'an unhashed source passed verification with its sibling altered');
  const named = chain.problems.filter((p) => p.file === last.source);
  assert.ok(named.some((p) => p.rule === 'body-unmodified' && p.kind === 'unhashed'), JSON.stringify(chain.problems));
});

// Mutation audit (2026-10-04): the guard against a sibling name that is the capture's own.
test('ADR-0140: writeSource never writes at the capture\'s own path', () => {
  const dir = makeProject();
  assert.equal(writeSource(dir, 'research/raw/2026-01-01-x.txt', '<html>src</html>', 'md body'), null);
  assert.equal(fs.existsSync(resolve(dir, 'research/raw/2026-01-01-x.txt')), false);
});

function searchCacheFixture({ seedDate = '2026-08-01', fresherAlias = false, force = false,
  searchAlias = false, extraPage = false, duplicateQueries = false, explicitExtra = false } = {}) {
  const dir = makeProject();
  const known = 'https://x.invalid/rate-limits';
  const alias = 'http://www.x.invalid/rate-limits/';
  const extra = 'https://y.invalid/rate-limits';
  const now = new Date('2026-10-08T12:00:00Z');
  const seed = (url, date) => collectOne(dir, url, {
    corpus: readCorpus(dir), runScrape: stubAdapter().runScrape, transportName: 'stub-transport',
    date, now: new Date(`${date}T12:00:00Z`), force: true,
  });
  assert.equal(seed(known, seedDate).status, 'collected');
  if (fresherAlias) assert.equal(seed(alias, '2026-10-08').status, 'collected');
  const corpus = readCorpus(dir);
  const searchUrl = searchAlias ? alias : known;
  const before = cacheDecision(corpus.captures, searchUrl, { refreshDays: 30, force, now });
  if (fresherAlias) assert.equal(cacheDecision(corpus.captures, alias, { refreshDays: 30, now }).hit, true,
    'the newer alias is fresh while the candidate exact spelling is stale');
  const searches = [];
  const scrapes = [];
  const adapter = {
    name: 'stub-transport',
    search: (query) => {
      searches.push(query);
      return { ok: true, query, cmd: `stub search ${query}`, results: [
        { url: searchUrl, title: 'Rate limits', description: 'Rate limits fixture' },
        ...(extraPage ? [
          { url: extra, title: 'Rate limits', description: 'Rate limits fixture' },
          { url: 'http://www.y.invalid/rate-limits/', title: 'Rate limits', description: 'Rate limits fixture' },
        ] : []),
      ] };
    },
    runScrape: (url) => { scrapes.push(url); return stubAdapter().runScrape(url); },
  };
  const plan = {
    topic: 'Fixture', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 1, maxScrapes: 1,
    prefer: ['x.invalid'], urls: explicitExtra ? [extra] : [],
    queries: duplicateQueries ? ['rate limits', 'limits rate'] : ['rate limits'],
  };
  const run = runResearch(dir, { adapter, plan, force, now, date: '2026-10-08', maxRateLimitRetries: 0 });
  assert.equal(verifyLedger(dir).ok, true, 'the synthetic collection must remain ledgered');
  return { run, before, searches, scrapes, searchUrl, extra };
}

test('a stale search-found capture reaches the existing freshness decision under each spelling', () => {
  for (const options of [{}, { searchAlias: true }, { fresherAlias: true }]) {
    const fixture = searchCacheFixture(options);
    assert.equal(fixture.before.reason, 'stale');
    assert.equal(fixture.searches.length, 1);
    assert.deepEqual(fixture.scrapes, [fixture.searchUrl], 'an existing stale capture was removed before cache judgment');
    assert.equal(fixture.run.attempts, 1);
    assert.equal(fixture.run.collected, 1);
  }
});

test('force recollects a search-found fresh capture without changing URL identity', () => {
  for (const searchAlias of [false, true]) {
    const fixture = searchCacheFixture({ seedDate: '2026-10-08', force: true, searchAlias });
    assert.equal(fixture.before.reason, 'forced');
    assert.equal(fixture.searches.length, 1);
    assert.deepEqual(fixture.scrapes, [fixture.searchUrl], 'force searched but silently excluded the page it found');
    assert.equal(fixture.run.attempts, 1);
    assert.equal(fixture.run.collected, 1);
  }
});

test('fresh search hits leave selection room while same-run and plan aliases stay deduplicated', () => {
  const fresh = searchCacheFixture({ seedDate: '2026-10-08' });
  assert.equal(fresh.before.hit, true);
  assert.deepEqual(fresh.scrapes, [], 'a fresh result remains free to reuse');
  assert.equal(fresh.run.attempts, 0);
  for (const explicitExtra of [false, true]) {
    const fixture = searchCacheFixture({ seedDate: '2026-10-08', extraPage: true, duplicateQueries: true, explicitExtra });
    assert.deepEqual(fixture.scrapes, [fixture.extra], 'fresh known results or aliases displaced the one eligible page');
    assert.equal(fixture.searches.length, 2);
    assert.equal(fixture.run.attempts, 1);
    assert.equal(fixture.run.spent, 1);
    assert.equal(fixture.run.overBudget, 0, 'a duplicate must not consume another budget slot');
  }
});
