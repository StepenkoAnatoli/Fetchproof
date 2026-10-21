# Discovery Contract - Can Fetchproof ship as a Windows .exe yet?

Started 2026-09-21.

## Build intent

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

## Unknowns

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-1 | Is there a way to bundle and read assets in a SEA that does NOT use `useVfs`? | If not, the `.exe` waits on a 1.0 feature. If so, the deferral rested on a false premise | CLOSED | E-01: yes. An `assets` key in the SEA configuration bundles files at build time - "Node.js would read the assets from the specified paths and bundle them into the preparation blob" - and `sea.getAsset()`, `sea.getAssetAsBlob()`, `sea.getRawAsset()` and `sea.getAssetKeys()` read them back. No `useVfs` involved. **Corroborated by E-04**, the 2023-11-29 pull request that proposed the API in the same words nodejs.org now uses - a different host, document and author, and it dates the API two years before the VFS existed |
| U-2 | What stability does that path carry, against the 1.0 the ADR cited? | The whole deferral is a stability judgement | CLOSED | E-01: the page carries **Stability 1.1 - Active development** at its head, and `1.0 - Early development` appears exactly ONCE on it, under the heading "Virtual file system (VFS) for assets". The assets API itself carries no separate marker, so it sits at the feature's 1.1. `useVfs` is the exception, not the rule. **Corroborated by E-05**, the VFS pull request opened 2026-01-22, which shows the VFS as a flag bolted beside the existing mechanism - explaining why the one 1.0 marker sits under that heading and nowhere else. The marker itself has no second witness and cannot: it is Node's statement about Node |

## A premise checked against this repository, not collected

U-3 was originally written as an unknown - "does the kit actually need to read
non-JavaScript files at runtime?" - and the gate was right to refuse it. It is not a
research question. No page on the internet can answer it, and the answer is in this
repository:

- `lib/scaffold.mjs` reads from `TEMPLATE_DIR`
- `lib/decompose.mjs` reads from `RECIPE_DIR`
- `lib/artifact-validator.mjs` reads `schemas/artifact-manifest.schema.json`

Three sets of non-JavaScript assets, all read at runtime. So the premise that a Fetchproof
`.exe` needs bundled assets is sound. The premise that it needs `useVfs` is what U-1 tests,
and that one genuinely required collection.

**Recorded because the gate caught it.** A CLOSED unknown citing no E-## row failed
`unknown-closure/no-evidence`, which is the check doing its job on its own authors: a claim
verified by reading local source is not a claim supported by the corpus, and merging the two
would have made the corpus look broader than it is.

## Questions for the human (maximum 3)

1. ~~Is a Windows `.exe` still wanted~~ **ANSWERED 2026-09-21: no.** Rejected on scope by the operator; ADR-0031 records it. Original question kept as asked: Is a Windows `.exe` still wanted now that the agent path exists? The MCP server and
   `collect-remote.mjs` reach the collector without one, and the `.exe` was argued for a
   person who does not use a terminal rather than for an agent.

## Already decided

- Whatever ships, the artifact contract does not change. A corpus produced by an `.exe` is
  `HUMAN_REVIEW_REQUIRED` exactly as one produced by a runner is (ADR-0032).
