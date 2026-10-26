#!/usr/bin/env node
// movement.mjs - the refresh baseline, and every movement against it (plan v0.4 §4.2-4.3).
//
// Why this exists. Every later change to the quote matcher or the gate in the quote-level
// refresh run (B1's floor, B2's spacing, the refresh recheck, a gone page) must either leave
// what the gate says about this repository's corpora exactly as it was, or list what moved.
// "The suite passes" cannot say that: the suite judges fixtures, and a fixture is a corpus
// somebody wrote to pass. This judges the 41 corpora that were collected for real.
// The method - re-run a frozen table of anchors after a matcher change and print each one
// whose result changed, in each direction - is Testimonium's (github.com/noahogbi/testimonium,
// MIT), re-implemented here from the plan's description; no code was copied.
//
//   node docs/measurements/2026-10-refresh-baseline/movement.mjs           compare; exit 0 none, 1 some
//   node docs/measurements/2026-10-refresh-baseline/movement.mjs --write   regenerate the baseline
//
// It imports the kit's library by a path relative to ITSELF, never by the cwd: run on a later
// branch, it measures that branch's code against the baseline committed at ab2e605, and run
// from any directory it measures the same tree. Exit 2 is a measurement that could not be
// taken (no git, an unknown flag, a baseline file that is missing or does not parse) - never
// read as "no movement".
//
// Determinism, because a baseline that differs between two runs on one tree shows movement
// nobody caused (the pre-mortem's first risk):
// - corpora come from `git ls-files`, sorted; anchors in table order; findings sorted on a
//   full key, never left in readdir or Map order (readdir order differs between NTFS and ext4);
// - nothing written holds an absolute path, a date, a clock reading or a finding's prose
//   (`detail` carries "retrieved N days ago");
// - the operator's machine config is NOT read into the verdict: evidencePolicy and maxAgeDays
//   are pinned to the kit's DEFAULTS and local core.hooksPath to none, so a strict machine and
//   a pluralist one measure the same thing;
// - files are written with LF and parsed as JSON, so a CRLF checkout cannot move them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readCorpus, captureOf, parseCapture } from '../../../fetchproof/lib/corpus.mjs';
import { supersededRows, CHECK_NAMES } from '../../../fetchproof/lib/checks.mjs';
import { runPreflight, verdictContext } from '../../../fetchproof/lib/preflight.mjs';
import { quoteAnchors, quoteTooShort, anchorFound, unreadableQuoteMarkers } from '../../../fetchproof/lib/quotes.mjs';
import { resolve, readText, exists } from '../../../fetchproof/lib/core.mjs';
import { DEFAULTS } from '../../../fetchproof/lib/machine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const FILES = Object.freeze({
  summary: 'summary.json', verdicts: 'verdicts.json', anchors: 'anchors.json', superseded: 'superseded.json',
});

/**
 * Not a corpus: the scaffold `new-project.mjs` copies, with an empty evidence table and a
 * contract still to be written. Its verdict is the template's, not any research's.
 */
const NOT_CORPORA = Object.freeze(['fetchproof/template']);

/**
 * Findings recorded but left out of the comparison, and why. `stale-evidence` names its age in
 * days and appears when a row passes the age limit, so it moves with the calendar; `future-date`
 * disappears when the calendar reaches the date. A check's summary pass is emitted only when the
 * check found nothing else, so the two checks those rules belong to have date-dependent passes
 * too. `gate-integrity` reads the machine (research/overrides.log is local and never committed,
 * core.hooksPath is per-clone), not the corpus.
 */
const EXCLUDED = Object.freeze({
  'unknown-closure/stale-evidence': 'date',
  'unknown-closure/closure': 'date',
  'hygiene/future-date': 'date',
  'hygiene/hygiene': 'date',
  'gate-integrity/*': 'machine',
});

function excludedWhy(f) {
  return EXCLUDED[`${f.check}/${f.rule}`] ?? EXCLUDED[`${f.check}/*`] ?? null;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Every corpus in the index, as a repo-relative POSIX path ('.' for the root). */
function corpusRoots() {
  const files = git(['ls-files', '-z', '--', '*research/EVIDENCE.md']).split('\0').filter(Boolean);
  return files
    .map((f) => path.posix.dirname(path.posix.dirname(f)))
    .filter((dir) => !NOT_CORPORA.includes(dir))
    .sort(byText);
}

/** The gate's view of an anchor: what `citations` (checks.mjs) would say about it. */
function statusOf({ capture, onDisk, tooShort, found }) {
  if (!capture) return 'no-capture';
  if (!onDisk) return 'capture-not-on-disk';
  if (tooShort) return 'quote-too-short';
  return found ? 'found' : 'not-found';
}

function bodyOf(root, capture) {
  if (!capture || !exists(resolve(root, capture.file))) return null;
  return parseCapture(readText(resolve(root, capture.file)) ?? '').body;
}

/**
 * Rows keyed by ID, with a duplicated ID numbered by its place in the table (`E-04#2`): a key
 * that collided would compare one row's anchors with another's.
 */
function rowKeys(rows) {
  const seen = new Map();
  return rows.map((row) => {
    const id = row.id.toUpperCase();
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n === 1 ? row.id : `${row.id}#${n}`;
  });
}

const FINDING_KEYS = ['check', 'rule', 'severity', 'row', 'file', 'superseded', 'by'];

function measureOne(rel) {
  const root = rel === '.' ? REPO : resolve(REPO, rel);
  const corpus = readCorpus(root);

  // The in-process verdict, through the same runPreflight the three gates call, with the
  // machine pinned (header). verdictContext is still called so that anything a later branch
  // adds to the context is carried; only the machine's three answers are replaced.
  const context = {
    ...verdictContext(root, { corpus }),
    evidencePolicy: DEFAULTS.evidencePolicy,
    maxAgeDays: DEFAULTS.maxAgeDays,
  };
  context.gate = { ...context.gate, localHooksPath: null };
  const verdict = runPreflight(root, { context });
  const order = (f) => CHECK_NAMES.indexOf(f.check);
  const findings = verdict.findings
    .map((f) => {
      const out = {};
      for (const k of FINDING_KEYS) if (f[k] !== undefined && f[k] !== null && f[k] !== '') out[k] = f[k];
      const why = excludedWhy(f);
      if (why) out.excluded = why;
      return out;
    })
    .sort((a, b) => order(a) - order(b) || FINDING_KEYS.reduce((c, k) => c || byText(String(a[k] ?? ''), String(b[k] ?? '')), 0));

  const keys = rowKeys(corpus.evidence);
  const anchors = [];
  let quotedRows = 0;
  let unreadable = 0;
  corpus.evidence.forEach((row, i) => {
    const list = quoteAnchors(row.finding);
    unreadable += unreadableQuoteMarkers(row.finding).length;
    if (list.length) quotedRows += 1;
    if (!list.length) return;
    const capture = captureOf(corpus, row);
    const body = bodyOf(root, capture);
    list.forEach((anchor, n) => {
      const tooShort = quoteTooShort(anchor);
      // Computed for a too-short quote too, which the gate does not compare: when a floor
      // moves, what the quote would THEN be is the half of the movement worth knowing.
      const found = body === null ? null : anchorFound(anchor.fragments, body);
      anchors.push({
        corpus: rel, row: keys[i], anchor: n, quote: anchor.quote, capture: capture?.file ?? null,
        tooShort, found, status: statusOf({ capture, onDisk: body !== null, tooShort, found }),
      });
    });
  });

  // Each refresh: the replaced row's anchors, looked for in the replacing row's capture - the
  // question a quote-level recheck asks. `citedBy` is who `cites-superseded-row` fails today.
  const superseded = [];
  const byId = new Map(corpus.evidence.map((row, i) => [row.id.toUpperCase(), { row, key: keys[i] }]));
  for (const [oldId, newRow] of supersededRows(corpus)) {
    const old = byId.get(oldId);
    const capture = captureOf(corpus, newRow);
    const body = bodyOf(root, capture);
    superseded.push({
      corpus: rel, old: old.key, new: newRow.id,
      oldCapture: captureOf(corpus, old.row)?.file ?? null, newCapture: capture?.file ?? null,
      citedBy: corpus.unknowns.filter((u) => u.cites.some((c) => c.toUpperCase() === oldId)).map((u) => u.id).sort(byText),
      anchors: quoteAnchors(old.row.finding).map((anchor, n) => ({
        anchor: n, quote: anchor.quote, tooShort: quoteTooShort(anchor),
        foundInNew: body === null ? null : anchorFound(anchor.fragments, body),
      })),
    });
  }
  superseded.sort((a, b) => byText(a.old, b.old));

  const comparable = findings.filter((f) => !f.excluded);
  return {
    verdict: {
      corpus: rel,
      rows: corpus.evidence.length,
      quotedRows,
      anchors: anchors.length,
      unreadableMarkers: unreadable,
      pass: verdict.pass,
      comparablePass: !comparable.some((f) => f.severity === 'fail'),
      findings,
    },
    anchors,
    superseded,
  };
}

export function measureAll() {
  const verdicts = [];
  const anchors = [];
  const superseded = [];
  for (const rel of corpusRoots()) {
    const m = measureOne(rel);
    verdicts.push(m.verdict);
    anchors.push(...m.anchors);
    superseded.push(...m.superseded);
  }
  const statuses = {};
  for (const a of anchors) statuses[a.status] = (statuses[a.status] ?? 0) + 1;
  const summary = {
    corpora: verdicts.length,
    rows: verdicts.reduce((n, v) => n + v.rows, 0),
    quotedRows: verdicts.reduce((n, v) => n + v.quotedRows, 0),
    anchors: anchors.length,
    unreadableMarkers: verdicts.reduce((n, v) => n + v.unreadableMarkers, 0),
    anchorStatus: Object.fromEntries(Object.entries(statuses).sort(([a], [b]) => byText(a, b))),
    tooShort: anchors.filter((a) => a.tooShort).length,
    corporaPassing: verdicts.filter((v) => v.pass).length,
    corporaPassingComparable: verdicts.filter((v) => v.comparablePass).length,
    supersededPairs: superseded.length,
    supersededPairsQuoted: superseded.filter((p) => p.anchors.length).length,
    supersededPairsCited: superseded.filter((p) => p.citedBy.length).length,
    excluded: EXCLUDED,
  };
  return { summary, verdicts, anchors, superseded };
}

// ---------------------------------------------------------------- files

/** JSON with one record a line, so a regenerated baseline diffs by record in review. */
function jsonLines(list) {
  return list.length ? `[\n${list.map((x) => JSON.stringify(x)).join(',\n')}\n]\n` : '[]\n';
}

function writeBaseline(m) {
  const head = git(['rev-parse', '--short', 'HEAD']).trim();
  // Dirty is measured over what the measurement reads, the library and the corpora, never this
  // folder: a baseline regenerated before it is committed is not dirty for being new.
  const dirty = git(['status', '--porcelain', '--', 'fetchproof', 'research', 'docs/decisions']).trim() !== '';
  const out = {
    [FILES.summary]: `${JSON.stringify({ measuredAt: head, treeClean: !dirty, ...m.summary }, null, 2)}\n`,
    [FILES.verdicts]: jsonLines(m.verdicts),
    [FILES.anchors]: jsonLines(m.anchors),
    [FILES.superseded]: jsonLines(m.superseded),
  };
  for (const [name, text] of Object.entries(out)) fs.writeFileSync(path.join(HERE, name), text);
  return { head, dirty };
}

function readBaseline() {
  const read = (name) => {
    const file = path.join(HERE, name);
    if (!fs.existsSync(file)) throw new Error(`${name} is missing beside ${path.basename(fileURLToPath(import.meta.url))} - regenerate with --write on the commit the baseline belongs to`);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { throw new Error(`${name} does not parse as JSON: ${err.message}`); }
  };
  return {
    summary: read(FILES.summary), verdicts: read(FILES.verdicts),
    anchors: read(FILES.anchors), superseded: read(FILES.superseded),
  };
}

// ---------------------------------------------------------------- movement

const show = (v) => (v === null || v === undefined ? 'none' : String(v));
const clip = (s) => (s.length > 70 ? `${s.slice(0, 67)}...` : s);
const findingKey = (f) => FINDING_KEYS.map((k) => (f[k] === undefined ? '' : String(f[k]))).join('\t');
const findingText = (f) => `${f.severity} ${f.check}/${f.rule}${f.row ? ` ${f.row}` : ''}${f.file ? ` ${f.file}` : ''}${f.superseded ? ` (superseded ${f.superseded} by ${f.by})` : ''}`;

function counts(list) {
  const m = new Map();
  for (const f of list) m.set(findingKey(f), { f, n: (m.get(findingKey(f))?.n ?? 0) + 1 });
  return m;
}

export function movement(base, now) {
  const lines = [];

  const baseV = new Map(base.verdicts.map((v) => [v.corpus, v]));
  const nowV = new Map(now.verdicts.map((v) => [v.corpus, v]));
  for (const corpus of [...new Set([...baseV.keys(), ...nowV.keys()])].sort(byText)) {
    const b = baseV.get(corpus);
    const n = nowV.get(corpus);
    if (!b) { lines.push(`corpus ${corpus}: added (not in the baseline)`); continue; }
    if (!n) { lines.push(`corpus ${corpus}: removed (in the baseline, not in the index)`); continue; }
    if (b.comparablePass !== n.comparablePass) {
      lines.push(`corpus ${corpus}: verdict ${b.comparablePass ? 'PASS' : 'FAIL'} -> ${n.comparablePass ? 'PASS' : 'FAIL'}`);
    }
    for (const field of ['rows', 'quotedRows', 'anchors', 'unreadableMarkers']) {
      if (b[field] !== n[field]) lines.push(`corpus ${corpus}: ${field} ${b[field]} -> ${n[field]}`);
    }
    const bc = counts(b.findings.filter((f) => !f.excluded));
    const nc = counts(n.findings.filter((f) => !f.excluded));
    for (const key of [...new Set([...bc.keys(), ...nc.keys()])].sort(byText)) {
      const was = bc.get(key)?.n ?? 0;
      const is = nc.get(key)?.n ?? 0;
      if (was === is) continue;
      const f = (bc.get(key) ?? nc.get(key)).f;
      lines.push(`corpus ${corpus}: finding ${is > was ? '+' : '-'} ${findingText(f)}${Math.abs(is - was) > 1 || (was && is) ? ` (${was} -> ${is})` : ''}`);
    }
  }

  const anchorKey = (a) => `${a.corpus}\t${a.row}\t${a.anchor}`;
  const baseA = new Map(base.anchors.map((a) => [anchorKey(a), a]));
  const nowA = new Map(now.anchors.map((a) => [anchorKey(a), a]));
  for (const key of [...new Set([...baseA.keys(), ...nowA.keys()])].sort(byText)) {
    const b = baseA.get(key);
    const n = nowA.get(key);
    const a = b ?? n;
    const where = `anchor ${a.corpus} ${a.row} [${a.anchor}]`;
    if (!b) { lines.push(`${where}: added, ${n.status} "${clip(n.quote)}"`); continue; }
    if (!n) { lines.push(`${where}: removed, was ${b.status} "${clip(b.quote)}"`); continue; }
    const moved = ['status', 'tooShort', 'found', 'quote', 'capture']
      .filter((k) => b[k] !== n[k])
      .map((k) => (k === 'quote' ? `quote "${clip(b.quote)}" -> "${clip(n.quote)}"` : `${k} ${show(b[k])} -> ${show(n[k])}`));
    if (moved.length) lines.push(`${where}: ${moved.join('; ')}  "${clip(n.quote)}"`);
  }

  const pairKey = (p) => `${p.corpus}\t${p.old}`;
  const baseP = new Map(base.superseded.map((p) => [pairKey(p), p]));
  const nowP = new Map(now.superseded.map((p) => [pairKey(p), p]));
  for (const key of [...new Set([...baseP.keys(), ...nowP.keys()])].sort(byText)) {
    const b = baseP.get(key);
    const n = nowP.get(key);
    const p = b ?? n;
    const where = `refresh ${p.corpus} ${p.old}`;
    if (!b) { lines.push(`${where}: added, superseded by ${n.new}`); continue; }
    if (!n) { lines.push(`${where}: removed, was superseded by ${b.new}`); continue; }
    if (b.new !== n.new) lines.push(`${where}: superseded by ${b.new} -> ${n.new}`);
    if (b.citedBy.join(',') !== n.citedBy.join(',')) lines.push(`${where}: cited by ${b.citedBy.join(',') || 'none'} -> ${n.citedBy.join(',') || 'none'}`);
    const len = Math.max(b.anchors.length, n.anchors.length);
    for (let i = 0; i < len; i += 1) {
      const x = b.anchors[i];
      const y = n.anchors[i];
      if (!x) { lines.push(`${where} [${i}]: anchor added, foundInNew ${show(y.foundInNew)} "${clip(y.quote)}"`); continue; }
      if (!y) { lines.push(`${where} [${i}]: anchor removed "${clip(x.quote)}"`); continue; }
      const moved = ['tooShort', 'foundInNew'].filter((k) => x[k] !== y[k]).map((k) => `${k} ${show(x[k])} -> ${show(y[k])}`);
      if (moved.length) lines.push(`${where} [${i}]: ${moved.join('; ')}  "${clip(y.quote)}"`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------- main

function main(argv) {
  const known = new Set(['--write', '--help']);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length) {
    process.stderr.write(`movement: unknown argument ${unknown.join(' ')} - use --write to regenerate, or nothing to compare\n`);
    return 2;
  }
  if (argv.includes('--help')) {
    process.stdout.write('movement - the refresh baseline (docs/measurements/2026-10-refresh-baseline/README.md)\n\n'
      + '  node movement.mjs           compare the current tree with the baseline; exit 0 no movement, 1 movement\n'
      + '  node movement.mjs --write   regenerate the baseline files from the current tree\n');
    return 0;
  }
  // The baseline is read first, so a missing one is said before a minute of measuring.
  const base = argv.includes('--write') ? null : readBaseline();
  const now = measureAll();
  if (!base) {
    const { head, dirty } = writeBaseline(now);
    const s = now.summary;
    process.stdout.write(`baseline written at ${head}${dirty ? ' (library or corpora have uncommitted changes)' : ''}: `
      + `${s.corpora} corpora, ${s.rows} rows, ${s.quotedRows} quoted rows, ${s.anchors} anchors, `
      + `${s.supersededPairs} superseded pairs (${s.supersededPairsQuoted} quoted)\n`);
    return 0;
  }
  const lines = movement(base, now);
  process.stdout.write(`baseline measured at ${base.summary.measuredAt}; this tree at ${git(['rev-parse', '--short', 'HEAD']).trim()}\n`);
  if (!lines.length) {
    process.stdout.write(`no movement: ${now.summary.corpora} corpora, ${now.summary.anchors} anchors, ${now.summary.supersededPairs} superseded pairs as in the baseline\n`);
    return 0;
  }
  process.stdout.write(`${lines.join('\n')}\n${lines.length} movement${lines.length === 1 ? '' : 's'}\n`);
  return 1;
}

// Realpaths on both sides (found 2026-10-25, Phase 4b breaker F1): run through a junction or a
// symlink, argv[1] keeps the link's path while import.meta.url is the target's, so a plain
// path.resolve comparison missed, main() never ran, and the script exited 0 with no output.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`movement: ${err.message}\n`);
    process.exitCode = 2;
  }
}
