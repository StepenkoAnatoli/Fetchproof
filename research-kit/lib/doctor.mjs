// doctor.mjs - read-only diagnostics: machine + project + gate + chain in one report.
//
// ROLE-AWARE (ADR-0010): on a builder the Firecrawl findings are informational and the
// handoff findings are blockers; on a collector it is the other way round. The
// collection entrypoints' refusal is what makes that split honest.
//
// One deliberate write: the repository-local hooksPath override log. The third override
// is silent by nature - the bypassed hook cannot report itself.

import fs from 'node:fs';
import path from 'node:path';
import { PATHS, resolve, exists, isDirectory, readText, tempBase, looksBinary } from './core.mjs';
import { verdictContext, runPreflight } from './preflight.mjs';
import { isGated } from './gate.mjs';
import { verifyHandoff, handoffRemedy } from './handoff.mjs';
import { validateProject, hookExecutability, GATE_MARKERS, KIT_ROOT } from './scaffold.mjs';
import { settingsState, deployedDrift, driftNote, handOnState } from './installer.mjs';
import { recordOverride } from './provenance.mjs';
import { probeFirecrawl, selectTransport } from './transport.mjs';
import { loadConfig, configPath } from './machine.mjs';
import { cliInstallSpec, cliCompatibility } from './firecrawl.mjs';
import { nodeLine, nodeHonoursEnvProxy, proxyVariable, unusableProxy, proxySpelling } from './runtime.mjs';
import { verifyBundle, bundleSummary } from './bundle.mjs';
import {
  posture, machineRole, collectionPolicy, readMachineConfig, retiredEnvNotes,
  hooksPath, hooksPathEffective, runtimePaths, skillLocations,
  readInstallState, gitVersion, isGitRepo, localHooksPathOverride, previousHooksPath, repoTopLevel, RETIRED_CONFIG_KEYS, RETIRED_EDIT_GATE_HOOKS,
  EDIT_GATE_HOOK, KIT_HOME, namesHook,
} from './machine.mjs';

import { kitCommand } from './core.mjs';
function f(severity, name, detail, fix = '') {
  return { severity, name, detail, ...(fix ? { fix } : {}) };
}

/** Two paths name one directory, by real path: node runs a symlinked kit from its target. */
function samePath(a, b) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return real(a) === real(b);
}

// ---------------------------------------------------------------- machine

export function machineHealth({ env = process.env, gitPaths = {}, probe = probeFirecrawl, nodeVersion = process.versions.node } = {}) {
  const out = [];
  const read = readMachineConfig(env);
  const post = posture(env);

  if (read.state === 'unreadable') {
    out.push(f('critical', 'machine-config',
      `${read.source} exists and does not parse (${read.error}). Resolved posture: ${post.failOpen ? 'fail-open from the last config that parsed' : 'fail-CLOSED, because there was nothing to hold'}.`,
      'repair or delete the config file; the kit keeps a <config>.last-good snapshot beside it'));
  } else {
    out.push(f('pass', 'machine-config', `${read.state} (${read.source}); posture: ${post.failOpen ? 'fail-open' : 'fail-closed'}`));
  }

  for (const key of read.retiredKeys) {
    out.push(f('warn', 'config-retired-key',
      `"${key}" is a retired config key, read into ${RETIRED_CONFIG_KEYS[key] ?? 'the current shape'}; the next kit write drops it`));
  }
  // A posture key the operator typed and the kit could not read as typed resolved to its
  // restrictive state (ADR-0121); the one thing doctor owes is WHICH key, and to what.
  const resolvedTo = { failOpen: 'fail-closed', evidencePolicy: 'strict', 'editGate.mode': 'hard-block' };
  for (const key of read.illTypedKeys ?? []) {
    out.push(f('warn', 'config-ill-typed',
      `"${key}" is present and not a value the kit reads (${key === 'failOpen' ? 'true or false, unquoted' : key === 'evidencePolicy' ? 'pluralist or strict' : 'ask, hard-block or off'}) - resolved to ${resolvedTo[key] ?? 'its restrictive state'} until it is fixed`,
      `fix "${key}" in ${read.source}`));
  }
  for (const note of retiredEnvNotes(env)) {
    out.push(f('warn', 'env-retired',
      `${note.name} is set and is NOT honoured - rename it to ${note.replacement}`));
  }

  const role = machineRole(env);
  const policy = collectionPolicy(env);
  if (role === 'unknown') {
    out.push(f('fail', 'machine-role',
      `unknown - ${policy.reason}. Metered collection is refused until this is resolved.`, policy.remedy));
  } else {
    out.push(f('pass', 'machine-role', `${role}${policy.mayCollect ? ' - this machine may collect' : ' - this machine must NOT collect'}`));
  }

  // The Node line, and whether it can use this machine's proxy
  // (docs/decisions/2026-09-27-node-support, ADR-0046).
  const line = nodeLine(nodeVersion);
  out.push(f(line.level, 'node', line.detail, line.fix));
  // Every request the kit makes on Node's fetch depends on it: keyless pages, a keyed search
  // provider's requests, and remote collection (dispatch, the MCP server, disclosure). The
  // Firecrawl CLI has its own proxy handling. No vendor is named here (NFR-3).
  const proxy = proxyVariable(env);
  const unusable = unusableProxy(env);
  if (unusable) {
    out.push(f('warn', 'proxy',
      `${unusable} is set to a value Node cannot use as a proxy (it takes an http:// or https:// URL) - the kit's requests go direct`,
      `write it as ${proxySpelling(env[unusable])}`));
  } else if (proxy) {
    out.push(nodeHonoursEnvProxy(nodeVersion)
      ? f('pass', 'proxy', `${proxy} is set, and node ${nodeVersion} sends the kit's requests through it`)
      : f('warn', 'proxy',
        `${proxy} is set, but node ${nodeVersion} cannot send requests through it - keyless pages, search requests and remote collection go around the proxy, and fail with an error that names no proxy`,
        'upgrade to Node 22.21 or later on the 22 line, or to 24 or 26'));
  }

  const version = gitVersion(gitPaths);
  out.push(version
    ? f('pass', 'git', version)
    : f('fail', 'git', 'git is not on PATH - the commit gate cannot install', 'install git 2.9 or newer'));

  const state = probe();
  // A collector that CHOSE a route without Firecrawl is configured, not broken (ADR-0095).
  // Nothing chosen stays a fail: that is the silent degradation this check exists to catch.
  const chosen = env.RESEARCH_KIT_TRANSPORT || loadConfig(env).transport || '';
  const keylessByChoice = role !== 'builder' && chosen && chosen !== 'firecrawl-cli';
  const firecrawlSeverity = role === 'builder' || keylessByChoice ? 'pass' : 'fail';
  // The no-account route is named beside the Firecrawl fix, as the SETTING that makes this
  // check pass (ADR-0095) - a per-run --transport flag would leave doctor red next time.
  const keylessRoute = `or collect without an account: set "transport": "http-keyless" in ${configPath(env)}`;
  if (!state.installed) {
    out.push(f(firecrawlSeverity, 'firecrawl-cli',
      role === 'builder'
        ? 'the Firecrawl CLI is absent, which is expected on a builder - this machine does not collect'
        : keylessByChoice
          ? `the Firecrawl CLI is absent, and ${chosen} was chosen - this collector does not need it`
          : 'the Firecrawl CLI is not on PATH',
      role === 'builder' || keylessByChoice ? '' : `npm install -g ${cliInstallSpec()}   (${keylessRoute})`));
  } else {
    // Judged the way the run judges it (cliCompatibility): doctor had printed `pass 2.0.0`
    // for a CLI the run then refused before spending (2026-10-02, break-test pass 3). A
    // machine that does not collect with it - a builder, a keyless collector - is told, not failed.
    const compat = cliCompatibility(state.version);
    if (compat.level === 'unsupported') {
      out.push(f(firecrawlSeverity === 'fail' ? 'fail' : 'info', 'firecrawl-cli', compat.detail, firecrawlSeverity === 'fail' ? compat.remedy : ''));
    } else {
      out.push(f('pass', 'firecrawl-cli', compat.detail));
    }
    if (!state.authenticated) {
      out.push(f(firecrawlSeverity, 'firecrawl-auth',
        role === 'builder'
          ? 'not authenticated, which is expected on a builder - this machine does not collect'
          : keylessByChoice
            ? `not authenticated, and ${chosen} was chosen - this collector does not need it`
            : 'not authenticated - a collector that cannot collect is broken',
        role === 'builder' || keylessByChoice ? '' : `firecrawl login   (${keylessRoute})`));
    } else {
      out.push(f('pass', 'firecrawl-auth', `authenticated${state.credits === null ? '' : `, ${state.credits} credits`}`));
    }
  }

  try {
    const chosen = selectTransport({ env, probe });
    out.push(f('pass', 'transport', `${chosen.name} (${chosen.why})`));
    // The SEARCH side gets its own line (FR-7). Folding it into the one above would let
    // a second provider - and a second credential - run unreported.
    const side = chosen.search;
    if (side?.sameAsFetch) {
      out.push(f('pass', 'search-transport', `${side.name} - same provider as fetch; one meter pays for both`));
    } else {
      out.push(f('pass', 'search-transport', `${side.name} (${side.why})`));
    }
  } catch (err) {
    out.push(f('fail', 'transport', err.message));
  }

  return out;
}

// ---------------------------------------------------------------- gate health

/**
 * WHOSE pre-commit is it? `current` / `foreign` / `unusable`.
 *
 * Executable is not the same as ours, and this used to ask only the first question: some
 * executable `pre-commit` at `core.hooksPath` reported pass. That is the same
 * existence-for-correspondence mistake the `deploy` check was making - a thing is there, so
 * the thing must be right.
 *
 * `settingsState` has asked this of the EDIT gate since the day a registration on this
 * machine read
 *
 *     node "C:/Users/PC/Desktop/FreeBuff/Deep-Research-Agent-main/research-kit/hooks/edit-gate.mjs"
 *
 * - our hook's name, a different checkout of a different implementation, and the comment
 * recording it notes that the other tree's commit gate crashed. The hole was closed there
 * and left open here, where the substitution is if anything likelier: `core.hooksPath` is a
 * single machine-wide git setting, and husky, lefthook, simple-git-hooks and pre-commit all
 * rewrite it as a matter of course.
 *
 * Pure, and separate from `gateHealth`, because `gateHealth` reads real git config: a rule
 * testable only by fishing one finding out of an array on a host-dependent path is a rule
 * nobody tests (ADR-0004). The existing test for this finding asserts its severity is one
 * of three, for exactly that reason.
 */
export function commitGateState({ hooksPath: dir, kitHome = KIT_HOME } = {}) {
  const expected = path.join(kitHome, 'githooks');
  const hook = path.join(dir, 'pre-commit');
  const mode = hookExecutability(hook);
  // Ownership is decided BEFORE executability, and the order is the finding rather than a
  // detail. The first version asked about the mode first, so a foreign hook that happened
  // to be non-executable was reported as `unusable` with `chmod +x` beside it - advice to
  // repair somebody else's gate, which would leave this one just as absent. Whose it is
  // survives; whether it runs is only interesting once it is ours.
  //
  // Caught by CI on Linux, where `hookExecutability` reads real mode bits. On Windows it
  // returns ok for any file that exists, so the whole branch was unreachable locally and
  // the suite passed - the second time today that the platform the code runs on decided
  // whether a defect was visible.
  if (path.resolve(dir) !== path.resolve(expected)) return { state: 'foreign', hook, mode, expected };
  if (!mode.ok) return { state: 'unusable', hook, mode, expected };
  return { state: 'current', hook, mode, expected };
}

/**
 * WHAT the kit's hooks hand on to (ADR-0112): `none` / `missing` / `kit` / `other`. Lives in
 * `installer.mjs` since ADR-0141, because the install judges what it records with the same
 * rule doctor judges it by; re-exported here so doctor stays the place the finding is read.
 */
export { handOnState };

export function gateHealth(root, { env = process.env, gitPaths = {}, record = true } = {}) {
  const out = [];
  const global = hooksPath('global', gitPaths);
  const effective = hooksPathEffective({ ...gitPaths, cwd: root });

  if (!global) {
    out.push(f('warn', 'gate-commit', 'no machine-wide core.hooksPath is set - the commit gate is not installed',
      kitCommand('install-hooks.mjs')));
  } else {
    const state = commitGateState({ hooksPath: global, kitHome: readInstallState(env)?.kitHome ?? KIT_HOME });
    const repair = kitCommand('install-hooks.mjs');
    if (state.state === 'current') {
      out.push(f('pass', 'gate-commit', `${global} (pre-commit ${state.mode.reason})`));
    } else if (state.state === 'foreign') {
      out.push(f('fail', 'gate-commit',
        `core.hooksPath is ${global}, which is NOT the deployed kit's ${state.expected} - the commit gate that runs belongs to another tree and blocks, or passes, on its own rules`,
        repair));
    } else {
      out.push(f('fail', 'gate-commit',
        `${state.hook} is ${state.mode.reason} - git skips a hook it cannot execute, silently, and reports the commit clean`,
        state.mode.fix || repair));
    }
  }

  {
    // Through the same probe the installer and preflight use, so a project that is a
    // subdirectory of its repository is warned like the root (2026-10-03).
    const local = localHooksPathOverride(root, gitPaths);
    if (local) {
      out.push(f('warn', 'gate-local-override',
        `this repository sets core.hooksPath=${local}, which displaces the machine-wide gate (husky, lefthook, simple-git-hooks and pre-commit all do this)`,
        'git config --local --unset core.hooksPath'));
      if (record) { try { recordOverride(root, 'local-hooks-path', local); } catch { /* read-only checkout */ } }
    }
  }
  if (effective && global && path.resolve(effective) !== path.resolve(global)) {
    out.push(f('warn', 'gate-hooks-path', `effective core.hooksPath here is ${effective}, not the machine-wide ${global}`));
  }
  // What the hooks hand on to (ADR-0134). Quiet when nothing is recorded or the folder holds
  // somebody else's hooks: that hand-on is the point of ADR-0112.
  const handOn = handOnState({ previous: previousHooksPath(gitPaths), base: repoTopLevel({ ...gitPaths, cwd: root }) ?? root });
  if (handOn.state === 'kit') {
    out.push(f('warn', 'gate-hand-on',
      `the hooks folder the install replaced, ${handOn.previous}, is another copy of this kit's gate - every commit runs both, and the older one decides on its own rules (on 2026-10-03 one crashed and failed open)`,
      'git config --global --unset research-kit.previousHooksPath'));
  } else if (handOn.state === 'missing') {
    out.push(f('warn', 'gate-hand-on',
      `the hooks folder the install replaced, ${handOn.previous}, no longer exists - the hooks hand on to nothing there`,
      'git config --global --unset research-kit.previousHooksPath'));
  }

  const runtime = runtimePaths(env);
  let registered = 'none';
  try {
    registered = settingsState({ env });
  } catch {
    registered = 'unparseable';
  }
  const repair = kitCommand('install-hooks.mjs', '--edit-only');
  if (registered === 'current') out.push(f('pass', 'gate-edit', `registered in ${runtime.settingsPath}, pointing at the deployed kit`));
  else if (registered === 'foreign') {
    out.push(f('fail', 'gate-edit',
      `registered in ${runtime.settingsPath}, but pointing at a hook OUTSIDE the deployed kit - the gate that runs is not the kit that is installed`,
      repair));
  } else if (registered === 'dangling') {
    out.push(f('fail', 'gate-edit',
      `registered in ${runtime.settingsPath}, and the hook file it names is not on disk - a gate that silently gates nothing`,
      repair));
  } else if (registered === 'retired') {
    out.push(f('warn', 'gate-edit',
      `registered at a RETIRED hook name in ${runtime.settingsPath}`, repair));
  } else if (registered === 'unfamiliar' || registered === 'unparseable') {
    out.push(f('fail', 'gate-edit', `${runtime.settingsPath} does not parse - the edit-time gate cannot load`));
  } else {
    out.push(f('warn', 'gate-edit', `not registered in ${runtime.settingsPath}`, repair));
  }

  return out;
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export function editGateState(settings) {
  if (settings === null) return 'none';
  const hooks = settings?.hooks?.PreToolUse;
  if (!Array.isArray(hooks)) return 'none';
  const commands = hooks.flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks : []).map((h) => String(h?.command ?? '')));
  if (commands.some((c) => namesHook(c, EDIT_GATE_HOOK))) return 'current';
  if (commands.some((c) => RETIRED_EDIT_GATE_HOOKS.some((retired) => namesHook(c, retired)))) return 'retired';
  return 'none';
}

// ---------------------------------------------------------------- secrets

/**
 * Rule 6 says the key never enters the repository. This is what checks.
 *
 * It states its coverage rather than implying completeness: a clean result here means
 * "these patterns were not found in these files", not "this repository holds no
 * secrets". Dotfiles are INCLUDED - `.env.local` and the kit's own hidden logs are
 * exactly where a credential hides, and a scanner that skips every dotfile but `.env`
 * reports clean on the files most likely to carry one. Binaries are OUTSIDE it, by content
 * (`looksBinary`: a NUL byte in the first 8000 bytes), and the coverage says so: an
 * executable's string table carries the PEM marker it parses, and random bytes spell
 * `sk-`, so `doctor` on a folder holding OpenSSH reported fourteen committed keys that
 * were none (2026-10-02, ADR-0128). A `.pem` is text and stays caught.
 */
export const SECRET_PATTERNS = Object.freeze([
  { name: 'firecrawl-key', re: /\bfc-[A-Za-z0-9]{16,}\b/ },
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/ },
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'google-api-key', re: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'bearer-in-url', re: /[?&](?:api[_-]?key|access[_-]?token|token)=[A-Za-z0-9._-]{12,}/i },
]);

const SECRET_SKIP_DIRS = new Set(['node_modules', '.git', 'research/raw']);
// A capture is page content, not a committed credential: the root's `research/raw` has
// always been outside the scan, and a nested decision project (ADR-0030) has the same
// folder at depth. Until 2026-10-04 only the ROOT's was skipped - the set matched the
// relative path - so CI scanned the second gap audit's corpora and a Google page's source
// sibling (ADR-0140) tripped `google-api-key` on Google's own public keys.
const isRawFolder = (rel) => rel === 'research/raw' || rel.endsWith('/research/raw');
const SECRET_MAX_BYTES = 512 * 1024;

export function scanForSecrets(root, { maxFiles = 2000 } = {}) {
  const hits = [];
  let scanned = 0;
  let skippedLarge = 0;
  let skippedBinary = 0;
  let capped = false;
  // The machine's scratch folder is not the project, and it is skipped by ABSOLUTE path
  // rather than by name. It usually sits outside the tree being scanned, so this costs
  // nothing - but a RELATIVE TMPDIR is legal, and then the scratch folder resolves INSIDE
  // the checkout. The kit's own temporary files were reported as credentials committed to
  // the repository, which is a scanner crying wolf about itself (found 2026-09-29).
  let temp = null;
  try { temp = fs.realpathSync(tempBase()); } catch { /* no temp folder to skip */ }

  const seen = new Set();
  const walk = (dir, rel) => {
    if (scanned >= maxFiles) { capped = true; return; }
    let real;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const name of entries) {
      const childRel = rel ? `${rel}/${name.name}` : name.name;
      if (SECRET_SKIP_DIRS.has(name.name) || SECRET_SKIP_DIRS.has(childRel) || (name.isDirectory() && isRawFolder(childRel))) continue;
      const abs = path.join(dir, name.name);
      if (name.isDirectory()) {
        if (temp !== null) {
          try { if (fs.realpathSync(abs) === temp) continue; } catch { /* unreadable: fall through and walk it */ }
        }
        walk(abs, childRel);
        continue;
      }
      if (scanned >= maxFiles) { capped = true; return; }
      let size = 0;
      try { size = fs.statSync(abs).size; } catch { continue; }
      if (size > SECRET_MAX_BYTES) { skippedLarge += 1; continue; }
      const text = readText(abs);
      if (text === null) continue;
      if (looksBinary(text)) { skippedBinary += 1; continue; }
      scanned += 1;
      for (const pattern of SECRET_PATTERNS) {
        const match = text.match(pattern.re);
        if (!match) continue;
        const line = text.slice(0, match.index).split('\n').length;
        hits.push({ file: childRel, line, pattern: pattern.name });
      }
    }
  };
  walk(root, '');

  return {
    hits,
    scanned,
    skippedLarge,
    skippedBinary,
    // Count alone does not establish an omitted path: the final file may reach the cap.
    // Record only a return that actually prevented further traversal, and do not guess
    // how many files remain in paths the bounded scan never inspected.
    capped,
    coverage: `${SECRET_PATTERNS.length} credential patterns over ${scanned} text file(s) with a ${maxFiles}-file cap, dotfiles included, ${skippedBinary} binary file(s) skipped, excluding ${[...SECRET_SKIP_DIRS].join(', ')} (at any depth)`
      + (capped ? `; incomplete coverage: traversal stopped at the ${maxFiles}-file cap, leaving paths uninspected` : ''),
  };
}

// ---------------------------------------------------------------- the report

/**
 * `runDoctor(root, opts)` -> `{ findings, ok, blocking }`.
 * Explicit Git/config/settings paths and a child environment let diagnostics run
 * against disposable fixtures without consulting host state.
 */
export function runDoctor(root, { env = process.env, gitPaths = {}, probe = probeFirecrawl, record = true } = {}) {
  const findings = [...machineHealth({ env, gitPaths, probe })];
  const role = machineRole(env);

  // project shape
  const gated = isGated(root);
  findings.push(f(gated ? 'pass' : 'warn', 'project-gated',
    gated ? `gated by ${GATE_MARKERS.filter((m) => exists(resolve(root, m)) || isDirectory(resolve(root, m))).join(', ')}` : 'no gate marker here - this project is not gated'));

  if (gated) {
    for (const finding of validateProject(root).findings) {
      findings.push(f(finding.severity, `shape-${finding.rule}`, finding.detail));
    }
  }

  // the verdict and the chain, from one snapshot
  const context = verdictContext(root, { env });
  const corpus = context.corpus;

  if (gated) {
    const verdict = runPreflight(root, { context, env });
    findings.push(verdict.pass
      ? f('pass', 'preflight', `PASS (${verdict.counts.warn} warning(s))`)
      : f('fail', 'preflight', `${verdict.counts.fail} blocking finding(s): ${verdict.failures.slice(0, 3).map((x) => `${x.check}/${x.rule}`).join(', ')}`,
        kitCommand('preflight.mjs')));

    const chain = corpus.chain;
    if (!chain.present) {
      findings.push(f('fail', 'ledger-missing', `${PATHS.ledger} is absent`));
    } else if (!chain.ok) {
      findings.push(f('fail', 'ledger-chain', `${chain.problems.length} chain problem(s): ${chain.problems.slice(0, 3).map((p) => p.rule).join(', ')}`));
    } else {
      findings.push(f('pass', 'ledger-chain', `${chain.entries.length} entries, chain verifies`));
    }

    for (const problem of corpus.problems.filter((p) => p.kind === 'raw-dangling')) {
      findings.push(f('fail', 'raw-dangling', `${problem.row} cites ${problem.file}, which is not on disk`));
    }
  }

  // overrides, counted
  const counts = new Map();
  for (const entry of corpus.overrides) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  if (counts.size) {
    findings.push(f('warn', 'overrides',
      [...counts].map(([kind, n]) => `${kind} x${n}`).join(', ')));
  } else {
    findings.push(f('pass', 'overrides', 'none recorded'));
  }

  const secrets = scanForSecrets(root);
  if (secrets.hits.length) {
    for (const hit of secrets.hits) {
      findings.push(f('critical', 'secret',
        `${hit.file}:${hit.line} matches ${hit.pattern} - the key never belongs in this repository (Rule 6)`,
        'move it to the CLI config or the environment, then rotate it: a committed key is a leaked key'));
    }
  }
  if (secrets.capped) {
    findings.push(f('warn', 'secret-scan', secrets.coverage));
  } else if (!secrets.hits.length) {
    findings.push(f('pass', 'secret-scan', `no match: ${secrets.coverage}`));
  }

  findings.push(...gateHealth(root, { env, gitPaths, record }));

  // the arrival question - composed ONCE, from the corpus already read
  const handoff = verifyHandoff(root, { corpus });
  if (!handoff.ok) {
    // On a collector these are what a BUILDER would meet, so they are information, and
    // they say so. They used to be graded `pass` with the builder's wording, which on a
    // fresh collector project read "pass ... the corpus arrived without its ledger" when
    // nothing had arrived and nothing had been collected.
    for (const finding of handoff.findings.filter((x) => x.name !== 'handoff-remedy')) {
      if (role === 'builder') {
        findings.push(f('fail', finding.name, finding.detail));
      } else {
        const here = finding.name === 'handoff-ledger-missing'
          ? `${PATHS.ledger} does not exist yet - nothing has been collected here`
          : finding.detail;
        findings.push(f('info', finding.name, `${here}; a builder handed this corpus would be refused`));
      }
    }
    if (role === 'builder') {
      findings.push(f('info', 'handoff-remedy', handoffRemedy(handoff)));
    }
  } else if (gated) {
    findings.push(f('pass', 'handoff', `${handoff.entries} ledger entries, ${handoff.rows} evidence rows, every capture they cite on disk`));
  }

  // the archive this project was handed over as (ADR-0028)
  //
  // Reported, never failed. A file that moved is a fact about this repository's history;
  // the only thing that would make it a problem is nobody knowing. So an UNEXPECTED
  // change warns - somebody should be able to point at the commit that explains it - and
  // everything else passes.
  const bundle = verifyBundle(root);
  if (bundle.present) {
    findings.push(bundle.ok
      ? f('pass', 'bundle', bundleSummary(bundle))
      : f('warn', 'bundle', bundleSummary(bundle)));
  }

  // deployment
  //
  // This used to report the install STATE and stop: "kit deployed <date> to <path>", pass.
  // Recorded is not current, and the difference is not academic - measured here on
  // 2026-09-22, that check printed pass, and READY, over a deployment missing 119 files and
  // carrying 38 stale ones, including a skill describing a protocol without the step
  // shipped that morning. An agent invoking the skill runs the DEPLOYED copy, so everything
  // fixed since the last install existed only in the repository while doctor called the
  // machine healthy.
  //
  // Diagnosed, never repaired. `install.mjs` acts; a health check that quietly rewrote what
  // it was measuring would erase the evidence of the problem it just found.
  const installed = readInstallState(env);
  // Measured against the home the install recorded - the one the hooks point at, which
  // `commitGateState` reads the same way - so the measurement and the message agree.
  const deployHome = installed?.kitHome ?? KIT_HOME;
  const drift = deployedDrift({ env, kitHome: deployHome });
  if (!installed) {
    findings.push(f('warn', 'deploy', `no install state recorded - run: node ${path.join(KIT_ROOT, 'bin', 'install.mjs')}`));
  } else if (samePath(KIT_ROOT, deployHome)) {
    // Found 2026-10-02 (break-test pass 3): run from the deployed copy - the copy an agent
    // runs - after a line was appended to its lib/core.mjs, doctor printed "matches this
    // tree". It did: a tree compared with itself always matches, and the check had measured
    // nothing. Said as such, with the command that does measure.
    findings.push(f('info', 'deploy',
      `doctor is running from the deployed kit itself (${deployHome}) - a tree compared with itself always matches, so drift against the repository is not measured here. `
      + 'To measure it, run the repository\'s copy: node <repository>/research-kit/bin/doctor.mjs'));
  } else if (drift.drifted) {
    findings.push(f('warn', 'deploy',
      `the deployed kit is NOT this one - ${driftNote(drift)}. `
      + `Recorded ${installed.at ?? 'at an unknown time'}; an agent runs the deployed copy, not this tree. `
      + `Fix: node ${path.join(KIT_ROOT, 'bin', 'install.mjs')}`));
  } else {
    findings.push(f('pass', 'deploy', `kit deployed ${installed.at ?? ''} to ${deployHome}, and it matches this tree`));
  }
  for (const location of skillLocations(env)) {
    if (!exists(location)) {
      findings.push(f('warn', 'skill', `${location} is absent - the protocol binds through AGENTS.md alone here`));
      continue;
    }
    const skill = drift.skills.find((s) => s.location === location);
    const stale = skill ? skill.missing.length + skill.changed.length : 0;
    findings.push(stale
      ? f('warn', 'skill', `${location} is STALE - ${stale} file(s) differ from this tree, so the protocol an agent reads is not the one here`)
      : f('pass', 'skill', `${location}`));
  }

  const blocking = findings.filter((x) => x.severity === 'fail' || x.severity === 'critical');
  return { root, role, findings, blocking, ok: blocking.length === 0 };
}
