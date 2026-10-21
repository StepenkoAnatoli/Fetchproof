// Fixtures for the portable artifact format, GENERATED rather than checked in.
//
// A binary ZIP in the repository is a fixture nobody can review: a reader cannot see what
// makes `12-path-traversal` a path traversal without unzipping it, and a maintainer
// cannot adjust one without a hex editor. Every case here is built from a base package by
// a named mutation, so the diff that introduces a fixture is the sentence describing it.
//
// `rawZip` exists because `lib/archive.mjs` is CORRECT: `entryName()` refuses absolute
// paths, drive letters and `..`, and turns a backslash into a separator rather than
// storing it, so the kit's own writer cannot produce the hostile cases the validator has
// to refuse. (It TRANSLATES, it does not refuse: that translation let a file named
// `a\b.md` be stored as `a/b.md`, which is why collectProjectFiles now refuses such a
// name first - Arena break test 10.) Writing them needs a writer with no opinions.
// That is the only thing rawZip is for, and it lives in the test tree so it can never be
// reached from a shipped path.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { sha256, canonicalJson, resolve, today } from '../lib/core.mjs';
import { crc32 } from '../lib/archive.mjs';
import { createArtifact } from '../lib/artifact.mjs';
import { renderBrief } from '../lib/brief.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { MANIFEST_PATH, MANIFEST_DIGEST_PATH } from '../lib/artifact-validator.mjs';
import { tempDir, makePassingProject } from './harness.mjs';

// ---------------------------------------------------------------- a writer with no opinions

/**
 * Write a ZIP from entries, validating nothing.
 *
 * Per-entry options a hostile fixture needs:
 *   `unixMode`     stamp a mode, so a symlink entry can exist
 *   `declareSize`  lie about the uncompressed size in both headers
 *   `deflate`      compress, so a ratio can be made suspicious
 *   `deflated`     raw deflate bytes stored as they are, so a bomb need not be inflated
 *                  in the test to be built (pair it with `declareSize`)
 */
export function rawZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const deflate = entry.deflate === true;
    const stored = entry.deflated ?? (deflate ? zlib.deflateRawSync(data, { level: 9 }) : data);
    const method = deflate || entry.deflated ? 8 : 0;
    const uncompressed = entry.declareSize ?? data.length;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, stored);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    // The high byte of versionMadeBy is the source filesystem. 3 is Unix, and only a
    // Unix-made entry carries a mode the reader will read.
    head.writeUInt16LE(entry.unixMode === undefined ? 20 : (3 << 8) | 20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(0, 12);
    head.writeUInt16LE(0, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(stored.length, 20);
    head.writeUInt32LE(uncompressed, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt16LE(0, 30);
    head.writeUInt16LE(0, 32);
    head.writeUInt16LE(0, 34);
    head.writeUInt16LE(0, 36);
    head.writeUInt32LE(entry.unixMode === undefined ? 0 : (entry.unixMode << 16) >>> 0, 38);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);

    offset += local.length + name.length + stored.length;
  }

  const localBytes = Buffer.concat(locals);
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localBytes.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBytes, centralBytes, eocd]);
}

// ---------------------------------------------------------------- base projects

const IDENTITY = Object.freeze({
  repository: 'example-org/example-project',
  ref: 'main',
  commit: '0123456789abcdef0123456789abcdef01234567',
  workflow: 'start-research.yml',
  workflowRunId: 123456789,
  runAttempt: 1,
  createdAt: '2026-09-21T14:30:00.000Z',
});

/** A corpus that passes the gate but has NOT been reviewed: the ordinary collected case. */
export function collectedProject(date = today()) {
  return makePassingProject(tempDir('fp-collected-'), { date });
}

/**
 * The same corpus, reviewed: the Finding rewritten into something the extractor did not
 * produce, and the brief authored. Nothing else changes, which is the point - the
 * difference between "collected" and "approved" is entirely human work.
 */
export function approvedProject(date = today()) {
  const dir = collectedProject(date);

  // Step (b): rewrite the extracted Finding into a claim. The replacement must not be
  // what the extractor produces, because that is exactly what `findingsReviewState`
  // looks for.
  const evidence = resolve(dir, 'research/EVIDENCE.md');
  fs.writeFileSync(evidence, fs.readFileSync(evidence, 'utf8').replace(
    'The free plan allows 10 requests per minute and includes 1,000 credits.',
    'The free tier caps this design at 10 requests per minute, which is what sets the collector default; the 1,000 included credits are roughly 25 runs at the quick depth.',
  ), 'utf8');

  // Step (c): draft the brief with the real renderer, then answer its TODOs.
  //
  // Hand-writing an "authored" brief here would be a fixture that agrees with itself:
  // `briefState` distinguishes a draft from an authored brief by the drafting marker and
  // the TODO marks, so a brief that never went through `renderBrief` reads as `legacy` no
  // matter how finished its prose is. Going through the renderer is what makes this
  // fixture the same artifact a real project produces.
  renderBrief(dir, { force: true, date, corpus: readCorpus(dir) });
  const briefFile = resolve(dir, 'research/BRIEF.md');
  let brief = fs.readFileSync(briefFile, 'utf8');
  brief = answerSection(brief, 'Contradictions and how they were resolved',
    `None. One source, re-read on ${date}, and nothing else in the corpus speaks to the same limit.`);
  brief = answerSection(brief, 'Decision',
    'Build against a 10-request-per-minute ceiling and a 1,000-credit month. Out of scope: '
    + 'paid tiers, which no row in this corpus touches.');
  fs.writeFileSync(briefFile, brief, 'utf8');
  return dir;
}

/** Replace a judged section's body, TODO and all, leaving every other section alone. */
function answerSection(text, heading, body) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`the drafted brief has no "${heading}" section`);
  let end = start + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end += 1;
  return [...lines.slice(0, start + 1), '', body, '', ...lines.slice(end)].join('\n');
}

// ---------------------------------------------------------------- packaging

/** Build a real package and hand back its parts, so a fixture can mutate any of them. */
export function basePackage(root, overrides = {}) {
  const built = createArtifact({ root, ...IDENTITY, ...overrides });
  const payload = built.entries.filter((e) => e.name !== MANIFEST_PATH && e.name !== MANIFEST_DIGEST_PATH);
  return { payload, manifest: built.manifest, derived: built.derived };
}

/**
 * Re-seal a mutated package: recompute the inventory, write the manifest, hash the exact
 * bytes, and append manifest and digest LAST - the same order the producer uses, because
 * a fixture sealed differently would be testing the fixture rather than the format.
 */
export function seal(payload, manifest, {
  recomputeFiles = true,
  breakDigest = false,
  omitManifest = false,
  omitDigest = false,
  manifestBytes = null,
  digestText = null,
} = {}) {
  const shell = { ...manifest };
  if (recomputeFiles) {
    shell.files = [...payload]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((e) => ({
        path: e.name,
        role: roleFor(e.name, manifest),
        mediaType: mediaFor(e.name),
        byteLength: Buffer.isBuffer(e.data) ? e.data.length : Buffer.byteLength(String(e.data)),
        sha256: sha256(Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8')),
      }));
  }
  const bytes = manifestBytes ?? Buffer.from(`${canonicalJson(shell)}\n`, 'utf8');
  const digest = breakDigest ? sha256(Buffer.from('not this manifest', 'utf8')) : sha256(bytes);
  const entries = [...payload].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!omitManifest) entries.push({ name: MANIFEST_PATH, data: bytes });
  if (!omitDigest) entries.push({ name: MANIFEST_DIGEST_PATH, data: Buffer.from(digestText ?? `${digest}  manifest.json\n`, 'utf8') });
  return rawZip(entries);
}

function roleFor(name, manifest) {
  const known = (manifest.files ?? []).find((f) => f.path === name);
  if (known) return known.role;
  if (name.startsWith('project/research/raw/')) return name.endsWith('.fetches.jsonl') ? 'PROVENANCE_LEDGER' : 'RAW_CAPTURE';
  return 'OTHER';
}

function mediaFor(name) {
  if (name.endsWith('.md')) return 'text/markdown';
  if (name.endsWith('.jsonl')) return 'application/x-ndjson';
  if (name.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

/** Write a package to a file inside `dir` and return the path. */
export function writeFixture(dir, name, bytes) {
  const file = path.join(dir, `${name}.zip`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

export { IDENTITY };
