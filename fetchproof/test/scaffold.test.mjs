// The canonical project shape has one owner (ADR-0001). These are the tests that would
// have caught the drift: 76 of 112 tests failing on a fresh checkout because the fixture
// invented a directory the template never carried.

import { spawnSync } from 'node:child_process';
import { test, describe, assert, makeProject, tempDir, fs, path, KIT_ROOT, requireCapability } from './harness.mjs';
import { PATHS, resolve, readText, writeText } from '../lib/core.mjs';
import {
  LAYOUT, GATE_MARKERS, HOOK_MODE, hookExecutability, scaffoldProject, createEmptyProject,
  validateProject, renderTemplate, unresolvedPlaceholders, templateFiles, TEMPLATE_DIR, missingKitLines,
} from '../lib/scaffold.mjs';
import { isGated } from '../lib/gate.mjs';

describe('scaffold');

test('LAYOUT holds twelve entries and is the one definition of shape', () => {
  assert.equal(LAYOUT.length, 12);
  assert.equal(new Set(LAYOUT.map((e) => e.path)).size, 12, 'no entry is declared twice');
});

test('the gate markers DERIVE from LAYOUT rather than keeping their own list', () => {
  assert.deepEqual([...GATE_MARKERS], LAYOUT.filter((e) => e.gating).map((e) => e.path));
  assert.equal(GATE_MARKERS.length, 4);
});

test('.gitattributes is a LAYOUT entry but NOT a gate marker', () => {
  assert.ok(LAYOUT.some((e) => e.path === PATHS.gitattributes));
  assert.equal(GATE_MARKERS.includes(PATHS.gitattributes), false,
    'a project without it still gates - it just breaks on a Windows builder');
});

test('kit.json and the architecture map travel with the scaffold, and neither gates', () => {
  for (const entry of [PATHS.kit, PATHS.architecture]) {
    assert.ok(LAYOUT.some((e) => e.path === entry), `${entry} is missing from LAYOUT`);
    assert.equal(GATE_MARKERS.includes(entry), false);
  }
});

test('the fixture and the scaffolder are the same call', () => {
  const empty = createEmptyProject(tempDir());
  for (const entry of LAYOUT) {
    const abs = resolve(empty, entry.path);
    assert.ok(fs.existsSync(abs), `createEmptyProject did not produce ${entry.path}`);
  }
  assert.ok(fs.existsSync(path.join(empty, 'research', 'raw')), 'research/raw/ is real, not invented by a fixture');
});

test('scaffoldProject renders every template file with no placeholder left behind', () => {
  const dir = scaffoldProject(tempDir(), { topic: 'Widget pricing', kit: '~/.agents/fetchproof' }).dir;
  for (const rel of templateFiles()) {
    const text = readText(resolve(dir, rel));
    assert.notEqual(text, null, `${rel} was not written`);
    assert.deepEqual(unresolvedPlaceholders(text), [], `${rel} still holds a placeholder`);
  }
  assert.match(readText(resolve(dir, PATHS.discovery)), /Widget pricing/);
});

// Found 2026-09-27 reading a real returned package: START_HERE.md said
// "node ~/.agents/fetchproof\bin\doctor.mjs". In bash each \b is an escaped b, so it ran
// ".../fetchproofbindoctor.mjs" - MODULE_NOT_FOUND - and every other template file already
// wrote /bin/. Scaffolded with this kit's own path, every command a project's documents give
// must name a file that exists, read exactly as written.
test('every node command in a scaffolded project names a kit file that exists', () => {
  const dir = scaffoldProject(tempDir(), { topic: 'Anything', kit: KIT_ROOT }).dir;
  const commands = [];
  for (const rel of templateFiles().filter((f) => f.endsWith('.md'))) {
    for (const [, file] of readText(resolve(dir, rel)).matchAll(/\bnode\s+("[^"]+"|\S+\.mjs)/g)) {
      commands.push({ rel, file: file.replace(/^"|"$/g, '') });
    }
  }
  assert.ok(commands.some((c) => c.rel === 'START_HERE.md'), 'START_HERE.md gives no command - this test is vacuous');
  for (const { rel, file } of commands) {
    assert.ok(fs.existsSync(file), `${rel} tells its reader to run "node ${file}", which does not exist`);
  }
});

// docs/decisions/2026-09-27-kit-path-spelling. A project that travels spells the kit
// $HOME/.agents/fetchproof, and every command double-quotes its path. That reaches node as one
// absolute path in every PowerShell (U-2) and in bash and zsh (U-3), with a space in the home
// folder. The bare ~ it replaced reaches node literally in Windows PowerShell 5.1, 7.4 and 7.5
// (U-1), and a quoted ~ is never expanded (U-3).
const TRAVELLING_KIT = '$HOME/.agents/fetchproof';
const SH = ['sh', '/bin/sh'].find((candidate) => spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok') ?? null;

// What node receives when a reader types "node <arg>": through Windows PowerShell 5.1 on Windows,
// the shell Windows ships, and through sh elsewhere. The home folder is the one given.
function argumentNodeReceives(arg, home) {
  // No quote characters inside: Windows PowerShell 5.1 rewrites embedded double quotes in an
  // argument to a native command, and the probe must not be the thing that breaks.
  const echo = 'process.stdout.write(String(process.argv[1]))';
  if (process.platform === 'win32') {
    const script = `& '${process.execPath}' -e '${echo}' ${arg}`;
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', env: { ...process.env, USERPROFILE: home, HOME: home } }).stdout ?? '';
  }
  requireCapability(SH, 'SHELL-NOT-FOUND', 'no POSIX sh on this host');
  return spawnSync(SH, ['-c', `"${process.execPath}" -e '${echo}' ${arg}`], { encoding: 'utf8', env: { ...process.env, HOME: home } }).stdout ?? '';
}

test('a travelling project\'s commands reach node whole, from a home folder with a space', () => {
  const dir = scaffoldProject(tempDir(), { topic: 'Anything', kit: TRAVELLING_KIT }).dir;
  const home = path.join(tempDir('fp-home-'), 'a home with space');
  fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
  fs.symlinkSync(KIT_ROOT, path.join(home, '.agents', 'fetchproof'), 'junction');
  const commands = [];
  for (const rel of templateFiles().filter((file) => file.endsWith('.md'))) {
    for (const [, arg] of readText(resolve(dir, rel)).matchAll(/\bnode\s+("[^"]+"|\S+?\.mjs)/g)) commands.push({ rel, arg });
  }
  assert.ok(commands.length >= 10, `only ${commands.length} commands found - this test is looking in the wrong place`);
  for (const { rel, arg } of commands) {
    const received = argumentNodeReceives(arg, home);
    assert.ok(received && fs.existsSync(received), `${rel}: "node ${arg}" hands node ${JSON.stringify(received)}, which is not a file`);
  }
});

// U-1 cannot be exercised on a host without Windows PowerShell, so it is held here as text: no
// document that tells a reader to run the kit may spell it with a bare ~.
test('no document that runs the kit spells it with a bare ~', () => {
  const docs = [
    ...templateFiles().filter((file) => file.endsWith('.md')).map((file) => path.join(TEMPLATE_DIR, file)),
    path.join(KIT_ROOT, 'START_HERE.md'),
    path.join(KIT_ROOT, 'skill', 'SKILL.md'),
  ];
  for (const file of docs) {
    assert.doesNotMatch(readText(file), /\bnode\s+"?~\//, `${path.relative(KIT_ROOT, file)} tells its reader to run node ~/..., which Windows PowerShell 5.1 hands to node unexpanded`);
  }
  const workflow = readText(path.join(KIT_ROOT, '..', '.github', 'workflows', 'collect.yml'));
  assert.match(workflow, /"--kit", "\$HOME\/\.agents\/fetchproof"/, 'the collector must scaffold packages with the $HOME spelling');
});

test('structure is always repaired; content is never clobbered without --force', () => {
  const dir = scaffoldProject(tempDir(), { topic: 'First' }).dir;
  writeText(resolve(dir, PATHS.evidence), '# my own evidence, irreplaceable\n');
  fs.rmSync(resolve(dir, PATHS.raw), { recursive: true });

  const again = scaffoldProject(dir, { topic: 'Second' });
  assert.match(readText(resolve(dir, PATHS.evidence)), /irreplaceable/, 'evidence is never overwritten by default');
  assert.ok(again.repaired.includes(PATHS.raw), 'a missing research/raw/ comes back on every run');
  assert.ok(fs.existsSync(resolve(dir, PATHS.raw)));

  scaffoldProject(dir, { topic: 'Third', force: true });
  assert.doesNotMatch(readText(resolve(dir, PATHS.evidence)), /irreplaceable/, '--force is the deliberate act');
});

test('a scaffolded project is gated, and shaped', () => {
  const dir = scaffoldProject(tempDir(), { topic: 'Anything' }).dir;
  assert.equal(isGated(dir), true);
  const shape = validateProject(dir);
  assert.equal(shape.ok, true, shape.findings.map((f) => f.detail).join('; '));
});

test('validateProject fails a missing gating artifact and an unresolved placeholder', () => {
  const dir = scaffoldProject(tempDir(), { topic: 'Anything' }).dir;
  fs.rmSync(resolve(dir, PATHS.plan));
  writeText(resolve(dir, PATHS.sources), '# Sources for {{TOPIC}}\n');

  const shape = validateProject(dir);
  assert.equal(shape.ok, false);
  assert.ok(shape.findings.some((f) => f.rule === 'shape-missing' && f.path === PATHS.plan));
  assert.ok(shape.findings.some((f) => f.rule === 'unresolved-placeholder' && f.detail.includes('{{TOPIC}}')));
});

test('validateProject never judges contract CONTENT - that stays preflight\'s job', () => {
  const dir = scaffoldProject(tempDir(), { topic: 'Anything' }).dir;
  assert.equal(validateProject(dir).ok, true, 'an empty contract is a shape that is fine and a verdict that is not');
});

test('renderTemplate leaves an unknown token alone rather than emptying it', () => {
  assert.equal(renderTemplate('a {{TOPIC}} b {{UNKNOWN}}', { TOPIC: 'x' }), 'a x b {{UNKNOWN}}');
});

test('the template ships .gitattributes, so a scaffolded project cannot be born without it', () => {
  assert.ok(templateFiles().includes('.gitattributes'));
  const text = readText(path.join(TEMPLATE_DIR, '.gitattributes'));
  assert.match(text, /research\/raw\/\* text eol=lf/);
  assert.match(text, /\*\.jsonl text eol=lf/);
});

test('the template .gitignore keeps the chain committed with an explicit negation', () => {
  const text = readText(path.join(TEMPLATE_DIR, '.gitignore'));
  assert.match(text, /!research\/raw\/\.fetches\.jsonl/, 'a broader dotfile rule must not silently exclude the chain');
  assert.match(text, /research\/raw\/\.usage\.jsonl/);
});

test('START_HERE.md is deployed and scaffolded, and is NOT a LAYOUT entry', () => {
  assert.ok(templateFiles().includes('START_HERE.md'));
  assert.ok(fs.existsSync(path.join(KIT_ROOT, 'START_HERE.md')), 'the kit root carries the operator\'s twin');
  assert.equal(LAYOUT.some((e) => e.path === 'START_HERE.md'), false, 'no rule needs it, so a project without it reports nothing');
});

test('the two START_HERE copies differ only in how the kit path is spelled', () => {
  const kitCopy = readText(path.join(KIT_ROOT, 'START_HERE.md'));
  const templateCopy = readText(path.join(TEMPLATE_DIR, 'START_HERE.md'));
  assert.equal(kitCopy, templateCopy.replace(/\{\{KIT\}\}/g, '$HOME/.agents/fetchproof'));
});

test('the deployed hook\'s mode is part of its contract', () => {
  assert.equal(HOOK_MODE, 0o755);
  const state = hookExecutability(path.join(KIT_ROOT, 'githooks', 'pre-commit'));
  assert.equal(state.ok, true, state.fix ?? state.reason);
  assert.equal(hookExecutability(path.join(tempDir(), 'absent')).reason, 'missing');
});

test('a placeholder in PROSE is a defect; one quoted in a code span is documentation', () => {
  assert.deepEqual(unresolvedPlaceholders('the kit lives at {{KIT}} and is installed once'), ['KIT']);
  assert.deepEqual(
    unresolvedPlaceholders('the two copies differ only in how the path is spelled (`~/.agents/fetchproof` vs `{{KIT}}`)'),
    [],
    'a document explaining the token is not a document that failed to render it',
  );
  assert.deepEqual(unresolvedPlaceholders('`{{KIT}}` is the token, and {{TOPIC}} was never rendered'), ['TOPIC']);
});

test('THE guarantee: a freshly scaffolded project holds no token anywhere, code spans included', () => {
  const dir = scaffoldProject(tempDir(), { topic: 'Anything', kit: '~/.agents/fetchproof' }).dir;
  for (const rel of templateFiles()) {
    const text = readText(resolve(dir, rel), '');
    assert.doesNotMatch(text, /\{\{[A-Z_]+\}\}/, `${rel} shipped with an unrendered token`);
  }
});

test('a topic containing JSON punctuation still scaffolds a plan that parses', () => {
  // Found by feeding the Actions collector a deliberately hostile topic. The substitution
  // into `plan.json` is textual, so `Why "agentic" search costs more` ended the JSON
  // string early and wrote a plan.json that does not parse - after which `research.mjs`
  // reads an empty plan and collects nothing, blaming a file the operator never touched.
  //
  // Nothing about this needed a workflow: any operator typing a quote in their topic hit it.
  const hostile = 'Why "agentic" search costs more \ and when it does not\tand a tab';
  const dir = scaffoldProject(tempDir(), { topic: hostile, kit: KIT_ROOT }).dir;

  const planText = readText(resolve(dir, PATHS.plan), '');
  let plan;
  assert.doesNotThrow(() => { plan = JSON.parse(planText); },
    `a topic with a double quote produced a plan.json that does not parse:\n${planText}`);
  assert.equal(plan.topic, hostile, 'the topic must survive escaping byte for byte, not be stripped');

  // The markdown templates want it VERBATIM: escaping everywhere would put \" into prose.
  const discovery = readText(resolve(dir, PATHS.discovery), '');
  assert.ok(discovery.includes('Why "agentic" search costs more'),
    'the topic should reach markdown unescaped; only JSON files need encoding');
  assert.ok(!discovery.includes('\\"agentic\\"'), 'markdown must not carry JSON escapes');
});

test('every scaffolded .json file parses, whatever the topic', () => {
  const dir = scaffoldProject(tempDir(), { topic: 'A "quoted" topic', kit: KIT_ROOT }).dir;
  for (const rel of templateFiles().filter((r) => r.endsWith('.json'))) {
    const text = readText(resolve(dir, rel), '');
    assert.doesNotThrow(() => JSON.parse(text), `${rel} does not parse after scaffolding`);
  }
});

// Found 2026-09-27: a brand-new project reported "repaired 1" - creating research/raw/ for
// the first time was counted as a repair, which reads as if something had been broken.
test('a brand-new project repairs nothing; the same folder missing later is a repair', () => {
  const fresh = scaffoldProject(path.join(tempDir(), 'p'), { topic: 'Fresh' });
  assert.deepEqual(fresh.repaired, [], `a new project reported repairs: ${fresh.repaired.join(', ')}`);
  assert.ok(fs.existsSync(resolve(fresh.dir, PATHS.raw)), 'the folder is still created');
});

// Found 2026-09-27: scaffolding into a folder with its own .gitignore kept it and added none
// of the kit's rules, so `git add -A` staged a .env (AGENTS.md Rule 6), and the ledger lost
// its explicit keep. An existing AGENTS.md was kept silently too, and an agent there never
// saw the research-first rules. The output said only "kept 1".
test('scaffolding into a folder with its own .gitignore adds the kit\'s missing rules, once', () => {
  const dir = path.join(tempDir(), 'p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(dir, '.gitattributes'), '*.png binary\n');
  const first = scaffoldProject(dir, { topic: 'Merge' });
  const ignore = readText(path.join(dir, '.gitignore'));
  assert.match(ignore, /^node_modules\//, 'the operator\'s own lines stay first');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^!research\/raw\/\.fetches\.jsonl$/m);
  assert.match(readText(path.join(dir, '.gitattributes')), /^research\/raw\/\* text eol=lf$/m);
  assert.ok(first.merged.includes('.gitignore') && first.merged.includes('.gitattributes'), `merged: ${first.merged}`);
  scaffoldProject(dir, { topic: 'Merge' });
  assert.equal(readText(path.join(dir, '.gitignore')), ignore, 'a second run changed the file again');
  assert.deepEqual(validateProject(dir).findings.filter((f) => f.rule === 'kit-rules-missing'), []);
});

test('a kept AGENTS.md without the research-first rules is named, not silent', () => {
  const dir = path.join(tempDir(), 'p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Our rules: use tabs.\n');
  scaffoldProject(dir, { topic: 'Kept' });
  assert.equal(readText(path.join(dir, 'AGENTS.md')), '# Our rules: use tabs.\n', 'the operator\'s file was changed');
  const finding = validateProject(dir).findings.find((f) => f.rule === 'agents-md-foreign');
  assert.ok(finding, 'the missing rules were not reported');
  assert.equal(finding.severity, 'warn');
});

test('validateProject names a .gitignore that does not keep .env out', () => {
  const dir = scaffoldProject(path.join(tempDir(), 'p'), { topic: 'Old' }).dir;
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  const finding = validateProject(dir).findings.find((f) => f.rule === 'kit-rules-missing');
  assert.ok(finding, 'a .gitignore without .env passed');
  assert.match(finding.detail, /\.env/);
  assert.match(finding.detail, /new-project/);
});

test('a kit rule written with different spacing counts as present', () => {
  const dir = scaffoldProject(path.join(tempDir(), 'p'), { topic: 'Spaced' }).dir;
  fs.writeFileSync(path.join(dir, '.gitattributes'), 'research/raw/*   text eol=lf\n*.jsonl\ttext eol=lf\nresearch/*.md    text eol=lf\n');
  assert.deepEqual(missingKitLines(dir, '.gitattributes'), [], 'aligned columns were read as missing rules');
});

// Found 2026-09-27: a folder holding only the operator's own .gitignore reported "repaired 1"
// - the folder was never a kit project, so creating research/raw/ repaired nothing.
test('a folder that was not yet a kit project repairs nothing', () => {
  const dir = path.join(tempDir(), 'p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  assert.deepEqual(scaffoldProject(dir, { topic: 'Theirs' }).repaired, []);
});

// Found 2026-09-27: the skill and the project's AGENTS.md told an agent to run
// `decompose.mjs --topic "<topic>"`; since ADR-0056 a paraphrased topic is refused.
test('the agent instructions run decompose on the project\'s own topic', () => {
  for (const file of [path.join(KIT_ROOT, 'skill', 'SKILL.md'), path.join(TEMPLATE_DIR, 'AGENTS.md')]) {
    assert.doesNotMatch(readText(file), /decompose\.mjs"? --topic "<topic>"/, `${file} still asks for the topic again`);
  }
});
