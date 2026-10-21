# ADR-0110 — A redirect may not lead the collector into this machine's network

- **Date:** 2026-09-30
- **Status:** accepted
- **Area:** `lib/http-transport.mjs` (`internalTarget`, the child's redirect loop)

## Context

The keyless transport fetched with `redirect: 'follow'`. A page on the public web answering
`302 -> http://127.0.0.1:<port>/...` was followed and captured, so an internal admin page, or
the cloud metadata endpoint at `169.254.169.254`, became an evidence row with whatever it
held. That was confirmed on 2026-09-30 (break-test PR #176). `research --url` and
`collect.yml` take arbitrary URLs, and a page chosen from a search result is not the
operator's choice at all.

## Decision

- **Redirects are followed one hop at a time** (at most 20, as `fetch` allows), and each
  hop's destination is judged before it is fetched.
- **An internal destination is refused.** That covers loopback, the private ranges,
  link-local (which holds the metadata endpoint), carrier-grade NAT, unspecified, multicast
  and reserved space. It also covers their IPv6 counterparts, IPv4 written as IPv6, and
  `localhost` / `*.localhost`. A host name counts as internal when any address it resolves
  to is internal.
  - The fetch fails, naming both hosts and the reason, and is recorded against the URL that
    was asked for. Nothing behind the redirect is read.
- **An internal URL the operator asked for is theirs.** When the requested URL is itself
  internal, redirects that lead to internal addresses are followed. This keeps an intranet
  page, a local test server and a self-hosted service working.
- **`FETCHPROOF_ALLOW_INTERNAL_REDIRECTS=1`** lifts the check for a machine whose public
  pages legitimately redirect inward. Only the value `1` does.
- **A name this machine cannot resolve is not judged.** Behind a proxy, the proxy resolves
  names, and a name that nothing here can resolve is not this machine's network.

## Not covered, and why

- **The first URL.** A URL the operator typed is not second-guessed. A planned or searched
  URL that is itself internal is still fetched, as the operator's own statement.
- **The `browser` transport.** Chromium follows redirects inside the browser, and the kit
  sees only the final page. Refusing there needs Chromium's request interception, a larger
  change. **Trigger:** the browser transport gains request interception for another reason,
  or a report shows it reaching an internal address.
- **DNS rebinding.** A name is resolved to judge it, then resolved again by `fetch`, and the
  two answers can differ. Pinning the connection to the judged address would need a custom
  dispatcher. **Trigger:** a report of a rebinding against the collector.
- **Firecrawl.** It fetches from its own servers, not this machine's network.

## Rejected alternatives

- **Refuse every internal address, the first URL included.** That breaks intranet research,
  local test servers and a self-hosted SearXNG, all of which the operator names on purpose.
- **Keep following, and flag the capture afterwards.** By then the internal page's contents
  are on disk and in the ledger. The point is not to read them.
- **No opt-out.** A real deployment can have public pages that redirect to an internal host,
  such as a single sign-on hop. One named variable is cheaper than a fork.
