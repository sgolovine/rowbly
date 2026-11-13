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

The `factory-settings/` service reads and writes the optional `.rowbly/factory.json`:
`version`, `maxWorkers`, `supervisorModel` and `workerModel`.

- Without `factory.json`, the worker limit is four and Pi selects default models.
- An explicit model choice must be available and must support the selected thinking level.
- The thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. A model
  supports only some of them.
- `rowbly factory configure` sets `--max-workers`, `--supervisor`, `--worker`,
  `--supervisor-thinking` and `--worker-thinking`.
- The model picker of the TUI offers the supported thinking levels and `Pi default`.

## Related

- [controls.md](controls.md): the `auth`, `model` and `factory configure` commands, and the AI section keys.
- [../testing.md](../testing.md#native-factory-tests): the faux provider and credential rules.
