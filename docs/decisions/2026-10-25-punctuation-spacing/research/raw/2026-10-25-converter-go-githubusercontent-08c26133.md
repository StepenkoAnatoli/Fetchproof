---
url: https://raw.githubusercontent.com/firecrawl/firecrawl/main/apps/go-html-to-md-service/converter.go
retrieved: 2026-10-25
command: http-keyless scrape https://raw.githubusercontent.com/firecrawl/firecrawl/main/apps/go-html-to-md-service/converter.go
statusCode: 200
transport: http-keyless
completeness: full
---
package main

import (
	md "github.com/firecrawl/html-to-markdown"
	"github.com/firecrawl/html-to-markdown/plugin"
)

// Converter handles HTML to Markdown conversion
type Converter struct {
	converter *md.Converter
}

// NewConverter creates a new Converter instance with pre-configured rules
func NewConverter() *Converter {
	converter := md.NewConverter("", true, nil)
	converter.Use(plugin.GitHubFlavored())
	converter.Use(plugin.RobustCodeBlock())

	return &Converter{
		converter: converter,
	}
}

// ConvertHTMLToMarkdown converts HTML string to Markdown
func (c *Converter) ConvertHTMLToMarkdown(html string) (string, error) {
	return c.converter.ConvertString(html)
}


