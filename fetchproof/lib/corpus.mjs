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

// A space in cmark-gfm's table scanners (ext_scanners.re) is a space, a tab, a vertical tab or a
// form feed; a cell runs to the next pipe that no backslash escapes.
const SPACECHAR = (c) => c === ' ' || c === '\t' || c === '\v' || c === '\f';

function cellEnd(text, at) {
  if (text[at] !== '|') return 0;
  let j = at + 1;
  while (j < text.length && SPACECHAR(text[j])) j += 1;
  return j - at;
}

/**
 * How many cells GitHub reads in one line of a table, counted as cmark-gfm's `row_from_string`
 * counts them: a leading pipe opens the row, and every cell, empty or not, before a pipe counts.
 * A line of a lone `|` holds none. From 65,536 cells on, GitHub reads no row at all.
 */
function rowCells(text) {
  const n = text.length;
  let i = cellEnd(text, 0);
  let count = 0;
  while (i < n) {
    let j = i;
    while (j < n && (text[j] !== '|' || (j > i && text[j - 1] === '\\'))) j += 1;
    const pipe = cellEnd(text, j);
    if (j > i || pipe) count += 1;
    i = j + pipe;
    if (!pipe) break;
  }
  return count;
}

/**
 * How many cells a delimiter row holds as GitHub reads one (`scan_table_start`): each is dashes,
 * with an optional colon at either end, between pipes, the outer ones optional. 0 if it is not one.
 */
function delimiterCells(text) {
  const n = text.length;
  let i = text[0] === '|' ? 1 : 0;
  let count = 0;
  for (;;) {
    let j = i;
    while (j < n && SPACECHAR(text[j])) j += 1;
    if (j === n && count > 0) return count;
    if (text[j] === ':') j += 1;
    const dash = j;
    while (text[j] === '-') j += 1;
    if (j === dash) return 0;
    if (text[j] === ':') j += 1;
    while (j < n && SPACECHAR(text[j])) j += 1;
    count += 1;
    if (j === n) return count;
    if (text[j] !== '|') return 0;
    i = j + 1;
  }
}

// A separator as the kit writes and finds one: pipes, dashes, colons and spaces, a pipe past the
// first character, a dash somewhere. Read in one pass: the regular expression it replaces
// backtracked over a long line of them (review of #441's reader, 2026-11-07, F-E).
function isSeparator(line) {
  const t = line.trim();
  return t.length >= 2 && /^[\s:|-]*$/.test(t) && t.indexOf('|', 1) > 0 && line.includes('-');
}

// The block starts of cmark-gfm's scanners (scanners.re), each read at `p` in `s`, one line that
// ends in a single line feed. A space there is any of space, tab, vertical tab, form feed, CR, LF.
const HTML_SPACE = (c) => c === ' ' || c === '\t' || c === '\v' || c === '\f' || c === '\r' || c === '\n';
const HTML_BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd '
  + 'details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header '
  + 'hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param section source title '
  + 'summary table tbody td tfoot th thead tr track ul').split(' '));
const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9:._-]/;
const UNQUOTED = (c) => c !== undefined && !HTML_SPACE(c) && !'"\'=<>`'.includes(c);

/** The type, 1 to 7, of the HTML block that starts at `p`, or 0; type 7 never interrupts a paragraph. */
function htmlStart(s, p, overParagraph) {
  if (s[p] !== '<') return 0;
  const type1 = /<(?:script|pre|textarea|style)(?:[ \t\v\f\r\n]|>)/iy;
  type1.lastIndex = p;
  if (type1.test(s)) return 1;
  if (s.startsWith('<!--', p)) return 2;
  if (s.startsWith('<?', p)) return 3;
  if (s[p + 1] === '!' && /[A-Z]/.test(s[p + 2] ?? '')) return 4;
  if (s.slice(p, p + 9).toUpperCase() === '<![CDATA[') return 5;
  let q = p + 1 + (s[p + 1] === '/' ? 1 : 0);
  const name = /[A-Za-z0-9]*/y;
  name.lastIndex = q;
  const tag = name.exec(s)[0];
  q += tag.length;
  if (HTML_BLOCK_TAGS.has(tag.toLowerCase()) && (HTML_SPACE(s[q]) || s[q] === '>' || s.startsWith('/>', q))) return 6;
  return !overParagraph && htmlTag(s, p) ? 7 : 0;
}

// A whole open or closing tag alone on its line (`scan_html_block_start_7`), read left to right
// once: an attribute name followed by `=` must take a value, so no reading of it is undone.
function htmlTag(s, p) {
  const skip = (k, ok) => { while (ok(s[k])) k += 1; return k; };
  const closing = s[p + 1] === '/';
  let k = p + (closing ? 2 : 1);
  if (!/[A-Za-z]/.test(s[k] ?? '')) return false;
  k = skip(k + 1, (c) => c !== undefined && /[A-Za-z0-9-]/.test(c));
  while (!closing) {
    const name = skip(k, HTML_SPACE);
    if (name === k || !NAME_START.test(s[name] ?? '')) break;
    k = skip(name + 1, (c) => c !== undefined && NAME_CHAR.test(c));
    const eq = skip(k, HTML_SPACE);
    if (s[eq] !== '=') continue;
    const value = skip(eq + 1, HTML_SPACE);
    const quote = s[value];
    if (quote === '"' || quote === "'") {
      const end = s.indexOf(quote, value + 1);
      if (end < 0) return false;
      k = end + 1;
    } else {
      k = skip(value, UNQUOTED);
      if (k === value) return false;
    }
  }
  k = skip(k, HTML_SPACE);
  if (!closing && s[k] === '/') k += 1;
  if (s[k] !== '>') return false;
  k = skip(k + 1, (c) => c === ' ' || c === '\t' || c === '\f');
  return k === s.length - 1;
}

// Whether the HTML block of `type` ends on this line, looked for from `p` (the start line too).
function htmlEnds(type, s, p) {
  if (type === 1) {
    const end = /<\/(?:script|pre|textarea|style)>/gi;
    end.lastIndex = p;
    return end.test(s);
  }
  const marker = ['', '', '-->', '?>', '>', ']]>'][type];
  return marker ? s.indexOf(marker, p) >= 0 : false;
}

// A fence opens with three or more backticks or tildes; after backticks, none on the rest of the line.
function fenceOpens(s, p) {
  const c = s[p];
  if (c !== '`' && c !== '~') return 0;
  let k = p;
  while (s[k] === c) k += 1;
  if (k - p < 3 || (c === '`' && s.indexOf('`', k) >= 0)) return 0;
  return k - p;
}

// It closes with a run of its own character at least as long, then spaces or tabs alone.
function fenceCloses(s, p, fence) {
  let k = p;
  while (s[k] === fence.char) k += 1;
  if (k - p < 3 || k - p < fence.length) return false;
  while (s[k] === ' ' || s[k] === '\t') k += 1;
  return k === s.length - 1;
}

const ATX = /#{1,6}(?:[ \t]+|\n)/y;
const SETEXT = /(?:=+|-+)[ \t]*\n/y;
const FOOTNOTE = /\[\^([^\] \t\r\n\0]+)\]:[ \t]*/y;
const sticky = (re, s, p) => { re.lastIndex = p; return re.exec(s); };
const LIST_SPACE = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

/**
 * The length of the list marker at `p` (`parse_list_marker`), or 0. Over a paragraph a marker must
 * be followed by more than spaces, and an ordered one must be numbered 1.
 */
function listMarker(s, p, overParagraph) {
  let k = p;
  if (s[k] === '*' || s[k] === '-' || s[k] === '+') {
    k += 1;
  } else if (s[k] >= '0' && s[k] <= '9') {
    let start = 0;
    let digits = 0;
    do { start = start * 10 + (s.charCodeAt(k) - 48); k += 1; digits += 1; } while (digits < 9 && s[k] >= '0' && s[k] <= '9');
    if ((overParagraph && start !== 1) || (s[k] !== '.' && s[k] !== ')')) return 0;
    k += 1;
  } else {
    return 0;
  }
  if (!LIST_SPACE(s[k])) return 0;
  if (overParagraph) {
    let j = k;
    while (s[j] === ' ' || s[j] === '\t') j += 1;
    if (s[j] === '\n') return 0;
  }
  return k - p;
}

/**
 * Where a thematic break may start in `s`, found once for the whole line: from `p` on, only one of
 * `*`, `-`, `_` and spaces or tabs, three of it at least.
 */
function breakTest(s) {
  let k = s.length - 2;
  while (k >= 0 && (s[k] === ' ' || s[k] === '\t')) k -= 1;
  const ch = s[k];
  if (ch !== '*' && ch !== '-' && ch !== '_') return () => false;
  let bad = -1;
  let seen = 0;
  let third = -1;
  for (let j = k; j >= 0; j -= 1) {
    if (s[j] === ch) {
      seen += 1;
      if (seen === 3) third = j;
    } else if (s[j] !== ' ' && s[j] !== '\t') {
      bad = j;
      break;
    }
  }
  return (p) => s[p] === ch && p > bad && p <= third;
}

/**
 * Whether an HTML comment is still open after `text`, given whether one was open before it. A
 * `<!--` after the `-->` that closed one reopens it, and GitHub keeps such a comment open to the
 * next `-->`, though CommonMark ended the HTML block at that line; `<!-->` and `<!--->` close as
 * they open, as HTML reads them.
 */
function commentOpenAfter(text, open) {
  let at = 0;
  let inside = open;
  for (;;) {
    if (inside) {
      const end = text.indexOf('-->', at);
      if (end < 0) return true;
      at = end + 3;
      inside = false;
    } else {
      const start = text.indexOf('<!--', at);
      if (start < 0) return false;
      at = start + 4;
      if (text[at] === '>') at += 1;
      else if (text.startsWith('->', at)) at += 2;
      else inside = true;
    }
  }
}

/**
 * Which lines of a document GitHub shows as code or hides, and which headers it makes a table of,
 * read in one pass. The header search and the stray-row scan ask the same answer, so a table is
 * judged by one rule wherever it stands (independent audit 2026-11-04, F01).
 *
 * It follows cmark-gfm's block parser (blocks.c, table.c) line by line, as GitHub reads the file:
 * a line ends at LF, CR LF or a carriage return alone; a byte-order mark at the start of the file
 * is not the first line's content; block quotes, list items and footnote definitions hold the
 * lines that reach their column, each measured from its parent's, and a paragraph runs on lazily
 * below them; a fence, an indented code block or an HTML block takes the lines GitHub gives it.
 * Shortcuts of its own hid every table below an indented example (review of #441, 2026-11-06),
 * then missed a block at an item's column below a lazy line, a footnote definition, a lone CR and
 * a header GitHub makes no table of (re-review, 2026-11-07, F-A to F-E and N1). What it does not
 * follow, and which way each departure errs, is named in ADR-0203, decision 6.
 *
 * Returns `{ at, open, heads, rowOf, segs, endWhy }`, each indexed by the 0-based line:
 * - `at[i]` the record of the block that hides line i - `kind` 'fence', 'indented', 'comment',
 *   'html' (with its `type`) or 'footnote' (a definition nothing refers to), and the 1-based `line`
 *   that opened it - or null. Lines of one block share its record.
 * - `open` the record of a block the file ends inside, which hides whatever is written at its end:
 *   a fence, a comment, or a comment cut off where the block holding it ends (`runaway`, the
 *   1-based line of the cut), which GitHub leaves open to the end of the file.
 * - `heads[i]` true if GitHub makes a table of the header at line i, else why not (`{ why }`).
 * - `rowOf[i]` the 0-based header line of the table line i is a row of, else -1.
 * - `segs[i]` how many lines GitHub reads in line i; `endWhy[i]` why a table ended at line i.
 */
export function hiddenLines(lines) {
  const n = lines.length;
  const at = new Array(n).fill(null);
  const rowOf = new Array(n).fill(-1);
  const wasRowOf = new Array(n).fill(-1);
  const segs = new Array(n).fill(0);
  const endWhy = new Array(n).fill(null);
  const outcome = new Array(n).fill(null);
  // Containers, outermost first: { type: 'quote' }, { type: 'item', need, held } and
  // { type: 'footnote', label, record }. A line with nothing on it ends the quotes and the items
  // that hold nothing yet; past its spaces, the footnotes too. Their indexes are kept so that such
  // a line is read without walking every container (F-E).
  const stack = [];
  const stopsEmpty = [];
  const stopsZero = [];
  const definitions = [];
  const refs = new Set();
  let tip = null;
  let open = null;
  let rawComment = null;
  let line = 0;
  let prevLine = 0;
  // The line being read: cmark's offset, column, partly consumed tab, first non-space and indent.
  let s = '';
  let offset = 0;
  let column = 0;
  let pct = false;
  let fns = 0;
  let fnsc = 0;
  let indent = 0;
  let blank = false;

  const findNonspace = () => {
    let toTab = 4 - (column % 4);
    if (fns <= offset) {
      fns = offset;
      fnsc = column;
      for (;;) {
        if (s[fns] === ' ') { fns += 1; fnsc += 1; toTab -= 1; if (toTab === 0) toTab = 4; }
        else if (s[fns] === '\t') { fns += 1; fnsc += toTab; toTab = 4; }
        else break;
      }
    }
    indent = fnsc - column;
    blank = s[fns] === '\n';
  };
  const advance = (count, columns) => {
    while (count > 0 && offset < s.length) {
      if (s[offset] === '\t') {
        const toTab = 4 - (column % 4);
        if (columns) {
          pct = toTab > count;
          const step = Math.min(count, toTab);
          column += step;
          offset += pct ? 0 : 1;
          count -= step;
        } else {
          pct = false; column += toTab; offset += 1; count -= 1;
        }
      } else {
        pct = false; offset += 1; column += 1; count -= 1;
      }
    }
  };
  const hide = (record) => { at[line] ??= record; };
  // A container's first child: an item that held nothing no longer ends at a line with nothing on it.
  const hold = () => {
    const top = stack[stack.length - 1];
    if (top?.type === 'item' && !top.held) {
      top.held = true;
      stopsEmpty.pop();
      stopsZero.pop();
    }
  };
  const push = (container) => {
    hold();
    if (container.type !== 'footnote') stopsEmpty.push(stack.length);
    stopsZero.push(stack.length);
    stack.push(container);
  };
  const popTo = (m) => {
    while (stack.length > m) {
      const gone = stack.pop();
      if (gone.type === 'footnote') gone.record.to = prevLine;
    }
    while (stopsEmpty.length && stopsEmpty[stopsEmpty.length - 1] >= m) stopsEmpty.pop();
    while (stopsZero.length && stopsZero[stopsZero.length - 1] >= m) stopsZero.pop();
  };
  const closeTip = (why) => {
    if (tip?.type === 'table' && endWhy[line] === null) endWhy[line] = why;
    tip = null;
  };
  // Footnote references, `[^label]`, on the text GitHub shows; one pass, however many `[^` it holds.
  const noteRefs = (text) => {
    let p = text.indexOf('[^');
    while (p >= 0) {
      let q = p + 2;
      while (q < text.length && text[q] !== ']' && !/\s/.test(text[q])) q += 1;
      if (text[q] === ']' && q > p + 2) refs.add(text.slice(p + 2, q).toLowerCase());
      p = text.indexOf('[^', q);
    }
  };
  const addPara = (text) => {
    tip.last = text;
    tip.lastLine = line;
    if (!tip.overflow && text.length >= 65_536) tip.overflow = rowCells(text) >= 65_536;
    noteRefs(text);
  };
  // How many containers the line continues (check_open_blocks). Once nothing but the line end is
  // left, the rest is known without a walk: past held items, up to a quote, an item that holds
  // nothing, or - unless the line is empty - a footnote definition.
  const walk = () => {
    const empty = s === '\n';
    let m = 0;
    while (m < stack.length) {
      findNonspace();
      if (blank && indent === 0) {
        const stops = empty ? stopsEmpty : stopsZero;
        let lo = 0;
        let hi = stops.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (stops[mid] < m) lo = mid + 1;
          else hi = mid;
        }
        return lo < stops.length ? stops[lo] : stack.length;
      }
      const container = stack[m];
      if (container.type === 'quote') {
        if (indent > 3 || s[fns] !== '>') break;
        advance(indent + 1, true);
        if (s[offset] === ' ' || s[offset] === '\t') advance(1, true);
      } else if (container.type === 'item') {
        if (indent >= container.need) advance(container.need, true);
        else if (blank && container.held) advance(fns - offset, false);
        else break;
      } else if (indent >= 4) {
        advance(4, true);
      } else if (!empty) {
        break;
      }
      m += 1;
    }
    return m;
  };
  // A header over a delimiter row (try_opening_table_header): a delimiter row GitHub does not read
  // leaves the paragraph as it is; one of another width, or an earlier one in the same paragraph,
  // rules it out for good. The header is the paragraph's last line, as GitHub took it in.
  const tableHeader = () => {
    if (tip.visited) return { why: 'visited' };
    const delimiter = delimiterCells(s.slice(fns, -1));
    if (delimiter === 0 || delimiter >= 65_536) return { why: 'separator' };
    const header = tip.overflow ? 65_536 : rowCells(tip.last);
    if (header !== delimiter) {
      tip.visited = true;
      return { why: 'cells', header, delimiter };
    }
    tip = { type: 'table', line: tip.lastLine, cols: delimiter, rows: 1, nonEmpty: delimiter };
    return true;
  };
  let stopped = false;
  const segment = (text, first) => {
    s = `${text}\n`;
    offset = first && s[0] === '\uFEFF' ? 1 : 0;
    column = 0;
    pct = false;
    fns = 0;
    fnsc = 0;
    let brk = null;
    const m = walk();
    let contType = m ? stack[m - 1].type : 'doc';
    let tipMatched = false;
    if (m < stack.length) {
      // A comment the end of its container cuts off leaves its `<!--` open in GitHub's page, and
      // the browser hides the rest of the file in it (N1).
      if (tip?.type === 'html' && tip.htmlType === 2 && !stack.some((c) => c.type === 'footnote')) {
        tip.record.runaway = line + 1;
        for (let k = line; k < n; k += 1) at[k] = tip.record;
        open = tip.record;
        stopped = true;
        return;
      }
    } else if (tip) {
      findNonspace();
      if (tip.type === 'fence') {
        if (indent <= 3 && s[fns] === tip.char && fenceCloses(s, fns, tip)) {
          hide(tip.record);
          tip = null;
          return;
        }
        tipMatched = true;
      } else if (tip.type === 'indented') {
        tipMatched = indent >= 4 || blank;
      } else if (tip.type === 'html') {
        tipMatched = tip.htmlType <= 5 || !blank;
      } else if (tip.type === 'table') {
        const cells = blank ? 0 : rowCells(s.slice(fns, -1));
        tipMatched = cells > 0 && cells < 65_536;
      } else {
        tipMatched = !blank;
      }
      if (tipMatched) contType = tip.type;
    }
    // open_new_blocks: the first block the line opens ends what the line did not continue.
    let opened = false;
    let maybeLazy = tip?.type === 'para';
    let depth = 0;
    const opens = (why) => {
      if (opened) return;
      opened = true;
      closeTip(m < stack.length ? 'outside' : why);
      popTo(m);
    };
    while (contType !== 'fence' && contType !== 'indented' && contType !== 'html') {
      depth += 1;
      findNonspace();
      const indented = indent >= 4;
      let k;
      if (!indented && s[fns] === '>') {
        opens('block');
        advance(fns + 1 - offset, false);
        if (s[offset] === ' ' || s[offset] === '\t') advance(1, true);
        push({ type: 'quote' });
      } else if (!indented && sticky(ATX, s, fns)) {
        opens('block');
        hold();
        noteRefs(s.slice(fns, -1));
        return;
      } else if (!indented && (k = fenceOpens(s, fns))) {
        opens('block');
        hold();
        tip = { type: 'fence', char: s[fns], length: Math.min(k, 255), record: { kind: 'fence', line: line + 1 } };
        hide(tip.record);
        return;
      } else if (!indented && (k = htmlStart(s, fns, contType === 'para'))) {
        opens('block');
        hold();
        tip = { type: 'html', htmlType: k, commentOpen: false, record: k === 2 ? { kind: 'comment', line: line + 1 } : { kind: 'html', type: k, line: line + 1 } };
        contType = 'html';
        break;
      } else if (!indented && contType === 'para' && sticky(SETEXT, s, fns)) {
        tip = null;
        return;
      } else if (!indented && (brk ??= breakTest(s))(fns)) {
        opens('block');
        hold();
        return;
      } else if (!indented && depth < 100 && (k = sticky(FOOTNOTE, s, fns))) {
        opens('block');
        advance(fns + k[0].length - offset, false);
        const record = { kind: 'footnote', line: line + 1, from: line, to: line };
        definitions.push({ label: k[1].toLowerCase(), record });
        push({ type: 'footnote', record });
      } else if (indent < 4 && depth < 100 && (k = listMarker(s, fns, contType === 'para'))) {
        opens('block');
        const markerOffset = indent;
        advance(fns + k - offset, false);
        const [saveOffset, saveColumn, saveTab] = [offset, column, pct];
        while (column - saveColumn <= 5 && (s[offset] === ' ' || s[offset] === '\t')) advance(1, true);
        const spaces = column - saveColumn;
        let padding = k + spaces;
        if (spaces >= 5 || spaces < 1 || s[offset] === '\n') {
          padding = k + 1;
          [offset, column, pct] = [saveOffset, saveColumn, saveTab];
          if (spaces > 0) advance(1, true);
        }
        push({ type: 'item', need: markerOffset + padding, held: false });
      } else if (indented && !maybeLazy && !blank) {
        opens('indented');
        hold();
        tip = { type: 'indented', record: { kind: 'indented', line: line + 1 } };
        hide(tip.record);
        return;
      } else if (!indented && contType === 'para') {
        const header = tip.lastLine;
        const result = tableHeader();
        outcome[header] ??= result;
        if (result !== true) break;
        return;
      } else if (!indented && contType === 'table') {
        // A table takes every line it can read a cell in, and no lazy line; past half a million
        // cells it would have to fill in, GitHub ends it.
        if (blank || tip.cols * tip.rows - tip.nonEmpty > 0x80000) break;
        tip.rows += 1;
        tip.nonEmpty += Math.min(rowCells(s.slice(fns, -1)), tip.cols);
        wasRowOf[line] = tip.line;
        if (segs[line] === 1) rowOf[line] = tip.line;
        noteRefs(s.slice(fns, -1));
        return;
      } else {
        break;
      }
      contType = stack[stack.length - 1].type;
      maybeLazy = false;
    }
    // add_text_to_container. A paragraph runs on below the containers a line does not reach,
    // keeping what is left of the line as it stands, and a header and delimiter row there are its text.
    if (!opened && tip?.type === 'para' && m < stack.length && !blank) {
      if (outcome[tip.lastLine] === null && delimiterCells(s.slice(fns, -1)) > 0) {
        outcome[tip.lastLine] = { why: stack[m].type === 'quote' ? 'quote' : 'lazy' };
      }
      addPara(pct ? ' '.repeat(4 - (column % 4)) + s.slice(offset + 1, -1) : s.slice(offset, -1));
      return;
    }
    if (!opened) {
      if (tip && !tipMatched) closeTip(m < stack.length ? 'outside' : blank ? 'blank' : null);
      popTo(m);
    }
    if (tip?.type === 'fence' || tip?.type === 'indented') {
      hide(tip.record);
      return;
    }
    if (tip?.type === 'html') {
      hide(tip.record);
      if (tip.htmlType === 2) tip.commentOpen = commentOpenAfter(s.slice(fns, -1), tip.commentOpen);
      if (htmlEnds(tip.htmlType, s, fns)) {
        // GitHub ends the block at the line holding `-->`; a `<!--` after it reopens the comment in
        // the browser, which hides the lines below to the next `-->`.
        if (tip.commentOpen) rawComment = tip.record;
        tip = null;
      }
      return;
    }
    if (blank) return;
    if (tip?.type === 'table') closeTip(null);
    if (tip?.type === 'para') {
      if (indent >= 4 && outcome[tip.lastLine] === null && delimiterCells(s.slice(fns, -1)) > 0) {
        outcome[tip.lastLine] = { why: 'indented' };
      }
      addPara(s.slice(fns, -1));
      return;
    }
    hold();
    tip = { type: 'para', last: '', lastLine: line, overflow: false, visited: false };
    addPara(s.slice(fns, -1));
  };
  for (line = 0; line < n && !stopped; line += 1) {
    const parts = lines[line].split('\r');
    if (line === n - 1 && parts[parts.length - 1] === '') parts.pop();
    segs[line] = parts.length;
    if (rawComment) {
      at[line] = rawComment;
      if (!commentOpenAfter(lines[line], true)) rawComment = null;
    }
    // A carriage return alone ends the line on GitHub, and the kit reads what follows it as one line (F-D).
    if (tip?.type === 'table' && parts.length > 1) endWhy[line] = 'cr';
    for (let k = 0; k < parts.length && !stopped; k += 1) {
      segment(parts[k].replace(/\0/g, '\uFFFD'), line === 0 && k === 0);
      prevLine = line;
    }
  }
  if (!stopped) {
    const inFootnote = stack.some((c) => c.type === 'footnote');
    if (tip?.type === 'fence' && stack.length === 0) open = tip.record;
    else if (tip?.type === 'html' && tip.htmlType === 2 && !inFootnote) open = tip.record;
    else if (rawComment) open = rawComment;
  }
  popTo(0);
  // GitHub drops a footnote definition nothing refers to, and every line of it with it (F-C).
  for (const { label, record } of definitions) {
    if (refs.has(label)) continue;
    for (let k = record.from; k <= record.to; k += 1) at[k] = record;
  }
  const heads = outcome.map((result, i) => {
    if (segs[i] > 1 || segs[i + 1] > 1) return { why: 'cr' };
    if (wasRowOf[i] >= 0) return { why: 'row', table: wasRowOf[i] + 1 };
    return result ?? { why: 'paragraph' };
  });
  return { at, open, heads, rowOf, segs, endWhy };
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
 * The cells of line `i` when it heads a table with `header`'s columns - a row of pipes over a
 * separator - else null. The reader's header search and the writer's refusal (`tableHidden`) ask
 * it alike. A header is recognised by its COLUMN SET, not by its first cell alone. Matching on
 * the first cell missed any table whose columns had been reordered - the reader then silently
 * found no table at all, and the writer, asking the same question, inserted its row above the
 * document's title.
 */
function headerAt(lines, i, header) {
  if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1] ?? '')) return null;
  const cells = splitRow(lines[i]);
  const names = cells.map((name) => name.trim().toLowerCase());
  const want = new Set(header.map((name) => name.trim().toLowerCase()));
  const sameLead = names[0] === header[0].trim().toLowerCase();
  const sameSet = names.length === want.size && names.every((name) => want.has(name)) && new Set(names).size === names.length;
  return sameLead || sameSet ? cells : null;
}

// Why GitHub makes no table of a header over a delimiter row (`hiddenLines`'s `heads`): the reason,
// then the remedy. The reader names it, and the writer refuses beside its rows, in the same words.
const NOT_A_TABLE = {
  lazy: ["its header and delimiter row stand below a list item's paragraph with less indentation than the item's content, so GitHub reads them as more of that paragraph",
    "indent the table to the item's content, or put a blank line above it"],
  quote: ["its header and delimiter row stand below a block quote's paragraph without the quote's `>`, so GitHub reads them as more of that paragraph",
    'start each line with `>`, or put a blank line above it'],
  indented: ["its delimiter row is indented 4 or more spaces past the header, so GitHub reads it as more of the header's paragraph",
    'indent the delimiter row as the header is'],
  separator: ['GitHub does not read the delimiter row: each cell is dashes, with an optional colon at either end, between pipes',
    'write it as |---|---|'],
  visited: ['an earlier delimiter row in the same paragraph had another cell count, and GitHub then makes no table of that paragraph',
    'put a blank line above the header'],
  cr: ['the header or the delimiter row holds a carriage return alone, which GitHub reads as a line end',
    'remove the carriage return'],
  paragraph: ['GitHub does not read it as a table', 'put a blank line above the header'],
};

function notATable(why) {
  if (why.why === 'cells') return [`its delimiter row has ${why.delimiter} cells and the header ${why.header}`, 'give the delimiter row one cell per column'];
  if (why.why === 'row') {
    return [`its header stands straight below the rows of another table (line ${why.table}), so GitHub reads it as one more row of that table`,
      'put a blank line above the header'];
  }
  return NOT_A_TABLE[why.why] ?? NOT_A_TABLE.paragraph;
}

/**
 * Parse the first markdown table whose header starts with `header[0]`, or holds exactly its
 * columns, that GitHub shows as a table: outside the blocks `hiddenLines` finds hiding it, over a
 * delimiter row GitHub reads, and with the rows GitHub gives it. Where no such table is found, a
 * header GitHub makes none of is named, once, with the reason. Returns `{ header, rows, problems,
 * found, line }`; `line` is the header's 1-based line, and every row carries its own.
 */
export function parseTable(text, header) {
  const out = { header: [...header], rows: [], problems: [], found: false, line: 0 };
  if (!text) return out;
  const lines = String(text).split(/\r?\n/);
  // A table in a code block or an HTML comment is shown as code or hidden, so it is not the table.
  // An archived CLOSED copy of the unknowns table commented out above the live one was read in its
  // place, and the live table's OPEN unknown passed the gate (independent audit 2026-11-04, F01).
  // Nor is a header GitHub makes no table of: it was read with its rows wherever it stood
  // (re-review of #441, 2026-11-07).
  const read = hiddenLines(lines);
  const hidden = read.at;
  let start = -1;
  let refused = -1;
  let cut = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const cells = headerAt(lines, i, header);
    if (!cells) continue;
    if (hidden[i]) {
      // A header a cut-off comment hides is named: the first below the cut, which GitHub would
      // show once the comment is closed, before one the comment was written to hide.
      const runaway = read.open?.runaway;
      if (runaway && hidden[i] === read.open && (cut < 0 || (cut + 1 < runaway && i + 1 >= runaway))) cut = i;
      continue;
    }
    if (read.heads[i] !== true) {
      if (refused < 0) refused = i;
      continue;
    }
    start = i;
    out.header = cells;
    out.found = true;
    out.line = i + 1;
    break;
  }
  if (start < 0) {
    // No table is read, so no check reads a row: the header that is not one is named, with why.
    const named = refused >= 0 ? refused : cut;
    if (named < 0) return out;
    const head = lines[named].trim();
    const [reason, remedy] = refused >= 0 ? notATable(read.heads[named]) : [];
    out.problems.push({
      kind: 'table-split',
      line: named + 1,
      detail: refused >= 0
        ? `\`${head.slice(0, 40)}\` heads no table on GitHub: ${reason} - ${remedy}`
        : `\`${head.slice(0, 40)}\` is hidden on GitHub: an HTML comment that starts at line ${read.open.line} is cut off `
          + `at line ${read.open.runaway}, where the block holding it ends, and GitHub leaves it open to the end of the file, `
          + 'so no check reads the table - close the comment inside its block',
      text: head,
    });
    return out;
  }

  // GFM makes a row's outer pipes optional, so `E-03 | ... |` straight below a row renders as
  // the next row on GitHub. It ended the table here, and every later row was named as standing
  // after a blank line that was not there (#331). A line GitHub reads as a row of this table
  // (`rowOf`) that holds a `|` and splits to the header's cells is a row; one that starts a block
  // of its own is not, below the table either; the header and separator are still found by their
  // pipes, since the scaffold writes them that way.
  const startsBlock = (text) => /^(#{1,6}\s|>|`{3}|~{3}|<|[-*+]\s|\d{1,9}[.)]\s)/.test(text);
  const pipeBearing = (text) => text !== '' && !startsBlock(text) && !isSeparator(text) && /(^|[^\\])\|/.test(text);
  const rowShaped = (text) => text.startsWith('|') || (pipeBearing(text) && splitRow(text).length === out.header.length);
  let end = lines.length;
  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (read.rowOf[i] !== start || !rowShaped(line.trim())) { end = i; break; }
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
  // The line the table ended at is named once when it is what GitHub still shows in the table and
  // the reader stopped at - a pipe-bearing line that splits to the wrong number of cells - or a
  // row GitHub shows apart from it, with why; the rows run on below it are its consequence, not
  // each a finding of their own.
  const endedBy = lines[end]?.trim() ?? '';
  const why = read.endWhy[end] ?? null;
  const endId = splitRow(endedBy)[0] || endedBy.slice(0, 40);
  let named = '';
  if (pipeBearing(endedBy) && !rowShaped(endedBy)) {
    named = `\`${endedBy.slice(0, 40)}\` does not start with |, and splits to ${splitRow(endedBy).length} cells, not the header's `
      + `${out.header.length}, so the table ended there and no check reads the rows below it - `
      + 'add the leading pipe if it is a row, or a blank line above it if it is prose';
  } else if (rowShaped(endedBy) && why === 'outside' && !isSeparator(lines[end + 1] ?? '')) {
    named = `row \`${endId}\` stands at a column where the list item or footnote holding the table ends, so GitHub shows it `
      + 'outside the table and no check reads it - indent it as the rows above it are';
  } else if (rowShaped(endedBy) && why === 'cr') {
    named = `row \`${endId}\` holds a carriage return alone, which GitHub reads as a line end, so no check reads it or the `
      + 'rows below it - remove the carriage return';
  } else if (rowShaped(endedBy) && why === 'indented') {
    named = `row \`${endId}\` is indented 4 or more spaces past the table, so GitHub shows it as code and no check reads it - `
      + 'indent it as the rows above it are';
  } else if (endedBy.startsWith('|') && why === null && rowCells(endedBy) === 0) {
    named = `row \`${endId}\` holds no cell, so GitHub ends the table there and no check reads the rows below it - `
      + 'remove the line, or put a cell in it';
  }
  if (named) out.problems.push({ kind: 'table-split', line: end + 1, detail: named, text: endedBy });
  // The table ends at the first line that is not a row - a blank line, as GFM renders it. A
  // row-shaped line AFTER that end, in the same section, is a row somebody wrote into the table
  // that no reader of the table will see: GitHub shows it as prose, and until 2026-10-03 this
  // parser dropped it in silence - a blocking unknown written below a blank line left the gate,
  // which printed PASS (gap audit, rank 1). The row stays out of the table, as it is rendered,
  // and is RECORDED. The scan runs to the end of the table's section: a heading of the same or
  // a higher level than the one above the table (a deeper `###` note does not end the section,
  // and `#tag` prose is not a heading). A code block or an HTML comment is skipped, as GitHub
  // renders a row there as code or hides it (`hiddenLines`); a lone separator is not a row; a header
  // followed by its separator starts another table and is not a stray row, and a header whose
  // separator is malformed is named as that, once (breaker review, 2026-10-04).
  // A heading in a code block or a comment heads no section: taken as one, `# example` in a fence
  // above the table ran the scan past the table's own section (2026-11-06).
  let level = 7;
  for (let k = start - 1; k >= 0; k -= 1) {
    if (hidden[k]) continue;
    const heading = /^(#{1,6})\s/.exec(lines[k]);
    if (heading) { level = heading[1].length; break; }
  }
  // A stray row is named with the line that ENDED the table: only a blank one is a blank line.
  // The rows run on straight below a line named above (nothing but rows between) are not named
  // again; where they end is found once, as each walking back to it took time in the square of
  // their number (F-E).
  let runEnd = end;
  while (named && runEnd + 1 < lines.length && rowShaped(lines[runEnd + 1].trim())) runEnd += 1;
  const runsOn = (k) => named !== '' && end <= k && k <= runEnd;
  let i = out.rows.length ? out.rows[out.rows.length - 1].line : start + 2;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const text = line.trim();
    // An HTML block of type 6 or 7 hides nothing: the browser shows its text, a row's with it.
    if (hidden[i] && !(hidden[i].kind === 'html' && hidden[i].type >= 6)) continue;
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading && heading[1].length <= level) break;
    // A row without its leading pipe is row-shaped here too: below a blank line it was dropped
    // in silence, and a blocking unknown with it (review of #331).
    if (!rowShaped(text) || isSeparator(line)) continue;
    const next = lines[i + 1] ?? '';
    if (isSeparator(next)) break;                                   // another table's header
    if (i === end && !named) continue;                              // it ended the table, as a block of its own
    const below = next.trim();
    const separatorLike = below.length > 1 && /^[\s:|=_~.-]*$/.test(below)
      && (text.startsWith('|') || next.includes('|'));              // `---` under prose is a heading rule
    if (!separatorLike && runsOn(i)) continue;                      // named once, at the line that ended the table
    const id = splitRow(line)[0] || text.slice(0, 40);
    out.problems.push({
      kind: 'table-split',
      line: i + 1,
      detail: separatorLike
        ? `row \`${id}\` starts a table whose separator row \`${below}\` is malformed (a separator is written |---|---|), so the table is not recognised - fix the separator`
        : endedBy === ''
          ? `row \`${id}\` stands after a blank line ended the table above it, so no check reads it - `
            + 'remove the blank line (or the row), because the table ends where the blank line is'
          : `row \`${id}\` stands after line ${end + 1} (\`${endedBy.slice(0, 40)}\`), which is not a row and ended the table above it, `
            + 'so no check reads it - move that line out of the table (or the row)',
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
 * `firecrawl scrape <url> ...`, `browser <url>` - the first argument that is an http(s) URL,
 * returned verbatim. '' when the command names none. A fetch that redirected records where the
 * bytes came from as its `url`; this is the other half of that pair, the one the plan keeps naming.
 *
 * Read as the transports' `command()` writes it: an argument holding whitespace is JSON-quoted,
 * so a quoted token is read whole and unescaped. An http(s) URL is what `new URL` parses as one,
 * the plan check's test (`planProblems`), so a spelling the URL parser strips - leading whitespace or
 * a C0 control - is read as the plan wrote it. Until 2026-11-01 the command was split on
 * whitespace first and the scheme tested on the raw text, so an asked URL holding whitespace
 * was read as no URL, or as a corrupt one, and the gate took the fetch as asking for where it
 * landed (PR #440 review r5, BR5-1 and its fix review). A token that opens a quote and is
 * not a JSON string - unterminated, or an escape JSON does not have - is no URL, whole or in
 * part, and the next token is read: no transport writes one, and the ledger hashes its entry's
 * `cmd` and the capture file whole, so one reaches a reader only through an edit the gate
 * already fails.
 */
export function requestedUrl(command) {
  for (const [token] of String(command ?? '').matchAll(/"(?:[^"\\]|\\.)*"|\S+/g)) {
    let bare = token;
    if (token.startsWith('"')) {
      try { bare = JSON.parse(token); } catch { continue; }   // not a quote command() writes: no URL
    }
    // The URL parser drops leading C0 controls and spaces and every tab and newline before it reads
    // the scheme, so this is only a fast path past the many tokens that cannot open an http(s) URL.
    if (!/^[\x00-\x20]*https?:/i.test(bare.replace(/[\t\n\r]/g, ''))) continue;
    try { if (/^https?:$/.test(new URL(bare).protocol)) return bare; } catch { /* not a URL: the next token */ }
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
  // An editor's leading BOM is outside the entries the chain hashes. Ignore it while
  // reading, as the JSON and Markdown readers do; never rewrite the evidence file.
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
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
    // `unreadable`: something stands at the path that could not be read as a file - a directory
    // in its place read as an absent file (independent audit 2026-11-04, FP-011; ADR-0199).
    evidenceFile: { present: evidenceText !== null, found: evidenceTable.found, unreadable: evidenceText === null && exists(at(PATHS.evidence)) },
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

/**
 * What an output path would write over of the corpus, as a refusal in words, or null (#330).
 *
 * `export-warc --out` and `artifact create --output` wrote wherever they were pointed - over
 * the ledger, over a cited capture, into research/raw/ - and said "wrote", exit 0; the first
 * anyone heard of it was the commit gate refusing the altered evidence. research/raw/ is the
 * collector's alone (AGENTS.md; the edit gate denies it whatever the verdict), a capture an
 * evidence row cites is evidence wherever it sits, and the corpus's own files (PATHS) are not
 * an output either: a typo had replaced the evidence table with a WARC.
 *
 * Judged for EVERY project the path touches, not only `root`: the path resolves against the
 * working folder, so `create --root nested --output research/raw/.fetches.jsonl` landed on the
 * outer project's ledger (review of #330). The candidates are `root`, the working folder when
 * it holds research/, and the folder above every `research` folder on the target's real path.
 * By real location, as `writeBytes` follows a link, and case-folded where the filesystem
 * usually folds case.
 */
const CORPUS_FILES = Object.freeze({
  discovery: 'the Discovery Contract', map: 'the subtopic map', evidence: 'the evidence table',
  sources: 'the source list', timeline: 'the timeline', brief: 'the brief', plan: 'the collection plan',
  witnesses: 'the witness log', kit: 'the kit config', overrides: 'the override log',
  gateOff: 'the gate override', audits: 'the audit folder', agents: 'the standing protocol',
  architecture: 'the architecture map', gitattributes: 'the line-ending pins',
});

export function evidenceAt(root, target, { cwd = process.cwd() } = {}) {
  const fold = process.platform === 'win32' || process.platform === 'darwin' ? (p) => p.toLowerCase() : (p) => p;
  const real = (p) => {
    let head = path.resolve(p);
    try { if (fs.lstatSync(head).isSymbolicLink()) head = path.resolve(path.dirname(head), fs.readlinkSync(head)); } catch { /* a new file */ }
    const tail = [];
    for (;;) {
      try { return path.join(fs.realpathSync.native(head), ...tail); } catch { /* not there yet: its folder */ }
      const up = path.dirname(head);
      if (up === head) return path.resolve(p);
      tail.unshift(path.basename(head));
      head = up;
    }
  };
  const same = (a, b) => fold(a) === fold(b);
  const within = (dir, abs) => { const rel = path.relative(fold(dir), fold(abs)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  const at = real(target);
  const here = real(cwd);
  const shown = within(here, at) && !same(at, here) ? relative(here, at) : path.resolve(target);

  const projects = [real(root)];
  if (isDirectory(path.join(here, 'research'))) projects.push(here);
  for (let dir = path.dirname(at); path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    if (fold(path.basename(dir)) === 'research') projects.push(path.dirname(dir));
  }
  const unique = projects.filter((dir, i) => projects.findIndex((other) => same(other, dir)) === i);
  const citing = (project) => parseTable(readText(path.join(project, ...PATHS.evidence.split('/')), ''), HEADERS.evidence).rows
    .filter((r) => { const raw = normalizeRawCell(r.Raw ?? ''); return raw && same(real(resolve(project, raw)), at); })
    .map((r) => r.ID);
  const cited = (ids) => `the capture ${ids.join(', ')} ${ids.length === 1 ? 'cites' : 'cite'}`;

  for (const project of unique) {
    const rawDir = real(resolve(project, PATHS.raw));
    if (!within(rawDir, at)) continue;
    const ids = citing(project);
    const what = same(at, real(resolve(project, PATHS.ledger))) ? 'the fetch ledger'
      : ids.length ? cited(ids)
        : same(at, rawDir) ? 'the capture folder' : `inside ${PATHS.raw}/`;
    return `${shown} is ${what}; ${PATHS.raw}/ holds fetched evidence and is written only by research.mjs. `
      + `Name a path outside ${PATHS.raw}/.`;
  }
  for (const project of unique) {
    const ids = citing(project);
    if (ids.length) return `${shown} is ${cited(ids)}; a cited capture is evidence and is written only by research.mjs. Name a path no evidence row cites.`;
  }
  for (const project of unique) {
    for (const [key, name] of Object.entries(CORPUS_FILES)) {
      const own = real(resolve(project, PATHS[key]));
      if (!within(own, at)) continue;
      return `${shown} is ${same(at, own) ? '' : 'inside '}${name} (${PATHS[key]}), one of the corpus's own files, `
        + 'which an export or a package never writes over. Name a path that is not one of the project\'s files.';
    }
  }
  return null;
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

const HIDDEN_BY = {
  fence: 'a fenced code block', comment: 'an HTML comment', indented: 'an indented code block', html: 'an HTML block',
};

/**
 * Why a row for a table with `header` cannot be written where the reader would read it, or null
 * when it can (review of #441, 2026-11-06, finding 1; ADR-0204). With a table the reader reads,
 * the row goes below its last row. With none, the writer starts a table at the end of the file,
 * which is hidden as well when the file ends inside a block never closed (`open` true): a fence, a
 * comment, or a comment cut off where the block holding it ends (`runaway`). And a table with this
 * header that GitHub does not show as one - in a block that hides it, or over a delimiter row it
 * makes no table of (`kind` 'not-a-table', with `why`) - with rows below it would be left behind
 * by the new one, which numbers its own from the first id again. A header with no rows - an
 * example, commented out - holds nothing a new table would leave behind. Returns the record from
 * `hiddenLines` (`kind`, the `line` that opened it) with `open`.
 */
export function tableHidden(text, header) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const { at, open, heads } = hiddenLines(lines);
  let held = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (!headerAt(lines, i, header)) continue;
    if (!at[i] && heads[i] === true) return null;
    const record = at[i] ?? { kind: 'not-a-table', line: i + 1, why: heads[i] };
    // Its first row: the line below the separator, in the same block, holding a cell divider.
    const row = lines[i + 2] ?? '';
    if (!held && (at[i] ? at[i + 2] === at[i] : !at[i + 2]) && !isSeparator(row) && /(^|[^\\])\|/.test(row)) held = record;
  }
  if (open) return { ...open, open: true };
  return held ? { ...held, open: false } : null;
}

function tableHiddenError(rel, hidden) {
  let detail;
  if (hidden.runaway) {
    detail = `an HTML comment that starts at line ${hidden.line} is cut off at line ${hidden.runaway}, where the block `
      + 'holding it ends, and GitHub leaves it open to the end of the file, so a table below it is not read, and a row '
      + 'written at its end would be hidden too. Close the comment inside its block, then run again.';
  } else if (hidden.kind === 'not-a-table') {
    const [reason, remedy] = notATable(hidden.why);
    detail = `the table at line ${hidden.line} is not a table on GitHub: ${reason}. No check reads its rows, and a new `
      + 'table would leave them behind and number its own from the first id again. '
      + `${remedy[0].toUpperCase()}${remedy.slice(1)}, then run again.`;
  } else {
    const block = hidden.kind === 'footnote'
      ? `a footnote definition that starts at line ${hidden.line} and that nothing refers to`
      : `${HIDDEN_BY[hidden.kind]} that starts at line ${hidden.line}`;
    detail = hidden.open
      ? `the file ends inside ${block} and is never closed, so a table in it is not read, and a row written at its end `
        + 'would be hidden too. Close the block where it should end, then run again.'
      : `its table stands inside ${block}, which GitHub does not show as a table, so no check reads its rows, and a `
        + 'new table would leave them behind and number its own from the first id again. Move the table out of the '
        + 'block, then run again.';
  }
  const err = new Error(`refusing to write to ${rel}: ${detail}`);
  err.code = 'TABLE_HIDDEN';
  return err;
}

/**
 * Refuses, before a collection spends anything, when a row it records would be written where no
 * reader reads it (`tableHidden`, ADR-0204): its evidence and sources tables. The writer refuses
 * too, but only after the fetch, and the capture it leaves with no row is a cache hit the next
 * run never writes a row for.
 */
export function assertTablesWritable(root) {
  for (const [rel, header] of [[PATHS.evidence, HEADERS.evidence], [PATHS.sources, HEADERS.sources]]) {
    const hidden = tableHidden(readText(resolve(root, rel), ''), header);
    if (hidden) throw tableHiddenError(rel, hidden);
  }
}

/**
 * Append one row to an artifact's table, creating the table when it is absent - and refusing,
 * with nothing written, where the row would be hidden from every reader (`tableHidden`).
 */
export function appendRow(root, rel, header, cells) {
  const file = resolve(root, rel);
  const text = readText(file, '');
  const onDisk = headerOf(text, header);
  const line = tableRow(alignToHeader(header, cells, onDisk));
  if (!onDisk) {
    // Started below a fence or a comment never closed, the table was written inside it, read by
    // nothing, and its row numbered from the first id again on every run - E-01 cited by the
    // builder, then resolved to another page once the block was closed (review of #441).
    const hidden = tableHidden(text, header);
    if (hidden) throw tableHiddenError(rel, hidden);
    const head = `${tableRow(header)}\n|${header.map(() => '---').join('|')}|\n`;
    writeText(file, `${text.trimEnd()}\n\n${head}${line}\n`.replace(/^\n+/, ''));
    return line;
  }
  const lines = text.split(/\r?\n/);
  const table = parseTable(text, header);
  // An empty table takes the row below its separator: the separator of the header the reader
  // found, so the row goes where it is read. A search of its own once looked for the canonical
  // first column, missed a reordered table and spliced the row in above the document's title;
  // then for the column the table leads with, and found an archived copy of the header in a
  // comment above the live table just as readily (independent audit 2026-11-04, F01).
  const last = table.rows.length ? table.rows[table.rows.length - 1].line - 1 : table.line;
  // The row keeps the indentation of the one it follows: a table in a list item holds only the
  // lines at its content column, and a row written at column 0 would stand outside it (ADR-0204).
  lines.splice(last + 1, 0, /^[ \t]*/.exec(lines[last])[0] + line);
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
  const row = tableRow(aligned);
  lines[found.line - 1] = /^[ \t]*/.exec(lines[found.line - 1])[0] + row;
  writeText(file, lines.join('\n'));
  return row;
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
