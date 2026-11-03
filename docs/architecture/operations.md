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
| `config.updateRootConfig` | `{ onboardingComplete }` | saved `RowblyConfig` |
| `feature-flags.set` | `{ key, enabled }` | `FeatureFlag` (`key`, `name`, `description`, effective `enabled`) |
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
| `software-factory.start` | `{ key, worker, retry?, selection? }` | `{ key, stageRun, selection? }` |
| `software-factory.attach` | `{ key, stage, attempt, startedAt, worker, machine, harness, threadId, source }` | `{ key, stageRun, identity }` |
| `software-factory.finish` | `{ key }` | `{ key, stageRun }` |
| `software-factory.fail` | `{ key, reason? }` | `{ key, stageRun }` |
| `software-factory.clear` | `{ key }` | `{ cleared }` (the Story Key) |
| `software-factory.hold` | `{ key, reason }` | `{ key, hold }` |
| `software-factory.release` | `{ key }` | `{ key, released }` (the hold it removed) |

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

Software Factory's `start`, `finish`, `fail` and `clear` change a Story's Stage Run, the
`stageRun` in its bag: `{ stage, status, attempt, worker, by, startedAt, finishedAt?, reason? }`
([ADR-0040](../agents/adr/0040-stage-runs-record-the-current-visit.md)). `key` is a Story Key.
`start` refuses (`CONFLICT`) a Story whose Stage has no Stage Prompt that is on, or that has a Stage
Run for its current Stage, unless that one failed and `retry` is set, which starts it again with the
next `attempt`. Starts and retries also refuse unresolved blocking Stories (`CONFLICT`),
with `details.eligibility` describing the blockers; a refused retry keeps its saved Run and attempt.
Software Factory queries Story Linking’s public `{ blocks: key }` Story filter inside the operation.
Story Linking’s `software-factory.start` guard checks again after all transforms, overlaying pending
Story additions, edits and deletions on the stored Board under the same Data Root lock. A blocker
is resolved only in a Stage of category `done`. Invalid linking bags fail with `DATA_INTEGRITY`;
when Story Linking is off, its preserved data contributes no restriction. `by` is Me or `null`. `finish` and `fail` end a running Stage Run of the current Stage,
else `CONFLICT`; `clear` removes any Stage Run, else `NOT_FOUND`. They also set the Story's
`updatedAt`. The Plugin's `stories.move` and `stories.update` transforms remove a valid Stage Run when
the Story's Stage changes; a Stage Run for another Stage than the Story's is ignored.

Software Factory's `hold` writes the Story-scope Plugin file `hold.json`,
`{ version: 1, reason, by, heldAt }`, and `release` deletes it
([ADR-0043](../agents/adr/0043-a-hold-keeps-a-story-out-of-stage-runs.md)). Neither changes the
Story or its Stage Run, and the hold stays through Stage changes. `hold` refuses a held Story
(`CONFLICT`), `release` one that is not held (`NOT_FOUND`), and both refuse a hold file they cannot
read (`DATA_INTEGRITY`), leaving it unchanged: one with unknown fields or another `version`, or a
symbolic link, which is never followed. A held Story, or one whose hold file cannot be read,
has the eligibility reason `HELD`, so `start` refuses it (`CONFLICT`), `retry` included.

`rowbly software-factory apply` runs no operation of its own: it holds no lock and runs each
command of a worker's block that it allows as a separate `rowbly` process, so each runs its own
operation, under its own lock, as that command always does
([ADR-0045](../agents/adr/0045-reported-board-commands-are-checked-and-applied-by-rowbly.md)).
Its move carries the Stage Run it decided on as the Plugin's `stories.move` input, so the move's
own guard checks that Run again under that lock.

## Plugin input of core operations

A Plugin's input of a core operation (`plugins.<id>`) is checked by that Plugin's `inputs` schema for the operation before anything runs. The built-ins take this input:

| Plugin | Operations | Input |
| --- | --- | --- |
| Assignees | `stories.create`, `stories.update` | `{ assignees?, add?, remove? }`: handles or `me`; `assignees` replaces the list and cannot be combined with `add` or `remove` |
| Epics | `stories.create`, `stories.update` | `{ epic: id \| null }` |
| Attachments | `stories.create`, `stories.update` | `{ images: [{ name, png }] }`: PNGs encoded as base64, at most 10 MiB total; appends metadata and files in the Story Change Set |
| Specs | `stories.update` | `{ specs?, addSpecs?, removeSpecs?, reset?, baselineSpecs?: [slug], baselineStorySpecs?: [{ slug, title, text }], storySpecs?: [{ slug?, title?, text }] }`; when given, Story Specs replace the current set; omitted files are deleted, unchanged text and unknown bag fields are kept |
| Specs | `stories.create` | `{ specs?, addSpecs?, removeSpecs?, reset?, storySpecs?: [{ slug?, title?, text }] }`; Story Spec slugs default to `spec` and must be unique |
| Tasks | `stories.create` | `{ tasks: [{ name, description?, stage? }] }`; Stage defaults to the first effective Stage, numbering follows draft order |
| Tasks | `stories.update` | `{ tasks: [{ number?, name, description?, stage? }], baseline?: [StoredTask] }`; replaces the list, keeps existing numbers, creation dates and unknown Task/bag fields, allocates new numbers without reuse; missing or duplicate existing numbers reject the operation |
| Story Linking | `stories.update` | `{ blocks?: [Story Key], blockedBy?: [Story Key], baseline?: { blocks?, blockedBy? } }`; replaces each given direction, including incoming blockers in the same Change Set; existing stale outgoing links may be kept or removed |
| Story Linking | `stories.create` | `{ blocks?: [Story Key], blockedBy?: [Story Key] }`; linked Stories must exist on the same Board |
| Software Factory | `stories.move` | `{ finishedRun: { stage, attempt, startedAt } }`; its guard refuses the move (`CONFLICT`) unless that is still the finished Stage Run of the Story's current visit, read as stored under the move's lock |

A Story filter (`StoryFilter.plugins.<id>`) is checked by the Plugin's `storyFilterSchema`. For Assignees this is a non-empty list of handles (`me` is Me), matching Stories with any of them. For Epics this is an Epic ID, or `false` for Stories without one. Story Linking takes `{ blocks: Story Key }`, returning Stories whose outgoing links include that key;
its strict query schema rejects malformed queries, and invalid stored linking bags fail explicitly.
Callers may combine it with `open: true` to find unfinished blockers. Specs takes a list of Board Spec slugs and declares no schema, so a malformed filter matches nothing.

`stories.create` collects these bags, Story Spec files and existing blockers’ bags in one Change Set and one journaled commit. Invalid input saves nothing. Story Spec titles use the supplied title, first `#` heading or slug.

The Story editor supplies baselines only for changed Plugin drafts or fields. Tasks compare the loaded stored Task fields (including timestamps); Story Specs compare every slug and its full text/title; Links compare each replaced direction, including incoming links derived from current Board Stories; Board Spec links compare their loaded slugs. Comparisons run in transforms under the Data Root lock. A mismatch raises an attributed `CONFLICT` and saves none of the operation. Unknown Task/bag fields remain preserved and baseline fields never write provenance or identity. These optional baseline inputs opt into conflict detection; direct callers that omit them intentionally replace the current values. Unchanged tabs supply no input and cannot conflict with unrelated edits.

`software-factory.attach` atomically updates the legacy worker string and the current Run's
`run-metadata.json` identity. Its expected `{stage, attempt, startedAt}` is checked under the lock
and again against pending state after transforms. A conflicting identity is refused; identical
attestations write nothing. Every start resets recognized metadata to an empty envelope even when
timestamps repeat. Clear/Stage changes remove recognized metadata, finish/fail retain it, and
opaque metadata is preserved and reported. See [ADR-0046](../agents/adr/0046-verified-workers-use-current-run-metadata.md).
