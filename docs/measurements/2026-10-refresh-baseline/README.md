# Refresh baseline: what the gate says about every corpus, before the quote-level refresh

**Status: baseline taken at `ab2e605` (2026-10-25), the commit the quote-level refresh run
starts from.** Plan: `fetchproof-reasoning-layer-plan-2.md` v0.4, §4.2-4.3 (requirements
R-05, R-06 of `docs/orchestration/2026-10-25-quote-level-refresh/`).

## Why it exists

Every later change in this run to the quote matcher or the gate - B1 (the too-short floor
measured on the compared text), B2 (spacing before closing punctuation), the quote-level
refresh recheck, a refreshed page that is gone - must either reproduce this baseline or list
what moved. The suite cannot say that: it judges fixtures, which are corpora written to pass.
This judges the corpora that were collected for real. The method - a frozen table of anchors,
re-run after each matcher change, printing every anchor whose result changed in each
direction - is Testimonium's (github.com/noahogbi/testimonium, MIT), re-implemented from the
plan's description; no code or fixture was copied.

## What was measured

Every corpus in the index (`git ls-files '*research/EVIDENCE.md'`): the root `research/` and
the 40 nested decision projects under `docs/decisions/`. `fetchproof/template/` is listed by
that command too and is left out: it is the scaffold `new-project.mjs` copies, with an empty
evidence table, not a corpus.

| File | One record per | Holds |
|---|---|---|
| `summary.json` | the run | the commit measured, whether the library and corpora were clean, the counts below, the exclusion list |
| `verdicts.json` | corpus | rows, quoted rows, anchors, unreadable markers, the verdict, and each finding's check, rule, severity and row (or file, or superseded/by) |
| `anchors.json` | `[quote: ...]` anchor | corpus, row, anchor index, quote, capture, `tooShort`, `found`, and `status` - the gate's outcome |
| `superseded.json` | refresh (`supersededRows` pair) | old row, new row, both captures, the unknowns citing the old row, and each old anchor's `tooShort` and `foundInNew` |

- **`found`** is computed exactly as the `citations` check computes it: the row's capture by
  `captureOf`, its body by `parseCapture`, `anchorFound` over the anchor's fragments. It is
  computed for a too-short quote as well, which the gate does not compare, so that a floor
  change shows what the quote would then be. It is `null` when the row has no capture on disk.
- **`status`** is what the gate says: `found`, `not-found`, `quote-too-short`, `no-capture`
  or `capture-not-on-disk`.
- **The verdict** is `runPreflight`'s, in process, with the machine pinned: `evidencePolicy`
  and `maxAgeDays` are the kit's defaults (`pluralist`, 180) and the local `core.hooksPath` is
  taken as unset, so a strict machine and a pluralist one record the same baseline.
- A finding's prose (`detail`) and line are not recorded: the prose carries ages in days, and
  neither says anything the check, rule and row do not.

## The counts at `ab2e605`

| | |
|---|---|
| corpora | 41 (the brief's 41) |
| evidence rows | 417 (the brief's 417) |
| rows with a `[quote: ...]` | 213 (the brief's 213) |
| anchors in those rows | 517, all `found`; 0 too short; 0 unreadable markers |
| verdicts | 41 PASS |
| superseded pairs | 27, of which 0 carry a quote and 0 are still cited by an unknown |

The plan's 213 is a count of rows; a row can carry more than one quote, which is why the
anchors number 517.

## What is recorded but not compared

Findings whose presence depends on the day or on the machine, not on the corpus and the code:

- `unknown-closure/stale-evidence` - appears when a row passes 180 days; none does yet, and
  the oldest captures (2026-09-13) cross the limit in March 2027.
- `hygiene/future-date` - disappears when the calendar reaches the date.
- `unknown-closure/closure` and `hygiene/hygiene` - the two checks' summary passes, emitted
  only when the check found nothing else, so they follow the two rules above.
- every `gate-integrity` finding - it reads `research/overrides.log` (machine-local, never
  committed) and the clone's `core.hooksPath`.

They stay in `verdicts.json` marked `"excluded"`, and the compared verdict (`comparablePass`)
ignores them; `pass` is the verdict as it was.

## How to run

From any directory (it finds the repository and the library from its own location):

```
node docs/measurements/2026-10-refresh-baseline/movement.mjs            # compare
node docs/measurements/2026-10-refresh-baseline/movement.mjs --write    # regenerate
```

Compare exits 0 with `no movement`, or 1 and one line per movement:

- `anchor <corpus> <row> [<n>]: status found -> quote-too-short; tooShort false -> true  "<quote>"`
- `corpus <corpus>: verdict PASS -> FAIL`, `corpus <corpus>: finding + warn citations/quote-too-short E-02`
- `refresh <corpus> <old row> [<n>]: foundInNew false -> true  "<quote>"`

Exit 2 means the measurement could not be taken (no git, a baseline file missing or not JSON,
an unknown argument); it is never "no movement". A run takes about two and a half minutes on
the operator's Windows PC.

A change that is meant to move the baseline ships with its movement listed in a dated note, and
regenerates the files with `--write` in the same commit, so the next change is measured
against the code it follows.

## What a zero movement does not prove

- **Nothing about rows no corpus contains.** The corpora hold 517 anchors, all found and none
  too short: a matcher change that only alters what happens to a short or a missing quote moves
  nothing here, whatever it does. The misleading-quote suite (plan §6) is where those cases are.
- **Nothing about quoted refreshes: there are none.** Every one of the 27 refreshes replaced a
  row with no quote, and none is still cited, so the recheck (ADR-0193) cannot move a single
  line of `superseded.json` on today's data. Its zero there is by construction (plan §7.6).
- **Nothing about a corpus collected later**, or about a keyless capture of a page these
  corpora hold as a Firecrawl capture: B2 changes captures not yet taken, and this folder only
  re-reads the ones on disk.
- **Nothing about whether a quote supports its claim.** `found` is a string question.
