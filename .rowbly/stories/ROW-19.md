---
title: Factory Git settings in the TUI
stage: IN_DEVELOPMENT
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-19
pull_request: https://github.com/sgolovine/rowbly/pull/203
---

Split from ROW-17. Show and edit the factory Git settings in the TUI settings.

## Goal

ROW-17 adds the commit author and the commit message of the canonical factory commits. ROW-18 adds periodic push, periodic pull and the sync interval. Both keep the values in the `git` section of `.rowbly/factory.json` and set them with `rowbly factory configure`. The user can not see or change these values in the TUI now.

After this Story, the Settings Modal has a Git section in the Factory group. It shows the commit author, the commit message, periodic push, periodic pull and the sync interval. The user can change each value there. The TUI calls the same `factory-settings` service as `rowbly factory configure`.

## Scope

In scope:

- A new Settings section `Git` (id `git`) in the `Factory` group of `SETTINGS_GROUPS` (`src/tui/screens/settings/settings-sections.ts`), after `AI`.
- One card for each value: Commit author, Commit message, Periodic push, Periodic pull, Sync interval. Each card shows the current value or the default, and has an edit Button with a key.
- An edit task for each value (a `FormModal`), and a direct toggle for push and pull.
- A clear operation for the author and the message (an empty value), so that the factory uses the default again.
- Tests for the new section and its components, and the update of `docs/architecture/tui.md`.

Not in scope:

- The `git` section, its validation, the CLI flags, the commit and the sync behaviour. ROW-17 and ROW-18 add them.
- Changes to the AI section and its tabs.
- Git settings for worker commits on Story branches.
- An immediate sync from the TUI ("sync now").

## Acceptance criteria

- [ ] The Settings Modal shows a `Git` entry in the `Factory` group, under `AI`. A `renderTui` or section test examines this.
- [ ] The Git section shows five cards with the current values of `factory.json`: the author as `Name <email>`, the commit message, push `on`/`off`, pull `on`/`off`, and the interval in seconds. Without a value, a card shows the default (`Git config identity`, `chore(rowbly): record project changes after scan`, `off`, `off`, `300 seconds`). A component test examines this with and without a `git` section.
- [ ] The edit of the author with `Name <email@example.com>` writes `git.authorName` and `git.authorEmail`. A value that is not in the `Name <email>` form shows the validation error in the form, and `factory.json` does not change. A test examines both cases.
- [ ] The edit of the commit message writes `git.commitMessage`. An empty author or an empty message removes the value from `factory.json`. A test examines this.
- [ ] The push and pull keys toggle `git.push` and `git.pull`. A test examines that the file changes and that the card shows the new value.
- [ ] The edit of the sync interval writes `git.syncIntervalSeconds`. A value out of the range of ROW-18 (60 to 86400) or not a whole number shows a validation error, and the file does not change. A test examines this.
- [ ] Each change keeps all other keys of `factory.json` and of its `git` section. A test examines this.
- [ ] After a save, a toast confirms the change and `onChange` is called.
- [ ] The Git section does not load Pi or `agent-auth` at runtime. A test or a code review examines that the section does not call `loadRuntime` and that the save path does not start the auth runtime.
- [ ] The section shows its keys in the hint strip with `useKeyHints`. A test examines this.
- [ ] `docs/architecture/tui.md` names the Git section, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Dependencies: ROW-17 (author and message: `git.commitMessage`, `git.authorName`, `git.authorEmail`, `src/services/factory-settings/git-settings.ts` with `parseAuthor`, `formatAuthor`, `mergeGit`) and ROW-18 (`git.push`, `git.pull`, `git.syncIntervalSeconds`, defaults and validation). Start this Story after both are merged to `main`, or rebase on them. Use their types and functions. Do not add a second `git` section or a second validation.
- Save path: call `configureFactory` from `src/services/factory-settings/factory-settings.ts` with only the Git inputs (`commitMessage`, `commitAuthor`, and the push, pull and interval inputs of ROW-18). With only Git inputs, `configureFactory` must not start the auth runtime (ROW-17 acceptance criterion). If `configureFactory` still imports `agent-auth` before it knows that no model is given, move that import after the Git-only check, or add a small Git-only service function (for example `configureGit(input, ctx)`) in `factory-settings` that the CLI and the TUI both use. Keep the parse of `Name <email>` in the service.
- Read path: `getFactorySettings(ctx)` with `useAsync`, as `use-ai-section.ts` does.
- Pattern to copy: the AI section, Limits tab. `src/tui/screens/settings/ai-limits-page/` (cards), `ai-setting-card/` (the card), `ai-task/` (a `FormModal` on top), `ai-section/ai-actions.ts` (`saveLimit`, toast, `finishTask`). Do not import from `ai-section` internals; if the card is needed, move `AiSettingCard` to a shared name (for example `setting-card/`) or use it from its `index.ts`.
- New files, for example `src/tui/screens/settings/git-section/` (`git-section.tsx`, `use-git-section.ts`, `git-actions.ts`, `git-view.ts`, tests, `index.ts`). Dash-case names, `.js` import extensions.
- Keys (suggested, visible in the hints): `a` author, `m` message, `p` push, `u` pull, `i` interval. Each card has the same Button.
- Errors: a `ValidationError` from the service shows in the form through the issue path, as `saveLimit` does.
- Follow the `rowbly-tui-design` and `rowbly-code-style` skills. Use only `theme` colours and components from `src/tui/components/`.

## Assumptions

- The Git settings get their own Settings section in the Factory group, not a new tab of the AI section. Reason: the AI section loads Pi when it opens, and the Git settings do not need Pi. A separate section keeps Pi off this path.
- Push and pull change with one key or Button click (a toggle), and the author, the message and the interval change in a `FormModal`. Reason: this is the smallest UI and agrees with the existing Limits card and form.
- The author is one `Name <email>` text field. Reason: ROW-17 uses this form in the CLI and parses it in the service.
- An empty author or message clears the value. Reason: ROW-17 defines `""` as the clear operation of the CLI.
- The defaults that the cards show are the defaults of ROW-17 and ROW-18 (Git config identity, the fixed message, push off, pull off, 300 seconds). Reason: those Stories define them. If they change in development, the cards show the merged values.
- This Story waits for ROW-17 and ROW-18 in development order but is not blocked. Reason: both are refined and in development, and their settings shape is fixed in their descriptions and in the ROW-17 worktree.
- (Development) The branch `story/ROW-19` merges `origin/story/ROW-18`, because ROW-18 was not merged to `main`. The Story permits a rebase on ROW-17 and ROW-18. Merge PR #201 (ROW-18) before PR #203.
- (Development) A new Git-only service function `configureGit(input, ctx)` in `factory-settings` saves the Git values. It does not import `agent-auth`. `configureFactory` and the CLI did not change. Reason: this is the smallest change that keeps the auth runtime off the TUI save path.
- (Development) The default commit message is `DEFAULT_COMMIT_MESSAGE` in `git-settings.ts`. A test compares it with the text of `commit-project.mjs`.
- (Development) The hints are `a author`, `m message`, `p toggle push`, `u toggle pull`, `i interval`. Reason: with longer text, the strip did not show all five hints at 100 columns.
- (Development) The push and pull cards have a `Toggle` Button. The other cards have an `Edit` Button. The section uses `AiSettingCard` from its `index.ts`.

## Review findings

1. The pull request has conflicts with the base branch. GitHub reports PR #203 as `CONFLICTING`, and `gh pr merge 203 --merge` failed with "the merge commit cannot be cleanly created". The branch has two merge bases with `main` (`ed82391f` and `d6c902f4`), because `main` merged ROW-17 (#200) and ROW-18 (#201) separately from the merges in `story/ROW-19`. GitHub uses the base `d6c902f4` and finds conflicts in `src/services/factory-settings/factory-settings.ts`, `factory-settings.test.ts`, `git-settings.ts` and `git-settings.test.ts`. Fix: merge `origin/main` into `story/ROW-19` (a local `git merge origin/main` resolves with no conflicts), run the checks again, and push. Then GitHub must report the pull request as mergeable.

Notes that are not blocking:

- All acceptance criteria are satisfied in the code and the tests. `pnpm lint`, `pnpm typecheck` and `pnpm build` pass. `pnpm test` had one or two timing failures in each full run, in files that the pull request does not change (`threads-tab.test.tsx`, `factory-view.test.tsx`, `shell.test.tsx`). Each file passes when it runs alone.
- The branch has the canonical commit `de30817e` (`chore(rowbly): record project changes after scan`) that is not on `origin/main`. It changes `.rowbly/stories/ROW-18.md`. The canonical `main` already has this commit, so the effect is small.
