#!/usr/bin/env bash
# tests/cw.sh — bin/cw against a fake `claude` that records its args and prompt (no model call, no network).
# Run: tests/cw.sh   (`claude plugin test` cannot start processes, so this one is plain bash.)
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin"
cat > "$t/bin/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$FAKE/args"; cat > "$FAKE/prompt"
echo '{"type":"system","subtype":"init","session_id":"sid-1"}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"DONE review: clean","session_id":"sid-1","num_turns":1,"usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1},"modelUsage":{"m":{}},"permission_denials":[],"total_cost_usd":0.01}'
EOF
chmod +x "$t/bin/claude"
export PATH="$t/bin:$PATH" FAKE=$t CW_LOG_DIR=$t/logs CW_WT_ROOT=$t/wt CW_JEV=0 CW_AGY=0
unset CW_REVIEWER_MODEL CW_SCOUT_MODEL CW_CODER_MODEL CW_TIMEOUT
fails=0
ok() { echo "ok   $1"; }
no() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }
arg() { grep -qxF -- "$1" "$t/args"; }

r=$t/repo; mkdir -p "$r"; cd "$r" || exit 1
git init -q -b main && git config user.email t@t && git config user.name t
printf 'one\ntwo\n' > a.txt && git add a.txt && git commit -qm init
printf 'Spec: keep two lines.\n' > "$t/spec.md"

# Clean tree: nothing to review, claude never starts.
"$here/bin/cw" reviewer <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "clean tree exits 2" '[ $rc = 2 ] && grep -q "nothing to review" "$t/err" && [ ! -e "$t/args" ]'
"$here/bin/cw" reviewer -w <<< "x" >/dev/null 2>&1
check "reviewer refuses -w" '[ $? = 2 ]'

# Uncommitted + untracked changes, a spec inlined.
printf 'one\nTWO\n' > a.txt; printf 'new\n' > b.txt
out=$("$here/bin/cw" reviewer -f "$t/spec.md" <<< "Check the rename." 2>"$t/err"); rc=$?
check "reviewer runs, rc 0, report on stdout" '[ $rc = 0 ] && [ "$out" = "DONE review: clean" ]'
check "meta line names the role" 'grep -q "^\[cw reviewer .* rc=0 " "$t/err"'
check "diff inlined: tracked change" 'grep -q "^+TWO" "$t/prompt" && grep -qF "<diff of=\"uncommitted changes\">" "$t/prompt"'
check "diff inlined: untracked file" 'grep -q "^+++ b/b.txt" "$t/prompt"'
check "spec and task inlined" 'grep -q "Spec: keep two lines." "$t/prompt" && grep -q "Check the rename." "$t/prompt"'
check "default model Sonnet, effort low" 'arg claude-sonnet-5-5 && arg low'
check "read-only tools, dontAsk, no web" 'arg Read,Bash && arg dontAsk && ! grep -qE "Edit|Write|WebFetch|WebSearch" "$t/args"'
check "short turn limit" 'arg 20'
check "meta file records role reviewer" 'jq -e "select(.role==\"reviewer\")" "$CW_LOG_DIR"/*-reviewer-*.meta >/dev/null'
check "work tree untouched" '[ "$(cat a.txt)" = "$(printf "one\nTWO")" ] && [ -f b.txt ]'

CW_REVIEWER_MODEL=claude-haiku-5-5 "$here/bin/cw" reviewer </dev/null >/dev/null 2>&1
check "CW_REVIEWER_MODEL overrides; empty task gets a default" 'arg claude-haiku-5-5 && grep -q "Review the diff below." "$t/prompt"'

# Branch review: -B main shows only the branch's changes since the merge base.
git stash -qu && git checkout -qb feat && printf 'three\n' >> a.txt && git commit -qam feat
git checkout -q main && printf 'main only\n' > c.txt && git add c.txt && git commit -qm main && git checkout -q feat
"$here/bin/cw" reviewer -B main <<< "x" >/dev/null 2>&1
check "-B main: branch commits only" 'grep -q "^+three" "$t/prompt" && ! grep -q "main only" "$t/prompt" && grep -qF "changes since main" "$t/prompt"'

# Worktree review: -W reviews the worker's changes, never creates a worktree.
git checkout -q main
"$here/bin/cw" reviewer -W nope <<< "x" >/dev/null 2>&1
check "-W on a missing worktree exits 2, creates nothing" '[ $? = 2 ] && [ ! -d "$t/wt/nope" ]'
wt=$("$here/bin/cwwt" create w1 2>/dev/null) && printf 'from worker\n' > "$wt/d.txt"
"$here/bin/cw" reviewer -W w1 <<< "x" >/dev/null 2>&1
check "-W w1: the worktree's changes" 'grep -q "^+from worker" "$t/prompt" && grep -qF "worktree w1" "$t/prompt"'

# Fleet: cwgo runs a reviewer, cwls reads its meta line.
CW_FLEET=$t/fleet "$here/bin/cwgo" rv reviewer -W w1 <<< "x" >/dev/null 2>&1
check "cwls shows a finished reviewer as done" 'CW_FLEET=$t/fleet "$here/bin/cwls" | grep -qE "^rv +done "'

# Other roles keep their setup.
"$here/bin/cw" scout <<< "x" >/dev/null 2>&1
check "scout unchanged: Haiku, low, read-only, 40 turns" 'arg claude-haiku-5-5 && arg low && arg Read,Bash && arg 40 && ! grep -q "<diff" "$t/prompt"'
"$here/bin/cw" coder <<< "x" >/dev/null 2>&1
check "coder unchanged: Sonnet, medium, edits" 'arg claude-sonnet-5-5 && arg medium && arg Read,Edit,Write,Bash'

# Tiers: agy tiers are off unless CW_AGY=1 and then fall back to Claude; Claude tiers pick the model.
"$here/bin/cw" coder -M flash <<< "x" >/dev/null 2>"$t/err"
check "agy tier off: flash coder falls back to Sonnet" 'arg claude-sonnet-5-5 && grep -q "agy tiers are off" "$t/err"'
"$here/bin/cw" scout -M opus <<< "x" >/dev/null 2>&1
check "-M opus picks Opus 5.5" 'arg claude-opus-5-5'
"$here/bin/cw" reviewer -M flash -W w1 </dev/null >/dev/null 2>"$t/err"
check "reviewer refuses agy tiers" 'grep -q "reviewer stays on Claude" "$t/err"'

"$here/bin/cwwt" rm w1 >/dev/null 2>&1
echo; [ $fails = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
