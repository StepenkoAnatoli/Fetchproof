// research-run.mjs - many URLs, one run.
//
// The coordinator: plan / query / url fan-out, discovery, candidate selection, budget
// tiers, cache policy. `collectOne` does the writing; this decides what to ask for.
//
// Every scrape spends a credit, so the budget is a first-class input: a tier caps the
// run, a cache hit is never an attempt, and `--dry-run` spends nothing.

import { PATHS, resolve, readJson, readText, today, hostOf, uniq, sleepSync, urlKey, operatorPath } from './core.mjs';
import * as firecrawl from './firecrawl.mjs';
import { readCorpus, cacheDecision, appendJsonLine } from './corpus.mjs';
import { assertAppendable } from './provenance.mjs';
import { collectOne, recentlyGone, DEFAULT_SOURCE_TYPE } from './collect.mjs';
import { creditsPolicy } from './credits.mjs';
import { searchSession, searchPatiently, mergeByRank } from './search-session.mjs';
import * as wayback from './witness.mjs';

// The asking of the search providers moved to `search-session.mjs` (ADR-0135); both names
// stay importable from here.
export { mergeByRank, searchPatiently };

/** The budget tiers, in credits of scrape. Tuned for a ~1,000-credit free month. */
export const DEPTH_SCRAPES = Object.freeze({
  probe: 2,
  quick: 4,
  normal: 10,
  deep: 25,
});

export const DEPTHS = Object.freeze(Object.keys(DEPTH_SCRAPES));

/**
 * `readPlan(root, file)` - the plan to run, defaulting to the project's own.
 *
 * `file` was missing entirely until 2026-09-20, while `bin/research.mjs --help` had been
 * documenting `--plan <file>` the whole time. The CLI called `readPlan(root)` and threw
 * the filename away, so `--plan probe.json` re-ran the default plan and looked like it
 * had worked. A flag that silently ignores its argument is worse than an absent one: the
 * operator watches a run happen and believes it was theirs.
 */
/**
 * A `prefer` value as a list of entries, whether the plan wrote a list or a string.
 *
 * A string is split on commas and whitespace - the way collect.yml splits its `prefer`
 * input - so "docs.x.com, github.com/actions/upload-artifact" is two entries. Until
 * 2026-09-27 a string was silently lost: dropped at the top level by an Array.isArray
 * guard, and spread into single characters per query, so a plan that plainly stated a
 * preference ranked as if it had none.
 */
export function preferList(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

/**
 * Everything in a parsed plan this kit cannot use, named - or [] when it is sound.
 *
 * readPlan replaces what it cannot use with a default, which suits a reader but not the
 * moment before a run: "depth": "thorough" ran as quick, "maxScrapes": "five" as 10, a
 * query written {"query": ...} was skipped so the run did nothing, and "not a url" and
 * ftp:// were queued for fetching - all in silence (found 2026-09-27).
 */
export function planProblems(plan) {
  const out = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['the plan must be a JSON object'];
  if (plan.depth !== undefined && !DEPTHS.includes(plan.depth)) out.push(`depth must be one of ${DEPTHS.join(', ')}, not ${JSON.stringify(plan.depth)}`);
  for (const [key, min] of [['refreshDays', 0], ['maxScrapes', 0], ['limit', 1], ['perQuery', 1]]) {
    if (plan[key] !== undefined && !(Number.isInteger(plan[key]) && plan[key] >= min)) {
      out.push(`${key} must be a whole number of at least ${min}, not ${JSON.stringify(plan[key])}`);
    }
  }
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  if (plan.queries !== undefined && !Array.isArray(plan.queries)) out.push('queries must be a list: [{ "q": "..." }]');
  else (plan.queries ?? []).forEach((query, i) => {
    if (!(text(query) || (query && typeof query === 'object' && text(query.q)))) out.push(`queries[${i}] has no "q": ${JSON.stringify(query)}`);
  });
  if (plan.urls !== undefined && !Array.isArray(plan.urls)) out.push('urls must be a list: [{ "url": "https://..." }]');
  else (plan.urls ?? []).forEach((entry, i) => {
    const url = typeof entry === 'string' ? entry : entry?.url;
    if (typeof url !== 'string') { out.push(`urls[${i}] has no "url": ${JSON.stringify(entry)}`); return; }
    let ok = false;
    try { ok = ['http:', 'https:'].includes(new URL(url).protocol); } catch { /* not a URL */ }
    if (!ok) out.push(`urls[${i}] is not an http(s) URL: ${url}`);
  });
  return out;
}

export function readPlan(root, file = '') {
  const plan = readJson(file ? operatorPath(root, file) : resolve(root, PATHS.plan), null);
  if (!plan) return { topic: '', depth: 'quick', refreshDays: 30, limit: 8, perQuery: 3, maxScrapes: 10, prefer: [], queries: [], urls: [] };
  return {
    topic: plan.topic ?? '',
    depth: DEPTHS.includes(plan.depth) ? plan.depth : 'quick',
    refreshDays: Number.isFinite(plan.refreshDays) ? plan.refreshDays : 30,
    limit: Number.isFinite(plan.limit) ? plan.limit : 8,
    perQuery: Number.isFinite(plan.perQuery) ? plan.perQuery : 3,
    maxScrapes: Number.isFinite(plan.maxScrapes) ? plan.maxScrapes : 10,
    prefer: preferList(plan.prefer),
    queries: Array.isArray(plan.queries) ? plan.queries : [],
    urls: Array.isArray(plan.urls) ? plan.urls : [],
  };
}

/**
 * One `prefer` entry, read as the host it names and, optionally, a path on that host.
 *
 * A bare host ("tavily.com") covers that host and its subdomains, as it always has. A host
 * with a path ("github.com/actions/upload-artifact") covers that path and everything under
 * it, on exactly that host: on a host that serves everyone, the host is not the owner.
 * Found 2026-09-26 - dispatched with `prefer: github.com` to collect upload-artifact's
 * release notes, collect run 36279879229 captured an unrelated repository's Actions run
 * page, because every page on GitHub earned the owner's bonus (ADR-0044).
 *
 * Read the way people paste it: a scheme, `www.`, case, a trailing slash, a query and a
 * fragment are all ignored. An entry with no host is no preference - `null`, never a
 * pattern that matches everything.
 */
export function parsePreference(entry) {
  const text = String(entry ?? '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[?#].*$/, '')
    .replace(/^www\./, '');
  const slash = text.indexOf('/');
  const host = slash === -1 ? text : text.slice(0, slash);
  if (!host) return null;
  return { host, path: slash === -1 ? '' : text.slice(slash).replace(/\/+$/, '') };
}

function matchesPreference(url, preference) {
  const host = hostOf(url);
  if (!preference.path) return host === preference.host || host.endsWith(`.${preference.host}`);
  if (host !== preference.host) return false;
  let path;
  try { path = new URL(String(url)).pathname.toLowerCase().replace(/\/+$/, ''); } catch { return false; }
  // At a segment boundary: /actions/upload-artifact is not /actions/upload-artifact-v2.
  return path === preference.path || path.startsWith(`${preference.path}/`);
}

/**
 * Prefer the page that OWNS the fact. A URL on a preferred domain - or under a preferred
 * path on a shared host - outranks one that is merely about it, and a docs/pricing/terms
 * path outranks a blog post on the same host.
 */
export function rankCandidate(url, { prefer = [], why = '' } = {}) {
  let value = 0;
  const preferences = prefer.map(parsePreference).filter(Boolean);
  if (preferences.some((preference) => matchesPreference(url, preference))) value += 10;
  if (/\b(docs?|developer|api|reference)\b/.test(url)) value += 4;
  if (/\b(pricing|plans|billing|limits|rate-limits|quotas)\b/.test(url)) value += 4;
  if (/\b(terms|tos|legal|licen[cs]e|privacy)\b/.test(url)) value += 3;
  if (/\b(blog|news|medium\.com|reddit\.com|youtube\.com|stackoverflow\.com)\b/.test(url)) value -= 5;
  if (/\b(login|signin|signup|cart|checkout)\b/.test(url)) value -= 8;
  if (mentionsWhy(url, why)) value += 1;
  return value;
}

/**
 * Does the URL mention one of the first two words of the reason? A plain case-insensitive
 * substring test, NOT a regex built from the reason.
 *
 * Two defects, found 2026-09-30 on the same line (break-test). A reason holding an
 * unbalanced metacharacter in its first two words - `a(b`, `[x`, `a{2,1}` - threw a raw
 * `SyntaxError: Invalid regular expression` straight out of an exported ranking function, so
 * one malformed reason in a plan took down a whole collection instead of one candidate. And a
 * reason that was only whitespace, or began with whitespace, built `|` or `|pricing` - an
 * EMPTY alternative, which matches every URL - so every candidate silently earned the bonus
 * and the ranking became noise. Both are the same root cause: caller text was used as a
 * pattern instead of as words.
 */
function mentionsWhy(url, why) {
  const words = String(why ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return false;
  const haystack = String(url).toLowerCase();
  return words.some((word) => haystack.includes(word.toLowerCase()));
}

/**
 * One page, one name: the identity used to decide "we already have this page".
 *
 * Scheme, `www.`, host case, a trailing slash and the fragment are dropped; the path's case
 * and the query string are kept, because either can name a different page. Found
 * 2026-09-27: collect run 36283114657 fetched a dispatched .../ui-and-api, then fetched the
 * search result .../ui-and-api/ as a second page - two credits for one. Identity only: the
 * URL a capture records is still the one that was fetched.
 */
export { urlKey };

/**
 * Does a search result carry the query it answers? Title, snippet and URL are read, because
 * ranking reads only the URL - and on 2026-09-27 a query for "postgres
 * pg_sync_replication_slots function" came back with only generic "postgres" pages, the home
 * page scored 0 as the best of them, and the kit spent a scrape on a page about nothing the
 * query asked.
 *
 * A result must carry at least TWO of the query's distinctive terms (4+ characters, not a
 * stopword), or half of them when the query has only three (ADR-0068). An identifier is matched as a phrase with `_` and `-` read as spaces, so
 * `sync_replication_slots` matches "sync replication slots" in a title or a URL. A query with
 * fewer than two distinctive terms is not judged: overlap cannot tell its results apart.
 */
const RELEVANCE_STOPWORDS = new Set(['with', 'what', 'when', 'which', 'does', 'from', 'that', 'this', 'into', 'about', 'your', 'have', 'will', 'there', 'their', 'than', 'then', 'them', 'they', 'how', 'the', 'and', 'for']);
const plain = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function queryTerms(query) {
  return [...new Set(String(query ?? '').toLowerCase().split(/\s+/)
    // "Ollama's" is the word "ollama": a possessive read as "ollama s" matched no page.
    .map((word) => plain(word.replace(/['\u2019]s(?=[^a-z0-9]*$)/, '')))
    .filter((term) => term.replace(/ /g, '').length >= 4 && !RELEVANCE_STOPWORDS.has(term)))];
}
export function matchesQuery(row, query) {
  const terms = queryTerms(query);
  if (terms.length < 2) return true;
  let url = String(row?.url ?? '');
  try { url = decodeURIComponent(url); } catch { /* a malformed escape is read as written */ }
  const text = ` ${plain(`${row?.title ?? ''} ${row?.description ?? ''} ${url}`)} `;
  const hits = terms.filter((term) => text.includes(term)).length;
  // Two terms, or half of a query shorter than four. "Half" alone asked a title for five of a
  // ten-term topic sentence and rejected 36 of the 38 pages real searches had found here
  // (ADR-0068); two still rejects a page that shares only the product's name with the query.
  return hits >= Math.min(2, Math.ceil(terms.length / 2));
}

/** Is this URL on a domain the plan's `prefer` names? */
export function isPreferred(url, prefer = []) {
  return prefer.map(parsePreference).filter(Boolean).some((preference) => matchesPreference(url, preference));
}

/**
 * Whether a URL a VENDOR returned may be handed to a fetch adapter: http or https, with a
 * host. A search result is the vendor's text, and `javascript:` or `file:` rows were queued
 * beside real pages - the browser transport passes a URL to Chromium as it is (found
 * 2026-10-01, break-test). Plan URLs are the operator's and checked where they are read.
 */
export function isWebUrl(value) {
  try {
    const url = new URL(String(value));
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function selectCandidates(results, { prefer = [], perQuery = 3, seen = new Set(), query = '' } = {}) {
  const taken = new Set();
  return results
    .filter((row) => isWebUrl(row?.url))
    // Only a result that carries the query is worth a scrape (RR-9). `query` is optional so
    // a caller ranking a list it built itself is not judged.
    // A domain the operator named in `prefer` is taken on their word: they said it carries the
    // fact, and a page there titled "Pricing" can hold the limits the query asks about.
    .filter((row) => !query || matchesQuery(row, query) || isPreferred(row.url, prefer))
    .map((row) => ({ ...row, score: rankCandidate(row.url, { prefer }) }))
    // `seen` may hold keys (runResearch) or raw URLs (older callers); either excludes.
    .filter((row) => row.url && !seen.has(row.url) && !seen.has(urlKey(row.url)))
    .sort((a, b) => b.score - a.score)
    // Two spellings of one page in the same list are one candidate: the better-ranked.
    .filter((row) => { const key = urlKey(row.url); if (taken.has(key)) return false; taken.add(key); return true; })
    .slice(0, perQuery);
}

// One lookup for one newly collected page, recorded beside the corpus - never in raw/ or the
// ledger - so a witness cannot alter or fail the capture it witnesses (ADR-0106).
function witnessCapture(root, url, raw, lookup, log) {
  let record;
  try { record = lookup(url, { timestamp: wayback.waybackTimestamp(new Date()) }); } catch (err) {
    record = { witnessed: false, reason: `the lookup failed: ${err?.message ?? err}` };
  }
  if (!record || typeof record !== 'object') record = { witnessed: false, reason: 'the lookup returned nothing' };
  try { appendJsonLine(root, PATHS.witnesses, { at: new Date().toISOString(), url, raw: raw ?? '', ...record }); } catch (err) {
    log(`  witness   ${url} - not recorded: ${err.message}`);
    return;
  }
  log(`  witness   ${url} - ${record.witnessed ? record.snapshot : record.reason}`);
}

/**
 * Run the plan.
 *
 * `{ transport, budget, attempts, spent, cached, failed, results, discovered }`.
 * Nothing is collected when `dryRun` is set - `attempts` still shows what it would
 * cost, against the same cap - and a cache hit never counts against the budget.
 */
export function runResearch(root, {
  adapter,
  // The SEARCH side (ADR-0027). Absent means "the fetch adapter", which is what every
  // caller did before the split - so an un-updated caller behaves exactly as before.
  searchAdapter = null,
  // Several providers: asked in parallel and interleaved by rank. One stays one.
  searchAdapters = null,
  // Taken once, when the fetch adapter reports its credits are exhausted (ADR-0086): the
  // rest of the run searches and fetches through it. Null means no fallback.
  fallbackAdapter = null,
  plan = null,
  depth = '',
  refreshDays = null,
  force = false,
  dryRun = false,
  // The opt-in Wayback witness (ADR-0106): off, nothing is sent to the Internet Archive.
  witness = false,
  witnessLookup = null,
  only = [],
  date = today(),
  now = new Date(),
  maxRateLimitRetries = 2,
  sleep = sleepSync,
  log = () => {},
} = {}) {
  const ask = (provider, text) => searchPatiently(provider, text, { limit: settings.limit, maxRateLimitRetries, sleep, log });

  // Credits run out mid-run: WHAT a run does then - switch once to the fallback (ADR-0086)
  // or stop and leave the rest `uncollected` (ADR-0129) - is one policy with one state
  // owner, `credits.mjs`. This coordinator sequences the run and asks which provider serves
  // each call; `credits.stopped` / `credits.fellBack` are read back for the summary.
  const credits = creditsPolicy({
    adapter,
    fallbackAdapter,
    ask,
    record: (row) => appendJsonLine(root, PATHS.failures, row),
    log,
  });
  // HOW a query is put to the search providers - the merge, the one degrade, the meters, the
  // failure rows - is the session's (ADR-0135); this coordinator decides what to do with
  // each answer. Its failure rows land in the failure log as `op: "search"`.
  const session = searchSession({
    adapter, searchAdapter, searchAdapters, askOne: ask, credits, log,
    record: (f) => appendJsonLine(root, PATHS.failures, {
      at: new Date().toISOString(), op: 'search', query: f.query, provider: f.provider, error: f.error,
      ...(f.degraded ? { degraded: true } : {}),
    }),
  });

  // Refuse an incompatible vendor CLI BEFORE anything is spent.
  //
  // The Firecrawl CLI is the one dependency outside this repository's control: no
  // lockfile pins it, it is installed globally, and it can change under a working
  // install. Every adapter test drives a stub, so a payload-shape change is exactly what
  // the suite cannot see - and the place it would surface is mid-collection, after
  // credits are gone. A dry run is checked too: a preview that says "this will work" on a
  // CLI that cannot is worse than no preview.
  //
  // Only a different MAJOR refuses. An unreadable or unparseable version proceeds, because
  // a CLI that prints its version differently is not evidence that scraping is broken.
  if (adapter?.name === firecrawl.name) {
    const compatibility = firecrawl.cliCompatibility();
    if (!compatibility.supported) {
      const err = new Error(`${compatibility.detail}
${compatibility.remedy}`);
      err.code = 'CLI_INCOMPATIBLE';
      err.compatibility = compatibility;
      throw err;
    }
    if (compatibility.level !== 'supported') log(`note: ${compatibility.detail}`);
  }

  // A search provider that cannot run refuses here, beside the CLI check, for the same
  // reason: this is the last point before anything is spent. selectSearch REPORTS the
  // problem rather than throwing, so --dry-run and doctor can describe it; the refusal
  // belongs where the money is.
  session.assertReady();

  // A ledger that cannot record a fetch refuses here too, for the same reason (ADR-0122):
  // a chain whose hashes no longer link, a torn tail, an unparsed line. Every fetch recorded
  // after a break is refused by handoff and preflight, so the credits it would cost are not
  // spent. `appendFetch` asks again under the lock; this is the copy that runs before the
  // money. A dry run is refused the same way, as the CLI check above is: a preview that
  // says "this will collect" onto a chain that cannot record it is worse than no preview.
  assertAppendable(root);

  const settings = plan ?? readPlan(root);
  const tier = depth || settings.depth;
  const budget = Math.min(settings.maxScrapes, DEPTH_SCRAPES[tier] ?? DEPTH_SCRAPES.quick);
  const freshness = refreshDays === null ? settings.refreshDays : refreshDays;
  const corpus = readCorpus(root);

  const results = [];
  const discovered = [];
  // `attempts` is what the BUDGET counts - the scrapes a run would make, whether or not
  // it makes them. `spent` is what it actually cost. A dry run has attempts and no
  // spend; conflating the two made a preview ignore the very cap it was previewing.
  let attempts = 0;
  // Searches a dry run would make; a real run counts `searchesUsed` instead.
  let wouldSearch = 0;
  let spent = 0;
  let cached = 0;
  let failed = 0;
  let overBudget = 0;
  const { exhausted, live, onExhaustion, countUncollected, countSkippedSearch } = credits;

  const seen = new Set();
  const targets = [];

  // The plan's own URLs, compared with each other by `urlKey`: a page written down twice -
  // with and without `www.`, a trailing slash, a fragment - is queued once, and the other
  // spellings are named as skipped rather than dropped. Until 2026-10-02 only search results
  // were compared with the plan, so such a plan paid for the page once per spelling.
  const queued = new Map();
  for (const entry of settings.urls) {
    const url = typeof entry === 'string' ? entry : entry.url;
    if (!url) continue;
    const target = {
      url,
      type: (typeof entry === 'object' && entry.type) || 'P',
      usedFor: (typeof entry === 'object' && entry.why) || '',
      from: 'plan.urls',
    };
    const key = urlKey(url);
    const first = queued.get(key);
    if (first) {
      const reason = `same page as ${first}, queued once`;
      results.push({ ...target, status: 'skipped', reason });
      log(`  skipped   ${url} - ${reason}`);
      continue;
    }
    queued.set(key, url);
    // Seen before any search runs, so a search result that is this page - in any spelling -
    // is not queued a second time.
    seen.add(key);
    targets.push(target);
  }

  // The contract's answer to "is this search still needed": a query whose `why` names
  // unknowns that are all CLOSED is a search for an answered question. Credits already spent
  // are not spent again (the resume rule); a search is paid on every run, so it is skipped and
  // said - `--force` means "spend again", for a search as for a page (ADR-0127). Found
  // 2026-10-02 running the kit five times over MoonAliza's finished projects: one plan's query
  // named U-01 and U-04, both closed, and every run would have paid it.
  const statusOf = new Map(corpus.unknowns.map((u) => [String(u.id).toUpperCase(), u.status]));
  const closedUnknowns = (why) => {
    const ids = uniq((String(why ?? '').match(/\bU-\d+\b/gi) ?? []).map((id) => id.toUpperCase()));
    return ids.length && ids.every((id) => statusOf.get(id) === 'CLOSED') ? ids : [];
  };

  for (const query of settings.queries) {
    const text = typeof query === 'string' ? query : query.q;
    if (!text) continue;
    if (only.length && !only.some((needle) => text.toLowerCase().includes(needle.toLowerCase()))) continue;
    const prefer = uniq([...preferList(settings.prefer), ...preferList(typeof query === 'object' ? query?.prefer : null)]);
    if (credits.stopped) {
      countSkippedSearch();
      discovered.push({ query: text, results: [], note: 'not run - credits exhausted, the run stopped' });
      log(`  skipped   search "${text}" - credits exhausted, the run stopped`);
      continue;
    }
    const closed = force ? [] : closedUnknowns(typeof query === 'object' ? query.why : '');
    if (closed.length) {
      const why = `${closed.join(', ')} ${closed.length === 1 ? 'is' : 'are'} closed in research/DISCOVERY.md; --force searches again`;
      discovered.push({ query: text, results: [], note: `not run - ${why}` });
      log(`  ${dryRun ? 'would skip' : 'skipped   '} search "${text}" - ${why}`);
      continue;
    }
    if (dryRun) {
      discovered.push({ query: text, results: [], note: 'search not run under --dry-run' });
      wouldSearch += 1;
      // Named, because a preview that omits the searches previews nothing for a plan made of
      // them (found 2026-09-27). Pages are not known until the search runs; the query and the
      // meter it would spend on are.
      log(`  would search "${text}" on ${session.meter}, keeping up to ${settings.perQuery} page(s)`);
      continue;
    }
    // What a search came back with, reported the same way whichever path ran it: an empty
    // search and one whose every result misses the query are both recorded, because each
    // leaves the operator with nothing to read for this query (RR-8, RR-9). The merged path
    // had reported neither (found 2026-09-27).
    const noteOutcome = (results, provider) => {
      if (!results.length) {
        log(`  search found nothing: ${text} (${provider})`);
        appendJsonLine(root, PATHS.failures, { at: new Date().toISOString(), op: 'search-empty', query: text, provider });
        return;
      }
      if (!results.some((row) => matchesQuery(row, text) || isPreferred(row.url, prefer))) {
        log(`  no result matched "${text}" - none of the ${results.length} carry two of its terms; nothing scraped for it`);
        appendJsonLine(root, PATHS.failures, {
          at: new Date().toISOString(), op: 'search-off-topic', query: text, provider, results: results.length,
        });
      }
    };
    const found = session.ask(text);
    if (!found.ok) continue;
    discovered.push({ query: text, results: found.results, provider: found.provider, searchId: found.searchId });
    noteOutcome(found.results, found.provider);
    const eligible = found.results.filter((row) => isWebUrl(row?.url)
      && !cacheDecision(corpus.captures, row.url, { refreshDays: freshness, force, now }).hit);
    for (const candidate of selectCandidates(eligible, { prefer, perQuery: settings.perQuery, seen, query: text })) {
      // Discovered by a search, not chosen by a person: context until an agent reads the
      // page and promotes it. Ranking preference is not source authority. The target row is
      // this coordinator's, and the two paths spell it differently (ADR-0135 leaves that):
      // under a merge `rankedBy` names ALL finders - a URL both returned is attributed to
      // both - and alone it names WHICH provider ranked it, not just which query found it
      // (DR-2); two providers' rankings are two different provenance claims, and a bare
      // query string cannot carry both.
      targets.push(found.merged ? {
        url: candidate.url,
        type: DEFAULT_SOURCE_TYPE,
        usedFor: typeof query === 'object' ? (query.why ?? '') : '',
        from: 'search',
        rankedBy: (candidate.providers ?? [candidate.provider]).filter(Boolean).join('+'),
      } : {
        url: candidate.url,
        type: DEFAULT_SOURCE_TYPE,
        usedFor: (typeof query === 'object' && query.why) || text,
        from: `query: ${text} (via ${found.provider})`,
        rankedBy: found.provider,
      });
      // Recorded either way, so the next query cannot pick this page again and lose its own
      // best result to a duplicate.
      seen.add(urlKey(candidate.url));
    }
  }

  for (const target of targets) {
    if (credits.stopped) {
      countUncollected();
      const reason = 'not attempted - credits exhausted, the run stopped';
      results.push({ ...target, status: 'uncollected', reason });
      log(`  uncollected ${target.url} - ${reason}`);
      continue;
    }
    seen.add(urlKey(target.url));
    const decision = cacheDecision(corpus.captures, target.url, { refreshDays: freshness, force, now });
    // A page that answered 404/410 within the window is not fetched and takes no budget slot:
    // the slot is for a page that may exist (found 2026-09-29, a remembered 404 had crowded out
    // the one real page a maxScrapes 1 run had room for).
    const gone = decision.hit ? null : recentlyGone(root, target.url, { refreshDays: freshness, force, now });
    if (gone) {
      results.push({ ...target, ...gone });
      log(`  gone      ${target.url} - ${gone.reason}`);
      continue;
    }
    // The budget binds in a DRY RUN too. A preview that ignores it answers a different
    // question from the one execution will answer - it shows work that would never
    // happen, and hides the cap the operator is previewing against.
    if (!decision.hit && attempts >= budget) {
      const reason = `budget exhausted (${budget} scrapes at depth ${tier})`;
      results.push({ ...target, status: 'skipped', reason });
      // Said on the terminal, not only in the result. Found 2026-09-27: a plan naming five
      // pages with a budget of 2 printed two lines, and the three pages the operator wrote
      // down were left out without a word.
      log(`  skipped   ${target.url} - ${reason}`);
      overBudget += 1;
      continue;
    }
    if (!decision.hit) attempts += 1;
    const fetchWith = (fetcher) => collectOne(root, target.url, {
      runScrape: (url) => fetcher.runScrape(url),
      corpus,
      type: target.type,
      usedFor: target.usedFor,
      refreshDays: freshness,
      force,
      date,
      now,
      transportName: fetcher.name,
      // Empty for a plan URL - nobody's ranking chose it, a person wrote it down.
      discoveredBy: target.rankedBy ?? '',
      dryRun,
      log,
    });
    let outcome = fetchWith(live(adapter));
    // The refused request cost nothing (a 402 is not charged), so it is not a failed page:
    // the same page is fetched again through the fallback.
    if (outcome.status === 'failed' && exhausted(live(adapter), outcome.reason)) {
      onExhaustion(outcome.reason, `fetch ${target.url}`);
      if (credits.stopped) {
        countUncollected();
        outcome = { status: 'uncollected', reason: 'credits exhausted - the run stopped here' };
      } else {
        outcome = fetchWith(fallbackAdapter);
      }
    }
    if (outcome.status === 'collected') spent += 1;
    if (outcome.status === 'cached') cached += 1;
    if (outcome.status === 'failed') { failed += 1; spent += 1; }
    results.push({ ...target, ...outcome });
    log(`  ${outcome.status.padEnd(9)} ${target.url}${outcome.reason ? ` - ${outcome.reason}` : ''}`);
    if (witness && !dryRun && outcome.status === 'collected') witnessCapture(root, target.url, outcome.entry?.file, witnessLookup ?? wayback.lookup, log);
  }

  // A run that only searched still spent something - on a different meter. Logging only
  // when `spent` was non-zero would make a search-only run invisible in the usage record
  // (DR-1).
  const { searchesUsed, searchesOn, searchCreditsEstimate, searchFailures, searchFailuresOn, degraded } = session.meters();
  if (!dryRun && (spent || searchesUsed)) {
    appendJsonLine(root, PATHS.usage, {
      at: new Date().toISOString(), depth: tier, budget, attempts, spent, cached, failed,
      transport: adapter.name,
      ...(credits.fellBack ? { fellBackTo: credits.fellBack.to } : {}),
      ...(credits.stopped ? { stopped: credits.stopped.during } : {}),
      searchTransport: session.name,
      searchesUsed,
      searchesOn,
      ...(searchCreditsEstimate ? { searchCreditsEstimate } : {}),
      searchFailures,
      degraded,
    });
  }

  return {
    transport: adapter.name,
    searchTransport: session.name,
    depth: tier, budget, maxScrapes: settings.maxScrapes, attempts, spent, cached, failed,
    // Pages the budget left out this run; the next run reaches them, a cached page being free.
    overBudget,
    // What actually landed on disk, as distinct from what the run cost. `spent` is
    // collected + failed, because a failed fetch can still consume budget; reporting it as
    // "collected" told the operator they had pages they did not have.
    collected: spent - failed,
    searchesUsed, searchesOn, searchCreditsEstimate, searchFailures, searchFailuresOn, degraded,
    ...(dryRun ? { wouldSearch } : {}),
    // { from, to, reason } once the run switched transports (ADR-0086), else null.
    fellBack: credits.fellBack,
    // { reason, provider, during, uncollected, skippedSearches } once exhaustion stopped the
    // run (ADR-0129), else null.
    stopped: credits.stopped,
    results, discovered,
  };
}

/**
 * The run summary's line for the separate search meter.
 *
 * It printed `searches 0 on serpapi` after a run in which SerpAPI had timed out and the
 * merge carried on without it (tavily-terms, 2026-09-22). True, and it read as "not used".
 * A provider that was asked and failed now says so, and says where the reason is. A clean
 * run prints exactly the line it always did.
 */
export function searchSummaryLine(run) {
  const name = run.searchTransport;
  // An estimate is labelled as one: the account balance (doctor) is the vendor's own number.
  const credits = run.searchCreditsEstimate ? ` (≈${run.searchCreditsEstimate} credits, estimated by the documented 2 per 10 results)` : '';
  // More than one meter paid: name each, so no provider's count carries another's searches.
  const on = Object.entries(run.searchesOn ?? {});
  const counted = on.length > 1 ? on.map(([provider, used]) => `${used} on ${provider}`).join(', ') : `${run.searchesUsed} on ${name}`;
  const line = `searches   ${counted}${credits}`;
  const failed = Number(run.searchFailuresOn?.[name] ?? 0);
  if (!failed) return line;
  return `${line} - ${failed} attempt${failed === 1 ? '' : 's'} failed, reasons in ${PATHS.failures}`;
}

/** What has been spent, read from the run log the collector keeps. */
export function usageSummary(root) {
  const corpus = readCorpus(root);
  const scrapes = corpus.ledger.entries.filter((e) => e.op === 'scrape').length;
  const failures = corpus.ledger.entries.filter((e) => e.op === 'fail').length;
  return {
    captures: corpus.captures.entries.length,
    scrapes,
    failures,
    evidence: corpus.evidence.length,
    ledgerEntries: corpus.ledger.entries.length,
    search: searchUsage(root),
  };
}

/**
 * What the SEARCH meter has cost lately, read from the usage log this kit already keeps.
 *
 * This is RR-5, narrowed deliberately. The requirement asked for a throttle that keeps
 * the kit under 50 requests an hour. A throttle was the wrong instrument: it would be
 * the kit refusing work on a guess about a counter it cannot see, when the vendor
 * already answers a throttled request with an error that RR-3 handles by degrading. A
 * guard that duplicates the vendor's own answer can only add a way to be wrong.
 *
 * What was genuinely missing is the operator being able to SEE the meter. So this counts
 * rather than blocks, and the caps it names are the free tier's (E-25, E-27), stated as
 * context rather than enforced.
 *
 * What the caps MEAN is the search adapter's to say, not this module's: since 2026-09-26
 * (U-9, U-10) the SerpAPI adapter exports `METER_NOTES`, and `--status` prints the notes of
 * whichever adapter was selected. The month counted here is a calendar month.
 *
 * Counts this kit's own spend. It cannot see searches made from another machine on the
 * same account, and it over-counts a repeat served from the vendor's free 1-hour cache
 * (E-09), which the payload gives no way to detect. Both limits are reported.
 */
export const FREE_TIER_PER_HOUR = 50;
export const FREE_TIER_PER_MONTH = 250;

export function searchUsage(root, { now = new Date(), provider = '' } = {}) {
  const lines = readText(resolve(root, PATHS.usage), '').trim();
  const rows = lines ? lines.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

  const hourAgo = now.getTime() - 3600_000;
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let lastHour = 0;
  let thisMonth = 0;
  let creditsEstimate = 0;
  const providers = new Set();

  for (const row of rows) {
    // A row that says who paid (since 2026-09-28) is counted per provider; an older row is
    // attributed to its searchTransport, as it always was.
    const by = row.searchesOn && typeof row.searchesOn === 'object' ? row.searchesOn : null;
    const used = by
      ? (provider ? Number(by[provider] ?? 0) : Object.values(by).reduce((sum, n) => sum + Number(n || 0), 0))
      : Number(row.searchesUsed);
    if (!Number.isFinite(used) || used <= 0) continue;
    if (!by && provider && row.searchTransport !== provider) continue;
    const at = Date.parse(row.at);
    if (!Number.isFinite(at)) continue;
    if (by) for (const [name, n] of Object.entries(by)) { if (Number(n) > 0) providers.add(name); }
    else if (row.searchTransport) providers.add(row.searchTransport);
    if (at >= hourAgo) lastHour += used;
    if (at >= monthStart) thisMonth += used;
    if (at >= monthStart && Number.isFinite(Number(row.searchCreditsEstimate))) creditsEstimate += Number(row.searchCreditsEstimate);
  }

  return {
    lastHour,
    thisMonth,
    providers: [...providers],
    // Search credits this month as the adapters ESTIMATED them - never a vendor's count.
    creditsEstimate,
    perHourCap: FREE_TIER_PER_HOUR,
    perMonthCap: FREE_TIER_PER_MONTH,
    // Named so nobody reads these numbers as the vendor's.
    // Per project: the usage file lives in research/raw/ (Found 2026-09-27: this said "this box").
    caveat: 'counted from this project\'s own runs on this machine; a repeat served from the provider\'s free cache is counted here but not billed',
  };
}

/**
 * How much of the topic's own vocabulary appears in what was just collected.
 *
 * REPORTED, NEVER ENFORCED, and the measurement that settled that is worth keeping.
 *
 * It exists because a collection can return eight captures about the wrong subject and pass
 * every structural check in the kit. On 2026-09-22 a run on the EU Deforestation Regulation
 * returned SEC filings, CFPB regulations and California water boards - the search had
 * matched the word "regulation" - and `preflight` had nothing to say, because no check asks
 * whether the evidence is about the topic.
 *
 * Two thresholds were measured against that failure and every committed corpus here:
 *
 *   PER CAPTURE, share >= 0.5: rejected. It flags RFC 9728 in the agent-interface corpus,
 *   which never says "MCP" - and not saying it is exactly what makes it an independent
 *   witness. The rule would punish the best evidence in the corpus.
 *
 *   PER CORPUS, at least one capture >= 0.5: rejected too, and this is the decisive one.
 *   `delivery-architecture` scores max 0.25 with zero strong captures - IDENTICAL to the
 *   failure - because its topic is "How Research-Kit should be delivered to a non-technical
 *   user" and its evidence is GitHub Actions documentation. Semantically related, lexically
 *   disjoint. No threshold separates that from a corpus about the wrong subject entirely.
 *
 * Telling those apart needs meaning, which ADR-0013 refuses. So the number is printed at the
 * moment it helps - right after collecting, before anyone has read the pages - and decides
 * nothing. A reviewer seeing 0.25 on a fresh collection knows to check the URLs; on the EUDR
 * run that is precisely the step that caught it, performed by hand.
 *
 * A HIGH SCORE MEANS NOTHING WHEN THE TOPIC IS MADE OF COMMON WORDS, and that is not
 * hypothetical either. The first real use after shipping was a collection on Tavily's terms,
 * topic "...data retention training on inputs outputs zero retention enterprise tier opt
 * out". It reported **0.92, eight of eight above threshold** - on a corpus where SEVEN OF
 * EIGHT captures were generic "zero data retention" marketing from unrelated vendors and
 * only `tavily.com/terms` was on topic. Every one of those pages genuinely contains "data",
 * "retention", "training", "zero" and "enterprise", so the arithmetic was right and the
 * signal was useless.
 *
 * So the number is informative in ONE direction only: a low score is worth investigating,
 * and a high score is worth nothing unless the topic carried distinctive terms. `deforestation`
 * and `2023/1115` are distinctive; `data` and `service` are not, and this function cannot
 * tell the difference without a corpus-wide notion of rarity it does not have.
 */
const TOPIC_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'in', 'on',
  'at', 'by', 'after', 'before', 'current', 'date', 'with', 'from', 'is', 'are', 'as', 'eu',
  'its', 'it', 'this', 'that', 'how', 'what', 'when', 'does', 'do', 'can', 'not', 'without',
  'versus', 'vs', 'should', 'be', 'was', 'were', 'has', 'have', 'than', 'they', 'their']);

export function topicTerms(topic) {
  return [...new Set(String(topic ?? '').toLowerCase()
    .replace(/[^a-z0-9/.-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean))]
    .filter((word) => word.length > 2 && !TOPIC_STOPWORDS.has(word));
}

/**
 * `{ terms, best, strong }` over the given capture bodies, or `null` when the topic carries
 * too few distinctive terms to say anything - which is not the same as a low score.
 */
export function topicMatch(topic, bodies) {
  const terms = topicTerms(topic);
  if (terms.length < 3 || !bodies.length) return null;
  const shares = bodies.map((body) => {
    const lower = String(body ?? '').toLowerCase();
    return terms.filter((term) => lower.includes(term)).length / terms.length;
  });
  return {
    terms: terms.length,
    best: Math.max(...shares),
    strong: shares.filter((share) => share >= 0.5).length,
  };
}
