// bundle.mjs - the received archive, and how far this repository has moved from it.
//
// This project began as a ZIP of 80 planning documents. `BUNDLE_INDEX.md` carries their
// SHA-256 digests, and ADR-0022 read that as a constraint: `docs/ARCHITECTURE.md` was a
// "byte-preserved bundle source", so it must not be edited, so the same-commit map rule
// (ADR-0007) had to be given an exception.
//
// ADR-0028 supersedes that. The manifest is a RECORD OF A PAST STATE, not a promise about
// the present - and treating it as a promise cost something real: three commits took
// `--no-verify` to get past a rule that was catching genuine documentation drift.
//
// So the digests stay frozen, exactly as the archive arrived, and this module makes the
// record CHECKABLE instead of decorative. Nothing read `BUNDLE_INDEX.md` before; its
// hashes had never once been verified by anything. Now drift is reported - which file,
// and whether its change is expected - rather than assumed absent.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { resolve, readText, exists } from './core.mjs';

export const BUNDLE_INDEX = 'BUNDLE_INDEX.md';

/**
 * Files the project is EXPECTED to have moved on from.
 *
 * A research-first kit whose corpus never changed would be a kit nobody used: the whole
 * design is that `research/` grows as evidence is collected. Listing them is not an
 * excuse - it is the difference between "this file changed because the project is alive"
 * and "this file changed and nobody knows why", which is the only distinction a drift
 * report exists to draw.
 */
export const EXPECTED_TO_DRIFT = Object.freeze([
  // The corpus. Every one of these is written by the collector or by an agent closing an
  // unknown, which is the kit working.
  'research/BRIEF.md',
  'research/DISCOVERY.md',
  'research/EVIDENCE.md',
  'research/MAP.md',
  'research/SOURCES.md',
  'research/TIMELINE.md',
  'research/plan.json',
  // The map and the decision log, which ADR-0007 requires to move with the code.
  'docs/ARCHITECTURE.md',
  'docs/adr/README.md',
  // The vocabulary record and the front door. Both are documentation ABOUT the code, so
  // both go stale the moment the code moves and neither can be frozen without becoming
  // wrong. Added 2026-09-20, when this very check caught them drifting — the validator
  // layer introduced terms CONTEXT.md had to gain, and a public repository needed a
  // README that said whose keys these are. They are not planning documents: those are
  // records of a past state, and a test below asserts none of them is ever exempted.
  'CONTEXT.md',
  'README.md',
  // The agent protocol. Added 2026-09-21, when this check caught it drifting for the
  // reason it should: ADR-0030 gave decision research a committed home, and the rule that
  // sends an agent there has to be where the agent reads its rules. AGENTS.md is the file
  // the protocol is written in, so every protocol decision moves it - freezing it would
  // mean recording decisions somewhere nobody is bound by. Same argument as CONTEXT.md
  // and README.md above: documentation about behaviour cannot be pinned to a past state
  // without becoming wrong.
  'AGENTS.md',
  // The operator's front door, AGENTS.md's human twin. Added 2026-09-29, when this check
  // caught it drifting for the reason it should: the archived copy carried the author's
  // own C:\Users\... paths, and a portable START_HERE is the template rendered with
  // $HOME. Same argument as README.md: it tells a reader how to run the kit today.
  'START_HERE.md',
  // The index cannot record its own digest and be correct about it.
  BUNDLE_INDEX,
]);

/** Parse the manifest's digest block. One `sha256  path` pair per line. */
export function parseManifest(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s\s(.+)$/);
    if (match) rows.push({ sha256: match[1], file: match[2].trim() });
  }
  return rows;
}

export function sha256Of(root, file) {
  const full = resolve(root, file);
  if (!exists(full)) return null;
  // BYTES, not decoded text. `sha256sum` hashed the file as it sat on disk, and a digest
  // taken over a utf8 round-trip is a different number the moment a byte is not valid
  // utf8. This repository pins line endings (ADR-0020) precisely so the comparison stays
  // meaningful; reading through a string decoder would throw that away.
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * `verifyBundle(root)` -> what still matches the archive, what moved, and what is gone.
 *
 * Reports. Judges nothing: a changed file is a fact about this repository's history, and
 * the only thing that would make it a problem is nobody knowing about it.
 */
export function verifyBundle(root, { expected = EXPECTED_TO_DRIFT } = {}) {
  const manifestPath = resolve(root, BUNDLE_INDEX);
  if (!exists(manifestPath)) {
    return { ok: false, present: false, reason: `${BUNDLE_INDEX} is not in this project`, rows: [], unchanged: [], drifted: [], unexpected: [], missing: [] };
  }

  const rows = parseManifest(readText(manifestPath, ''));
  const expectedSet = new Set(expected);
  const unchanged = [];
  const drifted = [];
  const unexpected = [];
  const missing = [];

  for (const row of rows) {
    const actual = sha256Of(root, row.file);
    if (actual === null) { missing.push(row.file); continue; }
    if (actual === row.sha256) { unchanged.push(row.file); continue; }
    (expectedSet.has(row.file) ? drifted : unexpected).push(row.file);
  }

  return {
    ok: unexpected.length === 0 && missing.length === 0,
    present: true,
    rows,
    unchanged,
    drifted,
    unexpected,
    missing,
  };
}

/** One line for a health report. */
export function bundleSummary(result) {
  if (!result.present) return result.reason;
  const parts = [`${result.unchanged.length}/${result.rows.length} still byte-identical to the 2026-09-17 archive`];
  if (result.drifted.length) parts.push(`${result.drifted.length} changed as expected (corpus, map, ADR index)`);
  if (result.unexpected.length) parts.push(`${result.unexpected.length} changed UNEXPECTEDLY: ${result.unexpected.join(', ')}`);
  if (result.missing.length) parts.push(`${result.missing.length} missing: ${result.missing.join(', ')}`);
  return parts.join('; ');
}
