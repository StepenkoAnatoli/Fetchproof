// Diagnostics and install/repair. Both run against disposable fixtures: explicit
// config and settings paths, an injected probe, and no host state consulted.

import { spawnSync } from 'node:child_process';
import { test, describe, assert, makePassingProject, makeProject, corrupt, tempDir, fs, path, KIT_ROOT, requireCapability, requireGit, fixtureInitArgs } from './harness.mjs';
import { TESTED_CLI_VERSION } from '../lib/firecrawl.mjs';
import { PATHS, resolve, readText, writeText, readJson } from '../lib/core.mjs';
import { runDoctor, machineHealth, gateHealth, editGateState, scanForSecrets } from '../lib/doctor.mjs';
import { installEditGate, removeEditGate, installCommitGate, removeCommitGate, settingsState, retiredRepairNote, MATCHER } from '../lib/installer.mjs';
import { EDIT_GATE_HOOK, RETIRED_EDIT_GATE_HOOKS } from '../lib/machine.mjs';

describe('doctor');

const ABSENT = () => ({ installed: false, authenticated: false, version: null, credits: null });
const READY = () => ({ installed: true, authenticated: true, version: '1.4.0', credits: 940 });
const KEYLESS = () => ({ installed: true, authenticated: false, version: '1.4.0', credits: null });

function machine({ config = {}, settings = undefined } = {}) {
  const dir = tempDir('research-kit-machine-');
  const configFile = path.join(dir, 'research-kit.config.json');
  const settingsFile = path.join(dir, 'settings.json');
  if (settings !== undefined) writeText(settingsFile, typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2));
  writeText(configFile, JSON.stringify({ ...config, editGate: { settingsPath: settingsFile, ...(config.editGate ?? {}) } }));
  return { dir, configFile, settingsFile, env: { ...process.env, RESEARCH_KIT_CONFIG: configFile, RESEARCH_KIT_INSTALL_STATE: path.join(dir, 'install.json') } };
}

const find = (findings, name) => findings.find((f) => f.name === name);

// A no-hit result describes inspected files. Reaching the count at the final file is
// different from returning at that count while another path remains uninspected.
test('secret cap: coverage distinguishes a complete boundary from an uninspected path', () => {
  const complete = tempDir('rk-secret-cap-complete-');
  writeText(path.join(complete, 'one.txt'), 'ordinary fixture text\n');
  writeText(path.join(complete, 'two.txt'), 'another ordinary fixture\n');
  const all = scanForSecrets(complete, { maxFiles: 2 });
  assert.equal(all.scanned, 2);
  assert.deepEqual(all.hits, []);
  assert.doesNotMatch(all.coverage, /incomplete|stopped at/i,
    'reaching the limit on the final file must not invent an omitted path');

  const capped = tempDir('rk-secret-cap-extra-');
  for (const name of ['one.txt', 'two.txt', 'three.txt']) writeText(path.join(capped, name), 'ordinary fixture text\n');
  const part = scanForSecrets(capped, { maxFiles: 2 });
  assert.equal(part.scanned, 2);
  assert.deepEqual(part.hits, []);
  assert.match(part.coverage, /incomplete/i, 'a bounded no-hit scan must identify omitted coverage');
  assert.match(part.coverage, /stopped at.*2.*file cap/i);
  assert.equal(all.capped, false);
  assert.equal(part.capped, true);
});

// Every candidate file has the same content, so these default-cap fixtures require no
// filesystem enumeration order. They exercise runDoctor's real scanner and finding path.
test('secret cap: doctor warns when its clean scan stops at the default file cap', () => {
  const dir = tempDir('rk-secret-cap-doctor-clean-');
  for (let i = 0; i < 2001; i += 1) writeText(path.join(dir, `entry-${i}.txt`), 'ordinary fixture text\n');
  const { env } = machine({ config: { role: 'collector' } });
  const report = runDoctor(dir, { env, probe: READY, record: false });
  const scan = find(report.findings, 'secret-scan');
  assert.equal(scan?.severity, 'warn', 'a capped no-hit scan must not report PASS');
  assert.match(scan.detail, /incomplete/i);
  assert.match(scan.detail, /stopped at.*2000.*file cap/i);
  assert.doesNotMatch(scan.detail, /no secrets|repository.*clear|whole.*clear/i);
});

test('secret cap: doctor retains critical hits alongside incomplete coverage', () => {
  const dir = tempDir('rk-secret-cap-doctor-hit-');
  const sentinel = `fc-${'Z'.repeat(24)}`; // synthetic pattern fixture, never a credential
  for (let i = 0; i < 2001; i += 1) writeText(path.join(dir, `entry-${i}.txt`), `${sentinel}\n`);
  const { env } = machine({ config: { role: 'collector' } });
  const report = runDoctor(dir, { env, probe: READY, record: false });
  const hits = report.findings.filter((finding) => finding.name === 'secret');
  assert.equal(hits.length, 2000, 'the default cap remains 2000 inspected text files');
  assert.ok(hits.every((hit) => hit.severity === 'critical'), 'incomplete coverage must not weaken actual hits');
  assert.ok(hits.every((hit) => /firecrawl-key/.test(hit.detail)));
  const scan = find(report.findings, 'secret-scan');
  assert.equal(scan?.severity, 'warn', 'incomplete coverage must remain visible when a hit was found');
  assert.match(scan.detail, /incomplete/i);
  assert.equal(report.ok, false, 'actual detected keys still block doctor readiness');
  assert.equal(report.blocking.filter((finding) => finding.name === 'secret').length, 2000);
});

// Found 2026-10-02 (break-test pass 3, a fake CLI reporting v2.0.0): doctor printed
// `pass firecrawl-cli 2.0.0` while research.mjs refused that CLI before spending - the
// health check and the run disagreed about the one dependency outside the repository.
test('doctor judges the CLI version the way the run does: an unsupported major fails, a newer minor passes and says so', () => {
  const { env } = machine({ config: { role: 'collector' } });
  const unsupported = find(machineHealth({ env, probe: () => ({ installed: true, authenticated: true, version: '2.0.0', credits: 940 }) }), 'firecrawl-cli');
  assert.equal(unsupported.severity, 'fail', JSON.stringify(unsupported));
  assert.match(unsupported.detail, /major 2/);
  assert.match(unsupported.fix, /1\.x|http-keyless/);
  const newer = find(machineHealth({ env, probe: () => ({ installed: true, authenticated: true, version: '1.99.0', credits: 940 }) }), 'firecrawl-cli');
  assert.equal(newer.severity, 'pass', JSON.stringify(newer));
  assert.match(newer.detail, /tested against/);
  const builder = find(machineHealth({ env: { ...machine({ config: { role: 'builder' } }).env }, probe: () => ({ installed: true, authenticated: true, version: '2.0.0', credits: 940 }) }), 'firecrawl-cli');
  assert.equal(builder.severity, 'info', 'a builder does not collect, so an unsupported CLI there is information');
});

test('a healthy collector reports its credential state as a pass', () => {
  const { env } = machine({ config: { role: 'collector' } });
  const findings = machineHealth({ env, probe: READY });
  assert.equal(find(findings, 'firecrawl-cli').severity, 'pass');
  assert.equal(find(findings, 'firecrawl-auth').severity, 'pass');
  assert.match(find(findings, 'firecrawl-auth').detail, /940 credits/);
});

test('a collector without a key is a FAIL - a collector that cannot collect is broken', () => {
  const { env } = machine({ config: { role: 'collector' } });
  const findings = machineHealth({ env, probe: KEYLESS });
  assert.equal(find(findings, 'firecrawl-auth').severity, 'fail');
  assert.match(find(findings, 'firecrawl-auth').fix, /firecrawl login/);
  // Found 2026-09-29 walking a newcomer's first run: the only fix named was `firecrawl login`,
  // though a no-account route exists and install.mjs itself offers it. The fix names both,
  // and the keyless one as the setting that makes this check pass (ADR-0095), not a per-run flag.
  assert.match(find(findings, 'firecrawl-auth').fix, /"transport": "http-keyless"/);
  assert.match(find(findings, 'firecrawl-auth').fix, /research-kit\.config\.json/);
});

// Found 2026-09-27: without the CLI, doctor said "install the Firecrawl CLI" and nothing said how
// - not doctor, not the README - and the package name is the trap the collector workflow once
// fell into (an npm package named `firecrawl` installs no `firecrawl` binary). The exact
// command is the one the workflows use.
test('a collector without the Firecrawl CLI is told the exact install command', () => {
  const { env } = machine({ config: { role: 'collector' } });
  const cli = find(machineHealth({ env, probe: ABSENT }), 'firecrawl-cli');
  assert.equal(cli.severity, 'fail');
  assert.match(cli.fix, new RegExp(`npm install -g firecrawl-cli@${TESTED_CLI_VERSION.replace(/\./g, '\\.')}`), cli.fix);
  assert.match(cli.fix, /http-keyless/, 'the keyless route must still be offered');
});

test('on a BUILDER the same state is informational - a gate that is always red is one nobody reads', () => {
  const { env } = machine({ config: { role: 'builder' } });
  const findings = machineHealth({ env, probe: ABSENT });
  assert.equal(find(findings, 'firecrawl-cli').severity, 'pass');
  assert.match(find(findings, 'firecrawl-cli').detail, /expected on a builder/);
  assert.match(find(findings, 'machine-role').detail, /must NOT collect/);
});

test('the role and its consequence are reported on every run', () => {
  const { env } = machine({ config: { role: 'collector' } });
  assert.match(find(machineHealth({ env, probe: READY }), 'machine-role').detail, /collector - this machine may collect/);
});

test('an unreadable machine config is a blocking CRITICAL that names the resolved posture', () => {
  const { env, configFile } = machine({});
  writeText(configFile, '{"failOpen": fal');
  const findings = machineHealth({ env, probe: READY });
  const finding = find(findings, 'machine-config');
  assert.equal(finding.severity, 'critical');
  assert.match(finding.detail, /does not parse/);
  assert.match(finding.detail, /fail-CLOSED/);
});

test('a retired config key and a retired env var are both reported', () => {
  const { env, configFile } = machine({});
  writeText(configFile, JSON.stringify({ claudeGate: 'hard-block' }));
  const findings = machineHealth({ env: { ...env, CLAUDE_SETTINGS_PATH: '/old.json' }, probe: READY });
  assert.match(find(findings, 'config-retired-key').detail, /claudeGate/);
  assert.match(find(findings, 'env-retired').detail, /NOT honoured/);
});

// ADR-0121: an ill-typed posture key resolves to the restrictive state, and doctor names the
// key and the state it resolved to, so the operator who typed it learns what their typo did.
test('an ill-typed posture key is named by doctor, with the state it resolved to', () => {
  const { env, configFile } = machine({});
  writeText(configFile, JSON.stringify({ failOpen: 'false', evidencePolicy: 'STRICT' }));
  const findings = machineHealth({ env, probe: READY });
  const named = findings.filter((f) => f.name === 'config-ill-typed');
  assert.equal(named.length, 2, JSON.stringify(findings.map((f) => f.name)));
  assert.match(named[0].detail, /"failOpen".*fail-closed/);
  assert.match(named[1].detail, /"evidencePolicy".*strict/);
  assert.match(find(findings, 'machine-config').detail, /fail-closed/, 'the posture line reports the resolved posture');
});

test('doctor reports the gate, the chain, the shape and the verdict from ONE snapshot', () => {
  const dir = makePassingProject();
  const { env } = machine({});
  const report = runDoctor(dir, { env, probe: READY, record: false });

  assert.equal(find(report.findings, 'project-gated').severity, 'pass');
  assert.equal(find(report.findings, 'preflight').severity, 'pass');
  assert.match(find(report.findings, 'ledger-chain').detail, /chain verifies/);
  assert.equal(find(report.findings, 'overrides').detail, 'none recorded');
});

// Found 2026-10-02 (break-test pass 3, F7b): a line appended to the DEPLOYED lib/core.mjs,
// then `node ~/.agents/research-kit/bin/doctor.mjs` - the copy an agent runs - printed
// `pass deploy ... matches this tree`. It did: a tree compared with itself always matches.
// The deploy check measures the deployment against the tree doctor runs from, so run from
// the deployment it measures nothing, and said it had.
test('doctor run from the deployed kit itself says the deploy was not measured, never that it matches', () => {
  const dir = makePassingProject();
  const { env } = machine({});
  writeText(env.RESEARCH_KIT_INSTALL_STATE, JSON.stringify({ kitHome: KIT_ROOT, at: '2026-10-02T00:00:00.000Z' }));
  const self = find(runDoctor(dir, { env, probe: READY, record: false }).findings, 'deploy');
  assert.equal(self.severity, 'info', JSON.stringify(self));
  assert.match(self.detail, /running from the deployed kit itself/);
  assert.doesNotMatch(self.detail, /matches this tree/);
  assert.match(self.detail, /bin[\\/]doctor\.mjs/, 'it names the command that does measure');

  const elsewhere = tempDir('research-kit-deployed-elsewhere-');
  writeText(env.RESEARCH_KIT_INSTALL_STATE, JSON.stringify({ kitHome: elsewhere, at: '2026-10-02T00:00:00.000Z' }));
  const other = find(runDoctor(dir, { env, probe: READY, record: false }).findings, 'deploy');
  assert.doesNotMatch(other.detail, /running from the deployed kit itself/, 'a deployment elsewhere is measured as before');
});

test('a failing verdict and a broken chain are both blockers, each named', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.discovery, (text) => text.replace('CLOSED', 'OPEN'));
  corrupt(dir, PATHS.ledger, (text) => text.replace('"seq":1', '"seq":5'));

  const { env } = machine({});
  const report = runDoctor(dir, { env, probe: READY, record: false });
  assert.equal(report.ok, false);
  assert.equal(find(report.findings, 'preflight').severity, 'fail');
  assert.equal(find(report.findings, 'ledger-chain').severity, 'fail');
});

test('on a collector, an unhanded corpus is information - not a pass that says it failed to arrive', () => {
  // Found 2026-09-26 in a live-collection log, on a freshly scaffolded collector project:
  //   pass  handoff-ledger-missing  research/raw/.fetches.jsonl is not in this checkout -
  //                                 the corpus arrived without its ledger
  // Nothing had arrived - nothing had been collected yet - and a PASS whose detail
  // describes a failure is a line a reader must argue with.
  const dir = makeProject();
  const collector = runDoctor(dir, { env: machine({ config: { role: 'collector' } }).env, probe: READY, record: false });
  const mine = find(collector.findings, 'handoff-ledger-missing');
  assert.ok(mine, 'the collector no longer reports the missing ledger at all');
  assert.equal(mine.severity, 'info');
  assert.ok(!/arrived/.test(mine.detail), `a collector is told its corpus "arrived": ${mine.detail}`);
  assert.match(mine.detail, /builder/, 'the collector is not told why the finding exists');

  const builder = runDoctor(dir, { env: machine({ config: { role: 'builder' } }).env, probe: READY, record: false });
  const theirs = find(builder.findings, 'handoff-ledger-missing');
  assert.equal(theirs.severity, 'fail', 'on a builder it is still a blocker');
  assert.match(theirs.detail, /arrived without its ledger/);
});

test('doctor counts each override by kind', () => {
  const dir = makePassingProject();
  writeText(resolve(dir, PATHS.overrides), [
    '2026-09-17T00:00:00.000Z\tGATE_OFF\tcommit gate',
    '2026-09-17T00:01:00.000Z\tGATE_OFF\tedit gate',
    '2026-09-17T00:02:00.000Z\tlocal-hooks-path\t.husky',
  ].join('\n'));

  const { env } = machine({});
  const finding = find(runDoctor(dir, { env, probe: READY, record: false }).findings, 'overrides');
  assert.match(finding.detail, /GATE_OFF x2/);
  assert.match(finding.detail, /local-hooks-path x1/);
});

test('an ungated project is reported as such rather than judged', () => {
  const dir = tempDir('research-kit-plain-');
  const { env } = machine({});
  const report = runDoctor(dir, { env, probe: READY, record: false });
  assert.equal(find(report.findings, 'project-gated').severity, 'warn');
  assert.equal(find(report.findings, 'preflight'), undefined, 'there is nothing to judge');
});

test('doctor is read-only about the corpus', () => {
  const dir = makePassingProject();
  const before = readText(resolve(dir, PATHS.ledger));
  const { env } = machine({});
  runDoctor(dir, { env, probe: READY, record: false });
  assert.equal(readText(resolve(dir, PATHS.ledger)), before);
});

// --- the edit-time gate ------------------------------------------------------------

test('installEditGate writes exactly one registration, pointing at the current hook', () => {
  const { env, settingsFile } = machine({ settings: {} });
  const result = installEditGate({ kitHome: KIT_ROOT, env });
  assert.equal(result.ok, true, result.reason);

  const settings = readJson(settingsFile);
  const hooks = settings.hooks.PreToolUse;
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].matcher, MATCHER);
  assert.match(hooks[0].hooks[0].command, new RegExp(EDIT_GATE_HOOK.replace('/', '[\\\\/]')));
  // Asked with the kitHome it was installed against - the state is about WHICH kit the
  // registration points at, so the question has to name one.
  assert.equal(settingsState({ env, kitHome: KIT_ROOT }), 'current');
});

test('a registration at a RETIRED name is REPLACED, not doubled, and the repair is reported', () => {
  const { env, settingsFile } = machine({
    settings: {
      hooks: { PreToolUse: [{ matcher: MATCHER, hooks: [{ type: 'command', command: `node "/old/kit/${RETIRED_EDIT_GATE_HOOKS[0]}"` }] }] },
    },
  });
  assert.equal(settingsState({ env, kitHome: KIT_ROOT }), 'retired', 'an un-upgraded machine reads as repairable, not healthy or broken');

  const result = installEditGate({ kitHome: KIT_ROOT, env });
  const hooks = readJson(settingsFile).hooks.PreToolUse;
  assert.equal(hooks.length, 1, 'a stale entry must never be left beside a new one');
  assert.doesNotMatch(hooks[0].hooks[0].command, new RegExp(RETIRED_EDIT_GATE_HOOKS[0].replace('/', '[\\\\/]')));
  assert.match(result.note, /replaced 1 registration/);
  assert.match(retiredRepairNote(['a', 'b']), /replaced 2 registration/);
});

test('installing twice leaves one registration, not two', () => {
  const { env, settingsFile } = machine({ settings: {} });
  installEditGate({ kitHome: KIT_ROOT, env });
  installEditGate({ kitHome: KIT_ROOT, env });
  assert.equal(readJson(settingsFile).hooks.PreToolUse.length, 1);
});

test("the operator's OTHER hooks and unknown keys survive the write", () => {
  const { env, settingsFile } = machine({
    settings: {
      model: '<unknown-model>',
      env: { PROVIDER_API_KEY: 'x', PROVIDER_BASE_URL: 'y' },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node /theirs.mjs' }] }] },
    },
  });
  installEditGate({ kitHome: KIT_ROOT, env });

  const settings = readJson(settingsFile);
  assert.equal(settings.model, '<unknown-model>');
  assert.deepEqual(settings.env, { PROVIDER_API_KEY: 'x', PROVIDER_BASE_URL: 'y' });
  assert.equal(settings.hooks.PreToolUse.length, 2, "the operator's own hook is not ours to remove");
  assert.ok(settings.hooks.PreToolUse.some((e) => e.matcher === 'Bash'));
});

test('a settings file the installer does not recognise is REFUSED, never rewritten', () => {
  const { env, settingsFile } = machine({ settings: '[[[ not settings at all' });
  const result = installEditGate({ kitHome: KIT_ROOT, env });
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not recognise/);
  assert.equal(readText(settingsFile), '[[[ not settings at all', 'the file is untouched');
});

// Found 2026-09-30, break-test. The settings file belongs to the RUNTIME, so the shape of
// `hooks.PreToolUse` is not the kit's to guarantee - and a node of the wrong type threw out
// of the walkers rather than being refused:
//
//   {"hooks": {"PreToolUse": [null]}}                       -> TypeError: Cannot read properties of null (reading 'hooks')
//   {"hooks": {"PreToolUse": [{"matcher":"Edit","hooks":5}]}} -> TypeError: (e.hooks ?? []).map is not a function
//
// Both reached `install-hooks.mjs` as a raw stack trace and exit 1 - the command an operator
// runs because something already looks wrong. `doctor` only survived because `gateHealth`
// wraps the call in its own try/catch.
test('a PreToolUse node of the wrong type is REFUSED by name, not thrown at', () => {
  const shapes = [
    { hooks: null },
    { hooks: [] },
    { hooks: 7 },
    { hooks: 'none' },
    { hooks: { PreToolUse: [null] } },
    { hooks: { PreToolUse: [7] } },
    { hooks: { PreToolUse: ['x'] } },
    { hooks: { PreToolUse: [[]] } },
    { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: 5 }] } },
    { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: {} }] } },
    { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: 'x' }] } },
    { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [null] }] } },
    { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [[]] }] } },
    { hooks: { PreToolUse: 7 } },
  ];
  for (const settings of shapes) {
    assert.equal(editGateState(settings), 'none', `editGateState threw or misreported for ${JSON.stringify(settings)}`);
    const { env, settingsFile } = machine({ settings });
    const before = readText(settingsFile);
    assert.equal(settingsState({ env, kitHome: KIT_ROOT }), 'unfamiliar',
      `settingsState threw or answered something else for ${JSON.stringify(settings)}`);
    const result = installEditGate({ kitHome: KIT_ROOT, env });
    assert.equal(result.ok, false, `installEditGate accepted ${JSON.stringify(settings)}`);
    assert.match(result.reason, /does not recognise/);
    assert.equal(readText(settingsFile), before, 'the file is untouched');
    const removed = removeEditGate({ env });
    assert.equal(removed.ok, false, `removeEditGate accepted ${JSON.stringify(settings)}`);
    assert.equal(readText(settingsFile), before, 'the file is untouched');
  }
});

// The shapes the walkers DO handle, asserted beside the refusals so a guard that refused
// everything would fail here rather than passing vacuously. An entry with no `hooks` key
// and an empty list are both the documented shape.
//
// The two entries that carry NO hooks are dropped by the write, as they always were
// (`if (hooks.length) kept.push(...)`): a registration with nothing in it gates nothing.
// What this asserts is that the one that carries a real command survives, and that the
// unknown top-level keys survive with it.
test('the shapes the installer does walk still install, and the operator keeps their entries', () => {
  const { env, settingsFile } = machine({
    settings: {
      model: 'keep-me',
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'node /theirs.mjs' }] },
          { matcher: 'Edit' },
          { matcher: 'Write', hooks: [] },
        ],
      },
    },
  });
  const result = installEditGate({ kitHome: KIT_ROOT, env });
  assert.equal(result.ok, true, result.reason);
  const hooks = readJson(settingsFile).hooks.PreToolUse;
  assert.equal(hooks.length, 2, "the operator's real hook and ours; the two that gate nothing are dropped");
  assert.equal(readJson(settingsFile).model, 'keep-me');
  assert.ok(hooks.some((e) => e.matcher === 'Bash' && e.hooks[0].command === 'node /theirs.mjs'));
  assert.equal(settingsState({ env, kitHome: KIT_ROOT }), 'current');
});

test('a backup is written before the settings file is changed', () => {
  const { env, settingsFile } = machine({ settings: { model: 'keep-me' } });
  installEditGate({ kitHome: KIT_ROOT, env });
  const backups = fs.readdirSync(path.dirname(settingsFile)).filter((n) => n.includes('settings.json.bak-'));
  assert.equal(backups.length, 1);
  assert.match(readText(path.join(path.dirname(settingsFile), backups[0])), /keep-me/);
});

test('--dry-run writes nothing and says what it would do', () => {
  const { env, settingsFile } = machine({ settings: {} });
  const before = readText(settingsFile);
  const result = installEditGate({ kitHome: KIT_ROOT, env, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.match(result.would, /edit-gate\.mjs/);
  assert.equal(readText(settingsFile), before);
});

// Found 2026-10-01 (break-test): on a machine where the kit was NOT deployed - a fresh
// contributor, a new CI box - `install-hooks --dry-run` printed "would set core.hooksPath=..."
// and "would register in .../settings.json: ..." and exited 0, while the real run exited 1 and
// installed neither gate. A dry run is the answer an operator trusts INSTEAD of running the
// thing, so it has to answer the question the real run answers. Both halves short-circuited
// past their own precondition: installCommitGate returned the dry-run answer before the
// `!exists(hook)` check, and installEditGate wrote that check as `!dryRun && !exists(hook)`.
// This is the sibling the 2026-09-29 `install --dry-run` prune fix was never swept to.
test('a dry run reports the refusal the real run would give, not a promise it would break', () => {
  const { env } = machine();
  // A kitHome that holds nothing: no githooks/pre-commit, no hooks/edit-gate.mjs.
  const kitHome = tempDir('research-kit-notdeployed-');
  const gitPaths = { env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(kitHome, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } };

  const realCommit = installCommitGate({ kitHome, env, gitPaths });
  assert.equal(realCommit.ok, false, 'the real run is expected to refuse when nothing is deployed');
  const dryCommit = installCommitGate({ kitHome, env, gitPaths, dryRun: true });
  assert.equal(dryCommit.ok, false, 'a dry run promised a core.hooksPath the real run refuses to set');
  assert.match(String(dryCommit.reason), /not deployed/, 'the dry run did not name the same cause the real run names');

  const realEdit = installEditGate({ kitHome, env });
  assert.equal(realEdit.ok, false, 'the real run is expected to refuse when nothing is deployed');
  const dryEdit = installEditGate({ kitHome, env, dryRun: true });
  assert.equal(dryEdit.ok, false, 'a dry run promised an edit-gate registration the real run refuses to write');
  assert.match(String(dryEdit.reason), /not deployed/, 'the dry run did not name the same cause the real run names');

  // And the promise still happens when the kit IS deployed - the check is the precondition,
  // not a ban on dry runs. `ok: true` is asserted as well: a preview that carried no `ok` key
  // made a caller testing `!result.ok` first print `commit gate: undefined` and exit 1 on a
  // machine where everything was fine.
  const ok = installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, dryRun: true });
  assert.equal(ok.ok, true, 'a preview must carry ok:true, so one shape answers every caller');
  assert.equal(ok.dryRun, true, 'a dry run against a deployed kit must still preview');
  assert.match(ok.would, /githooks/);
  const okEdit = installEditGate({ kitHome: KIT_ROOT, env, dryRun: true });
  assert.equal(okEdit.ok, true, 'a preview must carry ok:true, so one shape answers every caller');
  assert.equal(okEdit.dryRun, true);
});

test('removeEditGate takes out a retired entry too', () => {
  const { env, settingsFile } = machine({
    settings: { hooks: { PreToolUse: [
      { matcher: MATCHER, hooks: [{ type: 'command', command: `node "/old/${RETIRED_EDIT_GATE_HOOKS[0]}"` }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'node /theirs.mjs' }] },
    ] } },
  });
  const result = removeEditGate({ env });
  assert.equal(result.removed, 1);
  const hooks = readJson(settingsFile).hooks.PreToolUse;
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].matcher, 'Bash');
});

// Found 2026-09-27: install then --uninstall on a machine with no settings file left
// {"hooks": {"PreToolUse": []}} behind - not the pre-install state --uninstall promises.
test('uninstalling the edit gate leaves no empty hook containers, and no file it made empty', () => {
  const { env, settingsFile } = machine();
  installEditGate({ kitHome: KIT_ROOT, env });
  removeEditGate({ env });
  assert.equal(fs.existsSync(settingsFile), false, `left behind: ${fs.existsSync(settingsFile) ? readText(settingsFile) : ''}`);

  const theirs = machine({ settings: { model: 'x', hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'node /theirs.mjs' }] }] } } });
  installEditGate({ kitHome: KIT_ROOT, env: theirs.env });
  removeEditGate({ env: theirs.env });
  assert.deepEqual(readJson(theirs.settingsFile), { model: 'x', hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'node /theirs.mjs' }] }] } },
    'everything the operator had is kept, and only the empty list the kit made is gone');
});

test('a settings file saved with a byte-order mark is read, not refused as unfamiliar', () => {
  const { env, settingsFile } = machine({ settings: `\uFEFF${JSON.stringify({ model: 'x' })}` });
  const result = installEditGate({ kitHome: KIT_ROOT, env });
  assert.equal(result.ok, true, result.reason);
  assert.equal(readJson(settingsFile).model, 'x', 'the operator\'s key was lost');
});

test('gateHealth reports the edit gate in three states', () => {
  assert.equal(editGateState(null), 'none');
  assert.equal(editGateState({}), 'none');
  assert.equal(editGateState({ hooks: { PreToolUse: [{ hooks: [{ command: `node ${EDIT_GATE_HOOK}` }] }] } }), 'current');
  assert.equal(editGateState({ hooks: { PreToolUse: [{ hooks: [{ command: `node ${RETIRED_EDIT_GATE_HOOKS[0]}` }] }] } }), 'retired');
});

test('gateHealth names an absent commit gate and the command that installs it', () => {
  const dir = makeProject();
  const { env } = machine({ settings: {} });
  const findings = gateHealth(dir, { env, gitPaths: { cwd: dir }, record: false });
  const commit = find(findings, 'gate-commit');
  assert.ok(['warn', 'pass', 'fail'].includes(commit.severity));
  if (commit.severity === 'warn') assert.match(commit.fix, /install-hooks\.mjs/);
});

// --- what do the hooks hand on to? ---------------------------------------------------

// Found 2026-10-03 on the maintainer's machine: after "research gate: allow" every commit
// printed "gate error: number 0 is not iterable" and "allowing this commit (fail-open)" -
// wording that exists only in old versions of this kit. The hooks hand on to the folder the
// install replaced (ADR-0112), and that folder was the previous implementation's own
// githooks/: two gates on every commit, the older one deciding on its own rules and failing
// open. doctor said nothing; it reports it now, with the one-line remedy (ADR-0134).
test('handOnState: the folder the install replaced is none, missing, another copy of this kit, or somebody else\'s hooks', async () => {
  const { handOnState } = await import('../lib/doctor.mjs');
  assert.equal(handOnState({ previous: null }).state, 'none');
  assert.equal(handOnState({ previous: path.join(tempDir('rk-gone-'), 'nowhere') }).state, 'missing');
  const old = tempDir('rk-old-kit-');
  writeText(path.join(old, 'pre-commit'), '#!/bin/sh\n# research-kit commit gate - POSIX sh wrapper around bin/gate.mjs.\nexit 0\n');
  assert.equal(handOnState({ previous: old }).state, 'kit');
  const husky = tempDir('rk-husky-hooks-');
  writeText(path.join(husky, 'pre-commit'), '#!/bin/sh\n# husky\n');
  assert.equal(handOnState({ previous: husky }).state, 'other');
  assert.equal(handOnState({ previous: tempDir('rk-empty-hooks-') }).state, 'other', 'a folder with no pre-commit hands nothing on, and is nobody\'s business');
});

test('doctor warns when the hooks folder the install replaced is another copy of this kit\'s gate', () => {
  requireGit('the recorded previous hooks folder');
  const { env } = machine({ settings: {} });
  const dir = tempDir('rk-handon-');
  const gitPaths = { env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } };
  const old = path.join(dir, 'old-kit-githooks');
  writeText(path.join(old, 'pre-commit'), '#!/bin/sh\n# research-kit commit gate - POSIX sh wrapper around bin/gate.mjs.\n');
  spawnSync('git', ['config', '--global', 'research-kit.previousHooksPath', old], { env: gitPaths.env });
  const project = makeProject();
  const warned = gateHealth(project, { env, gitPaths: { ...gitPaths, cwd: project }, record: false });
  const finding = find(warned, 'gate-hand-on');
  assert.ok(finding, `no gate-hand-on finding: ${JSON.stringify(warned.map((x) => x.name))}`);
  assert.equal(finding.severity, 'warn');
  assert.match(finding.detail, /another copy of this kit/);
  assert.match(finding.fix, /--unset research-kit\.previousHooksPath/);

  spawnSync('git', ['config', '--global', '--unset', 'research-kit.previousHooksPath'], { env: gitPaths.env });
  assert.equal(find(gateHealth(project, { env, gitPaths: { ...gitPaths, cwd: project }, record: false }), 'gate-hand-on'), undefined,
    'with nothing recorded there is nothing to say');
});

// Found 2026-10-03 (outside audit, second round): the hooks read the recorded folder with
// `git config --type=path`, which expands a leading `~`; the doctor reader took the raw value,
// so `~/custom-hooks` with a legitimate pre-commit in it was reported "no longer exists" with
// an unset as the remedy - advice that would have removed a working hand-on.
test('a previous hooks folder recorded as ~/... is read the way the hooks read it', () => {
  requireGit('a home-relative previous hooks folder');
  const { env } = machine({ settings: {} });
  const dir = tempDir('rk-handon-tilde-');
  const gitPaths = { env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } };
  const name = `rk-custom-hooks-${process.pid}-${Date.now()}`;
  const home = process.env.HOME;
  const hooks = path.join(home, name);
  writeText(path.join(hooks, 'pre-commit'), '#!/bin/sh\n# husky\n');
  spawnSync('git', ['config', '--global', 'research-kit.previousHooksPath', `~/${name}`], { env: gitPaths.env });
  const project = makeProject();
  try {
    const findings = gateHealth(project, { env, gitPaths: { ...gitPaths, cwd: project }, record: false });
    assert.equal(find(findings, 'gate-hand-on'), undefined,
      `a working hand-on was reported: ${JSON.stringify(find(findings, 'gate-hand-on'))}`);
    // And the kit case names the folder as git resolves it, not as it was typed.
    writeText(path.join(hooks, 'pre-commit'), '#!/bin/sh\n# research-kit commit gate - POSIX sh wrapper around bin/gate.mjs.\n');
    const warned = find(gateHealth(project, { env, gitPaths: { ...gitPaths, cwd: project }, record: false }), 'gate-hand-on');
    assert.ok(warned, 'a second kit was not reported');
    // Expanded, not as typed: git spells the home its own way (on the Windows runner a
    // forward-slash 8.3 path), so the folder's NAME is asserted and the `~` is asserted gone.
    assert.ok(warned.detail.includes(name), `the finding does not name the folder: ${warned.detail}`);
    assert.doesNotMatch(warned.detail, /~\//, `the finding carries the typed ~ instead of the resolved folder: ${warned.detail}`);
  } finally {
    fs.rmSync(hooks, { recursive: true, force: true });
  }
});

// Found 2026-10-03 (outside audit, fourth round): a previous hooks folder recorded as a RELATIVE
// path (`.custom-hooks`) is run by git from the repository's top level, and a commit from a
// subdirectory ran it; doctor resolved it against its own working directory and from `nested/`
// called it missing, with the unset as remedy.
test('a relative previous hooks folder is resolved from the repository top level, wherever doctor runs', () => {
  requireGit('a relative previous hooks folder');
  const { env } = machine({ settings: {} });
  const dir = tempDir('rk-handon-relative-');
  const gitPaths = { env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } };
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  assert.equal(spawnSync('git', fixtureInitArgs(), { cwd: repo, env: gitPaths.env }).status, 0);
  writeText(path.join(repo, '.custom-hooks', 'pre-commit'), '#!/bin/sh\n# husky\n');
  spawnSync('git', ['config', '--global', 'research-kit.previousHooksPath', '.custom-hooks'], { env: gitPaths.env });
  const nested = path.join(repo, 'nested');
  fs.mkdirSync(nested);
  const findings = gateHealth(nested, { env, gitPaths: { ...gitPaths, cwd: nested }, record: false });
  assert.equal(find(findings, 'gate-hand-on'), undefined, `a working relative hand-on was reported: ${JSON.stringify(find(findings, 'gate-hand-on'))}`);
  writeText(path.join(repo, '.custom-hooks', 'pre-commit'), '#!/bin/sh\n# research-kit commit gate - POSIX sh wrapper around bin/gate.mjs.\n');
  const warned = find(gateHealth(nested, { env, gitPaths: { ...gitPaths, cwd: nested }, record: false }), 'gate-hand-on');
  assert.ok(warned, 'a second kit at a relative path was not reported');
  assert.match(warned.detail, /another copy of this kit/);
});

// --- whose pre-commit is it? ------------------------------------------------------

test('a pre-commit in SOMEBODY ELSE\'S tree is foreign, not current', async () => {
  // The edit gate has checked this since a registration on this machine named our hook in
  // a different checkout of a different implementation. The commit gate was left asking
  // only whether SOME executable pre-commit existed at core.hooksPath - and that setting is
  // a single machine-wide value that husky, lefthook and pre-commit all rewrite, so the
  // substitution is if anything likelier here than there.
  const { commitGateState } = await import('../lib/doctor.mjs');
  const kitHome = tempDir('research-kit-home-');
  const foreign = tempDir('research-kit-husky-');
  writeText(path.join(kitHome, 'githooks', 'pre-commit'), '#!/bin/sh\n# ours\n');
  writeText(path.join(foreign, 'pre-commit'), '#!/bin/sh\n# husky\n');
  // Executable, or on Linux `current` is never reachable. Windows returns ok for any file
  // that exists, which is exactly why the first version of this test passed locally and
  // failed in CI - the platform decided whether the assertion meant anything.
  fs.chmodSync(path.join(kitHome, 'githooks', 'pre-commit'), 0o755);
  fs.chmodSync(path.join(foreign, 'pre-commit'), 0o755);

  const ours = commitGateState({ hooksPath: path.join(kitHome, 'githooks'), kitHome });
  assert.equal(ours.state, 'current');

  const theirs = commitGateState({ hooksPath: foreign, kitHome });
  assert.equal(theirs.state, 'foreign', 'an executable hook from another tree must not read as the kit\'s gate');
  assert.equal(theirs.expected, path.join(kitHome, 'githooks'), 'and it must say which path it expected');
});

test('OUR hooksPath with no pre-commit in it is unusable, not foreign', async () => {
  // The two failures want different fixes, so they must not collapse into one word.
  const { commitGateState } = await import('../lib/doctor.mjs');
  const kitHome = tempDir('research-kit-home2-');
  const state = commitGateState({ hooksPath: path.join(kitHome, 'githooks'), kitHome });
  assert.equal(state.state, 'unusable');
  assert.equal(state.mode.reason, 'missing');
});

test('ownership is decided before executability, so the fix is never chmod on a stranger\'s hook', async () => {
  // The ordering the first version got wrong: mode first meant a foreign hook that happened
  // to be non-executable reported `unusable`, carrying `chmod +x` as the remedy - repairing
  // somebody else's gate, and leaving this one exactly as absent. Whose it is survives;
  // whether it runs matters only once it is ours.
  const { commitGateState } = await import('../lib/doctor.mjs');
  const kitHome = tempDir('research-kit-home3-');
  const foreign = tempDir('research-kit-husky3-');
  writeText(path.join(foreign, 'pre-commit'), '#!/bin/sh\n# husky, and not executable\n');
  try { fs.chmodSync(path.join(foreign, 'pre-commit'), 0o644); } catch { /* windows */ }

  assert.equal(commitGateState({ hooksPath: foreign, kitHome }).state, 'foreign');
});

// --- deploy mirrors, it does not merge --------------------------------------------

/** The files every kit version has shipped, so a fixture reads as an earlier deployment. */
function asEarlierKit(dir) {
  for (const rel of ['bin/gate.mjs', 'bin/preflight.mjs']) writeText(path.join(dir, ...rel.split('/')), '// an earlier kit\n');
}

test('deploy MIRRORS: a file the source no longer ships is removed from the deployed tree', async () => {
  const { deploy } = await import('../lib/installer.mjs');
  const source = tempDir('research-kit-src-');
  const target = tempDir('research-kit-dst-');

  writeText(path.join(source, 'lib', 'core.mjs'), 'export const a = 1;\n');
  writeText(path.join(source, 'recipes', 'kept.md'), '# kept\n');

  // The deployed tree still holds a previous version's files.
  writeText(path.join(target, 'lib', 'core.mjs'), 'export const a = 0;\n');
  writeText(path.join(target, 'lib', 'release-validator.mjs'), 'export const old = true;\n');
  writeText(path.join(target, 'recipes', 'retired-recipe.md'), '# from a kit that was replaced\n');
  writeText(path.join(target, 'schemas', 'old.schema.json'), '{}\n');
  asEarlierKit(target);

  const { env } = { env: { ...process.env, RESEARCH_KIT_INSTALL_STATE: path.join(target, 'install.json') } };
  const result = deploy({ from: source, kitHome: target, env });

  assert.equal(fs.existsSync(path.join(target, 'lib', 'release-validator.mjs')), false,
    'a module from the previous implementation must not survive an update');
  assert.equal(fs.existsSync(path.join(target, 'recipes', 'retired-recipe.md')), false,
    'decompose --recipes listed ten recipes, half from a kit that no longer existed');
  assert.equal(fs.existsSync(path.join(target, 'schemas')), false, 'and an emptied directory goes too');
  assert.equal(readText(path.join(target, 'lib', 'core.mjs')), 'export const a = 1;\n', 'what IS shipped is updated');
  assert.ok(fs.existsSync(path.join(target, 'recipes', 'kept.md')));

  assert.ok(result.pruned.includes('lib/release-validator.mjs'), 'and the pruning is reported, not silent');
  assert.ok(result.pruned.includes('recipes/retired-recipe.md'));
});

// Found 2026-09-29 (Arena break test): `install --dry-run` on a machine with no prior install
// said "would prune" three retired files that were not there, and never named a stale file a
// real deploy's mirror would remove. A preview names what the deploy would actually do.
test('deploy --dry-run names exactly what a real deploy would prune, and nothing else', async () => {
  const { deploy } = await import('../lib/installer.mjs');
  const { RETIRED_KIT_FILES } = await import('../lib/machine.mjs');
  const source = tempDir('research-kit-src-');
  writeText(path.join(source, 'lib', 'core.mjs'), 'export const a = 1;\n');
  const env = { ...process.env, RESEARCH_KIT_INSTALL_STATE: path.join(tempDir(), 'install.json') };

  const fresh = path.join(tempDir('research-kit-dst-'), 'never-installed');
  assert.deepEqual(deploy({ from: source, kitHome: fresh, env, dryRun: true }).prune, [],
    'nothing is deployed there, so nothing would be pruned');

  const stale = tempDir('research-kit-dst-');
  writeText(path.join(stale, 'lib', 'core.mjs'), 'export const a = 0;\n');
  writeText(path.join(stale, 'lib', 'gone.mjs'), 'old\n');
  writeText(path.join(stale, ...RETIRED_KIT_FILES[0].split('/')), 'retired\n');
  asEarlierKit(stale);
  const preview = deploy({ from: source, kitHome: stale, env, dryRun: true }).prune.sort();
  assert.ok(fs.existsSync(path.join(stale, 'lib', 'gone.mjs')), 'a dry run removes nothing');
  const real = deploy({ from: source, kitHome: stale, env }).pruned.sort();
  assert.deepEqual(preview, real, 'the preview and the deploy disagree about what is pruned');
});

// Found 2026-10-01 (break-test, PR #182): the mirror removes whatever the kit does not ship, and
// it asked nothing of the folder first. RESEARCH_KIT_HOME pointed at a folder of somebody's own
// files - a typo, a parent folder, a shared tools directory - had them deleted (3 of 4 in the
// report). A folder that is not a kit deployment is refused, and nothing in it is touched.
test('deploy refuses to mirror into a folder of other files, and touches nothing there', async () => {
  const { deploy } = await import('../lib/installer.mjs');
  const source = tempDir('research-kit-src-');
  writeText(path.join(source, 'lib', 'core.mjs'), 'export const a = 1;\n');
  writeText(path.join(source, 'README.md'), '# kit\n');
  const env = { ...process.env, RESEARCH_KIT_INSTALL_STATE: path.join(tempDir('research-kit-state-'), 'install.json') };

  const theirs = tempDir('research-kit-theirs-');
  const files = ['notes.txt', 'README.md', 'photos/cat.jpg', 'lib/util.js'];
  for (const rel of files) writeText(path.join(theirs, ...rel.split('/')), `${rel}\n`);

  for (const dryRun of [true, false]) {
    const result = deploy({ from: source, kitHome: theirs, env, dryRun });
    assert.equal(result.ok, false, `dryRun=${dryRun}: a folder of other files was mirrored into`);
    assert.match(result.refused, /not a kit deployment/);
    assert.match(result.refused, new RegExp(theirs.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')), 'the refusal names the folder');
  }
  for (const rel of files) assert.equal(readText(path.join(theirs, ...rel.split('/'))), `${rel}\n`, `${rel} was changed or deleted`);
  assert.equal(fs.existsSync(path.join(theirs, 'lib', 'core.mjs')), false, 'the kit was written into it anyway');

  // A project of somebody's own that happens to have a lib/core.mjs is not a kit: one common file
  // name took a project for a deployment, and its src/app.js was pruned (found 2026-10-01).
  const project = tempDir('research-kit-project-');
  writeText(path.join(project, 'lib', 'core.mjs'), 'export const theirs = 1;\n');
  writeText(path.join(project, 'src', 'app.js'), 'app\n');
  assert.equal(deploy({ from: source, kitHome: project, env, dryRun: true }).ok, false, 'a project with a lib/core.mjs was taken for a kit');
  assert.equal(deploy({ from: source, kitHome: project, env }).ok, false);
  assert.equal(readText(path.join(project, 'src', 'app.js')), 'app\n');
  assert.equal(readText(path.join(project, 'lib', 'core.mjs')), 'export const theirs = 1;\n');

  // An empty folder, an absent one and an earlier deployment are all still deployed into.
  for (const target of [tempDir('research-kit-empty-'), path.join(tempDir('research-kit-new-'), 'kit')]) {
    assert.equal(deploy({ from: source, kitHome: target, env }).ok, true, `${target} was refused`);
  }
  const earlier = tempDir('research-kit-old-');
  writeText(path.join(earlier, 'lib', 'core.mjs'), 'export const a = 0;\n');
  writeText(path.join(earlier, 'lib', 'gone.mjs'), 'old\n');
  asEarlierKit(earlier);
  assert.equal(deploy({ from: source, kitHome: earlier, env }).ok, true, 'an earlier deployment was refused');
  assert.equal(fs.existsSync(path.join(earlier, 'lib', 'gone.mjs')), false, 'and is still mirrored');
});

// Found 2026-10-01: the refusal listed every file under the folder to count them - 1.6 s for /usr
// (77,000 files) here, and a home directory holds millions. It needs only a few to name.
test('refusing a folder reads only as much of it as the refusal names', async () => {
  const { deploy } = await import('../lib/installer.mjs');
  const source = tempDir('research-kit-src-');
  writeText(path.join(source, 'lib', 'core.mjs'), 'export const a = 1;\n');
  const env = { ...process.env, RESEARCH_KIT_INSTALL_STATE: path.join(tempDir('research-kit-state-'), 'install.json') };
  const theirs = tempDir('research-kit-theirs-');
  for (let i = 0; i < 40; i += 1) writeText(path.join(theirs, `folder-${i}`, 'file.txt'), `${i}\n`);

  const real = fs.readdirSync;
  let reads = 0;
  fs.readdirSync = (...args) => { reads += 1; return real(...args); };
  let result;
  try { result = deploy({ from: source, kitHome: theirs, env, dryRun: true }); } finally { fs.readdirSync = real; }
  assert.equal(result.ok, false);
  assert.ok(reads <= 5, `a refusal read ${reads} folders of the 41 there, to name a few files`);
});

test('install names a refused folder and exits 2', () => {
  const theirs = tempDir('research-kit-theirs-');
  writeText(path.join(theirs, 'notes.txt'), 'mine\n');
  // Every machine path the installer could reach is a temp one, the skill roots included, so a
  // deploy that is NOT refused writes nowhere real.
  const state = tempDir('research-kit-state-');
  const skills = path.join(state, 'skills');
  writeText(path.join(state, 'config.json'), `${JSON.stringify({ skillRoots: [skills] })}\n`);
  const r = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'install.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, RESEARCH_KIT_HOME: theirs, RESEARCH_KIT_CONFIG: path.join(state, 'config.json'), RESEARCH_KIT_INSTALL_STATE: path.join(state, 'install.json') },
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /not a kit deployment/);
  assert.equal(readText(path.join(theirs, 'notes.txt')), 'mine\n');
  assert.equal(fs.existsSync(skills), false, 'a refused deploy still installed the skill');
});

test('deploy does NOT mirror a skill root - it holds other people\'s skills too', async () => {
  const { deploy } = await import('../lib/installer.mjs');
  const source = tempDir('research-kit-src2-');
  writeText(path.join(source, 'skill', 'SKILL.md'), '# research-first\n');
  const skillRoot = tempDir('research-kit-skills-');
  writeText(path.join(skillRoot, 'someone-elses-skill', 'SKILL.md'), '# not ours\n');

  const env = {
    ...process.env,
    RESEARCH_KIT_CONFIG: (() => {
      const f = path.join(tempDir('research-kit-cfg-'), 'c.json');
      writeText(f, JSON.stringify({ skillRoots: [skillRoot] }));
      return f;
    })(),
    RESEARCH_KIT_INSTALL_STATE: path.join(tempDir('research-kit-state-'), 'install.json'),
  };
  deploy({ from: source, kitHome: tempDir('research-kit-dst2-'), env });

  assert.ok(fs.existsSync(path.join(skillRoot, 'someone-elses-skill', 'SKILL.md')),
    'mirroring a shared skill root would delete skills the kit never owned');
});

// --- recorded is not current -------------------------------------------------------

/** A source tree and a deployment of it, with the drift the caller asks for. */
async function deployed({ stale = false, missing = false, orphan = false, skillStale = false } = {}) {
  const { deploy, deployedDrift } = await import('../lib/installer.mjs');
  const source = tempDir('research-kit-drift-src-');
  const target = tempDir('research-kit-drift-dst-');
  const skillRoot = tempDir('research-kit-drift-skills-');
  writeText(path.join(source, 'lib', 'core.mjs'), 'export const a = 1;\n');
  writeText(path.join(source, 'bin', 'prior.mjs'), '// the step shipped this morning\n');
  writeText(path.join(source, 'skill', 'SKILL.md'), '# research-first\n\n3. Register your prior.\n');

  const cfg = path.join(tempDir('research-kit-drift-cfg-'), 'c.json');
  writeText(cfg, JSON.stringify({ skillRoots: [skillRoot] }));
  const env = {
    ...process.env,
    RESEARCH_KIT_CONFIG: cfg,
    // Beside the deployment, never inside it - INSTALL_STATE_PATH is a SIBLING of
    // kitHome, and a fixture that put it within would report it as an orphan forever.
    RESEARCH_KIT_INSTALL_STATE: path.join(tempDir('research-kit-drift-state-'), 'install.json'),
  };
  deploy({ from: source, kitHome: target, env });

  // Now the source moves on, or the deployment is damaged, which is the same thing.
  if (stale) writeText(path.join(source, 'lib', 'core.mjs'), 'export const a = 2;\n');
  if (missing) writeText(path.join(source, 'lib', 'brand-new.mjs'), 'export const b = 1;\n');
  if (orphan) writeText(path.join(target, 'lib', 'left-behind.mjs'), 'export const old = 1;\n');
  if (skillStale) writeText(path.join(source, 'skill', 'SKILL.md'), '# research-first\n\n3. Register your prior.\n4. Collect.\n');

  return { source, target, env, drift: () => deployedDrift({ from: source, kitHome: target, env }) };
}

test('a deployment that matches its source reports no drift', async () => {
  const { drift } = await deployed();
  assert.equal(drift().drifted, 0);
});

test('doctor sees a deployment that is merely RECORDED, not current', async () => {
  // The defect this replaces, measured on the real machine on 2026-09-22: the check read
  // the install STATE and stopped - "kit deployed <date>", pass, READY - while the deployed
  // kit was missing 119 files and carrying 38 stale ones, including a skill that described
  // a protocol without the step shipped that morning.
  //
  // An agent invoking the skill runs the DEPLOYED copy. So a health check that confirms an
  // install happened, and never that it matches, reports a machine as ready while every fix
  // since that install exists only in the repository.
  const { drift } = await deployed({ stale: true, missing: true });
  const d = drift();
  assert.ok(d.kit.changed.includes('lib/core.mjs'), 'a file whose bytes moved on is stale');
  assert.ok(d.kit.missing.includes('lib/brand-new.mjs'), 'a file added since the install is missing');
  assert.equal(d.drifted, 2);
});

test('a file the deployment kept and the source no longer ships is reported as orphaned', async () => {
  const { drift } = await deployed({ orphan: true });
  const d = drift();
  assert.deepEqual(d.kit.extra, ['lib/left-behind.mjs']);
  assert.ok(d.drifted > 0);
});

test('a stale SKILL is reported on its own, because that is what an agent reads', async () => {
  // The skill drifts independently of the kit: it is copied to a different root, and it is
  // the file that tells an agent what the protocol IS. A current kit under a stale skill is
  // a machine that has the fix and will not use it.
  const { drift } = await deployed({ skillStale: true });
  const d = drift();
  // The kit deployment CONTAINS skill/, so a moved SKILL.md legitimately shows in both.
  // What matters is that the skill root is reported on its own, by location.
  assert.deepEqual(d.kit.changed, ['skill/SKILL.md']);
  assert.equal(d.skills.length, 1);
  assert.deepEqual(d.skills[0].changed, ['SKILL.md']);
  assert.ok(d.drifted > 0, 'a stale skill alone is still drift');
});

test('the drift note names what moved and what to run', async () => {
  const { driftNote } = await import('../lib/installer.mjs');
  const { drift } = await deployed({ stale: true, missing: true });
  const note = driftNote(drift());
  assert.match(note, /1 missing/);
  assert.match(note, /1 stale/);
  assert.match(note, /lib\/(brand-new|core)\.mjs/, 'a count without an example is not actionable');
  assert.equal(driftNote({ drifted: 0 }), '', 'silence when it matches');
});

test('the drift check reports and never repairs', async () => {
  // A health check that quietly rewrote what it was measuring would erase the evidence of
  // the problem it just found, and `doctor` is documented read-only apart from one override
  // log. Pinned structurally rather than by phrasing.
  const { drift, target } = await deployed({ stale: true, missing: true });
  drift();
  assert.equal(fs.existsSync(path.join(target, 'lib', 'brand-new.mjs')), false,
    'deployedDrift installed the missing file instead of reporting it');
  assert.equal(readText(path.join(target, 'lib', 'core.mjs')), 'export const a = 1;\n',
    'deployedDrift overwrote the stale file instead of reporting it');
});

// --- a registration must point at the DEPLOYED kit, not merely name the hook ------

test('a registration naming our hook in SOMEBODY ELSE\'S tree is foreign, not current', () => {
  const foreignKit = tempDir('research-kit-foreign-');
  writeText(path.join(foreignKit, 'hooks', 'edit-gate.mjs'), '// another checkout entirely\n');
  const { env } = machine({
    settings: { hooks: { PreToolUse: [{ matcher: MATCHER, hooks: [{ type: 'command', command: `node "${path.join(foreignKit, 'hooks', 'edit-gate.mjs')}"` }] }] } },
  });

  assert.equal(settingsState({ env, kitHome: tempDir('research-kit-deployed-') }), 'foreign',
    'this machine had exactly this: the gate that ran belonged to a different implementation');
});

test('a registration pointing at a hook that is not on disk is dangling', () => {
  const { env } = machine({
    settings: { hooks: { PreToolUse: [{ matcher: MATCHER, hooks: [{ type: 'command', command: 'node "/gone/research-kit/hooks/edit-gate.mjs"' }] }] } },
  });
  assert.equal(settingsState({ env, kitHome: tempDir('research-kit-deployed2-') }), 'dangling',
    'ADR-0012: no registration may point at a hook file that no longer exists');
});

test('a registration pointing at the deployed kit is current', () => {
  const kitHome = tempDir('research-kit-deployed3-');
  writeText(path.join(kitHome, 'hooks', 'edit-gate.mjs'), '// the deployed kit\n');
  const { env } = machine({
    settings: { hooks: { PreToolUse: [{ matcher: MATCHER, hooks: [{ type: 'command', command: `node "${path.join(kitHome, 'hooks', 'edit-gate.mjs')}"` }] }] } },
  });
  assert.equal(settingsState({ env, kitHome }), 'current');
});

test('doctor reports foreign and dangling as BLOCKERS, with the repair', async () => {
  const { runDoctor } = await import('../lib/doctor.mjs');
  const foreignKit = tempDir('research-kit-foreign2-');
  writeText(path.join(foreignKit, 'hooks', 'edit-gate.mjs'), '// elsewhere\n');
  const { env } = machine({
    settings: { hooks: { PreToolUse: [{ matcher: MATCHER, hooks: [{ type: 'command', command: `node "${path.join(foreignKit, 'hooks', 'edit-gate.mjs')}"` }] }] } },
  });

  const report = runDoctor(makePassingProject(), { env, probe: READY, record: false });
  const finding = find(report.findings, 'gate-edit');
  assert.equal(finding.severity, 'fail', 'green here means the operator believes a gate is installed that is not this one');
  assert.match(finding.detail, /OUTSIDE the deployed kit/);
  assert.match(finding.fix, /--edit-only/);
});

test('registeredPath reads the path out of a command, quoted or bare', async () => {
  const { registeredPath } = await import('../lib/installer.mjs');
  assert.equal(registeredPath('node "C:/a b/research-kit/hooks/edit-gate.mjs"'), 'C:/a b/research-kit/hooks/edit-gate.mjs');
  assert.equal(registeredPath('node /opt/kit/hooks/edit-gate.mjs'), '/opt/kit/hooks/edit-gate.mjs');
  assert.equal(registeredPath('node /opt/kit/hooks/other.mjs'), '');
});

// ---------------------------------------------------------------- the Node this machine runs
//
// docs/decisions/2026-09-27-node-support. The kit's requests on Node's fetch - keyless pages,
// SerpAPI searches, remote collection - use a configured proxy only on a Node with
// NODE_USE_ENV_PROXY: 22.21+ on the 22 line, 24.0+ after, never 23 (E-02, E-04). Measured: on
// 22.20.0 the fetch went around the proxy and got HTTP 403. Nothing told the operator; the
// error named no proxy.

const nodeFindings = (nodeVersion, extraEnv = {}) => {
  const { env } = machine({ config: { role: 'collector' } });
  const scrubbed = { ...env };
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete scrubbed[key];
  return machineHealth({ env: { ...scrubbed, ...extraEnv }, probe: READY, nodeVersion });
};

test('behind a proxy, a Node that cannot use it is named, with the version to move to', () => {
  const old = find(nodeFindings('22.20.0', { HTTPS_PROXY: 'http://proxy.example:8080' }), 'proxy');
  assert.ok(old, 'a proxy is configured and doctor says nothing about whether Node can use it');
  assert.equal(old.severity, 'warn', 'the Firecrawl CLI has its own proxy handling; this is the fallback');
  assert.match(old.detail, /22\.20\.0/);
  assert.match(`${old.detail} ${old.fix}`, /22\.21/, 'the operator is not told which version fixes it');
  assert.match(old.detail, /search requests/, 'the finding must name every path the proxy carries, not only the keyless one');
  assert.match(old.detail, /remote collection/);
  assert.equal(find(nodeFindings('23.11.1', { https_proxy: 'http://p:1' }), 'proxy').severity, 'warn', '23 never had the flag');
  for (const ok of ['22.21.0', '22.23.3', '24.0.0', '26.10.0']) {
    assert.equal(find(nodeFindings(ok, { https_proxy: 'http://p:1' }), 'proxy').severity, 'pass', `${ok} honours the proxy`);
  }
  assert.equal(find(nodeFindings('22.20.0'), 'proxy'), undefined, 'no proxy, nothing to say');
  // A value Node cannot parse crashes every fetch once the flag is on, so the kit leaves it off
  // and doctor says so - on every Node, since no version can use it (ADR-0047).
  const bad = find(nodeFindings('24.21.0', { HTTPS_PROXY: 'proxy.example:8080' }), 'proxy');
  assert.equal(bad.severity, 'warn', 'a proxy value Node cannot use was reported as working');
  assert.match(bad.detail, /cannot use/);
  assert.match(bad.fix, /http:\/\/proxy\.example:8080/);
  assert.equal(find(nodeFindings('24.21.0', { https_proxy: 'http://ok:1', HTTPS_PROXY: 'proxy.example:8080' }), 'proxy').severity, 'pass',
    'the lowercase variable wins when both are set (E-03), so the malformed one is never read');
  const secret = find(nodeFindings('24.21.0', { HTTPS_PROXY: 'user:hunter2@proxy.example:8080' }), 'proxy');
  assert.equal(`${secret.detail} ${secret.fix}`.includes('hunter2'), false, 'doctor printed a proxy password');
});

test('doctor reports the Node line: supported, odd and short-lived, or below the floor', () => {
  assert.equal(find(nodeFindings('24.21.0'), 'node').severity, 'pass');
  const odd = find(nodeFindings('25.9.0'), 'node');
  assert.equal(odd.severity, 'warn', 'an odd line below 27 is never LTS and ends after six months');
  assert.match(`${odd.detail} ${odd.fix}`, /24|26/);
  assert.equal(find(nodeFindings('27.0.0'), 'node').severity, 'pass', 'from 27 every line goes LTS');
  assert.equal(find(nodeFindings('21.7.3'), 'node').severity, 'fail', 'below the floor the kit does not run');
});

// Found 2026-09-27: a machine had core.hooksPath=/opt/myhooks. install-hooks refused the
// commit gate (kit not deployed) and left it alone; --uninstall then "restored" it to unset,
// deleting a setting the kit had never changed.
test('uninstall restores core.hooksPath only while it is still the kit\'s own', () => {
  const { dir, env } = machine();
  const gitConfig = path.join(dir, 'gitconfig');
  const gitPaths = { env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' } };
  const get = () => spawnSync('git', ['config', '--global', '--get', 'core.hooksPath'], { env: gitPaths.env, encoding: 'utf8' }).stdout.trim();
  const set = (value) => spawnSync('git', ['config', '--global', 'core.hooksPath', value], { env: gitPaths.env });
  requireCapability(spawnSync('git', ['--version']).status === 0, 'no-git', 'git is not installed');

  set('/opt/myhooks');
  removeCommitGate({ env, gitPaths });
  assert.equal(get(), '/opt/myhooks', 'uninstall removed a hooks path the kit never set');

  assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths }).ok, true);
  set('/opt/changed-since');
  removeCommitGate({ env, gitPaths });
  assert.equal(get(), '/opt/changed-since', 'uninstall overwrote a hooks path the operator changed after install');

  const again = machine();
  const cfg2 = path.join(again.dir, 'gitconfig');
  const paths2 = { env: { ...process.env, GIT_CONFIG_GLOBAL: cfg2, GIT_CONFIG_NOSYSTEM: '1' } };
  spawnSync('git', ['config', '--global', 'core.hooksPath', '/opt/myhooks'], { env: paths2.env });
  installCommitGate({ kitHome: KIT_ROOT, env: again.env, gitPaths: paths2 });
  removeCommitGate({ env: again.env, gitPaths: paths2 });
  assert.equal(spawnSync('git', ['config', '--global', '--get', 'core.hooksPath'], { env: paths2.env, encoding: 'utf8' }).stdout.trim(),
    '/opt/myhooks', 'a normal install and uninstall no longer restores the previous path');
});

// Found 2026-10-01: the install replaced a global hooks folder and kept its name only in a JSON
// state file the sh hooks cannot read. It is recorded in git's own config now, where they can.
test('install-hooks records the hooks folder it replaced where the hooks can read it, and uninstall clears it', () => {
  requireCapability(spawnSync('git', ['--version']).status === 0, 'no-git', 'git is not installed');
  const { dir, env } = machine();
  const gitPaths = { env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } };
  const get = (key) => spawnSync('git', ['config', '--global', '--get', key], { env: gitPaths.env, encoding: 'utf8' }).stdout.trim();
  spawnSync('git', ['config', '--global', 'core.hooksPath', '/opt/myhooks'], { env: gitPaths.env });

  assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths }).ok, true);
  assert.equal(get('research-kit.previousHooksPath'), '/opt/myhooks', 'the replaced folder was not recorded where the hooks look');
  // Installing again must not record the kit's own folder as the one it replaced: the hooks would hand on to themselves.
  assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths }).ok, true);
  assert.equal(get('research-kit.previousHooksPath'), '/opt/myhooks');
  removeCommitGate({ env, gitPaths });
  assert.equal(get('research-kit.previousHooksPath'), '', 'uninstall left the record behind');
  assert.equal(get('core.hooksPath'), '/opt/myhooks');

  const fresh = machine();
  const freshPaths = { env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(fresh.dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } };
  assert.equal(installCommitGate({ kitHome: KIT_ROOT, env: fresh.env, gitPaths: freshPaths }).ok, true);
  assert.equal(spawnSync('git', ['config', '--global', '--get', 'research-kit.previousHooksPath'], { env: freshPaths.env, encoding: 'utf8' }).stdout.trim(), '',
    'a machine with no hooks folder before the kit got a record of one');
});

// Found 2026-10-04 on the operator's machine: doctor's remedy for a hand-on to another copy of
// the kit's gate (ADR-0134) is `git config --global --unset research-kit.previousHooksPath`, and
// it lasted one session. The installer kept the folder in the install state as well, and the
// next `install-hooks` run - every kit update runs one - wrote it back into git config, so the
// previous implementation's githooks/ decided on every commit again, on its outdated checks.
// The installer judges what it records with doctor's own classifier now (ADR-0141): a folder
// holding this kit's gate is never a hand-on, on a first install or a re-install, and the state
// file agrees with git config once the install has run.
test('install-hooks does not record, or resurrect, a hand-on to another copy of the kit\'s gate', async () => {
  requireGit('the recorded previous hooks folder');
  const { writeInstallState } = await import('../lib/machine.mjs');
  const kitHeader = '#!/bin/sh\n# research-kit commit gate - POSIX sh wrapper around bin/gate.mjs.\nexit 0\n';
  const paths = (dir) => ({ env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } });
  const get = (gitPaths, key) => spawnSync('git', ['config', '--global', '--get', key], { env: gitPaths.env, encoding: 'utf8' }).stdout.trim();
  const set = (gitPaths, key, value) => spawnSync('git', ['config', '--global', key, value], { env: gitPaths.env });

  // The operator's machine: an older installer recorded the old kit's folder in both places,
  // and the operator applied doctor's remedy to git config.
  {
    const { dir, env } = machine();
    const gitPaths = paths(dir);
    const old = path.join(dir, 'old-kit-githooks');
    writeText(path.join(old, 'pre-commit'), kitHeader);
    set(gitPaths, 'core.hooksPath', path.join(KIT_ROOT, 'githooks'));
    set(gitPaths, 'research-kit.previousHooksPath', old);
    writeInstallState({ kitHome: KIT_ROOT, hooksPath: path.join(KIT_ROOT, 'githooks'), previousHooksPath: old }, env);
    spawnSync('git', ['config', '--global', '--unset', 'research-kit.previousHooksPath'], { env: gitPaths.env });

    assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: dir }).ok, true);
    assert.equal(get(gitPaths, 'research-kit.previousHooksPath'), '', 'the next install wrote the old kit\'s folder back into git config');
    assert.equal(readJson(env.RESEARCH_KIT_INSTALL_STATE).previousHooksPath, null, 'the install state still names the old kit\'s folder, to resurrect it next time');
  }

  // A first install over the old kit's gate: not recorded in the first place.
  {
    const { dir, env } = machine();
    const gitPaths = paths(dir);
    const old = path.join(dir, 'old-kit-githooks');
    writeText(path.join(old, 'pre-commit'), kitHeader);
    set(gitPaths, 'core.hooksPath', old);
    const result = installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: dir });
    assert.equal(result.ok, true);
    assert.equal(result.previous, old, 'the result still says what core.hooksPath was');
    assert.equal(get(gitPaths, 'research-kit.previousHooksPath'), '', 'a first install recorded the old kit\'s gate as the hand-on');
    assert.equal(readJson(env.RESEARCH_KIT_INSTALL_STATE).previousHooksPath, null);
  }

  // Somebody else's hooks are still the designed case (ADR-0112): recorded, kept across a
  // re-install, and written into git config from a state file that predates the key.
  {
    const { dir, env } = machine();
    const gitPaths = paths(dir);
    const husky = path.join(dir, 'husky-hooks');
    writeText(path.join(husky, 'pre-commit'), '#!/bin/sh\n# husky\n');
    set(gitPaths, 'core.hooksPath', husky);
    assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: dir }).ok, true);
    assert.equal(get(gitPaths, 'research-kit.previousHooksPath'), husky);
    assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: dir }).ok, true);
    assert.equal(get(gitPaths, 'research-kit.previousHooksPath'), husky, 'a re-install dropped a hand-on to somebody else\'s hooks');
    spawnSync('git', ['config', '--global', '--unset', 'research-kit.previousHooksPath'], { env: gitPaths.env });
    assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: dir }).ok, true);
    assert.equal(get(gitPaths, 'research-kit.previousHooksPath'), husky, 'the record of a replaced husky folder no longer reaches git config');
  }
});

// Found 2026-10-02 (outside review, three rounds): a repository-local `core.hooksPath` - what
// husky, lefthook, simple-git-hooks and pre-commit set - displaces the machine-wide gate in
// that repository, silently, and the installer never looked: it read and wrote the global
// path and said "installed" while standing in a repository where the gate would not run.
// Detection lived only at check time, in doctor and preflight. The install reports it now,
// at the moment the operator is reading, and still installs: the gate is machine state and
// every other repository gets it (ADR-0131).
test('install-hooks reports a repository-local core.hooksPath that displaces the gate where it is run', () => {
  requireGit('a repository-local core.hooksPath');
  const { env } = machine();
  const dir = tempDir('research-kit-displaced-');
  const gitPaths = { env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' } };
  const repo = path.join(dir, 'husky-project');
  fs.mkdirSync(repo);
  assert.equal(spawnSync('git', fixtureInitArgs(), { cwd: repo, env: gitPaths.env }).status, 0);
  spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky'], { cwd: repo, env: gitPaths.env });

  const preview = installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: repo, dryRun: true });
  assert.equal(preview.ok, true);
  assert.equal(preview.displaced?.local, '.husky', `the dry run did not report the displacement: ${JSON.stringify(preview)}`);

  const result = installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: repo });
  assert.equal(result.ok, true, 'the install must still go through: the gate is machine state');
  assert.equal(result.displaced?.local, '.husky', `the install did not report the displacement: ${JSON.stringify(result)}`);
  assert.equal(path.resolve(result.displaced.cwd), path.resolve(repo));
  const global = spawnSync('git', ['config', '--global', '--get', 'core.hooksPath'], { env: gitPaths.env, encoding: 'utf8' }).stdout.trim();
  assert.match(global, /githooks$/, 'the machine-wide path was not set');

  // From a SUBDIRECTORY of that repository the same local path displaces the gate - git finds
  // the repository by walking up - and the probe looked only for `.git` beside it, so it said
  // `null` there (outside audit, 2026-10-03). A nested decision project (docs/decisions/*) is
  // exactly such a subdirectory, so doctor's local-override warning was missing there too.
  const nested = path.join(repo, 'docs', 'decisions', 'one');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: nested }).displaced?.local, '.husky',
    'a subdirectory of the repository did not report the displacement');
  const warned = gateHealth(nested, { env, gitPaths: { ...gitPaths, cwd: nested }, record: false });
  assert.ok(warned.some((f) => f.name === 'gate-local-override' && /\.husky/.test(f.detail)),
    `doctor in a subdirectory did not warn: ${JSON.stringify(warned.map((f) => [f.name, f.detail]))}`);

  const clean = path.join(dir, 'plain-project');
  fs.mkdirSync(clean);
  assert.equal(spawnSync('git', fixtureInitArgs(), { cwd: clean, env: gitPaths.env }).status, 0);
  assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: clean }).displaced, null, 'a repository without a local path was reported as displaced');
  assert.equal(installCommitGate({ kitHome: KIT_ROOT, env, gitPaths, cwd: dir }).displaced, null, 'a folder that is not a repository was reported as displaced');

  // The CLI says it, on stderr, with the remedy, and still exits 0: the install succeeded.
  const home = path.join(tempDir('rk-home-'), 'home');
  fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
  fs.symlinkSync(KIT_ROOT, path.join(home, '.agents', 'research-kit'), 'junction');
  const cli = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'install-hooks.mjs'), '--git-only', '--dry-run'], {
    cwd: repo, encoding: 'utf8', timeout: 60_000,
    env: { ...gitPaths.env, HOME: home, USERPROFILE: home, RESEARCH_KIT_CONFIG: env.RESEARCH_KIT_CONFIG, RESEARCH_KIT_INSTALL_STATE: env.RESEARCH_KIT_INSTALL_STATE },
  });
  assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
  assert.match(cli.stdout, /would set core\.hooksPath=/);
  assert.match(cli.stderr, /this repository sets core\.hooksPath=\.husky/, `the CLI did not say it: ${cli.stderr}`);
  assert.match(cli.stderr, /displaces/);
  assert.match(cli.stderr, /git config --local --unset core\.hooksPath/, 'the remedy was not named');
});

// Found 2026-09-27: with the kit not deployed, install-hooks refused the commit gate but
// registered the edit gate anyway, as `node <kit>/hooks/edit-gate.mjs` - a file that did not
// exist - so every Edit would have run a hook that crashed with MODULE_NOT_FOUND.
test('the edit gate is not registered when its hook is not deployed', () => {
  const { env, settingsFile } = machine({ settings: { model: 'x' } });
  const result = installEditGate({ kitHome: tempDir('research-kit-undeployed-'), env });
  assert.equal(result.ok, false, 'a hook that does not exist was registered');
  assert.match(result.reason, /install\.mjs/);
  assert.deepEqual(readJson(settingsFile), { model: 'x' }, 'the settings file was changed');
});

// ADR-0095. Found 2026-09-29 (break-test PR #140, risk 6): a collector that works keyless was
// reported "3 blockers" because the Firecrawl CLI is absent. Absent by the operator's CHOICE
// is configuration, not breakage; absent with nothing chosen is still the silent degradation
// this check exists to catch.
test('a collector that CHOSE a keyless or browser transport is not broken for lacking the CLI', () => {
  for (const transport of ['http-keyless', 'browser']) {
    const { env } = machine({ config: { role: 'collector', transport } });
    const cli = find(machineHealth({ env, probe: ABSENT }), 'firecrawl-cli');
    assert.equal(cli.severity, 'pass', `${transport}: ${cli.detail}`);
    assert.match(cli.detail, new RegExp(`${transport} was chosen`));
    assert.equal(cli.fix, undefined, 'a pass prints no fix');
  }
  const byEnv = machine({ config: { role: 'collector' } });
  const cli = find(machineHealth({ env: { ...byEnv.env, RESEARCH_KIT_TRANSPORT: 'http-keyless' }, probe: ABSENT }), 'firecrawl-cli');
  assert.equal(cli.severity, 'pass', 'RESEARCH_KIT_TRANSPORT is a choice too');

  const { env } = machine({ config: { role: 'collector' } });
  assert.equal(find(machineHealth({ env, probe: ABSENT }), 'firecrawl-cli').severity, 'fail', 'nothing chosen is still broken');
  const firecrawl = machine({ config: { role: 'collector', transport: 'firecrawl-cli' } });
  assert.equal(find(machineHealth({ env: firecrawl.env, probe: ABSENT }), 'firecrawl-cli').severity, 'fail', 'choosing Firecrawl and lacking it is broken');
});
