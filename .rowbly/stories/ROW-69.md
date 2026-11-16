---
title: Organize story by stage within `stories` folder.
stage: IN_DEVELOPMENT
position: 1
createdAt: 2026-11-16T16:07:13.306Z
updatedAt: 2026-11-16T16:28:53.947Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-69
pull_request: null
---

## Goal

Now `.rowbly/stories/` is a flat folder that holds the files of all the Stories of the board. Change the layout so that each Story file is in a subfolder with the key of its Stage. Then a person who reads the files, or a Git diff, sees the Stage of each Story from its path.

Example of the new layout:

```
.rowbly/
  stages/
    BACKLOG.md
    IN_REFINEMENT.md
    ...
  stories/
    BACKLOG/
      ROW-01.md
    IN_REFINEMENT/
      ROW-02.md
    ...
```

## Scope

In scope:

- A Story file is at `stories/<STAGE_KEY>/<projectKey>-<n>.md`. `<STAGE_KEY>` is the `stage` value of the frontmatter.
- A new Story is written in the folder of its Stage.
- A `story update` that changes the Stage moves the file to the folder of the new Stage (write the new file, then remove the old file).
- A Stage rename (new key) moves the Stories of the Stage to the folder of the new key and removes the old folder when it is empty.
- A Stage delete with `moveStoriesTo` moves the Stories to the folder of the target Stage and removes the old folder when it is empty.
- A Project key change renames the Story files in their Stage folders.
- Each reader of Story files (`story-files`, `story-read`, `story`, `stage`, `spec`, `project`, `project-status`, `custom-field`, the `doctor` checks) finds the Story files in the Stage folders.
- Compatibility and migration: the readers also read a Story file that is directly in `stories/` (the old flat layout). Thus an existing Project continues to work after the upgrade. `rowbly doctor` reports each Story file that is not in the folder of its Stage (flat file, or wrong folder) as a warning. `rowbly doctor --fix` moves the file to the correct folder.
- `rowbly doctor` reports an error when two files have the same Story ID (for example `stories/ROW-01.md` and `stories/BACKLOG/ROW-01.md`, or the same ID in two Stage folders). `--fix` does not change these files.
- Update the tests of each changed service.
- Update the documentation: `docs/architecture/storage.md` (layout and the Stories section), `docs/architecture/service-layer.md` if a description changes, and `skills/rowbly-reference.md` (the layout block and the example `path` and `file` values). Copy `skills/rowbly-reference.md` to each `skills/<name>/references/rowbly-reference.md`.

Not in scope:

- No change to the `stage` key of the frontmatter. It stays in the file.
- No change to `attachments/<ID>/`, `specs/`, `stages/` or `prompts/`.
- No change to the TUI, apart from changes that the service changes make necessary.
- No automatic migration on a normal read. Only `doctor --fix` and the normal writes (update, move, rename) move a file.

## Acceptance criteria

- [ ] `story create` with stage `BACKLOG` writes `.rowbly/stories/BACKLOG/<KEY>-<n>.md`. A test examines the path.
- [ ] `story update --stage <NEW>` moves the file to `stories/<NEW>/` and no file stays in the old Stage folder. The `path` of the JSON result is the new path. A test examines it.
- [ ] A move of a Story inside the same Stage (position change only) does not move the file.
- [ ] A Stage rename from `A` to `B` moves all Story files from `stories/A/` to `stories/B/`, and `stories/A/` does not exist after the rename. A test examines it.
- [ ] A Stage delete with `moveStoriesTo` moves the Story files to the folder of the target Stage. A test examines it.
- [ ] A Project key change renames the files in their Stage folders. A test examines it.
- [ ] `story get`, `story search` and the board read Story files in Stage folders and Story files directly in `stories/`. A test examines a Project that has the two layouts together.
- [ ] The next Story number is the maximum number of all Story files in all folders plus 1.
- [ ] `rowbly doctor` gives a warning for a Story file that is directly in `stories/` or in the folder of a different Stage. `rowbly doctor --fix` moves it to `stories/<stage>/`. A test examines it.
- [ ] `rowbly doctor` gives an error for two files with the same Story ID in different folders. A test examines it.
- [ ] The doctor checks of spec links, attachment owners, Thread Story IDs and story dependencies find Stories in Stage folders (no false "missing Story" issue). A test examines it.
- [ ] `docs/architecture/storage.md` and `skills/rowbly-reference.md` (and its copies in `skills/*/references/`) show the new layout.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Paths: `projectPaths()` in `src/services/workspace/workspace.ts` gives `storiesDir`. Add a helper for the Stage folder (for example `storyStageDir(paths, stageKey)`).
- `src/services/story-files/story-files.ts` is the center of the change: `storyPath()` must take the Stage key; `readStoryFile()`, `listStoryFileNames()` and `readStoryFiles()` must list the Story files in `stories/` and in each subfolder of `stories/`. `StoryFileName` needs the relative path or the folder, not only `fileName`. `rewriteStories()` must move a file when the change sets a different `stage` (Stage rename and delete use it).
- Use one helper that writes a Story file and moves it when its Stage folder changes. Write the new file with `writeFileAtomic()` first, then remove the old file. Then a failure does not lose the Story. Remove an empty old Stage folder after a move.
- `src/services/story/story-read.ts`: `readCanonicalStoryFile()` / `locateStoryFile()` read the canonical path first. Make the canonical path use the Stage folder, and keep the fallback scan of all folders.
- Files that use `storiesDir` or the Story file helpers: `story/story.ts`, `story/story-read.ts`, `stage/stage.ts`, `spec/spec.ts`, `project/project.ts`, `project-status/project-status.ts`, `custom-field/custom-field.ts`, `doctor/story-checks.ts`, `doctor/story-dependency-checks.ts`, `doctor/spec-checks.ts`, `doctor/attachment-checks.ts`, `doctor/project-checks.ts`.
- A Story with a `stage` value that is not a configured Stage, or that is not valid for `STAGE_KEY_PATTERN` (`src/services/config/config-keys.ts`), stays where it is. The existing doctor check of the Stage reports it. After `--fix` sets the Stage, the location check moves it.
- A subfolder of `stories/` with a name that does not match `STAGE_KEY_PATTERN` is not read as a Stage folder. Doctor reports it as a warning.
- `story-watch` uses a recursive watch of `.rowbly/`, so it sees changes in the subfolders. Examine that the watch test still passes.
- The canonical commit (`src/services/project-write/project-commit.ts`) uses `git add --all` on the changed paths with rename detection off. A move gives a delete and an add. No change is necessary.
- Keep the lock rules: the moves happen inside the existing Project write lock of each service operation.
- Follow `.agents/skills/rowbly-code-style/SKILL.md`. Use `.js` extensions in relative imports.

## Assumptions

- The `stage` key in the frontmatter stays the authority for the Stage. The folder is a copy of this value. Reason: the existing services, doctor and factory read the frontmatter, and a person can edit a file by hand. This is the smallest change.
- The old flat layout stays readable, and `doctor --fix` moves the files. There is no automatic migration on a read. Reason: a read must not write files, and doctor is the existing repair path of Rowbly.
- The folder name is the Stage key (for example `IN_REFINEMENT`), not the label. Reason: the example of the author uses the keys, and `stages/` uses the keys.
- The attachments stay in `attachments/<ID>/`. Reason: the author asked only about Story files, and an attachment folder does not depend on the Stage.
- An empty Stage folder is not created for a Stage with no Stories, and an empty Stage folder is removed after the last Story moves out. Reason: Git does not keep empty folders, so empty folders give no value.
