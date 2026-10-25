#!/usr/bin/env bash
# Merge a ready PR, then move its Story to `done` and push `main`.
#
#   merge.sh <pr> <KEY>            # merge when ready; exit 2 and change nothing when not
#   merge.sh --dry-run <pr> <KEY>  # report readiness only
#
# Ready: mergeable and clean, every check passed, and no review requests changes. Run it from the
# control checkout on `main`. FACTORY_ROWBLY and FACTORY_DATA_ROOT work as in the Python scripts.
set -u
dry_run=0
if [ "${1:-}" = --dry-run ]; then dry_run=1; shift; fi
pr=$1 key=$2
rowbly=(${FACTORY_ROWBLY:-pnpm --silent dev})
data_root=${FACTORY_DATA_ROOT:-$(git rev-parse --show-toplevel)/.rowbly}

# GitHub reports UNKNOWN for a while after any push to the base branch. Checks may be pending, or not
# registered yet right after a push to the PR (an empty list).
for _ in $(seq 1 45); do
  state=$(gh pr view "$pr" --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup \
    -q '"\(.mergeable)|\(.mergeStateStatus)|\(.reviewDecision)|\([.statusCheckRollup[] | (if (.conclusion // "") == "" then .status else .conclusion end)] | unique | join(","))"')
  case "$state" in UNKNOWN* | *IN_PROGRESS* | *QUEUED* | *PENDING* | *"|BLOCKED|"* | *"|") sleep 10 ;; *) break ;; esac
done
echo "#$pr $state"
IFS='|' read -r mergeable merge_state review checks <<<"$state"
if [ "$mergeable" != MERGEABLE ] || [ "$merge_state" != CLEAN ] || [ "$review" = CHANGES_REQUESTED ] || [ "$checks" != SUCCESS ]; then
  echo "#$pr NOT READY"
  exit 2
fi
[ $dry_run = 1 ] && { echo "#$pr READY"; exit 0; }

gh pr ready "$pr" >/dev/null 2>&1
gh pr merge "$pr" --merge || exit 1
git pull --rebase -q origin main
"${rowbly[@]}" stories move "$key" done --data-root "$data_root" --json --no-prompt >/dev/null && echo "$key done"
git pull --rebase -q origin main && git push -q origin main && echo "pushed main"
