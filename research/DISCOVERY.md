# Discovery Contract - Research-first project bootstrap

Started 2026-09-13. This file is the definition of "enough information to build".
`node fetchproof/bin/preflight.mjs` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

A research-first kit for this machine: a collector that turns a Firecrawl fetch into
cached, citable evidence, and a gate that refuses to let a build start while a blocking
fact is unproven. "Done" means an agent asked to build something can no longer answer
*insufficient information* and stop — it either produces primary-source evidence, or
names the one fact it could not reach and records the day-one step that would settle it.

The reason this file exists at all: this repository is the kit's own development home, so
it inherits its own gate. A gate that exempts the project it ships with is a gate nobody
should trust, so this contract is real rather than waived.

## Unknowns

A fact belongs here when guessing it wrong changes the design: API limits and pricing,
auth model, data schemas, rate limits, licensing/ToS, platform behavior, current library
versions, competitor pricing, data availability.

Status is exactly one of:
- `CLOSED` - proven by an `E-##` row in `research/EVIDENCE.md` (which must point at cached raw text).
- `KNOWN-UNKNOWN` - unreachable now; the `Evidence` cell names the day-one verification step.

Anything else (`OPEN`, blank, "in progress") fails the gate.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-1 | What does the free Firecrawl tier actually allow - per-minute request limits, parallel jobs, and included credits? | Sets the collector's default `--depth` budget, how many sources one run may take, and whether a queue or retry-with-backoff is needed at all | CLOSED | E-19 (re-read 2026-09-20 on a metered, full capture): free plan allows 10 `/scrape` and 10 `/search` requests per minute with 2 concurrent browsers, and a free key includes 1,000 credits [single-witness: Firecrawl stating its own tier limits. Nobody else can - third-party comparison pages restate it and go stale, and citing docs.firecrawl.dev beside www.firecrawl.dev would flip this to independent on hostname alone while remaining one company describing itself] |
| U-2 |  Which skill root does Freebuff Desktop auto-discover on this machine - `~/.agents/skills/` or `~/.claude/skills/`? | Decides whether the protocol binds agents at the skill layer or only through each project's `AGENTS.md`; the two are mirrored today precisely because this is unresolved | CLOSED | E-22 (re-read 2026-09-20 on a metered, FULL capture - the earlier one carried 3 chunks of 12): documented - the skills page enumerates the discovery roots: personal `~/.claude/skills/` (all local projects), project `.claude/skills/` from the start directory to the repo root, directories added via `--add-dir` / `/add-dir` (the deliberate exception: `permissions.additionalDirectories` grants file access only, but an added directory DOES load its skills), plugins (`<plugin>/skills/<name>/SKILL.md`, as `/plugin-name:skill-name`), and enterprise managed settings. `~/.agents/skills/` appears nowhere - it is not a documented discovery path. A skill folder holding `.claude-plugin/plugin.json` loads as a plugin named `<name>@skills-dir` and can bundle agents, hooks, and MCP servers. Critical for this machine: Cowork and cloud sessions, including routines, do NOT read `~/.claude/skills/` - a personal-only skill reports skill-not-found in a routine. The `~/.agents` mirror was unnecessary; `AGENTS.md` stays the binding layer for runtimes with no Claude skill loader [single-witness: a question about THIS machine - which skill root the desktop app discovers here. No page on the internet knows. Established by running it, and re-running it is the only thing that could confirm it] |
| U-3 |  Does the Claude Code `PreToolUse` hook block an edit on this Windows build, and does exit code 2 stop the session instead of letting the agent adapt? | Decides whether the edit-time gate ships as `permissionDecision: "ask"` (current default) or the harder `hard-block`, which is the stronger guarantee but risks wedging a session mid-task | CLOSED | E-23 (re-read 2026-09-20 on a metered, FULL capture - the earlier one carried 4 chunks of 33): documented - PreToolUse returns `permissionDecision` of allow / deny / ask / defer inside `hookSpecificOutput`; multiple hooks resolve most-restrictive-wins with precedence deny > defer > ask > allow; a hook that exits 2 routes the same as deny with stderr as the denial reason (the session continues and Claude sees the reason - it does not wedge); an `ask` prompt carries a provenance label naming the hook source (`[settings]`, `[plugin:<name>]`, or `[skill]`). The page also records the reported non-enforcement: before v2.1.214, an exit-2 hook whose JSON failed schema validation was treated as a non-blocking error and the action proceeded - which is the open-issue pattern; our hook exits 0 and emits the `hookSpecificOutput` wrapper, the correct side of that fix. `hard-block` stays behind config until verified live [single-witness: also a question about this machine and this Windows build, not about a documented contract. Established by running the hook and observing the exit code, which is the only available witness] |
| U-4 | Is this kit's own collection permitted - automated fetching of public vendor documentation through Firecrawl's service, for personal research on the operator's machine? | If the ToS forbids the intended use, the kit's whole evidence base rests on a prohibited activity and the collection layer needs rework | CLOSED | E-24 (re-read 2026-09-20 on a metered, FULL capture - the earlier one carried 1 chunk of 3 and recorded no transport at all): Section 4 item 01 bounds the permission rather than removing it - "Use the Services for any commercial purposes except as expressly authorized by Firecrawl". One operator researching public vendor documentation on their own machine is not a commercial purpose, and nothing in the full text forbids automated fetching through the service Firecrawl sells to do it [single-witness: Firecrawl's own terms of service. A vendor's terms are authoritative by definition and no second party can testify to what they permit - only a lawyer's reading of the same document, which is not a second source] |
| U-5 | What does SerpAPI's free tier actually allow - searches per month, rate limits, and whether the plan permits automated use? | Decides whether a second search provider can be a default or only an opt-in, and sets the cache policy: the kit fires 4 searches per phase-0 run plus one per plan query, so a monthly cap is a design constraint, not a footnote | CLOSED | E-25 (re-read 2026-09-26, unchanged from the 2026-09-19 capture it supersedes): the free plan is 250 searches per month at 50 throughput per hour, $0, sign-up only. Automated use is the product — the ToS (E-10) restricts purpose, not automation, and forbids nothing this kit does. The cap is softer than it reads, for two reasons E-25 and E-09 state outright: a response counts as one search whatever it returns ("100 results or empty result sets will both count as 1 search"), and a repeat of an identical query inside an hour is served from SerpAPI's own cache free and uncounted ("Cache expires after 1h. Cached searches are free"). The hourly figure is the documented one; what this account actually enforces is U-9. At this kit's rate — 4 searches per phase-0 run — 250 a month is roughly 60 runs, which is not the binding constraint. What is binding: E-10 excludes the free plan from the $2M U.S. Legal Shield [single-witness: SerpAPI stating its own tier. The three rows are three SerpAPI pages, correctly reported as one voice, and there is no fourth party who knows what SerpAPI includes] |
| U-6 | Does SerpAPI's ToS permit STORING search results, which this kit does by writing them into the corpus? | The kit caches what it collects. A provider that forbids retention makes the discovery layer's whole design unusable, exactly as U-4 asked of Firecrawl | CLOSED | E-10: yes, by absence and by implication. Nothing in the Terms of Service or Privacy Policy of 2026-08-27 restricts what the customer does with returned results; the one reproduction ban (Section 2) is scoped to "any portion of the Service, use of the Service, or access to the Service" — reselling access, not keeping data. Section 13 assumes the customer holds it: SerpApi "assumes liability for the lawful collection of public search data … but not for how that data is ultimately used". The 31-day retention in Privacy Policy Section 10 governs SerpApi's copy, not the customer's. Read this as permission-by-silence rather than a grant, and note the limit found alongside it: the $2M Legal Shield that would cover collection is excluded on the free plan [single-witness: SerpAPI's own terms on storing results. Same limit as U-4 - a vendor's terms have one author, and a second reading of them is not a second witness] |
| U-7 | What does Tavily's free tier allow, and does its ToS permit storing results? | The second candidate provider. Same two questions, because the answer decides which of the two can be a default rather than an opt-in | CLOSED | E-12: 1,000 credits per month free, no card, at 1 credit per basic search — four times SerpAPI's 250 (E-25) and, at 1 credit per 5 successful extractions, five times cheaper per page than Firecrawl (E-21). E-16: storing Output is unprohibited rather than granted — §1.7 excludes Output from the definition of "Services", so the §3.2 copy/derivative/distribute restrictions do not reach it, and §9 never allocates Output to either party; §6.6 does forbid using Output to train a competing model. The fact that decides the default, though, is §6.5: Tavily and its AI providers "may use, process, analyze, and retain Customer Input … and Outputs … for purposes of training", and §6.7 says those providers may not be bound to confidentiality. A provider that trains on the query text cannot be this kit's silent default; it can be an opt-in the operator chooses knowingly |
| U-8 | What does a Firecrawl `search` actually cost and return, on the current version this machine runs? | The baseline the alternatives are judged against. E-21 read 2 credits per 10 results off the billing page, metered, on 2026-09-20, and the September reading of the same page agreed, and E-21 re-read that same page on 2026-09-20 through the metered transport and found it unchanged; whether that still holds, and what the CLI returns, decides whether a second provider is worth the seam at all | CLOSED | E-21 (the billing docs, the page that owns the rule - cited here since 2026-09-28, when `unknown-closure/secondary-only` showed this closure resting on S rows alone), corroborated by E-13 and E-14: it still holds, six days on and from two vendor pages — 2 credits per 10 results, rounded up, so a 5-result search costs 2 and an 11-result search costs 4; scraping the results is billed separately at 1 credit per page. E-13 adds the error rule: a scrape returning nothing is free, but a 403 or 404 page is delivered and charged. What the CLI returns was settled on this machine rather than from a page, and is recorded in `fetchproof/test/fixtures/firecrawl-search-1.23.3.json`: `{success, data: {web: [...]}, creditsUsed}` — a keyed object, not the array the adapter first assumed. Budget arithmetic for this kit: one plan query at `perQuery: 2` costs 4 Firecrawl credits, against 1 SerpAPI search or 1 Tavily credit for the search half [single-witness: Firecrawl on its own pricing, and replaced by measurement rather than argued away. 854 credits before this session and 841 after, against 13 scraped pages across four collections - exactly one credit per page on the version this machine runs] |
| U-9 | What hourly throughput does SerpAPI's free plan actually allow - E-07's 50 per hour, or the 250 per hour SerpAPI's own account API reported for this account on 2026-09-26? | `FREE_TIER_PER_HOUR = 50` is hard-coded in `lib/research-run.mjs` and reported to the operator as the cap. If the vendor's number is 250, the kit reports a limit five times tighter than the real one, and U-5's closure rests on a figure that has moved | CLOSED | E-25, E-27, and a contradiction recorded rather than averaged. **Documented: 50 per hour.** The pricing page, re-read 2026-09-26, still says "50 throughput per hour" for the Free Plan (E-25), and the FAQ gives the rule that produces it - 20% of plan volume below 1M searches a month (E-27). **Enforced on this account: 250 per hour.** SerpAPI's Account API returned `account_rate_limit_per_hour: 250`, a field E-26 defines as "your account's hourly throughput limit" (docs/measurements/2026-09-26-serpapi-account/account.json; not a ledger capture, because the request URL carries the key). Trusted for the kit: neither as a constant. The documented figure is a floor the vendor promises; the account figure is what the vendor's own meter reports for this account and may differ per account. The kit should report the account's value when it can read it (U-11) and fall back to the documented 50, labelled as the documented plan figure [single-witness: SerpAPI on its own limits, in two documents and one API response - there is no third party who knows what SerpAPI enforces] |
| U-10 | Does SerpAPI's monthly allowance reset on the calendar month or on the account's billing cycle? | `searchUsage` counts "this month" from the 1st (UTC). The account API reported `plan_renewal_date: 2026-10-14` on 2026-09-26, which suggests a cycle anchored to sign-up - in which case the kit's month is wrong for most of every month | CLOSED | E-27: the billing cycle. "Your monthly subscription restarts with your monthly allowance of successful search credits on the first day of your billing cycle's subscription." This account renews on 2026-10-14 (E-26's `plan_renewal_date`), so from the 1st to the 13th of every month the kit's calendar-month count mixes two cycles. The kit cannot know an account's cycle from its own log; the Account API reports `plan_renewal_date` and `this_month_usage` directly (E-26) [single-witness: SerpAPI's own FAQ on its own billing] |
| U-11 | Does SerpAPI document an account endpoint that reports searches left, and is calling it free - not counted against the allowance? | The kit's search meter is counted locally and says so: it cannot see searches made from another machine. If the vendor exposes its own counter at no cost, the kit can report the vendor's number instead of a local estimate | CLOSED | E-26: yes. `GET https://serpapi.com/account.json` is documented, and "Account API is free of charge, and using it will not be counted toward your monthly quota." It returns searches used this cycle, searches left, the renewal date, and the account's hourly limit. Observed consistent on 2026-09-26: `this_month_usage` rose by exactly the two fresh searches of the collection run, while two cached repeats and several account calls added nothing (E-09, E-27) [single-witness: SerpAPI documenting its own endpoint] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in the table above.

1. Should the machine-wide commit gate be installed, given that it will gate every
   repository on this box - including this one - and that `research/GATE_OFF` is the only
   per-project opt-out besides `git commit --no-verify`?
2. Is the free Firecrawl tier the budget to design against, or is a paid plan expected
   later? The default `--depth` tiers are tuned for roughly 1,000 credits.

## Already decided

Locked decisions for this project. Do not revisit these without the human.

- Evidence must be *fetched*, not typed: every citation resolves through the hash-chained
  `research/raw/.fetches.jsonl`, written only by the collector.
- The gate fails **open** and loudly by default, because a broken gate that blocks every
  commit on the machine is worse than no gate. `--fail-closed` inverts that deliberately.
- Overrides are `git commit --no-verify`, a deliberate `research/GATE_OFF`, and a
  repository-local `core.hooksPath` (silent by nature; detected by `doctor.mjs` and
  preflight), all recorded in `research/overrides.log` and counted by `doctor.mjs`.
  The third was added when the local-override path was found in 2026-09-13's
  hardening pass; it was always possible, it just had no detection.
- The commit gate lives in a machine-wide `core.hooksPath` rather than per-repository
  hooks, so a new project inherits it with no setup step to forget.
- Research supporting a repository-level architectural decision lives in a self-contained
  project at `docs/decisions/<date>-<decision-name>/`, committed with its ledger, and is
  verified with that directory as the working directory. Scratch projects stay legitimate
  for experiments; their findings cannot support a committed decision unless the corpus and
  ledger are preserved. ADR-0030, written after a scratch project holding nine captures was
  deleted as routine cleanup. **This contract does not cover those decisions** — it
  enumerates U-1..U-8 about transports and vendors, and a second topic in it would have
  `unknown-closure` and `subtopic-coverage` judging two unrelated sets of claims together.

## The corroboration pass stopped here, deliberately - 2026-09-21

Four corpora were corroborated; this one was examined and mostly **left alone**. The reason
is not budget - 841 credits remained - it is that the second sources available here would
have made the corpus worse.

### Why these seven resist corroboration

They divide into two kinds, and neither has an independent witness:

**Vendor claims about the vendor's own product** (U-1, U-4, U-5, U-6, U-8). What the free
Firecrawl tier allows, what SerpAPI's terms permit, what a search costs. Nobody but Firecrawl
can say what Firecrawl charges. The available "second sources" are third-party comparison
posts and SEO pages, which are frequently stale and sometimes simply wrong - citing one would
raise the row count while **lowering** the evidence quality, and this repository has already
recorded what that looks like when a stale mirror scores `independent` (ADR-0036).

There is a subtler trap here and it is worth naming: `docs.firecrawl.dev` and
`www.firecrawl.dev` are different **hosts**. Citing both would flip `one-voice` to
`independent` on the host count alone, while remaining one company describing itself. That is
the check's known blind spot, and using it deliberately to clear a warning would be gaming
the gate rather than strengthening the corpus.

**Claims about THIS machine** (U-2, U-3). Which skill root the desktop app discovers here,
whether a `PreToolUse` hook blocks an edit on this Windows build. No page on the internet
knows. These were established by running them, and re-running them is the only thing that
could confirm them.

### What was done instead: the cost claim was measured

U-8 asks what a Firecrawl operation actually costs. Measured across this session's four
collections, by balance delta rather than by reading the pricing page:

| | credits |
|---|---|
| balance before | 854 |
| balance after | 841 |
| spent | **13** |
| pages scraped | **13** (sea-assets 2, delivery 7, agent-interface 3, public-run-visibility 1) |

**Exactly one credit per scraped page, over thirteen scrapes on the version this machine
runs.** That is a stronger answer to U-8 than a second pricing page, because it is the thing
itself rather than a description of it - and it is what ADR-0035 means by measured rather than
asserted.

Not filed as an evidence row, for the reason now recorded in four corpora: a measurement is
not a fetched page, and `unknown-closure/no-evidence` exists to refuse that substitution.

### So the warnings stand, and they are correct

Seven `corroboration` findings remain here and every one of them is true: these claims do rest
on one reading, or on one voice. What the pass established is that **the remedy is not
available**, which is a different state from "nobody looked" - and the difference is exactly
what the sea-assets corpus got wrong before its second look.
