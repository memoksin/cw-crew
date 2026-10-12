# cw-crew

Claude Code plugin. The main session (Opus) leads; cheap headless workers do the reading and the coding.

- **`orchestrate` skill** — the playbook: scout → spec → coder → verify, fleets, permissions, cost rules.
- **`cw` CLI** (`bin/`, on the Bash PATH) — starts one `claude -p` worker with a ~3k-token cold start.
  - `scout` = Haiku, read-only (+ web with `-w`). `coder` = Sonnet, edits and runs tests (auto mode, risky calls come back as requests).
  - Fleet tools: `cwgo` (background start), `cwwait` (notify on each finish), `cwls`, `cwopen`, `cwwt` (one git worktree per writer), `cwkill`.
- **Crew pane** — pixel-art side pane: each worker as a creature, live state, questions with a raised hand. `/crew` opens it; it also opens itself when a worker starts.

## Install

```
/plugin install cw-crew --marketplace memoksin/cw-crew
```

Answer `y` to add the marketplace, then pick a scope.

## Requirements

- macOS or Linux, bash.
- `claude`, `jq`, `perl`, `git` on PATH. `rg` and `fd` help scouts but are optional.
- Right-side pane: fullscreen layout (`CLAUDE_CODE_NO_FLICKER=1`, outside tmux) and ≥110 columns. Otherwise it sits above the prompt. Sprites need a terminal with an image protocol; others get half-blocks.

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
