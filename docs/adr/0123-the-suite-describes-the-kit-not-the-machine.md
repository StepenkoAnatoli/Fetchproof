# ADR-0123: The suite describes the kit, not the machine it runs on

Date: 2026-10-02
Status: accepted

## Context

Every test runs offline, with no key and no credits. Until now that sentence was about
what the suite *spends*; it said nothing about what the suite *reads*. A test that spawns a
kit command inherited the operator's environment, and the kit reads that environment the
way it is meant to: the machine config under `~/.agents/fetchproof.config.json`, a
deployed kit beside it, the Firecrawl CLI's own login under `~/.config`, every
`FETCHPROOF_*` variable, the vendor keys.

So the suite's verdict depended on the machine. Measured on 2026-10-02 (break-test), with
the suite run under a scratch home holding one machine config at a time:

| config in the scratch home | red tests |
|---|---|
| `{}` (none) | 2 - `cli`: the FR-5 "no key, one provider" tests |
| `{ "role": "builder" }` | 7 |
| `{ "evidencePolicy": "strict", "failOpen": false, "editGate": { "mode": "hard-block" } }` | 18 - `gate`, `preflight`, `cli`, `artifact-cli`, `index-gate` |
| `{ "searchTransport": "searxng", ... }` | 10 |
| not JSON | 7 |

And with `FETCHPROOF_HOME`, `FETCHPROOF_CONFIG`, `FETCHPROOF_INSTALL_STATE` and
`FETCHPROOF_EDIT_GATE_SETTINGS` exported and pointing nowhere: 18 red in `doctor` and
`machine`.

The two FR-5 failures are the sharpest case. The container this was found in carries
`{ "transport": "http-keyless" }` in its real home, which made both tests pass; without
it, the Firecrawl CLI installed here and not logged in selects `firecrawl-cli-anonymous`
for fetching and `http-keyless` for searching - two providers, two meters - and the tests
that say "with no key there is one" go red. They had been green here for weeks for a
reason that had nothing to do with the kit, and they are red on every machine whose
operator installed the CLI and has not yet logged in.

## Decision

`bin/selftest.mjs` isolates the run before the first test:

- every `FETCHPROOF_*` variable is removed, except the ones that describe the host or
  this run rather than the operator's setup - `FETCHPROOF_RESULT_FILE` and
  `FETCHPROOF_ALLOW_UNSUP` (this runner's own), `FETCHPROOF_BROWSER` (where the
  operator's Chromium is), `FETCHPROOF_GATE_TIMEOUT`, the live-test opt-ins
  (`FETCHPROOF_LIVE*`, `FETCHPROOF_COLLECTION_ENV`) and the harness's own
  `FETCHPROOF_TEST_*` seams;
- `FIRECRAWL_API_KEY`, `SERPAPI_API_KEY` and `TAVILY_API_KEY` are removed;
- `HOME` and `USERPROFILE` (and `APPDATA`, `LOCALAPPDATA` on Windows) point at a scratch
  folder made for the run, so no machine config, deployed kit, CLI login or browser
  profile of the operator's is read.

A test that wants a machine config, a deployed kit or a key makes its own, as the install
and doctor tests already do. A test whose premise is a host *without* a program builds the
`PATH` it needs: the FR-5 tests run under the folder git lives in and nothing else
(`pathWithoutFirecrawl`), and say so as unsupported where the CLI shares that folder.

`PATH`, `TMPDIR` and the proxy variables stay: they are how the host is found, and the
suite is meant to run on the host it is given.

## Rejected

- **Per-test isolation only.** Every spawning helper would carry the same five lines, and
  the next test written without them would read the machine again; the measured leak was
  already across six files. The runner is the one place every test passes through.
- **`FETCHPROOF_CONFIG` pointed at an absent file for the whole run.** It wins over the
  home-derived path, so a test that sets `HOME` to a scratch folder and expects the config
  under it would be overridden; a scratch home isolates the same thing without a
  precedence trap.
- **Documenting the host requirements instead** ("run the suite with no machine config").
  A requirement nobody checks is the false green this kit exists to prevent.
- **Stripping `FETCHPROOF_BROWSER` too.** It names where the operator's Chromium is; the
  LIVE browser tests would become unsupported on exactly the machines that set it.

## Consequences

- The suite's verdict is the same on a collector with a logged-in CLI, a builder, and a
  fresh machine. CI, which has no config, no key and no CLI, is unchanged.
- The FR-5 tests describe the "no CLI" state explicitly; the "installed, not logged in"
  state is the kit's documented behaviour (ADR-0040, T1), not a test premise.
- A test that needs the real home must say so by name; none does today.
