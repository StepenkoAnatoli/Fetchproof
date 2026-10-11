#!/usr/bin/env node
// bin/mcp-server.mjs - the collector, as a Model Context Protocol server over stdio.
//
// Launched as a subprocess by an MCP client, which speaks newline-delimited JSON-RPC on
// this process's standard streams. There are no flags: a stdio server's configuration is
// its environment, and the one thing it needs is a GitHub token.
//
// STDOUT IS THE MESSAGE STREAM AND NOTHING ELSE.
//
// A stray `console.log` here corrupts the protocol - the client reads a line, fails to
// parse it, and the failure looks like a malformed response to whatever request happened
// to be in flight. Every diagnostic below goes to stderr, deliberately.
//
// Register it with a client roughly like this:
//
//   {
//     "mcpServers": {
//       "research-kit": {
//         "command": "node",
//         "args": ["<path>/research-kit/bin/mcp-server.mjs"],
//         "env": { "RESEARCH_KIT_GITHUB_TOKEN": "github_pat_..." }
//       }
//     }
//   }
//
// The token needs exactly one permission - Actions: read and write, on the one repository
// holding the collector workflow. See the front-page README.

import { requireRuntime, honourEnvProxy } from '../lib/runtime.mjs';
import { createStdioLoop, exitWhenSettled, handle, SUPPORTED_VERSIONS, SERVER_INFO, TOOLS } from '../lib/mcp.mjs';
import { tokenFromEnv, TOKEN_VARS, redact } from '../lib/dispatch.mjs';
import { tolerateClosedStdout } from '../lib/core.mjs';

// Before anything is written: the client on the other end of these streams can go away at
// any moment - a session cancelled, a host restarted, a timeout - and the kernel's EPIPE
// for the response still in flight used to surface as an unhandled 'error' event: a raw
// stack and exit 1, which reads as a server defect when it was only a client leaving
// (found 2026-09-30, break-test). Drop writes to a vanished reader, keep the session's
// own ending, exactly as selftest.mjs does for its report.
tolerateClosedStdout();

if (process.argv.includes('--help')) {
  // Printed to stdout ONLY here, where no client is listening: a human ran this by hand.
  process.stdout.write(`mcp-server - the Research-Kit collector, over MCP stdio.

  node research-kit/bin/mcp-server.mjs

Speaks newline-delimited JSON-RPC on stdin/stdout.
Protocol versions: ${SUPPORTED_VERSIONS.join(', ')} - modern and legacy, because every
shipped client still opens with the legacy initialize handshake.
Tools: ${TOOLS.map((t) => t.name).join(', ')}.

The token is read from ${TOKEN_VARS.join(' or ')}. There is no token argument: a stdio
server's credential belongs in its environment, which is what the MCP specification says
for this transport.

A corpus this server returns is EVIDENCE, not approved research. Read buildAuthorized.
`);
  process.exit(0);
}

// Found 2026-09-28 (Arena break test 12).
//
// A stdio server's configuration is its environment, so it takes NO options - and an
// option it does not take must be refused rather than ignored.
//
// Silence is the dangerous default, and this project has paid for it: `research.mjs
// --totally-made-up-flag` was run to find out whether unknown flags were refused, they
// were not, it fell through to its default behaviour and spent 26 Firecrawl credits on a
// real collection. `refuseUnknownFlags` in lib/core.mjs checks parsed named flags;
// an empty flag map is allowed, and positional arguments are not flag-map keys.
// This entrypoint checks the whole argument vector directly, including positionals,
// after handling `--help` above.
//
// Two real ways this bites. A client configured with `--directory /some/project` - the
// spelling every other MCP server takes - gets a server that ignores it and collects
// somewhere else, silently. And a token passed as `--token <secret>` puts a credential
// in the process table, is discarded just as silently, and the server then reports
// "no token" and refuses every tool - a permission error that looks like the kit's fault.
const extraArgs = process.argv.slice(2);
if (extraArgs.length) {
  process.stderr.write('mcp-server: unknown option or positional argument\n\n'
    + 'This server takes no options. It is launched by an MCP client, which configures it\n'
    + 'through its ENVIRONMENT - the GitHub token it needs comes from '
    + `${TOKEN_VARS.join(' or ')}, never from an argument.\n\n`
    + `It was started with ${extraArgs.length} argument(s).\n\n`
    + 'Run it with --help for what it reads, or remove the arguments from the client\'s\n'
    + '"args" list.\n');
  process.exit(2);
}

requireRuntime({ node: true });

// Before anything is read or written: this process fetches, and Node's fetch ignores a proxy
// unless told. Where only the startup flag exists, the server starts again with it on these
// same streams, so nothing may touch stdin or stdout before this line.
await honourEnvProxy();

// Reported once, on stderr, before the first message. A server that starts happily and
// then fails every call for a missing credential is harder to diagnose than one that says
// so at the top of the log the client already captures.
const { token, from, detail } = tokenFromEnv();
process.stderr.write(token
  ? `research-kit mcp: protocols ${SUPPORTED_VERSIONS.join(", ")}, token from ${from}\n`
  : `research-kit mcp: ${detail}. Tools will refuse until it is set.\n`);

// One connection, one session. A stdio server serves exactly one client, so this object
// is the whole of the session state the legacy handshake establishes.
const session = { version: null };

const loop = createStdioLoop({
  input: process.stdin,
  output: process.stdout,
  onMessage: (message) => handle(message, { session }),
  onError: (error) => process.stderr.write(`research-kit mcp: ${redact(error.stack ?? error.message)}\n`),
});

// stdin closing is not a cancellation: what was already sent still has to be ANSWERED,
// and a tool call is async, so exiting on 'end' dropped the reply to anything in flight.
exitWhenSettled({ input: process.stdin, settled: loop.settled });
process.stderr.write(`research-kit mcp: ${SERVER_INFO.name} ready\n`);
