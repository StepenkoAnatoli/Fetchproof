// How a person reads a package's problems, in the two commands that print them.

import { test, describe, assert, fs, path, KIT_ROOT } from './harness.mjs';
import { printable, renderProblems } from '../lib/render.mjs';
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
  // Text in any script prints as it is.
  assert.equal(printable('caf\u00e9 \u2014 \u65e5\u672c \u0430'), 'caf\u00e9 \u2014 \u65e5\u672c \u0430');
});

test('collect-remote and artifact print the problems of a package through that one renderer (re-review of #442)', () => {
  // collect-remote reaches a package only over the network, so what is pinned offline is that it
  // prints through the renderer the tests above judge, redacting first, as artifact.mjs prints
  // through it in validate and in create. collect-remote printed its own lines, with no remedy and
  // its messages unescaped; create printed its own, with no remedy (re-review of the follow-up).
  const calls = {
    'artifact.mjs': [/renderProblems\(result\.errors\)/, /renderProblems\(written\.validation\.errors\)/],
    'collect-remote.mjs': [/renderProblems\(result\.errors, \{ clean: redact \}\)/, /saved \$\{printable\(redact\(file\)\)\}/],
  };
  for (const [script, expected] of Object.entries(calls)) {
    const source = fs.readFileSync(path.join(KIT_ROOT, 'bin', script), 'utf8');
    assert.match(source, /^import \{[^}]*\brenderProblems\b[^}]*\} from '\.\.\/lib\/render\.mjs';$/m, `${script} does not import the renderer`);
    for (const call of expected) assert.match(source, call, `${script} does not print through it: ${call}`);
    assert.doesNotMatch(source, /problem\(s\)|\$\{e\.code\} {2}\$\{e\.message\}/, `${script} prints its problems itself`);
  }
});
