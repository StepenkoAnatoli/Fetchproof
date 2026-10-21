# Brief - Which licence should Fetchproof publish under so that people and agents may install and run it, and may the cached third-party pages in its research corpora be redistributed under it

_Auto-drafted 2026-10-02 by `bin/brief.mjs` from the corpus. Sections marked **TODO**
require the reviewing agent's judgement; everything else is assembled from evidence already
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

## Intent

A decision about this repository (ADR-0030): which licence the kit should publish under,
given that its own README tells people and agents to clone it and install it machine-wide
while LICENSE says all rights are reserved and no licence is granted - and whether the
cached third-party pages under every `research/raw/` in `docs/decisions/` may be
redistributed with it. Raised by an outside review on 2026-10-02. Done means the corpus
says what a public repository with no licence grants today, what the candidate licences
grant and withhold (permissive, and source-available with a commercial restriction), what
the most-cached sources licence their pages under, what copyright law allows for whole
copies kept as evidence, how web archives and crawl corpora handle the same question, and
whether a per-path split - the code under one licence, the captures excluded and labelled -
can be expressed and is recognised. The output is an ADR naming the licence and the
wording of a NOTICE for the captures; the choice between the candidates is the owner's.

## What we verified

| Claim | Source | Type |
|---|---|---|
| GitHub's terms grant a visitor of a public repository exactly two things on the platform, viewing and forking, and nothing beyond it: [quote: By setting your repositories to be viewed publicly, you agree to allow others to view and "fork" your repositories]. Installing, running and modifying the kit on a machine are not among them. | E-25 `docs.github.com` (U-01) | P |
| With no licence the default is exclusive copyright, and the README's install instruction is unlicensed use: [quote: If you find software that doesn’t have a license, that generally means you have no permission]; the page adds that [quote: nobody else can copy, distribute, or modify your work without being at risk of take-downs, shake-downs, or litigation]. | E-26 `choosealicense.com` (U-01) | P |
| MIT, as GitHub's licence chooser describes it: [quote: A short and simple permissive license with conditions only requiring preservation of copyright and license notices.] Commercial use, distribution and modification are permitted; no patent grant. | E-27 `choosealicense.com` (U-02) | P |
| Apache-2.0 is the permissive licence with the patent clause: [quote: Contributors provide an express grant of patent rights.] It otherwise matches MIT in what it permits and requires notice of changes. | E-28 `choosealicense.com` (U-02) | P |
| The Apache-2.0 text carries the clause itself, section 3: [quote: Grant of Patent License]. That is the one difference from MIT that matters for a tool others build on. | E-29 `apache.org` (U-02) | P |
| The MIT text as the Open Source Initiative publishes it, the second host for the MIT claim: [quote: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files], with the notice condition and the warranty disclaimer and nothing else. | E-47 `opensource.org` (U-02) | P |
| PolyForm Noncommercial 1.0.0 permits everything that is not commercial: [quote: Any noncommercial purpose is a permitted purpose.] An agent running the kit for a company's project is commercial use and would need permission. | E-44 `polyformproject.org` (U-03) | S |
| PolyForm Shield 1.0.0 permits every purpose, commercial included, except competing with the licensor: [quote: Any purpose is a permitted purpose, except for providing any product that competes with the software or any product the licensor or any of its affiliates provides using the software.] This is the licence that matches "use, but not resale as a competing product". | E-46 `polyformproject.org` (U-03) | S |
| Business Source 1.1 is source-available with a scheduled conversion to an open licence: [quote: Effective on the Change Date, or the fourth anniversary of the first publicly available distribution of a specific version of the Licensed Work under this License, whichever comes first]. Production use before that date needs an Additional Use Grant the licensor writes. | E-30 `mariadb.com` (U-03) | P |
| Elastic License 2.0 permits use and modification and forbids one thing: [quote: You may not provide the software to third parties as a hosted or managed service, where the service provides users with access to any substantial set of the features or functionality of the software.] Not a fit for a kit nobody hosts. | E-31 `elastic.co` (U-03) | P |
| GitHub Docs content is under Creative Commons Attribution 4.0 - the repository's LICENSE file is the licence text itself: [quote: Attribution 4.0 International]. A capture of a docs.github.com page may be redistributed with attribution. | E-32 `raw.githubusercontent.com` (U-04) | P |
| Google developer documentation is CC BY 4.0: [quote: Google Developers documentation is largely licensed under Creative Commons Attribution 4.0, allowing reuse and modification with attribution.] Captures of developers.google.com pages may travel with attribution; code samples are Apache-2.0. | E-33 `developers.google.com` (U-04) | P |
| The nodejs.org site is MIT: [quote: Copyright Node.js Website WG contributors. All rights reserved.] followed by the MIT grant, [quote: Permission is hereby granted, free of charge, to any person obtaining a copy]. Captures of nodejs.org pages may be redistributed with the notice. _(partial capture)_ | E-34 `raw.githubusercontent.com` (U-04) | P |
| The npm documentation repository is Creative Commons Attribution 4.0, its LICENSE being the licence text: [quote: Attribution 4.0 International]. Captures of docs.npmjs.com pages may be redistributed with attribution. | E-24 `raw.githubusercontent.com` (U-04) | P |
| arXiv papers carry the licence their authors chose, and the page lists the choices, among them [quote: CC BY 4.0]; the default is arXiv's own perpetual non-exclusive licence, which grants arXiv distribution rights and does not license readers to redistribute. A paper capture must be checked per paper. | E-35 `info.arxiv.org` (U-04) | P |
| Wikipedia text is CC BY-SA: [quote: Creative Commons Attribution-ShareAlike 4.0 International License]. A capture may be redistributed with attribution and under the same licence, which a per-path NOTICE can state. | E-36 `en.wikipedia.org` (U-04) | P |
| The statute: a use for [quote: scholarship, or research, is not an infringement of copyright.] when it is fair, judged by four factors; purpose, nature, amount and market effect. A whole-page copy kept as evidence weighs on the amount factor, and the statute gives no safe harbour for completeness. | E-37 `law.cornell.edu` (U-05) | P |
| The Copyright Office names research among the examples that may qualify, and the test: [quote: Section 107 calls for consideration of the following four factors]. Fair use is decided case by case; it is a defence, not a licence, so a NOTICE cannot claim it. | E-38 `copyright.gov` (U-05) | P |
| The whole-copy archiving precedent went against the archive: [quote: On September 4, 2024, the Second Circuit Court of Appeals affirmed the lower court rulings.] - the Internet Archive's scanned-book lending was held not fair use. A kit that redistributes whole copies of pages cannot assume fair use covers it. | E-39 `en.wikipedia.org` (U-05) | S |
| The Internet Archive distributes whole captured pages and limits the grant it makes: [quote: Access to the Archive’s Collections is provided at no cost to you and is granted for scholarship and research purposes only.] It claims no licence over the content and passes responsibility to the user. | E-40 `archive.org` (U-06) | P |
| Common Crawl distributes whole crawled pages the same way, disclaiming any licence over them: [quote: BY USING THE CRAWLED CONTENT, YOU AGREE TO RESPECT THE COPYRIGHTS AND OTHER APPLICABLE RIGHTS OF THIRD PARTIES IN AND TO THE MATERIAL CONTAINED THEREIN.] The practice this kit can follow: distribute for research, grant nothing over the captures, say so. | E-41 `commoncrawl.org` (U-06) | P |
| GitHub detects one licence from LICENSE and says what to do with a split: a repository with [quote: it may contain multiple licenses or other complexity.] is not detected, so the LICENSE file stays a single licence and the exclusion of research/raw is stated elsewhere - the README and a NOTICE. | E-42 `docs.github.com` (U-07) | P |
| REUSE 3.3 is the per-file standard: [quote: The `SPDX-License-Identifier` tag MUST be followed by a valid SPDX License] identifier, with REUSE.toml for whole directories, which is how the captures under research/raw can carry a different, explicit marking from the code. | E-43 `reuse.software` (U-07) | P |

## Contradictions and how they were resolved

- **GitHub's terms permit viewing and forking; LICENSE forbids copying.** Not a contradiction
  but a boundary: the platform grant (E-25) covers what happens on GitHub and nothing else,
  and the no-licence default (E-26) governs the rest. The README's clone-and-install
  instruction is outside both. Resolved by changing the licence, not the README.
- **Fair use names research as an example; the whole-copy archiving case went against the
  archive.** Both true (E-37, E-38, E-39). Fair use is a four-factor defence decided case by
  case, so no NOTICE can claim it in advance; the archives that distribute whole pages
  (E-40, E-41) do not claim it either - they grant nothing over the content, state the
  research purpose, and put the duty to respect third-party rights on the user. That is the
  practice adopted here.
- **GitHub says keep LICENSE to one licence; REUSE marks files individually.** Complementary
  (E-42, E-43): one licence in LICENSE so GitHub detects it, and `REUSE.toml` plus a NOTICE
  to mark `research/raw/` as outside that grant.
- **The licence texts read as one voice.** The checker grouped choosealicense.com, apache.org
  and opensource.org as republished copies of each other (U-02's single-witness note). They
  are: a licence is one fixed text, and that sameness is the fact relied on.
## Known unknowns

None. Every blocking unknown was closed with cited evidence.

## Decision

The choice is the owner's. The corpus supports two candidates for the code, and one
answer for the captures.

**For the code, in the order the evidence favours given the stated wish "people and agents
may install and run it, but not resell it":**

1. **PolyForm Shield 1.0.0** (E-46): every purpose is permitted, commercial use and
   modification included, except providing a product that competes with the software or
   with what the licensor provides using it. An agent on anyone's machine may install and
   run the kit; a company may use it on its own projects; nobody may ship it as a competing
   product. Not an open-source licence by the OSI definition, which rules it out of some
   package indexes and corporate allow-lists.
2. **Apache-2.0** (E-28, E-29) if adoption matters more than control: permissive, with the
   express patent grant MIT lacks (E-27, E-47), and it allows resale.

Rejected by the evidence: PolyForm Noncommercial (E-44), because an agent researching a
company's project is commercial use; Business Source 1.1 (E-30), because a change date
and a licensor-written use grant are machinery for a product company, not a kit; Elastic
2.0 (E-31), because its one restriction, hosting as a managed service, is not the one
wanted. Keeping "all rights reserved" and deleting the install instructions is the third
option, and it contradicts what the kit is for.

**For the captures under `research/raw/`, whichever licence the code takes:**

- Exclude them from the code licence. One licence in `LICENSE` so GitHub detects it
  (E-42); a `REUSE.toml` entry marking `**/research/raw/**` with a `LicenseRef-` identifier
  (E-43); and a `NOTICE` that says, in the archives' words (E-40, E-41): the pages are
  reproduced as research evidence and provenance, copyright stays with their owners, no
  licence is granted over them by this repository, and a user must respect the rights of
  third parties in them.
- Where a source's own licence permits redistribution, say so beside it: GitHub Docs and
  the npm documentation (CC BY 4.0, E-32, E-24), Google developer documentation (CC BY
  4.0, E-33), nodejs.org (MIT, E-34), Wikipedia (CC BY-SA 4.0, E-36). A paper from arXiv
  carries its own licence per paper (E-35); a vendor's terms page carries none. Those stay
  under the NOTICE's "no licence granted" wording.
- Do not rewrite history to remove captures, and do not claim fair use in the NOTICE:
  the statute and the 2024 precedent (E-37, E-39) make it a case-by-case defence, not a
  grant.

**First build step:** an ADR that records the owner's choice and the rejected candidates
above, then in one commit: the new `LICENSE` text, `NOTICE`, `REUSE.toml`, and the README's
licence section rewritten to say what the kit may be used for and what the captures are.
**Out of scope:** relicensing anyone else's contribution (there is one author), moving the
corpora out of the repository, and any kit check that judges a licence - a check that
judges prose is one the project refuses.
## Next steps

1. The Contradictions and Decision sections above are answered; the owner picks the licence.
2. Hand this file to the builder (phase 2). Re-running `node "$HOME/.agents/fetchproof/bin/brief.mjs"`
   redrafts this file while it is unedited; after any edit it refuses without `--force`,
   so your judgements are preserved.
<!-- fetchproof:brief-draft body=a1f35ab16643c389 inputs=daeeb76a6417cc99 gate=pass -->
