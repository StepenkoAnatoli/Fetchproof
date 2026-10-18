// lib/browser-transport.mjs - render a page with a local Chromium, from the command line
// (ADR-0088). Research: docs/decisions/2026-09-28-browser-transport.
//
// Free, keyless and dependency-free: `--headless --dump-dom <url>` prints the rendered DOM
// (E-01, E-02), and the keyless transport's own extractor turns it into a graded capture, so
// both transports grade pages by one rule. It reads what the keyless transport cannot: on
// 2026-09-28 a GitHub Discussion answered the keyless client HTTP 403 and rendered here in full.
//
// Fetch only. It does not search; a run on it searches with the keyless route (transport.mjs).
//
// Every request Chromium makes goes through a guard proxy the kit runs (ADR-0118), in a child
// process (`browser-guard.mjs`): a page on the web cannot send the browser into this machine's
// network, whether by a redirect, a script, a meta refresh or an image.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { mainContent, htmlToMarkdown, titleOf, gradeCompleteness, isInternal, serverReason, bodyKind, decodeEntities, retryAfter } from './http-transport.mjs';
import httpKeyless from './http-transport.mjs';
import { REFUSAL_MARKER } from './browser-guard.mjs';
import { CHILD_OUTPUT_LIMIT, MAX_PAGE_BYTES, outputOverflow } from './runtime.mjs';
import { loadConfig } from './machine.mjs';

const GUARD_CHILD = fileURLToPath(new URL('./browser-guard.mjs', import.meta.url));

export const name = 'browser';
export const CONTRACTS = Object.freeze(['fetch']);
export const TIMEOUT_MS = 60_000;
/** Time given to a page's scripts to settle before the DOM is dumped. */
export const VIRTUAL_TIME_MS = 8_000;

/** Where a browser usually lives, per platform. The first that exists is used. */
const USUAL = {
  // Chrome stable first: Ubuntu 23.10+ lets only binaries with an AppArmor userns profile
  // start Chromium's sandbox, and it ships one for /opt/google/chrome/chrome - the path the
  // google-chrome launchers exec (ADR-0092). Other builds come after.
  linux: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ],
};

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** The browser to run: machine config `browserPath`, then RESEARCH_KIT_BROWSER, then the usual paths. '' when none. */
export function findBrowser({ config = {}, env = process.env, exists = isFile, platform = process.platform } = {}) {
  for (const candidate of [config?.browserPath, env.RESEARCH_KIT_BROWSER]) {
    if (typeof candidate === 'string' && candidate.trim() && exists(candidate.trim())) return candidate.trim();
  }
  return (USUAL[platform] ?? []).find((p) => exists(p)) ?? '';
}

/**
 * The argv, URL last. The guard child adds `--proxy-server` for its own proxy (ADR-0118); a
 * configured proxy (E-03) is the guard's upstream, never Chromium's directly. The background
 * traffic Chromium makes on its own - update checks, time sync - is switched off: each such
 * request would otherwise go through the guard too. `--no-sandbox` only as root, where
 * Chromium refuses to start with its sandbox (U-03, a known unknown). There is no flag that
 * weakens TLS: a TLS-intercepting proxy is trusted by adding its CA to the browser's store,
 * never by `--ignore-certificate-errors`.
 */
export function browserArgs(url, { uid = typeof process.getuid === 'function' ? process.getuid() : -1, timeout = TIMEOUT_MS } = {}) {
  // Chromium's own deadline, under the transport's kill timeout. With --virtual-time-budget
  // alone, headless waits on a pending load for ever - virtual time advances only when the
  // page is idle - so one resource that never answers meant no dump, no stderr, and a kill
  // with nothing to show (CI, 2026-10-01, four times in an afternoon on Windows and Ubuntu;
  // reproduced with a page whose image never arrives). At the deadline Chromium stops
  // loading, dumps the DOM it has and exits: the page is captured as it stands. The kill is
  // for a browser that is not answering at all, ten seconds later.
  const deadline = deadlineFor(timeout);
  const args = ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', `--virtual-time-budget=${VIRTUAL_TIME_MS}`, `--timeout=${deadline}`];
  if (uid === 0) args.push('--no-sandbox');
  args.push('--dump-dom', String(url));
  return args;
}

/**
 * Run the browser through the guard child, and report its exit as spawnSync would: `status`,
 * `signal`, `stdout`, `stderr`, `error`, plus `refused` (the requests the guard turned away),
 * `truncated` (a DOM past MAX_PAGE_BYTES, dropped rather than kept in part, ADR-0082) and
 * `netLog` (the text of Chromium's net log, '' when none was written, ADR-0137). A stub
 * render that leaves `netLog` out is a render whose status was not observed.
 */
/**
 * How long the parent waits for the guard child: the launch allowance and the render budget -
 * each `timeout`, ADR-0119 - and 10 s for the child to kill the browser and report. Shorter,
 * and the parent is the timeout: at timeout + 10 s it killed a render that was inside its
 * budget on the operator's PC (2026-10-04, break-test pass 6 F1), and the child's record of
 * where the time went died with it - the verdict read "never made a request in 0 s".
 */
export function guardChildTimeout(timeout = TIMEOUT_MS) {
  return 2 * timeout + 10_000;
}

export function renderGuarded(binary, args, { url, env = process.env, timeout = TIMEOUT_MS, allowInternalRedirects, nodePath = process.execPath, spawn = spawnSync } = {}) {
  // ADR-0110: undefined lets the child decide from the URL asked for; the operator's opt-out,
  // or a caller's explicit choice, overrides it.
  const allow = allowInternalRedirects ?? (env.RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS === '1' ? true
    : env.RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS === '0' ? false : undefined);
  const job = { binary, args, url: String(url), timeout, ...(allow === undefined ? {} : { allowInternalRedirects: allow }) };
  const result = spawn(nodePath, [GUARD_CHILD], {
    input: JSON.stringify(job), encoding: 'utf8', timeout: guardChildTimeout(timeout), windowsHide: true, maxBuffer: CHILD_OUTPUT_LIMIT, env,
  });
  const failed = (code, message) => ({ status: null, signal: null, stdout: '', stderr: '', error: Object.assign(new Error(message), { code }), refused: [] });
  if (result.error?.code === 'ETIMEDOUT') return { ...failed('ETIMEDOUT', `the guard child did not finish within ${Math.round(guardChildTimeout(timeout) / 1000)} s - the launch allowance, the render budget and 10 s to report (ADR-0119) - so its record of where the time went was lost`), gaveUp: true };
  const overflow = outputOverflow(result, 'the browser');
  if (overflow) return failed('ENOBUFS', overflow);
  if (result.error) return failed(result.error.code ?? 'SPAWN', result.error.message);
  let report;
  try { report = JSON.parse(String(result.stdout ?? '').trim() || '{}'); } catch (err) {
    return failed('GUARD', `the guard child emitted unparseable output: ${err.message}${result.stderr ? ` (${String(result.stderr).trim().slice(0, 200)})` : ''}`);
  }
  return {
    status: report.status ?? null, signal: report.signal ?? null, stdout: report.stdout ?? '', stderr: report.stderr ?? '',
    error: report.errorCode ? Object.assign(new Error(report.errorMessage ?? report.errorCode), { code: report.errorCode }) : undefined,
    refused: report.refused ?? [], truncated: Boolean(report.truncated),
    requests: Number(report.requests) || 0, pending: Array.isArray(report.pending) ? report.pending : [], elapsedMs: Number(report.elapsedMs) || 0,
    seen: Array.isArray(report.seen) ? report.seen : [], startedAt: typeof report.startedAt === 'string' ? report.startedAt : '',
    startupMs: Number.isFinite(report.startupMs) ? report.startupMs : null,
    // Chromium's net log, for the origin's status (ADR-0137): '' when there is none. And the
    // child's own decision on internal addresses, which judged the URL asked for by resolving it.
    netLog: typeof report.netLog === 'string' ? report.netLog : '',
    allowInternal: typeof report.allowInternal === 'boolean' ? report.allowInternal : undefined,
  };
}

/** Chromium's own deadline for a render: ten seconds under the kill timeout, never below five. */
export function deadlineFor(timeout = TIMEOUT_MS) {
  return Math.max(5_000, timeout - 10_000);
}

/**
 * A conservative partial-capture note from process duration and the guard's final
 * pending snapshot. State the configured deadline and requests at process completion:
 * neither observation timestamps the DOM dump or identifies the historical wait.
 * Null when the process finished below the threshold and no request remained pending.
 * Chromium's stderr is not the signal: it logs "Page load timed out" only when the
 * navigation itself never committed, not for a stalled resource.
 */
export function cutAtDeadline(result, timeout) {
  const pending = Array.isArray(result.pending) ? result.pending : [];
  const deadline = deadlineFor(timeout);
  // Process time after the first guard request (ADR-0119), not a measured DOM-arrival time.
  const ranToDeadline = ((Number(result.elapsedMs) || 0) - (Number(result.startupMs) || 0)) >= deadline - 500;
  if (!pending.length && !ranToDeadline) return null;
  const head = `the browser had a configured ${Math.round(deadline / 1000)} s loading deadline`;
  if (pending.length) {
    return `${head}; still unanswered through the guard at process completion: ${pending.map((p) => `${p.target} (${Math.round(p.ms / 1000)} s)`).join(', ')}`;
  }
  return `${head}; every one of the ${Number(result.requests) || 0} requests through the guard had been answered at process completion`;
}

/**
 * Chromium's own error page, by the code it prints - '' for a real page.
 *
 * `--dump-dom` exits 0 when the page failed: behind a proxy whose CA it did not trust it
 * printed a "Privacy error" interstitial carrying ERR_CERT_AUTHORITY_INVALID, the same
 * 131,208 bytes for two different URLs. Trusting the exit code would file that as evidence.
 */
export function chromeErrorOf(html) {
  const text = String(html ?? '');
  if (!/id="main-frame-error"|<title>\s*Privacy error\s*<\/title>/i.test(text)) return '';
  return text.match(/\b(?:NET::)?(ERR_[A-Z_]+)\b/)?.[1] ?? 'ERR_UNKNOWN';
}

/** A URL as Chromium logs it - canonical, without the fragment it never sends - or '' when it is not one. */
function canonicalUrl(url) {
  try { const u = new URL(String(url)); u.hash = ''; return u.href; } catch { return ''; }
}

/**
 * The HTTP status and final URL of the page asked for, from Chromium's net log - or null when
 * the log does not say (ADR-0137, output-reliability audit G5, 2026-10-03).
 *
 * `--dump-dom` reports no status, so an origin's own "403 Forbidden" page was rendered like
 * any page, graded full, and the collector's ">= 400 is a failed fetch" rule never fired: it
 * reads a number, and every browser capture carried ''. Chromium reports the status itself,
 * in the net log `--log-net-log` writes: `{ constants, events }`, where an event's `type` and
 * its source's `type` are numbers named only by `constants.logEventTypes` and
 * `constants.logSourceType` - so both are resolved through the log's own constants, never by
 * number. The document is the URL_REQUEST source whose first URL_REQUEST_START_JOB names the
 * URL asked for, a "main frame" one first; each redirect starts a new job on that source with
 * its own URL, so the last job's URL is final, and its last HTTP_TRANSACTION_READ_RESPONSE_HEADERS
 * carries the status line in `params.headers[0]`. A job that read no response leaves no status:
 * a redirect's own 302 is not the page's.
 *
 * `log` is the log's text or its parsed JSON. Text that does not parse - Chromium killed at
 * the timeout leaves the file without its closing `]}` - is no status, never a guess.
 *
 * Beside the status, what the same response says about its body (#315): `contentType` and
 * `retryAfter`, from the header lines after the status line ('' when absent), and `netError`
 * - the name of the network error the document's read ended in after those headers (an event
 * on its source carrying `net_error`, named through `constants.netError`), '' when it ended
 * cleanly. ERR_ABORTED is not one: it is the browser stopping a load, which the deadline
 * already grades.
 */
export function documentStatusFromNetLog(log, requested) {
  let parsed = log;
  if (typeof log === 'string') { try { parsed = JSON.parse(log); } catch { return null; } }
  const types = parsed?.constants?.logEventTypes;
  const sources = parsed?.constants?.logSourceType;
  const events = parsed?.events;
  if (!types || !sources || !Array.isArray(events)) return null;
  const URL_REQUEST = sources.URL_REQUEST;
  const START_JOB = types.URL_REQUEST_START_JOB;
  const HEADERS = types.HTTP_TRANSACTION_READ_RESPONSE_HEADERS;
  if (![URL_REQUEST, START_JOB, HEADERS].every(Number.isInteger)) return null;
  const want = canonicalUrl(requested);
  if (!want) return null;
  const errors = parsed.constants.netError && typeof parsed.constants.netError === 'object' ? parsed.constants.netError : {};
  const errorName = (code) => {
    const named = Object.keys(errors).find((key) => errors[key] === code);
    return named ? (named.startsWith('ERR_') ? named : `ERR_${named}`) : `net error ${code}`;
  };
  const aborted = Number.isInteger(errors.ERR_ABORTED) ? errors.ERR_ABORTED : -3;
  const header = (lines, wanted) => {
    const line = lines.slice(1).map(String).find((l) => l.slice(0, l.indexOf(':')).trim().toLowerCase() === wanted);
    return line ? line.slice(line.indexOf(':') + 1).trim() : '';
  };
  const fresh = { statusCode: null, contentType: '', retryAfter: '', netError: '' };
  const requests = new Map();   // source id -> { first, mainFrame, url, statusCode, contentType, retryAfter, netError }
  for (const event of events) {
    if (event?.source?.type !== URL_REQUEST) continue;
    const id = event.source.id;
    const seen = requests.get(id);
    if (event.type === START_JOB && typeof event.params?.url === 'string') {
      if (seen) { Object.assign(seen, fresh, { url: event.params.url }); continue; }
      requests.set(id, { first: event.params.url, mainFrame: event.params.request_type === 'main frame', url: event.params.url, ...fresh });
    } else if (event.type === HEADERS) {
      const lines = Array.isArray(event.params?.headers) ? event.params.headers : [];
      const status = /^HTTP\/[\d.]+\s+(\d{3})(?:\s|$)/.exec(String(lines[0] ?? ''))?.[1];
      if (seen && status) Object.assign(seen, { statusCode: Number(status), contentType: header(lines, 'content-type'), retryAfter: header(lines, 'retry-after'), netError: '' });
    } else if (seen && seen.statusCode !== null && !seen.netError) {
      const code = event.params?.net_error;
      if (Number.isInteger(code) && code < 0 && code !== aborted) seen.netError = errorName(code);
    }
  }
  const asked = [...requests.values()].filter((r) => canonicalUrl(r.first) === want);
  const doc = asked.find((r) => r.mainFrame) ?? asked[0];
  if (!doc || doc.statusCode === null) return null;
  return { statusCode: doc.statusCode, finalUrl: doc.url, contentType: doc.contentType, retryAfter: doc.retryAfter, netError: doc.netError };
}

/**
 * The text of a non-HTML response as Chromium rendered it (#315). Chromium's text viewer makes
 * the body one `<pre>` holding the escaped text - a JSON body adds an empty formatter `<div>`
 * after it (Chrome 154, 2026-10-17) - and only that shape is the response's text, entities
 * decoded. Anything else - XML gets a tree viewer, a page may carry several `<pre>` - is the
 * document's text with the tags taken out, and says it is not verbatim (review, 2026-10-18:
 * the first `<pre>` of any dump had been kept as the whole response, graded full).
 */
const TEXT_VIEWER = /^<pre\b[^<>]*>([^<]*)<\/pre>(?:<div class="json-formatter-container"><\/div>)?$/i;
function renderedText(html) {
  const lower = html.toLowerCase();
  const at = lower.indexOf('<body');
  const open = at === -1 ? -1 : lower.indexOf('>', at);
  const close = lower.lastIndexOf('</body>');
  const inner = open === -1 ? html : html.slice(open + 1, close > open ? close : undefined);
  const viewer = TEXT_VIEWER.exec(inner.trim());
  if (viewer) return { text: decodeEntities(viewer[1]), verbatim: true };
  return { text: decodeEntities(inner.replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').trim()), verbatim: false };
}

/** `host:port` of a URL, the port spelled out as the guard's exemption spells it; '' when it is not a URL. */
function hostPort(url) {
  try { const u = new URL(String(url)); return `${u.hostname.toLowerCase()}:${u.port || (u.protocol === 'https:' ? 443 : 80)}`; } catch { return ''; }
}

/**
 * Why a URL's host is this machine's network, judged by its spelling alone - '' when it is not.
 * A name is not resolved here: the guard judged every connection by the address it resolved
 * to, and refused an internal one, so a page that reached a name inside was already refused.
 */
function internalByName(url) {
  let host;
  try { host = new URL(String(url)).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase(); } catch { return ''; }
  if (host === 'localhost' || host.endsWith('.localhost')) return `${host} is this machine`;
  return net.isIP(host) && isInternal(host) ? `${host} is an internal address` : '';
}

/**
 * What the ledger records as this fetch's command: `browser <url>`, quoted like the keyless
 * transport's. It had used that transport's formatter whole, so every browser capture read
 * `http-keyless browser <url>` - the wrong tool's name in a committed file (2026-09-30).
 */
export function command(argv) {
  return ['browser', ...argv.slice(-1)].map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(' ');
}

export function scrape(url, { render = renderGuarded, browserPath = null, env = process.env, config = null, exists, timeout = TIMEOUT_MS, uid,
  allowInternalRedirects } = {}) {
  const target = String(url);
  // No config from the caller means the machine's: the collector calls runScrape(url) with no
  // options, and an empty default here meant browserPath was never consulted (2026-10-11).
  const binary = browserPath ?? findBrowser({ config: config ?? loadConfig(env), env, exists });
  const cmd = command([target]);
  if (!binary) {
    return { ok: false, url: target, transport: name, cmd,
      error: 'no Chromium or Chrome found - set browserPath in the machine config or RESEARCH_KIT_BROWSER to the browser executable' };
  }
  const result = render(binary, browserArgs(target, { ...(uid === undefined ? {} : { uid }), timeout }), { url: target, env, timeout, allowInternalRedirects });
  // Why the browser stopped, in its own words: the last FATAL line, else the last ERROR line,
  // else the last line. Learned from live runs on 2026-09-29: a crash ends its stderr with a
  // stack dump ("[end of stack trace]"), and the crash handler then logs ERROR noise of its
  // own (a missing cpufreq file) - neither is the cause.
  const lines = String(result.stderr ?? '').trim().split('\n').filter(Boolean);
  const last = (pattern) => [...lines].reverse().find((line) => pattern.test(line));
  const cause = last(/FATAL/) ?? last(/ERROR:/) ?? lines.slice(-1)[0];
  const said = cause ? `: ${cause.trim().slice(0, 200)}` : '';
  // A timeout is judged by what Chromium printed first, not by its exit (found 2026-10-01 on
  // CI: the suite's first launch ran its 45 s out three times in one afternoon, on Windows
  // and on Ubuntu, with the refusal the guard had recorded and the dump thrown away). Chromium
  // prints the DOM once, when its own budget says the page is done, so a WHOLE dump after a
  // timeout is the render - Chromium then failed to exit, which does not unrender the page -
  // and a dump holding the guard's refusal is the refusal. No dump at all is the timeout, and
  // the last thing Chromium said on stderr is the only diagnostic there is, so it is kept.
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const refused = Array.isArray(result.refused) ? result.refused : [];
  const html = String(result.stdout ?? '');
  const dumpedWhole = /<\/html>\s*$/i.test(html);
  // The guard turned a request away, and the page that rendered is the refusal, or Chromium's
  // own error page for a tunnel it could not open: the page led the browser into this
  // machine's network, and nothing from there was read (ADR-0118). A refused image or frame on
  // a page that still rendered is not a failure of the capture.
  const landedOnRefusal = refused.length && (html.includes(REFUSAL_MARKER) || (chromeErrorOf(html) && !timedOut && !result.signal && result.status === 0));
  if (landedOnRefusal) {
    // The refusal the page landed on, not the last one recorded: the guard's refusal page
    // carries its host and reason, and a dump holding them names that refusal. A later refusal
    // - a dead third-party host the page also referenced - was named instead (found
    // 2026-10-02, break-test: on a no-network host the browser's own www.google.com, refused as
    // unresolvable after the navigation, was reported as what the page had reached for). Where
    // the dump is Chromium's own error page there is nothing to match, and the last stands.
    const last = refused.find((entry) => html.includes(`${REFUSAL_MARKER}: ${entry.host} - ${entry.why}`)) ?? refused[refused.length - 1];
    const waited = cutAtDeadline(result, timeout);
    return { ok: false, url: target, transport: name, cmd,
      error: `refused to let the page reach ${last.host} - ${last.why}. A page on the web may not send the browser into this machine's network; `
        + `if you meant that address, fetch it directly, or set RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS=1.${waited ? ` (${waited})` : ''}` };
  }
  if (result.truncated) {
    return { ok: false, url: target, transport: name, cmd, error: `the rendered page is larger than ${MAX_PAGE_BYTES / (1024 * 1024)} MiB - not kept (ADR-0082)` };
  }
  if (timedOut && !dumpedWhole) {
    // Where the time went: a browser that never asked for anything is a launch that did not
    // finish, which is not the page's doing (ADR-0119).
    // A child the parent gave up on left no record: say that, not "never made a request in 0 s".
    // The flag is the anchor, not the message's wording (GPT's review, 2026-10-04): a child's own
    // ETIMEDOUT carries a report, the parent's carries `gaveUp`.
    const gaveUp = result.gaveUp === true;
    const startup = gaveUp ? `: ${result.error.message}`
      : Number.isFinite(result.startupMs) && result.startupMs !== null
        ? `: the browser took ${Math.round(result.startupMs / 1000)} s to make its first request`
        : `: the browser never made a request in ${Math.round((Number(result.elapsedMs) || 0) / 1000)} s`;
    return { ok: false, url: target, transport: name, cmd, error: `the browser did not finish rendering ${target} within ${Math.round(timeout / 1000)}s${startup}${said}` };
  }
  // A signal that is not the timeout's is a crash, and says so (found 2026-09-29: a SIGTRAP
  // 21 seconds in was reported as the 60-second timeout). The timeout's own kill, after a
  // whole dump, is not one.
  if (result.signal && !timedOut) {
    // The sandbox denied, as on Ubuntu 23.10+: the remedies that KEEP it, in the order
    // Chromium ranks them (ADR-0092). Never --no-sandbox - Chromium says it must never be
    // used on the open web, which is all this transport renders.
    const denied = /No usable sandbox/.test(cause ?? '')
      ? ' - Chromium\'s sandbox was denied (Ubuntu 23.10+ restricts user namespaces by AppArmor profile).'
        + ' Use Chrome stable at /opt/google/chrome/chrome, which Ubuntu allows (set browserPath to it),'
        + ' or, for another build, set CHROME_DEVEL_SANDBOX=/opt/google/chrome/chrome-sandbox'
      : '';
    return { ok: false, url: target, transport: name, cmd, error: `the browser was killed by ${result.signal}${said}${denied}` };
  }
  // The guard child refused the URL asked for before launching anything: a caller that said
  // `false` and a target inside this machine's network (ADR-0155). The refusal, not a launch
  // failure, is what happened.
  if (result.error?.code === 'EINTERNAL') return { ok: false, url: target, transport: name, cmd, error: result.error.message };
  if (result.error && !timedOut) return { ok: false, url: target, transport: name, cmd, error: `the browser could not start: ${result.error.message}` };
  if (result.status !== 0 && !timedOut) {
    return { ok: false, url: target, transport: name, cmd, error: `the browser exited ${result.status}${said}` };
  }
  const chromeError = chromeErrorOf(html);
  if (chromeError) {
    return { ok: false, url: target, transport: name, cmd, error: `the browser showed its own error page (${chromeError}) instead of ${target}` };
  }
  // The origin's own answer, from Chromium's net log (ADR-0137, 2026-10-03): `--dump-dom`
  // reports none, and an origin's 403 page rendered whole was graded full.
  const observed = documentStatusFromNetLog(result.netLog, target);
  if (observed) {
    // A redirect that ended inside this machine's network is refused as the keyless transport
    // refuses one (ADR-0110), unless the operator's decision - or the guard child's, for an
    // internal URL asked for - allowed it. The guard refused such a connection already; this
    // is the same rule read from what the browser reports it reached.
    const optOut = allowInternalRedirects ?? (env.RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS === '1' ? true : undefined);
    const allowed = typeof result.allowInternal === 'boolean' ? result.allowInternal
      : optOut === true || (optOut !== false && Boolean(internalByName(target)));
    // The host and port asked for are exempt, as they are at the guard: the operator named them.
    const inward = allowed || hostPort(observed.finalUrl) === hostPort(target) ? '' : internalByName(observed.finalUrl);
    if (inward) {
      return { ok: false, url: target, transport: name, cmd,
        error: `refused to let the page reach ${new URL(observed.finalUrl).host} - ${inward}. A page on the web may not send the browser into this machine's network; `
          + 'if you meant that address, fetch it directly, or set RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS=1.' };
    }
    // A non-2xx answer is a failed fetch, worded as the keyless transport words one, so an
    // error page is never filed as evidence whichever transport rendered it.
    if (observed.statusCode < 200 || observed.statusCode >= 300) {
      const said = serverReason({ contentType: 'text/html', body: html });
      // A 429, or a 503 with Retry-After, hands the server's wait to the collector's loop, as
      // the keyless transport does (#313).
      const retry = retryAfter(observed.statusCode, observed.retryAfter);
      const asks = !retry ? ''
        : observed.statusCode === 429 ? ` - rate limited, ${retry.said ? `the server asks for a retry after ${retry.said}` : 'the server named no retry time'}`
          : ` - the server asks for a retry after ${retry.said}`;
      return { ok: false, url: target, transport: name, cmd, statusCode: observed.statusCode,
        error: `HTTP ${observed.statusCode}${asks}${said ? ` - the server said: "${said}"` : ''}`,
        ...(retry ? { retryAfterMs: retry.ms, ...(retry.capped ? { retryAfterCapped: true } : {}) } : {}) };
    }
    // The body did not arrive whole: a decoding failure renders as a blank document and a
    // cut-off body as whatever arrived, and neither is the page (#315). The keyless route
    // records the same answers as failures ("terminated").
    if (observed.netError) {
      return { ok: false, url: target, transport: name, cmd, statusCode: observed.statusCode,
        error: `the response for ${target} ended in ${observed.netError} - the body did not arrive whole, and what arrived is not kept` };
    }
    // What the response IS, by its Content-Type, judged as the keyless transport judges it
    // (ADR-0105): a binary body is refused by name - Chromium rendered a viewer or nothing,
    // never the file - and a text body is kept as its text, not run through the extractor.
    const kind = bodyKind(observed.contentType);
    if (kind === 'binary') {
      const type = observed.contentType.split(';')[0].trim();
      return { ok: false, url: target, transport: name, cmd, statusCode: observed.statusCode,
        error: `the response is ${type}, which is not text - the browser transport cannot keep a faithful copy of it. `
          + 'Fetch it with --transport firecrawl-cli, which converts documents such as PDFs to text, or cite an HTML page that carries the same text.' };
    }
    if (kind === 'text') {
      const { text, verbatim } = renderedText(html);
      const type = observed.contentType.split(';')[0].trim();
      // Nothing rendered is not an empty response: a type Chromium saves rather than shows
      // (text/csv) leaves an empty document, whatever the body held (review, 2026-10-18).
      if (!text.length) {
        return { ok: false, url: target, transport: name, cmd, statusCode: observed.statusCode,
          error: `the browser rendered no text for the ${type} response - it may have been saved as a download rather than shown; nothing is kept` };
      }
      const waited = cutAtDeadline(result, timeout);
      const omitted = [
        !verbatim && `the browser rendered the ${type} response as a document; its text was read from that document, not kept verbatim`,
        waited].filter(Boolean).join('; ');
      return {
        ok: true,
        url: canonicalUrl(observed.finalUrl) !== canonicalUrl(target) ? observed.finalUrl : target,
        title: '',
        markdown: text,
        source: html,          // the rendered DOM the text was read from (ADR-0140)
        statusCode: observed.statusCode,
        transport: name,
        cmd,
        completeness: omitted ? 'partial' : 'full',
        omitted,
      };
    }
  }
  const extraction = mainContent(html);
  const markdown = htmlToMarkdown(extraction.html);
  const graded = gradeCompleteness(markdown, extraction);
  // A page Chromium gave up on at its deadline is what it was when the wait ended, not what
  // it would have been: partial, and the grade says what was still outstanding.
  const waited = cutAtDeadline(result, timeout);
  // No status in the log - an older Chromium, a log not written or cut short, a document
  // request not in it: the page may be an error page, and nothing says it is not. Partial,
  // and said; a status is never guessed from the page's text (ADR-0137).
  const unobserved = observed ? '' : "the origin's HTTP status was not observed: the browser's net log named no response for the page";
  if (waited || unobserved) { graded.completeness = 'partial'; graded.omitted = [graded.omitted, waited, unobserved].filter(Boolean).join('; '); }
  return {
    ok: true,
    // Filed under the page it ended on, as the keyless transport files a redirect; the URL as
    // asked when Chromium only canonicalised it.
    url: observed && canonicalUrl(observed.finalUrl) !== canonicalUrl(target) ? observed.finalUrl : target,
    title: titleOf(html),
    markdown,
    source: html,          // the rendered DOM this Markdown was converted from (ADR-0140)
    statusCode: observed ? observed.statusCode : '',
    transport: name,
    cmd,
    ...graded,
  };
}

export function runScrape(url, opts = {}) {
  return scrape(url, opts);
}

/** Link discovery records nothing, so the keyless route's own map serves. */
export function map(url, opts = {}) {
  return httpKeyless.map(url, opts);
}

export function status({ config = null, env = process.env, exists } = {}) {
  const path = findBrowser({ config: config ?? loadConfig(env), env, exists });
  return { ok: Boolean(path), transport: name, path, error: path ? '' : 'no Chromium or Chrome found' };
}

export default { name, CONTRACTS, scrape, runScrape, map, status, command };
