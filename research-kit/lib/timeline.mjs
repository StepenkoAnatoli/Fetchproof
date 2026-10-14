// timeline.mjs - the derived chronological review aid, and the diagnostics log.
//
// `research/TIMELINE.md` is deliberately OUTSIDE the chain and never part of a gate
// decision: it exists so a person can read what happened in order.

import { PATHS, resolve, writeText, nowIso, appendLine, documentCommand, compareText } from './core.mjs';
import { readCorpus } from './corpus.mjs';

/** The gate records through here, so nothing else has to know where the log lives. */
export function recordDiagnostic(root, event) {
  return appendLine(resolve(root, PATHS.diagnostics), JSON.stringify({ at: nowIso(), ...event }));
}

/**
 * One ledger entry in words. A fetch names its page and capture; a migration and a prior have
 * neither, and rendered as "undefined -> undefined" (found 2026-09-29) - a migration says why
 * the chain was rewritten, in its own reason or note, and a prior names its file.
 */
function detailOf(entry) {
  if (entry.op === 'fail') return `${entry.url} - ${entry.error ?? 'unknown failure'}`;
  if (entry.op === 'migration') return String(entry.reason || entry.note || 'no reason recorded').replace(/\s+/g, ' ').trim();
  if (!entry.url) return entry.raw || '-';
  return `${entry.url} -> ${entry.raw}${entry.transport ? ` (${entry.transport})` : ''}`;
}

export function buildTimeline(root, { corpus = null } = {}) {
  const snapshot = corpus ?? readCorpus(root);
  const events = [];

  for (const entry of snapshot.ledger.entries) {
    events.push({
      at: entry.at ?? '',
      kind: entry.op === 'fail' ? 'fetch failed' : entry.op,
      detail: detailOf(entry),
    });
  }
  for (const row of snapshot.evidence) {
    events.push({ at: row.retrieved, kind: 'evidence', detail: `${row.id} ${row.url}` });
  }
  for (const override of snapshot.overrides) {
    events.push({ at: override.at, kind: 'override', detail: `${override.kind} ${override.detail}`.trim() });
  }

  events.sort((a, b) => compareText(a.at, b.at));
  return events;
}

/**
 * One readable form per moment. The collector stamps fetches at day precision
 * (`T00:00:00.000Z`), evidence rows carry a date, and overrides and diagnostics carry a real
 * time - the column mixed all three (found 2026-09-27). A day is written as a date, a real
 * time as `YYYY-MM-DD HH:MM UTC`. Sorting still uses the raw value.
 */
function when(at) {
  const text = String(at ?? '');
  if (!text) return '-';
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z)?$/.exec(text);
  if (!m) return text;
  if (!m[2] || (m[2] === '00' && m[3] === '00' && /T00:00:00(\.0+)?Z$/.test(text))) return m[1];
  return `${m[1]} ${m[2]}:${m[3]} UTC`;
}

export function renderTimeline(root, { corpus = null } = {}) {
  const snapshot = corpus ?? readCorpus(root);
  const events = buildTimeline(root, { corpus: snapshot });
  const lines = [
    '# Timeline',
    '',
    'Derived, chronological, and deliberately outside the chain: a review aid, never part',
    `of a gate decision. Regenerate with \`${documentCommand('timeline.mjs', '', { root })}\`.`,
    '',
    '| When | What | Detail |',
    '|---|---|---|',
    ...events.map((e) => `| ${when(e.at)} | ${e.kind} | ${String(e.detail).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')} |`),
    '',
  ];
  writeText(resolve(root, PATHS.timeline), `${lines.join('\n')}\n`);
  return { file: PATHS.timeline, events: events.length };
}
