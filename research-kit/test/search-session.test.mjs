// The search session on its own (ADR-0135): two fake providers, no corpus, no disk. The
// questions a coordinator cannot answer for itself - which meter a search landed on, which
// provider a failure is charged to, when the fetch provider is asked instead - are asked here
// once, so `runResearch` and `decompose` are tested for what they DO with an answer and not
// for how it was obtained.

import { test, describe, assert } from './harness.mjs';
import { searchSession, searchPatiently, mergeByRank } from '../lib/search-session.mjs';
import { mergeByRank as viaResearchRun, searchPatiently as patientlyViaResearchRun } from '../lib/research-run.mjs';

describe('search-session');

const rows = (prefix, n) => Array.from({ length: n }, (_, i) => ({ url: `https://${prefix}.example/${i + 1}`, title: `${prefix} ${i + 1}`, position: i + 1 }));

/** A search provider: answers `results` once per ask, or fails with each `fail` in turn. */
function provider({ name, results = rows(name, 2), fail = [], used = 1, credits = null, searchable = true } = {}) {
  const calls = [];
  const failures = [...fail];
  const p = { name, calls };
  if (searchable) {
    p.search = (text, opts) => {
      calls.push({ text, ...opts });
      const error = failures.shift();
      if (error) return { ok: false, query: text, results: [], error };
      return { ok: true, query: text, results, searchesUsed: used, ...(credits === null ? {} : { creditsEstimate: credits }), searchId: `${name}-sid` };
    };
  }
  return p;
}

function session(options = {}) {
  const lines = [];
  const recorded = [];
  const s = searchSession({ limit: 5, log: (line) => lines.push(line), record: (row) => recorded.push(row), sleep: () => {}, ...options });
  return { s, lines, recorded };
}

test('one provider: its answer is attributed to it and counted on its meter', () => {
  const search = provider({ name: 'search-a', credits: 2 });
  const fetch = provider({ name: 'fetch' });
  const { s, lines, recorded } = session({ adapter: fetch, searchAdapter: search });
  const found = s.ask('rate limits');
  assert.equal(found.ok, true);
  assert.equal(found.provider, 'search-a');
  assert.deepEqual(found.providers, ['search-a']);
  assert.equal(found.merged, false);
  assert.equal(found.degraded, false);
  assert.equal(found.searchId, 'search-a-sid');
  assert.equal(found.results.length, 2);
  assert.deepEqual(search.calls, [{ text: 'rate limits', limit: 5 }]);
  assert.equal(fetch.calls.length, 0, 'the fetch provider was asked to search');
  assert.deepEqual(s.meters(), { searchesUsed: 1, searchesOn: { 'search-a': 1 }, searchCreditsEstimate: 2, searchFailures: 0, searchFailuresOn: {}, degraded: 0 });
  assert.deepEqual(recorded, []);
  assert.deepEqual(lines, ['  search     found 2 for "rate limits" (search-a)']);
  assert.equal(s.name, 'search-a');
  assert.equal(s.meter, 'search-a');
});

test('no search side: the fetch adapter searches, as every caller did before the split', () => {
  const fetch = provider({ name: 'fetch' });
  const { s } = session({ adapter: fetch });
  assert.equal(s.name, 'fetch');
  assert.equal(s.ask('q').provider, 'fetch');
  assert.deepEqual(s.meters().searchesOn, { fetch: 1 });
});

test('a failed ask is one failure on its provider, and the fetch provider is asked once instead', () => {
  const search = provider({ name: 'search-a', fail: ['503 from the vendor'] });
  const fetch = provider({ name: 'fetch', results: rows('fetch', 3) });
  const { s, lines, recorded } = session({ adapter: fetch, searchAdapter: search });
  const found = s.ask('q');
  assert.equal(found.ok, true);
  assert.equal(found.provider, 'fetch', 'the answer is attributed to the provider that ranked it');
  assert.equal(found.degraded, true);
  assert.equal(found.results.length, 3);
  assert.equal(search.calls.length, 1, 'the failing provider is asked exactly once');
  assert.equal(fetch.calls.length, 1);
  const m = s.meters();
  assert.equal(m.searchFailures, 1);
  assert.deepEqual(m.searchFailuresOn, { 'search-a': 1 });
  assert.equal(m.degraded, 1);
  assert.deepEqual(m.searchesOn, { fetch: 1 }, 'a failed ask that reports no usage counts nothing');
  assert.deepEqual(recorded, [{ query: 'q', error: '503 from the vendor', provider: 'search-a', degraded: true, fellBackTo: 'fetch' }]);
  assert.deepEqual(lines, [
    '  search failed on search-a: 503 from the vendor',
    '  degrading to fetch for this query - this spends fetch credits',
    '  search     found 3 for "q" (fetch)',
  ]);
});

test('ONE accounting rule: usage an adapter reports on a FAILED ask is still counted - the vendor charged for it', () => {
  // Today's adapters report no usage on a failure; a provider that did would be counted,
  // because the meter is the vendor's and not the outcome's (ADR-0135).
  const search = { name: 'search-a', calls: 0, search() { this.calls += 1; return { ok: false, error: 'timeout', searchesUsed: 1, creditsEstimate: 2 }; } };
  const fetch = provider({ name: 'fetch' });
  const { s } = session({ adapter: fetch, searchAdapter: search });
  assert.equal(s.ask('q').ok, true);
  assert.deepEqual(s.meters().searchesOn, { 'search-a': 1, fetch: 1 });
  assert.equal(s.meters().searchesUsed, 2);
  assert.equal(s.meters().searchCreditsEstimate, 2);
});

test('both providers fail: two failed asks, two rows, the query is not answered', () => {
  const search = provider({ name: 'search-a', fail: ['down'] });
  const fetch = provider({ name: 'fetch', fail: ['also down'] });
  const { s, lines, recorded } = session({ adapter: fetch, searchAdapter: search });
  const found = s.ask('q');
  assert.equal(found.ok, false);
  assert.equal(found.provider, 'fetch');
  assert.equal(found.error, 'also down');
  assert.deepEqual(found.results, []);
  const m = s.meters();
  assert.equal(m.searchFailures, 2);
  assert.deepEqual(m.searchFailuresOn, { 'search-a': 1, fetch: 1 });
  assert.equal(m.degraded, 0, 'a degrade that did not answer is not counted as one');
  assert.deepEqual(recorded, [
    { query: 'q', error: 'down', provider: 'search-a', degraded: true, fellBackTo: 'fetch' },
    { query: 'q', error: 'also down', provider: 'fetch' },
  ]);
  assert.equal(lines.at(-1), '  search failed: q - also down');
});

test('a fetch provider that cannot search is never degraded to; the real failure is the one recorded', () => {
  const search = provider({ name: 'search-a', fail: ['down'] });
  const browser = provider({ name: 'browser', searchable: false });
  const { s, recorded } = session({ adapter: browser, searchAdapter: search });
  const found = s.ask('q');
  assert.equal(found.ok, false);
  assert.equal(found.error, 'down');
  assert.deepEqual(recorded, [{ query: 'q', error: 'down', provider: 'search-a' }]);
  assert.deepEqual(s.meters().searchFailuresOn, { 'search-a': 1 });
});

test('the search side IS the fetch adapter: a failure is not degraded to itself', () => {
  const fetch = provider({ name: 'fetch', fail: ['down'] });
  const { s, recorded } = session({ adapter: fetch, searchAdapter: fetch });
  assert.equal(s.ask('q').ok, false);
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(recorded, [{ query: 'q', error: 'down', provider: 'fetch' }]);
});

test('a merge asks every provider, interleaves by rank, attributes every row, and counts each meter', () => {
  const a = provider({ name: 'a', results: [{ url: 'https://x.example/1' }, { url: 'https://shared.example/' }], credits: 2 });
  const b = provider({ name: 'b', results: [{ url: 'https://shared.example/' }, { url: 'https://y.example/1' }] });
  const fetch = provider({ name: 'fetch' });
  const { s, lines, recorded } = session({ adapter: fetch, searchAdapter: a, searchAdapters: [a, b] });
  assert.equal(s.name, 'a', 'the paying provider names the search side');
  assert.equal(s.meter, 'a + b', 'the dry run names every meter a merge would spend');
  assert.deepEqual(s.providers, [a, b]);
  const found = s.ask('q');
  assert.equal(found.ok, true);
  assert.equal(found.merged, true);
  assert.equal(found.provider, 'a+b');
  assert.deepEqual(found.providers, ['a', 'b']);
  assert.equal(found.searchId, null);
  assert.deepEqual(found.results.map((r) => r.url), ['https://x.example/1', 'https://shared.example/', 'https://y.example/1']);
  assert.deepEqual([...found.results[1].providers].sort(), ['a', 'b'], 'a URL both returned is attributed to both');
  assert.equal(fetch.calls.length, 0);
  assert.deepEqual(s.meters(), { searchesUsed: 2, searchesOn: { a: 1, b: 1 }, searchCreditsEstimate: 2, searchFailures: 0, searchFailuresOn: {}, degraded: 0 });
  assert.deepEqual(recorded, []);
  assert.deepEqual(lines, ['  searched   a 2, b 2 -> 3 distinct']);
});

test('a merge survives one provider: the miss is recorded as covered, the query is answered', () => {
  const a = provider({ name: 'a', fail: ['quota'] });
  const b = provider({ name: 'b' });
  const { s, lines, recorded } = session({ adapter: provider({ name: 'fetch' }), searchAdapter: a, searchAdapters: [a, b] });
  const found = s.ask('q');
  assert.equal(found.ok, true);
  assert.equal(found.provider, 'b', 'only the provider that answered is named');
  assert.deepEqual(found.providers, ['b']);
  assert.deepEqual(recorded, [{ query: 'q', error: 'quota', provider: 'a', covered: true }]);
  const m = s.meters();
  assert.equal(m.searchFailures, 1);
  assert.deepEqual(m.searchFailuresOn, { a: 1 });
  assert.deepEqual(m.searchesOn, { b: 1 });
  assert.equal(m.degraded, 0, 'a merge never degrades: the other provider is the cover');
  assert.deepEqual(lines, ['  search failed on a: quota', '  searched   b 2 -> 2 distinct']);
});

test('the covered mark is handed over at once and set afterwards, so a sink that copies the row at record time sees no covered', () => {
  // runResearch's sink writes the failure log in the order the asks happen; decompose keeps
  // the object. The first sees `{ query, error, provider }`, the second sees `covered: true`.
  const a = provider({ name: 'a', fail: ['quota'] });
  const b = provider({ name: 'b' });
  const copies = [];
  const kept = [];
  const s = searchSession({ limit: 5, adapter: provider({ name: 'fetch' }), searchAdapter: a, searchAdapters: [a, b], record: (row) => { copies.push({ ...row }); kept.push(row); } });
  s.ask('q');
  assert.deepEqual(copies, [{ query: 'q', error: 'quota', provider: 'a' }]);
  assert.deepEqual(kept, [{ query: 'q', error: 'quota', provider: 'a', covered: true }]);
});

test('a merge where every provider fails is a failed ask on each, not a degrade, and says so once', () => {
  const a = provider({ name: 'a', fail: ['x'] });
  const b = provider({ name: 'b', fail: ['y'] });
  const fetch = provider({ name: 'fetch' });
  const { s, lines, recorded } = session({ adapter: fetch, searchAdapter: a, searchAdapters: [a, b] });
  const found = s.ask('q');
  assert.equal(found.ok, false);
  assert.equal(found.provider, 'a+b');
  assert.deepEqual(found.providers, ['a', 'b']);
  assert.equal(found.error, 'a: x; b: y');
  assert.equal(fetch.calls.length, 0, 'a merge does not degrade to the fetch provider');
  assert.deepEqual(recorded, [{ query: 'q', error: 'x', provider: 'a' }, { query: 'q', error: 'y', provider: 'b' }]);
  assert.deepEqual(s.meters().searchFailuresOn, { a: 1, b: 1 });
  assert.equal(lines.at(-1), '  search failed on every provider: q');
});

test('a vendor rate limit is waited out with the vendor\'s own delay, bounded by maxRateLimitRetries', () => {
  const limited = provider({ name: 'a', fail: ['Rate limit exceeded. Retry after 5s', 'Rate limit exceeded. Retry after 5s'] });
  const waits = [];
  const lines = [];
  const s = searchSession({ limit: 5, adapter: provider({ name: 'fetch' }), searchAdapter: limited, maxRateLimitRetries: 2, sleep: (ms) => waits.push(ms), log: (l) => lines.push(l) });
  assert.equal(s.ask('q').ok, true);
  assert.deepEqual(waits, [6000, 6000]);
  assert.equal(limited.calls.length, 3);
  assert.equal(s.meters().searchFailures, 0, 'a rate limit that cleared is not a failure');
  assert.equal(lines[0], '  waiting    6s - a search hit the vendor rate limit');

  const impatient = provider({ name: 'a', fail: ['Rate limit exceeded. Retry after 5s'] });
  const none = searchSession({ limit: 5, adapter: provider({ name: 'fetch', searchable: false }), searchAdapter: impatient, maxRateLimitRetries: 0, sleep: () => { throw new Error('slept'); } });
  assert.equal(none.ask('q').ok, false, 'with no patience the rate limit is the failure');
  assert.equal(impatient.calls.length, 1);
});

test('assertReady refuses a provider that reports notReady before anything is asked', () => {
  const notReady = { name: 'serpapi', notReady: 'serpapi: no key is configured', calls: 0, search() { this.calls += 1; return { ok: true, results: [] }; } };
  const { s } = session({ adapter: provider({ name: 'fetch' }), searchAdapter: notReady });
  assert.throws(() => s.assertReady(), (err) => err.code === 'SEARCH_PROVIDER_NOT_READY' && err.message === 'serpapi: no key is configured');
  assert.equal(notReady.calls, 0);
  const { s: ready } = session({ adapter: provider({ name: 'fetch' }), searchAdapter: provider({ name: 'a' }) });
  ready.assertReady();
});

test('with a credits policy, the policy says which provider serves each ask, and the switch is counted on the provider that answered', () => {
  const search = provider({ name: 'search-a', fail: ['Insufficient credits'] });
  const fetch = provider({ name: 'fetch' });
  const fallback = provider({ name: 'free', results: rows('free', 1) });
  const asked = [];
  // The shape `creditsPolicy` returns: `askLive` asks and switches once, `live` names the
  // provider standing in for an exhausted one.
  const credits = {
    askLive(p, text) { asked.push(p.name); const r = p.search(text, { limit: 5 }); if (!r.ok && p === search) return { r: fallback.search(text, { limit: 5 }), provider: fallback }; return { r, provider: p }; },
    live: (p) => (p === search ? fallback : p),
  };
  const { s } = session({ adapter: fetch, searchAdapter: search, credits });
  const found = s.ask('q');
  assert.equal(found.ok, true);
  assert.equal(found.provider, 'free', 'the provider that served the call is the one named');
  assert.deepEqual(asked, ['search-a']);
  assert.equal(fetch.calls.length, 0, 'an answer from the stand-in is not degraded further');
  assert.deepEqual(s.meters().searchesOn, { free: 1 });
  assert.equal(s.meters().searchFailures, 0);
});

test('askOne is the one patient call a coordinator shares with its credits policy', () => {
  const search = provider({ name: 'a' });
  const seen = [];
  const { s } = session({ adapter: provider({ name: 'fetch' }), searchAdapter: search, askOne: (p, text) => { seen.push(`${p.name}:${text}`); return p.search(text, { limit: 1 }); } });
  s.ask('q');
  assert.deepEqual(seen, ['a:q']);
  assert.deepEqual(search.calls, [{ text: 'q', limit: 1 }], 'the injected call decides the limit');
});

test('meters() is a reading, not the ledger: a caller cannot move the counts', () => {
  const { s } = session({ adapter: provider({ name: 'fetch' }), searchAdapter: provider({ name: 'a' }) });
  s.ask('q');
  const m = s.meters();
  m.searchesOn.a = 99;
  m.searchesUsed = 99;
  assert.deepEqual(s.meters(), { searchesUsed: 1, searchesOn: { a: 1 }, searchCreditsEstimate: 0, searchFailures: 0, searchFailuresOn: {}, degraded: 0 });
});

// Found 2026-10-03 probing the module with hostile inputs: a session built with no provider
// at all - no adapter, no search side - crashed on `first.provider.name` instead of saying
// there was nothing to ask. Both CLIs always pass an adapter, so only a library caller could
// reach it; the module's own contract is a named failure, never a TypeError.
test('a session with nothing to ask is a named failure, not a crash', () => {
  const { s, recorded, lines } = session({});
  const found = s.ask('q');
  assert.equal(found.ok, false);
  assert.equal(found.error, 'this transport fetches pages but does not search');
  assert.equal(found.provider, 'this transport');
  assert.deepEqual(recorded, [{ query: 'q', error: 'this transport fetches pages but does not search', provider: 'this transport' }]);
  assert.deepEqual(s.meters().searchFailuresOn, { 'this transport': 1 });
  assert.equal(lines.at(-1), '  search failed: q - this transport fetches pages but does not search');
  assert.equal(s.name, '');
  assert.equal(s.meter, '');
});

// Found 2026-10-03 probing with hostile results: a `null` row crashed both coordinators on
// `row.url`, and `results` that is not an array crashed research's `noteOutcome` on `.some`.
// The session hands over rows that are objects, and always an array; whether a row's URL is
// usable stays the coordinator's question (`isWebUrl`, `selectCandidates`).
test('a result that is not an object, and results that are not an array, never reach a coordinator', () => {
  const { s } = session({ adapter: provider({ name: 'f' }), searchAdapter: { name: 'a', search: () => ({ ok: true, results: [{ url: 'https://x.example/1' }, null, undefined, 'https://x.example/2', 42, { title: 'no url' }] }) } });
  const found = s.ask('q');
  assert.equal(found.ok, true);
  assert.deepEqual(found.results, [{ url: 'https://x.example/1' }, { title: 'no url' }], 'only the objects, in order; a row without a URL is still the coordinator\'s to judge');

  const { s: odd } = session({ adapter: provider({ name: 'f' }), searchAdapter: { name: 'a', search: () => ({ ok: true, results: 'https://x.example/1' }) } });
  const got = odd.ask('q');
  assert.equal(got.ok, true);
  assert.deepEqual(got.results, [], 'a string is not a list of results');
});

// Found 2026-10-03 probing: `assertReady` read `notReady` off the search side only, so a merge
// whose partner could not run was not refused - each query would have failed on it and been
// covered by the other, a search spent for nothing on every query. The selection never
// builds such a merge today; the refusal holds for any provider the session may ask.
test('assertReady refuses a not-ready provider anywhere in a merge, before anything is asked', () => {
  const a = provider({ name: 'a' });
  const b = { name: 'b', notReady: 'b: no key is configured', calls: 0, search() { this.calls += 1; return { ok: false, error: 'no key' }; } };
  const { s } = session({ adapter: provider({ name: 'fetch' }), searchAdapter: a, searchAdapters: [a, b] });
  assert.throws(() => s.assertReady(), (err) => err.code === 'SEARCH_PROVIDER_NOT_READY' && err.message === 'b: no key is configured');
  assert.equal(a.calls.length, 0);
  assert.equal(b.calls, 0);
});

// Found 2026-10-03 probing: a provider whose `search()` THREW ended both coordinators, and
// the searches paid for before the throw never reached the usage row, which is written at the
// end of a run. The four adapters return failures by contract, so a throw is one of their
// bugs - an unguarded parse of a vendor payload - and the kit cannot prevent it; it can keep
// it a failed search, named as a throw, so the run and its accounting finish.
test('a provider that throws is a failed ask naming the throw, asked once, and the run goes on', () => {
  let asks = 0;
  const thrower = { name: 'serp', search() { asks += 1; throw new TypeError("Cannot read properties of undefined (reading 'organic_results')"); } };
  const fetch = provider({ name: 'fetch', results: rows('fetch', 1) });
  const { s, recorded, lines } = session({ adapter: fetch, searchAdapter: thrower, maxRateLimitRetries: 2 });
  const found = s.ask('q');
  assert.equal(found.ok, true, 'the fetch provider answered after the throw');
  assert.equal(found.provider, 'fetch');
  assert.equal(asks, 1, 'a throw is not retried as a rate limit would be');
  assert.deepEqual(recorded, [{ query: 'q', error: "serp threw: Cannot read properties of undefined (reading 'organic_results')", provider: 'serp', degraded: true, fellBackTo: 'fetch' }]);
  assert.equal(lines[0], "  search failed on serp: serp threw: Cannot read properties of undefined (reading 'organic_results')");
  assert.deepEqual(s.meters().searchFailuresOn, { serp: 1 });

  const thrownValue = { name: 'odd', search() { throw 'a string, not an Error'; } };
  const { s: odd } = session({ adapter: provider({ name: 'browser', searchable: false }), searchAdapter: thrownValue });
  const got = odd.ask('q');
  assert.equal(got.ok, false);
  assert.equal(got.error, 'odd threw: a string, not an Error');
});

// Review of that guard (2026-10-03): an adapter with an `async search()` returns a Promise,
// which the guard never sees thrown - it reached the `ok` test as a failure with no error
// text, and its rejection, awaited by nobody, ended the process after all. A thrown Symbol,
// or an object whose `message` getter throws, escaped the guard the same way, from inside
// the template literal that rendered it.
test('an async provider is a failed ask that says so, and a throw that cannot be rendered still is one', async () => {
  const rejected = { name: 'asyncp', async search() { throw new Error('vendor payload unparsable'); } };
  const fetch = provider({ name: 'fetch', results: rows('fetch', 1) });
  const { s, recorded } = session({ adapter: fetch, searchAdapter: rejected });
  const unhandled = [];
  const onRejection = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    const found = s.ask('q');
    assert.equal(found.ok, true, 'the fetch provider answered after the async provider');
    assert.equal(found.provider, 'fetch');
    assert.equal(recorded.length, 1);
    assert.match(recorded[0].error, /asyncp returned a Promise/, recorded[0].error);
    assert.match(recorded[0].error, /synchronous/, recorded[0].error);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'the rejection nobody awaited reached the process');
  } finally {
    process.off('unhandledRejection', onRejection);
  }

  const resolving = { name: 'asyncok', async search() { return { ok: true, query: 'q', results: rows('asyncok', 1), searchesUsed: 1 }; } };
  const { s: s2, recorded: r2 } = session({ adapter: provider({ name: 'browser', searchable: false }), searchAdapter: resolving });
  const got = s2.ask('q');
  assert.equal(got.ok, false, 'an answer nobody waited for is not an answer');
  assert.match(got.error, /asyncok returned a Promise/);
  assert.equal(r2.length, 1);

  const symbol = { name: 'sym', search() { throw Symbol('x'); } };
  const { s: s3 } = session({ adapter: provider({ name: 'browser', searchable: false }), searchAdapter: symbol });
  assert.equal(s3.ask('q').ok, false, 'a thrown Symbol escaped the guard');
  assert.match(s3.ask('q').error, /sym threw: /);
  const poisoned = { name: 'poison', search() { throw { get message() { throw new Error('no'); } }; } };
  const { s: s4 } = session({ adapter: provider({ name: 'browser', searchable: false }), searchAdapter: poisoned });
  const bad = s4.ask('q');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /poison threw: a value that cannot be rendered as text/);
});

test('searchPatiently and mergeByRank live here and stay importable from research-run', () => {
  assert.equal(viaResearchRun, mergeByRank);
  assert.equal(patientlyViaResearchRun, searchPatiently);
});

// #313 (2026-10-11): the keyless search refused with a 429 and its Retry-After was never read -
// the patience loop understood only Firecrawl's error text. The provider's own `retryAfterMs`
// is asked first; a server that asked past the cap gets one more try, not the loop's bound.
test('searchPatiently waits the retryAfterMs a provider read from the server', () => {
  let asks = 0;
  const slept = [];
  const keyless = { name: 'http-keyless', search: (q) => {
    asks += 1;
    return asks === 1
      ? { ok: false, query: q, results: [], retryAfterMs: 2000, error: 'HTTP 429 - rate limited, the server asks for a retry after 2s' }
      : { ok: true, query: q, results: rows('k', 1) };
  } };
  const r = searchPatiently(keyless, 'rate limits', { limit: 8, sleep: (ms) => slept.push(ms) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(asks, 2);
  assert.deepEqual(slept, [2000]);

  let tries = 0;
  const waited = [];
  const busy = { name: 'http-keyless', search: (q) => { tries += 1; return { ok: false, query: q, results: [], retryAfterMs: 60_000, retryAfterCapped: true, error: 'HTTP 503 - the server asks for a retry after 3600s' }; } };
  const gaveUp = searchPatiently(busy, 'q', { limit: 8, sleep: (ms) => waited.push(ms) });
  assert.equal(gaveUp.ok, false);
  assert.equal(tries, 2, 'one wait at the cap, one more ask');
  assert.deepEqual(waited, [60_000]);
});

// Review of #313 (2026-10-18): each query waited its own two retries, so ten queries to a
// provider answering a bare 429 slept twenty minutes. A provider that ran out of retries is
// noted for the run, and a later query to it is asked once without waiting, until it answers.
test('a provider that ran out of rate-limit retries is not waited on again in the same run', () => {
  let open = false;
  const slept = [];
  const limited = new Set();
  const keyless = { name: 'http-keyless', search: (q) => (open
    ? { ok: true, query: q, results: rows('k', 1) }
    : { ok: false, query: q, results: [], retryAfterMs: 60_000, error: 'HTTP 429 - rate limited, the server named no retry time' }) };
  const ask = (q) => searchPatiently(keyless, q, { limit: 8, sleep: (ms) => slept.push(ms), limited });
  for (const q of ['one', 'two', 'three']) assert.equal(ask(q).ok, false);
  assert.deepEqual(slept, [60_000, 60_000], 'the first query waited; the next two did not');
  open = true;
  assert.equal(ask('four').ok, true);
  assert.equal(limited.size, 0, 'an answer clears the note');
  // The session keeps one note for its run when it builds the patient call itself.
  open = false;
  const waits = [];
  const session = searchSession({ adapter: keyless, limit: 8, sleep: (ms) => waits.push(ms) });
  session.ask('a');
  session.ask('b');
  assert.deepEqual(waits, [60_000, 60_000]);
});
