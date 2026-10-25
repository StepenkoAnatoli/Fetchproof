# Refresh record: the first real quoted refresh (2026-10-25)

This project is a copy of `docs/decisions/2026-09-28-warc-export/` (its tracked files at
`ab2e605`), refreshed once on 2026-10-25 so the kit has a real refresh with quoted rows behind
it - the case ADR-0193's quote-level recheck was designed against. The original project stays
untouched; this copy is the fixture (run `docs/orchestration/2026-10-25-quote-level-refresh/`,
units U7 and U8).

## What was run

- `node "$HOME/.agents/fetchproof/bin/research.mjs" --force` in this folder, kit 0.9.5,
  transport `firecrawl-cli` (Firecrawl CLI 1.25.3), 2026-10-25T05:39Z.
- Result: collected 2, cached 0, failed 0, spent 2 credits (account: 78 before, 76 after).
- Ledger (`research/raw/.fetches.jsonl`) entries 4 and 5 were appended; entries 1-3 are the
  original project's.

| Seq | URL | Retrieved | bodySha256 | sourceSha256 |
|---|---|---|---|---|
| 2 | https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/ | 2026-09-28 | `1bc7818355a5e50a1e0c4bbf553fec6b2e26fa1b151bf6885d9ee77de3f92a07` | (none recorded) |
| 4 | same | 2026-10-25 | `5274722148028ba54ebdf18f4ef7ceaa2f3d1b7c91f6bd621c04b912be4a9011` | `aa0e1cc7ffee2d71ea70750e0cf857dd29bc672c17289df71d30a797c1b9d904` |
| 3 | https://github.com/webrecorder/warcio | 2026-09-28 | `735d77d31d5dd00e9df13a903fbfc83b1b36f1473c8771e6dd7cb3ec787d9f64` | (none recorded) |
| 5 | same | 2026-10-25 | `027dffa9651f3b43f0a3052bed82b7010075898160cae758525a0eeada59246f` | `039e570346ee269c085596589f2818254e3cd721b2635933b814f937abea6488` |

The ledger is the source of truth for every hash; this table only names which entries to read.

## What changed between the captures

- WARC 1.1 specification: the capture body (everything after the front matter) is byte-identical;
  only `retrieved` and `command` in the front matter differ (the 2026-10-25 command adds
  `--max-age 0 --format markdown,rawHtml`). 68236 -> 68274 bytes.
- warcio README: the body changed (35099 -> 24036 bytes; an 83-line `diff`), GitHub's page
  chrome and README revisions, but the quoted sentence is still there (line 361).

## Survival per anchor (measured with the kit's own `quoteAnchors` / `quoteTooShort` / `anchorFound`)

| Old row | Quote | Too short | Found in old capture | Found in new capture |
|---|---|---|---|---|
| E-01 | `A ‘resource’ record contains a resource, without full protocol response information` | no | yes | yes |
| E-02 | `The block and payload digests are computed automatically` | no | yes | yes |

Both anchors survived. Mandate assumption A3 applies: an all-survive result is recorded as it is
and no further pages are bought for a vanishing case; the recheck's failing direction is tested on
synthetic fixtures (ADR-0193's tests), and this project is its real passing case.

## The state just after the refresh (before the researcher's review)

This is the state ADR-0193's recheck is designed to judge. Tests rebuild it from this record and
the files of this project; it is recorded here because the committed project carries the review.

- `research/EVIDENCE.md` rows E-03 and E-04 were appended with the auto-extracted Findings, verbatim:
  - E-03 (WARC 1.1 spec, 2026-10-25): `NOTE: in WARC 1.0 standard (ISO 28500:2009), uri was defined as “<”`
  - E-04 (warcio, 2026-10-25): `By default, warcio creates WARC 1.0 records for maximum compatibility with existing tools.`
- `research/DISCOVERY.md` still cited the old rows: U-01 and U-02 rest on `E-01`, U-03 on `E-02`
  (identical to `docs/decisions/2026-09-28-warc-export/research/DISCOVERY.md` at `ab2e605`).
- Preflight (kit 0.9.5): FAIL, 3 blocking - `evidence-supersession/cites-superseded-row` for
  U-01 (E-01 -> E-03), U-02 (E-01 -> E-03) and U-03 (E-02 -> E-04) - and 1 warning, `hygiene/brief-stale`.

## The researcher's review (what the committed project carries)

1. Re-read both new captures against each claim in E-01 and E-02. Every fact the old Findings
   state is in the new captures (mandatory fields, record types, per-record GZIP; automatic
   digests and the `warcio index` command).
2. Rewrote E-03 and E-04 into real claims carrying the same quotes, which the new captures contain.
3. Moved U-01 and U-02 to E-03 and U-03 to E-04 by hand, each with a note naming the refresh.
   The move is the researcher's, made after reading; ADR-0193's recheck never moves a citation.
4. Redrafted the brief and re-ran preflight and handoff.
