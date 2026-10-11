# ADR-0150 — Complete review and Git corpus ownership in builder handoffs

- **Date:** 2026-10-08
- **Status:** accepted, maintenance clarification; no new public interface or approval predicate
- **Area:** shipped skills, project instructions, installer next steps and successful request guidance
- **Clarifies:** ADR-0010, ADR-0052, ADR-0095, ADR-0138, ADR-0146 and ADR-0148

## Context

The shipped auto-build summaries accepted a passing preflight and a BRIEF file. The
router also accepted `authored` alone. Neither establishes the complete review that
`lib/artifact.mjs` already derives: intact handoff and current gate, classified MAP,
rewritten extractor Findings, and an authored brief whose two judged sections are
present and answered. Stamped briefs must match current corpus inputs. The brief
state command reports state and judged sections; it does not check currency alone.

Git request guidance in fact-request and `lib/auto-collect.mjs` told the builder to
rewrite Findings and close the unknown after a `collected` result. The collector has
only delivered captures at that point; it still needs to record the review and current
brief. Those instructions crossed the ownership boundary that ADR-0148's request
workflow describes, and could imply that delivery completed phase 1.

There are two compatibility requirements. ADR-0052 permits local review and
re-packaging of a received project. ADR-0138 keeps approval for an authored brief
without a draft stamp, because its currency cannot be checked. Collection role is not
an approval predicate in `deriveState`; adding one would change existing behavior.

Doctor already permits an explicitly chosen keyless collector (ADR-0095), but several
role tables still called any missing Firecrawl key a failure. Installer next steps
also offered a per-run research transport flag before telling the operator to stop at
doctor READY; that flag does not configure doctor's chosen machine transport.

## Decision

1. **State the existing complete review.** On either machine, building needs intact
   handoff and PASS, classified MAP, rewritten extractor Findings, and an authored
   brief with both judged sections answered. A stamped brief needs current inputs.
   Authored unstamped briefs keep ADR-0138's approval path, with currency unknown.
   The machine role controls collection; it adds no derived authorization condition.
2. **Keep the Git corpus records with the collector.** The builder reads and judges
   returned captures, then reports review-only gaps in prose. The collector records
   Findings, unknown closures, map classification and the current authored brief.
   `collected` means captures were delivered; the result and file presence do not
   certify review or authorize dependent building. Request another fetch only for a
   missing external fact, not to classify a map, rewrite a finding or update a brief.
3. **Preserve received-package local review.** ADR-0052's recipient can review a local
   project and re-package it under the received identity. That workflow does not
   permit collection on a builder or edits to the collector's Git corpus. Its approval
   still comes from the same review and gate checks.
4. **Confirm the project before diagnostics and report actual health.** Unresolved
   roles and blocking diagnostics need resolution. Missing Firecrawl CLI/auth fails
   for an unchosen or Firecrawl route; an explicitly chosen keyless route passes
   those findings, without proving every other doctor check passes. Installer
   instructions name the selected config for the existing transport setting, and
   unresolved roles get diagnostics before role-specific advice. No machine config,
   role, hook, public command or option is changed by this correction.

## Rejected alternatives

- **Treat PASS, `collected`, file presence or `authored` alone as permission.** These
  omit existing review/current-input conditions and overstate what the commands check.
- **Add a builder-role predicate to approval.** Role controls collection and is not
  one of the existing derived conditions; this would be a new semantic policy.
- **Forbid local received-package review, or refuse authored unstamped briefs.** Both
  would revoke compatibility explicitly kept by ADR-0052 and ADR-0138.
- **Have the builder finish review records in the collector's Git corpus.** This
  makes the request instructions contradict the collector-owned workflow. The
  builder can judge the evidence without writing those records.
- **Collect again for a review-only gap.** Existing captures already answer it;
  another fetch adds cost and provenance without performing the missing review.

## Verification and limits

Readiness statements follow `lib/artifact.mjs`'s `deriveState`, `lib/brief.mjs` and
doctor's existing transport decision. Existing artifact producer/CLI and brief cases
cover missing judged sections, stale inputs, authored unstamped compatibility,
extractor Findings and received-project re-packaging. The router table and frontmatter
remain covered by the existing skill-set checks; installer paths by the existing CLI
checks. These are validation targets, not a claim that a run already passed.

This ADR changes guidance and result/installer text. It does not implement automated
collector review, certify every prose duty, alter ownership at the filesystem gate,
or assert that the operator's deployed installation is READY.

## Trigger to revisit

A separately authorized change to the package review contract or Git request review
workflow. Until then, retain both compatibility paths and the existing approval
conditions; do not infer an ownership or role-policy feature from this clarification.
