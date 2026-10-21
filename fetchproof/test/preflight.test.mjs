// The verdict: which findings block, which warn, and whether the answer is PASS.
// Severity policy is the OPERATOR's machine config, not the agent's pick.

import { test, describe, assert, makePassingProject, corrupt, tempDir, fs, path } from './harness.mjs';
import { PATHS, resolve, writeText } from '../lib/core.mjs';
import { runPreflight, verdictContext, readGateState, fixCommand } from '../lib/preflight.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { CHECK_NAMES } from '../lib/checks.mjs';
import { rebuildLedger } from '../lib/provenance.mjs';

describe('preflight');

function envWith(config) {
  const dir = tempDir('fetchproof-policy-');
  const file = path.join(dir, 'fetchproof.config.json');
  writeText(file, JSON.stringify(config));
  return { ...process.env, FETCHPROOF_CONFIG: file };
}

test('a corpus that deserves it passes, with every check reporting', () => {
  const verdict = runPreflight(makePassingProject());
  assert.equal(verdict.pass, true);
  assert.equal(verdict.counts.fail, 0);

  // EVERY check reports - that is the invariant, and it is what stops a check being
  // silently skipped. It used to be asserted as "every check reports a PASS", which was
  // true only while no check had anything to say about the fixture. `corroboration` does:
  // the fixture's single unknown rests on a single row, which is precisely the shape it
  // exists to report. Renaming the fixture or padding it with a second source to keep the
  // old wording would have been tuning the world to fit the assertion.
  assert.equal(new Set(verdict.findings.map((f) => f.check)).size, CHECK_NAMES.length,
    'each check must report, even when it has nothing to say');

  // And the one thing it does have to say is named, rather than left as a count nobody
  // would notice changing.
  assert.deepEqual(verdict.warnings.map((f) => `${f.check}/${f.rule}`), ['corroboration/single-source'],
    'the fixture is single-sourced on purpose; any other warning here is a regression');
});

test('the verdict names what blocks, and prints one fix', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('CLOSED', 'OPEN'));
  const verdict = runPreflight(dir);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.length);
  assert.match(fixCommand(), /preflight\.mjs/);
});

test('--strict promotes every warning to a failure', () => {
  const dir = makePassingProject();
  writeText(resolve(dir, `${PATHS.raw}/2026-01-01-orphan-x-00000000.md`), '---\nurl: https://x.invalid/orphan\nretrieved: 2026-01-01\n---\n\nbody\n');

  const relaxed = runPreflight(dir);
  assert.equal(relaxed.pass, true);
  assert.ok(relaxed.counts.warn > 0);

  const strict = runPreflight(dir, { strict: true });
  assert.equal(strict.pass, false);
  assert.ok(strict.failures.every((f) => f.promoted === 'strict' || f.severity === 'fail'));
});

test('evidencePolicy=strict fails transport and completeness findings; pluralist warns', () => {
  const dir = makePassingProject();
  // Re-chain through the sanctioned migration path: editing the JSON by hand would
  // break the entry hash, and then the failure under test would be the wrong one.
  rebuildLedger(dir, () => ({ transport: 'agent page fetch' }), { note: 'restate the transport' });

  const pluralist = runPreflight(dir, { env: envWith({ evidencePolicy: 'pluralist' }) });
  assert.equal(pluralist.pass, true, 'the pluralist operator gets a warning');
  assert.ok(pluralist.warnings.some((f) => f.check === 'transport-provenance'));

  const strict = runPreflight(dir, { env: envWith({ evidencePolicy: 'strict' }) });
  assert.equal(strict.pass, false, 'the strict operator gets a failure');
  assert.ok(strict.failures.some((f) => f.check === 'transport-provenance' && f.promoted === 'evidencePolicy=strict'));
});

test('the evidence policy hardens evidence checks, and leaves hygiene alone', () => {
  // Rewritten 2026-09-21, when `corroboration` joined the policy set and this test went
  // red. It had inferred "hygiene is not hardened" from the WHOLE verdict passing, which
  // was always a proxy: any other policy check firing on the fixture breaks it, and one
  // did - the fixture project has a single unknown resting on a single row, which is
  // exactly what corroboration exists to report.
  //
  // So it now isolates the claim instead of inferring it.
  const dir = makePassingProject();
  writeText(resolve(dir, `${PATHS.raw}/2026-01-01-orphan-x-00000000.md`), '---\nurl: https://x.invalid/orphan\nretrieved: 2026-01-01\n---\n\nbody\n');

  const strictEnv = envWith({ evidencePolicy: 'strict' });
  const hygieneOnly = runPreflight(dir, { env: strictEnv, only: ['hygiene'] });
  assert.equal(hygieneOnly.pass, true, 'an uncited capture is untidy, not unproven - hygiene is not an evidence-policy check');
  assert.ok(hygieneOnly.warnings.length > 0, 'and it should still have said something');

  // The mirror: a check that IS in the policy set does harden, on the same project.
  const corroborationOnly = runPreflight(dir, { env: strictEnv, only: ['corroboration'] });
  assert.equal(corroborationOnly.pass, false, 'a single-sourced unknown must fail under evidencePolicy=strict');
  assert.ok(corroborationOnly.failures.some((f) => f.promoted === 'evidencePolicy=strict'),
    'and the promotion must be attributed, so a reader can tell a policy failure from a rule failure');

  // And under the default policy, neither of them blocks.
  const pluralist = runPreflight(dir, { env: envWith({ evidencePolicy: 'pluralist' }) });
  assert.equal(pluralist.pass, true, 'adding a check must not break every corpus that was passing');
});

test('--check runs a subset, and an unknown name is an error naming the registry', () => {
  const dir = makePassingProject();
  const one = runPreflight(dir, { only: ['citations'] });
  assert.deepEqual([...new Set(one.findings.map((f) => f.check))], ['citations']);
  assert.throws(() => runPreflight(dir, { only: ['nope'] }), /Known checks/);
});

test('verdictContext reads the corpus, the gate state and the policy TOGETHER', () => {
  const dir = makePassingProject();
  const context = verdictContext(dir);
  assert.equal(context.root, dir);
  assert.ok(context.corpus.chain, 'the chain is verified as part of the context');
  assert.equal(context.gate.gateOff, false);
  assert.equal(context.evidencePolicy, 'pluralist');
});

test("an injected corpus takes its gate state from the SNAPSHOT'S root, never the cwd", () => {
  const dir = makePassingProject();
  writeText(resolve(dir, PATHS.gateOff), 'off\n');
  const corpus = readCorpus(dir);

  const context = verdictContext(dir, { corpus });
  assert.equal(context.gate.gateOff, true);
  assert.equal(context.root, dir);
  assert.notEqual(context.root, process.cwd(), 'the same snapshot cannot yield a different verdict elsewhere');
});

test('readGateState sees GATE_OFF', () => {
  const dir = makePassingProject();
  assert.equal(readGateState(dir).gateOff, false);
  writeText(resolve(dir, PATHS.gateOff), '');
  assert.equal(readGateState(dir).gateOff, true);
});

test('runPreflight accepts a pre-read corpus, so a caller does not pay twice', () => {
  const dir = makePassingProject();
  const corpus = readCorpus(dir);
  const first = runPreflight(dir, { corpus });
  const second = runPreflight(dir, { corpus });
  assert.deepEqual(
    first.findings.map((f) => `${f.check}/${f.rule}/${f.severity}`),
    second.findings.map((f) => `${f.check}/${f.rule}/${f.severity}`),
  );
});

test('the maxAgeDays that judges staleness is the operator\'s, not a constant', () => {
  // Thirty days before TODAY: a fixed date outgrows any "generous" window on its own
  // (2026-01-01 against 3650 days did, on a forward clock; found 2026-09-30, break-test).
  const dir = makePassingProject(undefined, { date: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) });
  const generous = runPreflight(dir, { env: envWith({ maxAgeDays: 365 }) });
  assert.equal(generous.warnings.some((f) => f.rule === 'stale-evidence'), false);

  const tight = runPreflight(dir, { env: envWith({ maxAgeDays: 7 }) });
  assert.ok(tight.warnings.some((f) => f.rule === 'stale-evidence'));
});

test('a gated project with no contract fails harder than an ungated one', () => {
  const dir = makePassingProject();
  fs.rmSync(resolve(dir, PATHS.discovery));
  const verdict = runPreflight(dir);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.rule === 'contract-missing'));
});
