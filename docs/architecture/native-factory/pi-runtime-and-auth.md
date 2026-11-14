# Pi runtime, authentication and models

Rowbly uses the Pi SDK (`@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`, pinned to
1.5.2) for sessions, authentication and models. The SDK loads on demand, so the board and the
read-only paths start fast and work without credentials. Credentials stay in Pi storage, outside the
Project.

Read this when you add or change a Pi import, the `auth` or `model` commands, the AI section of
Settings, or the factory settings.

## The lazy Pi boundary

- The Pi SDK loads on demand for authentication, model selection and native execution.
- The board, help, doctor, metadata, factory status and read-only conversation paths do not import
  Pi runtime values. A type-only import (`import type`) is permitted.
- `src/services/pi-runtime/` holds the lazy import (`loadPi()`), the session adapter, the runtime and
  the model catalog. Keep each runtime import of Pi in this module.
- The `import-boundary` test in `pi-runtime/` fails if help or `factory status` loads Pi. Keep this test.
- `tsup` keeps `@earendil-works/pi-coding-agent` external. See [../tooling.md](../tooling.md#build).

## Authentication

The `agent-auth/` service gives the provider status and does login, logout and model checks.

- `rowbly auth login` must run in a terminal without `--json`. API keys use a masked prompt, never an
  argument.
- `rowbly auth status` shows the configured status, without a health check.
- Configured models do not prove provider access, quota or credential health.
- Rowbly does not write global Pi settings. Credentials stay in Pi storage, outside the Project.
- A login gives Pi the nonsecret `deviceId` from `~/.rowblyrc.json`. See
  [../storage.md](../storage.md#rowblyrcjson).

## Factory settings

The `factory-settings/` service reads and writes the optional `factory` key of
`.rowbly/rowbly.config.json`: `maxWorkers`, `supervisorModel`, `workerModel`, `stageWorkerModels`,
`storyWorkerModels`, `git` and `checks`. See [../storage.md](../storage.md#factory-settings).

- Without the `factory` key, the worker limit is four and Pi selects default models.
- A write keeps the other keys of the config. The other config writers keep the `factory` key.
- A `factory` key that is not valid gives a `ValidationError` on the factory paths. The board checks
  only that the key is an object, so it continues to work.
- Older versions kept the settings in `.rowbly/factory.json`. A factory start fails while that file
  exists. Run `rowbly doctor --fix` to move the settings. See
  [../storage.md](../storage.md#upgrade-from-factoryjson).
- An explicit model choice must be available and must support the selected thinking level.
- The thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. A model
  supports only some of them.
- `rowbly factory configure` sets `--max-workers`, `--supervisor`, `--worker`,
  `--supervisor-thinking` and `--worker-thinking`.
- The `git` section has `commitMessage`, `authorName` and `authorEmail`. They set the canonical
  commits of the factory. See [runtime-and-locks.md](runtime-and-locks.md#git-and-the-runtime-files).
- `rowbly factory configure --commit-message "<text>"` sets `git.commitMessage`.
- `rowbly factory configure --commit-author "Name <email>"` sets `git.authorName` and
  `git.authorEmail`. A value in a different form gives a `VALIDATION` error, and the config does
  not change.
- An empty value, for example `--commit-message ""`, removes the setting. Then the factory uses the
  default again.
- The service keeps the other factory keys. Git flags without a model flag do not start
  the Pi runtime.
- The `git` section also has `push`, `pull` and `syncIntervalSeconds`. They set the Git sync of
  the canonical checkout. The `--git-push`, `--no-git-push`, `--git-pull`, `--no-git-pull` and
  `--git-sync-interval` flags set them. See
  [runtime-and-locks.md](runtime-and-locks.md#git-sync-of-the-canonical-checkout).
- The model picker of the TUI offers the supported thinking levels and `Pi default`.

### Checks

The `checks` section sets the checks that the factory runs for its workers. See
[checks.md](checks.md#settings) for all keys and their defaults.

- `maxConcurrent` is the maximum number of checks at the same time. Use 1 to 32. The default is 2.
- `reserveMemoryMb` is the memory that the check queue always keeps free. The default is 2048.
- `items` is the list of the named checks. Each item has a `key` and a `command`.
- `rowbly factory configure --max-checks <n>` sets `checks.maxConcurrent`.
- `rowbly factory configure --check-memory-reserve <mb>` sets `checks.reserveMemoryMb`.
- `rowbly factory check add|update|remove|list` changes and shows the items.
- A `checks` section that is not valid gives a `ValidationError`, and `factory.json` does not change.
- Without a `checks` section, the factory has no checks, and the workers get no `run_check` tool.

### Worker model overrides

An override changes the worker model for one Stage, or for one Story in one Stage.

- `stageWorkerModels` is a map from a Stage key to a model choice.
- `storyWorkerModels` is a map from a Story ID to a map from a Stage key to a model choice.
- A model choice has `provider`, `modelId` and an optional `thinkingLevel`. It is the same shape as
  `workerModel`. If an entry is not a valid model choice, `getFactorySettings` gives a
  `ValidationError`.
- `rowbly factory configure --stage <key> --worker <provider/model>` sets the Stage override. Add
  `--story <id>` to set the override of the Story in that Stage. Add `--worker-thinking <level>` to
  set the thinking level.
- `rowbly factory configure --stage <key> [--story <id>] --clear-worker` removes the override. If the
  Story has no other overrides, its key goes out of `storyWorkerModels`. If the override does not
  exist, the command succeeds and the config does not change.
- `--stage` sets only the worker model. If you use `--stage` together with `--supervisor`,
  `--supervisor-thinking`, `--max-workers` or a Git flag, the command gives a `VALIDATION` error. The
  command does not ignore these flags.
- The service validates the model of an override with `validateModelChoice` before the config changes.
- An override for a deleted or renamed Story or Stage stays in the config. The factory ignores it.

When the factory reserves a worker, it uses the first model in this list:

1. The Story override for the Stage of the Story.
2. The Stage override.
3. The `model` argument of the supervisor tool `start_worker`.
4. `workerModel`.

The pure function `resolveWorkerModel(settings, storyId, stage)` gives items 1, 2 and 4. The
reservation stores the selected model on the Thread. The supervisor loop reads the factory settings
again on each turn. Thus a changed override applies to the next reservation, and a restart is not
necessary.

## Related

- [controls.md](controls.md): the `auth`, `model` and `factory configure` commands, and the AI section keys.
- [../testing.md](../testing.md#native-factory-tests): the faux provider and credential rules.
