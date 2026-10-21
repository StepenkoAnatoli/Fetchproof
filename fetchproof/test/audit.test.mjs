// The audit family and its container (ADR-0019). A derived artifact: it reads the
// corpus and never writes back to it, and it renders only when the gate passes.
//
// The archive's format is proved offline - CRC-32 against its published vectors, and
// every entry read back out of the central directory by a reader that stands in for the
// operator's unzip tool.

import zlib from 'node:zlib';
import { test, describe, assert, makePassingProject, corrupt, fs, path, tempDir, KIT_ROOT } from './harness.mjs';
import { PATHS, resolve, readText, readJson, writeText, makeSlug } from '../lib/core.mjs';
import { writeAudit, listVersions, resolveVersion, nextVersion, zipAudit, fingerprintOf, readManifest, TOPIC_SLUG, SUBTOPIC_SLUG } from '../lib/audit.mjs';
import { crc32, buildZip, entryName } from '../lib/archive.mjs';
import { readCentralDirectory, ZIP_LIMITS } from '../lib/artifact-zip.mjs';
import { rawZip } from './artifact-fixtures.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { holdsLock } from '../lib/provenance.mjs';

describe('audit');

test('returning to an earlier warning state updates the default audit bundle without rewriting history', () => {
  for (const ages of [[1, 60, 1], [60, 1, 60]]) {
    const date = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const dir = makePassingProject(undefined, { date });
    const config = resolve(tempDir(), 'config.json');
    const env = { FETCHPROOF_CONFIG: config };
    const history = [];
    const original = [];
    for (const maxAgeDays of ages) {
      writeText(config, JSON.stringify({ maxAgeDays }));
      const result = writeAudit(dir, { env });
      history.push(result);
      if (history.length <= 2) original.push([result.main, readText(resolve(dir, result.main))]);
    }
    const bundle = zipAudit(dir);
    assert.equal(bundle.ok, true, bundle.reason);
    const contents = readZip(fs.readFileSync(resolve(dir, bundle.file)));
    for (const entry of contents) {
      assert.equal(entry.text.includes('unknown-closure/stale-evidence'), ages[2] === 1,
        `${entry.name} does not carry the most recently evaluated warning state`);
    }
    assert.equal(history[2].written, true, 'a return to an older state is a new observation');
    assert.equal(bundle.version, '0.3');
    for (const [file, text] of original) assert.equal(readText(resolve(dir, file)), text);
    assert.equal(writeAudit(dir, { env }).written, false, 'a consecutive identical observation reuses the latest version');
  }
});

test('standalone audits retain the full preflight warning that accompanies a pass', () => {
  const dir = makePassingProject();
  const result = writeAudit(dir, { env: {} });
  assert.equal(result.written, true);
  assert.equal(result.verdict.pass, true);
  const warning = result.verdict.warnings.find((f) => f.check === 'corroboration' && f.rule === 'single-source');
  assert.ok(warning);
  assert.ok(result.subtopics.length > 0);
  for (const file of [result.main, ...result.subtopics]) {
    const text = readText(resolve(dir, file));
    assert.match(text, /corroboration\/single-source/);
    assert.ok(text.includes(warning.detail), `${file} drops the warning reason`);
  }
});

test('changed gate warnings earn a new audit version without rewriting the earlier snapshot', () => {
  const date = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dir = makePassingProject(undefined, { date });
  const config = resolve(tempDir(), 'config.json');
  const env = { FETCHPROOF_CONFIG: config };
  writeText(config, JSON.stringify({ maxAgeDays: 60 }));
  const first = writeAudit(dir, { env });
  assert.equal(first.written, true);
  const original = readText(resolve(dir, first.main));
  assert.doesNotMatch(original, /unknown-closure\/stale-evidence/);
  writeText(config, JSON.stringify({ maxAgeDays: 1 }));
  const second = writeAudit(dir, { env });
  assert.equal(second.written, true, second.reason);
  assert.notEqual(second.version, first.version);
  const warning = second.verdict.warnings.find((f) => f.rule === 'stale-evidence');
  assert.ok(warning);
  assert.ok(readText(resolve(dir, second.main)).includes(warning.detail));
  assert.equal(readText(resolve(dir, first.main)), original, 'the historical snapshot was rewritten');
  assert.equal(writeAudit(dir, { env }).written, false, 'an unchanged evaluation should reuse its snapshot');
});

// --- the container -----------------------------------------------------------------

test('crc32 matches its published vectors', () => {
  assert.equal(crc32(Buffer.from('')), 0);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('entryName refuses anything that could unpack outside the folder', () => {
  assert.equal(entryName('a/b.md'), 'a/b.md');
  // A backslash is refused, not translated (2026-09-28, Arena break test 10): translating
  // `a\\b.md` into `a/b.md` stored a file under a name nobody gave it, and the package
  // writer then contradicted its own manifest. The writer changes no name it is handed.
  assert.throws(() => entryName('a\\b.md'), /backslash/);
  assert.throws(() => buildZip([{ name: 'research\\raw\\x.md', data: 'x' }]), /backslash/);
  assert.throws(() => entryName('/etc/passwd'), /not a relative path/);
  assert.throws(() => entryName('C:/Windows/x'), /not a relative path/);
  assert.throws(() => entryName('../escape.md'), /climbs out/);
  assert.throws(() => entryName(''), /no name/);
});

test('an archive with no entries is refused, not written empty', () => {
  assert.throws(() => buildZip([]), /no entries/);
});

// #348: the writer met the ZIP field limits only when Buffer refused a write - a raw
// ERR_OUT_OF_RANGE after every entry was hashed and deflated - and at exactly 65,535 entries
// it wrote the ZIP64 sentinel as a count, an archive its own reader then refused. The bounds
// are now refused by name, before any work, and exclude the sentinels.
test('#348 an archive the ZIP format cannot carry is refused by name, never as ERR_OUT_OF_RANGE', () => {
  const byName = (pattern) => (err) => {
    assert.notEqual(err.code, 'ERR_OUT_OF_RANGE', `a raw RangeError escaped: ${err.message}`);
    assert.match(err.message, pattern);
    return true;
  };
  const many = Array.from({ length: 65_535 }, (_, i) => ({ name: `f${i}`, data: 'x' }));
  assert.throws(() => buildZip(many), byName(/65535 entries.*65534/));
  assert.throws(() => buildZip([{ name: 'a'.repeat(65_536), data: 'x' }]), byName(/name is 65536 bytes.*65535/));
  assert.throws(() => buildZip([{ name: '\u65e5'.repeat(21_846), data: 'x' }]), byName(/name is 65538 bytes/));
  // 65,534 entries is the most the writer may emit, and the kit's reader must open a count
  // that high. Built stored by rawZip: deflating 65,534 entries through buildZip took 100 s.
  const most = rawZip(many.slice(1));
  assert.equal(readCentralDirectory(most, { limits: { ...ZIP_LIMITS, maxEntries: 65_534 } }).totalEntries, 65_534);
});

test('#348 entry data is a string or bytes - a Uint8Array is stored as its bytes, anything else is refused', () => {
  const [entry] = readZip(buildZip([{ name: 'bytes.bin', data: new Uint8Array([1, 2, 3]) }]));
  assert.equal(entry.text, '\u0001\u0002\u0003', 'a Uint8Array was stored as its decimal digits');
  for (const data of [null, undefined, 42, { a: 1 }]) {
    assert.throws(() => buildZip([{ name: 'x.md', data }]), /data must be a string or bytes/, `${JSON.stringify(data)} was stored`);
  }
});

/** A minimal reader, standing in for the operator's unzip tool. */
function readZip(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(end, -1, 'no end-of-central-directory record');
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50, 'central directory signature');
    const method = bytes.readUInt16LE(at + 10);
    const sum = bytes.readUInt32LE(at + 16);
    const compressed = bytes.readUInt32LE(at + 20);
    const uncompressed = bytes.readUInt32LE(at + 24);
    const nameLen = bytes.readUInt16LE(at + 28);
    const offset = bytes.readUInt32LE(at + 42);
    const name = bytes.slice(at + 46, at + 46 + nameLen).toString('utf8');

    const localName = bytes.readUInt16LE(offset + 26);
    const localExtra = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const raw = bytes.slice(start, start + compressed);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;

    assert.equal(data.length, uncompressed, `${name}: size disagrees with the directory`);
    assert.equal(crc32(data), sum, `${name}: CRC disagrees with the directory`);
    out.push({ name, text: data.toString('utf8'), method, flags: bytes.readUInt16LE(at + 8), localFlags: bytes.readUInt16LE(offset + 6) });
    at += 46 + nameLen + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return out;
}

test('every entry reads back out of the central directory intact', () => {
  const entries = [
    { name: 'one.md', data: `# One\n${'deflate shrinks markdown by about seventy percent. '.repeat(50)}` },
    { name: 'two.md', data: 'x' },
  ];
  const read = readZip(buildZip(entries));
  assert.deepEqual(read.map((e) => e.name), ['one.md', 'two.md']);
  assert.equal(read[0].text, entries[0].data);
  assert.equal(read[1].text, 'x');
  assert.equal(read[0].method, 8, 'a compressible payload deflates');
  assert.equal(read[1].method, 0, 'a payload deflate would only grow is stored');
});

test('two runs produce byte-identical archives, so re-zipping is free', () => {
  const entries = [{ name: 'a.md', data: 'same bytes every time' }];
  assert.ok(buildZip(entries).equals(buildZip(entries)));
});

test('UTF-8 names declare their encoding in both ZIP headers', () => {
  const names = ['ascii.md', 'docs/über-日本語.md'];
  const entries = readZip(buildZip(names.map((name) => ({ name, data: 'contents' }))));
  assert.deepEqual(entries.map((entry) => entry.name), names);
  for (const entry of entries) {
    assert.equal(entry.flags & 0x0800, 0x0800, `${entry.name}: central UTF-8 flag`);
    assert.equal(entry.localFlags & 0x0800, 0x0800, `${entry.name}: local UTF-8 flag`);
  }
});

// --- the audit ---------------------------------------------------------------------

test('an audit renders only when the gate passes', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('CLOSED', 'OPEN'));
  const refused = writeAudit(dir);
  assert.equal(refused.written, false);
  assert.match(refused.reason, /the gate fails/);
  assert.equal(fs.existsSync(resolve(dir, PATHS.audits)), false);
});

test('a pass renders the main audit plus one file per COVERED/GAP subtopic', () => {
  const dir = makePassingProject();
  const result = writeAudit(dir);
  assert.equal(result.written, true, result.reason);
  assert.equal(result.version, '0.1');

  const covered = readCorpus(dir).subtopics.filter((s) => s.status === 'COVERED' || s.status === 'GAP');
  assert.equal(result.subtopics.length, covered.length);
  assert.equal(result.subtopics.length, 5, 'four COVERED plus no GAP in this fixture');

  const main = readText(resolve(dir, result.main));
  assert.match(main, /## Blocking unknowns/);
  assert.match(main, /## Evidence/);
  assert.match(main, /firecrawl-cli/, 'the transport of each capture is in the snapshot');
  assert.match(main, /Gate:\*\* PASS/);
});

test('the audit is DERIVED: it never writes back into the corpus', () => {
  const dir = makePassingProject();
  const before = {
    discovery: readText(resolve(dir, PATHS.discovery)),
    evidence: readText(resolve(dir, PATHS.evidence)),
    ledger: readText(resolve(dir, PATHS.ledger)),
  };
  writeAudit(dir);
  assert.equal(readText(resolve(dir, PATHS.discovery)), before.discovery);
  assert.equal(readText(resolve(dir, PATHS.evidence)), before.evidence);
  assert.equal(readText(resolve(dir, PATHS.ledger)), before.ledger);
});

test('an unchanged corpus keeps its version; a changed one earns the next', () => {
  const dir = makePassingProject();
  writeAudit(dir);

  const again = writeAudit(dir);
  assert.equal(again.written, false);
  assert.match(again.reason, /unchanged since v0\.1/);

  corrupt(dir, PATHS.evidence, (text) => text.replace('The free plan allows', 'Rewritten: the free plan allows'));
  const bumped = writeAudit(dir);
  assert.equal(bumped.version, '0.2');
});

test('the fingerprint tracks what an audit says, not when it was written', () => {
  const dir = makePassingProject();
  const one = fingerprintOf(readCorpus(dir));
  assert.equal(one, fingerprintOf(readCorpus(dir)));
  corrupt(dir, PATHS.discovery, (text) => text.replace('CLOSED', 'KNOWN-UNKNOWN'));
  assert.notEqual(one, fingerprintOf(readCorpus(dir)));
});

test('listVersions and resolveVersion are THE readers, with one ordering', () => {
  const dir = makePassingProject();
  writeAudit(dir);
  corrupt(dir, PATHS.evidence, (text) => text.replace('The free plan', 'Revised: the free plan'));
  writeAudit(dir);

  const { known, topics } = listVersions(dir);
  assert.deepEqual(known, ['fixture-topic']);
  assert.deepEqual(topics[0].versions, ['0.1', '0.2'], 'versions sort numerically, not lexically');
  assert.equal(topics[0].latest, '0.2');

  assert.equal(resolveVersion(dir, 'fixture-topic').version, '0.2', 'no version named means the latest');
  assert.equal(resolveVersion(dir, 'fixture-topic', '0.1').version, '0.1');
  assert.equal(resolveVersion(dir, 'nope'), null);
});

test('versions sort numerically: v0.10 comes after v0.9', () => {
  const dir = makePassingProject();
  writeAudit(dir);
  const manifest = readManifest(dir);
  const record = manifest.topics['fixture-topic'];
  for (const version of ['0.9', '0.10']) {
    record.versions[version] = { date: '2026-09-17', fingerprint: version, main: `${PATHS.audits}/x-v${version}.md`, subtopics: [] };
  }
  writeText(resolve(dir, `${PATHS.audits}/index.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  assert.deepEqual(listVersions(dir).topics[0].versions, ['0.1', '0.9', '0.10']);
});

// --- the bundle --------------------------------------------------------------------

test('the bundle holds the latest main audit and its subtopics, and is named for them', () => {
  const dir = makePassingProject();
  const rendered = writeAudit(dir);
  const bundle = zipAudit(dir);

  assert.equal(bundle.ok, true, bundle.reason);
  assert.match(bundle.file, /research\/audits\/fixture-topic-v0\.1-\d{4}-\d{2}-\d{2}\.zip$/);
  assert.equal(bundle.count, rendered.subtopics.length + 1);

  const read = readZip(fs.readFileSync(resolve(dir, bundle.file)));
  assert.equal(read.length, rendered.subtopics.length + 1);
  assert.ok(read.some((e) => e.text.includes('## Blocking unknowns')));
});

test('the file list comes from the manifest, never a directory listing', () => {
  const dir = makePassingProject();
  writeAudit(dir);
  corrupt(dir, PATHS.evidence, (text) => text.replace('The free plan', 'Revised: the free plan'));
  const second = writeAudit(dir);

  const bundle = zipAudit(dir);
  assert.equal(bundle.version, '0.2');
  assert.equal(bundle.count, second.subtopics.length + 1,
    'v0.1 is still sitting beside v0.2 on disk and must not be swept in');
});

test('a manifest naming a file that is not on disk is REFUSED, not bundled short', () => {
  const dir = makePassingProject();
  const rendered = writeAudit(dir);
  fs.rmSync(resolve(dir, rendered.subtopics[0]));

  const bundle = zipAudit(dir);
  assert.equal(bundle.ok, false);
  assert.match(bundle.reason, /refusing to bundle short/);
  assert.match(bundle.fix, /bin[\\/]audit\.mjs/, 'the command that makes one, in this platform path spelling');
});

// Found 2026-09-28 (break-test): the 2026-09-14 writer stored a version as
// {file: <basename>, scope, at, ...} and held subtopics under the TOPIC; the current
// reader expected {main, subtopics} on the version itself. Every audit shipped before the
// rename - including this repository's own - was refused by --show and --zip, and the
// refusal interpolated held.main as the literal word "undefined". resolveVersion reads
// either shape, basenames resolving against research/audits.
test('an audit manifest in the 2026-09-14 shape still shows and zips', () => {
  const dir = tempDir('fp-old-manifest-');
  const audits = resolve(dir, PATHS.audits);
  fs.mkdirSync(audits, { recursive: true });
  fs.writeFileSync(resolve(audits, 'old-shape-v0.1-2026-09-14.md'), '# the main audit\n## Blocking unknowns\nnone\n');
  fs.writeFileSync(resolve(audits, 'old-shape--d-1-v0.1-2026-09-14.md'), '# a subtopic audit\n');
  fs.writeFileSync(resolve(audits, 'index.json'), JSON.stringify({
    topics: {
      'old-shape': {
        latest: '0.1',
        versions: {
          0.1: { file: 'old-shape-v0.1-2026-09-14.md', scope: 'full', at: '2026-09-14T20:30:57.908Z', date: '2026-09-14', evidenceCount: 6, closedUnknowns: 4, knownUnknowns: 0, failures: 0, fingerprint: 'x' },
        },
        subtopics: {
          'd-1': { versions: { 0.1: { file: 'old-shape--d-1-v0.1-2026-09-14.md', scope: 'subtopic', at: '2026-09-14T20:30:57.909Z', date: '2026-09-14', fingerprint: 'y' } }, latest: '0.1', id: 'D-1', subtopic: 'Old' },
        },
      },
    },
  }));

  const resolved = resolveVersion(dir, 'old-shape');
  assert.equal(resolved.main, `${PATHS.audits}/old-shape-v0.1-2026-09-14.md`);
  assert.deepEqual(resolved.subtopics, [`${PATHS.audits}/old-shape--d-1-v0.1-2026-09-14.md`]);
  assert.equal(readText(resolve(dir, resolved.main)).includes('# the main audit'), true, '--show reads the same spelling');

  const bundle = zipAudit(dir);
  assert.equal(bundle.ok, true, bundle.reason);
  assert.equal(bundle.count, 2, 'one main plus one topic-held subtopic');
  const read = readZip(fs.readFileSync(resolve(dir, bundle.file)));
  assert.ok(read.some((e) => e.text.includes('# the main audit')), 'the old main audit is in the bundle');
  assert.ok(read.some((e) => e.text.includes('# a subtopic audit')), 'the old subtopic audit is in the bundle');
});

// #304 (2026-10-17): this repository's committed audit (v0.1, 2026-09-14) is keyed
// `fetchproofs-own-protocol-metered-primary-sourc`; makeSlug has since changed, and spells the
// same topic `fetchproof-s-own-protocol-metered-primary-source-collection`. writeAudit looked
// the record up by makeSlug alone, so the next render started a second topic at v0.1 and every
// later --zip and --show needed --topic. A record that predates the stored topic text is
// continued under the slug it already has when it is the SAME topic: keyed by the old
// spelling of it (apostrophes dropped, cut at 46), or naming it in its main audit.

/** A project whose map topic is `topic`, holding one 2026-09-14-shape audit record under `key`. */
function oldShapeProject(topic, key, mainText = '# the main audit\n') {
  const dir = makePassingProject();
  const map = resolve(dir, PATHS.map);
  writeText(map, readText(map).replace(/^## Topic\n\n.+$/m, `## Topic\n\n${topic}`));
  assert.equal(readCorpus(dir).map.topic, topic, 'the fixture did not set the map topic');
  const audits = resolve(dir, PATHS.audits);
  fs.mkdirSync(audits, { recursive: true });
  fs.writeFileSync(resolve(audits, `${key}-v0.1-2026-09-14.md`), mainText);
  fs.writeFileSync(resolve(audits, 'index.json'), JSON.stringify({
    topics: {
      [key]: {
        latest: '0.1',
        versions: { 0.1: { file: `${key}-v0.1-2026-09-14.md`, scope: 'full', at: '2026-09-14T20:30:57.908Z', date: '2026-09-14', fingerprint: 'x' } },
      },
    },
  }));
  return dir;
}

test('a render continues a 2026-09-14-shape record whose slug makeSlug no longer produces', () => {
  const topic = 'The fixture\'s own protocol: metered primary-source collection, provenance';
  const old = 'the-fixtures-own-protocol-metered-primary-sour';
  assert.notEqual(makeSlug(topic), old);
  const dir = oldShapeProject(topic, old);

  const rendered = writeAudit(dir, { date: '2026-10-17' });
  assert.equal(rendered.written, true, rendered.reason);
  assert.equal(rendered.slug, old, 'the render started a new topic instead of continuing the old one');
  assert.equal(rendered.version, '0.2');
  assert.deepEqual(rendered.continued, { from: makeSlug(topic), as: old });
  assert.equal(rendered.main, `${PATHS.audits}/${old}-v0.2-2026-10-17.md`);

  const listed = listVersions(dir);
  assert.deepEqual(listed.known, [old], 'the manifest holds two topics');
  assert.equal(listed.topics[0].latest, '0.2');
  assert.equal(listed.topics[0].topic, topic, 'the continued record does not carry the topic text');
  assert.equal(resolveVersion(dir, old, '0.1').main, `${PATHS.audits}/${old}-v0.1-2026-09-14.md`, 'v0.1 is no longer readable');

  const bundle = zipAudit(dir);
  assert.equal(bundle.ok, true, bundle.reason);
  assert.equal(bundle.version, '0.2');
});

// ADR-0186 (2026-10-20): the rename re-keyed this repository's own record. A key mapped by the
// spelling map, not derived again from the renamed topic, matched neither slug, so the next root
// audit started a second chain at v0.1. The fixtures above could not see that; this reads the
// repository's own research/, on a copy.
test("this repository's own audit record is continued by the next render, not started again", () => {
  const dir = tempDir();
  fs.cpSync(path.resolve(KIT_ROOT, '..', 'research'), resolve(dir, 'research'), { recursive: true });
  const before = listVersions(dir);
  assert.equal(before.known.length, 1, `the repository's audits hold ${before.known.length} topics`);
  const [key] = before.known;

  const rendered = writeAudit(dir, { date: '2026-10-20', force: true });
  assert.equal(rendered.written, true, rendered.reason);
  assert.equal(rendered.slug, key, "the render started a new topic instead of continuing the repository's record");
  assert.notEqual(rendered.version, '0.1');
  assert.deepEqual(listVersions(dir).known, [key], 'the manifest holds two topics');
});

test('an old record whose main audit names this topic is continued, whatever its key', () => {
  const dir = oldShapeProject('Fixture topic', 'fixture-topic-other-spelling', '---\ntitle: "Fixture topic"\ntopic: "Fixture topic"\n---\n# the main audit\n');
  const rendered = writeAudit(dir, { date: '2026-10-17' });
  assert.equal(rendered.slug, 'fixture-topic-other-spelling');
  assert.equal(rendered.version, '0.2');
});

// Review of #304 (2026-10-18): the first version continued ANY lone old-shape record, whatever
// topic it held, and stamped this topic's text onto it.
test('a lone old record of another topic is not continued, and keeps its own text', () => {
  const dir = oldShapeProject('Fixture topic', 'an-earlier-question', '---\ntopic: "An earlier question"\n---\n# the main audit\n');
  const rendered = writeAudit(dir, { date: '2026-10-17' });
  assert.equal(rendered.slug, makeSlug('Fixture topic'));
  assert.equal(rendered.version, '0.1');
  assert.equal(rendered.continued, undefined);
  const listed = listVersions(dir);
  assert.deepEqual(listed.known, ['an-earlier-question', 'fixture-topic']);
  assert.equal(readManifest(dir).topics['an-earlier-question'].topic, undefined, 'this topic was stamped on another record');
});

test('a record holding this topic text under another slug is continued, beside other topics', () => {
  const dir = makePassingProject();
  const topic = readCorpus(dir).map.topic;
  const audits = resolve(dir, PATHS.audits);
  fs.mkdirSync(audits, { recursive: true });
  const record = (name, text) => ({ topic: text, latest: '0.1', versions: { 0.1: { date: '2026-09-14', fingerprint: 'x', main: `${PATHS.audits}/${name}-v0.1-2026-09-14.md`, subtopics: [] } } });
  fs.writeFileSync(resolve(audits, 'index.json'), JSON.stringify({
    topics: { 'same-text-old-slug': record('same-text-old-slug', topic), 'another-topic': record('another-topic', 'Another topic') },
  }));
  const rendered = writeAudit(dir);
  assert.equal(rendered.slug, 'same-text-old-slug');
  assert.equal(rendered.version, '0.2');
  assert.deepEqual(listVersions(dir).known, ['another-topic', 'same-text-old-slug']);
});

// A record that carries its topic text and a DIFFERENT one is another topic, not a re-spelling:
// a refined topic line still starts its own chain (cli.test.mjs, 2026-09-30).
test('a one-record manifest holding a different topic text is not continued', () => {
  const dir = makePassingProject();
  const audits = resolve(dir, PATHS.audits);
  fs.mkdirSync(audits, { recursive: true });
  fs.writeFileSync(resolve(audits, 'index.json'), JSON.stringify({
    topics: { 'another-topic': { topic: 'Another topic', latest: '0.1', versions: { 0.1: { date: '2026-09-14', fingerprint: 'x', main: `${PATHS.audits}/another-topic-v0.1-2026-09-14.md`, subtopics: [] } } } },
  }));
  const rendered = writeAudit(dir);
  assert.equal(rendered.written, true, rendered.reason);
  assert.equal(rendered.slug, makeSlug(readCorpus(dir).map.topic));
  assert.equal(rendered.version, '0.1');
  assert.equal(rendered.continued, undefined);
});

test('a version with no audit file recorded is named as such, not interpolated as undefined', () => {
  const dir = tempDir('fp-no-file-manifest-');
  const audits = resolve(dir, PATHS.audits);
  fs.mkdirSync(audits, { recursive: true });
  fs.writeFileSync(resolve(audits, 'index.json'), JSON.stringify({
    topics: { 'no-file': { latest: '0.1', versions: { 0.1: { date: '2026-09-14', fingerprint: 'x' } } } },
  }));

  const bundle = zipAudit(dir);
  assert.equal(bundle.ok, false);
  assert.match(bundle.reason, /records no audit file for "no-file" v0\.1/);
  assert.ok(!bundle.reason.includes('undefined'), 'the literal word undefined is not the diagnosis');
});

test('no audits at all: refused, with the command that makes one', () => {
  const bundle = zipAudit(makePassingProject());
  assert.equal(bundle.ok, false);
  assert.equal(bundle.exit, 1);
  assert.match(bundle.fix, /bin[\\/]audit\.mjs/, 'the command that makes one, in this platform path spelling');
});

test('several topics and none named: refused, every topic listed, --topic offered', () => {
  const dir = makePassingProject();
  writeAudit(dir);
  const manifest = readManifest(dir);
  manifest.topics['another-topic'] = { topic: 'Another', latest: '0.1', versions: { '0.1': { date: '2026-09-17', fingerprint: 'x', main: 'research/audits/a.md', subtopics: [] } } };
  writeText(resolve(dir, `${PATHS.audits}/index.json`), `${JSON.stringify(manifest, null, 2)}\n`);

  const bundle = zipAudit(dir);
  assert.equal(bundle.ok, false);
  assert.equal(bundle.exit, 2, 'a usage question, not a failure');
  assert.deepEqual(bundle.known.sort(), ['another-topic', 'fixture-topic']);
  assert.match(bundle.fix, /--topic/);
});

test('an exact --topic wins; only a non-exact input falls back to prefix matching', () => {
  const dir = makePassingProject();
  writeAudit(dir);
  const manifest = readManifest(dir);
  manifest.topics['fixture-topic-legacy'] = { topic: 'Legacy', latest: '0.1', versions: { '0.1': { date: '2026-09-17', fingerprint: 'y', main: manifest.topics['fixture-topic'].versions['0.1'].main, subtopics: [] } } };
  writeText(resolve(dir, `${PATHS.audits}/index.json`), `${JSON.stringify(manifest, null, 2)}\n`);

  const exact = zipAudit(dir, { topic: 'fixture-topic' });
  assert.equal(exact.ok, true, 'an exact name must not come back "ambiguous" because a longer slug extends it');
  assert.equal(exact.slug, 'fixture-topic');

  const ambiguous = zipAudit(dir, { topic: 'fixture-' });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.exit, 2, 'more than one prefix match is a question, not a guess');
});

test('a named topic that does not exist is refused with the known topics listed', () => {
  const dir = makePassingProject();
  writeAudit(dir);
  const bundle = zipAudit(dir, { topic: 'nonexistent' });
  assert.equal(bundle.ok, false);
  assert.equal(bundle.exit, 1);
  assert.deepEqual(bundle.known, ['fixture-topic']);
});

test('the bundle renders nothing and bumps no version', () => {
  const dir = makePassingProject();
  writeAudit(dir);
  const before = readJson(resolve(dir, `${PATHS.audits}/index.json`));
  const markdown = fs.readdirSync(resolve(dir, PATHS.audits)).filter((n) => n.endsWith('.md')).sort();

  zipAudit(dir);

  assert.deepEqual(readJson(resolve(dir, `${PATHS.audits}/index.json`)), before, 'the manifest is not written to');
  assert.deepEqual(fs.readdirSync(resolve(dir, PATHS.audits)).filter((n) => n.endsWith('.md')).sort(), markdown, 'no .md file is created');
});

test('no subtopics is not an error: the archive holds the one main file', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.map, (text) => text.replace(/COVERED/g, 'DISMISSED').replace(/\| U-1 \|/g, '| out of scope for this fixture |'));
  const rendered = writeAudit(dir);
  assert.equal(rendered.subtopics.length, 0);

  const bundle = zipAudit(dir);
  assert.equal(bundle.ok, true);
  assert.equal(bundle.count, 1);
});

// ---------------------------------------------------------------- filename budget
//
// Windows MAX_PATH is 260 for tools without long-path support, and the project root
// counts against it. This repository's own audit files are 114-character relative paths
// under a 157-character root - 272 absolute - and `git add` refused until
// `core.longpaths` was set. The files already written are left alone; the generator is
// what stops producing more of them.

test('makeSlug trims AFTER truncating, so a cut never leaves a dangling separator', () => {
  // It trimmed first, so a slice landing on a hyphen kept it. That is why every audit
  // file in this repository is named `...-metered-primary--d-1-access-model-...`, with
  // a double hyphen nobody chose.
  const cut = makeSlug('the research kits own protocol metered primary source collection', 'topic', 47);
  assert.equal(cut.endsWith('-'), false, `a dangling separator survived: ${cut}`);
  assert.equal(/--/.test(`${cut}-d-1-access`), false, 'composing with the cut slug still doubles the separator');
});

test('makeSlug honours an explicit limit and keeps its old default', () => {
  assert.ok(makeSlug('a'.repeat(200)).length <= 60, 'the default cap moved');
  assert.ok(makeSlug('a'.repeat(200), 'topic', 28).length <= 28);
  assert.equal(makeSlug('', 'fallback'), 'fallback');
  assert.equal(makeSlug('!!!', 'fallback'), 'fallback', 'a slug of pure punctuation must fall back');
});

// Found 2026-10-01 (break-test PR #188, latent): makeSlug is documented as a filename-safe
// slug, and returned `con`, `aux`, `lpt1` - names Windows reserves for devices whatever
// follows them, so a file by that base name cannot be created there. No caller hands a bare
// slug to the filesystem today (every audit name composes one with other parts), so nothing
// that exists changes; the contract is closed where it is stated. A reserved name gets a
// prefix inside the slug's own alphabet, on the slug path and the fallback path alike, and
// a cut that lands on one (`console` at limit 3) is caught after the cut.
test('makeSlug never returns a name Windows reserves, on either path or after a cut', () => {
  const reserved = ['con', 'prn', 'aux', 'nul', ...[...Array(10).keys()].flatMap((n) => [`com${n}`, `lpt${n}`])];
  for (const name of reserved) {
    for (const got of [makeSlug(name), makeSlug(name.toUpperCase()), makeSlug('', name), makeSlug('', name.toUpperCase())]) {
      assert.notEqual(got.toLowerCase(), name, `${name} came back as a bare reserved name: ${got}`);
      assert.match(got, /^[a-z0-9-]+$/i, `the escape left the slug alphabet: ${got}`);
      assert.ok(got.length <= 60, `the escape broke the limit: ${got}`);
    }
  }
  assert.equal(makeSlug('con'), 'name-con');
  assert.equal(makeSlug('', 'AUX'), 'name-AUX', 'the fallback keeps its case, and still gets the prefix');
  assert.equal(makeSlug('Console', 'topic', 3), 'nam', 'a cut that lands on a reserved name is escaped after the cut, inside the limit');
  assert.equal(makeSlug('con-text'), 'con-text', 'a name that merely starts with one is not reserved');
  assert.equal(makeSlug('com'), 'com', 'com without a digit is not reserved');
});
// Found 2026-09-29 (Arena break test, latent): the fallback came back whole, past the limit the
// caller asked for - a length contract the slug path kept and the fallback path did not.
test('makeSlug keeps its limit when it falls back', () => {
  assert.equal(makeSlug('', 'a-very-long-fallback-name', 6), 'a-very', 'the fallback exceeded the limit');
  assert.equal(makeSlug('!!!', 'ab-cd', 3), 'ab', 'and a cut fallback does not end on a separator');
  assert.equal(makeSlug('', 'topic'), 'topic');
});

test('a generated audit path stays inside the budget, however long the inputs', () => {
  const dir = makePassingProject();
  // Names far longer than anything a person would type.
  writeText(resolve(dir, PATHS.map), readText(resolve(dir, PATHS.map), '')
    .replace(/^# .*$/m, `# ${'Extremely Verbose Research Topic Name '.repeat(6)}`));

  const out = writeAudit(dir, { date: '2026-09-20' });
  assert.equal(out.written, true, out.reason);

  const paths = [out.main, ...(out.subtopics ?? [])];
  assert.ok(paths.length > 0, 'nothing was rendered, so nothing was measured');
  for (const rel of paths) {
    assert.ok(rel.length <= 120,
      `generated a ${rel.length}-character relative path, which leaves no room for a deep project root: ${rel}`);
    assert.equal(/--/.test(rel), false, `a doubled separator survived into ${rel}`);
  }
});

test('the subtopic segment is capped independently of the topic slug', () => {
  assert.ok(SUBTOPIC_SLUG < TOPIC_SLUG, 'the subtopic budget should be the smaller of the two');
  assert.ok(TOPIC_SLUG + SUBTOPIC_SLUG + 'research/audits/'.length + '-v0.1-2026-09-20.md'.length <= 130,
    'the two budgets together no longer fit the documented path ceiling');
});

// Found 2026-09-28 (checking an outside break-test, F-06): writeAudit picked the next
// version from the manifest, wrote the immutable files, then read-modified-wrote the
// manifest - all without the project's lock, so two audits at once could interleave and
// lose a version or collide on an immutable file. It now runs that span under withLock.
test('an audit allocates its version and writes its manifest under the project lock', () => {
  const root = makePassingProject();
  const realWrite = fs.writeFileSync;
  const seen = [];
  fs.writeFileSync = (file, ...rest) => {
    if (String(file).includes('audits')) seen.push({ file: String(file), locked: holdsLock(root) });
    return realWrite(file, ...rest);
  };
  let result;
  try { result = writeAudit(root); } finally { fs.writeFileSync = realWrite; }
  assert.equal(result.written, true, result.reason);
  assert.ok(seen.length >= 2, `expected audit writes, saw ${seen.length}`);
  const unlocked = seen.filter((w) => !w.locked).map((w) => w.file);
  assert.deepEqual(unlocked, [], `written without the lock: ${unlocked.join(', ')}`);
});
