// searxng.mjs - a SEARCH-ONLY provider backed by a SearXNG instance the operator runs (ADR-0104).
//
// Why it exists: the keyless search route scrapes DuckDuckGo-lite, which answers automated
// requests with a bot check (it did so again while this provider was being researched,
// 2026-09-30). A self-hosted SearXNG answers the same question as JSON, with no key and no
// meter.
//
// Four facts from docs/decisions/2026-09-30-searxng-search shape everything below:
//   - The request is `GET <instance>/search?q=...&format=json` (E-01).
//   - JSON is OFF by default: `search.formats` lists only `html` (E-02), and a format the
//     instance has not enabled is refused with HTTP 403 (E-01). So a 403 is reported as
//     "enable json", never as "no results".
//   - Each result carries `url`, `title` and `content`, and `url` is typed `str | None`
//     (E-06), so a row without one is dropped.
//   - The limiter is off unless the operator turns it on (E-03), so a private instance
//     serves a script without it.
//
// Nothing secret is sent: the only configuration is the instance URL. The query does go to
// that instance, which is the operator's own choice of server.
//
// Pure Node ESM, no dependencies. As in serpapi.mjs, `fetch` is async and the adapter shape
// is synchronous, so this module re-execs ITSELF with a JSON job on stdin.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './machine.mjs';
import { fetchEnv, CHILD_OUTPUT_LIMIT, boundedText, outputOverflow, fetchFailure } from './runtime.mjs';

export const name = 'searxng';

/** The contracts this module satisfies. Asked for anything else, it refuses by name. */
export const CONTRACTS = Object.freeze(['search']);

export const URL_ENV = 'SEARXNG_URL';
export const CONFIG_KEY = 'searxngUrl';
export const DEFAULT_TIMEOUT = 20_000;

const SELF = fileURLToPath(import.meta.url);

/** The instance URL: the environment wins over the machine config, as the SerpAPI key does. */
export function readUrl({ env = process.env, config = null } = {}) {
  const fromEnv = typeof env[URL_ENV] === 'string' ? env[URL_ENV].trim() : '';
  if (fromEnv) return fromEnv;
  return config && typeof config[CONFIG_KEY] === 'string' ? config[CONFIG_KEY].trim() : '';
}

/** An http(s) URL, or null. Anything else is a typo, and nothing is sent to it. */
function instanceUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch { return null; }
}

/**
 * The instance as it may be shown: a password in it is replaced by `***`. An instance behind
 * basic auth is written http://user:pass@host (found 2026-09-30), and every message that
 * names the instance would otherwise print the password.
 */
export function shownInstance(instance) {
  const text = String(instance);
  try {
    const url = new URL(text);
    if (url.password) { url.password = '***'; return url.href; }
    if (url.protocol === 'http:' || url.protocol === 'https:') return text;
  } catch { /* fall through to pattern redaction */ }
  // What no parser accepts is redacted by pattern, up to the LAST @: a password holding an
  // unencoded / ? # or @ is exactly what makes a URL unparseable (found 2026-09-30).
  return text.replace(/^((?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#@:\s]+):\S*@/i, '$1:***@');
}

/** The `Authorization` header for credentials in the instance URL, or null. */
export function basicAuth(instance) {
  const url = instanceUrl(instance);
  if (!url || (!url.username && !url.password)) return null;
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const pair = `${decode(url.username)}:${decode(url.password)}`;
  return `Basic ${Buffer.from(pair).toString('base64')}`;
}

/**
 * `GET <instance>/search?q=...&format=json` (E-01); an instance under a sub-path keeps it.
 * Credentials are dropped from the URL - fetch refuses a URL that carries them - and sent as
 * a header instead (basicAuth).
 */
export function requestUrl(instance, query) {
  const base = instanceUrl(instance);
  if (!base) throw new Error(`not an http(s) URL: ${shownInstance(instance)}`);
  base.username = '';
  base.password = '';
  // Built on the PATH, not the whole href: a query or fragment on the instance URL swallowed
  // the appended slash, and the search went to /search at the root (found 2026-09-30,
  // break-test). The instance's own query and fragment are dropped, as they always were
  // under a trailing slash: the request carries q and format only.
  const url = new URL(base.href);
  url.pathname = `${base.pathname.replace(/\/+$/, '')}/search`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('q', String(query ?? ''));
  url.searchParams.set('format', 'json');
  return url;
}

/**
 * The JSON body's `results` as candidate rows. A row that is not an object, or has no string
 * `url` (E-06: `str | None`), is dropped: one malformed row must not take the valid ones
 * with it (the lesson of both vendor parsers, 2026-09-28 and 2026-09-29).
 */
export function normalizeSearch(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const text = (value) => (typeof value === 'string' ? value : '');
  return rows
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row) && text(row.url))
    .map((row, index) => ({ url: row.url, title: text(row.title), description: text(row.content), position: index + 1 }));
}

/** What the ledger and the logs record about a search. Nothing in it is secret. */
export function command(query) {
  return `searxng search ${JSON.stringify(String(query))}`;
}

const NOT_CONFIGURED = `no SearXNG instance: set ${URL_ENV}, or ${CONFIG_KEY} in the machine config, `
  + 'to the URL of an instance you run (with json enabled in its search.formats)';

/** Why a response failed, in words an operator can act on. */
function explain(answer, instance) {
  if (answer.statusCode === 403) {
    return `the SearXNG instance at ${shownInstance(instance)} answered HTTP 403: JSON output is not enabled. `
      + 'Add json to search.formats in its settings.yml and restart it (search.formats lists only html by default).';
  }
  return answer.error || 'searxng request failed';
}

/**
 * `search(query, opts)` -> `{ ok, query, results[], error, cmd, provider }`.
 *
 * Every failure path returns rather than throws, as serpapi.search does: the collector holds
 * the corpus lock while it searches.
 */
export function search(query, {
  limit = 8,
  env = process.env,
  config = undefined,
  timeout = DEFAULT_TIMEOUT,
  job = runJob,
} = {}) {
  const text = String(query);
  const instance = readUrl({ env, config: config === undefined ? loadConfig(env) : config });
  const base = { query: text, results: [], cmd: command(text), provider: name };
  if (!instance) return { ok: false, ...base, error: NOT_CONFIGURED };
  if (!instanceUrl(instance)) {
    return { ok: false, ...base, error: `${URL_ENV}/${CONFIG_KEY} must be an http(s) URL; got "${shownInstance(instance)}"` };
  }

  const answer = job({ kind: 'searxng-search', query: text, instance, timeout }, { timeout, env });
  if (!answer?.ok) return { ok: false, ...base, error: explain(answer ?? {}, instance) };
  const results = normalizeSearch(answer.payload);
  return { ok: true, ...base, results: limit > 0 ? results.slice(0, limit) : results };
}

/** Configuration presence, offline: no request is made to find out. */
export function status({ env = process.env, config = null } = {}) {
  const instance = readUrl({ env, config });
  const source = env[URL_ENV]?.trim() ? URL_ENV : (instance ? `config.${CONFIG_KEY}` : '');
  return {
    ok: true,
    transport: name,
    authenticated: Boolean(instance),
    source,
    searchesRemaining: null,
    raw: instance ? `searxng: instance ${shownInstance(instance)} (via ${source})` : `searxng: ${NOT_CONFIGURED}`,
  };
}

export function runJob(job, { timeout = DEFAULT_TIMEOUT, spawn = spawnSync, nodePath = process.execPath, env = process.env } = {}) {
  const result = spawn(nodePath, [SELF], {
    input: JSON.stringify(job),
    encoding: 'utf8',
    // The child's own fetch timeout fires first; this bounds a child that hangs anyway.
    timeout: timeout + 5_000,
    windowsHide: true,
    env: fetchEnv(env),
    maxBuffer: CHILD_OUTPUT_LIMIT,
  });
  if (result.error?.code === 'ETIMEDOUT') return { ok: false, error: `SearXNG did not answer within ${timeout / 1000}s - the request was abandoned` };
  const overflow = outputOverflow(result, 'SearXNG');
  if (overflow) return { ok: false, error: overflow };
  if (result.error) return { ok: false, error: result.error.message };
  const out = String(result.stdout ?? '').trim();
  if (!out) return { ok: false, error: String(result.stderr || 'searxng transport produced no output').trim() };
  try { return JSON.parse(out); } catch (err) {
    return { ok: false, error: `searxng transport emitted unparseable output: ${err.message}` };
  }
}

function cannotFetch(op) {
  const err = new Error(
    `${name} is a search-only provider and cannot ${op}. It is selected for the SEARCH side only; `
    + 'the fetch side stays on a provider that produces captures (see --transport).');
  err.code = 'SEARCH_ONLY_PROVIDER';
  throw err;
}

export const scrape = () => cannotFetch('scrape');
export const runScrape = () => cannotFetch('scrape');
export const map = () => cannotFetch('map');

export default { name, search, status, command, CONTRACTS };

// ---------------------------------------------------------------- the child half

async function child() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let job;
  try { job = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: `unparseable job: ${err.message}` }));
    return;
  }
  if (job.kind !== 'searxng-search') {
    process.stdout.write(JSON.stringify({ ok: false, error: `unknown job kind "${job.kind}"` }));
    return;
  }
  let url;
  try { url = requestUrl(job.instance, job.query); } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
    return;
  }
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { accept: 'application/json', ...(basicAuth(job.instance) ? { authorization: basicAuth(job.instance) } : {}) },
      signal: AbortSignal.timeout(job.timeout ?? DEFAULT_TIMEOUT),
    });
    const body = await boundedText(response, 'the SearXNG response');
    if (!response.ok) {
      process.stdout.write(JSON.stringify({ ok: false, statusCode: response.status, error: `searxng returned HTTP ${response.status}` }));
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch {
      process.stdout.write(JSON.stringify({ ok: false, statusCode: response.status,
        error: `searxng returned HTTP ${response.status} with a non-JSON body (${body.length} bytes) - is this a SearXNG instance?` }));
      return;
    }
    process.stdout.write(JSON.stringify({ ok: true, statusCode: response.status, payload }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: `could not reach the SearXNG instance: ${fetchFailure(err)}` }));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await child();
}
