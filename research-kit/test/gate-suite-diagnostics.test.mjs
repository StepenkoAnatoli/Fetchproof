// The gate owns a red verdict after its scratch result disappears. Its detail must
// keep the runner's failing identifiers without creating an unbounded diagnostic.
import { test, describe, assert, assertEqual, tempDir, fs, path } from './harness.mjs';
import { writeText } from '../lib/core.mjs';
import { suiteBreach, SUITE_RULE } from '../lib/gate.mjs';

describe('gate-suite-diagnostics');

function kitFixture() {
  const root = tempDir('rk-suite-labels-');
  for (const file of ['lib/core.mjs', 'bin/gate.mjs', 'bin/selftest.mjs', 'test/.keep']) {
    writeText(path.join(root, 'research-kit', file), '// fixture\n');
  }
  return root;
}

test('a red verdict preserves failing identifiers beside counts and the existing shape', () => {
  const root = kitFixture();
  const failed = ['requests > partial delivery preserves the ledger', 'skill-set > the builder parser refuses unsafe input'];
  const red = suiteBreach(root, ['research-kit/lib/x.mjs'], { run: () => ({ passed: 1689, failures: 2, failed, unsupported: 4, exit: 1 }) });
  assertEqual(red.rule, SUITE_RULE);
  assertEqual(Object.keys(red).sort().join(','), 'detail,fix,rule');
  assert(/2 failed, 1689 passed, 4 unsupported/.test(red.detail), red.detail);
  for (const label of failed) assert(red.detail.includes(label), `the red verdict lost ${label}`);
  assert(/selftest\.mjs/.test(red.fix), red.fix);
  assertEqual(suiteBreach(root, ['research-kit/lib/x.mjs'], { run: () => ({ passed: 1691, failures: 0, failed: [], exit: 0 }) }), null);
});

test('failed identifiers are bounded and controls or missing legacy labels cannot break the detail', () => {
  const root = kitFixture();
  const labels = Array.from({ length: 40 }, (_, i) => `case-${i}: ${'x'.repeat(1000)}\n\t\0\u001b`);
  labels[0] = `first\n\t\0\u001b identifier ${'x'.repeat(1000)}`;
  labels[5] = 'MUST-NOT-EMIT-SIXTH';
  const red = suiteBreach(root, ['research-kit/lib/x.mjs'], { run: () => ({ passed: 0, failures: 40, failed: labels, exit: 1 }) });
  assert(red.detail.includes('first'), 'the first failing identifier was omitted');
  assert(!red.detail.includes('MUST-NOT-EMIT-SIXTH'), 'the diagnostic emitted an unbounded label list');
  assert(red.detail.length <= 2048, `red detail retained ${red.detail.length} characters`);
  assert(!/[\u0000-\u001f\u007f]/.test(red.detail), 'a test label injected control characters into the verdict');
  assert(/truncat|omitted/i.test(red.detail), 'a bounded diagnostic did not say that it omitted data');
  for (const failed of [undefined, null, 'not an array', [], [null, {}, 7]]) {
    const legacy = suiteBreach(root, ['research-kit/lib/x.mjs'], { run: () => ({ passed: 4, failures: 1, failed, exit: 1 }) });
    assertEqual(legacy.rule, SUITE_RULE);
    assert(/identifiers unavailable/.test(legacy.detail), JSON.stringify(legacy));
  }
  assert(fs.existsSync(path.join(root, 'research-kit', 'test', '.keep')), 'the diagnostic altered its checkout');
});
