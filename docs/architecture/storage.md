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
  rowbly.config.json  # projectName, projectKey, customFields [{key,label,type,options?}], stages [{key,label,enabled}], features? {specs}, display? {compactThreads}, skills? [{name,harnesses}], factory? {maxWorkers,supervisorModel,workerModel,stageWorkerModels,storyWorkerModels,git,checks}
  prompts/SYSTEM.md   # the Project prompt: the supervisor and all workers get it
  prompts/SUPERVISOR.md # the Supervisor prompt: only the supervisor gets it
  prompts/WORKER.md   # the Worker prompt: all workers get it
  stories/ROW-01.md   # <projectKey>-<n>.md; frontmatter: title, stage, position?, dependsOn?, one key per custom field (null = unset); the body is the description
  stages/BACKLOG.md   # <stage key>.md; the whole file is the stage's prompt
  specs/login-page.md # <slug>.md; frontmatter: title, stories (a list of story IDs); the body is the spec
  attachments/ROW-01/ # manifest.json and <id>.png for each PNG attachment of a story
  .gitignore          # /state.json* and /runtime/; existing text stays
  state.json          # v1 policy state; the native factory writes it
  runtime/            # private, ignored; see native-factory/runtime-and-locks.md
```

`projectPaths()` and `runtimePaths()` in `src/services/workspace/` give the paths of most items.

The files of `runtime/` and `state.json` belong to the native factory. See
[native-factory/runtime-and-locks.md](native-factory/runtime-and-locks.md).

## Config

`rowbly.config.json` holds the Project name and key, the custom fields, the Stages, the features, the
display options, the installed skills and the factory settings. The `config` service reads, checks and writes it.

- The order of `stages` in the config is the order of the board.
- The custom field types are `string`, `number`, `boolean`, `url`, `date` (YYYY-MM-DD) and `select`
  (with `options`).
- If a service renames or removes a Stage or a field, it also writes the change to the Stories that
  use it. This keeps the files consistent.
- The `skills` list holds the bundled skills that the Project has installed. Each entry has the `name`
  of a skill and the `harnesses` that have a copy. See [skills-and-stages.md](skills-and-stages.md).
- The optional `display` key holds the display options of the TUI. It has one boolean key,
  `compactThreads`. When `compactThreads` is `true` or is not set, each Thread in the Threads view
  and in the Threads tab of a Story uses one line. When it is `false`, each Thread uses up to three
  lines. Set it with `rowbly project update --compact-threads <on|off>` or in Settings › Display. A
  `display` value that is not an object, an unknown key or a value that is not a boolean gives a
  config issue.
- The `factory` key holds the factory settings. See [Factory settings](#factory-settings). Each write
  of the config keeps this key.

## Factory settings

The optional `factory` key of `rowbly.config.json` holds the settings of the native factory. The
`factory-settings` service reads, checks and writes it. All keys are optional:

| Key                 | Type    | Default            | Effect                                                 |
| ------------------- | ------- | ------------------ | ------------------------------------------------------ |
| `maxWorkers`        | integer | `4`                | The maximum number of workers. The minimum is 1.       |
| `supervisorModel`   | object  | Pi selects a model | The model choice of the supervisor.                    |
| `workerModel`       | object  | Pi selects a model | The model choice of the workers.                       |
| `stageWorkerModels` | object  | none               | The worker model overrides for each Stage key.         |
| `storyWorkerModels` | object  | none               | The worker model overrides for each Story ID.          |
| `git`               | object  | the sync defaults  | The canonical commits and the Git sync of the factory. |
| `checks`            | object  | none               | The check queue and the named checks of the workers.   |

A model choice has `provider`, `modelId` and an optional `thinkingLevel`. Without the `factory` key,
the worker limit is four and Pi selects the default models. Without the `checks` key, the factory has
no checks. See [native-factory/checks.md](native-factory/checks.md#settings) for the keys of `checks`.

The config check of the board examines only that `factory` is an object. The `factory-settings`
service examines all keys. Thus a `factory` section that is not valid stops the factory commands,
but the board continues to work. `rowbly doctor` shows the problem as an error.

The factory settings can hold worker model overrides. `stageWorkerModels` maps a Stage key to a model
choice. `storyWorkerModels` maps a Story ID to a map from a Stage key to a model choice. The order of
priority is the Story override, then the Stage override, then `workerModel`. See
[native-factory/pi-runtime-and-auth.md](native-factory/pi-runtime-and-auth.md#worker-model-overrides).

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

A Story file is `stories/<projectKey>-<n>.md`, for example `ROW-01.md`. The number has at least two
digits. The frontmatter has `title`, `stage`, an optional `position`, an optional `dependsOn` list,
and one key for each custom field. A `null` value means that the field has no value. The Markdown body
is the description.

The `position` of a Story sets its order in its Stage.

- A Story without a `position` comes after the Stories that have one, in the order of their numbers.
- When a Story moves, the service writes a new `position` to each Story of the Stage that changes place.

### Dependencies

The `dependsOn` key is a list of the IDs of the upstream Stories of the Story, for example
`dependsOn: [ROW-01, ROW-02]`. See [domain-concepts.md](domain-concepts.md#story-dependencies).

- Only the downstream Story keeps the relation. The services calculate the reverse list (`blocks`).
- A Story without dependencies has no `dependsOn` key. When the list becomes empty, the service
  removes the key. A change of a different key does not add `dependsOn`.
- `dependsOn` comes after `position` and before the custom fields. A custom field cannot have this
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

Older versions of Rowbly wrote an agent lock to the `agentLock` key of a Story. Rowbly does not use
this key now. `rowbly doctor` shows a warning for each Story file with an `agentLock` key. To remove
the keys, run `rowbly doctor --fix`. The command keeps all other frontmatter and the description.

## Stages

Each Stage has a file `stages/<stage key>.md`. The whole file is the prompt of the Stage. A Stage in
the config can be disabled with `enabled: false`.

## Specs

A Spec file is `specs/<slug>.md`. The frontmatter has `title` and `stories`, a list of Story IDs. The
body is the Spec.

- The `stories` list of a Spec holds the links to its Stories.
- If a service deletes a Story, it also removes the Story from each Spec.
- A Spec that loses its last Story stays in `specs/`.
- `rowbly doctor` shows a warning for each orphan Spec, and for each link to a Story that does not exist.
- `--fix` removes a link to a Story that does not exist. It does not delete an orphan Spec.

## Attachments

A Story can have PNG attachments. The `attachment` service keeps them in `attachments/<story ID>/`,
with a `manifest.json` file and one `<id>.png` file for each image.

- Each attachment must be a PNG image of 10 MiB or less.
- The CLI commands are `add-attachment <story> [file]` (also `--from-clipboard`), `list-attachments`,
  `open-attachment` and `remove-attachment`.
- In the TUI, the Attachments tab of a Story shows the images. A paste key adds an image from the
  clipboard (`ctrl+v`, or `alt+v` on Windows).
- `rowbly doctor` reports a manifest entry without a PNG, a PNG without an entry, and a malformed
  manifest. It keeps an orphan PNG for recovery.

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

## `~/.rowblyrc.json`

Rowbly keeps one file for each user, `~/.rowblyrc.json`. The `known-project` service reads and writes
it.

```
~/.rowblyrc.json      # projects [{path,name}], with the most recent project first; deviceId
```

- The TUI adds a Project to this file when the Project opens.
- The Project switcher in the header reads the list.
- `deviceId` is a nonsecret installation ID. `rowbly auth login` creates it at the first login and
  gives it to Pi.
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
