# ADR-0012 — The kit names no runtime; the runtime's paths are one anchored, overridable default

- **Date:** 2026-09-14
- **Status:** accepted
- **Area:** machine state, install/repair, the kit's vocabulary

## Context

The kit was written against one runtime: its settings file, its skill root, its hook
event name, and its name in prose. That was invisible while there was one machine and
one agent driving it. The two-machine model (ADR-0010) made it visible — the collector
is the operator's PC and "the builder there may be any AI" — and it turned out to be
two problems wearing one coat.

**The vocabulary problem.** Code, config keys, and agent-addressed prose named a
product. A kit that says "the Claude hook" is a kit that has decided which agent drives
your machine, and the decision has no basis in what the kit can know: the role
(collector or builder) is a fact about the box, and which model sits in the driver's
seat is irrelevant to every rule the kit enforces. Names at that layer leak into
places that outlive the tool — config keys, CLI flags, ADRs — and each one is a small
claim the operator did not make.

**The correctness problem, which is the real one.** A skill only works if the agent
discovers it, and a hook only fires if the runtime reads the file it was registered in.
Both of those locations are properties of the runtime, and the kit had them hardcoded:
`~/.claude/skills` and `~/.claude/settings.json`. On a machine whose agent reads a
different root, `install.mjs` reports success while writing a skill nothing will ever
load, and `install-hooks.mjs` writes a registration into a file nothing consults — a
gate that gates nothing, and a skill that is never read, both reported as installed.
"Installed" and "discovered" are different facts, and only the second one matters.

A rename sweep driven by a grep would have fixed the first problem and left the second
untouched; worse, the obvious way to satisfy a strict grep — move every path into
machine config — breaks an install that works today.

## Decision

**The kit names no runtime. The runtime's own paths are literals in exactly one
documented place, and every one of them is a default the machine can override.**

1. **Capability names everywhere else.** Kit-owned identifiers, config keys, CLI flags,
   and agent-addressed prose describe what a thing does, never which product does it:
   `editGate` (not `claudeGate`), `--edit-only` (not `--claude-only`),
   `hooks/edit-gate.mjs` (not `hooks/claude-pretooluse.mjs`), "the edit-time gate",
   "the agent", "the builder", "the runtime". A product name survives in exactly two
   places: the anchors below, and the **retired names the kit used to ship** — because
   recognising an old install requires naming what the old install says
   (`RETIRED_EDIT_GATE_HOOKS`, `RETIRED_FLAGS`, `RETIRED_PROJECT_SKILL_DIRS`,
   `RETIRED_KIT_FILES`, `RETIRED_CONFIG_KEYS`, `RETIRED_ENV_VARS`, all in
   `lib/machine.mjs`).

2. **One anchor file.** `RUNTIME_ANCHORS` in `lib/machine.mjs` is the single place the
   kit states a runtime's paths — the settings file it registers the edit-time gate in,
   the personal roots it installs the skill into, and the project-relative skill
   directory. Nothing else in the kit writes these paths.

3. **Anchors are DEFAULTS, never constants.** The machine config overrides
   `editGate.settingsPath`, `skillRoots`, and `projectSkillDir`; the environment
   variable `FETCHPROOF_EDIT_GATE_SETTINGS` overrides the settings path for a single
   invocation, the same precedence `FETCHPROOF_CONFIG` already has. `runtimePaths()`
   and `skillLocations()` are the readers, so the installer, doctor, and `--into` bind
   to the same answer and cannot drift. There is no setup command and no migration:
   an existing install keeps the exact behaviour it has today, because the anchors are
   the values it already uses.

4. **The rename never breaks an install.** `installEditGate` recognises every
   registration the kit has ever written — the current hook name and the **retired**
   ones — removes them all, and writes exactly one registration pointing at
   `hooks/edit-gate.mjs`, reporting what it replaced (`retiredRepairNote`).
   `removeEditGate` removes a retired entry too. `settingsState()` distinguishes
   `current`, `retired`, and `none`, so a machine that has not been upgraded is
   reported as repairable rather than healthy or broken. A state the kit cannot
   recognise is refused, never rewritten, as before. A stale entry must never be left
   beside a new one, and no registration may point at a hook file that no longer
   exists — that is a gate that silently gates nothing.

5. **A retired setting is read before it is dropped.** `claudeGate` is a retired
   config key, not a synonym: `loadConfig` folds its value into `editGate.mode`, so
   a machine that had set `hard-block` does not come back as `ask` because the key
   moved — a rename that silently relaxes a gate is the same defect as a rename that
   silently stops firing one. `doctor` reports the key as stale, and `saveConfig`
   drops it the next time the kit writes the file, so the migration happens through
   normal use rather than a command the operator has to know about.

6. **A retired environment variable is reported, never honoured — and never left
   silent.** `CLAUDE_SETTINGS_PATH` is read for exactly one purpose: `doctor` names
   it, says it is ignored, and names its replacement (`FETCHPROOF_EDIT_GATE_SETTINGS`)
   — and only when the replacement is not set, because an operator who set the new
   variable has already answered the question. It is **not** honoured: an export
   lives in the operator's shell, where no kit write can reach it, so honouring it
   would let a stale line silently decide where the gate installs — the same silent
   relaxation the config-key fold exists to prevent — while leaving it unreported
   would be the one path in this rename with no message at all.

7. **Deployments prune what the kit no longer ships.** `RETIRED_KIT_FILES` names the
   kit's own past paths; `install.mjs` deletes exactly those from the deployed tree,
   because a copy-over deploy never removes anything and would otherwise keep a
   deleted hook one settings entry away from being executed.

8. **The wire protocol stays the runtime's.** The hook reads and writes the runtime's
   own keys (`hookEventName: 'PreToolUse'`, `hookSpecificOutput`,
   `permissionDecision`) because that is the interface the runtime speaks. That is
   protocol, not vocabulary: the kit does not get to rename it, and it is not a claim
   about which agent is running.

## Consequences

- A machine whose runtime keeps its settings elsewhere, or discovers skills in a
  different root, is configured rather than patched — and the failure it avoids is the
  silent one, where everything reports installed and nothing is discovered.
- `doctor` reports `gate-edit` in three states (registered, registered at a retired
  name, absent), so the upgrade gap is visible before it matters.
- Test fixtures use generic placeholders (`<unknown-model>`, `PROVIDER_API_KEY`,
  `PROVIDER_BASE_URL`) — not for the grep, but because the repair test asserts that
  **unknown keys survive**; a fixture written in one vendor's vocabulary proves only
  that the repair knows that vendor.
- Dated records keep their names. `docs/adr/0001`–`0011` and `docs/superpowers/`
  describe a past state in its own words, and the research corpus is hash-chained:
  rewriting a capture to satisfy a grep would break the ledger, which is a far worse
  outcome than a product name in a record. This ADR is the boundary: records keep
  names, the kit does not use them.
- A future rename has a procedure, not just a rule: add the old name to
  `RETIRED_EDIT_GATE_HOOKS` (or `RETIRED_FLAGS`, `RETIRED_PROJECT_SKILL_DIRS`,
  `RETIRED_KIT_FILES`, `RETIRED_CONFIG_KEYS`, `RETIRED_ENV_VARS`), teach the installer
  to repair it — or, if the kit cannot reach it, to report it — say so in doctor, and
  test the upgrade path explicitly.
- Reporting is the floor, not a nice-to-have: a rename that changes nothing and says
  nothing is indistinguishable from a broken one. Every retired name either repairs,
  is read for continuity, or is named by `doctor` while it persists.
- A machine upgraded from the old config key keeps its mode across the rename: read
  immediately, migrated on the next write, reported in between. On the machine that ran
  this change the config moved from `claudeGate: "ask"` to
  `editGate: { mode: "ask", settingsPath: "" }` on the first `install-hooks.mjs --role`
  write, and `doctor` went from naming the stale key to silent.

## Rejected alternatives

- **Full config-driven (no literals in the kit at all).** Every path becomes required
  machine configuration, and the kit names nothing. Rejected because it breaks a
  working install to satisfy a grep: today's machines have none of those keys set, and
  the first run after the upgrade would either fail outright or need a setup command
  before the gate exists — the period when the gate is missing is precisely when it
  cannot report that it is missing. The anchors keep the working default while making
  the paths overridable, which is the property that was actually needed.
- **Prose-only sweep.** Rename what the agent reads and leave the code as it was.
  Rejected because the kit would still be pinned to one runtime's paths in the code
  that writes them — the correctness problem above — and because the config key and the
  flag are the operator's interface too, not just the agent's: `claudeGate` in a config
  file is the kit naming a product in the machine's own state.
- **Honouring the retired variable (and warning only when it fires).** Reading
  `CLAUDE_SETTINGS_PATH` as a settings-path override would preserve behaviour for a
  machine that exports it — which is exactly the trap: the export could keep pointing
  somewhere the machine's config no longer agrees with, and the kit would install a
  gate into a file nothing reads, silently, for as long as the shell keeps exporting
  it. It cannot be migrated the way a config key can (no kit write reaches a shell),
  so the honest treatment is to refuse it aloud: the variable is inert, and `doctor`
  says which one, that it is ignored, and what to rename it to.
- **Grep as the acceptance test.** The earlier framing ("any occurrence of a product
  name is a defect") was written too absolutely: it graded records and corpus bytes the
  same way it graded code, and its cheapest fix — delete the paths — was the wrong one.
  The rule that survives is the one that motivated it: **the kit must not assume which
  AI drives a machine.** Acceptance is behavioural — a machine with different runtime
  paths configures them without editing kit code, an existing install survives the
  rename or is repaired with a clear message, and a builder reading `AGENTS.md` with no
  brief knows its role and cannot tell which product wrote the kit.
