// render.mjs - terminal tables and Markdown findings. Presentation only (ADR-0143).

import path from 'node:path';

const SEVERITY_ORDER = { fail: 0, warn: 1, info: 2, pass: 3 };

export function renderTable(rows, columns) {
  if (!rows.length) return '';
  // Deliberately NOT `Math.max(col.header.length, ...rows.map(...))`. The spread passes
  // one ARGUMENT per row, and V8 runs out of stack somewhere past 100,000 of them:
  // measured 2026-09-28, 50,000 rows rendered and 200,000 threw
  // `RangeError: Maximum call stack size exceeded` - a crash with a raw stack trace
  // where a report is supposed to be. A fold has no ceiling and costs nothing.
  const widths = columns.map((col) => rows.reduce(
    (widest, row) => Math.max(widest, String(col.value(row) ?? '').length),
    col.header.length,
  ));
  const line = (cells) => cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
  const out = [line(columns.map((c) => c.header)), line(widths.map((w) => '-'.repeat(w)))];
  for (const row of rows) out.push(line(columns.map((c) => c.value(row))));
  return out.join('\n');
}

export function renderFindings(findings, { showPass = false } = {}) {
  const rows = findings
    .filter((f) => showPass || f.severity !== 'pass')
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  if (!rows.length) return '';
  return renderTable(rows, [
    { header: '', value: (f) => f.severity },
    { header: 'check', value: (f) => (f.rule && f.rule !== f.check ? `${f.check}/${f.rule}` : f.check) },
    { header: 'detail', value: (f) => f.detail },
  ]);
}

/** Preserve the supplied evaluation's warnings without re-running or interpreting it. */
export function renderGateWarnings(verdict) {
  if (!verdict) return '**Gate warnings: not evaluated in this run.**';
  if (!Array.isArray(verdict.warnings)) return '**Gate warnings: not supplied with this evaluation.**';
  const warnings = verdict.warnings;
  const lines = [
    `**Gate warnings from this evaluation: ${warnings.length}.**`,
    '',
    'These findings apply to the whole corpus at the time of this evaluation. Re-run',
    'preflight after edits; this list is not a fresh evaluation of the resulting document.',
  ];
  if (warnings.length) {
    lines.push('');
    for (const finding of warnings) {
      const code = finding.rule && finding.rule !== finding.check
        ? `${finding.check}/${finding.rule}` : finding.check;
      const targets = [finding.row, finding.unknown]
        .filter((value) => value !== undefined && value !== null && String(value) !== '')
        .map(String);
      lines.push(`- **${code}**${targets.length ? ` (${targets.join(', ')})` : ''}: ${finding.detail}`);
      if (finding.fix) lines.push(`  Fix: ${finding.fix}`);
    }
  }
  return lines.join('\n');
}

// What `printable` escapes, named by Unicode property so that no character a list leaves out
// passes: the controls (`Cc`: C0, DEL and C1, U+0085 among them), the line and paragraph separators
// (`Zl`, `Zp`), the format characters (`Cf`: the soft hyphen, the zero-width and directional marks,
// the bidirectional embeddings, overrides and isolates, the byte-order mark, the interlinear
// annotation marks, the tag characters), a surrogate that pairs with nothing (`Cs`), and every
// character Unicode lets a renderer draw as nothing (`Default_Ignorable_Code_Point`: besides those,
// the variation selectors, the Hangul fillers, the combining grapheme joiner). A list of BMP ranges
// let the tag characters U+E0000-E007F, the variation selectors and the Hangul fillers print raw,
// unseen in a line a person reads to decide (re-review of #442, second pass, 2026-11-06).
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * Text read from a package, with each character `UNPRINTABLE` names as `\xNN` (`\uNNNN` above
 * U+00FF, `\u{NNNNN}` above U+FFFF), so it cannot begin a line, drive the terminal or hide in it.
 * It escaped C0 and DEL alone, and a reader that splits lines on U+0085, U+2028 or U+2029 -
 * Python's `splitlines`, a JavaScript `^` under the `m` flag - read a line the package wrote, one
 * saying PASS among them (re-review of #442's follow-up, 2026-11-06).
 */
export function printable(value) {
  return String(value).replace(UNPRINTABLE, (character) => {
    const code = character.codePointAt(0);
    const hex = code.toString(16);
    return code > 0xffff ? `\\u{${hex}}` : code > 0xff ? `\\u${hex.padStart(4, '0')}` : `\\x${hex.padStart(2, '0')}`;
  });
}

/**
 * A file the kit wrote, as a person reads it: the folder as the operator gave it, and the name - the
 * one the artifact was stored under - passed through `clean`, then `printable`. Escaping the whole
 * path printed a folder whose name holds a joiner (Persian's U+200C, an emoji sequence's U+200D) as
 * one that does not exist, and on Windows the escape's backslash named another folder (re-review of
 * #442, second pass, 2026-11-06).
 */
export function printableFile(file, { clean = (text) => text } = {}) {
  const whole = String(file);
  const name = path.basename(whole);
  if (!name || !whole.endsWith(name)) return printable(clean(whole));
  return `${whole.slice(0, whole.length - name.length)}${printable(clean(name))}`;
}

/**
 * A package result's problems as a person reads them: the count, then each code and message, with
 * the remedy an error names as a `fix:` line under it; '' when there are none. `artifact.mjs`
 * (`validate` and `create`) and `collect-remote` print them so: collect-remote printed no remedy,
 * and its messages unescaped (re-review of #442, 2026-11-06). `clean` is asked of each field before
 * it is escaped: collect-remote passes `redact`, which an escape defeats - in `\x09ghp_...` no word
 * boundary comes before the token - so redacting the rendered text printed a credential that
 * followed a control character (re-review of the follow-up).
 */
export function renderProblems(errors, { clean = (text) => text } = {}) {
  if (!errors.length) return '';
  const shown = (value) => printable(clean(value));
  return [`${errors.length} problem(s)`, ...errors.flatMap((e) => [
    `  ${shown(e.code)}  ${shown(e.message)}`,
    ...(e.remedy ? [`      fix: ${shown(e.remedy)}`] : []),
  ])].join('\n');
}

export function heading(text) {
  return `\n${text}\n${'-'.repeat(text.length)}`;
}
