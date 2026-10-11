#!/usr/bin/env node
// bin/collect-remote.mjs - run the collector on GitHub, bring the artifact home, judge it.
//
// The one command an AI agent or a desktop app needs. It dispatches, learns which run it
// started, waits, downloads, unwraps GitHub's outer ZIP, and validates with the same code
// a human would run. It prints the run id BEFORE it waits, so a caller that dies mid-wait
// can still find its run.
//
// THERE IS NO --token FLAG. The token is read from the environment, because a credential
// on a command line is in the shell history, in `ps`, and in any log that echoes its own
// command. Every message this program prints is redacted on the way out.
//
// EXIT CODES
//   0  collected, downloaded and valid   (this does NOT mean you may build)
//   1  the artifact is invalid
//   2  the run failed, or the artifact is incomplete/unsupported
//   3  could not start, could not reach GitHub, or no token
//   4  dispatched and still running when the wait ran out - the run id is on stdout, and
//      --run-id <n> picks it up again
//
// 0 DOES NOT AUTHORIZE BUILDING. A collected corpus is evidence with three review
// steps outstanding. Read `buildAuthorized`, which is false for everything this command
// will ever return, because a freshly collected corpus has not been reviewed by anybody.

import fs from 'node:fs';
import path from 'node:path';
import { parseFlags, flagList, canonicalJson, checkFlagValues } from '../lib/core.mjs';
import { requireRuntime, honourEnvProxy } from '../lib/runtime.mjs';
import {
  dispatchCollection, waitForRun, MAX_POLL_RETRIES, fetchCorpus, queriesInput, usableOutDir,
  tokenFromEnv, redact, DispatchError, API_VERSION, TOKEN_VARS,
} from '../lib/dispatch.mjs';

const HELP = `collect-remote - run the collector on GitHub Actions and bring the result back.

  node research-kit/bin/collect-remote.mjs --repository OWNER/REPO --topic "<what to research>"
  node research-kit/bin/collect-remote.mjs --repository OWNER/REPO --run-id <n>

  --repository OWNER/REPO   required
  --topic "<text>"          required. Visible to anyone who can read the repository.
  --prefer <domains>        optional, comma-separated. Domains that OWN the fact; ranked
                            above pages merely about it. On a shared host, name the path:
                            github.com/actions/upload-artifact, not github.com.
  --query "<text>"          optional, repeatable. The real search queries. Without one the
                            topic is used verbatim, which returns the words and not the
                            subject when the topic is made of common ones. Visible to
                            anyone who can read the repository, like --topic.
  --url "<https://...>"     optional, repeatable. A page you already know, fetched directly
                            instead of searched. Each counts against --max-pages. With only
                            --url and no --query, nothing is searched. Visible to anyone who
                            can read the repository, like --topic: never a signed URL.
  --prior "<text>"          optional. What you EXPECT to find, chained ahead of the first
                            page. Only possible now; refused once collection starts.
  --max-pages <1-25>        default 8. Each page costs at least one credit.
  --search-transport <name> auto | serpapi | firecrawl-cli. Default auto: a SerpApi key
                            wins, else the fetch provider. Pin one to compare them.
  --depth probe|quick|normal  default quick
  --client-ref <id>         optional. PUBLIC: it becomes the run and artifact name.
  --runner ubuntu-latest|windows-latest   default ubuntu-latest
  --workflow <file.yml>     default collect.yml
  --ref <branch>            default main
  --out <dir>               where to save the artifact (default .)
  --timeout <seconds>       how long to wait (default 1800)
  --no-wait                 dispatch and exit, printing the run id
  --run-id <n>              pick up a run already dispatched - after --no-wait, a timeout
                            (exit 4) or a lost connection - instead of dispatching another.
                            Waits for it, then downloads and judges it. Takes no --topic.
  --json                    machine-readable result

The token is read from the environment: ${TOKEN_VARS.join(' or ')}.
There is no --token flag, on purpose.

A fine-grained token needs exactly one permission: Actions -> Read and write, on this
repository only. Nothing else.

Exit: 0 valid, 1 invalid, 2 run failed/incomplete, 3 could not start, 4 still running.
A 0 does not authorize building - read buildAuthorized.
`;

const { flags } = parseFlags(process.argv.slice(2));
if (flags.help) { process.stdout.write(HELP); process.exit(0); }
requireRuntime({ node: true });

const KNOWN = new Set([
  'repository', 'topic', 'max-pages', 'depth', 'client-ref', 'runner', 'workflow', 'ref',
  'search-transport', 'prior', 'prefer', 'query', 'url',
  'out', 'timeout', 'no-wait', 'json', 'help', 'run-id',
]);
const unknown = Object.keys(flags).filter((f) => !KNOWN.has(f));
if (unknown.length) {
  for (const f of unknown) {
    process.stderr.write(`unknown option --${f}\n`);
    // The one misspelling worth naming, because the answer is not "spell it correctly".
    if (/token|auth|key|secret|pat/i.test(f)) {
      process.stderr.write(`There is no token flag. Set ${TOKEN_VARS[0]} in the environment instead:\n`
        + 'a credential on a command line reaches the shell history, ps, and any log that echoes its command.\n');
    }
  }
  process.stdout.write(HELP);
  process.exit(3);
}

const EXIT = Object.freeze({ VALID: 0, INVALID: 1, RUN_FAILED: 2, CANNOT_START: 3, STILL_RUNNING: 4 });
const json = Boolean(flags.json);

function say(text) { if (!json) process.stdout.write(`${redact(text)}\n`); }
function die(code, payload) {
  if (json) process.stdout.write(`${canonicalJson(payload)}\n`);
  else {
    process.stderr.write(`${redact(payload.error ?? 'failed')}\n`);
    if (payload.remedy) process.stderr.write(`  fix: ${redact(payload.remedy)}\n`);
  }
  process.exit(code);
}

// --run-id picks up a run already dispatched (found 2026-10-01: the remedies and exit 4 pointed at
// this flag, and it did not exist, so the only way back to a run was to pay for another). A topic
// beside it would dispatch a second run, so the two are refused together.
const pickUp = flags['run-id'] !== undefined;
if (pickUp) {
  const id = String(flags['run-id']);
  if (!/^[1-9]\d*$/.test(id)) {
    process.stderr.write(`--run-id takes the run's number, as printed by a dispatch: got "${flags['run-id'] === true ? '' : id}"\n`);
    process.exit(EXIT.CANNOT_START);
  }
  if (flags.topic !== undefined || flags['no-wait']) {
    process.stderr.write(`--run-id picks up a run already dispatched; ${flags.topic !== undefined ? '--topic would dispatch another' : '--no-wait would leave nothing to do'}. Give one or the other.\n`);
    process.exit(EXIT.CANNOT_START);
  }
}
const missing = (pickUp ? ['repository'] : ['repository', 'topic']).filter((n) => flags[n] === undefined || flags[n] === true);
if (missing.length) {
  process.stderr.write(`collect-remote needs ${missing.map((m) => `--${m}`).join(' and ')}\n\n`);
  process.stdout.write(HELP);
  process.exit(EXIT.CANNOT_START);
}

// Every value the workflow checks is checked here first, against the same ranges and choices
// (collect.yml): `--max-pages 8o` was dispatched as it was and the paid run failed on the
// runner (found 2026-09-29, Arena break test) - on the one flag that bounds spend.
checkFlagValues(flags, {
  'max-pages': { int: true, min: 1, max: 25 },
  depth: { choices: ['probe', 'quick', 'normal'] },
  runner: { choices: ['ubuntu-latest', 'windows-latest'] },
  'search-transport': { choices: ['auto', 'serpapi', 'firecrawl-cli'] },
  timeout: { int: true, min: 1 },
  out: {},
  workflow: {},
  ref: {},
}, { exit: EXIT.CANNOT_START });

// The caller's own typo is refused before anything else is asked of them - a missing
// token would otherwise hide it, and a dispatched bad URL would be searched as text.
const queriesValue = queriesInput({ queries: flagList(flags.query), urls: flagList(flags.url) });
if (queriesValue.error) {
  process.stderr.write(`${queriesValue.error}\n  fix: --url takes a page address starting with https://\n`);
  process.exit(EXIT.CANNOT_START);
}

// So is an --out this process cannot write: found after the wait, it cost a paid run.
// `--no-wait` downloads nothing, so it has no folder to check.
const outDir = path.resolve(String(flags.out ?? '.'));
if (!flags['no-wait']) {
  try { usableOutDir(outDir); } catch (e) {
    die(EXIT.CANNOT_START, { error: `${e.code}: ${e.message}`, code: e.code, remedy: e.remedy });
  }
}

const { token, from, detail } = tokenFromEnv();
if (!token) die(EXIT.CANNOT_START, { error: detail, remedy: 'create a fine-grained token with Actions: read and write on this repository only' });

// Before the first request: this process fetches, and Node's fetch ignores a proxy unless told.
await honourEnvProxy();

const repository = String(flags.repository);
const workflow = String(flags.workflow ?? 'collect.yml');
const ref = String(flags.ref ?? 'main');
const timeoutMs = Number(flags.timeout ?? 1800) * 1000;

const inputs = {
  topic: String(flags.topic),
  max_pages: String(flags['max-pages'] ?? 8),
  depth: String(flags.depth ?? 'quick'),
  runner: String(flags.runner ?? 'ubuntu-latest'),
  search_transport: String(flags['search-transport'] ?? 'auto'),
};
if (flags['client-ref'] !== undefined && flags['client-ref'] !== true) inputs.client_ref = String(flags['client-ref']);
// The prediction travels as an input and is registered ON THE RUNNER, because the runner
// scaffolds its own project: a prior registered here would be chained into a ledger the
// returning corpus never sees. Omitted entirely when absent, so a dispatch without one
// looks exactly like every dispatch before this flag existed.
if (flags.prior !== undefined && flags.prior !== true) inputs.prior = String(flags.prior);
// Both optional, both omitted entirely when absent, so a dispatch without them looks
// exactly like every dispatch before these flags existed. `--query` is repeatable and
// arrives as one newline-separated input, because a workflow_dispatch input is a string.
if (flags.prefer !== undefined && flags.prefer !== true) inputs.prefer = String(flags.prefer);
if (queriesValue.value) inputs.queries = queriesValue.value;

// ---------------------------------------------------------------- dispatch

let started;
if (pickUp) {
  started = { workflowRunId: Number(flags['run-id']), runUrl: null, htmlUrl: null };
} else {
  try {
    started = await dispatchCollection({ repository, workflow, ref, inputs, token });
  } catch (err) {
    const e = err instanceof DispatchError ? err : new DispatchError('UNKNOWN', err.message);
    die(EXIT.CANNOT_START, { error: `${e.code}: ${e.message}`, code: e.code, remedy: e.remedy });
  }
}

// Printed BEFORE the wait. A caller that dies here can still find its run, and a caller
// that never sees this line knows the dispatch itself did not land.
say(`token from ${from}, API version ${API_VERSION}`);
say(`run ${started.workflowRunId}  ${started.htmlUrl ?? ''}`);

if (flags['no-wait']) {
  const payload = { workflowRunId: started.workflowRunId, runUrl: started.runUrl, htmlUrl: started.htmlUrl, waited: false };
  if (json) process.stdout.write(`${canonicalJson(payload)}\n`);
  else say('dispatched; not waiting');
  process.exit(EXIT.VALID);
}

// ---------------------------------------------------------------- wait

/** The way back to this run, for a failure that names none: it was dispatched, and may be fine. */
function pickUpAgain() {
  return `the run may be fine - pick it up again without dispatching another: --repository ${repository} --run-id ${started.workflowRunId}`;
}

let run;
try {
  run = await waitForRun({
    repository, runId: started.workflowRunId, token, timeoutMs,
    onStatus: (r) => say(r.status === 'waiting'
      // Worth naming rather than showing as a bare status: it means a protection rule is
      // holding the job, which is a person's decision and not a stall to retry through.
      ? 'status: waiting - a deployment protection rule is holding this run for approval'
      : `status: ${r.status}`),
    // A failed poll the watch survives is still worth a line: a silent retry and a hang look alike.
    onRetry: (err, n) => say(`poll failed (${err.message}) - retrying, ${n} of ${MAX_POLL_RETRIES}`),
  });
} catch (err) {
  const e = err instanceof DispatchError ? err : new DispatchError('UNKNOWN', err.message);
  die(e.code === 'TIMEOUT' ? EXIT.STILL_RUNNING : EXIT.RUN_FAILED,
    { error: `${e.code}: ${e.message}`, code: e.code, remedy: e.remedy ?? pickUpAgain(), workflowRunId: started.workflowRunId });
}

if (run.conclusion !== 'success') {
  die(EXIT.RUN_FAILED, {
    error: `the run finished ${run.conclusion}`,
    workflowRunId: started.workflowRunId,
    htmlUrl: run.html_url ?? started.htmlUrl,
    remedy: 'open the run and read the first failing step; nothing was downloaded',
  });
}

// ---------------------------------------------------------------- collect the artifact

// ONE implementation of "bring it home and judge it", shared with the MCP server. The
// approved brief is explicit about why: a second copy of this logic is how the vendor
// package name came to be wrong in two workflows at once.
let got;
try {
  got = await fetchCorpus({
    repository, runId: started.workflowRunId, token,
    outDir, expectedClientRef: inputs.client_ref ?? null,
  });
} catch (err) {
  const e = err instanceof DispatchError ? err : new DispatchError('UNKNOWN', err.message);
  die(EXIT.RUN_FAILED, { error: `${e.code}: ${e.message}`, code: e.code, remedy: e.remedy ?? pickUpAgain(), workflowRunId: started.workflowRunId });
}
const { file, validation: result } = got;
say(`saved ${file}`);


const payload = {
  ...result,
  file,
  workflowRunId: started.workflowRunId,
  htmlUrl: run.html_url ?? started.htmlUrl,
  apiVersion: API_VERSION,
};

if (json) process.stdout.write(`${canonicalJson(payload)}\n`);
else {
  if (result.errors.length) {
    say(`\n${result.errors.length} problem(s)`);
    for (const e of result.errors) say(`  ${e.code}  ${e.message}`);
  }
  say(`\n${result.status}  build ${result.buildAuthorized ? 'AUTHORIZED' : 'NOT authorized'}  state=${result.state}`);
  if (result.status === 'PASS' && !result.buildAuthorized) {
    say('\nThis is a COLLECTED CORPUS, not an approved brief. It does not authorize building.');
    say('Three review steps remain, for the agent; README-FIRST.md inside the package lists them.');
  }
}

process.exit(result.status === 'PASS' ? EXIT.VALID
  : result.status === 'FAIL' ? EXIT.INVALID
    : EXIT.RUN_FAILED);
