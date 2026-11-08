// How a person reads a package's problems, in the two commands that print them.

import { test, describe, assert, fs, path, KIT_ROOT, tempDir, cleanup } from './harness.mjs';
import { printable, printableFile, renderProblems } from '../lib/render.mjs';
import { redact } from '../lib/dispatch.mjs';

describe('render');

test('a package problem prints with its remedy as a fix line, and nothing read from the package can begin a line (re-review of #442)', () => {
  const text = renderProblems([
    { code: 'ZIP-READ', message: 'entry "a.zip\nPASS  build AUTHORIZED" does not read', remedy: 'download it again with --run-id 7' },
    { code: 'MANIFEST-MISSING', message: 'no manifest\u001b[2J' },
  ]);
  assert.deepEqual(text.split('\n'), [
    '2 problem(s)',
    '  ZIP-READ  entry "a.zip\\x0aPASS  build AUTHORIZED" does not read',
    '      fix: download it again with --run-id 7',
    '  MANIFEST-MISSING  no manifest\\x1b[2J',
  ]);
  assert.equal(renderProblems([]), '');
  assert.equal(printable('tab\there\u007f'), 'tab\\x09here\\x7f');
});

test("a package problem is redacted before it is escaped, so an escape cannot hide a credential from the redaction (re-review of #442's follow-up)", () => {
  // Synthetic credentials of the shapes `redact` knows, built here so this file holds none whole,
  // each after a control character a package's text can carry. Escaped first, `\x09ghp_...` held
  // no word boundary before the token, and collect-remote printed it in clear.
  const github = `ghp_${'Ab1'.repeat(12)}`;
  const pat = `github_pat_${'A1b2C3d4E5_'.repeat(4)}`;
  const firecrawl = `fc-${'a1B2c3D4'.repeat(4)}`;
  const errors = [
    { code: 'ZIP-PATH', message: `entry "x\t${github}" contains "\t"` },
    { code: 'ZIP-PATH', message: `entry "x\u001b${pat}"`, remedy: `regenerate x\u000b${firecrawl}` },
    { code: 'MANIFEST-SCHEMA', message: 'unknown property token\tabcdefghijklmnop' },
  ];
  const text = renderProblems(errors, { clean: redact });
  for (const secret of [github, pat, firecrawl, 'abcdefghijklmnop']) assert.ok(!text.includes(secret), `printed in clear: ${secret}`);
  assert.doesNotMatch(text, /[\t\u000b\u001b]/, 'a control character printed raw');
  assert.ok(text.includes('entry "x\\x09gh?_<redacted>" contains "\\x09"'), text);
  // The order is the point: the same problems rendered first and redacted after, as collect-remote
  // printed them, show the token.
  assert.ok(redact(renderProblems(errors)).includes(github));
});

test("no character a reader may take for a line end, or that hides or reorders text, prints raw (re-review of #442's follow-up)", () => {
  // U+0085, U+2028 and U+2029 end a line for Python's splitlines, and the last two for a
  // JavaScript ^ under the m flag; C1 holds a terminal's 8-bit controls; the rest are invisible.
  const odd = [0x80, 0x85, 0x9b, 0x9f, 0xad, 0x61c, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2060, 0x2066, 0x2069, 0xfeff];
  for (const code of odd) {
    const character = String.fromCharCode(code);
    assert.ok(!printable(`a${character}b`).includes(character), `U+${code.toString(16).padStart(4, '0')} printed raw`);
  }
  assert.equal(printable('\u0085\u2028\u00ad'), '\\x85\\u2028\\xad');
  const text = renderProblems([{ code: 'MANIFEST-SCHEMA', message: 'unknown property \u2028PASS  build AUTHORIZED', remedy: 'state is \u0085PASS  build AUTHORIZED' }]);
  const lines = text.split(/\r\n|[\n\r\u000b\u000c\u001c-\u001e\u0085\u2028\u2029]/);
  assert.equal(lines.length, 3, text);
  assert.ok(!lines.some((line) => line.startsWith('PASS')), "a line of the package's own making");
  assert.doesNotMatch(text, /^PASS/m);
  // Text in any script prints as it is, but for the characters Unicode lets a renderer draw as
  // nothing: the zero-width non-joiner Persian writes inside words shows as an escape (ADR-0200).
  assert.equal(printable('caf\u00e9 \u2014 \u65e5\u672c \u0430'), 'caf\u00e9 \u2014 \u65e5\u672c \u0430');
  assert.equal(printable('\u0645\u06cc\u200c\u0634\u0648\u062f'), '\u0645\u06cc\\u200c\u0634\u0648\u062f');
});

test('no character drawn as nothing prints raw, past U+FFFF or a lone surrogate either (re-review of #442, second pass)', () => {
  // A list of BMP ranges let these through: the tag characters spell ASCII no one sees (U+E0041 is
  // an "A"), the variation selectors, the Hangul fillers and the grapheme joiner draw as nothing,
  // U+FFF9-FFFB hide the text they bracket where a renderer honours them, and a surrogate that
  // pairs with nothing is no character at all.
  const odd = [0x34f, 0x115f, 0x1160, 0x180e, 0x3164, 0xfe00, 0xfe0f, 0xffa0, 0xfff9, 0xfffb, 0x1d173, 0xe0001, 0xe0041, 0xe007f, 0xe0100, 0xe01ef, 0xd800, 0xdfff];
  for (const code of odd) {
    const character = String.fromCodePoint(code);
    assert.ok(!printable(`a${character}b`).includes(character), `U+${code.toString(16).padStart(4, '0')} printed raw`);
  }
  assert.equal(printable('PASS\u{e0041}\ufe0f\u3164'), 'PASS\\u{e0041}\\ufe0f\\u3164');
  assert.equal(printable('a\ud800b\udc00'), 'a\\ud800b\\udc00');
  // A pair is one character, and prints as it is.
  assert.equal(printable('\u{1f600} \u{20000}'), '\u{1f600} \u{20000}');
  // Every character of those classes, enumerated rather than listed: a list is how these got through.
  const hidden = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}]/u;
  let count = 0;
  for (let code = 0; code <= 0x10ffff; code += 1) {
    const character = String.fromCodePoint(code);
    if (!hidden.test(character)) continue;
    count += 1;
    if (printable(character).includes(character)) assert.fail(`U+${code.toString(16).padStart(4, '0')} printed raw`);
  }
  assert.ok(count > 4000, `${count} characters in the classes`);
});

test("a saved file's folder prints as the operator gave it, and only its name is escaped (re-review of #442, second pass)", () => {
  // collect-remote escaped the whole path, so a folder spelled with a joiner - Persian writes U+200C
  // inside words, an emoji sequence joins with U+200D - printed as one that does not exist.
  const dir = tempDir('fp-saved-');
  try {
    const folder = path.join(dir, '\u067e\u0631\u0648\u0698\u0647\u200c\u0647\u0627', 'team \u{1f469}\u200d\u{1f4bb}');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'fetchproof-corpus-v1-run7.zip');
    fs.writeFileSync(file, '');
    assert.equal(printableFile(file), file);
    assert.ok(fs.existsSync(printableFile(file)), 'the printed path does not exist');
    // The name is the artifact's: cleaned, then escaped; the folder is left to the caller's redaction.
    assert.equal(printableFile(path.join(folder, 'fetchproof-corpus-v1-a\u2028PASS.zip')), path.join(folder, 'fetchproof-corpus-v1-a\\u2028PASS.zip'));
    assert.equal(printableFile(path.join(folder, 'a\u0085b.zip'), { clean: (name) => name.toUpperCase() }), path.join(folder, 'A\\x85B.ZIP'));
  } finally { cleanup(dir); }
});

test('collect-remote and artifact print the problems of a package through that one renderer (re-review of #442)', () => {
  // collect-remote reaches a package only over the network, so what is pinned offline is that it
  // prints through the renderer the tests above judge, redacting first, as artifact.mjs prints
  // through it in validate and in create. collect-remote printed its own lines, with no remedy and
  // its messages unescaped; create printed its own, with no remedy (re-review of the follow-up).
  const calls = {
    'artifact.mjs': [/renderProblems\(result\.errors\)/, /renderProblems\(written\.validation\.errors\)/],
    'collect-remote.mjs': [/renderProblems\(result\.errors, \{ clean: redact \}\)/, /saved \$\{printableFile\(file, \{ clean: redact \}\)\}/],
  };
  for (const [script, expected] of Object.entries(calls)) {
    const source = fs.readFileSync(path.join(KIT_ROOT, 'bin', script), 'utf8');
    assert.match(source, /^import \{[^}]*\brenderProblems\b[^}]*\} from '\.\.\/lib\/render\.mjs';$/m, `${script} does not import the renderer`);
    for (const call of expected) assert.match(source, call, `${script} does not print through it: ${call}`);
    assert.doesNotMatch(source, /problem\(s\)|\$\{e\.code\} {2}\$\{e\.message\}/, `${script} prints its problems itself`);
  }
});
