#!/usr/bin/env bash
# ===== RELEASE — bump version, log it, push to main, save restore branch release/vX.Y.Z =====
# usage: scripts/release.sh 1.1.0 "what changed"
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $# -eq 2 && "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'usage: release.sh X.Y.Z "note"'; exit 1; }
v="$1"; tag="release/v$v"
git fetch -q origin 2>/dev/null || true
git rev-parse -q --verify "refs/remotes/origin/$tag" >/dev/null && { echo "$tag already exists"; exit 1; }
prev=$(grep -oP "VERSION = '\K[^']+" js/config.js)
sed -i "s/VERSION = '[^']*'/VERSION = '$v'/" js/config.js sw.js
[[ -f CHANGELOG.md ]] && back="previous: v$prev (rollback: scripts/rollback.sh $prev)" || { back="first release"; : > CHANGELOG.md; }
printf '## %s — %s\n- %s\n- %s\n\n' "$v" "$(date +%F)" "$2" "$back" | cat - CHANGELOG.md > CHANGELOG.tmp && mv CHANGELOG.tmp CHANGELOG.md
git add -A js/config.js sw.js CHANGELOG.md
git commit -qm "release v$v: $2"
git push -q origin HEAD:main "HEAD:refs/heads/$tag"
echo "released v$v (was v$prev)"
