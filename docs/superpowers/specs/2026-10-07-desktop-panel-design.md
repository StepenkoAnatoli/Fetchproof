# Desktop panel - design

- **Date:** 2026-10-07
- **Decision:** [ADR-0147](../../adr/0147-a-desktop-panel-on-127-0-0-1-over-the-kits-own-commands.md)
- **Classification:** architectural (a new subsystem; brainstorming skill, Design mode)

## Purpose

A small window on the operator's Windows desktop, more comfortable than a terminal, to:
add keys, run doctor, update the kit, see the project's topic at the top, and connect a
builder. Success: the operator never has to remember a command for those five things,
and no rule of the kit is weaker for it.

## Answers from the owner (2026-10-07)

- **Approach:** a local web page served by the kit, opened in the browser.
- **Connect the builder:** exactly as designed. The panel runs on the collector, which
  collects. The builder is any AI agent or a person and builds. Same system as before.
- **Full controls:** the limit is the kit's rules. The builder side runs handoff, preflight
  and doctor and reads the brief; nothing in the panel collects.

## Assumptions

- Windows 10/11 with Node 22+ already installed (the kit's own floor).
- One operator per machine; the panel is a single-user local tool.
- The topic is read-only: `plan.json` owns it and the kit refuses to change it (ADR-0056).

## Components

| Piece | Owns |
|---|---|
| `fetchproof/bin/panel.mjs` | Flags (`--project`, `--port`, `--no-open`), starting the server, opening the browser, Ctrl+C. |
| `fetchproof/lib/panel.mjs` | The server: request checks, routes, running the allowed commands, the hand-off text. |
| `fetchproof/panel/` | `index.html`, `panel.js`, `panel.css`: the page. No framework, no build step. |
| `fetchproof/lib/transport.mjs` `SEARCH_KEY` | The search provider's credential, named only in the registry and the adapter. |

## Layout

- **Top bar:** the topic (large), the project folder, the machine role badge, the kit
  version, and the **Connect builder** button.
- **Connect builder** (toggled): project folder (full path, typed); Preflight, Handoff,
  Doctor, Open BRIEF.md; the collector's push lines and the text to paste to the builder,
  with a Copy button.
- **Keys:** the SerpAPI key (password field, saved, never shown back; empty clears); the
  Firecrawl line says to run `firecrawl login` once and press Doctor.
- **Doctor:** one button.
- **Update:** Preview (`install.mjs --dry-run`) and Update (`install.mjs`).
- **Output:** the last command's title, exit code and text.

## API

All `/api/` routes need the token header; POSTs need `Content-Type: application/json`.

| Route | Does |
|---|---|
| `GET /api/state` | topic, role, project, brief present, key states (never keys), update source and target, the hand-off text |
| `GET /api/brief` | the project's `research/BRIEF.md`, read-only, at most 1 MB |
| `POST /api/project {path}` | switch project: an absolute path to an existing folder |
| `POST /api/key/search {key}` | save or clear the search key in the machine config |
| `POST /api/run {command}` | one of `doctor`, `handoff`, `preflight`, `update-preview`, `update`; one at a time |
| `GET /api/requests` | request queue, collection settings, daily meter, results, and recent output |
| `POST /api/autocollect {settings}` | validate and save machine-local auto-collect settings; arm or stop the timer |
| `POST /api/requests/check` | check for builder requests; on a collector, may collect validated requests within configured caps and commit/push results |
| `POST /api/requests/resume` | clear the pause after credit exhaustion; later checks may continue the partial request |

## Data flow

The page reads `/api/state` and `/api/requests`, renders untrusted values with `textContent`
or DOM controls, and posts actions. Auto-collection mutates and commits corpus files only
for validated builder requests on a collector, within the configured per-request and daily
page caps; it never accepts arbitrary commands or passes `--fallback`. A run
spawns `node <kit>/bin/<script> <fixed args>` with the project as cwd, collects stdout and
stderr (cut at 1 MB, stopped after 10 minutes), redacts the search key, and returns it.

## Error handling

- A wrong Host is 421, a foreign Origin 403, a missing or wrong token 401, a non-JSON POST
  415, an unknown command 400 (naming the allowed commands and that arbitrary commands are never run),
  a run while another runs 409, update from the installed copy 409, a config inside a
  repository 409.
- A child that cannot start, overflows or times out returns its output with the reason.
- The browser not opening is one stderr line; the address is printed regardless.

## Security

The panel holds a credential and runs commands, so: bound to 127.0.0.1; Host and Origin
checks against rebinding and cross-site requests; a 192-bit per-launch token in the URL
fragment, compared in constant time; JSON-only POSTs; a strict Content-Security-Policy
(`script-src 'self'`, no inline script), `no-referrer`, `no-store`, `frame-ancestors
'none'`. Collection is limited to validated builder requests on a collector and obeys the
operator's configured caps; it cannot collect arbitrary pages or execute arbitrary commands.
The settings route writes only machine-local settings, while request checks may write,
commit, and push corpus/result files for those validated requests.

## Testing

`fetchproof/test/panel.test.mjs`, offline, against a disposable config and a stand-in kit
whose scripts print their cwd, argv and environment: state and topic; builder role; token,
Host, Origin and content-type refusals; asset headers and no token in the page; the page
never writes HTML; the key saved, cleared, never echoed, refused into a repository; no
collect command; doctor/handoff/preflight run in the project with no page arguments and the
key redacted; update refused from the installed copy and run with `--dry-run` for preview;
project switching; the brief read-only; the hand-off text; no runtime named; CLI flags.

## Out of scope (left out deliberately)

A packaged window or tray icon (Electron, Tauri, SEA), editing the topic, manual/general-
purpose collection controls, a folder picker that browses the disk, remote access to the
panel, an installed shortcut.
