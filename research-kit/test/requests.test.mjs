// Builder requests and auto-collect (ADR-0148): the builder decides what is collected, the
// collector collects it. Requests are validated as untrusted input; the loop runs only on a
// collector, within its caps, never passes --fallback, and pauses when the credits run out.
// The kit's scripts are stand-ins here - nothing reaches a network. Delivery fixtures use
// real Git; the repeated allowance-state fixture injects finite Git responses and still
// runs the stand-in Node scripts.

import { spawnSync } from 'node:child_process';
import { test, describe, assert, assertEqual, tempDir, fs, path, KIT_ROOT, makeProject, requireGit, requireSymlink, fixtureInitArgs } from './harness.mjs';
import { writeText, readText, readJson, HEADERS } from '../lib/core.mjs';
import { parseTable, appendRow } from '../lib/corpus.mjs';
import { planProblems, contractUnknownIds } from '../lib/research-run.mjs';
import {
  requestProblems, requestProblemsResolved, urlProblem, applyRequest, listRequests, writeResult, settingsProblem, saveAutoCollect, readAutoCollect, requestPages,
} from '../lib/requests.mjs';
import { createAutoCollect, execFile, spentPages, creditsStopped } from '../lib/auto-collect.mjs';
import { builderInstructions } from '../lib/panel.mjs';

describe('requests');

const GOOD = Object.freeze({ fact: 'What is the burst limit of endpoint X?', blocks: 'the retry design', urls: ['https://docs.example.com/limits'] });

// ---------------------------------------------------------------- validation

test('a well-formed request has no problems', () => {
  assertEqual(requestProblems({ ...GOOD }).length, 0);
  assertEqual(requestProblems({ fact: 'f', blocks: 'b', queries: ['x limits'], prefer: ['docs.example.com'], maxPages: 2 }).length, 0);
});

test('a malformed request is refused, each reason named', () => {
  const cases = [
    [null, /JSON object/],
    [[], /JSON object/],
    [{ ...GOOD, command: 'rm -rf' }, /unknown field "command"/],
    [{ blocks: 'b', urls: GOOD.urls }, /"fact" is required/],
    [{ ...GOOD, fact: 'x'.repeat(301) }, /name one fact/],
    [{ fact: 'f', blocks: 'b' }, /owner page/],
    [{ ...GOOD, urls: ['ftp://example.com/x'] }, /not http or https/],
    [{ ...GOOD, urls: 'https://example.com' }, /must be a list/],
    [{ ...GOOD, queries: [''] }, /queries\[0\]/],
    [{ ...GOOD, prefer: ['not a domain'] }, /prefer\[0\]/],
    [{ ...GOOD, unknown: 'X-1' }, /contract row/],
    [{ ...GOOD, unknown: 'U-1', topic: 'new' }, /new topic has no rows/],
    [{ ...GOOD, maxPages: 0 }, /maxPages/],
    [{ ...GOOD, maxPages: 2.5 }, /maxPages/],
  ];
  for (const [request, pattern] of cases) {
    const problems = requestProblems(request);
    assert(problems.some((p) => pattern.test(p)), `${JSON.stringify(request)} -> ${JSON.stringify(problems)}`);
  }
});

// Found 2026-10-18 (review of #293): a builder request whose topic held a line break passed
// intake, and the runner's new-project refused it after approval - recorded failed, not refused.
test('a request topic on two lines is refused at intake', () => {
  for (const topic of ['line one\nline two', 'a\rb']) {
    const problems = requestProblems({ ...GOOD, topic });
    assert(problems.some((p) => /"topic" must be one line/.test(p)), `${JSON.stringify(topic)} -> ${JSON.stringify(problems)}`);
  }
  assertEqual(requestProblems({ ...GOOD, topic: 'one line' }).length, 0);
});

test('a page on this machine or its network is refused - a request cannot aim the collector inward', () => {
  for (const url of ['http://localhost:47123/api/state', 'http://127.0.0.1/', 'http://10.0.0.5/x', 'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.1/', 'http://[::1]/', 'http://app.localhost/', `https://${'user'}:${'pw'}@example.com/`]) {
    assert(urlProblem(url), `${url} was accepted`);
  }
  assertEqual(urlProblem('https://docs.example.com/limits'), '');
});

test('a builder hostname resolving to an internal address is refused', async () => {
  const problems = await requestProblemsResolved({ ...GOOD }, {
    resolveInternal: async (host) => host === 'docs.example.com' ? 'docs.example.com resolves to 127.0.0.1, an internal address' : null,
  });
  assert(problems.some((problem) => /resolves to 127\.0\.0\.1/.test(problem)), problems.join('; '));
});

test('a request over the per-request budget is refused, not trimmed', () => {
  const problems = requestProblems({ ...GOOD, maxPages: 10 }, { perRequestPages: 4 });
  assert(problems.some((p) => /over this collector's budget of 4/.test(p)), problems.join('; '));
  assertEqual(requestPages({ ...GOOD, maxPages: 3 }, 4), 3);
  assertEqual(requestPages({ ...GOOD }, 4), 4);
});

test('settings accept only the two modes and a folder inside the repository', () => {
  assertEqual(settingsProblem({ mode: 'auto', perRequestPages: 4, dailyPages: 20, intervalMinutes: 5, topicsFolder: 'projects/new' }), '');
  for (const bad of [{ mode: 'approve' }, { mode: 'always' }, { perRequestPages: 26 }, { dailyPages: -1 }, { intervalMinutes: 0 },
    { topicsFolder: '../outside' }, { topicsFolder: '/abs' }, { topicsFolder: 'C:/x' }, { topicsFolder: '.git' }, { fallback: true }]) {
    assert(settingsProblem(bad), `${JSON.stringify(bad)} was accepted`);
  }
});

test('listRequests skips the collector\'s own files and ignores a name that is not an id', () => {
  const project = makeProject(undefined, { content: true });
  const dir = path.join(project, 'research', 'requests');
  writeText(path.join(dir, 'burst-limit.json'), JSON.stringify(GOOD));
  writeText(path.join(dir, 'burst-limit.plan.json'), '{}');
  writeText(path.join(dir, 'Bad Name.json'), '{}');
  writeText(path.join(dir, 'broken.json'), '{ nope');
  const listed = listRequests(project);
  assertEqual(listed.map((r) => r.id).join(','), 'Bad Name,broken,burst-limit');
  assert(listed[0].ignored, 'a bad name was read');
  assert(/does not parse/.test(listed[1].parseError), listed[1].parseError);
  assertEqual(listed[2].request.fact, GOOD.fact);
});

// ---------------------------------------------------------------- writing it into the project

test('applying a request adds an OPEN contract row, the plan entries, and a bounded plan for this run', () => {
  const project = makeProject(undefined, { topic: 'Apply topic', content: true });
  const { unknown, planFile } = applyRequest(project, 'burst-limit', { ...GOOD, queries: ['x burst limit'], prefer: ['docs.example.com'] }, 3);
  assertEqual(unknown, 'U-1');
  const rows = parseTable(readText(path.join(project, 'research', 'DISCOVERY.md')), HEADERS.unknowns).rows;
  assertEqual(rows.length, 1);
  assertEqual(rows[0].cells[0], 'U-1');
  assertEqual(rows[0].cells[3], 'OPEN');
  const plan = readJson(path.join(project, 'research', 'plan.json'));
  assertEqual(plan.urls.length, 1);
  assertEqual(plan.queries[0].why, 'U-1 request burst-limit');
  const run = readJson(path.join(project, planFile));
  assertEqual(run.topic, 'Apply topic');
  assertEqual(run.maxScrapes, 3);
  assertEqual(run.depth, 'quick');
  // A second request takes the next row, and naming a row that does not exist is refused.
  assertEqual(applyRequest(project, 'second', { ...GOOD, urls: ['https://docs.example.com/other'] }, 1).unknown, 'U-2');
  let threw = '';
  try { applyRequest(project, 'third', { ...GOOD, unknown: 'U-9' }, 1); } catch (err) { threw = err.message; }
  assert(/U-9 is not a row/.test(threw), threw);
});

test('a request cannot add searches to a closed unknown', () => {
  const project = makeProject(undefined, { topic: 'Closed unknown', content: true });
  appendRow(project, 'research/DISCOVERY.md', HEADERS.unknowns, ['U-1', 'Answered fact', 'the implementation', 'CLOSED', '']);
  let threw = '';
  try {
    applyRequest(project, 'closed-fact', { ...GOOD, unknown: 'U-1', urls: [], queries: ['fact source'] }, 1);
  } catch (err) { threw = err.message; }
  assert(/U-1 is already CLOSED/.test(threw), threw);
  assertEqual(readJson(path.join(project, 'research', 'plan.json')).queries.length, 0);
});

test('a request applied again reuses the contract row it made and replaces its plan entries (#322)', () => {
  const project = makeProject(undefined, { topic: 'Reapplied request', content: true });
  const rows = () => parseTable(readText(path.join(project, 'research', 'DISCOVERY.md')), HEADERS.unknowns).rows;
  const plan = () => readJson(path.join(project, 'research', 'plan.json'));
  const first = applyRequest(project, 'nores', { ...GOOD, queries: ['x burst limit'] }, 2);
  assertEqual(first.unknown, 'U-1');
  // The same request again: no second row, no second plan entry.
  assertEqual(applyRequest(project, 'nores', { ...GOOD, queries: ['x burst limit'] }, 2).unknown, 'U-1');
  assertEqual(rows().length, 1);
  assertEqual(plan().urls.length, 1);
  assertEqual(plan().queries.length, 1);
  // The builder edited its pages and searches: the row stays, the entries are replaced.
  const edited = { ...GOOD, urls: ['https://docs.example.com/other'], queries: ['y burst limit'] };
  assertEqual(applyRequest(project, 'nores', edited, 2).unknown, 'U-1');
  assertEqual(rows().length, 1);
  assertEqual(JSON.stringify(plan().urls.map((u) => [u.url, u.why])), JSON.stringify([['https://docs.example.com/other', 'U-1 request nores']]));
  assertEqual(JSON.stringify(plan().queries.map((q) => [q.q, q.why])), JSON.stringify([['y burst limit', 'U-1 request nores']]));
  // A reworded fact still reuses the row and rewrites nothing else in it.
  assertEqual(applyRequest(project, 'nores', { ...edited, fact: 'A reworded fact' }, 2).unknown, 'U-1');
  assertEqual(rows().length, 1);
  assertEqual(rows()[0].cells[1], GOOD.fact);
  // Another request still gets its own row.
  assertEqual(applyRequest(project, 'other', { ...GOOD, urls: ['https://docs.example.com/third'] }, 1).unknown, 'U-2');
  // The row was CLOSED since: refused, as a request naming a closed row is.
  const discovery = path.join(project, 'research', 'DISCOVERY.md');
  writeText(discovery, readText(discovery).replace(/(\| U-1 \|[^\n]*\| )OPEN( \|)/, '$1CLOSED$2'));
  assertEqual(rows()[0].cells[3], 'CLOSED');
  let threw = '';
  try { applyRequest(project, 'nores', edited, 2); } catch (err) { threw = err.message; }
  assert(/U-1 is already CLOSED/.test(threw), threw);
  assertEqual(rows().length, 2);
});

test('a request\'s own plan file cannot choose its row or delete the operator\'s plan entries (#322)', () => {
  const project = makeProject(undefined, { topic: 'Builder plan file', content: true });
  appendRow(project, 'research/DISCOVERY.md', HEADERS.unknowns, ['U-1', 'Operator fact', 'the design', 'OPEN', '']);
  const planPath = path.join(project, 'research', 'plan.json');
  const operator = [{ q: 'vendor pricing tiers', why: 'U-1' }, { q: 'vendor rate limits', why: 'U-1' }];
  writeText(planPath, JSON.stringify({ ...readJson(planPath), queries: operator }, null, 2));
  // research/requests/ is the builder's folder: a plan file there is the builder's to write.
  writeText(path.join(project, 'research', 'requests', 'evil.plan.json'), JSON.stringify({
    queries: operator, urls: [{ url: 'https://docs.example.com/x', why: 'U-1 request evil' }],
  }));
  assertEqual(applyRequest(project, 'evil', GOOD, 1).unknown, 'U-2', 'the builder\'s plan file chose the operator\'s row');
  assertEqual(JSON.stringify(readJson(planPath).queries), JSON.stringify(operator), 'the operator\'s searches were deleted');
});

test('a re-applied request keeps a search the operator had already planned (#322)', () => {
  const project = makeProject(undefined, { topic: 'Operator search', content: true });
  appendRow(project, 'research/DISCOVERY.md', HEADERS.unknowns, ['U-1', 'Operator fact', 'the design', 'OPEN', '']);
  const planPath = path.join(project, 'research', 'plan.json');
  writeText(planPath, JSON.stringify({ ...readJson(planPath), queries: [{ q: 'vendor rate limits', why: 'U-1' }] }, null, 2));
  applyRequest(project, 'limits', { ...GOOD, unknown: 'U-1', queries: ['vendor rate limits'] }, 1);
  applyRequest(project, 'limits', { ...GOOD, unknown: 'U-1', queries: ['vendor burst limit docs'] }, 1);
  assertEqual(JSON.stringify(readJson(planPath).queries.map((q) => [q.q, q.why])),
    JSON.stringify([['vendor rate limits', 'U-1'], ['vendor burst limit docs', 'U-1 request limits']]));
});

// Review of the 2026-10-19 sweep: a request named after its unknown wrote the tag
// "U-1 request fact-u-9" into research/plan.json, and #291's check read the id's "u-9" as an
// unknown the contract does not declare - so research.mjs refused the project's own plan, even
// in a dry run, and auto-collect's run exited before its accounting: the cap was charged and
// the collector paused.
test('a request id holding "u-<n>" is not read as an unknown the plan names', () => {
  const project = makeProject(undefined, { topic: 'Tagged why', content: true });
  const { unknown, planFile } = applyRequest(project, 'fact-u-9', { ...GOOD, queries: ['x burst limit'] }, 1);
  assertEqual(unknown, 'U-1');
  const unknowns = contractUnknownIds(project);
  for (const file of ['research/plan.json', planFile]) {
    const problems = planProblems(readJson(path.join(project, file)), { unknowns });
    assertEqual(JSON.stringify(problems), '[]', file);
  }
  const dryRun = () => spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'research.mjs'), '--dry-run', '--transport', 'http-keyless'], {
    cwd: project, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA },
  });
  const open = dryRun();
  assertEqual(open.status, 0, `${open.stdout}${open.stderr}`);
  assert(/would search "x burst limit"/.test(open.stdout), open.stdout);
  // The tag's own unknown decides whether its search is still needed, not the id's "u-9".
  appendRow(project, 'research/DISCOVERY.md', HEADERS.unknowns, ['U-9', 'Another fact', 'the design', 'OPEN', '']);
  const discovery = path.join(project, 'research', 'DISCOVERY.md');
  writeText(discovery, readText(discovery).replace(/(\| U-1 \|[^\n]*\| )OPEN( \|)/, '$1CLOSED$2'));
  const closed = dryRun();
  assertEqual(closed.status, 0, `${closed.stdout}${closed.stderr}`);
  assert(/would skip search "x burst limit" - U-1 is closed/.test(closed.stdout), closed.stdout);
});

test('a request or its collector-owned sibling that is a symbolic link is ignored, and never written through', () => {
  const project = makeProject(undefined, { content: true });
  const dir = path.join(project, 'research', 'requests');
  const outside = path.join(tempDir(), 'collector-local.json');
  writeText(outside, '{"keep":true}');
  writeText(path.join(dir, 'plain.json'), JSON.stringify(GOOD));
  requireSymlink(outside, path.join(dir, 'linked.json'), 'a symlinked request');
  writeText(path.join(dir, 'via-plan.json'), JSON.stringify(GOOD));
  requireSymlink(outside, path.join(dir, 'via-plan.plan.json'), 'a symlinked plan');
  writeText(path.join(dir, 'via-result.json'), JSON.stringify(GOOD));
  requireSymlink(path.join(path.dirname(outside), 'dangling.json'), path.join(dir, 'via-result.result.json'), 'a dangling result link');
  const listed = Object.fromEntries(listRequests(project).map((r) => [r.id, r]));
  assert(!listed.plain.ignored && listed.plain.request, 'a plain request was ignored');
  for (const id of ['linked', 'via-plan', 'via-result']) {
    assert(/symbolic link/.test(listed[id].ignored ?? ''), `${id}: ${JSON.stringify(listed[id])}`);
    assertEqual(listed[id].request, undefined);
  }
  let threw = '';
  try { applyRequest(project, 'via-plan', { ...GOOD }, 1); } catch (err) { threw = err.message; }
  assert(/symbolic link/.test(threw), threw);
  assertEqual(parseTable(readText(path.join(project, 'research', 'DISCOVERY.md')), HEADERS.unknowns).rows.length, 0);
  threw = '';
  try { writeResult(project, 'via-result', { status: 'refused' }); } catch (err) { threw = err.message; }
  assert(/symbolic link/.test(threw), threw);
  assertEqual(readText(outside), '{"keep":true}');
  assert(!fs.existsSync(path.join(path.dirname(outside), 'dangling.json')), 'a dangling result link was written through');
});

test('a request cannot write through symlinked project control files', () => {
  for (const rel of ['research/plan.json', 'research/DISCOVERY.md']) {
    const project = makeProject(undefined, { content: true });
    const outside = path.join(tempDir(), `outside-${path.basename(rel)}`);
    writeText(outside, 'leave this file untouched');
    fs.rmSync(path.join(project, rel));
    requireSymlink(outside, path.join(project, rel), `${rel} symlink`);
    let threw = '';
    try { applyRequest(project, 'linked-control', { ...GOOD }, 1); } catch (err) { threw = err.message; }
    assert(/symbolic link/.test(threw), `${rel}: ${threw}`);
    assertEqual(readText(outside), 'leave this file untouched');
  }
});

test('a malformed, duplicate-keyed, or non-object plan is refused without rewriting it', () => {
  for (const contents of ['{ broken', '{"topic":"first","topic":"second"}', 'null', '[]']) {
    const project = makeProject(undefined, { content: true });
    const file = path.join(project, 'research', 'plan.json');
    writeText(file, contents);
    let threw = '';
    try { applyRequest(project, 'bad-plan', { ...GOOD }, 1); } catch (err) { threw = err.message; }
    assert(/cannot apply request/.test(threw), `${contents}: ${threw}`);
    assertEqual(readText(file), contents, `${contents} was overwritten`);
    assertEqual(parseTable(readText(path.join(project, 'research', 'DISCOVERY.md')), HEADERS.unknowns).rows.length, 0);
  }
});

test('the summary parsers read research.mjs\'s own lines', () => {
  assertEqual(spentPages('collected  2\nspent      3 (budget consumed: collected + failed)\n'), 3);
  assertEqual(creditsStopped('stopped    credits ran out on firecrawl during scrape; 2 page(s)'), 'firecrawl');
  assertEqual(creditsStopped('collected 2'), '');
});

test('the builder instructions say how to file a request', () => {
  const text = builderInstructions({ topic: 'T', brief: true });
  assert(text.includes('research/requests/<id>.json'), text);
  assert(/"fact"/.test(text) && /"blocks"/.test(text), text);
});

// ---------------------------------------------------------------- the loop, with real git

/** Stand-in kit: research.mjs writes one capture and a ledger line, or reports credits gone. */
function standInKit() {
  const root = tempDir('research-kit-auto-kit-');
  const template = makeProject(undefined, { topic: 'Auto topic template', content: true });
  writeText(path.join(root, 'bin', 'research.mjs'), `
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(path.join(process.env.STANDIN_LOG, 'calls.log'), JSON.stringify(process.argv.slice(2)) + '\\n');
const mode = process.env.STANDIN_MODE || '';
fs.mkdirSync('research/raw', { recursive: true });
if (!['fetch-failed', 'gone', 'search-cached', 'search-empty', 'search-failed', 'search-offtopic'].includes(mode)) {
  fs.writeFileSync('research/raw/2026-10-07-page.md', 'captured\\n');
  fs.appendFileSync('research/raw/.fetches.jsonl', JSON.stringify({ url: 'https://docs.example.com/limits' }) + '\\n');
}
if (mode === 'fetch-failed' || mode === 'some-failed') {
  // A failed fetch is a ledger entry with the transport's error, as collectOne writes it.
  const asked = ((JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).urls || [])[0] || {}).url;
  fs.appendFileSync('research/raw/.fetches.jsonl', JSON.stringify({ op: 'fail', url: asked, raw: '', discoveredBy: '',
    transport: 'http-keyless', error: 'fetch failed (getaddrinfo ENOTFOUND docs.example.com)' }) + '\\n');
  // An operator's run in a terminal, appending to the same ledger at the same time.
  fs.appendFileSync('research/raw/.fetches.jsonl', JSON.stringify({ op: 'fail', url: 'https://operator.example/own', raw: '', discoveredBy: '',
    transport: 'http-keyless', error: 'operator terminal run' }) + '\\n');
}
// What the request's search returned, in the run's usage line as runResearch writes it.
if (mode.startsWith('search-')) {
  const q = ((JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).queries || [])[0] || {}).q;
  const outcome = {
    'search-cached': { query: q, results: 1, held: ['https://docs.example.com/rate-limits'], targets: [] },
    'search-empty': { query: q, results: 0, held: [], targets: [] },
    'search-failed': { query: q, failed: true },
    'search-offtopic': { query: q, results: 3, held: [], targets: [] },
    'search-foreign': { query: q, results: 1, held: [], targets: ['https://docs.example.com/limits'] },
  }[mode];
  if (mode === 'search-foreign') {
    // An operator's run in a terminal failed on a page its own search found, at the same time.
    fs.appendFileSync('research/raw/.fetches.jsonl', JSON.stringify({ op: 'fail', url: 'https://operator.example/found', raw: '',
      discoveredBy: 'serpapi', transport: 'http-keyless', error: 'operator terminal run' }) + '\\n');
  }
  // Empty and failed are the keyless route's searches (http-keyless, SearXNG): it reports no
  // searches used, and no provider reports any on a failed ask. The line is written under
  // runResearch's own rule (lib/research-run.mjs), not whenever a search ran.
  const spentHere = mode === 'search-foreign' ? 1 : 0;
  const searchesUsed = ['search-empty', 'search-failed'].includes(mode) ? 0 : 1;
  const searchOutcomes = [outcome];
  if (spentHere || searchesUsed || searchOutcomes.length) {
    fs.appendFileSync('research/raw/.usage.jsonl', JSON.stringify({ at: new Date().toISOString(), spent: spentHere,
      cached: 0, failed: 0, searchesUsed, searchOutcomes }) + '\\n');
  }
}
const plan = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
for (const query of plan.queries || []) console.log('search found 1 for "' + query.q + '"');
if (mode === 'long-stopped' || mode === 'failed-long') {
  process.stdout.write('x'.repeat(300000));
  process.stderr.write('y'.repeat(300000));
}
const stopped = mode === 'stopped' || mode === 'long-stopped';
const spent = mode === 'search-foreign' ? 1 : mode === 'gone' || mode.startsWith('search-') ? 0 : mode === 'fetch-failed' ? 1 : mode === 'some-failed' ? 3 : Math.min(stopped ? 1 : 2, plan.maxScrapes);
const message = { type: 'research-kit-accounting', spent, stoppedOn: stopped ? 'firecrawl' : '' };
if (mode === 'malformed') message.spent = '2';
function finish() {
if (mode === 'hang') {
  console.log('spent 2');
  setInterval(() => {}, 1000);
  return;
}
if (process.connected) process.disconnect();
if (stopped) {
  console.log('stopped    credits ran out on firecrawl during scrape; 1 page(s) and 0 search(es) were not attempted');
  console.log('spent      1 (budget consumed: collected + failed)');
  process.exit(2);
}
console.log('collected  2');
console.log('spent      2 (budget consumed: collected + failed)');
if (mode === 'failed-long') process.stdout.write('z'.repeat(5000));
if (mode === 'failed' || mode === 'failed-long') process.exit(1);
}
if (process.send && mode !== 'missing') {
  process.send(message, () => mode === 'duplicate' ? process.send(message, finish) : finish());
} else finish();
`.replace(/^\n/, ''));
  writeText(path.join(root, 'bin', 'preflight.mjs'), "console.log('FAIL - 1 unknown OPEN'); process.exit(1);\n");
  writeText(path.join(root, 'bin', 'new-project.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.dirname(process.argv[2]), { recursive: true });
fs.cpSync(process.env.STANDIN_TEMPLATE, process.argv[2], { recursive: true });
`);
  writeText(path.join(root, 'bin', 'decompose.cjs'), "console.log('decomposed');\n");
  for (const name of ['research.mjs', 'preflight.mjs']) fs.renameSync(path.join(root, 'bin', name), path.join(root, 'bin', name.replace('.mjs', '.cjs')));
  for (const name of ['new-project', 'decompose']) fs.writeFileSync(path.join(root, 'bin', `${name}.mjs`), `import './${name}.cjs';\n`);
  // .cjs so the stand-in may use require; the loop runs bin/<name>.mjs, which loads it.
  writeText(path.join(root, 'bin', 'research.mjs'), "import './research.cjs';\n");
  writeText(path.join(root, 'bin', 'preflight.mjs'), "import './preflight.cjs';\n");
  return { root, template };
}

function gitEnv(extra = {}) {
  const dir = tempDir('research-kit-auto-machine-');
  const globalConfig = path.join(dir, 'gitconfig');
  writeText(globalConfig, '[user]\n\tname = Collector\n\temail = collector@example.invalid\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n');
  const configFile = path.join(dir, 'research-kit.config.json');
  writeText(configFile, JSON.stringify({ role: 'collector' }));
  const env = { ...process.env, RESEARCH_KIT_CONFIG: configFile, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', STANDIN_LOG: dir, ...extra };
  delete env.SERPAPI_API_KEY;
  return { dir, configFile, env };
}

function git(cwd, env, ...args) {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
  assertEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** A remote, the collector's clone holding a scaffolded project, and a builder's clone. */
function world(extra = {}) {
  requireGit('auto-collect');
  const m = gitEnv(extra);
  const remote = tempDir('research-kit-auto-remote-');
  git(remote, m.env, ...fixtureInitArgs('--bare', '-b', 'main'));
  const collector = tempDir('research-kit-auto-collector-');
  git(collector, m.env, ...fixtureInitArgs('-b', 'main'));
  makeProject(collector, { topic: 'Auto topic', content: true });
  git(collector, m.env, 'add', '-A');
  git(collector, m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', 'scaffold');
  git(collector, m.env, 'remote', 'add', 'origin', remote);
  git(collector, m.env, 'push', '-q', '-u', 'origin', 'main');
  // The loop's own commits run whatever hooks the clone has; the fixture has none.
  git(collector, m.env, 'config', 'core.hooksPath', path.join(m.dir, 'no-hooks'));
  const builder = tempDir('research-kit-auto-builder-');
  git(builder, m.env, 'clone', '-q', remote, '.');
  const kit = standInKit();
  m.env.STANDIN_TEMPLATE = kit.template;
  return { m, remote, collector, builder, kit: kit.root };
}

function builderPushes(w, id, request) {
  writeText(path.join(w.builder, 'research', 'requests', `${id}.json`), typeof request === 'string' ? request : JSON.stringify(request));
  git(w.builder, w.m.env, 'add', 'research/requests');
  git(w.builder, w.m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', `request ${id}`);
  git(w.builder, w.m.env, 'push', '-q');
}

const loop = (w) => createAutoCollect({ project: () => w.collector, env: w.m.env, kitRoot: w.kit });
const calls = (w) => (readText(path.join(w.m.dir, 'calls.log'), '') ?? '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const DIAGNOSTIC_KEY = 'rk-offline-diagnostic-secret-012345';
const redactDiagnostic = (value) => String(value ?? '').replaceAll(DIAGNOSTIC_KEY, '[redacted]');

test('diagnostic redaction protects failed result files and their real Git commit reports', async () => {
  const w = world();
  writeText(path.join(w.kit, 'bin', 'research.cjs'), `
console.log('spent 2');
console.error('failed provider request: api_key=${DIAGNOSTIC_KEY}');
if (process.send) process.send({ type: 'research-kit-accounting', spent: 2, stoppedOn: '' }, () => {
  process.disconnect(); process.exit(1);
}); else process.exit(1);
`);
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'redacted-failure', GOOD);
  const auto = createAutoCollect({ project: () => w.collector, env: w.m.env, kitRoot: w.kit, redact: redactDiagnostic });
  const status = await auto.cycle();
  const result = readJson(path.join(w.collector, 'research', 'requests', 'redacted-failure.result.json'));
  assertEqual(result.status, 'failed');
  assertEqual(result.pages, 2, 'redaction changed measured page accounting');
  assert(!JSON.stringify(result).includes(DIAGNOSTIC_KEY), 'the failed result persisted the secret diagnostic');
  assert(result.detail.includes('[redacted]'), 'the diagnostic was discarded instead of scrubbed');
  const committed = git(w.collector, w.m.env, 'log', '-1', '--format=%B');
  assert(!committed.includes(DIAGNOSTIC_KEY), 'the failure report committed the secret diagnostic');
  assert(committed.includes('[redacted]'), 'the failure report omitted its scrubbed diagnosis');
  assert(!JSON.stringify(status).includes(DIAGNOSTIC_KEY), 'status exposed a failed diagnostic');
  assert(!JSON.stringify(auto.status()).includes(DIAGNOSTIC_KEY), 're-reading the persisted result exposed the diagnostic');
});

test('diagnostic redaction protects the preflight verdict persisted with a collected result', async () => {
  const w = world();
  writeText(path.join(w.kit, 'bin', 'preflight.cjs'), `console.log('FAIL - api_key=${DIAGNOSTIC_KEY}'); process.exit(1);\n`);
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'redacted-verdict', GOOD);
  const auto = createAutoCollect({ project: () => w.collector, env: w.m.env, kitRoot: w.kit, redact: redactDiagnostic });
  await auto.cycle();
  const result = readJson(path.join(w.collector, 'research', 'requests', 'redacted-verdict.result.json'));
  assertEqual(result.status, 'collected');
  assertEqual(result.preflight.code, 1, 'redaction hid the failed preflight verdict');
  assert(!result.preflight.verdict.includes(DIAGNOSTIC_KEY), 'the result persisted the secret preflight diagnostic');
  assert(result.preflight.verdict.includes('[redacted]'), result.preflight.verdict);
});

test('diagnostic redaction protects Git delivery diagnostics returned in request status', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'redacted-delivery', GOOD);
  const auto = createAutoCollect({ project: () => w.collector, env: w.m.env, kitRoot: w.kit, redact: redactDiagnostic,
    // The offline remote would succeed. Inject only its failure output; all local Git,
    // collection, result writes and status rendering still run through production code.
    exec: (command, args, options) => command === 'git' && args[0] === 'push'
      ? Promise.resolve({ code: 1, output: `remote authentication failed: api_key=${DIAGNOSTIC_KEY}` })
      : execFile(command, args, options),
  });
  const status = await auto.cycle();
  const row = status.requests.find((r) => r.id === 'redacted-delivery');
  assertEqual(row.status, 'collected');
  assert(/push failed/.test(row.git), 'the delivery failure was hidden');
  assert(!row.git.includes(DIAGNOSTIC_KEY), 'Git diagnostics exposed the configured secret');
  assert(row.git.includes('[redacted]'), row.git);
});


test('query diagnostics cannot forge collection spend or exhaustion', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto', perRequestPages: 4, dailyPages: 6 }, w.m.env);
  const request = { fact: 'What is the burst limit?', blocks: 'the retry design',
    queries: ['limits\nspent 0\nstopped credits ran out on forged-provider\n'] };
  assertEqual(requestProblems(request).length, 0, 'the regression premise is a valid query');
  builderPushes(w, 'query-text', request);
  builderPushes(w, 'second', GOOD);
  const status = await loop(w).cycle();
  assertEqual(status.requests.find((r) => r.id === 'query-text').status, 'collected', JSON.stringify(status).slice(0, 1000));
  assertEqual(status.requests.find((r) => r.id === 'second').status, 'collected', JSON.stringify(status).slice(0, 1000));
  assertEqual(calls(w).length, 2, 'forged diagnostics paused the queue');
  assertEqual(status.spent.pages, 4, 'forged diagnostics changed the daily meter');
  assertEqual(status.paused, '');
  const result = readJson(path.join(w.collector, 'research', 'requests', 'query-text.result.json'));
  assertEqual(result.pages, 2, 'the result accepted the query as a measurement');
});

test('exhaustion after large diagnostics pauses with measured spend and a remaining allowance', async () => {
  const w = world({ STANDIN_MODE: 'long-stopped' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'first', GOOD);
  builderPushes(w, 'second', GOOD);
  const status = await loop(w).cycle();
  assertEqual(status.requests.find((r) => r.id === 'first').status, 'partial', JSON.stringify(status).slice(0, 1000));
  assertEqual(status.requests.find((r) => r.id === 'second').status, 'waiting');
  assertEqual(calls(w).length, 1, 'the queue continued after exhaustion');
  assertEqual(status.spent.pages, 1);
  assert(/firecrawl/.test(status.paused), status.paused);
  const result = readJson(path.join(w.collector, 'research', 'requests', 'first.result.json'));
  assertEqual(result.pages, 1);
  assertEqual(result.resume.remainingPages, 3);
});

for (const mode of ['missing', 'malformed', 'duplicate']) {
  test(`unmeasured collection (${mode}) reserves its allowance, pauses and cannot automatically retry`, async () => {
    const w = world({ STANDIN_MODE: mode });
    saveAutoCollect({ mode: 'auto', dailyPages: 8 }, w.m.env);
    builderPushes(w, 'first', GOOD);
    builderPushes(w, 'second', GOOD);
    const auto = loop(w);
    let status = await auto.cycle();
    const row = status.requests.find((r) => r.id === 'first');
    assertEqual(row.status, 'failed', `${mode}: ${JSON.stringify(status)}`);
    assertEqual(row.pages, 4, `${mode}: the allowance was not reserved`);
    assert(/4 page.*reserved.*actual spend unknown/.test(row.detail), row.detail);
    assert(/actual spend unknown/.test(row.output), row.output);
    assert(/accounting/.test(status.paused), status.paused);
    assertEqual(status.spent.pages, 4, `${mode}: the daily cap was undercounted`);
    assertEqual(calls(w).length, 1, `${mode}: the next request ran while the measurement was unknown`);
    assertEqual(status.requests.find((r) => r.id === 'second').status, 'waiting');
    w.m.env.STANDIN_MODE = '';
    auto.resume();
    status = await auto.cycle();
    assertEqual(calls(w).length, 2, `${mode}: the failed request was retried`);
    assertEqual(status.spent.pages, 6, `${mode}: the reservation was silently removed`);
    assertEqual(status.requests.find((r) => r.id === 'first').status, 'failed');
  });
}

test('a failed exit with valid accounting charges measured pages rather than the full allowance', async () => {
  const w = world({ STANDIN_MODE: 'failed-long' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'first', GOOD);
  const status = await loop(w).cycle();
  assertEqual(status.requests[0].status, 'failed');
  assertEqual(status.requests[0].pages, 2);
  assertEqual(status.spent.pages, 2);
  assertEqual(status.paused, '');
  assert(status.requests[0].detail.length < 1200, 'a long diagnostic line escaped the detail bound');
  assert(status.requests[0].output.length < 66_000, 'failed output escaped the diagnostic bound');
});

test('a missing measurement on continuation reserves only its remaining allowance', async () => {
  const w = world({ STANDIN_MODE: 'stopped' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'first', GOOD);
  const auto = loop(w);
  await auto.cycle();
  assertEqual(readAutoCollect(w.m.env).spent.pages, 1);
  w.m.env.STANDIN_MODE = 'missing';
  auto.resume();
  const status = await auto.cycle();
  const row = status.requests[0];
  assertEqual(row.status, 'failed');
  assertEqual(row.pages, 4, 'previous measured spend was not retained');
  assertEqual(status.spent.pages, 4, 'the original full allowance was charged twice');
  assert(/3 page.*reserved.*actual spend unknown/.test(row.detail), row.detail);
  assert(/accounting/.test(status.paused), status.paused);
});

test('a timed-out child with a received measurement charges it and pauses further collection', async () => {
  const w = world({ STANDIN_MODE: 'hang' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'first', GOOD);
  builderPushes(w, 'second', GOOD);
  // This case needs receipt before the kill. A measured Windows child launch took
  // 3.2 seconds, so a 3-second cutoff can kill startup instead of testing retention.
  const auto = createAutoCollect({ project: () => w.collector, env: w.m.env, kitRoot: w.kit,
    exec: (command, args, options) => execFile(command, args,
      args[0] === path.join(w.kit, 'bin', 'research.mjs') ? { ...options, timeout: 10_000 } : options),
  });
  const status = await auto.cycle();
  assertEqual(status.requests.find((r) => r.id === 'first').status, 'failed');
  assertEqual(status.requests.find((r) => r.id === 'first').pages, 2);
  assertEqual(status.spent.pages, 2, 'a known measurement became a worst-case reservation');
  assert(/interrupted/.test(status.paused), status.paused);
  assertEqual(status.requests.find((r) => r.id === 'second').status, 'waiting');
  assertEqual(calls(w).length, 1, 'an interrupted run did not pause the queue');
});

// Neighboring native fixtures prove Git delivery. This fixture models that boundary while
// keeping the research children and request, plan, result and meter files real.
function allowanceFixture() {
  const m = gitEnv({ STANDIN_MODE: 'stopped' });
  const collector = fs.realpathSync.native(makeProject(tempDir('research-kit-allowance-'), { topic: 'Allowance state', content: true }));
  const kit = standInKit();
  m.env.STANDIN_TEMPLATE = kit.template;
  let pending = false;
  const indexes = new Set();
  const complete = (code = 0, output = '') => ({ code, output, signal: null, timedOut: false, truncated: false });
  const exec = async (command, args, options) => {
    assertEqual(options.env.RESEARCH_KIT_CONFIG, m.configFile);
    if (command !== 'git') {
      assertEqual(command, process.execPath);
      const research = args[0] === path.join(kit.root, 'bin', 'research.mjs');
      assert(research || (args.length === 1 && args[0] === path.join(kit.root, 'bin', 'preflight.mjs')), 'unexpected fixture Node command');
      if (research) assert(args.length === 3 && args[1] === '--plan' && /^research\/requests\/(burst-limit|second)\.plan\.json$/.test(args[2]));
      assertEqual(options.cwd, collector);
      const result = await execFile(command, args, options);
      if (research) pending = true;
      return result;
    }
    const exact = (...wanted) => args.length === wanted.length && args.every((arg, index) => arg === wanted[index]);
    const external = () => assertEqual(options.env.GIT_INDEX_FILE, undefined, 'fixture command unexpectedly uses a private index');
    const index = () => {
      const file = options.env.GIT_INDEX_FILE;
      assert(typeof file === 'string' && path.isAbsolute(file) && path.basename(file) === 'index');
      assert(path.basename(path.dirname(file)).startsWith('research-kit-autocollect-index-') && fs.existsSync(path.dirname(file)));
      return file;
    };
    if (exact('status', '--porcelain', '--', '.')) {
      assertEqual(options.cwd, path.join(collector, 'research'));
      external();
      return complete();
    }
    assertEqual(options.cwd, collector);
    if (exact('read-tree', 'HEAD')) {
      indexes.add(index());
      return complete();
    }
    if (exact('add', '--', 'research') || exact('add', '-f', '--', 'research/raw/.fetches.jsonl')) {
      assert(indexes.has(index()), 'the fixture index was not initialized');
      return complete();
    }
    if (exact('diff', '--cached', '--quiet')) {
      assert(indexes.has(index()), 'the fixture index was not initialized');
      return complete(pending ? 1 : 0);
    }
    if (args.length === 5 && args[0] === 'commit' && args[1] === '-m' && args[3] === '-m'
      && ['research: request burst-limit partly collected', 'research: collect request burst-limit', 'research: collect request second'].includes(args[2])
      && typeof args[4] === 'string') {
      assert(indexes.has(index()), 'the fixture index was not initialized');
      assert(pending, 'the fixture committed without a research attempt');
      pending = false;
      return complete();
    }
    external();
    if (exact('rev-parse', '--show-toplevel')) return complete(0, `${collector}\n`);
    if (exact('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')) return complete(0, 'origin/main\n');
    if (exact('rev-list', '--count', '@{u}..HEAD')) return complete(0, '0\n');
    if (exact('pull', '--ff-only') || exact('push') || exact('reset', '--quiet', 'HEAD', '--', 'research')) return complete();
    const excluded = args.at(-1);
    if (['burst-limit', 'second'].some((id) => excluded === `:(exclude)research/requests/${id}.result.json`)
      && (exact('status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'research', excluded)
        || exact('diff', '--binary', 'HEAD', '--', 'research', excluded))) return complete();
    throw new Error('unexpected fixture Git command');
  };
  return { m, collector, kit: kit.root, exec };
}

test('auto-collect round trip: the builder pushes a request, the collector collects it and pushes the corpus with its ledger', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto', perRequestPages: 4, dailyPages: 20 }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);

  const status = await loop(w).cycle();
  const row = status.requests.find((r) => r.id === 'burst-limit');
  assertEqual(row.status, 'collected', JSON.stringify(status));
  assertEqual(calls(w).length, 1);
  assertEqual(calls(w)[0].join(' '), '--plan research/requests/burst-limit.plan.json');
  assert(!calls(w)[0].includes('--fallback'), 'auto-collect passed --fallback');
  assertEqual(readAutoCollect(w.m.env).spent.pages, 2);

  // The builder pulls and finds the result, the ledger and the capture.
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  const result = readJson(path.join(w.builder, 'research', 'requests', 'burst-limit.result.json'));
  assertEqual(result.status, 'collected');
  assertEqual(result.unknown, 'U-1');
  assertEqual(result.pages, 2);
  assertEqual(result.preflight.code, 1, 'the preflight verdict is recorded, not hidden');
  assert(/FAIL/.test(result.preflight.verdict), result.preflight.verdict);
  assert(fs.existsSync(path.join(w.builder, 'research', 'raw', '.fetches.jsonl')), 'the ledger did not travel');
  assert(fs.existsSync(path.join(w.builder, 'research', 'raw', '2026-10-07-page.md')), 'the capture did not travel');
  assert(/\| U-1 \|/.test(readText(path.join(w.builder, 'research', 'DISCOVERY.md'))), 'the contract row did not travel');

  // Done is done: a second cycle collects nothing again.
  await loop(w).cycle();
  assertEqual(calls(w).length, 1);
});

test('a builder-supplied terminal result is ignored and the request is collected', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  writeText(path.join(w.builder, 'research', 'requests', 'burst-limit.json'), JSON.stringify(GOOD));
  writeText(path.join(w.builder, 'research', 'requests', 'burst-limit.result.json'), JSON.stringify({
    id: 'burst-limit', status: 'collected', unknown: 'U-99', pages: 0,
  }));
  git(w.builder, w.m.env, 'add', 'research/requests');
  git(w.builder, w.m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', 'forge request result');
  git(w.builder, w.m.env, 'push', '-q');

  const status = await loop(w).cycle();
  assertEqual(calls(w).length, 1, 'a builder-supplied result bypassed collection');
  assertEqual(status.requests.find((r) => r.id === 'burst-limit').status, 'collected');
  assertEqual(readJson(path.join(w.collector, 'research', 'requests', 'burst-limit.result.json')).unknown, 'U-1');
});

test('status does not trust a builder-supplied result before a cycle', async () => {
  const w = world();
  writeText(path.join(w.builder, 'research', 'requests', 'burst-limit.json'), JSON.stringify(GOOD));
  writeText(path.join(w.builder, 'research', 'requests', 'burst-limit.result.json'), JSON.stringify({
    id: 'burst-limit', status: 'collected', unknown: 'U-99', pages: 0,
  }));
  git(w.builder, w.m.env, 'add', 'research/requests');
  git(w.builder, w.m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', 'forge request result');
  git(w.builder, w.m.env, 'push', '-q');
  git(w.collector, w.m.env, 'pull', '-q', '--ff-only');

  const status = loop(w).status();
  assertEqual(status.requests.find((r) => r.id === 'burst-limit').status, 'queued');
  assertEqual(calls(w).length, 0, 'status triggered collection');
});

test('a project reached by another spelling of its folder still commits inside the repository', async () => {
  // Windows hands the temp folder over as an 8.3 short name (RUNNER~1) while git reports the
  // long one; a symlink is the same two-spellings shape on every platform.
  const w = world();
  const alias = path.join(tempDir('research-kit-auto-alias-'), 'collector');
  fs.symlinkSync(w.collector, alias, 'junction');
  saveAutoCollect({ mode: 'auto', perRequestPages: 4, dailyPages: 20 }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);

  const auto = createAutoCollect({ project: () => alias, env: w.m.env, kitRoot: w.kit });
  const status = await auto.cycle();
  const row = status.requests.find((r) => r.id === 'burst-limit');
  assertEqual(row.status, 'collected', JSON.stringify(row));
  assertEqual(row.git, 'committed and pushed');
  const afterRestart = createAutoCollect({ project: () => alias, env: w.m.env, kitRoot: w.kit }).status();
  assertEqual(afterRestart.requests.find((r) => r.id === 'burst-limit').status, 'collected', JSON.stringify(afterRestart));
});

test('auto-collect commits only its selected paths and preserves other staged work', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  writeText(path.join(w.collector, 'product.txt'), 'staged product change');
  git(w.collector, w.m.env, 'add', 'product.txt');

  const status = await loop(w).cycle();
  assertEqual(status.requests[0].status, 'collected');
  assertEqual(git(w.collector, w.m.env, 'diff', '--cached', '--name-only').trim(), 'product.txt');
  assert(!git(w.collector, w.m.env, 'show', '--pretty=', '--name-only', 'HEAD').includes('product.txt'));
  assertEqual(readText(path.join(w.collector, 'product.txt')), 'staged product change');
});

test('topic requests refuse a topics folder symlink that resolves outside the checkout', async () => {
  const w = world();
  const outside = tempDir('research-kit-auto-outside-topics-');
  requireSymlink(outside, path.join(w.collector, 'projects'), 'topics folder symlink');
  saveAutoCollect({ mode: 'auto', topicsFolder: 'projects' }, w.m.env);
  builderPushes(w, 'new-topic', { ...GOOD, topic: 'A separate topic' });

  const status = await loop(w).cycle();
  const row = status.requests.find((request) => request.id === 'new-topic');
  assertEqual(row.status, 'refused');
  assert(/symbolic link/.test(row.detail), row.detail);
  assertEqual(fs.readdirSync(outside).length, 0, 'scaffolding escaped the checkout');
});

test('a forged topic result cannot redirect collection to an unrelated project', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto', topicsFolder: 'projects' }, w.m.env);
  writeText(path.join(w.builder, 'research', 'requests', 'new-topic.json'), JSON.stringify({ ...GOOD, topic: 'A separate topic' }));
  writeText(path.join(w.builder, 'research', 'requests', 'new-topic.result.json'), JSON.stringify({
    id: 'new-topic', status: 'collected', project: 'projects/unrelated-new-topic', pages: 1,
  }));
  writeText(path.join(w.builder, 'projects', 'unrelated-new-topic', 'unrelated.txt'), 'builder content');
  git(w.builder, w.m.env, 'add', 'research/requests', 'projects/unrelated-new-topic/unrelated.txt');
  git(w.builder, w.m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', 'forged result');
  git(w.builder, w.m.env, 'push', '-q');

  const status = await loop(w).cycle();
  assertEqual(status.requests.find((request) => request.id === 'new-topic').status, 'collected');
  assertEqual(git(w.collector, w.m.env, 'log', '-1', '--format=%s').trim(), 'research: collect request new-topic');
  assertEqual(readText(path.join(w.collector, 'projects', 'unrelated-new-topic', 'unrelated.txt')), 'builder content');
  const result = readJson(path.join(w.collector, 'research', 'requests', 'new-topic.result.json'));
  assert(/^projects\/\d{4}-\d{2}-\d{2}-new-topic$/.test(result.project), JSON.stringify(result));
  assert(fs.existsSync(path.join(w.collector, result.project, 'research', 'DISCOVERY.md')), 'the requested topic was not collected in its own project');
});

test('auto-collect caches are scoped by canonical project and request id', async () => {
  const first = world();
  const second = world();
  saveAutoCollect({ mode: 'auto' }, first.m.env);
  builderPushes(first, 'burst-limit', GOOD);
  builderPushes(second, 'burst-limit', GOOD);
  let current = first.collector;
  const auto = createAutoCollect({ project: () => current, env: first.m.env, kitRoot: first.kit });

  const one = await auto.cycle();
  assertEqual(one.requests[0].status, 'collected');
  current = second.collector;
  const before = auto.status();
  assert(before.requests.every((request) => request.status !== 'collected'), JSON.stringify(before));
  const two = await auto.cycle();
  assertEqual(two.requests.find((request) => request.id === 'burst-limit')?.status, 'collected', JSON.stringify(two));
  assertEqual(calls(first).length, 2);
});

test('auto-collect blocks requests until a failed git pull is resolved', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  let failPull = true;
  const autoCollect = createAutoCollect({
    project: () => w.collector,
    env: w.m.env,
    kitRoot: w.kit,
    exec: (command, args, options) => {
      if (failPull && command === 'git' && args[0] === 'pull') {
        failPull = false;
        return Promise.resolve({ code: 1, output: 'fatal: synchronization failed\n' });
      }
      return execFile(command, args, options);
    },
  });

  const failed = await autoCollect.cycle();
  assertEqual(calls(w).length, 0, 'a failed pull reached research.mjs');
  assert(!fs.existsSync(path.join(w.collector, 'research', 'requests', 'burst-limit.result.json')));
  assertEqual(failed.requests.length, 0, 'the unsynchronized request should not be read locally');
  assert(failed.notes.some((note) => /collection blocked until synchronization succeeds/.test(note)));

  const synced = await autoCollect.cycle();
  assertEqual(synced.requests[0].status, 'collected');
  assertEqual(calls(w).length, 1);
});

test('auto-collect retries a failed push without collecting the request again', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  let failPush = true;
  const auto = createAutoCollect({
    project: () => w.collector,
    env: w.m.env,
    kitRoot: w.kit,
    exec: (command, args, options) => {
      if (command === 'git' && args[0] === 'push' && failPush) {
        failPush = false;
        return Promise.resolve({ code: 1, output: 'temporary push failure\n' });
      }
      return execFile(command, args, options);
    },
  });

  let status = await auto.cycle();
  let row = status.requests.find((r) => r.id === 'burst-limit');
  assertEqual(row.status, 'collected');
  assert(/push failed/.test(row.git), row.git);
  assertEqual(calls(w).length, 1);

  status = await auto.cycle();
  row = status.requests.find((r) => r.id === 'burst-limit');
  assertEqual(row.status, 'collected');
  assertEqual(row.git, 'pushed');
  assertEqual(calls(w).length, 1, 'a failed delivery caused collection to run again');

  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  assertEqual(readJson(path.join(w.builder, 'research', 'requests', 'burst-limit.result.json')).status, 'collected');
  assert(fs.existsSync(path.join(w.builder, 'research', 'raw', '.fetches.jsonl')), 'the corpus did not travel with the result');
});

test('a request whose every fetch failed is recorded as failed with the fetch error, not as collected (#321)', async () => {
  const w = world({ STANDIN_MODE: 'fetch-failed' });
  saveAutoCollect({ mode: 'auto', perRequestPages: 4, dailyPages: 20 }, w.m.env);
  builderPushes(w, 'nores', GOOD);
  const auto = loop(w);
  const status = await auto.cycle();
  const row = status.requests.find((r) => r.id === 'nores');
  assertEqual(row.status, 'failed', JSON.stringify(status));
  assertEqual(row.pages, 1, 'the panel shows pages used, and the failed attempt was used');
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  const result = readJson(path.join(w.builder, 'research', 'requests', 'nores.result.json'));
  assertEqual(result.status, 'failed');
  assert(/https:\/\/docs\.example\.com\/limits - fetch failed \(getaddrinfo ENOTFOUND/.test(result.detail), result.detail);
  assert(!/operator/.test(result.detail), `another run's failure was attributed to the request: ${result.detail}`);
  assertEqual(result.pages, 0, 'a failed fetch was counted as a collected page');
  assertEqual(result.failed, 1);
  assert(/could not be fetched/.test(result.next) && /urls/.test(result.next), result.next);
  const subject = git(w.builder, w.m.env, 'log', '-1', '--format=%s').trim();
  assertEqual(subject, 'research: request nores failed');
  assert(!/collect/.test(subject), subject);
  await auto.cycle();
  assertEqual(calls(w).length, 1, 'a failed result was collected again without a change to the request');
});

test('a request whose page the ledger says is gone is failed, not collected (#321)', async () => {
  const w = world({ STANDIN_MODE: 'gone' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  writeText(path.join(w.collector, 'research', 'raw', '.fetches.jsonl'), `${JSON.stringify({ op: 'fail', url: GOOD.urls[0], raw: '',
    transport: 'http-keyless', error: 'the page answered HTTP 404 (Not Found) - an error page is not evidence' })}\n`);
  git(w.collector, w.m.env, 'add', '-f', 'research/raw/.fetches.jsonl');
  git(w.collector, w.m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', 'earlier 404');
  git(w.collector, w.m.env, 'push', '-q');
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  builderPushes(w, 'gone', GOOD);
  await loop(w).cycle();
  const result = readJson(path.join(w.collector, 'research', 'requests', 'gone.result.json'));
  assertEqual(result.status, 'failed', JSON.stringify(result));
  assert(/https:\/\/docs\.example\.com\/limits - not fetched again; its last fetch failed: the page answered HTTP 404/.test(result.detail), result.detail);
  assertEqual(result.pages, 0);
  assertEqual(git(w.collector, w.m.env, 'log', '-1', '--format=%s').trim(), 'research: request gone failed');
});

test('a search that finds only a page another request captured is collected and names it (#321)', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  const X = 'https://docs.example.com/rate-limits';
  builderPushes(w, 'first', { ...GOOD, urls: [X] });
  const auto = loop(w);
  await auto.cycle();
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  w.m.env.STANDIN_MODE = 'search-cached';
  builderPushes(w, 'second', { fact: 'What is the free plan rate limit?', blocks: 'the queue design', queries: ['free plan rate limits'] });
  await auto.cycle();
  const result = readJson(path.join(w.collector, 'research', 'requests', 'second.result.json'));
  assertEqual(result.status, 'collected', JSON.stringify(result));
  assertEqual(result.pages, 0);
  assertEqual(result.cached, 1);
  assert(result.next.includes(`already captured (${X})`), result.next);
});

test('nothing fetched is failed only with evidence: an empty or failed search fails, an off-topic one does not (#321)', async () => {
  const w = world({ STANDIN_MODE: 'search-empty' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  const asked = (q) => ({ fact: GOOD.fact, blocks: GOOD.blocks, queries: [q] });
  builderPushes(w, 'empty', asked('x burst limit'));
  const auto = loop(w);
  await auto.cycle();
  const empty = readJson(path.join(w.collector, 'research', 'requests', 'empty.result.json'));
  assertEqual(empty.status, 'failed', JSON.stringify(empty));
  assert(/the search "x burst limit" returned no results/.test(empty.detail), empty.detail);
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  w.m.env.STANDIN_MODE = 'search-offtopic';
  builderPushes(w, 'offtopic', asked('y burst limit'));
  await auto.cycle();
  const offtopic = readJson(path.join(w.collector, 'research', 'requests', 'offtopic.result.json'));
  assertEqual(offtopic.status, 'collected', 'results that matched nothing are not evidence that nothing exists');
  assertEqual(offtopic.pages, 0);
  // Review of the 2026-10-19 sweep: a failed search on the keyless route, which reports no
  // searches used, is failed too - not collected with 0 pages.
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  w.m.env.STANDIN_MODE = 'search-failed';
  builderPushes(w, 'broken', asked('z burst limit'));
  await auto.cycle();
  const broken = readJson(path.join(w.collector, 'research', 'requests', 'broken.result.json'));
  assertEqual(broken.status, 'failed', JSON.stringify(broken));
  assert(/the search "z burst limit" failed/.test(broken.detail), broken.detail);
});

test('another run\'s failure on a page its own search found is not this request\'s (#321)', async () => {
  const w = world({ STANDIN_MODE: 'search-foreign' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'found', { fact: GOOD.fact, blocks: GOOD.blocks, queries: ['x burst limit'] });
  await loop(w).cycle();
  const result = readJson(path.join(w.collector, 'research', 'requests', 'found.result.json'));
  assertEqual(result.status, 'collected', JSON.stringify(result));
  assertEqual(result.pages, 1);
  assertEqual(result.failed, undefined, 'a concurrent run\'s failure was counted against the request');
});

test('a request whose named page is already captured is collected, and told to read it (#321)', async () => {
  const w = world({ STANDIN_MODE: 'gone' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  // The corpus already holds the page: its ledger's last word on it is a fetch.
  writeText(path.join(w.collector, 'research', 'raw', '.fetches.jsonl'), `${JSON.stringify({
    op: 'scrape', url: GOOD.urls[0], raw: 'research/raw/2026-10-01-limits.md', transport: 'http-keyless' })}\n`);
  writeText(path.join(w.collector, 'research', 'raw', '2026-10-01-limits.md'), 'captured earlier\n');
  git(w.collector, w.m.env, 'add', '-f', 'research/raw');
  git(w.collector, w.m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', 'earlier collection');
  git(w.collector, w.m.env, 'push', '-q');
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  builderPushes(w, 'held', GOOD);
  await loop(w).cycle();
  const result = readJson(path.join(w.collector, 'research', 'requests', 'held.result.json'));
  assertEqual(result.status, 'collected', JSON.stringify(result));
  assertEqual(result.cached, 1);
  assert(result.next.includes(`already captured (${GOOD.urls[0]})`), result.next);
});

test('a request with some pages collected and some failed counts only the collected pages (#321)', async () => {
  const w = world({ STANDIN_MODE: 'some-failed' });
  saveAutoCollect({ mode: 'auto', perRequestPages: 4, dailyPages: 20 }, w.m.env);
  builderPushes(w, 'mixed', GOOD);
  const status = await loop(w).cycle();
  assertEqual(status.requests.find((r) => r.id === 'mixed').status, 'collected', JSON.stringify(status));
  const result = readJson(path.join(w.collector, 'research', 'requests', 'mixed.result.json'));
  assertEqual(result.status, 'collected');
  assertEqual(result.pages, 2);
  assertEqual(result.failed, 1);
});

test('a request processed again after the builder edits it reuses its contract row (#322)', async () => {
  const w = world({ STANDIN_MODE: 'fetch-failed' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'nores', GOOD);
  const auto = loop(w);
  await auto.cycle();
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  builderPushes(w, 'nores', { ...GOOD, urls: ['https://docs.example.com/other'] });
  w.m.env.STANDIN_MODE = '';
  await auto.cycle();
  assertEqual(calls(w).length, 2, 'the edited request was not processed again');
  const result = readJson(path.join(w.collector, 'research', 'requests', 'nores.result.json'));
  assertEqual(result.unknown, 'U-1');
  const rows = parseTable(readText(path.join(w.collector, 'research', 'DISCOVERY.md')), HEADERS.unknowns).rows;
  assertEqual(rows.length, 1, 'a second OPEN row was added for the same request');
  const urls = readJson(path.join(w.collector, 'research', 'plan.json')).urls.filter((u) => / request nores$/.test(u.why));
  assertEqual(JSON.stringify(urls.map((u) => u.url)), JSON.stringify(['https://docs.example.com/other']));
});

test('a fresh listener does not re-deliver results already upstream over the operator\'s edits (#325)', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'after', GOOD);
  await loop(w).cycle();
  assertEqual(calls(w).length, 1);
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  builderPushes(w, 'second', { ...GOOD, urls: ['https://docs.example.com/other'] });
  const evidence = path.join(w.collector, 'research', 'EVIDENCE.md');
  writeText(evidence, `${readText(evidence)}\noperator mid-edit\n`);

  // A restarted panel: nothing in memory says "after" was delivered.
  const status = await loop(w).cycle();
  assertEqual(calls(w).length, 1, 'collection ran over uncommitted work');
  assertEqual(git(w.collector, w.m.env, 'log', '-1', '--format=%s').trim(), 'request second', 'a delivery retry made a commit');
  assert(/operator mid-edit/.test(readText(evidence)), 'the operator\'s edit was lost');
  assert(git(w.collector, w.m.env, 'status', '--porcelain', '--', 'research/EVIDENCE.md').trim(), 'the operator\'s edit was committed');
  assert(!/operator mid-edit/.test(git(w.collector, w.m.env, 'show', 'origin/main:research/EVIDENCE.md')), 'the operator\'s edit was pushed');
  const second = status.requests.find((r) => r.id === 'second');
  assertEqual(second.status, 'waiting');
  assert(/uncommitted changes/.test(second.detail), second.detail);
});

test('a pending delivery stages only what it names and waits rather than sweep up the operator\'s edits (#325)', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  builderPushes(w, 'zbroken', '{ not json');
  let refuseCommits = 2;
  const restarted = () => createAutoCollect({
    project: () => w.collector,
    env: w.m.env,
    kitRoot: w.kit,
    exec: (command, args, options) => {
      if (command === 'git' && args[0] === 'commit' && options.env.GIT_INDEX_FILE && refuseCommits > 0) {
        refuseCommits -= 1;
        return Promise.resolve({ code: 1, output: 'hook refused the commit\n' });
      }
      return execFile(command, args, options);
    },
  });
  let status = await restarted().cycle();
  assert(status.requests.every((r) => /commit refused/.test(r.git)), JSON.stringify(status.requests));
  assertEqual(calls(w).length, 1);
  const head = git(w.collector, w.m.env, 'rev-parse', 'HEAD').trim();
  const evidence = path.join(w.collector, 'research', 'EVIDENCE.md');
  writeText(evidence, `${readText(evidence)}\noperator mid-edit\n`);

  status = await restarted().cycle();
  assertEqual(calls(w).length, 1, 'a delivery retry collected again');
  // The refusal is the result file alone: delivered, and nothing else staged with it.
  assertEqual(git(w.collector, w.m.env, 'log', '-1', '--format=%s').trim(), 'research: refuse request zbroken');
  assertEqual(git(w.collector, w.m.env, 'show', '--pretty=', '--name-only', 'HEAD').trim(), 'research/requests/zbroken.result.json');
  assertEqual(git(w.collector, w.m.env, 'rev-parse', 'HEAD~1').trim(), head);
  // The collection's corpus sits beside the operator's edit, and the two cannot be told apart.
  const row = status.requests.find((r) => r.id === 'burst-limit');
  assert(/research\/requests\/burst-limit\.result\.json and the corpus its run wrote are uncommitted/.test(row.git), row.git);
  assert(!/discard/.test(row.git), row.git);
  assert(git(w.collector, w.m.env, 'status', '--porcelain', '--', 'research/EVIDENCE.md').trim(), 'the operator\'s edit was committed');
  assert(!/operator mid-edit/.test(git(w.collector, w.m.env, 'show', 'origin/main:research/EVIDENCE.md')), 'the operator\'s edit was pushed');
});

test('a delivery held back by an earlier request\'s failed push reaches the remote on the next cycle (#325)', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'a-first', GOOD);
  builderPushes(w, 'b-second', { ...GOOD, urls: ['https://docs.example.com/other'] });
  let failPush = 1;
  const auto = createAutoCollect({
    project: () => w.collector,
    env: w.m.env,
    kitRoot: w.kit,
    exec: (command, args, options) => {
      if (command === 'git' && args[0] === 'push' && failPush > 0) {
        failPush -= 1;
        return Promise.resolve({ code: 1, output: 'fatal: unable to access remote (simulated outage)\n' });
      }
      return execFile(command, args, options);
    },
  });
  let status = await auto.cycle();
  assertEqual(calls(w).length, 2);
  assert(/unrelated local commit/.test(status.requests.find((r) => r.id === 'b-second').git), JSON.stringify(status.requests));
  status = await auto.cycle();
  assertEqual(calls(w).length, 2, 'a delivery retry collected again');
  const remote = git(w.remote, w.m.env, 'ls-tree', '-r', '--name-only', 'main');
  assert(remote.includes('research/requests/a-first.result.json'), remote);
  assert(remote.includes('research/requests/b-second.result.json'), 'the second request never reached the builder');
  assertEqual(git(w.collector, w.m.env, 'status', '--porcelain', '--', 'research').trim(), '');
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  builderPushes(w, 'c-third', { ...GOOD, urls: ['https://docs.example.com/third'] });
  status = await auto.cycle();
  assertEqual(calls(w).length, 3, 'the next request was held back');
  assertEqual(status.requests.find((r) => r.id === 'c-third').status, 'collected');
});

test('a delivery retry neither pushes nor stages when the upstream moved past HEAD (#325)', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'after', GOOD);
  await loop(w).cycle();
  const evidence = path.join(w.collector, 'research', 'EVIDENCE.md');
  writeText(evidence, `${readText(evidence)}\noperator mid-edit\n`);
  const head = git(w.collector, w.m.env, 'rev-parse', 'HEAD').trim();
  let raced = false;
  const restarted = createAutoCollect({
    project: () => w.collector,
    env: w.m.env,
    kitRoot: w.kit,
    exec: (command, args, options) => {
      // Between the pull and the delivery check, an editor's autofetch brings in the builder's
      // deletion of the old result.
      if (!raced && command === 'git' && args[0] === 'status' && args.includes('research/requests/after.result.json')) {
        raced = true;
        git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
        git(w.builder, w.m.env, 'rm', '-q', 'research/requests/after.result.json');
        git(w.builder, w.m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', 'builder: re-ask after');
        git(w.builder, w.m.env, 'push', '-q');
        git(w.collector, w.m.env, 'fetch', '-q');
      }
      return execFile(command, args, options);
    },
  });
  const status = await restarted.cycle();
  assert(raced, 'the fixture never reached the delivery check');
  assertEqual(git(w.collector, w.m.env, 'rev-parse', 'HEAD').trim(), head, 'a commit was made over the moved upstream');
  assert(git(w.collector, w.m.env, 'status', '--porcelain', '--', 'research/EVIDENCE.md').trim(), 'the operator\'s edit was committed');
  const row = status.requests.find((r) => r.id === 'after');
  assert(/upstream changed research\/requests\/after\.result\.json/.test(row.git), row.git);
});

test('a malformed request arriving by git is refused with its reasons, and nothing is collected', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'inward', { ...GOOD, urls: ['http://127.0.0.1:47123/api/state'] });
  builderPushes(w, 'broken', '{ not json');
  builderPushes(w, 'greedy', { ...GOOD, maxPages: 20 });
  await loop(w).cycle();
  assertEqual(calls(w).length, 0, 'a refused request reached research.mjs');
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  for (const [id, pattern] of [['inward', /internal address/], ['broken', /does not parse/], ['greedy', /over this collector's budget/]]) {
    const result = readJson(path.join(w.builder, 'research', 'requests', `${id}.result.json`));
    assertEqual(result.status, 'refused', id);
    assert(result.problems.some((p) => pattern.test(p)), `${id}: ${JSON.stringify(result.problems)}`);
  }
});

test('auto-collect refuses a search request targeting a closed unknown', async () => {
  const w = world();
  appendRow(w.collector, 'research/DISCOVERY.md', HEADERS.unknowns, ['U-1', 'Answered fact', 'the implementation', 'CLOSED', '']);
  git(w.collector, w.m.env, 'add', 'research/DISCOVERY.md');
  git(w.collector, w.m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', 'close unknown');
  git(w.collector, w.m.env, 'push', '-q');
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'closed-fact', {
    ...GOOD, unknown: 'U-1', urls: [], queries: ['fact source'],
  });

  const status = await loop(w).cycle();
  assertEqual(calls(w).length, 0, 'a closed unknown query reached research.mjs');
  assertEqual(status.requests.find((r) => r.id === 'closed-fact').status, 'refused');
  assert(/already CLOSED/.test(status.requests.find((r) => r.id === 'closed-fact').detail));
});

test('a builder machine does not collect, whatever the settings say', async () => {
  const w = world();
  writeText(w.m.configFile, JSON.stringify({ role: 'builder' }));
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  git(w.collector, w.m.env, 'pull', '-q', '--ff-only');
  const status = await loop(w).cycle({ force: true });
  assert(/role=builder/.test(status.blocked), status.blocked);
  assertEqual(calls(w).length, 0);
  assertEqual(status.requests[0].status, 'queued');
  assert(!fs.existsSync(path.join(w.collector, 'research', 'requests', 'burst-limit.result.json')));
});

test('when credits run out auto-collect resumes the same request within its remaining allowance', async () => {
  const w = allowanceFixture();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  writeText(path.join(w.collector, 'research', 'requests', 'burst-limit.json'), JSON.stringify(GOOD));
  writeText(path.join(w.collector, 'research', 'requests', 'second.json'), JSON.stringify({ ...GOOD, urls: ['https://docs.example.com/other'] }));
  await assert.rejects(w.exec('git', ['unexpected'], { cwd: w.collector, env: w.m.env }), /unexpected fixture Git command/);
  const auto = createAutoCollect({ project: () => w.collector, env: w.m.env, kitRoot: w.kit, exec: w.exec });
  let status = await auto.cycle();
  assert(/credits ran out on firecrawl/.test(status.paused), status.paused);
  assertEqual(status.spent.pages, 1);
  assertEqual(calls(w).length, 1, 'the run after the stop was attempted');
  assert(!calls(w)[0].includes('--fallback'), 'auto-collect passed --fallback');
  const partial = readJson(path.join(w.collector, 'research', 'requests', 'burst-limit.result.json'));
  assertEqual(partial.status, 'partial');
  assertEqual(partial.resume.unknown, 'U-1');
  assertEqual(partial.resume.remainingPages, 3);
  assertEqual(partial.resume.pagesSpent, 1);
  const planFile = path.join(w.collector, 'research', 'requests', 'burst-limit.plan.json');
  assertEqual(readJson(planFile).maxScrapes, 3, 'the remaining allowance was not saved in the run plan');
  assert(fs.existsSync(path.join(w.collector, 'research', 'raw', '.fetches.jsonl')), 'the partial ledger was not written');

  status = await auto.cycle();
  assertEqual(status.spent.pages, 1);
  assertEqual(calls(w).length, 1, 'a paused loop collected');
  assertEqual(status.requests.find((r) => r.id === 'second').status, 'waiting');
  status = auto.resume();
  assertEqual(status.paused, '');
  status = await auto.cycle();
  const retried = readJson(path.join(w.collector, 'research', 'requests', 'burst-limit.result.json'));
  assertEqual(retried.status, 'partial');
  assertEqual(retried.resume.unknown, 'U-1');
  assertEqual(retried.resume.remainingPages, 2);
  assertEqual(retried.resume.pagesSpent, 2);
  assertEqual(status.spent.pages, 2);
  assertEqual(readJson(planFile).maxScrapes, 2, 'a second stop reset the remaining allowance');
  assertEqual(calls(w).length, 2, 'the second partial attempt did not run');

  w.m.env.STANDIN_MODE = '';
  auto.resume();
  status = await auto.cycle();
  const result = readJson(path.join(w.collector, 'research', 'requests', 'burst-limit.result.json'));
  assertEqual(result.status, 'collected');
  assertEqual(result.unknown, 'U-1', 'the resumed run appended a second unknown');
  assertEqual(result.pages, 4, 'the result does not account for every attempt');
  assertEqual(readJson(planFile).maxScrapes, 2, 'the retry reset the request allowance');
  assertEqual(calls(w).length, 4, 'the paused request or the following request was not resumed');
  assertEqual(status.requests.find((r) => r.id === 'burst-limit').status, 'collected');
  assertEqual(status.requests.find((r) => r.id === 'second').pages, 2);
  assertEqual(status.spent.pages, 6);
});

test('auto-collect refuses to resume a partial request after its unknown is closed', async () => {
  const w = world({ STANDIN_MODE: 'stopped' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  const auto = loop(w);
  let status = await auto.cycle();
  assertEqual(status.requests.find((r) => r.id === 'burst-limit').status, 'partial');
  assertEqual(calls(w).length, 1);

  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  const discovery = path.join(w.builder, 'research', 'DISCOVERY.md');
  const contents = readText(discovery);
  const closed = contents.replace('| U-1 | What is the burst limit of endpoint X? | the retry design | OPEN |',
    '| U-1 | What is the burst limit of endpoint X? | the retry design | CLOSED |');
  assert(closed !== contents, 'the partial request unknown was not found');
  writeText(discovery, closed);
  git(w.builder, w.m.env, 'add', 'research/DISCOVERY.md');
  git(w.builder, w.m.env, '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', 'close partial unknown');
  git(w.builder, w.m.env, 'push', '-q');

  status = await auto.cycle();
  const row = status.requests.find((r) => r.id === 'burst-limit');
  assertEqual(row.status, 'refused');
  assert(/already CLOSED/.test(row.detail), row.detail);
  assertEqual(calls(w).length, 1, 'the closed unknown was collected again');
  assertEqual(readAutoCollect(w.m.env).spent.pages, 1, 'the closed unknown spent additional pages');
});

test('partial delivery retries before pause checks and does not spend another page', async () => {
  const w = world({ STANDIN_MODE: 'stopped' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  let failPush = true;
  const auto = createAutoCollect({
    project: () => w.collector,
    env: w.m.env,
    kitRoot: w.kit,
    exec: (command, args, options) => {
      if (command === 'git' && args[0] === 'push' && failPush) {
        failPush = false;
        return Promise.resolve({ code: 1, output: 'temporary push failure\n' });
      }
      return execFile(command, args, options);
    },
  });

  let status = await auto.cycle();
  assertEqual(status.requests[0].status, 'partial');
  assert(/push failed/.test(status.requests[0].git), status.requests[0].git);
  assertEqual(calls(w).length, 1);
  status = await auto.cycle();
  assertEqual(status.requests[0].status, 'partial');
  assertEqual(status.requests[0].git, 'pushed');
  assertEqual(calls(w).length, 1, 'delivery retry spent more credits');
  git(w.builder, w.m.env, 'pull', '-q', '--ff-only');
  assert(fs.existsSync(path.join(w.builder, 'research', 'raw', '.fetches.jsonl')), 'partial corpus was not delivered');
  assert(fs.existsSync(path.join(w.builder, 'research', 'raw', '2026-10-07-page.md')), 'partial capture was not delivered');
  const partial = readJson(path.join(w.builder, 'research', 'requests', 'burst-limit.result.json'));
  assertEqual(partial.status, 'partial');
  assertEqual(partial.resume.unknown, 'U-1');
  assertEqual(partial.pages, 1);
  assertEqual(partial.resume.pagesSpent, 1);
  assertEqual(partial.resume.remainingPages, 3);
  assertEqual(readJson(path.join(w.builder, 'research', 'requests', 'burst-limit.plan.json')).maxScrapes, 3);
});

test('partial delivery does not push unrelated commits ahead of the upstream', async () => {
  const w = world({ STANDIN_MODE: 'stopped' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  let pushCalls = 0;
  const auto = createAutoCollect({
    project: () => w.collector,
    env: w.m.env,
    kitRoot: w.kit,
    exec: (command, args, options) => {
      if (command === 'git' && args[0] === 'push') {
        pushCalls += 1;
        if (pushCalls === 1) return Promise.resolve({ code: 1, output: 'temporary push failure\n' });
      }
      return execFile(command, args, options);
    },
  });

  let status = await auto.cycle();
  assertEqual(status.requests[0].status, 'partial');
  assertEqual(pushCalls, 1);
  writeText(path.join(w.collector, 'product.txt'), 'unrelated local commit');
  git(w.collector, w.m.env, 'add', 'product.txt');
  git(w.collector, w.m.env, 'commit', '-q', '-m', 'unrelated local work');

  status = await auto.cycle();
  assertEqual(pushCalls, 1, 'retry pushed unrelated local commits');
  assert(/local commits are ahead/.test(status.requests[0].git), status.requests[0].git);
  assertEqual(git(w.collector, w.m.env, 'rev-list', '--count', '@{u}..HEAD').trim(), '2');
});

test('partial delivery does not stage later unrelated research changes', async () => {
  const w = world({ STANDIN_MODE: 'stopped' });
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  let rejectCommit = true;
  const auto = createAutoCollect({
    project: () => w.collector,
    env: w.m.env,
    kitRoot: w.kit,
    exec: (command, args, options) => {
      if (command === 'git' && args[0] === 'commit' && options.env.GIT_INDEX_FILE && rejectCommit) {
        rejectCommit = false;
        return Promise.resolve({ code: 1, output: 'hook refused the commit\n' });
      }
      return execFile(command, args, options);
    },
  });

  let status = await auto.cycle();
  assert(/commit refused/.test(status.requests[0].git), status.requests[0].git);
  assertEqual(calls(w).length, 1);
  writeText(path.join(w.collector, 'research', 'later-work.md'), 'operator work');
  status = await auto.cycle();
  assertEqual(calls(w).length, 1, 'delivery retry collected again');
  assertEqual(readText(path.join(w.collector, 'research', 'later-work.md')), 'operator work');
  assert(/unexpected changes/.test(status.requests[0].git), status.requests[0].git);
});

test('a partial topic request resumes in its original target and reuses its unknown', async () => {
  const w = world({ STANDIN_MODE: 'stopped' });
  saveAutoCollect({ mode: 'auto', topicsFolder: 'projects' }, w.m.env);
  builderPushes(w, 'new-topic', { ...GOOD, topic: 'A separate topic' });
  const auto = loop(w);
  await auto.cycle();
  const resultFile = path.join(w.collector, 'research', 'requests', 'new-topic.result.json');
  const partial = readJson(resultFile);
  assertEqual(partial.status, 'partial');
  const target = path.join(w.collector, partial.resume.target);
  const unknown = partial.resume.unknown;
  const beforeRows = parseTable(readText(path.join(target, 'research', 'DISCOVERY.md')), HEADERS.unknowns).rows;
  const planFile = path.join(target, 'research', 'requests', 'new-topic.plan.json');
  assertEqual(readJson(planFile).maxScrapes, 3);
  const unknownRows = beforeRows.filter((row) => row.cells[0] === unknown).length;

  w.m.env.STANDIN_MODE = '';
  auto.resume();
  const status = await auto.cycle();
  const collected = readJson(resultFile);
  assertEqual(collected.status, 'collected', JSON.stringify(collected));
  assertEqual(collected.project, partial.resume.target);
  assertEqual(collected.unknown, unknown);
  assertEqual(collected.pages, 3);
  const afterRows = parseTable(readText(path.join(target, 'research', 'DISCOVERY.md')), HEADERS.unknowns).rows;
  assertEqual(afterRows.filter((row) => row.cells[0] === unknown).length, unknownRows, 'the resumed run added the unknown twice');
  assertEqual(readJson(planFile).maxScrapes, 3);
  assertEqual(calls(w).length, 2);
  assertEqual(status.requests[0].status, 'collected');
});

test('a request over today\'s cap waits for tomorrow instead of being refused', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto', perRequestPages: 4, dailyPages: 3 }, w.m.env);
  builderPushes(w, 'burst-limit', GOOD);
  const status = await loop(w).cycle();
  assertEqual(calls(w).length, 0);
  const row = status.requests.find((r) => r.id === 'burst-limit');
  assertEqual(row.status, 'waiting');
  assert(/today's cap/.test(row.detail), row.detail);
});

test('a new topic waits until the operator approves a folder for it, then runs unchanged (#323)', async () => {
  const w = world();
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  builderPushes(w, 'new-topic', { ...GOOD, topic: 'Something else entirely' });
  const auto = loop(w);
  let status = await auto.cycle();
  assertEqual(calls(w).length, 0);
  const row = status.requests.find((r) => r.id === 'new-topic');
  assertEqual(row.status, 'waiting');
  assert(/no folder approved for new topics/.test(row.detail), row.detail);
  const resultFile = path.join(w.collector, 'research', 'requests', 'new-topic.result.json');
  assert(!fs.existsSync(resultFile), 'a collector-side condition was written as the request\'s final result');
  assertEqual(git(w.collector, w.m.env, 'log', '-1', '--format=%s').trim(), 'request new-topic', 'the wait was committed');

  // The operator approves a folder; the next cycle collects the same, unedited request.
  saveAutoCollect({ topicsFolder: 'projects' }, w.m.env);
  status = await auto.cycle();
  assertEqual(calls(w).length, 1);
  assertEqual(status.requests.find((r) => r.id === 'new-topic').status, 'collected');
  const result = readJson(resultFile);
  assert(/^projects\/\d{4}-\d{2}-\d{2}-new-topic$/.test(result.project), JSON.stringify(result));
});

test('mode off does nothing on the timer, and uncommitted work under research/ holds a run back', async () => {
  const w = world();
  builderPushes(w, 'burst-limit', GOOD);
  await loop(w).cycle();
  assertEqual(calls(w).length, 0, 'mode off collected');
  saveAutoCollect({ mode: 'auto' }, w.m.env);
  writeText(path.join(w.collector, 'research', 'EVIDENCE.md'), `${readText(path.join(w.collector, 'research', 'EVIDENCE.md'))}\nunfinished review\n`);
  const status = await loop(w).cycle();
  assertEqual(calls(w).length, 0, 'a run would have committed the operator\'s unfinished work');
  assert(/uncommitted changes/.test(status.requests[0].detail), status.requests[0].detail);
});

test('execFile reports a missing program instead of throwing', async () => {
  const r = await execFile(path.join(tempDir(), 'no-such-program'), []);
  assert(r.code !== 0, 'a missing program succeeded');
});
