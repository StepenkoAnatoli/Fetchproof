# ADR-0085 — Phase 0 searches a compound topic part by part

- **Date:** 2026-09-28
- **Status:** accepted
- **Area:** `lib/decompose.mjs` (`topicQueries`, `interleaveByQuery`, `MAX_TOPIC_PARTS`)

## Context

Phase 0 made four searches: the topic, then the topic followed by "documentation",
"pricing limits" and "terms of service". On 2026-09-28 the kit mapped MoonAliza's open gaps
under the topic "MoonAliza open gaps: accurate context accounting across providers, native
SQLite in the packaged Electron app, Fetchproof redistribution rights". Searched whole,
the three unrelated questions matched nothing together. The map's candidates were forum
threads, magazine PDFs and a coffee-scale blog, and the plan had to name every page by
hand.

## Decision

- **What counts as compound:** `topicQueries(topic)` reads a topic of the form
  `subject: part, part; part` (the colon optional) as a list of questions.
- **How parts are searched:** each part is searched once, instead of the whole topic four
  times.
  - A part of one or two words is searched with the subject in front ("Stripe: pricing,
    webhooks" becomes "Stripe pricing", "Stripe webhooks").
  - A longer part is searched alone, because the subject is often a private name no search
    engine knows ("MoonAliza").
- **Search limit:** at most `MAX_TOPIC_PARTS` (6) parts are searched, so one topic cannot
  spend searches without bound.
- **When a topic is not compound:** a list with a one-word item and no subject ("Paris,
  France hotels"), or a single part, keeps the four searches it always had.
- **Sharing the map's candidates:** candidates are interleaved one per part, each part
  keeping its own rank order. In search order the first parts filled the 20 candidates the
  map shows. In the first live run the third question got none of the 20.
- **What the run prints:** the CLI says it is searching part by part, and the dry run names
  every part's search.

Measured live on the MoonAliza topic with this change: 30 candidates, and every question is
represented among the 20 listed. The SQLite part found sqlite.org, Electron SQLite
material and a packaging Stack Overflow question. The license part found real LICENSE
files. The "context accounting" part still found the accounting industry: splitting fixes
the structure of the search, not the ambiguity of a part's words, which stay the operator's
to choose.

## Rejected alternatives

- **Search per subtopic after the map is classified.** Phase 0 runs before any row is
  judged, so there is nothing to search by yet. Research does this already, from the plan.
- **Keep the three dimension suffixes for each part.** That makes four searches per part,
  so a four-part topic would spend 16 searches in phase 0 alone, against Rule 5. The
  dimensions are seeded as map rows either way.
- **Split on "and" as well.** "Pricing and limits" is one question. Splitting it makes two
  one-word searches that find nothing.
- **Leave it and advise short topics.** A topic that lists the questions is what the
  operator naturally writes, and the map is the first thing that runs on it.
