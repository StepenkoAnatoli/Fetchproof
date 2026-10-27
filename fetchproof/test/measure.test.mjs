// ADR-0089: a judge-free report of how a corpus's citations hold up.
// Research: docs/decisions/2026-09-28-kit-measurement.

import { test, describe, assert, makePassingProject, tempDir, corrupt, fs, path, KIT_ROOT } from './harness.mjs';
import { PATHS } from '../lib/core.mjs';
import { measureCorpus, renderMeasure } from '../lib/measure.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

describe('measure');

test('a passing corpus: every link works, and support is named as needing a judge', () => {
  const m = measureCorpus(makePassingProject());
  assert.equal(m.rows, 1);
  assert.deepEqual(m.linkWorks, { count: 1, percent: 100 });
  assert.equal(m.closed, 1);
  assert.equal(m.closedWithPrimary.percent, 100);
  assert.equal(m.closedOnTwoHosts.percent, 0, 'one row, one host');
  assert.equal(m.ledgerVerifies, true);
  assert.equal(m.factCheck.computed, false);
  assert.match(renderMeasure(m).join('\n'), /fact check\s+not computed - .*needs a judge/);
});

test('quotes are counted found or not, and an edited capture stops the link from working', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (t) => t.replace('includes 1,000 credits. |',
    'includes 1,000 credits. [quote: The free plan allows 10 requests per minute] [quote: The paid plan allows 99 requests] |'));
  let m = measureCorpus(dir);
  assert.deepEqual(m.anchoredRows, { count: 1, percent: 100 });
  assert.deepEqual(m.quotesFound, { count: 1, of: 2, percent: 50 });

  // Listed with fs, not `ls`: the shell-out returned ENOENT on Windows and `.stdout.split`
  // threw on undefined (outside audit, 2026-10-03) - a portability defect of the test alone.
  const capture = `research/raw/${fs.readdirSync(`${dir}/research/raw`).find((f) => f.endsWith('.md'))}`;
  corrupt(dir, capture, (t) => `${t}\nedited after fetch\n`);
  m = measureCorpus(dir);
  assert.equal(m.linkWorks.count, 0, 'an edited capture is not a working citation');
  assert.equal(m.ledgerVerifies, false);
});

// #319: a marker the parser could not read was counted as a row with no quote at all.
test('a quote marker the gate cannot read counts as a quote not found, not as an unanchored row', () => {
  const passage = 'The free plan allows 10 requests per minute';
  for (const marker of [`[quote: ${passage}`, `[Quote : ${passage}]`, `[quote ${passage}]`]) {
    const dir = makePassingProject();
    corrupt(dir, PATHS.evidence, (t) => t.replace('includes 1,000 credits. |', `includes 1,000 credits. ${marker} |`));
    const m = measureCorpus(dir);
    assert.deepEqual(m.anchoredRows, { count: 1, percent: 100 }, marker);
    assert.deepEqual([m.quotesFound.count, m.quotesFound.of], [0, 1], marker);
  }
});

test('the CLI prints the report, --json prints it for machines, and a non-project is refused', () => {
  const bin = fileURLToPath(new URL('../bin/measure.mjs', import.meta.url));
  const dir = makePassingProject();
  const text = spawnSync(process.execPath, [bin], { cwd: dir, encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /link works\s+100%/);
  const json = spawnSync(process.execPath, [bin, '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(JSON.parse(json.stdout).linkWorks.percent, 100);
  const outside = spawnSync(process.execPath, [bin], { cwd: tempDir(), encoding: 'utf8' });
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /not a research project/);
});

test('formatting-only anchors are counted but never reported as found', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (t) => t.replace('includes 1,000 credits. |',
    `includes 1,000 credits. [quote: ${'*'.repeat(40)}] [quote: The free plan allows 10 requests per minute] |`));
  const measured = measureCorpus(dir);
  assert.deepEqual(measured.anchoredRows, { count: 1, percent: 100 });
  assert.deepEqual(measured.quotesFound, { count: 1, of: 2, percent: 50 },
    'the raw anchor counts, but only the actual passage was found');
});

// ADR-0195: quote coverage - how many CLOSED unknowns cite at least one row whose quote is
// usable (not too short, ADR-0191's measure) and found in its capture, as the `citations`
// check judges both. A report line, never a gate.

const QUOTE = 'The free plan allows 10 requests per minute';

/**
 * The passing fixture with its two tables rewritten: `rows` maps an evidence ID to the Finding
 * text after the fixture's claim (a quote marker, or nothing), every row on the fixture's own
 * capture; `unknowns` is [id, status, evidence cell].
 */
function coverageProject({ rows, unknowns, raw = true }) {
  const dir = makePassingProject();
  const [, fixtureRow] = fs.readFileSync(`${dir}/${PATHS.evidence}`, 'utf8').match(/^(\| E-01 .*)$/m);
  const cells = fixtureRow.split('|').map((c) => c.trim());
  const [date, type, url, file] = [cells[2], cells[3], cells[4], cells[6]];
  corrupt(dir, PATHS.evidence, (t) => t.replace(fixtureRow, Object.entries(rows)
    .map(([id, quote]) => `| ${id} | ${date} | ${type} | ${url} | The free plan allows 10 requests per minute and includes 1,000 credits. ${quote} | ${raw ? file : ''} |`)
    .join('\n')));
  corrupt(dir, PATHS.discovery, (t) => t.replace(/^\| U-1 .*$/m, unknowns
    .map(([id, status, evidence]) => `| ${id} | What does the free tier allow? | Sets the budget | ${status} | ${evidence} |`)
    .join('\n')));
  return dir;
}

const coverage = (dir) => {
  const m = measureCorpus(dir);
  return [m.quoteCoverage?.count, m.quoteCoverage?.of];
};

test('quote coverage: 1 of 2 CLOSED unknowns cites a row with a usable quote found in its capture', () => {
  const dir = coverageProject({
    rows: { 'E-01': `[quote: ${QUOTE}]`, 'E-02': '' },
    unknowns: [['U-1', 'CLOSED', 'E-01'], ['U-2', 'CLOSED', 'E-02']],
  });
  const m = measureCorpus(dir);
  assert.deepEqual(m.quoteCoverage, { count: 1, of: 2, percent: 50 });
  assert.match(renderMeasure(m).join('\n'),
    /quote coverage\s+1 \/ 2 CLOSED unknowns cite at least one row with a usable quote/);
});

test('quote coverage: a too-short quote does not count, measured on the compared text (ADR-0191)', () => {
  // Both quotes occur in the capture. The second is 65 raw characters and compares as
  // "free plan": a floor taken on the raw text would count it.
  for (const quote of ['[quote: free plan]', '[quote: [Free plan](https://vendor.example.com/pricing#free-plan-details)]']) {
    const dir = coverageProject({ rows: { 'E-01': quote }, unknowns: [['U-1', 'CLOSED', 'E-01']] });
    assert.deepEqual(coverage(dir), [0, 1], quote);
    assert.deepEqual(measureCorpus(dir).quotesFound.count, 1, `${quote}: found, so only the floor keeps it out`);
  }
});

test('quote coverage: a quote not found in its capture, or a row with no capture, does not count', () => {
  let dir = coverageProject({
    rows: { 'E-01': '[quote: The paid plan allows 99 requests per minute]' },
    unknowns: [['U-1', 'CLOSED', 'E-01']],
  });
  assert.deepEqual(coverage(dir), [0, 1]);
  // A Raw cell naming a capture that is not on disk, and a citation of a row that does not
  // exist: neither throws, neither counts.
  dir = coverageProject({ rows: { 'E-01': `[quote: ${QUOTE}]` }, unknowns: [['U-1', 'CLOSED', 'E-01, E-09']] });
  corrupt(dir, PATHS.evidence, (t) => t.replace(/\| (research\/raw\/[^|]+?) \|$/m, '| research/raw/gone.md |'));
  assert.deepEqual(coverage(dir), [0, 1]);
});

test('quote coverage: an unknown citing two usable rows, or one row twice, counts once', () => {
  const dir = coverageProject({
    rows: { 'E-01': `[quote: ${QUOTE}]`, 'E-02': `[quote: ${QUOTE} and includes 1,000 credits]` },
    unknowns: [['U-1', 'CLOSED', 'E-01 and E-02; E-01 again']],
  });
  assert.deepEqual(coverage(dir), [1, 1]);
});

test('quote coverage: an unknown counts when one row it cites has a usable found quote, not only when all do', () => {
  // Found 2026-10-26 (Phase 4b mutation M2): asked of every row an unknown cites, an unknown
  // citing a quoted row and an unquoted one stopped counting, and every other test stayed green.
  const dir = coverageProject({
    rows: { 'E-01': `[quote: ${QUOTE}]`, 'E-02': '' },
    unknowns: [['U-1', 'CLOSED', 'E-01, E-02']],
  });
  assert.deepEqual(readCorpus(dir).unknowns[0].cites, ['E-01', 'E-02'], 'U-1 must cite both rows, or this proves nothing');
  assert.deepEqual(coverage(dir), [1, 1]);
});

test('quote coverage: a row with one usable found quote counts, whatever else it carries', () => {
  // The plan's wording, kept on purpose: "at least one row with a usable quote found". The
  // invented quote beside the real one fails the gate on this row (quote-not-found), and the
  // closure still counts: coverage asks whether a reader has one quote to check, not what the
  // gate makes of the row (U10 review F1, 2026-10-25). Counting only rows the gate passes would
  // be a rule change and needs its own record (ADR-0195, decision 4).
  const dir = coverageProject({
    rows: { 'E-01': `[quote: ${QUOTE}] [quote: The paid plan allows 99 requests per minute]` },
    unknowns: [['U-1', 'CLOSED', 'E-01']],
  });
  assert.deepEqual(measureCorpus(dir).quotesFound, { count: 1, of: 2, percent: 50 }, 'one real quote, one invented');
  assert.deepEqual(coverage(dir), [1, 1]);
});

test('quote coverage: an OPEN or KNOWN-UNKNOWN unknown is not in M, even citing a usable row', () => {
  const dir = coverageProject({
    rows: { 'E-01': `[quote: ${QUOTE}]` },
    unknowns: [['U-1', 'CLOSED', 'E-01'], ['U-2', 'KNOWN-UNKNOWN', 'E-01; verify on day one'], ['U-3', 'OPEN', 'E-01']],
  });
  assert.deepEqual(coverage(dir), [1, 1]);
});

test('quote coverage: a blank Raw cell resolves its capture by URL, as the citations check does', () => {
  const dir = coverageProject({ rows: { 'E-01': `[quote: ${QUOTE}]` }, unknowns: [['U-1', 'CLOSED', 'E-01']], raw: false });
  assert.deepEqual(coverage(dir), [1, 1]);
});

test('quote coverage: no quotes is 0 / M, no DISCOVERY.md is 0 / 0, and the CLI exits 0 with --json carrying both', () => {
  const bin = fileURLToPath(new URL('../bin/measure.mjs', import.meta.url));
  const unquoted = makePassingProject();
  assert.deepEqual(measureCorpus(unquoted).quoteCoverage, { count: 0, of: 1, percent: 0 });

  const contractless = makePassingProject();
  fs.rmSync(`${contractless}/${PATHS.discovery}`);
  const text = spawnSync(process.execPath, [bin], { cwd: contractless, encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /quote coverage\s+0 \/ 0 CLOSED unknowns/);
  const json = spawnSync(process.execPath, [bin, '--json'], { cwd: contractless, encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).quoteCoverage, { count: 0, of: 0, percent: null });
});

// The refresh baseline's movement script (docs/measurements/2026-10-refresh-baseline, plan v0.4
// §4.2), the measurement the ADRs cite for "none of the 41 baseline corpora moves". Found
// 2026-10-25 (Phase 4b breaker, F1): its main guard compared `path.resolve(argv[1])` with the
// module's own path, which Node resolves through realpath. Reached through a junction, a
// symlinked checkout or macOS's /tmp, the two differed, main() never ran, and the process printed
// nothing and exited 0 - the script's "no movement" answer, even for an unknown flag. `--help` and
// a bad flag answer before any measuring, so this costs no corpus run.
test('movement.mjs answers when it is reached through a link: --help prints its usage, an unknown flag exits 2', () => {
  const repo = path.resolve(KIT_ROOT, '..');
  const script = ['docs', 'measurements', '2026-10-refresh-baseline', 'movement.mjs'];
  assert.ok(fs.existsSync(path.join(repo, ...script)), 'movement.mjs is not in this tree, so this proves nothing');
  const link = path.join(tempDir('fp-movement-link-'), 'checkout');
  fs.symlinkSync(repo, link, 'junction');   // a junction on Windows (no rights needed), a directory symlink elsewhere
  try {
    const via = path.join(link, ...script);
    assert.notEqual(path.resolve(via), fs.realpathSync(via), 'the link resolves to itself, so this proves nothing');
    const help = spawnSync(process.execPath, [via, '--help'], { cwd: link, encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /^movement - the refresh baseline/, `nothing ran through the link: ${JSON.stringify(help)}`);
    const bad = spawnSync(process.execPath, [via, '--no-such-flag'], { cwd: link, encoding: 'utf8' });
    assert.equal(bad.status, 2, `an unknown flag through the link was not refused: ${JSON.stringify(bad)}`);
    assert.match(bad.stderr, /movement: unknown argument --no-such-flag/);
  } finally {
    fs.unlinkSync(link);   // the link only - never a recursive delete through it
  }
  assert.ok(fs.existsSync(path.join(repo, ...script)), 'removing the link touched the checkout');
});

// Found 2026-10-26 (Stage 6 break-test, finding 1): the realpath guard above threw ENOENT at
// import when argv[1] named no file, as with `node -e "await import(...)" an-argument`, so the
// module's exports could not be reached that way. An unresolvable argv[1] is not this script.
test('movement.mjs can be imported from a process whose argv[1] names no file', () => {
  const repo = path.resolve(KIT_ROOT, '..');
  const url = pathToFileURL(path.join(repo, 'docs', 'measurements', '2026-10-refresh-baseline', 'movement.mjs')).href;
  const code = `const m = await import(${JSON.stringify(url)}); process.stdout.write(Object.keys(m).sort().join(','));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, 'no-such-file-here'], { cwd: tempDir('fp-movement-import-'), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'measureAll,movement');
  assert.equal(r.stderr, '');
});

// The movement script's diff (R-06, plan v0.4 §4.3), on a two-corpus fixture: what the ADRs cite
// as "no movement" is this function's empty answer, and until 2026-10-26 (Stage 7 gap audit,
// R-06) only its committed outputs said it reports a moved anchor at all - in either direction.
test('movement.mjs prints an anchor that went not-found to found and one that went found to not-found, and nothing for one that stayed', async () => {
  const script = path.join(path.resolve(KIT_ROOT, '..'), 'docs', 'measurements', '2026-10-refresh-baseline', 'movement.mjs');
  assert.ok(fs.existsSync(script), 'movement.mjs is not in this tree, so this proves nothing');
  const { movement } = await import(pathToFileURL(script).href);
  const verdict = (corpus) => ({ corpus, rows: 1, quotedRows: 1, anchors: 1, unreadableMarkers: 0, comparablePass: true, findings: [] });
  const anchor = (corpus, quote, found) => ({ corpus, row: 'E-01', anchor: 0, quote, capture: `${corpus}/research/raw/page.md`,
    tooShort: false, found, status: found ? 'found' : 'not-found' });
  const base = {
    verdicts: [verdict('docs/decisions/a'), verdict('docs/decisions/b'), verdict('docs/decisions/c')],
    anchors: [anchor('docs/decisions/a', 'The free plan allows 10 requests per minute', false),
      anchor('docs/decisions/b', 'Paid plans start at 20 dollars a month', true),
      anchor('docs/decisions/c', 'The limit resets every hour on the hour', true)],
    superseded: [],
  };
  const now = {
    ...base,
    anchors: [anchor('docs/decisions/a', 'The free plan allows 10 requests per minute', true),
      anchor('docs/decisions/b', 'Paid plans start at 20 dollars a month', false),
      anchor('docs/decisions/c', 'The limit resets every hour on the hour', true)],
  };
  assert.deepEqual(movement(base, base), [], 'a baseline compared with itself must not move');
  assert.deepEqual(movement(base, now), [
    'anchor docs/decisions/a E-01 [0]: status not-found -> found; found false -> true  "The free plan allows 10 requests per minute"',
    'anchor docs/decisions/b E-01 [0]: status found -> not-found; found true -> false  "Paid plans start at 20 dollars a month"',
  ]);
});

// The other two halves of R-06's diff (r1 review, GA-3): the verdict comparison and the refresh
// pairs had no test, so `if (false)` in place of the verdict diff, or no field compared in a
// pair's anchors, left this group green. The verdicts' findings are left empty, so only the
// verdict line can print.
const movementOf = async () => (await import(pathToFileURL(path.join(path.resolve(KIT_ROOT, '..'),
  'docs', 'measurements', '2026-10-refresh-baseline', 'movement.mjs')).href)).movement;

test('movement.mjs prints a corpus whose verdict went PASS to FAIL and one that went FAIL to PASS, and nothing for one that stayed', async () => {
  const movement = await movementOf();
  const verdict = (corpus, comparablePass) => ({ corpus, rows: 1, quotedRows: 1, anchors: 1, unreadableMarkers: 0, comparablePass, findings: [] });
  const base = { verdicts: [verdict('docs/decisions/a', true), verdict('docs/decisions/b', false), verdict('docs/decisions/c', true)], anchors: [], superseded: [] };
  const now = { ...base, verdicts: [verdict('docs/decisions/a', false), verdict('docs/decisions/b', true), verdict('docs/decisions/c', true)] };
  assert.deepEqual(movement(base, base), [], 'a baseline compared with itself must not move');
  assert.deepEqual(movement(base, now), [
    'corpus docs/decisions/a: verdict PASS -> FAIL',
    'corpus docs/decisions/b: verdict FAIL -> PASS',
  ]);
});

test('movement.mjs prints a refresh whose old quote went not-found to found in the new capture and one that went found to not-found, and nothing for one that stayed', async () => {
  const movement = await movementOf();
  const pair = (corpus, quote, foundInNew) => ({ corpus, old: 'E-01', new: 'E-02', oldCapture: 'research/raw/old.md', newCapture: 'research/raw/new.md',
    citedBy: ['U-1'], anchors: [{ anchor: 0, quote, tooShort: false, foundInNew }] });
  const base = {
    verdicts: [], anchors: [],
    superseded: [pair('docs/decisions/a', 'The free plan allows 10 requests per minute', false),
      pair('docs/decisions/b', 'Paid plans start at 20 dollars a month', true),
      pair('docs/decisions/c', 'The limit resets every hour on the hour', true)],
  };
  const now = {
    ...base,
    superseded: [pair('docs/decisions/a', 'The free plan allows 10 requests per minute', true),
      pair('docs/decisions/b', 'Paid plans start at 20 dollars a month', false),
      pair('docs/decisions/c', 'The limit resets every hour on the hour', true)],
  };
  assert.deepEqual(movement(base, base), [], 'a baseline compared with itself must not move');
  assert.deepEqual(movement(base, now), [
    'refresh docs/decisions/a E-01 [0]: foundInNew false -> true  "The free plan allows 10 requests per minute"',
    'refresh docs/decisions/b E-01 [0]: foundInNew true -> false  "Paid plans start at 20 dollars a month"',
  ]);
});

// Every other comparison in movement() (r1 fix review, MX1-MX7): each case changes one field and
// expects exactly the line that field prints, so switching any one comparison off turns its case red.
test('movement.mjs prints each other field it compares: a corpus added, a count, a finding, a refresh\'s replacement, its citers, an anchor added, tooShort', async () => {
  const movement = await movementOf();
  const A = 'docs/decisions/a';
  const Q = 'The free plan allows 10 requests per minute';
  const verdict = (over = {}) => ({ corpus: A, rows: 1, quotedRows: 1, anchors: 1, unreadableMarkers: 0, comparablePass: true, findings: [], ...over });
  const pair = (over = {}) => ({ corpus: A, old: 'E-01', new: 'E-02', oldCapture: 'research/raw/old.md', newCapture: 'research/raw/new.md',
    citedBy: ['U-1'], anchors: [{ anchor: 0, quote: Q, tooShort: false, foundInNew: true }], ...over });
  const finding = { check: 'evidence-supersession', rule: 'cites-gone-page', severity: 'fail', row: 'U-1' };
  const corpus = (base, now) => [{ verdicts: base, anchors: [], superseded: [] }, { verdicts: now, anchors: [], superseded: [] }];
  const refresh = (base, now) => [{ verdicts: [], anchors: [], superseded: base }, { verdicts: [], anchors: [], superseded: now }];
  const cases = [
    ['MX6 a corpus added', corpus([], [verdict()]), [`corpus ${A}: added (not in the baseline)`]],
    ['MX2 the count fields', corpus([verdict()], [verdict({ rows: 2, unreadableMarkers: 3 })]),
      [`corpus ${A}: rows 1 -> 2`, `corpus ${A}: unreadableMarkers 0 -> 3`]],
    ['MX3 a finding added', corpus([verdict()], [verdict({ findings: [finding] })]),
      [`corpus ${A}: finding + fail evidence-supersession/cites-gone-page U-1`]],
    ['MX4 the replacing row', refresh([pair()], [pair({ new: 'E-03' })]), [`refresh ${A} E-01: superseded by E-02 -> E-03`]],
    ['MX5 the citers', refresh([pair()], [pair({ citedBy: [] })]), [`refresh ${A} E-01: cited by U-1 -> none`]],
    ['MX7 an anchor added to a refresh', refresh([pair({ anchors: [] })], [pair()]), [`refresh ${A} E-01 [0]: anchor added, foundInNew true "${Q}"`]],
    ['MX1 tooShort', refresh([pair()], [pair({ anchors: [{ anchor: 0, quote: Q, tooShort: true, foundInNew: true }] })]),
      [`refresh ${A} E-01 [0]: tooShort false -> true  "${Q}"`]],
  ];
  for (const [what, [base, now], lines] of cases) {
    assert.deepEqual(movement(base, base), [], `${what}: a baseline compared with itself must not move`);
    assert.deepEqual(movement(base, now), lines, `${what}: not printed as it moved`);
  }
});
