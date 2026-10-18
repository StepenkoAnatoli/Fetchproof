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

// Found 2026-10-17 (#338): three documents the shipped FI packet did not cover, on which the
// Python sidecar runner disagreed with Node. JavaScript's `$` matches only at the end of the
// input and Python's also before a trailing newline, so a hash with a stray "\n" passed in
// Python; `1e400` parsed to inf in Python and was type-checked, where Node refuses it as a
// non-finite number; and `0.0` failed Python's `integer` check, though JavaScript cannot tell
// it from `0`. Two more were found beside them: Python's `\d` matches any Unicode digit and
// JavaScript's (no `u` flag) only 0-9; and `maxLength` counts UTF-16 code units in Node, so
// 300 astral characters are 600 there and 300 to Python's `len`. A review of that fix found
// three more: JavaScript's `.` stops at U+2028/U+2029 and Python's does not, so the path
// lookaheads read past a U+2028 to a `/../` or a NUL in Python only; and a uniqueItems array of
// ONE item is never canonicalised in Node (it compares pairs), so a lone surrogate in it passed
// there and was refused in Python. Each expected code is Node's.
test('FI documents with a trailing newline, 1e400, 0.0, a non-ASCII digit, astral text, U+2028 or a lone surrogate get one code in Node and Python', () => {
  const python = requirePython('Node/Python agreement on FI pattern and number edges');
  const packet = JSON.parse(fs.readFileSync(path.join(CONFORMANCE, SHIPPED['fi-sidecar-conformance.mjs']), 'utf8'));
  const { sidecar, manifest } = packet.documents;
  const withByteLength = (literal) => {
    const document = structuredClone(manifest);
    document.entries[0].byteLength = '__N__';
    return JSON.stringify(document).replace('"__N__"', literal);
  };
  packet.vectors = [
    { vectorId: 'X-NL', target: 'sidecar', rawDocument: JSON.stringify({ ...sidecar, workbookSha256: `${'a'.repeat(64)}\n` }), expectedCode: 'SCHEMA-PATTERN' },
    { vectorId: 'X-1E400', target: 'manifest', rawDocument: withByteLength('1e400'), expectedCode: 'JSON-PARSE' },
    { vectorId: 'X-0.0', target: 'manifest', rawDocument: withByteLength('0.0'), expectedCode: 'PASS' },
    { vectorId: 'X-DIGIT', target: 'sidecar', rawDocument: JSON.stringify({ ...sidecar, identity: { ...sidecar.identity, operatorStartedAt: '\u0662\u0660\u0662\u0666-09-17T00:00:00Z' } }), expectedCode: 'SCHEMA-PATTERN' },
    { vectorId: 'X-ASTRAL', target: 'manifest', rawDocument: JSON.stringify({ ...manifest, entries: [{ ...manifest.entries[0], fieldLabel: '\u{1F600}'.repeat(300) }] }), expectedCode: 'SCHEMA-MAX-LENGTH' },
    { vectorId: 'X-LS', target: 'sidecar', rawDocument: JSON.stringify({ ...sidecar, workbookPath: 'x /../../outside.xlsx' }), expectedCode: 'PASS' },
    { vectorId: 'X-PS-NUL', target: 'manifest', rawDocument: JSON.stringify({ ...manifest, root: 'x \u0000.json' }), expectedCode: 'PASS' },
    { vectorId: 'X-SURROGATE-1', target: 'manifest', rawDocument: JSON.stringify({ ...manifest, entries: [{ ...manifest.entries[0], path: '\ud800x' }] }), expectedCode: 'PASS' },
    { vectorId: 'X-SURROGATE-2', target: 'manifest', rawDocument: JSON.stringify({ ...manifest, entries: [{ ...manifest.entries[0], path: '\ud800x' }, { ...manifest.entries[0], evidenceId: 'FI-01-other' }] }), expectedCode: 'JSON-PARSE' },
    // An array index in a patch path is canonical ASCII digits in Node; `str.isdigit` also took
    // "00" and "٠", whose int() is 0, and patched the first item. And Python's refusal of
    // any patch path read JSON-PARSE: its PacketError is a ValueError, caught by that clause first.
    { vectorId: 'X-PATH-MISSING', target: 'sidecar', base: 'sidecar', patches: [{ op: 'remove', path: '/nope/x' }], expectedCode: 'VECTOR-PACKET' },
    { vectorId: 'X-INDEX-00', target: 'sidecar', base: 'sidecar', patches: [{ op: 'set', path: '/fields/00/label', value: 'Changed' }], expectedCode: 'VECTOR-PACKET' },
    { vectorId: 'X-INDEX-ARABIC', target: 'sidecar', base: 'sidecar', patches: [{ op: 'remove', path: '/fields/٠' }], expectedCode: 'VECTOR-PACKET' },
  ];
  const file = path.join(tempDir('rk-fi-edges-'), 'packet.json');
  fs.writeFileSync(file, JSON.stringify(packet));
  const rows = [[process.execPath, 'fi-sidecar-conformance.mjs'], [python, 'fi_sidecar_conformance.py']].map(([exe, runner]) => {
    const r = spawnSync(exe, [path.join(BIN, runner), '--vectors', file, '--json'], { encoding: 'utf8' });
    assert.doesNotMatch(r.stderr, /Traceback|at .*\.mjs:\d+/, `${runner} crashed:\n${r.stderr.slice(-400)}`);
    return JSON.parse(r.stdout).vectors;
  });
  for (const vector of packet.vectors) {
    const [node, py] = rows.map((vectors) => vectors.find((row) => row.vectorId === vector.vectorId));
    assert.equal(node?.observedCode, vector.expectedCode, `Node ${vector.vectorId}: ${JSON.stringify(node)}`);
    assert.equal(py?.observedCode, node.observedCode, `${vector.vectorId}: Python says ${py?.observedCode}, Node says ${node.observedCode}`);
  }
});

// Found 2026-10-18 (review of #338/#339): a Python runner wrote its report through the text
// layer, which on a Windows pipe is the locale's code page, so a report holding a character
// outside cp1252 raised UnicodeEncodeError - a traceback where Node reported - and a lone
// surrogate could not be encoded at all, where JSON.stringify escapes it. PYTHONIOENCODING
// makes that pipe on any host.
test('a report holding non-Latin-1 text or a lone surrogate is the same JSON from Node and Python on a cp1252 pipe', () => {
  const python = requirePython('Python report output on a cp1252 pipe');
  // The ledger and property runners canonicalise, and so refuse a lone surrogate alike in both
  // languages; the FI runner reports it, escaped. The CJK/emoji ID reaches every report.
  for (const vectorId of ['X-\u4e2d\u{1F600}', 'X-\u4e2d-\ud800']) {
    for (const [nodeRunner, pythonRunner] of RUNNERS) {
      const packet = JSON.parse(fs.readFileSync(path.join(CONFORMANCE, SHIPPED[nodeRunner]), 'utf8'));
      packet.vectors[0].vectorId = vectorId;
      const file = path.join(tempDir('rk-cp1252-'), 'packet.json');
      fs.writeFileSync(file, JSON.stringify(packet));
      const [node, py] = [[process.execPath, nodeRunner], [python, pythonRunner]].map(([exe, runner]) => {
        const env = { ...process.env, PYTHONIOENCODING: 'cp1252' };
        const r = spawnSync(exe, [path.join(BIN, runner), '--vectors', file, '--json'], { encoding: 'utf8', env });
        assert.doesNotMatch(r.stderr, /Traceback/, `${runner} crashed:\n${r.stderr.slice(-400)}`);
        const report = JSON.parse(r.stdout);
        return JSON.stringify([report.status, report.vectors.map((row) => row.vectorId), (report.errors ?? []).map((error) => error.code)]);
      });
      if (!vectorId.includes('\ud800') || nodeRunner === 'fi-sidecar-conformance.mjs') {
        assert.ok(node.includes(JSON.stringify(vectorId)), `${nodeRunner} did not report ${JSON.stringify(vectorId)}: ${node}`);
      }
      assert.equal(py, node, `${pythonRunner} and ${nodeRunner} report differently for ${JSON.stringify(vectorId)}`);
    }
  }
});
