# Evidence

One row per fetched page. `Raw` points at the cached page text under `research/raw/`,
which is what makes the claim checkable - a row without raw evidence fails preflight.

The `Finding` cell arrives as an auto-extracted summary. Rewrite it into a real claim:
what the page actually establishes, with the quote or number that proves it.

| ID | Retrieved | Type | URL | Finding | Raw |
|---|---|---|---|---|---|
| E-01 | 2026-09-28 | P | https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/ | WARC 1.1: a record is a "WARC/1.1" version line, named fields, CRLF, the block, CRLF CRLF; WARC-Record-ID, Content-Length, WARC-Date and WARC-Type are mandatory. A resource record holds content "without full protocol response information"; a metadata record describes another record; compressing each record as its own GZIP member is recommended. [quote: A ‘resource’ record contains a resource, without full protocol response information] | research/raw/2026-09-28-the-warc-format-github-626d7a34.md |
| E-02 | 2026-09-28 | P | https://github.com/webrecorder/warcio | warcio (Webrecorder), a reference reader and writer: it computes block and payload digests itself and ships a CLI that indexes a WARC's records - an independent reader to validate an export against. [quote: The block and payload digests are computed automatically] | research/raw/2026-09-28-github-webrecorder-warcio-streaming-warc-github-99a698e3.md |
| E-03 | 2026-10-25 | P | https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/ | Refresh of E-01 (2026-10-25; capture body byte-identical): WARC 1.1 still defines a record as a "WARC/1.1" version line, named fields, CRLF, the block, CRLF CRLF, with WARC-Record-ID, Content-Length, WARC-Date and WARC-Type mandatory; a resource record holds content "without full protocol response information", a metadata record describes another record, and per-record GZIP members are recommended. [quote: A ‘resource’ record contains a resource, without full protocol response information] | research/raw/2026-10-25-the-warc-format-github-626d7a34.md |
| E-04 | 2026-10-25 | P | https://github.com/webrecorder/warcio | Refresh of E-02 (2026-10-25): the warcio README still says it computes block and payload digests itself and documents a `warcio index` command that prints an index of a WARC's records - an independent reader to validate an export against. [quote: The block and payload digests are computed automatically] | research/raw/2026-10-25-github-webrecorder-warcio-streaming-warc-github-99a698e3.md |
