// The offline artifact validator, against a package that is trying to lie to it.
//
// The table below IS the fixture set. Each case names a mutation and the verdict it must
// produce, so adding a case is one row and one closure rather than a binary file nobody
// can review. Everything runs offline, reads no credential, and writes only into a temp
// directory the harness removes.

import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { test, describe, assert, fs, path, os, cleanup, tempDir, requirePython } from './harness.mjs';
import { sha256, canonicalJson } from '../lib/core.mjs';
import { validateArtifact, authorizationProblems, SUPPORTED_FORMAT_MAJOR } from '../lib/artifact-validator.mjs';
import { legacyBriefInputsHash } from '../lib/artifact-state.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { ZIP_LIMITS, openZip, checkEntryName } from '../lib/artifact-zip.mjs';
import { crc32 } from '../lib/archive.mjs';
import {
  rawZip, seal, basePackage, collectedProject, approvedProject, writeFixture,
} from './artifact-fixtures.mjs';

describe('artifact-validator');

const scratch = tempDir('fp-fixtures-');

const collected = basePackage(collectedProject());
const approvedRoot = approvedProject();
const approved = basePackage(approvedRoot);

/** Deep clone through canonical JSON, so a mutation cannot leak into the next fixture. */
const clone = (value) => JSON.parse(canonicalJson(value));
const copyPayload = (payload) => payload.map((e) => ({ name: e.name, data: Buffer.from(e.data) }));

const text = (s) => Buffer.from(s, 'utf8');

test('relabelled evidence still requires and verifies its ledger from package contents', () => {
  for (const variant of ['missing-ledger', 'invalid-ledger', 'rows-without-captures']) {
    const manifest = clone(collected.manifest);
    let payload = copyPayload(collected.payload);
    manifest.collection.captures = 0;
    manifest.files = manifest.files.map((entry) => entry.role === 'RAW_CAPTURE' ? { ...entry, role: 'OTHER' } : entry);
    if (variant === 'invalid-ledger') {
      const ledger = payload.find((entry) => entry.name.endsWith('.fetches.jsonl'));
      ledger.data = text('{"garbage":true}\n');
      const declared = manifest.files.find((entry) => entry.path === ledger.name);
      declared.byteLength = ledger.data.length;
      declared.sha256 = sha256(ledger.data);
    } else {
      const removed = new Set(payload.filter((entry) => entry.name.endsWith('.fetches.jsonl')
        || (variant === 'rows-without-captures' && entry.name.startsWith('project/research/raw/'))).map((entry) => entry.name));
      payload = payload.filter((entry) => !removed.has(entry.name));
      manifest.files = manifest.files.filter((entry) => !removed.has(entry.path));
    }
    const file = writeFixture(scratch, variant, seal(payload, manifest, { recomputeFiles: false }));
    const report = validateArtifact({ file, tempRoot: scratch });
    assert.equal(report.status, 'FAIL', variant);
    assert.equal(report.buildAuthorized, false);
    const code = variant === 'invalid-ledger' ? 'LEDGER-INVALID' : 'LEDGER-MISSING';
    assert.ok(report.errors.some((error) => error.code === code), JSON.stringify(report.errors));
  }
});

function legacyApproved({ formatVersion = '1.0.0', explicitUnknown = false, changedInput = false, unstamped = false } = {}) {
  const manifest = clone(approved.manifest);
  manifest.formatVersion = formatVersion;
  const payload = copyPayload(approved.payload);
  const brief = payload.find((entry) => entry.name === 'project/research/BRIEF.md');
  if (unstamped) {
    brief.data = text(brief.data.toString('utf8').replace(/\n?<!-- fetchproof:brief-draft[^>]*-->\s*/g, '\n'));
  } else {
    const marker = brief.data.toString('utf8').match(/<!-- fetchproof:brief-draft body=([0-9a-f]{16}) inputs=[0-9a-f]{16}(?: gate=(?:pass|fail|unknown))? -->/);
    assert.ok(marker, 'approved fixture has a current draft marker');
    const inputs = legacyBriefInputsHash(readCorpus(approvedRoot));
    brief.data = text(brief.data.toString('utf8').replace(marker[0],
      `<!-- fetchproof:brief-draft body=${marker[1]} inputs=${inputs}${explicitUnknown ? ' gate=unknown' : ''} -->`));
  }
  if (changedInput) {
    const evidence = payload.find((entry) => entry.name === 'project/research/EVIDENCE.md');
    evidence.data = text(evidence.data.toString('utf8').replace('1,000 included credits', '1,001 included credits'));
  }
  return { payload, manifest };
}

test('claimed approval is refused when the packaged corpus has not earned it', () => {
  for (const variant of ['unreviewed-corpus', 'opened-contract', 'blank-raw-extractor-finding']) {
    const base = variant === 'unreviewed-corpus' ? collected : approved;
    const manifest = clone(base.manifest);
    const payload = copyPayload(base.payload);
    manifest.state = 'APPROVED_BRIEF';
    manifest.kind = 'APPROVED_RESEARCH';
    manifest.buildAuthorized = true;
    manifest.review = { ...manifest.review, mapClassified: true, findingsReviewed: true, briefReviewed: true, by: 'agent' };
    manifest.gate = { ...manifest.gate, verdict: 'PASS', buildAuthorized: true, blockingFindings: [] };
    if (variant === 'opened-contract') {
      const entry = payload.find((file) => file.name === 'project/research/DISCOVERY.md');
      entry.data = text(entry.data.toString('utf8').replace('CLOSED', 'OPEN'));
    } else if (variant === 'blank-raw-extractor-finding') {
      const entry = payload.find((file) => file.name === 'project/research/EVIDENCE.md');
      const auto = collected.payload.find((file) => file.name === entry.name).data.toString('utf8');
      entry.data = text(auto.replace(/\| research\/raw\/[^|\r\n]+ \|/g, '|  |'));
      const brief = payload.find((file) => file.name === 'project/research/BRIEF.md');
      brief.data = text(brief.data.toString('utf8').replace(/\n?<!-- fetchproof:brief-draft[^>]*-->\s*/g, '\n'));
    }
    const file = writeFixture(scratch, `forged-${variant}`, seal(payload, manifest));
    const result = validateArtifact({ file, tempRoot: scratch });
    assert.equal(result.status, 'FAIL', variant);
    assert.equal(result.buildAuthorized, false, variant);
    assert.ok(result.errors.some((error) => error.code === 'AUTHORIZATION-INCONSISTENT'), JSON.stringify(result.errors));
  }
});

test('a true approval is re-derived from packaged bytes and reports its portable baseline', () => {
  const file = writeFixture(scratch, 'portable-approved', seal(copyPayload(approved.payload), clone(approved.manifest)));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'PASS');
  assert.equal(result.buildAuthorized, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'PORTABLE-BASELINE'), JSON.stringify(result.warnings));
});

test('a conservative false approval is never upgraded from a package the corpus could authorize', () => {
  const manifest = clone(approved.manifest);
  manifest.state = 'REVIEW_REQUIRED';
  manifest.kind = 'COLLECTED_CORPUS';
  manifest.buildAuthorized = false;
  manifest.review = { ...manifest.review, mapClassified: false, findingsReviewed: false, briefReviewed: false };
  manifest.gate = { ...manifest.gate, verdict: 'NOT_RUN', buildAuthorized: false };
  const file = writeFixture(scratch, 'conservative-not-upgraded', seal(copyPayload(approved.payload), manifest));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'PASS');
  assert.equal(result.buildAuthorized, false);
  assert.ok(!result.warnings.some((warning) => warning.code === 'PORTABLE-BASELINE'));
});

test('a format-1 unstamped approved brief retains ADR-0138 compatibility with unknown currency', () => {
  const { payload, manifest } = legacyApproved({ unstamped: true });
  const file = writeFixture(scratch, 'legacy-unstamped', seal(payload, manifest));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'PASS', JSON.stringify(result.errors));
  assert.equal(result.buildAuthorized, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'PORTABLE-BASELINE'));
  assert.ok(!result.warnings.some((warning) => warning.code === 'BRIEF-LEGACY-COMPATIBLE'));
});

test('a pre-0069 format-1 stamp is accepted only with its exact covered-input hash', () => {
  // The recorded writer probe used October 13 inputs. Keep that reference sample
  // fixed while the packages below use today's inputs and remain fresh.
  const probedCorpus = readCorpus(approvedProject('2026-10-13'));
  assert.equal(legacyBriefInputsHash(probedCorpus), 'e0babc86cec671c9',
    'the dated synthetic corpus matches the actual pre-0069 writer probe');
  const { payload, manifest } = legacyApproved();
  const file = writeFixture(scratch, 'legacy-stamp', seal(payload, manifest));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'PASS', JSON.stringify(result.errors));
  assert.equal(result.buildAuthorized, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'BRIEF-LEGACY-COMPATIBLE'), JSON.stringify(result.warnings));

  for (const variant of [
    ['changed-covered-input', { changedInput: true, formatVersion: '1.0.0' }],
    ['explicit-unknown-is-not-legacy', { explicitUnknown: true, formatVersion: '1.0.0' }],
    ['legacy-stamp-is-format-1-only', { formatVersion: '2.0.0' }],
  ]) {
    const [name, options] = variant;
    const altered = legacyApproved(options);
    const invalidFile = writeFixture(scratch, name, seal(altered.payload, altered.manifest));
    const refused = validateArtifact({ file: invalidFile, tempRoot: scratch });
    assert.equal(refused.status, 'FAIL', name);
    assert.equal(refused.buildAuthorized, false, name);
    assert.ok(refused.errors.some((error) => error.code === 'AUTHORIZATION-INCONSISTENT'), JSON.stringify(refused.errors));
    assert.ok(!refused.warnings.some((warning) => warning.code === 'BRIEF-LEGACY-COMPATIBLE'), name);
  }
});

/**
 * name -> { build, expect }. `expect.code` means "this code must be among the errors",
 * not "this is the only error": a package can be wrong in more than one way and pinning
 * the exact list would make every fixture brittle against an added check.
 */
const FIXTURES = {
  '01-collected-valid': {
    build: () => seal(copyPayload(collected.payload), clone(collected.manifest)),
    expect: { status: 'PASS', buildAuthorized: false },
  },
  '02-approved-valid': {
    build: () => seal(copyPayload(approved.payload), clone(approved.manifest)),
    expect: { status: 'PASS', buildAuthorized: true },
  },
  '03-failed-collection-valid': {
    // A scaffolded project that collected nothing: no captures, no ledger, and that is
    // CORRECT rather than a missing chain. The package exists to carry the diagnosis.
    build: () => {
      const payload = copyPayload(collected.payload)
        .filter((e) => !e.name.startsWith('project/research/raw/'));
      // A genuinely uncollected scaffold has no evidence rows either. Leaving the
      // collected fixture's table here falsely claimed evidence with no chain.
      payload.find((entry) => entry.name === 'project/research/EVIDENCE.md').data = text(
        '# Evidence\n\n| ID | Retrieved | Type | URL | Finding | Raw |\n|---|---|---|---|---|---|\n',
      );
      const manifest = clone(collected.manifest);
      manifest.state = 'COLLECTION_FAILED';
      manifest.kind = 'COLLECTED_CORPUS';
      manifest.collection.result = 'FAILED';
      manifest.collection.captures = 0;
      manifest.collection.completeness = 'NONE';
      manifest.nextActions = [{ id: 'READ_PROBLEMS', label: 'Read what stopped the collection', path: 'reports/problems.json', required: true }];
      return seal(payload, manifest);
    },
    expect: { status: 'PASS', buildAuthorized: false },
  },

  '04-missing-manifest': {
    build: () => seal(copyPayload(collected.payload), clone(collected.manifest), { omitManifest: true }),
    expect: { status: 'FAIL', code: 'MANIFEST-MISSING' },
  },
  '05-invalid-manifest-json': {
    build: () => seal(copyPayload(collected.payload), clone(collected.manifest), { manifestBytes: text('{ "format": "fetchproof-artifact", ') }),
    expect: { status: 'FAIL', code: 'MANIFEST-JSON' },
  },
  '06-duplicate-json-key': {
    // JSON.parse keeps the LAST duplicate silently, so two manifests with different
    // meanings can carry the same digest unless the parser refuses.
    build: () => {
      const body = canonicalJson(clone(collected.manifest));
      const doubled = `{"buildAuthorized":false,${body.slice(1)}`;
      return seal(copyPayload(collected.payload), clone(collected.manifest), { manifestBytes: text(doubled) });
    },
    expect: { status: 'FAIL', code: 'MANIFEST-DUPLICATE-KEY' },
  },
  '07-manifest-hash-mismatch': {
    build: () => seal(copyPayload(collected.payload), clone(collected.manifest), { breakDigest: true }),
    expect: { status: 'FAIL', code: 'MANIFEST-HASH-MISMATCH' },
  },
  '08-file-hash-mismatch': {
    build: () => {
      const payload = copyPayload(collected.payload);
      const manifest = clone(collected.manifest);
      const row = manifest.files.find((f) => f.path === 'project/research/EVIDENCE.md');
      const target = payload.find((e) => e.name === 'project/research/EVIDENCE.md');
      target.data = Buffer.concat([target.data, text('\nan edit nobody declared\n')]);
      // Size stays honest, hash does not: this is the tampering case, not truncation.
      row.byteLength = target.data.length;
      return seal(payload, manifest, { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'FILE-HASH-MISMATCH' },
  },
  '09-file-size-mismatch': {
    build: () => {
      const payload = copyPayload(collected.payload);
      const manifest = clone(collected.manifest);
      manifest.files.find((f) => f.path === 'README-FIRST.md').byteLength += 10;
      return seal(payload, manifest, { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'FILE-SIZE-MISMATCH' },
  },
  '10-declared-file-missing': {
    build: () => {
      const manifest = clone(collected.manifest);
      const payload = copyPayload(collected.payload).filter((e) => e.name !== 'reports/problems.json');
      return seal(payload, manifest, { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'FILE-MISSING' },
  },
  '11-undeclared-file': {
    build: () => {
      const manifest = clone(collected.manifest);
      const payload = copyPayload(collected.payload);
      payload.push({ name: 'project/research/smuggled.md', data: text('# not in the manifest\n') });
      return seal(payload, manifest, { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'FILE-UNDECLARED' },
  },

  '12-path-traversal': {
    build: () => hostile('../escape.md'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '13-absolute-path': {
    build: () => hostile('/absolute.md'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '14-windows-drive-path': {
    build: () => hostile('C:/absolute.md'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '15-backslash-path': {
    build: () => hostile('project\\research\\EVIDENCE.md'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '16-duplicate-entry': {
    build: () => {
      const payload = copyPayload(collected.payload);
      payload.push({ name: 'README-FIRST.md', data: text('# a second one\n') });
      return seal(payload, clone(collected.manifest), { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'ZIP-DUPLICATE' },
  },
  '17-case-collision': {
    build: () => {
      const payload = copyPayload(collected.payload);
      payload.push({ name: 'readme-first.md', data: text('# the same file, differently cased\n') });
      return seal(payload, clone(collected.manifest), { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'ZIP-CASE-COLLISION' },
  },
  '30-file-directory-collision-file-first': {
    build: () => {
      const payload = copyPayload(collected.payload);
      payload.push({ name: 'project/docs/a', data: text('file') });
      payload.push({ name: 'project/docs/a/b.md', data: text('child') });
      return seal(payload, clone(collected.manifest), { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'ZIP-PATH-COLLISION', noTempPath: true },
  },
  '31-file-directory-collision-child-first': {
    build: () => {
      const payload = copyPayload(collected.payload);
      payload.push({ name: 'project/docs/a/b.md', data: text('child') });
      payload.push({ name: 'project/docs/a', data: text('file') });
      return seal(payload, clone(collected.manifest), { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'ZIP-PATH-COLLISION', noTempPath: true },
  },
  // Names another platform reads as a different name (independent audit 2026-11-04, F03):
  // each one extracts onto, or beside, a path the validator judged as a different file.
  '32-empty-segment': {
    build: () => hostile('project/research//EVIDENCE.md'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '33-trailing-dot': {
    build: () => hostile('project/docs/readme.md.'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '34-trailing-space': {
    build: () => hostile('project/docs/report.md '),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '35-alternate-data-stream': {
    build: () => hostile('project/research/EVIDENCE.md::$DATA'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '36-character-windows-replaces': {
    build: () => hostile('project/research/GATE?OFF'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '37-device-name': {
    build: () => hostile('project/docs/CON'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '38-short-name': {
    build: () => hostile('project/research/EVIDEN~1.MD'),
    expect: { status: 'FAIL', code: 'ZIP-PATH' },
  },
  '39-file-directory-collision-in-another-case': {
    build: () => {
      const payload = copyPayload(collected.payload);
      payload.push({ name: 'project/docs/A/child.md', data: text('child') });
      payload.push({ name: 'project/docs/a', data: text('file') });
      return seal(payload, clone(collected.manifest), { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'ZIP-PATH-COLLISION', noTempPath: true },
  },
  '40-unicode-form-collision': {
    build: () => {
      const payload = copyPayload(collected.payload);
      payload.push({ name: 'project/docs/caf\u00e9.md', data: text('composed') });
      payload.push({ name: 'project/docs/cafe\u0301.md', data: text('decomposed') });
      return seal(payload, clone(collected.manifest), { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'ZIP-CASE-COLLISION' },
  },
  '18-unsupported-major-version': {
    build: () => {
      const manifest = clone(collected.manifest);
      manifest.formatVersion = '3.0.0';
      return seal(copyPayload(collected.payload), manifest);
    },
    expect: { status: 'INCOMPLETE', code: 'FORMAT-UNSUPPORTED' },
  },
  '19-client-ref-mismatch': {
    build: () => {
      const manifest = clone(collected.manifest);
      manifest.clientRef = 'someone-elses-job';
      return seal(copyPayload(collected.payload), manifest);
    },
    expect: { status: 'FAIL', code: 'CLIENT-REF-MISMATCH', expectedClientRef: 'my-job' },
  },

  '20-false-build-authorization': {
    // The attack this format exists to stop: a collected corpus asserting permission.
    build: () => {
      const manifest = clone(collected.manifest);
      manifest.buildAuthorized = true;
      manifest.gate.buildAuthorized = true;
      return seal(copyPayload(collected.payload), manifest);
    },
    expect: { status: 'FAIL', code: 'AUTHORIZATION-INCONSISTENT', buildAuthorized: false },
  },
  '21-gate-pass-but-review-incomplete': {
    // Subtler: the gate really did pass, and the three human steps did not happen.
    build: () => {
      const manifest = clone(approved.manifest);
      manifest.review.findingsReviewed = false;
      return seal(copyPayload(approved.payload), manifest);
    },
    expect: { status: 'FAIL', buildAuthorized: false },
  },

  '22-ledger-missing': {
    build: () => {
      const manifest = clone(collected.manifest);
      const payload = copyPayload(collected.payload).filter((e) => !e.name.endsWith('.fetches.jsonl'));
      manifest.files = manifest.files.filter((f) => !f.path.endsWith('.fetches.jsonl'));
      return seal(payload, manifest, { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'LEDGER-MISSING' },
  },
  '23-ledger-chain-broken': {
    build: () => {
      const payload = copyPayload(collected.payload);
      const ledger = payload.find((e) => e.name.endsWith('.fetches.jsonl'));
      const rows = ledger.data.toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
      rows[0].prev = 'f'.repeat(64);          // links to a block that never existed
      ledger.data = text(`${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
      return seal(payload, clone(collected.manifest));
    },
    expect: { status: 'FAIL', code: 'LEDGER-INVALID' },
  },
  '24-capture-missing': {
    build: () => {
      const manifest = clone(collected.manifest);
      const capture = manifest.files.find((f) => f.role === 'RAW_CAPTURE');
      const payload = copyPayload(collected.payload).filter((e) => e.name !== capture.path);
      manifest.files = manifest.files.filter((f) => f.path !== capture.path);
      return seal(payload, manifest, { recomputeFiles: false });
    },
    expect: { status: 'FAIL', code: 'CAPTURE-MISSING' },
  },
  '25-secret-detected': {
    build: () => {
      const payload = copyPayload(collected.payload);
      const target = payload.find((e) => e.name === 'project/research/plan.json');
      // A synthetic key, shaped like the real thing and belonging to nobody.
      target.data = text(`{"topic":"x","notes":"fc-${'a1b2c3d4'.repeat(3)}"}\n`);
      return seal(payload, clone(collected.manifest));
    },
    expect: { status: 'FAIL', code: 'SECRET-DETECTED' },
  },

  '26-excessive-file-count': {
    build: () => {
      const payload = copyPayload(collected.payload);
      for (let i = 0; i < 40; i += 1) payload.push({ name: `project/research/raw/filler-${i}.md`, data: text(`# ${i}\n`) });
      return seal(payload, clone(collected.manifest));
    },
    expect: { status: 'FAIL', code: 'ZIP-SIZE-LIMIT', limits: { ...ZIP_LIMITS, maxEntries: 20 } },
  },
  '27-excessive-uncompressed-size': {
    build: () => seal(copyPayload(collected.payload), clone(collected.manifest)),
    expect: { status: 'FAIL', code: 'ZIP-SIZE-LIMIT', limits: { ...ZIP_LIMITS, maxTotalBytes: 64 } },
  },
  '28-suspicious-compression-ratio': {
    build: () => {
      const payload = copyPayload(collected.payload);
      // Two megabytes of one byte: over the ratio floor, and roughly 1000:1.
      payload.push({ name: 'project/research/raw/bomb.md', data: Buffer.alloc(2 * 1024 * 1024, 0x41), deflate: true });
      return seal(payload, clone(collected.manifest));
    },
    expect: { status: 'FAIL', code: 'ZIP-RATIO-LIMIT' },
  },
  '29-binary-body-is-not-scanned-as-text': {
    // Found 2026-10-02, running `doctor` on a Windows home folder: an ssh executable's
    // PEM marker was reported as a committed key. The same patterns judge a package, and
    // `docs/` is walked whole, so one vendored image or DLL with that string table would
    // FAIL a package that carries no secret. A NUL byte never occurs in text.
    build: () => {
      const payload = copyPayload(collected.payload);
      payload.push({
        name: 'project/docs/vendor/libssh2.dll',
        data: Buffer.concat([
          Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
          text(`-----BEGIN RSA PRIVATE ${'KEY'}----- ${'sk'}-${'0123456789abcdef'}0123`),
          Buffer.from([0x00, 0x00, 0xff]),
        ]),
      });
      return seal(payload, clone(collected.manifest));
    },
    expect: { status: 'PASS', buildAuthorized: false },
  },
};

/** A package whose only fault is one hostile entry name. */
function hostile(name) {
  const payload = copyPayload(collected.payload);
  payload.push({ name, data: text('# somewhere it should not be\n') });
  return seal(payload, clone(collected.manifest), { recomputeFiles: false });
}

// ---------------------------------------------------------------- the table, run

for (const [name, fixture] of Object.entries(FIXTURES)) {
  test(`fixture ${name}`, () => {
    const file = writeFixture(scratch, name, fixture.build());
    const result = validateArtifact({
      file,
      expectedClientRef: fixture.expect.expectedClientRef ?? null,
      limits: fixture.expect.limits ?? ZIP_LIMITS,
      tempRoot: scratch,
    });

    assert.equal(result.status, fixture.expect.status,
      `${name}: expected ${fixture.expect.status}, got ${result.status}`
      + `${result.errors.length ? `\n  ${result.errors.map((e) => `${e.code}: ${e.message}`).join('\n  ')}` : ''}`);

    if (fixture.expect.code) {
      const codes = result.errors.map((e) => e.code);
      assert.ok(codes.includes(fixture.expect.code),
        `${name}: expected error ${fixture.expect.code}, got ${codes.join(', ') || '(none)'}`);
    }
    if (fixture.expect.noTempPath) {
      const diagnostics = result.errors.map((error) => `${error.message} ${error.remedy ?? ''}`).join('\n');
      assert.ok(!diagnostics.includes(scratch) && !/fp-artifact-|EEXIST|ENOTDIR/.test(diagnostics),
        `${name}: structural ZIP error must not expose a materialization temp path`);
    }
    if ('buildAuthorized' in fixture.expect) {
      assert.equal(result.buildAuthorized, fixture.expect.buildAuthorized,
        `${name}: buildAuthorized should be ${fixture.expect.buildAuthorized}`);
    }
  });
}

// ---------------------------------------------------------------- the rule itself

test('a valid COLLECTED corpus is PASS and still forbids building', () => {
  const file = writeFixture(scratch, 'rule-collected', seal(copyPayload(collected.payload), clone(collected.manifest)));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'PASS');
  assert.equal(result.buildAuthorized, false,
    'PASS means the package is internally valid; it must never by itself authorize a build');
});

test('a failed package cannot authorize a build however its fields read', () => {
  // Both claims true AND the package broken: authorization must not survive the failure.
  const manifest = clone(approved.manifest);
  const payload = copyPayload(approved.payload).filter((e) => e.name !== 'reports/problems.json');
  const file = writeFixture(scratch, 'rule-broken-approved', seal(payload, manifest, { recomputeFiles: false }));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.buildAuthorized, false);
});

test('APPROVED_BRIEF requires every review field and an empty blocking list', () => {
  const base = clone(approved.manifest);
  assert.deepEqual(authorizationProblems(base), [], 'the approved fixture should be internally consistent');

  for (const key of ['mapClassified', 'findingsReviewed', 'briefReviewed']) {
    const broken = clone(base);
    broken.review[key] = false;
    assert.ok(authorizationProblems(broken).length, `${key}: false must break authorization`);
  }
  const blocked = clone(base);
  blocked.gate.blockingFindings = [{ code: 'x', message: 'y' }];
  assert.ok(authorizationProblems(blocked).length, 'a blocking finding must break authorization');

  const notPass = clone(base);
  notPass.gate.verdict = 'INCOMPLETE';
  assert.ok(authorizationProblems(notPass).length, 'a non-PASS verdict must break authorization');
});

test('every non-approved state refuses an authorization claim', () => {
  for (const state of ['COLLECTION_FAILED', 'REVIEW_REQUIRED', 'REVIEW_IN_PROGRESS', 'PREFLIGHT_BLOCKED']) {
    const manifest = clone(collected.manifest);
    manifest.state = state;
    manifest.buildAuthorized = true;
    const problems = authorizationProblems(manifest);
    assert.ok(problems.length, `${state} with buildAuthorized: true must be refused`);
  }
});

// ---------------------------------------------------------------- container properties

test('a symlink entry is refused, not followed', () => {
  const payload = copyPayload(collected.payload);
  // 0o120777: S_IFLNK. The body is the link target, which an extractor would honour.
  payload.push({ name: 'project/research/link.md', data: text('/etc/passwd'), unixMode: 0o120777 });
  const file = writeFixture(scratch, 'symlink', seal(payload, clone(collected.manifest), { recomputeFiles: false }));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.errors.some((e) => e.code === 'ZIP-SPECIAL-ENTRY'), 'a symlink must be named as a special entry');
});

test('a lying uncompressed size is caught by zlib, not by trusting the field', () => {
  // The central directory claims one byte; the entry inflates to far more. A reader that
  // believed the field would allocate one byte and be surprised.
  const bytes = rawZip([{ name: 'a.md', data: Buffer.alloc(4 * 1024 * 1024, 0x42), deflate: true, declareSize: 1 }]);
  const zip = openZip(bytes, { limits: { ...ZIP_LIMITS, ratioFloorBytes: 1, maxRatio: 1_000_000 } });
  assert.throws(() => zip.read('a.md'), /inflated to|could not be decompressed/,
    'the declared size must not be taken on trust');
});

// F05 (independent audit 2026-11-04): the reader took each entry's name, method and CRC-32 from
// the central directory, never comparing the local header or the bytes, so a package whose local
// header named README-ALTER.md where the directory lists README-FIRST.md, and one whose two
// CRC-32 fields were zeroed, validated PASS and stayed buildAuthorized - and Python's zipfile,
// like most extractors, refuses both. Where an entry's two headers lie, found as a reader finds
// them, by walking the central directory.
function headersOf(bytes, name) {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < bytes.readUInt16LE(eocd + 10); i += 1) {
    const nameLength = bytes.readUInt16LE(at + 28);
    if (bytes.toString('utf8', at + 46, at + 46 + nameLength) === name) return { central: at, local: bytes.readUInt32LE(at + 42) };
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  throw new Error(`no entry ${name}`);
}

/** The audit's two fixtures, on the approved package: a local name changed, and both CRC-32 fields zeroed. */
function auditFixtures() {
  const renamed = seal(copyPayload(approved.payload), clone(approved.manifest));
  Buffer.from('README-ALTER.md').copy(renamed, headersOf(renamed, 'README-FIRST.md').local + 30);
  const unchecked = seal(copyPayload(approved.payload), clone(approved.manifest));
  const readme = headersOf(unchecked, 'README-FIRST.md');
  unchecked.writeUInt32LE(0, readme.local + 14);
  unchecked.writeUInt32LE(0, readme.central + 16);
  return { renamed, unchecked };
}

test('a local header naming another entry than the directory lists is refused before anything is inflated (audit F05a)', () => {
  const { renamed } = auditFixtures();
  assert.ok(openZip(renamed).problems.some((p) => p.code === 'ZIP-READ' && p.path === 'README-FIRST.md' && p.detail.includes('"README-ALTER.md"')),
    'the container pass, which inflates nothing, did not see it');
  const result = validateArtifact({ file: writeFixture(scratch, 'f05-local-name', renamed), tempRoot: scratch });
  assert.equal(result.status, 'FAIL', JSON.stringify(result.errors));
  assert.equal(result.buildAuthorized, false);
  assert.ok(result.errors.some((e) => e.code === 'ZIP-READ' && e.message.includes('"README-FIRST.md"') && e.message.includes('README-ALTER.md')), JSON.stringify(result.errors));
});

test('each field an extractor takes from a local header must agree with the directory, and no other (audit F05)', () => {
  const problemsAfter = (patch) => {
    const zip = rawZip([{ name: 'a.md', data: 'a body long enough to be worth deflating, a body long enough', deflate: true }]);
    patch(zip, headersOf(zip, 'a.md').local);
    return openZip(zip).problems.map((p) => `${p.code} ${p.detail}`);
  };
  const fields = {
    'the compression method': (zip, at) => zip.writeUInt16LE(0, at + 8),
    encryption: (zip, at) => zip.writeUInt16LE(0x1, at + 6),
    'the UTF-8 name flag': (zip, at) => zip.writeUInt16LE(0x800, at + 6),
    'the CRC-32': (zip, at) => zip.writeUInt32LE(0, at + 14),
    'the compressed size': (zip, at) => zip.writeUInt32LE(zip.readUInt32LE(at + 18) + 1, at + 18),
    'the uncompressed size': (zip, at) => zip.writeUInt32LE(0, at + 22),
  };
  for (const [field, patch] of Object.entries(fields)) {
    const problems = problemsAfter(patch);
    assert.ok(problems.some((p) => p.startsWith('ZIP-READ ') && p.includes(field)), `${field}: ${JSON.stringify(problems)}`);
  }
  // The version needed, the timestamp and a deflate option bit change nothing an extractor writes.
  for (const patch of [(zip, at) => zip.writeUInt16LE(45, at + 4), (zip, at) => zip.writeUInt32LE(0x5a5a5a5a, at + 10), (zip, at) => zip.writeUInt16LE(0x2, at + 6)]) {
    assert.deepEqual(problemsAfter(patch), [], 'a field no extractor writes from was compared');
  }
});

test('an entry whose bytes do not match its CRC-32 is refused, in the manifest as in the payload (audit F05b)', () => {
  const { unchecked } = auditFixtures();
  const result = validateArtifact({ file: writeFixture(scratch, 'f05-crc', unchecked), tempRoot: scratch });
  assert.equal(result.status, 'FAIL', JSON.stringify(result.errors));
  assert.equal(result.buildAuthorized, false);
  assert.ok(result.errors.some((e) => e.code === 'ZIP-READ' && e.message.includes('README-FIRST.md') && e.message.includes('CRC-32')), JSON.stringify(result.errors));
  // The manifest is read before the payload, outside its loop: a body that does not read there is
  // a broken package too, not a validation that could not complete.
  const sealed = seal(copyPayload(approved.payload), clone(approved.manifest));
  const manifest = headersOf(sealed, 'manifest.json');
  sealed.writeUInt32LE(0, manifest.local + 14);
  sealed.writeUInt32LE(0, manifest.central + 16);
  const broken = validateArtifact({ file: writeFixture(scratch, 'f05-crc-manifest', sealed), tempRoot: scratch });
  assert.equal(broken.status, 'FAIL', JSON.stringify(broken.errors));
  assert.ok(broken.errors.some((e) => e.code === 'ZIP-READ' && e.message.includes('manifest.json') && e.message.includes('CRC-32')), JSON.stringify(broken.errors));
});

test('a ZIP that defers its CRC-32 and sizes to a data descriptor is read, and its bytes are still checked (audit F05)', () => {
  const zip = rawZip([
    { name: 'stored.md', data: 'stored body', descriptor: true },
    { name: 'deflated.md', data: 'deflated body, deflated body, deflated body', deflate: true, descriptor: true },
  ]);
  const opened = openZip(zip);
  assert.deepEqual(opened.problems, []);
  assert.equal(opened.read('stored.md').toString('utf8'), 'stored body');
  assert.equal(opened.read('deflated.md').toString('utf8'), 'deflated body, deflated body, deflated body');
  const wrong = Buffer.from(zip);
  wrong.writeUInt32LE(0, headersOf(wrong, 'stored.md').central + 16);
  assert.deepEqual(openZip(wrong).problems, [], 'bit 3 defers the local fields, so only the directory says what the CRC-32 is');
  assert.throws(() => openZip(wrong).read('stored.md'), /CRC-32/);
});

test('a body is checked against its CRC-32 on a Node without zlib.crc32, which 22.0 and 22.1 lack and the runtime checks admit (#442 review)', () => {
  const body = 'deflated body, deflated body, deflated body';
  const zip = rawZip([{ name: 'stored.md', data: 'stored body' }, { name: 'deflated.md', data: body, deflate: true }]);
  const wrong = Buffer.from(zip);
  const at = headersOf(wrong, 'deflated.md');
  wrong.writeUInt32LE(0x12345678, at.local + 14);
  wrong.writeUInt32LE(0x12345678, at.central + 16);
  // Taken away and put back in one synchronous step, so nothing else in this process meets it gone.
  const native = Object.getOwnPropertyDescriptor(zlib, 'crc32');
  let read;
  let refusal;
  delete zlib.crc32;
  try {
    const opened = openZip(zip);
    read = opened.names.map((name) => opened.read(name).toString('utf8'));
    try { openZip(wrong).read('deflated.md'); } catch (err) { refusal = err; }
  } finally {
    if (native) Object.defineProperty(zlib, 'crc32', native);
  }
  assert.deepEqual(read, ['stored body', body]);
  // The writer's sum, pinned to the published vectors (audit.test.mjs): zlib.crc32 is the very
  // function 22.0 and 22.1 lack, and a test that computed with it threw there (re-review of #442).
  const sum = `0x${crc32(Buffer.from(body)).toString(16).padStart(8, '0')}`;
  assert.equal(refusal?.code, 'ZIP-READ', String(refusal));
  assert.ok(refusal.message.includes(`the directory declares 0x12345678, its bytes give ${sum}`), refusal.message);
});

test('a local header giving its sizes as ZIP64 is refused for that, not as a disagreement with the directory (#442 review)', () => {
  // 0xFFFFFFFF in the local sizes, the real ones in a ZIP64 extra field, 32-bit sizes in the
  // directory: the two headers agree, and the reader, which does not implement ZIP64, must say why it refuses.
  const data = 'a body long enough to be worth deflating, a body long enough';
  const problems = openZip(rawZip([{ name: 'a.md', data, deflate: true, zip64Local: true }])).problems;
  assert.deepEqual(problems.map((p) => [p.code, p.path]), [['ZIP-READ', 'a.md']], JSON.stringify(problems));
  assert.equal(problems[0].detail, 'entry "a.md" uses ZIP64 size fields in its local header, which this reader does not implement');
  // With bit 3 set the local sizes are not the ones read, so they are not judged: such an entry still reads.
  const deferred = openZip(rawZip([{ name: 'a.md', data, deflate: true, zip64Local: true, descriptor: true }]));
  assert.deepEqual(deferred.problems, []);
  assert.equal(deferred.read('a.md').toString('utf8'), data);
});

test('the fixtures an independent reader refuses are refused here, and the archives it reads are read (audit F05)', () => {
  const { renamed, unchecked } = auditFixtures();
  const cases = {
    approved: seal(copyPayload(approved.payload), clone(approved.manifest)),
    renamed,
    unchecked,
    descriptor: rawZip([{ name: 'a.md', data: 'a body, a body, a body', deflate: true, descriptor: true }]),
  };
  const files = Object.entries(cases).map(([name, bytes]) => writeFixture(scratch, `f05-reader-${name}`, bytes));
  const script = [
    'import json, sys, zipfile',
    'out = []',
    'for f in sys.argv[1:]:',
    '    with zipfile.ZipFile(f) as z:',
    '        out.append(z.testzip())',
    'print(json.dumps(out))',
  ].join('\n');
  const python = JSON.parse(execFileSync(requirePython('the agreement with an independent ZIP reader'), ['-I', '-c', script, ...files], { encoding: 'utf8' }));
  const here = Object.values(cases).map((bytes) => {
    const zip = openZip(bytes);
    if (zip.problems.length) return zip.problems[0].path;
    for (const name of zip.names) {
      try { zip.read(name); } catch (err) { return err.entry; }
    }
    return null;
  });
  assert.deepEqual(python, [null, 'README-FIRST.md', 'README-FIRST.md', null], 'the independent reader moved, so the controls no longer say what they did');
  assert.deepEqual(here, python);
});

test('validation writes nothing outside its own temporary directory', () => {
  const before = fs.readdirSync(scratch).length;
  const file = writeFixture(scratch, 'traversal-write-check', hostile('../../escape.md'));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'FAIL');
  const after = fs.readdirSync(scratch).filter((n) => n.endsWith('.zip')).length;
  assert.ok(after >= 1, 'the fixture itself is still there');
  assert.ok(!fs.existsSync(path.join(scratch, '..', 'escape.md')), 'nothing was written beside the temp directory');
  assert.ok(before >= 0);
});

test('the source artifact is never modified', () => {
  const file = writeFixture(scratch, 'immutability', seal(copyPayload(approved.payload), clone(approved.manifest)));
  const before = sha256(fs.readFileSync(file));
  validateArtifact({ file, tempRoot: scratch });
  assert.equal(sha256(fs.readFileSync(file)), before, 'validating an artifact must not change it');
});

test('an error never carries the secret it found', () => {
  const secret = `fc-${'a1b2c3d4'.repeat(3)}`;
  const payload = copyPayload(collected.payload);
  payload.find((e) => e.name === 'project/research/plan.json').data = text(`{"topic":"x","notes":"${secret}"}\n`);
  const file = writeFixture(scratch, 'secret-not-echoed', seal(payload, clone(collected.manifest)));
  const result = validateArtifact({ file, tempRoot: scratch });

  assert.equal(result.status, 'FAIL');
  const printed = canonicalJson(result);
  assert.ok(!printed.includes(secret),
    'the report quoted the credential it was refusing - which copies it into every log that prints the report');
  assert.ok(printed.includes('firecrawl-key'), 'the report should name the PATTERN that matched');
});

test('the topic may be in the manifest and is never in the package name', () => {
  assert.ok(collected.manifest.topic.length > 0, 'the manifest carries the topic for a consumer to display');
  // The filename is the one field that leaks before anybody opens anything.
  const name = `fetchproof-corpus-v1-${collected.manifest.clientRef ?? `run-${collected.manifest.source.workflowRunId}`}.zip`;
  assert.ok(!name.toLowerCase().includes('fixture'), 'the package name must not carry the topic');
});

test('an unreadable file is BLOCKED, not FAIL - the difference is whether a verdict was reached', () => {
  const result = validateArtifact({ file: path.join(scratch, 'does-not-exist.zip'), tempRoot: scratch });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.buildAuthorized, false);
});

test('SUPPORTED_FORMAT_MAJOR is 2, and a 3.x package is INCOMPLETE rather than invalid', () => {
  assert.equal(SUPPORTED_FORMAT_MAJOR, 2);
  const manifest = clone(collected.manifest);
  manifest.formatVersion = '3.0.0';
  const file = writeFixture(scratch, 'future-major', seal(copyPayload(collected.payload), manifest));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'INCOMPLETE',
    'a newer package is probably correct and merely unreadable here; calling it invalid sends somebody hunting a corruption that is not there');
});

test('malformed and below-oldest format versions are invalid manifests, not newer formats', () => {
  for (const [index, version] of [undefined, null, 3, ['3.0'], '', 'abc', '0.9.0', '1e2.0', '3.nope'].entries()) {
    const manifest = clone(collected.manifest);
    if (version === undefined) delete manifest.formatVersion;
    else manifest.formatVersion = version;
    const file = writeFixture(scratch, `invalid-version-${index}`, seal(copyPayload(collected.payload), manifest));
    const result = validateArtifact({ file, tempRoot: scratch });
    assert.equal(result.status, 'FAIL', JSON.stringify(version));
    assert.equal(result.buildAuthorized, false);
    assert.ok(result.errors.some((error) => error.code === 'MANIFEST-SCHEMA' && /regenerate/.test(error.remedy)));
    assert.ok(result.errors.every((error) => error.code !== 'FORMAT-UNSUPPORTED'));
  }
  const manifest = clone(collected.manifest);
  manifest.formatVersion = '3.0';
  const result = validateArtifact({ file: writeFixture(scratch, 'future-version-short', seal(copyPayload(collected.payload), manifest)), tempRoot: scratch });
  assert.equal(result.status, 'INCOMPLETE');
  assert.ok(result.errors.some((error) => error.code === 'FORMAT-UNSUPPORTED' && /3\.x/.test(error.remedy)));
});

// ADR-0107: format 2.0.0 renames HUMAN_REVIEW_REQUIRED to REVIEW_REQUIRED and retires the
// `human` reviewer. A 1.x package made before stays valid, and is reported under the new
// name, so a consumer switches on one state; a 2.x package carrying either old value is not
// one this kit produced.
test('a 1.x package still validates, and its old state is reported as REVIEW_REQUIRED', () => {
  const manifest = clone(collected.manifest);
  manifest.formatVersion = '1.1.0';
  manifest.state = 'HUMAN_REVIEW_REQUIRED';
  manifest.review.by = 'human';
  const file = writeFixture(scratch, 'old-major', seal(copyPayload(collected.payload), manifest));
  const result = validateArtifact({ file, tempRoot: scratch });
  assert.equal(result.status, 'PASS', result.errors.map((e) => `${e.code} ${e.message}`).join('; '));
  assert.equal(result.state, 'REVIEW_REQUIRED');
  assert.equal(result.buildAuthorized, false);
});

test('a 2.x package carrying a retired value, or a 1.x one carrying the new name, is refused by name', () => {
  for (const [version, change, pattern] of [
    ['2.0.0', (m) => { m.state = 'HUMAN_REVIEW_REQUIRED'; }, /HUMAN_REVIEW_REQUIRED.*REVIEW_REQUIRED/],
    ['2.0.0', (m) => { m.review.by = 'human'; }, /human/],
    ['1.1.0', (m) => { m.state = 'REVIEW_REQUIRED'; }, /REVIEW_REQUIRED/],
  ]) {
    const manifest = clone(collected.manifest);
    manifest.formatVersion = version;
    change(manifest);
    const file = writeFixture(scratch, `retired-${version}-${manifest.state}-${manifest.review.by}`, seal(copyPayload(collected.payload), manifest));
    const result = validateArtifact({ file, tempRoot: scratch });
    assert.equal(result.status, 'FAIL', `${version} ${manifest.state} ${manifest.review.by} passed`);
    assert.ok(result.errors.some((e) => pattern.test(e.message)), result.errors.map((e) => e.message).join('; '));
  }
});

test('entry-name rules refuse each shape on its own', () => {
  for (const bad of ['../up.md', '/abs.md', 'C:/win.md', 'a\\b.md', '', 'a/../b']) {
    assert.equal(checkEntryName(bad).ok, false, `${JSON.stringify(bad)} should be refused`);
  }
  for (const good of ['project/research/EVIDENCE.md', 'research/raw/.fetches.jsonl', 'a.md']) {
    assert.equal(checkEntryName(good).ok, true, `${JSON.stringify(good)} should be accepted`);
  }
});

// Found by the independent audit of 532c696 (2026-11-04, F03): a name Windows, or an
// extractor running there, reads as another name was judged by its spelling and extracted
// by its meaning. Each is refused; the near misses beside them are still names.
test('entry-name rules refuse a name another platform reads as a different name', () => {
  const bad = [
    'project/research//BRIEF.md', 'project/research/', 'project/docs/readme.md.', 'project/docs./a.md',
    'project/docs/report.md ', 'project/research/BRIEF.md::$DATA', 'project/docs/report.md:hidden',
    'project/research/GATE?OFF', 'project/research/GATE*OFF', 'project/docs/a<b.md', 'project/docs/a|b.md',
    'project/docs/a"b.md', 'project/docs/a\tb.md',
    'project/docs/CON', 'project/docs/con.txt', 'project/docs/Nul.tar.gz', 'project/AUX/a.md', 'project/docs/prn',
    'project/docs/COM1', 'project/docs/lpt9.md', 'project/docs/COM\u00b9', 'project/docs/COM0',
    'project/research/EVIDEN~1.MD', 'project/docs/PROGRA~1', 'project/docs/di8a3f~12.md',
  ];
  for (const name of bad) {
    assert.equal(checkEntryName(name).ok, false, `${JSON.stringify(name)} should be refused`);
  }
  const good = [
    'project/docs/console.md', 'project/docs/com10.md', 'project/docs/auxiliary/a.md', 'project/docs/a.b.c.md',
    'project/research/raw/2026-11-04-rate-limits-firecrawl-552467ff.md', 'project/research/raw/.fetches.jsonl',
    'project/docs/notes.md.~1~', 'project/docs/~$draft.docx', 'project/docs/v1~draft.md', 'project/docs/ caf\u00e9.md',
  ];
  for (const name of good) {
    assert.equal(checkEntryName(name).ok, true, `${JSON.stringify(name)} should be accepted: ${checkEntryName(name).detail}`);
  }
});

test('an approved package carrying another spelling of a packaged or forbidden path is refused and authorizes nothing', () => {
  const run = (label, payload, options) => {
    const file = writeFixture(scratch, `f03-${label.replace(/\W+/g, '-')}`, seal(payload, clone(approved.manifest), options));
    return validateArtifact({ file, tempRoot: scratch });
  };
  const control = run('control', copyPayload(approved.payload));
  assert.equal(control.status, 'PASS', control.errors.map((e) => `${e.code}: ${e.message}`).join('\n'));
  assert.equal(control.buildAuthorized, true);

  const variants = [
    ['a second brief by a doubled slash', { name: 'project/research//BRIEF.md', data: text('# UNREVIEWED CONTENT\n') }, /ZIP-PATH/],
    ['the gate override by a doubled slash', { name: 'project/research//GATE_OFF', data: text('') }, /ZIP-PATH/],
    ['the gate override in lower case', { name: 'project/research/gate_off', data: text('') }, /must never be packaged/],
    ['the gate override as a folder', { name: 'project/research/GATE_OFF/note.md', data: text('a note\n') }, /must never be packaged/],
    // Undeclared on purpose: a folder entry is no file, so the manifest never lists one.
    ['the gate override as an empty folder entry', { name: 'project/research/GATE_OFF/', data: Buffer.alloc(0) }, /must never be packaged/, { recomputeFiles: false }],
  ];
  for (const [label, entry, expected, options] of variants) {
    const result = run(label, [...copyPayload(approved.payload), entry], options);
    const said = result.errors.map((e) => `${e.code}: ${e.message}`).join('\n');
    assert.equal(result.status, 'FAIL', `${label}: expected FAIL, got ${result.status}\n${said}`);
    assert.equal(result.buildAuthorized, false, `${label}: must not authorize a build`);
    assert.match(said, expected, `${label}: refused for the wrong reason\n${said}`);
  }
});

test('the fixture scratch directory is removed', () => {
  cleanup(scratch);
  assert.ok(!fs.existsSync(scratch));
});
