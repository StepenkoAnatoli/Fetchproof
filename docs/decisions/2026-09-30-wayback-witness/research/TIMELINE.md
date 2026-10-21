# Timeline

Derived, chronological, and deliberately outside the chain: a review aid, never part
of a gate decision. Regenerate with `node "$HOME/.agents/fetchproof/bin/timeline.mjs"`.

| When | What | Detail |
|---|---|---|
| 2026-09-30 | evidence | E-01 https://archive.org/help/wayback_api.php |
| 2026-09-30 | evidence | E-02 https://help.archive.org/help/save-pages-in-the-wayback-machine/ |
| 2026-09-30 | evidence | E-03 https://help.archive.org/help/internet-archive-access-policy/ |
| 2026-09-30 | evidence | E-04 https://archive.org/about/terms |
| 2026-09-30 | evidence | E-05 https://archive.org/about/terms |
| 2026-09-30 | scrape | https://archive.org/help/wayback_api.php -> research/raw/2026-09-30-wayback-machine-apis-internet-archive-archive-533d25d5.md (http-keyless) |
| 2026-09-30 | scrape | https://help.archive.org/help/save-pages-in-the-wayback-machine/ -> research/raw/2026-09-30-save-pages-in-the-wayback-machine-intern-archive-489bbdfc.md (http-keyless) |
| 2026-09-30 | scrape | https://help.archive.org/help/internet-archive-access-policy/ -> research/raw/2026-09-30-internet-archive-access-policy-internet--archive-f3863631.md (http-keyless) |
| 2026-09-30 | scrape | https://archive.org/about/terms -> research/raw/2026-09-30-internet-archive-digital-library-of-free-archive-679b3bd6.md (http-keyless) |
| 2026-09-30 | scrape | https://archive.org/about/terms -> research/raw/2026-09-30-terms-of-use-archive-679b3bd6.md (browser) |
| 2026-09-30 06:08 UTC | fetch failed | https://nullhandle.org/pdf/2022-08-25_taking_the_witness_stand.pdf - the response is application/pdf, which is not text - the keyless transport cannot keep a faithful copy of it. Fetch it with --transport firecrawl-cli, which converts documents such as PDFs to text, or cite an HTML page that carries the same text. |

