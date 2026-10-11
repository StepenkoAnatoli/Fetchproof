// An explicit unknown list is a supplied value, not permission to acquire one.
import { test, describe, assert, makePassingProject } from './harness.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { evaluate } from '../lib/gate.mjs';

describe('gate-staged-null');
test('explicit null remains unknown and does not invoke the private absent-option callback', () => {
  const root = makePassingProject();
  let calls = 0;
  const result = evaluate(root, {
    gate: 'commit', corpus: readCorpus(root), stagedPaths: null, record: false,
    listStaged: () => { calls += 1; return []; },
  });
  assert.equal(calls, 0, 'explicit unknown scope was silently replaced by acquisition');
  assert.equal(result.preflight.pass, true);
  assert.equal(result.allow, false);
  assert.equal(result.breach.rule, 'architecture-map-same-commit');
});
