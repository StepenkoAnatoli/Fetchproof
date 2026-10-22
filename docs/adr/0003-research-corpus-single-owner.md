# ADR-0003 — The research corpus has one reader and one writer

- **Date:** 2026-09-13
- **Status:** accepted
- **Area:** evidence format, preflight, gate, timeline, doctor
- **Supersedes:** nothing. Refines the approved hardening design (one verdict, three
  callers) without changing it.

## Context

The Discovery Contract is a file format: markdown tables with normalised headers,
raw-capture front-matter, and JSONL side logs. Six modules read it directly and four
carried their own copy of the header normaliser:

| Module | Its own copy |
|---|---|
| `lib/core.mjs` | `normalizeHeader`, `parseMarkdownTable`, `indexRawByUrl` |
| `lib/preflight.mjs` | `col(row, name)` |
| `lib/timeline.mjs` | `col(row, name)` — a byte-identical second copy |
| `lib/ledger.mjs` | the same expression inlined four more times |

Because nothing owned the format, nothing could say whether a row was well-formed.
`parseMarkdownTable` mapped cells onto headers by index and dropped whatever did not fit,
so this project's own `research/EVIDENCE.md` carried a row with **eight cells under a
six-column header** — a promotional banner URL spliced into the citation — and every
reader returned it as a clean row. The hash chain did not catch it: the chain protects raw
captures, not the tables that cite them.

A second defect was found while building the replacement: the writer escaped pipes
(`escapeCell` turns `|` into `\|`) but the reader split on every pipe and never unescaped.
Any finding containing a pipe — `Rate limits | per team` — was written correctly and read
back truncated. The reader was not the inverse of the writer.

## Decision

`fetchproof/lib/corpus.mjs` owns the format. `lib/ledger.mjs` is deleted and the
markdown-table machinery leaves `lib/core.mjs`, which keeps only generic helpers (fs,
dates, slugs, source classification).

**Reading** is split by cost, because the edit-time gate pays it on every edit:

- `readCorpus(root)` — parse only. No hashing, no crypto. Returns the contract, intent,
  unknowns, evidence rows, sources, plan, captures with front-matter, ledger entries,
  overrides, diagnostics, failures, `stats`, and `problems`.
- `loadCorpus(root)` — `readCorpus` plus chain verification. What preflight uses.

**Writing** goes through the same definitions the reader uses — `appendRow`, `upsertRow`,
`ensureDoc`, `note`, `appendJsonLine`, `tableRow`, `escapeCell` — so a written row always
parses back. `splitRow` splits on unescaped pipes and then unescapes; the reader is now the
inverse of the writer by construction, and a test asserts the round-trip.

**Malformation is reported, never absorbed.** `problems` carries `table-arity` (a row whose
cell count does not match its header, with the line number and the fix), `raw-dangling` (a
cell pointing at a capture that is not on disk), `capture-url` / `capture-retrieved` /
`capture-front-matter`, `plan-json`, and `jsonl-tail`. The corpus **does not decide
severity**: which problems block a build is the preflight's verdict. A corpus that judged
severity would be a second gate.

**Consumers.** `preflight`, `timeline`, `doctor`, and `collect` all read and write through
the corpus. The gate still calls `runPreflight`, and the verdict is still one function with
three callers — unchanged.

**One check was renamed.** A capture whose front-matter records no `firecrawl` command was
reported as `timestamp-agreement`, which sent anyone debugging it to compare two clocks when
the real problem is provenance. It is now `capture-command`. The clock comparison keeps the
`timestamp-agreement` name.

## Consequences

- A malformed evidence row blocks the build. Measured on this repository: preflight now
  reports `table-arity` for row `E-02` of `research/EVIDENCE.md`, which previously passed
  every reader as a clean citation.
- "What counts as an evidence row?" is a one-file question instead of a four-file one.
- `lib/core.mjs` went from 31 exports to 19 and no longer knows what a contract is.
- The gate's per-edit cost is bounded: `readCorpus` does no hashing, so the expensive read
  happens only where a verdict is actually being computed.
- The corpus's own format is now the test surface (`test/corpus.test.mjs`, 27 tests) rather
  than something inferred from 18 whole-project preflight tests.

## Alternatives considered

- **Keep the readers, share only the normaliser.** Would have removed the duplication and
  left the real defect intact: no reader could report a malformed row, because each was
  still parsing on its own terms. Rejected — it treats the symptom.
- **Let the corpus decide severity.** Tempting, since `table-arity` obviously matters.
  Rejected: it would create a second place where "what blocks a build" is defined, and the
  single verdict is the property the whole gate design rests on.
- **Verify the chain inside `readCorpus`.** Rejected: the Claude `PreToolUse` hook pays node
  startup plus a corpus read on *every edit*, and hashing every capture there is a cost with
  no verdict to show for it.
