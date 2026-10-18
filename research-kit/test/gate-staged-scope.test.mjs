// ADR-0154: an unknown staged set is not an empty staged set. These cases use the
// real verdict with an injected corpus/list reader and do not run a suite or hook; the #309
// cases at the end run bin/gate.mjs over a scratch repository, from its top level, as the hook does.
import { spawnSync } from 'node:child_process';
import { test, describe, assert, makePassingProject, makeProject, tempDir, fs, path, KIT_ROOT, requireGit, fixtureInitArgs, fixtureCommitArgs } from './harness.mjs';
import { PATHS, resolve, writeText, writeJson } from '../lib/core.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import * as gate from '../lib/gate.mjs';

describe('gate-staged-scope');

test('unknown staged scope cannot clear the architecture-map rule; a known empty set can', () => {
  const root = tempDir('rk-staged-proof-');
  for (const unknown of [null, undefined, '', {}, 0]) {
    const breach = gate.architectureMapBreach(root, unknown);
    assert.equal(breach?.rule, 'architecture-map-same-commit', `unknown ${JSON.stringify(unknown)} was treated as no code change`);
    assert.match(breach.detail, /could not list the staged paths/i);
    assert.match(breach.fix, /git diff|git status/);
  }
  assert.equal(gate.architectureMapBreach(root, []), null, 'a genuinely empty staged list owes no map');
  assert.equal(gate.architectureMapBreach(root, ['README.md']), null);
  assert(gate.architectureMapBreach(root, ['src/app.js']));
  assert.equal(gate.architectureMapBreach(root, ['src/app.js', PATHS.architecture]), null);
});

test('a green commit with unknown staged scope is an ordinary block even with fail-open configured', () => {
  const root = makePassingProject();
  const config = path.join(root, 'machine-config.json');
  writeJson(config, { failOpen: true });
  const corpus = readCorpus(root);
  const options = { gate: 'commit', corpus, record: false, env: { ...process.env, RESEARCH_KIT_CONFIG: config } };
  let suiteCalls = 0;
  const result = gate.evaluate(root, { ...options, stagedPaths: null, runSuite: () => { suiteCalls += 1; throw new Error('a cheap scope breach must be first'); } });
  assert.equal(result.preflight.pass, true, 'the fixture must reach the green map branch');
  assert.equal(result.verdict, 'block');
  assert.equal(result.allow, false);
  assert.equal(result.breach.rule, 'architecture-map-same-commit');
  assert.equal(suiteCalls, 0);
  assert.equal(gate.evaluate(root, { ...options, stagedPaths: [] }).allow, true);
  assert.equal(gate.evaluate(root, { ...options, stagedPaths: ['src/app.js', PATHS.architecture] }).allow, true);
});

test('one successful actual Git list read preserves NUL-delimited names and needs no probe', () => {
  const root = tempDir('rk-staged-list-');
  const names = ['src/ leading and trailing ', 'src/a\nb.js', PATHS.architecture];
  let calls = 0;
  const paths = gate.readStagedPaths(root, { run: (args, options) => {
    calls += 1;
    assert.deepEqual(args, ['diff', '--cached', '--name-only', '--no-renames', '-z']);
    assert.equal(options.cwd, root);
    if (calls > 1) throw Object.assign(new Error('the second read fails'), { status: 1, stdout: '' });
    return `${names.join('\0')}\0`;
  } });
  assert.equal(calls, 1, 'a successful probe must not cause a second unverified read');
  assert.deepEqual(paths, names, 'Git names must remain data, including spaces and newlines');
});

test('failed, over-buffer, and malformed actual list reads are unknown; successful zero-byte output is empty', () => {
  const root = tempDir('rk-staged-list-error-');
  assert.deepEqual(gate.readStagedPaths(root, { run: () => '' }), []);
  for (const answer of [null, undefined, 0, {}, ['src/app.js'], 'src/app.js', 'src/app.js\0\0']) {
    assert.equal(gate.readStagedPaths(root, { run: () => answer }), null, `${JSON.stringify(answer)} became an empty successful list`);
  }
  for (const error of [
    Object.assign(new Error('failed diff'), { status: 1, stdout: 'docs/ARCHITECTURE.md\0' }),
    Object.assign(new Error('stdout maxBuffer exceeded'), { code: 'ENOBUFS', stdout: 'docs/ARCHITECTURE.md\0' }),
  ]) {
    assert.equal(gate.readStagedPaths(root, { run: () => { throw error; } }), null, 'partial stdout from a failed process must not clear scope');
  }
});

test('lazy acquisition refuses thrown or malformed answers without converting them into internal errors', () => {
  const root = makePassingProject();
  const corpus = readCorpus(root);
  const options = { gate: 'commit', corpus, record: false };
  for (const answer of [null, undefined, {}, '', [''], [null], ['src/app.js', {}]]) {
    let calls = 0;
    const result = gate.evaluate(root, { ...options, listStaged: () => { calls += 1; return answer; } });
    assert.equal(calls, 1);
    assert.equal(result.verdict, 'block');
    assert.equal(result.breach?.rule, 'architecture-map-same-commit');
  }
  const thrown = gate.evaluate(root, { ...options, listStaged: () => { throw new Error('Git failed'); } });
  assert.equal(thrown.verdict, 'block');
  assert.equal(thrown.breach.rule, 'architecture-map-same-commit');
});

test('lazy acquisition respects ungated, GATE_OFF and edit ordering; known empty answers remain valid', () => {
  let calls = 0;
  const listStaged = () => { calls += 1; return []; };
  assert.equal(gate.evaluate(tempDir('rk-ungated-staged-'), { gate: 'commit', listStaged, record: false }).verdict, 'not-gated');
  assert.equal(calls, 0);
  const root = makePassingProject();
  const corpus = readCorpus(root);
  writeText(resolve(root, PATHS.gateOff), 'deliberate fixture override\n');
  assert.equal(gate.evaluate(root, { gate: 'commit', corpus, listStaged, record: false }).verdict, 'override');
  assert.equal(calls, 0);
  fs.rmSync(resolve(root, PATHS.gateOff));
  assert.equal(gate.evaluate(root, { gate: 'edit', corpus, listStaged, record: false }).allow, true);
  assert.equal(calls, 0);
  assert.equal(gate.evaluate(root, { gate: 'commit', corpus, stagedPaths: [], listStaged, record: false }).allow, true);
  assert.equal(calls, 0, 'a supplied list must not be replaced by acquisition');
  assert.equal(gate.evaluate(root, { gate: 'commit', corpus, listStaged, record: false }).allow, true);
  assert.equal(calls, 1);
});

// #309 (2026-10-13): git runs the commit hook at the repository's top level, and bin/gate.mjs
// took that cwd as the project. A project scaffolded below it (a monorepo's packages/a, the
// README's docs/research/... example) was never judged: no marker at the top, so "not-gated"
// before a staged path was read. The gate now judges each staged path by its nearest gated
// ancestor below the top level, from the index, and names the project it judged.
function monorepo({ passing = false } = {}) {
  requireGit('a project below the repository root');
  const top = tempDir('rk-mono-');
  const project = path.join(top, 'packages', 'a');
  if (passing) makePassingProject(project);
  else makeProject(project, { content: true });
  const run = (args, cwd = top) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  run(fixtureInitArgs());
  run(['config', 'user.email', 'fixture@example.invalid']);
  run(['config', 'user.name', 'Fixture']);
  writeText(path.join(top, 'README.md'), '# mono\n');
  run(['add', '-A', '-f']);
  run(fixtureCommitArgs('the monorepo'));
  return { top, project, run };
}

function gateCli(cwd, args, input, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'gate.mjs'), '--gate', 'commit', ...args], {
    cwd, encoding: 'utf8', input, env: { ...process.env, RESEARCH_KIT_GATE: '', RESEARCH_KIT_CONFIG: path.join(tempDir(), 'absent.json'), ...extraEnv },
  });
}
const staged = (...paths) => paths.flatMap((p) => ['--staged', p]);

test('a project below the repository root is judged by the commit gate run at the top level', () => {
  const { top } = monorepo();
  const code = gateCli(top, staged('packages/a/src/app.js'));
  assert.equal(code.status, 1, `code in a failing project below the root was committable:\n${code.stdout}${code.stderr}`);
  assert.match(code.stderr, /research gate: BLOCKED in packages\/a - /);
  // Its fix runs in the project, and only the project's own GATE_OFF turns its gate off.
  assert.match(code.stderr, /Fix: cd packages\/a && node /);
  assert.match(code.stderr, /packages\/a\/research\/GATE_OFF +turn the gate off for that project/);
  assert.equal(gateCli(top, staged('README.md')).status, 0, 'a path under no gated project is not judged');
  const evidence = gateCli(top, staged('packages/a/research/EVIDENCE.md', 'packages/a/AGENTS.md'));
  assert.equal(evidence.status, 0, `phase-1 work below the root was refused:\n${evidence.stderr}`);
  assert.match(evidence.stdout, /allow in packages\/a - /);
  const json = gateCli(top, ['--json', ...staged('README.md', 'packages/a/src/app.js')]);
  assert.equal(json.status, 1);
  const verdict = JSON.parse(json.stdout);
  assert.equal(verdict.project, 'packages/a');
  assert.equal(verdict.allow, false);
  // The default invocation - the real hook's - reads git's own staged list.
  writeText(path.join(top, 'packages', 'a', 'src', 'app.js'), 'export const x = 1;\n');
  spawnSync('git', ['add', 'packages/a/src/app.js'], { cwd: top });
  const hooked = gateCli(top, []);
  assert.equal(hooked.status, 1, `the hook's own staged list let code through:\n${hooked.stdout}${hooked.stderr}`);
  assert.match(hooked.stderr, /BLOCKED in packages\/a/);
  // The committer's environment does not switch the lookup off: under GIT_LITERAL_PATHSPECS the
  // contract listing's glob had matched nothing, and nothing below the root was judged.
  for (const variable of ['GIT_LITERAL_PATHSPECS', 'GIT_NOGLOB_PATHSPECS']) {
    const literal = gateCli(top, [], undefined, { [variable]: '1' });
    assert.equal(literal.status, 1, `${variable}=1 let code through:\n${literal.stdout}${literal.stderr}`);
  }
  // An ungated top level with nothing below it stays as cheap and silent as before.
  assert.equal(gateCli(top, ['--staged-stdin'], 'README.md\n').status, 0);
});

test('a project below the repository root is judged from the INDEX, not the working tree', () => {
  const { top, project, run } = monorepo({ passing: true });
  assert.equal(gateCli(top, staged('packages/a/src/app.js', 'packages/a/docs/ARCHITECTURE.md')).status, 0, 'a passing project below the root was refused');
  // Stage an OPEN contract, then put CLOSED back in the working tree only (ADR-0024).
  const discovery = path.join(project, ...PATHS.discovery.split('/'));
  const closed = fs.readFileSync(discovery, 'utf8');
  fs.writeFileSync(discovery, closed.replace('CLOSED', 'OPEN'));
  run(['add', `packages/a/${PATHS.discovery}`]);
  fs.writeFileSync(discovery, closed);
  const r = gateCli(top, staged(`packages/a/${PATHS.discovery}`, 'packages/a/src/app.js', 'packages/a/docs/ARCHITECTURE.md'));
  assert.equal(r.status, 1, `the staged OPEN contract below the root was judged by the working tree:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /BLOCKED in packages\/a/);
});

// Review of #309 (2026-10-18): below the top level any one of the four gate markers made a
// project, so the machine-wide hook blocked commits in repositories that never heard of the kit -
// a data folder's research/raw/survey.csv, an experiment's research/plan.json, a vendored copy of
// the kit's own template/ - and wrote research/raw/.diagnostics.jsonl into them. Below the top a
// project holds research/DISCOVERY.md (tracked) and research/raw/, as new-project writes it.
test('below the root, a folder that only looks like research is not a project, and the gate writes nothing there', () => {
  requireGit('a repository that never heard of the kit');
  const top = tempDir('rk-nonkit-');
  const run = (args) => {
    const r = spawnSync('git', args, { cwd: top, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  run(fixtureInitArgs());
  run(['config', 'user.email', 'fixture@example.invalid']);
  run(['config', 'user.name', 'Fixture']);
  writeText(path.join(top, 'analysis', 'research', 'raw', 'survey.csv'), 'a,b\n1,2\n');
  writeText(path.join(top, 'ml', 'research', 'plan.json'), '{"experiments":[]}\n');
  fs.cpSync(path.join(KIT_ROOT, 'template'), path.join(top, 'vendor', 'research-kit', 'template'), { recursive: true });
  run(['add', '-A']);
  run(fixtureCommitArgs('a repository without the kit'));
  writeText(path.join(top, 'analysis', 'model.py'), 'print(1)\n');
  writeText(path.join(top, 'ml', 'train.py'), 'print(2)\n');
  writeText(path.join(top, 'vendor', 'research-kit', 'template', 'src', 'app.js'), 'x\n');
  run(['add', '-A']);
  const r = gateCli(top, []);
  assert.equal(r.status, 0, `a repository without the kit was judged:\n${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout + r.stderr, /BLOCKED/);
  const after = run(['status', '--porcelain', '--untracked-files=all', '--ignored']);
  assert.doesNotMatch(after, /^\?\?|^!!/m, `the gate wrote into a repository without the kit:\n${after}`);
});

// Second review of #309 (2026-10-18): research/raw/ on disk was the second signal, and a
// repository that ignores raw/ folders never carries it - its .gitkeep is not tracked - so on a
// fresh clone, the builder's machine, the project escaped both gates while the same commit in
// the origin tree blocked. The contract new-project rendered is the signal that travels.
test('a project below the root is judged in a clone where its research/raw/ never travelled', () => {
  requireGit('a clone of a monorepo that ignores raw/ folders');
  const origin = tempDir('rk-mono-origin-');
  const run = (cwd, args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  run(origin, fixtureInitArgs());
  run(origin, ['config', 'user.email', 'fixture@example.invalid']);
  run(origin, ['config', 'user.name', 'Fixture']);
  writeText(path.join(origin, '.gitignore'), 'raw/\n');
  makeProject(path.join(origin, 'packages', 'a'), { content: true });
  run(origin, ['add', '-A']);
  run(origin, fixtureCommitArgs('a monorepo that ignores raw/ folders'));
  const clone = tempDir('rk-mono-clone-');
  run(path.dirname(clone), ['-c', 'init.templateDir=', 'clone', '-q', origin, clone]);
  assert.equal(fs.existsSync(path.join(clone, 'packages', 'a', 'research', 'raw')), false, 'the fixture must not carry raw/');
  writeText(path.join(clone, 'packages', 'a', 'src', 'app.js'), 'x\n');
  run(clone, ['add', 'packages/a/src/app.js']);
  const r = gateCli(clone, []);
  assert.equal(r.status, 1, `code under a failing project committed in the clone:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /BLOCKED in packages\/a/);
  const edit = spawnSync(process.execPath, [path.join(KIT_ROOT, 'hooks', 'edit-gate.mjs')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: clone, tool_input: { file_path: path.join(clone, 'packages', 'a', 'src', 'app.js'), content: 'x' } }),
    encoding: 'utf8', env: { ...process.env, RESEARCH_KIT_CONFIG: path.join(tempDir(), 'absent.json') },
  });
  assert.equal(JSON.parse(edit.stdout).hookSpecificOutput.permissionDecision, 'ask', edit.stdout);
});

test('assigning 30,000 staged paths in 9,000 folders to projects is bounded by the list, not the disk', () => {
  const paths = [];
  for (let a = 0; a < 30; a += 1) for (let b = 0; b < 100; b += 1) for (let c = 0; c < 10; c += 1) paths.push(`pkg${a}/src/mod${b}/deep/er/f${c}.js`);
  paths.push('pkg7/research/raw/x.md', 'pkg7/research/DISCOVERY.md');
  const started = Date.now();
  const groups = gate.stagedProjects(tempDir('rk-staged-perf-'), paths, { contracts: ['pkg7'] });
  const elapsed = Date.now() - started;
  assert.deepEqual(groups.map((g) => [g.project, g.stagedPaths.length]), [['pkg7', 1002]]);
  assert.ok(elapsed < 5000, `30,000 staged paths took ${elapsed} ms - every commit in a large repository pays this`);
});
