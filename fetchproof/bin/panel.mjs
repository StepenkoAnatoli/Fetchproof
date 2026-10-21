#!/usr/bin/env node
// bin/panel.mjs - the desktop panel: keys, doctor, update, the topic and the builder side,
// in a browser tab served from 127.0.0.1 (ADR-0147). It runs the kit's own commands and
// never collects.

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { parseFlags, refuseUnknownFlags, checkFlagValues, tolerateClosedStdout } from '../lib/core.mjs';
import { createPanel } from '../lib/panel.mjs';

tolerateClosedStdout();

const { flags, positional } = parseFlags(process.argv.slice(2));
// A stray argument is refused below, in words that name --project.
refuseUnknownFlags(flags, ['help', 'project', 'port', 'no-open'], { takes: Infinity });
checkFlagValues(flags, { project: 'value', port: { int: true, min: 0, max: 65535 } });

if (flags.help) {
  process.stdout.write(`panel - a small window over the kit: keys, doctor, update, the topic, the builder side.

  node fetchproof/bin/panel.mjs [--project <folder>] [--port <n>] [--no-open]

  --project <folder>   the project to show (default: this folder); can be changed in the page
  --port <n>           listen on this port of 127.0.0.1 (default: any free one)
  --no-open            print the address instead of opening the browser

The page runs doctor, handoff, preflight and install, and saves the SerpAPI key to the
machine config. It never collects. Stop it with Ctrl+C.
`);
  process.exit(0);
}

if (positional.length || [].concat(flags.project ?? []).length > 1 || [].concat(flags.port ?? []).length > 1) {
  process.stderr.write('panel: one --project and one --port at most, and no other arguments\n');
  process.exit(2);
}

const project = path.resolve(typeof flags.project === 'string' ? flags.project : process.cwd());
if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
  process.stderr.write(`panel: ${project} is not a folder\n`);
  process.exit(2);
}

const panel = createPanel({ project });
let address;
try {
  address = await panel.listen(flags.port === undefined ? 0 : Number(flags.port));
} catch (err) {
  process.stderr.write(`panel: could not listen on 127.0.0.1${flags.port ? `:${flags.port}` : ''} - ${err.message}\n`);
  process.exit(2);
}

process.stdout.write(`panel: ${address.url}\n  project: ${project}\n  Ctrl+C stops it. The address carries a one-time token; do not share it.\n`);

/** Hand the address to the desktop's browser. The URL is ours: digits, dots, a hex token. */
function openBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['explorer.exe', [url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => process.stderr.write('panel: could not open a browser; open the address above yourself\n'));
    child.unref();
  } catch {
    process.stderr.write('panel: could not open a browser; open the address above yourself\n');
  }
}

if (!flags['no-open']) openBrowser(address.url);

const stop = () => { panel.close().then(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
