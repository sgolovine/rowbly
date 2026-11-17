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
  It also imports the Pi worker client, which must not load Pi.
- `tsup` keeps `@earendil-works/pi-coding-agent` external. See [../tooling.md](../tooling.md#build).

## Authentication

The `agent-auth/` service gives the provider status and does login, logout and model checks.

- `rowbly auth login` must run in a terminal without `--json`. API keys use a masked prompt, never an
  argument.
- `rowbly auth status` shows the configured status, without a health check.
- Configured models do not prove provider access, quota or credential health.
- A quota error pauses the provider for 15 minutes. An authentication error pauses it until the
  credentials change. A connectivity error gives a `network` pause of 1 to 15 minutes. See
  [recovery.md](recovery.md#network-failures).
- Rowbly does not write global Pi settings. Credentials stay in Pi storage, outside the Project.
- A login gives Pi the nonsecret `deviceId` from `~/.rowblyrc.json`. See
  [../storage.md](../storage.md#rowblyrcjson).
- Each login and logout deletes the model cache, also when the attempt fails.

## The model cache

Pi takes about 0.6 s to load. If the TUI loads Pi on its main thread, the TUI stops during the load.
The [Pi worker](#the-pi-worker) loads Pi for the model list and the provider status. The `pi-catalog-cache/` service keeps the model list and the provider status in
`~/.cache/rowbly/pi-catalog.json`. See [../storage.md](../storage.md#cacherowblypi-catalogjson).

- `pi-catalog-cache.ts` reads, writes and deletes the file. It does not import Pi. The
  `import-boundary` test examines this.
- `pi-catalog-refresh.ts` loads the catalog through a `PiCatalogSource` and writes the cache
  (`refreshPiCatalog()`). A source has two reads: `listAvailableModels()` and `getAuthStatus()`.
  `loadPiCatalog()` and `piProviderReady()` use a fresh cache, and read the source only when the
  cache is stale or missing.
- `runtimeSource(runtime)` makes a source from a runtime of the same thread. The AI section of
  Settings uses it, because it also needs the runtime for login and logout.
- The Models tab shows the cached models at once. When the cache is stale, it reads the Pi worker in
  the background and then shows the new models. A failed refresh keeps the cached models.

## The Pi worker

The Models tab and the Factory controls read the model list and the provider status through a
`worker_threads` worker. Thus the main thread of the TUI does not import Pi for these reads, and the
keys and the screen stay responsive.

- `pi-runtime/pi-worker.ts` is the worker entry. It imports Pi and answers two requests: `models` and
  `authStatus`. It uses `createFactoryRuntime()` and the functions of `agent-auth/`.
- The worker makes a new Pi runtime for each request. Thus a login or a logout in the TUI or in a
  different process shows in the next answer.
- A reply has plain data, or an error message. It does not have an `Error` object or a stack, so
  that no credential text goes to the main thread. Only the message of a Rowbly error goes through.
  Other errors get a fixed message.
- `pi-runtime/pi-worker-client.ts` is the client. It does not import Pi. `piWorkerSource()` gives a
  `PiCatalogSource` that sends each read to the worker.
- The worker starts at the first request, not at the import. The client calls `unref()`, so that the
  worker does not keep the process alive.
- Each request has an id. The client gives each reply to the request with the same id.
- If the worker sends `error` or stops, all its requests fail. The next request starts a new worker.
- If the worker cannot start, the request fails. The client does not load Pi on the main thread in
  its place, because that stops the TUI again.
- The TUI starts the worker in the background after the board shows (`warmPiWorker()`). When the
  TUI quits, `src/cli-main.ts` calls `stopPiWorker()`. The CLI commands do not import the client.
- The AI section of Settings, login, logout, the CLI commands and the factory daemon still load Pi
  on the main thread through `authRuntime()` or `createFactoryRuntime()`.
- The build makes `dist/pi-worker.js` next to `dist/cli.js`. The client finds `pi-worker.js` next to
  its own file. When `tsx` runs the sources (`pnpm dev`), the client finds `pi-worker.ts` and gives
  the loader flags of the process to the worker. See [../tooling.md](../tooling.md#build).

## Factory settings

The `factory-settings/` service reads and writes the optional `factory` key of
`.rowbly/rowbly.config.json`: `maxWorkers`, `supervisorModel`, `workerModel`, `stageWorkerModels`,
`storyWorkerModels`, `fallbackWorkerModels`, `git`, `checks`, `dependencies` and `placement`. See [../storage.md](../storage.md#factory-settings).

- Without the `factory` key, the worker limit is four and Pi selects default models.
- A write keeps the other keys of the config. The other config writers keep the `factory` key.
- A `factory` key that is not valid gives a `ValidationError` on the factory paths. The board checks
  only that the key is an object, so it continues to work.
- Older versions kept the settings in `.rowbly/factory.json`. A factory start and a write of the
  factory settings fail while that file exists. Run `rowbly doctor --fix` to move the settings. See
  [../storage.md](../storage.md#upgrade-from-factoryjson).
- An explicit model choice must be available and must support the selected thinking level.
- The thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. A model
  supports only some of them.
- `rowbly factory configure` sets `--max-workers`, `--supervisor`, `--worker`,
  `--supervisor-thinking`, `--worker-thinking` and `--fallback-worker`.
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

The `checks` key of the `factory` section sets the checks that the factory runs for its workers. See
[checks.md](checks.md#settings) for all keys and their defaults.

- `maxConcurrent` is the maximum number of checks at the same time. Use 1 to 32. The default is 2.
- `reserveMemoryMb` is the memory that the check queue always keeps free. The default is 2048.
- `items` is the list of the named checks. Each item has a `key` and a `command`.
- `rowbly factory configure --max-checks <n>` sets `checks.maxConcurrent`.
- `rowbly factory configure --check-memory-reserve <mb>` sets `checks.reserveMemoryMb`.
- `rowbly factory check add|update|remove|list` changes and shows the items.
- A `checks` section that is not valid gives a `ValidationError`, and the config does not change.
- Without a `checks` section, the factory has no checks, and the workers get no `run_check` tool.

### Pull upstream Stories

The `dependencies.pullUpstream` key of the `factory` section is a boolean. The default is `false`.
An absent key is `false`.

- When the key is `true`, the manager moves a stuck upstream Story out of the first Stage of the
  board. See [README.md](README.md#parts-of-the-factory).
- `rowbly factory configure --pull-upstream on` sets the key to `true`. `--pull-upstream off` sets it
  to `false`. Other values give a `VALIDATION` error, and the config does not change.
- A `dependencies` section that is not an object, or a `pullUpstream` value that is not a boolean, is
  not valid. `rowbly doctor` shows the problem.
- In the TUI, Settings › AI › Limits shows the card "Pull upstream Stories" with the value `On` or
  `Off`. The `u` key or the Button of the card switches the value.
- The key is off by default, because a move changes the board of the user.

### Placement

The `placement` key of the `factory` section sets how the manager selects the machine of a new
worker. The machine is the main machine (`local`) or a worker host. See
[README.md](README.md#placement) for the rules.

| Value           | Effect                                                                   |
| --------------- | ------------------------------------------------------------------------ |
| `prefer-local`  | Use `local` first. Use a worker host only when `local` has no free slot. |
| `most-free`     | Use the machine with the most free slots. A tie goes to `local`.         |
| `prefer-remote` | Use the worker host with the most free slots first. Then use `local`.    |

- The default is `prefer-local`. `getFactorySettings` gives `prefer-local` when the key is absent.
  A write does not add the default to the file, and it keeps the other keys.
- A different value is not valid. `getFactorySettings` gives a `ValidationError`, and
  `validFactorySettings` gives `false`. Thus `rowbly doctor` shows the problem.
- `rowbly factory configure --placement <policy>` sets the key. An unknown policy gives a
  `VALIDATION` error, and the config does not change. The flag does not start the Pi runtime.
- The supervisor loop reads the factory settings again on each turn. Thus a changed policy applies to
  the next reservation.

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

The pure function `selectWorkerModel(settings, target, isPaused)` in `worker-overrides.ts` gives the
model. It also applies the fallback worker models. The reservation uses the selected model for the
placement, the validation, the Thread `model` and the launch. The reservation stores the selected model
on the Thread. The supervisor loop reads the factory settings
again on each turn. Thus a changed override applies to the next reservation, and a restart is not
necessary.

### Fallback worker models

`fallbackWorkerModels` is an ordered list of model choices in the `factory` section. It is optional.
Without the key, there is no fallback.

- The manager first selects the model from the list above. If the provider of that model is paused,
  the manager uses the first fallback model whose provider is not paused.
- The fallback applies also when the selected model is a Story override, a Stage override or the model
  of the supervisor.
- If the provider of the selected model and the providers of all fallback models are paused, the
  reservation gives the `ConflictError` `Worker provider is paused`. The `scan` of the manager changes
  each `start` and `retry` decision of the Story to `skip` with the reason `provider paused`. The
  status file, `rowbly factory status` and the supervisor tool `factory_snapshot` show this reason.
- `scan` does not know the model of the supervisor. Thus it uses only the overrides and `workerModel`.
  The `provider` of each queue entry of the status file is the provider of this selection, with the
  fallback.
- If no model resolves, Pi selects the model. The manager does not check a pause and does not use the
  list.
- A resumed Thread keeps its model, also when its provider is paused. A network resume waits for the
  end of the pause of the provider of the Thread.
- The supervisor does not select a different provider because of a pause. The manager applies the
  fallback.
- `rowbly factory configure --fallback-worker <provider/model>` (repeat) replaces the list.
  `--clear-fallback-workers` removes the key. See [controls.md](controls.md#cli-commands).

## Related

- [controls.md](controls.md): the `auth`, `model` and `factory configure` commands, and the AI section keys.
- [../testing.md](../testing.md#native-factory-tests): the faux provider and credential rules.
