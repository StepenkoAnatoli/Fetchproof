# ADR-0186 - The kit is renamed Fetchproof, with a clean break

- **Date:** 2026-10-20
- **Status:** accepted
- **Area:** the whole repository: the `fetchproof/` folder (was `research-kit/`), every
  command path, the deployed kit's location, the machine configuration file, the environment
  variables, the package format, the accounting packet, the MCP server name, the HTTP
  User-Agent and the collector's artifact names
- **Order:** the owner, 2026-10-20: "change the name of the repo and all files, change all
  files that says: research-kit into Fetchproof"
- **Freeze (ADR-0117):** lifted for this one item. The rename changes command paths,
  configuration keys, environment variables and format identifiers; it adds no command,
  flag, transport, provider or check, and changes no behavior beyond the names.

## Context

The name Research-Kit described the category, not the product, and could not be told apart
from other research tools. The owner chose Fetchproof, after the shortlist's
alternatives were checked on GitHub, npm, the web, the USPTO trademark search and the Israeli
trademark register on 2026-10-20: no FETCHPROOF mark was found in either register, while
LEADLINE is a live US mark for software (class 42) and SPADE is a live US mark for AI
software. That check covered registered marks only. It is not a legal clearance.

The name was spelled in about 3,000 places: the `research-kit/` folder, `~/.agents/research-kit`
and `~/.agents/research-kit.config.json`, 26 `RESEARCH_KIT_*` environment variables, the
`research-kit-artifact` package format, the `research-kit-accounting` packet of ADR-0149, the
`research-kit-corpus-v1-*` artifacts of `collect.yml`, the GitHub environment variables
`RESEARCH_KIT_COLLECTION_ENV` and `RESEARCH_KIT_LIVE_ENV`, the MCP server name, the User-Agent,
temporary-folder prefixes, and prose across the documentation, the ADRs and the decision projects.

## Decision

1. **One spelling map.** `Research-Kit`, `Research Kit` and `ResearchKit` become `Fetchproof`;
   `research-kit`, `research_kit` and `researchkit` become `fetchproof`; `RESEARCH_KIT_` becomes
   `FETCHPROOF_`; the possessive `Research-Kit's` (and its slug `research-kits-`) becomes
   `Fetchproof's` (`fetchproofs-`). The kit itself, spelled "the research kit" in prose, is
   `Fetchproof`; a generic "a research kit" stays English. A name the kit derives from text
   is derived again from the renamed text, not mapped: the root audits' key and file names are
   the 2026-09-14 writer's slug of the renamed topic (`fetchproofs-own-protocol-metered-primary-sourc`),
   because the kit continues a record of that shape only when that slug matches its key. A
   mapped key (`the-fetchproofs-own-...`) made the next root audit start a second chain at v0.1.
   The old name's initials go too, by the owner's choice of 2026-10-21 ("Rename all of them"):
   a package's ID starts with `FP-` (was `RK-`, in `lib/artifact.mjs` and the manifest schema's
   pattern), the kit's temporary folders and files start with `fp-` (`fp-render-`, `fp-suite-`,
   `fp-artifact-`, the suite's `fp-selftest-`; were `rk-`), and so do the tests' scratch names
   and variables (`FP_*`). Each new spelling is as long as the old one.
2. **Dated records are renamed too**, by the owner's choice: the ADRs, reviews, build reports,
   the CHANGELOG's released entries, the plans and specs, the root audits (their files and their
   index keys) and the prose of every decision project under `docs/decisions/`, except what
   item 3 lists. A brief whose stamped inputs the rename changed (13 decision projects) was
   redrafted with `brief.mjs --force`, and every section of the old brief was carried into it:
   the corpus changed only in names, so each judgement still stands, and the new stamp records
   the renamed inputs.
3. **What is never renamed, because the kit's invariants forbid it:**
   - everything under a corpus's `research/raw/` (captures, sidecars, `.fetches.jsonl`) and the
     file names in it, which the ledger records;
   - inside a corpus, every URL and every `[quote: ...]`: a URL identifies a fetched source and a
     quote must match its capture, so the gate checks both. A run's log keeps the URLs it
     fetched for the same reason (`docs/decisions/collection-357.log`);
   - a file the ledger hashed outside `raw/` (`docs/decisions/2026-09-27-kit-path-spelling/research/PRIOR.md`);
   - the planning documents of the received archive, whose digests `BUNDLE_INDEX.md` records
     (ADR-0028): 44 of them spelled the old name (`RESEARCH_REPORT.md`, ADRs 0001-0021, the
     2026-09-14..16 reviews, plans and specs). ADR-0028 keeps them as records of a past state and
     its test refuses to exempt any; renaming them would mean superseding ADR-0028. The
     unresolved links `BUNDLE_INDEX.md` lists for them keep their `research-kit/` spelling too, so
     the index still says what those documents contain;
   - a link pinned to a commit keeps its path (that commit's tree holds `research-kit/`); only
     its repository segment becomes `StepenkoAnatoli/Fetchproof`;
   - other sites' URLs, and the names other people gave things: Apple's ResearchKit and the
     search results that found it (a decision project's map records that a search for
     "Research-Kit" returned them), the "Meta Museum Provenance Research Kit" result in a
     recorded vendor response used as a fixture (`serpapi-search-2026-09-19.json`, whose query is
     the generic phrase "research kit provenance ledger"), and `references/research-kit.md`, the
     file name the SkillsMDs repository's skills use;
   - a plan input that pairs with pages fetched under the old name (the mcp-registry plan's
     `prefer` entry `raw.githubusercontent.com/StepenkoAnatoli/Research-Kit`), and the makeSlug
     regression input that reproduces the 2026-09-14 audit file names.

   The kit's own copies of those skill files are renamed: `skills/*/references/fetchproof.md`.
   A vendored Apache-2.0 skill file the rename changed says so at its top, and `NOTICE` lists
   them, as the licence asks of a modified file (section 4(b)).
4. **A clean break, by the owner's choice.** No old name is read as a fallback: not the
   `RESEARCH_KIT_*` variables, not `~/.agents/research-kit.config.json`, not the
   `~/.agents/research-kit` install, not the `research-kit-artifact` format, not the
   `research-kit-accounting` packet, not the `research-kit/<name>-v1` schema identifiers (each
   schema's `$id`, and the two an FI sidecar conformance packet names), not the
   `research-kit:brief` markers of a brief. A machine reinstalls; a project edits what an older
   kit wrote into it. The migration steps are in the CHANGELOG.

## Rejected alternatives

- **Keep the old names working** (read `RESEARCH_KIT_*`, the old configuration file and the old
  install path when the new ones are absent; accept both package formats). Offered first; the
  owner chose the clean break. Re-suggest only when the trigger below fires.
- **Leave dated records as written.** Offered first, because they record what was true when they
  were written; the owner chose to rename them. Paths in an old record now name the new folder, and a
  temporary folder an old record counted (ADR-0185's `fp-netlog-*`) has the new prefix too. The
  cleanup command in that CHANGELOG entry is an instruction, not a record, so it names the folders
  as they are on disk, `rk-netlog-*`.
- **Rename the package ID only and keep the internal `rk-` prefixes.** Recommended, because the
  package ID is the only one a user sees; the owner chose to rename all of them.
- **Rename only the display name** and keep the internal identifiers. Rejected: the order was to
  change every file that spells the old name.
- **Rename evidence too.** Rejected without being offered: an edited capture or ledger fails
  the gate by design, and a renamed source URL no longer matches its ledger entry.

## Consequences

- Every existing install has to follow the CHANGELOG's migration steps; until then its commit
  hook, edit hook and skills still run the old kit from `~/.agents/research-kit`.
- The order of those steps matters. `handOnState` knows the kit's own earlier gate by the header
  `fetchproof commit gate` (ADR-0112); the deployed old hook says `research-kit commit gate`, so a
  new install over it would record the old gate as a foreign folder and run it after the new
  one, the two-gate failure of 2026-10-03. The old kit's `install-hooks --uninstall` runs first.
  Recognizing the old header too would be an old name kept working, which the owner declined.
- The install state `~/.agents/research-kit.install.json` holds the hashes of the skills the kit
  deployed. A new install without it judges every changed set skill somebody else's and leaves
  the old copy, so the migration renames that file rather than starting a new one.
- The first commit of this change was judged by the installed old gate. It finds the kit's
  checkout by `research-kit/lib/core.mjs` and its siblings, so it did not recognize this
  checkout and did not run the suite rule (ADR-0120) for that commit. The suite was run by hand
  and in CI instead.
- The repository's GitHub environments need `FETCHPROOF_COLLECTION_ENV` and
  `FETCHPROOF_LIVE_ENV` in place of the old variables, or `collect.yml` and
  `live-collection.yml` refuse at their environment check.

## Trigger

Reopen if an install or project cannot be migrated with the CHANGELOG's steps, or if a
trademark objection to FETCHPROOF is received.
