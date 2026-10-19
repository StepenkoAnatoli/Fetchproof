// Near-duplicate detection between two captured pages.
//
// WHY THIS EXISTS. `corroboration` counts distinct HOSTS, on the reasoning that two pages
// from one vendor are one witness read twice. That heuristic does not merely miss a mirror
// - it INVERTS on one. A republished copy of a document on an unrelated host scores
// `independent`, the check's best grade, while carrying strictly less information than
// either genuine page: one witness, plus a staleness `freshness` cannot see, because that
// check grades when a page was FETCHED and a mirror is fetched today.
//
// Found 2026-09-21: `lira.epac.to` serves Node's single-executable documentation six major
// versions behind `nodejs.org`. Cited together they would have reported `independent`.
//
// WHY THIS IS NOT "GRADING MEANING". ADR-0013 refuses checks that judge whether an agent
// reasoned well. This judges nothing: it asks whether two byte streams are substantially
// the same text, which is arithmetic. It cannot tell a correct page from a wrong one, and
// does not try. A `mirror` finding says "these are one document" - what that is worth is
// still the reviewer's call.

/**
 * The scripts that put no space between their words: Chinese, Japanese, Thai, Lao, Khmer,
 * Burmese (#333, ADR-0176). In them one CHARACTER, with the combining marks written on it, is
 * a token. Script_Extensions, not Script, so the signs these scripts share (the long-vowel
 * mark, the iteration mark) count with them. Hangul is NOT here: Korean puts spaces between its
 * words, and its word shingles were already judged.
 */
const UNSPACED_SCRIPT = String.raw`[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Bopomofo}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]`;
const UNSPACED_CHARACTER = new RegExp(String.raw`${UNSPACED_SCRIPT}\p{M}*`, 'gu');
const STARTS_UNSPACED = new RegExp(`^${UNSPACED_SCRIPT}`, 'u');

/** What one token weighs in a shingle, in characters of an unspaced script. */
function weightOf(token) {
  return STARTS_UNSPACED.test(token) ? 1 : CHARS_PER_WORD;
}

/**
 * Shingles: from each token, the shortest run that weighs SHINGLE_WORDS words. A token is a
 * word, or one character of a script without word spaces, which weighs 1/CHARS_PER_WORD of a
 * word - so a shingle is five words, fifteen such characters, or a mix. Punctuation, case and
 * URLs are noise for this question.
 */
export function shingles(text, n = SHINGLE_WORDS) {
  const tokens = String(text ?? '')
    .toLowerCase()
    // Canonically equivalent text is the SAME text: `é` and `e` + U+0301 are one word spelled
    // once or twice, and composing first is what keeps the combining marks below from making
    // one word into two different ones. NFC only - NFKC is deliberately NOT used, because it
    // folds characters a page did not equate (`①` into `1`), and this measurement must not
    // invent an equivalence the text does not have.
    .normalize('NFC')
    .replace(/https?:\/\/\S+/g, ' ')
    // A WORD, in any script (rank 17, 2026-10-04 gap audit). This class was `[^a-z0-9]`, so a
    // page in Russian, Arabic, Hebrew, Greek or Devanagari lost every letter to a space: the
    // page shingled to nothing, `sketch` returned null for it, and `documentGroups` read a
    // republished copy of it as an independent witness - the one finding this module exists to
    // make. `\p{L}` letters, `\p{N}` numbers, `\p{M}` the combining marks that carry the vowels
    // of Devanagari and Arabic. ASCII input is untouched, and that is not luck: after
    // `toLowerCase` the old class kept exactly a-z, 0-9 and whitespace, which is what these
    // keep, so no ASCII page's sketch moves (test/similarity.test.mjs pins that).
    .replace(/[^\p{L}\p{N}\p{M}\s]+/gu, ' ')
    // A CHARACTER, where the script puts no space between words (#333, ADR-0176). Without this
    // a Japanese or Chinese page was one "word" per clause, or one per page with no
    // punctuation, so it shingled to too little, `sketch` returned null, and a republished copy
    // of it was an independent witness again. Text in no listed script has no match, so every
    // other page tokenises exactly as before.
    .replace(UNSPACED_CHARACTER, ' $& ')
    .split(/\s+/)
    .filter(Boolean);
  const weights = tokens.map(weightOf);
  const need = n * CHARS_PER_WORD;
  const out = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    let j = i;
    let weight = 0;
    while (j < tokens.length && weight < need) weight += weights[j++];
    // Every later start has less text after it, so none of them reaches a full shingle either.
    if (weight < need) break;
    out.add(tokens.slice(i, j).join(' '));
  }
  return out;
}

export const SHINGLE_WORDS = 5;

/**
 * How many characters of a script without word spaces weigh one word: a shingle is five
 * words or FIFTEEN such characters. Measured, not borrowed (ADR-0176). With one character per
 * word - the plain character 5-gram - two different halves of one Thai UI catalog scored
 * 0.177 and of a Japanese one 0.109, against 0.015 for the same split of the English catalog
 * on words: common short sequences, not shared text, put a Thai pair within reach of
 * MIRROR_THRESHOLD. At three, the Thai, Japanese and Chinese splits score 0.021, 0.010 and
 * 0.003, and two versions of one catalog (Chrome 154 against an older Electron's Chromium)
 * score 0.68, 0.65 and 0.57 against 0.65 in English - the scale the threshold was measured on.
 */
export const CHARS_PER_WORD = 3;

/** How many hashes the sketch keeps. 128 bounds memory and costs ~9% standard error. */
export const SKETCH_SIZE = 128;

/**
 * A document too short to fingerprint honestly. Below this, shingle overlap is dominated
 * by whatever boilerplate the two pages happen to share, and a `mirror` finding would be
 * an artefact of the sample size rather than a fact about the documents.
 *
 * Counted in WORDS of text, in every script (ADR-0176): a shingle starts at each token, and
 * a page without word spaces has a token per character, so it reached forty shingles on a
 * third of the text an English page needs. A shingle that starts on such a character counts
 * 1/CHARS_PER_WORD, and the floor asks the same amount of text of every page.
 */
export const MIN_SHINGLES = 40;

/** Whether a page's shingles hold MIN_SHINGLES words' worth of text. */
function enoughText(set) {
  let weight = 0;
  for (const s of set) weight += weightOf(s);
  return weight >= MIN_SHINGLES * CHARS_PER_WORD;
}

function hash32(str, seed) {
  // FNV-1a, seeded. Deterministic across runs and platforms, which matters because a
  // sketch decides a gate finding: the same corpus must grade the same way everywhere.
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * A MinHash sketch: the smallest hash under each of SKETCH_SIZE independent functions.
 * `null` for a document with too little text to judge - callers must treat that as
 * "unknown", never as "different".
 */
export function sketch(text) {
  const set = shingles(text);
  if (!enoughText(set)) return null;
  const mins = new Uint32Array(SKETCH_SIZE).fill(0xffffffff);
  for (const s of set) {
    for (let k = 0; k < SKETCH_SIZE; k += 1) {
      const h = hash32(s, k);
      if (h < mins[k]) mins[k] = h;
    }
  }
  return mins;
}

/** Estimated Jaccard similarity of two sketches, or `null` if either is unjudgeable. */
export function similarity(a, b) {
  if (!a || !b) return null;
  let same = 0;
  for (let k = 0; k < SKETCH_SIZE; k += 1) if (a[k] === b[k]) same += 1;
  return same / SKETCH_SIZE;
}

/**
 * The line between "the same document" and "two documents".
 *
 * CHOSEN FROM MEASUREMENT, not from taste. Every capture pair in this repository was
 * compared on 2026-09-21 - 47 captures, 1081 pairs:
 *
 *   - the known mirror (nodejs.org x lira.epac.to, six majors apart)  0.3879
 *   - the highest-scoring genuinely different cross-host pair         0.0275
 *   - median cross-host pair                                         0.0000
 *
 * A fourteen-fold gap, so the threshold is not delicate. 0.25 sits about 9x above the
 * strongest false-positive candidate and comfortably below the hardest true positive -
 * and the hard case is the STALE mirror, because a current mirror scores ~0.99. Same-host
 * re-collections of one URL reach 1.0000, which is why this check only speaks about pairs
 * that `corroboration` was about to call independent.
 *
 * Re-run 2026-10-19 for the character basis (ADR-0176), over 417 captures and 86,736 pairs:
 * 391 shingle exactly as before, the 26 that hold a few characters of a script without word
 * spaces move, and no pair changes its verdict. In real Chinese, Japanese and Thai text the
 * threshold keeps its scale: two versions of one UI catalog score 0.57 to 0.68 (English 0.65),
 * and two different texts at most 0.07.
 */
export const MIRROR_THRESHOLD = 0.25;

export function isMirror(a, b) {
  const score = similarity(a, b);
  return score === null ? false : score >= MIRROR_THRESHOLD;
}

/**
 * The closest any two of these sketches came, or `null` if fewer than two are judgeable.
 *
 * WHY THIS IS REPORTED RATHER THAN ACTED ON. The threshold has two measured blind spots and
 * neither is closable with a better number:
 *
 *   - a stale mirror of a page that has since GROWN scores low, because the shared text is
 *     diluted by everything the current page gained (`node.readthedocs.io` vs `nodejs.org`,
 *     0.054 at a 6.4x size ratio);
 *   - and CONTAINMENT, the obvious repair for that, ranks a genuinely different pair ABOVE
 *     that mirror (0.506 for `modelcontextprotocol.io` vs its own `GOVERNANCE.md`, against
 *     0.380 for the mirror). Measured over 2404 pairs on 2026-09-22.
 *
 * So a check that tried harder here would start reporting real second sources as copies,
 * and the remedy a reviewer would reach for - dropping one - is the opposite of what the
 * corpus needs. The number is surfaced instead: `independent (closest pair 0.38)` invites a
 * look, `closest pair 0.00` does not, and neither changes the verdict.
 */
export function closestPair(sketches) {
  let best = null;
  for (let i = 0; i < sketches.length; i += 1) {
    for (let j = i + 1; j < sketches.length; j += 1) {
      const score = similarity(sketches[i], sketches[j]);
      if (score === null) continue;
      if (best === null || score > best) best = score;
    }
  }
  return best;
}

/**
 * Group rows into distinct DOCUMENTS. Each group is a set of indices whose sketches are
 * near-duplicates of one another.
 *
 * Single-link clustering: A mirrors B and B mirrors C puts all three together even if A
 * and C fall below the threshold. That is the conservative direction for this check - it
 * errs towards reporting less corroboration than the host count suggests, never more.
 */
export function documentGroups(sketches) {
  const parent = sketches.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sketches.length; i += 1) {
    for (let j = i + 1; j < sketches.length; j += 1) {
      if (isMirror(sketches[i], sketches[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < sketches.length; i += 1) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  return [...groups.values()];
}
