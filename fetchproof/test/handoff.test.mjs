// The arrival question, and one remedy per cause (ADR-0011, ADR-0020).

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { test, describe, assert, makePassingProject, corrupt, tempDir, fs, path, requireGit, fixtureCommitArgs, fixtureInitArgs, KIT_ROOT, Unsupported } from './harness.mjs';
import { evaluate } from '../lib/gate.mjs';
import { TEMPLATE_DIR } from '../lib/scaffold.mjs';
import { PATHS, resolve, writeText, today } from '../lib/core.mjs';
import { verifyHandoff, handoffRemedy, HANDOFF_REMEDY, lineEndingRemedy, alteredRemedy, safePathspec, insideRepository, repositoryState, NAMES_FILE, PIN_LINES } from '../lib/handoff.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { runDoctor } from '../lib/doctor.mjs';
import { appendFetch } from '../lib/provenance.mjs';
import { writeRaw, collectOne } from '../lib/collect.mjs';
import { runCheck } from '../lib/checks.mjs';
import { runPreflight } from '../lib/preflight.mjs';

describe('handoff');

const names = (report) => report.findings.map((f) => f.name);

// Run `fn` with git's repository discovery stopped at the fixture's parent: a scratch folder
// has no .git of its own, but the question is now git's, and a developer's temp folder may sit
// under a repository (a dotfiles home). GIT_CEILING_DIRECTORIES is git's own way to say "look
// no further", and the walk the kit falls back on without git honours it too.
function outsideAnyRepository(dir, fn) {
  const saved = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(path.dirname(dir));
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = saved;
  }
}

test('a corpus that arrived whole passes', () => {
  const report = verifyHandoff(makePassingProject());
  assert.equal(report.ok, true, report.findings.map((f) => f.detail).join('; '));
  assert.equal(report.remedy, '');
});

test('a leading ledger byte-order mark leaves the chain and handoff intact', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.ledger, (text) => `\uFEFF${text}`);
  const report = verifyHandoff(dir);
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.equal(report.didNotTravel, false);
  assert.equal(report.ledgerLost, false);
  assert.equal(runPreflight(dir).pass, true, 'the provenance gate must accept the same intact chain');
});

test('unparsed ledger lines get the local repair remedy instead of lost-entry or travel advice', () => {
  const tail = makePassingProject();
  fs.appendFileSync(resolve(tail, PATHS.ledger), '\n\n{"seq":2,"url":"unfinished');
  let report = verifyHandoff(tail);
  assert.equal(report.ok, false);
  assert.equal(report.didNotTravel, false);
  assert.equal(report.ledgerLost, false);
  assert.match(report.remedy, /doctor\.mjs"? --fix-arity/);
  assert.doesNotMatch(report.remedy, /Something did not travel|ledger lost entries/);

  const middle = makePassingProject();
  corrupt(middle, PATHS.ledger, (text) => `not JSON\n${text}`);
  report = verifyHandoff(middle);
  assert.equal(report.ok, false);
  assert.equal(report.didNotTravel, false);
  assert.equal(report.ledgerLost, false);
  assert.match(report.remedy, /broken line inside the chain.*restore research\/raw\/\.fetches\.jsonl from git/);
  assert.doesNotMatch(report.remedy, /Something did not travel|ledger lost entries|--fix-arity/);

  const brokenEntry = makePassingProject();
  appendFetch(brokenEntry, { op: 'fail', url: 'https://example.invalid/second', transport: 'http-keyless' });
  corrupt(brokenEntry, PATHS.ledger, (text) => text.replace(/^[^\n]+/, 'unreadable first entry'));
  report = verifyHandoff(brokenEntry);
  assert.equal(report.ok, false);
  assert.equal(report.didNotTravel, false, 'unparsed entries cause secondary seq/prev failures');
  assert.equal(report.ledgerLost, false, 'a capture may be recorded in the unreadable entry');
  assert.match(report.remedy, /restore research\/raw\/\.fetches\.jsonl from git/);
  assert.doesNotMatch(report.remedy, /Something did not travel|ledger lost entries/);
});

test('an unreadable ledger does not hide a capture that really did not travel', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  fs.rmSync(resolve(dir, capture.file));
  fs.appendFileSync(resolve(dir, PATHS.ledger), '{"seq":2');
  const report = verifyHandoff(dir);
  assert.equal(report.didNotTravel, true);
  assert.match(report.remedy, /Something did not travel/);
  assert.match(report.remedy, /--fix-arity/);
});

test('a missing ledger is named handoff-ledger-missing', () => {
  const dir = makePassingProject();
  fs.rmSync(resolve(dir, PATHS.ledger));
  const report = verifyHandoff(dir);
  assert.ok(names(report).includes('handoff-ledger-missing'));
  assert.match(report.remedy, /git add -f research\/raw\//);
});

test('an EVIDENCE.md that did not travel is named: absent, or holding no evidence table', () => {
  // handoff said OK over a corpus without its table - no rows, no citations, nothing to
  // check, so "every cited capture on disk" held vacuously - for an absent EVIDENCE.md, a
  // binary one, and one whose header a filter had rewritten (found 2026-10-02, break-test).
  const absent = makePassingProject();
  fs.rmSync(resolve(absent, PATHS.evidence));
  let report = verifyHandoff(absent);
  assert.equal(report.ok, false, 'an absent table is not a corpus that arrived whole');
  assert.ok(names(report).includes('handoff-evidence-missing'), names(report).join(', '));
  assert.equal(report.didNotTravel, true);
  assert.match(report.remedy, /Something did not travel/);

  const garbled = makePassingProject();
  writeText(resolve(garbled, PATHS.evidence), '\u0000\u0001\u0002 not a table\n');
  report = verifyHandoff(garbled);
  assert.ok(names(report).includes('handoff-evidence-unparsed'), names(report).join(', '));
  assert.match(report.remedy, /Something did not travel/);

  const header = makePassingProject();
  const text = fs.readFileSync(resolve(header, PATHS.evidence), 'utf8');
  writeText(resolve(header, PATHS.evidence), text.replace(/^\| ID \|/m, '| XD |'));
  report = verifyHandoff(header);
  assert.ok(names(report).includes('handoff-evidence-unparsed'), 'a header that no longer names the columns is no table');
  assert.equal(verifyHandoff(makePassingProject()).rows > 0, true, 'the report counts the rows it checked');
});

test('an empty ledger is named handoff-ledger-empty - present is not the same as whole', () => {
  const dir = makePassingProject();
  writeText(resolve(dir, PATHS.ledger), '');
  assert.ok(names(verifyHandoff(dir)).includes('handoff-ledger-empty'));
});

// Arena, 2026-09-28: a one-line ledger with a torn tail, repaired by doctor --fix-arity, is
// EMPTY while every capture is still on disk. The advice was to push from the collector -
// which, on the collector, pushes the same empty ledger. Nothing failed to travel: the
// entries were lost where the captures are, so the remedy is to restore or re-collect.
test('an empty ledger beside captures on disk lost its entries: restore or re-collect, not push', () => {
  const dir = makePassingProject();
  assert.ok(readCorpus(dir).captures.entries.length > 0, 'the fixture holds captures');
  writeText(resolve(dir, PATHS.ledger), '');
  const report = verifyHandoff(dir);
  assert.ok(names(report).includes('handoff-ledger-empty'));
  assert.equal(report.ledgerLost, true);
  assert.equal(report.didNotTravel, false, 'nothing is missing from this checkout');
  assert.doesNotMatch(report.remedy, /git add -f/);
  assert.match(report.remedy, /git checkout HEAD -- research\/raw\/\.fetches\.jsonl/);
  // The command is printed quoted (kitCommand), and a checkout under a path with a space
  // in it - routine on macOS and Windows - closes that quote between the script and its
  // first flag. Without the optional quote this suite cannot pass from such a checkout
  // (found 2026-09-28, break-test: one red test from a clone under "deep dir/").
  assert.match(report.remedy, /research\.mjs"? --plan research\/plan\.json --force/);
});

// The same loss, one line shorter: a torn LAST line of a longer ledger, dropped by
// doctor --fix-arity, leaves one cited capture on disk that no entry records. Handoff said
// OK and exited 0 while preflight failed it (fetch-entry-exists) - the builder's first
// command disagreed with its second.
test('a cited capture no ledger entry records is named, with the restore remedy', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  const second = capture.file.replace(/\.md$/, '-two.md');
  fs.copyFileSync(resolve(dir, capture.file), resolve(dir, second));
  const evidence = resolve(dir, PATHS.evidence);
  const row = fs.readFileSync(evidence, 'utf8').split('\n').find((l) => l.startsWith('| E-01 '));
  fs.appendFileSync(evidence, `${row.replace('E-01', 'E-02').replace(capture.file, second)}\n`);
  const report = verifyHandoff(dir);
  assert.equal(report.ok, false, 'handoff passed a capture preflight fails');
  const finding = report.findings.find((f) => f.name === 'handoff-capture-unledgered');
  assert.ok(finding, names(report).join(', '));
  assert.match(finding.detail, /E-02/);
  assert.equal(report.ledgerLost, true);
  assert.equal(report.didNotTravel, false);
  assert.match(report.remedy, /git checkout HEAD -- research\/raw\/\.fetches\.jsonl/);
});

test('an empty ledger with a cited capture also missing gets both remedies', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  writeText(resolve(dir, PATHS.ledger), '');
  fs.rmSync(resolve(dir, capture.file));
  const report = verifyHandoff(dir);
  assert.equal(report.didNotTravel, true);
  assert.match(report.remedy, /git add -f/);
});

test('a capture an evidence row names but that is not on disk is named, per row', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  fs.rmSync(resolve(dir, capture.file));
  const report = verifyHandoff(dir);
  assert.ok(names(report).includes('handoff-capture-missing'));
  assert.equal(report.missingCaptures[0].row, 'E-01');
});

test('a broken chain is named handoff-chain-broken, one line per capture', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.ledger, (text) => text.replace(/"seq":1/, '"seq":7'));
  const report = verifyHandoff(dir);
  const broken = report.findings.filter((f) => f.name === 'handoff-chain-broken');
  assert.ok(broken.length);
  for (const finding of broken) {
    assert.equal(finding.detail.includes('\n'), false, 'a paragraph per capture buries the capture names');
  }
});

test('a line-ending rewrite gets the LOCAL remedy, and no push remedy', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => text.replace(/\n/g, '\r\n'));

  const report = verifyHandoff(dir);
  assert.equal(report.ok, false);
  assert.equal(report.lineEndings.length, 1);
  assert.equal(report.didNotTravel, false, 'everything travelled; this machine rewrote it');

  const remedy = handoffRemedy(report);
  assert.doesNotMatch(remedy, /git add -f research\/raw\//,
    'sending an operator to the collector for a corpus already on disk is the defect this fixes');
  assert.doesNotMatch(remedy, /git add/);
  // Outside a repository the remedy refuses to print a command that cannot work there rather
  // than one that would destroy what it cannot restore. Through handoffRemedy, so the choice
  // of branch is tested too (the second review found the branch asked directly let a detection
  // that always said "repository" pass every test).
  const outside = outsideAnyRepository(dir, () => handoffRemedy(report));
  assert.match(outside, /no git metadata/);
  assert.doesNotMatch(outside, /git add|git checkout/);

  // In a real repository the same cause gets the runnable, non-destructive remedy.
  const inRepo = lineEndingRemedy(report.lineEndings.map((e) => e.file), { isRepo: true });
  assert.match(inRepo, /\.gitattributes/);
  assert.match(inRepo, /git checkout HEAD -- research\/raw\//, 'the capture is rewritten here, from the committed copy');
  assert.match(inRepo, /re-collecting spends paid credits/);
});

// Until 2026-10-04 a capture changed after its fetch got the PUSH remedy - "something did not
// travel, the remedy lives on the COLLECTOR machine" - which sends the same bytes again when
// the change was committed, and when it is local to this checkout sends an operator to another
// machine for a file whose committed copy is a `git checkout` away (break-test pass 4, F5b).
test('a capture changed after its fetch gets the ALTERED remedy, and no push remedy', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => `${text}\nrewritten by hand\n`);

  const report = verifyHandoff(dir);
  assert.equal(report.ok, false);
  assert.equal(report.lineEndings.length, 0);
  assert.deepEqual(report.altered.map((e) => e.file), [capture.file]);
  assert.equal(report.didNotTravel, false, 'the capture is here; its bytes changed after the fetch');

  const remedy = handoffRemedy(report);
  assert.doesNotMatch(remedy, /Something did not travel/, 'the push remedy sends the same bytes again');
  assert.doesNotMatch(remedy, /git add/);
  assert.match(remedy, /changed AFTER its fetch/);
  // Outside a repository no command that cannot work is printed - through handoffRemedy, so
  // the choice of branch is tested, with git's discovery stopped above the scratch folder.
  const outside = outsideAnyRepository(dir, () => handoffRemedy(report));
  assert.match(outside, /no git metadata/);
  assert.doesNotMatch(outside, /git checkout/);

  const escaped = capture.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inRepo = alteredRemedy([capture.file], { isRepo: true });
  assert.match(inRepo, new RegExp(`^ {4}git status --porcelain -- ${escaped}$`, 'm'), 'first, whether the change is local');
  assert.match(inRepo, new RegExp(`^ {4}git checkout HEAD -- ${escaped}$`, 'm'), 'the committed copy restores a local change for nothing');
  // Found 2026-10-04 by an external review: a dirty status does not prove HEAD holds the
  // fetched bytes, and `--force` re-collects into a NEW capture while the ledger still names
  // this one - so neither is claimed or offered.
  assert.doesNotMatch(inRepo, /committed copy is the fetched one/, 'a dirty status proves only that this checkout changed the file');
  assert.match(inRepo, /then run handoff again/);
  assert.match(inRepo, new RegExp(`^ {4}git log --oneline -- ${escaped}$`, 'm'), 'the committed case looks for the commit that held the fetched bytes');
  assert.doesNotMatch(inRepo, /--force|research\.mjs/, 're-collecting writes a new capture; the ledger still names this one');
  assert.doesNotMatch(alteredRemedy([capture.file], { isRepo: false }), /re-collect the capture/);
  assert.doesNotMatch(inRepo, /git checkout HEAD -- research\/raw\/$/m, 'a folder-wide checkout discards uncommitted work');
  for (const line of inRepo.split('\n').filter((l) => /^ {4}\S/.test(l)).map((l) => l.trim())) {
    assert.match(line, /^(git|node) /, `not a command: ${line}`);
    assert.doesNotMatch(line, /#/, `a trailing comment is a file name in cmd: ${line}`);
  }
});

test('the altered-capture remedy, run as printed, restores a capture changed in this checkout', () => {
  requireGit('the altered-capture remedy');
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const dir = makePassingProject();
  for (const args of [fixtureInitArgs(), ['config', 'user.email', 't@t'], ['config', 'user.name', 't'],
    ['add', '-A'], fixtureCommitArgs('corpus')]) {
    assert.equal(git(dir, ...args).status, 0, `git ${args.join(' ')}`);
  }
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => `${text}\nrewritten by hand\n`);
  const before = verifyHandoff(dir);
  assert.equal(before.altered.length, 1, 'the fixture did not produce an altered capture');

  const remedy = handoffRemedy(before);
  assert.doesNotMatch(remedy, /no git metadata/, 'this checkout has a repository');
  for (const line of remedy.split('\n').map((l) => l.trim())) {
    if (line.startsWith('git ') && !line.startsWith('git status')) {
      const r = git(dir, ...line.split(/\s+/).slice(1));
      assert.equal(r.status, 0, `${line}\n${r.stderr}`);
    }
  }
  const after = verifyHandoff(dir);
  assert.equal(after.ok, true, `the remedy did not restore it:\n${remedy}\n${JSON.stringify(after.findings.map((f) => f.detail))}`);
});

// Found 2026-10-04 by two external reviews: a ledger rewritten by hand can name a capture whose
// path a shell or git reads - a space is two pathspecs unquoted, `$copy` expands to nothing in
// PowerShell even inside double quotes, and `[12]` is a git glob whatever the shell did - and
// `git checkout HEAD --` then restored a neighbour and discarded its uncommitted work, exit 0.
// No one spelling is literal for cmd, PowerShell, sh AND git, so such a name is never printed
// as a command: it is named, and the operator is told how to type it. The collector's own
// names (makeSlug, date, hash, .source.html) are the safe alphabet and still print.
test('a capture path a shell or git would read is named but never printed as a command', () => {
  assert.equal(safePathspec('research/raw/2026-10-04-limits-example-a4e22bcd.md'), true);
  assert.equal(safePathspec('research/raw/2026-10-04-limits-example-a4e22bcd.source.html'), true);
  for (const bad of ['research/raw/topic copy.md', 'research/raw/topic $copy.md', 'research/raw/topic[12] copy.md', 'research/raw/topic`x.md', 'research/raw/topic;x.md', 'research/raw/topic"x.md']) {
    assert.equal(safePathspec(bad), false, bad);
    for (const remedy of [alteredRemedy([bad], { isRepo: true }), lineEndingRemedy([bad], { isRepo: true })]) {
      const commands = remedy.split('\n').filter((l) => /^ {4}\S/.test(l));
      assert.ok(commands.every((l) => !l.includes('topic')), `printed as a command:\n${remedy}`);
      assert.ok(remedy.includes(bad), 'the file is still named');
      // "Quote it for your shell" was not enough: cmd expands %NAME% inside quotes (third
      // review). The names go in a file git reads itself, with pattern syntax switched off.
      assert.doesNotMatch(remedy, /quoted for YOUR shell/);
      assert.match(remedy, new RegExp(`--pathspec-from-file=${NAMES_FILE}`));
      assert.match(remedy, /^ {4}git --literal-pathspecs (checkout|rm) /m, 'the printed command types no name');
    }
  }
  // A safe name beside an unsafe one: the safe one still prints, the unsafe one is noted.
  const mixed = alteredRemedy(['research/raw/a.md', 'research/raw/b c.md'], { isRepo: true });
  assert.match(mixed, /^ {4}git checkout HEAD -- research\/raw\/a\.md$/m);
  assert.doesNotMatch(mixed, /^ {4}git .*b c\.md/m);
  assert.match(mixed, /Not printed as a command.*research\/raw\/b c\.md/);
});

test('a capture committed altered and edited again: the printed checkout is followed by handoff again, which still fails and says what is next', () => {
  requireGit('the altered-capture remedy');
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const dir = makePassingProject();
  for (const args of [fixtureInitArgs(), ['config', 'user.email', 't@t'], ['config', 'user.name', 't'],
    ['add', '-A'], fixtureCommitArgs('corpus')]) {
    assert.equal(git(dir, ...args).status, 0, `git ${args.join(' ')}`);
  }
  const capture = readCorpus(dir).captures.entries[0];
  // The alteration was committed (past the gate, --no-verify), then the file was edited again.
  corrupt(dir, capture.file, (text) => `${text}\ncommitted alteration\n`);
  for (const args of [['add', '-A'], fixtureCommitArgs('altered')]) assert.equal(git(dir, ...args).status, 0);
  corrupt(dir, capture.file, (text) => `${text}\nlocal edit\n`);

  const before = verifyHandoff(dir);
  assert.equal(before.altered.length, 1);
  const remedy = handoffRemedy(before);
  assert.match(git(dir, 'status', '--porcelain', '--', capture.file).stdout, /\S/, 'the status is dirty, as the remedy expects');
  let ran = 0;
  for (const line of remedy.split('\n').map((l) => l.trim())) {
    if (line.startsWith('git checkout HEAD')) { assert.equal(git(dir, ...line.split(/\s+/).slice(1)).status, 0, line); ran += 1; }
  }
  // Without this the test passed with the checkout command deleted: handoff was failing before
  // the restore too (found 2026-10-04 by the second external review).
  assert.equal(ran, 1, 'the printed checkout did not run');
  assert.equal(fs.readFileSync(resolve(dir, capture.file), 'utf8').includes('local edit'), false, 'the checkout did not restore HEAD');
  const after = verifyHandoff(dir);
  assert.equal(after.ok, false, 'HEAD holds the altered bytes; restoring it cannot pass');
  assert.deepEqual(after.altered.map((e) => e.file), [capture.file]);
  // The remedy already said so, and where to look next.
  assert.match(remedy, /If handoff still fails on it/);
  assert.match(remedy, /git log --oneline -- /);
  assert.doesNotMatch(remedy, /committed copy is the fetched one/);
});

// Found 2026-10-04 by an external review: a nested decision project (ADR-0030) has no .git of
// its own, and the remedy read `root/.git` alone - so it printed "no git metadata" and no
// checkout for a capture the enclosing repository restores like any other tracked file.
test('a nested decision project inside the repository gets the runnable remedy, which restores the capture', () => {
  requireGit('the altered-capture remedy in a nested project');
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const outer = tempDir('fp-outer-repo-');
  const nested = path.join(outer, 'docs', 'decisions', '2026-10-04-nested');
  makePassingProject(nested);
  for (const args of [fixtureInitArgs(), ['config', 'user.email', 't@t'], ['config', 'user.name', 't'],
    ['add', '-A'], fixtureCommitArgs('outer repository with a nested corpus')]) {
    assert.equal(git(outer, ...args).status, 0, `git ${args.join(' ')}`);
  }
  const capture = readCorpus(nested).captures.entries[0];
  corrupt(nested, capture.file, (text) => `${text}\nrewritten by hand\n`);

  const before = verifyHandoff(nested);
  assert.equal(before.altered.length, 1);
  const remedy = handoffRemedy(before);
  assert.doesNotMatch(remedy, /no git metadata/, 'the enclosing repository is git metadata');
  assert.match(remedy, /git checkout HEAD -- /);
  // Run from the project folder, as an operator would: pathspecs are relative to the cwd.
  for (const line of remedy.split('\n').map((l) => l.trim())) {
    if (line.startsWith('git checkout HEAD')) assert.equal(git(nested, ...line.split(/\s+/).slice(1)).status, 0, line);
  }
  assert.equal(verifyHandoff(nested).ok, true, 'the committed copy restored the nested capture');
});

// Found 2026-10-04 by the second external review: a walk up for a `.git` entry walked past a
// bare repository the project sat inside, and printed a checkout git refused with "this
// operation must be run in a work tree". The question is git's, so git is asked.
test('a project inside a bare repository is not given a checkout git would refuse', () => {
  requireGit('asking git whether the project is in a work tree');
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const outer = tempDir('fp-bare-outer-');
  assert.equal(git(outer, ...fixtureInitArgs()).status, 0);
  const bare = path.join(outer, 'bare.git');
  assert.equal(git(outer, ...fixtureInitArgs('--bare', bare)).status, 0, 'git init --bare');
  const project = path.join(bare, 'corpus');
  makePassingProject(project);
  const capture = readCorpus(project).captures.entries[0];
  corrupt(project, capture.file, (text) => `${text}\nrewritten by hand\n`);

  assert.equal(insideRepository(project), false, 'git itself says this is not a work tree');
  const remedy = handoffRemedy(verifyHandoff(project));
  assert.match(remedy, /no git metadata|git refused to read this folder's repository/,
    'an older Git may see no work tree, while newer Git can refuse the nested bare repository');
  assert.doesNotMatch(remedy, /git checkout/);
  // The enclosing work tree, asked the same way, is one.
  assert.equal(insideRepository(outer), true);
});

test('without git on PATH the answer falls back to a .git entry above, stopping at a ceiling', () => {
  const noGit = () => ({ error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) });
  const outer = tempDir('fp-nogit-outer-');
  fs.mkdirSync(path.join(outer, '.git'));
  const nested = path.join(outer, 'docs', 'decisions', 'x');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(insideRepository(nested, { run: noGit }), true, 'a .git folder above counts');
  assert.equal(outsideAnyRepository(outer, () => insideRepository(nested, { run: noGit })), true, 'the ceiling is above the .git, so it still counts');
  assert.equal(outsideAnyRepository(path.join(outer, 'docs'), () => insideRepository(nested, { run: noGit })), false, 'a ceiling below the .git stops the walk');
});

// Found 2026-10-04 by the third external review: the fallback walked the LEXICAL parents of a
// junction, so a project reached through a link into a repository read as outside it, and one
// linked out of a repository read as inside; and it turned relative ceiling entries, which git
// ignores, into ceilings.
test('without git the fallback walks the physical path, and ignores a relative ceiling as git does', () => {
  const noGit = () => ({ error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) });
  const repo = tempDir('fp-phys-repo-');
  fs.mkdirSync(path.join(repo, '.git'));
  const inside = path.join(repo, 'docs', 'project');
  fs.mkdirSync(inside, { recursive: true });
  const elsewhere = tempDir('fp-phys-elsewhere-');
  const outsideTarget = path.join(elsewhere, 'project');
  fs.mkdirSync(outsideTarget);

  // A link OUTSIDE the repository pointing INTO it: physically inside, so a repository.
  const linkIn = path.join(elsewhere, 'link-in');
  fs.symlinkSync(inside, linkIn, 'junction');   // a junction on Windows, a symlink elsewhere; no privilege needed
  assert.equal(insideRepository(linkIn, { run: noGit }), true, 'the physical ancestry holds the .git');
  // A link INSIDE the repository pointing OUT of it: physically outside, so not one.
  const linkOut = path.join(repo, 'link-out');
  fs.symlinkSync(outsideTarget, linkOut, 'junction');
  assert.equal(outsideAnyRepository(elsewhere, () => insideRepository(linkOut, { run: noGit })), false, 'the lexical parent is not where git looks');

  // A relative ceiling entry is ignored, as git ignores it: the .git above still counts.
  const saved = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = 'docs';
  try { assert.equal(insideRepository(inside, { run: noGit }), true); } finally {
    if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = saved;
  }
});

// Found 2026-10-04 by the third external review: the safety check ran over the five names the
// text lists, so an unsafe SIXTH file got no note and "handle the remaining files the same
// way, each by name" - an instruction to type the glob that restores a neighbour.
test('an unsafe name beyond the fifth is still noted, and only safe names are "the same way"', () => {
  const safe = ['a', 'b', 'c', 'd', 'e'].map((n) => `research/raw/${n}.md`);
  const sixth = alteredRemedy([...safe, 'research/raw/topic[12].md'], { isRepo: true });
  assert.match(sixth, /Not printed as a command.*research\/raw\/topic\[12\]\.md/, 'the sixth, unsafe name is noted');
  assert.doesNotMatch(sixth, /the same way/, 'nothing safe is left over to do "the same way"');
  const seven = alteredRemedy([...safe, 'research/raw/f.md', 'research/raw/g.md'], { isRepo: true });
  assert.match(seven, /remaining 2 .*the same way/, 'the safe names past the fifth are the ones done the same way');
  assert.doesNotMatch(seven, /Not printed as a command/);
  // The line-ending remedy's past-five block is the folder-wide checkout behind its status
  // precondition (ADR-0062), which types no name; the unsafe sixth is still noted.
  assert.match(lineEndingRemedy([...safe, 'research/raw/topic[12].md'], { isRepo: true }), /Not printed as a command.*topic\[12\]/);
  assert.doesNotMatch(lineEndingRemedy([...safe, 'research/raw/f.md'], { isRepo: true }), /Not printed as a command/);
});

// Judged by running it: the names-file commands restore exactly the unsafe-named capture and
// leave a neighbour that the name, read as a pattern or by a shell, would have matched.
test('the names-file commands, run as printed, restore only the file named in the file', () => {
  requireGit('the names-file commands');
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const dir = tempDir('fp-names-file-');
  fs.mkdirSync(path.join(dir, 'research', 'raw'), { recursive: true });
  const capture = 'research/raw/topic $copy[1].md';     // a glob, and a PowerShell variable
  const neighbour = 'research/raw/topic $copy1.md';     // what the glob matches
  fs.writeFileSync(path.join(dir, capture), 'fetched\n');
  fs.writeFileSync(path.join(dir, neighbour), 'neighbour\n');
  // core.autocrlf=false: a project pins LF through .gitattributes; this bare fixture has none,
  // and the Windows runner's default autocrlf=true rewrote the restored bytes to CRLF (CI,
  // 2026-10-04). The question here is WHICH file the checkout touched, not its line endings.
  for (const args of [fixtureInitArgs(), ['config', 'user.email', 't@t'], ['config', 'user.name', 't'], ['config', 'core.autocrlf', 'false'], ['add', '-A'], fixtureCommitArgs('corpus')]) {
    assert.equal(git(dir, ...args).status, 0, `git ${args.join(' ')}`);
  }
  fs.writeFileSync(path.join(dir, capture), 'fetched\naltered\n');
  fs.writeFileSync(path.join(dir, neighbour), 'neighbour\nuncommitted work\n');

  const remedy = alteredRemedy([capture], { isRepo: true });
  fs.writeFileSync(path.join(dir, NAMES_FILE), `${capture}\n`);
  // The restore commands are the ones that read the names file; the committed-case paragraph
  // also prints a folder-wide `git log`, which types no name either.
  const commands = remedy.split('\n').filter((l) => /^ {4}git /.test(l)).map((l) => l.trim());
  assert.ok(commands.every((l) => !l.includes('$copy')), `a command types the name:\n${remedy}`);
  const restores = commands.filter((l) => l.includes('--pathspec-from-file'));
  assert.deepEqual(restores, [`git --literal-pathspecs checkout HEAD --pathspec-from-file=${NAMES_FILE}`]);
  for (const line of restores) {
    const r = git(dir, ...line.split(/\s+/).slice(1));
    assert.equal(r.status, 0, `${line}\n${r.stderr}`);
  }
  assert.equal(fs.readFileSync(path.join(dir, capture), 'utf8'), 'fetched\n', 'the named capture was restored');
  assert.equal(fs.readFileSync(path.join(dir, neighbour), 'utf8'), 'neighbour\nuncommitted work\n', 'the neighbour the glob matches kept its work');
});

// Found 2026-10-04 by the third external review: git refusing to READ a repository that is
// there (`fatal: detected dubious ownership`) was explained as "no git metadata", and the
// operator sent to copy the corpus from another machine - which fixes nothing here.
test('a git refusal is explained as a refusal, not as absent metadata', () => {
  const refusing = () => ({ status: 128, stdout: '', stderr: "fatal: detected dubious ownership in repository at 'C:/corpus'\nTo add an exception run: git config --global --add safe.directory C:/corpus\n" });
  const state = repositoryState('/any/where', { run: refusing });
  assert.equal(state.inside, false);
  assert.match(state.refused, /dubious ownership/);
  for (const remedy of [alteredRemedy(['research/raw/a.md'], { isRepo: false, refused: state.refused }), lineEndingRemedy(['research/raw/a.md'], { isRepo: false, refused: state.refused })]) {
    assert.match(remedy, /git refused to read this folder's repository: fatal: detected dubious ownership/);
    assert.doesNotMatch(remedy, /no git metadata/);
    assert.doesNotMatch(remedy, /re-copy this corpus|re-fetch or re-copy/);
    assert.doesNotMatch(remedy, /^ {4}git /m, 'no command is printed');
  }
  // Not a repository at all is still that, in git's words or in a clean exit.
  const notARepo = () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' });
  assert.deepEqual(repositoryState('/any/where', { run: notARepo }), { inside: false, refused: null });
  const bare = () => ({ status: 128, stdout: '', stderr: 'fatal: this operation must be run in a work tree\n' });
  assert.deepEqual(repositoryState('/any/where', { run: bare }), { inside: false, refused: null });
  // A spawn that failed for a reason other than "no git" is a refusal with that reason.
  const eacces = () => ({ error: Object.assign(new Error('spawn git EACCES'), { code: 'EACCES' }), status: null, stdout: '', stderr: '' });
  assert.match(repositoryState('/any/where', { run: eacces }).refused, /EACCES/);
});

test('a report holding both causes prints both remedies', () => {
  const dir = makePassingProject();
  const capture = readCorpus(dir).captures.entries[0];
  corrupt(dir, capture.file, (text) => text.replace(/\n/g, '\r\n'));
  corrupt(dir, PATHS.evidence, (text) => `${text}| E-02 | 2026-01-01 | P | https://x.invalid/gone | a claim | research/raw/gone.md |\n`);

  const remedy = handoffRemedy(verifyHandoff(dir));
  assert.match(remedy, /git add -f research\/raw\//, 'the push remedy, for what did not travel');
  assert.match(remedy, /rewrote it on checkout/, 'and the line-ending remedy, for what this machine changed');
});

test('the remedy texts are the module\'s, so neither consumer can drift', () => {
  assert.match(HANDOFF_REMEDY, /COLLECTOR machine/);
  assert.match(lineEndingRemedy(['research/raw/a.md']), /research\/raw\/a\.md/);
});

// Discussion #413: handoff answers whether the corpus arrived intact, not whether its pages
// still say the same thing, and a builder cannot fetch to find out. So the report says how
// old the captures are, dated as freshness dates them - by the capture, which the ledger's
// hash covers, not by the table's editable Retrieved cell (ADR-0187).
function datedProject(first, second, { url = 'https://example.invalid/docs/pricing' } = {}) {
  const dir = makePassingProject(tempDir('fp-handoff-dated-'), { date: first });
  const entry = writeRaw(dir, {
    url, title: 'Pricing', cmd: `firecrawl scrape ${url} --only-main-content --json`, statusCode: 200,
    transport: 'firecrawl-cli', completeness: 'full',
    markdown: `# Pricing\n\n${'The paid plan costs 20 dollars a month and allows 600 requests per minute. '.repeat(30)}`,
  }, { date: second });
  appendFetch(dir, {
    op: 'scrape', url, type: 'P', raw: entry.file,
    bodySha256: crypto.createHash('sha256').update(fs.readFileSync(resolve(dir, entry.file))).digest('hex'),
    transport: 'firecrawl-cli', completeness: 'full', cmd: entry.command, at: `${second}T00:00:00.000Z`,
  });
  fs.appendFileSync(resolve(dir, PATHS.evidence), `| E-02 | ${second} | P | ${url} | The paid plan costs 20 dollars a month. | ${entry.file} |\n`);
  return dir;
}

test('the handoff report gives the days its captures were fetched and the oldest one\'s age', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  const report = verifyHandoff(datedProject('2026-09-13', '2026-10-02'), { now });
  assert.equal(report.ok, true, report.findings.map((f) => f.detail).join('; '));
  assert.equal(report.rows, 2);
  assert.deepEqual(report.fetched, { from: '2026-09-13', to: '2026-10-02', oldestDays: 37 });
});

test('the fetch dates are the captures\', not the table\'s editable Retrieved cells', () => {
  const dir = datedProject('2026-09-13', '2026-10-02');
  // Editing the oldest row's cell to a recent day must not make the snapshot look younger:
  // the capture on disk still says 2026-09-13 (the same rule as freshnessDate, G8).
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^\| E-01 \| 2026-09-13 \|/m, '| E-01 | 2026-10-19 |'));
  assert.match(fs.readFileSync(resolve(dir, PATHS.evidence), 'utf8'), /^\| E-01 \| 2026-10-19 \|/m, 'the fixture did not edit the cell');
  const report = verifyHandoff(dir, { now: new Date('2026-10-20T12:00:00.000Z') });
  assert.deepEqual(report.fetched, { from: '2026-09-13', to: '2026-10-02', oldestDays: 37 });
});

// Found 2026-10-20 (review): every row counted, so a page the collector re-checked kept its
// first fetch's age - ADR-0026 keeps the superseded row as history - and the line could not
// tell a re-checked snapshot from a stale one.
test('a row a later capture superseded is history, not the snapshot\'s age', () => {
  const dir = datedProject('2026-09-13', '2026-10-19', { url: 'https://example.invalid/docs/limits' });
  const report = verifyHandoff(dir, { now: new Date('2026-10-20T12:00:00.000Z') });
  assert.equal(report.ok, true, report.findings.map((f) => f.detail).join('; '));
  assert.equal(report.rows, 2, 'the superseded row is still counted as a row');
  assert.deepEqual(report.fetched, { from: '2026-10-19', to: '2026-10-19', oldestDays: 1 });
});

// ADR-0193, plan v0.4 §7.4: a superseded row whose quoted words survived the refresh is still
// superseded - the newer capture is the current reading - so its first fetch is not the
// snapshot's age, as it was not when the citation reopened.
test('a superseded row whose quote survived the refresh is still history, not the snapshot\'s age', () => {
  const sentence = 'The free plan allows 10 requests per minute and includes 1,000 credits.';
  const dir = makePassingProject(tempDir('fp-handoff-recheck-'), { date: '2026-09-13' });
  corrupt(dir, PATHS.evidence, (text) => text.replace(`| ${sentence} |`, `| ${sentence} [quote: ${sentence}] |`));
  const result = collectOne(dir, 'https://example.invalid/docs/limits', {
    runScrape: (url) => ({ ok: true, url, title: 'Limits', markdown: `# Limits

${`${sentence} `.repeat(30)}`, statusCode: 200,
      transport: 'firecrawl-cli', cmd: `stub scrape ${url}`, completeness: 'full', omitted: '' }),
    corpus: readCorpus(dir), force: true, type: 'P', transportName: 'firecrawl-cli', date: '2026-10-19', maxRateLimitRetries: 0, sleep: () => {},
  });
  assert.equal(result.status, 'collected', `the refresh was not collected: ${result.reason}`);
  const state = runCheck('evidence-supersession', readCorpus(dir)).filter((f) => f.row === 'U-1').map((f) => [f.rule, f.superseded, f.by]);
  assert.deepEqual(state, [['quote-survived-refresh', 'E-01', 'E-02']], `the fixture is not the quote-survived state: ${JSON.stringify(state)}`);
  const report = verifyHandoff(dir, { now: new Date('2026-10-20T12:00:00.000Z') });
  assert.equal(report.rows, 2, 'the superseded row is still counted as a row');
  assert.deepEqual(report.fetched, { from: '2026-10-19', to: '2026-10-19', oldestDays: 1 });
});

// The Raw cell of E-01 blanked and its Retrieved cell set to `cell`.
function unnamedCapture(dir, cell) {
  corrupt(dir, PATHS.evidence, (text) => text.replace(/^(\| E-01 \| )2026-09-13( \|.*\| )\S+( \|)$/m, `$1${cell}$2$3`));
  assert.match(fs.readFileSync(resolve(dir, PATHS.evidence), 'utf8'), new RegExp(`^\\| E-01 \\| ${cell} \\|.*\\|  \\|$`, 'm'), 'the fixture did not blank the Raw cell');
  return dir;
}

// A row whose Raw cell names no capture is dated by its cell, as stale-evidence dates it: the
// URL's latest capture may be a later fetch the row never read (G8). The docs say so.
test('a row whose Raw cell names no capture is dated by its Retrieved cell, as freshness is', () => {
  const dir = unnamedCapture(datedProject('2026-09-13', '2026-10-02'), '2026-09-20');
  const report = verifyHandoff(dir, { now: new Date('2026-10-20T12:00:00.000Z') });
  assert.equal(report.ok, true, report.findings.map((f) => f.detail).join('; '));
  assert.deepEqual(report.fetched, { from: '2026-09-20', to: '2026-10-02', oldestDays: 30 });
});

// Found 2026-10-20 (review): `2026-00-13` is shaped like a date and is not one, and the OK line
// printed "(oldest null days)".
test('a day that does not parse is left out of the fetch dates, never printed as null', () => {
  const dir = unnamedCapture(datedProject('2026-09-13', '2026-10-02'), '2026-00-13');
  const report = verifyHandoff(dir, { now: new Date('2026-10-20T12:00:00.000Z') });
  assert.deepEqual(report.fetched, { from: '2026-10-02', to: '2026-10-02', oldestDays: 18 });
});

// Found 2026-10-20 (review): a collector's clock ahead of the builder's across UTC midnight
// printed "(oldest -1 days)". hygiene allows the same day of slack (future-date).
test('a capture dated after the asking machine\'s clock is 0 days old, not -1', () => {
  const dir = makePassingProject(tempDir('fp-handoff-ahead-'), { date: '2026-10-21' });
  const report = verifyHandoff(dir, { now: new Date('2026-10-20T12:00:00.000Z') });
  assert.deepEqual(report.fetched, { from: '2026-10-21', to: '2026-10-21', oldestDays: 0 });
});

test('a table with no rows has no fetch dates, and the report says null rather than a guess', () => {
  const dir = makePassingProject();
  corrupt(dir, PATHS.evidence, (text) => text.split('\n').filter((line) => !line.startsWith('| E-')).join('\n'));
  const report = verifyHandoff(dir);
  assert.equal(report.rows, 0);
  assert.equal(report.fetched, null);
});

// Discussion #413: can the next agent tell a current citation from a consistent but stale
// snapshot? Pinned end to end, offline: one page is collected, an unknown closed on it, and
// then the page changes. On the builder the handoff still says OK and the gate still passes -
// the corpus is intact, and a builder cannot fetch to learn more - but the OK line says how
// old the snapshot is (ADR-0187). Currency is the collector's: a same-day `--refresh-days 0`
// re-collects nothing, `--force` captures the new text, and the gate blocks the old citation
// until it moves, keeping the old row (ADR-0026). The server lives in its own process:
// `scrape` runs its child with spawnSync, which blocks this process's event loop. It exits when
// its stdin closes, so a suite killed from outside (the gate's budget) leaves no server behind.
test('a page that changes after collection: the handoff stays OK and dated, the collector\'s re-fetch blocks the stale citation', async () => {
  const { spawn } = await import('node:child_process');
  const work = tempDir('fp-handoff-changed-');
  const page = path.join(work, 'page.html');
  const say = (limit) => writeText(page, `<html><head><title>Limits</title></head><body><h1>Rate limits</h1><p>The free plan allows ${limit} requests per minute. ${'Every request counts against the same minute window, and a burst above it is refused. '.repeat(4)}</p></body></html>`);
  say(10);
  const serverFile = path.join(work, 'server.mjs');
  writeText(serverFile, `
import http from 'node:http';
import fs from 'node:fs';
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(fs.readFileSync(${JSON.stringify(page)}, 'utf8'));
}).listen(0, '127.0.0.1', function () { process.stdout.write('PORT ' + this.address().port + '\\n'); });
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
`);
  const proc = spawn(process.execPath, [serverFile], { cwd: work, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  try {
    const port = await new Promise((done, fail) => {
      let out = '';
      proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) done(Number(m[1])); });
      proc.on('exit', (code) => fail(new Error(`the page server exited ${code}`)));
    });

    // Two machines, each with its own temp config and kit home; never this machine's.
    const base = Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].includes(name) && !name.startsWith('FETCHPROOF_')));
    const machine = (role) => {
      const config = path.join(work, `${role}.json`);
      writeText(config, JSON.stringify({ role }));
      return { ...base, FETCHPROOF_CONFIG: config, FETCHPROOF_HOME: path.join(work, `${role}-home`, 'fetchproof') };
    };
    const collector = machine('collector');
    const builder = machine('builder');
    const dir = path.join(work, 'project');
    fs.mkdirSync(dir);
    const kit = (env, bin, ...args) => {
      const r = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', bin), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
      return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    };
    const evidence = () => readCorpus(dir).evidence;

    let r = kit(collector, 'new-project.mjs', '.', '--topic', 'What is the free plan\'s rate limit?');
    assert.equal(r.status, 0, r.out);
    const planFile = resolve(dir, PATHS.plan);
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    // A loopback URL named directly is collected; only a redirect to one is refused (ADR-0110).
    plan.urls = [{ url: `http://127.0.0.1:${port}/page`, type: 'P', why: 'U-01' }];
    writeText(planFile, JSON.stringify(plan, null, 2));

    r = kit(collector, 'research.mjs', '--transport', 'http-keyless');
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(evidence().map((row) => row.id), ['E-01'], r.out);
    const first = evidence()[0];
    assert.match(fs.readFileSync(resolve(dir, first.raw), 'utf8'), /10 requests per minute/);

    const cite = (id) => {
      const file = resolve(dir, PATHS.discovery);
      const text = fs.readFileSync(file, 'utf8').replace(/^\| U-01 \|.*\n/m, '');
      writeText(file, text.replace(/^(\| ID \| Unknown \|.*\n\|[-| ]+\|\n)/m,
        `$1| U-01 | What is the free plan's rate limit? | Decides the client's throttle | CLOSED | ${id}: the free plan's limit per minute |\n`));
    };
    cite('E-01');
    r = kit(collector, 'preflight.mjs');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^PASS /m, r.out);
    r = kit(collector, 'brief.mjs');
    assert.equal(r.status, 0, r.out);

    // The live page changes. Nothing in the corpus has.
    say(2);

    // On the builder: intact, consistent, and stale. handoff and the gate both pass - the
    // documented limit - and the line says when the captures were fetched (today, in UTC, or
    // yesterday if the run crossed midnight).
    r = kit(builder, 'handoff.mjs');
    assert.equal(r.status, 0, r.out);
    const day = first.retrieved;
    assert.match(r.out, new RegExp(`^handoff OK - .*chain verifies; captures fetched ${day}\\.\\.${day} \\(oldest (?:0 days|1 day)\\)\\.  \\[role=builder\\]$`, 'm'), r.out);
    r = kit(builder, 'preflight.mjs');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^PASS /m, r.out);

    // On the collector: a capture made today is not older than 0 days, so nothing is fetched.
    // Past UTC midnight it is a day old, and this same-day rule is not what the run can show.
    if (today() !== day) throw new Unsupported('CROSSED_MIDNIGHT', `the run crossed UTC midnight after collecting on ${day}, so the same-day refresh rule cannot be checked`);
    r = kit(collector, 'research.mjs', '--transport', 'http-keyless', '--refresh-days', '0');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^collected\s+0$/m, r.out);
    assert.equal(evidence().length, 1);

    // --force fetches the page as it reads now, beside the old capture.
    r = kit(collector, 'research.mjs', '--transport', 'http-keyless', '--force');
    assert.equal(r.status, 0, r.out);
    const rows = evidence();
    assert.deepEqual(rows.map((row) => row.id), ['E-01', 'E-02'], r.out);
    assert.match(fs.readFileSync(resolve(dir, rows[1].raw), 'utf8'), /2 requests per minute/);

    // The gate blocks the claim that still cites the superseded capture, and the brief drafted
    // over the old corpus is no longer current.
    r = kit(collector, 'preflight.mjs');
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^FAIL /m, r.out);
    assert.match(r.out, /cites-superseded-row.*E-01.*E-02/, r.out);
    assert.match(r.out, /brief-stale/, r.out);

    // The citation moves to the new capture: the gate passes, and the old row stays.
    cite('E-02');
    r = kit(collector, 'preflight.mjs');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^PASS /m, r.out);
    assert.deepEqual(evidence().map((row) => row.id), ['E-01', 'E-02'], 'history is kept');
    assert.ok(fs.existsSync(resolve(dir, first.raw)), 'the old capture is still on disk');
  } finally {
    proc.kill();
  }
});

test('verifyHandoff is read-only: it never repairs, and never writes the corpus', () => {
  const dir = makePassingProject();
  fs.rmSync(resolve(dir, PATHS.ledger));
  const before = fs.readdirSync(resolve(dir, PATHS.raw)).sort();
  verifyHandoff(dir);
  assert.equal(fs.existsSync(resolve(dir, PATHS.ledger)), false, 'the machine that asks cannot collect the missing bytes');
  assert.deepEqual(fs.readdirSync(resolve(dir, PATHS.raw)).sort(), before);
});

test('one composition, two consumers: doctor passes the corpus it already read', () => {
  const dir = makePassingProject();
  fs.rmSync(resolve(dir, PATHS.ledger));
  const corpus = readCorpus(dir);
  const direct = verifyHandoff(dir, { corpus });
  const second = verifyHandoff(dir, { corpus });
  assert.deepEqual(names(direct), names(second), 'the question has one implementation and one answer');
});

test('doctor makes handoff a BLOCKER on a builder and silent on a collector', () => {
  const dir = makePassingProject();
  fs.rmSync(resolve(dir, PATHS.ledger));

  const configDir = tempDir('fetchproof-role-');
  const builderConfig = path.join(configDir, 'builder.json');
  writeText(builderConfig, JSON.stringify({ role: 'builder' }));
  const collectorConfig = path.join(configDir, 'collector.json');
  writeText(collectorConfig, JSON.stringify({ role: 'collector' }));

  const probe = () => ({ installed: false, authenticated: false, version: null, credits: null });

  const builder = runDoctor(dir, { env: { ...process.env, FETCHPROOF_CONFIG: builderConfig }, probe, record: false });
  assert.ok(builder.blocking.some((f) => f.name.startsWith('handoff-')), 'a builder is held to the arrival question');
  assert.ok(builder.findings.some((f) => f.name === 'handoff-remedy'));

  const collector = runDoctor(dir, { env: { ...process.env, FETCHPROOF_CONFIG: collectorConfig }, probe, record: false });
  assert.equal(collector.blocking.some((f) => f.name.startsWith('handoff-')), false,
    "a collector's existing reporters already own the same states");
});

// Found 2026-09-27: the printed line-ending remedy, run verbatim after a real
// core.autocrlf=true checkout, left every capture CRLF and handoff still failed.
// `git add --renormalize` fixes the INDEX, and git will not rewrite a working file it
// believes is unchanged, so the bytes handoff reads never changed. The remedy is judged
// here by running it.
test('the line-ending remedy, run as printed, makes a CRLF checkout pass', () => {
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  // requireGit, not a local probe. The probe ran with `cwd: os.tmpdir()`, so on a host
  // whose TMPDIR cannot be used the SPAWN failed and the run reported
  // "no-git: git is not installed" - a false claim about the machine, printed in the
  // one place somebody reads to find out why the suite is red (found 2026-09-28).
  requireGit('the line-ending remedy');
  const dir = makePassingProject();
  fs.rmSync(path.join(dir, '.gitattributes'), { force: true });
  for (const args of [fixtureInitArgs(), ['config', 'user.email', 't@t'], ['config', 'user.name', 't'],
    ['add', '-A'], fixtureCommitArgs('corpus')]) {
    assert.equal(git(dir, ...args).status, 0, `git ${args.join(' ')}`);
  }
  git(dir, 'config', 'core.autocrlf', 'true');
  fs.rmSync(path.join(dir, 'research', 'raw'), { recursive: true });
  git(dir, 'checkout', '-q', '--', 'research/raw');
  const before = verifyHandoff(dir);
  assert.ok(before.lineEndings.length, 'the checkout did not produce CRLF captures');

  const remedy = handoffRemedy(before);
  // The pin is given as lines to add to .gitattributes, in any editor; the test adds them.
  const pins = remedy.split('\n').map((l) => l.trim()).filter((l) => PIN_LINES.includes(l));
  if (pins.length) fs.appendFileSync(path.join(dir, '.gitattributes'), `${pins.join('\n')}\n`);
  for (const line of remedy.split('\n').map((l) => l.trim())) {
    if (line.startsWith('git ') && !line.startsWith('git status')) {
      const args = line.split(/\s+/).slice(1);
      const r = git(dir, ...args);
      assert.equal(r.status, 0, `${line}\n${r.stderr}`);
    }
  }
  const after = verifyHandoff(dir);
  assert.equal(after.ok, true, `the remedy did not fix it:\n${remedy}\n${JSON.stringify(after.findings.map((f) => f.detail))}`);
});

test('the line-ending remedy does not append a pin that is already there', () => {
  const pinLine = /^\s+research\/raw\/\* text eol=lf$/m;
  assert.doesNotMatch(lineEndingRemedy(['research/raw/a.md'], { pinned: true }), pinLine);
  assert.match(lineEndingRemedy(['research/raw/a.md'], { pinned: false }), pinLine);
});

// Found 2026-09-27: the remedy is for a Windows checkout, and it used printf (in neither cmd
// nor PowerShell) and trailing "# ..." comments (file names to git, in cmd).
test('every command the line-ending remedy prints is a plain git command a Windows shell runs', () => {
  const files = ['research/raw/a.md', 'research/raw/b.md', 'research/raw/c.md', 'research/raw/d.md', 'research/raw/e.md', 'research/raw/f.md'];
  const remedy = lineEndingRemedy(files, { pinned: false });
  const commands = remedy.split('\n').filter((l) => /^ {4}\S/.test(l)).map((l) => l.trim());
  assert.ok(commands.length >= 4, remedy);
  for (const line of commands) {
    assert.match(line, /^git /, `not a git command: ${line}`);
    assert.doesNotMatch(line, /#/, `a trailing comment is a file name in cmd: ${line}`);
  }
  assert.doesNotMatch(remedy, /printf/);
});

// Found 2026-09-28, end-to-end run: the push remedy said `git add -f research/raw/`, and the
// commit gate's fix said `git add -f research/`. -f forces EVERY ignored file in, so run as
// printed they committed the machine-local byproducts the repository ignores on purpose
// (.usage.jsonl, .failures.jsonl, .diagnostics.jsonl, .fetches.lock) - the run's own corpus
// commit did, and repo-hygiene went red. Only the ledger needs forcing, where an ignore rule
// (a global one hiding dotfiles, say) would otherwise drop it. research/overrides.log is
// machine-local too (ADR-0081): the template's .gitignore un-ignored it until 2026-09-28.
function runPrinted(dir, text) {
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    for (const command of line.split('&&').map((c) => c.trim()).filter((c) => c.startsWith('git add'))) {
      const r = spawnSync('git', command.split(/\s+/).slice(1), { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, `${command}: ${r.stderr}`);
    }
  }
}

function collectorCheckout() {
  requireGit('running the printed corpus commands');
  const dir = makePassingProject();
  fs.copyFileSync(path.join(TEMPLATE_DIR, '.gitignore'), path.join(dir, '.gitignore'));
  spawnSync('git', fixtureInitArgs(), { cwd: dir });
  // A global-style rule that hides every dotfile: the case the ledger must survive.
  fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true });   // no template copied it (fixtureInitArgs)
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.*\n!.gitignore\n');
  for (const byproduct of ['.usage.jsonl', '.failures.jsonl', '.diagnostics.jsonl', '.fetches.lock']) {
    fs.writeFileSync(resolve(dir, `research/raw/${byproduct}`), '{}\n');
  }
  fs.writeFileSync(resolve(dir, PATHS.overrides), 'override\n');
  return dir;
}

function tracked(dir) {
  return spawnSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
}

for (const [label, printed] of [
  ['the handoff push remedy', () => HANDOFF_REMEDY],
  ['the commit gate\'s fix for an untracked corpus', (dir) => evaluate(dir, { gate: 'commit', stagedPaths: ['README.md'], record: false }).fix],
]) {
  test(`${label}, run as printed, tracks the ledger and no machine-local byproduct`, () => {
    const dir = collectorCheckout();
    runPrinted(dir, printed(dir));
    const files = tracked(dir);
    assert.ok(files.includes(PATHS.ledger), `the ledger was not added:\n${files.join('\n')}`);
    const leaked = files.filter((f) => /(^|\/)\.(usage|diagnostics|failures)\.jsonl$|\.fetches\.lock$|overrides\.log$/.test(f));
    assert.deepEqual(leaked, [], 'machine-local byproducts were committed');
  });
}
