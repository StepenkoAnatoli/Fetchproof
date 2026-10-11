// Each rule, run on its own against a corpus fixture. A rule that can only be tested by
// building a whole project and fishing one finding out of an array is a rule nobody
// tests (ADR-0004).

import path from 'node:path';
import { test, describe, assert, makeProject, makePassingProject, corrupt, fs, tempDir } from './harness.mjs';
import { PATHS, resolve, writeText, readText, today, sha256File } from '../lib/core.mjs';
import { KIT_ROOT } from '../lib/scaffold.mjs';
import { writeRaw, collectOne } from '../lib/collect.mjs';
import { readCorpus, captureOf } from '../lib/corpus.mjs';
import { CHECKS, CHECK_NAMES, runCheck, runChecks, supersededRows } from '../lib/checks.mjs';
import { verifyLedger, rebuildLedger, appendFetch } from '../lib/provenance.mjs';
import { renderBrief } from '../lib/brief.mjs';
import { UNIVERSAL_DIMENSIONS, coverageOfUniversals } from '../lib/dimensions.mjs';

describe('checks');

function snapshot(dir) {
  const corpus = readCorpus(dir);
  corpus.chain = verifyLedger(dir, { corpus });
  return corpus;
}

const failures = (findings) => findings.filter((f) => f.severity === 'fail');
const warnings = (findings) => findings.filter((f) => f.severity === 'warn');

test('the registry holds thirteen checks in a pinned order', () => {
  assert.equal(CHECKS.length, 13);
  assert.deepEqual(CHECK_NAMES, [
    'discovery-contract', 'citations', 'provenance', 'transport-provenance',
    'gate-integrity', 'unknown-closure', 'subtopic-coverage', 'capture-completeness',
    'evidence-supersession', 'collection-attempts', 'hygiene', 'corpus-shape',
    'corroboration',
  ]);
});

test('an unknown check name is an error naming the known checks, never a silent pass', () => {
  assert.throws(() => runCheck('no-such-check', snapshot(makePassingProject())), /Known checks/);
  assert.throws(() => runChecks(snapshot(makePassingProject()), { only: ['nope'] }), /Known checks/);
});

test('every check passes on a corpus that deserves it', () => {
  const corpus = snapshot(makePassingProject());
  for (const name of CHECK_NAMES) {
    const findings = runCheck(name, corpus, { localHooksPath: null });
    assert.equal(failures(findings).length, 0, `${name}: ${findings.map((f) => f.detail).join('; ')}`);
  }
});

test('discovery-contract: a status that is not CLOSED or KNOWN-UNKNOWN fails', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('CLOSED', 'in progress'));
  const findings = runCheck('discovery-contract', snapshot(dir));
  assert.ok(failures(findings).some((f) => f.rule === 'status'));
});

test('discovery-contract: an empty build intent fails', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(/## Build intent[\s\S]*?## Unknowns/, '## Build intent\n\n## Unknowns'));
  assert.ok(failures(runCheck('discovery-contract', snapshot(dir))).some((f) => f.rule === 'build-intent'));
});

test('citations: a row whose capture is not on disk fails', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  fs.rmSync(resolve(dir, capture.file));
  assert.ok(failures(runCheck('citations', snapshot(dir))).some((f) => f.rule === 'raw-missing'));
});

test('unknown-closure: a CLOSED unknown citing nothing fails', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(/E-01:[^|]*/, 'it is obviously true '));
  assert.ok(failures(runCheck('unknown-closure', snapshot(dir))).some((f) => f.rule === 'no-evidence'));
});

test('unknown-closure: a citation that names no row fails', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('E-01', 'E-99'));
  assert.ok(failures(runCheck('unknown-closure', snapshot(dir))).some((f) => f.rule === 'dangling-citation'));
});

test('unknown-closure: stale evidence warns against the operator\'s maxAgeDays', () => {
  const dir = makePassingProject(undefined, { date: '2020-01-01' });
  const findings = runCheck('unknown-closure', snapshot(dir), { maxAgeDays: 180 });
  assert.ok(findings.some((f) => f.rule === 'stale-evidence'));
});

// Found 2026-10-03 (output-reliability audit, G8): freshness read the table's Retrieved cell,
// which is hand-editable and was never reconciled with the capture it cites. Editing E-19's
// date alone made its stale warning disappear while the capture on disk still said 2026-09-20.
test('unknown-closure: freshness is judged by the capture\'s date, not the editable table date', () => {
  const dir = makePassingProject(undefined, { date: '2020-01-01' });
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-01 \| )\d{4}-\d{2}-\d{2}/m, `$1${today()}`));
  const findings = runCheck('unknown-closure', snapshot(dir), { maxAgeDays: 180 });
  const stale = findings.find((f) => f.rule === 'stale-evidence');
  assert.ok(stale, `the table date alone made stale evidence fresh: ${JSON.stringify(findings)}`);
  assert.match(stale.detail, /2020-01-01/, stale.detail);
});

test('unknown-closure: a row whose capture carries no date is judged by the table date', () => {
  const dir = makePassingProject(undefined, { date: '2020-01-01' });
  const corpus = snapshot(dir);
  for (const capture of corpus.captures.entries) capture.retrieved = '';
  assert.ok(runCheck('unknown-closure', corpus, { maxAgeDays: 180 }).some((f) => f.rule === 'stale-evidence'));
});

test('unknown-closure: a KNOWN-UNKNOWN with no verification step fails', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(/\| CLOSED \|[^|]*\|/, '| KNOWN-UNKNOWN |  |'));
  assert.ok(failures(runCheck('unknown-closure', snapshot(dir))).some((f) => f.rule === 'verification-step'));
});

test('subtopic-coverage: a GAP row fails by name', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.map, (text) => text.replace('| D-1 | Access model | Decides the collection design | COVERED | U-1 |', '| D-1 | Access model | Decides the collection design | GAP |  |'));
  const findings = failures(runCheck('subtopic-coverage', snapshot(dir)));
  assert.ok(findings.some((f) => f.rule === 'gap' && f.detail.includes('D-1')));
});

test('subtopic-coverage: a reasonless DISMISSED is a silent gap wearing a label', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.map, (text) => text.replace('| DISMISSED | public docs, personal research, no redistribution |', '| DISMISSED |  |'));
  assert.ok(failures(runCheck('subtopic-coverage', snapshot(dir))).some((f) => f.rule === 'dismissed-without-reason'));
});

test('subtopic-coverage: a COVERED row citing an unknown that does not exist fails', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.map, (text) => text.replace('| COVERED | U-1 |', '| COVERED | U-42 |'));
  assert.ok(failures(runCheck('subtopic-coverage', snapshot(dir))).some((f) => f.rule === 'covered-by-unknown-that-does-not-exist'));
});

test('subtopic-coverage: omitting a universal dimension fails; dismissing it does not', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.map, (text) => text.split('\n').filter((line) => !line.startsWith('| D-4 ')).join('\n'));
  const findings = failures(runCheck('subtopic-coverage', snapshot(dir)));
  assert.ok(findings.some((f) => f.rule === 'dimension-omitted' && f.detail.includes('ToS')));
});

test('subtopic-coverage: a contract with no map warns "no coverage claim" and does not fail', () => {
  const dir = makePassingProject();
  fs.rmSync(resolve(dir, PATHS.map));
  const findings = runCheck('subtopic-coverage', snapshot(dir));
  assert.equal(failures(findings).length, 0);
  assert.ok(findings.some((f) => f.rule === 'no-coverage-claim'));
});

test('coverageOfUniversals matches on id or on the dimension\'s own words', () => {
  const { missing } = coverageOfUniversals([{ id: 'D-1', text: 'anything' }, { id: 'X-9', text: 'Terms of service and licensing' }]);
  assert.equal(missing.length, UNIVERSAL_DIMENSIONS.length - 2);
});

test('transport-provenance: a non-Firecrawl transport is named, per row', () => {
  const dir = makePassingProject();
  rebuildLedger(dir, () => ({ transport: 'agent page fetch' }), { note: 'restate the transport' });
  const findings = runCheck('transport-provenance', snapshot(dir));
  assert.ok(findings.some((f) => f.rule === 'transport-not-metered' && f.transport === 'agent page fetch'));
});

test('capture-completeness: a CLOSED unknown resting only on partial captures is flagged', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => text.replace('completeness: full', 'completeness: partial\nomitted: chunk 0 of 3'));
  const findings = runCheck('capture-completeness', snapshot(dir));
  assert.ok(findings.some((f) => f.rule === 'partial-only'));
});

test('capture-completeness: partial without a reason is flagged too', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => text.replace('completeness: full', 'completeness: partial'));
  assert.ok(runCheck('capture-completeness', snapshot(dir)).some((f) => f.rule === 'partial-unnamed'));
});

test('capture-completeness: a page that SAYS it failed to render is flagged, though it arrived whole', () => {
  // The gap `completeness` cannot see. It grades the TRANSPORT - how much of the response
  // arrived - and a page whose body is built by script arrives complete and empty. Found
  // when a GitHub Discussion graded `full` while carrying page furniture and no discussion.
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => `${text}\n\nThere was an error while loading. Please reload this page.\n`);

  const findings = runCheck('capture-completeness', snapshot(dir));
  const hit = findings.find((f) => f.rule === 'partial-render');
  assert.ok(hit, 'a page reporting its own load failure must be reported');
  assert.equal(hit.severity, 'warn', 'three of four real matches were usable captures, so this cannot block');
  assert.match(hit.detail, /Confirm the text cited from it is present/);

  // The grade is untouched: the bytes really did all arrive. Saying otherwise would make
  // `completeness` lie about the transport in order to describe the content.
  assert.equal(readCorpus(dir).captures.entries[0].completeness, 'full');
});

test('capture-completeness: a render warning is for captures a closure cites, not context-only rows', () => {
  // Found 2026-09-29 on MoonAliza's secret-masking corpus: a phase-0 GitHub Discussion, kept
  // as a context-only row that no unknown cites, drew the render warning - whose instruction,
  // "confirm the text you cite is present", has no cited text to confirm (ADR-0099).
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => `${text}\n\nThere was an error while loading. Please reload this page.\n`);
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED | E-01: 10 requests per minute, 1,000 credits |', '| CLOSED | settled by the owner in person |'));
  const findings = runCheck('capture-completeness', snapshot(dir));
  assert.ok(!findings.some((f) => f.rule === 'partial-render'), JSON.stringify(findings));
});

test('capture-completeness: an ordinary capture is not accused of failing to render', () => {
  // The false-positive guard. This rule matches sentences a page PRINTS, so a corpus of
  // normal pages must stay silent - otherwise the warning becomes noise and gets ignored,
  // which is worse than not having it.
  const findings = runCheck('capture-completeness', snapshot(makePassingProject()));
  assert.ok(!findings.some((f) => f.rule === 'partial-render'));
});

test('hygiene: a capture nobody cites is a warning, never a failure', () => {
  const dir = makePassingProject();
  writeText(resolve(dir, `${PATHS.raw}/2026-01-01-orphan-example-00000000.md`), '---\nurl: https://example.invalid/orphan\nretrieved: 2026-01-01\n---\n\nbody\n');
  const findings = runCheck('hygiene', snapshot(dir));
  assert.equal(failures(findings).length, 0);
  assert.ok(findings.some((f) => f.rule === 'uncited-capture'));
});

// Break-test pass 4, F5a (2026-10-04): the warning said "was collected" of a file no fetch
// produced - a planted twin, a stray copy - which is the one thing the reader needs to know
// about it. The ledger says whether a fetch wrote it; the wording follows the ledger.
test('hygiene: an uncited capture no fetch produced is named as such, a collected one as collected', () => {
  const dir = makePassingProject();
  const planted = `${PATHS.raw}/2026-01-01-planted-example-00000000.md`;
  writeText(resolve(dir, planted), '---\nurl: https://example.invalid/planted\nretrieved: 2026-01-01\n---\n\nbody\n');
  const fetched = writeRaw(dir, { url: 'https://example.invalid/fetched', markdown: 'body of a page nobody cited\n', statusCode: 200 }, { date: '2026-01-01' });
  appendFetch(dir, { url: 'https://example.invalid/fetched', type: 'P', raw: fetched.file, bodySha256: sha256File(resolve(dir, fetched.file)), transport: 'stub', completeness: 'full', omitted: '', cmd: 'stub' });
  const findings = runCheck('hygiene', snapshot(dir)).filter((f) => f.rule === 'uncited-capture');
  const byFile = Object.fromEntries(findings.map((f) => [f.file, f.detail]));
  assert.match(byFile[planted] ?? '', /no ledger entry records a fetch of it/, JSON.stringify(byFile));
  assert.doesNotMatch(byFile[planted] ?? '', /was collected/);
  assert.match(byFile[fetched.file] ?? '', /was collected but no evidence row cites it/, JSON.stringify(byFile));
});

test('corpus-shape: a row whose arity does not match its header is reported, not absorbed', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => `${text}| E-02 | 2026-01-01 |\n`);
  const corpus = snapshot(dir);
  assert.ok(corpus.problems.some((p) => p.kind === 'table-arity'));
  assert.ok(runCheck('corpus-shape', corpus).some((f) => f.rule === 'table-arity'));
});

// Found 2026-10-03 (output-reliability audit, G2): `U_99` was dropped by readCorpus and
// runChecks reported nothing - a blocking question vanished on a typo.
test('hygiene: a row whose ID does not match its table fails, naming the table, the ID and the line - once', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => `${text}| U_99 | Is the service usable? | Blocks the design | OPEN | |\n`);
  const line = readText(resolve(dir, PATHS.discovery)).split(/\r?\n/).findIndex((l) => l.startsWith('| U_99')) + 1;
  const findings = runChecks(snapshot(dir));
  const named = findings.filter((f) => /U_99/.test(f.detail ?? ''));
  assert.equal(named.length, 1, `expected one finding naming U_99, got ${JSON.stringify(named)}`);
  const [f] = named;
  assert.equal(f.severity, 'fail');
  assert.equal(f.check, 'hygiene');
  assert.equal(f.rule, 'malformed-id');
  assert.equal(f.row, 'U_99');
  assert.equal(f.line, line);
  assert.match(f.detail, new RegExp(`${PATHS.discovery}:${line}`), 'the table and line are not named');
  assert.match(f.detail, /U-/, 'no remedy naming the expected form');
});

test('order is part of the interface: findings arrive in registry order', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('CLOSED', 'OPEN'));
  const names = runChecks(snapshot(dir)).map((f) => f.check);
  const seen = [...new Set(names)];
  const expected = CHECK_NAMES.filter((name) => seen.includes(name));
  assert.deepEqual(seen, expected);
});

// ---------------------------------------------------------------- supersession-aware checks
//
// ADR-0026 requires a re-collection to add a row and leave the old one standing. Two
// checks predated that ADR and warned about the very state it requires. Nobody noticed
// for four days, because nobody had performed a refresh - the first real one, on
// 2026-09-20, produced twelve warnings where the corpus had just been cleaned to nine.

/**
 * Take the passing fixture and REFRESH its one page: a second capture of the same URL,
 * collected later, with the unknown moved onto it. This is exactly the shape ADR-0026
 * prescribes, built through the real files so the real parser sees it.
 */
function withRefresh(dir, { transportOfOld = 'agent page fetch (no Firecrawl egress)', citeOld = false } = {}) {
  // The existing capture is DISCOVERED, not named.
  //
  // These two lines were literals - `2026-09-20-limits-example-a4e22bcd.md` and a
  // `2026-09-21-...` successor - and `makePassingProject` names its capture with
  // `today()`. So the fixture agreed with the test on exactly one calendar day. On
  // 2026-09-21 the copy failed with ENOENT and four tests went red, having passed all
  // through the day before.
  //
  // A test that only works on the date it was written is a test with an expiry nobody
  // wrote down. The refreshed name is derived from the real one so the pair cannot
  // disagree again, whatever the clock says.
  const rawDir = resolve(dir, PATHS.raw);
  const existing = fs.readdirSync(rawDir).filter((name) => name.endsWith('.md'));
  if (existing.length !== 1) {
    throw new Error(`withRefresh expects the fixture's single capture, found ${existing.length}: ${existing.join(', ')}`);
  }
  const oldRaw = `${PATHS.raw}/${existing[0]}`;

  // The refresh is a LATER day, derived from the capture's own date rather than written
  // down. `duplicate-url` exists to catch two rows for one URL on the SAME day, so a
  // refresh dated today - which is what the fixture produces - is correctly a duplicate.
  const oldDate = existing[0].slice(0, 10);
  const newDate = new Date(`${oldDate}T00:00:00Z`);
  newDate.setUTCDate(newDate.getUTCDate() + 1);
  const nextDay = newDate.toISOString().slice(0, 10);
  const newRaw = `${PATHS.raw}/${nextDay}-limits-example-refreshed.md`;
  const url = 'https://example.invalid/docs/limits';

  // The fresher capture, and a ledger entry for it.
  fs.copyFileSync(resolve(dir, oldRaw), resolve(dir, newRaw));
  const ledger = readText(resolve(dir, PATHS.ledger), '').trim().split('\n');
  const first = JSON.parse(ledger[0]);
  ledger[0] = JSON.stringify({ ...first, transport: transportOfOld });
  ledger.push(JSON.stringify({
    ...first, seq: 2, at: `${nextDay}T00:00:00.000Z`, raw: newRaw, transport: 'firecrawl-cli', prev: first.entrySha256,
  }));
  writeText(resolve(dir, PATHS.ledger), `${ledger.join('\n')}\n`);

  // The fresher row.
  const evidence = readText(resolve(dir, PATHS.evidence), '');
  writeText(resolve(dir, PATHS.evidence),
    `${evidence.trimEnd()}\n| E-02 | ${nextDay} | P | ${url} | A re-read of the same page. | ${newRaw} |\n`);

  // The unknown moves to it, unless a test wants the stale citation left in place.
  if (!citeOld) {
    writeText(resolve(dir, PATHS.discovery),
      readText(resolve(dir, PATHS.discovery), '').split('| CLOSED | E-01').join('| CLOSED | E-02'));
  }
  return dir;
}

test('a refresh does not trip duplicate-url - two rows for one URL is the DESIGN', () => {
  const corpus = snapshot(withRefresh(makePassingProject()));
  const dupes = runCheck('hygiene', corpus).filter((f) => f.rule === 'duplicate-url');
  assert.deepEqual(dupes.map((f) => f.detail), [], 'a refresh was reported as a hygiene problem');
});

test('two rows for one URL fetched the SAME DAY is still a duplicate', () => {
  // The real thing the check was written for; it has to survive the fix above.
  const dir = makePassingProject();
  // Same-day means the FIXTURE's day, read from the capture it wrote - not a literal.
  // This line carried `2026-09-20` twice and so agreed with the fixture on exactly one
  // calendar day, which is the defect the helper above was just fixed for.
  const existing = fs.readdirSync(resolve(dir, PATHS.raw)).find((name) => name.endsWith('.md'));
  const sameDay = existing.slice(0, 10);
  const evidence = readText(resolve(dir, PATHS.evidence), '');
  writeText(resolve(dir, PATHS.evidence),
    `${evidence.trimEnd()}\n| E-02 | ${sameDay} | P | https://example.invalid/docs/limits | Same day, second row. | ${PATHS.raw}/${existing} |\n`);

  const dupes = runCheck('hygiene', snapshot(dir)).filter((f) => f.rule === 'duplicate-url');
  assert.equal(dupes.length, 1, 'a same-day duplicate stopped being reported');
  assert.match(dupes[0].detail, /same day/);
});

test('transport-provenance goes quiet about a superseded row nothing relies on', () => {
  // Six such warnings stood in this project's own corpus after its refresh. Reporting
  // the provenance of a capture no claim rests on buries the rows that carry one.
  const corpus = snapshot(withRefresh(makePassingProject()));
  const warned = runCheck('transport-provenance', corpus).filter((f) => f.severity === 'warn');
  assert.deepEqual(warned.map((f) => f.detail), [],
    'a released historical row was still reported');
});

test('transport-provenance still speaks up when the superseded row IS still cited', () => {
  // The safety property. Going quiet must depend on nothing relying on the row - not on
  // the row merely being old. A claim resting on an unmetered capture is still that.
  const corpus = snapshot(withRefresh(makePassingProject(), { citeOld: true }));
  const warned = runCheck('transport-provenance', corpus).filter((f) => f.severity === 'warn');
  assert.equal(warned.length, 1, 'a cited unmetered capture stopped being reported');
  assert.match(warned[0].detail, /E-01/);
});

test('supersededRows maps each replaced row to the row that replaced it', () => {
  const map = supersededRows(snapshot(withRefresh(makePassingProject())));
  assert.equal(map.get('E-01').id, 'E-02');
  assert.equal(map.has('E-02'), false, 'the newest row was marked superseded');
});

test('an unrefreshed corpus has nothing superseded, and no check changes behaviour', () => {
  const corpus = snapshot(makePassingProject());
  assert.equal(supersededRows(corpus).size, 0);
  for (const name of CHECK_NAMES) {
    assert.equal(failures(runCheck(name, corpus, { localHooksPath: null })).length, 0, name);
  }
});

// G4 of the output-reliability audit (2026-10-03). `supersededRows` ordered same-day rows by
// their place in the TABLE and never read the ledger, so with captures A and B of one URL
// fetched A, then B, then A - the third fetch reuses A's file, as `collectOne` does for
// identical bytes - the collector held A current while this check said B had superseded it,
// and swapping the two evidence rows swapped the verdict. A same-day tie is now broken by
// the ledger's order, the rule `newer` (corpus.mjs) already applies for the collector.
function abaProject({ dateOfA = null, dateOfB = null } = {}) {
  const date = dateOfA ?? today();
  const dir = makePassingProject(tempDir('rk-checks-aba-'), { date });
  const url = 'https://example.invalid/docs/limits';
  const a = readCorpus(dir).captures.entries[0];
  const b = writeRaw(dir, {
    url, title: 'Limits', cmd: a.command, statusCode: 200, transport: 'firecrawl-cli', completeness: 'full',
    markdown: `# Limits\n\n${'The free plan now allows 20 requests per minute and includes 500 credits. '.repeat(30)}`,
  }, { date: dateOfB ?? date });
  assert.notEqual(b.file, a.file, 'the fixture wrote B over A, so it proves nothing');
  const fetched = (entry, at) => appendFetch(dir, {
    op: 'scrape', url, type: 'P', raw: entry.file, bodySha256: sha256File(resolve(dir, entry.file)),
    transport: 'firecrawl-cli', completeness: 'full', cmd: entry.command, at,
  });
  // The ledger already holds A (seq 1). Then B, then A's bytes again - its capture is reused
  // and recorded last - so the ledger reads A, B, A.
  fetched(b, `${b.retrieved}T01:00:00.000Z`);
  fetched(a, `${b.retrieved}T02:00:00.000Z`);
  const rows = (...lines) => {
    const header = readText(resolve(dir, PATHS.evidence)).split('\n').filter((l) => l.startsWith('|')).slice(0, 2);
    writeText(resolve(dir, PATHS.evidence), `# Evidence\n\n${header.join('\n')}\n${lines.join('\n')}\n`);
    return snapshot(dir);
  };
  const row = (id, entry) => `| ${id} | ${entry.retrieved} | P | ${url} | A reading of the page. | ${entry.file} |`;
  return { dir, url, a, b, rows, row };
}

test('supersededRows: on one day the ledger says which capture is current, whatever the table order', () => {
  const { url, a, b, rows, row } = abaProject();
  for (const order of [[row('E-01', a), row('E-02', b)], [row('E-02', b), row('E-01', a)]]) {
    const corpus = rows(...order);
    assert.equal(corpus.chain.ok, true, 'the fixture ledger does not verify, so the rank it gives is not real');
    assert.equal(corpus.captures.byUrl.get(url).file, a.file, 'the collector itself holds A current');
    const ids = order.map((line) => line.slice(2, 6)).join(', ');
    assert.equal(supersededRows(corpus).get('E-02')?.id, 'E-01', `E-02 (B) was not superseded by E-01 (A) with the rows ordered ${ids}`);
    assert.equal(supersededRows(corpus).has('E-01'), false, `the row the ledger holds current was marked superseded with the rows ordered ${ids}`);
  }
});

test('supersededRows: a later retrieval date still wins over the ledger\'s order', () => {
  // B is retrieved the day after A, then A's bytes come back and its capture is reused: the
  // ledger reads A, B, A, but B's date is later, and the date decides first - as in `newer`.
  const { a, b, rows, row } = abaProject({ dateOfB: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
  for (const order of [[row('E-01', a), row('E-02', b)], [row('E-02', b), row('E-01', a)]]) {
    const map = supersededRows(rows(...order));
    assert.equal(map.get('E-01')?.id, 'E-02', 'the later date lost to the ledger');
    assert.equal(map.has('E-02'), false);
  }
});

test('supersededRows: a capture no fetch recorded ranks below one the ledger holds, then by table order', () => {
  const { dir, a, rows, row } = abaProject();
  // Same-day captures nobody fetched: copies of A under names the ledger never saw.
  const unranked = (name) => {
    const file = `${PATHS.raw}/${a.retrieved}-${name}.md`;
    fs.copyFileSync(resolve(dir, a.file), resolve(dir, file));
    return { ...a, file };
  };
  const c = unranked('limits-copy-c');
  const d = unranked('limits-copy-d');
  for (const order of [[row('E-01', a), row('E-02', c)], [row('E-02', c), row('E-01', a)]]) {
    assert.equal(supersededRows(rows(...order)).get('E-02')?.id, 'E-01', 'a file no fetch produced outranked a fetched one');
  }
  // Among unranked rows the table's order decides, as it did before: the last row wins.
  assert.equal(supersededRows(rows(row('E-02', c), row('E-03', d))).get('E-02')?.id, 'E-03');
  assert.equal(supersededRows(rows(row('E-03', d), row('E-02', c))).get('E-03')?.id, 'E-02');
});

// Review of the G4 and G8 fixes (2026-10-03). Freshness and supersession read the capture's
// date through `captureOf`, which for a row with a BLANK Raw cell answers the URL's latest
// capture - a later fetch the row never read. So blanking E-01's Raw cell made a 2026-01-01
// reading fresh by borrowing a fetch from today, lost the stale warning, and drew a
// date-mismatch telling the operator to write today's date into the row. The capture a row
// is judged by is the one it names; a row naming none is judged by its cell.
test('unknown-closure and hygiene: a row with a blank Raw cell is judged by its own date, not by a later capture of its URL', () => {
  const { a, b, rows, row } = abaProject({ dateOfA: '2020-01-01', dateOfB: today() });
  const corpus = rows(row('E-01', { ...a, file: '' }));
  assert.equal(corpus.captures.byUrl.get(b.url).file, b.file, 'the URL\'s latest capture is today\'s, which the row never read');
  assert.equal(corpus.evidence[0].raw, '', 'the fixture row names no capture');
  const stale = runCheck('unknown-closure', corpus, { maxAgeDays: 180 }).find((f) => f.rule === 'stale-evidence');
  assert.ok(stale, 'a later fetch of the URL made a 2020 reading fresh');
  assert.match(stale.detail, /2020-01-01|days ago/, stale.detail);
  const mismatch = runCheck('hygiene', corpus).filter((f) => f.rule === 'date-mismatch');
  assert.deepEqual(mismatch, [], `a row naming no capture has nothing to reconcile against: ${JSON.stringify(mismatch)}`);
});

// Supersession ordered same-URL rows by the TABLE cell first, against G8's own rule that the
// capture's date is the one judged: E-01 fetched 09-20 with its cell edited to 09-30, E-02
// fetched 09-25 and cited by U-1 - one table edit failed the gate on the genuinely newest
// row and told the operator to cite the older one.
test('supersededRows: the capture\'s date decides which row is current, not the editable table cell', () => {
  const { a, b, rows, row } = abaProject({ dateOfA: '2026-09-20', dateOfB: '2026-09-25' });
  for (const order of [[row('E-01', { ...a, retrieved: '2026-09-30' }), row('E-02', b)], [row('E-02', b), row('E-01', { ...a, retrieved: '2026-09-30' })]]) {
    const corpus = rows(...order);
    const map = supersededRows(corpus);
    assert.equal(map.get('E-01')?.id, 'E-02', 'the edited cell outranked the later capture');
    assert.equal(map.has('E-02'), false, 'the newest capture was marked superseded');
    assert.ok(runCheck('hygiene', corpus).some((f) => f.rule === 'date-mismatch' && f.row === 'E-01'), 'the edit itself is still named');
  }
});

// The stale-evidence hint named a fresher row by comparing table cells, so an old row whose
// cell was edited to today hid the fresh capture that could replace it.
test('unknown-closure: the fresher row a stale citation is pointed at is found by capture date', () => {
  const { a, b, rows, row } = abaProject({ dateOfA: '2020-01-01', dateOfB: today() });
  const corpus = rows(row('E-01', { ...a, retrieved: today() }), row('E-02', b));
  const stale = runCheck('unknown-closure', corpus, { maxAgeDays: 180 }).find((f) => f.rule === 'stale-evidence');
  assert.ok(stale, 'E-01 is judged by its 2020 capture');
  assert.match(stale.detail, /E-02 is already a fresher capture/, stale.detail);
});

// A future date in the CAPTURE hid the row's age as well as one in the cell did, and only
// date-mismatch reported it; a collector whose clock was ahead is still not evidence.
test('hygiene: a capture retrieved in the future fails future-date, whatever the table cell says', () => {
  const corpus = snapshot(makePassingProject());
  const future = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const capture = captureOf(corpus, corpus.evidence[0]);
  capture.retrieved = future;
  assert.equal(captureOf(corpus, corpus.evidence[0]).retrieved, future, 'the in-memory capture is the one the row names');
  const f = runCheck('hygiene', corpus).find((x) => x.rule === 'future-date');
  assert.ok(f, 'a future date in the capture passed without a word');
  assert.equal(f.severity, 'fail');
  assert.equal(f.row, 'E-01');
  assert.ok(f.detail.includes(capture.file) && f.detail.includes(future), f.detail);
  assert.equal(runCheck('unknown-closure', corpus, { maxAgeDays: 180 }).some((x) => x.rule === 'stale-evidence'), false);
});

// Two readings the mutation audit (2026-10-03) found no test pinned: a capture dated by a full
// timestamp agrees with a day-only cell, and a cell that does not parse is one finding.
test('hygiene: a capture\'s full timestamp agrees with a day-only cell, and an unparseable cell is one finding', () => {
  const corpus = snapshot(makePassingProject());
  captureOf(corpus, corpus.evidence[0]).retrieved = `${today()}T17:38:25.128Z`;
  const findings = runCheck('hygiene', corpus);
  assert.equal(findings.some((f) => f.rule === 'date-mismatch'), false, JSON.stringify(findings.filter((f) => f.rule === 'date-mismatch')));

  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-01 \| )\d{4}-\d{2}-\d{2}/m, '$1not-a-date'));
  const hygiene = runCheck('hygiene', snapshot(dir));
  assert.equal(hygiene.filter((f) => f.rule === 'unparseable-date').length, 1, JSON.stringify(hygiene));
  assert.equal(hygiene.some((f) => f.rule === 'date-mismatch'), false, 'an unparseable cell is unparseable-date\'s to name, once');
});

// Gap audit 2026-10-03, rank 1: the row the parser could not keep is a FAIL, like a mistyped ID.
test('hygiene: a table-split problem fails by name, once, and corpus-shape does not repeat it', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(/(\| U-1 \|[^\n]*\n)/, '$1\n| U-2 | A second blocking question? | It decides the design | OPEN | |\n'));
  const corpus = snapshot(dir);
  const findings = runChecks(corpus, { localHooksPath: null }).filter((f) => /table-split/.test(f.rule) || /U-2/.test(f.detail));
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].check, 'hygiene');
  assert.equal(findings[0].rule, 'table-split');
  assert.equal(findings[0].severity, 'fail');
  assert.match(findings[0].detail, /DISCOVERY\.md:\d+/);
});

// ---------------------------------------------------------------- corroboration

/** Rewrite the fixture's evidence table and the unknown that cites it. */
function withEvidence(dir, rows, cites) {
  const header = readText(resolve(dir, PATHS.evidence)).split('\n').slice(0, 4).join('\n');
  writeText(resolve(dir, PATHS.evidence), `${header}
| ID | Retrieved | Type | URL | Finding | Raw |
|---|---|---|---|---|---|
${rows.join('\n')}
`);
  corrupt(dir, PATHS.discovery, (text) => text.replace(/\| CLOSED \|[^|]*\|/, `| CLOSED | ${cites} |`));
  return dir;
}

test('corroboration: one row is reported, because one reading proves one reading', () => {
  // The hole this check was added for. Before it, a corpus in which every unknown rested
  // on a single page passed preflight AND --strict with nothing to say - and from inside
  // such a corpus a single correct source and a single lucky one are the same thing.
  const findings = runCheck('corroboration', snapshot(makePassingProject()));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
  assert.equal(findings[0].rule, 'single-source');
  assert.match(findings[0].detail, /rests on E-01 alone/);
});

test('corroboration: two rows from ONE host is a second reading, not a second witness', () => {
  // The distinction that matters and that the count alone cannot make. Two pages from one
  // vendor catch a misreading; they cannot catch the vendor being wrong about itself.
  const dir = withEvidence(makePassingProject(), [
    '| E-01 | 2026-09-14 | P | https://example.invalid/docs/limits | ten a minute | research/raw/x.md |',
    '| E-02 | 2026-09-14 | P | https://example.invalid/docs/pricing | ten a minute | research/raw/x.md |',
  ], 'E-01 and E-02 agree');
  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings[0].rule, 'one-voice');
  assert.equal(findings[0].severity, 'warn');
  assert.match(findings[0].detail, /all are example\.invalid/);
});

test('corroboration: two hosts is independent support, and passes', () => {
  const dir = withEvidence(makePassingProject(), [
    '| E-01 | 2026-09-14 | P | https://example.invalid/docs/limits | ten a minute | research/raw/x.md |',
    '| E-02 | 2026-09-14 | P | https://other.invalid/reference | ten a minute | research/raw/x.md |',
  ], 'E-01 and E-02 agree');
  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings[0].severity, 'pass');
  assert.equal(findings[0].rule, 'independent');
  // Both rows name a raw file the fixture does not have, so neither has a sketch. An
  // unjudgeable pair must stay two documents: "I cannot fingerprint these" is not
  // "these are the same page", and the wrong choice here would invent a mirror.
  assert.match(findings[0].detail, /2 distinct documents across 2 hosts/);
});

// The mirror regression. `lira.epac.to` republishes Node's single-executable
// documentation six major versions behind `nodejs.org`, and the host heuristic graded
// that pair `independent` - its BEST grade - for one witness plus a staleness the
// freshness check cannot see, because freshness grades when a page was FETCHED.
//
// These use the real two captures rather than synthetic near-duplicates: the whole
// question is whether the threshold survives contact with a genuinely stale mirror,
// which two copies of lorem ipsum would not test.

const seaRawDir = path.join(KIT_ROOT, '..', 'docs', 'decisions', '2026-09-21-sea-assets', 'research', 'raw');

function realCapture(needle) {
  const name = fs.readdirSync(seaRawDir).find((f) => f.includes(needle) && f.endsWith('.md'));
  assert.ok(name, `no capture matching ${needle}`);
  const text = fs.readFileSync(path.join(seaRawDir, name), 'utf8');
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/** Put real page bodies into the fixture under chosen URLs, and cite them all. */
function withRealPages(pages) {
  const dir = makePassingProject();
  const rows = [];
  pages.forEach((page, i) => {
    const entry = writeRaw(dir, {
      url: page.url,
      title: `page ${i + 1}`,
      markdown: page.markdown,
      cmd: `firecrawl scrape ${page.url}`,
      statusCode: 200,
      transport: 'firecrawl-cli',
      completeness: 'full',
    }, { date: '2026-09-21' });
    rows.push(`| E-0${i + 1} | 2026-09-21 | P | ${page.url} | finding ${i + 1} | ${entry.file} |`);
  });
  return withEvidence(dir, rows, pages.map((_, i) => `E-0${i + 1}`).join(' and '));
}

test('corroboration: a row named twice in the prose is one source, not a mirror of itself', () => {
  // Found by running the document grouping over a real corpus. `citedIds` returns every
  // E-## mention in the Evidence cell, so prose that names E-01 twice yielded the SAME row
  // twice; grouping then folded the duplicate and reported a "republished copy" about a row
  // that was only ever mentioned twice. Host-counting hid it - duplicates inflated the row
  // count but collapsed in the host Set, so the old finding was right by accident.
  const dir = withEvidence(makePassingProject(), [
    '| E-01 | 2026-09-14 | P | https://example.invalid/docs/limits | ten a minute | research/raw/x.md |',
  ], 'E-01 says ten a minute, and E-01 also gives the credit total');

  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings[0].rule, 'single-source', 'one row mentioned twice is still one row');
  assert.match(findings[0].detail, /rests on E-01 alone/);
  assert.doesNotMatch(findings[0].detail, /republished/);
});

test('corroboration: a stale mirror on a second host is one document, not two witnesses', () => {
  const dir = withRealPages([
    { url: 'https://nodejs.org/api/single-executable-applications.html', markdown: realCapture('-nodejs-') },
    { url: 'https://lira.epac.to/DOCS/nodejs/api/single-executable-applications.html', markdown: realCapture('epac') },
  ]);
  const findings = runCheck('corroboration', snapshot(dir));

  // The precondition that made the old behaviour wrong: these ARE two different hosts,
  // so host-counting alone had every reason to call this independent. It still must not.
  assert.equal(findings[0].rule, 'mirror');
  assert.equal(findings[0].severity, 'warn');
  assert.match(findings[0].detail, /across 2 hosts but they are the same document/);
});

test('corroboration: a mirror does not outrank two genuinely different pages', () => {
  // The inversion stated as an ordering. A mirror must never grade better than the
  // honest `one-voice` that two real pages from one vendor earn.
  const mirrored = runCheck('corroboration', snapshot(withRealPages([
    { url: 'https://nodejs.org/api/single-executable-applications.html', markdown: realCapture('-nodejs-') },
    { url: 'https://lira.epac.to/DOCS/nodejs/api/single-executable-applications.html', markdown: realCapture('epac') },
  ])))[0];
  assert.notEqual(mirrored.severity, 'pass', 'a mirror must not pass while one-voice warns');
});

test('corroboration: a third, genuinely different page rescues a mirrored pair', () => {
  const dir = withRealPages([
    { url: 'https://nodejs.org/api/single-executable-applications.html', markdown: realCapture('-nodejs-') },
    { url: 'https://lira.epac.to/DOCS/nodejs/api/single-executable-applications.html', markdown: realCapture('epac') },
    { url: 'https://github.com/nodejs/single-executable/discussions/17', markdown: realCapture('bundling') },
  ]);
  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings[0].severity, 'pass');
  assert.equal(findings[0].rule, 'independent');
  // Two documents, not three rows - and the count of folded copies is stated rather
  // than silently absorbed, so a reader can see why three rows bought two witnesses.
  assert.match(findings[0].detail, /2 distinct documents across 2 hosts/);
  assert.match(findings[0].detail, /1 of 3 rows are republished copies/);
});

// collection-attempts had no tests until 2026-09-26. It counted an attempt only when the
// unknown's cell named a URL present in the ledger, so a KNOWN-UNKNOWN citing the E-row it
// reached for - the stronger proof, since an E-row is a CAPTURE of that URL - was warned as
// never attempted. Found by a real corpus (docs/decisions/2026-09-26-actions-sept-changes U-2).

test('collection-attempts: a KNOWN-UNKNOWN citing a captured E-row was reached for', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED |', '| KNOWN-UNKNOWN |'));
  const findings = runCheck('collection-attempts', snapshot(dir));
  assert.equal(warnings(findings).length, 0, findings.map((f) => f.detail).join('\n'));
});

test('collection-attempts: naming the URL itself still counts, as it always did', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED | E-01: 10 requests per minute, 1,000 credits |',
    '| KNOWN-UNKNOWN | tried https://example.invalid/docs/limits; verify on day one |'));
  assert.equal(warnings(runCheck('collection-attempts', snapshot(dir))).length, 0);
});

test('collection-attempts: a KNOWN-UNKNOWN that reached for nothing is still warned', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED | E-01: 10 requests per minute, 1,000 credits |',
    '| KNOWN-UNKNOWN | login-walled; verify on day one |'));
  const findings = warnings(runCheck('collection-attempts', snapshot(dir)));
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /no recorded fetch attempt/);
});

test('collection-attempts: citing an E-row that does not exist is not an attempt', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED | E-01: 10 requests per minute, 1,000 credits |',
    '| KNOWN-UNKNOWN | E-09 would say; verify on day one |'));
  assert.equal(warnings(runCheck('collection-attempts', snapshot(dir))).length, 1);
});

test('corroboration: a KNOWN-UNKNOWN is not asked for sources it was never going to have', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('| CLOSED |', '| KNOWN-UNKNOWN |'));
  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'pass');
  assert.match(findings[0].detail, /no closed unknown to weigh/);
});

test('corroboration: it never fails on its own, whatever it finds', () => {
  // Deliberately incapable of blocking a build by itself. Single-sourcing is often the
  // right answer - a vendor's own reference is the authority on that vendor - so this
  // check reports the SHAPE of the support and leaves the judgement to a reviewer, or to
  // an operator who has chosen `evidencePolicy=strict`.
  for (const dir of [makePassingProject(), withEvidence(makePassingProject(), [
    '| E-01 | 2026-09-14 | P | https://example.invalid/a | x | research/raw/x.md |',
    '| E-02 | 2026-09-14 | P | https://example.invalid/b | x | research/raw/x.md |',
  ], 'E-01 and E-02')]) {
    for (const f of runCheck('corroboration', snapshot(dir))) {
      assert.notEqual(f.severity, 'fail', 'corroboration must never fail a corpus on its own');
    }
  }
});

// ---------------------------------------------------------------- accepted judgements

test('corroboration: a reasoned single-witness note is accepted, and shows its reason', () => {
  // The mechanism `corroboration` was missing. It reports the shape of support and leaves
  // the judgement to a reviewer (ADR-0036) - and gave the reviewer nowhere to put it, so a
  // claim correctly left single-sourced looked like one nobody checked, forever, and
  // `strict` was unsatisfiable by any corpus containing an honest one.
  const dir = withEvidence(makePassingProject(), [
    '| E-01 | 2026-09-14 | P | https://example.invalid/docs/limits | ten a minute | research/raw/x.md |',
  ], 'E-01 [single-witness: the vendor stating its own tier limits, and no second party can testify to what it includes]');

  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings[0].severity, 'pass');
  assert.equal(findings[0].rule, 'single-witness');
  assert.match(findings[0].detail, /accepted on the record: the vendor stating its own tier/);
});

test('corroboration: a note without a real reason is NOT a mute button', () => {
  // Otherwise the weakest possible acknowledgement and no acknowledgement at all would be
  // indistinguishable, and the mechanism would be a way to turn the check off quietly.
  for (const note of ['[single-witness: n/a]', '[single-witness:]', '[single-witness: vendor]']) {
    const dir = withEvidence(makePassingProject(), [
      '| E-01 | 2026-09-14 | P | https://example.invalid/docs/limits | ten a minute | research/raw/x.md |',
    ], `E-01 ${note}`);
    const findings = runCheck('corroboration', snapshot(dir));
    assert.equal(findings[0].severity, 'warn', `${note} must not pass`);
    assert.equal(findings[0].rule, 'single-witness-unreasoned');
  }
});

test('corroboration: a note left on an unknown that HAS been corroborated is reported', () => {
  // The annotation must not rot. Once a second document arrives, a note claiming none can
  // exist is a false statement sitting in the contract, and this is the only moment
  // anything can notice.
  const dir = withEvidence(makePassingProject(), [
    '| E-01 | 2026-09-14 | P | https://example.invalid/a | x | research/raw/x.md |',
    '| E-02 | 2026-09-14 | P | https://other.invalid/b | x | research/raw/y.md |',
  ], 'E-01 and E-02 [single-witness: this reason is long enough to clear the floor but is now false]');

  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings[0].severity, 'warn');
  assert.equal(findings[0].rule, 'single-witness-stale');
  assert.match(findings[0].detail, /remove the note or the claim is false/);
});

test('corroboration: the stale-note warning says it counts sites, not authors', () => {
  // Found 2026-09-29: a paper on arxiv.org and its authors' repository on github.com are two
  // sites and one voice. The note saying so was right, and the warning called it false - a
  // claim the check cannot make, because it sees hosts, never who wrote the pages.
  const dir = withEvidence(makePassingProject(), [
    '| E-01 | 2026-09-14 | P | https://example.invalid/a | x | research/raw/x.md |',
    '| E-02 | 2026-09-14 | P | https://other.invalid/b | x | research/raw/y.md |',
  ], 'E-01 and E-02 [single-witness: the authors describing their own system, in the paper and in its repository]');

  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings[0].rule, 'single-witness-stale');
  assert.equal(findings[0].severity, 'warn');
  assert.match(findings[0].detail, /counts sites, not authors/);
  assert.match(findings[0].detail, /if these pages share an author, the note stands/);
});

test('capture-completeness: a recorded render review closes partial-render', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => `${text}\n\nThere was an error while loading. Please reload this page.\n`);
  corrupt(dir, PATHS.evidence, (text) => text.replace(
    'The free plan allows 10 requests per minute and includes 1,000 credits.',
    'The free plan allows 10 requests per minute. [render-reviewed: searched the capture and confirmed the quoted rate limit is present; the failed widget is page furniture]',
  ));

  const findings = runCheck('capture-completeness', snapshot(dir));
  const hit = findings.find((f) => f.rule.startsWith('partial-render'));
  assert.equal(hit.rule, 'partial-render-reviewed');
  assert.equal(hit.severity, 'pass');
});

test('capture-completeness: the render review is read from the ROW, never the capture', () => {
  // `verifyLedger` hashes the whole capture file, front-matter included, so annotating a
  // capture would break `body-unmodified`. A capture is evidence and stays byte-immutable;
  // the judgement about it is corpus prose. The first design put it in front-matter and the
  // ledger refused it - this pins the constraint so it cannot be undone by tidying.
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => text.replace(
    '---\n\n',
    'renderReview: searched the capture and confirmed the quoted rate limit is present\n---\n\n',
  ));
  corrupt(dir, capture.file, (text) => `${text}\n\nThere was an error while loading.\n`);

  const findings = runCheck('capture-completeness', snapshot(dir));
  assert.ok(findings.some((f) => f.rule === 'partial-render'),
    'a note in the capture front-matter must NOT satisfy the review - the ledger hashes it');
});

test('gate-integrity passes on what it MEASURED, not on a state of the world', () => {
  // It used to say "no override in effect". What it measured is that no override was
  // RECORDED - and the escape hatch this kit documents most prominently, `git commit
  // --no-verify`, records nothing. doctor.mjs has said so in its header since it was
  // written: the bypassed hook cannot report itself.
  //
  // Found by sweeping all thirteen pass messages for claims wider than their measurement.
  // It was the only one; the rest state what they counted. Pinned because the shorter
  // sentence is the tempting one, and it is the false one.
  const dir = makePassingProject();
  const hit = runCheck('gate-integrity', snapshot(dir)).find((f) => f.rule === 'gate');
  assert.equal(hit.severity, 'pass');
  assert.match(hit.detail, /recorded/, 'the pass must say what it actually established');
  assert.match(hit.detail, /--no-verify/, 'and name the bypass it cannot see');
  assert.ok(!/no override in effect/.test(hit.detail),
    'a pass that asserts no override is in effect claims more than any check here can know');
});

test('partial-render tells the reviewer where the note goes, and it is not front-matter', () => {
  // The test above pins that front-matter does not satisfy the review. This pins that the
  // MESSAGE does not send the reviewer there - which it did, for as long as the check
  // existed. Found by following it on a real corpus: adding the `renderReview:` front-matter
  // line it named turned a 1-warning PASS into a blocking `provenance/body-unmodified`
  // failure, and left this warning standing. An instruction that breaks the gate when
  // obeyed is worse than no instruction, so the wording is load-bearing and pinned here.
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => `${text}\n\nThere was an error while loading.\n`);

  const hit = runCheck('capture-completeness', snapshot(dir)).find((f) => f.rule === 'partial-render');
  assert.equal(hit.severity, 'warn');
  assert.match(hit.detail, /\[render-reviewed: /, 'must name the syntax the check actually parses');
  assert.match(hit.detail, /EVIDENCE row/, 'must name where the note goes');
  assert.match(hit.detail, /Do not edit the capture/, 'must say why it cannot go in the capture');
  assert.ok(!/front-matter line/.test(hit.detail),
    'must not direct the reviewer to edit front-matter - the ledger hashes the capture whole');
});

test('a row named INSIDE a single-witness note is not thereby cited', () => {
  // The footgun this removes. `citedIds` returns every E-## mention in the cell, and the
  // reason a reviewer writes lives in that same cell - so explaining why no second witness
  // exists, by pointing at a row that demonstrates it, turned that row into a citation.
  // The unknown read as corroborated while its own note denied it, and
  // `single-witness-stale` fired on a corpus that was correct. It caught its author three
  // times in two days before the mechanism was changed rather than the prose.
  const dir = withEvidence(makePassingProject(), [
    '| E-01 | 2026-09-14 | P | https://example.invalid/docs/limits | ten a minute | research/raw/x.md |',
    '| E-02 | 2026-09-14 | P | https://other.invalid/blog | a blog agreeing | research/raw/y.md |',
  ], 'E-01 [single-witness: the vendor is the authority on its own limits, and E-02 shows what a third party repeating it is worth]');

  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings[0].severity, 'pass');
  assert.equal(findings[0].rule, 'single-witness',
    'the note mentioned E-02; mentioning is not citing');
  assert.doesNotMatch(findings[0].detail, /stale/);
});

test('a row cited OUTSIDE the note still counts', () => {
  // The other half: stripping must not swallow real citations that happen to sit near one.
  const dir = withEvidence(makePassingProject(), [
    '| E-01 | 2026-09-14 | P | https://example.invalid/a | x | research/raw/x.md |',
    '| E-02 | 2026-09-14 | P | https://other.invalid/b | x | research/raw/y.md |',
  ], 'E-01 and E-02 both say so');

  const findings = runCheck('corroboration', snapshot(dir));
  assert.equal(findings[0].severity, 'pass');
  assert.equal(findings[0].rule, 'independent', 'two genuine citations are still two');
});

// Found 2026-09-27: an evidence row could name a different URL from the page its capture was
// fetched from, and preflight passed. The URL cell is what the brief and SOURCES show a reader
// as the source, so a slip there misattributes the claim with nothing to catch it.
test('an evidence row naming a URL other than its capture\'s fails citations', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => text.replace('https://example.invalid/docs/limits', 'https://example.invalid/docs/pricing'));
  const findings = runCheck('citations', readCorpus(dir));
  const hit = findings.find((f) => f.rule === 'url-mismatch');
  assert.ok(hit && hit.severity === 'fail', JSON.stringify(findings));
  assert.match(hit.detail, /E-01 names https:\/\/example\.invalid\/docs\/pricing.*fetched from https:\/\/example\.invalid\/docs\/limits/);

  const spelled = makePassingProject();
  corrupt(spelled, PATHS.evidence, (text) => text.replace('https://example.invalid/docs/limits', 'https://www.example.invalid/docs/limits/'));
  assert.equal(runCheck('citations', readCorpus(spelled)).some((f) => f.rule === 'url-mismatch'), false,
    'another spelling of the same page is the same page');
});

// Found 2026-09-27: a ledger whose last line was torn failed preflight with only the JSON error.
// `doctor --fix-arity` repairs exactly that case, and nothing said so.
test('a torn ledger tail names the repair; a broken line inside the chain does not', () => {
  const dir = makePassingProject();
  const ledger = resolve(dir, PATHS.ledger);
  const whole = readText(ledger);
  writeText(ledger, `${whole}{"seq":2,"at":"x","op":"scr`);
  const tail = runCheck('provenance', snapshot(dir)).find((f) => f.rule === 'ledger-unparsed');
  assert.ok(tail, 'no ledger-unparsed finding');
  assert.match(tail.detail, /doctor\.mjs"? --fix-arity/, tail.detail);

  writeText(ledger, `{"seq":0,"broken\n${whole}`);
  const inside = runCheck('provenance', snapshot(dir)).find((f) => f.rule === 'ledger-unparsed');
  assert.ok(inside, 'no ledger-unparsed finding for a broken first line');
  assert.doesNotMatch(inside.detail, /--fix-arity/, 'fix-arity only drops a torn tail');
  assert.match(inside.detail, /git/, inside.detail);
});

// Found 2026-09-27: an evidence row pasted twice failed with "U-1 rests on E-01, which has
// been superseded by E-01". The duplicate ID is the problem, and hygiene names it; a row is
// never superseded by itself.
test('a duplicated evidence row is not reported as superseded by itself', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-01 \|.*)$/m, '$1\n$1'));
  const corpus = snapshot(dir);
  assert.equal(supersededRows(corpus).has('E-01'), false, 'E-01 was superseded by E-01');
  const findings = runCheck('evidence-supersession', corpus);
  assert.equal(findings.some((f) => /superseded by E-01/.test(f.detail)), false, JSON.stringify(findings));
  const hygiene = runCheck('hygiene', corpus);
  assert.ok(hygiene.some((f) => f.rule === 'duplicate-id'), 'the duplicate ID is not named');
  assert.equal(hygiene.some((f) => /E-01 cites the same URL as E-01/.test(f.detail)), false, 'a row compared with itself');
});

// Found 2026-09-27: a Retrieved date of 2030-01-01 passed without a word. No page was fetched in
// the future, and a future date also hides the row's age from every freshness check.
test('a retrieval date in the future fails hygiene', () => {
  const dir = makePassingProject();
  // A year from TODAY, not a literal: a fixed "future" date becomes the past on its own
  // (2030-01-01 did, on a forward clock; found 2026-09-30, break-test).
  const future = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-01 \| )\d{4}-\d{2}-\d{2}/m, `$1${future}`));
  const f = runCheck('hygiene', snapshot(dir)).find((x) => x.rule === 'future-date');
  assert.ok(f, 'no finding for a date in the future');
  assert.equal(f.severity, 'fail');
  assert.ok(f.detail.includes(`E-01 has retrieval date ${future}, which is in the future`), f.detail);
});

// Found 2026-10-03 (output-reliability audit, G8): a table date that disagrees with the capture's
// own `retrieved` was not reported anywhere, so a date typed into the table stood unchallenged.
test('a table date that disagrees with its capture\'s retrieved date warns date-mismatch', () => {
  const dir = makePassingProject(undefined, { date: '2026-09-20' });
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-01 \| )\d{4}-\d{2}-\d{2}/m, `$1${today()}`));
  const corpus = snapshot(dir);
  const f = runCheck('hygiene', corpus).find((x) => x.rule === 'date-mismatch');
  assert.ok(f, 'no finding for a table date that disagrees with the capture');
  assert.equal(f.severity, 'warn');
  assert.equal(f.row, 'E-01');
  assert.ok(f.detail.includes(today()) && f.detail.includes('2026-09-20'), f.detail);
  assert.ok(f.detail.includes(corpus.evidence[0].raw), f.detail);
});

test('a passing project whose table and capture agree has no date-mismatch finding', () => {
  const findings = runCheck('hygiene', snapshot(makePassingProject()));
  assert.equal(findings.some((f) => f.rule === 'date-mismatch'), false, JSON.stringify(findings));
});

// Found 2026-09-27: renaming "## Build intent" (to "## Intent") failed as "## Build intent is
// empty", and the intent was right there under its new name. Missing and empty are told apart.
test('a missing Build intent heading is named as missing, not empty', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('## Build intent', '## Intent'));
  const f = runCheck('discovery-contract', snapshot(dir)).find((x) => x.rule === 'build-intent');
  assert.ok(f, 'no build-intent finding');
  assert.match(f.detail, /has no "## Build intent" heading/, f.detail);
  assert.doesNotMatch(f.detail, /is empty/, f.detail);
});

// Found 2026-09-27: a contract with two U-1 rows passed the gate. The ID is how everything
// else refers to an unknown - the map's COVERED cells, the brief, a reviewer - so two rows
// under one ID leave every such reference ambiguous, and the single-source warning for
// U-1 printed twice, word for word.
test('an ID used twice fails hygiene, and a finding is not printed twice', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(/^(\| U-1 \|.*)$/m, '$1\n$1'));
  const corpus = snapshot(dir);
  const dup = runCheck('hygiene', corpus).find((f) => f.rule === 'duplicate-id');
  assert.ok(dup, 'the duplicate ID is not named');
  assert.equal(dup.severity, 'fail', `a duplicate ID only ${dup.severity}s`);
  const details = runCheck('corroboration', corpus).map((f) => `${f.rule} ${f.detail}`);
  assert.equal(new Set(details).size, details.length, `printed twice: ${details.join(' / ')}`);
});

// Found 2026-09-27: the brief a builder reads first still said "Gate: FAIL" and lacked
// the unknown closed since it was drafted, and preflight and handoff both passed.
test('hygiene warns when the brief was drafted from a corpus that has since changed', () => {
  const dir = makePassingProject();
  const quiet = (corpus) => runCheck('hygiene', corpus).filter((f) => f.rule === 'brief-stale');
  assert.equal(quiet(snapshot(dir)).length, 0, 'the scaffold is not a stale brief');
  renderBrief(dir);
  assert.equal(quiet(snapshot(dir)).length, 0, 'a brief drafted from this corpus is current');
  corrupt(dir, PATHS.evidence, (text) => text.replace(/(\| E-01 \|(?:[^|]*\|){3})[^|]*/, '$1 a finding rewritten after the draft '));
  const stale = quiet(snapshot(dir));
  assert.equal(stale.length, 1, 'a changed finding left the brief current');
  assert.equal(stale[0].severity, 'warn');
  assert.match(stale[0].detail, /brief\.mjs/);
  // The stamp was anchored to the end of the file, so a line appended after it silenced
  // this warning (found 2026-10-03, review of the G1 fix).
  corrupt(dir, PATHS.brief, (text) => `${text}\nReviewed by: agent\n`);
  assert.equal(quiet(snapshot(dir)).length, 1, 'a line after the stamp silenced brief-stale');
});

// Review of the G1 fix (2026-10-03, ADR-0138): a drafted brief with no stamp - every brief
// drafted before ADR-0055 - keeps its approval because its currency cannot be checked, and
// that was silent. Hygiene says so; a scaffold's template brief and a hand-written legacy
// brief are not drafts and get no such warning.
test('hygiene warns brief-unstamped for a drafted brief with no stamp, and for nothing else', () => {
  const dir = makePassingProject();
  const unstamped = (corpus) => runCheck('hygiene', corpus).filter((f) => f.rule === 'brief-unstamped');
  assert.equal(unstamped(snapshot(dir)).length, 0, 'the scaffold is not an unstamped draft');
  renderBrief(dir);
  assert.equal(unstamped(snapshot(dir)).length, 0, 'a stamped draft');
  corrupt(dir, PATHS.brief, (text) => text.replace(/\n?<!-- research-kit:brief-draft [^>]*-->\s*$/, '\n'));
  const found = unstamped(snapshot(dir));
  assert.equal(found.length, 1, 'an unstamped draft passed in silence');
  assert.equal(found[0].severity, 'warn');
  assert.match(found[0].detail, /ADR-0055/);
  assert.match(found[0].detail, /--force/);
  assert.equal(runCheck('hygiene', snapshot(dir)).filter((f) => f.rule === 'brief-stale').length, 0, 'unstamped is not stale');
  writeText(resolve(dir, PATHS.brief), '# A brief somebody wrote by hand\n\n## Intent\n\nBuild it.\n');
  assert.equal(unstamped(snapshot(dir)).length, 0, 'a legacy brief was never drafted, so it was never stamped');
});

// Found 2026-09-27: a `research.mjs --force` the same day was reported both as a refresh
// (evidence-supersession: "superseded by E-02") and as a duplicate row ("the same URL on the
// same day - one row per fetched page"). Two fetches recorded in the ledger are a refresh;
// a pasted row has one fetch behind it, and that is still a duplicate.
test('a same-day refresh with two fetches in the ledger is not a duplicate-url', () => {
  const dir = makeProject();
  const url = 'https://x.invalid/limits';
  const scrape = (markdown) => (u) => ({ ok: true, url: u, title: 'Limits', markdown, statusCode: 200,
    transport: 'stub-transport', completeness: 'full', omitted: '', cmd: `stub scrape ${u}` });
  const body = `# Limits\n\n${'The free plan allows 10 requests per minute. '.repeat(20)}`;
  collectOne(dir, url, { runScrape: scrape(body), corpus: readCorpus(dir), transportName: 'stub-transport' });
  collectOne(dir, url, { runScrape: scrape(body), corpus: readCorpus(dir), force: true, transportName: 'stub-transport' });
  const dupes = runCheck('hygiene', snapshot(dir)).filter((f) => f.rule === 'duplicate-url');
  assert.deepEqual(dupes.map((f) => f.detail), [], 'a same-day refresh was called a duplicate');
});

// Found 2026-09-27 reviewing ADR-0055's fix: a brief drafted while only the map was
// incomplete kept "Gate: FAIL (9 blocking)" after the map rows were statused and the gate
// passed - the inputs hash covered the contract and the evidence, not the map.
test('hygiene calls the brief stale when only the map has changed', () => {
  const dir = makePassingProject();
  renderBrief(dir);
  corrupt(dir, PATHS.map, (text) => text.replace(/\| (COVERED|DISMISSED) \|/, '| GAP |'));
  const stale = runCheck('hygiene', snapshot(dir)).filter((f) => f.rule === 'brief-stale');
  assert.equal(stale.length, 1, 'a map change left the brief current');
});

// Found 2026-09-28 by the first measurement (docs/measurement-2026-09-28.md): the registry
// says unknown-closure checks that every CLOSED unknown rests on "a real, fresh, primary row",
// but it only warned about L rows - three corpora closed everything on S rows and passed with
// no warning. AGENTS.md Rule 4: P carries the design, S is context.
test('a closure resting only on secondary rows is flagged', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (t) => t.replace(/\| P \| (https:\/\/example\.invalid)/, '| S | $1'));
  const findings = runCheck('unknown-closure', readCorpus(dir));
  const flagged = findings.find((f) => f.rule === 'secondary-only');
  assert.equal(flagged?.severity, 'warn', JSON.stringify(findings));
  assert.match(flagged.detail, /U-1 rests only on secondary \(S\) rows/);
  assert.equal(runCheck('unknown-closure', readCorpus(makePassingProject())).find((f) => f.rule === 'secondary-only'), undefined);
});

// Found 2026-09-28: citing docs.firecrawl.dev (E-21) beside www.firecrawl.dev (E-13) turned
// the root corpus's U-8 "independent" on hostname alone - the exact trap its own
// [single-witness: ...] note warned about ("one company describing itself"). Independence is
// judged by site, the registrable domain, and hosting platforms keep each owner apart.
test('two subdomains of one company are one voice; two owners on one platform are not', async () => {
  const { siteOf } = await import('../lib/core.mjs');
  assert.equal(siteOf('https://docs.firecrawl.dev/billing'), siteOf('https://www.firecrawl.dev/'));
  assert.equal(siteOf('https://api.example.co.uk/x'), 'example.co.uk');
  assert.notEqual(siteOf('https://alice.github.io/a'), siteOf('https://bob.github.io/b'));
  assert.notEqual(siteOf('https://firecrawl.dev/'), siteOf('https://serpapi.com/'));
});

// Found 2026-10-01 (break-test, PR #188): `findings.push(...check.run(...))` passes every
// finding as an ARGUMENT, and an engine takes only so many - between 60,000 and 130,000
// depending on the Node line and its stack. One check over a corpus big enough to produce
// that many findings threw `RangeError: Maximum call stack size exceeded` out of runChecks,
// so preflight, doctor, brief and audit died with a raw V8 stack instead of a verdict, and
// the commit gate answered "internal error" (exit 2, closed). 66,000 rows with no URL, no
// claim and no capture give `citations` alone about three findings each - past the limit of
// every engine measured - and read in under two seconds.
test('a check that yields more findings than an engine takes as arguments still reaches a verdict', () => {
  const dir = makeProject(tempDir('rk-checks-wide-'), { content: true });
  const evidence = resolve(dir, PATHS.evidence);
  const header = readText(evidence).split('\n').filter((line) => line.startsWith('|')).slice(0, 2);
  const rows = [];
  for (let i = 0; i < 66_000; i += 1) rows.push(`| E-${i} | 2026-10-01 | P |  |  | raw/missing-${i}.md |`);
  writeText(evidence, `# Evidence\n\n${header.join('\n')}\n${rows.join('\n')}\n`);
  const corpus = readCorpus(dir);
  assert.equal(corpus.evidence.length, 66_000, 'the fixture did not parse as 66,000 rows, so it proves nothing');
  let findings;
  assert.doesNotThrow(() => { findings = runChecks(corpus, { only: ['citations'] }); }, 'the verdict died with a RangeError');
  assert.ok(findings.length >= 130_000, `only ${findings.length} findings: below the largest engine limit measured, so a spread might not have thrown`);
});

test('supersededRows: adopted URL aliases share date and ledger ordering without superseding the same ID', () => {
  const alias = 'http://www.example.invalid/docs/limits/#reading';
  const p = abaProject({ dateOfA: '2020-01-01', dateOfB: today() });
  const aliasRow = (entry) => p.row('E-02', entry).replace(p.url, alias);
  let corpus = p.rows(p.row('E-01', p.a), aliasRow(p.b));
  assert.equal(corpus.chain.ok, true, 'the actual capture ledger must verify before its ordering is tested');
  assert.equal(supersededRows(corpus).get('E-01')?.id, 'E-02', 'an adopted URL alias hid the later capture');
  assert.ok(runCheck('evidence-supersession', corpus).some((f) => f.rule === 'cites-superseded-row' && f.superseded === 'E-01' && f.by === 'E-02'));

  corpus = p.rows(p.row('E-01', { ...p.a, retrieved: today() }), aliasRow({ ...p.b, retrieved: '2020-01-01' }));
  assert.equal(corpus.chain.ok, true);
  assert.equal(supersededRows(corpus).get('E-01')?.id, 'E-02', 'editable table dates overruled the named captures');
  assert.ok(runCheck('hygiene', corpus).some((f) => f.rule === 'date-mismatch' && f.row === 'E-01'));

  const q = abaProject();
  const a = q.row('E-01', q.a);
  const b = q.row('E-02', q.b).replace(q.url, alias);
  for (const order of [[a, b], [b, a]]) {
    corpus = q.rows(...order);
    assert.equal(corpus.chain.ok, true);
    assert.equal(supersededRows(corpus).get('E-02')?.id, 'E-01', 'the A, B, A ledger lost to URL spelling or table order');
    assert.equal(supersededRows(corpus).has('E-01'), false);
  }
  corpus = q.rows(a, q.row('E-01', q.b).replace(q.url, alias));
  assert.equal(corpus.chain.ok, true);
  assert.equal(supersededRows(corpus).size, 0, 'two spellings under one ID must not supersede themselves');
  const hygiene = runCheck('hygiene', corpus);
  assert.ok(hygiene.some((f) => f.rule === 'duplicate-id' && f.row === 'E-01'));
  assert.equal(hygiene.some((f) => f.rule === 'duplicate-url'), false, 'duplicate-id owns the same-ID ambiguity');
});

test('unknown-closure: a fresher capture under an adopted URL alias is named while the cited row keeps its own date', () => {
  const { url, a, b, rows, row } = abaProject({ dateOfA: '2020-01-01', dateOfB: today() });
  const fresh = row('E-02', b).replace(url, 'http://www.example.invalid/docs/limits/#reading');
  for (const old of [{ ...a, retrieved: today() }, { ...a, file: '' }]) {
    const corpus = rows(row('E-01', old), fresh);
    assert.equal(corpus.chain.ok, true, 'the fresh alternative must have an actual verified fetch');
    const stale = runCheck('unknown-closure', corpus, { maxAgeDays: 180 }).find((f) => f.rule === 'stale-evidence');
    assert.ok(stale, 'the old cited reading borrowed the newer capture\'s date');
    assert.match(stale.detail, /E-02 is already a fresher capture/, stale.detail);
    assert.doesNotMatch(stale.detail, /re-collect with --refresh-days/, 'the fresher reading is already present');
    const mismatches = runCheck('hygiene', corpus).filter((f) => f.rule === 'date-mismatch' && f.row === 'E-01');
    assert.equal(mismatches.length, old.file ? 1 : 0, 'only a named capture can disagree with a table date');
  }
});

test('hygiene: an adopted URL alias pasted as another row differs from a recorded refresh and distinct query or path case', () => {
  const dir = makePassingProject(tempDir('rk-checks-url-hygiene-'));
  const original = readText(resolve(dir, PATHS.evidence));
  const initial = readCorpus(dir).captures.entries[0];
  const alias = 'http://www.example.invalid/docs/limits/#reading';
  const pasted = original.split('\n').find((line) => line.startsWith('| E-01 |')).replace(initial.url, alias);
  writeText(resolve(dir, PATHS.evidence), `${original}${pasted.replace('| E-01 |', '| E-02 |')}\n`);
  let corpus = snapshot(dir);
  assert.equal(corpus.chain.ok, true, 'pasting the row must leave the one real fetch intact');
  assert.equal(corpus.ledger.entries.length, 1);
  assert.ok(runCheck('hygiene', corpus).some((f) => f.rule === 'duplicate-url' && f.row === 'E-02'), 'a pasted alias row was mistaken for a separate page');

  writeText(resolve(dir, PATHS.evidence), `${original}${pasted}\n`);
  corpus = snapshot(dir);
  assert.equal(supersededRows(corpus).size, 0);
  const duplicateId = runCheck('hygiene', corpus);
  assert.ok(duplicateId.some((f) => f.rule === 'duplicate-id' && f.row === 'E-01'));
  assert.equal(duplicateId.some((f) => f.rule === 'duplicate-url'), false);

  writeText(resolve(dir, PATHS.evidence), original);
  const fetched = [];
  const scrape = (url) => {
    fetched.push(url);
    return { ok: true, url, title: 'Limits', statusCode: 200,
      markdown: `# Limits\n\n${'The free plan now allows 20 requests per minute and includes 500 credits. '.repeat(30)}`,
      transport: 'stub-transport', completeness: 'full', omitted: '', cmd: `stub scrape ${url}` };
  };
  const refreshed = collectOne(dir, alias, { force: true, type: 'P', date: today(), corpus: readCorpus(dir),
    runScrape: scrape, transportName: 'stub-transport' });
  assert.equal(refreshed.status, 'collected');
  corpus = snapshot(dir);
  assert.equal(corpus.chain.ok, true, 'the forced alias refresh must have a second verified fetch');
  assert.equal(corpus.ledger.entries.length, 2);
  assert.equal(supersededRows(corpus).get('E-01')?.id, 'E-02');
  assert.equal(runCheck('hygiene', corpus).some((f) => f.rule === 'duplicate-url'), false, 'two actual fetches are a same-day refresh');

  const distinct = [`${initial.url}?version=2`, 'https://example.invalid/docs/Limits'];
  for (const url of distinct) {
    const result = collectOne(dir, url, { type: 'P', date: today(), corpus: readCorpus(dir), runScrape: scrape,
      transportName: 'stub-transport' });
    assert.equal(result.status, 'collected', `${url} was merged under a new identity rule`);
  }
  corpus = snapshot(dir);
  assert.equal(corpus.chain.ok, true);
  assert.equal(corpus.ledger.entries.length, 4);
  assert.deepEqual(fetched, [alias, ...distinct]);
  assert.deepEqual([...supersededRows(corpus)].map(([id, current]) => [id, current.id]), [['E-01', 'E-02']]);
  assert.equal(runCheck('hygiene', corpus).some((f) => f.rule === 'duplicate-url'), false);
  assert.deepEqual(corpus.evidence.slice(1).map((row) => row.url), [alias, ...distinct], 'the captured URL spellings must remain visible');
});
