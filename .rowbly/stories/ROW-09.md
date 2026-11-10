---
title: Replace story agent locks with factory state activity
stage: IN_DEVELOPMENT
position: 1
worktree: /home/sgolovine/.t3/worktrees/rowbly/row-09-in_development
pull_request: null
---

## Goal

Agent locks in Story frontmatter (`agentLock`) duplicate the factory state and go stale. Use `.rowbly/state.json`, which the factory supervisor writes, as the only source of agent activity. Remove `agentLock` from Story frontmatter, the services, the CLI, `doctor`, the TUI, the factory skill and the docs. The user then sees the recorded factory activity of each Story in the TUI, and sees a clear status when the state file is missing, invalid or incomplete.

## Scope

In scope:

1. Remove the Story agent lock: the `StoryAgentLock` type, `parseAgentLock`, `dropAgentLock`, `lockStory`, `unlockStory`, the `agentLock` field of the `Story` record (also in `--json` output), the lock line of `story get` text output, the Stage-change and Stage-rename lock logic, and `agentLock` in `RESERVED_FIELD_KEYS`.
2. Remove the `rowbly story lock` and `rowbly story unlock` commands and their documentation.
3. Cleanup: `rowbly doctor` shows a warning for each Story file that has an `agentLock` key (for example, `agentLock is no longer used`). `rowbly doctor --fix` removes the key and keeps all other frontmatter and the description. Document this as the migration in `AGENTS.md`.
4. Factory skill: remove the `agentLock` check from `evaluateScan` in `supervisor-policy.mjs`, and the lock steps and lock text from `SKILL.md` and `references/supervisor-policy.md`. Keep duplicate-assignment checks on state records and harness workers only. Document the limit: supervisors in separate checkouts or on separate machines do not share `state.json`, so only the harness worker list can find their workers. Update the `node:test` tests.
5. Copy each change in `skills/factory/` to the installed copies in `.agents/skills/factory/` and `.claude/skills/factory/`. The three folders must stay identical.
6. A new service, `src/services/factoryActivity/factoryActivity.ts` (name can change), reads and validates `<project>/.rowbly/state.json` and gives the activity of each Story. It never throws for a state file problem. It returns a typed result.
7. The Story row shows the activity from the service in place of the agent lock indicator. A one-line status in the Story panel shows the file problems below. The Help modal explains the indicator.

Not in scope:

- Changes to the state file format, to `factory-state.mjs`, or to how the supervisor writes the file.
- Activity in the CLI (`story get`, `story search`) or in the Story modal.
- Liveness checks of workers. Rowbly shows only recorded activity.
- Stage prompts: no file in `stages/` or `.rowbly/stages/` uses agent locks, so they do not change.

## Activity rules

The state format is version 1 (`skills/factory/references/supervisor-policy.md`, "State"). `attempts` is in launch order. Mandatory attempt fields are `story`, `stage`, `workerId` and `status`. The optional display field is `model`.

For each Story, take the attempts with `story` equal to the Story ID and `stage` equal to the current Stage of the Story. Ignore attempts for Stories that do not exist and for other Stages. Active statuses are `preparing` and `running`. Terminal statuses are `completed`, `failed`, `blocked` and `interrupted`.

| Matched attempts | Activity | Row text |
| --- | --- | --- |
| No active attempt | none | no indicator |
| One active attempt, and it is the last matched attempt | active | `▶ <model>`, or `▶ <workerId>` if `model` is absent, cut to 12 characters as now |
| Two or more active attempts, or an active attempt before a later matched attempt | conflict | `▶ conflict` |
| A matched attempt (by `story`) has no `stage`, `workerId` or `status` | incomplete | `▶ unknown` |

A later terminal attempt never exposes an earlier attempt as active (the second-to-last row gives `conflict`, not the earlier worker). Do not choose one agent from a conflict. Do not use file age or `updatedAt` to decide that a worker stopped.

## State file cases

| Case | File status | Row indicators | Story panel status line |
| --- | --- | --- | --- |
| File does not exist | `missing` | none | Neutral text (`inkFaint`), for example `Factory activity: no .rowbly/state.json` |
| File cannot be read (for example, a permission error) | `unavailable` | none | Warning with the path and the error message |
| Not JSON, conflict markers, not an object, `version` absent or not `1`, a field with a wrong type, an unknown `status` | `unavailable` | none | Warning with the path and the error message |
| Valid, no matched active attempts | `ok` | none | none |
| Valid with attempts | `ok` | per the activity rules | none |
| `scan` or `attempts` absent, or an attempt without `story` | `incomplete` | per the activity rules for the attempts that can be matched | Warning: factory activity is incomplete |

- An `unavailable` file never gives a partial list of indicators.
- Each refresh reads the file again. When a valid file becomes invalid, all its indicators go away. When it becomes valid again, they come back.
- Show no toast for a state file problem. Only the status line shows it, so a refresh does not repeat a message.
- A state file problem does not fail the Project load. All Story actions keep working.
- The TUI and the service never create, repair, truncate or write `state.json`.

## Acceptance criteria

- [ ] `rg agentLock src skills .agents/skills .claude/skills AGENTS.md` finds only the `doctor` cleanup code, its test and its documentation.
- [ ] `rowbly story lock` and `rowbly story unlock` give an unknown-command error. `story get --json` has no `agentLock` key.
- [ ] `rowbly doctor` shows a warning for a Story file with an `agentLock` key. `--fix` removes the key, and the other frontmatter and the description do not change (service test).
- [ ] `evaluateScan` ignores `agentLock` on a Story record, and the factory `node:test` tests pass. The three factory skill folders are identical (`diff -r`).
- [ ] Service tests cover each row of the activity rules table: no attempt, one active attempt, a later terminal attempt after an active one, two active attempts, an attempt for another Stage, an attempt for a deleted Story, `model` absent, and `workerId` absent.
- [ ] Service tests cover each row of the state file cases table, including conflict markers, an unsupported version and an unknown status.
- [ ] A service test proves that a read of an invalid or unreadable file does not change the file (same bytes and the same mtime).
- [ ] `StoryRow` tests show `▶ <label>`, `▶ conflict`, `▶ unknown` and no indicator.
- [ ] Shell tests show: the missing-file status line; the warning for a corrupt file; that indicators go away when a valid file becomes invalid, and come back when it is valid again, with no toast; that a Story can be created and moved while the file is corrupt; and that a Project switch shows the activity of the new Project.
- [ ] The Help modal says that `▶` shows a worker that the factory state records, and that Rowbly does not check that the worker is alive.
- [ ] `AGENTS.md` replaces the agent lock concept and the `agentLock` storage text with the factory activity text and the `doctor --fix` cleanup, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:factory` pass. A real-terminal check through agentic-tui shows the row indicator and the status line.

## Technical notes

- Lock code: `src/services/storyFiles/storyFiles.ts` (type, parse, drop), `src/services/story/story.ts` (field, `lockStory`, `unlockStory`, drop on move), `src/services/stage/stage.ts` (rename keeps lock, delete drops lock), `src/services/doctor/doctor.ts` (lock checks, `known` keys), `src/services/config/config.ts` (`RESERVED_FIELD_KEYS`), `src/commands/story/story.ts` (`lock`, `unlock`, text output), `src/tui/screens/stories/StoryRow/StoryRow.tsx`. Update their tests and `StoryList`, `StoryFinder` and `storyListRows` test fixtures.
- Factory: `skills/factory/scripts/supervisor-policy.mjs` (`story.agentLock?.stage === story.stage`), its test, `watch-stages.test.mjs` fixtures, `skills/factory/SKILL.md` ("Assign workers" step 6, "Shared write lock" last line, the external lock lines), `references/supervisor-policy.md` (step 11, the `stories` sentence).
- The skill scripts are standalone `.mjs` files that projects copy. They cannot import the TypeScript service. Keep the TUI validation in the service, and use the status set and the mandatory fields of `factory-state.mjs`.
- Load the activity in `Shell.tsx` next to `searchStories`, in the same `useAsync` or a separate one. The service returns a result and does not reject, so the board still loads. Pass the activity of each Story to `StoryRow` through `StoryList`.
- `watchStories` watches all of `.rowbly/` recursively, so writes, atomic renames, creation and deletion of `state.json` already call `refresh`. The watch follows the Project root, so a Project switch reads the state file of the new Project.
- Use a theme token for the warning text, the same token that a warning Toast uses. Do not write a hex value. Follow `.agents/skills/rowbly-tui-design/SKILL.md`.
- The JSON output change and the removed commands are breaking. Use `feat!` or a `BREAKING CHANGE:` footer.
- The Stories of this repository have no `agentLock` key now, so this repository needs no migration.
