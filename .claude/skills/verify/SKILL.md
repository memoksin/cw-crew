---
name: verify
description: Prove a cw-crew change works end to end (bin/cw, bin/cw* helpers, hooks/*.ts, plugin manifest). Use when asked to "verify", "does it work", "check the change", "prove it", "doğrula", "çalışıyor mu", or before reporting a cw-crew change done. Not for reviewing code style or writing new features.
---

# verify (cw-crew)

Run from the repo root. Read `AGENTS.md` first. Evidence dir: `E=$TMPDIR/cw-verify; mkdir -p $E`. Never launch `claude --plugin-dir .` or any window on the user's displays.

## Static + test gates (all run here, 2026-11-17)
- `for f in bin/*; do bash -n "$f" || echo FAIL $f; done` -> silent = pass. (VERIFIED)
- `bash tests/cw.sh 2>&1 | tee $E/cw.log | tail -3` -> last line `all passed (0 failures)`. Fake claude/codex, no network. (VERIFIED)
- `bash tests/cwgo.sh`, `bash tests/cwstats.sh`, `bash tests/cwwt.sh` -> `all ok` / `all passed` / `all ok: ...`. Run the ones matching the touched script. (VERIFIED)
- `tsc -p . --noEmit; echo rc=$?` -> rc=0. Never plain `tsc -p .` (emits .js into the tree). (VERIFIED)
- `claude plugin validate .` -> `✔ Validation passed`. (VERIFIED)
- `claude plugin test .` -> runs the bun pane tests (`tests/scene.test.ts`, `tests/pane.test.tsx`; 37 pass on 2026-11-17) and ends `0 fail`. Inside a cw worker (`--safe-mode`) it prints "hooks modules are turned off here" with rc=1: NOT CHECKED there, not a code failure; the lead reruns it.

## End-to-end smoke (real model, cheap)
- Run the SOURCE, not the installed copy (the plugin install comes from GitHub and can lag): use `bin/cw`, or `PATH="$PWD/bin:$PATH"` for helpers.
- `CW_LOG_DIR=$E/runs bin/cw scout -M haiku <<< "Which file defines the Role type in hooks/? One line." >$E/out.txt 2>$E/err.txt; echo rc=$?` (VERIFIED: rc=0, ~5s)
- Read the last line of `$E/err.txt`: `[cw scout <model> ... rc=0 success ... turns=N ... denied=0 Ns log=...]`. Pass = `rc=0`, `success`, `denied=0`, answer in `out.txt` is right (it said `hooks/scene.ts:6`). With a coder run also check the `accept` field; a failed acceptance is a fail.
- Also read the line above it: `cw: provider=...` shows which provider answered (codex skipped at limit -> api). Say which one in the report.
- Logs land in `$CW_LOG_DIR` (default `~/.claude/cw-runs`): `.meta .events .json .jsonl .err .done` per run. Setting it to `$E/runs` keeps evidence and leaves user logs alone; `live/` empties when the worker ends.

## Known false passes
- `cw` exit 0 is not enough: read the meta line (`rc=`, `denied=`, `accept`). A worker can print DONE while denied>0.
- `bash tests/cw.sh | tail` hides the exit code: use `${PIPESTATUS[0]}` or read the `all passed` line.
- Fake-claude tests prove bin/cw logic only, not the real CLI: the smoke run is the real proof.
- `claude plugin test .` rc=1 inside a worker (hooks off) is NOT CHECKED, not a pass.
- Changed the `[cw ...]` meta format or `.events/.done` files without updating cwls/cwwait/cwopen/cwkill, `scene.ts` and tests: gates may still pass.

## On failure
- Keep `$E/*.log`, `err.txt` and the run's `.err`/`.events` from `$CW_LOG_DIR`; quote the failing `not ok`/meta line.
- Fix the cause in source, rerun the failing gate, then the full list. Never weaken a test or loosen a deny tier.
- If the smoke fails but tests/cw.sh passes, suspect provider/auth/limits (`cw: provider=` line) before the code; report PARTIAL with the evidence path.
