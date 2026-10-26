# In Progress

A person moves a Story here when it is ready to build. Take it to a draft pull request.

1. Run the `rowbly-dev` skill for the Story. Its Story updates (moving the Story, adding Comments)
   become reported `rowbly` blocks, as the factory's worker rules say; carry on without waiting.
2. **Earlier work.** If the Story's Comments or `git branch -r` show a branch or PR for it already,
   ask whether to continue it or start again before you change anything.
3. **Base and Board changes.** Start from the current `origin/main`. Before you plan, and again before
   final validation and the PR, run `git fetch origin` and `git merge origin/main` into the task
   branch. Never rebase or force-push. The supervisor commits Board changes to `main`; never commit
   `.rowbly/` changes on the task branch.
4. **Stacks.** If the Story's Comments or your instructions say it is one layer of a stack, base it on
   the branch of the layer below it (merge that branch in, never rebase), open the PR with
   `--base <branch below>`, and put a "Stack" section listing every layer at the top of the PR
   description. Never merge PRs yourself.
5. **ADR numbers.** Before you open the PR, check `origin/main` and the open PR branches for the ADR
   number you used; another worker may have taken it.
6. **Screenshots.** A change to anything a person sees in the TUI or CLI needs screenshots in the PR,
   uploaded so they display (see `ROWBLY.md` for how on the factory server).
7. **Finish** when the draft PR is open: report a Comment with the PR URL and a one-paragraph
   summary, and `rowbly stories move <KEY> in-pr`, then `FACTORY-DONE`.