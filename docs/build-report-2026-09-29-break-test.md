# Build report — break-test, 2026-09-29

> **How these fixes landed.** This is the Arena agent's report from its branch (PR #154).
> The same six defects were fixed on `main` through **PR #155**, which redid them one commit
> each while that branch could not be pushed. #155 differs from what is described below in
> four places:
> - **Test names** differ.
> - **Fix 4** (`install --dry-run`) lists what the real deploy would prune: the retired files
>   that exist *and* the mirror's stale extras, checked against a real deploy.
> - **Fix 5** also validates `--search-transport`.
> - **Fix 3** registers SIGINT, SIGTERM and SIGHUP only (no `SIGBREAK`), and its test returns
>   early on Windows instead of raising the event in the child.
>
> The findings, probes and risks below stand as written.

An adversarial pass over the whole build, looking for realistic ways it fails and then
applying only the fixes that leave the suite green. It follows
[the hardening pass](build-report-2026-09-17-hardening.md), which found eleven defects in
the *previous* implementation, and the string of break-tests recorded in the ADRs since
(PR #140, Arena break tests 6–12). This one starts where they stopped.

**How the build is run.** One command, offline, no key and no network:

```
node fetchproof/bin/selftest.mjs
```

CI adds `preflight`, the release-evidence examples, the Node/Python cross-language
conformance pair, the regeneration of the corpus's derived files and the
"the suite left the working tree clean" step — all of which were run locally too, and all
of which pass. Baseline before this pass: **1282 passed, 0 failed in 44.3s**.

---

## What was probed, and what held

The suite is unusually hard to break, and most of the credit for that belongs to the
previous passes. These were all reproduced and all **passed**:

| Probe | Result |
|---|---|
| Two suites running at once | 1282 × 2, both green |
| 6 competing CPU burners on 2 cores | 1282 green in 142s, no timeout |
| `TMPDIR` relative, with spaces, a file, read-only, non-existent | green |
| `TMPDIR` a 1 MiB tmpfs (real ENOSPC) | 607 passed / 675 failed, every failure named with one cause and the free space on the volume |
| `HOME` unset, empty, hostile | green |
| No git identity at all (`HOME` empty) | green |
| A shallow clone (`--depth 1`, as `actions/checkout` makes) | green |
| A checkout whose path holds a space and non-ASCII characters | green |
| `core.autocrlf` forced, dirty working tree, untracked files | green |
| Fake `SERPAPI_API_KEY` / `FIRECRAWL_API_KEY` in the environment | green |
| Bogus `HTTP_PROXY`/`HTTPS_PROXY` for every request | green |
| `ulimit -n 64`, `umask 077`, `TZ=Pacific/Kiritimati` | green |
| Heap capped at 96 MB | green, result file still written |
| 8 CLIs × 6 concurrent rounds over one project | no crash, no corrupted file |
| 21 hostile corpus states (ledger truncated/BOM/not-JSON/20k lines, `research/raw` a symlink to `/etc`, a capture that is a directory, CRLF evidence, a `Raw` cell pointing outside the project, non-UTF-8 brief, deleted contract files) | every one refused by name; nothing read from outside the project |
| 36 hostile argv spellings × 28 CLIs | no raw stack trace, no unexpected exit code |
| 20 hostile `plan.json` shapes through `decompose --dry-run` | green |
| 11 hostile `gate --staged-stdin` payloads, 18 hostile MCP JSON-RPC lines | green |
| Artifact create/validate with a 12 MB capture, NUL bytes, a 180-character filename | refused by name (`ZIP-RATIO-LIMIT`, `CAPTURE-HASH-MISMATCH`) |
| `check-action-pins.mjs` with no network | `UNCHECKED`, exit 1 — fails closed, as designed |

Invariant fuzzing of the pure layer also found nothing else: `urlKey` idempotence,
`canonicalJson` round-trip and stability at 20 000 levels of nesting plus the cyclic
refusal, `parseFlags`, `parseJson` with a BOM, `writeText`'s atomic rewrite (a failed write
leaves the old file and no scratch), `sha256File` refusing a fifo without opening it,
`tableRow`/`splitRow`/`parseTable` round trips, `alignToHeader`/`headerOf` on a reordered
header, `anchorFound`, `similarity` bounds and self-similarity, and the ledger: **every
single-byte edit and every reordered or duplicated line was caught**.

---

## Discovered failures, and what was done

### 1. A null row in the Firecrawl CLI's output threw and took every valid result with it

**Repro**

```
node -e 'import("./fetchproof/lib/firecrawl.mjs").then(m =>
  m.normalizeSearch(String.raw`{"data":{"web":[{"url":"https://a.invalid"},null]}}`))'
TypeError: Cannot read properties of null (reading 'url')
```

`normalizeMap` has the same hole: `link.url` on a null entry.

**Root cause.** `rows.map((row) => row.url …)` and `links.map((l) => (typeof l === 'string' ? l : l.url))`
read a property of an entry the kit never checked. The CLI's stdout is a binary the kit does
not own, over a protocol the vendor can change without telling this repository — the same
untrusted-input class the kit already defends everywhere else.

**Severity: High.** The precedent is the interesting part: `serpapi.normalizeSearch` was
hardened against exactly this on 2026-09-28 ("one null row threw and took every valid
result with it, Arena break test 9"), and the parser for the *other* provider — the one that
carries the identical shape — had not been. A single malformed row in one search result took
the whole search with it, and the collector reports a failed search rather than a crash.

**Fix.** Drop a malformed row instead of mapping through it, and read `link?.url`.
**Tests:** `transport > a malformed row in the CLI output is dropped, not thrown`.
**Status: applied.** Suite green.

### 2. The edit gate crashed on a payload whose shape was not the documented one

**Repro**

```
echo '{"cwd": 42, "tool_name": "Edit"}' | node fetchproof/hooks/edit-gate.mjs
TypeError [ERR_INVALID_ARG_TYPE]: The "paths[0]" argument must be of type string...
exit 1, raw stack trace
```

Also `echo 'null' | node fetchproof/hooks/edit-gate.mjs` — `payload.cwd` and then
`payload.tool_input` both threw on the literal null.

**Root cause.** The payload is the *runtime's*, so its shape is not the kit's to guarantee,
yet `payload.cwd` went straight into `path.resolve` and `payload.tool_input` was read
without a guard. The file's own comment says the opposite is required: "A payload shape that
changes upstream must not block the operator's work."

**Severity: High.** The safety outcome is still fail-open, but a hook that prints a stack
trace on every Edit is a hook the operator learns to ignore — and it is the *edit-time* gate,
the one that stands between an agent and `src/`.

**Fix.** A payload that is not an object reads as no payload at all, and only a string is a
path. Both guards, one line each, at the point of the read.
**Tests:** `gate > the edit gate survives a payload whose shape is not the documented one`
(11 hostile payloads, plus the assertion that a documented payload is still judged).
**Status: applied.** Suite green.

### 3. An interrupted run left its scratch behind

**Repro**

```
node fetchproof/bin/selftest.mjs &     # Ctrl-C after ~10s
110 scratch directories left in /tmp; 58 MB after an afternoon of interrupted runs
```

**Root cause.** The cleanup is registered on `process.on('exit')`, which does not run when
the process is *killed*. So the interrupted run was precisely the one that leaked — the exact
defect the 2026-09-28 fix addressed, one layer short. Where `/tmp` is tmpfs the growth is
RAM.

**Severity: Medium.** Registering a signal listener takes the signal away from Node's
default disposition, so the handler must do what the default did as well.

**Fix.** Clean up on `SIGINT`/`SIGTERM`/`SIGHUP` and exit with 128+signal, so the exit code
a caller sees is unchanged (130 for Ctrl-C, verified). `SIGBREAK` is registered too, which
is Windows' catchable console signal — see the rejected fix below for why the *test* cannot
send it there.
**Tests:** `harness > an interrupted run takes its scratch too`.
**Status: applied.** Suite green on Linux, and on all three CI platforms.

### 4. `install --dry-run` reported prunes that were not there

**Repro**

```
HOME=/tmp/fresh-home node fetchproof/bin/install.mjs --dry-run
would prune: hooks/claude-pretooluse.mjs, hooks/claude-gate.mjs, lib/cli.mjs
```

on a machine where no kit has ever been installed. The real deploy prunes only what exists.

**Root cause.** `deploy({ dryRun: true })` returned the whole `RETIRED_KIT_FILES` list;
`copyTree` skips entries that are not on disk. The dry run and the run disagreed.

**Severity: Low** (cosmetic, but a dry run is the answer an operator trusts *instead of*
running it).

**Fix.** Filter the list to what exists at the destination.
**Tests:** `doctor > a dry run prunes only what is actually there`.
**Status: applied.** Suite green.

### 5. `collect-remote --max-pages abc` dispatched a paid run that then failed

**Repro**

```
node fetchproof/bin/collect-remote.mjs --repository o/r --topic t --max-pages 8o
# reaches collect.yml as a string; the workflow's own guard refuses it there,
# after the dispatch, as a failed run rather than as an answer
```

**Root cause.** Every other caller typo is refused locally — `--url`, `--out`, `--repository`,
`--topic`, unknown flags — but the one flag that bounds how many credits a run spends was
passed through as a string, and `--depth`/`--runner` were left for GitHub to answer with a
422 that names nothing useful.

**Severity: Medium.** No money is lost (the runner's guard holds), but the operator gets a
red workflow instead of a sentence.

**Fix.** `checkFlagValues` gained a `max` bound, and `collect-remote` now validates
`--max-pages` (1..25, the workflow's own ceiling), `--depth`, `--runner` and `--timeout`
before anything else is asked of them.
**Tests:** `cli > collect-remote refuses a bad --max-pages before it dispatches a paid run`.
**Status: applied.** Suite green.

### 6. `makeSlug` could exceed its own limit

**Repro**

```
makeSlug('', 'fallback', 5)  ->  "fallback"   (8 characters, over the cap)
```

**Root cause.** `slug || fallback` returned the fallback whole, whatever the limit was —
found by fuzzing the documented contract ("a filename-safe slug, **capped**").

**Severity: Low, latent.** No caller in the kit passes a limit shorter than its fallback
today; the invariant was what was broken.

**Fix.** Cap the fallback too.
**Tests:** `audit > makeSlug caps the fallback too`.
**Status: applied.** Suite green.

---

## Rejected fixes

None of the six was reverted: every fix kept the suite green on the first full run after it
was applied. Three changes were considered and *not* made:

- **The ENOSPC cascade.** Under a full temp volume, 12 of 675 failures are not ENOSPC
  (`git init -q` failing because the scratch folder could not be created, a row reading as
  unparsed). They are consequences of the same cause, correctly summarised by the dominant
  cause line; papering over them would hide the one cause.
- **`check-action-pins.mjs` exiting 1 without network.** That is the designed fail-closed
  behaviour, not a defect.
- **Sending `SIGBREAK` from the test on Windows.** The first cut of the interrupted-run
  test reasoned that a console Ctrl-Break reaches a `SIGBREAK` listener on Windows, so a
  programmatic `kill('SIGBREAK')` must too. It does not. CI run 36615465192 went red on
  `windows-latest` with `1288 passed, 1 failed`, and the failure was this test with the
  scratch still behind: on that platform `kill` of *any* name is `TerminateProcess`, and no
  handler runs. Reverted, and replaced by the split described below — POSIX sends a real
  `SIGINT`, Windows has the child raise the event the handler is registered for. The
  product fix was never wrong; only the test's claim about what it could prove was.

---

## Remaining prioritised risks

1. **The signed-in disclosure surface is real and unfixable here** (ADR-0035). On a public
   repository, anyone with a GitHub account reads every dispatch input in the job log. The
   topic and the prior are not secrets, but they are not private either. Fixing it means
   routing the inputs around the very `env:` rule that keeps them out of a shell.
2. **Single-site corroboration.** `docs/measurement-2026-09-28.md` measures it: the root
   corpus closes unknowns on one site 90.9% of the time, and three decision corpora at 0%.
   The kit warns; it does not refuse.
3. **A vendor response shape change is still a live hazard.** Two parsers are now hardened;
   `serpapi.normalizeAccount`, the browser transport's extraction and the keyless adapters
   carry the same untrusted-input assumption and were fuzzed without a finding, but the
   class does not close by inspection.
4. **`SIGKILL` cannot be caught**, so a `kill -9`'d run still leaks its scratch — and on
   Windows a *programmatic* signal of any name behaves the same way, because `kill` there is
   `TerminateProcess`. Only a real console Ctrl-C/Ctrl-Break reaches a handler on that
   platform. Bounded by the machine's tmp reaper.
5. **A tight `RLIMIT_AS` kills the runner before it reports** — Node's own undici/llhttp
   wasm allocation fails first. The result file is absent, which CI names correctly ("the
   runner produced no result file"), but it is a raw stack rather than a diagnosis.
6. **The Windows leg of CI was only fully exercised by this pass's own failure.** Before it,
   no local run had ever been made on Windows, and the leg had never been observed green or
   red for a change of this kind. It is green now (run 36617124678: `1289 passed, 0 failed`
   in 131.3s, and steps 11–16 pass), but the lesson is that a platform nobody runs is a
   platform nobody has tested.
7. **The corpus's own labelling.** Three corpora mark every row `S`, including pages that
   are primary for the question asked. The closure check does not catch it.

---

## Hardening recommendations

- **Keep the "one parser, one precedent" rule explicit.** The Firecrawl defect existed only
  because the SerpAPI fix had no sibling. A test that feeds the same hostile row shape to
  *every* vendor parser would have found it on the day the first fix landed.
- **Fuzz the payload boundary, not just the corpus boundary.** The edit gate took 28 days to
  be fed a payload it could not parse. The MCP loop and `gate --staged-stdin` have the same
  surface and are already covered; the hook was not.
- **Treat a signal as an exit.** Anything registered on `'exit'` should be registered on
  the terminating signals too, or the leak returns the moment somebody presses Ctrl-C.
- **Add `max` to the shared flag validator** rather than range-checking inline — done here,
  and worth keeping as the pattern for any future bounded flag.
- **A dry run should describe the run that would happen.** Any `--dry-run` path that
  reports a list is worth diffing against the real path's list.
- **Run the platform you claim to support, at least once per change class.** The Windows leg
  of CI existed and was green before this pass, but no local run had ever been made on
  Windows, so a test that was wrong *only* on Windows passed everywhere it was written and
  only CI caught it. Where a test cannot be made honest on a platform — `kill` there is
  `TerminateProcess` — say so in the test, and assert the part that is still true.

---

## Summary

Six defects found and fixed, none rejected, no test ever left red: the suite is green at
**1289 passed, 0 failed** (from 1282; the six new tests each pin one fix), and the whole
CI sequence — selftest, preflight, release examples, Node/Python conformance, derived-file
regeneration, clean tree — passes on all three platforms in the matrix (run
36617124678: ubuntu-latest, ubuntu-26.04 and windows-latest all SUCCESS).

The build's resilience after this pass is high where it matters most and unchanged where it
is structurally limited: every realistic way to break the *suite* has been probed and holds,
including the ones that used to work. What remains open is not fragility in the build but
honesty in the product's claims — corroboration, and what a signed-in reader can see.

cwd: the repository root. Offline — no key, no credits, no network.
