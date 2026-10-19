// disclosure.mjs - what does a public run actually expose?
//
// This module exists because the answer was written down before it was measured. The
// collector's header claimed that `workflow_dispatch` inputs "are visible on the run page
// to anyone with read access", which was asserted rather than checked - and when it was
// finally checked, the topic did not appear in the run object, the job listing, the
// timing, the artifact listing, or the server-rendered HTML.
//
// An overstated warning is not a safe default. It is the same defect as an understated
// one: a reader who finds a warning wrong once discounts the next, and the next one may
// be right. So the claim is executable now instead of prose - run it and see.
//
// UNAUTHENTICATED BY CONSTRUCTION.
//
// Every request here goes out with no Authorization header, because the question is
// precisely "what can somebody with no relationship to this repository see". A probe that
// quietly used the operator's token would answer a different question and look like this
// one. There is no token parameter, and `headers()` is the only place headers are built.

// A probe that cannot be reached names the cause of the failed fetch (runtime.fetchFailure),
// not Node's bare "fetch failed" - which a proxy, a DNS failure and a TLS rejection all
// produce alike (found 2026-09-30, break-test).
import { fetchFailure } from './runtime.mjs';

/** Probes, in the order a curious stranger would try them. */
export const PROBES = Object.freeze([
  { id: 'run', label: 'run metadata', path: (r, id) => `/repos/${r}/actions/runs/${id}` },
  { id: 'jobs', label: 'jobs and step names', path: (r, id) => `/repos/${r}/actions/runs/${id}/jobs` },
  { id: 'timing', label: 'run timing', path: (r, id) => `/repos/${r}/actions/runs/${id}/timing` },
  { id: 'artifacts', label: 'artifact listing', path: (r, id) => `/repos/${r}/actions/runs/${id}/artifacts` },
  { id: 'secrets', label: 'repository secrets', path: (r) => `/repos/${r}/actions/secrets` },
]);

const API = 'https://api.github.com';

/** No Authorization header, ever. That absence is the whole method. */
function headers() {
  return { Accept: 'application/vnd.github+json', 'User-Agent': 'research-kit-disclosure' };
}

/**
 * `probeRun({ repository, runId, needle })` -> a structured report.
 *
 * `needle` is the string whose presence would mean the subject leaked - normally the
 * topic. It is searched for in every response body, because a field nobody expected to
 * carry it is exactly where it would be found.
 */
export async function probeRun({ repository, runId, needle = null, fetch: doFetch = globalThis.fetch, api = API } = {}) {
  const findings = [];
  const bodies = new Map();

  for (const probe of PROBES) {
    const url = `${api}${probe.path(repository, runId)}`;
    let status = 0;
    let body = '';
    try {
      const response = await doFetch(url, { headers: headers() });
      status = response.status;
      body = await response.text();
    } catch (error) {
      findings.push({ id: probe.id, label: probe.label, status: 0, readable: false, leaksNeedle: false, note: `unreachable: ${fetchFailure(error)}` });
      continue;
    }
    const readable = status >= 200 && status < 300;
    if (readable) bodies.set(probe.id, body);
    findings.push({
      id: probe.id,
      label: probe.label,
      status,
      readable,
      leaksNeedle: Boolean(needle) && body.toLowerCase().includes(String(needle).toLowerCase()),
    });
  }

  // The two that matter most, and the two nobody checks: can a stranger take the evidence
  // home, and can they read the log that echoes every input.
  let artifactId = null;
  let jobId = null;
  if (bodies.has('artifacts')) {
    try { artifactId = JSON.parse(bodies.get('artifacts'))?.artifacts?.[0]?.id ?? null; } catch { /* a listing we cannot parse is not a list */ }
  }
  if (bodies.has('jobs')) {
    try { jobId = JSON.parse(bodies.get('jobs'))?.jobs?.[0]?.id ?? null; } catch { /* a listing we cannot parse is not a list */ }
  }

  for (const [id, label, url] of [
    ['artifact-download', 'artifact DOWNLOAD', artifactId && `${api}/repos/${repository}/actions/artifacts/${artifactId}/zip`],
    ['logs', 'job LOGS', jobId && `${api}/repos/${repository}/actions/jobs/${jobId}/logs`],
  ]) {
    if (!url) { findings.push({ id, label, status: null, readable: false, leaksNeedle: false, note: 'nothing to try' }); continue; }
    try {
      const response = await doFetch(url, { headers: headers(), redirect: 'follow' });
      const body = response.status < 300 ? await response.text() : '';
      findings.push({
        id,
        label,
        status: response.status,
        readable: response.status >= 200 && response.status < 300,
        leaksNeedle: Boolean(needle) && body.toLowerCase().includes(String(needle).toLowerCase()),
      });
    } catch (error) {
      findings.push({ id, label, status: 0, readable: false, leaksNeedle: false, note: `unreachable: ${fetchFailure(error)}` });
    }
  }

  return { repository, runId, needle, findings, ...summarise(findings, needle) };
}

/**
 * The verdict, in the two terms that matter.
 *
 * `exposedNames` is almost always true on a public repository and is not by itself a
 * problem - it is why the collector keeps the topic out of the run and artifact names.
 * `exposedSubject` is the one that ends an argument: it means somebody with no account
 * can read what was being researched.
 */
export function summarise(findings, needle) {
  const readable = findings.filter((f) => f.readable).map((f) => f.id);
  const leaked = findings.filter((f) => f.leaksNeedle).map((f) => f.id);
  // A refusal (401, 403, 404) is an answer. A probe that never reached GitHub (status 0) is
  // not, so "only the shape is public" needs every probe answered. Found 2026-09-27: with no
  // network, every probe was unreachable and the verdict still read as clean, exit 0.
  const unmeasured = findings.filter((f) => f.status === 0).map((f) => f.id);
  // The run's own metadata refused with 403 or 429 is not an answer about the run either: a
  // stranger is told 404 for a private repository or a missing run, and 403/429 is what
  // GitHub's anonymous rate limit (60 requests an hour, five a probe) answers. Counted as
  // unmeasured, it reads "could not measure", exit 3 - not a clean result (#303 review).
  const rateLimited = findings.filter((f) => f.id === 'run' && (f.status === 403 || f.status === 429)).map((f) => f.id);
  return {
    unmeasured,
    rateLimited,
    conclusive: unmeasured.length === 0 && rateLimited.length === 0,
    exposedNames: readable.includes('run') || readable.includes('jobs') || readable.includes('artifacts'),
    exposedContent: readable.includes('artifact-download') || readable.includes('logs'),
    exposedSubject: leaked.length > 0,
    readable,
    leaked,
    needleChecked: Boolean(needle),
  };
}

/**
 * The exit code the command reports: the finding itself. An exposure that was measured stands
 * whatever else failed; a clean verdict needs every probe answered, and without that it is 3,
 * "could not measure".
 */
export function exitCode(report) {
  if (report.exposedSubject) return 2;
  if (report.exposedContent) return 1;
  return report.conclusive ? 0 : 3;
}

/** One line per probe, and a verdict that states its own limits. */
export function render(report) {
  // "false" is only a finding when every probe answered.
  const shown = (value) => (value || report.conclusive !== false ? String(value) : 'not measured');
  const rows = report.findings.map((f) => {
    const verdict = f.readable ? 'READABLE' : f.status === 0 ? 'UNREACHABLE' : f.status == null ? 'not tried' : `refused ${f.status}`;
    const leak = f.leaksNeedle ? '  <-- SUBJECT VISIBLE' : '';
    return `  ${String(f.status ?? '-').padEnd(4)} ${f.label.padEnd(22)} ${verdict}${leak}${f.note ? `  (${f.note})` : ''}`;
  });

  const lines = [
    `anonymous probe of ${report.repository} run ${report.runId}`,
    '',
    ...rows,
    '',
    `names and metadata exposed : ${shown(report.exposedNames)}`,
    `content exposed            : ${shown(report.exposedContent)}`,
    report.needleChecked
      ? `the subject itself exposed : ${shown(report.exposedSubject)}`
      : 'the subject itself         : not checked - pass --topic to search for it',
    '',
  ];

  if (!report.exposedContent && !report.exposedSubject && report.conclusive === false) {
    if (report.unmeasured.length) {
      lines.push(`NOT MEASURED: ${report.unmeasured.length} probe(s) never reached GitHub (${report.unmeasured.join(', ')}).`,
        'Nothing above says what a stranger can see. Run it again where api.github.com is reachable.');
    } else {
      const run = report.findings.find((f) => f.id === 'run');
      lines.push(`NOT MEASURED: the run metadata was refused with ${run?.status}, which is what GitHub's anonymous`,
        'rate limit answers (60 requests an hour), not what it answers about a run - a private',
        'repository or a missing run is 404. Nothing above says what a stranger can see; run it again later.');
    }
    return lines.join('\n');
  }
  if (report.exposedContent || report.exposedSubject) {
    lines.push('This run discloses more than its shape. Research whose subject matters does not',
      'belong here: see docs/adr/0031 for why a visibility toggle alone is not the fix on a',
      'free plan, where converting to private makes environment secrets IGNORED.');
  } else if (!report.exposedNames) {
    // Every probe refused is not "the shape is public" (#303): the run metadata was refused
    // too, and the line above says so. A private repository and a run id that names nothing
    // both answer 404 to a stranger, so this says what was measured and no more.
    const run = report.findings.find((f) => f.id === 'run');
    lines.push('Nothing of this run was readable anonymously - not even its shape.');
    if (run?.status === 404) {
      lines.push('Either the repository is private to a stranger, or no run with this id exists there;',
        'GitHub answers 404 to both, and this probe cannot tell them apart.');
    } else {
      lines.push(`The run metadata was refused with ${run?.status ?? 'no answer'}; this probe cannot say why.`);
    }
  } else {
    lines.push('Only the SHAPE of the run is public: names, sizes, timings, step titles.',
      'That is why the collector keeps the topic out of the run name and the artifact name -',
      'those names are the disclosure surface, and they are the part it controls.');
  }
  return lines.join('\n');
}
