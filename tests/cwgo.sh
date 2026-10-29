#!/usr/bin/env bash
# tests/cwgo.sh — bin/cwgo -A against a fake `claude` (coder edits a file in its cwd; reviewer verdict from $RV).
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin"
cat > "$t/bin/claude" <<'EOF2'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "$FAKE/args"; p=$(cat)
if printf '%s' "$p" | grep -q 'Review against this task spec'; then
  echo "$*" >> "$FAKE/rv.called"; txt=${RV:-DONE review: clean}
else
  printf 'one\ntwo\nthree\n' > a.txt; printf 'x\n' > new.txt; txt=DONE
fi
echo '{"type":"system","subtype":"init","session_id":"sid-1"}'
printf '{"type":"result","subtype":"success","is_error":false,"result":"%s","session_id":"sid-1","num_turns":1,"usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1},"modelUsage":{"m":{}},"permission_denials":[],"total_cost_usd":0.01}\n' "$txt"
EOF2
chmod +x "$t/bin/claude"
export PATH="$t/bin:$PATH" FAKE=$t CW_LOG_DIR=$t/logs CW_WT_ROOT=$t/wt CW_JEV=0 CW_AGY=0 CW_FLEET=$t/fleet
unset CW_REVIEWER_MODEL CW_SCOUT_MODEL CW_CODER_MODEL CW_TIMEOUT CW_APPLY_LINES
fails=0
ok() { echo "ok   $1"; }
no() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }

r=$t/repo; mkdir -p "$r"; cd "$r" || exit 1
git init -q -b main && git config user.email t@t && git config user.name t
printf 'one\ntwo\n' > a.txt && git add a.txt && git commit -qm init
reset() { git checkout -q -- . 2>/dev/null; rm -f new.txt; rm -rf "$t/wt" "$t/fleet" "$t/rv.called"; git worktree prune; git branch -D wt/w >/dev/null 2>&1; }
echo "Add a line." > "$t/task.md"

# -A without -T / with wrong role
"$here/bin/cwgo" -A w coder -W w -- "$t/task.md" >/dev/null 2>"$t/err"
check "-A without -T exits 2" '[ $? = 2 ] && grep -q "needs role coder" "$t/err" && [ ! -d "$t/fleet" ]'
"$here/bin/cwgo" -A w scout -W w -T true -- "$t/task.md" >/dev/null 2>&1
check "-A with scout exits 2" '[ $? = 2 ]'

# light diff applies
out=$("$here/bin/cwgo" -A w coder -W w -T 'grep -q three a.txt' -- "$t/task.md" 2>&1); echo "$out" | grep '^==='
check "light: APPLIED, review skipped" 'echo "$out" | grep -q "^=== APPLIED w:.*review=skipped (light)"'
check "light: main tree has the change, worktree gone" 'grep -q three a.txt && [ -f new.txt ] && [ ! -d "$t/wt/w" ] && [ ! -e "$t/rv.called" ]'
check "light: nothing committed" '[ "$(git rev-list --count HEAD)" = 1 ]'
reset

# acceptance fails in the main tree only (there .git is a directory, in the worktree a file)
out=$("$here/bin/cwgo" -A w coder -W w -T 'if [ -d .git ]; then echo boom; exit 1; fi' -- "$t/task.md" 2>&1); echo "$out" | grep '^==='
check "main accept fail: REVERTED" 'echo "$out" | grep -q "^=== APPLY REVERTED w:" && echo "$out" | grep -q boom'
check "main accept fail: tree unchanged, worktree kept" '[ "$(cat a.txt)" = "$(printf "one\ntwo")" ] && [ ! -e new.txt ] && [ -d "$t/wt/w" ]'
reset

reset
# heavy diff: reviewer clean -> applied
export CW_APPLY_LINES=1
out=$(RV="DONE review: clean" "$here/bin/cwgo" -A w coder -W w -T true -- "$t/task.md" 2>&1); echo "$out" | grep '^==='
check "heavy clean: reviewer ran, APPLIED review=clean" '[ -e "$t/rv.called" ] && echo "$out" | grep -q "^=== APPLIED w:.*review=clean" && grep -q three a.txt'
reset
out=$(RV="DONE review: 1 blocker" "$here/bin/cwgo" -A w coder -W w -T true -- "$t/task.md" 2>&1); echo "$out" | grep '^==='
check "heavy blocker: NOT APPLIED, worktree kept" 'echo "$out" | grep -q "^=== NOT APPLIED w: review found blockers" && [ "$(cat a.txt)" = "$(printf "one\ntwo")" ] && [ -d "$t/wt/w" ]'
reset
out=$(RV="DONE review: 10 blocker, 0 suggest" "$here/bin/cwgo" -A w coder -W w -T true -- "$t/task.md" 2>&1)
check "10 blockers is not clean" 'echo "$out" | grep -q "^=== NOT APPLIED w: review found blockers"'

echo; [ $fails = 0 ] && echo "all ok" || echo "$fails failed"; exit $((fails > 0))
