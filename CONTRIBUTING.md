# Contributing to Fetchproof

Thanks for helping make research easier to inspect and hand off. Bug fixes,
documentation, useful regressions and vendor compatibility updates are welcome.
The kit is feature-frozen; new commands, flags, formats, providers or checks need an
ADR that lifts the freeze for that item ([ADR-0117](docs/adr/0117-feature-freeze-from-0-9-0.md)).

Read [AGENTS.md](AGENTS.md) before changing the repository. Its standing protocol
applies to both people and agents. Use the [architecture map](docs/ARCHITECTURE.md)
to find the module that owns the behavior, and the [documentation map](docs/README.md)
to find the relevant guide or decision.

## Find a task

- [Good first issues](https://github.com/StepenkoAnatoli/Fetchproof/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
  are small, well-defined tasks with a clear way to verify the result.
- [Help wanted](https://github.com/StepenkoAnatoli/Fetchproof/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22)
  marks tasks where another contributor would help.
- [Bugs](https://github.com/StepenkoAnatoli/Fetchproof/issues?q=is%3Aissue%20is%3Aopen%20label%3Abug)
  and [documentation issues](https://github.com/StepenkoAnatoli/Fetchproof/issues?q=is%3Aissue%20is%3Aopen%20label%3Adocumentation)
  identify the kind of change.

Check for an existing fix PR before starting. A short comment on the issue helps
others avoid doing the same work. A good bug report includes the command, working
directory, Node and Git versions, expected behavior, actual output and a minimal
reproduction. Use disposable fixtures and remove credentials from the report.

## Set up a checkout

Use Node **22.22.1+ or 24+**, Git, and Python **3.11+** for the cross-language
conformance tests. See [requirements](README.md#requirements) and
[supported platforms](README.md#supported-platforms) for the maintained scope.
The kit uses plain Node with no package install step.

Fork the repository, clone your fork, and create a branch for one task:

```sh
git clone https://github.com/YOUR-USERNAME/Fetchproof.git
cd Fetchproof
git switch -c fix/describe-the-defect
node fetchproof/bin/handoff.mjs
node fetchproof/bin/preflight.mjs
node fetchproof/bin/doctor.mjs
```

Run these commands from the checkout you intend to change. Handoff checks the
received corpus, preflight checks its declared contract, and doctor describes the
actual machine configuration. Record the actual verdict and chosen transport.
If the existing corpus fails, follow the named remedy before building; preserve
`research/raw/` and its `.fetches.jsonl` ledger. Do not rewrite captured evidence
or recollect it to hide a checkout or line-ending problem.

## Make and verify the change

For a bug fix, first add a regression that reproduces the defect. Run the relevant
test groups, fix the behavior, then rerun those groups. Group arguments match test
file names; for example:

```sh
node fetchproof/bin/selftest.mjs machine panel
node fetchproof/bin/selftest.mjs
node fetchproof/bin/preflight.mjs
node fetchproof/bin/handoff.mjs
node fetchproof/bin/doctor.mjs
git diff --check
```

The offline suite needs no vendor key or paid collection. Tests that exercise a
local browser need Chromium or Chrome; the suite reports unavailable capabilities
as `UNSUP`, with their reason. Include unsupported results when reporting a run.
The full suite can take around 25–30 minutes on a Windows PC. The normal commit
gate runs it when a commit touches `fetchproof/`; let that gate finish.

A red suite stops work. Record the failing test and working directory, then fix
or explain the failure before continuing. Do not bypass the hooks to publish a
fix that has not passed its required checks.

Keep these records with the change:

- Update `docs/ARCHITECTURE.md` in the same commit as a declared code-path change.
- Update the registered test count in `fetchproof/README.md` when adding or
  removing tests, and describe the user-visible fix under `Unreleased` in
  `CHANGELOG.md`.
- Record a behavior decision with a rejected alternative in an ADR. An obvious
  bug remedy, test mechanics or wording correction can use the commit report.
  Research about the kit itself belongs in a nested decision project, as
  [AGENTS.md](AGENTS.md) explains.

## Write a useful commit and PR

Keep one commit per independently revertible task. Use a specific subject such
as `fix(artifact): reject conflicting ZIP paths` or
`docs: explain the contributor verification workflow`.

The commit or accompanying report carries the five named parts below. Describe
what another reviewer needs to know, including the commands actually run:

```text
what changed: the modules and resulting behavior
why: the reproduced defect or documentation gap
what it touched: files, architecture rows and decisions
what you verified: verified / untested / expected, with commands and results
what you got wrong and fixed: nothing to report, or the correction record
```

For a correction, use the six fields **mistake**, **where**, **impact**, **cause**,
**fix** and **verified**. The shorter report allowed for documentation and tests
is described in the standing protocol in [AGENTS.md](AGENTS.md).

Open the PR against `main`. Link its issue with `Fixes #NUMBER`, explain the
before/after behavior, and include relevant verification and any remaining
limitations. Wait for the required CI jobs and respond to review comments.

## GitHub Actions

[offline-suite](https://github.com/StepenkoAnatoli/Fetchproof/actions/workflows/offline-suite.yml)
runs on pull requests and `main` pushes. It checks Linux and Windows, supported
Node lines, cross-language conformance, the root preflight, archive behavior and
whether verification leaves the checkout clean. Its `suite` job summarizes the
required results.

[action-pins](https://github.com/StepenkoAnatoli/Fetchproof/actions/workflows/action-pins.yml)
checks pinned third-party actions weekly and on relevant workflow changes.
The collector and live-collection workflows have separate purposes and may spend
credits; they are documented in the [collector guide](README.md#run-the-collector-on-github).

## License and evidence

Repository code, tests and documentation use the
[PolyForm Shield License 1.0.0](LICENSE). Cached third-party pages have separate
rights and attribution described in [NOTICE](NOTICE). Preserve the required
notices and the evidence provenance when contributing.
