// One unknown, everything it rests on, in one read-only answer.
//
// The work this replaces is real and repetitive: to judge whether U-5 is actually closed
// you open DISCOVERY.md for its wording, EVIDENCE.md for the rows it cites, SOURCES.md
// for what each source is, research/raw/ for the captured page, and the ledger for when
// it was fetched — five files and a lot of scrolling, every time, for every unknown.
//
// It answers, and it decides NOTHING. No status is read as a judgement, no status is
// written, and a missing piece is reported as missing rather than filled in. Whether the
// evidence closes the unknown stays a person's call — that is the whole protocol, and a
// tool that quietly rendered a verdict here would be the most dangerous thing in the kit.

import { PATHS, resolve, relative, readText, projectFile, isDirectory } from './core.mjs';
import { captureOf, traceOf, parseCapture } from './corpus.mjs';
import { supersededRows } from './checks.mjs';
import { findingWithContext } from './finding.mjs';

/** Sentences worth showing first: the ones carrying a number, a limit, or an obligation. */
const CONCRETE = /\d|\b(must|may|required|prohibited|limit|rate|quota|credit|retain|retention|free|price|pricing|per (?:minute|hour|day|month)|concurrent)\b/i;

/**
 * A bounded excerpt of the captured page, biased toward the part that carries the claim.
 *
 * Bounded because an unbounded one is the file, and printing the file is what this
 * command exists to avoid. Biased because the top of a page is nearly always navigation.
 */
export function excerptFor(body, finding, { limit = 420 } = {}) {
  const text = String(body ?? '').replace(/\r/g, '');
  if (!text.trim()) return '';

  // Paragraphs, not lines: a wrapped sentence should not be cut in half.
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
    .filter((b) => !/^#{1,6}\s/.test(b) && !/^[-*>|]/.test(b));

  // Prefer a block sharing distinctive words with the finding, then one that is concrete.
  const words = [...new Set(String(finding ?? '').toLowerCase().match(/[a-z]{5,}/g) ?? [])];
  const score = (block) => {
    const lower = block.toLowerCase();
    const overlap = words.filter((w) => lower.includes(w)).length;
    return overlap * 3 + (CONCRETE.test(block) ? 2 : 0);
  };

  const best = blocks.map((b) => [score(b), b]).sort((a, b) => b[0] - a[0])[0];
  const chosen = best && best[0] > 0 ? best[1] : (blocks[0] ?? text.trim());
  if (chosen.length <= limit) return chosen;
  const start = focusOf(chosen, finding, limit);
  const lead = start > 0 ? '…' : '';
  const window = chosen.slice(start, start + limit - lead.length);
  return `${lead}${window.trimEnd()}${start + limit - lead.length < chosen.length ? '…' : ''}`;
}

/**
 * Where in a block longer than the limit the window should start: where the most distinct
 * tokens of the finding fall within one window.
 *
 * It started at 0. A page with no blank line - a JSON capture - is one block, so the excerpt
 * was its first characters whatever the finding quoted (found 2026-09-27: Node v0.8 and v0.10,
 * for a finding about v22 and v24). The count is of DISTINCT tokens, so a word the page
 * repeats everywhere cannot outvote the one passage that carries them together.
 */
function focusOf(block, finding, limit) {
  const lower = block.toLowerCase();
  const tokens = [...new Set(String(finding ?? '').toLowerCase().match(/[a-z0-9][a-z0-9.-]*[a-z0-9]/g) ?? [])]
    .filter((t) => t.length >= 3);
  const hits = [];
  for (const [index, token] of tokens.entries()) {
    for (let at = lower.indexOf(token), n = 0; at !== -1 && n < 200; at = lower.indexOf(token, at + 1), n += 1) hits.push([at, index]);
  }
  if (!hits.length) return 0;
  hits.sort((a, b) => a[0] - b[0]);
  const half = Math.floor(limit / 2);
  let best = { score: 0, at: 0 };
  for (const [at] of hits) {
    const seen = new Set(hits.filter(([p]) => p >= at - half && p < at + half).map(([, i]) => i));
    if (seen.size > best.score) best = { score: seen.size, at };
  }
  return Math.max(0, Math.min(best.at - half, block.length - limit));
}

/**
 * Everything one unknown rests on.
 *
 * Returns `{ ok: false, reason }` rather than throwing when the id is not there: the
 * caller is a CLI, and an unknown id is a normal thing for a person to mistype.
 */
export function evidenceContext(corpus, unknownId, { limit = 420 } = {}) {
  const wanted = String(unknownId ?? '').trim().toUpperCase();
  if (!wanted) return { ok: false, reason: 'no unknown id given', known: corpus.unknowns.map((u) => u.id) };

  const unknown = corpus.unknowns.find((u) => u.id.toUpperCase() === wanted);
  if (!unknown) {
    return { ok: false, reason: `${wanted} is not in ${PATHS.discovery}`, known: corpus.unknowns.map((u) => u.id) };
  }

  const superseded = supersededRows(corpus);
  const sourceByUrl = new Map(corpus.sources.map((s) => [s.url, s]));

  const cited = unknown.cites.map((id) => {
    const row = corpus.evidence.find((e) => e.id.toUpperCase() === id.toUpperCase());
    if (!row) return { id, missing: true };

    const capture = captureOf(corpus, row);
    const trace = traceOf(corpus, row);
    const source = sourceByUrl.get(row.url) ?? null;

    let excerpt = '';
    let excerptProblem = '';
    let extractor = null;
    const named = row.raw ? projectFile(corpus.root, row.raw) : null;
    const rawRoot = resolve(corpus.root, PATHS.raw);
    const raw = named ? projectFile(rawRoot, relative(rawRoot, named.abs)) : null;
    if (named?.problem === 'outside') {
      // Never read: this output lands in an agent's context (ADR-0076, 2026-09-28).
      excerptProblem = `${row.raw} is outside the project, so it is not read`;
    } else if (raw?.problem === 'outside') {
      excerptProblem = `${row.raw} names a file outside research/raw, so it is not read`;
    } else if (raw?.problem === 'missing') {
      excerptProblem = `${row.raw} is named by the row and is not on disk`;
    } else if (raw?.problem === 'not-file') {
      excerptProblem = isDirectory(raw.abs)
        ? `${row.raw} is a directory, not a capture`
        : `${row.raw} is not a regular file, not a capture`;
    } else if (row.raw) {
      const text = readText(raw.abs);
      if (text === null) {
        excerptProblem = `${row.raw} could not be read - check its permissions`;
      } else {
        const body = parseCapture(text).body;
        excerpt = excerptFor(body, row.finding, { limit });

        // What the extractor would pick from this page TODAY, and why.
        //
        // The recorded Finding is usually a person's rewrite, which is the protocol
        // working as intended. Showing the machine's pick beside it answers the question
        // a reviewer actually has - "is there something more concrete on this page than
        // what the row says?" - without touching the row. Suggestion, never edit.
        const auto = findingWithContext(body, '');
        if (auto.finding && auto.finding !== row.finding) {
          extractor = { candidate: auto.finding, heading: auto.heading, signals: auto.signals, excerpt: auto.excerpt };
        }
      }
    } else {
      excerptProblem = 'the row names no capture, so there is nothing to quote';
    }

    const replacedBy = superseded.get(row.id.toUpperCase()) ?? null;

    return {
      id: row.id,
      missing: false,
      type: row.type,
      typeLabel: { P: 'Primary', S: 'Secondary', T: 'Tertiary' }[row.type] ?? (row.type || '?'),
      url: row.url,
      title: source?.title ?? '',
      retrieved: row.retrieved,
      finding: row.finding,
      raw: row.raw,
      excerpt,
      excerptProblem,
      extractor,
      completeness: capture?.completeness ?? '',
      transport: capture?.transport ?? '',
      fetchedAt: trace.fetch?.at ?? '',
      supersededBy: replacedBy ? replacedBy.id : '',
    };
  });

  // Other rows for the same URLs, not cited here. Often the newer read of the same page.
  const citedIdSet = new Set(cited.map((c) => c.id?.toUpperCase()));
  const citedUrls = new Set(cited.filter((c) => c.url).map((c) => c.url));
  const related = corpus.evidence
    .filter((row) => citedUrls.has(row.url) && !citedIdSet.has(row.id.toUpperCase()))
    .map((row) => ({ id: row.id, url: row.url, retrieved: row.retrieved, finding: row.finding }));

  return {
    ok: true,
    unknown: { id: unknown.id, text: unknown.text, why: unknown.why, status: unknown.status, evidence: unknown.evidence },
    cited,
    related,
    // Stated, never acted on. The reader decides; this only says what is here to read.
    gaps: [
      ...(unknown.cites.length ? [] : ['this unknown cites no evidence row']),
      ...cited.filter((c) => c.missing).map((c) => `${c.id} is cited and is not in ${PATHS.evidence}`),
      ...cited.filter((c) => !c.missing && c.excerptProblem).map((c) => `${c.id}: ${c.excerptProblem}`),
      ...cited.filter((c) => c.supersededBy).map((c) => `${c.id} is superseded by ${c.supersededBy}`),
    ],
  };
}

/** The human rendering. Deterministic: same corpus in, same bytes out. */
export function renderContext(context) {
  if (!context.ok) {
    return [`${context.reason}`, context.known?.length ? `known: ${context.known.join(', ')}` : ''].filter(Boolean).join('\n');
  }
  const { unknown, cited, related, gaps } = context;
  const out = [`${unknown.id} — ${unknown.text}`, ''];
  if (unknown.why) out.push(`Why it blocks: ${unknown.why}`, '');
  out.push(`${cited.length || 'no'} cited row${cited.length === 1 ? '' : 's'}`, '');

  for (const row of cited) {
    if (row.missing) { out.push(`${row.id} — CITED BUT NOT FOUND`, ''); continue; }
    const head = [row.id, row.typeLabel, row.retrieved && `retrieved ${row.retrieved}`]
      .filter(Boolean).join(' — ');
    out.push(head);
    if (row.title) out.push(`  ${row.title}`);
    if (row.url) out.push(`  ${row.url}`);
    const meta = [row.completeness && `capture ${row.completeness}`, row.transport, row.supersededBy && `SUPERSEDED BY ${row.supersededBy}`]
      .filter(Boolean).join('    ');
    if (meta) out.push(`  ${meta}`);
    if (row.finding) out.push('', `  Finding: ${row.finding}`);
    if (row.excerpt) out.push('', '  Excerpt:', ...row.excerpt.split('\n').map((l) => `    ${l}`));
    else if (row.excerptProblem) out.push('', `  (no excerpt: ${row.excerptProblem})`);

    // Shown only when it differs from the recorded Finding, and labelled as a suggestion.
    // The recorded wording is usually a person's rewrite - that is the protocol working -
    // so this is here to answer "is there something more concrete on the page?", not to
    // imply the row is wrong.
    if (row.extractor) {
      const where = row.extractor.heading ? ` (under "${row.extractor.heading}")` : '';
      out.push('', `  The extractor would pick this from the same page${where}:`,
        `    ${row.extractor.candidate}`);
      if (row.extractor.signals?.length) out.push(`    signals: ${row.extractor.signals.join(', ')}`);
      out.push('    Suggestion only - nothing here edits the row.');
    }
    out.push('');
  }

  if (related.length) {
    out.push('Other rows for the same sources, not cited here:');
    for (const row of related) out.push(`  ${row.id}  ${row.retrieved}  ${row.finding.slice(0, 90)}`);
    out.push('');
  }

  if (gaps.length) {
    out.push('Worth knowing before you judge this:');
    for (const gap of gaps) out.push(`  - ${gap}`);
    out.push('');
  }

  // The recorded status comes LAST, and is labelled as a recording rather than a finding.
  //
  // It used to head the report as "Status: CLOSED", above the evidence. That was read
  // from the corpus and decided nothing — but a verdict printed before the evidence is
  // an anchor, and a reviewer who sees CLOSED first is reading to confirm rather than to
  // judge. The whole point of this command is that the judgement happens after the
  // reading, so the inherited answer waits until after it too.
  out.push(`Recorded status in ${PATHS.discovery}: ${unknown.status || '(blank)'}`);
  out.push('That is what the corpus says today, not a judgement by this command.');
  out.push('');
  out.push('This command reads. Whether the evidence closes the unknown is your call.');
  return out.join('\n');
}
