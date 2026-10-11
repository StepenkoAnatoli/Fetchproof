import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test, describe, assert, assertEqual, tempDir, fs, path, KIT_ROOT, makeProject } from './harness.mjs';
import { readAutoCollect, saveAutoCollect, reserveCollection, settleCollection, autoCollectPath, recordSpend, setPaused } from '../lib/requests.mjs';
import { createAutoCollect, execFile } from '../lib/auto-collect.mjs';
import { today, writeJson } from '../lib/core.mjs';

describe('auto-reservation');

function fixture() {
  const base = tempDir('rk-reservation-');
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    HOME: home, USERPROFILE: home, APPDATA: home, RESEARCH_KIT_CONFIG: path.join(home, 'config.json') };
  saveAutoCollect({ mode: 'auto', perRequestPages: 1, dailyPages: 1 }, env);
  const projects = ['first', 'other'].map((name) => {
    const dir = makeProject(path.join(base, name), { content: true, topic: 'offline reservation' });
    fs.mkdirSync(path.join(dir, 'research/requests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'research/requests/attempt.json'), JSON.stringify({
      fact: 'Offline attempt accounting', blocks: 'daily admission', queries: ['offline synthetic query'], maxPages: 1,
    }));
    return dir;
  });
  return { base, env, projects };
}

function parentProgram(file) {
  const source = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { createAutoCollect, execFile } from ${JSON.stringify(pathToFileURL(path.join(KIT_ROOT, 'lib/auto-collect.mjs')).href)};
    const [dir, marker, held] = process.argv.slice(2);
    const env = process.env;
    const exec = (command, args, options) => {
      if (command === 'git') {
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return Promise.resolve({ code: 0, output: dir });
        if (args[0] === 'rev-parse') return Promise.resolve({ code: 1, output: 'offline fixture has no upstream' });
        return Promise.resolve({ code: 0, output: '' });
      }
      if (path.basename(args[0]) === 'research.mjs') {
        const body = "require('node:fs').writeFileSync(" + JSON.stringify(marker)
          + ", JSON.stringify({ pid: process.pid, pages: 1 })); "
          + (held === 'true' ? 'setInterval(() => {}, 1000);'
            : "process.send({ type: 'research-kit-accounting', spent: 1, stoppedOn: '' }, () => process.disconnect());");
        return execFile(process.execPath, ['-e', body], { ...options, timeout: 30000 });
      }
      return Promise.resolve({ code: 0, output: 'PASS (offline preflight stand-in)' });
    };
    const collector = createAutoCollect({ project: () => dir, env, kitRoot: ${JSON.stringify(KIT_ROOT)}, exec });
    const status = await collector.cycle();
    fs.writeFileSync(marker + '.status.json', JSON.stringify(status));
  `;
  fs.writeFileSync(file, source);
}

function launch(file, dir, marker, held, env) {
  const child = spawn(process.execPath, [file, dir, marker, String(held)], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal, output })));
  return { child, closed };
}

async function waitFile(file) {
  const started = Date.now();
  while (!fs.existsSync(file)) {
    assert(Date.now() - started < 20000, `offline fixture never wrote ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('collector termination preserves admitted pages and blocks another project until operator resume', async () => {
  const { base, env, projects } = fixture();
  const program = path.join(base, 'parent.mjs');
  parentProgram(program);
  const firstMarker = path.join(base, 'first-attempt.json');
  const first = launch(program, projects[0], firstMarker, true, env);
  let attempt;
  let second;
  try {
    attempt = await waitFile(firstMarker);
    first.child.kill();
    await first.closed;
    try { process.kill(attempt.pid); } catch { /* this owned fixture child may already have exited */ }
    const afterKill = readAutoCollect(env);
    const secondMarker = path.join(base, 'other-attempt.json');
    second = launch(program, projects[1], secondMarker, false, env);
    const completion = await second.closed;
    assertEqual(completion.code, 0, completion.output);
    const status = await waitFile(`${secondMarker}.status.json`);
    assertEqual(afterKill.spent.pages, 1, 'the killed collector forgot its already admitted allowance');
    assert(afterKill.paused, 'the killed collector lost its in-flight pause');
    assert(!fs.existsSync(secondMarker), 'a restarted collector admitted another page before operator review');
    assertEqual(status.spent.pages, 1, 'restart changed the saved reservation');
    assert(status.paused, 'restart silently cleared the in-flight pause');
  } finally {
    first.child.kill();
    second?.child.kill();
    if (attempt) { try { process.kill(attempt.pid); } catch { /* owned fixture child is gone */ } }
  }
});

test('valid settlement refunds unused allowance once and preserves earlier spend', () => {
  const { env } = fixture();
  saveAutoCollect({ perRequestPages: 4, dailyPages: 10 }, env);
  recordSpend(2, env);
  const reservation = reserveCollection(4, 'owned in-flight pause', env);
  assertEqual(readAutoCollect(env).spent.pages, 6, 'admission did not charge before collection');
  const first = settleCollection(reservation, 1, '', env);
  assertEqual(first.spent.pages, 3, 'settlement lost earlier spend or retained unused allowance');
  assertEqual(first.paused, '');
  settleCollection(reservation, 1, '', env);
  assertEqual(readAutoCollect(env).spent.pages, 3, 'the same receipt refunded unused pages twice');
});

test('unknown settlement retains the charge and pause, and Resume does not refund it', () => {
  const { env } = fixture();
  const reservation = reserveCollection(1, 'in-flight actual spend unknown', env);
  settleCollection(reservation, null, '', env);
  assertEqual(readAutoCollect(env).spent.pages, 1, 'unknown spend removed its admitted charge');
  assert(readAutoCollect(env).paused, 'unknown settlement silently resumed the queue');
  setPaused('', env);
  assertEqual(readAutoCollect(env).spent.pages, 1, 'operator Resume discarded the charge');
});

test('day-aware settlement never subtracts a previous-day reservation from today', () => {
  for (const [measured, expected, finalPause] of [[2, 5, ''], [null, 7, 'actual spend unknown']]) {
    const { env } = fixture();
    saveAutoCollect({ perRequestPages: 4, dailyPages: 10 }, env);
    const reservation = reserveCollection(4, 'owned in-flight pause', env);
    reservation.day = '2000-01-01';
    const meter = JSON.parse(fs.readFileSync(autoCollectPath(env), 'utf8'));
    meter.spent = { day: today(), pages: 3 };
    writeJson(autoCollectPath(env), meter);
    settleCollection(reservation, measured, finalPause, env);
    assertEqual(readAutoCollect(env).spent.pages, expected, 'settlement refunded yesterday against today\'s other spend');
    assertEqual(readAutoCollect(env).paused, finalPause);
  }
  const { env } = fixture();
  const reservation = reserveCollection(1, 'in-flight pause survives daily reset', env);
  const meter = JSON.parse(fs.readFileSync(autoCollectPath(env), 'utf8'));
  meter.spent.day = '2000-01-01';
  writeJson(autoCollectPath(env), meter);
  assertEqual(readAutoCollect(env).spent.pages, 0, 'the existing daily reset did not occur');
  assertEqual(readAutoCollect(env).paused, reservation.pauseReason, 'daily reset silently resumed an unmeasured run');
});

test('settlement preserves a distinct pause and pauses an over-cap cross-day completion', () => {
  const { env } = fixture();
  const reservation = reserveCollection(1, 'owned in-flight pause', env);
  setPaused('operator requested inspection', env);
  settleCollection(reservation, 0, '', env);
  assertEqual(readAutoCollect(env).spent.pages, 0);
  assertEqual(readAutoCollect(env).paused, 'operator requested inspection', 'settlement erased another pause');
  setPaused('', env);
  const crossing = reserveCollection(1, 'crossing in-flight pause', env);
  crossing.day = '2000-01-01';
  const meter = JSON.parse(fs.readFileSync(autoCollectPath(env), 'utf8'));
  meter.spent = { day: today(), pages: 1 };
  writeJson(autoCollectPath(env), meter);
  settleCollection(crossing, 1, '', env);
  assertEqual(readAutoCollect(env).spent.pages, 2, 'cross-day completion erased today\'s charge');
  assert(readAutoCollect(env).paused, 'an over-cap completion resumed unattended');
});

function offlineQueue(env, project, research) {
  return createAutoCollect({ project: () => project, kitRoot: KIT_ROOT, env, exec(command, args, options) {
    if (command === 'git') {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return Promise.resolve({ code: 0, output: project });
      if (args[0] === 'rev-parse') return Promise.resolve({ code: 1, output: 'offline fixture has no upstream' });
      return Promise.resolve({ code: 0, output: '' });
    }
    if (path.basename(args[0]) === 'research.mjs') return research(command, args, options);
    return Promise.resolve({ code: 0, output: 'PASS (offline preflight stand-in)' });
  } });
}

test('a failed durable admission write prevents the research child from starting', async () => {
  const { env, projects } = fixture();
  const file = autoCollectPath(env);
  fs.renameSync(file, `${file}.saved`);
  fs.mkdirSync(file);
  let launched = false;
  const collector = offlineQueue(env, projects[0], () => { launched = true; throw new Error('must not launch'); });
  let refusal;
  try { await collector.cycle({ force: true }); } catch (error) { refusal = error; }
  assert(refusal, 'a failed meter write did not refuse collection');
  assert(['EISDIR', 'EPERM', 'EEXIST'].includes(refusal.code), `unexpected failure before admission: ${refusal?.stack}`);
  assert(!launched, 'research started before its durable admission write succeeded');
});

test('a real spawn failure retains the admitted charge and explicit unknown-spend pause', async () => {
  const { base, env, projects } = fixture();
  const collector = offlineQueue(env, projects[0], (_command, args, options) => execFile(path.join(base, 'no-such-node'), args, options));
  const status = await collector.cycle();
  assertEqual(status.spent.pages, 1, 'spawn failure refunded an unmeasured admission');
  assert(status.paused, 'spawn failure resumed the queue without measurement');
  assertEqual(status.requests[0].status, 'failed');
  assert(/actual spend unknown/.test(status.requests[0].detail), status.requests[0].detail);
});

test('a failed exit with measured spend settles its in-flight reservation', async () => {
  const { env, projects } = fixture();
  saveAutoCollect({ perRequestPages: 4, dailyPages: 10 }, env);
  recordSpend(2, env);
  fs.writeFileSync(path.join(projects[0], 'research/requests/attempt.json'), JSON.stringify({
    fact: 'Offline attempt accounting', blocks: 'daily admission', queries: ['offline synthetic query'], maxPages: 4,
  }));
  const collector = offlineQueue(env, projects[0], () => {
    const during = readAutoCollect(env);
    assertEqual(during.spent.pages, 6, 'the child started before its allowance was saved');
    assert(during.paused, 'the child started before its in-flight pause was saved');
    return Promise.resolve({ code: 1, output: 'offline failed exit', accounting: { type: 'research-kit-accounting', spent: 1, stoppedOn: '' } });
  });
  const status = await collector.cycle();
  assertEqual(status.spent.pages, 3, 'failed measured exit double-charged its allowance or lost earlier spend');
  assertEqual(status.paused, '');
  assertEqual(status.requests[0].status, 'failed');
  assertEqual(status.requests[0].pages, 1);
});
