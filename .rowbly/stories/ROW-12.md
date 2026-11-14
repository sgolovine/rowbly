---
title: "Chore: Revert test changes"
stage: DONE
position: 11
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-12
pull_request: https://github.com/sgolovine/rowbly/pull/194
---

Revert all test changes in this PR: https://github.com/sgolovine/rowbly/pull/192

## Goal

Pull request #192 (ROW-10, merge commit `56e67cbf`, code commit `1a64feac`) added a test file to examine the factory workflow. The test is complete. Remove the test changes so that the repository is the same as before the test.

## Scope

In scope: revert the changes of commit `1a64feac`:

- Delete `FOO.txt` at the repository root.
- In `scripts/check-names.mjs`, remove the `FOO.txt` comment line and the `/^FOO\.txt$/` entry from `IGNORED_PATHS`.
- In `scripts/check-names.test.mjs`, remove the `"FOO.txt"` entry from the accepted paths and the `"src/FOO.txt"` entry from the rejected paths.

Not in scope:

- The `.rowbly/` files of PR #192 (`.rowbly/.gitignore`, `.rowbly/factory.json`, `.rowbly/stories/ROW-10.md`). They are Project data and factory configuration, not test changes.
- Other changes to `scripts/check-names.mjs` or its tests.

## Acceptance criteria

- [ ] `test ! -e FOO.txt` passes at the repository root.
- [ ] `git grep -n FOO -- scripts/check-names.mjs scripts/check-names.test.mjs` finds nothing.
- [ ] `git diff 1a64feac~1 -- scripts/check-names.mjs scripts/check-names.test.mjs FOO.txt` on the branch shows no difference (the files are the same as before PR #192).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- The simplest method is `git revert --no-commit 1a64feac` on a branch from `origin/main`, then a Conventional Commit, for example `chore: revert FOO.txt test file (ROW-12)`. Commit `1a64feac` touches only `FOO.txt`, `scripts/check-names.mjs` and `scripts/check-names.test.mjs`, so the revert does not touch `.rowbly/`.
- Base the branch on `origin/main`. The merge of PR #192 is on `origin/main`. A local `main` that does not contain `56e67cbf` does not contain the change.
- `pnpm lint` runs `scripts/check-names.mjs`. With `FOO.txt` deleted, the dash-case check does not need the exclusion.
- `pnpm test` runs the node:test suite of `scripts/`, which includes `scripts/check-names.test.mjs`.
- `pnpm test:factory` is not necessary. The change does not touch `skills/factory/scripts/`.

## Assumptions

- "Test changes" means all changes that PR #192 made for the factory test: `FOO.txt`, the name-check exclusion and its test cases. Reason: the PR adds `FOO.txt` only to test the factory workflow, and the exclusion and test cases exist only for `FOO.txt`.
- Keep the `.rowbly/` files of PR #192. Reason: they are Project data and factory configuration that the factory continues to use, and the agent rules forbid commits of canonical `.rowbly/` changes from worker branches.
