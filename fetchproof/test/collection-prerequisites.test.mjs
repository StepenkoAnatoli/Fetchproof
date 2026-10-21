// What must be true BEFORE a collection is allowed to spend anything.
//
// The kit's only irreversible act is spending credits, and the three things most likely
// to make a run fail are all knowable before the first request: an incompatible vendor
// CLI, a search provider with no key, and a host that cannot run the code. Each used to
// surface mid-run, after money was gone or after a plan had been built.

import { test, describe, assert, assertEqual } from './harness.mjs';
import { cliCompatibility, TESTED_CLI_VERSION, SUPPORTED_CLI_MAJOR } from '../lib/firecrawl.mjs';
import { NAMED_RUN_REFUSALS } from '../lib/core.mjs';
import { selectSearch } from '../lib/transport.mjs';
import { checkNode, checkPython, checkGit, requireRuntime, REQUIRED_NODE_MAJOR } from '../lib/runtime.mjs';

describe('collection-prerequisites');

// ---------------------------------------------------------------- the vendor CLI (F-04)

test('a different MAJOR Firecrawl CLI is refused, and says so before any spend', () => {
  // The CLI is the one dependency no lockfile pins. Every adapter test drives a stub, so
  // a payload-shape change is precisely what the suite cannot see - and the place it
  // would otherwise surface is mid-collection, after the credits are gone.
  const verdict = cliCompatibility('2.0.0');
  assertEqual(verdict.level, 'unsupported');
  assertEqual(verdict.supported, false);
  assert(/major 2/.test(verdict.detail), verdict.detail);
  assert(/http-keyless/.test(verdict.remedy ?? ''),
    'refusing without naming the interpreter-free route leaves an operator stuck');
});

test('the same major is supported, and names what it was tested against', () => {
  const exact = cliCompatibility(TESTED_CLI_VERSION);
  assertEqual(exact.level, 'supported');
  assert(exact.detail.includes(TESTED_CLI_VERSION), exact.detail);

  const newer = cliCompatibility(`${SUPPORTED_CLI_MAJOR}.99.0`);
  assertEqual(newer.level, 'supported', 'a newer minor of the same major must not be refused');
  assert(newer.detail.includes(TESTED_CLI_VERSION),
    'a version that differs from the tested one should say which one was tested');
});

test('an unreadable version PROCEEDS rather than refusing', () => {
  // The distinction that keeps this from being a nuisance. A CLI that prints its version
  // differently is not evidence that scraping is broken, and refusing on it would strand
  // a working install. Only a different major is evidence of a contract change.
  for (const version of [null, '', 'firecrawl version unknown', 'dev']) {
    const verdict = cliCompatibility(version);
    assertEqual(verdict.supported, true, `refused on ${JSON.stringify(version)}, which proves nothing`);
    assertEqual(verdict.level, 'untested');
  }
});

// ---------------------------------------------------------------- provider readiness (F-05)

test('explicitly choosing serpapi with no key is reported as NOT READY, before any spend', () => {
  // Automatic selection only reaches SerpAPI when a key exists, so it could never choose
  // a provider that cannot run. An explicit choice skipped that check: the name was
  // validated, the readiness was not, and the failure arrived later - after a plan was
  // built, and on some routes after fetch credits had been spent.
  // Reported, not thrown. selectSearch is also how --dry-run and doctor ask what WOULD
  // be used, and those must be able to describe a missing key rather than crash - the
  // first version of this fix threw here and broke three precedence tests that ask which
  // name wins and have no business supplying a key.
  const chosen = selectSearch({
    explicit: 'serpapi',
    env: {},                                   // no SERPAPI_API_KEY
    config: { searchTransport: '', serpapiKey: '', transport: '' },
    fetchSide: { name: 'http-keyless', adapter: {}, why: 'test' },
  });
  assertEqual(chosen.name, 'serpapi', 'the provider asked for is still the provider selected');
  assert(chosen.notReady, 'an explicit provider with no key was reported ready; it will fail later instead');
  assert(/SERPAPI_API_KEY/.test(chosen.notReady), chosen.notReady);
  assert(/serpapiKey/.test(chosen.notReady), 'the message should name both places a key can live');
});

test('explicitly choosing serpapi WITH a key still works', () => {
  // The other half: a readiness check that refuses a ready provider is worse than none.
  const chosen = selectSearch({
    explicit: 'serpapi',
    env: { SERPAPI_API_KEY: 'test-key-not-real' },
    config: { searchTransport: '', serpapiKey: '', transport: '' },
    fetchSide: { name: 'http-keyless', adapter: {}, why: 'test' },
  });
  assertEqual(chosen.name, 'serpapi');
  assertEqual(chosen.searchOnly, true);
  assertEqual(chosen.notReady, '', 'a provider with a key must not be reported unready');
});

test('an unknown provider name is still refused, with the known names', () => {
  let thrown = null;
  try {
    selectSearch({ explicit: 'not-a-provider', env: {}, config: { transport: '' },
      fetchSide: { name: 'http-keyless', adapter: {}, why: 'test' } });
  } catch (err) { thrown = err; }
  assertEqual(thrown?.code, 'UNKNOWN_SEARCH_PROVIDER');
});

// ---------------------------------------------------------------- the host (F-11)

test('an old Node is reported as a prerequisite, not as a syntax error', () => {
  const old = checkNode('20.11.0');
  assertEqual(old.ok, false);
  assert(old.detail.includes('20.11.0') && old.detail.includes(String(REQUIRED_NODE_MAJOR)), old.detail);
  assert(/nodejs\.org/.test(old.fix ?? ''), 'a prerequisite failure should say how to fix it');

  assertEqual(checkNode(`${REQUIRED_NODE_MAJOR}.0.0`).ok, true);
  assertEqual(checkNode('99.0.0').ok, true, 'a newer Node must not be refused');
  assertEqual(checkNode('not-a-version').ok, false);
});

test('python is checked only when a command actually uses it', () => {
  // Python is needed by the cross-language conformance runners and by nothing else. A
  // command that reads the corpus has no business refusing to run because a language it
  // never calls is missing.
  let exited = null;
  const report = requireRuntime({
    node: true, git: false, python: false,
    exit: (code) => { exited = code; }, write: () => {},
  });
  assertEqual(exited, null, 'a node-only command exited over a prerequisite it did not ask for');
  assert(report.node, 'the resolved report should name what it checked');
  assertEqual(report.python, undefined);
  assertEqual(report.git, undefined);
});

test('a missing prerequisite exits 3, distinctly from a product failure', () => {
  let exited = null;
  let written = '';
  requireRuntime({
    node: true, git: false, python: true,
    // Stub the checks through the seam rather than uninstalling python.
    exit: (code) => { exited = code; },
    write: (text) => { written += text; },
  });
  // python IS present on this host, so this should pass; the exit-code contract is
  // asserted through the shape rather than by breaking the host.
  if (exited !== null) {
    assertEqual(exited, 3, `a prerequisite failure must exit 3, got ${exited}`);
    assert(written.includes('python'), written);
  }
});

test('the python check accepts the floor (3.11+) and rejects older, reading either stream', () => {
  // Python 3 prints its version to stdout and Python 2 to stderr, which is exactly the
  // kind of detail a check written against one of them gets wrong.
  const run = (out, err = '') => () => ({ status: 0, stdout: out, stderr: err });
  assertEqual(checkPython({ run: run('Python 3.12.1') }).ok, true);
  assertEqual(checkPython({ run: run('Python 3.14.0') }).ok, true);
  assertEqual(checkPython({ run: run('', 'Python 2.7.18') }).ok, false);
  assertEqual(checkPython({ run: run('Python 3.9.7') }).ok, false);
  // The floor itself, and the version just below it (ADR-0078: 3.11, measured 2026-09-28).
  assertEqual(checkPython({ run: run('Python 3.11.2') }).ok, true, 'the floor, 3.11, must be accepted');
  assertEqual(checkPython({ run: run('Python 3.10.20') }).ok, false, '3.10 is below the floor');
  assertEqual(checkPython({ run: () => ({ error: new Error('ENOENT'), status: null }) }).ok, false);
});

// Arena break test 13 (residual risk, 2026-09-28): an interpreter whose --version prints
// no version was ACCEPTED ("version not parsed; proceeding"), so a stub or a wrapper that
// exits 0 reached the conformance tests and failed there, far from the cause. It is now
// treated like an old interpreter: the search goes on to the next name, and if nothing
// usable is found the refusal quotes what was printed.
test('a python whose --version prints no version is not accepted, and is named', () => {
  const hosts = (outputs) => (exe) => (exe in outputs ? { status: 0, stdout: outputs[exe], stderr: '' } : { error: new Error('ENOENT'), status: null });
  const onlyGarbage = checkPython({ run: hosts({ python3: 'hello from a wrapper' }) });
  assertEqual(onlyGarbage.ok, false, 'an interpreter that reports no version was accepted');
  assert(/hello from a wrapper/.test(onlyGarbage.detail), `the refusal does not quote what was printed: ${onlyGarbage.detail}`);
  const fallback = checkPython({ run: hosts({ python3: 'hello from a wrapper', python: 'Python 3.12.1' }) });
  assertEqual(fallback.ok, true, 'a usable python one name away was not found');
  assertEqual(fallback.exe, 'python');
  assertEqual(checkPython({ run: hosts({ python3: 'Python 3.13' }) }).ok, true, 'a two-part version is still a version');
});

test('git is reported missing rather than failing three layers down', () => {
  assertEqual(checkGit({ run: () => ({ error: new Error('ENOENT'), status: null }) }).ok, false);
  assertEqual(checkGit({ run: () => ({ status: 0, stdout: 'git version 2.44.0' }) }).ok, true);
});

test('an old `python` alias does not hide a usable `python3`', () => {
  // The single most common layout on Linux and older macOS: `python` is a 2.7 or old-3.x
  // alias and `python3` is the real interpreter. The first version of checkPython
  // returned failure the moment it found the old one, so a host with a perfectly good
  // Python 3.12 one name away was told it had none.
  const host = (versions) => (exe) => {
    const v = versions[exe];
    if (!v) return { error: new Error('ENOENT'), status: null };
    // Python 2 prints its version to stderr, Python 3 to stdout.
    return v.startsWith('2.') ? { status: 0, stdout: '', stderr: `Python ${v}` } : { status: 0, stdout: `Python ${v}` };
  };

  const shadowed = checkPython({ run: host({ python: '2.7.18', python3: '3.12.1' }) });
  assertEqual(shadowed.ok, true, `a usable python3 was hidden by an old python: ${shadowed.detail}`);
  assert(/3\.12\.1/.test(shadowed.detail), shadowed.detail);

  // The case above is also satisfied by trying `python3` FIRST, which the fix does - so
  // on its own it does not prove the search CONTINUES past an old interpreter. This one
  // does: the first name tried is the old one, and a usable interpreter sits behind it.
  // Reintroducing the early return turns exactly this assertion red and nothing else.
  const reversed = checkPython({ run: host({ python3: '3.9.7', python: '3.12.1' }) });
  assertEqual(reversed.ok, true,
    `the search stopped at the first old interpreter instead of continuing: ${reversed.detail}`);
  assert(/3\.12\.1/.test(reversed.detail), reversed.detail);

  // Genuinely too old on BOTH names still fails, and names what it found rather than
  // claiming there is no python at all.
  const tooOld = checkPython({ run: host({ python: '2.7.18', python3: '3.9.7' }) });
  assertEqual(tooOld.ok, false);
  assert(/3\.9\.7|2\.7\.18/.test(tooOld.detail), `the message should say what was found: ${tooOld.detail}`);

  // Only the modern name present is the other common layout.
  assertEqual(checkPython({ run: host({ python3: '3.12.1' }) }).ok, true);
  assertEqual(checkPython({ run: host({}) }).ok, false);
});

// Found 2026-10-02 (break-test pass 3, a fake CLI reporting v2.0.0): runResearch threw the
// refusal with code CLI_INCOMPATIBLE, and bin/research.mjs, which answers the named refusals
// with their sentence and exit 2, did not know this one - so the operator got the sentence
// under a source line, a caret, a stack and an object dump, with exit 1, which reads as FAIL.
test('an unsupported CLI major is a named refusal: the sentence and exit 2, not a stack', () => {
  assert.ok(NAMED_RUN_REFUSALS.has('CLI_INCOMPATIBLE'), [...NAMED_RUN_REFUSALS].join(', '));
});
