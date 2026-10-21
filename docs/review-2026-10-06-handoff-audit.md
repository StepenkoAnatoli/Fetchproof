# Pre-merge audit: truthful handoffs and retained cautions

Date: 2026-10-06. Scope: the handoff changes in local commit `8a17628` and the follow-up
fixes in `241c02e`. The retained [reliability research](decisions/2026-10-05-agent-reliability/research/BRIEF.md)
provides the scope and limitations; this review does not establish downstream error reduction.

## Findings and dispositions

| Finding | Reproduction | Correction | Verification |
|---|---|---|---|
| P2: failed or unevaluated closures looked verified | A CLOSED unknown cited missing E-99, or its raw capture was absent. Real preflight failed, but the verified section printed the claim without qualification. Drafting without a verdict did the same. | The section labels these as declared CLOSED claims and says verification has not succeeded or has not been evaluated. Claims and citations remain visible for review. | verified: both failed fixtures and the unevaluated case failed regression assertions before the fix and passed afterward; an independent reviewer repeated the cases. |
| P2: returning warnings left the default bundle on an intervening observation | Over a 30-day-old corpus, maxAgeDays 1 -> 60 -> 1 returned historical v0.1 without updating latest from v0.2. Default ZIP omitted the current warning. The opposite cycle retained an obsolete warning. | Only the latest identical fingerprint is reused. A -> B -> A earns v0.1, v0.2, v0.3; the next A reuses v0.3. Historical snapshots stay immutable. [ADR-0144](adr/0144-audit-versions-follow-the-latest-observation.md) records the alternative and reason. | verified: both cycles passed through real preflight and the default ZIP reader; historical bytes were captured at creation and remained unchanged. Independent probing also checked historical reads and latest reuse. |
| P2: public wording overstated the gate | The introduction said product-code commits were blocked. The gate classifies paths and allows research/scaffolding paths; it does not inspect code meaning. Older PASS/FAIL descriptions implied semantic correctness. | Describe gated projects, operating hooks, overrides and staged path boundaries. PASS/FAIL describe the command's checked conditions; the edit hook's ask and hard-block modes are distinguished. | verified: read-only review checked the revised wording against gate and edit-hook branches. |
| Guide clarification: independent work could be read as waiving a red suite | The optional guide allowed independent work after an unresolved fact without mentioning the standing protocol's red-test exception. | Explicitly retain immediate reporting with cwd and the requirement to fix or record and explain the failure before development resumes. | verified: final read-only text review found no remaining issue in the guide's roles, certainty or stopping guidance. |

## Verification record

All commands below ran in `C:\Users\PC\Fetchproof` unless another cwd is stated.

- **verified:** the new brief/audit regressions first produced 63 passed and 3 failed.
  Each failure reproduced a reported runtime defect. The red was reported before fixes.
- **verified:** `node fetchproof/bin/selftest.mjs brief audit artifact-producer mcp render`
  produced 142 passed, 0 failed and 2 unsupported Windows symlink capabilities.
  `FETCHPROOF_ALLOW_UNSUP=1` permits this local capability limitation; it is not a full
  capability pass.
- **verified:** after strengthening historical-byte capture timing,
  `node fetchproof/bin/selftest.mjs brief audit` produced 66 passed and 0 failed.
- **verified:** the root preflight passed with 28 passing checks, 0 blockers and its
  existing `hygiene/brief-unstamped` warning. Handoff verified 33 ledger entries and
  27 evidence rows.
- **verified:** in cwd `C:\Users\PC\Fetchproof\docs\decisions\2026-10-05-agent-reliability`,
  that project's own preflight passed with 12 passing checks, 0 blockers and 5 retained
  corroboration warnings. Its handoff verified 6 ledger entries and 6 evidence rows.
- **verified:** independent package probing checked approved, reviewing, blocked,
  review-required and collection-failed states. Authorization stayed consistent with
  manifest fields and independent package validation; all actual warning details remained
  in README-FIRST and the collection summary.
- **verified:** diff whitespace checks passed. The final runtime and wording reviews
  reported no remaining actionable finding in their stated scopes.
- **verified:** the enforced local commit gate ran the full checkout suite and accepted
  `241c02e`: 1,611 passed, 0 failed, 7 unsupported capabilities, exit 0. The captured
  result reports 788.6 seconds across 76 files on Node 24.20.0 / win32.
  The result totals 1,618 tests, matching the technical README. The same local capability
  waiver applies; this is not a full capability pass. Git's bundled Bash was available
  through the task's PATH, so its workflow checks ran rather than being unsupported.
- **verified:** `node fetchproof/bin/doctor.mjs` reported READY, collector role,
  kit 0.9.5, deployed copy matching this tree, root preflight PASS and no recorded
  overrides. No hook bypass was used. The optional guide was committed separately
  as `5f2e13a` after its final text review.
- **untested:** remote CI for these local commits and a controlled downstream outcome pilot.

## Review limits

This is a review of the changed handoff behavior and assurances, with targeted adversarial
fixtures. It is not an exhaustive audit of every kit feature, a semantic truth judge, or
evidence that the kit reduces mistakes by a measured amount. Public wording retains that
boundary. No capture, fetch ledger, contract, authored brief, package schema, evidence
policy or authorization rule was changed by these corrections.

The reviewers made and corrected two probe-only API/import mistakes before their final
successful runs. Those initial failures are not product or suite failures. The lead's
documentation helper also stopped on a newline assumption before inserting the ADR index
row; the corrected helper exited 0 and left the table contiguous. The source commit's
five-part report records the substantive implementation mistakes, impacts and corrections.

## Integration with updated main

GitHub main advanced to `3b295ff` before PR publication. Integration preserves its
watchdog-budget changes and resolves the competing brief warning presentation through
the shared renderer. It keeps whole-evaluation warnings and their reasons, and retains
main's row/unknown targets even when only supplied as finding metadata.

The handoff ADR is now 0143 and chronological-audit ADR 0144; main's watchdog ADR remains
0142. The earlier commit IDs and test results above describe the audited pre-integration
tree. A metadata-target regression was verified red (34 passed, 1 failed) before the
renderer fix. The integrated focused run of brief, audit, artifact-producer, MCP, renderer,
gate, hook and handoff groups passed with 254 passed, 0 failed and 2 unsupported Windows
symlink capabilities. Both research projects passed their own preflight and handoff again.
A read-only integration review found no actionable issue in the staged diff and ADR
references.

- **verified:** the enforced local commit gate accepted integrated merge `4004017` after
  the full checkout suite reported 1,619 passed, 0 failed, 7 unsupported capabilities and
  exit 0. The result reports 863.6 seconds across 76 files on Node 24.20.0 / win32.
  Its total of 1,626 tests matches the integrated technical README. The explicit local
  `FETCHPROOF_ALLOW_UNSUP=1` waiver still applies; this is not a full capability pass.
  The owned gate and suite processes both exited 0. No hook bypass was used.
- **verified:** an earlier integrated commit attempt exited 1 without a completed suite
  result or diagnostic verdict. Publication stopped; the cause remains unknown. The
  identical staged source was retried through the same enforced gate and produced the
  completed result above. The interrupted attempt is not claimed as a passing run or a
  reproduced failing test.
- **untested:** the integrated branch's remote CI and a controlled downstream outcome
  pilot. Local validation does not establish either result.
