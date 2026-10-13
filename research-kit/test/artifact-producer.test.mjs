// The producer: what it derives, what it refuses, and what it never lets a caller say.
//
// The load-bearing test in this file is `a caller cannot ask for authorization`. Every
// other property here is a correctness property; that one is the security property, and
// it is asserted against the module's whole surface rather than against one function,
// because the way this gets lost is somebody adding a convenient option later.

import { execFileSync } from 'node:child_process';
import { test, describe, assert, fs, path, os, cleanup, tempDir, requireSymlink } from './harness.mjs';
import { sha256, canonicalJson, resolve, readText, writeText, today, PATHS, HEADERS } from '../lib/core.mjs';
import {
  createArtifact, deriveState, collectProjectFiles, packageName, checkClientRef,
  findingsReviewState, roleOf, mediaTypeOf, EXCLUDED, GITHUB_API_VERSION,
} from '../lib/artifact.mjs';
import { validateArtifact, MANIFEST_PATH, MANIFEST_DIGEST_PATH } from '../lib/artifact-validator.mjs';
import { openZip } from '../lib/artifact-zip.mjs';
import { readCorpus, appendRow } from '../lib/corpus.mjs';
import { writeRaw } from '../lib/collect.mjs';
import { firstFinding } from '../lib/finding.mjs';
import { collectedProject, approvedProject, IDENTITY } from './artifact-fixtures.mjs';
import { reviewedBy } from '../lib/brief.mjs';
import { runPreflight } from '../lib/preflight.mjs';

describe('artifact-producer');

const scratch = tempDir('rk-producer-');

function build(root, overrides = {}) {
  return createArtifact({ root, ...IDENTITY, ...overrides });
}

test('package handoff prose retains gate warnings without changing build authorization', () => {
  for (const [label, root, authorized] of [['collected', collectedProject(), false], ['approved', approvedProject(), true]]) {
    const built = build(root);
    assert.equal(built.manifest.buildAuthorized, authorized, label);
    assert.equal(built.manifest.gate.verdict, 'PASS', label);
    assert.deepEqual(built.manifest.gate.blockingFindings, []);
    const warning = built.derived.verdict.warnings.find((f) => f.check === 'corroboration' && f.rule === 'single-source');
    assert.ok(warning);
    for (const name of ['README-FIRST.md', 'reports/collection-summary.md']) {
      const text = built.entries.find((e) => e.name === name).data.toString('utf8');
      assert.match(text, /corroboration\/single-source/);
      assert.ok(text.includes(warning.detail), `${label} ${name} drops the warning reason`);
    }
  }
});

// Found 2026-09-28 (break-test): a file named `a\b.md` in the packaged tree travelled into
// the archive as `a/b.md` - a directory invented from a name - while the manifest kept
// declaring `a\b.md`. The package contradicted itself, was written anyway, and was then
// refused by its own read-back: in CI's collect job that is the run failing at the last
// step, after the credits are spent. The producer refuses now, before the write, and names
// the file.
test('a name the archive cannot carry faithfully is refused, not quietly rewritten', () => {
  if (process.platform === 'win32') return;   // a backslash is not a legal filename there
  const root = collectedProject();
  fs.writeFileSync(path.join(root, 'research', 'raw', 'a\\b.md'), 'a capture\n', 'utf8');
  assert.throws(
    () => build(root),
    (err) => err.code === 'UNPACKAGEABLE_NAME'
      && /backslash/.test(err.message)
      && /a\\b\.md/.test(err.message),
    'the producer must refuse a name the archiver would rewrite',
  );
});

// Found 2026-09-28 (Arena break test 10, R-1; done at the user's request): two files that
// differ only in case are one file on Windows and macOS. The reader refuses such a package
// (ZIP-CASE-COLLISION) - but only AFTER the producer had written it, which in CI is the
// collect job failing at its last step, after the credits were spent.
test('two files differing only in case are refused before anything is written', () => {
  const root = collectedProject();
  const raw = path.join(root, 'research', 'raw');
  fs.writeFileSync(path.join(raw, 'Capture.md'), 'one\n', 'utf8');
  fs.writeFileSync(path.join(raw, 'capture.md'), 'two\n', 'utf8');
  if (fs.readdirSync(raw).filter((n) => n.toLowerCase() === 'capture.md').length < 2) return;   // a case-insensitive filesystem holds one file
  assert.throws(
    () => build(root),
    (err) => err.code === 'UNPACKAGEABLE_NAME'
      && /differ only in case/.test(err.message)
      && /Capture\.md/.test(err.message) && /capture\.md/.test(err.message),
    'the producer must refuse a case collision the reader would refuse',
  );
});

// ---------------------------------------------------------------- authorization is derived

test('a caller cannot ask for authorization: there is no such option', () => {
  const root = collectedProject();
  // Every plausible spelling somebody might reach for. None of them may reach the manifest.
  const built = build(root, {
    buildAuthorized: true,
    state: 'APPROVED_BRIEF',
    kind: 'APPROVED_RESEARCH',
    review: { mapClassified: true, findingsReviewed: true, briefReviewed: true },
    gate: { verdict: 'PASS', buildAuthorized: true, blockingFindings: [] },
  });
  assert.equal(built.manifest.buildAuthorized, false,
    'a caller-supplied buildAuthorized reached the manifest - authorization must be derived from the project, never requested');
  assert.notEqual(built.manifest.state, 'APPROVED_BRIEF');
  assert.equal(built.manifest.gate.buildAuthorized, false);
});

test('the producer ignores an ambient GATE_OFF: the gate it runs is the real one', () => {
  const root = collectedProject();
  // An override in the environment of whatever shell ran the producer must not become a
  // property of a package that will outlive that shell.
  const built = createArtifact({ root, ...IDENTITY, env: { RESEARCH_KIT_GATE: 'off', RESEARCH_GATE_OFF: '1' } });
  assert.equal(built.manifest.buildAuthorized, false);
  assert.ok(['REVIEW_IN_PROGRESS', 'REVIEW_REQUIRED', 'PREFLIGHT_BLOCKED'].includes(built.manifest.state),
    `unexpected state ${built.manifest.state}`);
});

test('a reviewed corpus reaches APPROVED_BRIEF, and every dependent field agrees', () => {
  const built = build(approvedProject());
  const m = built.manifest;
  assert.equal(m.state, 'APPROVED_BRIEF');
  assert.equal(m.kind, 'APPROVED_RESEARCH');
  assert.equal(m.buildAuthorized, true);
  assert.equal(m.gate.verdict, 'PASS');
  assert.equal(m.gate.buildAuthorized, true);
  assert.deepEqual(m.gate.blockingFindings, []);
  assert.deepEqual(m.review, { mapClassified: true, findingsReviewed: true, briefReviewed: true, by: 'undeclared' });
});

// Found 2026-10-03 (output-reliability audit, G1): `briefState` read a MISSING judged section
// as answered - empty text holds no TODO - so a drafted brief with no review sections at all
// derived APPROVED_BRIEF and buildAuthorized: true on the repository's own corpus; and a brief
// whose draft stamp no longer matched the corpus (an evidence finding changed after the
// draft) stayed authorized too. Approval requires every judged section present and answered,
// and the stamp's inputs hash current.
test('a brief missing a judged section is not approved, however the rest reads', () => {
  const root = approvedProject();
  const file = resolve(root, 'research/BRIEF.md');
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('## Decision');
  const next = text.indexOf('\n## ', start + 1);
  assert.ok(start > -1 && next > start, 'the fixture brief has a Decision section followed by another');
  fs.writeFileSync(file, text.slice(0, start) + text.slice(next + 1), 'utf8');
  const built = build(root);
  assert.equal(built.manifest.buildAuthorized, false, 'a brief with no Decision section authorized the build');
  assert.equal(built.manifest.review.briefReviewed, false);
  assert.notEqual(built.manifest.state, 'APPROVED_BRIEF');
});

test('a brief drafted from an older corpus is not approved: the stamp must match the inputs', () => {
  const root = approvedProject();
  const file = resolve(root, 'research/EVIDENCE.md');
  const text = fs.readFileSync(file, 'utf8');
  const row = text.split('\n').find((l) => /^\| E-\d+ \|/.test(l));
  assert.ok(row, 'the fixture has an evidence row');
  const cells = row.split(' | ');
  cells[4] = `${cells[4]} (revised after the draft)`;
  fs.writeFileSync(file, text.replace(row, cells.join(' | ')), 'utf8');
  const built = build(root);
  assert.equal(built.manifest.buildAuthorized, false, 'a brief drafted before the evidence changed authorized the build');
  assert.equal(built.manifest.review.briefReviewed, false);
  assert.ok(built.derived.verdict.warnings.some((w) => w.rule === 'brief-stale'), 'the gate it ran names why');
  // A line appended AFTER the stamp - a reviewer's note, the `Reviewed by: agent` line - had
  // made the brief read as unstamped, so the same stale brief re-approved the build (found
  // 2026-10-03, review of G1). The stamp is found wherever it stands.
  const brief = resolve(root, 'research/BRIEF.md');
  fs.writeFileSync(brief, `${fs.readFileSync(brief, 'utf8')}\nReviewed by: agent\n`, 'utf8');
  const appended = build(root);
  assert.equal(appended.manifest.review.by, 'agent', 'the appended line is read');
  assert.equal(appended.manifest.review.briefReviewed, false, 'a line after the stamp un-staled the brief');
  assert.equal(appended.manifest.buildAuthorized, false);
  assert.ok(appended.derived.verdict.warnings.some((w) => w.rule === 'brief-stale'), 'brief-stale fell silent');
});

// The compatibility path the audit asked for: eleven briefs in this repository, the root's
// own among them, were authored before ADR-0055's stamp existed. An authored, answered brief
// with no stamp keeps its approval - its currency cannot be checked, and hygiene's
// brief-unstamped says so (ADR-0138) rather than enforcing it on a brief that predates the
// mechanism; a redraft with --force stamps it. A stamped brief that has been EDITED after drafting (the fixture answers its
// TODOs after the real renderer wrote it) stays approved while its inputs still match.
test('an authored brief without a stamp keeps its approval, and an edited stamped one with current inputs does too', () => {
  const root = approvedProject();
  const file = resolve(root, 'research/BRIEF.md');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /research-kit:brief-draft/, 'the fixture brief carries a stamp');
  assert.equal(build(root).manifest.buildAuthorized, true, 'an edited brief whose inputs still match is approved');
  fs.writeFileSync(file, text.replace(/\n?<!-- research-kit:brief-draft [^>]*-->\s*$/, '\n'), 'utf8');
  const unstamped = build(root);
  assert.equal(unstamped.manifest.buildAuthorized, true, 'an unstamped authored brief keeps its approval (compatibility)');
  assert.ok(unstamped.derived.verdict.warnings.some((w) => w.rule === 'brief-unstamped'), 'an approval nothing can check is said');
});

test('an unreviewed corpus does NOT, and says which step is outstanding', () => {
  const built = build(collectedProject());
  assert.equal(built.manifest.buildAuthorized, false);
  const ids = built.manifest.nextActions.map((a) => a.id);
  assert.ok(ids.includes('REVIEW_FINDINGS'), `expected REVIEW_FINDINGS in ${ids.join(', ')}`);
  assert.ok(ids.includes('REVIEW_BRIEF'), `expected REVIEW_BRIEF in ${ids.join(', ')}`);
  for (const action of built.manifest.nextActions) {
    assert.ok(action.path.startsWith('project/') || action.path.startsWith('reports/'),
      `nextAction ${action.id} points at ${action.path}, which is not in the package`);
  }
});

test('an unrewritten Finding is detected by re-running the extractor over the capture', () => {
  const root = collectedProject();
  const before = findingsReviewState(root, readCorpus(root));
  assert.equal(before.reviewed, false, 'the fixture ships the extractor\'s own sentence');
  assert.ok(before.unrewritten.includes('E-01'));

  const evidence = resolve(root, 'research/EVIDENCE.md');
  writeText(evidence, readText(evidence).replace(
    'The free plan allows 10 requests per minute and includes 1,000 credits.',
    'Ten requests a minute is the ceiling this collector must schedule against.',
  ));
  const after = findingsReviewState(root, readCorpus(root));
  assert.equal(after.reviewed, true, 'a rewritten Finding must read as reviewed');
  assert.deepEqual(after.unrewritten, []);
});

// Found 2026-09-27 on a real remote collection, run 36287211468. A corpus holding one JSON
// capture, which nobody had touched, was packaged with findingsReviewed: true - and that flag is
// one of the four conditions for buildAuthorized. The check ran the extractor over the whole
// capture FILE and read its front-matter as the page: it picked "url: https://..." and so never
// matched the collector's sentence. The collector extracts from the page body, falling back to
// the page's title or URL (collect.mjs). These captures and rows are made by the same calls.
const SCHEDULE = ['{',
  ...[['v18', '2022-04-19', '2023-10-18', '2025-04-30'], ['v20', '2023-04-18', '2024-10-22', '2026-04-30'],
    ['v22', '2024-04-24', '2025-10-21', '2027-04-30'], ['v24', '2025-05-06', '2026-10-20', '2028-04-30']]
    .flatMap(([v, start, maintenance, end]) => [`  "${v}": {`, `    "start": "${start}",`,
      `    "maintenance": "${maintenance}",`, `    "end": "${end}",`, '    "codename": "x"', '  },']),
  '  "v26": {', '    "start": "2026-04-22",', '    "end": "2029-04-30"', '  }', '}'].join('\n');

test('an untouched Finding on a JSON capture is unrewritten - the front-matter is not the page', () => {
  const root = approvedProject();                 // E-01 is rewritten: only the rows below are untouched
  const date = today();
  const pages = [
    // The real URL: its length is what made the front-matter line outscore the page ("full-sentence").
    { url: 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json', title: '', markdown: SCHEDULE }, // a line is picked
    { url: 'https://example.org/tiny.json', title: 'Release schedule', markdown: '{\n  "end": "2027-04-30"\n}' }, // falls back to the title
    { url: 'https://example.org/empty.json', title: '', markdown: '{}' },                                // falls back to the URL
  ];
  const ids = pages.map((page, i) => {
    const entry = writeRaw(root, { ...page, cmd: 'fixture', statusCode: 200, transport: 'firecrawl-cli', completeness: 'full' }, { date });
    const id = `E-9${i}`;
    appendRow(root, PATHS.evidence, HEADERS.evidence, [id, date, 'S', page.url, firstFinding(page.markdown, page.title || page.url), entry.file]);
    return id;
  });
  assert.notEqual(firstFinding(SCHEDULE, 'x'), 'x', 'the first page must exercise a picked line, not the fallback');
  const state = findingsReviewState(root, readCorpus(root));
  assert.equal(state.reviewed, false, 'a corpus with three untouched Findings was judged reviewed');
  assert.deepEqual([...state.unrewritten].sort(), ids);
});

// ---------------------------------------------------------------- what travels

test('machine-local state and credentials never travel', () => {
  const root = collectedProject();
  for (const rel of EXCLUDED) {
    fs.mkdirSync(path.dirname(resolve(root, rel)), { recursive: true });
    writeText(resolve(root, rel), 'local-only\n');
  }
  writeText(resolve(root, '.env'), 'FIRECRAWL_API_KEY=fc-should-never-travel\n');
  // Assembled rather than written, like every other credential-shaped fixture here: a
  // literal PEM header in this file would trip the kit's own secret scan, and a scanner
  // that is always red about its own test tree is one nobody reads (hardening F26).
  writeText(resolve(root, 'research/secret.pem'), `${'-'.repeat(5)}BEGIN PRIVATE KEY${'-'.repeat(5)}\n`);

  const names = collectProjectFiles(root);
  for (const rel of EXCLUDED) assert.ok(!names.includes(rel), `${rel} must not be packaged`);
  assert.ok(!names.some((n) => n.endsWith('.env')), '.env must not be packaged');
  assert.ok(!names.some((n) => n.endsWith('.pem')), 'a private key must not be packaged');

  const built = build(root);
  const packed = built.manifest.files.map((f) => f.path);
  assert.ok(!packed.some((p) => p.includes('.usage.jsonl') || p.includes('GATE_OFF') || p.endsWith('.env') || p.endsWith('.pem')),
    `excluded file reached the package: ${packed.join(', ')}`);
});

test('the ledger always travels, dotfile and all', () => {
  const built = build(collectedProject());
  const ledger = built.manifest.files.filter((f) => f.role === 'PROVENANCE_LEDGER');
  assert.equal(ledger.length, 1, 'there is exactly one chain, and it must be in the package');
  assert.equal(ledger[0].path, 'project/research/raw/.fetches.jsonl');
});

test('every ZIP entry except the manifest pair is declared, and the pair never is', () => {
  const built = build(approvedProject());
  const zip = openZip(built.bytes);
  const declared = new Set(built.manifest.files.map((f) => f.path));
  for (const name of zip.names) {
    if (name === MANIFEST_PATH || name === MANIFEST_DIGEST_PATH) {
      assert.ok(!declared.has(name), `${name} must not be listed in files`);
      continue;
    }
    assert.ok(declared.has(name), `${name} is in the package but not declared`);
  }
  assert.equal(declared.size, zip.names.length - 2);
});

test('the manifest and its digest are the last two entries', () => {
  const built = build(collectedProject());
  const names = built.entries.map((e) => e.name);
  assert.equal(names[names.length - 2], MANIFEST_PATH);
  assert.equal(names[names.length - 1], MANIFEST_DIGEST_PATH);
});

test('the digest is taken over the exact manifest bytes', () => {
  const built = build(collectedProject());
  const zip = openZip(built.bytes);
  const bytes = zip.read(MANIFEST_PATH);
  const line = zip.read(MANIFEST_DIGEST_PATH).toString('utf8');
  assert.equal(line, `${sha256(bytes)}  manifest.json\n`);
  assert.ok(!bytes.toString('utf8').includes(sha256(bytes)), 'the manifest must not contain its own digest');
});

test('roles and media types are assigned, not guessed at read time', () => {
  assert.equal(roleOf('project/research/raw/.fetches.jsonl'), 'PROVENANCE_LEDGER');
  assert.equal(roleOf('project/research/raw/2026-01-01-x.md'), 'RAW_CAPTURE');
  assert.equal(roleOf('project/research/BRIEF.md'), 'RESEARCH_BRIEF');
  assert.equal(roleOf('schemas/artifact-manifest.schema.json'), 'SCHEMA');
  assert.equal(roleOf('project/whatever.txt'), 'OTHER');
  assert.equal(mediaTypeOf('a.jsonl'), 'application/x-ndjson');
  assert.equal(mediaTypeOf('a.json'), 'application/json');
  assert.equal(mediaTypeOf('a.md'), 'text/markdown');
});

// ---------------------------------------------------------------- client_ref and naming

test('an invalid client_ref is refused, never rewritten', () => {
  for (const bad of ['../escape', 'has space', '-leading-dash', 'a'.repeat(65), 'sl/ash', 'job\n', 'job\r', 'job\r\n']) {
    const check = checkClientRef(bad);
    assert.equal(check.ok, false, `${JSON.stringify(bad)} should be refused`);
    assert.ok(/refusing rather than rewriting/.test(check.detail));
  }
  for (const good of ['auth-research-001', 'A', 'a.b_c-d', '0'.repeat(64)]) {
    assert.equal(checkClientRef(good).ok, true, `${JSON.stringify(good)} should be accepted`);
  }
  assert.deepEqual(checkClientRef(null), { ok: true, value: null }, 'client_ref is optional');
});

test('the package name never carries the topic, and falls back to the run id', () => {
  assert.equal(packageName({ clientRef: 'job-7', workflowRunId: 99 }), 'research-kit-corpus-v1-job-7.zip');
  assert.equal(packageName({ clientRef: null, workflowRunId: 35548135379 }), 'research-kit-corpus-v1-run-35548135379.zip');

  const root = collectedProject();
  // A topic nobody would want in a filename, to prove the filename is not built from it.
  writeText(resolve(root, 'research/MAP.md'),
    readText(resolve(root, 'research/MAP.md')).replace('Fixture topic', 'Whether to make Dana redundant'));
  const built = build(root, { clientRef: 'job-7' });
  assert.equal(built.name, 'research-kit-corpus-v1-job-7.zip');
  assert.ok(built.manifest.topic.includes('Dana'), 'the topic belongs in the manifest, where opening the package is a deliberate act');
  assert.ok(!built.name.includes('Dana'), 'the topic must never be in the filename');
});

test('the run id is required, and the API version is recorded with it', () => {
  const root = collectedProject();
  assert.throws(() => createArtifact({ root, ...IDENTITY, workflowRunId: undefined }), /workflowRunId is required/);
  assert.throws(() => createArtifact({ root, ...IDENTITY, workflowRunId: 0 }), /workflowRunId is required/);

  const built = build(root);
  assert.equal(built.manifest.source.apiVersion, GITHUB_API_VERSION,
    'the run id means nothing without the API version that returned it');
  assert.equal(built.manifest.source.workflowRunId, IDENTITY.workflowRunId);
  assert.ok(built.manifest.source.runUrl.startsWith('https://api.github.com/'));
  assert.ok(built.manifest.source.htmlUrl.startsWith('https://github.com/'));
});

// ---------------------------------------------------------------- determinism

test('identical project bytes and fixed metadata produce identical manifests and digests', () => {
  const root = approvedProject();
  const a = build(root);
  const b = build(root);

  assert.equal(canonicalJson(a.manifest), canonicalJson(b.manifest), 'the manifest must be a function of the inputs');
  assert.deepEqual(a.entries.map((e) => e.name), b.entries.map((e) => e.name), 'entry order must be deterministic');
  for (let i = 0; i < a.entries.length; i += 1) {
    assert.equal(sha256(a.entries[i].data), sha256(b.entries[i].data), `entry ${a.entries[i].name} differs between runs`);
  }
  // The ZIP itself, because `buildZip` pins its timestamp. Asserted rather than assumed:
  // a writer that stamped the clock would break byte-identity without breaking anything above.
  assert.equal(sha256(a.bytes), sha256(b.bytes), 'two runs over identical bytes must produce the identical archive');
});

test('entry order is sorted by ZIP path, not by walk order', () => {
  const built = build(approvedProject());
  const payload = built.entries.map((e) => e.name).slice(0, -2);
  assert.deepEqual(payload, [...payload].sort(), 'payload entries must be in sorted order');
});

// ---------------------------------------------------------------- end to end

test('the package a producer writes passes the consumer\'s own validator', () => {
  for (const [label, root] of [['collected', collectedProject()], ['approved', approvedProject()]]) {
    const built = build(root, { clientRef: 'end-to-end' });
    const file = path.join(scratch, `${label}.zip`);
    fs.writeFileSync(file, built.bytes);
    const result = validateArtifact({ file, expectedClientRef: 'end-to-end', tempRoot: scratch });
    assert.equal(result.status, 'PASS',
      `${label}: ${result.errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
    assert.equal(result.buildAuthorized, label === 'approved');
  }
});

test('the producer does not modify the project it packages', () => {
  const root = approvedProject();
  const before = new Map();
  const walk = (dir, rel = '') => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (fs.statSync(abs).isDirectory()) { walk(abs, childRel); continue; }
      before.set(childRel, sha256(fs.readFileSync(abs)));
    }
  };
  walk(root);
  build(root);
  const after = new Map();
  const walkAfter = (dir, rel = '') => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (fs.statSync(abs).isDirectory()) { walkAfter(abs, childRel); continue; }
      after.set(childRel, sha256(fs.readFileSync(abs)));
    }
  };
  walkAfter(root);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'packaging added or removed a file');
  for (const [rel, hash] of before) assert.equal(after.get(rel), hash, `packaging modified ${rel}`);
});

test('README-FIRST states the same thing the manifest does', () => {
  const collectedBuilt = build(collectedProject());
  const collectedReadme = collectedBuilt.entries.find((e) => e.name === 'README-FIRST.md').data.toString('utf8');
  assert.ok(collectedReadme.includes('REVIEW REQUIRED'));
  assert.ok(!collectedReadme.includes('HUMAN REVIEW REQUIRED'),
    'review is the reviewer\'s job, agent or person - the file must not say only a human may do it (ADR-0074)');
  assert.ok(collectedReadme.includes('not an approved research brief'));
  assert.equal(collectedBuilt.manifest.buildAuthorized, false);

  const approvedBuilt = build(approvedProject());
  const approvedReadme = approvedBuilt.entries.find((e) => e.name === 'README-FIRST.md').data.toString('utf8');
  assert.ok(approvedReadme.includes('BUILDING IS AUTHORIZED'));
  assert.equal(approvedBuilt.manifest.buildAuthorized, true);
  assert.ok(!approvedReadme.includes('HUMAN REVIEW REQUIRED'),
    'the human file must not contradict the manifest it ships beside');
  assert.ok(!approvedReadme.includes('a human reviewed it'),
    'nothing verifies who reviewed, so the file must not claim a human did');
});

test('deriveState runs the gate rather than reading a cached verdict', () => {
  const root = approvedProject();
  const good = deriveState(root);
  assert.equal(good.gate.verdict, 'PASS');

  // Break the corpus and the verdict must follow, without the producer being told.
  writeText(resolve(root, 'research/DISCOVERY.md'),
    readText(resolve(root, 'research/DISCOVERY.md')).replace('CLOSED', 'OPEN'));
  const bad = deriveState(root);
  assert.notEqual(bad.gate.verdict, 'PASS');
  assert.equal(bad.buildAuthorized, false);
  assert.ok(bad.gate.blockingFindings.length > 0, 'a failing gate must name what blocked it');
});

test('the scratch directory is removed', () => {
  cleanup(scratch);
  assert.ok(!fs.existsSync(scratch));
});

// ---------------------------------------------------------------- who reviewed (ADR-0074)

// The three review steps are checked by what they leave behind - a classified map,
// rewritten findings, an authored brief - never by who did them. The package said "a human
// reviewed it" regardless, which was false whenever an agent did the work. Who reviewed is
// now the reviewer's own declaration in BRIEF.md, carried as `review.by`, and it is said to
// be a declaration: nothing here can verify it, and approval does not depend on it.
test('reviewedBy reads the brief\'s declaration, and only a real one', () => {
  assert.equal(reviewedBy('# Brief\n\nReviewed by: agent\n'), 'agent');
  // Review is the agent's (ADR-0107): a line naming a person is no declaration the kit reads.
  assert.equal(reviewedBy('Reviewed by: **Human** - J. Doe, 2026-09-27'), 'undeclared');
  assert.equal(reviewedBy('reviewed by:   agent (claude)'), 'agent');
  assert.equal(reviewedBy('Reviewed by: _agent - replace this line once the review is done_'), 'undeclared',
    'the drafted placeholder is not a declaration');
  assert.equal(reviewedBy('Reviewed by: robot'), 'undeclared');
  assert.equal(reviewedBy('No declaration here.'), 'undeclared');
  assert.equal(reviewedBy(''), 'undeclared');

  // Found by the break-test, 2026-09-27: a careless edit of the drafted placeholder,
  // "Reviewed by: agent or human", was reported as `agent`, and two contradicting lines
  // resolved silently to the first. An ambiguous declaration is no declaration.
  assert.equal(reviewedBy('Reviewed by: agent or human'), 'undeclared', 'names both roles');
  assert.equal(reviewedBy('Reviewed by: human-assisted agent'), 'undeclared', 'names both roles');
  assert.equal(reviewedBy('Reviewed by: human\n\nReviewed by: agent'), 'undeclared', 'two lines disagree');
  assert.equal(reviewedBy('Reviewed by: agent\n\nReviewed by: agent (again)'), 'agent', 'two lines agree');
  assert.equal(reviewedBy('  Reviewed by: agent'), 'agent', 'indentation is not a reason to ignore it');
  assert.equal(reviewedBy('```\nReviewed by: human\n```\nReviewed by: agent'), 'agent', 'a quoted line in a code block is not a declaration');
  assert.equal(reviewedBy('```\nReviewed by: human\n```'), 'undeclared');
});

test('the drafted brief asks who reviewed it, and an answer reaches the manifest and both files', () => {
  const undeclared = build(approvedProject());
  assert.equal(undeclared.manifest.review.by, 'undeclared');
  assert.equal(undeclared.manifest.buildAuthorized, true, 'approval does not depend on the declaration');
  assert.equal(undeclared.manifest.formatVersion, '2.0.0');

  const own = tempDir('rk-reviewed-by-');
  for (const who of ['agent']) {
    const root = approvedProject();
    const briefFile = resolve(root, 'research/BRIEF.md');
    const brief = fs.readFileSync(briefFile, 'utf8');
    assert.match(brief, /^Reviewed by: _agent/m, 'the drafted brief carries the placeholder');
    assert.doesNotMatch(brief, /human/i, 'the drafted brief still offers the review to a person');
    fs.writeFileSync(briefFile, brief.replace(/^Reviewed by: .*$/m, `Reviewed by: ${who}`), 'utf8');
    const built = build(root, { clientRef: `by-${who}` });
    assert.equal(built.manifest.review.by, who);
    assert.equal(built.manifest.buildAuthorized, true);
    const readme = built.entries.find((e) => e.name === 'README-FIRST.md').data.toString('utf8');
    assert.ok(readme.includes('reviewed by an agent'), readme.slice(0, 300));
    const summary = built.entries.find((e) => e.name === 'reports/collection-summary.md').data.toString('utf8');
    assert.match(summary, new RegExp(`reviewed by: \\*\\*${who}\\*\\*`));

    const file = path.join(own, `by-${who}.zip`);
    fs.writeFileSync(file, built.bytes);
    const result = validateArtifact({ file, expectedClientRef: `by-${who}`, tempRoot: own });
    assert.equal(result.status, 'PASS', result.errors.map((e) => `${e.code} ${e.message}`).join('; '));
    assert.equal(result.reviewedBy, who);
  }
  cleanup(own);
});

// ADR-0107: review is the agent's, and the state that waits for it is REVIEW_REQUIRED.
test('a collected package says REVIEW_REQUIRED, format 2.0.0, and offers the review to nobody but the agent', () => {
  // Collected, gate not yet passing, no review step done: the state that waits for review.
  const root = collectedProject();
  const discovery = resolve(root, 'research/DISCOVERY.md');
  fs.writeFileSync(discovery, fs.readFileSync(discovery, 'utf8').replace('| CLOSED |', '| OPEN |'), 'utf8');
  const map = resolve(root, 'research/MAP.md');
  fs.writeFileSync(map, fs.readFileSync(map, 'utf8').replace(/\| (COVERED|DISMISSED|GAP) \|/g, '|  |'), 'utf8');
  const built = build(root);
  assert.equal(built.manifest.formatVersion, '2.0.0');
  assert.equal(built.manifest.state, 'REVIEW_REQUIRED');
  for (const name of ['README-FIRST.md', 'reports/collection-summary.md']) {
    const text = built.entries.find((e) => e.name === name).data.toString('utf8');
    assert.doesNotMatch(text, /human|a person/i, `${name} still offers the review to a person`);
  }
});

// ---------------------------------------------------------------- nothing from outside (ADR-0076)

// Found 2026-09-28 (checking an outside break-test): git stores symlinks, so a cloned corpus
// can carry research/raw/x.md -> ~/.ssh/id_rsa. createArtifact followed every link and
// packed the OUTSIDE file's bytes into the zip - from raw/, anywhere under research/, and
// from docs/, including through a linked directory. Packaging now refuses, naming the path.
test('a link that lands outside the project is refused, and its bytes are never packaged', () => {
  const outsideDir = tempDir('rk-outside-');
  const secret = path.join(outsideDir, 'id_rsa');
  fs.writeFileSync(secret, 'PRIVATE KEY MATERIAL\n');
  const cases = [
    ['research/raw/evil.md', (at) => requireSymlink(secret, at, 'a file link out of the project')],
    ['docs/extra.md', (at) => requireSymlink(secret, at, 'a file link out of the project')],
    ['research/linked', (at) => fs.symlinkSync(outsideDir, at, 'junction')],
  ];
  for (const [rel, link] of cases) {
    const root = approvedProject();
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    link(path.join(root, rel));
    let built = null;
    let error = null;
    try { built = build(root); } catch (err) { error = err; }
    assert.ok(error, `${rel}: packaging accepted a link to a file outside the project${built ? ` (entries: ${built.entries.filter((e) => e.data.includes('PRIVATE KEY')).map((e) => e.name).join(', ')})` : ''}`);
    assert.match(error.message, /outside the project/, `${rel}: ${error.message}`);
    assert.ok(error.message.includes(rel), `${rel}: the refusal does not name the link: ${error.message}`);
  }
});

// Found 2026-10-01 (break-test, PR #178): the inventory took anything that was not a directory
// as a file, so a FIFO under research/raw/ was listed and packaging blocked forever reading it;
// and it followed directory links without asking where they led, so `docs/loop -> .` listed
// docs/loop/loop/loop/... until the OS refused. Both are refused now, naming the path. The
// inventory is asked directly: packaging a FIFO would hang this test where no watchdog reaches.
test('a FIFO or a directory link back into its own ancestry is refused by the inventory', () => {
  const cycle = approvedProject();
  fs.symlinkSync(path.join(cycle, 'docs'), path.join(cycle, 'docs', 'loop'), 'junction');
  assert.throws(() => collectProjectFiles(cycle), (e) => e.code === 'UNPACKAGEABLE_FILE' && e.message.includes('docs/loop'),
    'a directory link to its own ancestor was walked');

  // A link to another folder INSIDE the project that is not an ancestor is not a cycle: it
  // still packages, as it did before.
  const alias = approvedProject();
  fs.symlinkSync(path.join(alias, 'research', 'raw'), path.join(alias, 'docs', 'raw-alias'), 'junction');
  assert.ok(collectProjectFiles(alias).some((rel) => rel.startsWith('docs/raw-alias/')), 'a non-cyclic link inside the project was refused');

  if (process.platform === 'win32') return;   // the cycle above is the Windows half; FIFOs are POSIX
  const fifo = approvedProject();
  execFileSync('mkfifo', [path.join(fifo, 'research', 'raw', 'pipe.md')]);
  assert.throws(() => collectProjectFiles(fifo), (e) => e.code === 'UNPACKAGEABLE_FILE' && e.message.includes('research/raw/pipe.md'),
    'a FIFO was listed for packaging');
});

test('readCaptures does not read a capture that links outside the project, and the gate blocks on it', () => {
  const root = approvedProject();
  const secret = path.join(tempDir('rk-outside-'), 'secret.md');
  fs.writeFileSync(secret, '---\nurl: https://example.com/secret\n---\nSECRET DATA FROM OUTSIDE\n');
  requireSymlink(secret, path.join(root, 'research/raw/evil.md'), 'a capture that links outside the project');
  const corpus = readCorpus(root);
  assert.equal(corpus.captures.entries.some((e) => e.file.endsWith('evil.md')), false, 'the outside file was read as a capture');
  assert.ok(corpus.problems.some((p) => p.kind === 'capture-outside' && p.file === 'research/raw/evil.md'),
    `no capture-outside problem: ${JSON.stringify(corpus.problems)}`);
  const verdict = runPreflight(root);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.findings.some((f) => f.severity === 'fail' && f.rule === 'capture-outside'), 'the gate did not block on it');
});
