# In PR

The Story has a draft PR. Merge it when it is ready, then finish the Story.

1. **Find the PR** in the Story's Comments, or with `gh pr list --search <KEY>`. If there is none, or
   more than one, ask.
2. **Wait for GitHub.** Mergeability reads `UNKNOWN` for a while after any push to `main`, the
   supervisor's Board commits included, and checks may not be registered yet. Wait until
   `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup,reviewDecision` settles and
   every check has finished.
3. **Ready** means all of these:
   - mergeable, and the merge state is clean;
   - every check passed;
   - no review requests changes;
   - when the PR changes what a person sees, its screenshot comment shows images that load (check
     each URL with `curl -s -o /dev/null -w '%{http_code}'` for 200).
4. **When ready**: `gh pr ready <n>`, then `gh pr merge <n> --merge` (a merge commit; squash is off).
   If it is the bottom layer of a stack, run `gh pr edit <next layer> --base main` afterwards. Check
   CI on `main` (`gh run list --branch main --limit 4`). Report a Comment `Merged <PR URL>` and
   `rowbly stories move <KEY> done`, then `FACTORY-DONE`.
5. **Not ready**:
   - A review requests changes: report a Comment that sums up the review and
     `rowbly stories move <KEY> in-progress`, then `FACTORY-DONE`. The factory builds it again.
   - A check failed: `FACTORY-FAILED` with the failing check's name.
   - A conflict with `main`, or with an open PR of the user's, or a stack layer whose lower layer has
     not merged: `FACTORY-QUESTIONS`, asking which lands first.