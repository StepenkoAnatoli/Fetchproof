// measure.mjs - put the same queries to both search providers and record what came back.
//
// Why: one SerpAPI ETIMEDOUT (tavily-terms BRIEF, 2026-09-22) is a data point, not a
// verdict. This records many, from both providers, on identical queries.
//
// SerpAPI goes through the kit's own child-process path (`serpapi.runJob`) - the path that
// timed out - but with a 90 s ceiling instead of the kit's 30 s, so the tail is measured
// rather than cut off; `overKitTimeout` marks the calls the kit itself would have lost.
// Firecrawl goes through its HTTP search API: the kit's Firecrawl search runs through the
// CLI, and the machine this was measured on has none. Same vendor, different client.
//
// Keys are read from files named by SERPAPI_KEY_FILE and FIRECRAWL_KEY_FILE, never from
// argv, and nothing written out carries them - the output is scanned for both before it
// is appended.
//
// usage: node measure.mjs <round-label> <queries.txt>   (appends to results.jsonl)

import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runJob, ENDPOINT } from '../../../fetchproof/lib/serpapi.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'results.jsonl');
const CEILING = 90_000;
const KIT_TIMEOUT = 30_000;
// Round A sent queries back to back and met Firecrawl's documented 10 /search per minute
// (E-01) on the 11th. PAUSE_MS spaces them, so later rounds measure the provider rather
// than the limit. Recorded on every row.
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 0);

const [round, queryFile] = process.argv.slice(2);
if (!round || !queryFile) {
  console.error('usage: node measure.mjs <round-label> <queries.txt>');
  process.exit(2);
}
const readKeyFile = (envName) => {
  const path = process.env[envName];
  if (!path) { console.error(`${envName} is not set`); process.exit(2); }
  return readFileSync(path, 'utf8').trim();
};
const serpKey = readKeyFile('SERPAPI_KEY_FILE');
const fcKey = readKeyFile('FIRECRAWL_KEY_FILE');
const queries = readFileSync(queryFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function serp(query) {
  const t0 = Date.now();
  const answer = runJob({ kind: 'serpapi-search', query, apiKey: serpKey, timeout: CEILING, endpoint: ENDPOINT }, { timeout: CEILING });
  const ms = Date.now() - t0;
  const p = answer.payload ?? {};
  const rows = Array.isArray(p.organic_results) ? p.organic_results : [];
  const ok = Boolean(answer.ok && !p.error);
  return {
    ok, ms, overKitTimeout: ms > KIT_TIMEOUT,
    error: ok ? null : String(answer.error || p.error || 'unknown'),
    vendorSeconds: p.search_metadata?.total_time_taken ?? null,
    vendorStatus: p.search_metadata?.status ?? null,
    searchId: p.search_metadata?.id ?? null,
    results: rows.length,
    urls: rows.slice(0, 8).map((r) => r.link).filter(Boolean),
  };
}

async function firecrawl(query) {
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${fcKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, limit: 8 }),
      signal: AbortSignal.timeout(CEILING),
    });
    const ms = Date.now() - t0;
    const body = await res.json().catch(() => ({}));
    const rows = Array.isArray(body?.data?.web) ? body.data.web : (Array.isArray(body?.data) ? body.data : []);
    const ok = res.ok && body?.success !== false;
    return {
      ok, ms, overKitTimeout: ms > KIT_TIMEOUT, http: res.status,
      error: ok ? null : String(body?.error || `HTTP ${res.status}`),
      creditsUsed: body?.creditsUsed ?? null,
      results: rows.length,
      urls: rows.slice(0, 8).map((r) => r.url).filter(Boolean),
    };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, overKitTimeout: Date.now() - t0 > KIT_TIMEOUT, error: err.message, results: 0, urls: [] };
  }
}

for (const [i, query] of queries.entries()) {
  if (i && PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
  // Alternate who goes first, so neither provider always meets a cold connection.
  const serpFirst = i % 2 === 0;
  let s, f;
  if (serpFirst) { s = serp(query); f = await firecrawl(query); } else { f = await firecrawl(query); s = serp(query); }
  const sh = new Set(s.urls.map(hostOf)), fh = new Set(f.urls.map(hostOf));
  const row = {
    round, at: new Date().toISOString(), i, query, first: serpFirst ? 'serpapi' : 'firecrawl', pauseMs: PAUSE_MS,
    serpapi: s, firecrawl: f,
    sharedHosts: [...sh].filter((h) => h && fh.has(h)).length,
  };
  const line = JSON.stringify(row);
  if (line.includes(serpKey) || line.includes(fcKey)) throw new Error('a key reached the output; nothing written');
  appendFileSync(OUT, line + '\n');
  console.log(`${String(i).padStart(2)} serp ${s.ok ? 'ok ' : 'ERR'} ${String(s.ms).padStart(6)}ms n=${s.results} | fc ${f.ok ? 'ok ' : 'ERR'} ${String(f.ms).padStart(6)}ms n=${f.results} | shared hosts ${row.sharedHosts} | ${query.slice(0, 60)}`);
}
