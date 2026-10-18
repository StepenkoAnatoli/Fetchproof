// prior.mjs - the registered prior: what you expected BEFORE you collected.
//
// The habit this replaces was mine and it was unenforced. Three corpora in this repository
// carry a prediction written before collection, and each one is worth more than the finding
// it precedes: the EUDR prior was a year wrong on both dates, which is the only reason that
// brief can say the corpus supplied something the reviewer could not have. The Tavily prior
// held, which is the only reason that brief can say so without it reading as a boast.
//
// Unenforced, the habit has exactly one failure mode, and it is not forgetting. It is
// writing the prediction afterwards, once the answer is known, and remembering it as
// foresight. Nobody has to be dishonest for that to happen - "I thought that" is a memory,
// and memories reshape themselves around what turned out to be true.
//
// So the guarantee here is ORDERING, and it is cryptographic rather than procedural:
//
//   1. The prior text lives in `research/PRIOR.md`.
//   2. Registering it appends a `op: 'prior'` entry to the hash-chained fetch ledger,
//      carrying the file's sha256 in `bodySha256` and its path in `raw`.
//   3. Because the ledger is chained, that entry's position is not editable. Every later
//      entry's `prev` is the previous entry's `entrySha256`, so moving the prior after a
//      scrape - or inserting one at the front after the fact - rewrites every hash that
//      follows it, and `provenance/chain-intact` says so.
//   4. Because `bodySha256` names the file, EDITING the prediction after collecting breaks
//      `provenance/body-unmodified` through the machinery captures already use. A prior you
//      can revise once you know the answer is not a prior.
//
// `registerPrior` refuses after the first scrape - and beside captures or evidence rows the
// ledger does not record - for the same reason, but that refusal is only a courtesy: the ordering is what the gate verifies, and the gate does not trust this
// module to have been used.
//
// WHAT IS NOT CHECKED, deliberately (ADR-0013). Nothing here grades the prediction. Not
// whether it was specific, not whether it was reasonable, not whether it turned out right -
// a prior that was wrong is doing its job, and a check that preferred correct predictions
// would quietly teach the opposite of the habit. The one content rule is a length floor,
// and it is a floor rather than a judgement: `MIN_PRIOR` characters is roughly the room
// needed to say what you expect and what you know you do not know, and it stops `"fine"`
// from being a registered prediction. It cannot stop `"fine, and here are ninety more
// characters of nothing"`, and it is not meant to.

import fs from 'node:fs';
import { resolve, exists, readText, writeText, sha256, PATHS, HEADERS } from './core.mjs';
import { readLedger, readCaptures, parseTable, CAPTURE_MAX_BYTES } from './corpus.mjs';
import { appendFetch, withLock } from './provenance.mjs';

import { kitCommand } from './core.mjs';
/** The ledger op that marks a registered prior. */
export const PRIOR_OP = 'prior';

/** Where the prediction lives. Outside `research/raw/`, so it is never read as a capture. */
export const PRIOR_PATH = 'research/PRIOR.md';

/**
 * The floor that stops a one-word prediction from counting. Room for what you expect and
 * what you admit you cannot know - not a judgement that you used it well.
 */
export const MIN_PRIOR = 80;

/** The `op: 'prior'` entry, or null. The first one: a second is reported, never preferred. */
export function priorOf(entries = []) {
  return entries.find((entry) => entry?.op === PRIOR_OP) ?? null;
}

/**
 * What the corpus holds on disk, whatever its ledger says: the capture files under
 * `research/raw/` and the count of evidence rows. The ledger's scrapes were the only count of
 * "collected" until #353, so a corpus whose ledger was lost - the case AGENTS.md describes -
 * or emptied read as untouched beside every capture and row it held.
 */
export function collectedOnDisk(root) {
  const files = readCaptures(root, { sketches: false }).entries.map((c) => c.file);
  const rows = parseTable(readText(resolve(root, PATHS.evidence)), HEADERS.evidence).rows
    .filter((r) => /^E-\d+$/i.test(r.ID ?? '')).length;
  return { files, rows };
}

/** The same answer from a corpus already read, or null when it carries none. */
export function onDiskOf(corpus) {
  if (!Array.isArray(corpus?.captures?.entries)) return null;
  return { files: corpus.captures.entries.map((c) => c.file), rows: corpus.evidence?.length ?? 0 };
}

/**
 * Collection on disk that the ledger does not record, or null (#353) - decided only when the
 * ledger records NO scrape at all, which is the lost or emptied ledger. With a scrape on
 * record, a capture no entry names is a stray - a collector killed between writing a capture
 * and recording it, or a copy beside one - and `hygiene/uncited-capture` reports it. Failing
 * the prior over a stray blocked a correctly ordered corpus, and its remedy (restore the
 * ledger) would have discarded the entries of fetches not yet committed (review, 2026-10-18).
 */
export function unrecordedCollection(entries, onDisk) {
  if (entries.some((e) => e?.op === 'scrape')) return null;
  const ledgered = new Set(entries.map((e) => e?.raw).filter(Boolean));
  const files = (onDisk?.files ?? []).filter((file) => !ledgered.has(file));
  const rows = onDisk?.rows ?? 0;
  return files.length || rows ? { files, rows } : null;
}

/**
 * The one wording of that state, for the refusal, the gate, the read-back and the brief: what
 * is on disk, by name, and the two causes with their two different remedies.
 */
export function unrecordedDetail({ files, rows }) {
  const named = files.length
    ? ` (${files.slice(0, 5).join(', ')}${files.length > 5 ? `, and ${files.length - 5} more` : ''})`
    : '';
  return `${files.length} capture(s) and ${rows} evidence row(s) are already on disk${named}, and the ledger `
    + `records no collection. If the ledger was lost or emptied, restore it (git checkout -- ${PATHS.ledger}); `
    + 'if a fetch was interrupted before it was recorded, remove its capture';
}

/**
 * The registered prior and its standing in the chain. `scrapesBefore` is the whole point:
 * anything above zero means the prediction was registered after evidence was already in.
 * `unrecorded` is the other way to lose the order: collection on disk that a ledger recording
 * no scrape cannot place (#353). `precedes` is the one verdict every reader prints. The disk
 * is read only in that no-scrape state, and not at all when the caller passes `onDisk`.
 */
export function readPrior(root, { entries = null, onDisk = null } = {}) {
  const abs = resolve(root, PRIOR_PATH);
  const text = readText(abs, null);
  const list = entries ?? [];
  const entry = priorOf(list);
  const scrapesBefore = entry
    ? list.filter((e) => e.op === 'scrape' && (e.seq ?? 0) < (entry.seq ?? 0)).length
    : 0;
  const unrecorded = entry && !list.some((e) => e?.op === 'scrape')
    ? unrecordedCollection(list, onDisk ?? collectedOnDisk(root))
    : null;
  return {
    present: Boolean(entry),
    onDisk: text !== null,
    text: text ?? '',
    entry,
    scrapesBefore,
    unrecorded,
    precedes: Boolean(entry) && scrapesBefore === 0 && !unrecorded,
    duplicates: list.filter((e) => e?.op === PRIOR_OP).length,
  };
}

/** The refusals the text alone decides: nothing on disk is read, so no lock is needed. */
function textRefusal(text) {
  const body = String(text ?? '').trim();
  if (body.length < MIN_PRIOR) {
    return `a prior of ${body.length} character(s) is not a prediction - write at least ${MIN_PRIOR}: `
      + 'what you expect to find, and what you know you cannot know yet. Being wrong later is the point; '
      + 'being unfalsifiable is not';
  }
  // The brief quotes the prior whole, and the brief is the one page phase 2 must read (#355).
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > CAPTURE_MAX_BYTES) {
    return `a prior of ${(bytes / 1024 / 1024).toFixed(1)} MB is over the ${CAPTURE_MAX_BYTES / 1024 / 1024} MB `
      + 'a prior may be - the brief quotes it whole';
  }
  return null;
}

/**
 * The refusals the corpus's collection decides. Each only ACCUMULATES - a registered prior, a
 * scrape and a capture stay while a collection runs - so one decided on a read taken without
 * the lock is never wrong.
 */
function collectionRefusal(root, entries, onDisk = null) {
  if (priorOf(entries)) {
    return 'this corpus already has a registered prior, and a prior you can re-register is a prior you can '
      + `retry until it is right. Read the one on record: ${kitCommand('prior.mjs')}`;
  }
  const scrapes = entries.filter((e) => e.op === 'scrape').length;
  if (scrapes) {
    return `${scrapes} page(s) have already been collected here. A prediction registered after the evidence `
      + 'is not a prediction, and the ledger would show the order to anyone who looked. Record what you now '
      + 'believe in the brief instead, where it is honestly labelled';
  }
  const unrecorded = unrecordedCollection(entries, onDisk ?? collectedOnDisk(root));
  if (unrecorded) {
    return `${unrecordedDetail(unrecorded)}. A prediction registered now would be dated before evidence `
      + 'already in hand';
  }
  return null;
}

/**
 * The text of a `--file` prior, or why it was not read. Its size is checked BEFORE the read,
 * as a capture's is (`readCaptures`): until #355 a 40 MB file was read whole, registered, and
 * inlined into the one-page brief.
 */
export function readPriorSource(abs, label = abs) {
  let size = 0;
  try { size = fs.statSync(abs).size; } catch { return { text: null, refusal: `cannot read ${label}` }; }
  if (size > CAPTURE_MAX_BYTES) {
    return { text: null, refusal: `${label} is ${(size / 1024 / 1024).toFixed(1)} MB, over the `
      + `${CAPTURE_MAX_BYTES / 1024 / 1024} MB a prior may be - not read. A prediction is a paragraph, and the brief quotes it whole` };
  }
  const text = readText(abs, null);
  return text === null ? { text: null, refusal: `cannot read ${label}` } : { text, refusal: null };
}

/** Why `registerPrior` refused, or null if it would proceed. Exported so the CLI and the tests agree. */
export function priorRefusal(root, text, { entries = [], onDisk = null } = {}) {
  const refusal = textRefusal(text) ?? collectionRefusal(root, entries, onDisk);
  if (refusal) return refusal;
  // Not an accumulating state: a registration in progress holds it for a moment, between
  // writing the file and chaining it, so it is decided only under the lock.
  if (exists(resolve(root, PRIOR_PATH))) {
    return `${PRIOR_PATH} exists but no ledger entry registers it. Either the file was written by hand - in `
      + 'which case nothing dates it - or a registration was interrupted. Move it aside and register again';
  }
  return null;
}

function refused(refusal) {
  const err = new Error(refusal);
  err.code = 'PRIOR_REFUSED';
  return err;
}

/**
 * Write the prediction and chain it, in that order: the hash must cover a file that exists.
 * Throws the refusal rather than returning it, because every caller here must stop.
 *
 * The decision that lets it proceed is taken inside ONE section of the lock with the append,
 * on the ledger read there (#352). Decided on a read taken before the lock, a registration
 * that waited on a collector appended after the scrape that collector had just written, and
 * the CLI reported it as made before any page was collected. A caller's snapshot is stale for
 * the same reason, so none is accepted. A REFUSAL can be decided before the lock, and is: the
 * collection refusals only accumulate, and taking the lock first made `prior` on a collected
 * corpus wait out a running collection (up to two minutes, then LOCK_HELD) to be told what
 * the ledger already said (review, 2026-10-18).
 */
export function registerPrior(root, text, { at = null } = {}) {
  const early = textRefusal(text) ?? collectionRefusal(root, readLedger(root).entries);
  if (early) throw refused(early);
  return withLock(root, () => {
    const refusal = priorRefusal(root, text, { entries: readLedger(root).entries });
    if (refusal) throw refused(refusal);
    const body = `${String(text).trim()}\n`;
    const abs = resolve(root, PRIOR_PATH);
    writeText(abs, body);
    try {
      return appendFetch(root, {
        op: PRIOR_OP,
        raw: PRIOR_PATH,
        bodySha256: sha256(Buffer.from(body, 'utf8')),
        completeness: 'unspecified',
        ...(at ? { at } : {}),
      });
    } catch (err) {
      // The file without the entry is the state `priorRefusal` reports as un-registered, and
      // leaving it behind would block a retry on a corpus that never got a prior at all. The
      // ledger refuses for real reasons - a torn tail, a damaged chain - so this has to unwind
      // rather than leave a half-registration that reads like hand-written prose.
      try { fs.rmSync(abs, { force: true }); } catch { /* the thrown refusal is the report */ }
      throw err;
    }
  });
}
