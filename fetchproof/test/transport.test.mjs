// The transport seam is real, not hypothetical: two adapters, one shape, and no data
// reaches a shell (ADR-0005, ADR-0020).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, tempDir, fs, path, KIT_ROOT } from './harness.mjs';
import { readText, writeText } from '../lib/core.mjs';
import * as firecrawl from '../lib/firecrawl.mjs';
import * as httpKeyless from '../lib/http-transport.mjs';
import { TRANSPORTS, TRANSPORT_NAMES, selectTransport, selectSearch, probeFirecrawl, unusedKeyNote, canSearch } from '../lib/transport.mjs';
import { mergeByRank } from '../lib/research-run.mjs';
import * as regexExtract from './fixtures/regex-extract.mjs';

describe('transport');

test('both adapters hold the same seven-function shape', () => {
  assert.equal(firecrawl.ADAPTER_SHAPE.length, 7);
  for (const name of firecrawl.ADAPTER_SHAPE) {
    assert.ok(name in firecrawl, `firecrawl is missing ${name}`);
    assert.ok(name in httpKeyless, `the keyless adapter is missing ${name}`);
    assert.equal(typeof firecrawl[name], typeof httpKeyless[name], `${name} differs in kind between the two adapters`);
  }
});

// Three adapters since ADR-0088, still one vendor: `browser` runs a Chromium already on the
// machine, with no key and no account, so it adds a transport and no third vendor.
test('the registry holds exactly three adapters, and names no third vendor', () => {
  assert.deepEqual(TRANSPORT_NAMES, ['firecrawl-cli', 'http-keyless', 'browser']);
  assert.equal(TRANSPORTS['firecrawl-cli'].name, 'firecrawl-cli');
  assert.equal(TRANSPORTS['http-keyless'].name, 'http-keyless');
  assert.equal(TRANSPORTS.browser.name, 'browser');
  assert.equal(TRANSPORTS.browser.creditsExhausted, undefined, 'no account, so nothing to run out of');
});

test('selection precedence: explicit, then env, then config, then a probe', () => {
  const installed = () => ({ installed: true, authenticated: true, version: '1.0.0', credits: 900 });
  const absent = () => ({ installed: false, authenticated: false, version: null, credits: null });

  assert.equal(selectTransport({ explicit: 'http-keyless', env: {}, probe: installed, config: {} }).name, 'http-keyless');
  assert.equal(selectTransport({ env: { FETCHPROOF_TRANSPORT: 'http-keyless' }, probe: installed, config: {} }).name, 'http-keyless');
  assert.equal(selectTransport({ env: {}, probe: installed, config: { transport: 'http-keyless' } }).name, 'http-keyless');
  assert.equal(selectTransport({ env: {}, probe: installed, config: {} }).name, 'firecrawl-cli');
  assert.equal(selectTransport({ env: {}, probe: absent, config: {} }).name, 'http-keyless');
});

test('an unknown transport is an error naming the two that exist', () => {
  assert.throws(() => selectTransport({ explicit: 'curl', env: {}, config: {} }), /Known transports/);
});

test('inherited registry members are refused at every transport and search precedence level', () => {
  const absent = () => ({ installed: false, authenticated: false, version: null, credits: null });
  for (const name of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
    for (const choice of [
      { explicit: name, env: {}, config: {} },
      { env: { FETCHPROOF_TRANSPORT: name }, config: {} },
      { env: {}, config: { transport: name } },
    ]) {
      assert.throws(() => selectTransport({ ...choice, probe: absent }), (err) =>
        err.code === 'UNKNOWN_TRANSPORT' && /Known transports/.test(err.message));
    }
    for (const choice of [
      { explicit: name, env: {}, config: {} },
      { env: { FETCHPROOF_SEARCH_TRANSPORT: name }, config: {} },
      { env: {}, config: { searchTransport: name } },
    ]) {
      assert.throws(() => selectSearch({ ...choice, probe: absent }), (err) =>
        err.code === 'UNKNOWN_SEARCH_PROVIDER' && /Known search providers/.test(err.message));
    }
  }
});

test('probeFirecrawl takes injected probes, so doctor\'s tests need no CLI', () => {
  // cache:false, because the probe is now memoised per process - two different injected
  // CLIs in one test are two different questions, and both have to be asked.
  const state = probeFirecrawl({ cache: false, cliVersion: () => '2.3.4', status: () => ({ authenticated: true, credits: 512 }) });
  assert.equal(state.installed, true);
  assert.equal(state.authenticated, true);
  assert.equal(state.version, '2.3.4', 'an injected version wins over the one --status reports');
  assert.equal(state.credits, 512);
  assert.equal(probeFirecrawl({ cache: false, cliVersion: () => null, status: () => ({}) }).installed, false);
});

// --- no data reaches a shell -------------------------------------------------------

test('exec carries an argv ARRAY and spawns with shell:false', () => {
  let seen = null;
  firecrawl.exec(['scrape', 'https://x.invalid/a b'], {
    env: { PATH: '/usr/bin' },
    platform: 'linux',
    program: 'firecrawl',
    spawn: (file, args, opts) => { seen = { file, args, opts }; return { status: 0, stdout: '{}', stderr: '' }; },
  });
  // No program on this synthetic PATH, so resolution refuses before spawning.
  assert.equal(seen, null);
});

test('a direct invocation is shell-free and passes the URL through untouched', () => {
  // Simulates THIS host's platform, not a hardcoded one.
  //
  // The first version passed `platform: 'linux'` while handing it a real directory from
  // this machine. On Windows that is `C:\Users\...`, and resolveProgramPath correctly
  // splits a POSIX PATH on ':' - severing the drive letter, finding nothing, and failing
  // the assertion. The product was right and the test was simulating a platform whose
  // path syntax it could not actually produce. Found by the Windows CI leg.
  //
  // Both platforms reach the same branch - a real .exe, or anything extension-less, is
  // spawned directly - so the property under test is genuinely shared, and asserting it
  // natively on each host is stronger than asserting it about a fiction on one.
  const windows = process.platform === 'win32';
  const dir = tempDir('fetchproof-bin-');
  const program = path.join(dir, windows ? 'firecrawl.exe' : 'firecrawl');
  fs.writeFileSync(program, windows ? 'MZ' : '#!/bin/sh\necho "{}"\n');
  const invocation = firecrawl.resolveInvocation(['scrape', 'https://x.invalid/a?q=$(touch pwned)'], {
    env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    platform: process.platform,
  });
  assert.equal(invocation.ok, true, JSON.stringify(invocation));
  assert.equal(invocation.shell, false);
  assert.equal(invocation.route, 'direct');
  assert.equal(invocation.args[1], 'https://x.invalid/a?q=$(touch pwned)', 'the URL is data, passed as one argv element');
});

test('a Windows .cmd shim validates every argument and REFUSES rather than re-quotes', () => {
  const dir = tempDir('fetchproof-bin-');
  fs.writeFileSync(path.join(dir, 'firecrawl.cmd'), '@echo off\r\necho {}\r\n');

  const safe = firecrawl.resolveInvocation(['scrape', 'https://x.invalid/docs'], {
    env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'cmd.exe' },
    platform: 'win32',
  });
  assert.equal(safe.ok, true);
  assert.equal(safe.route, 'cmd-shim');
  assert.equal(safe.shell, false, 'cmd.exe is spawned as argv, never through a shell string');

  const hostile = firecrawl.resolveInvocation(['search', 'a & calc.exe'], {
    env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'cmd.exe' },
    platform: 'win32',
  });
  assert.equal(hostile.ok, false);
  assert.equal(hostile.reason, 'unsafe-for-cmd-shim');
  assert.match(hostile.remedy, /http-keyless/, 'the interpreter-free escape hatch is named');
});

test('the named cost: a percent-encoded URL is refused on the Windows shim route', () => {
  const dir = tempDir('fetchproof-bin-');
  fs.writeFileSync(path.join(dir, 'firecrawl.cmd'), '@echo off\r\n');
  const refused = firecrawl.resolveInvocation(['scrape', 'https://x.invalid/a%20b'], {
    env: { PATH: dir, PATHEXT: '.CMD', ComSpec: 'cmd.exe' },
    platform: 'win32',
  });
  assert.equal(refused.ok, false, 'the cost is named, not hidden');
  assert.equal(firecrawl.CMD_SAFE_ARG.test('https://x.invalid/a%20b'), false);
  assert.equal(firecrawl.CMD_SAFE_ARG.test('https://x.invalid/a-b_c.d/e'), true);
});

test('a real stub CLI runs, and an injected $(touch ...) creates nothing', () => {
  if (process.platform === 'win32') return; // the POSIX route is what this pins
  const dir = tempDir('fetchproof-bin-');
  const marker = path.join(dir, 'pwned');
  const program = path.join(dir, 'firecrawl');
  fs.writeFileSync(program, '#!/bin/sh\nprintf \'{"data":{"markdown":"hello"}}\'\n');
  fs.chmodSync(program, 0o755);

  const result = firecrawl.exec(['scrape', `https://x.invalid/?q=$(touch ${marker})`], {
    env: { PATH: dir },
    platform: 'linux',
  });
  assert.equal(result.ok, true, result.stderr);
  assert.equal(fs.existsSync(marker), false, 'the shell never saw the argument');
});

test('command() renders for display and nothing executes it', () => {
  const rendered = firecrawl.command(['scrape', 'https://x.invalid/a b']);
  assert.match(rendered, /^firecrawl scrape "https:\/\/x\.invalid\/a b"$/);
});

// --- payload normalisation ---------------------------------------------------------

test('normalizeScrape reads the payload and stamps transport and completeness', () => {
  const result = firecrawl.normalizeScrape('{"data":{"markdown":"# Limits","metadata":{"title":"T","statusCode":200,"sourceURL":"https://x.invalid/l"}}}', 'https://x.invalid/l');
  assert.equal(result.markdown, '# Limits');
  assert.equal(result.title, 'T');
  assert.equal(result.statusCode, 200);
  assert.equal(result.transport, 'firecrawl-cli');
  // "# Limits" is eight characters. It used to be stamped `full` because the adapter
  // stamped every successful scrape that way; the grade is now earned.
  assert.equal(result.completeness, 'partial');
  assert.match(result.omitted, /below the 1500-character bar/);
});

test('normalizeScrape survives a banner printed before the JSON', () => {
  const result = firecrawl.normalizeScrape('Firecrawl CLI v1.2\n{"data":{"markdown":"body"}}', 'https://x.invalid');
  assert.equal(result.markdown, 'body');
});

// Found 2026-10-02 (break-test pass 3, a fake CLI on PATH): a banner with a bracket before the
// JSON, a receipt line after it, a cut payload and an empty stdout all came back as a
// "collected" capture holding 0 characters - a ledger entry and an evidence row with no page
// behind them. The 1.25.0 CLI prints "enrichment credits in CLI receipts", so the trailing
// case is not hypothetical.
test('the payload is the first complete JSON value, whatever the CLI prints around it', () => {
  const page = { data: { markdown: 'body text', metadata: { sourceURL: 'https://x.invalid/p' } } };
  const json = JSON.stringify(page);
  assert.equal(firecrawl.normalizeScrape(`[info] Update available: run npm install -g firecrawl-cli\n${json}`, 'https://x.invalid/p').markdown, 'body text', 'a bracket in the banner');
  assert.equal(firecrawl.normalizeScrape(`${json}\nCredits used: 1 (enrichment: 0)\n`, 'https://x.invalid/p').markdown, 'body text', 'a receipt after the JSON');
  assert.equal(firecrawl.normalizeScrape(`\u001b[33m╭──╮\n│ ✨ Update available! │\n╰──╯\u001b[0m\n${json}\nCredits used: 1\n`, 'https://x.invalid/p').markdown, 'body text', 'both');
});

test('a scrape whose stdout holds no page is a failure, never an empty capture', () => {
  const exec = (stdout) => () => ({ ok: true, status: 0, stdout, stderr: '' });
  const cut = firecrawl.scrape('https://x.invalid/p', { execFn: exec('{"success":true,"data":{"markdown":"cu') });
  assert.equal(cut.ok, false, 'a cut payload');
  assert.match(cut.error, /no JSON payload|could not be read/i);
  const empty = firecrawl.scrape('https://x.invalid/p', { execFn: exec('') });
  assert.equal(empty.ok, false, 'an empty stdout');
  assert.match(empty.error, /printed nothing|no JSON payload/i);
  const blank = firecrawl.scrape('https://x.invalid/p', { execFn: exec('{"success":true,"data":{"markdown":"","metadata":{}}}') });
  assert.equal(blank.ok, false, 'a payload whose page is empty');
  assert.match(blank.error, /no page text|empty/i);
  const fine = firecrawl.scrape('https://x.invalid/p', { execFn: exec('{"data":{"markdown":"a real page"}}') });
  assert.equal(fine.ok, true);
});

test('normalizeSearch and normalizeMap drop what has no URL', () => {
  assert.deepEqual(
    firecrawl.normalizeSearch('{"data":[{"url":"https://a.invalid","title":"A"},{"title":"no url"}]}').map((r) => r.url),
    ['https://a.invalid'],
  );
  assert.deepEqual(firecrawl.normalizeMap('{"links":["https://a.invalid",{"url":"https://b.invalid"},{}]}'), ['https://a.invalid', 'https://b.invalid']);
});

// Found 2026-09-29 (Arena break test): one null or non-object row in the CLI's stdout threw on
// `row.url` and took every valid result in the same payload with it. serpapi.normalizeSearch
// was hardened against this shape on 2026-09-28; this parser, the same shape, was not.
test('a malformed row in a Firecrawl payload is dropped, not fatal to the rows beside it', () => {
  assert.deepEqual(
    firecrawl.normalizeSearch('{"data":{"web":[null,7,"x",{"url":"https://a.invalid","title":"A"}]}}').map((r) => r.url),
    ['https://a.invalid'],
  );
  assert.deepEqual(firecrawl.normalizeMap('{"links":[null,7,{"url":"https://b.invalid"},"https://a.invalid"]}'), ['https://b.invalid', 'https://a.invalid']);
});

// Found 2026-09-30 (break-test, PR #172): the Firecrawl parsers dropped a malformed ROW but
// read a FIELD of the wrong type as the value. `{ url: { href } }` and `{ url: 42 }` became
// candidates, and a scrape whose metadata.sourceURL was an object was written as a capture
// named `...-object-object-...md` with `url: [object Object]` - a URL the kit never fetched,
// recorded in the ledger. serpapi and searxng read such a field as empty; one hostile shape
// goes to all three here, so they cannot drift apart again.
test('every vendor parser reads a field of the wrong type as empty, the same way', async () => {
  const { normalizeSearch: serpapiSearch } = await import('../lib/serpapi.mjs');
  const { normalizeSearch: searxngSearch } = await import('../lib/searxng.mjs');
  const hostile = { url: { href: 'https://a.invalid' }, link: 42, title: {}, description: [], snippet: 7, content: {}, position: '2' };
  assert.deepEqual(firecrawl.normalizeSearch(JSON.stringify({ data: { web: [hostile] } })), [], 'firecrawl kept a row with no string URL');
  assert.deepEqual(serpapiSearch({ organic_results: [hostile] }), []);
  assert.deepEqual(searxngSearch({ results: [hostile] }), []);
  // A row with a real URL keeps it, and its wrong-typed fields read as empty.
  const kept = { ...hostile, url: 'https://ok.invalid' };
  assert.deepEqual(firecrawl.normalizeSearch(JSON.stringify({ data: { web: [kept] } })),
    [{ url: 'https://ok.invalid', title: '', description: '', position: null }]);

  // A scrape: the requested URL stands in when the vendor's is not a string, a real one is
  // still preferred, a string or number status still reaches the error-page rule, and a
  // body that is not text is not written as "[object Object]".
  const scrape = (data) => firecrawl.normalizeScrape(JSON.stringify({ data }), 'https://requested.invalid');
  const body = 'x'.repeat(1600);
  assert.equal(scrape({ markdown: body, metadata: { sourceURL: { href: 'https://a.invalid' }, title: {} } }).url, 'https://requested.invalid');
  assert.equal(scrape({ markdown: body, metadata: { title: {} }, title: [] }).title, '');
  assert.equal(scrape({ markdown: body, metadata: { sourceURL: 'https://a.invalid/l', statusCode: 200 } }).url, 'https://a.invalid/l');
  assert.equal(scrape({ markdown: body, metadata: { statusCode: 200 } }).statusCode, 200);
  assert.equal(scrape({ markdown: body, metadata: { statusCode: '503' } }).statusCode, '503');
  assert.equal(scrape({ markdown: body, metadata: { statusCode: {} } }).statusCode, '', 'an object is not a status code');
  const objectBody = scrape({ markdown: { text: 'x' }, content: body });
  assert.equal(objectBody.markdown, body, 'a body that is not text must fall through to the next field');
  assert.doesNotMatch(scrape({ markdown: {} }).markdown, /\[object Object\]/);
});

test('parseStatus reads what it can and reports null for what is not there', () => {
  // This invented sample is what the parser was written against before a key existed:
  // a number BEFORE the word "credits". The real CLI prints "Credits: 949 / 1,000", so
  // the shape this test used to assert was never the shape the CLI emits.
  const guessed = firecrawl.parseStatus('Authenticated. 1,000 credits remaining.');
  assert.equal(guessed.authenticated, true);
  assert.equal(guessed.credits, null, 'no "Credits: n / m" line, so no count is claimed');
  assert.equal(guessed.concurrencyLimit, null);

  assert.equal(firecrawl.parseStatus('not authenticated').authenticated, false);
});

test('a failing CLI becomes a result, not an exception', () => {
  const result = firecrawl.scrape('https://x.invalid', { execFn: () => ({ ok: false, status: 1, stdout: '', stderr: 'HTTP 402' }) });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'HTTP 402');
  assert.equal(result.transport, 'firecrawl-cli');
});

// --- the keyless adapter -----------------------------------------------------------

test('the keyless adapter grades its own completeness honestly', () => {
  assert.equal(httpKeyless.gradeCompleteness('x'.repeat(2000)).completeness, 'full');
  const partial = httpKeyless.gradeCompleteness('x'.repeat(100));
  assert.equal(partial.completeness, 'partial');
  assert.match(partial.omitted, /100 characters/, 'a partial capture names what is missing');
});

test('htmlToMarkdown keeps headings, lists, links and tables; drops scripts', () => {
  const md = httpKeyless.htmlToMarkdown('<h2>Limits</h2><script>evil()</script><ul><li>10 <b>per minute</b></li></ul><p>See <a href="https://x.invalid">docs</a>.</p><table><tr><th>Plan</th><th>Credits</th></tr><tr><td>Free</td><td>1,000</td></tr></table>');
  assert.match(md, /## Limits/);
  assert.doesNotMatch(md, /evil/);
  assert.match(md, /- 10 \*\*per minute\*\*/);
  assert.match(md, /\[docs\]\(https:\/\/x\.invalid\)/);
  assert.match(md, /\| Plan \| Credits \|/);
});

// Found 2026-10-03 (output-reliability audit, G3): a list item, table cell or heading holding
// `x &lt; 5 and y &gt; 2` came out as `x 2`. The block pass decoded the entities inside the
// item, and the page-level pass then stripped `< 5 and y >` as if it were a tag; a paragraph
// survived because it is converted once. A limit written `< 10 requests` in a bulleted
// pricing page is exactly the fact the capture exists to keep, and the ledger and the quote
// check verify the damaged text faithfully. Entities are decoded once, at the end.
test('comparison text inside a list item, a table cell or a heading survives conversion', () => {
  const md = httpKeyless.htmlToMarkdown('<p>Allow when x &lt; 5 and y &gt; 2.</p><ul><li>Allow when x &lt; 5 and y &gt; 2.</li></ul>'
    + '<table><tr><td>x &lt; 5 and y &gt; 2</td><td>&lt;10 requests</td></tr></table><h2>When x &lt; 5 and y &gt; 2</h2>');
  assert.match(md, /^Allow when x < 5 and y > 2\.$/m, 'the paragraph');
  assert.match(md, /^- Allow when x < 5 and y > 2\.$/m, 'the list item');
  assert.match(md, /^\| x < 5 and y > 2 \| <10 requests \|$/m, 'the table cells');
  assert.match(md, /^## When x < 5 and y > 2$/m, 'the heading');
});

test('an entity inside a link label, bold text or code in a list item is decoded once and kept', () => {
  const md = httpKeyless.htmlToMarkdown('<ul><li>See <a href="https://x.invalid/l">limits &lt; 10</a> and <b>a &lt; b</b> or <code>n &gt; 0</code> &amp; more</li></ul>');
  assert.equal(md, '- See [limits < 10](https://x.invalid/l) and **a < b** or `n > 0` & more');
  // A double-encoded entity is decoded exactly once, as a reader of the page would see it.
  assert.equal(httpKeyless.htmlToMarkdown('<li>&amp;lt;b&amp;gt;</li>'), '- &lt;b&gt;');
});

// Found 2026-10-03 (review of the G3 fix): the G3 change left the page-level pass decoding
// a link's label INSIDE the link pass, before the tag-stripping pass that follows it. So a
// link in a paragraph or a div - the one place G3's test did not look - still lost its
// comparison text (`[limit 2](/x)`) and still double-decoded `&amp;lt;`. The label is never
// decoded on its own: entities are decoded once, at the end, wherever the link stands.
test('comparison text inside a link label in a paragraph or a div survives, decoded once', () => {
  assert.equal(httpKeyless.htmlToMarkdown('<p>See <a href="/x">limit &lt; 10 and burst &gt; 2</a> now.</p>'),
    'See [limit < 10 and burst > 2](/x) now.');
  assert.equal(httpKeyless.htmlToMarkdown('<div>See <a href="/x">limit &lt; 10</a> now.</div>'), 'See [limit < 10](/x) now.');
  assert.equal(httpKeyless.htmlToMarkdown('<p><a href="/x">a &amp;lt; b</a></p>'), '[a &lt; b](/x)');
  // A label that is only `&nbsp;` is as empty as one that is only a space, in a list item as
  // in a paragraph: the link is dropped in both, so a page's blank icon links do not become
  // `[ ](/x)` in its bulleted text.
  const blank = httpKeyless.htmlToMarkdown('<ul><li><a href="/x">&nbsp;</a> item</li></ul><p><a href="/y">&nbsp;</a> para</p>');
  assert.match(blank, /^- item$/m, 'the list item keeps its text and drops the blank link');
  assert.match(blank, /^ ?para$/m, 'the paragraph the same');
  assert.doesNotMatch(blank, /\[ *\]\(/, 'no empty link survives anywhere');
  // A numeric reference that spells an ampersand is decoded once too: `&#38;lt;` is the text
  // `&lt;`, not `<`.
  assert.equal(httpKeyless.decodeEntities('&#38;lt; &#x26;gt; &amp;amp;'), '&lt; &gt; &amp;');
  assert.equal(httpKeyless.htmlToMarkdown('<p>&#38;lt;b&#38;gt;</p>'), '&lt;b&gt;');
});

// Found 2026-10-25 (reasoning-layer plan, B3): the tag stripper ended a tag at the first '>',
// even inside a quoted attribute value. `<span title="Tier 3 > unlimited API requests">` left
// `unlimited API requests">` in the keyless capture - text no reader of the page sees, which the
// quote check then accepts as quotable. A tag ends at the first '>' outside a `"…"` or `'…'`
// value; a quote opens a value only right after `=`, as in HTML, so `title=O'Brien` opens none.
test('a ">" inside a quoted attribute value does not end the tag', () => {
  assert.equal(httpKeyless.htmlToMarkdown('<p>Plans: <span title="Tier 3 > unlimited API requests">Tier 3</span> has 100 requests a day.</p>'),
    'Plans: Tier 3 has 100 requests a day.');
  assert.equal(httpKeyless.htmlToMarkdown(`<div title=O'Brien><span data-x='A > <p>INJECTED</p> B'>Visible</span></div>`), 'Visible',
    "an unquoted value with an apostrophe opens no quote, and a single-quoted value hides its '>' and its tags");
  // The other two places the stripper runs: a link's label, and a title taken from the <h1>.
  assert.equal(httpKeyless.htmlToMarkdown('<p>See <a href="/x"><img alt="a > b">label</a> now.</p>'), 'See [label](/x) now.');
  assert.equal(httpKeyless.titleOf('<h1><span title="a > b">Name</span></h1>'), 'Name');
  // R3 still survives beside a quoted '>', written as a page writes it; and a bare '<' in text,
  // with an apostrophe and quotes after its '>', opens no quote that would swallow them.
  const md = httpKeyless.htmlToMarkdown(`<ul><li>It's rare: <span title='p > q'>p</span> &lt; 0.001 and x &gt; 3.</li><li>Raw: p < 0.001 and x > 3. Ask O'Brien about "q".</li></ul>`);
  assert.match(md, /^- It's rare: p < 0\.001 and x > 3\.$/m, 'R3');
  assert.match(md, /^- Raw: .* Ask O'Brien about "q"\.$/m, 'the text after a bare <');
});

// The stripper's tag count is the denominator of the words-per-tag score that picks the densest
// block. A quoted value holding tags is one tag, not one per '<' in it: counted the old way, the
// 200 `<i></i>` inside this attribute buried the block of prose under the shorter one.
test('a quoted attribute value holding tags counts as one tag when the densest block is picked', () => {
  const prose = `<div>${'alpha '.repeat(300)}<span data-x='${'<i></i>'.repeat(200)}'>end</span></div>`;
  const other = `<div>${'beta '.repeat(120)}<b>x</b></div>`;
  const chosen = httpKeyless.mainContent(`<html><body>${prose}${other}</body></html>`);
  assert.equal(chosen.basis, 'densest');
  assert.match(chosen.html, /alpha/, 'the block of prose is the densest');
  assert.doesNotMatch(chosen.html, /beta/);
  assert.equal(chosen.chosenWords, 301);
});

// Found 2026-10-25 (review of the B3 fix, F1): B3 made only the tag stripper read quoted values.
// Every tag a conversion pass reads by name still ended at its first '>': a list item, a heading,
// a table cell, bold, italic and code, a link, and the title. So the same
// `title="Tier 3 > unlimited API requests"` on an <li> still left `unlimited API requests">` in
// the capture, and an <a> whose quoted '>' came before its href lost the link. Each of them now
// ends its opening tag where the stripper does.
test('a ">" inside a quoted attribute value ends no tag a conversion pass reads', () => {
  const tier = 'title="Tier 3 > unlimited API requests"';
  const md = (html) => httpKeyless.htmlToMarkdown(html);
  assert.equal(md(`<ul><li ${tier}>Tier 3</li></ul>`), '- Tier 3', 'a list item');
  assert.equal(md(`<h2 ${tier}>Plans</h2>`), '## Plans', 'a heading');
  assert.equal(md(`<table><tr><td ${tier}>Tier 3</td></tr></table>`), '| Tier 3 |', 'a table cell');
  assert.equal(md(`<p>See <strong ${tier}>Tier 3</strong> now.</p>`), 'See **Tier 3** now.', 'bold');
  assert.equal(md(`<p>See <em data-x='a > b'>Tier 3</em> or <code data-x="a > b">npm i</code>.</p>`), 'See *Tier 3* or `npm i`.', 'italic and code');
  assert.equal(md(`<p>See <a href="/x" ${tier}>label</a> now.</p>`), 'See [label](/x) now.', 'a link with the value after its href');
  assert.equal(md(`<p>See <a ${tier} href="/x">label</a> now.</p>`), 'See [label](/x) now.', 'a link with the value before its href is still a link');
  assert.equal(httpKeyless.titleOf('<title data-x="a > b">Name</title>'), 'Name', 'the <title>');
  assert.equal(httpKeyless.titleOf('<h1 data-x="a > b">Name</h1>'), 'Name', 'the <h1> a page without a <title> is named by');
});

// Two shapes the http-linear equivalence generator never writes, so nothing compared them with
// the regex extractor (test/fixtures/regex-extract.mjs) until 2026-10-26 (Phase 4b mutations H1
// and H8). A literal `<>` in text is no tag: `/<[^>]+>/` needs a character inside, and tagEnd
// says so first. And an href whose value opens with one quote kind and is closed by the other,
// with no partner of its own kind before the page's last '>', is no attribute value: the tag ends
// at its first '>', and the href hit that runs past it makes no link, as the regex found none.
test('a literal "<>" stays in the text, and an href closed by the other quote kind past the tag\'s ">" makes no link', () => {
  const same = (html, expected, what) => {
    assert.equal(httpKeyless.htmlToMarkdown(html), expected, what);
    assert.equal(regexExtract.htmlToMarkdown(html), expected, `${what}: the regex extractor, which this must match`);
  };
  same('<p>In C#, a <> b compares; List<> is an open generic.</p>', 'In C#, a <> b compares; List<> is an open generic.', 'a literal <>');
  same(`<p>See <a href="x>t</a> and O'Brien's <a href='z'>u</a> now.</p>`, "See t and O'Brien's [u](z) now.", '" opened, \' closes');
  same(`<p>See <a title="q" href="x>t</a> and it's <a href='z'>u</a> now.</p>`, "See t and it's [u](z) now.", 'the same after another attribute');
  same(`<p>See <a href='x>t</a> and "this" <a href="z">u</a> now.</p>`, 'See t and "this" [u](z) now.', '\' opened, " closes');
});

// The same defect one level up (F1): the block mainContent keeps is the body of a <div>, <main>
// or <article> found by its opening tag, and that tag ended at its first '>' too, so the capture
// began with the rest of the attribute.
test('the block mainContent keeps begins after its opening tag, past a quoted ">"', () => {
  const words = (word, n) => `${word} `.repeat(n);
  const densest = httpKeyless.mainContent(`<html><body><div data-tip="a > hidden-div">${words('alpha', 150)}</div>`
    + `<div>${'<b>x</b> '.repeat(40)}</div></body></html>`);
  assert.equal(densest.basis, 'densest');
  assert.match(densest.html, /^alpha /, 'the densest <div> begins with its own text');
  const declared = httpKeyless.mainContent(`<html><body><div>${words('nav', 20)}</div>`
    + `<main data-x="a > hidden-main">${words('gamma', 150)}</main></body></html>`);
  assert.equal(declared.basis, 'declared');
  assert.match(declared.html, /^gamma /, 'the declared <main> begins with its own text');
});

// Found 2026-10-25 (review of the B3 fix, F2): B3 read a quoted value after any '<', and in text
// `a <= "x > y" and more text` read `="x > y"` as one, so the "tag" ran on to the '>' after the
// next '"' and took the rest of the sentence with it. Only a '<' that starts a tag as HTML does - a
// letter, '/', '!' or '?' after it - reads quoted values; any other ends at its first '>', as
// before B3. That reading still strips `<= "x >`, as it always did: reading such a '<' as text,
// as a browser does, would also change a capture already in the corpus (`<\/jats:title>` in a
// Crossref record's abstract), so it is not this fix.
test('a "<" that starts no tag reads no quoted value, and the sentence after it survives', () => {
  assert.equal(httpKeyless.htmlToMarkdown('<p>a <= "x > y" and more text</p><p>next</p>'), 'a y" and more text\n\n next');
  assert.equal(httpKeyless.htmlToMarkdown('<p>if (a <= "x") return;</p>'), 'if (a <= "x") return;');
  assert.equal(httpKeyless.htmlToMarkdown(`<p>a <b title="x > y">bold</b> and <!-- note="x > y" --> <?pi a="x > y"?>c</p>`), 'a **bold** and c',
    "a tag, a comment and a processing instruction still read their quoted values");
});

test('a page that marks its content with <main> is believed over a denser fragment', () => {
  // Found 2026-09-27: on a GitHub Docs page the keyless extractor kept the 262-character
  // summary and dropped the 17,385-character <main> around it - words-per-tag favours a
  // short, link-free fragment over an article full of links and inline code. Firecrawl
  // captured the same page whole. This fixture has the same shape.
  const section = (n) => `<h2>Step ${n}</h2><p>Open <a href="/s">Settings</a>, then <code>Actions</code>, then <a href="/p">Policies</a> for rule ${n}; `
    + 'every rule names an actor and an event, and a policy is active once saved. '.repeat(3) + '</p>';
  // Nested the way the real page is: <main> inside wrapper divs. The block finder matches
  // lazily and without overlap, so the outer div's match ends at the first </div> INSIDE
  // <main> - and <main> itself is never a candidate. An un-nested <main> matched whole and
  // made this fixture pass on the broken code.
  const html = '<html><body><div id="__next"><div class="layout"><header><nav><a href="/a">Docs</a><a href="/b">Pricing</a><a href="/c">Blog</a></nav></header>'
    // The intro must be over 200 characters, as the real one is (262): the extractor never
    // considers a block of 200 or less, and a shorter intro made this fixture pass on the
    // broken code.
    + '<main><div class="intro">Control who can trigger GitHub Actions workflows and which events are permitted to run them across an enterprise, organization, and repository. Rules layer with other protections and apply before any run starts.</div>'
    + Array.from({ length: 8 }, (_, i) => section(i + 1)).join('')
    + '<p>If you select <strong>Evaluate</strong> (GitHub Enterprise Cloud only), you can monitor the rule first.</p></main>'
    + '<footer><div>Help and support, contact us, terms and privacy for this site.</div></footer></div></div></body></html>';
  const md = httpKeyless.htmlToMarkdown(httpKeyless.mainContent(html).html);
  assert.match(md, /GitHub Enterprise Cloud only/, 'the fact at the end of the article was dropped');
  assert.match(md, /## Step 8/, 'the article body was dropped');
  assert.doesNotMatch(md, /Pricing/, 'navigation outside <main> leaked into the content');
});

test('outside a declared <main>, navigation is not dropped content, but a text caveat is', () => {
  // The real Docs page, after the fix above: 5,921 characters kept, and still graded
  // partial for "20 sibling sections outside" - breadcrumbs and sidebar link lists. Every
  // keyless docs capture would carry that warning. Link-heavy blocks outside the page's own
  // content are navigation; a block of prose outside it is still reported.
  const body = '<main>' + '<p>Rules name an actor and an event, and a policy is active as soon as it is saved. </p>'.repeat(40) + '</main>';
  const nav = '<div class="crumbs"><a href="/">Home</a> <a href="/a">GitHub Actions</a> <a href="/b">How-tos</a> <a href="/c">Administer</a></div>';
  const navOnly = httpKeyless.mainContent(`<html><body><div id="x"><div>${nav}${body}</div></div></body></html>`);
  assert.equal(navOnly.dropped.length, 0, `navigation was counted as dropped content: ${JSON.stringify(navOnly.dropped.map((d) => d.words))}`);
  const caveat = '<div class="note">Enterprise keys are exempt from this cap on weekends and holidays.</div>';
  const withCaveat = httpKeyless.mainContent(`<html><body><div id="x"><div>${nav}${body}${caveat}</div></div></body></html>`);
  assert.equal(withCaveat.dropped.length, 1, 'a prose caveat outside <main> must still be reported');
  const grade = httpKeyless.gradeCompleteness(httpKeyless.htmlToMarkdown(withCaveat.html), withCaveat);
  assert.match(grade.omitted, /outside the page's main content/, `the reason should say what was left out: ${grade.omitted}`);
});

test('a thin <main> is not trusted over the density heuristic', () => {
  const html = '<html><body><main><p>Loading...</p></main><div class="content">'
    + 'Real prose about rate limits and credits sits here, outside the main element. '.repeat(20) + '</div></body></html>';
  assert.match(httpKeyless.mainContent(html).html, /Real prose/, 'an empty shell of a <main> must not win');
});

test('decodeEntities handles named, decimal and hex references', () => {
  assert.equal(httpKeyless.decodeEntities('a&amp;b &#65; &#x42; &nbsp;c'), 'a&b A B  c');
});

// Found 2026-09-28 (Arena break test 8): a numeric reference past U+10FFFF made
// String.fromCodePoint throw a RangeError, so one malformed entity in a fetched page
// crashed the scrape instead of being captured. HTML parses such a reference - and 0 and
// a lone surrogate - as U+FFFD, the replacement character; so does this now.
test('an impossible character reference decodes to U+FFFD, never a throw', () => {
  for (const ref of ['&#1114112;', '&#x110000;', '&#xFFFFFFFFFF;', '&#99999999999999999999;', '&#0;', '&#xD800;']) {
    assert.equal(httpKeyless.decodeEntities(`a${ref}b`), 'a�b', ref);
  }
  assert.equal(httpKeyless.decodeEntities('&#x1F600;'), '\u{1F600}', 'a real astral character must survive');
  const body = `<main><p>${'A documented limit applies here. '.repeat(40)}&#1114112;</p></main>`;
  const r = httpKeyless.scrape('https://x.invalid/p', {
    spawn: () => ({ status: 0, stderr: '', stdout: JSON.stringify({ ok: true, url: 'https://x.invalid/p', statusCode: 200, contentType: 'text/html', body }) }),
  });
  assert.equal(r.ok, true, r.error);
});

// Found 2026-09-28 (Arena break test 8): an href is HTML, so `?a=1&amp;b=2` means `b=2` -
// but search and map returned the escaped text, a URL whose second parameter is "amp;b".
// And map's pattern refused any href holding a '#', so `&#38;` (an escaped '&') and every
// link to a section of another page were silently dropped.
test('search and map read an href as HTML: entities decoded, fragments dropped', () => {
  const page = (body) => ({
    spawn: () => ({ status: 0, stderr: '', stdout: JSON.stringify({ ok: true, url: 'https://ex.invalid/a', statusCode: 200, contentType: 'text/html', body }) }),
  });
  const linked = httpKeyless.search('q', page('<a href="https://ex.invalid/p?x=1&amp;y=2" class="result-link">R</a>'));
  assert.deepEqual(linked.results.map((r) => r.url), ['https://ex.invalid/p?x=1&y=2']);
  const redirected = httpKeyless.search('q', page('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fex.invalid%2Fr%3Fa%3D1%26b%3D2&amp;rut=abc" class="result-link">R</a>'));
  assert.deepEqual(redirected.results.map((r) => r.url), ['https://ex.invalid/r?a=1&b=2']);
  const bare = httpKeyless.search('q', page('<a href="https://ex.invalid/f?x=1&amp;y=2">F</a>'));
  assert.deepEqual(bare.results.map((r) => r.url), ['https://ex.invalid/f?x=1&y=2']);

  const mapped = httpKeyless.map('https://ex.invalid/a', page(
    '<a href="/p?x=1&amp;y=2">a</a><a href="/q?x=1&#38;y=2">b</a><a href="/docs#limits">c</a>'
    + '<a href="/docs#auth">c2</a><a href="#top">d</a><a href="https://other.invalid/z">e</a>'));
  assert.deepEqual(mapped.links, ['https://ex.invalid/p?x=1&y=2', 'https://ex.invalid/q?x=1&y=2', 'https://ex.invalid/docs']);
});

test('mainContent picks the densest block', () => {
  const html = '<div><nav><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></nav><article>' + 'Real prose about rate limits and credits. '.repeat(20) + '</article></div>';
  assert.match(httpKeyless.mainContent(html).html, /Real prose/);
});

test('the keyless adapter never reads a key and charges no credit', () => {
  const state = httpKeyless.status();
  assert.equal(state.authenticated, false);
  assert.equal(state.credits, null);
  const source = fs.readFileSync(fileURLToPath(new URL('../lib/http-transport.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /API_KEY/, 'the keyless adapter must not know about keys');
});

// Found 2026-09-26 in a cloud container whose only egress is an HTTPS proxy: the keyless
// transport got HTTP 403 for a page curl fetched fine through the same proxy. The fetch runs
// in a child on Node's built-in fetch, which ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1,
// so the transport went around the proxy it had been given - and said only "HTTP 403".

const OK_JOB = JSON.stringify({ ok: true, url: 'https://x.invalid/p', statusCode: 200, body: '<html><body><p>ok</p></body></html>' });
const childEnvOf = (env, call = (opts) => httpKeyless.scrape('https://x.invalid/p', opts)) => {
  let seen = null;
  call({ env, spawn: (file, args, opts) => { seen = opts; return { status: 0, stdout: OK_JOB, stderr: '' }; } });
  assert.ok(seen, 'the rendezvous never spawned - this test is vacuous');
  return seen.env ?? {};
};

test('a keyless fetch that times out says so, not "spawnSync ETIMEDOUT"', () => {
  const err = Object.assign(new Error('spawnSync /usr/bin/node ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const r = httpKeyless.scrape('https://x.invalid/p', { spawn: () => ({ error: err, stdout: '', stderr: '' }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /no answer within \d+s/);
  assert.doesNotMatch(r.error, /spawnSync/);
});

test('behind a proxy, the keyless fetch is told to use it', () => {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const env = childEnvOf({ [key]: 'http://127.0.0.1:9', PATH: '/bin' });
    assert.equal(env.NODE_USE_ENV_PROXY, '1', `${key} was set and the fetch child was not told to use it`);
    assert.equal(env[key], 'http://127.0.0.1:9', 'the proxy itself must still reach the child');
    assert.equal(env.PATH, '/bin', 'the rest of the environment must still reach the child');
  }
  const viaSearch = childEnvOf({ HTTPS_PROXY: 'http://127.0.0.1:9' }, (opts) => httpKeyless.search('q', opts));
  assert.equal(viaSearch.NODE_USE_ENV_PROXY, '1', 'search goes through the same rendezvous and must get the same');
});

test('with no proxy, or with the operator\'s own setting, the environment is left alone', () => {
  assert.equal(childEnvOf({ PATH: '/bin' }).NODE_USE_ENV_PROXY, undefined, 'no proxy, no flag');
  assert.equal(childEnvOf({ HTTPS_PROXY: 'http://127.0.0.1:9', NODE_USE_ENV_PROXY: '0' }).NODE_USE_ENV_PROXY, '0',
    'an operator who set the flag - even to 0 - decided; the transport does not overrule them');
});

// Found 2026-09-26: a complete GitHub API response (748 characters of JSON) was captured and
// graded `partial` - "only 748 characters of main content were extracted". Nothing was
// extracted and nothing was dropped: the grader was written for HTML pages and applied its
// length bar to every body. A CLOSED unknown resting on it would be flagged for a gap that
// does not exist.

const scrapeServed = (contentType, body, extra = {}) => httpKeyless.scrape('https://x.invalid/api', {
  spawn: () => ({ status: 0, stderr: '', stdout: JSON.stringify({ ok: true, url: 'https://x.invalid/api', statusCode: 200, contentType, body, ...extra }) }),
});

test('a short JSON or text response captured whole is graded full, and kept verbatim', () => {
  const json = '{"total_count":1,"artifacts":[{"id":10638148916,"expired":false}]}';
  for (const type of ['application/json; charset=utf-8', 'application/vnd.github+json', 'text/plain', 'text/csv', 'application/xml']) {
    const result = scrapeServed(type, json);
    assert.equal(result.completeness, 'full', `${type}: a whole body was graded ${result.completeness} (${result.omitted})`);
    assert.equal(result.omitted, '');
    assert.equal(result.markdown, json, `${type}: the body was rewritten instead of kept as served`);
  }
});

test('HTML is still graded by what extraction kept, and an unknown type is treated as HTML', () => {
  assert.equal(scrapeServed('text/html; charset=utf-8', '<html><body><p>short</p></body></html>').completeness, 'partial');
  assert.equal(scrapeServed(undefined, '<html><body><p>short</p></body></html>').completeness, 'partial',
    'a response with no content type keeps the old behaviour');
});

test('an empty body is never graded full', () => {
  const empty = scrapeServed('application/json', '');
  assert.equal(empty.completeness, 'partial');
  assert.match(empty.omitted, /empty/);
});

// Found 2026-10-03 (output-reliability audit, G7): the child decoded every body as UTF-8,
// whatever charset the server declared, and a body it could only read on a fallback was
// graded like one read as declared. The child now names the fallback on its answer, and the
// grade carries it: a capture decoded in the wrong charset is not known to be the page.
test('G7: a body the child decoded on a UTF-8 fallback is graded partial, and the reason names the charset', () => {
  const decodeFallback = 'the page declares charset "x-nope", which TextDecoder does not know - decoded as UTF-8';
  const text = scrapeServed('text/plain; charset=x-nope', 'plain words', { decodeFallback });
  assert.equal(text.completeness, 'partial');
  assert.match(text.omitted, /x-nope/, `the text grade names the charset: ${text.omitted}`);
  assert.equal(text.markdown, 'plain words', 'the body is still kept as the child read it');

  const page = `<html><body><main><p>${'word '.repeat(400)}</p></main></body></html>`;
  assert.equal(scrapeServed('text/html; charset=utf-8', page).completeness, 'full', 'the control: a long page read as declared is full');
  const html = scrapeServed('text/html; charset=x-nope', page, { decodeFallback });
  assert.equal(html.completeness, 'partial');
  assert.match(html.omitted, /x-nope/, `the HTML grade carries the fallback: ${html.omitted}`);

  const none = scrapeServed('text/plain; charset=windows-1252', 'Price: €5', { decodeFallback: '' });
  assert.equal(none.completeness, 'full', `an empty fallback is no fallback: ${none.omitted}`);
});

// ADR-0105 (2026-09-30): a binary response is refused, not kept. Decoded as text, a PDF lost
// every byte UTF-8 could not hold, so the "capture" could neither be reopened as the file nor
// hold a quote - and one 10-page paper put 2.3 MB of it into a committed corpus.
test('a binary response is refused by name, with no capture, and the remedy names a transport that converts it', () => {
  for (const type of ['application/pdf', 'image/png', 'application/zip', 'application/octet-stream']) {
    const result = scrapeServed(type, '%PDF-1.7 binary junk');
    assert.equal(result.ok, false, `${type} was kept as a capture`);
    assert.equal(result.markdown, undefined, `${type}: a body came back with the refusal`);
    assert.ok(result.error.includes(type), `${type}: the refusal does not name the type: ${result.error}`);
    assert.match(result.error, /firecrawl-cli/, `${type}: no remedy named: ${result.error}`);
  }
});

test('the rendezvous returns a result object rather than throwing, when the job fails', () => {
  const result = httpKeyless.scrape('https://x.invalid/never', {
    spawn: () => ({ stdout: '', stderr: 'boom', status: 1 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.transport, 'http-keyless');
  assert.match(result.error, /boom/);
});

test('a scrape through the rendezvous produces a graded capture', () => {
  const body = `<html><head><title>Limits</title></head><body><article>${'The free plan allows 10 requests per minute. '.repeat(60)}</article></body></html>`;
  const result = httpKeyless.scrape('https://x.invalid/limits', {
    spawn: () => ({ stdout: JSON.stringify({ ok: true, url: 'https://x.invalid/limits', statusCode: 200, body }), stderr: '', status: 0 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.title, 'Limits');
  assert.equal(result.transport, 'http-keyless');
  assert.equal(result.completeness, 'full');
  assert.match(result.markdown, /10 requests per minute/);
});

test('map keeps same-domain links only', () => {
  const body = '<a href="/docs/a">a</a><a href="https://other.invalid/x">x</a><a href="https://x.invalid/b">b</a>';
  const result = httpKeyless.map('https://x.invalid/', {
    spawn: () => ({ stdout: JSON.stringify({ ok: true, url: 'https://x.invalid/', body }), stderr: '', status: 0 }),
  });
  assert.deepEqual(result.links.sort(), ['https://x.invalid/b', 'https://x.invalid/docs/a']);
});

test('search unwraps the redirect the result list wraps its URLs in', () => {
  const body = '<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.x.invalid%2Flimits" class="result-link">Limits</a>';
  const result = httpKeyless.search('x limits', {
    spawn: () => ({ stdout: JSON.stringify({ ok: true, body }), stderr: '', status: 0 }),
  });
  assert.equal(result.results[0].url, 'https://docs.x.invalid/limits');
});

test('the keyless adapter runs as its own child: node <file> answers a job on stdin', () => {
  const file = fileURLToPath(new URL('../lib/http-transport.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [file], {
    input: JSON.stringify({ kind: 'unknown-job' }),
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: 'unknown job kind "unknown-job"' });
});

// --- an anonymous CLI is a different guarantee, and is recorded as one -------------

test('D2: an UNAUTHENTICATED CLI is labelled anonymous, not metered', () => {
  const anonymous = () => ({ installed: true, authenticated: false, version: '1.23.3', credits: null });
  const chosen = selectTransport({ env: {}, probe: anonymous, config: {} });

  assert.equal(chosen.name, firecrawl.ANONYMOUS_NAME);
  assert.match(chosen.why, /NOT authenticated/);
  assert.notEqual(chosen.name, firecrawl.name,
    'stamping it firecrawl-cli made a fetch nobody paid for indistinguishable from a metered one');
});

test('D2: the label reaches the CAPTURE, not just the selection', () => {
  const anonymous = () => ({ installed: true, authenticated: false, version: '1.23.3', credits: null });
  const chosen = selectTransport({ env: {}, probe: anonymous, config: {} });
  const result = chosen.adapter.runScrape('https://x.invalid/a', {
    execFn: () => ({ ok: true, status: 0, stdout: JSON.stringify({ data: { markdown: 'x'.repeat(2000) } }), stderr: '' }),
  });
  assert.equal(result.transport, firecrawl.ANONYMOUS_NAME, 'the ledger records what the check will judge');
});

// Found 2026-10-01 by a cold end-to-end trial: Firecrawl no longer answers a search from a CLI
// with no key ("Alexandria requires a Firecrawl API key with access enabled." - its own words,
// reproduced here with CLI 1.24.6), while it still scrapes for one. Auto-detection picked the
// anonymous CLI for both, so every search in decompose and research failed and the map was the
// bare checklist. Its fetches stay; its searches go to the keyless route, as a fetch-only
// transport's do.
test('an anonymous CLI fetches, and the keyless route searches for it', async () => {
  const anonymous = () => ({ installed: true, authenticated: false, version: '1.24.6', credits: null });
  const chosen = selectTransport({ env: {}, probe: anonymous, config: {} });
  assert.equal(chosen.name, firecrawl.ANONYMOUS_NAME, 'the fetch side is unchanged');
  assert.equal(chosen.search.name, 'http-keyless', `an anonymous CLI was chosen to search: ${chosen.search.why}`);
  assert.match(chosen.search.why, /without a key/);
  // With a SerpAPI key, its partner is the keyless route too.
  const merged = selectTransport({ env: { SERPAPI_API_KEY: 'offline-sentinel' }, probe: anonymous, config: {} });
  assert.equal(merged.search.adapters[1].name, 'http-keyless', 'the anonymous CLI was paired with SerpAPI to search');
  // An authenticated CLI still searches for itself.
  const authed = selectTransport({ env: {}, probe: () => ({ installed: true, authenticated: true, version: '1.24.6', credits: 900 }), config: {} });
  assert.equal(authed.search.name, firecrawl.name);
  // And no fallback asks it to search when the keyless route fails: that search cannot succeed.
  assert.equal(canSearch(chosen.adapter), false, 'a failed keyless search fell back to the anonymous CLI, which cannot search');
  assert.equal(canSearch(authed.adapter), true);
});

test('D2: an AUTHENTICATED CLI is the metered transport, unwrapped', () => {
  const authed = () => ({ installed: true, authenticated: true, version: '1.23.3', credits: 900 });
  const chosen = selectTransport({ env: {}, probe: authed, config: {} });
  assert.equal(chosen.name, firecrawl.name);
  assert.equal(chosen.adapter, firecrawl, 'no wrapper when the label already matches');
});

test('D2: transport-provenance names the anonymous case specifically', async () => {
  const { CHECKS } = await import('../lib/checks.mjs');
  const check = CHECKS.find((c) => c.name === 'transport-provenance');
  const corpus = {
    evidence: [{ id: 'E-01', url: 'u', raw: 'research/raw/a.md', line: 1 }],
    ledger: { entries: [{ op: 'scrape', url: 'u', raw: 'research/raw/a.md', transport: 'firecrawl-cli-anonymous' }] },
    captures: { byFile: new Map([['research/raw/a.md', { file: 'research/raw/a.md', transport: 'firecrawl-cli-anonymous' }]]), byUrl: new Map() },
  };
  const finding = check.run(corpus).find((f) => f.severity === 'warn');
  assert.match(finding.detail, /NO credential/);
  assert.match(finding.detail, /capped per IP/);
});

// --- the completeness grade is earned, by both adapters ---------------------------

test('D3: the firecrawl adapter grades completeness instead of stamping full', () => {
  const thin = firecrawl.normalizeScrape(JSON.stringify({ data: { markdown: 'x'.repeat(167) } }), 'https://x.invalid');
  assert.equal(thin.completeness, 'partial', 'a 167-character page came back graded full');
  assert.match(thin.omitted, /167 characters/);

  const full = firecrawl.normalizeScrape(JSON.stringify({ data: { markdown: 'x'.repeat(2000) } }), 'https://x.invalid');
  assert.equal(full.completeness, 'full');
  assert.equal(full.omitted, '');
});

test('D3: both adapters use the SAME bar, so they cannot disagree about "full"', () => {
  assert.equal(firecrawl.FULL_THRESHOLD, httpKeyless.FULL_THRESHOLD);
  const size = firecrawl.FULL_THRESHOLD - 1;
  assert.equal(firecrawl.gradeCompleteness('x'.repeat(size)).completeness, 'partial');
  assert.equal(httpKeyless.gradeCompleteness('x'.repeat(size)).completeness, 'partial');
});

// --- the probe is asked once ------------------------------------------------------

test('D1: probeFirecrawl is memoised, and presence costs no spawn', async () => {
  const { forgetProbe } = await import('../lib/transport.mjs');
  forgetProbe();
  let statusCalls = 0;
  let resolveCalls = 0;
  const opts = {
    resolve: () => { resolveCalls += 1; return '/usr/bin/firecrawl'; },
    status: () => { statusCalls += 1; return { authenticated: true, credits: 1 }; },
  };

  probeFirecrawl(opts);
  probeFirecrawl(opts);
  probeFirecrawl(opts);

  assert.equal(statusCalls, 1, 'doctor asked once and handed the same probe to selectTransport, which asked again');
  assert.equal(resolveCalls, 1);
  forgetProbe();
});

test('D1: cache:false still asks, for a long-lived process', async () => {
  const { forgetProbe } = await import('../lib/transport.mjs');
  forgetProbe();
  let calls = 0;
  const opts = { cache: false, resolve: () => '/usr/bin/firecrawl', status: () => { calls += 1; return { authenticated: false }; } };
  probeFirecrawl(opts);
  probeFirecrawl(opts);
  assert.equal(calls, 2);
  forgetProbe();
});

// --- vendor knowledge, verified against a REAL payload ----------------------------
//
// O-4 of the hardening design: "Firecrawl is still unauthenticated, so the collector's
// parsers remain unvalidated against real payloads." It stayed open until a key existed.
// These run against bytes captured from firecrawl v1.23.3 on 2026-09-19.

const REAL_STATUS = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-status-1.23.3.txt'));

test('O-4: the status parser reads the CLI\'s actual output', () => {
  assert.ok(REAL_STATUS, 'the fixture must exist - a parser with no real payload is the defect');
  const s = firecrawl.parseStatus(REAL_STATUS);

  assert.equal(s.authenticated, true);
  assert.equal(s.credits, 949, 'the old regex wanted a number BEFORE the word "credits"; this CLI puts the word first');
  assert.equal(s.creditLimit, 1000);
  assert.equal(s.concurrencyInUse, 0);
  assert.equal(s.concurrencyLimit, 2, 'matches E-01: two concurrent browsers on the free plan');
  assert.equal(s.version, '1.23.3');
});

// Captured from firecrawl-cli v1.24.6 on 2026-09-26, the version TESTED_CLI_VERSION moved to
// that day (and on from, 2026-10-02 and 2026-10-03 - the 1.25.2 and 1.25.3 fixtures below).
// Why it moved: 1.23.3 bundles axios 1.15.2, which sends plain proxied requests that an
// HTTPS proxy requiring CONNECT tunnels refuses with 405 - every call failed behind one
// (research/BRIEF.md, 2026-09-26 addendum). 1.24.6 bundles axios 1.18.0.
const REAL_STATUS_1246 = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-status-1.24.6.txt'));
const REAL_SEARCH_1246 = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-search-1.24.6.json'));

test('O-4: the status parser reads 1.24.6\'s actual output, the previously tested version', () => {
  assert.ok(REAL_STATUS_1246, 'the fixture must exist');
  const s = firecrawl.parseStatus(REAL_STATUS_1246);
  assert.equal(s.version, '1.24.6', 'the fixture is the release its name says');
  assert.equal(s.authenticated, true);
  assert.equal(s.credits, 505);
  assert.equal(s.creditLimit, 1000);
  assert.equal(s.concurrencyLimit, 2);
});

test('O-4: 1.24.6 search output normalises, and its ADDITIVE fields change nothing', () => {
  // New since 1.23.3: a top-level `warning` and `id`, `data.tools`, and `position` per row.
  // The adapter reads `data.web` only, so none of them may reach a result.
  const raw = JSON.parse(REAL_SEARCH_1246);
  assert.ok(Array.isArray(raw.data.web) && raw.data.web.length, 'the fixture must carry real results');
  assert.ok('tools' in raw.data && 'warning' in raw, 'the fixture must carry the fields this test is about');
  const rows = firecrawl.normalizeSearch(REAL_SEARCH_1246);
  assert.equal(rows.length, raw.data.web.length);
  for (const row of rows) {
    assert.match(row.url, /^https?:\/\//);
    assert.equal(typeof row.title, 'string');
  }
  assert.equal(JSON.stringify(rows).includes('tool discovery'), false, 'the vendor warning leaked into results');
});

// Captured from firecrawl-cli v1.25.2 on 2026-10-02 (docs/decisions/2026-10-02-firecrawl-cli-1-25,
// step 1 of its brief: three credits, a scratch prefix, the files beside the 1.24.6 ones).
// The question the decision left open: 1.25.0's "enrichment credits in CLI receipts" could
// print after the JSON on stdout, which `parsePayload` would then have to skip. It does not:
// the scrape receipt ("Scrape ID: ...") goes to stderr, stdout is one JSON value.
const REAL_STATUS_1252 = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-status-1.25.2.txt'));
const REAL_SEARCH_1252 = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-search-1.25.2.json'));
const REAL_SCRAPE_1252 = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-scrape-1.25.2.json'));
const REAL_SCRAPE_1252_STDERR = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-scrape-1.25.2.stderr.txt'));

test('O-4: the status parser reads 1.25.2\'s actual output, the previously tested version', () => {
  assert.ok(REAL_STATUS_1252, 'the fixture must exist');
  const s = firecrawl.parseStatus(REAL_STATUS_1252);
  assert.equal(s.version, '1.25.2', 'the fixture is the release its name says');
  assert.equal(s.authenticated, true);
  assert.equal(s.credits, 154);
  assert.equal(s.creditLimit, 1000);
  assert.equal(s.concurrencyLimit, 2);
});

test('O-4: 1.25.2 search output normalises; data.tools is now populated and still reaches no result', () => {
  const raw = JSON.parse(REAL_SEARCH_1252);
  assert.ok(Array.isArray(raw.data.web) && raw.data.web.length, 'the fixture must carry real results');
  assert.ok(Array.isArray(raw.data.tools) && raw.data.tools.length, 'the fixture must carry the populated tools list this test is about');
  const rows = firecrawl.normalizeSearch(REAL_SEARCH_1252);
  assert.equal(rows.length, raw.data.web.length);
  assert.deepEqual(rows.map((r) => r.url), raw.data.web.map((r) => r.url));
  for (const row of rows) assert.match(row.url, /^https?:\/\//);
  assert.equal(JSON.stringify(rows).includes('capability'), false, 'a tool entry leaked into the results');
  assert.equal(firecrawl.creditsUsed(REAL_SEARCH_1252), 2, 'the vendor says what the search cost');
});

test('O-4: 1.25.2 scrape stdout is one JSON value - the receipt is on stderr - and normalises whole', () => {
  assert.doesNotThrow(() => JSON.parse(REAL_SCRAPE_1252), 'stdout holds nothing before or after the payload');
  assert.match(REAL_SCRAPE_1252_STDERR, /^Scrape ID: [0-9a-f-]+\s*$/, 'the receipt went to stderr');
  const page = firecrawl.normalizeScrape(REAL_SCRAPE_1252, 'https://docs.firecrawl.dev/sdks/cli');
  assert.equal(page.url, 'https://docs.firecrawl.dev/sdks/cli');
  assert.equal(page.title, 'CLI | Firecrawl');
  assert.equal(page.statusCode, 200);
  assert.ok(page.markdown.length > 20000, `the whole page text is kept (${page.markdown.length} chars)`);
  assert.equal(page.completeness, 'full');
  assert.equal(page.transport, 'firecrawl-cli');
});

// Captured from firecrawl-cli v1.25.3 on 2026-10-03, the same way (a scratch prefix, the key
// per command, three credits, stdout and stderr apart). The release is one fix - `--objective`
// optional for alexandria feedback (firecrawl/cli#301) - with nothing on scrape, search or
// `--status`; the capture says so rather than the note: the same fields come back.
const REAL_STATUS_1253 = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-status-1.25.3.txt'));
const REAL_SEARCH_1253 = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-search-1.25.3.json'));
const REAL_SCRAPE_1253 = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-scrape-1.25.3.json'));
const REAL_SCRAPE_1253_STDERR = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-scrape-1.25.3.stderr.txt'));

test('O-4: the status parser reads the TESTED version\'s actual output (1.25.3)', () => {
  assert.ok(REAL_STATUS_1253, 'the fixture must exist');
  const s = firecrawl.parseStatus(REAL_STATUS_1253);
  assert.equal(s.version, firecrawl.TESTED_CLI_VERSION, 'the fixture and the tested version must be the same release');
  assert.equal(s.authenticated, true);
  assert.equal(s.credits, 1175);
  assert.equal(s.creditLimit, 1500, 'the plan behind the capture allows 1,500 a cycle; the parser reads the comma');
  assert.equal(s.concurrencyLimit, 2);
});

test('O-4: 1.25.3 search output normalises as 1.25.2\'s did - data.tools still reaches no result', () => {
  const raw = JSON.parse(REAL_SEARCH_1253);
  assert.ok(Array.isArray(raw.data.web) && raw.data.web.length, 'the fixture must carry real results');
  assert.ok(Array.isArray(raw.data.tools) && raw.data.tools.length, 'the fixture must carry the populated tools list');
  const rows = firecrawl.normalizeSearch(REAL_SEARCH_1253);
  assert.equal(rows.length, raw.data.web.length);
  assert.deepEqual(rows.map((r) => r.url), raw.data.web.map((r) => r.url));
  assert.deepEqual(rows.map((r) => r.position), [1, 2, 3]);
  for (const row of rows) assert.match(row.url, /^https?:\/\//);
  assert.equal(JSON.stringify(rows).includes('capability'), false, 'a tool entry leaked into the results');
  assert.equal(firecrawl.creditsUsed(REAL_SEARCH_1253), 2, 'the vendor says what the search cost');
});

test('O-4: 1.25.3 scrape stdout is one JSON value - the receipt is on stderr - and normalises whole', () => {
  assert.doesNotThrow(() => JSON.parse(REAL_SCRAPE_1253), 'stdout holds nothing before or after the payload');
  assert.match(REAL_SCRAPE_1253_STDERR, /^Scrape ID: [0-9a-f-]+\s*$/, 'the receipt went to stderr');
  const page = firecrawl.normalizeScrape(REAL_SCRAPE_1253, 'https://docs.firecrawl.dev/sdks/cli');
  assert.equal(page.url, 'https://docs.firecrawl.dev/sdks/cli');
  assert.equal(page.title, 'CLI | Firecrawl');
  assert.equal(page.statusCode, 200);
  assert.ok(page.markdown.length > 20000, `the whole page text is kept (${page.markdown.length} chars)`);
  assert.equal(page.completeness, 'full');
  assert.equal(page.transport, 'firecrawl-cli');
});

test('O-4: stripAnsi removes the ESCAPE, not just the bracket sequence', () => {
  const ESC = String.fromCharCode(27);
  assert.ok(REAL_STATUS.includes(ESC), 'the fixture carries real escapes');
  const stripped = firecrawl.stripAnsi(REAL_STATUS);
  assert.equal(stripped.includes(ESC), false, 'leaving the ESC behind put a control character where parsers expected a word boundary');
  assert.match(stripped, /Credits: 949 \/ 1,000/);
});

test('O-4: status() calls --status, the flag the CLI actually has', () => {
  let seen = null;
  firecrawl.status({ execFn: (argv) => { seen = argv; return { ok: true, stdout: REAL_STATUS, stderr: '' }; } });
  assert.deepEqual(seen, ['--status'], '`firecrawl status` is not a command: it exits non-zero and the probe never sees a key');
});

test('O-4: an unauthenticated machine is read as unauthenticated, not as a parse failure', () => {
  const s = firecrawl.parseStatus('firecrawl cli v1.23.3\n  Not authenticated - run firecrawl login\n');
  assert.equal(s.authenticated, false);
  assert.equal(s.credits, null);
});

// ---------------------------------------------------------------- merged search

test('mergeByRank interleaves, so one failing provider cannot eat the budget', () => {
  // The case that motivated this. On 2026-09-22 a query about the EU Deforestation
  // Regulation returned eight US financial-regulation pages from one provider and nothing
  // on topic, while the other returned seventeen, all on topic. Concatenation would have
  // spent the whole page budget on the wrong provider before reaching the right one.
  const bad = { provider: 'serpapi', results: [{ url: 'sec' }, { url: 'cfpb' }, { url: 'water' }] };
  const good = { provider: 'firecrawl-cli', results: [{ url: 'europa' }, { url: 'ey' }, { url: 'wiki' }] };

  const merged = mergeByRank([bad, good]);
  assert.deepEqual(merged.map((r) => r.url), ['sec', 'europa', 'cfpb', 'ey', 'water', 'wiki']);

  // Whatever the budget, the good provider is represented. At three pages the old
  // behaviour would have taken sec/cfpb/water and nothing else.
  assert.ok(merged.slice(0, 3).some((r) => r.provider === 'firecrawl-cli'),
    'the working provider must reach the first slots');
});

test('mergeByRank attributes every row, and agreement does not double-count', () => {
  // The ledger records which search surfaced a URL, which is what keeps a claim about
  // search quality checkable rather than an impression.
  const a = { provider: 'serpapi', results: [{ url: 'shared' }, { url: 'a2' }] };
  const b = { provider: 'firecrawl-cli', results: [{ url: 'shared' }, { url: 'b2' }] };

  const merged = mergeByRank([a, b]);
  assert.equal(merged.filter((r) => r.url === 'shared').length, 1, 'a shared URL appears once');
  // EVERY finder, not the first. Crediting only the provider asked first made agreement
  // look like discovery: a live run had seven of sixteen results shared, and all seven were
  // attributed to whichever provider the loop happened to reach first.
  assert.deepEqual(merged.find((r) => r.url === 'shared').providers, ['serpapi', 'firecrawl-cli']);
  assert.deepEqual(merged.find((r) => r.url === 'a2').providers, ['serpapi']);
  assert.deepEqual(merged.find((r) => r.url === 'b2').providers, ['firecrawl-cli']);
  assert.ok(merged.every((r) => r.providers?.length), 'every row names its finders');
});

test('mergeByRank handles ragged and empty lists without inventing rows', () => {
  const long = { provider: 'x', results: [{ url: '1' }, { url: '2' }, { url: '3' }] };
  const short = { provider: 'y', results: [{ url: 'only' }] };
  assert.deepEqual(mergeByRank([long, short]).map((r) => r.url), ['1', 'only', '2', '3']);
  assert.deepEqual(mergeByRank([{ provider: 'z', results: [] }]), []);
  assert.deepEqual(mergeByRank([]), []);
});

test('a configured SerpAPI key selects BOTH providers, not one', () => {
  // This is what the operator believed was already happening, and was not: the ladder
  // picked a single provider and the second key bought a meter rather than a second look.
  const search = selectSearch({
    env: { SERPAPI_API_KEY: ['4', '7'].join('') + 'd'.repeat(62) },
    probe: () => ({ ok: true, authenticated: true }),
  });
  assert.equal(search.merged, true);
  assert.equal(search.adapters.length, 2, 'both providers must be offered');
  assert.equal(search.adapters[0].name, 'serpapi', 'the separately metered one goes first');
  assert.ok(search.why.includes('merged by rank'));
});

test('an explicitly pinned provider stays a single provider', () => {
  // Pinning exists to make two runs comparable. If pinning still merged, it would not.
  const search = selectSearch({
    explicit: 'serpapi',
    env: { SERPAPI_API_KEY: ['4', '7'].join('') + 'd'.repeat(62) },
    probe: () => ({ ok: true, authenticated: true }),
  });
  assert.equal(search.merged, undefined);
  assert.equal(search.adapters, undefined, 'a pinned choice offers no second provider');
  assert.equal(search.name, 'serpapi');
});

// #317: the session keeps a failure on a provider the operator named, rather than degrading
// it to the fetch provider's search; the selection is what knows it was named.
test('a search provider named by flag, environment or machine config is marked explicit; an automatic one is not', () => {
  const probe = () => ({ ok: true, authenticated: true });
  const url = { SEARXNG_URL: 'http://127.0.0.1:9' };
  assert.equal(selectSearch({ explicit: 'searxng', env: url, config: {}, probe }).explicit, true);
  assert.equal(selectSearch({ env: { ...url, FETCHPROOF_SEARCH_TRANSPORT: 'searxng' }, config: {}, probe }).explicit, true);
  assert.equal(selectSearch({ env: url, config: { searchTransport: 'searxng' }, probe }).explicit, true);
  assert.notEqual(selectSearch({ env: {}, config: {}, probe }).explicit, true);
  assert.notEqual(selectSearch({ env: { SERPAPI_API_KEY: ['4', '7'].join('') + 'd'.repeat(62) }, config: {}, probe }).explicit, true);
});

// Found 2026-09-27: four decompose searches cost about 7 credits and one plan query about 2,
// measured on the account's own balance - and the kit recorded `searchesUsed: 0`, because only
// the SerpAPI adapter reported a count. The estimate follows the documented rule (E-03, E-14):
// 2 credits per 10 results, rounded up; a search is counted at 2 at least, because the rule
// does not say what an empty result costs and an under-count is the failure being fixed.
test('a Firecrawl search reports itself, and what it cost by the documented rule', () => {
  const rows = (n) => JSON.stringify({ data: { web: Array.from({ length: n }, (_, i) => ({ url: `https://x.invalid/${i}`, title: 't' })) } });
  const five = firecrawl.search('q', { execFn: () => ({ ok: true, status: 0, stdout: rows(5), stderr: '' }) });
  assert.equal(five.searchesUsed, 1);
  assert.equal(five.creditsEstimate, 2);
  const eleven = firecrawl.search('q', { limit: 20, execFn: () => ({ ok: true, status: 0, stdout: rows(11), stderr: '' }) });
  assert.equal(eleven.creditsEstimate, 4, '11 results is 4 credits (E-03)');
  const none = firecrawl.search('q', { execFn: () => ({ ok: true, status: 0, stdout: rows(0), stderr: '' }) });
  assert.equal(none.creditsEstimate, 2, 'an empty search is not assumed free');
  const failed = firecrawl.search('q', { execFn: () => ({ ok: false, status: 1, stdout: '', stderr: 'boom' }) });
  assert.equal(failed.searchesUsed, undefined, 'a failed call is not counted as spend');
});

// Found 2026-09-27: with the kit's user agent, DuckDuckGo served its bot check ("Unfortunately,
// bots use DuckDuckGo too", an anomaly-modal and no result links). The adapter parsed zero
// links and returned ok: true - so a refused search read as a search that found nothing.
test('keyless search reports DuckDuckGo\'s bot check as a failed search, with the reason', () => {
  const page = '<html><body><div class="anomaly-modal__box"><p>Unfortunately, bots use DuckDuckGo too.</p>'
    + '<p>Please complete the following challenge to confirm this search was made by a human.</p></div></body></html>';
  const r = httpKeyless.search('q', {
    spawn: () => ({ status: 0, stderr: '', stdout: JSON.stringify({ ok: true, url: 'https://lite.duckduckgo.com/lite/?q=q', statusCode: 200, contentType: 'text/html', body: page }) }),
  });
  assert.equal(r.ok, false, 'a bot check was reported as a successful search');
  assert.match(r.error, /bot check/i);
  assert.deepEqual(r.results, []);
});

// Found 2026-09-27: with FIRECRAWL_API_KEY set and no CLI on PATH, a run fell back to the
// keyless adapter - capped per IP - and said only "no CLI on PATH". The key the operator set
// was unused, and nothing at collection time said so; only doctor did.
test('a key with no CLI to use it is named at collection time, with the install command', () => {
  const absent = () => ({ installed: false, authenticated: false, version: null, credits: null });
  const installed = () => ({ installed: true, authenticated: true, version: '1.0.0', credits: 900 });
  const key = { FIRECRAWL_API_KEY: 'fc-test' };

  const fallback = selectTransport({ env: key, probe: absent, config: {} });
  const note = unusedKeyNote(fallback, key);
  assert.match(note, /FIRECRAWL_API_KEY is set/);
  assert.match(note, /not on PATH/);
  assert.ok(note.includes(firecrawl.cliInstallSpec()), note);

  assert.equal(unusedKeyNote(selectTransport({ env: {}, probe: absent, config: {} }), {}), '', 'no key: nothing unused');
  assert.equal(unusedKeyNote(selectTransport({ env: key, probe: installed, config: {} }), key), '', 'the CLI uses the key');
  assert.equal(unusedKeyNote(selectTransport({ explicit: 'http-keyless', env: key, probe: absent, config: {} }), key), '',
    'keyless was asked for by name: the operator chose it');
});

// ADR-0086: the text the Firecrawl API sends with its 402, as the CLI prints it on stderr
// (fetch-fallback corpus, E-10, E-11). The adapter's scrape passes stderr on as its error,
// and creditsExhausted must recognise it there - and nothing else.
test('the Firecrawl adapter recognises exhausted credits from the CLI\'s own words', async () => {
  const fc = (await import('../lib/firecrawl.mjs')).default;
  const stderr = 'Error: Insufficient credits to perform this request. For more credits, you can upgrade your plan at https://firecrawl.dev/pricing or try changing the request limit to a lower value.';
  const failed = fc.scrape('https://x.invalid/a', { execFn: () => ({ ok: false, status: 1, stdout: '', stderr }) });
  assert.equal(failed.ok, false);
  assert.equal(fc.creditsExhausted(failed.error), true);
  assert.equal(fc.creditsExhausted('Insufficient credits. For more credits, you can upgrade your plan'), true, 'the v0 wording');
  for (const other of ['Error: Rate limit exceeded (429)', 'Error: Payment required', 'firecrawl exited 1', '', undefined]) {
    assert.equal(fc.creditsExhausted(other), false, String(other));
  }
});

// Found 2026-09-28 running the browser transport: nodejs.org/api/fs.html is 314 <section>
// elements in a row, with no <main> or <article>. The extractor kept the single densest
// section - 1,095 characters - and graded away ~40,500 words as "outside the densest block",
// on both the keyless and the browser route. A run of sections that holds most of the page
// is the content, not a set of rivals for it.
test('a page built from a run of sections keeps the run, not the densest one', async () => {
  const { mainContent: extract, htmlToMarkdown: toMd, gradeCompleteness: grade } = await import('../lib/http-transport.mjs');
  const nav = `<div class="nav">${Array.from({ length: 30 }, (_, i) => `<a href="/x${i}">Link ${i}</a>`).join(' ')}</div>`;
  // Each section carries a nested <div>, as the real page's stability notes do: the block
  // regex then ends the wrapper <div> at the first inner </div>, so no block holds the run.
  const sections = Array.from({ length: 40 }, (_, i) => `<section><h2>fs.method${i}()</h2><div class="api_stability">Stability: 2 - Stable</div><p>The fs.method${i}() call reads a file and returns its contents as a buffer, or as a string when an encoding is given. It fails when the path does not exist.</p></section>`).join('\n');
  const html = `<html><head><title>File system</title></head><body>${nav}<div id="column">${sections}</div></body></html>`;
  const extraction = extract(html);
  const markdown = toMd(extraction.html);
  for (const i of [0, 17, 39]) assert.match(markdown, new RegExp(`fs\\.method${i}\\(\\) call reads a file`), `section ${i} is missing`);
  assert.equal(grade(markdown, extraction).completeness, 'full', grade(markdown, extraction).omitted);
  assert.doesNotMatch(markdown, /Link 12/, 'the navigation stays out');
});

// Found 2026-09-30 (break-test): every network failure in the keyless and SerpAPI children
// read "fetch failed". Node keeps the reason on err.cause, so an offline machine, a mistyped
// host and a refused port looked the same.
test('a failed fetch names its cause, and a URL in the cause shows only its host', async () => {
  const { fetchFailure } = await import('../lib/runtime.mjs');
  const dns = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND no-such.invalid'), { code: 'ENOTFOUND' }) });
  assert.equal(fetchFailure(dns), 'fetch failed (getaddrinfo ENOTFOUND no-such.invalid)');
  const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' }) });
  assert.equal(fetchFailure(refused), 'fetch failed (ECONNREFUSED)');
  const aggWithoutTopCode = Object.assign(new TypeError('fetch failed'), { cause: new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:1')], '') });
  assert.equal(fetchFailure(aggWithoutTopCode), 'fetch failed (connect ECONNREFUSED 127.0.0.1:1)');
  const keyed = Object.assign(new TypeError('fetch failed'), { cause: new Error('bad response from https://serpapi.com/search.json?api_key=SECRET&q=x') });
  assert.doesNotMatch(fetchFailure(keyed), /SECRET|api_key/);
  assert.match(fetchFailure(keyed), /serpapi\.com/);
  assert.equal(fetchFailure(new Error('plain')), 'plain');
  assert.equal(fetchFailure('text'), 'text');
});

// Found 2026-10-01 (break-test): the redaction above ran over the CAUSE only, and Node throws
// some fetch refusals with no cause at all and the whole URL in the message. A plan holding a
// signed or credential-bearing URL - the thing collect.yml's own input description warns
// against - then printed it to the terminal and wrote it into research/raw/.fetches.jsonl as
// that entry's error: nine copies of one token in the ledger, in the one directory doctor's
// secret scan excludes by design, and the ledger is the file that must travel.
test('a URL in the failure itself shows only its host, not only a URL in the cause', async () => {
  const { fetchFailure } = await import('../lib/runtime.mjs');

  const credentials = new TypeError('Request cannot be constructed from a URL that includes credentials: '
    + 'http://user:sup3rsecret@127.0.0.1:8099/?api_key=SECRET&token=ghp_SECRET');
  const said = fetchFailure(credentials);
  assert.doesNotMatch(said, /sup3rsecret|SECRET|api_key|token=/, said);
  assert.match(said, /127\.0\.0\.1:8099/, 'the host survives, so the failure is still diagnosable');
  assert.match(said, /credentials/, 'and so does the reason');

  const unparsed = new TypeError('Failed to parse URL from https://example.invalid/a?token=SECRET');
  assert.doesNotMatch(fetchFailure(unparsed), /SECRET|token/, fetchFailure(unparsed));
  assert.match(fetchFailure(unparsed), /example\.invalid/);

  // A message and a cause that both carry a key: neither copy survives, and the host does.
  const both = Object.assign(new TypeError('fetch of https://x.invalid/s?api_key=SECRET failed'),
    { cause: new Error('bad response from https://x.invalid/s?api_key=SECRET') });
  assert.doesNotMatch(fetchFailure(both), /SECRET|api_key/);
  assert.match(fetchFailure(both), /x\.invalid/);

  // The cause-only path the previous test pinned, unchanged.
  const keyed = Object.assign(new TypeError('fetch failed'), { cause: new Error('bad response from https://serpapi.com/search.json?api_key=SECRET&q=x') });
  assert.equal(fetchFailure(keyed), 'fetch failed (bad response from serpapi.com)');
});

// Found 2026-10-02 (docs/decisions/2026-10-02-github-plain-fetch-refusal): a keyless fetch of a
// github.com page answered 403, and the kit recorded "HTTP 403" - nothing else. The body said
// what refused it (a sandbox proxy: "GitHub access to this repository is not enabled for this
// session"), and it took curl to learn that. A server that explains itself is quoted. The
// server lives in its own process: `scrape` runs its child with spawnSync, which blocks this
// process's event loop, so a server here would never answer.
test('a keyless fetch refused with a status names the server\'s own reason beside it', async () => {
  const { spawn } = await import('node:child_process');
  const file = path.join(tempDir('fetchproof-refusing-server-'), 'server.mjs');
  writeText(file, `
import http from 'node:http';
const server = http.createServer((req, res) => {
  if (req.url === '/json') { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'GitHub access to this repository is not enabled for this session. Use add_repo to request access.', documentation_url: 'https://example.invalid/docs' })); return; }
  if (req.url === '/html') { res.writeHead(503, { 'content-type': 'text/html' }); res.end('<html><head><title>Service unavailable - maintenance window</title></head><body><p>Back soon.</p></body></html>'); return; }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('   no such page here\\nsecond line');
});
server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));
`);
  const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    proc.on('exit', (code) => reject(new Error(`the refusing server exited ${code}`)));
  });
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].includes(name)));
  try {
    const { scrape, serverReason } = await import('../lib/http-transport.mjs');
    const json = scrape(`http://127.0.0.1:${port}/json`, { env, timeout: 20_000 });
    assert.equal(json.ok, false);
    assert.match(json.error, /^HTTP 403 - the server said: "GitHub access to this repository is not enabled for this session/, json.error);
    const html = scrape(`http://127.0.0.1:${port}/html`, { env, timeout: 20_000 });
    assert.match(html.error, /^HTTP 503 - the server said: "Service unavailable - maintenance window"/, html.error);
    const text = scrape(`http://127.0.0.1:${port}/text`, { env, timeout: 20_000 });
    assert.match(text.error, /^HTTP 404 - the server said: "no such page here"/, text.error);
    // Bounded and one line, whatever the server sent; nothing to say is nothing said.
    assert.equal(serverReason({ contentType: 'application/json', body: JSON.stringify({ message: 'x'.repeat(500) }) }).length, 160 + 3);
    assert.equal(serverReason({ contentType: 'application/json', body: '{"error":{"code":7}}' }), '');
    assert.equal(serverReason({ contentType: 'application/octet-stream', body: 'binary' }), '');
    assert.equal(serverReason({ contentType: 'text/plain', body: ' \n  ' }), '');
  } finally {
    proc.kill();
  }
});

test('a keyless fetch of a refused port says the connection was refused', async () => {
  const http = await import('node:http');
  const server = http.createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].includes(name)));
  const { scrape } = await import('../lib/http-transport.mjs');
  const r = scrape(`http://127.0.0.1:${port}/`, { env, timeout: 20_000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/, r.error);
});

// ADR-0139 (gap audit 2026-10-03, rank 2): Firecrawl serves a cached copy up to two days old by
// default, and the adapter asked for nothing fresher - a capture stamped `retrieved: today`
// could be yesterday's copy, with `cacheState` and `cachedAt` discarded. A scrape is a live
// fetch now, and a cached answer, if the vendor sends one anyway, is written down.
test('ADR-0139: a scrape asks for a live page, and a cached answer is recorded, never silent', () => {
  const calls = [];
  const execFn = (argv) => { calls.push(argv); return { ok: true, status: 0, stdout: readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-scrape-1.25.3.json')), stderr: '' }; };
  const page = firecrawl.scrape('https://docs.firecrawl.dev/sdks/cli', { execFn });
  assert.equal(page.ok, true, page.error);
  const argv = calls[0];
  const at = argv.indexOf('--max-age');
  assert.ok(at > 0 && argv[at + 1] === '0', `the scrape does not ask for a live page: ${argv.join(' ')}`);
  assert.ok(at > argv.indexOf('scrape') + 1, 'the URL stays the token after scrape, as requestedUrl reads it');
  assert.match(page.cmd, /--max-age 0/);
  // The 1.25.3 fixture is a cache hit, as real answers were on 2026-10-03.
  assert.equal(page.cacheState, 'hit');
  assert.equal(page.cachedAt, '2026-10-03T11:26:29.902Z');
  // A payload with no cache fields records none.
  const live = firecrawl.normalizeScrape(JSON.stringify({ success: true, data: { markdown: 'x'.repeat(1600), metadata: { sourceURL: 'https://x.invalid/p', statusCode: 200 } } }), 'https://x.invalid/p');
  assert.equal(live.cacheState, '');
  assert.equal(live.cachedAt, '');
});

// ADR-0140 (gap audit 2026-10-03, rank 3): the converted Markdown was all the corpus kept, so a
// conversion defect (G3) was permanent and the ledger certified it. Every transport that
// converts HTML hands back the text it converted, as `source`, for the collector to keep.
test('ADR-0140: the keyless adapter returns the HTML it converted as source, and none for a verbatim body', () => {
  const body = `<html><head><title>T</title></head><body><main><p>${'A documented limit applies here. '.repeat(60)}</p></main></body></html>`;
  const page = httpKeyless.scrape('https://x.invalid/p', {
    spawn: () => ({ status: 0, stderr: '', stdout: JSON.stringify({ ok: true, url: 'https://x.invalid/p', statusCode: 200, contentType: 'text/html', body }) }),
  });
  assert.equal(page.ok, true, page.error);
  assert.equal(page.source, body, 'the source is the decoded body the converter read');
  assert.notEqual(page.markdown, body);
  const json = httpKeyless.scrape('https://x.invalid/j', {
    spawn: () => ({ status: 0, stderr: '', stdout: JSON.stringify({ ok: true, url: 'https://x.invalid/j', statusCode: 200, contentType: 'application/json', body: '{"a":1}' }) }),
  });
  assert.equal(json.ok, true);
  assert.equal(json.source, undefined, 'a verbatim capture is its own source');
});

test('ADR-0140: the Firecrawl adapter asks for rawHtml beside markdown and returns it as source', () => {
  const calls = [];
  const payload = JSON.stringify({ success: true, data: { markdown: 'x'.repeat(1600), rawHtml: '<html><body>' + 'x'.repeat(1600) + '</body></html>', metadata: { sourceURL: 'https://x.invalid/p', statusCode: 200 } } });
  const page = firecrawl.scrape('https://x.invalid/p', { execFn: (argv) => { calls.push(argv); return { ok: true, status: 0, stdout: payload, stderr: '' }; } });
  assert.equal(page.ok, true, page.error);
  const argv = calls[0];
  const at = argv.indexOf('--format');
  assert.ok(at > 0 && argv[at + 1] === 'markdown,rawHtml', `rawHtml is not asked for: ${argv.join(' ')}`);
  assert.ok(argv.includes('--only-main-content'), 'the Markdown is still the main content');
  assert.equal(page.source, '<html><body>' + 'x'.repeat(1600) + '</body></html>');
  // A payload with Markdown alone (the 1.25.3 fixture) has no source to keep.
  const fixture = readText(path.join(KIT_ROOT, 'test', 'fixtures', 'firecrawl-scrape-1.25.3.json'));
  assert.equal(firecrawl.normalizeScrape(fixture, 'https://docs.firecrawl.dev/sdks/cli').source, '');
});

// #313 (2026-10-11): the keyless child reported a 429 as "HTTP 429" and never read Retry-After,
// so the collector's wait loop - which understood only Firecrawl's error text - recorded a
// one-second window as a failed page. The child hands the server's number over, capped as the
// vendor's is.
test('Retry-After is read as delta-seconds or an HTTP-date, capped, and defaulted for a bare 429', () => {
  const { retryAfter } = httpKeyless;
  assert.deepEqual(retryAfter(429, '2'), { ms: 2000, capped: false, said: '2s' });
  assert.deepEqual(retryAfter(429, '99999'), { ms: firecrawl.MAX_RATE_LIMIT_WAIT_MS, capped: true, said: '99999s' });
  const now = Date.parse('2026-10-11T10:00:00Z');
  assert.deepEqual(retryAfter(503, 'Sun, 11 Oct 2026 10:00:30 GMT', { now }), { ms: 30_000, capped: false, said: '30s' });
  assert.deepEqual(retryAfter(429, 'Sun, 11 Oct 2026 09:00:00 GMT', { now }), { ms: 0, capped: false, said: '0s' }, 'a date in the past is no wait');
  assert.deepEqual(retryAfter(429, ''), { ms: firecrawl.MAX_RATE_LIMIT_WAIT_MS, capped: false, said: '' }, 'a 429 with no header waits the minute');
  assert.deepEqual(retryAfter(429, 'soon'), { ms: firecrawl.MAX_RATE_LIMIT_WAIT_MS, capped: false, said: '' });
  assert.equal(retryAfter(503, ''), null, 'a 503 is an instruction to wait only when it says so');
  // What is neither delta-seconds nor a date is no header at all, not a date long past.
  assert.equal(retryAfter(429, '1.5').ms, firecrawl.MAX_RATE_LIMIT_WAIT_MS);
  assert.equal(retryAfter(429, '+5').ms, firecrawl.MAX_RATE_LIMIT_WAIT_MS);
  assert.equal(retryAfter(429, '5, 10').ms, firecrawl.MAX_RATE_LIMIT_WAIT_MS);
  assert.equal(retryAfter(503, '-5'), null);
  assert.equal(retryAfter(503, '1.5'), null);
  // The three HTTP-date forms RFC 9110 accepts, each read as UTC, whatever this machine's zone:
  // the asctime form names no zone, and Date.parse read it as local time - an hour-ahead date
  // was "now" on a +0300 PC (review, 2026-10-18). The clock is fixed, so this runs anywhere.
  const { httpDate } = httpKeyless;
  const at = Date.UTC(2026, 9, 21, 7, 28, 0);
  const clock = Date.UTC(2026, 9, 21, 7, 27, 0);
  assert.equal(httpDate('Wed, 21 Oct 2026 07:28:00 GMT', clock), at, 'IMF-fixdate');
  assert.equal(httpDate('Wednesday, 21-Oct-26 07:28:00 GMT', clock), at, 'RFC 850, a two-digit year');
  assert.equal(httpDate('Wed Oct 21 07:28:00 2026', clock), at, 'asctime, read as UTC');
  assert.equal(httpDate('Sun Nov  6 08:49:37 1994', clock), Date.UTC(1994, 10, 6, 8, 49, 37), 'asctime pads a one-digit day with a space');
  assert.equal(httpDate('Sunday, 06-Nov-94 08:49:37 GMT', clock), Date.UTC(1994, 10, 6, 8, 49, 37), 'more than 50 years ahead is the previous century');
  for (const junk of ['-5', '1.5', '+5', '5, 10', 'soon', 'Wed, 31 Feb 2026 07:28:00 GMT', 'Wed, 21 Oct 2026 07:28:00 +0300', '2026-10-21T07:28:00Z', '']) {
    assert.equal(httpDate(junk, clock), null, `${JSON.stringify(junk)} read as a date`);
  }
  assert.deepEqual(retryAfter(429, 'Wed Oct 21 07:28:00 2026', { now: clock }), { ms: 60_000, capped: false, said: '60s' });
  assert.deepEqual(retryAfter(503, 'Wednesday, 21-Oct-26 07:28:00 GMT', { now: clock }), { ms: 60_000, capped: false, said: '60s' });
  assert.equal(retryAfter(500, '5'), null);
  assert.equal(retryAfter(404, '5'), null);
  // The loops read the result's number first, then the vendor's text.
  assert.equal(firecrawl.retryWaitMs({ retryAfterMs: 1000, error: 'Rate limit exceeded. please retry after 13s' }), 1000);
  assert.equal(firecrawl.retryWaitMs({ error: 'Rate limit exceeded. please retry after 13s' }), 14_000);
  assert.equal(firecrawl.retryWaitMs({ retryAfterMs: 10 ** 9 }), firecrawl.MAX_RATE_LIMIT_WAIT_MS);
  assert.equal(firecrawl.retryWaitMs({ error: 'HTTP 500' }), null);
});

test('the keyless child answers a 429 with the server\'s Retry-After as retryAfterMs, capped', async () => {
  const { spawn } = await import('node:child_process');
  const file = path.join(tempDir('fetchproof-limiting-server-'), 'server.mjs');
  writeText(file, `
import http from 'node:http';
const server = http.createServer((req, res) => {
  if (req.url === '/two') { res.writeHead(429, { 'content-type': 'text/plain', 'retry-after': '2' }); res.end('Too many'); return; }
  if (req.url === '/long') { res.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '99999' }); res.end('Unavailable'); return; }
  if (req.url === '/bare') { res.writeHead(429, { 'content-type': 'text/plain' }); res.end('Too many'); return; }
  res.writeHead(503, { 'content-type': 'text/plain' }); res.end('Unavailable');
});
server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));
`);
  const proc = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; const m = out.match(/PORT (\d+)/); if (m) resolve(Number(m[1])); });
    proc.on('exit', (code) => reject(new Error(`the limiting server exited ${code}`)));
  });
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].includes(name)));
  try {
    const two = httpKeyless.scrape(`http://127.0.0.1:${port}/two`, { env, timeout: 20_000 });
    assert.equal(two.ok, false);
    assert.equal(two.retryAfterMs, 2000, JSON.stringify(two));
    assert.equal(two.retryAfterCapped, undefined);
    assert.match(two.error, /^HTTP 429 - rate limited, the server asks for a retry after 2s - the server said: "Too many"/, two.error);
    const long = httpKeyless.scrape(`http://127.0.0.1:${port}/long`, { env, timeout: 20_000 });
    assert.equal(long.retryAfterMs, firecrawl.MAX_RATE_LIMIT_WAIT_MS, JSON.stringify(long));
    assert.equal(long.retryAfterCapped, true);
    assert.match(long.error, /^HTTP 503 - the server asks for a retry after 99999s/, long.error);
    const bare = httpKeyless.scrape(`http://127.0.0.1:${port}/bare`, { env, timeout: 20_000 });
    assert.equal(bare.retryAfterMs, firecrawl.MAX_RATE_LIMIT_WAIT_MS, 'a 429 with no header waits the minute');
    const plain = httpKeyless.scrape(`http://127.0.0.1:${port}/plain`, { env, timeout: 20_000 });
    assert.equal(plain.retryAfterMs, undefined, 'a 503 without Retry-After is a plain failure');
    assert.match(plain.error, /^HTTP 503 - the server said: "Unavailable"/, plain.error);
  } finally {
    proc.kill();
  }
});

// #316 (2026-10-11): `{"success": false, "error": "..."}` was recorded as "firecrawl's payload
// held no page text" - the vendor said why, and the ledger said something else.
test('a Firecrawl payload with success: false is a failure naming the vendor\'s own error', () => {
  const exec = (stdout) => () => ({ ok: true, status: 0, stdout, stderr: '' });
  const failed = firecrawl.scrape('https://x.invalid/p', { execFn: exec('{"success":false,"error":"Page could not be fetched: timeout"}') });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /firecrawl reported the scrape of https:\/\/x\.invalid\/p failed: Page could not be fetched: timeout/, failed.error);
  assert.doesNotMatch(failed.error, /no page text/);
  const silent = firecrawl.scrape('https://x.invalid/p', { execFn: exec('{"success":false}') });
  assert.match(silent.error, /failed, and gave no reason/);
  // The vendor's own words reach the exhaustion matcher now, as they reach a person.
  const dry = firecrawl.scrape('https://x.invalid/p', { execFn: exec('{"success":false,"error":"Insufficient credits to perform this request."}') });
  assert.equal(firecrawl.creditsExhausted(dry.error), true);
});
