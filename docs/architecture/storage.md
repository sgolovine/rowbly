# Storage

Rowbly keeps each Project in a `.rowbly/` folder of ordinary files. Users can edit these files by
hand, and `rowbly doctor` finds and repairs problems. Rowbly also keeps two files for each user,
`~/.rowblyrc.json` and the model cache `~/.cache/rowbly/pi-catalog.json`. This page gives the layout
and the rules for each file.

Read this when you read or write a file in `.rowbly/`, when you change a rule of `rowbly doctor`, or
when you change `~/.rowblyrc.json`.

## Where Rowbly finds a Project

Rowbly keeps a Project in `.rowbly/`, in the directory where Rowbly runs.

- Services find the nearest `.rowbly/` at or above `ctx.cwd`, as Git finds its repository
  (`findProject()` in `src/services/workspace/`). A folder is a Project only if it has
  `.rowbly/rowbly.config.json`.
- The `-C <dir>` (`--cwd <dir>`) option of the CLI sets this directory.
- The TUI opens only a Project in the directory where it runs (`hasProject()`). If that directory has
  no Project, the TUI shows the onboarding steps, also when a parent directory has a Project.

## Layout of `.rowbly/`

```
.rowbly/
  rowbly.config.json  # projectName, projectKey, customFields [{key,label,type,options?}], tags? [{value,label}], stages [{key,label,enabled,expandedByDefault?}], features? {specs}, display? {compactThreads,timeZone,storySidebar}, skills? [{name,harnesses}], factory? {maxWorkers,supervisorModel,workerModel,stageWorkerModels,storyWorkerModels,fallbackWorkerModels,git,checks,dependencies,placement}
  prompts/SYSTEM.md   # the Project prompt: the supervisor and all workers get it
  prompts/SUPERVISOR.md # the Supervisor prompt: only the supervisor gets it
  prompts/WORKER.md   # the Worker prompt: all workers get it
  stories/BACKLOG/ROW-01.md # stories/<stage key>/<projectKey>-<n>.md; frontmatter: title, stage, uid?, dependsOn?, tags?, createdAt?, updatedAt?, one key per custom field (null = unset); the body is the description
  stages/BACKLOG.md   # <stage key>.md; the whole file is the stage's prompt
  specs/login-page.md # <slug>.md; frontmatter: title, stories (a list of story IDs); the body is the spec
  attachments/ROW-01/ # manifest.json and one <id>[.<ext>] file for each attachment of a story
  .gitignore          # /state.json* and /runtime/; existing text stays
  state.json          # v1 policy state; the native factory writes it
  runtime/            # private, ignored; see native-factory/runtime-and-locks.md
```

`projectPaths()` and `runtimePaths()` in `src/services/workspace/` give the paths of most items.

The files of `runtime/` and `state.json` belong to the native factory. See
[native-factory/runtime-and-locks.md](native-factory/runtime-and-locks.md).

## Config

`rowbly.config.json` holds the Project name and key, the custom fields, the tags, the Stages, the features, the
display options, the installed skills and the factory settings. The `config` service reads, checks and writes it.

- The order of `stages` in the config is the order of the board.
- The custom field types are `string`, `number`, `boolean`, `url`, `date` (YYYY-MM-DD) and `select`
  (with `options`).
- The optional `tags` list holds the tags of the Project, in order. Each tag has a `value` and a
  `label`. A config without `tags` has no tags. See [Tags](#tags).
- If a service renames or removes a Stage or a field, it also writes the change to the Stories that
  use it. This keeps the files consistent.
- The `skills` list holds the bundled skills that the Project has installed. Each entry has the `name`
  of a skill and the `harnesses` that have a copy. See [skills-and-stages.md](skills-and-stages.md).
- The optional `display` key holds the display options of the TUI. It has three keys:
  - `compactThreads` (boolean). When `compactThreads` is `true` or is not set, each Thread in the
    Threads view and in the Threads tab of a Story uses one line. When it is `false`, each Thread uses
    up to three lines. Set it with `rowbly project update --compact-threads <on|off>` or in
    Settings › Display.
  - `timeZone` (string). The IANA time zone of the Story times in the TUI, for example
    `Europe/Berlin`. When it is not set, the TUI uses the time zone of the system. Set it with
    `rowbly project update --time-zone <zone>` or in Settings › Display. `--time-zone ""` removes the
    key. The time zone changes only the display. The Story files keep the times in UTC.
  - `storySidebar` (`"regular"`, `"expanded"` or `"remember"`). The state of the Story sidebar when it
    opens from closed. `regular` (or a value that is not set) opens it at the regular width.
    `expanded` opens it over the Story list. `remember` opens it in the last state that the user
    selected while the TUI runs. Rowbly does not keep this state after it quits. Set it in
    Settings › Display. `rowbly project update` has no flag for it.

  A `display` value that is not an object, an unknown key, a `compactThreads` value that is not a
  boolean, a `timeZone` that `Intl.DateTimeFormat` does not accept or a `storySidebar` value that is
  not one of the three values gives a config issue.
- The `factory` key holds the factory settings. See [Factory settings](#factory-settings). Each write
  of the config keeps this key.

## Factory settings

The optional `factory` key of `rowbly.config.json` holds the settings of the native factory. The
`factory-settings` service reads, checks and writes it. All keys are optional:

| Key                    | Type    | Default            | Effect                                                 |
| ---------------------- | ------- | ------------------ | ------------------------------------------------------ |
| `maxWorkers`           | integer | `4`                | The maximum number of workers. The minimum is 1.       |
| `supervisorModel`      | object  | Pi selects a model | The model choice of the supervisor.                    |
| `workerModel`          | object  | Pi selects a model | The model choice of the workers.                       |
| `stageWorkerModels`    | object  | none               | The worker model overrides for each Stage key.         |
| `storyWorkerModels`    | object  | none               | The worker model overrides for each Story ID.          |
| `fallbackWorkerModels` | array   | none               | The worker models to use when a provider is paused.    |
| `git`                  | object  | the sync defaults  | The canonical commits and the Git sync of the factory. |
| `checks`               | object  | none               | The check queue and the named checks of the workers.   |
| `dependencies`         | object  | `pullUpstream` off | `pullUpstream` moves stuck upstream Stories (boolean). |
| `placement`            | string  | `prefer-local`     | The machine of a new worker. See below.                |

`placement` is `prefer-local`, `most-free` or `prefer-remote`. See
[native-factory/pi-runtime-and-auth.md](native-factory/pi-runtime-and-auth.md#placement).

A model choice has `provider`, `modelId` and an optional `thinkingLevel`. Without the `factory` key,
the worker limit is four and Pi selects the default models. Without the `checks` key, the factory has
no checks. See [native-factory/checks.md](native-factory/checks.md#settings) for the keys of `checks`.

The config check of the board examines only that `factory` is an object. The `factory-settings`
service examines all keys. Thus a `factory` section that is not valid stops the factory commands,
but the board continues to work. `rowbly doctor` shows the problem as an error.

The factory settings can hold worker model overrides. `stageWorkerModels` maps a Stage key to a model
choice. `storyWorkerModels` maps a Story ID to a map from a Stage key to a model choice. The order of
priority is the Story override, then the Stage override, then the model of the supervisor, then
`workerModel`. See
[native-factory/pi-runtime-and-auth.md](native-factory/pi-runtime-and-auth.md#worker-model-overrides).

`fallbackWorkerModels` is an ordered list of model choices. When the provider of the selected worker
model is paused, the manager uses the first model of the list whose provider is not paused. If the key
is absent, there is no fallback. If the value is not an array, or an entry is not a valid model choice,
the section is not valid, and `rowbly doctor` shows an error. `rowbly factory configure
--fallback-worker <provider/model>` (repeat) replaces the list. `--clear-fallback-workers` removes the
key. See [native-factory/pi-runtime-and-auth.md](native-factory/pi-runtime-and-auth.md#fallback-worker-models).

The optional `git` section sets the canonical commits and the Git sync of the factory:

```json
{
  "projectName": "Rowbly",
  "projectKey": "ROW",
  "customFields": [],
  "stages": [{ "key": "BACKLOG", "label": "Backlog", "enabled": true }],
  "factory": {
    "maxWorkers": 4,
    "git": {
      "commitMessage": "chore(rowbly): sync board",
      "authorName": "Rowbly Bot",
      "authorEmail": "bot@example.com",
      "push": true,
      "pull": true,
      "syncIntervalSeconds": 300
    }
  }
}
```

| Key                   | Type    | Default | Effect                                                        |
| --------------------- | ------- | ------- | ------------------------------------------------------------- |
| `commitMessage`       | string  | none    | The subject of the canonical commits.                         |
| `authorName`          | string  | none    | The author name of the canonical commits.                     |
| `authorEmail`         | string  | none    | The author email of the canonical commits.                    |
| `push`                | boolean | `false` | Push the local commits of the canonical branch.               |
| `pull`                | boolean | `false` | Pull the commits of the upstream branch.                      |
| `syncIntervalSeconds` | integer | `300`   | The time between two syncs. The range is 60 to 86400 seconds. |

- Each value is optional. Each string that is set must not be empty.
- Set `authorName` and `authorEmail` together, or do not set them.
- A `git` section that is not valid makes the settings not valid.
- A write does not add the absent `git` sync keys. The service gives their default values when it
  reads the settings. A write always puts `maxWorkers` in the `factory` section, also when its value
  is the default value of `4`.

### Upgrade from `factory.json`

Older versions of Rowbly kept the factory settings in `.rowbly/factory.json`, with a `version` key.
Rowbly does not read this file now. To upgrade a Project, do these steps:

1. Stop the factory with `rowbly factory stop`.
2. Upgrade Rowbly.
3. Run `rowbly doctor --fix`. It moves the settings into the `factory` key and deletes the file. The
   `checks` section moves with no change.
4. Start the factory again with `rowbly factory start`.

A factory start and each write of the factory settings fail with a `CONFLICT` error while
`factory.json` exists. Examples of writes are `rowbly factory configure` and `rowbly factory check`.
The config does not change. The hint tells you to run `rowbly doctor --fix`. The commands that only
read the settings continue to work.

## Stories

A Story file is `stories/<stage key>/<projectKey>-<n>.md`, for example `stories/BACKLOG/ROW-01.md`.
The number has at least two digits. The frontmatter has `title`, `stage`, a `uid`, an optional `dependsOn` list, an optional `tags` list,
the optional times `createdAt` and `updatedAt`, an optional `branch` and one key for each custom field. A `null` value means that the field has no value. The Markdown body
is the description. The `branch` key is the Git branch of the Story. The repair of a
[duplicate Story ID](#duplicate-story-ids) writes it. Without it, the native factory uses `story/<ID>`.

### Stage folders

Each Story file is in the folder of its Stage. The name of the folder is the Stage key. Thus a person
who reads the files or a Git diff can see the Stage of each Story from its path.

- The `stage` key of the frontmatter is the authority for the Stage. The folder is a copy of this value.
- `story create` writes the file in the folder of its Stage.
- A write that changes the Stage moves the file: `story update --stage`, a Stage rename and a Stage
  delete with `moveStoriesTo`. The service writes the new file first, then it removes the old file.
  Thus a failure does not delete the Story.
- A Project key change renames the files in their Stage folders.
- The service removes a Stage folder when its last Story moves out. Rowbly does not make an empty
  Stage folder.
- A Story with a `stage` value that is not in the config stays in its folder. `rowbly doctor` reports
  the Stage.
- A write does not replace a different file of the same Story. The Story stays in its old folder, and
  `rowbly doctor` reports the two files.

Older versions of Rowbly wrote all Story files directly in `stories/`. The services also read these
files, so an older Project continues to work. A read does not move a file. These steps move a file to
the folder of its Stage:

- A write of the Story, for example `story update`.
- `rowbly doctor --fix`.

`rowbly doctor` examines the Story folders:

| Problem                                                                                                                  | Severity | `--fix`                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A Story file is directly in `stories/`, or in the folder of a different Stage.                                           | warning  | Moves the file to `stories/<stage key>/`.                                                                                                 |
| Two files have the same Story number and the same `uid`, and are different only in `stage`, `position` and `updatedAt`.  | error    | Removes the old copy, for example `ROW-78: removed the old copy in DONE`. See [Copies of a Story](#copies-of-a-story).                    |
| Two files have the same Story number and the same `uid`, and other content is different.                                 | error    | None. The files stay. Merge them.                                                                                                         |
| Two files of the Project key have the same Story number, in one folder or in different folders.                          | error    | Gives the newer Story the next free number, for example `ROW-77 → ROW-79: duplicate ID`. See [Duplicate Story IDs](#duplicate-story-ids). |
| A Story of the group has a running attempt, or two Stories without a `uid` have factory state, or a file cannot be read. | error    | None. The files stay.                                                                                                                     |
| Two files with a different key have the same Story number.                                                               | error    | None. The files stay.                                                                                                                     |
| A subfolder of `stories/` has a name that is not a Stage key. Rowbly does not read it.                                   | warning  | None.                                                                                                                                     |

### Copies of a Story

Two or more Story files with the same Story number and the same `uid` are copies of one Story. For example,
a Stage move writes the new file and the old file stays in the folder of the old Stage.

The repair runs at the same places as the repair of a duplicate Story ID, and before it. The TUI shows one
info toast for each removed copy, and `rowbly doctor --fix` shows one fixed issue for each removed copy, for
example `ROW-78: removed the old copy in DONE`. Without `--fix`, `rowbly doctor` shows the fix of the error,
and it does not change a file.

- If the copies are different only in `stage`, `position` and `updatedAt`, the repair keeps one copy and
  removes the other copies.
- If the copies are different in a different frontmatter key or in the body, the repair does not change a
  file. Merge the copies yourself.

These rules select the copy that stays:

1. The copy with the newest valid `updatedAt` stays.
2. If the times are equal, the file with the newest modification time stays.
3. If the times are equal, the path that comes first in string order stays.

After the repair, the files that stay go to the rules of [Duplicate Story IDs](#duplicate-story-ids), for
example a file with no `uid` or with a different `uid`. If a group has copies with different content, the
repair does not change a file of the group.

The repair takes no lock. It reads each file again before it removes a copy. If a copy changed or
disappeared after the plan, the repair removes no file of the group.

### Duplicate Story IDs

Two Story files can get the same Story ID. For example, an older build of `rowbly` reads only the flat
`stories/` folder and gives out a number again, or a Git merge adds a second file with the same ID.
`ROW-7.md` and `ROW-07.md` also have the same ID.

The repair runs in `rowbly doctor --fix` and each time that the TUI loads or reloads the board. It does not
run in other commands or in the factory daemon. The TUI shows one info toast for each change, and
`rowbly doctor --fix` shows one fixed issue for each change. Without `--fix`, `rowbly doctor` shows the
change as the fix of the error, and it does not change a file.

These rules select the Story that keeps the ID. The other Stories of the group get the next free number:

1. The Story with the earliest valid `createdAt` keeps the ID. A Story with no valid `createdAt` is older
   than a Story with one.
2. If the times are equal, the file with the earlier modification time keeps the ID.
3. If the times are equal, the path that comes first in string order keeps the ID.

When each Story of the group has a `uid`, the Stories are different Stories. Then these rules apply:

- Factory state does not change the Story that keeps the ID. The oldest Story keeps it.
- If `.rowbly/state.json` has an attempt with the status `preparing` or `running` for a Story of the group,
  the repair does not change the group. The attempt matches by its `storyUid` or by the Story ID. A running
  worker can write the Story file or its attachments. The next load of the board or `doctor --fix` tries
  again.

When a Story of the group has no `uid`, the factory state rule comes before the age rules. A Story has
factory state when its `worktree` or `pull_request` value is not empty, or when `.rowbly/state.json` has an
attempt with its ID and its Stage.

- If one Story of the group has factory state, that Story keeps the ID.
- If more than one Story of the group has factory state, Rowbly does not change the group. `rowbly doctor`
  reports the error with no fix.

The repair writes the new file at `stories/<stage key>/<projectKey>-<n>.md`. The file has the same
frontmatter and body, and a new `updatedAt`.

When each Story of the group has a `uid`, the Story with the new number keeps its worktree, its branch
and its records:

- If the Story has no `worktree` value, the config has the `worktree` field and the folder
  `<root>-worktrees/<old ID>` exists, the repair writes this path to `worktree`.
- If the Story has no `pull_request` and no `branch` value, and the branch `story/<old ID>` exists, the
  repair writes it to the `branch` key. The native factory uses the `branch` key in place of
  `story/<ID>`.
- The entries of the attachment manifest of the old ID with the `uid` of the Story move to
  `attachments/<new ID>/`. The other entries stay.
- The attempts, the Threads and the outbox entries with the `storyUid` of the Story do not change. A read
  finds the Story by its `uid`.

The repair does not rename a Git branch or a worktree folder, and it does not change a pull request. The
other references to the old ID stay with the Story that keeps the ID: the `dependsOn` lists, the Spec
links, the attachments and the factory attempts without `storyUid`. The result of the repair lists them in
`stayed`, and `rowbly doctor --fix` shows them in the fix text of the issue, so that you can correct a
reference.

The repair takes no lock. It creates the new file only if no file is at its path, and it removes the
old file only if the old file did not change. Thus two repairs at the same time do not lose or copy
a Story.

### Position

The Stories of a Stage are in the order of their `updatedAt` times. The most recent Story is at the top.
`sortStoryFiles` in `src/services/story-files/story-files.ts` sets this order.

- The service compares the times, not the strings.
- A Story without a valid `updatedAt` comes after the Stories that have one.
- Stories with the same time, or with no valid time, are in the order of their numbers.
- The `position` value of a `Story` record is the 1-based place of the Story in this order. The service
  calculates it. It does not write it to the file.
- A Story that changes goes to the top of its Stage, because the change sets its `updatedAt`. A new
  Story is also at the top.
- You cannot set the place of a Story in its Stage. `story update` has no `--position` option.
- Older versions of Rowbly wrote a `position` key to the Story files. This key has no effect now. The
  services keep it in the file, and `rowbly doctor` does not report it.

### uid

The `uid` key is the permanent identity of the Story. Its value is a lower-case UUID v4, for example
`uid: 0b7c6f3e-2d4a-4f1e-9c8b-5a6d7e8f9a0b`. The Story ID (`ROW-01`) can change, but the `uid` does not
change. Thus two Story files with the same `uid` are copies of the same Story.

- `story create` writes a new `uid` from `crypto.randomUUID()`.
- No other write changes the `uid` or adds a `uid`: a `story update`, a Stage move, a Project key change
  and the doctor fix of a duplicate Story ID keep the key as it is.
- The `Story` record gives `uid` when the frontmatter has a string value. An older Story without `uid`
  has no `uid` in the record.
- `uid` comes after `stage` (and an old `position` key) and before `dependsOn`. A custom field cannot
  use the key `uid`, because it is reserved.
- No CLI flag and no TUI control sets or shows the `uid`.

`rowbly doctor` examines the `uid` of each Story:

| Problem                         | Severity | `--fix`                                           |
| ------------------------------- | -------- | ------------------------------------------------- |
| The Story has no `uid`.         | warning  | Adds a new `uid`. It does not change `updatedAt`. |
| The `uid` is not a UUID string. | error    | None. Repair the key by hand.                     |

A new `uid` is not a change of the content of the Story. Thus the fix keeps `updatedAt` and the order
of the Stories in the Stage. If `--fix` also repairs a different key of the same Story, the Story gets
a new `updatedAt` for that repair.

### Times

The `createdAt` key has the time when the Story was created. The `updatedAt` key has the time of the
last change of the Story. Each value is an ISO 8601 UTC string from `Date.prototype.toISOString()`,
for example `2025-01-02T03:04:05.678Z`. The services get the time from `ctx.now`, so that a test can
set it.

- `story create` writes the two keys with the same value.
- Each write that changes a Story file sets `updatedAt`: a `story update`, a Stage rename, a Stage
  delete that moves Stories, an add, rename or remove of a custom field, the removal of a tag that the
  Story has, a Project key change that
  changes `dependsOn`, the removal of a deleted Story from a `dependsOn` list, and a repair of
  `rowbly doctor --fix`. An add or a remove of an attachment also sets `updatedAt`.
- An update that does not change the Story file does not change `updatedAt`.
- When a Story moves to a different Stage, the service writes only the file of that Story. The other
  Stories keep their files and their `updatedAt`.
- `createdAt` does not change after the create. Rowbly does not add `createdAt` to an older Story.
- The two keys come after `dependsOn` and `tags`, and before the custom fields. The YAML parser keeps them as
  strings, not as dates.
- A missing value, or a value that is not a valid date string, reads as `null` in the `Story` record.
- The TUI shows the times in the General tab of a Story, in the time zone of `display.timeZone`.

### Dependencies

The `dependsOn` key is a list of the IDs of the upstream Stories of the Story, for example
`dependsOn: [ROW-01, ROW-02]`. See [domain-concepts.md](domain-concepts.md#story-dependencies).

- Only the downstream Story keeps the relation. The services calculate the reverse list (`blocks`).
- A Story without dependencies has no `dependsOn` key. When the list becomes empty, the service
  removes the key. A change of a different key does not add `dependsOn`.
- `dependsOn` comes after `stage` (and an old `position` key) and before the custom fields. A custom field cannot have this
  key, because a custom field key has only lower-case letters, digits and `_`.
- The service saves each ID in the canonical form (`row-1` and `1` become `ROW-01`). It removes
  duplicates and keeps the order of the input.
- On each create and update, the service makes sure that each ID is a Story of the same Project, that
  the Story does not depend on itself, and that the list does not make a cycle. If a check fails, the
  service gives a `ValidationError` with `details` (for example `{ cycle: ["ROW-03", "ROW-01",
  "ROW-03"] }`), and it saves nothing.
- When you delete a Story, the service removes its ID from the `dependsOn` list of each downstream
  Story. The result has one warning for each changed Story.
- When the Project key changes, the service changes the IDs in each `dependsOn` list to the new key.
- A `dependsOn` value that is not a list reads as `[]`. Items that are not strings are ignored.

### Tags

The `tags` key is a list of the values of the tags of the Story, for example `tags: [frontend, docs]`.
The `tags` list of the config holds the tags of the Project. See
[domain-concepts.md](domain-concepts.md#tags).

- A tag value has only lower-case letters, digits, `_` and `-`. It starts with a letter or a digit.
  Each value in the config must be unique. Each tag must have a label.
- The `tag` service lists, adds and removes tags, and changes the label of a tag. It cannot change the
  value of a tag.
- A Story without tags has no `tags` key. When the list becomes empty, the service removes the key.
- `tags` comes after `dependsOn` and before the times and the custom fields. A custom field cannot use
  the key `tags`, because it is reserved.
- On create and update, each value must be a tag of the Project. Else the service gives a
  `ValidationError` and saves nothing. The service removes duplicates and keeps the order of the input.
- When you remove a tag, the service removes its value from the `tags` list of each Story that has it,
  in all Stage folders. The other Stories do not change, and they keep their `updatedAt`.
- A `tags` value that is not a list reads as `[]`. Items that are not strings are ignored.
- `rowbly doctor` reports a `tags` value that is not a list of strings, and each value that is not a
  tag of the Project. `--fix` keeps only the string values, and removes each unknown value.

Older versions of Rowbly wrote an agent lock to the `agentLock` key of a Story. Rowbly does not use
this key now. `rowbly doctor` shows a warning for each Story file with an `agentLock` key. To remove
the keys, run `rowbly doctor --fix`. The command keeps all other frontmatter and the description.

## Stages

Each Stage has a file `stages/<stage key>.md`. The whole file is the prompt of the Stage. A Stage in
the config can be disabled with `enabled: false`.

A Stage in the config can have the optional key `expandedByDefault`. The value must be `true` or
`false`. When a Project opens in the TUI, All Stages shows the section of the Stage collapsed if the
value is `false`. If the value is `true` or is not set, the section is expanded.

```json
{ "key": "DONE", "label": "Done", "enabled": true, "expandedByDefault": false }
```

- The TUI applies the values when it starts and after a Project switch. A reload of the board does
  not change the sections that the user expanded or collapsed.
- The TUI does not write the key. Set it by hand in `rowbly.config.json`.
- Rowbly writes the key only when it is set. `stage update` keeps the value.
- `stage get --json` and `stage list --json` show the key when it is set.

## Specs

A Spec file is `specs/<slug>.md`. The frontmatter has `title` and `stories`, a list of Story IDs. The
body is the Spec.

- The `stories` list of a Spec holds the links to its Stories.
- If a service deletes a Story, it also removes the Story from each Spec.
- A Spec that loses its last Story stays in `specs/`.
- `rowbly doctor` shows a warning for each orphan Spec, and for each link to a Story that does not exist.
- `--fix` removes a link to a Story that does not exist. It does not delete an orphan Spec.

## Attachments

A Story can have attachments of all file types. The `attachment` service keeps them in
`attachments/<story ID>/`, with a `manifest.json` file and one file for each attachment.

- Each attachment must be a file of 10 MiB or less. An empty file is valid.
- A record can also have `storyUid`: the `uid` of the Story when the record was made. Each new
  record of a Story with a `uid` gets it. An old record without `storyUid` stays valid. A `storyUid`
  that is not a string makes the manifest malformed. The folder name stays the Story ID.
- Each record of the manifest has `id`, `name`, `type`, `size` and `createdAt`. `type` is a
  lower-case MIME type. Bytes with the PNG signature get `image/png`. Else the extension of the name
  gives the type from a small table, for example `.pdf` gives `application/pdf`. An unknown extension
  gives `application/octet-stream`.
- The file of a PNG record is `<id>.png`. The file of a different record is `<id>` and the
  lower-case extension of its name, for example `<id>.pdf`. If the name has no safe extension
  (`.` and 1 to 16 characters `a-z` or `0-9`), the file is `<id>`. `attachmentFileName` in
  `src/services/attachment-files/attachment-type.ts` gives this name.
- A manifest of an earlier version has only PNG records. Rowbly reads it with no migration.
- The CLI commands are `add-attachment <story> [file]` (also `--from-clipboard`), `list-attachments`,
  `get-attachment`, `open-attachment` and `remove-attachment`. `open-attachment` opens the file with
  the application of the platform for its type. `get-attachment` gives the record and the absolute
  path of the file. A missing file gives `NOT_FOUND`.
- In the copy of a remote worker, the manifest can have a record whose file is not in the copy.
  `getAttachment` then gets the file from the attachment source of the host agent
  (`ServiceContext.remoteAttachments`), writes it to the copy and gives that path. The bytes must have
  the `size` of the record, else the read gives `CONFLICT`. A host that cannot get the file gives
  `CONFLICT`. See [Attachment fetch](native-factory/host-agent.md#attachment-fetch).
- In the TUI, the Attachments tab of a Story shows the attachments. `n` attaches a file from a path.
  A paste key adds a copied file or an image from the clipboard (`ctrl+v`, or `alt+v` on Windows).
- The clipboard paths (`--from-clipboard` and the paste key) use `readClipboardAttachment` in
  `src/services/attachment/attachment.ts`. A read has a limit of three seconds. It does these steps
  in this sequence:
  1. It reads the copied file list of the platform: `wl-paste` on Wayland, `xclip` on X11,
     `osascript` on macOS and `powershell` (`Get-Clipboard -Format FileDropList`) on Windows.
     If the list has one local file, Rowbly attaches that file with its name. A file wins over an image.
  2. It reads a PNG image with the native binding.
  3. On Wayland, it reads `image/png`, `image/jpeg`, `image/gif` or `image/webp` with `wl-paste`.
- A missing file-list command does not stop the read. Rowbly continues with the image steps.
- Two or more copied files, a copied folder and a file larger than 10 MiB cause an error.
  The reason of two or more files is `multiple-files`.
- The name of a clipboard image is `image-YYYYMMDD-HHMM` and the extension of its type
  (`.png`, `.jpg`, `.gif` or `.webp`).
- If the clipboard has no file and no image, the error is "No file or image on the clipboard",
  with the reason `no-image`.
- `rowbly doctor` reports a manifest entry without its file, a file without an entry, and a
  malformed manifest. It keeps an orphan file for recovery. An orphan is a file with the name
  `a<uuid>` or `a<uuid>.<ext>` that no record owns. A temporary file (`.*.tmp`, `*.removed`) and
  `manifest.json` are not orphans.

## User prompts

`prompts/` holds the three user prompts of a Project: `SYSTEM.md`, `SUPERVISOR.md` and `WORKER.md`.
The whole file is the prompt. Rowbly does not parse or enforce its text.

- Initialization creates the three files with no text.
- Rowbly never assumes that a user prompt exists. A missing file has no text.
- `rowbly prompt get` and `rowbly prompt set` read and write the files. The TUI edits them in
  Settings › Prompts.

Older versions of Rowbly kept the instructions of a Project in `.rowbly/ROWBLY.md`. Rowbly does not
read this file now. See [prompts.md](prompts.md) for the prompt levels and the rules of `doctor`.

## `rowbly doctor`

`rowbly doctor` compares the files with the config and reports each problem as an error or a warning.
`--fix` repairs the problems that it can repair. The `doctor` service examines:

- Folders, Stage files, Story files, Spec files and attachments.
- Tracked skills. See [skills-and-stages.md](skills-and-stages.md#doctor-and-skills).
- User prompts and an old `ROWBLY.md`. See [prompts.md](prompts.md#doctor-and-prompts).
- The `factory` key of the config and an old `factory.json`. See the rules below.
- Runtime ignore rules, runtime files that Git tracks, and corrupt or orphan Threads. Doctor does not
  repair Thread histories and does not take over a live daemon.

The factory check runs after the Stage check, because a Stage fix writes the config. These are its
rules:

| Problem                                                                  | Severity | `--fix`                                                      |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------ |
| The `factory` key is not valid.                                          | error    | None. Repair the key by hand.                                |
| `factory.json` is not a JSON object, or has settings that are not valid. | error    | None. The file stays.                                        |
| `factory.json` exists, and the config has no `factory` key.              | warning  | Moves the settings without `version`, then deletes the file. |
| `factory.json` has the same settings as the `factory` key.               | warning  | Deletes the file.                                            |
| `factory.json` has different settings from the `factory` key.            | warning  | None. Merge them by hand, then delete the file.              |

The Story dependency check runs after the Story check, because it needs the IDs of all Stories. It
reads the frontmatter after the fixes of the Story check. It does not examine a Story file with
frontmatter that is not valid, because the Story check already shows an error for that file. These are
its rules, in the order of the check:

| Problem                                                       | Severity | `--fix`                         |
| ------------------------------------------------------------- | -------- | ------------------------------- |
| `dependsOn` is not a list of strings.                         | error    | None. Repair the key by hand.   |
| An ID has a different form, for example `row-1` for `ROW-01`. | error    | Changes it to the canonical ID. |
| An ID is not a Story of the Project.                          | error    | Removes the ID.                 |
| The Story depends on itself.                                  | error    | Removes the ID.                 |
| The list has the same ID two or more times.                   | warning  | Removes the duplicates.         |
| The `dependsOn` list is empty.                                | warning  | Removes the key.                |
| The dependencies make a cycle.                                | error    | None. See below.                |

- A fix keeps the other IDs in their order. It keeps all other frontmatter keys and the description.
- If the fixes make a list empty, `--fix` also removes the key.
- The cycle check runs last, over all Stories. It ignores each ID that an earlier row reports.
- Doctor shows one error for each cycle, not one error for each Story in the cycle. The error names
  the cycle, for example `ROW-03 → ROW-01 → ROW-03`, and the file of the first Story of the cycle.
- Only a person can select the dependency to remove. Use
  `rowbly story update <id> --remove-dependency <id>`.

## Outbox of a remote worker

A remote worker writes to a copy of the Project on its host. With `ROWBLY_OUTBOX`, the CLI records
each Story write and each attachment write in the outbox folder of the host. The main machine applies the entries to the board
later. The folder is not in `.rowbly/`.

```
$ROWBLY_OUTBOX/
  outbox.jsonl    # one JSON entry for each line
  seq             # the last seq that the folder gave
  outbox.lock     # the flock of the writers
  blobs/          # <sha256>.png: the file of each attachment.add entry, of all types
```

A field entry of `outbox.jsonl` has this shape. It has no `type` key:

```json
{
  "seq": 1,
  "opId": "<uuid>",
  "threadId": "<thread>",
  "storyId": "ROW-01",
  "storyUid": "<uuid>",
  "changes": [{ "path": "stage", "before": "BACKLOG", "after": "DONE" }]
}
```

- Each entry has `storyUid`, the `uid` of the Story, when the Story has a `uid`. An entry of an older
  build has no `storyUid`. The apply accepts an entry with or without `storyUid`. A `storyUid` that is
  not a string is a conflict.

- The service writes the Story file first. Then the recorder adds the entry. If the Story write fails,
  the outbox gets no entry. If the process stops between the two writes, the entry is lost.
- A writer holds an exclusive `flock` on `outbox.lock` while it adds an entry. Thus two writers do
  not get the same `seq`.
- `seq` starts at 1 and increases by 1 for each entry. The next `seq` is one more than the largest of
  the `seq` file and the lines of `outbox.jsonl`. The `seq` file keeps the order after the host removes
  the first lines.
- The writer syncs `outbox.jsonl`, the `seq` file and the folder to the disk before the command
  returns.
- `opId` is a new unique ID for each entry.
- The paths of a change are `title`, `description`, `stage`, `fields.<key>`, `tags` and `dependsOn`.

An attachment entry has a `type` key. `addAttachment` writes an `attachment.add` entry, and
`removeAttachment` writes an `attachment.remove` entry:

```json
{
  "seq": 2,
  "opId": "<uuid>",
  "threadId": "<thread>",
  "storyId": "ROW-01",
  "storyUid": "<uuid>",
  "type": "attachment.add",
  "attachment": {
    "id": "a<uuid>",
    "name": "shot.png",
    "type": "image/png",
    "size": 1234,
    "createdAt": "<iso>",
    "storyUid": "<uuid>"
  },
  "sha256": "<64 lowercase hex characters>"
}
```

```json
{
  "seq": 3,
  "opId": "<uuid>",
  "threadId": "<thread>",
  "storyId": "ROW-01",
  "storyUid": "<uuid>",
  "type": "attachment.remove",
  "id": "a<uuid>",
  "sha256": "<64 lowercase hex characters>"
}
```

- `sha256` is the lowercase hex SHA-256 of the bytes of the file.
- The blob name is `<sha256>.png` for all file types. The name stays the same as in earlier versions,
  so that an outbox folder of an older version stays valid.
- For an add, the service writes the file and the manifest of the copy first. Then the recorder
  writes the file to `blobs/<sha256>.png`. Then it adds the entry. Thus an entry never points to a
  missing file. A crash after the file write leaves only a file without an entry. This is harmless.
- The recorder holds the outbox lock while it writes the file and adds the entry. Thus an
  acknowledgement cannot remove the file before the entry is there.
- The recorder writes a file through a temporary file in `blobs/`. It syncs the file, renames it and
  syncs the folder. If `<sha256>.png` exists, the recorder keeps it, because it has the same bytes.
  Thus two adds of the same bytes give one file and two entries.
- For a remove, the service calculates `sha256` from the file of the copy. It adds the entry after the
  remove succeeds.
- `addAttachment` accepts an optional `id`. The main machine uses it when it applies an
  `attachment.add` entry. An id that is not valid gives `VALIDATION`. An id that is in the manifest
  gives `CONFLICT`. Both errors occur before the first write.
- `updateStory` with `attachments` stays refused for a remote worker.
- The main machine gets a file with `rowbly host blob <sha256>`. See
  [cli.md](cli.md#worker-hosts).

### Read and acknowledgement on the host

- `readOutboxEntries(dir, afterSeq)` gives the complete entries with a `seq` greater than `afterSeq`,
  in `seq` order. It ignores a line that is not complete JSON, for example after a crash during an
  append.
- `acknowledgeOutbox(dir, seq)` holds the outbox lock. It removes the lines with a `seq` equal to or
  less than `seq`, and each line that is not a complete entry. It keeps the `seq` file, so that a new
  entry does not get the `seq` of a removed line. Then it removes each file of `blobs/` that no
  remaining `attachment.add` entry points to.
- The main machine uses these functions through the hidden commands `rowbly host outbox` and
  `rowbly host outbox-ack`. See [cli.md](cli.md#worker-hosts).

### Apply on the main machine

The `outbox-apply` service applies the entries of one worker host to the canonical Story files.

- `syncOutbox` reads the last applied `seq` of the host. It gets the entries after that `seq` from an
  `OutboxSource`, applies them, and then sends the acknowledgement of the applied `seq`.
- `transportOutboxSource` is the `OutboxSource` over the host transport. It runs the fixed remote
  commands `<rowbly> host outbox`, `<rowbly> host blob <sha256>` and `<rowbly> host outbox-ack`. The
  caller gives the path of `<rowbly>` on the host. A remote exit code other than 0 gives a
  `HOST_PROTOCOL` error with the `stderr` text.
- `applyOutbox` holds the Project write lock while it applies the entries. It does not take the state
  lock. The services run without a recorder.
- The apply examines the entries in `seq` order. It skips an entry with a `seq` equal to or less than
  the last applied `seq`. Thus an entry that arrives two times has one effect.
- After each entry, the apply writes the `seq` to `outbox-applied.json` and syncs it to the disk.
  Then it continues with the next entry. The acknowledgement goes to the host only after this write.
  If the process stops before the acknowledgement, the next sync skips the applied entries and sends
  the acknowledgement again.
- The applied `seq` also advances past an entry with a conflict.

For each field change, the apply compares the value on the main machine with `before` and `after`.
`compareChange` in `src/services/outbox/outbox-compare.ts` does this comparison. It uses the same
value forms as the record: `null` for a missing value, full lists for `tags` and `dependsOn`, and the
body for `description`.

| Value on the main machine | Action                                |
| ------------------------- | ------------------------------------- |
| Equal to `before`         | Write `after`.                        |
| Equal to `after`          | The change is already there. Skip it. |
| Other                     | Conflict. Do not write.               |

- The apply finds the Story of an entry with `resolveStoryRef`. The Story with the `storyUid` of the
  entry comes first. If the entry has no `storyUid`, or no Story has it, the Story with the `storyId`
  comes next. Thus an entry applies to its Story also after the number of the Story changes. See
  [Story references](native-factory/README.md#story-references).
- The apply writes the changes of one field entry that do not conflict in one `updateStory` call. It
  records each conflicting change.
- A missing Story makes each change of the entry a conflict.
- An unknown path, a new value with a bad form, or a write that the service refuses is a conflict.
- An `attachment.add` entry is skipped when the Story has an attachment with the same id and the same
  `sha256`. A missing Story, or the same id with a different `sha256`, is a conflict. Else the apply
  gets the file with `rowbly host blob <sha256>`, and adds it with the id and the name of the entry.
  The type comes again from the bytes and the name, so it is the same as the type of the entry.
- A file with a different hash or more than 10 MiB is a conflict. The apply does not add the
  attachment.
- An `attachment.remove` entry removes the attachment when it is on the Story. It is skipped when the
  attachment or the Story is not there.
- An entry with an unknown `type` or a bad shape is a conflict. The apply continues with the next
  entry.
- A failure of the connection, for example an unreachable host, stops the apply. The entry does not
  get a record, so the next sync tries it again.
- `syncHostOutbox` in `src/services/factory-manager/outbox-attention.ts` runs the sync for one host in
  the lifecycle order of the manager. After the Project write lock is free, it sets one attention
  entry for each Story with a conflict, with the key `outbox:<storyId>`. The text has the host, the
  `seq`, the path or the attachment id, and the `before`, `after` and current values. A value longer
  than 200 characters is cut. An entry without a Story ID uses the key `outbox:<host>`.
- The next scan commits the changes with the usual canonical commit.

The main machine keeps the files of each host in `runtime/hosts/<host>/`. The folders have mode
`0700`. Git never commits them.

```
.rowbly/runtime/hosts/<host>/
  outbox-applied.json   # { "seq": <n> }: the last applied seq. A missing file is 0.
  conflicts/            # <sha256>.png: the file of each attachment.add conflict, for recovery
  threads/<thread-id>/
    base.json           # the copy that the main machine sent last to the host for the Thread
```

`base.json` is `{ version, threadId, host, sentAt, files, attachments }` with mode `0600`. The remote
executor writes it after each `host prepare`. See
[native-factory/README.md](native-factory/README.md#dispatch-to-a-worker-host).

### Attachment cache of a host

The `attachment-cache` service keeps attachment files by attachment id, in a folder that the caller
gives. Each file is `<dir>/<attachment-id>.png` for all file types, for compatibility with earlier
versions. The content of an attachment never changes, so a file never
becomes old.

- `putCachedAttachment` checks the id and the size of the bytes (10 MiB or less) first. It writes the file
  atomically. If the id is in the cache, the first file stays.
- `readCachedAttachment` gives the bytes. A missing file gives `NOT_FOUND`.
- `hasCachedAttachment` tells if the id is in the cache. `missingCachedAttachments` gives the ids of
  a list that are not in the cache.
- An invalid id gives `VALIDATION`. The service refuses a symlink in place of the folder or a file.

## `~/.rowblyrc.json`

Rowbly keeps one file for each user, `~/.rowblyrc.json`. The `known-project` and `host` services read
and write it. They use the `user-rc` module for each read and write, so that the safety rules below
apply in one place.

```
~/.rowblyrc.json      # projects [{path,name}], with the most recent project first; deviceId;
                      # hosts [{id,ssh,maxWorkers,enabled,projects?,lastCheck?}], in the order that the user added them
```

- The TUI adds a Project to this file when the Project opens.
- The Project switcher in the header reads the list.
- `deviceId` is a nonsecret installation ID. `rowbly auth login` creates it at the first login and
  gives it to Pi.
- `hosts` is the list of the worker hosts of the user. `rowbly host` changes it. A missing key is an
  empty list. If the value is not an array, or an entry does not have the four fields with the
  correct types, the full `hosts` value is invalid. Then each `host` command gives `VALIDATION`.
  A write keeps the other keys of each entry.
- `projects` of a host entry is the list of the Projects that the host uses:
  `[{ "root": string, "path": string, "managed": boolean }]`. `rowbly host use` adds a record and
  `rowbly host unuse` removes it. A missing key is an empty list.
  - `root` is the absolute path of the local Project root, the same value as the `path` of the
    `projects` list of known Projects.
  - `path` is the clone on the host, relative to the home folder of the SSH user, or absolute.
  - `managed` is `true` when Rowbly made the clone in its own folder on the host.
  - If the value is not an array, or a record does not have the three fields with the correct types,
    the full `hosts` value is invalid. Then each `host` command gives `VALIDATION`.
- `lastCheck` of a host entry is the summary of the last host check:
  `{ "at": string, "ready": boolean, "failed": [string] }`. `rowbly host check` and `rowbly host add`
  write it after the check. The CLI and the TUI show the same value. A missing key means that the
  host has no check.
  - `at` is the ISO time at the end of the check.
  - `ready` is `true` when no item of the check is `fail`.
  - `failed` is the list of the ids of the `fail` items, in the order of the check.
  - The check reads the file again before the write, because the check takes time. If the host is
    not in the file at that time, Rowbly does not write the file, and the check does not fail.
  - If the value is not an object with the three fields with the correct types, the full `hosts`
    value is invalid. Then each `host` command gives `VALIDATION`.
- Rowbly v1 uses the same file for its own keys. Keep all other keys when you write the file.
- If the file is a symlink, for example from a dotfile manager, Rowbly writes through the link and
  keeps it.

Do not write the file if Rowbly cannot read it. A write would remove the data that the user has in the
file.

## `~/.cache/rowbly/pi-catalog.json`

Rowbly keeps a cache of the Pi model list and of the provider status for each user. The
`pi-catalog-cache` service reads, writes and deletes it. The service does not load Pi.

```
~/.cache/rowbly/pi-catalog.json   # version 1; key {auth, models, rowbly}; models; providers
```

- The key has the mtime (ms, or `null`) of `<agentDir>/auth.json` and of `<agentDir>/models.json`,
  and the Rowbly package version. `<agentDir>` is `$PI_CODING_AGENT_DIR` or `~/.pi/agent`, as in Pi.
- A cache with a different key is stale. A corrupt file or a file with a different format reads as
  missing.
- The Models tab of the Story Modal and the provider check of the Factory Modal read the cache first.
  They load Pi only when the cache is stale or missing, and then write a new cache.
- The AI section of Settings always loads Pi and writes the cache.
- `loginProvider()` and `logoutProvider()` delete the cache after each attempt.
- Rowbly writes the file atomically. You can delete the file at any time.

## Related

- [domain-concepts.md](domain-concepts.md): the meaning of each item.
- [service-layer.md](service-layer.md): the services that read and write these files.
- [native-factory/runtime-and-locks.md](native-factory/runtime-and-locks.md): `runtime/` and `state.json`.
