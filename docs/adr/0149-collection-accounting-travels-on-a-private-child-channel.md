# ADR-0149: Collection accounting travels on a private child channel

Date: 2026-10-08
Status: accepted. Repairs ADR-0148's existing page cap and exhaustion pause. The private
Node IPC report is the one scoped internal format admitted under ADR-0117; no public
command, flag, configuration field, provider, transport, request/result field or check is
added. ADR-0010's collector boundary and ADR-0129's operator decision remain in force.

## Context

Auto-collect inferred pages spent and credit exhaustion from the research child's human
output. A valid multiline query could print a forged `spent 0` or `stopped` line before
the real summary. A sufficiently long stdout/stderr prefix could also discard the final
summary. Both paths undercounted an existing daily page cap or changed the queue's pause
decision. Treating a missing measurement as zero allowed another request to run after an
interrupted or unmeasured attempt.

The approved runtime brief and ledger-backed source statements are in
[`2026-10-07-break-test-external-facts`](../decisions/2026-10-07-break-test-external-facts/research/BRIEF.md).
E-07 documents the Node child IPC channel, actual parent message receipt, and exit/close
boundaries. E-08/E-09 document the child `process.send` signature and disconnect at the
inspected Node 22/24 tags. Those documents do not specify every child callback failure
behavior; actual delivery/error handling is tested on the runtime and CI, rather than
claimed for every Node version.

## Decision

1. The fixed `research.mjs` child gets a private Node IPC descriptor, separate from stdout
   and stderr. After `runResearch` returns, it sends exactly one internal object:
   `{ type: 'research-kit-accounting', spent, stoppedOn }`. `spent` is that run's actual
   page-attempt count; `stoppedOn` is its exhaustion provider or an empty string. The child
   waits for its send callback and disconnect before an explicit exit. A send callback is
   not an acknowledgment of parent receipt.
2. Auto-collect counts only the parent's actual received, validated object. It requires
   exactly the three fields, the fixed type, a nonnegative safe integer no larger than
   the admitted allowance, and a bounded single provider name. A missing, malformed,
   duplicate or over-allowance report is unmeasured. Human output and exit zero cannot
   replace that report. The exported historical summary parsers remain compatible but
   no longer control accounting or pauses.
3. An unmeasured attempt reserves its remaining admitted page allowance against the
   existing daily meter and pauses the queue. On continuation, earlier measured pages
   remain counted once; only the continuation's remaining allowance is newly reserved.
   The failed result/output says the allowance was reserved and actual spend is unknown.
   Resume may allow other requests within the remaining daily cap, but never silently
   removes the reservation or automatically retries that terminal failed request.
4. A valid received report remains accounted even if the child exits unsuccessfully or
   is later interrupted. Exhaustion pauses with the known spend and continuation state.
   An interrupted run also pauses further collection. An ordinary failed exit with a
   valid measurement records that known spend and the failed result.
5. Research diagnostics retain a bounded tail and disclose truncation. They are redacted
   for presentation and labeled as diagnostic output. Result detail is bounded too; an
   oversized final line cannot escape the output bound through another field. Other
   commands retain their historical bounded prefix because Git output is also data.
   Panel/README labels say pages used or reserved, so the conservative reservation does
   not claim measured spend.

## Rejected alternatives

- **Use the last matching summary line.** Request text can contain summary-shaped lines,
  and a truncated or interrupted run can omit its own summary entirely. A different regex
  still mixes input text with an accounting boundary.
- **Retain unlimited human output.** This removes one truncation case while preserving
  spoofing and allowing unbounded memory/result growth.
- **Trust exit zero or charge zero when reporting fails.** Neither proves how many pages
  were attempted. Charging the remaining allowance and pausing preserves the existing
  cap without inventing a measurement.
- **Add a public measurement file, result field or configuration switch.** The fixed
  Node child already has a private IPC mechanism; a new public measurement interface
  remains unnecessary. ADR-0152 supersedes the original claim that durable admission
  is unnecessary: the admitted allowance and an in-flight pause must be saved in the
  existing meter before the collector starts that child.
- **Charge the original full request allowance again on continuation.** Prior measured
  attempts are already counted. Only the newly admitted remaining allowance can be
  reserved without double charging.

## Verification boundaries and trigger to revisit

Offline real-child tests exercise large stdout/stderr, invalid/missing/duplicate reports,
spawn/timeout/failed-exit paths, and actual CLI dry-run send/disconnect/error handling.
Git round trips exercise the queue, daily meter, pause and continuation effects with a
fixed offline research stand-in. They do not certify a live provider's billing balance.

Revisit this internal channel if the collection executable stops being a fixed Node child,
accounting must cover a public cross-process protocol, or live measurements show that the
run's reported page-attempt count does not bound the collector's admitted allowance.
