// A page on the web cannot redirect the collector into this machine's own network (ADR-0110).
//
// Found 2026-09-30 (break-test, PR #176): the keyless fetch followed every redirect, so a public
// page answering `302 -> http://127.0.0.1:<port>/...` was captured - an internal admin page, or a
// cloud metadata endpoint at 169.254.169.254, became an evidence row with its tokens in it, and
// `research --url` and collect.yml take arbitrary URLs. A redirect hop into an internal address
// is refused now, unless the URL the operator asked for was itself internal.

import { spawn } from 'node:child_process';
import { test, describe, assert, tempDir, fs, path, KIT_ROOT } from './harness.mjs';
import * as httpKeyless from '../lib/http-transport.mjs';

describe('redirect-guard');

// The server runs in its own process: the transport blocks this one in spawnSync.
const SERVER = `
import http from 'node:http';
const server = http.createServer((req, res) => {
  if (req.url === '/hop') { res.writeHead(302, { location: '/secret' }); res.end(); return; }
  if (req.url === '/hop-absolute') { res.writeHead(301, { location: 'http://127.0.0.1:' + server.address().port + '/secret' }); res.end(); return; }
  const body = '<html><head><title>Internal</title></head><body><main><p>' + 'SECRET-TOKEN-4b1d '.repeat(40) + '</p></main></body></html>';
  res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(body) });
  res.end(body);
});
server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));
`;

async function withServer(fn) {
  const file = path.join(tempDir('rk-redirect-'), 'server.mjs');
  fs.writeFileSync(file, SERVER);
  const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
      proc.on('exit', (code) => reject(new Error(`the page server exited ${code}`)));
    });
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    proc.kill();
  }
}

// Nothing inherited from the machine running the suite: a proxy would not reach loopback.
const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };

test('a redirect into an internal address is refused, and nothing behind it is captured', async () => {
  await withServer((base) => {
    // `allowInternalRedirects: false` plays the part of a PUBLIC page: the policy a public URL
    // gets, applied to a server this test can run offline.
    for (const route of ['/hop', '/hop-absolute']) {
      const r = httpKeyless.scrape(`${base}${route}`, { env, allowInternalRedirects: false });
      assert.equal(r.ok, false, `${route}: a redirect into 127.0.0.1 was followed and captured`);
      assert.match(r.error, /refused to follow a redirect .*127\.0\.0\.1/, r.error);
      assert.doesNotMatch(JSON.stringify(r), /SECRET-TOKEN/, `${route}: the internal page reached the result`);
      assert.equal(r.url, `${base}${route}`, 'the refusal is recorded against the URL that was asked for');
    }
  });
});

test('under an explicit refusal a NAME asked for is judged before any fetch; a literal address asked for is the caller\'s', async () => {
  await withServer((base) => {
    // ADR-0155: `false` judges the first URL by what its name resolves to, before fetching.
    const port = new URL(base).port;
    const byName = httpKeyless.scrape(`http://localhost:${port}/secret`, { env, allowInternalRedirects: false });
    assert.equal(byName.ok, false, 'localhost was fetched under an explicit refusal');
    assert.match(byName.error, /^refused to fetch localhost:\d+ - localhost is this machine/, byName.error);
    assert.match(byName.error, /RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS=1/);
    assert.doesNotMatch(JSON.stringify(byName), /SECRET-TOKEN/, 'the internal page reached the result');
    assert.equal(byName.url, `http://localhost:${port}/secret`, 'the refusal is recorded against the URL asked for');
    // The variable set to 0 is the same refusal.
    const variable = httpKeyless.scrape(`http://localhost:${port}/secret`, { env: { ...env, RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS: '0' } });
    assert.equal(variable.ok, false);
    assert.match(variable.error, /^refused to fetch localhost/);
    // A literal address the caller spelled out cannot be rebound and stays the caller's: the
    // page it names is fetched, and the policy a public page gets still governs where it may
    // lead (the redirect tests above). This is the decision, not an omission.
    const literal = httpKeyless.scrape(`${base}/secret`, { env, allowInternalRedirects: false });
    assert.equal(literal.ok, true, literal.error);
    assert.match(literal.markdown, /SECRET-TOKEN/);
  });
});

test('under an explicit refusal the fetch child skips the early judgment only for a literal address, in every internal range', async () => {
  // ADR-0155: the literal-address rule is not loopback-specific. The classification is judged
  // in process for every range, and the child's skip is pinned at its source, so the suite
  // sends nothing into a private range, the metadata endpoint or a ULA network.
  for (const host of ['10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '[fd00::1]', '[fe80::1]']) {
    assert.match(await httpKeyless.internalTarget(host) ?? '', /is an internal address$/, `${host} was not classified as a literal internal address`);
  }
  for (const host of ['localhost', 'app.localhost']) {
    assert.match(await httpKeyless.internalTarget(host) ?? '', /is this machine$/, `${host} was not classified as this machine`);
  }
  const child = fs.readFileSync(path.join(KIT_ROOT, 'lib', 'http-transport.mjs'), 'utf8');
  assert.match(child, /if \(job\.allowInternalRedirects === false\) \{[\s\S]{0,400}net\.isIP\(.*?\) \? null : await internalTarget\(asked\.hostname\)/,
    'the child must judge a name before fetching under an explicit refusal, and leave a literal address to the caller');
  assert.match(child, /dns\.lookup = guardedLookup\(/, 'the connection-time judgment must remain beside the early one');
});

test('an internal address the operator asked for is still fetched, redirects within it too', async () => {
  await withServer((base) => {
    const r = httpKeyless.scrape(`${base}/hop`, { env });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.url, `${base}/secret`, 'the final URL is the one recorded');
    assert.match(r.markdown, /SECRET-TOKEN/);
  });
});

test('RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS=1 lifts the check, and only that value does', () => {
  const jobs = [];
  const record = (_, __, opts) => { jobs.push(JSON.parse(opts.input)); return { status: 0, stdout: '{"ok":false,"error":"stub"}', stderr: '' }; };
  httpKeyless.scrape('https://example.invalid/p', { spawn: record, env: { RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS: '1' } });
  httpKeyless.scrape('https://example.invalid/p', { spawn: record, env: { RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS: 'yes' } });
  httpKeyless.scrape('https://example.invalid/p', { spawn: record, env: {} });
  assert.deepEqual(jobs.map((j) => j.allowInternalRedirects), [true, undefined, undefined]);
});

test('what counts as internal: loopback, private, link-local, metadata, localhost names - not the public web', async () => {
  const internal = ['127.0.0.1', '127.8.9.10', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '[::1]', '[::]', '[fd00::1]', '[fe80::1]', '[::ffff:7f00:1]', 'localhost', 'LOCALHOST', 'app.localhost', 'localhost.'];
  const external = ['8.8.8.8', '93.184.216.34', '172.32.0.1', '192.169.0.1', '[2606:4700:4700::1111]'];
  for (const host of internal) assert.ok(await httpKeyless.internalTarget(host), `${host} was not recognised as internal`);
  for (const host of external) assert.equal(await httpKeyless.internalTarget(host), null, `${host} was taken for internal`);
});

// ADR-0110 left DNS rebinding open: a name was resolved to judge it, then resolved again by
// fetch, and a hostile name server can answer "public" the first time and "internal" the
// second. The fetch child now judges the addresses fetch itself connects to: dns.lookup, which
// Node's fetch calls at connect time, is wrapped there (ADR-0114).
const fakeLookup = (answers) => (host, opts, cb) => {
  const address = answers[host] ?? '93.184.216.34';
  if (opts.all) cb(null, [{ address, family: address.includes(':') ? 6 : 4 }]);
  else cb(null, address, address.includes(':') ? 6 : 4);
};
const ask = (lookup, host, opts = { all: true }) => new Promise((resolve) => lookup(host, opts, (err, result) => resolve({ err, result })));

test('the guarded lookup refuses an internal answer, unless internal was asked for or it is the proxy', async () => {
  const { guardedLookup } = httpKeyless;
  const answers = { 'rebind.example': '127.0.0.1', 'meta.example': '169.254.169.254', 'proxy.corp': '10.0.0.8', 'public.example': '93.184.216.34' };
  const guard = guardedLookup(fakeLookup(answers), { allowInternal: () => false, exempt: ['proxy.corp'] });
  for (const opts of [{ all: true }, {}]) {
    for (const host of ['rebind.example', 'meta.example']) {
      const { err } = await ask(guard, host, opts);
      assert.equal(err?.code, 'EINTERNAL', `${host} (${JSON.stringify(opts)}) resolved inward and was connected to`);
      assert.match(err.message, new RegExp(`${host}.*${answers[host].replace(/\./g, '\\.')}`));
    }
    assert.equal((await ask(guard, 'public.example', opts)).err, null);
    assert.equal((await ask(guard, 'proxy.corp', opts)).err, null, 'the proxy itself was refused');
  }
  const asked = guardedLookup(fakeLookup(answers), { allowInternal: () => true, exempt: [] });
  assert.equal((await ask(asked, 'rebind.example')).err, null, 'an internal URL the operator asked for was refused');
});

test('Node\'s fetch connects through the guarded lookup, so the address judged is the address used', async () => {
  const { guardedLookup } = httpKeyless;
  const dns = (await import('node:dns')).default;
  const http = (await import('node:http')).default;
  const server = http.createServer((req, res) => res.end('INTERNAL-PAGE')).listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const original = dns.lookup;
  try {
    const url = `http://rebind.example:${server.address().port}/`;
    dns.lookup = guardedLookup(fakeLookup({ 'rebind.example': '127.0.0.1' }), { allowInternal: () => false, exempt: [] });
    const refused = await fetch(url).then((r) => r.text(), (err) => err);
    assert.ok(refused instanceof Error, `fetch connected to an internal answer: ${refused}`);
    assert.equal(refused.cause?.code, 'EINTERNAL', `fetch failed some other way: ${refused.cause?.message ?? refused.message}`);
    // The control: the same lookup, allowed, reaches the page - so the refusal above was the guard's.
    dns.lookup = guardedLookup(fakeLookup({ 'rebind.example': '127.0.0.1' }), { allowInternal: () => true, exempt: [] });
    assert.equal(await fetch(url).then((r) => r.text()), 'INTERNAL-PAGE');
  } finally {
    dns.lookup = original;
    server.close();
  }
});

test('the fetch child guards its lookups, and names the refusal', () => {
  const src = fs.readFileSync(path.join(KIT_ROOT, 'lib', 'http-transport.mjs'), 'utf8');
  const child = src.slice(src.indexOf('async function child()'));
  assert.match(child, /dns\.lookup = guardedLookup\(/, 'the child does not guard the lookups its fetch makes');
});
