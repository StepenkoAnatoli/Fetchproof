# Researcher Benchmark Specification

**Status:** Approval-ready candidate  
**Specification version:** 1.0.0  
**Date:** 2026-09-16  
**Audience:** Fetchproof maintainers, benchmark authors, independent graders, release reviewers, and operators responsible for Firecrawl spend  
**Purpose:** Define a repeatable benchmark that determines whether the researcher produces correct, supported, constraint-complete research at an acceptable cost  
**Scope:** Benchmark design, task authoring, execution protocol, scoring, adjudication, reporting, and release criteria  
**Excluded:** Benchmark implementation, repair of researcher defects, vendor selection, automated LLM judging, and changes to product code or machine configuration

## 1. Decision summary

The benchmark has two tracks and one release decision:

1. A **frozen regression track** uses versioned, local source fixtures. It measures deterministic research quality without network variation or paid collection.
2. A **live research track** uses current primary sources. It measures freshness handling, real collection behavior, and incremental cost.
3. A release passes only when every required run passes, every task passes, both tracks pass, and the cost gate passes. Cost is evaluated only after quality passes.

The benchmark evaluates research at the level of atomic claims and constraints. It does not treat a valid citation, a passing provenance chain, polished prose, or a large corpus as evidence that an answer is correct.

The benchmark produces separate results for:

- Answer correctness.
- Citation support.
- Constraint coverage and omissions.
- Cost per accepted required unit, with extra useful claims reported separately.
- Operational completion and repeatability.

No single score may allow low cost or good formatting to compensate for a critical factual error, an unsupported critical claim, a missed critical constraint, or a false build-ready decision.

The decision hierarchy is normative:

1. A **run** is first classified as valid or invalid. Candidate-caused protocol violations are failures, not invalidations.
2. A valid run passes only if it clears every per-run hard and numeric criterion.
3. A task passes only if every required run passes and its track-specific repeatability conditions pass.
4. A track passes only if every task in it passes and its aggregate thresholds pass.
5. A release passes only if the frozen, live, and cost gates all pass.

An invalid required run makes the release `INCOMPLETE` until it is rerun or qualifies for the narrow rescore-only correction in Section 12.3. A valid failed run makes the release `FAIL`; it cannot be discarded or replaced by a more favorable rerun.

## 2. Goals and non-goals

### 2.1 Goals

The benchmark must answer these questions:

1. Did the researcher answer the blocking questions correctly?
2. Does each material claim follow from evidence that is authoritative for that claim?
3. Did the researcher identify and apply every design-changing constraint?
4. Did it distinguish documented fact, inference, decision, contradiction, and unavailable evidence?
5. Did it stop honestly when a required fact or output could not be obtained?
6. How many paid collection credits or equivalent external-cost units were consumed per accepted required unit fixed before execution?
7. Can the result be repeated and independently graded?

### 2.2 Non-goals

The benchmark does not:

- Score writing elegance except where ambiguity changes claim meaning.
- Reward the number of pages collected or citations emitted.
- Treat vendor documentation as independent corroboration of that vendor's comparative claims.
- Treat retrieval time as proof that the underlying information is current.
- Use an LLM as the final grader.
- Exercise real credentials during the frozen track.
- Permit a benchmark author to change gold answers after seeing the candidate output.
- Establish that every future research topic will succeed; it measures the defined task population.

## 3. Benchmark composition

### 3.1 Release suite

The initial release suite contains 24 tasks.

| Category | Count | Track | Primary capability |
|---|---:|---|---|
| Stable technical facts | 4 | Frozen | Extract exact behavior from official technical documentation |
| Volatile facts | 4 | Live | Verify current prices, limits, versions, or availability |
| Contradictory sources | 4 | Frozen | Resolve version, date, scope, or publisher conflicts |
| Unavailable evidence | 4 | Frozen | Produce an honest known-unknown or no-go decision |
| Critical constraints | 4 | Frozen | Detect auth, legality, rate-limit, cost, runtime, and output-obtainability constraints |
| Adversarial evidence | 4 | Frozen | Resist incomplete captures, misleading citations, stale metadata, and false source independence |

The 20 frozen tasks are the deterministic release gate. The four live tasks are repeated operational canaries. A task may exercise several capabilities, but it has exactly one primary category for suite balancing.

### 3.2 Difficulty distribution

Within the 24-task suite:

- 6 tasks are basic: one or two official sources and no contradiction.
- 12 tasks are intermediate: multiple required facts or constraints and at least one plausible distraction.
- 6 tasks are adversarial: conflicting scope, incomplete evidence, access failure, or a misleading source that appears authoritative.

At least eight tasks must require a correct non-affirmative result: contradiction, known-unknown, no-go, or review-required. This prevents a system from passing by always producing an affirmative recommendation.

### 3.3 Required universal dimensions

Across the full suite, each universal research dimension must be critical in at least two tasks:

- Access model.
- Authentication.
- Rate limits.
- Terms, legality, or licensing.
- Schema stability.
- Freshness.
- Cost at expected volume.
- Runtime or execution limits.
- Output obtainability.

Output obtainability must be critical in at least four tasks because a research conclusion is unusable when the data required for “done” cannot be obtained.

## 4. Tracks and source handling

### 4.1 Frozen regression track

Each frozen task includes a sealed source package containing:

- Raw source captures.
- Capture metadata and retrieval dates.
- Expected provenance records.
- A source manifest with SHA-256 hashes.
- Deliberate distractors or incomplete sources when the task requires them.
- A task-visible package and a grader-only gold package.

The researcher receives the task-visible package or an adapter that serves it through the normal transport interface. It must not receive gold claims, constraint lists, accepted outcomes, source-quality labels, traps, or grader notes.

Frozen source packages are immutable within a task version. Any byte change creates a new task version and requires the gold package to be reviewed again.

### 4.2 Live research track

Each live task asks a fact that is expected to change, such as current pricing, rate limits, version support, or regional availability. Before a release run:

1. A task curator refreshes the gold answer from the primary source.
2. Two gold reviewers confirm the answer, scope, material locators, expected outcome, retrieval date, and source hash.
3. The task-visible package and grader-only gold package are locked for the release window.
4. The operator re-captures and hashes every material gold locator immediately before and after each candidate run.
5. Candidate runs occur within seven calendar days of the lock.

A live source has materially drifted only when the pre-run or post-run capture changes a passage used by a required claim, constraint, disallowed claim, or expected outcome. Cosmetic or unrelated page changes do not invalidate a run. The operator retains the locked, pre-run, and post-run captures and records the affected gold IDs. Material drift outside candidate control makes the run invalid; the task is relocked and versioned before rerun. A source refresh that changes only bytes or wording without changing the intended answer increments the patch version. A change to required claims, constraints, weights, or expected outcome increments at least the minor version, and an outcome change increments the major version.

Live credentials remain outside task packages and reports. Live runs execute serially in an account with no unrelated traffic. The task locks its authoritative cost meter, attribution window, unit, and reconciliation tolerance before execution. An operator-side meter outage or unrelated account traffic makes cost measurement invalid. Candidate deletion, corruption, suppression, or bypass of required request/usage records is a hard failure, not an invalid run.

### 4.3 Cold and warm conditions

Every frozen task is run twice:

- **Cold:** no eligible research cache exists.
- **Warm:** the eligible cache produced by the cold run is available.

The warm condition receives only the cold run's hash-verified raw captures, provenance records, and cache metadata declared eligible by the task. It must not receive the cold run's discovery contract, evidence rows, claims, brief, audit, answer text, grader notes, or other synthesis artifacts. Eligibility requires the same task version, source identity, scope, and unexpired task-specific freshness window.

Cold and warm runs are independently scored. The warm run must produce the same normalized outcome, required-claim dispositions, required-constraint dispositions, and active source/locator set as the cold run, ignoring only run IDs, timestamps, local artifact IDs, and cache annotations. It must report zero new external collection cost for every eligible cache hit. A warm run that copies or consults cold synthesis artifacts is a hard failure.

Each live task is run cold three times during the seven-day release window. Every repetition is independently scored and must pass. Results are also reported as a median to measure stability; a median never rescues a failed repetition. Source drift invalidates a repetition only under the material-drift rule above.

## 5. Roles and separation of duties

| Role | Responsibility | Restriction |
|---|---|---|
| Benchmark owner | Maintains schema, suite balance, and release rules | Cannot waive a hard failure after seeing a release result |
| Task author | Writes task and initial gold package | Cannot review gold, grade, or adjudicate that task |
| Gold reviewer | Confirms claims, constraints, sources, expected outcome, caps, and invalidation rules | Cannot author or grade that task; must review before execution |
| Run operator | Executes the candidate and records environment/cost | Cannot edit output artifacts |
| Grader A and B | Independently score blinded outputs | Cannot author/review gold; cannot see candidate version or the other grade |
| Adjudicator | Resolves material scoring disagreements | Must record the rule applied, not only the final number |
| Release reviewer | Applies suite-level pass criteria | Cannot substitute judgment for a failed hard criterion |

For one task:

- The author, two gold reviewers, and two release graders are five distinct people.
- Neither the author nor a gold reviewer may grade that task's candidate output.
- Graders A and B remain blinded to each other until both grades are sealed.
- An adjudicator is distinct from the author and the two graders. A gold reviewer may adjudicate only when the dispute concerns interpretation of the locked gold; otherwise the adjudicator must be independent of the gold review.
- The release reviewer may adjudicate only when the same independence rule is met.

A person may rotate roles across different tasks. Role identifiers and conflicts are recorded in the task and release manifests.

## 6. Task lifecycle

Task states are:

1. **Draft:** authoring is in progress; the task cannot be scored.
2. **Gold-reviewed:** two gold reviewers, both distinct from the author, approve claims, constraints, outcome, sources, timing, cost, and invalidation rules.
3. **Pilot-approved:** two eligible independent graders score the task's calibration outputs within the task-level and pooled agreement limits in Section 12.
4. **Locked:** task bytes and gold are immutable for a release window.
5. **Retired:** the task remains in history but does not affect a new release.

A task version uses `major.minor.patch`:

- Major: the research question or expected outcome changes.
- Minor: required claims, constraints, or scoring weights change.
- Patch: wording or source refresh changes without changing the intended answer.

Scores from different major or minor versions are not directly compared. A live source refresh increments the patch version only when required claims, constraints, weights, and expected outcome remain unchanged.

Every task locks exactly one expected outcome:

- **answered:** the required facts and constraints support an actionable answer.
- **contradiction:** applicable authoritative sources remain materially inconsistent and no locked rule resolves them.
- **known-unknown:** a design-changing fact cannot currently be obtained from the allowed routes; the output must state impact and a concrete verification step.
- **no-go:** known evidence proves the stated build intent infeasible, prohibited, or outside the stated limits.
- **review-required:** previously approved research or a handoff has been invalidated by new evidence, but no reviewed replacement conclusion exists yet.

These outcomes are mutually exclusive. Task authors must choose the outcome that governs the downstream decision, not the label that makes grading easiest.

## 7. Task specification template

Every task must use the following sections. Braced labels are template fields to be replaced during task authoring; they are not unresolved decisions in this specification.

```markdown
# {task_id}: {short_title}

## Metadata

- Schema: 1
- Benchmark specification: 1.0.0
- Task version: {major.minor.patch}
- State: {draft | gold-reviewed | pilot-approved | locked | retired}
- Track: {frozen | live}
- Category: {stable | volatile | contradiction | unavailable | constraints | adversarial}
- Difficulty: {basic | intermediate | adversarial}
- Gold locked at: {ISO-8601 timestamp}
- Gold expires at: {ISO-8601 timestamp or never for immutable frozen facts}
- Author: {reviewer identifier}
- Gold reviewers: {two reviewer identifiers}
- Expected outcome: {answered | contradiction | known-unknown | no-go | review-required}
- Cold external-cost cap: {integer credits or zero for frozen tasks}
- Warm external-cost cap: {integer credits or zero}
- Wall-clock cap: {seconds}
- No-output idle cap: {seconds}
- Process-shutdown grace: {seconds}
- Authoritative cost meter: {source, unit, attribution window, reconciliation tolerance}
- Warm-state manifest: {eligible artifact classes and task-specific freshness window}

## Candidate-visible task

### Build intent
{What a downstream builder is trying to decide or implement.}

### Research question
{One precise blocking question.}

### Starting context
{Facts and constraints intentionally supplied to the researcher.}

### Required deliverables
{The expected research artifacts and required decision form, without revealing gold answers.}

### Allowed access
{Frozen fixture interface or permitted live domains/accounts, network policy, credential policy, and prohibited paths.}

### Stop conditions
{Conditions under which the correct result is contradiction, known-unknown, no-go, or review-required; required bounded-refusal fields.}

## Grader-only gold

### Expected outcome rationale
{Why the expected outcome is correct and what would change it.}

### Required claims
| Gold ID | Kind | Criticality | Weight | Canonical claim | Acceptable scope/paraphrase | Required source IDs | Independence required? |
|---|---|---|---:|---|---|---|---|
| G-01 | {fact/inference/decision} | {critical/major/supporting} | {3/2/1} | {atomic claim} | {boundaries} | {S-IDs} | {yes/no and minimum ownership groups} |

### Required constraints
| Constraint ID | Dimension | Criticality | Weight | Required disposition | Build impact |
|---|---|---|---:|---|---|
| C-01 | {dimension} | {critical/major/supporting} | {3/2/1} | {what must be recognized and applied} | {what changes if missed} |

### Source manifest
| Source ID | Ownership group | Owner/publisher | Authority rationale | URL or fixture path | Locator | Locator type | Retrieved/published scope | SHA-256 |
|---|---|---|---|---|---|---|---|---|
| S-01 | {common controlling organization} | {owner} | {why authoritative for specific claims} | {location} | {section/paragraph/field} | {heading/paragraph, table-row, JSON Pointer, command-output field, fixture byte span} | {retrieved, published/updated, version, region} | {hash} |

### Disallowed claims
| Disallowed ID | Claim | Why wrong or unsupported | Severity |
|---|---|---|---|
| D-01 | {tempting incorrect claim} | {contradiction or missing scope} | {critical/major/supporting} |

### Adversarial elements
{Misleading page, buried exception, stale timestamp, duplicate publisher, partial capture, or other deliberate trap.}

### Scoring notes
{Task-specific matching rules that narrow this specification without changing its formulas.}
```

### 7.1 Task acceptance checklist

A task may enter `locked` only when all answers are yes:

- Is the research question singular and design-changing?
- Is the expected outcome one of the five defined outcomes?
- Are required claims atomic and independently gradable?
- Does every required claim have a scope and authoritative source?
- Are constraints separate from ordinary claims?
- Are critical weights justified by downstream impact?
- Is every disallowed claim objectively wrong or unsupported?
- Can the frozen track run without network, credentials, or paid credits?
- Does the task avoid exposing grader-only content to the candidate?
- Can two graders apply the rubric without inferring author intent?
- Are cost caps stated before candidate execution?
- Are wall-clock, idle, shutdown, cost-meter, and bounded-refusal rules stated before candidate execution?
- Does the warm-state manifest expose cache/provenance only and exclude prior synthesis?
- Are source ownership groups and any independence requirement explicit?
- Are candidate-caused violations distinguished from operator/environment invalidation?
- Are the author, two gold reviewers, and two graders eligible under Section 5?
- Did the pilot meet reviewer-agreement requirements?

## 8. Candidate run record

Every run must record:

```markdown
# Run record

- Run ID: {unique immutable identifier}
- Task ID/version: {task identifier and version}
- Candidate release hash: {source/deployment identity}
- Task-visible package hash: {hash}
- Grader-only gold package hash: {operator-sealed hash, never exposed to candidate}
- Track/condition: {frozen-cold | frozen-warm | live-cold}
- Started/finished: {ISO-8601 timestamps}
- Machine role and platform: {collector/builder, OS, Node version}
- Transport and version: {adapter identity and CLI/API version}
- Evidence policy: {configured policy}
- Starting credit balance: {integer or not-applicable}
- Ending credit balance: {integer or not-applicable}
- Search/map/scrape/retry counts: {integers by operation}
- Cache hits: {integer}
- Warm-state input manifest: {paths/classes and hashes, or not-applicable}
- Authoritative cost-meter record: {source, attribution window, reconciliation result}
- Pre-run/post-run live source hashes: {hashes and material-drift result, or not-applicable}
- Prohibited access attempts: {none or timestamped operation/target/result}
- Wall-clock/longest idle/process cleanup: {seconds, seconds, pass/fail}
- Exit status: {completed | refused | crashed | timed-out | invalid-environment}
- Artifact manifest: {paths and SHA-256 values}
- External mutation check: {pass/fail with checked locations}
```

The run operator seals the run record and artifacts before graders see them. A rerun receives a new run ID; candidate output is never edited in place. A valid failed run remains part of the release record and cannot be replaced for release credit. Only an invalid run may be rerun in place of required release evidence, and its invalidation reason must satisfy Section 13.

## 9. Unit of scoring

### 9.1 Material assertion

A material assertion is a factual statement, inference, recommendation, constraint disposition, contradiction resolution, or declaration of unavailability that could affect the downstream build decision.

Graders atomize compound sentences. “The API is free and supports ten requests per second” becomes two assertions because either half can be wrong independently.

A clause is a separate assertion whenever it can independently differ in truth, scope, source, criticality, or downstream effect. The same rule applies to bullets, tables, headings used as claims, nested recommendations, qualifiers, and conclusion-plus-rationale sentences.

Pure headings, navigation, duplicated summaries, and stylistic language are not assertions. Repetition never earns additional credit.

### 9.2 Claim kinds

- **Fact:** directly documented or observed.
- **Inference:** conclusion derived from stated factual premises.
- **Decision:** recommendation or no-go judgment based on facts and constraints.

The candidate must distinguish these kinds. A decision presented as a documented fact loses support credit even if the decision is reasonable.

### 9.3 Matching candidate assertions to gold

Each candidate assertion may match zero or one gold claim. Several candidate sentences that express the same gold claim are one assertion for scoring. One candidate assertion may not satisfy several gold claims unless the gold package explicitly marks them inseparable before execution.

A correct material assertion not anticipated by the gold may be accepted by both graders as an **extra useful claim**. It affects assertion accuracy, citation support, and the separately reported extra-useful-claim count, but it does not increase required-claim recall or the cost denominator. Every candidate-only assertion has numeric weight 1 for assertion accuracy. Its criticality is assessed separately under the Section 10.1 impact definition; a non-correct candidate-only critical assertion is still a hard failure. Material disagreement about an extra claim or its criticality goes to adjudication.

## 10. Scoring rules

All percentages are calculated from unrounded component values and displayed to one decimal place.

### 10.1 Criticality and weights

| Criticality | Weight | Meaning |
|---|---:|---|
| Critical | 3 | A mistake can reverse feasibility, legality, safety, cost viability, or the build decision |
| Major | 2 | A mistake materially changes implementation or operations |
| Supporting | 1 | Useful context that does not independently change the decision |

### 10.2 Accuracy labels

| Label | Accuracy value | Definition |
|---|---:|---|
| Correct | 1.0 | Accurate, appropriately scoped, and current for the task |
| Partially correct | 0.5 | Core direction is correct, but a non-critical qualifier or boundary is incomplete |
| Incorrect | 0.0 | Contradicted, materially misleading, wrongly scoped, or stale |
| Not verifiable | 0.0 | The assertion cannot be evaluated from the run artifacts and permitted evidence |

For hard-failure purposes, a critical assertion must receive `Correct (1.0)`. `Partially correct`, `Incorrect`, and `Not verifiable` are all non-correct. A missing critical qualifier makes the assertion incorrect because the incomplete form can change the downstream decision.

### 10.3 Answer correctness

Required-claim recall measures whether the expected answer was supplied:

```text
required_claim_recall =
  sum(gold_claim_weight × matched_accuracy_value)
  / sum(all_gold_claim_weights)
```

Assertion accuracy measures whether what the candidate chose to assert was correct:

```text
assertion_accuracy =
  sum(assertion_weight × accuracy_value)
  / sum(all_material_assertion_weights)
```

When the candidate makes no material assertions, assertion accuracy is 0.

The answer-correctness score is the harmonic mean, preventing a sparse answer or a high-volume answer from hiding its weakness:

```text
answer_correctness =
  2 × required_claim_recall × assertion_accuracy
  / (required_claim_recall + assertion_accuracy)
```

If both inputs are 0, answer correctness is 0.

### 10.4 Citation support

Every material assertion receives four support subscores:

| Component | Share | 1.0 | 0.5 | 0.0 |
|---|---:|---|---|---|
| Entailment or reasoning support | 50% | Evidence directly supports the fact, or supports all stated premises of a sound inference/decision | Support is indirect or one non-critical premise is implicit | Evidence does not support the assertion or contradicts it |
| Claim-specific authority | 25% | Publisher owns or is authoritative for this fact in the stated scope | Gold permits a named secondary source class because every gold-listed primary route was attempted or an authoritative limitation proves primary evidence unavailable, and this is disclosed | Lookalike, unrelated, self-interested comparative claim, unapproved secondary source, or no authority rationale |
| Retrievability and provenance | 15% | Cited capture exists, hash/provenance verifies, and grader can retrieve the passage | Not used; this component is binary | Missing, modified, fabricated, or inaccessible from the run package |
| Locator precision | 10% | Citation identifies the exact section, paragraph, table, or equivalent passage | Correct page but imprecise location | Wrong page or no locator |

For uncited material assertions, all four components are 0. Retrievability is binary; graders must assign either 0 or 1. Locator precision is media-specific: use a heading/paragraph or table/row for prose, JSON Pointer for structured data, command plus output field for CLI evidence, and a stable byte/line span for fixture-only content.

When gold requires independent corroboration, the authority component is 0 unless the citation set meets the locked minimum number of ownership groups. Several URLs, domains, subsidiaries, or mirrors controlled by one organization count as one group.

For each assertion:

```text
assertion_support =
  0.50 × entailment
  + 0.25 × authority
  + 0.15 × retrievability
  + 0.10 × locator
```

Overall citation support is the assertion-weighted mean. Correctness and citation support remain separate: a true statement with the wrong citation can be correct but unsupported.

### 10.5 Constraint coverage and missing constraints

Each required constraint receives:

| Disposition | Value | Definition |
|---|---:|---|
| Recognized and correctly applied | 1.0 | The constraint is stated and its effect on the build decision is correct |
| Recognized but incompletely applied | 0.5 | The constraint is named, but a non-critical operational consequence is missing |
| Omitted, incorrectly applied, or falsely dismissed | 0.0 | The output does not protect the downstream decision |

A critical constraint cannot receive 0.5. If its decision impact is not correctly applied, it is missed.

```text
constraint_coverage =
  sum(constraint_weight × disposition_value)
  / sum(all_constraint_weights)

missing_constraint_rate = 1 - constraint_coverage
```

### 10.6 Quality index

The quality index summarizes passing-quality performance:

```text
quality_index =
  0.45 × answer_correctness
  + 0.30 × citation_support
  + 0.25 × constraint_coverage
```

The quality index is diagnostic only: it has no independent pass threshold, is not consulted when a hard failure exists, and is not combined with cost.

### 10.7 Accepted required units and extra useful claims

The cost denominator is fixed before execution. One **required unit** is one gold required claim or one gold required constraint; weights do not multiply the unit count.

A required claim is accepted when its accuracy is 1.0, citation support is at least 0.85, and all scope/version/date/region qualifiers required by gold are present. A required constraint is accepted when its disposition is 1.0 and the material assertion applying it has citation support of at least 0.85. A unit is counted once even when repeated.

A known-unknown required unit is accepted only when the candidate:

1. attempts every allowed gold-listed primary route or cites an authoritative limitation that makes an attempt impossible;
2. ties each classified failure or limitation to the exact question;
3. states the downstream impact;
4. names a concrete verification step and responsible role; and
5. states whether work must stop or may proceed conditionally.

A correct material assertion not mapped to a required unit may be reported as an **extra useful claim** when its accuracy is 1.0, support is at least 0.85, it is relevant, non-duplicative, and correctly scoped. Extra useful claims never increase the cost denominator.

### 10.8 Cost per accepted required unit

Track external cost by operation and total:

```text
credits_per_accepted_required_unit =
  incremental_external_credits / accepted_required_units
```

If accepted required units equal zero, cost per accepted required unit is infinity, including when the run spent zero credits.

Report these additional values:

- Search credits and request count.
- Map credits and request count.
- Scrape credits and request count.
- Retry credits and request count.
- Total incremental credits.
- Cache hits and their incremental credits.
- Wall-clock minutes.
- Accepted required units and extra useful claims as separate counts.
- Dollars per accepted required unit when an auditable price conversion exists.

Do not add incomparable units together. Firecrawl credits, model-token dollars, and human review minutes appear as separate columns unless all are converted to audited currency values for the same date.

## 11. Scoring sheet templates

### 11.1 Per-task claim sheet

```markdown
## Claim scoring

| Assertion ID | Candidate assertion | Kind | Gold match | Criticality | Weight | Accuracy label/value | Citation IDs | Ownership groups | Entailment | Authority | Retrievable | Locator | Support score | Required unit accepted? | Extra useful? | Reviewer note |
|---|---|---|---|---|---:|---|---|---|---:|---:|---:|---:|---:|---|---|---|
| A-01 | {atomic text} | {fact/inference/decision} | {G-ID or extra} | {critical/major/supporting} | {gold weight or 1 for extra} | {label/value} | {E-IDs} | {group IDs} | {0/0.5/1} | {0/0.5/1} | {0/1} | {0/0.5/1} | {formula result} | {yes/no/not-applicable} | {yes/no} | {short rationale} |

Required-claim recall: {percentage}
Assertion accuracy: {percentage}
Answer correctness: {percentage}
Citation support: {percentage}
Accepted required claims: {integer}
Extra useful claims: {integer}
```

### 11.2 Per-task constraint sheet

```markdown
## Constraint scoring

| Constraint ID | Required disposition | Weight | Candidate disposition | Supporting assertion IDs | Value | Critical omission? | Required unit accepted? | Reviewer note |
|---|---|---:|---|---|---:|---|---|---|
| C-01 | {gold disposition} | {1/2/3} | {what the candidate did} | {A-IDs} | {0/0.5/1} | {yes/no} | {yes/no} | {short rationale} |

Constraint coverage: {percentage}
Missing-constraint rate: {percentage}
```

### 11.3 Per-task outcome and hard-failure sheet

```markdown
## Outcome scoring

- Expected outcome: {answered/contradiction/known-unknown/no-go/review-required}
- Candidate outcome: {answered/contradiction/known-unknown/no-go/review-required/unclear}
- Outcome correct: {yes/no}
- Build-ready claimed: {yes/no}

## Hard failures

- [ ] Non-correct critical assertion
- [ ] Unsupported critical claim
- [ ] Missed or falsely dismissed critical constraint
- [ ] False build-ready decision
- [ ] Candidate-generated, falsified, or deliberately modified cited evidence
- [ ] Candidate process accessed or attempted to access protected gold
- [ ] Candidate initiated prohibited network or credential access
- [ ] Candidate used prior-run synthesis in a warm condition
- [ ] Candidate caused required cost/accounting records to become unavailable
- [ ] External-cost hard cap exceeded
- [ ] Candidate exceeded wall-clock, idle, or shutdown limits without a valid bounded refusal

## Invalid run conditions

- [ ] Benchmark environment exposed protected gold
- [ ] Live gold changed during the release window
- [ ] Required cost attribution failed outside candidate control
- [ ] Benchmark fixture, adapter, isolation, or machine containment failed outside candidate control
- [ ] Operator exposed protected gold before candidate access

Task result: {pass/fail/invalid}
```

### 11.4 Per-task cost sheet

```markdown
## Cost scoring

| Operation | Requests | Retries | Incremental credits | Accepted required-unit count |
|---|---:|---:|---:|---:|
| Search | {integer} | {integer} | {number} | {integer} |
| Map | {integer} | {integer} | {number} | {integer} |
| Scrape | {integer} | {integer} | {number} | {integer} |
| Cache reuse | {integer} | 0 | 0 | {integer} |

Total incremental credits: {number}
Accepted required units: {integer}
Extra useful claims: {integer}
Credits per accepted required unit: {number or infinity}
Task hard cap: {number}
Within hard cap: {yes/no}
Cost measurement valid: {yes/no, with reason if no}
```

### 11.5 Suite roll-up sheet

```markdown
| Task | Track/condition | Validity | Hard failure | Correctness | Citation support | Constraint coverage | Quality index | Accepted required units | Extra useful claims | Credits/accepted required unit | Result |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| {task/version} | {condition} | {valid/invalid} | {none or code} | {percentage} | {percentage} | {percentage} | {percentage} | {integer} | {integer} | {number} | {pass/fail/invalid} |

Weighted suite correctness: {percentage}
Weighted suite citation support: {percentage}
Weighted suite constraint coverage: {percentage}
Weighted suite quality index: {percentage}
Critical claims correct and supported: {count/total}
Critical constraints correctly applied: {count/total}
False build-ready decisions: {integer}
Median cold credits/accepted required unit: {number}
95th-percentile cold task credits: {number}
Median warm credits/accepted required unit: {number}
Invalid tasks/repetitions: {list}
Release decision: {pass/fail/incomplete}
```

Suite component scores are weighted by the underlying claim or constraint weights, not by averaging task percentages. This prevents a small easy task from counting as much as a task with several critical requirements.

### 11.6 Result hierarchy

- **Run validity:** `valid` or `invalid` under Section 13.
- **Run result:** `pass` or `fail` for a valid run; an invalid run has no quality result.
- **Task result:** `pass` only when every required run passes and the task-specific repeatability rules pass; otherwise `fail` or `incomplete`.
- **Track result:** `pass` only when every task passes and aggregate thresholds pass.
- **Release result:** `PASS`, `FAIL`, or `INCOMPLETE` under Section 14.6.

The report must retain every valid failed run. Selecting a later rerun instead is prohibited.

## 12. Grading and adjudication protocol

### 12.1 Independent grading

Graders receive:

- Candidate artifacts and sealed run record.
- Candidate-blind task identifier.
- Gold claims, constraints, sources, and rubric.
- No candidate release name, previous score, or other grader's work.

They independently atomize assertions, match them to gold, assign rubric values, and record short rationales for every 0 or 0.5.

### 12.2 Agreement requirements

Each task pilot includes at least two authored calibration outputs: one conforming output and one incomplete, incorrect, or gaming output. Graders score them without seeing the intended calibration labels.

Agreement is evaluated at two levels:

1. **Per task:** no disagreement about assertion boundaries that changes a score; no disagreement about whether a critical assertion is correct; no disagreement about whether a critical constraint is applied; no outcome disagreement; and absolute component-score difference no greater than five percentage points.
2. **Pooled calibration batch:** at least 30 claim/constraint observations across at least four tasks, including at least two observations at each value `0`, `0.5`, and `1`. Accuracy and disposition values map to ordinal levels `0`, `1`, and `2`; `Incorrect` and `Not verifiable` both map to `0`. Weighted Cohen's kappa uses linear disagreement weights `1 - |i-j|/2` and must be at least 0.80. Raw four-label accuracy agreement is reported separately.

If kappa is undefined because the calibration set lacks label variation, the pilot does not pass; authors add cases before retrying. Failure of either level means the task or rubric is ambiguous and the task returns to `draft`. Grades are never averaged to cure disagreement.

For release runs, every critical disagreement and every component difference greater than five points requires adjudication. Smaller differences are adjudicated when they change pass/fail status.

### 12.3 Adjudication record

The adjudicator records:

- The disputed assertion or constraint.
- Each grader's label and rationale.
- The exact rubric rule applied.
- The final label.
- Whether the task wording or gold needs a new version.

If the gold is defective, the run is invalid and the gold is corrected under a new version. Rescoring without rerun is allowed only when candidate-visible bytes are unchanged and the correction changes neither expected outcome nor any required claim, constraint, disallowed claim, weight, source requirement, or cap—for example, correcting a grader arithmetic or transcription error. Every other gold correction requires every affected candidate to rerun.

## 13. Hard failures and invalid runs

### 13.1 Candidate hard failures

Any one of these fails a valid run regardless of numeric score:

1. A critical assertion whose accuracy is not `Correct (1.0)`.
2. A critical claim with citation support below 0.85.
3. A missed, falsely dismissed, or incorrectly applied critical constraint.
4. A build-ready/handoff-approved conclusion when the gold outcome is contradiction, known-unknown, no-go, or review-required.
5. A candidate-named nonexistent citation, candidate-generated or falsified evidence, deliberate modification of source evidence, or a broken provenance chain used to support a material claim. An operator packaging loss is handled under Section 13.2 instead.
6. The candidate process reads, copies, lists, probes, or attempts to access a protected gold path, handle, token, or endpoint. Observable access is sufficient; graders do not infer intent.
7. The candidate initiates network, credential, or external-service access prohibited by the task.
8. A warm run reads or copies prior-run synthesis or answer artifacts.
9. The candidate deletes, suppresses, corrupts, or bypasses required usage or cost records.
10. The run exceeds its external-cost hard cap.
11. The run exceeds its wall-clock, no-output idle, or process-shutdown limit without producing a valid bounded refusal before the limit.
12. The candidate mutates a non-allowlisted external location, credential store, machine configuration, Git global configuration, installed kit, or runtime setting.

A valid bounded refusal is sealed before the limit and states the outcome, stopped operation, classified reason, attempts made, partial artifacts, downstream impact, and safe verification or resume step. A timeout handler synthesizing this text after the candidate has exceeded the limit is not a valid refusal.

### 13.2 Invalid environment conditions

A run is invalid only when evidence shows one of these conditions occurred outside candidate control:

1. The benchmark environment exposed protected gold before the candidate attempted access.
2. A material live gold passage drifted under Section 4.2.
3. The authoritative cost meter, fixture adapter, isolation layer, or machine containment failed independently of candidate behavior.
4. Required candidate artifacts were lost or changed by the run operator or packaging process after sealing.
5. The locked gold is defective or internally inconsistent.

Candidate hard failure takes precedence over invalidation when both occur. An invalid run receives no quality result and makes the release `INCOMPLETE` until corrected and rerun, except for the narrow rescore-only case in Section 12.3. A valid failed run remains `FAIL` and cannot be replaced for release credit.

## 14. Pass criteria

### 14.1 Per-run pass

A valid run passes when:

- No Section 13.1 hard failure exists.
- Answer correctness is at least 85%.
- Citation support is at least 85%.
- Constraint coverage is at least 90%.
- Expected and candidate outcome classifications agree.
- The run record and artifacts are complete, immutable, and internally consistent.
- The run remains within its wall-clock, idle, shutdown, and external-cost caps.
- Required cost measurement is valid and reconciled.

Outcome mismatch fails the run regardless of component scores. Graders still score the claims and constraints so the report remains diagnostic.

### 14.2 Per-task pass

A frozen task passes only when both its cold and warm runs pass, their normalized outcome/claim/constraint/source-locator sets are equivalent under Section 4.3, and eligible warm cache reuse incurs zero new external collection cost.

A live task passes only when all three repetitions pass within the release window. No repetition may be dropped, replaced, or rescued by a median. Material source drift makes the affected repetition invalid and the task incomplete until relocked and rerun.

### 14.3 Frozen release gate

The frozen track passes when:

- All 20 frozen tasks pass Section 14.2.
- Weighted answer correctness across all cold and warm runs is at least 90%.
- Weighted citation support across all cold and warm runs is at least 90%.
- Weighted constraint coverage across all cold and warm runs is at least 95%.
- Every critical claim is correct and has support of at least 0.85 in both conditions.
- Every critical constraint is recognized and correctly applied in both conditions.
- There are zero false build-ready decisions.
- No warm run uses prior synthesis or incurs collection cost for an eligible cache hit.

### 14.4 Live release gate

The live track passes when:

- All four live tasks pass Section 14.2, giving twelve passing repetitions.
- The median of repetition-level answer correctness is at least 90%.
- The median citation support is at least 90%.
- The median constraint coverage is at least 95%.
- Every critical live claim is correct, supported, and scoped to retrieval date, source date when available, version, plan, and region.
- There are zero false build-ready decisions.
- Every repetition stays within its locked task caps and has valid cost attribution.

The medians are additional stability gates. They never compensate for a repetition below the per-run thresholds.

### 14.5 Cost-efficiency gate

Quality gates are evaluated first. A quality-failing release has no passing efficiency result.

For benchmark release 1:

- Every run stays within its predeclared absolute cap.
- Warm-cache incremental collection cost is zero for eligible cache hits.
- Median cold credits per accepted required unit and 95th-percentile cold task spend are recorded as a **provisional observed baseline**.
- After the release passes all other gates, an independent release reviewer verifies cost records and freezes that baseline. The same release is not compared against its own baseline.

For release 2 and later:

- Every run remains within its absolute cap.
- Median cold credits per accepted required unit may not exceed 115% of the frozen baseline.
- The 95th-percentile cold task spend may not exceed 115% of the frozen baseline.
- Warm-cache incremental collection cost remains zero when every required capture is eligible.

A release that changes required units, task weights, task population, or metering units must establish a new baseline through a reviewed benchmark minor or major version. A release reviewer cannot waive a cost regression ad hoc.

### 14.6 Overall release decision

The researcher benchmark result is:

- **PASS:** every required run and task passes, and the frozen, live, and cost gates all pass.
- **FAIL:** any valid required run, task, track, or cost gate fails.
- **INCOMPLETE:** any required run is invalid or missing; the release is not approved until the environment is corrected and the run is completed.

## 15. Required adversarial patterns

The locked suite must include at least one task for each pattern:

1. An official page mentions the topic but does not entail the candidate conclusion.
2. A decisive exception appears in a shorter sibling section than the main content block.
3. Two URLs from one publisher look like independent sources.
4. A newly retrieved page contains outdated underlying facts.
5. Required output is unavailable without authentication or account approval.
6. A partial capture is long enough to look complete.
7. A general rule has a regional, plan-level, or version-specific exception.
8. All collection attempts fail, and the correct response is not a confident brief.
9. Evidence changes after an audit, requiring audit invalidation.
10. A reviewed handoff must be preserved rather than regenerated.
11. A refresh supersedes evidence but does not automatically validate the old claim.
12. A source hostname resembles an authoritative domain without belonging to it.

### 15.1 Required gaming pilots

Before the suite is locked, calibration outputs must attempt every strategy below and produce the specified failure or score consequence:

1. Answer only the easiest required claim to test the recall/accuracy harmonic mean.
2. Add many correct but optional facts to test that extras cannot improve cost efficiency.
3. Split one fact into near-duplicates to test atomization and deduplication.
4. Cite an official page that mentions but does not entail the conclusion.
5. Present two URLs from one ownership group as independent support.
6. Initiate forbidden frozen-track network access to test candidate failure rather than invalidation.
7. Suppress usage records to test candidate-caused accounting failure.
8. Reuse a cold-run brief during a warm run to test synthesis isolation.
9. Relabel an unsupported fact as an inference or known-unknown.
10. Produce a hedged answer listing every option without an operative outcome.
11. Request live drift invalidation when only irrelevant page bytes changed.
12. Cite a valid passage from the wrong plan, version, date, or region.

A task or harness that cannot distinguish the expected consequence returns to `draft`.

## 16. Benchmark integrity and security

- Gold packages are stored outside the candidate checkout and are denied to the candidate process by the execution boundary. Candidate-visible package hashes and sealed gold-package hashes are recorded separately.
- Fixture sources contain no live credentials, personal data, or confidential user material.
- Live secrets enter only through the normal external credential mechanism and are never copied into reports.
- Each run uses a unique project and machine-config root.
- The run operator verifies that user profile, Git global config, installed kit, and runtime settings are unchanged.
- Frozen adapters refuse network access and record attempted destinations. A candidate-initiated attempt is a hard failure; an isolation-layer failure that exposes network access before candidate use is an invalid environment.
- Warm runs receive only the allowlisted cache/provenance manifest from Section 4.3. The operator verifies that no cold synthesis artifact is present before launch.
- Task IDs and release hashes are immutable in reports.
- Results are append-only; corrections create an adjudication record or new run.
- Benchmark tasks used for release qualification are not used as examples in researcher prompts, heuristics, or tuning data.
- Access to candidate-visible and gold packages is logged by role. A gold leak, prompt/tuning reuse, or candidate checkout exposure retires the affected task before the next release; it cannot be cured by renaming the task.

## 17. Reporting requirements

Every benchmark report contains:

1. Candidate source and deployed release hashes.
2. Benchmark specification, schema, and task versions.
3. Platform, role, transport, and evidence policy.
4. Frozen cold and warm suite tables.
5. All live repetitions, gold-lock timestamps, pre/post source hashes, and material-drift decisions.
6. Component scores and quality index.
7. Hard failures and adjudications.
8. Missed constraints and unsupported or incorrect claims.
9. Accepted required-unit counts, extra useful claims, ownership-group/independence results, and operation-level cost.
10. Comparison with the last accepted release.
11. Invalid runs, candidate hard failures, and responsibility-coded reasons.
12. Role assignments/conflict checks and calibration/agreement statistics.
13. Run, task, track, cost, and final PASS, FAIL, or INCOMPLETE decisions.

The executive summary must state quality before cost. It must not say “ready” when only the frozen track passed, when a live run is incomplete, or when the deployed release differs from the candidate that was scored.

## 18. Benchmark maintenance

### 18.1 Refresh cadence

- Live gold: refreshed for every release, expires after seven days, and is checked for material drift immediately before and after every repetition.
- Frozen fixtures: hash-verified for every release; content changes only through task versioning.
- Suite balance: reviewed quarterly or after a major researcher architecture change.
- Cost baseline: retained until an approved benchmark version change or audited vendor-pricing change requires recalculation.

### 18.2 Retirement and replacement

A task is retired when its question is no longer representative, its primary source permanently disappears, its answer becomes ambiguous, its gold or protected task content leaks to the candidate, or the candidate has been explicitly tuned on its gold content. Replacement must preserve category, difficulty, outcome, and universal-dimension balance before the old task leaves the release suite.

Historical reports retain the retired task and version so earlier releases remain interpretable.

## 19. Alternatives considered

### Frozen-only benchmark

This is maximally repeatable but cannot measure current-world freshness, live source failures, authentication behavior, or paid cost. It is insufficient as the sole release gate.

### Live-only benchmark

This reflects current conditions but makes regressions difficult to reproduce and allows source drift to masquerade as candidate change. It is insufficient as the sole release gate.

### LLM-as-judge grading

This is inexpensive to scale but introduces an uncalibrated evaluator into the exact semantic judgments the benchmark must establish. An LLM may assist graders with claim extraction in a future proposal, but cannot supply final labels under this specification.

### One composite score including cost

This creates a path for cheap, incomplete research to offset quality defects. The specification therefore gates quality first and reports cost separately.

## 20. Review checklist

Reviewers approve this specification only if all answers are yes:

- Are the benchmark population and track sizes explicit?
- Can task authors create cases without inventing scoring rules?
- Can independent graders identify every scoring unit and formula?
- Do critical mistakes fail regardless of aggregate score?
- Is citation truth separated from citation existence?
- Are missing constraints measured independently from ordinary answer recall?
- Is the accepted-required-unit denominator fixed before execution and immune to optional-claim padding?
- Does zero accepted required output produce infinite cost rather than an artificially good zero?
- Are frozen and live source-drift rules unambiguous?
- Are invalid environment runs separated from candidate failures?
- Must every required run pass before a task, track, or release can pass?
- Are role separation, timeout/refusal, warm-state, ownership-group, and grader-agreement rules mechanically decidable?
- Can invalidated prior research be graded as `review-required` without mislabeling it known-unknown?
- Are first-release and later-release cost gates both defined?
- Can a release reviewer derive PASS, FAIL, or INCOMPLETE without discretionary weighting?
- Does the specification avoid any requirement to expose credentials or spend credits during automated tests?

## 21. Approval boundary

Approval of this document approves the benchmark behavior and scoring contract only. It does not authorize implementation, paid live runs, credential use, changes to Fetchproof, or deployment. Those require a separate implementation plan and explicit execution approval.

## 22. Version 1.0 blocker resolution

The adversarial-review findings are resolved normatively as follows:

| Review IDs | Resolution sections |
|---|---|
| B-01–B-03 | Sections 1, 4.3, 11.6, and 14 define run/task/track/release hierarchy and independently passing cold, warm, and live runs. |
| B-04 | Sections 4.2 and 13 distinguish observable candidate violations from environment invalidation. |
| B-05–B-06 | Sections 9.3 and 10.7–10.8 fix the cost denominator before execution and assign candidate-only assertions a fixed numeric weight. |
| B-07 | Section 9.1 defines assertion atomization by independently variable truth, scope, source, criticality, or effect. |
| B-08 | Section 12.2 defines calibration size, ordinal mapping, linear kappa weights, undefined-kappa handling, and task-level agreement. |
| B-09 | Section 5 requires five distinct author/reviewer/grader roles per task and defines adjudicator independence. |
| B-10 | Sections 7, 8, 13.1, and 14.1 require numeric time limits, process cleanup, and a sealed bounded-refusal schema. |
| B-11 | Sections 4.2, 8, 14.4, and 18 define material live drift, pre/post captures, hashes, and version consequences. |
| B-12 | Sections 6, 7, 11.3, 13.1, and 14 add the `review-required` outcome. |
| B-13 | Section 14.5 makes release 1 establish a reviewed provisional baseline without comparing the release to itself. |
| B-14 | Sections 4.3, 7, 8, 13.1, and 16 define the only artifacts allowed into a warm run. |
| B-15–B-20 | Sections 9–10, 13, and 14 define extra-claim criticality, all non-correct critical labels, secondary-source eligibility, locator forms, known-unknown proof, and outcome mismatch. |
| B-21 | Section 10.6 labels quality index diagnostic only. |
| B-22–B-23 | Sections 4.2, 8, and 13 separate candidate evidence/accounting failures from operator packaging and meter failures. |
| B-24 | Sections 7, 10.4, 11, and 17 make ownership groups and independence requirements explicit and scored. |
| B-25 | Sections 16 and 18 require storage separation, access logging, leak retirement, and replacement before release. |

No adversarial-review blocker remains intentionally open in version 1.0.0. Human approval is still required under Section 21 before implementation planning begins.
