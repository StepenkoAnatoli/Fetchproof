#!/usr/bin/env node
// bin/install-hooks.mjs - install, repair, or remove the two gates; declare the role.

import { parseFlags, refuseUnknownFlags, checkFlagValues, writeFailure } from '../lib/core.mjs';
import { installCommitGate, installEditGate, uninstall, settingsState, retiredRepairNote } from '../lib/installer.mjs';
import { saveConfig, loadConfig, machineRole, ROLES, EDIT_GATE_MODES, posture } from '../lib/machine.mjs';

const { flags } = parseFlags(process.argv.slice(2));
// An unknown flag is refused before anything runs: `install-hooks --unistall` installed the gates
// and `new-project --topc` scaffolded an "Untitled topic" (found 2026-09-27).
refuseUnknownFlags(flags, ['help', 'dry-run', 'git-only', 'edit-only', 'mode', 'role', 'fail-closed', 'fail-open', 'uninstall']);
checkFlagValues(flags, { mode: { choices: EDIT_GATE_MODES }, role: { choices: ROLES } });

if (flags.help) {
  process.stdout.write(`install-hooks - the commit gate, the edit-time gate, and this machine's role.

  node research-kit/bin/install-hooks.mjs [options]

  --dry-run            show what would change; write nothing
  --git-only           install the commit gate alone
  --edit-only          install the edit-time gate alone
  --mode <m>           edit-time gate mode: ${EDIT_GATE_MODES.join(' | ')}
  --role <r>           declare this machine: ${ROLES.join(' | ')}
  --fail-closed        invert the fail-open default, deliberately
  --fail-open          restore the default
  --uninstall          restore the machine to its pre-install state

The role is machine state, not project state: the same clone keeps one shape on both
boxes. A builder must not collect, and its collection CLIs refuse before any adapter.
`);
  process.exit(0);
}

try {
  // Read FIRST. Until 2026-10-03 it was read after the role, the posture and the uninstall had
  // run, so `--dry-run --role builder --fail-closed` saved both and `--dry-run --uninstall`
  // removed the installed commit gate (outside audit). A preview writes nothing, on any path.
  const dryRun = Boolean(flags['dry-run']);
  const would = dryRun ? 'would ' : '';

  if (flags.role !== undefined) {
    const role = String(flags.role);
    if (!ROLES.includes(role)) {
      process.stderr.write(`unknown role "${role}". Known roles: ${ROLES.join(', ')}\n`);
      process.exit(2);
    }
    if (!dryRun) saveConfig({ role });
    process.stdout.write(`${would}${dryRun ? 'set ' : ''}role: ${role}${role === 'builder' ? ' - this machine will refuse to collect' : ' - this machine may collect'}\n`);
  }

  if (flags['fail-closed']) { if (!dryRun) saveConfig({ failOpen: false }); process.stdout.write(`${would}${dryRun ? 'set ' : ''}posture: fail-closed\n`); }
  if (flags['fail-open']) { if (!dryRun) saveConfig({ failOpen: true }); process.stdout.write(`${would}${dryRun ? 'set ' : ''}posture: fail-open\n`); }

  if (flags.uninstall) {
    const result = uninstall({ dryRun });
    // A refusal is said, and the exit is 1: the gate is still installed (#363).
    if (!result.commit.ok) {
      process.stderr.write(`commit gate: ${result.commit.reason}\n`);
    } else if (result.commit.restored === undefined) {
      process.stdout.write(`commit gate: ${would}leave core.hooksPath as ${result.commit.left ?? '(unset)'} - the kit did not set it, or it was changed since\n`);
    } else {
      process.stdout.write(`commit gate: ${would}restore${dryRun ? '' : 'd'} core.hooksPath to ${result.commit.restored ?? '(unset)'}\n`);
    }
    process.stdout.write(`edit gate: ${would}remove${dryRun ? '' : 'd'} ${result.edit.removed ?? 0} registration(s)${result.edit.ok ? '' : ` - ${result.edit.reason}`}\n`);
    process.exit(result.commit.ok && result.edit.ok ? 0 : 1);
  }

  const wantCommit = !flags['edit-only'];
  const wantEdit = !flags['git-only'];
  let failed = false;

  // `!ok` is tested before `dryRun`: a dry run that cannot do what it was asked reports the
  // refusal, in the same words and with the same exit code as the real run, rather than
  // printing a promise that the real run would break (found 2026-10-01, break-test).
  if (wantCommit) {
    const result = installCommitGate({ dryRun });
    if (!result.ok) { process.stderr.write(`commit gate: ${result.reason}\n`); failed = true; }
    else if (result.dryRun) process.stdout.write(`would set core.hooksPath=${result.would} (was ${result.previous ?? 'unset'})\n`);
    else process.stdout.write(`commit gate: core.hooksPath=${result.hooksPath} (was ${result.previous ?? 'unset'})\n`);
    // Said on stderr, after the install line, and the exit code stays 0: the machine-wide gate
    // IS installed, and this one repository is where it will not run (ADR-0131).
    if (result.ok && result.displaced) {
      process.stderr.write(`commit gate: this repository sets core.hooksPath=${result.displaced.local}, which displaces the gate here `
        + '(husky, lefthook, simple-git-hooks and pre-commit all do this) - the gate runs in every other repository on this machine. '
        + 'To gate this one too: git config --local --unset core.hooksPath\n');
    }
  }

  if (wantEdit) {
    const before = settingsState();
    const result = installEditGate({ dryRun, mode: typeof flags.mode === 'string' ? flags.mode : '' });
    if (!result.ok) {
      process.stderr.write(`edit gate: ${result.reason}\n`);
      failed = true;
    } else if (result.dryRun) {
      process.stdout.write(`would register in ${result.file}: ${result.would}\n`);
      if (result.removed?.length) process.stdout.write(`  ${retiredRepairNote(result.removed)}\n`);
    } else {
      process.stdout.write(`edit gate: registered in ${result.file}${before === 'retired' ? ' (repaired)' : ''}\n`);
      if (result.note) process.stdout.write(`  ${result.note}\n`);
      if (result.repairedSettings) process.stdout.write('  repaired one known corruption in the settings file; a backup was written beside it\n');
    }
  }

  const config = loadConfig();
  const state = posture();
  process.stdout.write(`
role            ${machineRole()}
posture         ${state.failOpen ? 'fail-open' : 'fail-closed'} (config ${state.configState})
edit gate mode  ${config.editGate.mode}
evidencePolicy  ${config.evidencePolicy}
`);
  process.exit(failed ? 1 : 0);
} catch (err) {
  const why = err.code === 'CONFIG-UNREADABLE' ? err.message : writeFailure(err);
  if (!why) throw err;
  process.stderr.write(`${why}\n`);
  process.exit(2);
}
