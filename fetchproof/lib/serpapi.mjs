// serpapi.mjs - a SEARCH-ONLY provider (ADR-0027).
//
// The first module in this kit that satisfies one contract rather than the whole adapter
// shape. It searches. It cannot fetch a page, says so by name when asked, and never
// produces a capture - so nothing here ever reaches the fetch ledger.
//
// Why it exists: search and fetch drew on one free allowance, so every search spent was
// a page not fetched (E-03, E-14). This is a second meter, not a cheaper one.
//
// Three vendor facts shape every decision below, each read off the captured API
// reference rather than assumed:
//   - `api_key` is Required and travels as a QUERY PARAMETER. That is the worst place a
//     secret can live, so it is never rendered, never logged, and scrubbed out of vendor
//     error text before anyone sees it.
//   - There is no documented result-count parameter. Only `start`, for pagination. We
//     send neither and slice locally - a response costs the same whatever it carries
//     ("responses with 100 results or empty result sets will both count as 1 search"),
//     so asking for fewer buys nothing. Three defects in this project have come from
//     assuming a vendor parameter; this is the cheap way not to add a fourth.
//   - `no_cache` defaults to false and a repeated identical query is served from
//     SerpAPI's own cache for an hour, free and uncounted. We never send it.
//
// Pure Node ESM, no dependencies. `fetch` is async and the adapter shape is synchronous,
// so this module re-execs ITSELF with a JSON job on stdin - the same child-process
// rendezvous `http-transport.mjs` uses. The key travels on that pipe rather than in argv
// or the environment, so it never appears in the process table.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './machine.mjs';
import { fetchEnv, CHILD_OUTPUT_LIMIT, boundedText, outputOverflow, fetchFailure } from './runtime.mjs';

export const name = 'serpapi';

/** The contracts this module satisfies. Asked for anything else, it refuses by name. */
export const CONTRACTS = Object.freeze(['search']);

export const ENDPOINT = 'https://serpapi.com/search';
// The vendor's own meter (E-26): "free of charge, and using it will not be counted toward
// your monthly quota". Overridable by environment ONLY within `allowedEndpoint` - the
// vendor's host or loopback - so tests can point it at a stand-in and never at the network.
export const ACCOUNT_ENDPOINT = 'https://serpapi.com/account.json';
export const ACCOUNT_ENDPOINT_ENV = 'FETCHPROOF_SEARCH_ACCOUNT_ENDPOINT';
export const ACCOUNT_TIMEOUT = 10_000;
export const KEY_ENV = 'SERPAPI_API_KEY';
export const CONFIG_KEY = 'serpapiKey';
export const DEFAULT_TIMEOUT = 30_000;

/**
 * What the kit's search-meter numbers mean for THIS vendor (U-9, U-10, U-11; 2026-09-26).
 *
 * The caps `searchUsage` reports - 50/hour, 250/month - are the documented Free Plan (E-25,
 * E-27). SerpAPI's own Account API reported 250/hour for this account and defines that field
 * as the account's own limit (E-26), so a constant cannot be presented as the account's. And
 * the vendor's month is a billing cycle (E-27), where the kit counts a calendar month.
 * `--status` prints these beside the numbers; the account's real figures are one free call away.
 */
export const METER_NOTES = Object.freeze([
  'caps: the documented Free Plan (E-25, E-27); an account can be allowed more - '
    + 'its own limits are at serpapi.com/account.json, free and uncounted (E-26)',
  '"this month" is the calendar month (UTC); SerpAPI counts by billing cycle, which may start on another day (E-27)',
]);

const SELF = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------- the credential

/**
 * Where the key may come from, in precedence order: the environment, then the machine
 * config. Never this repository, never a plan, never a capture (SR-1).
 *
 * Returns '' rather than throwing. An absent key is the ordinary case - it is how the
 * kit knows to leave the search side on the fetch provider (FR-5).
 */
export function readKey({ env = process.env, config = null } = {}) {
  const fromEnv = typeof env[KEY_ENV] === 'string' ? env[KEY_ENV].trim() : '';
  if (fromEnv) return fromEnv;
  const fromConfig = config && typeof config[CONFIG_KEY] === 'string' ? config[CONFIG_KEY].trim() : '';
  return fromConfig;
}

/**
 * Remove a secret from text that is about to be shown to somebody.
 *
 * Vendors echo the request URL in error messages, and this vendor's request URL contains
 * the key. Scrubbing at the boundary is the only place that catches every path: the
 * terminal, the failure log, and an exception message nobody planned for.
 *
 * Short keys are refused rather than replaced - a two-character "key" would turn every
 * occurrence of those characters into noise, which hides more than it protects.
 */
export function redact(text, key) {
  const body = String(text ?? '');
  const secret = String(key ?? '');
  if (secret.length < 8) return body;
  return body.split(secret).join('***REDACTED***');
}

// ---------------------------------------------------------------- the rendezvous

// The child's fetch uses a configured proxy only when told to (fetchEnv). Found 2026-09-27:
// this child was started without it after the keyless one was fixed, so behind a proxy every
// search went around it and failed "fetch failed".
export function runJob(job, { timeout = DEFAULT_TIMEOUT, spawn = spawnSync, nodePath = process.execPath, env = process.env } = {}) {
  const result = spawn(nodePath, [SELF], {
    input: JSON.stringify(job),
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: fetchEnv(env),
    maxBuffer: CHILD_OUTPUT_LIMIT,
  });
  // A child that outlived its timeout is the vendor not answering; say that, not "spawnSync ETIMEDOUT"
  // (found 2026-09-27 on a real run, where it named a node binary instead of SerpAPI).
  if (result.error?.code === 'ETIMEDOUT') return { ok: false, error: `SerpAPI did not answer within ${timeout / 1000}s - the request was abandoned; a retry may succeed` };
  const overflow = outputOverflow(result, 'SerpAPI');
  if (overflow) return { ok: false, error: overflow };
  if (result.error) return { ok: false, error: result.error.message };
  const text = String(result.stdout ?? '').trim();
  if (!text) return { ok: false, error: String(result.stderr || 'serpapi transport produced no output').trim() };
  try {
    return JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `serpapi transport emitted unparseable output: ${err.message}` };
  }
}

// ---------------------------------------------------------------- payload

/**
 * `organic_results[]` -> the kit's existing result shape.
 *
 * `link` and `snippet` are this vendor's names for what the kit calls `url` and
 * `description`; the rest already line up. Rows with no link are dropped rather than
 * carried as empty strings - a candidate the collector cannot fetch is not a candidate.
 */
export function normalizeSearch(payload) {
  const rows = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
  // A malformed row is dropped, and a field of the wrong type read as empty: one null row
  // threw and took every valid result with it (Arena break test 9, 2026-09-28).
  const text = (value) => (typeof value === 'string' ? value : '');
  return rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row)).map((row) => ({
    url: text(row.link) || text(row.url),
    title: text(row.title),
    description: text(row.snippet) || text(row.description),
    position: Number.isFinite(row.position) ? row.position : null,
  })).filter((row) => row.url);
}

/**
 * The vendor's own handle for a response.
 *
 * Recorded because it is the only way to reconcile this kit's count against SerpAPI's
 * meter. The payload carries no cost field - `search_metadata` is id, status,
 * json_endpoint and total_time_taken - so the count is ours to keep (DR-5, DR-6).
 */
export function searchId(payload) {
  const id = payload?.search_metadata?.id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * What a call cost, by the vendor's stated rule rather than by inspecting the payload.
 *
 * One successful response is one search whatever it returns. The honest limit: a
 * response served from SerpAPI's free 1-hour cache costs nothing and is NOT
 * distinguishable from a fresh one in anything the payload carries, so this over-counts
 * on a repeat. Over-counting a free tier is the safe direction to be wrong in.
 */
export function searchesUsed(payload) {
  return payload && !payload.error ? 1 : 0;
}

/**
 * A display-only rendering. Nothing executes it, and it never carries the key.
 *
 * The shape deliberately mirrors what `command()` produces for the CLI adapters so the
 * ledger's `cmd` annotation and `--dry-run` output read the same whichever provider ran.
 */
/**
 * The exact request, as a URL. Every parameter this kit sends is decided here.
 *
 * Exported so the request shape is TESTABLE rather than buried in the child. Three
 * project defects have come from assuming a vendor parameter, and the guarantee worth
 * pinning is negative: `no_cache` and `async` are never sent, because their defaults are
 * what we want and the free 1-hour cache is only served when the query and ALL
 * parameters match exactly (E-09). There is no result-count parameter for the same
 * reason there is no throttle - none is documented, and `limit` costs nothing to apply
 * at home.
 *
 * The one string in this system that carries the credential. It is built in the child
 * and never returned to the parent.
 */
export function requestUrl(query, apiKey, endpoint = ENDPOINT) {
  const url = new URL(endpoint);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', String(query ?? ''));
  url.searchParams.set('api_key', String(apiKey ?? ''));
  return url;
}

/**
 * Where this module is willing to send a credential.
 *
 * The endpoint is overridable so the whole path - parent, child, real HTTP, real JSON -
 * can be driven against a local stand-in server instead of being exercised once by hand
 * and called verified. But an overridable endpoint on a request that carries an API key
 * is a way to exfiltrate one, so the override is not open: the vendor's own host, or a
 * loopback address. Anything else is refused by name.
 *
 * Checked in BOTH halves. The parent refuses before spawning, and the child refuses
 * before fetching, because the child is a separate program that reads a job off a pipe
 * and should not trust it.
 */
export function allowedEndpoint(endpoint) {
  let url;
  try { url = new URL(String(endpoint)); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.protocol === 'https:' && url.host === new URL(ENDPOINT).host) return true;
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
    || url.hostname === '127.0.0.1';
}

/** The account request. Like `requestUrl`, the only other string that carries the key. */
export function accountUrl(apiKey, endpoint = ACCOUNT_ENDPOINT) {
  const url = new URL(endpoint);
  url.searchParams.set('api_key', String(apiKey ?? ''));
  return url;
}

/**
 * `account.json` -> the meter, by WHITELIST.
 *
 * The payload carries `account_email`, `account_id` and, in the documented example, the
 * `api_key` itself. Nothing here copies a field it does not name, so none of those can reach
 * a terminal or a log. Names follow the vendor's documentation (E-26); a missing or
 * non-numeric field is `null`, never a guess.
 */
export function normalizeAccount(payload) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v) => (typeof v === 'string' && v ? v : null);
  return {
    plan: str(payload?.plan_name),
    perMonth: num(payload?.searches_per_month),
    perHour: num(payload?.account_rate_limit_per_hour),
    usedThisCycle: num(payload?.this_month_usage),
    left: num(payload?.total_searches_left ?? payload?.plan_searches_left),
    thisHour: num(payload?.this_hour_searches),
    // `null` for accounts without an active monthly plan (E-26).
    renews: str(payload?.plan_renewal_date),
  };
}

/**
 * The vendor's own meter: `{ ok, source, account, error }`, and never a throw (IR-6).
 *
 * Why it exists (U-9, U-10, U-11; ADR-0040): the kit's local count cannot see other machines,
 * counts a calendar month where SerpAPI counts a billing cycle, and can only quote the
 * documented caps - while this account's enforced hourly limit was measured at 250, not the
 * documented 50. The vendor answers all three for free, uncounted.
 */
export function account({
  env = process.env,
  config = undefined,
  key = null,
  timeout = ACCOUNT_TIMEOUT,
  endpoint = env[ACCOUNT_ENDPOINT_ENV] || ACCOUNT_ENDPOINT,
  job = runJob,
} = {}) {
  const source = 'serpapi.com/account.json';
  const apiKey = key ?? readKey({ env, config: config === undefined ? loadConfig(env) : config });
  const fail = (error) => ({ ok: false, source, account: null, error: redact(error, apiKey) });

  if (!allowedEndpoint(endpoint)) {
    return fail(`refusing to send a SerpAPI key to "${endpoint}". The endpoint may be the vendor's `
      + 'own host or a loopback address (for tests), and nothing else.');
  }
  if (!apiKey) return fail(`no SerpAPI key: set ${KEY_ENV} or the machine config's ${CONFIG_KEY}`);

  const answer = job({ kind: 'serpapi-account', apiKey, timeout, endpoint }, { timeout, env });
  if (!answer?.ok) return fail(answer?.error || 'serpapi account request failed');
  const payload = answer.payload;
  if (!payload || typeof payload !== 'object') return fail('serpapi account request returned no payload');
  if (typeof payload.error === 'string') return fail(payload.error);
  return { ok: true, source, account: normalizeAccount(payload), error: null };
}

export function command(query, key = '') {
  // Defence in depth for the case `search()` refuses outright: if the query itself holds
  // the credential, this string must still not carry it. `cmd` is written into the
  // hash-chained ledger, which is a COMMITTED file - it is the last place a secret may
  // reach, and the hardest to take back once it has.
  const shown = redact(String(query), key);
  return `GET ${ENDPOINT}?engine=google&q=${encodeURIComponent(shown)}&api_key=***REDACTED***`;
}

// ---------------------------------------------------------------- the contract

/**
 * `search(query, opts)` -> `{ ok, query, results[], error, cmd, provider, searchId }`.
 *
 * Every failure path returns rather than throws (IR-6). A search provider that can end a
 * run with an exception is worse than no search provider: the collector holds the corpus
 * lock while it works (ADR-0025).
 */
export function search(query, {
  limit = 8,
  env = process.env,
  // `undefined` (the default) reads the machine config, as `selectSearch` does - so a key
  // that selected this provider is the key it searches with. Found 2026-09-26: this
  // defaulted to `null`, and a key held only in the config selected SerpAPI and then failed
  // every search "no SerpAPI key". An explicit `null` still means "no config".
  config = undefined,
  key = null,
  timeout = DEFAULT_TIMEOUT,
  endpoint = ENDPOINT,
  job = runJob,
} = {}) {
  const text = String(query);
  const apiKey = key ?? readKey({ env, config: config === undefined ? loadConfig(env) : config });
  const cmd = command(text, apiKey);

  if (!allowedEndpoint(endpoint)) {
    return { ok: false, query: text, results: [], cmd, provider: name, searchId: null,
      error: `refusing to send a SerpAPI key to "${endpoint}". The endpoint may be the vendor's `
        + 'own host or a loopback address (for tests), and nothing else.' };
  }

  if (!apiKey) {
    return { ok: false, query: text, results: [], cmd, provider: name, searchId: null,
      error: `no SerpAPI key: set ${KEY_ENV} or the machine config's ${CONFIG_KEY}` };
  }

  // A query that CONTAINS the credential is refused before it is transmitted.
  //
  // Found by the Phase C suite, which asked whether any field of any result could carry
  // the key and discovered that one could: `cmd` interpolates the query, and `cmd` is
  // written into the hash-chained ledger - a committed file.
  //
  // Redacting `cmd` alone would have been the small fix and the wrong one. Sending the
  // request is the worse half: the key would become a Google search term, stored on the
  // vendor's systems for 31 days (E-10) and carried through whatever logs sit between.
  // A key pasted into a query box is a mistake that has already happened; the useful
  // thing to do is stop it leaving the machine and say so.
  if (apiKey.length >= 8 && text.includes(apiKey)) {
    return {
      ok: false, query: '[query withheld: it contained your API key]', results: [], cmd,
      provider: name, searchId: null,
      error: 'refusing to search for a string that contains your SerpAPI key. '
        + 'Sending it would store your credential as a search term on the vendor\'s systems. '
        + 'Nothing was transmitted; check what was pasted into the query.',
    };
  }

  const answer = job({ kind: 'serpapi-search', query: text, apiKey, timeout, endpoint }, { timeout, env });
  const scrub = (value) => redact(value, apiKey);

  if (!answer.ok) {
    return { ok: false, query: text, results: [], cmd, provider: name, searchId: null,
      error: scrub(answer.error || 'serpapi request failed') };
  }

  const payload = answer.payload;
  // Documented: "If a search has failed, `error` will contain an error message." This is
  // also how an exhausted monthly allowance arrives - a normal outcome, not a crash.
  if (payload && typeof payload.error === 'string' && payload.error) {
    return { ok: false, query: text, results: [], cmd, provider: name, searchId: searchId(payload),
      error: scrub(payload.error) };
  }

  const results = normalizeSearch(payload);
  return {
    ok: true,
    query: text,
    cmd,
    provider: name,
    searchId: searchId(payload),
    searchesUsed: searchesUsed(payload),
    // No result-count parameter is sent (IR-4); the cap is applied here.
    results: limit > 0 ? results.slice(0, limit) : results,
  };
}

/**
 * Credential presence, answered WITHOUT a network call.
 *
 * SerpAPI does publish an account endpoint, but it is not in the reference this project
 * captured, and this kit does not call undocumented endpoints. So this reports what it
 * can actually know - whether a key is configured and where it came from - and says
 * nothing about the remaining monthly allowance rather than guessing at it.
 */
export function status({ env = process.env, config = null } = {}) {
  const fromEnv = typeof env[KEY_ENV] === 'string' && env[KEY_ENV].trim() ? KEY_ENV : '';
  const fromConfig = config && typeof config[CONFIG_KEY] === 'string' && config[CONFIG_KEY].trim() ? `config.${CONFIG_KEY}` : '';
  const source = fromEnv || fromConfig || '';
  return {
    ok: true,
    transport: name,
    authenticated: Boolean(source),
    source,
    // status() stays offline: the vendor's own count is `account()`'s job (E-26, ADR-0040),
    // and a status probe that made a network call would change what every caller spends.
    searchesRemaining: null,
    raw: source
      ? `serpapi: key configured via ${source}; the vendor's own count is read by account() from serpapi.com/account.json (E-26)`
      : `serpapi: no key (set ${KEY_ENV} or the machine config's ${CONFIG_KEY})`,
  };
}

/**
 * The refusal that makes AR-3 real.
 *
 * Asked to fetch, this module answers with the reason instead of a missing-function
 * TypeError. A `TypeError: adapter.scrape is not a function` three frames deep tells an
 * operator nothing about why; this tells them.
 */
function cannotFetch(op) {
  const err = new Error(
    `${name} is a search-only provider and cannot ${op}. It is selected for the SEARCH side only; `
    + `the fetch side stays on a provider that produces captures (see --transport).`);
  err.code = 'SEARCH_ONLY_PROVIDER';
  throw err;
}

export const scrape = () => cannotFetch('scrape');
export const runScrape = () => cannotFetch('scrape');
export const map = () => cannotFetch('map');

export default { name, search, status, account, command, CONTRACTS };

// ---------------------------------------------------------------- the child half

/**
 * When this file is the process entry point it IS the job runner: read one JSON job on
 * stdin, do the async work, print one JSON line.
 *
 * The URL - the only string in this system that contains the key - is built HERE, in the
 * child, and never returned. The parent holds the key but never a rendered request, so
 * no display path can leak one by accident.
 */
async function child() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let job;
  try {
    job = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: `unparseable job: ${err.message}` }));
    return;
  }
  if (job.kind !== 'serpapi-search' && job.kind !== 'serpapi-account') {
    process.stdout.write(JSON.stringify({ ok: false, error: `unknown job kind "${job.kind}"` }));
    return;
  }

  // The child re-checks rather than trusting the job it read off a pipe. It is a
  // separate program, and the thing it is about to do is send a credential somewhere.
  const endpoint = job.endpoint ?? ENDPOINT;
  if (!allowedEndpoint(endpoint)) {
    process.stdout.write(JSON.stringify({ ok: false, error: `refusing to send a key to "${endpoint}"` }));
    return;
  }
  const url = job.kind === 'serpapi-account'
    ? accountUrl(job.apiKey, endpoint)
    : requestUrl(job.query, job.apiKey, endpoint);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(job.timeout ?? DEFAULT_TIMEOUT),
    });
    // Bounded before it is parsed, as the keyless page is (Arena break test 9): the child
    // output limit bounds what reaches the parent, not what this child downloads.
    const body = await boundedText(response, 'the SerpAPI response');
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch {
      process.stdout.write(JSON.stringify({
        ok: false,
        statusCode: response.status,
        error: `serpapi returned HTTP ${response.status} with a non-JSON body (${body.length} bytes)`,
      }));
      return;
    }
    // A non-200 carrying a documented `error` is handed up as a payload so the parent
    // reports the vendor's own words; a non-200 with no error key is an HTTP failure.
    if (!response.ok && !(payload && typeof payload.error === 'string')) {
      process.stdout.write(JSON.stringify({ ok: false, statusCode: response.status, error: `serpapi returned HTTP ${response.status}` }));
      return;
    }
    process.stdout.write(JSON.stringify({ ok: true, statusCode: response.status, payload }));
  } catch (err) {
    // `err.message` can contain the request URL, and the request URL contains the key;
    // fetchFailure cuts a URL in the cause to its host.
    // The parent redacts on receipt; this keeps the child from being the one that leaks.
    process.stdout.write(JSON.stringify({ ok: false, error: fetchFailure(err) }));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await child();
}
