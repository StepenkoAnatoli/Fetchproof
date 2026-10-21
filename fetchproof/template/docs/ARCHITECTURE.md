# ARCHITECTURE - the map of the code

What each module owns, the seams between them, and which decision governs each. This is
a map of the **code**, not of the research: `research/MAP.md` is the topic map - a
different artifact with a different job, judged by a different check.

The rule this map lives by: a commit touching a **declared code path** (declared in
`research/kit.json`, defaulting to `src` / `lib` / `bin` / `scripts` / `app`) carries
this file's update in the **same commit**. The commit gate refuses such commits without
it.

What the rule proves is deliberately modest: the gate checks this file was **staged**
with the code, not that it is current - a whitespace edit satisfies it. That makes a
stale map a deliberate act rather than mere forgetting. A prompt, not a proof.

## The one picture

```
_Replace this with the shape of the thing you build: the entry points, the modules
they reach, and the seams between them._
```

## Modules - what each one owns

| Module | Owns | Governed by |
|---|---|---|
| _module_ | _the one concept it is responsible for_ | _ADR or decision_ |

## The seams

_Where modules touch, what is injectable, and why testing can stay offline._

## Current shape, for the record

_Counts and invariants a reader can check against the code: how many checks, how many
adapters, which defaults._
