# Brief - Node.js build-sea option single executable application without postject

_Auto-drafted 2026-09-29 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## Intent

ADR-0031 **rejected** the local Windows `.exe` on 2026-09-21 - on scope, not on difficulty.
The operator decided it is not wanted now that the agent path reaches the collector without
a terminal. That decision is not reopened here and this project does not ask for it to be.

What this asks is narrower and is the thing the ADR promised would stay cheap: **if it is
ever reopened, what does it cost?** ADR-0031 records the answer as of yesterday - an
asset-aware branch in three modules, at Stability 1.1. This checks whether the packaging
half of that estimate is still current.

"Done" is a yes or no: is the postject step - an external tool the kit would have to install,
pin and trust - still required to produce a binary?

## What we verified

| Claim | Source | Type |
|---|---|---|
| **The postject step is gone, and the page dates it.** "Added built-in single executable application generation via the CLI flag `--build-sea`", under **v25.5.0**, with a dedicated section "Generating single executable applications with `--build-sea`" and the invocation `node --build-sea sea-config.json`. So producing a binary no longer needs an external injector installed and pinned alongside Node. Graded P; it is the same page E-01 of the sea-assets corpus cites, re-fetched today for a different question. | E-01 `nodejs.org` (U-1) | P |

## Contradictions and how they were resolved

None. The only source is Node's own SEA documentation, which dates the change in its
changelog.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**Written retroactively on 2026-09-29.** The finding was recorded on 2026-09-22 as a cost
update in ADR-0031.

- **Answer:** no. Since Node v25.5.0, `node --build-sea sea-config.json` produces the binary
  itself, so the external `postject` injector no longer has to be installed, pinned and
  trusted.
- **The `.exe` stays rejected on scope** (ADR-0031). What changed is that the reopening
  estimate is cheaper.
- **Out of scope:** building it. Nothing is to be built from this brief unless ADR-0031's
  rejection is reopened.

## Next steps

1. Read the Decision above; it records what was already decided, and when.
2. Hand this file to the builder (phase 2). Re-running `node /home/user/Fetchproof/fetchproof/bin/brief.mjs`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=9551583c24d1302b inputs=5fb9112dee142c8d gate=pass -->
