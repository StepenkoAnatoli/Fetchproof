// measure-spacing.mjs - the measurement behind this project's brief (Decision section).
//
// Reads the two pairs of captures this corpus holds of one page through two transports (the
// Python `re` page: E-01 keyless, E-08 Firecrawl; the Wikipedia "Percent sign" page: E-02
// keyless, E-09 Firecrawl), and asks, per punctuation mark, how many short passages taken around
// that mark from one capture are found in the other capture of the same page - with the kit's
// `normalizeForMatch` as it is (fetchproof/lib/quotes.mjs at the run's base commit 8c63e77), and
// with ADR-0192's proposed rule added after it: whitespace removed before `. , ; : ! ? % ) ] }`
// and after `( [ {`. It also counts, over every capture in this repository, the places where the
// rule would join a mark to the word AFTER it (` .txt`, ` ,5`, ` :hover`), which is where it
// could merge text it should not.
//
// Read-only: it writes nothing. Run from the repository root:
//   node docs/decisions/2026-10-25-punctuation-spacing/measure-spacing.mjs
// Deterministic for a given checkout; the numbers in research/BRIEF.md are its output on 2026-10-25.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeForMatch } from '../../../fetchproof/lib/quotes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = (name) => path.join(here, 'research', 'raw', name);
const bodyOf = (file) => {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return text.startsWith('---\n') ? text.slice(text.indexOf('\n---\n', 4) + 5) : text;
};

const CLOSING = ['.', ',', ';', ':', '!', '?', '%', ')', ']', '}'];
const OPENING = ['(', '[', '{'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ADR-0192's proposed addition, applied to text normalizeForMatch already produced. */
function proposedRule(normalized) {
  return normalized
    .replace(/\s+([.,;:!?%)\]}])/g, '$1')
    .replace(/([([{])\s+/g, '$1');
}

/**
 * Passages of `n` characters on each side of every spaced occurrence of `mark` in `text`
 * (`spaced` = a space before a closing mark, after an opening one), cut back to whole words.
 */
function windows(text, mark, opening, n = 24) {
  const re = opening ? new RegExp(`${esc(mark)} (?=\\S)`, 'g') : new RegExp(`(?<=\\S) ${esc(mark)}`, 'g');
  const out = [];
  for (const m of text.matchAll(re)) {
    let from = Math.max(0, m.index - n);
    let to = Math.min(text.length, m.index + m[0].length + n);
    while (from > 0 && from < m.index && text[from - 1] !== ' ') from += 1;
    while (to < text.length && to > m.index + m[0].length && text[to] !== ' ') to -= 1;
    const w = text.slice(from, to).trim();
    if (w.split(' ').length >= 3) out.push(w);
  }
  return out;
}

function measurePair(label, fromFile, toFile) {
  const a = normalizeForMatch(bodyOf(raw(fromFile)));
  const b = normalizeForMatch(bodyOf(raw(toFile)));
  const bRule = proposedRule(b);
  const rows = [];
  for (const [marks, opening] of [[CLOSING, false], [OPENING, true]]) {
    for (const mark of marks) {
      const ws = windows(a, mark, opening);
      const now = ws.filter((w) => b.includes(w)).length;
      const after = ws.filter((w) => bRule.includes(proposedRule(w))).length;
      rows.push({ mark: opening ? `${mark} after` : `${mark} before`, spaced: ws.length, foundNow: now, foundWithRule: after });
    }
  }
  console.log(`\n${label}`);
  console.log('| mark | spaced passages | found now | found with rule |');
  console.log('|---|---|---|---|');
  for (const r of rows) console.log(`| \`${r.mark}\` | ${r.spaced} | ${r.foundNow} | ${r.foundWithRule} |`);
}

measurePair('Python re: keyless E-01 passages searched in Firecrawl E-08',
  '2026-10-25-re-regular-expression-operations-python--python-02d619bb.md',
  '2026-10-25-re-regular-expression-operations-python--python-02d619bb.r2.md');
measurePair('Python re: Firecrawl E-08 passages searched in keyless E-01',
  '2026-10-25-re-regular-expression-operations-python--python-02d619bb.r2.md',
  '2026-10-25-re-regular-expression-operations-python--python-02d619bb.md');
measurePair('Wikipedia Percent sign: keyless E-02 passages searched in Firecrawl E-09',
  '2026-10-25-percent-sign-wikipedia-wikipedia-5a9cfcf7.md',
  '2026-10-25-percent-sign-wikipedia-wikipedia-5a9cfcf7.r2.md');
measurePair('Wikipedia Percent sign: Firecrawl E-09 passages searched in keyless E-02',
  '2026-10-25-percent-sign-wikipedia-wikipedia-5a9cfcf7.r2.md',
  '2026-10-25-percent-sign-wikipedia-wikipedia-5a9cfcf7.md');

// Where the rule joins a mark to the word after it, over every capture in the repository.
const repo = path.resolve(here, '..', '..', '..');
const captures = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/[\\/]research[\\/]raw[\\/][^\\/]+\.md$/.test(p)) captures.push(p);
  }
};
walk(path.join(repo, 'research'));
walk(path.join(repo, 'docs', 'decisions'));
const joins = new Map();
let files = 0;
for (const f of captures) {
  files += 1;
  const t = normalizeForMatch(bodyOf(f));
  for (const m of t.matchAll(/(?<=[\p{L}\p{N}]) ([.,;:!?%])(?=[\p{L}\p{N}])/gu)) {
    // A mark followed by a digit is the dangerous kind (` .5`, ` ,5`: a number could be formed),
    // so it is counted on its own line.
    const key = /\p{N}/u.test(t[m.index + 2]) ? `${m[1]} then a digit` : m[1];
    const entry = joins.get(key) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3) entry.examples.push(t.slice(Math.max(0, m.index - 20), m.index + 22));
    joins.set(key, entry);
  }
}
console.log(`\nJoins: "<word> <mark><word>" in ${files} captures (the rule would make it "<word><mark><word>")`);
for (const [mark, e] of [...joins].sort((x, y) => y[1].count - x[1].count)) {
  console.log(`  ${mark}  ${e.count}   e.g. ${e.examples.map((x) => JSON.stringify(x)).join('  ')}`);
}
