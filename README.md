# cw-crew

Claude Code plugin. The main session (Opus) leads; cheap headless workers do the reading and the coding.

- **`orchestrate` skill** — the playbook: scout → spec → coder → reviewer → verify, fleets, permissions, cost rules.
- **`cw` CLI** (`bin/`, on the Bash PATH) — starts one `claude -p` worker with a ~3k-token cold start.
  - `scout` = Haiku, read-only (+ web with `-w`). `coder` = Sonnet, edits and runs tests (auto mode, risky calls come back as requests). `reviewer` = Sonnet, read-only, no web: a fresh context reads a diff that `cw` inlines and reports `BLOCKER` / `SUGGEST` lines with file:line.
  - Tiers (`-M`): `haiku`, `sonnet`, `opus` run on Claude.
  - Codex tiers (`-M luna|sol|astra`, opt-in with `CW_CODEX=1`) run the official `codex` CLI on your ChatGPT plan: lean start (3.6k tokens), OS sandbox, fallback to Claude near the limit. `cwcodex` prints the limits without a model call. The sandbox has no network, so in a `uv` project cw syncs `.venv` before a Codex coder starts; new dependencies need a lead.
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
- Pane legend: `↻` resumed or continued · `✦`/`jev` effort chosen by Jev · the sparkline is recent activity · header `5h ~N%` is the share of the 5-hour limit used.
- Claude desktop app (Code tab): the same pane and PNG sprites, drawn as one SVG; a `details ›` button per worker sits under it. Install the plugin from a terminal at user scope; the desktop session loads it.

## Use

Ask Claude to delegate ("use workers", `/orchestrate`). By hand:

```sh
cw scout -f src/app.ts <<< "List every caller of parseConfig with file:line."
cw coder -P api <<< "Use the API provider for this run."
cwgo api coder -W api -T 'npm test' -- specs/common.md specs/api.md
#   run cwgo in the background: it waits for its worker and prints the report or question
cwwait   # recovery: fires when any unreported worker finishes (use with cwgo -d)
cwgo api.rv reviewer -W api -- specs/api.md   # review worktree api's changes
cw reviewer -B main <<< "Focus: auth."          # review this branch since main
```

## Telemetry

`cwstats [--days N]` reads the run logs in `$CW_LOG_DIR` and prints success, timeout, escalation and cost per role, model and effort. It is local only: nothing leaves your machine. `cwstats --export` prints a numbers-only JSON summary (no tasks, paths or ids) that you can share by hand.

## Settings (env)

| Var | Default | What |
|---|---|---|
| `CW_SCOUT_MODEL` / `CW_CODER_MODEL` / `CW_REVIEWER_MODEL` | `claude-haiku-5-5` / `claude-sonnet-5-5` / `claude-sonnet-5-5` | worker models |
| `CW_CODEX` | 0 | `1` = Codex tiers `luna`, `sol`, `astra` on; scouts default to `luna`, coders and reviewers to `sol`. **Tasks and the files workers read go to OpenAI** |
| `CW_CODEX_MAX` | 90 | percent used (5h or weekly) at which a run falls back to Claude; 100 means use Codex until the limit is fully spent |
| `CW_PRIORITY` | — | colon-separated provider order, e.g. `codex:api:claude`; cw uses the first available provider |
| `CW_API_KEY` | — | Anthropic API key for the `api` provider; billed per token |
| `CW_API_KEYCHAIN` | — | macOS keychain item name to read the API key from (like `CW_JEV_KEYCHAIN`) |
| `CW_API_RETRY` | 3600 | seconds before retrying an API provider marked spent |
| `CW_CODEX_TTL` | 60 | seconds one limit reading is reused (macOS; Linux reads every run) |
| `CW_DENY` | none | colon list of extra absolute paths denied to every worker, on top of the default credential dirs (Claude: Read deny rules, plus Edit/Write for coders, kept under `-a`; Codex: filesystem deny) |
| `CW_DENY_GLOBS` | none | colon list of extra denied globs for every worker, on top of the default secret globs |
| `CW_CODEX_ONLY_DENY` | none | colon list of absolute paths denied only to Codex workers (data kept Claude-only) |
| `CW_CODEX_DENY` | `$HOME/` + `.ssh`, `.aws`, `.azure`, `.config/gcloud`, `.gnupg`, `.netrc`, `.config/gh` | colon list of extra absolute paths Codex workers may not read; defaults always apply. Other reads remain open; `.codex` is not denied (auth/runtime) |
| `CW_CODEX_DENY_GLOBS` | `**/.env`, `**/.env.*`, `**/*.pem`, `**/*.key`, `**/*.p8`, `**/*.p12`, `**/*.pfx`, `**/*.crt`, `**/*.cer`, `**/*.der`, `**/*.jks`, `**/*.keystore`, `**/local.properties` | colon list of extra denied globs under the work dir; defaults always apply, at any depth (including the root) |
| `CW_CODEX_LUNA`, `CW_CODEX_SOL`, `CW_CODEX_ASTRA` | `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra` | model behind each tier |
| `CW_MAX_TURNS` | 80 | coder turn limit |
| `CW_TIMEOUT` | 3600 coder / 1200 scout, reviewer | seconds |
| `CW_ACCEPT_TMO` | 1800 | seconds acceptance command may run |
| `CW_AUTO_CONTINUE` | 1 | number of automatic turn-limit continuations |
| `CW_EXIT_GRACE` | 20 | seconds Claude gets to exit after its result |
| `CW_JEV_MODEL` | `typesafe/jev-1.13` | OpenRouter model used for Jev effort selection |
| `CW_APPLY_LINES` | 150 | changed lines requiring clean review before automatic apply |
| `CW_APPLY_FILES` | 4 | changed files requiring clean review before automatic apply |
| `CW_APPLY_RISKY` | `auth\|secret\|token\|passw\|credential\|permission\|migrat\|deny\|security\|\.env` | path regex requiring clean review before automatic apply |
| `CW_REVIEW_MAX` | 60000 | characters of diff a reviewer gets inline; the rest it reads itself |
| `CW_WAIT_REPORT` | 6000 | report bytes shown by `cwwait` |
| `CW_LOG_DIR` | `~/.claude/cw-runs` | run logs (the pane reads them too); runs older than 2 days move to `$CW_LOG_DIR-archive` |
| `CW_FLEET` | `$CW_LOG_DIR/fleet/<repo>` | fleet dir |
| `CW_WT_ROOT` | `<repo>/.crew` | worktree root; default adds `/.crew/` to the repo's `.gitignore` |
| `CW_JEV` | 0 | `1` = Jev (OpenRouter) picks worker effort per task. **Sends the first 20k characters of each task to OpenRouter.** Off: role default (scout low, coder medium) |
| `CW_JEV_SURE` | 70 | Jev probability (%) needed to pick `high`; a less sure `high` runs at `medium` |
| `OPENROUTER_API_KEY` / `CW_JEV_KEYCHAIN` | — | key for `CW_JEV=1`; on macOS a keychain service name works instead of the env key |
| `CW_ENTRYPOINT` | — | client label for Claude workers, e.g. `cw-crew`. Unset, `claude -p` reports `sdk-cli`. Undocumented by Anthropic and may change (claude-code#97074) |
| `CW_KILL_ALLOW` | — | colon-separated command prefixes `cwkill` may also stop |
| `CW_ACCEPT_FAIL_RE` | `^\s*(FAIL\b(?!:? *0\b)\|SCRIPT ERROR)` | Perl regex: a `-T` run that exits 0 but prints a matching line is `accept=FAIL(output)`. Empty turns it off |

Claude workers: the deny rules cover the Read/Edit/Write tools, and Bash runs in Claude Code's OS sandbox: the deny list (and files matching the secret globs under the work dir) cannot be read, the network is off, and writes outside the work dir fail, as for Codex. A worker that needs one blocked command ends with `PERMISSION: Bash(<cmd>)`; `-a 'Bash(<cmd>)'` runs that exact command outside the sandbox. Temp dirs and build caches (`/tmp`, `$TMPDIR`, `~/Library/Caches`, `~/.cache`, `~/Library/Developer`, Godot's app data) stay writable; `CW_SANDBOX_WRITE` adds paths. `swift build` and `swift test` run outside the sandbox by default, since SwiftPM nests its own sandbox and signs entitlements (`CW_SANDBOX_EXCLUDE`, colon list of command patterns; empty turns it off).

Set them in `~/.claude/settings.json` under `env`.

### Spend order

Set the order cw should try providers:

```sh
export CW_PRIORITY=codex:api:claude
```

cw takes the first available provider in the list.
Codex uses your ChatGPT plan; `api` bills the Anthropic API key per token.
`claude` uses your Claude subscription.
When a provider runs dry, cw moves on to the next one.
Use `-P provider` only when a technical need requires a specific provider.

## Develop

```sh
claude --plugin-dir .          # run from this folder
claude plugin validate .
claude plugin test .
tests/cw.sh                    # bin/cw against a fake claude (no model call)
bash tests/cwwt.sh              # worktree lifecycle in a disposable repo
tools/gen_frames.sh            # rebuild frames/ after changing hooks/creatures.ts (needs bun + Pillow)
```

## License

MIT
