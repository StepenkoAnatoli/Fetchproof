// The example packages under examples/release-evidence/ are documentation that runs.
//
// Documentation drifts silently; this repository has already shipped a README claiming
// 326 tests when there were 565, and an architecture map describing two modules that did
// not exist. An example is worse than a stale sentence when it goes stale, because a
// reader copies it and inherits the defect.
//
// So the examples are checked in, and these tests assert that what is on disk still
// produces the documented verdict. If a schema, a hash rule or an error code changes, the
// example goes red and names itself instead of teaching the wrong thing.

import { spawnSync } from 'node:child_process';
import { test, describe, assert, assertEqual, fs, path, KIT_ROOT, tempDir } from './harness.mjs';
import { runExamples } from '../examples/release-evidence/run-example.mjs';
import { canonicalJson, sha256 } from '../lib/release-validator.mjs';

describe('release-examples');

const EXAMPLES = path.join(KIT_ROOT, 'examples', 'release-evidence');

test('every example package still produces its documented status, exit code and error code', () => {
  const report = runExamples();
  const broken = report.rows.filter((row) => !row.ok);
  assertEqual(report.status, 'PASS',
    'these example packages no longer behave as their README documents:\n  '
    + broken.map((row) => `${row.dir}: ${row.problems.join('; ')}`).join('\n  '));
  assertEqual(report.count, 6, 'the example count changed without this test being updated');
});

test('the checked-in packages match what build.mjs would generate', () => {
  // The examples are committed, not generated at validation time. That is only safe if
  // the two cannot silently diverge - otherwise a hash-rule change leaves correct-looking
  // files that teach a stale format. Rebuilding into a scratch copy and comparing is what
  // makes "checked in" and "derived" the same thing.
  //
  // It is a scratch copy now. Until 2026-09-27 (break-test) build.mjs ran over the
  // checked-in tree itself: a stale example failed once and was rewritten on the way, so
  // the next run passed and the edit was gone, and a read-only checkout could not run it.
  const kit = path.join(tempDir('fp-examples-'), 'fetchproof');
  const copy = path.join(kit, 'examples', 'release-evidence');
  fs.cpSync(EXAMPLES, copy, { recursive: true });
  for (const dir of ['lib', 'schemas']) fs.cpSync(path.join(KIT_ROOT, dir), path.join(kit, dir), { recursive: true });
  const rebuild = spawnSync(process.execPath, [path.join(copy, 'build.mjs')], {
    encoding: 'utf8', timeout: 60_000, windowsHide: true,
  });
  assertEqual(rebuild.status, 0, rebuild.stderr || rebuild.stdout);

  const packages = (root) => {
    const files = new Map();
    for (const dir of fs.readdirSync(root).filter((name) => /^\d\d-/.test(name))) {
      for (const file of walk(path.join(root, dir))) files.set(path.relative(root, file), fs.readFileSync(file, 'utf8'));
    }
    return files;
  };
  const committed = packages(EXAMPLES);
  const generated = packages(copy);
  const drifted = [...new Set([...committed.keys(), ...generated.keys()])]
    .filter((relative) => committed.get(relative) !== generated.get(relative)).sort();
  assertEqual(drifted.length, 0,
    'the committed examples differ from what build.mjs generates, so they are stale:\n  '
    + drifted.join('\n  ') + '\n  run: node fetchproof/examples/release-evidence/build.mjs');
});

test('the examples carry no credential and no real sign-off', () => {
  // The same guard the conformance fixtures have. A directory of realistic-looking
  // release records is exactly where a real one would end up by accident.
  const suspicious = [];
  for (const file of walk(EXAMPLES)) {
    if (!/\.(json|mjs|md)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // Long opaque tokens, and the two anchor hashes must stay obvious placeholders.
    if (/\b(sk|fc|pk)-[A-Za-z0-9_-]{16,}/.test(text)) suspicious.push(`${path.relative(EXAMPLES, file)}: key-shaped string`);
    if (/"(api[_-]?key|token|secret|password)"\s*:\s*"[^"]{8,}"/i.test(text)) suspicious.push(`${path.relative(EXAMPLES, file)}: credential-shaped field`);
  }
  assertEqual(suspicious.length, 0, `examples must stay synthetic:\n  ${suspicious.join('\n  ')}`);

  // The anchor hashes are deliberately degenerate so no reader mistakes the example for a
  // production template. If they ever become realistic, that intent has been lost.
  const registry = JSON.parse(fs.readFileSync(path.join(EXAMPLES, '01-minimal-pass', 'artifact-registry.json'), 'utf8'));
  assertEqual(registry.benchmarkSpecSha256, 'a'.repeat(64), 'the placeholder anchor hash became realistic');
  assertEqual(registry.roleRosterSha256, 'b'.repeat(64), 'the placeholder anchor hash became realistic');
});

test('the passing example proves the payloadSha256 rule the README states', () => {
  // The README tells readers that payloadSha256 is sha256(canonicalJson(payload)) and that
  // they must recompute it. If that stops being true, every reader following step 4 of
  // "Adapting this for real evidence" produces an invalid record.
  const record = JSON.parse(fs.readFileSync(path.join(EXAMPLES, '01-minimal-pass', 'records', 'R28-01.json'), 'utf8'));
  assertEqual(record.payloadSha256, sha256(canonicalJson(record.payload)),
    'the README documents payloadSha256 = sha256(canonicalJson(payload)); the example no longer obeys it');
});

test('validate does not write to the example it is reading', () => {
  // Read-only is a claim the whole validator layer makes. The examples are a convenient
  // place to check it end to end, because they are real files in the repository rather
  // than a temp directory that nobody would notice being rewritten.
  const dir = path.join(EXAMPLES, '01-minimal-pass');
  const before = walk(dir).map((file) => [file, fs.readFileSync(file, 'utf8')]);
  const run = spawnSync(process.execPath, [
    path.join(KIT_ROOT, 'bin', 'researcher-release.mjs'), 'validate',
    '--root', dir, '--package', 'R28',
    '--registry', path.join(dir, 'artifact-registry.json'),
    '--roles', path.join(dir, 'role-roster.json'),
    '--pointers', path.join(dir, 'pointers'), '--json',
  ], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  assertEqual(run.status, 0, run.stderr || run.stdout);
  assertEqual(JSON.parse(run.stdout).status, 'PASS', run.stdout);
  for (const [file, content] of before) {
    assertEqual(fs.readFileSync(file, 'utf8'), content, `validate modified ${file}`);
  }
});

test('the README documents every package that exists, and no package that does not', () => {
  // The table in the README is the first thing a reader trusts. A package added without a
  // row, or a row left behind after a package is renamed, is the drift this file exists
  // to catch - and renaming is exactly what happened to 03 during authoring.
  const readme = fs.readFileSync(path.join(EXAMPLES, 'README.md'), 'utf8');
  const onDisk = fs.readdirSync(EXAMPLES).filter((name) => /^\d\d-/.test(name)).sort();
  const missing = onDisk.filter((name) => !readme.includes(name));
  assertEqual(missing.length, 0, `these packages exist but the README never names them: ${missing.join(', ')}`);

  const documented = [...readme.matchAll(/`(\d\d-[a-z0-9-]+)`/g)].map((match) => match[1]);
  const phantom = [...new Set(documented)].filter((name) => !onDisk.includes(name));
  assertEqual(phantom.length, 0, `the README names packages that do not exist: ${phantom.join(', ')}`);
});

/** Every file below a directory, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
