#!/usr/bin/env node
// check-action-pins.mjs - does every action the workflows pin by commit SHA still resolve?
//
// Every third-party action here is pinned to a full SHA (a test enforces it). A pin whose
// commit disappears - a force-pushed or deleted upstream - fails every workflow at checkout,
// before a single test runs, on whatever pull request happens to be open (break-test PR #140).
// Run weekly by .github/workflows/action-pins.yml, so a dead pin is found by a schedule
// rather than by a contributor.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFailure } from '../../fetchproof/lib/runtime.mjs';

const USES = /uses:\s*([\w.-]+)\/([\w.-]+)(?:\/[^@\s]*)?@([0-9a-f]{40})\b(?:[^\n#]*#\s*(v[\w.-]+))?/g;

/** Every SHA-pinned action in the given workflow texts, once each, with the tag its comment names. */
export function pinnedActions(texts) {
  const seen = new Map();
  for (const text of texts) {
    for (const m of String(text).matchAll(USES)) {
      const key = `${m[1]}/${m[2]}@${m[3]}`;
      if (!seen.has(key)) seen.set(key, { owner: m[1], repo: m[2], sha: m[3], tag: m[4] ?? '' });
    }
  }
  return [...seen.values()];
}

/**
 * Ask GitHub for each pinned commit. 404 or 422 means the pin is dead (no such repository or
 * no such commit). Any other failure - a rate limit, an outage - says nothing about the pin, so
 * it is reported as unchecked, never as dead, and the check still does not pass.
 *
 * A request that never left is named by its CAUSE, not as the bare `fetch failed` Node throws.
 * Reproduced 2026-09-30 on a host with no egress to api.github.com: all four pins printed
 * `request failed: fetch failed`, which is the same line a mistyped proxy, a DNS failure and a
 * TLS rejection produce - so the one line a weekly check prints when it cannot do its job said
 * nothing about which of those it was. `fetchFailure` is the kit's existing answer to exactly
 * this (ADR-0047); a helper whose whole job is to explain a fetch should not be bypassed by the
 * script that most often runs where fetches are constrained.
 */
export async function checkPins(pins, { fetch = globalThis.fetch, token = '' } = {}) {
  const dead = [];
  const unknown = [];
  for (const pin of pins) {
    const url = `https://api.github.com/repos/${pin.owner}/${pin.repo}/commits/${pin.sha}`;
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    } catch (err) {
      unknown.push({ ...pin, detail: `request failed: ${fetchFailure(err)}` });
      continue;
    }
    if (res.ok) continue;
    const entry = { ...pin, detail: `GitHub answered ${res.status} for ${pin.owner}/${pin.repo}@${pin.sha}` };
    if (res.status === 404 || res.status === 422) dead.push(entry);
    else unknown.push(entry);
  }
  return { ok: dead.length === 0 && unknown.length === 0, dead, unknown };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'workflows');
  const texts = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  const pins = pinnedActions(texts);
  const result = await checkPins(pins, { token: process.env.GH_TOKEN ?? '' });
  for (const pin of pins) {
    const bad = [...result.dead, ...result.unknown].find((d) => d.sha === pin.sha && d.repo === pin.repo);
    process.stdout.write(`${bad ? (result.dead.includes(bad) ? 'DEAD   ' : 'UNCHECKED') : 'ok     '} ${pin.owner}/${pin.repo}@${pin.sha.slice(0, 12)}${pin.tag ? ` (${pin.tag})` : ''}${bad ? ` - ${bad.detail}` : ''}\n`);
  }
  if (result.dead.length) process.stdout.write(`\n${result.dead.length} pin(s) no longer resolve: re-resolve the tag to a SHA and update every workflow that uses it.\n`);
  process.exit(result.ok ? 0 : 1);
}
