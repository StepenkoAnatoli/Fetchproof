// lib/warc.mjs - the corpus as WARC 1.1, a copy for archive tools (ADR-0090).
//
// Research: docs/decisions/2026-09-28-warc-export. What the export promises:
//   - one `warcinfo` record first, then per ledger `scrape` entry whose capture is on disk
//     and unchanged: a `resource` record (the kit keeps the page's text, never its HTTP
//     exchange, so a `response` record would claim what was not stored) and a `metadata`
//     record joined to it by WARC-Concurrent-To;
//   - WARC-Block-Digest `sha256:<hex>` on every record, the hash the kit already uses;
//   - record IDs derived from the ledger entry, so the same corpus exports the same WARC;
//   - each record its own GZIP member, as the standard recommends.
// The corpus and its ledger remain the evidence: an export is a copy, and it never gates.

import zlib from 'node:zlib';
import { projectFile, sha256 } from './core.mjs';
import { readLedger, readCorpus, parseCapture, fs } from './corpus.mjs';

const CRLF = '\r\n';
const SPEC = 'https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/';

/**
 * A `urn:uuid` from a seed: sha256, shaped as an RFC 9562 version-8 UUID (the version for
 * custom, deterministic layouts). A random v4 would make every export of one corpus differ.
 */
export function uuidFrom(seed) {
  const h = sha256(Buffer.from(String(seed), 'utf8')).slice(0, 32).split('');
  h[12] = '8';
  h[16] = '89ab'[parseInt(h[16], 16) & 3];
  const s = h.join('');
  return `<urn:uuid:${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}>`;
}

/** A field value on one line: WARC headers end at CRLF, so a newline inside one would forge the next. */
function oneLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

/** `application/warc-fields`: `name: value` lines, each ending in CRLF. */
export function warcFields(pairs) {
  return Buffer.from(pairs.map(([k, v]) => `${k}: ${oneLine(v)}${CRLF}`).join(''), 'utf8');
}

/** One uncompressed record: version line, named fields, CRLF, the block, CRLF CRLF. */
export function warcRecord({ type, id, date, fields = [], contentType, block }) {
  const body = Buffer.isBuffer(block) ? block : Buffer.from(String(block ?? ''), 'utf8');
  const head = [
    'WARC/1.1',
    `WARC-Type: ${type}`,
    `WARC-Record-ID: ${id}`,
    `WARC-Date: ${oneLine(date)}`,
    ...fields.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${oneLine(v)}`),
    `Content-Type: ${contentType}`,
    `WARC-Block-Digest: sha256:${sha256(body)}`,
    `Content-Length: ${body.length}`,
  ].join(CRLF);
  return Buffer.concat([Buffer.from(`${head}${CRLF}${CRLF}`, 'utf8'), body, Buffer.from(`${CRLF}${CRLF}`, 'utf8')]);
}

/**
 * The export, in memory. `bytes` is the .warc.gz; `records` lists each record's id and the
 * length of its GZIP member; `skipped` names every scrape entry that was not exported, and why.
 */
export function exportWarc(root) {
  const ledger = readLedger(root);
  const plan = readCorpus(root).plan;
  const topic = typeof plan?.topic === 'string' ? plan.topic.trim() : '';
  const scrapes = ledger.entries.filter((e) => e.op === 'scrape' && e.raw);
  // The latest fetch time, not the clock: the same corpus must export the same bytes.
  const date = ledger.entries.map((e) => String(e.at ?? '')).filter(Boolean).sort().pop()
    || '1970-01-01T00:00:00Z';

  const infoId = uuidFrom(`warcinfo:${ledger.entries.map((e) => e.entrySha256 ?? '').join(',')}`);
  const plain = [{
    id: infoId,
    bytes: warcRecord({
      type: 'warcinfo', id: infoId, date, contentType: 'application/warc-fields',
      block: warcFields([
        ['software', 'fetchproof'],
        ['format', 'WARC File Format 1.1'],
        ['conformsTo', SPEC],
        ['description', topic ? `research corpus: ${topic}` : 'research corpus'],
        ['isPartOf', 'research/raw/.fetches.jsonl'],
      ]),
    }),
  }];

  const skipped = [];
  let captures = 0;
  for (const entry of scrapes) {
    const { abs, problem } = projectFile(root, entry.raw);
    if (problem) {
      skipped.push({ file: entry.raw, seq: entry.seq, reason: {
        outside: 'the capture is outside the project - not read',
        missing: 'the capture is not on disk',
        'not-file': 'the capture is not a regular file',
      }[problem] });
      continue;
    }
    // WARC-Date is mandatory (WARC 1.1). An entry the export cannot date is left out and
    // named, never written as a record with an empty date (rank 7, 2026-10-03 gap audit).
    const dated = String(entry.at ?? '').trim();
    if (!dated) {
      skipped.push({ file: entry.raw, seq: entry.seq, reason: 'the ledger entry carries no date, and WARC-Date is mandatory' });
      continue;
    }
    let raw = null;
    try { raw = fs.readFileSync(abs); } catch { /* named below */ }
    if (raw === null) { skipped.push({ file: entry.raw, seq: entry.seq, reason: 'the capture could not be read' }); continue; }
    if (entry.bodySha256 && sha256(raw) !== entry.bodySha256) {
      skipped.push({ file: entry.raw, seq: entry.seq, reason: 'the capture changed since it was fetched - its hash no longer matches the ledger' });
      continue;
    }
    // The bytes whose hash just passed, not a second read of the file: a capture replaced
    // between the two - a refresh, a concurrent collector - was exported with the new text
    // under the ledger's hash of the old (found 2026-09-30, break-test).
    const { front, body } = parseCapture(raw.toString('utf8'));
    // The block the resource record carries, and its own hash. `capture-sha256` is the whole
    // file the ledger hashed; `body-sha256` lets a consumer verify the block itself
    // (rank 7, 2026-10-03 gap audit).
    const block = Buffer.from(body, 'utf8');
    const seed = entry.entrySha256 || `${entry.seq}:${entry.url}:${entry.bodySha256}`;
    const resourceId = uuidFrom(`resource:${seed}`);
    const metaId = uuidFrom(`metadata:${seed}`);
    plain.push({
      id: resourceId,
      bytes: warcRecord({
        type: 'resource', id: resourceId, date: dated,
        fields: [['WARC-Target-URI', entry.url], ['WARC-Warcinfo-ID', infoId]],
        contentType: 'text/markdown; charset=utf-8',
        block,
      }),
    });
    plain.push({
      id: metaId,
      bytes: warcRecord({
        type: 'metadata', id: metaId, date: dated,
        fields: [['WARC-Target-URI', entry.url], ['WARC-Concurrent-To', resourceId], ['WARC-Warcinfo-ID', infoId]],
        contentType: 'application/warc-fields',
        block: warcFields([
          ['transport', entry.transport || front.transport || 'unrecorded'],
          ['completeness', front.completeness || 'unspecified'],
          ...(front.omitted ? [['omitted', front.omitted]] : []),
          ['evidence-type', entry.type || ''],
          ['capture-file', entry.raw],
          ['capture-sha256', entry.bodySha256 || sha256(raw)],
          ['body-sha256', sha256(block)],
          ['ledger-seq', entry.seq],
          ['ledger-entry-sha256', entry.entrySha256 || ''],
        ]),
      }),
    });
    captures += 1;
  }

  // Each record its own member: mtime 0 in the gzip header, so the bytes do not move either.
  const members = plain.map((r) => ({ id: r.id, gz: zlib.gzipSync(r.bytes, { level: 9 }) }));
  return {
    bytes: Buffer.concat(members.map((m) => m.gz)),
    records: members.map((m) => ({ id: m.id, compressedLength: m.gz.length })),
    captures,
    skipped,
  };
}

/**
 * A small reader, for the tests and for a self-check after writing: gunzips (every member)
 * and splits the stream into records. Throws on a record that is not framed as WARC 1.1.
 */
export function readWarc(input) {
  const buf = input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b ? zlib.gunzipSync(input) : input;
  const out = [];
  let at = 0;
  while (at < buf.length) {
    const end = buf.indexOf('\r\n\r\n', at, 'latin1');
    if (end < 0) throw new Error(`record at byte ${at} has no end of header`);
    const lines = buf.subarray(at, end).toString('utf8').split(CRLF);
    const version = lines.shift();
    if (version !== 'WARC/1.1') throw new Error(`record at byte ${at} starts "${version}", not WARC/1.1`);
    const headers = {};
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon < 0) throw new Error(`record at byte ${at}: header line without a colon: ${line}`);
      headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    const length = Number(headers['Content-Length']);
    if (!Number.isInteger(length) || length < 0) throw new Error(`record at byte ${at} has no usable Content-Length`);
    const start = end + 4;
    const block = buf.subarray(start, start + length);
    if (block.length !== length) throw new Error(`record at byte ${at} is truncated`);
    if (buf.subarray(start + length, start + length + 4).toString('latin1') !== '\r\n\r\n') {
      throw new Error(`record at byte ${at} does not end with CRLF CRLF after its block`);
    }
    out.push({ version, headers, block });
    at = start + length + 4;
  }
  return out;
}
