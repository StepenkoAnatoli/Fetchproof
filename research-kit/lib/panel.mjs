// panel.mjs - the desktop panel: a page on 127.0.0.1 over the kit's own commands (ADR-0147).
//
// The panel is a thin shell. It holds no rule of its own: every verdict it shows is
// printed by a command that already exists (doctor, handoff, preflight, install), run as a
// child with a FIXED argument list. The few things it writes or reads itself are:
//   - the search provider's key, into the machine config (never a repository, Rule 6);
//   - which project folder it is looking at, chosen explicitly, never searched for;
//   - the project's topic and BRIEF.md, read and never written (ADR-0056).
//
// It never collects on a command from the page. The one way pages are fetched through it is
// auto-collect (ADR-0148): a builder's request file, validated, run on a collector only,
// within the per-request and daily caps the operator set here, by the same research.mjs. A
// builder machine refuses it, as it refuses research.mjs itself.
//
// A local server answers whatever reaches its port, so four checks guard every request:
// the socket is bound to 127.0.0.1 only; the Host header must name that address and port
// (a rebinding DNS name does not); an Origin header, when sent, must be the panel's own; and
// every /api request carries the per-launch token, initialized from the launch URL's
// fragment. The launcher prints that URL; treat it as a capability. This module cannot
// promise that terminal logs or browser history/sync will keep it private.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KIT_VERSION, readJson, readText, homeCommand } from './core.mjs';
import { KIT_HOME, configPath, readMachineConfig, saveConfig, repoTopLevel } from './machine.mjs';
import { SEARCH_KEY } from './transport.mjs';
import { createAutoCollect, execFile } from './auto-collect.mjs';
import { REQUESTS_DIR, saveAutoCollect } from './requests.mjs';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PANEL_KIT_ROOT = path.resolve(SELF_DIR, '..');
export const PANEL_ASSETS = path.join(PANEL_KIT_ROOT, 'panel');
export const PANEL_HOST = '127.0.0.1';
export const TOKEN_HEADER = 'x-panel-token';
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const MAX_BRIEF_BYTES = 1024 * 1024;
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The only commands the panel runs, and the only arguments it passes them. Nothing the page
 * sends reaches an argument list. Collection is absent by design: research.mjs and
 * decompose.mjs spend credits, refuse on a builder, and stay in the terminal.
 */
export const PANEL_COMMANDS = Object.freeze({
  doctor: Object.freeze({ script: 'doctor.mjs', args: Object.freeze([]) }),
  handoff: Object.freeze({ script: 'handoff.mjs', args: Object.freeze([]) }),
  preflight: Object.freeze({ script: 'preflight.mjs', args: Object.freeze([]) }),
  'update-preview': Object.freeze({ script: 'install.mjs', args: Object.freeze(['--dry-run']), update: true }),
  update: Object.freeze({ script: 'install.mjs', args: Object.freeze([]), update: true }),
});

const ASSETS = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/panel.js': { file: 'panel.js', type: 'text/javascript; charset=utf-8' },
  '/panel.css': { file: 'panel.css', type: 'text/css; charset=utf-8' },
});

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
    + "img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

/** A search key as vendors issue them: printable ASCII, no spaces, bounded. Empty clears. */
export function keyProblem(value) {
  if (typeof value !== 'string') return 'the key must be text';
  const key = value.trim();
  if (key.length > 256) return 'that is longer than any search key';
  if (!/^[\x21-\x7e]*$/.test(key)) return 'a search key has no spaces or control characters';
  return '';
}

/** The project's topic as plan.json states it, or '' - read, never written (ADR-0056). */
export function projectTopic(project) {
  const plan = readJson(path.join(project, 'research', 'plan.json'), null);
  return plan && typeof plan.topic === 'string' ? plan.topic.trim() : '';
}

/**
 * What the collector hands a builder: the push on this machine, then the builder's own steps.
 * The builder is any AI agent or a person, on another machine; this text is
 * pasted to it. It restates the kit's rule, not a new one: the collector collects, the
 * builder builds, and a missing fact goes back to the collector (AGENTS.md, ADR-0010).
 * Commands are spelled for the standard install, because the text travels (ADR-0050).
 */
export function builderInstructions({ topic = '', brief = false } = {}) {
  const collector = [
    brief
      ? 'research/BRIEF.md is present. Complete the checks below before handing off dependent work.'
      : 'research/BRIEF.md does not exist yet - phase 1 is unfinished. The collector must complete it before dependent building.',
    'On the collector (this machine), verify handoff, preflight PASS, and reviewed research:',
    `  ${homeCommand('handoff.mjs')}`,
    `  ${homeCommand('preflight.mjs')}`,
    `  ${homeCommand('brief.mjs', '--state')}  # must say authored; inspect its judged sections and current inputs`,
    '  Check that the map is classified, Findings are rewritten, and the authored brief is complete.',
    '  A stamped brief must match the current corpus; the existing unstamped compatibility still applies.',
    'After those checks succeed, commit and push the corpus. Replace the report placeholders with observed results:',
    '  git add research/',
    '  git add -f research/raw/.fetches.jsonl',
    '  git commit -m "research: corpus and brief" \\',
    '    -m "what changed: collected corpus and builder brief" \\',
    '    -m "why: complete the phase-one handoff" \\',
    '    -m "what you verified: <actual commands/results, labeled verified, untested or expected>" \\',
    '    -m "what you got wrong: <record the correction and proof, or nothing to report>"',
    '  git push',
  ];
  const builder = [
    `You are the BUILDER for this project${topic ? `: "${topic}"` : ''}. Begin phase 2 only after the collector's review and the checks below succeed.`,
    '1. Pull or clone the repository. Declare this machine a builder, once:',
    `     ${homeCommand('install-hooks.mjs', '--role builder')}`,
    '2. Check the corpus arrived whole - it must exit 0:',
    `     ${homeCommand('handoff.mjs')}`,
    '3. Confirm the gate still passes here:',
    `     ${homeCommand('preflight.mjs')}`,
    `4. Check ${homeCommand('brief.mjs', '--state')} reports authored; read research/BRIEF.md whole.`,
    '   Check the answered judged sections, classified map, rewritten Findings and applicable gate warnings.',
    '   If the brief has an input stamp, it must be current. A missing, draft, incomplete or stale brief stops dependent work.',
    '   Once research is ready and the work is authorized, build from the brief and cite its E-## rows in code and tests.',
    '5. Do not collect, fetch pages or research facts yourself - this machine refuses to, by design.',
    '   If a fact you need is missing or wrong, ask the collector for it: write one file per fact,',
    `   ${REQUESTS_DIR}/<id>.json (id: lower-case letters, digits, dashes), commit it and push:`,
    '     { "fact": "<one fact, as a question a page answers>", "blocks": "<the decision it changes>",',
    '       "urls": ["https://<the page that owns the fact>"], "queries": ["<search, if no page is known>"] }',
    '   Optional: "prefer" (owner domains), "unknown" (an existing U-n row), "maxPages",',
    '   "topic" (a whole new research project instead of one fact).',
    '   The collector collects it automatically and pushes the corpus with <id>.result.json beside the',
    '   request. Pull and read the result and evidence. A collected result records delivery; dependent work',
    '   waits for the collector to record reviewed Findings, close the unknowns and update the current brief.',
    '   Report a review-only gap to the collector in prose; request a fetch only when a needed fact is missing.',
  ];
  return [
    ...collector,
    '',
    '--- builder checklist (an AI agent or a person): complete the readiness checks before building ---',
    ...builder,
  ].join('\n') + '\n';
}

/** The nearest folder that exists, at or above `dir` - git needs a real cwd. */
function existingAncestor(dir) {
  let current = path.resolve(dir);
  for (;;) {
    try { if (fs.statSync(current).isDirectory()) return current; } catch { /* keep climbing */ }
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/** Rule 6: the key is never written into a repository, whatever RESEARCH_KIT_CONFIG says. */
export function configInsideRepository(env = process.env) {
  const file = configPath(env);
  const parentRepo = repoTopLevel({ cwd: existingAncestor(path.dirname(file)), env });
  if (parentRepo) return parentRepo;
  let target = file;
  const seen = new Set();
  for (;;) {
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isSymbolicLink()) break;
      const canonical = path.resolve(target);
      if (seen.has(canonical)) break;
      seen.add(canonical);
      const link = fs.readlinkSync(target);
      target = path.resolve(path.dirname(target), link);
    } catch { break; }
  }
  try { target = fs.realpathSync.native(target); } catch { /* dangling destination: inspect its existing parent */ }
  return repoTopLevel({ cwd: existingAncestor(path.dirname(target)), env }) || '';
}

function sameCopy(a, b) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return real(a) === real(b);
}

/** Constant-time token comparison; a header of another length is simply wrong. */
function tokenMatches(given, token) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Build the panel. Nothing listens until `listen()`; tests inject the environment, the kit
 * copy and the install target so no host state is consulted.
 */
export function createPanel({
  project = process.cwd(),
  env = process.env,
  kitRoot = PANEL_KIT_ROOT,
  kitHome = KIT_HOME,
  assets = PANEL_ASSETS,
  nodePath = process.execPath,
  token = crypto.randomBytes(24).toString('hex'),
  timeout = RUN_TIMEOUT_MS,
  autoExec = execFile,
} = {}) {
  let currentProject = path.resolve(project);
  // One mutex for command runs, project switching and auto-collect cycles: none of them
  // may run while another changes the corpus or the kit tree under it.
  let running = null;
  const lock = {
    take(name) { if (running) return false; running = name; return true; },
    release(name) { if (running === name) running = null; },
  };
  const auto = createAutoCollect({
    project: () => currentProject,
    env,
    kitRoot,
    nodePath,
    exec: autoExec,
    redact: (text) => SEARCH_KEY.redact(text, SEARCH_KEY.read(env, readMachineConfig(env).settings)),
    lock,
  });
  let port = 0;

  const allowedHosts = () => new Set([`${PANEL_HOST}:${port}`, `localhost:${port}`]);
  const allowedOrigins = () => new Set([`http://${PANEL_HOST}:${port}`, `http://localhost:${port}`]);

  function keyState() {
    return {
      search: SEARCH_KEY.state(env, readMachineConfig(env).settings),
      // The kit never reads the Firecrawl key; the CLI does (transport.mjs). Only whether the
      // variable is present is reported - doctor says whether the CLI is logged in.
      firecrawl: { environment: typeof env.FIRECRAWL_API_KEY === 'string' && env.FIRECRAWL_API_KEY !== '' },
    };
  }

  function state() {
    const read = readMachineConfig(env);
    const topic = projectTopic(currentProject);
    const brief = fs.existsSync(path.join(currentProject, 'research', 'BRIEF.md'));
    return {
      kitVersion: KIT_VERSION,
      role: read.settings.role,
      configState: read.state,
      configPath: configPath(env),
      project: currentProject,
      isProject: fs.existsSync(path.join(currentProject, 'research')),
      topic,
      brief,
      builderInstructions: builderInstructions({ topic, brief }),
      keys: keyState(),
      update: { from: kitRoot, to: kitHome, sameCopy: sameCopy(kitRoot, kitHome) },
      running,
    };
  }

  function send(res, status, body, type = 'application/json; charset=utf-8') {
    const payload = type.startsWith('application/json') ? `${JSON.stringify(body)}\n` : body;
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
    res.end(payload);
  }

  const refuse = (res, status, error) => send(res, status, { error });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('the request is too large'), { status: 413 })); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(text ? JSON.parse(text) : {}); } catch { reject(Object.assign(new Error('the request is not JSON'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  function runCommand(name) {
    const spec = PANEL_COMMANDS[name];
    const script = path.join(kitRoot, 'bin', spec.script);
    return new Promise((resolve) => {
      const key = SEARCH_KEY.read(env, readMachineConfig(env).settings);
      let output = '';
      let truncated = false;
      const keep = (chunk) => {
        if (output.length >= MAX_OUTPUT_BYTES) { truncated = true; return; }
        output += chunk.toString('utf8');
      };
      let child;
      try {
        child = spawn(nodePath, [script, ...spec.args], { cwd: currentProject, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        resolve({ command: name, code: null, output: `could not start ${spec.script}: ${err.message}\n` });
        return;
      }
      const timer = setTimeout(() => { child.kill(); }, timeout);
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      child.on('error', (err) => { output += `could not start ${spec.script}: ${err.message}\n`; });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (truncated) output += '\n[output cut at 1 MB]\n';
        if (signal) output += `\n[stopped: ${signal}]\n`;
        resolve({ command: name, code, output: SEARCH_KEY.redact(output, key) });
      });
    });
  }

  async function api(req, res, route) {
    if (req.method === 'GET' && route === '/api/state') return send(res, 200, state());

    if (req.method === 'GET' && route === '/api/brief') {
      const file = path.join(currentProject, 'research', 'BRIEF.md');
      let size;
      try { size = fs.statSync(file).size; } catch { return refuse(res, 404, 'this project has no research/BRIEF.md yet'); }
      if (size > MAX_BRIEF_BYTES) return refuse(res, 413, 'research/BRIEF.md is larger than the panel shows; open it in an editor');
      return send(res, 200, { path: file, text: readText(file, '') });
    }

    if (req.method === 'GET' && route === '/api/requests') return send(res, 200, auto.status());

    if (req.method !== 'POST') return refuse(res, 405, 'not a panel route');
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return refuse(res, 415, 'send JSON');
    const body = await readBody(req);

    if (route === '/api/project') {
      const asked = typeof body.path === 'string' ? body.path.trim() : '';
      if (!asked || !path.isAbsolute(asked)) return refuse(res, 400, 'give the project folder as a full path');
      let stat;
      try { stat = fs.statSync(asked); } catch { return refuse(res, 404, 'that folder does not exist'); }
      if (!stat.isDirectory()) return refuse(res, 400, 'that is a file, not a folder');
      if (running) return refuse(res, 409, `${running} is still running; wait for it to finish`);
      currentProject = path.resolve(asked);
      return send(res, 200, state());
    }

    if (route === '/api/key/search') {
      const problem = keyProblem(body.key);
      if (problem) return refuse(res, 400, problem);
      const inside = configInsideRepository(env);
      if (inside) return refuse(res, 409, `the machine config is inside the repository at ${inside}; a key never goes into a repository (Rule 6). Point RESEARCH_KIT_CONFIG outside it.`);
      saveConfig({ [SEARCH_KEY.configKey]: body.key.trim() }, env);
      return send(res, 200, { saved: true, keys: keyState() });
    }

    if (route === '/api/autocollect') {
      const patch = body.settings;
      try { saveAutoCollect(patch, env); } catch (err) { return refuse(res, err.status ?? 400, err.message); }
      auto.schedule();
      return send(res, 200, auto.status());
    }

    if (route === '/api/requests/check') {
      if (running) return refuse(res, 409, `${running} is still running; wait for it to finish`);
      return send(res, 200, await auto.cycle({ force: true }));
    }

    if (route === '/api/requests/resume') return send(res, 200, auto.resume());

    if (route === '/api/run') {
      const name = typeof body.command === 'string' ? body.command : '';
      if (!Object.hasOwn(PANEL_COMMANDS, name)) {
        return refuse(res, 400, `"${name}" is not a panel command. The panel runs ${Object.keys(PANEL_COMMANDS).join(', ')} and never collects on a command; pages are fetched only for a builder's request, by auto-collect on the collector machine.`);
      }
      if (PANEL_COMMANDS[name].update && sameCopy(kitRoot, kitHome)) {
        return refuse(res, 409, 'this panel runs from the installed copy, so there is nothing newer to install from. '
          + 'Update the downloaded kit (git pull, or a new download), then start the panel from that copy and press Update.');
      }
      if (!lock.take(name)) return refuse(res, 409, `${running} is still running; wait for it to finish`);
      try {
        return send(res, 200, await runCommand(name));
      } finally {
        lock.release(name);
      }
    }

    return refuse(res, 404, 'not a panel route');
  }

  async function handle(req, res) {
    if (!allowedHosts().has(String(req.headers.host ?? ''))) return refuse(res, 421, 'the panel answers only on its own address');
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins().has(origin)) return refuse(res, 403, 'requests from another site are refused');
    let route;
    try { route = new URL(req.url, `http://${PANEL_HOST}`).pathname; } catch { return refuse(res, 400, 'bad request'); }

    if (route.startsWith('/api/')) {
      if (!tokenMatches(req.headers[TOKEN_HEADER], token)) return refuse(res, 401, 'open the panel from the address it printed; the token is missing or wrong');
      try {
        return await api(req, res, route);
      } catch (err) {
        return refuse(res, err.status ?? 500, err.status ? err.message : 'the panel hit an error; the terminal that started it has the detail');
      }
    }

    const asset = req.method === 'GET' ? ASSETS[route] : null;
    if (!asset) return refuse(res, 404, 'not found');
    let text;
    try { text = fs.readFileSync(path.join(assets, asset.file), 'utf8'); } catch { return refuse(res, 500, `the panel's ${asset.file} is missing from this copy of the kit`); }
    return send(res, 200, text, asset.type);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      process.stderr.write(`panel: ${err.stack ?? err}\n`);
      if (!res.headersSent) refuse(res, 500, 'the panel hit an error');
      else res.end();
    });
  });

  return {
    server,
    token,
    state,
    get project() { return currentProject; },
    /** Listen on 127.0.0.1 only; resolves to the address to open, token in the fragment. */
    listen(wanted = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(wanted, PANEL_HOST, () => {
          server.off('error', reject);
          port = server.address().port;
          auto.schedule();
          resolve({ port, url: `http://${PANEL_HOST}:${port}/#t=${token}` });
        });
      });
    },
    autoCollect: auto,
    close() {
      auto.stop();
      return new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
    },
  };
}
