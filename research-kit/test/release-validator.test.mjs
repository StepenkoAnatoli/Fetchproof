// Validator and JSON-Schema conformance tests. All records are synthetic and
// live below disposable roots; no benchmark fixture, network, or paid transport
// is involved.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, describe, assert, assertEqual, cleanup, tempDir } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029. The source tree's runner labelled by file
// automatically; this one is told, so a failure names release-validator rather than
// whichever file happened to register last.
describe('release-validator');

const CONTRACT_HASH = 'a'.repeat(64);
const ROSTER_HASH = 'b'.repeat(64);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const crypto = await import('node:crypto');
  return crypto.createHash('sha256').update(value).digest('hex');
}

function tempRoot() {
  return tempDir('research-kit-release-validator-');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function envelope({ artifactId = 'R28-01', packageName = 'R28', payload = {}, ...overrides } = {}) {
  return {
    artifactId,
    schema: 1,
    benchmarkSpecVersion: '1.0.0',
    benchmarkSpecSha256: CONTRACT_HASH,
    package: packageName,
    recordId: `${artifactId}:test-1`,
    ownerRole: 'contract-custodian',
    ownerId: 'alice',
    roleRosterSha256: ROSTER_HASH,
    createdAt: '2026-01-01T00:00:00Z',
    predecessorHashes: [],
    payloadSha256: '0'.repeat(64),
    state: 'sealed',
    visibility: 'grader-only',
    payload,
    ...overrides,
  };
}

function registryFor(artifactId = 'R28-01') {
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
  };
}

function roster() {
  return {
    schema: 1,
    rosterSha256: ROSTER_HASH,
    assignments: [{
      principalId: 'alice',
      roleId: 'contract-custodian',
      package: 'R28',
      scope: '*',
      validFrom: '2025-01-01T00:00:00Z',
      validUntil: '2030-01-01T00:00:00Z',
      approval: { signature: 'test' },
    }],
  };
}

test('JSON Schema conformance runner accepts a valid envelope and rejects an unknown key', async () => {
  const { runSchemaConformance } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const record = envelope();
    record.payloadSha256 = await sha256(canonical(record.payload));
    const file = path.join(root, 'record.json');
    const schema = path.resolve('research-kit/schemas/r28-r32-envelope.schema.json');
    writeJson(file, record);
    const good = runSchemaConformance({ files: [file], schemaPath: schema });
    assertEqual(good.status, 'PASS', JSON.stringify(good));
    const nested = { envelope: { ...record }, payload: record.payload };
    delete nested.envelope.payload;
    writeJson(file, nested);
    const nestedGood = runSchemaConformance({ files: [file], schemaPath: schema });
    assertEqual(nestedGood.status, 'PASS', JSON.stringify(nestedGood));
    record.unexpected = true;
    writeJson(file, record);
    const bad = runSchemaConformance({ files: [file], schemaPath: schema });
    assertEqual(bad.status, 'FAIL', JSON.stringify(bad));
    assert(bad.errors.some((error) => error.code === 'SCHEMA-ADDITIONAL'), JSON.stringify(bad.errors));
    // #336: a member named after an Object.prototype property is a member like any other.
    // `key in value` answered true for every prototype name, so an extra `constructor` or
    // `hasOwnProperty` passed additionalProperties:false, and a record whose only member
    // was "__proto__" (the reader fed it to the prototype setter) "had" every required key.
    delete record.unexpected;
    for (const name of ['constructor', 'hasOwnProperty', 'toString']) {
      fs.writeFileSync(file, JSON.stringify({ ...record, [name]: 'planted' }), 'utf8');
      const planted = runSchemaConformance({ files: [file], schemaPath: schema });
      assertEqual(planted.status, 'FAIL', `${name}: ${JSON.stringify(planted)}`);
      assert(planted.errors.some((error) => error.code === 'SCHEMA-ADDITIONAL' && error.path.endsWith(`$.${name}`)), `${name}: ${JSON.stringify(planted.errors)}`);
    }
    fs.writeFileSync(file, `{"__proto__":${JSON.stringify(record)}}`, 'utf8');
    const proto = runSchemaConformance({ files: [file], schemaPath: schema });
    assertEqual(proto.status, 'FAIL', JSON.stringify(proto));
    assert(proto.errors.some((error) => error.code === 'SCHEMA-REQUIRED' && error.path.endsWith('$.artifactId')), JSON.stringify(proto.errors));
  } finally {
    cleanup(root);
  }
});

test('JSON Schema conformance runner rejects duplicate keys and UTF-8 BOM input', async () => {
  const { runSchemaConformance } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const schema = path.resolve('research-kit/schemas/r28-r32-envelope.schema.json');
    const file = path.join(root, 'bad.json');
    fs.writeFileSync(file, '{"artifactId":"R28-01","artifactId":"R28-02"}', 'utf8');
    let result = runSchemaConformance({ files: [file], schemaPath: schema });
    assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
    assert(result.errors.some((error) => error.code === 'JSON-DUPLICATE-KEY'), JSON.stringify(result.errors));
    fs.writeFileSync(file, `\uFEFF${JSON.stringify(envelope())}`, 'utf8');
    result = runSchemaConformance({ files: [file], schemaPath: schema });
    assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
    assert(result.errors.some((error) => /BOM/.test(error.message)), JSON.stringify(result.errors));
  } finally {
    cleanup(root);
  }
});

test('validateEnvelope catches a payload hash mismatch and a future schema revision', async () => {
  const { validateEnvelope } = await import('../lib/release-validator.mjs');
  const entry = registryFor().artifacts[0];
  const badHash = envelope({ payload: { answer: 1 } });
  let result = validateEnvelope(badHash, entry, { roster: roster(), records: new Map() });
  assertEqual(result.status, 'FAIL', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'ENV-HASH'), JSON.stringify(result.errors));
  const future = envelope({ schema: 2 });
  result = validateEnvelope(future, entry, { roster: roster(), records: new Map() });
  assertEqual(result.status, 'FAIL', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'ENV-FUTURE-SCHEMA'), JSON.stringify(result.errors));
  const nestedMeta = { ...envelope(), payloadSha256: await sha256(canonical({ answer: 1 })) };
  delete nestedMeta.payload;
  const nested = { envelope: nestedMeta, payload: { answer: 1 } };
  nested.envelope.recordHash = await sha256(canonical({ envelope: nestedMeta, payload: nested.payload }));
  result = validateEnvelope(nested, entry, { roster: roster(), records: new Map() });
  assertEqual(result.status, 'PASS', JSON.stringify(result));
});

test('researcher-release validate emits the contract status and exit code without writing inputs', async () => {
  const root = tempRoot();
  try {
    const records = path.join(root, 'records');
    const pointers = path.join(root, 'pointers');
    const registryPath = path.join(root, 'artifact-registry.json');
    const rolesPath = path.join(root, 'role-roster.json');
    const record = envelope();
    record.payloadSha256 = await sha256(canonical(record.payload));
    writeJson(path.join(records, 'R28-01.json'), record);
    writeJson(registryPath, registryFor());
    writeJson(rolesPath, roster());
    fs.mkdirSync(pointers);
    const before = fs.readFileSync(path.join(records, 'R28-01.json'), 'utf8');
    const run = spawnSync(process.execPath, [
      'research-kit/bin/researcher-release.mjs', 'validate',
      '--root', root, '--package', 'R28', '--registry', registryPath,
      '--roles', rolesPath, '--pointers', pointers, '--json',
    ], { encoding: 'utf8' });
    assertEqual(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    assertEqual(result.status, 'PASS', run.stdout);
    assertEqual(result.package, 'R28');
    assertEqual(Object.keys(result.promotionTimelines).length, 6);
    assertEqual(JSON.stringify(result.recoveryReceiptIds), '[]');
    assertEqual(fs.readFileSync(path.join(records, 'R28-01.json'), 'utf8'), before, 'validate is read-only');
  } finally {
    cleanup(root);
  }
});

test('researcher-release names a missing value before resolving paths', () => {
  for (const flag of ['--file', '--schema', '--root']) {
    for (const tail of [[], ['--json']]) {
      const args = [
        'research-kit/bin/researcher-release.mjs', 'conform', '--schema', 'missing-schema.json',
        '--file', 'missing-record.json', flag, ...tail,
      ];
      const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
      const output = `${run.stdout}${run.stderr}`;
      assertEqual(run.status, 2, `${args.join(' ')}: ${output}`);
      assert(run.stderr.includes(`${flag} needs a value`), output);
      assert(run.stderr.includes('Usage:'), output);
      assert(!/TypeError|paths\[0\]|ERR_INVALID_ARG_TYPE/.test(output), output);
    }
  }
});

test('researcher-release refuses invalid snapshot ages as usage before judging a valid package', async () => {
  const root = tempRoot();
  try {
    const registryPath = path.join(root, 'registry.json');
    const rolesPath = path.join(root, 'roles.json');
    const pointers = path.join(root, 'pointers');
    const record = envelope();
    record.payloadSha256 = await sha256(canonical(record.payload));
    writeJson(path.join(root, 'records', 'R28-01.json'), record);
    writeJson(registryPath, registryFor());
    writeJson(rolesPath, roster());
    fs.mkdirSync(pointers);
    const args = ['research-kit/bin/researcher-release.mjs', 'validate', '--root', root,
      '--package', 'R28', '--registry', registryPath, '--roles', rolesPath, '--pointers', pointers, '--json'];
    for (const value of ['abc', '', '   ', 'NaN', 'Infinity', '1e309', '-1']) {
      const run = spawnSync(process.execPath, [...args, '--snapshot-max-age-ms', value], { encoding: 'utf8' });
      assertEqual(run.status, 2, run.stdout || run.stderr);
      assert(run.stderr.includes('--snapshot-max-age-ms'), run.stderr);
      assert(run.stderr.includes('Usage:'), run.stderr);
      assertEqual(run.stdout, '', 'usage must not produce an evidence verdict');
      assert(!/SNAPSHOT-STALE|allowed .*ms/.test(run.stderr), run.stderr);
    }
    for (const value of ['0', '1', '1.5', '1e3']) {
      const run = spawnSync(process.execPath, [...args, '--snapshot-max-age-ms', value], { encoding: 'utf8' });
      assertEqual(run.status, 0, run.stdout || run.stderr);
      assertEqual(JSON.parse(run.stdout).status, 'PASS');
    }
  } finally { cleanup(root); }
});

test('release and snapshot facades distinguish an invalid age allowance from stale evidence', async () => {
  const { validateRelease, validateSnapshotEvidence } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const registryPath = path.join(root, 'registry.json');
    const rolesPath = path.join(root, 'roles.json');
    writeJson(registryPath, registryFor());
    writeJson(rolesPath, roster());
    const now = Date.parse('2026-01-01T00:00:00Z');
    const baseRecord = envelope();
    baseRecord.payloadSha256 = await sha256(canonical(baseRecord.payload));
    writeJson(path.join(root, 'records', 'R28-01.json'), baseRecord);
    const baseline = validateRelease({ root, package: 'R28', registryPath, rolesPath });
    assertEqual(baseline.status, 'PASS', JSON.stringify(baseline));
    const refs = Object.fromEntries(['before', 'after', 'recovery'].map((phase) => [phase, {
      snapshotId: phase, capturedAt: '2026-01-01T00:00:00Z', status: 'PASS', envelopeCanonicalSha256: 'c'.repeat(64),
    }]));
    const record = envelope({ payload: { pathAuthoritySnapshots: refs } });
    for (const value of [NaN, Infinity, -Infinity, -1, null, '0']) {
      const results = [
        validateRelease({ root, package: 'R28', registryPath, rolesPath, snapshotMaxAgeMs: value }),
        validateSnapshotEvidence(record, { root, now, maxAgeMs: value }),
      ];
      for (const result of results) {
        assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
        assert(result.errors.some((error) => error.code === 'INPUT-SNAPSHOT-MAX-AGE'), JSON.stringify(result));
        assert(!result.errors.some((error) => error.code === 'SNAPSHOT-STALE'), JSON.stringify(result));
      }
    }
    const fresh = validateSnapshotEvidence(record, { root, now, maxAgeMs: 0 });
    assert(!fresh.errors.some((error) => error.code === 'INPUT-SNAPSHOT-MAX-AGE' || error.code === 'SNAPSHOT-STALE'), JSON.stringify(fresh));
    const stale = validateSnapshotEvidence(record, { root, now: now + 1, maxAgeMs: 0 });
    assertEqual(stale.errors.filter((error) => error.code === 'SNAPSHOT-STALE').length, 3, JSON.stringify(stale));
  } finally { cleanup(root); }
});

test('researcher-release conform validates explicit files and maps schema failure to exit 1', async () => {
  const root = tempRoot();
  try {
    const schema = path.resolve('research-kit/schemas/r28-r32-envelope.schema.json');
    const file = path.join(root, 'record.json');
    const record = envelope();
    record.payloadSha256 = await sha256(canonical(record.payload));
    writeJson(file, record);
    let run = spawnSync(process.execPath, [
      'research-kit/bin/researcher-release.mjs', 'conform', '--root', root,
      '--schema', schema, '--file', file, '--json',
    ], { encoding: 'utf8' });
    assertEqual(run.status, 0, run.stderr || run.stdout);
    assertEqual(JSON.parse(run.stdout).status, 'PASS');
    record.extra = true;
    writeJson(file, record);
    run = spawnSync(process.execPath, [
      'research-kit/bin/researcher-release.mjs', 'conform', '--schema', schema,
      '--file', file, '--json',
    ], { encoding: 'utf8' });
    assertEqual(run.status, 1, run.stdout || run.stderr);
    const result = JSON.parse(run.stdout);
    assertEqual(result.status, 'FAIL');
    assert(result.errors.some((error) => error.code === 'SCHEMA-ADDITIONAL'), JSON.stringify(result.errors));
  } finally {
    cleanup(root);
  }
});

test('validator marks a missing predecessor as INCOMPLETE and keeps all findings', async () => {
  const { validateEnvelope } = await import('../lib/release-validator.mjs');
  const missing = 'c'.repeat(64);
  const entry = { ...registryFor('R28-02').artifacts[0], predecessors: [{ kind: 'external', id: 'missing' }] };
  const record = envelope({ artifactId: 'R28-02', predecessorHashes: [] });
  record.payloadSha256 = await sha256(canonical(record.payload));
  const result = validateEnvelope(record, entry, { roster: roster(), records: new Map() });
  assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
  assert(result.errors.some((error) => error.code === 'PRE-MISSING'), JSON.stringify(result.errors));
});

test('Markdown sidecar envelopes hash canonical body bytes instead of a JSON payload', async () => {
  const { validateEnvelope, sha256 } = await import('../lib/release-validator.mjs');
  const entry = registryFor().artifacts[0];
  const body = '# report schema\n';
  const meta = { ...envelope(), payloadSha256: sha256(body) };
  delete meta.payload;
  const record = { envelope: meta };
  const result = validateEnvelope(record, entry, { roster: roster(), records: new Map(), contentHash: sha256(body) });
  assertEqual(result.status, 'PASS', JSON.stringify(result));
});

test('package validation resolves an authenticated predecessor from an earlier package', async () => {
  const { validateRelease, payloadHash } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const r28 = envelope();
    r28.payloadSha256 = payloadHash(r28.payload);
    const r29 = envelope({ artifactId: 'R29-01', packageName: 'R29', predecessorHashes: [r28.payloadSha256] });
    r29.payloadSha256 = payloadHash(r29.payload);
    writeJson(path.join(root, 'records', 'R28-01.json'), r28);
    writeJson(path.join(root, 'records', 'R29-01.json'), r29);
    const registry = {
      schema: 1,
      benchmarkSpecVersion: '1.0.0',
      benchmarkSpecSha256: CONTRACT_HASH,
      roleRosterSha256: ROSTER_HASH,
      artifacts: [
        { ...registryFor().artifacts[0], path: 'records/R28-01.json' },
        { ...registryFor('R29-01').artifacts[0], path: 'records/R29-01.json', package: 'R29', predecessors: [{ kind: 'artifact', artifactId: 'R28-01' }] },
      ],
    };
    const roles = roster();
    roles.assignments[0].package = '*';
    writeJson(path.join(root, 'registry.json'), registry);
    writeJson(path.join(root, 'roles.json'), roles);
    fs.mkdirSync(path.join(root, 'pointers'));
    const result = validateRelease({ root, package: 'R29', registryPath: path.join(root, 'registry.json'), rolesPath: path.join(root, 'roles.json'), pointersDir: path.join(root, 'pointers') });
    assertEqual(result.status, 'PASS', JSON.stringify(result));
    assert(result.predecessorClosure.visited.includes('R28-01'), JSON.stringify(result.predecessorClosure));
  } finally {
    cleanup(root);
  }
});

test('schema conformance enforces numeric minimums and exact artifact IDs', async () => {
  const { runSchemaConformance } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const schema = path.resolve('research-kit/schemas/r28-r32-envelope.schema.json');
    const file = path.join(root, 'record.json');
    const record = envelope({ artifactId: 'R28-01', schema: 0 });
    record.payloadSha256 = await sha256(canonical(record.payload));
    writeJson(file, record);
    let result = runSchemaConformance({ files: [file], schemaPath: schema });
    assertEqual(result.status, 'FAIL', JSON.stringify(result));
    assert(result.errors.some((error) => error.code === 'SCHEMA-MINIMUM'), JSON.stringify(result.errors));
    record.schema = 1;
    record.artifactId = 'R33-01';
    writeJson(file, record);
    result = runSchemaConformance({ files: [file], schemaPath: schema });
    assertEqual(result.status, 'FAIL', JSON.stringify(result));
    assert(result.errors.some((error) => error.code === 'SCHEMA-ENUM'), JSON.stringify(result.errors));
  } finally {
    cleanup(root);
  }
});

// #335 (2026-10-17): additionalProperties was applied only when it was `false` and the
// schema also had `properties`. Both shipped schemas write externalRoots as a map whose
// members must be hashes - additionalProperties as a schema, no properties - so any value
// passed, and a malformed root surfaced much later as a "missing" one.
test('schema conformance applies additionalProperties when it is a schema, and false with no properties', async () => {
  const { runSchemaConformance, validateJsonSchema } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const genesis = {
      ledgerVersion: '1.0.0', releaseId: 'release-1', benchmarkSpecVersion: '1.0.0',
      benchmarkSpecSha256: CONTRACT_HASH, registrySha256: 'c'.repeat(64), roleRosterSha256: ROSTER_HASH,
      externalRoots: { 'benchmark-spec': CONTRACT_HASH }, genesisHash: 'd'.repeat(64), signerKeyId: 'release-key', signature: 'sig',
    };
    for (const [name, value] of [['qualification-ledger-genesis', genesis], ['artifact-registry', registryFor()]]) {
      const schemaPath = path.resolve(`research-kit/schemas/${name}.schema.json`);
      const file = path.join(root, `${name}.json`);
      writeJson(file, value);
      const good = runSchemaConformance({ files: [file], schemaPath });
      assertEqual(good.status, 'PASS', `${name}: ${JSON.stringify(good)}`);
      writeJson(file, { ...value, externalRoots: { 'benchmark-spec': 'not-a-hash', 'role-roster': 42 } });
      const bad = runSchemaConformance({ files: [file], schemaPath });
      assertEqual(bad.status, 'FAIL', `${name}: ${JSON.stringify(bad)}`);
      assert(bad.errors.some((error) => error.code === 'SCHEMA-PATTERN' && error.path.endsWith('$.externalRoots.benchmark-spec')), `${name}: ${JSON.stringify(bad.errors)}`);
      assert(bad.errors.some((error) => error.code === 'SCHEMA-TYPE' && error.path.endsWith('$.externalRoots.role-roster')), `${name}: ${JSON.stringify(bad.errors)}`);
    }
    const closed = { type: 'object', additionalProperties: false };
    assertEqual(validateJsonSchema({}, closed).length, 0, 'an empty object has no member to refuse');
    const refused = validateJsonSchema({ a: 1 }, closed);
    assert(refused.some((error) => error.code === 'SCHEMA-ADDITIONAL' && error.path === '$.a'), JSON.stringify(refused));
    const mixed = { type: 'object', properties: { n: { type: 'integer' } }, additionalProperties: { type: 'string' } };
    assertEqual(validateJsonSchema({ n: 1, s: 'x' }, mixed).length, 0, 'a listed member is judged by its own schema only');
    const unlisted = validateJsonSchema({ n: 1, s: 2 }, mixed);
    assertEqual(unlisted.length, 1, JSON.stringify(unlisted));
    assertEqual(unlisted[0].path, '$.s');
    assertEqual(validateJsonSchema({ any: [1] }, { type: 'object', additionalProperties: true }).length, 0, 'true allows everything');
  } finally {
    cleanup(root);
  }
});

// #335: with the schema now refusing a malformed root, the predecessor check is left to
// tell an absent root from a present, wrong one; "missing" named an absence for both.
test('the predecessor check names a malformed external root apart from a missing one', async () => {
  const { validateEnvelope } = await import('../lib/release-validator.mjs');
  const entry = { ...registryFor('R28-02').artifacts[0], predecessors: [{ kind: 'external', id: 'benchmark-spec' }, { kind: 'external', id: 'absent' }] };
  const record = envelope({ artifactId: 'R28-02', predecessorHashes: [] });
  record.payloadSha256 = await sha256(canonical(record.payload));
  const result = validateEnvelope(record, entry, { roster: roster(), records: new Map(), registry: { externalRoots: { 'benchmark-spec': 'not-a-hash' } } });
  const messages = result.errors.filter((error) => error.code === 'PRE-MISSING').map((error) => error.message);
  assert(messages.some((message) => /external root benchmark-spec is malformed/.test(message)), JSON.stringify(messages));
  assert(messages.some((message) => /missing external root absent/.test(message)), JSON.stringify(messages));
  assert(!messages.some((message) => /missing external root benchmark-spec/.test(message)), JSON.stringify(messages));
});

// #341 (2026-10-17): the pointer schema accepts a FLAT pointer ({ artifactId, promotion })
// and forbids it any other member, but validate compared metaOf(pointer).package - for a
// flat pointer, an absent value - with the registry, so such a pointer was PTR-PACKAGE
// every time. The flat form is judged by promotion.package alone.
test('a schema-valid flat promotion pointer reaches the promotion checks instead of PTR-PACKAGE', async () => {
  const { validateRelease, runSchemaConformance } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const { ledgerPath, ...paths } = await writePointerRelease(root);
    const pointerFile = path.join(paths.pointersDir, 'R28-04.json');
    const nested = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
    const flat = { artifactId: 'R28-04', promotion: nested.payload.promotion };
    writeJson(pointerFile, flat);
    const conform = runSchemaConformance({ files: [pointerFile], schemaPath: path.resolve('research-kit/schemas/promotion-pointer.schema.json') });
    assertEqual(conform.status, 'PASS', JSON.stringify(conform));
    const result = validateRelease(paths);
    assert(!result.errors.some((error) => error.code === 'PTR-PACKAGE'), JSON.stringify(result.errors));
    assert(!result.errors.some((error) => /^SCHEMA-/.test(error.code)), JSON.stringify(result.errors));
    assert(result.errors.some((error) => error.code === 'PTR-COMMIT'), `the promotion checks must still run: ${JSON.stringify(result.errors)}`);
    writeJson(pointerFile, { ...flat, promotion: { ...flat.promotion, package: 'R29' } });
    const wrong = validateRelease(paths);
    assert(wrong.errors.some((error) => error.code === 'PTR-PACKAGE' && error.path === '.promotion.package'), JSON.stringify(wrong.errors));
  } finally {
    cleanup(root);
  }
});

// Review of #336 (2026-10-18): summarizeLedgerHistory looked a promotion's package up with
// `promotionTimelines[packageName]`, so "constructor", "__proto__" or "toString" found an
// Object.prototype member and `.push` threw - on every `validate --ledger`. A package that
// is not one of the six is skipped, as an unknown one always was.
test('the ledger history summary skips a promotion whose package is a prototype name', async () => {
  const { summarizeLedgerHistory } = await import('../lib/release-validator.mjs');
  const records = ['constructor', '__proto__', 'toString', 'R28'].map((packageName, index) => ({
    recordKind: 'promotion-commit', recordId: `rec-${index}`, package: packageName, physicalSequence: index + 1, payload: {},
  }));
  records.push({ recordKind: 'promotion-commit', recordId: 'rec-payload', physicalSequence: 9, payload: { package: 'hasOwnProperty' } });
  let summary;
  try { summary = summarizeLedgerHistory(records); } catch (error) { assert(false, `threw ${error.stack}`); }
  assertEqual(JSON.stringify(Object.keys(summary.promotionTimelines)), JSON.stringify(['R28', 'R29', 'R30', 'R31', 'R32', 'R33']));
  assertEqual(JSON.stringify(summary.promotionTimelines.R28.map((entry) => entry.recordId)), JSON.stringify(['rec-3']));
});

// Review of #340 (2026-10-18): a ledger record with no `payload` made payloadHash throw
// "undefined is not canonical JSON" out of verifyQualificationLedger, so `validate
// --ledger` crashed with a stack instead of naming the record. It is LEDGER-PAYLOAD-HASH.
test('ledger verification reports a record without a payload as LEDGER-PAYLOAD-HASH', async () => {
  const { verifyQualificationLedger } = await import('../lib/release-validator.mjs');
  const records = [{ ledgerVersion: '1.0.0', physicalSequence: 1, recordKind: 'prepare', prevChainHash: '0'.repeat(64), payloadSha256: 'e'.repeat(64) }];
  let result;
  try { result = verifyQualificationLedger({ records, pointer: {} }); } catch (error) { assert(false, `threw ${error.stack}`); }
  assertEqual(result.status, 'FAIL', JSON.stringify(result.errors));
  assert(result.errors.some((error) => error.code === 'LEDGER-PAYLOAD-HASH'), JSON.stringify(result.errors));
});

test('nested promotion pointers require a committed promotion and verify pointer linkage', async () => {
  const { validateRelease, payloadHash, sha256, canonicalJson, recordHash } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const target = envelope({ artifactId: 'R28-04', payload: { manifest: true }, ownerRole: 'evidence-custodian' });
    target.payloadSha256 = payloadHash(target.payload);
    const pointerMeta = envelope({ artifactId: 'R28-04', payload: undefined, ownerRole: 'evidence-custodian' });
    delete pointerMeta.payload;
    pointerMeta.payloadSha256 = payloadHash({});
    const pointerPayload = {
      pointerVersion: '1.0.0',
      promotion: {
        state: 'ready', package: 'R28', generation: 1, targetArtifactId: 'R28-04',
        targetHash: target.payloadSha256,
        predecessorClosureHash: sha256(canonicalJson([])), requiredGate: 'Q0',
        publishedAt: '2026-01-01T00:00:00Z', previousPointerHash: null, revokedDescendantHashes: [],
      },
    };
    const pointer = { envelope: pointerMeta, payload: pointerPayload };
    pointer.envelope.payloadSha256 = payloadHash(pointer.payload);
    pointer.envelope.recordHash = recordHash(pointer);
    writeJson(path.join(root, 'records', 'R28-04.json'), target);
    writeJson(path.join(root, 'pointers', 'R28-04.json'), pointer);
    const registry = registryFor('R28-04');
    registry.artifacts[0].path = 'records/R28-04.json';
    registry.artifacts[0].ownerRoles = ['evidence-custodian'];
    registry.artifacts[0].pointer = true;
    registry.artifacts[0].visibility = 'grader-only';
    const roles = roster();
    roles.assignments[0].roleId = 'evidence-custodian';
    writeJson(path.join(root, 'registry.json'), registry);
    writeJson(path.join(root, 'roles.json'), roles);
    const result = validateRelease({ root, package: 'R28', registryPath: path.join(root, 'registry.json'), rolesPath: path.join(root, 'roles.json'), pointersDir: path.join(root, 'pointers') });
    assertEqual(result.status, 'INCOMPLETE', JSON.stringify(result));
    assert(result.errors.some((error) => error.code === 'PTR-COMMIT'), JSON.stringify(result.errors));
    assert(result.errors.some((error) => error.code === 'SNAPSHOT-MISSING'), JSON.stringify(result.errors));
  } finally {
    cleanup(root);
  }
});

// A one-artifact R28 release with a promotion pointer, so validateRelease reaches its
// ledger branch. Its own findings (an uncommitted promotion, no snapshot) are not what the
// tests below look at.
async function writePointerRelease(root) {
  const { payloadHash, sha256, canonicalJson, recordHash } = await import('../lib/release-validator.mjs');
  const target = envelope({ artifactId: 'R28-04', payload: { manifest: true }, ownerRole: 'evidence-custodian' });
  target.payloadSha256 = payloadHash(target.payload);
  const pointerMeta = envelope({ artifactId: 'R28-04', payload: undefined, ownerRole: 'evidence-custodian' });
  delete pointerMeta.payload;
  const pointer = {
    envelope: pointerMeta,
    payload: {
      pointerVersion: '1.0.0',
      promotion: {
        state: 'ready', package: 'R28', generation: 1, targetArtifactId: 'R28-04',
        targetHash: target.payloadSha256,
        predecessorClosureHash: sha256(canonicalJson([])), requiredGate: 'Q0',
        publishedAt: '2026-01-01T00:00:00Z', previousPointerHash: null, revokedDescendantHashes: [],
      },
    },
  };
  pointer.envelope.payloadSha256 = payloadHash(pointer.payload);
  pointer.envelope.recordHash = recordHash(pointer);
  writeJson(path.join(root, 'records', 'R28-04.json'), target);
  writeJson(path.join(root, 'pointers', 'R28-04.json'), pointer);
  const registry = registryFor('R28-04');
  registry.artifacts[0].ownerRoles = ['evidence-custodian'];
  registry.artifacts[0].pointer = true;
  const roles = roster();
  roles.assignments[0].roleId = 'evidence-custodian';
  writeJson(path.join(root, 'registry.json'), registry);
  writeJson(path.join(root, 'roles.json'), roles);
  // A single .qlog FILE, not a ledger directory: a directory would supply its own
  // genesis.json and checkpoints/, and hide whether the explicit paths were read at all.
  fs.mkdirSync(path.join(root, 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ledger', 'ledger.qlog'), '', 'utf8');
  return {
    root, package: 'R28',
    registryPath: path.join(root, 'registry.json'),
    rolesPath: path.join(root, 'roles.json'),
    pointersDir: path.join(root, 'pointers'),
    ledgerPath: path.join(root, 'ledger', 'ledger.qlog'),
  };
}

// Found 2026-10-11: `researcher-release validate` advertised --genesis and --checkpoints and
// parsed them, but validateRelease had no such parameters, so both were dropped before the
// ledger was verified. An operator who supplied a signed genesis believed it was checked.
test('validate verifies the genesis and checkpoints it is given, from the library and the CLI', async () => {
  const { validateRelease } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const inputs = await writePointerRelease(root);
    const genesisPath = path.join(root, 'anchors', 'genesis.json');
    const checkpointsDir = path.join(root, 'anchors', 'checkpoints');
    // Unsigned anchors: well-formed JSON, so they are read and then fail verification.
    writeJson(genesisPath, { ledgerVersion: '1.0.0', releaseId: 'release-1' });
    writeJson(path.join(checkpointsDir, 'checkpoint-1.json'), { ledgerVersion: '1.0.0', releaseId: 'release-1' });
    const result = validateRelease({ ...inputs, genesisPath, checkpointsDir });
    assert(result.errors.some((error) => error.code === 'LEDGER-GENESIS-SIGNATURE'), `the genesis was not verified: ${JSON.stringify(result.errors)}`);
    assert(result.errors.some((error) => error.code === 'LEDGER-CHECKPOINT-SIGNATURE' && error.path.startsWith('.checkpoints[0]')), `the checkpoint was not verified: ${JSON.stringify(result.errors)}`);
    assert(result.status !== 'PASS', JSON.stringify(result));

    const run = spawnSync(process.execPath, [
      'research-kit/bin/researcher-release.mjs', 'validate',
      '--root', root, '--package', 'R28', '--registry', inputs.registryPath,
      '--roles', inputs.rolesPath, '--pointers', inputs.pointersDir,
      '--ledger', inputs.ledgerPath, '--genesis', genesisPath, '--checkpoints', checkpointsDir, '--json',
    ], { encoding: 'utf8' });
    assert(run.status !== 0, `an unsigned genesis passed: ${run.stdout}`);
    const codes = JSON.parse(run.stdout).errors.map((error) => error.code);
    assert(codes.includes('LEDGER-GENESIS-SIGNATURE'), `the CLI dropped --genesis: ${codes.join(', ')}`);
    assert(codes.includes('LEDGER-CHECKPOINT-SIGNATURE'), `the CLI dropped --checkpoints: ${codes.join(', ')}`);
  } finally {
    cleanup(root);
  }
});

test('validate refuses a genesis or checkpoints path it would not read', async () => {
  const { validateRelease } = await import('../lib/release-validator.mjs');
  const root = tempRoot();
  try {
    const inputs = await writePointerRelease(root);
    const refusal = (result, word) => result.errors.find((error) => error.code === 'LEDGER-PATH' && error.message.includes(word));

    const missingGenesis = validateRelease({ ...inputs, genesisPath: path.join(root, 'no-such-genesis.json') });
    assert(refusal(missingGenesis, 'genesis'), `a missing genesis was ignored: ${JSON.stringify(missingGenesis.errors)}`);

    const missingCheckpoints = validateRelease({ ...inputs, checkpointsDir: path.join(root, 'no-such-checkpoints') });
    assert(refusal(missingCheckpoints, 'checkpoints'), `a missing checkpoints directory was ignored: ${JSON.stringify(missingCheckpoints.errors)}`);

    const outside = tempRoot();
    try {
      const outsideGenesis = path.join(outside, 'genesis.json');
      writeJson(outsideGenesis, { ledgerVersion: '1.0.0' });
      const escaped = validateRelease({ ...inputs, genesisPath: outsideGenesis });
      assert(refusal(escaped, 'genesis'), `a genesis outside the record root was accepted: ${JSON.stringify(escaped.errors)}`);
    } finally {
      cleanup(outside);
    }

    // Without --ledger nothing verifies a ledger, so a genesis given anyway would be dropped.
    writeJson(path.join(root, 'anchors', 'genesis.json'), { ledgerVersion: '1.0.0' });
    const noLedger = validateRelease({ ...inputs, ledgerPath: null, genesisPath: path.join(root, 'anchors', 'genesis.json') });
    assert(refusal(noLedger, '--ledger'), `a genesis without a ledger was ignored: ${JSON.stringify(noLedger.errors)}`);
    assert(noLedger.status !== 'PASS', JSON.stringify(noLedger));
  } finally {
    cleanup(root);
  }
});

test('descendant invalidation attributes multiple roots to each affected pointer', async () => {
  const { computeDescendantInvalidation } = await import('../lib/release-validator.mjs');
  const rootA = 'a'.repeat(64);
  const rootB = 'b'.repeat(64);
  const targetA = '1'.repeat(64);
  const targetB = '2'.repeat(64);
  const pointers = [
    { package: 'R28', generation: 1, recordId: 'branch-a', targetHash: targetA, predecessorHashes: [rootA] },
    { package: 'R29', generation: 1, recordId: 'branch-b', targetHash: targetB, predecessorHashes: [rootB] },
    { package: 'R30', generation: 1, recordId: 'join', targetHash: '3'.repeat(64), predecessorHashes: [targetA, targetB] },
    { package: 'R31', generation: 1, recordId: 'unaffected', targetHash: '4'.repeat(64), predecessorHashes: ['c'.repeat(64)] },
  ];

  const result = computeDescendantInvalidation({ pointers, invalidationRoots: [rootB, rootA] });

  assertEqual(result.status, 'PASS', JSON.stringify(result));
  assert.deepEqual(result.affectedPointers, ['branch-a', 'branch-b', 'join']);
  assert.deepEqual(result.revocations.map(({ recordId, invalidationRoots }) => ({ recordId, invalidationRoots })), [
    { recordId: 'branch-a', invalidationRoots: [rootA] },
    { recordId: 'branch-b', invalidationRoots: [rootB] },
    { recordId: 'join', invalidationRoots: [rootA, rootB] },
  ]);
});
