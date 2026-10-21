// transport.mjs - adapter selection (ADR-0005).
//
// The one reader of the operator's transport choice, in precedence order:
//   1. an explicit --transport
//   2. FETCHPROOF_TRANSPORT
//   3. the machine config's `transport` key
//   4. auto-detection: an authenticated or anonymous CLI wins, otherwise keyless
//
// It names no vendor beyond the two adapter keys.

import * as firecrawl from './firecrawl.mjs';
import * as httpKeyless from './http-transport.mjs';
import * as serpapi from './serpapi.mjs';
import * as searxng from './searxng.mjs';
import browser from './browser-transport.mjs';
import { loadConfig } from './machine.mjs';

export const TRANSPORTS = Object.freeze({
  'firecrawl-cli': firecrawl,
  'http-keyless': httpKeyless,
  // Fetch only, chosen only by name (ADR-0088): a local Chromium rendering the page.
  browser,
});

export const TRANSPORT_NAMES = Object.freeze(Object.keys(TRANSPORTS));

/**
 * Providers that satisfy the SEARCH contract only (ADR-0027).
 *
 * Deliberately a SECOND map rather than a third entry in `TRANSPORTS`. That map is the
 * set of things which satisfy the whole adapter shape; a search-only module in it makes
 * the shape a claim the map no longer keeps, and `--transport serpapi` would hand an
 * operator a run that cannot fetch - discovered at the first scrape rather than at
 * selection.
 */
export const SEARCH_PROVIDERS = Object.freeze({
  // Only the transports that search: the browser fetches and nothing else (ADR-0088).
  ...Object.fromEntries(Object.entries(TRANSPORTS).filter(([, adapter]) => typeof adapter.search === 'function')),
  serpapi,
  // A SearXNG instance the operator runs (ADR-0104). Explicit only: never chosen automatically.
  searxng,
});

export const SEARCH_PROVIDER_NAMES = Object.freeze(Object.keys(SEARCH_PROVIDERS));

/**
 * The two contracts, declared the way `ADAPTER_SHAPE` already is, so a test can hold a
 * module to one without the other.
 */
export const FETCH_SHAPE = Object.freeze(['name', 'scrape', 'runScrape', 'map', 'status', 'command']);
export const SEARCH_SHAPE = Object.freeze(['name', 'search']);

/** Does this module expose a contract's functions? The shape tests ask this. */
export function satisfies(adapter, shape) {
  if (!adapter) return false;
  return shape.every((fn) => (fn === 'name' ? typeof adapter.name === 'string' : typeof adapter[fn] === 'function'));
}

/**
 * Is this module search-only?
 *
 * A DECLARATION, not a duck-type. `serpapi.mjs` exports `scrape` and `map` on purpose -
 * they throw a named refusal instead of letting a caller hit
 * `TypeError: adapter.scrape is not a function` three frames down (AR-3). That makes
 * "has a scrape function" useless as a capability test, and the first version of this
 * helper got it exactly wrong by asking that question.
 *
 * So: a module that declares `CONTRACTS` is taken at its word. The two that predate the
 * split declare nothing and are duck-typed, which for them is still correct.
 */
/** Whether a transport can search: the browser fetches only (ADR-0088). */
// A Firecrawl CLI with no key has a search function and no search: Firecrawl refuses it
// (CLI 1.24.6, 2026-10-01), so a fallback to it only adds a second failure. Here beside
// `isSearchOnly` because both are a transport's own capability, asked of any provider.
export const canSearch = (provider) => typeof provider?.search === 'function' && provider?.name !== firecrawl.ANONYMOUS_NAME;

export function isSearchOnly(adapter) {
  if (Array.isArray(adapter?.CONTRACTS)) {
    return adapter.CONTRACTS.includes('search') && !adapter.CONTRACTS.includes('fetch');
  }
  return satisfies(adapter, SEARCH_SHAPE) && !satisfies(adapter, FETCH_SHAPE);
}

/**
 * Is the CLI there, and does it answer? Injectable so doctor's tests need no CLI.
 *
 * Two costs were paid here that did not need paying. `cliVersion()` spawned the CLI to
 * learn something a PATH lookup already knows, and every caller probed independently -
 * `doctor` asked once itself and then handed the same probe to `selectTransport`, which
 * asked again. Four spawns, measured at 19.5s on this machine, on a command that reports
 * health. Presence is now a filesystem question and the answer is memoised per process.
 */
let probeCache = null;

export function probeFirecrawl({ cliVersion = null, status = firecrawl.status, resolve = firecrawl.resolveProgramPath, cache = true } = {}) {
  if (cache && probeCache) return probeCache;

  const present = cliVersion ? cliVersion() : resolve();
  if (!present) {
    const absent = { installed: false, authenticated: false, version: null, credits: null };
    if (cache) probeCache = absent;
    return absent;
  }

  const state = status();
  const result = {
    installed: true,
    authenticated: Boolean(state.authenticated),
    // `--status` prints the version, so the separate `--version` spawn bought nothing.
    // When a caller injects `cliVersion` (the tests do), that answer wins.
    version: (cliVersion ? present : null) ?? state.version ?? null,
    credits: state.credits ?? null,
    creditLimit: state.creditLimit ?? null,
    concurrencyLimit: state.concurrencyLimit ?? null,
    path: cliVersion ? null : present,
  };
  if (cache) probeCache = result;
  return result;
}

/** Tests and long-lived processes need to be able to ask again. */
export function forgetProbe() {
  probeCache = null;
}

/**
 * `selectTransport({ explicit, env, probe })` -> `{ name, adapter, why, search }`.
 *
 * `name`, `adapter` and `why` mean exactly what they have always meant: the FETCH
 * provider, the one that produces captures. `search` is additive (ADR-0027, NFR-2) -
 * that is the whole reason six existing call sites did not have to change.
 *
 * An explicit name that is not an adapter is an error naming the ones that are.
 */
export function selectTransport({ explicit = '', env = process.env, probe = probeFirecrawl, config = null,
  explicitSearch = '' } = {}) {
  const settings = config ?? loadConfig(env);
  const fetchSide = selectFetch({ explicit, env, probe, config: settings });
  return {
    ...fetchSide,
    search: selectSearch({ explicit: explicitSearch, env, config: settings, fetchSide }),
  };
}

/**
 * A Firecrawl key that this run will not use, said at collection time - or ''.
 *
 * The kit never reads FIRECRAWL_API_KEY itself: the CLI does. With the key set and no CLI
 * on PATH, auto-detect falls back to the keyless adapter, capped per IP, and the run said
 * only "no CLI on PATH" (found 2026-09-27). Only doctor named the unused key. A fallback
 * the operator asked for by name (`--transport http-keyless`) is their choice, not news.
 */
export function unusedKeyNote(chosen, env = process.env) {
  if (!env.FIRECRAWL_API_KEY || !chosen?.probe || chosen.probe.installed) return '';
  return `note:      FIRECRAWL_API_KEY is set, but the Firecrawl CLI is not on PATH - the key is unused and this run is keyless, capped per IP.\n`
    + `           To use the key: npm install -g ${firecrawl.cliInstallSpec()}\n`;
}

/**
 * The metered search provider's credential, for a surface that must not name the vendor
 * (the desktop panel, ADR-0147). The registry is the one place besides the adapter that may.
 * `state` says whether a key is set and where it came from, never the key itself.
 */
export const SEARCH_KEY = Object.freeze({
  env: serpapi.KEY_ENV,
  configKey: serpapi.CONFIG_KEY,
  read: (env = process.env, config = null) => serpapi.readKey({ env, config }),
  state(env = process.env, config = null) {
    const fromEnv = typeof env[serpapi.KEY_ENV] === 'string' && env[serpapi.KEY_ENV].trim() !== '';
    const key = serpapi.readKey({ env, config });
    return { set: Boolean(key), source: fromEnv ? 'environment' : (key ? 'config' : '') };
  },
  redact: (text, key) => serpapi.redact(text, key),
});

/**
 * The SEARCH side, resolved independently and by the same ladder: explicit flag,
 * environment, machine config, then auto-detect.
 *
 * Auto-detect has exactly one rule, and it is the conservative one (FR-5): a SerpAPI key
 * wins, otherwise the search side IS the fetch provider. With no key configured, nothing
 * about a run changes. An opt-in that alters the default is not an opt-in.
 */
export function selectSearch({ explicit = '', env = process.env, config = null, fetchSide = null,
  probe = probeFirecrawl } = {}) {
  const settings = config ?? loadConfig(env);
  const side = fetchSide ?? selectFetch({ env, probe, config: settings });
  const asked = explicit || env.FETCHPROOF_SEARCH_TRANSPORT || settings.searchTransport || '';
  // A fetch provider that cannot search: a fetch-only transport (the browser), or a Firecrawl
  // CLI with no key, which Firecrawl still lets scrape but no longer lets search ("Alexandria
  // requires a Firecrawl API key with access enabled.", CLI 1.24.6, found 2026-10-01 by a cold
  // trial: every search of a fresh keyless project failed). The keyless route searches for it.
  const searchless = typeof side.adapter?.search !== 'function' ? `${side.name} does not search`
    : side.name === firecrawl.ANONYMOUS_NAME ? `${side.name} cannot search without a key` : '';

  if (asked) {
    const adapter = Object.hasOwn(SEARCH_PROVIDERS, asked) ? SEARCH_PROVIDERS[asked] : undefined;
    if (!adapter) {
      const err = new Error(`unknown search provider "${asked}". Known search providers: ${SEARCH_PROVIDER_NAMES.join(', ')}`);
      err.code = 'UNKNOWN_SEARCH_PROVIDER';
      throw err;
    }
    const why = explicit
      ? '--search-transport'
      : (env.FETCHPROOF_SEARCH_TRANSPORT ? 'FETCHPROOF_SEARCH_TRANSPORT' : 'machine config');

    // Selection answers WHICH provider. It also reports whether that provider can RUN -
    // and reports rather than throws, deliberately.
    //
    // Automatic selection below only reaches SerpAPI when a key exists, so it could never
    // choose a provider that cannot run. An explicit choice skipped readiness entirely:
    // `--search-transport serpapi` with no key was accepted and failed later, during
    // collection, after a plan was built and - on some routes - after fetch credits were
    // spent.
    //
    // Throwing here was the first fix and it was wrong. `selectSearch` is also how
    // `--dry-run` and `doctor` ask what WOULD be used, and those must be able to say "no
    // key" rather than crash; three precedence tests failed precisely because they ask
    // which name wins and have no business supplying a key. So the unreadiness travels
    // with the selection, and `runResearch` refuses on it before spending.
    let notReady = adapter === serpapi && !serpapi.readKey({ env, config: settings })
      ? `${adapter.name} was selected by ${why}, but no SerpAPI key is configured. `
        + 'Set SERPAPI_API_KEY, or put serpapiKey in ~/.agents/fetchproof.config.json. '
        + 'Unset the explicit choice to let the kit pick a provider it can run.'
      : '';
    // The same, for an instance URL (ADR-0104): reported, never thrown, for the same reasons.
    if (adapter === searxng && !searxng.readUrl({ env, config: settings })) {
      notReady = `${adapter.name} was selected by ${why}, but no instance is configured. `
        + `Set ${searxng.URL_ENV}, or put ${searxng.CONFIG_KEY} in ~/.agents/fetchproof.config.json, `
        + 'to the URL of a SearXNG instance you run with json in its search.formats.';
    }
    // `explicit`: the operator named this provider, so it is where their queries may go. The
    // session keeps a failure on it rather than degrading the query to the fetch provider's
    // own search (#317) - for SearXNG that was DuckDuckGo-lite, the route it exists to avoid.
    return { name: adapter.name ?? asked, adapter, why, searchOnly: isSearchOnly(adapter), notReady, explicit: true };
  }

  if (serpapi.readKey({ env, config: settings })) {
    // BOTH, not one. The meters are separate, so asking each costs one search apiece rather
    // than more of either - and on 2026-09-22 that difference was the whole corpus: a query
    // about the EU Deforestation Regulation returned eight US financial-regulation pages
    // from SerpAPI and nothing on topic, while the fetch provider's own search returned
    // seventeen, all on topic. Either provider alone can fail that badly on a given query;
    // `mergeByRank` bounds the damage by letting each contribute its best result first.
    //
    // `adapter` still names the provider that pays the separate meter, so every existing
    // caller and every status line keeps meaning what it meant.
    // The partner must be able to search: a fetch-only transport (the browser) hands its
    // share to the keyless route, as the no-key branch below does. Put on the search side,
    // it crashed the first live browser run (2026-09-29).
    const partner = searchless ? httpKeyless : side.adapter;
    const partnerName = partner === side.adapter ? side.name : httpKeyless.name;
    return {
      name: serpapi.name,
      adapter: serpapi,
      adapters: [serpapi, partner],
      why: `a SerpAPI key is configured - searching on its own meter AND with ${partnerName}, merged by rank`,
      searchOnly: true,
      merged: true,
    };
  }

  // A fetch provider that cannot search hands its searches to the keyless route.
  if (searchless) {
    return {
      name: httpKeyless.name,
      adapter: httpKeyless,
      why: `${searchless} - searching with ${httpKeyless.name}`,
      searchOnly: false,
    };
  }
  return {
    name: side.name,
    adapter: side.adapter,
    why: 'no separate search provider configured - searching with the fetch provider, as before',
    searchOnly: false,
    sameAsFetch: true,
  };
}

/** The fetch side: what `selectTransport` has always returned. */
function selectFetch({ explicit = '', env = process.env, probe = probeFirecrawl, config = null } = {}) {
  const asked = explicit || env.FETCHPROOF_TRANSPORT || (config ?? loadConfig(env)).transport || '';
  if (asked) {
    const adapter = Object.hasOwn(TRANSPORTS, asked) ? TRANSPORTS[asked] : undefined;
    if (!adapter) {
      const err = new Error(`unknown transport "${asked}". Known transports: ${TRANSPORT_NAMES.join(', ')}`);
      err.code = 'UNKNOWN_TRANSPORT';
      throw err;
    }
    const why = explicit ? '--transport' : (env.FETCHPROOF_TRANSPORT ? 'FETCHPROOF_TRANSPORT' : 'machine config');
    return { name: asked, adapter, why };
  }

  const state = probe();
  if (state.installed) {
    // An ANONYMOUS CLI is not the metered transport, and must not be recorded as one.
    //
    // It scrapes - this machine proved it - but it is keyless access capped per IP
    // (E-01), so it is neither metered nor reliably reproducible. Stamping it
    // `firecrawl-cli` made those rows identical in the ledger to authenticated ones, and
    // `transport-provenance` treats that name as the good case: the one check whose job
    // is to say how a capture was fetched would have said "metered Firecrawl CLI" about a
    // fetch nobody paid for.
    const label = state.authenticated ? firecrawl.name : firecrawl.ANONYMOUS_NAME;
    return {
      name: label,
      adapter: labelled(firecrawl, label),
      why: state.authenticated ? 'the CLI is installed and authenticated' : 'the CLI is installed but NOT authenticated - anonymous, capped per IP',
      probe: state,
    };
  }
  return { name: httpKeyless.name, adapter: httpKeyless, why: 'no CLI on PATH - falling back to the keyless adapter', probe: state };
}

/**
 * Bind an adapter to the transport label that actually applies to this machine.
 *
 * The adapter stamps its own name because it is the thing that ran; the label narrows
 * that to the mode it ran in. Only the two functions that produce captures are bound -
 * search and map record nothing.
 */
function labelled(adapter, label) {
  if (label === adapter.name) return adapter;
  const stamp = (result) => (result && result.ok ? { ...result, transport: label } : result);
  return {
    ...adapter,
    name: label,
    scrape: (url, opts) => stamp(adapter.scrape(url, opts)),
    runScrape: (url, opts) => stamp(adapter.runScrape(url, opts)),
  };
}

export { firecrawl, httpKeyless, serpapi, browser };
