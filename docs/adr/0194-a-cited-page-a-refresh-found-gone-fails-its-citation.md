# ADR-0194 — A cited page that a refresh found gone fails its citation

- **Date:** 2026-10-25
- **Status:** accepted
- **Area:** `fetchproof/lib/checks.mjs` (`evidence-supersession`, the new failure
  `cites-gone-page`), the new `fetchproof/lib/fetch-failure.mjs` (the failure classifier, moved
  out of `fetchproof/lib/collect.mjs`), `fetchproof/lib/firecrawl.mjs` (`rateLimitWaitMs` asks
  the shared `isRateLimited`)
- **Prompted by:** plan v0.4 (`fetchproof-reasoning-layer-plan-2.md` §2 and §8, owner-approved
  2026-10-25), run `docs/orchestration/2026-10-25-quote-level-refresh/` (R-10, Mandate C1)
- **Extends:** ADR-0026 (a refresh triggers claim review), ADR-0100 and ADR-0174 (what the
  collector reads as gone or refused)
- **Lifts the hold (ADR-0157) and the freeze (ADR-0117)** for this one item, by the owner's ruling of
  2026-10-25: "spend credit but in a new chat for 192/195", read as the range 0192-0195. Unrelated
  work stays held.

## Context

ADR-0026 exists so that a claim cannot quietly stop being true: once a page is re-collected,
every unknown still resting on the old row fails `cites-superseded-row` until someone re-reads
it. That works when the refresh gets a page. It does not work when the page has been deleted.

A refresh that the page answers 404 or 410 is a failed fetch (since 2026-09-28): `collectOne`
writes an `op: 'fail'` ledger entry naming the status, and no capture and no evidence row
(`collect.mjs`, the error-page branch). `supersededRows` sees only rows, so it finds no
replacement, and `traceOf` skips fail entries. The old row stays current, the gate stays
green, and the claim rests on a page that is gone - the exact quiet failure ADR-0026 was
written against, reached by the one refresh outcome it never looked at. Verified at `ab2e605`
(plan §2): the collector already knew the page was gone, because `standingFailure` classifies
404 and 410 as `gone` for `recentlyGone` (ADR-0100), but only the collector asked it.

Why this could not wait for the ADR-0145 comparison (ADR-0157): it is a correctness gap, a green
gate over a deleted page, and the run's quote-level recheck (ADR-0193) builds on it; the owner
ruled the range 0192-0195 an exception. The plan's reading of the freeze: it reads either way
(a gap against ADR-0026's purpose, or a new finding), so it is treated as a feature and lifted
here.

Prior art, credited as a courtesy: Testimonium (github.com/noahogbi/testimonium, MIT) treats a
404/410 on re-check as its own "gone" category, apart from a changed page, and uses a 500 as its
negative control. This ADR re-implements the idea from the plan's description; no code or
fixture was copied.

Measured on 2026-10-25 over the 41 corpora in this repository (the root and the 40 under
`docs/decisions/`): 8 ledger entries are failures `standingFailure` reads as gone, in 4
corpora, and none is the last word on a URL a cited row was scraped from. So the new failure
moves no committed verdict.

## Decision

1. **A new failure, `evidence-supersession/cites-gone-page`.** For each unknown and each row it
   cites: when the **last** ledger entry filed under the row's URL (a scrape or a fail, compared
   by `urlKey`, whichever transport ran it) is a fail that `standingFailure` reads as gone (HTTP
   404 or 410), recorded **after** the scrape that wrote the row's capture, and no later scrape
   asked for that URL (amended 2026-10-26: such a scrape that landed elsewhere is a move, filed
   under where it landed, and ADR-0193 decision 8 judges it; see Consequences), the citation fails:
   "U-4 rests on E-12. A refresh on 2026-11-02 found the page gone (HTTP 404). Re-research U-4
   or record in E-12's Finding that the page now answers HTTP 404 and why the earlier reading
   still holds." The finding carries `row`, `line`, `cited` and `status`. The date is the
   fail entry's `at`. The remedy names the place and the words because only those clear it
   (decision 4): the same reason written without the status, or written in DISCOVERY.md's
   Evidence cell, left the gate red (U6 review F4, 2026-10-25).
2. **Ledger position decides "last" and "after", not dates.** The ledger is append-only and
   hash-chained, so its order is the order the fetches happened. Dates are not: until
   2026-10-04 a scrape entry was stamped with midnight of its day while a fail carried the real
   time, so on one day the dates put a morning 404 after the scrape that followed it. The row's
   scrape is the position `ledgerRank` gives its capture (the Raw cell's, or for a blank Raw cell
   the capture its URL names, as `supersededRows` ranks it). A row whose capture no fetch
   recorded has no scrape to come after, and gets no finding here; provenance fails it already.
3. **Gone means what the collector means.** A 5xx, a timeout, a rate limit (whatever its
   status, GitHub's `403 ... API rate limit exceeded` included), a standing 403 or 401, a 429
   and the kit's own refusals (over the size a capture may hold, not text) are not gone. A page
   that came back - a successful scrape after the 404 - is current again; if that scrape replaced
   the row, it is `cites-superseded-row`'s to report.
4. **The `raw-error-status` exemption applies.** A row whose Finding names the status itself
   (`\b404\b`, for a 404) has said so, and is not flagged: some corpora cite a 404 on purpose.
   The exemption is per status; a Finding naming 410 does not exempt a 404.
5. **It fails under every policy**, like `cites-superseded-row`: `pluralist`, `strict` and
   `--strict` alike. It is asked whether or not anything was superseded, and the check's pass
   ("no evidence row has been re-collected") is no longer printed beside a failure.
6. **One classifier, in its own module (Mandate C1).** `FAILED_STATUS`, `GONE`, the standing
   4xx, the kit's refusals and `standingFailure` move unchanged from `collect.mjs` to
   `lib/fetch-failure.mjs`, which imports nothing; `goneStatus` is the gate's question over it.
   The rate-limit test `standingFailure` needs moves with it as `isRateLimited`, and
   `firecrawl.mjs`'s `rateLimitWaitMs` asks it first, so the wait loop, the collector's memory
   and the gate have one answer. The collector's behaviour is unchanged, and its tests are
   untouched.

## Rejected alternatives

- **Export `standingFailure` from `collect.mjs` and import it in `checks.mjs`** (the plan
  allowed it). The gate would import the collector, and through it every transport, to read a
  string. The gate stays a pure function of the corpus with no route to the network.
- **Make the shared module import `rateLimitWaitMs` from `firecrawl.mjs`.** The same objection,
  for one transport: the gate would load the Firecrawl adapter. Copying the regex into the shared
  module instead would give "is this a rate limit" two sources that could drift.
- **Treat a gone page as a supersession** (`supersededRows` returns the fail entry as the
  "replacement"). Every reader of `supersededRows` (`transport-provenance`, `hygiene`, the
  handoff's `fetched`, `isReleasedHistory`) would meet a replacement that is not a row, and the
  remedy differs: a superseded row has a fresher reading to move to, a gone page has none. Hence
  a name of its own, the only new rule name in the plan.
- **Any 4xx or 5xx on refresh fails the citation.** A busy server, a rate limit or a refusal to
  one client is not evidence that the page is gone, and the next refresh may get it. The gate
  would fail claims over weather.
- **Judge the latest failure by date.** It mis-orders same-day entries in ledgers written
  before 2026-10-04 (decision 2), and an entry's date is a field, where its position is chained.
- **A warning, or strict-only.** A citation to a deleted page is the same class as a citation to
  a superseded capture, which fails under every policy; a warning is what let ADR-0026's
  failure go unnoticed.

## Consequences

- A refresh that finds a cited page deleted now blocks the gate until the claim is re-researched,
  or the row's Finding records the status ("the page now answers HTTP 404; ...").
- **A blind spot, kept on purpose.** The exemption (decision 4) matches the status anywhere in
  the Finding, so a row whose Finding names it as the page's *content* - an API reference saying
  "unknown keys return HTTP 404", Google's soft-404 definition - can never trip `cites-gone-page`
  for that status: its page could be deleted and the gate stay green. Measured by the U6 review
  on 2026-10-25: 8 of the 344 cited rows in the 45 indexed corpora are such rows -
  `2026-09-21-delivery-architecture` E-10, `2026-09-26-actions-sept-changes` E-05,
  `2026-09-28-collection-cost-model` E-02, `2026-10-03-gap-audit-corpus` E-02,
  `2026-10-04-gap-audit-extraction` E-07, E-09 and E-10, and the root's E-13. None of their pages
  has a gone refresh, so nothing is hidden today. It was not narrowed (to a statement about the
  page's fate, or a fixed marker such as "now answers HTTP 404") because the plan mandated the
  `raw-error-status` exemption as it stands, and a narrower marker is a new convention every
  corpus would have to learn - the owner's call, not this ADR's. The reverse trigger below
  reopens it.
- A refresh with a transient failure changes nothing, as before; the next refresh decides.
- A later transient failure after a 404 (a 500, say) is the URL's last word, so the citation is
  not flagged until a refresh again answers gone. The collector reads it the same way:
  `recentlyGone` takes the last entry filed under the URL.
- A fail recorded under a URL spelling `urlKey` does not join to the row's cell (a redirect alias
  the collector asked as the plan URL) is not seen by `cites-gone-page`. No corpus here has one;
  reopen if one does. A moved citation reads two more addresses for its reason only (ADR-0193
  decision 8): where the move landed, and the address a redirect-first row's move came through.
- A moved page is not gone: a refresh that asked for the cited URL and landed on another one is a
  successful scrape, and ADR-0193 handles it (decision 8, 2026-10-26).
- So a later scrape that asked for the cited URL and got content, wherever it landed, ends a
  gone state recorded before it: the 404 is no longer the URL's last word, and `cites-gone-page`
  does not fire (G1-fix review 1, finding C, 2026-10-26). A 404 recorded after the move is still
  gone.
- **Here the gate and the collector differ, on purpose** (G1-fix review 2, R2-4). The collector's
  `recentlyGone` still reads only the last entry filed under the URL, so after a 404 and then a
  scrape that asked for the URL and landed elsewhere, it holds the URL gone - "not fetched again
  for 30 days; --force retries it" - while the gate reads a move and `cites-gone-page` is quiet.
  Both read a failure's text through `fetch-failure.mjs`, so they agree on what is gone; they
  differ on which entry is the URL's last word. The cost is a refresh within the window skipping
  the URL as gone, so the move is not re-observed until the window passes or `--force`; the gate
  still judges the move it has (ADR-0193 decision 8), so the skip costs a fresh observation, not
  a verdict. The collector is not changed in this run (the run's ruling of 2026-10-26). Reopen if
  a refresh is seen skipping a moved page that a gate verdict then rests on.
- No committed verdict moves (measured above).

## Trigger to revisit

- A cited page whose refresh was gone is reported under a spelling the check did not join.
- A corpus is found citing a 404 on purpose without naming the status in its Finding.
- A cited row's Finding names the status as content and its page is found gone (the blind spot
  under Consequences).
- The owner's 1.0 decision on the freeze (ADR-0117), or the ADR-0145 comparison reports.
