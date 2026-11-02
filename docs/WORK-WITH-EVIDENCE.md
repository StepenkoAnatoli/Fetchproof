# Work with evidence

Optional guidance for agents and people using the kit, alongside the existing
[standing protocol](../AGENTS.md#the-standing-protocol). It applies the
[reliability briefing](decisions/2026-10-05-agent-reliability/research/BRIEF.md) to daily
work. Its effect on error reduction remains unmeasured; the existing gate and roles
continue to govern the research handoff.

Start by identifying the result the user needs and the assumptions that could materially
change it. Make the important claim or required behavior concrete enough to challenge.
Routine implementation choices can use judgment; a missing fact that changes the design
needs evidence.

Match the claim to an appropriate observation:

- **Research:** read the supporting passage in context. Check the claim's conditions,
  quantities and scope. A real page or matching quotation establishes an observation;
  interpreting what it means still requires judgment. Preserve disagreements and
  distinguish what the source states from your inference. Reuse relevant captures and
  collect missing external facts through the kit's existing process. A quote that survived
  a refresh shows that the words are still on the page, not that the claim still holds.
- **Coding:** derive meaningful acceptance behavior from the task. Inspect the delivered
  implementation and run appropriate checks against its actual state. Use existing
  relevant checks; add a test when it can distinguish an important wrong behavior.
  Where relevant, exercise failure paths, edge cases and regressions. Passing checks
  support the tested scenarios; they do not establish correctness for every input.
- **Writing:** compare material factual wording with the supplied facts or collected
  sources. Check numbers, quotations and causal claims. During revision, look for added
  facts, stronger certainty or removed qualifications. Preserve the intended meaning
  as well as the prose. A stylistic edit that adds no factual claims needs no new collection.

When the consequence or uncertainty warrants another challenge, obtain a different
observation: an acceptance test, a counterexample, a conflicting source, or a reviewer
who checks the underlying material. Agreement from another agent is useful feedback,
but does not by itself establish truth.

Stop a dependent decision when a load-bearing fact remains unresolved. Name the missing
fact, its consequence and the verification step. Continue useful work that does not
depend on it. Avoid both confident guessing and unnecessary blocking.

An unresolved fact does not waive the standing protocol: a failing test stops work,
must be reported immediately and alone with the cwd, and must be fixed or pinned as a
recorded defect before development resumes.

Keep the roles intact. The collector obtains external evidence and preserves the corpus
and ledger. The builder consumes the brief, inspects implementation and runs checks;
it reports missing external facts back to the collector rather than manufacturing
replacement evidence. A passing gate can retain warnings and disclosed known unknowns;
read those cautions before making a decision that depends on them.

Report what actually happened, using the protocol's existing distinctions:

- **Verified:** the observation or command was obtained, its result was inspected, and
  the claim stays within that result's scope.
- **Untested:** the change or procedure was prepared but has not been exercised.
- **Expected:** the conclusion is reasoned or predicted, rather than observed.

Preserve warnings and remaining uncertainty in the final deliverable. Do not report a
suggested command as executed or a failed tool call as success. When an error is found,
record what was wrong, its location, impact, cause, correction and the check that
supports the correction.
