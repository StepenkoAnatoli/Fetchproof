// collect.mjs - one URL's journey.
//
// `collectOne` (cache, force, fail entries, evidence and source rows) and `writeRaw`
// (the capture writer, which hands back the corpus's own index entry).
//
// It stamps `transport` and `completeness` from what the ADAPTER declared and invents
// neither. The Finding cell a row is born with is lib/finding.mjs's: the collector
// IMPORTS firstFinding and does not re-export it, so the extractor has one address.

import fs from 'node:fs';
import path from 'node:path';
import {
  PATHS, HEADERS, resolve, today, sha256, titleFromUrl, hostOf, urlDigest, writeText, readText, exists,
  sleepSync, urlKey, ageInDays, realInside, foldLineEndings,
} from './core.mjs';
import { retryWaitMs, rateLimitWaitMs } from './firecrawl.mjs';
import {
  captureEntry, cacheDecision, rememberCapture, appendRow, upsertRow, nextId,
  readCaptures, parseTable, readLedger, ledgerRank, CAPTURE_MAX_BYTES,
} from './corpus.mjs';
import { appendFetch, withLock } from './provenance.mjs';
import { firstFinding } from './finding.mjs';

/**
 * Refuse a capture path that would lead out of the project (found 2026-10-01, break-test).
 * The name is the kit's own, so a link AT it - dangling or not - is refused outright: a
 * dangling one was followed and the page created outside the project, and one to a file had
 * that file read for the duplicate check. The folder it goes in is judged by REAL path, so a
 * research/raw that links out is refused, while a project that merely lives under a link
 * (macOS /tmp is one) is not.
 */
function assertCapturePath(root, abs) {
  const refuse = (where, why) => {
    const err = new Error(`${where}: ${why} - the kit writes captures only inside the project`);
    err.code = 'OUTSIDE_PROJECT';
    err.path = where;
    throw err;
  };
  let link = false;
  try { link = fs.lstatSync(abs).isSymbolicLink(); } catch { /* nothing there yet */ }
  if (link) refuse(abs, 'the capture\'s name is a link');
  let dir = path.dirname(abs);
  while (!exists(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  const inside = (() => { try { return fs.realpathSync(dir) === fs.realpathSync(root); } catch { return false; } })() || realInside(root, dir);
  if (!inside) refuse(dir, 'a link in this path leads out of the project');
}

/** `research/raw/2026-09-13-rate-limits-firecrawl-552467ff.md` */
export function captureName(url, { date = today(), title = '' } = {}) {
  const slug = title ? String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) : titleFromUrl(url);
  const host = hostOf(url).split('.').slice(-2, -1)[0] || 'page';
  return `${date}-${slug || 'page'}-${host}-${urlDigest(url)}.md`;
}

/** The source sibling of a capture: `<capture>.source.html` (ADR-0140). */
export function sourcePathFor(file) {
  return String(file).replace(/\.md$/, '.source.html');
}

/**
 * Write the text a capture was converted from beside it (ADR-0140), LF-folded like the body,
 * and return `{ file, sha256 }`; null when there is nothing to keep (no source, or a source
 * that IS the capture - a verbatim text or JSON answer); or `{ omitted }` naming why a source
 * that was given is not kept: over CAPTURE_MAX_BYTES, a sibling already on disk with other
 * content (a capture's files are written once), or a sibling name that cannot be written
 * (a link out of the project planted there). The reason rides on the ledger entry as
 * `sourceOmitted`, so a reader can tell "no source" from "not kept" (breaker review,
 * 2026-10-04: a planted link made this throw AFTER the capture was written, which left an
 * orphan capture with no ledger entry that the next run took for a cache hit). Found
 * 2026-10-03 (gap audit, rank 3): the converted Markdown was all the corpus kept, so a
 * conversion defect (G3) was permanent and the ledger certified it.
 */
export function writeSource(root, captureFile, source, markdown) {
  if (typeof source !== 'string' || !source.trim()) return null;
  const text = foldLineEndings(source);
  if (text === foldLineEndings(String(markdown ?? ''))) return null;
  const file = sourcePathFor(captureFile);
  if (file === captureFile) return null;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > CAPTURE_MAX_BYTES) {
    return { omitted: `the source is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${CAPTURE_MAX_BYTES / 1024 / 1024} MB a file under research/raw may be - not kept` };
  }
  const abs = resolve(root, file);
  try {
    assertCapturePath(root, abs);
    if (exists(abs)) {
      if (readText(abs) !== text) return { omitted: `${file} already stands beside this capture with other content - not kept, a capture's files are written once` };
    } else {
      writeText(abs, text);
    }
  } catch (err) {
    return { omitted: `${file} could not be written (${err.code ?? err.message}) - not kept` };
  }
  return { file, sha256: bodyHashOf(root, file) };
}

/**
 * Write one capture with its front-matter. Returns the corpus's own index entry, so a
 * caller stores a fact instead of reconstructing one.
 */
export function writeRaw(root, result, { date = today() } = {}) {
  const base = captureName(result.url, { date, title: result.title });
  // Front matter is one field per line, and these values come from the adapter - a page's
  // title, a vendor's error. A line break in one wrote more fields: a title carrying
  // "\nurl: ...\nretrieved: ..." re-indexed the capture under a URL and date the ledger never
  // recorded (found 2026-10-01, break-test). Each value is one line; the body stays verbatim.
  const one = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ');   // no trim: a value without a break is written as before
  const front = [
    '---',
    `url: ${one(result.url)}`,
    `retrieved: ${one(date)}`,
    `command: ${one(result.cmd)}`,
    `statusCode: ${one(result.statusCode)}`,
    `transport: ${one(result.transport)}`,
    `completeness: ${one(result.completeness ?? 'unspecified')}`,
    ...(result.omitted ? [`omitted: ${one(result.omitted)}`] : []),
    ...(result.title ? [`title: ${one(result.title)}`] : []),
    // A vendor's cached answer, written down when it says so (ADR-0139): the day the kit asked
    // is `retrieved`; the moment the vendor says it took the bytes is `cachedAt`.
    ...(result.cacheState ? [`cacheState: ${one(result.cacheState)}`] : []),
    ...(result.cachedAt ? [`cachedAt: ${one(result.cachedAt)}`] : []),
    '---',
    '',
  ].join('\n');
  // LF only, whatever the transport received. The body hash is taken over these bytes, and
  // the scaffold's .gitattributes (research/raw/* text eol=lf) makes git store the file as
  // LF - so a capture written with the CR bytes a server sent (copyright.gov, keyless,
  // 2026-10-02) hashed one way on the collector and checked out another way everywhere else,
  // failing handoff on a capture nobody had touched.
  const body = foldLineEndings(result.markdown);
  const text = `${front}${body}\n`;
  // A capture is never overwritten with different bytes. The name is date + title + URL
  // digest, so a re-collection the same day lands on the same name: an identical page
  // reuses the file, and a changed one goes to `.r2`, `.r3`... - sorting AFTER the
  // original, which is how readCaptures picks the latest of a day. Overwriting destroyed
  // the earlier reading and broke its ledger hash (found 2026-09-27).
  let file = `${PATHS.raw}/${base}`;
  for (let n = 2; ; n += 1) {
    assertCapturePath(root, resolve(root, file));      // before the read as well as the write
    if (!exists(resolve(root, file)) || readText(resolve(root, file)) === text) break;
    file = `${PATHS.raw}/${base.replace(/\.md$/, `.r${n}.md`)}`;
  }
  writeText(resolve(root, file), text);
  return captureEntry({
    file,
    url: result.url,
    retrieved: date,
    command: result.cmd ?? '',
    statusCode: result.statusCode ?? '',
    transport: result.transport ?? '',
    completeness: result.completeness ?? 'unspecified',
    omitted: result.omitted ?? '',
    bytes: Buffer.byteLength(body, 'utf8'),
  });
}

/** The capture's body hash, taken over the exact bytes on disk. */
export function bodyHashOf(root, file) {
  return sha256(fs.readFileSync(resolve(root, file)));
}

/**
 * Why a page is being fetched, in words. `cacheDecision` answers in codes for the code that
 * branches on them; this is for the operator reading the log. Printed verbatim, the code for
 * "no capture yet" made a fresh fetch log as "collected <url> - not-collected".
 */
function whyFetched(decision) {
  if (decision.reason === 'not-collected') return 'first capture';
  if (decision.reason === 'forced') return 'refreshed: --force';
  if (decision.reason === 'stale') return `refreshed: the last capture was ${decision.age} days old`;
  if (decision.reason === 'undated') return 'refreshed: the last capture carries no date';
  return decision.reason;
}

/**
 * Collect one URL: consult the cache, run the adapter through the `runScrape` seam,
 * write the capture, append the ledger entry, and add the evidence and source rows.
 *
 * Returns `{ status, entry, row, reason }` where `status` is
 * `cached` | `collected` | `failed` | `skipped`.
 */
/**
 * The source type a capture is BORN with.
 *
 * Not `P`. `P` is the only kind that carries a design, and "the fetcher reached it"
 * establishes nothing about who owns the fact - a random blog stamped primary is a
 * claim the collector is not entitled to make. A row starts as `S` (context) and the
 * agent promotes it after reading the page; a plan entry may declare `P` up front,
 * because a human wrote that URL down on purpose.
 */
export const DEFAULT_SOURCE_TYPE = 'S';

/**
 * The HTTP status a failure names, as the collector words it ("the page answered HTTP 403") or
 * as the keyless and browser transports word theirs ("HTTP 403 - the server said ..."), or null.
 * Anchored, so a status quoted inside some other failure's text is not read as this one's.
 */
const FAILED_STATUS = /^(?:the page answered )?HTTP (\d{3})\b/;
/** Statuses that say the page is not there, as opposed to a server that was busy. */
const GONE = new Set([404, 410]);
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
function standingFailure(error, { sameRoute = false } = {}) {
  const text = String(error ?? '');
  if (rateLimitWaitMs(text) !== null) return null;
  const status = Number(FAILED_STATUS.exec(text)?.[1]);
  if (GONE.has(status)) return { status: 'gone', why: `answered HTTP ${status}` };
  if (STANDING(status)) return sameRoute ? { status: 'refused', why: `the page answered HTTP ${status}` } : null;
  const kit = DETERMINISTIC.find(([pattern]) => pattern.test(text));
  return kit ? { status: 'refused', why: kit[1] } : null;
}

/**
 * The ledger's last word on a URL, when asking again would get the same answer, within the
 * refresh window: "gone" - a 404 or 410 (ADR-0100) - or "refused" - a standing 4xx, or one of
 * the kit's own refusals of what the page is (ADR-0174). Such a page is not fetched again until
 * the window passes or --force (found 2026-09-29: a plan URL that 404'd was fetched, and paid
 * for, again ten minutes later; 2026-10-11: an 11 MB page, a 403 and a PDF were paid for again
 * on every run). A 5xx, a timeout, a rate limit or a transport error is transient and gets no
 * such memory. `transport` names the route about to fetch: a standing 4xx is remembered only
 * when the ledger's failure was that route's.
 */
export function recentlyGone(root, url, { refreshDays = 30, force = false, now = new Date(), transport = '' } = {}) {
  if (force) return null;
  const key = urlKey(url);
  const last = readLedger(root).entries.filter((e) => (e.op === 'fail' || e.op === 'scrape') && e.url && urlKey(e.url) === key).pop();
  if (!last || last.op !== 'fail') return null;
  const standing = standingFailure(last.error, { sameRoute: Boolean(transport) && last.transport === transport });
  if (!standing) return null;
  const age = ageInDays(last.at, now);
  if (age === null || (refreshDays >= 0 && age > refreshDays)) return null;
  const on = String(last.at).slice(0, 10);
  const tail = `not fetched again for ${refreshDays} days; --force retries it`;
  return { status: standing.status, url, entry: null, spent: 0,
    reason: standing.status === 'gone' ? `${standing.why} on ${on} - ${tail}` : `refused on ${on}: ${standing.why} - ${tail}` };
}



export function collectOne(root, url, {
  runScrape,
  corpus,
  type = DEFAULT_SOURCE_TYPE,
  usedFor = '',
  refreshDays = 30,
  force = false,
  date = today(),
  now = new Date(),
  transportName = '',
  // Which search provider ranked this URL, when a search is why it is being fetched.
  discoveredBy = '',
  dryRun = false,
  maxRateLimitRetries = 2,
  sleep = sleepSync,
  // The hosts that ran out of rate-limit retries earlier in this run (a Set the coordinator
  // keeps for one run): a later page on one is asked once and not waited for.
  rateLimited = null,
  log = () => {},
} = {}) {
  // A dry run decides and writes nothing, so it needs no exclusive section.
  if (dryRun) {
    const preview = cacheDecision(corpus.captures, url, { refreshDays, force, now });
    if (preview.hit) {
      return { status: 'cached', url, entry: preview.entry, reason: `fresh capture from ${preview.entry.retrieved}`, spent: 0 };
    }
    return { status: 'skipped', url, entry: null, reason: `would collect (${whyFetched(preview)})`, spent: 0 };
  }

  // ONE WRITER BOUNDARY for the whole durable operation (ADR-0025).
  //
  // The cache decision, the capture write, the ID allocation, the ledger append and the
  // two row updates are one transaction or they are nothing. Locking only the ledger
  // append made the chain safe and left everything around it racing: two collectors
  // could allocate the same E-## id, choose the same capture filename, or lose each
  // other's row because both had read the table before either wrote it.
  //
  // The cache is re-read INSIDE the section, so a URL another collector finished while
  // we queued is a hit here rather than a second paid fetch.
  return withLock(root, () => {
    const fresh = refreshCaptures(root, corpus);
    const decision = cacheDecision(fresh, url, { refreshDays, force, now });
    if (decision.hit) {
      return { status: 'cached', url, entry: decision.entry, reason: `fresh capture from ${decision.entry.retrieved}`, spent: 0 };
    }
    const gone = recentlyGone(root, url, { refreshDays, force, now, transport: transportName });
    if (gone) return gone;

    // A rate limit is not a failure, it is an instruction to wait. Bounded, because a
    // vendor that keeps refusing is a different problem from a busy minute, and a
    // collector that retried forever would hold this lock forever.
    // The wait is the result's own `retryAfterMs` when the transport read the server's
    // Retry-After (#313), else the vendor's error text. A server that asked for longer than
    // the cap is asked once more, after the cap, and not again.
    //
    // The waits are per page, so a host that kept refusing made every page on it wait again:
    // a plan of twenty pages on a host answering a bare 429 slept 40 minutes holding the corpus
    // lock (review of #313, 2026-10-18). A host that ran out of retries is noted for the run
    // (`rateLimited`); a later page on it is asked once and not waited for, until one succeeds.
    const host = hostOf(url);
    let result;
    let waits = 0;
    let lastTry = false;
    for (let attempt = 0; ; attempt += 1) {
      try {
        result = runScrape(url);
      } catch (err) {
        result = { ok: false, url, error: err.message };
      }
      if (result?.ok || attempt >= maxRateLimitRetries || lastTry) break;
      const wait = retryWaitMs(result);
      if (wait === null) break;
      if (rateLimited?.has(host)) {
        log(`  not waiting - ${host} already ran out of rate-limit retries in this run`);
        break;
      }
      waits += 1;
      lastTry = result?.retryAfterCapped === true;
      log(`  waiting    ${Math.round(wait / 1000)}s - ${url} hit the vendor rate limit`);
      sleep(wait);
    }
    if (result?.ok) rateLimited?.delete(host);
    else if (waits && retryWaitMs(result) !== null) rateLimited?.add(host);

    // An error page is not a capture (found 2026-09-28): Firecrawl answers ok with the page
    // a server sent, and Google's "Error 503 (Service Unavailable)" arrived with statusCode
    // 503 in its metadata and became an EVIDENCE row. The status was recorded and never
    // read. The keyless transport already treated a non-2xx answer as a failure; this makes
    // it the rule for every transport.
    //
    // The failure is then the PAGE's answer, not the transport's, and is marked so: the page's
    // title rides in its text, and a page titled "Insufficient credits" is not Firecrawl running
    // dry (#350) - only a transport's own failure is read for exhaustion.
    const status = Number(result?.statusCode);
    let statusRefused = false;
    if (result?.ok && Number.isInteger(status) && status >= 400) {
      result = { ...result, ok: false, error: `the page answered HTTP ${status}${result.title ? ` (${String(result.title).slice(0, 80)})` : ''} - an error page is not evidence` };
      statusRefused = true;
    }

    if (!result?.ok) {
      appendFetch(root, {
        op: 'fail', url, raw: '', bodySha256: '',
        transport: result?.transport || transportName,
        discoveredBy,
        cmd: result?.cmd ?? '', error: result?.error ?? 'unknown failure',
      });
      return { status: 'failed', url, entry: null, reason: result?.error ?? 'unknown failure', spent: 1, waits, ...(statusRefused ? { statusRefused } : {}) };
    }

    // A page the reader will never read is not a capture: readCaptures refuses a file over
    // CAPTURE_MAX_BYTES as `capture-too-large` and the gate blocks on it, so a 40 MB answer
    // written here was a capture, a ledger entry and an evidence row the corpus then could
    // not hold (found 2026-10-02, break-test pass 3). Refused before anything is written.
    const bodyBytes = Buffer.byteLength(String(result.markdown ?? ''), 'utf8');
    if (bodyBytes > CAPTURE_MAX_BYTES) {
      const error = `the page's text is ${(bodyBytes / 1024 / 1024).toFixed(1)} MB, over the ${CAPTURE_MAX_BYTES / 1024 / 1024} MB a capture may hold - not kept`;
      appendFetch(root, {
        op: 'fail', url, raw: '', bodySha256: '',
        transport: result.transport || transportName,
        discoveredBy,
        cmd: result.cmd ?? '', error,
      });
      return { status: 'failed', url, entry: null, reason: error, spent: 1, waits };
    }

    const entry = writeRaw(root, result, { date });
    const bodySha256 = bodyHashOf(root, entry.file);
    const source = writeSource(root, entry.file, result.source, result.markdown);
    appendFetch(root, {
      op: 'scrape',
      url: entry.url,
      type,
      raw: entry.file,
      bodySha256,
      source: source?.file,
      sourceSha256: source?.sha256,
      sourceOmitted: source?.omitted,
      transport: entry.transport || transportName,
      discoveredBy,
      completeness: entry.completeness,
      omitted: entry.omitted,
      cmd: entry.command,
      at: `${date}T00:00:00.000Z`,
      cacheState: result.cacheState,
      cachedAt: result.cachedAt,
    });
    rememberCapture(corpus.captures, entry, { latest: true });   // the fetch that just happened is current, reused file or new

    // Ids are allocated from the table ON DISK, under the lock - a caller's in-memory
    // list can be stale by the time it gets here, and a duplicated E-## silently changes
    // what every citation to it means.
    const onDisk = parseTable(readText(resolve(root, PATHS.evidence), ''), HEADERS.evidence);
    upsertRow(root, PATHS.sources, HEADERS.sources, [entry.url, type, result.title || titleFromUrl(entry.url), date, usedFor]);

    // A forced re-fetch that came back byte-identical reused the capture (writeRaw never
    // overwrites), so a row on disk may already cite this very file for this URL. Then the
    // row stands: the fetch is in the ledger - the attempt is evidence, and it was paid for -
    // but a second row would supersede the first and make every citation of unchanged content
    // move for nothing (found 2026-10-02, break-test pass 3: rows=2, ledger=2, captures=1).
    const standing = onDisk.rows.find((r) => r.Raw === entry.file && r.URL === entry.url);
    if (standing) {
      return {
        status: 'collected', url: entry.url, entry, row: { id: standing.ID, finding: standing.Finding },
        reason: `${whyFetched(decision)}; the page is unchanged, so ${standing.ID} stands`, spent: 1, waits,
      };
    }

    const id = nextId('E', [...onDisk.rows.map((r) => ({ id: r.ID })), ...corpus.evidence]);
    const finding = firstFinding(result.markdown, result.title || url);
    appendRow(root, PATHS.evidence, HEADERS.evidence, [id, date, type, entry.url, finding, entry.file]);
    corpus.evidence.push({ id, retrieved: date, type, url: entry.url, finding, raw: entry.file, line: 0 });

    return { status: 'collected', url: entry.url, entry, row: { id, finding }, reason: whyFetched(decision), spent: 1, waits };
  });
}

/**
 * Re-read the capture index from disk and fold it into the caller's snapshot.
 *
 * A run reads its corpus once, then collects for minutes. Deciding freshness from that
 * first read means a page another collector finished in the meantime is fetched again and
 * paid for again.
 */
function refreshCaptures(root, corpus) {
  // Only what the snapshot does not hold, and no sketches: those are the gate's (ADR-0036).
  // With the ledger's rank, so a capture another collector wrote since the snapshot is
  // current only if its fetch came later - the one ordering rule the reopen uses (`newer`,
  // 2026-10-03). The ledger is read here as `recentlyGone` already reads it per page.
  const rank = ledgerRank(readLedger(root).entries);
  const known = new Set(corpus.captures.byFile.keys());
  const current = readCaptures(root, { known, sketches: false, rank });
  for (const entry of current.entries) rememberCapture(corpus.captures, entry, { rank });
  // A fetch since the snapshot may have REUSED a capture the snapshot already holds - identical
  // bytes are never written twice - so its position in the ledger moved while its bytes did
  // not. Every known capture the ledger names is decided again with the rank (2026-10-03).
  for (const file of rank.keys()) {
    if (known.has(file)) rememberCapture(corpus.captures, corpus.captures.byFile.get(file), { rank });
  }
  return corpus.captures;
}
