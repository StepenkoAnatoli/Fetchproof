// A refused contract read is not proof that the file is absent.
import { test, describe, assert, fs, tempDir } from './harness.mjs';
import { PATHS, resolve, writeText } from '../lib/core.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { runCheck } from '../lib/checks.mjs';

describe('contract-read-diagnostic');

test('discovery-contract: a missing or refused contract read gets a truthful failure', () => {
  const absent = readCorpus(tempDir('contract-absent-'));
  const root = tempDir('contract-refused-');
  const contract = resolve(root, PATHS.discovery);
  writeText(contract, '# Contract fixture\n');
  const read = fs.readFileSync;
  let refused = 0;
  let unreadable;
  try {
    fs.readFileSync = function (file, ...args) {
      if (String(file) === contract) {
        refused += 1;
        const error = new Error('EACCES: synthetic contract read refusal');
        error.code = 'EACCES';
        throw error;
      }
      return read.call(this, file, ...args);
    };
    unreadable = readCorpus(root);
  } finally {
    fs.readFileSync = read;
  }
  assert.equal(refused, 1, 'the real corpus reader must reach the refused file read');
  assert.equal(fs.statSync(contract).isFile(), true, 'the unreadable fixture is present');
  for (const corpus of [absent, unreadable]) {
    assert.equal(corpus.discovery.present, false);
    const findings = runCheck('discovery-contract', corpus);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'fail');
    assert.equal(findings[0].check, 'discovery-contract');
    assert.equal(findings[0].rule, 'contract-missing');
    assert.match(findings[0].detail, /research\/DISCOVERY\.md is missing or could not be read/);
    assert.match(findings[0].detail, /fails harder, not open/);
  }
});
