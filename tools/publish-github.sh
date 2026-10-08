#!/usr/bin/env bash
# Put this repo on GitHub as its own repository (a spin-off of Dankcode/vibe-game) and push every branch.
# GitHub can't fork a repository into the account that already owns it, so this game lives in its own repo and
# names vibe-game as its upstream in the description and README.
#
#   tools/publish-github.sh [owner/name] [--public]
# Needs the GitHub CLI signed in (gh auth login). Default: Dankcode/voxel-tactics, private.
set -euo pipefail
REPO="${1:-Dankcode/voxel-tactics}"
VISIBILITY="--private"; [[ "${2:-}" == "--public" ]] && VISIBILITY="--public"
cd "$(dirname "$0")/.."
if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create "$REPO" $VISIBILITY --source=. --remote=origin \
    --description "Fireteam: present-day XCOM 2-style co-op tactics in three.js on a destructible voxel grid. Spun off from Dankcode/vibe-game."
fi
git push -u origin main
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/); do [[ "$b" == main ]] || git push origin "$b"; done
echo "Pushed to https://github.com/$REPO"
