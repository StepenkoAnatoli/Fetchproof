// Synthetic property-generated canonical-hash and graph vectors agree across runners.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, assertEqual, requirePython, tempDir } from './harness.mjs';

// Ported 2026-09-20 under ADR-0029.
describe('property-vector-conformance');

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const VECTOR_FILE = path.join(ROOT, 'conformance', 'property-graph-hash-vectors.json');

function runNodeCli() {
  return spawnSync(process.execPath, [
    path.join(ROOT, 'bin', 'property-vector-conformance.mjs'), '--vectors', VECTOR_FILE, '--json',
  ], { encoding: 'utf8' });
}

test('Node runner verifies every exported canonical-hash and graph vector', async () => {
  const { loadPropertyVectors, runPropertyVectorConformance } = await import('../lib/property-vector-conformance.mjs');
  const packet = loadPropertyVectors(VECTOR_FILE);
  const result = runPropertyVectorConformance(packet);
  assertEqual(result.status, 'PASS', JSON.stringify(result));
  assertEqual(result.profile, 'researcher-property-vector-v1', JSON.stringify(result));
  assertEqual(result.vectorCount, packet.vectors.length, JSON.stringify(result));
  assert(result.vectors.every((row) => row.result === 'PASS'), JSON.stringify(result));
  assert(result.vectors.some((row) => row.kind === 'graph-invalidation' && row.affectedPointers.length > 0), JSON.stringify(result));
  assert(result.vectors.some((row) => row.kind === 'graph-invalidation' && row.status === 'FAIL' && row.primaryReason === 'graph.cycle'), JSON.stringify(result));
});

test('Node CLI produces a byte-identical report for exported property vectors', async () => {
  const { canonicalReportJson, loadPropertyVectors, runPropertyVectorConformance } = await import('../lib/property-vector-conformance.mjs');
  const expected = canonicalReportJson(runPropertyVectorConformance(loadPropertyVectors(VECTOR_FILE)));
  const first = runNodeCli();
  const second = runNodeCli();
  assertEqual(first.status, 0, first.stderr || first.stdout);
  assertEqual(second.status, 0, second.stderr || second.stdout);
  assertEqual(first.stdout, second.stdout, 'CLI report must be byte-deterministic');
  assertEqual(first.stdout, expected, 'CLI and library reports must agree');
});

test('Python independently reproduces exported property vector rows', () => {
  const python = spawnSync(requirePython('property vector Node/Python agreement'), [
    path.join(ROOT, 'bin', 'property_vector_conformance.py'), '--vectors', VECTOR_FILE, '--json',
  ], { encoding: 'utf8' });
  const node = runNodeCli();
  assertEqual(python.status, 0, python.stderr || python.stdout);
  assertEqual(node.status, 0, node.stderr || node.stdout);
  const pythonReport = JSON.parse(python.stdout);
  const nodeReport = JSON.parse(node.stdout);
  assertEqual(pythonReport.status, 'PASS', python.stdout);
  assertEqual(JSON.stringify(pythonReport.vectors), JSON.stringify(nodeReport.vectors), 'Python and Node vector rows must agree');
});

test('exported vectors are static synthetic values without release evidence', () => {
  const packet = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
  const text = JSON.stringify(packet).toLowerCase();
  assert(!text.includes('privatekey'), 'private key material must not be exported');
  assert(!text.includes('research/raw'), 'research captures must not be exported');
  assert(!text.includes('fixture'), 'benchmark fixtures must not be exported');
});

test('exported graph and hash values remain bound to their declared property seeds', async () => {
  const packet = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
  const { propertyInput } = await import('../lib/property-replay.mjs');
  const hashSource = packet.sourceCases['PV-H-01'];
  const graphSource = packet.sourceCases['G-17'];
  const hashInput = propertyInput(hashSource);
  const graphInput = propertyInput(graphSource);
  const hashVector = packet.vectors.find((vector) => vector.vectorId === 'PV-H-01');
  assertEqual(JSON.stringify(hashVector.value), JSON.stringify(hashInput.base), 'canonical vector must be the declared generated hash input');
  assertEqual(JSON.stringify(packet.graphs['G-17']), JSON.stringify(graphInput.pointers), 'graph vector must be the declared generated graph input');
});

// Found 2026-10-17 (#339): outside the shipped vectors the two runners computed different
// descendant sets. Node's closure for a pointer is its own targetHash plus the transitive
// predecessor closure, so a root naming a pointer's own target revokes that pointer; Python
// walked reverse predecessor edges only and did not. Python also refused two pointers that
// share a targetHash as a duplicate record, where Node keys identity on (package, generation,
// recordId); said "descendants.invalidated" for an empty set, where Node says
// "descendants.none"; and ranked R26/R27 last. A review of the fix found two more: past 2**53
// Node holds a generation or a numeric root as the nearest double, which Python's int did not
// (two generations Node calls one were two, and a root printed with digits Node rounds away);
// and Node's own rank table was a plain object, so recordId "__proto__" and package
// "constructor" read the prototype and sorted by NaN. Each expectation below is Node's answer.
test('Python and Node compute the same descendant rows for own-target roots, shared targets, no roots, R27, integers past 2**53 and prototype names', () => {
  const python = requirePython('property graph Node/Python agreement off the shipped vectors');
  const packet = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
  const graph = packet.graphs['G-17'];
  const target = (recordId) => graph.find((pointer) => pointer.recordId === recordId).targetHash;
  const leaf = 'da7941c840d997b9a19ab248c0e60a0dc2ca5bbe2e716f36f5b24972c71eda50';
  packet.graphs['X-SHARED'] = [...graph, { ...graph[0], recordId: 'P28-17-dup' }];
  packet.graphs['X-RANK'] = [
    { package: 'R33', generation: 1, recordId: 'Q33', targetHash: 'b'.repeat(64), predecessorHashes: [leaf] },
    { package: 'R27', generation: 1, recordId: 'Q27', targetHash: 'c'.repeat(64), predecessorHashes: ['b'.repeat(64)] },
  ];
  // "__G2^53__" and "__G2^53+1__" become integer literals after JSON.stringify, which cannot write 2**53 + 1.
  const at = (generation, recordId, targetHash, pkg = 'R28') => ({ package: pkg, generation, recordId, targetHash, predecessorHashes: [leaf] });
  packet.graphs['X-BIG-DUP'] = [at('__G2^53__', 'a', 'd'.repeat(64)), at('__G2^53+1__', 'a', 'e'.repeat(64))];
  packet.graphs['X-BIG-SORT'] = [at('__G2^53+1__', 'a', 'f'.repeat(64)), at('__G2^53__', 'b', '1'.repeat(64))];
  packet.graphs['X-BIG-ROOT'] = [at(1, 'r', '9007199254740992')];
  packet.graphs['X-PROTO'] = [at(1, 'A', '2'.repeat(64), 'R33'), at(1, '__proto__', '3'.repeat(64)), at(1, '0C', '4'.repeat(64), 'constructor')];
  const all = ['P28-17', 'P29A-17', 'P30-17', 'P31-17', 'P32-17', 'P33-17'];
  const vector = (vectorId, graphId, invalidationRoots, affected) => ({
    vectorId, kind: 'graph-invalidation', graphId, invalidationRoots, expectedStatus: 'PASS',
    expectedPrimaryReason: affected.length ? 'descendants.invalidated' : 'descendants.none',
    expectedAffectedPointers: affected, expectedRevocationRecordIds: affected,
  });
  packet.vectors = [
    vector('X-OWN', 'G-17', [target('P30-17')], all.slice(2)),
    vector('X-NONE', 'G-17', [target('P33-17')], ['P33-17']),
    vector('X-DUPTARGET', 'X-SHARED', [leaf], ['P28-17', 'P28-17-dup', ...all.slice(1)]),
    vector('X-EMPTY', 'G-17', [], []),
    vector('X-RANK', 'X-RANK', [leaf], ['Q27', 'Q33']),
    { ...vector('X-BIG-DUP', 'X-BIG-DUP', [leaf], []), expectedStatus: 'FAIL', expectedPrimaryReason: 'graph.duplicate-record' },
    vector('X-BIG-SORT', 'X-BIG-SORT', [leaf], ['a', 'b']),
    vector('X-BIG-ROOT', 'X-BIG-ROOT', ['__R2^53+1__'], ['r']),
    vector('X-PROTO', 'X-PROTO', [leaf], ['__proto__', 'A', '0C']),
  ];
  const file = path.join(tempDir('rk-pv-graph-'), 'packet.json');
  fs.writeFileSync(file, JSON.stringify(packet)
    .replaceAll('"__G2^53__"', '9007199254740992').replaceAll('"__G2^53+1__"', '9007199254740993').replaceAll('"__R2^53+1__"', '9007199254740993'));
  const reports = [[process.execPath, 'property-vector-conformance.mjs'], [python, 'property_vector_conformance.py']].map(([exe, runner]) => {
    const r = spawnSync(exe, [path.join(ROOT, 'bin', runner), '--vectors', file, '--json'], { encoding: 'utf8' });
    assert(!/Traceback/.test(r.stderr), `${runner} crashed:\n${r.stderr.slice(-400)}`);
    return JSON.parse(r.stdout);
  });
  const [node, py] = reports;
  for (const row of node.vectors) assertEqual(row.result, 'PASS', `Node ${row.vectorId}: ${JSON.stringify(row)}`);
  assertEqual(JSON.stringify(py.vectors), JSON.stringify(node.vectors), 'Python and Node graph rows must agree');
});
