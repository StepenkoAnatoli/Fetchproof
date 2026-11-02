# Evidence

One row per fetched page. `Raw` points at the cached page text under `research/raw/`,
which is what makes the claim checkable - a row without raw evidence fails preflight.

The `Finding` cell arrives as an auto-extracted summary. Rewrite it into a real claim:
what the page actually establishes, with the quote or number that proves it.

| ID | Retrieved | Type | URL | Finding | Raw |
|---|---|---|---|---|---|
| E-01 | 2026-10-25 | P | https://arxiv.org/html/2604.09515 | The paper (arXiv 2604.09515, 2026) sorts API updates into three patterns: P1 API Deprecation, removed or deprecated APIs with a recommended alternative; P2 API Modification, a changed function name, parameters or return type; P3 API Addition, an API that did not exist before. [quote: P2 - API Modification : APIs whose function name, parameters, or return type have been changed] [quote: P3 - API Addition : Newly introduced APIs that did not exist in prior versions] | research/raw/2026-10-25-when-llms-lag-behind-knowledge-conflicts-arxiv-a3641a14.md |
