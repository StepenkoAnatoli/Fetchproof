---
url: https://raw.githubusercontent.com/StepenkoAnatoli/Research-Kit/3fa03fa1749d591af9cd7197e1c09f66ffacd231/research-kit/lib/artifact-validator.mjs
retrieved: 2026-10-13
command: http-keyless scrape https://raw.githubusercontent.com/StepenkoAnatoli/Research-Kit/3fa03fa1749d591af9cd7197e1c09f66ffacd231/research-kit/lib/artifact-validator.mjs
statusCode: 200
transport: http-keyless
completeness: full
---
// artifact-validator.mjs - is this package internally valid, and does it authorize a build?
//
// THOSE ARE TWO QUESTIONS AND THIS MODULE KEEPS THEM APART.
//
// `status: 'PASS'` means the container is safe, the manifest matches its digest, every
// declared file is present with the bytes it claims, and the provenance chain verifies.
// It says NOTHING about whether anybody may start building. That is `buildAuthorized`,
// and a caller must read it separately - which is why the two are sibling fields rather
// than one verdict. A collected corpus that is perfectly valid still forbids building,
// and the most likely misuse of this format is an agent reading PASS and starting work.
//
// WHAT THIS MODULE MAY NOT DO, and each of these is enforced by construction rather than
// by intention:
//
//   - no network: nothing here imports a transport, and the only I/O is on the file the
//     caller named plus a temp directory this module creates
//   - no credentials: `process.env` is never read
//   - no execution: the ZIP is parsed as data; nothing from it is imported or spawned
//   - no shell
//   - no write outside a private `fs.mkdtemp` directory, removed in a `finally`
//   - the source artifact is opened read-only and never modified
//
// The one thing it does write is a materialised copy of `project/`, because the ledger
// and handoff checks are the kit's existing code and they read a project from disk.
// Rewriting them to read from buffers would mean two implementations of provenance
// verification, and the second one would be the one nobody tested against a real corpus.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, tempBase, looksBinary } from './core.mjs';
import { openZip, ZipError, ZIP_LIMITS } from './artifact-zip.mjs';
import { parseJsonNoDuplicates } from './release/json.mjs';
import { validateJsonSchema } from './release/schema.mjs';
import { readCorpus } from './corpus.mjs';
import { verifyHandoff } from './handoff.mjs';
import { SECRET_PATTERNS } from './doctor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(here, '..');

export const MANIFEST_PATH = 'manifest.json';
export const MANIFEST_DIGEST_PATH = 'manifest.sha256';
export const README_PATH = 'README-FIRST.md';
const LEDGER_PATH = 'project/research/raw/.fetches.jsonl';

/** The major version this validator implements. A different major is UNSUPPORTED, not invalid. */
export const SUPPORTED_FORMAT_MAJOR = 2;
// 1.x packages stay readable (ADR-0107): 2.0.0 only renamed HUMAN_REVIEW_REQUIRED and retired
// the `human` reviewer, so a package made before is still a package this kit produced.
export const OLDEST_FORMAT_MAJOR = 1;

/** Files a package must never carry. Machine-local state, overrides, and credentials. */
const FORBIDDEN_PAYLOAD = Object.freeze([
  'project/research/raw/.usage.jsonl',
  'project/research/raw/.diagnostics.jsonl',
  'project/research/raw/.failures.jsonl',
  'project/research/raw/.fetches.lock',
  'project/research/overrides.log',
  'project/research/GATE_OFF',
]);

/** Secret-bearing filenames, refused by NAME as well as by content. */
const FORBIDDEN_NAME = /(^|\/)\.env(\.|$)|\.pem$|\.key$/i;

function loadArtifactSchema(root = KIT_ROOT) {
  const file = path.join(root, 'schemas', 'artifact-manifest.schema.json');
  return parseJsonNoDuplicates(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------- findings

function problem(code, message, { path: at = null, remedy = null } = {}) {
  // `path` is always the ZIP-relative name so a caller can point at the entry. A value
  // NEVER appears here: the secret checks report which pattern matched and where, and
  // an error that quotes the match would copy the credential into every log that prints
  // the report - which is the thing the check exists to prevent.
  return { code, message, path: at, remedy };
}

/** Worst-first, so `errors[0]` is the thing to tell a human. */
const SEVERITY = Object.freeze({ BLOCKED: 3, FAIL: 2, INCOMPLETE: 1, PASS: 0 });

function worse(a, b) { return SEVERITY[a] >= SEVERITY[b] ? a : b; }

// ---------------------------------------------------------------- the check

/**
 * `validateArtifact({ file, expectedClientRef })` -> a structured result.
 *
 * Never throws for a bad package: an unreadable or hostile artifact is a finding, not an
 * exception, because every caller of this function is deciding whether to trust something
 * and a thrown error is the easiest thing in the world to catch and ignore.
 */
export function validateArtifact({
  file,
  expectedClientRef = null,
  limits = ZIP_LIMITS,
  schema = null,
  tempRoot = tempBase(),
} = {}) {
  const errors = [];
  const warnings = [];
  let status = 'PASS';
  let manifest = null;
  let workdir = null;

  const reject = (verdict, ...args) => { status = worse(status, verdict); errors.push(problem(...args)); };

  try {
    if (!file) {
      reject('BLOCKED', 'ZIP-READ', 'no artifact file was given', { remedy: 'pass --file <package.zip>' });
      return report();
    }

    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch (err) {
      reject('BLOCKED', 'ZIP-READ', `could not read ${path.basename(String(file))}: ${err.code ?? err.message}`,
        { remedy: 'check the path, and that the download completed' });
      return report();
    }

    // ---- container -------------------------------------------------------------
    let zip;
    try {
      zip = openZip(bytes, { limits });
    } catch (err) {
      const code = err instanceof ZipError ? err.code : 'ZIP-READ';
      reject('FAIL', code, err.message, { path: err?.entry ?? null, remedy: 'download the artifact again, or regenerate it from the original corpus' });
      return report();
    }
    if (zip.problems.length) {
      // Structural faults stop everything: nothing below may inflate an entry from a
      // container that has already been shown to lie about its own shape.
      for (const p of zip.problems) {
        reject('FAIL', p.code, p.detail, { path: p.path ?? null, remedy: 'this package is not safe to extract; regenerate it from the original corpus' });
      }
      return report();
    }

    // ---- manifest and its digest ------------------------------------------------
    if (!zip.has(MANIFEST_PATH)) {
      reject('FAIL', 'MANIFEST-MISSING', `${MANIFEST_PATH} is not in the package`,
        { path: MANIFEST_PATH, remedy: 'this is not a Research-Kit artifact; regenerate it with `artifact.mjs create`' });
      return report();
    }
    if (!zip.has(MANIFEST_DIGEST_PATH)) {
      reject('FAIL', 'MANIFEST-HASH-MISSING', `${MANIFEST_DIGEST_PATH} is not in the package`,
        { path: MANIFEST_DIGEST_PATH, remedy: 'without the digest the manifest cannot be shown to be the one that was written' });
      return report();
    }

    const manifestBytes = zip.read(MANIFEST_PATH);
    const digestText = zip.read(MANIFEST_DIGEST_PATH).toString('utf8');
    const declared = (digestText.match(/^([0-9a-f]{64})\s{1,2}manifest\.json\s*$/m) ?? [])[1] ?? null;
    const actual = sha256(manifestBytes);
    if (!declared) {
      reject('FAIL', 'MANIFEST-HASH-MISSING', `${MANIFEST_DIGEST_PATH} does not hold a "<sha256>  manifest.json" line`,
        { path: MANIFEST_DIGEST_PATH, remedy: 'regenerate the artifact' });
      return report();
    }
    if (declared !== actual) {
      // Said before the manifest is parsed, deliberately. A manifest whose digest does
      // not match is not a manifest to reason about - its contents are exactly what an
      // attacker would have edited.
      reject('FAIL', 'MANIFEST-HASH-MISMATCH', `${MANIFEST_PATH} does not match the digest in ${MANIFEST_DIGEST_PATH}`,
        { path: MANIFEST_PATH, remedy: 'the manifest was modified after it was written; download the artifact again or regenerate it' });
      return report();
    }

    try {
      manifest = parseJsonNoDuplicates(manifestBytes.toString('utf8'));
    } catch (err) {
      const duplicate = /duplicate object key/.test(err.message);
      reject('FAIL', duplicate ? 'MANIFEST-DUPLICATE-KEY' : 'MANIFEST-JSON',
        `${MANIFEST_PATH} ${duplicate ? 'contains a duplicate key' : 'is not valid JSON'}: ${err.message}`,
        { path: MANIFEST_PATH, remedy: 'regenerate the artifact' });
      return report();
    }

    // ---- format version, before schema ------------------------------------------
    // An unsupported MAJOR is reported distinctly from an invalid manifest: a v2 package
    // is probably correct and simply newer than this reader, and calling that "invalid"
    // would send somebody hunting a corruption that is not there.
    const version = String(manifest?.formatVersion ?? '');
    const major = Number(version.split('.')[0]);
    if (manifest?.format !== 'research-kit-artifact') {
      reject('FAIL', 'MANIFEST-SCHEMA', `${MANIFEST_PATH} does not declare format "research-kit-artifact"`,
        { path: MANIFEST_PATH, remedy: 'this is not a Research-Kit artifact' });
      return report();
    }
    if (!Number.isInteger(major) || major < OLDEST_FORMAT_MAJOR || major > SUPPORTED_FORMAT_MAJOR) {
      reject('INCOMPLETE', 'FORMAT-UNSUPPORTED',
        `this package declares format version ${version || '(none)'}; this validator reads majors ${OLDEST_FORMAT_MAJOR} to ${SUPPORTED_FORMAT_MAJOR}`,
        { path: MANIFEST_PATH, remedy: `upgrade Research-Kit to a version that reads format ${major || '?'}.x` });
      return report();
    }

    // ---- schema ------------------------------------------------------------------
    const schemaDoc = schema ?? loadArtifactSchema();
    const schemaErrors = validateJsonSchema(manifest, schemaDoc);
    for (const e of schemaErrors) {
      reject('FAIL', 'MANIFEST-SCHEMA', `${e.path}: ${e.message}`, { path: MANIFEST_PATH, remedy: 'regenerate the artifact' });
    }
    if (schemaErrors.length) {
      // The schema already refuses a false authorization claim through its if/then/else,
      // and reports it as `$.buildAuthorized: must equal false` - true, generic, and no
      // use to somebody deciding whether they have just been handed a forged permission.
      //
      // So the authorization rule is ALSO run here and named in its own words before
      // returning. The one rule the whole format exists to carry should never reach a
      // reader disguised as a schema detail, whichever check happened to notice first.
      checkAuthorization();
      return report();
    }

    // Each major carries its own names (ADR-0107). The schema lists both eras' values, so the
    // pairing is checked here, where the message can say which name belongs to which format.
    for (const problem of eraProblems(manifest, major)) {
      reject('FAIL', 'MANIFEST-SCHEMA', problem, { path: MANIFEST_PATH, remedy: 'regenerate the artifact' });
    }

    // ---- correlation --------------------------------------------------------------
    if (expectedClientRef !== null && expectedClientRef !== undefined) {
      if (manifest.clientRef !== expectedClientRef) {
        reject('FAIL', 'CLIENT-REF-MISMATCH',
          `this package carries clientRef ${JSON.stringify(manifest.clientRef)}, not ${JSON.stringify(expectedClientRef)}`,
          { path: MANIFEST_PATH, remedy: 'you are holding a different job\'s artifact; check source.workflowRunId against the run you dispatched' });
      }
    }

    // ---- the file inventory --------------------------------------------------------
    const declaredFiles = manifest.files ?? [];
    const byPath = new Map();
    for (const entry of declaredFiles) {
      if (byPath.has(entry.path)) {
        reject('FAIL', 'FILE-DUPLICATE', `${entry.path} is declared more than once in the manifest`, { path: entry.path, remedy: 'regenerate the artifact' });
        continue;
      }
      byPath.set(entry.path, entry);
      if (entry.path === MANIFEST_PATH || entry.path === MANIFEST_DIGEST_PATH) {
        reject('FAIL', 'FILE-DUPLICATE',
          `${entry.path} must not appear in "files" - the manifest cannot carry its own digest and stay correct about it`,
          { path: entry.path, remedy: 'regenerate the artifact' });
      }
    }

    const payload = zip.names.filter((n) => n !== MANIFEST_PATH && n !== MANIFEST_DIGEST_PATH);
    for (const name of payload) {
      if (byPath.has(name)) continue;
      reject('FAIL', 'FILE-UNDECLARED', `${name} is in the package but not declared in the manifest`,
        { path: name, remedy: 'every payload file must be declared; regenerate the artifact' });
    }
    for (const [name] of byPath) {
      if (name === MANIFEST_PATH || name === MANIFEST_DIGEST_PATH) continue;
      if (zip.has(name)) continue;
      reject('FAIL', 'FILE-MISSING', `${name} is declared in the manifest but is not in the package`,
        { path: name, remedy: 'the package is incomplete; regenerate it from the original corpus' });
    }

    for (const name of FORBIDDEN_PAYLOAD) {
      if (!zip.has(name)) continue;
      reject('FAIL', 'FILE-UNDECLARED', `${name} must never be packaged - it is machine-local state, not evidence`,
        { path: name, remedy: 'regenerate the artifact with a producer that excludes it' });
    }
    for (const name of payload) {
      if (!FORBIDDEN_NAME.test(name)) continue;
      reject('FAIL', 'SECRET-DETECTED', `${name} is a credential file by name and must never be packaged`,
        { path: name, remedy: 'rotate anything this package may have exposed, then regenerate the artifact' });
    }

    // ---- bytes ---------------------------------------------------------------------
    const bodies = new Map();
    for (const [name, entry] of byPath) {
      if (!zip.has(name)) continue;
      let body;
      try {
        body = zip.read(name);
      } catch (err) {
        reject('FAIL', 'ZIP-READ', `${name} could not be read: ${err.message}`, { path: name, remedy: 'download the artifact again' });
        continue;
      }
      bodies.set(name, body);
      if (body.length !== entry.byteLength) {
        reject('FAIL', 'FILE-SIZE-MISMATCH', `${name} is ${body.length} bytes; the manifest declares ${entry.byteLength}`,
          { path: name, remedy: 'download the artifact again or regenerate it from the original corpus' });
        continue;
      }
      if (sha256(body) !== entry.sha256) {
        reject('FAIL', 'FILE-HASH-MISMATCH', `${name} does not match its declared SHA-256.`,
          { path: name, remedy: 'download the artifact again or regenerate it from the original corpus' });
      }
      if (typeof entry.mediaType !== 'string' || entry.mediaType.trim() === '') {
        reject('FAIL', 'MANIFEST-SCHEMA', `${name} declares an empty mediaType`, { path: name, remedy: 'regenerate the artifact' });
      }
    }

    // ---- secrets, by content ---------------------------------------------------------
    // A finding here is a FAIL rather than a warning. A package that carries a credential
    // has already been written to a runner's disk and an artifact store; treating that as
    // advisory would let it be forwarded while somebody decides.
    for (const [name, body] of bodies) {
      if (body.length > 512 * 1024) continue;
      // A binary body is outside the scan, as a large one is (ADR-0128): `docs/` travels
      // whole, and one vendored DLL carrying the PEM marker it parses had the patterns
      // failing a package with no secret in it.
      if (looksBinary(body)) continue;
      let text;
      try { text = body.toString('utf8'); } catch { continue; }
      for (const pattern of SECRET_PATTERNS) {
        const match = pattern.re.exec(text);
        if (!match) continue;
        const line = text.slice(0, match.index).split('\n').length;
        reject('FAIL', 'SECRET-DETECTED',
          `${name}:${line} matches the ${pattern.name} credential pattern`,
          { path: name, remedy: 'treat the credential as compromised and rotate it, then regenerate the artifact without it' });
      }
    }
    if (manifest.privacy?.containsSecrets === true) {
      reject('FAIL', 'SECRET-DETECTED', 'the manifest declares privacy.containsSecrets: true',
        { path: MANIFEST_PATH, remedy: 'a package that knows it carries a secret must not be distributed; rotate and regenerate' });
    }

    // ---- authorization consistency -----------------------------------------------------
    checkAuthorization();

    // ---- provenance -----------------------------------------------------------------
    const ledgerRoles = declaredFiles.filter((f) => f.role === 'PROVENANCE_LEDGER');
    if (ledgerRoles.length > 1) {
      reject('FAIL', 'LEDGER-INVALID', `the manifest declares ${ledgerRoles.length} files with role PROVENANCE_LEDGER; there is exactly one chain`,
        { path: MANIFEST_PATH, remedy: 'regenerate the artifact' });
    } else if (ledgerRoles.length === 1 && ledgerRoles[0].path !== LEDGER_PATH) {
      reject('FAIL', 'LEDGER-INVALID', `the provenance ledger is declared at ${ledgerRoles[0].path}; it must be ${LEDGER_PATH}`,
        { path: ledgerRoles[0].path, remedy: 'regenerate the artifact' });
    }

    // The ledger is required when the package CLAIMS EVIDENCE, not merely when it carries
    // a project directory.
    //
    // A COLLECTION_FAILED package is the case that makes the distinction necessary: it is
    // a scaffolded project and a problem report, collected nothing, and has no chain
    // because there was nothing to chain. Demanding a ledger there would refuse the one
    // package shape whose entire purpose is to carry a diagnosis home, and would do it
    // with a message implying evidence went missing when none was ever fetched.
    //
    // So the trigger is a claim: a declared RAW_CAPTURE, or a manifest asserting captures.
    // Either of those says "there is evidence in here", and evidence without its chain is
    // exactly what this format refuses to let travel.
    const claimsEvidence = declaredFiles.some((f) => f.role === 'RAW_CAPTURE')
      || (manifest.collection?.captures ?? 0) > 0;
    if (claimsEvidence) {
      if (!zip.has(LEDGER_PATH)) {
        reject('FAIL', 'LEDGER-MISSING', `${LEDGER_PATH} is not in the package, but the package claims collected evidence - a corpus without its chain proves nothing`,
          { path: LEDGER_PATH, remedy: 'the ledger is a dotfile; a producer that copied the corpus by hand probably skipped it' });
      } else if (!errors.some((e) => e.code === 'FILE-HASH-MISMATCH' || e.code === 'FILE-SIZE-MISMATCH')) {
        // Only materialise once the declared bytes are known to be the packaged bytes.
        // Running the chain check over content that already failed its own digest would
        // report a second, derived failure and bury the first.
        workdir = fs.mkdtempSync(path.join(tempRoot, 'rk-artifact-'));
        const projectRoot = materializeProject(workdir, bodies);
        for (const finding of provenanceProblems(projectRoot)) reject('FAIL', finding.code, finding.message, finding);
      }
    }

    return report();
  } catch (err) {
    // Any unexpected throw is BLOCKED, never PASS. A validator that cannot finish has not
    // approved anything, and the one failure mode that must not exist is a crash being
    // read as a clean result.
    reject('BLOCKED', 'ZIP-READ', `validation could not complete: ${err.message}`,
      { remedy: 'report this package and its Research-Kit version' });
    return report();
  } finally {
    if (workdir) { try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* a temp dir that will not go is the OS's business */ } }
  }

  /** Called on both routes out - schema-refused and schema-clean - so the wording cannot drift. */
  function checkAuthorization() {
    for (const finding of authorizationProblems(manifest)) {
      reject('FAIL', 'AUTHORIZATION-INCONSISTENT', finding,
        { path: MANIFEST_PATH, remedy: 'do not build from this package; its authorization fields contradict its review and gate state' });
    }
  }

  function report() {
    // `buildAuthorized` is false unless the package says true AND nothing was wrong with
    // it. A failed package cannot authorize a build however its fields read.
    const claimed = manifest?.buildAuthorized === true;
    return {
      status,
      buildAuthorized: status === 'PASS' && claimed,
      packageId: manifest?.packageId ?? null,
      clientRef: manifest?.clientRef ?? null,
      workflowRunId: manifest?.source?.workflowRunId ?? null,
      // A 1.x package's HUMAN_REVIEW_REQUIRED is reported under its 2.0.0 name, so a consumer
      // switches on one state whichever format it was handed (ADR-0107).
      state: manifest?.state === 'HUMAN_REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : (manifest?.state ?? null),
      // The reviewer's own declaration (format 1.1.0, ADR-0074); a 1.0.0 package has none.
      reviewedBy: manifest?.review?.by ?? 'undeclared',
      errors,
      warnings,
    };
  }
}

// ---------------------------------------------------------------- format eras

/** Values that belong to the other major (ADR-0107), each named with the one that belongs here. */
function eraProblems(manifest, major) {
  const out = [];
  if (major >= 2 && manifest?.state === 'HUMAN_REVIEW_REQUIRED') {
    out.push('state HUMAN_REVIEW_REQUIRED was renamed REVIEW_REQUIRED in format 2.0.0; a 2.x package cannot carry the old name');
  }
  if (major >= 2 && manifest?.review?.by === 'human') {
    out.push('review.by "human" was retired in format 2.0.0: the review is the agent\'s, and a 2.x package declares "agent" or "undeclared"');
  }
  if (major < 2 && manifest?.state === 'REVIEW_REQUIRED') {
    out.push('state REVIEW_REQUIRED is a format 2.0.0 name; a 1.x package says HUMAN_REVIEW_REQUIRED');
  }
  return out;
}

// ---------------------------------------------------------------- authorization

/**
 * The central rule of this format, in one function so it has one implementation.
 *
 * An AI or application may build only when
 *   state === 'APPROVED_BRIEF' && gate.verdict === 'PASS' && buildAuthorized === true
 * and every supporting field agrees. The schema already refuses most of these through
 * if/then/else; this repeats them because a manifest is checked by more than the schema,
 * and the one rule the whole format exists to carry should not live only in a JSON file.
 */
export function authorizationProblems(manifest) {
  const out = [];
  const approved = manifest.state === 'APPROVED_BRIEF';
  const claims = manifest.buildAuthorized === true || manifest.gate?.buildAuthorized === true;

  if (!approved && claims) {
    out.push(`state is ${manifest.state} but an authorization field is true; only APPROVED_BRIEF may authorize a build`);
    return out;
  }
  if (!approved) return out;

  const required = [
    [manifest.kind === 'APPROVED_RESEARCH', `kind is ${manifest.kind}, but an approved brief must be APPROVED_RESEARCH`],
    [manifest.buildAuthorized === true, 'state is APPROVED_BRIEF but buildAuthorized is not true'],
    [manifest.review?.mapClassified === true, 'the research map has not been classified'],
    [manifest.review?.findingsReviewed === true, 'the collected findings have not been reviewed'],
    [manifest.review?.briefReviewed === true, 'the brief has not been reviewed'],
    [manifest.gate?.verdict === 'PASS', `the gate verdict is ${manifest.gate?.verdict}, not PASS`],
    [manifest.gate?.buildAuthorized === true, 'gate.buildAuthorized is not true'],
    [(manifest.gate?.blockingFindings ?? []).length === 0, `the gate records ${(manifest.gate?.blockingFindings ?? []).length} blocking finding(s)`],
  ];
  for (const [ok, message] of required) if (!ok) out.push(message);
  return out;
}

// ---------------------------------------------------------------- provenance

/** Write `project/` out of the buffers, and nothing else. */
function materializeProject(workdir, bodies) {
  const projectRoot = path.join(workdir, 'project');
  for (const [name, body] of bodies) {
    if (!name.startsWith('project/')) continue;
    const rel = name.slice('project/'.length);
    const target = path.join(projectRoot, ...rel.split('/'));
    // Belt and braces. `checkEntryName` already refused every traversal, but this is the
    // one place bytes become a filesystem path, and a containment check here costs one
    // comparison and removes the need to trust a check made three hundred lines earlier.
    const resolved = path.resolve(target);
    if (resolved !== path.resolve(projectRoot) && !resolved.startsWith(path.resolve(projectRoot) + path.sep)) {
      throw new Error(`refusing to write ${name} outside the temporary project directory`);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, body);
  }
  return projectRoot;
}

/** Reuse the kit's own chain and handoff logic rather than reimplementing either. */
function provenanceProblems(projectRoot) {
  const out = [];
  let corpus;
  try {
    corpus = readCorpus(projectRoot);
  } catch (err) {
    out.push({ code: 'LEDGER-INVALID', message: `the packaged corpus could not be read: ${err.message}`, path: 'project/', remedy: 'regenerate the artifact from a project that passes `handoff.mjs`' });
    return out;
  }

  const handoff = verifyHandoff(projectRoot, { corpus });
  for (const finding of handoff.findings) {
    if (finding.severity !== 'fail') continue;
    const code = finding.name === 'handoff-ledger-missing' ? 'LEDGER-MISSING'
      : finding.name === 'handoff-ledger-empty' ? 'LEDGER-INVALID'
        : finding.name === 'handoff-capture-missing' ? 'CAPTURE-MISSING'
          : finding.kind === 'modified' || finding.kind === 'line-endings' ? 'CAPTURE-HASH-MISMATCH'
            : 'LEDGER-INVALID';
    out.push({
      code,
      message: finding.detail,
      path: 'project/research/',
      remedy: code === 'CAPTURE-HASH-MISMATCH'
        // Named separately because the cause differs and so does the fix: a rewritten
        // line ending is not tampering, and telling somebody to re-collect for it wastes
        // credits on evidence that is already correct.
        ? 'a capture no longer matches the hash taken when it was fetched; if the package travelled through a tool that rewrites line endings, repackage with the bytes as collected'
        : 'regenerate the artifact from a project that passes `handoff.mjs`',
    });
  }
  return out;
}

