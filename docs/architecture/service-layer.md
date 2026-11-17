# Service layer

The services in `src/services/` do all of the real work of Rowbly. The CLI and the TUI are thin front
ends that call the same service functions. This page gives the rules for a service, the error types,
the `ServiceContext`, and an index of the modules.

Read this when you add or change a service, when you add an error, or when you must find the module
that owns a feature.

## One service layer, two front ends

The two front ends call the same service functions.

```
 rowbly story create --title foobar         TUI "New Story" form
              │                                       │
   src/commands/story/                     src/tui/screens/stories/new-story-form/
              │                                       │
              └────────► src/services/story/ ◄────────┘
                           createStory({ title }, ctx)
```

For example, a user can run `rowbly story create --title foobar`, or create the same Story in the TUI.
The two paths must both call the same `createStory` service. A front end must not contain logic of
its own to create a Story. If a CLI command and a TUI screen both use a part of the logic, put that
logic in the service.

## Rules for services

- **Plain TypeScript, no UI.** Do not import `commander`, `ink` or `react` in a service. A service
  must not read `process.argv`, write to stdout or stderr, prompt the user or call `process.exit`.
  It takes typed inputs and gives typed results.
- **Throw typed errors.** For an expected failure, throw an error. Do not print a message. See
  [Errors](#errors).
- **One module per domain.** Put each module and its test in a folder with the name of the module,
  for example `src/services/story/`. Each module exports functions such as `createStory` and
  `searchStories`. Export the input and output types with the functions, so that the two front ends
  use the same types. A module folder can have many files, one for each concern.
- **Inject dependencies** if this makes tests easier. For example, inject file system paths or the
  clock. Do not use globals for them.
- **Async by default.** Return a `Promise`. Then the callers do not change if an implementation
  starts to do I/O.
- **Strict code style.** Follow the [`rowbly-code-style` skill](../../.agents/skills/rowbly-code-style/SKILL.md).
  `src/services/factory-manager/` is the reference implementation of the style.

## `ServiceContext`

Most public service functions take a `ServiceContext` as their last parameter. The type is in
`src/services/workspace/`. All of its fields are optional:

| Field       | Default                         | Function                                                           |
| ----------- | ------------------------------- | ------------------------------------------------------------------ |
| `cwd`       | `process.cwd()`                 | The directory where the Project search starts.                     |
| `home`      | `os.homedir()`                  | The home directory, for `~/.rowblyrc.json` and `~/.cache/rowbly/`. |
| `now`       | the system time                 | The clock.                                                         |
| `skillsDir` | `skills/` of the Rowbly package | The folder of the bundled skills.                                  |
| `recorder`  | none                            | The `WriteRecorder` of a remote worker. See below.                 |

The CLI sets `cwd` from `-C <dir>`. Tests set the fields to temporary paths.

### The `recorder` key

A remote worker writes to a copy of the Project. The `recorder` records each Story write in an outbox,
so that the main machine can apply the changes to the board later. The module is `src/services/outbox/`.

- Without a `recorder`, the services do not record writes, and their behaviour does not change.
- With a `recorder`, `updateStory` records one entry after it writes the Story file. The entry has the
  Story ID and one change for each changed path: `title`, `description`, `stage`, `fields.<key>`,
  `tags` and `dependsOn`. Each change has a `before` and an `after` value. `tags` and `dependsOn` are
  complete lists.
- An entry does not have `updatedAt`, `position` or `createdAt`. A write that changes no recorded value,
  for example `touchStory`, records no entry. A write that fails records no entry.
- With a `recorder`, all other canonical writes call `refuseRemoteWrite(ctx, action)` before they write.
  It throws a `ConflictError` with the message `A remote worker cannot <action>`. This applies to new and
  deleted Stories, Stages, Specs, tags, custom fields, prompts, skills, the Project, the factory
  settings, `doctor --fix`, the renumber of duplicate IDs, the start of the factory and all attachment
  writes.
- If you add a service that writes a canonical file, record the write or call `refuseRemoteWrite`.
- A service does not read `process.env`. The CLI makes the recorder in `run`
  (`src/commands/output/outbox-env.ts`) from two environment variables:

| Variable           | Value                                                             |
| ------------------ | ----------------------------------------------------------------- |
| `ROWBLY_OUTBOX`    | The absolute path of the outbox folder of the worker host.        |
| `ROWBLY_THREAD_ID` | The Thread of the remote worker. Each entry has it as `threadId`. |

If `ROWBLY_OUTBOX` is set and `ROWBLY_THREAD_ID` is not set, each command fails with a `VALIDATION`
error before it writes. See [storage.md](storage.md#outbox-of-a-remote-worker) for the files.

## Errors

Use a subclass of `RowblyError` from `src/services/errors/`. Each error has a `code`, an optional
`hint` and optional `details`.

| Class             | `code`       | Use it when …                                                        |
| ----------------- | ------------ | -------------------------------------------------------------------- |
| `ValidationError` | `VALIDATION` | The input breaks a rule.                                             |
| `NotFoundError`   | `NOT_FOUND`  | A record that the input names does not exist.                        |
| `ConflictError`   | `CONFLICT`   | The input clashes with a record that exists, or with its dependents. |

Each front end shows the errors in its own way:

- The CLI prints the message, the issues and the hint, and sets exit code 1. With `--json`, it prints
  the error as JSON. See [cli.md](cli.md#output-and-errors).
- The TUI shows a toast with the hint.
- If a `ValidationError` has `details.issues` (`{ path: [field], message }`, the issue shape of Zod),
  a TUI `Form` shows each message below its field.

An error that is not a `RowblyError` is a bug. The CLI throws it again.

## Module index

Each module is a folder in `src/services/`. This index gives the function of each folder.

### Project data

| Module              | Function                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace/`        | `findProject()`, `hasProject()`, `projectPaths()`, `runtimePaths()`, `ServiceContext`.                                                                                   |
| `config/`           | `ProjectConfig` types, checks, key rules, and read and write of the config.                                                                                              |
| `project/`          | `initProject()`, `getProject()`, `updateProject()`.                                                                                                                      |
| `story/`            | Create, update, delete, get and search Stories, and their places in the Stages.                                                                                          |
| `stage/`            | List, create, update, delete and get Stages and their prompts.                                                                                                           |
| `custom-field/`     | Add, update and remove custom fields.                                                                                                                                    |
| `spec/`             | Specs and their links to Stories.                                                                                                                                        |
| `attachment/`       | File attachments of a Story.                                                                                                                                             |
| `doctor/`           | Compare the files with the config, and repair problems.                                                                                                                  |
| `onboarding/`       | `planOnboarding()`, `applyOnboarding()`: the shared setup of a new Project.                                                                                              |
| `skill/`            | Install, list and remove the bundled skills for each harness.                                                                                                            |
| `prompts/`          | `listPrompts()`, `getPrompt()`, `setPrompt()`: the user prompts in `.rowbly/prompts/`.                                                                                   |
| `known-project/`    | `listKnownProjects()`, `recordProject()`, `forgetProject()`: `~/.rowblyrc.json`.                                                                                         |
| `host/`             | `addHost()`, `listHosts()`, `removeHost()`: the worker hosts in `~/.rowblyrc.json`.                                                                                      |
| `user-rc/`          | `readRc()`, `writeRc()`: the shared safe read and write of `~/.rowblyrc.json`.                                                                                           |
| `story-watch/`      | `watchStories()`, `watchFactoryState()`: call a function when Story files or `state.json` change. They watch only the Story folders and the state files, not `runtime/`. |
| `project-watch/`    | `watchRoutes()`: the shared watches of the process. Each watched path has one handle for all subscribers.                                                                |
| `pi-catalog-cache/` | `readPiCatalog()`, `refreshPiCatalog()`, `piProviderReady()`: the model cache in `~/.cache/rowbly/`.                                                                     |

### Shared helpers

| Module                                             | Function                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `errors/`                                          | `RowblyError` and its subclasses.                                           |
| `fields/`                                          | Custom field value checks, and the parse of text input for each field type. |
| `markdown/`                                        | YAML frontmatter and body: parse and write.                                 |
| `files/`                                           | Small file helpers, for example `pathExists()` and `pathOccupied()`.        |
| `story-files/`, `spec-files/`, `attachment-files/` | Raw file I/O that the domain services share.                                |
| `clipboard/`                                       | Read a copied file path or an image from the system clipboard.              |
| `store/`                                           | `Store`, `withEntry()`, `withMember()` and more: immutable shared state.    |
| `in-order/`                                        | `mapInOrder()`: run async work one item at a time, in order.                |
| `test-project/`                                    | `useTempDir()`, `useTestProject()`: temporary Projects for tests.           |

### Native factory

| Module                              | Function                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| `pi-runtime/`                       | Lazy Pi imports, sessions, runtime, model catalog and Pi worker.    |
| `agent-auth/`                       | Provider status, model checks, login and logout.                    |
| `factory-settings/`                 | The `factory` config key, the role models, Git sync and checks.     |
| `factory/`                          | Daemon client, status, controls and operational logs.               |
| `factory-manager/`                  | Serial factory loop, dispatch, reservations and worker lifecycle.   |
| `factory-worker/`                   | Independent worker session, result and activity.                    |
| `check-queue/`                      | The memory-aware queue of the worker checks in the daemon.          |
| `factory-ownership/`                | Daemon ownership and process identity.                              |
| `factory-control/`                  | Durable commands and receipts.                                      |
| `factory-recovery/`                 | Reconciliation after owner death, and resume eligibility.           |
| `factory-policy/`, `factory-state/` | The v1 policy rules and the `state.json` transactions.              |
| `factory-activity/`                 | The factory activity of each Story, from `state.json`.              |
| `project-write/`                    | The Project write lock and the commits of canonical factory writes. |
| `file-lock/`                        | `withFileLock()`: an exclusive kernel `flock` on one file.          |
| `outbox/`                           | The `WriteRecorder`, the Story changes and the `outbox.jsonl` file. |
| `project-sync/`                     | The Git pull and push of the canonical checkout.                    |
| `runtime-files/`                    | Private runtime paths and ignore rules.                             |
| `thread/`                           | Thread metadata, runs, state projection and watches.                |
| `conversation/`                     | Read-only Pi v3 history of a selected file, in bounded pages.       |
| `messages/`                         | The only builder of the worker messages.                            |
| `worker-worktree/`                  | One worktree for each Story. Existing work stays.                   |
| `tool-schema/`                      | Converts a Zod schema to the JSON Schema of a Pi tool.              |
| `host-transport/`                   | The SSH transport and the handshake to a worker host. No Pi.        |
| `host-install/`                     | The Node check and the install of Rowbly on a worker host. No Pi.   |
| `host-agent/`                       | The host agent of a Project on a worker host (`host serve`). No Pi. |

See [native-factory/README.md](native-factory/README.md) for how these modules work together.

## Related

- [cli.md](cli.md) and [tui.md](tui.md): the two front ends.
- [storage.md](storage.md): the files that the services read and write.
- [testing.md](testing.md): service tests with `useTestProject()`.
