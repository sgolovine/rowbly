---
title: Add FOO.txt to repo root
stage: DONE
position: 10
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-10
pull_request: https://github.com/sgolovine/rowbly/pull/192
---

## Goal

Add a file `FOO.txt` at the repository root. The file holds the text "this is a test". The author wants a small test change for the factory workflow.

## Scope

In scope:

- Create `FOO.txt` at the repository root with the text `this is a test`.

Not in scope:

- Changes to other files, documentation, tests or the build.

## Acceptance criteria

- [ ] `FOO.txt` exists at the repository root (`test -f FOO.txt`).
- [ ] The content of `FOO.txt` is `this is a test` followed by one newline (`printf 'this is a test\n' | cmp - FOO.txt`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- The file is not TypeScript, so the strict code style and the dash-case name check do not apply to its content. Before you commit, make sure that `pnpm lint` (the dash-case name check) and Knip do not report `FOO.txt`. If a check reports the name, add an exclusion for only this file in the configuration of that check.
- Commit with a Conventional Commit message, for example `chore: add FOO.txt test file`.

## Assumptions

- The file content ends with one newline character. Reason: The repository files end with a newline, and the Story does not ask for a different format.
- The file name stays `FOO.txt` in upper case. Reason: The author gives the exact name. The dash-case rule applies to source files and folders of the code.
