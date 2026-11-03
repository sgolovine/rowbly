# In Progress

A person moves a Story here when it is ready to build. Take it to a draft pull request.

1. Run the `rowbly-dev` skill for the Story. Its Story updates (moving the Story, adding Comments)
   become reported `rowbly` blocks, as the factory's worker rules say; carry on without waiting.
2. **Returned work.** If the Story's latest Comment starts `Returned to In Progress:`, repair that
   work without asking: continue its branch and PR, do not open another. First check that the PR is
   still open and that its branch and head commit are the ones the Comment names; if not, ask, and
   discard nothing. Create your worktree from `origin/<branch>` with a new local branch, merge
   `origin/main`, fix what the Comment lists, run the checks and push with
   `git push -u origin HEAD:<branch>`. If a conflict needs another open PR's or stack layer's intent
   to resolve, ask instead of choosing it.
3. **Other earlier work.** Otherwise, if the Story's Comments or `git branch -r` show a branch or PR
   for it already, ask whether to continue it or start again before you change anything.
4. **Base and Board changes.** Start from the current `origin/main`. Before you plan, and again before
   final validation and the PR, run `git fetch origin` and `git merge origin/main` into the task
   branch. Never rebase or force-push. The supervisor commits Board changes to `main`; never commit
   `.rowbly/` changes on the task branch.
5. **Stacks.** If the Story's Comments or your instructions say it is one layer of a stack, base it on
   the branch of the layer below it (merge that branch in, never rebase), open the PR with
   `--base <branch below>`, and put a "Stack" section listing every layer at the top of the PR
   description. Never merge PRs yourself.
6. **ADR numbers.** Before you open the PR, check `origin/main` and the open PR branches for the ADR
   number you used; another worker may have taken it.
7. **Screenshots.** A change to anything a person sees in the TUI or CLI needs screenshots in the PR,
   uploaded so they display (see `ROWBLY.md` for how on the factory server).
8. **Finish** when the draft PR is open, or the returned PR has your fixes: report a Comment with the
   PR URL, head SHA, validation summary and numbered responses to review findings (for returned work,
   what you fixed). The supervisor records every implementing Run and verified worker/model as an
   Implementation record Comment before the Stage change. Report
   `rowbly stories move <KEY> in-pr`, then `FACTORY-DONE`.