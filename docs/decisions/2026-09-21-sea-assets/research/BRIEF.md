# Brief - Node.js single executable application bundling assets getAsset stability without virtual file system

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

ADR-0031 deferred the local Windows `.exe` with a dated trigger: "Revisit when that reaches
1.1, or if artifact download proves too awkward in practice." The "that" was `useVfs`,
Node's virtual file system for single-executable assets, which the ADR asserted was "the
part the kit would actually need".

This tests the premise as well as the trigger. The kit reads three sets of non-JavaScript
files at runtime - `template/`, `recipes/` and `schemas/` - so it does need bundled assets.
Whether it needs them through `useVfs` specifically is a different question, and the ADR
assumed rather than checked.

"Done" is a yes or no a builder can act on: is there a path to a `.exe` that does not
depend on a Stability 1.0 feature?

## What we verified

| Claim | Source | Type |
|---|---|---|
| **The deferral in ADR-0031 rested on a false premise, and this page says so plainly.** Assets can be bundled without `useVfs`: "Users can include assets by adding a key-path dictionary to the configuration as the `assets` field. At build time, Node.js would read the assets from the specified paths and bundle them into the preparation blob", retrieved in the executable through `sea.getAsset()`, `sea.getAssetAsBlob()`, `sea.getRawAsset()` and `sea.getAssetKeys()`. **The stability picture is the finding.** The page carries "Stability: 1.1 - Active development" at its head, and `1.0 - Early development` appears exactly once in the whole document - under "Virtual file system (VFS) for assets", added in v26.9.0. The assets API carries no separate marker and therefore sits at the feature's 1.1. So `useVfs` is a CONVENIENCE - it lets existing `node:fs` calls keep working unchanged - and not the only route. A kit willing to branch on `sea.isSea()` and call `getAsset()` reaches its templates, recipes and schemas at 1.1 throughout. Documents Node.js v26.9.0. | E-01 `nodejs.org` (U-1, U-2) | P |

## Contradictions and how they were resolved

None between sources. The contradiction was with ADR-0031's own text.

- **The ADR said:** the kit "would actually need" `useVfs`, which is at Stability 1.0.
- **The Node SEA page says:** the `assets` configuration key and `sea.getAsset()` bundle and
  read files without it, at the feature's own 1.1.
- **Which to trust:** the page (E-01), because it owns the API.
- **Where the ADR's claim came from:** an inference sitting next to a citation, not something
  any row said.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**Written retroactively on 2026-09-29.** The decision was taken on 2026-09-21 and recorded as
an amendment to ADR-0031. That amendment cites this file, which did not exist until now.

- **The trigger is withdrawn.** ADR-0031 had deferred the `.exe` until `useVfs` reached 1.1.
  The kit never depended on `useVfs`.
- **The cost of reopening:**
  - an asset-aware branch in the three modules that read non-JavaScript files at runtime:
    `lib/scaffold.mjs`, `lib/decompose.mjs` and `lib/artifact-validator.mjs`;
  - reading those files through `sea.getAsset()`, at Stability 1.1.
- **Outcome:** the `.exe` was then rejected on scope, not stability. That was the operator's
  call, in ADR-0031. Nothing is to be built from this brief unless that decision is reopened.
  If it is, the route above needs no further research.

## Next steps

1. Read the Decision above; it records what was already decided, and when.
2. Hand this file to the builder (phase 2). Re-running `node /home/user/Fetchproof/fetchproof/bin/brief.mjs`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=c964967ac546cc94 inputs=8396e972c50be385 gate=pass -->
