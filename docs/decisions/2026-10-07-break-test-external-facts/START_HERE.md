# Start here

For me, the operator. Not for the AI.

New to the kit? The five-minute first run, with no account, is "Try it in five minutes" on
the front page: https://github.com/StepenkoAnatoli/Research-Kit#try-it-in-five-minutes

---

## Where things live

| What | Where |
|---|---|
| The kit itself | `/home/user/.agents/research-kit` - installed once, never moves |
| Research for THIS project | `<project folder>\research\` - working files, leave alone |
| My one pasteable file | `<project folder>\research\audits\` - named by topic + version + date |

Nothing gets copied between folders. Each project keeps its own research, inside itself.

The commands below are written for PowerShell, bash and zsh. In cmd.exe, write `%USERPROFILE%`
where a command says `$HOME`.

---

## Starting new research

1. **Open the project folder** - the actual project, never the kit's own folder.
2. **Say what I want researched.** The agent reads the skill automatically and starts.
3. **When it's done, ask for the audit** - that's my one file:
   ```
   node "/home/user/.agents/research-kit/bin/audit.mjs"
   ```
   Written to `research\audits\` in the project folder. One attachment instead of ten
   pastes:
   ```
   node "/home/user/.agents/research-kit/bin/audit.mjs" --zip
   ```

If I'm ever unsure which folder I'm in, check before starting - the agent should ask if
it isn't sure, not go searching my disk.

---

## Picking up where I left off

From inside the project folder:

```
node "/home/user/.agents/research-kit/bin/doctor.mjs"
node "/home/user/.agents/research-kit/bin/preflight.mjs"
git log --oneline -5
git status
```

Then tell the agent to resume. Nothing committed is ever lost, and credits already spent
are not spent again.

---

## If something looks broken

```
node "/home/user/.agents/research-kit/bin/doctor.mjs"
```

It names every problem and prints the exact fix. Run it, fix what it says, run it again.
Stop at READY.

---

## Budget

1,000 Firecrawl credits a month. Resets monthly. Stops cleanly at zero - no surprise
charges. A research cycle is roughly 40 credits.

---

## The rules the AI follows

Live in `AGENTS.md` inside the kit and every project it touches. I don't need to know
them - any AI that opens the repo is bound by them.
