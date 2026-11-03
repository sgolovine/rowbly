# In PR

The Story has a draft PR. Merge it when it is ready, then finish the Story.

1. **Find the PR** in the Story's Comments, or with `gh pr list --search <KEY>`. If there is none, or
   more than one, ask.
2. **Wait for GitHub without polling.** Mergeability reads `UNKNOWN` for a while after any push to
   `main`, and checks may not be registered yet. Do not loop on `gh pr view` or `gh pr checks`; every
   look costs a model turn. Follow `ROWBLY.md` ("Waiting for checks") and the factory skill's
   "Waiting for pull request checks":
   - The supervisor owns the wait. Independent diff review may start and finish while CI is pending;
     do not defer launching or completing it solely because checks are pending. Complete work that
     does not depend on CI first. If remaining work needs the checks, report the PR URL, the exact
     head SHA and each pending check's name, end your turn and let the supervisor resume you. Do not
     start a watch, timer or poller.
   - On any wake or watch exit, read the result once:
     `gh pr view <n> --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision`.
     Use all checks, not `--required`. Confirm the head matches the head being processed; if it
     changed, discard the old result and process the new head. No exit code, including 0, proves
     every check passed.
   - All passed requires a nonempty current-head rollup: every CheckRun is `COMPLETED` with
     conclusion `SUCCESS`, and every StatusContext has state `SUCCESS`. Continue to step 3, with
     ROW-47's independent review and approval gates still required.
   - An actual failed conclusion (`FAILURE`, `TIMED_OUT`, `ACTION_REQUIRED`, or a StatusContext state
     of `FAILURE` or `ERROR`) routes as step 5 says; name the check and its link. Step 5 remains
     ROW-48's failure and return policy.
   - No checks registered yet, pending checks, or an elapsed wait timeout mean waiting: report the
     head SHA and pending names, or ask; never infer failure or route to repair from those alone.
   - `CANCELLED`, `SKIPPED`, `NEUTRAL` or any unrecognized terminal conclusion or state do not establish
     all passed: follow an explicit policy or ask for a decision. An unreadable or unusable PR is
     separate: report the error and ask.
3. **Independent review.** You review this PR; you did not write it. Do it while checks run; it
   does not wait for them.
   - Check the filled Implementation records section appended after the generated brief: it must
     include all verified authoring records and your verified worker/thread/provider/model identity.
     Missing or unknown provenance requires FACTORY-QUESTIONS. You are a new worker whose model
     differs from EVERY implementing model; the same provider is allowed and effort/options alone
     do not count. Check that you are none of their workers and your model is
     none of theirs. If that is not so, or the branch has commits that no record accounts for,
     report `FACTORY-QUESTIONS` and stop. Never push to the branch or edit the PR; you only comment.
   - Note the head SHA (`gh pr view <n> --json headRefOid`). A review Comment that already approves
     this SHA, by a model that differs from every record, still holds: say so and go to step 4.
   - Read `gh pr diff <n>` and the files it touches. Check the change against the Story's
     description, acceptance criteria, Specs and Tasks, and against `AGENTS.md` and the pages it
     names: unmet criteria, bugs, docs or tests `AGENTS.md` requires, unrelated changes. Run a
     command yourself when reading cannot settle a finding.
   - Post the result as a PR comment (`gh pr comment <n> --body-file <file>`) and report the same
     text as a Comment:

     ```text
     Review of <PR URL> at <head SHA> by <provider instance>/<model>: APPROVED.
     <one paragraph: what you checked>
     ```

     or `…: CHANGES REQUESTED.` followed by numbered findings, each with where (`file:line`), what
     is wrong and what would resolve it. List only what must change before the merge; put
     suggestions after them, marked optional.
   - **Changes requested**: return the Story as step 5 says, with the numbered findings.
4. **Merge when approved and ready.** Ready means all of these:
   - a review Comment approves the current head SHA, as step 3 says;
   - mergeable, and the merge state is clean;
   - every check passed;
   - no review requests changes;
   - when the PR changes what a person sees, its screenshot comment shows images that load (check
     each URL with `curl -s -o /dev/null -w '%{http_code}'` for 200).

   Then read `headRefOid` again. If it differs from the approved SHA, the approval no longer holds:
   review the new commits as in step 3 and record a review for the new head. Run `gh pr ready <n>`,
   then `gh pr merge <n> --merge --match-head-commit <approved SHA>` (a merge commit; squash is
   off). If GitHub refuses because the head moved, review again; never merge without
   `--match-head-commit`. If it is the bottom layer of a stack, run `gh pr edit <next layer> --base
   main` afterwards. Check CI on `main` (`gh run list --branch main --limit 4`). Report a Comment
   `Merged <PR URL> at <approved SHA>` and `rowbly stories move <KEY> done`, then `FACTORY-DONE`.

5. **Return to implementation** when the PR targets `main` and any of these holds. Pending checks
   alone never return or fail the Story.
   - a review requests changes (return at once, without waiting for checks): sum up each finding;
   - a check failed, once every check has finished: name each failing check, link its run, and
     quote the failing step's error
     (`gh run view <run id> --log-failed`, the last lines that show it);
   - it conflicts with `main`: list the conflicting files (`git fetch origin`, then
     `git merge-tree --write-tree --name-only --no-messages origin/main origin/<branch>`).

   Report one Comment that starts `Returned to In Progress:` and gives the branch (`headRefName`),
   the PR URL, its head commit (`headRefOid`) and the failure above, then
   `rowbly stories move <KEY> in-progress`, then `FACTORY-DONE`. Do not fix it yourself: a new
   In Progress worker continues that branch and PR. If an earlier `Returned to In Progress:` Comment
   names the same failure at the same head commit, nothing was fixed: ask instead of returning it
   again.
6. **Ask** with `FACTORY-QUESTIONS`, which lands first and how, instead of returning or merging when:
   - the PR is a stack layer (its base is not `main`) and the layer below has not merged;
   - the conflict comes from another open PR or stack layer rather than from `main` alone, or
     resolving it means choosing between this Story's intent and another open PR's.
   Name each PR and file involved. Never pick the other work's intent yourself.
7. `FACTORY-FAILED` only when you cannot read the PR's state (for example `gh` fails), with why.