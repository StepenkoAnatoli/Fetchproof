# Discovery Contract - Who can see a public repository's workflow runs

Started 2026-09-21. This file is the definition of "enough information to build".

## Build intent

ADR-0035 measured what an **anonymous** caller can read of a workflow run on this public
repository, and closed with a section titled "What is NOT measured, and is therefore not
claimed": what a **signed-in** user sees in the web UI, which is a different surface from
the REST API.

That gap is load-bearing. The collector's logs echo the dispatched topic in an `env:`
group, and the artifact *is* the corpus - every collected page. If a signed-in stranger can
read either, then keeping the topic out of run and artifact names reduces incidental
exposure and nothing more.

"Done" is a rule an operator can apply before dispatching: who can read the shape, who can
read the contents, and what that means for a subject worth protecting.

## Unknowns

Status is exactly one of `CLOSED` or `KNOWN-UNKNOWN`.

| ID | Unknown | Why it blocks the build | Status | Evidence |
|---|---|---|---|---|
| U-1 | What is required to view workflow run information at all, on a public repository? | Decides whether "public" means anonymous-readable or account-readable, which are different exposures | CLOSED | E-03: "You must be logged in to a GitHub account to view workflow run information, **including for public repositories**." So the web surface starts at a signed-in account, not at the open internet - which is why the anonymous probe in ADR-0035 saw so little **CORRECTED 2026-09-21 by measurement: this is true of the WEB UI and false of the REST API.** An anonymous caller - no account, no token - receives `200` for run metadata, for the jobs listing including step names, and for the artifact listing including artifact NAMES. Only the bytes are withheld (`401`) and only raw logs are refused (`403`). The sentence quoted from E-03 is about signing in to github.com, not about the API, and reading it as the whole exposure understated it. [single-witness: GitHub is the only witness to its own permission model. Replaced by measurement, which caught an error a second reading would not have - the documented claim is true of the web UI and false of the REST API, where an anonymous caller gets 200] |
| U-2 | Can a signed-in user with no special relationship read the LOGS of a public repository's run? | The logs echo the dispatched topic. If they are readable, the subject is disclosed however the run is named | CLOSED | E-03: viewing, searching and downloading logs each state "**Read access to the repository is required** to perform these steps." On a public repository read access is universal, so the answer is yes - any account [single-witness: GitHub describing its own access rules. Measured instead: raw logs return 403 to an anonymous caller and 200 to a signed-in account with read access, which is the exposure this unknown asks about] |
| U-3 | Can such a user download the ARTIFACT? | The artifact is the whole corpus: every collected page, not just the topic | CLOSED | E-03, in the same sentence as log download: "You can also download a workflow's artifacts ... Read access to the repository is required to perform these steps." Yes - any account. The REST API refuses an anonymous caller `401`, and that refusal is about being anonymous, not about being a stranger [single-witness: same vendor, same permission model. Measured instead: the artifact listing returns 200 anonymously including artifact NAMES, while the zip returns 401 - so the bytes need an account and the name does not] |
| U-4 | How long does that exposure last, and can it be shortened per artifact? | If the window cannot be closed, the only control left is not collecting sensitive subjects here | CLOSED | E-02: `retention-days` on `actions/upload-artifact` sets a custom period per artifact - the example shows 5 days - and "The `retention-days` value cannot exceed the retention limit set by the repository, organization, or enterprise." E-01 carries the ceiling: 90 days by default on a public repository, adjustable 1-90 **Corroborated by E-04**, the `actions/upload-artifact` README on github.com, which states the same 1-90 bound from the maintainers rather than the docs team. |

## Questions for the human (maximum 3)

1. Should the collector set `retention-days` to something short by default? It cannot
   remove the exposure, only bound it, and a shorter window also means a corpus that must
   be fetched sooner.

## Already decided

- The topic stays out of run and artifact names regardless. This research narrows what that
  buys - it protects against listing-scrapers and shoulder-surfing, not against a signed-in
  reader who opens the run.

## Why U-1 to U-3 stay single-sourced, 2026-09-21

Deliberate, and this corpus is the one place where the reason is a principle rather than an
excuse. **These are questions about GitHub's own permission model, and GitHub is the only
witness to it.** A second page would be another team at the same company restating the first,
which is `one-voice` wearing two hostnames - and ADR-0036's amendment records how that
grading can invert.

What replaced corroboration is what ADR-0035 already argued for: **measurement**. Run
2026-09-21 against this repository, anonymous meaning no Authorization header at all:

| endpoint | anonymous | any signed-in account |
|---|---|---|
| `actions/runs/{id}` | **200** | 200 |
| `actions/runs/{id}/jobs` (step names) | **200** | 200 |
| `actions/runs/{id}/artifacts` (names) | **200** | 200 |
| `actions/artifacts/{id}/zip` (bytes) | **401** | 200 |
| `actions/runs/{id}/logs` | **403** | 200 |
| `actions/secrets` | 401 | 401 |

That is stronger than a second reading and it **caught an error a second reading would not
have**: U-1's answer, taken from the documentation, says an account is required to view run
information. For the API it is not.

The measurements are deliberately **not** filed as evidence rows. A probe is not a fetched
page, and `unknown-closure/no-evidence` exists to catch that substitution - the same call
made for U-6 of the delivery corpus and U-7 of the agent-interface one.

### One thing the probe found that nobody was looking for

The anonymous artifact listing returns artifact **names**, and this repository's are
`fetchproof-corpus-v1-gap-sea-assets` and `fetchproof-corpus-v1-gap-log-visibility`.

ADR-0033 forbids putting the topic in a run, step or artifact name, and that rule was kept -
no topic appears. But the name carries the **`client_ref`**, and the client_refs chosen were
descriptive of the subject. The discipline was applied to the field it named and not to the
field that actually renders into the public string. Recorded here rather than quietly fixed,
because the gap is in the rule's wording, not in anyone's compliance with it.
