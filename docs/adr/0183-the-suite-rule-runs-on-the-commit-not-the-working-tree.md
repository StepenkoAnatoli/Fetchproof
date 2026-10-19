# ADR-0183 - The suite rule runs on the commit, not the working tree

- **Date:** 2026-10-19
- **Status:** accepted; amended 2026-10-19 by the review of PR #430 (a sparse checkout's
  skip-worktree entries stay skipped in the scratch, LFS pointers are not smudged there, and the
  block quotes git's `fatal:` or `error:` line, not its first)
- **Area:** `research-kit/lib/gate.mjs` (`runSuiteOnCommit`, `suiteBreach`)
- **Supersedes in part:** ADR-0120, which ran "the checkout's `bin/selftest.mjs`": the runner is
  now the commit's own, run in a scratch repository built from the index being committed. The
  rest of ADR-0120 and ADR-0142 (scope, result file, budget, overrides) stands.
- **Fires:** ADR-0024's deferred trigger. Its rejected "materialise the whole index" said: "If a
  future check needs a path outside `research/`, this scope widens with it." ADR-0120 was that
  check, and the scope did not widen.
- **Freeze (ADR-0117):** a bug fix. The check judged the wrong bytes; no command, flag, config
  key or check is added.

## Context

ADR-0024 decided that the commit gate judges the index - the bytes that become the commit -
and every other caller judges the working tree. `materializeIndex` reproduces the index's
`research/` in a scratch directory, and the corpus verdict runs over that.

ADR-0120 added the suite rule on 2026-10-01: in the kit's own checkout, a commit staging a path
under `research-kit/` needs a green suite. `runSuiteHere(root)` spawned
`<root>/research-kit/bin/selftest.mjs` with `root` as its cwd. That is the working tree: the
runner, the tests and the library they load all came from disk, not from the index.

Reproduced on 2026-10-19 with the shipped `suiteBreach`, on a repository holding the kit's four
markers and a stand-in runner whose colour is in its own bytes:

- **False block.** Staged: a green runner. Unstaged: a red edit to it. The gate blocked: "the
  suite is red: 1 failed". An unstaged work-in-progress test, a half-made edit or a README count
  bumped ahead blocks a green commit, and on the operator's PC each run costs 25-40 minutes.
- **False pass.** Staged: a red runner. Fixed on disk only. The gate allowed it, and the commit
  carried the red file. A partial commit (`git commit <paths>`, `git commit -a`), whose index is
  a temporary `GIT_INDEX_FILE`, was judged by the working tree as well.

The issue sweep that found this worked around it by committing kit changes only with the working
tree equal to the index - a rule kept in a script, which is where ADR-0120 said such rules fail.

## Decision

The suite runs in a scratch repository built from the index being committed
(`runSuiteOnCommit`, the default run of `suiteBreach`):

1. In the hook's environment - so a partial commit's temporary `GIT_INDEX_FILE` is the index
   read - `git ls-files --stage -z` lists the index's entries, `git rev-parse --git-path objects`
   names the object store, `--show-object-format` its format, and
   `git rev-parse --verify -q HEAD^{commit}` the parent (none on a first commit). An entry added
   with `git add -N` (intent-to-add) is listed by `ls-files` as the empty blob and left out of
   the commit, so the paths the commit holds are read with `git diff-index --cached
   --ita-invisible-in-index` against the empty tree, and only those entries are kept. The index
   is only read. An index with unmerged entries blocks: `git commit` refuses one before its hook
   runs, and `checkout-index` would skip the conflicted paths without an error.
2. Under `tempBase()`, in a folder named `research-kit-commit-` and six characters, addressed by
   its long name (Windows hands a temp folder over as an 8.3 short name - `RUNNER~1` on CI - and
   git reports the long one, so repo-hygiene's tests would not know their repository and would
   return early), with the repository-location variables stripped (`GIT_DIR`, `GIT_INDEX_FILE`
   and kin, the list ADR-0120 strips from the suite): `git init` without templates and in the
   commit's object format (the machine's default may differ, and a sha256 scratch refuses a sha1
   index); the real object store, as an absolute path, in `objects/info/alternates`;
   `git update-index -z --index-info` with the entries; `git checkout-index --all --force -u`
   with `core.longpaths`; and `git update-ref HEAD <parent>` when there is one. Amended
   2026-10-19 (review of PR #430): the entries `git ls-files -t` tags `S` (skip-worktree, a
   sparse checkout's) are marked so in the scratch with `update-index --skip-worktree` before the
   checkout, which skips them - `--index-info` drops the bit, and the checkout had asked for
   every blob outside the cone, which a partial clone never fetched, so every kit commit there
   blocked. The build runs with `GIT_LFS_SKIP_SMUDGE=1`: git-lfs's smudge filter, which the
   machine's config runs at checkout, had gone to the network from the commit hook for an
   object the clone did not hold, and then blocked. The suite's own environment is unchanged.
3. The runner is the scratch's `research-kit/bin/selftest.mjs`, with the scratch - or the
   project's place in it, for a project below the top level (#309) - as its cwd. The result-file
   contract, the stripped environment and the budget are ADR-0120's and ADR-0142's.
4. After the run the index is listed again. A plain `git commit` holds no lock on the index
   while its hook runs and commits what the index holds when the hook returns, so a `git add`
   during the run would reach the commit untested: a changed index blocks, green or not.
5. The scratch is removed afterwards. A gate killed mid-run (Ctrl-C, the hook's watchdog) never
   reaches that step, so each run first removes the folders of step 2's name that hold a `.git`
   and are more than a day old - its own leftovers, never a scratch a gate in another checkout
   is still using.

The scratch is a repository of its own, at the real HEAD, holding the commit: its
`git rev-parse --show-toplevel` is itself, so repo-hygiene's tests run instead of returning early,
and its `git status` shows what the commit stages and nothing else.

A scratch that cannot be built is a block that names the failed step and git's own line of
error - its first `fatal:` line, else its first `error:` line, else its first line (amended
2026-10-19: a filter's progress line, `Downloading assets.bin (2.0 KB)`, came first and was
quoted as git's words) - as an index the gate cannot read blocks (ADR-0024). It never falls
back to the working tree: that fallback is the defect. Where the project has no `.git` there is
no index, and the files there are judged, as before: a fixture or a copy. The one hook that
meets this is a repository whose `.git` lives elsewhere (`--git-dir`, `core.worktree`), where
the suite still runs in place; the kit's checkouts do not use that layout.

Measured on 2026-10-19 on this repository's tree (1743 tracked files, Windows 11): the scratch
built in 9.3 to 10.8 s over three runs and was removed in under a second. The full suite, run in
such a scratch on this change before review: 2052 passed, 0 failed, 16 unsupported, in 1653 s -
inside the 1409 to 1825 s measured in the working tree (ADR-0142). Built under a 110-character
temp root without `core.longpaths`, 98 captures failed with "Filename too long" (the longest
tracked path is 172 characters) - so the scratch sits directly under `tempBase()`, sets
`core.longpaths`, and a checkout that fails blocks.

## Alternatives rejected

- **Materialise `research-kit/` only, as `materializeIndex` does `research/`.** The tests read
  outside it (the README count, the docs, the ADR index), and without a `.git` repo-hygiene's
  tests return early - a silent green.
- **A plain `checkout-index` copy, no repository.** The same silent skip.
- **`git write-tree`, then `read-tree` in the scratch.** One step shorter, and it leaves
  intent-to-add entries out by itself, but `write-tree` may write the cache-tree back
  into the index being committed: the gate would modify the commit's index to form an opinion
  of it. `ls-files` only reads.
- **`git stash --keep-index`, or any other step through the working tree.** It mutates the
  operator's files; ADR-0024 rejected it outright.
- **Refuse, or warn, when the index and the working tree differ.** ADR-0024 rejected both: the
  divergence is a normal workflow, and a gate that forbids it is removed.
- **Pass `GIT_INDEX_FILE` through to the suite.** The suite builds scratch repositories of its
  own, and every one of their `git add`s would act on the commit's index (ADR-0120).
- **`git worktree add --detach`.** It writes the real repository's administrative files from a
  hook, leaves them behind when interrupted, and checks out HEAD, not the index, so the index
  would still have to be read in.
- **Fall back to the working tree when the scratch cannot be built.** A gate that answers a
  question it could not ask is the defect this decision removes.
- **Remove a leftover scratch on a signal.** `spawnSync` blocks the gate's event loop for the
  whole run, so no handler runs while the suite does, and the watchdog's kill cannot be caught.

## Consequences

- A commit owing the suite pays for the scratch (about 10 s on this tree) before the run. The
  build is not counted in the suite's budget; it fits in the rest of the gate's allowance
  (`GATE_REST_S`, 120 s, ADR-0142).
- Untracked files no longer reach the suite. A test that passed only because of a file nobody
  committed now fails at the commit, as it would on CI.
- Staging while a commit's suite runs blocks that commit; commit again.
- A run stopped at its budget can leave its scratch when a child still holds a file (Windows),
  as a stopped runner already leaves its own (ADR-0142), and a killed gate leaves all of it -
  a copy of the checkout. The next run removes either after a day.
- An intent-to-add path is not in the tested tree, as it is not in the commit. `git status` and
  `diff-files` were not used to find one: they report it as added, or as a rename or a deletion
  once its file is gone, and `diff-index` without `--ita-invisible-in-index` lists it as held.
- The corpus verdict is unchanged: `materializeIndex` still reproduces `research/` only. The
  whole-index scratch is built only when the suite is owed.
- The edit gate, and `bin/selftest.mjs` run by hand, still judge the working tree - ADR-0024's
  "every other caller".
- In a sparse checkout the files outside the cone are not in the scratch, as they are not in the
  working tree, and its `git status` does not list them; an LFS-tracked file is its pointer there
  (amended 2026-10-19), as in a clone made with `GIT_LFS_SKIP_SMUDGE=1`. A test that reads a
  file outside the cone, or an LFS file's content, fails at the commit as it would in that clone.
- The hook runs the deployed kit's gate (ADR-0120): until `~/.agents/research-kit` carries this
  `lib/gate.mjs`, the deployed gate still runs the working tree, and kit changes are committed
  with the working tree equal to the index.
