# Git Plugin: Automatic Commits and Sync

Every command below takes `--json --no-prompt`.

The Git Plugin commits saved Rowbly changes to the git repository that holds the Data Root. Enable it
only when the user asks: future Rowbly writes will create commits.

## 1. Turn it on

The Data Root must be inside a git repository; otherwise `plugins enable git` exits 2 with an
explanation and leaves it off (an enabled Plugin loaded outside git shows as failed in `plugins list`).
Establish a clean Data Root baseline first: commit or stash pending edits under `.rowbly/`, because
edits by hand to an affected path are included in the next Automatic Commit.

```sh
rowbly plugins enable git --json --no-prompt
rowbly git show --json --no-prompt          # current preferences and the defaults they fall back to
```

## 2. Configure it

```sh
rowbly git configure --frequency change --json --no-prompt                  # commit after each change (default)
rowbly git configure --frequency interval --interval 600 --json --no-prompt # batch, at most every 600 s
rowbly git configure --author-name "Rowbly Bot" --author-email "bot@example.com" --json --no-prompt
rowbly git configure --author-name '' --author-email '' --json --no-prompt  # back to git's user.name / user.email
```

- Preferences are personal, under `plugins.git` in Local State (`local.json`): `frequency`
  (`change` or `interval`), `intervalSeconds` (an integer 1–86400, default 300), `authorName`,
  `authorEmail`. Do not edit that file by hand; use `git configure`. They take effect at once and are
  never committed. Enabling the Plugin is still shared Data Root configuration.
- Blank or omitted author fields use git's effective `user.name` and `user.email`, including
  `.gitconfig`; `git show` reports them.

## 3. What it commits

- Each Automatic Commit has the message `chore: update Rowbly data`. It includes the paths that saved
  Rowbly changes affected, deletions and other Plugins' writes included. Local State, locks,
  `.txn/` and atomic-write temporary files are excluded; the Data Root's `.gitignore` is included; git
  ignores still apply.
- Other paths and unrelated staged files stay untouched. An affected path that already has staged
  changes is refused with a warning instead of committed.
- Hooks and commit signing are turned off for Automatic Commits. They never push, create branches or
  install hooks; only Sync pushes (§6).

## 4. When it commits

- Saved changes enter a queue; rapid edits may share a commit. A CLI command waits for the commits that
  are due, but not for a future interval deadline.
- Interval mode starts its deadline at the first pending change and commits only when files changed.
  Timers run only while Rowbly is running: there is no daemon, and nothing is flushed on exit. Pending
  paths persist in git's own directory and are committed by the next Rowbly run once due. Changing the
  interval moves the deadline relative to the first pending change.
- Disabling the Plugin pauses waiting work and keeps the pending paths; a commit already running may
  finish.
- A git failure (missing author, an index lock, a merge in progress) warns, keeps the Rowbly change
  saved, and leaves the work pending for a later run. Fix the cause, then run Rowbly again.

## 5. With doctor

`doctor --fix` repairs are saved changes too. To inspect every repair before the next commit, disable
Git first (`rowbly plugins disable git`), remember that it was on, run the repairs until
`rowbly doctor` exits 0, then `rowbly plugins enable git`. Keep other Plugins on so their checks run.

## 6. Sync (TUI only)

When the Git Plugin is on, the TUI header shows **Sync** (key `S`). There is no `rowbly` command for it:
tell the user to press `S`, or do the same with git yourself (`git pull --rebase`, then `git push`)
only when they ask you to push.

Sync, in order: commits pending Rowbly changes under the Data Root (changed, added and deleted files;
never `local.json`, `.lock`, `.lock.break`, `.txn/` or `.<name>.<8 hex>.tmp`; `.gitignore` is included), only when there are some; fetches;
rebases onto the branch's upstream in a temporary worktree, then moves the branch like `git checkout`,
keeping the user's other staged and unstaged changes; pushes to the upstream, never forced. The header
shows `Sync…` while it runs and `S` does nothing until it ends. The success toast
(`Synced with origin/main · …`) shows only after the push.

Every failure shows an error toast and keeps local commits:

| Toast says | Fix |
| --- | --- |
| HEAD is detached | check out a branch |
| branch … has none (no upstream) | `git push -u origin <branch>` or `git branch --set-upstream-to origin/<branch>` |
| a rebase, merge, cherry-pick or revert is in progress | finish or abort it |
| needs a Git author name and email | `git config user.name` / `user.email`, or `rowbly git configure --author-name … --author-email …` |
| already have staged changes | commit or unstage the staged Rowbly file |
| could not fetch / could not push | the toast quotes git; fix the network or credentials |
| your commits conflict with origin/main in <files> | nothing was pushed and the branch is unchanged; `git pull --rebase`, resolve, then Sync again |
| could not update your working tree | commit or stash the user's change to the named file |
| branch changed / upstream moved during Sync | Sync again |
| Sync is already running | wait for it |

## Common mistakes

- **HIGH: picking `change` when the user asked for commits every N minutes.** Use
  `--frequency interval --interval <seconds>`.
- **MEDIUM: waiting or running a loop for an interval commit.** CLI commands do not wait for a future
  deadline; the next Rowbly run commits it.
- **MEDIUM: enabling it with unrelated edits under `.rowbly/`.** They are swept into the next Automatic
  Commit. Start from a clean baseline.
- **MEDIUM: looking for a `rowbly git sync` command.** There is none; Sync is the TUI's `S`. Never
  force-push to recover from a failed Sync.
