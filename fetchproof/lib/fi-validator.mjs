// Offline, read-only validator for the FI-01--FI-30 workbook evidence bundle.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonNoDuplicates, validateJsonSchema } from './release-validator.mjs';
import { openZip, ZipError } from './artifact-zip.mjs';

export const FI_IDS = Array.from({ length: 30 }, (_, index) => `FI-${String(index + 1).padStart(2, '0')}`);
export const FI_STATUS_PRECEDENCE = ['PASS', 'INCOMPLETE', 'ROLLED-BACK', 'BLOCKED', 'FAIL', 'REOPEN'];
const RANK = Object.fromEntries(FI_STATUS_PRECEDENCE.map((value, index) => [value, index]));
const SCHEMA_DIR = fileURLToPath(new URL('../schemas/', import.meta.url));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function issue(errors, code, message, status = 'FAIL', fiId = null) { errors.push({ code, message, status, fiId }); }
function reduceStatus(items) { return items.reduce((current, item) => RANK[item.status] > RANK[current] ? item.status : current, 'PASS'); }
function inside(root, candidate) { const relative = path.relative(root, candidate); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); }
function readJson(file, errors, code, status = 'FAIL') {
  try { return parseJsonNoDuplicates(fs.readFileSync(file, 'utf8')); }
  catch (error) { issue(errors, code, error.message, status); return null; }
}
function schema(file, value, errors, prefix) {
  const source = readJson(file, errors, `${prefix}-SCHEMA-READ`);
  if (!source || value === null) return;
  for (const error of validateJsonSchema(value, source, { errors: [] })) issue(errors, `${prefix}-${error.code}`, error.message, 'FAIL');
}
function validEvidencePath(root, manifestRoot, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0')) return null;
  const evidenceRoot = path.resolve(root, manifestRoot);
  const target = path.resolve(root, relative);
  return inside(evidenceRoot, target) ? target : null;
}

/** Read-only semantic validation. `workbookProjection` is injectable for offline tests. */
export function validateFiBundle({ root, workbook, recordsDir, manifest, workbookProjection = null } = {}) {
  const errors = [];
  const cases = [];
  const resolvedRoot = path.resolve(root ?? '.');
  const manifestValue = manifest ? readJson(manifest, errors, 'MANIFEST-READ', 'INCOMPLETE') : null;
  const manifestSchema = path.join(SCHEMA_DIR, 'fi-evidence-manifest.schema.json');
  schema(manifestSchema, manifestValue, errors, 'MANIFEST');
  const entries = new Map();
  for (const entry of manifestValue?.entries ?? []) {
    if (entries.has(entry.evidenceId)) issue(errors, 'EVIDENCE-DUPLICATE', `duplicate evidence ID ${entry.evidenceId}`);
    else entries.set(entry.evidenceId, entry);
    const file = validEvidencePath(resolvedRoot, manifestValue?.root ?? '', entry.path);
    if (!file || !fs.existsSync(file) || !fs.lstatSync(file).isFile()) { issue(errors, 'EVIDENCE-PATH', `evidence path is missing or escapes root: ${entry.path}`, 'FAIL', entry.fiId); continue; }
    const bytes = fs.readFileSync(file);
    if (bytes.length !== entry.byteLength || sha256(bytes) !== entry.sha256) issue(errors, 'EVIDENCE-HASH', `evidence bytes do not match manifest: ${entry.evidenceId}`, 'FAIL', entry.fiId);
  }
  let workbookHash = null;
  try { workbookHash = sha256(fs.readFileSync(workbook)); } catch (error) { issue(errors, 'WORKBOOK-READ', error.message, 'INCOMPLETE'); }
  const records = new Map();
  if (!recordsDir || !fs.existsSync(recordsDir)) issue(errors, 'RECORD-MISSING', 'sidecar directory is absent', 'INCOMPLETE');
  else for (const name of fs.readdirSync(recordsDir).sort()) {
    if (!name.endsWith('.json')) { issue(errors, 'RECORD-EXTRA', `non-JSON record entry ${name}`); continue; }
    const value = readJson(path.join(recordsDir, name), errors, 'RECORD-READ');
    schema(path.join(SCHEMA_DIR, 'fi-signoff-sidecar.schema.json'), value, errors, 'RECORD');
    if (!value?.fiId) continue;
    if (records.has(value.fiId)) issue(errors, 'RECORD-DUPLICATE', `duplicate FI sidecar ${value.fiId}`, 'FAIL', value.fiId);
    else records.set(value.fiId, value);
  }
  const projection = workbookProjection ?? readFiWorkbookProjection(workbook, errors);
  const requiredSheets = ['Index', 'Roll-up', ...FI_IDS];
  if (!Array.isArray(projection?.sheets) || requiredSheets.some((id, index) => projection.sheets[index] !== id) || projection.sheets.length !== requiredSheets.length) issue(errors, 'WB-SHEET-ID', 'workbook must contain Index, Roll-up, and FI-01..FI-30 in order');
  for (const fiId of FI_IDS) {
    const local = [];
    const add = (code, message, status = 'FAIL') => issue(local, code, message, status, fiId);
    const record = records.get(fiId);
    if (!record) add('RECORD-MISSING', `missing sidecar ${fiId}`, 'INCOMPLETE');
    else {
      if (record.workbookSha256 !== workbookHash) add('WORKBOOK-HASH', 'sidecar workbook hash differs from supplied workbook');
      const checkEvidence = (id, declaredHash, label = null) => {
        const entry = entries.get(id);
        if (!entry) return add('EVIDENCE-MISSING', `sidecar reference ${id} has no manifest entry`, 'INCOMPLETE');
        if (entry.fiId !== fiId || (label && entry.fieldLabel !== label)) add('EVIDENCE-OWNER', `evidence ${id} has wrong FI owner or field label`);
        if (declaredHash && entry.sha256 !== declaredHash) add('EVIDENCE-HASH', `sidecar hash differs from manifest for ${id}`);
      };
      for (const field of record.fields ?? []) field.evidenceIds.forEach((id, index) => checkEvidence(id, field.evidenceHashes[index], field.label));
      for (const id of record.containment?.proofEvidenceIds ?? []) checkEvidence(id);
      if (record.status === 'ROLLED-BACK') checkEvidence(record.rollback?.receiptEvidenceId);
      const caseStatus = projection?.caseStatuses?.[fiId] ?? null;
      const indexStatus = projection?.indexStatuses?.[fiId] ?? null;
      const rollupStatus = projection?.rollupStatuses?.[fiId] ?? null;
      if (!caseStatus) add('FI-FIELD-MISSING', 'Case disposition is absent', 'INCOMPLETE');
      else if (caseStatus !== record.status) add('FI-PROJECTION-MISMATCH', 'case disposition differs from sidecar status');
      if (indexStatus !== caseStatus) add('FI-INDEX-MISMATCH', 'Index completion status differs from case disposition', 'REOPEN');
      if (rollupStatus !== caseStatus) add('FI-ROLLUP-MISMATCH', 'Roll-up status differs from case disposition', 'REOPEN');
    }
    cases.push({ fiId, status: reduceStatus(local), errors: local }); errors.push(...local);
  }
  return { validatorVersion: '1.0.0', status: reduceStatus(errors), cases, errors };
}

// A deliberately small XLSX reader: reads visible sheet names and status cells, and never
// writes or invokes an office application. The workbook is the one input of fi-validate that
// comes from outside, so its container is read through artifact-zip.mjs (#318): every entry
// is judged from the central directory - names, count, size, ratio - before one byte is
// inflated, and an entry is inflated under `maxOutputLength` only when a sheet needs it, and
// at most once: the text is kept, so a name read again costs nothing. A refusal names its ZIP
// code and is reported as WB-PACKAGE-UNTRUSTED by the caller.
function zipEntries(file) {
  const zip = openZip(fs.readFileSync(file));
  if (zip.problems.length) throw new Error(`XLSX package refused: ${zip.problems.map((p) => `${p.code} ${p.detail}`).join('; ')}`);
  const read = new Map();
  const text = (name) => {
    if (!read.has(name)) read.set(name, zip.has(name) ? zip.read(name).toString('utf8') : '');
    return read.get(name);
  };
  return { text };
}
// The XML is read by linear scans, not by the regular expressions they replace (#318 review):
// `/<(?:\w+:)?c\s+([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g` and its siblings rescanned to the end of the
// text for every opening with no closing, so 256 KiB of `<c a>` took 55 s. Each scan matches
// what its expression matched - the fuzz test holds them to it - with one correction: a tag
// ending in `/>` is an empty element. The expressions took a styled empty cell, `<c r="G5"
// s="1"/>`, for an opening and ran to the next cell's `</c>`, so G5 took H5's value and the
// status in H5 was lost. An opening's tag ends at the first `>` after it, so once no closing
// tag follows one opening, none follows any later one: only self-closing tags can still match.
const isWord = (ch) => ch !== undefined && /\w/.test(ch);
const isSpace = (ch) => ch !== undefined && /\s/.test(ch);
// What may follow the element name inside its opening tag: `\s+[^>]*` ('space'), nothing
// ('none'), `[^>]*` ('any') or `\b[^>]*` ('boundary').
function restFits(xml, at, rest) {
  if (rest === 'space') return isSpace(xml[at]);
  if (rest === 'none') return xml[at] === '>';
  if (rest === 'boundary') return !isWord(xml[at]);
  return true;
}
/** `<(?:\w+:)?NAME` plus `rest` at `s`: the index after NAME, or -1. */
function openTag(xml, s, name, rest) {
  if (xml[s] !== '<') return -1;
  let k = s + 1;
  while (isWord(xml[k])) k += 1;
  const fits = (at) => xml.startsWith(name, at) && restFits(xml, at + name.length, rest);
  if (k > s + 1 && xml[k] === ':' && fits(k + 1)) return k + 1 + name.length;
  return fits(s + 1) ? s + 1 + name.length : -1;
}
/** `<\/(?:\w+:)?NAME>` at `q`: the index after it, or -1. */
function closeTagEnd(xml, q, name) {
  const close = `${name}>`;
  let k = q + 2;
  while (isWord(xml[k])) k += 1;
  if (k > q + 2 && xml[k] === ':' && xml.startsWith(close, k + 1)) return k + 1 + close.length;
  return xml.startsWith(close, q + 2) ? q + 2 + close.length : -1;
}
/**
 * Each match of `/<(?:\w+:)?NAME<rest>>([\s\S]*?)<\/(?:\w+:)?NAME>/g` as `{ attrs, body }`,
 * except that an opening tag ending in `/>` is an empty element (`body` ''). `attrs` is the tag
 * text after the name and its leading whitespace, as the expression captured it.
 */
export function* xmlElements(xml, name, rest) {
  let closed = false;   // no closing tag remains: only a self-closing tag can match now
  for (let pos = 0; ;) {
    const s = xml.indexOf('<', pos);
    if (s < 0) return;
    const a = openTag(xml, s, name, rest);
    if (a < 0) { pos = s + 1; continue; }
    const e = xml.indexOf('>', a);
    if (e < 0) return;
    let w = a;
    if (rest === 'space') while (w < e && isSpace(xml[w])) w += 1;
    // Every opening inside this tag ends at the same `>`, so none of them can match if it does not.
    if (xml[e - 1] === '/') { yield { attrs: xml.slice(w, e), body: '' }; pos = e + 1; continue; }
    if (closed) { pos = e + 1; continue; }
    let q = xml.indexOf('</', e + 1);
    let end = -1;
    while (q >= 0 && (end = closeTagEnd(xml, q, name)) < 0) q = xml.indexOf('</', q + 1);
    if (q < 0) { closed = true; pos = e + 1; continue; }
    yield { attrs: xml.slice(w, e), body: xml.slice(e + 1, q) };
    pos = end;
  }
}
const firstBody = (xml, name, rest) => { for (const { body } of xmlElements(xml, name, rest)) return body; return undefined; };
function positionsOf(xml, needle, from, to) {
  const out = [];
  for (let i = xml.indexOf(needle, from); i >= 0 && i < to; i = xml.indexOf(needle, i + 1)) out.push(i);
  return out;
}
/** The last `sheetId="<digits>"` in [from, to), as the expression's greedy `[^>]*` finds it. */
function lastSheetId(xml, from, to) {
  const ids = positionsOf(xml, 'sheetId="', from, to);
  for (let n = ids.length - 1; n >= 0; n -= 1) {
    let r = ids[n] + 9;
    while (r < xml.length && xml[r] >= '0' && xml[r] <= '9') r += 1;
    if (r > ids[n] + 9 && xml[r] === '"') return { at: ids[n], digits: xml.slice(ids[n] + 9, r) };
  }
  return null;
}
/**
 * Each match of `/<(?:\w+:)?sheet\b[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"[^>]*>/g` as
 * `{ name, sheetId }`: the last `name="..."` in the tag with a `sheetId="..."` after it, and the
 * last such sheetId - the greedy `[^>]*` backtracks from the right. A tag that fails is skipped
 * whole: every opening before its `>` sees a subset of the same candidates.
 */
export function* xmlSheetTags(xml) {
  for (let pos = 0; ;) {
    const s = xml.indexOf('<', pos);
    if (s < 0) return;
    const a = openTag(xml, s, 'sheet', 'boundary');
    if (a < 0) { pos = s + 1; continue; }
    const g1 = xml.indexOf('>', a);
    if (g1 < 0) return;
    const inTag = lastSheetId(xml, a, g1);
    let found = null;
    const names = positionsOf(xml, 'name="', a, g1);
    for (let n = names.length - 1; n >= 0 && !found; n -= 1) {
      const v0 = names[n] + 6;
      const q1 = xml.indexOf('"', v0);
      if (q1 <= v0) continue;   // no closing quote, or an empty name: `[^"]+` needs one character
      if (q1 < g1) {
        if (inTag && inTag.at > q1) found = { name: xml.slice(v0, q1), sheetId: inTag.digits, end: g1 + 1 };
      } else {
        // `[^"]+` crosses the tag's `>`: only the last name can, and its own `[^>]*` runs to the next one.
        const g2 = xml.indexOf('>', q1 + 1);
        const id = g2 < 0 ? null : lastSheetId(xml, q1 + 1, g2);
        if (id) found = { name: xml.slice(v0, q1), sheetId: id.digits, end: g2 + 1 };
      }
    }
    if (found) { yield { name: found.name, sheetId: found.sheetId }; pos = found.end; } else pos = g1;
  }
}
function decode(value) { return String(value ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))); }
function cells(xml, shared) { const out = new Map(); for (const { attrs, body } of xmlElements(xml, 'c', 'space')) { const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]; if (!ref) continue; const type = /\bt="([^"]+)"/.exec(attrs)?.[1]; const raw = firstBody(body, 'v', 'none') ?? firstBody(body, 't', 'any') ?? ''; out.set(ref, type === 's' ? shared[Number(raw)] : decode(raw)); } return out; }
export function readFiWorkbookProjection(workbook, errors = []) {
  try {
    const { text } = zipEntries(workbook);
    const shared = [...xmlElements(text('xl/sharedStrings.xml'), 'si', 'boundary')].map((si) => decode([...xmlElements(si.body, 't', 'any')].map((t) => t.body).join('')));
    const names = [...xmlSheetTags(text('xl/workbook.xml'))].map((tag) => ({ name: decode(tag.name), index: Number(tag.sheetId) }));
    // A workbook that does not name exactly Index, Roll-up and the thirty cases is refused by
    // validateFiBundle (WB-SHEET-ID) whatever its cells say, so no sheet is parsed for it: a
    // workbook.xml naming one large sheet hundreds of times made each name a full parse.
    if (names.length !== FI_IDS.length + 2) return { sheets: names.map((row) => row.name), caseStatuses: {}, indexStatuses: {}, rollupStatuses: {} };
    const parsed = new Map();   // sheet index -> cells, so two names on one sheet parse it once
    const cellsOf = (index) => {
      if (!parsed.has(index)) parsed.set(index, cells(text(`xl/worksheets/sheet${index}.xml`), shared));
      return parsed.get(index);
    };
    const sheetCells = new Map(names.map(({ name, index }) => [name, cellsOf(index)]));
    const value = (name, ref) => sheetCells.get(name)?.get(ref) || null; const caseStatuses = {}, indexStatuses = {}, rollupStatuses = {};
    for (let i = 1; i <= 30; i += 1) { const id = `FI-${String(i).padStart(2, '0')}`; const sheet = sheetCells.get(id); let disposition = null; for (const [ref, label] of sheet ?? []) if (label === 'Case disposition') { disposition = value(id, `D${ref.match(/\d+/)[0]}`); break; } caseStatuses[id] = disposition; indexStatuses[id] = value('Index', `H${i + 4}`); rollupStatuses[id] = value('Roll-up', `B${i + 22}`); }
    return { sheets: names.map((row) => row.name), caseStatuses, indexStatuses, rollupStatuses };
  } catch (error) { issue(errors, 'WB-PACKAGE-UNTRUSTED', error instanceof ZipError ? `${error.code} ${error.message}` : error.message); return null; }
}
