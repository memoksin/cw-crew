# Shared acceptance-output rule. Some runners (Godot) exit 0 on failure; an empty CW_ACCEPT_FAIL_RE disables it.
cw_accept_output_ok() {
  local fre=${CW_ACCEPT_FAIL_RE-'^\s*(FAIL\b(?!:? *0\b)|SCRIPT ERROR)'}
  [ -z "$fre" ] || perl -e '$r = shift; while (<>) { exit 1 if /$r/ }' "$fre" "$@"
}
