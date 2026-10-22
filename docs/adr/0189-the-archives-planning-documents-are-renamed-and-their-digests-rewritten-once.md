# ADR-0189 - The archive's planning documents are renamed too, and their digests are rewritten once

- **Date:** 2026-10-22
- **Status:** accepted
- **Area:** the 44 planning documents of the received archive that spelled the kit's former
  name: `RESEARCH_REPORT.md`, 15 of the ADRs 0001-0021, `docs/adr-0016-verification-2026-09-15.md`,
  the three architecture reviews of 2026-09-14 and 2026-09-15 and
  `docs/researcher-review-2026-09-16.md`, and 5 plans and 18 specs under `docs/superpowers/`;
  `BUNDLE_INDEX.md` (their 44 inventory rows, the 11 implementation pairs, its header)
- **Order:** the owner, 2026-10-21, when asked whether these documents should be renamed as
  well: "Rename them too"
- **Supersedes in part:** [ADR-0028](0028-the-bundle-is-a-received-state-not-a-live-constraint.md),
  one sentence of its decision: "Its digests are frozen at that state and are never updated."
  The 44 rows are updated once, for this rename. The rest of ADR-0028 stands. Also
  [ADR-0186](0186-the-kit-is-renamed-fetchproof-with-a-clean-break.md), item 3, the bullet that
  kept the received archive's planning documents and their unresolved links in the old spelling.
- **Freeze (ADR-0117):** documentation only. No command, flag, format, check or line of the
  kit's code changes; `verifyBundle`, `EXPECTED_TO_DRIFT` and their tests are as they were.

## Context

ADR-0186 renamed the kit Fetchproof in every file except the ones its item 3 lists (PR #433,
merged 2026-10-21 as 763ea36). One entry in that list is the received archive's planning
documents. `BUNDLE_INDEX.md` inventories the 80 files of the archive received on 2026-09-17,
and 44 of them spelled the old name, 320 times: `research-kit/` paths and commands,
`~/.agents/research-kit`, `RESEARCH_KIT_*` variables, the report's title "Research-Kit", and
"the research kit" in prose.

The rename changed them at first. The suite then failed two tests,
`bundle > THIS repository: every change against the archive is accounted for` and
`cli > ADR-0028: bin/bundle.mjs reports this repository honestly`. A planning document whose
bytes no longer match its digest is an unexpected change, and ADR-0028's test
`EXPECTED_TO_DRIFT does not cover a planning document` refuses to exempt one. The 44 were put
back byte for byte, and ADR-0186 recorded that renaming them would mean superseding ADR-0028.
ADR-0028 was the only reason they kept the old name: none of them is evidence, and nothing in
them is a quote of a capture or a name somebody else gave. One path in them names a commit's
tree (decision 2).

We recommended leaving them as received. The owner chose to rename them.

## Decision

1. **The 44 documents are renamed with ADR-0186's spelling map**, as the other dated records
   were (ADR-0186 item 2). 319 of the 320 mentions change: `research-kit` becomes
   `fetchproof`, `RESEARCH_KIT_` becomes `FETCHPROOF_`, `Research-Kit` and `Research-kit`
   become `Fetchproof`, and the three places where prose calls the kit "the research kit" say
   `Fetchproof`. No other byte changes. The line endings stay, and so do the Markdown hard line
   breaks (two trailing spaces) on nine of the renamed lines.
2. **One mention is kept:** `git show e7f4d76:research-kit/lib/finding.mjs` in
   `docs/adr-0016-verification-2026-09-15.md`. It names a path inside a commit's tree, and that
   tree held `research-kit/`. ADR-0186 item 3 keeps a link pinned to a commit for the same
   reason. The commit is in the archive's own history, not in this repository's. None of the
   44 holds a URL, a `[quote: ...]` of a capture, a path under `research/raw/`, a name somebody
   else gave such as Apple's ResearchKit, or the initials `rk-`/`RK-` that ADR-0186 renamed.
3. **`BUNDLE_INDEX.md`'s 44 rows for them hold the SHA-256 of the renamed bytes.** Before each
   row was rewritten, its digest was checked against the file as `main` held it (7470287), and
   all 44 matched. Main had kept them as received, so the received digest of each is in
   `BUNDLE_INDEX.md` at every commit from 8cc1389 (2026-09-17) to 7470287. The other 36 rows
   are unchanged, including the index's own frozen digest. Under "Implementation, schema, or
   test artifacts", the 10 of the 11 pairs whose target named `research-kit/` now name
   `fetchproof/`, as the renamed documents do. The header and the inventory section say which
   rows were rewritten, and where the received digests are.
4. **This is one rewrite for one recorded reason. The inventory is still not regenerated.**
   ADR-0028 stands otherwise. The inventory is not rewritten whenever a file disagrees with
   it, and `EXPECTED_TO_DRIFT` still exempts no planning document. A later edit to any of the
   44, or to any other planning document, is still reported as unexpected by `bundle.mjs` and
   `doctor`, and it fails `bundle > THIS repository...`.

## Rejected alternatives

- **Leave them as received.** This was our recommendation on 2026-10-21. Our reasons:
  - ADR-0028 keeps the inventory because a frozen digest answers a question git cannot:
    what did we receive? A rewritten digest attests to bytes nobody received, so for these
    44 the handover can then be proved only from git history.
  - The documents are dated records of the archive, in which the kit was called research-kit.
    A reader meets the new name everywhere they act: the commands, the READMEs and the current
    ADRs. They read the 44 for history.
  - ADR-0186 had already listed them as an exception, and `BUNDLE_INDEX.md` said why.

  The owner chose otherwise: "Rename them too". That follows the owner's order of 2026-10-20,
  "change all files that says: research-kit into Fetchproof", and the owner's choice of the same day to rename
  the dated records too (ADR-0186 item 2). The 44 are dated records like the reviews, plans and
  ADRs that #433 renamed. Git history keeps the received digests, so renaming the documents
  loses no record.
- **Add the 44 to `EXPECTED_TO_DRIFT` and keep the received digests.** This would keep the
  handover's record whole. But 44 planning documents would leave drift reporting: a later
  unexplained edit to any of them would be reported as expected. ADR-0028 rejects exactly
  that, and its test `EXPECTED_TO_DRIFT does not cover a planning document` would fail. It
  would also change the kit's code for a rename, and the freeze does not admit that.
- **Keep both digests in `BUNDLE_INDEX.md`**, a received row and a renamed row for each file.
  `parseManifest` reads every `sha256  path` line as a row, so each received row would be
  reported as an unexpected change. Two rows per file would need a new format for the index and
  its reader, and the freeze does not admit one.
- **Regenerate the whole inventory.** ADR-0028 rejected this, and its reason still holds: an
  index rewritten whenever it disagrees records nothing. Only the 44 rows whose documents this
  change edits are rewritten. The corpus, the map and the other files expected to drift keep
  their received digests, and they are still reported as changed as expected.
- **Rename the pinned `e7f4d76:research-kit/...` path too.** It would name a path that the
  commit's tree never held, so the recorded command would fail where it was run.
- **Reword `bundle.mjs`'s summary now** (see Consequences), with the `--all` heading
  "unchanged since 2026-09-17" and the comment in `lib/bundle.mjs` that says the digests stay
  "exactly as the archive arrived". Not taken in this change. It would change the kit's output
  and a test (`cli > ADR-0028: bin/bundle.mjs reports this repository honestly` matches the
  summary's phrase), and the owner's order covered the documents and their digests. It can be
  ordered as a task of its own.

## Consequences

- The old name is left in the 44 only in the pinned path of decision 2.
- `node fetchproof/bin/bundle.mjs` reports what it did before this change: 66 of 80 rows
  unchanged, 14 changed as expected, nothing unexpected, nothing missing. Its summary still
  says "still byte-identical to the 2026-09-17 archive". For the 44 renamed documents, that
  now means identical to their rows as this ADR rewrote them. The `BUNDLE_INDEX.md` header,
  where the report sends a reader, says so.
- To prove the handover, a reader checks each received file against `BUNDLE_INDEX.md` at
  7470287 or any earlier commit. The received bytes are in the same commits. Applying
  ADR-0186's spelling map and the three prose edits of decision 1 to the received bytes, with
  the kept path of decision 2, gives the renamed digest.
- The specs' links to the kit's schemas, tests and validators now name `fetchproof/`. Seven of
  the eight files they name are in this repository, so those links resolve here again;
  `fetchproof/schemas/trap-register.schema.json` is not, as `research-kit/schemas/trap-register.schema.json`
  was not before the rename.
- Reverting this change restores the received bytes and their digests together.

## Trigger to revisit

Reopen when one of these happens:

- the history before 2026-10-22 is rewritten or lost: a squash, a filter-repo, or a copy of
  the repository without its history. The received digests then exist nowhere else, so first
  restore them from 7470287 into a record that survives the change;
- another rename of the kit is ordered. The same 44 rows would move again, and each rewrite
  leaves the inventory recording less of what was received;
- a reader takes `bundle.mjs`'s "byte-identical to the 2026-09-17 archive" for a renamed
  document to mean the received bytes. Then the summary is reworded.
