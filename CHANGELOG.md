# Changelog

Each release of Research-Kit, newest first. The version is `KIT_VERSION` in
`research-kit/lib/core.mjs`; a release is tagged `v<version>` (ADR-0116).

## Unreleased

- `collect-remote` refuses empty repository, topic, client-ref, prior and prefer
  values by name before creating an output directory or reading a token (#287).
- Invalid `--snapshot-max-age-ms` values are usage errors with exit 2. Library callers
  receive `INPUT-SNAPSHOT-MAX-AGE` / `INCOMPLETE` rather than a false stale-snapshot
  verdict; finite non-negative allowances, including zero, retain their meaning (#343).
- `decompose --limit` consistently requires a whole number of at least 1 before
  transport selection. `--max-scrapes 0` remains supported (#320).
- Auto-collect Git failure diagnostics quote the first `fatal:` or `error:` cause,
  retaining the final-line fallback for output without either marker (#326).
- A leading ledger byte-order mark is tolerated while reading, without changing the
  evidence file or its entry hashes. Tail repair leaves an intact BOM ledger alone
  and preserves the prefix when dropping a torn append. Handoff gives unreadable lines the tail-repair
  or restore-from-git remedy; secondary chain failures no longer imply failed travel
  or lost entries while parsing is unresolved (#296).
- Finding extraction remembers the winning paragraph start and builds its excerpt
  forward only until truncation is established. Long unbroken captures avoid the
  quadratic array insertion while retaining the same finding and excerpt (#334).
- Recipe loading refuses existing files without dimensions and blank dimension labels,
  naming the source and line. Decompose reports invalid recipe content with exit 2
  before writing the map (#356).
- Oversized panel requests receive the intended 413 JSON refusal before the
  connection closes. Overflow discards retained body chunks and later data, while
  a complete JSON body at the existing byte limit remains accepted (#324).

- ZIP archives declare UTF-8 names in both headers, so ordinary extractors preserve non-ASCII paths declared by the package manifest (#345).

- Machine config saves preserve unpatched raw role and posture values, including typos
  that diagnostics must still report. An unreadable config without a usable last-good
  snapshot refuses an unrelated save rather than persisting the restrictive fallback;
  an explicit valid `--role` can repair it. `install-hooks` names the refusal with exit 2
  and the panel key endpoint returns HTTP 409 without echoing the key (#364).

- `path-authority` and `researcher-release` name a value flag with no value and print usage with exit 2 before resolving paths, including when another flag follows (#288).

- `property-replay --all` refuses a missing regression directory with exit 2 and
  names it; an existing empty directory explicitly reports no captured regressions.
  JSON results identify the directory and zero count (#307).

- The legacy approval compatibility regression keeps its historical hash reference
  on the recorded probe date while exercising fresh approval packages, so crossing
  midnight does not invalidate the test's reference assertion.
- FI sidecar conformance accepts array indices after zero in both patch traversal
  and removal; a synthetic two-entry packet pins Node/Python agreement (#337).

- ADR body links are checked by the existing hygiene test, ADR-0121 links resolve,
  and a current guide explains unshipped artifacts named by dated plans (#292).

- GitHub request helpers refuse repository components outside `[A-Za-z0-9._-]+`,
  including `.` and `..`, before any request is made (#379). Query/fragment
  delimiters, encoded separators, whitespace and control characters cannot alter
  the API path.

- Each collection query and URL is refused when it contains CR or LF before trimming
  or joining into workflow input (#376). MCP and `collect-remote` cannot turn one
  declared item into extra searches or page fetches on the runner.

- Rejected collection URLs pass through the existing credential redactor before
  MCP tool results or `collect-remote` stderr can echo them (#378). Regression
  coverage includes caller credentials in URL userinfo and query parameters.

- Dispatch responses with a successful HTTP status and a non-JSON body now report
  `BAD_BODY`, with the existing proxy/maintenance-page remedy (#377). `NO_RUN_ID`
  remains reserved for JSON responses without an integer workflow run ID.

- Proxy URLs containing a non-root path, query or fragment take the existing
  invalid-proxy path rather than enabling Node proxy support and crashing in
  Undici (#380). Requests remain direct, the existing diagnostic names the
  variable and accepted spelling, and `doctor` warns. A bare trailing slash stays
  valid.

- `doctor` warns when an explicit Node startup choice leaves a configured proxy
  off (#381): `NODE_USE_ENV_PROXY` accepts only `1`, and `--no-use-env-proxy`
  disables it. The diagnostic shares the runtime choice reader and respects
  command-line flag precedence over `NODE_OPTIONS` and the environment variable;
  it never overrules the operator or echoes the variable value.

- Machine config snapshots accept only non-array JSON objects (#368). Scalar or
  array configs cannot create or replace a good snapshot; unreadable configs with
  unusable backups fall back to fail-closed and role unknown.

- MCP collect and collect-remote refuse unsafe client references before dispatch
  (#375), using the existing shared identifier rule. The CLI also refuses a bare
  --client-ref, and the checker rejects trailing line breaks.

- Corpus download folders resolve to absolute paths before writes and links (#372),
  so relative MCP out_dir values return a link to the file actually saved.

- MCP fetch_corpus renders non-PASS validation findings and remedies in its text
  result and omits the resource link instead of describing corrupt or unsupported
  downloads as a collected corpus awaiting review (#371).

- Fetch and search registries refuse inherited object members as provider names
  at every precedence level (#349), before a run or doctor can treat them as adapters.

- Timeline details fold multiline errors into one table row before pipe escaping
  (#354). Regenerated the root timeline without changing its provenance ledger.

- Scoped hooksPath reads expand Git include and includeIf directives, preserving the previous hooks folder through installation and removal (#369).

- selftest refuses each unmatched group before starting tests, including when another requested group matches (#332).

- Default corpus downloads use a fresh private temp folder and refuse symlinks at the package filename, preventing shared-name overwrites and redirected writes (#373).

- Install-state reads reject non-object records and ill-typed paths; doctor reports a named deploy warning instead of a raw path stack (#365).

- Artifact ledger checks follow actual capture entries and evidence rows, even when the manifest relabels captures and declares zero; genuinely empty failed-collection scaffolds remain valid (#358).

- Evidence context refuses Raw cells outside research/raw and names directories before reading; the ADR-0109 trigger also moves corpus and artifact recorded-path readers to projectFile (#351).

- Artifact validation no longer trusts an `APPROVED_BRIEF` manifest by itself (#357, ADR-0160). It re-derives approval from checked package contents with a portable baseline, preserves false claims, and accepts only verified format-1 pre-0069 stamp hashes.

- GitHub rate-limited 403 responses from dispatch and run reads report the wait and reset time instead of a token-permission remedy (#374).

- Broken machine-config diagnostics name the actual config and distinguish settings held by a last-good snapshot from fail-closed fallback (#366).

- Missing, malformed and below-oldest artifact format versions are invalid manifests; only newer numeric majors receive the upgrade remedy (#361).

- The artifact CLI drains stdout and stderr before ending its reports, preserving large piped JSON and text results on POSIX (#359).

- Artifact validation hides malformed manifest metadata and escapes control characters in text diagnostics, so package-supplied strings cannot forge verdict lines (#360).

- `artifact validate` rejects ZIP entries where a file is also an ancestor directory of another entry, before extraction, with a stable `ZIP-PATH-COLLISION` failure (#362).

- The README opens with an accessible workflow preview and linked CI, license,
  last-commit and stars badges. A contributor guide explains setup, verification,
  issue labels and the existing commit/PR protocol.
- Fixed `AGENTS.md` corpus description to use evergreen relative references rather than stale hardcoded entry counts (#299).

- The suite's "every CLI refuses a flag it does not know" table now covers `measure`,
  `export-warc`, `artifact` and `panel`, and fails by name when a file under `bin/` calls
  `refuseUnknownFlags` without a row (#271). Tests only; no CLI changed.

- `doctor` reports Node 22.13.0 through 22.22.0 as a failing Node line (#282, ADR-0159):
  those builds' `TextDecoder` reads `windows-1252` as Latin-1 (nodejs/node#60888), so a
  page's euro signs, curly quotes and dashes were captured as control characters with no
  warning, and the suite's G7 decoding tests went red on them. The finding names the
  defect and the first good build; the README's requirement is now Node 22.22.1+ or 24+.
  The hard floor every command refuses below stays at 22. Measured 2026-10-11: 22.12.0
  right, 22.13.0 to 22.22.0 wrong, 22.22.1 onward right.

- `artifact create` and `artifact validate` refuse a value flag given no value (`--<name>
  needs a value`, exit 3) before anything is read or written (#280). The flag parser reads
  a bare flag as `true`, and `create` only asked whether a required flag was present: a
  bare `--ref` went into the manifest as the string "true", a bare `--run-id` as 1, a bare
  `--output` wrote a package literally named `true`, and the package re-validated PASS. A
  bare `--file` on `validate` tried to open a file called `true`. Every value flag of both
  commands now goes through `checkFlagValues`; `--run-id` and `--run-attempt` are also
  refused by name when not a whole number of at least 1, where `writeArtifact` had refused
  them later with its own wording.

- `collect-remote --out`, `--workflow` and `--ref` given no value are refused (`--<name>
  needs a value`, exit 3) before anything is created or dispatched (#270). The flag parser
  reads a bare flag as `true`, and these three were not among the checked values: a bare
  `--out` became the folder `true`, created in the working directory before the token was
  even asked for, and with a token a bare `--workflow` or `--ref` would have dispatched a
  run against the literal file or branch "true". They now go through `checkFlagValues`
  with the five values the workflow checks.

- `decompose --max-scrapes` and `--limit` given no value are refused (`--<name> needs a
  value`) instead of becoming 1: the flag parser reads a bare flag as `true`, and the
  CLI's own `Number()` check let it through, so `--dry-run --max-scrapes` reported "scrape
  up to 1" and a real run paid for a page nobody asked for (#269). Both flags now go
  through `checkFlagValues` with the other value flags; a non-number such as `--limit abc`
  is still refused, now as "must be a whole number of at least 0".

- The `browserPath` machine-config key is read. The browser transport's errors and ADR-0088
  name it, but the config was loaded and saved without it: a fetch through the collector
  never consulted it, and any save, `install-hooks --role` among them, erased a value set
  by hand. `scrape` and `status` called without a config now read the machine's.

- `researcher-release validate --genesis` and `--checkpoints` are verified. Both were
  advertised and parsed, but `validateRelease` had no parameters for them, so they were
  dropped before the ledger check and an operator who supplied a signed genesis believed it
  was checked. Each must now exist below the record root, as `--ledger` and `--head` must,
  and either one without `--ledger` is refused as INCOMPLETE instead of ignored.

- Under an explicit refusal of this machine's network (`allowInternalRedirects: false`,
  or `RESEARCH_KIT_ALLOW_INTERNAL_REDIRECTS=0`) a name asked for is now judged by what it
  resolves to - at the browser guard even when it is the page's own host, and before any
  fetch or browser launch - so a resolver cannot turn the page asked for into this
  machine's network (ADR-0155). A literal address the caller spelled out, and the default
  policy for a URL the operator typed, are unchanged (ADR-0110).

- Three decisions recorded, no code changed: direct internal access keeps ADR-0110's
  default, with ADR-0155's trigger for reopening it (ADR-0156); the PR #266 queue's
  conditional feature and ranking work stays held until the ADR-0145 comparison reports
  (ADR-0157); the small-core extraction the 2026-10-10 audit sketched stays a proposal
  until those results and a measured dependency review exist (ADR-0158). The suite covers
  ADR-0155's literal-address rule across every internal range without sending a packet
  into one (inventory 1786).

- QUICKSTART names the applicable trusted-PEM `NODE_EXTRA_CA_CERTS` remedy before
  starting Node on a network with TLS inspection, with missing/malformed-file warnings,
  setuid/Linux-capability and explicit TLS/HTTPS `ca` limits (break-test evidence
  E-03/E-06). A client setting does not configure a remote collector; no environment
  or trust store is changed by the documentation.

- Builder handoff guidance states the existing complete/current review rather than
  treating PASS, BRIEF presence or a Git request's `collected` result as permission
  (ADR-0150). The builder reads/judges returned evidence; the collector records Git
  Findings, closures, map and brief. Local received-package review/re-packaging and
  authored unstamped compatibility remain available. Keyless role tables and installer
  next steps now match doctor's existing chosen-transport behavior; no config is changed.

- Maintenance corrects the shipped auto-build summaries to match ADR-0146: current
  design approval and completed-head merge approval are separate; changed artifacts
  need their applicable reply, standing preferences never supply it, and gate/hook
  checks do not verify every prose duty or owner consent. The six adapted upstream
  files have dated notices, with receipt hashes preserved. Scoped freeze exceptions
  and cwd-scoped gate/corpus commands are described without removing the panel's
  accepted project flag.

- The collector serves builder requests (ADR-0148, lifting the freeze for that one item).
  A builder pushes `research/requests/<id>.json`: one fact, why it blocks, and the owner
  pages or search queries. The desktop panel's auto-collect runs on a collector only. It
  pulls and checks each request as untrusted input (fixed fields, http(s) only, no internal
  address, within the per-request cap). It then adds the contract row and plan entries, runs
  the same `research.mjs` and preflight, commits the corpus with its ledger and
  `<id>.result.json`, and pushes. Per-request and daily page caps apply. When credits run
  out it pauses and never passes `--fallback`. A request with a topic gets a new project,
  under a folder the operator approves. New modules: `lib/requests.mjs`,
  `lib/auto-collect.mjs`. The panel shows the queue, the modes (off or automatic), the caps,
  Check now and Resume. A failed commit or push is retried without collecting the request again.
- The desktop panel (ADR-0147, lifting the freeze for that one item): `bin/panel.mjs` opens a
  page served from 127.0.0.1 for keys, doctor, update, the topic and the builder hand-off.
  It runs doctor, handoff, preflight and install with fixed arguments; ADR-0148 adds
  capped collection of validated builder requests, not a general collection command.
  It saves the SerpAPI key to the machine config, refuses to save it inside a repository,
  and never shows it again. Its builder section gives the collector's push, ledger included,
  and the builder's own steps. Host, Origin, JSON-only POSTs and a per-launch token in the
  URL fragment guard every request. `transport.mjs` exposes `SEARCH_KEY` so the vendor stays
  named only in the registry.
- The kit ships a skill set and a role-aware router (ADR-0146, lifting the freeze for that
  one item): `research-kit/skills/<name>/`, deployed by `install.mjs` to every skill root
  beside research-first and `--into` a project. Ten skill directories are vendored from
  StepenkoAnatoli/SkillsMDs (Apache-2.0); thirteen are the kit's own (build-from-brief,
  fact-request, cite-in-code, day-one-tasks, contract-tests, commit-report, map-classifier,
  finding-rewriter, source-grader, brief-writer, freshness-recheck, adr-writer,
  resume-from-disk); `skill-router` routes by role and gate state and never sends a
  builder to a skill that collects. Doctor's deploy check measures the set like the skill.
  A skill of the same name that is not the kit's is left as it is and named, never
  overwritten. Each set skill the kit owns is mirrored, so a file a later kit no longer
  ships is removed and, until then, reported as drift. Five vendored auto-build files
  were adapted on 2026-10-06; the 2026-10-08 maintenance also adapts stage-handoffs
  and corrects the remaining summaries (ADR-0146 decision 3). Each modification is
  marked; the Mandate waits, and merge requires the owner's completed-head reply.
  Researched in `docs/decisions/2026-10-06-builder-skills/`.
- Auto-build runs the kit's way (ADR-0146): `skills/auto-build/references/research-kit.md`
  starts every run from the router, replaces the research stage on a builder with
  handoff, build-from-brief and fact-request, ties requirements, the Mandate, code
  constants and tests to `E-##` rows, and tightens merging - the commit gate, a green suite
  and `preflight` on the merged head, no override ever. It asks the owner every question
  only he can answer and stops for his reply at the Mandate, costly or irreversible
  decisions, secrets and permissions, anything destructive or critical, and the merge; a
  standing mandate no longer approves any of them. The merge approval names the PR's head
  commit and lapses on any change to it; a resumed run re-checks that sha, the gate, the
  suite and `preflight` before merging. A builder also needs no open fact request and no
  stale evidence under a requirement. Unattended runs stop at the Mandate. Requirements
  resting on a price, limit, quota, API or schema version, or tier boundary are volatile
  automatically and need evidence within the project's `refreshDays`; stale facts nothing
  rests on are listed in the merge summary and must be acknowledged in the approval.
- A matched-arm evaluation of the kit against a strongly prompted agent with the same
  tools and budget is adopted (ADR-0145) and scaffolded as the nested project
  `docs/decisions/2026-10-06-kit-vs-prompt-evaluation/`, its protocol and grading rubrics
  frozen before any trial runs. Evaluation only: no command, check or format changes, the
  feature freeze (ADR-0117) is not lifted, and ADR-0089's semantic boundary stays in force.
- The pre-merge audit of ADR-0143 closes two remaining handoff defects: a failed or
  unevaluated brief qualifies CLOSED claims as declarations, and returning to an earlier
  warning state earns a new audit version so the default bundle reflects the latest
  observation (ADR-0144). Historical snapshots remain immutable. Public gate wording
  describes path-based enforcement in gated projects and bounds PASS to checked conditions.
- Handoffs preserve the configured gate's cautions (ADR-0143): the brief no longer turns
  PASS into a claim that every unknown is closed or that independent sources agree.
  Briefs, full and subtopic audits, package reading guides and collection summaries carry
  all evaluated warning reasons and remedies. The MCP approval text directs the builder
  to those cautions. An unavailable warning observation is distinct from an evaluated zero.
  Audit version selection includes the rendered gate result, so a changed warning earns
  a new immutable snapshot. The public description states these limits and makes no claim
  of a measured reduction in downstream errors; gate policy and package formats are unchanged.
- The nested-bare-repository handoff test accepts either Git's older “not a work tree” response
  or newer Git's `safe.bareRepository=explicit` refusal; both must avoid printing an unusable
  checkout command.
- The commit gate's suite budget in the kit's own checkout is 65 minutes, twice the slowest honest
  run measured on a supported host, and `RESEARCH_KIT_GATE_TIMEOUT` now governs it as well as the
  hook's watchdog: the suite gets the watchdog less 120 s, never more than half a short one, and the
  hook's widened watchdog is the budget plus 120 s (4020 s), so the gate stops an overrunning suite
  and blocks before the watchdog fires (ADR-0142). On the operator's Windows PC the green suite takes
  about 1825 s, and the 20-minute budget blocked every commit touching `research-kit/`, leaving
  `--no-verify` as the only way through; the variable reached only the watchdog, and set below the
  budget it let the watchdog kill the gate first, so a fail-open machine allowed a commit whose suite
  never reported (reproduced here with a hung runner, 2026-10-05). A suite stopped at its budget now
  names the variable, with the default's margin, before the override. The hook and the gate read the
  variable in one grammar (seconds, an optional fraction and unit), and the hook names and ignores a
  value outside it: timeout(1) also takes a sign, an exponent or hex, and for `+40` the watchdog
  fired first again. The narrowing reaches every gated project's hook: `+600` or `6e2` now falls back
  to the 120 s default with a warning, and a malformed value no longer makes timeout(1) exit 125 and
  block every commit. Nine digits at most before the point: Git for Windows' timeout(1) reads 2^63 s
  or more as already expired. `0` disables the watchdog and leaves the suite's default budget. The gate stops
  the runner with SIGKILL, since the harness's SIGTERM listener kept a synchronously blocked runner
  alive past its budget on POSIX (review of the change, the same day).
- The installer records no hand-on to another copy of the kit's gate, on a first install or a
  re-install (ADR-0141): doctor's remedy for that hand-on, `git config --global --unset
  research-kit.previousHooksPath` (ADR-0134), lasted one session on the operator's machine
  (2026-10-04), because `installCommitGate` kept the folder in the install state as well and the
  next `install-hooks` run - every kit update runs one - wrote it back into git config, so the
  previous implementation's gate blocked commits again on its outdated checks. `handOnState`
  moves from `doctor.mjs` to `installer.mjs` (doctor re-exports it) so the install judges what
  it records by the rule doctor judges it by; the state file and git config agree once an
  install has run. A folder that is gone stays recorded, for the uninstall restore.
- The ADR-0119 launch-allowance test scales its budget with the host's Node boot, measured
  once (`max(2 s, 5 × boot)`), so Node always has twice its measure to start: on the operator's
  Windows PC the fixed 2 s budget left it 800 ms and the test failed 2 runs in 10 (GPT's review,
  2026-10-04); a Node made to boot 900 ms slower reproduced it here. The shape the test pins -
  launch and page together past the timeout, apart inside it - is unchanged, and its failure
  message now carries `startupMs`, `elapsedMs`, the boot measure and the budget. The guard LIVE
  test's over-20 s line names the browser's first-request time, as the transport's /stalled
  line already did (break-test pass 6 follow-up).
- The browser transport's parent waits for the guard child as long as ADR-0119 allows the
  browser - the launch allowance plus the render budget, `2 × timeout`, and 10 s to report -
  instead of `timeout + 10 s`. A Chromium that took most of its launch allowance to make its
  first request and then rendered inside its budget was killed by the parent mid-render, the
  child's record of where the time went was lost, and the verdict read "the browser never made
  a request in 0 s" (the operator's Windows PC, 1 run in 3; reproduced here with a fake browser
  that launches in 13 s and renders in 13.5 s under a 15 s timeout). A child the parent gave up
  on is now said to be that, with the time it was given (break-test pass 6, F1, 2026-10-04);
  the transport reads a `gaveUp` flag on that result, not the message's wording (GPT's review
  of the fix, the same day).
- A project below the repository root is judged by the commit gate (ADR-0182). git runs the
  hook at the top level, and an ungated top level answered "not-gated" before reading a staged
  path, so code staged in a failing `packages/a` committed. Each staged path is now judged by
  its nearest project below the top level - a folder whose tracked `research/DISCOVERY.md` is
  the contract new-project wrote, or sits beside `research/raw/`, so a data folder, an
  experiment plan or a vendored kit template in a repository without the kit is not one, and a
  clone whose repository ignores `raw/` still is - from the index, and the verdict names it ("BLOCKED in
  packages/a"), with the fix and the `GATE_OFF` override spelled for that project. The edit gate
  judges a file by the same project instead of by the agent's cwd, asks a gated top level alone,
  and keeps its `research/raw/` and `GATE_OFF` refusals for every project above the file; doctor
  says where the commit gate runs when the project is below the root (#309).
- The commit gate blocks a commit that removes evidence HEAD holds: a staged deletion, or the
  deleting half of a rename, of a capture HEAD's or the staged ledger names; the ledger itself
  deleted (`git rm -r research/raw`); or a ledger entry dropped with its capture. It names the
  file or seq and `git checkout HEAD -- <file>`. These had committed as phase-1 work while an
  edit to the same capture was refused (ADR-0093), and the builder's handoff then reported a
  corpus that "did not travel". A capture never committed, or not yet staged, stays
  committable, as does the sanctioned ledger migration (#312).

## 0.9.5 — 2026-10-04

Forty-one entries under the freeze (ADR-0117), with scoped exceptions recorded by their
ADRs: bug fixes from the fourth
and fifth break-tests, from the architecture pass, the output-reliability audit, the gap audit
and the outside audit's rounds of 2026-10-03, and from three external reviews of the handoff
remedies, with the decisions they produced recorded as ADR-0133 to ADR-0140; one vendor update
(the tested Firecrawl CLI is 1.25.3); two internal reorganisations (the search session,
ADR-0135, and the run's exhaustion policy in `lib/credits.mjs`). The suite is 1603 tests,
offline.

- The suite's machine-readable result (`RESEARCH_KIT_RESULT_FILE`) names the failing tests beside their
  count, so two runs compare as sets: a count alone cannot show one test starting to fail while another
  starts to pass (break-test pass 5, 2026-10-04).
- When git refuses to read a repository that is there (`fatal: detected dubious ownership`), the
  handoff remedies say so and to fix that first, instead of "no git metadata, re-copy the corpus from the
  machine that has the repository" (found 2026-10-04 by the third external review).
- Without git on PATH, handoff's fallback walks the project's physical path for a `.git` entry (a
  junction's lexical parents are not where git looks) and reads `GIT_CEILING_DIRECTORIES` as git does:
  absolute entries only, resolved until an empty entry (found 2026-10-04 by the third external review).
- For a capture name a shell or git would read, the handoff remedies no longer say "quote it for your
  shell and prefix `:(literal)`" - cmd expands `%NAME%` inside double quotes - but have the operator list
  the names in `handoff-names.txt` and run `git --literal-pathspecs checkout HEAD
  --pathspec-from-file=handoff-names.txt`, which types no name (found 2026-10-04 by the third external
  review).
- The handoff remedies classify every affected capture name, not only the five the text lists: an
  unsafe sixth name got no note and the instruction to handle it "the same way" (found 2026-10-04 by
  the third external review).
- `handoff` asks git whether the project is inside a work tree before printing the runnable remedies:
  the walk up for a `.git` entry walked past a bare repository the project sat inside and printed a
  checkout git refused. Without git on PATH the walk remains, stopping at a `GIT_CEILING_DIRECTORIES`
  entry (found 2026-10-04 by the second external review).
- The handoff remedies print a capture path inside a git command only when it is letters, digits,
  `.`, `_`, `-` and `/` - the collector's own alphabet. Any other name is named but not printed as a
  command, with a note on how to type it (quoted for the shell, prefixed `:(literal)`): double quotes
  left PowerShell expanding `$copy` to nothing and git reading `[12]` as a glob, and either restored a
  neighbouring file and discarded its uncommitted work (found 2026-10-04 by the second external review).
- `createTempFolder` keeps its record deepest-first as it goes: a mkdir that failed part-way (ENOSPC
  on the third missing ancestor) threw before the sort that ordered the removal, and an ancestor the
  run had created was left behind, empty (found 2026-10-04 by the second external review).
- The handoff remedies recognise the enclosing repository: a nested decision project under
  `docs/decisions/` has no `.git` of its own and was told it had "no git metadata" and given no
  checkout command, although the repository above it restores its captures like any other tracked
  file (found 2026-10-04 by an external review).
- The altered-capture remedy no longer claims a dirty `git status` proves the committed copy is the
  fetched one (a capture committed altered and edited again is dirty too): the checkout is followed
  by handoff again, and the committed case points at `git log` for the commit that held the fetched
  bytes. Re-collecting with `--force` is no longer offered as a repair: a new fetch writes a new
  capture beside this one and the ledger still names this one (found 2026-10-04 by an external
  review).
- The handoff remedies quote a capture path that holds whitespace in every printed git command:
  unquoted, `git checkout HEAD -- research/raw/topic copy.md` is two pathspecs and restores two
  unrelated files, discarding their uncommitted work. The collector's own names hold none; a ledger
  rewritten by hand can (found 2026-10-04 by an external review).
- `createTempFolder` in the test harness records a folder as the run's only when its own mkdir created
  it: recording from the existence check before the mkdir let a folder another process created in
  between be removed at exit (found 2026-10-04 by an external review of the F3 fix).
- `handoff` gives a capture changed after its fetch its own remedy: restore it from the committed copy
  when the change is local to the checkout, else the collector restores or re-collects it. It got the
  push remedy ("something did not travel"), which sends the same bytes again when the change was
  committed and sends an operator to another machine when the fix was one `git checkout` away
  (break-test pass 4, F5b, 2026-10-04).
- The suite removes a temp folder it had to create: a `TMPDIR` naming a folder that does not exist yet
  is still created (a CI job exports `RUNNER_TEMP` before creating it), and the created chain now goes
  with the scratch at exit - only the folders the run itself made, each by a non-recursive rmdir, so a
  folder that existed or that holds somebody else's file is never touched (break-test pass 4, F3,
  2026-10-04).
- The `uncited-capture` warning says "was collected" only of a file the ledger records a fetch of; a
  file under `research/raw` that no fetch produced is named as such (break-test pass 4, F5a,
  2026-10-04).
- The suite's `requirePython` names the interpreter it rejected (`python3 3.8.10; the conformance
  runners need 3.11+`) instead of "no python or python3 on this host" whatever was found
  (break-test pass 4, F2, 2026-10-04).
- `verifyLedger` refuses a ledger entry that names a source sibling without its `sourceSha256`
  (`body-unmodified/unhashed`) instead of skipping the check as it does for the first ledgers'
  hashless captures: a rechained entry could name an altered sibling and pass (break-test pass 4,
  F4, 2026-10-04).
- The installer's tree walks skip `__pycache__`: the conformance runners' Python bytecode cache was
  deployed with the kit and `doctor` then reported the deployed kit as stale on every machine that
  had run the suite first (break-test pass 4, F1, 2026-10-04).
- `doctor`'s committed-key scan skips `research/raw` at any depth, not only the root's: a nested
  decision project's captures are page content like the root's, and CI had scanned the second gap
  audit's corpora and reported a Google page's source sibling (ADR-0140), which carries Google's own
  public Maps keys, as a committed `google-api-key` (found 2026-10-04 by the archive-tree leg).
- The text a capture was converted from is kept beside it as `<capture>.source.html`:
  Firecrawl's `rawHtml` (asked for beside the Markdown, at no extra credit), the keyless
  transport's decoded HTML, the browser's rendered DOM. The ledger entry names and hashes it
  and `verifyLedger` checks it like the capture, so an edited source is refused; it is never
  a capture itself. Until now the converted Markdown was all the corpus kept, so a
  conversion defect (G3) was permanent and the ledger certified it (ADR-0140, gap audit
  2026-10-03, rank 3). The review of that change: a source given and not kept is named on the
  ledger entry as `sourceOmitted` (over the size cap, a sibling with other content, a sibling
  name that cannot be written), the fetch is ledgered even when the sibling cannot be written
  (a planted link had left an orphan capture), and a `*.source.html` no entry names is a
  `source-unnamed` corpus problem.
- A Firecrawl scrape is a live fetch: the adapter passes `--max-age 0`, because the vendor
  serves a cached copy up to two days old by default and a capture stamped `retrieved: today`
  could be yesterday's page - a `--force` or `--refresh-days` re-fetch meant to see a change
  could not. A cached answer, if the vendor sends one anyway, is written into the capture's
  front matter (`cacheState`, `cachedAt`) and the ledger entry (ADR-0139, gap audit
  2026-10-03, rank 2).
- A table row written after a blank line is recorded, not dropped: a blank line ends a
  Markdown table (GitHub renders the rows after it as prose), and `parseTable` had dropped
  them in silence, so a blocking unknown written below a blank line left the gate, which
  printed PASS. Every row-shaped line between a table's end and the next heading is now a
  `table-split` problem naming its line, and `hygiene` fails it; a second table with its own
  header is not one (gap audit 2026-10-03, rank 1). The review of that change made the scan
  run to the end of the table's section (a deeper heading does not end it), skip fenced code
  and HTML comments, ignore a lone separator, and name a second table with a malformed
  separator once, as that.
- The browser transport reads the origin's HTTP status and final URL from Chromium's own net
  log (`--log-net-log`, written to a private folder the guard child deletes after reading):
  an origin's 403 page had been graded `full`, because `--dump-dom` reports no status and
  the collector's >= 400 rule reads a number. A non-2xx answer is now a failed fetch as it is
  on the keyless transport, a redirect into this machine's network is refused, a capture
  carries `statusCode` as a number and the URL it ended on, and a render whose log gave no
  status - an older Chromium, a log that could not be written - is graded `partial` naming
  the unobserved status, never guessed from the page's text (ADR-0137, output-reliability
  audit G5, 2026-10-03).
- Two decisions recorded from the output-reliability audit: one page's identity is its host
  and path and the merge of spellings stands (ADR-0136, its G6); a browser capture records the
  origin's HTTP status from Chromium's net log, or is graded partial saying it could not
  (ADR-0137, its G5; the transport change is the bullet below). `AGENTS.md` gains an
  "Orchestrator facts" section for an agent that plans and delegates work here.
- A fetched page is decoded in the charset its server declared (a byte-order mark first), so
  a `windows-1252` page keeps its euro sign where every body had been read as UTF-8 and the
  capture's hash then proved a page the server never sent; a label the decoder does not know
  falls back to UTF-8 and the keyless capture is graded partial naming the charset; a legacy
  label over bytes that are valid UTF-8 is read as UTF-8 (output-reliability audit G7,
  2026-10-03). The review of that fix found four readings to correct: bytes that are not
  valid UTF-8 under a UTF-8 label, or none - the page whose charset is named only in a
  `<meta>` tag - were still silent U+FFFD graded full, and are now a named fallback graded
  partial; a UTF-16 label over an 8-bit body (no byte-order mark, no NUL byte) decoded to CJK
  garbage with no fallback, and is now read as UTF-8; an unknown label over pure ASCII was
  graded partial though the decode was exact, and a stray quote (`charset="utf-8`) reached
  the decoder as part of the label; and `boundedText`, the JSON reading, had started to
  honour a legacy label where RFC 8259 makes JSON UTF-8 - it reads UTF-8 again.
- Which of two same-day evidence rows for one URL is current follows the fetch ledger, as the
  collector already decided it, instead of the rows' order in the table: with A fetched, then
  B, then A again, the gate had said B superseded A, and reordering two rows changed the
  verdict (output-reliability audit G4, 2026-10-03). The review of that fix found the
  order still read the editable table cell first, so one edit to an older row's date failed
  the gate on the genuinely newest row; both rows are now ordered by their captures' dates.
- Freshness is judged by the capture's own date, not the hand-editable table cell: editing an
  evidence row's Retrieved date alone had removed its stale warning while the capture on disk
  kept the real date. `unknown-closure` ages a row by its capture (the cell is the fallback
  when the capture carries no date), and `hygiene` warns `date-mismatch` when the two name
  different days (output-reliability audit G8, 2026-10-03). The review of that fix found a
  row with a blank Raw cell judged by the URL's latest capture - a later fetch it never read -
  so it borrowed that fetch's date, lost its stale warning and drew a date-mismatch with the
  wrong remedy; a row is judged by the capture it names, or by its cell when it names none.
  A future date in the capture now fails `future-date` as one in the cell does, and the
  stale hint's "fresher capture" is found by capture date.
- A table row whose ID is mistyped (`U_99`, `E_7`, a subtopic without its letters-dash-number
  form) is a hygiene FAIL naming the file, the line and the form, where it had silently
  vanished from the corpus - no unknown, no problem, no finding - and a blocking question with
  it (output-reliability audit G2, 2026-10-03). The review of that fix found an empty ID
  cell kept silent on a row that holds a URL, a finding and a capture - the typo's twin; a
  row empty in every cell stays silent, one with content is recorded.
- A package's `buildAuthorized` requires the brief to be complete and current: every judged
  section present and answered, and a stamped brief drafted from the corpus as it is now. A
  drafted brief with no review sections had been approved (a missing section holds no TODO),
  and one whose evidence changed after the draft had stayed authorized. A brief with no draft
  stamp - every brief authored before ADR-0055 - keeps its approval, its currency unchecked
  (output-reliability audit G1, 2026-10-03). The review of that fix found the stamp anchored
  to the end of the file, so a line appended after it - the `Reviewed by: agent` line - made
  a stale brief read as unstamped, re-approved the build and silenced `brief-stale`; the stamp
  is found wherever it stands, and text after it is an edit. The unchecked approval is no
  longer silent either: `hygiene/brief-unstamped` warns on a drafted brief with no stamp and
  names the redraft that stamps it (ADR-0138, which records the compatibility choice).
- The keyless and browser transports' HTML conversion keeps comparison text inside list
  items, table cells and headings: `x &lt; 5 and y &gt; 2` had come out as `x 2`, and a link
  label inside an item lost everything from its `<` to the item's end, because the block
  pass decoded entities and the page-level pass then stripped the decoded `<...>` as a tag.
  Entities are decoded once, at the end (output-reliability audit G3, 2026-10-03). The
  review of that fix found a link's label still decoded on its own before the tag-stripping
  pass, so `<a>limit &lt; 10 and burst &gt; 2</a>` in a paragraph came out `[limit 2](/x)`
  and `&amp;lt;` was decoded twice; the label is no longer decoded apart, a `&nbsp;`-only
  link is dropped in a list item as in a paragraph, and `&#38;lt;` decodes once, to `&lt;`.
- A search provider whose `search()` throws is a failed search that says so (`<provider>
  threw: <message>`), degraded and recorded like any other, so the run and its accounting
  finish: re-thrown, it ended `research` and `decompose` mid-run, and the searches paid for
  before it never reached the usage row, which is written at the end - `--status` would have
  under-counted real spend (found 2026-10-03, probing; no adapter throws by contract today).
  The review of that guard found an `async search()` slipping past it: the Promise reached
  the `ok` test as a failure with no error text, and its rejection ended the process after
  all. A Promise-returning adapter is now a failed search saying adapters are synchronous,
  and a thrown value that cannot be rendered as text is named as such.
- The search session (ADR-0135) was probed with hostile inputs the day it landed, and three
  things it did not say by name it now does: a provider's `null` row, or results that are not
  an array, end neither `research` nor `decompose` (both had died on `row.url`, research also
  on `.some`); a session built with no provider at all is a named failed search, not a
  TypeError; and a not-ready provider anywhere in a merge is refused before anything is
  spent, not only one on the search side. None is reachable from the CLIs with today's
  adapters and selection (2026-10-03).
- The standing protocol's commit report (rule 2, `AGENTS.md` and the scaffold's template)
  takes two devices from Anthropic's careful-coding skill: each verification claim carries
  one of three status words - verified, untested, expected - and a mistake is reported in
  six fields - mistake, where, impact, cause, fix, verified. The rest of that discipline the
  protocol already carried; the skill itself is not shipped (it is phase-2 discipline, and
  the freeze, ADR-0117, is not lifted for a second installed skill).
- The tested Firecrawl CLI is 1.25.3 (from 1.25.2): the release is one fix, `--objective`
  optional for alexandria feedback (firecrawl/cli#301), with nothing on scrape, search or
  `--status`; its output was captured from the real CLI anyway (three credits) and is read
  unchanged by the adapter's parsers (`research-kit/test/fixtures/*-1.25.3.*`). `doctor`, the
  install line and the workflows' install spec name 1.25.3.
- Internal: one search session (`lib/search-session.mjs`, ADR-0135) owns how a query is put to
  the search providers - the merge, the one degrade to the fetch provider, the rate-limit
  patience, the meters, the failure rows and the refuse-before-spend readiness gate - and
  `research` and `decompose` both ask it; each had carried its own copy, and read side by
  side the copies had drifted in six places. What moves with it, deliberately: `decompose`
  now refuses a search provider that cannot run before anything is spent (only its CLI had),
  logs `searched` / `search found N` / `search failed on every provider` as `research` does,
  and its usage row names the paying provider under a merge, counts every failed ask in
  `searchFailures` and only an answered degrade in `degraded`, as `research`'s does; in
  `research`, usage a provider reports on a failed ask is counted whether or not the degrade
  answers (today's providers report none), and a search that failed without degrading counts
  in `searchFailures` as it already did per provider.
- `doctor`'s hand-on check resolves a relative previous hooks folder from the repository's
  top level, where git runs its hooks from; from a subdirectory it had called a working
  `.custom-hooks` missing, with the unset as remedy (outside audit, fourth round, 2026-10-03).
- The running collector and the reopened corpus agree on the current capture in two more
  cases: a refetch whose bytes match an earlier capture (A, B, A again) makes that reused
  capture current again in the run as on reopen, and a direct capture of a URL stays current
  over a redirect alias of it through the refresh, as the reopen already had it (outside
  audit, fourth round, 2026-10-03).
- `doctor`'s hand-on check reads the recorded folder the way the hooks do, with git's
  `--type=path`, so a value written `~/custom-hooks` resolves to the folder that runs; the raw
  value had it reported as missing, with an unset as the remedy that would have removed a
  working hand-on (outside audit, second round, 2026-10-03).
- A collector whose snapshot predates another writer's captures now sees the last of them as
  current, on the same date by the ledger's order and then by revision: the refresh under
  the lock read without the ledger's rank and remembered each capture as current in filename
  order, so the reopen fix of the same day was undone during a run - `.r9.md` as the cache hit
  where the disk held `.r12.md` (outside audit, second round, 2026-10-03).
- `doctor` warns when the hooks folder the install replaced - what every kit hook hands on to
  (ADR-0112) - is another copy of this kit's gate, or no longer exists, and names the
  one-line remedy (ADR-0134). On the maintainer's machine that folder was the previous
  implementation's own `githooks/`: every commit ran two gates and the older one crashed and
  failed open while doctor said READY (2026-10-03).
- Internal: a run's exhaustion policy (switch or stop) lives in `lib/credits.mjs`, `canSearch`
  beside the other transport capabilities in `lib/transport.mjs`, and one line-ending fold in
  `lib/core.mjs` serves the capture body, the scaffold-template comparison and the brief's
  draft stamp; the last two now fold a lone CR as well as CRLF, so a brief holding a lone CR
  reads as hand-edited once until re-stamped (ADR-0133, from the architecture pass of
  2026-10-03).

## 0.9.4 — 2026-10-03

Fifteen entries from the fourteen pull requests after 0.9.3 (#212 to #225): bug fixes under the
freeze (ADR-0117), the licence (ADR-0130), four decisions (ADR-0127 to ADR-0129, ADR-0131), the
README rewrite and `QUICKSTART.md`. Tagged `v0.9.4` on GitHub on 2026-10-03 at `f5d581a`, with
release notes generated there. At that commit `KIT_VERSION` still read 0.9.3 and this changelog
had no entry for 0.9.4, so from that release (published on GitHub on 2026-10-03) until 0.9.5
the tag and the constant disagreed, against ADR-0116.
This entry records the release after the fact; the tag stays where it was made, and 0.9.5 is
the first release cut by the rule again.

- Reopening a corpus keeps the LAST same-day capture of a URL current. The index broke a
  tie on the retrieval date by filename order, so twelve same-day revisions reopened with
  `.r9.md` current (it sorts after `.r12.md`) and a page re-titled "API v10" reopened under
  its "API v9" capture; the collector's own run had it right and the disk disagreed with it.
  Same date: the ledger's order decides, then a higher revision of the same name (outside
  audit, 2026-10-03).
- `decompose.mjs` refuses a ledger that cannot record a fetch before it asks any provider,
  as `research.mjs` has since ADR-0122: on a damaged ledger phase 0 made four searches and
  one fetch, spending, before the refusal came from inside the collector (outside audit,
  2026-10-03).
- The README, AGENTS.md, the project template, CONTEXT.md and the gate's own fix lines no
  longer say that `git commit --no-verify` is recorded in `research/overrides.log`: git skips
  the hook, so nothing can record it, as `checks.mjs` has said since ADR-0035. The other two
  overrides are recorded as before (outside audit, 2026-10-03).
- A repository-local `core.hooksPath` is detected from any subdirectory of the repository,
  by `install-hooks.mjs`, `doctor` and preflight alike: the probe looked for `.git` beside
  the working directory and reported nothing below the root, so a nested decision project
  and an install run from a subfolder missed the displacement warning (outside audit,
  2026-10-03). The map's `machine.mjs` row, broken across three lines with its first cell
  separator missing, is one row again.
- `install-hooks.mjs --dry-run` writes nothing on any path. It read the flag after the role,
  the posture and the uninstall had already run, so `--dry-run --role builder --fail-closed`
  saved both and `--dry-run --uninstall` removed the installed commit gate - a preview that
  disabled the enforcement the operator relied on (outside audit, 2026-10-03). Every preview
  now says what it would do and touches neither git config, the machine config nor the
  settings file.
- `install-hooks.mjs` reports, at install time, a repository-local `core.hooksPath` in the
  directory it is run from - what husky, lefthook, simple-git-hooks and pre-commit set, which
  displaces the machine-wide gate in that repository - on stderr with the remedy, and still
  installs (ADR-0131). The installer had read and written only the global path and said
  "installed" from inside such a repository; the displacement was found at check time, by
  `doctor` or preflight, if at all (outside review, 2026-10-02).
- A test that needs a file symlink reports `UNSUP` where the host refuses to make one,
  instead of going red: on Windows a file symlink needs Developer Mode or an elevated shell,
  and five tests made one unguarded, so the collect group read `FAIL ... EPERM` on such a
  machine while the code under test never ran (outside review, 2026-10-02). The harness's
  `requireSymlink` names the privilege as the reason, like a missing Python (ADR-0108); CI's
  Windows runner has it and still runs the tests. The root README now links the reading
  map, `docs/README.md`, from its Documentation section.
- A plan query whose `why` names unknowns that are all CLOSED is not searched again
  (ADR-0127): a search has no cache, so every run of a finished project paid it - found
  running the kit five times over MoonAliza's seven projects, where one query would have
  cost two credits a run forever. The skip is said on the terminal and in the results, the
  dry run previews it, and `--force` runs it as it re-fetches a page.
- The keyless transport's failure quotes the server's own reason beside the status - a
  JSON `message`, an HTML title or the first line of a text body, one line and bounded -
  so a refusal explains itself in the ledger and on the terminal. A github.com page had
  been recorded as `HTTP 403` alone; the body named the refuser (a sandbox proxy, not
  GitHub), and it took a second tool to learn that
  (`docs/decisions/2026-10-02-github-plain-fetch-refusal`, 2026-10-02).
- The secret scan treats a binary as a binary (ADR-0128): a file with a NUL byte in its
  first 8000 bytes is skipped and counted in the coverage line, in `doctor` and in the
  package validator, instead of having credential patterns matched against an executable's
  string table. `doctor` run on a Windows home folder had reported fourteen committed keys,
  every one the PEM marker OpenSSH and libssh2 parse or random bytes spelling `sk-`
  (2026-10-02). A `.pem` is text and stays caught.
- The front page `README.md` is rewritten as a structured guide: how it works, requirements,
  install, the five-minute try, a real project step by step, working with Claude Code,
  Gemini CLI and other agents (with a MoonAliza example), the builder handoff, keys and
  cost, the GitHub collector, a command reference, the machine configuration, and a
  troubleshooting table. The kit reference (`research-kit/README.md`) is unchanged apart
  from the links into it.
- A local run stops when Firecrawl reports its credits exhausted (ADR-0129, superseding the
  default of ADR-0086): the remaining searches and pages are reported `uncollected`, never
  failed, the summary says what is left, and the CLI prints the decision - top up and run
  the same command, or run it with `--fallback` - and exits 2. `--fallback` keeps the old
  switch to browser or http-keyless; the unattended collectors (`collect.yml`,
  `live-collection.yml`) pass it. `--no-fallback` still means the default. One flag added
  under the freeze, by that ADR.
- `QUICKSTART.md`: the two-minute setup through the MCP server - the kit on the agent's
  machine, one Actions token in the agent's own settings file, the Firecrawl key kept in
  the repository's environment - then one prompt, and the four-step loop the agent runs
  (`collect`, `fetch_corpus`, review, a targeted `collect` for what is missing). Linked
  from the front page.
- A capture is written with LF line endings only, whatever the transport received
  (2026-10-02). The scaffold's `.gitattributes` makes git store every capture as LF, so a
  keyless capture written with the CR bytes a server sent hashed one way on the collector
  and checked out another way on every other machine, failing handoff on a capture nobody
  had touched.
- Licensed (ADR-0130): the code, tests and documentation under the PolyForm Shield License
  1.0.0 - install, run, modify and distribute for any purpose except a competing product -
  replacing "all rights reserved", which the README's own install instruction contradicted.
  The captured pages under every `research/raw/` are excluded by `NOTICE`, `REUSE.toml`
  and a `LicenseRef-Captured-Page` marking: copyright stays with their owners, no licence
  is granted over them, and no fair-use claim is made.

## 0.9.3 — 2026-10-02

Nine bug fixes under the freeze (ADR-0117) and one vendor update, all from the third
break-test and from running the kit on its own decision project the same day. Nothing new
is added.

- The Firecrawl adapter reads the first complete JSON value in the CLI's stdout, whatever
  is printed around it - a banner with a bracket before it, a credit receipt after it - and
  `scrape` refuses an exit of 0 that printed nothing, no readable JSON, or a page with no
  text, as a named failure. Each of those had become a "collected" capture holding 0
  characters, with a ledger entry and an evidence row behind which there was no page
  (break-test pass 3, 2026-10-02, with a fake CLI on PATH; the 1.25.0 CLI prints credit
  receipts, so the trailing case is one release away).
- A page whose text exceeds the capture size limit (10 MB) is a failed fetch, named with
  its size and the limit, and nothing is written: the collector had accepted a 40 MB
  answer as a capture, a ledger entry and an evidence row that the corpus reader then
  refused as `capture-too-large`, blocking the gate (break-test pass 3, 2026-10-02).
- A Firecrawl CLI of an unsupported major is refused with its sentence and exit 2: the
  refusal carried the code `CLI_INCOMPATIBLE` but the named-refusal set did not know it,
  so `research.mjs` printed it under a stack trace and an object dump with exit 1, which
  reads as checked and wrong (break-test pass 3, 2026-10-02).
- `doctor` judges the installed Firecrawl CLI the way the run does: an unsupported major
  is a fail with the remedy on a collector that needs it (information on a builder or a
  keyless collector), a newer minor passes and names the tested version. It had printed
  `pass 2.0.0` for a CLI the run then refused before spending (break-test pass 3,
  2026-10-02).
- `citations/quote-too-short` warns under three words AND under 40 characters, across the
  fragments (ADR-0126): two rows of the kit's own decision project quoted a 130-character
  dependency map - one whitespace-separated "word" - and were warned as anchoring almost
  nothing, which was false of a quote that anchors one exact line (2026-10-02).
- A page is a cache hit under any spelling of its URL - `www.`, a trailing slash, a
  fragment, http for https - and a plan that names one page in several spellings fetches it
  once, naming the other spellings as skipped. The cache looked a URL up by its exact
  spelling, and the plan's own URLs were never compared with each other, so such a plan
  paid for the page once per spelling, with a ledger entry and a row each (break-test pass
  3, 2026-10-02).
- `doctor` run from the deployed kit itself says the deploy was not measured (`info`, with
  the command that does measure) instead of `pass ... matches this tree`: a tree compared
  with itself always matches, and a line appended to the deployed `lib/core.mjs` passed that
  way. The drift is measured against the home the install state recorded, which the message
  already named (break-test pass 3, 2026-10-02).
- `--force` on a page that comes back byte-identical records the fetch in the ledger and
  lets the row that cites the reused capture stand, saying so in the reason; it had appended
  a second row that superseded the first, so every unknown citing unchanged content failed
  `evidence-supersession` and had to be re-cited for nothing (break-test pass 3, 2026-10-02).
  A changed page is still a second capture with a row of its own.
- The collector's refresh before every fetch reads only the captures its snapshot does not
  hold and sketches none of them (`readCaptures(root, { known, sketches })`), and a capture
  is remembered once: it had re-read, parsed and MinHash-sketched every capture on disk
  inside the lock on every fetch, and pushed every entry into the index again. Per-capture
  cost at 400 rows: 74 ms before, 13 ms after; a 2000-page run had spent 41% of 585 s
  sketching pages it had already indexed (break-test pass 3, 2026-10-02).
- The tested Firecrawl CLI is 1.25.2 (from 1.24.6): its `--status`, search and scrape output
  were captured from the real CLI and read unchanged by the adapter's parsers before the move
  (`research-kit/test/fixtures/*-1.25.2.*`; `docs/decisions/2026-10-02-firecrawl-cli-1-25`).
  The scrape receipt the 1.25.0 changelog introduced goes to stderr, stdout stays one JSON
  value; search's `data.tools` is now populated and reaches no result. `doctor`, the install
  line and the workflows' install spec name 1.25.2.

## 0.9.2 — 2026-10-02

Two bug fixes under the freeze (ADR-0117), found the same day 0.9.1 was cut: one by
running the kit on MoonAliza, one by the second break-test. Nothing new is added.

- A page whose fetch redirected is a cache hit under the URL the plan asked for. The capture
  index (`readCaptures`, `rememberCapture` in `lib/corpus.mjs`) also answers to the asked-for
  URL, read out of the capture's command line; it had known only the URL the bytes came
  from, so every later run fetched the page again, paid for it, and appended it to the ledger
  and `EVIDENCE.md` a second time as a "first capture". Found running the kit on MoonAliza
  (2026-10-02): two docs.github.com pages, every run.
- `handoff` refuses a corpus whose `research/EVIDENCE.md` is absent or holds no evidence
  table (`handoff-evidence-missing`, `handoff-evidence-unparsed`), with the "did not travel"
  remedy, and its OK line counts the evidence rows beside the ledger entries. With no rows
  there were no citations, so "every cited capture on disk" held vacuously and handoff
  said OK - over an absent table, a binary one, and one whose header a filter had
  rewritten (break-test, 2026-10-02).

## 0.9.1 — 2026-10-02

Bug fixes under the freeze (ADR-0117), from two break-tests, an arena and real use on
MoonAliza; six decisions recorded as ADR-0120 to ADR-0125. Nothing new is added; what the
kit promised is now true on more machines - a host with a template dir or a posture config,
a tree unpacked under another repository, a Chrome that phones home - and its suite says the
same thing on all of them.

- The browser guard survives a CONNECT the browser resets while the guard answers it: the
  socket had no error listener on the dropped and refused paths, and an ECONNRESET killed the
  guard child mid-render ("the browser exited null" on three CI legs, 2026-10-02).
- The browser guard drops every request made before the page asked for has been requested
  (ADR-0125): CI's Chrome stable preconnected to `www.gstatic.com` before the page, a host real
  pages use too, so the service-host list could not settle it; the order can.
- A `RESEARCH_KIT_RESULT_FILE` that cannot be written makes a green `selftest.mjs` run exit 2, where
  it exited 0 and left CI's summary reading "crashed before reporting" beside a green step.
- `selftest.mjs` refuses below the Node floor before any test runs (exit 2, naming the floor), where
  on Node 20 it ran and reported 28 red tests each saying "this kit needs 22 or newer".
- The drafted finding keeps an underscore inside a word: `return_run_details` had been drafted as
  "returnrundetails", a parameter no page carries, and a quote copied from the draft could never
  be found in the capture (found running the kit on MoonAliza, 2026-10-02).
- The browser guard drops Chromium's own service traffic (ADR-0124). Rendering a plain page,
  Chromium 141 made nine connections no page asked for - the component updater's clock, the
  default-search preconnect, `accounts.google.com`, the Cloud Messaging check-in and push
  channel - and the guard carried them as external; on a no-network host the last of them
  became a LIVE test's verdict. A request to one of `BROWSER_SERVICE_HOSTS` is now answered
  403, logged `dropped`, and never judged, carried or counted as a refusal; the page asked for
  is exempt by host and port. Flags and profile preferences were measured first and left most
  of the traffic.
- `selftest.mjs` describes the kit, not the machine (ADR-0123): the run gets a scratch home and
  loses every `RESEARCH_KIT_*` variable but the ones that describe the host or the run, and
  the vendor keys. The tests that spawn kit commands read the operator's machine config, deployed kit and
  Firecrawl login, so a `strict` posture config turned 18 tests red, `role: builder` 7, and a
  Firecrawl CLI installed and not logged in turned two `cli` tests red that a `transport:
  http-keyless` config had been hiding. Those two now run on a PATH without the CLI. Fixture
  repositories are initialised with an empty `init.templateDir`: a host whose global git config
  names a template with hooks (what `pre-commit init-templatedir` writes) turned 9 hook and
  handoff tests red.
- `selftest.mjs` no longer calls a run with zero failures a red suite. When every blocker is a
  test the host could not run (no Chromium, no Python), it ends "No test failed. N tests could
  not run on this host, and an incomplete run is not a pass (ADR-0108) - this is not a red
  suite", names `RESEARCH_KIT_ALLOW_UNSUP=1` for a local run, and still exits 1. "A red suite
  stops work" is the standing protocol's stop-the-line sentence, and an agent that read it
  over "0 failed, 2 unsupported" stopped a whole break-test at its baseline (2026-10-02).
- The collector refuses to spend on a ledger whose chain is broken (ADR-0122). A ledger that
  parsed but whose hashes no longer linked was appended to without a word, so a run paid for
  fetches that `handoff` and `preflight` then refused with the rest of the chain.
  `assertAppendable` now refuses a broken chain (`LEDGER_CHAIN_BROKEN`) beside an unparsed
  line and a torn tail, `runResearch` asks it before the first fetch - dry runs included -
  and `research.mjs` prints it as a sentence with exit 2. The remedy restores the ledger that
  verified; the kit never rewrites a hash (arena break-test #198, F-1-2).
- A posture key that is present and not of its type resolves to its restrictive state
  (ADR-0121): `"failOpen": "false"` is fail-closed, `"evidencePolicy": "STRICT"` is strict,
  `"editGate": {"mode": "HARD-BLOCK"}` is hard-block, as `role` already resolves to
  `unknown`. `doctor` names the key and the state it resolved to (`config-ill-typed`), and the
  hook's sh posture reader agrees: it looked for the bare word `false`, so a quoted `"false"`
  read as fail-open. Absent keys keep their defaults (arena break-test #198, F-2-1).
- `editGate.settingsPath` is taken from the machine config only when it is a non-empty string;
  anything else falls back to the runtime anchor, as every other wrong-typed key does. It was
  the one key `shape()` still passed through raw, and `{"editGate":{"settingsPath":42}}` in a
  hand-edited config reached `path.dirname` and killed `install-hooks` - the command whose job
  is to bind the gates - with a raw `ERR_INVALID_ARG_TYPE` stack (arena break-test #198,
  2026-10-02, redone on main; the sibling of the `skillRoots` check).
- `install-hooks --dry-run` reports the refusal the real run would give. On a machine where
  the kit was not deployed it printed "would set core.hooksPath=..." and "would register in
  .../settings.json: ..." and exited 0, while the real run refused both gates and exited 1:
  `installCommitGate` answered the dry run before its deployed-hook check, and
  `installEditGate` exempted the dry run from its own. Both previews now carry `ok: true`,
  and the CLI tests `ok` before `dryRun`, so a refusal prints as a refusal with the real
  run's exit code. The sibling of the 2026-09-29 `install --dry-run` prune fix, never swept
  to (arena break-test #196, 2026-10-01, redone on main).
- `research.mjs` names the refusals the kit wrote instead of re-throwing them. A torn ledger
  tail - what an interrupted collection leaves behind - printed its own remedy under a source
  line, a caret, six frames and Node's version footer, and a damaged chain dumped its internal
  `problems` array as an object literal; both exited 1, which this kit reserves for FAIL,
  checked and wrong. `NAMED_RUN_REFUSALS` in `core.mjs` is the four codes (LEDGER_DAMAGED,
  LEDGER_TORN_TAIL, LOCK_HELD, LOCK_STUCK), answered with their message and exit 2, as
  `prior.mjs` and `doctor --fix-arity` already answered them (break-test 2026-10-01, PR #193,
  redone on main).
- A lock the kit judges stale and cannot remove is a named refusal (`LOCK_STUCK`), not a
  livelock. The failed removal fell through to `continue`, which skipped both the deadline and
  the sleep, so a read-only `research/raw` holding a dead pid's lock - or a `.fetches.lock`
  that is a directory - spun at 100% of a core forever, printing nothing and unreachable even by
  `--report-on-signal`, because a synchronous loop never returns to the event loop. The held
  case is coded `LOCK_HELD` too (break-test 2026-10-01, PR #193, redone on main).
- `skillRoots` is checked as a list of paths, not only as an array. A number or a null left in
  a hand-edited machine config reached `path.join` and killed `doctor` with a raw
  `ERR_INVALID_ARG_TYPE` stack - the one command whose job is to name every problem and print
  its fix. An entry that is not a path is dropped, and with nothing left the documented defaults
  are in charge (break-test 2026-10-01, PR #193, redone on main).
- `fetchFailure` cuts a URL to its host in the failure's own message, not only in its cause.
  Node throws some refusals with no cause and the whole URL in the message - a URL carrying
  credentials, one that will not parse - so a signed URL in a plan was printed to the terminal
  and written into `research/raw/.fetches.jsonl` as that entry's error: the file that must
  travel, in the one directory `doctor`'s secret scan excludes (break-test 2026-10-01, PR #193,
  redone on main).
- A quote anchor no longer misses a passage over a character nobody can see. Unicode's format
  characters - the zero-width space a docs site puts inside a heading's anchor link, a soft
  hyphen from a PDF extractor, a word joiner - survive NFKC and `\s`, so
  `[quote: ## Bundled skills]` was quote-not-found against the heading that displays it, in a
  capture this repository holds. `normalizeForMatch` drops `\p{Cf}` on both sides, which can
  only shorten what is searched for, so an invented passage stays invented (break-test
  2026-10-01, PR #193, redone on main).
- The extractor's `comparison-row` rule is three linear scans, not one backtracking regex.
  `\b(plan|tier)\b.*\b(month|year|user)\b.*\d` was quadratic in a table row's length, and a
  row's length is the captured page's own doing: a 309 KB row, the size of a line this
  repository's corpus already holds, took 15 s in `firstFinding`, which the collector runs over
  every page. The same row now costs milliseconds, and the rewrite is pinned against the old
  pattern over 4,000 generated rows (break-test 2026-10-01, PR #193, redone on main).
- In the kit's own checkout a commit staging anything under `research-kit/` is allowed
  only when the suite is green (ADR-0120, which lifts the freeze for this one check). The
  commit gate runs `bin/selftest.mjs` and reads its result file: an unsupported test is
  not red, a runner that produced no result is a block, and a docs-only commit owes
  nothing. The gate says the suite is about to run, strips git's hook environment from it,
  and stops it after 20 minutes; the hook widens its watchdog to 1500 s there. Found by committing twice on a
  red suite in one afternoon, both times from a chain that misread the exit code.
- The render timeout starts at the browser's first request through the guard, and the
  launch is allowed as long again (ADR-0119). On the CI runners Chromium's process startup
  took 4 to 43 s before any request, out of the render budget, so the page was killed
  before it had been asked for. A timeout now says what the launch cost.
- The guard records every request it carried and reports the ones still unanswered when
  the render ends. A page Chromium printed before every load was answered, or at its
  deadline, is graded partial and names those loads, or says every request had been
  answered and the wait was inside the browser; a refusal's message carries the same note.
- Chromium is given its own deadline (`--timeout`), ten seconds under the transport's kill
  timeout. With the virtual-time budget alone, one resource that never answered froze the
  budget, so headless never dumped and was killed with nothing to show: the intermittent
  "did not finish rendering" on CI, reproduced with a page whose image never arrives. At
  the deadline Chromium dumps the DOM it has, so such a page is captured as it stands.
- The browser transport judges a timeout by what Chromium printed, not by its exit: a whole
  DOM dump after the render timeout is the render, a dump holding the guard's refusal is
  the refusal, and a timeout with no dump names the last thing Chromium said on stderr.
  Found on CI, where the suite's first Chromium launch ran its 45 s out three times in one
  afternoon with the dump and the cause thrown away.
- `makeSlug` never returns a name Windows reserves (`con`, `aux`, `lpt1`, ...): such a
  result is prefixed `name-` inside the slug alphabet, on the fallback path and after a cut
  too. Latent: no caller hands a bare slug to the filesystem (break-test PR #188).
- `runChecks` appends findings one at a time. The spread passed every finding as an
  argument, and a corpus of about 66,000 evidence rows pushed one check past the engine's
  limit: preflight, doctor, brief and audit died with a raw RangeError instead of a verdict,
  and the commit gate answered internal error (break-test PR #188).
- `tolerateClosedStdout` answers the callback of every write it drops. The write that
  replaced stdout's after EPIPE returned without calling back, and `exitAfterFlush` waits on
  exactly that callback: `selftest.mjs | head -n 1` finished green, then exited 13 on an
  unsettled top-level await after its result file had recorded 0 (break-test PR #186).

## 0.9.0 — 2026-10-01

The first tagged release. Research-Kit is feature-frozen from here: changes are bug fixes,
until a new ADR lifts the freeze for a named item (ADR-0117).

**What it is.** A zero-dependency Node toolkit that makes research a blocking phase before
an agent builds anything:
- unknowns are named in a contract (`research/DISCOVERY.md`);
- primary pages are fetched into a hash-chained, append-only ledger;
- claims are tied to quotes the gate finds in the captured pages;
- a commit gate refuses product code until preflight passes;
- the result is handed to the builder as `research/BRIEF.md`.

**Collection.** Firecrawl (metered), a keyless HTTP transport, and a local-Chromium browser
transport, with SerpAPI, SearXNG and DuckDuckGo-lite for search. Remote collection runs on
GitHub Actions (`collect-remote`, with `--run-id` to pick a run up again).

**Hardening in this release.** Dozens of break-test rounds. The latest:
- the commit hook judges a commit even when `git diff` fails;
- every hook git knows hands on to what git would have run without the kit (ADR-0112,
  ADR-0113);
- `install` refuses to mirror into a folder that is not a kit (ADR-0111);
- the keyless fetch judges the address it connects to, closing DNS rebinding (ADR-0114);
- the browser transport renders through a guard proxy the kit runs, so every request Chromium
  makes - redirects, script navigation, meta refreshes, images, frames - is judged before it is
  sent (ADR-0118);
- writes retry a rename Windows holds for a moment.

**Found by a cold end-to-end trial.** A fresh agent with only the docs took a real question to
PASS and a brief. On the way:
- a Firecrawl CLI with no key now fetches while the keyless route searches for it, because
  Firecrawl stopped answering keyless searches;
- quotation marks around a `[quote: ...]` passage no longer make it fail;
- the walkthrough gained the step where findings are rewritten.

**Found by break-test PR #185, redone here.**
- identifiers - slugs, file names, ids, dates - sort by code unit on every machine; they
  sorted by the machine's locale, and two machines listed one corpus in two orders;
- the edit gate answers a terminal stdin at once instead of waiting for input forever.

**Supported.** Linux and Windows, Node 22, 24 and 26, all tested on every commit. macOS is
best-effort with no CI leg (ADR-0101).

**Known limits.**
- The gate proves evidence was fetched and quoted, not that it was read correctly: the
  review is the agent's own declaration (ADR-0107).
- The edit-time gate is a Claude Code hook; other agents meet only the commit gate.

**License.** All rights reserved (`LICENSE`).
