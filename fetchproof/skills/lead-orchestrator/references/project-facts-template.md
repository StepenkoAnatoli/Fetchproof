# Project Facts Template

<!-- Modified by Fetchproof on 2026-10-22: received as lead-orchestrator 2.0 (the owner's claude.ai account copy, dated 2026-10-04), which replaces the StepenkoAnatoli/SkillsMDs 3f2d2fc baseline (ADR-0190); the kit's old name, Research-Kit, is Fetchproof here, as are the paths and variables that spelled it (ADR-0186). -->

Add this section to the project's agent instructions (CLAUDE.md, AGENTS.md or equivalent) during
Phase 0 and keep it current. Record only facts that were checked. Mark anything unconfirmed as
"unverified" rather than estimating it.

```markdown
## Orchestrator facts
_Last verified: <date>, branch <name> at <commit>_

### Environments
| Purpose           | Platform and versions                                        |
|-------------------|--------------------------------------------------------------|
| Development       | <OS, runtime and tool versions>                              |
| Acceptance        | <the check that decides "done", e.g. CI jobs>                |
| Not runnable here | <CI legs this host cannot run: other OS or runtime versions> |

- Filesystem guard: <the helper tests must use to create links, and the result it reports
  where the platform refuses, e.g. UNSUP>, or "none"

### Quality gate (run in order)
| Step            | Command   |
|-----------------|-----------|
| Install         | `<cmd>`   |
| Typecheck       | `<cmd>`   |
| Lint            | `<cmd>`   |
| Build           | `<cmd>`   |
| Tests (full)    | `<cmd>`   |
| Tests (single)  | `<cmd>`   |
| Other checks    | `<cmd>`   |

### Baseline (development environment)
- Known failures: <count>. Cause: <e.g. platform-specific tests>.
- To list them: `<command or file>`
- Pass criterion: no failures outside this set, and no member of the set hidden or skipped.

### Sources of truth
- Plan: <path>
- Specifications: <path>
- Architecture: <path>

### Conventions
- Commit format: <project format, or "see lead-orchestrator report templates">
- Branching and pull requests: <rules>
- Standing rules: <e.g. fix now or record under "Recorded for later" in the plan>
- Run folder: <e.g. docs/orchestration/<YYYY-MM-DD>-<task-slug>/>; ledger committed
  <on the working branch, riding along with unit commits / in separate chore commits / not
  committed - kept in <ignored path>>

### Invariants
| Invariant     | Evidence (test or check) |
|---------------|--------------------------|
| <invariant>   | <test or check>          |

### Fetchproof
| Item                     | Value                                                   |
|--------------------------|---------------------------------------------------------|
| Kit path                 | `<~/.agents/fetchproof or FETCHPROOF_HOME>`         |
| Machine role             | `<collector / builder>`                                 |
| Transport / policy       | `<firecrawl-cli / http-keyless / browser>` / `<pluralist / strict>` |
| `doctor` result          | `<READY or the reported problem>`, <date>               |
| `selftest` result        | `<PASS / BLOCKED (reason) / not run>`, <date>           |
| Research folder          | `<e.g. docs/research/<YYYY-MM-DD>-<topic>/>`            |
| Existing research        | `<paths of projects with a passing gate, and their topics>` |
| Remote collector         | `<OWNER/REPO fork with the collect workflow, or "none">` |

### Parallel execution
- Shared resources used by tests (temporary directories, ports, database files, keychains, caches)
  and how to isolate each one per agent.
- Git worktrees available: <yes / no>
```
