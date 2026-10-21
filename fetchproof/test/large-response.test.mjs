// How large an answer a vendor child may give (ADR-0082).
//
// Found 2026-09-28 (Arena break test 8): every transport runs its request in a child
// through spawnSync, which buffers the child's output under Node's DEFAULT limit of 1 MiB.
// A page a little over that failed with "spawnSync ... ENOBUFS" - a common size for a real
// documentation page - and a Firecrawl scrape that large was paid for and then lost. The
// keyless child also read any body whole, however large, into memory.

import { spawn } from 'node:child_process';
import { test, describe, assert, tempDir, fs, path } from './harness.mjs';
import * as httpKeyless from '../lib/http-transport.mjs';
import { exec } from '../lib/firecrawl.mjs';
import { search as serpapiSearch, account as serpapiAccount, runJob as serpapiJob } from '../lib/serpapi.mjs';
import { CHILD_OUTPUT_LIMIT, MAX_PAGE_BYTES } from '../lib/runtime.mjs';

describe('large-response');

// The server runs in its own process: the transport blocks this one in spawnSync.
const SERVER = `
import http from 'node:http';
const MiB = 1024 * 1024;
const server = http.createServer((req, res) => {
  const size = Number(new URL(req.url, 'http://x').searchParams.get('mib')) * MiB;
  if (req.url.startsWith('/json')) {
    const body = ' '.repeat(size) + '{"organic_results":[]}';
    const headers = { 'content-type': 'application/json' };
    if (!req.url.startsWith('/json-chunked')) headers['content-length'] = Buffer.byteLength(body);
    res.writeHead(200, headers);
    res.end(body);
    return;
  }
  const page = (n) => '<html><body><main><p>' + 'word '.repeat(Math.ceil(n / 5)) + '</p></main></body></html>';
  if (req.url.startsWith('/chunked')) {           // no Content-Length: only reading tells
    res.writeHead(200, { 'content-type': 'text/html' });
    let sent = 0;
    const more = () => { while (sent < size) { sent += MiB; if (!res.write('x'.repeat(MiB))) return res.once('drain', more); } res.end(); };
    more();
    return;
  }
  const body = page(size);
  res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(body) });
  res.end(body);
});
server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));
`;

async function withServer(fn) {
  const file = path.join(tempDir('fp-big-page-'), 'server.mjs');
  fs.writeFileSync(file, SERVER);
  const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
      proc.on('exit', (code) => reject(new Error(`the page server exited ${code}`)));
    });
    return fn(`http://127.0.0.1:${port}`);
  } finally {
    proc.kill();
  }
}

// Nothing inherited from the machine running the suite: a proxy would not reach loopback.
const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };

test('a keyless page over 1 MiB is captured, not lost to the output buffer', async () => {
  await withServer((base) => {
    const r = httpKeyless.scrape(`${base}/page?mib=2`, { env });
    assert.equal(r.ok, true, `a 2 MiB page failed: ${r.error}`);
    assert.ok(r.markdown.length > 1024 * 1024, 'the page was captured short');
  });
});

test('a page past the limit is refused by name, declared or streamed, and nothing is kept', async () => {
  const mib = MAX_PAGE_BYTES / (1024 * 1024) + 4;
  await withServer((base) => {
    for (const route of ['page', 'chunked']) {
      const r = httpKeyless.scrape(`${base}/${route}?mib=${mib}`, { env });
      assert.equal(r.ok, false, `a ${mib} MiB ${route} page was accepted`);
      assert.match(r.error, new RegExp(`larger than ${MAX_PAGE_BYTES / (1024 * 1024)} MiB`), `${route}: ${r.error}`);
      assert.doesNotMatch(r.error, /ENOBUFS|spawnSync/);
    }
  });
});

test('every vendor child runs with the raised output limit, and an overflow is named', () => {
  const overflow = () => ({ error: Object.assign(new Error('spawnSync node ENOBUFS'), { code: 'ENOBUFS' }), status: null, stdout: '{"partial', stderr: '' });
  const seen = [];
  const record = (answer) => (file, args, opts) => { seen.push(opts.maxBuffer); return answer(); };

  const keyless = httpKeyless.scrape('https://x.invalid/p', { spawn: record(overflow) });
  const serp = serpapiJob({ kind: 'serpapi-search' }, { spawn: record(overflow), env });
  const bin = path.join(tempDir('fp-fc-bin-'), process.platform === 'win32' ? 'firecrawl.exe' : 'firecrawl');
  fs.writeFileSync(bin, '');
  fs.chmodSync(bin, 0o755);
  const fc = exec(['scrape', 'https://x.invalid/p'], { spawn: record(overflow), env: { PATH: path.dirname(bin) } });

  assert.deepEqual(seen, [CHILD_OUTPUT_LIMIT, CHILD_OUTPUT_LIMIT, CHILD_OUTPUT_LIMIT], 'a child ran under the 1 MiB default');
  for (const [who, text] of [['keyless', keyless.error], ['serpapi', serp.error], ['firecrawl', fc.stderr]]) {
    assert.match(text ?? '', /more than \d+ MiB/, `${who} did not name the overflow: ${text}`);
    assert.doesNotMatch(text ?? '', /ENOBUFS|spawnSync/, `${who} leaked the Node error: ${text}`);
  }
  assert.equal(fc.ok, false);
});

// Found 2026-09-28 (Arena break test 9): the SerpAPI child still read its answer with
// response.text(), so a 17 MiB JSON body was accepted - the child output limit bounds what
// reaches the parent, not what the child downloads.
test('SerpAPI search and account bound declared and chunked bodies before parsing JSON', async () => {
  await withServer((base) => {
    for (const request of [serpapiSearch.bind(null, 'probe'), serpapiAccount]) {
      for (const route of ['json', 'json-chunked']) {
        for (const mib of [1, MAX_PAGE_BYTES / (1024 * 1024) + 1]) {
          const r = request({ key: 'offline-sentinel', env, endpoint: `${base}/${route}?mib=${mib}` });
          assert.equal(r.ok, mib === 1, `${route}, ${mib} MiB: ${r.error}`);
          if (mib > 1) assert.match(r.error, /SerpAPI response is larger than 16 MiB/);
        }
      }
    }
  });
});
