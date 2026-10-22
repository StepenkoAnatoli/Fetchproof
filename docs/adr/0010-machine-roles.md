# ADR-0010 — The kit runs on two machines, and a machine declares which half it is

- **Date:** 2026-09-14
- **Status:** accepted
- **Area:** machine policy, collection, diagnostics

## Context

The kit was written as if one machine does both halves of the job: collect the evidence
with Firecrawl, then build from it. That stopped being true the moment the work moved
across two boxes.

```
COLLECTOR (the operator's PC)          BUILDER (a sandbox, a CI box, a second laptop)
  Firecrawl key                          no key, no egress to firecrawl.dev
  decompose + research                   builds from research/BRIEF.md
  produces the evidence corpus           consumes the corpus that travelled
```

On a builder machine, `doctor` reported:

```
fail  firecrawl-auth   not authenticated (keyless is blocked from this IP) - run: firecrawl login --api-key fc-...
```

That is not a defect on that machine. It is the expected state, stated permanently and
loudly enough to be ignored — and a gate that is always red is a gate nobody reads. The
first FAIL in every run teaches the reader to skim the column, which is how this kit's
whole design (a small number of findings that each mean something) stops working.

The mirror image is worse, because it is silent. A builder cannot collect, so a builder
asked to research falls back on whatever transport its agent can reach — a page fetch
tool, a browser, a hand-written file. This repository's ledger carries **five
non-Firecrawl transport rows** produced exactly that way (`transport: 'agent page
fetch'`, no Firecrawl egress). They are honest rows about a machine doing the wrong
job, and nothing in the kit said the job was wrong. Meanwhile `doctor` said nothing
about the thing that does matter on a builder: that it must not collect at all.

## Decision

**A machine declares its role, and the role changes what the machine is held to.**

- The role lives in the machine config: `role: 'collector' | 'builder'` in
  `~/.agents/fetchproof.config.json`, read by `machineRole()` and answered in policy
  form by `collectionPolicy()` — both in `lib/machine.mjs`, which owns every
  machine-scoped location (ADR-0002).
- **The default is `collector`.** A missing, unknown, or corrupt value reads as
  `collector`. That is the stricter role (a collector without a key *is* blocked), so a
  machine that was never told its role is held to the higher standard, and an existing
  install behaves exactly as it did before this field existed.
- **collector:** `firecrawl-auth` and `firecrawl-cli` keep their current severity — a
  collector without a key cannot collect, and that is a FAIL.
- **builder:** both become informational (severity `pass`, with the reason in the
  detail). The builder is held instead to the thing that matters on a builder:
  **it must not collect.** That rule is a policy, not the absence of a key:
  - `bin/research.mjs` and `bin/decompose.mjs` refuse to run on a builder-role machine
    (exit 2, before any credential or adapter is consulted), naming the collector and the
    remedy. `--dry-run` and `--status` still work: they spend nothing, and a builder
    needs to be able to see what would happen.
  - `doctor` reports `machine-role` on every run, so the role and its consequence are
    visible rather than inferred.
  - The way to collect there is to say so: `install-hooks.mjs --role collector`. It is a
    deliberate, recorded act in a config file, not a per-command override.
- The declared role also shapes setup text: `install.mjs` stops telling a builder to log
  in to Firecrawl, and points it at the corpus and `bin/handoff.mjs` instead (ADR-0011).

## Consequences

- `doctor` says something different on each machine about the same project, on purpose:
  the machine's capability to collect is exactly what differs, and the report is about
  the machine.
- A builder with a Firecrawl key still does not collect — the refusal is the policy, not
  the credential. That is the point: the five-row defect happened on a keyless machine,
  through a fallback the kit never forbade.
- The role is machine state, outside the repository, so the same clone keeps one
  `git`-visible shape on both boxes; nothing about the corpus or its gate changes.
- Cost: one more machine-level setting to explain, and a builder that genuinely needs a
  one-off collection must flip the role (deliberately) rather than pass a flag. Accepted:
  a per-command escape hatch is the silent-bypass shape this kit already refuses
  elsewhere (the three overrides are all logged).

## Alternatives considered

- **One role; live with the noise.** Rejected, and this is the alternative the task
  named. It is cheap and requires no code, but it produces a permanent FAIL on every
  builder run, and it says nothing about the failure that actually happened there. The
  FAIL trains people to ignore the column; the silence leaves the five-row defect
  possible. Both halves of the defect survive.
- **Detect the role from the environment (is there a key? is the CLI installed?).**
  Rejected. A keyless collector between key rotations is indistinguishable from a
  builder, so doctor would go quiet on a collector that is genuinely misconfigured — the
  worse error. And the prohibition must be *stated*: a builder whose rule is "you have no
  key" is one `firecrawl login` away from collecting an uncollectable corpus.
- **Stamp the machine role into every ledger entry, so builder-side collection can be
  detected after the fact.** Rejected. The field is written by the same tool that would
  be bypassed; it cannot attribute entries written before it existed; and a legitimate
  `git pull` of a corpus the collector grew is indistinguishable from local collection,
  so it would raise false alarms on exactly the machines that behave correctly.
  Prevention at the CLI is the enforceable half.
- **A `--allow-collect` flag for the odd case.** Rejected. An override that leaves no
  record is the shape ADR-0002 and the overrides log exist to refuse; flipping the role
  is the recorded version of the same act.
- **Make the role a project setting (`research/kit.json`) instead of machine state.**
  Rejected: the same project is legitimately collected on one box and built on the other,
  so the role cannot travel with the corpus. (The guarded code paths in `kit.json` are a
  different kind of setting — see ADR-0008.)
