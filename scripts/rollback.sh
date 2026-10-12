#!/usr/bin/env bash
# ===== ROLLBACK — restore app files of release/vX.Y.Z as a NEW release (history never rewritten) =====
# sql/ and supabase/ are never rolled back here: schema/server only move forward (redeploy the function by hand if needed).
# usage: scripts/rollback.sh 1.0.0
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $# -eq 1 ]] || { echo "usage: rollback.sh X.Y.Z"; exit 1; }
git fetch -q origin
ref="origin/release/v$1"
git rev-parse -q --verify "$ref" >/dev/null || { echo "no release v$1"; git branch -r | grep release/; exit 1; }
scope=(. ':!CHANGELOG.md' ':!scripts' ':!sql' ':!supabase' ':!js/config.js')
IFS=. read -r a b c <<< "$(grep -oP "VERSION = '\K[^']+" js/config.js)"
git diff --name-only --diff-filter=A "$ref" HEAD -- "${scope[@]}" | xargs -r git rm -q
git checkout "$ref" -- "${scope[@]}"
git add -A -- "${scope[@]}"
exec scripts/release.sh "$a.$b.$((c + 1))" "rollback to v$1"
