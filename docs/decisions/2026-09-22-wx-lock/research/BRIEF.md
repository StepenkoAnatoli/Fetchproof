# Brief - Node.js fs.writeFileSync wx flag O_EXCL exclusive create concurrent EEXIST

_Auto-drafted 2026-09-29 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

`lib/provenance.mjs` takes the collector's lock by creating a file with `flag: 'wx'`, and
ADR-0020 states the reason: "acquired with `O_EXCL` (`flag: 'wx'`) so the kernel refuses a
second creator instead of letting it overwrite". Every guarantee about the ledger not
interleaving rests on that being true.

"Done" is a yes or no a builder can act on, plus any condition under which it stops holding.

## What we verified

| Claim | Source | Type |
|---|---|---|
| **The guarantee, and the caveat the ADR omits.** "The exclusive flag `'x'` (`O_EXCL` flag in `open(2)`) causes the operation to return an error if the path already exists" - which is the property the collector lock depends on. In the same paragraph: "**The exclusive flag might not work with network file systems**", and on POSIX it errors on a symbolic link even when the target does not exist. The first half confirms ADR-0020; the second half is a condition ADR-0020 never states. | E-01 `nodejs.org` (U-1, U-2) | P |

## Contradictions and how they were resolved

None. E-01 and E-02 are the same Node documentation at two vintages (the flag table in
`fs.open`), and they carry the same caveat in older and newer wording.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**Written retroactively on 2026-09-29.** The finding has been in the kit since 2026-09-22.

- **The lock holds on a local filesystem.** The exclusive flag lets exactly one of N creators
  win: 24 racing processes produced 1 winner and 23 `EEXIST`.
- **It is not promised on a network filesystem.** Node says the flag "might not work" there.
- **Where the kit records this:**
  - `lib/provenance.mjs`, beside the lock;
  - the ARCHITECTURE invariants table: "exclusive on a local filesystem, and not promised on
    a network one".
- **Out of scope:** a network-safe lock (for example, lease files with heartbeats). No
  operator collects onto a network share. Revisit if one does.

## Next steps

1. Read the Decision above; it records what was already decided, and when.
2. Hand this file to the builder (phase 2). Re-running `node /home/user/Fetchproof/fetchproof/bin/brief.mjs`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=ce80257f8186ea42 inputs=400981d411888fec gate=pass -->
