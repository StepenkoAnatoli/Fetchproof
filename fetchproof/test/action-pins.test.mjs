// The weekly pin check (.github/scripts/check-action-pins.mjs): a pinned action whose commit
// stops resolving fails every workflow at checkout, before a test runs (break-test PR #140).

import { test, describe, assert, path, KIT_ROOT } from './harness.mjs';
import { pathToFileURL } from 'node:url';

describe('action-pins');

const load = () => import(pathToFileURL(path.resolve(KIT_ROOT, '..', '.github', 'scripts', 'check-action-pins.mjs')).href);

test('pins are read from uses: lines, once each, with the tag their comment names', async () => {
  const { pinnedActions } = await load();
  const pins = pinnedActions([
    '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1, resolved 2026-09-26\n'
    + '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n'
    + '      - uses: ./local-action\n'
    + '      - uses: owner/repo/sub/path@0123456789abcdef0123456789abcdef01234567',
  ]);
  assert.deepEqual(pins, [
    { owner: 'actions', repo: 'checkout', sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', tag: 'v7.0.1' },
    { owner: 'owner', repo: 'repo', sha: '0123456789abcdef0123456789abcdef01234567', tag: '' },
  ]);
});

test('a pin whose commit does not resolve is reported by name; a resolving one is not', async () => {
  const { checkPins } = await load();
  const good = { owner: 'actions', repo: 'checkout', sha: 'a'.repeat(40), tag: 'v1' };
  const gone = { owner: 'actions', repo: 'gone', sha: 'b'.repeat(40), tag: 'v2' };
  const fetch = async (url) => ({ ok: !url.includes('/gone/'), status: url.includes('/gone/') ? 404 : 200 });
  const result = await checkPins([good, gone], { fetch, token: '' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.dead.map((d) => `${d.owner}/${d.repo}`), ['actions/gone']);
  assert.match(result.dead[0].detail, /404/);
  assert.equal((await checkPins([good], { fetch, token: '' })).ok, true);
});

test('an API error that is not "no such commit" is not reported as a dead pin', async () => {
  // A rate limit or an outage says nothing about the pin - calling it dead would send the
  // reader to re-pin a healthy action.
  const { checkPins } = await load();
  const pin = { owner: 'actions', repo: 'checkout', sha: 'a'.repeat(40), tag: '' };
  const result = await checkPins([pin], { fetch: async () => ({ ok: false, status: 403 }), token: '' });
  assert.equal(result.dead.length, 0);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.ok, false, 'an unchecked pin is not a passing check either');
});

// Found 2026-09-30 on a host with no egress to api.github.com: every pin printed
// `request failed: fetch failed`, which is also what a mistyped proxy, a DNS failure and a
// TLS rejection produce - so the one line a weekly check prints when it cannot do its job
// named none of them. `fetchFailure` is the kit's existing answer (ADR-0047).
test('a request that never left names its cause, not the bare "fetch failed"', async () => {
  const { checkPins } = await load();
  const pin = { owner: 'actions', repo: 'checkout', sha: 'a'.repeat(40), tag: '' };
  const boom = () => { const err = new TypeError('fetch failed'); err.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.github.com' }; throw err; };
  const result = await checkPins([pin], { fetch: boom, token: '' });
  assert.equal(result.unknown.length, 1);
  assert.match(result.unknown[0].detail, /ENOTFOUND/);
  assert.doesNotMatch(result.unknown[0].detail, /^request failed: fetch failed$/, 'the cause was dropped');
  // A rejection with no cause at all still reports something, rather than "undefined".
  const bare = await checkPins([pin], { fetch: () => { throw new TypeError('fetch failed'); }, token: '' });
  assert.match(bare.unknown[0].detail, /request failed: fetch failed/);
});
