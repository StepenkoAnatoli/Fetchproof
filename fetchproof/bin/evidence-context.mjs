#!/usr/bin/env node
// bin/evidence-context.mjs - one unknown, everything it rests on, in one answer.
//
// Read-only. It opens no socket, writes nothing, and reads no environment variable, so
// it cannot spend a credit or touch a key. It also decides nothing: it will not tell you
// whether an unknown is closed, and it will not change a status. That judgement is the
// protocol's, and it belongs to a person.

import { parseFlags, refuseUnknownFlags, checkFlagValues, exitAfterFlush } from '../lib/core.mjs';
import { readCorpus } from '../lib/corpus.mjs';
import { evidenceContext, renderContext } from '../lib/evidence-context.mjs';

const { flags, positional } = parseFlags(process.argv.slice(2));
// The unknown may be given as a bare argument instead of --unknown; beside either flag, one is stray.
refuseUnknownFlags(flags, ['help', 'unknown', 'all', 'json', 'limit'], flags.unknown !== undefined || flags.all
  ? { takes: 0, beside: flags.unknown !== undefined ? '--unknown' : '--all' } : { takes: 1 });
checkFlagValues(flags, { unknown: 'value', limit: { int: true, min: 1 } });
const root = process.cwd();

if (flags.help) {
  process.stdout.write(`evidence-context - what one unknown rests on.

  node fetchproof/bin/evidence-context.mjs --unknown U-5
  node fetchproof/bin/evidence-context.mjs U-5 --json
  node fetchproof/bin/evidence-context.mjs --all

  --unknown <id>  the unknown to explain (or give it as a bare argument)
  --all           every unknown, in order
  --json          machine-readable, byte-deterministic
  --limit <n>     excerpt budget in characters (default 420)

Gathers, for one unknown: its wording and why it blocks, every evidence row it cites,
each row's source title / URL / type / retrieval date, the Finding, a bounded excerpt of
the captured page, and any row that supersedes it.

It reads. Whether the evidence closes the unknown is your call - nothing here writes a
status, and nothing here offers a verdict.
`);
  process.exit(0);
}

const corpus = readCorpus(root);
const limit = Number(flags.limit) > 0 ? Number(flags.limit) : 420;

if (!corpus.discovery.present) {
  process.stderr.write(`no ${corpus.root ? 'research/DISCOVERY.md' : 'corpus'} here. cwd: ${root}\n`
    + 'The project is the current working directory; cd into it first.\n');
  process.exit(2);
}

const wanted = flags.all
  ? corpus.unknowns.map((u) => u.id)
  : [flags.unknown ?? positional[0]].filter(Boolean);

// --all over a contract with no unknowns yet is an answer, not a usage error: it had exited 2
// asking for the --all it was given (2026-09-29, break-test). --json keeps its list shape.
if (flags.all && !wanted.length) {
  process.stdout.write(flags.json ? '[]\n' : 'no unknowns in research/DISCOVERY.md yet - nothing to explain.\n');
  process.exit(0);
}

if (!wanted.length) {
  process.stderr.write('name an unknown: --unknown U-5, or --all\n'
    + `known: ${corpus.unknowns.map((u) => u.id).join(', ') || '(none)'}\n`);
  process.exit(2);
}

const contexts = wanted.map((id) => evidenceContext(corpus, id, { limit }));

if (flags.json) {
  process.stdout.write(`${JSON.stringify(flags.all ? contexts : contexts[0], null, 2)}\n`);
} else {
  process.stdout.write(contexts.map(renderContext).join(`\n${'-'.repeat(72)}\n\n`));
  process.stdout.write('\n');
}

// An unknown that could not be found is exit 1: a script asking about U-99 should be able
// to tell "not there" from "there, and thin".
await exitAfterFlush(contexts.every((c) => c.ok) ? 0 : 1);
