# ADR-0203 — Which lines GitHub shows as code or hides is read in columns, inside list items

- **Date:** 2026-11-06
- **Status:** accepted
- **Area:** `fetchproof/lib/corpus.mjs` (`hiddenLines`, `parseTable`)
- **Prompted by:** the fresh-eyes review of PR #441 (2026-11-06), findings 3 and 4
- **Extends:** the F01 fix of the same branch (independent audit 2026-11-04, F01: a table in a
  code block or an HTML comment is not the table), which had no ADR
- **Freeze (ADR-0117):** a bug fix. F01's rule is that a table GitHub shows as code or hides is
  not the table; as written it hid tables GitHub shows and still read some GitHub hides. No new
  check, flag, error code or format.

## Context

F01 made the header search skip what the stray-row scan already skipped: the lines of a fence or
an HTML comment, both decided by one `blockContext`, fed each line trimmed. The review of #441
found two defects in that reading.

- **Trimmed, an indented line opened what it cannot open.** Four spaces and ```` ``` ```` or
  `<!--` is indented code on GitHub, which opens nothing; trimmed, it opened a fence or a comment
  that ran to the end of the file. An example of how a fence is written, indented above the
  table, hid every table below it: a correct contract was read as having no unknowns (twelve
  failures on a real project of this repository), a correct `EVIDENCE.md` as holding no table,
  with the remedy "restore the file", which changes nothing. With the example's `-->` indented
  below the live table, the visible OPEN table was passed over for an archived CLOSED copy
  further down, and the gate passed.
- **Five shapes of an archived CLOSED copy were still read** (on `main` as well): an opener after
  a list marker (`- <!--`, `` 1. ``` ``), whose indented closer, trimmed, then opened a fence; a
  line indented four inside a fence, which is its content and was taken as its closer; and a
  comment reopened by a `<!--` after the `-->` on the same line, which cmark ends with that line
  and GitHub's sanitizer keeps open to the next raw `-->`.

## Decision

1. **One pass over the raw lines, `hiddenLines(lines)`,** says for each line whether GitHub shows
   it as code or hides it - `{ kind: 'fence' | 'comment' | 'indented', line }`, naming the line
   that opened it - and `open`, the fence or comment a document ends inside. The header search,
   the stray-row scan and the search for the heading above a table all ask it.
2. **CommonMark's block rules, in columns** (a tab to the next multiple of 4), each line measured
   from the content column of the list items it stays inside:
   - a list item opens at `-`, `+`, `*`, or 1-9 digits and `.` or `)`, indented 0-3 and followed
     by a space, a tab or the line's end, unless the line is a thematic break; its content starts
     after 1-4 columns of space (after one, when there are 5 or more or none); a non-blank line
     indented less than an item's content ends the item, and a fence in it; an item that is
     empty, or ordered from a number other than 1, does not interrupt a paragraph;
   - a fence opens at three or more backticks or tildes indented 0-3 (a backtick fence's info
     string holds no backtick), closes at a run of its own character at least as long, indented
     0-3, with nothing after it, and never closed runs to the end of its container;
   - a line indented 4 or more opens nothing: it is indented code when no paragraph is open, and
     the paragraph's next line when one is;
   - an HTML comment opens at `<!--` where a line's content starts, after a list marker too, and
     runs to the line holding its `-->`, whatever the indentation between; a `<!--` after that
     `-->` reopens it; `<!-->` and `<!--->` close as they open.
3. **A table in indented code is not the table.** GitHub shows it as code. It was read before F01
   and after it.
4. **A heading in a code block or a comment heads no section.** Taken as one, a `# example` in a
   fence above the table set the section the stray-row scan runs to.
5. **Not read, and named in the function's comment:** a block quote's own blocks, a list item's
   lazy continuation line (which ends the item here), HTML blocks other than comments, a `<!--`
   after other text on its line, and a `-->` GitHub escapes inside a reopened comment. A table
   there is taken as shown.

## Rejected alternatives

- **The review's smallest fix: the raw line, and a line indented 4 or more after a blank line
  opens nothing, outside list items.** Without the items' content columns, a fence written inside
  a list item - its lines indented 2 or 3, its content more - is either not seen, and the
  archived copy in it that trimmed lines did hide (the review's case 01) is read again, or every
  4-column line in an item is taken as code. The columns make both right, and the same machinery
  closes finding 4's list-marker shapes.
- **Keep trimming, and strip list markers before looking for an opener** (the review's 4a).
  It mends `- <!--` and `` 1. ``` `` and nothing else: an indented example still opens a fence,
  which is finding 3.
- **A Markdown parser** (markdown-it, micromark, cmark-gfm). The kit is plain Node with no
  dependencies and no `package.json` (`fetchproof/README.md`). And no parser models what GitHub's
  sanitizer does with a reopened comment, so that rule would stay ours.
- **Hide every line indented 4 or more.** A line indented four in an open paragraph, or in a list
  item whose content starts at column 4, is shown as text on GitHub, not as code.
- **Narrow F01's words and list the shapes as residuals** (the review's alternative to 4). It
  leaves the false PASS of an indented comment example, which F01 introduced, and correct
  projects blocked.

## Consequences

- The header search, the stray scan and the section heading are judged by one reading, so a table
  is hidden or shown wherever it stands by the same rule.
- The residuals of decision 5 remain; each is a shape GitHub renders that this reading does not
  model, so a table kept in one is read as if shown.
- `open` lets a writer refuse to append into a table that a fence or comment hides to the end of
  the file (the next fix on this branch).

## Trigger to revisit

- A table GitHub shows is reported missing, or one it hides is read, in a shape decision 5 does
  not name: model that shape, or name it there.
- GitHub changes how it renders a reopened comment or a list item's fence.
