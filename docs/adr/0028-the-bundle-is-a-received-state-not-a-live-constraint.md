# ADR-0028 — The bundle is a received state, not a live constraint

- **Date:** 2026-09-20
- **Status:** accepted
- **Area:** documentation, the commit gate, archive provenance
- **Supersedes:** ADR-0022's byte-preservation consequence (the rest of ADR-0022 stands)
- **Restores:** ADR-0007 in full — the same-commit map rule now has no exception

## Context

This project arrived as a ZIP of 80 planning documents. `BUNDLE_INDEX.md` lists their
SHA-256 digests and calls itself "the navigation and integrity index for this ZIP".

ADR-0022 read that as a constraint on the present:

> `docs/ARCHITECTURE.md` describes a superset of what exists. It is a **byte-preserved
> bundle source** — `BUNDLE_INDEX.md` carries its SHA-256 — so it was not edited […]
> That is a deliberate exception to the same-commit map rule, taken because breaking the
> archive's own integrity index to satisfy a documentation rule trades a checkable
> property for an unverifiable one.

That reasoning was inverted, and the cost showed up as soon as the code started moving.

**The premise is already false.** Nine of the eighty files have changed: the whole
corpus (`research/BRIEF.md`, `DISCOVERY.md`, `EVIDENCE.md`, `MAP.md`, `SOURCES.md`,
`plan.json`), `docs/ARCHITECTURE.md`, `docs/adr/README.md`, and `BUNDLE_INDEX.md` itself.
Most of those moved because the kit was *used* — a research-first kit whose corpus never
changes is one nobody ran. The bundle stopped being byte-preserved the moment the archive
became a repository, which was the point of unpacking it.

**The trade was backwards.** ADR-0022 said the exception protected a checkable property
against an unverifiable one. The opposite is true, and it is measurable: *nothing in this
kit has ever read `BUNDLE_INDEX.md`* — `grep -rn BUNDLE_INDEX fetchproof/` returns
nothing, so those digests had never once been verified by anything. Meanwhile the
same-commit map rule **is** checked, mechanically, on every commit, by the gate this
project ships. The exception suspended the property that was being enforced in order to
protect the one that was not.

**It cost something real.** Three commits took `--no-verify` to get past the map rule.
And twice in one session the gate blocked a commit and was **right both times**:
`ARCHITECTURE.md` genuinely was stale — it described `CMD_SAFE_ARG` as an allowlist after
it became a denylist, claimed the adapter stamped `completeness: 'full'` after it started
grading, described "two adapters" after there were two *sides*, and named a `rankedBy`
field that only ever existed in memory. An exception that suppresses a rule which keeps
catching real drift is a bad exception.

## Decision

**`BUNDLE_INDEX.md` records the archive as received on 2026-09-17. Its digests are
frozen at that state and are never updated. It constrains nothing about the present.**

Three consequences follow:

1. **ADR-0007 applies without exception.** A change inside a declared code path updates
   `docs/ARCHITECTURE.md` in the same commit, including this project's own. No
   `--no-verify` for this reason again.

2. **The record becomes checkable.** `lib/bundle.mjs` + `bin/bundle.mjs` compare the
   working tree against the frozen manifest and report three categories: unchanged,
   changed-and-expected, changed-and-not-expected. `EXPECTED_TO_DRIFT` names the corpus,
   the map and the ADR index — the files the project's own rules require to move. The
   list is not an excuse; it is the distinction between "this moved because the kit ran"
   and "this moved and nobody knows why", which is the only thing a drift report exists
   to draw.

3. **Git is the integrity index now.** Every one of those 80 files has a better record in
   commit history than a static line in a markdown file. The frozen digests still earn
   their place: they attest to the *handover*, which git cannot, because the repository's
   first commit is already the unpacked archive.

## Alternatives considered

**Regenerate the digests on every change.** The obvious move, and it destroys the only
thing the manifest is good for. A hash file that is rewritten whenever it disagrees with
reality records nothing — it can never fail, so it can never tell you anything. Frozen,
it answers a real question: what did we actually receive?

**Drop `fetchproof/lib` from the gate's guarded paths.** This was the other way to stop
the blocking, and it is the worse one by exactly the evidence above: the rule caught four
genuine documentation errors in three days. Removing a working check to avoid an
inconvenient exception is how a gate becomes decoration.

**Delete `BUNDLE_INDEX.md`.** Tidy, and it throws away the provenance of the handoff. The
archive is where every planning document in this repository came from; that is worth a
file.

**Leave it and keep using `--no-verify`.** Rejected on the pattern rather than the
instances. Each override was recorded and explained, so nothing was hidden — but an
override that becomes routine stops being an override, and the next one would not get
read as carefully as the first three were.

## Consequences

- `lib/bundle.mjs`, `bin/bundle.mjs` and `test/bundle.test.mjs` are new.
- `doctor` gains a `bundle` line, so drift is visible in the health report rather than
  only when somebody thinks to ask.
- `BUNDLE_INDEX.md`'s header now says what it is — a frozen record — so the next reader
  does not have to reconstruct that from an ADR.
- Its own digest is listed in `EXPECTED_TO_DRIFT`: a file cannot record its own hash and
  be correct about it.
- ADR-0022 keeps its actual decision, which was right and is unaffected: the
  release-evidence validator layer stays deferred, with nothing stubbed in to pretend it
  exists. Only its documentation consequence is superseded.
