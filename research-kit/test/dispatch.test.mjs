// The dispatch seam, offline.
//
// Every request goes through an injected `fetch`, so this file reaches no network, holds
// no credential, and can assert things a live test never could: what header was actually
// sent, that a token never appears in an error, that a 204 is diagnosed rather than
// swallowed. The live path is verified separately, by running it.

import { test, describe, assert, tempDir, cleanup, fs, path, requireSymlink } from './harness.mjs';
import { tempBase } from '../lib/core.mjs';
import {
  dispatchCollection, waitForRun, getRun, listArtifacts, downloadArtifact, unwrapArtifact, queriesInput,
  tokenFromEnv, redact, DispatchError, API_VERSION, TOKEN_VARS, fetchCorpus,
} from '../lib/dispatch.mjs';
import { rawZip } from './artifact-fixtures.mjs';
import { openZip as importedOpenZip } from '../lib/artifact-zip.mjs';

describe('dispatch');

test('default corpus downloads use different private directories even for the same artifact name', async () => {
  const name = `research-kit-corpus-v1-private-${process.pid}`;
  const downloads = [];
  const fetch = () => stubFetch([
    jsonResponse(200, { artifacts: [{ id: 7, name, expired: false }] }),
    { ok: true, status: 200, arrayBuffer: async () => Buffer.from('package bytes') },
  ]);
  try {
    for (let runId = 1; runId <= 2; runId++) downloads.push(await fetchCorpus({ repository: REPO, runId, token: TOKEN, fetch: fetch() }));
    const folders = downloads.map((download) => path.dirname(download.file));
    assert.notEqual(folders[0], folders[1]);
    for (const download of downloads) {
      const folder = path.dirname(download.file);
      assert.equal(path.dirname(folder), tempBase());
      assert.match(path.basename(folder), /^research-kit-corpus-/);
      assert.equal(fs.readFileSync(download.file, 'utf8'), 'package bytes');
      if (process.platform !== 'win32') assert.equal(fs.statSync(folder).mode & 0o077, 0);
    }
  } finally {
    for (const download of downloads) {
      const folder = path.dirname(download.file);
      if (folder === tempBase()) fs.rmSync(download.file, { force: true });
      else cleanup(folder);
    }
  }
});

test('an existing or dangling package symlink is refused without writing its target', async () => {
  const dir = tempDir('rk-download-link-');
  const name = 'research-kit-corpus-v1-link';
  const target = path.join(dir, 'victim.txt');
  const output = path.join(dir, `${name}.zip`);
  for (const dangling of [false, true]) {
    if (!dangling) fs.writeFileSync(target, 'precious');
    requireSymlink(target, output, 'a package symlink must not redirect a download');
    const fetch = stubFetch([
      jsonResponse(200, { artifacts: [{ id: 7, name, expired: false }] }),
      { ok: true, status: 200, arrayBuffer: async () => Buffer.from('replacement') },
    ]);
    await assert.rejects(() => fetchCorpus({ repository: REPO, runId: 1, token: TOKEN, outDir: dir, fetch }),
      (error) => error.code === 'OUT_DIR' && /symbolic link/.test(error.message));
    if (dangling) assert.equal(fs.existsSync(target), false);
    else assert.equal(fs.readFileSync(target, 'utf8'), 'precious');
    fs.unlinkSync(output);
    if (!dangling) fs.unlinkSync(target);
  }
});

const TOKEN = `github_pat_${'A1b2C3d4E5'.repeat(4)}`;
const REPO = 'example-org/example-project';

/** A fetch that records what it was asked and answers from a script. */
function stubFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const doFetch = async (url, init = {}) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  doFetch.calls = calls;
  return doFetch;
}

function jsonResponse(status, body, extra = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
    ...extra,
  };
}

// ---------------------------------------------------------------- the token

test('the token comes from the environment, in a declared order', () => {
  assert.deepEqual([...TOKEN_VARS], ['RESEARCH_KIT_GITHUB_TOKEN', 'GITHUB_TOKEN']);
  assert.equal(tokenFromEnv({ GITHUB_TOKEN: 'b' }).token, 'b');
  assert.equal(tokenFromEnv({ RESEARCH_KIT_GITHUB_TOKEN: 'a', GITHUB_TOKEN: 'b' }).token, 'a',
    'the kit-specific variable must win, so a general GITHUB_TOKEN cannot silently outrank a deliberate one');
  assert.equal(tokenFromEnv({ RESEARCH_KIT_GITHUB_TOKEN: '   ' }).token, null, 'whitespace is not a token');
  assert.equal(tokenFromEnv({}).token, null);
  assert.match(tokenFromEnv({}).detail, /RESEARCH_KIT_GITHUB_TOKEN/);
});

test('there is no way to pass a token as an argument', () => {
  // Asserted against the SOURCE, because the property is the absence of a feature and an
  // absence cannot be called.
  const source = dispatchCollection.toString();
  assert.ok(!/--token|flags\.token/.test(source), 'dispatchCollection reads a token flag');
});

test('redaction is pattern-based, so it also catches a credential it was never given', () => {
  const mine = `Bearer ${TOKEN}`;
  assert.ok(!redact(mine).includes(TOKEN));
  // A different credential entirely - from a redirect, a proxy, an echoed header.
  assert.ok(!redact('ghp_' + 'z'.repeat(36)).includes('z'.repeat(36)));
  assert.ok(!redact('fc-' + 'a1b2c3d4'.repeat(3)).includes('a1b2c3d4a1b2c3d4'));
  assert.ok(!redact('authorization: abcdefghijklmnop').includes('abcdefghijklmnop'));
  assert.equal(redact('nothing secret here'), 'nothing secret here');
});

// ---------------------------------------------------------------- dispatching

test('the API version is pinned on the request, not merely documented', async () => {
  const doFetch = stubFetch([jsonResponse(200, { workflow_run_id: 7, run_url: 'u', html_url: 'h' })]);
  await dispatchCollection({ repository: REPO, token: TOKEN, fetch: doFetch, inputs: { topic: 'x' } });

  const { url, init } = doFetch.calls[0];
  assert.match(url, /\/repos\/example-org\/example-project\/actions\/workflows\/collect\.yml\/dispatches$/);
  assert.equal(init.headers['X-GitHub-Api-Version'], API_VERSION,
    'without the pinned version the endpoint returns 204 and the caller cannot identify its run');
  assert.equal(init.method, 'POST');
});

test('BOTH routes to a run id are requested, not just the pinned version', async () => {
  // The pin makes run details the default; `return_run_details` asks for them outright, and
  // works on 2022-11-28 as well. Measured on 2026-09-21 against this repository: the old
  // version with the parameter returns 200 + workflow_run_id, and the new version accepts
  // the parameter rather than rejecting it as unknown. Sending both means a server that
  // ignores or downgrades the header still answers with a run id.
  //
  // Asserted on the REQUEST BODY because that is the whole change - a stub returning 200
  // would pass whatever we sent, so only the outgoing bytes prove it.
  const doFetch = stubFetch([jsonResponse(200, { workflow_run_id: 7, run_url: 'u', html_url: 'h' })]);
  await dispatchCollection({ repository: REPO, token: TOKEN, fetch: doFetch, inputs: { topic: 'x' } });

  const sent = JSON.parse(doFetch.calls[0].init.body);
  assert.equal(sent.return_run_details, true);
  assert.equal(doFetch.calls[0].init.headers['X-GitHub-Api-Version'], API_VERSION);
  assert.equal(sent.ref, 'main', 'the belt-and-braces parameter must not disturb the rest of the body');
  assert.deepEqual(sent.inputs, { topic: 'x' });
});

test('a 200 with the run id is the whole point', async () => {
  const doFetch = stubFetch([jsonResponse(200, { workflow_run_id: 35590767944, run_url: 'r', html_url: 'h' })]);
  const out = await dispatchCollection({ repository: REPO, token: TOKEN, fetch: doFetch });
  assert.deepEqual(out, { workflowRunId: 35590767944, runUrl: 'r', htmlUrl: 'h' });
});

test('a 204 is a NAMED failure explaining the cause, not an empty success', async () => {
  // The failure a caller is least equipped to diagnose: the run started and they have no
  // idea which one. Returning a partial result here would hand them a useless object.
  const doFetch = stubFetch([{ ok: false, status: 204, text: async () => '', json: async () => null }]);
  await assert.rejects(
    () => dispatchCollection({ repository: REPO, token: TOKEN, fetch: doFetch }),
    (err) => {
      assert.ok(err instanceof DispatchError);
      assert.equal(err.code, 'NO_RUN_ID');
      assert.match(err.message, /cannot be identified/);
      // The remedy named 2022-11-28 while the pinned header was the only route to a run id.
      // There are now two, so a 204 means BOTH were ignored - a narrower and more useful
      // diagnosis, and the assertion follows the explanation rather than the old wording.
      assert.match(err.remedy, /return_run_details/);
      assert.match(err.remedy, /X-GitHub-Api-Version/);
      return true;
    },
  );
});

test('a 200 without a run id is refused too, not returned as undefined', async () => {
  const doFetch = stubFetch([jsonResponse(200, { something_else: true })]);
  await assert.rejects(() => dispatchCollection({ repository: REPO, token: TOKEN, fetch: doFetch }),
    (err) => err.code === 'NO_RUN_ID');
});

test('404 and 403 get remedies that name the real cause', async () => {
  const notFound = stubFetch([jsonResponse(404, { message: 'Not Found' })]);
  await assert.rejects(() => dispatchCollection({ repository: REPO, token: TOKEN, fetch: notFound }),
    (err) => {
      assert.equal(err.code, 'NOT_FOUND');
      // 404 means "absent" OR "you may not see it", so the remedy must cover both.
      assert.match(err.remedy, /DEFAULT branch/);
      assert.match(err.remedy, /Actions: read and write/);
      return true;
    });

  const forbidden = stubFetch([jsonResponse(403, { message: 'Forbidden' })]);
  await assert.rejects(() => dispatchCollection({ repository: REPO, token: TOKEN, fetch: forbidden }),
    (err) => err.code === 'FORBIDDEN' && /Actions/.test(err.remedy));
});

test('no error message ever carries the token, whatever the server said', async () => {
  // The server echoing the credential back is the case a hand-written message forgets.
  const leaky = stubFetch([jsonResponse(500, { message: `bad credentials for ${TOKEN}` })]);
  await assert.rejects(() => dispatchCollection({ repository: REPO, token: TOKEN, fetch: leaky }),
    (err) => {
      assert.ok(!err.message.includes(TOKEN), `the token leaked into an error: ${err.message}`);
      assert.match(err.message, /redacted/);
      return true;
    });
});

test('a network failure is distinguished from a rejection', async () => {
  const doFetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  await assert.rejects(() => dispatchCollection({ repository: REPO, token: TOKEN, fetch: doFetch }),
    (err) => err.code === 'NETWORK' && /safe to repeat/.test(err.remedy));
});

// Same class as the transports' 2026-09-30 fix (ADR-0047), one seam later: a dispatch that
// never left read "could not reach https://api.github.com: fetch failed" whatever the cause,
// and the caller is an agent whose only next step is to guess. Reproduced 2026-09-30 on a
// host with no egress to api.github.com, where the real cause was a TLS-inspecting proxy.
test('a dispatch that never left names the cause, not the bare "fetch failed"', async () => {
  const doFetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.github.com' };
    throw err;
  };
  for (const call of [
    () => dispatchCollection({ repository: REPO, token: TOKEN, fetch: doFetch }),
    () => getRun({ repository: REPO, runId: 1, token: TOKEN, fetch: doFetch }),
    () => listArtifacts({ repository: REPO, runId: 1, token: TOKEN, fetch: doFetch }),
    () => downloadArtifact({ repository: REPO, artifactId: 1, token: TOKEN, fetch: doFetch }),
  ]) {
    await assert.rejects(call, (err) => {
      assert.equal(err.code, 'NETWORK');
      assert.match(err.message, /ENOTFOUND/);
      assert.doesNotMatch(err.message, /: fetch failed$/, 'the cause was dropped');
      assert.ok(err.remedy, 'a NETWORK DispatchError must carry a remedy');
      return true;
    });
  }
});

// Reproduced 2026-09-30 (break-test) with a fetch answering 200 and an HTML body - what a
// GitHub maintenance window, a corporate TLS-inspecting proxy and an edge cache under load
// all return. `dispatchCollection` guarded this from the start; `getRun` and `listArtifacts`
// did not, and both threw a raw SyntaxError that `collect-remote` could only report as
// `UNKNOWN`, with no status and no remedy.
test('a 200 whose body is not JSON is a dispatch error, not a SyntaxError', async () => {
  const html = async () => ({
    ok: true, status: 200,
    json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
  });
  for (const [name, call] of [
    ['getRun', () => getRun({ repository: REPO, runId: 1, token: TOKEN, fetch: html })],
    ['listArtifacts', () => listArtifacts({ repository: REPO, runId: 1, token: TOKEN, fetch: html })],
  ]) {
    await assert.rejects(call, (err) => {
      assert.equal(err.code, 'BAD_BODY', `${name} should report a dispatch error by name`);
      assert.equal(err.status, 200);
      assert.match(err.message, /not JSON/);
      assert.ok(err.remedy, `${name} should carry a remedy`);
      return true;
    });
  }
  // And a body that IS json still reads.
  const good = async () => ({ ok: true, status: 200, json: async () => ({ id: 7, artifacts: [{ id: 7 }] }) });
  assert.deepEqual(await listArtifacts({ repository: REPO, runId: 1, token: TOKEN, fetch: good }), [{ id: 7 }]);
  assert.equal((await getRun({ repository: REPO, runId: 1, token: TOKEN, fetch: good })).id, 7);
});

test('a malformed repository is refused before any request is made', async () => {
  const doFetch = stubFetch([jsonResponse(200, { workflow_run_id: 1 })]);
  for (const bad of ['no-slash', '/leading', 'trailing/', 'a/b/c']) {
    await assert.rejects(() => dispatchCollection({ repository: bad, token: TOKEN, fetch: doFetch }),
      (err) => err.code === 'REPOSITORY');
  }
  assert.equal(doFetch.calls.length, 0, 'a bad repository must not produce a request');
});

test('inputs are stringified, and empty ones are dropped rather than sent blank', async () => {
  const doFetch = stubFetch([jsonResponse(200, { workflow_run_id: 1 })]);
  await dispatchCollection({
    repository: REPO, token: TOKEN, fetch: doFetch,
    inputs: { topic: 'x', max_pages: 8, client_ref: '', runner: undefined },
  });
  const body = JSON.parse(doFetch.calls[0].init.body);
  assert.deepEqual(body.inputs, { topic: 'x', max_pages: '8' },
    'workflow inputs are strings on the wire, and an empty client_ref must not be sent as ""');
});

// ---------------------------------------------------------------- waiting

test('waiting reports "waiting" as a status rather than treating it as a stall', async () => {
  const seen = [];
  const doFetch = stubFetch([
    jsonResponse(200, { status: 'waiting' }),
    jsonResponse(200, { status: 'in_progress' }),
    jsonResponse(200, { status: 'completed', conclusion: 'success' }),
  ]);
  const run = await waitForRun({
    repository: REPO, runId: 1, token: TOKEN, fetch: doFetch,
    intervalMs: 0, sleep: async () => {}, onStatus: (r) => seen.push(r.status),
  });
  assert.equal(run.conclusion, 'success');
  assert.deepEqual(seen, ['waiting', 'in_progress', 'completed'],
    'a protection rule holding a job is a status, not a failure to give up on');
});

test('a timeout says the run is still going, not that it failed', async () => {
  let clock = 0;
  const doFetch = stubFetch([jsonResponse(200, { status: 'in_progress', html_url: 'h' })]);
  await assert.rejects(
    () => waitForRun({
      repository: REPO, runId: 1, token: TOKEN, fetch: doFetch,
      intervalMs: 1, timeoutMs: 10, sleep: async () => { clock += 20; }, now: () => clock,
    }),
    (err) => {
      assert.equal(err.code, 'TIMEOUT');
      assert.match(err.remedy, /still going/);
      return true;
    },
  );
});

// Found 2026-10-01 (break-test, PR #182): every failed poll was fatal. A watch can last 30 minutes
// - up to 180 polls - and one dropped connection, one 502 or one HTML maintenance page ended it
// with RUN_FAILED while the run, and the credits it spends, went on unwatched.
const dropped = () => { throw new TypeError('fetch failed'); };
const htmlPage = { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); }, text: async () => '<html>' };

test('a transient failure while polling is retried, and the watch goes on to the result', async () => {
  for (const [what, transient] of [['a dropped connection', dropped], ['502', jsonResponse(502, {})], ['503', jsonResponse(503, {})],
    ['429', jsonResponse(429, {})], ['an HTML body on a 200', htmlPage]]) {
    const retries = [];
    const doFetch = stubFetch([
      jsonResponse(200, { status: 'in_progress' }),
      transient,
      transient,
      jsonResponse(200, { status: 'completed', conclusion: 'success' }),
    ]);
    const run = await waitForRun({
      repository: REPO, runId: 1, token: TOKEN, fetch: doFetch,
      intervalMs: 0, sleep: async () => {}, onRetry: (err, n) => retries.push(n),
    });
    assert.equal(run.conclusion, 'success', `${what} ended the watch`);
    assert.deepEqual(retries, [1, 2], `${what}: each retry is reported, numbered`);
  }
});

test('a poll that keeps failing gives up after five retries in a row, and a success resets the count', async () => {
  const fail = jsonResponse(503, {});
  const ok = jsonResponse(200, { status: 'in_progress' });
  // Four failures, a success, four more: never five in a row, so the watch reaches the result.
  const recovering = stubFetch([fail, fail, fail, fail, ok, fail, fail, fail, fail, jsonResponse(200, { status: 'completed', conclusion: 'success' })]);
  const run = await waitForRun({ repository: REPO, runId: 1, token: TOKEN, fetch: recovering, intervalMs: 0, sleep: async () => {} });
  assert.equal(run.conclusion, 'success', 'the count of failures in a row was not reset by a success');

  const down = stubFetch([fail]);
  await assert.rejects(
    () => waitForRun({ repository: REPO, runId: 1, token: TOKEN, fetch: down, intervalMs: 0, sleep: async () => {} }),
    (err) => { assert.equal(err.status, 503); return true; },
  );
  assert.equal(down.calls.length, 6, 'one poll and five retries, then the error');
});

test('a poll refused for the token or the run is not retried', async () => {
  for (const status of [401, 403, 404]) {
    const doFetch = stubFetch([jsonResponse(status, {})]);
    await assert.rejects(
      () => waitForRun({ repository: REPO, runId: 1, token: TOKEN, fetch: doFetch, intervalMs: 0, sleep: async () => {} }),
      (err) => { assert.equal(err.status, status); return true; },
    );
    assert.equal(doFetch.calls.length, 1, `HTTP ${status} was retried: a retry cannot change the answer`);
    await waitForRun({ repository: REPO, runId: 7, token: TOKEN, fetch: stubFetch([jsonResponse(status, {})]), intervalMs: 0, sleep: async () => {} })
      .catch((err) => assert.match(err.remedy ?? '', status === 404 ? /no run 7/ : /token/, `HTTP ${status} gave no way out of its own`));
  }
});

test('retrying a failing poll does not outlast the deadline', async () => {
  let clock = 0;
  const doFetch = stubFetch([jsonResponse(502, {})]);
  await assert.rejects(
    () => waitForRun({
      repository: REPO, runId: 1, token: TOKEN, fetch: doFetch,
      intervalMs: 1, timeoutMs: 10, sleep: async () => { clock += 20; }, now: () => clock,
    }),
    (err) => { assert.equal(err.status, 502); return true; },
  );
  // As with a run still in progress: the poll after the sleep that crosses the deadline is the last.
  assert.equal(doFetch.calls.length, 2, 'retries went on after the deadline had passed');
});

// ---------------------------------------------------------------- the artifact

test('an expired artifact is named as expired, with the reason it is gone', async () => {
  const doFetch = stubFetch([{ ok: false, status: 410, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }]);
  await assert.rejects(() => downloadArtifact({ repository: REPO, artifactId: 1, token: TOKEN, fetch: doFetch }),
    (err) => {
      assert.equal(err.code, 'EXPIRED');
      assert.match(err.remedy, /transport|persists|retention/);
      return true;
    });
});

test('listArtifacts returns the array, not the envelope', async () => {
  const doFetch = stubFetch([jsonResponse(200, { total_count: 1, artifacts: [{ id: 5, name: 'research-kit-corpus-v1-x' }] })]);
  const out = await listArtifacts({ repository: REPO, runId: 1, token: TOKEN, fetch: doFetch });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 5);
});

test("GitHub's outer ZIP is unwrapped, and a bare package is left alone", () => {
  const inner = rawZip([{ name: 'manifest.json', data: '{}' }]);
  const outer = rawZip([{ name: 'research-kit-corpus-v1-job-1.zip', data: inner }]);

  const wrapped = unwrapArtifact(outer);
  assert.equal(wrapped.unwrapped, true);
  assert.equal(wrapped.name, 'research-kit-corpus-v1-job-1.zip');
  assert.deepEqual([...wrapped.bytes], [...inner], 'the inner package must come out byte-identical');

  // A package that is not wrapped must pass through untouched rather than being
  // half-opened: the validator judges one format, not a guess about packaging depth.
  const bare = unwrapArtifact(inner);
  assert.equal(bare.unwrapped, false);
  assert.deepEqual([...bare.bytes], [...inner]);
});

test('unwrapping refuses to guess when there is more than one candidate', () => {
  const outer = rawZip([
    { name: 'a.zip', data: rawZip([{ name: 'x', data: '1' }]) },
    { name: 'b.zip', data: rawZip([{ name: 'y', data: '2' }]) },
  ]);
  assert.equal(unwrapArtifact(outer).unwrapped, false, 'two candidates is not a package to unwrap, it is a package to refuse');
});

test('unwrapping a hostile outer archive does not throw', () => {
  // The outer ZIP comes from a transport, so it gets the same distrust as the inner one:
  // a container with structural problems is passed through for the validator to refuse,
  // never opened here.
  const hostile = rawZip([{ name: '../escape.zip', data: rawZip([{ name: 'x', data: '1' }]) }]);
  const out = unwrapArtifact(hostile);
  assert.equal(out.unwrapped, false);
  assert.equal(unwrapArtifact(Buffer.from('not a zip at all')).unwrapped, false);
});

// ---------------------------------------------------------------- pages fetched by URL

test('queries and URLs travel as one input, one per line, and nothing is sent when both are empty', () => {
  assert.deepEqual(queriesInput({ queries: ['q one', ' q two '], urls: ['https://a.example/x'] }),
    { value: 'q one\nq two\nhttps://a.example/x', error: '' });
  assert.deepEqual(queriesInput({}), { value: undefined, error: '' },
    'a dispatch without either must look exactly like one before these options existed');
});

test('a URL that is not http(s) is refused before dispatch, not searched on the runner', () => {
  for (const bad of ['ftp://a.example/x', 'file:///etc/passwd', 'https://', 'not a url']) {
    const r = queriesInput({ urls: [bad] });
    assert.equal(r.value, undefined, `${bad} was accepted`);
    assert.match(r.error, /http\(s\)/, `${bad}: the refusal should say what is expected`);
  }
});

test('fetchCorpus refuses an out_dir it cannot write BEFORE it downloads anything', async () => {
  // The download is the slow, rate-limited part; learning afterwards that the folder was
  // unusable wasted it, and the raw ENOTDIR that surfaced carried no code a caller could
  // branch on (the MCP server reported it as UNKNOWN).
  const dir = tempDir();
  try {
    const file = path.join(dir, 'a-file');
    fs.writeFileSync(file, 'x');
    const doFetch = stubFetch([jsonResponse(200, { artifacts: [] })]);
    await assert.rejects(
      () => fetchCorpus({ repository: REPO, runId: 1, token: TOKEN, outDir: path.join(file, 'sub'), fetch: doFetch }),
      (err) => {
        assert.ok(err instanceof DispatchError, `a raw ${err.code ?? err.name} escaped`);
        assert.equal(err.code, 'OUT_DIR');
        assert.match(err.message, /a-file/);
        assert.match(err.remedy, /writable folder/);
        return true;
      });
    assert.equal(doFetch.calls.length, 0, 'the run was queried before the folder was checked');
  } finally { cleanup(dir); }
});

// Found 2026-09-28 (Arena break test 10, its R-2): writeZip and writeArtifact were moved to
// the whole-or-nothing write, but fetchCorpus - which writes the package it DOWNLOADED -
// still called fs.writeFileSync on the target. A failed write (full disk, quota, a killed
// job) emptied a package already sitting at that name before failing.
test('a downloaded package whose write fails leaves the package already there untouched', async () => {
  const dir = tempDir('rk-fetch-atomic-');
  const name = 'research-kit-corpus-v1-probe';
  const target = path.join(dir, `${name}.zip`);
  const previous = Buffer.from('PREVIOUS PACKAGE\n'.repeat(200));
  fs.writeFileSync(target, previous);
  const doFetch = stubFetch([
    jsonResponse(200, { artifacts: [{ id: 7, name, expired: false }] }),
    { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('NEW BYTES, NOT A ZIP').buffer },
  ]);
  const real = fs.writeFileSync;
  fs.writeFileSync = (file, data, ...rest) => {
    real(file, Buffer.isBuffer(data) ? data.subarray(0, 4) : String(data).slice(0, 4), ...rest);
    const err = new Error('ENOSPC: no space left on device, write'); err.code = 'ENOSPC'; throw err;
  };
  let error = null;
  try {
    await fetchCorpus({ repository: REPO, runId: 1, token: TOKEN, outDir: dir, fetch: doFetch });
  } catch (err) { error = err; } finally { fs.writeFileSync = real; }
  assert.equal(error?.code, 'ENOSPC', `the failure must still reach the caller: ${error?.message}`);
  assert.deepEqual(fs.readFileSync(target), previous, 'the package already there was damaged');
  assert.ok(!fs.readdirSync(dir).some((f) => f.includes('.tmp-')), `a scratch file was left behind: ${fs.readdirSync(dir)}`);
});

// Found 2026-10-01 (break-test, PR #178): the package was written to path.join(dir, <name the
// API returned>), and a name with separators or `..` - `research-kit-corpus-v1-/../../../pwned`
// - put it outside the --out directory. A wrapper ZIP's inner entry name became a path the same
// way. Names from the API are data, never paths: an unsafe one is refused, a wrapper entry is
// flattened to its file name.
test('a downloaded package cannot be written outside the directory asked for', async () => {
  const parent = tempDir('rk-escape-');
  const dir = path.join(parent, 'sub', 'out');
  fs.mkdirSync(dir, { recursive: true });
  const download = (name, body) => stubFetch([
    jsonResponse(200, { artifacts: [{ id: 1, name, expired: false }] }),
    { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) },
  ]);
  try {
    for (const name of ['research-kit-corpus-v1-/../../../pwned', 'research-kit-corpus-v1-\\..\\..\\pwned', 'research-kit-corpus-v1-C:pwned', 'research-kit-corpus-v1-a\u0000b']) {
      await assert.rejects(() => fetchCorpus({ repository: REPO, runId: 1, token: TOKEN, outDir: dir, fetch: download(name, Buffer.from('not a zip')) }),
        (e) => e instanceof DispatchError && e.code === 'ARTIFACT_NAME', `${JSON.stringify(name)} was not refused`);
    }
    // A nested entry is flattened; an entry naming a parent is refused by openZip already, so
    // the download is kept whole under the artifact's own name - inside --out either way.
    for (const [entry, expected] of [['nested/package.zip', 'package.zip'], ['../../evil.zip', 'research-kit-corpus-v1-ok.zip']]) {
      const r = await fetchCorpus({ repository: REPO, runId: 1, token: TOKEN, outDir: dir, fetch: download('research-kit-corpus-v1-ok', rawZip([{ name: entry, data: 'inner' }])) });
      assert.equal(r.file, path.join(dir, expected), `the wrapper entry ${entry} was not flattened`);
    }
    assert.deepEqual(fs.readdirSync(parent).sort(), ['sub'], 'something was written outside --out');
    assert.deepEqual(fs.readdirSync(path.join(parent, 'sub')), ['out'], 'something was written outside --out');
  } finally { cleanup(parent); }
});

// Found 2026-10-01 (break-test, PR #178): unwrapArtifact caught a wrapper it could not open,
// but not an inner entry it could not READ - an invalid deflate stream threw ZIP-READ out of
// fetchCorpus, past the validator that exists to judge exactly such bytes.
test('a wrapper whose inner package cannot be decompressed is judged by the validator, not thrown', async () => {
  const { buildZip } = await import('../lib/archive.mjs');
  const bytes = buildZip([{ name: 'package.zip', data: 'hello'.repeat(100) }]);
  bytes.fill(255, 41, 46);                 // inside the deflated payload: an invalid block type
  assert.throws(() => (/** the fixture must really be corrupt */ require_read(bytes)), /could not be decompressed/);
  const r = unwrapArtifact(bytes);
  assert.equal(r.unwrapped, false);
  assert.equal(r.bytes, bytes, 'the bytes are handed on as they came');

  const dir = tempDir('rk-corrupt-');
  try {
    const result = await fetchCorpus({ repository: REPO, runId: 1, token: TOKEN, outDir: dir, fetch: stubFetch([
      jsonResponse(200, { artifacts: [{ id: 1, name: 'research-kit-corpus-v1-ok', expired: false }] }),
      { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) },
    ]) });
    assert.notEqual(result.validation.status, 'PASS', 'a package that cannot be read must not validate');
    assert.ok(result.validation.errors.length > 0, 'and the validator must say why');
  } finally { cleanup(dir); }
});

function require_read(bytes) {
  // openZip is what unwrapArtifact uses; reading the one entry is where the throw came from.
  return importedOpenZip(bytes).read('package.zip');
}
