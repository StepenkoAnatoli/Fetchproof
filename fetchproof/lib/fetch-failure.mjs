// lib/fetch-failure.mjs - what a failed fetch's recorded text says about the page (ADR-0194).
//
// One reading of a ledger `op: 'fail'` entry's `error`, shared by the two modules that ask:
// the collector, which does not fetch again a page that will answer the same (ADR-0100,
// ADR-0174), and the gate, which fails a citation whose page a refresh found gone
// (`cites-gone-page`, ADR-0194). Moved here from collect.mjs on 2026-10-25 so the two cannot
// disagree about "gone", and so the gate does not import the collector - and through it the
// transports - to ask. It imports nothing: it reads strings, and every caller hands it one.

/**
 * A failure that reads as a rate limit, in any transport's wording: Firecrawl's
 * "Rate limit exceeded ... retry after 13s" and the `403 ... API rate limit exceeded` GitHub
 * answers a keyless client. Firecrawl's adapter reads the wait from the same text
 * (`rateLimitWaitMs`, lib/firecrawl.mjs), and asks here first, so "is this a rate limit" has
 * one answer for the wait loop, the collector's memory and the gate.
 */
export function isRateLimited(errorText) {
  return /rate limit exceeded/i.test(String(errorText ?? ''));
}

/**
 * The HTTP status a failure names, as the collector words it ("the page answered HTTP 403") or
 * as the keyless and browser transports word theirs ("HTTP 403 - the server said ..."), or null.
 * Anchored, so a status quoted inside some other failure's text is not read as this one's.
 */
export const FAILED_STATUS = /^(?:the page answered )?HTTP (\d{3})\b/;
/** Statuses that say the page is not there, as opposed to a server that was busy. */
export const GONE = new Set([404, 410]);
/**
 * A 4xx that is not about this moment: the server's standing answer to this client (a 401, a
 * 403, a 402 paywall). 408 (a request timeout) and 429 (a rate limit) are about this moment;
 * 405 and 407 are what a proxy answers for every page it will not carry (#314's proxy said 405
 * to a loopback target), so they say nothing about the page.
 */
const NOT_STANDING = new Set([405, 407, 408, 429]);
const STANDING = (status) => status >= 400 && status < 500 && !NOT_STANDING.has(status);
/**
 * The kit's own refusals of what a page IS, which the same page earns again on every fetch
 * (ADR-0174): over the size a capture may hold (ADR-0082), a binary body (ADR-0105).
 */
const DETERMINISTIC = [
  [/a capture may hold - not kept|is larger than \d+ MiB - not (?:read|kept) \(ADR-0082\)/, 'over the size a capture may hold'],
  [/which is not text - the [\w-]+ transport cannot keep a faithful copy of it/, 'the response is not text'],
];

/**
 * Why a failure will not change by asking again - `{ status: 'gone' | 'refused', why }` - or null.
 *
 * A failure that reads as a rate limit is never one, whatever its status: GitHub answers a
 * keyless client `403 ... API rate limit exceeded`, which the wait loop already treats as "not
 * now". A standing 4xx is the server's answer to the ROUTE that asked (`sameRoute`): a page
 * that refuses the keyless client is exactly what the browser transport is for (ADR-0088), so
 * another transport is not told the answer one got. A size or binary refusal is about the page
 * whichever route fetched it, and so is a 404 or 410 (ADR-0100).
 */
export function standingFailure(error, { sameRoute = false } = {}) {
  const text = String(error ?? '');
  if (isRateLimited(text)) return null;
  const status = Number(FAILED_STATUS.exec(text)?.[1]);
  if (GONE.has(status)) return { status: 'gone', why: `answered HTTP ${status}` };
  if (STANDING(status)) return sameRoute ? { status: 'refused', why: `the page answered HTTP ${status}` } : null;
  const kit = DETERMINISTIC.find(([pattern]) => pattern.test(text));
  return kit ? { status: 'refused', why: kit[1] } : null;
}

/**
 * The HTTP status of a failure `standingFailure` reads as gone (404 or 410), else null. The
 * gate's question (`cites-gone-page`): it names the status in its finding, and asks through
 * `standingFailure` so a rate limit worded with a 404 is not gone here either.
 */
export function goneStatus(error) {
  if (standingFailure(error)?.status !== 'gone') return null;
  return Number(FAILED_STATUS.exec(String(error ?? ''))[1]);
}
