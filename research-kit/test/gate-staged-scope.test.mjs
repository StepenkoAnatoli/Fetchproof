// ADR-0154: an unknown staged set is not an empty staged set. These cases use the
// real verdict with an injected corpus/list reader and do not run a suite or hook; the #309
// cases at the end, and ADR-0184's after them, run bin/gate.mjs over a scratch repository, from
// its top level, as the hook does.
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

// Review of the 2026-10-19 sweep (hooks F1, ADR-0184): #312's rule - a capture the ledger names is
// never removed - was asked only while the disk still showed the project gated and the index still
// held part of its research/. `rm -rf research && git add -A` left no marker, so the gate answered
// "not-gated" and the corpus left the branch without a record. `git rm -r research` usually leaves
// the gate's own research/raw/.diagnostics.jsonl behind, and that commit was refused as "no part of
// research/ is tracked", with a fix that exits 128. Below the top, `git rm -r packages/a/research`
// beside the project's code was "allow in packages/a - no gate marker". A project below the top
// that goes whole - deleted or moved - is not judged where it was; the top level always stays.
const ledgerGone = /research\/raw\/\.fetches\.jsonl is in HEAD and is being deleted/;
const ledgerFix = /restore it \(git checkout HEAD -- research\/raw\/\.fetches\.jsonl\)/;
const gitIn = (cwd) => (args, at = cwd) => {
  const r = spawnSync('git', args, { cwd: at, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/** A passing project committed at the top level, with the log a commit's gate writes on disk. */
function committedTop() {
  requireGit('a commit that removes the evidence HEAD holds');
  const top = makePassingProject();
  const run = gitIn(top);
  run(fixtureInitArgs());
  run(['config', 'user.email', 'fixture@example.invalid']);
  run(['config', 'user.name', 'Fixture']);
  run(['add', '-A', '-f']);
  run(fixtureCommitArgs('the corpus'));
  const first = gateCli(top, []);
  assert.equal(first.status, 0, `the committed corpus must pass:\n${first.stdout}${first.stderr}`);
  const diagnostics = path.join(top, ...PATHS.raw.split('/'), '.diagnostics.jsonl');
  assert.ok(fs.existsSync(diagnostics), 'the gate writes its log into research/raw/ on every commit');
  return { top, run, diagnostics };
}

/** monorepo({ passing: true }) with the project's own code committed beside its corpus. */
function monorepoWithCode() {
  const { top, project, run } = monorepo({ passing: true });
  writeText(path.join(project, 'app.js'), 'export const x = 1;\n');
  run(['add', 'packages/a/app.js']);
  // The gate judges packages/a when a staged path is in it, and writes its log there then.
  const first = gateCli(top, []);
  assert.equal(first.status, 0, `the project must pass:\n${first.stdout}${first.stderr}`);
  run(fixtureCommitArgs('the project\'s code'));
  const diagnostics = path.join(project, ...PATHS.raw.split('/'), '.diagnostics.jsonl');
  assert.ok(fs.existsSync(diagnostics), 'the gate writes its log into the project\'s research/raw/');
  return { top, project, run, diagnostics };
}

test('ADR-0184: at the top level, rm -rf research && git add -A blocks, naming the ledger HEAD holds', () => {
  const { top, run } = committedTop();
  const research = path.join(top, 'research');
  fs.rmSync(research, { recursive: true, force: true });
  run(['add', '-A']);
  const r = gateCli(top, []);
  assert.equal(r.status, 1, `deleting research/ turned the gate off without a record:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /research gate: BLOCKED - /);
  assert.match(r.stderr, ledgerGone);
  assert.match(r.stderr, ledgerFix);
  assert.match(r.stderr, /research\/GATE_OFF +turn the gate off for this repository/);
  const json = JSON.parse(gateCli(top, ['--json']).stdout);
  assert.equal(json.allow, false);
  assert.match(json.reason, ledgerGone);
  // The override is the one AGENTS.md names, and it is recorded.
  writeText(path.join(research, 'GATE_OFF'), 'removing the corpus, deliberately\n');
  const off = gateCli(top, []);
  assert.equal(off.status, 0, `GATE_OFF did not turn the gate off:\n${off.stdout}${off.stderr}`);
  assert.match(off.stdout, /research gate: OFF - /);
  assert.match(fs.readFileSync(path.join(research, 'overrides.log'), 'utf8'), /GATE_OFF\tcommit gate/);
});

test('ADR-0184: at the top level, git rm -r research blocks on the ledger, with or without the gate\'s log left, and its fix runs', () => {
  for (const leftover of [true, false]) {
    const { top, run, diagnostics } = committedTop();
    run(['rm', '-r', '-q', 'research']);
    if (!leftover) fs.rmSync(path.join(top, 'research'), { recursive: true, force: true });
    assert.equal(fs.existsSync(diagnostics), leftover, 'git rm -r leaves the ignored log, and only it, on disk');
    const r = gateCli(top, []);
    const said = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, `git rm -r research (log left: ${leftover}) was committable:\n${said}`);
    assert.match(r.stderr, ledgerGone, `log left: ${leftover}`);
    assert.match(r.stderr, ledgerFix);
    // Not "nothing was ever tracked": its `git add -f research/raw/.fetches.jsonl` exits 128 here.
    assert.doesNotMatch(said, /no part of research\/ is tracked|git add research\//);
    // The printed command runs, and the next verdict names the capture still being deleted.
    run(['checkout', 'HEAD', '--', PATHS.ledger]);
    const next = gateCli(top, []);
    assert.equal(next.status, 1);
    assert.match(next.stderr, /research\/raw\/[^ ]+\.md \(seq 1\) is recorded in the ledger and being deleted/);
  }
});

test('ADR-0184: below the top, removing a project\'s research/ while its code stays blocks in that project', () => {
  for (const leftover of [true, false]) {
    const { top, project, run, diagnostics } = monorepoWithCode();
    fs.appendFileSync(path.join(project, 'app.js'), 'export const y = 2;\n');
    run(['rm', '-r', '-q', 'packages/a/research']);
    if (!leftover) fs.rmSync(path.join(project, 'research'), { recursive: true, force: true });
    run(['add', '-A']);
    assert.equal(fs.existsSync(diagnostics), leftover);
    const r = gateCli(top, []);
    assert.equal(r.status, 1, `packages/a's evidence left with its code staged (log left: ${leftover}):\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /research gate: BLOCKED in packages\/a - research\/raw\/\.fetches\.jsonl is in HEAD and is being deleted/);
    assert.match(r.stderr, /Fix: \(from packages\/a\) restore it \(git checkout HEAD -- research\/raw\/\.fetches\.jsonl\)/);
    assert.match(r.stderr, /packages\/a\/research\/GATE_OFF +turn the gate off for that project/);
    assert.doesNotMatch(r.stderr, /no part of research\/ is tracked/);
    // Run from the project, as printed, the fix restores the ledger.
    run(['checkout', 'HEAD', '--', PATHS.ledger], project);
    assert.ok(fs.existsSync(path.join(project, ...PATHS.ledger.split('/'))));
  }
  // The project's own override still turns it off, and is recorded there.
  const { top, project, run } = monorepoWithCode();
  run(['rm', '-r', '-q', 'packages/a/research']);
  fs.rmSync(path.join(project, 'research'), { recursive: true, force: true });
  writeText(path.join(project, 'research', 'GATE_OFF'), 'removing the corpus, deliberately\n');
  const off = gateCli(top, []);
  assert.equal(off.status, 0, `${off.stdout}${off.stderr}`);
  assert.match(off.stdout, /research gate: OFF in packages\/a - /);
  assert.match(fs.readFileSync(path.join(project, 'research', 'overrides.log'), 'utf8'), /GATE_OFF/);
});

test('ADR-0184: below the top, a project deleted whole is not judged, with or without the gate\'s log left', () => {
  for (const leftover of [true, false]) {
    const { top, project, run, diagnostics } = monorepoWithCode();
    run(['rm', '-r', '-q', 'packages/a']);
    if (!leftover) fs.rmSync(project, { recursive: true, force: true });
    assert.equal(fs.existsSync(diagnostics), leftover);
    const r = gateCli(top, []);
    assert.equal(r.status, 0, `deleting a whole project below the top (log left: ${leftover}) was refused:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /research gate: allow in packages\/a - /);
    assert.doesNotMatch(r.stdout + r.stderr, /BLOCKED/);
  }
});

test('ADR-0184: below the top, a project moved whole is judged where it went, not where it was', () => {
  const { top, run } = monorepoWithCode();
  run(['mv', 'packages/a', 'packages/b']);
  const r = gateCli(top, []);
  assert.equal(r.status, 0, `moving a whole project was refused:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /research gate: allow in packages\/a - /);
  assert.match(r.stdout, /research gate: allow in packages\/b - the gate passes/);
  assert.doesNotMatch(r.stdout + r.stderr, /being deleted|BLOCKED/);
});

test('ADR-0184: with no HEAD, or no ledger in HEAD, the verdict is what it was', () => {
  requireGit('a first commit, and a repository without the kit');
  {
    // A first commit with research/ untracked: the corpus never travelled - nothing was removed.
    const top = makePassingProject();
    const run = gitIn(top);
    run(fixtureInitArgs());
    writeText(path.join(top, 'README.md'), '# first\n');
    run(['add', 'README.md']);
    const r = gateCli(top, []);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no part of research\/ is tracked/);
    assert.match(r.stderr, /Fix: git add research\/ && git add -f research\/raw\/\.fetches\.jsonl/);
    // And with research/ staged, the first commit passes.
    run(['add', '-A', '-f']);
    const staged = gateCli(top, []);
    assert.equal(staged.status, 0, `${staged.stdout}${staged.stderr}`);
  }
  {
    // A repository without the kit whose HEAD holds research/raw/data.csv and no ledger.
    const top = tempDir('rk-noledger-');
    const run = gitIn(top);
    run(fixtureInitArgs());
    run(['config', 'user.email', 'fixture@example.invalid']);
    run(['config', 'user.name', 'Fixture']);
    writeText(path.join(top, 'research', 'raw', 'data.csv'), 'a,b\n1,2\n');
    writeText(path.join(top, 'src', 'app.js'), 'x\n');
    run(['add', '-A']);
    run(fixtureCommitArgs('data, not a corpus'));
    run(['rm', '-q', 'research/raw/data.csv']);
    assert.equal(fs.existsSync(path.join(top, 'research')), false, 'the fixture must leave no marker on disk');
    const r = gateCli(top, []);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal(r.stdout + r.stderr, '', 'an ungated repository stays silent');
    assert.equal(run(['status', '--porcelain', '--untracked-files=all', '--ignored']), 'D  research/raw/data.csv\n', 'the gate wrote into a repository without the kit');
  }
});
