// lib/measure.mjs - how well a corpus's citations hold up, without a judge (ADR-0089).
//
// Research: docs/decisions/2026-09-28-kit-measurement. Deep-research benchmarks score a
// citation by whether its link works, whether the page is relevant, and whether the page
// supports the claim (E-03); only the first needs no judge. FACT folds support into one
// judged "Citation Accuracy" (E-02). This computes what the corpus can say about itself and
// NAMES what it cannot: it never judges support, and it never gates.

import { readCorpus, captureOf, parseCapture } from './corpus.mjs';
import { verifyLedger } from './provenance.mjs';
import { resolve, readText, siteOf, exists } from './core.mjs';
import { quoteAnchors, anchorFound, quoteTooShort, unreadableQuoteMarkers } from './quotes.mjs';

const share = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

export function measureCorpus(root, { corpus = null } = {}) {
  const snapshot = corpus ?? readCorpus(root);
  const ledger = verifyLedger(root, { corpus: snapshot });
  const broken = new Set(ledger.problems.filter((p) => p.file).map((p) => p.file));
  const fetched = new Set(snapshot.ledger.entries.filter((e) => e.op !== 'fail' && e.raw).map((e) => e.raw));

  const rows = snapshot.evidence;
  let linkWorks = 0;
  let anchoredRows = 0;
  let quotes = 0;
  let quotesFound = 0;
  const cited = new Map();
  // Rows holding a quote the gate would accept as checked: not too short and found (ADR-0195).
  // Kept by row object, not by ID, so a duplicated ID resolves the way `byId` below does.
  const usable = new Set();
  for (const row of rows) {
    const capture = captureOf(snapshot, row);
    const status = Number(capture?.statusCode);
    const works = Boolean(capture) && exists(resolve(root, capture.file)) && fetched.has(capture.file)
      && !broken.has(capture.file) && !(Number.isInteger(status) && status >= 400);
    if (works) linkWorks += 1;
    if (capture) cited.set(capture.file, capture);
    const anchors = quoteAnchors(row.finding);
    // A marker the gate cannot read was still a quote written down: it counts as a quote not
    // found, never as a row without one (#319).
    const unreadable = unreadableQuoteMarkers(row.finding).length;
    if (!anchors.length && !unreadable) continue;
    anchoredRows += 1;
    quotes += unreadable;
    const body = capture ? parseCapture(readText(resolve(root, capture.file)) ?? '').body : '';
    for (const anchor of anchors) {
      quotes += 1;
      const found = Boolean(body) && anchorFound(anchor.fragments, body);
      if (found) quotesFound += 1;
      if (found && !quoteTooShort(anchor)) usable.add(row);
    }
  }

  const captures = [...cited.values()];
  const full = captures.filter((c) => c.completeness === 'full').length;

  const byId = new Map(rows.map((r) => [r.id.toUpperCase(), r]));
  const closed = snapshot.unknowns.filter((u) => u.status === 'CLOSED');
  const withPrimary = closed.filter((u) => u.cites.some((id) => byId.get(id.toUpperCase())?.type === 'P')).length;
  const twoHosts = closed.filter((u) => new Set(u.cites.map((id) => byId.get(id.toUpperCase())?.url).filter(Boolean).map(siteOf)).size >= 2).length;
  // Quote coverage (ADR-0195): a CLOSED unknown counts once when ANY row it cites holds a usable
  // quote - "usable" and "found" exactly as the `citations` check judges them: the row's capture
  // by `captureOf` (the Raw cell, else the URL's newest capture, the gate's own resolution),
  // `parseCapture(...).body`, `quoteTooShort` on the compared text (ADR-0191), `anchorFound`.
  // A per-unknown `some`, so an unknown citing two quoted rows, or one row twice, is one closure.
  // It measures how much of the closure a reader can check against its page in seconds - not
  // whether the quote supports the claim, which needs a judge - and it never gates (ADR-0089).
  const quoteCovered = closed.filter((u) => u.cites.some((id) => usable.has(byId.get(id.toUpperCase())))).length;

  return {
    rows: rows.length,
    linkWorks: { count: linkWorks, percent: share(linkWorks, rows.length) },
    anchoredRows: { count: anchoredRows, percent: share(anchoredRows, rows.length) },
    quotesFound: { count: quotesFound, of: quotes, percent: share(quotesFound, quotes) },
    fullCaptures: { count: full, of: captures.length, percent: share(full, captures.length) },
    closed: closed.length,
    closedWithPrimary: { count: withPrimary, percent: share(withPrimary, closed.length) },
    closedOnTwoHosts: { count: twoHosts, percent: share(twoHosts, closed.length) },
    quoteCoverage: { count: quoteCovered, of: closed.length, percent: share(quoteCovered, closed.length) },
    knownUnknowns: snapshot.unknowns.filter((u) => u.status === 'KNOWN-UNKNOWN').length,
    ledgerVerifies: ledger.ok,
    factCheck: {
      computed: false,
      why: 'whether a page SUPPORTS its claim needs a judge (DeepResearch Bench FACT); the anchored quotes are the part a reviewer can check in seconds',
    },
  };
}

/** The report as lines of text, one metric a line. */
export function renderMeasure(m) {
  const pct = (x) => (x.percent === null ? 'n/a' : `${x.percent}%`);
  return [
    `evidence rows          ${m.rows}`,
    `link works             ${pct(m.linkWorks)}  (${m.linkWorks.count} of ${m.rows}: capture on disk, in the ledger, unmodified, not an error page)`,
    `quote-anchored rows    ${pct(m.anchoredRows)}  (${m.anchoredRows.count} of ${m.rows})`,
    `quotes found           ${pct(m.quotesFound)}  (${m.quotesFound.count} of ${m.quotesFound.of} in their capture)`,
    `full captures          ${pct(m.fullCaptures)}  (${m.fullCaptures.count} of ${m.fullCaptures.of} cited captures)`,
    `closed unknowns        ${m.closed}; on a primary row ${pct(m.closedWithPrimary)}, on two or more hosts ${pct(m.closedOnTwoHosts)}`,
    `quote coverage         ${m.quoteCoverage.count} / ${m.quoteCoverage.of} CLOSED unknowns cite at least one row with a usable quote (not too short, ADR-0191) found in its capture - a coverage metric, not truth`,
    `known unknowns         ${m.knownUnknowns}`,
    `ledger                 ${m.ledgerVerifies ? 'verifies' : 'DOES NOT VERIFY - run preflight'}`,
    `fact check             not computed - ${m.factCheck.why}`,
  ];
}
