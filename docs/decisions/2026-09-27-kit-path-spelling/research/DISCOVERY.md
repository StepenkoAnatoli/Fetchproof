# Discovery Contract - How a document that travels between machines should spell a command that runs the kit from the user's home folder, so it works in Windows PowerShell 5.1, PowerShell 7, cmd, bash and zsh

Started 2026-09-27. This file is the definition of "enough information to build".
`node fetchproof/bin/preflight.mjs` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

Every project the kit scaffolds carries commands that run the kit, such as
`node {{KIT}}/bin/preflight.mjs` in AGENTS.md and START_HERE.md. `{{KIT}}` is rendered as this
machine's absolute kit path, or, for a project that travels, as a spelling passed with `--kit`.
The Actions collector passes `~/.agents/fetchproof` (collect.yml), so every remote package
tells its reader to run `node ~/.agents/fetchproof/bin/doctor.mjs`. The operator reads those
packages on Windows. Whether that command runs depends on the shell: whether it expands `~` for
a native command, whether it knows `$HOME`, and whether quoting (needed for a path with a
space) stops the expansion.

"Done" is:

1. the spelling a travelling project gets runs, as written, in the shells its readers use -
   Windows PowerShell 5.1, PowerShell 7, bash and zsh - and the documents say what cmd needs;
2. a kit path with a space does not split the command;
3. the decision rests on what each shell documents, not on how it behaved once.

## Unknowns

A fact belongs here when guessing it wrong changes the design: API limits and pricing,
auth model, data schemas, rate limits, licensing/ToS, platform behavior, current library
versions, competitor pricing, data availability.

Status is exactly one of:
- `CLOSED` - proven by an `E-##` row in `research/EVIDENCE.md` (which must point at cached raw text).
- `KNOWN-UNKNOWN` - unreachable now; the `Evidence` cell names the day-one verification step.

Anything else (`OPEN`, blank, "in progress") fails the gate.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-1 | Does PowerShell expand `~` in an argument to a native command such as node - in Windows PowerShell 5.1, and in PowerShell 7 on Windows - by default or behind an experimental feature, and from which version? | Decides whether the `~` spelling the collector uses today works for a Windows reader at all | CLOSED | E-01, E-02, E-03. On Windows, PowerShell passes an unquoted ~ to a native command literally unless PSNativeWindowsTildeExpansion is on: added experimental in 7.5, mainstream from 7.6. So node ~/... fails in Windows PowerShell 5.1 (which predates the feature), in 7.4, and in 7.5 without the experimental feature; it works in 7.6 and later. A quoted ~ is never expanded (E-01: "unquoted tilde") [single-witness: Microsoft is the only authority on which PowerShell version expands what; a third party can only restate learn.microsoft.com] |
| U-2 | Does PowerShell define `$HOME`, and does a variable inside a double-quoted argument to a native command expand? | Decides whether `"$HOME/.agents/fetchproof/bin/x.mjs"` works in PowerShell, quoted against spaces | CLOSED | E-04, E-05, E-10, E-11. Every PowerShell defines $HOME as the home directory - on Windows from USERPROFILE, in 5.1 (E-10) and 7.6 (E-04) alike - and a double-quoted string is expandable, its $variables replaced before the command receives it, in 5.1 (E-11) and 7.6 (E-05). Both pages say an argument containing spaces must be quoted. So "$HOME/.agents/fetchproof/bin/x.mjs" reaches node as one absolute path in every PowerShell [single-witness: Microsoft is the only authority on PowerShell's own variables and quoting rules] |
| U-3 | In bash, is a quoted `~` expanded, and does `$HOME` expand inside double quotes? | Decides whether quoting against spaces breaks the `~` spelling in bash, and whether `$HOME` survives it | CLOSED | E-06, E-07, E-12, E-13. bash and zsh expand ~ only when a word begins with an unquoted tilde (E-06, E-13), so quoting the ~ spelling against spaces breaks it; both expand $HOME inside double quotes (E-07, E-12). So "$HOME/..." works quoted in both, and ~ works only unquoted |
| U-4 | How does cmd.exe reference an environment variable, and is the home folder one of them? | Decides what the documents must tell a cmd reader, since cmd expands neither `~` nor `$HOME` if its syntax is `%NAME%` | CLOSED | E-08, E-09. cmd references a variable as %NAME% (E-08), and the user profile folder is %USERPROFILE%, typically C:\Users\<username> (E-09). Neither ~ nor $HOME is cmd syntax, so a cmd reader needs "%USERPROFILE%\.agents\fetchproof\bin\x.mjs" [single-witness: Microsoft is the only authority on cmd and on Windows' environment variables] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.
