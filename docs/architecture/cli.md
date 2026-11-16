# CLI

The CLI is one of the two thin front ends of Rowbly. Commander.js parses the arguments, and each
command calls a service. The `output` module prints the result as text or as JSON and turns a
`RowblyError` into exit code 1.

Read this when you add or change a CLI command, a flag, the text or JSON output, or an exit code.

## Mode selection

`src/cli.ts` is the entry point. It builds the Commander program and selects the mode:

- With no arguments, it loads `src/tui/index.tsx` with a dynamic `import()` and starts the TUI through
  `renderTui()`. It gives the TUI the Node executable, the Node flags and the entry file. The Factory
  controls use them to start the daemon.
- With arguments, Commander parses them and runs one command.

Keep `src/cli.ts` small. It only connects the parts. Do not import Ink, React or a module in
`src/tui/` statically in `src/cli.ts`. The CLI commands must not load the TUI. tsup puts the TUI in a
separate chunk in `dist/`. The test `src/cli.test.ts` makes sure of this. `--version` (`-v`) reads the version from
`package.json`. Change the version only in that file.

## Layout of `src/commands/`

Each command module is a folder: `<name>/<name>.ts`, and `<name>/<name>.test.ts` when the module has a
test.

| Folder                                                 | Function                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `register-commands/`                                   | `registerCommands()`: adds the global options and attaches each command.         |
| `output/`                                              | `run()`, `collect()`, `parseFieldFlags()`, `parsePosition()`, `formatValue()`.   |
| `test-cli/`                                            | `runCli()`, `createProgram()`: run commands in tests.                            |
| `init/`                                                | The `rowbly init` command: flags and JSON input.                                 |
| `init-wizard/`                                         | `askOnboarding()`: the `@clack/prompts` questions of `rowbly init`.              |
| `project/`                                             | `project update`: the name, the key, Specs and the display options.              |
| `prompt/`                                              | `prompt list`, `prompt get`, `prompt set`: the user prompts of a Project.        |
| `doctor/`                                              | `rowbly doctor [--fix]`.                                                         |
| `status/`                                              | `rowbly status`: a short summary of the factory, the Threads and the Stories.    |
| `story/`, `stage/`, `custom-field/`, `spec/`, `skill/` | The commands of each resource.                                                   |
| `tag/`                                                 | `tag list`, `add`, `update`, `remove`: the tags of a Project.                    |
| `attachment/`                                          | `add-attachment`, `list-attachments`, `open-attachment`, `remove-attachment`.    |
| `auth/`, `auth-wizard/`                                | `auth providers`, `status`, `login`, `logout`, and the interactive login prompt. |
| `model/`                                               | `model list`.                                                                    |
| `factory/`, `factory-runner/`                          | `factory` commands, and the foreground adapter that runs the daemon.             |
| `thread/`                                              | `thread list`, `show`, `log`, `cancel`, `resume`.                                |
| `host/`                                                | `host add`, `list`, `remove`, hidden `blob`: the worker hosts of the user.       |

The native commands are in [native-factory/controls.md](native-factory/controls.md).

## Global options and resource commands

`registerCommands()` adds two global options:

- `--json` prints the results and the errors as JSON.
- `-C, --cwd <dir>` runs as if Rowbly started in `<dir>`.

Most commands belong to a resource command, for example `story`, `stage`, `custom-field`, `tag`, `spec`,
`skill`, `project`, `prompt`, `factory`, `auth`, `model`, `thread` and `host`. A resource command with no action prints
its help. A resource command with an unknown action gives an error. `init`, `doctor`, `status` and the
attachment commands are at the top level. Commander gives `--help` for each subcommand automatically.

### Project update

`rowbly project update` changes the Project config through `updateProject`:

- `--name <name>` and `--key <key>` change the name and the key. A new key renames all Story files.
- `--specs <on|off>` turns Specs on or off.
- `--compact-threads <on|off>` sets `display.compactThreads`. When it is on, each Thread in the TUI
  uses one line. When the config does not have the value, the compact mode is on.
- `--time-zone <zone>` sets `display.timeZone`, for example `Europe/Berlin`. The TUI shows the Story
  times in this time zone. `--time-zone ""` removes the key, and the TUI uses the system time zone.
  A name that `Intl.DateTimeFormat` does not accept gives a `VALIDATION` error and exit code 1.

A value that is not `on` or `off` gives a Commander error and exit code 1.

### Story dependencies

`rowbly story create` and `rowbly story update` set the upstream Stories of a Story. The words
(Upstream Story, Downstream Story, Complete, Blocked and Ready) are in
[domain-concepts.md](domain-concepts.md).

- `--depends-on <ids>` gives a comma-separated list of Story IDs. You can use the flag more than one
  time. Rowbly ignores the spaces around a comma and removes the empty items. On update, the list
  replaces the old list. `--depends-on ""` removes all dependencies.
- `--add-dependency <id>` and `--remove-dependency <id>` change one item of the list on update. You can
  use each flag more than one time. An add of an ID that is in the list, or a remove of an ID that is not
  in the list, changes nothing. The command sends these flags to `updateStory` as `addDependsOn` and
  `removeDependsOn`, so the change occurs in one service call.
- `--depends-on` with `--add-dependency` or `--remove-dependency` gives a Commander error and exit code 1.
- An unknown ID, an ID of a different Project, a self reference or a cycle gives a `VALIDATION` error
  and exit code 1. With `--json`, `details` has the IDs, for example `details.cycle` or
  `details.unknown`. No file changes.

`rowbly story get` calls `getStoryDetails`. The text output has the lines `Depends on`, `Blocks` and
`Blocked` (`yes` with the IDs of the upstream Stories that are not complete, or `no`). An empty list
shows `none`. The JSON result has the arrays `dependsOn`, `blocks` and `waitingFor`.

The text output of `rowbly story get` also has the lines `Created` and `Updated`, with the saved UTC
times. A missing time shows `—`. Each Story record of the JSON output has `createdAt` and `updatedAt`,
an ISO 8601 UTC string or `null`.

`rowbly story search --blocked` shows only the blocked Stories, and `--ready` shows only the ready
Stories. The two flags together give a Commander error and exit code 1. Each flag works together with
the query, `--stage` and `--field`.

### Tags

`rowbly tag` manages the tags of the Project through the `tag` service:

- `tag list` shows the tags in config order. With `--json`, the result is an array of `{ value, label }`.
- `tag add --label <label> --value <value>` adds a tag. A value that exists gives a `CONFLICT` error.
  An empty label or a value that is not valid gives a `VALIDATION` error.
- `tag update <value> --label <label>` changes only the label. The command has no option for the value.
- `tag remove <value>` removes the tag from the config and from each Story that has it. It does not ask
  for confirmation.
- An unknown value for `tag update` or `tag remove` gives a `NOT_FOUND` error with the list of values.

`rowbly story create --tag <value>` sets the tags of a new Story. On `rowbly story update`, `--tag`
replaces the list, and `--add-tag` and `--remove-tag` change one item of the list. You can use each
flag more than one time. `--tag ""` removes all tags. `--tag` with `--add-tag` or `--remove-tag` gives
a `VALIDATION` error. A value that is not a tag of the Project gives a `VALIDATION` error, and no file
changes.

`rowbly story get` shows a `Tags` line, and the JSON result has the array `tags` (`[]` when the Story
has no tags). `rowbly story search --tag <value>` shows only the Stories that have the tag. With more
than one `--tag`, a Story must have all of the tags.

### Worker hosts

`rowbly host` manages the worker hosts through the `host` service. A worker host is a remote machine
that runs factory workers only. The hosts belong to the user, not to a Project. Thus the commands do
not need a Project, and they read and write the `hosts` key of `~/.rowblyrc.json`. See
[storage.md](storage.md#rowblyrcjson).

- `host add <id> --ssh <target> --max-workers <n>` adds a host at the end of the list. A new host is
  on (`enabled: true`). The result is the host.
- `host list` shows the hosts in the order of the file. With `--json`, the result is an array of
  `{ id, ssh, maxWorkers, enabled }`. A file without `hosts` gives `[]`.
- `host remove <id> [--purge]` removes the host. The result is the host with `purge` (`true` or
  `false`). At this time, `--purge` does no work, because no clone or worktree exists on a host.
- The id must be dash-case (`^[a-z0-9]+(-[a-z0-9]+)*$`). The id `local` is reserved for the main
  machine.
- The SSH target must not be empty. It must not start with `-`, and it must not have whitespace or
  control characters. Rowbly gives the target to `ssh` as one argument, never in a shell string.
- `--max-workers` must be a whole number of 1 or more.
- A bad id, SSH target or worker limit gives a `VALIDATION` error. An id that exists gives `CONFLICT`
  on `host add`. An unknown id gives `NOT_FOUND` on `host remove`.
- `host remove` gives `CONFLICT` while a Thread on the host is `pending` or `running`. The check reads
  the Threads of each known Project in `~/.rowblyrc.json` that is not missing.
- If Rowbly cannot read `~/.rowblyrc.json`, each `host` command gives a `VALIDATION` error, and the
  file does not change.
- `host blob <sha256>` is hidden. It does not show in `rowbly host --help`. The main machine runs it
  on a worker host to get the PNG of an `attachment.add` entry. The command reads the outbox folder
  from `ROWBLY_OUTBOX`. It does not need `ROWBLY_THREAD_ID`. It writes the exact bytes of
  `$ROWBLY_OUTBOX/blobs/<sha256>.png` to stdout and exits with 0.
  - A value that is not 64 lowercase hex characters gives a `VALIDATION` error. A missing
    `ROWBLY_OUTBOX` also gives `VALIDATION`.
  - A blob or a `blobs` folder that is a symlink, or a path that resolves outside `blobs/`, gives a
    `VALIDATION` error.
  - A hash without a file gives `NOT_FOUND`.
  - An error writes nothing to stdout. The error output is the usual output, also with `--json`.
    See [storage.md](storage.md#outbox-of-a-remote-worker).

## Output and errors

`run(command, call, text)` in `src/commands/output/` connects a command to a service:

1. It reads `--json` and `--cwd`, and makes the `ServiceContext`.
2. It calls the service.
3. It prints `text(result)`, or the result as JSON with `--json`.
4. If the service throws a `RowblyError`, it prints the message, each issue and the hint to stderr.
   With `--json`, it prints `{ "error": { code, message, hint, details } }`. Then it sets exit code 1.
5. It throws each other error again, because that error is a bug.

## Add a CLI command

1. Write or extend the service in `src/services/`. See [service-layer.md](service-layer.md).
2. Add the command to the module of its resource, for example `src/commands/story/`. For a new
   resource, create `src/commands/<resource>/<resource>.ts`. Export a function that registers the
   actions on the resource command:

   ```ts
   import type { Command } from "commander";
   import { createStory } from "../../services/story/story.js";
   import { run } from "../output/output.js";

   export function registerStoryCommands(program: Command): void {
     program
       .command("create")
       .description("Create a story")
       .requiredOption("--title <title>", "story title")
       .action((opts: { title: string }, command: Command) =>
         run(
           command,
           (ctx) => createStory({ title: opts.title }, ctx),
           (story) => `Created ${story.id} in ${story.stage}`,
         ),
       );
   }
   ```

3. Pass the resource command to this function from `registerCommands()` in
   `src/commands/register-commands/`.
4. Add a test that calls `runCli()` from `src/commands/test-cli/`.

The command file only changes flags into service input and formats the service output.

## Interactive prompts

Only `rowbly init` and `rowbly auth login` ask questions, through `@clack/prompts`.

- `rowbly init` asks questions only in a terminal, with no choice flags and no `--json`. See
  [onboarding.md](onboarding.md).
- `rowbly auth login` must run in a terminal without `--json`. API keys use a masked prompt, never an
  argument.

## Related

- [service-layer.md](service-layer.md): the services that the commands call.
- [native-factory/controls.md](native-factory/controls.md): the `auth`, `model`, `factory` and `thread` commands.
- [testing.md](testing.md): `runCli()` in tests.
