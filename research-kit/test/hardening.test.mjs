// The defects the 2026-09-16 researcher review confirmed in the previous implementation,
// each pinned here so it cannot return. One test per finding, named by its F-number, and
// each one FAILS against the behaviour the review described.

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { test, describe, assert, makePassingProject, makeProject, corrupt, tempDir, fs, path, appendLine, KIT_ROOT, requireSymlink } from './harness.mjs';
import { PATHS, HEADERS, resolve, readText, writeText, writeJson, tolerateClosedStdout, canonicalJson, sha256, tempBase, tempFreeSpace } from '../lib/core.mjs';
import { readCorpus, appendRow, upsertRow, alignToHeader } from '../lib/corpus.mjs';
import { writeAudit, zipAudit, readManifest, readManifestState, fingerprintOf } from '../lib/audit.mjs';
import { renderBrief } from '../lib/brief.mjs';
import { renderTimeline } from '../lib/timeline.mjs';
import { runResearch } from '../lib/research-run.mjs';
import { decompose } from '../lib/decompose.mjs';
import { collectOne, DEFAULT_SOURCE_TYPE } from '../lib/collect.mjs';
import { scrape, gradeCompleteness, mainContent } from '../lib/http-transport.mjs';
import { rankCandidate } from '../lib/research-run.mjs';
import { collectionPolicy, machineRole, kitHome, configPath, agentsHome } from '../lib/machine.mjs';
import { scanForSecrets } from '../lib/doctor.mjs';
import { lineEndingRemedy } from '../lib/handoff.mjs';
import { runPreflight } from '../lib/preflight.mjs';
import { runCheck } from '../lib/checks.mjs';
import { writeZip } from '../lib/archive.mjs';
import { writeArtifact } from '../lib/artifact.mjs';
import { collectedProject, IDENTITY } from './artifact-fixtures.mjs';
import { deployedDrift, deploy } from '../lib/installer.mjs';

describe('hardening');

const PAGE = 'A claim about limits of 10 per minute and 1,000 credits. '.repeat(20);

function stub({ results = [] } = {}) {
  return {
    name: 'stub-transport',
    search: (query) => ({ ok: true, query, results }),
    runScrape: (url) => ({ ok: true, url, title: 'T', markdown: PAGE, statusCode: 200, transport: 'stub-transport', completeness: 'full', cmd: 'stub' }),
  };
}

// ADR-0122: a run on a ledger whose chain is broken refuses BEFORE anything is spent, beside the
// vendor-CLI and search-provider refusals, not at the first record. Every fetch after the break
// would be refused by handoff and preflight, so the budget they would cost is never spent.
test('a research run refuses before its first fetch when the chain is broken', () => {
  const dir = makePassingProject();
  const file = resolve(dir, PATHS.ledger);
  const lines = readText(file).split('\n');
  lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), url: 'https://x.invalid/edited-after-the-fact' });
  writeText(file, lines.join('\n'));

  let searched = 0;
  let scraped = 0;
  const adapter = {
    ...stub({ results: [{ url: 'https://a.invalid/1' }] }),
    search: (q) => { searched += 1; return stub({ results: [{ url: 'https://a.invalid/1' }] }).search(q); },
    runScrape: (u) => { scraped += 1; return stub().runScrape(u); },
  };
  assert.throws(() => runResearch(dir, { adapter, force: true }), (err) => err.code === 'LEDGER_CHAIN_BROKEN');
  assert.equal(searched + scraped, 0, 'the run spent before it learned the chain could not record it');
  // A dry run is refused the same way: a preview that says "this will collect" on a chain that
  // cannot record it is worse than no preview (the vendor-CLI rule, applied here).
  assert.throws(() => runResearch(dir, { adapter, dryRun: true }), (err) => err.code === 'LEDGER_CHAIN_BROKEN');
});

// --- F16: an unreadable role config must not enable collection --------------------

test('F16: an unreadable config with nothing to hold refuses metered collection', () => {
  const file = path.join(tempDir('rk-f16-'), 'config.json');
  writeText(file, '{"role": "buil');
  const env = { ...process.env, RESEARCH_KIT_CONFIG: file };

  assert.equal(machineRole(env), 'unknown');
  const policy = collectionPolicy(env);
  assert.equal(policy.mayCollect, false, 'collector is the role that may spend credits - it is not a fallback');
  assert.match(policy.remedy, /--role/);
});

test('F16: a misspelled role is unknown, not a silent default', () => {
  const file = path.join(tempDir('rk-f16b-'), 'config.json');
  writeText(file, JSON.stringify({ role: 'Collector' }));
  assert.equal(collectionPolicy({ ...process.env, RESEARCH_KIT_CONFIG: file }).mayCollect, false);
});

// --- F10: a manifest must not package files outside the project -------------------

test('F10: a manifest entry that climbs out of research/audits/ is refused', () => {
  const dir = makePassingProject();
  writeAudit(dir);
  const outside = path.join(path.dirname(dir), 'private-canary.txt');
  writeText(outside, 'CANARY');

  const manifest = readManifest(dir);
  manifest.topics['fixture-topic'].versions['0.1'].subtopics.push('../../private-canary.txt');
  writeJson(resolve(dir, `${PATHS.audits}/index.json`), manifest);

  // The canary sits BESIDE the scratch project, in the temp root itself, so the run's
  // scratch sweep (tempDir) does not reach it: removed here, or every run leaves it behind.
  try {
    const bundle = zipAudit(dir);
    assert.equal(bundle.ok, false, 'a corpus can arrive from another machine with its manifest');
    assert.match(bundle.reason, /outside/);
  } finally { fs.rmSync(outside, { force: true }); }
});

test('F10: an absolute path in the manifest is refused too', () => {
  const dir = makePassingProject();
  writeAudit(dir);
  const manifest = readManifest(dir);
  manifest.topics['fixture-topic'].versions['0.1'].subtopics.push(path.join(tempDir('rk-abs-'), 'x.md'));
  writeJson(resolve(dir, `${PATHS.audits}/index.json`), manifest);
  assert.equal(zipAudit(dir).ok, false);
});

// --- F15: a corrupt index must not destroy immutability ---------------------------

test('F15: absent and corrupt are different manifest states', () => {
  const dir = makePassingProject();
  assert.equal(readManifestState(dir).state, 'absent');
  writeAudit(dir);
  assert.equal(readManifestState(dir).state, 'readable');
  writeText(resolve(dir, `${PATHS.audits}/index.json`), '{ corrupt');
  assert.equal(readManifestState(dir).state, 'corrupt');
});

test('F15: a corrupt index is refused, and the immutable file survives', () => {
  const dir = makePassingProject();
  const first = writeAudit(dir);
  const before = readText(resolve(dir, first.main));

  writeText(resolve(dir, `${PATHS.audits}/index.json`), '{ corrupt');
  corrupt(dir, PATHS.evidence, (t) => t.replace('The free plan', 'REWRITTEN: the free plan'));

  const second = writeAudit(dir);
  assert.equal(second.written, false, 'treating corrupt as empty restarts the count and overwrites v0.1');
  assert.match(second.reason, /does not parse/);
  assert.equal(readText(resolve(dir, first.main)), before, 'the existing audit is untouched');
});

// --- F06: the fingerprint must cover everything the audit renders -----------------

test('F06: answering the brief\'s judged section bumps the audit', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  writeAudit(dir);

  const brief = resolve(dir, PATHS.brief);
  writeText(brief, readText(brief).replace(/## Decision\n\n\*\*TODO\*\*[\s\S]*?\n\n## Next steps/, '## Decision\n\nBuild the collector first.\n\n## Next steps'));

  const second = writeAudit(dir);
  assert.equal(second.written, true, 'the audit prints the Decision, so the Decision is an input');
  assert.equal(second.version, '0.2');
});

test('F06: rewriting a claim bumps it too', () => {
  const dir = makePassingProject();
  const before = fingerprintOf(readCorpus(dir));
  corrupt(dir, PATHS.evidence, (t) => t.replace('The free plan', 'Revised: the free plan'));
  assert.notEqual(fingerprintOf(readCorpus(dir)), before);
});

// --- F22: writers must map onto the header actually on disk -----------------------

test('F22: a reordered header does not scramble the cells', () => {
  const dir = makeProject();
  writeText(resolve(dir, PATHS.evidence), '# Evidence\n\n| ID | URL | Retrieved | Type | Finding | Raw |\n|---|---|---|---|---|---|\n');
  appendRow(dir, PATHS.evidence, HEADERS.evidence, ['E-01', '2026-09-17', 'P', 'https://x.invalid/a', 'claim', 'research/raw/a.md']);

  const row = readCorpus(dir).evidence[0];
  assert.equal(row.url, 'https://x.invalid/a', 'the URL must land in the URL column, wherever it is');
  assert.equal(row.retrieved, '2026-09-17');
  assert.equal(row.type, 'P');
});

test('F22: upsert matches its key in the column that holds it', () => {
  const dir = makeProject();
  writeText(resolve(dir, PATHS.sources), '# Sources\n\n| Type | URL | Title | Retrieved | Used for |\n|---|---|---|---|---|\n');
  upsertRow(dir, PATHS.sources, HEADERS.sources, ['https://x.invalid', 'P', 'First', '2026-01-01', 'U-1']);
  upsertRow(dir, PATHS.sources, HEADERS.sources, ['https://x.invalid', 'P', 'Second', '2026-02-01', 'U-1']);

  const rows = readCorpus(dir).sources;
  assert.equal(rows.length, 1, 'one row, replaced - not two');
  assert.equal(rows[0].title, 'Second');
  assert.equal(rows[0].url, 'https://x.invalid');
});

test('F22: a header the canonical set does not cover is REFUSED, not guessed at', () => {
  const dir = makeProject();
  writeText(resolve(dir, PATHS.evidence), '# Evidence\n\n| ID | Whatever | Retrieved | Type | Finding | Raw |\n|---|---|---|---|---|---|\n');
  assert.throws(
    () => appendRow(dir, PATHS.evidence, HEADERS.evidence, ['E-01', 'd', 'P', 'u', 'f', 'r']),
    /Whatever/,
  );
});

test('F22: alignToHeader is the mapping, and it is identity when the order matches', () => {
  assert.deepEqual(alignToHeader(['A', 'B'], ['1', '2'], ['A', 'B']), ['1', '2']);
  assert.deepEqual(alignToHeader(['A', 'B'], ['1', '2'], ['B', 'A']), ['2', '1']);
  assert.deepEqual(alignToHeader(['A', 'B'], ['1', '2'], null), ['1', '2']);
});

// --- F19 / F20: budgets must be honest and validated ------------------------------

test('F19: a dry run previews against the SAME budget execution would use', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), {
    topic: 'x', depth: 'probe', maxScrapes: 1, queries: [],
    urls: ['https://x.invalid/a', 'https://x.invalid/b', 'https://x.invalid/c'],
  });

  const run = runResearch(dir, { adapter: stub(), dryRun: true });
  assert.equal(run.spent, 0, 'a dry run spends nothing');
  assert.equal(run.attempts, 1, 'and shows what it WOULD cost, capped');
  assert.equal(run.results.filter((r) => /budget exhausted/.test(r.reason ?? '')).length, 2);
});

test('F19: the preview and the execution agree on which URLs are in budget', () => {
  const plan = { topic: 'x', depth: 'probe', maxScrapes: 1, queries: [], urls: ['https://x.invalid/a', 'https://x.invalid/b'] };
  const preview = makeProject();
  writeJson(resolve(preview, PATHS.plan), plan);
  const real = makeProject();
  writeJson(resolve(real, PATHS.plan), plan);

  const dry = runResearch(preview, { adapter: stub(), dryRun: true });
  const wet = runResearch(real, { adapter: stub() });
  // In a dry run EVERY row has status `skipped` - nothing was done. What must agree is
  // the budget decision, which is carried by the reason.
  const budgetCall = (run) => run.results.map((r) => `${r.url}:${/budget exhausted/.test(r.reason ?? '') ? 'over-budget' : 'in-budget'}`);
  assert.deepEqual(budgetCall(dry), budgetCall(wet));
  assert.deepEqual(budgetCall(wet), ['https://x.invalid/a:in-budget', 'https://x.invalid/b:over-budget']);
});

test('F20: a budget that is not a number is REFUSED before anything is spent', () => {
  const dir = makeProject();
  let scraped = 0;
  const adapter = { ...stub({ results: [{ url: 'https://a.invalid/1' }] }), runScrape: (u) => { scraped += 1; return stub().runScrape(u); } };
  assert.throws(() => decompose(dir, { topic: 't', adapter, maxScrapes: Number('abc') }), /whole number/);
  assert.equal(scraped, 0, 'NaN removed the cap it looked like it was setting');
});

test('F20: failed searches are kept, not just printed', () => {
  const dir = makeProject();
  const result = decompose(dir, {
    topic: 't',
    adapter: { name: 's', search: () => ({ ok: false, error: 'HTTP 402' }), runScrape: () => ({ ok: false }) },
  });
  assert.equal(result.gathered, false, 'a quiet topic and a failed run must not look the same');
  assert.equal(result.failures.length, 4);
  assert.match(result.failures[0].error, /402/);
});

// --- F04: completeness is not length ----------------------------------------------

test('F04: a dropped sibling section makes a capture partial, and says so', () => {
  const body = `<html><body>
    <article>${'Ordinary prose about the product. '.repeat(90)}</article>
    <article><h2>Quota exception</h2><p>Enterprise keys are exempt from the cap.</p></article>
  </body></html>`;
  const result = scrape('https://x.invalid/p', {
    spawn: () => ({ stdout: JSON.stringify({ ok: true, url: 'https://x.invalid/p', body }), stderr: '', status: 0 }),
  });
  assert.equal(result.completeness, 'partial', 'long is not the same as complete');
  assert.match(result.omitted, /sibling section/);
});

test('F04: a page with one block and nothing dropped is full', () => {
  const body = `<html><body><article>${'One clean article and nothing else at all. '.repeat(90)}</article></body></html>`;
  const result = scrape('https://x.invalid/p', {
    spawn: () => ({ stdout: JSON.stringify({ ok: true, url: 'https://x.invalid/p', body }), stderr: '', status: 0 }),
  });
  assert.equal(result.completeness, 'full');
  assert.equal(result.omitted, '');
});

test('F04: the drop analysis sees short blocks the SELECTION ignores', () => {
  const html = `<div><div class=main>${'long prose here. '.repeat(60)}</div><div class=note>a short but load-bearing caveat</div></div>`;
  const extraction = mainContent(html);
  assert.ok(extraction.dropped.length, 'a 30-character caveat box is exactly what gets lost');
  assert.equal(gradeCompleteness('x'.repeat(5000), extraction).completeness, 'partial');
});

// --- F24: authority is not assigned by the fetcher --------------------------------

test('F24: an auto-collected row is born secondary, not primary', () => {
  const dir = makeProject();
  const corpus = readCorpus(dir);
  collectOne(dir, 'https://random-blog.invalid/opinion', { corpus, runScrape: stub().runScrape });
  assert.equal(DEFAULT_SOURCE_TYPE, 'S');
  assert.equal(readCorpus(dir).evidence[0].type, 'S', 'P carries the design; reaching a page proves nothing about ownership');
});

test('F24: a plan entry may declare P, because a person wrote that URL down', () => {
  const dir = makeProject();
  writeJson(resolve(dir, PATHS.plan), { topic: 'x', depth: 'quick', queries: [], urls: [{ url: 'https://docs.example.com/limits', type: 'P', why: 'U-1' }] });
  runResearch(dir, { adapter: stub() });
  assert.equal(readCorpus(dir).evidence[0].type, 'P');
});

test('F24: a lookalike host does not score as the real one', () => {
  assert.ok(rankCandidate('https://notgithub.com.example.org/fake') < rankCandidate('https://docs.example.com/limits'));
  assert.ok(rankCandidate('https://docs.evil.invalid.example.org/x') < 8);
});

// --- F07: the brief must not claim a review that did not happen -------------------

test('F07: a drafted brief over a FAILING gate says so instead of announcing completion', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (t) => t.replace('CLOSED', 'OPEN'));
  const verdict = runPreflight(dir);
  renderBrief(dir, { verdict, force: true });

  const text = readText(resolve(dir, PATHS.brief));
  assert.match(text, /Gate: FAIL/);
  assert.doesNotMatch(text, /Phase 1 \(research\) is complete/);
});

test('F07: an unanswered TODO says the handoff is not approved', () => {
  const dir = makePassingProject();
  renderBrief(dir, { verdict: runPreflight(dir) });
  const text = readText(resolve(dir, PATHS.brief));
  assert.match(text, /Gate: PASS/);
  assert.match(text, /\*\*not reviewed\*\*/);
  assert.match(text, /\*\*not approved\*\*/);
  assert.match(text, /three different states/, 'valid, reviewed and approved are not the same claim');
});

// --- F27: a diagnostic must not print a destructive remedy ------------------------

test('F27: the line-ending remedy never deletes, and checks before it changes anything', () => {
  const remedy = lineEndingRemedy(['research/raw/a.md']);
  // `git rm --cached` touches the index only; any other `git rm` deletes a file.
  const removals = remedy.split('\n').filter((line) => /git rm\b/.test(line));
  assert.ok(removals.every((line) => /--cached/.test(line)), `uncommitted evidence is irreplaceable: ${removals.join(' / ')}`);
  assert.doesNotMatch(remedy, /checkout -- research\//);
  assert.match(remedy, /git status --porcelain/, 'the preservation check comes first');
  assert.ok(remedy.indexOf('git status --porcelain') < remedy.indexOf('git rm'), 'the check comes before any change');
  assert.match(remedy, /git checkout HEAD -- research\/raw\/a\.md/, 'and the scope is the affected files');
});

test('F27: with no git metadata, the remedy refuses to suggest a command at all', () => {
  const remedy = lineEndingRemedy(['research/raw/a.md'], { isRepo: false });
  assert.match(remedy, /no git metadata/);
  assert.doesNotMatch(remedy, /git add/);
});

// --- F26: the secret scan, and what it honestly covers ----------------------------

/**
 * Synthetic credentials are ASSEMBLED, never written as literals.
 *
 * A test fixture containing a credential-shaped string is a credential-shaped string in
 * the repository, and `doctor`'s own scan reports it on every run. A scanner that is
 * permanently red about its own tests is one nobody reads - and the alternative, an
 * exclusion for the test directory, is a hole in the scan big enough to hide a real key
 * in. Splitting the string closes both.
 */
const fixtureKey = (prefix, body) => `${prefix}${body}`;

test('F26: a credential in a DOTFILE is found, not skipped', () => {
  const dir = makeProject();
  writeText(resolve(dir, '.env.local'), `FIRECRAWL_API_KEY=${fixtureKey('fc', '-0123456789abcdef0123')}\n`);
  const scan = scanForSecrets(dir);
  assert.equal(scan.hits.length, 1, '.env.local is exactly where a key hides');
  assert.equal(scan.hits[0].pattern, 'firecrawl-key');
});

test('F26: several credential shapes are recognised, and the coverage is stated', () => {
  const dir = makeProject();
  const aws = fixtureKey('AKIA', 'IOSFODNN7EXAMPLE');
  const gh = fixtureKey('ghp', '_0123456789abcdefghij0123456789abcd');
  writeText(resolve(dir, 'notes.md'), `${aws} and ${gh}\n`);
  const scan = scanForSecrets(dir);
  assert.deepEqual(scan.hits.map((h) => h.pattern).sort(), ['aws-access-key-id', 'github-token']);
  assert.match(scan.coverage, /credential patterns over \d+ text file/);
});

// Found 2026-10-04 by CI on the second gap audit's corpora: the scan skipped `research/raw`
// at the ROOT only (`SECRET_SKIP_DIRS` matched the relative path `research/raw`), so a
// nested decision project's captures were scanned - and a Google page's source sibling
// (ADR-0140 keeps the HTML the markdown was converted from) carries Google's own public
// Maps keys, which match `google-api-key`. A capture is page content, not a committed
// credential, which is why the root's raw folder was excluded; the exclusion is a rule
// about the folder, and the folder exists at every depth a nested project does (ADR-0030).
test('F26: a nested project\'s research/raw is page content, excluded from the scan like the root\'s', () => {
  const dir = makeProject();
  const nestedRaw = resolve(dir, 'docs/decisions/2026-10-04-example/research/raw');
  fs.mkdirSync(nestedRaw, { recursive: true });
  const google = fixtureKey('AIza', 'SyA0123456789abcdefghijklmnopqrstuvw');
  writeText(path.join(nestedRaw, '2026-10-04-page-example-00000000.source.html'), `<script>key:"${google}"</script>\n`);
  writeText(path.join(nestedRaw, '2026-10-04-page-example-00000000.md'), `---\nurl: https://example.invalid/\n---\n\n${google}\n`);
  // The same string OUTSIDE a raw folder of the nested project is still a committed key.
  writeText(resolve(dir, 'docs/decisions/2026-10-04-example/research/notes.md'), `${google}\n`);
  const scan = scanForSecrets(dir);
  assert.deepEqual(scan.hits.map((h) => [h.file, h.pattern]), [['docs/decisions/2026-10-04-example/research/notes.md', 'google-api-key']],
    `the nested captures were scanned as if they were the project's own files: ${JSON.stringify(scan.hits)}`);
});

// Found 2026-10-02, running `doctor` on a Windows home folder: fourteen critical "secret"
// findings, every one inside an ssh executable or a libssh2 DLL under a tool's cache.
// Those binaries carry the `BEGIN RSA PRIVATE KEY` PEM marker as a string they PARSE, and
// random bytes that happen to spell `sk-` followed by sixteen word characters. The scan
// read each as UTF-8, matched the patterns, and counted it as a "text file" in its own
// coverage line - a scanner red about OpenSSH's string table is one nobody reads, and a
// project that vendors one such binary could never reach READY.
test('F26: a binary file is not a text file - the PEM marker inside an executable is not a committed key', () => {
  const dir = makeProject();
  const marker = `-----BEGIN RSA PRIVATE ${'KEY'}-----`;
  const key = `${'sk'}-${'0123456789abcdef'}0123`;
  const binary = Buffer.concat([
    Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
    Buffer.from(`${marker} ${key}`, 'utf8'),
    Buffer.from([0x00, 0x00, 0xff, 0xfe, 0x00]),
  ]);
  fs.mkdirSync(resolve(dir, 'vendor'));
  fs.writeFileSync(resolve(dir, 'vendor/libssh2.dll'), binary);
  const scan = scanForSecrets(dir);
  assert.deepEqual(scan.hits, [], `a binary's string table was reported as a credential: ${JSON.stringify(scan.hits)}`);
  assert.equal(scan.skippedBinary, 1, 'the binary is counted as skipped, not as a text file');
  assert.match(scan.coverage, /binar/, 'the coverage says binaries are outside it');
  // The same marker in a TEXT file is still found: the rule is about NUL bytes, not about
  // the pattern - a .pem is text and stays caught.
  writeText(resolve(dir, 'vendor/id_rsa.pem'), `${marker}\nMIIB\n`);
  const again = scanForSecrets(dir);
  assert.deepEqual(again.hits.map((h) => [h.file, h.pattern]), [['vendor/id_rsa.pem', 'private-key-block']]);
});

test('F26: the kit does not trip its own scan - the fixtures are assembled, not written', () => {
  const scan = scanForSecrets(process.cwd());
  assert.deepEqual(scan.hits, [], `a scanner that is always red about itself is one nobody reads: ${JSON.stringify(scan.hits)}`);
});

// Found 2026-09-29 (break-test): a RELATIVE TMPDIR - `TMPDIR=.`, a Makefile that exports
// the folder before it creates it - is legal to node and was resolved by `fs.mkdtemp`
// against whichever cwd was current at the call. Scratch directories scattered, and the
// COMMIT GATE's index snapshot threw `ENOENT: mkdtemp 'reltmp/research-kit-index-XXXXXX'`,
// which the gate reports as an internal error and FAILS OPEN on: the machine stopped
// being gated and nothing said so. 21 tests were red for the same one-line cause.
const restoreTempEnv = (saved) => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

/**
 * Point every temp variable at `value`, and put them back afterwards.
 *
 * ALL THREE, not just TMPDIR: TMPDIR is the POSIX name, TEMP and TMP are what Windows
 * reads, and `os.tmpdir()` consults a different one per platform. A test that sets only
 * the POSIX name passes on Linux and quietly asserts nothing on windows-latest - which is
 * where this suite's Windows leg caught it (found 2026-09-29, break-test).
 */
const setTempEnv = (value) => {
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  Object.assign(process.env, { TMPDIR: value, TEMP: value, TMP: value });
  return saved;
};

test('F29: a relative TMPDIR is answered absolutely, so mkdtemp cannot scatter scratch', () => {
  const saved = setTempEnv('./reltmp');
  try {
    const base = tempBase();
    assert.ok(path.isAbsolute(base), `a relative TMPDIR stayed relative: ${base}`);
    assert.equal(path.basename(base), 'reltmp');
    // Published, because every child - git, sh, python, the kit's own CLIs - re-resolves a
    // relative TMPDIR against ITS cwd, and the folder made here is not the one it looks in.
    for (const name of ['TMPDIR', 'TEMP', 'TMP']) {
      if (saved[name] !== undefined) {
        assert.equal(process.env[name], base, `the absolute answer was not published for ${name}`);
      }
    }
    assert.equal(os.tmpdir(), base, 'the absolute answer was not published for child processes');
    // Stable: a later call, after any chdir, must not move the answer.
    assert.equal(tempBase(), base, 'the temp folder moved between two calls in one process');
  } finally {
    restoreTempEnv(saved);
  }
});

test('F29: an absolute TMPDIR is used as it stands, and left alone', () => {
  const scratch = tempDir('rk-abs-tmp-');
  const saved = setTempEnv(scratch);
  try {
    assert.equal(tempBase(), path.resolve(scratch));
    assert.equal(process.env.TMPDIR, scratch, 'an absolute TMPDIR was rewritten');
  } finally {
    restoreTempEnv(saved);
  }
});

test('F29: the secret scan skips the temp folder, which a relative TMPDIR puts inside the tree', () => {
  const parent = tempDir('rk-scan-parent-');
  const scratch = path.join(parent, 'scratch');
  fs.mkdirSync(scratch);
  // Credential-shaped, assembled rather than written as a literal (F26).
  writeText(path.join(scratch, 'notes.md'), `gh${'p'}_0123456789abcdefghij0123456789abcd\n`);
  const saved = setTempEnv(scratch);
  try {
    const scan = scanForSecrets(parent);
    assert.deepEqual(scan.hits, [], `the machine's own scratch folder was reported as a committed credential: ${JSON.stringify(scan.hits)}`);
  } finally {
    restoreTempEnv(saved);
  }
});

test('F26: a clean tree reports what was scanned rather than implying completeness', () => {
  const scan = scanForSecrets(makeProject());
  assert.equal(scan.hits.length, 0);
  assert.match(scan.coverage, /dotfiles included/);
});

// --- path precedence ---------------------------------------------------------------

test('PP: RESEARCH_KIT_HOME outranks the OS profile, in the module as well as the hook', () => {
  const home = path.join(tempDir('rk-home-'), 'research-kit');
  assert.equal(kitHome({ RESEARCH_KIT_HOME: home }), path.resolve(home));
  assert.equal(agentsHome({ RESEARCH_KIT_HOME: home }), path.dirname(path.resolve(home)));
  assert.notEqual(kitHome({ RESEARCH_KIT_HOME: home }), kitHome({}));
});

test('PP: an explicit argument beats the environment variable', () => {
  const explicit = path.join(tempDir('rk-explicit-'), 'c.json');
  assert.equal(configPath({ RESEARCH_KIT_CONFIG: '/from/env.json' }, explicit), path.resolve(explicit));
  // Resolved, as the explicit argument is (#367): on Windows a rooted path gains its drive.
  assert.equal(configPath({ RESEARCH_KIT_CONFIG: '/from/env.json' }), path.resolve('/from/env.json'));
});

test('PP: with neither, the config sits under the RESEARCH_KIT_HOME agents root', () => {
  const home = path.join(tempDir('rk-home2-'), 'research-kit');
  assert.equal(configPath({ RESEARCH_KIT_HOME: home }), path.join(path.dirname(path.resolve(home)), 'research-kit.config.json'));
});

// --- F21: a refresh triggers claim review, it does not substitute silently ---------

test('F21: an unknown still citing a superseded row FAILS, naming the replacement', () => {
  const dir = makePassingProject(undefined, { date: '2026-01-01' });
  // Both dates are fixed and in the past, so the superseding row is the later one on every day
  // this runs. It was dated 2026-12-01 against a fixture dated TODAY, and would have gone red on
  // that day with no code change (found 2026-09-30, break-test).
  // A forced re-collection of the same URL, as `--refresh-days` produces.
  corrupt(dir, PATHS.evidence, (t) => `${t}| E-02 | 2026-02-01 | P | https://example.invalid/docs/limits | The free plan now allows 20 requests per minute. | research/raw/newer.md |\n`);
  writeText(resolve(dir, 'research/raw/newer.md'), '---\nurl: https://example.invalid/docs/limits\nretrieved: 2026-02-01\n---\n\nbody\n');

  const findings = runCheck('evidence-supersession', readCorpus(dir));
  const failed = findings.find((f) => f.severity === 'fail');
  assert.ok(failed, 'U-1 still rests on E-01, whose page has been re-read since');
  assert.equal(failed.superseded, 'E-01');
  assert.equal(failed.by, 'E-02');
  assert.match(failed.detail, /move the citation/);
});

test('F21: once the citation moves, the check passes and the old capture is kept', () => {
  const dir = makePassingProject(undefined, { date: '2026-01-01' });
  corrupt(dir, PATHS.evidence, (t) => `${t}| E-02 | 2026-02-01 | P | https://example.invalid/docs/limits | The free plan now allows 20 requests per minute. | research/raw/newer.md |\n`);
  writeText(resolve(dir, 'research/raw/newer.md'), '---\nurl: https://example.invalid/docs/limits\nretrieved: 2026-02-01\n---\n\nbody\n');
  corrupt(dir, PATHS.discovery, (t) => t.replace('E-01:', 'E-02:'));

  const findings = runCheck('evidence-supersession', readCorpus(dir));
  assert.equal(findings.some((f) => f.severity === 'fail'), false);
  assert.ok(findings.some((f) => f.rule === 'superseded-and-released'), 'the old row is history, not garbage');
  assert.ok(readCorpus(dir).evidence.some((r) => r.id === 'E-01'), 'and it is still there - evidence is irreplaceable');
});

test('F21: a corpus where nothing was re-collected says so and passes', () => {
  const findings = runCheck('evidence-supersession', readCorpus(makePassingProject()));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'pass');
});

test('F21: the stale warning names the fresher capture when one already exists', () => {
  const dir = makePassingProject(undefined, { date: '2020-01-01' });
  corrupt(dir, PATHS.evidence, (t) => `${t}| E-02 | 2026-02-01 | P | https://example.invalid/docs/limits | Restated. | research/raw/newer.md |\n`);
  writeText(resolve(dir, 'research/raw/newer.md'), '---\nurl: https://example.invalid/docs/limits\nretrieved: 2026-02-01\n---\n\nbody\n');

  const findings = runCheck('unknown-closure', readCorpus(dir), { maxAgeDays: 180 });
  const stale = findings.find((f) => f.rule === 'stale-evidence');
  assert.match(stale.detail, /E-02 is already a fresher capture/, '"go and collect" and "go and read" are different instructions');
});

// Found 2026-09-27: the regenerated timeline told its reader "node research-kit/bin/timeline.mjs",
// which exists only at the kit repository's root - not in the project folder it is read in.
test('the timeline names a regenerate command that runs from the project folder', () => {
  const dir = makePassingProject();
  renderTimeline(dir);
  const [, arg] = readText(resolve(dir, PATHS.timeline)).match(/\bnode\s+("[^"]+"|\S+?\.mjs)/) ?? [];
  assert.ok(arg, 'the timeline names no command');
  const file = path.resolve(dir, arg.replace(/^"|"$/g, ''));
  assert.ok(fs.existsSync(file), `the timeline says "node ${arg}", and from the project folder that is ${file}, which does not exist`);
});

// Found 2026-09-27: TIMELINE.md's When column mixed "2026-09-27" (evidence) with
// "2026-09-27T00:00:00.000Z" (fetches, stamped at day precision) in one table.
test('the timeline writes each moment in one readable form', () => {
  const dir = makePassingProject();
  appendLine(resolve(dir, PATHS.overrides), '2026-09-27T14:05:09.123Z\tno-verify\tx');
  renderTimeline(dir);
  const text = readText(resolve(dir, PATHS.timeline));
  const whens = text.split('\n').filter((l) => /^\| \d/.test(l)).map((l) => l.split('|')[1].trim());
  assert.ok(whens.length >= 2, text);
  for (const when of whens) assert.match(when, /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2} UTC)?$/, `mixed form: ${when}`);
  assert.ok(whens.includes('2026-09-27 14:05 UTC'), `a real time was lost: ${whens}`);
});

test('timeline errors with CR/LF or pipes stay inside one readable table row', () => {
  const dir = makePassingProject();
  const corpus = readCorpus(dir);
  for (const error of ['Error: failed\n', 'Error:\r\nretry | later\r\n', 'Error:\nsecond\nthird']) {
    corpus.ledger.entries.push({ at: '2026-10-13T01:02:03.000Z', op: 'fail', url: 'https://x.invalid/page', error });
  }
  renderTimeline(dir, { corpus });
  const lines = readText(resolve(dir, PATHS.timeline)).split('\n');
  const rows = lines.filter((line) => line.includes('fetch failed'));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows, [
    '| 2026-10-13 01:02 UTC | fetch failed | https://x.invalid/page - Error: failed |',
    '| 2026-10-13 01:02 UTC | fetch failed | https://x.invalid/page - Error: retry \\| later |',
    '| 2026-10-13 01:02 UTC | fetch failed | https://x.invalid/page - Error: second third |',
  ]);
});

// Found 2026-09-28 (an outside break-test, F-02; confirmed): writeText opened its target
// with 'w', which EMPTIES it before a byte is written, so a write cut short - a full disk, a
// quota, EFBIG, a killed process - left a partial new file where the old one had been.
// Measured: a 6,300-byte file under a 4 KB limit became 4,096 bytes of the new text, the
// original gone. EVIDENCE.md and MAP.md are rewritten this way and hold the review work.
test('a write cut short leaves the file it was replacing untouched, and no scratch file', () => {
  const dir = tempDir('rk-atomic-');
  const target = path.join(dir, 'EVIDENCE.md');
  fs.writeFileSync(target, 'ORIGINAL REVIEW WORK\n'.repeat(300));
  const before = fs.readFileSync(target, 'utf8');
  const real = fs.writeFileSync;
  fs.writeFileSync = (file, data, ...rest) => {
    real(file, String(data).slice(0, 64), ...rest);          // some bytes land, then the disk is full
    const err = new Error('ENOSPC: no space left on device, write'); err.code = 'ENOSPC'; throw err;
  };
  let error = null;
  try { writeText(target, 'NEW '.repeat(12_000)); } catch (err) { error = err; } finally { fs.writeFileSync = real; }
  assert.equal(error?.code, 'ENOSPC', 'the failure must still reach the caller');
  assert.equal(fs.readFileSync(target, 'utf8'), before, 'the file being replaced was damaged');
  assert.deepEqual(fs.readdirSync(dir), ['EVIDENCE.md'], 'a scratch file was left behind');
});

// 2026-10-03 (architecture pass): one fold for the bytes the kit writes and compares - CRLF
// and a lone CR both become LF. Four sites carried their own regex, two of which disagreed.
test('foldLineEndings turns CRLF and a lone CR into LF, and leaves LF alone', async () => {
  const { foldLineEndings } = await import('../lib/core.mjs');
  assert.equal(foldLineEndings('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  assert.equal(foldLineEndings('plain\n'), 'plain\n');
  assert.equal(foldLineEndings(null), '', 'absent text folds to the empty string, as writeRaw expects');
});

test('writeText keeps the replaced file\'s mode, and writes through a symlink to its target', () => {
  const dir = tempDir('rk-atomic-');
  const target = path.join(dir, 'config.json');
  fs.writeFileSync(target, '{}\n');
  fs.chmodSync(target, 0o600);
  writeText(target, '{"a":1}\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600, 'a 0600 file became world-readable');
  const real = path.join(dir, 'real.md');
  fs.writeFileSync(real, 'old\n');
  const link = path.join(dir, 'link.md');
  requireSymlink(real, link, 'a write through a symlink');
  writeText(link, 'new\n');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the symlink was replaced by a file');
  assert.equal(fs.readFileSync(real, 'utf8'), 'new\n', 'the write did not reach the link target');
});

// Found 2026-09-28 (break-test): ADR-0079's rule - a rewrite replaces the file whole or
// not at all - was implemented in `writeText` and applied to the text files. The two
// files this kit HANDS TO SOMEBODY ELSE are written as bytes by `lib/archive.mjs`
// (`writeZip`, the audit bundle) and `lib/artifact.mjs` (`writeArtifact`, the delivered
// package), and both still called `fs.writeFileSync` on the target. Measured: a
// 2,679,013-byte package re-created under a 512 KB file-size limit was left as 524,288
// bytes, and the package it replaced was gone. The technique is the one above: a partial
// write lands, then the environment refuses the rest.
test('a ZIP write cut short leaves the file it was replacing untouched', () => {
  const dir = tempDir('rk-atomic-');
  const target = path.join(dir, 'audit.zip');
  const previous = Buffer.from('PREVIOUS AUDIT BUNDLE\n'.repeat(200));
  fs.writeFileSync(target, previous);
  const real = fs.writeFileSync;
  fs.writeFileSync = (file, data, ...rest) => {
    real(file, Buffer.isBuffer(data) ? data.subarray(0, 32) : String(data).slice(0, 32), ...rest);
    const err = new Error('ENOSPC: no space left on device, write'); err.code = 'ENOSPC'; throw err;
  };
  let error = null;
  try { writeZip(target, [{ name: 'a.md', data: 'x'.repeat(4096) }]); } catch (err) { error = err; } finally { fs.writeFileSync = real; }
  assert.equal(error?.code, 'ENOSPC', 'the failure must still reach the caller');
  assert.deepEqual(fs.readFileSync(target), previous, 'the bundle being replaced was damaged');
  assert.deepEqual(fs.readdirSync(dir), ['audit.zip'], 'a scratch file was left behind');
});

test('a package write cut short leaves the file it was replacing untouched', () => {
  const dir = tempDir('rk-atomic-');
  const target = path.join(dir, 'package.zip');
  const previous = Buffer.from('PREVIOUS PACKAGE\n'.repeat(200));
  fs.writeFileSync(target, previous);
  const root = collectedProject();          // built BEFORE the write is sabotaged
  const real = fs.writeFileSync;
  fs.writeFileSync = (file, data, ...rest) => {
    real(file, Buffer.isBuffer(data) ? data.subarray(0, 32) : String(data).slice(0, 32), ...rest);
    const err = new Error('ENOSPC: no space left on device, write'); err.code = 'ENOSPC'; throw err;
  };
  let error = null;
  try { writeArtifact(target, { root, ...IDENTITY }); } catch (err) { error = err; } finally { fs.writeFileSync = real; }
  assert.equal(error?.code, 'ENOSPC', 'the failure must still reach the caller');
  assert.deepEqual(fs.readFileSync(target), previous, 'the package being replaced was damaged');
  assert.ok(!fs.readdirSync(dir).some((name) => name.includes('.tmp-')), `a scratch file was left behind: ${fs.readdirSync(dir)}`);
});

// Found 2026-09-28 (break-test): `node bin/selftest.mjs | head -1` killed the run. The
// suite prints ~99 KB (measured), the pipe buffer is 64 KB, and Node turns the write that
// no longer fits into an unhandled 'error' event: a raw stack, exit 1, and the result file
// never written - a green run reporting itself as broken, which is the confusion this kit
// refuses everywhere else. "Every other entrypoint was measured under the buffer" was true of
// the SIZE and missed the point: a reader that leaves early is enough at any size, so
// mcp-server.mjs (2026-09-30) and install.mjs (2026-09-30, PR #172) install the guard too.
test('tolerateClosedStdout drops writes after EPIPE and lets other errors through', async () => {
  const { EventEmitter } = await import('node:events');
  const stream = new EventEmitter();
  const written = [];
  stream.write = (chunk) => { written.push(String(chunk)); return true; };
  tolerateClosedStdout(stream);
  stream.write('first');
  stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  stream.write('second');
  assert.deepEqual(written, ['first'], 'a write after EPIPE must be dropped, not thrown');
  assert.throws(
    () => stream.emit('error', Object.assign(new Error('bad descriptor'), { code: 'EBADF' })),
    /bad descriptor/,
    'a real write failure must still reach the caller',
  );
});

// Found 2026-10-01 (break-test, PR #186): the write that replaced stdout's after EPIPE
// returned true and did nothing else - so a write given a callback never heard back. Every
// command ends through `exitAfterFlush`, which waits on exactly such a callback: the suite
// finished green, then sat on an unsettled top-level await, and Node exited 13 over it. A
// dropped write still answers its callback, a tick later, as a real one would.
test('a write dropped after EPIPE still calls its callback, so a flush can settle', async () => {
  const { EventEmitter } = await import('node:events');
  const stream = new EventEmitter();
  stream.write = () => true;
  tolerateClosedStdout(stream);
  stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  const answered = await Promise.race([
    new Promise((done) => { stream.write('', () => done('callback')); }),
    new Promise((done) => setTimeout(() => done('nothing'), 200)),
  ]);
  assert.equal(answered, 'callback', 'the callback of a dropped write never ran');
  // The two-argument form as well: write(chunk, encoding, callback).
  const encoded = await Promise.race([
    new Promise((done) => { stream.write('x', 'utf8', () => done('callback')); }),
    new Promise((done) => setTimeout(() => done('nothing'), 200)),
  ]);
  assert.equal(encoded, 'callback');
});

// Found 2026-09-29 (break-test): the same handler threw on a stdout the ENVIRONMENT
// refused - `selftest.mjs > /dev/full`, a full disk, a quota - so an uncaught exception
// arrived in the middle of the report and the run exited 1. Exit 1 is "the suite is red",
// so a healthy run reported itself as broken and sent the reader hunting for a failure
// that did not exist. A code this kit can EXPLAIN is now named in words and exits 2; one
// it cannot (EBADF above) is still thrown, because swallowing the unrecognised is how a
// real defect goes quiet.
test('a stdout the environment refuses is named in words and exits 2, not a raw stack', async () => {
  const { EventEmitter } = await import('node:events');
  const stream = new EventEmitter();
  stream.write = () => true;
  let exited = null;
  tolerateClosedStdout(stream, { exit: (code) => { exited = code; } });

  // The handler names the refusal on the REAL stderr, even when the stream is a fake -
  // and this leak put `no space is left on the disk` on every green suite's stderr,
  // exactly the words a genuinely full disk would print, sending the reader hunting for
  // a disk problem that did not exist (found 2026-09-30, break-test). Capture it here,
  // and assert the words, which is the property under test.
  const realStderrWrite = process.stderr.write;
  const said = [];
  process.stderr.write = (chunk) => { said.push(String(chunk)); return true; };
  try {
    stream.emit('error', Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }));
    // Every later write fails the same way; the report must not be attempted once per line.
    stream.emit('error', Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }));
  } finally {
    process.stderr.write = realStderrWrite;
  }

  assert.equal(exited, 2, 'a refused output reported itself as a red run (exit 1) with a stack trace');
  const words = said.join('');
  assert.match(words, /ENOSPC/, 'the refusal is named in words, with the code that explains it');
  assert.match(words, /no space is left on the disk/, 'the reader gets the reason, not a stack trace');
  assert.equal(said.length, 1, 'the report was printed once per run, not once per failed write');
});

test('a command whose reader quits keeps its own exit code', async () => {
  // The kernel's EPIPE arrives as an 'error' event carrying code EPIPE on the REAL
  // process.stdout, so the child emits exactly that and then keeps writing. A parent
  // cannot close a child's pipe portably (`destroy()` on the readable side leaves the
  // fd open on Linux, measured), and the shape of the event is the whole mechanism.
  const href = pathToFileURL(resolve(KIT_ROOT, 'lib/core.mjs')).href;
  const script = [
    `import { tolerateClosedStdout } from ${JSON.stringify(href)};`,
    'tolerateClosedStdout();',
    "process.stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));",
    "process.stdout.write('x'.repeat(400000));",
    "process.stderr.write('still running\\n');",
    'process.exit(3);',                            // the verdict it means to report
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (b) => { stderr += b; });
  child.stdout.resume();
  const code = await new Promise((done) => child.on('close', done));
  assert.equal(/EPIPE/.test(stderr), false, `a raw EPIPE crash reached stderr: ${stderr.slice(0, 200)}`);
  assert.match(stderr, /still running/, 'the command stopped writing when its reader went away');
  assert.equal(code, 3, 'the command lost its own exit code when the reader went away');
});

test('the suite installs the guard before it writes its first line', () => {
  const source = readText(resolve(KIT_ROOT, 'bin/selftest.mjs'));
  const call = source.indexOf('tolerateClosedStdout()');
  const firstWrite = source.indexOf('process.stdout.write');
  assert.ok(call !== -1, 'selftest.mjs no longer tolerates a closed stdout (2026-09-28)');
  assert.ok(call < firstWrite, `the guard is installed after the first write (write at ${firstWrite}, guard at ${call})`);
});

// --- canonical JSON at depth: input shape must not be able to end the process --------
//
// Found 2026-09-28, break-test. `canonicalJson` was recursive, and the fetch ledger it
// hashes is a file that travels between machines through git and that a person may
// hand-edit. One line nested a few thousand levels deep - which `JSON.parse` accepts -
// overflowed the JavaScript stack, so `handoff.mjs` (the FIRST command a builder runs)
// printed a bare V8 stack trace and exited 1: the code that means "the corpus did not
// arrive". The depth at which it broke also moved with whatever else was on the stack,
// so it was not even a stable limit anyone could have documented around.

/** The implementation this replaced, kept as the oracle the rewrite is judged against. */
function recursiveCanonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(recursiveCanonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${recursiveCanonicalJson(value[k])}`).join(',')}}`;
}

test('canonical JSON is byte-identical to the recursive form it replaced, corners included', () => {
  const cases = [
    null, true, false, 0, -0, 1.5, 1e21, '', 'a"b\\c', 'ünïcødé', 'line\nbreak',
    [], {}, [1, 2, 3], { b: 1, a: 2 }, { a: [3, { d: 4, c: 5 }] }, [[[]]], [{ a: 1 }, { b: 2 }],
    { a: null }, { z: 1, Z: 2, 0: 3, '': 4 }, [NaN, Infinity, -Infinity],
    // The corners a rewrite silently tidies, and must not: an array renders a member JSON
    // cannot encode as an empty string (that is `join`), an object as "undefined" (that is
    // a template literal), and an object key whose value is undefined disappears.
    [1, undefined, 3], { a: undefined, b: 1 }, { s: Symbol('x') }, [() => {}],
    new Array(3), { 'key with "quotes" and \\ backslash': [1, { nested: [true, null, 'x'] }] },
  ];
  for (const value of cases) {
    assert.equal(canonicalJson(value), recursiveCanonicalJson(value),
      `rendering drifted for ${JSON.stringify(String(value)).slice(0, 60)}`);
  }
  // And over structures nobody would think to write out by hand.
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grow = (depth) => {
    if (depth <= 0 || rnd() < 0.25) return [null, true, 0, -1.25, 42, `str${Math.floor(rnd() * 1000)}`, ''][Math.floor(rnd() * 7)];
    if (rnd() < 0.4) return Array.from({ length: Math.floor(rnd() * 6) }, () => grow(depth - 1));
    const out = {};
    for (let i = 0; i < Math.floor(rnd() * 6); i += 1) out[`k${Math.floor(rnd() * 20)}`] = grow(depth - 1);
    return out;
  };
  for (let i = 0; i < 2000; i += 1) {
    const value = grow(5);
    assert.equal(canonicalJson(value), recursiveCanonicalJson(value), `rendering drifted for case ${i}`);
  }
});

test('canonical JSON renders at a depth that used to end the process', () => {
  // Deeper than the recursive form survived (it broke somewhere between 2,000 and 3,000,
  // depending on the stack it happened to have). This is the shape of the defect: the
  // ledger line is valid JSON, so nothing upstream can refuse it.
  const depth = 20_000;
  const deep = JSON.parse(`${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`);
  const rendered = canonicalJson(deep);
  // `{"a":` per level, the single `1`, then a `}` per level - stated rather than derived
  // from the function under test.
  assert.equal(rendered, `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`);
  assert.equal(rendered.length, depth * 6 + 1, 'every level renders');
  // A hash is the only thing callers do with this, and it must be stable across two calls.
  assert.equal(sha256(canonicalJson(deep)), sha256(rendered));
});

// Follow-up to Arena break test 11: the recursive canonicalJson FAILED FAST on a cyclic
// value (a stack overflow); the iterative one would walk it forever, growing its output
// until the process ran out of memory. Nothing read from a file can be cyclic, but a hang
// is worse than a throw, so a cycle is refused by name. Run in a child with a timeout: the
// failure this guards against does not end on its own.
test('canonical JSON refuses a cyclic value instead of walking it forever', async () => {
  const core = pathToFileURL(path.join(KIT_ROOT, 'lib', 'core.mjs')).href;
  const source = `import { canonicalJson } from ${JSON.stringify(core)};
const loop = { a: [1, { b: null }] }; loop.a[1].b = loop;
try { canonicalJson(loop); console.log('RENDERED'); } catch (err) { console.log('REFUSED ' + err.message); }
const shared = { x: 1 };
console.log(canonicalJson({ p: shared, q: [shared, shared] }));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  const status = await new Promise((done) => child.on('close', (code) => done(code)));
  clearTimeout(timer);
  assert.equal(status, 0, `the child did not finish (killed after 10s, or crashed):\n${out.slice(0, 300)}`);
  assert.match(out, /REFUSED .*cycl/, `a cyclic value was not refused by name:\n${out.slice(0, 300)}`);
  assert.match(out, /\{"p":\{"x":1\},"q":\[\{"x":1\},\{"x":1\}\]\}/, 'a value seen twice but not cyclic must still render');
});

// --- the runner's own diagnostic must not be able to fail ---------------------------
//
// Found 2026-09-29 (break-test, reproduced with a 1 MiB TMPDIR). `tempFreeSpace()` was
// written inside bin/selftest.mjs, which imports `node:fs` and `node:path` but NOT
// `node:os` - and it is called on exactly one branch, "a red suite whose failures open
// with ENOSPC", so it had never once run. On the run that needed it:
//
//   605 passed, 671 failed
//   Likely single cause: 659 of 671 failures (98%) open with ENOSPC.
//   ReferenceError: os is not defined
//       at tempFreeSpace (research-kit/bin/selftest.mjs:97:16)
//
// The `catch` meant to make it total then referenced `base`, which the throw had left
// uninitialised, so the guard threw too and the uncaught error ended the process: the one
// message that says "your temp volume is full" was replaced by a stack trace, and the run
// left through an exception instead of its own verdict. The function now lives in
// core.mjs beside `tempBase()` - the module that owns the temp folder and already imports
// `node:os` - and is reachable from a test, which it was not before.

test('the temp folder is measured in words, and measuring it cannot fail', () => {
  const words = tempFreeSpace();
  assert.match(words, /the temp folder .+ has [\d.]+ MiB free/,
    `the free space was not reported in words: ${words.slice(0, 200)}`);
  assert.match(words, /TMPDIR/, 'the reader is not told which setting to change');

  // A filesystem that refuses statfs must still produce the same actionable remedy,
  // not merely avoid throwing. The runner calls this on the ENOSPC diagnostic branch.
  const realStatfs = fs.statfsSync;
  fs.statfsSync = () => { throw Object.assign(new Error('statfs unavailable'), { code: 'ENOSYS' }); };
  try {
    const fallback = tempFreeSpace();
    assert.match(fallback, /check the free space on the volume/);
    assert.match(fallback, /TMPDIR/, 'the fallback does not tell the reader how to choose a usable temp folder');
  } finally { fs.statfsSync = realStatfs; }

  const measured = readText(resolve(KIT_ROOT, 'lib/core.mjs'));
  assert.ok(measured.includes('export function tempFreeSpace'),
    'tempFreeSpace moved out of core.mjs, so nothing can hold it to this');
});

/**
 * Node builtins that are NOT globals. `process` and `console` need no import and are
 * deliberately absent; everything here throws `ReferenceError` the first time a line
 * that names it runs.
 */
const BUILTINS_NEEDING_AN_IMPORT = Object.freeze([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events', 'fs',
  'http', 'http2', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'punycode',
  'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

/**
 * Comments removed, and with `dropStrings` the string and template literals too, keeping
 * `${...}` substitutions. Both halves are load-bearing:
 *
 *   - prose swallows imports. `import of \`release-validator.mjs\`` in a header comment
 *     is the first `import` a raw scan meets, and its match runs to the next `from '...'`
 *     - past `import fs from 'node:fs'`, which is then recorded as never imported.
 *   - strings are not code. `https://nodejs.org/api/fs.html` inside a quoted URL is not a
 *     use of `fs`, and a page of HTML inside a template literal is not either.
 */
function withoutCommentsAndStrings(src, dropStrings) {
  let out = '';
  const stack = [];                       // 'template' / 'expr', for nested `${ }`
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (!stack.length && c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (!stack.length && c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (dropStrings && (c === "'" || c === '"')) {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) { if (src[i] === '\\') i += 1; i += 1; }
      out += ' ';
      continue;
    }
    if (c === '`') {
      out += ' ';
      if (stack.length && stack[stack.length - 1] === 'template') stack.pop();
      else stack.push('template');
      continue;
    }
    if (c === '$' && src[i + 1] === '{' && stack.length) { out += ' '; i += 1; stack.push('expr'); continue; }
    if (c === '}' && stack.length && stack[stack.length - 1] === 'expr') { out += ' '; stack.pop(); continue; }
    if (c === '}' && stack.length && stack[stack.length - 1] === 'template') { out += ' '; stack.pop(); continue; }
    out += c;
  }
  return out;
}

/** Every name an `import`/`export ... from`/`require()` clause binds. */
function boundBy(src, into) {
  const clause = src.trim();
  if (!clause) return;
  let m;
  if ((m = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/))) return void into.add(m[1]);
  if ((m = clause.match(/^([A-Za-z_$][\w$]*)$/))) return void into.add(m[1]);   // default import
  const braced = clause.match(/\{([^}]*)\}/);
  if (braced) {
    for (const part of braced[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      into.add((as.length === 2 ? as[1] : as[0]).trim());
    }
  }
  const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
  if (rest && !rest.startsWith('*')) {
    const d = rest.match(/^([A-Za-z_$][\w$]*)/);
    if (d) into.add(d[1]);
  }
}

/** Every name the file binds, by import or by declaration. A local shadows a builtin. */
function namesInScope(src) {
  const names = new Set();
  for (const m of src.matchAll(/\bimport\s+([\s\S]*?)\s+from\s*['"][^'"]+['"]/g)) boundBy(m[1], names);
  for (const m of src.matchAll(/\bexport\s+\{([^}]*)\}\s+from\s*['"][^'"]+['"]/g)) boundBy(`{${m[1]}}`, names);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\{[\s\S]*?\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"][^'"]+['"]\s*\)/g)) boundBy(m[1], names);
  const add = (raw) => {
    for (const part of String(raw).split(',')) {
      const t = part.trim();
      if (!t) continue;
      names.add(t.split('=')[0].trim().split(':').pop().trim());
    }
  };
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) add(m[1]);
  for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) { if (m[1]) names.add(m[1]); add(m[2]); }
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(\s*\{?([A-Za-z_$][\w$]*)\s*\}?\s*\)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}

/** Every .mjs under `dir`, recursively, skipping nothing the kit does not ship. */
function mjsUnder(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') mjsUnder(full, out);
    } else if (entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

// The same defect class, wherever else it hides: a module that names `fs.`, `os.`,
// `path.` ... without importing it. The reference throws the first time the line RUNS,
// and the lines that run last are the diagnostics and the error paths - the two places
// where a crash costs the most, because it replaces the explanation of the failure with
// a stack trace. `node --check` parses a file without executing it and says nothing
// about an undeclared global, and this kit has no linter and no dependencies to add one,
// so the check is written here.
//
// It is deliberately a TEXT check over the whole kit: the alternative is waiting for the
// next `os is not defined`, which by construction arrives on the run that is already red.
test('no module names a Node builtin it never imported', () => {
  const files = [
    ...mjsUnder(KIT_ROOT),
    ...mjsUnder(path.resolve(KIT_ROOT, '..', '.github')),
  ];
  assert.ok(files.length > 100, `only ${files.length} modules found - the walk is not reaching the kit`);
  const undeclared = [];
  for (const file of files) {
    const raw = readText(file);
    const scope = namesInScope(withoutCommentsAndStrings(raw, false));
    const code = withoutCommentsAndStrings(raw, true);
    const used = new Set();
    for (const m of code.matchAll(/(?<![.\w$])([a-z_][a-z0-9_]*)\s*\./g)) used.add(m[1]);
    for (const name of used) {
      if (BUILTINS_NEEDING_AN_IMPORT.includes(name) && !scope.has(name)) {
        undeclared.push(`${path.relative(path.resolve(KIT_ROOT, '..'), file)} uses '${name}.' and never imports node:${name}`);
      }
    }
  }
  assert.deepEqual(undeclared, [],
    'these modules reference a builtin they never import, so the line throws ReferenceError '
    + 'the first time it runs:\\n  ' + undeclared.join('\\n  '));
});

// Found 2026-09-29 (break-test): `RESEARCH_KIT_HOME` naming a regular FILE - a leftover
// `research-kit` tarball, an env var left pointing at the wrong thing - took `doctor` down
// with a raw ENOTDIR stack trace out of `listTree`, because `exists()` is true for a file
// and `readdirSync` is not. `doctor` is the command an operator runs when something looks
// broken; it has to name a problem rather than become one. `install.mjs` already named the
// same shape in words ("a file is where a folder should be"), so the two disagreed about
// one machine state.
test('deployedDrift survives a kit home that is a file, and a dangling link in the tree', () => {
  const from = tempDir('rk-drift-src-');
  const dest = tempDir('rk-drift-dest-');
  fs.mkdirSync(path.join(from, 'bin'));
  fs.mkdirSync(path.join(dest, 'bin'));
  const body = 'export const x = 1;\n';
  writeText(path.join(from, 'bin', 'x.mjs'), body);
  writeText(path.join(dest, 'bin', 'x.mjs'), body);
  // An entry `readdirSync` lists but `statSync` cannot follow: a link whose target moved.
  requireSymlink(path.join(from, 'vanished.mjs'), path.join(from, 'dangling.mjs'), 'a dangling link in the deploy source');
  const asFile = path.join(tempDir('rk-kit-home-'), 'research-kit');
  fs.writeFileSync(asFile, 'a file where the deployed kit should be\n');

  const absent = deployedDrift({ from, kitHome: asFile });
  assert.equal(absent.kit.absent, true, 'a file at kitHome must read as "not deployed here", not as a crash');
  assert.deepEqual(absent.kit.missing, ['bin/x.mjs'], 'the tree it should have shipped is still listed');

  const mirrored = deployedDrift({ from, kitHome: dest });
  assert.equal(mirrored.drifted, 0,
    `a mirrored tree reported drift, so the guard changed the answer and not just the crash: ${JSON.stringify(mirrored.kit)}`);
});

// Found 2026-09-29 (break-test report, F2): a folder link pointing back at an ancestor. The
// walk did not overflow the stack - the ELOOP guard above ends it about 40 levels down - but
// every lap listed the same files again, so doctor reported 41 "extra" files for one.
test('deployedDrift walks a folder link that loops back to an ancestor once', () => {
  const from = tempDir('rk-drift-src-');
  const dest = tempDir('rk-drift-dest-');
  for (const root of [from, dest]) writeText(path.join(root, 'x.mjs'), 'export const x = 1;\n');
  fs.mkdirSync(path.join(dest, 'sub'));
  fs.symlinkSync(dest, path.join(dest, 'sub', 'loop'), 'junction'); // junction: no privilege needed on Windows
  const drift = deployedDrift({ from, kitHome: dest });
  assert.deepEqual(drift.kit.extra, [], `a loop was walked more than once: ${drift.kit.extra.length} extra files`);
});

// Found 2026-10-04 (break-test pass 4, F1): the conformance runners import
// `conformance_common.py`, CPython writes `bin/__pycache__/*.pyc`, `.gitignore` hides it from
// git - and the deploy walk copied it into the installed kit, where `deployedDrift` then
// counted it as a stale file on every machine that had run the suite before `doctor`.
test('a Python bytecode cache in the checkout is neither deployed nor counted as drift', () => {
  const from = tempDir('rk-drift-src-');
  const dest = tempDir('rk-drift-dest-');
  fs.mkdirSync(path.join(from, 'bin', '__pycache__'), { recursive: true });
  writeText(path.join(from, 'bin', 'x.mjs'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(from, 'bin', '__pycache__', 'conformance_common.cpython-311.pyc'), Buffer.from([0xa7, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0]));
  deploy({ from, kitHome: dest, env: { HOME: tempDir('rk-home-') } });
  assert.equal(fs.existsSync(path.join(dest, 'bin', '__pycache__')), false, 'the bytecode cache was deployed as part of the kit');
  assert.equal(fs.existsSync(path.join(dest, 'bin', 'x.mjs')), true, 'the kit itself was deployed');
  const drift = deployedDrift({ from, kitHome: dest });
  assert.equal(drift.drifted, 0, `the cache in the checkout counted as drift: ${JSON.stringify(drift.kit)}`);
});

// Found 2026-09-30 (outside break-test): scanForSecrets wrapped the whole walk in one
// try/catch, so the first folder it could not read ended the scan - every file after it in
// walk order went unscanned, and the report said nothing was found.
test('one unreadable folder does not end the secret scan: files after it are still scanned', () => {
  const dir = makeProject();
  const locked = resolve(dir, 'aaa-unreadable');
  fs.mkdirSync(locked);
  writeText(resolve(dir, 'zzz-notes.txt'), `FIRECRAWL_API_KEY=${fixtureKey('fc', '-0123456789abcdef0123')}\n`);
  const realReaddir = fs.readdirSync;
  fs.readdirSync = (p, ...rest) => {
    if (String(p) === locked) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    return realReaddir(p, ...rest);
  };
  let scan;
  try { scan = scanForSecrets(dir); } finally { fs.readdirSync = realReaddir; }
  assert.equal(scan.hits.length, 1, 'the key after the unreadable folder was not found');
  assert.equal(scan.hits[0].pattern, 'firecrawl-key');
});

// Every command that writes a file names a write the environment refuses in words, exit
// code included - not a Node stack trace with the exit code of "a check failed". Six
// commands had missed it by 2026-09-30 (break-tests); a new one must not. A command that
// imports a writer from lib/ must CALL writeFailure, or be listed here with the reason its
// own handler is equivalent.
const WRITERS = ['writeText', 'writeBytes', 'writeJson', 'appendLine', 'appendFetch', 'writeArtifact', 'writeAudit',
  'renderBrief', 'renderTimeline', 'repairLedgerTail', 'installCommitGate', 'installEditGate', 'uninstall', 'saveConfig',
  'deploy', 'scaffoldProject', 'registerPrior', 'runResearch', 'decompose', 'fetchCorpus'];
const OWN_HANDLER = {
  'artifact.mjs': 'create catches every packaging error, writeArtifact included, and exits BLOCKED (3) with its message',
  'collect-remote.mjs': 'every step, the download included, is caught and reported by die() with a named exit code',
};
test('every command that writes names a refused write through writeFailure, or says why it need not', () => {
  const bin = path.join(KIT_ROOT, 'bin');
  const missing = [];
  for (const name of fs.readdirSync(bin).filter((f) => f.endsWith('.mjs'))) {
    const text = fs.readFileSync(path.join(bin, name), 'utf8');
    const imported = [...text.matchAll(/^import \{([^}]*)\} from '\.\.\/lib\/[\w-]+\.mjs'/gm)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]));
    const writes = imported.filter((n) => WRITERS.includes(n));
    if (!writes.length || OWN_HANDLER[name]) continue;
    if (!/\bwriteFailure\(/.test(text)) missing.push(`${name} (imports ${writes.join(', ')})`);
  }
  assert.deepEqual(missing, [], `these commands write and never call writeFailure:\n  ${missing.join('\n  ')}`);
});

// One rule for reading a path a corpus RECORDS (a ledger raw, a Raw cell): inside the
// project, by path and by real path, present, and a regular file. provenance and warc each
// re-implemented it and each had missed a step until 2026-09-30 - one helper now answers
// all four, and names which one failed.
test('projectFile answers every step of the read rule, and names the one that failed', async () => {
  const { projectFile } = await import('../lib/core.mjs');
  const root = makeProject();
  const outside = path.join(tempDir('rk-pf-outside-'), 'o.md');
  writeText(outside, 'o\n');
  writeText(resolve(root, 'research/raw/ok.md'), 'ok\n');
  fs.mkdirSync(resolve(root, 'research/raw/dir.md'));
  assert.deepEqual(projectFile(root, 'research/raw/ok.md'), { abs: resolve(root, 'research/raw/ok.md'), problem: null });
  assert.equal(projectFile(root, path.relative(root, outside)).problem, 'outside');
  // A recorded path is joined onto the root (core.resolve), so an absolute one is never
  // read: on POSIX it names a missing file under the root, on Windows the drive letter
  // makes it land outside (seen on the windows-latest leg, 2026-09-30). Either way, no file.
  assert.ok(['missing', 'outside'].includes(projectFile(root, outside).problem), 'an absolute recorded path must never be readable');
  assert.equal(projectFile(root, 'research/raw/none.md').problem, 'missing');
  assert.equal(projectFile(root, 'research/raw/dir.md').problem, 'not-file');
  assert.equal(projectFile(root, '').problem, 'outside', 'the root itself is not a file inside it');
  try { fs.symlinkSync(outside, resolve(root, 'research/raw/link.md')); } catch { return; }   // the link case needs symlink rights
  assert.equal(projectFile(root, 'research/raw/link.md').problem, 'outside', 'a link that leads out');
});

// Break-test PR #182 (risk 3), a static finding: on Windows an antivirus scanner or the search
// indexer can hold a file for a moment, and the rename that makes every write atomic then fails
// with EPERM, EBUSY or EACCES - once, where a moment later it would succeed. The rename is
// retried there, briefly; anywhere else those codes are a real refusal and fail at once.
test('the atomic rename retries a file Windows holds for a moment, and nothing else', async () => {
  const { renameRetrying, RENAME_RETRIES } = await import('../lib/core.mjs');
  const held = (code, times) => {
    const calls = [];
    const rename = (from, to) => { calls.push([from, to]); if (calls.length <= times) throw Object.assign(new Error(`${code}: held`), { code }); };
    return { rename, calls };
  };
  const slept = [];
  const sleep = (ms) => slept.push(ms);

  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    const { rename, calls } = held(code, 2);
    renameRetrying('a', 'b', { rename, sleep, platform: 'win32' });
    assert.equal(calls.length, 3, `${code}: a file held twice was not renamed on the third try`);
  }
  assert.ok(slept.length && slept.every((ms) => ms > 0 && ms <= 1000), `the waits are short: ${slept}`);

  const stuck = held('EBUSY', Infinity);
  assert.throws(() => renameRetrying('a', 'b', { rename: stuck.rename, sleep, platform: 'win32' }), /EBUSY/);
  assert.equal(stuck.calls.length, RENAME_RETRIES + 1, 'a file held for good was retried without end');

  for (const [platform, code] of [['linux', 'EACCES'], ['darwin', 'EPERM'], ['win32', 'ENOENT'], ['win32', 'EISDIR']]) {
    const once = held(code, Infinity);
    assert.throws(() => renameRetrying('a', 'b', { rename: once.rename, sleep, platform }), new RegExp(code));
    assert.equal(once.calls.length, 1, `${platform} ${code} was retried: it is a refusal, not a moment's hold`);
  }

  const { writeBytes } = await import('../lib/core.mjs');
  const src = fs.readFileSync(path.join(KIT_ROOT, 'lib', 'core.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function writeBytes'), src.indexOf('export function writeBytes') + 3000);
  assert.match(body, /renameRetrying\(scratch, target\)/, 'writeBytes does not rename through the retry');
  assert.equal(typeof writeBytes, 'function');
});
