// Phase 0 gathers material and seeds the checklist. It contains NO judgment: it hands
// over statuses BLANK, and `subtopic-coverage` is what judges them afterwards.

import { spawnSync } from 'node:child_process';
import { test, describe, assert, makeProject, makePassingProject, fs, path, KIT_ROOT } from './harness.mjs';
import { PATHS, resolve, readText, listFiles } from '../lib/core.mjs';
import { decompose, parseRecipe, loadRecipe, docsHosts, scrapeOrder, ownerOf, topicQueries, RECIPE_DIR, searchSummary, outlineOf, resolveTopic } from '../lib/decompose.mjs';
import { UNIVERSAL_DIMENSIONS, seedRows, coverageOfUniversals } from '../lib/dimensions.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { searchUsage } from '../lib/research-run.mjs';
import { runCheck } from '../lib/checks.mjs';

describe('decompose');

const PAGE = `# Limits\n\n${'The free plan allows 10 requests per minute and includes 1,000 credits. '.repeat(25)}`;

function stubAdapter(results = []) {
  return {
    name: 'stub-transport',
    search: (query) => ({ ok: true, query, results }),
    runScrape: (url) => ({ ok: true, url, title: 'Limits', markdown: PAGE, statusCode: 200, transport: 'stub-transport', completeness: 'full', cmd: `stub scrape ${url}` }),
  };
}

// Found 2026-10-03 (outside audit): `runResearch` refuses a ledger that cannot record a fetch
// BEFORE it asks a provider anything (ADR-0122), so no credit is spent on a run whose
// captures handoff would refuse. `decompose` did not: on the same damaged ledger it made
// four searches and one fetch, then threw LEDGER_DAMAGED from inside collectOne. Phase 0
// spends too, so it asks first.
test('a damaged ledger is refused before decompose asks any provider', () => {
  const dir = makeProject();
  fs.writeFileSync(resolve(dir, PATHS.ledger), '{broken ledger\n');
  let searches = 0;
  let fetches = 0;
  const adapter = {
    name: 'stub-transport',
    search: (query) => { searches += 1; return { ok: true, query, results: [{ url: 'https://docs.example.com/a', title: 'A' }] }; },
    runScrape: (url) => { fetches += 1; return { ok: true, url, title: 'A', markdown: PAGE, statusCode: 200, transport: 'stub-transport', completeness: 'full', cmd: `stub scrape ${url}` }; },
  };
  assert.throws(() => decompose(dir, { topic: 'Widget pricing', adapter, maxScrapes: 1 }), (err) => err.code === 'LEDGER_DAMAGED');
  assert.equal(searches, 0, `${searches} search(es) were made against a ledger that cannot record their result`);
  assert.equal(fetches, 0, `${fetches} fetch(es) were made against a ledger that cannot record them`);
  // The dry run is refused the same way: a preview that says "this will collect" onto a chain
  // that cannot record it is worse than no preview.
  assert.throws(() => decompose(dir, { topic: 'Widget pricing', adapter, maxScrapes: 1, dryRun: true }), (err) => err.code === 'LEDGER_DAMAGED');
  assert.equal(searches, 0);
});

// ADR-0135: `runResearch` refused a search provider that reports `notReady` before anything
// was spent; `decompose` did not - only its CLI did, so a library caller could spend. The
// session refuses for both.
test('a search provider that is not ready is refused before decompose asks any provider, and nothing is spent', () => {
  const dir = makeProject();
  let searches = 0;
  let fetches = 0;
  const adapter = {
    name: 'stub-transport',
    search: (query) => { searches += 1; return { ok: true, query, results: [{ url: 'https://docs.example.com/a', title: 'A' }] }; },
    runScrape: (url) => { fetches += 1; return { ok: true, url, title: 'A', markdown: PAGE, statusCode: 200, transport: 'stub-transport', completeness: 'full', cmd: `stub scrape ${url}` }; },
  };
  const notReady = { name: 'serpapi', notReady: 'serpapi: no key is configured', search: (query) => { searches += 1; return { ok: true, query, results: [] }; } };
  assert.throws(() => decompose(dir, { topic: 'Widget pricing', adapter, searchAdapter: notReady, maxScrapes: 1 }),
    (err) => err.code === 'SEARCH_PROVIDER_NOT_READY' && err.message === 'serpapi: no key is configured');
  assert.equal(searches, 0, `${searches} search(es) were made through a provider that cannot run`);
  assert.equal(fetches, 0, `${fetches} fetch(es) were made after a refused search provider`);
  assert.equal(fs.existsSync(resolve(dir, PATHS.usage)), false, 'a usage row was written for a run that was refused');
  assert.equal(readText(resolve(dir, PATHS.map), ''), '', 'the map was drafted by a run that was refused');
  // The dry run is refused the same way, as research's is: a preview that says "this will
  // search" through a provider that cannot is worse than no preview.
  assert.throws(() => decompose(dir, { topic: 'Widget pricing', adapter, searchAdapter: notReady, maxScrapes: 1, dryRun: true }), (err) => err.code === 'SEARCH_PROVIDER_NOT_READY');
  assert.equal(searches, 0);
});

// ADR-0135's one accounting rule, as decompose's usage row now reports it: a search that failed
// on the search provider and was answered by the fetch provider's own search is one failed
// ask and one degrade. The row had counted the degraded ask as no failure, and had counted a
// degrade whether or not it answered.
test('decompose\'s usage row counts a degraded query as research does: one failure, one degrade that answered', () => {
  const dir = makeProject();
  // The fetch adapter reports its usage, as a real one does; without a reported search the
  // usage row is not written at all (a search-only run that spent nothing is not recorded).
  const adapter = { ...stubAdapter(), search: (query) => ({ ok: true, query, searchesUsed: 1, results: [{ url: 'https://docs.example.com/limits', title: 'Limits' }] }) };
  const searcher = { name: 'stub-search', search: (query) => ({ ok: false, query, results: [], error: 'quota exhausted' }) };
  const lines = [];
  const out = decompose(dir, { topic: 'Widget pricing', adapter, searchAdapter: searcher, maxScrapes: 0, log: (l) => lines.push(l) });
  assert.equal(out.written, true);
  assert.deepEqual(out.failures, [
    { query: 'Widget pricing', error: 'quota exhausted', provider: 'stub-search', degraded: true, fellBackTo: 'stub-transport' },
  ].concat(out.failures.slice(1)), 'the first failure row is the degrade, shaped as the map reads it');
  assert.equal(out.failures.length, out.searches, 'every query failed once on the search provider');
  assert.ok(out.failures.every((f) => f.degraded && f.fellBackTo === 'stub-transport'));
  assert.equal(out.gathered, true, 'the fetch provider answered');
  const usage = JSON.parse(readText(resolve(dir, PATHS.usage), '').trim().split('\n').pop());
  assert.equal(usage.command, 'decompose');
  assert.equal(usage.searchTransport, 'stub-search', 'the paying provider names the search side');
  assert.equal(usage.searchFailures, out.searches, 'a degraded ask is a failed ask');
  assert.equal(usage.degraded, out.searches, 'every degrade answered');
  assert.ok(lines.some((l) => /^  search failed on stub-search: quota exhausted$/.test(l)));
  assert.ok(lines.some((l) => /^  degrading to stub-transport for this query/.test(l)));
  assert.ok(lines.some((l) => /^  search     found 1 for "Widget pricing" \(stub-transport\)$/.test(l)), `the session's found line is missing:\n${lines.join('\n')}`);
});

test('nine universal dimensions, and output obtainability is one of them', () => {
  assert.equal(UNIVERSAL_DIMENSIONS.length, 9);
  const names = UNIVERSAL_DIMENSIONS.map((d) => d.name);
  assert.ok(names.includes('Output obtainability'), 'the load-bearing one');
  assert.ok(names.some((n) => /ToS/.test(n)), 'legality is never droppable');
});

test('the seeded rows arrive with statuses BLANK - the tool hands over a checklist, not an answer', () => {
  const rows = seedRows();
  assert.equal(rows.length, 9);
  for (const row of rows) {
    assert.equal(row.status, '', `${row.id} arrived with a status`);
    assert.equal(row.coveredBy, '');
  }
});

test('a draft map holds every universal dimension and no status at all', () => {
  const dir = makeProject();
  const result = decompose(dir, { topic: 'Widget pricing', dryRun: true });
  assert.equal(result.written, true);

  const text = readText(resolve(dir, PATHS.map));
  assert.match(text, /Widget pricing/);
  for (const dimension of UNIVERSAL_DIMENSIONS) {
    assert.match(text, new RegExp(`\\| ${dimension.id} \\|`), `${dimension.id} is missing from the draft`);
  }
  assert.doesNotMatch(text, /\|\s*(COVERED|DISMISSED|GAP)\s*\|/, 'phase 0 writes no status');

  // And the gate says so: an unstatused row is a GAP until the agent fills it.
  const corpus = readCorpus(dir);
  const findings = runCheck('subtopic-coverage', corpus);
  assert.ok(findings.some((f) => f.severity === 'fail' && f.rule === 'gap'));
});

test('a recipe ADDS dimensions on top of the universal set and never replaces it', () => {
  const dir = makeProject();
  const result = decompose(dir, { topic: 'Some API', recipe: 'api-integration', dryRun: true });
  assert.equal(result.universal, 9);
  assert.ok(result.added > 0);

  const corpus = readCorpus(dir);
  assert.equal(coverageOfUniversals(corpus.subtopics).missing.length, 0,
    'a recipe that silently dropped legality would be worse than no recipe');
  assert.ok(corpus.subtopics.length > 9);
  assert.ok(corpus.subtopics.some((row) => row.id.startsWith('S-')));
});

test('every shipped recipe keeps the universal set whole', () => {
  const names = listFiles(RECIPE_DIR).filter((n) => n.endsWith('.md')).map((n) => n.replace(/\.md$/, ''));
  assert.equal(names.length, 5);
  for (const name of names) {
    const dir = makeProject();
    decompose(dir, { topic: 'Anything', recipe: name, dryRun: true });
    const missing = coverageOfUniversals(readCorpus(dir).subtopics).missing;
    assert.deepEqual(missing.map((m) => m.dimension.id), [], `${name} dropped a universal dimension`);
  }
});

test('an unknown recipe is an error naming where recipes live', () => {
  assert.throws(() => loadRecipe('no-such-recipe'), /no recipe/);
});

const invalidRecipes = [
  ['plain.md', '# Just a document\n\nNo dimensions.\n', /holds no dimensions/],
  ['empty.md', '---\nname: empty\ndimensions:\n---\n', /holds no dimensions/],
  ['blank.md', '---\r\nname: blank\r\ndescription: test\r\ndimensions:\r\n  -  | a reason only\r\n---\r\n', /line 5.*blank/],
];

test('an existing recipe with no dimensions or a blank label is refused by file and line', () => {
  const dir = makeProject();
  for (const [name, text, reason] of invalidRecipes) {
    const file = resolve(dir, name);
    fs.writeFileSync(file, text);
    assert.throws(() => loadRecipe(file), (err) => {
      assert.equal(err.code, 'INVALID_RECIPE');
      assert.ok(err.message.includes(file), err.message);
      assert.match(err.message, reason);
      return true;
    });
  }
});

test('invalid recipe content is CLI usage failure and leaves the map and ledger untouched', () => {
  for (const [name, text, reason] of invalidRecipes) {
    const dir = makePassingProject();
    // Exercise recipe validation rather than the earlier refusal to replace judged rows.
    fs.writeFileSync(resolve(dir, PATHS.map), '# An unclassified draft\n');
    const file = resolve(dir, name);
    fs.writeFileSync(file, text);
    const beforeMap = readText(resolve(dir, PATHS.map));
    const beforeLedger = readText(resolve(dir, PATHS.ledger));
    const result = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin/decompose.mjs'),
      '--recipe', file, '--dry-run', '--transport', 'http-keyless', '--search-transport', 'http-keyless'],
    { cwd: dir, encoding: 'utf8', timeout: 20000, windowsHide: true });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, reason);
    assert.ok(result.stderr.includes(file), result.stderr);
    assert.doesNotMatch(result.stderr, /\n\s+at /, 'usage failures must not print a stack');
    assert.equal(readText(resolve(dir, PATHS.map)), beforeMap);
    assert.equal(readText(resolve(dir, PATHS.ledger)), beforeLedger);
  }
});

test('parseRecipe reads the machine-readable frontmatter', () => {
  const { name, dimensions } = parseRecipe('---\nname: sample\ndimensions:\n  - First thing | why it matters\n  - Second thing | another reason\n---\n\nprose\n');
  assert.equal(name, 'sample');
  assert.deepEqual(dimensions, [
    { name: 'First thing', why: 'why it matters' },
    { name: 'Second thing', why: 'another reason' },
  ]);
});

test('docsHosts ranks the hosts that keep owning the facts', () => {
  const hosts = docsHosts([
    { url: 'https://docs.example.com/a' },
    { url: 'https://docs.example.com/pricing' },
    { url: 'https://blog.other.com/x' },
  ]);
  assert.equal(hosts[0].host, 'docs.example.com');
  assert.ok(hosts[0].score > hosts[1].score);
});

// Found 2026-09-29 on MoonAliza's context-overflow map: github.com scored 7 as one "owner",
// so all three phase-0 scrapes went to strangers' repositories and issues, and the owner's
// docs host (docs.ollama.com, 4) got none. On a shared code host the owner is the account.
test('on a shared host the owner is the account, so strangers do not pool into one owner', () => {
  assert.equal(ownerOf('https://github.com/ollama/ollama/issues/2204'), 'github.com/ollama');
  assert.equal(ownerOf('https://raw.githubusercontent.com/ollama/ollama/main/x.go'), 'raw.githubusercontent.com/ollama');
  assert.equal(ownerOf('https://www.docs.ollama.com/api'), 'docs.ollama.com');
  assert.equal(ownerOf('https://github.com/'), 'github.com');
  // Found the same day on the secret-masking map: github.com/orgs/community/... ranked as the
  // owner "github.com/orgs". The account is the segment after orgs/ or users/; GitHub's own
  // sections (topics, marketplace, ...) belong to GitHub.
  assert.equal(ownerOf('https://github.com/orgs/community/discussions/13082'), 'github.com/community');
  assert.equal(ownerOf('https://github.com/users/octocat/projects/1'), 'github.com/octocat');
  assert.equal(ownerOf('https://github.com/topics/secrets'), 'github.com');
  assert.equal(ownerOf('https://github.com/marketplace/actions/x'), 'github.com');
  const material = [
    'https://github.com/jetelain/OllamaRouter',
    'https://www.reddit.com/r/ollama/comments/1j0pls3/x/',
    'https://docs.openwebui.com/troubleshooting/context-window/',
    'https://github.com/continuedev/continue/issues/9797',
    'https://community.openai.com/t/context-limit-token-issue/901481',
    'https://github.com/open-webui/computer/blob/main/CHANGELOG.md',
    'https://docs.ollama.com/api/openai-compatibility',
    'https://github.com/earendil-works/pi/issues/2626',
    'https://github.com/ollama/ollama/issues/2204',
  ].map((url) => ({ url }));
  const hosts = docsHosts(material);
  assert.ok(!hosts.some((h) => h.host === 'github.com'), JSON.stringify(hosts));
  const order = scrapeOrder(material, hosts).map((r) => r.url);
  assert.ok(order.indexOf('https://docs.ollama.com/api/openai-compatibility') < order.indexOf('https://github.com/jetelain/OllamaRouter'), order.join('\n'));
});

// Found 2026-09-29 on MoonAliza's secret-masking map: "... , and which encodings they also
// mask" was searched alone, and "they" points at nothing - the search returned an IDL manual
// on character encoding. A part that refers back to the subject carries it (ADR-0098).
test('a topic part that refers back with a pronoun carries the subject; others stay alone', () => {
  const parts = topicQueries('Masking secrets in streamed output: how CI runners mask a secret split across chunks, and which encodings they also mask');
  assert.deepEqual(parts, [
    'how CI runners mask a secret split across chunks',
    'Masking secrets in streamed output which encodings they also mask',
  ]);
  // ADR-0085 unchanged: a long part with no back-reference is searched alone.
  assert.deepEqual(topicQueries('MoonAliza: how Ollama streams tool calls, what OpenAI returns on overflow'),
    ['how Ollama streams tool calls', 'what OpenAI returns on overflow']);
});

// Found 2026-09-30 decomposing the SearXNG topic: "... : the JSON output format, ..., and the bot
// limiter" searched "the bot limiter" alone, and the map's candidates were audio mastering
// limiters and JSON formatters. A part that opens with "the" presupposes a referent, as a
// pronoun does, so it carries the subject too (ADR-0103).
test('a topic part that opens with "the" carries the subject, like a pronoun part', () => {
  assert.deepEqual(topicQueries('SearXNG search API: the JSON output format, its query parameters, and the bot limiter'), [
    'SearXNG search API the JSON output format',
    'SearXNG search API its query parameters',
    'SearXNG search API the bot limiter',
  ]);
  // Only at the start: "the" inside a part is not a back-reference.
  assert.deepEqual(topicQueries('MoonAliza: how Ollama streams the tool calls, what OpenAI returns on overflow'),
    ['how Ollama streams the tool calls', 'what OpenAI returns on overflow']);
});

test('a dry run gathers nothing and spends nothing', () => {
  const dir = makeProject();
  let searched = 0;
  decompose(dir, { topic: 'Anything', adapter: { search: () => { searched += 1; return { ok: true, results: [] }; } }, dryRun: true });
  assert.equal(searched, 0);
  assert.equal(readCorpus(dir).captures.entries.length, 0);
});

test('gathering records the candidate material and the likely owners', () => {
  const dir = makeProject();
  const result = decompose(dir, {
    topic: 'Example limits',
    adapter: stubAdapter([
      { url: 'https://docs.example.com/rate-limits', title: 'Rate limits' },
      { url: 'https://blog.other.com/opinion', title: 'Opinion' },
    ]),
  });
  assert.ok(result.material > 0);
  const text = readText(resolve(dir, PATHS.map));
  assert.match(text, /docs\.example\.com/);
  assert.match(text, /\[Rate limits\]\(https:\/\/docs\.example\.com\/rate-limits\)/);
});

test('--max-scrapes bounds what phase 0 may cost, and a cache hit is not an attempt', () => {
  const dir = makeProject();
  const results = [
    { url: 'https://docs.example.com/a', title: 'A' },
    { url: 'https://docs.example.com/b', title: 'B' },
    { url: 'https://docs.example.com/c', title: 'C' },
  ];
  const first = decompose(dir, { topic: 'Example', adapter: stubAdapter(results), maxScrapes: 2, force: true });
  assert.equal(first.spent, 2);

  const second = decompose(dir, { topic: 'Example', adapter: stubAdapter(results), maxScrapes: 2, force: true });
  assert.equal(second.spent, 1, 'the two already collected are cache hits and cost nothing');
});

test('a map that already holds judged rows is not redrafted over without --force', () => {
  const dir = makePassingProject();
  const refused = decompose(dir, { topic: 'Something else', dryRun: true });
  assert.equal(refused.written, false);
  assert.match(refused.reason, /--force/);
  assert.match(readText(resolve(dir, PATHS.map)), /COVERED/, 'the judged map is untouched');

  assert.equal(decompose(dir, { topic: 'Something else', dryRun: true, force: true }).written, true);
});

// ---------------------------------------------------------------- failed searches
//
// Found 2026-09-26: `decompose` kept its failures in the result (F20) and then dropped them
// on the floor. The map said "No material gathered - run without --dry-run" after every
// search had failed on a live run, and the CLI printed the same success paragraph either
// way - so a map drafted from an outage read exactly like a map of a quiet topic.

const failing = (error) => ({ name: 'stub-transport', search: () => ({ ok: false, error }), runScrape: () => ({ ok: false }) });

test('a map drafted after every search failed says so, and names the failure', () => {
  const dir = makeProject();
  decompose(dir, { topic: 'Example', adapter: failing('HTTP 402 Payment Required') });
  const map = readText(resolve(dir, PATHS.map));
  assert.match(map, /every search failed/i, 'the map does not say its searches failed');
  assert.match(map, /HTTP 402 Payment Required/, 'the map does not carry the reason');
  assert.ok(!/run without `--dry-run`/.test(map), 'the map blames a dry run that never happened');
});

test('a quiet topic and a dry run are still told apart from an outage', () => {
  const quiet = makeProject();
  decompose(quiet, { topic: 'Example', adapter: stubAdapter([]) });
  const quietMap = readText(resolve(quiet, PATHS.map));
  assert.ok(!/search failed|every search failed/i.test(quietMap), 'a quiet topic is reported as a failure');
  assert.ok(!/run without `--dry-run`/.test(quietMap), 'a live run that found nothing is told to stop dry-running');

  const dry = makeProject();
  decompose(dry, { topic: 'Example', adapter: stubAdapter([]), dryRun: true });
  assert.match(readText(resolve(dry, PATHS.map)), /run without `--dry-run`/, 'the dry-run hint is gone');
});

test('a query that fell back to the fetch provider is recorded as a degradation', () => {
  const dir = makeProject();
  const searchAdapter = { name: 'stub-search', search: () => ({ ok: false, error: 'rate limited' }) };
  const out = decompose(dir, { topic: 'Example', adapter: stubAdapter([{ url: 'https://docs.example.com/a', title: 'A' }]), searchAdapter });
  assert.equal(out.gathered, true);
  const map = readText(resolve(dir, PATHS.map));
  assert.match(map, /stub-search/, 'the provider that failed is not named');
  assert.match(map, /fell back to stub-transport/, 'the fallback is not recorded');
});

test('a failure written into the map never carries a credential', () => {
  // MAP.md is committed. An error string is vendor text, and vendor text has echoed keys.
  const dir = makeProject();
  const key = 'a'.repeat(24) + '0123456789abcdef'.repeat(3);
  decompose(dir, { topic: 'Example', adapter: failing(`GET https://x.invalid/search?q=t&api_key=${key} failed\nsecond line ${key}`) });
  const map = readText(resolve(dir, PATHS.map));
  assert.ok(!map.includes(key), 'a credential-shaped string reached the committed map');
  assert.ok(!/second line/.test(map), 'the map carries a multi-line error instead of its first line');
});

test('the CLI summary counts the searches that failed, and says when nothing was gathered', () => {
  assert.equal(searchSummary({ searches: 4, failures: [], gathered: true }), '', 'a clean run needs no line');
  const outage = searchSummary({ searches: 4, gathered: false, failures: [1, 2, 3, 4].map((n) => ({ query: `q${n}`, error: 'x', provider: 's' })) });
  assert.match(outage, /0 of 4 searches answered/);
  assert.match(outage, /NOTHING gathered/);
  const degraded = searchSummary({ searches: 4, gathered: true, failures: [{ query: 'q1', error: 'x', provider: 's', degraded: true }] });
  assert.match(degraded, /4 of 4 searches answered/);
  assert.match(degraded, /1 fell back/);
  assert.match(degraded, /FETCH credits/);
  // Found by running the CLI into a real outage: every fallback failed too, and the line
  // still said those queries "spent FETCH credits".
  const both = searchSummary({ searches: 1, gathered: false, failures: [
    { query: 'q1', error: 'x', provider: 's', degraded: true },
    { query: 'q1', error: 'y', provider: 'f' },
  ] });
  assert.match(both, /0 of 1 searches answered, 1 failed; 1 fell back/);
  assert.ok(!/FETCH credits/.test(both), 'a fallback that failed too is claimed to have spent');
});

// Found 2026-09-27: two decompose runs made 8 SerpAPI searches in an hour - the vendor's own meter
// said "8 this hour" - and research.mjs --status counted 0. decompose wrote no usage row, so the
// one command that does nothing but search was invisible to the local meter. research-run
// records a search-only run for exactly that reason (DR-1).
test('phase 0 records the searches it spent, so the local meter sees them', () => {
  const dir = makeProject();
  const searchAdapter = { name: 'serpapi', search: (query) => ({ ok: true, query, results: [{ url: 'https://docs.example.com/a', title: 'A' }], searchesUsed: 1 }) };
  decompose(dir, { topic: 'Example limits', adapter: stubAdapter([]), searchAdapter });
  const usage = searchUsage(dir);
  assert.equal(usage.thisMonth, 4, `phase 0 searched four times and the meter saw ${usage.thisMonth}`);
  assert.equal(usage.lastHour, 4);
  assert.deepEqual(usage.providers, ['serpapi']);

  const dry = makeProject();
  decompose(dry, { topic: 'Example limits', adapter: stubAdapter([]), searchAdapter, dryRun: true });
  assert.equal(searchUsage(dry).thisMonth, 0, 'a dry run spends nothing, and records nothing');
});

test('phase 0 lists one page once, whatever its spelling', () => {
  // The same identity runResearch uses (urlKey): a trailing slash or www. is not a second
  // candidate, and with a scrape budget would not be a second fetch.
  const dir = makeProject();
  const out = decompose(dir, { topic: 'Example', adapter: stubAdapter([
    { url: 'https://docs.example.com/a', title: 'A' },
    { url: 'https://www.docs.example.com/a/', title: 'A again' },
  ]) });
  assert.equal(out.material, 1, 'two spellings of one page were listed as two candidates');
});

// Found 2026-09-27: a dry run seeded the map and said nothing about the searches a real run
// would make - four on the search meter - so it previewed none of the cost it exists to show.
test('a dry run names every search a real run would make, and on whose meter', () => {
  const dir = makeProject();
  const lines = [];
  let searched = 0;
  const adapter = { name: 'stub-fetch', search: () => { searched += 1; return { ok: true, results: [] }; } };
  decompose(dir, { topic: 'Widget pricing', adapter, searchAdapter: { name: 'stub-search', search: adapter.search }, dryRun: true, log: (l) => lines.push(l) });
  assert.equal(searched, 0, 'a dry run searched');
  for (const q of ['Widget pricing', 'Widget pricing documentation', 'Widget pricing pricing limits', 'Widget pricing terms of service']) {
    assert.ok(lines.some((l) => l.includes(`would search "${q}" on stub-search`)), `not named: ${q}\n${lines.join('\n')}`);
  }
});

// Found 2026-09-27: `--recipe api` answered 'no recipe "api" - looked in <dir>' without
// naming the five that exist, one of them api-integration.
test('an unknown recipe names the recipes that exist', () => {
  assert.throws(() => loadRecipe('api'), (err) => {
    assert.equal(err.code, 'UNKNOWN_RECIPE');
    assert.match(err.message, /api-integration/);
    return true;
  });
});

// Found 2026-09-28 on MoonAliza: the topic "MoonAliza open gaps: accurate context accounting
// across providers, native SQLite in the packaged Electron app, Research Kit redistribution
// rights" was searched whole, four times, and the map's candidates were forum threads and a
// coffee-scale blog. A topic that lists several questions is searched one question at a time
// (ADR-0085).
test('a compound topic is searched part by part; a plain one keeps its four searches', async () => {
  const { topicQueries } = await import('../lib/decompose.mjs');
  assert.deepEqual(topicQueries('MoonAliza open gaps: accurate context accounting across providers, native SQLite in the packaged Electron app, Research Kit redistribution rights'),
    ['accurate context accounting across providers', 'native SQLite in the packaged Electron app', 'Research Kit redistribution rights']);
  // A part too short to search alone carries the subject before the colon.
  assert.deepEqual(topicQueries('Stripe: pricing, webhooks; rate limits'), ['Stripe pricing', 'Stripe webhooks', 'Stripe rate limits']);
  // Not compound: one list item is a single word, or there is only one part.
  for (const topic of ['Paris, France hotels', 'Widget pricing', 'Stripe: webhook retries']) {
    assert.deepEqual(topicQueries(topic), [topic, `${topic} documentation`, `${topic} pricing limits`, `${topic} terms of service`], topic);
  }
  // At most six parts are searched, so one topic cannot spend an unbounded number of searches.
  assert.equal(topicQueries(Array.from({ length: 9 }, (_, i) => `part number ${i}`).join(', ')).length, 6);

  const dir = makeProject();
  const searched = [];
  const lines = [];
  const adapter = { name: 'stub', search: (q) => { searched.push(q); return { ok: true, results: [] }; } };
  decompose(dir, { topic: 'Stripe: pricing, webhooks', adapter, log: (l) => lines.push(l) });
  assert.deepEqual(searched, ['Stripe pricing', 'Stripe webhooks']);

  // Each part gets its share of the 20 candidates the map lists; in search order the first
  // parts filled them all and the MoonAliza map showed nothing for its third question.
  const many = makeProject();
  const byQuery = (q) => Array.from({ length: 15 }, (_, i) => ({ url: `https://${q.toLowerCase().replace(/\W+/g, '-')}.example.com/${i}`, title: `${q} ${i}` }));
  decompose(many, { topic: 'Stripe: pricing, webhooks, rate limits', adapter: { name: 'stub', search: (q) => ({ ok: true, results: byQuery(q) }) } });
  const listed = readText(resolve(many, PATHS.map));
  for (const host of ['stripe-pricing', 'stripe-webhooks', 'stripe-rate-limits']) {
    assert.ok((listed.match(new RegExp(`${host}\\.example\\.com`, 'g')) ?? []).length >= 6, `${host} is under-represented:\n${listed}`);
  }
  assert.ok(lines.some((l) => /compound topic.*2 parts/.test(l)), lines.join('\n'));
});

// STORM's table-of-contents step, without the model (ADR-0091).
// Research: docs/decisions/2026-09-29-perspective-discovery.

test('outlineOf keeps a page\'s section headings and drops what a site prints around them', () => {
  const body = [
    '# Title is not a section',
    '## Rate limits',
    'text',
    '### Per-minute caps ##',
    '## [Pricing](https://example.com/pricing)',
    '## rate limits',
    '```',
    '## not a heading, inside code',
    '```',
    '## Uh oh!',
    '## Latest commit',
    '## In this article',
    '#### too deep',
    '## Permalink: something',
  ].join('\n');
  assert.deepEqual(outlineOf(body).headings, ['Rate limits', 'Per-minute caps', 'Pricing']);
  // Found on real captures: Mintlify docs put a zero-width space before every heading, and a
  // GitHub wiki ends with its clone box.
  assert.deepEqual(outlineOf('## \u200B Credits\n## Clone this wiki locally').headings, ['Credits']);
  // Found 2026-09-29 using the kit on MoonAliza: a GitHub file view's chrome and a Discourse
  // forum's per-post bylines were shown as the "outline" of the pages phase 0 captured.
  const chrome = ['## Collapse file tree', '## Files', '## File metadata and controls', '## Model selection',
    '## post by antmannacho on Feb 14, 2024', '## post by \\_j on Feb 15, 2024', '## Related topics'].join('\n');
  assert.deepEqual(outlineOf(chrome).headings, ['Model selection']);
  const many = Array.from({ length: 20 }, (_, i) => `## Part ${i}`).join('\n');
  const capped = outlineOf(many, { max: 5 });
  assert.equal(capped.headings.length, 5);
  assert.equal(capped.more, 15);
});

test('the map shows the outlines of the pages phase 0 captured, and no verdict on them', () => {
  const dir = makeProject();
  const outlined = `# Limits\n\n## Requests per minute\n\n${PAGE}\n\n## Credits per plan\n\ntext\n\n## Uh oh!\n`;
  const adapter = {
    ...stubAdapter([
      { url: 'https://docs.example.com/limits', title: 'Limits' },
      { url: 'https://docs.example.com/other', title: 'Other' },
    ]),
    runScrape: (url) => ({ ok: true, url, title: 'Limits', markdown: outlined, statusCode: 200, transport: 'stub-transport', completeness: 'full', cmd: `stub scrape ${url}` }),
  };
  const result = decompose(dir, { topic: 'Example limits', adapter, maxScrapes: 1 });
  assert.equal(result.outlines, 1);
  const text = readText(resolve(dir, PATHS.map));
  const section = text.slice(text.indexOf('## Outlines seen in the material'));
  assert.ok(text.includes('## Outlines seen in the material'));
  assert.match(section, /\[Limits\]\(https:\/\/docs\.example\.com\/limits\)/);
  assert.match(section, /Requests per minute/);
  assert.match(section, /Credits per plan/);
  assert.doesNotMatch(section, /Uh oh/);
  assert.doesNotMatch(section, /docs\.example\.com\/other/, 'a page not captured has no outline to show');
  assert.doesNotMatch(section, /\b(COVERED|DISMISSED|GAP)\b/);
  const findings = runCheck('subtopic-coverage', { ...readCorpus(dir), root: dir });
  assert.ok(findings.every((f) => !/unparsed|malformed/.test(f.rule ?? '')));
});

// ADR-0097. Found 2026-09-29 using the kit on MoonAliza: the map ranked docs.ollama.com the
// likely owner, and phase 0 skipped its "OpenAI compatibility - Ollama documentation" page
// because a terse title carried one term of a long topic. Trusting the owner past the floor
// brought back RR-9's postgresql.org home page, so the page is NAMED for the reviewer instead.
test('a floor-skipped page on the top likely owner is named in the map, not scraped', () => {
  const dir = makeProject();
  const results = [
    { url: 'https://blog.elsewhere.com/widget', title: 'Example widget throttling behaviour explained' },
    { url: 'https://docs.example.com/reference/a', title: 'Reference' },
    { url: 'https://docs.example.com/reference/b', title: 'Overview' },
  ];
  const result = decompose(dir, { topic: 'Example widget throttling behaviour', adapter: stubAdapter(results), maxScrapes: 1 });
  assert.equal(result.spent, 1);
  assert.deepEqual(readCorpus(dir).captures.entries.map((e) => e.url), ['https://blog.elsewhere.com/widget']);
  const map = readText(resolve(dir, PATHS.map));
  const section = map.slice(map.indexOf('Skipped on the likely owner'));
  assert.ok(map.includes('Skipped on the likely owner'), map);
  assert.match(section, /\[Reference\]\(https:\/\/docs\.example\.com\/reference\/a\) - `docs\.example\.com`/);
  assert.match(section, /research\/plan\.json/);
});

test('the floor holds for every page, the top owner\'s included', () => {
  const dir = makeProject();
  const results = [
    { url: 'https://docs.example.com/reference/a', title: 'Reference' },
    { url: 'https://docs.example.com/reference/b', title: 'Overview' },
    { url: 'https://unrelated.org/cats', title: 'Cats' },
  ];
  decompose(dir, { topic: 'Example widget throttling behaviour', adapter: stubAdapter(results), maxScrapes: 3 });
  const captured = readCorpus(dir).captures.entries.map((e) => e.url);
  assert.ok(!captured.includes('https://unrelated.org/cats'), captured.join(', '));
  assert.ok(!captured.some((u) => u.startsWith('https://docs.example.com/')), 'the owner is named, never scraped past the floor');
  // Every host at score 1 is not an owner at all: the floor holds for all of them.
  const flat = makeProject();
  decompose(flat, { topic: 'Example widget throttling behaviour', adapter: stubAdapter([
    { url: 'https://unrelated.org/cats', title: 'Cats' }, { url: 'https://other.net/dogs', title: 'Dogs' },
  ]), maxScrapes: 2 });
  assert.deepEqual(readCorpus(flat).captures.entries.map((e) => e.url), []);
  assert.ok(!readText(resolve(flat, PATHS.map)).includes('Skipped on the likely owner'), 'a flat ranking names no owner');
});

test('with nothing captured, the outline section says how to get one', () => {
  const dir = makeProject();
  decompose(dir, { topic: 'Example limits', adapter: stubAdapter([{ url: 'https://docs.example.com/limits', title: 'Limits' }]) });
  const text = readText(resolve(dir, PATHS.map));
  assert.match(text, /## Outlines seen in the material\n\n_No outlines - none of these pages is captured yet\. `--max-scrapes <n>`/);
});

// ADR-0094. Found 2026-09-29 using the kit on MoonAliza: the map ranked docs.ollama.com the
// likely owner (8), and --max-scrapes 2 spent both scrapes on the first two search results -
// a third-party spec on GitHub and a forum thread - because the budget followed search rank.
test('the scrape budget goes to the likely owners first, not to whatever ranked first', () => {
  const dir = makeProject();
  const results = [
    { url: 'https://blog.elsewhere.com/example-limits', title: 'Example limits, a blog' },
    { url: 'https://forum.other.org/t/example-limits', title: 'Example limits thread' },
    { url: 'https://docs.example.com/limits', title: 'Example limits' },
    { url: 'https://docs.example.com/api/limits', title: 'Example limits API' },
  ];
  const result = decompose(dir, { topic: 'Example limits', adapter: stubAdapter(results), maxScrapes: 1 });
  assert.equal(result.spent, 1);
  const captured = readCorpus(dir).captures.entries.map((e) => e.url);
  assert.deepEqual(captured, ['https://docs.example.com/limits'], `scraped ${captured.join(', ')}`);
  const map = readText(resolve(dir, PATHS.map));
  assert.ok(map.indexOf('blog.elsewhere.com/example-limits') < map.indexOf('docs.example.com/limits'),
    'the candidate list keeps search order - only the scrape budget is re-ordered');
});

// Found 2026-09-30 (break-test): a duplicate object key in plan.json keeps only the LAST value
// in JSON.parse, and decompose builds every search from that topic. So a project whose file
// names two topics would spend its credits on the second while the operator reads the first -
// and the gate that names the duplicate runs after collection, not before it.
test('a duplicate topic key in plan.json is refused before decompose searches anything', () => {
  const dir = makeProject();
  fs.writeFileSync(resolve(dir, PATHS.plan), '{ "topic": "alpha subject", "topic": "beta subject", "depth": "quick" }');
  const resolved = resolveTopic(dir, '');
  assert.match(String(resolved.error ?? ''), /duplicate object key "topic"/, JSON.stringify(resolved));
  assert.equal(resolved.topic, undefined, 'it picked one of the two values anyway');

  // And a plan with one topic still resolves, so the guard is not a blanket refusal.
  fs.writeFileSync(resolve(dir, PATHS.plan), '{ "topic": "one subject", "depth": "quick" }');
  const ok = resolveTopic(dir, '');
  assert.equal(ok.error, undefined, JSON.stringify(ok));
  assert.equal(ok.topic, 'one subject');
});

// Found 2026-10-01 (break-test, PR #178): with --transport browser, a failed search degraded
// to `adapter.search` - and the browser does not search (ADR-0088), so drafting the map ended
// in "adapter.search is not a function". The failure that happened is recorded instead.
test('drafting a map with a fetch-only transport records the failed search instead of crashing', () => {
  const browser = { name: 'browser', runScrape: () => ({ ok: false }) };
  const withSearch = decompose(makeProject(), { topic: 'Example', adapter: browser, searchAdapter: failing('DuckDuckGo served its bot check') });
  assert.ok(withSearch.failures.some((f) => /bot check/.test(f.error)), JSON.stringify(withSearch.failures));
  assert.ok(!withSearch.failures.some((f) => f.provider === 'browser' && !f.degraded), 'the browser was asked to search');

  const alone = decompose(makeProject(), { topic: 'Example', adapter: browser });
  assert.ok(alone.failures.some((f) => /browser .*does not search/.test(f.error)), JSON.stringify(alone.failures));
});

// Found 2026-10-01 (break-test, PR #180): drafting a map scraped search results as the vendor
// gave them, so a `file:` or `javascript:` row reached the fetch adapter. Only http(s) pages
// are taken into the material, and so only they are listed or scraped.
test('a search result that is not an http(s) page is neither listed nor scraped', () => {
  const dir = makeProject();
  const fetched = [];
  const adapter = {
    name: 'stub-transport',
    search: () => ({ ok: true, results: ['file:///etc/passwd', 'javascript:alert(1)', 'https://docs.example.com/limits']
      .map((url) => ({ url, title: 'Example limits', description: 'Example limits' })) }),
    runScrape: (url) => { fetched.push(url); return { ok: false, url, error: 'not fetched in this test' }; },
  };
  decompose(dir, { topic: 'Example', adapter, maxScrapes: 5 });
  assert.deepEqual(fetched, ['https://docs.example.com/limits']);
  assert.doesNotMatch(readText(resolve(dir, PATHS.map)), /file:\/\/|javascript:/);
});
