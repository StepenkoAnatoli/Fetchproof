# ADR-0141: The installer records no hand-on to another copy of the kit's gate

Date: 2026-10-04
Status: accepted. Supersedes one rejection in ADR-0134 ("have the install skip recording a
kit folder"); refines ADR-0112 (the hand-on) and ADR-0134 (the finding). A bug fix under the
freeze (ADR-0117): no new command, flag, key or check.

## Context

The install records the `core.hooksPath` it replaced as `fetchproof.previousHooksPath` in
git's global config, where the sh hooks read it, and in `~/.agents/fetchproof.install.json`,
where `removeCommitGate` reads it to restore the operator's setting on uninstall (ADR-0112,
ADR-0113). When that folder holds another copy of this kit's gate, doctor warns and names the
remedy `git config --global --unset fetchproof.previousHooksPath` (ADR-0134).

On the operator's machine (2026-10-04) that remedy lasted one session. `installCommitGate`
computes the folder it records as the first of the install state's `previousHooksPath` and
the current global `core.hooksPath` that is not the kit's own folder, and writes it to both
stores on every run. The next `install-hooks` run - another session ran one; every kit update
runs one - read the old kit's `githooks/` back out of the state file and wrote it into git
config, and the previous implementation's gate blocked commits again on its outdated checks.
The workaround applied by hand was to unset the git entry AND null the field in the state
file. A remedy that has to be applied in two places, and that a routine command undoes, is
not a remedy.

ADR-0134 rejected making the install skip a kit folder on two grounds: the install cannot
tell an obsolete kit from a second deliberate one, and the machines already carrying the
record would not be helped. The first ground is answered by ADR-0134's own trigger - a
second deliberate kit on one machine is not a supported shape, and doctor already tells the
operator to remove exactly that record. The second is answered by judging on re-install as
well as first install: the machines carrying the record are repaired by the next
`install-hooks` run instead of being broken by it.

## Decision

- **`handOnState` lives in `lib/installer.mjs`**, beside the install that writes the record;
  `lib/doctor.mjs` re-exports it, so the finding is still read from doctor and the two judge
  by one rule. Its four states and its relative-path resolution are unchanged.
- **`installCommitGate` records no folder `handOnState` classifies as `kit`** - on a first
  install over an old kit's gate, and on a re-install from a state file that still names one.
  The kit's own folder was already refused; this extends "itself" to "any copy of itself".
  The install state and git config agree once an install has run, so doctor's one-line
  remedy is durable: the next install drops what the operator unset rather than restoring it.
- **A `missing` folder stays recorded.** The hooks hand on to nothing there (`hand-on.sh`
  exits 0 for an absent hook), the uninstall restores the operator's `core.hooksPath` from
  it, and an absence at install time may be a drive that is back by the next commit. The
  installer refuses what it can positively identify - a kit header in a `pre-commit` it has
  read - not what it merely fails to find. doctor's `missing` warning is re-judged on every
  run and remains advice.

## Rejected

- **doctor clears the install state as part of its remedy.** doctor is read-only by design,
  with one deliberate write (the override log). A health check that rewrites what it
  measures erases the evidence of the problem it found - the rule the `deploy` check is
  pinned to.
- **The fix line names both steps** (the git unset and an edit to the JSON state file). An
  operator handed a two-step hand edit of a kit-owned file has been handed the kit's job; and
  the second step would be undone by the next first install anyway, which would record the
  folder again from `core.hooksPath`.
- **A flag on `install-hooks.mjs` to forget the record.** New surface under the freeze
  (ADR-0117), for a behaviour the installer should simply have.
- **Also refusing a `missing` folder in the installer.** See the decision: it would drop a
  legitimate record on a transient absence, and the two existing tests that record and
  restore `/opt/myhooks` pin the restore the operator is owed.
- **Also refusing to restore a `kit` folder in `removeCommitGate`.** Not needed once the
  state agrees with git config: after the next install the state carries no kit folder to
  restore. The window between a hand unset and that install is noted, not closed.

## Trigger to revisit

ADR-0134's trigger stands: if a second deliberate kit install on one machine ever becomes a
supported shape, `kit` is no longer a defect and both the finding and this refusal are
superseded. If a `missing` hand-on is ever observed to do harm, the installer's refusal
extends to it, with the uninstall restore decided then.
