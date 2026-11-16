---
title: Add support for story tags.
stage: CHANGELOG
position: 1
updatedAt: 2026-11-16T19:41:00.210Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-79
pull_request: https://github.com/sgolovine/rowbly/pull/263
---

## Goal

A user can put tags on a Story. A tag has a label and a value. The Project config (`.rowbly/rowbly.config.json`) holds the list of tags. A Story can have zero, one or more tags. The value of a tag cannot change after creation. When a user removes a tag, Rowbly removes the tag from all Stories that have it.

Original request of the author:

- Add support for story tags
- A story may contain one or more tags.
- Tags have a label and a value. They are stored in rowbly config.
- Tag is created with a label and a value.
- The value cannot be changed after creation.
- When a tag is removed, we scan all stories and remove that tag from any story where it may exist.

## Scope

In scope:

- The config key `tags` and its validation.
- A new service `src/services/tag/tag.ts`: list, add, update the label, remove (with removal from all Stories).
- The Story frontmatter key `tags` (a list of tag values), and `tags` on the `Story` type.
- Set, add and remove tags of a Story through `createStory` and `updateStory`.
- Filter Stories by tag in `searchStories`.
- The CLI: `rowbly tag list|add|update|remove`, and tag options on `rowbly story create|update|search`.
- `rowbly doctor` checks for the tags of Stories.
- The documentation and `skills/rowbly-reference.md` (and its copies).

Not in scope:

- All TUI work (Settings section for tags, tags in the Story views and forms). This is ROW-80.
- Tags in the factory messages or prompts.
- Colours or other display options of a tag.

## Acceptance criteria

- [ ] `rowbly tag add --label "Front end" --value frontend` adds `{ "value": "frontend", "label": "Front end" }` to `tags` in `rowbly.config.json`. A test examines the config.
- [ ] `rowbly tag add` with a value that already exists fails with a conflict error (exit code of `ConflictError`). An empty label or a value that does not match the value pattern fails with a validation error.
- [ ] `rowbly tag list` shows all tags in config order. With `--json` it gives an array of `{ value, label }`.
- [ ] `rowbly tag update <value> --label <label>` changes only the label. The service and the CLI have no option to change the value. A test examines that the value and the Stories do not change.
- [ ] `rowbly tag remove <value>` removes the tag from the config and from the `tags` list of each Story that has it, in all Stage folders. A Story that has an empty list after the removal has no `tags` key. Stories without the tag are not written again (their `updatedAt` does not change). A test examines this.
- [ ] `rowbly tag update` or `rowbly tag remove` with an unknown value fails with a not-found error that gives the list of tag values.
- [ ] `rowbly story create --tag frontend --tag backend` and `rowbly story update <id> --tag <v>` (replace the list), `--add-tag <v>` and `--remove-tag <v>` change the `tags` frontmatter. A tag value that is not in the config fails with a validation error. `--tag` with `--add-tag` or `--remove-tag` in one command fails with a validation error. Duplicate values are saved one time.
- [ ] `rowbly story get <id> --json` gives `tags` (an array of values, `[]` when the Story has no tags).
- [ ] `rowbly story search --tag <v>` gives only Stories that have the tag. More than one `--tag` gives Stories that have all of the tags.
- [ ] A config with a tag that has no value, no label, a bad value or a duplicate value gives a config issue from `readConfig`. A config without `tags` is valid and has no tags.
- [ ] `rowbly doctor` does not report `tags` as an unknown frontmatter key. It reports a Story tag value that is not in the config, and `rowbly doctor --fix` removes that value from the Story.
- [ ] A new custom field cannot use the key `tags` (reserved key).
- [ ] Each changed service has updated tests. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Config type: add `tags?: TagConfig[]` to `ProjectConfig` in `src/services/config/config-types.ts`, with `interface TagConfig { value: string; label: string }`. Add the validation in `src/services/config/config-issues.ts` (follow `customFieldsIssues`). Add the value check to `src/services/config/config-keys.ts` (follow `checkFieldKey`). Add `tags` to `RESERVED_FIELD_KEYS`.
- Service: follow `src/services/custom-field/custom-field.ts`. Use `readConfig`, `writeConfig` and `rewriteStories` from `src/services/story-files/story-files.ts`. Return `false` from the change function for a Story without the tag so that the file is not written. Errors: `ValidationError`, `ConflictError`, `NotFoundError` from `src/services/errors/errors.ts`.
- Frontmatter: add `tags` to `LEADING_KEYS` in `src/services/story-files/story-files.ts`, after `dependsOn`. Add helpers `tagsOf(data)` and `withTags(data, tags)`, the same as `dependsOnOf` and `withDependsOn` (a missing or bad value gives `[]`; an empty list removes the key).
- Story: add `tags: string[]` to `Story`, and `tags`, `addTags`, `removeTags` to the inputs in `src/services/story/story-types.ts`. Follow the `dependsOn` / `addDependsOn` / `removeDependsOn` code in `src/services/story/story.ts`. Add `tags?: string[]` to `SearchStoriesInput`.
- CLI: new `src/commands/tag/tag.ts`, registered in `src/commands/register-commands/register-commands.ts` as resource `tag` ("Manage tags"). Update `register-commands.test.ts`. Add `--tag`, `--add-tag`, `--remove-tag` (repeatable, `collect`) to `src/commands/story/story.ts`.
- Doctor: add `tags` to the known keys in `unknownKeyIssues` of `src/services/doctor/story-checks.ts`, and add the check of unknown tag values with a fix.
- The custom-field service takes no lock itself. The tag service does the same. Do not add a lock to the service.
- Docs: update `docs/architecture/domain-concepts.md`, `docs/architecture/storage.md` and `docs/architecture/cli.md` in STE. Update `skills/rowbly-reference.md` and copy it to each `skills/<name>/references/rowbly-reference.md`.

## Assumptions

- The value is the identifier of the tag. Stories keep the value in the frontmatter list `tags`. The label is the display name and can change. Reason: the author says that the value cannot change, which agrees with an identifier; the custom fields use the same model (`key` and `label`).
- The value must match `^[a-z0-9][a-z0-9_-]*$`. Reason: a stable, file-safe identifier; the author gave no format.
- Both `--label` and `--value` are required on `tag add`. Reason: the author says "Tag is created with a label and a value".
- `tag update` changes only the label. Reason: the value cannot change, and a tag has no other property.
- `tag remove` does not ask for confirmation in the CLI. Reason: `custom-field remove` also does not ask.
- `story search --tag` with more than one tag uses AND. Reason: the same as `--field`, which also must match all values.
- The TUI work is split to ROW-80. Reason: one pull request cannot hold the service, CLI, doctor, docs and TUI work together.
- A Project whose existing custom field has the key `tags` is not migrated. Only new custom fields cannot use the key. Reason: smallest scope; no existing Project in this repository has such a field.

## Review findings

- Merge conflicts with `origin/main` (Changelog Stage). A merge of `origin/main` into `story/ROW-79` has conflicts in these files:
  - `docs/architecture/storage.md`
  - `src/services/config/config.ts`
- Merge `origin/main` into the branch, repair the conflicts, run all checks and push. The merge was aborted; the branch did not change.
