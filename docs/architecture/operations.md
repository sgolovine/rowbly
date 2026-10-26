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
- **Queued Git work.** Git reactions persist affected paths and return before committing. Command mode then drains due Git work outside the reaction deadline; the TUI continues after enqueueing. Git processes use saved-file snapshots outside the Data Root lock ([ADR-0030](../agents/adr/0030-git-work-runs-outside-the-data-root-lock.md)).
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
| `stages.update` | `{ target, key, name? }` | `Stage[]` |
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

`context.setMe` sets or clears (`handle: null`) the local Me in Local State. Global Me in `~/.rowblyrc.json` is outside every Data Root, so changing it (`rowbly whoami` without `--local`) is not an operation ([ADR-0032](../agents/adr/0032-me-is-global-with-a-local-me-per-data-root.md)).

## Built-in Plugin operations

| Operation | Input | Result |
| --- | --- | --- |
| `git.configure` | `{ automaticCommits?, synchronization?, frequency?, intervalSeconds?, authorName?, authorEmail? }` | personal Git preferences, merged with the latest Local State |
| `epics.create` | `{ id, name, description }` | `Epic` |
| `epics.edit` | `{ id, name?, description? }` | `Epic` |
| `epics.close` | `{ id }` | `Epic` |
| `epics.reopen` | `{ id }` | `Epic` |
| `epics.delete` | `{ id }` | `{ id, storiesUnlinked }` |
| `specs.create` | `{ board, slug, story?, text }` | `Spec` |
| `specs.edit` | `{ board, slug, story?, text }` | `Spec` |
| `specs.delete` | `{ board, slug, story? }` | the number of Stories unlinked |
| `attachments.add` | `{ target, name }` | `Attachment` |
| `attachments.remove` | `{ target, id }` | `{ removed }` |
| `comments.add` | `{ target, body }` | `Comment` |
| `comments.update` | `{ target, id, body }` | `Comment` |
| `comments.remove` | `{ target, id }` | `{ deleted }` |
| `story-linking.add` | `{ blocker, blocked }` | `{ blocker, blocked }` (canonical Story Keys) |
| `story-linking.remove` | `{ blocker, blocked }` | `{ blocker, blocked }` (canonical Story Keys) |
| `software-factory.set` | `{ level, board?, stage, enabled?, text? }` | `StagePrompt` |
| `software-factory.remove` | `{ level, board?, stage }` | `{ removed }` (the Stage key) |

A Spec has a `slug`; with `story` it is a Story Spec of that Story, without it a Board Spec. A `Spec` result is `{ slug, title, text }`. A Comments `target` is a Story key. A `Task` result has its Task Id as `id`, besides the stored fields. The Tasks Plugin also hooks `stages.remove`: it refuses a Stage its Tasks use without `moveTo`, and moves them with it.

Attachments' `target` is a Story Key. An `Attachment` result is
`{ id, name, type: 'image/png', size, createdAt, createdBy }`. Binary source bytes are read and
validated before `attachments.add` and are not included in the hook input. Add and remove update
both the ordered Story bag and `<id>.png` through the same Change Set. No Operation opens an
associated application; `attachments open` reads and opens an existing scoped PNG without saving.

Story Linking's `blocker` and `blocked` name the same-Board source and target of a directed link.
`add` validates both Stories and rejects a self link; duplicates save no changes. `remove` can remove
an outgoing link whose target no longer exists. Only the blocker's bag and `updatedAt` change;
the reciprocal view is derived. Its `stories.remove` transform removes incoming references in the
deletion's Change Set, refusing the entire operation if an invalid linking bag on the Board prevents
safe cleanup. Its `doctor.fix` repairs only invalid targets in valid bags and keeps other Plugin Data.

Software Factory's `level` is `global` (the entry in `rowbly.config.json`) or `board` (the bag in
`boards/<board>/board.config.json`, with `board`); `stage` is a Stage key that `set` checks against
that level's Stages, Backlog and Done included. `set` turns the Stage Prompt on or off (`enabled`),
saves its Markdown (`text`), or both; turning it on without a file writes a template, and a new Board
entry starts with the global entry's on/off setting. Turning it off keeps the file. `remove` deletes
the entry and its file at that level only. A `StagePrompt` result is
`{ enabled, configured, source, path, exists, text }`: `configured` is the saved on/off setting,
`enabled` is true only when it is on, `path` (relative to the Data Root) resolves inside the
Plugin's folder for the level, and the file exists.

## Plugin input of core operations

A Plugin's input of a core operation (`plugins.<id>`) is checked by that Plugin's `inputs` schema for the operation before anything runs. The built-ins take this input:

| Plugin | Operations | Input |
| --- | --- | --- |
| Assignees | `stories.create`, `stories.update` | `{ assignees?, add?, remove? }`: handles or `me`; `assignees` replaces the list and cannot be combined with `add` or `remove` |
| Epics | `stories.create`, `stories.update` | `{ epic: id \| null }` |
| Attachments | `stories.create`, `stories.update` | `{ images: [{ name, png }] }`: PNGs encoded as base64, at most 10 MiB total; appends metadata and files in the Story Change Set |
| Specs | `stories.update` | `{ specs?, addSpecs?, removeSpecs?, reset? }` |
| Specs | `stories.create` | `{ specs?, addSpecs?, removeSpecs?, reset?, storySpecs?: [{ slug?, title?, text }] }`; Story Spec slugs default to `spec` and must be unique |
| Tasks | `stories.create` | `{ tasks: [{ name, description?, stage? }] }`; Stage defaults to the first effective Stage, numbering follows draft order |
| Story Linking | `stories.create` | `{ blocks?: [Story Key], blockedBy?: [Story Key] }`; linked Stories must exist on the same Board |

A Story filter (`StoryFilter.plugins.<id>`) is checked by the Plugin's `storyFilterSchema`. For Assignees this is a non-empty list of handles (`me` is Me), matching Stories with any of them. For Epics this is an Epic ID, or `false` for Stories without one. Specs takes a list of Board Spec slugs and declares no schema, so a malformed filter matches nothing.

`stories.create` collects these bags, Story Spec files and existing blockers’ bags in one Change Set and one journaled commit. Invalid input saves nothing. Story Spec titles use the supplied title, first `#` heading or slug.
