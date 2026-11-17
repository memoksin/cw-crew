#!/usr/bin/env bash
# tests/cw.sh — bin/cw against a fake `claude` that records its args and prompt (no model call, no network).
# Run: tests/cw.sh   (`claude plugin test` cannot start processes, so this one is plain bash.)
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin"
cat > "$t/bin/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$FAKE/args"; cat > "$FAKE/prompt"; printf '%s' "${CLAUDE_CODE_ENTRYPOINT:-}" > "$FAKE/ep"
printf '%s' "${ANTHROPIC_API_KEY+set}" > "$FAKE/key"; printf '%s' "${ANTHROPIC_AUTH_TOKEN+set}" > "$FAKE/auth"
printf '%s %s\n' "${ANTHROPIC_API_KEY+api}" "$(grep -A1 -x -- --resume "$FAKE/args" | tail -1)" >> "$FAKE/calls"
echo '{"type":"system","subtype":"init","session_id":"sid-1"}'
[ -z "${FAKE_STDERR:-}" ] || echo "$FAKE_STDERR" >&2
[ -n "${FAKE_STOP:-}" ] && { echo '{"type":"system","subtype":"init","session_id":"sid-stop"}'; exit "$FAKE_STOP"; }
[ "${FAKE_DRY:-}" = api-stderr ] && [ "${ANTHROPIC_API_KEY+x}" = x ] && { echo 'billing: Credit balance is too low' >&2; exit 1; }
if { [ "${FAKE_DRY:-}" = api ] && [ "${ANTHROPIC_API_KEY+x}" = x ]; } || { [ "${FAKE_DRY:-}" = claude ] && [ "${ANTHROPIC_API_KEY+x}" != x ]; }; then
  [ "${FAKE_DRY_EDIT:-0}" != 1 ] || echo progress >> a.txt
  echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Credit balance is too low: usage limit reached","session_id":"sid-1"}'; exit 1
fi
[ -n "${FAKE_RAW:-}" ] && { echo "$FAKE_RAW"; exit 1; }
sub=${FAKE_SUBTYPE:-success}
if [ "${FAKE_TURNS:-0}" = 1 ] && ! grep -qx -- --resume "$FAKE/args"; then
  echo progress >> a.txt; sub=error_max_turns
  echo '{"type":"user","message":{"content":[{"type":"tool_result","is_error":false}]}}'
fi
so=; [ -n "${FAKE_SO:-}" ] && so='"structured_output":{"ok":true,"n":1},'
echo '{"type":"result","subtype":"'"$sub"'","is_error":'"${FAKE_ERROR:-false}"','"$so"'"result":"'"${FAKE_RESULT:-DONE review: clean}"'","session_id":"sid-1","num_turns":1,"usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1},"modelUsage":{"m":{}},"permission_denials":[],"total_cost_usd":0.01}'
EOF
chmod +x "$t/bin/claude"
export PATH="$t/bin:$PATH" FAKE=$t CW_LOG_DIR=$t/logs CW_WT_ROOT=$t/wt CW_JEV=0 CW_CODEX=0
unset CW_REVIEWER_MODEL CW_SCOUT_MODEL CW_CODER_MODEL CW_TIMEOUT CW_ENTRYPOINT CW_CODEX CW_CODEX_MAX CW_PRIORITY CW_SKIP CW_API_KEY CW_API_KEYCHAIN CW_API_RETRY GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_KEY_1 GIT_CONFIG_KEY_2 GIT_CONFIG_VALUE_0 GIT_CONFIG_VALUE_1 GIT_CONFIG_VALUE_2
fails=0
ok() { echo "ok   $1"; }
no() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }
arg() { grep -qxF -- "$1" "$t/args"; }

r=$t/repo; mkdir -p "$r"; cd "$r" || exit 1
git init -q -b main && git config user.email t@t && git config user.name t
printf 'one\ntwo\n' > a.txt && git add a.txt && git commit -qm init
printf 'Spec: keep two lines.\n' > "$t/spec.md"

mkdir -p "$CW_LOG_DIR"; touch -t 202001010000 "$CW_LOG_DIR/old.meta"; touch "$CW_LOG_DIR/new.meta"
# Clean tree: nothing to review, claude never starts.
"$here/bin/cw" reviewer <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "run files older than 2 days move to the archive" '[ -f "$CW_LOG_DIR-archive/old.meta" ] && [ ! -e "$CW_LOG_DIR/old.meta" ] && [ -f "$CW_LOG_DIR/new.meta" ]'
rm -f "$CW_LOG_DIR/new.meta"
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
check "live marker gone once the run is done" '[ -d "$CW_LOG_DIR/live" ] && [ -z "$(ls -A "$CW_LOG_DIR/live")" ]'
check "meta file records role reviewer" 'jq -e "select(.role==\"reviewer\")" "$CW_LOG_DIR"/*-reviewer-*.meta >/dev/null'
check "work tree untouched" '[ "$(cat a.txt)" = "$(printf "one\nTWO")" ] && [ -f b.txt ]'

check "reviewer sp: labels, nit cap, callers, line format" 'grep -q "Important, Nit or Pre-existing" "$t/args" && grep -q "at most 3 Nits" "$t/args" && grep -q "read its callers" "$t/args" && grep -qF "BLOCKER [Important] path:line" "$t/args" && grep -qF "DONE review: N blocker, M suggest" "$t/args"'
printf 'BLOCKER [Important] a.txt:2 - PRIORMARK\n' > "$t/prior1.md"; printf 'SUGGEST [Nit] b.txt:1 - PRIORTWO\n' > "$t/prior2.md"
"$here/bin/cw" reviewer -p "$t/prior1.md" -p "$t/prior2.md" <<< "x" >/dev/null 2>&1
check "-p files inlined as <prior-findings>, 20 turns" 'grep -q "^<prior-findings" "$t/prompt" && grep -q PRIORMARK "$t/prompt" && grep -q PRIORTWO "$t/prompt" && grep -q "answer each prior finding" "$t/args" && arg 20'
"$here/bin/cw" scout -p "$t/prior1.md" <<< "x" >/dev/null 2>&1
check "-p refused for non-reviewer" '[ $? = 2 ]'
"$here/bin/cw" reviewer -p "$t/none.md" <<< "x" >/dev/null 2>&1
check "-p missing file exits 2" '[ $? = 2 ]'

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

# Tiers: Claude tiers pick the model; any other name is rejected.
"$here/bin/cw" scout -M opus <<< "x" >/dev/null 2>&1
check "-M opus picks Opus 5.5" 'arg claude-opus-5-5'
"$here/bin/cw" coder -r sid-1 -e high <<< "x" >/dev/null 2>&1
check "Claude resume keeps the newest model even with explicit effort" 'arg claude-opus-5-5 && arg high'
"$here/bin/cw" coder -r sid-1 -M sonnet <<< "x" >/dev/null 2>&1
check "explicit -M wins over the resumed model" 'arg claude-sonnet-5-5'
FAKE_TURNS=1 "$here/bin/cw" coder -M opus -D "$t" -D "$r" <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "auto-continue keeps Opus and all -D dirs" '[ $rc = 0 ] && grep -q "auto-continuing sid=sid-1" "$t/err" && arg claude-opus-5-5 && arg --resume && [ "$(grep -c -- --add-dir "$t/args")" = 2 ] && arg "$t" && arg "$r"'
FAKE_STOP=142 "$here/bin/cw" coder -C "$t" <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "no result: newest init sid in timeout meta and resume directory" '[ $rc = 142 ] && grep -qE "^\[cw coder .* rc=142 sid=sid-stop [0-9]+s log=.*\.err\]$" "$t/err" && [ "$(cat "$CW_LOG_DIR/dirs/sid-stop")" = "$t" ]'
"$here/bin/cw" coder -T true <<< "x" >/dev/null 2>&1
check "-T marks the run meta for the pane" 'jq -e ".accept == true" "$(ls -t "$CW_LOG_DIR"/*-coder-*.meta | head -1)" >/dev/null'
rm -f "$t/args"
"$here/bin/cw" coder -M flash <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "flash is an unknown tier: usage, rc 2, no model call" '[ $rc = 2 ] && grep -q "^usage: cw" "$t/err" && [ ! -e "$t/args" ]'

# Jev: a sure high stays high, an unsure high runs at medium (fake curl answers for the decisions API).
cat > "$t/bin/curl" <<'C'
#!/usr/bin/env bash
: > "$FAKE/jev-called"
cat >/dev/null; printf '{"answers":{"effort":{"choice":"high","probabilities":{"low":0,"medium":%s,"high":%s}}}}' "$((100 - JEV_HIGH))e-2" "${JEV_HIGH}e-2"
C
chmod +x "$t/bin/curl"
key=x CW_JEV=0 JEV_HIGH=90 "$here/bin/cw" coder <<< "x" >/dev/null 2>&1
check "exported key cannot enable Jev when CW_JEV=0" '[ ! -e "$t/jev-called" ] && arg medium'
CW_JEV=1 OPENROUTER_API_KEY=x JEV_HIGH=90 "$here/bin/cw" coder <<< "x" >/dev/null 2>&1
check "Jev sure high (90%) stays high" 'arg high'
CW_JEV=1 OPENROUTER_API_KEY=x JEV_HIGH=60 "$here/bin/cw" coder <<< "x" >/dev/null 2>&1
check "Jev unsure high (60%) runs at medium" 'arg medium && ! arg high'
check "meta keeps Jev's own pick" 'jq -e ".effort_jev == \"high\" and .effort == \"medium\"" "$(command ls -t "$t"/logs/*.meta | head -1)" >/dev/null'
rm -f "$t/bin/curl"

# -S schema: forwarded compact, bad file exits 2 before the model, pass/FAIL in the meta line.
printf '{\n "type": "object"\n}\n' > "$t/s.json"; printf '{bad' > "$t/bad.json"; rm -f "$t/args"
out=$(FAKE_SO=1 "$here/bin/cw" scout -S "$t/s.json" <<< "x" 2>"$t/err"); rc=$?
check "-S: schema forwarded compact via --json-schema" 'grep -qx -- --json-schema "$t/args" && arg "{\"type\":\"object\"}"'
check "-S: schema=pass, structured_output is the last stdout line" '[ $rc = 0 ] && grep -q " schema=pass " "$t/err" && [ "$(tail -1 <<< "$out")" = "{\"ok\":true,\"n\":1}" ]'
out=$("$here/bin/cw" coder -S "$t/s.json" <<< "x" 2>"$t/err"); rc=$?
check "-S: no structured_output gives schema=FAIL and rc 1" '[ $rc = 1 ] && grep -q " schema=FAIL " "$t/err" && [ "$out" = "DONE review: clean" ]'
rm -f "$t/args"
"$here/bin/cw" scout -S "$t/bad.json" <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "-S: invalid JSON exits 2, no model call" '[ $rc = 2 ] && grep -q "not valid JSON" "$t/err" && [ ! -e "$t/args" ]'
"$here/bin/cw" scout -S "$t/none.json" <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "-S: missing file exits 2, no model call" '[ $rc = 2 ] && grep -q "no such schema file" "$t/err" && [ ! -e "$t/args" ]'

: > "$t/empty.json"
"$here/bin/cw" scout -S "$t/empty.json" <<< "x" >/dev/null 2>&1; rc=$?
check "-S: empty file exits 2" '[ $rc = 2 ]'
echo '{"type":"object"}' > "$t/q.json"
FAKE_RESULT="QUESTION: which one?" "$here/bin/cw" scout -S "$t/q.json" <<< "x" >/dev/null 2>&1; rc=$?
check "-S: an open question keeps rc 3 and a clean .done" '[ $rc = 3 ] && [ "$(cat "$(ls -t "$t"/logs/*.done | head -1)")" = 0 ]'
CW_ENTRYPOINT=cw-crew "$here/bin/cw" scout <<< "x" >/dev/null 2>&1
check "CW_ENTRYPOINT sets the client label" '[ "$(cat "$t/ep")" = cw-crew ]'
CLAUDE_CODE_ENTRYPOINT=cli "$here/bin/cw" scout <<< "x" >/dev/null 2>&1
check "no CW_ENTRYPOINT: inherited label is scrubbed" '[ ! -s "$t/ep" ]'

# Codex tiers: a fake codex records its args and prompt and plays the JSONL of FAKE_CX.
cat > "$t/bin/codex" <<'C'
#!/usr/bin/env bash
if [ "$1" = app-server ]; then
  read -r _; read -r _; read -r _
  echo '{"id":1,"result":{}}'
  echo '{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":'"${FAKE_USED:-20}"'},"secondary":{"usedPercent":3},"planType":"plus"}}}'
  sleep 5; exit 0
fi
printf '%s\n' "$@" > "$FAKE/cxargs"; cat > "$FAKE/cxprompt"; printf '%s\n' "${UV_NO_SYNC:-}" > "$FAKE/cxuv"
echo '{"type":"thread.started","thread_id":"cx-1"}'
case ${FAKE_CX:-ok} in
  limit) echo '{"type":"turn.failed","error":{"message":"You have hit your usage limit"}}'; exit 1 ;;
  edit) echo x >> a.txt; echo '{"type":"turn.failed","error":{"message":"You have hit your usage limit"}}'; exit 1 ;;
  *) [ -z "${FAKE_THINK:-}" ] || echo '{"type":"item.completed","item":{"id":"0","type":"reasoning","text":"'"$FAKE_THINK"'"}}'
     echo '{"type":"item.started","item":{"id":"1","type":"command_execution","command":"ls"}}'
     echo '{"type":"item.completed","item":{"id":"1","type":"command_execution","command":"ls","exit_code":0,"aggregated_output":""}}'
     echo '{"type":"item.completed","item":{"id":"2","type":"agent_message","text":"'"${FAKE_TXT:-DONE cx}"'"}}'
     echo '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":60,"output_tokens":7}}' ;;
esac
C
chmod +x "$t/bin/codex"; cx() { grep -qF -- "$1" "$t/cxargs"; }
unset CW_CODEX_DENY CW_CODEX_DENY_GLOBS
cxdefaults() {
  local p
  for p in .ssh .aws .azure .config/gcloud .gnupg .netrc .config/gh; do
    cx "\"$HOME/$p\"=\"deny\"" || return 1
  done
  for p in '**/.env' '**/.env.*' '**/*.pem' '**/*.key' '**/*.p8' '**/*.p12' '**/*.pfx' '**/*.crt' '**/*.cer' '**/*.der' '**/*.jks' '**/*.keystore' '**/local.properties'; do
    cx "\"$p\"=\"deny\"" || return 1
  done
  ! cx "\"$HOME/.codex\"=\"deny\""
}
rm -f "$t/args" "$t/cxargs"
CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" coder -M sol <<< "do it" > "$t/out" 2>"$t/err"; rc=$?
check "-M sol runs Codex, report and meta line" '[ $rc = 0 ] && grep -q "DONE cx" "$t/out" && grep -q "^\[cw coder codex/gpt-6.1-sol .*rc=0 success sid=cx-1 turns=2 new_in=40 cache_r=60 out=7" "$t/err" && [ ! -e "$t/args" ]'
check "Codex coder: lean flags, workspace sandbox, task on stdin" 'cx "agents.enabled=false" && cx "--ignore-user-config" && cx "permissions.cw.extends=\":workspace\"" && cx "web_search=\"disabled\"" && grep -q "do it" "$t/cxprompt"'
check "Codex denies common credentials and workspace secrets without user config" 'cxdefaults'
check "Codex meta: quota for the pane, session marker" 'jq -e "select(.model==\"codex/gpt-6.1-sol\") | .quota.five == 80 and .quota.week == 97 and .quota.bucket == \"Codex\"" "$(ls -t "$CW_LOG_DIR"/*-coder-*.meta | head -1)" >/dev/null && [ "$(cat "$CW_LOG_DIR/dirs/cx-1.codex")" = gpt-6.1-sol ]'
check "Codex events reach the pane format" 'grep -q "\"e\":\"tool\",\"tool\":\"Bash\"" "$(ls -t "$CW_LOG_DIR"/*-coder-*.events | head -1)"'
ev=$(ls -t "$CW_LOG_DIR"/*-coder-*.events | head -1)
check "Codex events: the command is the note" 'jq -e "select(.e==\"tool\") | .note == \"ls\"" "$ev" >/dev/null'
FAKE_THINK='**Checking the listing** of the repo for the long summary that goes past sixty characters' CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" coder -M sol <<< "go" >/dev/null 2>&1
ev=$(ls -t "$CW_LOG_DIR"/*-coder-*.events | head -1)
check "Codex events: a reasoning summary becomes a one-line note of at most 60 chars" 'jq -e "select(.e==\"think\") | .note | startswith(\"Checking the listing\") and length <= 60" "$ev" >/dev/null'
CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" coder -r cx-1 <<< "go on" >/dev/null 2>"$t/err"
check "a Codex session resumes on Codex with its model" 'grep -qx resume "$t/cxargs" && grep -qx cx-1 "$t/cxargs" && cx gpt-6.1-sol'
CW_CODEX_DENY="$t/private:$HOME/.ssh" CW_CODEX_DENY_GLOBS='**/secret.json:**/.env' CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" scout -w <<< "x" >/dev/null 2>"$t/err"
check "CW_CODEX=1: scout defaults to Luna, read-only, -w turns web on" 'cx gpt-6-luna && cx "permissions.cw.extends=\":read-only\"" && cx "web_search=\"live\""'
check "Codex env denies add to defaults without duplicate TOML keys" 'cxdefaults && cx "\"$t/private\"=\"deny\"" && cx "\"**/secret.json\"=\"deny\"" && [ "$(grep -oF "\"$HOME/.ssh\"=\"deny\"" "$t/cxargs" | wc -l | tr -d " ")" = 1 ] && [ "$(grep -oF "\"**/.env\"=\"deny\"" "$t/cxargs" | wc -l | tr -d " ")" = 1 ]'
rm -f "$t/args" "$t/cxargs"; CW_DENY="$t/shared" CW_DENY_GLOBS='**/shared.json' CW_CODEX_ONLY_DENY="$t/cxonly" CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" scout <<< "x" >/dev/null 2>&1
check "CW_DENY and CW_CODEX_ONLY_DENY reach the Codex config, defaults stay" 'cxdefaults && cx "\"$t/shared\"=\"deny\"" && cx "\"**/shared.json\"=\"deny\"" && cx "\"$t/cxonly\"=\"deny\""'
rm -f "$t/args"; CW_DENY="$t/shared" CW_DENY_GLOBS='**/shared.json' CW_CODEX_DENY="$t/cxold" CW_CODEX_ONLY_DENY="$t/cxonly" "$here/bin/cw" coder -a 'Read(~/.ssh/config)' <<< "x" >/dev/null 2>&1
cset=$(grep -m1 '^{"language"' "$t/args")
check "Claude settings deny ~/.ssh and CW_DENY paths for Read/Edit/Write, even with -a" 'jq -e --arg s "/$t/shared" "(.permissions.deny | index(\"Read(~/.ssh/**)\") != null and index(\"Write(~/.ssh/**)\") != null and index(\"Read(\" + \$s + \"/**)\") != null and index(\"Read(**/.env)\") != null and index(\"Read(**/shared.json)\") != null)" <<< "$cset" >/dev/null'
check "CW_CODEX_ONLY_DENY and CW_CODEX_DENY stay out of the Claude settings" '! grep -q "cxonly\|cxold" "$t/args"'
mkdir -p "$t/sbx/a/node_modules" && touch "$t/sbx/fake.secret" "$t/sbx/a/fake.secret" "$t/sbx/a/node_modules/fake.secret" "$t/sbx/ok.txt"
rm -f "$t/args"; CW_DENY="$t/shared" CW_DENY_GLOBS='**/fake.secret' CW_CODEX_ONLY_DENY="$t/cxonly" "$here/bin/cw" coder -C "$t/sbx" -a 'Bash(curl -s https://x.test)' <<< "x" >/dev/null 2>&1
sbx=$(grep -m1 '^{"language"' "$t/args" | jq -c .sandbox)
check "Claude sandbox: on, no unsandboxed retry, denies the list and glob matches in the work dir, grants run outside" 'jq -e --arg h "$HOME" --arg t "$t" ".enabled and .autoAllowBashIfSandboxed and (.allowUnsandboxedCommands == false) and (.filesystem.denyRead | index(\$h + \"/.ssh\") != null and index(\$t + \"/shared\") != null and (map(endswith(\"sbx/fake.secret\")) | any) and (map(endswith(\"a/fake.secret\")) | any) and (map(test(\"node_modules|ok.txt|cxonly\")) | any | not)) and .excludedCommands == [\"curl -s https://x.test\"]" <<< "$sbx" >/dev/null && grep -q "PERMISSION: Bash(<exact command>)" "$t/args"'
rm -f "$t/args"; CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" coder -a 'Bash(ls)' <<< "x" >/dev/null 2>&1
check "-a keeps the run on Claude" 'arg claude-sonnet-5-5'
rm -f "$t/args"; CW_CODEX=0 "$here/bin/cw" coder -M sol <<< "x" >/dev/null 2>"$t/err"
check "codex tiers off: sol falls back to Sonnet" 'arg claude-sonnet-5-5 && grep -q "codex tiers are off" "$t/err"'
rm -f "$t/args"; FAKE_USED=95 CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" scout <<< "x" >/dev/null 2>"$t/err"
check "limit at CW_CODEX_MAX: scout falls back to Haiku" 'arg claude-haiku-5-5 && grep -q "Codex limit at 95% used" "$t/err"'
rm -f "$t/args"; FAKE_CX=limit CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" coder -M sol <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "limit mid-run, no changes: rerun on Claude" 'arg claude-sonnet-5-5 && grep -q "rerunning on Claude" "$t/err" && [ $rc = 0 ]'
rm -f "$t/args"; git stash -qu 2>/dev/null; FAKE_CX=edit CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" coder -M sol <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "limit mid-run with changes: stops for the lead" '[ ! -e "$t/args" ] && [ $rc != 0 ] && grep -q "usage_limit" "$t/err"'
git checkout -q -- a.txt 2>/dev/null
printf '{"type":"object"}' > "$t/o.json"
FAKE_TXT='{\"ok\":true}' CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" scout -S "$t/o.json" <<< "x" > "$t/out" 2>"$t/err"
check "-S on Codex: output schema, schema=pass" 'cx --output-schema && grep -q "schema=pass" "$t/err"'
mkdir "$t/py"; touch "$t/py/uv.lock"; printf '#!/bin/sh\necho "$@" > "$FAKE/uvargs"\n' > "$t/bin/uv"; chmod +x "$t/bin/uv"
CW_CODEX=1 CW_CODEX_TTL=0 "$here/bin/cw" coder -M sol -C "$t/py" <<< "x" >/dev/null 2>"$t/err"
check "Codex coder in a uv project: synced first, no sync in the sandbox" 'grep -q "sync --frozen" "$t/uvargs" && grep -qx 1 "$t/cxuv"'
rm -f "$t/bin/uv"

# Provider priority is independent of model level; keys stay out of argv and run files.
export CW_PRIORITY=codex:api:claude CW_CODEX=0 CW_CODEX_TTL=0 CW_API_KEY=priority-secret-not-for-logs
oldlogs=$CW_LOG_DIR; export CW_LOG_DIR=$t/priority-logs
rm -f "$t/args" "$t/cxargs"
FAKE_USED=99 "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: Codex at 99% still runs with CW_CODEX=0" '[ $rc = 0 ] && cx gpt-6.1-sol && [ ! -e "$t/args" ] && grep -qx "cw: provider=codex" "$t/err"'
rm -f "$t/cxargs"
FAKE_USED=100 "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: Codex at 100% skips to API with the key" '[ $rc = 0 ] && [ ! -e "$t/cxargs" ] && [ "$(cat "$t/key")" = set ] && grep -qx "cw: provider=api (skipped codex: Codex limit at 100% used)" "$t/err"'
export CW_PRIORITY=api:claude
CW_API_KEY= ANTHROPIC_API_KEY=caller-key ANTHROPIC_AUTH_TOKEN=caller-token "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: no API key uses Claude, scrubbing inherited key and auth" '[ $rc = 0 ] && [ ! -s "$t/key" ] && [ ! -s "$t/auth" ] && grep -q "provider=claude" "$t/err"'
ANTHROPIC_AUTH_TOKEN=caller-token "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: API key present, provider meta, no secret in logs or stderr or args" '[ $rc = 0 ] && [ "$(cat "$t/key")" = set ] && [ ! -s "$t/auth" ] && jq -e ".provider == \"api\"" "$(ls -t "$CW_LOG_DIR"/*.meta | head -1)" >/dev/null && ! grep -rF "$CW_API_KEY" "$CW_LOG_DIR" "$t/err" "$t/args"'
: > "$t/calls"
FAKE_SUBTYPE=error_max_turns FAKE_ERROR=true "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: API turn limit is not credit spent or a provider switch" '[ $rc = 1 ] && [ ! -e "$CW_LOG_DIR/dirs/.api-spent" ] && [ "$(cat "$t/calls")" = "api " ] && grep -q "rc=0 error_max_turns" "$t/err" && ! grep -q "trying next provider" "$t/err"'
: > "$t/calls"
FAKE_STDERR=billing FAKE_RESULT="DONE billing report" "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: API success mentioning billing in result and stderr is not dry" '[ $rc = 0 ] && [ ! -e "$CW_LOG_DIR/dirs/.api-spent" ] && [ "$(cat "$t/calls")" = "api " ] && grep -q "rc=0 success" "$t/err"'
CW_PRIORITY=claude:api FAKE_RESULT="DONE checked rate limit" FAKE_STDERR="usage limit" "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: Claude success mentioning rate limit in report stays successful" '[ $rc = 0 ] && [ ! -s "$t/key" ] && grep -q "rc=0 success" "$t/err" && ! grep -q "trying next provider" "$t/err"'
: > "$t/calls"
CW_PRIORITY=api:claude FAKE_RAW='{"type":"result","subtype":"success","is_error":true,"api_error_status":401,"result":"Invalid authentication credentials; rate limit docs","session_id":"sid-1"}' "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "fallback: 401 failure does not hop" '[ $rc != 0 ] && [ "$(cat "$t/calls")" = "api " ] && grep -qx "cw: api failed (auth); not falling back" "$t/err" && ! grep -q "trying next provider" "$t/err"'
: > "$t/calls"
CW_PRIORITY=api:claude FAKE_DRY=api "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "fallback: real usage limit still hops to next provider" '[ "$(head -1 "$t/calls")" = "api " ] && [ "$(sed -n 2p "$t/calls" | cut -c1-4)" != "api " ] && grep -q "api stopped (usage_limit); trying next provider" "$t/err" && ! grep -q "not falling back" "$t/err"'
rm -f "$CW_LOG_DIR/dirs/.api-spent"
CW_PRIORITY="" CW_CODEX=1 FAKE_USED=95 "$here/bin/cw" scout <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "empty priority: legacy Codex threshold and no provider diagnostic" '[ $rc = 0 ] && arg claude-haiku-5-5 && grep -q "Codex limit at 95% used" "$t/err" && ! grep -q "cw: provider=" "$t/err"'
CW_PRIORITY="" "$here/bin/cw" coder -P claude <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "empty priority: -P still works without a provider diagnostic" '[ $rc = 0 ] && arg claude-sonnet-5-5 && ! grep -q "cw: provider=" "$t/err"'
export CW_PRIORITY=codex:claude
rm -f "$t/args"
"$here/bin/cw" coder -M sonnet <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: -M sonnet selects level 2 on Codex" '[ $rc = 0 ] && cx gpt-6.1-sol && [ ! -e "$t/args" ]'
rm -f "$t/cxargs"
"$here/bin/cw" coder -P claude -M sonnet <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: -P claude forces Claude without changing level" '[ $rc = 0 ] && arg claude-sonnet-5-5 && [ ! -e "$t/cxargs" ] && [ ! -s "$t/key" ]'
export CW_PRIORITY=api:claude
: > "$t/calls"
FAKE_DRY=api "$here/bin/cw" coder -M opus <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: dry API marks spent, resumes same session on Claude, rc 0" '[ $rc = 0 ] && [ -f "$CW_LOG_DIR/dirs/.api-spent" ] && [ "$(cat "$t/calls")" = "$(printf "api \n sid-1")" ] && arg --resume && arg sid-1 && arg claude-opus-5-5 && grep -q "Continue exactly where you stopped" "$t/prompt"'
"$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: later run skips recently spent API" '[ $rc = 0 ] && [ ! -s "$t/key" ] && grep -q "provider=claude (skipped api: API credit spent)" "$t/err"'
CW_API_RETRY=0 "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: API retries after the spent interval" '[ $rc = 0 ] && [ "$(cat "$t/key")" = set ]'
cp a.txt "$t/before-dry"
CW_API_RETRY=0 FAKE_DRY=api FAKE_DRY_EDIT=1 "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: API to Claude resumes even after file changes" '[ $rc = 0 ] && arg --resume && arg sid-1 && [ ! -s "$t/key" ] && grep -qx progress a.txt'
cp "$t/before-dry" a.txt
CW_API_RETRY=0 FAKE_DRY=api-stderr "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: API billing stderr without a result resumes the init session" '[ $rc = 0 ] && [ ! -s "$t/key" ] && arg --resume && arg sid-1 && [ -f "$CW_LOG_DIR/dirs/.api-spent" ]'
: > "$t/calls"
CW_PRIORITY=claude:api CW_API_RETRY=0 FAKE_DRY=claude "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: dry Claude resumes the same session on API" '[ $rc = 0 ] && [ "$(cat "$t/calls")" = "$(printf " \napi sid-1")" ] && arg --resume && [ "$(cat "$t/key")" = set ]'
rm -f "$t/cxargs"
CW_PRIORITY=api:codex CW_API_RETRY=0 FAKE_DRY=api "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: no Claude provider left stops with subtype, not a Codex resume" '[ $rc != 0 ] && [ ! -e "$t/cxargs" ] && grep -q "^\[cw coder .*usage_limit" "$t/err"'
CW_PRIORITY=api:claude:api CW_API_RETRY=0 FAKE_DRY=api "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: repeated dry providers do not hide the next provider" '[ $rc = 0 ] && [ ! -s "$t/key" ] && arg --resume'
rm -f "$t/args"
CW_PRIORITY=codex:api:claude CW_API_RETRY=0 FAKE_CX=limit "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: Codex dry without edits starts fresh on API" '[ $rc = 0 ] && [ "$(cat "$t/key")" = set ] && ! arg --resume && grep -q "provider=api" "$t/err"'
rm -f "$t/args"
CW_PRIORITY=codex:api:claude FAKE_CX=edit "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: Codex dry with edits still stops for the lead" '[ $rc != 0 ] && [ ! -e "$t/args" ] && grep -q "usage_limit" "$t/err"'
cp "$t/before-dry" a.txt
rm -f "$t/args" "$t/cxargs"
CW_PRIORITY=codex:nope:claude "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: unknown provider exits 2 before any model call" '[ $rc = 2 ] && [ ! -e "$t/args" ] && [ ! -e "$t/cxargs" ] && grep -q "unknown provider: nope" "$t/err"'
CW_PRIORITY=codex:claude FAKE_USED=100 "$here/bin/cw" coder -P codex <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "priority: forced unavailable Codex exits 2 with reason" '[ $rc = 2 ] && [ ! -e "$t/args" ] && [ ! -e "$t/cxargs" ] && grep -q "Codex limit at 100% used" "$t/err"'
unset CW_PRIORITY CW_API_KEY CW_CODEX CW_CODEX_TTL
ANTHROPIC_API_KEY=inherited "$here/bin/cw" coder <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "unset priority: inherited API key still records provider Claude" '[ $rc = 0 ] && [ "$(cat "$t/key")" = set ] && jq -e ".provider == \"claude\"" "$(ls -t "$CW_LOG_DIR"/*.meta | head -1)" >/dev/null && ! grep -q "cw: provider=" "$t/err"'
"$here/bin/cw" coder -P claude -M sonnet <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "unset priority: -P claude works without CW_PRIORITY" '[ $rc = 0 ] && arg claude-sonnet-5-5 && [ ! -s "$t/key" ]'
export CW_LOG_DIR=$oldlogs
rm -f "$t/bin/codex"

# -A must check main-tree output too, even when the command exits 0 (worker run stays clean).
for mode in fail script custom exit off zero; do
  wt=$("$here/bin/cwwt" create accept 2>/dev/null)
  printf 'applied\n' > "$wt/applied.txt"
  case $mode in
    fail|off) msg='FAIL test';; script) msg='SCRIPT ERROR: test';;
    custom) msg='BROKEN test';; exit) msg='test exited';; zero) msg='FAIL: 0';;
  esac
  acc="if [ -d .git ]; then echo '$msg' >&2; [ '$mode' != exit ]; fi"
  # An if with no matching branch exits 0 in the worker.
  case $mode in custom) export CW_ACCEPT_FAIL_RE='^BROKEN';; off) export CW_ACCEPT_FAIL_RE=;; *) unset CW_ACCEPT_FAIL_RE;; esac
  CW_FLEET=$t/fleet "$here/bin/cwgo" -A "apply-$mode" coder -W accept -T "$acc" <<< "x" > "$t/out" 2>"$t/err"
  check "-A $mode: worker acceptance passes in [cw ...] meta" 'grep -q "^\[cw coder .* accept=pass " "$t/fleet/apply-$mode.err"'
  case $mode in
    off|zero)
      check "-A $mode: main-tree output allowed" 'grep -q "^=== APPLIED " "$t/out" && [ -f applied.txt ] && [ ! -d "$wt" ]'
      rm -f applied.txt ;;
    *)
      check "-A $mode: main-tree failure reverts patch" 'grep -q "^=== APPLY REVERTED " "$t/out" && [ ! -e applied.txt ] && [ -f "$wt/applied.txt" ]'
      "$here/bin/cwwt" rm accept >/dev/null 2>&1 ;;
  esac
done
unset CW_ACCEPT_FAIL_RE

CW_ENTRYPOINT=cw-crew CW_PRIORITY=api CW_API_KEY=k "$here/bin/cw" scout <<< "x" >/dev/null 2>&1
check "api provider: no custom client label" '[ ! -s "$t/ep" ]'
CW_PRIORITY=api CW_API_KEY=sk-test-redact-123 FAKE_RESULT="leak sk-test-redact-123" "$here/bin/cw" scout <<< "x" > "$t/out" 2>"$t/err"
check "an API key printed by the worker is redacted in logs and report" '! grep -rqF sk-test-redact-123 "$CW_LOG_DIR" "$t/out" "$t/err" && grep -qF "[api-key]" "$t/out"'

# Contract level follows the resolved model: haiku explicit, sonnet shorter, opus minimal.
"$here/bin/cw" scout <<< "x" >/dev/null 2>&1; sp1=$(cat "$t/prompt" "$t/args")
check "contract: haiku scout prompt has VERIFIED/INFERRED, protocol intact" 'grep -q VERIFIED <<< "$sp1" && grep -q INFERRED <<< "$sp1" && grep -q "QUESTION: <one concrete question>" <<< "$sp1" && grep -q "PERMISSION: <Tool>" <<< "$sp1"'
check "contract: haiku scout .meta has contract 1" '[ "$(jq -r .contract "$(ls -t "$CW_LOG_DIR"/*.meta | head -1)")" = 1 ]'
"$here/bin/cw" coder -M opus <<< "x" >/dev/null 2>&1; sp3=$(cat "$t/prompt" "$t/args")
check "contract: opus coder prompt has no VERIFIED/INFERRED, protocol intact" '! grep -q "VERIFIED\|INFERRED" <<< "$sp3" && grep -q "QUESTION: <one concrete question>" <<< "$sp3" && grep -q "PERMISSION: <Tool>" <<< "$sp3"'
check "contract: opus coder .meta has contract 3" '[ "$(jq -r .contract "$(ls -t "$CW_LOG_DIR"/*.meta | head -1)")" = 3 ]'
CW_CODEX=0 "$here/bin/cw" coder -M sol <<< "x" >/dev/null 2>&1
check "contract: sol falling back to Sonnet keeps contract 2" '[ "$(jq -r .contract "$(ls -t "$CW_LOG_DIR"/*.meta | head -1)")" = 2 ]'
# Project rules in the worker system prompt (claude --system-prompt, codex model_instructions_file).
rr=$t/rrepo; mkdir -p "$rr/sub"; git -C "$rr" init -q -b main; cd "$rr" || exit 1
spof() { awk '/^--tools$/ {p=0} p {print} /^--system-prompt$/ {p=1}' "$t/args"; }
printf 'CLAUDE-RULES-XYZ\n' > CLAUDE.md
"$here/bin/cw" scout <<< "x" >/dev/null 2>&1
check "rules: only CLAUDE.md goes into the claude system prompt" 'spof | grep -q "<project-rules path=\".*CLAUDE.md\">" && spof | grep -q CLAUDE-RULES-XYZ && [ "$(spof | head -c 20)" = "You are a read-only " ]'
printf 'AGENTS-RULES-XYZ\n' > AGENTS.md
"$here/bin/cw" coder -C sub <<< "x" >/dev/null 2>&1
check "rules: AGENTS.md beats CLAUDE.md (walks up from a subdir)" 'spof | grep -q AGENTS-RULES-XYZ && ! spof | grep -q CLAUDE-RULES-XYZ'
CW_RULES=0 "$here/bin/cw" scout <<< "x" >/dev/null 2>&1
check "rules: CW_RULES=0 adds nothing" '! spof | grep -q "project-rules"'
head -c 300 /dev/zero | tr '\0' 'a' > AGENTS.md
CW_RULES_MAX=100 "$here/bin/cw" scout <<< "x" >/dev/null 2>&1
check "rules: oversize file is cut with a notice" 'spof | grep -q "cut at 100 bytes: Read .*AGENTS.md for the rest" && ! spof | grep -q "a\{101\}"'
printf 'OUTSIDE-RULES\n' > "$t/AGENTS.md"; rm -f AGENTS.md CLAUDE.md
"$here/bin/cw" scout <<< "x" >/dev/null 2>&1
check "rules: files outside the git root are never used" '! spof | grep -q "project-rules\|OUTSIDE-RULES"'
printf 'CX-RULES-XYZ\n' > AGENTS.md
printf '#!/usr/bin/env bash
cat >/dev/null
echo "{\"type\":\"turn.completed\",\"usage\":{}}"
' > "$t/bin/codex"; chmod +x "$t/bin/codex"
CW_CODEX=1 "$here/bin/cw" coder -M sol <<< "x" >/dev/null 2>&1
sp=$(ls -t "$CW_LOG_DIR"/*.sp | head -1)
check "rules: codex model_instructions_file carries the rules" 'grep -q "CX-RULES-XYZ" "$sp" && grep -q "<project-rules" "$sp"'
rm -f "$t/bin/codex"; cd "$r" || exit 1
# Escalation on failed acceptance (-X / CW_ESCALATE=1): once, one level up, never past high.
acc="if [ -e '$t/esc-ok' ]; then exit 0; else touch '$t/esc-ok'; echo 'FAIL boom'; exit 1; fi"
rm -f "$t/calls" "$t/esc-ok"
"$here/bin/cw" coder -X -e low -T "$acc" <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "escalate: failed acceptance resumes once at the next effort, then passes" '[ $rc = 0 ] && [ "$(wc -l < "$t/calls" | tr -d " ")" = 2 ] && grep -q "escalating effort low→medium" "$t/err" && grep -q "effort=medium(flag) .* accept=pass" "$t/err" && arg medium && grep -q "^Acceptance failed. Output below." "$t/prompt" && grep -q "FAIL boom" "$t/prompt" && grep -q "do not weaken the check" "$t/prompt"'
rm -f "$t/calls" "$t/esc-ok"
CW_ESCALATE=1 "$here/bin/cw" coder -T "$acc" <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "escalate: CW_ESCALATE=1 works, default medium goes to high" '[ $rc = 0 ] && grep -q "escalating effort medium→high" "$t/err" && grep -q "effort=high(flag) .* accept=pass" "$t/err"'
rm -f "$t/calls" "$t/esc-ok"
"$here/bin/cw" coder -X -e high -T "$acc" <<< "x" >/dev/null 2>"$t/err"
check "escalate: already high does not escalate and says why" '[ "$(wc -l < "$t/calls" | tr -d " ")" = 1 ] && grep -q "not escalating: effort is already high" "$t/err" && grep -q "accept=FAIL" "$t/err"'
rm -f "$t/calls" "$t/esc-ok"
"$here/bin/cw" coder -T "$acc" <<< "x" >/dev/null 2>"$t/err"
check "escalate: off without -X/CW_ESCALATE" '[ "$(wc -l < "$t/calls" | tr -d " ")" = 1 ] && ! grep -q escalat "$t/err" && grep -q "effort=medium(default) .* accept=FAIL" "$t/err"'
rm -f "$t/calls" "$t/esc-ok"
"$here/bin/cw" coder -X -e low -T 'echo FAIL always; exit 1' <<< "x" >/dev/null 2>"$t/err"
check "escalate: only once per cw call" '[ "$(wc -l < "$t/calls" | tr -d " ")" = 2 ] && [ "$(grep -c "escalating effort" "$t/err")" = 1 ] && grep -q "accept=FAIL" "$t/err"'
rm -f "$t/calls" "$t/esc-ok"
FAKE_TURNS=1 "$here/bin/cw" coder -X -e low -T "$acc" <<< "x" >/dev/null 2>"$t/err"; rc=$?
check "escalate: -X survives the turn-limit auto-continue" '[ $rc = 0 ] && grep -q "auto-continuing" "$t/err" && grep -q "escalating effort low→medium" "$t/err"'

"$here/bin/cwwt" rm w1 >/dev/null 2>&1
echo; [ $fails = 0 ] && echo "all passed (0 failures)" || { echo "$fails failed"; exit 1; }
