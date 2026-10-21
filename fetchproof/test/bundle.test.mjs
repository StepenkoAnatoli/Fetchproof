// The received archive, and the drift report over it (ADR-0028).
//
// The manifest's digests had never been read by anything, which is why ADR-0022 could
// treat them as a constraint for three days without anyone noticing the constraint was
// already violated. These tests are the difference between a record and a decoration.

import crypto from 'node:crypto';
import { test, describe, assert, tempDir, fs, path, KIT_ROOT } from './harness.mjs';
import {
  parseManifest, sha256Of, verifyBundle, bundleSummary, EXPECTED_TO_DRIFT, BUNDLE_INDEX,
} from '../lib/bundle.mjs';

describe('bundle');

function digest(text) {
  return crypto.createHash('sha256').update(Buffer.from(text)).digest('hex');
}

/** A project with a manifest and the files it names. */
function archive(files, { expected = [] } = {}) {
  const root = tempDir('fp-bundle-');
  const lines = [];
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    lines.push(`${digest(content)}  ${file.split(path.sep).join('/')}`);
  }
  fs.writeFileSync(path.join(root, BUNDLE_INDEX), `# index\n\n${lines.join('\n')}\n`);
  return { root, expected };
}

test('parseManifest reads sha256/path pairs and ignores the prose around them', () => {
  const rows = parseManifest([
    '# Project planning and handoff bundle index',
    '',
    'This generated file is the navigation index.',
    '1. [AGENTS.md](AGENTS.md)',
    `${'a'.repeat(64)}  AGENTS.md`,
    `${'b'.repeat(64)}  docs/ARCHITECTURE.md`,
    'not a hash  something.md',
    `${'c'.repeat(63)}  too-short.md`,
  ].join('\n'));

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { sha256: 'a'.repeat(64), file: 'AGENTS.md' });
  assert.deepEqual(rows[1], { sha256: 'b'.repeat(64), file: 'docs/ARCHITECTURE.md' });
});

test('parseManifest requires the two-space separator sha256sum actually writes', () => {
  // One space is a different format, and accepting it would silently admit hand-edited
  // lines that no tool produced.
  assert.deepEqual(parseManifest(`${'a'.repeat(64)} single-space.md`), []);
});

test('sha256Of hashes BYTES, not decoded text', () => {
  const root = tempDir('fp-bundle-bytes-');
  // A byte sequence that is not valid utf8. Reading through a string decoder replaces it
  // with U+FFFD and produces a different digest - which is the bug this guards.
  const bytes = Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x0a]);
  fs.writeFileSync(path.join(root, 'raw.bin'), bytes);

  const expected = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256Of(root, 'raw.bin'), expected);
  assert.notEqual(sha256Of(root, 'raw.bin'),
    crypto.createHash('sha256').update(Buffer.from(bytes.toString('utf8'))).digest('hex'),
    'the byte and utf8 digests coincided - pick a better probe');
});

test('sha256Of answers null for a file that is not there, rather than throwing', () => {
  assert.equal(sha256Of(tempDir('fp-bundle-gone-'), 'nope.md'), null);
});

test('an untouched archive verifies clean', () => {
  const { root } = archive({ 'AGENTS.md': 'a', 'docs/x.md': 'b' });
  const r = verifyBundle(root, { expected: [BUNDLE_INDEX] });
  assert.equal(r.ok, true);
  assert.equal(r.unchanged.length, 2);
  assert.deepEqual(r.unexpected, []);
  assert.deepEqual(r.missing, []);
});

test('a file that changed and was EXPECTED to is drift, not a problem', () => {
  const { root } = archive({ 'research/EVIDENCE.md': 'original', 'AGENTS.md': 'a' });
  fs.writeFileSync(path.join(root, 'research/EVIDENCE.md'), 'a row was added');

  const r = verifyBundle(root, { expected: ['research/EVIDENCE.md', BUNDLE_INDEX] });
  assert.equal(r.ok, true, 'expected drift was reported as a problem');
  assert.deepEqual(r.drifted, ['research/EVIDENCE.md']);
  assert.deepEqual(r.unexpected, []);
});

test('a file that changed and was NOT expected to is surfaced', () => {
  const { root } = archive({ 'docs/some-plan.md': 'original', 'AGENTS.md': 'a' });
  fs.writeFileSync(path.join(root, 'docs/some-plan.md'), 'quietly rewritten');

  const r = verifyBundle(root, { expected: [BUNDLE_INDEX] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unexpected, ['docs/some-plan.md']);
  assert.match(bundleSummary(r), /changed UNEXPECTEDLY/);
  assert.match(bundleSummary(r), /docs\/some-plan\.md/);
});

test('a file the archive named and the tree no longer has is reported missing', () => {
  const { root } = archive({ 'docs/removed.md': 'x', 'AGENTS.md': 'a' });
  fs.rmSync(path.join(root, 'docs/removed.md'));

  const r = verifyBundle(root, { expected: [BUNDLE_INDEX] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['docs/removed.md']);
  assert.match(bundleSummary(r), /missing/);
});

test('a project with no manifest says so instead of failing', () => {
  const r = verifyBundle(tempDir('fp-bundle-none-'));
  assert.equal(r.present, false);
  assert.equal(r.ok, false);
  assert.match(r.reason, new RegExp(BUNDLE_INDEX));
  assert.deepEqual(r.rows, [], 'an absent manifest should not invent rows');
});

test('the drift list covers the corpus, the map and the ADR index - and itself', () => {
  // Each of these moves because a rule in this project SAYS it must: the collector writes
  // the corpus, ADR-0007 moves the map with the code. Listing them is the distinction
  // between "changed because the kit ran" and "changed and nobody knows why".
  for (const file of [
    'research/EVIDENCE.md', 'research/DISCOVERY.md', 'research/BRIEF.md',
    'research/MAP.md', 'research/SOURCES.md', 'research/plan.json',
    'docs/ARCHITECTURE.md', 'docs/adr/README.md',
  ]) {
    assert.ok(EXPECTED_TO_DRIFT.includes(file), `${file} is not in EXPECTED_TO_DRIFT`);
  }
  assert.ok(EXPECTED_TO_DRIFT.includes(BUNDLE_INDEX),
    'the index cannot record its own digest and be correct about it');
});

test('EXPECTED_TO_DRIFT does not cover a planning document', () => {
  // The list is a narrow exemption, not a blanket one. If it ever grows to include the
  // planning documents, the report stops being able to say anything.
  const planning = EXPECTED_TO_DRIFT.filter((f) => f.startsWith('docs/superpowers/') || /review|plan-|spec-/.test(f));
  assert.deepEqual(planning, [], 'a planning document was exempted from drift reporting');
});

test('THIS repository: every change against the archive is accounted for', () => {
  // The live assertion, and the one ADR-0028 rests on. Nine of eighty files have moved,
  // and every one of them is a file the project's own rules require to move. If somebody
  // edits a planning document without saying why, this fails.
  // KIT_ROOT rather than a hand-rolled URL-to-path conversion: this project lives under a
  // directory whose name has spaces, and `new URL(import.meta.url).pathname` hands back
  // percent-encoding that looks like a path right up until it is used as one.
  const here = path.resolve(KIT_ROOT, '..');
  const r = verifyBundle(here);
  assert.equal(r.present, true, `no ${BUNDLE_INDEX} found at ${here}`);
  assert.deepEqual(r.unexpected, [], 'a bundled document changed with no rule requiring it');
  assert.deepEqual(r.missing, [], 'a bundled document is gone');
  assert.ok(r.unchanged.length > 60, `only ${r.unchanged.length} files still match - that is a bigger change than ADR-0028 describes`);
});
