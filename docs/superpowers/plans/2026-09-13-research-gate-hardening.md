# Research Gate Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Fetchproof's preflight gate block work at commit time and edit time, and make hand-typed evidence fail so a passing verdict means evidence was actually fetched.

**Architecture:** One verdict function (`bin/gate.mjs`, exporting `evaluate`) is called by three consumers: a machine-wide git `pre-commit` hook, a Claude Code `PreToolUse` hook, and `preflight.mjs`. Verdict correctness rests on two new libraries: `lib/provenance.mjs`, which writes and verifies an append-only hash-chained fetch ledger, and `lib/collect.mjs`, which isolates the fetch→cache→ledger pipeline so it can be tested without network access.

**Tech Stack:** Node.js 24 (ESM `.mjs`, no dependencies, `node:test`-free home-grown harness), git 2.55 hooks, Firecrawl CLI invoked through a shell (`lib/cli.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-13-research-gate-hardening-design.md`

## Global Constraints

- Node ESM only. No new npm dependencies; `package.json` must not be created.
- Every module is a `.mjs` file using `import`/`export`; no CommonJS `require`.
- All tests run with **no Firecrawl key and no network access**.
- Do not run `firecrawl` for real in any test; inject a stub.
- Gating markers, exactly these four: `research/DISCOVERY.md`, `research/plan.json`, `research/EVIDENCE.md`, `research/raw/`. A `research/` directory containing none of them is **not** gated.
- Opt-out file is `research/GATE_OFF` only. There is no `GATE_ON`.
- While the verdict fails, staged paths confined to `research/` are allowed; anything else blocks.
- `bin/gate.mjs` exit codes: `0` allow, `1` block, `2` internal error.
- Claude gate emits `permissionDecision: "ask"` by default; `"hard-block"` stays behind config.
- Machine config lives at `~/.agents/fetchproof.config.json` — **outside** the deployed kit tree, so `install.mjs` can never overwrite it.
- `research/raw/.fetches.jsonl` is written **only** by the collector. Gate overrides and gate-absent warnings go to `research/overrides.log`.
- Default failure posture is fail-open and loud: a broken gate must not brick the machine.
- Commit steps assume a git repo. **This project has no repo** (spec O-2). Until O-2 is resolved, treat each Commit step as a checkpoint: run `node bin/selftest.mjs` and record the output.
- The real `~/.claude/settings.json` may only be written after explicit approval (spec O-1). Tests use fixture paths.

## File Structure

| File | Responsibility |
|---|---|
| `fetchproof/test/harness.mjs` | Test registration, assertions, temp-project builders, fixtures |
| `fetchproof/test/preflight.test.mjs` | The 10 existing preflight/ledger tests, migrated |
| `fetchproof/test/provenance.test.mjs` | Chain write/verify, tamper, truncation, repair |
| `fetchproof/test/collect.test.mjs` | Fetch→raw→ledger pipeline with a stubbed scraper |
| `fetchproof/test/gate.test.mjs` | Verdict, gating predicate, diff-scope rule |
| `fetchproof/test/hooks.test.mjs` | Real git-hook block, Claude payload decisions |
| `fetchproof/test/install-hooks.test.mjs` | hooksPath set/restore, settings repair, uninstall |
| `fetchproof/lib/provenance.mjs` | Chained ledger append + verify (single writer) |
| `fetchproof/lib/collect.mjs` | One URL: scrape, cache raw, ledger, evidence row |
| `fetchproof/lib/config.mjs` | Machine config load/save |
| `fetchproof/bin/gate.mjs` | `evaluate(root, opts)`, CLI, exit codes |
| `fetchproof/githooks/pre-commit` | Commit gate, delegates to `bin/gate.mjs` |
| `fetchproof/hooks/claude-pretooluse.mjs` | PreToolUse payload → `permissionDecision` |
| `fetchproof/bin/install-hooks.mjs` | Install/uninstall both gates |
| `fetchproof/bin/preflight.mjs` | + five provenance checks |
| `fetchproof/bin/research.mjs` | Delegates collection to `lib/collect.mjs` |
| `fetchproof/bin/doctor.mjs` | + gate health reporting |
| `fetchproof/bin/selftest.mjs` | Runner: imports every `test/*.test.mjs` |

---

### Task 1: Test harness and runner

**Files:**
- Create: `fetchproof/test/harness.mjs`
- Create: `fetchproof/test/preflight.test.mjs` (migrates the 10 tests currently in `bin/selftest.mjs`)
- Modify: `fetchproof/bin/selftest.mjs` (becomes a runner)

**Interfaces:**
- Consumes: nothing.
- Produces: `test(name, fn)` (registers a test), `summary()` (prints results, returns failure count), `assert(condition, message)`, `assertEqual(actual, expected, message)`, `makeProject()` → temp dir path containing a copy of `template/`, `writeDiscovery(dir, { intent, rows })` → writes `research/DISCOVERY.md`, `addEvidenceRow(dir, { id, url, type, rawPath, bodyChars })` → writes a raw file and appends a matching `EVIDENCE.md` row, `KIT` (absolute kit path), `TEMPLATE` (absolute template path).

- [ ] **Step 1: Write the harness**

```js
// test/harness.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendRow } from '../lib/ledger.mjs';
import { EVIDENCE_HEADERS, EVIDENCE_FILE, PLAN_FILE } from '../lib/core.mjs';

export const KIT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
export const TEMPLATE = path.join(KIT, 'template');

const registered = [];
export function test(name, fn) {
  registered.push({ name, fn });
}

export function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed');
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message ?? 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Temp project with a copy of template/; removed after the test. */
export function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-'));
  fs.cpSync(TEMPLATE, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PLAN_FILE), JSON.stringify({ topic: 'test', queries: [{ q: 'x' }] }, null, 2));
  return dir;
}

export function writeDiscovery(dir, { intent = 'A test project that builds nothing but proves the gate behaves.', rows = [] }) {
  const body = rows
    .map((r) => `| ${r.id} | ${r.unknown} | ${r.why ?? 'changes the design'} | ${r.status} | ${r.evidence ?? ''} |`)
    .join('\n');
  fs.writeFileSync(
    path.join(dir, 'research', 'DISCOVERY.md'),
    `# Discovery Contract\n\n## Build intent\n\n${intent}\n\n## Unknowns\n\n| ID | Unknown | Why it blocks the build | Status | Evidence |\n|---|---|---|---|---|\n${body}\n`,
  );
}

export function addEvidenceRow(dir, { id = 'E-01', url, type = 'P', rawPath, bodyChars = 400 }) {
  const rel = rawPath ?? `research/raw/2026-01-01-test-${id.toLowerCase()}.md`;
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\nurl: ${url}\nretrieved: ${new Date().toISOString()}\ntype: ${type}\n---\n\n# Test\n\n${'Fetched page text. '.repeat(Math.ceil(bodyChars / 18))}\n`);
  appendRow(dir, EVIDENCE_FILE, EVIDENCE_HEADERS, [id, new Date().toISOString().slice(0, 10), type, url, 'Rate limit is 200 requests per minute.', rel]);
  return rel;
}

export function summary() {
  let failures = 0;
  for (const { name, fn } of registered) {
    try {
      fn();
      console.log(`  ok    ${name}`);
    } catch (error) {
      failures += 1;
      console.log(`  FAIL  ${name}\n        ${error.message.split('\n').slice(0, 12).join('\n        ')}`);
    }
  }
  return failures;
}

export function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Migrate the existing tests into `test/preflight.test.mjs`**

Move all 10 `test(...)` blocks from `bin/selftest.mjs` verbatim, changing only the imports to come from `./harness.mjs` and `../bin/preflight.mjs`. The test named `ledger is not clobbered by notes written after the table` keeps using `appendRow` from `../lib/ledger.mjs` directly. Each test must call `cleanup(dir)` at the end (the old runner did this in a `finally`).

- [ ] **Step 3: Replace `bin/selftest.mjs` with a runner**

```js
#!/usr/bin/env node
// selftest.mjs - runs every test/*.test.mjs file. No network, no Firecrawl key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summary } from '../test/harness.mjs';

const TEST_DIR = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'test');
const files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.mjs')).sort();

console.log('fetchproof selftest\n');
for (const file of files) {
  console.log(`${file}`);
  await import(path.join(TEST_DIR, file));
}

const failures = summary();
console.log(`\n${failures === 0 ? 'all tests passed' : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 4: Run the suite**

Run: `node fetchproof/bin/selftest.mjs`
Expected: prints `preflight.test.mjs`, 10 `ok` lines, `all tests passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add fetchproof/test fetchproof/bin/selftest.mjs
git commit -m "test: split selftest into a runner plus per-module test files"
```

---

### Task 2: Provenance ledger

**Files:**
- Create: `fetchproof/lib/provenance.mjs`
- Test: `fetchproof/test/provenance.test.mjs`

**Interfaces:**
- Consumes: `hashShort`-style hashing is not reused; this module uses `node:crypto` directly.
- Produces: `LEDGER_FILE`, `OVERRIDES_FILE`, `LOCK_FILE` (relative path constants); `canonical(entry) -> string`; `entryHash(entry) -> string`; `hashFile(absPath) -> string`; `readLedger(root) -> { entries, problems }`; `appendFetch(root, input) -> entry` where `input` is `{ op, url, type, raw, cmd, error }`; `verifyLedger(root) -> { ok, problems }`; `appendOverride(root, { gate, reason }) -> void`; `withLock(root, fn) -> void`.

- [ ] **Step 1: Write the failing tests**

```js
// test/provenance.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { test, assert, assertEqual, makeProject, cleanup } from './harness.mjs';
import {
  LEDGER_FILE, appendFetch, appendOverride, entryHash, hashFile, readLedger, repairLedgerTail, verifyLedger, withLock,
} from '../lib/provenance.mjs';

function seedRaw(dir, name, body) {
  const rel = `research/raw/${name}`;
  fs.writeFileSync(path.join(dir, rel), body);
  return rel;
}

test('append + verify: intact chain passes', () => {
  const dir = makeProject();
  try {
    const raw = seedRaw(dir, 'a.md', 'page one body');
    appendFetch(dir, { op: 'scrape', url: 'https://a.test/docs', type: 'P', raw, cmd: 'firecrawl scrape https://a.test/docs --json' });
    const raw2 = seedRaw(dir, 'b.md', 'page two body');
    appendFetch(dir, { op: 'scrape', url: 'https://b.test/docs', type: 'S', raw: raw2, cmd: 'firecrawl scrape https://b.test/docs --json' });
    const result = verifyLedger(dir);
    assertEqual(result.ok, true, `expected ok, problems: ${JSON.stringify(result.problems)}`);
    assertEqual(readLedger(dir).entries.length, 2);
  } finally { cleanup(dir); }
});

test('a tampered body breaks bodySha256', () => {
  const dir = makeProject();
  try {
    const raw = seedRaw(dir, 'a.md', 'original body');
    appendFetch(dir, { op: 'scrape', url: 'https://a.test/docs', type: 'P', raw, cmd: 'firecrawl scrape x' });
    fs.appendFileSync(path.join(dir, raw), '\nhand written addition');
    const result = verifyLedger(dir);
    assertEqual(result.ok, false);
    assert(result.problems.some((p) => p.check === 'body-unmodified'), `got ${JSON.stringify(result.problems)}`);
  } finally { cleanup(dir); }
});

test('deleting a ledger line breaks the chain', () => {
  const dir = makeProject();
  try {
    for (const [name, url] of [['a.md', 'https://a.test'], ['b.md', 'https://b.test'], ['c.md', 'https://c.test']]) {
      appendFetch(dir, { op: 'scrape', url, type: 'P', raw: seedRaw(dir, name, `body ${name}`), cmd: 'firecrawl scrape x' });
    }
    const file = path.join(dir, LEDGER_FILE);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    fs.writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n');
    const result = verifyLedger(dir);
    assertEqual(result.ok, false);
    assert(result.problems.some((p) => p.check === 'chain-intact'), `got ${JSON.stringify(result.problems)}`);
  } finally { cleanup(dir); }
});

test('a fabricated entry breaks entrySha256', () => {
  const dir = makeProject();
  try {
    const raw = seedRaw(dir, 'a.md', 'body');
    appendFetch(dir, { op: 'scrape', url: 'https://a.test', type: 'P', raw, cmd: 'firecrawl scrape x' });
    const entry = readLedger(dir).entries[0];
    const forged = { ...entry, url: 'https://evil.test' };
    fs.writeFileSync(path.join(dir, LEDGER_FILE), JSON.stringify(forged) + '\n');
    assertEqual(verifyLedger(dir).ok, false);
    assertEqual(entryHash({ ...entry, url: 'https://evil.test' }) === entry.entrySha256, false);
  } finally { cleanup(dir); }
});

test('a truncated tail is reported with its line number', () => {
  const dir = makeProject();
  try {
    appendFetch(dir, { op: 'scrape', url: 'https://a.test', type: 'P', raw: seedRaw(dir, 'a.md', 'b'), cmd: 'firecrawl scrape x' });
    fs.appendFileSync(path.join(dir, LEDGER_FILE), '{"seq":2,"at":"2026');
    const result = verifyLedger(dir);
    assertEqual(result.ok, false);
    assert(result.problems.some((p) => p.check === 'truncated-tail'), `got ${JSON.stringify(result.problems)}`);
  } finally { cleanup(dir); }
});

test('repair drops a truncated tail only when the rest of the chain is intact', () => {
  const dir = makeProject();
  try {
    appendFetch(dir, { op: 'scrape', url: 'https://a.test', type: 'P', raw: seedRaw(dir, 'a.md', 'b'), cmd: 'firecrawl scrape x' });
    fs.appendFileSync(path.join(dir, LEDGER_FILE), '{"seq":2,"at":"2026');
    const repaired = repairLedgerTail(dir);
    assertEqual(repaired.repaired, true);
    assertEqual(verifyLedger(dir).ok, true, JSON.stringify(verifyLedger(dir).problems));
    assertEqual(repairLedgerTail(dir).repaired, false, 'a clean ledger needs no repair');
  } finally { cleanup(dir); }
});

test('failures are recorded and counted as attempts', () => {
  const dir = makeProject();
  try {
    appendFetch(dir, { op: 'fail', url: 'https://walled.test', type: 'P', raw: null, cmd: 'firecrawl scrape x', error: 'login required' });
    const { entries } = readLedger(dir);
    assertEqual(entries.length, 1);
    assertEqual(entries[0].op, 'fail');
    assertEqual(entries[0].error, 'login required');
  } finally { cleanup(dir); }
});

test('overrides are logged outside the chain', () => {
  const dir = makeProject();
  try {
    appendOverride(dir, { gate: 'commit', reason: 'GATE_OFF' });
    const text = fs.readFileSync(path.join(dir, 'research/overrides.log'), 'utf8');
    assert(text.includes('GATE_OFF'), text);
    assertEqual(fs.existsSync(path.join(dir, LEDGER_FILE)), false, 'chain must not be touched by the gate');
  } finally { cleanup(dir); }
});

test('withLock releases and blocks a second live holder', () => {
  const dir = makeProject();
  try {
    withLock(dir, () => assertEqual(fs.existsSync(path.join(dir, 'research/raw/.fetches.lock')), true));
    assertEqual(fs.existsSync(path.join(dir, 'research/raw/.fetches.lock')), false, 'lock must be released');
    fs.writeFileSync(path.join(dir, 'research/raw/.fetches.lock'), String(process.pid));
    let threw = false;
    try { withLock(dir, () => {}); } catch { threw = true; }
    assertEqual(threw, true, 'a live lock must refuse');
  } finally { cleanup(dir); }
});

test('hashFile matches the recorded bodySha256', () => {
  const dir = makeProject();
  try {
    const raw = seedRaw(dir, 'a.md', 'some body');
    const entry = appendFetch(dir, { op: 'scrape', url: 'https://a.test', type: 'P', raw, cmd: 'firecrawl scrape x' });
    assertEqual(hashFile(path.join(dir, raw)), entry.bodySha256);
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node fetchproof/bin/selftest.mjs`
Expected: FAIL — `Cannot find module '.../lib/provenance.mjs'`.

- [ ] **Step 3: Implement the module**

```js
// lib/provenance.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { abs, appendText, ensureDir, exists, nowIso, readText } from './core.mjs';

export const LEDGER_FILE = 'research/raw/.fetches.jsonl';
export const OVERRIDES_FILE = 'research/overrides.log';
export const LOCK_FILE = 'research/raw/.fetches.lock';
const GENESIS = '0'.repeat(64);
const STALE_LOCK_MS = 10 * 60 * 1000;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

export function canonical(entry) {
  const keys = Object.keys(entry).filter((k) => k !== 'entrySha256').sort();
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, entry[k]])));
}

export function entryHash(entry) {
  return sha256(canonical(entry));
}

export function hashFile(absPath) {
  return sha256(fs.readFileSync(absPath, 'utf8'));
}

export function readLedger(root) {
  const file = abs(root, LEDGER_FILE);
  const problems = [];
  if (!exists(file)) return { entries: [], problems };
  const lines = readText(file, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const entries = [];
  lines.forEach((line, index) => {
    try {
      entries.push({ ...JSON.parse(line), __line: index + 1 });
    } catch {
      problems.push({ check: 'truncated-tail', detail: `line ${index + 1} is not valid JSON` });
    }
  });
  return { entries, problems };
}

export function verifyLedger(root) {
  const { entries, problems } = readLedger(root);
  const out = [...problems];
  let prev = GENESIS;
  entries.forEach((entry, index) => {
    const line = entry.__line ?? index + 1;
    const clean = { ...entry };
    delete clean.__line;
    if (clean.seq !== index + 1) {
      out.push({ check: 'chain-intact', detail: `line ${line}: seq ${clean.seq} should be ${index + 1}` });
    }
    if (clean.prev !== prev) {
      out.push({ check: 'chain-intact', detail: `line ${line}: prev link does not match the previous entry` });
    }
    if (entryHash(clean) !== clean.entrySha256) {
      out.push({ check: 'chain-intact', detail: `line ${line}: entrySha256 does not recompute` });
    }
    if (clean.raw) {
      const rawPath = abs(root, clean.raw);
      if (!exists(rawPath)) out.push({ check: 'body-unmodified', detail: `line ${line}: raw file ${clean.raw} is missing` });
      else if (hashFile(rawPath) !== clean.bodySha256) {
        out.push({ check: 'body-unmodified', detail: `line ${line}: ${clean.raw} changed after it was fetched` });
      }
    }
    prev = clean.entrySha256;
  });
  return { ok: out.length === 0, problems: out, entries };
}

export function appendFetch(root, { op, url, type = null, raw = null, cmd = null, error = null }) {
  const { entries } = readLedger(root);
  const seq = entries.length + 1;
  const body = {
    seq,
    at: nowIso(),
    op,
    url,
    type,
    raw,
    bodySha256: raw ? hashFile(abs(root, raw)) : null,
    cmd,
    error,
    prev: entries.length ? entries[entries.length - 1].entrySha256 : GENESIS,
  };
  // prev must be set before entrySha256, or the hash covers the wrong payload.
  body.entrySha256 = entryHash(body);
  appendText(abs(root, LEDGER_FILE), `${JSON.stringify(body)}\n`);
  return body;
}

export function appendOverride(root, { gate, reason }) {
  appendText(abs(root, OVERRIDES_FILE), `${nowIso()}\t${gate}\t${reason}\n`);
}

export function repairLedgerTail(root) {
  const file = abs(root, LEDGER_FILE);
  if (!exists(file)) return { repaired: false };
  const text = readText(file, '');
  if (!text) return { repaired: false };
  const endsClean = text.endsWith('\n');
  if (endsClean) return { repaired: false };
  const lines = text.split('\n');
  const tail = lines[lines.length - 1];
  try {
    JSON.parse(tail);
    return { repaired: false };
  } catch {
    lines.pop();
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return { repaired: true, dropped: tail.slice(0, 40) };
  }
}

export function withLock(root, fn) {
  const file = abs(root, LOCK_FILE);
  if (exists(file)) {
    const age = Date.now() - fs.statSync(file).mtimeMs;
    const pid = Number(readText(file, '0').trim());
    const alive = pid === process.pid || (pid > 0 && !isProcessDead(pid));
    if (alive && age < STALE_LOCK_MS) throw new Error(`another collector is running (pid ${pid}); delete ${LOCK_FILE} if that is wrong`);
  }
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, String(process.pid));
  try {
    return fn();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function isProcessDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 19 `ok` lines total (10 migrated + 9 new), `all tests passed`.

- [ ] **Step 5: Commit**

```bash
git add fetchproof/lib/provenance.mjs fetchproof/test/provenance.test.mjs
git commit -m "feat: add hash-chained fetch ledger"
```

---

### Task 3: Collection pipeline with an injectable scraper

**Files:**
- Create: `fetchproof/lib/collect.mjs`
- Test: `fetchproof/test/collect.test.mjs`
- Modify: `fetchproof/bin/research.mjs` (delegate to `collectOne`)

**Interfaces:**
- Consumes: `appendFetch`, `withLock` from `lib/provenance.mjs`; `appendRow`, `upsertSource` from `lib/ledger.mjs`; `inferSourceType`, `slugify`, `hostOf`, `hashShort`, `today`, `nowIso`, `rel`, `abs`, `writeText`, `readRows` from `lib/core.mjs`.
- Produces: `collectOne(root, options) -> { result: 'scraped'|'cached'|'failed', rawRel?, evidenceId?, error? }` where `options` is `{ url, type, origin, title, command, runScrape, refreshDays, rawIndex, force }` and `runScrape(url) -> { ok, doc: { markdown, title, statusCode }, error, command }`; `writeRaw(root, input) -> string` (returns the project-relative path); `firstFinding(markdown, fallback) -> string`.

- [ ] **Step 1: Write the failing tests**

```js
// test/collect.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { test, assert, assertEqual, makeProject, cleanup } from './harness.mjs';
import { collectOne } from '../lib/collect.mjs';
import { readLedger, verifyLedger } from '../lib/provenance.mjs';
import { readRows } from '../lib/ledger.mjs';
import { EVIDENCE_FILE } from '../lib/core.mjs';

const okScrape = (markdown) => () => ({
  ok: true,
  command: 'firecrawl scrape https://docs.test/x --only-main-content --json',
  doc: { markdown, title: 'Rate limits', statusCode: 200 },
  error: '',
});

test('a successful fetch writes raw, evidence row, and a ledger entry', () => {
  const dir = makeProject();
  try {
    const out = collectOne(dir, {
      url: 'https://docs.test/x', type: 'P', origin: 'query: test', runScrape: okScrape('# Rate limits\n\n' + 'Fetched page text. '.repeat(40)), refreshDays: 30,
    });
    assertEqual(out.result, 'scraped');
    assert(fs.existsSync(path.join(dir, out.rawRel)), 'raw file must exist');
    assertEqual(readRows(dir, EVIDENCE_FILE).length, 1);
    assertEqual(readLedger(dir).entries.length, 1);
    assertEqual(verifyLedger(dir).ok, true);
  } finally { cleanup(dir); }
});

test('the ledger entry matches the citation url', () => {
  const dir = makeProject();
  try {
    collectOne(dir, { url: 'https://docs.test/limits', type: 'P', origin: 'x', runScrape: okScrape('body '.repeat(60)), refreshDays: 30 });
    const entry = readLedger(dir).entries[0];
    assertEqual(entry.url, 'https://docs.test/limits');
    assertEqual(entry.op, 'scrape');
    assert(entry.cmd.includes('firecrawl'), entry.cmd);
  } finally { cleanup(dir); }
});

test('a failed scrape records op:fail and writes no evidence row', () => {
  const dir = makeProject();
  try {
    const out = collectOne(dir, {
      url: 'https://walled.test/x', type: 'P', origin: 'x', refreshDays: 30,
      runScrape: () => ({ ok: false, command: 'firecrawl scrape https://walled.test/x', doc: { markdown: '', statusCode: 403 }, error: 'login required' }),
    });
    assertEqual(out.result, 'failed');
    assertEqual(readRows(dir, EVIDENCE_FILE).length, 0, 'a failure must never look like evidence');
    const entry = readLedger(dir).entries[0];
    assertEqual(entry.op, 'fail');
    assertEqual(entry.error, 'login required');
  } finally { cleanup(dir); }
});

test('a thin page is treated as a failure', () => {
  const dir = makeProject();
  try {
    const out = collectOne(dir, { url: 'https://docs.test/thin', type: 'P', origin: 'x', refreshDays: 30, runScrape: okScrape('too short') });
    assertEqual(out.result, 'failed');
    assertEqual(readRows(dir, EVIDENCE_FILE).length, 0);
  } finally { cleanup(dir); }
});

test('a fresh cache entry is reused without fetching', () => {
  const dir = makeProject();
  try {
    const first = collectOne(dir, { url: 'https://docs.test/c', type: 'P', origin: 'x', refreshDays: 30, runScrape: okScrape('body '.repeat(60)) });
    let calls = 0;
    const out = collectOne(dir, {
      url: 'https://docs.test/c', type: 'P', origin: 'x', refreshDays: 30,
      runScrape: () => { calls += 1; return okScrape('body '.repeat(60))(); },
    });
    assertEqual(out.result, 'cached');
    assertEqual(calls, 0, 'must not spend a credit on a fresh cache hit');
    assertEqual(first.result, 'scraped');
    assertEqual(readRows(dir, EVIDENCE_FILE).length, 1, 'cache hits must not duplicate rows');
  } finally { cleanup(dir); }
});

test('sources are deduplicated by url', () => {
  const dir = makeProject();
  try {
    collectOne(dir, { url: 'https://docs.test/d', type: 'P', origin: 'x', refreshDays: 0, force: true, runScrape: okScrape('body '.repeat(60)) });
    collectOne(dir, { url: 'https://docs.test/d', type: 'P', origin: 'x', refreshDays: 0, force: true, runScrape: okScrape('body '.repeat(60)) });
    const sources = fs.readFileSync(path.join(dir, 'research/SOURCES.md'), 'utf8');
    assertEqual((sources.match(/https:\/\/docs\.test\/d/g) ?? []).length, 1, 'one source row per url');
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node fetchproof/bin/selftest.mjs`
Expected: FAIL — `Cannot find module '.../lib/collect.mjs'`.

- [ ] **Step 3: Implement the module**

```js
// lib/collect.mjs
import path from 'node:path';
import {
  EVIDENCE_FILE, EVIDENCE_HEADERS, RAW_DIR, SOURCES_FILE, SOURCE_HEADERS,
  abs, ageInDays, hashShort, hostOf, nowIso, rel, slugify, today, writeText,
} from './core.mjs';
import { appendRow, readRows, upsertSource } from './ledger.mjs';
import { appendFetch } from './provenance.mjs';

export function firstFinding(markdown, fallback) {
  const line = String(markdown || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .find((l) => l.length > 40);
  return (line || fallback || '').slice(0, 220);
}

export function writeRaw(root, { url, type, title, markdown, origin, command, statusCode = null }) {
  const date = today();
  const name = `${date}-${slugify(title || hostOf(url), 50)}-${hashShort(url)}.md`;
  const file = path.join(abs(root, RAW_DIR), name);
  const front = [
    '---',
    `url: ${url}`,
    `retrieved: ${nowIso()}`,
    `date: ${date}`,
    `type: ${type}`,
    `host: ${hostOf(url)}`,
    `title: ${JSON.stringify(title || '')}`,
    `origin: ${origin}`,
    `command: ${command}`,
    `statusCode: ${statusCode ?? ''}`,
    '---',
    '',
  ].join('\n');
  writeText(file, `${front}${markdown.trim()}\n`);
  return rel(root, file);
}

export function collectOne(root, options) {
  const {
    url, type = 'S', origin = 'adhoc', title = '', runScrape, refreshDays = 30, rawIndex, force = false,
  } = options;

  const cached = rawIndex?.get(url);
  const fresh = cached ? (ageInDays(cached.retrieved) ?? Infinity) <= refreshDays : false;
  if (cached && fresh && !force) return { result: 'cached', rawRel: cached.file };

  const res = runScrape(url);
  const markdown = res.doc?.markdown ?? '';
  if (!res.ok || markdown.length < 200) {
    const error = res.error || `empty or failed scrape (status ${res.doc?.statusCode ?? '?'})`;
    appendFetch(root, { op: 'fail', url, type, raw: null, cmd: res.command ?? null, error });
    return { result: 'failed', error };
  }

  const rawRel = writeRaw(root, {
    url, type, title: res.doc.title || title, markdown, origin, command: res.command, statusCode: res.doc.statusCode,
  });
  const entry = appendFetch(root, { op: 'scrape', url, type, raw: rawRel, cmd: res.command, error: null });

  const evidenceRows = readRows(root, EVIDENCE_FILE);
  const evidenceId = `E-${String(evidenceRows.length + 1).padStart(2, '0')}`;
  appendRow(root, EVIDENCE_FILE, EVIDENCE_HEADERS, [
    evidenceId, today(), type, url, firstFinding(markdown, title), rawRel,
  ]);
  upsertSource(root, SOURCES_FILE, SOURCE_HEADERS, 'URL', {
    ID: `SR-${String(readRows(root, SOURCES_FILE).length + 1).padStart(2, '0')}`,
    URL: url,
    Type: type,
    'First retrieved': today(),
    'Local raw evidence': rawRel,
  });

  return { result: 'scraped', rawRel, evidenceId, entry, cachedAt: entry.at };
}
```

- [ ] **Step 4: Rewire `bin/research.mjs`**

Delete the local `normalizeScrape`-based scrape block and the local `writeRaw`, and call `collectOne`. Keep the existing `normalizeSearch`, `runScrape`, and reporting code. Inside the collection loop replace the failure/scrape/cache handling with:

```js
import { collectOne } from '../lib/collect.mjs';
import { withLock } from '../lib/provenance.mjs';

withLock(root, () => {
  for (const candidate of candidates) {
    const out = collectOne(root, {
      url: candidate.url,
      type: candidate.type || opts.type || inferSourceType(candidate.url, prefer),
      origin: candidate.origin,
      title: candidate.title,
      refreshDays,
      force: opts.force,
      rawIndex,
      runScrape,
    });
    if (out.result === 'scraped') { scraped += 1; rawIndex.set(candidate.url, { file: out.rawRel, retrieved: nowIso() }); }
    else if (out.result === 'cached') reused += 1;
    else failures.push({ url: candidate.url, error: out.error });
    summary.push({ result: out.result, type: candidate.type || '-', host: hostOf(candidate.url), url: candidate.url });
  }
});
```

Remove the now-unused `writeRaw` and `firstFinding` definitions from `research.mjs`, and the `budgetLeft`/`maxScrapes` check must run before each `collectOne` call exactly as it does today.

- [ ] **Step 5: Run the tests and the dry run**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 25 `ok` lines, `all tests passed`.
Run: `node fetchproof/bin/research.mjs --query "example" --dry-run`
Expected: prints the planned `firecrawl search`/`scrape` commands and exits 0 without network access.

- [ ] **Step 6: Commit**

```bash
git add fetchproof/lib/collect.mjs fetchproof/test/collect.test.mjs fetchproof/bin/research.mjs
git commit -m "refactor: isolate the fetch pipeline so it is testable without network"
```

---

### Task 4: Provenance checks in preflight

**Files:**
- Modify: `fetchproof/bin/preflight.mjs`
- Test: `fetchproof/test/preflight.test.mjs` (append 5 tests)

**Interfaces:**
- Consumes: `verifyLedger`, `readLedger` from `lib/provenance.mjs`.
- Produces: five new check names reported through the existing `findings` array: `chain-intact`, `fetch-entry-exists`, `body-unmodified`, `timestamp-agreement`, `unknown-attempted` (warning).

- [ ] **Step 1: Write the failing tests**

```js
test('a citation with no ledger entry fails fetch-entry-exists', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'CLOSED', evidence: 'E-01' }] });
    addEvidenceRow(dir, { url: 'https://docs.test/limits' });
    const result = runPreflight({ root: dir });
    assertEqual(result.passed, false);
    assert(result.failures.some((f) => f.check === 'fetch-entry-exists'), JSON.stringify(result.failures));
  } finally { cleanup(dir); }
});

test('a citation backed by a real ledger entry passes', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'CLOSED', evidence: 'E-01' }] });
    const rawRel = addEvidenceRow(dir, { url: 'https://docs.test/limits' });
    appendFetch(dir, { op: 'scrape', url: 'https://docs.test/limits', type: 'P', raw: rawRel, cmd: 'firecrawl scrape https://docs.test/limits --json' });
    const result = runPreflight({ root: dir });
    assertEqual(result.passed, true, JSON.stringify(result.failures));
  } finally { cleanup(dir); }
});

test('editing a captured page after fetch fails body-unmodified', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'CLOSED', evidence: 'E-01' }] });
    const rawRel = addEvidenceRow(dir, { url: 'https://docs.test/limits' });
    appendFetch(dir, { op: 'scrape', url: 'https://docs.test/limits', type: 'P', raw: rawRel, cmd: 'firecrawl scrape x' });
    fs.appendFileSync(path.join(dir, rawRel), '\nedited by hand\n');
    const result = runPreflight({ root: dir });
    assertEqual(result.passed, false);
    assert(result.failures.some((f) => f.check === 'body-unmodified'), JSON.stringify(result.failures));
  } finally { cleanup(dir); }
});

test('a broken chain blocks the build', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'CLOSED', evidence: 'E-01' }] });
    const rawRel = addEvidenceRow(dir, { url: 'https://docs.test/limits' });
    appendFetch(dir, { op: 'scrape', url: 'https://docs.test/limits', type: 'P', raw: rawRel, cmd: 'firecrawl scrape x' });
    const file = path.join(dir, 'research/raw/.fetches.jsonl');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/"seq":1/, '"seq":9'));
    const result = runPreflight({ root: dir });
    assertEqual(result.passed, false);
    assert(result.failures.some((f) => f.check === 'chain-intact'), JSON.stringify(result.failures));
  } finally { cleanup(dir); }
});

test('a KNOWN-UNKNOWN with no fetch attempt warns but does not block', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Quota panel?', status: 'KNOWN-UNKNOWN', evidence: 'Read the dashboard quota panel on day one and record it.' }] });
    const rawRel = addEvidenceRow(dir, { url: 'https://docs.test/other' });
    appendFetch(dir, { op: 'scrape', url: 'https://docs.test/other', type: 'P', raw: rawRel, cmd: 'firecrawl scrape x' });
    const result = runPreflight({ root: dir });
    assertEqual(result.passed, true, JSON.stringify(result.failures));
    assert(result.warnings.some((w) => w.check === 'unknown-attempted'), JSON.stringify(result.warnings));
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 3 of the 5 new tests FAIL (`fetch-entry-exists`, `body-unmodified`, `chain-intact` are unreported); the two pass-through tests currently pass.

- [ ] **Step 3: Add the checks**

In `fetchproof/bin/preflight.mjs`, add `import { readLedger, verifyLedger } from '../lib/provenance.mjs';` to the imports at the **top** of the file, and insert the following block after the existing per-citation loop (the `import` line shown below is a reminder of what must be at the top, not a second import to paste mid-file):

```js
import { readLedger, verifyLedger } from '../lib/provenance.mjs';

// ---- 3b. Provenance: the evidence must have been fetched, not typed --------
const ledger = verifyLedger(root);
if (ledger.entries.length === 0) {
  add('fail', 'fetch-entry-exists', 'no fetch ledger at all (research/raw/.fetches.jsonl) - evidence was not collected by research.mjs');
} else {
  for (const problem of ledger.problems) {
    add('fail', problem.check, problem.detail);
  }
}

const fetchedUrls = new Set(ledger.entries.filter((e) => e.op === 'scrape').map((e) => e.url));
for (const row of evidenceRows) {
  const id = norm(col(row, 'ID'));
  const url = norm(col(row, 'URL'));
  if (!url) continue;
  if (!fetchedUrls.has(url)) {
    add('fail', 'fetch-entry-exists', `${id || url}: no ledger entry for ${url} - the cached page cannot be traced to a fetch`);
  }
  const entry = ledger.entries.find((e) => e.raw === norm(col(row, 'Raw')) && e.op === 'scrape');
  if (entry) {
    const rawPath = abs(root, entry.raw);
    if (exists(rawPath)) {
      const retrieved = readText(rawPath, '').match(/^retrieved:\s*(\S+)/m)?.[1] ?? '';
      if (retrieved !== entry.at) {
        add('fail', 'timestamp-agreement', `${id || url}: raw file says ${retrieved || 'nothing'}, ledger says ${entry.at}`);
      }
      const command = readText(rawPath, '').match(/^command:\s*(.*)$/m)?.[1] ?? '';
      if (!/firecrawl/i.test(command)) {
        add('fail', 'timestamp-agreement', `${id || url}: raw file records no firecrawl command`);
      }
    }
  }
}

const attempted = new Set(readLedger(root).entries.map((e) => e.url));
for (const row of unknowns) {
  if (normKey(col(row, 'Status')) !== KNOWN_UNKNOWN) continue;
  const id = norm(col(row, 'ID')) || '(no id)';
  if (!attempted.size) {
    add('warn', 'unknown-attempted', `${id}: no fetch was ever attempted, so "unreachable" is unproven`);
  }
}
```

- [ ] **Step 4: Update the two older passing tests**

The migrated tests `CLOSED with real cited evidence -> PASS` and `KNOWN-UNKNOWN needs a real verification step -> FAIL then PASS` now fail because their evidence has no ledger entry. In both, after `addEvidenceRow(...)`, append a matching fetch:

```js
appendFetch(dir, { op: 'scrape', url: '<the same url passed to addEvidenceRow>', type: 'P', raw: rawRel, cmd: 'firecrawl scrape <same url> --json' });
```

Capture the return of `addEvidenceRow` into `rawRel` to do this.

- [ ] **Step 5: Add the `--repair` flag and its test**

Append to `test/preflight.test.mjs`:

```js
test('--repair drops a truncated ledger tail and does not invent a link', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'CLOSED', evidence: 'E-01' }] });
    const rawRel = addEvidenceRow(dir, { url: 'https://docs.test/limits' });
    appendFetch(dir, { op: 'scrape', url: 'https://docs.test/limits', type: 'P', raw: rawRel, cmd: 'firecrawl scrape x' });
    fs.appendFileSync(path.join(dir, 'research/raw/.fetches.jsonl'), '{"seq":2,"at":"2026');
    assertEqual(runPreflight({ root: dir }).passed, false, 'a truncated tail must block first');
    repairLedgerTail(dir);
    assertEqual(runPreflight({ root: dir }).passed, true);
  } finally { cleanup(dir); }
});
```

In `bin/preflight.mjs`, add `--repair` to the CLI argument loop and, before running the checks, call:

```js
if (argv.includes('--repair')) {
  const { repaired, dropped } = repairLedgerTail(options.root ?? process.cwd());
  console.log(repaired ? `repaired: dropped a partial ledger line (${dropped}...)` : 'repair: nothing to do');
}
```

Import `repairLedgerTail` from `../lib/provenance.mjs` alongside the other provenance imports.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 31 `ok` lines, `all tests passed`.

- [ ] **Step 7: Commit**

```bash
git add fetchproof/bin/preflight.mjs fetchproof/test/preflight.test.mjs
git commit -m "feat: fail preflight when evidence was not actually fetched"
```

---

### Task 5: The verdict

**Files:**
- Create: `fetchproof/lib/config.mjs`
- Create: `fetchproof/bin/gate.mjs`
- Test: `fetchproof/test/gate.test.mjs`

**Interfaces:**
- Consumes: `runPreflight` from `bin/preflight.mjs`; `appendOverride` from `lib/provenance.mjs`.
- Produces: `loadConfig(file?) -> { failOpen, claudeGate }`; `isGated(root) -> boolean`; `evaluate(root, { stagedPaths, config }) -> { gated, override, passed, blockers, warnings, fix, exitCode }`.

- [ ] **Step 1: Write the failing tests**

```js
// test/gate.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { test, assert, assertEqual, makeProject, writeDiscovery, addEvidenceRow, cleanup } from './harness.mjs';
import { evaluate, isGated } from '../bin/gate.mjs';
import { appendFetch } from '../lib/provenance.mjs';

const passing = (dir) => {
  writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'CLOSED', evidence: 'E-01' }] });
  const rawRel = addEvidenceRow(dir, { url: 'https://docs.test/limits' });
  appendFetch(dir, { op: 'scrape', url: 'https://docs.test/limits', type: 'P', raw: rawRel, cmd: 'firecrawl scrape x' });
};

test('a project with no research artifacts is not gated', () => {
  const dir = makeProject();
  try {
    fs.rmSync(path.join(dir, 'research'), { recursive: true, force: true });
    assertEqual(isGated(dir), false);
    const verdict = evaluate(dir, { stagedPaths: ['src/app.js'] });
    assertEqual(verdict.gated, false);
    assertEqual(verdict.exitCode, 0);
  } finally { cleanup(dir); }
});

test('any one marker gates the project', () => {
  const dir = makeProject();
  try {
    fs.rmSync(path.join(dir, 'research'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'research'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'research/plan.json'), '{"queries":[]}');
    assertEqual(isGated(dir), true);
  } finally { cleanup(dir); }
});

test('a passing gated project allows a code change', () => {
  const dir = makeProject();
  try {
    passing(dir);
    const verdict = evaluate(dir, { stagedPaths: ['src/app.js'] });
    assertEqual(verdict.passed, true, JSON.stringify(verdict.blockers));
    assertEqual(verdict.exitCode, 0);
  } finally { cleanup(dir); }
});

test('a failing gated project blocks a code change and prints the fix', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'OPEN', evidence: '' }] });
    const verdict = evaluate(dir, { stagedPaths: ['src/app.js'] });
    assertEqual(verdict.passed, false);
    assertEqual(verdict.exitCode, 1);
    assert(verdict.fix.includes('preflight.mjs') || verdict.fix.includes('research.mjs'), verdict.fix);
  } finally { cleanup(dir); }
});

test('a research-only change is allowed while failing', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'OPEN', evidence: '' }] });
    const verdict = evaluate(dir, { stagedPaths: ['research/raw/2026-01-01-x.md', 'research/EVIDENCE.md'] });
    assertEqual(verdict.exitCode, 0);
    assertEqual(verdict.blockers.length, 0);
  } finally { cleanup(dir); }
});

test('a mixed change still blocks', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'OPEN', evidence: '' }] });
    const verdict = evaluate(dir, { stagedPaths: ['research/EVIDENCE.md', 'src/app.js'] });
    assertEqual(verdict.exitCode, 1);
  } finally { cleanup(dir); }
});

test('deleting DISCOVERY.md inside a gated project fails harder, not open', () => {
  const dir = makeProject();
  try {
    fs.rmSync(path.join(dir, 'research/DISCOVERY.md'), { force: true });
    const verdict = evaluate(dir, { stagedPaths: ['src/app.js'] });
    assertEqual(verdict.gated, true);
    assertEqual(verdict.exitCode, 1);
  } finally { cleanup(dir); }
});

test('GATE_OFF allows and is recorded', () => {
  const dir = makeProject();
  try {
    fs.writeFileSync(path.join(dir, 'research/GATE_OFF'), 'temporarily shipping a hotfix\n');
    const verdict = evaluate(dir, { stagedPaths: ['src/app.js'] });
    assertEqual(verdict.override, true);
    assertEqual(verdict.exitCode, 0);
    assert(fs.readFileSync(path.join(dir, 'research/overrides.log'), 'utf8').includes('GATE_OFF'));
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node fetchproof/bin/selftest.mjs`
Expected: FAIL — `Cannot find module '.../bin/gate.mjs'`.

- [ ] **Step 3: Implement config and the verdict**

```js
// lib/config.mjs
import os from 'node:os';
import path from 'node:path';
import { readText, writeText } from './core.mjs';

export const CONFIG_PATH = process.env.FETCHPROOF_CONFIG
  ?? path.join(os.homedir(), '.agents', 'fetchproof.config.json');
export const DEFAULT_CONFIG = { failOpen: true, claudeGate: 'ask' };

export function loadConfig(file = CONFIG_PATH) {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readText(file, '{}')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(patch, file = CONFIG_PATH) {
  const next = { ...loadConfig(file), ...patch };
  writeText(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
```

```js
// bin/gate.mjs
import path from 'node:path';
import { exists } from '../lib/core.mjs';
import { appendOverride } from '../lib/provenance.mjs';
import { runPreflight } from './preflight.mjs';
import { loadConfig } from '../lib/config.mjs';

const MARKERS = ['research/DISCOVERY.md', 'research/plan.json', 'research/EVIDENCE.md', 'research/raw'];
const RESEARCH_PREFIX = 'research/';

export function isGated(root) {
  return MARKERS.some((marker) => exists(path.resolve(root, marker)));
}

export function evaluate(root, { stagedPaths = null, config = loadConfig() } = {}) {
  const overridePath = path.resolve(root, 'research/GATE_OFF');
  if (!isGated(root)) {
    return { gated: false, override: false, passed: true, blockers: [], warnings: [], fix: '', exitCode: 0 };
  }
  if (exists(overridePath)) {
    appendOverride(root, { gate: stagedPaths ? 'commit' : 'edit', reason: 'GATE_OFF' });
    return { gated: true, override: true, passed: true, blockers: [], warnings: [], fix: '', exitCode: 0 };
  }

  if (stagedPaths && stagedPaths.every((p) => p.split(path.sep).join('/').startsWith(RESEARCH_PREFIX))) {
    return { gated: true, override: false, passed: true, blockers: [], warnings: [], fix: '', exitCode: 0, scopeSkipsVerdict: true };
  }

  const result = runPreflight({ root, strict: false });
  const blockers = result.failures.map((f) => ({ check: f.check, detail: f.detail }));
  const fix = [
    `Blocked: this project has a Discovery Contract that is not satisfied (${blockers.length} blocker${blockers.length === 1 ? '' : 's'}).`,
    ...blockers.map((b) => `  - ${b.check}: ${b.detail}`),
    '',
    'Fix by collecting and closing the evidence, then re-running the gate:',
    '  node "<kit>/bin/research.mjs" --plan research/plan.json',
    '  node "<kit>/bin/preflight.mjs"',
    '',
    'To override deliberately (recorded in research/overrides.log): research/GATE_OFF',
  ].join('\n');

  return { gated: true, override: false, passed: blockers.length === 0, blockers, warnings: result.warnings, fix, exitCode: blockers.length ? 1 : 0 };
}

function main() {
  const argv = process.argv.slice(2);
  const gateIndex = argv.indexOf('--gate');
  const gate = gateIndex >= 0 ? argv[gateIndex + 1] : 'edit';
  const projIndex = argv.indexOf('--project');
  const root = projIndex >= 0 ? path.resolve(argv[projIndex + 1]) : process.cwd();
  const staged = argv.reduce((acc, arg, i) => (arg === '--staged' ? [...acc, argv[i + 1]] : acc), []);
  const json = argv.includes('--json');

  let verdict;
  try {
    verdict = evaluate(root, { stagedPaths: gate === 'commit' ? staged : null });
  } catch (error) {
    console.error(`gate error: ${error.message}`);
    process.exit(2);
  }

  if (json) console.log(JSON.stringify(verdict, null, 2));
  else if (verdict.exitCode !== 0) console.log(verdict.fix);
  process.exit(verdict.exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
```

Add `import { fileURLToPath } from 'node:url';` to the imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 38 `ok` lines, `all tests passed`.

- [ ] **Step 5: Verify the CLI contract by hand**

Run: `node fetchproof/bin/gate.mjs --gate commit --project . --staged src/x.js; echo "exit=$?"`
Expected: prints the blocker list plus the fix commands, `exit=1` (this project's example `U-1` row is still `OPEN`).

- [ ] **Step 6: Commit**

```bash
git add fetchproof/lib/config.mjs fetchproof/bin/gate.mjs fetchproof/test/gate.test.mjs
git commit -m "feat: add the gate verdict, gating predicate, and diff-scope rule"
```

---

### Task 6: The git pre-commit gate, proven to block

**Files:**
- Create: `fetchproof/githooks/pre-commit`
- Test: `fetchproof/test/hooks.test.mjs`

**Interfaces:**
- Consumes: `bin/gate.mjs` CLI via `git diff --cached --name-only`.
- Produces: an executable `githooks/pre-commit`; `githooks/README.md` documenting the two override paths.

- [ ] **Step 1: Write the failing test**

```js
// test/hooks.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, assert, assertEqual, KIT, cleanup, makeProject, writeDiscovery, addEvidenceRow } from './harness.mjs';
import { appendFetch } from '../lib/provenance.mjs';
import { decide } from '../hooks/claude-pretooluse.mjs';

function makeRepo() {
  const dir = makeProject();
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'src.js'), 'console.log(1)\n');
  execFileSync('git', ['add', 'src.js'], { cwd: dir });
  return dir;
}

function runHook(dir) {
  const hook = path.join(KIT, 'githooks', 'pre-commit');
  return execFileSync('bash', [hook], { cwd: dir, encoding: 'utf8' });
}

test('the hook blocks a code change while the contract is open', () => {
  const dir = makeRepo();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'OPEN', evidence: '' }] });
    execFileSync('git', ['add', 'research/DISCOVERY.md'], { cwd: dir });
    let failed = false;
    let output = '';
    try {
      runHook(dir);
    } catch (error) {
      failed = true;
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    }
    assertEqual(failed, true, 'the hook must exit non-zero');
    assert(output.includes('Blocked'), output);
    assert(output.includes('preflight.mjs'), output);
  } finally { cleanup(dir); }
});

test('the hook allows a research-only commit while the contract is open', () => {
  const dir = makeRepo();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'OPEN', evidence: '' }] });
    execFileSync('git', ['rm', '--cached', 'src.js'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['add', 'research/DISCOVERY.md'], { cwd: dir });
    const output = runHook(dir);
    assert(!output.includes('Blocked'), output);
  } finally { cleanup(dir); }
});

test('the hook allows anything in an ungated repo', () => {
  const dir = makeRepo();
  try {
    const output = runHook(dir);
    assert(!output.includes('Blocked'), output);
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node fetchproof/bin/selftest.mjs`
Expected: FAIL — the hook file does not exist (`ENOENT`).

- [ ] **Step 3: Implement the hook**

```bash
#!/bin/sh
# Commit gate. Blocks a commit that changes anything outside research/ while the
# project's Discovery Contract is unsatisfied. Fails OPEN when the kit is missing,
# so a broken gate can never brick commits on this machine.
set -u

KIT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "gate: node not found on PATH - allowing this commit (fail-open)." >&2
  exit 0
fi

STAGED=$(git diff --cached --name-only --diff-filter=ACMR)
if [ -z "$STAGED" ]; then
  exit 0
fi

# shellcheck disable=SC2086
node "$KIT_DIR/bin/gate.mjs" --gate commit --project "$PROJECT" --staged $STAGED
STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  exit 0
fi

if [ "$STATUS" -eq 1 ]; then
  echo "" >&2
  echo "gate: commit blocked. Use 'git commit --no-verify' to bypass for a genuine emergency." >&2
  exit 1
fi

echo "gate: internal error (exit $STATUS) - allowing this commit (fail-open)." >&2
exit 0
```

- [ ] **Step 4: Make it executable and document the overrides**

Run: `chmod +x fetchproof/githooks/pre-commit`

```markdown
<!-- fetchproof/githooks/README.md -->
# Commit gate

`pre-commit` blocks a commit when a gated project's Discovery Contract is unsatisfied and the
commit changes anything outside `research/`.

- Install: `node bin/install-hooks.mjs` (sets `core.hooksPath` for every repo on this machine).
- Override for one commit: `git commit --no-verify`.
- Override for a while: create `research/GATE_OFF`. Both gates print that it is active and
  append a line to `research/overrides.log`.
- Fail-open: if node or the kit is missing, the hook warns and allows the commit.
- Known limit: staged paths containing spaces are split by the shell. Use `--no-verify` or
  `research/GATE_OFF` for those; file names are slugs under `research/raw/`, so this is rare.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 41 `ok` lines, `all tests passed`. The blocking test asserts a real non-zero exit from a real repo.

- [ ] **Step 6: Commit**

```bash
git add fetchproof/githooks
git commit -m "feat: add a commit gate that provably blocks in a real repo"
```

---

### Task 7: Install and uninstall the git gate

**Files:**
- Create: `fetchproof/bin/install-hooks.mjs`
- Test: `fetchproof/test/install-hooks.test.mjs`

**Interfaces:**
- Consumes: `loadConfig`, `saveConfig` from `lib/config.mjs`.
- Produces: `installGitHooks({ kitDir, gitConfigPath, dryRun }) -> { before, after }`; `uninstallGitHooks({ gitConfigPath }) -> { restored }`; CLI flags `--dry-run`, `--git-only`, `--claude-only`, `--uninstall`, `--fail-closed`.

- [ ] **Step 1: Write the failing tests**

```js
// test/install-hooks.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, assert, assertEqual, cleanup } from './harness.mjs';
import { installGitHooks, uninstallGitHooks } from '../bin/install-hooks.mjs';

const gitConfig = (file, key) => execFileSync('git', ['config', '--file', file, '--get', key], { encoding: 'utf8' }).trim();

test('install sets core.hooksPath and reports the previous value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-git-'));
  try {
    const file = path.join(dir, 'gitconfig');
    fs.writeFileSync(file, '');
    const result = installGitHooks({ kitDir: '/kit', gitConfigPath: file, dryRun: false });
    assertEqual(result.before, '', 'no previous hooksPath');
    assertEqual(result.after, '/kit/githooks');
    assertEqual(gitConfig(file, 'core.hooksPath'), '/kit/githooks');
  } finally { cleanup(dir); }
});

test('install is idempotent and records the original value once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-git-'));
  try {
    const file = path.join(dir, 'gitconfig');
    fs.writeFileSync(file, '');
    installGitHooks({ kitDir: '/kit', gitConfigPath: file, dryRun: false });
    const first = gitConfig(file, 'core.hooksPath');
    installGitHooks({ kitDir: '/kit', gitConfigPath: file, dryRun: false });
    assertEqual(gitConfig(file, 'core.hooksPath'), first);
  } finally { cleanup(dir); }
});

test('dry run writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-git-'));
  try {
    const file = path.join(dir, 'gitconfig');
    fs.writeFileSync(file, '');
    const result = installGitHooks({ kitDir: '/kit', gitConfigPath: file, dryRun: true });
    assertEqual(result.before, '');
    assertEqual(result.dryRun, true);
    let present = true;
    try { gitConfig(file, 'core.hooksPath'); } catch { present = false; }
    assertEqual(present, false, 'dry run must not set hooksPath');
  } finally { cleanup(dir); }
});

test('uninstall restores a pre-existing hooksPath', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-git-'));
  try {
    const file = path.join(dir, 'gitconfig');
    execFileSync('git', ['config', '--file', file, 'core.hooksPath', '/pre/existing']);
    installGitHooks({ kitDir: '/kit', gitConfigPath: file, dryRun: false });
    uninstallGitHooks({ gitConfigPath: file, kitDir: '/kit' });
    assertEqual(gitConfig(file, 'core.hooksPath'), '/pre/existing');
  } finally { cleanup(dir); }
});

test('uninstall removes the key when there was no previous value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-git-'));
  try {
    const file = path.join(dir, 'gitconfig');
    fs.writeFileSync(file, '');
    installGitHooks({ kitDir: '/kit', gitConfigPath: file, dryRun: false });
    uninstallGitHooks({ gitConfigPath: file, kitDir: '/kit' });
    let present = true;
    try { gitConfig(file, 'core.hooksPath'); } catch { present = false; }
    assertEqual(present, false);
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node fetchproof/bin/selftest.mjs`
Expected: FAIL — `Cannot find module '.../bin/install-hooks.mjs'`.

- [ ] **Step 3: Implement install/uninstall (git side)**

```js
// bin/install-hooks.mjs
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from '../lib/config.mjs';

const KIT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const HOOKS_KEY = 'core.hooksPath';

function git(args, { gitConfigPath } = {}) {
  const full = gitConfigPath
    ? ['config', '--file', gitConfigPath, ...args.slice(1)]
    : args;
  return execFileSync('git', full, { encoding: 'utf8' });
}

export function readHooksPath({ gitConfigPath } = {}) {
  try {
    return git(['config', '--get', HOOKS_KEY], { gitConfigPath }).trim();
  } catch {
    return '';
  }
}

export function installGitHooks({ kitDir = KIT, gitConfigPath, dryRun = false } = {}) {
  const target = path.join(kitDir, 'githooks').split(path.sep).join('/');
  const before = readHooksPath({ gitConfigPath });
  if (dryRun) return { before, after: target, dryRun: true };
  if (before !== target) {
    git(['config', HOOKS_KEY, target], { gitConfigPath });
  }
  return { before, after: target, dryRun: false };
}

export function uninstallGitHooks({ gitConfigPath, kitDir = KIT } = {}) {
  const target = path.join(kitDir, 'githooks').split(path.sep).join('/');
  const before = readHooksPath({ gitConfigPath });
  if (before !== target) return { restored: before, changed: false };
  // '--unset' fails on a missing key, which is the desired end state anyway.
  git(['config', '--unset', HOOKS_KEY], { gitConfigPath });
  return { restored: '', changed: true };
}
```

Add a `main()` guarded by `process.argv[1]` so importing the module in tests does not run the CLI. Implement these flags: `--dry-run` prints the before/after and the Claude settings diff without writing; `--git-only` skips the Claude layer; `--uninstall` calls `uninstallGitHooks` and (later) removes the Claude hook; `--fail-closed` calls `saveConfig({ failOpen: false })`. Print the exact `git config` command it ran.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 46 `ok` lines, `all tests passed`.

- [ ] **Step 5: Commit**

```bash
git add fetchproof/bin/install-hooks.mjs fetchproof/test/install-hooks.test.mjs
git commit -m "feat: install and uninstall the git gate with dry-run and restore"
```

---

### Task 8: The Claude PreToolUse gate

**Files:**
- Create: `fetchproof/hooks/claude-pretooluse.mjs`
- Test: `fetchproof/test/hooks.test.mjs` (append)

**Interfaces:**
- Consumes: `evaluate` from `bin/gate.mjs`; `loadConfig` from `lib/config.mjs`.
- Produces: `decide(payload, config) -> { permissionDecision }` where `payload` is the Claude hook JSON on stdin (`{ tool_name, tool_input: { file_path }, cwd }`).

- [ ] **Step 1: Write the failing tests**

```js
test('claude hook: ungated project allows', () => {
  const dir = makeProject();
  try {
    fs.rmSync(path.join(dir, 'research'), { recursive: true, force: true });
    const out = decide({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/app.js') }, cwd: dir });
    assertEqual(out.permissionDecision, 'allow');
  } finally { cleanup(dir); }
});

test('claude hook: gated and failing asks the human', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'OPEN', evidence: '' }] });
    const out = decide({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src/app.js') }, cwd: dir });
    assertEqual(out.permissionDecision, 'ask');
    assert(out.reason.includes('U-1') || out.reason.includes('Blocked'), out.reason);
  } finally { cleanup(dir); }
});

test('claude hook: gated and passing allows', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'CLOSED', evidence: 'E-01' }] });
    const rawRel = addEvidenceRow(dir, { url: 'https://docs.test/limits' });
    appendFetch(dir, { op: 'scrape', url: 'https://docs.test/limits', type: 'P', raw: rawRel, cmd: 'firecrawl scrape x' });
    const out = decide({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/app.js') }, cwd: dir });
    assertEqual(out.permissionDecision, 'allow');
  } finally { cleanup(dir); }
});

test('claude hook: a malformed payload allows and never throws', () => {
  const out = decide({ tool_name: 'Edit' });
  assertEqual(out.permissionDecision, 'allow');
});

test('claude hook: hard-block mode denies instead of asking', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'OPEN', evidence: '' }] });
    const out = decide({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/app.js') }, cwd: dir }, { claudeGate: 'hard-block' });
    assertEqual(out.permissionDecision, 'deny');
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node fetchproof/bin/selftest.mjs`
Expected: FAIL — `decide is not defined` (the import does not resolve yet).

- [ ] **Step 3: Implement the hook**

```js
// hooks/claude-pretooluse.mjs
import path from 'node:path';
import { evaluate } from '../bin/gate.mjs';
import { loadConfig } from '../lib/config.mjs';

const ALLOW = { permissionDecision: 'allow' };

/** Pure decision function so tests can exercise it without a live session. */
export function decide(payload, config = loadConfig()) {
  try {
    // No cwd means we cannot locate a project, so we allow rather than guess.
    const root = payload?.cwd;
    if (!root || !payload?.tool_name || !payload?.tool_input?.file_path) return ALLOW;
    const verdict = evaluate(root, { config });
    if (!verdict.gated || verdict.exitCode === 0) return ALLOW;
    const reason = [verdict.fix, '', 'Approving this edit means building on unproven assumptions.'].join('\n');
    return { permissionDecision: config.claudeGate === 'hard-block' ? 'deny' : 'ask', reason };
  } catch {
    // An upstream payload change must never wedge editing.
    return ALLOW;
  }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* malformed payload: decide() allows */ }
  const decision = decide(payload);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } }));
  process.exit(0);
}

// Guard matches the pattern already used by bin/preflight.mjs, so importing
// decide() in tests never starts the stdin reader.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
```

Add `import { fileURLToPath } from 'node:url';` to the imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 51 `ok` lines, `all tests passed`.

- [ ] **Step 5: Verify the hook end to end without a session**

Run: `echo '{"tool_name":"Edit","tool_input":{"file_path":"src/app.js"},"cwd":"."}' | node fetchproof/hooks/claude-pretooluse.mjs`
Expected: JSON containing `"permissionDecision":"ask"` and a reason naming this project's open `U-1` row. In an ungated directory the same command prints `"permissionDecision":"allow"`.

- [ ] **Step 6: Commit**

```bash
git add fetchproof/hooks fetchproof/test/hooks.test.mjs
git commit -m "feat: add the Claude PreToolUse gate with an offline-testable decision function"
```

---

### Task 9: Settings validation, repair, and Claude hook install

**Files:**
- Modify: `fetchproof/bin/install-hooks.mjs`
- Test: `fetchproof/test/install-hooks.test.mjs` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `validateSettings(text) -> { ok, error, line }`; `repairSettings(text) -> { text, repaired }`; `installClaudeHook({ settingsPath, kitDir, dryRun }) -> { before, after, backupPath }`; `removeClaudeHook({ settingsPath, kitDir }) -> { removed }`.

- [ ] **Step 1: Write the failing tests**

```js
test('validateSettings reports the line of the For Windows corruption', () => {
  const broken = '{\n  "env": {},\n  "model": "opus",\nFor Windows;-\n  "statusLine": {}\n}\n';
  const result = validateSettings(broken);
  assertEqual(result.ok, false);
  assertEqual(result.line, 4);
});

test('repairSettings drops the stray line and keeps everything else', () => {
  const broken = '{\n  "env": {\n    "A": "1"\n  },\n  "model": "opus",\nFor Windows;-\n  "statusLine": {\n    "type": "command"\n  }\n}\n';
  const { text, repaired } = repairSettings(broken);
  assertEqual(repaired, true);
  const parsed = JSON.parse(text);
  assertEqual(parsed.model, 'opus');
  assertEqual(parsed.env.A, '1');
  assertEqual(parsed.statusLine.type, 'command');
});

test('installClaudeHook backs up, repairs, and registers the hook idempotently', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-claude-'));
  try {
    const settings = path.join(dir, 'settings.json');
    fs.writeFileSync(settings, '{\n  "model": "opus",\nFor Windows;-\n  "statusLine": {}\n}\n');
    const first = installClaudeHook({ settingsPath: settings, kitDir: '/kit', dryRun: false });
    assert(fs.existsSync(first.backupPath), 'a backup must exist');
    let parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assertEqual(parsed.hooks.PreToolUse[0].matcher, 'Edit|Write|MultiEdit|NotebookEdit');
    assert(parsed.hooks.PreToolUse[0].hooks[0].command.includes('claude-pretooluse.mjs'));
    installClaudeHook({ settingsPath: settings, kitDir: '/kit', dryRun: false });
    parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assertEqual(parsed.hooks.PreToolUse.length, 1, 'a second install must not duplicate the hook');
  } finally { cleanup(dir); }
});

test('removeClaudeHook leaves unrelated hooks alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-claude-'));
  try {
    const settings = path.join(dir, 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool' }] }] } }, null, 2));
    installClaudeHook({ settingsPath: settings, kitDir: '/kit', dryRun: false });
    removeClaudeHook({ settingsPath: settings, kitDir: '/kit' });
    const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assertEqual(parsed.hooks.PreToolUse.length, 1);
    assertEqual(parsed.hooks.PreToolUse[0].matcher, 'Bash');
  } finally { cleanup(dir); }
});

test('installClaudeHook refuses to guess at unfamiliar corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-claude-'));
  try {
    const settings = path.join(dir, 'settings.json');
    fs.writeFileSync(settings, '{"hooks": {"PreToolUse": [ BROKEN ]}}\n');
    let threw = false;
    try { installClaudeHook({ settingsPath: settings, kitDir: '/kit', dryRun: false }); } catch { threw = true; }
    assertEqual(threw, true, 'must stop and ask rather than guess');
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node fetchproof/bin/selftest.mjs`
Expected: FAIL — the four new tests fail on missing exports.

- [ ] **Step 3: Implement validation, repair, and install**

```js
export function validateSettings(text) {
  try {
    JSON.parse(text);
    return { ok: true };
  } catch (error) {
    const match = /at position (\d+)/.exec(error.message);
    const position = match ? Number(match[1]) : 0;
    const line = text.slice(0, position).split('\n').length;
    return { ok: false, error: error.message, position, line };
  }
}

export function repairSettings(text) {
  const { ok, line } = validateSettings(text);
  if (ok) return { text, repaired: false };
  const lines = text.split('\n');
  const suspect = (lines[line - 1] ?? '').trim();
  const fixable = suspect !== '' && !suspect.startsWith('"') && !suspect.startsWith('}') && !suspect.startsWith(']');
  if (!fixable) throw new Error(`settings JSON is invalid at line ${line} and the repair is not a known one-liner: "${suspect}"`);
  lines.splice(line - 1, 1);
  const next = lines.join('\n');
  const check = validateSettings(next);
  if (!check.ok) throw new Error(`removing line ${line} did not fix the settings JSON: ${check.error}`);
  return { text: next, repaired: true };
}

export function installClaudeHook({ settingsPath, kitDir = KIT, dryRun = false }) {
  const original = readText(settingsPath, '{\n}\n');
  const backupPath = `${settingsPath}.bak-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const { text, repaired } = repairSettings(original);
  const parsed = JSON.parse(text);
  const command = `node "${path.join(kitDir, 'hooks', 'claude-pretooluse.mjs').split(path.sep).join('/')}"`;
  parsed.hooks ??= {};
  parsed.hooks.PreToolUse ??= [];
  parsed.hooks.PreToolUse = parsed.hooks.PreToolUse.filter((g) => !JSON.stringify(g).includes('claude-pretooluse.mjs'));
  parsed.hooks.PreToolUse.push({ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command }] });
  if (dryRun) return { before: original, after: `${JSON.stringify(parsed, null, 2)}\n`, backupPath, dryRun: true, repaired };
  if (!exists(backupPath) && original.trim() !== '') writeText(backupPath, original);
  writeText(settingsPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return { before: original, after: `${JSON.stringify(parsed, null, 2)}\n`, backupPath, dryRun: false, repaired };
}

export function removeClaudeHook({ settingsPath, kitDir = KIT }) {
  const original = readText(settingsPath, null);
  if (original === null) return { removed: false };
  const parsed = JSON.parse(original);
  const groups = parsed.hooks?.PreToolUse ?? [];
  const kept = groups.filter((g) => !JSON.stringify(g).includes('claude-pretooluse.mjs'));
  if (kept.length === groups.length) return { removed: false };
  parsed.hooks.PreToolUse = kept;
  writeText(settingsPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return { removed: true, removedCount: groups.length - kept.length };
}
```

Import `readText`, `writeText`, `exists` from `../lib/core.mjs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 56 `ok` lines, `all tests passed`.

- [ ] **Step 5: Wire the CLI, then STOP and ask**

The `--claude-only` and full-install paths must call `installClaudeHook({ settingsPath: path.join(process.env.USERPROFILE ?? process.env.HOME, '.claude', 'settings.json') })`. Because that file is outside this project, the CLI must print the planned diff and require `--confirm` before writing, and the operator must approve it in chat first (spec O-1). Do not run it against the real path in this task.

- [ ] **Step 6: Commit**

```bash
git add fetchproof/bin/install-hooks.mjs fetchproof/test/install-hooks.test.mjs
git commit -m "feat: validate, repair, and install the Claude hook with backups"
```

---

### Task 10: Doctor reporting, docs, and the acceptance round trip

**Files:**
- Modify: `fetchproof/bin/doctor.mjs`
- Modify: `fetchproof/template/AGENTS.md`, `fetchproof/skill/SKILL.md`, `fetchproof/template/.gitignore`
- Test: `fetchproof/test/install-hooks.test.mjs` (append a doctor test)

**Interfaces:**
- Consumes: `verifyLedger`, `readLedger` from `lib/provenance.mjs`; `isGated` from `bin/gate.mjs`; `loadConfig`.
- Produces: `gateHealth(root, { gitConfigPath, settingsPath }) -> { hooksPath, hookInstalled, claudeHookInstalled, chainOk, overrides, gated, failOpen }`; doctor rows for each.

- [ ] **Step 1: Write the failing test**

```js
// add to the imports of test/install-hooks.test.mjs:
// import { gateHealth } from '../bin/doctor.mjs';

test('gateHealth reports each gate and the override count', () => {
  const dir = makeProject();
  try {
    writeDiscovery(dir, { rows: [{ id: 'U-1', unknown: 'Rate limits?', status: 'OPEN', evidence: '' }] });
    fs.writeFileSync(path.join(dir, 'research/GATE_OFF'), 'hotfix\n');
    const health = gateHealth(dir, { gitConfigPath: path.join(dir, 'nonexistent-gitconfig'), settingsPath: path.join(dir, 'nonexistent-settings.json') });
    assertEqual(health.gated, true);
    assertEqual(health.chainOk, true);
    assertEqual(health.overrides, 1);
    assertEqual(health.claudeHookInstalled, false);
  } finally { cleanup(dir); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node fetchproof/bin/selftest.mjs`
Expected: FAIL — `gateHealth is not exported`.

- [ ] **Step 3: Implement gate health and surface it in doctor**

```js
// bin/doctor.mjs
import { fileURLToPath } from 'node:url';
import { isGated } from './gate.mjs';
import { verifyLedger } from '../lib/provenance.mjs';
import { loadConfig } from '../lib/config.mjs';
import { readHooksPath } from './install-hooks.mjs';

const KIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function gateHealth(root, { gitConfigPath, settingsPath } = {}) {
  const config = loadConfig();
  const hooksPath = readHooksPath({ gitConfigPath }) || '(unset)';
  const expected = path.join(KIT_DIR, 'githooks').split(path.sep).join('/');
  const ledger = verifyLedger(root);
  const overrides = (readText(abs(root, 'research/overrides.log'), '').split('\n').filter((l) => l.trim())).length;
  const settingsText = readText(settingsPath, '');
  return {
    gated: isGated(root),
    hooksPath,
    hookInstalled: hooksPath === expected,
    claudeHookInstalled: settingsText.includes('claude-pretooluse.mjs'),
    chainOk: ledger.ok && ledger.entries.length > 0,
    chainEntries: ledger.entries.length,
    overrides,
    failOpen: config.failOpen !== false,
  };
}
```

Add doctor rows: `gate-git` (pass when installed), `gate-claude`, `ledger-chain`, `overrides` (warn when above 0, listing the reasons).

Also wrap doctor's existing `main()` call in the same import guard used elsewhere, otherwise importing `gateHealth` in a test would run the CLI and call `process.exit`:

```js
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
```

`readHooksPath` is already exported from `bin/install-hooks.mjs` (Task 7).

- [ ] **Step 4: Update the docs and template**

In `template/AGENTS.md` add under Rule 1: a note that the gate is now enforced at commit time and edit time, that `git commit --no-verify` and `research/GATE_OFF` are the only overrides, and that both are recorded in `research/overrides.log`. In `skill/SKILL.md`, add the same paragraph and the sentence "Claiming a fact without a cached, ledger-backed page is not evidence." In `template/.gitignore`, add `!.fetches.jsonl` and `!.overrides.log` under the firecrawl section.

- [ ] **Step 5: Run the full suite**

Run: `node fetchproof/bin/selftest.mjs`
Expected: 57 `ok` lines, `all tests passed`.

- [ ] **Step 6: Run the acceptance round trip**

```bash
node fetchproof/bin/install-hooks.mjs --git-only --dry-run
node fetchproof/bin/selftest.mjs
node fetchproof/bin/doctor.mjs
```

Expected: the dry run prints the `core.hooksPath` before/after and writes nothing; the suite passes; `doctor` reports the new gate rows, with `gate-git` failing until the real install runs. Verify acceptance criteria 1, 2, 4, 5, 6, and 8 from the spec are covered by named tests.

- [ ] **Step 7: Commit**

```bash
git add fetchproof/bin/doctor.mjs fetchproof/template fetchproof/skill fetchproof/test
git commit -m "feat: report gate health and document the enforced protocol"
```

---

## Execution notes

- **Real install is gated on approval.** Running `install-hooks.mjs` without `--dry-run` changes machine config and (for the Claude layer) a file outside this project. Do that only after explicit approval, per spec O-1.
- **Manual step that cannot be automated:** in a live Claude session inside a gated failing project, attempt an edit and confirm the prompt appears. Required before switching `claudeGate` to `hard-block`.
- **Deliberately not in this plan:** the `%`-doubling quoting bug, absolute-path baking, and skill-discovery verification. They are spec §3 out-of-scope items; the quoting bug is the most likely first real-world failure and should be scheduled next.
