# Operations

Every operation that runs through the Plugin pipeline (ADR-0012), with its input and result. Hooks are keyed by these names, and a Plugin's input reaches an operation as `plugins.<id>` in its input. `test/plugins/operationInventory.test.ts` checks this file against the code. Change both together.

## Naming

- A core operation is `<service>.<verb>`, and the type `CoreOperationName` lists them all.
- A Plugin's own operation is `<plugin id>.<name>`. The Plugin passes only `<name>` to `plugin.operation`. That name must be one lower-kebab-case word, or the operation fails before it reads or saves anything.
- The verbs are kept as they are published (W1). Comments uses `add`, `update` and `remove` (ADR-0018). Epics and Specs use `create`, `edit` and `delete`.
- CLI verbs are separate from operation names. `rowbly stories edit` runs `stories.update`.

In the tables below:

- `?` marks an optional input key.
- Every input may also carry `plugins`.
- Results are the public results that callers and reactions get (ARCH-14).

## Core operations

The input and result types are in `CoreOperations` (`src/services/plugins/types.ts`).

| Operation | Input | Result |
| --- | --- | --- |
| `context.use` | `{ board }` | `LocalState` |
| `context.clearUse` | `{}` | `undefined` |
| `context.setMe` | `{ handle }` | `LocalState` |
| `assignees.add` | `{ handle, name, email? }` | `Assignee` |
| `assignees.update` | `{ handle, name?, email? }` | `Assignee` |
| `assignees.remove` | `{ handle }` | `{ storiesUpdated }` |
| `boards.create` | `{ id, name, keyPrefix, description? }` | `BoardConfig` |
| `boards.update` | `{ id, name?, description? }` | `BoardConfig` |
| `boards.remove` | `{ id, force }` | `undefined` |
| `stages.add` | `{ target, stage, position }` | `Stage[]` |
| `stages.update` | `{ target, key, name?, category? }` | `Stage[]` |
| `stages.move` | `{ target, key, position }` | `Stage[]` |
| `stages.remove` | `{ target, key, moveTo? }` | `{ storiesMoved, tasksMoved }` |
| `fields.add` | `{ target, field }` | `CustomFieldDef[]` |
| `fields.update` | `{ target, key, …CustomFieldPatch }` | `CustomFieldDef[]` |
| `fields.remove` | `{ target, key }` | `{ valuesStripped }` |
| `stories.create` | `{ boardId, …StoryCreateInput }` | `Story` |
| `stories.update` | `{ key, …StoryPatch }` | `Story` |
| `stories.move` | `{ key, stage, top }` | `Story` |
| `stories.rank` | `{ key, position }` | `Story` |
| `stories.remove` | `{ key }` | `undefined` |
| `tasks.create` | `{ storyKey, …TaskCreateInput }` | `Task` |
| `tasks.update` | `{ taskId, …TaskPatch }` | `Task` |
| `tasks.move` | `{ taskId, stage }` | `Task` |
| `tasks.remove` | `{ taskId }` | `undefined` |
| `plugins.enable` | `{ id }` | `{ id, enabled }` |
| `plugins.disable` | `{ id }` | `{ id, enabled }` |
| `doctor.fix` | `{ findings }` | `DoctorFix[]` |

## Built-in Plugin operations

| Operation | Input | Result |
| --- | --- | --- |
| `epics.create` | `{ id, name, description }` | `Epic` |
| `epics.edit` | `{ id, name?, description? }` | `Epic` |
| `epics.close` | `{ id }` | `Epic` |
| `epics.reopen` | `{ id }` | `Epic` |
| `epics.delete` | `{ id }` | `{ id, storiesUnlinked }` |
| `specs.create` | `{ board, slug?, story?, text }` | `Spec` |
| `specs.edit` | `{ board, slug?, story?, text }` | `Spec` |
| `specs.delete` | `{ board, slug?, story? }` | the number of Stories unlinked |
| `comments.add` | `{ target, body }` | `Comment` |
| `comments.update` | `{ target, id, body }` | `Comment` |
| `comments.remove` | `{ target, id }` | `{ deleted }` |

A Spec has exactly one of `slug` (a Board Spec) and `story` (a Story Spec). A Comments `target` is a Story key or a Task ID.

## Plugin input of core operations

A Plugin's input of a core operation (`plugins.<id>`) is checked by that Plugin's `inputs` schema for the operation before anything runs. The built-ins take this input:

| Plugin | Operations | Input |
| --- | --- | --- |
| Epics | `stories.create`, `stories.update` | `{ epic: id \| null }` |
| Specs | `stories.create`, `stories.update` | `{ specs?, addSpecs?, removeSpecs?, reset? }` |

A Story filter (`StoryFilter.plugins.<id>`) is checked by the Plugin's `storyFilterSchema`. For Epics this is an Epic ID, or `false` for Stories without one. Specs takes a list of Board Spec slugs and declares no schema, so a malformed filter matches nothing.
