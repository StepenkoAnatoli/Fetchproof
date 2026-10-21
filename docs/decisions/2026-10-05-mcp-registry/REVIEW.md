# MCP Registry research completion review

Reviewed 2026-10-06, starting from PR #254 at d5fa230. This is phase-1 research,
not package publication, Registry submission or an accepted packaging design.

## Findings and corrections

- The branch's own preflight failed: no unknowns and no fetched ledger. Its pending
  scaffold was accurately labeled but did not satisfy the root nested-project PASS
  invariant. Completed decomposition, the contract, collection and reviewed handoff.
- Initial contract/dimension table edits left blank lines before rows. The parser
  stops at a blank, so drafted questions and added dimensions were detached. A
  read-only reviewer identified this; made both tables contiguous before final gate.
- The initial entrypoint capture did not carry its delegated runtime check or remote
  collector prerequisites. Added pinned runtime and README captures. The second run
  reused the first 19 captures rather than fetching them again.
- Registry metadata, artifact ownership, client installation and catalog admission
  are separate. The reviewed brief does not claim automatic appearance in all clients.
- The license is PolyForm Shield with Required Notice, not MIT. A future runtime
  distribution must preserve the license boundary and exclude third-party captures.
- Private publisher privileges, package identity/availability and actual catalog
  placement remain U-10 with explicit day-one verification. No credentials were read
  or committed; no publisher authentication or publication was performed.

## Observed verification

The nested commands ran in
`C:\Users\PC\.codex\worktrees\mcp-registry-audit\Fetchproof\docs\decisions\2026-10-05-mcp-registry`.

- **verified:** decomposition gathered candidate material and seeded all nine universal
  dimensions. The reviewed map has twelve dimensions, eleven COVERED and one DISMISSED
  with a manual-publication scope and reopening condition.
- **verified:** kit collection completed 19/19 pages, then 2/2 supplementary pages with
  19 cache hits, zero failed captures and no fallback. All 21 are primary-owner pages;
  completeness is recorded as full by the collector, not independently certified.
- **verified:** all 21 findings were rewritten with capture-backed anchors. The final
  project preflight passed: 14 passing findings, zero blockers, seven retained
  corroboration warnings. Nine unknowns are CLOSED and one is KNOWN-UNKNOWN.
- **verified:** handoff exit 0, 21 ledger entries and 21 evidence rows; every cited
  capture exists and the chain verifies.
- **untested:** package installation, end-to-end MCP collection in each target client,
  publisher access, package/Registry publication and actual downstream catalog placement.
  These are later implementation/operator checks, not claimed results of this research.

- **verified:** root preflight PASS, 28 passing findings, zero blockers and its existing
  brief-unstamped warning; root handoff exit 0 with 33 ledger entries/27 rows. Doctor
  reported READY, matching deployed source, no recorded overrides and 493 credits.
- **verified:** independent final source/claim review found no remaining material
  overclaim in its stated scope. Its brief-format correction and conditional proxy
  requirement were applied. The final readiness probe checks the actual reader and
  derived approval, rather than inferring review readiness from preflight alone.
- **verified:** authored-file diff whitespace check passed after trimming the map's
  extra EOF blank. Immutable fetched pages are not whitespace-normalized.
- **untested:** new-head remote CI until its required jobs finish. Runtime tests are not
  newly run locally for this documentation/corpus task; source code is unchanged.

## Mistakes and review limits

**Mistake:** a rejected patch attempted delete/add on the same path, and an inspection
helper used a Windows drive path as an ESM import. **Where:** temporary authoring/inspection
helpers, before final review. **Impact:** patch application or inspection stopped; no
raw capture, ledger, product code or delivered package was altered. **Cause:** tool patch
grammar and ESM URL requirements were misread. **Fix:** updated the existing plan in
place and used a file URL. **Verified:** corrected commands exited 0; inspection read
all 21 rows, and final preflight/handoff passed.

**Mistake:** blank table boundaries and incomplete initial runtime source coverage.
**Where:** DISCOVERY.md/MAP.md authoring and the first collection plan.
**Impact:** rows were not parsed and prerequisites could have been omitted from a later
handoff; no package or publication was delivered. **Cause:** editing the scaffold's
table boundary and treating the entrypoint as sufficient runtime evidence.
**Fix:** contiguous tables plus two supplementary pinned captures and scoped claims.
**Verified:** own-cwd preflight/handoff passed with the completed contract and ledger.

This review establishes the declared research artifact state. It does not prove universal
source correctness, legal compliance of a future package, or automatic catalog admission.
Existing ADR-0116 and ADR-0117 remain in force; the recommendation is not their supersession.

**Mistake:** the first authored handoff did not retain the canonical six-section headings
or recognized draft provenance line. **Where:** initial BRIEF.md.
**Impact:** preflight passed, but the package producer could not classify the brief as
reviewed; no package was delivered. **Cause:** treating freely worded headings as
equivalent to the kit's structural contract. **Fix:** regenerated with the existing brief
command, restored the actual reviewed text into canonical sections and preserved its
generated input stamp. Replaced briefs remain as the command's dated backups.
**Verified:** the readiness probe sees all six sections, ten unknowns, twelve map dimensions,
21 evidence rows and APPROVED_BRIEF with all three review conditions true.
