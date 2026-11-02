// firecrawl.mjs - ALL vendor knowledge lives here (ADR-0005, ADR-0020).
//
// The CLI transport. Its `exec` seam carries an ARGV ARRAY and spawns with
// `shell: false`: no URL and no query is ever concatenated into a shell string, because
// in this kit's threat model a plan.json travels through git and a query is pasted back
// from a web result - both are attacker-controlled data reaching the one module that
// leaves the process, on the one machine holding the API key.
//
// `command(args)` survives as a DISPLAY-ONLY rendering (dry-run output, the ledger's
// `cmd` annotation). Nothing executes it.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CHILD_OUTPUT_LIMIT, outputOverflow } from './runtime.mjs';
import { isRateLimited } from './fetch-failure.mjs';

export const name = 'firecrawl-cli';
/**
 * The same CLI, run without a key. A distinct transport because it is a distinct
 * guarantee: capped per IP rather than metered, and not reproducible from a credential.
 */
export const ANONYMOUS_NAME = 'firecrawl-cli-anonymous';
export const PROGRAM = 'firecrawl';

/** The seven-function shape both adapters hold. Pinned by test. */
export const ADAPTER_SHAPE = Object.freeze(['name', 'scrape', 'search', 'map', 'command', 'status', 'runScrape']);

/**
 * Windows cannot spawn a `.cmd` shim shell-less, so that one route still has an
 * interpreter in it. Every argument is validated against this set and REFUSED rather
 * than re-quoted - re-quoting is how injection bugs come back.
 */
export const CMD_UNSAFE_CHARS = /[%&|<>^()"`\r\n\t]/;

/**
 * Is this argument safe to cross a Windows `.cmd` shim?
 *
 * A DENYLIST of cmd.exe metacharacters, which is what
 * `docs/superpowers/plans/2026-09-16-researcher-windows-safe-hook-test-runner.md` sec 3
 * specifies: "Empty values, %, &, |, <, >, ^, parentheses, quotes, CR, LF, and tabs are
 * refused."
 *
 * It used to be an ALLOWLIST that happened to exclude the space, and the consequence was
 * total: every search query has spaces, so on Windows - where the CLI is a `.cmd` shim -
 * every single search was refused before it was sent. Measured, not reasoned about: four
 * planned queries, four refusals, zero credits spent, zero results. That is F01's sibling,
 * "ordinary Windows collection never launches", for the search half.
 *
 * A space is an argument SEPARATOR, not an injection vector: node quotes an argument
 * containing one, and inside double quotes cmd.exe neutralises everything except `%`
 * expansion and a closing `"` - both of which are refused here. The characters that can
 * break out are the ones listed above, and they are still refused rather than re-quoted.
 */
export function cmdSafeArg(value) {
  const text = String(value);
  return text.length > 0 && !CMD_UNSAFE_CHARS.test(text);
}

/** Kept as a predicate-shaped object so existing callers read the same way. */
export const CMD_SAFE_ARG = { test: cmdSafeArg };

/**
 * Which of these arguments would be refused, or `null` if none would.
 *
 * The plural, reporting form of `cmdSafeArg`. A caller validating an argv wants to tell
 * the operator WHICH argument is the problem, not merely that one of them is — and
 * building that list at each call site is how the answers drift apart.
 *
 * `null` rather than `[]` for the safe case, so a caller can write
 * `const bad = unsafeCmdArgs(argv); if (bad) …` without the empty array reading as a
 * failure. The shape is borrowed deliberately from the tree this kit ported its
 * validator layer from (ADR-0029), whose hostile-argv corpus is written against exactly
 * this signature — but the SEMANTICS are ours: that tree guards with a regex allowlist,
 * and this refuses on the `CMD_UNSAFE_CHARS` denylist above, for the reason that comment
 * gives.
 */
export function unsafeCmdArgs(args) {
  const bad = [];
  for (const arg of args) {
    const value = String(arg);
    if (!cmdSafeArg(value)) bad.push(value);
  }
  return bad.length > 0 ? bad : null;
}

// ---------------------------------------------------------------- program resolution

/** Full path off PATH + PATHEXT. Returns null when the program is not installed. */
export function resolveProgramPath(program = PROGRAM, env = process.env, platform = process.platform) {
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32'
    ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, program + ext.toLowerCase());
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* keep looking */ }
      const upper = path.join(dir, program + ext);
      try {
        if (fs.statSync(upper).isFile()) return upper;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

/**
 * How to invoke it: a real `.exe` is spawned directly; a `.cmd`/`.bat` goes through
 * cmd.exe as argv, and only after every argument passes CMD_SAFE_ARG.
 */
export function resolveInvocation(argv, { env = process.env, platform = process.platform, program = PROGRAM } = {}) {
  const resolved = resolveProgramPath(program, env, platform);
  if (!resolved) return { ok: false, reason: 'not-installed', detail: `${program} is not on PATH` };

  const ext = path.extname(resolved).toLowerCase();
  if (platform !== 'win32' || ext === '.exe' || ext === '') {
    return { ok: true, file: resolved, args: argv, shell: false, route: 'direct' };
  }
  const unsafe = unsafeCmdArgs(argv);
  if (unsafe) {
    return {
      ok: false,
      reason: 'unsafe-for-cmd-shim',
      detail: `refused ${unsafe.length} argument(s) that cannot cross a Windows .cmd shim safely: ${unsafe.join(' ')}`,
      remedy: 'use --transport http-keyless, which has no interpreter in the route',
    };
  }
  const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
  return { ok: true, file: comspec, args: ['/d', '/s', '/c', resolved, ...argv], shell: false, route: 'cmd-shim' };
}

// ---------------------------------------------------------------- the exec seam

/** The narrow seam: an argv array, never a command string. Injectable for tests. */
export function exec(argv, { env = process.env, platform = process.platform, spawn = spawnSync, timeout = 120_000, program = PROGRAM } = {}) {
  const invocation = resolveInvocation(argv, { env, platform, program });
  if (!invocation.ok) return { ok: false, status: null, stdout: '', stderr: invocation.detail, invocation };
  const result = spawn(invocation.file, invocation.args, {
    env, timeout, encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: CHILD_OUTPUT_LIMIT,
  });
  // Past the limit the output is cut, and a cut JSON answer must not be parsed as one.
  const overflow = outputOverflow(result, 'the Firecrawl CLI');
  if (overflow) return { ok: false, status: result.status, stdout: '', stderr: overflow, invocation };
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: stripAnsi(result.stdout ?? ''),
    stderr: stripAnsi(result.stderr ?? ''),
    invocation,
  };
}

/**
 * The ESC character is PART of the sequence. Omitting it stripped "[38;5;208m" and left
 * the escape itself sitting in the text, so every parser downstream saw a control
 * character where it expected a word boundary. Verified against real CLI output.
 */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

/** Display-only. Nothing executes this. */
export function command(argv) {
  return [PROGRAM, ...argv].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

// ---------------------------------------------------------------- payload normalisation

/**
 * The payload is the FIRST COMPLETE JSON value in stdout, whatever the CLI prints around it.
 *
 * It had been "the whole of stdout, or everything from the first bracket": a banner before
 * the JSON parsed only while it held no bracket, and anything after the JSON - a receipt
 * line, a trailing notice - made the whole of it unparseable. Both came back as null, and
 * null became a "collected" capture holding 0 characters (found 2026-10-02, break-test pass
 * 3, with a fake CLI on PATH). The 1.25.0 CLI prints credit receipts, so the trailing case
 * is one release away. Each bracket is tried as a start; the value ends where its brackets
 * balance outside strings; the first slice that parses is the payload.
 */
function parsePayload(stdout) {
  const text = stripAnsi(String(stdout)).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch { /* a banner before it, a receipt after it, or no JSON at all */ }
  // A banner's stray bracket never balances, so its scan runs to the end of the text; a
  // bounded number of starts keeps a bracket-strewn non-answer from costing starts * length.
  let starts = 0;
  for (let i = 0; i < text.length && starts < MAX_PAYLOAD_STARTS; i += 1) {
    const c = text[i];
    if (c !== '{' && c !== '[') continue;
    starts += 1;
    const end = jsonValueEnd(text, i);
    if (end < 0) continue;
    try { return JSON.parse(text.slice(i, end + 1)); } catch { /* not a value; try the next start */ }
  }
  return null;
}

/** How many bracket positions parsePayload tries before calling stdout no payload. */
const MAX_PAYLOAD_STARTS = 64;

/** Index of the bracket that closes the value opening at `start`, outside strings, or -1. */
function jsonValueEnd(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The completeness grade is EARNED, not stamped.
 *
 * This adapter used to write `completeness: 'full'` on every successful scrape. A
 * 167-character page came back graded full, and so would a page the extractor had
 * reduced to a nav bar. "The vendor returned main content" is not evidence that the
 * section a claim rests on arrived - and `capture-completeness`, the check that decides
 * whether a CLOSED unknown may rest on this capture alone, believed the stamp.
 *
 * The same bar as the keyless adapter, for the same reason and with the same words, so
 * the two transports cannot disagree about what `full` means.
 */
export const FULL_THRESHOLD = 1500;

export function gradeCompleteness(markdown) {
  const length = String(markdown ?? '').length;
  if (length >= FULL_THRESHOLD) return { completeness: 'full', omitted: '' };
  return {
    completeness: 'partial',
    omitted: `only ${length} characters of main content were returned (below the ${FULL_THRESHOLD}-character bar)`,
  };
}

/** A vendor field as text: anything that is not a string reads as empty. */
const text = (value) => (typeof value === 'string' ? value : '');

export function normalizeScrape(stdout, url, label = name) {
  const payload = parsePayload(stdout);
  const data = payload?.data ?? payload ?? {};
  // A field of the wrong type reads as empty, as in serpapi and searxng: the payload is the
  // vendor's, and a sourceURL arriving as an object was written as a capture with
  // `url: [object Object]` - a URL the kit never fetched, in the ledger (2026-09-30).
  // A status may be a number or a string; nothing else is one the error-page rule can judge.
  const status = (value) => (typeof value === 'string' || Number.isFinite(value) ? value : '');
  const markdown = text(data.markdown) || text(data.content) || text(data.text) || text(payload);
  return {
    url: text(data.metadata?.sourceURL) || text(data.url) || text(url),
    title: text(data.metadata?.title) || text(data.title),
    markdown,
    statusCode: status(data.metadata?.statusCode) || status(data.statusCode),
    transport: label,
    // The vendor's own account of where the bytes came from, kept when it sends one (ADR-0139).
    cacheState: text(data.metadata?.cacheState),
    cachedAt: text(data.metadata?.cachedAt),
    // The text the Markdown was converted from, kept beside the capture (ADR-0140).
    source: text(data.rawHtml) || text(data.html),
    ...gradeCompleteness(markdown),
  };
}

/**
 * The real v2 shape, captured from the CLI and pinned as a fixture:
 *
 *   { success: true, id, creditsUsed, data: { web: [ { url, title, description, position } ] } }
 *
 * `data` is an OBJECT keyed by source, not an array. The old parser did
 * `Array.isArray(payload.data)`, got false, and returned `[]` - so every search
 * succeeded, cost credits, and produced no candidates, silently. Four planned queries
 * came back with nothing and the run reported "collected 0" with no error anywhere.
 *
 * Other sources (`news`, `images`) are merged when present, because a caller asked for
 * them by passing `--sources`; anything without a URL is dropped as before.
 */
export function normalizeSearch(stdout) {
  const payload = parsePayload(stdout);
  const data = payload?.data;

  let rows = [];
  if (Array.isArray(data)) rows = data;                       // older / flat shape
  else if (data && typeof data === 'object') rows = Object.values(data).flatMap((v) => (Array.isArray(v) ? v : []));
  else if (Array.isArray(payload?.results)) rows = payload.results;
  else if (Array.isArray(payload)) rows = payload;

  // A row that is not an object is dropped, not read: one null among the results had thrown
  // and taken every valid row in the payload with it (2026-09-29, Arena break test). A FIELD
  // of the wrong type reads as empty, as in serpapi and searxng (2026-09-30).
  return rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row)).map((row) => ({
    url: text(row.url) || text(row.link),
    title: text(row.title),
    description: text(row.description) || text(row.snippet),
    position: Number.isFinite(row.position) ? row.position : null,
  })).filter((row) => row.url);
}

/** What the vendor says this call cost. Recorded rather than inferred from a tier table. */
export function creditsUsed(stdout) {
  const payload = parsePayload(stdout);
  return Number.isFinite(payload?.creditsUsed) ? payload.creditsUsed : null;
}

export function normalizeMap(stdout) {
  const payload = parsePayload(stdout);
  const links = payload?.links ?? payload?.data ?? payload ?? [];
  if (!Array.isArray(links)) return [];
  return links.map((link) => (typeof link === 'string' ? link : link?.url)).filter((url) => typeof url === 'string' && url);
}

/**
 * Written against REAL v1.23.3 output, pinned as a fixture in the transport tests:
 *
 *   firecrawl cli v1.23.3
 *   ● Authenticated via stored credentials
 *   Concurrency: 0/2 jobs (parallel scrape limit)
 *   Credits: 949 / 1,000 (95% left this cycle)
 *
 * The old regex looked for a number BEFORE the word "credits". This CLI puts the word
 * first, so it matched nothing and every run reported credits: null. That is the defect
 * O-4 of the hardening design predicted - "the collector's parsers remain unvalidated
 * against real payloads" - and it survived until a key existed to produce one.
 */
export function parseStatus(stdout) {
  const text = stripAnsi(String(stdout));
  const credits = text.match(/Credits:\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  const concurrency = text.match(/Concurrency:\s*(\d+)\s*\/\s*(\d+)/i);
  const version = text.match(/cli\s+v([\d.]+)/i);
  const num = (s) => Number(String(s).replace(/,/g, ''));

  return {
    authenticated: /\bauthenticated\b/i.test(text) && !/\bnot authenticated\b/i.test(text),
    credits: credits ? num(credits[1]) : null,
    creditLimit: credits ? num(credits[2]) : null,
    concurrencyInUse: concurrency ? Number(concurrency[1]) : null,
    concurrencyLimit: concurrency ? Number(concurrency[2]) : null,
    version: version ? version[1] : null,
    raw: text.trim(),
  };
}

// ---------------------------------------------------------------- the adapter

export function scrape(url, { execFn = exec, ...opts } = {}) {
  // `--max-age 0`: a scrape is a live fetch. Without it the vendor serves a cached copy up to
  // two days old, and a capture stamped with today's date could be yesterday's page (ADR-0139).
  // `--format markdown,rawHtml`: the page's HTML comes back beside the Markdown, at no extra
  // credit, and is kept beside the capture as its source (ADR-0140).
  const argv = ['scrape', String(url), '--only-main-content', '--max-age', '0', '--format', 'markdown,rawHtml', '--json'];
  const result = execFn(argv, opts);
  if (!result.ok) {
    return { ok: false, url, error: result.stderr || `firecrawl exited ${result.status}`, cmd: command(argv), transport: name };
  }
  // An exit of 0 is not a page. A cut payload, an empty stdout and a payload with no text
  // each became a capture of 0 characters - a ledger entry and an evidence row with nothing
  // behind them (found 2026-10-02, break-test pass 3). Each is a failed fetch, named.
  const stdout = String(result.stdout ?? '');
  if (!stdout.trim()) {
    return { ok: false, url, error: 'firecrawl exited 0 and printed nothing - no page was returned', cmd: command(argv), transport: name };
  }
  const payload = parsePayload(stdout);
  if (payload === null) {
    return { ok: false, url, cmd: command(argv), transport: name,
      error: `firecrawl exited 0 but printed no JSON payload that could be read - its output began: ${JSON.stringify(stdout.trim().slice(0, 100))}` };
  }
  // The vendor said the scrape failed, and why: that is the failure, not "no page text"
  // (#316 - `{"success": false, "error": "Page could not be fetched: timeout"}` was recorded
  // as an empty page). One line, bounded, as a server's own reason is.
  if (payload?.success === false) {
    const said = typeof payload.error === 'string' ? payload.error.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    return { ok: false, url, cmd: command(argv), transport: name,
      error: `firecrawl reported the scrape of ${url} failed${said ? `: ${said}` : ', and gave no reason'}` };
  }
  const page = normalizeScrape(stdout, url);
  if (!page.markdown) {
    return { ok: false, url, cmd: command(argv), transport: name,
      error: `firecrawl's payload held no page text for ${url} - an empty page is not a capture` };
  }
  return { ok: true, cmd: command(argv), ...page };
}

export function search(query, { limit = 8, execFn = exec, ...opts } = {}) {
  const argv = ['search', String(query), '--limit', String(limit), '--json'];
  const result = execFn(argv, opts);
  if (!result.ok) return { ok: false, query, error: result.stderr || `firecrawl exited ${result.status}`, cmd: command(argv), results: [] };
  const results = normalizeSearch(result.stdout);
  // Counted, as the SerpAPI adapter counts its own (found 2026-09-27: Firecrawl searches cost
  // about 2 credits each and the kit recorded none). The cost is an ESTIMATE by the documented
  // rule, 2 credits per 10 results rounded up (E-03, E-14); an empty result is counted at 2,
  // because the rule does not price it and an under-count is the defect this fixes.
  return {
    ok: true, query, cmd: command(argv), results,
    searchesUsed: 1,
    creditsEstimate: 2 * Math.max(1, Math.ceil(results.length / 10)),
  };
}

export function map(url, { limit = 50, execFn = exec, ...opts } = {}) {
  const argv = ['map', String(url), '--limit', String(limit), '--json'];
  const result = execFn(argv, opts);
  if (!result.ok) return { ok: false, url, error: result.stderr || `firecrawl exited ${result.status}`, cmd: command(argv), links: [] };
  return { ok: true, url, cmd: command(argv), links: normalizeMap(result.stdout) };
}

export function status({ execFn = exec, ...opts } = {}) {
  // `firecrawl status` does not exist: the CLI exposes `--status` on the root command.
  // Guessed rather than verified, so it exited non-zero on every call and the probe
  // could never report an authenticated machine.
  const argv = ['--status'];
  const result = execFn(argv, opts);
  if (!result.ok) {
    return { ok: false, authenticated: false, credits: null, transport: name, error: result.stderr || 'firecrawl status failed' };
  }
  return { ok: true, transport: name, ...parseStatus(result.stdout) };
}

/** The seam the collector consumes: one URL in, one capture-shaped result out. */
/**
 * Whether a failure's text says the account's credits are exhausted (ADR-0086).
 *
 * The API answers 402 with "Insufficient credits to perform this request. ..." and the CLI
 * prints only that text - the status never reaches this adapter (fetch-fallback corpus,
 * E-10, E-11). Matched on the words, case-insensitively: v0 and v1 phrase the rest
 * differently, and "Insufficient credits" is the part they share.
 */
export function creditsExhausted(text) {
  return /insufficient credits/i.test(String(text ?? ''));
}

export function runScrape(url, opts = {}) {
  return scrape(url, opts);
}

export function cliVersion({ execFn = exec, ...opts } = {}) {
  const result = execFn(['--version'], opts);
  return result.ok ? result.stdout.trim() : null;
}

/**
 * The version of the Firecrawl CLI this adapter was written and tested against.
 *
 * The CLI is the one dependency outside this repository's control: no lockfile pins it,
 * it is installed globally, and it can change under a working install. This adapter
 * expects specific flags, a specific JSON shape, and a specific `--status` rendering, so
 * a major-version bump is a payload contract change the tests cannot see - every one of
 * them drives a stub.
 *
 * Moved from 1.23.3 to 1.24.6 on 2026-09-26. 1.23.3 bundles axios 1.15.2 (through the
 * `firecrawl` SDK 4.24.0), which sends plain proxied requests; an HTTPS proxy that requires
 * CONNECT tunnels refuses them with 405, so every call failed behind one. 1.24.6 bundles
 * axios 1.18.0 (SDK 4.40.0). Its `--status`, search and scrape output were captured and read
 * by this adapter's own parsers before the move: search gained `warning`, `id`, `data.tools`
 * and a per-row `position`, all additive (test/fixtures/*-1.24.6.*).
 *
 * Moved from 1.24.6 to 1.25.2 on 2026-10-02 (docs/decisions/2026-10-02-firecrawl-cli-1-25).
 * The open question was 1.25.0's "enrichment credits in CLI receipts": a receipt printed
 * after the JSON on stdout would have needed `parsePayload` to skip it. Captured and read
 * unchanged (test/fixtures/*-1.25.2.*): scrape's receipt ("Scrape ID: ...") goes to stderr
 * and stdout is one JSON value; search's `data.tools` is now populated (Alexandria providers,
 * no `url`, so none reaches a result) beside `data.web`; `--status` is the same text. The
 * bundle is unchanged (SDK 4.40.0, node >= 22), so the proxy behaviour that forced the
 * previous move is not in question.
 *
 * Moved from 1.25.2 to 1.25.3 on 2026-10-03. The release is one commit, "fix: make --objective
 * optional for alexandria feedback" (firecrawl/cli#301), with nothing on scrape, search or
 * `--status`; the bundle is unchanged (SDK 4.40.0, axios 1.18.0, node >= 22). Captured anyway,
 * the same way (test/fixtures/*-1.25.3.*): the three outputs read unchanged by these parsers -
 * the receipt on stderr, `data.tools` populated and reaching no result, `--status` the same
 * text with a 1,500-credit cycle behind it.
 */
export const TESTED_CLI_VERSION = '1.25.3';
export const SUPPORTED_CLI_MAJOR = 1;

/**
 * The npm package that provides the `firecrawl` binary - and it is NOT called `firecrawl`.
 *
 * Both workflows installed `firecrawl@<version>` for weeks. Nobody noticed, because the
 * install had never run. The first real dispatch failed with
 * `npm error notarget No matching version found for firecrawl@1.23.3`, and the reason is
 * that two different packages are in play:
 *
 *   firecrawl-cli   1.23.3   bin: { firecrawl: ... }   the CLI this adapter drives
 *   firecrawl       4.41.0   no bin at all             the JavaScript SDK
 *
 * The ETARGET failure was the lucky outcome. `firecrawl@latest` RESOLVES - to the SDK, at
 * a major this adapter has never seen - so the surveillance mode of `live-collection.yml`
 * would have reported a successful install and then failed on `firecrawl --version` with
 * no binary to run, which reads as a compatibility problem rather than as the wrong
 * package.
 *
 * It lives here because ADR-0005 puts all vendor knowledge in this adapter: a workflow
 * that spells the package name itself is a second place for it to be wrong, and that is
 * exactly how this happened.
 */
export const CLI_PACKAGE = 'firecrawl-cli';

/** `firecrawl-cli@1.24.6` or `firecrawl-cli@latest` - never a bare package name. */
export function cliInstallSpec(version = TESTED_CLI_VERSION) {
  return `${CLI_PACKAGE}@${version}`;
}

/**
 * What this adapter will do with the installed CLI, and why.
 *
 * Three answers, deliberately, because "compatible or not" is the wrong shape:
 *
 *   supported   the major matches what the adapter was written against
 *   untested    a version could not be read, or does not parse. NOT refused - a CLI that
 *               prints its version differently is not evidence that scraping is broken,
 *               and refusing on it would strand a working install
 *   unsupported a DIFFERENT major. Semver says the payload contract may have changed, and
 *               the adapter cannot tell a changed shape from an empty result
 *
 * Only `unsupported` stops a run, and it stops it BEFORE anything is spent. Discovering
 * an incompatibility after the credits are gone is the failure worth engineering against.
 */
export function cliCompatibility(version = cliVersion()) {
  if (!version) {
    return { level: 'untested', version: null, supported: true,
      detail: 'the Firecrawl CLI did not report a version; proceeding, since that is not evidence of a broken CLI' };
  }
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { level: 'untested', version, supported: true,
      detail: `could not parse "${version}" as a version; proceeding, and this adapter was tested against ${TESTED_CLI_VERSION}` };
  }
  const major = Number(match[1]);
  if (major !== SUPPORTED_CLI_MAJOR) {
    return {
      level: 'unsupported', version, supported: false, major,
      detail: `Firecrawl CLI ${version} is major ${major}; this adapter was written against `
        + `${TESTED_CLI_VERSION} and expects major ${SUPPORTED_CLI_MAJOR}. A major bump may change the `
        + 'payload shape, the flags, or the status output, and the adapter cannot tell a changed '
        + 'shape from an empty result - so this refuses BEFORE spending credits.',
      remedy: `install a ${SUPPORTED_CLI_MAJOR}.x CLI, or use --transport http-keyless, which has no vendor CLI in the route`,
    };
  }
  return {
    level: 'supported', version, supported: true, major,
    detail: version === TESTED_CLI_VERSION
      ? `Firecrawl CLI ${version}, the version this adapter is tested against`
      : `Firecrawl CLI ${version}; tested against ${TESTED_CLI_VERSION}, same major`,
  };
}

export default { name, scrape, search, map, command, status, runScrape, creditsExhausted };

/**
 * How long the vendor asked us to wait, in milliseconds, or `null` if this is not a rate
 * limit at all.
 *
 * WHY THE VENDOR'S NUMBER AND NOT OUR OWN. Firecrawl states the delay in the error text -
 * "please retry after 13s" - and it knows when its own window resets. A fixed backoff we
 * invented would either wait too long on every failure or too little on the one that
 * mattered. This is the same principle the kit researched for `Retry-After` on 2026-09-22:
 * when a server tells you when to come back, that is the number to use.
 *
 * Found because a run lost six of eight fetches to "Consumed (req/min): 11, Remaining
 * (req/min): 0" and reported them as ordinary failures. The free tier is ten requests a
 * minute; the collector did not throttle and did not retry.
 */
/** The longest a vendor's rate limit may make the collector wait, per attempt. */
export const MAX_RATE_LIMIT_WAIT_MS = 60_000;

export function rateLimitWaitMs(errorText) {
  const text = String(errorText ?? '');
  // Whether this is a rate limit at all is lib/fetch-failure.mjs's answer (ADR-0194), so the
  // gate, which does not import a transport, reads a failure as this wait loop does.
  if (!isRateLimited(text)) return null;
  const retry = text.match(/retry after (\d+)\s*s/i);
  // Capped at the minute that clears a per-minute window: the number is the vendor's text,
  // and "retry after 999999999999s" was slept as given, with the corpus lock held, so every
  // run on the project waited behind it (found 2026-10-01, break-test).
  if (retry) return Math.min((Number(retry[1]) + 1) * 1000, MAX_RATE_LIMIT_WAIT_MS);
  // A rate limit with no stated delay still deserves a wait, and one minute clears a
  // per-minute window by construction.
  return MAX_RATE_LIMIT_WAIT_MS;
}

/**
 * The wait a failed result asks for, in milliseconds, or null: the result's own
 * `retryAfterMs` first - a transport that read a `Retry-After` header hands the server's
 * number over (#313) - and the vendor's error text after it. Capped like the text's number.
 */
export function retryWaitMs(result) {
  const asked = result?.retryAfterMs;
  if (Number.isFinite(asked) && asked >= 0) return Math.min(asked, MAX_RATE_LIMIT_WAIT_MS);
  return rateLimitWaitMs(result?.error);
}
