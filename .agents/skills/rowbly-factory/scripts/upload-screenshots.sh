#!/usr/bin/env bash
# Publish PNG screenshots for a PR on a `pr-assets/<task-branch>` branch: one orphan commit that holds
# only the images, never merged. Prints each image's raw URL and its HTTP status.
#
#   upload-screenshots.sh <task-branch> <image.png>...
#
# Look at every image first: readable, demo data only, no secrets. Run it from any checkout of the
# repository; it does not touch the working tree.
set -eu
branch="pr-assets/$1"; shift
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
tree=$(for f in "$@"; do printf '100644 blob %s\t%s\n' "$(git hash-object -w "$f")" "$(basename "$f")"; done | git mktree)
commit=$(git commit-tree "$tree" -m "chore: screenshots for $branch")
git push -q origin "${commit}:refs/heads/${branch}"
for f in "$@"; do
  url="https://raw.githubusercontent.com/$repo/$branch/$(basename "$f")"
  echo "$(curl -s -o /dev/null -w '%{http_code}' "$url") $url"
done
