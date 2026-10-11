# Brief - what the runtime does: Node's certificate store, and the mode a copied file gets

_Auto-drafted 2026-10-07 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require the reviewing agent's judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent (the 2026-10-07 break-test pass 7, which rewrote the findings and answered the **TODO** sections)

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** The configured research checks passed. Disclosed known unknowns
and gate warnings still apply; PASS does not establish that every claim is correct.

**Gate warnings from this evaluation: 9.**

These findings apply to the whole corpus at the time of this evaluation. Re-run
preflight after edits; this list is not a fresh evaluation of the resulting document.

- **transport-provenance/transport-not-metered** (E-01): E-01 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-02): E-02 was collected by "http-keyless", not the metered Firecrawl CLI
- **transport-provenance/transport-not-metered** (E-03): E-03 was collected by "http-keyless", not the metered Firecrawl CLI
- **capture-completeness/partial-only** (U-01): U-01 rests solely on partial captures (omitted: 2 sibling section(s) totalling ~49 words were outside the page's main content and are not in this capture; 2 sibling section(s) totalling ~49 words were outside the page's main content and are not in this capture)
- **capture-completeness/partial-only** (U-02): U-02 rests solely on partial captures (omitted: 2 sibling section(s) totalling ~49 words were outside the page's main content and are not in this capture; 2 sibling section(s) totalling ~49 words were outside the page's main content and are not in this capture)
- **capture-completeness/partial-only** (U-03): U-03 rests solely on partial captures (omitted: 2 sibling section(s) totalling ~49 words were outside the page's main content and are not in this capture)
- **corroboration/one-voice** (U-01): U-01 cites 2 rows and all are github.com - a second reading of one source, which catches a misreading and not a source that is wrong about itself
- **corroboration/one-voice** (U-02): U-02 cites 2 rows and all are github.com - a second reading of one source, which catches a misreading and not a source that is wrong about itself
- **corroboration/single-source** (U-03): U-03 rests on E-03 alone - one reading, so a correct source and a lucky one look the same

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

The external facts the 2026-10-07 break-test of this repository (pass 7) rests on, closed from the
runtime owner's own documentation instead of recalled. Two claims needed them: the cause of the
finding that a deploy from a read-only source tree leaves a deployed kit that cannot be updated
(the mode a copied file gets, and what the copy does to an existing destination), and the
recommendation that the collector name a documented remedy when a TLS-inspecting middlebox
rejects the machine's trust store (`NODE_EXTRA_CA_CERTS`, when it is read). Done means: one `E-##`
row per page whose `Raw` capture holds the quoted sentence, both claims in the report name their
row, and `preflight.mjs` says PASS. The kit's own behaviour - the deploy, the collector's failure
message - is observed by running it and is deliberately not researched here (break-test rule 6).

## What we verified

| Claim | Source | Type |
|---|---|---|
| Node's `fsPromises.copyFile` section, at the tag of the runtime in use: a copy overwrites an existing destination unless `COPYFILE_EXCL` is set - the documented default that makes the second deploy try to open its own read-only output for writing, which is where the `EACCES` comes from. The section documents the `mode` argument, the three `COPYFILE_*` modifiers and the overwrite default, and says nothing about what permissions the destination receives: the 0444-to-0444 propagation measured on this host is therefore not a documented guarantee, and the fix sets the mode explicitly instead of relying on it. [quote: Asynchronously copies `src` to `dest`. By default, `dest` is overwritten if it already exists.] [quote: The copy operation will fail if `dest` already exists.] _(partial capture)_ | E-01 `github.com` (U-01, U-02) | P |
| libuv, the layer that actually performs the copy: `uv_fs_copyfile` overwrites an existing destination by default, and `UV_FS_COPYFILE_EXCL` is the flag that turns that into `UV_EEXIST`. Like Node's page above, the whole captured page names the flags, the copy-on-write variants and the partial-copy warning, and names no permission behaviour for the destination - so nothing in the copy layer promises that a read-only source produces a read-only destination, and nothing promises it will not. [quote: The default behavior is to overwrite the destination if it exists.] [quote: `UV_FS_COPYFILE_EXCL`: If present, `uv_fs_copyfile()` will fail with `UV_EEXIST` if the destination path already exists.] _(partial capture)_ | E-02 `github.com` (U-01, U-02) | P |
| The man page's `NODE_EXTRA_CA_CERTS` section, at the tag of the runtime in use: the variable extends the well-known root CAs with the certificates in a PEM file; a missing or malformed file is emitted once as a `process.emitWarning()` and is otherwise ignored; and the value is read only when the process is first launched, so setting it inside a running process has no effect. That makes naming it as the remedy when the default store rejects an intercepting proxy's certificate a documented measure - and bounds it to "set it before the collector starts". [quote: The file should consist of one or more trusted certificates in PEM format.] [quote: is missing or misformatted, a message will be emitted once using] [quote: environment variable is only read when the Node.js process is first launched.] _(partial capture)_ | E-03 `github.com` (U-03) | P |

## Contradictions and how they were resolved

None found, and none expected: the two readings agree with each other and neither contradicts
the measurement. Node's `fs.md` and libuv's `fs.rst` state the same overwrite default and the
same meaning for `COPYFILE_EXCL` / `UV_FS_COPYFILE_EXCL`, and both are silent about the
permissions the destination receives - which is exactly the gap the local measurement fills
(0444 to 0444, 644 to 644, 600 to 600 under umask 0022).

Independent corroboration was NOT obtained, and the warnings say so: all three rows are the
same owner's repository at the same tag. A fourth attempt to capture the copy path itself
(`deps/uv/src/unix/fs.c` at v22.22.0, 58.4 KB) came back truncated by GitHub's viewer with the
`uv__fs_copyfile` function outside the capture, so it was not added as a row. The absence of a
permissions promise is therefore a consistent silence across the documented surface, not two
sources agreeing; the report treats it that way, and the fix does not depend on it.

## Known unknowns

None. No unknown is declared KNOWN-UNKNOWN.

## Decision

Nothing is built from this project; it exists so the break-test report can cite its claims
instead of recalling them. In scope: the three evidence rows, their quotes, and the map and
discovery that point at them. Out of scope, deliberately: the kit's own deploy and collector
behaviour (observed by running it, per break-test rule 6), the search lane this machine cannot
reach, and any change to the repository - the operator asked for a report-only run, so neither
the fix nor this corpus is committed.

The first step for anyone continuing this work: if a future pass needs the copy path's own
evidence, fetch it where the viewer does not truncate (a machine with egress to nodejs.org or
raw.githubusercontent.com), rather than re-reading these three pages.

## Next steps

1. Review the **TODO** sections above (Contradictions, Decision) before handing off.
2. Hand this file to the builder (phase 2). Re-running `node "/home/user/.agents/research-kit/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- research-kit:brief-draft body=eb00b74b3d5cf916 inputs=8ff52a337685139a gate=pass -->
