// witness.mjs - an opt-in third-party witness for a capture: the Wayback Machine (ADR-0106).
//
// The ledger proves a capture was not edited after it was fetched. It cannot prove the page
// said so. A Wayback snapshot of the same URL, close to the capture time, is somebody else's
// copy - an independent witness.
//
// From docs/decisions/2026-09-30-wayback-witness:
//   - The lookup is `GET archive.org/wayback/available?url=...&timestamp=YYYYMMDDhhmmss`, and it
//     answers `archived_snapshots.closest` or an empty `archived_snapshots` (E-01). The page is
//     from 2013 and says it changes, so every field is optional here.
//   - There is no documented programmatic save on the owner pages (U-02), so this module only
//     LOOKS UP; it never asks the archive to save anything.
//   - No rate limit is documented (U-05): one lookup per newly collected page, never retried.
//
// A lookup sends the URL to the Internet Archive, so nothing here runs unless the operator asks
// (`research --witness`). Every path returns a record; none throws, and none can fail a capture.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchEnv, CHILD_OUTPUT_LIMIT, boundedText, outputOverflow, fetchFailure } from './runtime.mjs';

export const ENDPOINT = 'https://archive.org/wayback/available';
export const DEFAULT_TIMEOUT = 15_000;

const SELF = fileURLToPath(import.meta.url);

/** A Date as the archive's 14-digit timestamp, YYYYMMDDhhmmss, in UTC (E-01). */
export function waybackTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** The Availability API request for `url`, asking for the snapshot closest to `timestamp`. */
export function requestUrl(url, timestamp) {
  const request = new URL(ENDPOINT);
  request.searchParams.set('url', String(url));
  if (timestamp) request.searchParams.set('timestamp', String(timestamp));
  return request;
}

/**
 * The answer as a witness record: `{ witnessed: true, snapshot, timestamp, status }`, or
 * `{ witnessed: false, reason }`. A body in any other shape is "not witnessed", by name.
 */
export function parseAvailability(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { witnessed: false, reason: 'the archive answered with something other than a JSON object' };
  }
  const snapshots = payload.archived_snapshots;
  if (!snapshots || typeof snapshots !== 'object') {
    return { witnessed: false, reason: 'the answer had no archived_snapshots' };
  }
  const closest = snapshots.closest;
  if (!closest) return { witnessed: false, reason: 'no snapshot: the Wayback Machine holds no copy of this URL' };
  if (closest.available !== true || typeof closest.url !== 'string' || !closest.url) {
    return { witnessed: false, reason: 'the closest snapshot is not available' };
  }
  const text = (value) => (typeof value === 'string' ? value : '');
  return { witnessed: true, snapshot: closest.url, timestamp: text(closest.timestamp), status: text(closest.status) };
}

/** Look `url` up once. Returns a witness record; never throws. */
export function lookup(url, { timestamp = waybackTimestamp(), timeout = DEFAULT_TIMEOUT, env = process.env, job = runJob } = {}) {
  let answer;
  try { answer = job({ kind: 'wayback-available', url: String(url), timestamp, timeout }, { timeout, env }); } catch (err) {
    return { witnessed: false, reason: `the lookup failed: ${err?.message ?? err}` };
  }
  if (!answer?.ok) return { witnessed: false, reason: answer?.error || 'the lookup failed' };
  return parseAvailability(answer.payload);
}

export function runJob(job, { timeout = DEFAULT_TIMEOUT, spawn = spawnSync, nodePath = process.execPath, env = process.env } = {}) {
  const result = spawn(nodePath, [SELF], {
    input: JSON.stringify(job), encoding: 'utf8', timeout: timeout + 5_000, windowsHide: true,
    env: fetchEnv(env), maxBuffer: CHILD_OUTPUT_LIMIT,
  });
  if (result.error?.code === 'ETIMEDOUT') return { ok: false, error: `the Wayback Machine did not answer within ${timeout / 1000}s` };
  const overflow = outputOverflow(result, 'the Wayback lookup');
  if (overflow) return { ok: false, error: overflow };
  if (result.error) return { ok: false, error: result.error.message };
  const out = String(result.stdout ?? '').trim();
  if (!out) return { ok: false, error: String(result.stderr || 'the Wayback lookup produced no output').trim() };
  try { return JSON.parse(out); } catch (err) { return { ok: false, error: `unparseable lookup output: ${err.message}` }; }
}

// ---------------------------------------------------------------- the child half

async function child() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let job;
  try { job = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: `unparseable job: ${err.message}` }));
    return;
  }
  if (job.kind !== 'wayback-available') {
    process.stdout.write(JSON.stringify({ ok: false, error: `unknown job kind "${job.kind}"` }));
    return;
  }
  try {
    const response = await fetch(requestUrl(job.url, job.timestamp), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(job.timeout ?? DEFAULT_TIMEOUT),
    });
    const body = await boundedText(response, 'the Wayback answer');
    if (!response.ok) {
      process.stdout.write(JSON.stringify({ ok: false, statusCode: response.status, error: `the Wayback Machine answered HTTP ${response.status}` }));
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch {
      process.stdout.write(JSON.stringify({ ok: false, error: `the Wayback Machine answered HTTP ${response.status} with a non-JSON body` }));
      return;
    }
    process.stdout.write(JSON.stringify({ ok: true, statusCode: response.status, payload }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: `could not reach the Wayback Machine: ${fetchFailure(err)}` }));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await child();
}
