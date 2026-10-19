# cw-crew

Claude Code plugin. The main session (Opus) leads; cheap headless workers do the reading and the coding.

- **`orchestrate` skill** — the playbook: scout → spec → coder → verify, fleets, permissions, cost rules.
- **`cw` CLI** (`bin/`, on the Bash PATH) — starts one `claude -p` worker with a ~3k-token cold start.
  - `scout` = Haiku, read-only (+ web with `-w`). `coder` = Sonnet, edits and runs tests (auto mode, risky calls come back as requests).
  - Fleet tools: `cwgo` (background start), `cwwait` (notify on each finish), `cwls`, `cwopen`, `cwwt` (one git worktree per writer), `cwkill`.
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
cwwait   # run in the background; fires when a worker finishes
```

## Settings (env)

| Var | Default | What |
|---|---|---|
| `CW_SCOUT_MODEL` / `CW_CODER_MODEL` | `claude-haiku-5-5` / `claude-sonnet-5-5` | worker models |
| `CW_MAX_TURNS` | 80 | coder turn limit |
| `CW_TIMEOUT` | 3600 coder / 1200 scout | seconds |
| `CW_LOG_DIR` | `~/.claude/cw-runs` | run logs (the pane reads them too) |
| `CW_FLEET` | `$CW_LOG_DIR/fleet/<repo>` | fleet dir |
| `CW_WT_ROOT` | `../<repo>-wt` | worktree root |
| `CW_JEV` | 0 | `1` = Jev (OpenRouter) picks worker effort per task. **Sends the first 20k characters of each task to OpenRouter.** Off: role default (scout low, coder medium) |
| `OPENROUTER_API_KEY` / `CW_JEV_KEYCHAIN` | — | key for `CW_JEV=1`; on macOS a keychain service name works instead of the env key |
| `CW_KILL_ALLOW` | — | colon-separated command prefixes `cwkill` may also stop |

Set them in `~/.claude/settings.json` under `env`.

## Develop

```sh
claude --plugin-dir .          # run from this folder
claude plugin validate .
claude plugin test .
tools/gen_frames.sh            # rebuild frames/ after changing hooks/creatures.ts (needs bun + Pillow)
```

## License

MIT
