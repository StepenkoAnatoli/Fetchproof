// Read-only FI workbook/sidecar/manifest adapter tests.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { test, describe, assert, assertEqual, cleanup, tempDir } from './harness.mjs';
import { rawZip } from './artifact-fixtures.mjs';
import { readFiWorkbookProjection } from '../lib/fi-validator.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('fi-validator-adapter');
import { createSyntheticFiEvidenceBundle, syntheticFiWorkbookProjection } from './fi-e2e-bundle.mjs';

test('FI adapter validates a complete 30-case sidecar/manifest bundle using actual evidence bytes', async () => {
  const input = createSyntheticFiEvidenceBundle({ workbookMode: 'opaque' });
  try {
    const { validateFiBundle } = await import('../lib/fi-validator.mjs');
    const result = validateFiBundle({ ...input, workbookProjection: syntheticFiWorkbookProjection() });
    assertEqual(result.status, 'PASS', JSON.stringify(result));
    assertEqual(result.cases.length, 30);
  } finally { cleanup(input.root); }
});

test('FI adapter rejects a manifest entry whose declared hash does not match its contained bytes', async () => {
  const input = createSyntheticFiEvidenceBundle({ workbookMode: 'opaque', tamperEvidenceId: 'FI-12-status' });
  try {
    const { validateFiBundle } = await import('../lib/fi-validator.mjs');
    const result = validateFiBundle({ ...input, workbookProjection: syntheticFiWorkbookProjection() });
    assertEqual(result.status, 'FAIL', JSON.stringify(result));
    assert(result.errors.some((error) => error.code === 'EVIDENCE-HASH'), JSON.stringify(result.errors));
  } finally { cleanup(input.root); }
});

test('FI adapter classifies a missing required manifest as INCOMPLETE', async () => {
  const input = createSyntheticFiEvidenceBundle({ workbookMode: 'opaque' });
  try {
    fs.unlinkSync(input.manifest);
    const { validateFiBundle } = await import('../lib/fi-validator.mjs');
    const result = validateFiBundle({ ...input, workbookProjection: syntheticFiWorkbookProjection() });
    assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
    assert(result.errors.some((error) => error.code === 'MANIFEST-READ' && error.status === 'INCOMPLETE'), JSON.stringify(result.errors));
  } finally { cleanup(input.root); }
});

test('FI adapter rejects an Index/case disposition disagreement and applies reopen precedence', async () => {
  const input = createSyntheticFiEvidenceBundle({ workbookMode: 'opaque', statuses: { 'FI-03': 'REOPEN' } });
  try {
    const { validateFiBundle } = await import('../lib/fi-validator.mjs');
    const projection = syntheticFiWorkbookProjection({ 'FI-03': 'REOPEN' }); projection.indexStatuses['FI-03'] = 'PASS';
    const result = validateFiBundle({ ...input, workbookProjection: projection });
    assertEqual(result.status, 'REOPEN', JSON.stringify(result));
    assert(result.errors.some((error) => error.code === 'FI-INDEX-MISMATCH'), JSON.stringify(result.errors));
  } finally { cleanup(input.root); }
});

test('researcher-release fi-validate is read-only and emits a deterministic JSON report', () => {
  const input = createSyntheticFiEvidenceBundle({ workbookMode: 'opaque' });
  try {
    const before = fs.readFileSync(input.workbook);
    const run = spawnSync(process.execPath, ['research-kit/bin/researcher-release.mjs', 'fi-validate', '--root', input.root, '--workbook', input.workbook, '--records', input.recordsDir, '--manifest', input.manifest, '--json'], { encoding: 'utf8' });
    assertEqual(run.status, 1, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert(report.errors.some((error) => error.code === 'WB-PACKAGE-UNTRUSTED'), JSON.stringify(report));
    assertEqual(Buffer.compare(before, fs.readFileSync(input.workbook)), 0, 'CLI must not mutate the workbook');
  } finally { cleanup(input.root); }
});

// Found 2026-09-30: a --report path the environment refuses (here a folder) crashed with a
// Node stack trace and exit 1 - this command's code for FAIL, so a caller was told the
// evidence failed when the disk had refused the report. It is named and exits 2 now.
test('researcher-release fi-validate names a refused --report write and exits 2, with no stack', () => {
  const input = createSyntheticFiEvidenceBundle({ workbookMode: 'opaque' });
  try {
    const report = `${input.root}/report-is-a-folder`;
    fs.mkdirSync(report);
    const run = spawnSync(process.execPath, ['research-kit/bin/researcher-release.mjs', 'fi-validate', '--root', input.root,
      '--workbook', input.workbook, '--records', input.recordsDir, '--manifest', input.manifest, '--report', report], { encoding: 'utf8' });
    assertEqual(run.status, 2, `${run.stderr.slice(0, 300)}`);
    assert(/could not write/.test(run.stderr), run.stderr.slice(0, 300));
    assert(!/^\s+at .+:\d+:\d+\)?$/m.test(run.stderr), `a stack trace was printed:\n${run.stderr.slice(0, 500)}`);
  } finally { cleanup(input.root); }
});

// #318: the workbook reader inflated every entry with no output bound, no ratio check and no
// check that an entry lay inside the file - a 1 MB workbook holding 1 GiB of zeros took 15 s
// and 3 GB before V8's string limit stopped it, where artifact-zip.mjs refuses the same file
// from its central directory. The bombs are built from repeated sync-flushed deflate blocks,
// so the test never holds the size it declares.
function zerosDeflated(mib) {
  const block = zlib.deflateRawSync(Buffer.alloc(1024 * 1024), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  return Buffer.concat([...Array(mib).fill(block), Buffer.from([0x03, 0x00])]);   // + an empty final block
}
function workbookProjectionOf(bytes) {
  const dir = tempDir('rk-fi-bomb-');
  try {
    const file = path.join(dir, 'completed.xlsx');
    fs.writeFileSync(file, bytes);
    const errors = [];
    const started = Date.now();
    const projection = readFiWorkbookProjection(file, errors);
    return { projection, errors, elapsed: Date.now() - started };
  } finally { cleanup(dir); }
}

test('#318 a workbook entry over the per-entry ceiling is refused as WB-PACKAGE-UNTRUSTED before it is inflated', () => {
  const size = 256 * 1024 * 1024;
  const r = workbookProjectionOf(rawZip([{ name: 'xl/workbook.xml', deflated: zerosDeflated(256), declareSize: size }]));
  assertEqual(r.projection, null);
  assert(r.errors.some((e) => e.code === 'WB-PACKAGE-UNTRUSTED' && /per-entry limit/.test(e.message)), JSON.stringify(r.errors));
  assert(r.elapsed < 2000, `took ${r.elapsed} ms - the entry was inflated before it was judged`);
});

test('#318 a workbook entry expanding 1000:1 is refused by its ratio, from the central directory', () => {
  const deflated = zerosDeflated(4);
  const r = workbookProjectionOf(rawZip([{ name: 'xl/workbook.xml', deflated, declareSize: 4 * 1024 * 1024 }]));
  assert(r.errors.some((e) => e.code === 'WB-PACKAGE-UNTRUSTED' && /ZIP-RATIO-LIMIT/.test(e.message) && /200:1/.test(e.message)), JSON.stringify(r.errors));
});

test('#318 a workbook entry whose declared size lies is stopped mid-inflate, not expanded whole', () => {
  const r = workbookProjectionOf(rawZip([{ name: 'xl/workbook.xml', deflated: zerosDeflated(256), declareSize: 1000 }]));
  assert(r.errors.some((e) => e.code === 'WB-PACKAGE-UNTRUSTED' && /xl\/workbook\.xml/.test(e.message)), JSON.stringify(r.errors));
  assert(r.elapsed < 2000, `took ${r.elapsed} ms - the entry was inflated past its declared size`);
});

test('#318 a truncated workbook (an entry running past the end of the file) is refused, not read as short sheets', () => {
  const bytes = rawZip([{ name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="Index" sheetId="1"/></sheets></workbook>' }]);
  const directory = bytes.readUInt32LE(bytes.length - 22 + 16);
  bytes.writeUInt32LE(bytes.length * 2, directory + 20);    // the entry's compressed size, past the end
  const r = workbookProjectionOf(bytes);
  assertEqual(r.projection, null);
  assert(r.errors.some((e) => e.code === 'WB-PACKAGE-UNTRUSTED' && /past the end of the file/.test(e.message)), JSON.stringify(r.errors));
});

test('#318 a well-formed workbook still projects its sheets and statuses through the bounded reader', () => {
  const input = createSyntheticFiEvidenceBundle({ statuses: { 'FI-07': 'FAIL' } });
  try {
    const errors = [];
    const projection = readFiWorkbookProjection(input.workbook, errors);
    assertEqual(errors.length, 0, JSON.stringify(errors));
    assertEqual(projection.sheets.length, 32);
    assertEqual(projection.caseStatuses['FI-07'], 'FAIL');
    assertEqual(projection.indexStatuses['FI-07'], 'FAIL');
    assertEqual(projection.rollupStatuses['FI-30'], 'PASS');
  } finally { cleanup(input.root); }
});

// #318 review: the projection inflated and parsed a sheet once per <sheet> reference, so a
// workbook.xml naming one 1 MiB sheet hundreds of times turned a 1.4 KB file into minutes of
// CPU, past every byte bound. A workbook with the wrong sheet count is now refused before any
// sheet is read (validateFiBundle fails it as WB-SHEET-ID), and each sheet is read at most once.
function sheetBomb(refs, { names = (i) => `s${i}` } = {}) {
  const cell = '<c r="A1" t="inlineStr"><is><t>x</t></is></c>';
  const sheet = `<worksheet><sheetData><row r="1">${cell.repeat(Math.floor((1024 * 1024 - 64) / cell.length))}</row></sheetData></worksheet>`;
  const workbook = `<workbook><sheets>${Array.from({ length: refs }, (_, i) => `<sheet name="${names(i)}" sheetId="1"/>`).join('')}</sheets></workbook>`;
  return rawZip([{ name: 'xl/workbook.xml', data: workbook, deflate: true }, { name: 'xl/worksheets/sheet1.xml', data: sheet, deflate: true }]);
}

test('#318 a workbook naming one large sheet 500 times is refused by its sheet count before any sheet is parsed', async () => {
  const r = workbookProjectionOf(sheetBomb(500));
  assert(r.elapsed < 2000, `took ${r.elapsed} ms - the sheet was parsed once per reference`);
  assertEqual(r.projection.sheets.length, 500);
  const input = createSyntheticFiEvidenceBundle({ workbookMode: 'opaque' });
  try {
    const { validateFiBundle } = await import('../lib/fi-validator.mjs');
    const result = validateFiBundle({ ...input, workbookProjection: r.projection });
    assert(result.errors.some((e) => e.code === 'WB-SHEET-ID'), JSON.stringify(result.errors.slice(0, 3)));
  } finally { cleanup(input.root); }
});

test('#318 a sheet referenced by every one of the 32 names is inflated and parsed once', () => {
  const r = workbookProjectionOf(sheetBomb(32, { names: (i) => ['Index', 'Roll-up', ...Array.from({ length: 30 }, (_, n) => `FI-${String(n + 1).padStart(2, '0')}`)][i] }));
  assertEqual(r.errors.length, 0, JSON.stringify(r.errors));
  assertEqual(r.projection.sheets.length, 32);
  assert(r.elapsed < 2000, `took ${r.elapsed} ms - the sheet was read once per reference`);
});

// #318 review: every pattern the projection read XML with - the cell, its <v> and <t>, the
// shared string and its <t>, the <sheet> tag - rescanned to the end of the text for each
// opening that had no closing, so 256 KiB of `<c a>` (an 871-byte file) took 55 s and 1 MiB
// about 15 minutes, below every byte bound. Each is a linear scan now.
const FI_SHEET_NAMES = ['Index', 'Roll-up', ...Array.from({ length: 30 }, (_, n) => `FI-${String(n + 1).padStart(2, '0')}`)];
function namedWorkbook(entries) {
  const workbook = `<workbook><sheets>${FI_SHEET_NAMES.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}"/>`).join('')}</sheets></workbook>`;
  return rawZip([{ name: 'xl/workbook.xml', data: workbook, deflate: true }, ...entries.map((e) => ({ ...e, deflate: true }))]);
}
const KIB256 = (unit) => unit.repeat(Math.floor((256 * 1024) / unit.length));
for (const [label, bytes] of [
  ['an unclosed <c> in a sheet', () => namedWorkbook([{ name: 'xl/worksheets/sheet1.xml', data: KIB256('<c a>') }])],
  ['an unclosed <v> in one cell', () => namedWorkbook([{ name: 'xl/worksheets/sheet1.xml', data: `<c r="A1">${KIB256('<v>')}</c>` }])],
  ['an unclosed <t> in one cell', () => namedWorkbook([{ name: 'xl/worksheets/sheet1.xml', data: `<c r="A1">${KIB256('<t>')}</c>` }])],
  ['an unclosed <si> in the shared strings', () => namedWorkbook([{ name: 'xl/sharedStrings.xml', data: KIB256('<si>') }])],
  ['an unclosed <t> in one shared string', () => namedWorkbook([{ name: 'xl/sharedStrings.xml', data: `<si>${KIB256('<t>')}</si>` }])],
  ['an unclosed <sheet> tag', () => rawZip([{ name: 'xl/workbook.xml', data: KIB256('<sheet '), deflate: true }])],
  ['a <sheet> tag of names with no sheetId', () => rawZip([{ name: 'xl/workbook.xml', data: `<sheet ${KIB256('name="a" ')}>`, deflate: true }])],
]) {
  test(`#318 ${label} (256 KiB) is read in linear time`, () => {
    const r = workbookProjectionOf(bytes());
    assertEqual(r.errors.length, 0, JSON.stringify(r.errors));
    assert(r.elapsed < 1000, `took ${r.elapsed} ms`);
  });
}

// The scans must match exactly what the expressions they replaced matched, but for a tag ending
// in `/>` - an empty element, where the old expressions ran on to the next closing tag; the
// oracle says so with `(?<=\/>)`. A fuzz over the tokens those expressions turn on, deterministic
// so a failure reproduces.
test('#318 the linear XML scans match the regular expressions they replaced, on fuzzed input', async () => {
  const { xmlElements, xmlSheetTags } = await import('../lib/fi-validator.mjs');
  const TOKENS = ['<c', '<c ', '<x:c ', '<ab:c\t', '<c>', '<cc ', '</c>', '</x:c>', '</c ', '<v>', '</v>', '<x:v>', '</x:v>', '<v a>',
    '<t>', '<t a>', '<tt>', '</t>', '<x:t>', '<si>', '<si a>', '<sis>', '</si>', '<x:si>', '<sheet', '<sheet ', '<sheets ', '<x:sheet ',
    '<sheet>', 'name="', 'name="a"', 'name=""', 'sheetId="', 'sheetId="12"', 'sheetId=""', '"', '>', '<', '</', ' ', 'a', '1', ':', '/', 'r="A1"', 't="s"',
    '<sheet name="a" sheetId="1"/>', ' name="b>c" sheetId="2" ', '<c r="A1" t="s"><v>3</v></c>', '<c r="B2"/>', '<si><t>x</t></si>', 'name="b"', 'sheetId="7"', '<sheet name="d" ', '/>', '<si/>', '<t/>', '<x:c r="A1"/>', '<c r="C3" s="1" />'];
  let seed = 318;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed >>> 12; };   // the high bits: an LCG's low bits cycle
  const all = (re, xml, pick) => [...xml.matchAll(re)].map(pick);
  for (let n = 0; n < 4000; n += 1) {
    const xml = Array.from({ length: next() % 24 }, () => TOKENS[next() % TOKENS.length]).join('');
    const same = (label, a, b) => assertEqual(JSON.stringify(b), JSON.stringify(a), `${label} differs on ${JSON.stringify(xml)}`);
    same('c', all(/<(?:\w+:)?c\s+([^>]*)>(?:(?<=\/>)|([\s\S]*?)<\/(?:\w+:)?c>)/g, xml, (m) => [m[1], m[2] ?? '']), [...xmlElements(xml, 'c', 'space')].map((e) => [e.attrs, e.body]));
    same('si', all(/<(?:\w+:)?si\b[^>]*>(?:(?<=\/>)|([\s\S]*?)<\/(?:\w+:)?si>)/g, xml, (m) => m[1] ?? ''), [...xmlElements(xml, 'si', 'boundary')].map((e) => e.body));
    same('t', all(/<(?:\w+:)?t[^>]*>(?:(?<=\/>)|([\s\S]*?)<\/(?:\w+:)?t>)/g, xml, (m) => m[1] ?? ''), [...xmlElements(xml, 't', 'any')].map((e) => e.body));
    same('v', all(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/g, xml, (m) => m[1]), [...xmlElements(xml, 'v', 'none')].map((e) => e.body));
    same('sheet', all(/<(?:\w+:)?sheet\b[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"[^>]*>/g, xml, (m) => [m[1], m[2]]), [...xmlSheetTags(xml)].map((t) => [t.name, t.sheetId]));
  }
});

// A styled empty cell is written self-closing - `<c r="G5" s="1"/>` - and the cell pattern took
// it for an opening: it ran to the NEXT cell's `</c>`, so G5 took H5's value and H5, the Index
// status, read as missing. A tag ending in `/>` is an empty element.
test('#318 a self-closing empty cell projects as empty and does not consume the next cell', () => {
  const index = `<worksheet><sheetData><row r="5"><c r="G5" s="1"/><c r="H5" t="inlineStr"><is><t>PASS</t></is></c></row>`
    + `<row r="6"><x:c r="G6"/><c r="H6"><v>FAIL</v></c></row></sheetData></worksheet>`;
  const shared = '<sst><si/><si><t>REOPEN</t></si></sst>';
  const rollup = '<worksheet><sheetData><row r="23"><c r="A23" s="2"/><c r="B23" t="s"><v>0</v></c><c r="B24" t="s"><v>1</v></c></row></sheetData></worksheet>';
  const r = workbookProjectionOf(namedWorkbook([
    { name: 'xl/worksheets/sheet1.xml', data: index },
    { name: 'xl/worksheets/sheet2.xml', data: rollup },
    { name: 'xl/sharedStrings.xml', data: shared },
  ]));
  assertEqual(r.errors.length, 0, JSON.stringify(r.errors));
  assertEqual(r.projection.indexStatuses['FI-01'], 'PASS', 'H5 was consumed by the self-closing G5 before it');
  assertEqual(r.projection.indexStatuses['FI-02'], 'FAIL', 'H6 was consumed by the self-closing x:G6 before it');
  // `<si/>` is shared string 0, empty, and does not take the next string's text.
  assertEqual(r.projection.rollupStatuses['FI-01'], null);
  assertEqual(r.projection.rollupStatuses['FI-02'], 'REOPEN');
});
