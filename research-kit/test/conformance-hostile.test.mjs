// A hostile vector packet gets the same structured FAIL from both languages.
//
// Found 2026-09-28 (Arena break test 4, F-02): a packet nested 200,000 arrays deep made
// all three Python runners print a RecursionError traceback, while their Node twins
// wrote a FAIL report and exited 1. RecursionError is not a JSONDecodeError, so no
// parse site caught it - and the --json contract broke exactly where a host compares
// the two languages.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, tempDir, requirePython } from './harness.mjs';

describe('conformance-hostile');

const BIN = path.resolve(fileURLToPath(new URL('../bin', import.meta.url)));
const RUNNERS = [
  ['ledger-conformance.mjs', 'ledger_conformance.py'],
  ['property-vector-conformance.mjs', 'property_vector_conformance.py'],
  ['fi-sidecar-conformance.mjs', 'fi_sidecar_conformance.py'],
];

test('a packet nested too deep to parse is a structured FAIL in Node and Python alike', () => {
  const python = requirePython('the Python runners on a hostile packet');
  const packet = path.join(tempDir('rk-deep-packet-'), 'deep.json');
  fs.writeFileSync(packet, `${'['.repeat(200_000)}${']'.repeat(200_000)}`);
  for (const [nodeRunner, pythonRunner] of RUNNERS) {
    const reports = [
      spawnSync(process.execPath, [path.join(BIN, nodeRunner), '--vectors', packet, '--json'], { encoding: 'utf8' }),
      spawnSync(python, [path.join(BIN, pythonRunner), '--vectors', packet, '--json'], { encoding: 'utf8' }),
    ].map((r, i) => {
      const who = i ? pythonRunner : nodeRunner;
      assert.equal(r.status, 1, `${who} exited ${r.status}:\n${(r.stderr || r.stdout).slice(-400)}`);
      assert.doesNotMatch(r.stderr, /Traceback/, `${who} crashed instead of reporting:\n${r.stderr.slice(-400)}`);
      const report = JSON.parse(r.stdout);
      assert.equal(report.status, 'FAIL', who);
      return report;
    });
    assert.equal(reports[1].errors?.[0]?.code, reports[0].errors?.[0]?.code, `${pythonRunner} and ${nodeRunner} name different codes`);
  }
});

// Found 2026-09-28 (Arena break test 5): two packets both languages PARSE, that the Python
// runners then crashed on while canonicalising - a traceback and no report, where the Node
// twin reported. An object key holding an unpaired surrogate: the key sort encoded it
// before json_string, whose job is to refuse it, ever ran. And a packet deep enough to
// parse but too deep to canonicalise (a few hundred levels): only the parse sites caught
// RecursionError. Each hostile value goes into the first vector of the runner's own
// shipped packet, so the packet is otherwise valid.
const SHIPPED = {
  'ledger-conformance.mjs': 'qualification-ledger-vectors.json',
  'property-vector-conformance.mjs': 'property-graph-hash-vectors.json',
  'fi-sidecar-conformance.mjs': 'fi-sidecar-evidence-manifest-vectors.json',
};
const CONFORMANCE = path.resolve(fileURLToPath(new URL('../conformance', import.meta.url)));

function hostile(nodeRunner, value) {
  const packet = JSON.parse(fs.readFileSync(path.join(CONFORMANCE, SHIPPED[nodeRunner]), 'utf8'));
  if (packet.documents) packet.documents[Object.keys(packet.documents)[0]].hostile = value;
  else packet.vectors[0].value = value;
  const file = path.join(tempDir('rk-hostile-'), 'packet.json');
  fs.writeFileSync(file, JSON.stringify(packet)); // JSON.stringify writes a lone surrogate as \ud800
  return file;
}

function nested(depth) {
  const root = {};
  let at = root;
  for (let i = 0; i < depth; i += 1) { at.k = {}; at = at.k; }
  return root;
}

for (const [label, value] of [['an unpaired-surrogate key', { a: 1, '\ud800': 2 }], ['a packet nested 600 deep', nested(600)]]) {
  test(`${label} is a report from every Python runner, never a traceback`, () => {
    const python = requirePython(`the Python runners on ${label}`);
    for (const [nodeRunner, pythonRunner] of RUNNERS) {
      const packet = hostile(nodeRunner, value);
      const r = spawnSync(python, [path.join(BIN, pythonRunner), '--vectors', packet, '--json'], { encoding: 'utf8' });
      assert.doesNotMatch(r.stderr, /Traceback/, `${pythonRunner} crashed on ${label}:\n${r.stderr.slice(-400)}`);
      assert.equal(r.status, 1, `${pythonRunner} exited ${r.status} on ${label}`);
      assert.equal(JSON.parse(r.stdout).status, 'FAIL', pythonRunner);
    }
  });
}

// The two languages must also AGREE on such a vector. The canonical-serialization spec
// (docs/superpowers/specs/2026-09-16-researcher-benchmark-release-canonical-serialization.md,
// rule 3) rejects unpaired UTF-16 surrogates, and Python always did; Node escaped one as
// "\ud800" and hashed it, so a vector expecting that hash PASSED in Node and was refused
// in Python (Arena break test 5).
test('an unpaired surrogate is refused by the Node canonicaliser too, so both languages agree', () => {
  const python = requirePython('Node/Python agreement on an unpaired surrogate');
  const packet = JSON.parse(fs.readFileSync(path.join(CONFORMANCE, SHIPPED['ledger-conformance.mjs']), 'utf8'));
  const canonical = '{"a":"\\ud800"}'; // what Node produced for it
  packet.vectors = [{
    ...packet.vectors[0], value: { a: '\ud800' }, expectedCanonical: canonical,
    expectedSha256: crypto.createHash('sha256').update(canonical).digest('hex'),
  }];
  const file = path.join(tempDir('rk-surrogate-'), 'packet.json');
  fs.writeFileSync(file, JSON.stringify(packet));
  for (const [exe, runner] of [[process.execPath, 'ledger-conformance.mjs'], [python, 'ledger_conformance.py']]) {
    const r = spawnSync(exe, [path.join(BIN, runner), '--vectors', file, '--json'], { encoding: 'utf8' });
    assert.doesNotMatch(r.stderr, /Traceback|at .*\.mjs:\d+/, `${runner} crashed:\n${r.stderr.slice(-400)}`);
    assert.equal(JSON.parse(r.stdout).status, 'FAIL', `${runner} accepted an unpaired surrogate`);
    assert.equal(r.status, 1, runner);
  }
});

// The refusal must not reach a well-formed surrogate PAIR: an astral character (here U+1F600)
// is ordinary text, in a key and in a value, and both languages must still hash it alike.
test('an astral character is still canonical, and Node and Python hash it alike', () => {
  const python = requirePython('Node/Python agreement on an astral character');
  const packet = JSON.parse(fs.readFileSync(path.join(CONFORMANCE, SHIPPED['ledger-conformance.mjs']), 'utf8'));
  const canonical = '{"\u{1F600}":"a\u{1F600}b"}';
  packet.vectors = [{
    ...packet.vectors[0], value: { '\u{1F600}': 'a\u{1F600}b' }, expectedCanonical: canonical,
    expectedSha256: crypto.createHash('sha256').update(canonical).digest('hex'),
  }];
  const file = path.join(tempDir('rk-astral-'), 'packet.json');
  fs.writeFileSync(file, JSON.stringify(packet));
  for (const [exe, runner] of [[process.execPath, 'ledger-conformance.mjs'], [python, 'ledger_conformance.py']]) {
    const r = spawnSync(exe, [path.join(BIN, runner), '--vectors', file, '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(r.stdout).status, 'PASS', `${runner} refused an astral character:\n${(r.stdout || r.stderr).slice(0, 400)}`);
  }
});

// #336 (2026-10-17): Node's reader fed a "__proto__" key to the prototype setter, so the
// member dropped out of the canonical form ({"a":1}) while Python kept it - one vector,
// hash.mismatch in one language and PASS in the other. Both must keep it.
test('a "__proto__" key is canonicalised alike by Node and Python', () => {
  const python = requirePython('Node/Python agreement on a "__proto__" key');
  const packet = JSON.parse(fs.readFileSync(path.join(CONFORMANCE, SHIPPED['ledger-conformance.mjs']), 'utf8'));
  const canonical = '{"__proto__":{"artifactId":"R28-01"},"a":1}';
  packet.vectors = [{
    ...packet.vectors[0], value: JSON.parse(canonical), expectedCanonical: canonical,
    expectedSha256: crypto.createHash('sha256').update(canonical).digest('hex'),
  }];
  const file = path.join(tempDir('rk-proto-'), 'packet.json');
  const text = JSON.stringify(packet); // JSON.parse made "__proto__" an own key, so it is written
  assert.match(text, /"__proto__":\{"artifactId":"R28-01"\}/);
  fs.writeFileSync(file, text);
  for (const [exe, runner] of [[process.execPath, 'ledger-conformance.mjs'], [python, 'ledger_conformance.py']]) {
    const r = spawnSync(exe, [path.join(BIN, runner), '--vectors', file, '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(r.stdout).status, 'PASS', `${runner} hashed other bytes:\n${(r.stdout || r.stderr).slice(0, 600)}`);
    assert.equal(r.status, 0, runner);
  }
});

// Review of #340 (2026-10-18): a guard that made the schema subset treat an unpaired
// surrogate as unequal to every const, enum member and other item moved the FI runner's
// Node answer to SCHEMA-ONE-OF/SCHEMA-CONST/SCHEMA-PATTERN/SCHEMA-ADDITIONAL while Python
// still said JSON-PARSE. The refusal stays a throw in the schema subset, so both agree.
// The vectors live in a test-local packet built from the shipped one.
test('an unpaired surrogate in an FI const, enum or unique item gets one code from Node and Python', () => {
  const python = requirePython('Node/Python agreement on an FI unpaired surrogate');
  const packet = JSON.parse(fs.readFileSync(path.join(CONFORMANCE, SHIPPED['fi-sidecar-conformance.mjs']), 'utf8'));
  const field = packet.documents.sidecar.fields[0];
  packet.vectors = [
    ['X-SUR-ENUM', [{ op: 'set', path: '/status', value: '\ud800' }]],
    ['X-SUR-CONST', [{ op: 'set', path: '/recordVersion', value: '\ud800' }]],
    ['X-SUR-UNIQUE', [{ op: 'set', path: '/fields/0/evidenceIds', value: ['\ud800', '\ud800'] }]],
    ['X-SUR-NOTES', [{ op: 'set', path: '/fields', value: [{ ...field, note: '\ud800' }, { ...field, note: '\ud800' }] }]],
  ].map(([vectorId, patches]) => ({ vectorId, target: 'sidecar', base: 'sidecar', patches, expectedCode: 'JSON-PARSE' }));
  const file = path.join(tempDir('rk-fi-surrogate-'), 'packet.json');
  fs.writeFileSync(file, JSON.stringify(packet)); // JSON.stringify writes a lone surrogate as \ud800
  const rows = [[process.execPath, 'fi-sidecar-conformance.mjs'], [python, 'fi_sidecar_conformance.py']].map(([exe, runner]) => {
    const r = spawnSync(exe, [path.join(BIN, runner), '--vectors', file, '--json'], { encoding: 'utf8' });
    assert.doesNotMatch(r.stderr, /Traceback|at .*\.mjs:\d+/, `${runner} crashed:\n${r.stderr.slice(-400)}`);
    return JSON.parse(r.stdout).vectors;
  });
  for (const node of rows[0]) {
    const py = rows[1].find((row) => row.vectorId === node.vectorId);
    assert.equal(py?.observedCode, node.observedCode, `${node.vectorId}: Python says ${py?.observedCode}, Node says ${node.observedCode}`);
  }
});

// ADR-0083 (2026-09-28, Arena break test 11): both languages refuse a packet nested deeper
// than 256 levels, and agree below it. Node took thousands of levels and CPython about
// 300 before its canonicaliser hit the recursion limit, so the same packet was a result in
// one language and a refusal in the other - the kind of disagreement these runners exist
// to rule out. The value goes into the runner's own shipped packet, so only depth varies.
test('Node and Python refuse a packet nested past 256 levels alike, and agree below it', () => {
  const python = requirePython('Node/Python agreement on nesting depth');
  for (const [nodeRunner, pythonRunner] of RUNNERS) {
    for (const [depth, over] of [[260, true], [240, false]]) {
      const packet = hostile(nodeRunner, nested(depth));
      const reports = [[process.execPath, nodeRunner], [python, pythonRunner]].map(([exe, runner]) => {
        const r = spawnSync(exe, [path.join(BIN, runner), '--vectors', packet, '--json'], { encoding: 'utf8' });
        assert.doesNotMatch(r.stderr, /Traceback|RangeError|at .*\.mjs:\d+/, `${runner} crashed at ${depth}:\n${r.stderr.slice(-400)}`);
        return { runner, status: r.status, report: JSON.parse(r.stdout) };
      });
      const [node, py] = reports;
      assert.equal(py.report.status, node.report.status, `${depth} deep: ${pythonRunner} says ${py.report.status}, ${nodeRunner} says ${node.report.status}`);
      assert.equal(py.report.errors?.[0]?.code, node.report.errors?.[0]?.code, `${depth} deep: the two name different codes`);
      if (over) {
        for (const { runner, report } of reports) {
          assert.equal(report.status, 'FAIL', `${runner} accepted a packet nested ${depth} deep`);
          assert.match(JSON.stringify(report.errors), /nested deeper than 256 levels/, `${runner} did not name the limit`);
        }
      }
    }
  }
});

// Follow-up to Arena break test 12: Python now canonicalises an integer outside +/-2**53
// through float(), as JavaScript parses it - but float() RAISES OverflowError past about
// 1.8e308, and json.loads raises ValueError past 4300 digits. Neither is caught, so a
// packet holding such an integer was a traceback in Python where Node refuses it by name
// ("non-finite number"). Both must be the same structured FAIL.
test('an integer too large for a double is refused alike by Node and Python', () => {
  const python = requirePython('Node/Python agreement on an integer past the double range');
  for (const digits of [400, 5000]) {
    const packet = JSON.parse(fs.readFileSync(path.join(CONFORMANCE, SHIPPED['ledger-conformance.mjs']), 'utf8'));
    packet.vectors[0].value = '__BIG__';
    const file = path.join(tempDir('rk-bigint-'), 'packet.json');
    fs.writeFileSync(file, JSON.stringify(packet).replace('"__BIG__"', `1${'0'.repeat(digits)}`));
    const reports = [[process.execPath, 'ledger-conformance.mjs'], [python, 'ledger_conformance.py']].map(([exe, runner]) => {
      const r = spawnSync(exe, [path.join(BIN, runner), '--vectors', file, '--json'], { encoding: 'utf8' });
      assert.doesNotMatch(r.stderr, /Traceback|at .*\.mjs:\d+/, `${runner} crashed on ${digits} digits:\n${r.stderr.slice(-400)}`);
      assert.equal(r.status, 1, `${runner} exited ${r.status} on ${digits} digits`);
      return JSON.parse(r.stdout);
    });
    assert.equal(reports[1].status, 'FAIL');
    assert.equal(reports[1].errors?.[0]?.code, reports[0].errors?.[0]?.code, `${digits} digits: the two name different codes`);
    assert.match(JSON.stringify(reports[1].errors), /non-finite number/, `${digits} digits: Python did not say why`);
  }
});

// Found 2026-09-29 (break-test report, F1): a packet opening with a UTF-8 BOM got "UTF-8
// BOM is not permitted" from two Python runners and CPython's own "Unexpected UTF-8 BOM
// (decode using utf-8-sig)" from the third - `property_vector_conformance.py` reads its
// packet itself instead of through `read_packet`, and had no BOM check of its own.
test('a packet opening with a BOM is refused by name in every runner, both languages', () => {
  const python = requirePython('the Python runners on a BOM packet');
  const packet = path.join(tempDir('rk-bom-packet-'), 'bom.json');
  fs.writeFileSync(packet, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')]));
  for (const [nodeRunner, pythonRunner] of RUNNERS) {
    for (const [who, cmd, script] of [[nodeRunner, process.execPath, nodeRunner], [pythonRunner, python, pythonRunner]]) {
      const r = spawnSync(cmd, [path.join(BIN, script), '--vectors', packet, '--json'], { encoding: 'utf8' });
      assert.equal(r.status, 1, `${who} exited ${r.status}`);
      const message = JSON.parse(r.stdout).errors?.[0]?.message ?? '';
      assert.match(message, /UTF-8 BOM is not permitted/, `${who} said: ${message}`);
    }
  }
});
