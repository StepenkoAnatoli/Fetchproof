# Report Templates

Use the project's own conventions when they exist. Otherwise use these.

## Commit message

```
<type>(<scope>): <imperative summary, max 72 characters>

What changed:
- <file or component>: <change>

Why: <the requirement, defect or plan item this addresses>

What it touched: <files and areas; schema, API or configuration changes, or "none">

What was verified (<environment, runtime version>):
- <command or test file>: <result, counts>
- Repetition: <test> × <n> consecutive passes
- Mutations detected: <test>: fails with <guard> removed, on its own input
- Baseline: <no failures outside the known set>
- Research gate: <research project path>: preflight exit <0>, or "not applicable"

What went wrong and was fixed: <mistakes made during the work, or "nothing to report">
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `chore`.

## Pull request description

```
## Summary
<one or two sentences: what this delivers and which plan item it completes>

## Commits
- `<type>(<scope>)`: <one line> (built by <role> on <model>; reviewed by <roles> on <model>)

## Verification (<environment>)
- <suites and counts; repetition runs; mutations; gate result against baseline>
- Research: <project path>, preflight exit <0>, <n> unknowns CLOSED, <m> KNOWN-UNKNOWN,
  audit snapshot attached; or "not applicable"
- **Acceptance check:** <the environment or CI job that must confirm what could not be
  verified here, and why>. Merge held until every such leg is green.

## Defects found and fixed during this work
- <defect>: <root cause, one line>

## Open items
- <recorded findings, assumptions, decisions required>

## Run ledger
<path to RUN.md>; run was <fresh / resumed at "<checkpoint>">
```

## Final report to the user

```
Summary:          <one or two sentences>; run <fresh / resumed at "<checkpoint>">
Changes:          <one line per commit or unit, with role and model used>
Verification:     <commands, counts, repetitions, mutations, baseline comparison,
                  research gate result>
Not verified:     <item> - to be confirmed by <environment or check>
Defects fixed:    <list>
Open items:       <recorded findings, known unknowns, assumptions, decisions needed,
                  kit findings>
Run ledger:       <path to RUN.md>, status <COMPLETE / BLOCKED (reason)>
Next step:        <recommendation>
```

Every sub-agent report, whatever the role, ends with the status-words block from
`careful-execution.md` section 4:

```
Verified:      [tests and commands run, with results]
Untested:      [what was not or could not be run, and how to run it]
Mistakes:      [mistake reports, or "none found"]
Open risks:    [assumptions made, edge cases left, follow-ups]
```
