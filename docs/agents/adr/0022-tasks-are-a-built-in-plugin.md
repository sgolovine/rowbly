# ADR-0022: Tasks are a Built-in Plugin

**Status:** Accepted. Built. Amends [ADR-0011](0011-plugin-data-is-a-bag-per-plugin.md), [ADR-0013](0013-plugin-files-live-beside-what-they-belong-to.md), [ADR-0017](0017-actions-are-tui-only.md) and [ADR-0018](0018-comments-are-a-built-in-plugin.md): Tasks are no longer core records.

Tasks were part of core: a `tasks` array and a `nextTaskNumber` on every Story, a Tasks service, `tasks.*` core operations, the `rowbly tasks` commands, a Tasks tab and the Task screens, and a Task summary on the board card and in `stories show`. Not every team splits Stories into Tasks, and Tasks need nothing that a Plugin cannot have, so they move into the Tasks Built-in Plugin, like Epics (ADR-0014) and Comments (ADR-0018). Core no longer has a Task schema, Task ids, a Tasks service or `tasks.*` core operations, and no Task code outside `src/plugins/tasks/`.

**Data.** A Story's Tasks are Plugin Data on the Story (ADR-0011): `"plugins": { "tasks": { "nextNumber": 4, "tasks": [ { "number", "name", "description", "stage", "createdAt", "updatedAt" } ] } }`. A Task stores its number, not its id. Its Task Id, `<Story Key>.<number>` (`WEB-42.3`), is derived from the Story Key, so it follows the Story when doctor renumbers it. A number is never reused: `nextNumber` only grows. A Task's Stage is one of its Board's effective Stages, as before.

**Operations and commands.** The Plugin's operations keep the old names, now Plugin operations: `tasks.create`, `tasks.update`, `tasks.move` and `tasks.remove`. The commands keep their names, flags and output (`rowbly tasks list|create|show|edit|move|delete`). They are the Plugin's own commands, so other Plugins can no longer add options to them.

**Stages.** `stages.remove` no longer counts Tasks; its result is `{ storiesMoved }`. The Plugin hooks it instead. Without `--move-to`, its guard refuses a Stage that Tasks still use with `CONFLICT` and `details: { tasks, needsMoveTo: true }`. With `--move-to`, its transform moves those Tasks too and warns how many it moved. Core marks its own refusal for Stories with `details.needsMoveTo` as well, and the TUI offers a Stage to move to for any refusal that has it.

**Doctor.** Core's `UNKNOWN_STAGE` now checks Stories only, and `TASK_COUNTER_BEHIND` leaves core. The Plugin reports `TASKS_UNKNOWN_STAGE` (error) and `TASKS_COUNTER_BEHIND` (warning; `--fix` raises `nextNumber` above the highest Task).

**Plugin API.** It loses what only Tasks needed: tabs on the Task screen (`taskTabs`), rows for `tasks show` (`taskRows`), bags on Tasks (`bags.task`), the `task` Action target, `ui.openTask`, the exports `Task`, `TaskId`, `isTaskId` and `parseTaskId`, the `tasks.*` core operations and the `tasks …` commands of `PluginOptionCommand`. It gains what the move needed: `PluginTui.cardBadge`, a short text on a Story's board card (the Tasks Plugin's `✓ 2/5`), and the export `colorByCategory`.

**Comments.** Comments are on Stories only. A Plugin cannot yet extend another Plugin, so the Comments Plugin has no way to reach the Tasks Plugin's records. Task Comments are dropped with the rest of the old Task data.

The Plugin is off until a Data Root turns it on (ADR-0010). Existing Tasks are not migrated: this is a hard cut-off. Core drops a Story's top-level `tasks` and `nextTaskNumber` when it next writes that Story.
