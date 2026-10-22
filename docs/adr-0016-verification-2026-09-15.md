# ADR-0016 verification — 2026-09-15 (an audit of a move that was already merged)

An audit, not a change report. The session that was handed the ADR-0016 task
found the task already done: the move is in `main`, merged as PR #7 from
`arena/01a0a3e6`, merge commit `b84a9a6`, 2026-09-15 07:52 UTC, in the two
commits the task names —

- `5d4c9d0` — the extractor leaves `lib/collect.mjs` for `lib/finding.mjs`
- `e7f4d76` — one dated line in `RESEARCH_REPORT.md`

Repeating it would have produced an empty diff, so this session verified the
change instead of remaking it, and this file is the record. It sits in `docs/`
for the reason the 2026-09-15 review gave for landing itself: a result the next
session cannot read gets re-derived from scratch, and re-deriving is how one
fact ends up with two addresses.

**Verdict: the move is what it claims to be — a pure relocation.** The 460 lines
are the same bytes, the 34 test blocks are the same blocks, and the function
answers identically on both sides of the seam. One defect was found, and it is a
defect in the prose around the change rather than in the change: both
`docs/ARCHITECTURE.md` and ADR-0016 recorded `lib/finding.mjs` as 471 lines. It
is 472.

## Method

1. **The "before" tree was fetched, not recalled.** `git fetch --depth=3 origin
   arena/01a0a3e6-deep-research-agent` returns `7f359dc`, the parent of the move
   commit, so every comparison below is against a real tree.
2. **The moved region was compared byte for byte**, and the test files were
   compared block by block: a test block is a line beginning `test(` through the
   first following line that is exactly `});`, and the two new files' blocks were
   compared to the old file's as a multiset, so a relocation counts and a rewrite
   does not.
3. **The pre-move extractor was rebuilt and run.** The 460-line block has no
   imports and no filesystem, so on its own it is a module: it was written to a
   scratch file and imported next to the current `lib/finding.mjs`, and both were
   run over the same inputs.
4. **The suite was run in the pre-move tree, in the reverted tree, and in the
   current tree** — the last from three working directories, because some tests
   are cwd-sensitive.
5. **The revert test was re-run** as the standing protocol defines it.

## What each claim measured

| Claim about the move | Measurement | Result |
| --- | --- | --- |
| 460 lines moved byte for byte | old `lib/collect.mjs` lines 26–485 vs `lib/finding.mjs` lines 13–472 | identical — 460 lines, md5 `312bc1f3afee4390e938ec94e69abe60` on both sides |
| the extractor was 70% of the collector | old `lib/collect.mjs` is 658 lines; the block is 460 of them (69.9%). 658 − 460 − 24 lines of header and imports = the 174 lines of actual collector ADR-0016 names (`writeRaw`, `collectOne`, `uniqueRawName`, their doc comments, and the blanks between them) | confirmed — the arithmetic in the ADR and the 70% figure both hold |
| `firstFinding` keeps one address | `lib/finding.mjs` exports exactly one symbol; `lib/collect.mjs` exports only `writeRaw` and `collectOne`; one import edge, `collect → finding` | confirmed — no re-export |
| one consumer (ADR-0016's trigger 1, unfired) | `grep` over the kit: `lib/collect.mjs` is the only module that calls it. The one other importer is `test/finding.test.mjs`, the test file that moved with it | confirmed — still one consumer |
| 17 tests moved, 17 untouched, none edited | 34 blocks in the old file, 34 across the two new files, byte-identical as a multiset (17 + 17); old file 521 lines = 367 + 154 | confirmed |
| the collector's pin stayed behind | *the evidence row is filled with prose, not the page banner* is in `test/collect.test.mjs`, and it is the file that feeds the shared fixture | confirmed |
| 311 tests before and after | pre-move tree `7f359dc`: 311 tests, 19 files, green. current tree: 311 tests, 20 files, green | confirmed — nothing added, nothing lost |
| green from three working directories | repo root, `fetchproof/`, `fetchproof/test/` | confirmed |
| behavior unchanged across the seam | pre-move and post-move extractor run against each other over 6 raw captures, the 4 page fixtures, 9 edge cases and 400 deterministic fuzz slices, each through 6 fallbacks — **2,514 comparisons** | **0 differences** |
| the revert test | `git revert --no-commit 5d4c9d0` on top of `e7f4d76` in a throwaway worktree: no conflict, and the tree is `7f359dc`'s except for `RESEARCH_REPORT.md` (+1 line — the second task's, which the revert does not touch). Suite there: 311, green | confirmed |
| preflight unchanged | repo root: `PASS`, 0 failures, 10 warnings (6 `capture-transport`, 3 `capture-partial`, 1 `citation-primary`), 4/4 unknowns closed, 6 evidence rows, 6 raw captures | confirmed |
| overrides: 0 | `research/overrides.log` does not exist | confirmed |

## The one defect, and its disposition

`lib/finding.mjs` is **472** lines — `wc -l`, `awk NR`, and `git show
e7f4d76:research-kit/lib/finding.mjs` agree, and the file ends in a newline, so
no off-by-one of the counting kind is hiding here. Both ADR-0016 and
`docs/ARCHITECTURE.md` recorded 471.

- **`docs/ARCHITECTURE.md` is corrected** (471 → 472), with a pointer to this
  file. The map is the live one: ADR-0007/0008 make it the thing that has to
  match the tree, so a count that disagrees with the file it counts is drift of
  exactly the sort the rule exists to prevent.
- **ADR-0016 is left in its own words.** It is a dated record of a decision, it
  is superseded-by-convention rather than edited (the same hand ADR-0009 was
  given), and a future reader who reaches it deserves to see what was written on
  2026-09-15. The correction lives in the map, which now names the discrepancy
  and points here, so the count has one live owner and one dated record.

## What could not be verified

- **The 2,556-comparison figure in the original report.** An independent run of
  the same idea reached **2,514** comparisons with **0** differences — the input
  mix is not identical to the original's (6 raw captures, 4 fixtures, 9 edge
  cases, 400 slices, 6 fallbacks here), so the digit is not reproduced. The
  conclusion is: not "the tests still pass", but no observable difference
  between the two implementations over every input tried.
- **The red-suite incident** (7 failures, `body is not defined`) cannot be
  re-observed from a merged tree; only its repair is visible — the `body()`
  helper the collector's scraper stub feeds on is present in
  `test/collect.test.mjs`. The report of it is taken at its word, and it is
  recorded in the commit that fixed it.
- **That the committed review is a faithful reconstruction.** `docs/architecture-
  review-2026-09-15.md` says the round's original was written outside the
  repository and was not recoverable. That remains true here — the original is
  still not in this sandbox — so the document is audited as what it claims to be
  (a reconstruction, labelled as one), not as the round's original.
- **The sandbox-only claims** (a commit gate not installed, `core.hooksPath`
  unset) are the one kind that can be re-checked: `git config --get
  core.hooksPath` returns nothing in this sandbox too, so the same-commit map
  rule is being honoured by hand here as well.

## Reproducing

```
git fetch --depth=3 origin arena/01a0a3e6-deep-research-agent   # brings back 7f359dc, the pre-move tree
node fetchproof/bin/selftest.mjs                              # repo root, fetchproof/, fetchproof/test/
node fetchproof/bin/preflight.mjs                             # PASS, 0 failures, 10 warnings
```

The block comparison, the test-block multiset comparison and the two-implementation
equivalence run are scripts written for this audit and are not committed: they
are checks about a move that is already merged, and a script whose "before" is a
fetched commit would need that commit to mean anything. What they measured is
recorded in the table above, with the counts.
