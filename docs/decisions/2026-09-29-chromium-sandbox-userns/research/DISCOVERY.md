# Discovery Contract - Chromium's sandbox on Ubuntu 23.10+: why it fails under AppArmor's unprivileged user namespace restriction, and the supported ways to run headless Chromium there

Started 2026-09-29. This file is the definition of "enough information to build".
`node "$HOME/.agents/fetchproof/bin/preflight.mjs"` reads it and blocks the build until every unknown
below is either `CLOSED` with evidence or `KNOWN-UNKNOWN` with a verification step.

## Build intent

The kit's browser transport crashed on GitHub's Ubuntu runner with Chromium's "No usable
sandbox!". Done means knowing why the sandbox cannot start there, which remedies keep it,
and whether dropping it (--no-sandbox) is acceptable for a tool that renders arbitrary pages.

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
| U-01 | Why can Chromium's sandbox not start on Ubuntu 23.10+? | A remedy aimed at the wrong cause fixes nothing. | CLOSED | E-01, E-02: AppArmor denies unprivileged user namespaces to any binary without a userns profile; Ubuntu ships one for Chrome stable. |
| U-02 | Which remedies keep the sandbox, and which binary is already covered? | Picks what the kit may do or recommend. | CLOSED | E-02: Chrome stable at /opt/google/chrome/chrome runs as is; other builds via CHROME_DEVEL_SANDBOX, a profile, or the sysctl. [single-witness: Chromium documenting its own sandbox is the only authority on it] |
| U-03 | May the kit drop the sandbox (--no-sandbox) as a fallback? | Rendering arbitrary pages unsandboxed is the risk the sandbox exists for. | CLOSED | E-02: never on the open web. [single-witness: Chromium's own security guidance - no second party owns it] |

## Questions for the human (maximum 3)

Intent questions only - things no document can answer. Facts never go here; they go in
the table above. If a question's answer is in public documentation, it is a research
task, not a question.

## Already decided

Locked decisions for this project. Do not revisit these without the human.
