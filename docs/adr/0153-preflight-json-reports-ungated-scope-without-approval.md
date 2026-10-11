# ADR-0153 — Preflight JSON reports ungated scope without approval

- **Date:** 2026-10-08
- **Status:** accepted
- **Area:** `research-kit/bin/preflight.mjs`; ungated CLI output only

## Context

Preflight text already reports a directory holding none of the four gate markers as
`not gated` and exits 0. Its JSON branch returned before that scope check, so an empty
directory received missing-contract failures and exit 1. Selecting a check with no
applicable evidence, such as citations, could instead emit `pass:true` there. Neither
machine result expressed the scope that the text adapter already recognized.

The shared `runPreflight` verdict intentionally evaluates its snapshot for library
callers. Its judged Boolean is `pass === (counts.fail === 0)`. That relationship cannot
both remain universal and express unjudged scope without an approval-like `pass:true`,
while retaining the established Boolean type and keys. The repair therefore needs an
explicitly narrow output interpretation, approved for this parity bug repair under
ADR-0117. It introduces no check, flag, configuration key or JSON format version.

## Decision

Keep the current directory as the project (ADR-0017), with the existing exact four
markers: `research/DISCOVERY.md`, `research/EVIDENCE.md`, `research/plan.json`, and the
`research/raw` directory. Do not search for another root or broaden those markers. A
research folder alone does not opt in; any remaining gate marker keeps a partially
removed research project gated.

After the existing option-name/value validation, help and registry-listing branches,
selected-check parsing, raw verdict evaluation and unknown-check refusal, the CLI
checks scope once, before either verdict formatter. An ungated directory keeps the
existing text sentence and exit 0. JSON also exits 0, using the existing output-flush
helper, indentation, newline, four keys and value types:

```json
{
  "pass": false,
  "counts": { "pass": 0, "warn": 1, "fail": 0 },
  "evidencePolicy": "pluralist",
  "findings": [
    {
      "severity": "warn",
      "check": "gate",
      "rule": "not-gated",
      "detail": "This project holds none of the four gate markers; no research verdict or permission to build was established."
    }
  ]
}
```

The example policy value is the existing configured policy label; it is not reset by
scope handling. The single finding is an adapter scope notice, not an additional
registry check or an evaluated research warning. Neither `--strict` nor strict machine
evidence policy promotes it. For this ungated CLI envelope only, `pass:false` states
that no passing research verdict or build permission was established, despite no
blocking finding; exit 0 means the inspection command completed outside gated scope.

The shared verdict library, its other callers, and all gated text/JSON formatting,
warning promotion, findings, exits, brief-stamp notices and remedies stay unchanged.
Unknown checks still exit 2 before scope handling. Existing help/registry precedence
is retained; this repair does not change the flag grammar.

## Rejected alternatives

- **`pass:true` for unjudged scope.** A successfully completed inspection has not
  established evidence that supports a build.
- **`pass:null`, a new `gated` key, or a format version.** These change the established
  JSON types or shape to repair a contained adapter parity defect.
- **A failing scope finding or strict promotion.** A directory that did not opt into
  research is not a failed gated project; text already exits 0 there.
- **Suppressing missing-contract failures inside `runPreflight`.** Its other callers
  intentionally judge missing contracts. That would widen the repair and weaken them.
- **Returning before check-name validation.** This would silently accept an unknown
  check only because the cwd is ungated, contrary to ADR-0004.

## Verification and limits

Three offline CLI regressions cover text/JSON ungated scope without project writes,
a valid selected check plus quiet/strict flags and strict private machine policy, and
unknown-check refusal in both formats plus passing/missing-contract gated controls.
The scope pair and selected-check case were red before the adapter change. Fresh
integration gate and CI remain required; this record does not certify a wrong cwd as
the operator's intended project.
