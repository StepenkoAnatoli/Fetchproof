#!/usr/bin/env node
// Regenerates every example package under this directory.
//
// The packages are CHECKED IN, not generated at validation time, because the point of
// an example is that a reader can open the files and see what a record looks like. This
// script exists so the hashes inside them stay correct when a schema or a hash rule
// changes: run it, and `git diff` shows exactly which bytes the change moved.
//
// `run-example.mjs` validates what is on disk. It never calls this. If the two disagree,
// that is a real finding and not a build step anybody forgot.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256 } from '../../lib/release-validator.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Two external roots the registry anchors to. Real packages carry the SHA-256 of the
// benchmark specification and of the role roster; these are obvious placeholders, so
// nobody mistakes an example for a production template.
const CONTRACT_HASH = 'a'.repeat(64);
const ROSTER_HASH = 'b'.repeat(64);

const payloadHash = (payload) => sha256(canonicalJson(payload));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** One R28 record. `payloadSha256` is computed, never hand-written. */
function record({ artifactId = 'R28-01', payload = { answer: 'the contract is sealed' }, ...overrides } = {}) {
  const base = {
    artifactId,
    schema: 1,
    benchmarkSpecVersion: '1.0.0',
    benchmarkSpecSha256: CONTRACT_HASH,
    package: artifactId.slice(0, 3),
    recordId: `${artifactId}:example-1`,
    ownerRole: 'contract-custodian',
    ownerId: 'alice',
    roleRosterSha256: ROSTER_HASH,
    createdAt: '2026-01-01T00:00:00Z',
    predecessorHashes: [],
    payloadSha256: payloadHash(payload),
    state: 'sealed',
    visibility: 'grader-only',
    payload,
  };
  return { ...base, ...overrides };
}

function registry({ artifactId = 'R28-01', ...overrides } = {}) {
  return {
    schema: 1,
    benchmarkSpecVersion: '1.0.0',
    benchmarkSpecSha256: CONTRACT_HASH,
    roleRosterSha256: ROSTER_HASH,
    externalRoots: { 'benchmark-spec': CONTRACT_HASH, 'role-roster': ROSTER_HASH },
    artifacts: [{
      artifactId,
      package: artifactId.slice(0, 3),
      path: `records/${artifactId}.json`,
      schema: 1,
      ownerRoles: ['contract-custodian'],
      visibility: 'grader-only',
      predecessors: [],
      pointer: false,
    }],
    ...overrides,
  };
}

function roster({ roleId = 'contract-custodian', ...overrides } = {}) {
  return {
    schema: 1,
    rosterSha256: ROSTER_HASH,
    assignments: [{
      principalId: 'alice',
      roleId,
      package: 'R28',
      scope: '*',
      validFrom: '2025-01-01T00:00:00Z',
      validUntil: '2030-01-01T00:00:00Z',
      approval: { signature: 'example-only-not-a-real-signature' },
    }],
    ...overrides,
  };
}

/**
 * Every package this script writes. Used to sweep away renamed ones.
 *
 * Without this, renaming a package leaves the old directory on disk: `writePackage` only
 * clears the directory it is about to write. That happened during authoring - `03` was
 * renamed once the behaviour it demonstrates turned out not to be a failure - and the
 * stale copy survived until a test caught it.
 */
const written = new Set();

/** Delete any NN-* package directory this run did not write. */
function sweepRenamed() {
  for (const entry of fs.readdirSync(HERE, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d\d-/.test(entry.name) || written.has(entry.name)) continue;
    fs.rmSync(path.join(HERE, entry.name), { recursive: true, force: true });
    console.log(`removed stale package ${entry.name}`);
  }
}

/** Write one package directory: registry, roster, records, and an empty pointer dir. */
function writePackage(name, { records, registry: reg, roles }) {
  written.add(name);
  const dir = path.join(HERE, name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [id, value] of Object.entries(records)) writeJson(path.join(dir, 'records', `${id}.json`), value);
  writeJson(path.join(dir, 'artifact-registry.json'), reg);
  writeJson(path.join(dir, 'role-roster.json'), roles);
  // The pointers directory is REQUIRED and legitimately empty for a sealed R28 package.
  // Git does not track empty directories, so it needs a keeper or the example arrives
  // broken for the next person who clones it - the same dotfile lesson as the ledger.
  fs.mkdirSync(path.join(dir, 'pointers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pointers', '.gitkeep'),
    'The validator requires a pointers directory. R28 is sealed and promotes nothing,\n'
    + 'so it is empty - and git does not track empty directories without this file.\n', 'utf8');
  return dir;
}

// --------------------------------------------------------------------------- packages

// 1. The one that passes. Everything else is this, with one thing broken.
writePackage('01-minimal-pass', {
  records: { 'R28-01': record() },
  registry: registry(),
  roles: roster(),
});

// 2. The payload was edited after the record was sealed. This is the check the whole
//    envelope format exists for, so it is the first failure worth showing.
const tampered = record({ payload: { answer: 'edited after sealing' } });
tampered.payloadSha256 = payloadHash({ answer: 'the contract is sealed' });   // the OLD hash
writePackage('02-fail-payload-hash', {
  records: { 'R28-01': tampered },
  registry: registry(),
  roles: roster(),
});

// 3. NOT a failure, and that is the point of including it.
//
//    R28-02 sits on disk and the registry does not list it. This PASSES. The registry is
//    the index: validation walks the artifacts it declares, so a file the registry does
//    not name is never opened, never hashed, and never reported.
//
//    Worth knowing before you rely on this tool, because it decides what the PASS means.
//    `validate` answers "is everything the registry declares present and intact" - not
//    "is this directory free of anything unexpected". A stray, stale or planted record is
//    invisible to it. If you need the second question answered, the registry has to be
//    the thing you diff, or you need a separate check over the directory.
writePackage('03-behaviour-unregistered-record-is-ignored', {
  records: { 'R28-01': record(), 'R28-02': record({ artifactId: 'R28-02' }) },
  registry: registry(),                                  // still lists only R28-01
  roles: roster(),
});

// 4. The registry lists a record that is not on disk.
writePackage('04-fail-missing-record', {
  records: {},
  registry: registry(),
  roles: roster(),
});

// 5. The owner holds a role nobody granted them. The roster is the authority for who may
//    own what, and a record naming an ungranted role is unauthorised regardless of hashes.
writePackage('05-fail-owner-role-not-granted', {
  records: { 'R28-01': record() },
  registry: registry(),
  roles: roster({ roleId: 'some-other-role' }),
});

// 6. A future schema revision. A validator that has not been taught revision 2 must
//    refuse rather than guess, because guessing is how a silent misread starts.
writePackage('06-fail-future-schema', {
  records: { 'R28-01': record({ schema: 2 }) },
  registry: registry(),
  roles: roster(),
});

sweepRenamed();
console.log(`rebuilt ${written.size} example packages under fetchproof/examples/release-evidence/`);
