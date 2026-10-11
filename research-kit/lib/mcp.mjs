// mcp.mjs - the collector as a Model Context Protocol server.
//
// EVERY DESIGN CHOICE HERE IS CITED, because this module is the first thing in the
// repository built from an approved brief rather than from a plan. The brief is
// `docs/decisions/2026-09-21-agent-interface/research/BRIEF.md`; the E-numbers below are
// its evidence rows, and each one points at a cached page anybody can re-read.
//
// STDIO, NOT STREAMABLE HTTP (E-01, E-03).
//
// "Protocol semantics are identical on every transport" (E-03), so this is an operational
// choice rather than a capability one. A stdio server is a subprocess the client launches
// on the operator's own machine; a remote one needs the whole OAuth 2.1 chain before an
// agent can say hello - a 401 with `WWW-Authenticate`, a Protected Resource Metadata
// document, authorization-server discovery, client registration or DCR, and a browser
// consent round trip (E-01). That is an identity product. Nothing asked for one.
//
// THE CREDENTIAL IS THE ONE WE ALREADY HAVE (E-01).
//
// "For MCP servers using the STDIO transport, you can use environment-based credentials"
// - so `tokenFromEnv` is not a shortcut here, it is the documented route. No token
// reaches a tool argument, and `x-mcp-header` is deliberately unused: the tools spec
// warns developers SHOULD NOT mark tokens that way "as header values are visible to
// network intermediaries" (E-04).
//
// TWO TOOLS, NOT ONE.
//
// `collect` starts a run and returns its id; `fetch_corpus` takes that id and returns a
// link. A server "cannot initiate JSON-RPC requests" (E-03), so there is no "I will call
// you back" - the alternative to two calls is one call held open for several minutes, and
// an agent whose process dies mid-call has then lost a run it paid for. Two calls give it
// something to retry against.
//
// A LINK, NEVER THE BYTES (E-04).
//
// A corpus ZIP is tens of kilobytes. `resource_link` returns a URI the client fetches,
// and embedding is permitted but the specification "states no maximum size anywhere" - so
// a `file://` URI is the defensible option rather than the merely available one.
//
// THE PROTOCOL VERSION IS PINNED (E-05).
//
// Version is declared per request with no handshake; a server that cannot serve one MUST
// answer `UnsupportedProtocolVersionError` (-32022) listing what it does support. Same
// discipline as pinning `X-GitHub-Api-Version` on the GitHub side, for the same reason:
// this protocol has already broken compatibility once.

import { dispatchCollection, getRunSummary, fetchCorpus, tokenFromEnv, redact, DispatchError, queriesInput, usableOutDir } from './dispatch.mjs';
import { KIT_VERSION } from './core.mjs';

/**
 * DUAL-ERA, and the reason is that the specification is ahead of every client.
 *
 * E-05 splits the world: **modern** revisions (`2026-07-28` and later) carry version and
 * capabilities as per-request metadata; **legacy** ones (`2025-11-25` and earlier)
 * establish a session with an `initialize` handshake. It names the third option too - "a
 * **dual-era** implementation that supports both".
 *
 * The first version of this server implemented modern only, correctly, from the
 * specification. It could not be called by anything that exists. The official SDK at
 * v1.30.0 declares LATEST_PROTOCOL_VERSION `2025-11-25` and opens with `initialize`, so
 * driving this server with it produced, in full:
 *
 *     MCP error -32601: unknown method initialize
 *
 * A server nothing can call is not a conformant server, it is an unreachable one. Same
 * shape as building the workflow against an npm package named `firecrawl`: read from the
 * documentation, never exercised against reality, wrong in the one way that matters.
 */
export const MODERN_VERSION = '2026-07-28';
export const LEGACY_VERSION = '2025-11-25';

/** The revision this server prefers when nobody says otherwise. */
export const PROTOCOL_VERSION = MODERN_VERSION;

/**
 * Every revision this server will serve, newest first.
 *
 * 2025-06-18 since 2026-09-27 (docs/decisions/2026-09-27-mcp-protocol-versions, ADR-0049):
 * nothing 2025-11-25 changed touches what this server does (E-01), and a client on the official
 * SDK up to 1.24.0 asks for 2025-06-18 and refuses 2025-11-25 (E-04). Answering it anything
 * else disconnected it; the specification requires the echo from a server that supports the
 * version (E-03). 2025-03-26 is not served: these results carry structuredContent and
 * resource_link, both new in 2025-06-18 (E-02).
 */
export const SUPPORTED_VERSIONS = Object.freeze([MODERN_VERSION, LEGACY_VERSION, '2025-06-18']);

/** JSON-RPC error codes. -32022 is MCP's, the rest are JSON-RPC's own. */
export const ERRORS = Object.freeze({
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
});

export const SERVER_INFO = Object.freeze({
  name: 'research-kit',
  title: 'Research-Kit collector',
  version: KIT_VERSION,
});

/**
 * The tool surface.
 *
 * `inputSchema` is a 2020-12 JSON Schema object with `additionalProperties: false` - the
 * spec's recommended shape, and the one that refuses a caller who invents a parameter
 * rather than silently ignoring it. There is no `token` property and there never will be.
 */
export const TOOLS = Object.freeze([
  {
    name: 'collect',
    title: 'Collect research evidence',
    description:
      'Start a research collection on GitHub Actions. Returns the workflow run id immediately; '
      + 'the run takes minutes. Call fetch_corpus with that id to get the result. '
      + 'The corpus that comes back is NOT approved research: the agent must review it before anything is built from it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['repository', 'topic'],
      properties: {
        repository: { type: 'string', description: 'owner/name of the repository holding the collector workflow' },
        topic: { type: 'string', minLength: 1, description: 'What to research. Visible to anyone who can read that repository.' },
        prefer: { type: 'string', description: 'Optional, comma-separated. Domains that OWN the fact - e.g. "tavily.com". On a shared host name the path - "github.com/actions/upload-artifact", not "github.com". Ranked above pages merely about it.' },
        queries: { type: 'array', items: { type: 'string' }, description: 'Optional. The actual search queries. Without them the topic is used verbatim, which matches the words rather than the subject when the topic is made of common ones.' },
        urls: { type: 'array', items: { type: 'string' }, description: 'Optional. Pages you already know (http or https), fetched directly instead of searched - an API response, a changelog post. Each counts against max_pages. With urls and no queries, nothing is searched. Visible to anyone who can read that repository, like the topic: never a signed or token-bearing URL.' },
        prior: { type: 'string', description: 'Optional. What you EXPECT the evidence to say, and what you know you cannot know yet. Registered on the runner and chained ahead of the first page, so it can only be supplied now. Nothing grades it - being wrong is the point (ADR-0039).' },
        max_pages: { type: 'integer', minimum: 1, maximum: 25, description: 'Pages to collect. Each costs at least one credit. Default 8.' },
        depth: { type: 'string', enum: ['probe', 'quick', 'normal'], description: 'Collection tier. Default quick.' },
        client_ref: { type: 'string', description: 'Optional caller reference. PUBLIC: it becomes the run and artifact name, so never put the subject in it.' },
        runner: { type: 'string', enum: ['ubuntu-latest', 'windows-latest'] },
      },
    },
  },
  {
    name: 'fetch_corpus',
    title: 'Fetch a collected corpus',
    description:
      'Fetch the artifact a completed collection produced, validate it, and return a link to it. '
      + 'Reports whether the run is still going rather than blocking. '
      + 'ALWAYS read buildAuthorized in the result: it is false for every freshly collected corpus, '
      + 'and false means do not build from this.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['repository', 'workflow_run_id'],
      properties: {
        repository: { type: 'string', description: 'owner/name' },
        workflow_run_id: { type: 'integer', minimum: 1, description: 'The id `collect` returned' },
        out_dir: { type: 'string', description: 'Where to save the package. Default: the system temp directory.' },
      },
    },
  },
]);

// ---------------------------------------------------------------- framing

/** A JSON-RPC result. */
export function ok(id, result) { return { jsonrpc: '2.0', id, result }; }

/** A JSON-RPC error. `data` is optional and never carries a credential. */
export function err(id, code, message, data = undefined) {
  const payload = { jsonrpc: '2.0', id, error: { code, message: redact(message) } };
  if (data !== undefined) payload.error.data = data;
  return payload;
}

/**
 * The version check, run before anything else touches a request.
 *
 * Returns null when the request may proceed. The error it builds is the exact shape the
 * spec defines - `data.supported` and `data.requested` - because a client is expected to
 * read `supported` and retry, and a message it has to parse English out of defeats that.
 */
export function versionProblem(message) {
  const requested = message?.params?._meta?.['io.modelcontextprotocol/protocol-version']
    ?? message?._meta?.['io.modelcontextprotocol/protocol-version']
    ?? null;
  // Absent is permitted: a client MAY call `server/discover` first, and MAY also just
  // invoke a method inline. A LEGACY client never sends this at all - it settled the
  // version once, at `initialize`. Refusing an unstated version would make this server
  // stricter than the protocol and would reject every client that exists today.
  if (requested === null || SUPPORTED_VERSIONS.includes(requested)) return null;
  return {
    code: ERRORS.UNSUPPORTED_PROTOCOL_VERSION,
    message: 'Unsupported protocol version',
    data: { supported: [...SUPPORTED_VERSIONS], requested },
  };
}

/** Text content, the ordinary tool result item. */
const text = (value) => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });

/**
 * A link to a file on this machine.
 *
 * `file://` because this server is stdio and therefore local (E-01): the client can open
 * the path it is handed. The spec warns that a link a tool returns "is not guaranteed to
 * appear in the results of a `resources/list` request", so the URI is the handle - there
 * is nothing to rediscover it by.
 */
export function resourceLink(file, { name, description }) {
  const posix = String(file).split('\\').join('/');
  return {
    type: 'resource_link',
    uri: `file:///${posix.replace(/^\/+/, '')}`,
    name,
    description,
    mimeType: 'application/zip',
  };
}

// ---------------------------------------------------------------- the methods

/**
 * `handle(message, deps)` -> a response object, or null for a notification.
 *
 * Pure apart from the injected deps, so every path below is tested without a subprocess,
 * a socket or a credential.
 */
export async function handle(message, {
  dispatch = dispatchCollection,
  summary = getRunSummary,
  corpus = fetchCorpus,
  env = process.env,
  // One stdio process serves one client, so one session object is the whole of session
  // state. A caller that omits it gets a throwaway - which is right for a single call and
  // wrong for a connection, and `createStdioLoop` supplies a real one.
  session = { version: null },
} = {}) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return err(message?.id ?? null, ERRORS.INVALID_REQUEST, 'not a JSON-RPC 2.0 request');
  }
  // A notification has no id and takes no response - including `notifications/cancelled`,
  // which is how a stdio client abandons work (E-03). Nothing here is cancellable yet:
  // `collect` returns in one round trip and `fetch_corpus` is a download.
  if (message.id === undefined || message.id === null) return null;

  const bad = versionProblem(message);
  if (bad) return err(message.id, bad.code, bad.message, bad.data);

  switch (message.method) {
    case 'initialize': {
      // THE LEGACY HANDSHAKE. Removed in `2026-07-28` and spoken by every shipped client.
      //
      // The client sends the version it wants and REFUSES a reply carrying one it does
      // not support - `SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)` in
      // the official SDK, which throws otherwise. So the reply echoes the request when it
      // is serveable, and otherwise offers the legacy revision rather than this server's
      // preferred one: answering a legacy client with `2026-07-28` is a correct statement
      // of preference and a guaranteed disconnection.
      const asked = message.params?.protocolVersion ?? null;
      const agreed = SUPPORTED_VERSIONS.includes(asked) ? asked : LEGACY_VERSION;
      session.version = agreed;
      return ok(message.id, {
        protocolVersion: agreed,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
        instructions:
          'Use collect to start a research collection, then fetch_corpus with the run id it returns. '
          + 'What comes back is collected EVIDENCE, not approved research: read buildAuthorized, and do not build while it is false.',
      });
    }

    case 'server/discover':
      // MUST be implemented (E-05). A client MAY call it first to learn versions up front.
      return ok(message.id, {
        protocolVersions: [...SUPPORTED_VERSIONS],
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} },
      });

    case 'tools/list':
      return ok(message.id, { tools: TOOLS.map((t) => ({ ...t })) });

    case 'tools/call':
      return callTool(message, { dispatch, summary, corpus, env });

    case 'ping':
      // A keep-alive during a long operation. Cheap, and its absence is the kind of thing
      // that makes a client give up on a healthy server.
      return ok(message.id, {});

    default:
      return err(message.id, ERRORS.METHOD_NOT_FOUND, `unknown method ${message.method}`);
  }
}

async function callTool(message, deps) {
  const { name, arguments: args = {} } = message.params ?? {};
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return err(message.id, ERRORS.INVALID_PARAMS, `unknown tool ${name}`);

  // Arguments that fail the schema are a TOOL result the model can read and correct, not a
  // protocol error a client raises as an exception (SEP-1303, 2025-11-25; E-01 of
  // docs/decisions/2026-09-27-mcp-protocol-versions). An unknown tool, above, stays one.
  const invalid = validateArgs(tool, args);
  if (invalid) return ok(message.id, { isError: true, content: [text(`${invalid}. Call ${name} again with arguments its inputSchema allows.`)] });

  const { token, detail } = tokenFromEnv(deps.env);
  if (!token) {
    // An absent credential is a TOOL failure, not a protocol error: the request was
    // well-formed and the server understood it. `isError` is how a tool says so, and it
    // leaves the model something to relay instead of an opaque -32603.
    return ok(message.id, {
      isError: true,
      content: [text(`${detail}. Set it in the environment before launching this server; there is no token parameter.`)],
    });
  }

  try {
    if (name === 'collect') {
      const queries = queriesInput({ queries: args.queries ?? [], urls: args.urls ?? [] });
      if (queries.error) return ok(message.id, { isError: true, content: [text(`${queries.error}. urls takes page addresses starting with https://`)] });
      const started = await deps.dispatch({
        repository: args.repository,
        inputs: {
          topic: args.topic,
          max_pages: args.max_pages ?? 8,
          depth: args.depth ?? 'quick',
          runner: args.runner ?? 'ubuntu-latest',
          client_ref: args.client_ref ?? '',
          prior: args.prior ?? '',
          prefer: args.prefer ?? '',
          queries: queries.value ?? '',
        },
        token,
      });
      return ok(message.id, {
        structuredContent: started,
        content: [text({
          ...started,
          note: 'Collection has started and takes minutes. Call fetch_corpus with this workflow_run_id. '
            + 'The corpus it returns is evidence, not approved research.',
        })],
      });
    }

    // fetch_corpus - the folder first, so an unusable one costs no GitHub call
    if (args.out_dir !== undefined) usableOutDir(args.out_dir);
    const state = await deps.summary({ repository: args.repository, runId: args.workflow_run_id, token });
    if (state.status !== 'completed') {
      return ok(message.id, {
        structuredContent: { status: state.status, workflowRunId: args.workflow_run_id, ready: false },
        content: [text(`The run is ${state.status}. Nothing to fetch yet - call again shortly.`)],
      });
    }
    if (state.conclusion !== 'success') {
      return ok(message.id, {
        isError: true,
        structuredContent: { status: state.status, conclusion: state.conclusion, ready: false },
        content: [text(`The run finished ${state.conclusion}. No corpus was produced; open ${state.htmlUrl ?? 'the run'} and read the first failing step.`)],
      });
    }

    const got = await deps.corpus({ repository: args.repository, runId: args.workflow_run_id, token, outDir: args.out_dir });
    const { validation, file } = got;
    return ok(message.id, {
      // The whole point of the format, restated where an agent cannot miss it.
      structuredContent: {
        status: validation.status,
        buildAuthorized: validation.buildAuthorized,
        state: validation.state,
        reviewedBy: validation.reviewedBy,
        packageId: validation.packageId,
        workflowRunId: args.workflow_run_id,
        errors: validation.errors,
      },
      content: [
        text(validation.buildAuthorized
          ? `This package is an APPROVED brief: the gate passed, and the brief declares it was reviewed by: ${validation.reviewedBy}. `
            + 'Read README-FIRST.md and project/research/BRIEF.md for gate warnings and known unknowns before building.'
          : `This is a COLLECTED CORPUS (${validation.state}), not an approved brief. buildAuthorized is false: `
            + 'do not build from it. Three review steps remain, and README-FIRST.md inside the package lists them.'),
        resourceLink(file, {
          name: String(file).split(/[\\/]/).pop(),
          description: `Research-Kit corpus from run ${args.workflow_run_id}, validated ${validation.status}`,
        }),
      ],
      isError: validation.status !== 'PASS',
    });
  } catch (error) {
    const e = error instanceof DispatchError ? error : null;
    return ok(message.id, {
      isError: true,
      structuredContent: e ? { code: e.code, status: e.status } : { code: 'UNKNOWN' },
      content: [text(redact(`${e?.code ?? 'error'}: ${error.message}${e?.remedy ? `\n\nfix: ${e.remedy}` : ''}`))],
    });
  }
}

/** The subset of JSON Schema the tool inputs actually use, checked rather than assumed. */
export function validateArgs(tool, args) {
  const schema = tool.inputSchema;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) return `missing required argument ${key}`;
  }
  for (const [key, value] of Object.entries(args)) {
    // `additionalProperties: false` is in the schema; enforcing it is what makes a
    // caller's typo an error rather than a silently dropped argument.
    if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) return `unknown argument ${key}`;
    const prop = schema.properties[key];
    if (prop.type === 'integer' && !Number.isInteger(value)) return `${key} must be an integer`;
    if (prop.type === 'string' && typeof value !== 'string') return `${key} must be a string`;
    if (prop.type === 'array') {
      if (!Array.isArray(value)) return `${key} must be an array`;
      if (prop.items?.type === 'string') {
        for (let index = 0; index < value.length; index += 1) {
          if (typeof value[index] !== 'string') return `${key}[${index}] must be a string`;
        }
      }
    }
    // Counted after trimming, so a blank topic is refused here rather than by GitHub's 422
    // after a dispatch round trip (found 2026-09-27).
    if (prop.minLength !== undefined && typeof value === 'string' && value.trim().length < prop.minLength) return `${key} must not be empty`;
    if (prop.enum && !prop.enum.includes(value)) return `${key} must be one of ${prop.enum.join(', ')}`;
    if (prop.minimum !== undefined && value < prop.minimum) return `${key} must be at least ${prop.minimum}`;
    if (prop.maximum !== undefined && value > prop.maximum) return `${key} must be at most ${prop.maximum}`;
  }
  return null;
}

// ---------------------------------------------------------------- stdio framing

/**
 * Newline-delimited JSON-RPC over a byte stream - the whole of the stdio binding (E-03).
 *
 * Nothing is written to stdout but responses: a stray `console.log` in a stdio server
 * corrupts the message stream, which is why every diagnostic in `bin/mcp-server.mjs` goes
 * to stderr.
 */
/**
 * The longest line the loop buffers: 4 MiB. The kit's messages are a few kilobytes - tool
 * arguments are a repository name, a topic, a list of URLs.
 */
export const MAX_LINE = 4 * 1024 * 1024;

export function createStdioLoop({ input, output, onMessage, onError = () => {}, maxLine = MAX_LINE }) {
  let buffer = '';
  // BOUNDED. The buffer grew until a newline arrived, so a client that never sent one
  // grew this process until it died (Arena break test 4, 2026-09-28). A line over the cap
  // is refused as soon as it passes it - not when its newline comes - and its bytes are
  // dropped through that newline, so the next message is served. Closing the connection
  // instead would end the session over one bad message.
  let discarding = false;
  const tooLong = () => output.write(`${JSON.stringify(err(null, ERRORS.INVALID_REQUEST,
    `message longer than ${maxLine} characters - refused`))}\n`);

  // SERIALISED, and the test that forced this found a real defect rather than a timing
  // quirk. `data` fires per chunk, so an async handler that awaits mid-chunk can be
  // re-entered by the next chunk while `buffer` is half-consumed: two callbacks then
  // read and rewrite the same string and a message is dropped or doubled. Responses also
  // arrived out of order, which JSON-RPC tolerates but nothing here needed.
  //
  // One promise chain makes each chunk finish before the next begins. It costs the
  // concurrency a stdio server has no use for: the client is one process, and the work
  // behind a tool call is a network round trip that would not go faster interleaved.
  let queue = Promise.resolve();

  /** Parse one line and answer it. Shared by the newline-driven drain and the end-of-stream flush. */
  async function serve(raw) {
    const line = raw.trim();
    if (!line) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify(err(null, ERRORS.PARSE, 'invalid JSON'))}\n`);
      return;
    }
    try {
      const response = await onMessage(parsed);
      if (response) output.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      onError(error);
      if (parsed?.id !== undefined && parsed?.id !== null) {
        output.write(`${JSON.stringify(err(parsed.id, ERRORS.INTERNAL, error.message))}\n`);
      }
    }
  }

  async function drain() {
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const wasDiscarding = discarding;
      discarding = false;
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
      if (wasDiscarding) continue;
      if (raw.length > maxLine) { tooLong(); continue; }
      await serve(raw);
    }
    // What is left has no newline yet. Past the cap, refuse it now and drop it.
    if (buffer.length > maxLine || (discarding && buffer)) {
      if (!discarding) tooLong();
      discarding = true;
      buffer = '';
    }
  }

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    // A rejection here would be an unhandled one and would take the process down; the
    // server must outlive a single bad message.
    queue = queue.then(drain).catch((error) => onError(error));
  });

  // THE TAIL. `drain` serves only what a newline terminates, so a client that wrote one
  // request and then closed the stream without one - `printf '{"jsonrpc":"2.0",...}' |
  // node bin/mcp-server.mjs`, a harness that ends stdin as soon as the bytes are written -
  // left its message in `buffer` for ever. It saw a clean exit and no reply, which is
  // indistinguishable from a server that never received the request: the same silent loss
  // F-2 fixed for calls already IN FLIGHT, and left standing for the unterminated one
  // (found 2026-09-29, break-test).
  //
  // Registered before `exitWhenSettled`'s own 'end' listener, which is what makes the
  // answer land - this enqueues the flush, and only afterwards does that one read the
  // current tail of `queue` and wait for it.
  input.on('end', () => {
    const tail = buffer;
    buffer = '';
    if (discarding || !tail.trim()) return;
    if (tail.length > maxLine) { tooLong(); return; }
    queue = queue.then(() => serve(tail)).catch((error) => onError(error));
  });

  /**
   * Resolves when every chunk read so far has been handled - which is the moment it is
   * safe to stop the process. Read through the closure, so it is always the CURRENT tail
   * of the chain and not the one that existed when this object was returned.
   */
  return { settled: () => Promise.resolve(queue).catch(() => {}) };
}

/**
 * How long a closed stdin waits for answers that are still in flight before the server
 * goes anyway.
 *
 * The wait has to be bounded, because the client is GONE by then. `fetch_corpus` waits on
 * a workflow run for up to half an hour, and an answer with nowhere to land must not keep
 * this process alive for it.
 */
export const END_GRACE_MS = 10 * 1000;

/**
 * Stop the process when stdin closes - but only once everything already read has been
 * ANSWERED.
 *
 * `process.stdin.on('end', () => process.exit(0))` truncated the response to any call
 * still in flight. A tool call is async, so 'end' fires while its promise is pending and
 * `exit` wins the race: the client sees a clean exit and no reply at all, which is
 * indistinguishable from a server that never received the request (found 2026-09-29,
 * break-test). A half-closing client - a shell pipeline, a harness that writes one
 * request and closes - lost every async tool result this way.
 */
export function exitWhenSettled({
  input, settled, graceMs = END_GRACE_MS,
  exit = (code) => process.exit(code), onDraining = () => {},
}) {
  input.on('end', () => {
    onDraining();
    const timer = setTimeout(() => exit(0), graceMs);
    // Unref'd: the grace is a ceiling on the wait, not a reason to stay alive. Nothing
    // else pending means the loop drains on its own and exits without the timer.
    if (typeof timer?.unref === 'function') timer.unref();
    // Injected `exit` may throw to end a test; a rejected `settled` must not become an
    // unhandled rejection that takes the server down on its way out.
    settled().then(() => exit(0), () => exit(0));
  });
}
