// A report bigger than a pipe must arrive whole, with the command's own exit status.
//
// Found 2026-09-30 (break-test, PR #176). On POSIX, Node writes to a pipe asynchronously:
// the kernel takes what fits, the rest waits in the process, and `process.exit()` discards
// it. A reader slower than the writer - a pager, a CI log shipper, an agent's tool runner,
// `| jq` - got the first 65,536 bytes of a larger report, no error, and exit 0: preflight's
// verdict block (printed last) was the part that went, `--json` stopped mid-string, and
// `audit --show` pasted a cut snapshot. Every other test reads a child with spawnSync, which
// reads as fast as the child writes, so none could see it; these put a process on the far end
// of the pipe that does not read for a while. Windows pipes block the writer instead, so there
// nothing is ever cut - the reports must still arrive whole, and that is asserted everywhere.

import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test, describe, assert, tempDir, fs, path, KIT_ROOT, makeProject } from './harness.mjs';
import { writeRaw } from '../lib/collect.mjs';
import { appendFetch } from '../lib/provenance.mjs';
import { PATHS, resolve, writeText, today, sha256File } from '../lib/core.mjs';
import { writeAudit } from '../lib/audit.mjs';

describe('stdout-flush');

const STALL_MS = 700;

/** 400 captures: every report below is several pipes long. Built once, read-only. */
let built;
function bigCorpus() {
  if (built) return built;
  const date = today();
  const valid = tempDir('fp-flush-valid-');
  makeProject(valid, { content: true });
  const unknowns = [];
  const evidence = [];
  for (let i = 1; i <= 400; i += 1) {
    const finding = `Service ${i} allows ${i * 7} requests per minute. ${'Burst, failover and support terms are stated in full. '.repeat(4)}`;
    const entry = writeRaw(valid, {
      url: `https://example${i % 40}.invalid/docs/page-${i}`, title: `Page ${i}`,
      markdown: `# Page ${i}\n\n${finding} ${'Filler about limits and quotas. '.repeat(40)}\n`,
      cmd: `firecrawl scrape https://example${i % 40}.invalid/docs/page-${i}`, statusCode: 200, transport: 'firecrawl-cli', completeness: 'full',
    }, { date });
    appendFetch(valid, {
      op: 'scrape', url: entry.url, type: 'P', raw: entry.file, bodySha256: sha256File(path.join(valid, ...entry.file.split('/'))),
      transport: 'firecrawl-cli', completeness: 'full', cmd: entry.command, at: `${date}T00:00:00.000Z`,
    });
    const id = String(i).padStart(3, '0');
    unknowns.push(`| U-${i} | What does service ${i} allow? | Sets budget ${i} | CLOSED | E-${id}: ${finding} |`);
    evidence.push(`| E-${id} | ${date} | P | ${entry.url} | ${finding} | ${entry.file} |`);
  }
  writeText(resolve(valid, PATHS.discovery), `# Discovery Contract - Big fixture\n\n## Build intent\n\nA large fixture.\n\n## Unknowns\n\n| ID | Unknown | Why it blocks the build | Status | Evidence |\n|---|---|---|---|---|\n${unknowns.join('\n')}\n`);
  writeText(resolve(valid, PATHS.evidence), `# Evidence\n\n| ID | Retrieved | Type | URL | Finding | Raw |\n|---|---|---|---|---|---|\n${evidence.join('\n')}\n`);
  const audit = writeAudit(valid, { force: true });

  // The same corpus as it arrives when the captures did not travel: every row reports.
  const damaged = tempDir('fp-flush-damaged-');
  fs.cpSync(valid, damaged, { recursive: true });
  for (const name of fs.readdirSync(path.join(damaged, 'research', 'raw'))) {
    if (name.endsWith('.md')) fs.rmSync(path.join(damaged, 'research', 'raw', name));
  }
  built = { valid, damaged, slug: audit.written ? audit.slug : null };
  return built;
}

/** The reference: stdout to a FILE is written synchronously, so it is always whole. */
function toFile(cwd, argv) {
  const out = path.join(tempDir('fp-flush-ref-'), 'stdout.txt');
  const fd = fs.openSync(out, 'w');
  let status;
  try {
    status = spawnSync(process.execPath, argv, { cwd, stdio: ['ignore', fd, 'ignore'], timeout: 120_000, windowsHide: true }).status;
  } finally { fs.closeSync(fd); }
  return { status, stdout: fs.readFileSync(out) };
}

/**
 * What a slow reader gets: a pipe whose far end is a process that does not read for `STALL_MS`.
 * A separate process, because the parent's own `child.stdout` reads eagerly and hides the defect.
 */
function throughSlowPipe(argv, cwd) {
  return new Promise((done, reject) => {
    const reader = spawn(process.execPath, ['-e', `setTimeout(() => process.stdin.pipe(process.stdout), ${STALL_MS})`],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const out = [];
    reader.stdout.on('data', (chunk) => out.push(chunk));
    const writer = spawn(process.execPath, argv, { cwd, stdio: ['ignore', reader.stdin, 'ignore'], windowsHide: true });
    // Let go of our end, so the reader sees end-of-stream when the WRITER exits. destroy, not
    // end: on POSIX this is a socketpair, and end() would shut it for the writer too.
    reader.stdin.destroy();
    const killer = setTimeout(() => { writer.kill('SIGKILL'); reader.kill('SIGKILL'); }, 60_000);
    let status;
    let waiting = 2;
    const finish = () => { if (--waiting === 0) { clearTimeout(killer); done({ status, stdout: Buffer.concat(out) }); } };
    writer.on('error', reject);
    reader.on('error', reject);
    writer.on('close', (code) => { status = code; finish(); });
    reader.on('close', finish);
  });
}

/** How much this host's pipe lets through when a command writes far more and exits at once. */
async function pipeCapacity() {
  const { stdout } = await throughSlowPipe(['-e', "process.stdout.write('x'.repeat(4e6)); process.exit(0)"], tempDir('fp-flush-cap-'));
  return stdout.length;
}

test('a report larger than a pipe arrives whole at a slow reader, with the command\'s own exit status', async () => {
  const { valid, damaged, slug } = bigCorpus();
  assert.ok(slug, 'the fixture could not write its audit, so audit --show proves nothing');
  const bin = (script) => path.join(KIT_ROOT, 'bin', script);
  const cases = [
    [valid, ['evidence-context.mjs', '--all', '--json']],
    [valid, ['evidence-context.mjs', '--all']],
    [valid, ['audit.mjs', '--show', slug]],
    [damaged, ['preflight.mjs']],
    [damaged, ['preflight.mjs', '--json']],
    [damaged, ['doctor.mjs']],
    [damaged, ['doctor.mjs', '--json']],
    [damaged, ['handoff.mjs']],
    [damaged, ['handoff.mjs', '--json']],
  ].map(([cwd, [script, ...args]]) => ({ cwd, argv: [bin(script), ...args], label: `${script} ${args.join(' ')}` }));

  const capacity = await pipeCapacity();
  const slow = await Promise.all(cases.map((c) => throughSlowPipe(c.argv, c.cwd)));
  const problems = [];
  let overPipe = 0;
  cases.forEach((c, i) => {
    const reference = toFile(c.cwd, c.argv);
    if (reference.stdout.length > capacity) overPipe += 1;
    if (slow[i].status !== reference.status) problems.push(`${c.label}: exited ${slow[i].status} through a pipe, ${reference.status} to a file`);
    if (!slow[i].stdout.equals(reference.stdout)) problems.push(`${c.label}: a slow reader got ${slow[i].stdout.length} of ${reference.stdout.length} bytes`);
  });
  assert.deepEqual(problems, [], `output was cut by process.exit() while still queued for a pipe:\n  ${problems.join('\n  ')}`);
  // Where the host cuts at all (POSIX), the fixture must be big enough to have been cut.
  if (capacity < 4e6) assert.ok(overPipe >= 6, `only ${overPipe} reports exceed this pipe (${capacity} bytes): the fixture proves too little`);
});

/** A throwaway command that prints 300 KB and ends with exitAfterFlush(code). */
function fixture() {
  const file = path.join(tempDir('fp-flush-fixture-'), 'report.mjs');
  fs.writeFileSync(file, `import { exitAfterFlush } from ${JSON.stringify(pathToFileURL(path.join(KIT_ROOT, 'lib', 'core.mjs')).href)};
for (let i = 0; i < 3000; i += 1) process.stdout.write('line ' + String(i).padStart(5, '0') + ' ' + 'x'.repeat(90) + '\\n');
await exitAfterFlush(Number(process.argv[2]));
process.stdout.write('UNREACHABLE\\n');
`);
  return file;
}

// Found 2026-10-01 (break-test, PR #186): `selftest.mjs | head -n 1`. The reader left, the
// guard tolerated the EPIPE and dropped every later write - including the empty one
// `exitAfterFlush` makes to learn that stdout has drained, whose callback it waits for. The
// callback never came: a green run ended in "Detected unsettled top-level await", exit 13,
// after its result file had recorded exit 0. The EPIPE is raised on the real process.stdout
// here, as the kernel would, so the test runs the same on every platform.
test('a command whose reader left still ends through exitAfterFlush with the code it was given', () => {
  const file = path.join(tempDir('fp-flush-epipe-'), 'report.mjs');
  fs.writeFileSync(file, `import { tolerateClosedStdout, exitAfterFlush } from ${JSON.stringify(pathToFileURL(path.join(KIT_ROOT, 'lib', 'core.mjs')).href)};
tolerateClosedStdout();
process.stdout.write('the report\\n');
process.stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
process.stdout.write('dropped\\n');
await exitAfterFlush(Number(process.argv[2]));
process.stderr.write('UNREACHABLE\\n');
`);
  for (const code of [0, 3]) {
    const result = spawnSync(process.execPath, [file, String(code)], { cwd: tempDir('fp-flush-epipe-cwd-'), encoding: 'utf8', timeout: 10_000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, code, `exit ${result.status}, not ${code}:\n${result.stderr.slice(0, 400)}`);
    assert.doesNotMatch(result.stderr, /unsettled top-level await|UNREACHABLE/, result.stderr.slice(0, 400));
  }
});

test('exitAfterFlush delivers every line to a slow reader, then exits with the code it was given', async () => {
  const file = fixture();
  const results = await Promise.all([0, 1, 3].map((code) => throughSlowPipe([file, String(code)], tempDir('fp-flush-cwd-'))));
  [0, 1, 3].forEach((code, i) => {
    const lines = results[i].stdout.toString('utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 3000, `exit ${code}: the reader got ${lines.length} of 3000 lines`);
    assert.equal(results[i].status, code);
    assert.ok(!lines.includes('UNREACHABLE'), 'code after exitAfterFlush ran');
  });
});

test('exitAfterFlush does not turn a reader that leaves into a crash or a hang', async () => {
  const child = spawn(process.execPath, [fixture(), '0'], { cwd: tempDir('fp-flush-cwd-'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const err = [];
  child.stderr.on('data', (chunk) => err.push(chunk));
  const closed = new Promise((done, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the command hung after its reader left')); }, 30_000);
    child.on('close', (s) => { clearTimeout(timer); done(s); });
  });
  await Promise.race([new Promise((done) => child.stdout.once('data', () => { child.stdout.destroy(); done(); })), closed]);
  const status = await closed;
  const said = Buffer.concat(err).toString('utf8');
  assert.doesNotMatch(said, /EPIPE|Unhandled|node:events/, `a reader leaving reached the command as a crash:\n${said.slice(0, 600)}`);
  assert.equal(status, 0);
});

// selftest prints ~100 KB and cannot run inside itself, so where its exits go is checked.
test('selftest leaves through exitAfterFlush once it has printed its summary', () => {
  const source = fs.readFileSync(path.join(KIT_ROOT, 'bin', 'selftest.mjs'), 'utf8');
  const summary = source.indexOf('passed, ${failures} failed');
  assert.ok(summary !== -1, 'selftest.mjs no longer prints its summary where this test looks');
  const after = source.slice(summary);
  assert.doesNotMatch(after, /\bprocess\.exit\(/, 'selftest exits with process.exit() after its summary - a slow reader loses the verdict');
});
