// lib/release/order.mjs - the one order for identifiers, in the ported layer so the validators
// may use it (ADR-0029: nothing ported depends on anything unported). `core.mjs` re-exports it.
//
// By UTF-16 code unit: total, the same on every machine, what `canonicalJson` hashes keys by,
// and what the Python conformance runners sort by (`key=utf-16-be`). `localeCompare` with no
// locale named reads the machine's, and the order then differed from machine to machine -
// under da_DK `Firecrawl` before `firecrawl`, under th_TH `a-b` equal to `ab`, so `audit --list`
// printed readdir order (break-test PR #185, 2026-10-01).

export function compareText(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
}
