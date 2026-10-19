# Operations

Every change to the Data Root, from core or from a Plugin, is one **operation** that fills one Change Set and saves it once ([ADR-0012](../agents/adr/0012-plugins-intercept-service-operations.md)). Plugins hook operations by name. This page describes the pipeline and lists every operation with its input and result; `test/plugins/operationInventory.test.ts` checks the tables against the code, so change both together.

## The pipeline

Services run every operation through `OperationRunner.run` (`src/services/plugins/runtime.ts`):

```text
parse each Plugin's input → take the Data Root lock → body (or a Plugin's replacement) fills the Change Set
  → transforms → guards → save (one journaled commit) → release the lock → reactions
```

| Step | What it may do | On failure |
| --- | --- | --- |
| Plugin input | Each Plugin's `inputs` schema parses its `plugins.<id>` input, when given | `VALIDATION`; nothing is saved |
| Body or replacement | Reads the Data Root and fills the Change Set. A Plugin may replace a core body, at most one Plugin per operation | The error; nothing is saved |
| Transforms | Change the Change Set through its writer methods, in registry order | The Plugin's error; nothing is saved |
| Guards | See the final Change Set, read-only, and may refuse | `CONFLICT` (exit 4); nothing is saved |
| Save | Validates the whole plan, then commits it through the journal ([Storage and commits](storage.md)) | Nothing is saved, or the commit finishes at the next recovery |
| Reactions | Act only outside Rowbly's data, after the lock is released. 5 s each. The CLI waits for them; the TUI runs them in the background | A warning; the exit code stays 0 |

- A **Change Set** lists stored records, each with `before` and `after`: `rootConfig`, `localState`, `board`, `story` and `file` (a Plugin file, as text). `before: null` is a created record, `after: null` a deleted one. A renumbered Story is one `story` change whose keys differ. Deleting a Board lists a `story` change for each of its Stories, then the `board` change; Plugin files deleted with a folder are not listed.
- **Results.** Callers and reactions get the final result, read back from the Change Set after the transforms, so `stories create --epic auth --json` prints the bag the Epics transform wrote. Transforms and guards get the body's result before transforms. A transform that deletes the record an operation returns fails the operation with `CONFLICT`.
- **Stage changes.** `stories.update` can change a Stage, like `stories.move`. Compare `before.stage` with `after.stage` rather than relying on the operation name.
- **Nesting.** A hook cannot start another operation; it changes data through the Change Set it receives. What each Plugin callback may do is in the [Plugin API reference](../plugins/api.md#stages-and-capabilities).
- **Not operations:** `rowbly init` (no Plugin can be on before the Data Root exists) and reads.

## Naming

- A core operation is `<service>.<verb>`. `CORE_OPERATION_NAMES` and the type `CoreOperationName` list them all.
- A Plugin's own operation is `<plugin id>.<name>`. The Plugin passes only `<name>` to `plugin.operation`. That name must be one lower-kebab-case word, or the operation fails before it reads or saves anything.
- The verbs are kept as they were published ([ADR-0020 §7](../agents/adr/0020-plugin-execution-and-data-contracts.md#7-api-restraint)): Comments uses `add`, `update` and `remove` ([ADR-0018](../agents/adr/0018-comments-are-a-built-in-plugin.md)); Epics and Specs use `create`, `edit` and `delete`.
- CLI verbs are separate from operation names. `rowbly stories edit` runs `stories.update`.

In the tables below:

- `?` marks an optional input key.
- Every input may also carry `plugins`.
- Results are the public results that callers and reactions get.

## Core operations

The input and result types are in `CoreOperations` (`src/services/plugins/types.ts`).

| Operation | Input | Result |
| --- | --- | --- |
| `context.use` | `{ board }` | `LocalState` |
| `context.clearUse` | `{}` | `undefined` |
| `context.setMe` | `{ handle }` | `LocalState` |
| `boards.create` | `{ id, name, keyPrefix, description? }` | `BoardConfig` |
| `boards.update` | `{ id, name?, description? }` | `BoardConfig` |
| `boards.remove` | `{ id, force }` | `undefined` |
| `stages.add` | `{ target, stage, position }` | `Stage[]` |
| `stages.update` | `{ target, key, name?, category? }` | `Stage[]` |
| `stages.move` | `{ target, key, position }` | `Stage[]` |
| `stages.remove` | `{ target, key, moveTo? }` | `{ storiesMoved }` |
| `fields.add` | `{ target, field }` | `CustomFieldDef[]` |
| `fields.update` | `{ target, key, …CustomFieldPatch }` | `CustomFieldDef[]` |
| `fields.remove` | `{ target, key }` | `{ valuesStripped }` |
| `stories.create` | `{ boardId, …StoryCreateInput }` | `Story` |
| `stories.update` | `{ key, …StoryPatch }` | `Story` |
| `stories.move` | `{ key, stage, top }` | `Story` |
| `stories.rank` | `{ key, position }` | `Story` |
| `stories.remove` | `{ key }` | `undefined` |
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

A Spec has exactly one of `slug` (a Board Spec) and `story` (a Story Spec). A Comments `target` is a Story key. A `Task` result has its Task Id as `id`, besides the stored fields. The Tasks Plugin also hooks `stages.remove`: it refuses a Stage its Tasks use without `moveTo`, and moves them with it.

## Plugin input of core operations

A Plugin's input of a core operation (`plugins.<id>`) is checked by that Plugin's `inputs` schema for the operation before anything runs. The built-ins take this input:

| Plugin | Operations | Input |
| --- | --- | --- |
| Assignees | `stories.create`, `stories.update` | `{ assignees?, add?, remove? }`: handles or `me`; `assignees` replaces the list and cannot be combined with `add` or `remove` |
| Epics | `stories.create`, `stories.update` | `{ epic: id \| null }` |
| Specs | `stories.create`, `stories.update` | `{ specs?, addSpecs?, removeSpecs?, reset? }` |

A Story filter (`StoryFilter.plugins.<id>`) is checked by the Plugin's `storyFilterSchema`. For Assignees this is a non-empty list of handles (`me` is Me), matching Stories with any of them. For Epics this is an Epic ID, or `false` for Stories without one. Specs takes a list of Board Spec slugs and declares no schema, so a malformed filter matches nothing.
