// The offline artifact validator, against a package that is trying to lie to it.
//
// The table below IS the fixture set. Each case names a mutation and the verdict it must
// produce, so adding a case is one row and one closure rather than a binary file nobody
// can review. Everything runs offline, reads no credential, and writes only into a temp
// directory the harness removes.

import { test, describe, assert, fs, path, os, cleanup, tempDir } from './harness.mjs';
import { sha256, canonicalJson } from '../lib/core.mjs';
import { validateArtifact, authorizationProblems, SUPPORTED_FORMAT_MAJOR } from '../lib/artifact-validator.mjs';
import { ZIP_LIMITS, openZip, checkEntryName } from '../lib/artifact-zip.mjs';
import {
  rawZip, seal, basePackage, collectedProject, approvedProject, writeFixture,
} from './artifact-fixtures.mjs';

describe('artifact-validator');

const scratch = tempDir('rk-fixtures-');

const collected = basePackage(collectedProject());
const approved = basePackage(approvedProject());

/** Deep clone through canonical JSON, so a mutation cannot leak into the next fixture. */
const clone = (value) => JSON.parse(canonicalJson(value));
const copyPayload = (payload) => payload.map((e) => ({ name: e.name, data: Buffer.from(e.data) }));

const text = (s) => Buffer.from(s, 'utf8');

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
    build: () => seal(copyPayload(collected.payload), clone(collected.manifest), { manifestBytes: text('{ "format": "research-kit-artifact", ') }),
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
  const name = `research-kit-corpus-v1-${collected.manifest.clientRef ?? `run-${collected.manifest.source.workflowRunId}`}.zip`;
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

test('the fixture scratch directory is removed', () => {
  cleanup(scratch);
  assert.ok(!fs.existsSync(scratch));
});
