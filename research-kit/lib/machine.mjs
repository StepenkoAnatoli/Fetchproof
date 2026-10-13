// machine.mjs - everything outside the project (ADR-0002, ADR-0010, ADR-0012, ADR-0020).
//
// The machine config, the install state, git's core.hooksPath, the runtime anchors, and
// the machine role. The ONLY module that reaches past the project root.
//
// The config is read in THREE states - absent / readable / unreadable - because the old
// `try { parse } catch {}` collapsed "never configured" into "configured, and now
// corrupt", so a hardened machine silently reverted to the fail-open defaults.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exists, readText, writeText, ensureDir, readJson, nowIso, parseJson, homeDir } from './core.mjs';

import { kitCommand } from './core.mjs';
// ---------------------------------------------------------------- anchors (ADR-0012)

/**
 * The single place the kit states a runtime's paths. Every value is a DEFAULT the
 * machine config may override - a hardcoded skill root on a machine whose agent reads
 * another root installs a skill nothing discovers.
 */
export const RUNTIME_ANCHORS = Object.freeze({
  settingsPath: path.join(homeDir(), '.claude', 'settings.json'),
  skillRoots: Object.freeze([path.join(homeDir(), '.claude', 'skills')]),
  projectSkillDir: '.claude/skills',
});

/**
 * The machine's `.agents` root. `RESEARCH_KIT_HOME` outranks the OS-derived profile
 * result, whichever profile variables produced it — the githooks wrapper has always
 * honoured it, and a module that disagreed with the hook about where the kit lives was
 * a split answer to one question. The kit never monkey-patches `os.homedir()`.
 */
export function agentsHome(env = process.env) {
  return env.RESEARCH_KIT_HOME
    ? path.dirname(path.resolve(env.RESEARCH_KIT_HOME))
    : path.join(homeDir(), '.agents');
}

export function kitHome(env = process.env) {
  return env.RESEARCH_KIT_HOME ? path.resolve(env.RESEARCH_KIT_HOME) : path.join(homeDir(), '.agents', 'research-kit');
}

export const KIT_HOME = kitHome();
export const CONFIG_PATH = path.join(homeDir(), '.agents', 'research-kit.config.json');
export const INSTALL_STATE_PATH = path.join(homeDir(), '.agents', 'research-kit.install.json');
export const SKILL_NAME = 'research-first';
export const EDIT_GATE_HOOK = 'hooks/edit-gate.mjs';

/** Names the kit used to ship. Recognising an old install requires naming it. */
export const RETIRED_EDIT_GATE_HOOKS = Object.freeze(['hooks/claude-pretooluse.mjs', 'hooks/claude-gate.mjs']);
export const RETIRED_FLAGS = Object.freeze({ '--claude-only': '--edit-only', '--no-claude': '--no-edit-gate' });
export const RETIRED_PROJECT_SKILL_DIRS = Object.freeze(['.agents/skills']);
export const RETIRED_KIT_FILES = Object.freeze(['hooks/claude-pretooluse.mjs', 'hooks/claude-gate.mjs', 'lib/cli.mjs']);
export const RETIRED_CONFIG_KEYS = Object.freeze({ claudeGate: 'editGate.mode' });
export const RETIRED_ENV_VARS = Object.freeze({ CLAUDE_SETTINGS_PATH: 'RESEARCH_KIT_EDIT_GATE_SETTINGS' });

/**
 * Does this registered command name that hook file?
 *
 * The kit spells its hook paths with forward slashes and the installer writes a NATIVE
 * path, so on Windows the registration reads `...\hooks\edit-gate.mjs` while every
 * detector looks for `hooks/edit-gate.mjs`. Matching literally made the installer write
 * a second registration beside its own and doctor report `none` for a gate that was
 * installed - so separators are normalised in the one place that knows these names.
 */
export function namesHook(command, hookPath) {
  const normalize = (text) => String(text ?? '').split('\\').join('/');
  return normalize(command).includes(normalize(hookPath));
}

export const DEFAULTS = Object.freeze({
  failOpen: true,
  editGate: Object.freeze({ mode: 'ask', settingsPath: '' }),
  evidencePolicy: 'pluralist',
  role: 'collector',
  transport: '',
  searchTransport: '',
  serpapiKey: '',
  searxngUrl: '',
  skillRoots: Object.freeze([]),
  projectSkillDir: '',
  maxAgeDays: 180,
  browserPath: '',
});

export const ROLES = Object.freeze(['collector', 'builder']);
/** `unknown` is a STATE the kit resolves to, never a role an operator may declare. */
export const ROLE_STATES = Object.freeze([...ROLES, 'unknown']);
export const EVIDENCE_POLICIES = Object.freeze(['pluralist', 'strict']);
export const EDIT_GATE_MODES = Object.freeze(['ask', 'hard-block', 'off']);

// ---------------------------------------------------------------- config, in three states

/**
 * Precedence, highest first (the path-precedence contract):
 *   1. an explicit argument   2. `RESEARCH_KIT_CONFIG`
 *   3. `RESEARCH_KIT_HOME`'s `.agents` root   4. the OS profile's `.agents`
 * A higher authority is never silently replaced by a lower one.
 */
export function configPath(env = process.env, explicit = '') {
  if (explicit) return path.resolve(explicit);
  if (env.RESEARCH_KIT_CONFIG) return env.RESEARCH_KIT_CONFIG;
  return path.join(agentsHome(env), 'research-kit.config.json');
}

function lastGoodPath(file) {
  return `${file}.last-good`;
}

/**
 * The restrictive state of each POSTURE key, for a value that is present and not of its
 * type (ADR-0121). An operator who typed `"failOpen": "false"` meant to tighten something,
 * and resolving the typo to the default loosened it in silence: fail-open, pluralist, ask.
 * A config that does not parse already fails closed (ADR-0020) and an unknown role refuses
 * to collect (ADR-0023); this is the same rule one level down, per key. Absent keys keep
 * their defaults - absence is not a typo.
 */
const RESTRICTIVE = Object.freeze({ failOpen: false, evidencePolicy: 'strict', 'editGate.mode': 'hard-block' });

function shape(raw) {
  // The posture keys an operator typed and the kit could not read as typed, in config order.
  const illTyped = [];
  const postureKey = (name, value, valid, fallback) => {
    if (value === undefined) return fallback;
    if (valid(value)) return value;
    illTyped.push(name);
    return RESTRICTIVE[name];
  };
  const settings = {
    failOpen: postureKey('failOpen', raw.failOpen, (v) => typeof v === 'boolean', DEFAULTS.failOpen),
    editGate: {
      mode: DEFAULTS.editGate.mode,
      // A path the installer hands to the filesystem, so only a non-empty string is one;
      // anything else falls back to the anchor, as every other wrong-typed key here does.
      // It was the one key passed through raw, and `{"editGate":{"settingsPath":42}}` reached
      // `path.dirname` in installEditGate and killed `install-hooks` - the command whose job
      // is to bind the gates - with a raw ERR_INVALID_ARG_TYPE stack (found 2026-10-02,
      // break-test; the sibling of the 2026-10-01 `skillRoots` check).
      settingsPath: typeof raw.editGate?.settingsPath === 'string' && raw.editGate.settingsPath.trim() !== ''
        ? raw.editGate.settingsPath
        : DEFAULTS.editGate.settingsPath,
    },
    evidencePolicy: postureKey('evidencePolicy', raw.evidencePolicy, (v) => EVIDENCE_POLICIES.includes(v), DEFAULTS.evidencePolicy),
    // A field that is PRESENT and not a known role reads as `unknown`, not as the
    // default: a misspelling ("collecter", "Builder") is a machine whose operator meant
    // something, and guessing which is how a builder silently becomes a role that may
    // spend credits. Absent stays `collector` (ADR-0010); unknown blocks (ADR-0023).
    role: raw.role === undefined ? DEFAULTS.role : (ROLES.includes(raw.role) ? raw.role : 'unknown'),
    transport: typeof raw.transport === 'string' ? raw.transport : DEFAULTS.transport,
    // The SEARCH side is chosen separately from the fetch side (ADR-0027). Absent means
    // "the fetch provider", which is what every machine did before the split.
    searchTransport: typeof raw.searchTransport === 'string' ? raw.searchTransport : DEFAULTS.searchTransport,
    // A credential, and the only one this config holds. It lives here or in the
    // environment and never in a repository (SR-1). Read but never rendered: every
    // display path goes through `serpapi.redact()`.
    serpapiKey: typeof raw.serpapiKey === 'string' ? raw.serpapiKey : DEFAULTS.serpapiKey,
    // The SearXNG instance the searxng search provider asks (ADR-0104). A URL, not a secret.
    searxngUrl: typeof raw.searxngUrl === 'string' ? raw.searxngUrl : DEFAULTS.searxngUrl,
    // Checked as a list of PATHS, not only as an array. Every other key here is
    // type-checked, and this one was not, so `{"skillRoots": [42]}` - or a null left in a
    // hand-edited list - reached `path.join` in skillLocations() and killed `doctor` with a
    // raw ERR_INVALID_ARG_TYPE stack and Node's version footer: the one command whose whole
    // job is to name every problem and print its fix, dead on a config typo it should have
    // named (found 2026-10-01, break-test). An entry that is not a path is dropped, which
    // leaves the defaults in charge when nothing is left.
    skillRoots: Array.isArray(raw.skillRoots) ? raw.skillRoots.filter((root) => typeof root === 'string' && root.trim() !== '') : [],
    projectSkillDir: typeof raw.projectSkillDir === 'string' ? raw.projectSkillDir : '',
    maxAgeDays: Number.isFinite(raw.maxAgeDays) ? raw.maxAgeDays : DEFAULTS.maxAgeDays,
    // The browser transport's executable (ADR-0088), which its own errors tell the operator
    // to set. It was missing here until 2026-10-11, so it was never read, and every save -
    // `install-hooks --role` among them - rewrote the file without it.
    browserPath: typeof raw.browserPath === 'string' ? raw.browserPath : DEFAULTS.browserPath,
  };
  // A retired key is READ before it is dropped: a rename that silently relaxes a gate is
  // the same defect as a rename that silently stops firing one.
  const retired = [];
  if (raw.editGate?.mode !== undefined) {
    // Present: taken as typed, or resolved to the restrictive mode and named (ADR-0121).
    settings.editGate.mode = postureKey('editGate.mode', raw.editGate.mode, (v) => EDIT_GATE_MODES.includes(v), DEFAULTS.editGate.mode);
    if (raw.claudeGate !== undefined) retired.push('claudeGate');
  } else if (EDIT_GATE_MODES.includes(raw.claudeGate)) { settings.editGate.mode = raw.claudeGate; retired.push('claudeGate'); }
  else if (raw.claudeGate !== undefined) retired.push('claudeGate');
  return { settings, retired, illTyped };
}

/**
 * Returns `{ settings, state, source, error, retiredKeys, illTypedKeys }`. The settings alone cannot
 * say whether fail-closed was configured or is the fallback this machine adopted.
 */
export function readMachineConfig(env = process.env) {
  const file = configPath(env);
  if (!exists(file)) {
    return { settings: shape({}).settings, state: 'absent', source: file, error: null, retiredKeys: [], illTypedKeys: [] };
  }
  const text = readText(file);
  try {
    const raw = parseJson(text ?? '');
    const { settings, retired, illTyped } = shape(raw && typeof raw === 'object' ? raw : {});
    try { writeText(lastGoodPath(file), text); } catch { /* snapshot is best-effort */ }
    return { settings, state: 'readable', source: file, error: null, retiredKeys: retired, illTypedKeys: illTyped };
  } catch (err) {
    const snapshot = readJson(lastGoodPath(file), null);
    if (snapshot) {
      const { settings, retired, illTyped } = shape(snapshot);
      return { settings, state: 'unreadable', resolvedFrom: 'snapshot', source: file, snapshotSource: lastGoodPath(file), error: err.message, retiredKeys: retired, illTypedKeys: illTyped };
    }
    // Nothing to hold: fail CLOSED, and the ROLE becomes `unknown` rather than the
    // default. The old "every config was previously snapshotted" rationale does not
    // cover a hand-written config, a copied machine, a denied snapshot write, or a
    // missing backup - and on every one of those the default `collector` is the role
    // that may spend credits. An unknown role refuses metered collection until it is
    // resolved (ADR-0023). `failOpen` is still the only knob tightened: the others have
    // no safe restrictive default.
    const { settings } = shape({});
    return {
      settings: { ...settings, failOpen: false, role: 'unknown' },
      state: 'unreadable',
      resolvedFrom: 'fallback-closed',
      source: file,
      error: err.message,
      retiredKeys: [],
      illTypedKeys: [],
    };
  }
}

export function loadConfig(env = process.env) {
  return readMachineConfig(env).settings;
}

/** Writing drops retired keys, so the migration happens through normal use. */
export function saveConfig(patch, env = process.env) {
  const file = configPath(env);
  const current = readMachineConfig(env).settings;
  const next = {
    ...current,
    ...patch,
    editGate: { ...current.editGate, ...(patch.editGate ?? {}) },
  };
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify(next, null, 2)}\n`);
  writeText(lastGoodPath(file), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** The fail-open / fail-closed answer, carrying where it came from. */
export function posture(env = process.env) {
  const read = readMachineConfig(env);
  return {
    failOpen: read.settings.failOpen,
    configState: read.state,
    configSource: read.source,
    configError: read.error,
    retiredKeys: read.retiredKeys,
    illTypedKeys: read.illTypedKeys,
    resolvedFrom: read.resolvedFrom ?? (read.state === 'absent' ? 'defaults' : 'config'),
    // The code carries the RESOLVED posture, not the state:
    //   0 allow
    //   1 a config that parses says fail-closed (including a held last-good snapshot)
    //   2 unreadable, nothing to hold, and therefore resolved to blocking
    // Two readers of one posture that disagree about what a code means is the drift the
    // pin exists to catch.
    exitCode: read.settings.failOpen ? 0 : (read.resolvedFrom === 'fallback-closed' ? 2 : 1),
  };
}

// ---------------------------------------------------------------- runtime paths

export function runtimePaths(env = process.env) {
  const cfg = loadConfig(env);
  return {
    settingsPath: env.RESEARCH_KIT_EDIT_GATE_SETTINGS || cfg.editGate.settingsPath || RUNTIME_ANCHORS.settingsPath,
    projectSkillDir: cfg.projectSkillDir || RUNTIME_ANCHORS.projectSkillDir,
  };
}

/** The personal skill roots: the machine config's `skillRoots`, else the anchored default. */
export function skillRoots(env = process.env) {
  const cfg = loadConfig(env);
  return cfg.skillRoots.length ? [...cfg.skillRoots] : [...RUNTIME_ANCHORS.skillRoots];
}

export function skillLocations(env = process.env) {
  return skillRoots(env).map((root) => path.join(root, SKILL_NAME));
}

/** A retired ENVIRONMENT variable is reported, never honoured - no kit write reaches a shell. */
export function retiredEnvNotes(env = process.env) {
  return Object.entries(RETIRED_ENV_VARS)
    .filter(([name, replacement]) => env[name] && !env[replacement])
    .map(([name, replacement]) => ({ name, replacement, value: env[name] }));
}

// ---------------------------------------------------------------- role and collection policy

export function machineRole(env = process.env) {
  return loadConfig(env).role;
}

/** The single answer to "may this machine collect?". */
export function collectionPolicy(env = process.env) {
  const read = readMachineConfig(env);
  const role = read.settings.role;
  if (role === 'builder') {
    return {
      role,
      mayCollect: false,
      reason: 'this machine is declared role=builder, which does not collect',
      remedy: `collect on the collector machine, or declare this one: ${kitCommand('install-hooks.mjs', '--role collector')}`,
    };
  }
  if (role === 'unknown') {
    // Not a default and not a guess: the machine's role could not be established, so the
    // metered, credit-spending half of the kit stays shut until somebody says which it is.
    return {
      role,
      mayCollect: false,
      reason: read.resolvedFrom === 'fallback-closed'
        ? `this machine's role cannot be established: ${read.source} does not parse (${read.error}) and there is no last-good snapshot`
        : `this machine's ${read.resolvedFrom === 'snapshot' ? `last-good snapshot (${read.snapshotSource})` : 'config'} names a role the kit does not know ("${readJson(read.snapshotSource ?? read.source, {})?.role ?? 'unreadable value'}")`,
      remedy: `repair the config, or declare the role: ${kitCommand('install-hooks.mjs', '--role collector|builder')}`,
    };
  }
  return { role, mayCollect: true, reason: '', remedy: '' };
}

export function collectionRefusal(policy) {
  return [
    `refused: ${policy.reason}.`,
    'A page fetched by hand is not evidence in this kit, and re-collecting forges a corpus',
    'instead of reporting a gap. Name the missing fact and let it be collected.',
    `remedy: ${policy.remedy}`,
  ].join('\n');
}

export function evidencePolicy(env = process.env) {
  return loadConfig(env).evidencePolicy;
}

// ---------------------------------------------------------------- git

function git(args, { cwd = process.cwd(), env = process.env } = {}) {
  try {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function gitVersion(opts = {}) {
  return git(['--version'], opts);
}

/** Scope-aware readers: which hooksPath is set where. */
export function hooksPath(scope = 'global', opts = {}) {
  const flag = { global: '--global', local: '--local', system: '--system' }[scope] ?? '--global';
  return git(['config', flag, '--get', 'core.hooksPath'], opts);
}

export function hooksPathEffective(opts = {}) {
  return git(['config', '--get', 'core.hooksPath'], opts);
}

export function setHooksPath(value, { scope = 'global', ...opts } = {}) {
  const flag = { global: '--global', local: '--local', system: '--system' }[scope] ?? '--global';
  if (value === null) return git(['config', flag, '--unset', 'core.hooksPath'], opts);
  return git(['config', flag, 'core.hooksPath', value], opts);
}

/**
 * The hooks folder the kit's install replaced, where the sh hooks can read it (ADR-0112): git
 * runs one hooks folder, and `githooks/hand-on.sh` hands each hook on to this one. The install
 * state keeps it too, as JSON, which sh cannot parse.
 */
export const PREVIOUS_HOOKS_KEY = 'research-kit.previousHooksPath';

/**
 * The hooks folder the install replaced, or null: what every kit hook hands on to (ADR-0112).
 * Read with `--type=path`, as `hand-on.sh` reads it, so a value typed `~/hooks` resolves to the
 * folder git will run; the raw value made doctor call a working `~/custom-hooks` missing and
 * prescribe the unset that would have removed it (outside audit, 2026-10-03).
 */
export function previousHooksPath(opts = {}) {
  return git(['config', '--global', '--type=path', '--get', PREVIOUS_HOOKS_KEY], opts) || null;
}

/** The repository's top level from `cwd`, or null outside one: where git runs its hooks from. */
export function repoTopLevel(opts = {}) {
  return git(['rev-parse', '--show-toplevel'], opts) || null;
}

export function setPreviousHooksPath(value, opts = {}) {
  if (value === null) return git(['config', '--global', '--unset', PREVIOUS_HOOKS_KEY], opts);
  return git(['config', '--global', PREVIOUS_HOOKS_KEY, value], opts);
}

export function isGitRepo(dir) {
  return exists(path.join(dir, '.git'));
}

/**
 * The third override is silent by nature: it disables the hook that would report it.
 *
 * Asked of git from `cwd`, not of the filesystem: git finds the repository by walking up, so a
 * subdirectory - a nested decision project under docs/decisions/, the folder an operator
 * happens to run install-hooks from - is governed by the same local `core.hooksPath` as the
 * root. The probe looked for `.git` beside `cwd` and said `null` anywhere below it (outside
 * audit, 2026-10-03). Outside any repository `git config --local` fails, and that is null.
 */
export function localHooksPathOverride(cwd = process.cwd(), opts = {}) {
  const local = hooksPath('local', { ...opts, cwd });
  return local || null;
}

// ---------------------------------------------------------------- install state

export function readInstallState(env = process.env) {
  return readJson(env.RESEARCH_KIT_INSTALL_STATE || INSTALL_STATE_PATH, null);
}

export function writeInstallState(state, env = process.env) {
  const file = env.RESEARCH_KIT_INSTALL_STATE || INSTALL_STATE_PATH;
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify({ ...state, at: nowIso() }, null, 2)}\n`);
  return file;
}

export { os, path as nodePath, fs };
