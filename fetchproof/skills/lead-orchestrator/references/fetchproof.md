# Fetchproof, as lead-orchestrator uses it

This file is added by the kit (ADR-0146). The SKILL.md beside it names
`references/fetchproof.md`. Lead-orchestrator 2.0 came with its own integration reference
under that name; the kit does not ship it (ADR-0190), because a restated protocol drifts
from the kit's rules. This file points at the protocol rather than restating it, and the
kit's rules govern wherever the skill's text and theirs differ.

## 1. Readiness

Confirm the intended project before diagnostics; an uncertain or wrong cwd requires
the operator's project choice (AGENTS.md), not a search for another corpus.

```
node "$HOME/.agents/fetchproof/bin/doctor.mjs"
```

Record the verdict (`READY` or the blockers), the kit path, and the **machine role** it
prints. The role decides Phase 1b:

A chosen keyless collector does not need Firecrawl (ADR-0095). Record an unresolved
role or blocking diagnostic and resolve it before proceeding; key presence alone is
not a READY verdict. Before building, require handoff and preflight to pass,
classified MAP, rewritten extractor Findings, and an authored brief with both judged
sections present and answered. A stamped brief needs current inputs; authored
unstamped briefs retain approval with currency unknown (ADR-0138). These existing
approval conditions apply on either role and qualify the SKILL.md's presence-only
researcher-report summary.

- **collector** - Phase 1b runs as the skill says, following the `research-first` skill
  (deployed beside this one): decompose, contract, prior, collect, rewrite, gate, brief.
- **builder** - Phase 1b does not run here. `research.mjs` and `decompose.mjs` refuse on a
  builder (exit 2), and a page fetched by hand is not evidence. Run
  `node "$HOME/.agents/fetchproof/bin/handoff.mjs"` first, build from `research/BRIEF.md`,
  and turn every missing fact into a request with the `fact-request` skill.

For Git builder requests, `collected` delivers captures. The builder reads and judges;
the collector records Findings, unknown closures, map and the current authored brief.
Return review-only gaps in prose; another fetch is needed only for a missing external
fact. ADR-0052 still permits local review and re-packaging of a received package,
without collection or edits to the collector's Git corpus (ADR-0150).

**Research folder.** It is the project's own `research/`, read from the working directory
(`AGENTS.md`, "Starting in the wrong place"), and one project answers one question. A
question its contract is not about needs a project of its own: where the project's rules
place one, scaffold it with
`node "$HOME/.agents/fetchproof/bin/new-project.mjs" <dir> --topic "<question>"` and work
from that directory (the kit's own repository puts them under `docs/decisions/<date>-<slug>/`,
ADR-0030); otherwise ask the operator. Record it with the Fetchproof facts in "Orchestrator
facts".

## 2. Which skill

Which skill to use at each point is the `skill-router` skill's table.

A session that continues earlier work ("continue", "resume") first reads where the project
stands, as the project's `AGENTS.md` says ("Resuming after an interruption"): `resume-from-disk`,
then the router. This skill's description names the same words, but Phase R resumes a run only
when this task's run folder already exists; it does not stand in for that reading.

## 3. Protocol, commands, rules, exit codes

The section `references/agent-briefs.md` sends a researcher to.

The `research-first` skill and the project's `AGENTS.md`. Exit codes: `PASS` 0,
`FAIL`/`REOPEN` 1, `INCOMPLETE` 2, `BLOCKED` 3 - read the code, not the prose.

## 4. The project's conventions first

`references/project-facts-template.md` and `references/report-templates.md` ship with the
skill since 2.0 (ADR-0190). In a Fetchproof project the project's own conventions come
first, as the SKILL.md allows: the facts section is `AGENTS.md`'s "Orchestrator facts",
and a commit message follows the project's five-part report and the `commit-report`
skill. The templates fill what the project does not prescribe. The run ledger, `RUN.md`
(`references/run-ledger.md`), is the one auto-build keeps its stage table in.
