// A configured proxy carries every request the kit makes itself.
//
// Node's built-in fetch ignores HTTPS_PROXY unless it is told at startup (NODE_USE_ENV_PROXY=1,
// from 22.21 and 24.0) or, from 24.14 and 25.4, switched on in place with
// http.setGlobalProxyFromEnv() (docs/decisions/2026-09-27-node-support, E-02, E-03). dd7569d
// told the keyless transport's fetch child. Found 2026-09-27: three other paths still went
// around the proxy. They were the SerpAPI child, and the commands that call GitHub in their
// own process: collect-remote, disclosure and the MCP server. Behind a network that allows
// traffic only through a proxy, each failed with an error that named no proxy.
//
// The live tests run a stand-in proxy on loopback, in its own process (the SerpAPI search
// blocks this one in spawnSync), and read back what reached it. It forwards nothing. A tunnel
// to anywhere but loopback is refused, so no request leaves the machine.

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { test, describe, assert, tempDir, fs, path, KIT_ROOT } from './harness.mjs';
import * as serpapi from '../lib/serpapi.mjs';
import { nodeHonoursEnvProxy, envProxyPlan, envProxyChoice, honourEnvProxy, fetchEnv, PROXY_VARIABLES } from '../lib/runtime.mjs';

describe('proxy');

// ---------------------------------------------------------------- the stand-in proxy

const PROXY_SOURCE = `
import http from 'node:http';
import fs from 'node:fs';

const cfg = JSON.parse(process.argv[2]);
const seen = [];
const record = (entry) => { seen.push(entry); fs.writeFileSync(cfg.recordFile, JSON.stringify(seen)); };

// A plain-http request: absolute-form when a client sends it to a proxy, origin-form when it
// arrives inside a tunnel this server opened. Answered here either way, never forwarded.
const server = http.createServer((req, res) => {
  record({ kind: 'request', url: req.url, host: req.headers.host ?? '' });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(cfg.body ?? '{}');
});

// A tunnel. To loopback it is served by this same server; anywhere else it is refused.
server.on('connect', (req, socket, head) => {
  record({ kind: 'connect', authority: req.url });
  if (/^(127\\.0\\.0\\.1|localhost):/.test(req.url)) {
    socket.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n');
    if (head && head.length) socket.unshift(head);
    server.emit('connection', socket);
    return;
  }
  socket.end('HTTP/1.1 403 Forbidden\\r\\n\\r\\n');
});

server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));
`;

/** `standInProxy({ body })` -> `{ url, seen(), close() }`. `seen()` is what reached it. */
async function standInProxy(config = {}) {
  const dir = tempDir('rk-proxy-standin-');
  const serverFile = path.join(dir, 'proxy.mjs');
  const recordFile = path.join(dir, 'seen.json');
  fs.writeFileSync(serverFile, PROXY_SOURCE);
  const proc = spawn(process.execPath, [serverFile, JSON.stringify({ ...config, recordFile })], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const port = await new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('the stand-in proxy never reported a port')), 15_000);
    proc.stdout.on('data', (chunk) => {
      buffered += chunk;
      const match = buffered.match(/PORT (\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the stand-in proxy exited early (${code})`)); });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    seen: () => {
      try { return JSON.parse(fs.readFileSync(recordFile, 'utf8')); } catch { return []; }
    },
    close: () => { proc.kill(); },
  };
}

// This host's Node. Where it cannot use a proxy at all (22.0-22.20, 23), the SerpAPI test
// asserts that nothing reached the proxy: the limitation doctor warns about, observed. The
// command tests do not spawn there - the command's requests would go straight to GitHub, off
// this machine, from an offline suite - and assert the plan the command would follow instead.
const CAPABLE = nodeHonoursEnvProxy(process.versions.node);
const PROXIED = { HTTPS_PROXY: 'http://127.0.0.1:1' };
const onlyWarns = () => assert.equal(envProxyPlan({ env: PROXIED, execArgv: [] }), 'unsupported',
  `node ${process.versions.node} was judged unable to use a proxy, and yet it would try`);

// Nothing inherited from the machine running the suite: its own proxy settings and NO_PROXY
// would decide the outcome instead of the ones under test.
const hostEnv = (root) => ({
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  HOME: root,
  USERPROFILE: root,
  RESEARCH_KIT_CONFIG: path.join(root, 'absent.json'),
});

const KEY = ['5', '1', 'd', 'a'].join('') + 'c'.repeat(60);
const PAYLOAD = { search_metadata: { id: 'via-proxy' }, organic_results: [{ position: 1, title: 'A', link: 'https://a.example/1', snippet: 'a' }] };
const GITHUB = 'api.github.com:443';

// ---------------------------------------------------------------- the SerpAPI child

// A loopback port with nothing listening, so an answer can only have come from the proxy.
// Asked of the OS rather than chosen: the first version used port 9, which fetch refuses
// outright ("bad port" - it is on the Fetch standard's blocked list), and read as a bypass.
async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('LIVE: a SerpAPI search goes through the configured proxy', async () => {
  const proxy = await standInProxy({ body: JSON.stringify(PAYLOAD) });
  try {
    const root = tempDir('rk-proxy-serp-');
    const target = `127.0.0.1:${await closedPort()}`;
    const r = serpapi.search('through the proxy', {
      key: KEY, endpoint: `http://${target}/search`, timeout: 15_000,
      env: { ...hostEnv(root), HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url },
    });
    const reached = proxy.seen().filter((e) => `${e.url ?? ''} ${e.host ?? ''} ${e.authority ?? ''}`.includes(target));
    if (!CAPABLE) {
      assert.equal(reached.length, 0, `node ${process.versions.node} has no proxy support, yet the proxy saw the search`);
      return;
    }
    assert.ok(reached.length > 0, `the search went around the proxy: ${r.error}`);
    assert.equal(r.ok, true, `the search did not come back through the proxy: ${r.error}`);
    assert.equal(r.results[0].url, 'https://a.example/1');
  } finally {
    proxy.close();
  }
});

// ---------------------------------------------------------------- the commands that call GitHub

function runBin(script, args, env, cwd) {
  return spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', script), ...args], {
    cwd, env, encoding: 'utf8', timeout: 45_000, windowsHide: true,
  });
}

async function throughProxy(run) {
  const proxy = await standInProxy();
  try {
    const root = tempDir('rk-proxy-bin-');
    const out = await run({ env: { ...hostEnv(root), HTTPS_PROXY: proxy.url }, root });
    return { seen: proxy.seen(), out };
  } finally {
    proxy.close();
  }
}

const tunnelled = (seen) => seen.some((e) => e.kind === 'connect' && e.authority === GITHUB);

test('LIVE: disclosure sends its requests through the configured proxy', async () => {
  if (!CAPABLE) { onlyWarns(); return; }
  const { seen, out } = await throughProxy(({ env, root }) =>
    runBin('disclosure.mjs', ['--repository', 'octo/repo', '--run', '1'], env, root));
  assert.ok(tunnelled(seen), `disclosure went around the proxy (exit ${out.status}): ${out.stderr}`);
  assert.equal(out.status, 3, `the proxy refused every probe, so nothing was measured - not a clean exit 0:\n${out.stdout}`);
});

test('LIVE: collect-remote sends its requests through the configured proxy', async () => {
  if (!CAPABLE) { onlyWarns(); return; }
  const { seen, out } = await throughProxy(({ env, root }) =>
    runBin('collect-remote.mjs', ['--repository', 'octo/repo', '--topic', 'proxy check', '--no-wait'],
      { ...env, RESEARCH_KIT_GITHUB_TOKEN: 'placeholder-not-a-token' }, root));
  assert.ok(tunnelled(seen), `collect-remote went around the proxy (exit ${out.status}): ${out.stderr}`);
  assert.equal(out.status, 3, 'a refused tunnel is "could not reach GitHub", exit 3');
});

// The MCP server is spoken to on its standard streams, which is also what a restart to turn the
// proxy on has to preserve: the client keeps talking to the same pipes.
async function mcpExchange(env, cwd, requests, lastId) {
  const child = spawn(process.execPath, [path.join(KIT_ROOT, 'bin', 'mcp-server.mjs')], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let out = '';
  let err = '';
  child.stderr.on('data', (chunk) => { err += chunk; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const responses = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no answer to request ${lastId}. stderr:\n${err}`)); }, 40_000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const parsed = out.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
      if (parsed.some((m) => m.id === lastId)) { clearTimeout(timer); resolve(parsed); }
    });
    exited.then((code) => { clearTimeout(timer); reject(new Error(`the server exited (${code}) before answering. stderr:\n${err}`)); });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
  child.stdin.end();
  return { responses, stderr: err, code: await exited };
}

test('LIVE: the MCP server sends its requests through the configured proxy, on the same streams', async () => {
  if (!CAPABLE) { onlyWarns(); return; }
  const { seen, out } = await throughProxy(({ env, root }) => mcpExchange(
    { ...env, RESEARCH_KIT_GITHUB_TOKEN: 'placeholder-not-a-token' }, root,
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'proxy-test', version: '0' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fetch_corpus', arguments: { repository: 'octo/repo', workflow_run_id: 1 } } },
    ],
    2,
  ));
  const answer = out.responses.find((m) => m.id === 2);
  assert.ok(answer?.result, `no tools/call result: ${JSON.stringify(out.responses)}`);
  assert.equal(answer.result.isError, true, 'GitHub was unreachable through the refusing proxy');
  assert.equal(out.code, 0, `the server did not stop cleanly when its input closed: ${out.stderr}`);
  assert.ok(tunnelled(seen), `the MCP server went around the proxy: ${JSON.stringify(answer.result.content)}`);
});

// ---------------------------------------------------------------- every such command, by construction

// A command that fetches in its own process is one that imports a module whose functions default
// to the global fetch - directly, or through another module that does. Each must turn the
// proxy on before its first request; a new command that forgets is named here.
test('every command that calls the network in its own process turns the proxy on first', () => {
  const lib = path.join(KIT_ROOT, 'lib');
  const read = (file) => fs.readFileSync(file, 'utf8');
  const direct = fs.readdirSync(lib).filter((f) => f.endsWith('.mjs') && /=\s*globalThis\.fetch\b/.test(read(path.join(lib, f))));
  assert.ok(direct.includes('dispatch.mjs') && direct.includes('disclosure.mjs'), `the scan found ${direct.join(', ')}`);
  const importsAny = (source, names) => names.some((n) => source.includes(`/${n}'`));
  const via = fs.readdirSync(lib).filter((f) => f.endsWith('.mjs') && !direct.includes(f) && importsAny(read(path.join(lib, f)), direct));
  const fetchers = [...direct, ...via];

  const bin = path.join(KIT_ROOT, 'bin');
  const commands = fs.readdirSync(bin).filter((f) => f.endsWith('.mjs') && importsAny(read(path.join(bin, f)), fetchers));
  assert.deepEqual(commands.sort(), ['collect-remote.mjs', 'disclosure.mjs', 'mcp-server.mjs'], 'the set of commands this test protects moved');
  for (const command of commands) {
    assert.match(read(path.join(bin, command)), /await honourEnvProxy\(/, `${command} fetches in its own process and never turns the proxy on`);
  }
});

// ---------------------------------------------------------------- the plan, per Node (E-02, E-03)

const planFor = (env, { version = '22.22.2', setGlobal = null, execArgv = [] } = {}) =>
  envProxyPlan({ env, version, setGlobal, execArgv });
const SWITCH = () => () => {};

test('no proxy configured: nothing changes', () => {
  assert.equal(planFor({}), 'none');
  assert.equal(planFor({ NO_PROXY: '*' }, { setGlobal: SWITCH }), 'none', 'NO_PROXY alone configures no proxy');
});

test('a Node that can turn the proxy on in place does; one with only the startup flag starts again with it', () => {
  for (const key of PROXY_VARIABLES) {
    assert.equal(planFor({ [key]: 'http://p:1' }, { version: '24.21.0', setGlobal: SWITCH }), 'set', key);
    assert.equal(planFor({ [key]: 'http://p:1' }, { version: '22.21.0' }), 'reexec', key);
  }
  assert.equal(planFor(PROXIED, { version: '24.13.0' }), 'reexec', '24.0-24.13 have the flag and not setGlobalProxyFromEnv');
  assert.equal(planFor(PROXIED, { version: '22.20.0' }), 'unsupported', 'no flag before 22.21');
  assert.equal(planFor(PROXIED, { version: '23.11.1' }), 'unsupported', '23 never had it');
});

test('a choice made at startup is never overruled, even a choice of 0', () => {
  assert.equal(planFor({ ...PROXIED, NODE_USE_ENV_PROXY: '0' }, { setGlobal: SWITCH }), 'none');
  assert.equal(planFor({ ...PROXIED, NODE_USE_ENV_PROXY: '1' }), 'none', 'the restart sets it, so a restart cannot loop');
  assert.equal(planFor(PROXIED, { execArgv: ['--use-env-proxy'] }), 'none');
  assert.equal(planFor({ ...PROXIED, NODE_OPTIONS: '--max-old-space-size=4096 --no-use-env-proxy' }, { setGlobal: SWITCH }), 'none');
});

test('the startup proxy choice distinguishes disabled values and respects flag precedence', () => {
  const choice = (env, execArgv = []) => envProxyChoice({ env, execArgv });
  assert.equal(choice({}), null);
  assert.equal(choice({ NODE_USE_ENV_PROXY: '1' }), true);
  for (const value of ['0', 'true', 'yes', '', 'garbage']) {
    const env = { ...PROXIED, NODE_USE_ENV_PROXY: value };
    assert.equal(choice(env), false);
    assert.equal(planFor(env, { setGlobal: SWITCH }), 'none', 'an explicit value must never be overruled');
    assert.equal(fetchEnv(env), env, 'the child environment keeps the operator choice');
    assert.equal(choice(env, ['--use-env-proxy']), true, 'the flag outranks the variable');
  }
  assert.equal(choice({ NODE_USE_ENV_PROXY: '1', NODE_OPTIONS: '--no-use-env-proxy' }), false);
  assert.equal(choice({ NODE_OPTIONS: '--no-use-env-proxy' }, ['--use-env-proxy']), true);
  assert.equal(choice({ NODE_OPTIONS: '--use-env-proxy' }, ['--no-use-env-proxy']), false);
  assert.equal(choice({}, ['--use-env-proxy', '--no-use-env-proxy']), false);
  assert.equal(choice({}, ['--no-use-env-proxy', '--use-env-proxy']), true);
});

test('set: the proxy is turned on once, with the environment, and nothing restarts', async () => {
  const calls = [];
  const got = await honourEnvProxy({
    env: PROXIED, version: '24.21.0', execArgv: [],
    setGlobal: (env) => { calls.push(env); return () => {}; },
    spawn: () => assert.fail('turning the proxy on in place must not restart the command'),
  });
  assert.equal(got, 'set');
  assert.deepEqual(calls, [PROXIED]);
});

test('reexec: the command starts again with the flag, on the same streams, and leaves with its exit code', () => {
  let seen = null;
  const exits = [];
  const child = Object.assign(new EventEmitter(), { killed: [], kill(signal) { this.killed.push(signal); } });
  const signals = new EventEmitter();
  // Never resolves, so it is not awaited: this process's work is now the child's.
  honourEnvProxy({
    env: { ...PROXIED, PATH: '/bin' }, version: '22.22.2', setGlobal: null,
    execPath: '/opt/node', execArgv: ['--no-warnings'], argv: ['/opt/node', '/kit/bin/collect-remote.mjs', '--topic', 'x'],
    spawn: (file, args, opts) => { seen = { file, args, opts }; return child; },
    exit: (code) => exits.push(code), signals,
  });
  assert.ok(seen, 'the command never started again');
  assert.equal(seen.file, '/opt/node');
  // The restart silences exactly one warning: Node 22's "EnvHttpProxyAgent is experimental",
  // printed on every run of a command the operator reads. Every other warning still shows.
  assert.deepEqual(seen.args, ['--disable-warning=UNDICI-EHPA', '--no-warnings', '/kit/bin/collect-remote.mjs', '--topic', 'x']);
  assert.equal(seen.opts.env.NODE_USE_ENV_PROXY, '1');
  assert.equal(seen.opts.env.HTTPS_PROXY, PROXIED.HTTPS_PROXY);
  assert.equal(seen.opts.env.PATH, '/bin', 'the rest of the environment must still reach the command');
  assert.equal(seen.opts.stdio, 'inherit', 'an MCP client talks to the restarted server on these same streams');
  signals.emit('SIGTERM');
  assert.deepEqual(child.killed, ['SIGTERM'], 'a stop meant for the command must reach it');
  child.emit('exit', 4, null);
  assert.deepEqual(exits, [4]);
});

test('unsupported: the command says its requests go direct, and names the version to move to', async () => {
  const written = [];
  const got = await honourEnvProxy({
    env: { https_proxy: 'http://p:1' }, version: '22.20.0', setGlobal: null, execArgv: [],
    spawn: () => assert.fail('no restart can help this Node'),
    stderr: { write: (text) => written.push(text) },
  });
  assert.equal(got, 'unsupported');
  const text = written.join('');
  assert.match(text, /https_proxy/);
  assert.match(text, /22\.20\.0/);
  assert.match(text, /22\.21/, 'the operator is not told which version fixes it');
});

test('none: with no proxy, nothing is turned on and nothing restarts', async () => {
  const got = await honourEnvProxy({
    env: {}, setGlobal: () => assert.fail('turned on with no proxy'), spawn: () => assert.fail('restarted with no proxy'),
  });
  assert.equal(got, 'none');
});

test('the SerpAPI child is started with the flag, from the environment its caller named', () => {
  let seen = null;
  const answer = { status: 0, stdout: JSON.stringify({ ok: true, payload: { organic_results: [] } }), stderr: '' };
  serpapi.runJob({ kind: 'serpapi-search' }, { spawn: (file, args, opts) => { seen = opts; return answer; }, env: { ...PROXIED, PATH: '/bin' } });
  assert.equal(seen?.env?.NODE_USE_ENV_PROXY, '1');
  assert.equal(seen.env.PATH, '/bin');
  const handed = [];
  const job = (payload, opts) => { handed.push(opts.env); return { ok: true, payload: {} }; };
  serpapi.search('q', { key: KEY, env: PROXIED, job });
  serpapi.account({ key: KEY, env: PROXIED, job });
  assert.deepEqual(handed, [PROXIED, PROXIED], 'search() and account() must hand their environment to the child');
});

// ---------------------------------------------------------------- a proxy value Node cannot use
//
// Found 2026-09-27: with the flag on, a scheme-less value such as HTTPS_PROXY=proxy.example:8080
// (a form curl accepts) makes Node's fetch throw at startup - "Invalid URL protocol", an
// uncaught exception from inside Node, not a fetch error. Without the flag, the same value was
// ignored and requests went direct. So turning the proxy on for such a value turned a working
// machine into a crashing one. The value is left alone, and the operator is told.

const MALFORMED = ['proxy.example:8080', 'not a url', 'http://', 'socks5://127.0.0.1:1080',
  'http://proxy.example:8080/path', 'http://proxy.example:8080?x=1', 'http://proxy.example:8080#fragment'];

test('a proxy value Node cannot use is not turned on: the flag stays off, and the plan says why', () => {
  for (const value of MALFORMED) {
    const env = { HTTPS_PROXY: value, PATH: '/bin' };
    assert.equal(fetchEnv(env).NODE_USE_ENV_PROXY, undefined, `${value}: the child would crash on its first request`);
    assert.equal(planFor(env, { version: '24.21.0', setGlobal: SWITCH }), 'invalid', value);
    assert.equal(planFor(env, { version: '22.22.2' }), 'invalid', value);
  }
  assert.equal(planFor({ HTTPS_PROXY: 'http://ok.example:8080', HTTP_PROXY: 'proxy.example:8080' }), 'invalid',
    'one unusable variable is enough: Node builds every configured proxy when the flag is on');
  assert.equal(fetchEnv({ HTTPS_PROXY: 'https://ok.example:8443' }).NODE_USE_ENV_PROXY, '1', 'an https proxy URL is usable');
  assert.equal(fetchEnv({ HTTPS_PROXY: 'http://ok.example:8080/' }).NODE_USE_ENV_PROXY, '1', 'a root slash is a usable origin');
});

test('invalid: the command names the variable, says requests go direct, and shows the form Node needs', async () => {
  const written = [];
  const got = await honourEnvProxy({
    env: { https_proxy: 'proxy.example:8080' }, version: '24.21.0', execArgv: [],
    setGlobal: () => assert.fail('turned on a proxy Node cannot parse'), spawn: () => assert.fail('restarted into a crash'),
    stderr: { write: (text) => written.push(text) },
  });
  assert.equal(got, 'invalid');
  const text = written.join('');
  assert.match(text, /https_proxy/);
  assert.match(text, /direct/);
  assert.match(text, /http:\/\/proxy\.example:8080/, 'the operator is not shown the spelling that works');
});

test('LIVE: an unusable proxy value does not break a search that would have gone direct', async () => {
  // The stand-in answers plain requests itself, so it can play the vendor: reached directly,
  // it returns the payload. The malformed proxy value must leave that path working.
  const vendor = await standInProxy({ body: JSON.stringify(PAYLOAD) });
  try {
    const root = tempDir('rk-proxy-bad-');
    for (const value of ['proxy.example:8080', 'http://proxy.example:8080/path',
      'http://proxy.example:8080?x=1', 'http://proxy.example:8080#fragment']) {
      const r = serpapi.search('direct despite a bad proxy value', {
        key: KEY, endpoint: `${vendor.url}/search`, timeout: 15_000,
        env: { ...hostEnv(root), HTTP_PROXY: value, HTTPS_PROXY: value },
      });
      assert.equal(r.ok, true, `the search broke on a proxy value it should have left alone: ${String(r.error).slice(0, 300)}`);
      assert.equal(r.results[0].url, 'https://a.example/1');
    }
  } finally {
    vendor.close();
  }
});
