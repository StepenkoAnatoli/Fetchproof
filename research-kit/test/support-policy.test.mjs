// The support policy is a claim about CI. This checks it against CI.
//
// "Supported" is defined in README.md as one specific thing: the full offline suite runs
// on that platform on every commit. That makes the policy falsifiable - and therefore
// worth testing, because a policy that drifts from the workflow is worse than none. A
// reader trusts it, and it quietly stops being true the moment someone edits the matrix.
//
// This repository has shipped documentation drift twice already: a README claiming 326
// tests when there were 565, and an architecture map describing two modules that did not
// exist. Both were prose nobody could check. This one can be.

import { spawnSync } from 'node:child_process';
import { test, describe, assert, assertEqual, fs, path, KIT_ROOT, tempDir } from './harness.mjs';
import { REQUIRED_PYTHON } from '../lib/runtime.mjs';

describe('support-policy');

const REPO = path.resolve(KIT_ROOT, '..');
const WORKFLOW = path.join(REPO, '.github', 'workflows', 'offline-suite.yml');
const ROOT_README = path.join(REPO, 'README.md');
const KIT_README = path.join(KIT_ROOT, 'README.md');

/**
 * The platforms the workflow actually runs the suite on.
 *
 * This repository has no YAML parser and no dependencies, so this reads the `os:` key by
 * hand. It accepts BOTH shapes YAML allows, because the first version accepted only flow
 * style and would have failed on a semantically identical workflow:
 *
 *     os: [ubuntu-latest, windows-latest]      flow
 *     os:                                      block
 *       - ubuntu-latest
 *       - windows-latest
 *
 * Quotes are stripped either way. It is still a structural reader rather than a parser -
 * an anchor or a matrix built by `fromJSON` would defeat it - so it fails LOUDLY when it
 * cannot find the key, rather than returning an empty list that would make every
 * assertion below vacuously true.
 */
function matrixPlatforms() {
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  const unquote = (name) => name.trim().replace(/^['"]|['"]$/g, '');

  const flow = yaml.match(/^\s*os:\s*\[([^\]]+)\]/m);
  if (flow) return flow[1].split(',').map(unquote).filter(Boolean);

  const block = yaml.match(/^(\s*)os:\s*$\n((?:\1\s+-\s*\S+\s*$\n?)+)/m);
  if (block) return [...block[2].matchAll(/-\s*(\S+)/g)].map((m) => unquote(m[1])).filter(Boolean);

  assert(false, 'could not read the `os:` matrix from offline-suite.yml in either flow or '
    + 'block style. This is a structural reader, not a YAML parser - if the matrix now '
    + 'comes from an anchor or fromJSON, this test needs rewriting rather than deleting.');
  return [];
}

test('the CI matrix is exactly the platforms the README calls supported', () => {
  const platforms = matrixPlatforms();
  // ubuntu-26.04 is a second LINUX image, not a third platform: it runs through the
  // ubuntu-latest migration (2026-10-19..11-19) and then goes (ADR-0043).
  assertEqual(JSON.stringify(platforms), JSON.stringify(['ubuntu-latest', 'ubuntu-26.04', 'windows-latest']),
    'the CI matrix changed. That may be correct - but README.md states a support policy in '
    + 'terms of what CI runs, so update the policy in the same commit and then update this '
    + `test deliberately. Matrix is now: ${platforms.join(', ')}`);

  const readme = fs.readFileSync(ROOT_README, 'utf8');
  assert(/Linux and Windows are supported/.test(readme),
    'README.md no longer states the support policy the CI matrix implements');
  assert(/macOS is best-effort and untested/i.test(readme),
    'README.md no longer says macOS is unsupported, but the matrix still does not run it');
});

test('macOS is excluded on purpose, and only ever mentioned in a comment', () => {
  // The first version of this test asserted `/macos/i.test(yaml)` - that the workflow
  // "still mentions macOS" - to prove the exclusion was deliberate. It passed, and it was
  // passing BECAUSE OF A BUG: the aggregating job printed "ubuntu, windows and macos all
  // passed" on a matrix that had not run macOS since the leg was dropped. A green run
  // reported a platform result that did not exist, and this test was satisfied by the
  // very line that was lying.
  //
  // So the assertion is now specific about WHERE macOS may appear. In a comment it is a
  // recorded decision; in an executable line it is a claim, and there is nothing running
  // that could make such a claim true.
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  const lines = yaml.split('\n');
  const comments = lines.filter((line) => line.trim().startsWith('#'));
  const executable = lines.filter((line) => !line.trim().startsWith('#'));

  assert(comments.some((line) => /macos/i.test(line)),
    'no comment mentions macOS, so a reader cannot tell whether its absence from the '
    + 'matrix is a decision or an accident');

  const claims = executable.filter((line) => /macos/i.test(line));
  assertEqual(claims.length, 0,
    'macOS appears in an EXECUTABLE line of the workflow while the matrix does not run '
    + `it, so the workflow states something no job checks:\n  ${claims.join('\n  ')}`);
});

test('the matrix is the ONLY place that says which platforms run', () => {
  // The earlier version of this test checked that a hardcoded list in the success message
  // matched the matrix. That guarded the drift without removing it: there were still two
  // places stating which platforms run, and a future edit had to update both.
  //
  // The message no longer names any platform, so there is one source of truth and nothing
  // to keep in step. This asserts that property rather than the agreement of two lists -
  // a guard you can delete by fixing the design is better than a guard you must maintain.
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  const platforms = matrixPlatforms();
  assert(platforms.length > 0, 'the matrix reader returned nothing, so nothing below is meaningful');

  const executable = yaml.split('\n').filter((line) => !line.trim().startsWith('#'));
  for (const platform of platforms) {
    // Two mentions are legitimate and are not claims about coverage:
    //   os:       the matrix itself, which is the source of truth
    //   runs-on:  WHERE a job executes. The aggregating `suite` job runs on
    //             ubuntu-latest because it needs some host for a three-second check;
    //             that says nothing about which platforms the suite was run on.
    //
    // The first version of this test flagged that `runs-on` and was wrong to. What is
    // actually being guarded is a platform named in OUTPUT - an echo, a summary, a
    // message a reader would take as evidence that the platform ran.
    const mentions = executable.filter((line) => line.includes(platform)
      && !/^\s*os:/.test(line) && !/^\s*runs-on:/.test(line));
    assertEqual(mentions.length, 0,
      `${platform} is named outside the matrix and outside a runs-on, which makes a second `
      + `source of truth that can drift from it:\n  ${mentions.join('\n  ')}`);
  }

  const summary = executable.find((line) => /every platform in the matrix passed/.test(line));
  assert(summary, 'the aggregating job no longer reports that the matrix passed');
});

test('both READMEs agree about what is supported', () => {
  // The kit README is what someone reads after cloning; the root README is what they read
  // on GitHub. Two support policies is worse than one, because the reader cannot tell
  // which is stale.
  const kit = fs.readFileSync(KIT_README, 'utf8');
  assert(/Supported on Linux and Windows/i.test(kit),
    'research-kit/README.md does not carry the support policy, so a reader who starts there never sees it');
  assert(/macOS is best-effort/i.test(kit), 'research-kit/README.md omits the macOS caveat the root README makes');
});

test('the prerequisites named in the policy are the ones the suite actually needs', () => {
  // Python is listed as a requirement because its absence BLOCKS - that is the whole point
  // of the UNSUP mechanism, and a reader who skips installing it should know before the
  // suite tells them.
  const readme = fs.readFileSync(ROOT_README, 'utf8');
  assert(/Python 3\.\d+\+/.test(readme), 'the README no longer names the Python requirement');
  // "Node 22+" until 2026-10-11; "Node 22.22.1+ or 24+" since, because 22.13.0 to 22.22.0
  // decode windows-1252 as Latin-1 (ADR-0159). Either spelling names the 22 line's floor.
  assert(/Node 22(\.\d+)*\+/.test(readme), 'the README no longer names the Node requirement');

  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  const node = yaml.match(/node-version:\s*'?([\d.]+)'?/);
  const python = yaml.match(/python-version:\s*'?([\d.]+)'?/);
  assert(node && Number(node[1].split('.')[0]) >= 22,
    `CI pins Node ${node?.[1]} but the README promises 22+`);
  assert(python && python[1].startsWith('3.1'),
    `CI pins Python ${python?.[1]} but the README promises a 3.1x floor`);
});

// Found 2026-09-28 (an outside break-test's risk list): the floor was declared 3.12 while
// the runners passed on 3.11, and the check above only asked that CI pin SOMETHING 3.1x -
// so the README, the code and CI could drift apart. The floor is one number: the code's
// REQUIRED_PYTHON, the README's promise, and every python-version CI pins, so CI always
// tests exactly the oldest Python the kit promises (ADR-0078).
test('the Python floor is one number: the code, both READMEs and every CI pin agree', () => {
  const floor = `${REQUIRED_PYTHON.major}.${REQUIRED_PYTHON.minor}`;
  for (const file of [ROOT_README, path.join(KIT_ROOT, 'README.md')]) {
    const text = fs.readFileSync(file, 'utf8');
    const promised = [...text.matchAll(/Python (3\.\d+)\+/g)].map((m) => m[1]);
    assert(promised.length, `${file} names no Python floor`);
    for (const p of promised) assertEqual(p, floor, `${file} promises Python ${p}+ but the code requires ${floor}+`);
  }
  const pins = [...fs.readFileSync(WORKFLOW, 'utf8').matchAll(/python-version:\s*'?([\d.]+)'?/g)].map((m) => m[1]);
  assert(pins.length, 'CI pins no Python version');
  for (const pin of pins) assertEqual(pin, floor, `CI pins Python ${pin}, but the floor it must test is ${floor}`);
});

test('the Node lines the README says are tested are exactly the ones CI runs', () => {
  // Until 2026-09-27 the README promised "Node 22+" and CI ran only 22, so 24 (Active LTS)
  // and 26 (Current) - the lines an operator installing Node today gets - were never run.
  // docs/decisions/2026-09-27-node-support. The claim now names the lines; this keeps the
  // list and the workflow in step, in both directions.
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  const executable = yaml.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
  const pinned = [...executable.matchAll(/node-version:\s*'?(\d+)/g)].map((m) => m[1]);
  const matrix = executable.match(/^\s*node:\s*\[([^\]]+)\]/m);
  const lines = new Set([...pinned, ...(matrix ? matrix[1].split(',').map((v) => v.trim().replace(/['"]/g, '')) : [])]);
  const tested = [...lines].map(Number).sort((a, b) => a - b);

  const readme = fs.readFileSync(ROOT_README, 'utf8');
  const claim = readme.match(/Node ((?:\d+, )*\d+ and \d+) are each tested/);
  assert(claim, 'the README does not say which Node lines CI tests');
  const promised = claim[1].split(/, | and /).map(Number).sort((a, b) => a - b);
  assertEqual(JSON.stringify(tested), JSON.stringify(promised),
    `CI runs Node ${tested.join(', ')} but the README says it tests ${promised.join(', ')}`);
});

test('the onboarding path names commands that exist', () => {
  // A quickstart that names a binary nobody shipped is the most expensive kind of wrong:
  // it fails on the reader's first command, before they have any reason to trust the rest.
  // The onboarding path is the front page from "Install" up to the agent section: the
  // install, the five-minute try, and the real project (headings renamed 2026-10-02).
  const readme = fs.readFileSync(ROOT_README, 'utf8');
  const section = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Working with an AI agent'));
  assert(section.length > 200, 'the onboarding section is missing or empty');

  const referenced = [...section.matchAll(/research-kit\/(bin|examples)\/[\w/-]+\.mjs/g)].map((m) => m[0]);
  assert(referenced.length >= 5, `expected the onboarding path to name several commands, found ${referenced.length}`);
  const missing = [...new Set(referenced)].filter((rel) => !fs.existsSync(path.join(REPO, rel)));
  assertEqual(missing.length, 0, `the onboarding path names commands that do not exist: ${missing.join(', ')}`);
});

test('the onboarding path installs the kit first, and runs project commands from the project', () => {
  // Found 2026-09-27 by following this section on a fresh machine. Step 5 said to cd to the
  // project and then ran "node research-kit/bin/new-project.mjs" - a path that exists only
  // at the repository root - so it crashed with MODULE_NOT_FOUND. install.mjs, which puts
  // the kit where a project can reach it, was not in the path at all. install-hooks.mjs was
  // marked "only on a build machine", so a collector following it never got the commit gate.
  const readme = fs.readFileSync(ROOT_README, 'utf8');
  const section = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Working with an AI agent'));
  const at = (needle) => section.indexOf(needle);
  assert(at('bin/install.mjs') !== -1 && at('bin/install.mjs') < at('new-project.mjs'),
    'the path never installs the kit before a project needs it');
  assert(at('bin/install-hooks.mjs') !== -1 && at('bin/install-hooks.mjs') < at('new-project.mjs'),
    'the path never installs the gates before a project needs them');
  assert(!/only on a build machine/i.test(section), 'every machine needs the gates, not only a builder');

  const projectCommands = section.split('\n').map((l) => l.trim())
    .filter((l) => /^node \S*(new-project|decompose|research|preflight)\.mjs/.test(l));
  assert(projectCommands.length >= 4, `expected the project steps to name their commands, found ${projectCommands.length}`);
  for (const line of projectCommands) {
    assert(/\.agents\/research-kit\/bin\//.test(line),
      `"${line}" runs from the project folder, so it must name the installed kit, not a repository-relative path`);
  }
});

test('every subcommand reports a usage error the same way', () => {
  // `fi-validate` returned 4 for a missing flag while `validate` and `conform` returned 2,
  // so the same mistake reported a different code depending on which subcommand you
  // typed. Worse, 4 is this CLI's "unrecognised status" fallback - a caller branching on
  // it was told the validator produced something unknown, when it had never run.
  //
  // Asserted by RUNNING the CLI rather than reading it, because the question is what a
  // caller observes.
  const cli = path.join(KIT_ROOT, 'bin', 'researcher-release.mjs');
  const cases = [
    ['validate', ['validate']],
    ['conform', ['conform']],
    ['fi-validate', ['fi-validate']],
    ['unknown subcommand', ['not-a-subcommand']],
  ];
  for (const [name, argv] of cases) {
    const run = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assertEqual(run.status, 2, `${name} exits ${run.status} on a usage error; every subcommand must use 2`);
    assert(/Usage:/.test(run.stderr), `${name} did not print usage on a usage error`);
  }
});

test('the documented exit codes are the ones the release CLI returns', () => {
  // The verdict table tells readers to branch on these. If the CLI's mapping changes and
  // the table does not, every script written from this README misreads a result.
  const readme = fs.readFileSync(ROOT_README, 'utf8');
  const cli = fs.readFileSync(path.join(KIT_ROOT, 'bin', 'researcher-release.mjs'), 'utf8');
  // Matched per LINE rather than per condition, because FAIL and REOPEN deliberately
  // share one: `if (status === 'FAIL' || status === 'REOPEN') return 1;`. An earlier
  // version of this test assumed one status per branch and failed on that line - the
  // test was wrong, not the CLI.
  const lines = cli.split('\n');
  for (const [status, code] of [['PASS', '0'], ['FAIL', '1'], ['REOPEN', '1'], ['INCOMPLETE', '2'], ['BLOCKED', '3']]) {
    const line = lines.find((text) => text.includes(`'${status}'`) && /return\s+\d/.test(text));
    assert(line, `researcher-release.mjs no longer maps ${status} to an exit code at all`);
    assertEqual(line.match(/return\s+(\d)/)[1], code,
      `researcher-release.mjs maps ${status} to a different exit code than the README documents`);
    assert(new RegExp(`\`${status}\``).test(readme), `the README's verdict table no longer lists ${status}`);
  }
});

// The README names the Firecrawl CLI install command (added 2026-09-27, when nothing said how).
// A pinned version in prose drifts the day the tested version moves; this holds them together.
test('the README installs the Firecrawl CLI version the adapter was tested against', async () => {
  const { TESTED_CLI_VERSION } = await import('../lib/firecrawl.mjs');
  const readme = fs.readFileSync(path.join(KIT_ROOT, '..', 'README.md'), 'utf8');
  const named = [...readme.matchAll(/firecrawl-cli@([0-9.]+)/g)].map((m) => m[1]);
  assert.ok(named.length > 0, 'the README no longer says how to install the Firecrawl CLI');
  for (const version of named) assert.equal(version, TESTED_CLI_VERSION, `README installs firecrawl-cli@${version}`);
});

// ---------------------------------------------------------------- the docs, followed literally

// Found 2026-09-27 following the docs as written, not reading them.
const OPERATOR_DOCS = ['README.md', 'AGENTS.md', 'research-kit/README.md', 'research-kit/START_HERE.md',
  'research-kit/skill/SKILL.md', 'research-kit/template/AGENTS.md', 'research-kit/template/START_HERE.md'];
const readDoc = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

test('every node command in the operator docs has balanced quotes', () => {
  // The root AGENTS.md said `node research-kit/bin/research.mjs" --plan ...` four times: pasted
  // into a shell, the stray quote leaves the command unterminated.
  for (const rel of OPERATOR_DOCS) {
    for (const [n, line] of readDoc(rel).split('\n').entries()) {
      const command = line.match(/\bnode\s+[^`]*/)?.[0];
      if (!command) continue;
      assert.equal((command.match(/"/g) ?? []).length % 2, 0, `${rel}:${n + 1} has an unbalanced quote: ${command.trim()}`);
    }
  }
});

test('the README walkthrough writes the plan before it collects', () => {
  // research.mjs refuses an empty plan, and the README went from classifying the map straight
  // to collecting without ever naming research/plan.json.
  for (const [rel, step] of [['README.md', 'research.mjs" --dry-run'], ['research-kit/README.md', 'research.mjs"  ']]) {
    const text = readDoc(rel);
    const collect = text.indexOf(step);
    assert.ok(collect > 0, `${rel} no longer shows the collect step`);
    assert.ok(text.slice(0, collect).includes('research/plan.json'), `${rel} reaches "collect" without naming research/plan.json`);
  }
});

test('the builder is told to run handoff from the installed kit', () => {
  // `node research-kit/bin/handoff.mjs` exists only in a checkout of this repository, and the
  // builder runs it from a project folder.
  for (const rel of ['README.md', 'research-kit/README.md']) {
    assert.doesNotMatch(readDoc(rel), /^node research-kit\/bin\/handoff\.mjs/m, `${rel} tells the builder to run handoff from a repository path`);
  }
});

test('a check count the docs state is the registry\'s', async () => {
  const { CHECKS } = await import('../lib/checks.mjs');
  const words = { eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15 };
  for (const rel of OPERATOR_DOCS) {
    for (const [, said] of readDoc(rel).matchAll(/\b(eleven|twelve|thirteen|fourteen|fifteen|\d+) (?:corpus |contract )?checks\b/gi)) {
      const n = words[said.toLowerCase()] ?? Number(said);
      assert.equal(n, CHECKS.length, `${rel} says ${said} checks; the registry holds ${CHECKS.length}`);
    }
  }
});

// RESEARCH_KIT_ALLOW_UNSUP (2026-09-30, ADR-0108): a contributor with no Python can ask for
// a green LOCAL run, told plainly that it was not a full pass; CI ignores the opt-in, so a
// missing interpreter there still blocks. Exercised on a real run of one group that needs
// Python, on a host the harness reports as having none.
test('RESEARCH_KIT_ALLOW_UNSUP lets a local run without Python pass, says so, and is ignored in CI', () => {
  const selftest = path.join(KIT_ROOT, 'bin', 'selftest.mjs');
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['CI', 'RESEARCH_KIT_ALLOW_UNSUP', 'RESEARCH_KIT_RESULT_FILE'].includes(k)));
  const suite = (extra) => spawnSync(process.execPath, [selftest, 'canonical-float-policy'], {
    cwd: path.resolve(KIT_ROOT, '..'), encoding: 'utf8', timeout: 120_000,
    env: { ...base, RESEARCH_KIT_TEST_NO_PYTHON: '1', ...extra },
  });

  const blocked = suite({});
  assert.equal(blocked.status, 1, `with no Python and no opt-in the run must block:\n${blocked.stdout.slice(-600)}`);
  assert.match(blocked.stdout, /unsupported/);
  // A block with ZERO failures is not a red suite, and the runner must not call it one: "A red
  // suite stops work" is the standing protocol's stop-the-line sentence, and an agent that read
  // it over "0 failed, 2 unsupported" stopped a whole break-test at its baseline on a host with
  // no Chromium (arena, 2026-10-02). It says what it is - tests that could not run here - and
  // the way to a local run, which is not a bypass: every test that can run still runs.
  assert.doesNotMatch(blocked.stdout, /A red suite stops work/, 'zero failures were reported as a red suite');
  assert.match(blocked.stdout, /No test failed/);
  assert.match(blocked.stdout, /not a red suite/i);
  assert.match(blocked.stdout, /RESEARCH_KIT_ALLOW_UNSUP=1/);

  const allowed = suite({ RESEARCH_KIT_ALLOW_UNSUP: '1' });
  assert.equal(allowed.status, 0, `the opt-in did not let the run pass:\n${allowed.stdout.slice(-600)}`);
  assert.match(allowed.stdout, /NOT a full pass/, 'a passing run with unsupported tests must say it was not a full pass');
  assert.doesNotMatch(allowed.stdout, /^all tests passed$/m, 'it claimed every test passed');

  const ci = suite({ RESEARCH_KIT_ALLOW_UNSUP: '1', CI: 'true' });
  assert.equal(ci.status, 1, `CI honoured the opt-in:\n${ci.stdout.slice(-600)}`);
  assert.match(ci.stdout, /RESEARCH_KIT_ALLOW_UNSUP is ignored in CI/);
});

// ADR-0123: the suite describes the kit, not the machine. The runner gives the run a
// scratch home and strips the operator's kit variables and vendor keys before the first
// test; this pin is read from inside the run, so it is red the moment that stops.
test('the run has a scratch home and none of the operator\'s kit variables or vendor keys', () => {
  assert.match(String(process.env.HOME ?? ''), /rk-selftest-home-/, `HOME is ${process.env.HOME}, not the run's scratch home`);
  assert.equal(process.env.USERPROFILE, process.env.HOME);
  for (const name of ['RESEARCH_KIT_CONFIG', 'RESEARCH_KIT_HOME', 'RESEARCH_KIT_TRANSPORT', 'RESEARCH_KIT_SEARCH_TRANSPORT', 'RESEARCH_KIT_INSTALL_STATE', 'RESEARCH_KIT_EDIT_GATE_SETTINGS', 'FIRECRAWL_API_KEY', 'SERPAPI_API_KEY', 'TAVILY_API_KEY']) {
    assert.equal(process.env[name], undefined, `${name} reached the suite`);
  }
});

// Below the Node floor the suite refuses up front, as the kit's commands do: on Node 20 it
// used to run and report 28 red tests, each saying "this kit needs 22 or newer" (break-test
// 2026-10-02). The harness seam RESEARCH_KIT_TEST_NODE_VERSION stands in for the old Node.
test('below the Node floor selftest refuses before any test runs, exit 2, naming the floor', () => {
  const selftest = path.join(KIT_ROOT, 'bin', 'selftest.mjs');
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['CI', 'RESEARCH_KIT_ALLOW_UNSUP', 'RESEARCH_KIT_RESULT_FILE'].includes(k)));
  const old = spawnSync(process.execPath, [selftest, 'canonical-float-policy'], {
    cwd: path.resolve(KIT_ROOT, '..'), encoding: 'utf8', timeout: 120_000, env: { ...base, RESEARCH_KIT_TEST_NODE_VERSION: '20.11.0' },
  });
  assert.equal(old.status, 2, `an old Node was not refused:\n${old.stdout.slice(-300)}\n${old.stderr.slice(-300)}`);
  assert.match(old.stderr, /selftest runs on Node 22 or newer: node 20\.11\.0; this kit needs 22 or newer/);
  assert.match(old.stderr, /install Node 22\+/);
  assert.doesNotMatch(old.stdout, /passed, /, 'tests ran under a refused Node');
  const floor = spawnSync(process.execPath, [selftest, 'canonical-float-policy'], {
    cwd: path.resolve(KIT_ROOT, '..'), encoding: 'utf8', timeout: 120_000, env: { ...base, RESEARCH_KIT_TEST_NODE_VERSION: '22.0.0' },
  });
  assert.equal(floor.status, 0, `the floor itself was refused:\n${floor.stderr.slice(-300)}`);
});

// A result file that was asked for and could not be written: the cause is printed and the
// green run exits 2, where it exited 0 and left CI's summary reading "crashed before
// reporting" beside a green step (break-test 2026-10-02).
test('a result file that cannot be written is named, and a green run exits 2 for it', () => {
  const selftest = path.join(KIT_ROOT, 'bin', 'selftest.mjs');
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['CI', 'RESEARCH_KIT_ALLOW_UNSUP', 'RESEARCH_KIT_RESULT_FILE'].includes(k)));
  const target = path.join(tempDir('rk-result-'), 'no-such-folder', 'result.json');
  const r = spawnSync(process.execPath, [selftest, 'canonical-float-policy'], {
    cwd: path.resolve(KIT_ROOT, '..'), encoding: 'utf8', timeout: 120_000, env: { ...base, RESEARCH_KIT_RESULT_FILE: target },
  });
  assert.equal(r.status, 2, `expected exit 2 for an undelivered report, got ${r.status}:\n${r.stderr.slice(-300)}`);
  assert.match(r.stderr, /RESEARCH_KIT_RESULT_FILE was set to .* and could not be written/);
  assert.match(r.stderr, /a green run exits 2/);
  assert.match(r.stdout, /all tests passed/, 'the suite result itself is still reported');
  assert.equal(fs.existsSync(target), false);
});
