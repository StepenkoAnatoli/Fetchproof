// artifact.mjs - packaging a project into the portable artifact, without changing it.
//
// THE PRODUCER DOES NOT TAKE AUTHORIZATION AS INPUT.
//
// There is no `--build-authorized` flag and there will not be one. Every field that could
// let a consumer start building - `state`, `kind`, `buildAuthorized`, `review.*`, `gate.*`
// - is DERIVED here from the project on disk, by running the kit's own gate and reading
// the kit's own artifacts. A caller supplies identity (which repository, which run) and
// nothing about permission.
//
// The reason is the whole point of the format. A ZIP travels: from a runner to an
// artifact store to somebody's Downloads folder to an agent's working directory. At every
// hop the only thing standing between "evidence was collected" and "you may build" is
// what this manifest says. If a caller could assert it, the assertion would be the
// easiest field in the system to set and the most expensive one to get wrong.
//
// WHAT IS DERIVABLE, AND WHAT IS NOT.
//
// `mapClassified` and `briefReviewed` have honest machine answers: a map row either
// carries a status or it does not, and `briefState` already distinguishes an authored
// brief from a draft with TODOs in it. `findingsReviewed` has no general answer - ADR-0013
// and ADR-0017 record that judging whether an agent reasoned properly would be wrong - but
// it has a specific NEGATIVE one, and that is enough: re-run the extractor over the
// cached capture, and a Finding cell still byte-identical to what the extractor produces
// was demonstrably never rewritten. That detects the unreviewed case without pretending
// to grade the reviewed one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PATHS, resolve, exists, isDirectory, isRegularFile, readText, sha256, canonicalJson, nowIso, listFiles, homeCommand, realInside, writeBytes,
} from './core.mjs';
import { buildZip } from './archive.mjs';
import { checkEntryName } from './artifact-zip.mjs';
import { readCorpus } from './corpus.mjs';
import { deriveState, findingsReviewState } from './artifact-state.mjs';
export { deriveState, findingsReviewState };
import { validateArtifact, MANIFEST_PATH, MANIFEST_DIGEST_PATH, README_PATH } from './artifact-validator.mjs';
import { renderGateWarnings } from './render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(here, '..');

const FORMAT = 'research-kit-artifact';
const FORMAT_VERSION = '2.0.0';
/** The API version this format's `source.workflowRunId` is defined against. */
export const GITHUB_API_VERSION = '2026-03-10';

/** `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` - refused, never silently rewritten. */
const CLIENT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function checkClientRef(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !CLIENT_REF_RE.test(value)) {
    return {
      ok: false,
      // Rewriting a caller's correlation token into something "safe" is the worst of both
      // worlds: the caller polls for a reference the artifact does not carry, and the
      // mismatch surfaces as a missing package rather than as a bad argument.
      detail: `client_ref ${JSON.stringify(String(value))} is not [A-Za-z0-9][A-Za-z0-9._-]{0,63}; refusing rather than rewriting it into something you did not ask for`,
    };
  }
  return { ok: true, value };
}

/**
 * The package name.
 *
 * THE TOPIC IS NEVER IN IT. A filename survives every privacy boundary the contents
 * respect: it appears in an artifact listing that E-08 of the delivery-architecture
 * corpus measured as world-readable on a public repository, in a download manager, in a
 * shared folder. A package about a layoff plan or a medical question must not announce
 * itself before anybody opens it.
 */
export function packageName({ clientRef = null, workflowRunId = null } = {}) {
  const suffix = clientRef ?? (workflowRunId ? `run-${workflowRunId}` : 'local');
  return `research-kit-corpus-v1-${suffix}.zip`;
}

// ---------------------------------------------------------------- roles and media types

const ROLE_BY_PATH = new Map([
  [README_PATH, 'HUMAN_INSTRUCTIONS'],
  ['project/AGENTS.md', 'AGENT_INSTRUCTIONS'],
  ['project/START_HERE.md', 'PROJECT_START'],
  ['project/research/DISCOVERY.md', 'DISCOVERY_CONTRACT'],
  ['project/research/MAP.md', 'RESEARCH_MAP'],
  ['project/research/SOURCES.md', 'SOURCE_REGISTER'],
  ['project/research/EVIDENCE.md', 'EVIDENCE_REGISTER'],
  ['project/research/BRIEF.md', 'RESEARCH_BRIEF'],
  ['project/research/plan.json', 'COLLECTION_PLAN'],
  ['project/research/kit.json', 'KIT_CONFIGURATION'],
  ['project/research/raw/.fetches.jsonl', 'PROVENANCE_LEDGER'],
  ['reports/collection-summary.md', 'COLLECTION_SUMMARY'],
  ['reports/problems.json', 'PROBLEM_REPORT'],
  ['schemas/artifact-manifest.schema.json', 'SCHEMA'],
]);

export function roleOf(zipPath) {
  const known = ROLE_BY_PATH.get(zipPath);
  if (known) return known;
  if (zipPath.startsWith('project/research/raw/')) return 'RAW_CAPTURE';
  if (zipPath.startsWith('schemas/')) return 'SCHEMA';
  return 'OTHER';
}

export function mediaTypeOf(zipPath) {
  if (zipPath.endsWith('.md')) return 'text/markdown';
  if (zipPath.endsWith('.jsonl')) return 'application/x-ndjson';
  if (zipPath.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

// ---------------------------------------------------------------- what travels

/** Never packaged: machine-local state, overrides, credentials, vendor caches. */
export const EXCLUDED = Object.freeze([
  PATHS.usage, PATHS.diagnostics, PATHS.failures, PATHS.lock, PATHS.overrides, PATHS.gateOff,
]);

const EXCLUDED_NAME = /(^|\/)(\.env(\..*)?|\.git|node_modules|\.firecrawl)(\/|$)|\.pem$|\.key$/i;

/** The project files that travel, as POSIX-relative paths, deterministically ordered. */
export function collectProjectFiles(root) {
  const out = [];
  // Links that land outside the project (ADR-0076). Refused, not skipped: a package that
  // silently lacks a file the project has is its own kind of lie.
  const outside = [];
  // Names the ARCHIVE cannot carry faithfully, refused before a byte is written.
  //
  // `lib/archive.mjs` translates a backslash into a path separator, so a file named
  // `a\b.md` was stored as `a/b.md` - a directory invented out of a name - while the
  // manifest went on declaring `a\b.md`. The package contradicted itself, was written,
  // and was refused by its own read-back: in CI that is the collect job failing at the
  // last step, after the credits are spent (found 2026-09-28, break-test). The rule applied
  // here is the CONSUMER's (`checkEntryName`), asked at collection time, for the same reason
  // `writeArtifact` reads its own package back: a package this kit calls good has to be
  // good by the standard of the thing that receives it.
  const refused = [];
  // What the archive cannot READ to an end, refused before a byte is read (found 2026-10-01,
  // break-test): a FIFO under research/raw/ was listed, and packaging blocked forever reading
  // it; and `docs/loop -> .` was walked as docs/loop/loop/... until the OS refused. A folder
  // is judged by its real path against the folders ABOVE it, so a link to a sibling folder
  // inside the project - not a cycle - still packages, as it always did.
  const unreadable = [];
  const above = new Set();
  const walk = (dir, rel) => {
    const real = fs.realpathSync(dir);
    above.add(real);
    for (const name of listFiles(dir).sort()) {
      const childRel = rel ? `${rel}/${name}` : name;
      const abs = path.join(dir, name);
      if (EXCLUDED.includes(childRel)) continue;
      if (EXCLUDED_NAME.test(childRel)) continue;
      if (name === '.gitkeep') continue;
      const verdict = checkEntryName(`project/${childRel}`);
      if (!verdict.ok) { refused.push({ rel: childRel, detail: verdict.detail }); continue; }
      if (!realInside(root, abs)) { outside.push(childRel); continue; }
      if (isDirectory(abs)) {
        if (above.has(fs.realpathSync(abs))) { unreadable.push({ rel: childRel, detail: 'a link back to a folder that contains it' }); continue; }
        walk(abs, childRel);
        continue;
      }
      if (!isRegularFile(abs)) { unreadable.push({ rel: childRel, detail: 'not a regular file - a FIFO, socket or device has no end to read to' }); continue; }
      out.push(childRel);
    }
    above.delete(real);
  };
  for (const rel of ['AGENTS.md', 'START_HERE.md', '.gitattributes', '.gitignore']) {
    const abs = resolve(root, rel);
    if (!exists(abs) || isDirectory(abs)) continue;
    if (!realInside(root, abs)) { outside.push(rel); continue; }
    if (!isRegularFile(abs)) { unreadable.push({ rel, detail: 'not a regular file - a FIFO, socket or device has no end to read to' }); continue; }
    out.push(rel);
  }
  for (const top of ['research', 'docs']) {
    const abs = resolve(root, top);
    if (!isDirectory(abs)) continue;
    if (!realInside(root, abs)) { outside.push(top); continue; }
    walk(abs, top);
  }
  // Two files differing only in case are one file on Windows and macOS. The reader refuses
  // such a package (ZIP-CASE-COLLISION, the same lowercase comparison), but only after it
  // was written - in CI, at the collect job's last step, after the credits were spent
  // (Arena break test 10, 2026-09-28). Asked here, before a byte is written.
  const folded = new Map();
  for (const rel of out) {
    const first = folded.get(rel.toLowerCase());
    if (first === undefined) folded.set(rel.toLowerCase(), rel);
    else if (first !== rel) refused.push({ rel: `${first} and ${rel}`, detail: 'they differ only in case, and on a case-insensitive filesystem one silently overwrites the other' });
  }
  if (refused.length) {
    const err = new Error(`${refused.map((r) => r.rel).join(', ')} cannot travel in a package faithfully: `
      + `${refused.map((r) => r.detail).join('; ')}. `
      + 'Rename the file, then package again - the name is part of what the manifest declares, '
      + 'so the kit refuses rather than substituting another.');
    err.code = 'UNPACKAGEABLE_NAME';
    throw err;
  }
  if (unreadable.length) {
    const err = new Error(`${unreadable.map((u) => `${u.rel} (${u.detail})`).join(', ')}: `
      + 'packaging cannot read this to an end. Replace it with an ordinary file, or remove it, then package again.');
    err.code = 'UNPACKAGEABLE_FILE';
    throw err;
  }
  if (outside.length) {
    const err = new Error(`${outside.join(', ')} ${outside.length === 1 ? 'is a link' : 'are links'} to somewhere outside the project; `
      + 'packaging would copy what is there into the archive. Remove the link, or replace it with the file itself.');
    err.code = 'OUTSIDE_PROJECT';
    throw err;
  }
  // Sorted by the ZIP path so two runs over identical bytes lay the archive out
  // identically. `listFiles().sort()` already orders each directory; this makes the
  // whole inventory's order a property of the names rather than of the walk.
  return [...new Set(out)].sort();
}

// ---------------------------------------------------------------- derived state

// ---------------------------------------------------------------- the human file

/** How README-FIRST names the reviewer. A declaration, so the undeclared case says so. */
const REVIEWER_PROSE = Object.freeze({
  agent: 'reviewed by an agent (as declared in the brief)',
  undeclared: 'reviewed (the brief does not declare by whom)',
});

function renderReadme(derived, source) {
  const { state } = derived;
  if (state === 'APPROVED_BRIEF') {
    return `# APPROVED RESEARCH — BUILDING IS AUTHORIZED

Research-Kit collected this evidence, it was ${REVIEWER_PROSE[derived.review.by]}, and the
gate passed.

${renderGateWarnings(derived.verdict)}

\`manifest.json\` carries \`"state": "APPROVED_BRIEF"\`, \`"buildAuthorized": true\` and
\`"gate": { "verdict": "PASS" }\`. Confirm all three before acting on this package —
this file is prose and the manifest is the contract.

Start by opening:

\`project/research/BRIEF.md\`
`;
  }

  if (state === 'COLLECTION_FAILED') {
    const first = derived.gate.blockingFindings[0];
    return `# COLLECTION STOPPED

Research-Kit did not finish collecting. This package is here so the failure can be
diagnosed; it holds no usable corpus and authorizes nothing.

${renderGateWarnings(derived.verdict)}

${first ? `First blocking finding: ${first.code} — ${first.message}\n` : ''}
See \`reports/problems.json\` for the full list.
`;
  }

  return `# COLLECTED CORPUS — REVIEW REQUIRED

Research-Kit collected evidence successfully.

This package is **not an approved research brief** and does not authorize
an AI or person to begin building.

${renderGateWarnings(derived.verdict)}

The commands below are written for PowerShell, bash and zsh. In cmd.exe, write
\`%USERPROFILE%\` where a command says \`$HOME\`.

## Three required review steps

The agent does them, and declares it in the brief with the line \`Reviewed by: agent\`;
the manifest carries it as \`review.by\`.

1. Review and classify every row in \`project/research/MAP.md\`.
2. Review every finding in \`project/research/EVIDENCE.md\`.
3. From the \`project\` folder, run preflight until it prints PASS, then draft the
   brief and answer its two **TODO** sections in \`project/research/BRIEF.md\`:

\`\`\`
${homeCommand('preflight.mjs')}
${homeCommand('brief.mjs')}
\`\`\`

## Then package the reviewed project

From this folder, the one holding this file:

\`\`\`
${homeCommand('artifact.mjs', repackageArgs(source))}
\`\`\`

It writes \`reviewed.zip\` with the identity of this package and a manifest derived from
the project as it now stands. Building is permitted only when that manifest says all of:

- \`manifest.json\` contains \`"state": "APPROVED_BRIEF"\`
- \`manifest.json\` contains \`"buildAuthorized": true\`
- \`manifest.json\` contains \`"gate": { "verdict": "PASS" }\`

Start by opening:

\`project/START_HERE.md\`
`;
}

/**
 * The \`create\` arguments that re-package a reviewed project under the identity it arrived
 * with. The package said building needs APPROVED_BRIEF, and nothing in it said how a reviewer
 * gets a manifest that says so (found 2026-09-27 on collector run 36300088606). Identity only:
 * the new manifest's state is derived from the project, as every manifest's is.
 */
function repackageArgs({ clientRef, repository, ref, commit, workflow, workflowRunId, runAttempt, apiVersion, runUrl, htmlUrl }) {
  const bare = (value) => (/^[A-Za-z0-9._\/:@+-]+$/.test(String(value)) ? String(value) : `'${String(value)}'`);
  const [owner, name] = String(repository).split('/');
  const args = ['create', '--root project', '--output reviewed.zip',
    `--repository ${bare(repository)}`, `--ref ${bare(ref)}`, `--commit ${bare(commit)}`,
    `--workflow ${bare(workflow)}`, `--run-id ${workflowRunId}`, `--run-attempt ${runAttempt}`];
  if (clientRef) args.push(`--client-ref ${bare(clientRef)}`);
  if (apiVersion !== GITHUB_API_VERSION) args.push(`--api-version ${bare(apiVersion)}`);
  if (runUrl !== `https://api.github.com/repos/${owner}/${name}/actions/runs/${workflowRunId}`) args.push(`--run-url ${bare(runUrl)}`);
  if (htmlUrl !== `https://github.com/${owner}/${name}/actions/runs/${workflowRunId}`) args.push(`--html-url ${bare(htmlUrl)}`);
  return args.join(' ');
}

function renderSummary(derived, manifestish) {
  const c = manifestish.collection;
  const lines = [
    '# Collection summary',
    '',
    `Package \`${manifestish.packageId}\`, written ${manifestish.createdAt}.`,
    '',
    '| | |',
    '|---|---|',
    `| state | \`${derived.state}\` |`,
    `| build authorized | \`${derived.buildAuthorized}\` |`,
    `| gate verdict | \`${derived.gate.verdict}\` |`,
    `| captures | ${c.captures} |`,
    `| credits used | ${c.creditsUsed === null ? 'not recorded' : c.creditsUsed} |`,
    `| fetch provider | ${c.fetchProvider ?? 'none'} |`,
    `| completeness | ${c.completeness} |`,
    '',
    renderGateWarnings(derived.verdict),
    '',
    '## Review state',
    '',
    `- map classified: **${derived.review.mapClassified}**`,
    `- findings reviewed: **${derived.review.findingsReviewed}**${derived.unrewritten.length ? ` — still carrying the extractor's own words: ${derived.unrewritten.join(', ')}` : ''}`,
    `- brief reviewed: **${derived.review.briefReviewed}**`,
    `- reviewed by: **${derived.review.by}** (the reviewer's declaration in BRIEF.md; not verified)`,
    '',
  ];
  if (derived.gate.blockingFindings.length) {
    lines.push('## Blocking findings', '');
    for (const f of derived.gate.blockingFindings) lines.push(`- \`${f.code}\` — ${f.message}`);
    lines.push('');
  }
  lines.push(
    '## What this file is not',
    '',
    'A summary is not a verdict. `manifest.json` is the machine-readable contract, and a',
    'consumer that disagrees with this page should believe the manifest.',
    '',
  );
  return lines.join('\n');
}

function renderProblems(derived) {
  return `${canonicalJson({
    state: derived.state,
    buildAuthorized: derived.buildAuthorized,
    gateVerdict: derived.gate.verdict,
    blockingFindings: derived.gate.blockingFindings,
    corpusProblems: (derived.corpus.problems ?? []).map((p) => ({
      kind: String(p.kind ?? ''), artifact: String(p.artifact ?? ''), detail: String(p.detail ?? ''),
    })),
    handoff: {
      ok: derived.handoff.ok,
      entries: derived.handoff.entries,
      findings: derived.handoff.findings.filter((f) => f.severity === 'fail').map((f) => ({ name: f.name, detail: f.detail })),
    },
    unrewrittenFindings: derived.unrewritten,
  })}\n`;
}

// ---------------------------------------------------------------- producing

/**
 * `createArtifact({ root, ... })` -> `{ bytes, name, manifest, validation }`.
 *
 * Returns the archive rather than writing it, so the CLI owns where bytes land and the
 * tests never need a temp file to exercise the producer.
 */
export function createArtifact({
  root,
  clientRef = null,
  repository,
  ref,
  commit,
  workflow,
  workflowRunId,
  runAttempt = 1,
  runUrl = null,
  htmlUrl = null,
  apiVersion = GITHUB_API_VERSION,
  platform = `${process.platform}-${process.arch}`,
  runtime = `node-${process.versions.node.split('.')[0]}`,
  producerVersion = FORMAT_VERSION,
  createdAt = nowIso(),
  kitRoot = KIT_ROOT,
  env = {},
} = {}) {
  const refCheck = checkClientRef(clientRef);
  if (!refCheck.ok) throw new Error(refCheck.detail);
  const safeRef = refCheck.value;

  if (!root || !isDirectory(root)) throw new Error(`no project at ${root}`);
  if (!Number.isInteger(workflowRunId) || workflowRunId < 1) {
    throw new Error('workflowRunId is required and must be the integer the dispatch response returned (pin X-GitHub-Api-Version: 2026-03-10 and read workflow_run_id)');
  }

  // The identity is checked against the manifest schema's own rules BEFORE anything is
  // derived or written: `create --commit abc` wrote the package, then reported that the package
  // it had just written did not validate, and left it on disk (found 2026-09-27).
  const identityProblem = sourceProblem(kitRoot, {
    repository, ref, commit, workflow, apiVersion, workflowRunId,
    runUrl: runUrl ?? `https://api.github.com/repos/${repository}/actions/runs/${workflowRunId}`,
    htmlUrl: htmlUrl ?? `https://github.com/${repository}/actions/runs/${workflowRunId}`,
    runAttempt,
  });
  if (identityProblem) throw new Error(identityProblem);

  const derived = deriveState(root, { env });
  const corpus = derived.corpus;

  const owner = String(repository ?? '').split('/')[0] || 'OWNER';
  const repoName = String(repository ?? '').split('/')[1] || 'REPO';
  const resolvedRunUrl = runUrl ?? `https://api.github.com/repos/${owner}/${repoName}/actions/runs/${workflowRunId}`;
  const resolvedHtmlUrl = htmlUrl ?? `https://github.com/${owner}/${repoName}/actions/runs/${workflowRunId}`;

  // ---- payload ------------------------------------------------------------------
  const entries = [];
  const add = (zipPath, data) => entries.push({ name: zipPath, data: Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8') });

  for (const rel of collectProjectFiles(root)) {
    add(`project/${rel}`, fs.readFileSync(resolve(root, rel)));
  }

  const ledgerAbs = resolve(root, PATHS.ledger);
  if (exists(ledgerAbs) && !realInside(root, ledgerAbs)) {
    const err = new Error(`${PATHS.ledger} is a link to somewhere outside the project; packaging would copy what is there into the archive.`);
    err.code = 'OUTSIDE_PROJECT';
    throw err;
  }
  if (exists(ledgerAbs) && !entries.some((e) => e.name === `project/${PATHS.ledger}`)) {
    // The ledger is a dotfile inside research/raw/ and every hand-rolled copy in this
    // project's history has lost exactly this file. Added explicitly rather than trusted
    // to the walk.
    add(`project/${PATHS.ledger}`, fs.readFileSync(ledgerAbs));
  }

  const captures = (corpus.evidence ?? []).filter((r) => r.raw).length;
  const partial = (corpus.captures?.entries ?? []).filter((c) => c.completeness && c.completeness !== 'full').length;
  const total = (corpus.captures?.entries ?? []).length;

  const collection = {
    result: derived.state === 'COLLECTION_FAILED' ? 'FAILED' : partial > 0 ? 'PARTIAL' : 'SUCCEEDED',
    fetchProvider: transportOf(corpus) ?? null,
    searchProvider: transportOf(corpus) ?? null,
    captures,
    creditsUsed: null,        // the usage log is machine-local and never travels; see EXCLUDED
    completeness: total === 0 ? 'NONE' : partial === 0 ? 'FULL' : 'PARTIAL',
    startedAt: createdAt,
    finishedAt: createdAt,
  };

  const packageId = `RK-${sha256(Buffer.from(`${repository}:${workflowRunId}:${runAttempt}:${createdAt}`, 'utf8')).slice(0, 26).toUpperCase()}`;

  const shell = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    packageId,
    clientRef: safeRef,
    createdAt,
    kind: derived.kind,
    state: derived.state,
    buildAuthorized: derived.buildAuthorized,
    topic: String(corpus.map?.topic || corpus.plan?.topic || 'Untitled topic').slice(0, 4096),
    producer: { name: 'research-kit', version: producerVersion, platform, runtime },
    source: {
      repository: String(repository), ref: String(ref), commit: String(commit), workflow: String(workflow),
      apiVersion: String(apiVersion), workflowRunId, runUrl: resolvedRunUrl, htmlUrl: resolvedHtmlUrl, runAttempt,
    },
    collection,
    review: derived.review,
    gate: derived.gate,
    nextActions: nextActionsFor(derived),
    privacy: {
      containsResearchTopic: true,
      containsCollectedPages: captures > 0,
      containsSecrets: false,       // asserted, then PROVEN by the validation pass below
      safeForPublicDistribution: false,
    },
    files: [],
  };

  add(README_PATH, renderReadme(derived, { ...shell.source, clientRef: safeRef }));
  add('reports/collection-summary.md', renderSummary(derived, { ...shell, collection }));
  add('reports/problems.json', renderProblems(derived));
  add('schemas/artifact-manifest.schema.json', fs.readFileSync(path.join(kitRoot, 'schemas', 'artifact-manifest.schema.json')));

  // ---- inventory, then manifest, then digest, in that order ------------------------
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  shell.files = entries.map((e) => ({
    path: e.name,
    role: roleOf(e.name),
    mediaType: mediaTypeOf(e.name),
    byteLength: e.data.length,
    sha256: sha256(e.data),
  }));

  const manifestBytes = Buffer.from(`${canonicalJson(shell)}\n`, 'utf8');
  const digestBytes = Buffer.from(`${sha256(manifestBytes)}  manifest.json\n`, 'utf8');
  entries.push({ name: MANIFEST_PATH, data: manifestBytes });
  entries.push({ name: MANIFEST_DIGEST_PATH, data: digestBytes });

  const bytes = buildZip(entries);
  const name = packageName({ clientRef: safeRef, workflowRunId });

  return { bytes, name, manifest: shell, entries, derived };
}

/** The first `source` field the manifest schema would reject, as a sentence - or null. */
function sourceProblem(kitRoot, source) {
  const schema = JSON.parse(fs.readFileSync(path.join(kitRoot, 'schemas', 'artifact-manifest.schema.json'), 'utf8'));
  for (const [key, rule] of Object.entries(schema.properties.source.properties)) {
    const value = source[key];
    const r = rule.$ref ? { type: 'string', pattern: '^https://' } : rule;
    if (r.type === 'integer' && !(Number.isInteger(value) && value >= (r.minimum ?? -Infinity))) {
      return `source.${key} must be a whole number${r.minimum !== undefined ? ` of at least ${r.minimum}` : ''}, not ${JSON.stringify(value)}`;
    }
    if (r.type === 'string') {
      if (typeof value !== 'string' || value.length < (r.minLength ?? 0)) return `source.${key} must be a non-empty string, not ${JSON.stringify(value)}`;
      if (r.pattern && !new RegExp(r.pattern).test(value)) return `source.${key} must match ${r.pattern}, not ${JSON.stringify(value)}`;
    }
  }
  return null;
}

function transportOf(corpus) {
  const entries = corpus.ledger?.entries ?? [];
  for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i].transport) return entries[i].transport;
  return null;
}

function nextActionsFor(derived) {
  if (derived.state === 'APPROVED_BRIEF') {
    return [{ id: 'READ_BRIEF', label: 'Read the approved brief and begin building', path: 'project/research/BRIEF.md', required: true }];
  }
  if (derived.state === 'COLLECTION_FAILED') {
    return [{ id: 'READ_PROBLEMS', label: 'Read what stopped the collection', path: 'reports/problems.json', required: true }];
  }
  const out = [];
  if (!derived.review.mapClassified) out.push({ id: 'CLASSIFY_MAP', label: 'Review and classify the research map', path: 'project/research/MAP.md', required: true });
  if (!derived.review.findingsReviewed) out.push({ id: 'REVIEW_FINDINGS', label: 'Rewrite collected findings into defensible claims', path: 'project/research/EVIDENCE.md', required: true });
  if (!derived.review.briefReviewed) out.push({ id: 'REVIEW_BRIEF', label: 'Run preflight and review the final brief', path: 'project/research/BRIEF.md', required: true });
  if (!out.length) out.push({ id: 'RUN_PREFLIGHT', label: 'Close the remaining blocking findings, then re-run preflight', path: 'project/research/DISCOVERY.md', required: true });
  return out;
}

/**
 * Write the artifact, then READ IT BACK through the validator before saying it worked.
 *
 * A producer that reports success from its own intentions has tested nothing. This is the
 * only claim of correctness the CLI makes, and it is made by the same code a consumer
 * will run - so a package this repository calls good is good by the consumer's standard,
 * not by the producer's.
 */
export function writeArtifact(outFile, options) {
  const built = createArtifact(options);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  // Whole or not at all (ADR-0079), and it matters more here than anywhere: this is the
  // package a workflow uploads and a builder consumes, and re-creating it at a name that
  // already holds one must never trade a good package for a truncated one (2026-09-28).
  writeBytes(outFile, built.bytes);
  const validation = validateArtifact({ file: outFile, expectedClientRef: built.manifest.clientRef ?? null });
  return { ...built, file: outFile, validation };
}
