// requests.mjs - a builder's fact request as a file, and what the collector does with it (ADR-0148).
//
// The builder decides WHAT is collected; the collector alone fetches it (ADR-0010). A request is
// one JSON file, `research/requests/<id>.json`, written by the builder - an AI agent or a
// person - and carried by git. It is the `fact-request` skill's request in machine-readable
// form. This module holds no I/O beyond the project's own files: it validates a request, writes
// it into the contract and plan.json, writes the plan for that one run, and records the result
// beside the request. Running the collection is `lib/auto-collect.mjs`.
//
// A request is untrusted input that arrived over git, so it is checked before anything reads it
// as an instruction: a fixed set of fields, bounded sizes, http(s) pages only, and no page on
// this machine's own network - the collector must not be talked into fetching its own panel or
// a cloud metadata endpoint (ADR-0110).

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { HEADERS, parseJson, readJson, readText, writeJson, today, nowIso } from './core.mjs';
import { duplicateKey, parseTable, appendRow } from './corpus.mjs';
import { DEPTH_SCRAPES, readPlan } from './research-run.mjs';
import { internalTarget, isInternal } from './http-transport.mjs';
import { configPath } from './machine.mjs';

export const REQUESTS_DIR = 'research/requests';
export const REQUEST_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const MAX_REQUEST_BYTES = 16 * 1024;

/** The fields a request may carry, and the most of each. Anything else is refused. */
export const REQUEST_LIMITS = Object.freeze({
  fact: 300,
  blocks: 300,
  topic: 200,
  urls: 10,
  queries: 5,
  query: 200,
  prefer: 10,
  preferEntry: 100,
  maxPages: 25,
});
const FIELDS = new Set(['fact', 'blocks', 'urls', 'queries', 'prefer', 'unknown', 'maxPages', 'topic']);

/** The auto-collect settings, machine-local beside the machine config: no key is in them. */
export const AUTO_COLLECT_DEFAULTS = Object.freeze({
  mode: 'off',
  perRequestPages: 4,
  dailyPages: 20,
  intervalMinutes: 5,
  topicsFolder: '',
});
export const AUTO_COLLECT_MODES = Object.freeze(['off', 'auto']);

const text = (v) => typeof v === 'string' && v.trim() !== '';

/** Why `url` may not be requested, or '' when it may. Judged by spelling; the transports judge the address. */
export function urlProblem(url) {
  let u;
  try { u = new URL(String(url)); } catch { return 'is not a URL'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'is not http or https';
  if (u.username || u.password) return 'carries a user name or password';
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return 'is this machine';
  if (net.isIP(host) && isInternal(host)) return 'is an internal address';
  return '';
}

/**
 * Every reason `request` (the parsed file) cannot be collected; [] when it can. `perRequestPages`
 * is the collector's cap: a request asking for more is refused, not quietly trimmed, so the
 * builder learns the limit instead of receiving less than it asked for.
 */
export function requestProblems(request, { perRequestPages = AUTO_COLLECT_DEFAULTS.perRequestPages } = {}) {
  const out = [];
  if (!request || typeof request !== 'object' || Array.isArray(request)) return ['the request must be a JSON object'];
  for (const key of Object.keys(request)) if (!FIELDS.has(key)) out.push(`unknown field "${key}" - a request has ${[...FIELDS].join(', ')}`);
  for (const key of ['fact', 'blocks']) {
    if (!text(request[key])) out.push(`"${key}" is required text`);
    else if (request[key].length > REQUEST_LIMITS[key]) out.push(`"${key}" is longer than ${REQUEST_LIMITS[key]} characters - name one fact`);
  }
  if (request.topic !== undefined && (!text(request.topic) || request.topic.length > REQUEST_LIMITS.topic)) {
    out.push(`"topic" must be text of at most ${REQUEST_LIMITS.topic} characters`);
  }
  if (request.unknown !== undefined && !(typeof request.unknown === 'string' && /^U-\d+$/.test(request.unknown))) {
    out.push('"unknown" must name a contract row such as "U-3"');
  }
  if (request.unknown !== undefined && request.topic !== undefined) out.push('"unknown" names a row of THIS project; a new topic has no rows yet');
  const urls = request.urls ?? [];
  const queries = request.queries ?? [];
  const prefer = request.prefer ?? [];
  if (!Array.isArray(urls)) out.push('"urls" must be a list of pages');
  else {
    if (urls.length > REQUEST_LIMITS.urls) out.push(`at most ${REQUEST_LIMITS.urls} urls`);
    urls.forEach((url, i) => { const why = urlProblem(url); if (why) out.push(`urls[${i}] ${why}: ${String(url).slice(0, 200)}`); });
  }
  if (!Array.isArray(queries)) out.push('"queries" must be a list of search queries');
  else {
    if (queries.length > REQUEST_LIMITS.queries) out.push(`at most ${REQUEST_LIMITS.queries} queries`);
    queries.forEach((q, i) => { if (!text(q) || q.length > REQUEST_LIMITS.query) out.push(`queries[${i}] must be text of at most ${REQUEST_LIMITS.query} characters`); });
  }
  if (!Array.isArray(prefer)) out.push('"prefer" must be a list of domains');
  else {
    if (prefer.length > REQUEST_LIMITS.prefer) out.push(`at most ${REQUEST_LIMITS.prefer} prefer entries`);
    prefer.forEach((p, i) => {
      if (typeof p !== 'string' || p.length > REQUEST_LIMITS.preferEntry || !/^[a-z0-9.-]+(\/\S*)?$/i.test(p)) out.push(`prefer[${i}] must be a domain such as "docs.example.com"`);
    });
  }
  if (Array.isArray(urls) && Array.isArray(queries) && !urls.length && !queries.length) out.push('give the owner page in "urls", or "queries" to search for it');
  if (request.maxPages !== undefined) {
    if (!Number.isInteger(request.maxPages) || request.maxPages < 1 || request.maxPages > REQUEST_LIMITS.maxPages) {
      out.push(`"maxPages" must be a whole number from 1 to ${REQUEST_LIMITS.maxPages}`);
    } else if (request.maxPages > perRequestPages) {
      out.push(`"maxPages" ${request.maxPages} is over this collector's budget of ${perRequestPages} page(s) a request`);
    }
  }
  return out;
}

/** Resolve builder-supplied hosts before collection; the fetch transport still guards rebinding. */
export async function requestProblemsResolved(request, { resolveInternal = internalTarget, ...options } = {}) {
  const out = requestProblems(request, options);
  if (!Array.isArray(request?.urls)) return out;
  for (const [i, value] of request.urls.entries()) {
    const problem = urlProblem(value);
    if (problem) continue;
    const host = new URL(value).hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) continue;
    const internal = await resolveInternal(host);
    if (internal) out.push(`urls[${i}] ${internal}`);
  }
  return out;
}

/** The pages one request may spend: what it asked for, or the collector's cap. */
export function requestPages(request, perRequestPages) {
  return Number.isInteger(request?.maxPages) ? Math.min(request.maxPages, perRequestPages) : perRequestPages;
}

/** True when `file` is a symbolic link, dangling or not. */
function isSymlink(file) {
  try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; }
}

/** Refuse to write a collector-owned file through a link: `writeText` follows link targets. */
function refuseSymlink(file) {
  if (isSymlink(file)) throw new Error(`${path.basename(file)} is a symbolic link - the collector does not write through links`);
}

/** Reject linked path components under the project before reading or writing collector files. */
function refuseLinkedPath(project, relative) {
  let current = path.resolve(project);
  const root = current;
  for (const part of relative.split(/[\\/]+/).filter(Boolean)) {
    current = path.join(current, part);
    if (isSymlink(current)) throw new Error(`${path.relative(root, current)} is a symbolic link - the collector does not read or write through links`);
  }
}

/**
 * Every request in the project, oldest name first: `{ id, file, request, parseError, result }`.
 * A name that is not an id is listed with `ignored` and never read - the result file it would
 * need could not be named safely. So is a request that is, or whose `.plan.json`/`.result.json`
 * is, a symbolic link: a link committed by a builder would make the collector read or overwrite
 * a file of its own machine.
 */
export function listRequests(project) {
  const dir = path.join(project, REQUESTS_DIR);
  if (['research', REQUESTS_DIR].some((p) => isSymlink(path.join(project, p)))) return [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (/\.(result|plan)\.json$/.test(name)) continue;
    const id = name.slice(0, -'.json'.length);
    const file = path.join(dir, name);
    if (!REQUEST_ID.test(id)) { out.push({ id, file, ignored: 'the name must be lower-case letters, digits and dashes' }); continue; }
    const linked = [file, path.join(dir, `${id}.plan.json`), path.join(dir, `${id}.result.json`)].filter(isSymlink);
    if (linked.length) { out.push({ id, file, ignored: `${linked.map((f) => path.basename(f)).join(', ')} is a symbolic link` }); continue; }
    let request = null;
    let parseError = '';
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* listed, then unreadable */ }
    if (size > MAX_REQUEST_BYTES) parseError = `the file is larger than ${MAX_REQUEST_BYTES} bytes`;
    else {
      try { request = JSON.parse(readText(file, '')); } catch (err) { parseError = `does not parse as JSON (${err.message})`; }
    }
    out.push({ id, file, request, parseError, result: readJson(path.join(dir, `${id}.result.json`), null) });
  }
  return out;
}

/** The status of a contract unknown, or '' when it is not present. */
export function contractUnknownStatus(project, id) {
  const table = parseTable(readText(path.join(project, 'research', 'DISCOVERY.md'), ''), HEADERS.unknowns);
  const row = table.rows.find((entry) => String(entry.cells[0] ?? '').trim() === id);
  return String(row?.cells[3] ?? '').trim().toUpperCase();
}

/**
 * Write the request into the project: its contract row (a new OPEN row, or the row it names),
 * its entries in plan.json, and the plan for this run alone. Returns `{ unknown, planFile }`;
 * throws when the row it names does not exist.
 */
export function applyRequest(project, id, request, pages) {
  const planFile = `${REQUESTS_DIR}/${id}.plan.json`;
  refuseLinkedPath(project, 'research/DISCOVERY.md');
  refuseLinkedPath(project, 'research/plan.json');
  refuseLinkedPath(project, planFile);
  const planPath = path.join(project, 'research', 'plan.json');
  let plan;
  try {
    const source = readText(planPath);
    if (source === null) throw new Error('research/plan.json is missing');
    const duplicate = duplicateKey(source);
    if (duplicate) throw new Error(`research/plan.json ${duplicate}`);
    plan = parseJson(source);
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('research/plan.json must be a JSON object');
  } catch (err) {
    throw new Error(`cannot apply request: ${err.message}`);
  }
  const unknownRows = parseTable(readText(path.join(project, 'research', 'DISCOVERY.md'), ''), HEADERS.unknowns).rows;
  const ids = unknownRows.map((row) => String(row.cells[0] ?? '').trim()).filter(Boolean);
  let unknown = request.unknown;
  if (unknown) {
    const row = unknownRows.find((entry) => String(entry.cells[0] ?? '').trim() === unknown);
    if (!row) throw new Error(`${unknown} is not a row of research/DISCOVERY.md`);
    if (String(row.cells[3] ?? '').trim().toUpperCase() === 'CLOSED') {
      throw new Error(`${unknown} is already CLOSED; a request cannot add searches to a closed unknown`);
    }
  } else {
    const next = ids.reduce((max, v) => Math.max(max, Number(/^U-(\d+)$/.exec(v)?.[1] ?? 0)), 0) + 1;
    unknown = `U-${next}`;
    appendRow(project, 'research/DISCOVERY.md', HEADERS.unknowns, [unknown, request.fact.trim(), request.blocks.trim(), 'OPEN', '']);
  }
  const why = `${unknown} request ${id}`;
  const prefer = request.prefer ?? [];
  const queries = (request.queries ?? []).map((q) => ({ q: q.trim(), why: unknown, ...(prefer.length ? { prefer } : {}) }));
  const urls = (request.urls ?? []).map((url) => ({ url, why, type: 'P' }));

  plan.queries = Array.isArray(plan.queries) ? plan.queries : [];
  plan.urls = Array.isArray(plan.urls) ? plan.urls : [];
  for (const q of queries) if (!plan.queries.some((e) => (typeof e === 'string' ? e : e?.q) === q.q)) plan.queries.push(q);
  for (const u of urls) if (!plan.urls.some((e) => (typeof e === 'string' ? e : e?.url) === u.url)) plan.urls.push(u);
  writeJson(planPath, plan);

  const base = readPlan(project);
  const depth = Object.entries(DEPTH_SCRAPES).find(([, n]) => n >= pages)?.[0] ?? 'deep';
  writeJson(path.join(project, planFile), {
    topic: base.topic,
    depth,
    refreshDays: base.refreshDays,
    limit: base.limit,
    perQuery: base.perQuery,
    maxScrapes: pages,
    prefer: base.prefer,
    queries,
    urls,
  });
  return { unknown, planFile };
}

/** Record what became of a request, beside it, so the builder reads the answer after a pull. */
export function writeResult(project, id, result) {
  const file = path.join(project, REQUESTS_DIR, `${id}.result.json`);
  refuseSymlink(file);
  writeJson(file, { id, at: nowIso(), ...result });
  return file;
}

// ---------------------------------------------------------------- settings and the daily meter

export function autoCollectPath(env = process.env) {
  return path.join(path.dirname(configPath(env)), 'research-kit.autocollect.json');
}

/** Why `patch` is not a valid settings change, or ''. */
export function settingsProblem(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'settings must be an object';
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'mode') { if (!AUTO_COLLECT_MODES.includes(value)) return `mode must be one of ${AUTO_COLLECT_MODES.join(', ')}`; continue; }
    if (key === 'perRequestPages') { if (!Number.isInteger(value) || value < 1 || value > REQUEST_LIMITS.maxPages) return `perRequestPages must be 1 to ${REQUEST_LIMITS.maxPages}`; continue; }
    if (key === 'dailyPages') { if (!Number.isInteger(value) || value < 0 || value > 1000) return 'dailyPages must be 0 to 1000'; continue; }
    if (key === 'intervalMinutes') { if (!Number.isInteger(value) || value < 1 || value > 1440) return 'intervalMinutes must be 1 to 1440'; continue; }
    if (key === 'topicsFolder') {
      if (typeof value !== 'string' || value.length > 200) return 'topicsFolder must be a folder inside the repository';
      const v = value.trim().replace(/\\/g, '/');
      if (v && (v.startsWith('/') || /^[a-z]:/i.test(v) || v.split('/').some((s) => s === '..' || s === '.') || !/^[A-Za-z0-9._/-]+$/.test(v))) {
        return 'topicsFolder is a path relative to the repository, such as "projects" - no "..", no drive, no leading slash';
      }
      if (v.split('/').some((part) => part.toLowerCase() === '.git')) return 'topicsFolder cannot name Git metadata';
      continue;
    }
    return `unknown setting "${key}"`;
  }
  return '';
}

export function readAutoCollect(env = process.env) {
  const stored = readJson(autoCollectPath(env), {}) ?? {};
  const settings = { ...AUTO_COLLECT_DEFAULTS };
  for (const key of Object.keys(AUTO_COLLECT_DEFAULTS)) {
    if (stored[key] !== undefined && !settingsProblem({ [key]: stored[key] })) settings[key] = stored[key];
  }
  const day = today();
  const spent = stored.spent && stored.spent.day === day && Number.isInteger(stored.spent.pages) ? stored.spent.pages : 0;
  const trustedResults = stored.trustedResults && typeof stored.trustedResults === 'object' && !Array.isArray(stored.trustedResults)
    ? stored.trustedResults : {};
  return { settings, spent: { day, pages: spent }, paused: typeof stored.paused === 'string' ? stored.paused : '', trustedResults };
}

function writeAutoCollect(state, env) {
  writeJson(autoCollectPath(env), { ...state.settings, spent: state.spent, paused: state.paused, trustedResults: state.trustedResults ?? {} });
}

function resultTrustKey(project, id) {
  return JSON.stringify([path.resolve(project), id]);
}

function fileHash(file) {
  const contents = readText(file, null);
  return typeof contents === 'string'
    ? crypto.createHash('sha256').update(contents.replace(/\r\n/g, '\n')).digest('hex')
    : '';
}

/** Remember collector-written results outside the shared repository, bound to their request. */
export function recordTrustedResult(project, id, env = process.env) {
  const request = path.join(project, REQUESTS_DIR, `${id}.json`);
  const result = path.join(project, REQUESTS_DIR, `${id}.result.json`);
  const requestHash = fileHash(request);
  const resultHash = fileHash(result);
  if (!requestHash || !resultHash) return false;
  const state = readAutoCollect(env);
  state.trustedResults[resultTrustKey(project, id)] = { requestHash, resultHash };
  writeAutoCollect(state, env);
  return true;
}

/** A result arriving over git is not authoritative unless this collector recorded it locally. */
export function isTrustedResult(project, id, env = process.env) {
  const trusted = readAutoCollect(env).trustedResults[resultTrustKey(project, id)];
  return Boolean(trusted && trusted.requestHash === fileHash(path.join(project, REQUESTS_DIR, `${id}.json`))
    && trusted.resultHash === fileHash(path.join(project, REQUESTS_DIR, `${id}.result.json`)));
}

export function saveAutoCollect(patch, env = process.env) {
  const problem = settingsProblem(patch);
  if (problem) throw Object.assign(new Error(problem), { status: 400 });
  const state = readAutoCollect(env);
  state.settings = { ...state.settings, ...patch };
  if (typeof state.settings.topicsFolder === 'string') state.settings.topicsFolder = state.settings.topicsFolder.trim().replace(/\\/g, '/');
  writeAutoCollect(state, env);
  return state;
}

/** Add today's pages to the meter. */
export function recordSpend(pages, env = process.env) {
  const state = readAutoCollect(env);
  state.spent.pages += Math.max(0, Number(pages) || 0);
  writeAutoCollect(state, env);
  return state;
}

export function reserveCollection(pages, pauseReason, env = process.env) {
  if (!Number.isSafeInteger(pages) || pages < 0 || pages > REQUEST_LIMITS.maxPages || !pauseReason) {
    throw new Error('invalid collection reservation');
  }
  const state = readAutoCollect(env);
  if (state.paused) throw new Error('auto-collect is paused; collection was not started');
  if (state.spent.pages + pages > state.settings.dailyPages) throw new Error('the daily page allowance changed; collection was not started');
  const reservation = { day: state.spent.day, pages, pauseReason: String(pauseReason), settled: false };
  state.spent.pages += pages;
  state.paused = reservation.pauseReason;
  writeAutoCollect(state, env);
  return reservation;
}

export function settleCollection(reservation, measured, pauseReason = '', env = process.env) {
  if (reservation.settled) return readAutoCollect(env);
  if (measured !== null && (!Number.isSafeInteger(measured) || measured < 0 || measured > reservation.pages)) {
    throw new Error('invalid collection settlement');
  }
  const state = readAutoCollect(env);
  const charged = measured ?? reservation.pages;
  const sameDay = state.spent.day === reservation.day;
  if (sameDay && state.spent.pages >= reservation.pages) state.spent.pages -= reservation.pages - charged;
  else state.spent.pages += charged;
  let nextPause = String(pauseReason);
  if (measured === null && !nextPause) nextPause = reservation.pauseReason;
  if (!sameDay && state.spent.pages > state.settings.dailyPages && !nextPause) {
    nextPause = 'collection crossed the daily meter boundary; its completion-day charge exceeds today\'s cap. Inspect the run before pressing Resume.';
  }
  if (state.paused === reservation.pauseReason || (!state.paused && nextPause)) state.paused = nextPause;
  writeAutoCollect(state, env);
  reservation.settled = true;
  return state;
}

/** Stop auto-collect until the operator resumes it; '' resumes. */
export function setPaused(reason, env = process.env) {
  const state = readAutoCollect(env);
  state.paused = String(reason ?? '');
  writeAutoCollect(state, env);
  return state;
}
