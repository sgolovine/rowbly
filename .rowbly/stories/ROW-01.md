---
title: Nested command structure
stage: DONE
position: 5
worktree: /home/sgolovine/.t3/worktrees/rowbly/row-01-in_development
pull_request: https://github.com/sgolovine/rowbly/pull/181
---

## Goal

Replace the flat CLI command names with commands under a resource name.
For example, `rowbly story create` replaces `rowbly create-story`.
Users can see the help for one resource with `rowbly story` or `rowbly story --help`.

## Scope

Convert all current resource commands in one pull request.
Use singular resource names and keep each current action name, arguments and options.

| Resource | Actions | Current commands |
| --- | --- | --- |
| `story` | `create`, `update`, `delete`, `get`, `lock`, `unlock`, `search` | `create-story`, `update-story`, `delete-story`, `get-story`, `lock-story`, `unlock-story`, `search-stories` |
| `stage` | `create`, `update`, `delete`, `get` | `create-stage`, `update-stage`, `delete-stage`, `get-stage` |
| `custom-field` | `add`, `update`, `remove` | `add-custom-field`, `update-custom-field`, `remove-custom-field` |
| `spec` | `create`, `update`, `delete`, `get`, `list`, `link`, `unlink` | `create-spec`, `update-spec`, `delete-spec`, `get-spec`, `list-specs`, `link-spec`, `unlink-spec` |
| `skill` | `install`, `list`, `remove` | `install-skill`, `list-skills`, `remove-skill` |
| `project` | `update`, `get-instructions` | `update-project`, `get-instructions` |

For example, use `rowbly project get-instructions` for the Project instructions.
Keep `init` and `doctor` at the root because they are standalone commands.
Keep the root help, version options and no-argument TUI entry point.
Replace the old flat resource commands; compatibility aliases are outside this Story.

Update the command examples, error hints, bundled skills, Rowbly references and factory scripts with the new syntax.
Do not change the service operations, storage format, Project config or Stage prompts.
Do not add resource actions that do not exist today.

## Acceptance criteria

- [ ] Each command in the table runs under its resource with the same arguments, options and service behavior.
- [ ] `rowbly story create --title Example` creates a Story through the existing `createStory` service.
- [ ] Each bare resource command prints its resource help to stdout and exits with code 0.
- [ ] Each resource accepts `-h` and `--help`, prints its actions and exits with code 0.
- [ ] Each action accepts `--help` and prints its arguments and options without a service call.
- [ ] Resource help works outside a Project and does not start the TUI, ask questions or write files.
- [ ] Root help lists the six resource groups, `init` and `doctor`; it does not list the old flat resource commands.
- [ ] An old flat resource command or an unknown resource action exits with a nonzero code and a useful error.
- [ ] Global `--json` and `-C` options work before the resource, between the resource and action, and after the action.
- [ ] Nested actions preserve JSON result shapes, text results, validation, repeatable flags and error exit codes.
- [ ] `rowbly` still starts the TUI; `rowbly init`, `rowbly doctor`, root help and version options still work.
- [ ] Factory scripts and their tests use nested commands, including `story search`, `story create` and `story update`.
- [ ] Repository command examples and command hints use the nested syntax, except explicit migration examples and unchanged Stage prompts.
- [ ] CLI tests cover every mapped action, resource help, action help, invalid commands and global option placement.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:factory` and `pnpm build` pass.

## Technical notes

`src/cli.ts` selects the TUI only when there are no arguments.
Keep that selection and keep the file small.
`src/commands/registerCommands/registerCommands.ts` registers commands and defines the global options.
The current command inventory contains 26 resource actions across the six groups in the table.
Register a Commander parent for each resource and register its actions under that parent.
Use Commander help for each parent and action.

The resource modules are in `src/commands/{story,stage,customField,spec,skill,project}/`.
Keep these modules as thin service callers.
`src/commands/output/output.ts` reads inherited options with `optsWithGlobals`.
`src/commands/testCli/testCli.ts` provides `createProgram` and `runCli` for tests.
Update the command inventory test and the tests of each affected command module.

`skills/factory/scripts/watch-stages.mjs` calls `search-stories` today.
Its tests also call `create-story` and `update-story`.
Update these calls and the expected argument arrays.
Run `pnpm test:factory` after changes to these scripts.

Check command text in `README.md`, `AGENTS.md`, `skills/`, `.agents/skills/` and service hints.
The shared reference is `skills/rowbly_reference.md`; the bundled skills also have reference copies.
Keep these references consistent and account for symlinks before changes to installed skills.
Leave the upstream agentic-tui skill unchanged.
Do not edit `.rowbly/stages/`, `stages/` or `.rowbly/rowbly.config.json` for this Story.

Specs are on, but this Story has no linked Specs at refinement.

## Development response

Result: complete. Commit: `2981b99570fce09fb022bfcefd42b6187aa88bed`.

- Both installed scanners now pass `story` and `search` as separate arguments. All three scanner files match.
- The branch includes main. The merge keeps ROWBLY.md initialization, factory policy changes and nested command syntax.
- Lint, typecheck and build pass. The factory suite passes all 47 tests.
- The full suite passes all 847 tests in 109 files with `pnpm test --maxWorkers=2`.
- Both installed scanner argument tests pass. Focused CLI tests pass all 65 tests.
- The four TUI test files from the review match main. Their 59 tests pass in a separate main source snapshot with two workers.

Problems found during checks:

- The default full run has nine asynchronous TUI assertion failures under high concurrency. The complete two-worker run passes.
- Extra complete installed test suites fail because their CLI integration tests look for `.agents/src/cli.ts` and `.claude/src/cli.ts`. The bundled suite passes.

PR: https://github.com/sgolovine/rowbly/pull/181
