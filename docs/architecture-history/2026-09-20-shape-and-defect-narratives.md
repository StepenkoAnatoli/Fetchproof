# 2026-09-20 — the narratives that were in the architecture map

Until 2026-09-20 `docs/ARCHITECTURE.md` carried a section called *"Current shape, for the
record"*. It mixed two things: invariants that still hold, and the stories of how they came
to hold — benchmarks, defects, rejected alternatives, and migration chronology.

Both are worth keeping. Only one belongs in a map. The map now states the invariants and
links here; this file keeps the reasoning **verbatim**, exactly as it was written, so
nothing was lost in the move.

Two things are worth knowing before reading it:

- **It contains one error, preserved.** The first bullet says "11 checks in the registry".
  There are **twelve**, and the diagram at the top of the same file said twelve — the
  document contradicted itself, and the restructuring is what surfaced it. The corrected
  count lives in the map. This line is left exactly as written, because a record that is
  quietly edited stops being a record.
- **Several bullets restate an ADR.** Where they do, the ADR is authoritative and is named
  in the text. This is the longer telling, not a second decision.

---


- 11 checks in the registry; the four gate markers; the three overrides (`--no-verify`,
  `GATE_OFF`, repository-local `core.hooksPath`); 9 universal dimensions; recipes ×5;
  LAYOUT 12 entries (kit.json, this file, and `.gitattributes` among them, none gating).
- Two transports behind one seam (ADR-0005): the Firecrawl CLI and the keyless HTTP
  adapter, selected by `lib/transport.mjs` from the operator's choice or a probe.
- **No data reaches a shell** (ADR-0020): the CLI is spawned as an argv array with
  `shell: false`, and the one route that still has an interpreter in it — a Windows
  `.cmd` shim, which Node refuses to spawn shell-less — validates every argument
  against a strict character set and refuses rather than re-quotes. The cost is named,
  not hidden: percent-encoded URLs are refused on Windows under `firecrawl-cli`, with
  `--transport http-keyless` as the interpreter-free escape hatch. POSIX pays nothing.
- **A path list is data, not arguments** (ADR-0020): the commit gate's staged list
  travels on a pipe. Measured on one machine, same git shim — before: 1,000 paths
  0.4s, 3,000 → 2.4s, 10,000 → 24.3s, 30,000 → 225.2s (quadratic, no output);
  after: 30,000 → 0.15s and 100,000 → 0.21s. The structural pin is an argument
  count, not a clock: at 5,000 staged paths the gate received **10,005 arguments
  before and 6 after**.
- **One lock, one flag** (ADR-0020): the collector's exclusive section is acquired with
  `wx` (`O_EXCL`), so exclusivity is the kernel's decision rather than a
  check-then-act the module performs. The ledger's `seq` is derived from the ledger
  as read *under* that lock, and every writer of the chain takes it. Rejected: more
  staleness heuristics on the old `exists()`-then-write, which cannot be made correct
  by adding conditions — the race is in the shape, not in the judgement.
- **A test verdict is earned, not printed** (ADR-0021): `runPending` is async and awaits
  every test, so `ok` is printed only once the test's assertions have actually settled and
  the returned failure count includes async failures. It was synchronous and caught only a
  synchronous throw, so an async test printed `ok` the instant it returned its promise —
  before any assertion inside it had run — its failure arrived later as an unhandled
  rejection, and the runner's own `process.exit(0)` pre-empted even that. Reproduced: a
  fixture holding one failing async test printed `ok`, then `all tests passed`, then
  **exited 0**. Each test is raced against a watchdog (`FETCHPROOF_TEST_TIMEOUT`, default
  60s; the whole suite runs in 9s and the slowest single file in 3.2s, so the bound is ~19x
  the slowest file — chosen by measurement, not by guess), because an awaited test that
  never settles would hang the suite printing nothing, which is the trap the commit gate
  fell into before it got a watchdog. A timed-out test's promise is then swallowed, so its
  late rejection cannot crash the runner over a test already judged and attributed.
  `test/harness.test.mjs` pins all of it in child processes, including the old runner
  beside the new one, so the false green cannot return unnoticed.
- **A posture is read in three states** (ADR-0020): `absent` / `readable` /
  **`unreadable`**. The old reader was `try { parse } catch {}` returning the defaults, which
  collapsed "never configured" and "configured, and the file is now corrupt" into one
  answer - so `{"failOpen": false}` truncated to `{"failOpen": fal` came back as the default
  set and a hardened machine started allowing commits again with nothing in any output
  saying the posture had changed. Every other knob reverted with it: a `hard-block` edit
  gate became `ask`, `strict` became `pluralist`, and a `builder` became a `collector` - the
  role that may collect and spend credits. An unreadable config now holds the last one that
  parsed (snapshotted beside it whenever a read succeeds), and with nothing to hold it fails
  **closed**; doctor makes it a blocking `CRITICAL` finding. This **refines ADR-0002**, whose
  "a broken config never blocks work" is right for a config that was never written and wrong
  for one that was; ADR-0002 is left unedited, in its own words, and ADR-0020 records the
  supersession. Only `failOpen` is tightened in the no-snapshot fallback: the other knobs
  have no safe restrictive default, and they cannot be lost anyway - a machine can only have
  set them in a config that parsed, and every parse snapshots it.
- **Line endings are corpus integrity** (ADR-0020): a body hash is over the LF bytes the
  collector fetched, and git's smudge filter rewrites every text file on a default Windows
  checkout (`core.autocrlf=true`), so the whole corpus failed `body-unmodified` on arrival
  with nothing actually wrong with it. Pinned at both ends: `.gitattributes`
  (`research/raw/* text eol=lf`, `*.jsonl text eol=lf`) ships in the repository *and* in
  `fetchproof/template/`, so a scaffolded project cannot be born without it. And the
  failure is **classified, not guessed** — `isLineEndingRewrite` folds CRLF back and
  re-hashes, which either reproduces the recorded hash or does not; a genuinely tampered
  capture stays `kind: 'modified'` and still gets the push remedy. Rejected: one blanket
  remedy text, which is what sent operators to the collector (and, in practice, to
  re-collect) for a corpus that was already on disk.
- Every module under `lib/` is named in this map, and so is every `bin/` entrypoint:
  the two that were missing until the 2026-09-15 review (`audit.mjs`, `brief.mjs`) and
  the two behind the transport seam (`transport.mjs`, `http-transport.mjs`), added
  after it. `finding.mjs` is the 25th file under `lib/` (23 modules plus the two
  compatibility shims), named from the commit that created it (ADR-0016).
  `archive.mjs` is the 26th — a second module for a second concept, the container
  an audit bundle ships in, on the same reasoning as ADR-0016 (ADR-0019).
- The extractor has its own module (ADR-0016): 460 of the collector's 658 lines were
  a different concept with a different reason to change, so `lib/collect.mjs` is now
  200 lines that read as one URL's journey and `lib/finding.mjs` is 472 lines behind
  a two-argument interface. The count is 472, not the 471 ADR-0016 records for the
  same file: the ADR stays in its own words and the map carries the correction
  (`docs/adr-0016-verification-2026-09-15.md`, 2026-09-15).
- Two machine roles (`collector` default, `builder` — ADR-0010), one handoff check with
  four named failures (ADR-0011), and one rule that follows from the split: a
  builder-role machine does not collect, and its collection CLIs refuse before they reach
  an adapter.
- Recovery after an interruption is read from repository state, never inferred:
  `doctor` and preflight answer *where this project is* from disk alone, so a dead
  session costs context and not position, and the last commit report plus this map say
  what was happening. The instructions are prose in `AGENTS.md` and the scaffold
  template (CONTEXT term **resume**); enforcement was rejected on purpose — a check
  that judged whether an agent oriented properly would be wrong (ADR-0013).
- *Where* an agent stands is protocol, not a flag: the project is the current working
  directory, and a cwd that is not the project the operator meant is a question, never
  a filesystem search, an inference from a name, or a remote lookup. Prose in
  `AGENTS.md` and the template (CONTEXT term **wrong project**), inherited by every
  scaffolded project, unenforced for the same reason as **resume** — a gate cannot
  judge whether an agent guessed or was told (ADR-0017). There is no `--project`: the
  gate resolves one root from where it stands, and a second root is a second thing to
  be wrong about.
- Two files face two readers, and both ship: `AGENTS.md` binds the agent (and now
  tells it to ask rather than search when the cwd is not the project — ADR-0017),
  `START_HERE.md` answers the operator, from `template/`, so a project the kit has
  never seen still tells the person standing in it where his files are (ADR-0018).
- Enforcement surfaces stay at two: the git commit gate and the project-level
  edit-time hook. In hosted and cloud sessions neither runs — what binds there is
  the protocol as text (ADR-0006 covers that gap).
- The kit names no runtime (ADR-0012): one anchored, overridable statement of where a
  runtime keeps its settings file and its skill roots (`RUNTIME_ANCHORS`, read through
  `runtimePaths()` / `skillLocations()`), capability names for everything the kit owns
  (`editGate`, `--edit-only`, `hooks/edit-gate.mjs`), and retired names kept only so a
  rename can be recognised and repaired — or, where the kit cannot reach it (an export),
  reported by doctor while it persists.
- One attachment, not ten pasted files: `zipAudit` bundles a topic's latest audits
  into `research/audits/<slug>-v<version>-<date>.zip`, read from the manifest's
  `latest` pointers. The container is written here (`lib/archive.mjs`) because the
  kit has no dependencies and cannot assume a `zip` binary; the refusal shape is
  A11's — name the options, do not guess (ADR-0019).
