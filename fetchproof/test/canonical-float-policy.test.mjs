// The float boundary: where Node and Python canonicalisation actually diverged.
//
// Until 2026-09-20 three Python runners each carried their own canonicaliser. Two
// hand-wrote the same one; the third called `json.dumps(sort_keys=True)`, which is a
// different algorithm, and the difference was a different SHA-256:
//
//     {"a": 1.0}   Node {"a":1}    sha 015abd7f...   Python {"a":1.0}   sha c29a44ab...
//     {"a": -0.0}  Node {"a":0}    sha 45b619e9...   Python {"a":-0.0}  sha 952b7dc4...
//
// Cross-language agreement was asserted over 28 chosen vectors, none of which contained
// a float, so the suite was green and the claim was not true.
//
// These tests compare the FUNCTIONS rather than a fixed vector list. Every case runs
// through Node's canonicalJson and through the shared Python module, and the bytes must
// match — so a future edit to either side has to keep them matching, on inputs nobody
// remembered to put in a packet.

import { spawnSync } from 'node:child_process';
import { test, describe, assert, fs, path, KIT_ROOT, requireCapability, findPython } from './harness.mjs';
import { canonicalJson, sha256 } from '../lib/release-validator.mjs';

describe('canonical-float-policy');

const COMMON = path.join(KIT_ROOT, 'bin', 'conformance_common.py');

/** Is there a usable python on this host? The Python runners are part of the contract. */
const PYTHON = findPython();

/**
 * A host without Python cannot run these tests, and that is NOT a skip.
 *
 * The first version of this file returned early instead, which printed `ok` having
 * asserted nothing. That is precisely the false green `Unsupported` exists to prevent,
 * and it was worst here of all places: the defect under test IS a Node/Python
 * divergence, so a green run with no Python validates nothing at all while claiming the
 * two languages agree.
 *
 * `requireCapability` reports it under its own label with a reason code, and it BLOCKS -
 * `runPending` counts it and the runner exits non-zero.
 */
const python = () => requireCapability(PYTHON, 'PYTHON-NOT-FOUND',
  'no python on this host, so Node/Python canonical agreement cannot be checked');

// A float cannot cross this boundary as JSON, and that nearly made these tests vacuous.
//
// The first version sent cases with `JSON.stringify`, so `{a: 1.0}` arrived in Python as
// `{"a": 1}` — an integer. The test for the float defect was not exercising a float at
// all, and passed for that reason. Floats therefore travel as a tagged marker and are
// rebuilt on each side from the SAME spec, so the two cannot drift.
const F = (literal) => ({ __float__: literal });

/** Rebuild a spec into real JS values, turning every marker back into a number. */
function decode(spec) {
  if (Array.isArray(spec)) return spec.map(decode);
  if (spec && typeof spec === 'object') {
    if (typeof spec.__float__ === 'string') return Number(spec.__float__);
    return Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, decode(v)]));
  }
  return spec;
}

const DECODER = [
  'def decode(v):',
  '    if isinstance(v, list): return [decode(x) for x in v]',
  '    if isinstance(v, dict):',
  '        if isinstance(v.get("__float__"), str): return float(v["__float__"])',
  '        return {k: decode(x) for k, x in v.items()}',
  '    return v',
].join('\n');

/** Canonicalise a spec through the shared Python module. */
function pythonCanonical(specs, policy) {
  const script = [
    'import json, sys, importlib.util',
    `spec = importlib.util.spec_from_file_location("c", ${JSON.stringify(COMMON)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    DECODER,
    'out = []',
    'for raw in json.loads(sys.argv[1]):',
    '    try:',
    `        out.append(m.canonical_json(decode(raw), float_policy=${JSON.stringify(policy)}))`,
    '    except Exception as e:',
    '        out.append("ERROR:" + type(e).__name__)',
    'sys.stdout.write(json.dumps(out))',
  ].join('\n');
  const run = spawnSync(PYTHON, ['-c', script, JSON.stringify(specs)], {
    encoding: 'utf8', timeout: 60_000, windowsHide: true,
  });
  if (run.status !== 0) throw new Error(`python failed: ${run.stderr?.slice(0, 300)}`);
  return JSON.parse(run.stdout);
}

/**
 * The guard for the bug above — and it has to run in PYTHON, not here.
 *
 * JavaScript has one number type. `Number('1.0') === 1`, so a "float case" decoded on
 * this side is indistinguishable from an integer and asserting otherwise is impossible.
 * That asymmetry IS the defect: Python distinguishes `1.0` from `1`, and must emit what
 * JavaScript emits for the same numeric value. So the check asks Python what it actually
 * received.
 */
function pythonTypes(specs) {
  const script = [
    'import json, sys',
    DECODER,
    'def flatten(v):',
    '    if isinstance(v, list):',
    '        for x in v:',
    '            yield from flatten(x)',
    '    elif isinstance(v, dict):',
    '        for x in v.values():',
    '            yield from flatten(x)',
    '    else:',
    '        yield v',
    'out = []',
    'for raw in json.loads(sys.argv[1]):',
    '    values = list(flatten(decode(raw)))',
    '    out.append("float" if any(isinstance(x, float) for x in values) else "no-float")',
    'sys.stdout.write(json.dumps(out))',
  ].join('\n');
  const run = spawnSync(PYTHON, ['-c', script, JSON.stringify(specs)], {
    encoding: 'utf8', timeout: 60_000, windowsHide: true,
  });
  if (run.status !== 0) throw new Error(`python failed: ${run.stderr?.slice(0, 300)}`);
  return JSON.parse(run.stdout);
}

// The cases that mattered, plus the ones that would have been missed by fixing only
// those: both exponent thresholds, the smallest denormal, and a repeating fraction.
const CASES = [
  { a: F('1.0') },          // the original defect: Node "1", the old Python "1.0"
  { a: F('-0.0') },         // the original defect: Node "0",  the old Python "-0.0"
  { a: F('1.5') },
  { a: F('0.30000000000000004') },  // 0.1 + 0.2 - shortest round-trip must agree
  { a: F('1e21') },         // JS switches to exponential AT 1e21
  { a: F('1e20') },         // and not below it
  { a: F('1e-6') },         // JS stays positional down to 1e-6
  { a: F('1e-7') },         // and goes exponential at 1e-7, unpadded ("1e-7", not "1e-07")
  { a: F('1e17') },         // Python's repr would say 1e+17; JS spells it out
  { a: F('5e-324') },       // smallest denormal
  { a: F('1.7976931348623157e308') },
  { b: [F('1.0'), F('-0.0')], a: { x: F('1.5') } },   // nested, and key order
  { a: [1, F('2.5'), 3] },  // a float beside integers
];

test('POLICY normalize: Node and Python produce identical canonical bytes for floats', () => {
  python();   // UNSUP, not a silent skip - see the note above

  // Every case must actually reach Python as a float, or this proves nothing.
  assert.deepEqual(pythonTypes(CASES), CASES.map(() => 'float'),
    'a case did not decode to a float in Python, so it cannot test float canonicalisation');
  const ours = CASES.map((spec) => canonicalJson(decode(spec)));
  const theirs = pythonCanonical(CASES, 'normalize');

  for (const [i, expected] of ours.entries()) {
    assert.equal(theirs[i], expected,
      `case ${i} (${JSON.stringify(CASES[i])}): Node produced ${expected}, Python produced ${theirs[i]}`);
  }
});

test('POLICY normalize: identical bytes mean identical digests', () => {
  python();   // UNSUP, not a silent skip - see the note above

  // The bytes are what get hashed, so this is the property the vectors actually rest on.
  const theirs = pythonCanonical(CASES, 'normalize');
  for (const [i, value] of CASES.entries()) {
    assert.equal(sha256(theirs[i]), sha256(canonicalJson(decode(value))),
      `case ${i} hashes differently across languages`);
  }
});

test('POLICY reject: a float is refused, not silently canonicalised', () => {
  python();   // UNSUP, not a silent skip - see the note above

  // The ledger packets carry hashes and chain positions. A float there means the packet
  // is wrong, and refusing says so; canonicalising it would produce a plausible digest
  // for a nonsensical record.
  const refused = pythonCanonical([{ a: F('1.0') }, { a: F('-0.0') }, { a: [F('1.5')] }], 'reject');
  for (const [i, result] of refused.entries()) {
    assert.ok(String(result).startsWith('ERROR:'),
      `case ${i} was canonicalised under the reject policy instead of refused: ${result}`);
  }
});

test('POLICY reject: integers still pass under the strict policy', () => {
  python();   // UNSUP, not a silent skip - see the note above

  // The strict policy must refuse floats without refusing the packets it exists to run.
  const values = [{ a: 1 }, { a: 0 }, { a: -5 }, { a: [1, 2, 3] }, { a: 'text' }, { a: null }];
  const theirs = pythonCanonical(values, 'reject');
  const ours = values.map((v) => canonicalJson(v));
  assert.deepEqual(theirs, ours, 'the strict policy changed a non-float result');
});

// The same boundary, one type over: INTEGERS OUTSIDE THE SAFE RANGE (found 2026-09-28,
// Arena break test 12).
//
// `js_number` is only reached by a value Python parsed as a `float`. `json.loads` parses
// an integer literal as an `int`, which is arbitrary precision, so `str()` printed the
// digits the author wrote while JavaScript - which has ONE number type - had already
// rounded them:
//
//     9007199254740993                Node 9007199254740992          old Python 9007199254740993
//     123456789012345678901234567890  Node 1.2345678901234568e+29    old Python 123456789012345678901234567890
//
// The bytes are what get hashed, so the two languages disagreed about whether a record
// verifies. No shipped vector carried such an integer, which is exactly why a suite of
// chosen inputs looked like agreement: this is the float defect of 2026-09-20 again, in
// the type nobody thought to include.
//
// These literals are written as STRINGS and rebuilt per side, for the same reason the
// float cases are: `JSON.stringify` of a number past 2**53 has already rounded it, so a
// big integer written as a JS literal would reach Python pre-damaged and the test would
// compare two rounded values.
const I = (literal) => ({ __int__: literal });
const INT_CASES = [
  I('9007199254740993'),            // 2**53 + 1: the first integer JS cannot hold
  I('-9007199254740993'),           // and its negative
  I('9007199254740992'),            // 2**53 exactly - the boundary, still representable
  I('-9007199254740992'),
  I('9007199254740991'),            // 2**53 - 1: inside the range, must be unchanged
  I('123456789012345678901234567890'),
  I('100000000000000000000'),       // 1e20: below JS's exponential threshold, spelled out
  I('1000000000000000000000'),      // 1e21: AT it, JS switches to exponential
  I('30000000000000004'),           // a 17-digit integer a corpus could carry
  I('0'), I('-1'), I('42'),
  { a: I('9007199254740993'), b: [I('9007199254740991'), I('1000000000000000000000')] },
];

/**
 * Rebuild the integer markers as JavaScript numbers.
 *
 * `Number(literal)` is the only faithful way to hold what `JSON.parse` produced: it
 * performs the same rounding to a double. A big integer written as a JS literal would
 * arrive pre-rounded too, but a literal cannot be generated, so the marker travels as a
 * string and is converted here.
 */
function decodeIntSpec(spec) {
  if (Array.isArray(spec)) return spec.map(decodeIntSpec);
  if (spec && typeof spec === 'object') {
    if (typeof spec.__int__ === 'string') return Number(spec.__int__);
    return Object.fromEntries(Object.entries(spec).map(([k, x]) => [k, decodeIntSpec(x)]));
  }
  return spec;
}

/** Canonicalise those cases through the shared Python module. */
function pythonIntCanonical(specs, policy) {
  const INT_DECODER = [
    'def decode(v):',
    '    if isinstance(v, list): return [decode(x) for x in v]',
    '    if isinstance(v, dict):',
    '        if isinstance(v.get("__int__"), str): return int(v["__int__"])',
    '        return {k: decode(x) for k, x in v.items()}',
    '    return v',
  ].join('\n');
  const script = [
    'import json, sys, importlib.util',
    `spec = importlib.util.spec_from_file_location("c", ${JSON.stringify(COMMON)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    INT_DECODER,
    'out = []',
    'for raw in json.loads(sys.argv[1]):',
    '    try:',
    `        out.append(m.canonical_json(decode(raw), float_policy=${JSON.stringify(policy)}))`,
    '    except Exception as e:',
    '        out.append("ERROR:" + type(e).__name__)',
    'sys.stdout.write(json.dumps(out))',
  ].join('\n');
  const run = spawnSync(PYTHON, ['-c', script, JSON.stringify(specs)], {
    encoding: 'utf8', timeout: 60_000, windowsHide: true,
  });
  if (run.status !== 0) throw new Error(`python failed: ${run.stderr?.slice(0, 300)}`);
  return JSON.parse(run.stdout);
}

test('integers outside +/-2**53 canonicalise in Python the way JavaScript parses them', () => {
  python();   // UNSUP, not a silent skip - see the note above

  const ours = INT_CASES.map((spec) => canonicalJson(decodeIntSpec(spec)));
  const theirs = pythonIntCanonical(INT_CASES, 'normalize');

  for (const [i, expected] of ours.entries()) {
    assert.equal(theirs[i], expected,
      `case ${i} (${JSON.stringify(INT_CASES[i])}): Node produced ${expected}, Python produced ${theirs[i]}`);
  }

  // The disagreement, pinned as VALUES rather than only as an equality: 2**53 + 1 must
  // come back as 2**53 on BOTH sides, because that is what JavaScript parsed it as.
  assert.equal(theirs[0], '9007199254740992', 'Python kept digits JavaScript cannot represent');
  assert.equal(theirs[1], '-9007199254740992', 'and on the negative side');
  assert.equal(theirs[5], '1.2345678901234568e+29', 'and past the exponential threshold');
  // Inside the range nothing may be rewritten: a fix that routed every integer through
  // float formatting would pass the lines above and corrupt every small one.
  assert.equal(theirs[4], '9007199254740991', 'an integer inside 2**53 must be untouched');
  assert.equal(theirs[9], '0', 'and zero must stay zero');
});

test('the strict policy refuses a float without refusing a large integer', () => {
  python();   // UNSUP, not a silent skip - see the note above

  // The ledger packets carry hashes and chain positions, where a float means the packet
  // is wrong. An oversized INTEGER is a different fault - a number that lost precision,
  // not a value of the wrong type - so it is rendered as JavaScript would render it
  // rather than refused: refusing would make the two languages disagree about whether
  // the packet is valid at all, which is the one thing this module must never do.
  const integer = pythonIntCanonical([I('9007199254740993')], 'reject');
  assert.ok(!String(integer[0]).startsWith('ERROR:'), `an integer was refused under reject: ${integer[0]}`);
  assert.equal(integer[0], '9007199254740992', 'under reject it still renders as JavaScript does');
  const float = pythonCanonical([{ a: F('1.0') }], 'reject');
  assert.ok(String(float[0]).startsWith('ERROR:'), 'a float was canonicalised under reject');
});

test('the two policies are the only ones, and an unknown one is refused', () => {
  python();   // UNSUP, not a silent skip - see the note above

  const result = pythonCanonical([{ a: 1 }], 'silently-guess');
  assert.ok(String(result[0]).startsWith('ERROR:'),
    'an unrecognised float policy was accepted, which makes the policy implicit again');
});

test('no Python runner defines its own canonicaliser any more', () => {
  // The structural guard. The divergence was possible because three files each had one;
  // if a fourth copy appears, this is what says so before the vectors go quiet again.
  const bin = path.join(KIT_ROOT, 'bin');
  const offenders = [];
  for (const name of fs.readdirSync(bin)) {
    if (!name.endsWith('.py') || name === 'conformance_common.py') continue;
    const source = fs.readFileSync(path.join(bin, name), 'utf8');
    // A local `def canonical_json` / `def canonical` that is not the thin policy binding.
    for (const match of source.matchAll(/^def (canonical_json|canonical)\(/gm)) {
      const body = source.slice(match.index, match.index + 260);
      if (!/_canonical_json\(|canonical_json\(/.test(body)) offenders.push(`${name}:${match[1]}`);
    }
    if (/^def js_number\(/m.test(source)) offenders.push(`${name}:js_number`);
    if (/^def digest\(/m.test(source)) offenders.push(`${name}:digest`);
  }
  assert.deepEqual(offenders, [],
    'these runners define canonicalisation or hashing locally instead of importing the '
    + 'shared module, which is how the two implementations drifted apart:\n  ' + offenders.join('\n  '));
});
