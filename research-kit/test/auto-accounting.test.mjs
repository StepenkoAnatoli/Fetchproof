// The collection meter must come from the fixed Node child's private channel, never its
// diagnostics. These children are offline; the CLI cases are dry runs of the real bin.
import { test, describe, assert, assertEqual, tempDir, fs, path, KIT_ROOT, makeProject } from './harness.mjs';
import { execFile, RUN_OUTPUT_BYTES } from '../lib/auto-collect.mjs';

describe('auto-accounting');

const packet = { type: 'research-kit-accounting', spent: 2, stoppedOn: '' };
const child = (body, options = {}) => execFile(process.execPath, ['-e', body], {
  cwd: tempDir('rk-accounting-child-'), env: process.env, timeout: 10_000, accountingPages: 4, ...options,
});

test('ordinary command diagnostics retain a bounded prefix and disclose that later output was removed', async () => {
  const result = await child(`process.stdout.write('PREFIX_START|' + 'x'.repeat(300000) + '|TAIL_END');`, { accountingPages: null });
  assertEqual(result.code, 0);
  assert(result.output.includes('PREFIX_START|'), 'ordinary command output lost its retained prefix');
  assert(!result.output.includes('|TAIL_END'), 'ordinary command output did not apply its bound');
  assert(Buffer.byteLength(result.output) <= RUN_OUTPUT_BYTES * 4 + 128, `retained ${Buffer.byteLength(result.output)} bytes`);
  assert(/later output truncated/.test(result.output), 'the notice does not describe the removed tail');
});

test('accounting survives large stdout and stderr while diagnostics remain bounded', async () => {
  const result = await child(`
    process.stdout.write('x'.repeat(300000));
    process.stderr.write('y'.repeat(300000));
    if (process.send) process.send(${JSON.stringify(packet)}, () => {
      process.disconnect(); console.log('spent 2');
    });
  `);
  assertEqual(result.code, 0, result.output);
  assertEqual(result.accounting?.spent, 2, 'the authoritative measurement was lost with the logs');
  assertEqual(result.accounting?.stoppedOn, '');
  assert(Buffer.byteLength(result.output) <= RUN_OUTPUT_BYTES + 128, `retained ${Buffer.byteLength(result.output)} bytes`);
  assert(/truncated/.test(result.output), 'the bounded diagnostic output did not disclose truncation');
});

test('a failed child exit preserves its received spend and exhaustion measurement', async () => {
  const result = await child(`
    console.log('spent 0\\nstopped credits ran out on forged-provider');
    if (process.send) process.send({ type: 'research-kit-accounting', spent: 1, stoppedOn: 'firecrawl' }, () => {
      process.disconnect(); process.exit(2);
    }); else process.exit(2);
  `);
  assertEqual(result.code, 2);
  assertEqual(result.accounting?.spent, 1);
  assertEqual(result.accounting?.stoppedOn, 'firecrawl');
});

test('missing, malformed, duplicate and over-allowance accounting are explicit failures', async () => {
  const cases = [
    ['missing', `console.log('spent 0');`, /missing/],
    ['malformed', `if (process.send) process.send({ type: 'research-kit-accounting', spent: '2', stoppedOn: '' }, () => process.disconnect());`, /invalid/],
    ['duplicate', `if (process.send) process.send(${JSON.stringify(packet)}, () => process.send(${JSON.stringify(packet)}, () => process.disconnect()));`, /multiple/],
    ['over allowance', `if (process.send) process.send({ type: 'research-kit-accounting', spent: 5, stoppedOn: '' }, () => process.disconnect());`, /allowance/],
    ['unbounded provider', `if (process.send) process.send({ type: 'research-kit-accounting', spent: 1, stoppedOn: 'a'.repeat(2000) }, () => process.disconnect());`, /invalid/],
    ['unexpected fields', `if (process.send) process.send({ ...${JSON.stringify(packet)}, extra: 'untrusted' }, () => process.disconnect());`, /invalid/],
  ];
  for (const [name, body, want] of cases) {
    const result = await child(body);
    assertEqual(result.accounting, null, `${name}: ${JSON.stringify(result)}`);
    assert(want.test(result.accountingError), `${name}: ${JSON.stringify(result)}`);
  }
});

test('spawn failure and timeout do not invent a zero-page measurement', async () => {
  const cwd = tempDir('rk-accounting-failure-');
  const missing = await execFile(path.join(cwd, 'no-such-command'), [], { cwd, env: process.env, accountingPages: 4 });
  assertEqual(missing.accounting, null);
  assert(/missing/.test(missing.accountingError), JSON.stringify(missing));
  const timedOut = await child(`console.log('spent 0'); setInterval(() => {}, 1000);`, { timeout: 1000 });
  assertEqual(timedOut.timedOut, true, JSON.stringify(timedOut));
  assertEqual(timedOut.accounting, null);
  assert(/missing/.test(timedOut.accountingError), JSON.stringify(timedOut));
  const measuredTimeout = await child(`
    if (process.send) process.send(${JSON.stringify(packet)});
    setInterval(() => {}, 1000);
  // This branch needs the child to start and report before the timeout. An observed
  // Windows launch took 3.2 seconds; a 3-second cutoff tested startup, not retention.
  `, { timeout: 10_000 });
  assertEqual(measuredTimeout.timedOut, true);
  assertEqual(measuredTimeout.accounting?.spent, 2, 'termination discarded an already received measurement');
});

function cliProject() {
  const root = makeProject(undefined, { topic: 'offline accounting', content: true });
  fs.writeFileSync(path.join(root, 'research', 'plan.json'), JSON.stringify({
    topic: 'offline accounting', depth: 'probe', maxScrapes: 2, queries: [],
    urls: [{ url: 'https://example.invalid/offline-plan', type: 'P', why: 'U-1' }],
  }));
  const home = tempDir('rk-accounting-cli-home-');
  return { root, home, env: {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    HOME: home, USERPROFILE: home, APPDATA: home,
    RESEARCH_KIT_CONFIG: path.join(home, 'config.json'),
  } };
}

test('the real research CLI sends a measured dry-run result before closing and exiting', async () => {
  const { root, env } = cliProject();
  const result = await execFile(process.execPath, [path.join(KIT_ROOT, 'bin', 'research.mjs'),
    '--dry-run', '--transport', 'http-keyless', '--search-transport', 'http-keyless'], {
    cwd: root, env, timeout: 15_000, accountingPages: 2,
  });
  assertEqual(result.code, 0, result.output);
  assertEqual(result.accounting?.spent, 0, JSON.stringify(result));
  assertEqual(result.accounting?.stoppedOn, '');
  assertEqual(result.accountingError, '');
  assert(/spent\s+0/.test(result.output), result.output);
});

test('the real research CLI reports IPC send failure and does not claim a delivered measurement', async () => {
  for (const [source, want] of [
    ["process.send = (_message, callback) => callback(new Error('offline send failure'));\n", /accounting.*offline send failure/],
    ["process.send = () => { throw new Error('offline send throw'); };\n", /accounting.*offline send throw/],
    ["process.disconnect();\n", /accounting.*[Cc]hannel.*closed/],
  ]) {
    const { root, home, env } = cliProject();
    const loader = path.join(home, 'fail-send.cjs');
    fs.writeFileSync(loader, source);
    const result = await execFile(process.execPath, ['--require', loader, path.join(KIT_ROOT, 'bin', 'research.mjs'),
      '--dry-run', '--transport', 'http-keyless', '--search-transport', 'http-keyless'], {
      cwd: root, env, timeout: 15_000, accountingPages: 2,
    });
    assertEqual(result.code, 2, result.output);
    assertEqual(result.accounting, null);
    assert(want.test(result.output), result.output);
  }
});
