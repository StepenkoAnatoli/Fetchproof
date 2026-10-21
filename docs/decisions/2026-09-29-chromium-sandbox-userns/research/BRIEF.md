# Brief - Chromium's sandbox on Ubuntu 23.10+: why it fails under AppArmor's unprivileged user namespace restriction, and the supported ways to run headless Chromium there

_Auto-drafted 2026-09-29 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require human/agent judgement; everything else is assembled from evidence already
in `research/`. While a **TODO** remains, this brief is **not reviewed** and the
handoff is **not approved** - a structurally valid corpus, a reviewed one, and an
approved handoff are three different states._

Reviewed by: agent

**This is the phase-1 to phase-2 handoff.** **Gate: PASS.** Every blocking unknown is closed with evidence, and every claim below
traces to a cached page in `research/raw/`.

Whoever you are - another agent, a different model, or a person - read this file
first. You should not need to re-research anything to start work. If something
here is not enough to build from, say which fact is missing rather than guessing
it: that is a phase-1 gap to close, not a phase-2 judgment call.

## The prior, registered before anything was collected

_Ledger seq 1, chained: neither this text nor its place before the evidence
can be changed now. Read it against the findings below - it may well be wrong, and a wrong
prior that was recorded in advance is worth more than a right one remembered afterwards._

> I expect Ubuntu 23.10+ to restrict unprivileged user namespaces through AppArmor (kernel.apparmor_restrict_unprivileged_userns=1), which Chromium's namespace sandbox needs; the supported fixes to be an AppArmor profile for the browser binary or turning the sysctl off, with --no-sandbox documented as insecure. A kit rendering arbitrary pages should keep the sandbox and name the fix, not drop it.

## Intent

The kit's browser transport crashed on GitHub's Ubuntu runner with Chromium's "No usable
sandbox!". Done means knowing why the sandbox cannot start there, which remedies keep it,
and whether dropping it (--no-sandbox) is acceptable for a tool that renders arbitrary pages.

## What we verified

| Claim | Source | Type |
|---|---|---|
| Ubuntu (Canonical): from 23.10, AppArmor decides per application whether an unprivileged process may create user namespaces; an application needs a profile with the userns rule, and Ubuntu ships such profiles for the programs it surveyed, Chrome among them. [quote: AppArmor can be used to selectively allow and disallow unprivileged user namespaces] [quote: This change impacts some programs like Firefox, Chrome, and many more] | E-01 `ubuntu.com` (U-01) | P |
| Chromium's own doc (the one its 'No usable sandbox!' FATAL points to): Ubuntu's AppArmor profile covers Chrome stable at /opt/google/chrome/chrome only; other builds need the sysctl turned off (disables the feature globally), their own profile, or the setuid helper via CHROME_DEVEL_SANDBOX=/opt/google/chrome/chrome-sandbox (the safest); --no-sandbox disables critical security features and must never be used on the open web. [quote: Ubuntu ships with an AppArmor profile that applies to Chrome stable binaries] [quote: should never be used when browsing the open web] [quote: the setuid sandbox helper (the old version of the sandbox) is available at] | E-02 `raw.githubusercontent.com` (U-02, U-03) | P |

## Contradictions and how they were resolved

None. Ubuntu (E-01) and Chromium (E-02) describe the same mechanism from each side:
- Ubuntu's AppArmor profiles decide which binaries may use user namespaces.
- Chromium's doc says which binary Ubuntu's profile covers.

The first live run adds the observed fact that both describe. On GitHub's `ubuntu-latest`,
the kit's browser was denied, and the run died with this FATAL:

`No usable sandbox! If you are running on Ubuntu 23.10+ ...`

This happened in live-collection run 36519301132.

The prior was right about the cause and about not dropping the sandbox. It missed that a
binary which is already allowlisted exists (Chrome stable). So the fix is mostly the choice
of binary, not a system change.

## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

**Keep the sandbox. Prefer the binary Ubuntu allows, and name the remedies when it is
denied.**

- **Search order:** on Linux, `findBrowser` tries Google Chrome stable first:
  - `/opt/google/chrome/chrome`, which is what Ubuntu's AppArmor profile covers (E-02);
  - then the `google-chrome` launchers, which exec it;
  - then the Chromium builds.
- **Error message:** a crash whose FATAL says "No usable sandbox" gets the kit's remedies,
  in the order Chromium ranks them:
  1. use Chrome stable, or point `browserPath` at it;
  2. set `CHROME_DEVEL_SANDBOX=/opt/google/chrome/chrome-sandbox` for another build;
  3. an AppArmor profile, or the sysctl, which switches the feature off system-wide.
- **Never `--no-sandbox` for a non-root user.** Chromium says it must never be used on the
  open web (E-02), and ADR-0088's root-only exception stands.

**Out of scope:**
- Changing the runner's sysctl in the live workflow. It would test a machine unlike the
  users' machines, and it switches off a security feature to make a check pass.
- Setting `CHROME_DEVEL_SANDBOX` silently on the user's behalf.

**First build step:**
1. Reorder `USUAL.linux` in `lib/browser-transport.mjs`, with a test that the Chrome
   stable path wins when present.
2. Add a test that a "No usable sandbox" crash names the remedies and never suggests
   `--no-sandbox`.
3. Re-run live-collection with `transport=browser`. Its "a browser is installed" step
   prints which binary was chosen.

## Next steps

1. Build the change above, with its ADR, in the same commit.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.

<!-- fetchproof:brief-draft body=b931f1d54e5bf79f inputs=04dcf063e8523a0c gate=pass -->
