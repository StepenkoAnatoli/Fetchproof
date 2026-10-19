// The mirror finding, tested against the real pair that exposed the hole.
//
// `lira.epac.to` republishes Node's single-executable documentation six major versions
// behind `nodejs.org`. Before this check existed, citing both for one unknown reported
// `independent` - the best grade in the registry - for one witness plus a staleness
// `freshness` cannot see.
//
// These are UNIT tests of a new module, so they could not have been run against the old
// code and no claim is made that they were. The regression - that the same two captures
// used to grade `independent` and now grade `mirror` - is proven at the check level, in
// checks.test.mjs, which is where the old behaviour actually existed.

import { fileURLToPath } from 'node:url';
import { test, describe, assert, fs, path } from './harness.mjs';

import { parseCapture } from '../lib/corpus.mjs';
import {
  sketch, similarity, shingles, documentGroups, isMirror, closestPair,
  MIRROR_THRESHOLD, MIN_SHINGLES, SHINGLE_WORDS,
} from '../lib/similarity.mjs';

describe('similarity');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const seaRaw = path.join(repo, 'docs', 'decisions', '2026-09-21-sea-assets', 'research', 'raw');

function body(dir, needle) {
  const name = fs.readdirSync(dir).find((f) => f.includes(needle) && f.endsWith('.md'));
  assert.ok(name, `no capture matching ${needle} in ${dir}`);
  return parseCapture(fs.readFileSync(path.join(dir, name), 'utf8')).body;
}

function exactJaccard(a, b) {
  const x = shingles(a);
  const y = shingles(b);
  let shared = 0;
  const [small, large] = x.size < y.size ? [x, y] : [y, x];
  for (const s of small) if (large.has(s)) shared += 1;
  return shared / (x.size + y.size - shared);
}

test('the real stale mirror is detected as one document', () => {
  const canonical = body(seaRaw, '-nodejs-');
  const mirrored = body(seaRaw, 'epac');

  // The measurement the threshold was chosen from. Pinned so that a change to shingling
  // or normalisation cannot quietly move the corpus across the line without a test saying so.
  const exact = exactJaccard(canonical, mirrored);
  assert.ok(exact > 0.35 && exact < 0.42, `exact jaccard drifted: ${exact}`);
  assert.ok(exact >= MIRROR_THRESHOLD, 'the hard case must sit above the threshold');

  assert.equal(isMirror(sketch(canonical), sketch(mirrored)), true);
});

test('the sketch estimates exact similarity closely enough to decide the finding', () => {
  const canonical = body(seaRaw, '-nodejs-');
  const mirrored = body(seaRaw, 'epac');
  const est = similarity(sketch(canonical), sketch(mirrored));
  const exact = exactJaccard(canonical, mirrored);
  // 128 hashes carry roughly 9% standard error; the gap this must resolve is 14x.
  assert.ok(Math.abs(est - exact) < 0.1, `sketch too far from exact: ${est} vs ${exact}`);
});

test('genuinely different pages on different hosts are not mirrors', () => {
  const nodeDoc = body(seaRaw, '-nodejs-');
  const discussion = body(seaRaw, 'bundling');
  const s = similarity(sketch(nodeDoc), sketch(discussion));
  if (s !== null) assert.ok(s < MIRROR_THRESHOLD, `false positive at ${s}`);
});

test('a document is identical to itself', () => {
  const doc = body(seaRaw, '-nodejs-');
  assert.equal(similarity(sketch(doc), sketch(doc)), 1);
});

test('a document too short to judge returns null, and null never means "different"', () => {
  const tiny = sketch('one two three four five six');
  assert.equal(tiny, null);
  assert.equal(similarity(tiny, sketch(body(seaRaw, '-nodejs-'))), null);
  // The consequence that matters: an unjudgeable pair is NOT reported as a mirror, so a
  // short capture can never be silently folded into another document's group.
  assert.equal(isMirror(tiny, sketch(body(seaRaw, '-nodejs-'))), false);
});

test('MIN_SHINGLES is what makes a short document unjudgeable', () => {
  const words = Array.from({ length: MIN_SHINGLES + 10 }, (_, i) => `w${i}`).join(' ');
  assert.notEqual(sketch(words), null, 'a document above the floor must be judgeable');
});

test('documentGroups collapses a mirrored pair and keeps a third document apart', () => {
  const canonical = sketch(body(seaRaw, '-nodejs-'));
  const mirrored = sketch(body(seaRaw, 'epac'));
  const other = sketch(body(seaRaw, 'bundling'));

  assert.equal(documentGroups([canonical, mirrored]).length, 1);

  const three = documentGroups([canonical, mirrored, other]);
  assert.equal(three.length, 2, 'the unrelated page must survive as its own document');
  const pair = three.find((g) => g.length === 2);
  assert.deepEqual(pair, [0, 1]);
});

test('unjudgeable rows each stand alone rather than merging', () => {
  // Two nulls must not become one group: "I cannot tell" is not "they are the same".
  assert.equal(documentGroups([null, null]).length, 2);
});

// ---------------------------------------------------------------- closestPair

test('closestPair reports the tightest pair, and null when nothing is judgeable', () => {
  const canonical = sketch(body(seaRaw, '-nodejs-'));
  const mirrored = sketch(body(seaRaw, 'epac'));
  const other = sketch(body(seaRaw, 'bundling'));

  // The mirror is the tightest pair present, so it is what gets reported.
  const three = closestPair([canonical, mirrored, other]);
  assert.ok(three > 0.35 && three <= 1, `expected the mirror to dominate, got ${three}`);
  assert.equal(closestPair([canonical, mirrored]), similarity(canonical, mirrored));

  assert.equal(closestPair([]), null, 'nothing to compare is null, not 0');
  assert.equal(closestPair([canonical]), null, 'one document has no pair');
  assert.equal(closestPair([null, null]), null, 'unjudgeable pairs report null, never 0');
});

test('closestPair is REPORTED, not acted on - the verdict does not move with it', () => {
  // The measured reason, recorded so nobody "fixes" this into a blocking rule later:
  // containment - the obvious repair for a size-mismatched mirror - ranks a genuinely
  // different pair (0.506) ABOVE a real mirror (0.380). A check that tried harder would
  // report real second sources as copies, and the remedy a reviewer reaches for is to drop
  // one. So the number informs and the grade is unchanged.
  const canonical = sketch(body(seaRaw, '-nodejs-'));
  const other = sketch(body(seaRaw, 'bundling'));
  const score = closestPair([canonical, other]);
  assert.ok(score !== null);
  assert.ok(score < MIRROR_THRESHOLD, 'this pair must remain below the mirror line');
  // Two distinct documents stay two distinct documents whatever the number says.
  assert.equal(documentGroups([canonical, other]).length, 2);
});

// Rank 17 of the 2026-10-04 gap audit. The shingler kept `[a-z0-9]`, so a page in any other
// script lost every letter to a space, came back with NO shingles, and `sketch` returned null
// for it - which every caller reads as "cannot tell", so a republished copy of a Russian or
// Arabic page counted as an independent witness. That is the one finding this module exists
// to make, inverted for every corpus not written in the Latin alphabet.
test('a page in a script that is not Latin is fingerprinted, and two copies of it are one document', () => {
  // No ASCII character anywhere in this page. An earlier version of this test used `слово0`,
  // `слово1` - and the ASCII DIGITS survived the old `[^a-z0-9]` class, so the page shingled
  // into `0 1 2 ...` and the test passed against the very code it was written to fail on. A
  // version after that indexed a 30-letter alphabet modulo 33, so `${undefined}` put the ASCII
  // word `undefined` into the page. Hence the assertion below, which makes the vacuous case a
  // failure instead of a pass.
  const CYR = 'абвгдежзийклмнопрстуфхцчшщыэюя';
  const words = Array.from({ length: 80 }, (_, i) => `${CYR[i % CYR.length]}${CYR[Math.floor(i / CYR.length)]}${CYR[(i * 5) % CYR.length]}`);
  const page = words.join(' ');
  assert.ok(!/[A-Za-z0-9]/.test(page), 'no Latin letter or digit may appear anywhere in this page, or the old [^a-z0-9] class would have had something to hash and the test would prove nothing');
  assert.equal(new Set(words).size, 80, 'the words must be distinct, or the shingle count below is wrong');
  assert.equal(shingles(page).size, 80 - SHINGLE_WORDS + 1, 'every window of a page this long must shingle');
  const copy = words.slice();
  copy[40] = 'изменение';
  const a = sketch(page);
  const b = sketch(copy.join(' '));
  assert.notEqual(a, null, 'a Cyrillic page must be judgeable at all');
  assert.equal(isMirror(a, b), true, 'two copies of one page are one document, not two witnesses');
});

test('an accented word keeps its letters instead of collapsing to its ASCII skeleton', () => {
  const words = Array.from({ length: 30 }, (_, i) => `café${i} über${i} naïve${i}`);
  const set = shingles(words.join(' '));
  assert.ok(set.size > 0, 'accented Latin text must shingle');
  assert.ok([...set].some((s) => s.includes('café0')), 'the word must survive with its accent');
  assert.ok(![...set].some((s) => s.includes('caf0')), 'the stripped form must not be what is hashed');
});

test('canonically equivalent text is one word, composed or decomposed', () => {
  const composed = Array.from({ length: 60 }, (_, i) => `café${i}`).join(' ');
  const decomposed = Array.from({ length: 60 }, (_, i) => `cafe\u0301${i}`).join(' ');
  assert.notEqual(sketch(composed), null);
  assert.equal(similarity(sketch(composed), sketch(decomposed)), 1, 'é and e + U+0301 are the same word');
});

// The guard for the two fixes above. Every page that is plain ASCII must shingle EXACTLY as the
// ASCII-only rule did, because MIRROR_THRESHOLD and the pinned Jaccard in this file were
// measured on that: after `toLowerCase`, `[^a-z0-9\s]` kept exactly a-z, 0-9 and whitespace,
// which is what the Unicode class keeps too. If this test ever fails, the threshold no longer
// rests on the corpus it was measured against.
test('ASCII text shingles exactly as the ASCII-only rule did', () => {
  const sample = 'The Free Plan allows 10 requests per minute - see https://x.invalid/limits for the exact wording of the limit.';
  const oldRule = String(sample).toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const expected = new Set();
  for (let i = 0; i + SHINGLE_WORDS <= oldRule.length; i += 1) expected.add(oldRule.slice(i, i + SHINGLE_WORDS).join(' '));
  assert.deepEqual([...shingles(sample)].sort(), [...expected].sort());
});
