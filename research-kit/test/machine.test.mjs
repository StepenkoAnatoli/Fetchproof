// Everything outside the project: the three config states, the role, and the retired
// names (ADR-0002, ADR-0010, ADR-0012, ADR-0020).

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test, describe, assert, tempDir, fs, path, os, KIT_ROOT } from './harness.mjs';
import { writeText, readText, homeDir } from '../lib/core.mjs';
import {
  readMachineConfig, loadConfig, saveConfig, posture, machineRole, collectionPolicy, readInstallState,
  collectionRefusal, evidencePolicy, runtimePaths, skillLocations, retiredEnvNotes,
  RUNTIME_ANCHORS, RETIRED_ENV_VARS, RETIRED_CONFIG_KEYS, DEFAULTS, ROLES,
} from '../lib/machine.mjs';

describe('machine');

test('install state refuses JSON that is not an object', () => {
  const file = path.join(tempDir('rk-state-shape-'), 'install.json');
  const env = { RESEARCH_KIT_INSTALL_STATE: file };
  for (const value of [null, [], 'str', true, 42]) {
    writeText(file, JSON.stringify(value));
    assert.equal(readInstallState(env), null, JSON.stringify(value));
  }
});

test('install state keeps typed paths, arrays and skill hashes without changing the file', () => {
  const file = path.join(tempDir('rk-state-fields-'), 'install.json');
  const env = { RESEARCH_KIT_INSTALL_STATE: file };
  const paths = ['kitHome', 'hooksPath', 'previousHooksPath', 'bound', 'deployedFrom'];
  for (const value of [42, true, {}, ['/x'], '', '   ']) {
    writeText(file, JSON.stringify(Object.fromEntries(paths.map((key) => [key, value]))));
    const state = readInstallState(env);
    for (const key of paths) assert.equal(state[key], undefined, `${key}: ${JSON.stringify(value)}`);
  }
  const raw = { ...Object.fromEntries(paths.map((key) => [key, '/valid/path'])), skills: ['/a', 42, '', '/b'],
    boundSet: ['/c', false, null], skillSetHashes: { '/a': 'hash', '/b': 42 }, at: 'saved-time' };
  writeText(file, JSON.stringify(raw));
  const before = readText(file);
  const state = readInstallState(env);
  for (const key of paths) assert.equal(state[key], raw[key]);
  assert.deepEqual(state.skills, ['/a', '/b']);
  assert.deepEqual(state.boundSet, ['/c']);
  assert.deepEqual(state.skillSetHashes, { '/a': 'hash' });
  assert.equal(state.at, 'saved-time');
  assert.equal(readText(file), before);
});

function envWith(contents, { snapshot = null, extra = {} } = {}) {
  const dir = tempDir('research-kit-config-');
  const file = path.join(dir, 'research-kit.config.json');
  if (contents !== null) writeText(file, contents);
  if (snapshot !== null) writeText(`${file}.last-good`, snapshot);
  return { env: { ...process.env, RESEARCH_KIT_CONFIG: file, ...extra }, file };
}

test('absent: the fail-open default IS the answer, and the state says so', () => {
  const { env } = envWith(null);
  const read = readMachineConfig(env);
  assert.equal(read.state, 'absent');
  assert.equal(read.settings.failOpen, true);
  assert.equal(posture(env).exitCode, 0);
});

test('readable: the config decides, and a read snapshots it', () => {
  const { env, file } = envWith(JSON.stringify({ failOpen: false, role: 'builder', evidencePolicy: 'strict' }));
  const read = readMachineConfig(env);
  assert.equal(read.state, 'readable');
  assert.equal(read.settings.failOpen, false);
  assert.equal(read.settings.role, 'builder');
  assert.equal(read.settings.evidencePolicy, 'strict');
  assert.ok(fs.existsSync(`${file}.last-good`), 'every successful read snapshots the config');
});

test('unreadable with nothing to hold makes the ROLE unknown, and unknown does not collect', () => {
  const { env } = envWith('{"role": "buil');
  const read = readMachineConfig(env);
  assert.equal(read.settings.role, 'unknown',
    'the default collector is the role that may spend credits - it must not be adopted by a machine whose config could not be read');

  const policy = collectionPolicy(env);
  assert.equal(policy.mayCollect, false);
  assert.match(policy.reason, /cannot be established/);
  assert.match(policy.remedy, /--role collector\|builder/);
});

test('a role the kit does not know is unknown too - a misspelling is not a default', () => {
  const { env } = envWith(JSON.stringify({ role: 'collecter' }));
  assert.equal(machineRole(env), 'unknown');
  assert.equal(collectionPolicy(env).mayCollect, false);
});

test('an ABSENT config still reads as collector - ADR-0010\'s default is untouched', () => {
  const { env } = envWith(null);
  assert.equal(machineRole(env), 'collector');
  assert.equal(collectionPolicy(env).mayCollect, true);
});

test('unreadable: a truncated config holds the last one that parsed - every knob, not just failOpen', () => {
  const { env } = envWith('{"failOpen": fal', {
    snapshot: JSON.stringify({ failOpen: false, role: 'builder', evidencePolicy: 'strict', editGate: { mode: 'hard-block' } }),
  });
  const read = readMachineConfig(env);
  assert.equal(read.state, 'unreadable');
  assert.equal(read.settings.failOpen, false, 'a hardened machine must not silently revert to fail-open');
  assert.equal(read.settings.role, 'builder', 'a builder must not silently become a collector - that role may spend credits');
  assert.equal(read.settings.evidencePolicy, 'strict');
  assert.equal(read.settings.editGate.mode, 'hard-block');
  assert.ok(read.error, 'the parse error is carried, not swallowed');
});

test('unreadable with nothing to hold fails CLOSED, and tightens exactly two knobs', () => {
  const { env } = envWith('{"failOpen": fal');
  const read = readMachineConfig(env);
  assert.equal(read.state, 'unreadable');
  assert.equal(read.settings.failOpen, false);
  assert.equal(read.settings.role, 'unknown', 'the role is the second knob with a safe restrictive answer');
  assert.equal(read.settings.evidencePolicy, DEFAULTS.evidencePolicy, 'the rest have none and are left alone');
  assert.equal(posture(env).exitCode, 2, 'unreadable and resolved to blocking is its own code');
});

// ADR-0121 (2026-10-02, arena break-test #198): a posture key that is PRESENT and not of its
// type resolved to the laxer default - `{"failOpen":"false"}` to fail-open, `"STRICT"` to
// pluralist, `"HARD-BLOCK"` to ask - while `role` beside them resolves to the restrictive
// `unknown` (ADR-0023) and a config that does not parse fails closed (ADR-0020). An operator
// who typed the key meant to tighten something; a typo must not loosen it in silence.
test('an ill-typed posture key resolves to its restrictive state, and is named', () => {
  const read = readMachineConfig(envWith(JSON.stringify({ failOpen: 'false', evidencePolicy: 'STRICT', editGate: { mode: 'HARD-BLOCK' } })).env);
  assert.equal(read.state, 'readable');
  assert.equal(read.settings.failOpen, false, '"false" is not false, and it is not true either: it is closed');
  assert.equal(read.settings.evidencePolicy, 'strict');
  assert.equal(read.settings.editGate.mode, 'hard-block');
  assert.deepEqual(read.illTypedKeys, ['failOpen', 'evidencePolicy', 'editGate.mode'], 'each key is named, so doctor can say which');
  assert.equal(posture(envWith('{"failOpen": "false"}').env).exitCode, 1, 'a config that parses and says something other than true is fail-closed');
  assert.equal(posture(envWith('{"failOpen": "true"}').env).exitCode, 1, 'a string is not the boolean, whatever it spells');
  assert.equal(posture(envWith('{"failOpen": 1}').env).exitCode, 1);

  // The well-typed values are untouched, absent keys keep their defaults, and nothing is named.
  const fine = readMachineConfig(envWith(JSON.stringify({ failOpen: true, evidencePolicy: 'pluralist', editGate: { mode: 'off' } })).env);
  assert.deepEqual([fine.settings.failOpen, fine.settings.evidencePolicy, fine.settings.editGate.mode], [true, 'pluralist', 'off']);
  assert.deepEqual(fine.illTypedKeys, []);
  const absent = readMachineConfig(envWith('{}').env);
  assert.deepEqual([absent.settings.failOpen, absent.settings.evidencePolicy, absent.settings.editGate.mode], [true, 'pluralist', 'ask']);
  assert.deepEqual(absent.illTypedKeys, []);
  assert.deepEqual(readMachineConfig(envWith(null).env).illTypedKeys, [], 'an absent config names nothing');

  // A retired key is still read as before (ADR-0075 lineage): a valid claudeGate is honoured
  // and reported retired; an ill-typed one is dropped and reported retired, not ill-typed.
  const retiredValid = readMachineConfig(envWith(JSON.stringify({ claudeGate: 'hard-block' })).env);
  assert.equal(retiredValid.settings.editGate.mode, 'hard-block');
  assert.deepEqual([retiredValid.retiredKeys, retiredValid.illTypedKeys], [['claudeGate'], []]);
  // The snapshot path shapes the same way: a held config with an ill-typed key is closed too.
  const held = readMachineConfig(envWith('{"failOpen": fal', { snapshot: '{"failOpen": "false"}' }).env);
  assert.equal(held.settings.failOpen, false);
  assert.deepEqual(held.illTypedKeys, ['failOpen']);
});

test('posture carries where its answer came from, so no consumer has to guess', () => {
  assert.equal(posture(envWith(null).env).resolvedFrom, 'defaults');
  assert.equal(posture(envWith('{"failOpen": true}').env).resolvedFrom, 'config');
  assert.equal(posture(envWith('{bad', { snapshot: '{"failOpen": true}' }).env).resolvedFrom, 'snapshot');
  assert.equal(posture(envWith('{bad').env).resolvedFrom, 'fallback-closed');
});

test('a retired config key is READ into the current shape, then reported', () => {
  const { env } = envWith(JSON.stringify({ claudeGate: 'hard-block' }));
  const read = readMachineConfig(env);
  assert.equal(read.settings.editGate.mode, 'hard-block',
    'a rename that silently relaxes a gate is the same defect as one that stops it firing');
  assert.deepEqual(read.retiredKeys, ['claudeGate']);
  assert.equal(RETIRED_CONFIG_KEYS.claudeGate, 'editGate.mode');
});

test('saveConfig drops the retired key, so the migration happens through normal use', () => {
  const { env, file } = envWith(JSON.stringify({ claudeGate: 'hard-block' }));
  saveConfig({ role: 'builder' }, env);
  const written = JSON.parse(readText(file));
  assert.equal('claudeGate' in written, false);
  assert.equal(written.editGate.mode, 'hard-block', 'the value it carried survives the rename');
  assert.equal(written.role, 'builder');
});

// Found 2026-10-11: the browser transport and its error messages tell the operator to set
// browserPath (ADR-0088), but the config was read without it and rewritten without it, so
// `install-hooks --role builder` erased a browserPath the operator had set by hand.
test('browserPath is read from the machine config and survives a save', () => {
  const { env, file } = envWith(JSON.stringify({ browserPath: '/opt/google/chrome/chrome' }));
  assert.equal(loadConfig(env).browserPath, '/opt/google/chrome/chrome');
  saveConfig({ role: 'builder' }, env);
  assert.equal(JSON.parse(readText(file)).browserPath, '/opt/google/chrome/chrome', 'a save kept the key');
  assert.equal(loadConfig(envWith(JSON.stringify({ browserPath: 42 })).env).browserPath, '', 'a path that is not a string is not one');
});

test('a retired ENVIRONMENT variable is reported and never honoured', () => {
  const { env } = envWith(null, { extra: { CLAUDE_SETTINGS_PATH: '/somewhere/settings.json' } });
  const notes = retiredEnvNotes(env);
  assert.equal(notes[0].name, 'CLAUDE_SETTINGS_PATH');
  assert.equal(notes[0].replacement, RETIRED_ENV_VARS.CLAUDE_SETTINGS_PATH);
  assert.notEqual(runtimePaths(env).settingsPath, '/somewhere/settings.json', 'an export must not decide where the gate installs');
});

test('the retired variable goes quiet once its replacement is set', () => {
  const { env } = envWith(null, { extra: { CLAUDE_SETTINGS_PATH: '/old.json', RESEARCH_KIT_EDIT_GATE_SETTINGS: '/new.json' } });
  assert.equal(retiredEnvNotes(env).length, 0, 'an operator who set the new variable has answered the question');
  assert.equal(runtimePaths(env).settingsPath, '/new.json');
});

test('the anchors are DEFAULTS the machine config overrides', () => {
  const plain = envWith(null).env;
  assert.equal(runtimePaths(plain).settingsPath, RUNTIME_ANCHORS.settingsPath);
  assert.deepEqual(skillLocations(plain), RUNTIME_ANCHORS.skillRoots.map((root) => path.join(root, 'research-first')));

  const { env } = envWith(JSON.stringify({
    editGate: { settingsPath: '/custom/settings.json' },
    skillRoots: ['/custom/skills'],
    projectSkillDir: '.agent/skills',
  }));
  assert.equal(runtimePaths(env).settingsPath, '/custom/settings.json');
  assert.equal(runtimePaths(env).projectSkillDir, '.agent/skills');
  assert.deepEqual(skillLocations(env), [path.join('/custom/skills', 'research-first')]);
});

// Found 2026-10-02 (break-test): the 2026-10-01 fix type-checked `skillRoots`, and
// `editGate.settingsPath` was left as the one key `shape()` hands through raw. A hand-edited
// `{"editGate":{"settingsPath":42}}` reached `path.dirname` in `installEditGate`
// (`lib/installer.mjs:193`) and killed `install-hooks` - the command whose job is to bind the
// gates - with a raw ERR_INVALID_ARG_TYPE stack and Node's version footer: exit 1, nothing
// named. The front README is where an operator is told to hand-edit this file.
test('a settingsPath that is not a path falls back to the anchor, and install-hooks answers', () => {
  assert.equal(loadConfig(envWith(JSON.stringify({ editGate: { settingsPath: 42 } })).env).editGate.settingsPath, '',
    'a number is not a path, and it is not passed to path.dirname either');
  assert.equal(loadConfig(envWith(JSON.stringify({ editGate: { settingsPath: {} } })).env).editGate.settingsPath, '');
  assert.equal(loadConfig(envWith(JSON.stringify({ editGate: { settingsPath: '   ' } })).env).editGate.settingsPath, '',
    'whitespace is not a path');
  assert.equal(loadConfig(envWith(JSON.stringify({ editGate: { settingsPath: '/ok/settings.json' } })).env).editGate.settingsPath,
    '/ok/settings.json', 'a real path survives');

  // And the command the operator is told to run answers, in the shape it promises, with no
  // stack trace on either stream. The kit is "deployed" at KIT_ROOT - its hook is on disk -
  // so the installer reaches the settings write rather than refusing on the deployed check.
  const hostile = envWith(JSON.stringify({ editGate: { settingsPath: 42 } }));
  const home = tempDir('rk-install-hooks-home-');
  const run = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'install-hooks.mjs'), '--edit-only'], {
    cwd: tempDir('rk-install-hooks-hostile-'), encoding: 'utf8', timeout: 60_000, windowsHide: true,
    // HOME and USERPROFILE both: os.homedir() reads USERPROFILE on Windows, and with HOME alone
    // the settings went to the runner's real profile and the assertion below failed there.
    env: { ...process.env, RESEARCH_KIT_CONFIG: hostile.file, RESEARCH_KIT_HOME: KIT_ROOT, HOME: home, USERPROFILE: home },
  });
  assert.doesNotMatch(`${run.stdout}${run.stderr}`, /ERR_INVALID_ARG_TYPE|at file:\/\//,
    `install-hooks died on a config typo instead of naming it: ${String(run.stderr).slice(0, 300)}`);
  assert.equal(run.status, 0, `install-hooks did not answer: ${String(run.stderr).slice(0, 300)}`);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'settings.json')),
    'with no usable path in the config, the runtime anchor is in charge');
});

// Found 2026-10-01 (break-test): every other key this file shapes is type-checked, and
// `skillRoots` was checked as an ARRAY but never as a list of paths. `{"skillRoots": [42]}`
// - or a null left behind in a hand-edited list - reached `path.join` and killed `doctor`
// with a raw ERR_INVALID_ARG_TYPE stack trace and Node's version footer: exit 1, nothing
// named, and the one command whose whole job is to name every problem and print its fix was
// the casualty. The front README is where an operator is told to hand-edit this file.
test('a skillRoots entry that is not a path is dropped, and doctor still answers', () => {
  assert.deepEqual(loadConfig(envWith(JSON.stringify({ skillRoots: [42] })).env).skillRoots, [],
    'a number is not a path, and it is not passed to path.join either');
  assert.deepEqual(
    loadConfig(envWith(JSON.stringify({ skillRoots: ['/ok', null, { root: '/x' }, '', '  ', '/also'] })).env).skillRoots,
    ['/ok', '/also'], 'the paths in the list survive; whatever is not one goes');

  // With nothing left, the documented defaults are in charge rather than a crash.
  const hostile = envWith(JSON.stringify({ skillRoots: [42] }));
  assert.deepEqual(skillLocations(hostile.env),
    RUNTIME_ANCHORS.skillRoots.map((root) => path.join(root, 'research-first')),
    'a config that names no usable root falls back to the anchors');

  // And the command the operator is told to run answers, in the shape it promises, with no
  // stack trace on either stream.
  const run = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'doctor.mjs'), '--json'], {
    cwd: tempDir('rk-doctor-hostile-'), encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: { ...process.env, RESEARCH_KIT_CONFIG: hostile.file },
  });
  assert.doesNotMatch(`${run.stdout}${run.stderr}`, /ERR_INVALID_ARG_TYPE|at file:\/\//,
    `doctor died on a config typo instead of naming it: ${String(run.stderr).slice(0, 300)}`);
  assert.equal(typeof JSON.parse(String(run.stdout)).kitVersion, 'string', 'doctor did not report');
});

test('an unset role defaults to collector; a declared one is taken; ROLES stays the two', () => {
  assert.equal(machineRole(envWith(null).env), 'collector');
  assert.equal(machineRole(envWith(JSON.stringify({ role: 'builder' })).env), 'builder');
  assert.deepEqual([...ROLES], ['collector', 'builder'], 'unknown is a state, never something to declare');
});

test('collectionPolicy is the one answer to "may this machine collect?"', () => {
  const collector = collectionPolicy(envWith(JSON.stringify({ role: 'collector' })).env);
  assert.equal(collector.mayCollect, true);

  const builder = collectionPolicy(envWith(JSON.stringify({ role: 'builder' })).env);
  assert.equal(builder.mayCollect, false);
  assert.match(builder.remedy, /--role collector/, 'the remedy is a deliberate, recorded act');
  assert.match(collectionRefusal(builder), /forges a corpus/);
});

test('evidencePolicy is the operator\'s call, not the agent\'s', () => {
  assert.equal(evidencePolicy(envWith(null).env), 'pluralist');
  assert.equal(evidencePolicy(envWith(JSON.stringify({ evidencePolicy: 'strict' })).env), 'strict');
  // A value that is not a policy is the operator's typo, and it resolves to the restrictive
  // policy rather than the lax default (ADR-0121); until 2026-10-02 it read as pluralist.
  assert.equal(evidencePolicy(envWith(JSON.stringify({ evidencePolicy: 'whatever' })).env), 'strict');
});

test('loadConfig never throws on a hostile file - it resolves a posture instead', () => {
  for (const body of ['', 'null', '[]', '"a string"', '{', 'undefined']) {
    const { env } = envWith(body);
    assert.doesNotThrow(() => loadConfig(env), `body: ${JSON.stringify(body)}`);
  }
});

// Found 2026-09-28 (checking an outside break-test's risk list): with HOME set but EMPTY -
// some sudo and service environments - os.homedir() returns "", so the config path, the kit
// home and the install state were RELATIVE, resolved against whatever folder a command ran
// in. The home directory now falls back to the account's passwd entry.
test('an empty HOME does not make the machine paths relative to the cwd', () => {
  const probe = `import('${pathToFileURL(path.join(KIT_ROOT, 'lib', 'machine.mjs')).href}').then((m) => {
    process.stdout.write(JSON.stringify([m.CONFIG_PATH, m.INSTALL_STATE_PATH, m.agentsHome({}), m.kitHome({})]));
  });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8', cwd: tempDir('rk-empty-home-cwd-'),
    env: { PATH: process.env.PATH, HOME: '', USERPROFILE: '', SystemRoot: process.env.SystemRoot },
  });
  assert.equal(r.status, 0, r.stderr);
  for (const p of JSON.parse(r.stdout)) assert.ok(path.isAbsolute(p), `a machine path is relative with HOME="": ${p}`);
});

// Seen on windows-latest CI (2026-09-28): with USERPROFILE empty, os.homedir() does not return
// "" there - it THROWS (uv_os_homedir ENOENT), and machine.mjs called it at import. Reproduced
// here on any platform by making it throw.
test('homeDir survives an os.homedir() that throws, and still answers an absolute path', () => {
  const real = os.homedir;
  os.homedir = () => { const err = new Error('A system error occurred: uv_os_homedir returned ENOENT'); err.code = 'ERR_SYSTEM_ERROR'; throw err; };
  let home;
  try { home = homeDir(); } finally { os.homedir = real; }
  assert.ok(home && path.isAbsolute(home), `homeDir() gave ${JSON.stringify(home)}`);
});
