# ADR-0053 — The edit gate judges a subfolder cwd by the repository it is in

- **Date:** 2026-09-27
- **Status:** superseded in part by ADR-0182 (a named file is judged by the project it belongs to in its repository; a call naming no file is still judged by the cwd)
- **Area:** `hooks/edit-gate.mjs`
- **Refines:** ADR-0017 (the wrong project is asked about, not searched for)

## Context

The kit treats the current working directory as the project. The commit gate runs from the
repository's top level, because that is where git runs hooks, so for the commit gate the cwd
and the repository are the same thing. The edit hook runs from the session's cwd, which the
payload reports. When an agent works in `src/`, the cwd has no gate markers. So on 2026-09-27
the hook answered "not a gated project" and allowed every edit there, while the commit gate
would refuse the same file.

## Decision

If the cwd carries no gate markers, the edit hook asks git for the repository's top level. It
walks up from the cwd to that directory, keeping the cwd's own spelling, because git reports a
real path (`/private/tmp` for `/tmp` on macOS). If that directory is gated, it is the root.
Outside a repository the cwd is all there is, as before. Relative targets resolve against the
cwd.

This is not the search ADR-0017 forbids. Git names the one repository this directory belongs
to, which is the same root the commit gate already uses. Nothing else on the disk is read.

## Rejected alternatives

- **Walk up from the cwd looking for gate markers.** It could reach a parent folder that holds a
  different project, which is the wrong-project case ADR-0017 exists for. The repository
  boundary stops at the right place.
- **Take the root from the target file's location.** An agent editing a file in another project
  would then be judged by that project's gate, silently. The cwd, or its repository, is where
  the operator put the session.
- **Leave it.** The two gates would keep disagreeing about the same file, and the edit gate
  would be off for anyone who `cd`s into a subfolder.

## Consequences

- An edit gate call from a subfolder spawns `git rev-parse` once, with a 5 s timeout. A missing
  git or a failure is treated as "not a repository".
- A test runs the hook from `src/` of a gated repository, where code asks and research is
  allowed, and from a directory outside any project, where everything is allowed.

## Trigger that would reopen this

The runtime's payload starting to carry a project root distinct from the cwd. That root would
then be the better answer.
