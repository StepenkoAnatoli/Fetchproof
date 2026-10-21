// Times collectOne per page with the corpus read ONCE, as runResearch does.
// usage: node build-bench.mjs   (~30 s)
import fs from 'node:fs';
import os from 'node:os';
import pathMod from 'node:path';
import { performance } from 'node:perf_hooks';
import { scaffoldProject } from '../../../fetchproof/lib/scaffold.mjs';
import { collectOne } from '../../../fetchproof/lib/collect.mjs';
import { readCorpus } from '../../../fetchproof/lib/corpus.mjs';
const body = '# Page\n\n' + 'The free plan allows 10 requests per minute and includes 1,000 credits. '.repeat(30);
for (const n of [100, 300, 500]) {
  const root = fs.mkdtempSync(pathMod.join(os.tmpdir(), `fp-build-${n}-`));
  scaffoldProject(root, { topic: 'bench' });
  const corpus = readCorpus(root);                     // once, as runResearch does
  const lap = [];
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const url = `https://example.invalid/p/${i}`;
    const s = performance.now();
    collectOne(root, url, { corpus, runScrape: () => ({ ok: true, url, markdown: body, title: `P${i}`, statusCode: 200, transport: 'stub', completeness: 'full', cmd: `stub ${url}` }) });
    lap.push(performance.now() - s);
  }
  const tail = lap.slice(-20).reduce((a, b) => a + b, 0) / 20;
  console.log(JSON.stringify({ n, totalMs: Math.round(performance.now() - t0), firstPageMs: +lap[0].toFixed(1), lastPagesAvgMs: +tail.toFixed(1) }));
}
