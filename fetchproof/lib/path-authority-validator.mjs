// Machine-checkable validator for Git-origin/path-authority snapshot envelopes.
// The validator is read-only: it consumes one JSON envelope and never rewrites
// snapshots, transcripts, profiles, Git config, or release pointers.
import fs from 'node:fs';
import path from 'node:path';
import { compareText } from './release/order.mjs';
import {
  DEFAULT_SCHEMA_DIR,
  canonicalJson,
  parseJsonNoDuplicates,
  sha256,
  validateJsonSchema,
} from './release-validator.mjs';

export const SNAPSHOT_VALIDATOR_VERSION = '1.0.0';
export const SNAPSHOT_SCHEMA = path.join(DEFAULT_SCHEMA_DIR, 'git-origin-path-authority-snapshot.schema.json');
const HASH = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const GATE_PACKAGE = { Q0: 'R28', Q1: 'R29', Q2: 'R30', Q3: 'R31', Q4: 'R32', Q5: 'R33' };
const PATH_SETTINGS = new Set(['configPath', 'statePath', 'settingsPath', 'kitDir', 'gitConfigPath', 'artifactRoot', 'candidateVisibleRoot', 'graderOnlyRoot']);
const ENV_KEYS = new Set(['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'FETCHPROOF_HOME', 'FETCHPROOF_CONFIG', 'FETCHPROOF_INSTALL_STATE', 'FETCHPROOF_EDIT_GATE_SETTINGS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']);
const GIT_READS = new Set(['repository-local-core-hooksPath', 'user-global-core-hooksPath', 'system-core-hooksPath', 'effective-repository-core-hooksPath', 'nosystem-effective-core-hooksPath', 'explicit-file-core-hooksPath', 'installer-write-target', 'repository-local-preservation']);

function add(errors, code, message, pathName, status = 'FAIL') {
  errors.push({ code, message, path: pathName || '$', status });
}

// A snapshot member as a message shows it. A string is shown as written; anything else as
// JSON, since a template string calls toString and an object whose toString is not
// callable threw out of the validator (review of #340, 2026-10-18).
function shown(value) {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
}

function resultStatus(errors) {
  if (errors.some((error) => error.status === 'REOPEN' || error.code === 'REOPEN')) return 'REOPEN';
  if (errors.some((error) => error.status === 'FAIL' || !error.status)) return 'FAIL';
  if (errors.length) return 'INCOMPLETE';
  return 'PASS';
}

function loadSchema(schemaPath) {
  try { return parseJsonNoDuplicates(fs.readFileSync(schemaPath, 'utf8')); }
  catch (error) { return { error }; }
}

function isAbsolutePortable(value) {
  return typeof value === 'string' && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
}

function portablePath(value) {
  const win = path.win32.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
  const impl = win ? path.win32 : path.posix;
  return { win, impl, value: impl.normalize(value).replaceAll('\\', '/') };
}

function contained(root, candidate) {
  if (!isAbsolutePortable(root) || !isAbsolutePortable(candidate)) return false;
  const r = portablePath(root);
  const c = portablePath(candidate);
  if (r.win !== c.win) return false;
  const rootValue = r.value.endsWith('/') ? r.value.slice(0, -1) : r.value;
  const candidateValue = c.value;
  const left = r.win ? rootValue.toLowerCase() : rootValue;
  const right = r.win ? candidateValue.toLowerCase() : candidateValue;
  return right === left || right.startsWith(`${left}/`);
}

function relativeSafe(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return false;
  const normal = value.replaceAll('\\', '/');
  return normal !== '..' && !normal.startsWith('../') && !normal.includes('/../');
}

function canonicalWithoutHash(snapshot) {
  const copy = { ...snapshot };
  delete copy.envelope_canonical_sha256;
  return canonicalJson(copy);
}

export function canonicalEnvelopeHash(snapshot) {
  return sha256(canonicalWithoutHash(snapshot));
}

// The rows of one section that the semantic checks can read. A section that is not an
// array, or a row that is not a plain object, has already been recorded as SCHEMA-TYPE by
// the schema pass; dereferencing it here threw instead, and the CLI reported the throw as
// a read error (#340). Indices are kept so a finding still names the row it is about.
function rowsOf(snapshot, section) {
  const rows = snapshot[section];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => (row && typeof row === 'object' && !Array.isArray(row) ? [[index, row]] : []));
}

function validatePathRows(snapshot, errors) {
  const seen = new Set();
  const rows = rowsOf(snapshot, 'path_authority');
  for (const [index, row] of rows) {
    const at = `.path_authority[${index}]`;
    if (seen.has(row.setting)) add(errors, 'SNAP-DUPLICATE-SETTING', `setting ${shown(row.setting)} appears more than once`, `${at}.setting`);
    seen.add(row.setting);
    if (!PATH_SETTINGS.has(row.setting)) add(errors, 'SNAP-SETTING', `unknown path setting ${shown(row.setting)}`, `${at}.setting`);
    if (!isAbsolutePortable(row.observed_path) || !isAbsolutePortable(row.realpath)) add(errors, 'SNAP-PATH-ABSOLUTE', 'observed_path and realpath must be absolute portable paths', at);
    const observedContained = contained(snapshot.fixture_root, row.observed_path);
    const realContained = contained(snapshot.fixture_root, row.realpath);
    if (!observedContained || !realContained || row.contained !== true) add(errors, 'SNAP-PATH-CONTAINMENT', `path authority ${shown(row.setting)} is not contained by fixture_root`, at);
    if (row.status === 'PASS' && row.contained !== true) add(errors, 'SNAP-PATH-STATUS', `contained path ${shown(row.setting)} cannot have status PASS`, `${at}.status`);
  }
  if (seen.size !== rows.length) add(errors, 'SNAP-DUPLICATE-SETTING', 'path authority settings must be unique', '.path_authority');
}

function validateEnvironmentRows(snapshot, errors) {
  const seen = new Set();
  for (const [index, row] of rowsOf(snapshot, 'environment')) {
    const at = `.environment[${index}]`;
    if (seen.has(row.key)) add(errors, 'SNAP-DUPLICATE-ENV', `environment key ${shown(row.key)} appears more than once`, `${at}.key`);
    seen.add(row.key);
    if (!ENV_KEYS.has(row.key)) add(errors, 'SNAP-ENV-KEY', `unknown environment key ${shown(row.key)}`, `${at}.key`);
    if (row.host_value_deliberately_absent !== true) add(errors, 'SNAP-HOST-ENV', `host value for ${shown(row.key)} must be deliberately absent`, `${at}.host_value_deliberately_absent`);
  }
  for (const key of ENV_KEYS) if (!seen.has(key)) add(errors, 'SNAP-ENV-MISSING', `required environment key ${key} is missing`, '.environment', 'INCOMPLETE');
}

function validateGitRows(snapshot, errors) {
  const seen = new Set();
  for (const [index, row] of rowsOf(snapshot, 'git_origin')) {
    const at = `.git_origin[${index}]`;
    if (seen.has(row.read)) add(errors, 'SNAP-DUPLICATE-GIT-READ', `Git read ${shown(row.read)} appears more than once`, `${at}.read`);
    seen.add(row.read);
    if (!GIT_READS.has(row.read)) add(errors, 'SNAP-GIT-READ', `unknown Git-origin read ${shown(row.read)}`, `${at}.read`);
    if (row.origin_proven !== true) add(errors, 'SNAP-ORIGIN-UNPROVEN', `Git origin is not proven for ${shown(row.read)}`, `${at}.origin_proven`, 'INCOMPLETE');
  }
  for (const read of GIT_READS) if (!seen.has(read)) add(errors, 'SNAP-GIT-MISSING', `required Git-origin read ${read} is missing`, '.git_origin', 'INCOMPLETE');
}

function validateDiffRows(snapshot, errors) {
  for (const [index, row] of rowsOf(snapshot, 'artifact_diff')) {
    const at = `.artifact_diff[${index}]`;
    if (!relativeSafe(row.relative_path)) add(errors, 'SNAP-DIFF-PATH', `artifact diff path is not a safe relative path: ${shown(row.relative_path)}`, `${at}.relative_path`);
    if (!row.expected || row.difference_class === 'UNEXPECTED-CHANGE' || row.difference_class === 'OUT-OF-ROOT') add(errors, 'SNAP-UNEXPECTED-DIFF', `artifact diff ${shown(row.relative_path)} is unexpected`, at);
  }
}

function validateContainment(snapshot, errors) {
  if (!isAbsolutePortable(snapshot.cwd) || !isAbsolutePortable(snapshot.fixture_root) || !isAbsolutePortable(snapshot.project_root)) add(errors, 'SNAP-PATH-ABSOLUTE', 'cwd, fixture_root, and project_root must be absolute portable paths', '$');
  if (!contained(snapshot.fixture_root, snapshot.cwd)) add(errors, 'SNAP-CWD-CONTAINMENT', 'cwd must be below fixture_root', '.cwd');
  if (!contained(snapshot.fixture_root, snapshot.project_root)) add(errors, 'SNAP-PROJECT-CONTAINMENT', 'project_root must be below fixture_root', '.project_root');
  if (contained(snapshot.fixture_root, snapshot.external_sentinel?.path)) add(errors, 'SNAP-SENTINEL-CONTAINMENT', 'external sentinel must be outside fixture_root', '.external_sentinel.path');
  const c = snapshot.containment ?? {};
  if (c.all_paths_contained !== true) add(errors, 'SNAP-PATH-CONTAINMENT', 'all_paths_contained must be true');
  if (c.symlink_ancestor === true) add(errors, 'SNAP-SYMLINK', 'symlink/junction ancestor is present');
  if (c.external_sentinel_unchanged !== true) add(errors, 'SNAP-SENTINEL', 'external sentinel is not unchanged');
  if (c.host_state_touched === true) add(errors, 'SNAP-HOST-MUTATION', 'host profile/config/Git state was touched');
  if (c.candidate_grader_boundary_preserved !== true) add(errors, 'SNAP-BOUNDARY', 'candidate/grader boundary was not preserved');
  if (snapshot.phase === 'recovery' && !c.recovery_result) add(errors, 'SNAP-RECOVERY-MISSING', 'recovery phase requires recovery_result', '.containment.recovery_result', 'INCOMPLETE');
}

function validateSemantics(snapshot, errors) {
  // Own members only, and only a string: an object gate_id threw as a property key, and
  // "constructor" found Object.prototype's (review of #340 and #336, 2026-10-18).
  const gatePackage = typeof snapshot.gate_id === 'string' && Object.hasOwn(GATE_PACKAGE, snapshot.gate_id) ? GATE_PACKAGE[snapshot.gate_id] : undefined;
  if (gatePackage !== snapshot.package) add(errors, 'SNAP-GATE-PACKAGE', `${shown(snapshot.gate_id)} must use package ${shown(gatePackage)}`, '.package');
  if (typeof snapshot.captured_at !== 'string' || !UTC.test(snapshot.captured_at) || Number.isNaN(Date.parse(snapshot.captured_at))) add(errors, 'SNAP-TIME', 'captured_at must be UTC ISO-8601 with Z', '.captured_at');
  if (snapshot.producer?.id === snapshot.independent_verifier?.id) add(errors, 'SNAP-ROLE-COLLISION', 'producer and independent verifier must be different principals');
  validateContainment(snapshot, errors);
  validatePathRows(snapshot, errors);
  validateEnvironmentRows(snapshot, errors);
  validateGitRows(snapshot, errors);
  validateDiffRows(snapshot, errors);
  if (typeof snapshot.envelope_canonical_sha256 === 'string' && HASH.test(snapshot.envelope_canonical_sha256)) {
    // canonicalJson refuses an envelope it cannot serialise (an unpaired surrogate); the
    // refusal threw out of the validator, and such an envelope has no hash to match.
    let actual = null;
    let reason = 'envelope_canonical_sha256 does not match canonical self-excluding bytes';
    try { actual = canonicalEnvelopeHash(snapshot); } catch (error) { reason = `envelope is not canonical JSON: ${error.message}`; }
    if (actual !== snapshot.envelope_canonical_sha256) add(errors, 'SNAP-ENVELOPE-HASH', reason, '.envelope_canonical_sha256');
  }
  if (snapshot.status === 'PASS') {
    if (errors.length) add(errors, 'SNAP-PASS-INCONSISTENT', 'PASS is not permitted while any envelope check has an error', '.status');
    if ([...rowsOf(snapshot, 'path_authority'), ...rowsOf(snapshot, 'git_origin')].some(([, row]) => row.status !== 'PASS')) add(errors, 'SNAP-PASS-ROW-STATUS', 'PASS requires every path and Git row to be PASS', '.status');
  }
}

// The schema check compares const and enum values in canonical JSON, which refuses an
// unpaired surrogate by throwing; for a snapshot that is a FAIL verdict, not a crash, in
// `validate` and `conform` alike (review of #340, 2026-10-18). The refusal stays a throw in
// schema.mjs itself, where the FI runner's Python twin names it JSON-PARSE. Any other throw
// is a defect and propagates.
function checkSchema(value, schema, errors) {
  try { validateJsonSchema(value, schema, { errors }); } catch (error) {
    if (!/is not canonical JSON/.test(String(error?.message))) throw error;
    add(errors, 'SNAP-CANONICAL', `snapshot is not canonical JSON: ${error.message}`, '$');
  }
}

export function validatePathAuthoritySnapshot(snapshot, { schemaPath = SNAPSHOT_SCHEMA } = {}) {
  const errors = [];
  const schema = loadSchema(schemaPath);
  if (schema?.error) {
    add(errors, 'SCHEMA-READ', schema.error.message, schemaPath, 'INCOMPLETE');
    return { validatorVersion: SNAPSHOT_VALIDATOR_VERSION, status: resultStatus(errors), snapshotId: null, envelopeCanonicalSha256: null, errors };
  }
  checkSchema(snapshot, schema, errors);
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) validateSemantics(snapshot, errors);
  return {
    validatorVersion: SNAPSHOT_VALIDATOR_VERSION,
    status: resultStatus(errors),
    snapshotId: snapshot?.snapshot_id ?? null,
    envelopeCanonicalSha256: snapshot?.envelope_canonical_sha256 ?? null,
    errors,
  };
}

export function runPathAuthorityConformance({ files = [], schemaPath = SNAPSHOT_SCHEMA } = {}) {
  const errors = [];
  const ordered = [...files].sort(compareText);
  if (!ordered.length) add(errors, 'SCHEMA-NO-FILES', 'at least one JSON file is required', '$', 'INCOMPLETE');
  const schema = loadSchema(schemaPath);
  if (schema?.error) add(errors, 'SCHEMA-READ', schema.error.message, schemaPath, 'INCOMPLETE');
  const results = [];
  for (const file of ordered) {
    let value;
    try { value = parseJsonNoDuplicates(fs.readFileSync(file, 'utf8')); }
    catch (error) { add(errors, /duplicate object key/i.test(error.message) ? 'JSON-DUPLICATE-KEY' : 'JSON-READ', error.message, file, 'INCOMPLETE'); continue; }
    const localErrors = [];
    checkSchema(value, schema, localErrors);
    const localStatus = resultStatus(localErrors);
    results.push({ file, status: localStatus, errors: localErrors });
    errors.push(...localErrors.map((error) => ({ ...error, path: `${file}:${error.path}` })));
  }
  return { validatorVersion: SNAPSHOT_VALIDATOR_VERSION, status: resultStatus(errors), files: ordered, results, errors };
}

export function readPathAuthoritySnapshot(file) {
  return parseJsonNoDuplicates(fs.readFileSync(file, 'utf8'));
}
