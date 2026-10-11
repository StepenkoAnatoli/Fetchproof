// What this host must provide before a command can do its job.
//
// The README promises Node 22+, Git, and Python 3.11+. A promise in a README is not a
// check: entrypoints began executing and the missing prerequisite surfaced as a syntax
// error, a missing built-in, or a subprocess failure three layers down - none of which
// says "your Node is too old".
//
// Deliberately NOT a single gate that demands everything. Python is needed by the
// cross-language conformance runners and by nothing else, and a command that only reads
// the corpus has no business refusing to run because a language it never calls is absent.
// Each entrypoint asks for what it actually uses.

import http from 'node:http';
import { spawn as spawnChild, spawnSync } from 'node:child_process';

/** Node 22 is the floor: the kit uses `structuredClone` on arrays and modern ESM only. */
export const REQUIRED_NODE_MAJOR = 22;
/**
 * The oldest Python the conformance runners are promised to work on, and the one CI pins
 * (ADR-0078). Measured 2026-09-28: all three runners agree with Node on 3.10 through 3.13;
 * 3.11 is the oldest of those still maintained. README and CI must name this same number.
 */
export const REQUIRED_PYTHON = { major: 3, minor: 11 };
const PYTHON_FLOOR = `${REQUIRED_PYTHON.major}.${REQUIRED_PYTHON.minor}`;

/** `{ ok, detail }` - ok when this Node is new enough to run the kit at all. */
export function checkNode(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  if (!Number.isFinite(major)) return { ok: false, detail: `could not read a Node version from ${JSON.stringify(version)}` };
  return major >= REQUIRED_NODE_MAJOR
    ? { ok: true, detail: `node ${version}` }
    : { ok: false, detail: `node ${version}; this kit needs ${REQUIRED_NODE_MAJOR} or newer`, fix: 'install Node 22+ from nodejs.org, then reopen the terminal' };
}

function nodeParts(version) {
  const [major, minor, patch] = String(version).split('.').map(Number);
  return { major, minor: Number.isFinite(minor) ? minor : 0, patch: Number.isFinite(patch) ? patch : 0 };
}

/**
 * Whether this Node's TextDecoder reads `windows-1252` as windows-1252. From 22.13.0 up to
 * and including 22.22.0 it read it as Latin-1 (nodejs/node#60888, a regression that shipped
 * after the line went LTS; fixed by nodejs/node#60893 and backported), so bytes 0x80-0x9F -
 * the euro sign, the curly quotes, the dashes - came back as C1 control characters, and a
 * page captured on such a build lost them with no warning (ADR-0159). Measured 2026-10-11:
 * 22.12.0 right; 22.13.0, 22.21.0 and 22.22.0 wrong; 22.22.1, 22.22.3, 22.23.0, 22.23.3 and
 * 24.21.0 right. The 20 line regressed the same way at 20.18.3 and is below the floor anyway.
 */
export function nodeDecodesWindows1252(version = process.versions.node) {
  const { major, minor, patch } = nodeParts(version);
  if (major !== 22) return true;
  if (minor < 13) return true;
  if (minor > 22) return true;
  return minor === 22 && patch >= 1;
}

/**
 * Whether this Node's built-in fetch can route through HTTPS_PROXY via NODE_USE_ENV_PROXY,
 * which `fetchEnv` gives a fetching child and `honourEnvProxy` gives a command. The flag exists from 22.21.0 on the 22 line
 * and from 24.0.0 on the 24 line, and 23 never had it (docs/decisions/2026-09-27-node-support,
 * E-02, E-04). Below that the flag is ignored and the fetch goes around the proxy: measured
 * on 22.20.0, an HTTP 403 that named no proxy.
 */
export function nodeHonoursEnvProxy(version = process.versions.node) {
  const { major, minor } = nodeParts(version);
  if (major === 22) return minor >= 21;
  return major >= 24;
}

// ---------------------------------------------------------------- a configured proxy
//
// Node's built-in fetch ignores HTTPS_PROXY unless told to use it, and it is told at startup
// (NODE_USE_ENV_PROXY=1 or --use-env-proxy, E-02) or, from 24.14 and 25.4, in place with
// http.setGlobalProxyFromEnv() (E-03). Every request the kit makes on Node's fetch goes
// through here: a child that fetches is started with `fetchEnv`, and a command that fetches
// in its own process calls `honourEnvProxy` before its first request.

/** The variables Node's proxy support reads, both cases (E-03). */
export const PROXY_VARIABLES = Object.freeze(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']);

/** The first proxy variable set in `env`, or null. */
export function proxyVariable(env = process.env) {
  return PROXY_VARIABLES.find((key) => env[key]) ?? null;
}

// Node takes a proxy as an http: or https: URL with a host (E-03).
function usableProxyUrl(value) {
  try {
    const url = new URL(String(value));
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The proxy variable whose value Node cannot use, or null. Only the values Node reads count:
 * when both spellings are set, the lowercase one wins (E-03).
 *
 * Found 2026-09-27: with the flag on, Node builds every configured proxy up front, and one it
 * cannot parse throws "Invalid URL protocol" from inside Node - an uncaught exception, not a
 * fetch error, even for a request the other proxy would carry. HTTPS_PROXY=proxy.example:8080
 * is enough, and curl accepts that form. Without the flag the value is ignored and requests
 * go direct, so for such a value the flag stays off.
 */
export function unusableProxy(env = process.env) {
  for (const [lower, upper] of [['https_proxy', 'HTTPS_PROXY'], ['http_proxy', 'HTTP_PROXY']]) {
    const name = env[lower] ? lower : env[upper] ? upper : null;
    if (name && !usableProxyUrl(env[name])) return name;
  }
  return null;
}

/**
 * The spelling Node would accept, for a message. A bare host:port gains http://, as curl reads
 * it; anything else gets a template. Never echoes a value that could hold a password.
 */
export function proxySpelling(value) {
  const bare = String(value ?? '').trim().replace(/\/$/, '');
  return /^[\w.-]+:\d+$/.test(bare) ? `http://${bare}` : 'http://host:port';
}

const MiB = 1024 * 1024;

/**
 * The largest page a transport keeps (ADR-0082). A body past it is refused by name, never
 * kept cut short: a truncated HTML document is not the page, and its hash proves nothing.
 */
export const MAX_PAGE_BYTES = 16 * MiB;

/**
 * The most any vendor child may print. spawnSync's default is 1 MiB, so a page a little
 * over that failed with "spawnSync ... ENOBUFS" - and a Firecrawl scrape that large was paid
 * for and lost. JSON escaping can grow a body up to sixfold, so this leaves the page
 * limit room while still bounding what the parent holds.
 */
export const CHILD_OUTPUT_LIMIT = 8 * MAX_PAGE_BYTES;

/**
 * The charset a Content-Type declares, lower-cased and unquoted - '' when it declares none.
 * `text/html; charset="ISO-8859-1"` and `text/html;CHARSET=iso-8859-1` both read iso-8859-1.
 */
export function charsetOf(contentType) {
  const match = /;\s*charset\s*=\s*("([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(String(contentType ?? ''));
  // A stray quote (`charset="utf-8`, unbalanced) is not part of the label (2026-10-03).
  return (match ? (match[2] ?? match[3] ?? match[4]) : '').replace(/^["']+|["']+$/g, '').trim().toLowerCase();
}

/**
 * The decoder for a body: `{ decoder, charset, fallback }`, where `charset` is the encoding
 * actually used and `fallback` is '' or a sentence saying why the text is not known to be
 * the body as the server meant it.
 *
 * Found 2026-10-03 (output-reliability audit, G7): every body was decoded as UTF-8 whatever
 * Content-Type said, so a `charset=windows-1252` page holding byte 0x80 came back with
 * U+FFFD where the euro sign was - silently, and the capture's hash then proved a page the
 * server never sent. The rules, in this order (the later ones from the review of that fix,
 * the same day):
 *  - a byte-order mark outranks the header: a UTF-8 or UTF-16 BOM is the file saying what
 *    it is, and a server that mislabels a BOM'd file is common; the decoder drops the mark.
 *  - a label TextDecoder does not know (it knows the WHATWG labels - windows-1252,
 *    iso-8859-1, shift_jis, ... - on a Node built with full ICU, as Node 22+ is) means the
 *    body is read as UTF-8, the only honest choice left; that is a named fallback when a byte
 *    outside ASCII is present, and an exact reading when none is.
 *  - a UTF-8 label, or none, reads as UTF-8, as it always did; bytes that are not valid UTF-8
 *    under it are a named fallback, because a page that names its charset only in a <meta>
 *    tag arrives exactly so, and U+FFFD where its euro sign was is not the page.
 *  - a UTF-16 label over a body with no NUL byte is not believed: UTF-16 text of any page
 *    holds one for every ASCII character, and an 8-bit body read as UTF-16 is CJK garbage
 *    from end to end. Such a body is read as UTF-8 - exact when it is valid UTF-8, a named
 *    fallback when it is not.
 *  - a legacy label over bytes that form valid UTF-8 is read as UTF-8: a server default of
 *    iso-8859-1 in front of files written as UTF-8 is the common misconfiguration, and bytes
 *    outside ASCII that form valid UTF-8 are almost never intended as Latin-1 text. The
 *    declared charset decides only bytes that are not valid UTF-8, which is the legacy page
 *    the declaration exists for.
 */
/** Any byte outside ASCII - the only bodies whose charset changes what they say. */
function hasHighByte(bytes) {
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] >= 0x80) return true;
  return false;
}

/** Any NUL byte - which UTF-16 text of a page cannot avoid, and 8-bit text never holds. */
function hasNul(bytes) {
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] === 0) return true;
  return false;
}

function validUtf8(bytes) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
}

const utf8Reading = (fallback = '') => ({ decoder: new TextDecoder('utf-8'), charset: 'utf-8', fallback });

export function decoderFor(contentType, bytes, who = 'the body') {
  const b = bytes ?? [];
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return utf8Reading();
  if (b[0] === 0xFF && b[1] === 0xFE) return { decoder: new TextDecoder('utf-16le'), charset: 'utf-16le', fallback: '' };
  if (b[0] === 0xFE && b[1] === 0xFF) return { decoder: new TextDecoder('utf-16be'), charset: 'utf-16be', fallback: '' };
  const declared = charsetOf(contentType);
  let decoder;
  try {
    decoder = new TextDecoder(declared || 'utf-8');
  } catch {
    return utf8Reading(hasHighByte(b)
      ? `${who} declares charset "${declared}", which TextDecoder does not know - decoded as UTF-8, so bytes outside ASCII may read as U+FFFD`
      : '');
  }
  if (decoder.encoding === 'utf-8') {
    return utf8Reading(hasHighByte(b) && !validUtf8(b)
      ? `${who} ${declared ? `declares charset "${declared}"` : 'declares no charset'} but holds bytes that are not valid UTF-8 - decoded as UTF-8, so those read as U+FFFD`
      : '');
  }
  if (decoder.encoding.startsWith('utf-16') && !hasNul(b)) {
    return utf8Reading(hasHighByte(b) && !validUtf8(b)
      ? `${who} declares charset "${declared}" but holds no NUL byte, which UTF-16 text of a page cannot avoid - decoded as UTF-8, so bytes outside ASCII may read as U+FFFD`
      : '');
  }
  if (hasHighByte(b) && validUtf8(b)) return utf8Reading();
  return { decoder, charset: decoder.encoding, fallback: '' };
}

/**
 * A response body as text, with how it was read: `{ text, charset, fallback }` (see
 * `decoderFor`). Refused once it passes MAX_PAGE_BYTES (ADR-0082): declared too large by
 * Content-Length, or found so while reading - a chunked answer declares nothing. Every
 * transport child reads through this; `response.text()` held any body whole. `who` names
 * the body in the refusal and in the fallback.
 */
export async function boundedBody(response, who) {
  const bytes = await boundedBytes(response, who);
  const { decoder, charset, fallback } = decoderFor(response.headers.get('content-type'), bytes, who);
  return { text: decoder.decode(bytes), charset, fallback };
}

async function boundedBytes(response, who) {
  const tooLarge = () => new Error(`${who} is larger than ${MAX_PAGE_BYTES / MiB} MiB - not read (ADR-0082)`);
  if (Number(response.headers.get('content-length')) > MAX_PAGE_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_PAGE_BYTES) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * A response body read as UTF-8, whatever Content-Type says, for a caller that parses the
 * body rather than keeps it: the JSON answers of SerpAPI, SearXNG and the Wayback Machine,
 * which RFC 8259 makes UTF-8. The G7 change had this read through `decoderFor` for a day,
 * so a legacy label on a JSON answer changed how it was parsed; the review of that fix
 * (2026-10-03) returned it to the reading its callers had always had. A caller whose body
 * becomes a capture reads `boundedBody` and records the fallback (the keyless child does).
 */
export async function boundedText(response, who) {
  return new TextDecoder().decode(await boundedBytes(response, who));
}

/** A sentence naming a child's output overflow, or null when that is not what happened. */
export function outputOverflow(result, who) {
  if (result?.error?.code !== 'ENOBUFS') return null;
  return `${who} printed more than ${CHILD_OUTPUT_LIMIT / MiB} MiB - the answer was abandoned rather than kept in part (ADR-0082)`;
}

/**
 * The environment for a child process that fetches: `env`, plus the one flag that makes the
 * child's built-in fetch use a configured proxy. A Node that predates the flag ignores it,
 * so setting it costs nothing there.
 *
 * Found 2026-09-26 in a cloud container, Node 22.22.2: a GitHub API page that curl fetched
 * through the proxy came back HTTP 403, GitHub's unauthenticated rate limit, because going
 * around the proxy lost the authentication the proxy adds. On a network that allows traffic
 * only through the proxy, the same bypass fails earlier, at the connection. Either way the
 * error names no proxy. An operator who set NODE_USE_ENV_PROXY themselves - even to 0 -
 * decided, and is not overruled.
 */
export function fetchEnv(env = process.env) {
  if (env.NODE_USE_ENV_PROXY !== undefined) return env;
  if (!proxyVariable(env) || unusableProxy(env)) return env;
  return { ...env, NODE_USE_ENV_PROXY: '1' };
}

// Whoever started this process chose at startup: the variable (even set to 0) or the flag,
// on the command line or in NODE_OPTIONS. The flag wins over the variable (E-02). Either
// way the choice is theirs. Our own restart sets the variable, so it cannot loop.
function proxyChosen(env, execArgv) {
  const flag = /(^|\s)--(no-)?use-env-proxy(\s|=|$)/;
  return env.NODE_USE_ENV_PROXY !== undefined
    || execArgv.some((arg) => flag.test(arg))
    || flag.test(env.NODE_OPTIONS ?? '');
}

/**
 * How THIS process's own fetch reaches a configured proxy:
 *   'none'         no proxy, or the choice was made at startup
 *   'invalid'      a proxy value Node cannot use: turning it on would crash every fetch, so
 *                  requests go direct, as they did before (unusableProxy)
 *   'set'          Node 24.14+ and 25.4+: http.setGlobalProxyFromEnv() turns it on in place (E-03)
 *   'reexec'       Node 22.21+ and 24.0-24.13: only the startup flag exists, so the command
 *                  starts again with it
 *   'unsupported'  older: nothing can; the command says so, and so does doctor
 */
export function envProxyPlan({
  env = process.env,
  version = process.versions.node,
  execArgv = process.execArgv,
  setGlobal = http.setGlobalProxyFromEnv,
} = {}) {
  if (!proxyVariable(env) || proxyChosen(env, execArgv)) return 'none';
  if (unusableProxy(env)) return 'invalid';
  if (typeof setGlobal === 'function') return 'set';
  return nodeHonoursEnvProxy(version) ? 'reexec' : 'unsupported';
}

/**
 * Make this process's own fetch use a configured proxy. Called by every command that fetches
 * in its own process, before its first request: collect-remote, disclosure, mcp-server.
 *
 * Resolves with the plan it followed. For 'reexec' it never resolves: the command runs again
 * as a child with the flag, on the same standard streams (an MCP client keeps talking to the
 * same pipes), and this process forwards stop signals and leaves with the child's exit code.
 */
export function honourEnvProxy({
  env = process.env,
  version = process.versions.node,
  execArgv = process.execArgv,
  argv = process.argv,
  execPath = process.execPath,
  setGlobal = http.setGlobalProxyFromEnv,
  spawn = spawnChild,
  exit = (code) => process.exit(code),
  stderr = process.stderr,
  signals = process,
} = {}) {
  const plan = envProxyPlan({ env, version, execArgv, setGlobal });
  if (plan === 'set') setGlobal(env);
  if (plan === 'invalid') {
    const name = unusableProxy(env);
    stderr.write(`${name} is not a proxy URL Node can use, so requests go direct. `
      + `Write it as ${proxySpelling(env[name])}.\n`);
  }
  if (plan === 'unsupported') {
    stderr.write(`${proxyVariable(env)} is set, but node ${version} cannot send its requests through a proxy, `
      + 'so they go direct. Upgrade to Node 22.21 or later on the 22 line, or to 24 or 26.\n');
  }
  if (plan !== 'reexec') return Promise.resolve(plan);

  return new Promise(() => {
    // Node 22 prints "EnvHttpProxyAgent is experimental" on every run once the flag is on.
    // True, and noise on every command the operator reads; only that code is silenced.
    const child = spawn(execPath, ['--disable-warning=UNDICI-EHPA', ...execArgv, ...argv.slice(1)], {
      stdio: 'inherit',
      env: { ...env, NODE_USE_ENV_PROXY: '1' },
      windowsHide: true,
    });
    for (const signal of ['SIGINT', 'SIGTERM']) signals.on(signal, () => child.kill(signal));
    child.on('error', (error) => {
      stderr.write(`could not start again with the proxy turned on: ${error.message}\n`);
      exit(3);
    });
    child.on('exit', (code) => exit(code ?? 1));
  });
}

/**
 * The Node line as doctor reports it: `pass`, `warn` or `fail`, with the reason.
 * Below the floor the kit does not run. An odd line below 27 is never LTS and ends six
 * months after it starts (E-01) - 23 and 25 are already end-of-life. From 27 every line
 * goes LTS, so the rule stops there.
 */
export function nodeLine(version = process.versions.node) {
  const { major } = nodeParts(version);
  if (!Number.isFinite(major)) return { level: 'fail', detail: `could not read a Node version from ${JSON.stringify(version)}`, fix: '' };
  if (major < REQUIRED_NODE_MAJOR) {
    return { level: 'fail', detail: `node ${version}; this kit needs ${REQUIRED_NODE_MAJOR} or newer`, fix: 'install Node 24 (Active LTS) from nodejs.org' };
  }
  // A 22 that cannot keep a euro sign is not a 22 the kit can collect on (ADR-0159).
  if (!nodeDecodesWindows1252(version)) {
    return {
      level: 'fail',
      detail: `node ${version} decodes windows-1252 pages as Latin-1 (nodejs/node#60888): a page's euro signs, curly quotes and dashes would be captured as control characters, with no warning`,
      fix: 'install Node 22.22.1 or newer on the 22 line, or Node 24 (Active LTS) from nodejs.org',
    };
  }
  if (major % 2 === 1 && major < 27) {
    return {
      level: 'warn',
      detail: `node ${version} is an odd-numbered line: never LTS, and end-of-life six months after release`,
      fix: 'move to Node 24 (Active LTS) or 26',
    };
  }
  return { level: 'pass', detail: `node ${version}`, fix: '' };
}

/** `{ ok, detail }` - ok when git is on PATH and answers. Only for commands that use it. */
export function checkGit({ run = spawnSync } = {}) {
  const probe = run('git', ['--version'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  if (probe.error || probe.status !== 0) {
    return { ok: false, detail: 'git is not on PATH, or did not answer --version', fix: 'install Git from git-scm.com, then reopen the terminal' };
  }
  return { ok: true, detail: String(probe.stdout).trim() };
}

/**
 * `{ ok, detail, exe }` - ok when a python new enough for the conformance runners answers;
 * `exe` names it (`python3` or `python`), so a caller can run the one this chose.
 */
export function checkPython({ run = spawnSync } = {}) {
  // Keeps looking after an old interpreter. `python` is an ALIAS on most hosts, and on a
  // great many it still points at 2.7 or an old 3.x while `python3` is the real one - the
  // single most common layout on Linux and older macOS.
  //
  // The first version of this returned failure the moment it found an old `python`, so a
  // host with python 2.7 AND python3 3.12 was rejected for having no usable Python while
  // a usable Python sat one name away. The old interpreter is remembered only so the
  // message can say what was actually found, rather than the less useful "no python".
  let rejected = null;
  for (const exe of ['python3', 'python']) {
    const probe = run(exe, ['--version'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    if (probe.error || probe.status !== 0) continue;
    const text = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim();   // 3.x prints to stdout, 2.x to stderr
    const match = text.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    // No version in the output is not a usable interpreter: it was accepted ("proceeding")
    // until 2026-09-28, so a stub or wrapper that exits 0 failed later, in the conformance
    // tests, far from the cause (Arena break test 13). It is remembered like an old one.
    if (!match) {
      rejected ??= {
        ok: false,
        detail: `${exe} --version printed ${JSON.stringify(text.slice(0, 80))}, which is not a version`,
        fix: `check what \`${exe}\` on PATH is, or install Python ${PYTHON_FLOOR}+ from python.org`,
      };
      continue;
    }
    const [major, minor] = [Number(match[1]), Number(match[2])];
    if (major > REQUIRED_PYTHON.major || (major === REQUIRED_PYTHON.major && minor >= REQUIRED_PYTHON.minor)) {
      return { ok: true, exe, detail: `${exe} ${match[0]}` };
    }
    rejected ??= {
      ok: false,
      detail: `${exe} ${match[0]}; the conformance runners need ${REQUIRED_PYTHON.major}.${REQUIRED_PYTHON.minor}+`,
      fix: `install Python ${PYTHON_FLOOR}+ from python.org, then reopen the terminal`,
    };
  }
  return rejected ?? {
    ok: false,
    detail: 'no python on PATH',
    fix: `install Python ${PYTHON_FLOOR}+ from python.org; only the cross-language conformance runners need it`,
  };
}

/**
 * Ask for what this command uses, and stop with a named error if the host cannot provide
 * it. Returns the resolved report so a caller can print it.
 *
 * Exit code 3 is distinct on purpose: a prerequisite failure is not a product failure and
 * a script should be able to tell them apart without reading prose.
 */
export function requireRuntime({ node = true, git = false, python = false,
  exit = (code) => process.exit(code), write = (text) => process.stderr.write(text) } = {}) {
  const checks = [];
  if (node) checks.push(['node', checkNode()]);
  if (git) checks.push(['git', checkGit()]);
  if (python) checks.push(['python', checkPython()]);

  const failed = checks.filter(([, result]) => !result.ok);
  if (failed.length) {
    write(`this host cannot run that command:\n${failed.map(([name, r]) => `  ${name}: ${r.detail}\n    ${r.fix ?? ''}`).join('\n')}\n`);
    exit(3);
  }
  return Object.fromEntries(checks.map(([name, result]) => [name, result.detail]));
}

/**
 * What falling back onto a fetch provider's own search costs, in words (2026-09-30).
 *
 * The fallback line said "this spends fetch credits" whatever the fetch side was, including
 * the keyless and browser transports, which have no meter. Only those two are named free: a
 * fetch provider the kit does not know may be metered, so it keeps the warning.
 */
export const FREE_FETCH_TRANSPORTS = Object.freeze(['http-keyless', 'browser']);
export function fallbackCost(name) {
  return FREE_FETCH_TRANSPORTS.includes(name) ? `free on ${name}, which has no meter` : 'this spends fetch credits';
}

/** A URL cut to its host, so a query string - a key - and a password never ride along. */
const hostOnly = (text) => String(text).replace(/https?:\/\/[^\s)'"]+/g, (u) => { try { return new URL(u).host; } catch { return 'a URL'; } });

/**
 * A failed fetch in words: Node's `fetch failed` plus the reason it keeps on `err.cause` -
 * `getaddrinfo ENOTFOUND host`, `ECONNREFUSED`, `redirect count exceeded` (found 2026-09-30:
 * an offline machine, a mistyped host and a refused port all read "fetch failed"). A URL is
 * cut to its host wherever it appears, in the cause OR in the failure's own message, so a
 * query string - a key - never rides along.
 *
 * The message was returned verbatim until 2026-10-01, on the reasoning that the URL worth
 * cutting was the one in the cause. Node throws some fetch refusals with NO cause and the
 * whole URL in the message - `Request cannot be constructed from a URL that includes
 * credentials: http://user:pass@host/?api_key=...`, `Failed to parse URL from ...` - so a
 * signed or credential-bearing URL in a plan was printed to the terminal and written into
 * `research/raw/.fetches.jsonl` as that entry's error: nine copies of one token, in the one
 * directory `doctor`'s secret scan excludes by design (found 2026-10-01, break-test).
 */
export function fetchFailure(err) {
  const message = String(err?.message ?? err);
  const cause = err?.cause;
  const first = Array.isArray(cause?.errors) ? cause.errors[0] : null;
  const detail = cause ? String(cause.message || cause.code || first?.message || first?.code || '').trim() : '';
  if (!detail || message.includes(detail)) return hostOnly(message);
  return `${hostOnly(message)} (${hostOnly(detail)})`;
}
