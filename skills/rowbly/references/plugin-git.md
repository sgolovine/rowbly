# Git Plugin: Automatic Commits

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
  Rowbly changes affected, deletions and other Plugins' writes included. Local State, locks and
  `.txn/` are excluded; git ignores still apply.
- Other paths and unrelated staged files stay untouched. An affected path that already has staged
  changes is refused with a warning instead of committed.
- Hooks and commit signing are turned off for Automatic Commits. It never pushes, creates branches or
  installs hooks.

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

## Common mistakes

- **HIGH: picking `change` when the user asked for commits every N minutes.** Use
  `--frequency interval --interval <seconds>`.
- **MEDIUM: waiting or running a loop for an interval commit.** CLI commands do not wait for a future
  deadline; the next Rowbly run commits it.
- **MEDIUM: enabling it with unrelated edits under `.rowbly/`.** They are swept into the next Automatic
  Commit. Start from a clean baseline.
