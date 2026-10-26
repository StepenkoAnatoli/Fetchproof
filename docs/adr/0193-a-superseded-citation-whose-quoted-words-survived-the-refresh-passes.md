# ADR-0193 — A superseded citation whose quoted words survived the refresh passes

- **Date:** 2026-10-25
- **Status:** accepted
- **Area:** `fetchproof/lib/checks.mjs` (`evidence-supersession`: the new pass
  `quote-survived-refresh`, the recheck, and the reason and drift attribution in
  `cites-superseded-row`'s detail)
- **Prompted by:** plan v0.4 (`fetchproof-reasoning-layer-plan-2.md` §7, owner-approved
  2026-10-25), run `docs/orchestration/2026-10-25-quote-level-refresh/` (R-11, R-12, R-13, Mandate
  C3), and the first real quoted refresh, `docs/decisions/2026-10-25-first-quoted-refresh/`
- **Extends:** ADR-0026 (a refresh triggers claim review), ADR-0191 (the short-quote floor on the
  compared text), ADR-0194 (a cited page a refresh found gone), ADR-0140 (`sourceSha256`)
- **Lifts the hold (ADR-0157) and the freeze (ADR-0117)** for this one item, by the owner's ruling of
  2026-10-25: "spend credit but in a new chat for 192/195", read as the range 0192-0195. Unrelated
  work stays held.

## Context

ADR-0026 makes a refresh reopen every claim that rests on the row it replaced: an unknown still
citing the old row fails `cites-superseded-row` until someone re-reads the new capture and moves
the citation. That is right when nothing is known about the new page. It is wasteful when the row
carries a quote marker (`[quote: ...]`, ADR-0062) and the quoted words are in the new capture: the
first real quoted refresh (`docs/decisions/2026-10-25-first-quoted-refresh/REFRESH-RECORD.md`)
re-collected two cited pages, both quotes survived, and preflight still failed three citations.
A gate that reopens every refreshed claim teaches its user to move citations without reading,
which is the failure ADR-0026 exists to prevent.

The kit can already answer the narrow question - are these exact words in that capture - with the
matcher `citations` uses (`quoteAnchors`, `anchorFound`, `quoteTooShort`). It cannot answer the
question a re-read answers, whether the claim still holds. So the pass this ADR adds says only the
first, and every reopen says so too.

Why this could not wait for the ADR-0145 comparison (ADR-0157): the reopen-everything behaviour
was measured on the kit's first real quoted refresh, three blocking failures over two pages whose
words survived, and the owner ruled the range 0192-0195 an exception to spend that credit. It reads
either way (a gap in ADR-0026, or a new pass), so it is treated as a feature and lifted here.

Prior art, credited as a courtesy: Testimonium (github.com/noahogbi/testimonium, MIT) rechecks a
quote against a fresh fetch, requires the quote to be found in its own original capture first (the
baseline rule), lets a new outcome category default to silence, and attributes drift to a cause.
This ADR re-implements those ideas from the plan's description; no code or fixture was copied.
Testimonium's defaults are turned around where they meet this gate: here the risky output is the
pass, because it removes a re-read, so new states default to the reopen and the attribution only
explains one.

Measured on 2026-10-25 with `docs/measurements/2026-10-refresh-baseline/movement.mjs`: none of the
41 baseline corpora moves (none of their superseded rows that is still cited carries a quote).
The attribution is unmeasured: no real refresh has yet lost a quote.

## Decision

1. **One new pass, `evidence-supersession/quote-survived-refresh`, and no new failure name.** For
   an unknown citing row R that `supersededRows` says row N replaced, the citation passes only
   when all of these hold; every other state stays `cites-superseded-row` (plan §7.1):
   - R is in the evidence table and carries at least one quote anchor;
   - at least one anchor is usable - not `quote-too-short`, measured on the compared text
     (ADR-0191) - and only usable anchors are rechecked;
   - no refresh after the replacement found the page gone (ADR-0194's `goneAfterScrape`), asked of
     the ledger alone: ADR-0194's exemption for a Finding that names the status does not apply
     here, because the old row's text cannot say whether a later fetch failed (U8 review F3);
   - R's Raw cell names a capture that is on disk and readable, and every usable anchor is found in
     its body (the baseline rule);
   - N's Raw cell names a capture that is on disk and readable, and is not an HTTP 4xx/5xx page,
     even if its body holds the words (a capture kept before 2026-09-28);
   - every usable anchor is found in N's capture body.
   The pass says: "E-01's quoted words occur in E-03's capture `<file>`. That says the words
   survived, not that the claim still holds. Re-read E-03 when you next touch U-01.", then the
   limit line of decision 6. It carries `row`, `line`, `superseded`, `by` and `capture`.
2. **Only a row's OWN capture is read** - the file its Raw cell names, through `ownCapture`. Never
   `captureOf`'s fallback for a blank cell, the URL's newest capture: for an old row that is the
   replacement's capture, and the old quote would be found in the page it is compared with. A
   missing or unreadable file is a reason to reopen, never an empty page that lacks the words.
3. **The design rule: only the state above passes.** A state added later defaults to the reopen.
4. **The citation is never moved or rewritten.** After a pass the unknown still cites R. Moving it
   remains the act of somebody who re-read the page; the pass names the page to read. Preflight
   prints a pass, and so its "Re-read N" advice, only with `--show-pass` and in `--json`; its
   default output shows only the verdict line, and the commit gate carries failures only. This is
   a known limit, recorded for the owner (U8 review F2): printing survived passes by default is a
   preflight output change outside this plan.
5. **The reopen says why.** `cites-superseded-row`'s detail keeps ADR-0026's sentence and adds the
   reason: no quote, every quote too short, no baseline, the replacement names no capture or its
   file is missing, an error page, a status that is not a number, the page gone since, or the quote
   that is missing. A replacement capture whose status is there and is not a number ("404 Not
   Found", "HTTP 404", a quoted "404") cannot say it is not an error page, so it reopens by
   decision 3 (found 2026-10-25, Phase 4b breaker F2: read as NaN, such a capture passed). For a
   missing quote it names the first matching cause the ledger can tell (plan §7.3): equal `bodySha256`
   (cannot happen honestly; one capture was edited, and provenance names it), equal
   `sourceSha256` (the conversion changed, not the page), a transport change, a partial capture
   with what it omitted, a capture under `MIN_CAPTURE_CHARS` (could not look), otherwise "the page
   changed, or the converter changed without being recorded". The attribution is asked after the
   reopen is decided and can never turn it into a pass.
6. **Every pass and every reopen of a superseded citation ends with one line:** "Refresh
   confirmation detects whether the quoted words are still in the new capture, never whether the
   claim is still true." Assumption, stated here: the plan's "every refresh report ends with one
   line" is met by this check's pass and reopen details. A reopen is printed by default; a pass
   only with `--show-pass` and in `--json` (decision 4), so in the default output the line ends
   reopens only. `research.mjs` is out of this run's scope and is unchanged.
7. **Every other reader is unchanged** (plan §7.4). The old row is still cited, so it is not
   released history: transport-provenance still reports it, hygiene treats the pair as a refresh
   (no `duplicate-url`, no `uncited-capture`), `evidence-context` still shows "SUPERSEDED BY", and
   the handoff's fetched range still leaves it out. Each is pinned by a test.

## Rejected alternatives

- **Move the citation to N on a pass.** ADR-0026 makes the move the researcher's act after a
  re-read; a gate that rewrites `DISCOVERY.md` would turn "the words are there" into "the claim
  holds", the conclusion it cannot compute (ADR-0089).
- **A warning instead of a pass** (keep a finding the user must clear). It changes nothing a user
  can act on - the re-read is already advised in the pass - and a warning per refreshed citation
  is the noise that buried real findings before ADR-0026's history rule.
- **Read a blank Raw cell through `captureOf`.** For the old row it resolves to the newest capture,
  so the comparison would be the replacement against itself (plan v0.4 §2).
- **Pass when any usable anchor survives.** A row with two quotes, one gone, rests on a page that
  no longer says half of what was quoted.
- **Recheck without the baseline.** A quote its own capture never held (pasted, or from another
  page) proves nothing about the new one; found in N, it would pass a claim no capture ever backed.
- **Let the attribution pass a reopen** (Testimonium's "the archive still matches" exculpation).
  Here the risky output is the pass; a cause that explains the miss does not show the claim holds.
- **New failure names per reason.** The plan asks for minimal naming: one pass name; the reason is
  in the detail, so gates, configs and docs that know `cites-superseded-row` are unchanged.
- **A semantic or normalised matcher.** No new matcher and no new parser: the recheck uses the one
  `citations` uses, so a quote that passes there and here means the same. Spacing before closing
  punctuation (B2) is ADR-0192's; it landed first, so recheck test 12 expects the pass.

## Consequences

- A refresh whose quoted words survived no longer blocks the gate for the citations resting on
  those quotes; unquoted and every other state reopen exactly as before, with a reason.
- Freshness is a separate question. An old row whose words survived but whose capture is older
  than the age limit still warns `unknown-closure/stale-evidence` beside the pass - naming the
  fresher capture and saying to re-read it and move the citation - and fails under `--strict`,
  which promotes every warning (U8 review F5).
- Known gap, pinned as `KNOWN GAP`: a redesign that keeps the sentence under a heading that changes
  its meaning ("Enterprise only") passes. A string check cannot see it; plan §12 measures the cost.
- Known gap: quote markers `quoteAnchors` cannot read are `citations`' failure, not this check's.
- The attribution is unmeasured on real data; its wording is the plan's.
- No committed verdict moves (measured above). The first quoted refresh, rebuilt in a scratch copy,
  passes its three citations and moves none.

## Trigger to revisit

- A real refresh passes `quote-survived-refresh` where a re-read finds the claim no longer holds,
  or the plan §12 study reports the pass costs more re-reads than it saves.
- A real refresh reopens at attribution case 6 with the same transport and different source
  hashes, where the cause cannot be told (plan §13: converter identity in the ledger).
- The owner's 1.0 decision on the freeze (ADR-0117), or the ADR-0145 comparison reports.
