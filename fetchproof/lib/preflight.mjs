// preflight.mjs - the verdict, and the verdict's input unit.
//
// One function, three callers (the commit gate, the edit gate, the CLI), so they cannot
// disagree. Severity policy is the OPERATOR's machine config, never the agent's pick.

import { PATHS, resolve, exists } from './core.mjs';
import { readCorpus } from './corpus.mjs';
import { verifyLedger } from './provenance.mjs';
import { runChecks, CHECK_NAMES } from './checks.mjs';
import { evidencePolicy, loadConfig, localHooksPathOverride } from './machine.mjs';

import { kitCommand } from './core.mjs';
/**
 * Findings these checks raise are warnings under `pluralist`, failures under `strict`.
 *
 * All three are questions an EVIDENCE POLICY should answer rather than the kit: how the
 * capture was fetched, how much of the page arrived, and how many independent readings a
 * claim rests on. Each has a defensible lenient answer - an agent page-fetch is still a
 * fetch, a partial capture can still contain the sentence, and a vendor's own reference
 * is the authority on that vendor. `strict` is where an operator says otherwise.
 */
const POLICY_CHECKS = new Set(['transport-provenance', 'capture-completeness', 'corroboration']);

export function readGateState(root, env = process.env) {
  return {
    gateOff: exists(resolve(root, PATHS.gateOff)),
    localHooksPath: localHooksPathOverride(root, { env }),
  };
}

/**
 * The corpus, the gate state, and the operator's evidence policy, read TOGETHER.
 * A caller that injects a corpus gets its gate state from the snapshot's own root -
 * never the process cwd - so the same snapshot cannot yield a different verdict.
 */
export function verdictContext(root, { corpus = null, env = process.env } = {}) {
  const snapshot = corpus ?? readCorpus(root);
  if (!snapshot.chain) snapshot.chain = verifyLedger(snapshot.root, { corpus: snapshot });
  const config = loadConfig(env);
  return {
    root: snapshot.root,
    corpus: snapshot,
    gate: readGateState(snapshot.root, env),
    evidencePolicy: evidencePolicy(env),
    maxAgeDays: config.maxAgeDays,
  };
}

function promote(finding, policy, strict) {
  if (finding.severity !== 'warn') return finding;
  if (strict) return { ...finding, severity: 'fail', promoted: 'strict' };
  if (policy === 'strict' && POLICY_CHECKS.has(finding.check)) {
    return { ...finding, severity: 'fail', promoted: 'evidencePolicy=strict' };
  }
  return finding;
}

/**
 * Run the registry over one snapshot and decide what it means.
 * `{ pass, findings, failures, warnings, counts, context }`.
 */
export function runPreflight(root, { corpus = null, env = process.env, only = [], strict = false, context = null } = {}) {
  const ctx = context ?? verdictContext(root, { corpus, env });
  const findings = runChecks(ctx.corpus, {
    only,
    maxAgeDays: ctx.maxAgeDays,
    localHooksPath: ctx.gate.localHooksPath,
    evidencePolicy: ctx.evidencePolicy,
  }).map((f) => promote(f, ctx.evidencePolicy, strict));

  const failures = findings.filter((f) => f.severity === 'fail');
  const warnings = findings.filter((f) => f.severity === 'warn');
  return {
    root: ctx.root,
    pass: failures.length === 0,
    findings,
    failures,
    warnings,
    counts: {
      pass: findings.filter((f) => f.severity === 'pass').length,
      warn: warnings.length,
      fail: failures.length,
    },
    evidencePolicy: ctx.evidencePolicy,
    context: ctx,
  };
}

/** The one line a failing verdict tells an operator to run. */
export function fixCommand() {
  return kitCommand('preflight.mjs');
}

export { CHECK_NAMES };
