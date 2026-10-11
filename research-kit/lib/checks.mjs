// checks.mjs - the ordered contract-check registry (ADR-0004).
//
// Thirteen checks, in reporting order. Every check is a pure function of the corpus
// snapshot plus options; none reads the filesystem beyond `exists()` on a path the
// corpus already resolved, and `readPrior`, which reads the one file the ledger points at.
//
// A check emits findings. It never decides what a finding MEANS for the build - that is
// the verdict's single judgement, in lib/preflight.mjs.

import { hostOf, siteOf, PATHS, resolve, exists, ageInDays, urlKey, readText, kitCommand, compareText } from './core.mjs';
import { captureOf, traceOf, citedIds, parseCapture, ledgerRank } from './corpus.mjs';
import { documentGroups, closestPair } from './similarity.mjs';
import { coverageOfUniversals } from './dimensions.mjs';
import { verifyLedger } from './provenance.mjs';
import { readPrior, PRIOR_PATH } from './prior.mjs';
import { quoteAnchors, anchorFound, quoteWords, quoteChars, MIN_QUOTE_WORDS, MIN_QUOTE_CHARS } from './quotes.mjs';
import { draftStamp, briefInputsHash, briefState } from './brief.mjs';

const VALID_STATUSES = ['CLOSED', 'KNOWN-UNKNOWN'];
const MIN_CAPTURE_CHARS = 200;

function finding(severity, check, rule, detail, extra = {}) {
  return { severity, check, rule, detail, ...extra };
}

// The calendar day a retrieval value names, or null. The collector writes the same `today()`
// into the capture's front-matter and the table's Retrieved cell, but a capture written
// before 2026-09-19 carries a full timestamp (`2026-09-13T17:38:25.128Z`) against a
// day-only cell, so the two are compared as days, never as strings.
function retrievedDay(value) {
  const text = String(value ?? '').trim();
  const iso = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

// The date freshness is judged by. The table's Retrieved cell is typed and hand-editable;
// the capture's `retrieved` was written by the collector at the fetch and is under the
// ledger's hash. Until 2026-10-03 only the cell was read, so editing E-19's cell from
// 2026-09-20 to today made its stale warning disappear while the capture on disk still
// said 2026-09-20 (output-reliability audit, G8). A row that cites no capture, or one
// whose capture carries no parseable date, is still judged by the cell - there is
// nothing better to judge it by, and hygiene says when the two disagree.
function freshnessDate(corpus, row) {
  const capture = ownCapture(corpus, row);
  return capture && ageInDays(capture.retrieved) !== null ? capture.retrieved : row.retrieved;
}

// The capture a row NAMES in its Raw cell - not the one `captureOf` finds for a blank cell,
// which is the URL's latest capture and may be a later fetch the row never read. Judged by
// that one, a row with a blank Raw cell and a 2026-01-01 reading borrowed a fresh fetch's
// date, lost its stale warning, and drew a date-mismatch telling the operator to write the
// later date into the row (found 2026-10-03, review of G8). A row that names no capture is
// judged by its cell, and has nothing to reconcile against.
function ownCapture(corpus, row) {
  return row?.raw ? (corpus.captures.byFile.get(row.raw) ?? null) : null;
}

/** The day a row's freshness is judged by, as a comparable string ('' when it has none). */
function freshnessDay(corpus, row) {
  return retrievedDay(freshnessDate(corpus, row)) ?? '';
}

// ---------------------------------------------------------------- 1. discovery-contract

function discoveryContract(corpus) {
  const out = [];
  if (!corpus.discovery.present) {
    return [finding('fail', 'discovery-contract', 'contract-missing',
      `${PATHS.discovery} is missing or could not be read. A gated project without its contract fails harder, not open.`)];
  }
  if (!corpus.intent.trim()) {
    // Missing and empty are different fixes: a renamed heading read as "is empty" while the
    // intent sat under its new name (found 2026-09-27).
    out.push(finding('fail', 'discovery-contract', 'build-intent', corpus.intentHeading === false
      ? `${PATHS.discovery} has no "## Build intent" heading - the gate reads the intent from under that exact heading`
      : '## Build intent is empty - state what is being built, for whom, and what "done" means'));
  }
  if (!corpus.unknowns.length) {
    out.push(finding('fail', 'discovery-contract', 'no-unknowns',
      'the contract enumerates no blocking unknowns - a contract with no unknowns makes no claim'));
  }
  for (const unknown of corpus.unknowns) {
    if (VALID_STATUSES.includes(unknown.status)) continue;
    out.push(finding('fail', 'discovery-contract', 'status',
      `${unknown.id} has status "${unknown.status || '(blank)'}" - must be CLOSED or KNOWN-UNKNOWN`,
      { row: unknown.id, line: unknown.line }));
  }
  if (!out.length) out.push(finding('pass', 'discovery-contract', 'contract', `${corpus.unknowns.length} unknowns, all with a valid status`));
  return out;
}

// ---------------------------------------------------------------- 2. citations

function citations(corpus) {
  const out = [];
  let quoted = 0;
  for (const row of corpus.evidence) {
    if (!row.url) {
      out.push(finding('fail', 'citations', 'row-url', `${row.id} has no URL`, { row: row.id, line: row.line }));
    }
    if (!row.finding.trim()) {
      out.push(finding('fail', 'citations', 'row-finding', `${row.id} has an empty Finding cell`, { row: row.id, line: row.line }));
    }
    if (!['P', 'S', 'L'].includes(row.type)) {
      out.push(finding('warn', 'citations', 'row-type', `${row.id} has source type "${row.type || '(blank)'}" - expected P, S, or L`, { row: row.id, line: row.line }));
    }
    const capture = captureOf(corpus, row);
    if (!capture) {
      out.push(finding('fail', 'citations', 'raw-missing',
        `${row.id} cites ${row.raw || row.url} with no cached page behind it - a claim without a capture is not evidence`,
        { row: row.id, line: row.line }));
      continue;
    }
    if (!exists(resolve(corpus.root, capture.file))) {
      out.push(finding('fail', 'citations', 'raw-missing', `${row.id} cites ${capture.file}, which is not on disk`, { row: row.id, line: row.line }));
      continue;
    }
    // The row's URL is what a reader is shown as the source. It was never compared with the
    // page its capture was fetched from, so a row could name another page and pass (found
    // 2026-09-27). Compared by urlKey: another spelling of the same page is the same page.
    if (row.url && capture.url && urlKey(row.url) !== urlKey(capture.url)) {
      out.push(finding('fail', 'citations', 'url-mismatch',
        `${row.id} names ${row.url}, but its capture ${capture.file} was fetched from ${capture.url} - the URL cell must be the page the claim rests on`,
        { row: row.id, line: row.line }));
    }
    if (capture.bytes < MIN_CAPTURE_CHARS) {
      out.push(finding('warn', 'citations', 'raw-thin',
        `${row.id}'s capture is ${capture.bytes} bytes - too thin to carry a claim`, { row: row.id, line: row.line }));
    }
    // A capture of an error page, from a corpus collected before collectOne refused them
    // (2026-09-28). A warning, not a block: some corpora cite a 404 on purpose, as the record
    // of a lookup that was attempted - and a row that names the status itself has said so,
    // so it is not flagged (a string check, like a quote anchor: the row says "404").
    const status = Number(capture.statusCode);
    if (Number.isInteger(status) && status >= 400 && !new RegExp(`\\b${status}\\b`).test(row.finding)) {
      out.push(finding('warn', 'citations', 'raw-error-status',
        `${row.id}'s capture ${capture.file} is an HTTP ${status} page - it records that the page failed, not what the page says`,
        { row: row.id, line: row.line }));
    }
    // Quote anchors (ADR-0087): `[quote: ...]` in the Finding must occur in this row's
    // capture. A quote the capture refutes is a claim about the evidence that the evidence
    // denies - the same class as an edited capture - so it blocks under every policy.
    const anchors = quoteAnchors(row.finding);
    if (anchors.length) {
      const body = parseCapture(readText(resolve(corpus.root, capture.file)) ?? '').body;
      for (const anchor of anchors) {
        quoted += 1;
        // Short in words AND in characters: a long token of one "word" anchors one exact line.
        if (quoteWords(anchor) < MIN_QUOTE_WORDS && quoteChars(anchor) < MIN_QUOTE_CHARS) {
          out.push(finding('warn', 'citations', 'quote-too-short',
            `${row.id} quotes "${anchor.quote}" - under ${MIN_QUOTE_WORDS} words and ${MIN_QUOTE_CHARS} characters anchors almost nothing; quote the sentence the claim rests on`,
            { row: row.id, line: row.line }));
          continue;
        }
        if (!anchorFound(anchor.fragments, body)) {
          out.push(finding('fail', 'citations', 'quote-not-found',
            `${row.id} quotes "${anchor.quote}", which does not occur in ${capture.file} - copy the passage from the capture, or drop the marker and paraphrase`,
            { row: row.id, line: row.line }));
        }
      }
    }
  }
  if (!out.some((f) => f.severity !== 'pass')) {
    out.push(finding('pass', 'citations', 'citations', `${corpus.evidence.length} evidence rows, each with a cached page`
      + (quoted ? `; ${quoted} quote${quoted === 1 ? '' : 's'} found in ${quoted === 1 ? 'its' : 'their'} capture` : '')));
  }
  return out;
}

// ---------------------------------------------------------------- 3. provenance

function provenance(corpus) {
  const out = [];
  const chain = corpus.chain ?? verifyLedger(corpus.root, { corpus });

  if (!chain.present) {
    return [finding('fail', 'provenance', 'ledger-missing',
      `${PATHS.ledger} is absent - evidence must be fetched, not typed, and the ledger is what proves it`)];
  }
  // Which repair applies to an unparsed line. `doctor --fix-arity` drops a torn LAST line - an
  // interrupted append - and nothing else; a broken line inside the chain is restored from git.
  // The finding named neither (found 2026-09-27).
  const ledgerLines = String(readText(resolve(corpus.root, PATHS.ledger)) ?? '').split(/\r?\n/).filter((l) => l.trim()).length;
  const repairOf = (problem) => (problem.rule !== 'ledger-unparsed' ? ''
    : problem.line === ledgerLines
      ? ` - the last line is torn (an interrupted append): ${kitCommand('doctor.mjs', '--fix-arity')} drops it`
      : ' - a broken line inside the chain cannot be repaired here: restore research/raw/.fetches.jsonl from git');
  for (const problem of chain.problems) {
    const rule = problem.rule === 'body-unmodified' && problem.kind === 'line-endings' ? 'body-unmodified' : problem.rule;
    out.push(finding('fail', 'provenance', rule === 'seq' || rule === 'prev' || rule === 'entry-hash' ? 'chain-intact' : rule,
      problem.detail + (problem.line ? ` (line ${problem.line})` : '') + repairOf(problem),
      { line: problem.line, file: problem.file, kind: problem.kind }));
  }

  for (const row of corpus.evidence) {
    const trace = traceOf(corpus, row);
    if (!trace.capture) continue; // citations already named it
    if (!trace.fetch) {
      out.push(finding('fail', 'provenance', 'fetch-entry-exists',
        `${row.id} cites ${trace.capture.file} with no entry in the ledger - a hand-written capture is not evidence`,
        { row: row.id, line: row.line }));
      continue;
    }
    const front = trace.capture;
    if (!front.command && !trace.fetch.cmd) {
      out.push(finding('warn', 'provenance', 'capture-command',
        `${row.id}'s capture records no collector command in its front-matter`, { row: row.id, line: row.line }));
    }
    if (front.retrieved && trace.fetch.at && !String(trace.fetch.at).startsWith(String(front.retrieved).slice(0, 10))) {
      out.push(finding('warn', 'provenance', 'timestamp-agreement',
        `${row.id}: capture says retrieved ${front.retrieved}, ledger says ${trace.fetch.at}`, { row: row.id, line: row.line }));
    }
  }
  out.push(...priorOrder(corpus, chain));

  if (!out.some((f) => f.severity !== 'pass')) {
    out.push(finding('pass', 'provenance', 'chain-intact', `chain of ${chain.entries.length} entries verifies`));
  }
  return out;
}

/**
 * Where the registered prior sits in the chain, when there is one.
 *
 * A prior is optional and its absence is silent - most corpora do not claim one, and a
 * warning that fires on every project is a warning nobody reads. But a corpus that DOES
 * claim a prediction has made a checkable claim about ORDER, and this is the check of it:
 * a prediction registered after the evidence is not a prediction. `lib/prior.mjs` refuses
 * to write one late, and this does not trust that it was used - the chain is the witness,
 * not the tool.
 *
 * Nothing here reads the prediction. Whether it was specific, reasonable, or right is the
 * reader's to judge (ADR-0013); a gate that preferred correct predictions would teach
 * exactly the wrong habit. The file's immutability needs no code of its own: the prior is
 * chained with its `bodySha256`, so editing it after the fact fails `body-unmodified`
 * through the same machinery a capture does.
 */
function priorOrder(corpus, chain) {
  const prior = readPrior(corpus.root, { entries: chain.entries });
  if (!prior.present) return [];

  const out = [];
  if (prior.duplicates > 1) {
    out.push(finding('fail', 'provenance', 'prior-single',
      `the ledger holds ${prior.duplicates} registered priors - one corpus predicts once, or the prediction `
      + 'that matched gets chosen afterwards', { file: PRIOR_PATH }));
  }
  if (prior.scrapesBefore) {
    out.push(finding('fail', 'provenance', 'prior-precedes-collection',
      `${PRIOR_PATH} is registered at seq ${prior.entry.seq}, after ${prior.scrapesBefore} page(s) were already `
      + 'collected - a prediction made with the evidence in hand is not one. Say what you now believe in the '
      + 'brief, where it is labelled honestly', { file: PRIOR_PATH, line: prior.entry.line }));
    return out;
  }
  if (!out.length) {
    const firstLine = prior.text.trim().split('\n')[0] ?? '';
    out.push(finding('pass', 'provenance', 'prior-precedes-collection',
      `a prior was registered at seq ${prior.entry.seq}, before anything was collected: `
      + (firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine), { file: PRIOR_PATH }));
  }
  return out;
}

// ---------------------------------------------------------------- 4. transport-provenance

function transportProvenance(corpus) {
  const out = [];
  const superseded = supersededRows(corpus);
  for (const row of corpus.evidence) {
    // A row that has been re-collected and is relied on by nothing is HISTORY (ADR-0026).
    // Reporting the provenance of a capture no claim rests on is noise, and worse than
    // noise: it buries the rows that DO carry a claim. Six such warnings stood in this
    // corpus after the 2026-09-20 refresh, all of them about superseded captures.
    if (isReleasedHistory(corpus, row, superseded)) continue;
    const trace = traceOf(corpus, row);
    if (!trace.fetch) continue;
    const transport = trace.fetch.transport || trace.capture?.transport || '';
    if (!transport) {
      out.push(finding('warn', 'transport-provenance', 'transport-unrecorded',
        `${row.id}'s fetch records no transport - a cmd string is an annotation and proves nothing`,
        { row: row.id, line: row.line }));
      continue;
    }
    if (transport === 'firecrawl-cli-anonymous') {
      out.push(finding('warn', 'transport-provenance', 'transport-not-metered',
        `${row.id} was collected by the Firecrawl CLI with NO credential - keyless access capped per IP, not a metered fetch`,
        { row: row.id, line: row.line, transport }));
    } else if (transport !== 'firecrawl-cli') {
      out.push(finding('warn', 'transport-provenance', 'transport-not-metered',
        `${row.id} was collected by "${transport}", not the metered Firecrawl CLI`,
        { row: row.id, line: row.line, transport }));
    }
  }
  if (!out.length) out.push(finding('pass', 'transport-provenance', 'transport', 'every cited capture names its transport'));
  return out;
}

// ---------------------------------------------------------------- 5. gate-integrity

function gateIntegrity(corpus, options = {}) {
  const out = [];
  if (corpus.gateOff) {
    out.push(finding('warn', 'gate-integrity', 'gate-off',
      `${PATHS.gateOff} is present - the gate is deliberately off for this repository, and it is recorded`));
  }
  if (options.localHooksPath) {
    out.push(finding('warn', 'gate-integrity', 'local-hooks-path',
      `this repository sets core.hooksPath=${options.localHooksPath}, which displaces the machine-wide commit gate`));
  }
  const recent = corpus.overrides.length;
  if (recent) {
    out.push(finding('warn', 'gate-integrity', 'overrides-recorded',
      `${recent} override${recent === 1 ? '' : 's'} recorded in ${PATHS.overrides}`));
  }
  // "No override RECORDED" is what was measured. "No override in effect" is what this used
  // to say, and the two differ by the escape hatch the kit documents most prominently:
  // `git commit --no-verify` leaves nothing behind. doctor.mjs has said so in its header
  // since it was written - "the third override is silent by nature, the bypassed hook
  // cannot report itself" - while this line quietly claimed the opposite.
  //
  // Found by sweeping all thirteen pass messages for claims wider than their measurement,
  // after two checks in one day turned out to be reporting the existence of a thing as
  // proof that the thing was right. This was the only one of the thirteen; the rest state
  // what they counted.
  //
  // Nothing here can be made to detect a bypassed hook, so the fix is the sentence. An
  // accurate pass is worth more than a confident one: a reader who finds a claim false once
  // discounts the next, and the next may be the true one (ADR-0035).
  if (!out.length) {
    out.push(finding('pass', 'gate-integrity', 'gate',
      'no override recorded - and `git commit --no-verify` records nothing, so this is the absence of evidence rather than evidence of absence'));
  }
  return out;
}

// ---------------------------------------------------------------- 6. unknown-closure

function unknownClosure(corpus, options = {}) {
  const out = [];
  const maxAgeDays = options.maxAgeDays ?? 180;
  const byId = new Map(corpus.evidence.map((row) => [row.id.toUpperCase(), row]));

  for (const unknown of corpus.unknowns) {
    if (unknown.status === 'KNOWN-UNKNOWN') {
      if (!unknown.evidence.trim()) {
        out.push(finding('fail', 'unknown-closure', 'verification-step',
          `${unknown.id} is KNOWN-UNKNOWN with an empty Evidence cell - name the day-one verification step`,
          { row: unknown.id, line: unknown.line }));
      }
      continue;
    }
    if (unknown.status !== 'CLOSED') continue; // discovery-contract owns a bad status

    const cited = unknown.cites.filter((id) => /^E-\d+$/i.test(id));
    if (!cited.length) {
      out.push(finding('fail', 'unknown-closure', 'no-evidence',
        `${unknown.id} is CLOSED but cites no E-## row`, { row: unknown.id, line: unknown.line }));
      continue;
    }
    for (const id of cited) {
      const row = byId.get(id.toUpperCase());
      if (!row) {
        out.push(finding('fail', 'unknown-closure', 'dangling-citation',
          `${unknown.id} cites ${id}, which is not a row in ${PATHS.evidence}`, { row: unknown.id, line: unknown.line }));
        continue;
      }
      const dated = freshnessDate(corpus, row);
      const age = ageInDays(dated);
      if (age !== null && age > maxAgeDays) {
        // A refresh that has already happened is a different instruction from one that
        // has not: "go and collect" versus "go and read what was collected".
        const fresher = corpus.evidence.find((e) => urlKey(e.url) === urlKey(row.url) && freshnessDay(corpus, e) > freshnessDay(corpus, row));
        // When the capture and the cell disagree, the reader looking at the table sees a
        // date that does not explain the age - so the judging date is named.
        const judged = retrievedDay(dated) !== retrievedDay(row.retrieved)
          ? ` by its capture's date, ${retrievedDay(dated)} (the table says ${row.retrieved || '(blank)'})`
          : '';
        out.push(finding('warn', 'unknown-closure', 'stale-evidence',
          fresher
            ? `${unknown.id} rests on ${id}, retrieved ${age} days ago${judged} (limit ${maxAgeDays}) - ${fresher.id} is already a fresher capture of the same URL; re-read it and move the citation`
            : `${unknown.id} rests on ${id}, retrieved ${age} days ago${judged} (limit ${maxAgeDays}) - re-collect with --refresh-days`,
          { row: unknown.id, line: unknown.line }));
      }
      if (row.type === 'L') {
        out.push(finding('warn', 'unknown-closure', 'lead-only',
          `${unknown.id} rests on ${id}, which is lead-only (L) - a hint, never proof`,
          { row: unknown.id, line: unknown.line }));
      }
    }
    // The registry promised "a primary row" and only L was checked (found 2026-09-28 by the
    // first measurement: three corpora closed everything on S rows with no warning). Rule 4:
    // P carries the design, S is context - so a closure with no P row at all is said. If the
    // page owns the fact (a vendor's own terms, a spec), its row should be typed P.
    const rows = cited.map((id) => byId.get(id.toUpperCase())).filter(Boolean);
    if (rows.length && !rows.some((row) => row.type === 'P') && rows.some((row) => row.type === 'S')) {
      out.push(finding('warn', 'unknown-closure', 'secondary-only',
        `${unknown.id} rests only on secondary (S) rows - S is context, P carries the design; `
        + 'collect the page that owns the fact, or type its row P if it already is that page',
        { row: unknown.id, line: unknown.line }));
    }
  }
  if (!out.length) {
    const closed = corpus.unknowns.filter((u) => u.status === 'CLOSED').length;
    const known = corpus.unknowns.filter((u) => u.status === 'KNOWN-UNKNOWN').length;
    out.push(finding('pass', 'unknown-closure', 'closure', `${closed} closed, ${known} known-unknown`));
  }
  return out;
}

// ---------------------------------------------------------------- 7. subtopic-coverage

function subtopicCoverage(corpus) {
  const out = [];
  if (!corpus.map.present || !corpus.subtopics.length) {
    return [finding('warn', 'subtopic-coverage', 'no-coverage-claim',
      `no coverage claim: ${PATHS.map} has no subtopic rows, so the gate cannot tell a thorough contract from a shallow one`)];
  }

  const unknownIds = new Set(corpus.unknowns.map((u) => u.id.toUpperCase()));
  for (const row of corpus.subtopics) {
    if (row.status === 'GAP' || !row.status) {
      out.push(finding('fail', 'subtopic-coverage', 'gap',
        `${row.id} (${row.text}) is ${row.status || 'unstatused'} - a GAP is the shape of a question nobody asked`,
        { row: row.id, line: row.line }));
      continue;
    }
    if (row.status === 'DISMISSED') {
      if (!row.coveredBy.trim()) {
        out.push(finding('fail', 'subtopic-coverage', 'dismissed-without-reason',
          `${row.id} is DISMISSED with no reason - a dismissal without a reason is a silent gap wearing a label`,
          { row: row.id, line: row.line }));
      }
      continue;
    }
    if (row.status === 'COVERED') {
      const cited = row.cites.filter((id) => /^U-\d+$/i.test(id));
      if (!cited.length) {
        out.push(finding('fail', 'subtopic-coverage', 'covered-without-citation',
          `${row.id} is COVERED but cites no U-## unknown`, { row: row.id, line: row.line }));
      }
      for (const id of cited) {
        if (unknownIds.has(id.toUpperCase())) continue;
        out.push(finding('fail', 'subtopic-coverage', 'covered-by-unknown-that-does-not-exist',
          `${row.id} cites ${id}, which is not a row in ${PATHS.discovery}`, { row: row.id, line: row.line }));
      }
      continue;
    }
    out.push(finding('fail', 'subtopic-coverage', 'status',
      `${row.id} has status "${row.status}" - must be COVERED, DISMISSED, or GAP`, { row: row.id, line: row.line }));
  }

  for (const { dimension } of coverageOfUniversals(corpus.subtopics).missing) {
    out.push(finding('fail', 'subtopic-coverage', 'dimension-omitted',
      `the universal dimension "${dimension.name}" (${dimension.id}) appears nowhere in ${PATHS.map} - dismissing is fine, omitting is not`));
  }

  if (!out.length) out.push(finding('pass', 'subtopic-coverage', 'coverage', `${corpus.subtopics.length} subtopics, every universal dimension present`));
  return out;
}

// ---------------------------------------------------------------- 8. capture-completeness

/** A recorded render review must say what was checked; this is the floor that makes it mean something. */
const MIN_RENDER_REVIEW = 30;

/** How many render-failure notices this capture's page printed, or 0. */
function renderFailureMarkers(corpus, capture) {
  return corpus.captures.renderFailures?.get(capture.file) ?? 0;
}

const RENDER_REVIEW_RE = /\[render-reviewed:\s*([^\]]*)\]/i;

/**
 * The reviewer's note that a capture's render-failure notice was checked out, read from
 * the EVIDENCE row that cites the capture - never from the capture itself, which the
 * ledger hashes whole.
 */
function renderReviewNote(corpus, capture) {
  for (const row of corpus.evidence) {
    if (captureOf(corpus, row)?.file !== capture.file) continue;
    const match = RENDER_REVIEW_RE.exec(String(row.finding ?? ''));
    if (match) return match[1].trim();
  }
  return '';
}


function captureCompleteness(corpus) {
  const out = [];
  for (const unknown of corpus.unknowns) {
    if (unknown.status !== 'CLOSED') continue;
    const rows = unknown.cites
      .map((id) => corpus.evidence.find((e) => e.id.toUpperCase() === id.toUpperCase()))
      .filter(Boolean);
    if (!rows.length) continue;
    const captures = rows.map((row) => captureOf(corpus, row)).filter(Boolean);
    if (!captures.length) continue;
    if (captures.every((c) => c.completeness === 'partial')) {
      const omitted = captures.map((c) => c.omitted).filter(Boolean).join('; ');
      out.push(finding('warn', 'capture-completeness', 'partial-only',
        `${unknown.id} rests solely on partial captures${omitted ? ` (omitted: ${omitted})` : ''}`,
        { row: unknown.id, line: unknown.line }));
    }
  }
  for (const capture of corpus.captures.entries) {
    if (capture.completeness === 'partial' && !capture.omitted) {
      out.push(finding('warn', 'capture-completeness', 'partial-unnamed',
        `${capture.file} is graded partial but does not say what was omitted`, { file: capture.file }));
    }
  }

  // A page that SAYS it failed to render, in its own words.
  //
  // `completeness` grades the TRANSPORT - how much of the response arrived - and a page
  // whose body is built by script arrives whole and empty. That gap was found the hard way:
  // a GitHub Discussion graded `full` while carrying page furniture and no discussion.
  //
  // This does NOT claim a capture is empty, and the distinction is the whole reason it is
  // worded the way it is. Measured over the 60 captures in this repository, four carry such
  // a marker and THREE OF THOSE WERE USED AND CITED - GitHub renders the main content while
  // some side widget fails. So the honest finding is "part of this page reported a failure,
  // confirm the text you cite actually arrived", which was true in all four cases.
  //
  // Detecting emptiness itself was attempted and abandoned; ADR-0037 records the
  // measurements, because both obvious heuristics fail in opposite directions.
  // Only a capture some unknown cites (through its EVIDENCE row) gets the instruction: on a
  // context-only row there is no cited text to confirm, and every phase-0 map collects
  // such pages (ADR-0099). An uncited capture is hygiene's to report, not this check's.
  const citedFiles = new Set();
  for (const unknown of corpus.unknowns) {
    for (const id of unknown.cites ?? []) {
      const row = corpus.evidence.find((e) => e.id.toUpperCase() === String(id).toUpperCase());
      const file = row ? captureOf(corpus, row)?.file : null;
      if (file) citedFiles.add(file);
    }
  }
  for (const capture of corpus.captures.entries) {
    if (!citedFiles.has(capture.file)) continue;
    const hits = renderFailureMarkers(corpus, capture);
    if (!hits) continue;

    // The finding is a REVIEW INSTRUCTION - "confirm the text you cite is present" - so it
    // has to be closable by having done the review. Same bargain `completeness: partial`
    // strikes with `omitted:`: you may say the shortfall is accounted for, and you must say
    // what you checked. Without it the warning stands forever on three captures this
    // repository actively relies on, and a permanent warning is one nobody reads.
    //
    // THE NOTE LIVES ON THE EVIDENCE ROW, NOT IN THE CAPTURE'S FRONT-MATTER, and the reason
    // is worth keeping: `verifyLedger` hashes the WHOLE capture file, front-matter included.
    // Annotating a capture would break `body-unmodified` and fail the chain. A capture is
    // evidence and stays byte-immutable; a reviewer's judgement about it is corpus prose,
    // and corpus prose is where judgements already live (the unknown's status, the map's
    // DISMISSED reason). The first design put it in front-matter and the ledger refused it.
    const reviewed = renderReviewNote(corpus, capture);
    if (reviewed.length >= MIN_RENDER_REVIEW) {
      out.push(finding('pass', 'capture-completeness', 'partial-render-reviewed',
        `${capture.file} prints ${hits} render-failure notice(s), and the review is recorded: ${reviewed}`,
        { file: capture.file }));
      continue;
    }
    // The instruction names the EVIDENCE row on purpose. It used to say "a `renderReview:`
    // front-matter line", which is the one place the note must NOT go - the paragraph above
    // explains why, and the message contradicted it. A reviewer who followed it literally
    // got a BLOCKING `provenance/body-unmodified` failure and kept this warning, because
    // editing a capture breaks the hash recorded at fetch. Measured, not reasoned: doing
    // exactly what the old text said turned a 1-warning PASS into a 1-blocking FAIL.
    out.push(finding('warn', 'capture-completeness', 'partial-render',
      `${capture.file} contains ${hits} render-failure notice(s) from the page itself - `
      + 'it arrived whole, so `completeness` cannot see this. Confirm the text cited from it is '
      + `present, then write \`[render-reviewed: what you checked]\` (at least ${MIN_RENDER_REVIEW} `
      + 'characters) into the Finding cell of an EVIDENCE row that cites this capture. Do not edit '
      + 'the capture: the ledger hashes it whole, front-matter included'
      + (reviewed ? ` (the current note gives only "${reviewed}")` : ''),
      { file: capture.file }));
  }
  if (!out.length) out.push(finding('pass', 'capture-completeness', 'completeness', 'no closed unknown rests on a partial capture alone'));
  return out;
}

// ---------------------------------------------------------------- 9. evidence-supersession

/**
 * A refresh must trigger CLAIM REVIEW, not a silent substitution (ADR-0026).
 *
 * Re-collecting a page adds a new row and leaves the old one standing, still cited. The
 * claim above it was written against bytes that are no longer what the source says, and
 * nothing asked anybody to re-read it - so `--refresh-days` produced a fresher capture
 * and left the citation pointing at the stale one, which is the shape of a claim that
 * quietly stops being true.
 *
 * The old capture is KEPT - it is history, and evidence is irreplaceable. What is refused
 * is a superseded row still carrying an unknown.
 */
/**
 * Which rows have been replaced by a fresher capture of the same URL.
 *
 * Extracted 2026-09-20 because three checks need the same answer and two of them were
 * getting it wrong by not asking. `evidence-supersession` computed it privately, while
 * `transport-provenance` and `hygiene` knew nothing about ADR-0026 and warned about the
 * exact state that ADR REQUIRES: two rows for one URL, the older one kept as history.
 *
 * Returns `Map<upper-cased old id, the row that replaced it>`.
 */
export function supersededRows(corpus) {
  const byUrl = new Map();
  for (const row of corpus.evidence) {
    if (!row.url) continue;
    const key = urlKey(row.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(row);
  }

  // On ONE date the ledger decides, as `newer` (corpus.mjs) decides for the collector: the row
  // whose capture the later fetch wrote is current, a capture no fetch recorded ranks below
  // every one a fetch did, and only among those does the table's order still break the tie.
  // Until 2026-10-03 (output-reliability audit, G4) the sort was by date alone and a same-day
  // tie fell to the stable sort's TABLE ORDER: with A fetched, then B, then A again - the
  // third fetch reusing A's file - the collector held A current while this said B had
  // superseded it, and swapping two evidence rows swapped the verdict.
  // The date is the capture's, as freshness is judged (`freshnessDay`), not the table cell's:
  // ordered by the cell, one edit to an older row's date made the gate fail the genuinely
  // newest row for citing a "superseded" capture and told the operator to cite the older one
  // (found 2026-10-03, review of G4 and G8).
  const rank = ledgerRank(corpus.ledger?.entries);
  const rankOf = (row) => rank.get(row.raw || captureOf(corpus, row)?.file) ?? -1;

  const superseded = new Map();
  for (const rows of byUrl.values()) {
    if (rows.length < 2) continue;
    const ordered = [...rows].sort((a, b) => compareText(freshnessDay(corpus, a), freshnessDay(corpus, b)) || (rankOf(a) - rankOf(b)));
    const current = ordered[ordered.length - 1];
    // A row is never superseded by itself: a row pasted twice read "E-01 has been superseded
    // by E-01" (found 2026-09-27). The duplicate ID is hygiene's to name.
    for (const row of ordered.slice(0, -1)) {
      if (row.id.toUpperCase() !== current.id.toUpperCase()) superseded.set(row.id.toUpperCase(), current);
    }
  }
  return superseded;
}

/** Is this row superseded AND relied on by nothing? Then it is history, and silent. */
function isReleasedHistory(corpus, row, superseded = supersededRows(corpus)) {
  if (!superseded.has(row.id.toUpperCase())) return false;
  return !corpus.unknowns.some((u) => u.cites.some((c) => c.toUpperCase() === row.id.toUpperCase()));
}

function evidenceSupersession(corpus) {
  const out = [];
  const superseded = supersededRows(corpus);
  if (!superseded.size) {
    return [finding('pass', 'evidence-supersession', 'supersession', 'no evidence row has been re-collected')];
  }

  for (const unknown of corpus.unknowns) {
    for (const id of unknown.cites) {
      const replacement = superseded.get(id.toUpperCase());
      if (!replacement) continue;
      out.push(finding('fail', 'evidence-supersession', 'cites-superseded-row',
        `${unknown.id} rests on ${id}, which has been superseded by ${replacement.id} - a fresher capture of the same URL `
        + `(${replacement.retrieved}). Re-read it, then move the citation or record why the earlier reading still holds.`,
        { row: unknown.id, line: unknown.line, superseded: id, by: replacement.id }));
    }
  }

  for (const [id, replacement] of superseded) {
    if (corpus.unknowns.some((u) => u.cites.some((c) => c.toUpperCase() === id))) continue;
    out.push(finding('pass', 'evidence-supersession', 'superseded-and-released',
      `${id} was superseded by ${replacement.id} and is cited by nothing - kept as history`));
  }
  return out;
}

// ---------------------------------------------------------------- 10. collection-attempts

function collectionAttempts(corpus) {
  const out = [];
  for (const unknown of corpus.unknowns) {
    if (unknown.status !== 'KNOWN-UNKNOWN') continue;
    // An attempt counts when the ledger holds any entry for a URL the row names - directly,
    // or through an E-row it cites. The citation is the stronger proof: an E-row is a
    // CAPTURE of its URL. Until 2026-09-26 only a literal URL counted, so a KNOWN-UNKNOWN
    // citing the page it reached for was warned as never attempted.
    const citedUrls = unknown.cites
      .map((id) => corpus.evidence.find((row) => row.id.toUpperCase() === id.toUpperCase())?.url)
      .filter(Boolean);
    const attempted = corpus.ledger.entries.some((entry) => entry.url
      && (unknown.evidence.includes(entry.url) || citedUrls.includes(entry.url)));
    if (attempted) continue;
    out.push(finding('warn', 'collection-attempts', 'unknown-attempted',
      `${unknown.id} is KNOWN-UNKNOWN with no recorded fetch attempt - an unreachable fact should have been reached for`,
      { row: unknown.id, line: unknown.line }));
  }
  if (!out.length) out.push(finding('pass', 'collection-attempts', 'attempts', 'every known-unknown was reached for'));
  return out;
}

// ---------------------------------------------------------------- 11. hygiene

function hygiene(corpus) {
  const out = [];
  // "One row per fetched page" is right for a duplicate and WRONG for a refresh.
  //
  // ADR-0026 requires a re-collection to add a row and leave the old one standing, so
  // two rows for one URL is the designed state, not a hygiene problem. This check
  // predated that ADR and warned about it anyway - six times, immediately after the
  // refresh the ADR exists to govern. What is still worth warning about is two rows for
  // one URL fetched on the SAME DAY, which no refresh produces and which is the real
  // duplicate this check was written for.
  const superseded = supersededRows(corpus);
  // Fetches the ledger records per URL per day. Two rows for one URL on one day are a
  // refresh when the ledger holds a fetch for each of them - `research.mjs --force` - and
  // a duplicate when it does not, which is what a pasted row looks like.
  const fetchesOn = new Map();
  for (const entry of corpus.ledger?.entries ?? []) {
    if (entry.op !== 'scrape' || !entry.url) continue;
    const key = `${urlKey(entry.url)} ${String(entry.at ?? '').slice(0, 10)}`;
    fetchesOn.set(key, (fetchesOn.get(key) ?? 0) + 1);
  }
  const rowsOn = new Map();
  for (const row of corpus.evidence) {
    if (!row.url) continue;
    const key = `${urlKey(row.url)} ${row.retrieved}`;
    rowsOn.set(key, (rowsOn.get(key) ?? 0) + 1);
  }
  const fetchedEach = (row) => {
    const key = `${urlKey(row.url)} ${row.retrieved}`;
    return (fetchesOn.get(key) ?? 0) >= (rowsOn.get(key) ?? 0);
  };
  const seenUrl = new Map();
  for (const row of corpus.evidence) {
    if (!row.url) continue;
    const key = urlKey(row.url);
    const held = seenUrl.get(key);
    if (held) {
      const isRefresh = superseded.has(held.id.toUpperCase())
        && (held.retrieved !== row.retrieved || fetchedEach(row));
      // The same ID twice is duplicate-id's to name, not a second row citing the same URL.
      if (!isRefresh && held.id.toUpperCase() !== row.id.toUpperCase()) {
        out.push(finding('warn', 'hygiene', 'duplicate-url',
          `${row.id} cites the same URL as ${held.id} on the same day - one row per fetched page`,
          { row: row.id, line: row.line }));
      }
    }
    // The LATEST row for a URL is the one a further duplicate should be compared against.
    if (!held || compareText(row.retrieved, held.retrieved) >= 0) seenUrl.set(key, row);
  }

  const ids = new Set();
  for (const row of [...corpus.evidence, ...corpus.unknowns, ...corpus.subtopics]) {
    const key = row.id.toUpperCase();
    // A fail, not a warn: the ID is how a citation, a COVERED cell or the brief names a
    // row, and with two rows under it every such reference resolves to one of them
    // silently - lookups keep the last.
    if (ids.has(key)) {
      out.push(finding('fail', 'hygiene', 'duplicate-id',
        `${row.id} is used twice - give the second row its own ID, or delete it if it is a copy`,
        { row: row.id, line: row.line }));
    }
    ids.add(key);
  }

  // The brief is the one file phase 2 must read. A draft stamped with inputs that no longer
  // match the corpus says whatever the corpus said then - a failing gate, a missing unknown.
  const stamp = corpus.brief?.present ? draftStamp(corpus.brief.text) : null;
  if (stamp && stamp.inputs !== briefInputsHash(corpus)) {
    out.push(finding('warn', 'hygiene', 'brief-stale',
      `${PATHS.brief} was drafted before the contract or evidence last changed - `
      + (stamp.edited
        ? `redraft with ${kitCommand('brief.mjs', '--force')} (the edited brief is kept as a backup) and carry your judgements over`
        : `redraft with ${kitCommand('brief.mjs')}`),
      { file: PATHS.brief }));
  }
  // A drafted brief with no stamp was drafted before ADR-0055 gave drafts one. Its currency
  // cannot be checked, so it keeps its approval (ADR-0138) - and this says so, because an
  // approval nothing can check is otherwise silent (found 2026-10-03, review of the G1 fix).
  const state = corpus.brief?.present ? briefState(corpus.brief.text) : 'template';
  if (!stamp && (state === 'draft' || state === 'authored')) {
    out.push(finding('warn', 'hygiene', 'brief-unstamped',
      `${PATHS.brief} carries no draft stamp (it was drafted before ADR-0055), so whether it is current with the contract and `
      + `evidence cannot be checked - redraft with ${kitCommand('brief.mjs', '--force')} (the brief is kept as a backup) and carry your judgements over`,
      { file: PATHS.brief }));
  }

  const cited = new Set(corpus.evidence.map((row) => row.raw || captureOf(corpus, row)?.file).filter(Boolean));
  // "Was collected" is the ledger's to say: a file under research/raw that no scrape entry
  // names was planted or copied there, and that is what its reader needs to hear (break-test
  // pass 4, F5a, 2026-10-04). The same warning, in the words that are true of the file.
  const fetched = new Set((corpus.ledger?.entries ?? []).filter((e) => e.op !== 'fail' && e.raw).map((e) => e.raw));
  for (const capture of corpus.captures.entries) {
    if (cited.has(capture.file)) continue;
    out.push(finding('warn', 'hygiene', 'uncited-capture',
      fetched.has(capture.file)
        ? `${capture.file} was collected but no evidence row cites it`
        : `${capture.file} is under ${PATHS.raw} but no ledger entry records a fetch of it and no evidence row cites it`,
      { file: capture.file }));
  }

  for (const row of corpus.evidence) {
    if (!row.retrieved || ageInDays(row.retrieved) !== null) continue;
    out.push(finding('warn', 'hygiene', 'unparseable-date',
      `${row.id} has retrieval date "${row.retrieved}", which does not parse`, { row: row.id, line: row.line }));
  }

  // The cell and the capture it cites must name the same day. The collector writes one
  // `today()` into both, so a disagreement is an edit to the table after the fetch - and
  // until 2026-10-03 nothing said so, while freshness read the cell: editing E-19's date
  // alone made its stale warning disappear (output-reliability audit, G8). Freshness now
  // reads the capture (`freshnessDate`), and this is the finding that explains why the
  // table's date is not the one being judged. A cell that does not parse is
  // unparseable-date's to name; a capture with no date gives nothing to reconcile against.
  for (const row of corpus.evidence) {
    const capture = ownCapture(corpus, row);
    const captureDay = retrievedDay(capture?.retrieved);
    if (!captureDay) continue;
    if (row.retrieved && ageInDays(row.retrieved) === null) continue;
    if (retrievedDay(row.retrieved) === captureDay) continue;
    out.push(finding('warn', 'hygiene', 'date-mismatch',
      `${row.id} has retrieval date ${row.retrieved || '(blank)'}, but its capture ${capture.file} records retrieved ${captureDay} - `
      + 'write the capture\'s date in the row; freshness is judged by the capture, not the table',
      { row: row.id, line: row.line }));
  }

  // No page was fetched in the future, and a future date hides the row's age from every
  // freshness check: 2030-01-01 passed without a word (found 2026-09-27). A day of slack, so
  // a date written in a time zone ahead of this machine's is not a failure.
  for (const row of corpus.evidence) {
    const age = row.retrieved ? ageInDays(row.retrieved) : null;
    if (age !== null && age < -1) {
      out.push(finding('fail', 'hygiene', 'future-date',
        `${row.id} has retrieval date ${row.retrieved}, which is in the future - write the date the page was fetched (its capture records it)`,
        { row: row.id, line: row.line }));
      continue;
    }
    // The capture's date is the one freshness is judged by, so a future date there hides the
    // row's age just as well, and only date-mismatch had anything to say (found 2026-10-03,
    // review of G8). It takes a collector whose clock was ahead; it is still not evidence.
    const capture = ownCapture(corpus, row);
    const captureAge = capture ? ageInDays(capture.retrieved) : null;
    if (captureAge === null || captureAge >= -1) continue;
    out.push(finding('fail', 'hygiene', 'future-date',
      `${row.id}'s capture ${capture.file} records retrieved ${retrievedDay(capture.retrieved)}, which is in the future - the collector's clock was ahead `
      + 'when the page was fetched, and freshness is judged by that date; re-collect the page',
      { row: row.id, line: row.line, file: capture.file }));
  }

  // A row whose ID is not in its table's form is a fail, for the same reason duplicate-id is:
  // the ID is how every check finds the row, and a row no check can find is a requirement
  // that has silently left the gate. `U_99` was read as nothing at all - not an unknown, not a
  // problem, not a finding (found 2026-10-03, output-reliability audit G2); readCorpus now
  // records it, and this is where it is named.
  for (const problem of corpus.problems) {
    if (problem.kind !== 'malformed-id' && problem.kind !== 'table-split') continue;
    out.push(finding('fail', 'hygiene', problem.kind,
      `${problem.artifact}:${problem.line} ${problem.detail}`, { row: problem.row, line: problem.line }));
  }

  if (!out.length) out.push(finding('pass', 'hygiene', 'hygiene', 'no duplicate rows, no uncited captures'));
  return out;
}

// ---------------------------------------------------------------- 12. corpus-shape

function corpusShape(corpus) {
  const out = [];
  for (const problem of corpus.problems) {
    // hygiene names a malformed ID (as a fail, beside duplicate-id); echoing it here as a warn
    // would report one typo twice.
    if (problem.kind === 'malformed-id' || problem.kind === 'table-split') continue;   // hygiene's, as a fail
    const blocking = problem.kind === 'raw-dangling' || problem.kind === 'plan-unparsed' || problem.kind === 'kit-unparsed'
      || problem.kind === 'capture-outside' || problem.kind === 'raw-outside' || problem.kind === 'capture-too-large' || problem.kind === 'capture-unreadable';
    out.push(finding(blocking ? 'fail' : 'warn', 'corpus-shape', problem.kind,
      `${problem.artifact ?? ''}${problem.line ? `:${problem.line}` : ''} ${problem.detail ?? problem.file ?? ''}`.trim(),
      { line: problem.line, file: problem.file }));
  }
  if (!corpus.rawPresent) {
    out.push(finding('fail', 'corpus-shape', 'raw-missing',
      `${PATHS.raw}/ does not exist - a gated project needs somewhere to keep its captures`));
  }
  if (!out.length) out.push(finding('pass', 'corpus-shape', 'shape', 'the corpus parses cleanly'));
  return out;
}


// ---------------------------------------------------------------- 13. corroboration

/**
 * How many independent readings does a closed unknown rest on?
 *
 * WHY THIS EXISTS. Every check before it asks whether a claim is BACKED - is there a row,
 * is there a capture, does the chain verify, is it fresh, is it primary. None of them asks
 * whether it is backed more than once, so a corpus in which every unknown rested on a
 * single page passed preflight and `--strict` with nothing to say about it. From inside
 * such a corpus, a single CORRECT source and a single LUCKY one are indistinguishable.
 *
 * Found in this repository's own delivery-architecture corpus on 2026-09-21: nine rows,
 * all primary, all complete, all fresh - and eight unknowns each resting on exactly one of
 * them. Three of those eight carried architecture decisions.
 *
 * WHY IT IS A WARNING. Single-sourcing is often the right answer: a vendor's own API
 * reference is the authority on that API, and demanding a second opinion about it would be
 * ceremony. This check refuses to make that judgement - it reports the shape of the
 * support so a reviewer can make it. `evidencePolicy=strict` or `--strict` is where an
 * operator says they want the harder rule.
 *
 * WHY THE HOST MATTERS. Two pages from one vendor are not two witnesses. They are one
 * witness read twice, which catches a misreading and cannot catch a vendor being wrong
 * about itself. The finding says which of those it found, because the remedies differ:
 * one wants another page, the other wants another party.
 */
/**
 * A reviewer's recorded judgement that an unknown has ONE witness and cannot have two.
 *
 * WHY THIS EXISTS. `corroboration` reports the shape of support and leaves the judgement
 * to a reviewer (ADR-0036) - but it gave the reviewer nowhere to put the judgement. So a
 * claim that had been considered and correctly left single-sourced looked exactly like one
 * nobody had looked at twice, forever, and `evidencePolicy=strict` was unsatisfiable by
 * any corpus containing an honest one.
 *
 * WHY A REASON IS REQUIRED, and why that is the whole mechanism: this is the same shape
 * `MAP.md` already uses for `DISMISSED` and `completeness: partial` uses for `omitted` -
 * you may overrule the default, and you must say why in writing that survives in the
 * corpus. The check does not grade the reason (ADR-0013); it requires one to exist and
 * shows it in the finding, so the judgement is auditable rather than invisible.
 *
 * MIN_REASON exists because `[single-witness: n/a]` would otherwise be a silent mute.
 */
const SINGLE_WITNESS_RE = /\[single-witness:\s*([^\]]*)\]/i;
const MIN_WITNESS_REASON = 30;

function singleWitnessNote(unknown) {
  const match = SINGLE_WITNESS_RE.exec(String(unknown.evidence ?? ''));
  if (!match) return null;
  return { reason: match[1].trim() };
}

function corroboration(corpus) {
  const out = [];
  const byId = new Map(corpus.evidence.map((row) => [row.id.toUpperCase(), row]));

  const weighed = new Set();
  for (const unknown of corpus.unknowns) {
    // A KNOWN-UNKNOWN rests on nothing by definition, and unknown-closure already owns
    // the case of a CLOSED one citing no row at all.
    if (unknown.status !== 'CLOSED') continue;
    // Once per ID: a second row under the same ID is hygiene's duplicate-id, and weighing
    // it again printed the same finding twice.
    if (weighed.has(unknown.id.toUpperCase())) continue;
    weighed.add(unknown.id.toUpperCase());

    // DEDUPED BY ID, and that is load-bearing. `citedIds` returns every E-## mention in the
    // cell, so an unknown whose prose names E-10 twice - "E-10 says X … as E-10 also notes"
    // - yields the same row twice. Counting it twice would inflate the support, and once
    // `documentGroups` folds the duplicate it reports a "republished copy" about a row that
    // was only ever mentioned twice. Host-counting masked this: duplicates inflated
    // `rows.length` but collapsed in the host Set, so the finding stayed right by accident.
    // Found 2026-09-21 by running the new grouping over the delivery-architecture corpus.
    const rows = [...new Set(unknown.cites.filter((id) => /^E-\d+$/i.test(id)).map((id) => id.toUpperCase()))]
      .map((id) => byId.get(id))
      .filter(Boolean);
    if (!rows.length) continue;

    // The SHAPE of the support, computed once. Whether that shape is acceptable is a
    // separate question, answered below, because a reviewer may overrule it with a reason.
    let shape;
    if (rows.length === 1) {
      shape = { rule: 'single-source', detail: `rests on ${rows[0].id} alone - one reading, so a correct source and a lucky one look the same` };
    } else {
      // By SITE, not hostname: two subdomains of one company are one voice (2026-09-28).
      const hosts = new Set(rows.map((row) => siteOf(row.url)).filter(Boolean));
      if (hosts.size === 1) {
        shape = { rule: 'one-voice', detail: `cites ${rows.length} rows and all are ${[...hosts][0]} - a second reading of one source, which catches a misreading and not a source that is wrong about itself` };
      } else {
        // Several hosts is where the host heuristic used to stop and say `independent`. A
        // mirror passes that test while carrying LESS than either genuine page, so the rows
        // are grouped into distinct DOCUMENTS before the hosts are counted again.
        const sketches = rows.map((row) => corpus.captures.sketches?.get(captureOf(corpus, row)?.file) ?? null);
        const groups = documentGroups(sketches);
        if (groups.length === 1) {
          shape = { rule: 'mirror', detail: `cites ${rows.length} rows across ${hosts.size} hosts but they are the same document - a republished copy is one witness, and the copy may be the stale one` };
        } else {
          // Hosts that survive as DISTINCT documents. A three-row unknown where two rows
          // mirror each other still counts the third, so this reports what is independent.
          const distinctHosts = new Set(groups.map((g) => siteOf(rows[g[0]].url)).filter(Boolean));
          if (distinctHosts.size === 1) {
            shape = { rule: 'one-voice', detail: `cites ${rows.length} rows across ${hosts.size} hosts, but after grouping republished copies only ${[...distinctHosts][0]} remains - one voice` };
          } else {
            const mirrored = rows.length - groups.length;
            const closest = closestPair(sketches);
            shape = {
              corroborated: true,
              rule: 'independent',
              // The closest pair is REPORTED, never acted on. The threshold has two measured
              // blind spots and containment - the obvious repair - ranks a genuinely
              // different pair above a real mirror, so trying harder would report second
              // sources as copies. A number a reviewer can act on beats a verdict that
              // pretends to more certainty than the measurement supports.
              detail: `rests on ${groups.length} distinct documents across ${distinctHosts.size} hosts`
                + (mirrored ? ` (${mirrored} of ${rows.length} rows are republished copies and were not counted twice)` : '')
                + (closest === null ? '' : `; closest pair ${closest.toFixed(2)}`),
            };
          }
        }
      }
    }

    const note = singleWitnessNote(unknown);

    // An acknowledgement left on an unknown that has SINCE been corroborated is reported,
    // not silently ignored. It now claims no second witness exists while the corpus holds
    // one - which is a stale claim of exactly the kind this repository keeps finding in its
    // own prose, and the only moment anything can notice is right here. It stays a warning
    // that names its limit: sites are what it counts, and a paper beside its authors' own
    // repository is two sites and one voice (found 2026-09-29).
    if (shape.corroborated) {
      if (note) {
        out.push(finding('warn', 'corroboration', 'single-witness-stale',
          `${unknown.id} ${shape.detail}, but still carries a [single-witness: ...] note claiming it cannot be corroborated. This check counts sites, not authors: if these pages share an author, the note stands; if not, remove the note or the claim is false`,
          { row: unknown.id, line: unknown.line }));
        continue;
      }
      out.push(finding('pass', 'corroboration', shape.rule, `${unknown.id} ${shape.detail}`,
        { row: unknown.id, line: unknown.line }));
      continue;
    }

    if (!note) {
      out.push(finding('warn', 'corroboration', shape.rule, `${unknown.id} ${shape.detail}`,
        { row: unknown.id, line: unknown.line }));
      continue;
    }

    // A note with no real reason is a mute button, and gets its own finding rather than
    // quietly behaving like the default - otherwise the weakest possible acknowledgement
    // and no acknowledgement at all would be indistinguishable.
    if (note.reason.length < MIN_WITNESS_REASON) {
      out.push(finding('warn', 'corroboration', 'single-witness-unreasoned',
        `${unknown.id} ${shape.detail}; its [single-witness: ...] note gives ${note.reason.length ? `only "${note.reason}"` : 'no reason'} - state why no second witness exists, in at least ${MIN_WITNESS_REASON} characters`,
        { row: unknown.id, line: unknown.line }));
      continue;
    }

    out.push(finding('pass', 'corroboration', 'single-witness',
      `${unknown.id} ${shape.detail} - accepted on the record: ${note.reason}`,
      { row: unknown.id, line: unknown.line }));
  }

  if (!out.length) out.push(finding('pass', 'corroboration', 'support', 'no closed unknown to weigh'));
  return out;
}

// ---------------------------------------------------------------- the registry

/** Order is part of the interface: a failure a person must act on precedes a warning. */
export const CHECKS = Object.freeze([
  { name: 'discovery-contract', about: 'the contract exists, states intent, and every unknown has a valid status', run: discoveryContract },
  { name: 'citations', about: 'every evidence row has a URL, a claim, and a cached page behind it', run: citations },
  { name: 'provenance', about: 'the chain verifies and every cited capture was actually fetched', run: provenance },
  { name: 'transport-provenance', about: 'which adapter fetched each cited capture', run: transportProvenance },
  { name: 'gate-integrity', about: 'overrides in effect, and whether this repository displaces the gate', run: gateIntegrity },
  { name: 'unknown-closure', about: 'every CLOSED unknown rests on a real, fresh, primary row', run: unknownClosure },
  { name: 'subtopic-coverage', about: 'the map covers every universal dimension, and states a status for each', run: subtopicCoverage },
  { name: 'capture-completeness', about: 'no closed unknown rests solely on a partial capture', run: captureCompleteness },
  { name: 'evidence-supersession', about: 'no unknown still rests on a row a later capture replaced', run: evidenceSupersession },
  { name: 'collection-attempts', about: 'a known-unknown was reached for before it was declared unreachable', run: collectionAttempts },
  { name: 'hygiene', about: 'duplicate rows, uncited captures, unparseable dates', run: hygiene },
  { name: 'corpus-shape', about: 'the corpus parses and the shape is there', run: corpusShape },
  { name: 'corroboration', about: 'how many independent readings a closed unknown rests on', run: corroboration },
]);

export const CHECK_NAMES = Object.freeze(CHECKS.map((c) => c.name));

export function runCheck(name, corpus, options = {}) {
  const check = CHECKS.find((c) => c.name === name);
  if (!check) {
    const err = new Error(`unknown check "${name}". Known checks: ${CHECK_NAMES.join(', ')}`);
    err.code = 'UNKNOWN_CHECK';
    throw err;
  }
  return check.run(corpus, options);
}

export function runChecks(corpus, options = {}) {
  const only = options.only?.length ? options.only : CHECK_NAMES;
  for (const name of only) {
    if (!CHECK_NAMES.includes(name)) {
      const err = new Error(`unknown check "${name}". Known checks: ${CHECK_NAMES.join(', ')}`);
      err.code = 'UNKNOWN_CHECK';
      throw err;
    }
  }
  const findings = [];
  for (const check of CHECKS) {
    if (!only.includes(check.name)) continue;
    // One at a time, never `push(...check.run())`: a spread passes every finding as an
    // argument, and past the engine's argument limit - between 60,000 and 130,000 findings
    // from one check, depending on the Node line - it throws RangeError out of the verdict
    // (2026-10-01, break-test PR #188). A loop has no such ceiling.
    for (const finding of check.run(corpus, options)) findings.push(finding);
  }
  return findings;
}

export { citedIds };
