# cw-crew

Claude Code plugin: `orchestrate` skill + `cw` worker CLI + crew pane (hooks module).

## Layout

- `skills/orchestrate/SKILL.md`: lead's playbook. Commands named bare (`cw`), plugin `bin/` is on PATH.
- `bin/`: bash, macOS + Linux + Windows (Git Bash). Needs `claude`, `jq`, `perl`, `git`. No `rg`/`fd` in scripts (scouts may use them).
- `bin/cwstats`: local report over the run logs (`tests/cwstats.sh`); one `jq -n` pass, `--export` stays numbers-only.
- `hooks/register.tsx`: pane, `/crew`, polling of `$CW_LOG_DIR` (default `~/.claude/cw-runs`).
- `hooks/scene.ts`: card layout + text. `hooks/creatures.ts`: sprites.
- `frames/`: generated PNGs. Rebuild: `tools/gen_frames.sh` (bun + Pillow). Never edit by hand.
- `types/index.d.ts`: `$.state` contract. Every state key the module uses goes here.

## Contract between cw and the pane

- Per run in `$CW_LOG_DIR`: `.meta` (start), `.events` (one JSON line per step), `.ask` (QUESTION/PERMISSION), `.done` (rc).
- Change a file format → update `scene.ts` `parseEvents`/`buildWorkers` and `tests/scene.test.ts` together.
- Fleet (`cwgo`/`cwwait`/`cwls`/`cwopen`): `$CW_FLEET/NAME.{task,out,err,pid,seen}`. They parse `[cw ...]` meta lines from `.err`: keep that format stable.

## Rules

- No user-specific paths or names. Personal setup goes through env (`CW_*`), documented in README's table.
- Nothing leaves the machine by default. Jev (OpenRouter) stays opt-in via `CW_JEV=1`, agy tiers (Google) via `CW_AGY=1`.
- `cw` and `cwwait` bodies stay inside one `{ }` block: editing them must not break running workers.
- Roles: scout, coder, reviewer. A new role touches `bin/cw`, the `[cw (scout|coder|reviewer) ` regexes in cwls/cwopen/cwkill, `Role` in `scene.ts`, `creatures.ts` + `tools/dump.ts` (then `tools/gen_frames.sh`).
- Worker safety tiers live in `bin/cw` (deny / ask / allow). Never widen deny; `cwkill` only stops the worker's own tree or `CW_KILL_ALLOW` prefixes.
- UI text in English.
- Bump `version` in `.claude-plugin/plugin.json` on each release.

## Checks

- `claude plugin validate .`
- `claude plugin test .`
- `tsc -p .` (types appear in `.claude-plugin/types/` after the engine loads the plugin)
- `for f in bin/*; do bash -n "$f"; done`
- `tests/cw.sh` (bin/cw with a fake claude; `claude plugin test` cannot start processes)
- Smoke: `bin/cw scout <<< "Reply ok. No tools."` → meta line `rc=0`.
- Local run: `claude --plugin-dir .`, or `/reload-plugins` when installed from this folder.
