#!/usr/bin/env bash
# cwwt lifecycle in a disposable repo; no model calls.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
unset CW_WT_ROOT
mkdir -p "$t/repo with spaces"
cd -P "$t/repo with spaces"
git init -q -b main
git config user.email t@t
git config user.name t
printf 'one\n' > a.txt
printf 'cache/' > .gitignore
git add . && git commit -qm init
printf 'two\n' >> a.txt
printf 'new\n' > untracked.txt
mkdir cache; printf 'cached\n' > cache/data

wt=$("$here/bin/cwwt" create first -K .)
[ "$wt" = "$PWD/.crew/first" ]
grep -qxF '/.crew/' .gitignore
git check-ignore -q .crew/first
[ "$(cat "$wt/a.txt")" = "$(cat a.txt)" ]
[ -f "$wt/untracked.txt" ] && [ -f "$wt/cache/data" ]
[ ! -e "$wt/.crew" ]
[ -z "$("$here/bin/cwwt" diff first)" ]
printf 'worker\n' > "$wt/worker.txt"
"$here/bin/cwwt" diff first | grep -q '^+worker'
"$here/bin/cwwt" apply first
[ -f worker.txt ]
[ -z "$("$here/bin/cwwt" diff first)" ]
[ "$("$here/bin/cwwt" create first)" = "$wt" ]
[ "$(grep -cxF '/.crew/' .gitignore)" = 1 ]
(cd "$wt" && [ "$("$here/bin/cwwt" path first)" = "$wt" ])
"$here/bin/cwwt" list | grep -qF "$wt"
second=$("$here/bin/cwwt" create second -K .)
[ ! -e "$second/.crew" ]
[ -z "$("$here/bin/cwwt" diff second)" ]
"$here/bin/cwwt" rm second
"$here/bin/cwwt" rm first
[ ! -d "$wt" ] && [ ! -f .crew/.first.base ]
for name in . ..; do
  if "$here/bin/cwwt" create "$name" >/dev/null 2>&1; then
    echo "FAIL: accepted $name"; exit 1
  fi
done
custom=$(CW_WT_ROOT="$t/custom" "$here/bin/cwwt" create custom)
[ "$custom" = "$t/custom/custom" ]
CW_WT_ROOT="$t/custom" "$here/bin/cwwt" rm custom
mkdir "$t/no-ignore"; cd -P "$t/no-ignore"
git init -q -b main
git config user.email t@t
git config user.name t
printf 'one\n' > a.txt
git add . && git commit -qm init
wt=$("$here/bin/cwwt" create fresh)
grep -qxF '/.crew/' .gitignore
grep -qxF '/.crew/' "$wt/.gitignore"
[ -z "$("$here/bin/cwwt" diff fresh)" ]
"$here/bin/cwwt" rm fresh
echo 'all ok: cwwt default location, ignore, copy, diff, apply, reuse, lookup, cleanup and override'
