// ADR-0090: the corpus exported as WARC 1.1, a copy for archive tools.
// Research: docs/decisions/2026-09-28-warc-export.

import { test, describe, assert, makePassingProject, tempDir, corrupt, requireGit, fixtureInitArgs } from './harness.mjs';
import { PATHS, sha256 } from '../lib/core.mjs';
import { readLedger } from '../lib/corpus.mjs';
import { exportWarc, readWarc } from '../lib/warc.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

describe('warc');

const MANDATORY = ['WARC-Record-ID', 'Content-Length', 'WARC-Date', 'WARC-Type'];

test('a passing corpus exports warcinfo, then a resource and a metadata record per capture', () => {
  const dir = makePassingProject();
  const { bytes, records, skipped } = exportWarc(dir);
  assert.deepEqual(skipped, []);
  const read = readWarc(bytes);
  assert.deepEqual(read.map((r) => r.headers['WARC-Type']), ['warcinfo', 'resource', 'metadata']);
  for (const r of read) {
    assert.equal(r.version, 'WARC/1.1');
    for (const name of MANDATORY) assert.ok(r.headers[name], `${r.headers['WARC-Type']} lacks ${name}`);
    assert.equal(Number(r.headers['Content-Length']), r.block.length);
    assert.equal(r.headers['WARC-Block-Digest'], `sha256:${sha256(r.block)}`);
    assert.match(r.headers['WARC-Record-ID'], /^<urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}>$/);
  }

  const scrape = readLedger(dir).entries.find((e) => e.op === 'scrape');
  const [info, resource, meta] = read;
  assert.match(info.block.toString('utf8'), /^software: research-kit\r\n/);
  assert.equal(resource.headers['WARC-Target-URI'], scrape.url);
  assert.equal(resource.headers['WARC-Date'], scrape.at);
  assert.equal(resource.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.equal(resource.headers['WARC-Warcinfo-ID'], info.headers['WARC-Record-ID']);
  const capture = fs.readFileSync(path.join(dir, scrape.raw), 'utf8');
  assert.ok(capture.endsWith(resource.block.toString('utf8')), 'the block is the capture after its front matter');
  assert.ok(!resource.block.toString('utf8').startsWith('---'), 'front matter is not in the block');

  assert.equal(meta.headers['WARC-Concurrent-To'], resource.headers['WARC-Record-ID']);
  assert.equal(meta.headers['WARC-Target-URI'], scrape.url);
  assert.equal(meta.headers['Content-Type'], 'application/warc-fields');
  const fields = meta.block.toString('utf8');
  assert.match(fields, new RegExp(`capture-sha256: ${scrape.bodySha256}\\r\\n`));
  assert.match(fields, new RegExp(`ledger-seq: ${scrape.seq}\\r\\n`));
  assert.match(fields, /transport: .+\r\n/);
  assert.match(fields, /completeness: .+\r\n/);

  // Each record is its own GZIP member (E-01): every slice inflates to exactly one record.
  assert.equal(records.length, 3);
  let at = 0;
  for (const rec of records) {
    const one = readWarc(zlib.gunzipSync(bytes.subarray(at, at + rec.compressedLength)));
    assert.equal(one.length, 1);
    assert.equal(one[0].headers['WARC-Record-ID'], rec.id);
    at += rec.compressedLength;
  }
  assert.equal(at, bytes.length);
});

test('the same corpus exports the same WARC', () => {
  const dir = makePassingProject();
  assert.ok(exportWarc(dir).bytes.equals(exportWarc(dir).bytes));
});

test('a capture edited after its fetch is not exported, and is named', () => {
  const dir = makePassingProject();
  const scrape = readLedger(dir).entries.find((e) => e.op === 'scrape');
  corrupt(dir, scrape.raw, (t) => `${t}\nedited after fetch\n`);
  const { bytes, skipped } = exportWarc(dir);
  assert.deepEqual(readWarc(bytes).map((r) => r.headers['WARC-Type']), ['warcinfo']);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].file, scrape.raw);
  assert.match(skipped[0].reason, /changed since it was fetched/);
});

test('the CLI writes the file, --out names it, and a non-project is refused', () => {
  const bin = fileURLToPath(new URL('../bin/export-warc.mjs', import.meta.url));
  const dir = makePassingProject();
  let r = spawnSync(process.execPath, [bin], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /3 records \(1 capture\)/);
  assert.equal(readWarc(fs.readFileSync(path.join(dir, 'research-corpus.warc.gz'))).length, 3);

  const out = path.join(tempDir(), 'x.warc.gz');
  r = spawnSync(process.execPath, [bin, '--out', out], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(out));

  r = spawnSync(process.execPath, [bin], { cwd: tempDir(), encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not a research project/);
  assert.ok(PATHS.ledger);
});

test('a refused write is named in words, and one record is "1 record"', () => {
  // Found 2026-09-29: --out naming a folder reached the top as a Node stack trace.
  const bin = fileURLToPath(new URL('../bin/export-warc.mjs', import.meta.url));
  const dir = makePassingProject();
  const folder = tempDir();
  let r = spawnSync(process.execPath, [bin, '--out', folder], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  // The code is the platform's: EISDIR here, EPERM on Windows (found by the windows-latest
  // leg, 2026-09-29). What the kit promises is the same on both - the file and a reason in words.
  assert.match(r.stderr, /could not write .*: (EISDIR|EPERM) \(/);
  assert.ok(r.stderr.includes(path.basename(folder)), r.stderr);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /node:fs|^\s+at /m);

  // Found 2026-09-30 (break-test, PR #172): a name over the filesystem's 255-byte limit was
  // a Node stack and exit 1, because ENAMETOOLONG was not a named refusal. POSIX only: on
  // Windows the same length is a MAX_PATH question about the whole path.
  if (process.platform !== 'win32') {
    r = spawnSync(process.execPath, [bin, '--out', path.join(dir, `${'y'.repeat(248)}.warc.gz`)], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /could not write .*: ENAMETOOLONG \(/);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /node:fs|^\s+at /m);
  }

  const empty = tempDir();
  fs.mkdirSync(path.join(empty, 'research'));
  fs.writeFileSync(path.join(empty, 'research', 'DISCOVERY.md'), '# Discovery Contract\n');
  r = spawnSync(process.execPath, [bin], { cwd: empty, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wrote 1 record \(0 captures\)/);
});

// #330: --out over the ledger, over a cited capture or anywhere in research/raw/ wrote a WARC
// there, said "wrote" and exited 0 - the corpus's provenance gone in place, and the first to
// notice was the commit gate refusing the altered evidence.
test('--out over the ledger, a cited capture or into research/raw/ is refused by name, and nothing changes', () => {
  const bin = fileURLToPath(new URL('../bin/export-warc.mjs', import.meta.url));
  const dir = makePassingProject();
  const capture = readLedger(dir).entries.find((e) => e.op === 'scrape').raw;
  const files = [PATHS.ledger, capture].map((rel) => path.join(dir, ...rel.split('/')));
  const before = files.map((f) => sha256(fs.readFileSync(f)));
  const cases = [
    [PATHS.ledger, /research\/raw\/\.fetches\.jsonl is the fetch ledger/],
    [capture, /is the capture E-01 cites/],
    [files[1], /is the capture E-01 cites/],                        // the same file, typed absolute
    [`${PATHS.raw}/x.warc.gz`, /research\/raw\/x\.warc\.gz is inside research\/raw\//],
  ];
  for (const [out, named] of cases) {
    const r = spawnSync(process.execPath, [bin, '--out', out], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2, `${out}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^export-warc: refused - /, r.stderr);
    assert.match(r.stderr, named, r.stderr);
    assert.match(r.stderr, /written only by research\.mjs\. Name a path outside research\/raw\/\./, r.stderr);
    assert.equal(r.stdout, '', 'nothing was written, so nothing says "wrote"');
  }
  assert.deepEqual(files.map((f) => sha256(fs.readFileSync(f))), before, 'the ledger and the capture are byte-identical');
  assert.equal(fs.existsSync(path.join(dir, 'research', 'raw', 'x.warc.gz')), false);

  // A capture an evidence row cites is evidence wherever it sits.
  fs.writeFileSync(path.join(dir, 'research', 'kept.md'), 'kept');
  corrupt(dir, PATHS.evidence, (text) => text.replace(capture, 'research/kept.md'));
  const r = spawnSync(process.execPath, [bin, '--out', 'research/kept.md'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /research\/kept\.md is the capture E-01 cites; a cited capture is evidence/, r.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'research', 'kept.md'), 'utf8'), 'kept');
});

// Review of #330: the corpus's own files were not refused (a typo replaced the evidence table
// with a WARC), and only this project's research/raw/ was guarded - from a project nested in
// another, --out ../../../research/raw/.fetches.jsonl landed on the outer ledger.
test('--out over a corpus file, or into an enclosing project\'s research/raw/, is refused too', () => {
  const bin = fileURLToPath(new URL('../bin/export-warc.mjs', import.meta.url));
  const outer = makePassingProject();
  const inner = makePassingProject(path.join(outer, 'docs', 'decisions', 'nested'));
  const files = [PATHS.evidence, PATHS.discovery, PATHS.brief, 'AGENTS.md', PATHS.ledger].map((rel) => path.join(outer, ...rel.split('/')));
  const before = files.map((f) => sha256(fs.readFileSync(f)));
  for (const [cwd, out, named] of [
    [outer, PATHS.evidence, /^export-warc: refused - research\/EVIDENCE\.md is the evidence table \(research\/EVIDENCE\.md\), one of the corpus's own files/],
    [outer, PATHS.discovery, /is the Discovery Contract/],
    [outer, PATHS.brief, /is the brief/],
    [outer, 'AGENTS.md', /is the standing protocol/],
    [inner, '../../../research/raw/.fetches.jsonl', /is the fetch ledger/],
    [outer, 'docs/decisions/nested/research/raw/.fetches.jsonl', /docs\/decisions\/nested\/research\/raw\/\.fetches\.jsonl is the fetch ledger/],
  ]) {
    const r = spawnSync(process.execPath, [bin, '--out', out], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 2, `${out}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, named, r.stderr);
    assert.equal(r.stdout, '');
  }
  assert.deepEqual(files.map((f) => sha256(fs.readFileSync(f))), before, 'the outer corpus is byte-identical');
  assert.ok(fs.existsSync(path.join(inner, ...PATHS.ledger.split('/'))));
});

test('the default export is ignored by git, in a scaffolded project and in this repository', () => {
  // Declared, not assumed: every assertion below is a `git check-ignore` exit status, and
  // on a host without git they were raw failures instead of the UNSUP this harness reports
  // for a capability it cannot provide (found 2026-09-29, break-test).
  requireGit('whether the default WARC export is git-ignored');
  // Found 2026-09-29 (break-test PR #140, item 3): export-warc with no arguments wrote a
  // 405 KB research-corpus.warc.gz into the project root that `git check-ignore` did not
  // cover - a copy of the corpus, one `git add -A` away from being committed beside it.
  const bin = fileURLToPath(new URL('../bin/export-warc.mjs', import.meta.url));
  const dir = makePassingProject();
  spawnSync('git', fixtureInitArgs(), { cwd: dir });
  const r = spawnSync(process.execPath, [bin], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'research-corpus.warc.gz'], { cwd: dir }).status, 0,
    'a scaffolded project does not ignore the default export');
  // The repository's own rule is checked in a fresh repository holding a copy of its
  // .gitignore: a ZIP download or `git archive` tree has no .git, and check-ignore there
  // exits 128, which read as "the rule is missing" (found 2026-09-30, break-test).
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const probe = tempDir();
  spawnSync('git', fixtureInitArgs(), { cwd: probe });
  fs.copyFileSync(path.join(repo, '.gitignore'), path.join(probe, '.gitignore'));
  assert.equal(spawnSync('git', ['check-ignore', '-q', '--no-index', 'research-corpus.warc.gz'], { cwd: probe }).status, 0,
    'the kit repository does not ignore the default export');
});

// Found 2026-09-30 (outside break-test): exportWarc read every ledger-named capture with
// readFileSync, so an entry naming a file outside the project - by ../ or by a link under
// research/raw - packed that file into the archive, and a FIFO there would hang the export.
test('an export never reads a capture outside the project or one that is not a regular file', () => {
  const dir = makePassingProject();
  const outside = path.join(tempDir('rk-outside-'), 'secret.md');
  fs.writeFileSync(outside, '---\ntitle: s\n---\nTOP_SECRET_OUTSIDE\n');
  const raws = [path.relative(dir, outside).split(path.sep).join('/')];
  try { fs.symlinkSync(outside, path.join(dir, 'research', 'raw', 'link.md')); raws.push('research/raw/link.md'); } catch { /* no symlink rights */ }
  fs.mkdirSync(path.join(dir, 'research', 'raw', 'dir-as-capture'));
  const lines = [...raws, 'research/raw/dir-as-capture'].map((raw, i) => JSON.stringify({ seq: 90 + i, op: 'scrape', url: `https://x.invalid/${i}`, raw }));
  fs.appendFileSync(path.join(dir, PATHS.ledger), `${lines.join('\n')}\n`);
  const out = exportWarc(dir);
  assert.ok(!zlib.gunzipSync(out.bytes).toString('latin1').includes('TOP_SECRET_OUTSIDE'), 'a file outside the project was exported');
  for (const raw of raws) assert.ok(out.skipped.some((s) => s.file === raw && /outside the project/.test(s.reason)), `${raw} was not named as outside`);
  assert.ok(out.skipped.some((s) => s.file === 'research/raw/dir-as-capture' && /not a regular file/.test(s.reason)));
});

// Found 2026-09-30 (break-test, PR #174): the export hashed the capture's bytes, then READ
// THE FILE AGAIN to parse it - so a capture replaced between the two reads (a refresh, a
// concurrent collector) was exported with the replacement's text under the ledger's hash of
// the original. The race is made deterministic here: the file is swapped right after the
// first read of it, and the export must carry what it verified, or nothing.
test('an export carries the bytes it verified, not a second read of the file', () => {
  const dir = makePassingProject();
  const entry = readLedger(dir).entries.find((e) => e.op === 'scrape' && e.raw);
  const abs = path.join(dir, entry.raw);
  const original = fs.readFileSync(abs);
  const replacement = Buffer.from(`${original.toString('utf8').replace(/\n*$/, '')}\nREPLACED_AFTER_VERIFY\n`);
  const realRead = fs.readFileSync;
  let swapped = false;
  fs.readFileSync = function readThenSwap(p, ...rest) {
    const result = realRead.call(fs, p, ...rest);
    // Only after the read whose bytes are HASHED - the one that asks for a Buffer. The corpus
    // reader reads the capture as text first, and a swap there is caught by the hash check,
    // which is not the window this test is about.
    if (!swapped && rest[0] === undefined && path.resolve(String(p)) === path.resolve(abs)) {
      swapped = true;
      fs.writeFileSync(abs, replacement);
    }
    return result;
  };
  let out;
  try { out = exportWarc(dir); } finally { fs.readFileSync = realRead; }
  assert.ok(swapped, 'the export never read the capture, so this proves nothing');
  const text = zlib.gunzipSync(out.bytes).toString('utf8');
  assert.doesNotMatch(text, /REPLACED_AFTER_VERIFY/, 'the export carried text the ledger hash never covered');
});
