# ADR-0124: The guard drops the browser's own service traffic

Date: 2026-10-02
Status: accepted

## Context

The browser transport renders every page through the guard (ADR-0118), so that every
request Chromium makes is judged and nothing reaches this machine's network. Measured on
2026-10-02 (break-test), rendering a plain page served from loopback through Chromium
141 with the kit's flags, the guard carried, as external and allowed:

| request | what it is |
|---|---|
| `http://clients2.google.com/time/1/current?cup2key=...` | the component updater's clock, carrying a key |
| `CONNECT www.google.com:443` x4 | the default search engine's preconnect |
| `CONNECT accounts.google.com:443` x2 | sign-in and account consistency |
| `CONNECT android.clients.google.com:443` | the Cloud Messaging check-in |
| `CONNECT mtalk.google.com:5228` | the Cloud Messaging push channel |

Nine connections per render that no page asked for. On a research tool whose claim is
that every fetch is on record, every render phoned Google; and in the "offline" suite, a
no-network host turned the LIVE browser-guard test red - the guard refused
`www.google.com` as unresolvable, and that refusal, the last one recorded, became the
verdict instead of the internal-address refusal the test was about.

Each remedy short of the guard was measured on the same page:

- the kit's own flags - `--disable-background-networking`, `--disable-component-update`,
  `--disable-sync`, `--no-first-run` - were already on; all nine remained;
- Playwright's feature disables (`NetworkTimeServiceQuerying`, `OptimizationHints`,
  `MediaRouter`, `Translate`, `PushMessaging`, ... ) with `--metrics-recording-only`,
  `--no-pings`, `--disable-domain-reliability` and the rest: the clock request went, the
  other eight remained;
- a fresh profile whose preferences switch off network prediction, sign-in, push
  messaging and safe browsing: all remained;
- Chromium's endpoint-override switches (`--gcm-mcs-endpoint`, `--gcm-checkin-url`,
  `--gaia-url`, `--google-base-url`) pointed at `.invalid` names: the traffic moved to
  those names and the guard then recorded it as refusals; `www.google.com` remained;
- `--headless=old`: removed from the Chrome binary ("use chrome-headless-shell");
- `chrome-headless-shell`, where Playwright's cache holds it, made no stray request - but
  it is not what an operator with Chrome or Chromium has, and with the kit's flags it
  timed out on the plain page here.

## Decision

The guard knows the browser's own service hosts by name (`BROWSER_SERVICE_HOSTS`:
`clients*.google.com` and `*.clients.google.com`, `mtalk.google.com` and its `alt*-`
mirrors, `accounts.google.com`, `www.google.com`, the update, safe-browsing, variations,
optimization-guide and autofill endpoints on `googleapis.com`, `*.gvt1.com`,
`dl.google.com`). A request to one of them is **dropped**: answered 403 with
`DROP_MARKER`, logged `dropped` in the guard's record, not judged, not carried, and not
counted as a refusal - a page did not try to go there, so the render's verdict does not
mention it. The page the operator asked for is exempt by host and port, as it is from
every other judgment, so a page on `www.google.com` still renders; the same host on
another port is the browser's again.

## Rejected

- **Flags and profile preferences alone.** Measured above: they leave most of the traffic,
  and which they leave changes with the Chromium version. The guard is the one place every
  request passes through, and its answer does not depend on the version.
- **Preferring `chrome-headless-shell`.** It made no stray request, but it is a separate
  download most operators do not have, and the transport's flags did not render through it
  here. If an operator points `FETCHPROOF_BROWSER` at one, the drop list is simply never
  consulted.
- **Refusing the traffic as the guard refuses an internal address.** A refusal is the
  page's doing and names the page's verdict; this traffic is the browser's, and recording
  it as a refusal is exactly what turned the offline LIVE test red.
- **Accepting it as the cost of a real browser.** The transport's claim is that every
  request is on record and judged; nine unasked connections to one vendor per render,
  one carrying a key, is the claim being false.

## Consequences

- A render makes no request the page did not cause. The LIVE pin renders a loopback page
  and asserts that every request beyond loopback was dropped and none was refused.
- A page whose content genuinely lives on one of these hosts - a Google search results
  page is the likely case - renders only when asked for by that host and port; its
  resources from `www.google.com` on a page elsewhere (a reCAPTCHA widget, a "sign in
  with Google" frame) are dropped, and neither is evidence.
- The list is Chromium 141's; a future Chromium that phones a host not on it shows up in
  the LIVE pin as a carried request beyond loopback, which is the signal to extend it.
