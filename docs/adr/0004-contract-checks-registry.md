# ADR-0004 — The contract checks are a registry; the verdict stays one function

- **Date:** 2026-09-13
- **Status:** accepted
- **Area:** preflight, gate verdict
- **Refines:** the approved hardening design's "one verdict function, three callers"

## Context

`runPreflight()` was a 233-line function holding four interleaved concerns — Discovery
Contract, citations, provenance, hygiene — all pushing findings into one array. Adding a
check meant editing the monolith, which is exactly the change the hardening plan kept
making: it added five provenance checks in a single pass.

Two symptoms followed from the shape:

- **No way to run one rule.** The only interface was "build a project on disk, run
  everything, fish one finding out of an array", so all 18 preflight tests paid for a temp
  directory, a template copy, a contract, a capture, and a chain.
- **Check names were string literals scattered through the body**, and one was wrong:
  a capture whose front-matter records no `firecrawl` command was reported as
  `timestamp-agreement`, sending anyone debugging it to compare two clocks when the real
  problem was provenance.

## Decision

`fetchproof/lib/checks.mjs` holds the rules as a frozen, ordered registry:

```js
CHECKS = [{ name, about, run(corpus, options) -> findings }]
```

Seven checks, in reporting order: `discovery-contract`, `citations`, `provenance`,
`unknown-closure`, `collection-attempts`, `hygiene`, `corpus-shape`. Each owns one slice of
the corpus snapshot (ADR-0003) and none of them touches the filesystem directly beyond
`exists()` on a path the corpus already resolved.

`runCheck(name, corpus, options)` runs one. `runChecks(corpus, options)` runs all.
`lib/preflight.mjs` shrank to 63 lines and keeps the only judgement that matters: which
findings block, which warn, and whether the answer is PASS.

**Order is part of the interface.** Checks run in declaration order and findings keep their
emission order, so a failure a person must act on precedes a hygiene warning about the same
row. A test pins the order; reordering the registry is a deliberate act, not a side effect.

**Severity stays with the verdict, not the check.** A check returns `pass` / `warn` / `fail`
findings; `runPreflight` decides what that means for the build, including `--strict`
promoting warnings. This keeps a single place where "what blocks a build" is defined.

**`capture-command` replaces `timestamp-agreement`** for the missing-collector-command case.
The clock comparison keeps the old name. Renaming a check is a change to what a failure
reports, so it is recorded here.

**The CLI can address one check**: `preflight.mjs --checks` lists the registry,
`--check <name>` (repeatable) runs a subset. An unknown name is an error naming the known
checks, never a silent pass.

## Consequences

- Adding a check is one entry in a table. The monolith is gone: `lib/preflight.mjs` is now
  smaller than the smallest check.
- A rule can be tested against a corpus fixture: `test/checks.test.mjs` runs each check
  individually (15 tests), while `test/preflight.test.mjs` keeps the whole-project verdict
  tests (17) unchanged in intent.
- `runPreflight` accepts a pre-read `corpus`, so the edit-time gate can share one read
  between the predicate and the verdict instead of paying twice.
- Cost accepted: findings for one evidence row are no longer adjacent in the output —
  citation findings and provenance findings for the same row arrive in separate groups. The
  check name in each line is what ties them together.

## Alternatives considered

- **Data-driven checks with declarative field paths.** More uniform, and worse to read: the
  checks differ enough (a per-row loop, a set difference, a chain walk) that encoding them
  as data would have invented a small language to avoid writing seven functions.
- **Let each check decide severity from config.** Rejected: two places would then define
  what blocks a build, and the single verdict is the property the whole gate rests on.
- **Keep the monolith, extract helpers.** Would have improved readability and left the real
  friction — no way to run or test one rule — exactly where it was.
