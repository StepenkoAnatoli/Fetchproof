// credits.mjs - what a run does when the paying provider runs dry (ADR-0086, ADR-0129).
//
// The ONE owner of a run's exhaustion state: whether it switched transports once
// (`fellBack`) or stopped (`stopped`), the accounting the summary prints (`uncollected`,
// `skippedSearches`), and the one `credits-exhausted` row the failure log keeps per run.
// The coordinator (`research-run.mjs`) sequences the run and asks this policy which
// provider serves each call; `bin/research.mjs` reads the state back off the run result
// and prints the two ways forward. Decision, record and message live together here
// because they may not drift apart: the switch happens once, mid-run, and a run that
// records a switch it did not make is a run whose failure log lies.
//
// Credits run out mid-run. Firecrawl answers 402, and its CLI passes on only the text
// "Insufficient credits ...", so the adapter itself says what exhaustion looks like
// (`creditsExhausted`) - the status never reaches the kit. Until 2026-09-28 every page
// after that point was recorded as failed.

import { canSearch } from './transport.mjs';

/**
 * The exhaustion policy for one run. `ask` is the search function the coordinator built
 * (rate-limit patience included); `record` writes one row to the failure log.
 */
export function creditsPolicy({ adapter, fallbackAdapter = null, ask, record = () => {}, log = () => {} }) {
  let fellBack = null;
  // No fallback given - the default on a local run (ADR-0129): exhaustion STOPS the run, so
  // the operator decides between topping up and the free transports. Every later search is
  // not run and every later page is not attempted; they are `uncollected`, never failed and
  // never spent. The first refusal is recognised whether or not there is somewhere to switch
  // to; until 2026-10-02 a run with no fallback tried every remaining page and was refused
  // each time.
  let stopped = null;

  /** Is this failure the PAYING adapter running dry? A fallback's own failure never is. */
  const exhausted = (provider, text) => Boolean(provider === adapter && provider.creditsExhausted?.(text));

  /** The provider serving calls now: after a switch, the exhausted adapter's place is taken. */
  const live = (provider) => (fellBack && provider === adapter ? fallbackAdapter : provider);

  /**
   * The ONE transition: switch to the fallback (ADR-0086) or stop (ADR-0129). Whichever it
   * is, it happens once - a second exhaustion is refused by the guard, because there is
   * nowhere left to go.
   */
  const onExhaustion = (text, during) => {
    if (fellBack || stopped) return;
    const error = String(text ?? '').slice(0, 300);
    if (!fallbackAdapter) {
      stopped = { reason: 'credits exhausted', provider: adapter.name, during, uncollected: 0, skippedSearches: 0 };
      log(`  credits ran out on ${adapter.name} (during ${during}) - stopped: nothing else is fetched until you top up, or run again with --fallback`);
    } else {
      fellBack = { from: adapter.name, to: fallbackAdapter.name, reason: 'credits exhausted' };
      log(`  credits ran out on ${adapter.name} (during ${during}) - the rest of this run uses ${fallbackAdapter.name}; each capture records the transport that fetched it`);
    }
    record({
      at: new Date().toISOString(), op: 'credits-exhausted', provider: adapter.name,
      ...(fallbackAdapter ? { fallback: fallbackAdapter.name } : { action: 'stopped' }),
      error,
    });
  };

  /** Ask, and on exhaustion switch and ask the fallback in the same breath. */
  const askLive = (provider, text) => {
    const first = live(provider);
    const r = ask(first, text);
    if (!r.ok && exhausted(first, r.error)) {
      onExhaustion(r.error, `search "${text}"`);
      // A fallback that fetches but cannot search takes over the fetching only; this search's
      // failure is the exhaustion that happened. A stopped run has nothing to ask.
      if (!stopped && canSearch(fallbackAdapter)) return { r: ask(fallbackAdapter, text), provider: fallbackAdapter };
    }
    return { r, provider: first };
  };

  return {
    exhausted,
    live,
    onExhaustion,
    askLive,
    /** One more page the stopped run will not attempt. Counted here, and only here. */
    countUncollected() { if (stopped) stopped.uncollected += 1; },
    /** One more search the stopped run will not run. */
    countSkippedSearch() { if (stopped) stopped.skippedSearches += 1; },
    /** `{ from, to, reason }` once the run switched transports (ADR-0086), else null. */
    get fellBack() { return fellBack; },
    /** `{ reason, provider, during, uncollected, skippedSearches }` once exhaustion stopped
     *  the run (ADR-0129), else null. */
    get stopped() { return stopped; },
  };
}
