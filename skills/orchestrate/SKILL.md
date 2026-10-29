---
name: orchestrate
description: Opus orchestrates lean headless workers to save Claude limits. Scouts read, gather context, research and report; coders write code; a fresh reviewer checks risky diffs. With CW_AGY=1, tiers spend Google AI quota first (Gemini Flash, Claude 4.6 on the Antigravity CLI) and Claude Sonnet/Opus 5.5 last. Use for any multi-file reading, research or implementation work. Trigger on /orchestrate, "delegate", "use workers", "let Haiku/Sonnet do it".
---

# Orchestrate headless workers

Opus = lead. Plans, writes task specs, runs workers, verifies, asks for fixes, integrates. Workers are `claude -p` processes started by `cw`. Never use the Agent tool (subagents): each one starts with a ~25–42k token context.

## Roles

| Role | Tools | Use for |
|---|---|---|
| `scout` | read-only (Claude: Read + read-only Bash; agy: view_file, grep_search, find_by_name, list_dir); `-w` adds WebFetch/WebSearch (Claude only) | find files and call sites, summarize code/docs, web research, logs, reports |
| `coder` | read, edit, write, shell; commit/push/reset/clean blocked | implement a spec, run its tests |
| `reviewer` | Read, read-only Bash; no web, no edits. cw inlines the diff | second pair of eyes on a finished diff, fresh context |

Override Claude models: `CW_SCOUT_MODEL`, `CW_CODER_MODEL`, `CW_REVIEWER_MODEL`. Defaults are pinned full IDs (`claude-haiku-5-5`, `claude-sonnet-5-5`). The reviewer stays on Claude (`-M haiku|sonnet|opus` only).

## Tiers (`-M`): spend Google quota first, Claude last

Pick the lowest tier likely to get it right on the first try. agy tiers run on the Antigravity CLI (Google AI plan); they do not touch Claude limits.

Tiers 1-3 are opt-in: they need `CW_AGY=1` in the user's env. Check once per session: `echo ${CW_AGY:-0}`. Off: use only `haiku`, `sonnet`, `opus` and skip the agy rules below; scouts default to `haiku`.

| Tier | `-M` | Quota | Scout | Coder |
|---|---|---|---|---|
| 1 | `flash` (Gemini 3.8 Flash) | agy Gemini | default: lookups, call sites, file:line answers | trivial: 1 file, a few lines, exact spec, a given check |
| 2 | `sonnet46` (Claude Sonnet 4.6) | agy Claude/GPT | needs judgement: summarize a design, compare options | small: 1-3 files, clear approach |
| 3 | `opus46` (Claude Opus 4.6) | agy Claude/GPT | hard reading: subtle flow across many files | normal feature with a clear spec, scoped bug |
| 4 | `sonnet` (Sonnet 5.5) | Claude | `-w` web research uses `haiku` | hard: cross-file refactor, unknown-cause bug, retry after a tier 1-3 failure; tasks needing `-a` |
| 5 | `opus` (Opus 5.5) | Claude | — | rare: see Opus coder below |

- The agy Claude/GPT bucket is small: two Opus 4.6 coder runs (~2.4M tokens, mostly cache reads) used a whole 5-hour window and half the week on a Pro plan. Use `sonnet46`/`opus46` for short runs (scouts, a few-file fix); give long coder tasks to `sonnet`. Gemini quota is far larger.

- Defaults: scout `flash` with `CW_AGY=1` (`haiku` with `-w` or when off), coder `sonnet`. Always pass `-M` for coders.
- Do not hold back tiers 4-5 when the task needs them: a failed cheap run plus a retry costs more than one right run.
- Failed or weak result on an agy tier: rerun one tier up with what went wrong. An agy session resumes (`-r`) only on agy.
- cw falls back to the role's Claude model (scout `haiku`, coder `sonnet`) on its own when agy is missing, the run uses `-w` or `-a`, or no agy home (one per Google account, `CW_AGY_HOME`) has quota at or above `CW_AGY_MIN` % (default 5). Homes are tried in order. The note `cw: ..., using <model>` goes to stderr. Quota of every home: `cwagy`.
- agy coder safety is weaker than Claude's auto mode: deny rules match the command text (cw's ask rules are denied there too), and git push/commit are blocked by env. A `git reset --hard` or `rm` in another syntax can still run. Give agy coders small, git-free tasks; on an important repo use `-W`. They cannot get `-a` grants: a PERMISSION from an agy coder means rerun on `sonnet` with `-a`.
- agy scouts can read files outside the repo (the prompt pins them to it). Tasks and the files they read go to Google.

### Opus coder (rare, expensive)

Default coder is Sonnet. Use an Opus coder (`-M opus`) only when the task is clearly beyond Sonnet:
- 3D spatial reasoning that tests cannot fully check: camera, IK/rig poses, collision geometry, procedural 3D layout judged by screenshots.
- Large cross-cutting rework (many files, subtle interacting state) where a wrong design is costly to redo.
- A Sonnet coder already failed the same task twice with a good spec.

Everything else stays Sonnet: verifiable features, test-backed fixes, UI/2D work, tooling, audio. When unsure, start Sonnet; escalate to Opus only after a real failure. Tell the user which workers run on Opus and why.

## The loop

1. Scout (default `flash`) investigates **before** the work: finds files and call sites, reads code and docs, researches, reports facts.
2. Lead writes the spec from that report.
3. Coder (tier by task size, see Tiers) does the work.
4. Reviewer (Sonnet, read-only) reads the diff with a clean context, only when "Reviewer" below says so.
5. Lead verifies the result **itself**: diff, reruns tests, looks at screenshots. Never hand verification or screenshot review to a scout; a review is input to it, not a substitute.
6. Issues with this task → resume the coder with the exact fixes, back to 5. A new task → a fresh worker, back to 1 (never resume for new work, see "Resume cost").

## Run

The plugin puts `cw`, `cwgo`, `cwwait`, `cwls`, `cwopen`, `cwwt` and `cwkill` on the Bash PATH. If `command -v cw` finds nothing, call them as `${CLAUDE_SKILL_DIR}/../../bin/<name>`. Needs `claude`, `jq`, `perl`, `git` (install notes: README).

```sh
cw scout|coder|reviewer [-M tier] [-C dir] [-W name] [-B ref] [-r sid] [-t sec] [-e ...] [-w] [-f file]... [-T 'test cmd'] < task.md
```

- Report → stdout. Meta → stderr: `[cw role model rc subtype sid turns new_in cache_r out denied secs accept=… log=…]`.
- `-f file` (repeatable) inlines the file into the prompt. Use it whenever you already know which files matter.
- `-T 'cmd'`: cw runs the acceptance command itself in the worker's dir after a clean finish. The meta line shows `accept=pass`, `accept=FAIL(rc=N)` or `accept=FAIL(output)` (exit 0 but a `FAIL`/`SCRIPT ERROR` line; Godot exits 0 on a failed test; `CW_ACCEPT_FAIL_RE` overrides the pattern, empty turns it off), and on failure the report ends with the last 20 lines. Always pass it when the spec has acceptance commands, so you do not rerun them by hand just to learn pass/fail.
- Turn limit (`CW_MAX_TURNS`, coder default 80; use 150 for big tasks): cw resumes the same session once with a "continue" message (`CW_AUTO_CONTINUE`, default 1), but only if that run changed files and under half of its tool calls failed. A worker that loops stops with `error_max_turns`: read why before resuming it, never resume blindly.
- `-D dir` (repeatable): extra dir the worker may read, e.g. screenshots under `/tmp` for a scout review. Without it, reads outside the work dir are denied.
- Fix-up → `-r <sid>` (scout or coder). The worker keeps its context and runs in the session's own dir. It is not cheap: see "Resume cost".
- Resume cost: every turn of a resumed run re-reads the session's whole context. After a long run (100+ turns, 200k+ tokens) one resumed turn costs as much as 5-10 fresh turns, and a cold cache (more than a few minutes since the last turn) re-writes the whole context first. Measured: resumed runs of 25-43 turns cost $10-13 each; fresh Sonnet runs of 34-44 turns cost about $1.
  - Resume only to finish the same task: answer a QUESTION/PERMISSION, fix what verification found, continue after a timeout or the turn limit.
  - A new task, even in the same files → a fresh worker with a short spec (name the files, commits and decisions it needs; `-f` the key files). Never chain new tasks onto one session.
  - Resume soon after the run ends (warm cache). If the old run was long and the fix is small, a fresh worker with a 5-line spec is usually cheaper.
- Default timeout: coder 3600 s, scout 1200 s (`-t` or `CW_TIMEOUT` overrides). `rc=142` = timeout. Logs: `~/.claude/cw-runs/`. Read them only when the report is not enough.

### Fleet tools (use these, not hand-written nohup / tail / rg loops)

```sh
cwgo NAME coder [cw options...] -- specs/common.md specs/NAME.md   # (run_in_background) runs one worker; spec files are joined in order
cwgo NAME2 coder -r <sid> <<< "Fix: ..."                           # (run_in_background) resume
cwgo -d NAME ...  # start and return at once; then cwwait reports it
cwwait        # (run_in_background) fires when ANY unreported fleet worker finishes; recovery after a lost notification
cwls          # table: running / done / QUESTION / PERMISSION / TIMEOUT / ACCEPT_FAIL, time, turns, sid
cwopen        # unanswered QUESTION / PERMISSION requests (answered = resumed after the ask)
cwopen -x NAME  # close a request you settled without a resume (did it yourself, or a false alarm); the pane lowers the hand
```

- Run every `cwgo` as its own Bash call with `run_in_background: true`, one call per worker (a loop in one call runs them one after another). The harness then notifies you when that worker finishes or asks. There is no waiter to restart, so no question is missed.
- A notification with `OPEN REQUEST` (or a `cwwait` one listing open requests) comes first: answer and resume, or `cwopen -x NAME`. Never leave one open: the pane keeps the hand up.

- The fleet dir is `$CW_FLEET`, default `~/.claude/cw-runs/fleet/<repo>`. It holds NAME.task/.out/.err/.pid/.seen.
- Shared spec parts (project facts, phase brief) live in reusable files. Pass them before the task file.

## Reviewer

A writer's own context is the worst place to review its diff. The reviewer starts fresh, sees only the diff, the specs and your focus note, and reports:

```
DONE review: 1 blocker, 2 suggest
BLOCKER src/auth.ts:42 - token compared with ==; use timingSafeEqual
SUGGEST src/auth.test.ts:10 - no test for an expired token
```

```sh
cwgo api.rv reviewer -W api -- specs/common.md specs/api.md   # (run_in_background) a worktree's changes
cw reviewer -B main -f specs/api.md <<< "Focus: error paths."   # a branch since its merge base
cw reviewer <<< "Focus: the migration."                         # uncommitted changes in this tree
```

- cw puts the diff in the prompt (cut at `CW_REVIEW_MAX`, 60k chars). An empty diff exits 2 before any model call. `-W` never creates a worktree.
- Call it after a coder ends `DONE` with `accept=pass`, and only when the diff is risky: auth, permissions, secrets or input validation; money; deleting or migrating data; concurrency or caching; a public API or file format others parse; 3+ files or ~150+ changed lines; or a spec with a rules file (security list, project standards).
- Skip it: one-line fixes, docs, renames, tests-only changes, a diff you read fully in under a minute, and any run whose tests still fail (fix first; review last).
- Pass the same spec files the coder got, and the rule lists that matter (`specs/security.md`). Expertise goes in spec files, not new roles.
- `BLOCKER` → resume the coder with those lines (`-r <sid>`), then verify yourself. Do not re-review a small fix; a second review only when the fix rewrote the change.
- `SUGGEST` → take what is cheap and right, drop the rest. `UNSURE` → check it yourself before acting.
- Cost: one reviewer per diff, ~3k cold start plus the diff, usually under 5 turns (limit 20). Never resume a reviewer for a new diff: a fresh one is cheaper and keeps its context clean. Default effort `low`; `-e medium` for security or data-loss risk.
- Haiku (`CW_REVIEWER_MODEL=claude-haiku-5-5`) only for mechanical checks against an explicit list.

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

- One ask per coder run. Specs that bundled 2-5 fixes or a whole level mostly ended in `error_max_turns` or a timeout with no report. Split them and run them in a fleet.
- A look or feel goal ("too far", "should flinch", a camera angle) needs a measurable check (a number, a pixel or luminance test, a reference shot) or a QUESTION gate. Without one, workers loop to the turn limit or pick the wrong target.
- Never ask a worker to commit, merge or write where its role cannot (scouts and reviewers have no Write). Those calls are denied and the run ends blocked.
- Reports start with `DONE`, `PARTIAL` or `BLOCKED`. Treat anything but `DONE` as not done, whatever rc says.

## Effort

- Default `-e auto`: role default (scout and reviewer `low`, coder `medium`), or Jev picks it from the spec when `CW_JEV=1` (opt-in, sends the task to OpenRouter; setup: README; `high` only when Jev is sure, `CW_JEV_SURE`; agy tiers skip it). A resume keeps the effort of the run it continues.
- Override with `-e low|medium|high` only for a known reason: a fix-up after a failed attempt → `-e high`.
- Never xhigh/max for workers: work that needs it, Opus does itself.

## Worker questions (rc=3)

- A worker that hits a real ambiguity ends its report with `QUESTION: …`. `cw` exits 3 and prints `[cw ASK sid=… q=…]`.
- Never start a fresh worker for it. Answer and resume the same one: `cw <role> -r <sid> <<< "ANSWER: …"`.
- Answer it yourself when code, context or the spec settles it. Ask the user (AskUserQuestion) only when the decision is theirs, then resume.

## Permission hierarchy (rc=4): worker → lead → user

Only the lead may run in bypass mode. Workers run in auto mode and never decide risky actions alone.

- Three tiers in `cw` (coder):
  - Hard deny, never grantable: git commit/push/reset/clean/merge/cherry-pick/revert/am/pull, `rm -rf`, pkill/killall/`kill -1`/`kill 0`, shutdown/reboot, diskutil, dd, mkfs.
  - Ask (becomes a request): sudo, `rm -r`, chmod/chown, `kill <pid>`, git checkout/restore/stash/rebase/branch -D/worktree, brew, global npm/pip/uv installs, piping into `sh`/`bash`, launchctl, osascript, `defaults write`, `open`, crontab, edits to `~/.*`, `~/.claude/**`, `~/Library/**`.
  - Own processes: `cwkill PID` (allowed). It stops only descendants of the worker's own `cw` process, or a process whose command starts with a prefix in `CW_KILL_ALLOW` (colon-separated, e.g. an app the worker launched with `open`). It refuses anything else, so the worker asks.
  - Everything else: the auto-mode classifier.
- A denied call makes the worker stop and end with `PERMISSION: Tool(exact call) -- why`. `cw` exits 4, prints `[cw PERM sid=… req=…]` plus `[cw DENIED …]` lines, and writes `.ask` (the crew pane raises a hand). The worker's notification carries it.
- The lead decides right away:
  - Safe → grant that exact call and resume: `cw coder -r <sid> -a 'Bash(exact command)' <<< "APPROVED: run it exactly"`. The grant drops the ask rules it falls under for that run only.
  - Unsafe → `cw coder -r <sid> <<< "DENIED: <reason>. Instead: <safe alternative>"`.
  - Not sure → AskUserQuestion (show the exact call, the worker's reason, your risk read), then grant or deny.
- Safe means all of: it only touches the worker's worktree, the scratchpad or files it created; it can be undone; it affects no other process except one the worker started (by PID); no network writes, installs, credentials or system settings.
- Ask the user for: deleting or overwriting anything outside the project, installs, system or app settings, anything that reaches the network or another person, git history changes.
- Never grant a broader rule than the exact call (no wildcards).

## Parallel fleet: review each worker the moment it finishes

Default for 2+ background workers. Never wait for the whole fleet.

1. Start each worker with its own background Bash call: `cwgo NAME coder -W NAME -T '<acceptance>' -- <spec files>` (writers in their own worktrees).
2. Each worker's notification carries its meta and report, or its question.
3. When one fires: read the report, `cwwt diff NAME --stat`, risky hunks, screenshots if visual. `accept=pass` already ran its tests in its tree. Risky diff → `cwgo NAME.rv reviewer -W NAME -- <spec files>` (background) and review the rest while it runs.
4. PERMISSION (rc=4) or QUESTION (rc=3) → answer it first (see above), resume with `cwgo NAME.fix coder -r <sid> <<< "..."` (background), back to 3.
5. Not good enough → resume the same worker right away with the exact issues. Good → `cwwt apply NAME`, rerun the affected tests in the main tree, commit if the user allows, `cwwt rm NAME`.
6. Lost track (context compacted, a notification missed)? `cwls` and `cwopen`, or one background `cwwait`, report whatever is still unreviewed.
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
