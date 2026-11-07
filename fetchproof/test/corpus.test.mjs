// The corpus has one owner (ADR-0003), and the format's joins live with it (ADR-0015).

import { spawnSync } from 'node:child_process';
import { test, describe, assert, makePassingProject, makeProject, corrupt, fs, requireSymlink } from './harness.mjs';
import { PATHS, HEADERS, resolve, writeText, readText, sha256File, isRegularFile } from '../lib/core.mjs';
import {
  readCorpus, readCaptures, readLedger, parseTable, parseCapture, splitRow, escapeCell, tableRow,
  repairRowArity, captureEntry, rememberCapture, cacheDecision, traceOf, captureOf,
  claimOf, sectionOf, appendRow, upsertRow, nextId, citedIds, stripReviewNotes, requestedUrl, assertTablesWritable,
} from '../lib/corpus.mjs';
import { runPreflight } from '../lib/preflight.mjs';
import { command as keylessCommand } from '../lib/http-transport.mjs';
import { command as firecrawlCommand } from '../lib/firecrawl.mjs';
import { command as browserCommand } from '../lib/browser-transport.mjs';
import { isWebUrl } from '../lib/research-run.mjs';

describe('corpus');

test('a leading ledger byte-order mark preserves entries without rewriting the file', () => {
  const dir = makePassingProject();
  const file = resolve(dir, PATHS.ledger);
  const before = readLedger(dir);
  const saved = `\uFEFF${fs.readFileSync(file, 'utf8')}`;
  fs.writeFileSync(file, saved);
  const after = readLedger(dir);
  assert.deepEqual(after.entries, before.entries);
  assert.deepEqual(after.problems, []);
  assert.equal(fs.readFileSync(file, 'utf8'), saved, 'reading must not edit the ledger');
});

test('splitRow honours escaped pipes; escapeCell round-trips through them', () => {
  assert.deepEqual(splitRow('| a | b\\|c | d |'), ['a', 'b|c', 'd']);
  assert.equal(escapeCell('b|c'), 'b\\|c');
  assert.deepEqual(splitRow(tableRow(['a', 'b|c', 'd'])), ['a', 'b|c', 'd']);
  assert.equal(escapeCell('two\nlines'), 'two lines', 'a cell is one line by construction');
});

test('repairRowArity pads a short row and folds a long one into its last cell', () => {
  assert.deepEqual(repairRowArity(['a'], 3), { cells: ['a', '', ''], repaired: true });
  assert.deepEqual(repairRowArity(['a', 'b', 'c', 'd'], 3), { cells: ['a', 'b', 'c | d'], repaired: true });
  assert.deepEqual(repairRowArity(['a', 'b', 'c'], 3), { cells: ['a', 'b', 'c'], repaired: false });
});

test('parseTable finds the table by its first header cell and reports arity problems', () => {
  const text = `# Heading\n\nprose\n\n${tableRow(HEADERS.evidence)}\n|---|---|---|---|---|---|\n| E-01 | 2026-01-01 | P | https://x.invalid | a claim | research/raw/a.md |\n| E-02 | short |\n`;
  const table = parseTable(text, HEADERS.evidence);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].URL, 'https://x.invalid');
  assert.equal(table.problems.length, 1);
  assert.equal(table.problems[0].kind, 'table-arity');
});

// Found 2026-09-27: a Finding quoting code with an unescaped | (`a || b`) split its row. The
// extra cells were folded into the LAST column, Raw, so the capture path became half a sentence
// and preflight reported "no cached page behind it" - the real cause was a warning further down.
test('a long evidence row folds its extra cells into Finding, and says why the row split', () => {
  const text = `${tableRow(HEADERS.evidence)}\n|---|---|---|---|---|---|\n| E-01 | 2026-01-01 | P | https://x.invalid | runs \`a || b\` first | research/raw/a.md |\n`;
  const table = parseTable(text, HEADERS.evidence);
  assert.equal(table.rows[0].Raw, 'research/raw/a.md', 'the capture path was corrupted');
  assert.match(table.rows[0].Finding, /runs `a \| {2}\| b` first|runs `a \|\s*\|\s*b` first/);
  assert.match(table.problems[0].detail, /a \| inside a cell.*\\\|/, table.problems[0].detail);
});

// The same day, in DISCOVERY: an unknown reading "Node 22 | 24" moved its prose into Status, and
// preflight reported 'U-1 has status "THE MATRIX MUST DROP..."'. Every table folds a long row into
// its prose column, so the structured columns to its right stay where they are.
test('a long row in any table keeps its structured columns in place', () => {
  const unknowns = parseTable(`${tableRow(HEADERS.unknowns)}\n|---|---|---|---|---|\n| U-1 | Node 22 | 24 end dates | the matrix drops them | CLOSED | E-01 |\n`, HEADERS.unknowns);
  assert.equal(unknowns.rows[0].Status, 'CLOSED');
  assert.equal(unknowns.rows[0].Evidence, 'E-01');
  const map = parseTable(`${tableRow(HEADERS.subtopics)}\n|---|---|---|---|---|\n| D-1 | Access | public | or not | COVERED | U-1 |\n`, HEADERS.subtopics);
  assert.equal(map.rows[0].Status, 'COVERED');
  assert.equal(map.rows[0]['Covered by'], 'U-1');
  const sources = parseTable(`${tableRow(HEADERS.sources)}\n|---|---|---|---|---|\n| https://x.invalid | P | A | B title | 2026-01-01 | U-1 |\n`, HEADERS.sources);
  assert.equal(sources.rows[0].Retrieved, '2026-01-01');
  assert.equal(sources.rows[0]['Used for'], 'U-1');
});

// Found 2026-09-27: a Raw cell written with Windows separators (research\\raw\\x.md) was
// normalised by splitting on path.sep - which is \\ only on Windows. The same corpus passed there
// and failed on a Linux builder with "no cached page behind it". A capture path never holds a
// literal backslash, so every platform reads one as a separator.
test('a Raw cell with backslashes reads the same on every platform', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => text.replace(/research\/raw\/([^ |]+)/, (m, name) => `research\\raw\\${name}`));
  assert.match(readText(resolve(dir, PATHS.evidence)), /research\\raw\\/, 'the fixture did not write a backslash path');
  const corpus = readCorpus(dir);
  assert.match(corpus.evidence[0].raw, /^research\/raw\/[^\\]+$/, corpus.evidence[0].raw);
  assert.equal(corpus.problems.some((p) => p.kind === 'raw-dangling'), false, 'the capture was reported missing');
});

test('parseTable stops at the end of the table, not the end of the file', () => {
  const text = `${tableRow(HEADERS.sources)}\n|---|---|---|---|---|\n| https://x.invalid | P | T | 2026-01-01 | U-1 |\n\n## Another section\n\n| not | a | row |\n`;
  assert.equal(parseTable(text, HEADERS.sources).rows.length, 1);
});

test('parseCapture splits front-matter from the body', () => {
  const { front, body } = parseCapture('---\nurl: https://x.invalid\nretrieved: 2026-01-01\ncompleteness: partial\nomitted: chunk 0 of 3\n---\n\n# Page\n');
  assert.equal(front.url, 'https://x.invalid');
  assert.equal(front.completeness, 'partial');
  assert.equal(front.omitted, 'chunk 0 of 3');
  assert.match(body, /# Page/);
});

test('the capture index is keyed by URL, newest retrieval winning', () => {
  const dir = makeProject();
  writeText(resolve(dir, `${PATHS.raw}/2026-01-01-a-x-1.md`), '---\nurl: https://x.invalid/p\nretrieved: 2026-01-01\n---\n\nold\n');
  writeText(resolve(dir, `${PATHS.raw}/2026-06-01-a-x-2.md`), '---\nurl: https://x.invalid/p\nretrieved: 2026-06-01\n---\n\nnew\n');
  const captures = readCaptures(dir);
  assert.equal(captures.entries.length, 2);
  assert.equal(captures.byUrl.get('https://x.invalid/p').retrieved, '2026-06-01');
});


test('readCaptures can skip the files a caller already holds, and can leave sketching to the gate', () => {
  const dir = makePassingProject();
  const all = readCaptures(dir);
  assert.ok(all.entries.length >= 1, 'the fixture holds a capture');
  assert.equal(all.sketches.size, all.entries.length, 'by default every capture is sketched');
  const known = new Set(all.entries.map((e) => e.file));
  const nothingNew = readCaptures(dir, { known });
  assert.deepEqual(nothingNew.entries, [], 'a file the caller holds is not read again');
  assert.equal(nothingNew.sketches.size, 0);
  const unsketched = readCaptures(dir, { sketches: false });
  assert.equal(unsketched.entries.length, all.entries.length, 'everything is still indexed');
  assert.equal(unsketched.sketches.size, 0, 'nothing was sketched');
  assert.ok(unsketched.byFile.has(all.entries[0].file));
});
test('the capture index also answers to the URL a redirected fetch was asked for', () => {
  const dir = makeProject();
  // Landed on the new path; the command line keeps the URL the plan named.
  writeText(resolve(dir, `${PATHS.raw}/2026-01-01-a-x-1.md`), '---\nurl: https://x.invalid/new\nretrieved: 2026-01-01\ncommand: http-keyless scrape https://x.invalid/old\n---\n\nmoved\n');
  // A capture of the asked-for URL itself outranks an alias, whatever their dates.
  writeText(resolve(dir, `${PATHS.raw}/2026-02-01-a-x-2.md`), '---\nurl: https://x.invalid/direct\nretrieved: 2026-02-01\ncommand: http-keyless scrape https://x.invalid/direct\n---\n\ndirect\n');
  writeText(resolve(dir, `${PATHS.raw}/2026-03-01-a-x-3.md`), '---\nurl: https://x.invalid/elsewhere\nretrieved: 2026-03-01\ncommand: browser https://x.invalid/direct\n---\n\nalias\n');
  const captures = readCaptures(dir);
  assert.equal(captures.byUrl.get('https://x.invalid/old')?.url, 'https://x.invalid/new', 'the asked-for URL finds the landed capture');
  assert.equal(captures.byUrl.get('https://x.invalid/direct')?.url, 'https://x.invalid/direct', 'a direct capture outranks an alias');
  assert.equal(captures.entries.length, 3, 'an alias adds no entry');
  const remembered = captureEntry({ file: 'research/raw/n.md', url: 'https://x.invalid/landed', retrieved: '2026-04-01',
    command: 'firecrawl scrape https://x.invalid/asked --only-main-content --json' });
  rememberCapture(captures, remembered);
  assert.equal(captures.byUrl.get('https://x.invalid/asked'), remembered, 'a mid-run capture is remembered under both');
});

// The same alias for a plan URL holding whitespace, whose command the transport JSON-quotes: read as
// no URL, it got no alias, so the plan's next run missed the cache and fetched the page again, every
// run (PR #440 review r5, BR5-1 fix review NIT-2). The command lines here are the keyless command().
test('a redirected plan URL holding whitespace is a cache hit under its own spelling, on disk and mid-run (BR5-1)', () => {
  const dir = makeProject();
  const now = new Date('2026-01-02T10:00:00Z');
  const asked = ['https://x.invalid/old a', ' https://x.invalid/lead'];
  asked.forEach((url, i) => writeText(resolve(dir, `${PATHS.raw}/2026-01-01-a-x-${i}.md`),
    `---\nurl: https://x.invalid/new-${i}\nretrieved: 2026-01-01\ncommand: ${keylessCommand(['scrape', url])}\n---\n\nmoved\n`));
  const captures = readCaptures(dir);
  const hits = (index, url) => [url, cacheDecision(index, url, { now }).hit, cacheDecision(index, url, { now }).entry?.url ?? null];
  assert.deepEqual([...asked, 'https://x.invalid/old%20a'].map((url) => hits(captures, url)), [
    ['https://x.invalid/old a', true, 'https://x.invalid/new-0'],
    [' https://x.invalid/lead', true, 'https://x.invalid/new-1'],
    ['https://x.invalid/old%20a', true, 'https://x.invalid/new-0'],
  ]);
  const midRun = { entries: [], byUrl: new Map(), byKey: new Map(), byFile: new Map() };
  rememberCapture(midRun, captureEntry({ file: 'research/raw/m.md', url: 'https://x.invalid/landed', retrieved: '2026-01-01',
    command: keylessCommand(['scrape', 'https://x.invalid/mid run']) }));
  assert.deepEqual(hits(midRun, 'https://x.invalid/mid run'), ['https://x.invalid/mid run', true, 'https://x.invalid/landed']);
});

test('requestedUrl reads the asked-for URL out of each transport\'s command line', () => {
  assert.equal(requestedUrl('http-keyless scrape https://x.invalid/a'), 'https://x.invalid/a');
  assert.equal(requestedUrl('firecrawl scrape https://x.invalid/b --only-main-content --json'), 'https://x.invalid/b');
  assert.equal(requestedUrl('firecrawl scrape https://x.invalid/c --only-main-content --json # transport: firecrawl-cli 1.2.3'), 'https://x.invalid/c');
  assert.equal(requestedUrl('browser https://x.invalid/d'), 'https://x.invalid/d');
  assert.equal(requestedUrl('agent page fetch'), '', 'a command naming no URL aliases nothing');
  assert.equal(requestedUrl(''), '');
  assert.equal(requestedUrl(undefined), '');
});

// A URL holding whitespace is JSON-quoted by every transport's `command()`, and the split on
// whitespace came before the unquote, so it was read as naming no URL and the gate read the fetch
// as asking for where it landed (PR #440 review r5, BR5-1). Each command here is the transport's own.
test('requestedUrl reads a URL holding whitespace back out of each transport\'s own command line (BR5-1)', () => {
  const spaced = 'https://x.invalid/a b';
  assert.equal(requestedUrl(keylessCommand(['scrape', spaced])), spaced, keylessCommand(['scrape', spaced]));
  const fc = firecrawlCommand(['scrape', spaced, '--only-main-content', '--max-age', '0', '--format', 'markdown,rawHtml', '--json']);
  assert.equal(requestedUrl(fc), spaced, fc);
  assert.equal(requestedUrl(`${fc} # transport: firecrawl-cli 1.2.3`), spaced, 'the transport suffix still reads the URL before it');
  assert.equal(requestedUrl(browserCommand([spaced])), spaced, browserCommand([spaced]));
  // JSON escapes inside the quoted argument are read back as the characters command() wrote.
  for (const url of ['https://x.invalid/a "b"', 'https://x.invalid/a\tb', 'https://x.invalid/a\\ b']) {
    const cmd = keylessCommand(['scrape', url]);
    assert.equal(requestedUrl(cmd), url, cmd);
  }
});

// The plan check (`planProblems`: `new URL` parses it as http or https) accepts a URL with leading
// whitespace or a leading C0 control, because the URL parser strips them, and the collector hands
// it to the transport verbatim. Read back by a scheme test on the raw string, such a URL was still
// no URL, and BR5-1's false green stayed open for it (PR #440 review r5, fix review S2-1). The
// oracle is `isWebUrl`, the vendor-URL check, which agrees with the plan check's scheme test on
// every spelling below: what it accepts, the command line reads back verbatim; what it refuses by
// scheme, it does not. (A URL with credentials is read back too; the plan check refuses it first.)
test('requestedUrl reads back, verbatim, every spelling the plan check accepts, and none whose scheme it refuses (BR5-1, fix review S2-1)', () => {
  const spellings = [' https://x.invalid/a', '\thttps://x.invalid/a', '\u0001https://x.invalid/a', '\n https://x.invalid/a',
    'https://x.invalid/a ', 'https://x.invalid/a b', 'https:x.invalid/a', 'HTTPS://x.invalid/a',
    '\u00a0https://x.invalid/a', 'ftp://x.invalid/a', 'x.invalid/a', 'ht\ttps://x.invalid/a', '\u0000\u001f https://x.invalid/a',
    'httpx://x.invalid/a'];
  const got = [];
  const want = [];
  for (const url of spellings) {
    const expected = isWebUrl(url) ? url : '';
    const cmds = [keylessCommand(['scrape', url]), firecrawlCommand(['scrape', url, '--only-main-content', '--json']), browserCommand([url])];
    for (const cmd of cmds) { got.push([cmd, requestedUrl(cmd)]); want.push([cmd, expected]); }
  }
  assert.deepEqual(got, want);
  assert.ok(isWebUrl(' https://x.invalid/a') && isWebUrl('\u0001https://x.invalid/a') && !isWebUrl('ftp://x.invalid/a'),
    'the plan check no longer reads these as it did, so the table above proves nothing');
});

// A quoted token command() could not have written - unterminated, or an escape JSON does not have -
// is not read as a URL, whole or in part: requestedUrl never throws, skips that token and reads on.
// '' (no URL) is the old reading of such a command; the ledger entry's hash covers its `cmd`, so
// such a command only reaches the gate in a ledger whose chain already fails.
test('requestedUrl skips a malformed quoted token and never throws (BR5-1)', () => {
  assert.equal(requestedUrl('http-keyless scrape "https://x.invalid/a b'), '', 'an unterminated quote is no URL, not its first word');
  assert.equal(requestedUrl('http-keyless scrape "https://x.invalid/a \\q b"'), '', 'a bad JSON escape is no URL');
  assert.equal(requestedUrl('http-keyless scrape "https://x.invalid/a \\q b" https://x.invalid/next'), 'https://x.invalid/next',
    'the token after a malformed one is still read');
});

test('dotfiles under research/raw are the kit\'s logs, not captures', () => {
  const dir = makePassingProject();
  assert.equal(readCaptures(dir).entries.some((e) => e.file.includes('.fetches')), false);
});

test('captureEntry is the ONE constructor: the reader and the collector agree field for field', () => {
  const dir = makePassingProject();
  const fromDisk = readCaptures(dir).entries[0];
  const rebuilt = captureEntry({ ...fromDisk });
  assert.deepEqual(Object.keys(rebuilt).sort(), Object.keys(fromDisk).sort());
  assert.deepEqual(rebuilt, fromDisk);
});

test('rememberCapture puts a mid-run capture into every index the reader builds', () => {
  const dir = makePassingProject();
  const captures = readCaptures(dir);
  const entry = captureEntry({ file: 'research/raw/new.md', url: 'https://x.invalid/new', retrieved: '2026-09-17' });
  rememberCapture(captures, entry);
  assert.equal(captures.byUrl.get('https://x.invalid/new'), entry);
  assert.equal(captures.byFile.get('research/raw/new.md'), entry);
});

test('cacheDecision: fresh hits, stale misses, force always misses, undated never hits', () => {
  const captures = { byUrl: new Map([['u', captureEntry({ file: 'f', url: 'u', retrieved: '2026-09-01' })]]) };
  const now = new Date('2026-09-17T00:00:00Z');
  assert.equal(cacheDecision(captures, 'u', { refreshDays: 30, now }).hit, true);
  assert.equal(cacheDecision(captures, 'u', { refreshDays: 5, now }).reason, 'stale');
  assert.equal(cacheDecision(captures, 'u', { refreshDays: 30, force: true, now }).reason, 'forced');
  assert.equal(cacheDecision(captures, 'missing', { now }).reason, 'not-collected');

  const undated = { byUrl: new Map([['u', captureEntry({ file: 'f', url: 'u', retrieved: '' })]]) };
  assert.equal(cacheDecision(undated, 'u', { now }).reason, 'undated');
});

test('traceOf joins a row to its fetch and its capture', () => {
  const dir = makePassingProject();
  const corpus = readCorpus(dir);
  const trace = traceOf(corpus, corpus.evidence[0]);
  assert.ok(trace.capture, 'the capture half');
  assert.ok(trace.fetch, 'the ledger half');
  assert.equal(trace.fetch.raw, trace.capture.file);
});

test('an empty Raw cell matches on the URL alone - the subtle clause, in one place', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => text.replace(/\| research\/raw\/[^|]*\|/, '|  |'));
  const corpus = readCorpus(dir);
  const row = corpus.evidence[0];
  assert.equal(row.raw, '');
  assert.ok(captureOf(corpus, row), 'the capture is still found, by URL');
  assert.ok(traceOf(corpus, row).fetch, 'and so is the fetch');
});

test('claimOf returns the first cited row\'s finding, falling back to the unknown\'s own text', () => {
  const dir = makePassingProject();
  const corpus = readCorpus(dir);
  assert.match(claimOf(corpus, corpus.unknowns[0]), /10 requests per minute/);
  assert.equal(claimOf(corpus, { cites: [], text: 'nothing cited' }), 'nothing cited');
});

test('a cited capture that is not on disk is a corpus problem', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  fs.rmSync(resolve(dir, capture.file));
  assert.ok(readCorpus(dir).problems.some((p) => p.kind === 'raw-dangling'));
});

// Found 2026-10-03 (output-reliability audit, G2): a row whose ID did not match its table's
// pattern - `U_99`, a typo for `U-99` - was dropped by readCorpus's filter and nothing said so.
// The table parser held 12 rows, the corpus 11 unknowns, problems was empty, and the gate had
// nothing to report: a blocking question had vanished on a typo.
function lineOf(dir, rel, prefix) {
  return readText(resolve(dir, rel)).split(/\r?\n/).findIndex((line) => line.startsWith(prefix)) + 1;
}

test('an unknown whose ID does not match U-<n> is a corpus problem naming the ID and its line, and the well-formed rows survive', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => `${text}| U_99 | Is the service usable? | Blocks the design | OPEN | |\n`);
  const corpus = readCorpus(dir);
  const problems = corpus.problems.filter((p) => p.kind === 'malformed-id');
  assert.equal(problems.length, 1, JSON.stringify(corpus.problems));
  assert.equal(problems[0].artifact, PATHS.discovery);
  assert.equal(problems[0].row, 'U_99');
  assert.equal(problems[0].line, lineOf(dir, PATHS.discovery, '| U_99'));
  assert.match(problems[0].detail, /U_99/);
  assert.deepEqual(corpus.unknowns.map((u) => u.id), ['U-1'], 'the well-formed row did not survive');
});

test('an evidence row whose ID does not match E-<n> is a corpus problem naming the ID and its line', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => `${text}| E_7 | 2026-01-01 | P | https://example.invalid/other | a claim | research/raw/other.md |\n`);
  const corpus = readCorpus(dir);
  const problems = corpus.problems.filter((p) => p.kind === 'malformed-id');
  assert.equal(problems.length, 1, JSON.stringify(corpus.problems));
  assert.equal(problems[0].artifact, PATHS.evidence);
  assert.equal(problems[0].row, 'E_7');
  assert.equal(problems[0].line, lineOf(dir, PATHS.evidence, '| E_7'));
  assert.deepEqual(corpus.evidence.map((e) => e.id), ['E-01']);
});

test('a subtopic whose ID does not match <LETTERS>-<n> is a corpus problem naming the ID and its line', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.map, (text) => `${text}| D10 | Something else | It matters | GAP | |\n`);
  const corpus = readCorpus(dir);
  const problems = corpus.problems.filter((p) => p.kind === 'malformed-id');
  assert.equal(problems.length, 1, JSON.stringify(corpus.problems));
  assert.equal(problems[0].artifact, PATHS.map);
  assert.equal(problems[0].row, 'D10');
  assert.equal(problems[0].line, lineOf(dir, PATHS.map, '| D10'));
  assert.equal(corpus.subtopics.length, 9);
});

test('an untouched scaffolded project, and a row that is empty in every cell, record no malformed-id problem', () => {
  const scaffolded = makeProject(undefined, { content: true });
  assert.deepEqual(readCorpus(scaffolded).problems.filter((p) => p.kind === 'malformed-id'), []);
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => `${text}| | | | | |\n`);
  assert.deepEqual(readCorpus(dir).problems.filter((p) => p.kind === 'malformed-id'), []);
});

// Review of the G2 fix (2026-10-03): the first version kept every empty ID silent, on the
// premise that the templates ship empty rows. They ship empty tables, and an evidence row
// with no ID but a URL, a finding and a capture is the typo's twin - a row that says its
// piece and that no check can find.
test('a row with an empty ID cell that holds content is a malformed-id problem, in each table', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => `${text}|  | 2026-01-01 | P | https://example.invalid/pricing | The paid plan costs 20 a month. | research/raw/x.md |\n`);
  corrupt(dir, PATHS.discovery, (text) => `${text}| | What does the paid plan cost? | Sets the price | CLOSED | E-01 |\n`);
  corrupt(dir, PATHS.map, (text) => `${text}|  | Pricing | It matters | GAP | |\n`);
  const corpus = readCorpus(dir);
  const problems = corpus.problems.filter((p) => p.kind === 'malformed-id');
  assert.deepEqual(problems.map((p) => p.artifact).sort(), [PATHS.discovery, PATHS.evidence, PATHS.map].sort(), JSON.stringify(problems));
  for (const p of problems) {
    assert.equal(p.row, '(empty)');
    assert.ok(p.line > 0, 'the parser\'s line is named');
    assert.match(p.detail, /empty ID cell holds content/, p.detail);
  }
  assert.equal(corpus.evidence.length, 1, 'the row is still not an evidence row');
  assert.equal(corpus.unknowns.length, 1);
});

// Gap audit 2026-10-03, rank 1: a blank line inside a table ends it (as GFM renders it), and
// every row-shaped line after the blank vanished with no problem recorded - a blocking unknown
// written below a blank line dropped out of the gate, which printed PASS. The rows stay out of
// the table (GitHub shows them as prose), but the parser now says so, by line.
test('a row-shaped line after the table ended is a table-split problem naming the line, in each table', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace(/(\| U-1 \|[^\n]*\n)/, '$1\n| U-2 | A second blocking question? | It decides the design | OPEN | |\n'));
  corrupt(dir, PATHS.evidence, (text) => `${text}\n| E-02 | 2026-01-01 | P | https://example.invalid/more | A second reading. | research/raw/x.md |\n`);
  corrupt(dir, PATHS.map, (text) => `${text}\n| D-99 | Another dimension | It matters | GAP | |\n`);
  const corpus = readCorpus(dir);
  const split = corpus.problems.filter((p) => p.kind === 'table-split');
  assert.deepEqual(split.map((p) => p.artifact).sort(), [PATHS.discovery, PATHS.evidence, PATHS.map].sort(), JSON.stringify(corpus.problems));
  for (const p of split) {
    assert.ok(p.line > 0, 'the line is named');
    assert.match(p.detail, /blank line/, p.detail);
    assert.match(p.detail, /U-2|E-02|D-99/, p.detail);
  }
  assert.equal(corpus.unknowns.length, 1, 'the row after the blank is still not an unknown: GFM ends the table there');
  assert.equal(lineOf(dir, PATHS.discovery, '| U-2'), split.find((p) => p.artifact === PATHS.discovery).line);
});

test('a second table after a blank line, with its own header and separator, is not a split', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => `${text}\n| Note | Text |\n|---|---|\n| n-1 | a note table below the unknowns |\n`);
  const corpus = readCorpus(dir);
  assert.deepEqual(corpus.problems.filter((p) => p.kind === 'table-split'), []);
  // The repository's own SOURCES.md holds two tables with different headers, blank-separated.
  assert.deepEqual(readCorpus('/home/user/Fetchproof').problems.filter((p) => p.kind === 'table-split'), []);
});

// Breaker review of 9ca9fc1 (2026-10-04): a row-shaped line inside a fenced code block or an
// HTML comment after the table is rendered as code or hidden, not as a stray row; a heading of
// a deeper level, or `#tag` prose, does not end the table's section, so a stray row below it
// was still dropped in silence; and a second table whose separator is malformed is named as
// that, not as three splits of the first.
test('the table-split scan skips fences and comments, runs past deeper headings, and names a malformed second table', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => `${text}\nAn example of a row, as code:\n\n\`\`\`\n| U-9 | not a row | x | OPEN | |\n\`\`\`\n\n<!--\n| U-8 | hidden | x | OPEN | |\n-->\n`);
  assert.deepEqual(readCorpus(dir).problems.filter((p) => p.kind === 'table-split'), [], 'a fenced or commented row is not a split');

  const deeper = makePassingProject();
  corrupt(deeper, PATHS.discovery, (text) => `${text}\n### A note under the unknowns\n\nSee #tag-123 for context.\n\n| U-2 | A second blocking question? | It decides the design | CLOSED | E-99 |\n`);
  const split = readCorpus(deeper).problems.filter((p) => p.kind === 'table-split');
  assert.equal(split.length, 1, `a stray row below a deeper heading was dropped in silence: ${JSON.stringify(readCorpus(deeper).problems)}`);
  assert.equal(split[0].line, lineOf(deeper, PATHS.discovery, '| U-2'));

  const same = makePassingProject();
  corrupt(same, PATHS.discovery, (text) => `${text}\n## Another section\n\n| U-3 | belongs to another section | x | OPEN | |\n`);
  assert.deepEqual(readCorpus(same).problems.filter((p) => p.kind === 'table-split'), [], 'a heading of the same level ends the section');

  // Mutation audit (2026-10-04): a lone separator after the table is not a row.
  const lone = makePassingProject();
  corrupt(lone, PATHS.discovery, (text) => `${text}\n|---|---|\n`);
  assert.deepEqual(readCorpus(lone).problems.filter((p) => p.kind === 'table-split'), []);

  const malformed = makePassingProject();
  corrupt(malformed, PATHS.discovery, (text) => `${text}\n| A | B |\n|===|===|\n| x | y |\n`);
  const named = readCorpus(malformed).problems.filter((p) => p.kind === 'table-split');
  assert.equal(named.length, 1, JSON.stringify(named));
  assert.match(named[0].detail, /separator/, named[0].detail);
});

// The contract's table, kept by `wrap` above a visible copy of it whose U-1 is OPEN.
const hideAbove = (wrap) => (text) => {
  const at = text.indexOf('| ID |');
  const table = text.slice(at);
  return `${text.slice(0, at)}${wrap(table.trimEnd())}\n\n${table.replace('| CLOSED |', '| OPEN |')}`;
};

// Found 2026-11-04 by an independent audit (F01). Only the stray-row scan below the table knew
// fences and comments; the header search took the first table with the header, wherever it
// stood. An archived CLOSED copy of the unknowns table, commented out or kept as a fenced
// example ABOVE the live table, was read as the contract: the visible OPEN unknown was never
// read, and preflight printed PASS.
test('a contract table in an HTML comment or a code fence is not the table: the visible one is read, and its OPEN unknown blocks', () => {
  const cases = [
    ['an HTML comment', (table) => `<!-- Archived table, kept for the reviewer\n${table}\n-->`],
    ['a fenced example', (table) => `\`\`\`markdown\n${table}\n\`\`\``],
    ['a tilde fence', (table) => `~~~\n${table}\n~~~`],
    // A fence closes on a run of its own character at least as long as the one that opened it.
    ['a longer fence holding a shorter one', (table) => `\`\`\`\`\n\`\`\`\n${table}\n\`\`\`\``],
    // Inside a comment a fence opens nothing; the comment ends at its -->.
    ['a comment holding a fence', (table) => `<!--\n\`\`\`\n${table}\n-->`],
  ];
  for (const [name, wrap] of cases) {
    const dir = makePassingProject();
    corrupt(dir, PATHS.discovery, hideAbove(wrap));
    const corpus = readCorpus(dir);
    assert.deepEqual(corpus.unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']], `${name}: ${JSON.stringify(corpus.unknowns)}`);
    assert.equal(runPreflight(dir).pass, false, `${name}: a visible OPEN unknown passed preflight`);
  }

  // The fence has to be one GitHub renders. ```code``` on one line is inline code, not a fence,
  // so the table below it is still the table; a fence never closed runs to the end of the file.
  const inline = makePassingProject();
  corrupt(inline, PATHS.discovery, (text) => text.replace('| ID |', '```code``` is inline code, not a fence.\n\n| ID |').replace('| CLOSED |', '| OPEN |'));
  assert.deepEqual(readCorpus(inline).unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']]);
  const unclosed = `\`\`\`\n${tableRow(HEADERS.unknowns)}\n|---|---|---|---|---|\n| U-1 | q | w | CLOSED | E-01 |\n`;
  assert.equal(parseTable(unclosed, HEADERS.unknowns).found, false, 'a table inside a fence that is never closed is code');
});

// Found 2026-11-06 by the review of #441. The reader was fed trimmed lines, so an indented example
// of a fence or a comment - code on GitHub, which opens nothing - hid every table below it: a
// correct contract was read as having no unknowns and an evidence table as lost; and with the
// comment example's `-->` indented below the live table, the OPEN table was passed over for an
// archived CLOSED copy further down.
test('an indented example of a fence or a comment opens nothing: the table below it is the table', () => {
  for (const example of ['    ```\n    code\n', '    <!--\n    note\n', '\t```\n\tcode\n']) {
    const dir = makePassingProject();
    corrupt(dir, PATHS.discovery, (text) => text.replace('| ID |', `A fence is written like this:\n\n${example}\n| ID |`));
    corrupt(dir, PATHS.evidence, (text) => text.replace('| ID |', `${example}\n| ID |`));
    const corpus = readCorpus(dir);
    assert.deepEqual(corpus.unknowns.map((u) => [u.id, u.status]), [['U-1', 'CLOSED']], JSON.stringify(example));
    assert.equal(corpus.evidenceFile.found, true, JSON.stringify(example));
    assert.equal(runPreflight(dir).pass, true, `${JSON.stringify(example)}: a correct project was blocked`);
  }

  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => {
    const at = text.indexOf('| ID |');
    const table = text.slice(at).trimEnd();
    return `${text.slice(0, at)}An example:\n\n    <!--\n\n${table.replace('| CLOSED |', '| OPEN |')}\n\n    -->\n\n${table}\n`;
  });
  assert.deepEqual(readCorpus(dir).unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']]);
  assert.equal(runPreflight(dir).pass, false, 'the visible OPEN unknown passed preflight');
});

// Found 2026-11-06 by the review of #441: more ways of keeping an archived CLOSED copy that GitHub
// hides or shows as code were read as the contract, and the visible OPEN unknown passed - an opener
// after a list marker, a `<!--` after the `-->` that reopens the comment, a fence's line indented
// four (its content, not its closer), and a copy indented as code.
test('an archived copy after a list marker, in a reopened comment, in indented code or below a fence line indented four is hidden', () => {
  const indent = (n, table) => table.split('\n').map((line) => `${' '.repeat(n)}${line}`).join('\n');
  const cases = [
    ['a fence in a list item', (table) => `- Archived copy:\n  \`\`\`\n${indent(2, table)}\n  \`\`\``],
    ['a comment after a list marker', (table) => `- <!-- archived copy\n${indent(2, table)}\n  -->`],
    ['a fence after an ordered list marker', (table) => `1. \`\`\`\n${indent(3, table)}\n   \`\`\``],
    ['a fence after a list marker and a tab', (table) => `-\t\`\`\`\n${indent(4, table)}\n    \`\`\``],
    ['a fence whose line indented four is its content', (table) => `\`\`\`markdown\n    \`\`\`\n${table}\n\`\`\``],
    ['a comment reopened after the one it closed', (table) => `<!-- archived below --> <!--\n${table}\n\n<!-- end of archive -->`],
    ['a comment reopened on its closing line', (table) => `<!--\nold notes\n--> <!--\n${table}\n\n<!-- end -->`],
    ['indented code', (table) => indent(4, table)],
  ];
  for (const [name, wrap] of cases) {
    const dir = makePassingProject();
    corrupt(dir, PATHS.discovery, hideAbove(wrap));
    const corpus = readCorpus(dir);
    assert.deepEqual(corpus.unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']], `${name}: ${JSON.stringify(corpus.unknowns)}`);
    assert.equal(runPreflight(dir).pass, false, `${name}: a visible OPEN unknown passed preflight`);
  }

  // A comment that closes as it opens hides nothing, and CRLF line ends change nothing.
  const open = [tableRow(HEADERS.unknowns), '|---|---|---|---|---|', '| U-1 | q | w | OPEN | |'].join('\n');
  assert.deepEqual(parseTable(`<!-->\n<!--->\n${open}\n`, HEADERS.unknowns).rows.map((r) => r.Status), ['OPEN']);
  const archived = `<!--\n${open.replace('| OPEN | |', '| CLOSED | E-01 |')}\n-->\n\n${open}\n`;
  assert.deepEqual(parseTable(archived.replace(/\n/g, '\r\n'), HEADERS.unknowns).rows.map((r) => r.Status), ['OPEN']);
});

// Found 2026-11-06 by the re-review of #441's reader (findings 2 and 3). An item opened on an empty
// line was held open across a blank line, and a run of `=` or `-` below a paragraph was read as its
// next line. GitHub ends both there, so a copy fenced or indented four below them is code, and it
// was read as the contract.
test('an archived copy below an empty list item or a setext heading is hidden', () => {
  const indent = (n, table) => table.split('\n').map((line) => `${' '.repeat(n)}${line}`).join('\n');
  const cases = [
    ['a fence below an empty item and a blank line', (table) => `-\n\n  \`\`\`\n${table}\n  \`\`\``],
    ['a fence below an empty ordered item and a blank line', (table) => `1.\n\n   \`\`\`\n${table}\n   \`\`\``],
    ['indented code below an empty item and a blank line', (table) => `-\n\n${indent(4, table)}`],
    ['indented code below a heading underlined with =', (table) => `Archived contract\n=================\n${indent(4, table)}`],
    ['indented code below a heading underlined with --', (table) => `Archived contract\n--\n${indent(4, table)}`],
  ];
  for (const [name, wrap] of cases) {
    const dir = makePassingProject();
    corrupt(dir, PATHS.discovery, hideAbove(wrap));
    const corpus = readCorpus(dir);
    assert.deepEqual(corpus.unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']], `${name}: ${JSON.stringify(corpus.unknowns)}`);
    assert.equal(runPreflight(dir).pass, false, `${name}: a visible OPEN unknown passed preflight`);
  }

  // A blank line whose spaces reach the item's content keeps it open: the fence below is the
  // item's, and the table written at column 0 below that ends both, as GitHub shows it.
  const kept = makePassingProject();
  corrupt(kept, PATHS.discovery, (text) => text.replace('| ID |', '-\n  \n  ```\n  an example\n\n| ID |'));
  assert.deepEqual(readCorpus(kept).unknowns.map((u) => [u.id, u.status]), [['U-1', 'CLOSED']]);
  assert.equal(runPreflight(kept).pass, true, 'a correct project was blocked');
});

// Found 2026-11-06 by the re-review of #441's reader (finding 1). A file saved as UTF-8 with a
// byte-order mark (Windows PowerShell 5's -Encoding utf8 writes one) began its first line with it,
// so a fence or a comment opened there was not seen: the archived copy in it was read as the
// contract, and a row was appended inside a comment never closed.
test('a fence or a comment opened on the first line of a file with a byte-order mark hides what it holds', () => {
  const archived = (text) => text.slice(text.indexOf('| ID |')).trimEnd();
  const cases = [
    ['a comment', (table) => `<!-- archived\n${table}\n-->`],
    ['a fence', (table) => `\`\`\`markdown\n${table}\n\`\`\``],
  ];
  for (const [name, wrap] of cases) {
    const dir = makePassingProject();
    corrupt(dir, PATHS.discovery, (text) => `\uFEFF${wrap(archived(text))}\n\n${text.replace('| CLOSED |', '| OPEN |')}`);
    const corpus = readCorpus(dir);
    assert.deepEqual(corpus.unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']], `${name}: ${JSON.stringify(corpus.unknowns)}`);
    assert.equal(runPreflight(dir).pass, false, `${name}: a visible OPEN unknown passed preflight`);
  }

  const dir = makeProject();
  const file = resolve(dir, PATHS.evidence);
  const head = `${tableRow(HEADERS.evidence)}\n|${HEADERS.evidence.map(() => '---').join('|')}|`;
  writeText(file, `\uFEFF<!-- notes\n\n${head}\n${tableRow(['E-01', '2026-01-01', 'P', 'https://example.invalid/', 'a claim', 'research/raw/a.md'])}\n`);
  const before = readText(file);
  assert.throws(
    () => appendRow(dir, PATHS.evidence, HEADERS.evidence, ['E-02', '2026-01-02', 'P', 'https://x.invalid/', 'a claim', 'research/raw/b.md']),
    (err) => err.code === 'TABLE_HIDDEN' && /ends inside an HTML comment that starts at line 1 /.test(err.message),
  );
  assert.equal(readText(file), before, 'the file was written');
});

// Found 2026-11-06 by the re-review of #441's reader (finding 4). A line indented less than a list
// item's content ended the item, though GitHub reads it as the next line of the item's paragraph - a
// lazy continuation line - so a table indented in the item, shown by GitHub, was read as indented
// code, and a correct contract as having no unknowns. Each shape below was rendered by GitHub's
// renderer on 2026-11-06.
test('a lazy continuation line keeps its list item: the table indented in the item is the table', () => {
  const indent = (text) => text.split('\n').map((line) => (line ? `    ${line}` : line)).join('\n');
  const inItem = (text) => {
    const at = text.indexOf('| ID |');
    return `${text.slice(0, at)}10. The table, kept in this item and reviewed\non 2026-10-01:\n\n${indent(text.slice(at).trimEnd())}\n`;
  };
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, inItem);
  corrupt(dir, PATHS.evidence, inItem);
  const corpus = readCorpus(dir);
  assert.deepEqual(corpus.unknowns.map((u) => [u.id, u.status]), [['U-1', 'CLOSED']], JSON.stringify(corpus.unknowns));
  assert.equal(corpus.evidenceFile.found, true);
  assert.equal(runPreflight(dir).pass, true, 'a correct project was blocked');
  assertTablesWritable(dir);

  // A line of `=`, a delimiter row or text holding a pipe is the paragraph's lazy text. A footnote
  // definition starts a block, and a paragraph a delimiter row made a table - one with no pipe too -
  // is continued by no lazy line: the item ends there, and the copy indented four is code.
  const table = indent([tableRow(HEADERS.unknowns), '|---|---|---|---|---|', '| U-1 | q | w | CLOSED | E-01 |'].join('\n'));
  const read = (above) => parseTable(`${above}\n\n${table}\n`, HEADERS.unknowns);
  for (const above of ['- The table\n===', '- The table\n:--', '- Run a | b here\nand on']) {
    assert.deepEqual(read(above).rows.map((r) => r.Status), ['CLOSED'], above);
  }
  for (const above of ['- The table\n[^old]: kept below', '- The table\n  :--\nand on', '- The table\n  a | b\n  --|--\nand on']) {
    assert.equal(read(above).found, false, above);
  }
});

// Found 2026-11-06 by the re-review of #441's reader (finding 5): each list marker on a line asked
// the rest of the line whether it was a thematic break, so a line of n markers took time in n
// squared - 22.6 s for 80 KB, and a package's files reach the reader through the validator.
test('the reader takes linear time on a line of list markers and on the lazy lines below it', () => {
  const evidence = [tableRow(HEADERS.evidence), `|${HEADERS.evidence.map(() => '---').join('|')}|`,
    tableRow(['E-01', '2026-01-01', 'P', 'https://example.invalid/', 'a claim', 'research/raw/a.md'])].join('\n');
  const cases = [
    ['40,000 list markers on one line', `${'- '.repeat(40_000)}x`],
    ['40,000 lazy lines below 40,000 nested items', `${'- '.repeat(40_000)}x\n${'more text\n'.repeat(40_000)}`],
  ];
  for (const [name, above] of cases) {
    const started = performance.now();
    const ids = parseTable(`${above}\n\n${evidence}\n`, HEADERS.evidence).rows.map((r) => r.ID);
    const ms = performance.now() - started;
    assert.deepEqual(ids, ['E-01'], name);
    assert(ms < 2_000, `${name}: ${ms.toFixed(0)} ms - the reader is not linear`);
  }
});

// A heading in a code block or a comment heads no section (review of #441, 2026-11-06): taken as
// one, a `# Example` in a fence above the table ran the stray-row scan past the table's own
// section, and a pipe-bearing line in the next section was named a row written below the table.
test('a heading in a code block or a comment does not set the section the stray-row scan runs to', () => {
  const table = [tableRow(HEADERS.unknowns), '|---|---|---|---|---|', '| U-1 | q | w | CLOSED | E-01 |'].join('\n');
  for (const example of ['```\n# Example\n```', '<!--\n# Example\n-->', '    # Example']) {
    const got = parseTable(`# Discovery\n\n## Unknowns\n\n${example}\n\n${table}\n\n## Notes\n\n| a note | with a pipe |\n`, HEADERS.unknowns);
    assert.deepEqual(got.rows.map((r) => r.ID), ['U-1'], example);
    assert.deepEqual(got.problems, [], `${example}: ${JSON.stringify(got.problems)}`);
  }
});

// The writers ask the reader where the table is, so they must write where it reads (F01): a row
// appended below an archived copy in a comment is hidden, and a row for an empty live table went
// below the first header led by the same column - which was the commented one.
test('appendRow writes into the table the reader reads, not into an archived copy above it', () => {
  const head = `${tableRow(HEADERS.evidence)}\n|${HEADERS.evidence.map(() => '---').join('|')}|`;
  const example = tableRow(['E-00', '2026-01-01', 'P', 'https://example.invalid/', 'an example', 'research/raw/example.md']);
  for (const archived of [`<!-- An example, kept for the reviewer\n${head}\n${example}\n-->`, `<!--\n${head}\n-->`]) {
    const dir = makeProject();
    writeText(resolve(dir, PATHS.evidence), `# Evidence\n\n${archived}\n\n${head}\n`);
    appendRow(dir, PATHS.evidence, HEADERS.evidence, ['E-01', '2026-01-02', 'P', 'https://x.invalid', 'a claim', 'research/raw/a.md']);
    const text = readText(resolve(dir, PATHS.evidence));
    assert(text.includes(archived), `the archived copy was written into:\n${text}`);
    assert.deepEqual(parseTable(text, HEADERS.evidence).rows.map((r) => r.ID), ['E-01'], text);
  }
});

// Found 2026-11-06 by the review of #441 (finding 1, ADR-0204). With a fence or a comment never
// closed above the table, the reader found no table, and appendRow started one at the end of the
// file - inside the same block, read by nothing - numbering its row E-01 again on every run; once
// the block was closed, every citation of the new E-01 resolved to the old one, another page.
test('appendRow refuses, writing nothing, where its row would be hidden: a block never closed, or a hidden table with rows', () => {
  const fence = '```';
  const head = `${tableRow(HEADERS.evidence)}\n|${HEADERS.evidence.map(() => '---').join('|')}|`;
  const row = tableRow(['E-01', '2026-01-01', 'P', 'https://example.invalid/', 'a claim', 'research/raw/a.md']);
  const indent = (text) => text.split('\n').map((line) => `    ${line}`).join('\n');
  const cases = [
    ['a fence never closed above the table', `${fence}\nnode fetchproof/bin/research.mjs\n\n${head}\n${row}\n`,
      /ends inside a fenced code block that starts at line 3 and is never closed/],
    ['a comment never closed above the table', `<!-- notes\n\n${head}\n${row}\n`, /ends inside an HTML comment that starts at line 3 /],
    ['a fence never closed, and no table yet', `${fence}\nnode fetchproof/bin/research.mjs\n`, /ends inside a fenced code block that starts at line 3 /],
    ['the table and its rows in a closed comment', `<!--\n${head}\n${row}\n-->\n`, /its table stands inside an HTML comment that starts at line 3,/],
    ['the table indented as code', `${indent(`${head}\n${row}`)}\n`, /its table stands inside an indented code block that starts at line 3,/],
  ];
  for (const [name, body, says] of cases) {
    const dir = makeProject();
    const file = resolve(dir, PATHS.evidence);
    writeText(file, `# Evidence\n\n${body}`);
    const before = readText(file);
    assert.throws(
      () => appendRow(dir, PATHS.evidence, HEADERS.evidence, ['E-02', '2026-01-02', 'P', 'https://x.invalid/', 'a claim', 'research/raw/b.md']),
      (err) => err.code === 'TABLE_HIDDEN' && err.message.startsWith(`refusing to write to ${PATHS.evidence}: `) && says.test(err.message),
      name,
    );
    assert.equal(readText(file), before, `${name}: the file was written`);
  }

  // upsertRow appends a new source through appendRow, and is refused the same way.
  const dir = makeProject();
  const file = resolve(dir, PATHS.sources);
  const sources = `${tableRow(HEADERS.sources)}\n|${HEADERS.sources.map(() => '---').join('|')}|\n${tableRow(['https://example.invalid/', 'P', 'T', '2026-01-01', 'U-1'])}`;
  writeText(file, `# Sources\n\n<!--\n${sources}\n-->\n`);
  const before = readText(file);
  assert.throws(() => upsertRow(dir, PATHS.sources, HEADERS.sources, ['https://x.invalid/', 'S', 'X', '2026-01-02', 'U-2']), (err) => err.code === 'TABLE_HIDDEN');
  assert.equal(readText(file), before);
});

// The refusal is no wider than the harm (ADR-0204): a header kept as a commented-out example holds
// no rows a new table would leave behind, and a block left open BELOW a table the reader reads is
// not where the row goes.
test('appendRow still writes beside a hidden header with no rows, and into a read table above a block never closed', () => {
  const head = `${tableRow(HEADERS.evidence)}\n|${HEADERS.evidence.map(() => '---').join('|')}|`;
  const cells = (id) => [id, '2026-01-02', 'P', `https://x.invalid/${id}`, 'a claim', 'research/raw/a.md'];
  const ids = (dir) => parseTable(readText(resolve(dir, PATHS.evidence)), HEADERS.evidence).rows.map((r) => r.ID);

  const example = makeProject();
  writeText(resolve(example, PATHS.evidence), `# Evidence\n\n<!-- the table's header, for reference\n${head}\n-->\n`);
  appendRow(example, PATHS.evidence, HEADERS.evidence, cells('E-01'));
  assert.deepEqual(ids(example), ['E-01']);

  const above = makeProject();
  writeText(resolve(above, PATHS.evidence), `# Evidence\n\n${head}\n${tableRow(cells('E-01'))}\n\n${'```'}\nnotes, never closed\n`);
  appendRow(above, PATHS.evidence, HEADERS.evidence, cells('E-02'));
  assert.deepEqual(ids(above), ['E-01', 'E-02']);
});

// #331: GFM makes a row's outer pipes optional, so `E-03 | ... |` renders as the third row on
// GitHub. The kit ended the table there, and named every later row as standing after a blank
// line the file did not have - 24 times, and never the one line at fault.
test('a row without its leading pipe is read as GitHub renders it: a row of the table', () => {
  const header = ['ID', 'Retrieved', 'Type', 'URL', 'Finding', 'Raw'];
  const row = (n) => `| E-0${n} | 2026-01-01 | P | https://example.invalid/${n} | Reading ${n}. | research/raw/${n}.md |`;
  const piped = ['# Evidence', '', `| ${header.join(' | ')} |`, '|---|---|---|---|---|---|', row(1), row(2), row(3), row(4), ''].join('\n');
  const want = parseTable(piped, header);
  assert.equal(want.rows.length, 4);
  for (const pipeless of [piped.replace('| E-03 | ', 'E-03 | '), piped.replace(/^\| (E-03 .*) \|$/m, '$1')]) {
    const got = parseTable(pipeless, header);
    assert.deepEqual(got.rows, want.rows, pipeless);
    assert.deepEqual(got.problems, [], JSON.stringify(got.problems));
  }

  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => `${text}U-2 | A second question? | It decides the design | OPEN | |\n| U-3 | A third question? | It decides the design | OPEN | |\n`);
  const corpus = readCorpus(dir);
  assert.deepEqual(corpus.unknowns.map((u) => u.id), ['U-1', 'U-2', 'U-3']);
  assert.deepEqual(corpus.problems.filter((p) => p.kind === 'table-split'), []);
});

test('a pipe-bearing line that is not a row ends the table and is named once, with no blank line claimed', () => {
  const dir = makePassingProject();
  // One cell short of the header: not a row by arity, but GitHub still shows it in the table.
  corrupt(dir, PATHS.discovery, (text) => `${text}U-2 | A second question? | OPEN |\n| U-3 | A third question? | It decides the design | OPEN | |\n| U-4 | A fourth question? | It decides the design | OPEN | |\n`);
  const split = readCorpus(dir).problems.filter((p) => p.kind === 'table-split');
  assert.equal(split.length, 1, JSON.stringify(split));
  assert.equal(split[0].line, lineOf(dir, PATHS.discovery, 'U-2 |'));
  assert.match(split[0].detail, /does not start with \|/, split[0].detail);
  assert.match(split[0].detail, /add the leading pipe if it is a row, or a blank line above it if it is prose/, split[0].detail);
  assert.doesNotMatch(split[0].detail, /after a blank line/, split[0].detail);

  // Review of #331: prose holding a | straight below the table is the same line to GitHub, and
  // "add the leading pipe" alone would turn it into a malformed row - the advice names both.
  const tiers = makePassingProject();
  corrupt(tiers, PATHS.discovery, (text) => `${text}Tiers: P | S | L are the grades.\n`);
  const named = readCorpus(tiers).problems.filter((p) => p.kind === 'table-split');
  assert.equal(named.length, 1, JSON.stringify(named));
  assert.equal(named[0].line, lineOf(tiers, PATHS.discovery, 'Tiers:'));
  assert.equal(named[0].detail, '`Tiers: P | S | L are the grades.` does not start with |, and splits to 3 cells, not the header\'s 5, '
    + 'so the table ended there and no check reads the rows below it - add the leading pipe if it is a row, or a blank line above it if it is prose');

  // A line of prose directly below the rows ends the table too; the row after it is named
  // with the line that ended the table, not with a blank line that is not there.
  const prose = makePassingProject();
  corrupt(prose, PATHS.discovery, (text) => `${text}A note written straight below the table.\n| U-2 | A second question? | It decides the design | OPEN | |\n`);
  const after = readCorpus(prose).problems.filter((p) => p.kind === 'table-split');
  assert.equal(after.length, 1, JSON.stringify(after));
  assert.equal(after[0].line, lineOf(prose, PATHS.discovery, '| U-2'));
  assert.doesNotMatch(after[0].detail, /blank line/, after[0].detail);
  assert.match(after[0].detail, /A note written/, after[0].detail);
});

// Review of #331: a row without its leading pipe BELOW a blank line was not row-shaped to the
// stray scan, so it was dropped in silence - a blocking unknown hidden, and the gate passed.
test('a row without its leading pipe after a blank line is a table-split problem at its line', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => `${text}\nU-2 | Q2? | it decides the design | OPEN | |\n`);
  const corpus = readCorpus(dir);
  assert.deepEqual(corpus.unknowns.map((u) => u.id), ['U-1'], 'GFM ends the table at the blank line');
  const split = corpus.problems.filter((p) => p.kind === 'table-split');
  assert.equal(split.length, 1, JSON.stringify(corpus.problems));
  assert.equal(split[0].line, lineOf(dir, PATHS.discovery, 'U-2 |'));
  assert.match(split[0].detail, /row `U-2` stands after a blank line/, split[0].detail);
});

// Found 2026-11-07 by the re-review of #441's reader (F-A to F-E, and N1). The reader followed
// GitHub's blocks with shortcuts of its own: a list item's paragraph it could not follow it ended
// the safe way, a footnote definition was prose, a carriage return alone ended no line, and a
// header over a separator was a table wherever it stood. It now follows cmark-gfm's block parser
// (ADR-0203); each shape below was rendered by GitHub's renderer or read from cmark-gfm's source.
const FENCE = '```';
const U_TABLE = `${tableRow(HEADERS.unknowns)}\n|---|---|---|---|---|`;
const uRow = (id, status) => `| ${id} | q | w | ${status} | ${status === 'CLOSED' ? 'E-01' : ''} |`;
const padBy = (n, text) => text.split('\n').map((line) => (line ? `${' '.repeat(n)}${line}` : line)).join('\n');
const ARCHIVED = `${U_TABLE}\n${uRow('U-1', 'CLOSED')}`;
const liveTable = (status) => `${U_TABLE}\n${uRow('U-1', status)}`;
const inComment = (n) => padBy(n, `<!--\n${ARCHIVED}\n-->`);
const inFence = (n) => padBy(n, `${FENCE}markdown\n${ARCHIVED}\n${FENCE}`);
const contract = (above, status = 'OPEN') => `# Discovery\n\n## Unknowns\n\n${above}\n\n${liveTable(status)}\n`;
const statuses = (text) => parseTable(text, HEADERS.unknowns).rows.map((r) => [r.ID, r.Status]);
const splits = (table) => table.problems.filter((p) => p.kind === 'table-split');
const EVIDENCE_HEAD = `${tableRow(HEADERS.evidence)}\n|${HEADERS.evidence.map(() => '---').join('|')}|`;
const eRow = (id, url = 'https://example.invalid/') => tableRow([id, '2026-01-01', 'P', url, 'a claim', `research/raw/${id}.md`]);
const eCells = (id, url = `https://x.invalid/${id}`) => [id, '2026-01-02', 'P', url, 'a claim', `research/raw/${id}.md`];

// F-A: below a lazy line, or in an item led by an autolink or an inline tag, the reader ended the
// item, so a comment or a fence at the item's content column was text, and the archived copy in it
// was read as the contract.
test("a comment or a fence at a list item's content column below a lazy line is the item's, and hides the copy it holds", () => {
  const cases = [
    ['a comment below a lazy line led by an autolink', `10. The contract was reviewed against\n<https://docs.example.com/limits>, and the first table is kept here:\n${inComment(4)}`],
    ['a comment below an item led by an autolink', `10. <https://docs.example.com/limits> is where the numbers come from; the\nfirst contract is kept below:\n${inComment(4)}`],
    ['a fence below an item led by an autolink', `10. <https://docs.example.com/limits> is where the numbers come from; the\nfirst contract is kept below:\n${inFence(4)}`],
    ['a comment in a nested item led by an autolink', `- Sources\n  - <https://docs.example.com/limits> is the source; the\nfirst contract is kept below:\n${inComment(4)}`],
    ['a comment below a lazy line led by inline code', `10. The contract was reviewed against\n${FENCE}limits${FENCE} on the vendor page; the first table is kept here:\n${inComment(4)}`],
    ['a comment below a delimiter row of another width', `10. a | b\n    |---|\nand the first table is kept here:\n${inComment(4)}`],
    ['a comment below a bullet led by an autolink', `- <https://docs.example.com/limits> was the first source; the\nold table is kept below:\n${inComment(4)}`],
    ['a fence below a bullet led by an inline tag', `- <kbd>Ctrl</kbd> was the old shortcut; the\nold table is kept below:\n${inFence(4)}`],
    ['a comment at column 5 below a lazy line led by an autolink', `- The old table was reviewed against\n<https://docs.example.com/limits> and is kept below:\n${inComment(5)}`],
    ['a comment below a plain lazy line', `10. The contract was reviewed against\nthe vendor docs, and the first table is kept here:\n${inComment(4)}`],
    ['a comment after a blank line below a lazy line', `10. The contract was reviewed against\n<https://docs.example.com/limits>, and the first table is kept here:\n\n${inComment(4)}`],
    ['a comment at the content column of a bullet led by an autolink', `- <https://docs.example.com/limits> was the first source; the\nold table is kept below:\n${inComment(2)}`],
  ];
  for (const [name, above] of cases) {
    assert.deepEqual(statuses(contract(above)), [['U-1', 'OPEN']], name);
  }

  const lazy = (wrap) => (table) => `10. The contract was reviewed against\n<https://docs.example.com/limits>, and the first table is kept here:\n${padBy(4, wrap(table))}`;
  for (const wrap of [(table) => `<!--\n${table}\n-->`, (table) => `${FENCE}markdown\n${table}\n${FENCE}`]) {
    const dir = makePassingProject();
    corrupt(dir, PATHS.discovery, hideAbove(lazy(wrap)));
    assert.deepEqual(readCorpus(dir).unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']]);
    assert.equal(runPreflight(dir).pass, false, 'a visible OPEN unknown passed preflight');
  }

  // The writer asks the same reader: the row goes into the visible table, not into the copy.
  const dir = makeProject();
  const file = resolve(dir, PATHS.evidence);
  const archived = padBy(4, `<!--\n${EVIDENCE_HEAD}\n${eRow('E-01', 'https://old.invalid/')}\n-->`);
  writeText(file, `# Evidence\n\n10. <https://docs.example.com/limits> was the first source; the\nold table is kept below:\n${archived}\n\n${EVIDENCE_HEAD}\n${eRow('E-01', 'https://live.invalid/')}\n`);
  appendRow(dir, PATHS.evidence, HEADERS.evidence, eCells('E-02', 'https://new.invalid/'));
  const text = readText(file);
  assert(text.includes(archived), `the archived copy was written into:\n${text}`);
  assert.deepEqual(parseTable(text, HEADERS.evidence).rows.map((r) => [r.ID, r.URL]), [['E-01', 'https://live.invalid/'], ['E-02', 'https://new.invalid/']]);
});

// F-B: a table below a list item's paragraph, indented less than its content, is that paragraph's
// lazy text on GitHub, and a table in an item takes no lazy line - a row written at column 0 below
// it ends the item. The reader read both as tables, rows and all.
test("a table below a list item's paragraph at less than its content is that paragraph's text, and a row at column 0 is outside the item's table", () => {
  for (const above of [`- Superseded on 2026-10-01, kept for the record:\n${ARCHIVED}`, `1. Superseded on 2026-10-01:\n${ARCHIVED}`]) {
    assert.deepEqual(statuses(contract(above)), [['U-1', 'OPEN']], above);
  }
  const lazy = makePassingProject();
  corrupt(lazy, PATHS.discovery, hideAbove((table) => `- Superseded on 2026-10-01, kept for the record:\n${table}`));
  assert.deepEqual(readCorpus(lazy).unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']]);
  assert.equal(runPreflight(lazy).pass, false, 'a visible OPEN unknown passed preflight');

  // Indented to the item's content, the delimiter row makes the item's paragraph a table, and the
  // writers keep the indentation of the row they follow or replace: at column 0 it would be outside.
  const [head, delimiter] = U_TABLE.split('\n');
  const dir = makeProject();
  const file = resolve(dir, PATHS.discovery);
  writeText(file, `# Discovery\n\n## Unknowns\n\n- Superseded:\n${head}\n  ${delimiter}\n  ${uRow('U-1', 'CLOSED')}\n`);
  const read = parseTable(readText(file), HEADERS.unknowns);
  assert.deepEqual(read.rows.map((r) => [r.ID, r.Status]), [['U-1', 'CLOSED']]);
  assert.deepEqual(read.problems, []);
  const appended = appendRow(dir, PATHS.discovery, HEADERS.unknowns, ['U-2', 'q', 'w', 'OPEN', '']);
  const replaced = upsertRow(dir, PATHS.discovery, HEADERS.unknowns, ['U-1', 'q', 'w', 'OPEN', '']);
  const lines = readText(file).split('\n');
  assert.deepEqual([lines[7], lines[8]], [`  ${replaced}`, `  ${appended}`]);
  assert(!/^\s/.test(appended) && !/^\s/.test(replaced), 'a row was returned with its indentation');
  const after = parseTable(readText(file), HEADERS.unknowns);
  assert.deepEqual(after.rows.map((r) => [r.ID, r.Status]), [['U-1', 'OPEN'], ['U-2', 'OPEN']]);
  assert.deepEqual(after.problems, []);

  const outside = `- Superseded on 2026-10-01:\n${padBy(2, U_TABLE)}\n${uRow('U-1', 'CLOSED')}`;
  for (const text of [`# Discovery\n\n## Unknowns\n\n${outside}\n`, contract(outside)]) {
    const table = parseTable(text, HEADERS.unknowns);
    assert.deepEqual([table.found, table.line, table.rows], [true, 6, []]);
    const named = splits(table);
    assert.equal(named.length, 1, JSON.stringify(table.problems));
    assert.equal(named[0].line, 8);
    assert.match(named[0].detail, /stands at a column where the list item or footnote holding the table ends/, named[0].detail);
  }
  const rows = makePassingProject();
  corrupt(rows, PATHS.discovery, (text) => text.replace(/^(\| ID .*)\n(\|---.*)$/m, '- Superseded on 2026-10-01:\n  $1\n  $2'));
  assert.equal(runPreflight(rows).pass, false, 'a contract whose rows GitHub shows outside its table passed preflight');
});

// F-C: a footnote definition is a container on GitHub - the lines indented four below it are its
// content - and a definition nothing refers to is not shown at all. The reader took both as prose.
test('a footnote definition holds the lines indented four below it, and one nothing refers to is not shown', () => {
  const old = (body) => `The contract was revised.[^old]\n\n[^old]: The first contract, kept for the reviewer:\n${body}`;
  const cases = [
    ['a comment below its first line', old(inComment(4))],
    ['a fence below its first line', old(inFence(4))],
    ['a comment after a blank line', old(`\n${inComment(4)}`)],
  ];
  for (const [name, above] of cases) {
    assert.deepEqual(statuses(contract(above)), [['U-1', 'OPEN']], name);
  }

  // A referenced definition's table is shown among the footnotes; one nothing refers to is dropped.
  assert.deepEqual(statuses(`# Discovery\n\n## Unknowns\n\n${old(padBy(4, ARCHIVED))}\n`), [['U-1', 'CLOSED']]);
  const unreferenced = `[^old]: The first contract, kept for the reviewer:\n${padBy(4, ARCHIVED)}`;
  assert.deepEqual(statuses(contract(unreferenced)), [['U-1', 'OPEN']]);
  assert.equal(parseTable(`# Discovery\n\n## Unknowns\n\n${unreferenced}\n`, HEADERS.unknowns).found, false);
});

// F-D: GitHub ends a line at a carriage return alone, as at LF and CR LF; the reader split at LF
// only, so a fence opened on a line ending CR CR LF (a text-mode conversion run twice) was not seen.
test('a carriage return alone ends a line, as on GitHub: a fence it ends hides the copy, and a header it splits makes no table', () => {
  const crlf = (text) => text.replace(/\n/g, '\r\n');
  const top = crlf('# Discovery\n\n## Unknowns\n\n');
  const cases = [
    ['a CRLF file whose fence line ends CR CR LF', `${top}${FENCE}markdown\r\r\n${crlf(`${ARCHIVED}\n${FENCE}\n\n${liveTable('OPEN')}\n`)}`],
    ['the same with a bare fence', `${top}${FENCE}\r\r\n${crlf(`${ARCHIVED}\n${FENCE}\n\n${liveTable('OPEN')}\n`)}`],
    ['a fence line ending in a carriage return alone', `${FENCE}markdown\r${ARCHIVED}\n${FENCE}\n\n${liveTable('OPEN')}\n`],
    ['a CRLF file and a comment', crlf(`<!-- archived\n${ARCHIVED}\n-->\n\n${liveTable('OPEN')}\n`)],
  ];
  for (const [name, text] of cases) {
    assert.deepEqual(statuses(text), [['U-1', 'OPEN']], name);
  }
  // A NUL, or a byte-order mark past the first line, is text: the comment does not open there, and
  // GitHub shows the copy as the table.
  for (const lead of ['\u0000', 'Notes\n\n\uFEFF']) {
    assert.deepEqual(statuses(`${lead}<!-- archived\n${ARCHIVED}\n-->\n\n${liveTable('OPEN')}\n`), [['U-1', 'CLOSED']], JSON.stringify(lead));
  }
  // Every line ending CR CR LF puts a blank line below each, and no table is left: the visible
  // header is named once, with the reason.
  for (const [open, close] of [[`${FENCE}markdown`, FENCE], ['<!-- archived', '-->']]) {
    const table = parseTable(`${open}\n${ARCHIVED}\n${close}\n\n${liveTable('OPEN')}\n`.replace(/\n/g, '\r\r\n'), HEADERS.unknowns);
    assert.equal(table.found, false, open);
    const named = splits(table);
    assert.equal(named.length, 1, JSON.stringify(table.problems));
    assert.equal(named[0].line, 7);
    assert.match(named[0].detail, /holds a carriage return alone/, named[0].detail);
  }

  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => {
    const at = text.indexOf('| ID |');
    const table = text.slice(at).trimEnd();
    return `${crlf(text.slice(0, at))}${FENCE}markdown\r\r\n${crlf(`${table}\n${FENCE}\n\n${table.replace('| CLOSED |', '| OPEN |')}\n`)}`;
  });
  assert.deepEqual(readCorpus(dir).unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']]);
  assert.equal(runPreflight(dir).pass, false, 'a visible OPEN unknown passed preflight');
});

// N1: a comment opened in a list item and cut off where the item ends leaves its `<!--` in GitHub's
// page with nothing after it to close it, and the browser hides the rest of the file in it.
test('an HTML comment cut off by the end of its list item hides every line to the end of the file, and the writer refuses', () => {
  const [head, delimiter] = U_TABLE.split('\n');
  const text = `# Discovery\n\n## Unknowns\n\n- Archived:\n  <!--\n  ${head}\n  ${delimiter}\n  ${uRow('U-1', 'OPEN')}\n-->\n\n${liveTable('CLOSED')}\n`;
  const table = parseTable(text, HEADERS.unknowns);
  assert.equal(table.found, false);
  const named = splits(table);
  assert.equal(named.length, 1, JSON.stringify(table.problems));
  assert.equal(named[0].line, 12, 'the header named is the live one below the cut, not the copy the comment hides');
  assert.match(named[0].detail, /an HTML comment that starts at line 6 is cut off at line 10/, named[0].detail);
  const alone = parseTable(text.slice(0, text.indexOf('\n\n| ID |')), HEADERS.unknowns);
  assert.deepEqual(splits(alone).map((p) => p.line), [7], 'with no header below the cut, the one in the comment is named');

  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (body) => body.replace('| ID |', `- Archived:\n  <!--\n${padBy(2, liveTable('OPEN'))}\n-->\n\n| ID |`));
  assert.equal(runPreflight(dir).pass, false, 'a contract GitHub hides passed preflight');

  const project = makeProject();
  const file = resolve(project, PATHS.evidence);
  writeText(file, `# Evidence\n\n- Archived:\n  <!--\n${padBy(2, `${EVIDENCE_HEAD}\n${eRow('E-01')}`)}\n-->\n\n${EVIDENCE_HEAD}\n${eRow('E-01')}\n`);
  const before = readText(file);
  assert.throws(
    () => appendRow(project, PATHS.evidence, HEADERS.evidence, eCells('E-02')),
    (err) => err.code === 'TABLE_HIDDEN' && /an HTML comment that starts at line 4 is cut off at line 8/.test(err.message),
  );
  assert.equal(readText(file), before, 'the file was written');
});

// With no table the reader reads, the writer starts one at the end of the file; a header GitHub
// does not show as a table, with rows below it, would be left behind by it, and the new table
// would number its own rows from the first id again (ADR-0204).
test('appendRow refuses, writing nothing, beside rows GitHub does not show as a table, whatever the reason', () => {
  const [head] = EVIDENCE_HEAD.split('\n');
  const cases = [
    ['a delimiter row of another width', `${head}\n|---|---|\n${eRow('E-01')}`, /its delimiter row has 2 cells and the header 6/],
    ["a table below a list item's paragraph", `- Kept:\n${EVIDENCE_HEAD}\n${eRow('E-01')}`, /reads them as more of that paragraph/],
    ['a delimiter row GitHub does not read', `${head}\n|---|- -|---|---|---|---|\n${eRow('E-01')}`, /GitHub does not read the delimiter row/],
    ['an HTML block', `<div>\n${EVIDENCE_HEAD}\n${eRow('E-01')}\n</div>`, /its table stands inside an HTML block that starts at line 3,/],
    ['a footnote definition nothing refers to', `[^old]: The old table:\n${padBy(4, `${EVIDENCE_HEAD}\n${eRow('E-01')}`)}`,
      /its table stands inside a footnote definition that starts at line 3 and that nothing refers to,/],
    ['a second definition of a label', `Kept.[^old]\n\n[^old]: Kept below.\n\n[^old]: The old table:\n${padBy(4, `${EVIDENCE_HEAD}\n${eRow('E-01')}`)}`,
      /its table stands inside a footnote definition that starts at line 7 and repeats the label of the one at line 5,/],
  ];
  for (const [name, body, says] of cases) {
    const dir = makeProject();
    const file = resolve(dir, PATHS.evidence);
    writeText(file, `# Evidence\n\n${body}\n`);
    const before = readText(file);
    assert.throws(
      () => appendRow(dir, PATHS.evidence, HEADERS.evidence, eCells('E-02')),
      (err) => err.code === 'TABLE_HIDDEN' && err.message.startsWith(`refusing to write to ${PATHS.evidence}: `) && says.test(err.message),
      name,
    );
    assert.equal(readText(file), before, `${name}: the file was written`);
  }
});

test('a header over a delimiter row that GitHub makes no table of is named once, with the reason', () => {
  const [head, delimiter] = EVIDENCE_HEAD.split('\n');
  const cases = [
    ['a delimiter row indented four past the header', `${head}\n    ${delimiter}\n${eRow('E-01')}`, 3, /indented 4 or more spaces past the header/],
    ['a paragraph an earlier delimiter row ruled out', `a | b\n|---|---|---|\n${EVIDENCE_HEAD}\n${eRow('E-01')}`, 5, /an earlier delimiter row in the same paragraph/],
    ["a header straight below another table's rows", `| a | b |\n|---|---|\n| 1 | 2 |\n${EVIDENCE_HEAD}\n${eRow('E-01')}`, 6, /below the rows of another table \(line 3\)/],
  ];
  for (const [name, body, line, says] of cases) {
    const table = parseTable(`# Evidence\n\n${body}\n`, HEADERS.evidence);
    assert.equal(table.found, false, name);
    const named = splits(table);
    assert.equal(named.length, 1, `${name}: ${JSON.stringify(table.problems)}`);
    assert.equal(named[0].line, line, name);
    assert.match(named[0].detail, says, named[0].detail);
  }
});

// F-E: the separator test backtracked over a long delimiter-like line, and each row run on below a
// line that ended the table walked back to it, so both took time in the square of their length.
test('the reader takes linear time on long delimiter-like lines, rows run on below a culprit, and a long tag', () => {
  const evidence = `${EVIDENCE_HEAD}\n${eRow('E-01')}`;
  const rows = Array.from({ length: 16_000 }, (_, i) => eRow(`E-${i + 2}`)).join('\n');
  const cases = [
    ['40,000 characters of |- below a lone |', `|\n${'|-'.repeat(20_000)}x\n\n${evidence}`, 0],
    ['40,000 pipes below a lone |', `|\n${'|'.repeat(40_000)}x\n\n${evidence}`, 0],
    ['16,000 rows run on below a line that ended the table', `${evidence}\na | b\n${rows}`, 1],
    ['a tag of 50,000 attributes', `<a${' b'.repeat(50_000)} !\n\n${evidence}`, 0],
  ];
  for (const [name, body, problems] of cases) {
    const started = performance.now();
    const table = parseTable(`# Evidence\n\n${body}\n`, HEADERS.evidence);
    const ms = performance.now() - started;
    assert.deepEqual(table.rows.map((r) => r.ID), ['E-01'], name);
    assert.equal(table.problems.length, problems, `${name}: ${JSON.stringify(table.problems.slice(0, 2))}`);
    assert(ms < 2_000, `${name}: ${ms.toFixed(0)} ms - the reader is not linear`);
  }
});

// Re-review of 88fe19a (2026-11-07), F1: the reader stops at a row holding a carriage return alone,
// at a row at column 0 below an item's table and at one indented 4, while GitHub shows the rows
// below; the ids were counted over the rows read, so the writers issued an id the file already held,
// and placed the row above the ones they missed. The kit wrote such a carriage return itself.
test('a cell is written on one line, whatever line end it holds', () => {
  assert.equal(escapeCell('a\rb\r\nc\nd\r\r\ne'), 'a b c d  e');
  assert.equal(tableRow(['E-01', 'Pricing\rPlans']), '| E-01 | Pricing Plans |');
});

test('the writers refuse, writing nothing, where the reader stops above rows GitHub shows', () => {
  const [head, delimiter] = EVIDENCE_HEAD.split('\n');
  const cases = [
    ['a row at column 0 below a table in a list item', `- The rows:\n\n  ${head}\n  ${delimiter}\n  ${eRow('E-01')}\n${eRow('E-02')}`, 5, 8, /stands at a column where the list item/],
    ['a row indented 4 below the table', `${EVIDENCE_HEAD}\n${eRow('E-01')}\n    ${eRow('E-02')}`, 3, 6, /is indented 4 or more spaces past the table/],
    ['a row holding a carriage return alone', `${EVIDENCE_HEAD}\n${eRow('E-01')}\n${eRow('E-02').replace('a claim', 'a\rclaim')}\n${eRow('E-03')}`, 3, 6, /holds a carriage return alone/],
    ['a row after a blank line', `${EVIDENCE_HEAD}\n${eRow('E-01')}\n\n${eRow('E-02')}`, 3, 7, /stands after a blank line ended the table/],
    ['rows run on below a line of two cells', `${EVIDENCE_HEAD}\n${eRow('E-01')}\na | b\n${eRow('E-02')}`, 3, 6, /does not start with \|/],
  ];
  for (const [name, body, table, line, says] of cases) {
    const dir = makeProject();
    const file = resolve(dir, PATHS.evidence);
    writeText(file, `# Evidence\n\n${body}\n`);
    const before = readText(file);
    const refused = (err) => err.code === 'TABLE_HIDDEN' && err.message.startsWith(`refusing to write to ${PATHS.evidence}: `)
      && err.message.includes(`the table at line ${table} is not read whole - at line ${line}, `) && says.test(err.message);
    assert.throws(() => assertTablesWritable(dir), refused, `${name}: assertTablesWritable`);
    assert.throws(() => appendRow(dir, PATHS.evidence, HEADERS.evidence, eCells('E-02')), refused, `${name}: appendRow`);
    assert.equal(readText(file), before, `${name}: the file was written`);
  }

  // upsertRow refuses too: a source below the stop was appended again, and one above it replaced.
  const dir = makeProject();
  const file = resolve(dir, PATHS.sources);
  const sRow = (url) => tableRow([url, 'P', 'T', '2026-11-07', 'U-1']);
  writeText(file, `# Sources\n\n${tableRow(HEADERS.sources)}\n|${HEADERS.sources.map(() => '---').join('|')}|\n${sRow('https://a.invalid/')}\n`
    + `${sRow('https://b.invalid/').replace('| T |', '| Pricing\rPlans |')}\n${sRow('https://c.invalid/')}\n`);
  const before = readText(file);
  for (const url of ['https://c.invalid/', 'https://a.invalid/']) {
    assert.throws(
      () => upsertRow(dir, PATHS.sources, HEADERS.sources, [url, 'P', 'T2', '2026-11-08', 'U-1']),
      (err) => err.code === 'TABLE_HIDDEN' && /research\/SOURCES\.md: the table at line 3 is not read whole - at line 6, /.test(err.message),
      url,
    );
  }
  assert.throws(() => assertTablesWritable(dir), (err) => err.code === 'TABLE_HIDDEN');
  assert.equal(readText(file), before, 'the file was written');
});

// F2: GitHub moves a footnote definition something refers to to the end of the page, so a table in
// it stands below the body's; the reader took the first table in the file, and preflight passed.
test("a table in a footnote is read only when the body holds none, as GitHub shows footnotes below the body", () => {
  const note = '[^old]: The first contract, kept for the record:';
  const cases = [
    ['a blank line above the footnote\'s table', `The contract was narrowed on 2026-11-01.[^old]\n\n${note}\n\n${padBy(4, ARCHIVED)}`],
    ["the footnote's table straight below its first line", `The contract was narrowed on 2026-11-01.[^old]\n\n${note}\n${padBy(4, ARCHIVED)}`],
    ['a footnote that interrupts the paragraph', `The contract was narrowed on 2026-11-01.[^old]\n${note}\n\n${padBy(4, ARCHIVED)}`],
  ];
  for (const [name, above] of cases) assert.deepEqual(statuses(contract(above)), [['U-1', 'OPEN']], name);
  // A label defined twice: GitHub keeps the first definition and drops the second, with all it holds.
  const twice = `# Discovery\n\n## Unknowns\n\nThe contract was narrowed on 2026-11-01.[^old]\n\n[^old]: Narrowed to one unknown.\n\n${note}\n\n${padBy(4, ARCHIVED)}\n`;
  assert.deepEqual(statuses(twice), [], 'the table in a second definition of a label was read');
  // Of a label's definitions it keeps the first to end: one nested in another ends before it.
  const nested = `# Discovery\n\n## Unknowns\n\nThe contract was narrowed on 2026-11-01.[^old]\n\n${note}\n\n${padBy(4, ARCHIVED)}\n\n    [^old]: Narrowed to one unknown.\n`;
  assert.deepEqual(statuses(nested), [], 'the table in the definition holding the kept one was read');

  const dir = makeProject();
  const file = resolve(dir, PATHS.discovery);
  writeText(file, contract(cases[0][1]));
  appendRow(dir, PATHS.discovery, HEADERS.unknowns, ['U-2', 'q', 'w', 'OPEN', '']);
  const text = readText(file);
  assert(text.includes(padBy(4, ARCHIVED)), `the footnote's table was written into:\n${text}`);
  assert.deepEqual(statuses(text), [['U-1', 'OPEN'], ['U-2', 'OPEN']]);

  const pass = makePassingProject();
  corrupt(pass, PATHS.discovery, hideAbove((table) => `The contract was narrowed on 2026-11-01.[^old]\n\n${note}\n\n${padBy(4, table)}`));
  assert.deepEqual(readCorpus(pass).unknowns.map((u) => [u.id, u.status]), [['U-1', 'OPEN']]);
  assert.equal(runPreflight(pass).pass, false, 'a visible OPEN unknown passed preflight');
});

// F3: a `<!--` after the `-->` that ends an HTML block reopens the comment in the browser, and only a
// `-->` GitHub passes through raw - an HTML block's - closes it; in a paragraph it is escaped. The
// reader closed the comment at a `-->` on any line.
test('a comment reopened after its `-->` is closed only by a `-->` in an HTML block', () => {
  const r1 = `<!-- a --> <!-- b\n\n-->\n\n${ARCHIVED}\n\n<!-- -->`;
  const r2 = `<!-- a --> <!-- b\n-->\n\n${ARCHIVED}\n\n<!-- -->`;
  for (const [name, above] of [['a blank line above the paragraph', r1], ['none', r2]]) {
    assert.deepEqual(statuses(contract(above)), [['U-1', 'OPEN']], name);
  }
  // Never closed, the comment hides the rest of the file: the table is named, and the writer refuses.
  const open = contract('<!-- a --> <!-- b\nArchived.\n-->');
  const table = parseTable(open, HEADERS.unknowns);
  assert.equal(table.found, false);
  const named = splits(table);
  assert.equal(named.length, 1, JSON.stringify(table.problems));
  assert.equal(named[0].line, 9);
  assert.match(named[0].detail, /is hidden on GitHub: an HTML comment reopened at line 5 by a `<!--` after its `-->` is never closed/, named[0].detail);
  const dir = makeProject();
  const file = resolve(dir, PATHS.discovery);
  writeText(file, open);
  assert.throws(
    () => appendRow(dir, PATHS.discovery, HEADERS.unknowns, ['U-2', 'q', 'w', 'OPEN', '']),
    (err) => err.code === 'TABLE_HIDDEN' && /the file ends inside an HTML comment reopened at line 5 by a `<!--` after its `-->` and is never closed/.test(err.message),
  );
  assert.equal(readText(file), open, 'the file was written');
});

// F4: nested footnote definitions nothing refers to were each marked line by line, so the reading
// took time in the number of definitions times the lines they hold.
test('the reader takes linear time on nested footnote definitions nothing refers to', () => {
  const lines = [];
  let label = 0;
  for (let k = 0; k < 80; k += 1) {
    let line = '\t'.repeat(90 * k);
    for (let j = 0; j < 90; j += 1) line += `[^n${label++}]: `;
    lines.push(`${line}z`);
  }
  const text = `${lines.join('\n')}\n${'z\n'.repeat(200_000)}\n${liveTable('OPEN')}\n`;
  const started = performance.now();
  const read = statuses(text);
  const ms = performance.now() - started;
  assert.deepEqual(read, [['U-1', 'OPEN']]);
  assert(ms < 2_000, `${ms.toFixed(0)} ms - the reader is not linear`);
});

// F5 and F6: a header GitHub reads as more of a paragraph is named with what holds that paragraph,
// and a lazy header's leading space - an empty first cell on GitHub - is named as that, not as a
// count whose remedy gave a table shifted one column.
test("a lazy header is named with the block that holds its paragraph, and with the leading space GitHub reads as a cell", () => {
  const [head, delimiter] = U_TABLE.split('\n');
  const item = (delim) => `# Discovery\n\n## Unknowns\n\n- Item text\n ${head}\n  ${delim}\n  ${uRow('U-1', 'OPEN')}\n`;
  for (const delim of [delimiter, `${delimiter}---|`]) {
    const table = parseTable(item(delim), HEADERS.unknowns);
    assert.equal(table.found, false, delim);
    const named = splits(table);
    assert.equal(named.length, 1, JSON.stringify(table.problems));
    assert.equal(named[0].line, 6);
    assert.match(named[0].detail, /its header stands below a list item's paragraph with less indentation than its content, so GitHub reads it as more of that paragraph, and its leading space as an empty first cell - indent the header as the delimiter row is$/, named[0].detail);
  }

  const footnote = parseTable(`# Discovery\n\n## Unknowns\n\nSee.[^n]\n\n[^n]: Some text\n${liveTable('OPEN')}\n`, HEADERS.unknowns);
  assert.equal(footnote.found, false);
  const named = splits(footnote);
  assert.equal(named.length, 1, JSON.stringify(footnote.problems));
  assert.equal(named[0].line, 8);
  assert.match(named[0].detail, /stand below a footnote definition's paragraph with less indentation than its content \(4 spaces\), so GitHub reads them as more of that paragraph - put a blank line above it, or indent it 4 spaces to keep it in the footnote$/, named[0].detail);
});

// A `.source.html` under raw/ that no ledger entry names is a planted file, not a source.
test('a source sibling no ledger entry names is a corpus problem', () => {
  const dir = makePassingProject();
  writeText(resolve(dir, `${PATHS.raw}/2026-10-03-planted.source.html`), '<html>planted</html>');
  const problems = readCorpus(dir).problems.filter((p) => p.kind === 'source-unnamed');
  assert.equal(problems.length, 1, JSON.stringify(readCorpus(dir).problems));
  assert.match(problems[0].detail, /planted\.source\.html/);
});

test('a plan that will not parse is reported, never absorbed', () => {
  const dir = makePassingProject();
  writeText(resolve(dir, PATHS.plan), '{ not json');
  const corpus = readCorpus(dir);
  assert.equal(corpus.plan, null);
  assert.ok(corpus.problems.some((p) => p.kind === 'plan-unparsed'));
});

// Found 2026-09-27: a research/kit.json that did not parse raised nothing. The gate read it as
// absent and fell back to the default code paths, so the paths the operator declared stopped
// being guarded, silently.
test('a kit.json that will not parse is reported, and blocks like a broken plan', async () => {
  const dir = makePassingProject();
  writeText(resolve(dir, PATHS.kit), '{ "architecture": { "codePaths": ["engine"] }, }');
  assert.ok(readCorpus(dir).problems.some((p) => p.kind === 'kit-unparsed'), 'no problem recorded');
  const { runPreflight } = await import('../lib/preflight.mjs');
  const verdict = runPreflight(dir);
  assert.equal(verdict.pass, false, 'preflight passed with the gate configuration unreadable');
  assert.ok(verdict.failures.some((f) => f.rule === 'kit-unparsed'), JSON.stringify(verdict.failures.map((f) => f.rule)));
});

// Found 2026-09-27: a plan or kit.json saved by Windows Notepad starts with a byte-order mark,
// and was reported as not parsing - with the mark, invisible, quoted as the bad token.
test('a plan and a kit.json saved with a byte-order mark parse', () => {
  const dir = makePassingProject();
  writeText(resolve(dir, PATHS.plan), `\uFEFF${JSON.stringify({ topic: 'bom', queries: [{ q: 'a query' }] })}`);
  writeText(resolve(dir, PATHS.kit), `\uFEFF${JSON.stringify({ architecture: { codePaths: ['engine'] } })}`);
  const corpus = readCorpus(dir);
  assert.deepEqual(corpus.problems.filter((p) => /unparsed/.test(p.kind)), []);
  assert.equal(corpus.plan?.topic, 'bom');
});

test('sectionOf reads one heading\'s body and stops at the next heading of its level', () => {
  const text = '# Title\n\n## Build intent\n\nthe intent\n\n### deeper\n\nstill inside\n\n## Unknowns\n\nnot this\n';
  assert.match(sectionOf(text, 'Build intent'), /the intent/);
  assert.match(sectionOf(text, 'Build intent'), /still inside/);
  assert.doesNotMatch(sectionOf(text, 'Build intent'), /not this/);
});

test('citedIds finds every id in a free-text cell', () => {
  assert.deepEqual(citedIds('E-01: proven, see also U-2 and D-9'), ['E-01', 'U-2', 'D-9']);
});

test('appendRow creates the table when it is absent, and appends to it when it is not', () => {
  const dir = makeProject();
  appendRow(dir, PATHS.evidence, HEADERS.evidence, ['E-01', '2026-01-01', 'P', 'https://x.invalid', 'a claim', 'research/raw/a.md']);
  appendRow(dir, PATHS.evidence, HEADERS.evidence, ['E-02', '2026-01-02', 'P', 'https://y.invalid', 'another', 'research/raw/b.md']);
  const rows = parseTable(readText(resolve(dir, PATHS.evidence)), HEADERS.evidence).rows;
  assert.deepEqual(rows.map((r) => r.ID), ['E-01', 'E-02']);
});

test('upsertRow replaces by first cell rather than growing a duplicate', () => {
  const dir = makeProject();
  upsertRow(dir, PATHS.sources, HEADERS.sources, ['https://x.invalid', 'P', 'Title', '2026-01-01', 'U-1']);
  upsertRow(dir, PATHS.sources, HEADERS.sources, ['https://x.invalid', 'P', 'Better title', '2026-02-01', 'U-1, U-2']);
  const rows = parseTable(readText(resolve(dir, PATHS.sources)), HEADERS.sources).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Title, 'Better title');
});

test('nextId continues the sequence it is shown', () => {
  assert.equal(nextId('E', []), 'E-01');
  assert.equal(nextId('E', [{ id: 'E-01' }, { id: 'E-09' }]), 'E-10');
  assert.equal(nextId('U', [{ id: 'U-3' }]), 'U-04');
});

test('stripReviewNotes removes the note and nothing else', () => {
  assert.equal(stripReviewNotes('E-01 [single-witness: see E-02]').includes('E-02'), false);
  assert.equal(citedIds(stripReviewNotes('E-01 [single-witness: see E-02]')).join(), 'E-01');
  assert.equal(citedIds(stripReviewNotes('E-01 and E-02')).join(), 'E-01,E-02');
  assert.equal(stripReviewNotes('a [markdown](http://x) link'), 'a [markdown](http://x) link');
});

// Found 2026-09-28 (checking an outside break-test, F-07): a large file in research/raw/
// crashed every corpus reader with a raw "RangeError: Set maximum size exceeded" from the
// similarity sketch after a minute (100 MB), or was skipped in silence because it could not
// be read as a string at all (600 MB) - and the gate passed. A capture over the limit is now
// named, blocking, and never read.
test('a capture over the size limit is named and blocks, without being read', () => {
  const root = makePassingProject();
  const big = resolve(root, `${PATHS.raw}/huge.md`);
  fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024, 'a'));
  const started = Date.now();
  const corpus = readCorpus(root);
  assert.ok(Date.now() - started < 5000, 'the oversized capture was read');
  const problem = corpus.problems.find((p) => p.kind === 'capture-too-large');
  assert.ok(problem, `no capture-too-large problem: ${JSON.stringify(corpus.problems)}`);
  assert.equal(problem.file, `${PATHS.raw}/huge.md`);
  assert.equal(corpus.captures.entries.some((e) => e.file.endsWith('huge.md')), false);
  const verdict = runPreflight(root);
  assert.ok(verdict.findings.some((f) => f.severity === 'fail' && f.rule === 'capture-too-large'), 'the gate did not block on it');
});

// Found 2026-09-28 while verifying the capture-unreadable case as uid nobody: a capture the
// ledger names but that cannot be read (permissions; here a directory in its place, which
// fails the same way for root) crashed preflight with a raw stack trace in verifyLedger.
test('a ledger-named capture that cannot be read is a named failure, not a crash', () => {
  const root = makePassingProject();
  const capture = fs.readdirSync(resolve(root, PATHS.raw)).find((n) => n.endsWith('.md'));
  const abs = resolve(root, `${PATHS.raw}/${capture}`);
  fs.rmSync(abs);
  fs.mkdirSync(abs);
  let verdict;
  assert.doesNotThrow(() => { verdict = runPreflight(root); }, 'preflight crashed on an unreadable capture');
  assert.equal(verdict.pass, false);
  assert.ok(verdict.findings.some((f) => f.severity === 'fail' && /could not be read/.test(f.detail ?? '')),
    `no finding names the unreadable capture:\n${verdict.findings.filter((f) => f.severity === 'fail').map((f) => `${f.rule}: ${f.detail}`).join('\n')}`);
});

// Found 2026-09-28 (Arena break test 12). A file with NO END - a fifo, a socket, a
// character device such as dev/zero - is refused by name instead of being opened.
//
// Before this, `readFileSync` was called on whatever sat at the path the ledger names.
// On a fifo that blocks in `open()` until another process writes to the other end, so
// every entrypoint that verifies a corpus - handoff, preflight, audit, doctor, brief and
// the commit gate - HUNG, printing nothing at all; the git commit it gates hung with it.
// With the ledger symlinked to dev/zero the same call allocated until libstdc++ killed
// the process with `std::bad_alloc` / SIGABRT, which is a crash disguised as a verdict.
//
// A fifo can only be made on POSIX, so where it cannot the test falls back to a
// directory: also not a regular file, so it exercises the same guard. It does NOT skip -
// a test that returns early on a missing prerequisite is a green that asserted nothing.
test('a capture that is not a regular file is refused by name, and is never opened', () => {
  const root = makePassingProject();
  const capture = fs.readdirSync(resolve(root, PATHS.raw)).find((n) => n.endsWith('.md'));
  const abs = resolve(root, `${PATHS.raw}/${capture}`);
  fs.rmSync(abs);
  const fifo = process.platform !== 'win32'
    && spawnSync('mkfifo', [abs], { windowsHide: true }).status === 0;
  if (!fifo) fs.mkdirSync(abs);

  // Watchdog-guarded by the harness: with the guard gone this call blocks until the
  // watchdog fires, which is a FAIL named for this test rather than a silent hang.
  const verdict = runPreflight(root);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.findings.some((f) => f.severity === 'fail' && f.rule === 'raw-unreadable'
    && /could not be read/.test(f.detail ?? '')),
  `no finding names the capture that has no end (${fifo ? 'fifo' : 'directory'}):\n${verdict.findings.filter((f) => f.severity === 'fail').map((f) => `${f.rule}: ${f.detail}`).join('\n')}`);
});

// The same guard, at the two functions every other read in the kit goes through. A
// directory is the cross-platform case: it is not a regular file, so it is refused
// WITHOUT being opened - which is the whole point, because the open is what blocked.
test('readText and sha256File refuse what is not a regular file, without opening it', () => {
  const root = makePassingProject();
  const dir = resolve(root, 'research/raw/a-directory');
  fs.mkdirSync(dir);
  assert.equal(isRegularFile(dir), false, 'a directory is not a regular file');
  assert.equal(isRegularFile(resolve(root, 'research/raw/') + 'no-such-file'), false);
  assert.equal(readText(dir, 'FALLBACK'), 'FALLBACK', 'readText opened a directory');
  assert.equal(sha256File(dir), null, 'sha256File opened a directory');

  const capture = fs.readdirSync(resolve(root, PATHS.raw)).find((n) => n.endsWith('.md'));
  const abs = resolve(root, `${PATHS.raw}/${capture}`);
  assert.equal(isRegularFile(abs), true, 'a capture is a regular file');
  assert.equal(typeof readText(abs), 'string', 'readText must still read a real capture');
  assert.match(sha256File(abs) ?? '', /^[0-9a-f]{64}$/, 'sha256File must still hash a real capture');

  // A symlink to a regular file is still a regular file: following links is deliberate,
  // so refusing them here would be a behaviour change for every caller that resolves one.
  const link = resolve(root, 'research/raw/linked.md');
  requireSymlink(abs, link, 'a symlink to a regular file');
  assert.equal(isRegularFile(link), true, 'a symlink to a regular file is a regular file');
  assert.equal(readText(link), readText(abs));
});

// Found 2026-09-28 (checking an outside break-test, F-08): JSON.parse keeps the LAST of two
// equal keys, so `{"topic":"a", ..., "topic":"b"}` in plan.json - a merge, a paste - lost the
// first value in silence. A duplicate key in plan.json or kit.json now blocks, naming the key.
test('a duplicate key in plan.json or kit.json is named and blocks', () => {
  for (const [file, kind] of [[PATHS.plan, 'plan-unparsed'], [PATHS.kit, 'kit-unparsed']]) {
    const root = makePassingProject();
    const abs = resolve(root, file);
    const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').trim() : '{}';
    fs.writeFileSync(abs, text.replace(/^\{/, '{"topic": "the first one", ').replace(/\}$/, ', "topic": "the second one"}'));
    const problem = readCorpus(root).problems.find((p) => p.kind === kind);
    assert.ok(problem, `${file}: no ${kind} problem for a duplicate key`);
    assert.match(problem.detail, /duplicate.*"topic"/, `${file}: ${problem.detail}`);
    assert.equal(runPreflight(root).pass, false, `${file}: the gate passed with a duplicate key`);
  }
});
