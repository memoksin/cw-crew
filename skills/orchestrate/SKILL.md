---
name: orchestrate
description: Opus orchestrates lean headless Claude workers to save usage limits. Haiku scout reads, gathers context, researches the web and reports; Sonnet coder writes code. Use for any multi-file reading, research or implementation work. Trigger on /orchestrate, "delegate", "use workers", "let Haiku/Sonnet do it".
---

# Orchestrate headless workers

Opus = lead. Plans, writes task specs, runs workers, verifies, asks for fixes, integrates. Workers are `claude -p` processes started by `cw`. Never use the Agent tool (subagents): each one starts with a ~25–42k token context.

## Roles

| Role | Model | Tools | Use for |
|---|---|---|---|
| `scout` | Haiku | Read, read-only Bash (rg, fd, git log…); `-w` adds WebFetch/WebSearch | find files and call sites, summarize code/docs, web research, logs, reports |
| `coder` | Sonnet | Read, Edit, Write, Bash (auto mode; commit/push/reset/clean blocked) | implement a spec, run its tests |

Override model: `CW_SCOUT_MODEL`, `CW_CODER_MODEL`. Defaults are pinned full IDs (`claude-haiku-5-5`, `claude-sonnet-5-5`).

### Opus coder (rare, expensive)

Default coder is Sonnet. Use an Opus coder (`CW_CODER_MODEL=claude-opus-5-5`) only when the task is clearly beyond Sonnet:
- 3D spatial reasoning that tests cannot fully check: camera, IK/rig poses, collision geometry, procedural 3D layout judged by screenshots.
- Large cross-cutting rework (many files, subtle interacting state) where a wrong design is costly to redo.
- A Sonnet coder already failed the same task twice with a good spec.

Everything else stays Sonnet: verifiable features, test-backed fixes, UI/2D work, tooling, audio. When unsure, start Sonnet; escalate to Opus only after a real failure. Tell the user which workers run on Opus and why.

## The loop

1. Scout (Haiku) investigates **before** the work: finds files and call sites, reads code and docs, researches, reports facts.
2. Lead writes the spec from that report.
3. Coder (Sonnet) does the work.
4. Lead verifies the result **itself**: diff, reruns tests, looks at screenshots. Never hand verification or screenshot review to a scout.
5. Issues → resume the coder with the exact fixes, back to 4. A new task → back to 1.

## Run

The plugin puts `cw`, `cwgo`, `cwwait`, `cwls`, `cwopen`, `cwwt` and `cwkill` on the Bash PATH. If `command -v cw` finds nothing, call them as `${CLAUDE_SKILL_DIR}/../../bin/<name>`. Needs `claude`, `jq`, `perl`, `git`; macOS, Linux or Windows (Git for Windows' Git Bash plus `jq`: `winget install jqlang.jq`).

```sh
cw scout|coder [-C dir] [-W name] [-r sid] [-t sec] [-e ...] [-w] [-f file]... [-T 'test cmd'] < task.md
```

- Report → stdout. Meta → stderr: `[cw role model rc subtype sid turns new_in cache_r out denied secs accept=… log=…]`.
- `-f file` (repeatable) inlines the file into the prompt. Use it whenever you already know which files matter.
- `-T 'cmd'`: cw runs the acceptance command itself in the worker's dir after a clean finish. The meta line shows `accept=pass` or `accept=FAIL(rc=N)`, and on failure the report ends with the last 20 lines. Always pass it when the spec has acceptance commands, so you do not rerun them by hand just to learn pass/fail.
- Turn limit (`CW_MAX_TURNS`, coder default 80; use 150 for big tasks): cw resumes the same session once with a "continue" message (`CW_AUTO_CONTINUE`, default 1), but only if that run changed files and under half of its tool calls failed. A worker that loops stops with `error_max_turns`: read why before resuming it, never resume blindly.
- `-D dir` (repeatable): extra dir the worker may read, e.g. screenshots under `/tmp` for a scout review. Without it, reads outside the work dir are denied.
- Fix-up → `-r <sid>` (scout or coder). The worker keeps its context, so the follow-up costs only the new message. It runs in the session's own dir.
- Default timeout: coder 3600 s, scout 1200 s (`-t` or `CW_TIMEOUT` overrides). `rc=142` = timeout. Logs: `~/.claude/cw-runs/`. Read them only when the report is not enough.

### Fleet tools (use these, not hand-written nohup / tail / rg loops)

```sh
cwgo NAME coder [cw options...] -- specs/common.md specs/NAME.md   # background start; spec files are joined in order
cwgo NAME2 coder -r <sid> <<< "Fix: ..."                           # resume in the background
cwwait        # (run_in_background) fires when ANY fleet worker finishes; prints meta + report; marks it reviewed
cwls          # table: running / done / QUESTION / PERMISSION / TIMEOUT / ACCEPT_FAIL, time, turns, sid
cwopen        # unanswered QUESTION / PERMISSION requests (answered = resumed after the ask)
cwopen -x NAME  # close a request you settled without a resume (did it yourself, or a false alarm); the pane lowers the hand
```

- Every `cwwait` notification ends with the open requests. Answer them before anything else.

- The fleet dir is `$CW_FLEET`, default `~/.claude/cw-runs/fleet/<repo>`. It holds NAME.task/.out/.err/.pid/.seen.
- Shared spec parts (project facts, phase brief) live in reusable files. Pass them before the task file.

## Cost model (measured)

- Cold start: ~3k (scout) / ~3.4k (coder) tokens. A plain `claude -p` costs ~75k; a subagent costs 25–42k.
- Every tool turn resends the whole context, so cost grows with turns × context. Cut turns:
  - Inline known files with `-f`. A scout that needs no tools answers in 1 turn for ~3k tokens.
  - Name exact paths and line ranges. Ask for `rg -n` hits, not whole files.
  - Use `-w` only when the task needs the web: pages fill the context fast.
- Batch related questions into one scout run, not five.

## Delegate or do it yourself

- Do it yourself: one grep, one known small file, a one-line fix, git, anything shorter than writing the spec.
- Delegate: reading more than ~3 files or ~500 lines, web research, any feature or multi-file change, test-fix loops.
- Workers start without CLAUDE.md, skills or MCP. Put every project fact they need in the spec.
- A project rule that tells the lead to do a task itself (e.g. a quality gate) wins.

## Task spec

1. Goal: one sentence.
2. Context: stack in one line + verified facts (names, paths, API quirks) so it does not rediscover them.
3. Scope: exact files (`-f`) or paths/URLs.
4. Task: behavior, interfaces it must keep or expose, what must not change. Give tasks, not code.
5. Acceptance: exact commands that must pass.
6. Report: what to return. Ask for measured numbers, not guesses.

## Effort

- Default `-e auto`: with `CW_JEV=1` (opt-in: the task text goes to OpenRouter), Jev (`typesafe/jev-1.13` on OpenRouter decisions API, key: `OPENROUTER_API_KEY`, or on macOS the keychain service named in `CW_JEV_KEYCHAIN`; no key → role default) picks low/medium/high from the spec. ~1 s, ~$0.00002.
- Jev off or fails → role default: scout `low`, coder `medium`. A resume (`-r`) keeps the effort of the run it continues.
- Override with `-e low|medium|high` only for a known reason: a fix-up after a failed attempt → `-e high`.
- Never xhigh/max for workers: work that needs it, Opus does itself.
- Meta line shows `effort=<level>(jev|default|resume|flag)`; `.meta` keeps Jev's probabilities.

## Worker questions (rc=3)

- A worker that hits a real ambiguity ends its report with `QUESTION: …`. `cw` exits 3 and prints `[cw ASK sid=… q=…]`.
- Never start a fresh worker for it. Answer and resume the same one: `cw <role> -r <sid> <<< "ANSWER: …"`.
- Answer it yourself when code, context or the spec settles it. Ask the user (AskUserQuestion) only when the decision is theirs, then resume.
- The cw-crew pane shows the worker with a raised hand until the resume starts.

## Permission hierarchy (rc=4): worker → lead → user

Only the lead may run in bypass mode. Workers run in auto mode and never decide risky actions alone.

- Three tiers in `cw` (coder):
  - Hard deny, never grantable: git commit/push/reset/clean, `rm -rf`, pkill/killall/`kill -1`/`kill 0`, shutdown/reboot, diskutil, dd, mkfs.
  - Ask (becomes a request): sudo, `rm -r`, chmod/chown, `kill <pid>`, git checkout/restore/stash/rebase/branch -D/worktree, brew, global npm/pip/uv installs, piping into `sh`/`bash`, launchctl, osascript, `defaults write`, `open`, crontab, edits to `~/.*`, `~/.claude/**`, `~/Library/**`.
  - Own processes: `cwkill PID` (allowed). It stops only descendants of the worker's own `cw` process, or a process whose command starts with a prefix in `CW_KILL_ALLOW` (colon-separated, e.g. an app the worker launched with `open`). It refuses anything else, so the worker asks.
  - Everything else: the auto-mode classifier.
- A denied call makes the worker stop and end with `PERMISSION: Tool(exact call) -- why`. `cw` exits 4, prints `[cw PERM sid=… req=…]` plus `[cw DENIED …]` lines, and writes `.ask` (the crew pane raises a hand). `cwwait` reports it like any finish.
- The lead decides right away:
  - Safe → grant that exact call and resume: `cw coder -r <sid> -a 'Bash(exact command)' <<< "APPROVED: run it exactly"`. The grant drops the ask rules it falls under for that run only.
  - Unsafe → `cw coder -r <sid> <<< "DENIED: <reason>. Instead: <safe alternative>"`.
  - Not sure → AskUserQuestion (show the exact call, the worker's reason, your risk read), then grant or deny.
- Safe means all of: it only touches the worker's worktree, the scratchpad or files it created; it can be undone; it affects no other process except one the worker started (by PID); no network writes, installs, credentials or system settings.
- Ask the user for: deleting or overwriting anything outside the project, installs, system or app settings, anything that reaches the network or another person, git history changes.
- Never grant a broader rule than the exact call (no wildcards).

## Parallel fleet: review each worker the moment it finishes

Default for 2+ background workers. Never wait for the whole fleet.

1. Start each worker with `cwgo NAME coder -W NAME -T '<acceptance>' -- <spec files>` (writers in their own worktrees).
2. Start one background waiter: `cwwait` (Bash `run_in_background: true`). The notification carries the finished worker's meta and report.
3. When it fires: read the report, `cwwt diff NAME --stat`, risky hunks, screenshots if visual. `accept=pass` already ran its tests in its tree.
4. PERMISSION (rc=4) or QUESTION (rc=3) → answer it first (see above), resume with `cwgo NAME.fix coder -r <sid> <<< "..."`, back to the waiter.
5. Not good enough → resume the same worker right away with the exact issues. Good → `cwwt apply NAME`, rerun the affected tests in the main tree, commit if the user allows, `cwwt rm NAME`.
6. Restart `cwwait` (no args: it waits for whatever is still unreviewed). It exits 1 with "fleet idle" when nothing is left.
7. After each review, tell the user in 3-5 lines: what landed, what went back for fixes and why, what is still running.

The lead's own work (shared helpers, specs, merges) goes on between notifications.

## Verify (never trust "done")

- `git diff --stat`, then skim the risky hunks. Rerun the acceptance commands yourself.
- `denied>0` → it was blocked. Check why in the log, then widen the spec or do that step yourself.
- Fails → `-r <sid>` with the exact failure. Second failure → do it yourself or rewrite the spec.
- Scout reports can be wrong. Spot-check facts a decision depends on.

## Rules

- Never two writers on the same files. In one tree: parallel writers only on disjoint files, max 2. Scouts can run in parallel.
- More writers → one worktree per writer: `cw coder -W <name> ...` (any git repo). `cwwt` does the chores, so the lead does not:
  - Creates `../<repo>-wt/<name>` on branch `wt/<name>` from HEAD, plus the main tree's uncommitted and untracked files, so the worker sees what the lead sees. Reuses the worktree if it exists.
  - Clones the git-ignored paths the project needs to build and test: those listed in `<repo>/.cw-copy` (one per line; e.g. `.godot`, `node_modules`, ignored assets), plus `-K <path>` per run. On APFS the clone is instant (copy-on-write). Add a `.cw-copy` to a repo the first time a worker's tests there fail for lack of ignored files.
  - `-r <sid>` returns to the dir the session ran in, so there is no need to repeat `-W` or `-C`.
  - Merge: `cwwt diff <name> [--stat]` shows the worker's changes only. `cwwt apply <name>` applies them to the main tree. On a conflict it changes nothing and keeps the patch. `cwwt rm <name>` cleans up. Run from the repo.
  - Shared helpers the writers need: the lead writes them in the main tree before `-W` (they are carried). The lead owns shared files and applies worktrees one by one, rerunning tests after each.
- Workers never commit. Commits follow the user's git rules.
- Large output → a coder writes a scratchpad file and returns its path + a 5-line summary. Scouts cannot write files: ask them for an inline report and do not set a line cap.
- Report to the user per step: what landed, tests you reran, what you did not check.
