# ADR-0044 — A preference can name a path on a shared host

- **Date:** 2026-09-26
- **Status:** accepted
- **Area:** collection, candidate ranking
- **Evidence:** collect run 36279879229 (2026-09-26); `fetchproof/test/collect.test.mjs`

## Context

`prefer` tells the ranker which pages OWN the fact: a candidate on a preferred domain gets
+10 over pages merely about it. It matched hosts only - the host itself or a subdomain.

On a host that serves everyone, the host is not the owner. Collect run 36279879229 was
dispatched with `prefer: github.com` to collect `actions/upload-artifact`'s release notes,
and it captured an unrelated repository's Actions run page
(`github.com/bitnami/support/actions/runs/...`). Every page on GitHub had earned the owner's
bonus, so the preference decided nothing. The kit's topic signal flagged the capture
("NOTHING matched strongly"); the ranking should not have needed it to. GitHub is the most
common case, because it is where most open-source projects keep their docs and releases.

## Decision

**A `prefer` entry may carry a path: `github.com/actions/upload-artifact` covers that
path and everything under it, on exactly that host.** A bare host keeps its old meaning,
the host and its subdomains. The rules:

- **At a segment boundary.** `/actions/upload-artifact` does not match
  `/actions/upload-artifact-v2`.
- **Exact host for a path entry.** A path belongs to one host, so it does not extend to
  subdomains: `gist.github.com` is a different site.
- **Read as people paste it.** A scheme, `www.`, case, a trailing slash, a query and a
  fragment are ignored. An entry with no host is no preference, never a match-everything.

This lives in one function (`parsePreference`, used by `rankCandidate`), so every entry
point gets it unchanged: plan files, per-query lists, the `collect.yml` input,
`collect-remote --prefer` and the MCP tool. All three human-facing descriptions show the
path form, and a test pins that they do.

## Rejected alternatives

- **A separate `prefer_paths` input.** `collect.yml` uses 9 of the 10 dispatch inputs
  GitHub allows, and a test says the next one must be a decision. Spending it on a second
  list that has to be kept in step with the first is the wrong use of the last slot.
- **Regular expressions or globs.** A dispatch input that the runner evaluates as a regex
  is a denial-of-service surface, and a pattern cannot be reviewed at a glance the way a
  path can.
- **Ranking a path match above a host match.** Nothing needs it yet. Listing both
  `github.com` and a repository on it is a contradictory hint, and the fix is to drop the
  bare host.
- **Special-casing github.com.** The same problem exists on every shared host (gitlab.com,
  npmjs.com/package/..., pypi.org/project/...). A path is the general answer.

## Consequences

- A bare-host entry written as `www.example.com` or `https://example.com` now matches. It
  matched nothing before, silently.
- `prefer: github.com` still means all of GitHub. It is not rewritten or warned about; the
  input descriptions say to name the path.

## Trigger that would reopen this

A shared host whose ownership cannot be expressed as a path prefix: owner in a subdomain
plus a path, or owner in a query parameter. Or a run where the right page lost to a
same-repository page that a path match could not tell apart.
