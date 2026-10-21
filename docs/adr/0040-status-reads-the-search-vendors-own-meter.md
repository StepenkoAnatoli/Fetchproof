# ADR-0040 — `--status` reads the search vendor's own meter

- **Date:** 2026-09-26
- **Status:** accepted
- **Area:** search seam, status, credentials
- **Depends on:** ADR-0027 (search and fetch are two seams)
- **Evidence:** `research/` U-9, U-10, U-11 (E-25, E-26, E-27); `docs/measurements/2026-09-26-serpapi-account/account.json`

## Context

`research.mjs --status` reported the search meter from this machine's own usage log, beside
two hard-coded caps: 50 searches an hour and 250 a month. The research of 2026-09-26 found all
three wrong for the purpose the operator reads them for:

- **The hourly cap is the documented plan, not the account.** The pricing page and FAQ say 50
  (E-25, E-27); SerpAPI's Account API reported `account_rate_limit_per_hour: 250` for this
  account, a field it defines as "your account's hourly throughput limit" (E-26).
- **The month is the wrong month.** The kit counted from the 1st (UTC); SerpAPI's allowance
  "restarts ... on the first day of your billing cycle's subscription" (E-27). This account
  renews on the 14th.
- **The count is one machine's.** The code already said so: it cannot see searches made from
  another machine on the same account, and it over-counts repeats served from the free cache.

SerpAPI answers all three itself, at `GET serpapi.com/account.json`, and documents that call as
"free of charge, and using it will not be counted toward your monthly quota" (E-26). Measured:
`this_month_usage` stayed at 152 across several account calls in one session.

## Decision

**When the selected search adapter can read its vendor's meter and a key is configured,
`--status` reads it and prints it as its own line, labelled as the vendor's count.**

- The read lives in the adapter (`serpapi.account()`), so the vendor stays named only in its
  own module (NFR-3). `--status` asks whatever search adapter was selected; one without an
  `account` function, or with no key, makes **no call** and prints nothing (FR-5).
- **Whitelist, not pass-through.** The payload carries `account_email`, `account_id` and, in
  the documented example, `api_key`. `normalizeAccount` copies only the fields it names.
- **Same safeguards as `search()`**: the child-process rendezvous, the key only in the request
  URL built in the child, `redact` on every error, and `allowedEndpoint` (the vendor's host or
  loopback) checked before anything is sent.
- **The endpoint is overridable by environment** (`FETCHPROOF_SEARCH_ACCOUNT_ENDPOINT`), and
  only within `allowedEndpoint`. Every CLI test points it at a dead loopback port, so no test
  can reach the network — or spend a real key the machine config holds.
- A failed read is reported ("unavailable from ...") and `--status` still exits 0. The local
  count and the documented caps stay on screen either way; the vendor line is added, not
  substituted.
- `status()` on the adapter stays offline. It is a probe other callers use, and making it spend
  a network call would change what every one of them costs.

## Rejected alternatives

- **Keep `--status` offline and only label the caps.** That was the state of 2026-09-26's first
  change (METER_NOTES). It tells the operator the numbers are wrong without telling them the
  right ones, when the right ones are one free call away. Kept as the fallback text, not as the
  answer.
- **An opt-in flag (`--vendor-meter`).** A key being configured is already the opt-in: it is
  what selects SerpAPI at all (ADR-0027). A second switch would mean the default `--status`
  shows a count the kit knows to be wrong.
- **Replace the local count with the vendor's.** The local count is the only one that can say
  what *this machine* spent, and the only one available when the vendor is unreachable. Both
  are shown.
- **Enforce the vendor's limits** (refuse a run near the cap). RR-5 already rejected a throttle:
  the vendor answers an over-limit request itself, and the merge degrades on it. A number read
  a moment before a run is not a reason to refuse one.

## Consequences

- `--status` makes one network request when a SerpAPI key is configured. It is free and
  uncounted (E-26); it costs up to 10 seconds when the vendor is slow, bounded by
  `ACCOUNT_TIMEOUT`.
- A key held only in the machine config is used here as it is by `search()` (fixed the same
  day: until then `search()` ignored it).

## Trigger that would reopen this

SerpAPI documenting a charge for `account.json`, or removing `account_rate_limit_per_hour` or
`plan_renewal_date` from it — re-read `serpapi.com/account-api` (E-26) if the vendor line starts
showing `?` for fields that used to be numbers.
