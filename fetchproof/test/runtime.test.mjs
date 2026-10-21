// What the runtime seams promise about a fetched body: it is read in the charset the server
// declared, a byte-order mark outranks that declaration, and a charset the decoder does not
// know is named to the caller - never silently read as UTF-8.
//
// Found 2026-10-03 (output-reliability audit, G7): `boundedText` decoded every body with
// `new TextDecoder()` - UTF-8 - whatever Content-Type said. A `text/plain;
// charset=windows-1252` page holding byte 0x80 came back with U+FFFD where the euro sign
// was, and nothing recorded that the capture was not the page.

import { spawn } from 'node:child_process';
import { test, describe, assert, tempDir, fs, path } from './harness.mjs';
import { boundedText, boundedBody, charsetOf, decoderFor } from '../lib/runtime.mjs';
import * as httpKeyless from '../lib/http-transport.mjs';

describe('runtime');

const served = (bytes, contentType) => new Response(
  Uint8Array.from(bytes),
  { headers: contentType === undefined ? {} : { 'content-type': contentType } },
);
const utf8 = (text) => [...new TextEncoder().encode(text)];

test('G7: charsetOf reads the charset parameter, whatever its case or quoting', () => {
  assert.equal(charsetOf('text/plain; charset=windows-1252'), 'windows-1252');
  assert.equal(charsetOf('text/html;CHARSET="ISO-8859-1"'), 'iso-8859-1');
  assert.equal(charsetOf("text/html; charset='utf-8'"), 'utf-8');
  assert.equal(charsetOf('text/html; boundary=x; charset=UTF-8 ; q=1'), 'utf-8');
  assert.equal(charsetOf('application/json'), '', 'no parameter, no label');
  assert.equal(charsetOf(''), '');
  assert.equal(charsetOf(undefined), '');
});

test('G7: a windows-1252 body is decoded by its declared charset', async () => {
  const { text } = await boundedBody(served([0x50, 0x72, 0x69, 0x63, 0x65, 0x3a, 0x20, 0x80, 0x35], 'text/plain; charset=windows-1252'), 'the page');
  assert.equal(text, 'Price: €5', 'byte 0x80 is the euro sign in windows-1252, not U+FFFD');
});

test('G7: an iso-8859-1 body is decoded by its declared charset', async () => {
  const { text } = await boundedBody(served([0x63, 0x61, 0x66, 0xE9], 'text/plain; charset=ISO-8859-1'), 'the page');
  assert.equal(text, 'café');
});

test('G7: a byte-order mark outranks the declared charset, and is not kept', async () => {
  const utf8Bom = (await boundedBody(served([0xEF, 0xBB, 0xBF, ...utf8('café')], 'text/plain; charset=windows-1252'), 'the page')).text;
  assert.equal(utf8Bom, 'café', 'a UTF-8 BOM means UTF-8, whatever the header says, and the BOM is not part of the text');
  const utf16le = await boundedBody(served([0xFF, 0xFE, 0x41, 0x00, 0xE9, 0x00], 'text/plain; charset=windows-1252'), 'the page');
  assert.equal(utf16le.text, 'Aé');
  assert.equal(utf16le.charset, 'utf-16le');
  assert.equal(utf16le.fallback, '', 'a BOM is a decision, not a fallback');
  const utf16be = await boundedBody(served([0xFE, 0xFF, 0x00, 0x41], 'text/plain'), 'the page');
  assert.equal(utf16be.text, 'A');
  assert.equal(utf16be.charset, 'utf-16be');
});

test('G7: an unknown charset label falls back to UTF-8, and the fallback is named to the caller', async () => {
  // The body holds a byte outside ASCII: only then can a reading differ (review, 2026-10-03).
  const body = await boundedBody(served(utf8('ok €'), 'text/plain; charset=x-nope'), 'the page');
  assert.equal(body.text, 'ok €');
  assert.equal(body.charset, 'utf-8', 'the decoder actually used, not the one declared');
  assert.match(body.fallback, /x-nope/, `the fallback names the label the server declared: ${body.fallback}`);
  assert.match(body.fallback, /UTF-8/, `the fallback says what was used instead: ${body.fallback}`);
  assert.match(body.fallback, /the page/, 'the fallback names the body, as the size refusal does');
  assert.equal(await boundedText(served(utf8('ok €'), 'text/plain; charset=x-nope'), 'the page'), 'ok €',
    'boundedText still returns the text alone');

  const known = decoderFor('text/plain; charset=windows-1252', Uint8Array.of(0x80));
  assert.equal(known.charset, 'windows-1252');
  assert.equal(known.fallback, '');
  const unknown = decoderFor('text/plain; charset=x-nope', Uint8Array.of(0xC3, 0xA9));
  assert.equal(unknown.charset, 'utf-8');
  assert.match(unknown.fallback, /x-nope/);
});

// A legacy label on UTF-8 bytes is the common misconfiguration (Apache's AddDefaultCharset
// on a server that writes UTF-8): read as declared, `café` became `cafÃ©`, which is what the
// previous always-UTF-8 reading got right by accident. Bytes that form a valid multi-byte
// UTF-8 sequence are almost never intended as Latin-1 text, so UTF-8 is preferred for them
// and the declared charset is used only when the bytes are not valid UTF-8 (lead's addition
// to G7, 2026-10-03).
test('G7: a legacy charset declared over bytes that are valid multi-byte UTF-8 is read as UTF-8', async () => {
  const body = await boundedBody(served([0x63, 0x61, 0x66, 0xC3, 0xA9], 'text/html; charset=iso-8859-1'), 'the page');
  assert.equal(body.text, 'café', 'a mislabelled UTF-8 page reads as UTF-8');
  assert.equal(body.charset, 'utf-8');
  assert.equal(body.fallback, '');
  // The same label over bytes that are NOT valid UTF-8 is honoured: 0xE9 alone is Latin-1's é.
  const legacy = await boundedBody(served([0x63, 0x61, 0x66, 0xE9], 'text/html; charset=iso-8859-1'), 'the page');
  assert.equal(legacy.text, 'café');
  assert.equal(legacy.charset, 'windows-1252');
  // ASCII-only bytes decode the same either way, and keep the declared charset's name.
  const ascii = await boundedBody(served([0x63, 0x61, 0x66, 0x65], 'text/html; charset=iso-8859-1'), 'the page');
  assert.equal(ascii.text, 'cafe');
  assert.equal(ascii.charset, 'windows-1252');
});

test('G7: a UTF-8 body, declared or not, decodes exactly as it always did', async () => {
  const json = '{"name":"Zoë","price":"€5","note":"日本語"}';
  const bytes = utf8(json);
  const before = new TextDecoder().decode(Uint8Array.from(bytes));
  for (const type of [undefined, 'application/json', 'application/json; charset=utf-8', 'application/json; charset="UTF-8"', 'text/plain; charset=utf8']) {
    const body = await boundedBody(served(bytes, type), 'the response');
    assert.equal(body.text, before, `${type}: the text changed from what new TextDecoder() gave`);
    assert.equal(body.text, json);
    assert.equal(body.charset, 'utf-8', `${type}: decoded as ${body.charset}`);
    assert.equal(body.fallback, '', `${type}: a UTF-8 body is never a fallback`);
    assert.equal(await boundedText(served(bytes, type), 'the response'), json);
  }
});

// --- through the keyless child, end to end ------------------------------------------
//
// The child half of http-transport.mjs is the one caller whose result becomes a capture.
// A body it read on a fallback is not known to be the page, and the capture's completeness
// grade is where the kit records that, so the gate can see it - the same seam the size
// bound reports through (ADR-0082).

const SERVER = `
import http from 'node:http';
const server = http.createServer((req, res) => {
  if (req.url === '/win1252') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=windows-1252' });
    res.end(Buffer.from([0x50, 0x72, 0x69, 0x63, 0x65, 0x3a, 0x20, 0x80, 0x35]));
    return;
  }
  if (req.url === '/unknown-text') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=x-nope' });
    res.end(Buffer.from('plain words €', 'utf8'));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=x-nope' });
  res.end(Buffer.from('<html><head><title>T</title></head><body><main><p>' + 'word '.repeat(400) + '€</p></main></body></html>', 'utf8'));
});
server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));
`;

async function withServer(fn) {
  const file = path.join(tempDir('fp-charset-'), 'server.mjs');
  fs.writeFileSync(file, SERVER);
  const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
      proc.on('exit', (code) => reject(new Error(`the page server exited ${code}`)));
    });
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    proc.kill();
  }
}

// Nothing inherited from the machine running the suite: a proxy would not reach loopback.
const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };

test('G7: the keyless child decodes a page as declared, and a capture read on a fallback is graded partial by name', async () => {
  await withServer((base) => {
    const declared = httpKeyless.scrape(`${base}/win1252`, { env });
    assert.equal(declared.ok, true, declared.error);
    assert.equal(declared.markdown, 'Price: €5');
    assert.equal(declared.completeness, 'full', `a body read as declared is whole: ${declared.omitted}`);

    const text = httpKeyless.scrape(`${base}/unknown-text`, { env });
    assert.equal(text.ok, true, text.error);
    assert.equal(text.markdown, 'plain words €');
    assert.equal(text.completeness, 'partial', 'a body read on a fallback is not known to be the page');
    assert.match(text.omitted, /x-nope/, `the grade names the charset the server declared: ${text.omitted}`);

    const html = httpKeyless.scrape(`${base}/unknown-html`, { env });
    assert.equal(html.ok, true, html.error);
    assert.equal(html.completeness, 'partial');
    assert.match(html.omitted, /x-nope/, `the HTML grade carries the fallback beside its own reasons: ${html.omitted}`);
  });
});

// Found 2026-10-03 (review of the G7 fix). Four readings the first fix got wrong, and one
// its tests could not tell apart:
//  - a body that is not valid UTF-8 under a UTF-8 declaration, or none - the legacy page
//    that names its charset only in a <meta> tag - still read as U+FFFD silently and the
//    capture was graded full; it is now a named fallback, so the capture is partial;
//  - a UTF-16 label on an 8-bit body (no byte-order mark, no NUL byte, which UTF-16 text of a
//    page cannot avoid) decoded 120 sentences of ASCII to CJK garbage, with no fallback;
//  - an unknown label over a pure-ASCII body was graded partial though the decode was exact;
//  - `charset="utf-8` with its quote unbalanced reached the decoder as the label `"utf-8`;
//  - `boundedText`, which the JSON callers read, had started to honour a declared legacy
//    charset, where RFC 8259 makes JSON UTF-8 and the callers had always read it so.
test('G7 review: bytes that are not valid UTF-8 under a UTF-8 declaration, or none, are a named fallback', async () => {
  const bytes = [...utf8('Price: '), 0x80, ...utf8('5 per month')];
  for (const type of [undefined, 'text/html', 'text/html; charset=utf-8', 'text/html; charset=UTF-8']) {
    const body = await boundedBody(served(bytes, type), 'the page');
    assert.equal(body.text, 'Price: �5 per month', `${type}: read as UTF-8, the only reading its declaration allows`);
    assert.equal(body.charset, 'utf-8');
    assert.match(body.fallback, /not valid UTF-8/, `${type}: the fallback says why the text is not known to be the page: ${JSON.stringify(body.fallback)}`);
    assert.match(body.fallback, /the page/, 'the fallback names the body');
  }
  // Valid UTF-8 under the same declarations stays silent, as does pure ASCII.
  assert.equal((await boundedBody(served(utf8('Price: €5'), 'text/html'), 'the page')).fallback, '');
  assert.equal((await boundedBody(served(utf8('Price: 5'), undefined), 'the page')).fallback, '');
});

test('G7 review: a UTF-16 label on a body with no byte-order mark and no NUL byte is read as UTF-8', async () => {
  const html = '<html><body><main><p>' + 'The free plan allows ten requests per minute. '.repeat(4) + '</p></main></body></html>';
  for (const label of ['utf-16', 'utf-16le', 'UTF-16BE', 'unicode', 'ucs-2']) {
    const body = await boundedBody(served(utf8(html), `text/html; charset=${label}`), 'the page');
    assert.equal(body.text, html, `${label}: an 8-bit page is read as the 8-bit page it is`);
    assert.equal(body.charset, 'utf-8');
    assert.equal(body.fallback, '', `${label}: valid UTF-8 is an exact reading, not a fallback`);
  }
  const accented = await boundedBody(served(utf8('café'), 'text/html; charset=utf-16'), 'the page');
  assert.equal(accented.text, 'café');
  // Bytes that are neither UTF-16 (no NUL) nor valid UTF-8 are read as UTF-8 and named.
  const neither = await boundedBody(served([0x63, 0x61, 0x66, 0xE9], 'text/html; charset=utf-16'), 'the page');
  assert.equal(neither.charset, 'utf-8');
  assert.match(neither.fallback, /utf-16/, `names the declared label: ${neither.fallback}`);
  assert.match(neither.fallback, /NUL/, `says why the label was not believed: ${neither.fallback}`);
  // A real UTF-16LE body without a BOM has its NUL bytes, and is decoded as declared.
  const real = await boundedBody(served([0x41, 0x00, 0xE9, 0x00, 0x20, 0x00, 0x3C, 0x00], 'text/html; charset=utf-16'), 'the page');
  assert.equal(real.text, 'Aé <');
  assert.equal(real.charset, 'utf-16le');
  assert.equal(real.fallback, '');
  // A UTF-8 byte-order mark under a UTF-16 label is still the file saying what it is
  // (mutation audit 2026-10-03: no test reached the UTF-8 BOM rule on its own).
  const bom = decoderFor('text/plain; charset=utf-16', Uint8Array.of(0xEF, 0xBB, 0xBF, 0x41));
  assert.equal(bom.charset, 'utf-8');
  assert.equal(bom.decoder.decode(Uint8Array.of(0xEF, 0xBB, 0xBF, 0x41)), 'A');
});

test('G7 review: an unknown label over pure ASCII is an exact reading, and a stray quote is not part of the label', async () => {
  const ascii = await boundedBody(served(utf8('Price: 5 per month'), 'text/html; charset=none'), 'the page');
  assert.equal(ascii.text, 'Price: 5 per month');
  assert.equal(ascii.charset, 'utf-8');
  assert.equal(ascii.fallback, '', 'no byte outside ASCII, so no reading could differ');
  const high = await boundedBody(served(utf8('Price: €5'), 'text/html; charset=none'), 'the page');
  assert.match(high.fallback, /none/, 'a byte outside ASCII under an unknown label is still named');
  assert.equal(charsetOf('text/html; charset="utf-8'), 'utf-8');
  assert.equal(charsetOf("text/html; charset=utf-8'"), 'utf-8');
  assert.equal(charsetOf('text/html; charset=""'), '');
  const unbalanced = await boundedBody(served(utf8('Price: €5'), 'text/html; charset="utf-8'), 'the page');
  assert.equal(unbalanced.text, 'Price: €5');
  assert.equal(unbalanced.fallback, '');
});

test('G7 review: boundedText reads a JSON answer as UTF-8, as its callers always did', async () => {
  // 0xE9 alone is Latin-1's é and not valid UTF-8: the capture reader honours the label,
  // the JSON reader does not, because JSON is UTF-8 (RFC 8259) and the parse decides.
  const bytes = [0x7B, 0x22, 0x6E, 0x22, 0x3A, 0x22, 0xE9, 0x22, 0x7D];
  assert.equal((await boundedBody(served(bytes, 'application/json; charset=windows-1252'), 'the response')).text, '{"n":"é"}');
  assert.equal(await boundedText(served(bytes, 'application/json; charset=windows-1252'), 'the response'), '{"n":"�"}');
  assert.equal(await boundedText(served(utf8('{"n":"é"}'), 'application/json; charset=windows-1252'), 'the response'), '{"n":"é"}');
});
