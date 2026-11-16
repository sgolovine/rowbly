---
title: Record canonical writes in an outbox
stage: DONE
position: 9
uid: 185c4ae9-1bec-4090-8da7-2c417751e881
createdAt: 2026-11-16T19:45:06.450Z
updatedAt: 2026-11-16T20:56:15.631Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-90
pull_request: https://github.com/sgolovine/rowbly/pull/273
---

## Goal

The services can record each canonical write as an outbox entry. A remote worker uses this record. Then the main machine can apply the changes of the remote worker to the board (ROW-94).

Read the Spec `remote-worker-hosts`, section "The outbox".

## Scope

In scope:

- A write recorder in `ServiceContext` (an optional `recorder` key). When it is set, each Story write records one entry. The entry has the field changes with `before` and `after` values: Story fields and Stage moves.
- Derived values (`updatedAt`, `position`, `createdAt`) are not in an entry.
- A write that changes no recorded value (for example `touchStory`, or an update with the same values) records no entry.
- The CLI turns on the recorder when an outbox setting is in its environment. It adds the entries to `outbox.jsonl` with a `seq` number. Each entry is durable before the command returns.
- With the recorder on, the services refuse a new Story, a Story delete, each Stage, Spec, tag, custom field, prompt, Project and factory-settings write, and each doctor repair. The error tells the worker that remote workers cannot do this.
- With the recorder on, the services refuse attachment writes (`addAttachment`, `removeAttachment`, and `updateStory` with `attachments`) until ROW-91 records them.

Not in scope:

- Attachment entries (`attachment.add`, `attachment.remove`) and the blob folder. ROW-91 adds them.
- The host agent that sets the environment (ROW-89, ROW-92).
- The apply of the entries on the main machine (ROW-94).
- The removal of acknowledged entries from `outbox.jsonl`. ROW-94 and the host agent do this.

## Acceptance criteria

- [ ] With a recorder in `ServiceContext`, `updateStory` records one entry for each call that changes a value. The entry has `storyId` and a `changes` list with one item for each changed path, each with `before` and `after`. A test examines each path: `title`, `description`, `stage`, `fields.<key>`, `tags` and `dependsOn`.
- [ ] A Stage move gives the change `{ "path": "stage", "before": "<old key>", "after": "<new key>" }`. A test examines it.
- [ ] No entry has `updatedAt`, `position` or `createdAt`. An update without a changed value records no entry. A test examines both.
- [ ] With a recorder, each refused service gives a `ConflictError` and writes no file in `.rowbly/`. The message tells that a remote worker cannot do this write. Tests cover `createStory`, `deleteStory`, a Stage write, a Spec write, a tag write, a custom-field write, `setPrompt`, `updateProject`, a factory-settings write and an attachment write.
- [ ] Without a recorder, the behaviour of all services does not change. The existing tests pass.
- [ ] `rowbly story update` with `ROWBLY_OUTBOX` and `ROWBLY_THREAD_ID` in the environment writes the change to the Project and appends one JSON line to `$ROWBLY_OUTBOX/outbox.jsonl`. The line has `seq`, `opId`, `threadId`, `storyId` and `changes`. A CLI test examines it.
- [ ] `seq` starts at 1 in an empty outbox and increases by 1 for each entry, also after an earlier command and after the first lines are removed from the file. A test runs a sequence of writes and examines the order.
- [ ] Two parallel writers to the same outbox do not get the same `seq`. A test examines it.
- [ ] `ROWBLY_OUTBOX` without `ROWBLY_THREAD_ID` makes each CLI command fail with a `VALIDATION` error before it writes.
- [ ] The services do not print, prompt or exit. A service does not read `process.env`. The front ends stay thin. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `ServiceContext` is in `src/services/workspace/workspace.ts`. Add `recorder?: WriteRecorder`.
- Put the recorder in a new service folder `src/services/outbox/` (`outbox.ts` and `outbox.test.ts`): the `WriteRecorder` interface, the entry types, the change calculation and the file-backed recorder that appends to `outbox.jsonl`.
- The entry shape is the shape of the Spec: `{ seq, opId, threadId, storyId, changes: [{ path, before, after }] }`. `opId` is a new unique id for each entry, for example `randomUUID()`. The paths are `title`, `description`, `stage`, `fields.<key>`, `tags` and `dependsOn`. List values (`tags`, `dependsOn`) are complete lists in `before` and `after`.
- Story writes are in `src/services/story/story.ts`. `updateStoryFields` has the old file and the new frontmatter and body. Calculate the changes there from the values before and after, and record the entry after `saveStoryFile` succeeds. `touchStory` changes only `updatedAt`, so it records nothing.
- A small guard, for example `refuseRemoteWrite(ctx, "create a Story")`, throws the `ConflictError`. Call it at the start of each refused service: `createStory`, `deleteStory` (`story.ts`), `createStage`, `updateStage`, `deleteStage` (`stage.ts`), `createSpec`, `updateSpec`, `deleteSpec`, `linkSpec`, `unlinkSpec` (`spec.ts`), `addTag`, `updateTag`, `removeTag` (`tag.ts`), `addCustomField`, `updateCustomField`, `removeCustomField` (`custom-field.ts`), `updateProject`, `initProject` (`project.ts`), `setPrompt` (`prompts.ts`), `updateFactorySettings` and the check writes (`factory-settings/`), `repairDuplicateStoryIds` (`story-renumber.ts`), the doctor fix path, `addAttachment` and `removeAttachment` (`attachment.ts`), and `updateStory` when `input.attachments` is not empty.
- The CLI makes the `ServiceContext` in `run` in `src/commands/output/output.ts` (now `{ cwd }`). Read `ROWBLY_OUTBOX` and `ROWBLY_THREAD_ID` there, and put the file-backed recorder in the context. Commands that do not use `run` and write canonical files must also get the recorder, or the guard must refuse them.
- Order of the writes: the service writes the Story file first. Then the recorder appends the entry. A failed Story write records no entry.
- `seq` and the append: take an exclusive lock on `$ROWBLY_OUTBOX/outbox.lock` with the flock helper pattern of `src/services/project-write/project-write.ts` (Linux and flock are prerequisites of a worker host). Under the lock, find the next `seq` from `$ROWBLY_OUTBOX/seq` (the last given `seq`), append the line to `outbox.jsonl`, write the new `seq`, `fsync` the files, then release the lock. The `seq` file keeps the order when the host removes acknowledged lines from `outbox.jsonl`.
- Do not take the Project write lock while you hold the state lock. The recorder does not use the state lock.
- The recorder and the outbox module must not load Pi.
- Update `docs/architecture/service-layer.md` (the `recorder` key of `ServiceContext`) and `docs/architecture/storage.md` (the outbox files). Write them in STE.

## Assumptions

- The environment setting is two variables: `ROWBLY_OUTBOX` (the absolute path of the outbox folder of the host) and `ROWBLY_THREAD_ID`. Reason: the Spec says "an outbox setting in the environment", and each entry needs a `threadId`. The folder holds `outbox.jsonl` and, in ROW-91, `blobs/`.
- One outbox folder can have entries of more than one Thread, and `seq` is unique in the folder. Reason: the Spec records the last applied `seq` for each host.
- `deleteStory` is refused. Reason: version 1 of the Spec permits only Story field changes, Stage moves and attachments.
- Tag and custom-field definition writes, prompt writes, factory-settings writes and doctor repairs are refused as config changes. Reason: the Spec refuses each config change.
- Attachment writes are refused in this Story, and ROW-91 replaces the refusal with records. Reason: no remote write may change the copy without an entry.
- The entry is written after the Story file. A crash between the two writes loses the entry, but the main machine never gets a change that failed. Reason: a change that the command reported as failed must not come to the board.
- `dependsOn` and `tags` are recorded as full lists. Reason: the compare-and-set of ROW-94 compares one value for each path.
- The refusal uses `ConflictError`. Reason: the reference maps `CONFLICT` to "a record exists or the action is not permitted now", and `VALIDATION` is for bad input.
