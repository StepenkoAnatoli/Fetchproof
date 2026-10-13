// corpus.mjs - the research corpus has one owner (ADR-0003).
//
// One reader (readCorpus / readCaptures / parseTable / parseCapture / readOverrides),
// one writer family (appendRow / upsertRow / appendJsonLine), the cache decision over
// the capture index, and the format's joins (traceOf / captureOf / claimOf, ADR-0015).
//
// Malformation is reported, never absorbed: a row whose arity does not match its header
// becomes a corpus problem, and the corpus never decides whether a problem blocks.

import fs from 'node:fs';
import path from 'node:path';
import {
  PATHS, HEADERS, resolve, relative, exists, isDirectory, readText, readJson,
  writeText, appendLine, listFiles, sha256File, ageInDays, hostOf, parseJson, urlKey, projectFile,
} from './core.mjs';
import { sketch } from './similarity.mjs';
import { parseJsonNoDuplicates } from './release/json.mjs';

// ---------------------------------------------------------------- table machinery

/** Split one markdown table row into cells, honouring `\|` escapes. */
export function splitRow(line) {
  const body = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

export function escapeCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

export function tableRow(cells) {
  return `| ${cells.map(escapeCell).join(' | ')} |`;
}

function isSeparator(line) {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim()) && line.includes('-');
}

/**
 * A row with too few cells is padded and a row with too many is folded into its last
 * cell - both are reported. Repairing silently would hide the defect; refusing outright
 * would lose the rest of a corpus over one bad line.
 */
export function repairRowArity(cells, width, free = width - 1) {
  if (cells.length === width) return { cells, repaired: false };
  if (cells.length < width) {
    return { cells: [...cells, ...Array(width - cells.length).fill('')], repaired: true };
  }
  // The extra cells fold into the table's free-text column. They were always folded into the
  // last, and in EVIDENCE the last is Raw: a Finding quoting `a || b` turned the capture path
  // into half a sentence, and preflight reported the page missing (found 2026-09-27).
  const extra = cells.length - width;
  return {
    cells: [...cells.slice(0, free), cells.slice(free, free + extra + 1).join(' | '), ...cells.slice(free + extra + 1)],
    repaired: true,
  };
}

/**
 * The column a split row's extra cells belong to: each table's prose column, where a stray |
 * lands. Folding there keeps the structured columns to its right - Raw, Status, Evidence,
 * Retrieved - where they are. When a table has two prose columns the fold may shift text
 * between them, which costs nothing a gate reads.
 */
const FREE_TEXT_COLUMNS = ['finding', 'unknown', 'why it matters', 'title'];

/**
 * Parse the first markdown table whose header starts with `header[0]`.
 * Returns `{ header, rows, problems }`; every row carries its 1-based `line`.
 */
export function parseTable(text, header) {
  const out = { header: [...header], rows: [], problems: [], found: false };
  if (!text) return out;
  const lines = String(text).split(/\r?\n/);
  const want = new Set(header.map((name) => name.trim().toLowerCase()));
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    if (!isSeparator(lines[i + 1] ?? '')) continue;
    const cells = splitRow(lines[i]);
    // A header is recognised by its COLUMN SET, not by its first cell alone. Matching on
    // the first cell missed any table whose columns had been reordered - the reader then
    // silently found no table at all, and the writer, asking the same question, inserted
    // its row above the document's title.
    const names = cells.map((name) => name.trim().toLowerCase());
    const sameLead = names[0] === header[0].trim().toLowerCase();
    const sameSet = names.length === want.size && names.every((name) => want.has(name)) && new Set(names).size === names.length;
    if (!sameLead && !sameSet) continue;
    start = i;
    out.header = cells;
    out.found = true;
    break;
  }
  if (start < 0) return out;

  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) break;
    if (isSeparator(line)) continue;
    const raw = splitRow(line);
    const freeAt = out.header.findIndex((name) => FREE_TEXT_COLUMNS.includes(name.trim().toLowerCase()));
    const free = freeAt >= 0 ? freeAt : out.header.length - 1;
    const { cells, repaired } = repairRowArity(raw, out.header.length, free);
    if (repaired) {
      out.problems.push({
        kind: 'table-arity',
        line: i + 1,
        detail: raw.length > out.header.length
          ? `row has ${raw.length} cells, header has ${out.header.length} - a | inside a cell splits it; write it as \\| (the extra cells were read as part of ${out.header[free]})`
          : `row has ${raw.length} cells, header has ${out.header.length}`,
        text: line.trim(),
      });
    }
    const row = { line: i + 1, cells };
    out.header.forEach((name, idx) => { row[name] = cells[idx] ?? ''; });
    out.rows.push(row);
  }
  // The table ends at the first line that is not a row - a blank line, as GFM renders it. A
  // row-shaped line AFTER that end, in the same section, is a row somebody wrote into the table
  // that no reader of the table will see: GitHub shows it as prose, and until 2026-10-03 this
  // parser dropped it in silence - a blocking unknown written below a blank line left the gate,
  // which printed PASS (gap audit, rank 1). The row stays out of the table, as it is rendered,
  // and is RECORDED. The scan runs to the end of the table's section: a heading of the same or
  // a higher level than the one above the table (a deeper `###` note does not end the section,
  // and `#tag` prose is not a heading). A fenced code block or an HTML comment is skipped, as
  // GitHub renders a row there as code or hides it; a lone separator is not a row; a header
  // followed by its separator starts another table and is not a stray row, and a header whose
  // separator is malformed is named as that, once (breaker review, 2026-10-04).
  let level = 7;
  for (let k = start - 1; k >= 0; k -= 1) {
    const heading = /^(#{1,6})\s/.exec(lines[k]);
    if (heading) { level = heading[1].length; break; }
  }
  let fence = null;
  let comment = false;
  let i = out.rows.length ? out.rows[out.rows.length - 1].line : start + 2;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const text = line.trim();
    if (fence) { if (text.startsWith(fence)) fence = null; continue; }
    const opens = /^(`{3,}|~{3,})/.exec(text);
    if (opens) { fence = opens[1][0] === '`' ? '```' : '~~~'; continue; }
    if (comment) { if (text.includes('-->')) comment = false; continue; }
    if (text.startsWith('<!--')) { if (!text.includes('-->')) comment = true; continue; }
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading && heading[1].length <= level) break;
    if (!text.startsWith('|') || isSeparator(line)) continue;
    const next = lines[i + 1] ?? '';
    if (isSeparator(next)) break;                                   // another table's header
    const separatorLike = /^\|?[\s:|=_~.-]+\|?$/.test(next.trim()) && next.trim().length > 1;
    out.problems.push({
      kind: 'table-split',
      line: i + 1,
      detail: separatorLike
        ? `row \`${splitRow(line)[0] || text.slice(0, 40)}\` starts a table whose separator row \`${next.trim()}\` is malformed (a separator is written |---|---|), so the table is not recognised - fix the separator`
        : `row \`${splitRow(line)[0] || text.slice(0, 40)}\` stands after a blank line ended the table above it, so no check reads it - `
          + 'remove the blank line (or the row), because the table ends where the blank line is',
      text,
    });
    if (separatorLike) {                                            // one finding for that table
      i += 1;
      while ((lines[i + 1] ?? '').trim().startsWith('|')) i += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- captures

/** Parse a raw capture: `---` front-matter followed by the page body. */
export function parseCapture(text) {
  const front = {};
  let body = String(text ?? '');
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const at = line.indexOf(':');
      if (at < 0) continue;
      front[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    body = body.slice(match[0].length);
  }
  return { front, body };
}

/**
 * The one constructor for a capture-index entry. The reader builds through it and so
 * does the collector when it has just written a page, so an entry held in memory and
 * an entry read back from disk are the same shape, field for field.
 */
export function captureEntry({ file, url, retrieved, command, statusCode, transport, completeness, omitted, bytes }) {
  return {
    file: file ?? '',
    url: url ?? '',
    retrieved: retrieved ?? '',
    command: command ?? '',
    statusCode: statusCode ?? '',
    transport: transport ?? '',
    completeness: completeness || 'unspecified',
    omitted: omitted ?? '',
    bytes: bytes ?? 0,
  };
}

/**
 * Notices a page prints when its own content failed to load.
 *
 * Deliberately a list of things pages SAY, not a guess about what they contain. Each of
 * these is a sentence a site renders in place of content it could not build - so a match
 * is the page reporting its own failure, which is a fact, rather than this module judging
 * whether the text looks substantial, which would be ADR-0013's forbidden territory.
 */
export const RENDER_FAILURE_MARKERS = Object.freeze([
  /there was an error while loading/gi,
  /please (?:reload|refresh) this page/gi,
  /(?:you need to )?enable javascript to (?:run|use|view)/gi,
  /javascript is (?:required|disabled)/gi,
  /this (?:page|content) requires javascript/gi,
]);

/** How many render-failure notices a page printed. 0 means none, never "it is fine". */
export function countRenderFailures(body) {
  let n = 0;
  for (const marker of RENDER_FAILURE_MARKERS) {
    n += (String(body ?? '').match(new RegExp(marker.source, 'gi')) ?? []).length;
  }
  return n;
}

/**
 * The URL a capture was asked for, read out of its command line: `http-keyless scrape <url>`,
 * `firecrawl scrape <url> ...`, `browser <url>` - the first argument that is an http(s) URL.
 * '' when the command names none. A fetch that redirected records where the bytes came from
 * as its `url`; this is the other half of that pair, the one the plan keeps naming.
 */
export function requestedUrl(command) {
  for (const token of String(command ?? '').split(/\s+/)) {
    const bare = token.replace(/^"(.*)"$/, '$1');
    if (!/^https?:\/\//i.test(bare)) continue;
    try { new URL(bare); return bare; } catch { /* not a URL after all */ }
  }
  return '';
}

/**
 * The capture index: every file under `research/raw/`, plus `byUrl` where the newest
 * retrieval wins. Dotfiles are the kit's own logs and are not captures.
 */
/**
 * The largest capture the corpus will read. The biggest real one in this repository is
 * 465 KB; a 100 MB file crashed every reader in the similarity sketch, and a 600 MB one
 * could not be read as a string and was skipped in silence (found 2026-09-28).
 */
export const CAPTURE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * A duplicate object key in a hand-edited JSON file, or '' (2026-09-28). JSON.parse keeps
 * the LAST of two equal keys, so a merge or a paste loses the first value in silence. Only
 * a DUPLICATE is reported here: the strict reader may differ from JSON.parse in other ways,
 * and parse errors are already JSON.parse's to name.
 *
 * Exported 2026-09-30 (break-test): the gate named the duplicate in plan.json while the
 * command that SPENDS - research.mjs - read the same file through JSON.parse and collected
 * the second value in silence. The finding was caught only after the credits were gone,
 * because preflight runs after collection. One reader, so the spend and the verdict agree.
 */
export function duplicateKey(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  try {
    parseJsonNoDuplicates(source);
    return '';
  } catch (err) {
    return /duplicate object key/.test(err.message)
      ? `${err.message} - JSON keeps only the last value, so the first is silently lost`
      : '';
  }
}

export function readCaptures(root, { known = null, sketches: wantSketches = true, rank = null } = {}) {
  const dir = resolve(root, PATHS.raw);
  const entries = [];
  const problems = [];
  const sketches = new Map();
  const renderFailures = new Map();
  for (const name of listFiles(dir).sort()) {
    if (name.startsWith('.')) continue;
    // A capture's source sibling (ADR-0140) is the text it was converted from: the ledger
    // names and verifies it, and nothing cites, grades or exports it.
    if (name.endsWith('.source.html')) continue;
    const abs = path.join(dir, name);
    const rel = `${PATHS.raw}/${name}`;
    // A caller that already holds a capture does not read it again: a capture is never
    // rewritten (writeRaw), so what it holds is still true. The collector refreshes its
    // snapshot inside the lock before every fetch, and until 2026-10-02 that re-read, parsed
    // and sketched every capture on disk each time - 41% of a 2000-page run was sketching
    // pages the run had indexed already (break-test pass 3, F6). Sketches serve one gate
    // check (`corroboration`), so the collector leaves them to the gate.
    if (known?.has(rel)) continue;
    // A link that lands outside the project is not read (ADR-0076): git stores symlinks,
    // and research/raw/x.md -> ~/.ssh/id_rsa would otherwise be read as a capture.
    const named = projectFile(root, rel);
    const raw = projectFile(dir, name);
    if (named.problem === 'outside' || raw.problem === 'outside') {
      problems.push({ kind: 'capture-outside', file: rel, detail: `${rel} is a link outside the project or its capture folder - not read` });
      continue;
    }
    if (isDirectory(abs)) continue;
    if (named.problem || raw.problem) {
      problems.push({ kind: 'capture-unreadable', file: rel, detail: `${rel} is missing or not a regular file - not read` });
      continue;
    }
    // Checked BEFORE reading: every file here is either read or named, never dropped.
    let size = 0;
    try { size = fs.statSync(abs).size; } catch { /* unreadable - named below */ }
    if (size > CAPTURE_MAX_BYTES) {
      problems.push({ kind: 'capture-too-large', file: rel,
        detail: `${rel} is ${(size / 1024 / 1024).toFixed(0)} MB, over the ${CAPTURE_MAX_BYTES / 1024 / 1024} MB a capture may be - not read. A page the collector fetched is never this size; remove it` });
      continue;
    }
    const text = readText(abs);
    if (text === null) {
      problems.push({ kind: 'capture-unreadable', file: rel, detail: `${rel} could not be read - check its permissions` });
      continue;
    }
    const { front, body } = parseCapture(text);
    if (!front.url) {
      problems.push({ kind: 'capture-no-url', file: rel, detail: 'capture has no url in its front-matter' });
    }
    if (wantSketches) sketches.set(rel, sketch(body));
    renderFailures.set(rel, countRenderFailures(body));
    entries.push(captureEntry({
      file: rel,
      url: front.url,
      retrieved: front.retrieved,
      command: front.command,
      statusCode: front.statusCode,
      transport: front.transport,
      completeness: front.completeness,
      omitted: front.omitted,
      bytes: Buffer.byteLength(body, 'utf8'),
    }));
  }

  const byUrl = new Map();
  const byFile = new Map();
  for (const entry of entries) {
    byFile.set(entry.file, entry);
    if (!entry.url) continue;
    if (newer(entry, byUrl.get(entry.url), rank)) byUrl.set(entry.url, entry);
  }
  // A fetch that redirected is also indexed under the URL it was asked for - the one the
  // plan keeps naming. Aliases come second, so a capture of the asked-for URL itself is
  // never displaced; among aliases the newest wins. Without this a redirected page missed
  // the cache on every later run and was fetched, paid for, and appended to the ledger and
  // the table again as a "first capture" (found 2026-10-02, running the kit on MoonAliza).
  const byAsked = new Map();
  for (const entry of entries) {
    if (!entry.url) continue;                    // a capture with no url of its own stays unreachable
    const asked = requestedUrl(entry.command);
    if (!asked || asked === entry.url) continue;
    if (newer(entry, byAsked.get(asked), rank)) byAsked.set(asked, entry);
  }
  for (const [asked, entry] of byAsked) if (!byUrl.has(asked)) byUrl.set(asked, entry);
  // And by `urlKey`, so a page is found under any spelling of its URL - `www.`, a trailing
  // slash, a fragment, http for https. `byUrl` was exact, so a plan that spelled a page
  // differently from its capture paid for it again (found 2026-10-02, break-test pass 3).
  // Newest wins among the spellings; a spelling's own entry still wins in `byUrl`.
  const byKey = new Map();
  for (const [url, entry] of byUrl) indexByKey(byKey, url, entry, rank);
  // Sketches ride alongside the index rather than inside `captureEntry`, because an entry
  // is serialised into artifact manifests and a 128-value fingerprint per capture would
  // bloat every package to answer a question only one check asks (ADR-0036 amendment).
  return { entries, byUrl, byKey, byFile, sketches, renderFailures, problems };
}

function indexByKey(byKey, url, entry, rank = null, { force = false } = {}) {
  const key = urlKey(url);
  if (force || newer(entry, byKey.get(key), rank)) byKey.set(key, entry);
}

/** The revision a capture name carries: `name.r3.md` is 3, `name.md` is 1 (writeRaw). */
const revisionOf = (file) => { const m = /\.r(\d+)\.md$/.exec(String(file ?? '')); return m ? Number(m[1]) : 1; };
const baseOf = (file) => String(file ?? '').replace(/\.r\d+\.md$/, '.md');

/**
 * Should `entry` displace `held` as the newest capture of its URL? By retrieval date first.
 * On the SAME date: the ledger's order when the reader knows it (`rank`, capture file -> the
 * position of the fetch that wrote it, from `readCorpus`), then a higher revision of the same
 * name, then the later name in `listFiles().sort()` order - which was the whole rule until
 * 2026-10-03, so twelve same-day revisions reopened with `.r9.md` current (it sorts after
 * `.r12.md`) and a page re-titled "API v10" reopened under its "API v9" capture (outside
 * audit). The collector's own run was right - `rememberCapture` makes the new capture
 * current - and the disk disagreed with it as soon as the corpus was reopened.
 */
function newer(entry, held, rank = null) {
  if (!held) return true;
  const a = String(entry.retrieved ?? '');
  const b = String(held.retrieved ?? '');
  if (a !== b) return a > b;
  const ranked = Boolean(rank?.has(entry.file));
  const heldRanked = Boolean(rank?.has(held.file));
  if (ranked && heldRanked) return rank.get(entry.file) > rank.get(held.file);
  if (ranked !== heldRanked) return ranked;      // a fetch on record beats a file no fetch produced
  if (baseOf(entry.file) === baseOf(held.file)) return revisionOf(entry.file) >= revisionOf(held.file);
  return true;
}

/** The one writer of the in-memory index, for a URL collected mid-run. */
/**
 * The ledger's order as a rank: capture file -> position of the fetch that wrote it. The
 * tie-break `newer` uses on one date, built the same way for a reopen (`readCorpus`) and for
 * the collector's refresh under the lock (`refreshCaptures`) - the two had different rules
 * until 2026-10-03, and a collector with a stale snapshot took `.r9.md` as current where the
 * reopened corpus said `.r12.md` (outside audit).
 */
export function ledgerRank(entries) {
  const rank = new Map();
  (entries ?? []).forEach((e, i) => { if (e?.op === 'scrape' && e.raw) rank.set(e.raw, i); });
  return rank;
}

export function rememberCapture(captures, entry, { rank = null, latest = false } = {}) {
  if (!captures || !entry) return entry;
  // A capture is LISTED once: the refresh before every fetch used to push every entry on disk
  // again, and the index held n(n+1)/2 copies after n fetches (2026-10-02). But a known file
  // can become current again without changing - a refetch whose bytes match an earlier
  // capture reuses that file and records it last (A -> B -> A, outside audit, 2026-10-03) - so
  // the slots are decided every time, for the listed entry.
  const known = entry.file ? captures.byFile?.get(entry.file) : null;
  const current = known ?? entry;
  if (!known) {
    captures.entries.push(entry);
    captures.byFile.set(entry.file, entry);
  }
  // ONE rule for the current slot of a URL, the same on every path (readCaptures, this
  // refresh, the collector's own fetch): a direct capture over any redirect alias holding
  // its slot; the fetch that just happened (`latest`) over whatever was there; otherwise
  // `newer` - date, the ledger's rank, revision. Rank alone let an alias that happened to be
  // the later fetch keep the slot from a direct capture, where the reopen gives it to the
  // direct one (outside audit, 2026-10-03).
  if (current.url) {
    const held = captures.byUrl.get(current.url);
    if (!held || held.url !== current.url || latest || newer(current, held, rank)) captures.byUrl.set(current.url, current);
  }
  // The same alias rule as readCaptures: never displace a direct capture, newest alias wins.
  const asked = current.url ? requestedUrl(current.command) : '';
  if (asked && asked !== current.url) {
    const held = captures.byUrl.get(asked);
    if (!held || (held.url !== asked && (latest || newer(current, held, rank)))) captures.byUrl.set(asked, current);
  }
  if (captures.byKey) {
    for (const url of [current.url, asked]) {
      const indexed = url ? captures.byUrl.get(url) : null;
      if (indexed) indexByKey(captures.byKey, url, indexed, rank, { force: latest });
    }
  }
  return current;
}

/**
 * The one freshness predicate. A cache hit never spends scrape budget, so the collector,
 * the run coordinator, and phase 0 all ask here rather than each keeping a rule.
 */
export function cacheDecision(captures, url, { refreshDays = 30, force = false, now = new Date() } = {}) {
  // The exact spelling first; failing that, the page under any spelling (`urlKey`).
  const entry = captures?.byUrl?.get(url) ?? captures?.byKey?.get(urlKey(url)) ?? null;
  if (!entry) return { hit: false, reason: 'not-collected', entry: null, age: null };
  if (force) return { hit: false, reason: 'forced', entry, age: ageInDays(entry.retrieved, now) };
  const age = ageInDays(entry.retrieved, now);
  if (age === null) return { hit: false, reason: 'undated', entry, age: null };
  if (refreshDays >= 0 && age > refreshDays) return { hit: false, reason: 'stale', entry, age };
  return { hit: true, reason: 'fresh', entry, age };
}

// ---------------------------------------------------------------- ledger and logs

export function readLedger(root) {
  const file = resolve(root, PATHS.ledger);
  const text = readText(file);
  if (text === null) return { present: false, entries: [], problems: [], lines: [] };
  const lines = text.split(/\r?\n/);
  const entries = [];
  const problems = [];
  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    try {
      entries.push({ ...JSON.parse(line), line: idx + 1 });
    } catch (err) {
      problems.push({ kind: 'ledger-unparsed', line: idx + 1, detail: err.message });
    }
  });
  return { present: true, entries, problems, lines };
}

export function readOverrides(root) {
  const text = readText(resolve(root, PATHS.overrides));
  if (text === null) return [];
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const [at, kind, ...rest] = line.split('\t');
    return { at, kind, detail: rest.join('\t'), text: line };
  });
}

export function appendJsonLine(root, rel, value) {
  return appendLine(resolve(root, rel), JSON.stringify(value));
}

// ---------------------------------------------------------------- the snapshot

/** Read the whole corpus as one value. Pure of judgement: it reports, never decides. */
export function readCorpus(root) {
  const at = (rel) => resolve(root, rel);
  const problems = [];

  const discoveryText = readText(at(PATHS.discovery));
  const evidenceText = readText(at(PATHS.evidence));
  const sourcesText = readText(at(PATHS.sources));
  const mapText = readText(at(PATHS.map));
  const briefText = readText(at(PATHS.brief));

  const unknownsTable = parseTable(discoveryText, HEADERS.unknowns);
  const evidenceTable = parseTable(evidenceText, HEADERS.evidence);
  const sourcesTable = parseTable(sourcesText, HEADERS.sources);
  const subtopicTable = parseTable(mapText, HEADERS.subtopics);

  for (const [artifact, table] of [
    [PATHS.discovery, unknownsTable], [PATHS.evidence, evidenceTable],
    [PATHS.sources, sourcesTable], [PATHS.map, subtopicTable],
  ]) {
    for (const p of table.problems) problems.push({ ...p, artifact });
  }

  const planText = readText(at(PATHS.plan));
  let plan = null;
  if (planText !== null) {
    try {
      plan = parseJson(planText);
      const duplicate = duplicateKey(planText);
      if (duplicate) problems.push({ kind: 'plan-unparsed', artifact: PATHS.plan, detail: duplicate });
    } catch (err) {
      problems.push({ kind: 'plan-unparsed', artifact: PATHS.plan, detail: err.message });
    }
  }

  // The gate's configuration (the declared code paths). The gate reads an unparseable one as
  // absent and falls back to its defaults, so the operator's declared paths stopped being
  // guarded and nothing said so (found 2026-09-27).
  const kitText = readText(at(PATHS.kit));
  if (kitText !== null) {
    try {
      parseJson(kitText);
      const duplicate = duplicateKey(kitText);
      if (duplicate) problems.push({ kind: 'kit-unparsed', artifact: PATHS.kit, detail: `${duplicate} - until it is fixed, the gate reads only the last value` });
    } catch (err) {
      problems.push({ kind: 'kit-unparsed', artifact: PATHS.kit, detail: `${err.message} - until it parses, the gate guards only the default code paths` });
    }
  }

  // The ledger first: its order is what says which of two same-day captures of a URL is the
  // later one (`newer`), and a capture no fetch recorded ranks below every one a fetch did.
  const ledger = readLedger(root);
  const captures = readCaptures(root, { rank: ledgerRank(ledger.entries) });
  for (const p of captures.problems) problems.push({ ...p, artifact: PATHS.raw });
  for (const p of ledger.problems) problems.push({ ...p, artifact: PATHS.ledger });
  // A source sibling (ADR-0140) that no fetch names is a planted file, not a source: readCaptures
  // never indexes a sibling, so nothing else would see it (breaker review, 2026-10-04).
  const namedSources = new Set(ledger.entries.map((e) => e.source).filter(Boolean));
  for (const name of listFiles(at(PATHS.raw)).sort()) {
    if (!name.endsWith('.source.html')) continue;
    const rel = `${PATHS.raw}/${name}`;
    if (namedSources.has(rel)) continue;
    problems.push({ kind: 'source-unnamed', artifact: PATHS.raw, file: rel,
      detail: `${rel} is a source sibling that no fetch in the ledger names - the collector writes a source beside its capture and records it; remove the file` });
  }

  // A data row whose ID is not in its table's form is RECORDED, never silently dropped.
  //
  // Found 2026-10-03 (output-reliability audit, G2): the three filters below kept only the
  // rows whose ID matched - `U_99`, a typo for `U-99`, was neither an unknown nor a problem.
  // The parser held 12 rows, the corpus 11 unknowns, `problems` was empty, and the gate had
  // nothing to say: a blocking question had vanished on a typo, which is the failure the gate
  // exists to prevent. A row that is empty in every cell stays silent - a blank line somebody
  // left in a table is not a requirement. An empty ID cell on a row that HOLDS something is
  // the typo's twin: the row says its piece and no check can find it (the first version kept
  // every empty ID silent on the premise that the templates ship empty rows; they ship empty
  // tables - found 2026-10-03, review of the G2 fix).
  const malformedIds = (table, artifact, pattern, form) => {
    for (const r of table.rows) {
      const id = (r.ID ?? '').trim();
      if (pattern.test(id)) continue;
      if (!id && !(r.cells ?? []).some((cell) => String(cell ?? '').trim())) continue;
      problems.push({
        kind: 'malformed-id', artifact, row: id || '(empty)', line: r.line,
        detail: id
          ? `row ID "${id}" is not of the form ${form}, so no check reads the row - rename it (the table's IDs are ${form}) or delete the row`
          : `a row with an empty ID cell holds content, and no check reads a row without an ID - give it one (the table's IDs are ${form}) or delete the row`,
      });
    }
  };
  malformedIds(unknownsTable, PATHS.discovery, /^U-\d+$/i, 'U-<number>');
  malformedIds(evidenceTable, PATHS.evidence, /^E-\d+$/i, 'E-<number>');
  malformedIds(subtopicTable, PATHS.map, /^[A-Z]+-\d+$/i, '<LETTERS>-<number>');

  const unknowns = unknownsTable.rows
    .filter((r) => /^U-\d+$/i.test(r.ID ?? ''))
    .map((r) => ({
      id: r.ID, text: r.Unknown ?? '', why: r[HEADERS.unknowns[2]] ?? '',
      status: (r.Status ?? '').trim().toUpperCase(), evidence: r.Evidence ?? '', line: r.line,
      cites: citedIds(stripReviewNotes(r.Evidence ?? '')),
    }));

  const evidence = evidenceTable.rows
    .filter((r) => /^E-\d+$/i.test(r.ID ?? ''))
    .map((r) => ({
      id: r.ID, retrieved: r.Retrieved ?? '', type: (r.Type ?? '').trim().toUpperCase(),
      url: r.URL ?? '', finding: r.Finding ?? '', raw: normalizeRawCell(r.Raw ?? ''), line: r.line,
    }));

  const subtopics = subtopicTable.rows
    .filter((r) => /^[A-Z]+-\d+$/i.test(r.ID ?? ''))
    .map((r) => ({
      id: r.ID, text: r.Subtopic ?? '', why: r[HEADERS.subtopics[2]] ?? '',
      status: (r.Status ?? '').trim().toUpperCase(), coveredBy: r['Covered by'] ?? '', line: r.line,
      cites: citedIds(stripReviewNotes(r['Covered by'] ?? '')),
    }));

  const sources = sourcesTable.rows.map((r) => ({
    url: r.URL ?? '', type: (r.Type ?? '').trim().toUpperCase(), title: r.Title ?? '',
    retrieved: r.Retrieved ?? '', usedFor: r['Used for'] ?? '', line: r.line,
  }));

  // A cited capture that is not on disk is a corpus problem, not a check's discovery.
  for (const row of evidence) {
    if (!row.raw) continue;
    const named = projectFile(root, row.raw);
    if (named.problem === 'outside') {
      // A Raw cell that lands outside the project (a "../" spelling, or a link) is never
      // read: evidence-context printed such a file into an agent's context (2026-09-28).
      problems.push({ kind: 'raw-outside', artifact: PATHS.evidence, row: row.id, file: row.raw, line: row.line,
        detail: `${row.raw} (row ${row.id}) is outside the project - a Raw cell names a capture in ${PATHS.raw}/` });
      continue;
    }
    if (named.problem === 'missing') {
      problems.push({ kind: 'raw-dangling', artifact: PATHS.evidence, row: row.id, file: row.raw, line: row.line });
    }
  }

  return {
    root,
    intent: sectionOf(discoveryText, 'Build intent'),
    intentHeading: /^#{1,6}\s+Build intent\s*$/mi.test(discoveryText ?? ''),
    discovery: { present: discoveryText !== null, text: discoveryText ?? '', table: unknownsTable },
    // Whether the evidence table travelled at all: the file, and a header row naming its columns.
    evidenceFile: { present: evidenceText !== null, found: evidenceTable.found },
    map: {
      present: mapText !== null, text: mapText ?? '', table: subtopicTable,
      topic: sectionOf(mapText, 'Topic').split(/\r?\n/).filter(Boolean).join(' ').trim(),
    },
    brief: { present: briefText !== null, text: briefText ?? '' },
    plan, planPresent: planText !== null,
    unknowns, evidence, sources, subtopics,
    captures, ledger,
    overrides: readOverrides(root),
    gateOff: exists(at(PATHS.gateOff)),
    rawPresent: isDirectory(at(PATHS.raw)),
    problems,
  };
}

/** `readCorpus` plus the chain verdict, for callers that need the whole answer. */
export async function loadCorpus(root) {
  const corpus = readCorpus(root);
  const { verifyLedger } = await import('./provenance.mjs');
  corpus.chain = verifyLedger(root, { corpus });
  return corpus;
}

// ---------------------------------------------------------------- joins (ADR-0015)

function normalizeRawCell(cell) {
  const text = String(cell ?? '').trim();
  if (!text || text === '-') return '';
  const link = text.match(/\]\(([^)]+)\)/);
  const value = (link ? link[1] : text).trim().replace(/^`|`$/g, '');
  // Every backslash is a separator. Splitting on path.sep converted them only on Windows, so a
  // row written there passed on Windows and failed on a Linux builder (found 2026-09-27).
  return value.replace(/\\/g, '/');
}

/**
 * A reviewer's recorded judgement, removed before citations are counted.
 *
 * WHY. `citedIds` returns every `E-##` mention in a cell, and a `[single-witness: ...]`
 * reason is prose a reviewer writes INSIDE that cell. So explaining why no second witness
 * exists - by referring to a row that demonstrates it - silently turned that row into a
 * citation. The unknown then read as corroborated while its own note denied it, and
 * `single-witness-stale` fired on a corpus that was correct.
 *
 * It caught its author three times in two days, across three different projects. The guard
 * was right every time and the MECHANISM was the problem: a note about evidence is not a
 * citation of it.
 *
 * The raw cell is untouched - `unknown.evidence` still carries the note, because the check
 * that reads the reason needs it. Only the citation extraction sees the stripped text.
 */
const REVIEW_NOTE = /\[(?:single-witness|render-reviewed):[^\]]*\]/gi;

export function stripReviewNotes(text) {
  return String(text ?? '').replace(REVIEW_NOTE, ' ');
}

/** Every `E-##` / `U-##` / `D-##` id mentioned in a free-text cell. */
export function citedIds(text) {
  return [...String(text ?? '').matchAll(/\b([A-Z]+-\d+)\b/g)].map((m) => m[1]);
}

export function sectionOf(text, heading) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  const want = heading.trim().toLowerCase();
  let depth = 0;
  const out = [];
  for (const line of lines) {
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      const title = head[2].replace(/[*_`]/g, '').trim().toLowerCase();
      if (!depth && title === want) { depth = head[1].length; continue; }
      if (depth && head[1].length <= depth) break;
    }
    if (depth) out.push(line);
  }
  return out.join('\n').trim();
}

/** The capture behind an evidence row. An empty Raw cell matches on the URL alone. */
export function captureOf(corpus, row) {
  if (!row) return null;
  if (row.raw) return corpus.captures.byFile.get(row.raw) ?? null;
  if (row.url) return corpus.captures.byUrl.get(row.url) ?? null;
  return null;
}

/** The fetch that produced an evidence row: its ledger entry plus its capture. */
export function traceOf(corpus, row) {
  const capture = captureOf(corpus, row);
  const wanted = row?.raw || capture?.file || '';
  const entries = corpus.ledger.entries.filter((e) => {
    if (e.op === 'fail') return false;
    if (wanted && e.raw === wanted) return true;
    if (!wanted && row?.url && e.url === row.url) return true;
    return false;
  });
  const fetch = entries.length ? entries[entries.length - 1] : null;
  return { row, capture, fetch, attempts: corpus.ledger.entries.filter((e) => e.url && e.url === row?.url) };
}

/** The claim an unknown rests on: the first cited row's finding, else its own text. */
export function claimOf(corpus, unknown) {
  for (const id of unknown?.cites ?? []) {
    const row = corpus.evidence.find((e) => e.id.toUpperCase() === id.toUpperCase());
    if (row?.finding) return row.finding;
  }
  return unknown?.text ?? '';
}

// ---------------------------------------------------------------- writers

/**
 * Map values given in the CANONICAL header's order onto the header actually on disk.
 *
 * The reader accepts a reordered header, so a writer that inserted values positionally
 * wrote them into whatever columns happened to be there: with `URL` and `Retrieved`
 * swapped, a collected row put the date in the URL cell and `P` in the retrieval cell,
 * and nothing complained. A header the canonical set does not cover is refused rather
 * than guessed at - the alternative is silent evidence corruption.
 */
export function alignToHeader(canonical, cells, actual) {
  if (!actual || actual.length === 0) return cells;
  const byName = new Map(canonical.map((name, i) => [name.trim().toLowerCase(), cells[i] ?? '']));
  const unknown = actual.filter((name) => !byName.has(name.trim().toLowerCase()));
  if (unknown.length) {
    const err = new Error(
      `refusing to write: the table's header holds ${unknown.map((n) => `"${n}"`).join(', ')}, `
      + `which is not in the expected set (${canonical.join(', ')}). `
      + 'Restore the header or migrate the table; a positional write here corrupts evidence silently.',
    );
    err.code = 'UNSUPPORTED_HEADER';
    throw err;
  }
  return actual.map((name) => byName.get(name.trim().toLowerCase()) ?? '');
}

/** The header a table actually carries on disk, or null when it has none yet. */
export function headerOf(text, canonical) {
  const table = parseTable(text, canonical);
  return table.found ? table.header : null;
}

/** Append one row to an artifact's table, creating the table when it is absent. */
export function appendRow(root, rel, header, cells) {
  const file = resolve(root, rel);
  const text = readText(file, '');
  const onDisk = headerOf(text, header);
  const line = tableRow(alignToHeader(header, cells, onDisk));
  if (!onDisk) {
    const head = `${tableRow(header)}\n|${header.map(() => '---').join('|')}|\n`;
    writeText(file, `${text.trimEnd()}\n\n${head}${line}\n`.replace(/^\n+/, ''));
    return line;
  }
  const lines = text.split(/\r?\n/);
  let last = -1;
  const table = parseTable(text, header);
  if (table.rows.length) last = table.rows[table.rows.length - 1].line - 1;
  else {
    // Find the header by the column the TABLE ACTUALLY LEADS WITH, not by the canonical
    // first column: on a reordered table those differ, the lookup failed, and the row was
    // spliced in at line 0 - above the document's own title.
    const leading = (onDisk?.[0] ?? header[0]).trim().toLowerCase();
    for (let i = 0; i < lines.length; i += 1) {
      if (splitRow(lines[i])[0]?.trim().toLowerCase() === leading) { last = i + 1; break; }
    }
  }
  lines.splice(last + 1, 0, line);
  writeText(file, lines.join('\n'));
  return line;
}

/** Replace the row whose first cell matches, or append it when there is none. */
export function upsertRow(root, rel, header, cells) {
  const file = resolve(root, rel);
  const text = readText(file, '');
  const table = parseTable(text, header);
  const onDisk = headerOf(text, header);
  const aligned = alignToHeader(header, cells, onDisk);
  // The key is the canonical first column's value, matched in whichever position that
  // column occupies on disk.
  const keyAt = onDisk ? onDisk.findIndex((name) => name.trim().toLowerCase() === header[0].trim().toLowerCase()) : 0;
  const key = String(cells[0]).trim().toLowerCase();
  const found = table.rows.find((r) => String(r.cells[keyAt < 0 ? 0 : keyAt]).trim().toLowerCase() === key);
  if (!found) return appendRow(root, rel, header, cells);
  const lines = text.split(/\r?\n/);
  lines[found.line - 1] = tableRow(aligned);
  writeText(file, lines.join('\n'));
  return lines[found.line - 1];
}

/** The next free `E-##` / `U-##` / `D-##` style id for a list of rows. */
export function nextId(prefix, rows) {
  let max = 0;
  for (const row of rows) {
    const m = String(row.id ?? row.ID ?? '').match(new RegExp(`^${prefix}-(\\d+)$`, 'i'));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}

export { relative, sha256File, hostOf, fs };
