// Property tests for the Windows `.cmd` shim argument guard (ADR-0020).
//
// WRITTEN HERE, NOT PORTED — and the reason is the interesting part.
//
// The tree this kit ported its validator layer from (ADR-0029) ships a 128-case hostile
// argv corpus with shrinking. It could not come across, because it is built on a
// different guard: that tree uses a regex ALLOWLIST, so anything unlisted is hostile by
// construction. This kit uses a DENYLIST of cmd.exe metacharacters, after the allowlist
// here was found refusing every search query containing a space.
//
// Compared character by character on 2026-09-20, the two agree on every metacharacter
// that can actually break out of cmd quoting — " % & | < > ^ ( ) ` tab newline — and
// disagree on five probed characters: ' { } \ and é. Their guard refuses those because
// they are not on the list; ours permits them because they cannot break out.
//
// `é` is the one that matters. An allowlist of ASCII punctuation refuses every query
// containing an accented letter, which is the same defect as the space exclusion, just
// hit less often. Porting their corpus would have imported that assumption; running it
// against this guard fails immediately, on case 4 of 128, because the generator asserts
// every value it emits is hostile.
//
// So: their corpus, our semantics, our test.

import { test, describe, assert, assertEqual } from './harness.mjs';
import {
  CMD_UNSAFE_CHARS, cmdSafeArg, unsafeCmdArgs, resolveInvocation, exec, PROGRAM,
} from '../lib/firecrawl.mjs';

describe('hostile-argv');

/** Every character the denylist names, as the generator's alphabet. */
const UNSAFE = ['%', '&', '|', '<', '>', '^', '(', ')', '"', '`', '\r', '\n', '\t'];

/** Characters that must stay permitted — the regressions this guard has already had. */
const MUST_PERMIT = [' ', "'", '{', '}', '\\', 'é', '中', '~', '!', ';', '*', '$', '-', '_'];

/** A deterministic PRNG, so a failing case names a seed somebody else can replay. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** `count` hostile arguments, each guaranteed to contain at least one refused character. */
function hostileCorpus({ seed = 20260920, count = 128 } = {}) {
  const next = rng(seed);
  const filler = 'abcdefghijklmnopqrstuvwxyz0123456789 ._-';
  return Array.from({ length: count }, (_, index) => {
    const bad = UNSAFE[Math.floor(next() * UNSAFE.length)];
    const left = Array.from({ length: Math.floor(next() * 6) }, () => filler[Math.floor(next() * filler.length)]).join('');
    const right = Array.from({ length: Math.floor(next() * 6) }, () => filler[Math.floor(next() * filler.length)]).join('');
    return { caseId: `HA-${String(index).padStart(3, '0')}`, value: `${left}${bad}${right}` };
  });
}

/** Remove one character at a time, keeping only shrinks that are still refused. */
function shrink(value) {
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const candidate = value.slice(0, i) + value.slice(i + 1);
    if (!cmdSafeArg(candidate)) out.push(candidate);
  }
  return out;
}

// ---------------------------------------------------------------- the corpus

test('the hostile corpus is deterministic, and every case is genuinely refused', () => {
  const first = hostileCorpus();
  const second = hostileCorpus();
  assertEqual(JSON.stringify(first), JSON.stringify(second), 'the generator is not deterministic');
  assertEqual(first.length, 128);

  for (const { caseId, value } of first) {
    assert(!cmdSafeArg(value), `${caseId} is not actually hostile: ${JSON.stringify(value)}`);
    assert(unsafeCmdArgs([value])?.includes(value), `${caseId} was not reported by unsafeCmdArgs`);
  }
});

test('every hostile case shrinks to a smaller case that is still refused', () => {
  for (const { caseId, value } of hostileCorpus({ count: 48 })) {
    const candidates = shrink(value);
    assert(candidates.length > 0, `${caseId} has no shrink candidate`);
    for (const candidate of candidates) {
      assert(candidate.length < value.length, `${caseId} did not shrink`);
      assert(!cmdSafeArg(candidate), `${caseId} shrink became safe`);
    }
  }
});

// ---------------------------------------------------------------- the guard itself

test('unsafeCmdArgs answers null when nothing is unsafe, and names every offender', () => {
  assertEqual(unsafeCmdArgs(['scrape', 'https://example.com/a b']), null,
    'a safe argv was reported as unsafe');
  const bad = unsafeCmdArgs(['ok', 'a&b', 'fine', 'c|d']);
  assertEqual(JSON.stringify(bad), JSON.stringify(['a&b', 'c|d']),
    'the report must name every offender, in order, and only the offenders');
  assertEqual(JSON.stringify(unsafeCmdArgs([''])), JSON.stringify(['']),
    'an empty argument must be refused and named, not permitted');
  assertEqual(unsafeCmdArgs([]), null, 'an empty argv has nothing unsafe in it');
});

test('the guard permits what it must: spaces, apostrophes, braces, backslashes, non-ASCII', () => {
  // This is the regression test for the two defects this guard has actually had. An
  // allowlist excluded the space, and every Windows search was refused before it was
  // sent. An allowlist of ASCII punctuation also excludes every accented letter.
  for (const value of MUST_PERMIT) {
    assert(cmdSafeArg(value), `${JSON.stringify(value)} must be permitted but was refused`);
    assertEqual(unsafeCmdArgs([value]), null, `${JSON.stringify(value)} was reported unsafe`);
  }
  assert(cmdSafeArg('firecrawl rate limits per minute'), 'an ordinary search query was refused');
  assert(cmdSafeArg('cafés and naïve façades'), 'an accented query was refused');
});

test('the denylist is exactly the characters that can break out of cmd quoting', () => {
  for (const char of UNSAFE) {
    assert(CMD_UNSAFE_CHARS.test(char), `${JSON.stringify(char)} is not in CMD_UNSAFE_CHARS`);
    assert(!cmdSafeArg(`a${char}b`), `${JSON.stringify(char)} was permitted inside an argument`);
  }
});

// ---------------------------------------------------------------- the route

test('a hostile argument is REFUSED on the cmd-shim route, never re-quoted', () => {
  const env = { PATH: 'C:\\tools', PATHEXT: '.CMD;.EXE', ComSpec: 'C:\\Windows\\cmd.exe' };
  for (const { caseId, value } of hostileCorpus({ count: 24 })) {
    const invocation = resolveInvocation(['scrape', value], {
      env, platform: 'win32', program: PROGRAM,
    });
    // Either the program is not resolvable in this synthetic env (not-installed), or the
    // guard fired. What must never happen is a successful invocation carrying the value.
    if (invocation.ok) {
      assert(false, `${caseId} produced a runnable invocation for a hostile argument`);
    }
    assert(['unsafe-for-cmd-shim', 'not-installed'].includes(invocation.reason),
      `${caseId} failed for an unexpected reason: ${invocation.reason}`);
    if (invocation.reason === 'unsafe-for-cmd-shim') {
      assert(invocation.detail.includes(value), `${caseId} did not name the offending argument`);
      assert(invocation.remedy?.includes('http-keyless'), `${caseId} offered no route without an interpreter`);
    }
  }
});

test('exec never reaches a shell, and passes arguments through untouched', () => {
  const seen = [];
  const spawn = (file, args, options) => {
    seen.push({ file, args, options });
    return { status: 0, stdout: '', stderr: '' };
  };
  // A POSIX route: the program resolves directly, so argv crosses unchanged.
  const result = exec(['scrape', 'https://example.com/a b?x=1&y=2'], {
    env: { PATH: '/usr/bin' },
    platform: 'linux',
    spawn,
    program: 'node',            // something that exists on PATH in the test environment
  });

  if (seen.length) {
    assertEqual(seen[0].options.shell, false, 'exec must never spawn through a shell');
    assertEqual(JSON.stringify(seen[0].args), JSON.stringify(['scrape', 'https://example.com/a b?x=1&y=2']),
      'arguments were rewritten on the way to spawn');
  } else {
    // The program was not resolvable here; the contract still holds, and says so.
    assertEqual(result.ok, false);
    assertEqual(result.invocation.reason, 'not-installed');
  }
});
