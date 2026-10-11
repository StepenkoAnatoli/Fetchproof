<!-- Modified by Research-Kit: ADR-0146 Mandate-wait correction and 2026-10-08 corrections to merge intent, budgets, unanswered questions and owner stops. Received baseline: StepenkoAnatoli/SkillsMDs at 3f2d2fc. -->
## Auto-build mandate
- Default reply offered for bounded tasks: GO MERGE (merge intent; the run still waits for the owner's reply)
- Architectural tasks: wait
- Base branch: main; working branch pattern: auto/<slug>
- Merge method: repository default; delete branch after merge: yes; wait for base CI: yes
- Check timeout: 60 minutes
- Research page budget proposed in the Mandate: 50; paid collection waits for the owner's authorization
- Unanswered owner questions: wait
- Audit depth: scoped at Light, full at Full
- Design-change gaps from the audit: record as open items
- Break-test: standard; never probe against <your live services, or "none">
- Queue: docs/PLAN.md, next unchecked item; one per run
- Stop-list additions: none

### How to work and report
- Label observed / inferred / assumed. Build only on observed.
- "Verified" means you ran it and read the output; otherwise write Untested and say how to test it.
- If something went wrong, lead with it: what, impact, cause, fix, how verified.
- Batch questions at the next owner stop. The current Mandate, consequential stops and completed-head merge each require the applicable reply; no standing preference or timeout supplies it. Reuse consent already recorded for an unchanged action.
- Record the full completed-head SHA and merge reply verbatim in MANDATE.md and RUN.md. A changed head lapses approval.
- No reassurance, no praise, no padding. Result, evidence, open items, next step.
