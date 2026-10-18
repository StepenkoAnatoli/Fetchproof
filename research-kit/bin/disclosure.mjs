#!/usr/bin/env node
// bin/disclosure.mjs - measure what a public run exposes, instead of asserting it.
//
// Sends unauthenticated requests to a repository you name and reports what a stranger can
// read. There is no token flag and no credential is read from the environment: a probe
// that quietly authenticated would answer a different question and look like this one.
//
// Exit codes are the finding, so this can gate something later:
//   0  only the SHAPE is public - names, sizes, timings
//   1  CONTENT is public - artifacts or logs can be read by a stranger
//   2  the SUBJECT is public - the topic you passed was found in a public response
//   3  could not measure - including any probe that never reached GitHub, unless an
//      exposure was measured anyway

import { parseFlags, refuseUnknownFlags, checkFlagValues } from '../lib/core.mjs';
import { requireRuntime, honourEnvProxy } from '../lib/runtime.mjs';
import { probeRun, render, exitCode } from '../lib/disclosure.mjs';

const HELP = `disclosure - what can a stranger see of a workflow run?

  node research-kit/bin/disclosure.mjs --repository OWNER/REPO --run <id> [--topic "<text>"]

  --repository OWNER/REPO   required
  --run <id>                the workflow run to probe   (required)
  --topic "<text>"          the subject whose appearance would mean it leaked
  --json                    machine-readable report

Every request is UNAUTHENTICATED, on purpose: the question is what somebody with no
relationship to the repository can read. There is no token flag.

Exit: 0 shape only, 1 content readable, 2 subject leaked, 3 could not measure.
`;

const { flags } = parseFlags(process.argv.slice(2));
if (flags.help) { process.stdout.write(HELP); process.exit(0); }
requireRuntime({ node: true });

// The shared refusal, so a flag given twice or a stray argument is refused too (#286, #289).
refuseUnknownFlags(flags, ['repository', 'run', 'topic', 'json', 'help'], {
  help: HELP, exit: 3,
  note: (f) => (/token|auth|key|secret/i.test(f)
    ? 'This probe is unauthenticated by design. Authenticating it would answer a different question.' : ''),
});
checkFlagValues(flags, { repository: {}, run: {}, topic: {} }, { exit: 3 });

const missing = ['repository', 'run'].filter((n) => flags[n] === undefined || flags[n] === true);
if (missing.length) {
  process.stderr.write(`disclosure needs ${missing.map((m) => `--${m}`).join(' and ')}\n\n`);
  process.stdout.write(HELP);
  process.exit(3);
}

// Before the first request: this process fetches, and Node's fetch ignores a proxy unless told.
await honourEnvProxy();

let report;
try {
  report = await probeRun({
    repository: String(flags.repository),
    runId: Number(flags.run),
    needle: flags.topic === undefined || flags.topic === true ? null : String(flags.topic),
  });
} catch (error) {
  process.stderr.write(`could not measure: ${error.message}\n`);
  process.exit(3);
}

if (flags.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else process.stdout.write(`${render(report)}\n`);

process.exit(exitCode(report));
