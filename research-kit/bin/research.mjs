#!/usr/bin/env node
// bin/research.mjs - the collector's CLI.
//
// Refused on a BUILDER machine (exit 2) before any credential or adapter is consulted:
// a page fetched by hand is not evidence in this kit, and a builder that "re-collects"
// a missing page forges a corpus instead of reporting a gap.
//
// `--dry-run` and `--status` still work there, because they spend nothing.

import { parseFlags, flagList, refuseUnknownFlags, checkFlagValues, resolve, readText, parseJson, operatorPath, kitCommand, writeFailure, NAMED_RUN_REFUSALS } from '../lib/core.mjs';
import { collectionPolicy, collectionRefusal, loadConfig } from '../lib/machine.mjs';
import { findBrowser } from '../lib/browser-transport.mjs';
import { selectTransport, TRANSPORTS, TRANSPORT_NAMES, SEARCH_PROVIDER_NAMES, unusedKeyNote } from '../lib/transport.mjs';
import { runResearch, searchSummaryLine, readPlan, planProblems, usageSummary, topicMatch, DEPTHS, DEPTH_SCRAPES } from '../lib/research-run.mjs';
import { parseCapture, readLedger, duplicateKey } from '../lib/corpus.mjs';
import { readPrior } from '../lib/prior.mjs';
import { heading } from '../lib/render.mjs';
const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['depth', 'dry-run', 'fallback', 'force', 'help', 'no-fallback', 'only', 'plan', 'refresh-days', 'search-transport', 'status', 'transport', 'witness']);
checkFlagValues(flags, { depth: { choices: DEPTHS }, 'refresh-days': { int: true, min: 0 }, plan: 'value', only: 'value', transport: 'value', 'search-transport': 'value' });
const root = process.cwd();

if (flags.help) {
  process.stdout.write(`research - collect primary evidence into this project's corpus.

  node research-kit/bin/research.mjs [options]

  --plan <file>        plan to run (default research/plan.json)
  --depth <tier>       ${DEPTHS.map((d) => `${d} (${DEPTH_SCRAPES[d]})`).join(', ')}
  --refresh-days <n>   re-collect a capture older than n days
  --only <text>        run only the plan queries containing this text (repeatable)
  --force              ignore the cache, and run a search whose unknowns are all closed
  --dry-run            say what would be collected; spend nothing
  --status             budget and corpus state; spend nothing
  --transport <name>   ${TRANSPORT_NAMES.join(' | ')}
  --search-transport <name>
                       ${SEARCH_PROVIDER_NAMES.join(' | ')} - the SEARCH side only.
                       Default: the fetch transport, unless a SerpAPI key is configured.
  --fallback           when Firecrawl's credits run out, switch the rest of the run to
                       browser (when one is installed) or http-keyless instead of stopping.
                       The GitHub collector passes it: nobody is there to decide. Without
                       it the run stops, says what is left, and exits 2 so the operator
                       chooses between topping up and the free transports (ADR-0129).
                       --no-fallback is accepted and means the default.
  --witness            after each newly collected page, ask the Wayback Machine for its
                       closest snapshot and record it in research/witnesses.jsonl. Sends
                       each collected URL to the Internet Archive; off by default.

Every scrape spends a credit. Plan the queries before collecting.
`);
  process.exit(0);
}

const spends = !flags['dry-run'] && !flags.status;
const policy = collectionPolicy();
if (spends && !policy.mayCollect) {
  process.stderr.write(`${collectionRefusal(policy)}\n`);
  process.exit(2);
}

if (flags.status) {
  const plan = readPlan(root, typeof flags.plan === 'string' ? flags.plan : '');
  const usage = usageSummary(root);
  let transport = null;
  try {
    transport = selectTransport({
      explicit: typeof flags.transport === 'string' ? flags.transport : '',
      explicitSearch: typeof flags['search-transport'] === 'string' ? flags['search-transport'] : '',
    });
  } catch (err) {
    // A misspelled provider is an operator error, not a state to report. The old comment
    // here said "reported below" and nothing below reported it: `--status` printed
    // "unresolved" and exited 0, so `--transport firecrwal` looked like a healthy
    // machine with a detection problem. Found by the first test that ever ran this
    // binary.
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
  process.stdout.write(`${heading('corpus')}
captures on disk   ${usage.captures}
evidence rows      ${usage.evidence}
ledger entries     ${usage.ledgerEntries} (${usage.scrapes} scrape, ${usage.failures} failed)
${heading('plan')}
topic              ${plan.topic || '(unset)'}
depth              ${plan.depth} - up to ${Math.min(plan.maxScrapes, DEPTH_SCRAPES[plan.depth] ?? DEPTH_SCRAPES.quick)} scrapes a run${plan.maxScrapes < (DEPTH_SCRAPES[plan.depth] ?? DEPTH_SCRAPES.quick) ? ` (the plan's maxScrapes; this depth allows ${DEPTH_SCRAPES[plan.depth] ?? DEPTH_SCRAPES.quick})` : ''}
queries / urls     ${plan.queries.length} / ${plan.urls.length}
refresh-days       ${plan.refreshDays}
${heading('machine')}
role               ${policy.role}${policy.mayCollect ? '' : ' - this machine must NOT collect'}
transport          ${transport.name} (${transport.why})
search transport   ${transport.search.name}${transport.search.sameAsFetch ? ' - same meter as fetch' : ` (${transport.search.why})`}
searches (this project) ${usage.search.lastHour} in the last hour, ${usage.search.thisMonth} this month${usage.search.providers.length ? ` (${usage.search.providers.join(', ')})` : ''}
                   free-tier caps are ${usage.search.perHourCap}/hour and ${usage.search.perMonthCap}/month; ${usage.search.caveat}
${usage.search.creditsEstimate ? `                   ≈${usage.search.creditsEstimate} credits this month on search, as the adapter estimated them - doctor shows the real balance\n` : ''}${(transport.search.adapter?.METER_NOTES ?? [])
  // The selected search adapter says what the numbers mean for its vendor (U-9, U-10). A
  // machine with no separate search provider selects none that has notes, so it is told
  // nothing about a provider it never configured (FR-5).
  .map((note) => `                   ${note}\n`).join('')}${vendorMeter(transport.search)}`);
  process.exit(0);
}

/**
 * The search vendor's OWN count of this account, when the selected search adapter can read
 * it (ADR-0040). The lines above are this machine's count and the documented plan; this is
 * the vendor's answer, across every machine, for the billing cycle it actually uses. A
 * provider with no such endpoint, or no key, prints nothing and makes no call.
 */
function vendorMeter(search) {
  const read = search?.adapter?.account;
  if (typeof read !== 'function' || search.notReady) return '';
  const r = read();
  if (!r.ok) {
    return `vendor meter       unavailable from ${r.source} (${r.error}) - the lines above are this machine's count\n`;
  }
  const a = r.account;
  const shown = (v) => (v === null ? '?' : v);
  return `vendor meter       ${shown(a.usedThisCycle)} used this cycle, ${shown(a.left)} left of ${shown(a.perMonth)}`
    + `${a.renews ? `, renews ${a.renews}` : ''}; ${shown(a.perHour)}/hour for this account, ${shown(a.thisHour)} this hour\n`
    + `                   from ${r.source} - the vendor's own count, free and not counted (E-26)\n`;
}

// An empty plan is refused before anything runs. The scaffold's plan has no queries and no
// urls, and new-project's step 3 is "research.mjs": it printed "collected 0" and exited 0, so a
// run that did nothing read as a run that found nothing (found 2026-09-27).
{
  const planPath = typeof flags.plan === 'string' ? flags.plan : 'research/plan.json';
  // Named before "empty": readPlan reads an unparseable or missing file as the defaults, so a
  // trailing comma was reported as "no queries and no urls" (found 2026-09-27).
  const planText = readText(operatorPath(root, planPath));
  if (planText === null) {
    process.stderr.write(`${planPath} does not exist - nothing to collect. new-project writes research/plan.json.\n`);
    process.exit(2);
  }
  try { parseJson(planText); } catch (err) {
    process.stderr.write(`${planPath} does not parse as JSON (${err.message}) - fix it, then run this again.\n`);
    process.exit(2);
  }
  // A duplicate key keeps only the LAST value in JSON.parse, so the entry the operator
  // pasted is not the entry that would be collected - and this is the command that spends.
  // The gate names it too, but preflight runs AFTER collection, once the credits are gone
  // (found 2026-09-30, break-test).
  const duplicate = duplicateKey(planText);
  if (duplicate) {
    process.stderr.write(`${planPath} ${duplicate} - fix it, then run this again.\n`);
    process.exit(2);
  }
  const problems = planProblems(parseJson(planText));
  if (problems.length) {
    process.stderr.write(`${planPath} has ${problems.length} problem(s) - fix them, then run this again:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
    process.exit(2);
  }
  const planned = readPlan(root, typeof flags.plan === 'string' ? flags.plan : '');
  // --only filters queries. Matching none ran nothing and read as a search that found nothing.
  const only = flagList(flags.only);
  const queryText = (q) => String(typeof q === 'string' ? q : q?.q ?? '').toLowerCase();
  if (only.length && !planned.queries.some((q) => only.some((needle) => queryText(q).includes(needle.toLowerCase())))) {
    process.stderr.write(`--only matched none of the plan's ${planned.queries.length} quer${planned.queries.length === 1 ? 'y' : 'ies'}: `
      + `${only.map((n) => JSON.stringify(n)).join(', ')}. It matches text inside a query's "q", ignoring case.\n`);
    process.exit(2);
  }
  if (!planned.queries.length && !planned.urls.length) {
    process.stderr.write(`${planPath} has no queries and no urls - nothing to collect.
Add them from the unknowns in research/DISCOVERY.md: each query is { "q": "...", "why": "U-1", "prefer": ["official.domain"] },
and each url is { "url": "https://...", "why": "U-1", "type": "P" }. Then run this again.
`);
    process.exit(2);
  }
}

let chosen;
try {
  chosen = selectTransport({
    explicit: typeof flags.transport === 'string' ? flags.transport : '',
    explicitSearch: typeof flags['search-transport'] === 'string' ? flags['search-transport'] : '',
  });
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(2);
}
// An explicit search provider that cannot run (no key, no instance) is refused before anything
// is searched. selectSearch reports it on the SELECTION; this passed only the provider module
// to runResearch, whose own check therefore never fired (found 2026-09-30).
if (spends && chosen.search.notReady) {
  process.stderr.write(`${chosen.search.notReady}\n`);
  process.exit(2);
}

// The last moment a prediction can still be a prediction. Printed rather than enforced:
// a prior is optional, and a collector that refused without one would make the habit a
// toll instead of a discipline. It is worth a line here because there is no second chance
// - after the first page lands, `bin/prior.mjs` refuses, and rightly.
if (spends && !readPrior(root, { entries: readLedger(root).entries }).present) {
  process.stdout.write('prior:     none registered. What do you expect to find? '
    + `${kitCommand('prior.mjs', '"..."')} - this is the last moment that answer counts\n`);
}
process.stdout.write(`transport: ${chosen.name} - ${chosen.why}\n`);
process.stdout.write(unusedKeyNote(chosen));
if (!chosen.search.sameAsFetch) {
  process.stdout.write(`search:    ${chosen.search.name} - ${chosen.search.why}\n`);
}
// The transport the run switches to if the chosen one reports its credits exhausted: free,
// no new vendor, already a named transport (ADR-0086). Only an adapter that can say what
// exhaustion looks like gets one, and only when asked (`--fallback`, ADR-0129): on a local
// run the default is to STOP and let the operator decide between topping up and the free
// transports; the unattended GitHub collector passes the flag, since nobody is there to.
// The browser renders what keyless cannot, so it is preferred when one is installed (ADR-0088).
const canExhaust = typeof chosen.adapter?.creditsExhausted === 'function';
const fallbackAdapter = flags.fallback && !flags['no-fallback'] && canExhaust
  ? (findBrowser({ config: loadConfig(process.env) }) ? TRANSPORTS.browser : TRANSPORTS['http-keyless'])
  : null;
if (fallbackAdapter) process.stdout.write(`fallback:  ${fallbackAdapter.name} if credits run out (--fallback)\n`);
else if (canExhaust) process.stdout.write('fallback:  none - if credits run out the run stops and says what is left (--fallback to switch to browser or http-keyless instead)\n');
let run;
try {
  run = runResearch(root, {
    adapter: chosen.adapter,
    fallbackAdapter,
    searchAdapter: chosen.search.adapter,
    searchAdapters: chosen.search.adapters ?? null,
    plan: typeof flags.plan === 'string' ? readPlan(root, flags.plan) : null,
    depth: typeof flags.depth === 'string' ? flags.depth : '',
    refreshDays: flags['refresh-days'] === undefined ? null : Number(flags['refresh-days']),
    force: Boolean(flags.force),
    dryRun: Boolean(flags['dry-run']),
    witness: Boolean(flags.witness),
    only: flagList(flags.only),
    log: (line) => process.stdout.write(`${line}\n`),
  });
} catch (err) {
  const why = writeFailure(err, root);
  if (why) {
    process.stderr.write(`${why}\n`);
    process.exit(2);
  }
  // A refusal the kit wrote itself: its message already names the damage, the reason and the
  // command that repairs it, and 2 is the documented "could not be checked" - the answer
  // bin/prior.mjs gives the same two ledger refusals. Re-thrown, that sentence arrived under
  // a stack trace and exit 1, which reads as FAIL, checked and wrong (found 2026-10-01).
  if (NAMED_RUN_REFUSALS.has(err?.code)) {
    process.stderr.write(`research: ${err.message}\n`);
    process.exit(2);
  }
  throw err;
}

// Only auto-collect opens this private Node IPC channel (ADR-0149). A query or URL may
// appear in diagnostics, so neither its text nor the human summary is an accounting API.
// Wait for the callback and channel closure before an explicit exit. The parent still
// requires actual receipt and validation; this callback is not its acknowledgment.
if (typeof process.send === 'function') {
  const sendError = await new Promise((resolve) => {
    if (!process.connected) { resolve(new Error('IPC channel is closed')); return; }
    let callbackRan = false;
    let error = null;
    const disconnected = () => resolve(error ?? (callbackRan ? null : new Error('IPC channel closed before the accounting send callback')));
    process.once('disconnect', disconnected);
    const closeChannel = () => {
      if (!process.connected) {
        process.removeListener('disconnect', disconnected);
        disconnected();
        return;
      }
      try { process.disconnect(); } catch (err) {
        process.removeListener('disconnect', disconnected);
        resolve(error ?? err);
      }
    };
    try {
      process.send({ type: 'research-kit-accounting', spent: run.spent, stoppedOn: run.stopped?.provider ?? '' }, (err) => {
        callbackRan = true;
        error = err ?? null;
        closeChannel();
      });
    } catch (err) {
      error = err;
      closeChannel();
    }
  });
  if (sendError) {
    process.stderr.write(`research: could not send collection accounting: ${sendError.message}\n`);
    process.exit(2);
  }
}

// Which cap bound the run, and what lifts it (found 2026-09-28): a scaffolded plan says depth
// quick and maxScrapes 10, and a run that stopped at 4 did not say the 10 needs a deeper --depth.
function budgetCap({ depth, budget, maxScrapes }) {
  const deeper = Object.entries(DEPTH_SCRAPES).find(([, n]) => n > budget);
  if (maxScrapes < (DEPTH_SCRAPES[depth] ?? budget)) return `           the plan's maxScrapes ${maxScrapes} caps this run; raise it in research/plan.json\n`;
  if (maxScrapes === budget) {
    return `           depth ${depth} and the plan's maxScrapes both cap this run at ${budget} - raise maxScrapes`
      + (deeper ? ` and pass --depth ${deeper[0]} (${deeper[1]})` : '') + '\n';
  }
  return `           depth ${depth} caps this run at ${budget}; the plan's maxScrapes ${maxScrapes} applies from a deeper tier`
    + (deeper ? ` - --depth ${deeper[0]} allows ${Math.min(deeper[1], maxScrapes)}` : '') + '\n';
}

/**
 * The most a dry run's plan could spend, in the units each meter counts (2026-09-29): it listed
 * each search and page and the budget, never the sum an operator on a free tier previews for.
 * Pages are bounded by the budget - search results fill whatever the named pages leave.
 */
function dryRunTotal(run) {
  const credits = /^firecrawl/.test(run.transport)
    ? ' - on Firecrawl at least 1 credit a page' + (/^firecrawl/.test(run.searchTransport) ? ', about 2 a search' : '')
    : '';
  return `at most    ${run.budget} page fetch(es) and ${run.wouldSearch ?? 0} search(es) on ${run.searchTransport}${credits}; a cached page costs nothing`;
}

process.stdout.write(`${heading('run')}
depth      ${run.depth} (budget ${run.budget} scrapes)
${run.fellBack ? `fell back  ${run.fellBack.from} -> ${run.fellBack.to} (${run.fellBack.reason}); pages after that were fetched by ${run.fellBack.to}, and the ledger says which\n` : ''}${run.stopped ? `stopped    credits ran out on ${run.stopped.provider} during ${run.stopped.during}; ${run.stopped.uncollected} page(s) and ${run.stopped.skippedSearches} search(es) were not attempted\n` : ''}collected  ${run.collected}
cached     ${run.cached}
failed     ${run.failed}
spent      ${run.spent} (budget consumed: collected + failed)
${flags['dry-run'] ? `${dryRunTotal(run)}\n` : ''}${run.overBudget ? `left       ${run.overBudget} over the budget - run again to fetch them; a page already fetched costs nothing\n${budgetCap(run)}` : ''}`);

// The topic signal, printed at the one moment it helps: the pages are on disk and nobody
// has read them yet. It decides nothing - see `topicMatch` for the two thresholds that were
// measured and rejected - but a low number on a fresh collection is the prompt to check the
// URLs, which is exactly the step that caught a wholly off-topic corpus by hand.
//
// Only what THIS run collected is measured. Judging the whole corpus would blend a bad
// collection into whatever was already there and hide the thing worth seeing.
const freshBodies = run.results
  .filter((r) => r.status === 'collected' && r.entry?.file)
  .map((r) => parseCapture(readText(resolve(root, r.entry.file)) ?? '').body);
const match = topicMatch(readPlan(root, typeof flags.plan === 'string' ? flags.plan : '').topic, freshBodies);
if (match) {
  process.stdout.write(`topic      ${match.best.toFixed(2)} best of ${match.terms} topic terms, ${match.strong} capture(s) >= 0.50`
    + (match.strong === 0 ? ' - NOTHING matched strongly; read the URLs before trusting this' : '')
    + '\n');
}
process.stdout.write('\n');
// The second meter reports separately, and a degradation is never silent: it means the
// run quietly moved spend back onto the fetch budget.
if (run.searchTransport !== run.transport) {
  process.stdout.write(`${searchSummaryLine(run)}\n`);
  if (run.degraded) {
    process.stdout.write(`degraded   ${run.degraded} quer${run.degraded === 1 ? 'y' : 'ies'} fell back to ${run.transport} - those spent FETCH credits\n`);
  }
}
// A stopped run is not a finished one (ADR-0129). The decision is the operator's, and it is
// printed where the summary is, with both ways forward; exit 2 says "not finished" to a
// script or an agent that only reads the code.
if (run.stopped) {
  process.stdout.write(`\nDecide before running again - ${run.stopped.uncollected} page(s) are still uncollected:
  - top up ${run.stopped.provider} and run the same command: a page already on disk is not fetched twice, so only what is left is paid for
  - or run it with --fallback: what is left is fetched through browser or http-keyless, free, and the ledger records which transport fetched each page
`);
  process.exit(2);
}
if (run.spent) {
  process.stdout.write(`\nNext: rewrite each auto-extracted Finding cell into a real claim, then run\n  ${kitCommand('preflight.mjs')}\n`);
}
process.exit(0);
