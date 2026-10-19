// ADR-0088: a fetch-only transport that renders pages with a local Chromium from the command
// line. Research: docs/decisions/2026-09-28-browser-transport. Offline: the renderer is a stub.

import { spawn } from 'node:child_process';
import { test, describe, assert, fs, path, KIT_ROOT, requireCapability, tempDir } from './harness.mjs';
import browser, { browserArgs, chromeErrorOf, findBrowser, renderGuarded, TIMEOUT_MS, documentStatusFromNetLog } from '../lib/browser-transport.mjs';
import { REFUSAL_MARKER } from '../lib/browser-guard.mjs';
import { TRANSPORTS, satisfies, FETCH_SHAPE, selectTransport } from '../lib/transport.mjs';

describe('browser-transport');

const PAGE = `<html><head><title>File system | Node.js</title></head><body><main><h1>File system</h1>
${'<p>The fs.rename() method renames a file asynchronously and calls back when it is done.</p>'.repeat(40)}</main></body></html>`;
// What --dump-dom printed on 2026-09-28 behind a proxy whose CA Chromium did not trust: its own
// interstitial, exit 0 (the brief's contradiction section).
const PRIVACY = '<html><head><title>Privacy error</title></head><body><div id="main-frame-error">Your connection is not private '
  + '<span class="error-code">NET::ERR_CERT_AUTHORITY_INVALID</span></div></body></html>';

// Chromium is stubbed: `render` plays the guard child, answering as it would (ADR-0118).
const renderWith = (result) => {
  const calls = [];
  const render = (file, args, opts) => { calls.push({ file, args, opts }); return { status: 0, stdout: '', stderr: '', refused: [], ...result }; };
  return { render, calls };
};

/**
 * A minimal Chromium net log (ADR-0137): `constants` maps the event and source names to
 * numbers, and `events` carries them as numbers - deliberately NOT Chromium's own numbers, so
 * a reader that hard-coded them would fail here. `hops` is the document request's jobs, each
 * `[url, status]`; every hop but the last is a redirect to the next. The shape is the one
 * Chromium 141 wrote on 2026-10-03 for a loopback page: URL_REQUEST_START_JOB (begin, with
 * `url` and `request_type: "main frame"`), HTTP_TRANSACTION_READ_RESPONSE_HEADERS (with the
 * status line in `headers[0]`), URL_REQUEST_REDIRECTED, then the next job on the same source.
 */
const NETLOG_CONSTANTS = {
  logEventPhase: { PHASE_NONE: 0, PHASE_BEGIN: 1, PHASE_END: 2 },
  logEventTypes: { REQUEST_ALIVE: 901, URL_REQUEST_START_JOB: 902, HTTP_TRANSACTION_READ_RESPONSE_HEADERS: 903, URL_REQUEST_REDIRECTED: 904 },
  logSourceType: { NONE: 0, SOCKET: 31, URL_REQUEST: 32 },
};
function netLog(hops, { id = 76, before = [], constants = NETLOG_CONSTANTS } = {}) {
  const T = NETLOG_CONSTANTS.logEventTypes;
  const at = (type, phase, params, source = { id, type: 32 }) => ({ time: '1', type, source, phase, ...(params ? { params } : {}) });
  const events = [...before];
  // A hop's third member, when given, is its response headers after the status line and the
  // net_error its request ended in (#315); the default is an HTML page that ended cleanly.
  hops.forEach(([url, status, { headers = ['content-type: text/html'], netError = null } = {}], i) => {
    events.push(at(T.URL_REQUEST_START_JOB, 1, { method: 'GET', request_type: 'main frame', url }));
    // The same event type on a socket source, with another status: only URL_REQUEST sources count.
    events.push(at(T.HTTP_TRANSACTION_READ_RESPONSE_HEADERS, 0, { headers: ['HTTP/1.1 418 I am a socket'] }, { id: 999, type: 31 }));
    events.push(at(T.HTTP_TRANSACTION_READ_RESPONSE_HEADERS, 0, { headers: [`HTTP/1.1 ${status} Whatever`, ...headers] }));
    if (i < hops.length - 1) events.push(at(T.URL_REQUEST_REDIRECTED, 0, { location: hops[i + 1][0] }));
    events.push(at(T.URL_REQUEST_START_JOB, 2));
    if (netError !== null) events.push(at(T.REQUEST_ALIVE, 2, { net_error: netError }));
  });
  return JSON.stringify({ constants, events });
}
/** The status and final URL alone, as ADR-0137's tests read them. */
const statusOf = (log, asked) => {
  const r = documentStatusFromNetLog(log, asked);
  return r && { statusCode: r.statusCode, finalUrl: r.finalUrl };
};
/** Another request's job on its own source - a favicon, the browser's own traffic. */
const otherRequest = (id, url, status) => [
  { time: '0', type: 902, source: { id, type: 32 }, phase: 1, params: { method: 'GET', request_type: 'other', url } },
  { time: '0', type: 903, source: { id, type: 32 }, phase: 0, params: { headers: [`HTTP/1.1 ${status} Other`] } },
];
// An origin's own error page, rendered: Chromium dumps it like any page (ADR-0137).
const FORBIDDEN = `<html><head><title>403 Forbidden</title></head><body><main><h1>403 Forbidden</h1>
${'<p>You do not have permission to access this resource on this server, and this paragraph is long enough to grade.</p>'.repeat(20)}</main></body></html>`;

// ADR-0137 (output-reliability audit G5, 2026-10-03): `--dump-dom` reports no HTTP status, so
// every browser capture carried `statusCode: ''`, and the collector's ">= 400 is a failed
// fetch" rule - which reads a number - never fired. An origin's 403 page was rendered like
// any page and graded full. Chromium reports the status itself, in its net log; the transport
// reads it from there, and where the log gives none, it says so instead of guessing.
test('the net log names the document request\'s status and its final URL, through redirects', () => {
  const asked = 'https://x.example/page';
  assert.deepEqual(statusOf(netLog([[asked, 403]]), asked), { statusCode: 403, finalUrl: asked });
  // Parsed JSON is accepted as well as text.
  assert.deepEqual(statusOf(JSON.parse(netLog([[asked, 200]])), asked), { statusCode: 200, finalUrl: asked });
  // A redirect is a new job on the same source; the last job's URL is final, and its status is the page's.
  const hopped = netLog([[asked, 302], ['https://x.example/moved', 301], ['https://y.example/final', 200]]);
  assert.deepEqual(statusOf(hopped, asked), { statusCode: 200, finalUrl: 'https://y.example/final' });
  assert.deepEqual(statusOf(netLog([[asked, 302], ['https://x.example/denied', 403]]), asked), { statusCode: 403, finalUrl: 'https://x.example/denied' });
  // Other requests - the browser's own, a favicon - are not the document, before it or after it.
  const crowded = netLog([[asked, 404]], { before: [...otherRequest(8, 'https://clients2.google.com/time/1/current', 200), ...otherRequest(83, 'https://x.example/favicon.ico', 200)] });
  assert.deepEqual(statusOf(crowded, asked), { statusCode: 404, finalUrl: asked });
  // Chromium canonicalises the URL it logs: a bare host gains its slash, a fragment is never sent.
  assert.deepEqual(statusOf(netLog([['https://x.example/', 403]]), 'https://X.example'), { statusCode: 403, finalUrl: 'https://x.example/' });
  assert.deepEqual(statusOf(netLog([[asked, 410]]), `${asked}#section`), { statusCode: 410, finalUrl: asked });
});

test('a net log with no document request, no response, or cut short gives no status at all', () => {
  const asked = 'https://x.example/page';
  assert.equal(documentStatusFromNetLog(netLog([['https://x.example/other', 403]]), asked), null, 'a request for another URL is not the document');
  assert.equal(documentStatusFromNetLog(JSON.stringify({ constants: NETLOG_CONSTANTS, events: otherRequest(8, 'https://clients2.google.com/time', 200) }), asked), null);
  // A job that never read a response - a tunnel refused, a load cancelled at the deadline.
  const unanswered = JSON.parse(netLog([[asked, 200]]));
  unanswered.events = unanswered.events.filter((e) => e.type !== 903);
  assert.equal(documentStatusFromNetLog(unanswered, asked), null);
  // A redirect whose next job never answered: the redirect's own 302 is not the page's status.
  const lost = JSON.parse(netLog([[asked, 302], ['https://x.example/next', 200]]));
  lost.events = lost.events.filter((e) => !(e.type === 903 && /200/.test(e.params.headers[0])));
  assert.equal(documentStatusFromNetLog(lost, asked), null);
  // Chromium killed at the timeout leaves its log without the closing `]}`.
  const whole = netLog([[asked, 403]]);
  assert.equal(documentStatusFromNetLog(whole.slice(0, -2), asked), null);
  assert.equal(documentStatusFromNetLog(whole.slice(0, whole.length / 2), asked), null);
  for (const nothing of [undefined, null, '', 'not json', '{}', '{"constants":{},"events":[]}', 42]) {
    assert.equal(documentStatusFromNetLog(nothing, asked), null, `${JSON.stringify(nothing)} gave a status`);
  }
  // A log whose constants do not name the events read is no status, not a guess by number.
  const renamed = JSON.parse(whole);
  delete renamed.constants.logEventTypes.HTTP_TRANSACTION_READ_RESPONSE_HEADERS;
  assert.equal(documentStatusFromNetLog(renamed, asked), null);
});

test('a page the origin answered 403 is not a capture, though Chromium rendered it whole', () => {
  const asked = 'https://x.example/page';
  const { render } = renderWith({ stdout: FORBIDDEN, netLog: netLog([[asked, 403]]) });
  const r = browser.scrape(asked, { render, browserPath: '/bin/true', env: {}, uid: 0 });
  // As the keyless transport answers a 4xx: not ok, and the status and the server's own words named.
  assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300));
  assert.equal(r.statusCode, 403);
  assert.match(r.error, /HTTP 403/);
  assert.match(r.error, /403 Forbidden/, 'the page\'s title, as the keyless transport quotes it');
  assert.equal(r.markdown, undefined, 'an error page is not kept');
  // A redirect that ends on a 404 is the 404's.
  const hopped = browser.scrape(asked, { render: renderWith({ stdout: FORBIDDEN, netLog: netLog([[asked, 302], ['https://x.example/gone', 404]]) }).render, browserPath: '/bin/true', env: {}, uid: 0 });
  assert.equal(hopped.ok, false);
  assert.match(hopped.error, /HTTP 404/);
});

test('a page the origin answered 200 carries the status as a number, and the URL it ended on', () => {
  const asked = 'https://x.example/page';
  const plain = browser.scrape(asked, { render: renderWith({ stdout: PAGE, netLog: netLog([[asked, 200]]) }).render, browserPath: '/bin/true', env: {}, uid: 0 });
  assert.equal(plain.ok, true, plain.error);
  assert.equal(plain.statusCode, 200);
  assert.equal(plain.url, asked);
  assert.equal(plain.completeness, 'full', plain.omitted);
  const moved = browser.scrape(asked, { render: renderWith({ stdout: PAGE, netLog: netLog([[asked, 301], ['https://x.example/new-home', 200]]) }).render, browserPath: '/bin/true', env: {}, uid: 0 });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(moved.url, 'https://x.example/new-home', 'the capture is filed under the page it is, as the keyless transport files it');
  // Canonicalisation alone is not a redirect: the URL asked for is kept as it was spelled.
  const bare = browser.scrape('https://x.example', { render: renderWith({ stdout: PAGE, netLog: netLog([['https://x.example/', 200]]) }).render, browserPath: '/bin/true', env: {}, uid: 0 });
  assert.equal(bare.url, 'https://x.example');
});

// #315 (2026-10-11): the same plan on both routes. A PDF, an octet-stream, a body Chromium
// could not decode and a cut-off body were refused or failed on the keyless route, and kept
// here as empty or truncated partial captures - EVIDENCE rows a Finding would be written
// against. The net log carries the response's Content-Type beside its status, and the read's
// net_error at its end; both are read, and the keyless transport's rule (ADR-0105) applied.
const RENDERED_TEXT = (text) => `<html><head><meta name="color-scheme" content="light dark"></head><body><pre style="word-wrap: break-word; white-space: pre-wrap;">${text}</pre></body></html>`;
const scrapeWith = (asked, stdout, log) => browser.scrape(asked, { render: renderWith({ stdout, netLog: log }).render, browserPath: '/bin/true', env: {}, uid: 0 });

test('the net log names the document response\'s Content-Type, and the net error its read ended in', () => {
  const asked = 'https://x.example/report';
  const pdf = documentStatusFromNetLog(netLog([[asked, 200, { headers: ['Content-Type: application/pdf', 'content-length: 9'] }]]), asked);
  assert.equal(pdf.contentType, 'application/pdf');
  assert.equal(pdf.netError, '');
  // Named through the log's own constants, and by number when the log names none.
  const named = { ...NETLOG_CONSTANTS, netError: { ERR_ABORTED: -3, ERR_CONTENT_DECODING_FAILED: -330 } };
  assert.equal(documentStatusFromNetLog(netLog([[asked, 200, { netError: -330 }]], { constants: named }), asked).netError, 'ERR_CONTENT_DECODING_FAILED');
  assert.equal(documentStatusFromNetLog(netLog([[asked, 200, { netError: -354 }]]), asked).netError, 'net error -354');
  // A load the browser itself stopped is the deadline's to grade, not a body that did not arrive.
  assert.equal(documentStatusFromNetLog(netLog([[asked, 200, { netError: -3 }]], { constants: named }), asked).netError, '');
  // A redirect's job is not the page's: only the last job's headers and error count.
  const hopped = documentStatusFromNetLog(netLog([[asked, 302, { headers: ['content-type: application/pdf'] }], ['https://x.example/final', 200]]), asked);
  assert.deepEqual([hopped.contentType, hopped.netError], ['text/html', '']);
});

test('a PDF or an octet-stream the browser rendered is refused by name, as the keyless route refuses it', () => {
  const asked = 'https://x.example/report.pdf';
  for (const type of ['application/pdf', 'application/octet-stream']) {
    // What Chromium dumps for these is a viewer's shell or an empty document, never the file.
    const r = scrapeWith(asked, '<html><head></head><body><embed type="application/pdf"></body></html>', netLog([[asked, 200, { headers: [`content-type: ${type}`] }]]));
    assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300));
    assert.match(r.error, new RegExp(`^the response is ${type.replace('/', '\\/')}, which is not text - the browser transport cannot keep a faithful copy of it\\. Fetch it with --transport firecrawl-cli`), r.error);
    assert.equal(r.markdown, undefined, 'nothing is kept');
  }
});

test('a JSON or text response is kept as its text, not run through the page extractor', () => {
  const asked = 'https://api.example/v1/limits';
  const json = scrapeWith(asked, RENDERED_TEXT('{&quot;limit&quot;: 10, &quot;per&quot;: &quot;minute&quot;}'), netLog([[asked, 200, { headers: ['content-type: application/json; charset=utf-8'] }]]));
  assert.equal(json.ok, true, json.error);
  assert.equal(json.markdown, '{"limit": 10, "per": "minute"}');
  assert.equal(json.completeness, 'full', json.omitted);
  assert.equal(json.statusCode, 200);
  // Chrome 154's JSON viewer, as it dumped a local JSON answer on 2026-10-17: the <pre>, then an
  // empty formatter <div>.
  const viewer = '<html><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"></head><body><pre>{"limit": 10, "per": "minute &amp; &lt;more&gt;"}</pre><div class="json-formatter-container"></div></body></html>';
  const chrome = scrapeWith(asked, viewer, netLog([[asked, 200, { headers: ['content-type: application/json'] }]]));
  assert.equal(chrome.markdown, '{"limit": 10, "per": "minute & <more>"}');
  assert.equal(chrome.completeness, 'full', chrome.omitted);
  // Nothing rendered is not a capture: a type Chromium saves as a download leaves an empty document.
  for (const type of ['text/plain', 'text/csv']) {
    const empty = scrapeWith(asked, '<html><head></head><body></body></html>', netLog([[asked, 200, { headers: [`content-type: ${type}`] }]]));
    assert.equal(empty.ok, false, `${type}: ${JSON.stringify(empty).slice(0, 200)}`);
    assert.match(empty.error, /rendered no text for the text\/(plain|csv) response/);
    assert.equal(empty.markdown, undefined);
  }
  assert.equal(scrapeWith(asked, RENDERED_TEXT(''), netLog([[asked, 200, { headers: ['content-type: text/plain'] }]])).ok, false);
  // Only the text viewer's own shape is the response's text: a document with several <pre> is
  // read as a document, not as its first <pre>.
  const several = scrapeWith(asked, '<html><body><p>a</p><pre>x</pre><pre>y</pre></body></html>', netLog([[asked, 200, { headers: ['content-type: application/xml'] }]]));
  assert.equal(several.ok, true);
  assert.equal(several.completeness, 'partial');
  assert.match(several.omitted, /not kept verbatim/);
  assert.match(several.markdown, /a.*x.*y/s);
  // XML gets a tree viewer, not a <pre>: its text is read from the document, and says so.
  const xml = scrapeWith(asked, '<html><body><div class="header">This XML file does not appear to have any style information.</div><div>&lt;a&gt;1&lt;/a&gt;</div></body></html>', netLog([[asked, 200, { headers: ['content-type: application/xml'] }]]));
  assert.equal(xml.ok, true);
  assert.equal(xml.completeness, 'partial');
  assert.match(xml.omitted, /not kept verbatim/);
});

test('a body the browser could not decode, or one cut off, is a failure naming the error - not a capture of what arrived', () => {
  const asked = 'https://x.example/page';
  const named = { ...NETLOG_CONSTANTS, netError: { ERR_ABORTED: -3, ERR_CONTENT_DECODING_FAILED: -330, ERR_CONTENT_LENGTH_MISMATCH: -354 } };
  const blank = scrapeWith(asked, '<html><head></head><body></body></html>', netLog([[asked, 200, { netError: -330 }]], { constants: named }));
  assert.equal(blank.ok, false, JSON.stringify(blank).slice(0, 300));
  assert.match(blank.error, /ended in ERR_CONTENT_DECODING_FAILED - the body did not arrive whole/, blank.error);
  const cut = scrapeWith(asked, PAGE.slice(0, 600), netLog([[asked, 200, { netError: -354 }]], { constants: named }));
  assert.equal(cut.ok, false);
  assert.match(cut.error, /ERR_CONTENT_LENGTH_MISMATCH/);
  // A page that ended cleanly is the page.
  assert.equal(scrapeWith(asked, PAGE, netLog([[asked, 200, { netError: -3 }]], { constants: named })).ok, true);
});

// #313: the browser route's 429 hands the server's Retry-After over as the keyless route's does.
test('a 429 the browser rendered carries the server\'s Retry-After as retryAfterMs', () => {
  const asked = 'https://x.example/page';
  const limited = scrapeWith(asked, FORBIDDEN, netLog([[asked, 429, { headers: ['content-type: text/html', 'Retry-After: 3'] }]]));
  assert.equal(limited.ok, false);
  assert.equal(limited.retryAfterMs, 3000);
  assert.match(limited.error, /^HTTP 429 - rate limited, the server asks for a retry after 3s/, limited.error);
  const plain = scrapeWith(asked, FORBIDDEN, netLog([[asked, 503]]));
  assert.equal(plain.retryAfterMs, undefined);
});

test('with no net log the status is not guessed: the capture is partial and says the status was not observed', () => {
  const asked = 'https://x.example/page';
  // The reproduction (ADR-0137): before the change, this answered ok, statusCode '', full.
  const r = browser.scrape(asked, { render: () => ({ status: 0, stdout: FORBIDDEN, stderr: '', signal: null, error: null }), exists: () => true, browserPath: '/bin/true', uid: 0 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.statusCode, '');
  assert.equal(r.completeness, 'partial');
  assert.match(r.omitted, /HTTP status was not observed/);
  // A log that could not be parsed, or that holds no document request, is the same.
  for (const log of ['{"constants":{"logEventTypes":{', netLog([['https://x.example/elsewhere', 200]])]) {
    const s = browser.scrape(asked, { render: renderWith({ stdout: PAGE, netLog: log }).render, browserPath: '/bin/true', env: {}, uid: 0 });
    assert.equal(s.ok, true, s.error);
    assert.equal(s.statusCode, '');
    assert.equal(s.completeness, 'partial');
    assert.match(s.omitted, /HTTP status was not observed/);
  }
  // The note joins a deadline's note rather than replacing it.
  const late = browser.scrape(asked, { render: renderWith({ stdout: PAGE, requests: 3, pending: [{ kind: 'http', target: 'https://cdn.x.example/slow.js', ms: 34_000 }], elapsedMs: 35_100 }).render, browserPath: '/bin/true', env: {}, uid: 0, timeout: 45_000 });
  assert.match(late.omitted, /HTTP status was not observed/);
  assert.match(late.omitted, /still unanswered through the guard/);
});

test('a URL the guard child refused before launching is reported as that refusal, not as a browser that could not start', () => {
  // ADR-0155: under `false` the child judges a NAME asked for before any launch and answers
  // EINTERNAL; the transport passes the refusal through in the child's words.
  const named = 'http://intranet.example/start';
  const early = browser.scrape(named, { render: renderWith({ status: null, error: Object.assign(new Error('refused to render intranet.example - intranet.example resolves to 10.0.0.5, an internal address. This render was asked to stay out of this machine\'s network'), { code: 'EINTERNAL' }), refused: [{ host: 'intranet.example', why: 'intranet.example resolves to 10.0.0.5, an internal address' }] }).render, browserPath: '/bin/true', env: {}, uid: 0, allowInternalRedirects: false });
  assert.equal(early.ok, false);
  assert.match(early.error, /^refused to render intranet\.example - intranet\.example resolves to 10\.0\.0\.5, an internal address/);
  assert.doesNotMatch(early.error, /could not start/);
  assert.equal(early.markdown, undefined);
});

test('a net log whose final URL is internal is refused, as an internal redirect is', () => {
  const asked = 'https://evil.example/a';
  const log = netLog([[asked, 302], ['http://169.254.169.254/latest/meta-data/', 200]]);
  const r = browser.scrape(asked, { render: renderWith({ stdout: PAGE, netLog: log }).render, browserPath: '/bin/true', env: {}, uid: 0 });
  assert.equal(r.ok, false, 'a page the browser was redirected into this machine\'s network for was captured');
  assert.match(r.error, /refused to let the page reach 169\.254\.169\.254 - 169\.254\.169\.254 is an internal address/);
  assert.match(r.error, /RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS/);
  assert.equal(r.markdown, undefined);
  const local = browser.scrape(asked, { render: renderWith({ stdout: PAGE, netLog: netLog([[asked, 302], ['http://localhost:8080/admin', 200]]) }).render, browserPath: '/bin/true', env: {}, uid: 0 });
  assert.equal(local.ok, false);
  assert.match(local.error, /localhost:8080 - localhost is this machine/);
  // The operator's decision lifts it, by the option or the variable, and so does the guard
  // child's own (an internal URL asked for is the operator's, redirects and all - ADR-0110).
  assert.equal(browser.scrape(asked, { render: renderWith({ stdout: PAGE, netLog: log }).render, browserPath: '/bin/true', env: {}, uid: 0, allowInternalRedirects: true }).ok, true);
  assert.equal(browser.scrape(asked, { render: renderWith({ stdout: PAGE, netLog: log }).render, browserPath: '/bin/true', env: { RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS: '1' }, uid: 0 }).ok, true);
  assert.equal(browser.scrape(asked, { render: renderWith({ stdout: PAGE, netLog: log, allowInternal: true }).render, browserPath: '/bin/true', env: {}, uid: 0 }).ok, true);
  // The host and port asked for are exempt even when the operator said the page is public, as
  // they are at the guard; another port on the same host is not.
  const named = 'http://127.0.0.1:8080/start';
  assert.equal(browser.scrape(named, { render: renderWith({ stdout: PAGE, netLog: netLog([[named, 302], ['http://127.0.0.1:8080/end', 200]]) }).render, browserPath: '/bin/true', env: {}, uid: 0, allowInternalRedirects: false }).ok, true);
  const sideways = browser.scrape(named, { render: renderWith({ stdout: PAGE, netLog: netLog([[named, 302], ['http://127.0.0.1:9090/admin', 200]]) }).render, browserPath: '/bin/true', env: {}, uid: 0, allowInternalRedirects: false });
  assert.equal(sideways.ok, false);
  assert.match(sideways.error, /127\.0\.0\.1:9090 - 127\.0\.0\.1 is an internal address/);
  const inside = 'http://10.0.0.5/start';
  assert.equal(browser.scrape(inside, { render: renderWith({ stdout: PAGE, netLog: netLog([[inside, 302], ['http://10.0.0.6/end', 200]]) }).render, browserPath: '/bin/true', env: {}, uid: 0 }).ok, true,
    'an internal URL asked for may redirect inside');
});

test('a rendered page becomes a graded capture through the keyless extractor', () => {
  // ADR-0137: a render with the origin's 200 in its net log; without one it is graded partial.
  const { render, calls } = renderWith({ stdout: PAGE, netLog: netLog([['https://nodejs.org/api/fs.html', 200]]) });
  const r = browser.scrape('https://nodejs.org/api/fs.html', { render, browserPath: '/opt/chrome', env: {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.transport, 'browser');
  assert.equal(r.title, 'File system | Node.js');
  assert.match(r.markdown, /fs\.rename\(\) method renames a file/);
  assert.equal(r.completeness, 'full');
  assert.equal(calls[0].file, '/opt/chrome');
  assert.ok(calls[0].args.includes('--dump-dom') && calls[0].args.includes('--headless'));
  assert.equal(calls[0].args.at(-1), 'https://nodejs.org/api/fs.html', 'the URL is an argv element, last, never a shell word');
});

// Found 2026-09-30: every browser capture recorded `command: http-keyless browser <url>` - the
// keyless transport's name on a page no keyless request fetched. The command is an annotation,
// but it is written into a committed ledger, so it names the tool that ran.
test('the recorded command names the browser, not the keyless transport', () => {
  const { render } = renderWith({ stdout: PAGE });
  const r = browser.scrape('https://nodejs.org/api/fs.html', { render, browserPath: '/opt/chrome', env: {} });
  assert.equal(r.cmd, 'browser https://nodejs.org/api/fs.html');
  assert.equal(browser.command(['https://x.invalid/a b']), 'browser "https://x.invalid/a b"', 'a URL with a space is quoted');
  const none = browser.scrape('https://x.invalid/a', { render, browserPath: null, env: {}, exists: () => false, config: {} });
  assert.doesNotMatch(none.cmd, /http-keyless/, 'the refusal carries the same command');
});

// Found 2026-10-11: the collector calls runScrape(url) with no options, so the adapter looked
// for the browser with an empty config, and browserPath - the setting its own error message
// names - was never consulted. A caller that passes no config gets the machine's.
test('a scrape with no config of its own runs the browserPath the machine config names', () => {
  const dir = tempDir('rk-browser-config-');
  const binary = path.join(dir, 'chrome');
  fs.writeFileSync(binary, '', 'utf8');
  const configFile = path.join(dir, 'research-kit.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ browserPath: binary }), 'utf8');
  const env = { RESEARCH_KIT_CONFIG: configFile };
  const { render, calls } = renderWith({ stdout: PAGE });
  const r = browser.runScrape('https://nodejs.org/api/fs.html', { render, env });
  assert.equal(r.ok, true, r.error);
  assert.equal(calls[0]?.file, binary, 'the configured browser ran');
  assert.equal(browser.status({ env }).path, binary, 'status reports the same browser');
  assert.equal(browser.status({ env, config: {} }).path === binary, false, 'an explicit config still wins');
});

test('Chromium\'s own error page is a failure that names its code, though it exits 0', () => {
  assert.equal(chromeErrorOf(PRIVACY), 'ERR_CERT_AUTHORITY_INVALID');
  assert.equal(chromeErrorOf(PAGE), '');
  const { render } = renderWith({ stdout: PRIVACY });
  const r = browser.scrape('https://x.invalid/a', { render, browserPath: '/opt/chrome', env: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /ERR_CERT_AUTHORITY_INVALID/);
});

test('a timeout, a non-zero exit and a missing browser are failures that say which', () => {
  const late = browser.scrape('https://x.invalid/a', { render: () => ({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }), stdout: '' }), browserPath: '/opt/chrome', env: {} });
  assert.match(late.error, /did not finish/);
  const crashed = browser.scrape('https://x.invalid/a', { render: () => ({ status: 1, stdout: '', stderr: 'boom' }), browserPath: '/opt/chrome', env: {} });
  assert.match(crashed.error, /exited 1.*boom/);
  const none = browser.scrape('https://x.invalid/a', { browserPath: '', env: {}, exists: () => false });
  assert.equal(none.ok, false);
  assert.match(none.error, /no Chromium or Chrome found.*RESEARCH_KIT_BROWSER/);
});

// Found 2026-10-01 on CI, three times in one afternoon (two Windows legs on PR #189, one
// Ubuntu Node 26 leg on main): the first Chromium launch of the suite ran its 45 s render
// timeout out on a page whose script led it to an internal address. The guard had refused
// the navigation, and what Chromium printed before it stopped exiting was thrown away with
// its stderr: the timeout branch returned before the dump or the cause was read, so the
// verdict was "did not finish" with nothing to go on. Chromium prints the DOM once, when
// its own budget says the page is done; a whole dump after a timeout is therefore the
// render, and a hang at exit does not unrender it. No dump at all is still a timeout, and
// then the last thing Chromium said is the only diagnostic there is.
test('a browser that printed the page and then hung is a render, not a timeout', () => {
  const page = `<html><head><title>Late</title></head><body><main><p>${'Rendered words that are enough to be graded as content. '.repeat(20)}</p></main></body></html>`;
  const timedOut = (extra) => ({ status: null, signal: 'SIGKILL', error: Object.assign(new Error('the browser did not finish within 45000ms'), { code: 'ETIMEDOUT' }), stderr: '', refused: [], ...extra });
  const r = browser.scrape('https://x.invalid/a', { render: () => timedOut({ stdout: page }), browserPath: '/opt/chrome', env: {} });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.title, 'Late');
  // A dump cut short is not a render: Chromium prints the document whole, so a missing end is a partial read.
  const cut = browser.scrape('https://x.invalid/a', { render: () => timedOut({ stdout: page.slice(0, 120) }), browserPath: '/opt/chrome', env: {} });
  assert.equal(cut.ok, false);
  assert.match(cut.error, /did not finish rendering/);
});

test('a refusal the guard recorded is the verdict even when the browser then hung', () => {
  const refusal = `<html><head></head><body><pre>${REFUSAL_MARKER}: 127.0.0.1:9 - 127.0.0.1 is an internal address</pre></body></html>`;
  const r = browser.scrape('https://x.invalid/a', { render: () => ({ status: null, signal: 'SIGKILL', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), stdout: refusal, stderr: '', refused: [{ host: '127.0.0.1:9', why: '127.0.0.1 is an internal address' }] }), browserPath: '/opt/chrome', env: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /refused to let the page reach 127\.0\.0\.1:9 - 127\.0\.0\.1 is an internal address/);
  assert.doesNotMatch(r.error, /did not finish/);
});

test('the refusal named is the one the page landed on, not the last one the guard recorded', () => {
  // The page navigated into this machine's network, and ALSO referenced a host that could not
  // be resolved - a dead CDN, or (2026-10-02, on a no-network host) the browser's own
  // www.google.com, refused after the navigation. The dump holds the navigation's refusal.
  const refusal = `<html><head></head><body><pre>${REFUSAL_MARKER}: 127.0.0.1:9 - 127.0.0.1 is an internal address</pre></body></html>`;
  const refused = [
    { host: '127.0.0.1:9', why: '127.0.0.1 is an internal address' },
    { host: 'cdn.dead.invalid:443', why: 'cdn.dead.invalid could not be resolved (ENOTFOUND)' },
  ];
  const r = browser.scrape('https://x.invalid/a', { render: () => ({ status: 0, signal: null, stdout: refusal, stderr: '', refused }), browserPath: '/opt/chrome', env: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /refused to let the page reach 127\.0\.0\.1:9 - 127\.0\.0\.1 is an internal address/, r.error);
  assert.doesNotMatch(r.error, /cdn\.dead\.invalid/, 'a refusal the page did not land on was named');
});

test('a timeout with no dump names the last thing the browser said', () => {
  const stderr = 'DevTools listening on ws://127.0.0.1:1/x\n[1:1:ERROR:network_service.cc(1)] the proxy never answered\n[1:1:INFO:x] later noise';
  const r = browser.scrape('https://x.invalid/a', { render: () => ({ status: null, signal: 'SIGKILL', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), stdout: '', stderr, refused: [] }), browserPath: '/opt/chrome', env: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /did not finish rendering https:\/\/x\.invalid\/a within 60s: the browser never made a request in 0 s: \[1:1:ERROR:network_service\.cc\(1\)\] the proxy never answered/);
});

test('Chromium is never pointed at the configured proxy itself: the guard is its proxy, and the sandbox is off only for root', () => {
  // The guard child adds --proxy-server for its own port (ADR-0118); a configured proxy is the
  // guard's upstream. Pointing Chromium at it directly would carry every request around the guard.
  const asUser = browserArgs('https://x.invalid/a', { uid: 1000 });
  assert.ok(!asUser.includes('--no-sandbox'));
  assert.ok(!asUser.some((a) => a.startsWith('--proxy-server')), 'the args name a proxy before the guard exists');
  assert.ok(browserArgs('https://x.invalid/a', { uid: 0 }).includes('--no-sandbox'));
  assert.ok(!browserArgs('https://x.invalid/a', { uid: 0 }).includes('--ignore-certificate-errors'), 'TLS is never weakened');
  assert.ok(asUser.includes('--disable-background-networking'), 'Chromium\'s own update and time traffic would go through the guard too');
  assert.deepEqual(asUser.slice(-2), ['--dump-dom', 'https://x.invalid/a'], 'the guard child inserts its flags before these two');
});

// Found 2026-10-01 on CI, four times in one afternoon (Windows three times, Ubuntu once): the
// suite's first Chromium launch printed nothing - no DOM, no stderr - for its whole 45 s and
// was killed. Reproduced here with a page whose one resource never answers: with
// --virtual-time-budget alone, headless Chromium waits on the pending load for ever, since
// virtual time only advances when the page is idle, so it never dumps and only the kill ends
// it, with nothing to show. Chrome's own `--timeout` is the deadline for that wait: when it
// fires, Chromium stops loading, dumps the DOM it has and exits. The deadline sits under the
// transport's kill timeout, so a page that never settles is captured as it stands rather
// than lost, and a kill is for a browser that is not answering at all.
test('the browser is given its own deadline under the transport timeout, so a page that never settles is still dumped', () => {
  const args = browserArgs('https://x.invalid/a', { uid: 1000, timeout: 45_000 });
  assert.ok(args.includes('--timeout=35000'), `no deadline in ${args.join(' ')}`);
  assert.deepEqual(args.slice(-2), ['--dump-dom', 'https://x.invalid/a'], 'the guard child inserts its flags before these two');
  assert.ok(browserArgs('https://x.invalid/a', { uid: 1000, timeout: 6_000 }).includes('--timeout=5000'), 'a short timeout keeps a floor under the deadline');
  assert.ok(browserArgs('https://x.invalid/a', { uid: 1000 }).includes(`--timeout=${TIMEOUT_MS - 10_000}`), 'no timeout given means the default one');
});

test('late process completion or pending loads grade a render partial, with requests reported at process completion', () => {
  const page = `<html><head><title>Late</title></head><body><main><p>${'Rendered words that are enough to be graded as content. '.repeat(40)}</p></main></body></html>`;
  // The guard's record is the signal: Chromium logs "Page load timed out" only when the
  // navigation itself never committed, not for a resource that stalled.
  const at = (extra) => browser.scrape('https://x.invalid/a', { render: () => ({ status: 0, signal: null, stdout: page, stderr: '', refused: [], requests: 7, pending: [], elapsedMs: 35_060, ...extra }), browserPath: '/opt/chrome', env: {}, timeout: 45_000 });
  const stalled = at({ pending: [{ kind: 'http', target: 'https://cdn.x.invalid/slow.js', ms: 34_900 }] });
  assert.equal(stalled.ok, true);
  assert.equal(stalled.completeness, 'partial');
  assert.match(stalled.omitted, /configured 35 s loading deadline/);
  assert.match(stalled.omitted, /still unanswered through the guard at process completion: https:\/\/cdn\.x\.invalid\/slow\.js \(35 s\)/);
  const inside = at({ pending: [] });
  assert.equal(inside.completeness, 'partial');
  assert.match(inside.omitted, /every one of the 7 requests through the guard had been answered at process completion/);
  // Short process duration with a load still open: partial, and named at completion.
  const early = at({ elapsedMs: 9_000, pending: [{ kind: 'connect', target: 'cdn.x.invalid:443', ms: 8_500 }] });
  assert.equal(early.completeness, 'partial');
  assert.match(early.omitted, /configured 35 s loading deadline; still unanswered through the guard at process completion: cdn\.x\.invalid:443 \(9 s\)/);
  // Settled on its own, everything answered: the grade is the extractor's own.
  const settled = browser.scrape('https://x.invalid/a', { render: () => ({ status: 0, signal: null, stdout: page, stderr: '', refused: [], requests: 2, pending: [], elapsedMs: 1_200, netLog: netLog([['https://x.invalid/a', 200]]) }), browserPath: '/opt/chrome', env: {} });
  assert.equal(settled.completeness, 'full', settled.omitted);
});

test('deadline notes describe configuration and process-end requests without claiming when a complete DOM arrived', () => {
  const asked = 'https://x.invalid/a';
  // The complete DOM may have arrived early, but this record timestamps only process end.
  // A later exit hang and the final pending snapshot cannot establish its arrival time
  // or where the browser spent the historical wait.
  for (const pending of [[], [{ kind: 'http', target: 'https://cdn.x.invalid/slow.js', ms: 59_000 }]]) {
    const r = browser.scrape(asked, { render: () => ({ status: null, signal: 'SIGKILL', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), stdout: PAGE, stderr: '', refused: [], requests: 7, pending, elapsedMs: 70_000, startupMs: 5_000, netLog: netLog([[asked, 200]]) }), browserPath: '/opt/chrome', env: {}, timeout: 45_000 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.completeness, 'partial', 'late process completion still conservatively grades the capture partial');
    assert.match(r.omitted, /configured 35 s loading deadline/);
    assert.match(r.omitted, /at process completion/);
    assert.doesNotMatch(r.omitted, /stopped loading at|wait was inside the browser|printed the page before/, 'process-end observations do not establish the dump time or the cause of the wait');
    if (pending.length) assert.match(r.omitted, /https:\/\/cdn\.x\.invalid\/slow\.js \(59 s\)/);
    else assert.match(r.omitted, /every one of the 7 requests through the guard had been answered/);
  }
});

test('a timeout says how long the browser took to make its first request, and the deadline is judged from it', () => {
  const page = `<html><head><title>Late</title></head><body><main><p>${'Rendered words that are enough to be graded as content. '.repeat(40)}</p></main></body></html>`;
  const late = browser.scrape('https://x.invalid/a', { render: () => ({ status: null, signal: 'SIGKILL', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), stdout: '', stderr: '', refused: [], requests: 0, pending: [], elapsedMs: 90_000, startupMs: null }), browserPath: '/opt/chrome', env: {}, timeout: 45_000 });
  assert.match(late.error, /did not finish rendering https:\/\/x\.invalid\/a within 45s: the browser never made a request in 90 s/);
  const slowStart = browser.scrape('https://x.invalid/a', { render: () => ({ status: null, signal: 'SIGKILL', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), stdout: '', stderr: '', refused: [], requests: 3, pending: [], elapsedMs: 88_000, startupMs: 43_000 }), browserPath: '/opt/chrome', env: {}, timeout: 45_000 });
  assert.match(slowStart.error, /did not finish rendering https:\/\/x\.invalid\/a within 45s: the browser took 43 s to make its first request/);
  // Forty seconds of wall time with a thirty-second start is a ten-second render: settled, not cut at the 35 s deadline.
  const settled = browser.scrape('https://x.invalid/a', { render: () => ({ status: 0, signal: null, stdout: page, stderr: '', refused: [], requests: 2, pending: [], elapsedMs: 40_000, startupMs: 30_000, netLog: netLog([['https://x.invalid/a', 200]]) }), browserPath: '/opt/chrome', env: {}, timeout: 45_000 });
  assert.equal(settled.completeness, 'full', settled.omitted);
});

test('LIVE: a page whose resource never arrives is captured whole and marked partial under its deadline', async () => {
  const chromium = findBrowser();
  requireCapability(chromium, 'NO-BROWSER', 'no Chromium or Chrome on this host');
  // The page server lives in a process of its own: this one blocks in spawnSync while the
  // guard child renders, so a server here would never answer (as browser-guard's does).
  const file = path.join(tempDir('rk-stalled-pages-'), 'pages.mjs');
  fs.writeFileSync(file, `
import http from 'node:http';
const server = http.createServer((req, res) => {
  if (req.url === '/never') return;                      // a resource that never answers
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<html><head><title>Stalled</title></head><body><main><p>' + 'Body text that arrived before a resource that never does. '.repeat(20) + '</p><img src="/never"></main></body></html>');
});
server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));
`);
  const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    proc.on('exit', (code) => reject(new Error(`the page server exited ${code}`)));
  });
  try {
    // Chromium's own log rides the launch, and is printed for a render that ran past its
    // deadline (see the guard's LIVE test): a startup hang shows nothing anywhere else.
    let last, launchedArgs;
    const render = (b, a, o) => { const args = [...a]; args.splice(-2, 0, '--enable-logging=stderr', '--v=1'); launchedArgs = args; last = renderGuarded(b, args, o); return last; };
    const t0 = Date.now();
    // 30 s: the deadline is then 20 s, room for a renderer that is slow to start on a CI runner
    // (one took over 5 s to make the page request, and a 5 s deadline dumped an empty document).
    const r = browser.scrape(`http://127.0.0.1:${port}/stalled`, { render, browserPath: chromium, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: process.env.HOME ?? '', USERPROFILE: process.env.USERPROFILE ?? '' }, allowInternalRedirects: true, timeout: 30_000 });
    if (Date.now() - t0 > 25_000) process.stderr.write(`browser-transport LIVE /stalled took ${Date.now() - t0} ms (browser ${last?.elapsedMs ?? '?'} ms, first request after ${last?.startupMs ?? '?'} ms, launched ${last?.startedAt ?? '?'}): ${r.error ?? r.omitted ?? 'no note'} | requests ${last?.requests ?? '?'}\n  chromium log (head and tail):\n    ${String(last?.stderr ?? '').split('\n').filter((l) => l && !/^Histogram: |^\d+\s+[-.O ]+\(|^\d+\s+\.\.\. $/.test(l)).join('\n    ')}\n`);
    assert.equal(r.ok, true, `the page was lost: ${r.error}`);
    assert.equal(r.title, 'Stalled');
    assert.match(r.markdown, /arrived before a resource that never does/);
    assert.ok(launchedArgs?.includes('--timeout=20000'), 'the 30 s transport budget must give Chromium its 20 s deadline');
    // elapsedMs records process completion, not DOM arrival: a complete dump may survive
    // a later exit hang/ETIMEDOUT, as scrape and its printed-page-then-hung test require.
    // The live failure at 55.9 s of process time did not establish when the DOM arrived.
    assert.match(String(last?.stdout ?? ''), /<\/html>\s*$/i, 'the stalled resource must still leave a complete dumped HTML document');
    assert.equal(r.completeness, 'partial', 'a page cut at the deadline is not a full capture');
    assert.match(r.omitted, /still unanswered through the guard at process completion: http:\/\/127\.0\.0\.1:\d+\/never/, r.omitted);
  } finally { proc.kill(); }
});

// ADR-0137: the status a real Chromium reports in its net log, read through the guard child.
test('LIVE: a real Chromium\'s net log carries the origin\'s status, so a 403 page is refused and a 200 page is captured', async () => {
  const chromium = findBrowser();
  requireCapability(chromium, 'NO-BROWSER', 'no Chromium or Chrome on this host');
  const file = path.join(tempDir('rk-status-pages-'), 'pages.mjs');
  fs.writeFileSync(file, `
import http from 'node:http';
const page = (title) => '<html><head><title>' + title + '</title></head><body><main><h1>' + title + '</h1><p>' + 'Words enough for the extractor to grade this page as content. '.repeat(40) + '</p></main></body></html>';
const server = http.createServer((req, res) => {
  if (req.url === '/forbidden') { res.writeHead(403, { 'content-type': 'text/html' }); return res.end(page('403 Forbidden')); }
  if (req.url === '/hop') { res.writeHead(302, { location: '/landed' }); return res.end(); }
  if (req.url === '/favicon.ico') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page('Plain page'));
});
server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));
`);
  const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    proc.on('exit', (code) => reject(new Error(`the page server exited ${code}`)));
  });
  const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: process.env.HOME ?? '', USERPROFILE: process.env.USERPROFILE ?? '' };
  try {
    const at = (p) => browser.scrape(`http://127.0.0.1:${port}${p}`, { browserPath: chromium, env, allowInternalRedirects: true, timeout: 30_000 });
    const denied = at('/forbidden');
    assert.equal(denied.ok, false, `an origin's 403 page was captured: ${JSON.stringify(denied).slice(0, 300)}`);
    assert.equal(denied.statusCode, 403);
    assert.match(denied.error, /HTTP 403/);
    const plain = at('/plain');
    assert.equal(plain.ok, true, plain.error);
    assert.equal(plain.statusCode, 200, 'the net log gave no status for a plain page');
    assert.equal(plain.title, 'Plain page');
    assert.match(plain.markdown, /Words enough for the extractor to grade this page as content/);
    assert.match(plain.source, /<\/html>\s*$/i, 'the plain page must have a whole dumped DOM');
    // Process completion is not DOM arrival: a whole capture can survive an exit wait.
    // Accept that documented partial grade only, keeping unrelated omissions visible.
    if (plain.completeness === 'partial') {
      assert.match(plain.omitted,
        /^the browser had a configured 20 s loading deadline; every one of the \d+ requests through the guard had been answered at process completion$/,
        'a recovered plain page may be partial only for the configured deadline with all guard requests answered at process completion');
    } else {
      assert.equal(plain.completeness, 'full', plain.omitted);
      assert.equal(plain.omitted, '');
    }
    const hopped = at('/hop');
    assert.equal(hopped.ok, true, hopped.error);
    assert.equal(hopped.statusCode, 200);
    assert.equal(hopped.url, `http://127.0.0.1:${port}/landed`);
  } finally { proc.kill(); }
});

test('the browser is found by config, then environment, then the usual install paths', () => {
  const has = (p) => ['/cfg/chrome', '/env/chrome', '/usr/bin/chromium'].includes(p);
  assert.equal(findBrowser({ config: { browserPath: '/cfg/chrome' }, env: { RESEARCH_KIT_BROWSER: '/env/chrome' }, exists: has }), '/cfg/chrome');
  assert.equal(findBrowser({ config: {}, env: { RESEARCH_KIT_BROWSER: '/env/chrome' }, exists: has }), '/env/chrome');
  assert.equal(findBrowser({ config: {}, env: {}, exists: has, platform: 'linux' }), '/usr/bin/chromium');
  assert.equal(findBrowser({ config: {}, env: {}, exists: () => false, platform: 'linux' }), '');
});

test('it is a named transport with the fetch shape, chosen only when asked for', () => {
  assert.equal(TRANSPORTS.browser, browser);
  assert.ok(satisfies(browser, FETCH_SHAPE));
  const chosen = selectTransport({ explicit: 'browser', env: {}, config: {} });
  assert.equal(chosen.name, 'browser');
  assert.equal(chosen.search.name, 'http-keyless', 'the browser does not search; the keyless search does');
  const auto = selectTransport({ env: {}, config: {}, probe: () => ({ installed: false }) });
  assert.equal(auto.name, 'http-keyless', 'auto-detection is unchanged');
});

test('with a SerpAPI key, the browser is never asked to search: keyless searches beside SerpAPI', () => {
  // Found 2026-09-29 by the first live run of the browser transport: a SerpAPI key merged the
  // search side as "serpapi AND browser", and research.mjs died with "provider.search is not
  // a function" before collecting anything. The no-key route already swapped in keyless; the
  // merged route did not, and no offline test combined a key with a fetch-only transport.
  const chosen = selectTransport({ explicit: 'browser', env: { SERPAPI_API_KEY: 'test-key-not-real' }, config: {} });
  assert.equal(chosen.search.merged, true);
  for (const one of chosen.search.adapters) {
    assert.equal(typeof one.search, 'function', `${one.name} was put on the search side and cannot search`);
  }
  assert.deepEqual(chosen.search.adapters.map((one) => one.name), ['serpapi', 'http-keyless']);
  assert.match(chosen.search.why, /AND with http-keyless/);
});

test('a browser killed by a signal is not reported as a timeout', () => {
  // Found 2026-09-29 by the live run: Chrome died 21 seconds into a 60-second budget and the
  // failure read "did not finish rendering within 60s" - any signal was taken for the
  // timeout, so the one line that could name the cause named the wrong one.
  const trapped = browser.scrape('https://x.invalid/a', {
    render: () => ({ status: null, signal: 'SIGTRAP', stdout: '', stderr: 'noise\n[FATAL:zygote_host_impl_linux.cc] No usable sandbox!\n' }),
    browserPath: '/opt/chrome', env: {},
  });
  assert.equal(trapped.ok, false);
  assert.doesNotMatch(trapped.error, /did not finish/);
  assert.match(trapped.error, /killed by SIGTRAP/);
  assert.match(trapped.error, /No usable sandbox/);
});

test('a crash names Chromium\'s FATAL line, not the stack trace\'s last line', () => {
  // Found 2026-09-29, live run 36518843676: "killed by SIGABRT: [end of stack trace]" - the
  // last stderr line of a Chromium crash is the dump's footer; the cause is the FATAL line.
  const r = browser.scrape('https://x.invalid/a', {
    render: () => ({ status: null, signal: 'SIGABRT', stdout: '',
      stderr: '[123:123:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! See https://x/y\n#0 0x55 base::debug::StackTrace\n#1 0x56 logging::LogMessage\n[end of stack trace]\n' }),
    browserPath: '/opt/chrome', env: {},
  });
  assert.match(r.error, /killed by SIGABRT: .*FATAL.*No usable sandbox/);
  assert.doesNotMatch(r.error, /end of stack trace/);
});

test('a FATAL line outranks the ERROR noise the crash handler prints after it', () => {
  // Live run 36519057831: after the FATAL, crashpad logged "ERROR: ... open /sys/devices/
  // system/cpu/cpu0/cpufreq/scaling_max_freq: No such file", and that noise was reported as
  // the cause. A FATAL is the cause when there is one; ERROR only stands in when there is not.
  const r = browser.scrape('https://x.invalid/a', {
    render: () => ({ status: null, signal: 'SIGABRT', stdout: '',
      stderr: '[1:1:FATAL:some_file.cc(9)] Check failed: the real cause\n#0 0x1 frame\n[end of stack trace]\n[2:2:ERROR:crashpad/file_io_posix.cc:145] open /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq: No such file or directory (2)\n' }),
    browserPath: '/opt/chrome', env: {},
  });
  assert.match(r.error, /FATAL.*the real cause/);
  assert.doesNotMatch(r.error, /cpufreq/);
});

// ADR-0092. Research: docs/decisions/2026-09-29-chromium-sandbox-userns.
test('on Linux, Chrome stable - the binary Ubuntu lets sandbox itself - is preferred', () => {
  // Found by live run 36519301132: on ubuntu-latest the kit picked a Chromium build that
  // AppArmor denies user namespaces, while Ubuntu's own profile allows Chrome stable (E-02).
  const all = () => true;
  assert.equal(findBrowser({ config: {}, env: {}, exists: all, platform: 'linux' }), '/opt/google/chrome/chrome');
  const onlyChromium = (p) => p === '/usr/bin/chromium';
  assert.equal(findBrowser({ config: {}, env: {}, exists: onlyChromium, platform: 'linux' }), '/usr/bin/chromium');
});

test('a denied sandbox names the remedies that keep it, never --no-sandbox', () => {
  const r = browser.scrape('https://x.invalid/a', {
    render: () => ({ status: null, signal: 'SIGTRAP', stdout: '',
      stderr: '[1:1:0929/035552.424135:FATAL:content/browser/zygote_host/zygote_host_impl_linux.cc:129] No usable sandbox! If you are running on Ubuntu 23.10+ or another Linux distro that has disabled unprivileged user namespaces with AppArmor, see https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md\n' }),
    browserPath: '/usr/bin/chromium', env: {}, uid: 1001,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /No usable sandbox/);
  assert.match(r.error, /\/opt\/google\/chrome\/chrome/);
  assert.match(r.error, /CHROME_DEVEL_SANDBOX=\/opt\/google\/chrome\/chrome-sandbox/);
  assert.doesNotMatch(r.error, /--no-sandbox/);
});

// ADR-0118. ADR-0110 left the browser transport open, and ADR-0115 judged only the URL asked for:
// Chromium follows redirects, runs scripts that navigate, and loads frames and images inside
// itself. Every request now goes through the kit's guard proxy, run by the child the transport
// renders through; what the guard turned away comes back as `refused`, and a page that landed
// on a refusal is not a capture.
test('a page that led the browser into this machine\'s network is refused, by name, and not captured', () => {
  const refusal = `${REFUSAL_MARKER}: 169.254.169.254:80 - 169.254.169.254 is an internal address`;
  const { render } = renderWith({ stdout: `<html><body><pre>${refusal}</pre></body></html>`, refused: [{ host: '169.254.169.254:80', why: '169.254.169.254 is an internal address' }] });
  const r = browser.scrape('https://evil.example/a', { render, browserPath: '/opt/chrome', env: {} });
  assert.equal(r.ok, false, 'a refusal page was captured as the page');
  assert.match(r.error, /169\.254\.169\.254.*internal address/);
  assert.match(r.error, /RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS/);
  assert.equal(r.markdown, undefined);

  // A CONNECT the guard refused leaves Chromium on its own error page: named as the refusal, not as the code.
  const tunnel = renderWith({ stdout: PRIVACY.replace('ERR_CERT_AUTHORITY_INVALID', 'ERR_TUNNEL_CONNECTION_FAILED'), refused: [{ host: '10.0.0.8:443', why: '10.0.0.8 is an internal address' }] });
  const t = browser.scrape('https://evil.example/a', { render: tunnel.render, browserPath: '/opt/chrome', env: {} });
  assert.equal(t.ok, false);
  assert.match(t.error, /10\.0\.0\.8/);

  // A refused image on a page that still rendered is not a failure of the capture.
  const { render: partial } = renderWith({ stdout: PAGE, refused: [{ host: '10.0.0.9:80', why: '10.0.0.9 is an internal address' }] });
  assert.equal(browser.scrape('https://ok.example/a', { render: partial, browserPath: '/opt/chrome', env: {} }).ok, true);
});

test('by default the browser renders through the guard child, which is handed the URL and the operator\'s decision', () => {
  const src = fs.readFileSync(path.join(KIT_ROOT, 'lib', 'browser-transport.mjs'), 'utf8');
  assert.match(src, /render = renderGuarded/, 'the default renderer is not the guard');
  const jobs = [];
  const spawn = (file, args, opts) => { jobs.push({ file, args, job: JSON.parse(opts.input) }); return { status: 0, stdout: JSON.stringify({ status: 0, stdout: PAGE, stderr: '', refused: [] }), stderr: '' }; };
  const r = renderGuarded('/opt/chrome', browserArgs('https://x.invalid/a', { uid: 1000 }), { url: 'https://x.invalid/a', env: { RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS: '1' }, spawn, nodePath: '/opt/node' });
  assert.equal(r.stdout, PAGE);
  assert.equal(jobs[0].file, '/opt/node');
  assert.match(jobs[0].args[0], /browser-guard\.mjs$/);
  assert.equal(jobs[0].job.url, 'https://x.invalid/a');
  assert.equal(jobs[0].job.allowInternalRedirects, true, 'the opt-out did not reach the child');
  assert.equal(jobs[0].job.binary, '/opt/chrome');
  const plain = renderGuarded('/opt/chrome', [], { url: 'https://x.invalid/a', env: {}, spawn, nodePath: '/opt/node' });
  assert.equal(jobs[1].job.allowInternalRedirects, undefined, 'with nothing decided, the child decides from the URL');
  assert.equal(plain.stdout, PAGE);
  // #290: a value the kit cannot read is a refusal handed to the child, never the default.
  for (const value of ['yes', 'false', ' 0', 'TRUE']) {
    renderGuarded('/opt/chrome', [], { url: 'https://x.invalid/a', env: { RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS: value }, spawn, nodePath: '/opt/node' });
    assert.equal(jobs.at(-1).job.allowInternalRedirects, false, `${JSON.stringify(value)} reached the guard as the default`);
  }
});

// ADR-0140: the rendered DOM is the text the browser capture was converted from.
test('ADR-0140: a browser capture carries the rendered DOM as its source', () => {
  const asked = 'https://x.example/page';
  const page = browser.scrape(asked, { render: renderWith({ stdout: PAGE, netLog: netLog([[asked, 200]]) }).render, browserPath: '/bin/true', env: {}, uid: 0 });
  assert.equal(page.ok, true, page.error);
  assert.equal(page.source, PAGE);
});

// Found 2026-10-04 on the operator's Windows PC, one full run in three (break-test pass 6, F1):
// Chromium took most of its launch allowance to make a request, the render then ran most of
// its own budget, and the parent's spawnSync - set to timeout + 10 s - killed the guard child
// mid-render. ADR-0119 allows a browser that does make a request 2 x timeout of wall time, so
// the parent must wait at least as long or IT is the timeout, and the child's record of where
// the time went dies with it: the verdict read "the browser never made a request in 0 s".
test('the parent waits for the launch allowance AND the render budget before giving the guard child up (ADR-0119)', () => {
  const seen = [];
  const spawn = (cmd, argv, options) => { seen.push(options); return { status: 0, stdout: JSON.stringify({ status: 0, stdout: '<html></html>', stderr: '', refused: [] }), stderr: '' }; };
  renderGuarded('/opt/chrome', [], { url: 'https://x.invalid/a', env: {}, spawn, nodePath: '/opt/node', timeout: 15_000 });
  renderGuarded('/opt/chrome', [], { url: 'https://x.invalid/a', env: {}, spawn, nodePath: '/opt/node', timeout: 45_000 });
  assert.equal(seen[0].timeout, 2 * 15_000 + 10_000, 'launch allowance + render budget + 10 s for the child to kill the browser and report');
  assert.equal(seen[1].timeout, 2 * 45_000 + 10_000);
});

test('a guard child the parent gave up on is said to be that, not a browser that never made a request in 0 s', () => {
  const gaveUp = () => ({ error: Object.assign(new Error('spawnSync /opt/node ETIMEDOUT'), { code: 'ETIMEDOUT' }), status: null, signal: 'SIGTERM', stdout: '', stderr: '' });
  const r = renderGuarded('/opt/chrome', [], { url: 'https://x.invalid/a', env: {}, spawn: gaveUp, nodePath: '/opt/node', timeout: 15_000 });
  assert.equal(r.error.code, 'ETIMEDOUT');
  assert.match(r.error.message, /the guard child did not finish within 40 s/, r.error.message);
  assert.equal(r.gaveUp, true, 'the parent-timeout result carries the flag the transport reads, not a message to match');
  const page = browser.scrape('https://x.invalid/a', { render: () => r, browserPath: '/opt/chrome', env: {}, timeout: 15_000 });
  assert.equal(page.ok, false);
  assert.match(page.error, /did not finish rendering https:\/\/x\.invalid\/a within 15s: the guard child did not finish within 40 s/, page.error);
  assert.doesNotMatch(page.error, /never made a request in 0 s/);
});
