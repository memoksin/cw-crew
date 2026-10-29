# cw-crew

Claude Code plugin. The main session (Opus) leads; cheap headless workers do the reading and the coding.

- **`orchestrate` skill** — the playbook: scout → spec → coder → reviewer → verify, fleets, permissions, cost rules.
- **`cw` CLI** (`bin/`, on the Bash PATH) — starts one `claude -p` worker with a ~3k-token cold start.
  - `scout` = Haiku, read-only (+ web with `-w`). `coder` = Sonnet, edits and runs tests (auto mode, risky calls come back as requests). `reviewer` = Sonnet, read-only, no web: a fresh context reads a diff that `cw` inlines and reports `BLOCKER` / `SUGGEST` lines with file:line.
  - Tiers (`-M`): `haiku`, `sonnet`, `opus` run on Claude. Opt-in with `CW_AGY=1`: `flash` (Gemini 3.8 Flash) runs on the Antigravity CLI (`agy`, signed in to a Google AI plan) and spend Google quota first; scouts then default to `flash`. Falls back to Claude when agy quota runs low. **agy tiers send the task and the files they read to Google.** Setup below.
  - Fleet tools: `cwgo` (run one worker, notify when it finishes or asks), `cwwait` (recovery waiter), `cwls`, `cwopen`, `cwwt` (one git worktree per writer), `cwkill`, `cwmark` (record correctness verdict on a worker run), `cwstats` (outcomes per model, tier and effort from the run logs).
- **Crew pane** — pixel-art side pane: each worker as a creature on its own card, live state, questions with a raised hand. `/crew` opens it; it also opens itself when a worker starts.
  - A card's bottom edge fills with the limit closest to running out (context, turns or time), coloured as [memobar](https://github.com/memoksin/memobar) colours usage: green under 50%, yellow to 80%, red from 80%. From 50% the card names it (`ctx 64%`).
  - A finished card shows what it left: `+128 −14` lines, `✓ test` / `✗ test`, and its cost. `✦` after the effort pips: Jev chose the effort.
  - The header counts the crew and sums its cost; `5h ~3%` estimates its share of the 5-hour limit (the window's rise since the session began, split by spend between lead and crew).
  - Click a worker's name for its details: the three limits as bars, cost, cache hits, effort and branch, then `notes`, `steps`, `report` and `test` tabs. `c` copies its resume command, `b` goes back.

## Install

```
/plugin install cw-crew --marketplace memoksin/cw-crew
```

Answer `y` to add the marketplace, then pick a scope.

### Windows

1. In PowerShell, install everything with winget:

   ```powershell
   winget install -e --id Git.Git
   winget install -e --id jqlang.jq
   winget install -e --id Anthropic.ClaudeCode
   winget install -e --id BurntSushi.ripgrep.MSVC   # optional, faster scout searches
   winget install -e --id sharkdp.fd                # optional
   ```

   Git for Windows brings Git Bash (Claude Code's Bash tool), `perl` and `git`.
2. Open a new terminal so the new PATH applies, then run `claude` and the `/plugin install` line above.
3. If Claude Code does not find Git Bash, add to `%USERPROFILE%\.claude\settings.json`:

   ```json
   { "env": { "CLAUDE_CODE_GIT_BASH_PATH": "C:\\Program Files\\Git\\bin\\bash.exe" } }
   ```

4. Check: ask Claude to run `cw scout <<< "Reply ok. No tools."`. The last line must contain `rc=0`.

Update later with `winget upgrade --all` and `claude plugin update cw-crew@cw-crew`.

## Requirements

- macOS, Linux or Windows, bash. On Windows: Git for Windows and `jq`, see [Windows](#windows).
- `claude`, `jq`, `perl`, `git` on PATH. `rg` and `fd` help scouts but are optional.
- Right-side pane: fullscreen layout (`CLAUDE_CODE_NO_FLICKER=1`, outside tmux) and ≥110 columns. Otherwise it sits above the prompt. Sprites need a terminal with an image protocol; others get half-blocks.
- Claude desktop app (Code tab): the same pane and PNG sprites, drawn as one SVG; a `details ›` button per worker sits under it. Install the plugin from a terminal at user scope; the desktop session loads it.

## Use

Ask Claude to delegate ("use workers", `/orchestrate`). By hand:

```sh
cw scout -f src/app.ts <<< "List every caller of parseConfig with file:line."
cwgo api coder -W api -T 'npm test' -- specs/common.md specs/api.md
#   run cwgo in the background: it waits for its worker and prints the report or question
cwwait   # recovery: fires when any unreported worker finishes (use with cwgo -d)
cwgo api.rv reviewer -W api -- specs/api.md   # review worktree api's changes
cw reviewer -B main <<< "Focus: auth."          # review this branch since main
```

## Telemetry

`cwstats [--days N]` reads the run logs in `$CW_LOG_DIR` and prints success, timeout, escalation and cost per role, model and effort. It is local only: nothing leaves your machine. `cwstats --export` prints a numbers-only JSON summary (no tasks, paths or ids) that you can share by hand.

## Google AI tiers (optional)

Spend a Google AI plan (Pro, Plus, Ultra) before Claude limits.

1. Install the Antigravity CLI (`agy`), run `agy` once and sign in.
2. Set `CW_AGY=1` (for example in `~/.claude/settings.json` under `env`).
3. Check: `cwagy` prints the quota of each home.
4. More accounts: `cwagy login ~/.claude/cw-agy-2`, sign in with the other account, quit, then set
   `CW_AGY_HOME=~/.claude/cw-agy:~/.claude/cw-agy-2`. cw moves to the next home when one runs out.
   **macOS: does not work yet.** agy reads its login from the macOS keychain in every home, so an extra home signs in as
   the first account. Switch accounts by hand there (`agy`, then `/logout` and `/login`).

agy coders run without permission prompts. cw guards them with deny rules (its ask and hard rules) and an env that
makes git push and commit fail. A destructive command in another syntax can still run: give them small tasks.

## Settings (env)

| Var | Default | What |
|---|---|---|
| `CW_SCOUT_MODEL` / `CW_CODER_MODEL` / `CW_REVIEWER_MODEL` | `claude-haiku-5-5` / `claude-sonnet-5-5` / `claude-sonnet-5-5` | worker models |
| `CW_AGY` | 0 | `1` = agy tier `flash` on; scouts default to `flash` |
| `CW_AGY_EXPLORE` | — | a date (YYYY-MM-DD): until then the lead adds extra flash work next to each task (on its proper tier) to tune Gemini prompts |
| `CW_AGY_HOME` | `~/.claude/cw-agy` | colon list of agy homes, one per Google account, tried in order until one has quota. The first shares your own `agy` login; add more with `cwagy login DIR` |
| `CW_AGY_MIN` | 5 | agy quota % (5h or weekly) under which a run falls back to Claude |
| `CW_MAX_TURNS` | 80 | coder turn limit |
| `CW_TIMEOUT` | 3600 coder / 1200 scout, reviewer | seconds |
| `CW_REVIEW_MAX` | 60000 | characters of diff a reviewer gets inline; the rest it reads itself |
| `CW_LOG_DIR` | `~/.claude/cw-runs` | run logs (the pane reads them too) |
| `CW_FLEET` | `$CW_LOG_DIR/fleet/<repo>` | fleet dir |
| `CW_WT_ROOT` | `../<repo>-wt` | worktree root |
| `CW_JEV` | 0 | `1` = Jev (OpenRouter) picks worker effort per task. **Sends the first 20k characters of each task to OpenRouter.** Off: role default (scout low, coder medium) |
| `CW_JEV_SURE` | 70 | Jev probability (%) needed to pick `high`; a less sure `high` runs at `medium` |
| `OPENROUTER_API_KEY` / `CW_JEV_KEYCHAIN` | — | key for `CW_JEV=1`; on macOS a keychain service name works instead of the env key |
| `CW_KILL_ALLOW` | — | colon-separated command prefixes `cwkill` may also stop |
| `CW_ACCEPT_FAIL_RE` | `^\s*(FAIL\b(?!:? *0\b)\|SCRIPT ERROR)` | Perl regex: a `-T` run that exits 0 but prints a matching line is `accept=FAIL(output)`. Empty turns it off |

Set them in `~/.claude/settings.json` under `env`.

## Develop

```sh
claude --plugin-dir .          # run from this folder
claude plugin validate .
claude plugin test .
tests/cw.sh                    # bin/cw against a fake claude (no model call)
tools/gen_frames.sh            # rebuild frames/ after changing hooks/creatures.ts (needs bun + Pillow)
```

## License

MIT
