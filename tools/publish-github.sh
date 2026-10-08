#!/usr/bin/env bash
# Put this repo on GitHub and push every branch.
#
#   tools/publish-github.sh <owner/name> [--public]
#
# Works with a repo that already exists on GitHub (for example one created in the web UI with a README or licence):
# its history is merged in (our files win on conflicts) before pushing. If the repo doesn't exist it is created
# (private unless --public). Needs git; creating a repo also needs the GitHub CLI signed in (gh auth login).
set -euo pipefail
REPO="${1:?usage: tools/publish-github.sh owner/name [--public]}"
VISIBILITY="--private"; [[ "${2:-}" == "--public" ]] && VISIBILITY="--public"
URL="https://github.com/$REPO.git"
cd "$(dirname "$0")/.."
git checkout -q main
if git remote get-url origin >/dev/null 2>&1; then git remote set-url origin "$URL"; else git remote add origin "$URL"; fi
if git ls-remote --exit-code origin >/dev/null 2>&1 || git ls-remote origin >/dev/null 2>&1; then
  # The repo exists. If it already has commits (README, licence), merge them in under ours.
  if [ -n "$(git ls-remote --heads origin 2>/dev/null)" ]; then
    DEFAULT="$(git ls-remote --symref origin HEAD | awk '/^ref:/ {sub("refs/heads/","",$2); print $2}')"
    DEFAULT="${DEFAULT:-main}"
    git fetch -q origin "$DEFAULT"
    if ! git merge-base --is-ancestor "origin/$DEFAULT" main 2>/dev/null; then
      git merge -q --allow-unrelated-histories -X ours -m "Merge GitHub's initial $DEFAULT into the game history" "origin/$DEFAULT"
    fi
  fi
else
  command -v gh >/dev/null || { echo "Repo $REPO not found and the GitHub CLI isn't installed; create it on github.com first."; exit 1; }
  gh repo create "$REPO" $VISIBILITY \
    --description "Fireteam: present-day XCOM 2-style co-op tactics in three.js on a destructible voxel grid. Spun off from Dankcode/vibe-game."
fi
git push -u origin main
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/); do [[ "$b" == main ]] || git push origin "$b"; done
echo "Pushed to https://github.com/$REPO"
