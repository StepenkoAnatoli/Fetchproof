# ADR-0193 — A superseded citation whose quoted words survived the refresh passes

- **Date:** 2026-10-25
- **Status:** accepted
- **Area:** `fetchproof/lib/checks.mjs` (`evidence-supersession`: the new pass
  `quote-survived-refresh`, the recheck, and the reason and drift attribution in
  `cites-superseded-row`'s detail; since 2026-10-26 also a citation whose refresh landed on
  another URL, decision 8)
- **Prompted by:** plan v0.4 (`fetchproof-reasoning-layer-plan-2.md` §7, owner-approved
  2026-10-25), run `docs/orchestration/2026-10-25-quote-level-refresh/` (R-11, R-12, R-13, Mandate
  C3), and the first real quoted refresh, `docs/decisions/2026-10-25-first-quoted-refresh/`
- **Extends:** ADR-0026 (a refresh triggers claim review), ADR-0191 (the short-quote floor on the
  compared text), ADR-0194 (a cited page a refresh found gone), ADR-0140 (`sourceSha256`)
- **Lifts the hold (ADR-0157) and the freeze (ADR-0117)** for this one item, by the owner's ruling of
  2026-10-25: "spend credit but in a new chat for 192/195", read as the range 0192-0195. Unrelated
  work stays held.
- **Decision 8 by the owner's ruling of 2026-10-26** (Stage 7 gap audit, gap 1), under the same
  exception: "Fix it in this PR (Recommended)", the option that read "Under the ADR-0193/0194
  exception: a later scrape that asked for the cited URL but landed elsewhere reopens the
  citation. It is joined on the ledger's requestedUrl, and supersededRows stays unchanged."
- **Redirect-first rows in decision 8 by the owner's ruling of 2026-10-26** (G1-fix review 1,
  finding B): "Cover them (Recommended)", the option that read "Add the reviewer's join (asked the
  same URL as the row's own capture) in the same second builder round. It closes a reachable
  false green and gap 4's shape."

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
8. **A refresh that landed on another URL is rechecked too, and never passes silently** (added
   2026-10-26, the owner's ruling above). A fetch that follows a redirect records where the bytes
   came from, and the collector files its row under that URL, so `supersededRows`, a join by
   urlKey, never paired it with the cited row: nothing reopened and the gate stayed green over a
   page that no longer held the quote (the Stage 7 gap audit's probe). Now a cited row R is
   moved when the last scrape after R's own, by ledger position, that asked for R's URL or
   landed on it - urlKey throughout, the asked-for URL read from the command by `requestedUrl` -
   landed on another key. When no scrape since R's own has done either, the last that asked for
   the URL R's own fetch asked for is read instead.
   - That join covers a row first captured through a redirect (its URL is where it landed, and
     its refreshes ask the plan's old address), by the second ruling above. Its reasons say so:
     "asked for X - the address E-02's own fetch asked for before it landed on Y - and landed on
     Z".
   - It comes second, not as an equal: R's own URL is the first word on R's page. Until the
     G1-fix review 2 the latest of the three joins won, whichever address it came through, so a
     later move of the old address was judged over R's own URL: a pass where R's URL, asked for
     directly, had landed on a page without the quote (R2-1, a false green, with or without a
     404 first), and a reopen where a later capture of R's URL held it (R2-5). So once R's URL
     has been fetched since R's capture, a later move of the old address is not read at all.
   - The current row of the landed capture's URL - the row naming it, or the row that has since
     superseded that one (`supersededRows`) - is rechecked as the replacement, by decisions 1-3.
     Its pass names the move ("..., and the refresh on 2026-11-02 asked for X and landed on Y, a
     different page, recorded as E-07."), adding "and since superseded by E-09" when a later
     capture of Y replaced the row. A capture of Y that had itself been replaced passed until the
     G1-fix review (finding A).
   - Any other outcome, and a landed capture no row names, reopens `cites-superseded-row` with the
     same words and the limit line. No new rule name: the reason is in the detail, as in
     decision 5.
   - A move is the newest word on the page, so it is judged instead of any earlier refresh that
     superseded R by URL. A later scrape that landed back on R's URL is an ordinary refresh again,
     whatever it asked for, and even when no row names its capture: the page came back, and
     hygiene warns `uncited-capture`. That reset is wider than "asked for" (G1-fix review 1,
     finding D), and it can only silence a move, never raise one.
   - Silent by design: a trailing slash or `www.` (one urlKey); a redirect-first row refreshed
     from where it landed, or through the redirect when it lands on R's URL again; and a failed
     fetch, wherever it is filed (ADR-0194's, or nothing).
   - A 404 on R's URL followed by a scrape that asked for that URL and landed elsewhere is a move,
     not a gone page (ADR-0194). A 404 or 410 recorded after the move, by ADR-0194's ledger rank
     and classification, is still gone, and the move never passes on it. Gone is read at three
     addresses, because a failure is filed under the address it asked for:
     - R's URL: the move reopens, and `cites-gone-page` fails beside it.
     - Where the move landed, after the capture of its current row - a direct fetch of Y that
       answered 404 (G1-fix review 2, R2-2). The move reopens and says "found Y, where the page
       landed, gone (HTTP 404)". Until round 3 it passed on a capture of a page found gone.
     - For a move through the address R's own fetch asked for, that address after the move
       (R2-3). The move reopens and says "found X, the address the move asked for, gone".
     - In the last two `cites-gone-page` stays quiet: it reads R's URL only, and a fail filed
       under another spelling is ADR-0194's alias consequence, unchanged. So "both fail" holds
       for R's URL; for the other two the reopen alone fails the gate.
   - A move of a move is not followed, and never passes. When the landed page's current row has
     itself moved since - Y, asked for directly, now lands on Z - the move reopens and says "Y has
     moved on since: the refresh on ... asked for Y and landed on Z". Until round 3 it passed on
     the first landing's capture, after a 404 at Y too, because the ask of Y that moved on ended
     Y's gone state (found by the round-3 builder's probe). Following the chain to Z's row was
     set aside: each hop adds a recheck whose wording and silent cases would need their own
     review, and the case needs two redirects of one cited page, none in the committed corpora.
   - `supersededRows` is unchanged, so the decision 7 readers are.

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
- A moved page now reopens or passes by decision 8. In the 2026-10-25 corpus survey, 2 of 15
  cited URLs redirect today; no committed cited row has a later scrape that landed elsewhere, so
  no verdict moves (movement.mjs, 2026-10-26). Of the 431 committed rows that have a capture, 1
  is redirect-first (`2026-10-02-licence-and-captured-pages` E-20), and it is uncited (G1-fix
  review 1).
- The cross-transport split (gap 4) is joined: a keyless row filed under the landed URL Y, then
  a refresh filed under the asked-for URL X, is a move, because X is what the row's own fetch
  asked for. The join does not depend on what Firecrawl records on a redirect. That fact is
  still UNVERIFIED (one scrape of a redirecting page, held by NO SPEND, would settle it), and it
  now decides only the wording a reader sees, not whether the citation is rechecked.
- Known gap, pinned as `KNOWN GAP` (Stage 7 gap 2): a quote found only inside a struck-through
  span of the new capture (`~~...~~`, as Firecrawl captures carry it) passes. The EUDR corpus's
  Wikipedia capture strikes postponed dates exactly so. The matcher keeps the tildes; the keyless
  converter has no strike handling, so there the strike is lost (read from its code, not probed).
  Changing either is a matcher or converter change, not made here.
- Known gap, pinned as `KNOWN GAP` (Stage 7 gap 3): text changed inside an ellipsis gap, up to
  `MAX_QUOTE_GAP` compared characters, passes, and the pass says the quoted words occur. 3 of the
  baseline's 517 anchors carry an ellipsis.
- The attribution is unmeasured on real data; its wording is the plan's.
- No committed verdict moves (measured above). The first quoted refresh, rebuilt in a scratch copy,
  passes its three citations and moves none.

## Trigger to revisit

- A real refresh passes `quote-survived-refresh` where a re-read finds the claim no longer holds,
  or the plan §12 study reports the pass costs more re-reads than it saves.
- A real refresh reopens at attribution case 6 with the same transport and different source
  hashes, where the cause cannot be told (plan §13: converter identity in the ledger).
- The owner's 1.0 decision on the freeze (ADR-0117), or the ADR-0145 comparison reports.
