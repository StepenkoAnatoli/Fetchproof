# ADR-0017 — The wrong project is asked for, not searched for

- **Date:** 2026-09-15
- **Status:** accepted
- **Area:** the protocol, agent orientation, the kit's boundaries

## Context

The kit identifies the project from the current working directory: every path it reads
(`research/DISCOVERY.md`, the corpus, `research/raw/.fetches.jsonl`) is relative to where
it stands, and the verdict is a pure function of that one root (ADR-0004). That is correct
and is not in question.

What was missing was the case where the cwd is *not* the project. The first real run
supplied it: the operator started an agent inside the kit's own repository instead of the
project he meant to research. The agent correctly refused to overwrite the corpus it found
there - that part was right. It then recursed through the operator's working directory
looking for the project it guessed he meant, found the right one, and on the way read a
directory holding a plaintext GitHub token, and checked whether that token existed as a
fallback in case it needed a remote lookup.

Nothing leaked, and every individual step was defensible. But the step itself was wrong.
Searching a person's disk to guess his intent reads directories nobody authorised, and the
question it replaces - *which project did you mean?* - takes one line and would have made
the whole search unnecessary. `AGENTS.md` already told an arriving agent how to resume an
interrupted task (ADR-0013); it said nothing about starting in the wrong place, so the
agent improvised, and improvisation filled the silence with a filesystem walk.

## Decision

**`AGENTS.md` and the scaffold template gain a short section, in the same register as the
resume section, stating that the project is the cwd - the kit takes no project argument and
never will - and that a cwd which is not the project the operator means is a question, not
a search.** `CONTEXT.md` carries the term **wrong project**. The operator-facing half of
the same fact is one instruction near the top of `README.md`: `cd` into the project first,
then run the kit from where it is installed.

The section names three things an agent must not do - search the filesystem, infer the
project from a name, look it up on a remote - and three signals that the cwd is wrong: no
`AGENTS.md`, no `research/` directory, or a `research/` corpus whose topic is plainly
about something else. It says why `doctor` and preflight cannot settle it either: they
describe wherever they are run, so a clean report from the wrong directory is a clean
report about the wrong project. And it closes the loop on the case that actually happened:
an existing corpus about another topic is the signal doing its job, and the answer is to
ask - not to write over it, and not to search past it.

Nothing is enforced, and nothing may be.

## Consequences

- An agent reading `AGENTS.md` cold, started in a directory that is not the project, now
  has an instruction for the situation, and it is the cheap one: ask, and wait.
- The instruction is inherited by every scaffolded project, because the template carries
  the same section - a project that never sees this repository still tells its agents not
  to go looking.
- The operator's half is stated once, in the README, in the shape he will type it - which
  removes most of the occasion for a wrong cwd in the first place.
- The kit's own repository is the worked example the section names, which is honest about
  where the gap was found and gives an arriving agent a case it can recognise on sight.
- The section needs revisiting if the kit ever stops resolving the project from the cwd
  (which this ADR rejects), or if the signals change shape - not when the commands around
  it change, because "ask which project" is the invariant and the tools are the details.

## Rejected alternatives

- **A check.** The obvious move for a protocol-minded kit, and the one ADR-0013 already
  refused for resume, for the same reason: a gate cannot judge whether an agent guessed or
  was told. It would fail the agent that searched *and found the right project*, and pass
  the agent that asked but asked badly - wrong in both directions. The enforcement
  surfaces stay the two that can be decided from state: the commit gate and the edit-time
  gate.
- **A `--project <path>` argument (or `FETCHPROOF_PROJECT`).** Then an agent could name
  the project it meant, and the search would be unnecessary from the other side. Rejected:
  it makes two roots where there was one, and the gate can only judge the root it is
  handed - so the verdict would describe one project while the agent edits another, which
  is the failure this ADR exists to prevent, wearing the costume of a feature. The cwd is
  unambiguous because there is only one of it. Re-open only if the kit gains a call that
  must act on a project it is not standing in; nothing today does.
- **Letting the agent search, but bounding it** - skip dot-directories, refuse
  credential-shaped files, cap the depth. Rejected as a filter on the wrong act. The
  search is not dangerous because it might find a token; it is wrong because it replaces a
  question with a guess. A bounded search still reads a person's directories without being
  asked, and the bound is the part that would eventually be wrong.
- **Inferring the project from a name** - the topic in `research/DISCOVERY.md`, a
  directory name, a git remote. Rejected as guessing in deduction's clothing: the name
  closest to the operator's words is not necessarily the project he means, and the one
  case where inference lands is the case where asking was free.
- **Looking it up on a remote** (the git remote, a hosting provider). Rejected for the
  same reason as the search plus one more: it spends a credential - or goes looking for
  one - to answer a question the operator can answer in one line, and the token the run
  went looking for is exactly the kind of thing that must not be read to guess intent.
- **Adding the same sentence to `skill/SKILL.md`.** Deferred, not refused. The skill is
  the binding text where neither gate runs (ADR-0006), so it may need it too; but it is
  loaded once research is under way, and the task asked for `AGENTS.md`. A third copy now
  is three stories that can drift, and adding it later is one commit.
