// lib/browser-guard.mjs - the proxy Chromium renders through, and the child that runs both
// (ADR-0118).
//
// Chromium follows redirects, runs scripts that navigate, and loads images and frames, all
// inside itself, and `--dump-dom` reports only the DOM at the end. Judging the URL asked for
// (ADR-0115) left everything a page does after it loads unseen. So Chromium is pointed at a
// proxy this file runs on a loopback port, with the loopback bypass turned off, and every
// request it makes - a plain request or a CONNECT tunnel - is judged here, by the rule the
// keyless fetch uses (ADR-0110, ADR-0114), before a byte is sent. The connection then goes to
// the address that was judged, so a second answer from a name server has nowhere to go.
//
// The transport's parent half runs Chromium under spawnSync, which blocks the event loop, so a
// proxy in that process would never answer. This file is therefore also a process entry point:
// given one job on stdin, it starts the proxy, runs Chromium through it, and prints one JSON
// line with the DOM, Chromium's exit, and the refusals.

import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isInternal, internalTarget } from './http-transport.mjs';
import { proxyVariable, MAX_PAGE_BYTES } from './runtime.mjs';
import { tempBase } from './core.mjs';

/** The body of a refused request: what Chromium renders in place of the page it was sent to. */
export const REFUSAL_MARKER = 'research-kit-guard-refused';
const STDERR_LINES = 60;
/** The first lines of the browser's stderr are kept too: a slow start shows there, not in the tail. */
const STDERR_HEAD_LINES = 30;

const normalizeHost = (host) => String(host ?? '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

/**
 * The browser's own service hosts - never a page's (ADR-0124).
 *
 * A full Chrome or Chromium in (new) headless mode runs its browser services whatever the
 * flags: rendering a plain local page through the guard, Chromium 141 asked it for the
 * component updater's clock (`clients2.google.com/time`, carrying a key), the default
 * search engine (`www.google.com`, four preconnects), `accounts.google.com`, the Cloud
 * Messaging check-in (`android.clients.google.com`) and its push channel
 * (`mtalk.google.com:5228`) - nine connections per render that no page asked for, all
 * judged external and carried. `--disable-background-networking`, `--disable-sync`,
 * `--disable-component-update`, Playwright's feature disables, a fresh profile with
 * preconnect, sign-in and push switched off in its preferences, and Chromium's own
 * endpoint-override switches were each measured and left most of them (break-test,
 * 2026-10-02). The guard sees every request, so this is where they stop: a request to one
 * of these hosts is dropped, logged `dropped`, and NOT counted as a refusal - a page did
 * not try to go there. The page the operator asked for is exempt by host and port, as it
 * is from every other judgment, so a page on www.google.com still renders.
 */
export const BROWSER_SERVICE_HOSTS = Object.freeze([
  /^clients[0-9]*\.google\.com$/,            // the component updater, its clock, CRX updates
  /^[a-z0-9-]+\.clients\.google\.com$/,      // android.clients.google.com: the GCM check-in
  /^(alt[0-9]*-)?mtalk\.google\.com$/,        // Google Cloud Messaging's push channel
  /^accounts\.google\.com$/,                  // sign-in and account consistency
  /^www\.google\.com$/,                       // the default-search preconnect
  /^(update|safebrowsing|clientservices|optimizationguide-pa|content-autofill)\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*gvt1\.com$/,               // component and update downloads
  /^dl\.google\.com$/,
]);
export const DROP_MARKER = 'research-kit-guard-dropped';
export function isBrowserService(host) {
  const name = normalizeHost(host);
  return BROWSER_SERVICE_HOSTS.some((pattern) => pattern.test(name));
}

/** `host:port` as a CONNECT names it, with an IPv6 literal in brackets, or null. */
function splitHostPort(target) {
  const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(String(target ?? ''));
  return m ? { host: m[1].replace(/^\[|\]$/g, ''), port: Number(m[2]) } : null;
}

/** The upstream proxy a variable names: its host, port and, when the URL carries one, its credential. */
export function parseUpstream(value) {
  if (!value) return null;
  let url;
  try { url = new URL(String(value).includes('://') ? String(value) : `http://${value}`); } catch { return null; }
  if (!url.hostname) return null;
  const auth = url.username ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`, 'utf8').toString('base64')}` : null;
  return { host: normalizeHost(url.hostname), port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80), auth };
}

/**
 * Whether `host` may be connected to, and at which address.
 *
 *   { refused }  why not: an internal address, or a name that resolves to one
 *   { address }  the address to connect to - the one judged, so the connection is pinned to it
 *   { }          not judged: behind an upstream proxy a name is resolved there, not here
 *
 * `exempt` holds `host:port` of the URL the operator asked for - that one, not every port on
 * its host; `allowInternal` is the operator's own decision for the whole render.
 */
export async function judge(host, port, { allowInternal = false, exempt = new Set(), lookup = dns.lookup, upstream = null } = {}) {
  const name = normalizeHost(host);
  const skip = allowInternal || exempt.has(`${name}:${port}`);
  if (net.isIP(name)) {
    if (!skip && isInternal(name)) return { refused: `${name} is an internal address` };
    return { address: name };
  }
  // A name is judged by what it resolves to even when it is the host asked for (ADR-0155): the
  // exemption is for the address the operator spelled out, which cannot be rebound, not for a
  // name a resolver can point inward after the page was asked for.
  if (!allowInternal && (name === 'localhost' || name.endsWith('.localhost'))) return { refused: `${name} is this machine` };
  let found;
  try {
    found = await new Promise((resolve, reject) => lookup(name, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))));
  } catch (err) {
    // Direct, a name this machine cannot resolve cannot be connected to either; through a
    // proxy it is the proxy's to resolve, and is not this machine's network (ADR-0110).
    return upstream ? {} : { refused: `${name} could not be resolved (${err.code ?? err.message})` };
  }
  const list = Array.isArray(found) ? found : [{ address: found }];
  const inside = list.find((a) => isInternal(a.address));
  if (!allowInternal && inside) return { refused: `${name} resolves to ${inside.address}, an internal address` };
  return upstream ? {} : { address: list[0]?.address };
}

/**
 * Start the guard on a loopback port. Returns `{ port, refused, close }`; `refused` grows with
 * every request turned away, as `{ host, why }`.
 */
export async function startGuard({ allowInternal = false, exempt = [], upstream = null, lookup = dns.lookup, onFirstRequest = null, pageFirst = false } = {}) {
  const up = parseUpstream(upstream);
  const skip = new Set(exempt.map((entry) => { const at = splitHostPort(entry); return at ? `${normalizeHost(at.host)}:${at.port}` : normalizeHost(entry); }));
  const refused = [];
  // The sockets a CONNECT hands over are not the server's to close: tracked, so `close` can end
  // them, or a tunnel the browser left half-open would keep the child alive past its timeout.
  const tunnels = new Set();
  const outgoing = new Set();
  const judgeHost = (host, port) => judge(host, port, { allowInternal, exempt: skip, lookup, upstream: up });
  // The browser's own traffic is not the page's, so it is not judged and not a refusal. It is
  // known two ways: by name (ADR-0124), and - with `pageFirst`, the render's rule - by timing
  // (ADR-0125): until the page the operator asked for has been requested, nothing can be the
  // page's. CI's Chrome stable opened a bare preconnect to www.gstatic.com 256 ms into a
  // render, before the page, and that host is also one real pages use, so a list could not
  // settle it; the order can. `dropped` answers with the reason, or null.
  let pageSeen = !pageFirst;
  const dropped = (host, port) => {
    if (skip.has(`${normalizeHost(host)}:${port}`)) { pageSeen = true; return null; }
    if (!pageSeen) return 'before the page asked for was requested';
    return isBrowserService(host) ? "the browser's own service traffic" : null;
  };
  const refusal = (host, why) => { refused.push({ host, why }); return `${REFUSAL_MARKER}: ${host} - ${why}`; };
  // Every request the guard carried, and whether it was answered: the one place all of a
  // page's loads pass through, so what is still unanswered when the render ends is what the
  // browser was waiting for (found 2026-10-01: three Windows CI runs in a row ran to the
  // deadline, and nothing said on what).
  const seen = [];
  const note = (kind, target) => { const entry = { kind, target, started: Date.now(), ended: null, outcome: null }; seen.push(entry); if (seen.length === 1 && onFirstRequest) onFirstRequest(entry); return entry; };
  const done = (entry, outcome) => { if (entry.ended === null) { entry.ended = Date.now(); entry.outcome = outcome; } };
  const pending = () => seen.filter((e) => e.ended === null).map((e) => ({ kind: e.kind, target: e.target, ms: Date.now() - e.started }));

  const server = http.createServer(async (req, res) => {
    const entry = note('http', String(req.url));
    let target;
    try { target = new URL(req.url); } catch { done(entry, 'refused'); res.writeHead(400); res.end(`${REFUSAL_MARKER}: not a proxy request`); return; }
    if (!/^https?:$/.test(target.protocol)) { done(entry, 'refused'); res.writeHead(400); res.end(`${REFUSAL_MARKER}: ${target.protocol} is not carried`); return; }
    const drop = dropped(target.hostname, Number(target.port) || 80);
    if (drop) { done(entry, 'dropped'); res.writeHead(403, { 'content-type': 'text/plain' }); res.end(`${DROP_MARKER}: ${target.host} - ${drop}`); return; }
    const verdict = await judgeHost(target.hostname, Number(target.port) || 80);
    if (verdict.refused) { done(entry, 'refused'); res.writeHead(403, { 'content-type': 'text/plain' }); res.end(refusal(target.host, verdict.refused)); return; }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const options = up
      ? { host: up.host, port: up.port, path: req.url, method: req.method, headers: up.auth ? { ...headers, 'proxy-authorization': up.auth } : headers }
      : { host: verdict.address, port: Number(target.port) || 80, path: `${target.pathname}${target.search}`, method: req.method, headers: { ...headers, host: target.host } };
    const upstreamRequest = http.request(options, (answer) => { done(entry, String(answer.statusCode)); res.writeHead(answer.statusCode, answer.headers); answer.pipe(res); });
    outgoing.add(upstreamRequest);
    upstreamRequest.on('error', (err) => { done(entry, `error ${err.code ?? err.message}`); if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end(`${target.host}: ${err.code ?? err.message}`); });
    upstreamRequest.on('close', () => outgoing.delete(upstreamRequest));
    req.pipe(upstreamRequest);
  });

  server.on('connect', async (req, client, head) => {
    // The socket is the handler's from here, listeners included. A browser resets a CONNECT it
    // has given up on - a dropped preconnect, with the 403's body still unread - and an
    // ECONNRESET on a socket with no listener is an uncaught exception: the guard child died
    // mid-render with an empty report, which the transport read as "the browser exited null"
    // (three CI legs, 2026-10-02; reproduced with a reset after the headers). Every early
    // answer below writes to this socket, so the listener comes first.
    client.on('error', () => client.destroy());
    const entry = note('connect', String(req.url));
    const at = splitHostPort(req.url);
    const fail = (status, body = '') => { client.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${body}`); };
    if (!at) { done(entry, 'refused'); fail('400 Bad Request'); return; }
    const drop = dropped(at.host, at.port);
    if (drop) { done(entry, 'dropped'); fail('403 Forbidden', `${DROP_MARKER}: ${req.url} - ${drop}`); return; }
    const verdict = await judgeHost(at.host, at.port);
    if (verdict.refused) { done(entry, 'refused'); fail('403 Forbidden', refusal(req.url, verdict.refused)); return; }
    const tunnel = up
      ? net.connect(up.port, up.host, () => {
        // The upstream's own answer to the CONNECT goes back to Chromium as it is.
        done(entry, 'tunnel');
        tunnel.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n${up.auth ? `Proxy-Authorization: ${up.auth}\r\n` : ''}\r\n`);
        if (head.length) tunnel.write(head);
        tunnel.pipe(client);
        client.pipe(tunnel);
      })
      : net.connect(at.port, verdict.address, () => {
        done(entry, 'tunnel');
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) tunnel.write(head);
        tunnel.pipe(client);
        client.pipe(tunnel);
      });
    tunnels.add(client);
    tunnels.add(tunnel);
    tunnel.on('error', (err) => { done(entry, `error ${err.code ?? err.message}`); fail('502 Bad Gateway', `${req.url}: ${err.code ?? err.message}`); });
    tunnel.on('close', () => tunnels.delete(tunnel));
    client.on('error', () => tunnel.destroy());
    client.on('close', () => { tunnels.delete(client); tunnel.destroy(); });
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  // A request to a server that never answers would otherwise outlive the browser and keep
  // the child alive past its timeout (found by a probe with a silent server, 2026-10-01).
  const close = () => new Promise((resolve) => {
    for (const socket of tunnels) socket.destroy();
    tunnels.clear();
    for (const request of outgoing) request.destroy();
    outgoing.clear();
    for (const entry of seen) done(entry, 'unanswered');
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
  return { port: server.address().port, refused, seen, pending, close };
}

/** Chromium's flags that send every request through the guard, and nothing around it. */
export function guardFlags(port) {
  return [`--proxy-server=127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>'];
}

/**
 * Run `binary` through a guard that exempts only the `host:port` of `url`: `args` are its flags
 * ending in `--dump-dom <url>`; the guard's flags are inserted before those two. Resolves to Chromium's exit as spawnSync would report
 * it, plus `refused`, `truncated` and `netLog` (ADR-0137).
 */
export async function renderThroughGuard({ binary, args, url, timeout = 60_000, allowInternal = false, upstream = null, lookup = dns.lookup } = {}) {
  const asked = new URL(url);
  // The host and port asked for are exempt from the literal-address judgment; a name among
  // them is still judged by what it resolves to (ADR-0155).
  const exempt = [`${asked.hostname.replace(/^\[|\]$/g, '').includes(':') ? `[${asked.hostname.replace(/^\[|\]$/g, '')}]` : asked.hostname}:${asked.port || (asked.protocol === 'https:' ? 443 : 80)}`];
  // The render timeout starts at the browser's first request through the guard; the launch
  // is allowed as long again, and no more (ADR-0119): on the CI runners Chromium's process
  // startup took 4 to 43 s before its first request, out of the render budget, and the page
  // was killed before it had been asked for.
  const clock = { timer: null, started: 0, firstRequestAt: null, timedOut: false, kill: () => {} };
  const arm = () => { clearTimeout(clock.timer); clock.timer = setTimeout(() => { clock.timedOut = true; clock.kill(); }, timeout); };
  const guard = await startGuard({ allowInternal, exempt, upstream, lookup, pageFirst: true, onFirstRequest: () => { if (clock.firstRequestAt !== null) return; clock.firstRequestAt = Date.now(); arm(); } });
  // Chromium's net log, for the origin's HTTP status `--dump-dom` does not report (ADR-0137,
  // 2026-10-03): written to a private folder of this render's, read once the browser is gone,
  // and deleted on every way out. A folder that cannot be made means no log, which the
  // transport grades as a status not observed - never a render refused for it.
  let logDir = null;
  try { logDir = fs.mkdtempSync(path.join(tempBase(), 'rk-netlog-')); } catch { logDir = null; }
  const logFile = logDir ? path.join(logDir, 'net-log.json') : null;
  try {
    const argv = [...args.slice(0, -2), ...guardFlags(guard.port), ...(logFile ? [`--log-net-log=${logFile}`] : []), ...args.slice(-2)];
    const rendered = await new Promise((resolve) => {
      let child;
      // Its own process group on POSIX, so a timeout kills the helpers Chromium forks too: left
      // alive, they hold its stdout open and the 'close' event never comes.
      const detached = process.platform !== 'win32';
      try {
        child = spawn(binary, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached });
      } catch (err) {
        resolve({ status: null, signal: null, stdout: '', stderr: '', errorCode: err.code ?? 'SPAWN', errorMessage: err.message, refused: guard.refused, truncated: false });
        return;
      }
      const out = [];
      let size = 0;
      let truncated = false;
      const errHead = [];
      const errLines = [];
      let errDropped = 0;
      let settled = false;
      const stderrKept = () => [...errHead, ...(errDropped ? [`... ${errDropped} lines omitted ...`] : []), ...errLines].join('\n');
      const kill = () => {
        try { if (detached) process.kill(-child.pid, 'SIGKILL'); else child.kill(); } catch { /* already gone */ }
      };
      clock.kill = kill;
      arm();
      const started = Date.now();
      clock.started = started;
      const settle = (status, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(clock.timer);
        const timedOut = clock.timedOut;
        resolve({
          status, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: stderrKept(),
          errorCode: timedOut ? 'ETIMEDOUT' : null, errorMessage: timedOut ? `the browser did not finish within ${timeout}ms` : null,
          refused: guard.refused, truncated, requests: guard.seen.length, pending: guard.pending(), elapsedMs: Date.now() - started, startedAt: new Date(started).toISOString(),
          startupMs: clock.firstRequestAt === null ? null : clock.firstRequestAt - started,
          // The whole record as a timeline from the launch: where a slow render's time went.
          seen: guard.seen.map((e) => ({ kind: e.kind, target: e.target, outcome: e.outcome, startedMs: Math.max(0, e.started - started), ms: (e.ended ?? Date.now()) - e.started })),
        });
      };
      child.stdout.on('data', (chunk) => {
        if (truncated) return;
        size += chunk.length;
        if (size > MAX_PAGE_BYTES) { truncated = true; out.length = 0; kill(); return; }
        out.push(chunk);
      });
      child.stderr.on('data', (chunk) => {
        for (const line of String(chunk).split('\n')) {
          if (!line) continue;
          if (errHead.length < STDERR_HEAD_LINES) { errHead.push(line); continue; }
          errLines.push(line);
        }
        if (errLines.length > STDERR_LINES) { errDropped += errLines.length - STDERR_LINES; errLines.splice(0, errLines.length - STDERR_LINES); }
      });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(clock.timer);
        resolve({ status: null, signal: null, stdout: '', stderr: stderrKept(), errorCode: err.code ?? 'SPAWN', errorMessage: err.message, refused: guard.refused, truncated });
      });
      // 'close' follows 'exit' once the pipes drain; a helper that outlived the browser would
      // hold them open, so the exit is reported after a short grace either way.
      child.on('close', (status, signal) => settle(status, signal));
      child.on('exit', (status, signal) => { setTimeout(() => settle(status, signal), 1000).unref(); });
    });
    return { ...rendered, netLog: readNetLog(logFile) };
  } finally {
    await guard.close();
    if (logDir) { try { fs.rmSync(logDir, { recursive: true, force: true }); } catch { /* a temp folder that will not go is the OS's business */ } }
  }
}

/** The net log's text, '' when there is none or it is past MAX_PAGE_BYTES (dropped whole, ADR-0082). */
function readNetLog(file) {
  if (!file) return '';
  try { return fs.statSync(file).size > MAX_PAGE_BYTES ? '' : fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

// ---------------------------------------------------------------- the child half

async function child() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let job;
  try { job = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (err) {
    process.stdout.write(JSON.stringify({ errorCode: 'BAD_JOB', errorMessage: `unparseable job: ${err.message}` }));
    return;
  }
  try {
    // ADR-0110: an internal URL the operator asked for is theirs, redirects and all, unless the
    // caller decided otherwise; RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS=1 lifts the check.
    const allowInternal = job.allowInternalRedirects === true
      || (job.allowInternalRedirects !== false && await internalTarget(new URL(job.url).hostname) !== null);
    // A caller that said `false` refused this machine's network for the whole render, and a
    // NAME asked for is judged by what it resolves to before any browser is launched
    // (ADR-0155): the guard exempted the host and port asked for by name, so a name pointed
    // inward was rendered as "the page" (found 2026-10-10, audit). A literal address the
    // caller spelled out is the caller's. Nothing is rendered for a refused name.
    if (job.allowInternalRedirects === false) {
      const asked = new URL(job.url);
      const why = net.isIP(asked.hostname.replace(/^\[|\]$/g, '')) ? null : await internalTarget(asked.hostname);
      if (why) {
        process.stdout.write(JSON.stringify({ errorCode: 'EINTERNAL', errorMessage: `refused to render ${asked.host} - ${why}. `
          + 'This render was asked to stay out of this machine\'s network; if you meant that address, fetch it as your own '
          + '(the default policy), or set RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS=1.', refused: [{ host: asked.host, why }], allowInternal: false }), () => process.exit(0));
        return;
      }
    }
    const variable = proxyVariable(process.env);
    const result = await renderThroughGuard({ ...job, allowInternal, upstream: variable ? process.env[variable] : null });
    // The decision is reported with the render: the transport judges the final URL the net log
    // names by the same rule, and only this half resolved the URL asked for (ADR-0137).
    process.stdout.write(JSON.stringify({ ...result, allowInternal }), () => process.exit(0));
  } catch (err) {
    process.stdout.write(JSON.stringify({ errorCode: err.code ?? 'GUARD', errorMessage: err.message }), () => process.exit(0));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await child();
}
