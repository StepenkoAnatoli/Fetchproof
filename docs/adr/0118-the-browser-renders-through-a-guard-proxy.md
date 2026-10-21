# ADR-0118 — The browser renders through a guard proxy that judges every request

- **Date:** 2026-10-01
- **Status:** accepted; supersedes ADR-0115
- **Area:** `lib/browser-guard.mjs` (new), `lib/browser-transport.mjs`

## Context

ADR-0110 refused a redirect into this machine's network for the keyless fetch and left the
browser transport open. ADR-0115 closed part of it by following the URL's server redirects
before Chromium started, and deferred the rest with a trigger: navigation a page makes after
it loads - a script setting `location`, a `<meta http-equiv="refresh">` - and the images,
frames and scripts it loads, all happen inside Chromium, where nothing judged them. The owner
asked for the full fix now rather than later.

Measured on 2026-10-01 with Chromium 141 behind a proxy on a loopback port: a page
navigating by script and one with a meta refresh both reached the address they named, and a
proxy that answered 403 was what Chromium rendered instead. Chromium bypasses a proxy for
loopback addresses unless told otherwise (`--proxy-bypass-list=<-loopback>`), and makes
background requests of its own (update checks, a time probe, sign-in) unless those are
switched off.

## Decision

- **Chromium renders through a proxy the kit runs** (`browser-guard.mjs`), on a loopback
  port, with the loopback bypass turned off. Every request Chromium makes - a plain request
  or a CONNECT tunnel for https - is judged there before a byte is sent, by the rule the
  keyless fetch uses (`isInternal`, ADR-0110): loopback, the private ranges, link-local, CGNAT,
  `localhost`, and a name that resolves to any of them. The connection then goes to the
  address that was judged (ADR-0114).
  - The `host:port` of the URL the operator asked for is exempt: the page itself has to load.
    Only that port, not every port on its host.
  - An internal URL the operator asked for makes the whole render theirs, as for the keyless
    fetch; `FETCHPROOF_ALLOW_INTERNAL_REDIRECTS=1` lifts the check.
  - A refused request is answered with a 403 whose body carries a marker. When the DOM
    Chromium prints is that marker, or Chromium's own error page after a refused tunnel, the
    transport reports the refusal by name and keeps nothing. A refused image on a page that
    still rendered is not a failure of the capture.
- **A configured proxy is the guard's upstream**, never Chromium's directly: plain requests
  are forwarded with their absolute URL, tunnels with a CONNECT, credentials in the proxy URL
  as `Proxy-Authorization`. Behind a proxy a name is resolved there, so an unresolvable name
  is not judged (ADR-0110); an address or a name that does resolve inward is.
- **The guard and Chromium run in a child process.** The transport's parent half runs under
  `spawnSync`, which blocks the event loop, so a proxy in that process would never answer.
  The child takes one job on stdin and prints one JSON line: the DOM, Chromium's exit, the
  refusals. Chromium is its own process group, killed whole on a timeout, and its exit is
  reported after a short grace even when a helper it forked still holds its output open.
- **Chromium's background traffic is switched off** (`--disable-background-networking`,
  `--disable-component-update`, `--disable-sync`, `--no-default-browser-check`): each such
  request would otherwise go through the guard too.
- **The server-redirect check of ADR-0115 is removed.** The guard sees the same hops, and a
  second fetch of the page before Chromium's was a cost with no coverage of its own.

## Not covered, and why

- **What a page does with what it loaded.** The guard judges where requests go, not what
  the page then renders.
- **A proxy that resolves names inward.** Behind an upstream proxy, a name the guard cannot
  resolve is the proxy's to resolve, and the proxy may reach addresses this machine cannot.
  That is the proxy's policy, not the kit's.

## Rejected alternatives

- **Drive Chromium through its DevTools protocol and intercept requests.** Needs a WebSocket
  client written by hand (the kit has no dependencies) and a different way of running the
  browser, for the same coverage the proxy gives.
- **Keep the ADR-0115 pre-check beside the guard.** Two mechanisms for one rule, and the
  pre-check's extra fetch of every page.
- **Judge by hostname rather than host:port.** A second service on the same host as the page
  asked for - the common shape of an internal network - would have been exempt with it.
