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
  writeText(path.join(kitHome, 'README.md'), '# old kit\n');
  writeText(path.join(kitHome, 'orphan.txt'), 'must not be pruned on refusal\n');
  writeText(path.join(personal, 'research-first', 'SKILL.md'), '# old personal skill\n');
  writeText(path.join(into, 'notes.txt'), 'unrelated folder\n');
  // A recorded deployment permits mirroring: an unrelated kit-home refusal must not
  // accidentally hide the missing project guard.
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
