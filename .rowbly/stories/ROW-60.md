---
title: Set and show Story dependencies in the CLI
stage: IN_REFINEMENT
position: 3
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-60
pull_request: null
---

## Goal

Users and agents can set and see the dependencies of a Story with the CLI.

## Scope

- `rowbly story create --depends-on <ids>` and `rowbly story update <id> --depends-on <ids>`. The value is a comma-separated list, and the flag is repeatable. On update, the list replaces the old list. `--depends-on ""` removes all dependencies.
- `rowbly story update <id> --add-dependency <id>` and `--remove-dependency <id>` change one item. Both are repeatable.
- `rowbly story get <id>` shows `Depends on`, `Blocks` and `Blocked` (yes or no, with the upstream IDs that are not complete). `--json` adds `dependsOn`, `blocks` and `waitingFor`.
- `rowbly story search --blocked` and `--ready` filter the Stories. They are mutually exclusive.
- A validation error from the service gives exit 2, with the details of the service in the JSON error.
- Update `skills/rowbly-reference.md`, then copy it to each `skills/<name>/references/rowbly-reference.md`.
- Update `docs/architecture/cli.md`.

## Acceptance criteria

- [ ] `rowbly story create --title X --depends-on ROW-01,ROW-02` saves both IDs.
- [ ] `--add-dependency` and `--remove-dependency` change only the given ID.
- [ ] `--depends-on ""` removes the `dependsOn` key from the file.
- [ ] A cycle gives exit 2, and the JSON error names the cycle.
- [ ] `story get --json` gives `dependsOn`, `blocks` and `waitingFor`.
- [ ] `story search --blocked` gives only blocked Stories, and `--ready` only ready Stories.
- [ ] Each copy of `rowbly-reference.md` is the same as `skills/rowbly-reference.md`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Depends on ROW-59. Read the `story-dependencies` Spec.
Keep the command thin. It calls only the functions of `src/services/story/` and `src/services/story-dependency/`.
