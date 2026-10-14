#!/usr/bin/env node
// bin/artifact.mjs - create a portable artifact, or judge one.
//
// EXIT CODES ARE THE INTERFACE. A script reads them; a human reads the table.
//
//   0  the package is valid          (validate) / written and re-validated (create)
//   1  the package is invalid
//   2  incomplete, or a format major this build does not implement
//   3  validation was blocked and reached no verdict
//
// 0 DOES NOT MEAN "YOU MAY BUILD". It means the package is internally consistent. The
// permission question has its own field, printed on its own line and present in --json as
// `buildAuthorized`. Conflating them is the mistake this whole format exists to prevent,
// so the CLI refuses to imply otherwise: a valid collected corpus exits 0 and says
// "building is NOT authorized" in the same breath.

import fs from 'node:fs';
import path from 'node:path';
import { parseFlags, canonicalJson, checkFlagValues, exitAfterFlush } from '../lib/core.mjs';
import { requireRuntime } from '../lib/runtime.mjs';
import { validateArtifact } from '../lib/artifact-validator.mjs';
import { writeArtifact, packageName, checkClientRef, GITHUB_API_VERSION } from '../lib/artifact.mjs';

const HELP = `artifact - the portable Research-Kit package.

  node research-kit/bin/artifact.mjs validate --file <package.zip> [options]
  node research-kit/bin/artifact.mjs create   --root <project> [options]

validate
  --file <zip>              the package to judge          (required)
  --expect-client-ref <id>  refuse a package from a different job
  --json                    machine-readable result
  --quiet                   print only the verdict line

create
  --root <dir>              the project to package        (default .)
  --output <zip>            where to write it             (default a derived name)
  --client-ref <id>         optional caller correlation, [A-Za-z0-9][A-Za-z0-9._-]{0,63}
  --repository <owner/repo> required
  --ref <branch>            required
  --commit <sha40>          required
  --workflow <file.yml>     required
  --run-id <n>              the workflow_run_id the dispatch returned   (required)
  --run-attempt <n>         default 1
  --run-url <url>           default derived from repository and run id
  --html-url <url>          default derived from repository and run id
  --api-version <date>      default ${GITHUB_API_VERSION}

There is no --build-authorized. Authorization is DERIVED from the project's own gate and
review state; a caller supplies identity, never permission.

Exit: 0 valid, 1 invalid, 2 incomplete/unsupported, 3 blocked.
A 0 does not authorize building - read buildAuthorized.
`;

const { flags, positional } = parseFlags(process.argv.slice(2));
const command = positional[0] ?? '';

requireRuntime({ node: true });

const EXIT = Object.freeze({ PASS: 0, FAIL: 1, INCOMPLETE: 2, BLOCKED: 3 });

/**
 * Every flag each command understands. An unknown one is REFUSED, not ignored.
 *
 * `parseFlags` collects whatever it is given, so an unrecognised flag would otherwise sit
 * in the object and be silently skipped. For most typos that is merely unhelpful. For an
 * authorization-shaped flag it is actively misleading: an integrator who writes
 * `--build-authorized true`, sees exit 0 and gets a package back has every reason to
 * believe the option was understood and honoured. It was not, and the package is
 * unauthorized - but they learn that from a field they had no reason to re-read.
 *
 * Refusing costs one line and removes the wrong belief at the moment it forms.
 */
const KNOWN_FLAGS = Object.freeze({
  validate: ['file', 'expect-client-ref', 'json', 'quiet', 'help'],
  create: [
    'root', 'output', 'client-ref', 'repository', 'ref', 'commit', 'workflow',
    'run-id', 'run-attempt', 'run-url', 'html-url', 'api-version', 'help',
  ],
});

/**
 * Flags that do not exist and must never exist. Named individually so the refusal can say
 * WHY rather than only that the spelling is wrong - "unknown option" invites a reader to
 * hunt for the correct spelling of a thing that has no correct spelling.
 */
const REFUSED_FOREVER = Object.freeze([
  'build-authorized', 'buildauthorized', 'authorize', 'authorized',
  'state', 'kind', 'gate-verdict', 'verdict', 'approved', 'force-approve',
]);

// Help before any subcommand is chosen. With no subcommand, a flag no command knows is
// named first: printing only the help left the reader to spot the typo themselves.
if (flags.help || !command) {
  if (!command) {
    const known = new Set(['help', ...Object.values(KNOWN_FLAGS).flat()]);
    for (const flag of Object.keys(flags).filter((f) => !known.has(f))) process.stderr.write(`unknown option --${flag}\n`);
  }
  process.stdout.write(HELP);
  await exitAfterFlush(flags.help ? 0 : 2);
}

async function refuseUnknownFlags(name) {
  const known = new Set(KNOWN_FLAGS[name] ?? []);
  const unknown = Object.keys(flags).filter((flag) => !known.has(flag));
  if (!unknown.length) return;

  for (const flag of unknown) {
    process.stderr.write(`unknown option --${flag}\n`);
    if (REFUSED_FOREVER.includes(flag.toLowerCase())) {
      process.stderr.write('Authorization is derived from the project and cannot be supplied.\n');
    }
  }
  process.stdout.write(HELP);
  await exitAfterFlush(EXIT.BLOCKED);
}

function printResult(result, { json = false, quiet = false } = {}) {
  if (json) {
    // Canonical, so two runs over the same package produce byte-identical output and a
    // consumer can diff or hash it.
    process.stdout.write(`${canonicalJson(result)}\n`);
    return;
  }
  const display = (value) => String(value).replace(/[\x00-\x1f\x7f]/g,
    (character) => `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`);
  const line = `${display(result.status)}  build ${result.buildAuthorized ? 'AUTHORIZED' : 'NOT authorized'}  state=${display(result.state ?? '(unknown)')}`;
  if (!quiet) {
    process.stdout.write(`\npackage  ${display(result.packageId ?? '(unreadable)')}\n`);
    if (result.clientRef) process.stdout.write(`client   ${display(result.clientRef)}\n`);
    if (result.workflowRunId) process.stdout.write(`run      ${display(result.workflowRunId)}\n`);
    if (result.errors.length) {
      process.stdout.write(`\n${result.errors.length} problem(s)\n`);
      for (const e of result.errors) {
        process.stdout.write(`  ${display(e.code)}  ${display(e.message)}\n`);
        if (e.remedy) process.stdout.write(`      fix: ${display(e.remedy)}\n`);
      }
    }
    if (result.status === 'PASS' && !result.buildAuthorized) {
      process.stdout.write('\nThis package is VALID and does NOT authorize building.\n'
        + 'A collected corpus is evidence, not an approved brief. Read README-FIRST.md.\n');
    }
  }
  process.stdout.write(`\n${line}\n`);
}

// A flag given no value is refused by name before anything is read or written (found
// 2026-10-11, #280): parseFlags reads a bare flag as `true`, and the "needs" checks below
// only ask whether a flag is PRESENT. A bare --ref went into the manifest as "true", a bare
// --run-id as Number(true) = 1, a bare --output wrote a package named "true" - and it
// re-validated PASS, so nothing downstream could tell invented provenance from real.
const VALUE_FLAGS = Object.freeze({
  validate: { file: {}, 'expect-client-ref': {} },
  create: {
    root: {}, output: {}, 'client-ref': {}, repository: {}, ref: {}, commit: {}, workflow: {},
    'run-id': { int: true, min: 1 }, 'run-attempt': { int: true, min: 1 },
    'run-url': {}, 'html-url': {}, 'api-version': {},
  },
});

if (command === 'validate') {
  await refuseUnknownFlags('validate');
  checkFlagValues(flags, VALUE_FLAGS.validate, { exit: EXIT.BLOCKED });
  if (!flags.file) { process.stderr.write('validate needs --file <package.zip>\n\n'); process.stdout.write(HELP); await exitAfterFlush(EXIT.BLOCKED); }
  const result = validateArtifact({
    file: String(flags.file),
    expectedClientRef: flags['expect-client-ref'] === undefined ? null : String(flags['expect-client-ref']),
  });
  printResult(result, { json: Boolean(flags.json), quiet: Boolean(flags.quiet) });
  await exitAfterFlush(EXIT[result.status] ?? EXIT.BLOCKED);
}

if (command === 'create') {
  await refuseUnknownFlags('create');
  checkFlagValues(flags, VALUE_FLAGS.create, { exit: EXIT.BLOCKED });
  const required = ['repository', 'ref', 'commit', 'workflow', 'run-id'];
  const missing = required.filter((name) => flags[name] === undefined);
  if (missing.length) {
    process.stderr.write(`create needs ${missing.map((m) => `--${m}`).join(', ')}\n\n`);
    process.stdout.write(HELP);
    await exitAfterFlush(EXIT.BLOCKED);
  }
  const refCheck = checkClientRef(flags['client-ref'] === undefined ? null : String(flags['client-ref']));
  if (!refCheck.ok) { process.stderr.write(`${refCheck.detail}\n`); await exitAfterFlush(EXIT.BLOCKED); }

  const runId = Number(flags['run-id']);
  const root = path.resolve(String(flags.root ?? '.'));
  const output = String(flags.output ?? packageName({ clientRef: refCheck.value, workflowRunId: runId }));

  let written;
  try {
    written = writeArtifact(output, {
      root,
      clientRef: refCheck.value,
      repository: String(flags.repository),
      ref: String(flags.ref),
      commit: String(flags.commit),
      workflow: String(flags.workflow),
      workflowRunId: runId,
      runAttempt: flags['run-attempt'] === undefined ? 1 : Number(flags['run-attempt']),
      runUrl: flags['run-url'] === undefined ? null : String(flags['run-url']),
      htmlUrl: flags['html-url'] === undefined ? null : String(flags['html-url']),
      apiVersion: String(flags['api-version'] ?? GITHUB_API_VERSION),
    });
  } catch (err) {
    process.stderr.write(`could not package ${root}: ${err.message}\n`);
    await exitAfterFlush(EXIT.BLOCKED);
  }

  const size = fs.statSync(written.file).size;
  process.stdout.write(`wrote ${written.file} (${size} bytes, ${written.manifest.files.length} declared files)\n`);
  process.stdout.write(`state ${written.manifest.state}, gate ${written.manifest.gate.verdict}, build ${written.manifest.buildAuthorized ? 'AUTHORIZED' : 'NOT authorized'}\n`);

  // The producer's only claim of correctness, and it is made by the consumer's code.
  if (written.validation.status !== 'PASS') {
    process.stderr.write('\nthe package this run just wrote does NOT validate:\n');
    for (const e of written.validation.errors) process.stderr.write(`  ${e.code}  ${e.message}\n`);
    await exitAfterFlush(EXIT[written.validation.status] ?? EXIT.BLOCKED);
  }
  process.stdout.write('re-validated after writing: PASS\n');
  await exitAfterFlush(EXIT.PASS);
}

process.stderr.write(`unknown command ${JSON.stringify(command)}\n\n`);
process.stdout.write(HELP);
await exitAfterFlush(EXIT.BLOCKED);
