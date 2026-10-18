// ADR-0006: --into binds only a project, and refusal precedes every deployment write.
import { spawnSync } from 'node:child_process';
import { test, describe, assert, tempDir, fs, path, KIT_ROOT } from './harness.mjs';
import { writeText } from '../lib/core.mjs';
import { deploy } from '../lib/installer.mjs';

describe('installer project guard');

function fixture() {
  const home = tempDir('rk-project-guard-');
  const from = path.join(home, 'source');
  const kitHome = path.join(home, 'deployed-kit');
  const personal = path.join(home, 'personal-skills');
  const into = path.join(home, 'unrelated-folder');
  const state = path.join(home, 'install-state.json');
  const config = path.join(home, 'config.json');
  writeText(path.join(from, 'README.md'), '# new kit\n');
  writeText(path.join(from, 'bin', 'selftest.mjs'), '// fixture runner\n');
  writeText(path.join(from, 'skill', 'SKILL.md'), '# new research-first\n');
  // The files every kit ships (ADR-0111), so a deployment of this source is a kit folder.
  for (const rel of ['lib/core.mjs', 'bin/gate.mjs', 'bin/preflight.mjs']) writeText(path.join(from, ...rel.split('/')), '// fixture kit\n');
  writeText(path.join(kitHome, 'README.md'), '# old kit\n');
  writeText(path.join(kitHome, 'bin', 'gate.mjs'), '// old kit\n');
  writeText(path.join(kitHome, 'orphan.txt'), 'must not be pruned on refusal\n');
  writeText(path.join(personal, 'research-first', 'SKILL.md'), '# old personal skill\n');
  writeText(path.join(into, 'notes.txt'), 'unrelated folder\n');
  // A recorded deployment that still holds a kit file permits mirroring (ADR-0111, #327): an
  // unrelated kit-home refusal must not accidentally hide the missing project guard.
  writeText(state, JSON.stringify({ kitHome, skills: [], bound: '' }) + '\n');
  writeText(config, JSON.stringify({ skillRoots: [personal] }) + '\n');
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, APPDATA: home,
    RESEARCH_KIT_HOME: kitHome, RESEARCH_KIT_CONFIG: config, RESEARCH_KIT_INSTALL_STATE: state,
  };
  return { from, kitHome, personal, into, state, home, env };
}

function tree(file) {
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).isFile()) return fs.readFileSync(file).toString('hex');
  return Object.fromEntries(fs.readdirSync(file).sort().map((name) => [name, tree(path.join(file, name))]));
}

function deploymentState(f) {
  // Config reads have their own last-good snapshot policy; this assertion concerns
  // the kit, personal/project skills and installation state owned by deployment.
  return { kit: tree(f.kitHome), personal: tree(f.personal), project: tree(f.into), state: tree(f.state) };
}

for (const dryRun of [false, true]) {
  test(`${dryRun ? 'preview' : 'deploy'} refuses an unrelated project before copying, pruning or recording`, () => {
    const f = fixture();
    const before = deploymentState(f);
    const result = deploy({ ...f, dryRun });
    assert.equal(result.ok, false, 'a folder without a project marker was accepted');
    assert.equal(result.dryRun, dryRun);
    assert.match(result.refused, /not a project/);
    assert.ok(result.refused.includes(f.into), 'the refusal did not name the project path');
    assert.deepEqual(deploymentState(f), before, 'refusal changed deployment or project state');
  });

  test(`install ${dryRun ? '--dry-run ' : ''}--into reports refusal with exit 2 and leaves deployments intact`, () => {
    const f = fixture();
    const before = deploymentState(f);
    const args = [path.join(KIT_ROOT, 'bin', 'install.mjs'), '--into', f.into];
    if (dryRun) args.push('--dry-run');
    const result = spawnSync(process.execPath, args, {
      cwd: f.home, env: f.env, encoding: 'utf8', timeout: 30_000, windowsHide: true,
    });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /install: refused/);
    assert.match(result.stderr, /not a project/);
    assert.ok(result.stderr.includes(f.into), 'the CLI refusal did not name the project path');
    assert.doesNotMatch(result.stdout, /(?:would deploy|deployed \d+ files)/);
    assert.deepEqual(deploymentState(f), before, 'CLI refusal changed deployment or project state');
  });
}

test('missing, file and malformed-marker project paths are refused on the real run and preview', () => {
  for (const kind of ['missing', 'file', 'agents-directory', 'research-file']) {
    for (const dryRun of [false, true]) {
      const f = fixture();
      f.into = path.join(f.home, `project-${kind}`);
      if (kind === 'file') writeText(f.into, 'a file is not a project directory\n');
      if (kind === 'agents-directory') fs.mkdirSync(path.join(f.into, 'AGENTS.md'), { recursive: true });
      if (kind === 'research-file') writeText(path.join(f.into, 'research'), 'a file is not a research directory\n');
      const before = deploymentState(f);
      const result = deploy({ ...f, dryRun });
      assert.equal(result.ok, false, `${kind} target was accepted`);
      assert.match(result.refused, /not a project/);
      assert.deepEqual(deploymentState(f), before);
    }
  }
});

test('each ADR-0006 marker permits binding, including a .git file, and no --into still deploys', () => {
  for (const marker of ['git-directory', 'git-file', 'agents', 'research', 'none']) {
    const f = fixture();
    if (marker === 'git-directory') fs.mkdirSync(path.join(f.into, '.git'));
    if (marker === 'git-file') {
      fs.mkdirSync(path.join(f.home, 'git-metadata'));
      writeText(path.join(f.into, '.git'), 'gitdir: ../git-metadata\n');
    }
    if (marker === 'agents') writeText(path.join(f.into, 'AGENTS.md'), '# project\n');
    if (marker === 'research') fs.mkdirSync(path.join(f.into, 'research'));
    if (marker === 'none') f.into = '';
    const preview = deploy({ ...f, dryRun: true });
    assert.equal(preview.refused, undefined, `${marker} was refused by the preview`);
    const result = deploy(f);
    assert.equal(result.ok, true, `${marker} was refused by the deploy`);
    assert.equal(fs.readFileSync(path.join(f.kitHome, 'README.md'), 'utf8'), '# new kit\n');
    assert.equal(fs.existsSync(path.join(f.kitHome, 'orphan.txt')), false, 'valid deployment no longer mirrors');
    assert.equal(fs.readFileSync(path.join(f.personal, 'research-first', 'SKILL.md'), 'utf8'), '# new research-first\n');
    if (marker === 'none') assert.equal(result.bound, '');
    else {
      assert.equal(result.bound, path.join(f.into, '.claude', 'skills', 'research-first'));
      assert.equal(fs.readFileSync(path.join(result.bound, 'SKILL.md'), 'utf8'), '# new research-first\n');
    }
  }
});

// #328: ADR-0006 says re-running install.mjs updates every bound copy. A plain re-run updated the
// personal root only, and the install state remembered one bound project - the last.
const bound = (project, name = 'research-first') => path.join(project, '.claude', 'skills', name);
const readSkill = (project, name) => fs.readFileSync(path.join(bound(project, name), 'SKILL.md'), 'utf8');
function projectsIn(f, names) {
  return names.map((name) => {
    const dir = path.join(f.home, `project-${name}`);
    writeText(path.join(dir, 'AGENTS.md'), '# a project\n');
    return dir;
  });
}

test('a plain reinstall refreshes every bound project and leaves the copies a project edited', () => {
  const f = fixture();
  writeText(path.join(f.from, 'skills', 'demo', 'SKILL.md'), '# demo v1\n');
  const [one, two, edited, unbound, gone] = projectsIn(f, ['one', 'two', 'edited', 'unbound', 'gone']);
  const drive = path.join(f.home, 'drive');
  const offline = path.join(drive, 'project-offline');
  writeText(path.join(offline, 'AGENTS.md'), '# a project on a drive\n');
  const recorded = () => JSON.parse(fs.readFileSync(f.state, 'utf8'));
  for (const into of [one, two, edited, unbound, gone, offline]) assert.equal(deploy({ ...f, into }).ok, true);
  assert.deepEqual(recorded().boundProjects, [one, two, edited, unbound, gone, offline].map((p) => bound(p)), 'the state forgot all but the last bound project');
  assert.equal(recorded().bound, bound(offline), '`bound` is no longer the last-bound path an older kit reads');

  // The kit moves on. Project two edited its copy of a set skill and "edited" its research-first;
  // "unbound" removed its skill folder by hand; "gone" was deleted from a folder that is still
  // there; "offline" sits on a drive that is not there at all - unmounted, or a share offline.
  writeText(path.join(f.from, 'skill', 'SKILL.md'), '# research-first v2\n');
  writeText(path.join(f.from, 'skills', 'demo', 'SKILL.md'), '# demo v2\n');
  writeText(path.join(bound(two, 'demo'), 'SKILL.md'), '# demo, as project two wrote it\n');
  writeText(path.join(bound(edited), 'SKILL.md'), '# research-first, as this project wrote it\n');
  fs.rmSync(bound(unbound), { recursive: true, force: true });
  fs.rmSync(gone, { recursive: true, force: true });
  fs.rmSync(drive, { recursive: true, force: true });

  const preview = deploy({ ...f, into: '', dryRun: true });
  assert.deepEqual(preview.refresh, [bound(one), bound(two)], 'the preview would refresh a copy the project edited');
  assert.deepEqual(preview.dropped, [bound(unbound), bound(gone)]);
  assert.deepEqual(preview.skipped.map((s) => s.dir), [bound(offline)]);
  for (const left of [bound(two, 'demo'), bound(edited)]) assert.ok(preview.skillConflicts.includes(left), `the preview did not name ${left}`);

  const result = deploy({ ...f, into: '' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.refreshed, [bound(one), bound(two)]);
  assert.deepEqual(result.dropped, [bound(unbound), bound(gone)], 'a project removed from disk was not dropped (#328)');
  assert.deepEqual(result.skipped.map((s) => s.dir), [bound(offline)]);
  assert.match(result.skipped[0].why, /not reachable/);
  assert.deepEqual(result.failed, []);
  for (const project of [one, two]) assert.equal(readSkill(project, 'research-first'), '# research-first v2\n', `${project} was not refreshed`);
  assert.equal(readSkill(edited, 'research-first'), '# research-first, as this project wrote it\n', 'a research-first the project edited was overwritten');
  assert.equal(readSkill(one, 'demo'), '# demo v2\n');
  assert.equal(readSkill(two, 'demo'), '# demo, as project two wrote it\n', 'a set skill the project edited was overwritten');
  for (const left of [bound(two, 'demo'), bound(edited)]) assert.ok(result.skillConflicts.includes(left));
  assert.equal(fs.existsSync(gone), false, 'a project that is not there was written again');
  assert.equal(fs.existsSync(drive), false, 'a drive that is not there was written to');
  assert.equal(fs.existsSync(bound(unbound)), false, 'a project unbound by hand was bound again');
  assert.deepEqual(recorded().boundProjects, [one, two, edited, offline].map((p) => bound(p)), 'a dropped project was kept, or one it could not reach was dropped');
  assert.equal(recorded().bound, bound(offline));

  // An explicit --into still replaces the copy the project edited: the operator asked for it.
  assert.equal(deploy({ ...f, into: edited }).ok, true);
  assert.equal(readSkill(edited, 'research-first'), '# research-first v2\n');
  assert.equal(recorded().bound, bound(edited));

  // The CLI says what it refreshed, dropped and skipped (it deploys this repository's kit).
  fs.rmSync(bound(two), { recursive: true, force: true });
  const cli = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'install.mjs')], {
    cwd: f.home, env: f.env, encoding: 'utf8', timeout: 60_000, windowsHide: true,
  });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  assert.ok(cli.stdout.includes(`refreshed bound project -> ${bound(one)}`), cli.stdout);
  assert.ok(cli.stdout.includes(`dropped ${bound(two)} from the bound projects`), cli.stdout);
  assert.ok(cli.stderr.includes(`skipped bound project ${bound(offline)}`), cli.stderr);
});

// A bound project that cannot be written - a read-only mount, a locked file - threw out of every
// later install, `--into` another project included, after the kit and the personal skills had been
// rewritten and before the state was.
test('a bound project that cannot be written is reported, and the deploy and the state go on', () => {
  const f = fixture();
  writeText(path.join(f.from, 'skill', 'references', 'guide.md'), '# guide v1\n');
  const [stuck, other, later] = projectsIn(f, ['stuck', 'other', 'later']);
  for (const into of [stuck, other]) assert.equal(deploy({ ...f, into }).ok, true);
  writeText(path.join(f.from, 'skill', 'SKILL.md'), '# research-first v2\n');
  writeText(path.join(f.from, 'skill', 'references', 'guide.md'), '# guide v2\n');
  // A folder where the kit writes a file: refused on every platform, as a locked file is.
  fs.rmSync(path.join(bound(stuck), 'references', 'guide.md'));
  fs.mkdirSync(path.join(bound(stuck), 'references', 'guide.md'));

  for (const into of ['', later]) {
    const result = deploy({ ...f, into });
    assert.equal(result.ok, true, `into=${into || '(none)'}: a project that cannot be written stopped the deploy`);
    assert.deepEqual(result.failed.map((x) => x.dir), [bound(stuck)]);
    assert.ok(result.failed[0].why, 'the failure does not say why');
    assert.ok(result.refreshed.includes(bound(other)), 'the project after it was not refreshed');
    assert.equal(readSkill(other, 'research-first'), '# research-first v2\n');
    assert.equal(fs.readFileSync(path.join(f.personal, 'research-first', 'SKILL.md'), 'utf8'), '# research-first v2\n');
    const state = JSON.parse(fs.readFileSync(f.state, 'utf8'));
    assert.ok(state.boundProjects.includes(bound(stuck)), 'a project that could not be written was dropped from the record');
    if (into) assert.equal(state.bound, bound(later), 'the state was not written after the failure');
  }
  assert.equal(readSkill(later, 'research-first'), '# research-first v2\n', '--into a new project did not bind it');
});

// A bound copy whose SKILL.md cannot be READ was reported as one the project edited, with `install
// --into that project` as the remedy - which then failed on the same file. It is a failure, with why.
test('a bound copy the kit cannot read is reported as failed with the reason, not as edited', () => {
  const f = fixture();
  const [unreadable, other] = projectsIn(f, ['unreadable', 'other']);
  for (const into of [unreadable, other]) assert.equal(deploy({ ...f, into }).ok, true);
  writeText(path.join(f.from, 'skill', 'SKILL.md'), '# research-first v2\n');
  // A folder where SKILL.md was: unreadable as a file on every platform, as a locked one is.
  fs.rmSync(path.join(bound(unreadable), 'SKILL.md'));
  fs.mkdirSync(path.join(bound(unreadable), 'SKILL.md'));
  for (const dryRun of [true, false]) {
    const result = deploy({ ...f, into: '', dryRun });
    assert.deepEqual(result.failed.map((x) => x.dir), [bound(unreadable)], `dryRun=${dryRun}`);
    assert.match(result.failed[0].why, /not a file/);
    assert.equal(result.skillConflicts.includes(bound(unreadable)), false, 'an unreadable copy was reported as an edit');
  }
  assert.equal(readSkill(other, 'research-first'), '# research-first v2\n');
  assert.ok(JSON.parse(fs.readFileSync(f.state, 'utf8')).boundProjects.includes(bound(unreadable)));
});

// An explicit --into a project that cannot be written still throws - after the personal set skills
// were written, and before their hashes reached the state, so from the next kit update on they read
// as copies the operator edited and were never updated again.
test('an --into that throws still records the hashes of what the deploy wrote before it', () => {
  const f = fixture();
  const demo = path.join(f.personal, 'demo', 'SKILL.md');
  writeText(path.join(f.from, 'skills', 'demo', 'SKILL.md'), '# demo v1\n');
  assert.equal(deploy({ ...f, into: '' }).ok, true);
  const [stuck] = projectsIn(f, ['stuck']);
  fs.mkdirSync(path.join(bound(stuck), 'SKILL.md'), { recursive: true });
  writeText(path.join(f.from, 'skills', 'demo', 'SKILL.md'), '# demo v2\n');
  assert.throws(() => deploy({ ...f, into: stuck }), 'an --into that could not be written was reported done');
  assert.equal(fs.readFileSync(demo, 'utf8'), '# demo v2\n');
  const state = JSON.parse(fs.readFileSync(f.state, 'utf8'));
  assert.equal((state.boundProjects ?? []).includes(bound(stuck)), false, 'a binding that failed was recorded');

  writeText(path.join(f.from, 'skills', 'demo', 'SKILL.md'), '# demo v3\n');
  const next = deploy({ ...f, into: '' });
  assert.equal(next.ok, true);
  assert.equal(next.skillConflicts.includes(path.dirname(demo)), false, 'the kit\'s own copy now reads as somebody else\'s');
  assert.equal(fs.readFileSync(demo, 'utf8'), '# demo v3\n');
});
