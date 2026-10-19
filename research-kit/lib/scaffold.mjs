// scaffold.mjs - the canonical project shape has one owner (ADR-0001).
//
// LAYOUT is the structure; `template/` is the content. Every consumer derives from
// LAYOUT: the gate predicate reads GATE_MARKERS, the scaffolder writes it, the test
// fixture calls the same function, and doctor judges shape against it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, resolve, exists, isDirectory, readText, writeText, ensureDir, listFiles, today, keepBackup } from './core.mjs';
import { readCorpus } from './corpus.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(here, '..');
export const TEMPLATE_DIR = path.join(KIT_ROOT, 'template');

/**
 * The canonical project shape: 12 entries. `gating: true` marks the four artifacts whose
 * presence makes a project gated; `dir: true` marks a directory.
 */
export const LAYOUT = Object.freeze([
  { path: PATHS.agents, required: true, gating: false },
  { path: PATHS.architecture, required: false, gating: false },
  { path: PATHS.gitattributes, required: false, gating: false },
  { path: PATHS.kit, required: false, gating: false },
  { path: PATHS.discovery, required: true, gating: true },
  { path: PATHS.map, required: false, gating: false },
  { path: PATHS.evidence, required: true, gating: true },
  { path: PATHS.sources, required: false, gating: false },
  { path: PATHS.timeline, required: false, gating: false },
  { path: PATHS.brief, required: false, gating: false },
  { path: PATHS.plan, required: true, gating: true },
  { path: PATHS.raw, required: true, gating: true, dir: true },
]);

/** Exactly four. Adding one changes which projects are gated - that needs a new ADR. */
export const GATE_MARKERS = Object.freeze(LAYOUT.filter((e) => e.gating).map((e) => e.path));

/** A hook git cannot execute is a hook git skips, silently, reporting the commit clean. */
export const HOOK_MODE = 0o755;

export function hookExecutability(file) {
  if (!exists(file)) return { ok: false, reason: 'missing', file };
  if (process.platform === 'win32') return { ok: true, reason: 'no-executable-bit-on-this-platform', file };
  const mode = fs.statSync(file).mode & 0o777;
  if (mode & 0o111) return { ok: true, reason: 'executable', file, mode };
  return { ok: false, reason: 'not-executable', file, mode, fix: `chmod +x ${file}` };
}

// ---------------------------------------------------------------- template rendering

export function renderTemplate(text, tokens) {
  return String(text).replace(/\{\{([A-Z_]+)\}\}/g, (all, name) => (
    Object.prototype.hasOwnProperty.call(tokens, name) ? String(tokens[name]) : all
  ));
}

/** Where `new-project --force` keeps the scaffolding it replaces outside research/ (#301). */
const BACKUP_DIR = 'research/backups';

/**
 * Whether `text` is this template with SOME token values - a scaffold nobody edited, whatever
 * topic, date or kit spelling it was written with. Forcing a new topic over one has nothing
 * to keep (#301), as `brief --force` keeps nothing of an unedited draft.
 */
function isUneditedTemplate(source, text) {
  const fold = (value) => String(value).replace(/\r\n/g, '\n');
  const literal = fold(source).split(/\{\{[A-Z_]+\}\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${literal.join('[^\\n]*')}$`).test(fold(text));
}

/**
 * An unresolved `{{TOKEN}}` in a written file is a scaffold defect, not a placeholder.
 *
 * An occurrence inside an inline code span is a document QUOTING the token - which is
 * what `docs/ARCHITECTURE.md` does when it explains that the two `START_HERE.md` copies
 * "differ only in how the kit path is spelled (`$HOME/.agents/research-kit` vs `{{KIT}}`)".
 * Flagging that made doctor permanently red on a correct project, and a diagnostic that
 * is always red is one nobody reads (ADR-0010's own argument).
 *
 * The narrow cost: a genuinely unrendered token inside a code span is missed here. That
 * is covered where it belongs - `scaffoldProject` renders every token in every template
 * file unconditionally, and a test asserts a fresh scaffold holds none anywhere. This
 * check is the downstream net, not the guarantee.
 */
export function unresolvedPlaceholders(text) {
  const prose = String(text).replace(/`[^`\n]*`/g, ' ');
  return [...new Set([...prose.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))];
}

function walk(dir, base = dir, out = []) {
  for (const name of listFiles(dir).sort()) {
    const abs = path.join(dir, name);
    if (isDirectory(abs)) walk(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

export function templateFiles(templateDir = TEMPLATE_DIR) {
  return walk(templateDir);
}

// ---------------------------------------------------------------- writing the shape

/**
 * Files whose kit lines are merged into an operator's own copy instead of being skipped.
 * `.gitignore` keeps credentials out and the ledger in; `.gitattributes` keeps the corpus
 * LF. Skipping them because a file of that name existed lost both (found 2026-09-27: a
 * .env was staged by `git add -A`).
 */
export const MERGED_FILES = Object.freeze(['.gitignore', '.gitattributes']);
const MERGE_MARK = '# research-kit: the kit\'s rules, added because this file already existed';

/** The template's rule lines this file lacks - comments and blank lines aside. */
export function missingKitLines(root, rel, templateDir = TEMPLATE_DIR) {
  const own = readText(resolve(root, rel));
  if (own === null) return [];
  // Compared with whitespace collapsed: aligned columns are the same rule.
  const norm = (line) => line.trim().replace(/\s+/g, ' ');
  const have = new Set(own.split(/\r?\n/).map(norm));
  const kit = readText(path.join(templateDir, ...rel.split('/')), '');
  return kit.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !have.has(norm(line)));
}

/** The first line of the kit's AGENTS.md: a file without it is somebody else's. */
const AGENTS_MARK = '# Research-first project bootstrap';

/** Structure is always repaired; content is never clobbered without `force`. */
/** The topic a project gets when none is given: a placeholder, never a topic. */
export const UNTITLED_TOPIC = 'Untitled topic';

export function scaffoldProject(dir, { topic = UNTITLED_TOPIC, kit = '$HOME/.agents/research-kit', force = false, templateDir = TEMPLATE_DIR, date = today() } = {}) {
  // `force` re-scaffolds around whatever is here, and a ledger with entries is evidence that
  // is never edited: templates written around it left captures no row cites, the state
  // handoff exists to catch (#301). Refused before anything is written.
  if (force) {
    const entries = (readText(resolve(dir, PATHS.ledger), '') ?? '').split(/\r?\n/).filter((line) => line.trim()).length;
    if (entries) {
      const rows = readCorpus(dir).evidence.length;
      const err = new Error(`${dir} holds a collected corpus (${entries} ledger ${entries === 1 ? 'entry' : 'entries'}, ${rows} evidence ${rows === 1 ? 'row' : 'rows'}) - `
        + '--force would write templates around it. A different topic is a different project; scaffold it in a new folder.');
      err.code = 'COLLECTED_CORPUS';
      throw err;
    }
  }
  const written = [];
  const skipped = [];
  const merged = [];
  const repaired = [];
  const backups = [];
  // A folder created in a brand-new project is part of scaffolding it, not a repair:
  // "repaired 1" on a fresh project read as if something had been broken. "Existed" means
  // it was already a kit project - its research/ folder - not that the operator had a
  // .gitignore of their own there (found 2026-09-27).
  const existed = isDirectory(resolve(dir, 'research'));

  for (const entry of LAYOUT) {
    const abs = resolve(dir, entry.path);
    if (entry.dir) {
      if (!isDirectory(abs)) { ensureDir(abs); if (existed) repaired.push(entry.path); }
      const keep = path.join(abs, '.gitkeep');
      if (!exists(keep)) writeText(keep, '');
      continue;
    }
    ensureDir(path.dirname(abs));
  }

  const tokens = { TOPIC: topic, DATE: date, KIT: kit, SLUG: topic.toLowerCase().replace(/[^a-z0-9]+/g, '-') };

  // A token substituted into JSON must be escaped FOR JSON.
  //
  // `template/research/plan.json` holds `"topic": "{{TOPIC}}"`, and the substitution is
  // textual. A topic containing a double quote - `Why "agentic" search costs more` - ends
  // the string early and writes a plan.json that does not parse, so `research.mjs` reads
  // an empty plan and collects nothing, reporting a corpus problem about a file the
  // operator never edited. A backslash or a newline does the same.
  //
  // Escaped per FILE rather than per token: the markdown templates want the topic
  // verbatim, and escaping it there would put `\"` into prose. `JSON.stringify` minus its
  // surrounding quotes is exactly the string-interior encoding these templates need.
  const jsonTokens = Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [name, JSON.stringify(String(value)).slice(1, -1)]),
  );

  for (const rel of templateFiles(templateDir)) {
    const target = resolve(dir, rel);
    if (exists(target) && !force && MERGED_FILES.includes(rel)) {
      // Appended, so the operator's lines keep their order and the kit's negations
      // (`!research/raw/.fetches.jsonl`) come after any broader rule of theirs.
      const missing = missingKitLines(dir, rel, templateDir);
      if (!missing.length) { skipped.push(rel); continue; }
      const own = readText(target, '');
      writeText(target, `${own.replace(/\s*$/, '')}\n\n${MERGE_MARK}\n${missing.join('\n')}\n`);
      merged.push(rel);
      continue;
    }
    if (exists(target) && !force) { skipped.push(rel); continue; }
    const source = readText(path.join(templateDir, ...rel.split('/')), '');
    const body = renderTemplate(source, rel.endsWith('.json') ? jsonTokens : tokens);
    // What `force` replaces is kept, as `brief --force` keeps a brief (#301) - unless it is
    // the template as scaffolded, with nobody's edit in it. A file under research/ is kept
    // beside itself; scaffolding outside it (AGENTS.md, .gitignore, docs/ARCHITECTURE.md) is
    // kept under research/backups/, because phase 1 may commit research/ and the root
    // scaffolding names only, so `<file>.bak-<date>` beside AGENTS.md blocked the next commit.
    const before = exists(target) ? readText(target, '') : '';
    if (before.trim() && before !== body && !isUneditedTemplate(source, before)) {
      backups.push(keepBackup(dir, rel.startsWith('research/') ? rel : `${BACKUP_DIR}/${rel}`, before, date));
    }
    writeText(target, body);
    written.push(rel);
  }

  return { dir, written, skipped, merged, repaired, backups };
}

/** Shape with no content - the test fixture and the scaffolder are the same call. */
export function createEmptyProject(dir) {
  for (const entry of LAYOUT) {
    const abs = resolve(dir, entry.path);
    if (entry.dir) { ensureDir(abs); writeText(path.join(abs, '.gitkeep'), ''); continue; }
    ensureDir(path.dirname(abs));
    if (!exists(abs)) writeText(abs, '');
  }
  return dir;
}

// ---------------------------------------------------------------- judging the shape

/**
 * Shape problems only. It never judges contract CONTENT - that stays preflight's job.
 */
export function validateProject(root) {
  const findings = [];
  for (const entry of LAYOUT) {
    const abs = resolve(root, entry.path);
    const there = entry.dir ? isDirectory(abs) : exists(abs);
    if (there) continue;
    findings.push({
      severity: entry.gating || entry.required ? 'fail' : 'warn',
      rule: 'shape-missing',
      path: entry.path,
      detail: `${entry.path} is missing from the project shape`,
    });
  }
  for (const entry of LAYOUT) {
    if (entry.dir) continue;
    const text = readText(resolve(root, entry.path));
    if (text === null) continue;
    const tokens = unresolvedPlaceholders(text);
    if (!tokens.length) continue;
    findings.push({
      severity: 'fail',
      rule: 'unresolved-placeholder',
      path: entry.path,
      detail: `${entry.path} still holds ${tokens.map((t) => `{{${t}}}`).join(', ')}`,
    });
  }
  for (const rel of MERGED_FILES) {
    const missing = missingKitLines(root, rel);
    if (!missing.length) continue;
    findings.push({
      severity: 'warn',
      rule: 'kit-rules-missing',
      path: rel,
      detail: `${rel} lacks the kit's rules (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? `, +${missing.length - 4} more` : ''}) - re-run new-project here to add them`,
    });
  }
  const agents = readText(resolve(root, 'AGENTS.md'));
  if (agents !== null && !agents.includes(AGENTS_MARK)) {
    findings.push({
      severity: 'warn',
      rule: 'agents-md-foreign',
      path: 'AGENTS.md',
      detail: `AGENTS.md is this folder's own and carries none of the research-first rules, so an agent here will not see them - add the kit's version (${path.join(TEMPLATE_DIR, 'AGENTS.md')}) to it by hand`,
    });
  }
  return { ok: !findings.some((f) => f.severity === 'fail'), findings };
}
