#!/usr/bin/env bash
# tests/cwstats.sh — bin/cwstats against a fake CW_LOG_DIR with hand-written runs.
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
logdir=$t/logs; mkdir -p "$logdir/dirs"
export CW_LOG_DIR=$logdir
fails=0
ok() { echo "ok   $1"; }
no() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }

now=$(date +%s)
recent=$((now - 3600))

# Run 1: success (coder, sonnet, medium)
b=20261029-100000-coder-1001
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"sess-A","resume":"","task":"Implement the parser module","start":%d,"effort":"medium","effort_src":"jev","effort_p":"l0 m100 h0","maxt":80,"cont":false}\n' "$recent" > "$logdir/$b.meta"
printf '{"subtype":"success","is_error":false,"num_turns":12,"total_cost_usd":0.42,"duration_ms":180000,"session_id":"sid-1001","result":"Done: parser implemented."}\n' > "$logdir/$b.json"
printf '{"e":"init","t":%d}\n{"e":"tool","tool":"Read","arg":"/work/src/parser.ts","t":%d}\n{"e":"result","ok":true,"t":%d}\n' "$((recent*1000))" "$((recent*1000+5000))" "$((recent*1000+180000))" > "$logdir/$b.events"
printf '0\n' > "$logdir/$b.done"
printf '/work\n' > "$logdir/dirs/sid-1001"

# Run 2: error_max_turns (coder, sonnet, medium)
b=20261029-100100-coder-1002
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"sess-B","resume":"","task":"Refactor the database layer","start":%d,"effort":"medium","effort_src":"default","maxt":80,"cont":false}\n' "$recent" > "$logdir/$b.meta"
printf '{"subtype":"error_max_turns","is_error":true,"num_turns":80,"total_cost_usd":2.10,"duration_ms":600000,"session_id":"sid-1002","result":"Hit turn limit."}\n' > "$logdir/$b.json"
printf '{"e":"init","t":%d}\n{"e":"result","ok":false,"t":%d}\n' "$((recent*1000))" "$((recent*1000+600000))" > "$logdir/$b.events"
printf '0\n' > "$logdir/$b.done"

# Run 3: timeout (coder, opus, high, .done=142)
b=20261029-100200-coder-1003
printf '{"role":"coder","model":"claude-opus-5-5","session":"sess-C","resume":"","task":"Build the CI pipeline","start":%d,"effort":"high","effort_src":"jev","effort_p":"l0 m10 h90","maxt":80,"cont":false}\n' "$recent" > "$logdir/$b.meta"
printf '{"subtype":"error_during_execution","is_error":true,"num_turns":40,"total_cost_usd":5.00,"duration_ms":3600000,"session_id":"sid-1003","result":"Timed out."}\n' > "$logdir/$b.json"
printf '{"e":"init","t":%d}\n{"e":"result","ok":false,"t":%d}\n' "$((recent*1000))" "$((recent*1000+3600000))" > "$logdir/$b.events"
printf '142\n' > "$logdir/$b.done"

# Run 4: escalation pair — medium then high, same session + task
# Run 4a: medium (gets escalated)
b=20261029-100300-coder-1004
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"sess-D","resume":"","task":"Fix the login form validation","start":%d,"effort":"medium","effort_src":"jev","effort_p":"l0 m80 h20","maxt":80,"cont":false}\n' "$recent" > "$logdir/$b.meta"
printf '{"subtype":"success","is_error":false,"num_turns":8,"total_cost_usd":0.15,"duration_ms":60000,"session_id":"sid-1004","result":"Done."}\n' > "$logdir/$b.json"
printf '{"e":"init","t":%d}\n{"e":"result","ok":true,"t":%d}\n' "$((recent*1000))" "$((recent*1000+60000))" > "$logdir/$b.events"
printf '0\n' > "$logdir/$b.done"
# Run 4b: high (same session + task, later)
b=20261029-100400-coder-1005
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"sess-D","resume":"","task":"Fix the login form validation","start":%d,"effort":"high","effort_src":"jev","effort_p":"l0 m20 h80","maxt":80,"cont":false}\n' "$((recent + 300))" > "$logdir/$b.meta"
printf '{"subtype":"success","is_error":false,"num_turns":20,"total_cost_usd":0.80,"duration_ms":120000,"session_id":"sid-1005","result":"Done properly."}\n' > "$logdir/$b.json"
printf '{"e":"init","t":%d}\n{"e":"accept","t":%d}\n{"e":"accept_end","ok":true,"t":%d}\n{"e":"result","ok":true,"t":%d}\n' "$((recent*1000+300000))" "$((recent*1000+400000))" "$((recent*1000+410000))" "$((recent*1000+420000))" > "$logdir/$b.events"
printf '0\n' > "$logdir/$b.done"

# Run 5: stepped-down Jev (effort_jev=high, effort=medium, effort_src=jev)
b=20261029-100500-coder-1006
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"sess-E","resume":"","task":"Update the config schema","start":%d,"effort":"medium","effort_src":"jev","effort_p":"l0 m60 h40","effort_jev":"high","maxt":80,"cont":false}\n' "$recent" > "$logdir/$b.meta"
printf '{"subtype":"success","is_error":false,"num_turns":5,"total_cost_usd":0.10,"duration_ms":30000,"session_id":"sid-1006","result":"Done."}\n' > "$logdir/$b.json"
printf '{"e":"init","t":%d}\n{"e":"result","ok":true,"t":%d}\n' "$((recent*1000))" "$((recent*1000+30000))" > "$logdir/$b.events"
printf '0\n' > "$logdir/$b.done"

# Run 6: agy run with md link and outside read
b=20261029-100600-scout-1007
printf '{"role":"scout","model":"agy/gemini-3.8-flash-high","session":"sess-F","resume":"","task":"Find all callers of parseConfig","start":%d,"effort":"low","effort_src":"default","maxt":40,"cont":false}\n' "$recent" > "$logdir/$b.meta"
printf '{"subtype":"success","is_error":false,"num_turns":3,"session_id":"sid-1007","result":"Found callers:\\n- [main.ts](file:///work/src/main.ts#L42)\\n- [app.ts](file:///work/src/app.ts#L10)"}\n' > "$logdir/$b.json"
printf '{"e":"init","t":%d}\n{"e":"tool","tool":"Read","arg":"/work/src/parser.ts","t":%d}\n{"e":"tool","tool":"Read","arg":"/outside/other/file.ts","t":%d}\n{"e":"error","t":%d}\n{"e":"result","ok":true,"t":%d}\n' "$((recent*1000))" "$((recent*1000+1000))" "$((recent*1000+2000))" "$((recent*1000+2500))" "$((recent*1000+5000))" > "$logdir/$b.events"
printf '0\n' > "$logdir/$b.done"
printf '/work\n' > "$logdir/dirs/sid-1007"

# Run 7: a run with .ask
b=20261029-100700-coder-1008
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"sess-G","resume":"","task":"Deploy to staging","start":%d,"effort":"medium","effort_src":"default","maxt":80,"cont":false}\n' "$recent" > "$logdir/$b.meta"
printf '{"subtype":"success","is_error":false,"num_turns":6,"total_cost_usd":0.20,"duration_ms":45000,"session_id":"sid-1008","result":"Need access."}\n' > "$logdir/$b.json"
printf '{"e":"init","t":%d}\n{"e":"result","ok":true,"t":%d}\n' "$((recent*1000))" "$((recent*1000+45000))" > "$logdir/$b.events"
printf '0\n' > "$logdir/$b.done"
printf 'QUESTION: need staging creds\n' > "$logdir/$b.ask"


# Run 8: old run outside the window (must be excluded by --days 1)
b=20200101-000000-coder-1009
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"sess-H","task":"Ancient history task","start":1577836800,"effort":"medium"}\n' > "$logdir/$b.meta"

# cwmark: mark two fake runs (one ok by log base, one bad by fleet NAME)
b1=20261029-100000-coder-1001
bash "$here/bin/cwmark" "$b1" ok

b2=20261029-100100-coder-1002
fleetdir=$t/fleet; mkdir -p "$fleetdir"
export CW_FLEET=$fleetdir
printf '[cw coder claude-sonnet-5-5 rc=0 80s log=%s/%s.json]\n' "$logdir" "$b2" > "$fleetdir/fake-worker.err"
bash "$here/bin/cwmark" fake-worker bad "output mismatch"

check "cwmark unknown run exits 2" 'bash "$here/bin/cwmark" nonexistent ok 2>/dev/null; [ $? = 2 ]'

# ──── text output checks ────
out=$(bash "$here/bin/cwstats" --days 1)
row() { echo "$out" | grep -E "$1" | head -1; }

check "table 1 header" 'echo "$out" | grep -q "^By role / model / effort"'
check "table 1 sonnet medium: 5 runs, 80% ok, 20% esc" 'row "claude-sonnet-5-5 +medium" | grep -qE "[[:space:]]5[[:space:]]+80[[:space:]]"; row "claude-sonnet-5-5 +medium" | grep -qE "[[:space:]]20[[:space:]]"'
check "table 1 sonnet medium shows 1/2 in right column" 'row "claude-sonnet-5-5 +medium" | grep -q "1/2"'
check "table 1 opus high row exists" 'row "claude-opus-5-5 +" | grep -q high'
check "table 1 accept 1/1 on sonnet high" 'row "claude-sonnet-5-5 +high" | grep -q "1/1"'
check "old run excluded" '! echo "$out" | grep -q "Ancient"'
check "table 2 header" 'echo "$out" | grep -q "^Jev effort"'
check "table 2 sure high 2 runs" 'echo "$out" | grep "^sure high" | grep -qE "[[:space:]]2[[:space:]]"'
check "table 2 stepped down 1 run" 'echo "$out" | grep "^stepped down" | grep -qE "[[:space:]]1[[:space:]]"'
check "table 3 header" 'echo "$out" | grep -q "^agy prompt signals"'
check "table 3 agy model listed" 'echo "$out" | grep -q "^agy/gemini-3.8-flash-high"'

# ──── export checks (exact numbers) ────
ejson=$(bash "$here/bin/cwstats" --days 1 --export)
check "export is valid JSON" 'echo "$ejson" | jq -e . >/dev/null'
check "export schema=1, days=1" 'echo "$ejson" | jq -e ".schema == 1 and .days == 1" >/dev/null'
check "export has 3 tables" 'echo "$ejson" | jq -e ".tables | keys | length == 3" >/dev/null'
t1='.tables.by_role_model_effort[]'
check "total runs 8 (old run excluded)" 'echo "$ejson" | jq -e "[$t1.runs] | add == 8" >/dev/null'
sm="$t1 | select(.model==\"claude-sonnet-5-5\" and .effort==\"medium\")"
check "sonnet medium: runs 5" 'echo "$ejson" | jq -e "$sm | .runs == 5" >/dev/null'
check "sonnet medium: max_turns 1" 'echo "$ejson" | jq -e "$sm | .max_turns == 1" >/dev/null'
check "sonnet medium: ask 1" 'echo "$ejson" | jq -e "$sm | .ask == 1" >/dev/null'
check "sonnet medium: ok 80%" 'echo "$ejson" | jq -e "$sm | .ok_pct == 80" >/dev/null'
check "sonnet medium: escalated 20%" 'echo "$ejson" | jq -e "$sm | .escalated_pct == 20" >/dev/null'
check "sonnet medium: right 1, marked 2" 'echo "$ejson" | jq -e "$sm | .right == 1 and .marked == 2" >/dev/null'
check "opus high: timeout 1" 'echo "$ejson" | jq -e "$t1 | select(.model==\"claude-opus-5-5\") | .timeout == 1" >/dev/null'
check "sonnet high: accept 1/1, not escalated" 'echo "$ejson" | jq -e "$t1 | select(.model==\"claude-sonnet-5-5\" and .effort==\"high\") | .accept_pass == 1 and .accept_total == 1 and .escalated_pct == 0" >/dev/null'
jr='.tables.jev_effort[]'
check "jev: sure high 2" 'echo "$ejson" | jq -e "$jr | select(.label==\"sure high\") | .runs == 2" >/dev/null'
check "jev: stepped down 1" 'echo "$ejson" | jq -e "$jr | select(.label==\"stepped down\") | .runs == 1" >/dev/null'
check "jev: medium 2 (one escalated)" 'echo "$ejson" | jq -e "$jr | select(.label==\"medium\") | .runs == 2 and .escalated_pct == 50" >/dev/null'
check "jev: low 0" 'echo "$ejson" | jq -e "$jr | select(.label==\"low\") | .runs == 0" >/dev/null'
ag='.tables.agy_signals[] | select(.model=="agy/gemini-3.8-flash-high")'
check "agy: 1 run, 0 empty" 'echo "$ejson" | jq -e "$ag | .runs == 1 and .empty == 0" >/dev/null'
check "agy: md_links 1" 'echo "$ejson" | jq -e "$ag | .md_links == 1" >/dev/null'
check "agy: outside_reads 1" 'echo "$ejson" | jq -e "$ag | .outside_reads == 1" >/dev/null'
check "agy: 1 tool error per run" 'echo "$ejson" | jq -e "$ag | .tool_errs_mean == 1" >/dev/null'
check "export has no task text" '! echo "$ejson" | grep -qiE "parser|login|config|staging|deploy|callers|refactor|pipeline"'
check "export has no paths" '! echo "$ejson" | grep -qE "/work|/outside|file://"'
check "export has no session ids or names" '! echo "$ejson" | grep -qE "sess-|sid-|coder-100"'
check "bad flag exits 2" 'bash "$here/bin/cwstats" --bogus 2>/dev/null; [ $? = 2 ]'
tdone=$t/test-empty-done; mkdir -p "$tdone"
tb=20261029-120000-coder-9001
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"sess-X","resume":"","task":"Empty done test task","start":%d,"effort":"medium"}\n' "$recent" > "$tdone/$tb.meta"
: > "$tdone/$tb.done"
check "an empty .done file produces no stderr output" 'CW_LOG_DIR="$tdone" bash "$here/bin/cwstats" --days 1 2>"$tdone/err" >/dev/null; [ ! -s "$tdone/err" ]'
tsess=$t/test-empty-session; mkdir -p "$tsess"
tb1=20261029-120000-coder-9002
tb2=20261029-120500-coder-9003
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"","resume":"","task":"Same task name for escalation check","start":%d,"effort":"medium"}\n' "$recent" > "$tsess/$tb1.meta"
printf '0\n' > "$tsess/$tb1.done"
printf '{"role":"coder","model":"claude-sonnet-5-5","session":"","resume":"","task":"Same task name for escalation check","start":%d,"effort":"high"}\n' "$((recent + 300))" > "$tsess/$tb2.meta"
printf '0\n' > "$tsess/$tb2.done"
check "two runs with empty session, same task, medium then high, are NOT escalated" 'e=$(CW_LOG_DIR="$tsess" bash "$here/bin/cwstats" --days 1 --export); echo "$e" | jq -e "[.tables.by_role_model_effort[].runs] | add == 2" >/dev/null && echo "$e" | jq -e "[.tables.by_role_model_effort[].escalated_pct] | add == 0" >/dev/null'


echo
[ $fails = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
