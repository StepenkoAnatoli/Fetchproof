# Fetchproof and the original reliability goal

Date: 2026-10-05. Checkout inspected: `d83974b21ae8c7f278fb4c30efa7f4c28a67c281`.
This is a local implementation audit and recommendation. The external literature is
recorded separately in `research/EVIDENCE.md`, with six collector-produced captures.
No production code or existing corpus was changed.

## The gap, demonstrated

The kit checks recorded evidence and workflow conditions. Its gate does not determine
whether a finding is supported by the source. This is a documented boundary, not a new
semantic bug: ADR-0087 excludes judging support, and ADR-0089 explicitly leaves factual
support uncomputed.

**Verified local observation:** on 2026-10-05, with cwd
`C:\Users\PC\Fetchproof`, Node 24.20.0, and default pluralist policy through an absent
configuration path, root preflight returned 28 passing findings, one warning and zero
failures. Reading a second copy of the corpus into memory and replacing E-19's Finding
with a deliberately unsupported sentence returned the same counts and PASS:

> The fetched documentation proves that every AI agent is incapable of making a coding
> error, and all third-party APIs have unlimited free use.

E-19 actually concerns Firecrawl rate limits and is cited by U-1. No evidence file,
capture, ledger or unknown row on disk was changed. The deliberately false sentence
has no quote anchor. This observation tests preflight's semantic boundary; it does not
test artifact authorization, prove the real root claims false, estimate production
error, or imply an adversarially rewritten ledger was involved.

Reproduce from the repository root (JavaScript on stdin, no saved code or fake capture):

```js
import { readCorpus } from './fetchproof/lib/corpus.mjs';
import { runPreflight } from './fetchproof/lib/preflight.mjs';
const root = process.cwd();
const env = { FETCHPROOF_CONFIG: 'C:/Users/PC/Fetchproof/.audit-nonexistent-config.json' };
const baseline = runPreflight(root, { corpus: readCorpus(root), env });
const alternate = readCorpus(root);
alternate.evidence.find(e => e.id === 'E-19').finding =
  'The fetched documentation proves that every AI agent is incapable of making a coding error, and all third-party APIs have unlimited free use.';
const changed = runPreflight(root, { corpus: alternate, env });
console.log({ baseline: baseline.counts, changed: changed.counts,
  baselinePass: baseline.pass, changedPass: changed.pass });
```

## Current promise versus checks

Paths and lines refer to the inspected checkout; links lead to the repository files.

| Observation | Local evidence | Implication |
|---|---|---|
| Opening wording says collection precedes design/build; enforcement is conditional | [README](../../../README.md), lines 5-7 and 60-79: installed commit hook; edit hook only for Claude Code; fail-open default; recorded and unrecorded overrides | Describe the enforcement scope near the promise. For other agents, commit gating cannot prevent an earlier design or filesystem edit. |
| Captures and chain are checked, but the chain is self-attested | README lines 76-78; `fetchproof/lib/provenance.mjs`; ADR-0087 | Recorded origin and unchanged bytes are useful checks. They do not establish source truth, interpretation or protection against an actor who can rebuild the chain. |
| A quote's occurrence is checked; support is outside the predicate | [ADR-0087](../../../docs/adr/0087-a-quote-in-a-claim-must-occur-in-its-capture.md), lines 10-12, 33, 45-46 | A real quotation can still be attached to an unsupported conclusion. More collection cannot alone solve that. |
| PASS means no findings classified as failures | `fetchproof/lib/preflight.mjs`, lines 49-75; `checks.mjs`, lines 340-407 | Passing corpora may contain warnings and KNOWN-UNKNOWN rows. Public wording must preserve those states. |
| Review completion is a structural approximation | `fetchproof/lib/artifact.mjs`, lines 299-323; `brief.mjs`, lines 41-67 | Rewriting an extracted cell and declaring reviewer identity do not establish correct reasoning. |
| Semantic support and builder quality are unmeasured | `fetchproof/lib/measure.mjs`, lines 64-66; [ADR-0089](../../../docs/adr/0089-the-kit-measures-its-citations-without-a-judge.md), lines 26-39; [measurement](../../../docs/measurement-2026-09-28.md), lines 44-67 | Current measurement cannot justify a claim of fewer unsupported answers or coding defects. The historical report's absence of build outcomes is not a claim that every later project was exhaustively searched. |
| The generated brief can overstate a passing verdict | `fetchproof/lib/brief.mjs`, line 275: PASS emits wording that every blocking unknown is closed with evidence; `checks.mjs` accepts disclosed KNOWN-UNKNOWN | Correcting that wording and retaining warnings is an existing output defect, not a need for a new truth judge. |
| Consumer warning loss was already audited | [gap audit](../../../docs/review-2026-10-04-gap-audit.md), lines 123-130, 239-249 | Prioritize preserving the verdict's caveats in what the builder reads. Reconfirm the exact consumers and add regression checks before implementing. |
| Feature growth itself is an acknowledged source of misreading | [ADR-0117](../../../docs/adr/0117-feature-freeze-from-0-9-0.md), lines 9-12, 18-30 | Use documentation, evaluation and existing defect fixes first. A new judge, check, command or format needs a named freeze exception. |

Root doctor was **verified READY**, role collector, Firecrawl CLI 1.25.3, with 528
credits reported before collection and no recorded overrides. It also warned that four
deployed files differ from the checkout. This audit uses explicit paths to the checkout;
it does not silently update the user's installed kit. Six planned pages were collected,
zero failed, and the run reported six credits spent. Decompose used --dry-run and spent
nothing. The root gate does not validate this nested corpus; its own preflight does.

## What honesty can mean operationally

Intent cannot be proved from an agent's fluent explanation. Evaluate observable behavior:

- It labels a claim as observed, inferred, assumed or unresolved with a concrete reason.
- It names the scope of verification: a quote occurred, a command passed, or a scenario worked.
- It does not report a command as run if it was only suggested, or a tool failure as success.
- It preserves conditions, exceptions and disagreements when summarizing sources.
- It corrects an error with its impact and the result of a check, rather than inventing a rationale.
- It continues independent useful work when something is unknown; an unresolved load-bearing
  fact prevents the dependent action, while irrelevant uncertainty does not block everything.

These are proposed evaluation criteria. This audit does not establish that adding them to
instructions makes agents satisfy them reliably.

## Recommended direction

Three directions remain available to the owner:

1. Keep a focused phase-1 research tool and narrow the public promise to its actual checks.
2. Keep that tool and add a short, shared work discipline for research, coding and writing;
   evaluate the final outcomes before implementing new mechanisms. **Recommended for the
   stated goal**, initially through documentation and measured experiments.
3. Expand into a runtime that verifies all agent actions. This is a larger architecture
   choice; this audit supplies no evidence that its cost or complexity would pay off.

This is a recommendation, not an accepted change to responsibilities or a supersession
of ADR-0089. An implementation that changes the kit's scope needs its own researched ADR.

The discipline can be expressed as: define the important claim or required behavior,
obtain an appropriate observation, challenge it with a check, deliver the result with
the check's limits, and revise when new evidence contradicts it. Feedback from building
must have a route back to the collector for external facts. A builder still must not
forge a missing corpus; it may run tests and inspect its local implementation as part
of phase 2.

| Work | Appropriate observation/check | Honest deliverable |
|---|---|---|
| Research | Read the supporting passage in context; compare conditions and disagreements; separate source statement from inference | Claim with source, scope and uncertainty |
| Coding | Derive acceptance behavior from the task; run meaningful tests against the delivered state, including relevant regressions and failure paths | What works in the tested scenarios, commands/results, untested parts |
| Writing | Compare factual wording with source material or supplied facts; verify numbers and quotations; inspect whether edits added or strengthened claims | Text that preserves factual support, plus disclosed gaps where needed |

Source independence matters more than the count of reviewers. A reviewer who repeats
the author's story is not a new observation. E-03 and E-04 support using different
verification mechanisms and respecting their tested scope, not promising that another
agent always finds the error.

## Pilot to test the mission

Suggested starting size: twelve tasks, four each for research, code and writing. First run
each with the current kit and without it under the same model/settings, initial state,
tools and bounded budget; start with three repetitions per arm (72 runs). Evaluate the
proposed shared discipline as a separate later variant with a frozen specification,
so its benefit is not attributed to the current kit. This is a pilot to
discover failure mechanisms, not a predetermined statistically sufficient sample for
a general product claim. Extend it only when the variability and desired claim warrant it.

Freeze task instructions, expected outcomes and grading rules before running. Separate
the grader from the drafting context where practical, blind it to the experiment arm,
and calibrate semantic judgments against adjudicated examples. Record disagreements;
an unchecked model judge cannot be treated as ground truth. Evaluation calibration
does not add a mandatory human approval step to ordinary kit tasks (ADR-0107).

Include an authentic quote whose qualifier refutes the draft claim; conflicting official
pages; a genuinely unreachable fact; a coding bug missed by shallow tests; tests that
cannot execute; a red command; and a writing edit that turns correlation into causation
or inserts an unsupported number. Also include easy, fully supported cases that should
proceed, so blanket refusal cannot win. Use real project failures where possible and
keep constructed cases labeled.

Score and publish separately:

- correct useful completion;
- unsupported material claims and incorrect confident claims;
- source support and coverage for research/writing;
- acceptance failures and escaped defects for code;
- truthful reporting of tool calls and their results;
- appropriate uncertainty and unnecessary blocking;
- time, tokens and collection spend.

Keep artifacts and transcripts. Report results per domain with uncertainty, not a single
"honesty score". A claim such as "in these tasks, kit use reduced unsupported material
claims from A to B while useful completion remained C" is warranted only after that
measurement. This audit has not run the pilot or measured its expected benefit.

## About text that is defensible now

> Fetchproof helps agents base project decisions on traceable evidence. It records
> declared blocking unknowns, preserves collected source material, and checks the
> research artifacts against explicit rules. With its hooks installed, it can block
> commits that fail those rules; Claude Code also has an edit-time hook. The checks make
> missing evidence and certain verification problems visible. Source interpretation,
> omitted questions and the correctness of the resulting code or prose still need
> task-specific verification.

"Helps agents make fewer unsupported claims and mistakes" is the goal to evaluate.
"Has been shown to reduce them" requires a scoped comparison that is presently absent.

## Verification record

**Verified:** root doctor READY with deployment warning; root orientation gate PASS and
handoff exit 0; collector run six collected / zero failed; local semantic-boundary probe
repeated by the lead with identical PASS counts. Nested preflight after source review:
PASS, zero blocking, five corroboration warnings, twelve passing checks. Each warning
is carried in the brief; four concern one source per question and one uses the common
arxiv.org site as a proxy for one voice despite different papers. Authored-file local
links resolve, and the staged whitespace check excluding immutable raw captures passes.
The unfiltered whitespace check reports whitespace received in vendor HTML; those source
bytes were retained unchanged, rather than edited to satisfy a formatting check.

**Untested:** controlled kit-versus-baseline pilot, proposed warning-output fixes, any new
coding/writing workflow, and full offline suite (no product code is changed by this task).
**Expected:** the proposed discipline may improve checkability and expose mistakes;
an error reduction is a hypothesis until evaluated.

**What was gotten wrong and fixed:** mistake: two read commands used wildcard syntax
as literal paths; where: initial ADR/raw-file inspection; impact: those reads produced
no evidence, with no repository or delivered result changed; cause: Windows path/glob
semantics; fix: resolve ADR filenames with rg --files and search raw with -g '*.md';
verified: corrected reads found the exact ADRs and cached supporting passages. No
capture or ledger was edited to repair a failed read. A second correction: mistake:
pilot arms were initially ambiguous between the current kit and the proposed discipline;
where: this pilot paragraph and BRIEF.md Next steps; impact: could misattribute a future
result, with no evaluation run or result affected; cause: compressed experimental wording;
fix: explicitly evaluate the current kit first and the proposed discipline separately;
verified: independent review identified the ambiguity and the revised text names both variants.
