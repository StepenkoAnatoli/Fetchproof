# ADR-0147: A desktop panel on 127.0.0.1 over the kit's own commands

- **Date:** 2026-10-07
- **Status:** accepted
- **Area:** lifts the feature freeze (ADR-0117) for one item: **the desktop panel** - one
  command, `bin/panel.mjs` (flags `--project`, `--port`, `--no-open`), its module
  `lib/panel.mjs`, and the page under `research-kit/panel/`. No transport, provider, check,
  file format or configuration key is added; the key it saves is the existing `serpapiKey`.
  ADR-0010 (a builder does not collect), ADR-0012 (the kit names no runtime), ADR-0050 (no
  PATH launcher) and ADR-0056 (the topic is the project's) stay in force.
- **Reopens:** ADR-0031's rejected Windows `.exe`, for the part of it that was about the
  operator - not the packaging, which stays rejected.
- **Spec:** [`docs/superpowers/specs/2026-10-07-desktop-panel-design.md`](../superpowers/specs/2026-10-07-desktop-panel-design.md)

## Context

The owner asked (2026-10-07) for a small window on his Windows desktop to add keys, run
doctor and update, see the topic at the top, and "connect the builder" - which he defined
as exactly the existing model: this machine is the collector and collects; the builder is
any AI agent or a person and builds; the builder's limits are the kit's rules. The kit is
terminal-only. ADR-0031 rejected a packaged `.exe` because the hosted route served a
person without a terminal; this person has a terminal-capable PC and wants comfort, not a
second collection route.

## Decision

1. **A local page, served by the kit and opened in the browser.** `bin/panel.mjs` listens
   on 127.0.0.1 and opens the default browser at its address. Node 22+, already required,
   is the only runtime; nothing is packaged, signed or installed beyond the kit itself.
2. **The panel is a shell, not a second implementation.** Doctor, handoff, preflight and
   install run as children with fixed argument lists (`PANEL_COMMANDS`); the panel adds no
   verdict of its own. Nothing the page sends reaches an argument list.
3. **The panel never collects.** *(Amended by ADR-0148: the page still has no collect
   command; auto-collect runs `research.mjs` only for a builder's validated request, on a
   collector, within the operator's caps.)*
   `research.mjs` and `decompose.mjs` have no direct/general-purpose route. On a collector,
   direct collection stays a terminal act with its budget printed beside it (Rule 5); the
   sole panel-triggered exception is auto-collection of validated builder requests within
   the operator's configured caps. On a builder, collection is refused anyway (ADR-0010).
   A page that could spend credits on arbitrary input would be one cross-site request away
   from spending them.
4. **"Connect builder" is the hand-off, as designed.** It checks the gate (preflight,
   handoff, doctor), opens `BRIEF.md`, and gives the text the collector pastes to its
   builder: the push with the ledger by name, then the builder's steps - declare the role,
   handoff, preflight, read the brief, and never collect; a missing fact goes back to the
   collector. No product is named (ADR-0012); commands are spelled `$HOME` (ADR-0050).
5. **Keys.** The search provider's key is saved to the machine config through the
   transport registry (`SEARCH_KEY`), never echoed, and refused when the config resolves
   inside a git repository (Rule 6). The Firecrawl key stays with the Firecrawl CLI: the
   page says to run its login and press Doctor. The kit still never reads that key.
6. **Four checks on every request:** the 127.0.0.1 bind; a Host header naming it (DNS
   rebinding); an Origin, when present, that is the panel's own; and on `/api/` a
   per-launch token initialized from the URL fragment and sent as `x-panel-token`.
   POSTs must be JSON, which a plain cross-site form cannot send. Clarified 2026-10-08:
   the CLI prints the token-bearing launch URL; the code does not establish privacy
   guarantees for browser history/sync or terminal output. The fragment/header boundary
   is not a promise that the launch capability cannot be recorded.
7. **Update installs the copy the panel runs from.** Run from the installed copy, there is
   nothing newer, and the panel says so instead of copying a tree onto itself.

## Rejected alternatives

- **A packaged desktop app (Electron, Tauri).** A real window and tray icon, at the cost of
  a large dependency tree, a binary to sign and ship, and the packaging story ADR-0031
  declined. The window is the one thing it adds, and a browser tab gives the owner the rest.
- **A single-executable `.exe` (Node SEA).** Researched (`docs/decisions/2026-09-21-sea-assets/`,
  `2026-09-22-build-sea/`), and still needs a UI - this page. It is packaging on top of
  this decision, not an alternative to it; reopen it if a machine without Node must run
  the panel.
- **Collection buttons on the panel.** Rejected in decision 3; the owner confirmed the
  limit is the kit's rules.
- **A PATH launcher or a Start-menu installer.** ADR-0050 rejected a PATH launcher; a
  desktop shortcut whose target the operator writes (README) costs nothing to keep.

## Expires when

The owner decides on 1.0, or a machine without Node needs the panel (then the SEA route).
