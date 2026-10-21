// The last inch: `bin/research.mjs` driven through a real collecting run, against real
// providers, spending real money.
//
// This was the one limit left after the three validation gaps closed, and the reason
// given for it was sloppy. Two different things were being conflated:
//
//   - Running it ONCE costs a couple of credits. That was never blocked.
//   - Running it on EVERY `selftest.mjs` costs a couple of credits every time, for
//     every developer, forever. That is the real constraint.
//
// So the test exists and is opted into, rather than not existing. Off by default, it
// registers a single test that checks the gate is actually closed - so the file is never
// dead code and the mechanism itself is covered. On, it runs the real thing.
//
//   FETCHPROOF_LIVE=1 SERPAPI_API_KEY=... node fetchproof/bin/selftest.mjs
//
// It scaffolds a temp project and runs there, so a live run never touches this
// repository's own corpus.

import { spawnSync } from 'node:child_process';
import { test, describe, assert, tempDir, fs, path, KIT_ROOT } from './harness.mjs';
import { scaffoldProject } from '../lib/scaffold.mjs';
import { readLedger, readCorpus } from '../lib/corpus.mjs';
import * as firecrawl from '../lib/firecrawl.mjs';
import * as serpapi from '../lib/serpapi.mjs';

describe('live-collect');

export const LIVE_ENV = 'FETCHPROOF_LIVE';

/** Opted in, and able? Both, or the live tests do not register at all. */
function liveEnabled(env = process.env) {
  return env[LIVE_ENV] === '1' && Boolean(serpapi.readKey({ env }));
}

if (!liveEnabled()) {
  test('LIVE COLLECT is opt-in, and is currently OFF', () => {
    // Not a placeholder. This asserts the gate is shut for the right reason, which is
    // what stops a suite from quietly costing money on somebody else's machine.
    assert.equal(liveEnabled({}), false, 'the live gate opens with no opt-in at all');
    assert.equal(liveEnabled({ [LIVE_ENV]: '1' }), false, 'the gate opened with no key');
    assert.equal(liveEnabled({ SERPAPI_API_KEY: 'k'.repeat(40) }), false, 'a key alone opened the gate');
    assert.equal(liveEnabled({ [LIVE_ENV]: '1', SERPAPI_API_KEY: 'k'.repeat(40) }), true,
      'the gate cannot be opened even deliberately');
    assert.equal(liveEnabled({ [LIVE_ENV]: 'yes', SERPAPI_API_KEY: 'k'.repeat(40) }), false,
      'a truthy-looking value opened the gate; it must be exactly "1"');
  });
} else {
  const PLAN = {
    topic: 'live collect check',
    notes: 'One query, one page. Written by test/live-collect.test.mjs.',
    depth: 'probe',
    refreshDays: 30,
    limit: 5,
    perQuery: 1,
    maxScrapes: 1,
    prefer: ['docs.firecrawl.dev'],
    queries: [{ q: 'firecrawl scrape endpoint documentation', why: 'U-1', prefer: ['docs.firecrawl.dev'] }],
    urls: [],
  };

  test('LIVE COLLECT: a real run spends TWO meters and records both', () => {
    const root = tempDir('fp-live-');
    scaffoldProject(root, { topic: PLAN.topic });
    fs.writeFileSync(path.join(root, 'research/plan.json'), JSON.stringify(PLAN, null, 2));

    const before = firecrawl.status();
    assert.equal(before.authenticated, true, 'the fetch provider is not authenticated - cannot measure a spend');

    const result = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'research.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 180_000,
      windowsHide: true,
    });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.status, 0, `the run failed:\n${out}`);

    // --- what it SAID -------------------------------------------------------------
    assert.match(out, /^transport: firecrawl-cli/m, out);
    assert.match(out, /^search:\s+serpapi/m, `the second provider was not announced:\n${out}`);
    assert.match(out, /^searches\s+\d+ on serpapi$/m, `the search meter was not reported:\n${out}`);
    assert.equal(/degraded/.test(out), false, `the run fell back to the fetch provider:\n${out}`);

    const key = serpapi.readKey({ env: process.env });
    assert.equal(out.includes(key), false, 'the live run printed the key');

    // --- what it WROTE ------------------------------------------------------------
    const ledger = readLedger(root);
    assert.equal(ledger.problems.length, 0, `the chain broke: ${JSON.stringify(ledger.problems)}`);
    assert.ok(ledger.entries.length >= 1, 'nothing was collected');

    const entry = ledger.entries[0];
    assert.equal(entry.transport, 'firecrawl-cli', 'the capture was not stamped with the real fetch provider');
    assert.equal(entry.discoveredBy, 'serpapi',
      'the URL was not credited to the provider that actually ranked it');
    assert.ok(entry.bodySha256 && entry.bodySha256.length === 64, 'no body hash - the capture is not verifiable');
    assert.ok(fs.existsSync(path.join(root, entry.raw)), `the capture file is missing: ${entry.raw}`);

    const usage = JSON.parse(fs.readFileSync(path.join(root, 'research/raw/.usage.jsonl'), 'utf8').trim().split('\n').pop());
    assert.equal(usage.transport, 'firecrawl-cli');
    assert.equal(usage.searchTransport, 'serpapi');
    assert.equal(usage.searchesUsed, 1, 'the search meter recorded the wrong spend');
    assert.equal(usage.degraded, 0);
    assert.ok(usage.spent >= 1, 'no fetch spend was recorded');

    assert.ok(readCorpus(root).evidence.length >= 1, 'no evidence row was written');

    // --- what it COST -------------------------------------------------------------
    // The claim this whole change rests on, measured rather than argued: the search did
    // not come out of the fetch budget.
    const after = firecrawl.status();
    const fetchSpend = before.credits - after.credits;
    assert.ok(fetchSpend >= 1, `no Firecrawl credits were spent (${before.credits} -> ${after.credits})`);
    assert.ok(fetchSpend <= 3,
      `the fetch budget paid for more than the pages: ${fetchSpend} credits for ${usage.spent} scrape(s). `
      + 'Before the split a search cost 2 credits on this same budget.');
  });

  test('LIVE COLLECT: the run leaves THIS repository untouched', () => {
    // A live test that quietly collected into the real corpus would be worse than no
    // live test: it would put unreviewed captures behind the gate.
    const repo = path.resolve(KIT_ROOT, '..');
    const ledger = readLedger(repo);
    assert.equal(ledger.problems.length, 0, 'the live run damaged this repository');
    assert.equal(ledger.entries.every((e) => !/live collect check/i.test(e.usedFor ?? '')), true,
      'a live-test capture reached the real corpus');
  });
}
