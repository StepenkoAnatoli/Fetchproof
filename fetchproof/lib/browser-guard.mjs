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
import { tempBase, removeRetrying } from './core.mjs';

/** The body of a refused request: what Chromium renders in place of the page it was sent to. */
export const REFUSAL_MARKER = 'fetchproof-guard-refused';
const STDERR_LINES = 60;
/** The first lines of the browser's stderr are kept too: a slow start shows there, not in the tail. */
const STDERR_HEAD_LINES = 30;
/**
 * How long a killed browser is waited for before the render is reported without its exit. The
 * parent allows 10 s past the render budget to kill and report (ADR-0119), not to wait on the
 * OS: on the operator's Windows PC (2026-10-21) Chromium printed the whole page, did not exit,
 * and took 15 s to more than 35 s to go after the kill, so the parent gave the child up and
 * the page went with it.
 */
export const KILL_GRACE_MS = 3000;

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
export const DROP_MARKER = 'fetchproof-guard-dropped';
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
 * The hosts a configured proxy is not used for, from a NO_PROXY value (#314): `'*'` for
 * everything, else a list of `{ host, port, subnet }`.
 *
 * Read as curl reads it: entries separated by commas or spaces; a name, which also covers its
 * subdomains, with or without a leading `.` or `*.`; an IP address; a CIDR range
 * (`127.0.0.0/8`); any of them with `:port` (an IPv6 address in brackets, then; a bare `::1`
 * is the address). Found 2026-10-11: the keyless route honoured NO_PROXY through Node's
 * env-proxy support and the guard forwarded everything to the upstream, so a loopback or
 * intranet page collected on one route and failed on the other.
 *
 * Node's reading - undici's EnvHttpProxyAgent, which the keyless route's fetch uses - is
 * narrower: a bare name matches only itself, a CIDR range matches nothing, and an unbracketed
 * IPv6 address is split at its last colon as if it carried a port. For those entries this route
 * goes direct where the keyless route still asks the proxy: the wider reading only sends
 * direct what the operator listed.
 */
export function parseNoProxy(value) {
  const entries = [];
  for (const raw of String(value ?? '').split(/[,\s]+/)) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    if (item === '*') return '*';
    let host = item;
    let port = 0;
    const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(item);
    if (bracketed) { host = bracketed[1]; port = Number(bracketed[2] ?? 0); }
    else if ((item.match(/:/g) ?? []).length === 1) {
      const at = /^(.+):(\d+)$/.exec(item);
      if (at) { host = at[1]; port = Number(at[2]); }
    }
    const cidr = /^(.+)\/(\d{1,3})$/.exec(host);
    if (cidr && net.isIP(cidr[1])) {
      const family = net.isIP(cidr[1]) === 6 ? 'ipv6' : 'ipv4';
      const subnet = new net.BlockList();
      try { subnet.addSubnet(cidr[1], Number(cidr[2]), family); } catch { continue; }
      entries.push({ host: '', port, subnet });
      continue;
    }
    entries.push({ host: normalizeHost(host.replace(/^\*?\./, '')), port, subnet: null });
  }
  return entries;
}

/** Whether `host:port` is on a parsed NO_PROXY list, and so goes direct rather than to the upstream. */
export function bypassesProxy(list, host, port) {
  if (list === '*') return true;
  if (!Array.isArray(list) || !list.length) return false;
  const name = normalizeHost(host);
  const family = net.isIP(name);
  return list.some((entry) => {
    if (entry.port && entry.port !== Number(port)) return false;
    if (entry.subnet) return family !== 0 && entry.subnet.check(name, family === 6 ? 'ipv6' : 'ipv4');
    return name === entry.host || (family === 0 && name.endsWith(`.${entry.host}`));
  });
}

/** The NO_PROXY value in `env`, read as Node's fetch reads it: the lower-case name first. */
export function noProxyOf(env = process.env) {
  return env.no_proxy ?? env.NO_PROXY ?? '';
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
export async function startGuard({ allowInternal = false, exempt = [], upstream = null, bypass = '', lookup = dns.lookup, onFirstRequest = null, pageFirst = false } = {}) {
  const configured = parseUpstream(upstream);
  // A host the environment's NO_PROXY names is connected to directly, judged as it is with no
  // upstream at all; everything else goes to the upstream (#314).
  const noProxy = parseNoProxy(bypass);
  const upstreamFor = (host, port) => (configured && !bypassesProxy(noProxy, host, port) ? configured : null);
  const skip = new Set(exempt.map((entry) => { const at = splitHostPort(entry); return at ? `${normalizeHost(at.host)}:${at.port}` : normalizeHost(entry); }));
  const refused = [];
  // The sockets a CONNECT hands over are not the server's to close: tracked, so `close` can end
  // them, or a tunnel the browser left half-open would keep the child alive past its timeout.
  const tunnels = new Set();
  const outgoing = new Set();
  // And every socket the server accepted: a CONNECT leaves the server's own bookkeeping when it
  // is handed over, so one the browser kept open - a refusal it never closed, one still being
  // judged - kept `close` waiting while a browser the kill had not ended still ran (2026-10-21).
  const accepted = new Set();
  const judgeHost = (host, port, up) => judge(host, port, { allowInternal, exempt: skip, lookup, upstream: up });
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
    const up = upstreamFor(target.hostname, Number(target.port) || 80);
    const verdict = await judgeHost(target.hostname, Number(target.port) || 80, up);
    if (verdict.refused) { done(entry, 'refused'); res.writeHead(403, { 'content-type': 'text/plain' }); res.end(refusal(target.host, verdict.refused)); return; }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const options = up
      ? { host: up.host, port: up.port, path: req.url, method: req.method, headers: up.auth ? { ...headers, 'proxy-authorization': up.auth } : headers }
      : { host: verdict.address, port: Number(target.port) || 80, path: `${target.pathname}${target.search}`, method: req.method, headers: { ...headers, host: target.host } };
    const upstreamRequest = http.request(options, (answer) => {
      done(entry, String(answer.statusCode));
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
      // A body the origin cut off is cut off for the browser too (#315): piped, the answer that
      // never completed left the browser's response open, and the browser rendered what had
      // arrived as the page once its deadline ran out. Closed, the browser names the error.
      answer.on('close', () => { if (!answer.complete) res.destroy(); });
    });
    outgoing.add(upstreamRequest);
    upstreamRequest.on('error', (err) => {
      done(entry, `error ${err.code ?? err.message}`);
      // After the headers the error text would only be appended to the page's body.
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`${target.host}: ${err.code ?? err.message}`);
    });
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
    const up = upstreamFor(at.host, at.port);
    const verdict = await judgeHost(at.host, at.port, up);
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

  server.on('connection', (socket) => { accepted.add(socket); socket.on('close', () => accepted.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  // A request to a server that never answers would otherwise outlive the browser and keep
  // the child alive past its timeout (found by a probe with a silent server, 2026-10-01).
  const close = () => new Promise((resolve) => {
    for (const socket of tunnels) socket.destroy();
    tunnels.clear();
    for (const request of outgoing) request.destroy();
    outgoing.clear();
    for (const entry of seen) done(entry, 'unanswered');
    for (const socket of accepted) socket.destroy();
    accepted.clear();
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
  return { port: server.address().port, refused, seen, pending, close };
}

/** Chromium's flags that send every request through the guard, and nothing around it. */
export function guardFlags(port) {
  return [`--proxy-server=127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>'];
}

/** The start of a render's folder's name, in the kit's temp folder (ADR-0185). */
const RENDER_FOLDER_PREFIX = 'fp-render-';

/**
 * A new, empty folder for one render: the browser's profile and its net log go in it, and it
 * goes with the render (ADR-0185). null when none can be made - the browser then runs on a
 * profile of its own choosing, and without a net log, as it did before; never a render refused.
 */
export function makeRenderFolder() {
  try { return fs.mkdtempSync(path.join(tempBase(), RENDER_FOLDER_PREFIX)); } catch { return null; }
}

/** A folder a job may name as its render's: an absolute path whose last part makeRenderFolder would have made. */
function isRenderFolder(dir) {
  return typeof dir === 'string' && path.isAbsolute(dir) && path.basename(dir).startsWith(RENDER_FOLDER_PREFIX);
}

/**
 * Run `binary` through a guard that exempts only the `host:port` of `url`: `args` are its flags
 * ending in `--dump-dom <url>`; the guard's flags are inserted before those two. Resolves to Chromium's exit as spawnSync would report
 * it, plus `refused`, `truncated` and `netLog` (ADR-0137). `folder` is the render's folder the
 * transport made (ADR-0185); without one, this render makes its own. `since` is when the launch
 * allowance began, on this process's monotonic clock (`performance.now()`): the guard child's
 * own start, 0 (ADR-0188); without one, the launch.
 */
export async function renderThroughGuard({ binary, args, url, timeout = 60_000, allowInternal = false, upstream = null, bypass = '', lookup = dns.lookup, folder = null, since = null } = {}) {
  const asked = new URL(url);
  // The host and port asked for are exempt from the literal-address judgment; a name among
  // them is still judged by what it resolves to (ADR-0155).
  const exempt = [`${asked.hostname.replace(/^\[|\]$/g, '').includes(':') ? `[${asked.hostname.replace(/^\[|\]$/g, '')}]` : asked.hostname}:${asked.port || (asked.protocol === 'https:' ? 443 : 80)}`];
  // The render timeout starts at the browser's first request through the guard; the launch
  // is allowed as long again, less what the guard child's own start spent when `since` is
  // given (ADR-0119, ADR-0188): on the CI runners Chromium's process startup took 4 to 43 s
  // before its first request, out of the render budget, and the page was killed before it
  // had been asked for.
  const clock = { timer: null, started: 0, firstRequestAt: null, timedOut: false, kill: () => {} };
  const arm = (ms = timeout) => { clearTimeout(clock.timer); clock.timer = setTimeout(() => { clock.timedOut = true; clock.kill(); }, ms); };
  const guard = await startGuard({ allowInternal, exempt, upstream, bypass, lookup, pageFirst: true, onFirstRequest: () => { if (clock.firstRequestAt !== null) return; clock.firstRequestAt = Date.now(); arm(); } });
  // The render's folder (ADR-0185): the browser's profile and its net log - for the origin's
  // HTTP status `--dump-dom` does not report (ADR-0137) - are written there, read once the
  // browser is gone, or as they stand when the kill has not ended it within KILL_GRACE_MS, and
  // removed with the folder on every way out. Without --user-data-dir,
  // Chromium made a HeadlessChrome profile in the temp folder per render and left it there,
  // killed or not (B1, 2026-10-19). The transport makes the folder and removes it again after
  // this child, so a child killed before its finally leaves nothing either. A folder that
  // cannot be made means no profile flag and no log, which the transport grades as a status
  // not observed - never a render refused for it.
  const dir = isRenderFolder(folder) ? folder : makeRenderFolder();
  let profile = null;
  if (dir) { try { fs.mkdirSync(path.join(dir, 'profile'), { recursive: true }); profile = path.join(dir, 'profile'); } catch { profile = null; } }
  const logFile = profile ? path.join(dir, 'net-log.json') : null;
  // False when the render was reported without the browser's exit: the browser still holds
  // the folder, so it is tried once here, and again by the transport (ADR-0188).
  let exitSeen = true;
  try {
    const own = profile ? [`--user-data-dir=${profile}`, `--log-net-log=${logFile}`] : [];
    const argv = [...args.slice(0, -2), ...guardFlags(guard.port), ...own, ...args.slice(-2)];
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
      let grace = null;
      const kill = () => {
        // The kill is asked for, and its exit is not awaited past KILL_GRACE_MS: the page read
        // so far is reported, as after any kill, without the exit the OS has not delivered.
        // Armed first, so an exit the kill reports at once clears it.
        if (grace === null) grace = setTimeout(() => { exitSeen = false; settle(null, null); }, KILL_GRACE_MS).unref();
        try { if (detached) process.kill(-child.pid, 'SIGKILL'); else child.kill(); } catch { /* already gone */ }
      };
      clock.kill = kill;
      // The launch allowance began with the guard child, not with the browser: the parent counts
      // from the child's spawn, and a boot slowed by load was in none of its times (ADR-0188).
      // Counted on the monotonic clock, as the parent's cutoff is: a step of the wall clock would
      // move the kill.
      arm(Math.max(0, timeout - (Number.isFinite(since) ? Math.max(0, performance.now() - since) : 0)));
      const started = Date.now();
      clock.started = started;
      const settle = (status, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(clock.timer);
        clearTimeout(grace);
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
        clearTimeout(grace);
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
    // Tried again while the browser's helpers still hold it; one that will not go is left,
    // and the render's result stands (ADR-0185). A browser not yet gone holds it for longer
    // than the retries: one try, and the time is left to the parent (ADR-0188).
    removeRetrying(dir, exitSeen ? {} : { retries: 0 });
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
    // caller decided otherwise; FETCHPROOF_ALLOW_INTERNAL_REDIRECTS=1 lifts the check.
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
          + '(the default policy), or set FETCHPROOF_ALLOW_INTERNAL_REDIRECTS=1.', refused: [{ host: asked.host, why }], allowInternal: false }), () => process.exit(0));
        return;
      }
    }
    const variable = proxyVariable(process.env);
    // NO_PROXY from the same environment the proxy was read from (#314).
    // The launch allowance runs from this process's start - 0 on its monotonic clock - which the
    // parent's clock counts from too (ADR-0188).
    const result = await renderThroughGuard({ ...job, allowInternal, upstream: variable ? process.env[variable] : null, bypass: noProxyOf(process.env), since: 0 });
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
