---
title: Periodic Git push and pull in the factory
stage: IN_REVIEW
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-18
pull_request: https://github.com/sgolovine/rowbly/pull/201
---

Split from ROW-17. Add periodic Git sync to the native factory.

## Goal

The native factory makes canonical commits of `.rowbly/` (`commitCanonicalProject` in `src/services/project-write/project-write.ts`), but it does not push them. The remote branch stays behind, and other machines do not see the board changes. Changes on the remote also do not arrive in the canonical checkout while the factory runs.

After this Story, the factory can push the commits of the canonical branch to its upstream and pull the changes of the upstream at an interval. The user turns push and pull on and off and sets the interval with `rowbly factory configure`. A push or pull failure shows as a factory attention entry and does not stop the factory.

## Scope

In scope:

- New keys in the `git` section of `.rowbly/factory.json`: `push` (boolean), `pull` (boolean) and `syncIntervalSeconds` (integer).
- Validation and read/write of these keys in the `factory-settings` service.
- New flags of `rowbly factory configure` for these keys.
- A new service that does one sync of the canonical checkout (pull, then push) while it holds the Project write lock.
- A timer in the native factory loop that runs the sync at the interval, and attention entries for failures.
- Tests and documentation for the above.

Not in scope:

- The commit author and the commit message settings. ROW-17 adds them.
- The TUI settings for Git. ROW-19 adds them.
- Sync in the external factory supervisor (`skills/factory/scripts/`). Do not change the scripts of the `factory` skill.
- Sync of worker worktrees or Story branches. Only the branch of the canonical checkout is synced.
- Force push, rebase, and automatic repair of merge conflicts.

## Acceptance criteria

- [ ] `getFactorySettings` reads a `factory.json` with `git: { push, pull, syncIntervalSeconds }`. Without the `git` section or without a key, the values are `push: false`, `pull: false` and `syncIntervalSeconds: 300`.
- [ ] `getFactorySettings` throws `ValidationError` if `git.push` or `git.pull` is not a boolean, or if `git.syncIntervalSeconds` is not an integer from 60 to 86400.
- [ ] Other keys in the `git` section (for example the ROW-17 author and message keys) stay in the file after an update of the sync keys. A unit test examines this.
- [ ] `rowbly factory configure --git-push --git-pull --git-sync-interval 120 --json` writes `git.push: true`, `git.pull: true` and `git.syncIntervalSeconds: 120`, and prints the settings. `--no-git-push` and `--no-git-pull` write `false`. A flag that is not given does not change its key. A CLI test examines this.
- [ ] `rowbly factory configure --git-sync-interval 10` fails with exit code 1 and a `VALIDATION` error. `factory.json` does not change.
- [ ] The sync service, with pull on, fast-forwards the canonical branch to its upstream. A test with a local bare remote examines this.
- [ ] With pull on and a branch that has diverged from its upstream, the service merges the upstream with `--no-edit`. If the merge has a conflict, the service runs `git merge --abort`, the checkout is as before the sync, and the result is a `pull` failure. A test examines this.
- [ ] The sync service, with push on and local commits that the upstream does not have, runs `git push` without force. After the sync, `git rev-list @{u}..HEAD` is empty. A test with a local bare remote examines this.
- [ ] With push off and pull off, the sync service runs no Git command.
- [ ] A branch with no upstream, a detached HEAD, a network failure or a rejected push gives a failure result. The service does not throw.
- [ ] The sync takes the Project write lock with `projectWrite`. It does not run while the factory holds the state lock.
- [ ] While the native factory runs, a sync runs one time after start and then each `syncIntervalSeconds`. A new interval in `factory.json` applies from the next scan. Only one sync runs at a time. A factory-manager test with fake timers examines this.
- [ ] A push failure sets the attention entry `push`, and a pull failure sets the attention entry `pull`. The text has the Git error, limited to 500 characters. The factory continues to run. A successful push removes the `push` entry, and a successful pull removes the `pull` entry. A factory-manager test examines this.
- [ ] Factory status, help, doctor and board paths do not load Pi because of this change.
- [ ] `docs/architecture/native-factory/controls.md` and the native factory documentation describe the new settings, flags and attention keys, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Settings: `src/services/factory-settings/factory-settings.ts`. Add an optional `git` object to `FactorySettings`, and validate it in `validate`. `updateFactorySettings` merges the input shallowly. Merge the `git` object one level deep, so that other `git` keys stay. If ROW-17 merged first and added the `git` section, extend its type and validation. Do not make a second section.
- CLI: `src/commands/factory/factory.ts`, `registerConfigure`. Add `--git-push`, `--no-git-push`, `--git-pull`, `--no-git-pull` and `--git-sync-interval <seconds>`. Commander gives `undefined` when neither the positive nor the negative flag is given, because both are defined. Pass the values to `configureFactory`. The command stays thin.
- Sync service: add `src/services/project-sync/project-sync.ts` and `project-sync.test.ts`. Export one function, for example `syncCanonicalProject(root, { push, pull })`. It returns `{ pull?: SyncStep; push?: SyncStep }`, where a `SyncStep` is `{ status: "ok" | "skipped" | "failed"; detail?: string }`. Use `execFile("git", ["-C", root, ...])` with `shell: false` and a timeout of 120 seconds for each Git command, like `skills/factory/scripts/commit-project.mjs`. Run the steps inside `projectWrite(root, ...)` from `src/services/project-write/project-write.ts`.
- Pull steps: `git symbolic-ref -q HEAD` (no branch: failure), `git rev-parse --abbrev-ref @{u}` (no upstream: failure), `git fetch`, then `git merge --ff-only @{u}`. If the fast-forward is not possible, `git merge --no-edit @{u}`. On a merge failure, `git merge --abort`.
- Push steps: if `git rev-list --count @{u}..HEAD` is 0, the step is `skipped`. Else `git push`. Do not use `--force`.
- Order in one sync: pull, then push. Push runs also if pull failed, because the push of local commits does not need the pull. A rejected push is a failure.
- Factory loop: `src/services/factory-manager/supervisor-loop.ts`. `superviseUntilStopped` already starts a 30-second `timer`. Add a sync step that runs when `Date.now()` is at or after the next sync time. Keep the next sync time and a `syncing` flag in `ManagerState` (`src/services/factory-manager/manager-state.ts`). Do not run the sync inside `serial`, because a network command can take 120 seconds and must not stop the reconcile. Read the settings from the `settings` value that `refreshSettings` keeps. Clear the timer in `factory-shutdown.ts` if you add a new timer.
- Attention: use `withEntry(state.attention, "push" | "pull", { text })` and `withoutEntries` from `src/services/store/store.js`, like `commitProject`. Then persist the status with `persistStatus`.
- Safety: the sync works on the canonical checkout. `.rowbly/state.json*` and `.rowbly/runtime/` are in `.rowbly/.gitignore`, so a merge does not change them. Never take the Project write lock while the state lock is held.
- Do not import `commander`, `ink`, `react` or Pi in the new service.
- Docs: `docs/architecture/native-factory/controls.md` (the `factory configure` row), `docs/architecture/native-factory/README.md` or `runtime-and-locks.md` (the sync and the lock), and `recovery.md` if it lists attention keys.

## Assumptions

- Push and pull are off by default. Reason: a push changes the remote, and a user must turn it on. This is the smallest scope and keeps the current behaviour.
- The default interval is 300 seconds, and the limits are 60 to 86400 seconds. Reason: the Story gives no value. 5 minutes keeps the remote current without many network calls.
- The keys are `git.push`, `git.pull` and `git.syncIntervalSeconds` in the `git` section that ROW-17 adds. If ROW-17 is not merged, this Story creates the `git` section. Reason: ROW-17 is not refined and has no code yet. The two Stories must use one section.
- The push sends all commits of the current branch of the canonical checkout to its upstream, not only the factory commits. Reason: Git cannot push only some commits of one branch without a rewrite of history.
- A pull uses a fast-forward, and a merge (`--no-edit`) when the branches diverged. It does not rebase. Reason: the Git history of this repository has merge commits from `git pull`, and a rebase changes commits that a person can have pushed.
- A merge conflict stops the pull with `git merge --abort` and an attention entry. Reason: automatic conflict repair can lose user data.
- The sync does not stash or change uncommitted user files. If Git refuses the merge because of a dirty file, the pull is a failure. Reason: the canonical checkout can hold the work of a person.
- A success removes the attention entry of the same key. Reason: an old failure must not stay after the problem is solved. The `commit` entry keeps its current behaviour.
- The flag names are `--git-push`, `--no-git-push`, `--git-pull`, `--no-git-pull` and `--git-sync-interval`. Reason: they agree with the `git` section name and the Commander negation pattern.

- After the merge of ROW-17, `getFactorySettings` gives the sync defaults in the returned `git` object, but a write does not add the defaults to `factory.json`. Reason: AC 1 asks for the default values, and the ROW-17 rule that an empty `git` section goes away from the file stays true.
- `updateFactorySettings` merges `git` one level deep. `configureFactory` uses the ROW-17 `mergeGit`, so that `--commit-message ""` removes the key and the old value does not come back. Reason: one merge function for the configure flags.

## Review findings

1. **Merge conflict with `main`.** PR #201 cannot merge. ROW-17 (PR #200, commit `cbb51324`) merged into `main` after this branch was made. It adds the `git` section with its own `GitSettings` type, `validGit`, `mergeGit`, `hasGitInput` and `GitInput` in `src/services/factory-settings/git-settings.ts`. Git reports conflicts in `docs/architecture/native-factory/controls.md`, `docs/architecture/native-factory/pi-runtime-and-auth.md`, `src/commands/factory/factory.ts`, `src/services/factory-manager/factory-manager.test.ts` and `src/services/factory-settings/factory-settings.ts` (also `supervisor-loop.ts` and `factory-settings.test.ts` changed on both sides). Fix: merge `origin/main` into `story/ROW-18`. As the technical notes say, extend the ROW-17 `git` section, its type and its validation in `git-settings.ts` with `push`, `pull` and `syncIntervalSeconds`. Do not make a second `GitSettings` type or a second `validGit`. Keep the ROW-17 author and message keys and the ROW-17 `configure` flags. Make sure that the unit test for other `git` keys uses the real ROW-17 keys. Then run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` again.
   **Repaired** in commit `ed82391f`: `origin/main` is merged, and the sync keys extend the ROW-17 `git-settings.ts`.

The code review found no other blocking problem. Before the conflict, all acceptance criteria were satisfied, CI passed, and the local checks passed. The non-blocking findings are in a comment on PR #201.
