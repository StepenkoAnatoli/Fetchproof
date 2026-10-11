// ADR-0089: a judge-free report of how a corpus's citations hold up.
// Research: docs/decisions/2026-09-28-kit-measurement.

import { test, describe, assert, makePassingProject, tempDir, corrupt, fs } from './harness.mjs';
import { PATHS } from '../lib/core.mjs';
import { measureCorpus, renderMeasure } from '../lib/measure.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('measure');

test('a passing corpus: every link works, and support is named as needing a judge', () => {
  const m = measureCorpus(makePassingProject());
  assert.equal(m.rows, 1);
  assert.deepEqual(m.linkWorks, { count: 1, percent: 100 });
  assert.equal(m.closed, 1);
  assert.equal(m.closedWithPrimary.percent, 100);
  assert.equal(m.closedOnTwoHosts.percent, 0, 'one row, one host');
  assert.equal(m.ledgerVerifies, true);
  assert.equal(m.factCheck.computed, false);
  assert.match(renderMeasure(m).join('\n'), /fact check\s+not computed - .*needs a judge/);
});

test('quotes are counted found or not, and an edited capture stops the link from working', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (t) => t.replace('includes 1,000 credits. |',
    'includes 1,000 credits. [quote: The free plan allows 10 requests per minute] [quote: The paid plan allows 99 requests] |'));
  let m = measureCorpus(dir);
  assert.deepEqual(m.anchoredRows, { count: 1, percent: 100 });
  assert.deepEqual(m.quotesFound, { count: 1, of: 2, percent: 50 });

  // Listed with fs, not `ls`: the shell-out returned ENOENT on Windows and `.stdout.split`
  // threw on undefined (outside audit, 2026-10-03) - a portability defect of the test alone.
  const capture = `research/raw/${fs.readdirSync(`${dir}/research/raw`).find((f) => f.endsWith('.md'))}`;
  corrupt(dir, capture, (t) => `${t}\nedited after fetch\n`);
  m = measureCorpus(dir);
  assert.equal(m.linkWorks.count, 0, 'an edited capture is not a working citation');
  assert.equal(m.ledgerVerifies, false);
});

test('the CLI prints the report, --json prints it for machines, and a non-project is refused', () => {
  const bin = fileURLToPath(new URL('../bin/measure.mjs', import.meta.url));
  const dir = makePassingProject();
  const text = spawnSync(process.execPath, [bin], { cwd: dir, encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /link works\s+100%/);
  const json = spawnSync(process.execPath, [bin, '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(JSON.parse(json.stdout).linkWorks.percent, 100);
  const outside = spawnSync(process.execPath, [bin], { cwd: tempDir(), encoding: 'utf8' });
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /not a research project/);
});

test('formatting-only anchors are counted but never reported as found', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (t) => t.replace('includes 1,000 credits. |',
    `includes 1,000 credits. [quote: ${'*'.repeat(40)}] [quote: The free plan allows 10 requests per minute] |`));
  const measured = measureCorpus(dir);
  assert.deepEqual(measured.anchoredRows, { count: 1, percent: 100 });
  assert.deepEqual(measured.quotesFound, { count: 1, of: 2, percent: 50 },
    'the raw anchor counts, but only the actual passage was found');
});
