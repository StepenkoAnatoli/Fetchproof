// decompose.mjs - phase 0: gather material, seed the checklist, draft the MAP.
//
// It contains NO JUDGMENT. It hands over a checklist with statuses BLANK, never an
// answer: marking a row COVERED / DISMISSED / GAP is the agent's act, and
// `subtopic-coverage` is what judges it afterwards.
//
// A `--recipe` ADDS domain dimensions on top of the universal set. It never replaces
// it - a recipe that silently dropped legality would be worse than no recipe.

import path from 'node:path';
import {
  PATHS, HEADERS, resolve, exists, readText, writeText, today, hostOf, uniq, listFiles,
} from './core.mjs';
import { readCorpus, cacheDecision, tableRow, appendJsonLine, parseCapture } from './corpus.mjs';
import { seedRows, UNIVERSAL_DIMENSIONS } from './dimensions.mjs';
import { collectOne, DEFAULT_SOURCE_TYPE } from './collect.mjs';
import { assertAppendable } from './provenance.mjs';
import { urlKey, matchesQuery, isWebUrl } from './research-run.mjs';
import { searchSession } from './search-session.mjs';
import { KIT_ROOT, UNTITLED_TOPIC } from './scaffold.mjs';

export const RECIPE_DIR = path.join(KIT_ROOT, 'recipes');

/** Front-matter dimensions from a recipe file. Specializations, never replacements. */
export function parseRecipe(text) {
  const match = String(text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const dimensions = [];
  let name = '';
  if (match) {
    let inList = false;
    for (const [offset, line] of match[1].split(/\r?\n/).entries()) {
      const named = line.match(/^name:\s*(.*)$/);
      if (named) { name = named[1].trim(); continue; }
      if (/^dimensions:\s*$/.test(line)) { inList = true; continue; }
      if (inList) {
        const item = line.match(/^\s*-\s+(.*)$/);
        if (!item) { if (line.trim()) inList = false; continue; }
        const [label, why] = item[1].split(/\s*\|\s*/);
        if (!label.trim()) {
          const err = new Error(`line ${offset + 2}: the dimension label is blank`);
          err.code = 'INVALID_RECIPE';
          throw err;
        }
        dimensions.push({ name: label.trim(), why: (why ?? '').trim() });
      }
    }
  }
  return { name, dimensions };
}

export function loadRecipe(nameOrPath) {
  if (!nameOrPath) return { name: '', dimensions: [] };
  const direct = exists(nameOrPath) ? nameOrPath : path.join(RECIPE_DIR, `${nameOrPath}.md`);
  const text = readText(direct);
  if (text === null) {
    // Named, so a near miss ("api" for api-integration) is one glance away (found 2026-09-27).
    const known = listFiles(RECIPE_DIR).filter((n) => n.endsWith('.md')).map((n) => n.replace(/\.md$/, ''));
    const err = new Error(`no recipe "${nameOrPath}" - the recipes are: ${known.join(', ') || `none (looked in ${RECIPE_DIR})`}`);
    err.code = 'UNKNOWN_RECIPE';
    throw err;
  }
  let parsed;
  try { parsed = parseRecipe(text); } catch (err) {
    if (err.code === 'INVALID_RECIPE') err.message = `recipe "${direct}" ${err.message}`;
    throw err;
  }
  if (!parsed.dimensions.length) {
    const err = new Error(`recipe "${direct}" holds no dimensions - use a front-matter dimensions list of "- label | why" lines; see ${RECIPE_DIR}`);
    err.code = 'INVALID_RECIPE';
    throw err;
  }
  return { ...parsed, file: direct };
}

/** Where the facts probably live: the official hosts a search keeps pointing at. */
/**
 * Hosts where many unrelated owners publish side by side (ADR-0096): there the owner is the
 * account, the first path segment. As ADR-0044 found for `prefer`, github.com is not one owner.
 */
export const SHARED_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org',
  'raw.githubusercontent.com', 'gist.github.com', 'huggingface.co', 'medium.com', 'dev.to']);

/** Path segments that name the account (`/orgs/<org>`) or the host's own section (`/topics`). */
const ACCOUNT_PREFIXES = new Set(['orgs', 'users']);
const HOST_SECTIONS = new Set(['topics', 'marketplace', 'features', 'collections', 'sponsors', 'apps',
  'settings', 'explore', 'trending', 'search', 'about', 'pricing', 'enterprise', 'security', 'site', 'login']);

/** Who owns the page, for ranking: the host, or host/account on a shared host. */
export function ownerOf(url) {
  const host = hostOf(url);
  if (!host || !SHARED_HOSTS.has(host)) return host;
  let segments = [];
  try { segments = new URL(url).pathname.split('/').filter(Boolean).map((s) => s.toLowerCase()); } catch { /* host only */ }
  if (ACCOUNT_PREFIXES.has(segments[0])) segments = segments.slice(1);
  const account = segments[0] ?? '';
  return account && !HOST_SECTIONS.has(account) ? `${host}/${account}` : host;
}

export function docsHosts(results, { limit = 6 } = {}) {
  const counts = new Map();
  for (const row of results) {
    const host = ownerOf(row.url);
    if (!host) continue;
    let weight = 1;
    if (/^docs?\.|^developer\./.test(host)) weight += 2;
    if (/\b(docs?|developer|api|reference|pricing|terms)\b/.test(row.url)) weight += 1;
    counts.set(host, (counts.get(host) ?? 0) + weight);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([host, score]) => ({ host, score }));
}

/**
 * One line of vendor error text, safe to commit. MAP.md is checked in, and an error string
 * is whatever the vendor or its CLI printed - which has echoed request URLs, and keys with
 * them. So: the first line only, `api_key=`-style parameters blanked, any credential-shaped
 * run (32+ token characters - a SerpAPI key, an `fc-` key, a GitHub token) replaced, capped.
 * Pattern-based on purpose: the string may carry a credential this process never held.
 */
function scrubError(text) {
  const line = String(text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  const clean = line
    .replace(/((?:api[_-]?key|key|token|secret)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/[A-Za-z0-9_-]{32,}/g, '<redacted>')
    .trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
}

/**
 * `resolveTopic(root, asked)` -> `{ topic }` to decompose, or `{ error }`.
 *
 * The project's topic is `research/plan.json`'s, which new-project writes. With no
 * `--topic` it is the one decomposed; a different `--topic` is refused, because a map of
 * another topic is another project, and the brief takes its title from the map. Spacing
 * and case are not a difference. A project still called "Untitled topic" has none, so
 * any `--topic` is accepted there.
 */
export function resolveTopic(root, asked) {
  const corpus = readCorpus(root);
  // A duplicate object key keeps only the LAST value in JSON.parse, and the topic is what
  // every search below is built from - so the run would spend on the second value while the
  // operator reads the first. The gate names it, but the gate runs after the credits are
  // gone (found 2026-09-30, break-test: the same hole in research.mjs).
  const duplicate = (corpus.problems ?? []).find((problem) => problem.kind === 'plan-unparsed'
    && /duplicate object key/.test(String(problem.detail ?? '')));
  if (duplicate) return { error: `${duplicate.artifact} ${duplicate.detail} - fix it, then run this again.` };
  const plan = corpus.plan;
  const own = typeof plan?.topic === 'string' && plan.topic.trim() && plan.topic.trim() !== UNTITLED_TOPIC
    ? plan.topic.trim() : '';
  const given = typeof asked === 'string' ? asked.trim() : '';
  const same = (a, b) => a.replace(/\s+/g, ' ').toLowerCase() === b.replace(/\s+/g, ' ').toLowerCase();
  if (!given && !own) return { error: 'this project has no topic yet - pass --topic "<what is being researched>"' };
  if (!given) return { topic: own };
  if (own && !same(own, given)) {
    return {
      error: `research/plan.json names this project's topic as "${own}", and --topic says "${given}".\n`
        + '  Omit --topic to map this project\'s topic. A different topic is a different project:\n'
        + '  scaffold it in its own folder with new-project.mjs.',
    };
  }
  return { topic: own || given };
}

// ---------------------------------------------------------------- outlines (ADR-0091)

/**
 * Headings a site prints around its content, not sections of it. Deliberately a list of
 * things pages SAY, counted across this repository's captures on 2026-09-29 (GitHub's chrome
 * and error banners, docs-site furniture) - not a guess about which sections matter.
 */
export const OUTLINE_FURNITURE = Object.freeze([
  'uh oh!', 'sorry, something went wrong.', 'choose a reason for hiding this comment',
  'latest commit', 'history', 'folders and files', 'repository files navigation',
  'about', 'resources', 'stars', 'watchers', 'forks', 'releases', 'packages', 'used by',
  'contributors', 'languages', 'no results found', 'feedback', 'in this article',
  'table of contents', 'contents', 'on this page', 'related posts', 'additional resources',
  'subscribe to our developer newsletter', 'navigation menu', 'footer', 'provide feedback',
  'saved searches', 'clone this wiki locally',
  // GitHub's file view and a Discourse forum's footer (2026-09-29, on MoonAliza's captures).
  'collapse file tree', 'files', 'file metadata and controls', 'related topics',
]);

/** Furniture with a name or a date in it: a Discourse forum's heading on every post. */
const OUTLINE_FURNITURE_PATTERNS = Object.freeze([/^post by .+ on [a-z]{3} \d{1,2}, \d{4}$/i]);

/**
 * A page's outline: its `##` and `###` headings, in order, as plain text. STORM's
 * table-of-contents step without the model: the outline is read, never interpreted.
 * Code blocks are skipped, links are reduced to their text, repeats and furniture dropped.
 */
export function outlineOf(body, { max = 12 } = {}) {
  const furniture = new Set(OUTLINE_FURNITURE);
  const seen = new Set();
  const all = [];
  let fence = '';
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const marker = line.match(/^\s*(```|~~~)/);
    if (marker) { fence = fence ? (fence === marker[1] ? '' : fence) : marker[1]; continue; }
    if (fence) continue;
    const m = line.match(/^(#{2,3})\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[2]
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = text.toLowerCase();
    if (text.length < 2 || text.length > 120 || /^permalink\b/i.test(text)) continue;
    if (furniture.has(key) || seen.has(key) || OUTLINE_FURNITURE_PATTERNS.some((p) => p.test(text))) continue;
    seen.add(key);
    all.push(text);
  }
  return { headings: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/**
 * The order phase 0 spends its scrape budget in (ADR-0094): pages on the likely owners first,
 * by their host's score, then everything else - each group in search order. The map's
 * candidate list keeps search order; only what gets captured changes. On MoonAliza
 * (2026-09-29) search order spent both scrapes on a third-party spec and a forum thread while
 * the map named docs.ollama.com the likely owner.
 */
/** The score a top owner needs before its floor-skipped pages are named in the map: one docs host, or three mentions. */
export const MIN_NAMED_OWNER_SCORE = 3;

export function scrapeOrder(material, hosts) {
  const score = new Map(hosts.map(({ host, score: s }) => [host, s]));
  return material
    .map((row, rank) => ({ row, rank, score: score.get(ownerOf(row.url)) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .map(({ row }) => row);
}

/** At most this many pages have their outline shown, so the map stays a page to read. */
export const MAX_OUTLINES = 8;

/** The outlines of the material's pages that have a capture on disk, in material order. */
function outlinesOf(root, captures, material) {
  const byKey = new Map();
  for (const entry of captures?.entries ?? []) if (entry.url) byKey.set(urlKey(entry.url), entry);
  const out = [];
  let captured = 0;
  for (const row of material) {
    const entry = captures?.byUrl?.get(row.url) ?? byKey.get(urlKey(row.url));
    if (!entry?.file) continue;
    captured += 1;
    if (out.length >= MAX_OUTLINES) continue;
    const { headings, more } = outlineOf(parseCapture(readText(resolve(root, entry.file), '')).body);
    if (headings.length) out.push({ url: row.url, title: row.title || entry.url, headings, more });
  }
  return { outlines: out, captured };
}

function mapBody({ topic, rows, hosts, material, date, recipe, failures = [], dryRun = false, outlines = null, ownerSkipped = [] }) {
  const lines = [
    '# MAP - topic decomposition',
    '',
    '## Topic',
    '',
    topic,
    '',
    '## Subtopics',
    '',
    'Statuses are blank on purpose: phase 0 gathers material, it does not judge. Mark each',
    'row COVERED (cite the U-## rows that cover it), DISMISSED (reason required - dismissing',
    'is fine, omitting is not), or GAP, and add topic-specific subtopics where the checklist',
    'is not enough.',
    '',
    tableRow(HEADERS.subtopics),
    `|${HEADERS.subtopics.map(() => '---').join('|')}|`,
    ...rows.map((row) => tableRow([row.id, row.text, row.why, row.status, row.coveredBy])),
    '',
    '## Coverage notes (per dimension)',
    '',
    '_One short paragraph per row once it has a status: what was established, and what the',
    'status rests on._',
    '',
    '## Candidate material',
    '',
    `Gathered ${date}${recipe ? ` with recipe \`${recipe}\`` : ''}.`,
    '',
  ];
  if (hosts.length) {
    lines.push('Likely owners of these facts (by how often a search pointed at them):', '');
    for (const { host, score } of hosts) lines.push(`- \`${host}\` (${score})`);
    lines.push('');
  }
  if (material.length) {
    lines.push('Candidate pages:', '');
    for (const row of material) lines.push(`- [${row.title || row.url}](${row.url})`);
    lines.push('');
  }
  if (ownerSkipped.length) {
    lines.push('Skipped on the likely owner - the relevance floor passed these over, because a terse',
      'title and an off-topic page look the same to it. If one is the page that owns the fact,',
      'name it in `research/plan.json` `urls` (ADR-0097):', '');
    for (const row of ownerSkipped) lines.push(`- [${row.title || row.url}](${row.url}) - \`${row.owner}\``);
    lines.push('');
  }
  // Three different empty maps, and they must not read alike: a dry run gathered nothing on
  // purpose, a quiet topic was searched and answered with nothing, and an outage was never
  // answered at all. Only the first is fixed by running without --dry-run.
  const lost = failures.filter((f) => !f.degraded && !f.covered);
  if (!hosts.length && !material.length) {
    if (dryRun) lines.push('_No material gathered - run without `--dry-run`, or add URLs to `research/plan.json`._', '');
    else if (lost.length) lines.push('_No material gathered - every search failed (below). This map is the bare checklist; re-run once the provider answers._', '');
    else lines.push('_No material gathered - every search answered, and none returned a page. Add URLs to `research/plan.json`._', '');
  }
  if (failures.length) {
    lines.push('Search failures - a map drafted from failed searches looks like a map of a quiet topic, so they are listed:', '');
    for (const f of failures) {
      const fell = f.degraded && f.fellBackTo ? ` - fell back to ${f.fellBackTo}` : (f.covered ? ' - answered by the other provider' : '');
      lines.push(`- \`${scrubError(f.query)}\` on ${f.provider}: ${scrubError(f.error)}${fell}`);
    }
    lines.push('');
  }
  if (outlines && material.length) {
    lines.push('## Outlines seen in the material', '');
    if (outlines.outlines.length) {
      lines.push('The section headings of the gathered pages that are captured - what related material',
        'covers, as its own tables of contents say (STORM\'s perspective step, without the model).',
        'Not a verdict: a heading worth a subtopic becomes a row by your hand.', '');
      for (const page of outlines.outlines) {
        lines.push(`- [${page.title}](${page.url})`);
        for (const heading of page.headings) lines.push(`  - ${heading}`);
        if (page.more) lines.push(`  - _and ${page.more} more_`);
      }
      lines.push('');
    } else if (outlines.captured) {
      lines.push('_No outlines - the captured pages have no section headings._', '');
    } else {
      lines.push('_No outlines - none of these pages is captured yet. `--max-scrapes <n>` captures the first n; their headings appear here._', '');
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Draft `research/MAP.md`.
 *
 * Scrape-budget accounting goes through the corpus's own `cacheDecision`, so a cache hit
 * is not an attempt and never spends a credit.
 */
/** At most this many parts of a compound topic are searched, so one topic cannot spend without bound. */
export const MAX_TOPIC_PARTS = 6;

/**
 * The searches phase 0 makes for a topic (ADR-0085).
 *
 * A topic that lists several questions - `subject: part, part; part` - is searched one part at
 * a time: searched whole, the MoonAliza topic's three unrelated questions matched nothing
 * together, and the map's candidates were forum threads and a coffee-scale blog
 * (2026-09-28). A part of one or two words is searched with the subject before the colon
 * ("Stripe: pricing, webhooks" -> "Stripe pricing"); a longer part stands alone, because a
 * subject is often a private name no search engine knows. A list with a one-word item and no
 * subject ("Paris, France hotels") is not compound. Anything else keeps the four searches it
 * always had.
 */
/** A part that leans on what came before it: a third-person pronoun, or "this"/"these"/"those". */
const REFERS_BACK = /\b(they|them|their|theirs|it|its|this|these|those)\b/i;
/** A part that opens with "the" presupposes a referent the same way (ADR-0103): "the bot limiter". */
const OPENS_DEFINITE = /^the\s/i;

export function topicQueries(topic) {
  const text = String(topic ?? '').trim();
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  const colon = text.search(/:\s/);
  const subject = colon > 0 ? text.slice(0, colon).trim() : '';
  const items = (colon > 0 ? text.slice(colon + 1) : text).split(/[,;]/)
    .map((item) => item.trim().replace(/^and\s+/i, '').trim()).filter(Boolean);
  if (items.length >= 2) {
    // A short part carries the subject (ADR-0085), and so does a part that points back at it
    // with a pronoun ("which encodings they also mask", ADR-0098): alone, it names nothing.
    // A part that opens with "the" does too (ADR-0103): "the bot limiter" alone found audio limiters.
    const leans = (item) => words(item) <= 2 || REFERS_BACK.test(item) || OPENS_DEFINITE.test(item);
    const parts = items.map((item) => (subject && leans(item) ? `${subject} ${item}` : item));
    if (parts.every((part) => words(part) >= 2)) return uniq(parts).slice(0, MAX_TOPIC_PARTS);
  }
  return uniq([text, `${text} documentation`, `${text} pricing limits`, `${text} terms of service`]);
}

const isCompound = (queries, topic) => !queries.includes(String(topic ?? '').trim());

/** Round-robin over the queries that found each page, each query's own rank order kept. */
export function interleaveByQuery(material, queries) {
  const lanes = queries.map((query) => material.filter((row) => row.foundBy === query));
  const out = [];
  for (let i = 0; lanes.some((lane) => i < lane.length); i += 1) {
    for (const lane of lanes) if (i < lane.length) out.push(lane[i]);
  }
  // A row found by no listed query (none today) is kept, after the rest.
  return [...out, ...material.filter((row) => !queries.includes(row.foundBy))];
}

export function decompose(root, {
  topic,
  adapter,
  searchAdapter = null,
  // A MERGED selection (a SerpAPI key beside the fetch provider): every one is asked each
  // query and the lists are interleaved by rank, as research.mjs does (ADR-0027). The CLI
  // passed only the first, while printing that both were searched (found 2026-09-28).
  searchAdapters = null,
  recipe = '',
  limit = 8,
  maxScrapes = 0,
  refreshDays = 30,
  dryRun = false,
  force = false,
  date = today(),
  now = new Date(),
  log = () => {},
} = {}) {
  // A budget that is not a number is a refusal, not a cap of NaN: every comparison
  // against NaN is false, so an unvalidated flag silently removes the cap it looks like
  // it is setting.
  if (!Number.isInteger(maxScrapes) || maxScrapes < 0) {
    const err = new Error(`--max-scrapes must be a whole number of pages, not "${maxScrapes}"`);
    err.code = 'INVALID_BUDGET';
    throw err;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    const err = new Error(`--limit must be a positive whole number, not "${limit}"`);
    err.code = 'INVALID_BUDGET';
    throw err;
  }

  const file = resolve(root, PATHS.map);
  const existing = readText(file, '');
  if (existing.trim() && !force && !/^\s*$/.test(existing) && existing.includes('| ID |')) {
    const filled = existing.match(/\|\s*(COVERED|DISMISSED|GAP)\s*\|/);
    if (filled) {
      return { written: false, reason: `${PATHS.map} already holds judged rows - re-run with --force to redraft over them` };
    }
  }

  const loaded = recipe ? loadRecipe(recipe) : { name: '', dimensions: [] };
  const rows = seedRows(loaded.dimensions);
  // A failed search is kept, not just printed: a map written after every search failed
  // looks exactly like a map written from a quiet topic. The session hands one row per
  // failed ask (ADR-0135); the map and `searchSummary` read them from here.
  const failures = [];
  // HOW a query is put to the search providers is the session's (ADR-0135), shared with
  // `runResearch`: the merge, the one degrade to the fetch provider's own search, the
  // meters. Phase 0 asks once per query, with no rate-limit patience (one call, as before).
  const session = searchSession({ adapter, searchAdapter, searchAdapters, limit, maxRateLimitRetries: 0, log, record: (row) => failures.push(row) });
  // A search provider that cannot run is refused before anything is spent, as `runResearch`
  // refuses it (ADR-0135): until then only the CLI checked, so a library caller searched
  // through a provider with no key and degraded onto the fetch provider's meter.
  session.assertReady();
  // A ledger that cannot record a fetch is refused BEFORE any provider is asked, as
  // `runResearch` does (ADR-0122): phase 0 spends too, and on a damaged ledger it made four
  // searches and one fetch before `collectOne` threw (outside audit, 2026-10-03). The dry run
  // is refused the same way.
  assertAppendable(root);
  const corpus = readCorpus(root);

  let material = [];
  let hosts = [];
  let ownerSkipped = [];
  let spent = 0;
  let searches = 0;
  let cached = 0;
  let failedScrapes = 0;

  const queries = topicQueries(topic);
  if (isCompound(queries, topic)) log(`compound topic: searching each of its ${queries.length} parts, not the whole topic (ADR-0085)`);
  if (dryRun) {
    // Named, as research's dry run names its queries: the dry run seeded the map and said
    // nothing about the four searches a real run spends (found 2026-09-27).
    const meter = session.meter || 'the search provider this machine selects';
    for (const query of queries) log(`  would search "${query}" on ${meter}, keeping up to ${limit} result(s)`);
    if (maxScrapes > 0) log(`  and scrape up to ${maxScrapes} of the pages found`);
  }
  if (!dryRun && adapter) {
    searches = queries.length;
    const seen = new Set();
    for (const query of queries) {
      const found = session.ask(query);
      if (!found.ok) continue;
      for (const row of found.results) {
        // One page, one candidate - the identity runResearch uses (urlKey). Only an http(s)
        // page is material: a `file:` or `javascript:` result reached the fetch adapter.
        if (!isWebUrl(row.url) || seen.has(urlKey(row.url))) continue;
        seen.add(urlKey(row.url));
        // Under a merge every finder is named - a URL both returned is attributed to both;
        // alone, the provider that ranked it (DR-2).
        const rankedBy = found.merged ? (row.providers ?? [row.provider]).filter(Boolean).join('+') : found.provider;
        material.push({ ...row, rankedBy, foundBy: query });
      }
    }
    // Each part of a compound topic gets its share of the list: in search order, the first
    // parts filled the 20 the map shows, and the MoonAliza map listed nothing for its third
    // question (2026-09-28). Taken in turn, one per part, each part keeping its own order.
    if (isCompound(queries, topic)) material = interleaveByQuery(material, queries);
    hosts = docsHosts(material);

    // The budget bounds SCRAPES, not candidates: a cache hit is not an attempt, so a
    // second pass reaches further down the list instead of re-reading the same two.
    // A page on the top likely owner that the floor skips is NAMED, not scraped (ADR-0097):
    // the owner's terse "OpenAI compatibility" page and postgresql.org's home page look the
    // same to the floor, so the choice goes to the reviewer. Only an owner that earned it
    // - a docs host, or repeated mentions - so a flat ranking names nothing.
    const topScore = hosts[0]?.score ?? 0;
    const topOwners = new Set(topScore >= MIN_NAMED_OWNER_SCORE
      ? hosts.filter((h) => h.score === topScore).map((h) => h.host) : []);
    ownerSkipped = [];
    for (const row of scrapeOrder(material, hosts)) {
      if (spent >= maxScrapes) break;
      // The relevance floor research.mjs applies (ADR-0067, ADR-0068), for the query that
      // found this page. It stays in the map's candidate list - that is for a person to read -
      // but it is not worth a scrape (found 2026-09-27: this loop never applied the floor).
      if (!matchesQuery(row, row.foundBy)) {
        const owner = ownerOf(row.url);
        if (topOwners.has(owner)) ownerSkipped.push({ ...row, owner });
        log(`  skipped   ${row.url} - it does not carry "${row.foundBy}"${topOwners.has(owner) ? ` (on the likely owner ${owner} - named in the map)` : ''}`);
        continue;
      }
      const decision = cacheDecision(corpus.captures, row.url, { refreshDays, now });
      if (decision.hit) { cached += 1; log(`  cached    ${row.url}`); continue; }
      const outcome = collectOne(root, row.url, {
        runScrape: (url) => adapter.runScrape(url),
        corpus,
        type: DEFAULT_SOURCE_TYPE,
        usedFor: `phase 0: ${topic}`,
        refreshDays,
        date,
        now,
        transportName: adapter.name,
        // Every URL here came from a ranking - decompose has no plan file to read from -
        // so unlike `runResearch` this is never empty (DR-2).
        discoveredBy: row.rankedBy ?? '',
      });
      if (outcome.status === 'collected' || outcome.status === 'failed') spent += 1;
      if (outcome.status === 'failed') failedScrapes += 1;
      log(`  ${outcome.status.padEnd(9)} ${row.url}`);
    }

    // Phase 0 is mostly searching, and a search spends on its provider's meter. Found
    // 2026-09-27: two runs made 8 SerpAPI searches - the vendor counted them - and
    // `research.mjs --status` counted 0, because only research-run wrote a usage row. The
    // same row, for the same reason research-run writes one for a search-only run (DR-1).
    const { searchesUsed, searchesOn, searchCreditsEstimate, searchFailures, degraded } = session.meters();
    if (spent || searchesUsed) {
      appendJsonLine(root, PATHS.usage, {
        at: new Date().toISOString(), command: 'decompose', budget: maxScrapes,
        attempts: spent, spent, cached, failed: failedScrapes,
        transport: adapter.name,
        searchTransport: session.name,
        searchesUsed,
        searchesOn,
        ...(searchCreditsEstimate ? { searchCreditsEstimate } : {}),
        searchFailures,
        degraded,
      });
    }
  }

  // Read after the scrapes, so the pages this run captured are outlined too. No fetch: only
  // what is already on disk.
  const outlines = material.length ? outlinesOf(root, corpus.captures, material) : null;
  writeText(file, mapBody({ topic, rows, hosts, material: material.slice(0, 20), date, recipe: loaded.name || recipe, failures, dryRun: dryRun || !adapter, outlines, ownerSkipped }));
  return {
    written: true,
    outlines: outlines?.outlines.length ?? 0,
    // "nothing was found" and "every attempt failed" are different answers.
    gathered: material.length > 0,
    failures,
    searches,
    file: PATHS.map,
    rows: rows.length,
    universal: UNIVERSAL_DIMENSIONS.length,
    added: loaded.dimensions.length,
    recipe: loaded.name || recipe,
    material: material.length,
    hosts,
    spent,
  };
}

/**
 * The line the CLI prints about searching, or '' when every search answered first time.
 * A degradation is counted as answered - the query did get results - but never silently:
 * it moved spend onto the fetch budget, as `research.mjs` says of its own fallbacks.
 */
export function searchSummary({ searches = 0, failures = [], gathered = false } = {}) {
  if (!failures.length) return '';
  const lostQueries = new Set(failures.filter((f) => !f.degraded && !f.covered).map((f) => f.query));
  // Under a merge, one provider missing a query another answered loses nothing.
  const covered = failures.filter((f) => f.covered);
  const missedBy = [...new Set(covered.map((f) => f.provider))];
  const fellBack = new Set(failures.filter((f) => f.degraded).map((f) => f.query));
  // Only a fallback that ANSWERED is known to have spent: one that failed too is a lost query.
  const rescued = [...fellBack].filter((q) => !lostQueries.has(q)).length;
  const lost = lostQueries.size;
  const lines = [`searches   ${searches - lost} of ${searches} searches answered`
    + (lost ? `, ${lost} failed` : '')
    + (fellBack.size ? `; ${fellBack.size} fell back to the fetch provider` : '')
    + (rescued ? `, ${rescued} answered there - those spent FETCH credits` : '')
    + (covered.length ? `; ${missedBy.join(', ')} missed ${covered.length} that the other provider answered` : '')
    + ' (reasons in research/MAP.md)'];
  if (!gathered && lost) {
    lines.push('NOTHING gathered: every search failed, so the map is the bare checklist. Re-run once the provider answers.');
  }
  return lines.join('\n');
}
