# Sources

Every page this project has fetched, and what it was used for. `P` primary/official
carries the design, `S` secondary is context, `L` lead-only is a hint and never proof.

| URL | Type | Title | Retrieved | Used for |
|---|---|---|---|---|
| https://docs.python.org/3/library/re.html | P | re — Regular expression operations — Python 3.15.1 documentation | 2026-10-25 | U-01, U-02: test page - Sphinx HTML with <code><span class=pre> and <em> signature parameters directly beside . , ; : ( ) [ ] { } ? ! |
| https://en.wikipedia.org/wiki/Percent_sign | P | Percent sign - Wikipedia | 2026-10-25 | U-01, U-02: test page - MediaWiki HTML with <span>, <abbr>, <sup> and links directly beside punctuation and % |
| https://docs.firecrawl.dev/advanced-scraping-guide | P | Advanced Scraping Guide \| Firecrawl | 2026-10-25 | U-03: what Firecrawl documents about its markdown format and main-content extraction |
| https://raw.githubusercontent.com/firecrawl/firecrawl/main/apps/api/src/lib/html-to-markdown.ts | P | html-to-markdown-ts | 2026-10-25 | U-03: the open-source converter Firecrawl runs, which library it calls |
| https://raw.githubusercontent.com/firecrawl/firecrawl/main/apps/go-html-to-md-service/converter.go | P | converter-go | 2026-10-25 | U-03: the HTTP conversion service html-to-markdown.ts tries first - which library and which plugins it configures |
| https://raw.githubusercontent.com/firecrawl/firecrawl/main/apps/go-html-to-md-service/go.mod | P | go-mod | 2026-10-25 | U-03: the pinned version of that library |
| https://raw.githubusercontent.com/firecrawl/firecrawl/main/apps/api/sharedLibs/go-html-to-md/html-to-markdown.go | P | html-to-markdown-go | 2026-10-25 | U-03: the Go shared library html-to-markdown.ts falls back to |
