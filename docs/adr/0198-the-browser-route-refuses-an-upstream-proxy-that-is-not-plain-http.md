# ADR-0198 — The browser route refuses an upstream proxy that is not plain HTTP

- **Date:** 2026-11-06
- **Status:** accepted
- **Area:** `fetchproof/lib/browser-guard.mjs` (`parseUpstream`, `startGuard`)
- **Prompted by:** the independent audit of `532c696` (Codex, 2026-11-04), finding F02 (High)
- **Extends:** ADR-0118 (a configured proxy is the guard's upstream), ADR-0047 (every request
  the kit makes uses a configured proxy)
- **Freeze (ADR-0117):** a bug fix. A proxy the guard could never speak to correctly is refused by
  name instead of being spoken to in the wrong protocol. No new error code, flag, check name or
  format: the guard child reports the refusal as its existing `GUARD` error.

## Context

ADR-0118 made a configured proxy the guard's upstream: a plain request is forwarded with its
absolute URL, a tunnel is opened with a CONNECT, and a credential in the proxy URL is sent as
`Proxy-Authorization`. The guard writes all of it in plain HTTP - `http.request` for a plain
request, `net.connect` and a written CONNECT line for a tunnel. `parseUpstream` kept the proxy's
host, port and credential and dropped its scheme, so `HTTPS_PROXY=https://proxy.corp:8443`, a
proxy reached over TLS, was spoken to in clear. The audit's probe, on a loopback listener, read a
CONNECT line as the first bytes - ASCII `C` (67), where a TLS handshake starts with 22 - and, with
a credential in the URL, the `Proxy-Authorization` header in clear. A proxy that takes only TLS on
that port refused the connection, so no render worked behind it; one that also took plain HTTP
there carried the render, with the credential exposed on the way. A `socks5://` proxy was misread
the same way.

The keyless route is not this code: Node reads the proxy variables itself (ADR-0047), and
`usableProxyUrl` passes it `http:` and `https:` URLs as they are. This decision does not change
that route, and whether Node speaks TLS to an `https:` proxy was not tested here.

## Decision

1. **The guard's upstream must be a plain-HTTP proxy.** `parseUpstream` throws for a proxy URL
   whose scheme is anything but `http:` - `https:`, `socks5:`, any other. A value with no scheme is
   still read as `http://`, as curl reads it, whatever its port. The message names the scheme, the
   host and the port, never the credential; it says the browser route speaks only plain HTTP to its
   proxy and asks for the proxy's `http://` address.
2. **Refused before anything is listened on, connected to or launched.** `startGuard` reads the
   upstream first, so the render's guard child answers with its existing `GUARD` error: no browser
   started, no render folder made, no byte sent to the proxy.
3. **Never replaced by a direct connection.** The operator named a proxy, which may be how this
   machine is allowed out; the render fails and says what to change.
4. **Judged only where it would be used.** With `NO_PROXY=*` every host is connected to directly,
   so the upstream is never used and not judged: that configuration rendered before and still does.

## Rejected alternatives

- **Speak TLS to an `https:` proxy** (the audit's first recommendation). It is the complete fix,
  and a new capability under the freeze (ADR-0117): a TLS client for the hop to the proxy, with
  the trust store, SNI, a certificate failure refused before any credential is sent, and the
  CONNECT exchange carried inside TLS, each needing tests against a TLS proxy fixture. The audit
  names a refusal before any connection as the smaller repair; this is it. Reopened by the first
  trigger below.
- **Go direct when the proxy cannot be spoken to.** It routes around the operator's proxy, which
  may be their egress control, and does it silently.
- **Warn and continue in plain HTTP.** A warning printed beside a credential already sent in clear
  protects nothing; that is the defect with a message attached.
- **Refuse whenever the variable is set, `NO_PROXY=*` or not.** It would break a configuration
  that worked - every request direct, the proxy never contacted - and protect nothing.

## Consequences

- An operator whose proxy variable (the first of `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`,
  `http_proxy` that is set) holds an `https://` or SOCKS URL cannot render with the browser route
  until it names the proxy's `http://` address; each render fails with the reason. A TLS-only
  proxy never carried a render before; a proxy that also took plain HTTP on its TLS port did, and
  no longer does.
- `doctor` does not report this; the first render does. A doctor line would be a new check under
  the freeze.
- A value from which no host can be read is still taken as no proxy at all, as before; that path
  is not changed here.
- The audit's own F02 assertion expects a TLS handshake from the guard, and stays red by design:
  this decision's tests assert the branch the audit gives for a refusal - nothing reaches the
  proxy.

## Trigger to revisit

- An operator needs the browser route behind a proxy reachable only over TLS: speak TLS to it,
  with tests for the trust store, an untrusted certificate refused before the credential is sent,
  and SNI.
- Node's own proxy support is found to speak plain HTTP to an `https:` proxy: the same refusal
  then belongs in `usableProxyUrl`, for the keyless route.
