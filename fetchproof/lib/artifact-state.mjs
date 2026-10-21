// Shared approval derivation: producer policy and portable package baseline (ADR-0160).
import { PATHS, resolve, relative, projectFile, readText, sha256 } from './core.mjs';
import { readCorpus, captureOf, parseCapture } from './corpus.mjs';
import { verifyLedger } from './provenance.mjs';
import { verifyHandoff } from './handoff.mjs';
import { runPreflight } from './preflight.mjs';
import { briefState, reviewedBy, draftStamp, briefInputsHash, judgedSection, JUDGED_SECTIONS } from './brief.mjs';
import { firstFinding } from './finding.mjs';

export function deriveState(root, { corpus = null, env = {} } = {}) {
  return derive(root, { corpus, env });
}

export function derivePortableState(root, { corpus = null, formatMajor = 2 } = {}) {
  const snapshot = corpus ?? readCorpus(root);
  if (!snapshot.chain) snapshot.chain = verifyLedger(snapshot.root, { corpus: snapshot });
  const context = {
    root: snapshot.root, corpus: snapshot,
    gate: { gateOff: false, localHooksPath: null }, evidencePolicy: 'pluralist', maxAgeDays: 180,
  };
  return derive(root, { corpus: snapshot, context, legacyFormat: formatMajor === 1 });
}

// Exact pre-ADR-0069 algorithm from 3bac1f26; its actual writer was probed first.
export function legacyBriefInputsHash(snapshot) {
  return sha256(JSON.stringify({
    topic: snapshot.map?.topic || snapshot.plan?.topic || '',
    intent: snapshot.intent ?? '',
    unknowns: (snapshot.unknowns ?? []).map((u) => [u.id, u.text, u.status, u.evidence]),
    evidence: (snapshot.evidence ?? []).map((e) => [e.id, e.retrieved, e.type, e.url, e.finding, e.raw]),
  })).slice(0, 16);
}

function legacyMarker(text) {
  const markers = [...String(text ?? '').matchAll(/<!-- fetchproof:brief-draft body=([0-9a-f]{16}) inputs=([0-9a-f]{16})(?: gate=(pass|fail|unknown))? -->/g)];
  return markers.length > 0 && markers.at(-1)[3] === undefined;
}

/**
 * `deriveState(root)` -> everything the manifest may say about permission.
 *
 * Runs the real gate. No caller input reaches this function.
 */
function derive(root, { corpus = null, env = {}, context = null, legacyFormat = false } = {}) {
  const snapshot = corpus ?? readCorpus(root);

  // The gate. `env` defaults to an EMPTY object rather than process.env: a producer must
  // not be able to inherit a GATE_OFF or an override from whatever shell it ran in, and
  // reading the ambient environment is exactly how that would happen.
  let verdict = null;
  let blockingFindings = [];
  try {
    verdict = runPreflight(root, { corpus: snapshot, env, context });
    blockingFindings = (verdict.findings ?? [])
      .filter((f) => f.severity === 'fail')
      .map((f) => ({
        code: `${f.rule}${f.kind ? `/${f.kind}` : ''}`,
        message: String(f.detail ?? f.rule),
        remedy: f.fix ? String(f.fix) : null,
      }));
  } catch (err) {
    blockingFindings = [{ code: 'preflight/unrunnable', message: `the gate could not run: ${err.message}`, remedy: null }];
  }

  const handoff = verifyHandoff(root, { corpus: snapshot });
  const gatePass = Boolean(verdict?.pass) && blockingFindings.length === 0 && handoff.ok;

  // Review, derived.
  const rows = snapshot.subtopics ?? [];
  const mapClassified = rows.length > 0 && rows.every((r) => ['COVERED', 'DISMISSED', 'GAP'].includes(r.status));
  // Reviewed means three things (2026-10-03, output-reliability audit G1): the brief is
  // authored (drafted, no TODO left); every judged section is PRESENT and answered - a missing
  // section holds no TODO, so a drafted brief with no review sections at all had derived
  // APPROVED_BRIEF on the repository's own corpus; and a stamped brief was drafted from the
  // corpus as it is now - one whose evidence changed after the draft had stayed authorized
  // with hygiene's brief-stale warning beside it. A brief with no stamp predates ADR-0055 (the
  // root's own and ten decision briefs do): its currency cannot be checked, so it keeps the
  // approval and hygiene's brief-unstamped says so (ADR-0138); a redraft with --force stamps it.
  const briefText = snapshot.brief?.text ?? '';
  const stamp = draftStamp(briefText);
  const briefComplete = JUDGED_SECTIONS.every((key) => judgedSection(briefText, key)?.answered);
  const legacyBriefCompatible = legacyFormat && stamp && legacyMarker(briefText)
    && stamp.inputs === legacyBriefInputsHash(snapshot);
  const briefCurrent = !stamp || stamp.inputs === briefInputsHash(snapshot) || legacyBriefCompatible;
  const briefReviewed = briefState(briefText) === 'authored' && briefComplete && briefCurrent;
  // Who did it is the reviewer's declaration, not a fact the kit can check (ADR-0074), and
  // it is not one of the approval conditions.
  const by = reviewedBy(snapshot.brief?.text ?? '');
  const { reviewed: findingsReviewed, unrewritten, unresolved } = findingsReviewState(root, snapshot);

  const collected = (snapshot.evidence ?? []).length;
  const collectionFailed = collected === 0 || !(snapshot.ledger?.present) || (snapshot.ledger?.entries ?? []).length === 0;

  const approved = gatePass && mapClassified && briefReviewed && findingsReviewed;
  const state = collectionFailed ? 'COLLECTION_FAILED'
    : approved ? 'APPROVED_BRIEF'
      : gatePass ? 'REVIEW_IN_PROGRESS'
        : (mapClassified || briefReviewed || findingsReviewed) ? 'PREFLIGHT_BLOCKED'
          : 'REVIEW_REQUIRED';

  return {
    state,
    kind: approved ? 'APPROVED_RESEARCH' : 'COLLECTED_CORPUS',
    buildAuthorized: approved,
    review: { mapClassified, findingsReviewed, briefReviewed, by },
    gate: {
      verdict: verdict === null ? 'NOT_RUN' : gatePass ? 'PASS' : blockingFindings.length ? 'FAIL' : 'INCOMPLETE',
      buildAuthorized: approved,
      blockingFindings,
    },
    handoff,
    verdict,
    unrewritten,
    unresolved,
    legacyBriefCompatible: Boolean(legacyBriefCompatible),
    corpus: snapshot,
  };
}

/**
 * A Finding cell identical to what the extractor produces from the same capture was
 * never rewritten. Negative evidence only, and that is stated rather than implied: this
 * cannot tell a good claim from a bad one, and does not try.
 */
export function findingsReviewState(root, corpus) {
  const rows = corpus.evidence ?? [];
  if (!rows.length) return { reviewed: false, unrewritten: [], unresolved: [] };
  const unrewritten = [];
  const unresolved = [];
  for (const row of rows) {
    const capture = captureOf(corpus, row);
    if (!capture?.file) { unresolved.push(row.id); continue; }
    const named = projectFile(root, capture.file);
    const rawRoot = resolve(root, PATHS.raw);
    const raw = projectFile(rawRoot, relative(rawRoot, named.abs));
    if (named.problem || raw.problem) { unresolved.push(row.id); continue; }
    const text = readText(raw.abs);
    if (text === null) { unresolved.push(row.id); continue; }
    // The collector's own call, over what it extracted from: the page body after the
    // front-matter, falling back to the page's title or URL (collect.mjs). Found 2026-09-27
    // on run 36287211468: run over the whole FILE, the extractor read the front-matter as the
    // page, never matched an untouched JSON capture's Finding, and a corpus nobody had
    // reviewed was packaged as reviewed - one of the four conditions for buildAuthorized.
    const { front, body } = parseCapture(text);
    const extracted = String(firstFinding(body, front.title || front.url || row.url || '') ?? '').trim();
    if (!extracted) continue;
    if (String(row.finding ?? '').trim() === extracted) unrewritten.push(row.id);
  }
  return { reviewed: unrewritten.length === 0 && unresolved.length === 0, unrewritten, unresolved };
}
