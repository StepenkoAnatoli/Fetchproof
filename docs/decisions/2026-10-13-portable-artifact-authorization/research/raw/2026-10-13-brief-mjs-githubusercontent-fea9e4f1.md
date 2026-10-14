---
url: https://raw.githubusercontent.com/StepenkoAnatoli/Research-Kit/3bac1f26ddbf8cb6a794626e53dc2af313860940/research-kit/lib/brief.mjs
retrieved: 2026-10-13
command: http-keyless scrape https://raw.githubusercontent.com/StepenkoAnatoli/Research-Kit/3bac1f26ddbf8cb6a794626e53dc2af313860940/research-kit/lib/brief.mjs
statusCode: 200
transport: http-keyless
completeness: full
---
// brief.mjs - the phase-1 -> phase-2 handoff, and the owner of the brief's SHAPE (ADR-0014).
//
// Six sections, two of which the corpus cannot fill. The renderer writes its headings
// FROM this definition and lib/audit.mjs reads the judged sections through it, so the
// writer and its readers cannot drift.

import { PATHS, resolve, readText, writeText, today, documentCommand, exists, sha256 } from './core.mjs';
import { readCorpus, sectionOf, claimOf, captureOf } from './corpus.mjs';
import { readPrior } from './prior.mjs';

/** `judged: true` marks a section the corpus cannot fill - it needs a person's call. */
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
const DRAFT_STAMP = /\n?<!-- research-kit:brief-draft body=([0-9a-f]{16}) inputs=([0-9a-f]{16}) -->\s*$/;

const shortHash = (text) => sha256(String(text).replace(/\r\n/g, '\n')).slice(0, 16);

/** What the brief is drafted FROM, parsed, so a reformatted table is not a change. */
export function briefInputsHash(snapshot) {
  return shortHash(JSON.stringify({
    topic: snapshot.map?.topic || snapshot.plan?.topic || '',
    intent: snapshot.intent ?? '',
    unknowns: (snapshot.unknowns ?? []).map((u) => [u.id, u.text, u.status, u.evidence]),
    evidence: (snapshot.evidence ?? []).map((e) => [e.id, e.retrieved, e.type, e.url, e.finding, e.raw]),
  }));
}

/** `{ edited, inputs }` for a stamped draft, or `null` for anything without the stamp. */
export function draftStamp(text) {
  const body = String(text ?? '');
  const m = DRAFT_STAMP.exec(body);
  if (!m) return null;
  return { edited: shortHash(body.slice(0, m.index)) !== m[1], inputs: m[2] };
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
  const rows = [];
  const byKey = new Map();
  for (const unknown of corpus.unknowns) {
    if (unknown.status !== 'CLOSED') continue;
    const claim = claimOf(corpus, unknown);
    const cited = unknown.cites.find((id) => /^E-\d+$/i.test(id)) ?? '';
    const key = `${cited.toUpperCase()}\u0000${claim}`;
    if (byKey.has(key)) { byKey.get(key).closes.push(unknown.id); continue; }
    const row = corpus.evidence.find((e) => e.id.toUpperCase() === cited.toUpperCase());
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
    const none = 'None. Every blocking unknown was closed with cited evidence.';
    if (!secondhand.length) return none;
    return `${none} ${secondhand.join(', ')} ${secondhand.length === 1 ? 'rests' : 'rest'} on no primary (P) source; the Type column above shows what carries ${secondhand.length === 1 ? 'it' : 'them'}.`;
  }
  return rows.map((u) => `- **${u.id}** - ${u.text}\n  - Day-one verification: ${u.evidence || '_not stated_'}`).join('\n');
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
      ? `**Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in \`${PATHS.raw}/\`.`
      : `**Gate: FAIL (${verdict.counts.fail} blocking finding${verdict.counts.fail === 1 ? '' : 's'}).** This brief is a
draft of an incomplete research pass: phase 2 does not start until \`${PATHS.discovery}\`
passes. Run \`${documentCommand('preflight.mjs')}\` to see what is unproven.`);

  const body = `# Brief - ${topic}

_Auto-drafted ${date} by \`bin/brief.mjs\` from the corpus. Sections marked ${TODO_MARK}
require human/agent judgement; everything else is assembled from evidence already
in \`research/\`. While a ${TODO_MARK} remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

**This is the phase-1 to phase-2 handoff.** ${gateLine}

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.
${priorBlock(root, snapshot)}
## ${BRIEF_SECTIONS[0].heading}

${snapshot.intent || '_The contract states no build intent._'}

## ${BRIEF_SECTIONS[1].heading}

${verifiedTable(snapshot)}

## ${BRIEF_SECTIONS[2].heading}

${TODO_MARK} - review the primary sources above for disagreements (pricing pages vs
billing docs, docs vs issue trackers, version-dependent behaviour). Record both
sides and state which you trust and why. Two independent sources agree unless
noted here.

## ${BRIEF_SECTIONS[3].heading}

${knownUnknowns(snapshot)}

## ${BRIEF_SECTIONS[4].heading}

${TODO_MARK} - what to build first, and what is explicitly out of scope. State the
first build step concretely enough that the builder can start from this file
alone.

## ${BRIEF_SECTIONS[5].heading}

1. Review the ${TODO_MARK} sections above (${BRIEF_SECTIONS.filter((s) => s.judged).map((s) => s.heading.split(' ')[0]).join(', ')}) before handing off.
2. Hand this file to the builder (phase 2). Re-running \`${documentCommand('brief.mjs')}\`
   redrafts this file while it is unedited; after any edit it refuses without \`--force\`,
   so your judgements are preserved.
`;

  // --force over a brief that holds anybody's judgement keeps it beside the new draft.
  // It restored the TODOs and kept nothing of the answers it replaced (found 2026-09-27).
  let backup;
  if (!untouched && ['draft', 'authored', 'legacy'].includes(state)) {
    backup = `${PATHS.brief}.bak-${date}`;
    for (let n = 2; exists(resolve(root, backup)); n += 1) backup = `${PATHS.brief}.bak-${date}-${n}`;
    writeText(resolve(root, backup), existing);
  }
  const stamped = `${body}\n<!-- research-kit:brief-draft body=${shortHash(body)} inputs=${briefInputsHash(snapshot)} -->\n`;
  writeText(file, stamped);
  return {
    written: true, state: briefState(stamped), file: PATHS.brief, reason: '',
    ...(untouched ? { replacedUnedited: true } : {}), ...(backup ? { backup } : {}),
  };
}

