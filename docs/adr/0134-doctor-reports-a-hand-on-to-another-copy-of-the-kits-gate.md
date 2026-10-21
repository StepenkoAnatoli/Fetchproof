# ADR-0134: doctor reports a hand-on to another copy of the kit's gate

Date: 2026-10-03
Status: accepted. Lifts the freeze (ADR-0117) for this one check. Refines ADR-0112 (the hand-on).

## Context

The install records the `core.hooksPath` it replaced as `fetchproof.previousHooksPath`,
and every hook in `githooks/` runs that folder's hook after its own (ADR-0112), so a machine
that had husky or its own hooks before the kit keeps them. On the maintainer's machine the
recorded folder was the previous implementation's own `githooks/`. Every commit ran two
gates; the older one decided on its own rules, and on 2026-10-03 it crashed ("number 0 is
not iterable") and failed open after the current gate had allowed. doctor said READY. The
strings came from no file of the current kit, and it took a search of this repository's
history to say where they were from.

## Decision

- `handOnState({ previous })` in `lib/doctor.mjs`, pure: `none` (nothing recorded),
  `missing` (the folder is gone), `kit` (its `pre-commit` carries the header every version of
  this kit's hook has carried, "fetchproof commit gate"), `other` (anything else, including
  a folder with no `pre-commit`).
- `gateHealth` reads the recorded folder through `machine.previousHooksPath` and warns on
  `kit` and on `missing`, each with the remedy `git config --global --unset
  fetchproof.previousHooksPath`. `none` and `other` say nothing: handing on to somebody
  else's hooks is the point of ADR-0112.

## Rejected

- **Refuse to hand on to a kit hook in the hooks themselves.** The hooks are POSIX sh with
  no module behind them; a header test there is a second copy of the rule, and a hand-on that
  silently skips a hook is the kind of silence the kit exists to remove. doctor reports, the
  operator decides.
- **Have the install skip recording a kit folder.** The install cannot know that the folder
  it replaces is obsolete rather than a second deliberate kit; and the machines that already
  carry the record would not be helped.
- **Warn on `other` too.** A husky folder handed on to is the designed case, and a warning
  on the designed case is noise that teaches people to ignore the check.

## Trigger to revisit

If a second deliberate kit install on one machine ever becomes a supported shape, `kit` is no
longer a defect and this check is superseded.
