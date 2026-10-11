# Reading map

What to read, in what order, depending on what you came for. Every file named here is
in this repository.

| You want to | Read | Then |
|---|---|---|
| set the kit up and run one research cycle | [`../README.md`](../README.md) | [`../QUICKSTART.md`](../QUICKSTART.md) for the GitHub route with one token |
| know the rules an agent follows in a project | [`../AGENTS.md`](../AGENTS.md) | [`../research-kit/template/AGENTS.md`](../research-kit/template/AGENTS.md), the copy a project receives |
| look up a command, a flag, the package format or the test suite | [`../research-kit/README.md`](../research-kit/README.md) | `node research-kit/bin/<command>.mjs --help` |
| understand what a module owns and why the seams sit where they do | [`ARCHITECTURE.md`](ARCHITECTURE.md), the numbered seams first, then one row at a time | the ADRs each row cites |
| know why a decision was made, and what it rejected | [`adr/README.md`](adr/README.md), one line per decision | the ADR itself, dated, with its trigger to revisit |
| read the vocabulary the rules are written in | [`../CONTEXT.md`](../CONTEXT.md) | |
| see the research behind a decision about the kit itself | [`decisions/README.md`](decisions/README.md) | each project's `research/BRIEF.md` |
| see what changed in a release | [`../CHANGELOG.md`](../CHANGELOG.md) | the tag on GitHub |
| follow a past review or measurement | the dated files in this folder, and [`architecture-history/`](architecture-history/README.md) | |
| read the original 2026-09-17 build report | [`build-report-2026-09-17.md`](build-report-2026-09-17.md) | the first implementation, module responsibilities and its verification record |
| read the 2026-09-17 hardening pass | [`build-report-2026-09-17-hardening.md`](build-report-2026-09-17-hardening.md) | eleven reproduced findings fixed after the first build, with the remaining structural findings identified |
| read the 2026-09-17 structural pass | [`build-report-2026-09-17-tier3.md`](build-report-2026-09-17-tier3.md) | the staged-index verdict, collection writer boundary, lock liveness and supersession decisions |
| read the 2026-09-29 break-test | [`build-report-2026-09-29-break-test.md`](build-report-2026-09-29-break-test.md) | six defects and their probes, with the differences between the Arena branch and fixes landed through PR #155 |
| follow the 2026-10-02 external review | [`review-2026-10-02-external-findings.md`](review-2026-10-02-external-findings.md) | the findings register, each disposition and the evidence that closes or leaves it open |
| review the 2026-10-03 output-reliability findings | [`review-2026-10-03-output-reliability.md`](review-2026-10-03-output-reliability.md) | eight ranked findings, reproductions, proposed corrections, and audit limits at `74c0791`; section 9 records the fix for each and the dispositions of the review of those fixes |
| read the 2026-10-03 gap audit of the kit | [`review-2026-10-03-gap-audit.md`](review-2026-10-03-gap-audit.md) | fifteen ranked gaps against nine comparison sets collected through the kit, what is solid, and the outcome of ranks 1 to 3 (ADR-0139, ADR-0140) |
| read the 2026-10-04 gap audit of the kit (the second) | [`review-2026-10-04-gap-audit.md`](review-2026-10-04-gap-audit.md) | seventeen ranked gaps against three new comparison sets collected through the kit, the previous audit's open ranks re-verified, an external review re-verified, and what is solid; answer-only, nothing implemented |
| read the 2026-10-04 break-test (pass 6) | [`build-report-2026-10-04-break-test-pass6.md`](build-report-2026-10-04-break-test-pass6.md) | three clean baselines, the parent's timeout and a synthetic launch-budget test repaired, CPU-starvation probes null, and the remaining operator-PC browser timing question left open |
| read the 2026-10-04 break-test (pass 5) | [`build-report-2026-10-04-break-test-pass5.md`](build-report-2026-10-04-break-test-pass5.md) | an all-green baseline, eleven probe groups with no new failure, one Low finding fixed: the result file names the failing tests |
| read the 2026-10-04 break-test (pass 4) | [`build-report-2026-10-04-break-test.md`](build-report-2026-10-04-break-test.md) | thirteen green runs, five findings, four fixed as their own commits, one recorded as a decided trade-off |
| review the 2026-10-06 handoff audit | [`review-2026-10-06-handoff-audit.md`](review-2026-10-06-handoff-audit.md) | truthful closure labels, chronological audit snapshots, gate wording and their verification limits |
| read the 2026-10-07 break-test (pass 7) | [`build-report-2026-10-07-break-test.md`](build-report-2026-10-07-break-test.md) | historical Arena probes, POSIX read-only deployment repair, the Windows CI reproduction, reporting limits and a separate follow-up verification record |

Two habits of this repository that a newcomer should know before reading further:

- A comment in the code that carries a date and a finding is a post-mortem, not noise: it
  names the break-test or the run that found the defect and the cause, so the next reader
  does not reintroduce it. The architecture map's rows are written the same way.
- Nothing under `decisions/` is moved or deleted; the index says which projects still
  carry a decision. A corpus there is evidence, including the dotfile ledger beside it.
