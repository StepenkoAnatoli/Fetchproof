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
  MIRROR_THRESHOLD, MIN_SHINGLES, SHINGLE_WORDS, CHARS_PER_WORD,
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

// #333, ADR-0176. Chinese, Japanese and Thai put no space between words, so the rule above read a
// page in them as one "word" per clause - or one per page, with no punctuation - and it
// shingled to too little: `sketch` returned null and a republished copy was an independent
// witness. A character is now a token, and fifteen of them weigh what five words do.
const PHRASES_ZH = ['免费计划每分钟可发送请求', '请求次数超过限制时报错', '账户管理员可以修改设置', '页面上方显示当前的用量', '超过上限后接口返回错误', '每个错误代码都有说明', '用量在每月一日零点重置', '服务接口的版本号说明', '数据在服务器保存九十天', '同时连接数量不能超过十', '响应格式默认是纯文本', '计费周期结束时发送账单'];
/** A page of these phrases in one of many orders, with no punctuation and no space anywhere. */
const zhPage = (step) => Array.from({ length: 48 }, (_, i) => PHRASES_ZH[(i * step + Math.floor(i / PHRASES_ZH.length)) % PHRASES_ZH.length]).join('');

test('a page in a script without word spaces is fingerprinted, and two copies of it are one document', () => {
  const page = zhPage(5);
  assert.ok(!/[\s\p{P}A-Za-z0-9]/u.test(page), 'no space, punctuation or Latin character may appear, or the word rule would have had something to split on');
  const a = sketch(page);
  assert.notEqual(a, null, 'a Chinese page with no punctuation must be judgeable at all');
  assert.equal(isMirror(a, sketch(page.replace('管理员', '负责人'))), true, 'two copies of one page are one document, not two witnesses');
});

test('a Japanese page whose sentences end only in 。 is judged, and so is a Thai page', () => {
  // Thirty sentences: under the word rule, thirty tokens and 26 shingles - under MIN_SHINGLES.
  const WHO = ['無料プラン', '有料プラン', '管理者', '利用者', '開発者', '請求担当'];
  const WHAT = ['一分あたりの要求数', '月間の上限', '保存期間', '同時接続数', '応答の形式'];
  const DO = ['確認できます', '変更できません', '設定画面に表示されます', '翌月に戻ります', '通知されます'];
  const ja = Array.from({ length: 30 }, (_, i) => `${WHO[i % 6]}では${WHAT[i % 5]}を${DO[(i * 2) % 5]}`).join('。');
  assert.equal(isMirror(sketch(ja), sketch(ja.replace('管理者', '担当者'))), true);
  // Thai marks (the vowel and tone signs written on a consonant) stay on their consonant.
  const TH = ['การ', 'ตั้งค่า', 'ความ', 'ปลอดภัย', 'บัญชี', 'ผู้ใช้', 'ข้อมูล', 'ส่วนตัว', 'หน้า', 'แสดง', 'จำนวน', 'คำขอ', 'ต่อ', 'นาที', 'เกิน', 'ขีดจำกัด', 'รายเดือน', 'บริการ'];
  const th = Array.from({ length: 120 }, (_, i) => TH[(i * 5 + Math.floor(i / TH.length)) % TH.length]).join('');
  const thTokens = [...shingles(th)].flatMap((s) => s.split(' '));
  assert.ok(thTokens.includes('ตั้'), 'a consonant and the marks on it are one token');
  assert.ok(!thTokens.some((t) => /^\p{M}/u.test(t)), 'no mark stands alone as a token');
  assert.equal(isMirror(sketch(th), sketch(th.replace('บัญชี', 'ระบบ'))), true);
});

test('two different pages built from the same phrases are not a mirror: why a shingle is fifteen characters, not five', () => {
  // A UI catalog or a templated page repeats its phrases; a character 5-gram is shorter than
  // most of them, so it matches what the pages share in VOCABULARY, not in text. The pair below
  // scores above MIRROR_THRESHOLD on plain character 5-grams. Measured on real catalogs: two
  // halves of Chrome's Thai strings, 0.177 on 5-grams, 0.021 on fifteen (ADR-0176).
  const a = zhPage(5);
  const b = zhPage(7);
  const grams = (t) => new Set(Array.from({ length: [...t].length - 4 }, (_, i) => [...t].slice(i, i + 5).join('')));
  const [x, y] = [grams(a), grams(b)];
  const shared = [...x].filter((g) => y.has(g)).length;
  assert.ok(shared / (x.size + y.size - shared) >= MIRROR_THRESHOLD, 'the pair must be one that character 5-grams would call a mirror, or this test proves nothing');
  assert.equal(CHARS_PER_WORD, 3);
  assert.equal(isMirror(sketch(a), sketch(b)), false);
});

test('MIN_SHINGLES asks the same amount of text of a page in every script', () => {
  // A token per character gives a page without word spaces three shingles for every word's
  // worth of text, so it would pass a count of forty on a third of the text English needs.
  let han = '';
  for (let i = 0; han.length < 200; i += 1) han += String.fromCodePoint(0x4e00 + ((i * 7919) % 20000));
  const short = han.slice(0, 130);
  assert.ok(shingles(short).size > MIN_SHINGLES, 'the short page has more shingles than the floor counts');
  assert.equal(sketch(short), null, 'and still too little text: 116 shingles at a third of a word each');
  assert.notEqual(sketch(han), null, '186 shingles weigh 62 words, over the floor');
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

// The guard for ADR-0176: a page in a script that separates its words - and Korean is one -
// shingles exactly as ADR-0163's rule had it, so making a character a token in Chinese,
// Japanese and Thai moves no other page. Passes before and after that change, by design.
test('a page in a script with word spaces shingles exactly as the word rule did', () => {
  const samples = [
    'Тариф включает сто запросов в месяц, а лимит сбрасывается первого числа.',
    'Το δωρεάν πρόγραμμα επιτρέπει δέκα αιτήματα ανά λεπτό σε κάθε λογαριασμό.',
    'تسمح الخطة المجانية بعشرة طلبات في الدقيقة لكل حساب مسجل لدى الخدمة.',
    'התוכנית החינמית מאפשרת עשר בקשות בדקה לכל חשבון רשום בשירות הזה.',
    'मुफ़्त योजना हर मिनट दस अनुरोध की अनुमति देती है और महीने में सीमा रीसेट होती है।',
    '무료 요금제는 계정마다 분당 열 번의 요청을 허용하며 한도는 매월 초기화됩니다.',
    'Le forfait gratuit numéro 1 autorise des requêtes limitées chaque mois, déjà réinitialisées.',
  ];
  for (const sample of samples) {
    const words = sample.toLowerCase().normalize('NFC')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^\p{L}\p{N}\p{M}\s]+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const expected = new Set();
    for (let i = 0; i + SHINGLE_WORDS <= words.length; i += 1) expected.add(words.slice(i, i + SHINGLE_WORDS).join(' '));
    assert.ok(expected.size > 0, `the sample must shingle at all: ${sample}`);
    assert.deepEqual([...shingles(sample)].sort(), [...expected].sort(), sample);
  }
});
