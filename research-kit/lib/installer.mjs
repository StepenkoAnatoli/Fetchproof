// installer.mjs - installs the two gates, records and restores prior state (ADR-0012).
//
// The commit gate is one machine-wide `core.hooksPath`. The edit-time gate is one
// registration in the runtime's settings file - and the installer recognises a
// registration left at a RETIRED hook name, replaces it rather than adding a second,
// and reports the repair. A stale entry beside a new one, or a registration pointing at
// a hook file that no longer exists, is a gate that silently gates nothing.

import fs from 'node:fs';
import path from 'node:path';
import {
  exists, readText, writeText, ensureDir, readJson, today, sha256File, parseJson, isDirectory,
} from './core.mjs';
import {
  KIT_HOME, EDIT_GATE_HOOK, RETIRED_EDIT_GATE_HOOKS, RETIRED_KIT_FILES, SKILL_NAME,
  hooksPath, setHooksPath, setPreviousHooksPath, localHooksPathOverride, runtimePaths, skillLocations, skillRoots, readInstallState, writeInstallState,
  saveConfig, loadConfig, ROLES, namesHook, repoTopLevel,
} from './machine.mjs';
import { KIT_ROOT, HOOK_MODE, hookExecutability } from './scaffold.mjs';

export const MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

/**
 * Why a settings file that PARSES is still refused. Named so the reason reaches the
 * operator's terminal rather than being inferred from a stack trace (see
 * `knownHookShape`).
 */
const UNFAMILIAR_SHAPE = 'hooks.PreToolUse is not the shape this installer walks';

// ---------------------------------------------------------------- the commit gate

export function installCommitGate({ kitHome = KIT_HOME, env = process.env, dryRun = false, gitPaths = {}, cwd = process.cwd() } = {}) {
  const dir = path.join(kitHome, 'githooks');
  const previous = hooksPath('global', gitPaths);
  const hook = path.join(dir, 'pre-commit');
  // The repository the operator stands in, if it is one, may set its own `core.hooksPath` -
  // husky, lefthook, simple-git-hooks and pre-commit all do - and git runs that folder, not
  // the machine-wide one, so the gate installed here would never run HERE. The installer read
  // and wrote only the global path and said "installed" (outside review, 2026-10-02, three
  // rounds); the displacement was found at check time, by doctor or preflight, if at all. It
  // is reported at install time now, and the install still goes through: the gate is machine
  // state, and every other repository gets it (ADR-0131). Not recorded in research/overrides.log
  // from here - the installer is not a check, and doctor records it when it judges the project.
  const local = localHooksPathOverride(cwd, gitPaths);
  const displaced = local ? { cwd, local } : null;
  // The precondition is checked BEFORE the dry run answers. A dry run is the answer an
  // operator trusts INSTEAD of running the thing, so it has to report the refusal the real
  // run would give rather than preview a hooksPath that would never be set (found
  // 2026-10-01, break-test: `--dry-run` printed "would set core.hooksPath=..." and exited 0
  // on a machine with nothing deployed, while the real run exited 1 and set nothing).
  if (!exists(hook)) return { ok: false, dryRun, reason: `${hook} is not deployed - run bin/install.mjs first` };
  // `ok: true` on the preview as well, so the result has one shape whichever way it went and
  // a caller can ask `result.ok` without knowing whether it was a dry run.
  if (dryRun) return { ok: true, dryRun: true, would: dir, previous, displaced };
  if (process.platform !== 'win32') { try { fs.chmodSync(hook, HOOK_MODE); } catch { /* best effort */ } }

  setHooksPath(dir, { scope: 'global', ...gitPaths });
  const state = readInstallState(env) ?? {};
  const base = repoTopLevel({ ...gitPaths, cwd }) ?? cwd;
  const replaced = [state.previousHooksPath, previous].find((p) => handsOnTo(p, { own: dir, base })) ?? null;
  setPreviousHooksPath(replaced, gitPaths);
  writeInstallState({ ...state, kitHome, hooksPath: dir, previousHooksPath: replaced }, env);
  return { ok: true, hooksPath: dir, previous, executable: hookExecutability(hook), displaced };
}

/**
 * Is this a folder the install records as the hand-on (ADR-0112)? Never the kit's own folder:
 * an install over an install would record itself, and the hooks would hand on to themselves.
 * And never another copy of this kit's gate (ADR-0141): doctor tells the operator to unset
 * exactly that record (ADR-0134), and the installer kept it in the install state too, so the
 * next `install-hooks` run - every kit update runs one - wrote it back into git config and the
 * previous implementation's gate blocked commits again, on its outdated checks (the operator's
 * machine, 2026-10-04). The install state and git config now agree once an install has run. A
 * folder that is gone stays recorded: the hooks hand on to nothing there and the uninstall
 * restores it, and an absence at install time may be a drive that is back by the next commit -
 * the installer refuses what it can positively identify, not what it merely fails to find.
 */
function handsOnTo(folder, { own, base }) {
  if (!folder) return false;
  if (path.resolve(folder) === path.resolve(own)) return false;
  return handOnState({ previous: folder, base }).state !== 'kit';
}

/**
 * WHAT the kit's hooks hand on to (ADR-0112): `none` / `missing` / `kit` / `other`.
 *
 * The install records the `core.hooksPath` it replaced, and every hook in githooks/ runs
 * that folder's hook after its own. On the maintainer's machine that folder was the previous
 * implementation's own githooks/ - two gates on every commit, the older one deciding on its
 * own rules, and on 2026-10-03 crashing ("number 0 is not iterable") and failing open after
 * the current gate had allowed. Recognised by the header every version of this kit's
 * pre-commit has carried; a folder with no pre-commit hands nothing on and is nobody's
 * business. Pure, like doctor's `commitGateState`, for the same reason (ADR-0004). It lives
 * here, beside the install that writes the record, because the installer judges with it too
 * (ADR-0141); doctor re-exports it.
 */
export function handOnState({ previous: recorded, base = process.cwd() } = {}) {
  if (!recorded) return { state: 'none' };
  // A relative folder is git's to resolve, from the repository's top level, where it runs its
  // hooks: doctor resolved `.custom-hooks` against its own working directory and from a
  // subdirectory called a working hand-on missing (outside audit, 2026-10-03).
  const previous = path.isAbsolute(recorded) ? recorded : path.resolve(base, recorded);
  if (!isDirectory(previous)) return { state: 'missing', previous };
  const hook = path.join(previous, 'pre-commit');
  const head = (readText(hook, '') ?? '').split('\n').slice(0, 3).join('\n');
  if (/research-kit commit gate/.test(head)) return { state: 'kit', previous, hook };
  return { state: 'other', previous, hook: exists(hook) ? hook : null };
}

export function removeCommitGate({ env = process.env, gitPaths = {}, dryRun = false } = {}) {
  const state = readInstallState(env) ?? {};
  const previous = state.previousHooksPath ?? null;
  // Restored only while core.hooksPath is still the kit's own folder. The kit may never
  // have set it (an install refused for want of a deployed hook), or the operator may have
  // changed it since - either way it is theirs, and "restoring" it deleted it
  // (found 2026-09-27: a machine's /opt/myhooks was unset by an uninstall).
  const current = hooksPath('global', gitPaths);
  if (!state.hooksPath || current !== state.hooksPath) {
    // The preview answers before anything is written, on this branch as on the next: a dry
    // run that UNSET the installed gate was found on 2026-10-03 (outside audit) - `--dry-run`
    // was read after the uninstall had run.
    if (dryRun) return { ok: true, dryRun: true, restored: undefined, left: current ?? null };
    writeInstallState({ ...state, hooksPath: null, previousHooksPath: null }, env);
    return { ok: true, restored: undefined, left: current ?? null };
  }
  if (dryRun) return { ok: true, dryRun: true, restored: previous };
  setHooksPath(previous ?? null, { scope: 'global', ...gitPaths });
  setPreviousHooksPath(null, gitPaths);
  writeInstallState({ ...state, hooksPath: null, previousHooksPath: null }, env);
  return { ok: true, restored: previous };
}

// ---------------------------------------------------------------- the edit-time gate

function readSettings(file) {
  if (!exists(file)) return { state: 'absent', settings: {}, text: '' };
  const text = readText(file, '');
  try {
    const parsed = parseJson(text || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return knownHookShape(parsed)
        ? { state: 'readable', settings: parsed, text }
        : { state: 'unfamiliar', settings: {}, text, error: UNFAMILIAR_SHAPE };
    }
    return { state: 'unfamiliar', settings: {}, text };
  } catch (err) {
    // One known corruption is repairable: a stray line of prose. Anything else is refused.
    const repaired = text.split(/\r?\n/).filter((line) => !/^[A-Za-z][^"{}[\]:,]*;?-?\s*$/.test(line.trim()) || !line.trim()).join('\n');
    try {
      const parsed = parseJson(repaired || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && knownHookShape(parsed)) {
        return { state: 'repairable', settings: parsed, text, repaired, error: err.message };
      }
      return { state: 'unfamiliar', settings: {}, text, error: err.message };
    } catch {
      return { state: 'unfamiliar', settings: {}, text, error: err.message };
    }
  }
}

function hookCommand(kitHome) {
  return `node "${path.join(kitHome, ...EDIT_GATE_HOOK.split('/'))}"`;
}

function entriesOf(settings) {
  const pre = settings?.hooks?.PreToolUse;
  return Array.isArray(pre) ? pre : [];
}

/**
 * Is `hooks.PreToolUse` the shape the installer walks, entry by entry?
 *
 * The settings file belongs to the runtime, not to this kit: a hand edit, a merge, another
 * tool's writer or a truncated sync can leave any node in it a type the walkers below do
 * not expect. `readSettings` only proved the FILE was an object, so `[null]` in
 * `PreToolUse` reached `settingsState` and threw
 *
 *     TypeError: Cannot read properties of null (reading 'hooks')
 *         at installer.mjs:196 in Array.flatMap
 *
 * and `{"hooks": 5}` on one entry threw `(e.hooks ?? []).map is not a function`. Both
 * arrived as a raw stack trace and exit 1 from `install-hooks.mjs`, the command an
 * operator runs precisely because something looks wrong (found 2026-09-30, break-test).
 * `doctor` survived it only because `gateHealth` wraps the call in its own try/catch.
 *
 * REFUSED, not repaired. A shape this module does not walk is a file it must not rewrite:
 * tolerating the bad node and writing `kept` would drop the operator's own entries along
 * with it, which is the silent data loss the `unfamiliar` state already exists to prevent.
 * So the answer is the same one a settings file that does not parse at all gets.
 *
 * An entry with no `hooks` key at all is still the known shape: the walkers read
 * `entry.hooks ?? []` and write `{ ...entry, hooks }`.
 */
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function knownHookShape(settings) {
  if (settings?.hooks !== undefined && !isPlainObject(settings.hooks)) return false;
  const pre = settings?.hooks?.PreToolUse;
  if (pre === undefined) return true;
  if (!Array.isArray(pre)) return false;
  return pre.every((entry) => isPlainObject(entry)
    && (entry.hooks === undefined
      || (Array.isArray(entry.hooks) && entry.hooks.every(isPlainObject))));
}

/** What the installer replaced, so a rename that changes nothing does not stay silent. */
export function retiredRepairNote(removed) {
  if (!removed.length) return '';
  return `replaced ${removed.length} registration(s) left at a retired hook name: ${removed.join(', ')}`;
}

export function installEditGate({ kitHome = KIT_HOME, env = process.env, dryRun = false, mode = '' } = {}) {
  const file = runtimePaths(env).settingsPath;
  const read = readSettings(file);
  if (read.state === 'unfamiliar') {
    return { ok: false, reason: `${file} is in a state the installer does not recognise - refusing to rewrite it`, error: read.error };
  }

  // The hook must exist before anything names it: a registration pointing at a missing
  // file makes every Edit run a hook that crashes (found 2026-09-27, kit not deployed). The
  // commit gate refused in that state; this half registered anyway.
  //
  // The check covers the DRY RUN too (found 2026-10-01, break-test). It used to read
  // `!dryRun && !exists(hook)`, which let `--dry-run` promise a registration the real run
  // would refuse - and a dry run is the answer an operator trusts instead of running it.
  const hook = path.join(kitHome, ...EDIT_GATE_HOOK.split('/'));
  if (!exists(hook)) return { ok: false, dryRun, reason: `${hook} is not deployed - run bin/install.mjs first` };

  const command = hookCommand(kitHome);
  const removed = [];
  const kept = [];
  for (const entry of entriesOf(read.settings)) {
    const hooks = (entry.hooks ?? []).filter((hook) => {
      const text = String(hook.command ?? '');
      if (namesHook(text, EDIT_GATE_HOOK)) { removed.push(EDIT_GATE_HOOK); return false; }
      const retired = RETIRED_EDIT_GATE_HOOKS.find((name) => namesHook(text, name));
      if (retired) { removed.push(retired); return false; }
      return true;
    });
    if (hooks.length) kept.push({ ...entry, hooks });
  }
  kept.push({ matcher: MATCHER, hooks: [{ type: 'command', command }] });

  const next = { ...read.settings, hooks: { ...(read.settings.hooks ?? {}), PreToolUse: kept } };
  if (dryRun) return { ok: true, dryRun: true, file, would: command, removed, repaired: read.state === 'repairable' };

  if (exists(file)) {
    const backup = `${file}.bak-${today()}`;
    if (!exists(backup)) writeText(backup, read.text);
  }
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify(next, null, 2)}\n`);
  if (mode) saveConfig({ editGate: { ...loadConfig(env).editGate, mode } }, env);

  return {
    ok: true,
    file,
    command,
    removed: [...new Set(removed.filter((name) => name !== EDIT_GATE_HOOK))],
    note: retiredRepairNote([...new Set(removed.filter((name) => name !== EDIT_GATE_HOOK))]),
    repairedSettings: read.state === 'repairable',
  };
}

export function removeEditGate({ env = process.env, dryRun = false } = {}) {
  const file = runtimePaths(env).settingsPath;
  const read = readSettings(file);
  if (read.state === 'absent') return { ok: true, file, removed: 0 };
  if (read.state === 'unfamiliar') return { ok: false, reason: `${file} does not parse - refusing to rewrite it` };

  let removed = 0;
  const kept = [];
  for (const entry of entriesOf(read.settings)) {
    const hooks = (entry.hooks ?? []).filter((hook) => {
      const text = String(hook.command ?? '');
      const ours = namesHook(text, EDIT_GATE_HOOK) || RETIRED_EDIT_GATE_HOOKS.some((name) => namesHook(text, name));
      if (ours) removed += 1;
      return !ours;
    });
    if (hooks.length) kept.push({ ...entry, hooks });
  }
  // Containers the kit's entry leaves empty go too, and a file with nothing left is removed:
  // --uninstall on a machine that had no settings file left {"hooks": {"PreToolUse": []}}
  // behind (found 2026-09-27). An empty settings file and none behave the same.
  if (dryRun) return { ok: true, dryRun: true, file, removed };
  const hooks = { ...(read.settings.hooks ?? {}), PreToolUse: kept };
  if (!kept.length) delete hooks.PreToolUse;
  const next = { ...read.settings, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;
  if (!Object.keys(next).length) {
    fs.rmSync(file, { force: true });
    return { ok: true, file, removed, deleted: true };
  }
  writeText(file, `${JSON.stringify(next, null, 2)}\n`);
  return { ok: true, file, removed };
}

/**
 * `current` / `foreign` / `dangling` / `retired` / `unfamiliar` / `none`.
 *
 * Matching the hook's NAME is not enough. This machine had a registration reading
 *
 *     node "C:/Users/PC/Desktop/FreeBuff/Deep-Research-Agent-main/research-kit/hooks/edit-gate.mjs"
 *
 * which names `hooks/edit-gate.mjs` and so read as `current` - while the gate that
 * actually ran belonged to a different checkout of a different implementation, one whose
 * commit gate crashed. ADR-0012 sec 4 says no registration may point at a hook file that
 * no longer exists, "a gate that silently gates nothing"; pointing at a hook that exists
 * but is not the deployed kit's is the same failure wearing a working file.
 *
 *   foreign  - our hook name, somebody else's tree
 *   dangling - our hook name, and nothing on disk there
 */
export function settingsState({ env = process.env, kitHome = KIT_HOME } = {}) {
  const file = runtimePaths(env).settingsPath;
  const read = readSettings(file);
  if (read.state === 'absent') return 'none';
  if (read.state === 'unfamiliar') return 'unfamiliar';

  const commands = entriesOf(read.settings).flatMap((e) => (e.hooks ?? []).map((h) => String(h.command ?? '')));
  const ours = commands.filter((c) => namesHook(c, EDIT_GATE_HOOK));

  if (ours.length) {
    const expected = path.join(kitHome, ...EDIT_GATE_HOOK.split('/'));
    if (ours.some((c) => namesHook(c, expected))) return 'current';
    const target = ours.map(registeredPath).find(Boolean);
    return target && exists(target) ? 'foreign' : 'dangling';
  }
  if (commands.some((c) => RETIRED_EDIT_GATE_HOOKS.some((name) => namesHook(c, name)))) return 'retired';
  return 'none';
}

/** The path inside a registered command, whether or not it is quoted. */
export function registeredPath(command) {
  const quoted = String(command).match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  const bare = String(command).match(/(\S*edit-gate\.mjs)/);
  return bare ? bare[1] : '';
}

// ---------------------------------------------------------------- deploy

/**
 * Every file under `root`, relative and POSIX-spelled.
 *
 * Both reads are guarded, and both guards are for a shape that exists on real machines:
 * `readdirSync` on a path that is a FILE (ENOTDIR - a leftover `research-kit` tarball, an
 * env var pointing at the wrong thing) and `statSync` on an entry that vanished or
 * dangles (ENOENT - a symlink whose target moved, a file deleted between the readdir and
 * the stat). `doctor` is the command an operator runs when something looks broken, so it
 * must name a problem rather than become one; `deployedDrift` reaching it with
 * `RESEARCH_KIT_HOME` naming a regular file printed a raw ENOTDIR stack trace instead
 * (found 2026-09-29, break-test).
 */
function listTree(root, { limit = Infinity } = {}) {
  const out = [];
  // Each real folder once: a link back to an ancestor otherwise re-lists the tree on every
  // lap until ELOOP ends it, ~40 copies of each file (found 2026-09-29, break-test).
  const seen = new Set();
  const walk = (dir) => {
    let real;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }        // a file, a refusal, a vanished folder
    for (const name of names) {
      if (out.length >= limit) return;                            // the caller asked for a few
      if (name === 'node_modules' || name === '.git' || name === '__pycache__') continue;
      const abs = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(abs); } catch { continue; }        // a dangling symlink, or a race
      if (stat.isDirectory()) { walk(abs); continue; }
      out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  if (isDirectory(root)) walk(root);
  return out;
}

/**
 * A deploy MIRRORS; it does not merge.
 *
 * `RETIRED_KIT_FILES` was a hand-maintained list of paths the kit used to ship, and it
 * only ever names what somebody remembered to add. Deploying a 26-module kit over a
 * 34-module one left 27 files from the previous implementation sitting in the deployed
 * tree - old modules, an old entrypoint, twelve old test files and five recipes that no
 * longer exist in any source. `decompose --recipes` listed ten recipes, half of them
 * from a kit that was replaced.
 *
 * The deployed tree is meant to BE the kit. So anything the source does not ship is
 * removed, and the list is reported rather than silent - a stale deployed copy silently
 * defeats an update, which is the whole reason ADR-0012 asked for pruning at all.
 */
function copyTree(from, to, { prune = [], mirror = false } = {}) {
  const written = [];
  const before = mirror ? new Set(listTree(to)) : new Set();

  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = path.relative(from, abs);
      // `__pycache__` is CPython's byproduct of the conformance runners the suite spawns: not the
      // kit, hidden from git by .gitignore, and until 2026-10-04 deployed anyway, after which
      // `deployedDrift` counted it as a stale file on every machine that ran the suite (break-test
      // pass 4, F1). Skipped in both walks, so neither the mirror nor the drift report sees it.
      if (rel.split(path.sep)[0] === 'node_modules' || name === '.git' || name === '__pycache__') continue;
      if (fs.statSync(abs).isDirectory()) { walk(abs); continue; }
      const target = path.join(to, rel);
      ensureDir(path.dirname(target));
      // The deployer's copy must stay writable. Earlier output can be read-only even when
      // the incoming source is writable; restore write access before copyFileSync opens it.
      // Windows chmod changes write permission only (E-04/E-05 in the break-test corpus).
      const mode = fs.statSync(abs).mode & 0o777;
      if (fs.existsSync(target)) {
        const dest = fs.statSync(target);
        if (dest.isFile() && (dest.mode & 0o200) === 0) fs.chmodSync(target, (dest.mode & 0o777) | 0o200);
      }
      fs.copyFileSync(abs, target);
      // Normalize explicitly: source-mode propagation is measured, not an API guarantee.
      // Preserve ordinary POSIX permission/execute bits and make Windows output writable.
      fs.chmodSync(target, mode | 0o200);
      if (process.platform !== 'win32' && rel.split(path.sep)[0] === 'githooks') fs.chmodSync(target, HOOK_MODE);
      written.push(rel.split(path.sep).join('/'));
    }
  };
  walk(from);

  const pruned = [];
  for (const rel of prune) {
    const target = path.join(to, ...rel.split('/'));
    if (!exists(target)) continue;
    fs.rmSync(target, { force: true });
    pruned.push(rel);
  }

  if (mirror) {
    const shipped = new Set(written);
    for (const rel of before) {
      if (shipped.has(rel) || pruned.includes(rel)) continue;
      fs.rmSync(path.join(to, ...rel.split('/')), { force: true });
      pruned.push(rel);
    }
    // Directories the pruning emptied are removed too, deepest first.
    for (const dir of [...new Set(pruned.map((rel) => path.dirname(rel)))].filter((d) => d !== '.').sort((a, b) => b.length - a.length)) {
      const abs = path.join(to, ...dir.split('/'));
      try { if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs); } catch { /* not empty, or gone */ }
    }
  }

  return { written, pruned };
}

/** Where the kit keeps its skill set (ADR-0146): one directory per skill, beside `skill/`. */
export const SKILL_SET_DIR = 'skills';

/**
 * The skill set's names: each directory under `skills/` that holds a SKILL.md, sorted. A
 * directory without one is not a skill, and a runtime would not discover it either.
 */
export function shippedSkills(from = KIT_ROOT) {
  const dir = path.join(from, SKILL_SET_DIR);
  if (!isDirectory(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => isDirectory(path.join(dir, name)) && exists(path.join(dir, name, 'SKILL.md')))
    .sort();
}

/**
 * Whether a set skill's target folder may be written: it is absent, or its SKILL.md is,
 * byte for byte, the one the kit last deployed there (`skillSetHashes` in the install state)
 * or the one it would deploy now. Any other folder is somebody else's skill that happens to
 * share a name - `brainstorming` is a common one - and the deploy had overwritten its
 * SKILL.md and left its other files mixed with the kit's (found 2026-10-06, review). Such a
 * folder is left as it is and reported.
 *
 * The content decides, never the path alone: a recorded path outlives the kit's copy, and a
 * user who replaced it had his skill overwritten through the record (second review, same
 * day). The hashes accumulate across deploys, so the kit's copy in a project bound earlier is
 * still recognised after an update changed the source.
 */
function setSkillIsKits(target, src, hashes) {
  if (!exists(target)) return true;
  const mine = path.join(target, 'SKILL.md');
  if (!isDirectory(target) || !exists(mine)) return false;
  const current = sha256File(mine);
  return current === hashes[path.resolve(target)] || current === sha256File(path.join(src, 'SKILL.md'));
}

/** The SKILL.md hash the kit last deployed at each set-skill path, from the install state. */
function recordedSetSkills(env) {
  const recorded = (readInstallState(env) ?? {}).skillSetHashes;
  if (!recorded || typeof recorded !== 'object' || Array.isArray(recorded)) return {};
  return Object.fromEntries(Object.entries(recorded).filter(([, h]) => typeof h === 'string'));
}

/**
 * The set-skill targets a deploy would write, split into the kit's and somebody else's.
 * `into` adds the project skill directory beside the bound research-first skill.
 */
function setSkillTargets({ from, env, into }) {
  const set = shippedSkills(from);
  const recorded = recordedSetSkills(env);
  const roots = exists(path.join(from, 'skill')) ? [...skillRoots(env)] : [];
  const projectDir = into ? path.join(into, ...runtimePaths(env).projectSkillDir.split('/')) : '';
  const targets = [];
  for (const root of roots) for (const name of set) targets.push({ name, target: path.join(root, name), bound: false });
  if (projectDir) for (const name of set) targets.push({ name, target: path.join(projectDir, name), bound: true });
  const write = [];
  const conflicts = [];
  for (const t of targets) {
    (setSkillIsKits(t.target, path.join(from, SKILL_SET_DIR, t.name), recorded) ? write : conflicts).push(t);
  }
  return { set, write, conflicts: conflicts.map((t) => t.target) };
}

/**
 * What is deployed, against what would be deployed now.
 *
 * `doctor` used to report `deploy` from the install STATE alone - "an install was recorded,
 * on this date" - and print READY over it. Recorded is not current. Measured on this
 * repository on 2026-09-22, that check passed while the deployed kit was missing **eighteen
 * lib modules**, `bin/prior.mjs` among them, and the deployed skill still described a
 * protocol without the step shipped that morning.
 *
 * That is the worst shape a health check can take: green, specific, and about the wrong
 * question. An agent invoking the skill runs the DEPLOYED copy, so a stale deployment means
 * every fix since the last install exists only in the repository - which is exactly the
 * failure the operator's standing rule is about, one level further out than usual, because
 * here the shipped path is the deployment itself.
 *
 * `deploy` is a full mirror (see `copyTree`), so drift is not a heuristic: every file under
 * the source tree should be present at the destination with the same bytes, and nothing
 * else should be there. Reported, never repaired - `doctor` diagnoses and `install.mjs`
 * acts, and a health check that quietly rewrote the thing it was measuring would destroy
 * the evidence of the problem it found.
 */
export function deployedDrift({ from = KIT_ROOT, kitHome = KIT_HOME, env = process.env } = {}) {
  const compare = (src, dest) => {
    const missing = [];
    const changed = [];
    for (const rel of listTree(src)) {
      const target = path.join(dest, ...rel.split('/'));
      if (!exists(target)) { missing.push(rel); continue; }
      if (sha256File(path.join(src, ...rel.split('/'))) !== sha256File(target)) changed.push(rel);
    }
    const shipped = new Set(listTree(src));
    const extra = listTree(dest).filter((rel) => !shipped.has(rel) && !RETIRED_KIT_FILES.includes(rel));
    return { missing, changed, extra };
  };

  // `isDirectory`, not `exists`: a FILE at kitHome is not a deployment, and `exists` is
  // true for one - which sent `listTree` into `readdirSync` on a regular file and took
  // `doctor` down with an ENOTDIR stack trace. Absent means "not deployed here", which is
  // what the operator is told and what `install.mjs` fixes.
  const kit = isDirectory(kitHome) ? compare(from, kitHome) : { missing: listTree(from), changed: [], extra: [], absent: true };
  const skillSource = path.join(from, 'skill');
  const skills = exists(skillSource)
    ? skillLocations(env).filter((l) => isDirectory(l)).map((location) => ({ location, ...compare(skillSource, location) }))
    : [];
  // The skill set (ADR-0146) drifts per skill. A root that holds research-first is a root the
  // kit deploys to, so a set skill absent there is missing - an install from before the set.
  // A folder of the same name that is not the kit's is somebody else's skill: not drift.
  const recorded = recordedSetSkills(env);
  for (const root of skillRoots(env)) {
    if (!isDirectory(path.join(root, SKILL_NAME))) continue;
    for (const name of shippedSkills(from)) {
      const location = path.join(root, name);
      const src = path.join(from, SKILL_SET_DIR, name);
      if (!setSkillIsKits(location, src, recorded)) continue;
      // `set`: the kit mirrors a set skill, so a file it no longer ships is drift (orphaned);
      // research-first is copied over, and its extras are not counted.
      skills.push(isDirectory(location)
        ? { location, set: true, ...compare(src, location) }
        : { location, set: true, missing: listTree(src), changed: [], extra: [] });
    }
  }

  const total = (d) => d.missing.length + d.changed.length + d.extra.length;
  return {
    kitHome,
    kit,
    skills,
    drifted: total(kit) + skills.reduce((n, s) => n + s.missing.length + s.changed.length + (s.set ? s.extra.length : 0), 0),
  };
}

/** One line naming what drifted and what to run, or '' when the deployment matches. */
export function driftNote(drift) {
  if (!drift.drifted) return '';
  const parts = [];
  const say = (n, word) => (n ? `${n} ${word}` : '');
  const kit = [say(drift.kit.missing.length, 'missing'), say(drift.kit.changed.length, 'stale'), say(drift.kit.extra.length, 'orphaned')].filter(Boolean);
  if (kit.length) parts.push(`kit: ${kit.join(', ')}`);
  for (const s of drift.skills) {
    const bits = [say(s.missing.length, 'missing'), say(s.changed.length, 'stale'), say(s.set ? s.extra.length : 0, 'orphaned')].filter(Boolean);
    if (bits.length) parts.push(`skill ${s.location}: ${bits.join(', ')}`);
  }
  const sample = [...drift.kit.missing, ...drift.kit.changed].slice(0, 3);
  return `${parts.join('; ')}${sample.length ? ` (e.g. ${sample.join(', ')})` : ''}`;
}

/**
 * Files every kit version has shipped, since the repository's first commit: a folder holding all
 * three is a deployment of some kit. One was not enough - a project of somebody's own with a
 * `lib/core.mjs` was taken for a kit, and its other files were pruned (found 2026-10-01).
 */
const KIT_MARKERS = Object.freeze(['lib/core.mjs', 'bin/gate.mjs', 'bin/preflight.mjs']);

/**
 * Why `kitHome` may not be mirrored into, or null when it may (ADR-0111).
 *
 * The mirror removes every file the kit does not ship, and it asked nothing of the folder
 * first: RESEARCH_KIT_HOME naming a folder of somebody's own files - a typo, a parent folder, a
 * shared tools directory - had them deleted and reported as "retired" (found 2026-10-01,
 * break-test). A folder may be mirrored into when it holds nothing, when it holds a kit, or when
 * the install state says the kit was deployed there.
 */
function mirrorRefusal(kitHome, env) {
  const isFile = (rel) => { try { return fs.statSync(path.join(kitHome, ...rel.split('/'))).isFile(); } catch { return false; } };
  if (KIT_MARKERS.every(isFile)) return null;
  const recorded = readInstallState(env)?.kitHome;
  if (typeof recorded === 'string' && path.resolve(recorded) === path.resolve(kitHome)) return null;
  // A few files are all the refusal names. Listing every one to count them took 1.6 s for /usr
  // (77,000 files), and a home directory holds millions (found 2026-10-01).
  const present = listTree(kitHome, { limit: 4 });
  if (present.length === 0) return null;
  const sample = present.slice(0, 3).join(', ');
  return `${kitHome} is not a kit deployment - it holds files the kit does not ship (${sample}${present.length > 3 ? ', ...' : ''}), `
    + 'and a deploy mirrors, removing every file it does not ship. Nothing was changed. '
    + 'Point RESEARCH_KIT_HOME at an empty or new folder, or unset it to use the default.';
}

/**
 * Copy the kit to `~/.agents/research-kit` and the skill to the personal root(s).
 * Overwrites by default - a stale deployed copy silently defeats an update - and prunes
 * kit files a past version shipped, because a copy-over deploy never removes anything.
 * Refuses, touching nothing, a folder that is not a kit deployment (`mirrorRefusal`).
 */
export function deploy({ from = KIT_ROOT, kitHome = KIT_HOME, env = process.env, dryRun = false, into = '' } = {}) {
  // ADR-0006: a typo in --into must refuse before the kit mirror, personal skills or
  // installation state are written. The preview judges the same project as the deploy.
  // .git may be a file (a worktree); AGENTS.md is a file and research/ is a directory.
  const projectFile = (name) => { try { return fs.statSync(path.join(into, name)).isFile(); } catch { return false; } };
  if (into && (!isDirectory(into) || !(isDirectory(path.join(into, '.git')) || projectFile('.git')
    || projectFile('AGENTS.md') || isDirectory(path.join(into, 'research'))))) {
    return {
      ok: false, dryRun, from, to: kitHome,
      refused: `${into} is not a project - --into needs a directory containing .git, AGENTS.md, or research/. No deployment files were changed.`,
    };
  }
  const refused = mirrorRefusal(kitHome, env);
  if (refused) return { ok: false, dryRun, from, to: kitHome, refused };
  // What the deploy below would prune, computed the same way: retired files that are there, and
  // the mirror's extras. It listed every retired name whether or not it existed, and none of the
  // extras (2026-09-29, Arena break test: "would prune" three files on a machine never installed).
  if (dryRun) {
    const shipped = new Set(listTree(from));
    const retired = RETIRED_KIT_FILES.filter((rel) => exists(path.join(kitHome, ...rel.split('/'))));
    const extra = listTree(kitHome).filter((rel) => !shipped.has(rel) && !retired.includes(rel));
    return { dryRun: true, from, to: kitHome, prune: [...retired, ...extra], skillConflicts: setSkillTargets({ from, env, into }).conflicts };
  }

  const copied = copyTree(from, kitHome, { prune: RETIRED_KIT_FILES, mirror: true });
  const skills = [];
  const skillSource = path.join(from, 'skill');
  // Decided before anything is written, from the state as it was: a set skill goes only where
  // the folder is absent or already the kit's; a same-named folder of somebody else's is left.
  const { set, write, conflicts } = setSkillTargets({ from, env, into });
  if (exists(skillSource)) {
    for (const target of skillLocations(env)) {
      copyTree(skillSource, target);
      skills.push(target);
    }
  }
  // Each set skill is a sibling of research-first under the root, never inside it: a runtime
  // discovers subdirectories of a skills root that hold SKILL.md (ADR-0146).
  // Mirrored: the folder is the kit's (`setSkillTargets`), so a reference or script a later kit
  // no longer ships is removed rather than left to steer the skill (ADR-0146 decision 5).
  for (const t of write.filter((w) => !w.bound)) {
    copyTree(path.join(from, SKILL_SET_DIR, t.name), t.target, { mirror: true });
    skills.push(t.target);
  }

  let bound = '';
  const boundSet = [];
  if (into) {
    const projectDir = path.join(into, ...runtimePaths(env).projectSkillDir.split('/'));
    const dir = path.join(projectDir, SKILL_NAME);
    copyTree(skillSource, dir);
    bound = dir;
    for (const t of write.filter((w) => w.bound)) {
      copyTree(path.join(from, SKILL_SET_DIR, t.name), t.target, { mirror: true });
      boundSet.push(t.target);
    }
  }

  const skillSetHashes = recordedSetSkills(env);
  for (const t of write) skillSetHashes[path.resolve(t.target)] = sha256File(path.join(t.target, 'SKILL.md'));
  const state = readInstallState(env) ?? {};
  writeInstallState({ ...state, kitHome, deployedFrom: from, skills, bound, boundSet, skillSetHashes }, env);
  return { ok: true, from, to: kitHome, files: copied.written.length, pruned: copied.pruned, skills, bound, boundSet, skillSet: set, skillConflicts: conflicts };
}

export function uninstall({ env = process.env, gitPaths = {}, dryRun = false } = {}) {
  const commit = removeCommitGate({ env, gitPaths, dryRun });
  const edit = removeEditGate({ env, dryRun });
  return { commit, edit, dryRun };
}

export { ROLES, readJson };
