// Persisted, deterministic replay for graph and canonical-hash property regressions.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, assertEqual, tempDir } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('property-replay');

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function tempDirectory() {
  return tempDir('research-kit-property-replay-');
}

test('a failing property seed is persisted once as a self-describing replay envelope', async () => {
  const { persistPropertyFailure, loadPropertyRegression } = await import('../lib/property-replay.mjs');
  const directory = tempDirectory();
  try {
    const first = persistPropertyFailure({
      directory, family: 'canonical-hashing', seed: 0xC14A0001, iteration: 17,
      error: new Error('array order was lost'),
    });
    assertEqual(first.created, true, JSON.stringify(first));
    assert(fs.existsSync(first.file), first.file);
    const bytes = fs.readFileSync(first.file);
    const loaded = loadPropertyRegression(first.file);
    assertEqual(loaded.family, 'canonical-hashing');
    assertEqual(loaded.seed, 0xC14A0001);
    assertEqual(loaded.iteration, 17);
    assertEqual(loaded.failure.message, 'array order was lost');
    const second = persistPropertyFailure({
      directory, family: 'canonical-hashing', seed: 0xC14A0001, iteration: 17,
      error: new Error('a later failure must not replace the original seed evidence'),
    });
    assertEqual(second.created, false, JSON.stringify(second));
    assert(bytes.equals(fs.readFileSync(first.file)), 'persisting the same seed must not rewrite prior evidence');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('persisted canonical-hash and graph seeds replay byte-deterministically without mutation', async () => {
  const { persistPropertyFailure, replayPropertyRegression } = await import('../lib/property-replay.mjs');
  const directory = tempDirectory();
  try {
    const cases = [
      persistPropertyFailure({ directory, family: 'canonical-hashing', seed: 0xC14A0001, iteration: 41, error: new Error('synthetic') }),
      persistPropertyFailure({ directory, family: 'predecessor-closure', seed: 0xC14A0002, iteration: 29, error: new Error('synthetic') }),
      persistPropertyFailure({ directory, family: 'descendant-invalidation', seed: 0xC14A0003, iteration: 53, error: new Error('synthetic') }),
    ];
    for (const entry of cases) {
      const before = fs.readFileSync(entry.file);
      const first = replayPropertyRegression(entry.regression);
      const second = replayPropertyRegression(entry.regression);
      assertEqual(first.status, 'PASS', JSON.stringify(first));
      assertEqual(JSON.stringify(first), JSON.stringify(second), entry.file);
      assert(before.equals(fs.readFileSync(entry.file)), 'replay must be read-only');
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('property-replay CLI emits the same deterministic case result', async () => {
  const { persistPropertyFailure, replayPropertyRegression } = await import('../lib/property-replay.mjs');
  const directory = tempDirectory();
  try {
    const entry = persistPropertyFailure({ directory, family: 'descendant-invalidation', seed: 0xC14A0003, iteration: 7, error: new Error('synthetic') });
    const expected = replayPropertyRegression(entry.regression);
    const run = spawnSync(process.execPath, [
      path.join(ROOT, 'bin', 'property-replay.mjs'), '--case', entry.file, '--json',
    ], { encoding: 'utf8' });
    assertEqual(run.status, 0, run.stderr || run.stdout);
    assertEqual(JSON.stringify(JSON.parse(run.stdout)), JSON.stringify(expected), run.stdout);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('property-replay CLI documents its read-only replay modes', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'property-replay.mjs'), '--help'], { encoding: 'utf8' });
  assertEqual(run.status, 0, run.stderr || run.stdout);
  assert(run.stdout.includes('--case <property-regression.json>'), run.stdout);
  assert(run.stdout.includes('--all [--directory <property-regressions>]'), run.stdout);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert(readme.includes('--case <property-regression.json> [--json]'), 'README documents --case');
  assert(readme.includes('--all [--directory <property-regressions>] [--json]'), 'README documents --all');
});
