// docs/ARCHITECTURE.md is the CURRENT map. These check that it stays one.
//
// The commit gate already requires the map to be STAGED with a code change, and is
// deliberately modest about it: a whitespace edit satisfies the gate, which makes a stale
// map a deliberate act rather than mere forgetting. That is a prompt, not a proof.
//
// These are the proof, for the parts that can be proved. They check structure and
// coverage - every module has an owner, every count matches the filesystem - and NOT
// prose. A test that greps for a sentence pins the wording instead of the fact, and goes
// red when someone improves a paragraph.
//
// On 2026-09-20 the map was split: what exists now stayed, why it exists moved to
// docs/architecture-history/ and the ADRs. The split is what surfaced the third
// documentation drift in this repository - the map said "11 checks in the registry" on
// one line and "12 named checks" in the diagram twelve lines above it.

import { test, describe, assert, assertEqual, fs, path, KIT_ROOT } from './harness.mjs';
import { CHECKS } from '../lib/checks.mjs';
import { TRANSPORT_NAMES } from '../lib/transport.mjs';

describe('architecture-map');

const REPO = path.resolve(KIT_ROOT, '..');
const MAP = path.join(REPO, 'docs', 'ARCHITECTURE.md');
const HISTORY = path.join(REPO, 'docs', 'architecture-history');
const map = () => fs.readFileSync(MAP, 'utf8');

/** Every .mjs under lib/, including the extracted release primitives. */
function libModules() {
  const lib = path.join(KIT_ROOT, 'lib');
  const top = fs.readdirSync(lib).filter((name) => name.endsWith('.mjs'));
  const release = fs.readdirSync(path.join(lib, 'release')).filter((name) => name.endsWith('.mjs'));
  return [...top, ...release.map((name) => `release/${name}`)];
}

test('every lib/ module has an ownership entry in the map', () => {
  // Acceptance criterion: the map covers what exists. A module with no row is a module
  // nobody has said who owns - which is how `config.mjs` went unlisted until someone
  // counted files against rows.
  const text = map();
  const missing = libModules().filter((name) => !text.includes(name));
  assertEqual(missing.length, 0,
    `these lib/ modules exist but the map never names them:\n  ${missing.join('\n  ')}`);
});

test('every bin/ entrypoint has an ownership entry in the map', () => {
  const text = map();
  const bin = fs.readdirSync(path.join(KIT_ROOT, 'bin'))
    .filter((name) => name.endsWith('.mjs') || name.endsWith('.py'));
  const missing = bin.filter((name) => !text.includes(name));
  assertEqual(missing.length, 0,
    `these bin/ entrypoints exist but the map never names them:\n  ${missing.join('\n  ')}`);
});

test('the map names no module that does not exist', () => {
  // The mirror, and the one that actually bit: two rows described modules that were never
  // written, unmarked, from the day the table was created until 2026-09-20.
  const text = map();
  const claimed = new Set([...text.matchAll(/`(?:lib\/)?([a-z0-9-]+\.mjs)`/g)].map((m) => m[1]));
  const onDisk = new Set([
    ...fs.readdirSync(path.join(KIT_ROOT, 'lib')),
    ...fs.readdirSync(path.join(KIT_ROOT, 'lib', 'release')),
    ...fs.readdirSync(path.join(KIT_ROOT, 'bin')),
    ...fs.readdirSync(path.join(KIT_ROOT, 'test')),
    ...fs.readdirSync(path.join(KIT_ROOT, 'hooks')),
    // The map legitimately names the example pack's scripts. Omitting this directory
    // made the first run of this test report build.mjs and run-example.mjs as phantoms -
    // the test was wrong, not the map.
    ...fs.readdirSync(path.join(KIT_ROOT, 'examples', 'release-evidence')),
  ]);
  const phantom = [...claimed].filter((name) => !onDisk.has(name));
  assertEqual(phantom.length, 0,
    `the map names these files, and none of them exist:\n  ${phantom.join('\n  ')}`);
});

test('the inventory counts match the filesystem', () => {
  // Every number in the inventory is checkable, so it is checked. The test count is
  // deliberately absent from the map - selftest.mjs owns that one, because it is the only
  // thing that can know it.
  const text = map();
  const inventory = text.slice(text.indexOf('## Current inventory'));
  const expect = (label, actual) => {
    const row = inventory.split('\n').find((line) => line.includes(label));
    assert(row, `the inventory has no row for ${label}`);
    const claimed = Number(row.match(/\*\*(\d+)\*\*/)?.[1]);
    assertEqual(claimed, actual, `the inventory says ${claimed} for "${label}"; the filesystem says ${actual}`);
  };
  expect('`lib/` modules', libModules().length);
  expect('`bin/` entrypoints', fs.readdirSync(path.join(KIT_ROOT, 'bin')).filter((n) => /\.(mjs|py)$/.test(n)).length);
  expect('`schemas/`', fs.readdirSync(path.join(KIT_ROOT, 'schemas')).filter((n) => n.endsWith('.json')).length);
  expect('vector packets', fs.readdirSync(path.join(KIT_ROOT, 'conformance')).filter((n) => n.endsWith('.json')).length);
  expect('checks in the registry', CHECKS.length);
});

test('the map does not repeat a test count, because it cannot keep one', () => {
  // A manually maintained total went stale twice: 326 when there were 565, then 565 when
  // there were 584. The map now defers to selftest.mjs, which is the only thing that can
  // know the number, and this stops anyone helpfully adding it back.
  const text = map();
  const counts = [...text.matchAll(/(\d{3,}) tests\b/g)].map((m) => m[0]);
  assertEqual(counts.length, 0,
    `the map states a test count again (${counts.join(', ')}). selftest.mjs owns that `
    + 'number and fails the run when fetchproof/README.md disagrees with it; a second '
    + 'copy here is a third place for it to go stale.');
});

test('every declared seam is numbered once and has an owner', () => {
  // A seam with two owners, or none, is the thing the seam was drawn to prevent.
  const text = map();
  const seams = [...text.matchAll(/^(\d+)\. \*\*([A-Za-z0-9 -]+seam)\*\*/gm)];
  assert(seams.length >= 7, `expected the numbered seam list to survive the split, found ${seams.length}`);
  const numbers = seams.map((m) => Number(m[1]));
  assertEqual(JSON.stringify(numbers), JSON.stringify(numbers.map((_, i) => i + 1)),
    `the seam list is not numbered 1..n without gaps: ${numbers.join(', ')}`);
  const names = seams.map((m) => m[2]);
  assertEqual(new Set(names).size, names.length, `a seam is listed twice: ${names.join(', ')}`);
});

test('history was moved and linked, not deleted', () => {
  // The whole split rests on this. If the narratives were dropped rather than relocated,
  // the map got shorter by losing the thing that made this repository worth reading.
  const text = map();
  assert(text.includes('architecture-history'), 'the map does not link to the history directory');

  const index = path.join(HISTORY, 'README.md');
  assert(fs.existsSync(index), 'docs/architecture-history/README.md is missing');

  // Every file the index lists must exist, and every file present must be listed.
  const listed = [...fs.readFileSync(index, 'utf8').matchAll(/\((\d{4}-\d{2}-\d{2}-[a-z-]+\.md)\)/g)].map((m) => m[1]);
  const present = fs.readdirSync(HISTORY).filter((name) => /^\d{4}-\d{2}-\d{2}-/.test(name));
  assertEqual(listed.sort().join(','), present.sort().join(','),
    `the history index and the directory disagree.\n  index: ${listed.join(', ')}\n  disk:  ${present.join(', ')}`);

  // The specific evidence that moved. Losing a benchmark is easy and silent.
  const narratives = fs.readFileSync(path.join(HISTORY, '2026-09-20-shape-and-defect-narratives.md'), 'utf8');
  for (const marker of ['10,005 arguments', 'quadratic, no output', 'O_EXCL', 'core.autocrlf', 'unreadable']) {
    assert(narratives.includes(marker), `the moved history no longer contains "${marker}"`);
  }
});

test('the map does not contradict itself about exit codes', () => {
  // This is the test that should have existed already.
  //
  // The map stated the corrected invariant - "usage errors return 2 from every
  // subcommand" - in one section while a paragraph two hundred lines away still said
  // "a usage error exits 2 for validate and conform but 4 for fi-validate; no test pins
  // either". Both claims were in the current map at once, and the second was doubly
  // false: the code IS 2 everywhere, and a test DOES pin it.
  //
  // Finding it took an external reader. A document is not trustworthy because someone
  // read it carefully once; it is trustworthy when disagreeing with the code is a test
  // failure. So every exit-code claim the map makes is checked against the CLI.
  const text = map();
  const cli = fs.readFileSync(path.join(KIT_ROOT, 'bin', 'researcher-release.mjs'), 'utf8');

  // What the CLI actually does with a usage error, read from its source.
  const usageCodes = new Set(
    cli.split('\n')
      .filter((line) => /console\.error\(usage\(\)\)/.test(line))
      .map((line) => line.match(/return\s+(\d)/)?.[1])
      .filter(Boolean),
  );
  assertEqual(usageCodes.size, 1,
    `the CLI returns more than one code for a usage error (${[...usageCodes].join(', ')}), `
    + 'so no single claim in the map can be true');
  const usage = [...usageCodes][0];

  // Any sentence in the map that talks about a usage error and names a digit must agree.
  //
  // EVERY standalone digit in such a sentence is checked, not only one following an
  // "exits"/"returns" verb. The first version of this test looked only after those verbs
  // and so missed the exact sentence it was written for:
  //
  //   "a usage error exits 2 for validate and conform but 4 for fi-validate"
  //
  // It captured the 2, found it correct, and passed - while the 4 sat two words later. I
  // verified that by reintroducing the sentence and watching the test stay green, which
  // is the only reason I know it was broken.
  // Only the CLAUSE about the usage error is read, not the whole line. A line that
  // mentions a usage error usually also lists the status codes beside it - 0, 1, 2, 3,
  // and 4 for an unrecognised status - and reading the whole line flagged every one of
  // them. That was this test's second false start: too narrow first, then too wide.
  const clauseAbout = (line) => {
    const start = line.search(/usage error/i);
    if (start < 0) return null;
    const rest = line.slice(start);
    const end = rest.search(/[.;]\s|,\s+(?:and|printing)\b/);
    return end < 0 ? rest : rest.slice(0, end);
  };

  const wrong = text.split('\n').filter((line) => {
    const clause = clauseAbout(line);
    if (!clause) return false;
    const claimed = [...clause.matchAll(/(?<![\w.`])`?(\d)`?(?![\w.`])/g)].map((m) => m[1]);
    return claimed.some((code) => code !== usage);
  });
  assertEqual(wrong.length, 0,
    `the map claims a usage-error exit code other than ${usage}, which is what the CLI `
    + `returns:\n  ${wrong.map((l) => l.slice(0, 160)).join('\n  ')}`);
});

test('the module table states ownership, not chronology', () => {
  // "Ported 2026-09-20", "Extracted 2026-09-20", "decomposed the same day" - twelve rows
  // opened with when they were written rather than what they own. That is the adopted
  // policy's boundary: the map says what a module owns NOW, the ADR in the third column
  // says who decided it, and the date belongs to the commit that made it.
  const text = map();
  const rows = text.split('\n').filter((line) => /^\| `/.test(line));
  const dated = rows.filter((line) => /\*\*(Ported|Extracted|Added|Rewritten|Split) \d{4}-\d{2}-\d{2}/.test(line));
  assertEqual(dated.length, 0,
    'these rows open with a date instead of an owner. The governing ADR belongs in the '
    + `third column; the date belongs to git:\n  ${dated.map((l) => l.slice(0, 110)).join('\n  ')}`);
});

test('the scaffold template stays a scaffold', () => {
  // Acceptance criterion: the template is a starting point for somebody else's project.
  // Repository-specific history leaking into it would ship this project's defect stories
  // to every project the kit ever creates.
  const template = path.join(KIT_ROOT, 'template', 'docs', 'ARCHITECTURE.md');
  const text = fs.readFileSync(template, 'utf8');
  assert(text.length < 6000, `the template architecture doc is ${text.length} bytes; it is a scaffold, not a map`);
  const leaked = ['ADR-0029', 'release-validator', 'conformance_common', 'firecrawl', '10,005']
    .filter((term) => text.includes(term));
  assertEqual(leaked.length, 0,
    `this repository's specifics leaked into the scaffold template: ${leaked.join(', ')}`);
});

test('no current document claims a capability that has no entrypoint', () => {
  // F-12. The dashboard was specified, then deliberately aborted, and its design notes
  // survive in the dated record - correctly, because a rejected design is a decision.
  //
  // The risk is process, not code: a future reader finds those specs and adds a row to a
  // command table, or a README sentence, describing something nobody built. This repo has
  // already shipped an architecture map describing two modules that did not exist.
  //
  // So a CURRENT document may not claim one of these exists unless a bin/ entrypoint
  // backs it. History may discuss them freely.
  const speculative = ['dashboard', 'web UI', 'live view'];
  const current = [
    ['docs/ARCHITECTURE.md', map()],
    ['README.md', fs.readFileSync(path.join(REPO, 'README.md'), 'utf8')],
    ['fetchproof/README.md', fs.readFileSync(path.join(KIT_ROOT, 'README.md'), 'utf8')],
  ];
  const bin = fs.readdirSync(path.join(KIT_ROOT, 'bin'));

  const claims = [];
  for (const [file, text] of current) {
    for (const term of speculative) {
      // Only a CLAIM counts: the word beside a command, or an assertion that it exists.
      const claimed = new RegExp(`(node fetchproof/bin/\S*${term}|\`[^\`]*${term}[^\`]*\.mjs\`)`, 'i');
      const hit = text.match(claimed);
      if (!hit) continue;
      const backed = bin.some((name) => name.toLowerCase().includes(term.split(' ')[0].toLowerCase()));
      if (!backed) claims.push(`${file}: ${hit[0]}`);
    }
  }
  assertEqual(claims.length, 0,
    `these current documents name a capability with no bin/ entrypoint behind it:\n  ${claims.join('\n  ')}`);
});

test('the live workflow does not swallow the checks that decide its result', () => {
  // The first version of live-collection.yml ran handoff and preflight and then discarded
  // both exit codes with `|| true`, so a green run proved only that the repository was
  // unchanged. That is worse than having no workflow: a signal that looks like
  // verification and is not.
  //
  // This pins the property rather than the wording: the commands that decide the result
  // may not be suffixed with a swallow.
  const file = path.join(REPO, '.github', 'workflows', 'live-collection.yml');
  if (!fs.existsSync(file)) return;                      // the workflow is optional
  const yaml = fs.readFileSync(file, 'utf8');

  const swallowed = yaml.split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .filter((line) => /\|\|\s*true/.test(line))
    .filter((line) => /(handoff|preflight|research)\.mjs/.test(line));
  assertEqual(swallowed.length, 0,
    `these steps decide the workflow's result and discard their exit status:\n  ${swallowed.join('\n  ')}`);

  // Paid runs must be serialised: max_pages bounds ONE run, not the meter.
  assert(/^concurrency:/m.test(yaml), 'the paid workflow has no concurrency group; two dispatches spend at once');
  assert(/cancel-in-progress:\s*false/.test(yaml),
    'cancelling a paid collection mid-flight wastes the credits already spent');

  // A public summary must not carry URL paths or query strings.
  assert(!/\.url\s*\?\?\s*""\)\.slice/.test(yaml),
    'the summary prints a URL prefix, which discloses what was being researched');
  assert(/hostname/.test(yaml), 'the summary should reduce URLs to hostnames');
});

test('the live workflow refuses an auto-created environment before it spends (E-06)', () => {
  // GitHub does not fail a workflow that names a missing environment: it CREATES one, with
  // no protection rules and no secrets. collect.yml has refused that since ADR-0033 by
  // requiring a marker variable an auto-created environment cannot have. This workflow did
  // not - and on its first dispatch, 2026-09-26, it named `live-collection` before anyone
  // had created it. It failed safely only because the new environment had no key.
  const file = path.join(REPO, '.github', 'workflows', 'live-collection.yml');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('#'));
  const at = (re) => lines.findIndex((line) => re.test(line));

  const marker = at(/vars\.FETCHPROOF_LIVE_ENV/);
  assert(marker !== -1, 'nothing checks that the live-collection environment actually exists');
  assert(lines.some((line) => /expected='live-collection'/.test(line)),
    'the marker must be compared to the environment name, not merely be non-empty');
  const credential = at(/secrets\.FIRECRAWL_API_KEY/);
  const spends = at(/bin\/research\.mjs/);
  assert(credential !== -1 && spends !== -1, 'the workflow no longer reads the key or collects - this test is vacuous');
  assert(marker < credential && marker < spends,
    'the environment check must run before the credential is read and before anything is spent');
});

test('the live workflow gives its scratch plan something to collect', () => {
  // Found 2026-09-26 by running the workflow's sequence rather than reading it: the scratch
  // project is scaffolded from the template, whose plan has NO queries and NO urls, and the
  // step that edits it only set budgets. research.mjs therefore collected nothing, wrote no
  // ledger, and the next step failed "collection produced no fetch ledger" - on every run,
  // with every key in place. The workflow had never been run, so nothing had noticed.
  const file = path.join(REPO, '.github', 'workflows', 'live-collection.yml');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('#'));
  assert(lines.some((line) => /plan\.queries\s*=\s*\[\s*\{/.test(line)),
    'the scratch plan is never given a query, so the run collects nothing and fails');
});

test('the live workflow fills its plan before it runs research.mjs at all, dry run included', () => {
  // Found 2026-09-28 by dispatching it: both live runs failed at the collection step with
  // "research/plan.json has no queries and no urls - nothing to collect" (exit 2), before a
  // credit was spent. The step ran `research.mjs --dry-run` on the scaffolded plan and only
  // THEN wrote the query - fine until d20c686 (2026-09-27) made research.mjs refuse an
  // empty plan, dry run included, which is right for a person and fatal here. The test
  // above checked a query was written; nothing checked it was written FIRST.
  const file = path.join(REPO, '.github', 'workflows', 'live-collection.yml');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const step = text.slice(text.indexOf('name: collect into a scratch project'), text.indexOf('name: a ledger was written'))
    .split('\n').filter((line) => !line.trim().startsWith('#') && !line.trim().startsWith('//'));
  const filled = step.findIndex((line) => /plan\.queries\s*=\s*\[/.test(line));
  const runs = step.map((line, i) => (/bin\/research\.mjs/.test(line) ? i : -1)).filter((i) => i !== -1);
  assert(filled !== -1 && runs.length > 0, 'the collection step no longer writes a query or runs research.mjs');
  const early = runs.filter((i) => i < filled).map((i) => step[i].trim());
  assertEqual(early.length, 0,
    `research.mjs runs before the plan has a query, and refuses an empty plan (exit 2):\n  ${early.join('\n  ')}`);
});

test('the live workflow hands the search key to collection, so the search seam is tested too', () => {
  // Its header says to run it "after changing lib/serpapi.mjs" - but only FIRECRAWL_API_KEY
  // reached the collection step, so a SerpAPI key in the environment was never read and the
  // merged search (ADR-0027) was never exercised. Absent key: unchanged behaviour.
  const file = path.join(REPO, '.github', 'workflows', 'live-collection.yml');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const step = text.slice(text.indexOf('name: collect into a scratch project'), text.indexOf('name: a ledger was written'));
  assert(/SERPAPI_API_KEY:\s*\$\{\{\s*secrets\.SERPAPI_API_KEY\s*\}\}/.test(step),
    'the collection step does not receive SERPAPI_API_KEY, so the search provider is never tested');
});

test('the live workflow requires integrity, not research sufficiency', () => {
  // Found by RUNNING the predicate, not by reading it.
  //
  // The workflow originally required `preflight` to exit 0 on the scratch project it
  // collects into. Preflight answers "is the RESEARCH sufficient to build" - a
  // human-authored question - so a freshly scaffolded project fails
  // `discovery-contract/no-unknowns` and exits 1 however perfectly collection worked.
  // The workflow would have failed on every run, always, for a reason having nothing to
  // do with the transport it exists to test.
  //
  // What collection CAN answer is integrity: the chain verifies, captures are on disk,
  // the corpus parses. Those are required per-check instead.
  const file = path.join(REPO, '.github', 'workflows', 'live-collection.yml');
  if (!fs.existsSync(file)) return;
  const yaml = fs.readFileSync(file, 'utf8');
  const executable = yaml.split('\n').filter((line) => !line.trim().startsWith('#'));

  const wholeVerdict = executable.filter((line) => /preflight\.mjs/.test(line) && !/--check/.test(line));
  assertEqual(wholeVerdict.length, 0,
    'the workflow requires the whole preflight verdict from a scratch project, which can '
    + `never satisfy it - it has no unknowns to prove:\n  ${wholeVerdict.join('\n  ')}`);

  assert(/--check "\$check"|--check \$check/.test(yaml),
    'the workflow should require named integrity checks rather than the overall verdict');
  for (const check of ['provenance', 'corpus-shape', 'citations']) {
    assert(yaml.includes(check), `the integrity predicate no longer names ${check}`);
  }
});

test('the live workflow can exercise every fetch transport the kit registers', () => {
  // Found 2026-09-29: the browser transport (ADR-0088) shipped with no way to run it live -
  // the dispatch offered firecrawl-cli and http-keyless only, and the header's "when to run
  // it" list did not name lib/browser-transport.mjs. A transport nobody can run live is
  // tested only against stubs, which is the gap this workflow exists to close.
  const file = path.join(REPO, '.github', 'workflows', 'live-collection.yml');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const options = text.match(/transport:[\s\S]*?options:\s*\[([^\]]*)\]/);
  assert(options, 'the transport input no longer lists its options');
  const offered = options[1].split(',').map((o) => o.trim());
  for (const name of TRANSPORT_NAMES) {
    assert(offered.includes(name), `the live workflow cannot run the ${name} transport`);
  }
  assert(/lib\/browser-transport\.mjs/.test(text), 'the header does not say to run it after changing lib/browser-transport.mjs');
});

test('no workflow prints a secret\'s value, even to say whether it is set', () => {
  // Found 2026-09-29: `echo "credential present: ${FIRECRAWL_API_KEY:+yes}${FIRECRAWL_API_KEY:-no}"`
  // expands the second form to the key itself when it IS set - GitHub's log masking turned it
  // into "yes***", so the step titled "never printed" relied on the masker to keep its word.
  // A presence check tests the variable; it never expands it where output goes.
  const dir = path.join(REPO, '.github', 'workflows');
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const at = line.search(/\b(echo|printf)\b/);
      if (at === -1) return;
      const leaked = line.slice(at).match(/\$\{?(\w*(?:API_KEY|TOKEN|SECRET)\w*)(?![:]\+)(?:\}|:-|\b)/);
      assert(!leaked, `${name}:${i + 1} prints ${leaked?.[1]}: ${line.trim()}`);
    });
  }
});

test('CI regenerates the derived files before it checks the tree is clean', () => {
  // Found 2026-09-29 (break-test PR #140): timeline.mjs and export-warc.mjs dirtied the
  // repository, and CI's clean-tree check never ran them, so it could not notice.
  const file = path.join(REPO, '.github', 'workflows', 'offline-suite.yml');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const regen = text.indexOf("name: the corpus's derived files regenerate to their committed bytes");
  const clean = text.indexOf('name: the suite left the working tree clean');
  assert(regen !== -1, 'no step regenerates the derived files');
  assert(clean > regen, 'the regeneration must run BEFORE the clean-tree check, or nothing checks it');
  const step = text.slice(regen, clean);
  assert(/bin\/timeline\.mjs/.test(step) && /bin\/export-warc\.mjs/.test(step), 'both writers must run');
});

test('CI runs the suite once from a git archive tree, and the required check waits for it', () => {
  // Found 2026-09-30 (break-test): a ZIP download has no .git, and one test assumed it did.
  // Every CI leg runs from a checkout, so nothing could notice.
  const file = path.join(REPO, '.github', 'workflows', 'offline-suite.yml');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const at = text.indexOf('\n  archive-tree:\n');
  assert(at !== -1, 'no archive-tree job');
  const job = text.slice(at, text.indexOf('\n  suite:\n'));
  assert(/git archive/.test(job), 'the archive-tree job does not export with git archive');
  assert(/bin\/selftest\.mjs/.test(job), 'the archive-tree job does not run the suite');
  // A folder name with a space, as a Windows home or a renamed download has (2026-09-30).
  assert(/tree="\$RUNNER_TEMP\/[^"]* [^"]*"/.test(job), 'the archive-tree job no longer runs from a path with a space');
  assert(/needs: \[[^\]]*\barchive-tree\b[^\]]*\]/.test(text), 'the required suite check does not wait for archive-tree');
  assert(/needs\.archive-tree\.result/.test(text), 'the required suite check does not read archive-tree\'s result');
});
