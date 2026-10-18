// brief.mjs - the phase-1 -> phase-2 handoff, and the owner of the brief's SHAPE (ADR-0014).
//
// Six sections, two of which the corpus cannot fill. The renderer writes its headings
// FROM this definition and lib/audit.mjs reads the judged sections through it, so the
// writer and its readers cannot drift.

import { PATHS, resolve, readText, writeText, today, documentCommand, sha256, foldLineEndings, keepBackup } from './core.mjs';
import { readCorpus, sectionOf, claimOf, captureOf } from './corpus.mjs';
import { readPrior } from './prior.mjs';
import { renderGateWarnings } from './render.mjs';

/** `judged: true` marks a section the corpus cannot fill - it needs the reviewer's call. */
export const BRIEF_SECTIONS = Object.freeze([
  { key: 'intent', heading: 'Intent', judged: false },
  { key: 'verified', heading: 'What we verified', judged: false },
  { key: 'contradictions', heading: 'Contradictions and how they were resolved', judged: true },
  { key: 'unknowns', heading: 'Known unknowns', judged: false },
  { key: 'decision', heading: 'Decision', judged: true },
  { key: 'next', heading: 'Next steps', judged: false },
]);

export const JUDGED_SECTIONS = Object.freeze(BRIEF_SECTIONS.filter((s) => s.judged).map((s) => s.key));
export const TODO_MARK = '**TODO**';

/**
 * The marker that says "this is still the scaffold". The substitution pass leaves it
 * alone; the alternative - matching the template's prose - made a sentence of English
 * load-bearing.
 */
export const BRIEF_FILE_MARKER = '<!-- research-kit:brief=scaffold -->';

/**
 * `template | legacy | draft | authored`.
 * Only the first two are safe to draft over, and `legacy` - a scaffold written before
 * the marker shipped, which the text cannot tell from a brief someone wrote in -
 * refuses loudly rather than guessing.
 */
/**
 * Who reviewed this corpus, as its reviewer declared it in the brief (ADR-0074): `agent`
 * or `undeclared`. The review is the agent's (ADR-0107); a line naming a person - valid in
 * 1.x packages - now reads as `undeclared`.
 *
 * A DECLARATION, and read as one. The three review steps are checked by what they leave
 * behind, never by who did them, so nothing can verify this line - and approval does not
 * depend on it. The drafted placeholder (`_agent - ..._`) is not a declaration.
 */
export function reviewedBy(text) {
  // An ambiguous declaration is no declaration (found 2026-09-27): a line naming both
  // roles - a careless edit of the placeholder reads "agent or human" - or two lines that
  // disagree read as `undeclared`, never as whichever came first. A line quoted inside a
  // code block is not the reviewer speaking.
  const outside = String(text ?? '').replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, '');
  const said = new Set();
  for (const [, value] of outside.matchAll(/^[ \t]*Reviewed by:(.*)$/gim)) {
    const roles = new Set([...value.toLowerCase().matchAll(/\b(agent|human)\b/g)].map((m) => m[1]));
    const first = value.replace(/^[ \t*]+/, '').toLowerCase().match(/^(agent|human)\b/);
    if (!first) continue;                 // the drafted placeholder, or not a role at all
    if (roles.size > 1) return 'undeclared';
    said.add(first[1]);
  }
  // The review is the agent's (ADR-0107): a line naming a person declares nothing the kit reads.
  return said.size === 1 && said.has('agent') ? 'agent' : 'undeclared';
}

export function briefState(text) {
  const body = String(text ?? '');
  if (!body.trim()) return 'template';
  if (body.includes(BRIEF_FILE_MARKER)) return 'template';
  const drafted = body.includes('_Auto-drafted');
  const todos = JUDGED_SECTIONS.filter((key) => {
    const section = BRIEF_SECTIONS.find((s) => s.key === key);
    return sectionOf(body, section.heading).includes(TODO_MARK);
  });
  if (drafted && todos.length) return 'draft';
  if (drafted) return 'authored';
  const hasHeadings = BRIEF_SECTIONS.some((s) => sectionOf(body, s.heading));
  return hasHeadings ? 'legacy' : 'template';
}

/**
 * The stamp a drafted brief ends with: a hash of its own text and a hash of what it was
 * drafted from. The first says whether anybody has edited it since - an untouched draft
 * holds no judgement, so it is redrafted without --force. The second says whether the
 * corpus has moved on since, which `hygiene/brief-stale` reports (ADR-0055).
 */
const DRAFT_STAMP = /\n?<!-- research-kit:brief-draft body=([0-9a-f]{16}) inputs=([0-9a-f]{16})(?: gate=(pass|fail|unknown))? -->[ \t]*\r?\n?/g;

const shortHash = (text) => sha256(foldLineEndings(text)).slice(0, 16);

/** What the brief is drafted FROM, parsed, so a reformatted table is not a change. */
export function briefInputsHash(snapshot) {
  return shortHash(JSON.stringify({
    topic: snapshot.map?.topic || snapshot.plan?.topic || '',
    intent: snapshot.intent ?? '',
    unknowns: (snapshot.unknowns ?? []).map((u) => [u.id, u.text, u.status, u.evidence]),
    evidence: (snapshot.evidence ?? []).map((e) => [e.id, e.retrieved, e.type, e.url, e.finding, e.raw]),
    // The map and the ledger decide the verdict too: a brief drafted while only the map was
    // incomplete said "Gate: FAIL" after the map was statused, and nothing called it stale
    // (found 2026-09-27).
    map: (snapshot.subtopics ?? []).map((row) => [row.id, row.status, row.coveredBy]),
    fetches: snapshot.ledger?.entries?.length ?? 0,
    captures: snapshot.captures?.entries?.length ?? 0,
  }));
}

/**
 * `{ edited, inputs, gate }` for a stamped draft, or `null` for anything without the stamp.
 * The stamp is found wherever it stands - the last one, if the brief holds several. It was
 * anchored to the end of the file until 2026-10-03: a line appended after it (a reviewer's
 * note, the `Reviewed by: agent` line AGENTS.md asks for) made the brief read as unstamped,
 * so a stale brief re-approved the build and `brief-stale` fell silent (review of the G1
 * fix). Text after the stamp counts as an edit, as text before it always did.
 */
export function draftStamp(text) {
  const body = String(text ?? '');
  let m = null;
  for (const found of body.matchAll(DRAFT_STAMP)) m = found;
  if (!m) return null;
  const after = body.slice(m.index + m[0].length);
  const rest = body.slice(0, m.index) + (after.trim() ? after : '');
  return { edited: shortHash(rest) !== m[1], inputs: m[2], gate: m[3] ?? 'unknown' };
}

export function briefSection(text, key) {
  const section = BRIEF_SECTIONS.find((s) => s.key === key);
  if (!section) return '';
  return sectionOf(text, section.heading);
}

export function judgedSection(text, key) {
  if (!JUDGED_SECTIONS.includes(key)) return null;
  const body = briefSection(text, key);
  return { key, body, answered: Boolean(body) && !body.includes(TODO_MARK) };
}

// ---------------------------------------------------------------- the renderer

function verifiedTable(corpus) {
  // One row per claim and source, naming every unknown it closes. Two unknowns that lead
  // with the same E-row have the same claim (`claimOf`), and listing it once per unknown
  // printed it twice, word for word, with nothing saying which copy closed what.
  // Every E-row an unknown cites gets its row, not only the first: a closure resting on two
  // rows showed one, and the second (MoonAliza 2026-09-29: how Ollama numbers calls) never
  // reached the builder. The first keeps `claimOf`'s fallback to the unknown's own text.
  const rows = [];
  const byKey = new Map();
  for (const unknown of corpus.unknowns) {
    if (unknown.status !== 'CLOSED') continue;
    const ids = unknown.cites.filter((id) => /^E-\d+$/i.test(id));
    for (const [n, cited] of (ids.length ? ids : ['']).entries()) {
      const row = corpus.evidence.find((e) => e.id.toUpperCase() === cited.toUpperCase());
      if (n > 0 && !row?.finding) continue;
      const claim = n === 0 ? claimOf(corpus, unknown) : row.finding;
      const key = `${cited.toUpperCase()}\u0000${claim}`;
      const seen = byKey.get(key);
      if (seen) { if (!seen.closes.includes(unknown.id)) seen.closes.push(unknown.id); continue; }
      const capture = row ? captureOf(corpus, row) : null;
      const entry = {
        claim: claim.replace(/\|/g, '\\|'),
        cited,
        host: row ? ` \`${hostOfUrl(row.url)}\`` : '',
        closes: [unknown.id],
        type: row?.type ?? '',
        partial: capture?.completeness === 'partial',
      };
      byKey.set(key, entry);
      rows.push(entry);
    }
  }
  for (const r of rows) r.source = `${r.cited}${r.host} (${r.closes.join(', ')})`;
  if (!rows.length) return '_No closed unknowns yet - nothing is verified._';
  return [
    '| Claim | Source | Type |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.claim}${r.partial ? ' _(partial capture)_' : ''} | ${r.source} | ${r.type} |`),
  ].join('\n');
}

function hostOfUrl(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

function knownUnknowns(corpus) {
  const rows = corpus.unknowns.filter((u) => u.status === 'KNOWN-UNKNOWN');
  if (!rows.length) {
    // Said "closed with primary-source evidence" whatever the Type column held, so a corpus
    // resting on one secondary source told its builder the opposite (found 2026-09-27).
    const typeOf = (id) => corpus.evidence.find((e) => e.id.toUpperCase() === id.toUpperCase())?.type ?? '';
    const secondhand = corpus.unknowns
      .filter((u) => u.status === 'CLOSED' && !u.cites.some((id) => /^E-\d+$/i.test(id) && typeOf(id) === 'P'))
      .map((u) => u.id);
    const none = 'None. No unknown is declared KNOWN-UNKNOWN.';
    if (!secondhand.length) return none;
    return `${none} ${secondhand.join(', ')} ${secondhand.length === 1 ? 'rests' : 'rest'} on no primary (P) source; the Type column above shows what carries ${secondhand.length === 1 ? 'it' : 'them'}.`;
  }
  // The cell is often written "Day one: ..." already; the label is added once. A cell may
  // also say what IS known and label its step mid-sentence (found 2026-09-29 on MoonAliza):
  // the text before the label is kept, as what is known so far, and the label is not doubled.
  const LABEL = /\bday[- ]one(?:\s+verification)?\s*[:-]\s*/i;
  const lines = (cell) => {
    const text = String(cell ?? '').trim();
    const at = text.search(LABEL);
    if (at < 0) return [`Day-one verification: ${text || '_not stated_'}`];
    // The author may have written the cell as the brief prints it: its own label is not doubled.
    const known = text.slice(0, at).trim().replace(/^known so far\s*[:-]\s*/i, '');
    const stepText = text.slice(at).replace(LABEL, '').trim();
    return [...(known ? [`Known so far: ${known}`] : []), `Day-one verification: ${stepText || '_not stated_'}`];
  };
  return rows.map((u) => `- **${u.id}** - ${u.text}\n${lines(u.evidence).map((l) => `  - ${l}`).join('\n')}`).join('\n');
}

/**
 * Render the brief from the corpus. Refuses a `draft` or `authored` brief without
 * `force`, so judgements already written are preserved.
 */
/**
 * The prediction registered before collection, quoted verbatim, or nothing.
 *
 * The drafter emits it rather than leaving it to the author, and that is the point. A
 * prior is only worth registering if it gets read back **next to the answer** - left in
 * `research/PRIOR.md` it is a file nobody opens, and the brief is the one document phase 2
 * is required to read. Emitting it also removes the quiet edit: an author who has just
 * learned they were wrong does not have to decide whether to mention it, because the text
 * is already on the page and the ledger already fixed it.
 *
 * No verdict is drawn here. Whether the corpus confirmed the prior or demolished it is the
 * reader's to see - the two cases look identical to this function, which is what keeps it
 * from becoming a scoreboard.
 */
function priorBlock(root, snapshot) {
  const prior = readPrior(root, { entries: snapshot.ledger?.entries ?? [] });
  if (!prior.present || !prior.text.trim()) return '';
  const late = prior.scrapesBefore
    ? `\n\n**Registered late**, at ledger seq ${prior.entry.seq}, after ${prior.scrapesBefore} page(s) were `
      + 'already collected. Read it as hindsight, not as a prediction.'
    : '';
  return `
## The prior, registered before anything was collected

_Ledger seq ${prior.entry.seq}, chained: neither this text nor its place before the evidence
can be changed now. Read it against the findings below - it may well be wrong, and a wrong
prior that was recorded in advance is worth more than a right one remembered afterwards._

> ${prior.text.trim().split('\n').join('\n> ')}${late}
`;
}

export function renderBrief(root, { force = false, date = today(), corpus = null, verdict = null } = {}) {
  const snapshot = corpus ?? readCorpus(root);
  const file = resolve(root, PATHS.brief);
  const existing = readText(file, '');
  const state = briefState(existing);

  // An untouched draft is the drafter's own output: nothing in it is anybody's judgement.
  const untouched = state === 'draft' && draftStamp(existing)?.edited === false;
  if (!force && !untouched && (state === 'draft' || state === 'authored')) {
    return { written: false, state, reason: `${PATHS.brief} is ${state} - re-run with --force to overwrite the judgements in it` };
  }
  if (!force && state === 'legacy') {
    return {
      written: false,
      state,
      reason: `${PATHS.brief} is a LEGACY brief: it holds the shape but not the marker, so the text cannot tell a pre-marker scaffold from a brief somebody wrote in. Read it, then re-run with --force if it is safe to replace.`,
    };
  }

  const topic = snapshot.map.topic || snapshot.plan?.topic || 'this project';
  // The drafted brief must not ANNOUNCE a completion it cannot see. It knows two things:
  // whether the gate passes, and whether the sections only a person can fill are filled.
  // Asserting "phase 1 is complete" over unanswered TODOs is the corpus claiming a
  // review that never happened.
  const gatePasses = verdict?.pass ?? null;
  const gateLine = gatePasses === null
    ? `**Gate state: not evaluated in this run.**`
    : (gatePasses
      ? `**Gate: PASS.** The configured research checks passed. Disclosed known unknowns
and gate warnings still apply; PASS does not establish that every claim is correct.`
      : `**Gate: FAIL (${verdict.counts.fail} blocking finding${verdict.counts.fail === 1 ? '' : 's'}).** This brief is a
draft of an incomplete research pass: phase 2 does not start until \`${PATHS.discovery}\`
passes. Run \`${documentCommand('preflight.mjs', '', { root })}\` to see what is unproven.`);

  const closureQualification = gatePasses === true ? ''
    : `**These are declared CLOSED claims; verification has ${gatePasses === null
      ? 'not been evaluated' : 'not succeeded'} in this run.**
Read the recorded claims and sources below as a draft for review, not successful verification.

`;

  const body = `# Brief - ${topic}

_Auto-drafted ${date} by \`bin/brief.mjs\` from the corpus. Sections marked ${TODO_MARK}
require the reviewing agent's judgement; everything else is assembled from evidence already
in \`research/\`. While a ${TODO_MARK} remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: _agent - the agent that classified the map, rewrote the findings and answered the ${TODO_MARK} sections replaces this line with \`Reviewed by: agent\`_

**This is the phase-1 to phase-2 handoff.** ${gateLine}

${renderGateWarnings(verdict)}

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.
${priorBlock(root, snapshot)}
## ${BRIEF_SECTIONS[0].heading}

${snapshot.intent || '_The contract states no build intent._'}

## ${BRIEF_SECTIONS[1].heading}

${closureQualification}${verifiedTable(snapshot)}

## ${BRIEF_SECTIONS[2].heading}

${TODO_MARK} - review the primary sources above for disagreements (pricing pages vs
billing docs, docs vs issue trackers, version-dependent behaviour). Record both
sides and state which you trust and why. State whether independent corroboration
was obtained; a single source does not establish agreement.

## ${BRIEF_SECTIONS[3].heading}

${knownUnknowns(snapshot)}

## ${BRIEF_SECTIONS[4].heading}

${TODO_MARK} - what to build first, and what is explicitly out of scope. State the
first build step concretely enough that the builder can start from this file
alone.

## ${BRIEF_SECTIONS[5].heading}

1. Review the ${TODO_MARK} sections above (${BRIEF_SECTIONS.filter((s) => s.judged).map((s) => s.heading.split(' ')[0]).join(', ')}) before handing off.
2. Hand this file to the builder (phase 2). Re-running \`${documentCommand('brief.mjs', '', { root })}\`
   redrafts this file while it is unedited; after any edit it refuses without \`--force\`,
   so your judgements are preserved.
`;

  // --force over a brief that holds anybody's judgement keeps it beside the new draft.
  // It restored the TODOs and kept nothing of the answers it replaced (found 2026-09-27).
  let backup;
  if (!untouched && ['draft', 'authored', 'legacy'].includes(state)) backup = keepBackup(root, PATHS.brief, existing, date);
  const gate = gatePasses === null ? 'unknown' : (gatePasses ? 'pass' : 'fail');
  const stamped = `${body}\n<!-- research-kit:brief-draft body=${shortHash(body)} inputs=${briefInputsHash(snapshot)} gate=${gate} -->\n`;
  writeText(file, stamped);
  return {
    written: true, state: briefState(stamped), file: PATHS.brief, reason: '',
    ...(untouched ? { replacedUnedited: true } : {}), ...(backup ? { backup } : {}),
  };
}
