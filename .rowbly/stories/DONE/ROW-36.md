---
title: Create a "status" command for humans
stage: DONE
position: 30
uid: dbea0ae0-7bc5-4bd9-8579-e9dab6e66330
createdAt: 2026-11-14T21:12:56.000Z
updatedAt: 2026-11-14T21:37:29.000Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-36
pull_request: https://github.com/sgolovine/rowbly/pull/217
---

## Goal

A person wants a short summary of the Project in the terminal. Add a top-level `rowbly status` command to the CLI. The command prints:

- The number of running Threads.
- The number of Stories in each column (Stage).

The text output is for a person. `--json` gives the same data as JSON.

## Scope

In scope:

- A new service that collects the summary data.
- A new top-level CLI command `rowbly status` (not under a resource, the same as `doctor`).
- Text output and `--json` output.
- Tests for the service and the command.
- Documentation updates (see Technical notes).

Not in scope:

- A TUI screen or a TUI change.
- Changes to `rowbly factory status`. Keep that command as it is.
- A watch or refresh mode.
- Per-Story or per-Thread detail lists.

## Acceptance criteria

- [ ] `rowbly status` exists at the top level and `rowbly --help` lists it with a description.
- [ ] The text output shows the factory phase, the number of running Threads, and one line for each Stage in config order with its label, key and Story count. A Stage with no Stories shows `0`.
- [ ] A disabled Stage shows in the list with the mark `(disabled)`.
- [ ] The text output also shows the total number of Stories.
- [ ] `rowbly --json status` prints an object with this shape: `{ "factory": { "phase": string }, "threads": { "running": number, "pending": number }, "stages": [{ "key": string, "label": string, "enabled": boolean, "stories": number }], "stories": number }`.
- [ ] The running count is the number of Thread records (all roles) with status `running`. The pending count is the number with status `pending`.
- [ ] A Project with no `.rowbly/runtime/threads/` directory gives `0` running and `0` pending, and exit code 0.
- [ ] When the factory status is `unavailable`, the command does not fail. It shows phase `unavailable` and exit code is 0.
- [ ] Outside a Rowbly Project, the command fails with the usual `NOT_FOUND` error and exit code 1.
- [ ] `rowbly status` does not load Pi: a test in `src/services/pi-runtime/import-boundary.test.ts` runs `--json status` with Pi mocked to throw, and it passes.
- [ ] The service has a test next to it (`useTestProject`), and the command has a test next to it (`runCli`), for the text and the JSON output.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Service: create `src/services/project-status/project-status.ts` with `getProjectStatus(ctx: ServiceContext = {})`. It must not import `commander`, `ink` or `react`, and it must not print. See `docs/architecture/service-layer.md`.
  - Stages: `readConfig(paths)` gives the Stages in workflow order (see `src/services/stage/stage.ts` `listStages`).
  - Story counts: read the Story files (for example `readStoryFiles` in `src/services/story-files/`) and count by `stage`. Do not use `searchStories`, because it reads the attachments of each Story. A Story whose Stage is not in the config is counted in the total only.
  - Threads: `listThreads({}, ctx)` in `src/services/thread/thread-list.ts`. It returns `[]` when the directory does not exist.
  - Factory phase: `getFactoryStatus(ctx)` in `src/services/factory/factory.ts`. It never throws; it returns phase `unavailable` on a runtime problem.
- Command: create `src/commands/status/status.ts` with `registerStatus(program)`. Register it in `src/commands/register-commands/register-commands.ts` at the root, next to `registerDoctor`. Use `run()` from `src/commands/output/output.ts` for text and `--json`.
- Example text output:
  ```
  Factory: ready
  Threads: 2 running, 1 pending

  Stories: 12
    Backlog (BACKLOG)               3
    In refinement (IN_REFINEMENT)   1
    Done (DONE)                     8
  ```
- Keep the Pi SDK out of this path (AGENTS.md safety rule). None of the services above load Pi.
- Follow `.agents/skills/rowbly-code-style/SKILL.md`. Use dash-case names and `.js` import extensions.
- Docs (STE): add `status/` to the layout table and add `status` to the top-level command list in `docs/architecture/cli.md`. Add `rowbly status` to `skills/rowbly-reference.md`, then copy the file to each `skills/<name>/references/rowbly-reference.md`.

## Assumptions

- The command is the top-level `rowbly status`, not `rowbly project status`. Reason: the author wrote "rowbly status", and `doctor` and `init` are top-level already.
- "Running threads" counts the Thread records with status `running`, for all roles (supervisor and workers), and the output also shows `pending`. Reason: the Thread records are the data that `thread list` shows, and they are readable when the factory is stopped.
- The output shows the factory phase next to the Thread count. Reason: a Thread record can stay `running` after a crash until the next factory start recovers it. The phase lets the person see this case.
- "Columns" are the Stages of the config, in config order, including disabled Stages with a mark. Reason: the board columns are the Stages; a disabled Stage can still hold Stories.
- A factory status of `unavailable` does not fail `rowbly status`. Reason: the command is a summary, and the Story counts are still useful. `rowbly factory status` keeps its error behaviour.
