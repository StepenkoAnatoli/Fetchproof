// A bounded command log is not a complete Git answer (ADR-0151). Real local Git and
// offline child scripts exercise delivery and continuation; nothing reaches a provider.
import { spawnSync } from 'node:child_process';
import { test, describe, assert, assertEqual, tempDir, fs, path, makeProject, requireGit, fixtureInitArgs } from './harness.mjs';
import { writeText, readJson, readText } from '../lib/core.mjs';
import { createAutoCollect, execFile, RUN_OUTPUT_BYTES } from '../lib/auto-collect.mjs';
import { saveAutoCollect, applyRequest, writeResult, recordTrustedResult, isTrustedResult } from '../lib/requests.mjs';

describe('git-output-trust');
const GOOD = { fact: 'What is the endpoint limit?', blocks: 'the retry design', urls: ['https://docs.example.com/limits'] };

function git(cwd, env, ...args) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  assertEqual(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function world({ partial = false, large = false, topic = false } = {}) {
  requireGit('bounded Git delivery');
  const machine = tempDir('rk-git-trust-machine-');
  const config = path.join(machine, 'config.json');
  const globalConfig = path.join(machine, 'gitconfig');
  writeText(config, '{"role":"collector"}');
  writeText(globalConfig, '[user]\n name = Collector\n email = collector@example.invalid\n[commit]\n gpgsign = false\n');
  const env = { ...process.env, RESEARCH_KIT_CONFIG: config, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', RK_TEST_CALLS: path.join(machine, 'calls') };
  const remote = tempDir('rk-git-trust-remote-');
  git(remote, env, ...fixtureInitArgs('--bare', '-b', 'main'));
  // Match the listener's project identity when TMP names a Windows short path or junction.
  const project = fs.realpathSync.native(makeProject(undefined, { topic: 'Git output trust', content: true }));
  git(project, env, ...fixtureInitArgs('-b', 'main'));
  git(project, env, 'config', 'core.hooksPath', path.join(machine, 'no-hooks'));
  writeText(path.join(project, 'research', 'a.txt'), 'base\n');
  writeText(path.join(project, 'research', 'z.txt'), 'base\n');
  writeText(path.join(project, 'research', 'requests', 'limit.json'), JSON.stringify({ ...GOOD, ...(topic ? { topic: 'New topic' } : {}) }));
  git(project, env, 'add', '-A');
  git(project, env, 'commit', '-q', '-m', 'scaffold and request');
  git(project, env, 'remote', 'add', 'origin', remote);
  git(project, env, 'push', '-q', '-u', 'origin', 'main');
  const kit = tempDir('rk-git-trust-kit-');
  writeText(path.join(kit, 'bin', 'research.mjs'), `
import fs from 'node:fs';
fs.appendFileSync(process.env.RK_TEST_CALLS, 'collected\\n');
${large ? "fs.writeFileSync('research/a.txt', 'x'.repeat(400000) + '\\n'); fs.writeFileSync('research/z.txt', 'A\\n');" : ''}
console.log('spent      1');
${partial ? "console.log('stopped    credits ran out on firecrawl during scrape');" : ''}
if (process.send) await new Promise((resolve) => process.send({ type: 'research-kit-accounting', spent: 1, stoppedOn: '${partial ? 'firecrawl' : ''}' }, () => { process.disconnect(); resolve(); }));
process.exit(${partial ? 2 : 0});
`);
  writeText(path.join(kit, 'bin', 'preflight.mjs'), "console.log('FAIL - unknown OPEN'); process.exit(1);\n");
  saveAutoCollect({ mode: 'auto', ...(topic ? { topicsFolder: 'projects' } : {}) }, env);
  return { project, remote, env, kit, calls: () => readText(env.RK_TEST_CALLS, '').trim().split('\n').filter(Boolean).length };
}

function loop(w, intercept = () => null) {
  return createAutoCollect({ project: () => w.project, env: w.env, kitRoot: w.kit,
    exec: (command, args, options) => intercept(command, args, options) ?? execFile(command, args, options) });
}

test('real Git output is byte bounded and records when later files were omitted', async () => {
  const w = world();
  writeText(path.join(w.project, 'research', 'a.txt'), 'é'.repeat(200000) + '\n');
  writeText(path.join(w.project, 'research', 'z.txt'), 'A\n');
  const first = await execFile('git', ['diff', '--binary', 'HEAD', '--', 'research'], { cwd: w.project, env: w.env });
  const completeA = git(w.project, w.env, 'diff', '--binary', 'HEAD', '--', 'research');
  writeText(path.join(w.project, 'research', 'z.txt'), 'B\n');
  const second = await execFile('git', ['diff', '--binary', 'HEAD', '--', 'research'], { cwd: w.project, env: w.env });
  const completeB = git(w.project, w.env, 'diff', '--binary', 'HEAD', '--', 'research');
  assert(completeA !== completeB, 'the later tracked file did not change the complete diff');
  assertEqual(first.code, 0);
  assertEqual(second.code, 0);
  assertEqual(first.truncated, true, 'an incomplete successful Git answer was presented as complete');
  assertEqual(second.truncated, true);
  const retained = first.output.replace(/^\[\.\.\. later output truncated \.\.\.\]\n/, '');
  // Decoding a final partial UTF-8 character may add a replacement character; the
  // accounting repair also prefixes its fixed notice, outside the retained buffer.
  assert(Buffer.byteLength(retained) <= RUN_OUTPUT_BYTES * 4 + 3, `retained ${Buffer.byteLength(retained)} bytes`);
  const small = await execFile('git', ['rev-parse', '--show-toplevel'], { cwd: w.project, env: w.env });
  assertEqual(small.truncated, false);
});

test('an oversized real partial diff is refused before staging and remains trusted after restart', async () => {
  const w = world({ partial: true, large: true });
  const before = git(w.project, w.env, 'rev-parse', 'HEAD').trim();
  const status = await loop(w).cycle();
  assertEqual(w.calls(), 1);
  assertEqual(status.requests[0].status, 'partial');
  assert(/truncat/i.test(status.requests[0].git), JSON.stringify(status));
  assertEqual(git(w.project, w.env, 'rev-parse', 'HEAD').trim(), before, 'a fingerprint made from the retained prefix authorized a commit');
  assertEqual(git(w.project, w.env, 'diff', '--cached', '--name-only').trim(), '');
  assert(isTrustedResult(w.project, 'limit', w.env), 'the partial result lost collector trust when fingerprinting failed');
  const resumed = loop(w);
  resumed.resume();
  await resumed.cycle();
  assertEqual(w.calls(), 1, 'a new loop re-collected the already recorded partial result');
  assertEqual(git(w.project, w.env, 'rev-parse', 'HEAD').trim(), before);
  assertEqual(readJson(path.join(w.project, 'research', 'requests', 'limit.result.json')).resume.remainingPages, 3);
});

test('truncated pending status or diff blocks a partial retry without collecting or staging', async () => {
  const w = world({ partial: true });
  await loop(w).cycle();
  const before = git(w.project, w.env, 'rev-parse', 'HEAD').trim();
  for (const kind of ['status', 'diff']) {
    let mutations = 0;
    const auto = loop(w, (command, args) => {
      if (command !== 'git') return null;
      if (args[0] === kind && (kind === 'diff' ? args.includes('--binary') : args.includes('--porcelain=v1'))) {
        return Promise.resolve({ code: 0, output: kind === 'status' ? '' : 'retained prefix', truncated: true });
      }
      if (['add', 'commit', 'push'].includes(args[0])) mutations += 1;
      return null;
    });
    auto.resume();
    const status = await auto.cycle();
    assertEqual(mutations, 0, `${kind}: incomplete Git data reached delivery`);
    assert(status.notes.some((note) => /truncat/i.test(note)), JSON.stringify(status));
    assertEqual(w.calls(), 1, `${kind}: incomplete Git data permitted another collection`);
  }
  assertEqual(git(w.project, w.env, 'rev-parse', 'HEAD').trim(), before);
});

test('a truncated repository root refuses the cycle before synchronization', async () => {
  const w = world();
  let pulls = 0;
  const auto = loop(w, (command, args) => {
    if (command !== 'git') return null;
    if (args.includes('--show-toplevel')) return Promise.resolve({ code: 0, output: w.project, truncated: true });
    if (args[0] === 'pull') pulls += 1;
    return null;
  });
  const status = await auto.cycle();
  assertEqual(pulls, 0);
  assertEqual(w.calls(), 0);
  assert(status.notes.some((note) => /truncat/i.test(note)), JSON.stringify(status));
});

test('truncated Git metadata does not authorize a new topic target', async () => {
  const w = world({ topic: true });
  const auto = loop(w, (command, args) => command === 'git' && args.includes('--absolute-git-dir')
    ? Promise.resolve({ code: 0, output: path.join(w.project, '.git'), truncated: true }) : null);
  const status = await auto.cycle();
  assertEqual(w.calls(), 0);
  assertEqual(status.requests[0].status, 'refused');
  assert(/truncat/i.test(status.requests[0].detail), JSON.stringify(status));
  assert(!fs.existsSync(path.join(w.project, 'projects')), 'an incomplete metadata answer authorized scaffolding');
});

test('an empty retained dirty-status prefix cannot authorize collection', async () => {
  const w = world();
  const auto = loop(w, (command, args) => command === 'git' && args.includes('--porcelain')
    ? Promise.resolve({ code: 0, output: '', truncated: true }) : null);
  const status = await auto.cycle();
  assertEqual(w.calls(), 0);
  assertEqual(status.requests[0].status, 'waiting');
  assert(/truncat/i.test(status.requests[0].detail), JSON.stringify(status));
});

test('truncated upstream, ahead count, subject or changed paths cannot authorize pending delivery', async () => {
  const w = world();
  applyRequest(w.project, 'limit', GOOD, 4);
  writeResult(w.project, 'limit', { status: 'collected', project: '.', pages: 1, unknown: 'U-1' });
  recordTrustedResult(w.project, 'limit', w.env);
  git(w.project, w.env, 'add', 'research');
  git(w.project, w.env, 'commit', '-q', '-m', 'research: collect request limit');
  for (const kind of ['upstream', 'ahead', 'subject', 'changed']) {
    let mutations = 0;
    const auto = loop(w, (command, args) => {
      if (command !== 'git') return null;
      const matches = kind === 'upstream' ? args.includes('@{u}')
        : kind === 'ahead' ? args[0] === 'rev-list'
          : kind === 'subject' ? args[0] === 'log' : args[0] === 'diff-tree';
      if (matches) return Promise.resolve({ code: 0, truncated: true, output: {
        upstream: 'origin/main\n', ahead: '1\n', subject: 'research: collect request limit\n', changed: 'research/a.txt\0',
      }[kind] });
      if (['add', 'commit', 'push'].includes(args[0])) mutations += 1;
      return null;
    });
    const status = await auto.cycle();
    assertEqual(mutations, 0, `${kind}: a retained prefix authorized staging or pushing`);
    assert(/truncat/i.test(status.requests[0].git), `${kind}: ${JSON.stringify(status)}`);
    assertEqual(w.calls(), 0, `${kind}: delivery re-collected a trusted result`);
  }
});

test('a malformed ahead count cannot authorize staging or pushing a trusted result', async () => {
  const w = world();
  writeResult(w.project, 'limit', { status: 'collected', project: '.', pages: 1, unknown: 'U-1' });
  recordTrustedResult(w.project, 'limit', w.env);
  let mutations = 0;
  const auto = loop(w, (command, args) => {
    if (command !== 'git') return null;
    if (args[0] === 'rev-list') return Promise.resolve({ code: 0, output: 'warning from git\n1\n', truncated: false });
    if (['add', 'commit', 'push'].includes(args[0])) mutations += 1;
    return null;
  });
  const status = await auto.cycle();
  assertEqual(mutations, 0, 'a non-numeric ahead count was accepted as no pending commits');
  assert(/invalid.*count/i.test(status.requests[0].git), JSON.stringify(status));
  assertEqual(w.calls(), 0);
});

test('a missing quiet-diff exit cannot authorize a commit or push', async () => {
  const w = world();
  writeResult(w.project, 'limit', { status: 'collected', project: '.', pages: 1, unknown: 'U-1' });
  recordTrustedResult(w.project, 'limit', w.env);
  let deliveries = 0;
  const auto = loop(w, (command, args) => {
    if (command !== 'git') return null;
    if (args[0] === 'diff' && args.includes('--quiet')) return Promise.resolve({ code: null, output: 'child terminated', truncated: false });
    if (['commit', 'push'].includes(args[0])) deliveries += 1;
    return null;
  });
  const status = await auto.cycle();
  assertEqual(deliveries, 0, 'a missing inspection exit was accepted as an index with changes');
  assert(/could not inspect isolated git index/.test(status.requests[0].git), JSON.stringify(status));
  assertEqual(w.calls(), 0);
});
