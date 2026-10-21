// The SearXNG search provider (ADR-0104). Research:
// docs/decisions/2026-09-30-searxng-search - E-01 (the Search API), E-02 (search.formats),
// E-05/E-06 (the JSON result fields, where `url` may be null).
//
// Offline: the parsing tests pass a payload in, the search tests inject a `job`, and the
// one end-to-end test runs the real child against a stand-in instance on loopback.

import { spawn } from 'node:child_process';
import { test, describe, assert, tempDir, fs, path } from './harness.mjs';
import * as searxng from '../lib/searxng.mjs';
import { selectSearch, SEARCH_PROVIDER_NAMES, isSearchOnly } from '../lib/transport.mjs';
import { loadConfig } from '../lib/machine.mjs';

describe('searxng');

const BASE = 'http://127.0.0.1:8888';
const noConfig = { searchTransport: '', searxngUrl: '' };

test('the request is GET <instance>/search with q and format=json, under a sub-path too', () => {
  const url = searxng.requestUrl(BASE, 'node fetch proxy');
  assert.equal(url.origin + url.pathname, 'http://127.0.0.1:8888/search');
  assert.equal(url.searchParams.get('q'), 'node fetch proxy');
  assert.equal(url.searchParams.get('format'), 'json');
  // An instance served under a path keeps it; a trailing slash or none makes no difference.
  for (const base of ['https://example.org/searx', 'https://example.org/searx/']) {
    assert.equal(searxng.requestUrl(base, 'q').pathname, '/searx/search', base);
  }
});

// Found 2026-09-30 (break-test, PR #174): the endpoint was resolved against the instance's
// whole href, so a query or fragment on it - `/searx?x=1`, `/searx#f` - swallowed the slash
// appended to it and the search went to /search at the root, not the instance under /searx.
test('a query or fragment on the instance URL does not lose its sub-path', () => {
  for (const base of ['https://example.org/searx?x=1', 'https://example.org/searx#f', 'https://example.org/searx/?x=1', 'https://me:pw@example.org/searx?t=1']) {
    const url = searxng.requestUrl(base, 'q');
    assert.equal(url.pathname, '/searx/search', base);
    assert.equal(url.hash, '', `${base} kept its fragment`);
    assert.deepEqual([...url.searchParams.keys()], ['q', 'format'], `${base}: the request carries only q and format, as before`);
  }
  assert.equal(searxng.requestUrl('https://example.org?x=1', 'q').pathname, '/search', 'an instance at the root stays at the root');
});

test('results map to candidate rows, and a row that is not an object or has no url is dropped', () => {
  const rows = searxng.normalizeSearch({
    query: 'q',
    results: [
      null, 7, 'x', [],
      { url: null, title: 'no url' },
      { url: 'https://a.example/page', title: 'A', content: 'snippet A', engine: 'bing' },
      { url: 'https://b.example/', title: 5, content: null },
    ],
  });
  assert.deepEqual(rows, [
    { url: 'https://a.example/page', title: 'A', description: 'snippet A', position: 1 },
    { url: 'https://b.example/', title: '', description: '', position: 2 },
  ]);
  assert.deepEqual(searxng.normalizeSearch(null), []);
  assert.deepEqual(searxng.normalizeSearch({ results: 'not a list' }), []);
});

test('with no instance configured, search refuses by name and sends nothing', () => {
  let sent = false;
  const r = searxng.search('q', { env: {}, config: noConfig, job: () => { sent = true; return { ok: true }; } });
  assert.equal(r.ok, false);
  assert.equal(sent, false, 'a request was attempted with no instance');
  assert.match(r.error, /SEARXNG_URL/);
  assert.match(r.error, /searxngUrl/);
});

test('an instance URL that is not http(s) is refused by name', () => {
  for (const bad of ['ftp://example.org', 'not a url', 'file:///etc/passwd']) {
    const r = searxng.search('q', { env: { SEARXNG_URL: bad }, config: noConfig, job: () => assert.fail('sent') });
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /http/i, bad);
  }
});

test('HTTP 403 is named as JSON not enabled, and says which setting enables it', () => {
  const r = searxng.search('q', { env: { SEARXNG_URL: BASE }, config: noConfig,
    job: () => ({ ok: false, statusCode: 403, error: 'searxng returned HTTP 403' }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /403/);
  assert.match(r.error, /search\.formats|formats/);
  assert.match(r.error, /settings\.yml/);
  assert.match(r.error, /json/);
});

test('a good answer returns rows capped at the limit; the config URL is used when the environment has none', () => {
  let asked = null;
  const r = searxng.search('q', { env: {}, config: { searxngUrl: BASE }, limit: 1,
    job: (job) => { asked = job; return { ok: true, statusCode: 200, payload: { results: [
      { url: 'https://a.example/', title: 'A', content: '' },
      { url: 'https://b.example/', title: 'B', content: '' },
    ] } }; } });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.provider, 'searxng');
  assert.deepEqual(r.results.map((row) => row.url), ['https://a.example/']);
  assert.equal(asked.instance, BASE);
});

test('the provider is search-only, registered by name, and refuses to fetch by name', () => {
  assert.ok(SEARCH_PROVIDER_NAMES.includes('searxng'));
  assert.equal(isSearchOnly(searxng), true);
  assert.throws(() => searxng.scrape('https://a.example/'), /search-only/);
});

test('selecting searxng with no instance is reported as not ready, not thrown', () => {
  const none = selectSearch({ explicit: 'searxng', env: {}, config: noConfig, fetchSide: { name: 'http-keyless' } });
  assert.equal(none.name, 'searxng');
  assert.match(none.notReady, /SEARXNG_URL/);
  const ready = selectSearch({ explicit: 'searxng', env: { SEARXNG_URL: BASE }, config: noConfig, fetchSide: { name: 'http-keyless' } });
  assert.equal(ready.notReady, '');
});

test('the machine config carries searxngUrl', () => {
  const dir = tempDir('fp-searxng-config-');
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ searxngUrl: BASE }));
  assert.equal(loadConfig({ FETCHPROOF_CONFIG: file }).searxngUrl, BASE);
  fs.writeFileSync(file, JSON.stringify({ searxngUrl: 5 }));
  assert.equal(loadConfig({ FETCHPROOF_CONFIG: file }).searxngUrl, '');
});

// End to end: parent -> spawnSync -> child -> fetch -> a stand-in instance on loopback. The
// stand-in runs in its own process: spawnSync blocks this one (see serpapi-live.test.mjs).
const LOCAL = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].includes(name)));

async function standIn({ status = 200, body = '', auth = '' }) {
  const dir = tempDir('fp-searxng-standin-');
  const file = path.join(dir, 'server.mjs');
  fs.writeFileSync(file, `
import http from 'node:http';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/search' || url.searchParams.get('format') !== 'json') { res.writeHead(404); res.end(); return; }
  if (${JSON.stringify(auth)} && req.headers.authorization !== ${JSON.stringify(auth)}) { res.writeHead(401); res.end(); return; }
  res.writeHead(${status}, { 'content-type': 'application/json' });
  res.end(${JSON.stringify(body)});
});
server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));
`);
  const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolvePort, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) resolvePort(Number(m[1])); });
    proc.on('exit', () => reject(new Error('stand-in exited')));
  });
  return { base: `http://127.0.0.1:${port}`, close: () => proc.kill() };
}

test('a real child reads a stand-in instance: results come back, and a 403 is named', async () => {
  const good = await standIn({ body: JSON.stringify({ query: 'q', results: [
    { url: 'https://docs.searxng.org/dev/search_api.html', title: 'Search API', content: 'the api' }, null,
  ] }) });
  try {
    const r = searxng.search('q', { env: { ...LOCAL, SEARXNG_URL: good.base }, config: noConfig, timeout: 20_000 });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.results.map((row) => row.url), ['https://docs.searxng.org/dev/search_api.html']);
  } finally { good.close(); }

  const refused = await standIn({ status: 403, body: 'Forbidden' });
  try {
    const r = searxng.search('q', { env: { ...LOCAL, SEARXNG_URL: refused.base }, config: noConfig, timeout: 20_000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /403.*search\.formats|search\.formats.*403/s);
  } finally { refused.close(); }
});

// Found 2026-09-30 (audit of the new provider): an instance behind basic auth, named as
// http://user:pass@host, failed every search - fetch refuses a URL with credentials - and the
// error printed the URL, password included.
test('an instance URL with credentials is sent as basic auth, and the password is never shown', async () => {
  const auth = `Basic ${Buffer.from('me:s3cret').toString('base64')}`;
  const guarded = await standIn({ auth, body: JSON.stringify({ results: [{ url: 'https://a.example/', title: 'A', content: '' }] }) });
  try {
    const instance = guarded.base.replace('http://', 'http://me:s3cret@');
    const r = searxng.search('q', { env: { ...LOCAL, SEARXNG_URL: instance }, config: noConfig, timeout: 20_000 });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.results.map((row) => row.url), ['https://a.example/']);
    const wrong = searxng.search('q', { env: { ...LOCAL, SEARXNG_URL: guarded.base.replace('http://', 'http://me:wrong@') }, config: noConfig, timeout: 20_000 });
    assert.equal(wrong.ok, false);
    assert.doesNotMatch(wrong.error, /wrong/, 'the password was printed');
    assert.doesNotMatch(searxng.status({ env: { SEARXNG_URL: instance } }).raw, /s3cret/, 'status printed the password');
  } finally { guarded.close(); }
  assert.doesNotMatch(searxng.requestUrl('http://me:s3cret@h.example/', 'q').href, /s3cret|me@/, 'the request URL kept the credentials');
});

// Found 2026-09-30 (outside break-test): shownInstance redacted only what parsed as an
// http(s) URL, so a TYPO in the scheme - the case where the instance is shown in an error -
// printed the password in full; and a literal % in a password made basicAuth throw URIError.
test('a mistyped instance URL never shows its password, and a % in a password does not throw', () => {
  for (const typo of ['htp://me:s3cret@searx.local', 'ftp://me:s3cret@searx.local', 'me:s3cret@searx.local']) {
    assert.doesNotMatch(searxng.search('q', { env: { SEARXNG_URL: typo }, config: noConfig }).error, /s3cret/, `${typo} leaked in the error`);
    assert.doesNotMatch(searxng.status({ env: { SEARXNG_URL: typo }, config: noConfig }).raw, /s3cret/, `${typo} leaked in status`);
  }
  assert.equal(searxng.basicAuth('http://me:100%legit@h.example/'), `Basic ${Buffer.from('me:100%legit').toString('base64')}`,
    'a literal % in a password must be sent as typed, not throw URIError');
});

// Found 2026-09-30 (pre-merge review): the fallback pattern stopped at the first / ? or #, so
// a password holding one - which no URL parser accepts, so it always reached the fallback -
// was printed in full, even behind a correct http:// scheme.
test('a password holding / ? # or @ is never shown, whatever the scheme', () => {
  for (const typo of ['http://me:s3/cret@searx.local', 'htp://me:s3?cret@searx.local', 'me:s3#cret@searx.local', 'htp://me:s3@cret@searx.local']) {
    assert.doesNotMatch(searxng.shownInstance(typo), /s3|cret/, `${typo} was shown with its password`);
    assert.doesNotMatch(searxng.status({ env: { SEARXNG_URL: typo }, config: noConfig }).raw, /s3|cret/, `${typo} leaked in status`);
  }
  // Nothing to hide is shown as typed: a path holding @ is not a password.
  assert.equal(searxng.shownInstance('http://searx.local:8080/a@b'), 'http://searx.local:8080/a@b');
});
