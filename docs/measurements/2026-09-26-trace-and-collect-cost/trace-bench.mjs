// Builds synthetic corpora through the real collector (stub fetcher, genuine hash chain) and
// times traceOf over every row and a full runPreflight. NOTE: this script re-reads the corpus
// before every page, so its buildMs is NOT the collector's cost - build-bench.mjs measures that.
// usage: node trace-bench.mjs   (takes ~11 minutes, dominated by the 2,000-page build)
import fs from 'node:fs';
import os from 'node:os';
import pathMod from 'node:path';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { scaffoldProject } from '../../../fetchproof/lib/scaffold.mjs';
import { collectOne } from '../../../fetchproof/lib/collect.mjs';
import { readCorpus, traceOf } from '../../../fetchproof/lib/corpus.mjs';
import { runPreflight } from '../../../fetchproof/lib/preflight.mjs';

const body = '# Page\n\n' + 'The free plan allows 10 requests per minute and includes 1,000 credits. '.repeat(30);
for (const n of [100, 500, 2000]) {
  const root = fs.mkdtempSync(pathMod.join(os.tmpdir(), `fp-bench-${n}-`));
  scaffoldProject(root, { topic: 'bench' });
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const url = `https://example.invalid/p/${i}`;
    collectOne(root, url, { corpus: readCorpus(root), runScrape: () => ({ ok: true, url, markdown: body, title: `P${i}`, statusCode: 200, transport: 'stub', completeness: 'full', cmd: `stub ${url}` }) });
  }
  const build = performance.now() - t0;
  const corpus = readCorpus(root);
  const rows = corpus.evidence;
  const t1 = performance.now();
  let hits = 0; for (const row of rows) if (traceOf(corpus, row).fetch) hits++;
  const traceMs = performance.now() - t1;
  const t2 = performance.now();
  let verdict = '?';
  try { const r = runPreflight(root); verdict = `pass=${r.pass} findings=${r.findings.length}`; } catch (e) { verdict = 'threw: ' + e.message.slice(0, 80); }
  const preMs = performance.now() - t2;
  console.log(JSON.stringify({ n, rows: rows.length, ledger: corpus.ledger.entries.length, traced: hits, buildMs: Math.round(build), allTracesMs: Math.round(traceMs), preflightMs: Math.round(preMs), verdict }));
}
