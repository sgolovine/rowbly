# Worker brief

Copy the block below into `$FACTORY_DIR/<KEY>.md` and fill in each `<…>`. Leave out the stack
section unless the Story belongs to a stack. Then add the Epic, if there is one, and the Story's full
text: name, Stage, description, every Story Spec, Tasks and relevant Comments. The worker should not
need to read the Board.

````markdown
/rowbly-dev <KEY>

You are running on the remote server `<server>`, started by a supervisor thread on another computer. That supervisor owns the Rowbly Board. Follow the rowbly-dev skill, with these overrides; they take precedence over the skill:

1. **Do not run any `rowbly` command that changes data** (stories move, comments add, tasks done, and so on), and do not commit or push `.rowbly/` changes. Read-only commands are fine. Each time the skill asks for a Story update, put a block like this in your reply and carry on without waiting:
   ```
   ROWBLY-UPDATE <KEY>
   stage: in-progress | in-pr
   comment: <the Comment text the skill asks for, in one paragraph>
   ```
   The supervisor reads your thread and applies the update.
2. **Get Board updates from main.** The supervisor commits Board changes to `main` and pushes them. Before you plan, and again before final validation and the PR, run `git fetch origin` and merge `origin/main` into your task branch (`git merge origin/main`, no rebase, no force-push). Do not `git pull` in the shared control checkout `~/Projects/rowbly`: other threads on this server use it too.
3. **Story text.** It is below in full, so you do not need to read the Board. <Say what the Story has: Specs, Tasks, Comments, Epic.> Plugins on: <list>. Stages: `todo`, `in-progress`, `in-pr` (In PR), plus done. The supervisor moves the Story to `in-pr` when your PR opens.
4. **Other work in progress.** <Running workers, their Stories, branches and the files they touch; merged PRs to start from; ADR numbers you assign; the base branch if it is not `main`.> Start from the current `origin/main`. Worktrees are under `~/Projects/rowbly-worktrees/`.
5. **Blocking questions.** If the request is materially ambiguous, end your turn with the questions under a line `QUESTIONS FOR USER <KEY>`. The supervisor will send you the answers.
6. **Server load.** This server is shared by up to 4 threads. Keep subagents to the minimum the skill allows, run them one at a time when you can, and do not leave dev servers, watchers or TUIs running.
7. **Screenshots.** The browser upload route doesn't work on this server. Push the PNGs as an orphan commit to a branch named `pr-assets/<your-branch>` (never merged; AGENTS.md's no-screenshot rule covers the task branch and main only). Link them from a PR comment as `https://raw.githubusercontent.com/<owner>/<repo>/pr-assets/<your-branch>/<file>.png`, and check that each URL returns 200.
8. When the draft PR is open, end with a line `DONE <KEY> <PR URL>` and the final report the skill asks for, plus a last ROWBLY-UPDATE block with `stage: in-pr`.
````

## Stack section

Add this as item 9 for each Story in a stack, and send the same text to workers in the stack that are
already running:

````markdown
9. **This Story is one layer of a stack of PRs**, in this order, each based on the branch below it:
   1. <KEY> `<branch>` → base `main`
   2. <KEY> `<branch>` → base `<branch of layer 1>`
   …
   Build your layer on the layer below it: merge the lower branch into yours (no rebase, no force-push), and merge it again whenever it gets new commits. If the lower layer has not pushed yet, work on what does not depend on it, and wait rather than basing on `main`. Open your draft PR with `gh pr create --draft --base <branch below you>`. Put a "Stack" section at the top of the PR body listing every layer in order, and mark which one this PR is. Your diff should hold only your own Story's change. The supervisor merges bottom-up; never merge PRs yourself.
````
