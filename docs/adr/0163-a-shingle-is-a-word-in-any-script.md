# ADR-0163 - A shingle is a word in any script, and text is compared as it was written

- **Date:** 2026-10-17
- **Status:** accepted
- **Area:** `research-kit/lib/similarity.mjs`
- **Supersedes nothing.** The word basis, the sketch size and `MIRROR_THRESHOLD` are kept as
  they were decided and measured; what changes is which characters count as a word.

## Context

`shingles` folded a page to words with `[^a-z0-9\s]` -> space. That class is Latin ASCII. So:

- A page in **any other script** - Russian, Arabic, Hebrew, Greek, Devanagari - lost every
  letter to a space. The page shingled to **nothing**, `sketch` returned `null` for it, and
  `documentGroups` reads `null` as "cannot tell" rather than "different", so a republished
  copy of such a page counted as an **independent witness**. That is the exact inversion this
  module exists to prevent (rank 17, `docs/review-2026-10-04-gap-audit.md`; rank 14 of
  `docs/review-2026-10-03-gap-audit.md`), and it applied to every corpus not written in the
  Latin alphabet.
- **Accented Latin** collapsed to its ASCII skeleton, so a page's words were hashed as
  something the page did not say - the accent was not noise, it was dropped.
- **Canonically equivalent text** was two words spelled two ways: `é` (U+00E9) and `e` + U+0301
  are the same character and shingled differently.

## Decision

A word is a maximal run of `\p{L}` (letters), `\p{N}` (numbers) and `\p{M}` (combining marks -
they carry the vowels of Devanagari and Arabic), in any script; everything else is a separator,
as punctuation always was. Text is composed to **NFC** before that, so canonically equivalent
input is one word rather than two.

ASCII input is untouched, and that is load-bearing rather than lucky: after `toLowerCase`, the
old class kept exactly `a-z`, `0-9` and whitespace, which is what these keep too. No ASCII
page's shingles move, so `MIRROR_THRESHOLD = 0.25` and the pinned exact Jaccard (0.3879 for the
known stale mirror against `nodejs.org`, 0.0275 for the highest genuinely different cross-host
pair, both measured 2026-09-21) still describe the corpus they were measured on.
`test/similarity.test.mjs` pins that equivalence against the old rule.

## Rejected alternatives

- **Shingle over characters (character n-grams) instead of words.** This is the robust,
  language-agnostic basis and it would also fingerprint a script that does not separate words
  with spaces at all - Chinese, Japanese, Thai - where a whole page is one token and still
  shingles to nothing. Refused **for now**: the threshold and the pinned Jaccard were measured
  on the word basis, so changing the basis changes what those numbers mean and it needs its own
  measurement over real non-Latin pairs, not a ride-along in a bug fix.
- **Segment scripts without word spaces** (split CJK ideographs, dictionary-segment Thai). A
  per-script rule this module cannot measure from the corpus it has; and it would silently give
  those pages a sensitivity nobody has checked, which is the failure mode this module's
  measured constants exist to prevent.
- **NFKC normalisation.** It folds **distinct** characters together (`①` into `1`), inventing an
  equivalence the page did not have. NFC composes only canonically equivalent sequences, so it
  cannot create a false match - it can only recover a true one.
- **Transliterate to ASCII, or write the limitation down and keep it.** That is what the code
  did. It loses the text: a page in another script was not merely unjudgeable, it was reported
  as a second independent witness, which is the best grade in the registry for one document.

## Consequences

A page in a space-separated script is now fingerprinted, and two copies of one are one document.
A page written in a script with **no word separators and no punctuation** still shingles to
nothing and stays unjudgeable. That is recorded, not hidden, as a KNOWN-UNKNOWN: it needs a
measured basis of its own, and the trigger to take it is a corpus in such a script that needs
duplicate detection.

A page whose text is accented Latin may move slightly, because its words are now themselves
rather than their ASCII skeleton; `mirror` is a finding a reviewer reads, never a gate failure
(ADR-0108). The root corpus and every project under `docs/decisions/` keep their grades,
because their captures are ASCII.
