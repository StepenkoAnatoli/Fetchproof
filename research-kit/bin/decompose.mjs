#!/usr/bin/env node
// bin/decompose.mjs - phase 0's CLI.
//
// Gathers material with the transport, so a BUILDER machine refuses it (exit 2).
// It writes a checklist with statuses BLANK: the tool contains no judgment.

import { parseFlags, refuseUnknownFlags, checkFlagValues, listFiles, writeFailure } from '../lib/core.mjs';
import { collectionPolicy, collectionRefusal } from '../lib/machine.mjs';
import { selectTransport, TRANSPORT_NAMES, SEARCH_PROVIDER_NAMES, unusedKeyNote } from '../lib/transport.mjs';
import { decompose, searchSummary, resolveTopic, RECIPE_DIR } from '../lib/decompose.mjs';
import { UNIVERSAL_DIMENSIONS } from '../lib/dimensions.mjs';

const { flags } = parseFlags(process.argv.slice(2));
refuseUnknownFlags(flags, ['help', 'topic', 'dry-run', 'force', 'limit', 'max-scrapes', 'recipe', 'recipes', 'transport', 'search-transport']);
// Numeric flags are validated here, BEFORE a transport is chosen or anything is spent: a
// budget of NaN caps nothing, and finding that out after the first scrape is too late. A
// bare flag is refused too (#269, 2026-10-11): parseFlags reads it as `true`, which Number()
// made 1, so `--max-scrapes` with no value quietly paid for one page.
checkFlagValues(flags, {
  topic: 'value', recipe: 'value', transport: 'value', 'search-transport': 'value',
  limit: { int: true, min: 1 }, 'max-scrapes': { int: true, min: 0 },
});
const root = process.cwd();

// The topic is the project's (plan.json) unless --topic names it; a different one is refused.
const resolved = flags.help || flags.recipes ? null : resolveTopic(root, flags.topic);
if (resolved?.error) process.stderr.write(`${resolved.error}\n\n`);
// A mismatch is not a usage question: the help would only bury the one line that matters.
if (resolved?.error && flags.topic) process.exit(2);

if (flags.help || resolved?.error) {
  process.stdout.write(`decompose - phase 0: draft research/MAP.md, seeded with the universal checklist.

  node research-kit/bin/decompose.mjs [--topic "<what is being researched>"] [options]

  --topic <text>     the topic to decompose. Default: research/plan.json's topic;
                     a different one is refused (a different topic is a new project)
  --recipe <name>    ADD domain dimensions on top of the universal set
  --recipes          list the recipes this kit ships
  --max-scrapes <n>  gather up to n pages while mapping (default 0 - search only);
                     the map shows the section headings of every captured page
  --limit <n>        search results per query (default 8)
  --dry-run          write the seeded map with no gathering; spend nothing
  --force            redraft over a map that already holds judged rows
  --transport <name> ${TRANSPORT_NAMES.join(' | ')}
  --search-transport <name>
                     ${SEARCH_PROVIDER_NAMES.join(' | ')} - the SEARCH side only.
                     Default: the fetch transport, unless a SerpAPI key is configured.

The ${UNIVERSAL_DIMENSIONS.length} universal dimensions are always seeded. A recipe adds to them; nothing
replaces them - a recipe that silently dropped legality would be worse than no recipe.
`);
  process.exit(flags.help ? 0 : 2);
}

if (flags.recipes) {
  const names = listFiles(RECIPE_DIR).filter((n) => n.endsWith('.md')).map((n) => n.replace(/\.md$/, ''));
  process.stdout.write(names.length ? `${names.join('\n')}\n` : `no recipes in ${RECIPE_DIR}\n`);
  process.exit(0);
}

const spends = !flags['dry-run'];
const policy = collectionPolicy();
if (spends && !policy.mayCollect) {
  process.stderr.write(`${collectionRefusal(policy)}\n`);
  process.exit(2);
}

let adapter = null;
let searchAdapter = null;
let searchAdapters = null;
if (!spends) {
  // A dry run names the provider its searches would spend on, when this machine can say;
  // selecting one probes and spends nothing, and a machine that cannot select one still
  // gets its dry run.
  try {
    const chosen = selectTransport({
      explicit: typeof flags.transport === 'string' ? flags.transport : '',
      explicitSearch: typeof flags['search-transport'] === 'string' ? flags['search-transport'] : '',
    });
    searchAdapter = chosen.search.adapter ?? chosen.adapter;
    searchAdapters = chosen.search.adapters ?? null;
  } catch { /* named generically below */ }
}
if (spends) {
  try {
    const chosen = selectTransport({
      explicit: typeof flags.transport === 'string' ? flags.transport : '',
      explicitSearch: typeof flags['search-transport'] === 'string' ? flags['search-transport'] : '',
    });
    adapter = chosen.adapter;
    searchAdapter = chosen.search.adapter;
    // A merged selection names every provider it searches; passing only `adapter` searched
    // SerpAPI alone under a banner that said both (found 2026-09-28).
    searchAdapters = chosen.search.adapters ?? null;
    // An explicit search provider that cannot run is refused before anything is searched:
    // without this, each search failed and fell back to the fetch provider's own search,
    // which on Firecrawl spends credits (found 2026-09-30).
    if (chosen.search.notReady) {
      process.stderr.write(`${chosen.search.notReady}\n`);
      process.exit(2);
    }
    process.stdout.write(`transport: ${chosen.name} - ${chosen.why}\n`);
    process.stdout.write(unusedKeyNote(chosen));
    if (!chosen.search.sameAsFetch) {
      process.stdout.write(`search:    ${chosen.search.name} - ${chosen.search.why}\n`);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
}

let result;
try {
  result = decompose(root, {
    topic: resolved.topic,
    adapter,
    searchAdapter,
    searchAdapters,
    recipe: typeof flags.recipe === 'string' ? flags.recipe : '',
    limit: Number(flags.limit ?? 8),
    maxScrapes: Number(flags['max-scrapes'] ?? 0),
    dryRun: Boolean(flags['dry-run']),
    force: Boolean(flags.force),
    log: (line) => process.stdout.write(`${line}\n`),
  });
} catch (err) {
  const why = writeFailure(err, root);
  if (why) {
    process.stderr.write(`${why}\n`);
    process.exit(2);
  }
  if (err.code === 'UNKNOWN_RECIPE' || err.code === 'INVALID_RECIPE' || err.code === 'INVALID_BUDGET' || err.code === 'SEARCH_PROVIDER_NOT_READY') {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
  throw err;
}

if (!result.written) {
  process.stderr.write(`${result.reason}\n`);
  process.exit(1);
}

// Printed before the "next, this part is yours" paragraph, because that paragraph reads the
// same after an outage as after a good run - which is the defect this line exists for.
const searched = searchSummary(result);
if (searched) process.stderr.write(`${searched}\n`);

process.stdout.write(`
wrote ${result.file}: ${result.rows} rows (${result.universal} universal${result.added ? ` + ${result.added} from recipe ${result.recipe}` : ''}), ${result.material} candidate pages${result.outlines ? `, ${result.outlines} page outline${result.outlines === 1 ? '' : 's'} shown` : ''}.

Next, and this part is yours: mark every row COVERED (cite the U-## rows that cover it),
DISMISSED (reason required - dismissing is fine, omitting is not), or GAP, and add
topic-specific subtopics where the checklist is not enough. Then write the unknowns into
research/DISCOVERY.md, each tracing back to a subtopic, and the queries and pages that
close them into research/plan.json - research.mjs collects from that plan.
`);
