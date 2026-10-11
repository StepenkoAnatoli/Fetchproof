# ADR-0159 — The 22 line starts at 22.22.1, because 22.13.0 to 22.22.0 lose windows-1252

- **Date:** 2026-10-11
- **Status:** accepted
- **Area:** `lib/runtime.mjs` (`nodeDecodesWindows1252`, `nodeLine`), the `node` finding in
  `doctor`, the README's Node requirement.
- **Refines:** docs/decisions/2026-09-27-node-support (the floor is 22, the proxy flag needs
  22.21). Those decisions stand; this one adds a later floor on the 22 line for a different
  reason.

## Context

The kit decodes a fetched page by its declared charset (G7, 2026-10-03): a `windows-1252`
page keeps its euro sign, curly quotes and dashes, where every body had been read as UTF-8.
That reading is Node's `TextDecoder`. On Node 22.13.0 through 22.22.0 `TextDecoder` reads
`windows-1252` as plain Latin-1 (nodejs/node#60888, a regression that shipped after the 22
line went LTS; fixed by nodejs/node#60893 and backported), so bytes 0x80-0x9F come back as C1
control characters. A page captured on such a build loses those characters with no warning,
the capture is hashed into the ledger as fetched, and the suite's two G7 decoding tests go
red (found 2026-10-11, #282, on a container's Node 22.22.0: 1785 passed, 2 failed, the same
on an untouched `main`).

Measured on 2026-10-11, byte 0x80 under the `windows-1252` label: 22.12.0 right; 22.13.0,
22.21.0 and 22.22.0 wrong; 22.22.1, 22.22.3, 22.23.0, 22.23.3 and 24.21.0 right; 20.20.0
wrong and below the floor anyway.

The kit's floor admitted those builds. `REQUIRED_NODE_MAJOR` is 22, `nodeHonoursEnvProxy`
asks for 22.21 and reports the proxy flag separately, and `nodeLine` reported 22.21 and
22.22.0 as `pass`. CI never met the defect: `setup-node` resolves `'22'` to the newest 22.x,
which was 22.23.3 that day. So `doctor` said READY on a machine that cannot keep a euro sign.

## Decision

`nodeLine` reports a 22 from 22.13.0 up to and including 22.22.0 as `fail`, naming the defect
(the upstream issue) and the first good build (22.22.1 or newer on the 22 line, or 24). The
rule is `nodeDecodesWindows1252`, a version rule like `nodeHonoursEnvProxy`, documented with
the measurements above. The README's requirement reads "Node 22.22.1+ or 24+". The G7 tests
stay as they are: they are right to fail on those builds.

The hard floor every command refuses below (`checkNode`, major 22) does not move: it would
refuse `doctor`, the command that explains the finding, and the kit's commands other than
collection are unaffected by the defect. A Node release update, which the freeze admits
(ADR-0117); no new command, flag, key, format or check.

## Rejected alternatives

- **Decode 0x80-0x9F by a table when the label is windows-1252 and the decoder returns a C1
  control for 0x80.** Works on every Node, but it is a transport change behind a runtime
  probe - a second decoder beside the one the kit trusts, and under the freeze it reads as
  a feature. If the kit ever needs to run on such a build it is the remedy to take, as a
  new ADR.
- **Refuse those builds in `checkNode`, so every command exits 3 up front.** It would refuse
  `doctor` too, and the gate, the handoff and the builder commands, which do not decode a
  fetched page. The finding belongs where the reader can see it.
- **Document only.** A README line and nothing in `doctor`: the kit would still say READY on
  a machine whose captures are silently wrong, the failure this kit exists to prevent.

## Reopens when

A capture is found on the ledger that was taken on an affected build - then the transport
has to refuse to fetch on one, not only `doctor` to report it. Or Node ships the same
regression on another line, when the rule gains that line's range.
