// The opt-in Wayback witness (ADR-0106). Research: docs/decisions/2026-09-30-wayback-witness -
// E-01 (the Availability API and its two documented bodies), U-02 (no documented save: the
// witness is lookup-only), U-05 (no documented rate limit: one lookup per capture, no retry).

import { test, describe, assert, fs, path, makeProject } from './harness.mjs';
import * as witness from '../lib/witness.mjs';
import { runResearch } from '../lib/research-run.mjs';
import { PATHS } from '../lib/core.mjs';

describe('witness');

// The two bodies E-01 documents, verbatim in shape.
const FOUND = { archived_snapshots: { closest: {
  available: true, url: 'http://web.archive.org/web/20130919044612/http://example.com/', timestamp: '20130919044612', status: '200',
} } };
const NONE = { archived_snapshots: {} };

test('a documented snapshot is a witness; an empty answer is a named "no snapshot"', () => {
  assert.deepEqual(witness.parseAvailability(FOUND), {
    witnessed: true, snapshot: 'http://web.archive.org/web/20130919044612/http://example.com/', timestamp: '20130919044612', status: '200',
  });
  const none = witness.parseAvailability(NONE);
  assert.equal(none.witnessed, false);
  assert.match(none.reason, /no snapshot/);
});

test('a malformed answer is "not witnessed", never a throw', () => {
  for (const body of [null, 7, 'x', [], {}, { archived_snapshots: null },
    { archived_snapshots: { closest: { available: false } } },
    { archived_snapshots: { closest: { available: true, url: 5 } } }]) {
    const r = witness.parseAvailability(body);
    assert.equal(r.witnessed, false, JSON.stringify(body));
    assert.ok(r.reason, JSON.stringify(body));
  }
});

test('the lookup asks for the snapshot closest to the capture time, in the 14-digit form', () => {
  assert.equal(witness.waybackTimestamp(new Date('2026-09-30T05:44:07Z')), '20260930054407');
  assert.equal(witness.waybackTimestamp('2026-09-30T05:44:07Z'), '20260930054407');
  assert.equal(witness.waybackTimestamp(new Date('not-a-date')), '', 'an invalid Date must not throw');
  const url = witness.requestUrl('https://docs.searxng.org/dev/search_api.html', '20260930054407');
  assert.equal(url.origin + url.pathname, 'https://archive.org/wayback/available');
  assert.equal(url.searchParams.get('url'), 'https://docs.searxng.org/dev/search_api.html');
  assert.equal(url.searchParams.get('timestamp'), '20260930054407');
});

test('lookup turns a refused or unreachable request into a named "not witnessed"', () => {
  const refused = witness.lookup('https://a.example/', { job: () => ({ ok: false, statusCode: 429, error: 'wayback returned HTTP 429' }) });
  assert.equal(refused.witnessed, false);
  assert.match(refused.reason, /429/);
  const found = witness.lookup('https://a.example/', { job: () => ({ ok: true, payload: FOUND }) });
  assert.equal(found.witnessed, true);
});

// ------------------------------------------------------------ in the research run

const fetchStub = () => ({
  name: 'stub-fetch',
  scrape: (url) => ({ ok: true, url, title: 'T', markdown: `# T\n\n${'Words about the page. '.repeat(120)}`, transport: 'stub-fetch', completeness: 'full', cmd: `stub ${url}` }),
  runScrape(url) { return this.scrape(url); },
  search: () => ({ ok: true, results: [] }),
  map: () => [],
  status: () => ({ ok: true }),
  command: () => 'stub',
});
const plan = (urls) => ({ topic: 'witness', depth: 'quick', maxScrapes: 4, refreshDays: 30, limit: 8, perQuery: 3, prefer: [], queries: [],
  urls: urls.map((url) => ({ url, type: 'P', why: 'U-1' })) });
const witnesses = (root) => {
  const file = path.join(root, PATHS.witnesses);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('without --witness, nothing is sent to the Internet Archive and no witness file appears', () => {
  const root = makeProject();
  let asked = 0;
  runResearch(root, { adapter: fetchStub(), plan: plan(['https://a.example/one']), witnessLookup: () => { asked += 1; return { witnessed: true }; } });
  assert.equal(asked, 0, 'a lookup was sent without the flag');
  assert.deepEqual(witnesses(root), []);
});

test('with --witness, each newly collected page gets one lookup and one record; a cached page gets none', () => {
  const root = makeProject();
  const asked = [];
  const lookupStub = (url, { timestamp }) => { asked.push({ url, timestamp }); return { witnessed: true, snapshot: `http://web.archive.org/web/${timestamp}/${url}`, timestamp, status: '200' }; };
  runResearch(root, { adapter: fetchStub(), plan: plan(['https://a.example/one', 'https://b.example/two']), witness: true, witnessLookup: lookupStub });
  assert.deepEqual(asked.map((a) => a.url), ['https://a.example/one', 'https://b.example/two']);
  assert.match(asked[0].timestamp, /^\d{14}$/);
  const records = witnesses(root);
  assert.equal(records.length, 2);
  assert.equal(records[0].url, 'https://a.example/one');
  assert.match(records[0].raw, /^research\/raw\/.+\.md$/, 'the record names the capture it witnesses');
  assert.equal(records[0].witnessed, true);

  asked.length = 0;
  runResearch(root, { adapter: fetchStub(), plan: plan(['https://a.example/one']), witness: true, witnessLookup: lookupStub });
  assert.deepEqual(asked, [], 'a cached page was looked up again');
});

test('a lookup that throws or fails never changes the capture or the run', () => {
  const root = makeProject();
  const run = runResearch(root, { adapter: fetchStub(), plan: plan(['https://a.example/one']), witness: true,
    witnessLookup: () => { throw new Error('socket hang up'); } });
  assert.equal(run.collected, 1, 'the capture was lost to a failed witness');
  const [record] = witnesses(root);
  assert.equal(record.witnessed, false);
  assert.match(record.reason, /socket hang up/);
});

test('a dry run looks nothing up', () => {
  const root = makeProject();
  let asked = 0;
  runResearch(root, { adapter: fetchStub(), plan: plan(['https://a.example/one']), witness: true, dryRun: true,
    witnessLookup: () => { asked += 1; return { witnessed: true }; } });
  assert.equal(asked, 0);
  assert.deepEqual(witnesses(root), []);
});
