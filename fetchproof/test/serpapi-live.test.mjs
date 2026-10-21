// The path that was exercised by hand and called verified: gap 3 of the validation map.
//
// `serpapi.test.mjs` injects a `job` function, so it proves the parsing and the
// redaction but never spawns the child, never opens a socket, and never runs `fetch`.
// Everything between "the parent builds a job" and "the parent gets an answer" was
// covered by me typing commands into a terminal once and writing down what happened.
//
// This file closes that. A real HTTP server on loopback stands in for the vendor, and
// every request goes: parent -> spawnSync -> child process -> global fetch -> socket ->
// server -> back. No network, no key, no credits, and repeatable.
//
// It is possible because `search({ endpoint })` exists, and that option is guarded:
// `allowedEndpoint` permits the vendor's own host over https, or loopback. An
// overridable endpoint on a request that carries an API key is otherwise a way to
// exfiltrate one.

import { spawn, spawnSync } from 'node:child_process';
import { test, describe, assert, tempDir, fs, path } from './harness.mjs';
import * as serpapi from '../lib/serpapi.mjs';
import { KIT_ROOT as KIT_ROOT_DIR } from './harness.mjs';

describe('serpapi-live');

const KEY = ['4', '7', 'c', 'e'].join('') + 'b'.repeat(60);

// The stand-in is on loopback, and the child obeys a configured proxy (fetchEnv). On a
// machine whose proxy is set and whose NO_PROXY does not name loopback, every request below
// would go to that proxy instead - measured 2026-09-27: 8 of these 15 failed that way. The
// vendor here is local, so the child gets the machine's environment without its proxy.
const LOCAL = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].includes(name)));

// The stand-in vendor runs in ITS OWN PROCESS, and it has to.
//
// The first version hosted the server in this process, and every request timed out. The
// reason is the thing that makes this module interesting in the first place: the adapter
// shape is synchronous, so the parent reaches the vendor through `spawnSync` - which
// blocks the parent's event loop until the child exits. A server living in that same
// loop can never accept the connection. The parent waits for the child, the child waits
// for the server, the server waits for the parent to yield. Deadlock, reported as
// ETIMEDOUT.
//
// So: a separate process, which prints its port and records each request to a file the
// parent reads afterwards.
const SERVER_SOURCE = `
import http from 'node:http';
import fs from 'node:fs';

const cfg = JSON.parse(process.argv[2]);
const log = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  log.push({ path: url.pathname, params: Object.fromEntries(url.searchParams) });
  fs.writeFileSync(cfg.recordFile, JSON.stringify(log));

  if (cfg.mode === 'destroy') { req.socket.destroy(); return; }
  if (cfg.mode === 'silent') return;            // accept, record, never answer
  res.writeHead(cfg.status ?? 200, cfg.headers ?? { 'content-type': 'application/json' });
  res.end(cfg.body ?? '');
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write('PORT ' + server.address().port + '\\n');
});
`;

/**
 * `standIn({ mode, status, body, headers })` -> `{ endpoint, requests(), close() }`.
 *
 * `requests()` reads back what the child actually put on the wire - the half no injected
 * stub can observe, and the whole reason this file exists.
 */
async function standIn(config = {}) {
  const dir = tempDir('fp-standin-');
  const serverFile = path.join(dir, 'server.mjs');
  const recordFile = path.join(dir, 'requests.json');
  fs.writeFileSync(serverFile, SERVER_SOURCE);

  const proc = spawn(process.execPath, [serverFile, JSON.stringify({ ...config, recordFile })], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const port = await new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('the stand-in server never reported a port')), 15_000);
    proc.stdout.on('data', (chunk) => {
      buffered += chunk;
      const match = buffered.match(/PORT (\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the stand-in server exited early (${code})`)); });
  });

  return {
    endpoint: `http://127.0.0.1:${port}/search`,
    requests: () => {
      try { return JSON.parse(fs.readFileSync(recordFile, 'utf8')); } catch { return []; }
    },
    close: () => { proc.kill(); },
  };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

const PAYLOAD = {
  search_metadata: { id: 'live-test-id', status: 'Success', total_time_taken: 0.12 },
  search_parameters: { engine: 'google', q: 'x' },
  organic_results: [
    { position: 1, title: 'First', link: 'https://a.example/1', snippet: 'one' },
    { position: 2, title: 'Second', link: 'https://b.example/2', snippet: 'two' },
  ],
};

test('LIVE: the whole path works - parent, child process, real fetch, real socket', async () => {
  const vendor = await standIn({ body: JSON.stringify(PAYLOAD) });
  try {
    const r = serpapi.search('a real query', { key: KEY, endpoint: vendor.endpoint, timeout: 15_000, env: LOCAL });

    assert.equal(r.ok, true, `the live path failed: ${r.error}`);
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0].url, 'https://a.example/1');
    assert.equal(r.searchId, 'live-test-id');
    assert.equal(r.searchesUsed, 1);
  } finally {
    vendor.close();
  }
});

test('LIVE: the request the CHILD actually sends carries exactly three parameters', async () => {
  // The strongest version of IR-1..IR-4. `serpapi.test.mjs` asserts what `requestUrl`
  // BUILDS; this asserts what came out of a socket at the other end.
  const vendor = await standIn({ body: JSON.stringify(PAYLOAD) });
  try {
    serpapi.search('a b&c', { key: KEY, endpoint: vendor.endpoint, timeout: 15_000, env: LOCAL });

    assert.equal(vendor.requests().length, 1, 'the child made no request, or made several');
    const [sent] = vendor.requests();
    assert.equal(sent.path, '/search');
    assert.deepEqual(Object.keys(sent.params).sort(), ['api_key', 'engine', 'q']);
    assert.equal(sent.params.engine, 'google');
    assert.equal(sent.params.q, 'a b&c', 'the query did not survive encoding across the wire');
    assert.equal(sent.params.api_key, KEY);
    for (const forbidden of ['no_cache', 'async', 'num', 'start', 'output', 'zero_trace']) {
      assert.equal(forbidden in sent.params, false, `the child sent "${forbidden}" over the wire`);
    }
  } finally {
    vendor.close();
  }
});

test('LIVE: a 401 carrying the documented error key is reported in the vendor\'s words', async () => {
  // Confirmed against the real vendor by hand; pinned here so it stays true.
  const vendor = await standIn({ status: 401, body: JSON.stringify({ error: 'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key' }) });
  try {
    const r = serpapi.search('q', { key: KEY, endpoint: vendor.endpoint, timeout: 15_000, env: LOCAL });
    assert.equal(r.ok, false);
    assert.match(r.error, /Invalid API key/);
    assert.equal(r.error.includes(KEY), false, 'the key survived into the error');
  } finally {
    vendor.close();
  }
});

test('LIVE: an exhausted allowance arrives as an ordinary failure, not a crash', async () => {
  const vendor = await standIn({ status: 200, body: JSON.stringify({ error: 'Your account has run out of searches.' }) });
  try {
    const r = serpapi.search('q', { key: KEY, endpoint: vendor.endpoint, timeout: 15_000, env: LOCAL });
    assert.equal(r.ok, false);
    assert.match(r.error, /run out of searches/);
    assert.deepEqual(r.results, []);
  } finally {
    vendor.close();
  }
});

test('LIVE: a 500 with no error key is an HTTP failure', async () => {
  const vendor = await standIn({ status: 500, body: JSON.stringify({ something: 'else' }) });
  try {
    const r = serpapi.search('q', { key: KEY, endpoint: vendor.endpoint, timeout: 15_000, env: LOCAL });
    assert.equal(r.ok, false);
    assert.match(r.error, /500/);
  } finally {
    vendor.close();
  }
});

test('LIVE: an HTML error page is reported as a non-JSON body, with its size', async () => {
  const body = '<html><body>502 Bad Gateway</body></html>';
  const vendor = await standIn({ status: 502, body, headers: { 'content-type': 'text/html' } });
  try {
    const r = serpapi.search('q', { key: KEY, endpoint: vendor.endpoint, timeout: 15_000, env: LOCAL });
    assert.equal(r.ok, false);
    assert.match(r.error, /non-JSON body/);
    assert.match(r.error, new RegExp(String(body.length)));
  } finally {
    vendor.close();
  }
});

test('LIVE: truncated JSON is a parse failure, not a half-read result', async () => {
  const vendor = await standIn({ status: 200, body: '{"organic_results": [{"link": "https://a.exa' });
  try {
    const r = serpapi.search('q', { key: KEY, endpoint: vendor.endpoint, timeout: 15_000, env: LOCAL });
    assert.equal(r.ok, false);
    assert.deepEqual(r.results, [], 'a truncated payload produced candidates');
  } finally {
    vendor.close();
  }
});

test('LIVE: a connection killed mid-flight is a returned failure, not a throw', async () => {
  const vendor = await standIn({ mode: 'destroy' });
  try {
    const r = serpapi.search('q', { key: KEY, endpoint: vendor.endpoint, timeout: 15_000, env: LOCAL });
    assert.equal(r.ok, false);
    assert.ok(r.error.length > 0);
    assert.equal(r.error.includes(KEY), false, 'a socket error leaked the key');
  } finally {
    vendor.close();
  }
});

test('LIVE: a server that never answers is bounded by the timeout', async () => {
  // The RR-4 claim, end to end: the collector holds the corpus lock synchronously, so an
  // unanswered request must not be able to hold it open.
  const vendor = await standIn({ mode: 'silent' });  // never resolves; never replies
  try {
    const started = Date.now();
    const r = serpapi.search('q', { key: KEY, endpoint: vendor.endpoint, timeout: 1200, env: LOCAL });
    const elapsed = Date.now() - started;

    assert.equal(r.ok, false);
    assert.ok(elapsed < 20_000, `the call took ${elapsed}ms - nothing bounded it`);
    // Found 2026-09-27 on a real run: the failure read "spawnSync /opt/node22/bin/node ETIMEDOUT",
    // which names a node binary and not the vendor that did not answer.
    assert.match(r.error, /SerpAPI did not answer within 1\.2s/, r.error);
    assert.doesNotMatch(r.error, /spawnSync/);
  } finally {
    vendor.close();
  }
});

test('LIVE: an empty result set round-trips as a success with no candidates', async () => {
  const vendor = await standIn({ body: JSON.stringify({ search_metadata: { id: 'empty' }, organic_results: [] }) });
  try {
    const r = serpapi.search('q', { key: KEY, endpoint: vendor.endpoint, timeout: 15_000, env: LOCAL });
    assert.equal(r.ok, true);
    assert.deepEqual(r.results, []);
    assert.equal(r.searchesUsed, 1, 'the vendor bills an empty response as one search');
  } finally {
    vendor.close();
  }
});

// ---------------------------------------------------------------- the guard itself

test('the endpoint override cannot be used to send the key somewhere else', async () => {
  // The reason `endpoint` is safe to expose. If this ever passes a non-loopback host,
  // the test seam has become an exfiltration route.
  const vendor = await standIn({ body: JSON.stringify(PAYLOAD) });
  try {
    for (const bad of [
      'https://evil.example/search',
      'http://serpapi.com.evil.example/search',
      'http://serpapi.com/search',          // the vendor, but downgraded to cleartext
      'file:///etc/passwd',
      'not a url at all',
    ]) {
      const r = serpapi.search('q', { key: KEY, endpoint: bad, timeout: 5000 });
      assert.equal(r.ok, false, `${bad} was accepted`);
      assert.match(r.error, /refusing to send a SerpAPI key/);
      assert.equal(r.error.includes(KEY), false, 'the refusal leaked the key it was protecting');
    }
    assert.equal(vendor.requests().length, 0, 'a refused endpoint still reached a socket');
  } finally {
    vendor.close();
  }
});

test('the CHILD refuses a bad endpoint too, even handed one directly', () => {
  // The child is a separate program reading a job off a pipe. It does not get to trust
  // that the parent already checked.
  const answer = serpapi.runJob(
    { kind: 'serpapi-search', query: 'q', apiKey: KEY, endpoint: 'https://evil.example/search', timeout: 5000 },
    { timeout: 10_000, env: LOCAL },
  );
  assert.equal(answer.ok, false);
  assert.match(answer.error, /refusing to send a key/);
});

test('allowedEndpoint: the vendor over https, or loopback, and nothing else', () => {
  for (const good of [
    'https://serpapi.com/search',
    'http://localhost:8080/search',
    'http://127.0.0.1:1234/search',
  ]) assert.equal(serpapi.allowedEndpoint(good), true, `${good} was refused`);

  for (const bad of [
    'https://evil.example/search',
    'https://serpapi.com.evil.example/search',
    'http://serpapi.com/search',
    'https://localhost.evil.example/search',
    'file:///etc/passwd',
    'ftp://serpapi.com/search',
    '',
    'not a url',
  ]) assert.equal(serpapi.allowedEndpoint(bad), false, `${bad} was allowed`);
});

// ---------------------------------------------------------------- ADR-0040  the vendor meter, live

const ACCOUNT_PAYLOAD = {
  account_id: 'acct-live', api_key: 'echoed-by-the-vendor', account_email: 'live@example.invalid',
  plan_name: 'Free Plan', searches_per_month: 250, total_searches_left: 98, this_month_usage: 152,
  this_hour_searches: 9, account_rate_limit_per_hour: 250, plan_renewal_date: '2026-10-14',
};

test('LIVE ADR-0040: account() goes parent -> child -> socket, sends ONLY the key, and reads the meter', async () => {
  const vendor = await standIn({ body: JSON.stringify(ACCOUNT_PAYLOAD) });
  try {
    const r = serpapi.account({ key: KEY, endpoint: vendor.endpoint.replace('/search', '/account.json'), env: LOCAL });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.account.left, 98);
    assert.equal(r.account.perHour, 250);
    const [req] = vendor.requests();
    assert.equal(req.path, '/account.json');
    assert.deepEqual(Object.keys(req.params), ['api_key'], 'the account request carried more than the key');
  } finally { vendor.close(); }
});

test('LIVE ADR-0040: research.mjs --status prints the vendor meter, and never the key', async () => {
  const vendor = await standIn({ body: JSON.stringify(ACCOUNT_PAYLOAD) });
  try {
    const root = tempDir('fp-status-live-');
    const r = spawnSync(process.execPath, [path.join(KIT_ROOT_DIR, 'bin', 'research.mjs'), '--status'], {
      cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true,
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        HOME: root, USERPROFILE: root, FETCHPROOF_CONFIG: path.join(root, 'absent.json'),
        SERPAPI_API_KEY: KEY,
        [serpapi.ACCOUNT_ENDPOINT_ENV]: vendor.endpoint.replace('/search', '/account.json'),
      },
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, out);
    assert.match(out, /vendor meter\s+152 used this cycle, 98 left of 250, renews 2026-10-14; 250\/hour for this account/);
    assert.equal(out.includes(KEY), false, '--status printed the key');
    assert.equal(out.includes('live@example.invalid'), false, '--status printed the account email');
  } finally { vendor.close(); }
});
