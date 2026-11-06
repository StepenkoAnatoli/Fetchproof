// dispatch.mjs - asking the collector to run, from outside GitHub.
//
// This is the seam an AI agent or a desktop app uses. It does four things: start a run,
// learn which run it started, wait for it, and bring the artifact home. Nothing here
// judges research; the artifact validator does that, and this module hands off to it.
//
// THE TOKEN IS READ FROM THE ENVIRONMENT AND NEVER FROM AN ARGUMENT.
//
// A token on a command line is in the shell history, in `ps` output, in any CI log that
// echoes its own command, and in the crash report of anything that dumps argv. There is
// no flag for it and `tokenFromEnv` is the only way in, so there is no path where a caller
// can put one somewhere it will be recorded. Every error message here goes through
// `redact`, because the most common way a credential escapes is an exception that quoted
// the request that carried it.
//
// THE API VERSION IS PINNED, AND A MISSING RUN ID IS A NAMED FAILURE.
//
// Under `2022-11-28` - still GitHub's default - the dispatch endpoint returns `204 No
// Content` and the caller cannot learn which run it started. Under `2026-03-10` it returns
// `200` with `workflow_run_id`. This module pins the second and treats a 204 as a specific,
// explained error rather than as an empty success, because "the run started and I have no
// idea which one" is the failure a caller is least equipped to diagnose from a status code.

import fs from 'node:fs';
import path from 'node:path';
import { writeBytes, tempBase } from './core.mjs';
import { fetchFailure } from './runtime.mjs';
import { openZip, ZipError, ZIP_LIMITS } from './artifact-zip.mjs';
import { validateArtifact, MANIFEST_PATH } from './artifact-validator.mjs';

/** The version whose dispatch response carries the run id. Changing this is a decision. */
export const API_VERSION = '2026-03-10';

const GITHUB_API = 'https://api.github.com';

/** Environment names checked, in order. The first non-empty one wins. */
export const TOKEN_VARS = Object.freeze(['FETCHPROOF_GITHUB_TOKEN', 'GITHUB_TOKEN']);

export class DispatchError extends Error {
  constructor(code, message, { status = null, remedy = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.remedy = remedy;
  }
}

/**
 * Replace anything token-shaped with a marker.
 *
 * Deliberately pattern-based rather than "remove the token we happen to hold": an error
 * can carry a DIFFERENT credential - one from a redirect, a proxy, a header echoed by the
 * server - and a redactor that only knows its own would pass that straight through.
 */
export function redact(text) {
  return String(text)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, 'gh?_<redacted>')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, 'github_pat_<redacted>')
    .replace(/\bfc-[A-Za-z0-9]{16,}\b/g, 'fc-<redacted>')
    .replace(/(authorization|bearer|token)(["'\s:=]+)[A-Za-z0-9._~+/-]{12,}/gi, '$1$2<redacted>');
}

/**
 * The `queries` workflow input: search queries and pages to fetch, one per line.
 *
 * collect.yml reads a line that is an http(s) URL as a page to fetch and any other line as a
 * search (2026-09-27). Both travel in this one input because collect.yml already uses 9 of
 * the 10 inputs GitHub allows. A URL that is not http(s), or does not parse, is refused here
 * instead of being dispatched: on the runner it would quietly become a search for its own
 * text. `value` is undefined when there is nothing to send, so a dispatch without either
 * looks exactly like one from before these options existed.
 */
function credentialHost(line) {
  try {
    const url = new URL(line);
    if (['http:', 'https:'].includes(url.protocol) && (url.username || url.password)) return `…@${url.host}`;
  } catch { /* judged by its spelling below */ }
  const spelled = /^https?:[\\/]*[^\\/?#\s]*@([^\\/?#\s]*)/i.exec(line);
  return spelled ? `…@${spelled[1]}` : '';
}

export function queriesInput({ queries = [], urls = [] } = {}) {
  const items = (list) => (Array.isArray(list) ? list : [list]).map((item) => String(item ?? ''));
  const searches = items(queries);
  const addresses = items(urls);
  // Check before trimming: even a leading/trailing newline changes the caller's item
  // shape. collect.yml splits this input into lines, and URL parsing discards newlines.
  if ([...searches, ...addresses].some((item) => /[\r\n]/.test(item))) {
    return { value: undefined, error: 'a query or URL must be one line' };
  }
  const clean = (list) => list.map((item) => item.trim()).filter(Boolean);
  const pages = clean(addresses);
  // A user name or password in a URL would become a workflow input anyone who can read the
  // collector repository sees, and a ledger line nobody may edit (#308). Every line is read,
  // searches too: collect.yml fetches any line that is an http(s) URL, whichever list it came
  // in. A line that only looks like one - `https://user:pass@host:99999/` does not parse - is
  // refused as well, since it would be published as a search. Named by host, never the secret.
  const credentialed = [...clean(searches), ...pages].map(credentialHost).filter(Boolean);
  if (credentialed.length) {
    return { value: undefined, error: `a URL carries credentials (${credentialed.join(', ')}) - a page behind a login is a KNOWN-UNKNOWN, not a fetch` };
  }
  const bad = pages.filter((page) => {
    if (!/^https?:\/\/./i.test(page)) return true;
    try { new URL(page); return false; } catch { return true; }
  });
  if (bad.length) return { value: undefined, error: `not an http(s) URL: ${bad.join(', ')}` };
  const lines = [...clean(searches), ...pages];
  return { value: lines.length ? lines.join('\n') : undefined, error: '' };
}

/** The token, from the environment only. Never an argument, never a file. */
export function tokenFromEnv(env = process.env) {
  for (const name of TOKEN_VARS) {
    const value = env[name];
    if (typeof value === 'string' && value.trim() !== '') return { token: value.trim(), from: name };
  }
  return {
    token: null,
    from: null,
    detail: `no GitHub token in the environment. Set one of: ${TOKEN_VARS.join(', ')}`,
  };
}

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    Authorization: `Bearer ${token}`,
    'User-Agent': 'fetchproof',
  };
}

function splitRepository(repository) {
  const parts = String(repository ?? '').split('/');
  if (parts.length !== 2 || parts.some((part) => !part || /[^A-Za-z0-9._-]/.test(part) || part === '.' || part === '..')) {
    throw new DispatchError('REPOSITORY', `repository must be "owner/name", got ${JSON.stringify(String(repository))}`);
  }
  return parts;
}

/**
 * `promise`, or a rejection with `signal`'s reason once it aborts - whichever comes first.
 * Without a signal, the promise itself. The promise is not cancelled, only no longer waited
 * for: the signal also goes to `fetch`, which cancels a real request, and this covers a fetch
 * or a body that does not honour it (independent audit 2026-11-04, F06).
 */
function unlessAborted(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

// null for a body that could not be read: it said nothing, which is not saying "no rate limit".
async function readError(response, signal) {
  try { return redact((await unlessAborted(response.text(), signal)).slice(0, 400)); } catch { return null; }
}

/**
 * The error for a 403, which is a rate limit or a refusal: `refusal` when the response names no
 * limit. GitHub may name one only in the body - a secondary limit sends no rate-limit header - so
 * with the headers silent and the body unread (cut off at the watch's deadline, or lost), which of
 * the two it is is not known, and the remedy names both, the wait first. It named the token's
 * permission alone, to a token that had read the run one poll before (re-review of #442). `lead`
 * begins that message.
 */
async function forbiddenError(response, { lead, refusal, signal }) {
  const body = await readError(response, signal);
  const remaining = response.headers?.get?.('x-ratelimit-remaining');
  const retry = response.headers?.get?.('retry-after');
  if (remaining !== '0' && retry == null && !/rate[ -]?limit/i.test(body ?? '')) {
    if (body !== null) return refusal;
    return new DispatchError(refusal.code, `${lead}: HTTP 403, a rate limit or a refusal - its body, which says which, could not be read`, {
      status: 403,
      remedy: `wait at least one minute before retrying; if it is refused again, ${refusal.remedy}`,
    });
  }
  const waits = [];
  if (retry != null && /^\d+$/.test(retry)) waits.push(`wait at least ${retry} seconds (Retry-After) before retrying`);
  const reset = response.headers?.get?.('x-ratelimit-reset');
  if (reset != null && /^\d+$/.test(reset)) {
    const date = new Date(Number(reset) * 1000);
    if (!Number.isNaN(date.getTime())) waits.push(`do not retry before ${date.toISOString()} (x-ratelimit-reset: ${reset} UTC epoch seconds)`);
  }
  return new DispatchError('RATE_LIMITED', `GitHub rate limited the request${body ? `: ${body}` : ''}`, {
    status: response.status,
    remedy: waits.length ? waits.join('; ') : 'wait at least one minute before retrying; back off further if the rate limit continues',
  });
}

// ---------------------------------------------------------------- dispatch

/**
 * `dispatchCollection(...)` -> `{ workflowRunId, runUrl, htmlUrl }`.
 *
 * Throws a `DispatchError` rather than returning a partial result: a caller that cannot
 * identify the run it started has nothing useful to carry on with.
 */
export async function dispatchCollection({
  repository,
  workflow = 'collect.yml',
  ref = 'main',
  inputs = {},
  token,
  fetch: doFetch = globalThis.fetch,
  api = GITHUB_API,
} = {}) {
  const [owner, name] = splitRepository(repository);
  if (!token) throw new DispatchError('TOKEN', 'no token was supplied', { remedy: `set ${TOKEN_VARS[0]}` });

  const url = `${api}/repos/${owner}/${name}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  let response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      // BOTH belts. The pinned API version makes run details the default, and
      // `return_run_details` asks for them explicitly - the parameter GitHub added on
      // 2026-02-19 for callers still on 2022-11-28 (E-13 of the delivery corpus).
      //
      // Sending both is measured-safe, not assumed-safe. Four calls against this
      // repository on 2026-09-21, no parameter unless stated:
      //   2022-11-28, no param                    -> 204 No Content
      //   2026-03-10, no param                    -> 200 + workflow_run_id
      //   2022-11-28, return_run_details=true     -> 200 + workflow_run_id
      //   2026-03-10, return_run_details=true     -> 200 + workflow_run_id
      //
      // So a server that ignores or downgrades the pinned header still answers with a run
      // id, and NO_RUN_ID stops being reachable by version drift alone.
      body: JSON.stringify({ ref, inputs: stringifyInputs(inputs), return_run_details: true }),
    });
  } catch (err) {
    // The CAUSE, not the bare `fetch failed` Node throws. Every other fetching seam in this
    // kit already does this (ADR-0047, `fetchFailure`): a dispatch that never left used to
    // read "could not reach https://api.github.com: fetch failed", which is the same sentence
    // a mistyped proxy, a DNS failure and a TLS-inspecting middlebox produce - and the caller
    // is an agent whose only next step is to guess. Reproduced 2026-09-30 on a host with no
    // egress to api.github.com, where the cause was "unable to verify the first certificate".
    throw new DispatchError('NETWORK', `could not reach ${api}: ${redact(fetchFailure(err))}`,
      { remedy: 'check connectivity, then retry - a dispatch that never left is safe to repeat' });
  }

  if (response.status === 204) {
    // The one failure a caller cannot diagnose from a status code alone.
    throw new DispatchError('NO_RUN_ID',
      'the dispatch succeeded but returned 204 No Content, so the run it started cannot be identified',
      {
        status: 204,
        remedy: `the server ignored BOTH routes to a run id: the pinned `
          + `X-GitHub-Api-Version: ${API_VERSION} and the return_run_details parameter. `
          + 'That is a server old enough to predate 2026-02-19, or a proxy stripping one and '
          + 'rejecting the other. Polling /actions/runs and correlating by created_at is the '
          + 'last resort and races other dispatches.',
      });
  }
  if (response.status === 404) {
    throw new DispatchError('NOT_FOUND', `no workflow ${workflow} on ${repository}@${ref}, or the token cannot see it`, {
      status: 404,
      // 404 is what GitHub returns for "exists but you may not" as well as "does not
      // exist", so the remedy has to name both rather than guess which one happened.
      remedy: 'the workflow file must be on the DEFAULT branch, and the token needs Actions: read and write on this repository',
    });
  }
  if (response.status === 403) {
    throw await forbiddenError(response, {
      lead: 'dispatch failed',
      refusal: new DispatchError('FORBIDDEN', 'the token may not dispatch this workflow', {
        status: 403,
        remedy: 'the fine-grained token needs repository permission "Actions" set to read and write',
      }),
    });
  }
  if (!response.ok) {
    throw new DispatchError('HTTP', `dispatch failed: HTTP ${response.status}. ${(await readError(response)) ?? ''}`, { status: response.status });
  }

  const body = await readJsonBody(response, 'dispatch');
  const workflowRunId = body?.workflow_run_id;
  if (!Number.isInteger(workflowRunId)) {
    throw new DispatchError('NO_RUN_ID', `the dispatch returned HTTP ${response.status} with no workflow_run_id`, {
      status: response.status,
      remedy: `pin X-GitHub-Api-Version: ${API_VERSION}`,
    });
  }
  return { workflowRunId, runUrl: body.run_url ?? null, htmlUrl: body.html_url ?? null };
}

/** Workflow inputs are strings on the wire; a caller passing a number should not 422. */
function stringifyInputs(inputs) {
  return Object.fromEntries(Object.entries(inputs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)]));
}

// ---------------------------------------------------------------- waiting

/**
 * A 200 whose body is not JSON, as a DispatchError rather than a raw SyntaxError.
 *
 * dispatchCollection, getRun and listArtifacts share this parser. A 200 with
 * an HTML body - a maintenance page, a TLS-inspecting proxy, an edge cache under load -
 * threw `SyntaxError: Unexpected token <` straight out, and collect-remote reported it only
 * as UNKNOWN, with no status and no remedy (found 2026-09-30, break-test). The parser's
 * first line is kept: it usually shows the doctype or the cache's own error text.
 */
async function readJsonBody(response, what, signal) {
  try {
    return await unlessAborted(response.json(), signal);
  } catch (err) {
    // A body cut off by the caller's deadline is not a body that is not JSON: the caller names it.
    if (signal?.aborted) throw err;
    throw new DispatchError('BAD_BODY', `${what}: HTTP ${response.status} returned a body that is not JSON (${String(err.message).split('\n')[0]})`, {
      status: response.status,
      remedy: 'a JSON API answering with HTML is usually a proxy or a maintenance page - retry, then check api.github.com',
    });
  }
}

async function callApi(doFetch, url, init, { api = GITHUB_API, remedy = 'check connectivity, then retry' } = {}) {
  try {
    return await unlessAborted(doFetch(url, init), init.signal);
  } catch (err) {
    // Nor is a request cut off by it a network failure, which a watch would retry.
    if (init.signal?.aborted) throw err;
    throw new DispatchError('NETWORK', `could not reach ${api}: ${redact(fetchFailure(err))}`, { remedy });
  }
}

/** `signal`, when given, cuts the request and the reading of its body short once it aborts. */
export async function getRun({ repository, runId, token, fetch: doFetch = globalThis.fetch, api = GITHUB_API, signal }) {
  const [owner, name] = splitRepository(repository);
  const response = await callApi(doFetch, `${api}/repos/${owner}/${name}/actions/runs/${runId}`,
    { headers: headers(token), ...(signal && { signal }) }, { api, remedy: `check connectivity, then retry with --run-id ${runId}` });
  if (!response.ok) {
    // A refusal names its own way out; the caller's generic "pick it up again" would send
    // somebody back to a run number that does not exist, with a token that cannot see it.
    const remedy = response.status === 404 ? `no run ${runId} on ${repository}, or the token cannot see it - check the number the dispatch printed`
      : response.status === 401 ? 'the token was refused - it is expired or mistyped; create a new one'
        : response.status === 403 ? 'the token may not read this repository\'s runs - it needs "Actions" set to read and write'
          : null;
    const refusal = new DispatchError('HTTP', `could not read run ${runId}: HTTP ${response.status}`, { status: response.status, remedy });
    throw response.status === 403 ? await forbiddenError(response, { lead: `could not read run ${runId}`, refusal, signal }) : refusal;
  }
  return readJsonBody(response, `could not read run ${runId}`, signal);
}

/**
 * Poll until the run finishes. Returns the final run object.
 *
 * `waiting` is a status, not a stall: it means a deployment protection rule is holding the
 * job, and a caller that treated it as failure would give up on a run that is fine. It is
 * reported through `onStatus` so an agent can say so rather than sitting mute.
 *
 * A failed poll that may pass on its own - no connection, a 429 or 5xx, a body that is not
 * JSON - is retried, up to MAX_POLL_RETRIES in a row, each reported through `onRetry`. A watch
 * lasts up to 30 minutes, and every failed poll used to be fatal: one dropped connection ended
 * it with RUN_FAILED while the run went on unwatched (found 2026-10-01, break-test). A refusal
 * a retry cannot change - 401, 403, 404 - still ends it at once, and no retry outlasts the deadline.
 *
 * The deadline bounds the polls as well as the waits between them (ADR-0201). It used to be
 * checked only once a poll had answered, so a request that never answered - no headers, or a
 * body that never finished - held the watch past `--timeout` for as long as it hung, and a
 * completed run it released late was returned as if in time (independent audit 2026-11-04,
 * F06). Now one signal, aborted at the deadline, goes to each poll's fetch and cuts off what
 * is still unanswered then, ending the watch with TIMEOUT; a wait ends at the deadline at the
 * latest, and no poll starts after it. A failure being retried when it comes is reported as
 * itself, as before.
 */
export const MAX_POLL_RETRIES = 5;

// A setTimeout holds at most 2^31-1 ms, about 24.8 days: a longer delay fires after 1 ms, with
// a warning (AbortSignal.timeout does the same). A longer watch re-arms its timer instead.
const MAX_TIMER_MS = 2 ** 31 - 1;

function transientPoll(err) {
  if (!(err instanceof DispatchError)) return false;
  if (err.code === 'NETWORK' || err.code === 'BAD_BODY') return true;
  return err.code === 'HTTP' && (err.status === 429 || err.status >= 500);
}

export async function waitForRun({
  repository, runId, token,
  fetch: doFetch = globalThis.fetch,
  api = GITHUB_API,
  intervalMs = 10_000,
  timeoutMs = 30 * 60_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  onStatus = () => {},
  onRetry = () => {},
} = {}) {
  const deadline = now() + timeoutMs;
  const watch = new AbortController();
  let timer;
  const arm = (ms) => {
    timer = setTimeout(() => (ms > MAX_TIMER_MS ? arm(ms - MAX_TIMER_MS) : watch.abort()), Math.min(ms, MAX_TIMER_MS));
  };
  arm(timeoutMs);
  let last = null;
  let seen = null;
  let failed = null;
  let failures = 0;
  const seconds = Math.round(timeoutMs / 1000);
  // Not a failure of the run: the caller stopped watching, and the run keeps going. `first`
  // is a remedy that comes before the watch's own: the cut-off poll's, when it had one.
  const timedOut = (message, first = null) => new DispatchError('TIMEOUT', message, {
    remedy: `${first ? `${first}; ` : ''}the run ${seen ? 'is still going' : 'is not known to have failed'}; check ${seen?.html_url ?? `run ${runId}`}, or pick it up again with --run-id ${runId} (and a longer --timeout)`,
  });
  // An error that ends the watch ends only the watch: the run goes on, and the command that was run
  // dispatches another. So a remedy of the error's own - wait out a limit, a new token, a permission,
  // a proxy, any of which may say to retry - is followed by the way back to this run, unless it names
  // it already or the run's number is what is in doubt (a 404 before any poll read the run); one
  // with none is left to the caller. A 403 ended the watch with "wait ... before retrying" and no run
  // number (re-review of #442's follow-up, 2026-11-06). A 404 after a poll read the run is about a
  // number that is right - the token lost sight of the run, or it was deleted - and "check the
  // number" with no way back sent the operator to the command that dispatches another (second pass).
  const wayBack = (err) => {
    if (!(err instanceof DispatchError) || !err.remedy || err.remedy.includes('--run-id')) return err;
    if (err.status === 404 && !seen) return err;
    const own = err.status === 404
      ? `run ${runId} was read at an earlier poll, so its number is right: the token may have lost access to ${repository}, or the run was deleted - check ${seen.html_url ?? `run ${runId}`}`
      : err.remedy;
    return new DispatchError(err.code, err.message, {
      status: err.status,
      remedy: `${own}; the run may be fine - pick it up again with --run-id ${runId} rather than dispatching another`,
    });
  };
  try {
    for (;;) {
      if (watch.signal.aborted || now() >= deadline) {
        throw failed ? wayBack(failed) : timedOut(seen ? `run ${runId} was still ${seen.status} after ${seconds}s` : `run ${runId} was not read within ${seconds}s`);
      }
      let run;
      try {
        run = await getRun({ repository, runId, token, fetch: doFetch, api, signal: watch.signal });
      } catch (err) {
        if (watch.signal.aborted) {
          const before = seen ? `; it was ${seen.status} at the poll before` : '';
          // A refusal whose status came in time is an answer, though its body was cut off: a 403
          // is read for a rate limit first, and with its body unread names both causes. Its own
          // remedy comes first - "a longer --timeout" alone sent a token without "Actions" back to
          // the same refusal (review of #442).
          if (err instanceof DispatchError && err.status) {
            throw timedOut(`the status poll for run ${runId} answered HTTP ${err.status}, but its body was still being read when the watch ended after ${seconds}s${before}`, err.remedy);
          }
          throw timedOut(`the status poll for run ${runId} had no answer when the watch ended after ${seconds}s${before}`);
        }
        failures += 1;
        if (!transientPoll(err) || failures > MAX_POLL_RETRIES || now() >= deadline) throw wayBack(err);
        failed = err;
        onRetry(err, failures);
      }
      if (run) {
        failures = 0;
        failed = null;
        seen = run;
        if (run.status !== last) { last = run.status; onStatus(run); }
        // An answer in hand is taken: a poll the deadline did not cut off answered in time.
        if (run.status === 'completed') return run;
      }
      if (now() < deadline) await sleep(Math.min(intervalMs, deadline - now()));
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- the artifact

export async function listArtifacts({ repository, runId, token, fetch: doFetch = globalThis.fetch, api = GITHUB_API }) {
  const [owner, name] = splitRepository(repository);
  const response = await callApi(doFetch, `${api}/repos/${owner}/${name}/actions/runs/${runId}/artifacts`,
    { headers: headers(token) }, { api, remedy: `check connectivity, then retry with --run-id ${runId}` });
  if (!response.ok) throw new DispatchError('HTTP', `could not list artifacts for run ${runId}: HTTP ${response.status}`, { status: response.status });
  const body = await readJsonBody(response, `could not list artifacts for run ${runId}`);
  return body.artifacts ?? [];
}

/**
 * The most bytes a download may hold: the one package GitHub's wrapper carries, which the
 * package reader refuses past its per-entry ceiling anyway, plus room for the wrapper's own
 * headers. Every other remote body the kit reads is bounded before it is held (ADR-0082,
 * artifact-zip.mjs); this one comes from a repository the operator may not control (#329).
 */
export const MAX_ARTIFACT_BYTES = ZIP_LIMITS.maxEntryBytes + 1024 * 1024;

/**
 * The body, refused when Content-Length declares it over the bound - before a byte is read -
 * or when a body that declared nothing (chunked) grows past it, mid-stream. `response.body` is
 * a stream on every real fetch; one without it (an empty body, a test double) is read whole
 * and judged after.
 */
async function boundedDownload(response, artifactId) {
  const tooLarge = (size) => new DispatchError('TOO_LARGE', `artifact ${artifactId} is ${size} bytes, over the ${MAX_ARTIFACT_BYTES}-byte limit for a corpus package - not read`, {
    remedy: 'nothing was written. A package that large cannot be validated either - re-collect with fewer pages',
  });
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > MAX_ARTIFACT_BYTES) {
    await response.body?.cancel?.().catch(() => {});
    throw tooLarge(declared);
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ARTIFACT_BYTES) throw tooLarge(bytes.length);
    return bytes;
  }
  const chunks = [];
  let size = 0;
  // Throwing out of the loop cancels the stream, so the rest of an oversized body is never fetched.
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_ARTIFACT_BYTES) throw tooLarge(`more than ${MAX_ARTIFACT_BYTES}`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function downloadArtifact({ repository, artifactId, token, fetch: doFetch = globalThis.fetch, api = GITHUB_API }) {
  const [owner, name] = splitRepository(repository);
  const response = await callApi(doFetch, `${api}/repos/${owner}/${name}/actions/artifacts/${artifactId}/zip`, {
    headers: headers(token), redirect: 'follow',
  }, { api });
  if (response.status === 410) {
    throw new DispatchError('EXPIRED', `artifact ${artifactId} has expired`, {
      status: 410,
      // Worth saying plainly: an artifact is transport, not storage (ADR-0032).
      remedy: 'workflow artifacts are deleted after their retention period and with their run; re-collect, or keep the corpus somewhere that persists',
    });
  }
  if (!response.ok) throw new DispatchError('HTTP', `could not download artifact ${artifactId}: HTTP ${response.status}`, { status: response.status });
  return boundedDownload(response, artifactId);
}

/**
 * GitHub wraps every uploaded artifact in a ZIP of its own, so downloading ours yields a
 * ZIP containing a ZIP. Unwrapped here rather than in the validator, which should judge
 * one format and not guess how many layers of packaging a transport added.
 *
 * The wrapper is the download's only `.zip`, AT THE ROOT, beside no manifest.json (#329). A
 * package that carries an audit bundle (`audit --zip`) also holds exactly one `.zip`, three
 * folders down beside its manifest - and taking that for the wrapper wrote the bundle as the
 * corpus.
 */
export function unwrapArtifact(bytes) {
  let zip;
  try { zip = openZip(bytes); } catch { return { bytes, unwrapped: false }; }
  if (zip.problems.length) return { bytes, unwrapped: false };
  if (zip.has(MANIFEST_PATH)) return { bytes, unwrapped: false };
  const inner = zip.names.filter((n) => n.endsWith('.zip'));
  if (inner.length !== 1 || inner[0].includes('/')) return { bytes, unwrapped: false };
  // An inner package that cannot be read is handed on as it came, as a wrapper that cannot be
  // opened is - a ZIP-READ thrown from here went past the validator (found 2026-10-01,
  // break-test) - and with the reason it did not read, `unreadable`. The validator, given the
  // wrapper, can only say that it holds no manifest (review of #442, 2026-11-06).
  try {
    return { bytes: zip.read(inner[0]), unwrapped: true, name: inner[0] };
  } catch (err) {
    return { bytes, unwrapped: false, unreadable: { entry: inner[0], code: err instanceof ZipError ? err.code : 'ZIP-READ', message: err.message } };
  }
}

// ---------------------------------------------------------------- bringing it home

/** The four fields a caller decides on: is it done, did it work, and where to look. */
export async function getRunSummary({ repository, runId, token, fetch: doFetch = globalThis.fetch, api = GITHUB_API }) {
  const run = await getRun({ repository, runId, token, fetch: doFetch, api });
  return { status: run.status, conclusion: run.conclusion ?? null, htmlUrl: run.html_url ?? null, runId };
}

/**
 * `usableOutDir(dir)` -> its absolute path, created if absent, or a named `OUT_DIR` failure.
 *
 * Exported because every caller that downloads should check it before it spends
 * anything: `collect-remote` before it dispatches a paid run, the MCP server before it
 * reads the run, and `fetchCorpus` before it downloads.
 *
 * `{ create: false }` leaves no folder behind (#295): it is created, checked, and what this
 * call created is removed again. The early callers check that way, because a folder they
 * created stayed behind, empty, when the run was then refused for a missing token or an
 * unreadable run; `fetchCorpus` creates it once the run has a package to fetch. Creating is
 * the check: looking only at the nearest folder that exists passed a name no folder can
 * have - a component past 255 characters, a `"` or `|` on Windows - and that was found
 * after the paid run and the wait (review of #295, 2026-10-18).
 */
export function usableOutDir(dir, { create = true } = {}) {
  let absolute;
  try {
    absolute = path.resolve(dir);
    const first = fs.mkdirSync(absolute, { recursive: true });
    try { fs.accessSync(absolute, fs.constants.W_OK); } finally {
      if (!create && first) fs.rmSync(first, { recursive: true, force: true });
    }
  } catch (err) {
    throw new DispatchError('OUT_DIR', `${dir} is not a folder this process can write (${err.code ?? err.message})`, {
      remedy: 'pass an existing writable folder, or omit it for the default',
    });
  }
  return absolute;
}

// The errors that are the artifact's own: another download from the same run meets them again (no
// corpus artifact or several, a name that is not a file name, too large, expired), and
// re-collecting is their way.
const ARTIFACT_OWN = new Set(['NO_ARTIFACT', 'ARTIFACT_NAME', 'TOO_LARGE', 'EXPIRED']);

/**
 * `downloadRemedy(err, wayBack)` -> the remedy `collect-remote` prints for an error that ended the
 * download from a run that finished well: the error's own, then `wayBack` - how to pick the run up
 * again - unless the error is the artifact's own or its remedy names `--run-id` already; `wayBack`
 * alone for an error with none. A remedy of its own - "retry" after a proxy's HTML page or a
 * dropped download, a folder to fix - read as running `collect-remote` again, which dispatches and
 * pays for another run (re-review of #442, second pass, 2026-11-06). The watch's errors carry
 * their way back from `waitForRun`; the MCP server's caller holds the run's number already.
 */
export function downloadRemedy(err, wayBack) {
  if (!err?.remedy) return wayBack;
  return ARTIFACT_OWN.has(err.code) || err.remedy.includes('--run-id') ? err.remedy : `${err.remedy}; ${wayBack}`;
}

/**
 * `fetchCorpus(...)` -> `{ file, validation, artifact }`.
 *
 * Download, unwrap GitHub's outer ZIP, write it down, and judge it with the validator a
 * human would run. ONE implementation, called by both `bin/collect-remote.mjs` and the
 * MCP server - the approved brief is explicit that a second copy of this is how the
 * vendor package name came to be wrong in two workflows at once.
 */
export async function fetchCorpus({
  repository, runId, token, outDir = null,
  fetch: doFetch = globalThis.fetch, api = GITHUB_API,
  expectedClientRef = null,
} = {}) {
  // The folder is checked first: the download is the slow, rate-limited part, and an
  // unusable folder found after it would waste it and surface as a raw ENOTDIR. It is
  // created only once there is one package to write into it (#295): created before the
  // listing, it stayed behind, empty, for a run whose artifact had expired.
  const folder = (check) => {
    try {
      if (check) return usableOutDir(outDir ?? tempBase(), { create: false });
      return outDir == null
        ? fs.mkdtempSync(path.join(usableOutDir(tempBase()), 'fetchproof-corpus-'))
        : usableOutDir(outDir);
    } catch (err) {
      if (err instanceof DispatchError) throw err;
      throw new DispatchError('OUT_DIR', `could not create a private download folder (${err.code ?? err.message})`, {
        remedy: 'pass an existing writable folder, or repair the system temp directory',
      });
    }
  };
  folder(true);

  const artifacts = await listArtifacts({ repository, runId, token, fetch: doFetch, api });
  const wanted = artifacts.filter((a) => !a.expired && a.name.startsWith('fetchproof-corpus-v1-'));
  if (wanted.length !== 1) {
    throw new DispatchError('NO_ARTIFACT', `expected one corpus artifact on run ${runId}, found ${wanted.length}`, {
      remedy: wanted.length === 0
        // Told apart, because the two have different fixes: one is a broken run, the
        // other is a run whose artifact has aged out.
        ? 'the run produced no package, or its artifact has expired; check the upload step, or re-collect'
        : 'more than one corpus artifact on one run is not a shape this format defines',
    });
  }
  const dir = folder(false);
  const bytes = await downloadArtifact({ repository, artifactId: wanted[0].id, token, fetch: doFetch, api });
  const { bytes: pkg, unwrapped, name, unreadable } = unwrapArtifact(bytes);

  // A name from the API is data, never a path (found 2026-10-01, break-test): joined as it
  // came, `fetchproof-corpus-v1-/../../../pwned` wrote the package outside --out. A wrapper's
  // entry is flattened to its file name; an artifact name that is not a plain file name is
  // refused. Both separators and ':' everywhere - a name is judged the same on every host.
  const fileName = unwrapped ? String(name).split(/[\\/]/).pop() : `${wanted[0].name}.zip`;
  if (!fileName || fileName === '.' || fileName === '..' || /[\\/:\x00-\x1f]/.test(fileName)) {
    throw new DispatchError('ARTIFACT_NAME', `the artifact's name is not a plain file name: ${JSON.stringify(unwrapped ? name : wanted[0].name)}`, {
      remedy: 'nothing was written. The corpus artifact must be named fetchproof-corpus-v1-<id> - check what uploaded it',
    });
  }
  const file = path.join(dir, fileName);
  let target;
  try { target = fs.lstatSync(file); }
  catch (err) {
    if (err.code !== 'ENOENT') throw new DispatchError('OUT_DIR', `could not inspect ${file} (${err.code ?? err.message})`, {
      remedy: 'choose a writable output folder without a symbolic link at the package name',
    });
  }
  if (target?.isSymbolicLink()) throw new DispatchError('OUT_DIR', `${file} is a symbolic link; the package write must not be redirected`, {
    remedy: 'remove the link or choose another writable output folder',
  });
  // Whole or not at all (ADR-0079), as writeArtifact is: a failed write must not empty a
  // package already at this name (Arena break test 10, 2026-09-28).
  writeBytes(file, pkg);

  const validation = validateArtifact({ file, expectedClientRef });
  if (!unreadable) return { file, artifact: wanted[0], validation };
  // The wrapper is judged, and FAILs, but for the wrong reason: "manifest.json is not in the
  // package", whose remedy is to regenerate a package the damage may not be in. Why the package
  // inside did not read is the finding, and a download is the cheap thing to repeat (review of
  // #442, 2026-11-06).
  const problem = {
    code: unreadable.code,
    message: `the package inside GitHub's wrapper does not read: ${unreadable.message}`,
    path: unreadable.entry,
    remedy: `download it again with --run-id ${runId}; if it fails the same way, the stored artifact is damaged - re-collect`,
  };
  return { file, artifact: wanted[0], validation: { ...validation, errors: [problem, ...validation.errors.filter((e) => e.code !== 'MANIFEST-MISSING')] } };
}
