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

// A cell is written on one line: GitHub ends a line at a carriage return alone too, and a fetched
// title holding one split the row it was written into (re-review of 88fe19a, 2026-11-07, F1).
export function escapeCell(value) {
  return String(value ?? '').replace(/\r\n?|\n/g, ' ').replace(/\|/g, '\\|').trim();
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

// The end of a whole open or closing tag at `p` - an HTML block's (`scan_html_block_start_7`) or raw
// HTML in a paragraph's text - read left to right once: an attribute name followed by `=` must take
// a value, so no reading of it is undone. The index past its `>`, or -1; `find` finds a quote.
function htmlTagEnd(s, p, find = (c, from) => s.indexOf(c, from)) {
  const skip = (k, ok) => { while (ok(s[k])) k += 1; return k; };
  const closing = s[p + 1] === '/';
  let k = p + (closing ? 2 : 1);
  if (!/[A-Za-z]/.test(s[k] ?? '')) return -1;
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
      const end = find(quote, value + 1);
      if (end < 0) return -1;
      k = end + 1;
    } else {
      k = skip(value, UNQUOTED);
      if (k === value) return -1;
    }
  }
  k = skip(k, HTML_SPACE);
  if (!closing && s[k] === '/') k += 1;
  return s[k] === '>' ? k + 1 : -1;
}

// A whole open or closing tag alone on its line: an HTML block of type 7.
function htmlTag(s, p) {
  let k = htmlTagEnd(s, p);
  if (k < 0) return false;
  while (s[k] === ' ' || s[k] === '\t' || s[k] === '\f') k += 1;
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
// What GitHub reads otherwise than as text in a paragraph, a heading or a cell (`footnoteRefs`): ASCII
// punctuation behind a backslash, the autolinks it tries before raw HTML, and the characters a run of
// text ends before - the autolink extension's `:` and `w` among them.
const PUNCT = /[!-/:-@[-`{-~]/;
const AUTOLINK_URI = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^\x00-\x20<>]*>/y;
const AUTOLINK_EMAIL = /<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/y;
const INLINE_SPECIAL = /[\n`\\&<[\]!:w]/g;
const LIST_SPACE = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

// ---------------------------------------------------------------- GitHub's inline reading
// What cmark-gfm reads in a paragraph's, a heading's or a cell's text, as far as a footnote reference
// depends on it (inlines.c, houdini_html_u.c, references.c and the autolink extension), checked
// against `gh api markdown` on 2026-11-07 (re-review of dde656a, F-2 and F-3). A space here is one of
// the six of `cmark_isspace`, the characters of HTML_SPACE.

const trimSpace = (s) => {
  let a = 0;
  let b = s.length;
  while (a < b && HTML_SPACE(s[a])) a += 1;
  while (b > a && HTML_SPACE(s[b - 1])) b -= 1;
  return s.slice(a, b);
};
const rtrimSpace = (s) => {
  let b = s.length;
  while (b > 0 && HTML_SPACE(s[b - 1])) b -= 1;
  return s.slice(0, b);
};

// The entity names the kit decodes. GitHub decodes all of HTML5's (`houdini_unescape_ent`), so a
// label holding another name is one the kit cannot read as GitHub does.
const ENTITY = new Map([['amp', '&'], ['AMP', '&'], ['lt', '<'], ['LT', '<'], ['gt', '>'], ['GT', '>'],
  ['quot', '"'], ['QUOT', '"'], ['apos', "'"], ['nbsp', '\xA0'], ['Hat', '^']]);
const ENTITY_NAME = /^[A-Za-z][A-Za-z0-9]{1,30}$/;

/**
 * The entity reference at the `&` at `p`: `{ value, end, unknown }`, or null where GitHub reads the
 * `&` as text. A numeric one has one to eight digits, and 0, a surrogate or a number past U+10FFFF
 * reads as U+FFFD. A name the kit does not know keeps its text and is `unknown`.
 */
function entityAt(text, p) {
  if (text[p + 1] === '#') {
    const hex = text[p + 2] === 'x' || text[p + 2] === 'X';
    const digit = hex ? /[0-9A-Fa-f]/ : /[0-9]/;
    const first = p + (hex ? 3 : 2);
    let i = first;
    let code = 0;
    while (i < text.length && digit.test(text[i])) {
      code = Math.min(code * (hex ? 16 : 10) + parseInt(text[i], 16), 0x110000);
      i += 1;
    }
    if (i === first || i - first > 8 || text[i] !== ';') return null;
    if (code === 0 || (code >= 0xD800 && code < 0xE000) || code >= 0x110000) code = 0xFFFD;
    return { value: String.fromCodePoint(code), end: i + 1, unknown: false };
  }
  for (let i = p + 3; i < Math.min(text.length, p + 33); i += 1) {
    if (text[i] === ' ') return null;
    if (text[i] !== ';') continue;
    const name = text.slice(p + 1, i);
    if (ENTITY.has(name)) return { value: ENTITY.get(name), end: i + 1, unknown: false };
    return ENTITY_NAME.test(name) ? { value: text.slice(p, i + 1), end: i + 1, unknown: true } : null;
  }
  return null;
}

/**
 * A label as GitHub compares one (`normalize_map_label`): case-folded, its ends trimmed, each run of
 * spaces one space; null if nothing is left. GitHub folds by its own tables (`case_fold_switch.inc`),
 * from an older Unicode than Node's: a character in the blocks they cover (`FOLDED`) folds as
 * lowering, raising and lowering it again does, but for the dotless i, which folds to itself; any
 * other is kept as it is (G-3).
 */
const FOLDED = [
  [0xb5, 0x58f], [0x10a0, 0x10ff], [0x13a0, 0x13ff], [0x1c80, 0x1c88], [0x1e00, 0x1fff], [0x2126, 0x2183],
  [0x24b6, 0x24cf], [0x2c00, 0x2c2e], [0x2c60, 0x2cff], [0xa640, 0xa69f], [0xa722, 0xa7b7], [0xab70, 0xabbf],
  [0xfb00, 0xfb17], [0xff21, 0xff3a], [0x10400, 0x1044f], [0x104b0, 0x104ff], [0x10c80, 0x10cff], [0x118a0, 0x118ff],
  [0x1e900, 0x1e95f],
];
const NON_ASCII = /[^\x00-\x7f]/;
function foldChar(ch) {
  const code = ch.codePointAt(0);
  if (code < 0x80) return ch.toLowerCase();
  if (code === 0x131 || !FOLDED.some(([lo, hi]) => code >= lo && code <= hi)) return ch;
  return ch.toLowerCase().toUpperCase().toLowerCase();
}
function normalizeLabel(label) {
  let folded = '';
  if (!NON_ASCII.test(label)) folded = label.toLowerCase();
  else for (const ch of label) folded += foldChar(ch);
  let out = folded.replace(/[ \t\n\v\f\r]+/g, ' ');
  if (out.startsWith(' ')) out = out.slice(1);
  if (out.endsWith(' ')) out = out.slice(0, -1);
  return out === '' ? null : out;
}

// GitHub looks no label up that is empty or over 1000 bytes (`cmark_map_lookup`).
const lookable = (label) => label.length > 0 && label.length <= 1000 && Buffer.byteLength(label, 'utf8') <= 1000;
const utf8Units = (code) => (code < 0x80 ? 1 : code < 0x800 || (code >= 0xD800 && code < 0xE000) ? 2 : 3);

/**
 * The link label at `p` (`link_label`): `{ raw, end }`, the text between its brackets trimmed and the
 * index past its `]`; or null - no `[` at `p`, an unescaped `[` before the `]`, no `]`, or over 1000
 * bytes. A backslash before punctuation escapes it.
 */
function linkLabel(text, p) {
  if (text[p] !== '[') return null;
  let bytes = 0;
  let i = p + 1;
  for (; i < text.length && text[i] !== '[' && text[i] !== ']'; i += 1) {
    if (text[i] === '\\' && PUNCT.test(text[i + 1] ?? '')) {
      i += 1;
      bytes += 1;
    }
    bytes += utf8Units(text.charCodeAt(i));
    if (bytes > 1000) return null;
  }
  return text[i] === ']' ? { raw: trimSpace(text.slice(p + 1, i)), end: i + 1 } : null;
}

const spaceChars = (s, p) => {
  let k = p;
  while (k < s.length && HTML_SPACE(s[k])) k += 1;
  return k - p;
};

/**
 * The length of the link destination at `p` (`manual_scan_link_url`), or -1: between pointy
 * brackets on one line, or a run of no spaces up to a space, a line end or a `)` that no `(` in it
 * opened, with 32 `(` open at most. A `(` still open where the run ends is kept, as cmark-gfm keeps
 * it (G-4); a run that reaches the end of the text is no destination.
 */
function linkDestination(text, p) {
  let i = p;
  if (text[i] === '<') {
    for (i += 1; ; i += 1) {
      if (i >= text.length || text[i] === '\n' || text[i] === '<') return -1;
      if (text[i] === '>') break;
      if (text[i] === '\\') i += 1;
    }
    return i + 1 >= text.length ? -1 : i + 1 - p;
  }
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && PUNCT.test(text[i + 1] ?? '')) {
      i += 2;
    } else if (c === '(') {
      depth += 1;
      i += 1;
      if (depth > 32) return -1;
    } else if (c === ')') {
      if (depth === 0) break;
      depth -= 1;
      i += 1;
    } else if (HTML_SPACE(c)) {
      if (i === p) return -1;
      break;
    } else {
      i += 1;
    }
  }
  return i >= text.length ? -1 : i - p;
}

/**
 * The length of the link title at `p` (`scan_link_title`, the longest match), or 0. A quote that no
 * backslash precedes ends a quoted title, and so does a closing parenthesis a parenthesized one; one
 * a backslash precedes may end it too, where nothing later can.
 */
function linkTitle(text, p) {
  const open = text[p];
  if (open !== '"' && open !== "'" && open !== '(') return 0;
  const close = open === '(' ? ')' : open;
  let last = -1;
  for (let i = p + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c !== close && !(open === '(' && c === '(')) continue;
    const escaped = text[i - 1] === '\\';
    if (!escaped) return c === close ? i + 1 - p : last < 0 ? 0 : last + 1 - p;
    if (c === close) last = i;
  }
  return last < 0 ? 0 : last + 1 - p;
}

/** The index past the `)` of the inline link that the `(` at `p` opens, after a link text, or -1. */
function inlineLinkEnd(text, p) {
  if (text[p] !== '(') return -1;
  const urlAt = p + 1 + spaceChars(text, p + 1);
  const n = linkDestination(text, urlAt);
  if (n < 0) return -1;
  const endUrl = urlAt + n;
  const startTitle = endUrl + spaceChars(text, endUrl);
  const endTitle = startTitle === endUrl ? startTitle : startTitle + linkTitle(text, startTitle);
  const endAll = endTitle + spaceChars(text, endTitle);
  return text[endAll] === ')' ? endAll + 1 : -1;
}

const skipSpaces = (s, p) => {
  let k = p;
  while (s[k] === ' ' || s[k] === '\t') k += 1;
  return k;
};
// The index past the line end at `p` (`skip_line_end`): CR, LF or both, or `p` at the end; else -1.
function lineEnd(s, p) {
  let k = p;
  if (s[k] === '\r') k += 1;
  if (s[k] === '\n') k += 1;
  return k > p || k >= s.length ? k : -1;
}
// Spaces and tabs, with one line end among them at most (`spnl`).
function spnl(s, p) {
  const q = skipSpaces(s, p);
  const k = lineEnd(s, q);
  return k < 0 ? q : skipSpaces(s, k);
}

/**
 * The link reference definition at `p` (`cmark_parse_reference_inline`): the index past it, its
 * label added to `labels`, or 0. Its title may move to the next line; where something but spaces
 * follows it there, the definition ends before it, at its destination's line end.
 */
function refDefAt(chunk, p, labels) {
  const label = linkLabel(chunk, p);
  if (!label || label.raw === '' || chunk[label.end] !== ':') return 0;
  let pos = spnl(chunk, label.end + 1);
  const n = linkDestination(chunk, pos);
  if (n < 0) return 0;
  const beforeTitle = pos + n;
  pos = spnl(chunk, beforeTitle);
  const title = pos === beforeTitle ? 0 : linkTitle(chunk, pos);
  let end = lineEnd(chunk, skipSpaces(chunk, title ? pos + title : beforeTitle));
  if (end < 0 && title) end = lineEnd(chunk, skipSpaces(chunk, beforeTitle));
  if (end < 0) return 0;
  const key = normalizeLabel(label.raw);
  if (key !== null) labels.push(key);
  return end;
}

/**
 * The link reference definitions a paragraph's lines open with (`resolve_reference_link_definitions`):
 * `{ labels, used }`, their labels, normalized, and how many whole lines they take.
 */
function parseRefDefs(texts) {
  const chunk = `${texts.join('\n')}\n`;
  const labels = [];
  let at = 0;
  while (chunk[at] === '[') {
    const end = refDefAt(chunk, at, labels);
    if (!end) break;
    at = end;
  }
  let used = 0;
  for (let i = 0; i < at; i += 1) if (chunk[i] === '\n') used += 1;
  return { labels, used };
}

// The autolink extension (autolink.c), tried at a `:` and a `w` outside every link text.
const ALPHA = /[A-Za-z]/;

// Whether the character at `i` may stand in a host name (`is_valid_hostchar`): no space, no punctuation.
function hostCharAt(text, i) {
  const code = text.codePointAt(i);
  if (code === undefined || code === 9 || code === 10 || code === 12 || code === 13 || code === 32
    || code === 160 || code === 5760 || (code >= 8192 && code <= 8202) || code === 8239 || code === 8287
    || code === 12288) return false;
  return code < 128 ? !PUNCT.test(text[i]) : !/\p{P}/u.test(String.fromCodePoint(code));
}

/**
 * The length of the domain at `p` (`check_domain`), or 0: an underscore in one of its last two
 * labels rejects it, unless it has more than ten dots, and without `short` it needs a dot. Its first
 * character goes unchecked. GitHub reads it byte by byte, so a character past ASCII ends it.
 */
function checkDomain(text, p, short) {
  const size = text.length - p;
  let dots = 0;
  let before = 0;
  let last = 0;
  let i = 1;
  if (text.charCodeAt(p) < 0x80) {
    for (; i < size - 1; i += 1) {
      if (text[p + i] === '\\' && i < size - 2) i += 1;
      const c = text[p + i];
      if (c === '_') {
        last += 1;
      } else if (c === '.') {
        before = last;
        last = 0;
        dots += 1;
      } else if (c !== '-' && (text.charCodeAt(p + i) >= 0x80 || !hostCharAt(text, p + i))) {
        break;
      }
    }
  }
  if ((before || last) && dots <= 10) return 0;
  return short || dots ? i : 0;
}

/**
 * Where an autolink from `p` that would run to `end` ends (`autolink_delim`): before a `<`, and
 * before the punctuation it ends with - a `)` only past the parentheses it opens, and an entity's
 * `;` together with the entity.
 */
function autolinkDelim(text, p, end) {
  let opening = 0;
  let closing = 0;
  for (let i = p; i < end; i += 1) {
    if (text[i] === '<') {
      end = i;
      break;
    }
    if (text[i] === '(') opening += 1;
    else if (text[i] === ')') closing += 1;
  }
  while (end > p) {
    const c = text[end - 1];
    if (c === ')') {
      if (closing <= opening) return end;
      closing -= 1;
      end -= 1;
    } else if ('?!.,:*_~\'"'.includes(c)) {
      end -= 1;
    } else if (c === ';') {
      let k = end - 2;
      while (k > p && ALPHA.test(text[k])) k -= 1;
      end = k < end - 2 && text[k] === '&' ? k : end - 1;
    } else {
      return end;
    }
  }
  return end;
}

// The end of the URL autolink whose scheme's `:` is at `p` (`url_match`), or -1.
function urlMatch(text, p) {
  if (text.length - p < 4 || text[p + 1] !== '/' || text[p + 2] !== '/') return -1;
  let start = p;
  while (start > 0 && p - start <= 5 && ALPHA.test(text[start - 1])) start -= 1;
  const scheme = text.slice(start, p).toLowerCase();
  if ((scheme !== 'http' && scheme !== 'https' && scheme !== 'ftp') || !hostCharAt(text, p + 3)) return -1;
  const domain = checkDomain(text, p + 3, true);
  if (!domain) return -1;
  let end = p + 3 + domain;
  while (end < text.length && !HTML_SPACE(text[end]) && text[end] !== '<') end += 1;
  end = autolinkDelim(text, p, end);
  return end > p ? end : -1;
}

// The end of the www autolink at `p` (`www_match`), or -1: after a space, `*`, `_`, `~` or `(`.
function wwwMatch(text, p) {
  if (p > 0 && !'*_~('.includes(text[p - 1]) && !HTML_SPACE(text[p - 1])) return -1;
  if (!text.startsWith('www.', p)) return -1;
  const domain = checkDomain(text, p, false);
  if (!domain) return -1;
  let end = p + domain;
  while (end < text.length && !HTML_SPACE(text[end]) && text[end] !== '<') end += 1;
  end = autolinkDelim(text, p, end);
  return end > p ? end : -1;
}

const unescapePipes = (s) => s.replace(/\\\|/g, '|');

/**
 * The texts of the first `max` cells GitHub reads in one line of a table, as `rowCells` counts them:
 * each with its escaped pipes unescaped and its ends trimmed. A cell past the header's is dropped.
 */
function rowCellTexts(text, max) {
  const n = text.length;
  const cells = [];
  let i = cellEnd(text, 0);
  while (i < n && cells.length < max) {
    let j = i;
    while (j < n && (text[j] !== '|' || (j > i && text[j - 1] === '\\'))) j += 1;
    const pipe = cellEnd(text, j);
    if (j > i || pipe) cells.push(trimSpace(unescapePipes(text.slice(i, j))));
    i = j + pipe;
    if (!pipe) break;
  }
  return cells;
}

/**
 * The text of the ATX heading in the line `s` whose marker ends at `from` (`chop_trailing_hashtags`):
 * a closing run of number signs goes where a space or a tab precedes it.
 */
function atxContent(s, from) {
  const line = rtrimSpace(s.slice(0, -1));
  let end = line.length;
  let k = end;
  while (k > 0 && line[k - 1] === '#') k -= 1;
  if (k < end && k > 0 && (line[k - 1] === ' ' || line[k - 1] === '\t')) end = rtrimSpace(line.slice(0, k)).length;
  return from < end ? line.slice(from, end) : '';
}

/**
 * The footnote references GitHub reads in `source`, a paragraph's, a heading's or a cell's text, in
 * the order it reads them (`parse_inline`, `handle_close_bracket`): `{ label, start, raw, unknown }` -
 * the label as GitHub compares it, before it is normalized; the index of its `[` and its text as
 * written; and the first entity in its label whose name the kit does not know, or null. GitHub makes
 * a reference of a bracketed text whose first text starts with `^` where it makes no link of it: no
 * `(` opening an inline link follows it, and no label that `refmap` holds (the link reference
 * definitions' labels, normalized). Its label is its text up to the first thing in it that is not
 * text. Not in a code span, an autolink or raw HTML; a link's text keeps the references in it.
 *
 * Given `spans`, the raw HTML GitHub writes as it stands is added to it, `{ start, end }` in `source`:
 * in a link's text too, but not in an image's, which GitHub writes escaped, nor in a reference's
 * brackets, which it drops (G-1).
 */
function footnoteRefs(source, refmap, spans = null) {
  const refsPossible = source.includes('[') && (source.includes('^') || source.includes('&#') || source.includes('&Hat;'));
  if (!refsPossible && !(spans && source.includes('<'))) return [];
  const text = rtrimSpace(source);
  // A code span closes at the next run of exactly its opener's backticks; a run over 1000 closes none.
  const runs = new Map();
  const passed = new Map();
  for (let p = text.indexOf('`'); p >= 0;) {
    let q = p + 1;
    while (text[q] === '`') q += 1;
    if (q - p <= 1000 && runs.has(q - p)) runs.get(q - p).push(p);
    else if (q - p <= 1000) runs.set(q - p, [p]);
    p = text.indexOf('`', q);
  }
  const closer = (length, from) => {
    const list = runs.get(length) ?? [];
    let i = passed.get(length) ?? 0;
    while (i < list.length && list[i] < from) i += 1;
    passed.set(length, i);
    return i < list.length ? list[i] : -1;
  };
  // What was looked for once is not looked for again: a quote's next place, a marker not there.
  const quotes = new Map();
  const find = (c, from) => {
    const held = quotes.get(c);
    if (held && held.from <= from && (held.found < 0 || held.found >= from)) return held.found;
    const found = text.indexOf(c, from);
    quotes.set(c, { from, found });
    return found;
  };
  const absent = new Set();
  const through = (marker, from) => {
    const end = absent.has(marker) ? -1 : text.indexOf(marker, from);
    if (end < 0) absent.add(marker);
    return end < 0 ? -1 : end + marker.length;
  };
  // The end of an autolink at the `<` at `p` (`handle_pointy_brace`), or -1; and of raw HTML there - a
  // comment, CDATA, a declaration (`<!`, capitals, then a space), a processing instruction or a tag.
  const autolinkAt = (p) => {
    for (const autolink of [AUTOLINK_URI, AUTOLINK_EMAIL]) if (sticky(autolink, text, p)) return autolink.lastIndex;
    return -1;
  };
  const rawHtmlAt = (p) => {
    if (text.startsWith('<!--', p)) return text[p + 4] === '>' ? p + 5 : text.startsWith('->', p + 4) ? p + 6 : through('-->', p + 4);
    if (text.startsWith('<![CDATA[', p)) return through(']]>', p + 9);
    if (text[p + 1] === '!') {
      let k = p + 2;
      while (/[A-Z]/.test(text[k] ?? '')) k += 1;
      return k > p + 2 && HTML_SPACE(text[k]) ? through('>', k + 1) : -1;
    }
    if (text[p + 1] === '?') return through('?>', p + 2);
    return htmlTagEnd(text, p, find);
  };
  // The nodes GitHub makes, as far as a label depends on them: text (`v`, with the name of an entity
  // the kit does not know), a link or an image (`kids`), a reference, and the rest. While no bracket
  // is open only links and references are kept. Once a link is made, a bracket that opens no image
  // closes as text until another one opens (`no_link_openers`), so one below the link that a later
  // bracket followed may still make a link or a reference (G-2). Each bracket notes how many `spans`
  // were found before it.
  const OTHER = { t: 'other' };
  const nodes = [];
  const stack = [];
  let noLinkOpeners = false;
  const keep = (node) => { if (stack.length) nodes.push(node); };
  const textNode = (v, unknown = null) => keep({ t: 'text', v, unknown });
  for (let p = 0; p < text.length;) {
    const c = text[p];
    if (c === '\n') {
      keep(OTHER);
      p = skipSpaces(text, p + 1);
    } else if (c === '`') {
      let q = p + 1;
      while (text[q] === '`') q += 1;
      const end = q - p <= 1000 ? closer(q - p, q) : -1;
      if (end < 0) textNode(text.slice(p, q));
      else keep(OTHER);
      p = end < 0 ? q : end + (q - p);
    } else if (c === '\\') {
      const next = text[p + 1] ?? '';
      if (PUNCT.test(next)) textNode(next);
      else if (next === '\n') keep(OTHER);
      else textNode('\\');
      p += PUNCT.test(next) || next === '\n' ? 2 : 1;
    } else if (c === '&') {
      const entity = entityAt(text, p);
      textNode(entity ? entity.value : '&', entity?.unknown ? entity.value : null);
      p = entity ? entity.end : p + 1;
    } else if (c === '<') {
      const auto = autolinkAt(p);
      const end = auto >= 0 ? auto : rawHtmlAt(p);
      if (end < 0) textNode('<');
      else keep(OTHER);
      if (auto < 0 && end >= 0 && spans) spans.push({ start: p, end });
      p = end < 0 ? p + 1 : end;
    } else if (c === '[' || (c === '!' && text[p + 1] === '[' && text[p + 2] !== '^')) {
      const image = c === '!';
      if (stack.length) stack[stack.length - 1].bracketAfter = true;
      if (!image) noLinkOpeners = false;
      stack.push({ at: nodes.length, start: image ? p + 1 : p, pos: image ? p + 2 : p + 1, image, bracketAfter: false, spans: spans ? spans.length : 0 });
      nodes.push({ t: 'text', v: image ? '![' : '[', unknown: null });
      p += image ? 2 : 1;
    } else if (c === ']') {
      const initial = p + 1;
      p = initial;
      const opener = stack[stack.length - 1];
      if (!opener) continue;
      if (!opener.image && noLinkOpeners) {
        stack.pop();
        textNode(']');
        continue;
      }
      // A link: inline, or by the label after it or, where none follows, its own text, defined.
      let after = inlineLinkEnd(text, initial);
      if (after < 0 && refmap.size) {
        const label = linkLabel(text, initial);
        const own = !opener.bracketAfter && initial - 1 - opener.pos <= 1000 ? text.slice(opener.pos, initial - 1) : '';
        const raw = label?.raw || own;
        if (lookable(raw) && refmap.has(normalizeLabel(raw))) after = label ? label.end : initial;
      }
      if (after >= 0) {
        const kids = nodes.splice(opener.at).slice(1);
        stack.pop();
        if (!opener.image) noLinkOpeners = true;
        else if (spans) spans.length = opener.spans;
        nodes.push({ t: 'link', kids });
        p = after;
        continue;
      }
      // A reference takes in what its brackets hold, references too.
      const first = nodes[opener.at + 1];
      if (first?.t === 'text' && first.v[0] === '^' && (first.v.length > 1 || nodes.length > opener.at + 2)) {
        let label = first.v.slice(1);
        let unknown = null;
        for (let k = opener.at + 2; k < nodes.length && nodes[k].t === 'text'; k += 1) {
          label += nodes[k].v;
          unknown ??= nodes[k].unknown;
        }
        nodes.length = opener.at;
        stack.pop();
        if (spans) spans.length = opener.spans;
        nodes.push({ t: 'fn', label, start: opener.start, raw: text.slice(opener.start, initial), unknown });
        continue;
      }
      stack.pop();
      textNode(']');
    } else {
      // A run of text; at a `:` or a `w` outside every bracket, an autolink first (autolink.c).
      const link = stack.length ? -1 : c === ':' ? urlMatch(text, p) : c === 'w' ? wwwMatch(text, p) : -1;
      if (link >= 0) {
        p = link;
        continue;
      }
      INLINE_SPECIAL.lastIndex = p + 1;
      const next = INLINE_SPECIAL.exec(text)?.index ?? text.length;
      if (stack.length) textNode(text[next] === '\n' ? rtrimSpace(text.slice(p, next)) : text.slice(p, next));
      p = next;
    }
  }
  const found = [];
  const walk = [[nodes, 0]];
  while (walk.length) {
    const frame = walk[walk.length - 1];
    if (frame[1] >= frame[0].length) {
      walk.pop();
      continue;
    }
    const node = frame[0][frame[1]++];
    if (node.t === 'fn') found.push(node);
    else if (node.t === 'link') walk.push([node.kids, 0]);
  }
  return found;
}

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

// The tags GitHub's tagfilter writes out as text (`&lt;`), as GFM names them.
const FILTERED = /<\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?:[ \t\n\v\f\r>]|\/>)/iy;
const HTML_WHITE = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

// The name of the tag that starts at `p`, as the browser reads one: up to a space, a `/` or a `>`.
const tagName = (text, p) => {
  let e = p;
  while (e < text.length && !HTML_WHITE(text[e]) && text[e] !== '/' && text[e] !== '>') e += 1;
  return text.slice(p, e).toLowerCase();
};

/**
 * Reads `text`, an HTML block's line as GitHub writes it out or a line of raw HTML in a paragraph's,
 * with the browser's tokenizer, from the state `owner` holds: GitHub's page is one HTML document, so
 * a comment or a tag left open where an HTML block ends goes on in the browser over what follows it,
 * whatever CommonMark ended. State 0 is text; 1 a comment, closed by `-->` or `--!>`; 2 a bogus
 * comment (`<!`, `<?`, `</` and no letter), closed by `>`; 3 a tag name; 7 before an attribute; 8 an
 * attribute's name; 6 before its value; 4 and 5 a value quoted with `"` or `'`; 9 one unquoted.
 * `<!-->` and `<!--->` close as they open; a tag the tagfilter writes out as text opens nothing.
 * `owner.since` is the 1-based line of the `<` that left text; back in text, `owner.record` is
 * cleared. `owner.select` is the 1-based line of a `<select>` the browser is in, which drops the tags
 * GitHub writes after it, a table's too, until `</select>`, another `<select>`, an `<input>` or a
 * `<keygen>` closes it (G-5) - or 0. Each marker's next place is kept, so a line is read in linear time.
 */
function feedHtml(owner, text, line) {
  let { state } = owner;
  const leave = (next) => {
    if (state === 0 && next !== 0) owner.since = line + 1;
    if (next === 0) owner.record = null;
    state = next;
  };
  const found = new Map();
  const next = (marker, from) => {
    let place = found.get(marker);
    if (place === undefined || (place >= 0 && place < from)) found.set(marker, (place = text.indexOf(marker, from)));
    return place;
  };
  for (let i = 0; i < text.length; i += 1) {
    if (state === 1) {
      const a = next('-->', i);
      const b = next('--!>', i);
      if (a < 0 && b < 0) break;
      i = a >= 0 && (b < 0 || a < b) ? a + 2 : b + 3;
      leave(0);
    } else if (state === 2) {
      const k = text.indexOf('>', i);
      if (k < 0) break;
      i = k;
      leave(0);
    } else if (state === 0) {
      const k = text.indexOf('<', i);
      if (k < 0) break;
      i = k;
      if (sticky(FILTERED, text, k)) continue;
      const c = text[k + 1] ?? '';
      if (text.startsWith('<!--', k)) {
        if (text[k + 4] === '>') i = k + 4;
        else if (text.startsWith('->', k + 4)) i = k + 5;
        else { leave(1); i = k + 3; }
      } else if (c === '!' || c === '?') {
        leave(2);
        i = k + 1;
      } else if (c === '/') {
        const d = text[k + 2] ?? '';
        if (/[A-Za-z]/.test(d)) {
          if (tagName(text, k + 2) === 'select') owner.select = 0;
          leave(3);
          i = k + 2;
        } else if (d === '>') i = k + 2;
        else { leave(2); i = k + 1; }
      } else if (/[A-Za-z]/.test(c)) {
        const name = tagName(text, k + 1);
        if (name === 'select') owner.select = owner.select ? 0 : line + 1;
        else if (name === 'input' || name === 'keygen') owner.select = 0;
        leave(3);
        i = k + 1;
      }
    } else {
      const c = text[i];
      const white = HTML_WHITE(c);
      if (c === '>' && state !== 4 && state !== 5) leave(0);
      else if (state === 3) { if (white || c === '/') state = 7; }
      else if (state === 7) { if (!white && c !== '/') state = 8; }
      else if (state === 8) { if (c === '/') state = 7; else if (c === '=') state = 6; }
      else if (state === 6) { if (c === '"') state = 4; else if (c === "'") state = 5; else if (!white) state = 9; }
      else if (state === 4) { if (c === '"') state = 7; }
      else if (state === 5) { if (c === "'") state = 7; }
      else if (white) state = 7;
    }
  }
  owner.state = state;
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
 * An HTML block's lines are read with the browser's tokenizer (`feedHtml`), one for the body and one
 * for each footnote definition, which GitHub writes below the body in its own place: a comment or a
 * tag one leaves open where its block ends hides what that owner reads after it. GitHub writes the
 * other blocks there as HTML the kit does not read, and may close it earlier (`doubtOf`). The
 * footnote references are read once every link reference definition is known (`refmap`).
 *
 * Returns `{ at, open, heads, rowOf, segs, endWhy, note, tables, uncertain, doubtOf, endUnsure }`, the
 * first six and `note` indexed by the 0-based line:
 * - `at[i]` the record of the block that hides line i - `kind` 'fence', 'indented', 'comment',
 *   'tag', 'html' (with its `type`) or 'footnote' (a definition nothing refers to, or one that
 *   `repeats` the label of the one GitHub keeps, its 1-based line), and the 1-based `line` that
 *   opened it - or null. Lines of one block share its record. A comment reopened by a `<!--` after
 *   the `-->` that ended its HTML block carries `reopened`, the 1-based line of that `-->`. A tag
 *   carries `first`, the 0-based line of the paragraph GitHub writes first after it, or -1 for any
 *   other block or a container's end; a comment, `closer`, the 0-based line of the first line it
 *   hides with a `-->` past a `<` (`lt`, a `<` on an earlier one). A comment or a tag the body leaves
 *   open hides the footnotes too, which GitHub shows below the body; one a footnote definition
 *   leaves open - cut off or never closed - carries `footnote`, the 1-based line of that
 *   definition, and hides the rest of it and the definitions GitHub shows after it.
 * - `open` the record of a block the body ends inside, which takes in whatever is written at the
 *   end of the file: a fence, an HTML block of type 1 or 3 to 5 (`<pre>`, `<script>`, `<style>`,
 *   `<textarea>`, `<?`, `<!X`, `<![CDATA[`), a comment or a tag left open, a reopened comment, or a
 *   comment cut off where the block holding it ends (`runaway`, the 1-based line of the cut), which
 *   GitHub leaves open to the end of the file.
 * - `heads[i]` true if GitHub makes a table of the header at line i, else why not (`{ why }`, and
 *   `under`, the container a lazy line stood below).
 * - `rowOf[i]` the 0-based header line of the table line i is a row of, else -1.
 * - `segs[i]` how many lines GitHub reads in line i; `endWhy[i]` why a table ended at line i.
 * - `note[i]` the record of the innermost footnote definition holding line i that something refers
 *   to, with `order`, its place among the footnotes GitHub shows below the body - or null.
 * - `tables` every table GitHub makes, in file order: `line`, the 0-based line of its header;
 *   `gline`, the 1-based line of it as GitHub counts them, a carriage return alone ending one too;
 *   `text`, the header as GitHub read it, past the markers of the blocks holding it; and `cr`,
 *   whether a carriage return alone ends a line in its header or delimiter row.
 * - `uncertain` the first footnote reference whose label holds an entity name the kit cannot decode
 *   (`ENTITY`) - its 1-based `line`, the `ref` as written and the entity's `name` - or null.
 * - `doubtOf(i)` for a line i that a tag or a comment hides, `{ record, closer }` if GitHub may show
 *   it - a tag unless line i is the paragraph GitHub writes first after it (`first`); a comment once
 *   a `-->` GitHub writes after its start and before line i may close it: its `closer`, or, for a
 *   line i in a footnote, a `-->` in a footnote (`sooner`) - else null. `closer` is the 0-based line
 *   of that `-->`, -1 for a tag. Before all that, for a line i shown, or hidden by a tag or a comment,
 *   after an HTML block that starts where GitHub may already have closed what an earlier one left open
 *   (`record`), and that the browser, reading it from text, leaves otherwise than the kit - later in
 *   its owner, or in a footnote GitHub shows after it - `{ record, closer: -1, after }`, `after` the
 *   block's 1-based line. So too after raw HTML GitHub writes as it stands in a paragraph, a heading
 *   or a cell that leaves the browser in a comment or a quoted value (`why` 'inline'), or a `<select>`
 *   left open where its block ends (`why` 'select'), and in the table that cell is in: `record` is
 *   then `{ kind, line, inline }` or `{ kind: 'tag', line, select }`, and `after` its line (G-1, G-5).
 * - `endUnsure` the first of those that leaves the body in doubt, `{ record, line, why }`, so the end
 *   of the file and a table written there too - or null.
 */
export function hiddenLines(lines) {
  const n = lines.length;
  const at = new Array(n).fill(null);
  const note = new Array(n).fill(null);
  const rowOf = new Array(n).fill(-1);
  const wasRowOf = new Array(n).fill(-1);
  const segs = new Array(n).fill(0);
  const endWhy = new Array(n).fill(null);
  const outcome = new Array(n).fill(null);
  // The lines read after an HTML block the browser may read otherwise than the kit (`alt`): what it
  // leaves open there, no check can judge (`doubtOf`).
  const unsure = new Array(n).fill(null);
  // Containers, outermost first: { type: 'quote' }, { type: 'item', need, held } and
  // { type: 'footnote', label, record }. A line with nothing on it ends the quotes and the items
  // that hold nothing yet; past its spaces, the footnotes too. Their indexes are kept so that such
  // a line is read without walking every container (F-E).
  const stack = [];
  const stopsEmpty = [];
  const stopsZero = [];
  const definitions = [];
  // The footnote labels something refers to, in the order GitHub first meets them; the labels of the
  // link reference definitions, which GitHub knows in the whole file before it reads any text; and
  // the texts it reads then, each with the line every one of its lines stands at (`closePara`).
  const refs = new Set();
  const refmap = new Set();
  const pending = [];
  let tip = null;
  let open = null;
  // The footnote definitions open, outermost first; the comments and tags they leave open, cut off or
  // never closed (`{ record, owner, from }`); and the tables GitHub makes (`{ line, gline, text, cr }`).
  const footnotes = [];
  const events = [];
  const tables = [];
  // The browser's tokenizer state over the raw HTML GitHub writes out (`feedHtml`), one for the body
  // and one for each footnote definition, which GitHub writes below the body, each in its own place:
  // `state`, `since` (the 1-based line it left text at) and, once the HTML block it was left open in
  // has ended, `record`, which hides what follows. The innermost definition open owns the line. Over
  // an HTML block that starts where the browser may already be out of what an earlier one left open,
  // `alt` reads it from text as well (`left`, that record; `line`, the block's 1-based line); where
  // the two readings end it apart, `unsure` names them for every line the owner reads after it.
  const body = { state: 0, since: 0, record: null };
  const owners = new Map();
  const innermost = () => {
    const record = footnotes[footnotes.length - 1];
    if (!record) return body;
    if (!owners.has(record)) owners.set(record, { state: 0, since: 0, record: null });
    return owners.get(record);
  };
  // The first block GitHub writes after an HTML block left a tag open, in the same owner: the 0-based
  // line of a paragraph, or -1 for any other block or a container's end. Only a table there is surely
  // in the tag; the browser ends it at the first `>` or quote mark GitHub writes (`doubtOf`).
  const wrote = (owner, value) => {
    const r = owner?.record;
    if (r?.kind === 'tag' && r.first === undefined) r.first = value;
  };
  // An HTML block ends - at its end marker, where its container or a blank line ends it, or at the end
  // of the file - and what the browser is left inside goes on: a comment or a tag it opened, or the
  // one it was opened in, kept. A comment a `<!--` reopened after the `-->` that ended a block of type
  // 2 carries `reopened`, the 1-based line of that `-->`; one opened on the block's first line of type
  // 2 is the block's own record. Where its reading from text (`alt`) or the kit's leaves the browser
  // in a comment or a tag, the two may disagree on what follows: the owner is `unsure` from here on.
  const endHtml = (how) => {
    const owner = innermost();
    // A `<select>` left open drops the tables GitHub writes after it until something closes it, which
    // no check follows (G-5).
    if (owner.select) {
      owner.unsure ??= { record: { kind: 'tag', line: owner.select, select: true }, line: owner.select, why: 'select' };
      owner.select = 0;
    }
    const { alt } = owner;
    if (alt) {
      owner.alt = null;
      if (alt.state || owner.state || alt.select) owner.unsure ??= { record: alt.left, line: alt.line };
    }
    if (owner.state === 0) owner.record = null;
    else if (owner.since < tip.record.line && owner.record) return;
    else if (owner.state !== 1) owner.record = { kind: 'tag', line: owner.since };
    else if (tip.htmlType === 2 && how === 'marker') owner.record = { kind: 'comment', line: tip.record.line, reopened: line + 1 };
    else if (tip.htmlType === 2 && owner.since === tip.record.line) owner.record = tip.record;
    else owner.record = { kind: 'comment', line: owner.since };
  };
  let line = 0;
  let prevLine = 0;
  // The part of the line a carriage return alone ends that is being read, and its place among all
  // the lines GitHub reads.
  let seg = -1;
  let gseg = 0;
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
    else footnotes.push(container.record);
    stopsZero.push(stack.length);
    stack.push(container);
  };
  let ended = 0;
  const popTo = (m) => {
    while (stack.length > m) {
      const gone = stack.pop();
      // What GitHub writes at a container's end - `</li>`, `</blockquote>`, a footnote's back link -
      // ends a tag.
      if (gone.type !== 'footnote') { wrote(innermost(), -1); continue; }
      wrote(owners.get(gone.record), -1);
      Object.assign(gone.record, { to: prevLine, ended: ended++ });
      footnotes.pop();
      // A comment or a tag the definition left open hides what GitHub shows after it there.
      const owner = owners.get(gone.record);
      if (owner?.state) {
        const record = owner.record ?? { kind: owner.state === 1 ? 'comment' : 'tag', line: owner.since };
        events.push({ record, owner: gone.record, from: owner.since - 1 });
      }
    }
    while (stopsEmpty.length && stopsEmpty[stopsEmpty.length - 1] >= m) stopsEmpty.pop();
    while (stopsZero.length && stopsZero[stopsZero.length - 1] >= m) stopsZero.pop();
  };
  // A paragraph ends: the link reference definitions it opens with go to `refmap`, and the rest of its
  // text, if any is left, to `pending`, read by `footnoteRefs` once every definition is known. The scan
  // it replaces read each `[^label]` where it stood and knew no link (re-review of dde656a).
  const closePara = () => {
    const { labels, used } = parseRefDefs(tip.texts);
    for (const label of labels) refmap.add(label);
    if (used < tip.texts.length) pending.push({ text: tip.texts.slice(used).join('\n'), lines: tip.lines.slice(used) });
    return used < tip.texts.length;
  };
  const closeTip = (why) => {
    if (tip?.type === 'table' && endWhy[line] === null) endWhy[line] = why;
    if (tip?.type === 'para') closePara();
    if (tip?.type === 'html') endHtml('close');
    tip = null;
  };
  const addPara = (text) => {
    tip.last = text;
    tip.lastLine = line;
    tip.lastSeg = gseg;
    tip.lastLazy = null;
    tip.texts.push(text);
    tip.lines.push(line);
    if (!tip.overflow && text.length >= 65_536) tip.overflow = rowCells(text) >= 65_536;
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
    // The lines above the header stay a paragraph, its escaped pipes unescaped and its ends trimmed,
    // in which GitHub reads no link reference definition; a row's cells are read one by one.
    if (tip.texts.length > 1) {
      const above = unescapePipes(tip.texts.slice(0, -1).join('\n'));
      let lead = 0;
      let shift = 0;
      for (; lead < above.length && HTML_SPACE(above[lead]); lead += 1) if (above[lead] === '\n') shift += 1;
      pending.push({ text: trimSpace(above), lines: tip.lines.slice(shift, -1) });
    }
    for (const text of rowCellTexts(tip.last, delimiter)) pending.push({ text, lines: [tip.lastLine], cell: true });
    tables.push({ line: tip.lastLine, gline: tip.lastSeg + 1, text: tip.last, cr: segs[tip.lastLine] > 1 || segs[line] > 1 });
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
      // A comment an HTML block opened, of any type, that the end of its container cuts off leaves
      // its `<!--` open in GitHub's page, and the browser hides the rest of the file in it (N1) - in a
      // footnote definition, what GitHub shows after it there (`events`).
      const owner = innermost();
      if (tip?.type === 'html' && owner.state === 1 && owner.since >= tip.record.line) {
        const record = tip.htmlType === 2 && owner.since === tip.record.line ? tip.record : { kind: 'comment', line: owner.since };
        if (owner === body) {
          record.runaway = line + 1;
          for (let k = line; k < n; k += 1) at[k] = record;
          open = record;
          stopped = true;
          return;
        }
        events.push({ record, owner: footnotes[footnotes.length - 1], from: owner.since - 1 });
        Object.assign(owner, { state: 0, record: null });
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
    // A block GitHub writes where it stands, after what it wrote above - except a footnote definition,
    // which it writes below the body, and an HTML block, which writes itself once it is known how the
    // browser may read it (`quiet`).
    const opens = (why, quiet) => {
      if (opened) return;
      opened = true;
      closeTip(m < stack.length ? 'outside' : why);
      popTo(m);
      if (!quiet) wrote(innermost(), -1);
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
      } else if (!indented && (k = sticky(ATX, s, fns))) {
        opens('block');
        hold();
        pending.push({ text: atxContent(s, fns + k[0].length), lines: [line] });
        return;
      } else if (!indented && (k = fenceOpens(s, fns))) {
        opens('block');
        hold();
        tip = { type: 'fence', char: s[fns], length: Math.min(k, 255), record: { kind: 'fence', line: line + 1 } };
        hide(tip.record);
        return;
      } else if (!indented && (k = htmlStart(s, fns, contType === 'para'))) {
        // What GitHub wrote since a tag or a comment was left open may have ended it - a tag something
        // was written after, a comment past a paragraph's `-->` - and the browser then reads this block
        // from text: it is read that way too (`alt`), and where the two readings part, nothing after
        // it can be judged (`unsure`; commit G, each shape rendered by GitHub).
        opens('block', true);
        hold();
        const owner = innermost();
        const left = owner.state ? owner.record : null;
        if (left?.kind === 'tag' ? left.first !== undefined : left?.closer !== undefined) {
          owner.alt = { state: 0, since: 0, record: null, left, line: line + 1 };
        }
        wrote(owner, -1);
        tip = { type: 'html', htmlType: k, record: k === 2 ? { kind: 'comment', line: line + 1 } : { kind: 'html', type: k, line: line + 1 } };
        contType = 'html';
        break;
      } else if (!indented && contType === 'para' && sticky(SETEXT, s, fns)) {
        // A heading of what the link reference definitions leave; where they leave nothing, the
        // underline is the paragraph's first line, and no thematic break or table (R12u).
        if (closePara()) {
          tip = null;
          return;
        }
        Object.assign(tip, { texts: [], lines: [], overflow: false });
        break;
      } else if (!indented && (brk ??= breakTest(s))(fns)) {
        opens('block');
        hold();
        return;
      } else if (!indented && depth < 100 && (k = sticky(FOOTNOTE, s, fns))) {
        opens('block', true);
        advance(fns + k[0].length - offset, false);
        const record = { kind: 'footnote', line: line + 1, from: line, to: line };
        definitions.push({ label: normalizeLabel(k[1]), record });
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
        // A header taken in lazily keeps its leading space, which GitHub reads as an empty first
        // cell: a table of shifted columns where the counts then match, none where they do not (F5).
        const header = tip.lastLine;
        const lazyHead = tip.lastLazy;
        const result = tableHeader();
        if (lazyHead && (result === true || result.why === 'cells')) outcome[header] ??= { why: 'lazy-header', under: lazyHead };
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
        // A cell past the header's is dropped, and what it holds with it.
        for (const text of rowCellTexts(s.slice(fns, -1), tip.cols)) pending.push({ text, lines: [line], cell: true });
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
        outcome[tip.lastLine] = { why: stack[m].type === 'quote' ? 'quote' : 'lazy', under: stack[m].type };
      }
      const text = pct ? ' '.repeat(4 - (column % 4)) + s.slice(offset + 1, -1) : s.slice(offset, -1);
      addPara(text);
      if (/^[ \t]/.test(text)) tip.lastLazy = stack[m].type;
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
      // GitHub writes an HTML block out as it stands, as it does a paragraph's raw HTML, read once the
      // pass is over (`pending`, `closer`); text and code it writes escaped, a `-->` as `--&gt;` (F3).
      // A footnote definition is written below the body, so it reads only its own.
      hide(tip.record);
      const owner = innermost();
      feedHtml(owner, s.slice(fns), line);
      if (owner.alt) feedHtml(owner.alt, s.slice(fns), line);
      if (htmlEnds(tip.htmlType, s, fns)) {
        endHtml('marker');
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
    wrote(innermost(), line);
    tip = { type: 'para', last: '', lastLine: line, lastSeg: gseg, texts: [], lines: [], overflow: false, visited: false };
    addPara(s.slice(fns, -1));
  };
  for (line = 0; line < n && !stopped; line += 1) {
    const parts = lines[line].split('\r');
    if (line === n - 1 && parts[parts.length - 1] === '') parts.pop();
    segs[line] = parts.length;
    // A carriage return alone ends the line on GitHub, and the kit reads what follows it as one line (F-D).
    if (tip?.type === 'table' && parts.length > 1) endWhy[line] = 'cr';
    for (seg = 0; seg < parts.length && !stopped; seg += 1) {
      segment(parts[seg].replace(/\0/g, '\uFFFD'), line === 0 && seg === 0);
      prevLine = line;
      gseg += 1;
      // What an HTML block left open, once it has ended, hides the lines its owner reads after it. A
      // `-->` past a `<` in what it hides may close a comment on GitHub: a paragraph's raw HTML, which
      // the kit does not read where it is hidden, is written as it stands (`closer`, `doubtOf`). Past an HTML block the
      // browser may read otherwise, nothing the owner reads can be judged (`unsure`).
      const owner = innermost();
      if (owner.unsure) unsure[line] ??= owner.unsure;
      if (owner.state && owner.record) {
        at[line] ??= owner.record;
        const r = owner.record;
        if (r.kind === 'comment' && r.closer === undefined && at[line] === r) {
          const t = parts[seg];
          const k = t.search(/--!?>/);
          if (k >= 0 && (r.lt || t.lastIndexOf('<', k) >= 0)) r.closer = line;
          else if (!r.lt && t.includes('<')) r.lt = true;
        }
      }
    }
  }
  seg = -1;
  if (!stopped) {
    // What the file ends inside hides what is written at its end: a fence or an HTML block of a type
    // that ends only at its marker, `<pre>` to CDATA, the body ends inside (finding 5), and a comment
    // or a tag the body leaves open. One a footnote definition leaves open hides what GitHub shows
    // after it there (`popTo`).
    if (tip?.type === 'html') endHtml('eof');
    if (tip?.type === 'para') closePara();
    const html = tip?.type === 'html' ? tip.htmlType : 0;
    if (tip?.type === 'fence' && stack.length === 0) open = tip.record;
    else if (html === 2 && !footnotes.length) open = tip.record;
    else if (html !== 2 && html >= 1 && html <= 5 && stack.length === 0) open = tip.record;
    else if (body.state) open = body.record;
  }
  popTo(0);
  // The references GitHub reads, once it knows every link reference definition: a label of 1 to 1000
  // bytes is looked up. The first whose label holds an entity the kit cannot decode is `uncertain`.
  let uncertain = null;
  for (const entry of pending) {
    const { text, lines: where } = entry;
    entry.spans = [];
    for (const ref of footnoteRefs(text, refmap, entry.spans)) {
      const bytes = Buffer.byteLength(ref.label, 'utf8');
      const label = bytes >= 1 && bytes <= 1000 ? normalizeLabel(ref.label) : null;
      if (label !== null) refs.add(label);
      if (uncertain || ref.unknown === null) continue;
      let row = 0;
      for (let i = text.indexOf('\n'); i >= 0 && i < ref.start; i = text.indexOf('\n', i + 1)) row += 1;
      uncertain = { line: where[row] + 1, ref: ref.raw, name: ref.unknown };
    }
  }
  // GitHub drops a footnote definition nothing refers to, and every line of it with it (F-C), and
  // of a label defined twice it keeps the definition that ends first - one nested in another ends
  // before it; it shows the others below the body, in the order of their first reference (F2). A
  // line is the innermost definition's holding it, shown in that one's place: it was the outermost
  // one's, in its place (re-review of 116a2a3, finding 4).
  const order = new Map([...refs].map((label, i) => [label, i]));
  const kept = new Map();
  for (const { label, record } of definitions) if (!(kept.get(label)?.ended < record.ended)) kept.set(label, record);
  for (const { label, record } of definitions) {
    if (!refs.has(label)) continue;
    if (kept.get(label) !== record) record.repeats = kept.get(label).line;
    else record.order = order.get(label);
  }
  const holding = [];
  for (let k = 0, d = 0; k < n; k += 1) {
    while (holding.length && holding[holding.length - 1].to < k) holding.pop();
    while (d < definitions.length && definitions[d].record.from === k) holding.push(definitions[d++].record);
    const inner = holding[holding.length - 1];
    if (inner?.order !== undefined) note[k] = inner;
    else if (inner) at[k] = inner;
  }
  // GitHub shows the footnotes below the body, so a comment the body leaves open hides them too; the
  // first one a footnote definition leaves open, in GitHub's order, hides the rest of that definition
  // and those shown after it - never the body (re-review of 116a2a3, finding 1).
  if (open?.kind === 'comment' || open?.kind === 'tag') for (let k = 0; k < n; k += 1) if (note[k]) at[k] ??= open;
  let first = null;
  for (const event of events) {
    event.record.footnote = event.owner.line;
    const place = event.owner.order;
    if (place !== undefined && (!first || place < first.owner.order || (place === first.owner.order && event.from < first.from))) first = event;
  }
  for (let k = 0; first && k < n; k += 1) {
    const holder = note[k];
    if (holder && (holder.order > first.owner.order || (holder === first.owner && k >= first.from))) at[k] ??= first.record;
  }
  // GitHub writes the raw HTML of a paragraph, a heading or a cell as it stands (`spans`), and the
  // browser reads it as it reads an HTML block: what leaves it in a comment or a quoted value, or in a
  // `<select>` outside a cell, whose end closes one, leaves the owner `unsure` from that line on, and
  // the table the cell is in (G-1, G-5). Each text is read from text: a line hidden reads none.
  const earliest = new Map();
  const rowMarks = [];
  for (const { text, lines: where, spans, cell } of pending) {
    if (!spans?.length || at[where[0]]) continue;
    const holder = note[where[0]];
    const scratch = { state: 0, since: 0, record: null, select: 0 };
    let u = null;
    let row = 0;
    let nl = text.indexOf('\n');
    for (const { start, end } of spans) {
      while (nl >= 0 && nl < start) { row += 1; nl = text.indexOf('\n', nl + 1); }
      // A span's lines are read with their line ends, which the browser reads as white space: one ends
      // a tag's name or an unquoted value, and the tagfilter writes a filtered tag out as text before
      // one (the re-review of 50c0afd, A).
      const pieces = text.slice(start, end).split('\n');
      pieces.forEach((piece, j) => feedHtml(scratch, j < pieces.length - 1 ? `${piece}\n` : piece, where[row + j]));
      if (scratch.state === 4 || scratch.state === 5) { u = { kind: 'tag', line: scratch.since, why: 'inline' }; break; }
    }
    if (!u && scratch.state === 1) u = { kind: 'comment', line: scratch.since, why: 'inline' };
    if (!u && scratch.select && !cell) u = { kind: 'tag', line: scratch.select, why: 'select' };
    if (!u) continue;
    const mark = { record: { kind: u.kind, line: u.line, inline: true }, line: u.line, why: u.why };
    const key = holder || null;
    if (!earliest.has(key) || u.line < earliest.get(key).line) earliest.set(key, mark);
    if (wasRowOf[where[0]] >= 0) rowMarks.push([wasRowOf[where[0]], mark]);
  }
  // Each owner's lines are marked once, from the first of its texts in doubt, so the marking is linear
  // in the file however many texts are in doubt (the re-review of 50c0afd, B).
  for (let k = 0; earliest.size && k < n; k += 1) {
    const m = earliest.get(note[k] || null);
    if (m && k >= m.line - 1) unsure[k] ??= m;
  }
  for (const [k, m] of rowMarks) unsure[k] ??= m;
  for (const [holder, m] of earliest) {
    if (!holder) body.unsure ??= m;
    else {
      if (!owners.has(holder)) owners.set(holder, { state: 0, since: 0, record: null });
      owners.get(holder).unsure ??= m;
    }
  }
  // GitHub writes the footnotes below the body, in their order: an owner `unsure` leaves every one shown
  // after it so too.
  let taint = body.unsure ? { order: -1, unsure: body.unsure } : null;
  for (const [record, owner] of owners) {
    if (owner.unsure && record.order !== undefined && (!taint || record.order < taint.order)) taint = { order: record.order, unsure: owner.unsure };
  }
  for (let k = 0; taint && k < n; k += 1) if (note[k] && note[k].order > taint.order) unsure[k] ??= taint.unsure;
  // GitHub's page is one HTML stream, and the kit reads only the HTML blocks of each owner: what one
  // leaves open GitHub may close earlier. A tag hides surely only the table GitHub writes first after
  // it; a comment, until a `-->` - in a paragraph's raw HTML (`closer`) or anywhere in a footnote, which
  // GitHub writes below the body in its order (`sooner`) - that comes before the line in doubt. And
  // past an HTML block the browser may read otherwise (`unsure`), nothing shown or hidden is sure.
  const sooner = (a, b) => note[a].order < note[b].order || (note[a].order === note[b].order && a < b);
  let noteCloser = -1;
  let firstCloser = -1;
  for (let k = 0; k < n; k += 1) {
    if (!note[k] || at[k]?.kind === 'fence' || at[k]?.kind === 'indented' || !/--!?>/.test(lines[k])) continue;
    if (noteCloser < 0 || sooner(k, noteCloser)) noteCloser = k;
    const after = first && (note[k].order > first.owner.order || (note[k] === first.owner && k > first.from));
    if (after && (firstCloser < 0 || sooner(k, firstCloser))) firstCloser = k;
  }
  const doubtOf = (i) => {
    const record = at[i];
    const u = unsure[i];
    if (u && (!record || record.kind === 'tag' || record.kind === 'comment')) return { record: u.record, closer: -1, after: u.line, why: u.why };
    if (record?.kind === 'tag') return record.first === i ? null : { record, closer: -1 };
    if (record?.kind !== 'comment') return null;
    const c = record.closer;
    if (c !== undefined && (c < i || (note[i] && !note[c]))) return { record, closer: c };
    const k = record === open ? noteCloser : record === first?.record ? firstCloser : -1;
    return note[i] && k >= 0 && sooner(k, i) ? { record, closer: k } : null;
  };
  const heads = outcome.map((result, i) => {
    if (segs[i] > 1 || segs[i + 1] > 1) return { why: 'cr' };
    if (wasRowOf[i] >= 0) return { why: 'row', table: wasRowOf[i] + 1 };
    return result ?? { why: 'paragraph' };
  });
  return { at, open, heads, rowOf, segs, endWhy, note, tables, uncertain, doubtOf, endUnsure: body.unsure ?? null };
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
  return namesHeader(cells, header) ? cells : null;
}

// Whether a header's cells name `header`'s table: its first column, or exactly its columns.
function namesHeader(cells, header) {
  const names = cells.map((name) => name.trim().toLowerCase());
  const want = new Set(header.map((name) => name.trim().toLowerCase()));
  const sameLead = names[0] === header[0].trim().toLowerCase();
  const sameSet = names.length === want.size && names.every((name) => want.has(name)) && new Set(names).size === names.length;
  return sameLead || sameSet;
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

const HOLDER = { item: 'a list item', footnote: 'a footnote definition', quote: 'a block quote' };

function notATable(why) {
  if (why.why === 'cells') return [`its delimiter row has ${why.delimiter} cells and the header ${why.header}`, 'give the delimiter row one cell per column'];
  if (why.why === 'row') {
    return [`its header stands straight below the rows of another table (line ${why.table}), so GitHub reads it as one more row of that table`,
      'put a blank line above the header'];
  }
  if (why.why === 'lazy-header') {
    return [`its header stands below ${HOLDER[why.under] ?? HOLDER.item}'s paragraph with less indentation than its content, so GitHub `
      + 'reads it as more of that paragraph, and its leading space as an empty first cell', 'indent the header as the delimiter row is'];
  }
  if (why.why === 'lazy' && why.under === 'footnote') {
    return ["its header and delimiter row stand below a footnote definition's paragraph with less indentation than its content "
      + '(4 spaces), so GitHub reads them as more of that paragraph', 'put a blank line above it, or indent it 4 spaces to keep it in the footnote'];
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
  return readTable(text, header).out;
}

// `parseTable`, with the lines it read and what `hiddenLines` said of them, for the writers.
function readTable(text, header) {
  const out = { header: [...header], rows: [], problems: [], found: false, line: 0 };
  if (!text) return { out, lines: null, read: null };
  const lines = String(text).split(/\r?\n/);
  // A table in a code block or an HTML comment is shown as code or hidden, so it is not the table.
  // An archived CLOSED copy of the unknowns table commented out above the live one was read in its
  // place, and the live table's OPEN unknown passed the gate (independent audit 2026-11-04, F01).
  // Nor is a header GitHub makes no table of: it was read with its rows wherever it stood
  // (re-review of #441, 2026-11-07).
  const read = hiddenLines(lines);
  const hidden = read.at;
  const done = { out, lines, read };
  let start = -1;
  let refused = -1;
  let cut = -1;
  let noted = -1;
  // A header a block never closed hides is named (F3): one in the body before one in a footnote
  // definition, which GitHub shows below it, and below a cut-off comment the first below the cut,
  // which GitHub would show once the comment is closed, before one the comment was written to hide.
  const rank = (j) => (read.note[j] ? 0 : read.open.runaway && j + 1 >= read.open.runaway ? 2 : 1);
  // Where GitHub shows a line: the body by line, then the footnotes in their order.
  const place = (j) => (read.note[j] ? [1, read.note[j].order, j] : [0, j, 0]);
  const earlier = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  for (let i = 0; i < lines.length; i += 1) {
    if (!headerAt(lines, i, header)) continue;
    if (hidden[i]) {
      if (read.open && hidden[i] === read.open && (cut < 0 || rank(i) > rank(cut))) cut = i;
      continue;
    }
    if (read.heads[i] !== true) {
      if (refused < 0) refused = i;
      continue;
    }
    // GitHub shows the footnotes below the body, in the order of their first reference: a table in
    // one is the first GitHub shows only when the body holds none (F2).
    if (read.note[i]) {
      if (noted < 0 || read.note[i].order < read.note[noted].order) noted = i;
      continue;
    }
    start = i;
    break;
  }
  if (start < 0) start = noted;
  // The first table GitHub makes with this header, read or passed over, that no check can tell it
  // shows or hides: a tag or a comment hiding it GitHub may close earlier, or one an HTML block above
  // it may leave open on GitHub alone (`doubtOf`). A pipeless one a tag hid was not judged at all, and
  // the table read after it passed (commit G).
  let doubt = -1;
  for (const t of read.tables) {
    if (t.cr || !read.doubtOf(t.line)) continue;
    if (!headerAt(lines, t.line, header) && !namesHeader(splitRow(t.text.trim()), header)) continue;
    if (doubt < 0 || earlier(place(t.line), place(doubt)) < 0) doubt = t.line;
  }
  // A reference whose label holds an entity name the kit does not know may name a definition GitHub
  // shows, or none, and so moves the footnotes it shows: where the table is looked for among them, no
  // check can tell which one GitHub shows it in (re-review of dde656a).
  const u = read.uncertain;
  if (u && (start < 0 || read.note[start]) && lines.some((_, i) => (read.note[i] || hidden[i]?.kind === 'footnote') && headerAt(lines, i, header))) {
    done.uncertain = u;
    out.problems.push({
      kind: 'table-split',
      line: u.line,
      detail: `\`${u.ref}\` refers to a footnote by a label holding \`${u.name}\`, which GitHub reads as a character if it names `
        + 'an HTML entity, and the kit knows too few entities to tell, so no check can tell which footnote GitHub shows the '
        + 'table in - write the character itself or a numeric reference',
      text: lines[u.line - 1].trim(),
    });
    if (start < 0) return done;
  }
  // Such a table before the one the checks read, or that one itself, or one where none is read: no
  // check can tell which one GitHub shows first (commit G).
  if (doubt >= 0 && (start < 0 || earlier(place(doubt), place(start)) <= 0)) {
    const [reason, remedy] = doubtWords(read.doubtOf(doubt));
    const same = doubt === start;
    const before = start >= 0 && !same ? start + 1 : 0;
    out.problems.push({
      kind: 'table-split',
      line: doubt + 1,
      detail: `\`${lines[doubt].trim().slice(0, 40)}\` cannot be judged: ${reason}, so no check can tell whether GitHub shows it`
        + `${before ? ` before the table at line ${before} that the checks read` : ''} - ${remedy}`,
      text: lines[doubt].trim(),
    });
    done.doubt = { line: doubt + 1, reason, remedy, before, same };
    if (start < 0) return done;
  }
  if (start >= 0) {
    out.header = headerAt(lines, start, header);
    out.found = true;
    out.line = start + 1;
    // A table with this header that GitHub shows before this one - the body by line, then the
    // footnotes in their order - and that the header search passes over holds rows no check reads,
    // and a row written to this one could repeat an id it holds; one whose lines a carriage return
    // alone ends could stand anywhere (re-review of dde656a, F-1).
    let unread = null;
    for (const t of read.tables) {
      if (!t.cr && (hidden[t.line] || headerAt(lines, t.line, header) || read.doubtOf(t.line))) continue;
      if (!namesHeader(splitRow(t.text.trim()), header)) continue;
      if (!t.cr && earlier(place(t.line), place(start)) >= 0) continue;
      if (!unread || earlier(place(t.line), place(unread.line)) < 0) unread = t;
    }
    if (unread) {
      const shape = unreadShape(unread, lines);
      const line = unread.cr ? unread.gline : unread.line + 1;
      const [reason, remedy] = UNREAD[shape];
      const head = `\`${lines[unread.line].trim().slice(0, 40)}\``;
      out.problems.push({
        kind: 'table-split',
        line,
        detail: unread.cr
          ? `${head} cannot be judged: ${reason}, so no check can tell whether GitHub shows it before the table at line ${start + 1} `
            + `that the checks read - ${remedy}`
          : `${head} is shown on GitHub before the table at line ${start + 1} that the checks read, but no check reads it: `
            + `${reason} - ${remedy}`,
        text: lines[unread.line].trim(),
      });
      done.unread = { line, shape, before: start + 1 };
    }
  } else {
    // No table is read, so no check reads a row: the header that is not one is named, with why.
    const named = refused >= 0 ? refused : cut;
    if (named < 0) return done;
    const head = lines[named].trim();
    let detail;
    if (refused >= 0) {
      const [reason, remedy] = notATable(read.heads[named]);
      detail = `\`${head.slice(0, 40)}\` heads no table on GitHub: ${reason} - ${remedy}`;
    } else if (read.note[named]) {
      // A comment the body leaves open hides the footnotes, which GitHub shows below the body.
      const cause = read.open.runaway
        ? `an HTML comment that starts at line ${read.open.line} is cut off at line ${read.open.runaway}, where the block `
          + 'holding it ends, and left open to the end of the page, so no check reads the table - close the comment inside its block'
        : `${blockNamed(read.open)} is never closed, so the rest of the page is in it and no check reads the table - `
          + 'close it where it should end';
      detail = `\`${head.slice(0, 40)}\` is hidden on GitHub: it stands in a footnote definition, which GitHub shows below `
        + `the body, and ${cause}`;
    } else if (read.open.runaway) {
      detail = `\`${head.slice(0, 40)}\` is hidden on GitHub: an HTML comment that starts at line ${read.open.line} is cut off `
        + `at line ${read.open.runaway}, where the block holding it ends, and GitHub leaves it open to the end of the file, `
        + 'so no check reads the table - close the comment inside its block';
    } else {
      const shown = { fence: 'is shown as code', html: 'is not shown as a table' }[read.open.kind] ?? 'is hidden';
      detail = `\`${head.slice(0, 40)}\` ${shown} on GitHub: `
        + `${blockNamed(read.open)} is never closed, so the rest of the file is in it on GitHub and no check reads the table - `
        + 'close it where it should end';
    }
    out.problems.push({ kind: 'table-split', line: named + 1, detail, text: head });
    return done;
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
  return done;
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

const HIDDEN_BY = {
  fence: 'a fenced code block', comment: 'an HTML comment', indented: 'an indented code block', html: 'an HTML block',
  tag: 'an HTML tag',
};

// The block a `hiddenLines` record names, in the words the reader and the writer share.
function blockNamed(record) {
  if (record.reopened) return `an HTML comment reopened at line ${record.reopened} by a \`<!--\` after its \`-->\``;
  if (record.repeats) return `a footnote definition that starts at line ${record.line} and repeats the label of the one at line ${record.repeats}`;
  if (record.kind === 'footnote') return `a footnote definition that starts at line ${record.line} and that nothing refers to`;
  return `${HIDDEN_BY[record.kind]} that starts at line ${record.line}`;
}

// Why GitHub may show a table that a tag or a comment an HTML block left open hides in the kit, or
// hide one the kit shows (`doubtOf`): the reason, then the remedy. Past raw HTML in a paragraph, a
// heading or a cell (`why` 'inline'), or a `<select>` left open (`why` 'select'), its own (G-1, G-5).
function doubtWords({ record, closer, after, why }) {
  if (why === 'select') {
    return [`a \`<select>\` at line ${record.line} is left open where its block ends, and the browser drops the tables GitHub `
      + 'writes after it until the select is closed', 'close the select inside its block'];
  }
  if (why === 'inline') {
    const reason = record.kind === 'comment'
      ? 'leaves an HTML comment open in the browser, which hides what GitHub writes after it up to the next `-->`'
      : 'leaves a quoted attribute value open, and the browser ends it at the next quote mark GitHub writes, which can come before the table';
    return [`the raw HTML at line ${record.line} ${reason}`, 'write that HTML in a code span or escape its `<`'];
  }
  if (after) {
    return [`${blockNamed(record)} is left open where its HTML block ends, and GitHub may close it before the HTML block at `
      + `line ${after}, which the browser would then read otherwise`, `close the ${record.kind === 'tag' ? 'tag' : 'comment'} inside its block`];
  }
  if (record.kind === 'tag') {
    return [`${blockNamed(record)} is left open where its HTML block ends, and the browser ends it at the next \`>\` or quote `
      + 'mark GitHub writes, which can come before the table', 'close the tag inside its block'];
  }
  return [`${blockNamed(record)} is left open where its HTML block ends, and the \`-->\` at line ${closer + 1} may close it `
    + 'on GitHub before the table', 'close the comment inside its block'];
}

/**
 * Why a row for a table with `header` cannot be written where the reader would read it, or null
 * when it can (review of #441, 2026-11-06, finding 1; ADR-0204). With a table the reader reads,
 * the row goes below its last row. With none, the writer starts a table at the end of the file,
 * which is in a block as well when the body ends inside one never closed (`open` true): a fence, an
 * HTML block of type 1 or 3 to 5, a comment or a tag left open, or a comment cut off where the
 * block holding it ends (`runaway`); and no check can judge it past what leaves the body in doubt -
 * raw HTML in a paragraph, a heading or a cell that leaves a comment or a quoted value open, a
 * `<select>` left open, an HTML block the browser may read otherwise (`kind` 'doubt', with `end`, the
 * `line` of what does, and the `reason` and `remedy` of `doubtWords`; G-1, G-5). And a table with this header that GitHub does not show as one -
 * in a block that hides it, a comment or a tag a footnote leaves open among them (`footnote`), or
 * over a delimiter row it makes no table of (`kind` 'not-a-table', with `why`) - with rows below it
 * would be left behind by the new one, which numbers its own from the first id again. A header with
 * no rows - an example, commented out - holds nothing a new table would leave behind.
 *
 * Refused as well, whether or not the reader reads a table (re-review of dde656a, 2026-11-08):
 * - a footnote reference whose label holds an entity name the kit cannot decode, where the table is
 *   looked for among the footnotes (`kind` 'uncertain', with its `line`, `ref` and `name`);
 * - a table GitHub shows with this header that the header search passes over, before the one read
 *   (`before`, its 1-based line) or anywhere when none is read, as the row could go to the wrong
 *   table or the new table stand beside it; and, wherever it stands, one whose lines a carriage
 *   return alone ends, which no check can place (`kind` 'unread', with the `line` of its header and
 *   its `shape`, a key of `UNREAD`);
 * - a table with this header that no check can tell GitHub shows or hides - a tag or a comment hiding
 *   it GitHub may close earlier, or one an HTML block above it may leave open on GitHub alone - before
 *   the one read, that one itself (`same`), or with none read (`kind` 'doubt', with its `line`, the
 *   `reason` and `remedy` of `doubtWords`, and `before`).
 *
 * Nor is a row written to a table the reader stops in above rows GitHub still shows (`kind` 'split',
 * the `line` it names, the `table` header's line and the reader's `detail`): it was numbered from the
 * rows above the stop and placed among them, a second U-2 beside the one no check read (re-review of
 * 88fe19a, 2026-11-07, F1). Returns the record from `hiddenLines` (`kind`, the `line` that opened it)
 * with `open`.
 */
export function tableHidden(text, header) {
  return writeCheck(text, header).hidden;
}

// `tableHidden` with the table the reader found, which the writers then write into. The file is
// read once: the reader's lines and blocks are judged here too.
function writeCheck(text, header) {
  const { out: table, lines, read, uncertain, unread, doubt } = readTable(text, header);
  if (uncertain) return { table, hidden: { kind: 'uncertain', line: uncertain.line, ref: uncertain.ref, name: uncertain.name, open: false } };
  if (unread) return { table, hidden: { kind: 'unread', ...unread, open: false } };
  if (doubt) return { table, hidden: { kind: 'doubt', ...doubt, open: false } };
  if (table.found) {
    const split = table.problems.find((problem) => problem.kind === 'table-split');
    return { table, hidden: split ? { kind: 'split', line: split.line, table: table.line, detail: split.detail, open: false } : null };
  }
  if (!text) return { table, hidden: null };
  const { at, open, heads, tables } = read;
  let held = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (!headerAt(lines, i, header)) continue;
    if (!at[i] && heads[i] === true) return { table, hidden: null };
    const record = at[i] ?? { kind: 'not-a-table', line: i + 1, why: heads[i] };
    // Its first row: the line below the separator, in the same block, holding a cell divider.
    const row = lines[i + 2] ?? '';
    if (!held && (at[i] ? at[i + 2] === at[i] : !at[i + 2]) && !isSeparator(row) && /(^|[^\\])\|/.test(row)) held = record;
  }
  if (open) return { table, hidden: { ...open, open: true } };
  // A table GitHub shows with this header that the header search passes over: a new table would
  // stand beside it, its rows unread (re-review of 116a2a3, 2026-11-07, finding 2).
  for (const t of tables) {
    if (!t.cr && (at[t.line] || headerAt(lines, t.line, header))) continue;
    if (!namesHeader(splitRow(t.text.trim()), header)) continue;
    return { table, hidden: { kind: 'unread', line: t.cr ? t.gline : t.line + 1, shape: unreadShape(t, lines), open: false } };
  }
  if (held) return { table, hidden: { ...held, open: false } };
  // What leaves the body in doubt leaves its end so too, and the table the writer would start there
  // (`endUnsure`, G-1, G-5).
  const u = read.endUnsure;
  if (!u) return { table, hidden: null };
  const [reason, remedy] = doubtWords({ record: u.record, closer: -1, after: u.line, why: u.why });
  return { table, hidden: { kind: 'doubt', end: true, line: u.line, reason, remedy, before: 0, same: false, open: false } };
}

// Why a table GitHub shows is passed over by the header search, and the remedy.
const UNREAD = {
  pipes: ['its header has no outer pipes', 'write the header between pipes'],
  quote: ['it stands in a block quote', 'move it out of the quote'],
  cr: ['its lines end with a carriage return alone, which GitHub reads as a line end and the kit does not',
    'end its lines with LF or CR LF'],
  marker: ["its header starts on the line of a list item's marker or a footnote definition's label",
    'start the header on a line of its own'],
};
const unreadShape = (t, lines) => (t.cr ? 'cr' : /^\s*>/.test(lines[t.line]) ? 'quote' : t.text.trim().startsWith('|') ? 'marker' : 'pipes');

function tableHiddenError(rel, hidden) {
  let detail;
  if (hidden.kind === 'uncertain') {
    detail = `\`${hidden.ref}\` at line ${hidden.line} refers to a footnote by a label holding \`${hidden.name}\`, which GitHub `
      + 'reads as a character if it names an HTML entity, and the kit knows too few entities to tell, so no check can tell '
      + 'which footnote definitions GitHub shows, or in what order. Write the character itself or a numeric reference, '
      + 'then run again.';
  } else if (hidden.kind === 'doubt' && hidden.end) {
    detail = `the end of the file cannot be judged: ${hidden.reason}, so no check can tell whether GitHub shows a table `
      + `written there. ${hidden.remedy[0].toUpperCase()}${hidden.remedy.slice(1)}, then run again.`;
  } else if (hidden.kind === 'doubt') {
    const before = hidden.before ? ` before the table at line ${hidden.before} that the checks read` : '';
    detail = `the table at line ${hidden.line} cannot be judged: ${hidden.reason}, so no check can tell whether GitHub shows it${before}. `
      + (hidden.before ? 'A row written now could go to the wrong table and repeat an id it holds. '
        : hidden.same ? 'A row written now could go to a table GitHub hides. '
          : 'A new table could stand beside it and number its own rows from the first id again. ')
      + `${hidden.remedy[0].toUpperCase()}${hidden.remedy.slice(1)}, then run again.`;
  } else if (hidden.kind === 'split') {
    detail = `the table at line ${hidden.table} is not read whole - at line ${hidden.line}, ${hidden.detail}. A row written `
      + 'now would be numbered and placed as if the rows no check reads were not there. Fix that line, then run again.';
  } else if (hidden.runaway) {
    detail = `an HTML comment that starts at line ${hidden.line} is cut off at line ${hidden.runaway}, where the block `
      + 'holding it ends, and GitHub leaves it open to the end of the file, so a table below it is not read, and a row '
      + 'written at its end would be hidden too. Close the comment inside its block, then run again.';
  } else if (hidden.kind === 'not-a-table') {
    const [reason, remedy] = notATable(hidden.why);
    detail = `the table at line ${hidden.line} is not a table on GitHub: ${reason}. No check reads its rows, and a new `
      + 'table would leave them behind and number its own from the first id again. '
      + `${remedy[0].toUpperCase()}${remedy.slice(1)}, then run again.`;
  } else if (hidden.kind === 'unread') {
    // Of a file whose lines a carriage return alone ends the kit cannot tell what GitHub shows (F-5);
    // a table before the one the checks read is named with it (F-1).
    const [reason, remedy] = UNREAD[hidden.shape];
    const Remedy = `${remedy[0].toUpperCase()}${remedy.slice(1)}`;
    const cr = hidden.shape === 'cr';
    const before = hidden.before ? ` before the table at line ${hidden.before} that the checks read` : '';
    detail = cr
      ? `the table at line ${hidden.line} cannot be judged: ${reason}, so no check can tell whether GitHub shows it${before}. `
      : `the table at line ${hidden.line} is shown on GitHub${before}, but no check reads it: ${reason}. `;
    if (hidden.before) {
      detail += cr
        ? 'A row written now could go to the wrong table and repeat an id it holds. '
        : `A row written now would go to the table at line ${hidden.before}, which GitHub shows after it, and could repeat an id `
          + 'the first one holds. ';
    } else {
      detail += `A new table ${cr ? 'could' : 'would'} stand beside it and number its own rows from the first id again. `;
    }
    detail += `${Remedy}, then run again.`;
  } else if (hidden.footnote && !hidden.open) {
    detail = 'its table stands in a footnote definition, and GitHub shows the footnotes below the body, where '
      + `${blockNamed(hidden)} in the footnote definition at line ${hidden.footnote} is left open and hides what follows `
      + 'it, so no check reads its rows, and a new table would leave them behind and number its own from the first id '
      + 'again. Close the comment inside its footnote definition, then run again.';
  } else {
    const block = blockNamed(hidden);
    detail = hidden.open
      ? `the file ends inside ${block} and is never closed, so a table in it is not read, and a row written at its end `
        + 'would be in it too. Close the block where it should end, then run again.'
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
 * reader reads it (`tableHidden`, ADR-0204): by default its evidence and sources tables, else the
 * `[path, header]` pairs given. The writer refuses too, but only after the fetch, and the capture
 * it leaves with no row is a cache hit the next run never writes a row for.
 */
export function assertTablesWritable(root, tables = [[PATHS.evidence, HEADERS.evidence], [PATHS.sources, HEADERS.sources]]) {
  for (const [rel, header] of tables) {
    const hidden = tableHidden(readText(resolve(root, rel), ''), header);
    if (hidden) throw tableHiddenError(rel, hidden);
  }
}

/**
 * Append one row to an artifact's table, creating the table when it is absent - and refusing,
 * with nothing written, where the row would be hidden from every reader or numbered past rows
 * no reader reads (`tableHidden`).
 */
export function appendRow(root, rel, header, cells) {
  const file = resolve(root, rel);
  const text = readText(file, '');
  // Started below a fence or a comment never closed, the table was written inside it, read by
  // nothing, and its row numbered from the first id again on every run - E-01 cited by the
  // builder, then resolved to another page once the block was closed (review of #441).
  const { table, hidden } = writeCheck(text, header);
  if (hidden) throw tableHiddenError(rel, hidden);
  return appendChecked(file, text, header, cells, table);
}

/**
 * Writes `cells` as a new row of `table`, the table `writeCheck` found in `text` - the file as the
 * writer read it - creating the table when it is absent. The writers share it so that a write
 * reads and judges its file once: `upsertRow` once handed a new key to `appendRow`, which read the
 * file again and ran the reader again (re-review of #441, F-6).
 */
function appendChecked(file, text, header, cells, table) {
  const onDisk = table.found ? table.header : null;
  const line = tableRow(alignToHeader(header, cells, onDisk));
  if (!onDisk) {
    const head = `${tableRow(header)}\n|${header.map(() => '---').join('|')}|\n`;
    writeText(file, `${text.trimEnd()}\n\n${head}${line}\n`.replace(/^\n+/, ''));
    return line;
  }
  const lines = text.split(/\r?\n/);
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
  const { table, hidden } = writeCheck(text, header);
  if (hidden) throw tableHiddenError(rel, hidden);
  const onDisk = table.found ? table.header : null;
  const aligned = alignToHeader(header, cells, onDisk);
  // The key is the canonical first column's value, matched in whichever position that
  // column occupies on disk.
  const keyAt = onDisk ? onDisk.findIndex((name) => name.trim().toLowerCase() === header[0].trim().toLowerCase()) : 0;
  const key = String(cells[0]).trim().toLowerCase();
  const found = table.rows.find((r) => String(r.cells[keyAt < 0 ? 0 : keyAt]).trim().toLowerCase() === key);
  if (!found) return appendChecked(file, text, header, cells, table);
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
