---
title: Supervisor should auto-commit changes to Rowbly board.
stage: DONE
position: 6
worktree: /home/sgolovine/.t3/worktrees/rowbly/row-06-in_development
pull_request: https://github.com/sgolovine/rowbly/pull/186
---

## Goal

The factory supervisor must commit changes to the Rowbly Project as the changes occur.
The repository must keep a record of the Project state during factory work.

## Scope

Update the factory supervisor instructions in `skills/factory/SKILL.md`.
Define when the supervisor commits Project changes and which changes it includes.
Use the canonical Project checkout for these commits.

Do not add automatic Git commits to Rowbly services, CLI commands or the TUI.
Do not push commits or change Stage prompts or Project configuration.
Do not commit source changes, worker records or other files outside `.rowbly/` through this behavior.

After each scan, commit all pending `.rowbly/` changes, including changes from workers and people.
Include new files, changed files and deleted files that Git does not ignore.

## Acceptance criteria

- [ ] After each scan, the supervisor commits all pending `.rowbly/` changes from workers and people.
- [ ] The commit includes new files, changed files and deleted files that Git does not ignore.
- [ ] The supervisor commits eligible changes in the canonical Project checkout, including changes from workers in separate worktrees.
- [ ] Each commit contains only the eligible Project files. Unrelated files and staged changes stay outside the commit.
- [ ] The supervisor serializes its Git mutations with other writers in the canonical checkout.
- [ ] The supervisor creates no empty commit when the eligible Project files have no changes.
- [ ] Each commit uses a Conventional Commit message that identifies the Project change.
- [ ] If the Project has no Git repository, the supervisor reports that automatic commits are unavailable.
- [ ] If a commit fails, the supervisor reports the command failure and preserves all Project changes.
- [ ] The instructions state how the supervisor handles concurrent worker commits without duplicate commits or lost changes.

## Technical notes

`skills/factory/SKILL.md` defines the supervisor procedure and its worker message.
It currently has no procedure for Git commits.
`skills/factory/scripts/watch-stages.mjs` emits the current Stories at startup and on each scan.
The scanner does not assign workers or write Project files.
Rowbly commands do not run Git.

`skills/` contains the bundled skills that the package distributes.
`.agents/skills/factory/` contains a separate installed copy, not a symlink to the bundled skill.
Examine repository instructions before a change to either copy.

A worker uses `rowbly -C <root> --json ...` to change the canonical Project.
Its worktree has a separate `.rowbly/` copy that it must not change.
Repository instructions currently tell workers to commit their own changed files.
The new supervisor procedure must state how it works with that rule.
Use explicit paths when a command stages files.
Do not reset, discard or amend another worker's changes.

Validate the procedure with new files, changed files, deleted files and changes from people.
Also test no changes, unrelated staged files and a failed commit.
If scripts change, add behavior tests and run `pnpm test:factory`.
Run the checks that AGENTS.md specifies.
