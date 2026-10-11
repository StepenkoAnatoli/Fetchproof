# Merge Protocol

<!-- Modified by Research-Kit: ADR-0146 head-pinned command and 2026-10-08 corrections to entry conditions, consent, resumed/moved heads and follow-up merges. Received baseline: StepenkoAnatoli/SkillsMDs at 3f2d2fc. -->

Stage 8 of auto-build. The pull request is the run's delivery; the merge is the one irreversible
action in the run, so it has the strictest entry conditions and the most explicit record. The
protocol is written for GitHub and the `gh` CLI; section 8 covers other hosts.

## Contents

1. Entry conditions
2. Prepare the branch
3. Open the pull request
4. Wait for checks
5. Merge conditions and the readiness script
6. Merge
7. Post-merge verification and cleanup
8. Failure handling
9. Without `gh`, or not on GitHub

---

## 1. Entry conditions

All of these are true, recorded in `RUN.md`, before anything in this file runs:

- Stages 5, 6 and 7 are DONE or SKIPPED with reasons; every S1 and every break-test Critical is
  FIXED and RE-REVIEWED, or accepted by the user in writing with the acceptance quoted in
  `RUN.md`; every other finding has a disposition.
- `MANDATE.md` records the owner's approval of the current design; a standing preference
  is not that reply. The separate completed-head approval is required before merge.
- Every research project the run created is committed with its ledger (`git add -f
  <project>/research/raw/.fetches.jsonl`) and `preflight` still exits 0 from inside it.
- The run folder is committed on the working branch (or kept in an ignored folder because the
  project forbids it, with that said in the report).
- The full gate has been run on the working branch head and its failing set equals the baseline
  exactly.

## 2. Prepare the branch

1. `git status` clean on the working branch; no builder worktree has uncommitted changes
   (`git worktree list`, then `git -C <path> status` for each).
2. Fetch the base: `git fetch origin <base>`. If the base moved since the baseline was measured,
   lead-orchestrator's rule applies: re-measure the baseline on the new base, rebase the working
   branch, re-run unit reviews for every unit the rebase touched, then re-run the full gate.
   Record the new base commit.
3. Scan the diff for secrets before pushing: `git diff <base>...HEAD` searched for patterns such
   as `_live_`, `api[_-]?key`, `secret`, `token`, `BEGIN .* PRIVATE KEY`, long base64 or hex
   runs in config and env files. A hit stops the stage; a secret is removed from history, not
   from the tip, and the user is told.
4. Push the working branch only: `git push -u origin <working-branch>`. Never `--force`. If the
   push is rejected because the remote branch moved, fetch, inspect what moved and why (a
   previous session of this run? another person?), and never overwrite it.

## 3. Open the pull request

Write the body from lead-orchestrator's `references/report-templates.md` pull request template,
with these additions under their own headings: the requirement rows delivered (`R-nn`), the
research projects and their gate results, the break-test and gap-audit report paths with their
headline results, and the `MANDATE.md` path with its reply token.

```
gh pr create --base <base> --head <working-branch> --title "<type>(<scope>): <summary>" --body-file <path>
```

Record the pull request number and URL in `RUN.md` and the stage table. Under `GO`, the stage
holds the merge: Next action "awaiting owner: merge <completed-head-sha>",
and the report says the merge was held by the Mandate.

If the host, the branch protection or the CI appends further checks only after a pull request
exists, those checks are part of the gate from this point.

## 4. Wait for checks

```
gh pr checks <number> --watch --fail-fast
```

A timeout (default 45 minutes, or the Mandate's) is a stop, not a failure: record "checks still
pending after <n> minutes" and Next action "re-run readiness". Do not poll in a tight loop and do
not re-trigger a workflow without reading why it has not started.

A check that cannot run on the lead's host (another operating system, a GPU, a signing identity)
is exactly the leg lead-orchestrator lists under "Not verified here": it must be green on the
pull request before the merge, and its result is read from the pull request, not assumed.

## 5. Merge conditions and the readiness script

Run `scripts/pr-readiness.sh <number-or-url>` from the repository root. It prints `READY` or one
line per unmet condition, and exits:

| Exit | Meaning                                                        | Lead does                                   |
|------|----------------------------------------------------------------|---------------------------------------------|
| 0    | READY: every condition below that `gh` can see holds           | continue to the lead's own checks, then merge |
| 1    | NOT READY: at least one condition fails; each is printed       | section 8                                   |
| 2    | UNDETERMINED: a value could not be read (API error, draft state unknown) | re-run once; then record and stop |
| 3    | BLOCKED: no `gh`, not authenticated, or not a GitHub repository | section 9                               |

The script checks what the host knows: the pull request is open and not a draft; it targets the
Mandate's base; `mergeable` is `MERGEABLE` (no conflicts); `mergeStateStatus` is `CLEAN` (or
`UNSTABLE` only when every *required* check passed and the failing ones are not required - the
script says which); the review decision is not `CHANGES_REQUESTED`; every required check
succeeded with none pending; the branch is not behind the base when the protection requires it
up to date. It reads, never writes.

The lead then confirms what the host cannot know, and writes each as a line in `RUN.md`:

- the head SHA the script reported is the SHA the final gate ran on (`git rev-parse HEAD`);
- the gate's failing set on that SHA equals the baseline;
- the pull request was opened by this run (number matches `RUN.md`);
- no break-test Critical or High-Likely risk remains without a written acceptance;
- the completed-head summary and the owner's reply approving its full SHA are recorded
  verbatim in `MANDATE.md` and `RUN.md`, including acknowledgment of any listed stale
  unused evidence as `research-kit.md` requires.

Only when the script exits 0, the governing Research-Kit conditions hold and that
completed head has the owner's approval does the merge run. An early `GO MERGE`
records intent, not approval of code that did not yet exist. On resume, check the head
and re-run its required checks. Any push, fix, rebase or merged base update changes the
head and lapses approval; present the new summary and stop for its reply.

## 6. Merge

Use the method the Mandate names; if it names "repository default", use the repository's
allowed method, preferring, when several are allowed, a **merge commit** - it keeps each unit
and each break-test fix as the reviewable, revertible commit `RUN.md` already records. Squash
only when the repository allows nothing else or the Mandate asks, and then record the squash
commit against every unit it absorbed.

```
gh pr merge <number> --merge --match-head-commit <approved-sha>   # or --squash / --rebase per the above
```

`<approved-sha>` is the head SHA the readiness check printed and the approval named. Pinning it
makes the merge refuse if the head moved after the check. Pinning protects against
movement; it does not prove that the owner gave consent.

Add `--delete-branch` only when the Mandate says to delete the branch. Never pass `--admin`,
never pass `--auto` to leave the merge to a bot, and never use a review approval from the user's
account to satisfy a required-review rule: that rule exists for a person, and the run is not one.

Record the merge commit SHA from `gh pr view <number> --json mergeCommit` in `RUN.md` and the
stage table before doing anything else.

## 7. Post-merge verification and cleanup

1. `git fetch origin <base>` and confirm the merge commit is an ancestor of `origin/<base>`:
   `git merge-base --is-ancestor <merge-sha> origin/<base>`.
2. If the Mandate says to wait for base CI: `gh run list --branch <base> --limit 1` and watch
   the run that includes the merge commit; a red base after the merge is the run's defect to fix
   with the unit discipline (red-first, the mutation shown, the fix through the gate), in a new
   pull request within the unchanged Mandate's scope, with a separate completed-head
   approval before its merge, and recorded as a review miss.
3. Where the gate can run locally, run it once on `origin/<base>` at the merge commit and
   compare with the baseline; record the result.
4. Remove the run's branches and worktrees: builder worktrees, the break-test worktree and
   branch, and the working branch if the Mandate said so. List any that remain and why.
5. Research-Kit: from inside each research project, `audit.mjs` once for the report's snapshot.
6. Write the stage DONE with the merge commit, then Stage 9.

## 8. Failure handling

| Condition                                           | Cause to look for                         | Action                                                                 |
|-----------------------------------------------------|-------------------------------------------|------------------------------------------------------------------------|
| `mergeable` is `CONFLICTING`                        | base moved                                | section 2 step 2 (re-baseline, rebase, re-review touched units, re-gate); never resolve conflicts by taking "ours" wholesale |
| A required check failed                             | a review miss, a platform difference, a flaky test | fix red-first as a unit (reproduce, show the guard, fix, gate); record under Findings as a review miss; never re-run until green without a cause; never mark the check non-required |
| A check is pending past the timeout                 | runner queue, a workflow that needs approval for first-time contributors | record; Next action "re-run readiness"; ask the user if a human must approve the workflow |
| `reviewDecision` is `REVIEW_REQUIRED` or `CHANGES_REQUESTED` | branch protection needs a person; or a person objected | BLOCKED with Next action naming the reviewer; address every change request as a finding before asking for re-review |
| Push rejected                                       | remote branch moved                       | fetch and inspect; never force; if another person committed, stop and ask |
| Secret found in the diff                            | a builder committed a key                 | stop; rewrite the branch history to remove it (the one force-push the user may authorize, on the run's own branch only, after being told); rotate advice to the user |
| `gh pr merge` refused                               | protection rule, permissions              | read the message; never `--admin`; BLOCKED with the rule named          |
| Base red after merge                                | a leg that did not run on the PR          | section 7 step 2                                                       |

Two retries per failing condition, as for a unit. After that, BLOCKED with the reason, the
exact command and output, and Next action.

## 9. Without `gh`, or not on GitHub

- `gh` missing or not authenticated: open nothing. Push the working branch, write the pull
  request body to `PR.md` in the run folder, and end the stage with Next action "open the pull
  request from PR.md and merge when the conditions in section 5 hold". Say in the report that the
  merge was held for lack of a host CLI, not by a finding.
- GitLab, Gitea, Bitbucket or another host: if that host's CLI is installed and authenticated
  (`glab`, `tea`), map each step to its equivalent command and record the mapping in `RUN.md`;
  the conditions in section 5 do not change. If not, treat as above.
- A repository with no remote: the merge is a local fast-forward or merge of the working branch
  into the base after the same conditions, recorded with the merge commit, and the report says
  no pull request existed to review.
