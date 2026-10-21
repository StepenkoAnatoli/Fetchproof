// The seam at the level that matters: a whole run, with two providers (ADR-0027).
//
// `serpapi.test.mjs` holds the adapter to its contract. This file asks the question the
// adapter cannot answer alone - does a run keep the two meters, and the two provenance
// claims, apart all the way to disk?
//
// Requirement ids refer to docs/requirements-2026-09-19-search-fetch-seam.md.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test, describe, assert, tempDir, fs, path, KIT_ROOT } from './harness.mjs';
import { scaffoldProject } from '../lib/scaffold.mjs';
import { runResearch, searchUsage, searchSummaryLine, matchesQuery, queryTerms, isPreferred, FREE_TIER_PER_HOUR, FREE_TIER_PER_MONTH } from '../lib/research-run.mjs';
import { decompose, searchSummary } from '../lib/decompose.mjs';
import * as serpapi from '../lib/serpapi.mjs';
import { readLedger, readCorpus } from '../lib/corpus.mjs';
import { withLock, holdsLock } from '../lib/provenance.mjs';
import { readText } from '../lib/core.mjs';

describe('search-seam');

const MARKDOWN = 'x'.repeat(2000);

function fetchStub({ name = 'stub-fetch', results = ['https://fetchside.example/a'] } = {}) {
  const calls = { search: 0, scrape: 0 };
  return {
    name,
    calls,
    search() {
      calls.search += 1;
      return { ok: true, query: 'q', results: results.map((url, i) => ({ url, title: `T${i}`, description: '', position: i + 1 })) };
    },
    runScrape(url) {
      calls.scrape += 1;
      return { ok: true, url, markdown: MARKDOWN, title: 'T', statusCode: 200, transport: name, completeness: 'full', command: `stub scrape ${url}` };
    },
    scrape(url) { return this.runScrape(url); },
    map() { return { ok: true, links: [] }; },
    status() { return { ok: true, authenticated: true }; },
    command(a) { return `stub ${a}`; },
  };
}

function searchStub({ name = 'stub-search', results = ['https://searchside.example/a'], fail = null, searchesUsed = 1 } = {}) {
  const calls = { search: 0 };
  return {
    name,
    calls,
    search() {
      calls.search += 1;
      if (fail) return { ok: false, query: 'q', results: [], error: fail, provider: name };
      return {
        ok: true, query: 'q', provider: name, searchId: 'sid-1', ...(searchesUsed ? { searchesUsed } : {}),
        results: results.map((url, i) => ({ url, title: `T${i}`, description: '', position: i + 1 })),
      };
    },
  };
}

function plan(extra = {}) {
  return {
    topic: 'seam', depth: 'normal', refreshDays: 30, limit: 5, perQuery: 1, maxScrapes: 5, prefer: [],
    queries: [{ q: 'a query', why: 'U-1' }], urls: [], ...extra,
  };
}

function project(topic = 'seam probe') {
  const root = tempDir('fp-seam-');
  scaffoldProject(root, { topic });
  return root;
}

/** Everything under research/, as a map of path -> bytes. Cheap and exact. */
function snapshot(root) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { walk(full, prefix + name + "/"); continue; }
      out[prefix + name] = fs.readFileSync(full).toString("base64");
    }
  };
  walk(path.join(root, "research"), "");
  return out;
}

function jsonLines(root, file) {
  const text = readText(path.join(root, 'research/raw', file), '');
  return text.trim() ? text.trim().split('\n').map((l) => JSON.parse(l)) : [];
}

// ---------------------------------------------------------------- TR-5  the whole run

test('TR-5: the search side searches and the fetch side fetches - neither does the other job', () => {
  const root = project();
  const fetcher = fetchStub();
  const searcher = searchStub();

  const run = runResearch(root, { adapter: fetcher, searchAdapter: searcher, plan: plan() });

  assert.equal(searcher.calls.search, 1, 'the search provider did not run the search');
  assert.equal(fetcher.calls.search, 0, 'the FETCH provider ran a search - that is the budget competition this change removes');
  assert.equal(fetcher.calls.scrape, 1, 'the fetch provider did not fetch');
  assert.equal(run.spent, 1);
  assert.equal(run.searchesUsed, 1);
  assert.equal(run.searchTransport, 'stub-search');
  assert.equal(run.transport, 'stub-fetch');
});

test('AR-4: a capture is stamped with what FETCHED it, never with what ranked it', () => {
  const root = project();
  const run = runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan() });

  const entry = readLedger(root).entries.find((e) => e.url === 'https://searchside.example/a');
  assert.ok(entry, 'the searched candidate was never collected');
  assert.equal(entry.transport, 'stub-fetch', 'the capture claims the search provider fetched it');
  assert.equal(run.results.length, 1);
});

// ---------------------------------------------------------------- DR-2  two provenances

test('DR-2: a searched URL records WHO RANKED IT, separately from who fetched it', () => {
  const root = project();
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan() });

  const entry = readLedger(root).entries.find((e) => e.url === 'https://searchside.example/a');
  assert.equal(entry.discoveredBy, 'stub-search');
  assert.equal(entry.transport, 'stub-fetch');
  assert.notEqual(entry.discoveredBy, entry.transport, 'the two claims collapsed into one');
});

test('DR-2: a URL a PERSON wrote into the plan has no ranker, and says so by absence', () => {
  const root = project();
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan({ urls: ['https://planned.example/p'], queries: [] }) });

  const entry = readLedger(root).entries.find((e) => e.url === 'https://planned.example/p');
  assert.ok(entry, 'the planned URL was never collected');
  assert.equal('discoveredBy' in entry, false, 'a planned URL was credited to a ranking that never happened');
});

test('DR-2: the fallback records the provider that ACTUALLY ranked it, not the one that failed', () => {
  const root = project();
  runResearch(root, {
    adapter: fetchStub(),
    searchAdapter: searchStub({ fail: 'Your account has run out of searches.' }),
    plan: plan(),
  });

  const entry = readLedger(root).entries.find((e) => e.url === 'https://fetchside.example/a');
  assert.ok(entry, 'the fallback produced no capture');
  assert.equal(entry.discoveredBy, 'stub-fetch', 'the failed provider was credited with a ranking it never produced');
});

// ---------------------------------------------------------------- DR-3  the hash chain

test('DR-3: a search is never a ledger entry, and the chain still verifies', () => {
  const root = project();
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan() });

  const ledger = readLedger(root);
  assert.equal(ledger.problems.length, 0, `chain damaged: ${JSON.stringify(ledger.problems)}`);
  for (const entry of ledger.entries) {
    assert.ok(['scrape', 'fail'].includes(entry.op), `a "${entry.op}" entry reached the fetch ledger`);
    assert.ok(entry.bodySha256 !== undefined, 'a ledger entry with no body hash - a search got in');
  }
  assert.equal(ledger.entries.length, 1, 'the search added an entry of its own');
});

test('DR-3: entries WITHOUT discoveredBy hash as they always did', () => {
  // The optional field must not retroactively change anything. A planned URL produces an
  // entry with no such field; if its presence were mandatory the hash would shift and
  // every pre-split ledger on disk would stop verifying.
  const root = project();
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan({ urls: ['https://planned.example/p'], queries: [] }) });

  const ledger = readLedger(root);
  assert.equal(ledger.problems.length, 0, `chain damaged: ${JSON.stringify(ledger.problems)}`);
  const raw = readText(path.join(root, 'research/raw/.fetches.jsonl'), '');
  assert.equal(/discoveredBy/.test(raw), false, 'an empty discoveredBy was written as a field');
});

// ---------------------------------------------------------------- DR-1, DR-4  the logs

test('DR-1: the usage log keeps the two meters apart', () => {
  const root = project();
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan() });

  const [usage] = jsonLines(root, '.usage.jsonl');
  assert.ok(usage, 'nothing was written to the usage log');
  assert.equal(usage.transport, 'stub-fetch');
  assert.equal(usage.searchTransport, 'stub-search');
  assert.equal(usage.searchesUsed, 1);
  assert.equal(usage.spent, 1);
  assert.equal(usage.degraded, 0);
});

test('the usage line says what each search returned: the pages it made targets, and those already captured (#321)', () => {
  const root = project();
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan() });
  // The same search again: its one result is captured now, so it makes no target and the
  // ledger gets no entry - the usage line is the only record that the page was found.
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan() });
  const [first, second] = jsonLines(root, '.usage.jsonl');
  assert.deepEqual(first.searchOutcomes, [{ query: 'a query', results: 1, held: [], targets: ['https://searchside.example/a'] }]);
  assert.deepEqual(second.searchOutcomes, [{ query: 'a query', results: 1, held: ['https://searchside.example/a'], targets: [] }]);
});

test('DR-1: a run that only SEARCHED is still recorded - a second meter spent is still spend', () => {
  const root = project();
  // Every candidate is already a plan url that will not be reached, so nothing is
  // scraped; the search still happened.
  const run = runResearch(root, {
    adapter: fetchStub(),
    searchAdapter: searchStub({ results: [] }),
    plan: plan(),
  });
  assert.equal(run.spent, 0);
  assert.equal(run.searchesUsed, 1);
  const [usage] = jsonLines(root, '.usage.jsonl');
  assert.ok(usage, 'a search-only run vanished from the usage record');
  assert.equal(usage.searchesUsed, 1);
});

// Review of the 2026-10-19 sweep: the usage row was written only for a page spent or a search
// a provider reported, and keyless search and SearXNG report none, nor does any provider on a
// failed ask. So a search that failed or found nothing left no row, auto-collect never read
// its `searchOutcomes`, and a request whose one search failed was recorded `collected`, 0 pages.
test('a search that failed, or found nothing, with no usage reported, still writes its outcome to the usage row (#321)', () => {
  const cases = [
    ['failed', { fail: 'search:searxng returned HTTP 500' }, { query: 'a query', failed: true }],
    ['empty', { results: [], searchesUsed: 0 }, { query: 'a query', results: 0, held: [], targets: [] }],
  ];
  for (const [label, stub, outcome] of cases) {
    const root = project();
    // Chosen explicitly, as a configured SearXNG is, so a failure is not degraded to the
    // fetch side's own search.
    const run = runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub({ name: 'searxng', ...stub }), searchExplicit: true, plan: plan() });
    assert.equal(run.spent, 0, label);
    assert.equal(run.searchesUsed, 0, label);
    const usage = jsonLines(root, '.usage.jsonl');
    assert.equal(usage.length, 1, `${label}: the run's search outcome left no usage row`);
    assert.deepEqual(usage[0].searchOutcomes, [outcome], label);
    assert.equal(usage[0].searchesUsed, 0, label);
    // A row that spent nothing moves no meter.
    const meter = searchUsage(root);
    assert.deepEqual([meter.lastHour, meter.thisMonth, meter.providers], [0, 0, []], label);
    // A dry run still writes nothing.
    const dry = project();
    runResearch(dry, { adapter: fetchStub(), searchAdapter: searchStub({ name: 'searxng', ...stub }), searchExplicit: true, plan: plan(), dryRun: true });
    assert.equal(jsonLines(dry, '.usage.jsonl').length, 0, `${label}: a dry run wrote a usage row`);
  }
});

test('DR-4: a provider outage is attributable in the failure log', () => {
  const root = project();
  runResearch(root, {
    adapter: fetchStub(),
    searchAdapter: searchStub({ fail: 'read ECONNRESET' }),
    plan: plan(),
  });

  const [failure] = jsonLines(root, '.failures.jsonl');
  assert.ok(failure, 'the outage was not logged');
  assert.equal(failure.op, 'search');
  assert.equal(failure.provider, 'stub-search');
  assert.equal(failure.degraded, true);
  assert.match(failure.error, /ECONNRESET/);
});

// ---------------------------------------------------------------- RR-1..RR-3  degrading

test('RR-1: a search-provider failure degrades to the fetch provider, and the run lives', () => {
  const root = project();
  const fetcher = fetchStub();
  const run = runResearch(root, {
    adapter: fetcher,
    searchAdapter: searchStub({ fail: 'Your account has run out of searches.' }),
    plan: plan(),
  });

  assert.equal(run.degraded, 1);
  assert.equal(run.searchFailures, 1);
  assert.equal(fetcher.calls.search, 1, 'the fallback never ran');
  assert.equal(run.spent, 1, 'the run produced nothing after degrading');
});

test('RR-2: the fallback is BOUNDED - the failing provider is asked exactly once per query', () => {
  const root = project();
  const searcher = searchStub({ fail: 'read ECONNRESET' });
  runResearch(root, {
    adapter: fetchStub(),
    searchAdapter: searcher,
    plan: plan({ queries: [{ q: 'one', why: 'U-1' }, { q: 'two', why: 'U-1' }] }),
  });
  assert.equal(searcher.calls.search, 2, 'the failing provider was retried within a query');
});

test('RR-2: degradation is REPORTED, because it silently moves spend onto the fetch budget', () => {
  const root = project();
  const lines = [];
  runResearch(root, {
    adapter: fetchStub(),
    searchAdapter: searchStub({ fail: 'Your account has run out of searches.' }),
    plan: plan(),
    log: (l) => lines.push(l),
  });
  const text = lines.join('\n');
  assert.match(text, /search failed on stub-search/);
  assert.match(text, /spends fetch credits/, 'the operator was not told the fallback costs money');
});

// Found 2026-09-30: with the fetch side on http-keyless, the fallback line said "this spends
// fetch credits" - a transport with no meter. The warning stays for any fetch provider that
// may be metered (the stub above included); it is dropped only for the known-free ones.
test('RR-2: a fallback onto a free fetch transport does not claim to spend credits', () => {
  for (const name of ['http-keyless', 'browser']) {
    const root = project();
    const lines = [];
    runResearch(root, {
      adapter: fetchStub({ name }),
      searchAdapter: searchStub({ fail: 'no instance' }),
      plan: plan(),
      log: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.match(text, new RegExp(`degrading to ${name}`), text);
    assert.doesNotMatch(text, /spends fetch credits/, `${name} has no meter:\n${text}`);
    assert.match(text, /free/, `${name}: the line does not say what it costs:\n${text}`);
  }
});

test('RR-1: when BOTH providers fail, the query is skipped and the run continues', () => {
  const root = project();
  const fetcher = fetchStub();
  fetcher.search = () => { fetcher.calls.search += 1; return { ok: false, query: 'q', results: [], error: 'fetch-side search down too' }; };

  const run = runResearch(root, {
    adapter: fetcher,
    searchAdapter: searchStub({ fail: 'search-side down' }),
    plan: plan({ urls: ['https://planned.example/p'] }),
  });

  assert.equal(run.spent, 1, 'the planned URL should still have been collected');
  assert.equal(run.degraded, 0, 'a fallback that also failed was counted as a success');
  const failures = jsonLines(root, '.failures.jsonl');
  assert.equal(failures.length, 2, 'both failures should be recorded, not just the first');
});

// ---------------------------------------------------------------- RR-6  a busy minute

// Measured 2026-09-26 (docs/measurements/2026-09-26-search-reliability): the 11th and 12th
// Firecrawl searches inside one minute came back 429 with exactly this text, which is E-01's
// documented "10 /search requests per minute". The fetch side already waited these out;
// the search side logged them as failures and moved on.
const FIRECRAWL_429 = 'Rate limit exceeded. Consumed (req/min): 11, Remaining (req/min): 0. '
  + 'Upgrade your plan at https://firecrawl.dev/pricing for increased rate limits or please retry after 5s';

test('RR-6: a search rate limit is waited out and retried, as a fetch rate limit already was', () => {
  const root = project();
  const fetcher = fetchStub();
  let calls = 0;
  fetcher.search = () => {
    calls += 1;
    if (calls === 1) return { ok: false, query: 'q', results: [], error: FIRECRAWL_429 };
    return { ok: true, query: 'q', results: [{ url: 'https://fetchside.example/a', title: 'T', description: '', position: 1 }] };
  };
  const waits = [];
  const run = runResearch(root, { adapter: fetcher, plan: plan(), sleep: (ms) => waits.push(ms) });

  assert.equal(calls, 2, 'the rate limit must be retried, not reported');
  assert.deepEqual(waits, [6_000], 'the vendor said 5s; the wait is its number plus a second');
  assert.equal(run.searchFailures ?? 0, 0, 'a busy minute that cleared is not a failure');
  assert.equal(run.spent, 1, 'the page the retried search found was never fetched');
});

test('RR-6: the retry is BOUNDED - a provider that keeps refusing is reported, not waited on forever', () => {
  const root = project();
  const searcher = searchStub({ fail: FIRECRAWL_429 });
  const waits = [];
  runResearch(root, {
    adapter: fetchStub(), searchAdapter: searcher, plan: plan(), maxRateLimitRetries: 2, sleep: (ms) => waits.push(ms),
  });
  assert.equal(searcher.calls.search, 3, 'the first attempt plus two retries');
  assert.equal(waits.length, 2);
  const [failure] = jsonLines(root, '.failures.jsonl');
  assert.match(failure.error, /Rate limit exceeded/, 'the final refusal must still be on record');
});

test('RR-6: each provider in a merged search is retried on its own', () => {
  const root = project();
  let firstCalls = 0;
  const limited = searchStub({ name: 'limited' });
  const inner = limited.search;
  limited.search = (...args) => {
    firstCalls += 1;
    return firstCalls === 1 ? { ok: false, query: 'q', results: [], error: FIRECRAWL_429 } : inner(...args);
  };
  const other = searchStub({ name: 'other', results: ['https://other.example/b'] });
  const run = runResearch(root, {
    adapter: fetchStub(), searchAdapters: [limited, other], plan: plan({ perQuery: 2 }), sleep: () => {},
  });
  assert.equal(firstCalls, 2);
  assert.equal(other.calls.search, 1, 'a provider that answered must not be asked again');
  assert.equal(run.searchFailures ?? 0, 0);
});

// ---------------------------------------------------------------- RR-7  the summary line

// 2026-09-22, tavily-terms: SerpAPI timed out, the merge carried on with Firecrawl, and the
// run summary printed `searches 0 on serpapi` - true, and read as "not used" rather than
// "attempted and failed". The failure was in the log body; the one line people read hid it.

test('RR-7: a merged run counts failures PER PROVIDER, so the summary can name the one that failed', () => {
  const root = project();
  const run = runResearch(root, {
    adapter: fetchStub(),
    searchAdapters: [searchStub({ fail: 'spawnSync node ETIMEDOUT' }), fetchStub()],
    plan: plan({ queries: [{ q: 'one', why: 'U-1' }, { q: 'two', why: 'U-1' }] }),
    sleep: () => {},
  });
  assert.deepEqual(run.searchFailuresOn, { 'stub-search': 2 });
});

// Found 2026-09-28, end-to-end run (collection-cost-model): one query, merged over SerpAPI
// and Firecrawl, was logged as `searchesUsed: 2` under searchTransport "serpapi" and printed
// as "searches 2 on serpapi". The Firecrawl search was charged to SerpAPI's 50/hour and
// 250/month free-plan meter, and the Firecrawl credit estimate was printed on SerpAPI's line.
test('a merged run counts each search on the meter that paid for it', () => {
  const root = project();
  const run = runResearch(root, {
    adapter: fetchStub(),
    searchAdapters: [searchStub({ name: 'one', results: ['https://x.invalid/a'] }), searchStub({ name: 'two', results: ['https://y.invalid/b'] })],
    plan: plan(),
    sleep: () => {},
  });
  assert.deepEqual(run.searchesOn, { one: 1, two: 1 });
  assert.equal(searchUsage(root, { provider: 'one' }).lastHour, 1, 'one was charged for two\'s search');
  assert.equal(searchUsage(root, { provider: 'two' }).lastHour, 1, 'two\'s search was not counted on two');
  const line = searchSummaryLine(run);
  assert.match(line, /1 on one/);
  assert.match(line, /1 on two/);
});

// Found 2026-09-28, end-to-end run (collection-cost-model): decompose printed "searching on
// its own meter AND with firecrawl-cli, merged by rank" and then searched SerpAPI alone -
// its usage row held 4 searches for 4 queries and no Firecrawl estimate. The CLI handed it
// only the selection's first adapter. Phase 0 then scraped what SerpAPI alone had ranked.
test('decompose searches every provider of a merged selection, and says who paid', () => {
  const root = project();
  const one = searchStub({ name: 'one', results: ['https://one.invalid/seam-probe'] });
  const two = searchStub({ name: 'two', results: ['https://two.invalid/seam-probe'] });
  const out = decompose(root, { topic: 'seam probe', adapter: fetchStub(), searchAdapters: [one, two], maxScrapes: 0, log: () => {} });
  assert.equal(one.calls.search, out.searches, 'the first provider was not asked every query');
  assert.equal(two.calls.search, out.searches, 'the second provider was never asked');
  assert.equal(out.material, 2, 'both providers\' results are candidates');
  const row = JSON.parse(readText(path.join(root, 'research', 'raw', '.usage.jsonl')).trim().split('\n').pop());
  assert.deepEqual(row.searchesOn, { one: out.searches, two: out.searches });
});

// Seen on the first real merged run: SerpAPI timed out on one query that Firecrawl answered,
// and the summary said "3 of 4 searches answered, 1 failed" - every query had results.
test('decompose: a query one provider missed and another answered is answered, not lost', () => {
  const root = project();
  const down = searchStub({ name: 'down', fail: 'SerpAPI did not answer within 30s' });
  const up = searchStub({ name: 'up', results: ['https://up.invalid/seam-probe'] });
  const out = decompose(root, { topic: 'seam probe', adapter: fetchStub(), searchAdapters: [down, up], maxScrapes: 0, log: () => {} });
  const line = searchSummary(out);
  assert.match(line, new RegExp(`${out.searches} of ${out.searches} searches answered`), line);
  assert.doesNotMatch(line, /failed \(|, \d+ failed/, line);
  assert.match(line, /down/, 'the provider that missed is not named');
});

test('RR-7: the summary line says "attempted and failed", never a bare zero', () => {
  const line = searchSummaryLine({ searchesUsed: 0, searchTransport: 'serpapi', searchFailuresOn: { serpapi: 1 } });
  assert.match(line, /^searches {3}0 on serpapi/);
  assert.match(line, /1 attempt failed/, 'a failed provider must not read as an unused one');
  assert.match(line, /\.failures\.jsonl/, 'the line must say where the reason is');
});

test('RR-7: a partial failure is reported beside the successes, and plurals are right', () => {
  const line = searchSummaryLine({ searchesUsed: 3, searchTransport: 'serpapi', searchFailuresOn: { serpapi: 2, 'firecrawl-cli': 1 } });
  assert.match(line, /^searches {3}3 on serpapi/);
  assert.match(line, /2 attempts failed/);
  assert.doesNotMatch(line, /firecrawl/, 'the line is about the search meter only');
});

test('RR-7: a clean run prints exactly the line it always printed', () => {
  assert.equal(searchSummaryLine({ searchesUsed: 4, searchTransport: 'serpapi', searchFailuresOn: {} }), 'searches   4 on serpapi');
  assert.equal(searchSummaryLine({ searchesUsed: 4, searchTransport: 'serpapi' }), 'searches   4 on serpapi',
    'a run result from before this field existed must still render');
});

// ---------------------------------------------------------------- TR-8  the regression

test('TR-8: with NO search provider, a run behaves exactly as it did before the split', () => {
  const rootBefore = project();
  const rootAfter = project();
  const a = fetchStub();
  const b = fetchStub();

  // "Before": no searchAdapter argument at all, which is what every caller passed.
  const before = runResearch(rootBefore, { adapter: a, plan: plan() });
  // "After": the search side explicitly resolved to the same adapter, which is what
  // selectSearch does when no key is configured.
  const after = runResearch(rootAfter, { adapter: b, searchAdapter: b, plan: plan() });

  assert.equal(before.transport, after.transport);
  assert.equal(before.searchTransport, after.searchTransport);
  assert.equal(before.spent, after.spent);
  assert.equal(before.degraded, 0);
  assert.equal(after.degraded, 0);
  assert.deepEqual(a.calls, b.calls, 'the two paths made different calls');

  // And the durable record matches, field for field, apart from the timestamps.
  const strip = (e) => { const { at, prev, entrySha256, ...rest } = e; return rest; };
  assert.deepEqual(readLedger(rootBefore).entries.map(strip), readLedger(rootAfter).entries.map(strip));
});

test('TR-8: with one provider doing both jobs, no discoveredBy is recorded that says nothing', () => {
  const root = project();
  const both = fetchStub();
  runResearch(root, { adapter: both, searchAdapter: both, plan: plan() });

  const entry = readLedger(root).entries[0];
  assert.equal(entry.transport, 'stub-fetch');
  assert.equal(entry.discoveredBy, 'stub-fetch',
    'when one provider does both, the two claims are legitimately the same - and both are still recorded');
});

// ---------------------------------------------------------------- decompose

test('TR-5: decompose uses the search side too, and records the ranker', () => {
  const root = project();
  const fetcher = fetchStub();
  const searcher = searchStub({ results: ['https://docs.example.com/a'] });

  const out = decompose(root, {
    topic: 'a topic', adapter: fetcher, searchAdapter: searcher, maxScrapes: 1, limit: 3,
  });

  assert.equal(out.written, true);
  assert.equal(searcher.calls.search > 0, true, 'decompose never used the search provider');
  assert.equal(fetcher.calls.search, 0, 'decompose searched with the FETCH provider');
  const entry = readLedger(root).entries[0];
  assert.ok(entry, 'decompose collected nothing');
  assert.equal(entry.discoveredBy, 'stub-search');
});

// Found 2026-10-03 probing with hostile results (ADR-0135's session is where the one rule
// lives): a provider whose list held a `null` row ended BOTH coordinators with a TypeError on
// `row.url`, and research's `noteOutcome` died on results that were not an array.
test('a provider\'s null row, or results that are not an array, end neither coordinator', () => {
  const odd = (results) => ({ name: 'odd-search', calls: { search: 0 }, search() { this.calls.search += 1; return { ok: true, query: 'q', searchesUsed: 1, results }; } });
  for (const results of [[{ url: 'https://searchside.example/a', title: 'A', position: 1 }, null], 'https://searchside.example/a']) {
    const root = project();
    const run = runResearch(root, { adapter: fetchStub(), searchAdapter: odd(results), plan: plan() });
    assert.ok(run.searchesUsed >= 1, 'the search ran');
    const out = decompose(project(), { topic: 'seam probe', adapter: fetchStub(), searchAdapter: odd(results), maxScrapes: 0, log: () => {} });
    assert.equal(out.written, true);
  }
});

// Found 2026-10-03 probing: a provider whose `search()` threw on the second query ended both
// coordinators, and the first query's PAID search never reached the usage row - it is written
// at the end of a run, so the meter under-recorded real spend and `--status` would have too.
test('a provider that throws mid-run ends neither coordinator, and the searches paid before it are recorded', () => {
  const flaky = () => { let n = 0; return { name: 'flaky-search', calls: { search: 0 }, search(q) { n += 1; this.calls.search += 1; if (n === 2) throw new TypeError('unguarded vendor payload'); return { ok: true, query: q, searchesUsed: 1, results: [{ url: `https://searchside.example/${n}`, title: `S${n}`, position: 1 }] }; } }; };
  const root = project();
  const run = runResearch(root, { adapter: fetchStub(), searchAdapter: flaky(), plan: plan({ queries: ['first query', 'second query', 'third query'] }) });
  // Two: the flaky provider reported usage on its two answers; the fetch stub that answered
  // the degraded ask reports none, and a throw reports none either.
  assert.equal(run.searchesUsed, 2, 'every search that reported usage is counted, the throwing ask aside');
  assert.equal(run.searchFailures, 1);
  assert.deepEqual(run.searchFailuresOn, { 'flaky-search': 1 });
  const usage = jsonLines(root, '.usage.jsonl');
  assert.equal(usage.length, 1, 'the usage row was written');
  assert.equal(usage[0].searchesUsed, 2);
  const failures = jsonLines(root, '.failures.jsonl').filter((row) => row.op === 'search');
  assert.equal(failures.length, 1);
  assert.match(failures[0].error, /^flaky-search threw: unguarded vendor payload$/);
  assert.equal(failures[0].degraded, true);

  const out = decompose(project(), { topic: 'first part; second part; third part', adapter: fetchStub(), searchAdapter: flaky(), maxScrapes: 0, log: () => {} });
  assert.equal(out.written, true);
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0].error, /threw: unguarded vendor payload$/);
});

test('RR-1: decompose degrades too, and records which provider was down', () => {
  const root = project();
  const fetcher = fetchStub({ results: ['https://fallback.example/a'] });
  const out = decompose(root, {
    topic: 'a topic', adapter: fetcher,
    searchAdapter: searchStub({ fail: 'Your account has run out of searches.' }),
    maxScrapes: 1, limit: 3,
  });

  assert.equal(fetcher.calls.search > 0, true, 'decompose never fell back');
  assert.ok(out.failures.length > 0, 'the outage was not recorded');
  assert.equal(out.failures[0].provider, 'stub-search');
  assert.equal(out.failures[0].degraded, true);
});

// #317: a provider the operator chose by name (`--search-transport`, the environment, the
// machine config) is where their queries may go. Both coordinators hand that to the session,
// and a failure on it is a failed search: kept, counted on it, never sent to the fetch
// provider's own search.
test('an explicitly chosen search provider is never degraded, by either coordinator', () => {
  const root = project();
  const fetcher = fetchStub();
  const run = runResearch(root, {
    adapter: fetcher,
    searchAdapter: searchStub({ name: 'searxng', fail: 'searxng returned HTTP 429' }),
    searchExplicit: true,
    plan: plan(),
  });
  assert.equal(fetcher.calls.search, 0, 'research sent the query to the fetch provider\'s search');
  assert.equal(run.degraded, 0);
  assert.equal(run.searchFailures, 1);
  assert.deepEqual(jsonLines(root, '.failures.jsonl').filter((f) => f.op === 'search').map((f) => [f.provider, f.degraded ?? false]), [['searxng', false]]);

  const phase0 = project();
  const fetcher0 = fetchStub();
  const out = decompose(phase0, {
    topic: 'a topic', adapter: fetcher0,
    searchAdapter: searchStub({ name: 'searxng', fail: 'searxng returned HTTP 429' }),
    searchExplicit: true, maxScrapes: 0, limit: 3,
  });
  assert.equal(fetcher0.calls.search, 0, 'decompose sent the query to the fetch provider\'s search');
  assert.ok(out.failures.length > 0);
  assert.ok(out.failures.every((f) => f.provider === 'searxng' && !f.degraded), JSON.stringify(out.failures));
});

// ---------------------------------------------------------------- RR-4  the timeout

test('RR-4: a hung socket cannot outlive the timeout, so it cannot hold the corpus lock', () => {
  // The collector is synchronous and holds an O_EXCL lock for the whole operation
  // (ADR-0025). A search that never returns would hold it forever, so the bound has to
  // be real rather than argued. It is `spawnSync`'s own timeout: the child is killed,
  // and the parent gets an error instead of waiting.
  //
  // Driven through the real rendezvous with a child that deliberately never answers.
  const started = Date.now();
  const answer = serpapi.runJob(
    { kind: 'serpapi-search', query: 'x', apiKey: 'a'.repeat(40), timeout: 50 },
    { timeout: 300, spawn: (cmd, args, opts) => {
      // Stand in for a child that hangs: report what spawnSync reports when it kills one.
      assert.ok(Number.isFinite(opts.timeout), 'no timeout was passed to spawnSync - nothing bounds the wait');
      assert.equal(opts.timeout, 300);
      return { error: new Error('spawnSync node ETIMEDOUT'), stdout: '', stderr: '' };
    } },
  );
  assert.equal(answer.ok, false);
  assert.match(answer.error, /ETIMEDOUT/);
  assert.ok(Date.now() - started < 5000, 'the call did not return promptly');
});

test('RR-4: the timeout reaches the child too, not only the parent', () => {
  const job = { kind: 'serpapi-search', query: 'x', apiKey: 'a'.repeat(40), timeout: 1234 };
  let seen = null;
  serpapi.runJob(job, { timeout: 1234, spawn: (cmd, args, opts) => { seen = JSON.parse(opts.input); return { stdout: '{"ok":true,"payload":{}}', stderr: '' }; } });
  assert.equal(seen.timeout, 1234, 'the child would use its default and could outlive the parent\'s bound');
});

// ---------------------------------------------------------------- RR-5  the meter

test('RR-5: search spend is COUNTED and reported, per hour and per month', () => {
  const root = project();
  const now = new Date('2026-09-20T12:00:00.000Z');
  const write = (at, used, provider = 'serpapi') =>
    fs.appendFileSync(path.join(root, 'research/raw/.usage.jsonl'),
      `${JSON.stringify({ at, searchesUsed: used, searchTransport: provider, spent: 0 })}\n`);

  write('2026-09-20T11:30:00.000Z', 3);   // inside the hour
  write('2026-09-20T09:00:00.000Z', 5);   // this month, not this hour
  write('2026-08-31T23:59:00.000Z', 99);  // last month - must not count
  write('2026-09-20T11:45:00.000Z', 0);   // a run that searched nothing

  const usage = searchUsage(root, { now });
  assert.equal(usage.lastHour, 3);
  assert.equal(usage.thisMonth, 8, 'the month window leaked into August, or dropped September');
  assert.deepEqual(usage.providers, ['serpapi']);
  assert.equal(usage.perHourCap, FREE_TIER_PER_HOUR);
  assert.equal(usage.perMonthCap, FREE_TIER_PER_MONTH);
});

test('RR-5 / U-9: the SerpAPI adapter labels the caps as the DOCUMENTED plan, not as this account', () => {
  // 2026-09-26: the pricing page and FAQ say 50/hour (E-25, E-27); SerpAPI's own Account API
  // reported 250/hour for this account (U-9). A number the vendor enforces per account cannot
  // be presented as the account's. The adapter owns this - the vendor is named nowhere else.
  const text = serpapi.METER_NOTES.join('\n');
  assert.match(text, /documented Free Plan/);
  assert.match(text, /account\.json/, 'it must say where the account\'s own numbers are');
  assert.match(text, /calendar month/);
  assert.match(text, /billing cycle/, 'the reader must be told the vendor counts the month differently (U-10)');
});

test('RR-5: searchUsage itself stays vendor-neutral', () => {
  const usage = searchUsage(project());
  assert.equal(JSON.stringify(usage).toLowerCase().includes('serpapi'), false);
});

test('RR-5: the count is honest about what it cannot see', () => {
  const root = project();
  const usage = searchUsage(root);
  assert.match(usage.caveat, /this machine/, 'the report does not admit it is machine-local');
  assert.match(usage.caveat, /cache/, 'the report does not admit it over-counts cached repeats');
  assert.equal(usage.lastHour, 0, 'an empty project should report no spend, not NaN');
  assert.equal(usage.thisMonth, 0);
});

test('RR-5: a damaged usage log is skipped line by line, not fatal', () => {
  const root = project();
  const file = path.join(root, 'research/raw/.usage.jsonl');
  fs.appendFileSync(file, 'not json\n');
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), searchesUsed: 2, searchTransport: 'serpapi' })}\n`);
  fs.appendFileSync(file, '{"at": broken\n');

  const usage = searchUsage(root);
  assert.equal(usage.lastHour, 2, 'one unparseable line discarded the whole record');
});

test('RR-5: a run records spend that the meter then reads back', () => {
  // End to end rather than against a hand-written log: the writer and the reader must
  // agree about the field names, which is the thing that actually breaks.
  const root = project();
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan() });
  const usage = searchUsage(root);
  assert.equal(usage.thisMonth, 1);
  assert.deepEqual(usage.providers, ['stub-search']);
});

// ---------------------------------------------------------------- concurrency

test('CONCURRENCY: a search takes no lock, so it runs while a collector holds one', () => {
  // The claim gap 2 of the validation map recorded as an argument rather than a test:
  // "a search takes no lock because it writes nothing". Argued, it is plausible. Tested,
  // it is the difference between a second provider that composes with the collector's
  // exclusive section (ADR-0025) and one that deadlocks against it.
  const root = project();
  const searcher = searchStub();
  let searchedWhileLocked = false;
  let lockHeldDuringSearch = false;

  withLock(root, () => {
    assert.equal(holdsLock(root), true, 'the premise failed - no lock was held');
    const found = searcher.search('q', { limit: 3 });
    searchedWhileLocked = found.ok;
    lockHeldDuringSearch = holdsLock(root);
  });

  assert.equal(searchedWhileLocked, true, 'a search could not complete while the corpus was locked');
  assert.equal(lockHeldDuringSearch, true, 'the search released a lock it never took');
  assert.equal(holdsLock(root), false, 'the lock outlived its block');
});

test('CONCURRENCY: a search writes nothing to the corpus - the reason it needs no lock', () => {
  // The justification, made checkable. If a search ever starts writing, this fails and
  // the test above stops being a valid argument.
  const root = project();
  const before = snapshot(root);

  const found = searchStub().search('q', { limit: 3 });
  assert.equal(found.ok, true);

  assert.deepEqual(snapshot(root), before, 'a search modified the corpus');
});

test('CONCURRENCY: the SERPAPI adapter writes nothing either, on success and on failure', () => {
  const root = project();
  const before = snapshot(root);

  serpapi.search('q', { key: 'k'.repeat(40), job: () => ({ ok: true, payload: { organic_results: [] } }) });
  serpapi.search('q', { key: 'k'.repeat(40), job: () => ({ ok: false, error: 'down' }) });
  serpapi.search('q', { env: {}, config: null });

  assert.deepEqual(snapshot(root), before, 'the search provider touched the corpus');
});

test('CONCURRENCY: two processes collecting with DIFFERENT search providers keep one chain', () => {
  // The real shape of the risk: two runs, two search providers, one corpus. If the search
  // side had taken the lock, or if `discoveredBy` had raced the entry it belongs to, this
  // is where it would show.
  const root = project();
  const files = ['alpha', 'beta'].map((tag, i) => {
    const file = path.join(root, `driver-${tag}.mjs`);
    fs.writeFileSync(file, `
import { runResearch } from ${JSON.stringify(pathToFileURL(path.join(KIT_ROOT, 'lib/research-run.mjs')).href)};
const MARKDOWN = 'x'.repeat(2000);
const fetcher = {
  name: 'stub-fetch',
  search: () => ({ ok: true, query: 'q', results: [] }),
  runScrape: (url) => ({ ok: true, url, markdown: MARKDOWN, title: 'T', statusCode: 200, transport: 'stub-fetch', completeness: 'full', command: 'stub' }),
};
const searcher = {
  name: ${JSON.stringify(`search-${tag}`)},
  search: () => ({ ok: true, query: 'q', provider: ${JSON.stringify(`search-${tag}`)}, searchesUsed: 1,
    results: [{ url: ${JSON.stringify(`https://${tag}.example/page`)}, title: 'T', description: '', position: 1 }] }),
};
runResearch(${JSON.stringify(root)}, {
  adapter: fetcher, searchAdapter: searcher,
  plan: { topic:'t', depth:'normal', refreshDays:30, limit:5, perQuery:1, maxScrapes:5, prefer:[],
          queries:[{ q:'a query', why:'U-1' }], urls:[] },
});
`);
    return file;
  });

  const running = files.map((file) => spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 60_000 }));
  for (const result of running) assert.equal(result.status, 0, result.stderr);

  const ledger = readLedger(root);
  assert.equal(ledger.problems.length, 0, `the chain broke: ${JSON.stringify(ledger.problems)}`);
  assert.equal(ledger.entries.length, 2, 'one of the two collections was lost');

  // Each entry names the provider that actually ranked ITS url - the two did not cross.
  for (const entry of ledger.entries) {
    const tag = entry.url.includes('alpha') ? 'alpha' : 'beta';
    assert.equal(entry.discoveredBy, `search-${tag}`,
      `${entry.url} was credited to the wrong provider`);
    assert.equal(entry.transport, 'stub-fetch');
  }

  const providers = readCorpus(root).evidence.length;
  assert.equal(providers, 2, 'the evidence rows collided');
});

test('CONCURRENCY: both runs are recorded in the usage log, one line each', () => {
  const root = project();
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub({ name: 'search-a' }), plan: plan() });
  runResearch(root, { adapter: fetchStub({ results: ['https://second.example/b'] }), searchAdapter: searchStub({ name: 'search-b', results: ['https://second.example/b'] }), plan: plan() });

  const rows = jsonLines(root, '.usage.jsonl');
  assert.equal(rows.length, 2, 'a run was swallowed by the other');
  assert.deepEqual(rows.map((r) => r.searchTransport), ['search-a', 'search-b']);
});

// Found 2026-09-27: Firecrawl search credits never reached the usage log or --status.
test('DR-1: a search\'s estimated credits reach the run, the usage log and the summary', () => {
  const root = project();
  const searcher = searchStub();
  const base = searcher.search;
  searcher.search = (...args) => ({ ...base(...args), creditsEstimate: 2 });
  const run = runResearch(root, { adapter: fetchStub(), searchAdapter: searcher, plan: plan() });
  assert.equal(run.searchCreditsEstimate, 2);
  const [usage] = jsonLines(root, '.usage.jsonl');
  assert.equal(usage.searchCreditsEstimate, 2, 'the usage row lost the estimate');
  assert.match(searchSummaryLine(run), /≈2 credits/);
  assert.equal(searchUsage(root).creditsEstimate, 2, '--status cannot see it');
});

test('DR-1: decompose records its searches\' estimated credits too', () => {
  const root = project();
  const adapter = fetchStub();
  adapter.search = () => ({ ok: true, query: 'q', searchesUsed: 1, creditsEstimate: 2, results: [] });
  decompose(root, { topic: 'seam probe', adapter, searchAdapter: adapter, maxScrapes: 0, log: () => {} });
  const [usage] = jsonLines(root, '.usage.jsonl');
  assert.ok(usage, 'decompose wrote no usage row');
  assert.equal(usage.searchesUsed, 4);
  assert.equal(usage.searchCreditsEstimate, 8);
});

// Found 2026-09-27: a keyless plan query came back with no results, and research.mjs printed
// only "collected 0, failed 0" - nothing said a search had run, let alone found nothing.
test('RR-8: each search says what it found, and one that found nothing is recorded', () => {
  const root = project();
  const lines = [];
  runResearch(root, { adapter: fetchStub(), searchAdapter: searchStub({ results: [] }), plan: plan(), log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => /found nothing/.test(l) && /a query/.test(l)), `nothing said the search was empty:\n${lines.join('\n')}`);
  const failures = jsonLines(root, '.failures.jsonl');
  assert.ok(failures.some((f) => f.op === 'search-empty' && f.query === 'a query'), 'the empty search is not in the failure log');

  const found = [];
  runResearch(project(), { adapter: fetchStub(), searchAdapter: searchStub(), plan: plan(), log: (l) => found.push(l) });
  assert.ok(found.some((l) => /found 1\b/.test(l)), `a search that found something is not reported:\n${found.join('\n')}`);
});

// Found 2026-09-27: SerpAPI returned only generic "postgres" pages (home page, Reddit,
// Wikipedia, forums) for "postgres pg_sync_replication_slots function", and the kit scraped
// the home page - a page about nothing the query asked - because ranking read only URLs.
test('RR-9: a search whose results all miss the query spends no scrape, and says so', () => {
  const root = project();
  const offTopic = searchStub({ results: ['https://www.postgresql.org/', 'https://www.reddit.com/r/x/postgres_scale', 'https://en.wikipedia.org/wiki/PostgreSQL'] });
  const base = offTopic.search;
  offTopic.search = (...a) => { const r = base(...a); r.results = r.results.map((row, i) => ({ ...row, title: ['PostgreSQL: The world\'s most advanced open source database', 'At what scale does just use postgres stop being enough?', 'PostgreSQL - Wikipedia'][i] })); return r; };
  const fetcher = fetchStub();
  const lines = [];
  const run = runResearch(root, {
    adapter: fetcher, searchAdapter: offTopic, log: (l) => lines.push(l),
    plan: plan({ queries: [{ q: 'postgres pg_sync_replication_slots function', why: 'U-1' }] }),
  });
  assert.equal(fetcher.calls.scrape, 0, 'a page that matched nothing in the query was scraped');
  assert.equal(run.spent, 0);
  assert.ok(lines.some((l) => /no result matched/.test(l)), `the skip was silent:\n${lines.join('\n')}`);
  assert.ok(jsonLines(root, '.failures.jsonl').some((f) => f.op === 'search-off-topic'), 'the skip is not in the failure log');
});

test('RR-9: a result that carries the query\'s terms is still selected', () => {
  const root = project();
  const good = searchStub({ results: ['https://www.postgresql.org/docs/current/logical-replication-failover.html'] });
  const base = good.search;
  good.search = (...a) => { const r = base(...a); r.results[0].title = 'PostgreSQL: Documentation: 18: 29.3. Logical Replication Failover'; return r; };
  const fetcher = fetchStub();
  runResearch(root, { adapter: fetcher, searchAdapter: good, plan: plan({ queries: [{ q: 'postgres logical replication failover slots', why: 'U-1' }] }) });
  assert.equal(fetcher.calls.scrape, 1, 'an on-topic result was rejected');
});

test('RR-9: a result on a domain the plan prefers is kept even when its title is terse', () => {
  const root = project();
  const terse = searchStub({ results: ['https://docs.example.com/pricing'] });
  const base = terse.search;
  terse.search = (...a) => { const r = base(...a); r.results[0].title = 'Pricing'; return r; };
  const fetcher = fetchStub();
  runResearch(root, { adapter: fetcher, searchAdapter: terse, plan: plan({ prefer: ['docs.example.com'], queries: [{ q: 'example rate limits', why: 'U-1' }] }) });
  assert.equal(fetcher.calls.scrape, 1, 'the operator\'s own preferred domain was overruled');
});

// Found 2026-09-27, the day the floor shipped: "half the terms" kept 2 of the 38 pages real
// searches had found across this repository's corpora. A long query - the CI collector's
// default is the whole topic sentence - asks a title for more words than a title has. The
// EUDR run's decisive page carried 3 of its topic's ~10 terms and would have been rejected.
test('RR-9: a long query does not reject the page that answers it', () => {
  const query = 'EU Deforestation Regulation 2023/1115 application date large operators SMEs current after delay';
  assert.equal(matchesQuery({ url: 'https://example.invalid/eudr', title: 'EU Deforestation Regulation application postponed to 30 December 2026' }, query), true);
  assert.equal(matchesQuery({ url: 'https://www.postgresql.org/', title: 'PostgreSQL: The world\'s most advanced open source database' }, 'postgres pg_sync_replication_slots function'), false,
    'the case the floor exists for must still be caught');
});

// Found 2026-09-29, real use on MoonAliza: the topic "Ollama's OpenAI-compatible ..." made
// the term "ollama s", which no page carries, so a product's own name in the possessive
// stopped counting - the one term every page about that product shares.
test('RR-9: a possessive counts as the word it belongs to', () => {
  assert.ok(queryTerms("Ollama's OpenAI\u2019s streaming").includes('ollama'), queryTerms("Ollama's OpenAI\u2019s streaming").join('|'));
  assert.ok(queryTerms("Ollama's OpenAI\u2019s streaming").includes('openai'));
  assert.equal(matchesQuery({ url: 'https://docs.ollama.com/api/streaming', title: 'Streaming - Ollama' }, "Ollama's streaming responses"), true);
});

test('RR-9: every cited page a search found in this repository\'s corpora passes the floor', () => {
  const repo = path.resolve(KIT_ROOT, '..');
  const decisions = path.join(repo, 'docs', 'decisions');
  const roots = [repo, ...(fs.existsSync(decisions) ? fs.readdirSync(decisions).map((d) => path.join(decisions, d)) : [])];
  let judged = 0;
  const rejected = [];
  for (const root of roots) {
    const raw = path.join(root, 'research', 'raw');
    if (!fs.existsSync(path.join(raw, '.fetches.jsonl'))) continue;
    const corpus = readCorpus(root);
    const plan = corpus.plan ?? {};
    const queries = (plan.queries ?? []).map((q) => (typeof q === 'string' ? { q } : q)).filter((q) => q?.q);
    const asked = queries.length ? queries : [{ q: plan.topic ?? '' }];
    const found = new Set(corpus.ledger.entries.filter((e) => e.discoveredBy).map((e) => e.raw));
    const cited = new Set(corpus.unknowns.flatMap((u) => u.cites.map((id) => id.toUpperCase())));
    for (const row of corpus.evidence) {
      if (!found.has(row.raw) || !cited.has(row.id.toUpperCase())) continue;
      const title = (readText(path.join(root, row.raw), '').match(/^title: (.*)$/m) ?? [])[1] ?? '';
      judged += 1;
      const kept = asked.some((q) => matchesQuery({ url: row.url, title }, q.q)
        || isPreferred(row.url, [...(plan.prefer ?? []), ...(Array.isArray(q.prefer) ? q.prefer : [])]));
      if (!kept) rejected.push(`${path.relative(repo, root) || '.'} ${row.id} ${title || row.url}`);
    }
  }
  assert.ok(judged > 0, 'no corpus was judged - the test is not looking where the corpora are');
  assert.deepEqual(rejected, [], 'the floor rejects evidence a real research pass relied on');
});

// Found 2026-09-27 reviewing ADR-0065's change: decompose's fallback branch added the
// fallback search's estimated credits twice - an edit matched a substring of a deeper line.
test('DR-1: decompose counts a fallback search\'s credits once', () => {
  const root = project();
  const adapter = fetchStub();
  adapter.search = () => ({ ok: true, query: 'q', searchesUsed: 1, creditsEstimate: 2, results: [] });
  const failing = { name: 'failing-search', search: () => ({ ok: false, query: 'q', results: [], error: 'down' }) };
  decompose(root, { topic: 'seam probe', adapter, searchAdapter: failing, maxScrapes: 0, log: () => {} });
  const [usage] = jsonLines(root, '.usage.jsonl');
  assert.equal(usage.searchesUsed, 4, 'four fallback searches');
  assert.equal(usage.searchCreditsEstimate, 8, 'each fallback search is 2 credits, counted once');
});

// Found 2026-09-27 reviewing RR-8/RR-9: a MERGED search (two providers) was never recorded as
// empty or off-topic - only the single-provider path reported them.
test('RR-8/RR-9: a merged search that is empty, or off-topic, is recorded like a single one', () => {
  const empty = project();
  runResearch(empty, {
    adapter: fetchStub(), searchAdapters: [searchStub({ name: 'one', results: [] }), searchStub({ name: 'two', results: [] })],
    plan: plan({ queries: [{ q: 'postgres logical replication failover', why: 'U-1' }] }), log: () => {},
  });
  assert.ok(jsonLines(empty, '.failures.jsonl').some((f) => f.op === 'search-empty'), 'an empty merged search was not recorded');

  const offTopic = project();
  const fetcher = fetchStub();
  runResearch(offTopic, {
    adapter: fetcher, searchAdapters: [searchStub({ name: 'one', results: ['https://x.invalid/a'] }), searchStub({ name: 'two', results: ['https://y.invalid/b'] })],
    plan: plan({ queries: [{ q: 'postgres logical replication failover', why: 'U-1' }] }), log: () => {},
  });
  assert.equal(fetcher.calls.scrape, 0);
  assert.ok(jsonLines(offTopic, '.failures.jsonl').some((f) => f.op === 'search-off-topic'), 'an off-topic merged search was not recorded');
});

// Found 2026-09-27 reviewing RR-9: `decompose --max-scrapes` scrapes search results through
// its own loop, which never applied the relevance floor.
test('RR-9: decompose scrapes only results that carry the query that found them', () => {
  const root = project();
  const adapter = fetchStub();
  adapter.search = () => ({ ok: true, query: 'q', results: [
    { url: 'https://www.postgresql.org/', title: 'PostgreSQL: The world\'s most advanced open source database' },
    { url: 'https://www.postgresql.org/docs/current/logical-replication-failover.html', title: 'Logical Replication Failover' },
  ] });
  const scraped = [];
  const base = adapter.runScrape.bind(adapter);
  adapter.runScrape = (url) => { scraped.push(url); return base(url); };
  decompose(root, { topic: 'postgres logical replication failover slots', adapter, searchAdapter: adapter, maxScrapes: 5, log: () => {} });
  assert.deepEqual(scraped, ['https://www.postgresql.org/docs/current/logical-replication-failover.html'], `scraped: ${scraped.join(', ')}`);
});
