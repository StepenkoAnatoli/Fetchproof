# ADR-0176 - A shingle in a script without word spaces is fifteen characters

- **Date:** 2026-10-19
- **Status:** accepted
- **Area:** `fetchproof/lib/similarity.mjs`. How a page is cut into shingles, and how the floor
  below which a page is unjudgeable is counted; no command, flag, format, configuration key or
  finding.
- **Supersedes in part:** ADR-0163, in three places: its rejection of character n-grams "for
  now", its rejection of splitting CJK ideographs, and the KNOWN-UNKNOWN it left for scripts with
  no word separators. That record's trigger has fired: #333 asks for exactly this, and the
  operator decided on 2026-10-19 to take it. ADR-0163's word rule for every other script, its
  rejection of dictionary segmentation, the sketch size and `MIRROR_THRESHOLD` stand.
- **Refines:** ADR-0036. `MIN_SHINGLES` stays 40, now counted in words of text.

## Context

ADR-0163 made a word any run of letters, numbers and marks, in any script. That fixed every
script that puts spaces between its words. It did not fix the ones that put none: Chinese,
Japanese, Thai, Lao, Khmer and Burmese. A page in them was one token per clause, or one token for
the whole page when it had no punctuation. The issue's own measurement on `main`: its Japanese
example page gave 0 shingles. Under ADR-0163's rule, a Japanese page of thirty sentences ended by
`。` alone gives thirty tokens and 26 shingles. That is under `MIN_SHINGLES`, so `sketch` returns
null. A copy of that page on a second host then grades `corroboration/independent`, the check's
best grade. That is the inversion this module exists to prevent (#333).

ADR-0163 deferred character n-grams for a measured reason. The threshold and its pinned numbers
were measured on words, so a new basis needs its own measurement over real pairs in those
scripts. This record is that measurement.

## Decision

1. **A token is a character** in the scripts that write no word spaces: Han, Hiragana,
   Katakana, Bopomofo, Thai, Lao, Khmer and Myanmar, matched by Unicode Script_Extensions. The
   combining marks written on a character stay with it, so a Thai consonant keeps its vowel and
   tone signs. Script_Extensions rather than Script, so that the signs these scripts share count
   with them: the long-vowel mark `ー` and the iteration mark `々`. Hangul is not in the list,
   because Korean puts spaces between its words.
2. **A shingle weighs five words, and a character weighs a third of a word**
   (`CHARS_PER_WORD = 3`). From each token, a shingle is the shortest run that weighs
   `SHINGLE_WORDS` words: five words, fifteen characters, or a mix (`Vim は、このチュー...` is one
   word and twelve characters). One rule for every position, so a page that mixes scripts is cut
   the same way wherever it is read.
3. **`MIN_SHINGLES` is counted in words of text.** A shingle that starts on one of these
   characters counts a third. Without this, a page with a token per character passed the floor of
   forty on about 54 characters, a third of the text an English page needs. The floor exists so
   that two short pages are not judged on the boilerplate they share.
4. **Every other page shingles exactly as before.** Text with no character from the list has no
   match, every token weighs one word, and the window is five tokens.
   `test/similarity.test.mjs` pins this against the word rule, for Cyrillic, Greek, Arabic,
   Hebrew, Devanagari, Korean and accented Latin.

## Measurement (2026-10-19, offline)

All texts were already installed on the operator's PC. Nothing was fetched and no credit was
spent:

- Git for Windows 2.55.0: the vim 9.2 tutors in English, Japanese, simplified and traditional
  Chinese, Korean and Russian, the vim menu translations, and the mintty message catalogs (the
  translated strings only);
- Python 3.14's `test/cjkencodings` samples;
- the Chromium UI string catalogs (`Locales/*.pak`) of Chrome 154.0.8037.98, of Edge
  154.0.4258.53 and 154.0.4258.62, and of an Electron app's older Chromium, in `en-US`, `th`,
  `ja` and `zh-CN`. Each catalog is its unique strings in code-point order, because resource ids
  differ between builds.

Exact Jaccard. The English column is the word basis, which is unchanged; the others are the
character basis at one character per word (the plain 5-gram) and at three:

| pair | English | Thai 1 / 3 | Japanese 1 / 3 | Chinese 1 / 3 |
|---|---|---|---|---|
| two halves of one catalog, split by resource id (different text, one vocabulary) | 0.015 | 0.177 / **0.021** | 0.109 / **0.010** | 0.039 / **0.003** |
| two versions of one catalog (Chrome 154, older Electron) | 0.649 | 0.757 / **0.683** | 0.733 / **0.647** | 0.706 / **0.570** |
| Chrome against Edge (Edge's strings are re-translated; only its English shares Chromium's source) | 0.203 | 0.243 / **0.059** | 0.166 / **0.040** | 0.076 / **0.012** |

Two and four characters per word were also measured. At two, Thai halves score 0.053; at four,
the Chinese versions fall to 0.524. Three is the one length at which, in all three scripts, the
floor sits within about 1.5 times English and two versions of one text score within 0.08 of
English. That is the scale `MIRROR_THRESHOLD` was set on.

The shipped module was then run against ADR-0163's rule on the same texts and on this
repository:

- **This repository's captures:** 417 pages and 86,736 pairs. 391 pages shingle exactly as
  before. The other 26 hold between 1 and 149 characters of these scripts, such as a language
  name or a Chinese example in a standard. Their shingles move, but no pair changes its mirror
  verdict or whether it can be judged. The known stale mirror is in English, so the 0.3879
  pinned beside `MIRROR_THRESHOLD` stands.
- **The texts above:** 50 documents and 1,225 pairs. Every pair that shares its text is a
  mirror. One text in two encodings scores 1.0. That includes samples ADR-0163's rule could not
  judge at all: Big5, GB2312, EUC-JP, Shift_JIS, ISO-2022-JP, and a Korean one that mixes in
  Hanja. The Big5 and GB2312 samples sit whole inside the GBK and GB18030 ones and score 0.40
  to 0.52. Every catalog paired with its other version is a mirror. No pair of different texts
  is. The closest pairs are English catalogs of Chrome, Edge and Electron, at 0.23 and 0.24, on
  the word basis this record does not touch, since Edge's English strings are largely
  Chromium's. On the character basis the closest is Chrome's Thai catalog against Edge's, at
  0.070 (exact 0.060).
- This run read the catalogs as stored, while the table's run inflated their few compressed
  entries. The two agree within 0.004.

## Rejected alternatives

- **Plain character 5-grams**, one character per token in a five-token window. This was the
  issue's proposal. Rejected on measurement: on two different halves of one Thai catalog it
  scores 0.177, twelve times English. On two *different translations* of one UI it scores 0.243,
  0.007 under the threshold. `MIRROR_THRESHOLD` was set nine times above the strongest different
  pair, and at 5-grams Thai keeps less than a 1.5x margin. A short window matches what two pages
  share in vocabulary, not in text.
- **A length per script** (two characters per word for Chinese, three for Japanese, four for
  Thai). Chinese matches English more closely at two (versions 0.629, halves 0.008). But a page
  mixes scripts: Japanese is Han and kana in one sentence, so every token would need a script
  decision, a table to keep current, and its own measurement. One length errs for Chinese
  towards a lower score, not an invented mirror. At the measured ratio (0.570 against 0.649), the
  known stale mirror's 0.388 would read about 0.34 in Chinese, still above 0.25.
- **Dictionary word segmentation** (`Intl.Segmenter`, ICU's word break). Its boundaries come from
  the ICU version and dictionaries of the Node build, which differ between full and small ICU and
  move between Node releases. The same corpus would then grade differently on two machines. This
  module hashes with seeded FNV-1a precisely so that a corpus grades the same everywhere.
  Character tokens depend only on Unicode's script data.
- **Character n-grams for every script.** This is the language-agnostic basis ADR-0163 named. It
  moves every page's shingles, so the threshold and its pinned measurement (0.3879 and 0.0275 over
  the repository's captures) would no longer describe anything. The word basis already works for
  scripts that space their words.
- **Hangul by character.** Korean writes spaces between words, and its word shingles already
  judge it: the Korean vim tutor gives 4224. Changing it would move a working basis to fix
  nothing.
- **A second window length chosen per page** by its majority script. Then a mirror that gained an
  English section could change basis and score. A weighted window gives every position one rule.
- **Keep counting the floor in shingles.** A page with no word spaces would be judgeable on about
  54 characters (18 words). The floor exists to stop exactly that: a verdict drawn from shared
  boilerplate.

## Consequences

- A page in Chinese, Japanese, Thai, Lao, Khmer or Burmese is fingerprinted, and a republished
  copy of it is one document. The issue's example page is one 76-character sentence repeated forty
  times. It now gives 72 shingles, which weigh 24 words, so it stays unjudgeable. The same
  sentence repeated in English is unjudgeable too: repetition is not text.
- A Chinese or Japanese page that ADR-0163 judged on clauses is now judged on characters, and its
  score moves. No capture in this repository holds such a page.
- No real Lao, Khmer or Burmese text was available on this host. Those scripts are included
  because they share Thai's shape: no word spaces, and an alphabet whose marks sit on a
  consonant. The Thai measurement stands for them. This is a KNOWN-UNKNOWN, and its trigger is a
  corpus in one of them.
- `\p{scx=...}` follows the Unicode version of the running Node. A character first assigned in a
  later Unicode version counts as an ordinary letter on an older Node. That affects only
  characters no measured page used.
