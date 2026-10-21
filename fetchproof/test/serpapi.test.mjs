// The search-only provider, and the seam that selects it (ADR-0027).
//
// Requirement ids (TR-#, SR-#, RR-#, FR-#, IR-#, DR-#) refer to
// docs/requirements-2026-09-19-search-fetch-seam.md. A test that cannot name what it
// defends is a test nobody dares delete.
//
// TR-1 forbids inventing a vendor payload, so the normal path replays
// `fixtures/serpapi-search-2026-09-19.json` - a real response captured from this machine
// on 2026-09-19 for the query "research kit provenance ledger". One edit was made to it:
// every `serpapi.com/searches/<account-path>/` segment is replaced with
// `ACCOUNT-PATH-REDACTED`. Those are capability URLs that read the stored search back,
// and they do not belong in a repository. The search id is preserved because `searchId()`
// reads it; nothing else is touched.

import { test, describe, assert, fs, path, KIT_ROOT, tempDir } from './harness.mjs';
import * as serpapi from '../lib/serpapi.mjs';
import {
  SEARCH_PROVIDERS, SEARCH_PROVIDER_NAMES, FETCH_SHAPE, SEARCH_SHAPE,
  satisfies, isSearchOnly, selectSearch, selectTransport, firecrawl, httpKeyless,
} from '../lib/transport.mjs';

describe('serpapi');

// A key-SHAPED sentinel, assembled at runtime so the secret scanner has nothing to find
// and no exclusion has to be carved for this file (SR-4).
const SENTINEL = ['4', '7', 'c', 'e'].join('') + 'a'.repeat(60);

const REAL = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'test/fixtures/serpapi-search-2026-09-19.json'), 'utf8'));

/** A job function that answers with whatever the test wants, and counts its calls. */
function stubJob(answer) {
  const calls = [];
  const fn = (job) => { calls.push(job); return typeof answer === 'function' ? answer(job) : answer; };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------- TR-1  the normal path

test('TR-1: the real captured response parses into the kit shape', () => {
  const r = serpapi.search('research kit provenance ledger', { key: SENTINEL, limit: 20, job: stubJob({ ok: true, payload: REAL }) });
  assert.equal(r.ok, true);
  assert.equal(r.results.length, REAL.organic_results.length,
    'every organic result in the real payload should survive normalisation');
  assert.equal(r.searchId, '6aaee0d6a26f56b3a3769324');
  assert.equal(r.searchesUsed, 1);

  const first = r.results[0];
  assert.equal(first.url, REAL.organic_results[0].link, 'link maps to url');
  assert.equal(first.description, REAL.organic_results[0].snippet, 'snippet maps to description');
  assert.equal(first.title, REAL.organic_results[0].title);
  assert.equal(first.position, REAL.organic_results[0].position);
  for (const row of r.results) {
    assert.ok(row.url.startsWith('http'), `a candidate the collector cannot fetch got through: ${JSON.stringify(row)}`);
  }
});

test('TR-1: the fixture is a REAL payload, not a hand-written one', () => {
  // The three markers that a hand-written fixture would not bother to carry. If this
  // ever fails, somebody replaced the capture with a convenient invention.
  assert.ok(REAL.search_metadata, 'no search_metadata - not a real response');
  assert.equal(REAL.search_parameters.engine, 'google');
  assert.ok(Number.isFinite(REAL.search_metadata.total_time_taken), 'no timing - not a real response');
  assert.ok(Object.keys(REAL).length > 4, 'a real response carries more than the fields we read');
});

test('TR-1/SR-1: the fixture carries no credential and no capability URL', () => {
  const text = JSON.stringify(REAL);
  assert.equal(/api_key/.test(text), false, 'the fixture names an api_key parameter');
  assert.equal(/serpapi\.com\/searches\/(?!ACCOUNT-PATH-REDACTED)[A-Za-z0-9_-]{20,}/.test(text), false,
    'an un-redacted account-scoped capability URL survived in the fixture');
});

// ---------------------------------------------------------------- TR-2  edges

test('TR-2: an empty result set is a SUCCESS with no candidates, not a failure', () => {
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload: { search_metadata: { id: 'x' }, organic_results: [] } }) });
  assert.equal(r.ok, true, 'a search that found nothing still ran, and still cost a search');
  assert.deepEqual(r.results, []);
  assert.equal(r.searchesUsed, 1, 'the vendor bills an empty result set as one search');
});

test('TR-2: a payload with no organic_results at all is empty, not a crash', () => {
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload: { search_metadata: { id: 'x' } } }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results, []);
});

test('TR-2: limit is applied CLIENT-side, because no count parameter is sent (IR-4)', () => {
  const job = stubJob({ ok: true, payload: REAL });
  const r = serpapi.search('q', { key: SENTINEL, limit: 3, job });
  assert.equal(r.results.length, 3);
  const sent = job.calls[0];
  // Deliberately an EXACT set rather than a "does not contain num" check. It caught the
  // `endpoint` field the moment that was added, which is the behaviour worth keeping:
  // anything new reaching the child should be noticed here and justified, not absorbed.
  assert.deepEqual(Object.keys(sent).sort(), ['apiKey', 'endpoint', 'kind', 'query', 'timeout'],
    'the job carries only what the child needs - a count parameter here would be an undocumented one');
  assert.equal(sent.endpoint, serpapi.ENDPOINT, 'the default job should target the vendor, not a test server');
});

test('TR-2: a limit larger than the result set returns everything, not padding', () => {
  const r = serpapi.search('q', { key: SENTINEL, limit: 500, job: stubJob({ ok: true, payload: REAL }) });
  assert.equal(r.results.length, REAL.organic_results.length);
});

test('TR-2: rows with no link are dropped - a candidate that cannot be fetched is not one', () => {
  const payload = { organic_results: [
    { position: 1, title: 'has one', link: 'https://a.example/1', snippet: 's' },
    { position: 2, title: 'has none' },
    { position: 3, title: 'empty string', link: '' },
  ] };
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload }) });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].url, 'https://a.example/1');
});

test('TR-2: a query needing URL encoding survives into the command rendering', () => {
  const r = serpapi.search('a b&c=d #e', { key: SENTINEL, job: stubJob({ ok: true, payload: REAL }) });
  assert.ok(r.cmd.includes(encodeURIComponent('a b&c=d #e')), `query was not encoded: ${r.cmd}`);
  assert.equal(r.query, 'a b&c=d #e', 'the reported query is the operator\'s, not the encoded form');
});

// ---------------------------------------------------------------- TR-3  invalid input

test('TR-3: no key is a refusal that names both places a key may live (FR-5)', () => {
  const job = stubJob({ ok: true, payload: REAL });
  const r = serpapi.search('q', { env: {}, config: null, job });
  assert.equal(r.ok, false);
  assert.match(r.error, /SERPAPI_API_KEY/);
  assert.match(r.error, /serpapiKey/);
  assert.equal(job.calls.length, 0, 'a request was made with no key - that spends a round trip to learn nothing');
});

test('TR-3: a vendor error payload is the vendor\'s own words, and is NOT a crash', () => {
  // Documented: "If a search has failed, `error` will contain an error message."
  for (const message of [
    'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key',
    'Your account has run out of searches.',
    "We couldn't find your account.",
  ]) {
    const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload: { error: message } }) });
    assert.equal(r.ok, false);
    assert.equal(r.error, message);
    assert.deepEqual(r.results, [], 'a failed search must not hand back candidates');
  }
});

test('TR-3: an exhausted monthly allowance is an ordinary outcome (RR-3)', () => {
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload: { error: 'Your account has run out of searches.' } }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /run out of searches/);
  // The point of the test: it RETURNED. Nothing threw.
});

test('TR-3: a non-JSON body is reported as one, with its size', () => {
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: false, statusCode: 502, error: 'serpapi returned HTTP 502 with a non-JSON body (1024 bytes)' }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /non-JSON body/);
});

test('TR-3: HTTP failures arrive as failures, not as empty successes', () => {
  for (const code of [401, 429, 500, 503]) {
    const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: false, statusCode: code, error: `serpapi returned HTTP ${code}` }) });
    assert.equal(r.ok, false, `HTTP ${code} was read as a success`);
    assert.match(r.error, new RegExp(String(code)));
  }
});

test('TR-3: an unparseable answer from the child is a failure, not a throw', () => {
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: false, error: 'serpapi transport emitted unparseable output: Unexpected end of JSON input' }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /unparseable/);
});

test('TR-3: a null payload does not become a null-dereference', () => {
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload: null }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results, []);
  assert.equal(r.searchId, null);
});

// ---------------------------------------------------------------- TR-4  failure modes

test('TR-4: transport failures are returned, never thrown (IR-6)', () => {
  for (const error of [
    'connect ETIMEDOUT 104.18.10.10:443',
    'getaddrinfo ENOTFOUND serpapi.com',
    'read ECONNRESET',
    'The operation was aborted due to timeout',
  ]) {
    const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: false, error }) });
    assert.equal(r.ok, false);
    assert.equal(r.error, error);
  }
});

test('TR-4: one search makes exactly ONE request - no retry loop inside the adapter', () => {
  const job = stubJob({ ok: false, error: 'read ECONNRESET' });
  serpapi.search('q', { key: SENTINEL, job });
  assert.equal(job.calls.length, 1, 'the adapter retried; retry policy belongs to the caller (RR-2)');
});

// ---------------------------------------------------------------- TR-7  the credential

test('SR-2: the rendered command never carries the key', () => {
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload: REAL }) });
  assert.equal(r.cmd.includes(SENTINEL), false, `the key reached the cmd string: ${r.cmd}`);
  assert.match(r.cmd, /api_key=\*\*\*REDACTED\*\*\*/);
  assert.equal(serpapi.command('q').includes(SENTINEL), false);
});

test('SR-3: a key echoed back in vendor error text is scrubbed before anyone sees it', () => {
  // Vendors echo the request URL in errors, and this vendor's request URL holds the key.
  const leaky = `connect ETIMEDOUT https://serpapi.com/search?engine=google&q=x&api_key=${SENTINEL}`;
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: false, error: leaky }) });
  assert.equal(r.error.includes(SENTINEL), false, `the key survived into the error: ${r.error}`);
  assert.match(r.error, /\*\*\*REDACTED\*\*\*/);
});

test('SR-3: a key echoed inside a vendor ERROR PAYLOAD is scrubbed too', () => {
  const r = serpapi.search('q', {
    key: SENTINEL,
    job: stubJob({ ok: true, payload: { error: `Invalid API key: ${SENTINEL}` } }),
  });
  assert.equal(r.error.includes(SENTINEL), false, 'the payload path skipped redaction');
});

test('SR-3: NO field of a returned result object carries the key, whatever the path', () => {
  const leak = `x ${SENTINEL} y`;
  const cases = [
    serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload: REAL }) }),
    serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: false, error: leak }) }),
    serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload: { error: leak } }) }),
    serpapi.search(SENTINEL, { key: SENTINEL, job: stubJob({ ok: true, payload: REAL }) }),
  ];
  for (const [i, r] of cases.entries()) {
    assert.equal(JSON.stringify(r).includes(SENTINEL), false, `case ${i} leaked the key: ${JSON.stringify(r).slice(0, 200)}`);
  }
});

test('SR-2: a query CONTAINING the key is refused, and nothing is transmitted', () => {
  // The defect this suite found. `cmd` interpolates the query and `cmd` is written into
  // the hash-chained ledger, which is committed - so a key pasted into a query box would
  // have been recorded in git. Redacting `cmd` was the small fix; refusing to send is
  // the right one, because transmitting would store the credential as a search term on
  // the vendor's systems for 31 days.
  const job = stubJob({ ok: true, payload: REAL });
  const r = serpapi.search(`site:example.com ${SENTINEL}`, { key: SENTINEL, job });

  assert.equal(r.ok, false);
  assert.equal(job.calls.length, 0, 'the request was SENT - the key reached the vendor as a search term');
  assert.match(r.error, /contains your SerpAPI key/);
  assert.match(r.error, /Nothing was transmitted/);
  assert.equal(JSON.stringify(r).includes(SENTINEL), false, 'the refusal itself leaked the key');
});

test('SR-2: command() redacts a key inside the query even when called directly', () => {
  // Defence in depth: `search()` refuses first, but `command()` is exported and the
  // ledger annotation is built from it.
  const rendered = serpapi.command(`a ${SENTINEL} b`, SENTINEL);
  assert.equal(rendered.includes(SENTINEL), false, `command() leaked the key: ${rendered}`);
  assert.match(rendered, /REDACTED/);
});

test('SR-2: an ordinary query is not mangled by the credential guard', () => {
  // The guard must not fire on anything that merely looks key-ish, or it would quietly
  // refuse real research.
  const job = stubJob({ ok: true, payload: REAL });
  const r = serpapi.search('SerpAPI pricing free plan api_key documentation', { key: SENTINEL, job });
  assert.equal(r.ok, true);
  assert.equal(job.calls.length, 1);
  assert.equal(r.query, 'SerpAPI pricing free plan api_key documentation');
});

test('SR-1: readKey prefers the environment, falls back to config, and is empty otherwise', () => {
  assert.equal(serpapi.readKey({ env: { SERPAPI_API_KEY: SENTINEL }, config: { serpapiKey: 'other' } }), SENTINEL);
  assert.equal(serpapi.readKey({ env: {}, config: { serpapiKey: SENTINEL } }), SENTINEL);
  assert.equal(serpapi.readKey({ env: {}, config: {} }), '');
  assert.equal(serpapi.readKey({ env: { SERPAPI_API_KEY: '   ' }, config: {} }), '', 'whitespace is not a key');
});

test('SR-1: a key held ONLY in the machine config reaches the request - selection is not enough', () => {
  // Found 2026-09-26: selectSearch read `serpapiKey` from the machine config and chose SerpAPI,
  // but search() was called without a config and read only the environment - so every search
  // failed "no SerpAPI key" while the status line said a key was configured. The merged run
  // then fell back to the other provider on every query, and the second meter was never used.
  const dir = tempDir('fp-cfgkey-');
  fs.writeFileSync(path.join(dir, 'fetchproof.config.json'), JSON.stringify({ serpapiKey: SENTINEL }));
  const env = { FETCHPROOF_CONFIG: path.join(dir, 'fetchproof.config.json') };
  const job = stubJob({ ok: true, payload: REAL });
  const r = serpapi.search('q', { env, job });
  assert.equal(r.ok, true, `a configured key was not used: ${r.error}`);
  assert.equal(job.calls[0]?.apiKey, SENTINEL);
  // An EXPLICIT null still means "no config" - the deterministic form every other test uses.
  assert.equal(serpapi.search('q', { env, config: null, job: stubJob({ ok: true, payload: REAL }) }).ok, false);
});

test('SR-3: redact refuses to act on a string too short to be a key', () => {
  // Replacing a 2-character "key" would turn every occurrence of those characters into
  // noise, which hides more than it protects.
  assert.equal(serpapi.redact('the cat sat', 'at'), 'the cat sat');
  assert.equal(serpapi.redact('abcdefghij and more', 'abcdefghij'), '***REDACTED*** and more');
  assert.equal(serpapi.redact(null, SENTINEL), '');
});

test('SR-5: status reports credential presence and DECLINES to guess an allowance', () => {
  const off = serpapi.status({ env: {}, config: null });
  assert.equal(off.authenticated, false);
  assert.match(off.raw, /SERPAPI_API_KEY/);

  const on = serpapi.status({ env: { SERPAPI_API_KEY: SENTINEL } });
  assert.equal(on.authenticated, true);
  assert.equal(on.source, 'SERPAPI_API_KEY');
  assert.equal(on.searchesRemaining, null, 'status() stays offline - the vendor count is account()\'s job (E-26, ADR-0040)');
  assert.equal(on.raw.includes(SENTINEL), false, 'status leaked the key');
});

// ---------------------------------------------------------------- ADR-0040  the vendor's meter

const ACCOUNT = {
  account_id: 'acct-should-never-leave', api_key: SENTINEL, account_email: 'someone@example.invalid',
  account_status: 'Active', plan_name: 'Free Plan', searches_per_month: 250, plan_searches_left: 98,
  total_searches_left: 98, this_month_usage: 152, this_hour_searches: 9, account_rate_limit_per_hour: 250,
  plan_renewal_date: '2026-10-14',
};

test('ADR-0040: account() reads the vendor meter into named fields', () => {
  const job = stubJob({ ok: true, payload: ACCOUNT });
  const r = serpapi.account({ key: SENTINEL, job });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.account, {
    plan: 'Free Plan', perMonth: 250, perHour: 250, usedThisCycle: 152, left: 98, thisHour: 9, renews: '2026-10-14',
  });
  assert.equal(job.calls[0].kind, 'serpapi-account');
});

test('ADR-0040 / SR-3: only WHITELISTED fields leave - no key, no email, no account id', () => {
  const r = serpapi.account({ key: SENTINEL, job: stubJob({ ok: true, payload: ACCOUNT }) });
  const out = JSON.stringify(r);
  assert.equal(out.includes(SENTINEL), false, 'the key reached the result');
  assert.equal(out.includes('example.invalid'), false, 'the account email reached the result');
  assert.equal(out.includes('acct-should-never-leave'), false, 'the account id reached the result');
});

test('ADR-0040: a missing or non-numeric field is null, never a guess', () => {
  const r = serpapi.account({ key: SENTINEL, job: stubJob({ ok: true, payload: { searches_per_month: '250', plan_renewal_date: null } }) });
  assert.equal(r.ok, true);
  assert.equal(r.account.perMonth, null);
  assert.equal(r.account.renews, null, 'accounts without a monthly plan have no renewal date (E-26)');
});

test('ADR-0040: no key is a refusal, and nothing is requested', () => {
  const job = stubJob({ ok: true, payload: ACCOUNT });
  const r = serpapi.account({ env: {}, config: null, job });
  assert.equal(r.ok, false);
  assert.match(r.error, /SERPAPI_API_KEY/);
  assert.equal(job.calls.length, 0);
});

test('ADR-0040 / SR-3: the endpoint override cannot send the key anywhere but the vendor or loopback', () => {
  const job = stubJob({ ok: true, payload: ACCOUNT });
  const r = serpapi.account({ key: SENTINEL, env: { [serpapi.ACCOUNT_ENDPOINT_ENV]: 'https://collector.evil.example/account.json' }, job });
  assert.equal(r.ok, false);
  assert.match(r.error, /refusing/);
  assert.equal(job.calls.length, 0, 'a request was built for a foreign host');
});

test('ADR-0040 / SR-3: a vendor error is returned in its own words, with the key scrubbed', () => {
  const r = serpapi.account({ key: SENTINEL, job: stubJob({ ok: true, payload: { error: `Invalid API key: ${SENTINEL}` } }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /Invalid API key/);
  assert.equal(r.error.includes(SENTINEL), false);
});

test('ADR-0040 / SR-1: a key held only in the machine config is used for the account read too', () => {
  const dir = tempDir('fp-cfgacct-');
  fs.writeFileSync(path.join(dir, 'fetchproof.config.json'), JSON.stringify({ serpapiKey: SENTINEL }));
  const job = stubJob({ ok: true, payload: ACCOUNT });
  const r = serpapi.account({ env: { FETCHPROOF_CONFIG: path.join(dir, 'fetchproof.config.json') }, job });
  assert.equal(r.ok, true, r.error);
  assert.equal(job.calls[0].apiKey, SENTINEL);
});

// ---------------------------------------------------------------- AR-3  the refusal

test('AR-3: asked to fetch, it refuses BY NAME rather than failing as a missing function', () => {
  for (const op of ['scrape', 'runScrape', 'map']) {
    assert.throws(() => serpapi[op]('https://example.com'), (err) => {
      assert.equal(err.code, 'SEARCH_ONLY_PROVIDER', `${op} threw the wrong kind of error`);
      assert.match(err.message, /search-only/);
      return true;
    }, `${op} did not refuse`);
  }
});

test('AR-3: isSearchOnly reads the DECLARATION, not the presence of a scrape function', () => {
  // The trap this test exists for: serpapi exports `scrape` on purpose, to refuse by
  // name. Duck-typing "has no scrape" therefore answers false for the one module the
  // question is about. The first version of isSearchOnly got this exactly wrong.
  assert.equal(typeof serpapi.scrape, 'function', 'the premise of this test has changed');
  assert.equal(isSearchOnly(serpapi), true);
  assert.equal(isSearchOnly(firecrawl), false);
  assert.equal(isSearchOnly(httpKeyless), false);
  assert.deepEqual([...serpapi.CONTRACTS], ['search']);
});

// ---------------------------------------------------------------- AR-2  the contracts

test('AR-2: the two shapes are declared, and each module keeps the one it claims', () => {
  assert.deepEqual([...SEARCH_SHAPE], ['name', 'search']);
  assert.ok(FETCH_SHAPE.includes('runScrape') && FETCH_SHAPE.includes('scrape'));

  assert.equal(satisfies(serpapi, SEARCH_SHAPE), true);
  assert.equal(satisfies(firecrawl, FETCH_SHAPE), true);
  assert.equal(satisfies(httpKeyless, FETCH_SHAPE), true);
  assert.equal(satisfies(null, SEARCH_SHAPE), false);
  assert.equal(satisfies({ name: 'x' }, SEARCH_SHAPE), false, 'a name alone is not a search provider');
});

test('AR-2: the search registry is SEPARATE from the fetch registry', () => {
  // A search-only module inside TRANSPORTS would make ADAPTER_SHAPE a claim that map no
  // longer keeps, and `--transport serpapi` would hand back a run that cannot fetch.
  assert.ok(SEARCH_PROVIDER_NAMES.includes('serpapi'));
  assert.equal(SEARCH_PROVIDERS.serpapi.name, 'serpapi');
  const fetchNames = Object.keys(SEARCH_PROVIDERS).filter((n) => !isSearchOnly(SEARCH_PROVIDERS[n]));
  assert.deepEqual(fetchNames, ['firecrawl-cli', 'http-keyless'],
    'a fetch provider appeared in, or vanished from, the search registry');
});

// ---------------------------------------------------------------- TR-6  selection

const installed = () => ({ installed: true, authenticated: true, version: '1.0.0', credits: 900 });

test('TR-6: search precedence - flag, then env, then config, then auto-detect', () => {
  const side = { name: 'firecrawl-cli', adapter: firecrawl };

  assert.equal(selectSearch({ explicit: 'serpapi', env: {}, config: {}, fetchSide: side }).name, 'serpapi');
  assert.equal(selectSearch({ explicit: 'serpapi', env: { FETCHPROOF_SEARCH_TRANSPORT: 'http-keyless' }, config: { searchTransport: 'http-keyless' }, fetchSide: side }).name,
    'serpapi', 'the flag must outrank both env and config');
  assert.equal(selectSearch({ env: { FETCHPROOF_SEARCH_TRANSPORT: 'serpapi' }, config: { searchTransport: 'http-keyless' }, fetchSide: side }).name,
    'serpapi', 'env must outrank config');
  assert.equal(selectSearch({ env: {}, config: { searchTransport: 'http-keyless' }, fetchSide: side }).name, 'http-keyless');
});

test('FR-5: with NO key, the search side IS the fetch provider', () => {
  const side = { name: 'firecrawl-cli', adapter: firecrawl };
  const chosen = selectSearch({ env: {}, config: {}, fetchSide: side });
  assert.equal(chosen.name, 'firecrawl-cli');
  assert.equal(chosen.sameAsFetch, true);
  assert.equal(chosen.adapter, firecrawl, 'it must be the same object, not a lookalike');
});

test('FR-1: with a key, the search side moves to its own meter', () => {
  const side = { name: 'firecrawl-cli', adapter: firecrawl };
  const chosen = selectSearch({ env: { SERPAPI_API_KEY: SENTINEL }, config: {}, fetchSide: side });
  assert.equal(chosen.name, 'serpapi');
  assert.equal(chosen.searchOnly, true);
  assert.equal(chosen.sameAsFetch, undefined);
  assert.match(chosen.why, /own meter/);
});

test('FR-1: a key in the CONFIG selects it as surely as one in the environment', () => {
  const side = { name: 'firecrawl-cli', adapter: firecrawl };
  assert.equal(selectSearch({ env: {}, config: { serpapiKey: SENTINEL }, fetchSide: side }).name, 'serpapi');
});

test('TR-6: an unknown search provider is an error naming the ones that exist', () => {
  assert.throws(() => selectSearch({ explicit: 'bing', env: {}, config: {}, fetchSide: { name: 'x', adapter: firecrawl } }),
    (err) => {
      assert.equal(err.code, 'UNKNOWN_SEARCH_PROVIDER');
      assert.match(err.message, /serpapi/);
      return true;
    });
});

test('NFR-2: selectTransport still answers the OLD question the old way', () => {
  // The whole reason six call sites did not change. `name`/`adapter`/`why` keep meaning
  // the fetch provider; `search` is additive.
  const chosen = selectTransport({ explicit: 'http-keyless', env: {}, probe: installed, config: {} });
  assert.equal(chosen.name, 'http-keyless');
  assert.equal(chosen.adapter, httpKeyless);
  assert.equal(typeof chosen.why, 'string');
  assert.ok(chosen.search, 'the search side is missing');
  assert.equal(chosen.search.sameAsFetch, true, 'with no key the two sides must agree');
});

test('FR-1: the two sides are chosen INDEPENDENTLY', () => {
  const chosen = selectTransport({
    explicit: 'http-keyless',
    explicitSearch: 'serpapi',
    env: {}, probe: installed, config: {},
  });
  assert.equal(chosen.name, 'http-keyless', 'the fetch side moved when only the search side was asked to');
  assert.equal(chosen.search.name, 'serpapi');
});

test('AR-4: a search provider is never handed the fetch job', () => {
  const chosen = selectTransport({ explicitSearch: 'serpapi', env: {}, probe: installed, config: {} });
  assert.equal(isSearchOnly(chosen.adapter), false, 'the FETCH adapter is search-only - captures would be impossible');
  assert.equal(satisfies(chosen.adapter, FETCH_SHAPE), true);
});

// ---------------------------------------------------------------- IR-1..IR-3  the request

test('IR-1: the request carries EXACTLY engine, q and api_key - nothing else', () => {
  const url = serpapi.requestUrl('a query', SENTINEL);
  assert.equal(url.origin + url.pathname, 'https://serpapi.com/search');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['api_key', 'engine', 'q']);
  assert.equal(url.searchParams.get('engine'), 'google');
  assert.equal(url.searchParams.get('q'), 'a query');
  assert.equal(url.searchParams.get('api_key'), SENTINEL);
});

test('IR-2/IR-3/IR-4: no_cache, async and any count parameter are NEVER sent', () => {
  // The guarantee is negative, and negative guarantees are the ones that rot silently.
  // no_cache would forfeit the vendor's free 1-hour cache; async would require a second
  // endpoint; a count parameter is not documented at all.
  const url = serpapi.requestUrl('a query', SENTINEL);
  for (const forbidden of ['no_cache', 'async', 'num', 'start', 'zero_trace', 'output', 'json_restrictor']) {
    assert.equal(url.searchParams.has(forbidden), false, `the request sent "${forbidden}"`);
  }
});

test('IR-1: a query with reserved characters is encoded, not injected', () => {
  const url = serpapi.requestUrl('a&b=c#d e', SENTINEL);
  assert.equal(url.searchParams.get('q'), 'a&b=c#d e', 'the query did not round-trip - parameters were split');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['api_key', 'engine', 'q'],
    'a crafted query introduced a parameter');
});

test('IR-1: a query that tries to OVERRIDE a parameter cannot', () => {
  const url = serpapi.requestUrl('x&api_key=stolen&engine=evil', SENTINEL);
  assert.equal(url.searchParams.get('api_key'), SENTINEL);
  assert.equal(url.searchParams.get('engine'), 'google');
  assert.equal(url.searchParams.getAll('api_key').length, 1, 'a second api_key parameter was injected');
});

// ---------------------------------------------------------------- DR-5, DR-6

test('DR-5: cost is counted by the vendor\'s RULE, because the payload reports none', () => {
  // search_metadata carries id, status, json_endpoint and total_time_taken - no cost.
  assert.equal('creditsUsed' in REAL, false, 'the payload gained a cost field; DR-5 should be revisited');
  assert.equal(serpapi.searchesUsed(REAL), 1, 'a successful response is one search');
  assert.equal(serpapi.searchesUsed({ error: 'Invalid API key.' }), 0, 'a failed search was counted as spend');
  assert.equal(serpapi.searchesUsed(null), 0);
});

test('DR-6: the vendor\'s own response id is recorded, as the only reconciliation handle', () => {
  assert.equal(serpapi.searchId(REAL), REAL.search_metadata.id);
  assert.equal(serpapi.searchId({}), null);
  assert.equal(serpapi.searchId({ search_metadata: { id: '' } }), null, 'an empty id is not an id');
});

// ---------------------------------------------------------------- NFR-1, NFR-3, AR-1

test('NFR-1: the provider adds no dependency - node builtins only', () => {
  const source = fs.readFileSync(path.join(KIT_ROOT, 'lib/serpapi.mjs'), 'utf8');
  const imports = [...source.matchAll(/^import .*? from '([^']+)';/gm)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(spec.startsWith('node:') || spec.startsWith('./'),
      `serpapi.mjs imports "${spec}" - this kit has no dependencies`);
  }
});

test('NFR-3: the vendor is named in its own adapter and the registry, and nowhere else', () => {
  // A vendor name leaking into the collector or the checks is how a seam stops being one.
  const offenders = [];
  for (const file of fs.readdirSync(path.join(KIT_ROOT, 'lib'))) {
    if (!file.endsWith('.mjs') || file === 'serpapi.mjs' || file === 'transport.mjs') continue;
    const text = fs.readFileSync(path.join(KIT_ROOT, 'lib', file), 'utf8');
    // Comments may discuss it; code may not.
    const code = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (/serpapi/i.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, ['machine.mjs'],
    'the vendor name reached a module that should not know it. machine.mjs is the one '
    + 'allowed exception: it owns the config schema, and serpapiKey is a config key.');
});

test('AR-1: ONE module resolves provider choice, for both sides', () => {
  const offenders = [];
  for (const dir of ['lib', 'bin']) {
    for (const file of fs.readdirSync(path.join(KIT_ROOT, dir))) {
      if (!file.endsWith('.mjs')) continue;
      const full = path.join(KIT_ROOT, dir, file);
      if (full.endsWith(`${path.sep}transport.mjs`)) continue;
      const text = fs.readFileSync(full, 'utf8');
      // Importing the answer is fine; deciding it independently is not.
      if (/SEARCH_PROVIDERS\s*\[/.test(text)) offenders.push(`${dir}/${file}`);
    }
  }
  assert.deepEqual(offenders, [], 'a second module resolves a provider by itself');
});

// Found 2026-09-28 (Arena break test 9): one null row in organic_results threw a TypeError
// that discarded every valid result beside it, and a row whose link was an object or whose
// title was a number passed through as that type, to break whatever read it next.
test('TR-3: malformed result rows cannot crash or pollute the valid results', () => {
  const rows = [null, false, 12, 'bad', [], {}, { link: { bad: 'url' } },
    { link: 'https://a.example/', title: 42, snippet: [] },
    { url: 'https://b.example/', title: 'Valid', description: 'Kept', position: 2 }];
  const r = serpapi.search('q', { key: SENTINEL, job: stubJob({ ok: true, payload: { organic_results: rows } }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results, [
    { url: 'https://a.example/', title: '', description: '', position: null },
    { url: 'https://b.example/', title: 'Valid', description: 'Kept', position: 2 },
  ]);
});
