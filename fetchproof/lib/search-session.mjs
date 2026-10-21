// search-session.mjs - one search session asks the providers, for every coordinator (ADR-0135).
//
// The ONE owner of how a query is put to the search providers: every provider under a merge
// (interleaved by rank and attributed), otherwise the one provider with one bounded degrade
// to the fetch provider's own search, unless the operator chose that provider by name; the
// rate-limit patience; the meters (`searchesUsed`, `searchesOn`, `searchCreditsEstimate`,
// `searchFailures`, `searchFailuresOn`, `degraded`); one failure row per failed ask, handed
// to the coordinator's sink; and the refusal of a provider that cannot run, before anything
// is spent.
//
// `runResearch` (phase 1) and `decompose` (phase 0) each carried a copy of this loop, and
// read side by side on 2026-10-03 the copies had drifted in six places - a failed ask
// counted in one and not the other, a usage label spelled two ways, a refusal one had and
// one lacked (ADR-0135 lists them). What the coordinator makes of an answer - which results
// become targets, which are material, what an empty answer means - stays the coordinator's.

import { sleepSync } from './core.mjs';
import * as firecrawl from './firecrawl.mjs';
import { canSearch } from './transport.mjs';
import { fallbackCost } from './runtime.mjs';

/**
 * Interleave several providers' results by RANK, not by concatenation.
 *
 * WHY RANK AND NOT ORDER. On 2026-09-22 a search for the EU Deforestation Regulation
 * returned, from one provider, eight pages about US financial regulation and nothing about
 * the subject - while the other returned seventeen, all on topic. Concatenating would have
 * let the failing provider spend the entire page budget before the working one was reached.
 * Round-robin bounds that: each provider contributes its best result, then its second, and
 * a provider that is wholly wrong costs at most its share.
 *
 * `provider` is carried on every row so the ledger records WHICH search surfaced a URL -
 * that is how a claim about search quality stays checkable afterwards instead of being an
 * impression.
 *
 * EVERY finder is recorded, not the first one. The initial version credited whichever
 * provider came first in the round - always the same one, since the order is fixed - and
 * its comment claimed that agreement therefore did not inflate the count. It did, and a
 * live run proved it: sixteen results, nine distinct, so seven URLs were returned by both
 * and all seven were attributed to the provider that happened to be asked first. Six of
 * eight collected rows then read as that provider's finds.
 *
 * That is provenance which reads as a measurement and is really an artefact of loop order -
 * precisely the kind of number this repository keeps catching itself quoting. `provider` is
 * the first finder, `providers` is all of them, and a row both returned says so.
 */
export function mergeByRank(lists) {
  const merged = [];
  const at = new Map();
  const depth = Math.max(0, ...lists.map((l) => l.results.length));
  for (let rank = 0; rank < depth; rank += 1) {
    for (const list of lists) {
      const row = list.results[rank];
      if (!row?.url) continue;
      const already = at.get(row.url);
      if (already) {
        if (!already.providers.includes(list.provider)) already.providers.push(list.provider);
        continue;
      }
      const entry = { ...row, provider: list.provider, providers: [list.provider] };
      at.set(row.url, entry);
      merged.push(entry);
    }
  }
  // A URL every provider returned is not evidence that the first one found it. Rows the
  // others also returned later in their own lists are folded here too, not only at the
  // same rank.
  for (const list of lists) {
    for (const row of list.results) {
      const entry = row?.url ? at.get(row.url) : null;
      if (entry && !entry.providers.includes(list.provider)) entry.providers.push(list.provider);
    }
  }
  return merged;
}

/**
 * One search, with the patience the fetch side already had (`collectOne`).
 *
 * A rate limit is an instruction to wait, not a failure. Measured 2026-09-26: the 11th and
 * 12th Firecrawl searches inside a minute came back "Rate limit exceeded ... retry after
 * 5s" - E-01's documented 10 /search per minute - and a run logged them as failures and
 * moved on, so a plan with more than ten queries lost the rest of that minute's searches.
 *
 * The vendor's own delay is used (`rateLimitWaitMs`), and the retries are bounded: a
 * provider that keeps refusing is a different problem from a busy minute, and this runs
 * under the corpus lock. Anything that is not a rate limit returns at once, so a 404 or an
 * outage still costs exactly one call and still reaches the fallback and the failure log.
 */
/** A thrown value as text, for a value whose own rendering throws (a Symbol, a poisoned getter). */
function thrownText(err) {
  try { return String(err?.message ?? err); } catch { return 'a value that cannot be rendered as text'; }
}

/**
 * `limited` is a Set the caller keeps for one run, of the providers that ran out of rate-limit
 * retries: one in it is asked once and not waited for, until it answers - so the waits do not
 * add up per query (review of #313, 2026-10-18: ten queries to a provider answering a bare 429
 * slept twenty minutes).
 */
export function searchPatiently(provider, text, { limit, maxRateLimitRetries = 2, sleep = sleepSync, log = () => {}, limited = null } = {}) {
  // A fetch-only transport (the browser, ADR-0088) is a failed search, said in words - never a
  // TypeError ending the run (found 2026-10-01, break-test).
  if (!canSearch(provider)) return { ok: false, query: text, results: [], error: `${provider?.name ?? 'this transport'} fetches pages but does not search` };
  let lastTry = false;
  let waits = 0;
  for (let attempt = 0; ; attempt += 1) {
    let r;
    try {
      r = provider.search(text, { limit });
    } catch (err) {
      // Every adapter returns its failures by contract, so a throw is one of their bugs - an
      // unguarded parse of a vendor payload - and the kit cannot prevent it. Kept as a failed
      // search that says it was a throw: re-thrown, it ended the run, and the searches paid
      // for before it never reached the usage row, which is written at the end (found
      // 2026-10-03, probing). A throw is not a rate limit, so it is not retried.
      return { ok: false, query: text, results: [], error: `${provider.name} threw: ${thrownText(err)}` };
    }
    // Search adapters are synchronous (`searchSession` runs under the corpus lock, and every
    // coordinator reads the answer as it returns). An adapter that returns a Promise - an
    // `async search()` - reached the `r?.ok` test as a failure with no error text, and when it
    // rejected, the rejection nobody awaited ended the process after all: the very ending the
    // throw guard above exists to prevent (found 2026-10-03, review of that guard).
    if (typeof r?.then === 'function') {
      Promise.resolve(r).catch(() => {});
      return { ok: false, query: text, results: [], error: `${provider.name} returned a Promise - search adapters are synchronous, and its answer was not waited for` };
    }
    if (r?.ok) { limited?.delete(provider.name); return r; }
    // The provider's own `retryAfterMs` first - the keyless route reads Retry-After (#313) -
    // then the vendor's text; a server that asked past the cap is asked once more, not again.
    const wait = firecrawl.retryWaitMs(r);
    if (attempt >= maxRateLimitRetries || lastTry) {
      if (waits && wait !== null) limited?.add(provider.name);
      return r;
    }
    if (wait === null) return r;
    if (limited?.has(provider.name)) {
      log(`  not waiting - ${provider.name} already ran out of rate-limit retries in this run`);
      return r;
    }
    waits += 1;
    lastTry = r?.retryAfterCapped === true;
    log(`  waiting    ${Math.round(wait / 1000)}s - ${provider.name} search hit the vendor rate limit`);
    sleep(wait);
  }
}

/**
 * What a coordinator may receive as a result list: an array, each row an object. A `null`
 * row from a provider ended both coordinators with a TypeError on `row.url`, and a list that
 * was not an array ended research's `noteOutcome` on `.some` (found 2026-10-03, probing).
 * Whether a row's URL is usable stays the coordinator's question (`isWebUrl`,
 * `selectCandidates`); this only keeps the shape every reader of a row assumes.
 */
export function resultRows(results) {
  return Array.isArray(results) ? results.filter((row) => row !== null && typeof row === 'object') : [];
}

/**
 * The session for one run: the providers it may ask, how patiently, where its lines and
 * its failure rows go, and - when the coordinator has one - the credits policy that says
 * which provider serves a call after the paying one ran dry (ADR-0133).
 *
 * `askOne` is the one patient call; a coordinator that also hands it to `creditsPolicy`
 * passes the same function here, so the policy and the session ask the same way. Left out,
 * the session builds it from `limit`, `maxRateLimitRetries` and `sleep`.
 *
 * `record` receives one object per failed ask: `{ query, error, provider }`, with
 * `degraded: true, fellBackTo` when the fetch provider is asked next and `covered: true`
 * when another provider of a merge answered the query. The object is handed over at once -
 * so a failure log keeps its chronology beside a `credits-exhausted` row written in the
 * middle of a merge - and gains `covered` afterwards, once the merge knows.
 */
export function searchSession({
  adapter = null,
  // The SEARCH side (ADR-0027). Absent means "the fetch adapter", which is what every
  // caller did before the split - so an un-updated caller behaves exactly as before.
  searchAdapter = null,
  // Several providers: asked in parallel and interleaved by rank. One stays one.
  searchAdapters = null,
  // The search provider was named by the operator (`selectSearch`'s `explicit`): a failure on
  // it is a failed search, never degraded to the fetch provider's own (#317, ADR-0033).
  searchExplicit = false,
  limit,
  maxRateLimitRetries = 2,
  sleep = sleepSync,
  log = () => {},
  record = () => {},
  credits = null,
  askOne = null,
} = {}) {
  const providers = (searchAdapters ?? []).filter(Boolean);
  const searcher = searchAdapter ?? providers[0] ?? adapter;
  // The paying provider names the search side, under a merge too (ADR-0027): `searchesOn`
  // carries every meter a merge spent on, and the live test pins the label.
  const name = searcher?.name ?? adapter?.name ?? '';
  // The dry run's label: a merge names every provider whose meter it would spend.
  const meter = providers.length > 1 ? providers.map((one) => one.name).join(' + ') : name;

  const limited = new Set();
  const patient = askOne ?? ((provider, text) => searchPatiently(provider, text, { limit, maxRateLimitRetries, sleep, log, limited }));
  // With a credits policy, the policy decides which provider serves the call and switches
  // once on exhaustion (`askLive`); without one, the provider asked is the provider named.
  const askProvider = (provider, text) => (credits ? credits.askLive(provider, text) : { r: patient(provider, text), provider });
  const liveAdapter = () => (credits ? credits.live(adapter) : adapter);

  // The search side keeps its OWN counters, because it is a separate meter and a summary
  // that merged them with the fetch side's would hide the whole point of the split.
  let searchesUsed = 0;
  // The same searches, by the provider that PAID for them. `searchesUsed` is their sum, and
  // under a merge it was logged against one provider's name: one query on SerpAPI and
  // Firecrawl read as two SerpAPI searches, charged to its free-plan meter (found
  // 2026-09-28, end-to-end run).
  const searchesOn = {};
  let searchCreditsEstimate = 0;
  let searchFailures = 0;
  // The same failures, by provider. `searchFailures` mixes providers, so it cannot say
  // whether the meter the summary reports on was the one that failed (RR-7).
  const searchFailuresOn = {};
  let degraded = 0;

  // ONE accounting rule (ADR-0135): what the adapter reports is counted on that provider's
  // meter for every ask, succeeded or failed - the vendor charged for it either way - and
  // every failed ask is one failure, on its provider.
  const count = (provider, r) => {
    const used = r?.searchesUsed;
    if (Number.isFinite(used)) {
      searchesUsed += used;
      if (used) searchesOn[provider] = (searchesOn[provider] ?? 0) + used;
    }
    if (Number.isFinite(r?.creditsEstimate)) searchCreditsEstimate += r.creditsEstimate;
  };
  const fail = (provider, query, error, extra = {}) => {
    searchFailures += 1;
    searchFailuresOn[provider] = (searchFailuresOn[provider] ?? 0) + 1;
    const row = { query, error, provider, ...extra };
    record(row);
    return row;
  };

  /**
   * A search provider that cannot run refuses here, before anything is spent. The selection
   * REPORTS the problem rather than throwing (`notReady`), so --dry-run and doctor can
   * describe it; the refusal belongs where the money is.
   */
  function assertReady() {
    // Every provider the session may ask, not only the search side: a merge whose partner
    // could not run would have failed on it, covered, on every query (2026-10-03, probing).
    for (const one of [searchAdapter, ...providers]) {
      if (!one?.notReady) continue;
      const err = new Error(one.notReady);
      err.code = 'SEARCH_PROVIDER_NOT_READY';
      throw err;
    }
  }

  // MORE THAN ONE PROVIDER: ask each, interleave by rank, and attribute every row. The
  // meters are genuinely separate (ADR-0027), so this costs one search on each rather than
  // more of either. A provider that fails here does not stop the run - the others still
  // contribute, and the failure is recorded like any other.
  function askAll(text) {
    const lists = [];
    const misses = [];
    for (const planned of providers) {
      const { r, provider } = askProvider(planned, text);
      count(provider.name, r);
      if (!r?.ok) {
        log(`  search failed on ${provider.name}: ${r?.error}`);
        misses.push(fail(provider.name, text, r?.error));
        continue;
      }
      lists.push({ provider: provider.name, results: resultRows(r.results) });
    }
    // A provider that missed a query another one answered is recorded, but the query is
    // answered: `covered` keeps it out of the lost count (decompose's `searchSummary`).
    if (lists.length) for (const miss of misses) miss.covered = true;
    const names = providers.map((one) => one.name);
    if (!lists.length) {
      log(`  search failed on every provider: ${text}`);
      return { ok: false, query: text, results: [], provider: names.join('+'), providers: names, error: misses.map((m) => `${m.provider}: ${m.error}`).join('; ') };
    }
    const results = mergeByRank(lists);
    log(`  searched   ${lists.map((l) => `${l.provider} ${l.results.length}`).join(', ')} -> ${results.length} distinct`);
    const answered = lists.map((l) => l.provider);
    return { ok: true, query: text, results, provider: answered.join('+'), providers: answered, merged: true, searchId: null, degraded: false };
  }

  function askSingle(text) {
    const first = askProvider(searcher, text);
    let found = first.r;
    // A session built with no provider at all has nothing to ask: `searchPatiently` already
    // names the failure, and the name it uses is the one charged here, so a library caller
    // reads a failed search rather than a TypeError (found 2026-10-03, probing).
    let ranker = first.provider?.name ?? 'this transport';
    count(ranker, found);
    let fellBack = false;

    // A second meter is a second thing that can be down. One bounded fallback to the fetch
    // provider's own search (RR-1, RR-2): it keeps the run alive, it costs fetch credits,
    // and it is REPORTED rather than absorbed - a silent fallback is a bill the operator did
    // not know they were paying. Only to a provider that can search: degrading to the
    // browser replaced the real failure with a TypeError (found 2026-10-01).
    //
    // Not from a provider the operator chose by name (#317). RR-1 was written for a second
    // metered vendor going down; an explicit choice says where the queries may go, and for
    // SearXNG (ADR-0104) the fetch provider's search was DuckDuckGo-lite - the route it exists
    // to avoid. The failure is kept below, counted on the provider that failed.
    const target = liveAdapter();
    const degradable = !found?.ok && first.provider !== target && canSearch(target);
    if (degradable && searchExplicit) {
      log(`  search failed on ${ranker}: ${found?.error} - not degraded: ${ranker} was chosen explicitly`);
    }
    if (degradable && !searchExplicit) {
      log(`  search failed on ${ranker}: ${found?.error}`);
      fail(ranker, text, found?.error, { degraded: true, fellBackTo: target.name });
      const next = askProvider(adapter, text);
      log(`  degrading to ${next.provider.name} for this query - ${fallbackCost(next.provider.name)}`);
      found = next.r;
      ranker = next.provider.name;
      count(ranker, found);
      if (found?.ok) degraded += 1;
      fellBack = true;
    }

    if (!found?.ok) {
      // A failed search is kept, not just printed: a map or a run written after every
      // search failed looks exactly like one on a quiet topic.
      fail(ranker, text, found?.error);
      log(`  search failed: ${text} - ${found?.error}`);
      return { ok: false, query: text, results: [], provider: ranker, providers: [ranker], error: found?.error };
    }
    // Said per query: a run whose searches all came back empty printed only "collected 0,
    // failed 0", with nothing to say a search had run (found 2026-09-27). What an empty
    // answer means is the coordinator's to say.
    const results = resultRows(found.results);
    if (results.length) log(`  search     found ${results.length} for "${text}" (${ranker})`);
    return { ok: true, query: text, results, provider: ranker, providers: [ranker], merged: false, searchId: found.searchId ?? null, degraded: fellBack };
  }

  return {
    name,
    meter,
    providers,
    assertReady,
    ask: (text) => (providers.length > 1 ? askAll(text) : askSingle(text)),
    meters: () => ({
      searchesUsed, searchesOn: { ...searchesOn }, searchCreditsEstimate,
      searchFailures, searchFailuresOn: { ...searchFailuresOn }, degraded,
    }),
  };
}
