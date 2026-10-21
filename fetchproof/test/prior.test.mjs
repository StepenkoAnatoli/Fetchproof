// The registered prior: what was expected BEFORE the evidence, and the three ways a
// dishonest one could get in. Each of those three is measured here rather than argued,
// because "the chain makes it impossible" is exactly the kind of claim that turns out to
// have a gap nobody tried.

import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test, describe, assert, makeProject, makePassingProject, corrupt, tempDir, fs, path, KIT_ROOT } from './harness.mjs';
import { PATHS, resolve, readText, writeText, sha256 } from '../lib/core.mjs';
import { readCorpus, readLedger, CAPTURE_MAX_BYTES } from '../lib/corpus.mjs';
import { appendFetch, verifyLedger } from '../lib/provenance.mjs';
import { runCheck } from '../lib/checks.mjs';
import { renderBrief } from '../lib/brief.mjs';
import { registerPrior, readPrior, priorRefusal, priorOf, readPriorSource, PRIOR_PATH, PRIOR_OP, MIN_PRIOR } from '../lib/prior.mjs';

describe('prior');

const GOOD = 'I expect the free tier to cap at 10 requests a minute, because that is what the '
  + 'pricing page said in May. I do not know whether the cap is per key or per account.';

function snapshot(dir) {
  const corpus = readCorpus(dir);
  corpus.chain = verifyLedger(dir, { corpus });
  return corpus;
}

const entriesOf = (dir) => readLedger(dir).entries;

test('a registered prior lands at seq 1 and chains the file it names', () => {
  const dir = makeProject();
  const entry = registerPrior(dir, GOOD);

  assert.equal(entry.seq, 1);
  assert.equal(entry.op, PRIOR_OP);
  assert.equal(entry.raw, PRIOR_PATH);
  assert.equal(entry.bodySha256, sha256(fs.readFileSync(resolve(dir, PRIOR_PATH))));
  assert.match(readText(resolve(dir, PRIOR_PATH)), /free tier to cap at 10 requests/);
});

test('a prior is not a capture - it lives outside research/raw and is never counted as one', () => {
  // `readCaptures` walks the raw directory, so a file anywhere else cannot be mistaken for
  // evidence. Pinned because the obvious place to put PRIOR.md would have been beside the
  // captures, where it would have arrived with no url in its front-matter and shown up as
  // a `capture-no-url` problem on every project that registered one.
  //
  // On a scaffolded corpus rather than a collected one since #353: a prior is refused beside
  // captures the ledger does not record, which is what the passing fixture with its ledger
  // emptied was.
  const dir = makeProject(undefined, { content: true });
  registerPrior(dir, GOOD);

  assert.equal(readCorpus(dir).captures.entries.length, 0);
  assert.ok(readCorpus(dir).problems.every((p) => p.artifact !== PATHS.raw), 'PRIOR.md was read as a capture');
  assert.ok(!PRIOR_PATH.startsWith(PATHS.raw), 'the prior must not live under research/raw');
});

test('editing the prediction after collecting fails the chain', () => {
  // The first of the three dishonest paths, and the one that needs no new code: the prior
  // is chained with its bodySha256, so revising it once the answer is known breaks
  // `body-unmodified` through the machinery a capture already uses.
  const dir = makeProject();
  registerPrior(dir, GOOD);
  writeText(resolve(dir, PRIOR_PATH), 'I always expected whatever the evidence turned out to say.\n');

  const findings = runCheck('provenance', snapshot(dir));
  const hit = findings.find((f) => f.rule === 'body-unmodified');
  assert.equal(hit.severity, 'fail');
  assert.match(hit.detail, /PRIOR\.md does not match the hash recorded at fetch/);
});

test('registerPrior refuses once a page has been collected', () => {
  // The second path, closed by the tool.
  const dir = makePassingProject();
  const refusal = priorRefusal(dir, GOOD, { entries: entriesOf(dir) });
  assert.match(refusal, /already been collected/);
  assert.throws(() => registerPrior(dir, GOOD), /already been collected/);
  assert.ok(!fs.existsSync(resolve(dir, PRIOR_PATH)), 'a refused registration writes nothing');
});

test('a late prior chained BY HAND, with every hash correct, still fails the gate', () => {
  // The third path, and the only one that needed a check. `bin/prior.mjs` can be bypassed -
  // `appendFetch` is a public export and will happily chain a prior at seq 2 - so the gate
  // verifies the ORDER itself rather than trusting that the tool was used. Without this,
  // the other two refusals would be a fence with a gate left open beside it.
  const dir = makePassingProject();
  const body = 'Registered afterwards, with the answer already in hand.\n';
  writeText(resolve(dir, PRIOR_PATH), body);
  appendFetch(dir, {
    op: PRIOR_OP,
    raw: PRIOR_PATH,
    bodySha256: sha256(Buffer.from(body, 'utf8')),
    completeness: 'unspecified',
  });

  const chain = verifyLedger(dir);
  assert.ok(chain.ok, 'the forged chain verifies - which is the point');

  const hit = runCheck('provenance', snapshot(dir)).find((f) => f.rule === 'prior-precedes-collection');
  assert.equal(hit.severity, 'fail');
  assert.match(hit.detail, /after 1 page\(s\) were already collected/);
});

test('two registered priors are refused - you predict once, or you pick the one that matched', () => {
  const dir = makeProject();
  registerPrior(dir, GOOD);
  assert.throws(() => registerPrior(dir, `${GOOD} Or possibly the opposite of all of that.`),
    /already has a registered prior/);

  // And if one is chained by hand anyway, the gate says so rather than reading the first.
  const body = 'A second prediction, hedging the first.\n';
  writeText(resolve(dir, 'research/PRIOR-2.md'), body);
  appendFetch(dir, { op: PRIOR_OP, raw: 'research/PRIOR-2.md', bodySha256: sha256(Buffer.from(body, 'utf8')) });
  const hit = runCheck('provenance', snapshot(dir)).find((f) => f.rule === 'prior-single');
  assert.equal(hit.severity, 'fail');
});

test('a prior too short to be falsifiable is refused, and the floor is a floor not a judgement', () => {
  const dir = makeProject();
  assert.throws(() => registerPrior(dir, 'it will be fine'), new RegExp(`at least ${MIN_PRIOR}`));

  // The floor cannot tell a real prediction from padding, and does not claim to. What it
  // stops is a one-word prior that could be called correct afterwards whatever happened.
  assert.equal(priorRefusal(dir, 'x'.repeat(MIN_PRIOR), { entries: [] }), null);
});

test('the gate is SILENT when no prior is registered', () => {
  // A prior is optional. A warning on every project that did not register one is a warning
  // nobody reads, and would turn the habit into a toll - so absence produces no finding at
  // all, not a passing one and not a warning.
  const dir = makePassingProject();
  const findings = runCheck('provenance', snapshot(dir));
  assert.ok(!findings.some((f) => f.rule.startsWith('prior-')), 'no prior means nothing to say');
  assert.ok(findings.every((f) => f.severity === 'pass'));
});

test('a correctly registered prior passes, and the finding quotes it', () => {
  const dir = makeProject();
  registerPrior(dir, GOOD);
  const hit = runCheck('provenance', snapshot(dir)).find((f) => f.rule === 'prior-precedes-collection');
  assert.equal(hit.severity, 'pass');
  assert.match(hit.detail, /before anything was collected/);
  assert.match(hit.detail, /free tier to cap at 10 requests/);
});

test('the drafted brief quotes the prior verbatim, and never scores it', () => {
  // The prior is only worth registering if it is read back NEXT TO the answer. Left in its
  // own file it is a file nobody opens; the brief is the one document phase 2 must read.
  const dir = makeProject();
  registerPrior(dir, GOOD);
  renderBrief(dir, { force: true });
  const brief = readText(resolve(dir, PATHS.brief));

  assert.match(brief, /## The prior, registered before anything was collected/);
  assert.match(brief, /> I expect the free tier to cap at 10 requests a minute/);
  assert.ok(brief.indexOf('## The prior') < brief.indexOf('## Intent'),
    'the prediction is read before the findings, not after them');
  for (const word of ['correct', 'confirmed', 'vindicated', 'score']) {
    assert.ok(!new RegExp(`prior[^#]{0,400}${word}`, 'i').test(brief),
      `the brief must not grade the prior (found "${word}")`);
  }
});

test('a brief drafted without a prior gains no empty section', () => {
  const dir = makeProject();
  renderBrief(dir, { force: true });
  assert.ok(!readText(resolve(dir, PATHS.brief)).includes('## The prior'));
});

test('readPrior reports a late registration rather than hiding it', () => {
  const dir = makePassingProject();
  const body = 'After the fact.\n';
  writeText(resolve(dir, PRIOR_PATH), body);
  appendFetch(dir, { op: PRIOR_OP, raw: PRIOR_PATH, bodySha256: sha256(Buffer.from(body, 'utf8')) });

  const prior = readPrior(dir, { entries: entriesOf(dir) });
  assert.equal(prior.present, true);
  assert.equal(prior.scrapesBefore, 1);
  assert.equal(priorOf(entriesOf(dir)).op, PRIOR_OP);
});

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A second process that takes the project's lock, says so, and runs `body` inside it, with
 * `waitFor(file, ms)` and its extra `args` in scope. The lock is reentrant in-process, so a
 * registration racing a collector is only measurable across two processes.
 */
function holdLock(dir, body, args = []) {
  const ready = path.join(tempDir('fp-prior-lock-'), 'ready');
  const script = `
    const fs = (await import('node:fs')).default;
    const { withLock, appendFetch } = await import(${JSON.stringify(pathToFileURL(path.join(KIT_ROOT, 'lib', 'provenance.mjs')).href)});
    const [dir, ready, ...args] = process.argv.slice(1);
    const waitFor = (file, ms) => {
      const until = Date.now() + ms;
      while (!fs.existsSync(file) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    };
    withLock(dir, () => { fs.writeFileSync(ready, '1'); ${body} });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir, ready, ...args], { windowsHide: true, stdio: 'ignore' });
  const exited = new Promise((done) => child.on('exit', done));
  return {
    exited,
    async taken() {
      const deadline = Date.now() + 30_000;
      while (!fs.existsSync(ready) && Date.now() < deadline) await pause(20);
      assert.ok(fs.existsSync(ready), 'the holder never took the lock');
    },
  };
}

/** `bin/prior.mjs` in `dir`, with `--require` preloads when a test needs to watch it. */
function priorCli(dir, args, { preload = [], env = {} } = {}) {
  return spawnSync(process.execPath, [...preload.flatMap((p) => ['--require', p]), path.join(KIT_ROOT, 'bin', 'prior.mjs'), ...args],
    { cwd: dir, encoding: 'utf8', timeout: 150_000, windowsHide: true, env: { ...process.env, ...env } });
}

// Found 2026-10 (#352): the CLI decided "nothing collected yet" on a ledger read BEFORE the
// lock, then appended under it - after a scrape a concurrent collector had appended in
// between - and printed "before any page was collected" with exit 0 over a prior the gate
// then failed.
test('a registration that waits on a collector holding the lock is decided on the ledger it appends to', async () => {
  const dir = makeProject();
  // The holder appends its scrape the moment the registration first tries for the lock, which
  // makes the race deterministic: a CJS preload wraps the `node:fs` object provenance.mjs
  // imports and marks the first exclusive open of the lock file. Unfixed, the registration had
  // decided by then; fixed, it decides again once it holds the lock.
  const mark = path.join(tempDir('fp-prior-mark-'), 'trying');
  const shim = path.join(tempDir('fp-prior-shim-'), 'mark-lock.cjs');
  fs.writeFileSync(shim, `
    const fs = require('fs');
    const open = fs.openSync;
    fs.openSync = function openSync(file, flags, ...rest) {
      if (flags === 'wx' && String(file).endsWith('.fetches.lock') && !fs.existsSync(process.env.FP_LOCK_MARK)) {
        fs.writeFileSync(process.env.FP_LOCK_MARK, '1');
      }
      return open.call(this, file, flags, ...rest);
    };
  `);
  const holder = holdLock(dir, `
    waitFor(args[0], 60_000);
    appendFetch(dir, { op: 'scrape', url: 'https://example.invalid/late', raw: 'research/raw/late.md', bodySha256: '0'.repeat(64) });
  `, [mark]);
  await holder.taken();

  const cli = priorCli(dir, [GOOD], { preload: [shim], env: { FP_LOCK_MARK: mark } });
  await holder.exited;
  assert.ok(fs.existsSync(mark), 'the registration never tried for the lock - the race was not run');
  assert.doesNotMatch(cli.stdout, /before any page was collected/, cli.stdout);
  assert.equal(cli.status, 2, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /already been collected/);
  assert.ok(!fs.existsSync(resolve(dir, PRIOR_PATH)), 'a refused registration writes nothing');
  assert.equal(priorOf(entriesOf(dir)), null);
});

// Found 2026-10-18 (review of #352): the fix took the lock before any check, so `prior` on a
// corpus already collected, run while a collection held the lock, waited up to 120 s and
// exited LOCK_HELD instead of saying at once that pages were already in. Refusals only
// accumulate, so one decided on an unlocked read is never wrong.
test('a registration a collected corpus refuses is refused at once, not after the lock', async () => {
  const dir = makePassingProject();
  const release = path.join(tempDir('fp-prior-release-'), 'release');
  const released = path.join(path.dirname(release), 'released');
  const holder = holdLock(dir, `waitFor(args[0], 30_000); fs.writeFileSync(args[1], '1');`, [release, released]);
  await holder.taken();

  const cli = priorCli(dir, [GOOD]);
  const answeredWhileHeld = !fs.existsSync(released);
  fs.writeFileSync(release, '1');
  await holder.exited;
  assert.ok(answeredWhileHeld, 'the refusal waited for the collector to release the lock');
  assert.equal(cli.status, 2, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /1 page\(s\) have already been collected/);
});

// Found 2026-10 (#353): with the ledger lost - the case AGENTS.md describes - or emptied, the
// only count of "collected" was the ledger's scrapes, so a prior registered at seq 1 "before
// anything was collected" beside every capture and evidence row, and the gate passed it.
for (const [label, lose] of [
  ['deleted', (dir) => fs.rmSync(resolve(dir, PATHS.ledger))],
  ['truncated', (dir) => writeText(resolve(dir, PATHS.ledger), '')],
]) {
  test(`a prior is refused on a corpus whose ledger was ${label}, naming the captures on disk`, () => {
    const dir = makePassingProject();
    const capture = readCorpus(dir).captures.entries[0].file;
    lose(dir);
    assert.throws(() => registerPrior(dir, GOOD), /1 capture\(s\) and 1 evidence row\(s\) are already on disk/);
    assert.throws(() => registerPrior(dir, GOOD), (err) => err.message.includes(capture)
      && /restore it/.test(err.message) && /remove its capture/.test(err.message));
    assert.ok(!fs.existsSync(resolve(dir, PRIOR_PATH)), 'a refused registration writes nothing');

    // Chained by hand anyway, nothing that reports the prior says "before anything was
    // collected": not the gate, not the read-back, not the brief (review, 2026-10-18).
    writeText(resolve(dir, PRIOR_PATH), `${GOOD}\n`);
    appendFetch(dir, { op: PRIOR_OP, raw: PRIOR_PATH, bodySha256: sha256(Buffer.from(`${GOOD}\n`, 'utf8')) });
    const hit = runCheck('provenance', snapshot(dir)).find((f) => f.rule === 'prior-precedes-collection');
    assert.equal(hit.severity, 'fail', hit.detail);
    assert.ok(hit.detail.includes(capture), hit.detail);
    assert.doesNotMatch(hit.detail, /before anything was collected/);

    const prior = readPrior(dir, { entries: entriesOf(dir) });
    assert.equal(prior.precedes, false);
    assert.deepEqual(prior.unrecorded?.files, [capture]);

    const back = priorCli(dir, []);
    assert.equal(back.status, 1, back.stdout + back.stderr);
    assert.doesNotMatch(back.stdout, /before anything was collected/);
    assert.match(back.stdout, /the ledger records no collection/);

    renderBrief(dir, { force: true });
    const brief = readText(resolve(dir, PATHS.brief));
    assert.doesNotMatch(brief, /registered before anything was collected/);
    assert.match(brief, /the ledger records no collection/);
  });
}

test('a prior whose captures all follow it in the ledger still passes', () => {
  // The other half of #353: captures on disk are not late by being there, only by being
  // unordered. One collected after the prior is what a registered prior is for.
  const dir = makeProject();
  registerPrior(dir, GOOD);
  const file = 'research/raw/after.md';
  writeText(resolve(dir, file), '---\nurl: https://example.invalid/after\n---\n\nbody\n');
  appendFetch(dir, { op: 'scrape', url: 'https://example.invalid/after', raw: file, bodySha256: sha256(fs.readFileSync(resolve(dir, file))) });
  const hit = runCheck('provenance', snapshot(dir)).find((f) => f.rule === 'prior-precedes-collection');
  assert.equal(hit.severity, 'pass', hit.detail);
});

test('a stray capture beside a correctly ordered prior is hygiene, not a late prior', () => {
  // Found 2026-10-18 (review of #353): with a scrape on record after the prior, one capture no
  // entry names - a collector killed between writing a capture and recording it, or a copy
  // beside one - failed the prior and told the operator to restore the ledger, which would
  // have discarded the entries of fetches not yet committed. It is what `uncited-capture` warns
  // about; the ledger's order is only unknowable when it records no collection at all.
  const dir = makeProject();
  registerPrior(dir, GOOD);
  const file = 'research/raw/after.md';
  writeText(resolve(dir, file), '---\nurl: https://example.invalid/after\n---\n\nbody\n');
  appendFetch(dir, { op: 'scrape', url: 'https://example.invalid/after', raw: file, bodySha256: sha256(fs.readFileSync(resolve(dir, file))) });
  const stray = 'research/raw/after - Copy.md';
  writeText(resolve(dir, stray), '---\nurl: https://example.invalid/after\n---\n\nbody\n');

  const corpus = snapshot(dir);
  const hit = runCheck('provenance', corpus).find((f) => f.rule === 'prior-precedes-collection');
  assert.equal(hit.severity, 'pass', hit.detail);
  const warned = runCheck('hygiene', corpus).find((f) => f.rule === 'uncited-capture' && f.file === stray);
  assert.equal(warned?.severity, 'warn', 'the stray capture is still reported');
  assert.equal(readPrior(dir, { entries: entriesOf(dir) }).precedes, true);
});

// Found 2026-10 (#355): `--file` read the file whole with no bound, and the brief - the
// one-page handoff - inlined a 42 MB prior.
test('a prior file over the capture bound is refused by name, before it is read', () => {
  const file = path.join(tempDir('fp-prior-big-'), 'big.md');
  fs.writeFileSync(file, Buffer.alloc(CAPTURE_MAX_BYTES + 1, 'x'));
  const got = readPriorSource(file, 'big.md');
  assert.equal(got.text, null);
  assert.match(got.refusal, /big\.md is 10\.0 MB, over the 10 MB a prior may be/);
  assert.throws(() => registerPrior(makeProject(), 'x'.repeat(CAPTURE_MAX_BYTES + 1)), /over the 10 MB a prior may be/);
});
