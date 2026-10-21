// One ordering for identifiers, on every machine (break-test PR #185, 2026-10-01).
//
// `String.prototype.localeCompare` with no locale named reads the machine's: reproduced here
// with Node 22's own ICU data, no OS locale needed. Under da_DK `Firecrawl` sorts before
// `firecrawl` (plain ASCII); under sv_SE and fi_FI `zebra` sorts before `ålder`; under th_TH
// dashes and underscores are ignored, so `a-b` and `ab` compare EQUAL and their order falls
// to whatever readdirSync gave - undefined. `audit --list` printed that order, so two machines
// disagreed about one corpus. Identifiers - slugs, file names, ids, ISO dates - are compared
// by UTF-16 code unit now: a total order, the same everywhere, and what the Python
// conformance runners already use (`sorted(key=utf-16-be)`) and `canonicalJson` already
// hashes by.

import { test, describe, assert, fs, path, KIT_ROOT } from './harness.mjs';
import { compareText } from '../lib/core.mjs';

describe('ordering');

test('compareText is code-unit order: total, case-sensitive, and blind to the locale', () => {
  const sorted = (list) => [...list].sort(compareText);
  assert.deepEqual(sorted(['firecrawl', 'Firecrawl']), ['Firecrawl', 'firecrawl'], 'ASCII upper case sorts first, on every machine');
  assert.deepEqual(sorted(['zebra', 'ålder']), ['zebra', 'ålder'], 'a non-ASCII letter sorts after ASCII, as its code unit does');
  assert.notEqual(compareText('a-b', 'ab'), 0, 'th_TH made these equal');
  assert.deepEqual(sorted(['ab', 'a_b', 'a-b']), ['a-b', 'a_b', 'ab']);
  assert.deepEqual(sorted(['2026-09-30', '2026-10-01', '2026-09-29']), ['2026-09-29', '2026-09-30', '2026-10-01'], 'ISO dates order by time');
  // The same order Python gives with key=utf-16-be: an astral character's surrogate (0xD83D)
  // sorts before U+FFFF, where code-point order would put it after.
  assert.equal(compareText('\u{1F600}', '￿'), -1);
  assert.equal(compareText('same', 'same'), 0);
  assert.equal(compareText(undefined, ''), 0, 'a missing value compares as the empty string, never throws');
  assert.equal(compareText(2, 10), 1, 'a number is compared as its text, like every other sort key here');
});

test('no module of the kit sorts by the machine\'s locale', () => {
  const offenders = [];
  for (const dir of ['lib', 'bin', 'hooks']) {
    const walk = (folder) => {
      for (const name of fs.readdirSync(folder)) {
        const abs = path.join(folder, name);
        if (fs.statSync(abs).isDirectory()) { walk(abs); continue; }
        if (!name.endsWith('.mjs')) continue;
        const text = fs.readFileSync(abs, 'utf8');
        for (const [i, line] of text.split('\n').entries()) {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;    // a comment may name it
          if (/\.localeCompare\(/.test(line)) offenders.push(`${path.relative(KIT_ROOT, abs)}:${i + 1}`);
        }
      }
    };
    walk(path.join(KIT_ROOT, dir));
  }
  assert.deepEqual(offenders, [], 'localeCompare reads the machine\'s locale; sort identifiers with compareText');
});
