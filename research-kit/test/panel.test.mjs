// The desktop panel (ADR-0147): a page on 127.0.0.1 over the kit's own commands. Every test
// runs against a disposable machine config and, where a command runs, a stand-in kit whose
// bin/ scripts only report what they were given - nothing collects, nothing reaches a network.

import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { test, describe, assert, assertEqual, tempDir, fs, path, makeProject, requireGit, requireSymlink, fixtureInitArgs, KIT_ROOT } from './harness.mjs';
import { writeText, readText } from '../lib/core.mjs';
import { createPanel, PANEL_COMMANDS, PANEL_HOST, keyProblem, projectTopic, builderInstructions } from '../lib/panel.mjs';
import { writeResult, recordTrustedResult, setPaused } from '../lib/requests.mjs';

describe('panel');

const KEY = 'serp-test-key-0123456789abcdef';

/** A stand-in kit: each script prints its cwd, its argv, and the key if the env hands one over. */
function standInKit() {
  const root = tempDir('research-kit-panel-kit-');
  const script = "console.log(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), key: process.env.SERPAPI_API_KEY || '' }));\n";
  for (const name of ['doctor.mjs', 'handoff.mjs', 'preflight.mjs', 'install.mjs', 'research.mjs', 'decompose.mjs']) {
    writeText(path.join(root, 'bin', name), script);
  }
  return root;
}

function machine(extraEnv = {}) {
  const dir = tempDir('research-kit-panel-machine-');
  const configFile = path.join(dir, 'research-kit.config.json');
  const env = { ...process.env, RESEARCH_KIT_CONFIG: configFile, ...extraEnv };
  delete env.SERPAPI_API_KEY;
  delete env.FIRECRAWL_API_KEY;
  Object.assign(env, extraEnv);
  return { dir, configFile, env };
}

async function started(options = {}) {
  const { env } = options.machine ?? machine();
  const panel = createPanel({ env, kitHome: tempDir('research-kit-panel-home-'), ...options });
  const { port, url } = await panel.listen(0);
  return { panel, port, url };
}

/** A raw request, so Host and Origin can be set the way a hostile page or a rebinding name would. */
function request(port, { method = 'GET', route = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: PANEL_HOST, port, method, path: route, headers: { host: `${PANEL_HOST}:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* an asset */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const api = (ctx, route, body) => request(ctx.port, {
  method: body === undefined ? 'GET' : 'POST',
  route,
  headers: { 'x-panel-token': ctx.panel.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  body,
});

test('the panel listens on 127.0.0.1 only and puts its token in the fragment, never the path', async () => {
  const ctx = await started({ project: makeProject(undefined, { topic: 'Panel topic', content: true }) });
  try {
    assertEqual(ctx.panel.server.address().address, '127.0.0.1');
    assert(ctx.url.startsWith(`http://127.0.0.1:${ctx.port}/#t=`), ctx.url);
    assert(ctx.panel.token.length >= 32, 'the token is too short to be a secret');
  } finally { await ctx.panel.close(); }
});

test('the state names the topic from plan.json, the role and the project, and no key', async () => {
  const m = machine({ SERPAPI_API_KEY: KEY });
  const project = makeProject(undefined, { topic: 'Panel topic', content: true });
  const ctx = await started({ machine: m, project });
  try {
    const res = await api(ctx, '/api/state');
    assertEqual(res.status, 200);
    assertEqual(res.json.topic, 'Panel topic');
    assertEqual(res.json.role, 'collector');
    assertEqual(res.json.project, path.resolve(project));
    assertEqual(res.json.keys.search.set, true);
    assertEqual(res.json.keys.search.source, 'environment');
    assert(!res.text.includes(KEY), 'the state echoed the key');
  } finally { await ctx.panel.close(); }
});

test('diagnostic redaction protects inherited result details and pause text in the panel request payload', async () => {
  const m = machine({ SERPAPI_API_KEY: KEY });
  const project = fs.realpathSync.native(makeProject(undefined, { topic: 'Inherited diagnostics', content: true }));
  writeText(path.join(project, 'research', 'requests', 'legacy.json'), JSON.stringify({
    fact: 'What is the limit?', blocks: 'retry design', urls: ['https://docs.example.com/limits'],
  }));
  const resultFile = writeResult(project, 'legacy', { status: 'failed', pages: 2, detail: `provider failed: ${KEY}` });
  recordTrustedResult(project, 'legacy', m.env);
  setPaused(`inspect failed provider ${KEY}`, m.env);
  const original = readText(resultFile);
  const ctx = await started({ machine: m, project });
  try {
    const res = await api(ctx, '/api/requests');
    assertEqual(res.status, 200);
    assertEqual(res.json.requests[0].status, 'failed', 'redaction invalidated collector-local result trust');
    assertEqual(res.json.requests[0].pages, 2);
    assert(!res.text.includes(KEY), 'the panel exposed an inherited diagnostic secret');
    assert(res.json.requests[0].detail.includes('***REDACTED***'), 'the inherited diagnosis was discarded');
    assert(res.json.paused.includes('***REDACTED***'), 'the pause diagnosis was discarded');
    assertEqual(readText(resultFile), original, 'reading status rewrote an inherited trusted result');
  } finally { await ctx.panel.close(); }
});

test('the state reports a builder machine as a builder', async () => {
  const m = machine();
  writeText(m.configFile, JSON.stringify({ role: 'builder' }));
  const ctx = await started({ machine: m, project: makeProject() });
  try {
    assertEqual((await api(ctx, '/api/state')).json.role, 'builder');
  } finally { await ctx.panel.close(); }
});

test('an /api request without the token, or with a wrong one, is refused', async () => {
  const ctx = await started({ project: makeProject() });
  try {
    assertEqual((await request(ctx.port, { route: '/api/state' })).status, 401);
    assertEqual((await request(ctx.port, { route: '/api/state', headers: { 'x-panel-token': 'x'.repeat(48) } })).status, 401);
    assertEqual((await request(ctx.port, { route: '/api/state', headers: { 'x-panel-token': 'short' } })).status, 401);
  } finally { await ctx.panel.close(); }
});

test('a request naming another host is refused - a rebinding DNS name does not reach the API', async () => {
  const ctx = await started({ project: makeProject() });
  try {
    const res = await request(ctx.port, { route: '/api/state', headers: { host: `evil.example:${ctx.port}`, 'x-panel-token': ctx.panel.token } });
    assertEqual(res.status, 421);
    assertEqual((await request(ctx.port, { route: '/', headers: { host: 'evil.example' } })).status, 421);
  } finally { await ctx.panel.close(); }
});

test('a request from another origin is refused, even with the token', async () => {
  const ctx = await started({ project: makeProject() });
  try {
    const res = await request(ctx.port, {
      method: 'POST', route: '/api/run',
      headers: { origin: 'https://evil.example', 'x-panel-token': ctx.panel.token, 'content-type': 'application/json' },
      body: { command: 'doctor' },
    });
    assertEqual(res.status, 403);
    const own = await request(ctx.port, { route: '/api/state', headers: { origin: `http://127.0.0.1:${ctx.port}`, 'x-panel-token': ctx.panel.token } });
    assertEqual(own.status, 200);
  } finally { await ctx.panel.close(); }
});

test('a POST that is not JSON is refused, so a plain cross-site form cannot reach it', async () => {
  const ctx = await started({ project: makeProject() });
  try {
    const res = await request(ctx.port, { method: 'POST', route: '/api/run', headers: { 'x-panel-token': ctx.panel.token, 'content-type': 'text/plain' }, body: '{"command":"doctor"}' });
    assertEqual(res.status, 415);
  } finally { await ctx.panel.close(); }
});

test('the page is served with a strict content policy and no referrer, and carries no token', async () => {
  const ctx = await started({ project: makeProject() });
  try {
    const res = await request(ctx.port, { route: '/' });
    assertEqual(res.status, 200);
    assert(/script-src 'self'/.test(res.headers['content-security-policy']), 'no script-src');
    assertEqual(res.headers['referrer-policy'], 'no-referrer');
    assert(!res.text.includes(ctx.panel.token), 'the page embeds the token');
    assertEqual((await request(ctx.port, { route: '/panel.js' })).status, 200);
    assertEqual((await request(ctx.port, { route: '/panel.css' })).status, 200);
    assertEqual((await request(ctx.port, { route: '/../lib/panel.mjs' })).status, 404);
  } finally { await ctx.panel.close(); }
});

test('the page never writes server text as HTML', () => {
  const js = readText(new URL('../panel/panel.js', import.meta.url), '');
  assert(js.length > 0, 'panel.js is missing');
  assert(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js), 'panel.js writes HTML');
  assert(/button\.type = 'button'/.test(js) && /aria-label/.test(js), 'request output has no keyboard-accessible control');
});

test('saving the search key writes the machine config and never echoes the key', async () => {
  const m = machine();
  const ctx = await started({ machine: m, project: makeProject() });
  try {
    const res = await api(ctx, '/api/key/search', { key: `  ${KEY}  ` });
    assertEqual(res.status, 200);
    assertEqual(res.json.keys.search.set, true);
    assertEqual(res.json.keys.search.source, 'config');
    assert(!res.text.includes(KEY), 'the response echoed the key');
    assertEqual(JSON.parse(readText(m.configFile)).serpapiKey, KEY);
    assert(!(await api(ctx, '/api/state')).text.includes(KEY), 'the state echoed the key');
    const cleared = await api(ctx, '/api/key/search', { key: '' });
    assertEqual(cleared.json.keys.search.set, false);
  } finally { await ctx.panel.close(); }
});

test('a key with a space, a control character or no text is refused', () => {
  assert(keyProblem('has space'), 'a space passed');
  assert(keyProblem('a\u0000b'), 'a NUL passed');
  assert(keyProblem(42), 'a number passed');
  assert(keyProblem('x'.repeat(300)), 'an overlong key passed');
  assertEqual(keyProblem(KEY), '');
  assertEqual(keyProblem(''), '');
});

test('the key is never written into a repository, whatever RESEARCH_KIT_CONFIG says', async () => {
  requireGit('a machine config inside a repository');
  const repo = tempDir('research-kit-panel-repo-');
  const init = spawnSync('git', fixtureInitArgs(), { cwd: repo, encoding: 'utf8' });
  assertEqual(init.status, 0, init.stderr);
  const m = machine({ RESEARCH_KIT_CONFIG: path.join(repo, 'cfg', 'research-kit.config.json') });
  const ctx = await started({ machine: m, project: makeProject() });
  try {
    const res = await api(ctx, '/api/key/search', { key: KEY });
    assertEqual(res.status, 409);
    assert(/Rule 6/.test(res.json.error), res.json.error);
    assert(!fs.existsSync(path.join(repo, 'cfg', 'research-kit.config.json')), 'the config was written into the repository');
  } finally { await ctx.panel.close(); }
});

test('the key is refused when an outside config path symlinks into a repository', async () => {
  requireGit('a machine config symlink into a repository');
  const repo = tempDir('research-kit-panel-config-target-');
  const init = spawnSync('git', fixtureInitArgs(), { cwd: repo, encoding: 'utf8' });
  assertEqual(init.status, 0, init.stderr);
  const target = path.join(repo, 'research-kit.config.json');
  writeText(target, '{}\n');
  const external = tempDir('research-kit-panel-config-link-');
  const link = path.join(external, 'research-kit.config.json');
  requireSymlink(target, link, 'outside config symlink');
  const m = machine({ RESEARCH_KIT_CONFIG: link });
  const ctx = await started({ machine: m, project: makeProject() });
  try {
    const res = await api(ctx, '/api/key/search', { key: KEY });
    assertEqual(res.status, 409);
    assert(/Rule 6/.test(res.json.error), res.json.error);
    assertEqual(readText(target), '{}\n', 'the key was written through the symlink');
  } finally { await ctx.panel.close(); }
});

test('the key is refused through a chain of dangling config symlinks into a repository', async () => {
  requireGit('a machine config symlink chain into a repository');
  const repo = tempDir('research-kit-panel-config-chain-target-');
  const init = spawnSync('git', fixtureInitArgs(), { cwd: repo, encoding: 'utf8' });
  assertEqual(init.status, 0, init.stderr);
  const target = path.join(repo, 'cfg', 'research-kit.config.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const external = tempDir('research-kit-panel-config-chain-');
  const middle = path.join(external, 'middle.json');
  const link = path.join(external, 'research-kit.config.json');
  requireSymlink(target, middle, 'dangling middle config symlink');
  requireSymlink(middle, link, 'outside config symlink');
  const m = machine({ RESEARCH_KIT_CONFIG: link });
  const ctx = await started({ machine: m, project: makeProject() });
  try {
    const res = await api(ctx, '/api/key/search', { key: KEY });
    assertEqual(res.status, 409);
    assert(/Rule 6/.test(res.json.error), res.json.error);
    assert(!fs.existsSync(target), 'the key was written through the dangling symlink chain');
  } finally { await ctx.panel.close(); }
});

test('the panel never collects: research and decompose are not commands it runs', async () => {
  for (const name of ['research', 'decompose', 'collect', '__proto__', 'constructor']) {
    assert(!Object.hasOwn(PANEL_COMMANDS, name), `${name} is a panel command`);
  }
  for (const spec of Object.values(PANEL_COMMANDS)) {
    assert(!['research.mjs', 'decompose.mjs', 'collect-remote.mjs'].includes(spec.script), `${spec.script} is reachable`);
  }
  const m = machine();
  writeText(m.configFile, JSON.stringify({ role: 'builder' }));
  const ctx = await started({ machine: m, project: makeProject(), kitRoot: standInKit() });
  try {
    for (const command of ['research', 'decompose', 'constructor']) {
      const res = await api(ctx, '/api/run', { command });
      assertEqual(res.status, 400, `${command} was not refused`);
      assert(/never collects/.test(res.json.error), res.json.error);
    }
  } finally { await ctx.panel.close(); }
});

test('doctor, handoff and preflight run in the project folder with no argument from the page, and the key is redacted', async () => {
  const m = machine({ SERPAPI_API_KEY: KEY });
  const project = makeProject();
  const ctx = await started({ machine: m, project, kitRoot: standInKit() });
  try {
    for (const command of ['doctor', 'handoff', 'preflight']) {
      const res = await api(ctx, '/api/run', { command, args: ['--evil'] });
      assertEqual(res.status, 200);
      assertEqual(res.json.code, 0);
      assert(!res.text.includes(KEY), `${command}'s output carried the key`);
      const printed = JSON.parse(res.json.output.trim());
      assertEqual(fs.realpathSync(printed.cwd), fs.realpathSync(project));
      assertEqual(printed.argv.length, 0, `${command} received arguments`);
      assertEqual(printed.key, '***REDACTED***');
    }
  } finally { await ctx.panel.close(); }
});

test('update is refused when the panel runs from the installed copy, and runs install from a download otherwise', async () => {
  const kit = standInKit();
  const same = await started({ project: makeProject(), kitRoot: kit, kitHome: kit });
  try {
    const res = await api(same, '/api/run', { command: 'update' });
    assertEqual(res.status, 409);
    assert(/installed copy/.test(res.json.error), res.json.error);
    assertEqual((await api(same, '/api/state')).json.update.sameCopy, true);
  } finally { await same.panel.close(); }

  const other = await started({ project: makeProject(), kitRoot: kit });
  try {
    const preview = await api(other, '/api/run', { command: 'update-preview' });
    assertEqual(preview.status, 200);
    assertEqual(JSON.parse(preview.json.output.trim()).argv.join(' '), '--dry-run');
    const update = await api(other, '/api/run', { command: 'update' });
    assertEqual(JSON.parse(update.json.output.trim()).argv.length, 0);
  } finally { await other.panel.close(); }
});

test('the project is chosen by a full path to a folder that exists, and nothing is searched for', async () => {
  const first = makeProject(undefined, { topic: 'First topic', content: true });
  const second = makeProject(undefined, { topic: 'Second topic', content: true });
  const ctx = await started({ project: first });
  try {
    assertEqual((await api(ctx, '/api/project', { path: 'relative/folder' })).status, 400);
    assertEqual((await api(ctx, '/api/project', { path: path.join(second, 'nope') })).status, 404);
    assertEqual((await api(ctx, '/api/project', { path: path.join(second, 'research', 'plan.json') })).status, 400);
    const res = await api(ctx, '/api/project', { path: second });
    assertEqual(res.status, 200);
    assertEqual(res.json.topic, 'Second topic');
    assertEqual(ctx.panel.project, path.resolve(second));
  } finally { await ctx.panel.close(); }
});

test('an auto-collect cycle and a command run share one lock: neither runs beside the other, nor does a project switch', async () => {
  const first = makeProject();
  const second = makeProject();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const autoExec = async () => { calls += 1; await gate; return { code: 1, output: '' }; };
  const ctx = await started({ project: first, kitRoot: standInKit(), autoExec });
  try {
    const cycle = ctx.panel.autoCollect.cycle({ force: true });
    assertEqual(calls, 1, 'the cycle did not start');
    assertEqual((await api(ctx, '/api/state')).json.running, 'auto-collect');
    const run = await api(ctx, '/api/run', { command: 'preflight' });
    assertEqual(run.status, 409, 'a command ran beside a collection cycle');
    assertEqual((await api(ctx, '/api/project', { path: second })).status, 409, 'the project switched under a cycle');
    assertEqual((await api(ctx, '/api/requests/check', {})).status, 409);
    release();
    await cycle;
    assertEqual((await api(ctx, '/api/state')).json.running, null, 'the cycle kept the lock');
    assertEqual((await api(ctx, '/api/run', { command: 'preflight' })).status, 200);
  } finally { release(); await ctx.panel.close(); }
});

test('the brief is read from the project and never written', async () => {
  const project = makeProject(undefined, { content: true });
  const brief = path.join(project, 'research', 'BRIEF.md');
  fs.rmSync(brief, { force: true });
  const ctx = await started({ project });
  try {
    assertEqual((await api(ctx, '/api/brief')).status, 404);
    writeText(brief, '# Brief\n\nReviewed by: agent\n');
    const res = await api(ctx, '/api/brief');
    assertEqual(res.status, 200);
    assert(res.json.text.includes('Reviewed by: agent'));
    assertEqual((await api(ctx, '/api/brief', {})).status, 404);
  } finally { await ctx.panel.close(); }
});

test('projectTopic reads plan.json and is empty outside a project', () => {
  assertEqual(projectTopic(tempDir()), '');
  assertEqual(projectTopic(makeProject(undefined, { topic: 'Read topic', content: true })), 'Read topic');
});

test('bin/panel.mjs refuses an unknown flag and a bad port before listening', () => {
  const bin = path.join(KIT_ROOT, 'bin', 'panel.mjs');
  const unknown = spawnSync(process.execPath, [bin, '--collect'], { encoding: 'utf8' });
  assertEqual(unknown.status, 2);
  assert(/unknown option --collect/.test(unknown.stderr), unknown.stderr);
  const port = spawnSync(process.execPath, [bin, '--port', 'abc', '--no-open'], { encoding: 'utf8' });
  assertEqual(port.status, 2);
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assertEqual(help.status, 0);
  assert(/never collects/.test(help.stdout), help.stdout);
});

test('connecting a builder hands it the phase-2 steps of the kit: handoff, preflight, the brief, and never collect', async () => {
  const text = builderInstructions({ topic: 'Hand-off topic', brief: true });
  assert(text.includes('git add -f research/raw/.fetches.jsonl'), 'the ledger push is missing');
  assert(text.includes('--role builder'), 'the builder is not told to declare its role');
  assert(/handoff\.mjs[\s\S]*preflight\.mjs[\s\S]*BRIEF\.md/.test(text), 'the phase-2 order is wrong');
  assert(/Do not collect/.test(text), 'the builder is not told it never collects');
  assert(!/research\.mjs|decompose\.mjs/.test(text), 'a collecting command reached the builder');
  assert(text.includes('$HOME/.agents/research-kit/bin/'), 'the text names a path that does not travel');
  const missing = builderInstructions({ brief: false });
  assert(/does not exist yet/.test(missing), 'a missing brief is not said');
  assert.doesNotMatch(missing, /the collector has finished phase 1/i,
    'missing-brief instructions claim that research is finished');
  assert.doesNotMatch(text, /what you verified: verified preflight PASS and handoff checks/,
    'the panel supplied a verification claim without observing those checks');
  assert(/brief\.mjs[\s\S]*authored/.test(text), 'file presence must not substitute for brief review');
  assert(/current|stale/.test(text), 'the builder is not told to check the brief against current inputs');

  const project = makeProject(undefined, { topic: 'Hand-off topic', content: true });
  const ctx = await started({ project });
  try {
    const state = (await api(ctx, '/api/state')).json;
    assert(state.builderInstructions.includes('"Hand-off topic"'), 'the state does not carry the builder text');
  } finally { await ctx.panel.close(); }
});

test('the panel names no runtime: the builder is any agent or a person (ADR-0012)', () => {
  const dir = path.join(KIT_ROOT, 'panel');
  const texts = [builderInstructions({ topic: 'x', brief: true }), ...['index.html', 'panel.js'].map((f) => readText(path.join(dir, f), ''))];
  for (const text of texts) assert.doesNotMatch(text, /\b(claude|gpt|gemini|opus|sonnet|haiku|copilot|codex|cursor)\b/i);
});
