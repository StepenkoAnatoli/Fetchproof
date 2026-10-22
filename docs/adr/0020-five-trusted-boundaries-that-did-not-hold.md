# ADR-0020 — Five trusted boundaries that did not hold, fixed as one class

- **Date:** 2026-09-15
- **Status:** accepted
- **Area:** the kit's trusted boundaries — the shell, the collector's lock, the
  argument list, platform text handling, and the machine-config default
- **Commits:** `ba5fd1d` (C1), `3cb8a54` (C2), `58eb2b8` (C3), `ddd70b3` (C4),
  `2924cb0` (C5). One commit per fix, each revertible alone.
- **Refines:** [ADR-0002](0002-one-reader-for-the-fail-open-posture.md), whose
  Decision says the posture defaults to fail-open "when the config is missing,
  unreadable, or corrupt. A broken config never blocks work." ADR-0002 is left
  unedited, in its own words, per the convention ADR-0009 set; the supersession is
  recorded here and in the index.

## Context

Five defects were reported against this kit at once. They look unrelated: a remote
code execution, a corrupted ledger, a hanging commit hook, a corpus that fails
integrity on Windows, and a hardened machine that stops being hardened. They were
fixed as five commits because each is separately revertible, and they are recorded
as one ADR because **they are one defect class**, and fixing them one at a time
without naming the class is how the sixth one arrives.

In every case the code was correct *given an assumption about its environment*, and
the assumption was false. Each one is a **trusted boundary** — a place where the kit
hands something to a system it does not control and treats what comes back, or what
that system does in between, as guaranteed:

| # | Boundary | What was assumed | What was true |
|---|---|---|---|
| C1 | the shell | a command string built by concatenation is safe if the pieces look like URLs | a URL and a search query are **attacker-controlled data** in this kit's threat model: `plan.json` travels through git, and a query is pasted back from a web result |
| C2 | the filesystem lock | `exists()` then `write()` is an acquisition if the window is short | the window is the race. Two collectors arriving at once is routine, not exotic |
| C3 | the argument list | argv can carry whatever the working tree contains | argv construction was O(n²) *and* bounded by the OS, and a repo grows |
| C4 | platform text handling | the bytes written are the bytes read back | git's smudge filter rewrites every text file on a default Windows checkout |
| C5 | the config default | a file that cannot be parsed is a file that was never written | a corrupt file is a machine that configured something nobody can now read |

And in every case the failure was **silent or mis-attributed**, which is what turns
a defect into a costly one:

- C1 executed. Nothing reported anything.
- C2 produced a chain broken in the middle, which `repairLedgerTail` no-ops on and
  `rebuildLedger` refuses — the corpus was unrecoverable and the credits were spent
  twice.
- C3 printed nothing for 225 seconds at 30,000 staged paths, which an operator
  cannot distinguish from git being broken.
- C4 reported six captures as *"changed after it was fetched"* and told the operator
  the collector must push `research/raw/` including its dotfiles. The corpus had
  arrived perfectly. The obvious next move — re-collect — spends paid Firecrawl
  credits to reproduce what is already on disk.
- C5 reported nothing anywhere. A machine configured `failOpen: false` started
  allowing commits, and `hard-block` / `strict` / `builder` reverted with it, so the
  box that had been forbidden to collect became the role that may collect and spend.

Three of the five were **pinned by tests that asserted the wrong behaviour**. C5's
`posture defaults to fail-open when the config is missing, empty, or corrupt` said so
in its name; the hook/module agreement table's `corrupt` row passed only by accident
of case ordering; C3's staged-list shape had no argument-count pin at all. A green
suite was not evidence, which is why every fix below carries its own reproduction
re-run against the fix rather than a test count.

## Decision

**Fix the boundary, not the symptom, and make the guarantee belong to the platform
rather than to the module. Where the boundary cannot be made safe, refuse loudly and
name the escape hatch. Where a failure has more than one cause, classify it — never
print one remedy for several.**

Four rules the five fixes share, stated once because they are the reusable part:

1. **The guarantee belongs to the platform.** `spawn` with `shell: false` (C1) and
   `O_EXCL` via `{ flag: 'wx' }` (C2) are syscalls' answers, not judgements the
   module performs and can lose between performing and acting on. A check-then-act
   that the kernel can do atomically is a bug waiting for a scheduler.
2. **A data channel is not an argument channel.** The staged-path list travels on a
   pipe (C3); argv carries six elements regardless of how many paths are staged.
   Anything that grows with the repository does not belong in argv.
3. **Classify, do not guess.** A body hash that does not recompute has two causes
   needing opposite repairs, and folding CRLF back to LF decides between them
   arithmetically (C4). A config that cannot be read has three states, and only one
   of them may default (C5). Naming the wrong cause sends the operator to the wrong
   machine — or to the paid API.
4. **A hardening never moves towards allowing on its own.** Absent means default;
   unreadable means *hold what was known, and failing that, close* (C5). The same
   shape as the hook's watchdog kill from C3: an internal error is named, then
   decided by the posture — never absorbed into a permissive answer.

### The five, and what each now guarantees

- **C1 — no data reaches a shell.** `exec(argv, opts)` in `lib/firecrawl.mjs`
  carries an argv array; `defaultExec` spawns `resolveInvocation(argv)` with
  `shell: false`. `quoteArg` and the `command` string survive as **display-only**.
  The one route that still has an interpreter in it — a Windows `.cmd` shim, which
  Node refuses to spawn shell-less (CVE-2024-27980) — resolves the shim's full path
  and validates every argument against a strict character set, **refusing** rather
  than re-quoting. The cost is named, not hidden: percent-encoded URLs are refused
  on Windows under `firecrawl-cli`, with `--transport http-keyless` as the
  interpreter-free escape hatch. POSIX pays nothing. One test spawns a real stub CLI
  and then asserts the file an injected `$(touch …)` would have created does not
  exist.
- **C2 — one lock, one flag.** `withLock` acquires with `O_EXCL`; `EEXIST` is
  contention, and staleness is judged only *after* it. The window `O_EXCL` leaves
  between create and write is handled by the rule that follows from it: **an
  unidentifiable fresh holder is mid-acquisition, so wait and retry** — only an age
  past `STALE`, or a pid that is identifiably dead, is stale. `seq` and `prev` are
  derived from the ledger *as read under the lock*, and every writer of the chain
  takes it. Reentrant in-process; release removes only the acquisition it made.
- **C3 — a path list is data.** The hook pipes
  `git diff --cached --name-only --diff-filter=ACMR` into
  `gate.mjs --gate commit --staged-stdin`. The library returns `null` for an
  unreadable stdin and `[]` for an empty one, and `--staged-stdin` declared with an
  unreadable stdin is **exit 2**, because "no paths" and "could not read the paths"
  must not both mean *allow*. A watchdog (`timeout`/`gtimeout`,
  `FETCHPROOF_GATE_TIMEOUT`, default 120s) makes a pathological case degrade per
  posture instead of hanging; a kill is a named internal error, never a verdict.
- **C4 — line endings are corpus integrity.** `.gitattributes`
  (`research/raw/* text eol=lf`, `*.jsonl text eol=lf`) ships in this repository
  **and** in `fetchproof/template/`, so a scaffolded project cannot be born
  without it; an attribute outranks a reader's `core.autocrlf`. `isLineEndingRewrite`
  proves a rewrite by folding and re-hashing, so `body-unmodified` carries
  `kind: 'line-endings' | 'modified'`, and `handoffRemedy(report)` picks the remedy
  from the cause — collector, this machine, or both when a report holds both.
- **C5 — the posture is read in three states.** `absent` / `readable` /
  **`unreadable`**. An unreadable config holds the last one that parsed, snapshotted
  beside it whenever a read succeeds, and with nothing to hold fails **closed**;
  `posture()` carries `configState` / `configSource` / `configError`, doctor makes it
  a blocking `CRITICAL` finding, and `--posture` and the hook's `posture_without_kit`
  share one exit vocabulary in which the code carries the **resolved** posture, not
  the state.

## Rejected alternatives

Recorded because each was the obvious fix, and each would have left the boundary
unheld.

**C1 — better quoting.** The reported remedy was to escape the interpolated values
more carefully. Rejected: quoting is a losing game against a shell, because the
shell's job is to *interpret*, and every quoting scheme is a claim about what an
interpreter will do — a claim that has to hold for every shell on every platform,
for values nobody has seen yet. The kit would then be one obscure metacharacter away
from the same defect, with a test suite that could only enumerate the cases it
thought of. Removing the interpreter removes the class. Likewise rejected:
sanitising to an allowlist but still interpolating into a command string, which
keeps the interpreter and the second-guessing. The allowlist is used, but only on
the Windows route where an interpreter is unavoidable — and there it **refuses**
rather than re-quotes, because a refusal the operator can act on beats a
transformation nobody can audit.

**C2 — more staleness heuristics instead of `O_EXCL`.** The tempting fix is to keep
`exists()`-then-write and add conditions: check the pid, check the age, check both,
re-check after writing. Rejected: **the race is in the shape, not in the judgement.**
Every added condition narrows a window that stays open, and each narrowing makes the
remaining race rarer and therefore harder to reproduce — the worst possible direction
for a bug whose symptom is an unrecoverable corpus. This was not hypothetical: the
first `O_EXCL` attempt in this work *still* corrupted the ledger, because
`writeFileSync(…, { flag: 'wx' })` creates an **empty** file and the content lands
later, so a contender read `Number('') === 0`, concluded the lock was stale, and
deleted a live one. `O_EXCL` alone was not the fix either; the fix is `O_EXCL` plus
the rule that an unidentifiable fresh holder is mid-acquisition. A heuristic added on
top of `exists()` would have hidden that too.

**C3 — batching argv, or raising the ceiling.** `xargs`-style chunking was
considered, and rejected: it keeps argv as the channel, so it keeps the OS ceiling as
a live constraint and turns one hang into many partial verdicts that have to be
combined. Raising `ARG_MAX` is not ours to raise and only moves the cliff. `git diff
-z` (NUL-separated, so a newline in a filename is safe) was considered and rejected
*for this commit*: it cannot pass through a shell `$(…)` command substitution, so it
needs a different hook shape, and `splitPathList` already accepts NUL — so the
separator is a free upgrade later rather than a blocker now. A newline in a staged
path is recorded as triaged, not scheduled.

**C4 — renormalise the corpus, or compare loosely.** Writing captures as CRLF on the
collector so both platforms agree was rejected: it makes the ledger's bytes depend on
the platform that wrote them, which is the same coupling in the other direction, and
it invalidates every hash already recorded. Comparing body hashes
line-ending-insensitively was rejected as the *verification* rule, because it would
also accept a genuine edit that only touched line endings — the check would stop
meaning "unmodified". The fold is used **only to classify** a mismatch that has
already happened, never to excuse one. Re-collecting was rejected for the reason the
whole fix exists. And **one blanket remedy text was rejected**: that text is what
sent operators to the collector for a corpus that had already arrived.

**C5 — fail closed on anything unreadable, or tighten every knob.** Failing closed
whenever a config is unreadable *without* the last-known-good snapshot was rejected:
it is correct but punitive, and it makes a machine that never hardened behave as
though it had. Holding the snapshot first is what makes closing safe. Tightening
*every* knob in the no-snapshot fallback — `editGate: 'hard-block'`,
`evidencePolicy: 'strict'` — was rejected because those have no safe restrictive
default: hard-block **denies** instead of asking, and strict fails builds. Inventing
one would trade a silent relaxation for a silent escalation. They also cannot be
lost: a machine can only have set them in a config that parsed at some point, and
every parse snapshots it. Deleting a corrupt config and defaulting was rejected
outright — destroying the operator's file to make a diagnostic go away is the same
class of error as the bug. Finally, changing the finding shape to add a real
`critical` severity was rejected: `{ pass | warn | fail, check, detail }` is a
cross-module contract pinned in `CONTEXT.md`, and `fail` is already doctor's
blocking severity, so the detail leads with the word instead.

## Consequences

**Costs, named rather than hidden.**

- A Windows collector using `firecrawl-cli` cannot pass a percent-encoded URL; the
  refusal names `--transport http-keyless` (C1).
- A lock in the mid-acquisition window is **waited for**, so a collector can now
  briefly block on a lock that is not stale and never will be. That is the correct
  trade: blocking is recoverable, a deleted live lock is not (C2).
- The kit writes one extra file beside the machine config,
  `<config>.last-good`, and reads it when the config cannot be parsed. A machine
  whose home directory is not writable still gets its posture — the snapshot is
  best-effort and a read never fails because a write could not happen (C5).
- A machine with a corrupt config and no snapshot now **blocks commits**. That is
  the point, and the message names the two ways out: repair it, or delete it to take
  the fail-open default deliberately (C5).
- `.gitattributes` is a LAYOUT entry but **not** a gate marker: a project without it
  still gates, it just breaks on a Windows builder (C4).

**What this makes easier.** A sixth boundary defect now has a shape to be recognised
by: name the boundary, ask whether the guarantee can belong to the platform, ask
whether the failure has more than one cause, and ask which direction the failure
moves in. The three tests that pinned wrong behaviour are a standing warning that a
green suite is not the evidence — the reproduction re-run against the fix is.

**What this does not decide.** Lower-severity findings surfaced while fixing these
five are recorded as triaged and not scheduled in
[`docs/architecture-review-2026-09-15-triaged.md`](../architecture-review-2026-09-15-triaged.md),
including the harness's `runPending` not awaiting async tests — which is itself a
boundary defect of the same class, in the one module whose job is to make failures
visible, and is the reason a false green is listed there rather than quietly fixed
inside a commit about something else.
