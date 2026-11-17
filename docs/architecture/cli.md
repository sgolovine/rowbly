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

| Folder                                                 | Function                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `register-commands/`                                   | `registerCommands()`: adds the global options and attaches each command.                        |
| `output/`                                              | `run()`, `collect()`, `parseFieldFlags()`, `parsePosition()`, `formatValue()`.                  |
| `test-cli/`                                            | `runCli()`, `createProgram()`: run commands in tests.                                           |
| `init/`                                                | The `rowbly init` command: flags and JSON input.                                                |
| `init-wizard/`                                         | `askOnboarding()`: the `@clack/prompts` questions of `rowbly init`.                             |
| `project/`                                             | `project update`: the name, the key, Specs and the display options.                             |
| `prompt/`                                              | `prompt list`, `prompt get`, `prompt set`: the user prompts of a Project.                       |
| `doctor/`                                              | `rowbly doctor [--fix]`.                                                                        |
| `status/`                                              | `rowbly status`: a short summary of the factory, the Threads and the Stories.                   |
| `story/`, `stage/`, `custom-field/`, `spec/`, `skill/` | The commands of each resource.                                                                  |
| `tag/`                                                 | `tag list`, `add`, `update`, `remove`: the tags of a Project.                                   |
| `attachment/`                                          | `add-attachment`, `list-attachments`, `get-attachment`, `open-attachment`, `remove-attachment`. |
| `auth/`, `auth-wizard/`                                | `auth providers`, `status`, `login`, `logout`, and the interactive login prompt.                |
| `model/`                                               | `model list`.                                                                                   |
| `factory/`, `factory-runner/`                          | `factory` commands, and the foreground adapter that runs the daemon.                            |
| `thread/`                                              | `thread list`, `show`, `log`, `cancel`, `release`, `resume`, `held`.                            |
| `host/`                                                | `host add`, `check`, `login`, `list`, `update`, `remove`, `use`, `unuse`, hidden commands.      |

The native commands are in [native-factory/controls.md](native-factory/controls.md).

## Global options and resource commands

`registerCommands()` adds two global options:

- `--json` prints the results and the errors as JSON.
- `-C, --cwd <dir>` runs as if Rowbly started in `<dir>`.

Most commands belong to a resource command, for example `story`, `stage`, `custom-field`, `tag`, `spec`,
`skill`, `project`, `prompt`, `factory`, `auth`, `model`, `thread` and `host`. A resource command with no action prints
its help. A resource command with an unknown action gives an error. `init`, `doctor`, `status` and the
attachment commands are at the top level. Commander gives `--help` for each subcommand automatically.

`get-attachment <story> <id>` gives the attachment record and the absolute `path` of its file. Without
`--json`, it prints only the path. A worker uses this path to read the file with its read tool. An
unknown Story or id, or a missing file, gives `NOT_FOUND`. A bad id gives `VALIDATION`. In the CLI of
a remote worker, with `ROWBLY_OUTBOX` and `ROWBLY_HOST_AGENT`, a file that is not in the copy comes
from the host agent. When the host cannot get the file, the command gives `CONFLICT`. See
[Attachment fetch](native-factory/host-agent.md#attachment-fetch).

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
not need a Project, and they read and write the `hosts` key of `~/.rowblyrc.json`. Only `host use`
and `host unuse` need a Project. The `host-project` service does their work. See
[storage.md](storage.md#rowblyrcjson). For an overview of the worker hosts, see
[native-factory/remote-hosts.md](native-factory/remote-hosts.md).

- `host add <id> --ssh <target> --max-workers <n>` checks Node 22.19.0 or later on the host, and
  installs the exact Rowbly build of the main machine in a private folder on the host. Then it adds
  the host at the end of the list. A new host is on (`enabled: true`). The result is the host with an
  `install` object. See [host-install.md](native-factory/host-install.md). If the Node check or the
  install fails, `host add` gives `HOST_NODE_MISSING`, `HOST_NODE_TOO_OLD` or `HOST_INSTALL_FAILED`,
  and `~/.rowblyrc.json` does not change. After the install, `host add` runs the host check and gives
  it in the `check` key. The text output lists the `fail` and `warning` items with their actions. A
  failed item does not make `host add` fail.
- `host check <id>` shows if the host is ready. With `--json`, the result is `{ host, ready, items }`.
  The text output has one line for each item with its state, and the action of each `fail` or
  `warning` item. The exit code is 0 also when items fail. An unknown id gives `NOT_FOUND`. After the
  check, Rowbly writes a summary to the `lastCheck` key of the host entry. `host add` also writes it. See
  [host-check.md](native-factory/host-check.md).
- `host login <id>` runs `ssh -t <target> <remote rowbly> auth login`, so that the user logs in to Pi
  on the host. It must run in a terminal. With `--json`, or without a terminal, it gives
  `VALIDATION` and starts no process. The exit code is the exit code of SSH.
- `host list` shows the hosts in the order of the file. With `--json`, the result is an array of
  `{ id, ssh, maxWorkers, enabled }`. A file without `hosts` gives `[]`.
- `host update <id> [--max-workers <n>] [--enable | --disable]` changes the worker limit of the host,
  or turns the host on or off for all Projects. The result is the changed host
  `{ id, ssh, maxWorkers, enabled }`. All other keys of the host entry and of the file stay.
  - A worker limit that is not a whole number of 1 or more gives `VALIDATION`.
  - A command without a change gives `VALIDATION`. `--enable` and `--disable` together give
    `VALIDATION`.
  - An unknown id gives `NOT_FOUND`.
- `host remove <id> [--purge]` removes the host. The result is the host with `purge` (`true` or
  `false`). At this time, `--purge` does no work. The clone and the worktrees stay on the host.
- `host use <id> [--path <dir>]` turns the host on for the current Project. The host then has a
  clone of the repository of the Project. Rowbly writes the record to the `projects` list of the host
  only after the remote steps pass. The result is `{ host, root, path, managed, url, cloned }`.
  - Without `--path`, Rowbly clones the local `origin` URL into the managed folder
    `.local/share/rowbly/projects/<project-id>/repo`, relative to the home folder of the SSH user. If
    the folder has a clone of the same repository, Rowbly uses it again and does not clone. If the
    folder has a different thing, `host use` gives `CONFLICT`.
  - With `--path <dir>`, Rowbly uses an existing clone and does not clone. The folder must be a Git
    work tree, its `origin` must be the same repository, and `git status --porcelain` must be empty.
    If not, `host use` gives `VALIDATION`. A leading `~/` becomes a path relative to the home folder.
  - Two URLs are the same repository when their `host/owner/repo` forms are equal. Thus
    `git@github.com:o/r.git`, `ssh://git@github.com/o/r` and `https://github.com/o/r.git` are the same.
  - A Project without an `origin` remote gives `VALIDATION`. An `origin` URL or a `--path` with a
    character that is not a safe remote token gives `VALIDATION` before any remote command.
  - A clone that fails because the host has no Git access gives `HOST_GIT_ACCESS`. Another failure of
    the clone gives `HOST_CLONE_FAILED`. The two errors have the stderr of `git clone` in `details`.
  - An unknown host gives `NOT_FOUND`. A Project that the host uses gives `CONFLICT`. Run
    `host unuse` first.
- `host unuse <id>` turns the host off for the current Project. It removes only the record. The clone
  and the worktrees stay on the host. It runs no remote command. It gives `NOT_FOUND` when the host
  does not use the Project, and `CONFLICT` while a `pending` or `running` Thread of the current
  Project is on the host.
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
- `rowbly factory configure --placement <policy>` sets how the factory selects the machine of a new
  worker: `prefer-local`, `most-free` or `prefer-remote`. See
  [native-factory/controls.md](native-factory/controls.md#the-placement-flag-of-factory-configure)
  and [native-factory/pi-runtime-and-auth.md](native-factory/pi-runtime-and-auth.md#placement).
- `rowbly factory configure --stage <key> --class <work|hold>` sets the class of a Stage in
  `factory.stageClasses`. `--stage <key> --clear-class` removes it. See
  [native-factory/controls.md](native-factory/controls.md#cli-commands).
- `rowbly factory release <story-id>` releases a parked Story in the live factory. It sends the
  control command `release-story` to the daemon and waits for the receipt. A Story that is not parked gives
  a success with no change. Without a live daemon, it gives `CONFLICT` with the text
  `Factory is not running`. With `--json`, it prints the receipt with `storyId`. See
  [native-factory/controls.md](native-factory/controls.md#the-release-command).
- `rowbly factory status --json` has a `hosts` list with the state and the slots of each machine.
  See [native-factory/README.md](native-factory/README.md#placement) and
  [native-factory/runtime-and-locks.md](native-factory/runtime-and-locks.md#factory-files-in-rowbly).
- `rowbly thread held <id>` lists, applies or discards the held entries of an abandoned remote
  Thread. See [Held entries](#held-entries).
- `host blob <sha256> [project-id]` is hidden. It does not show in `rowbly host --help`. The main
  machine runs it on a worker host to get the file of an `attachment.add` entry. With a project id,
  the command reads the outbox folder of the host agent of that Project. Without it, the command
  reads the outbox folder from `ROWBLY_OUTBOX`. It does not need `ROWBLY_THREAD_ID`. It writes the exact bytes of
  `$ROWBLY_OUTBOX/blobs/<sha256>.png` to stdout and exits with 0.
  - A value that is not 64 lowercase hex characters gives a `VALIDATION` error. A missing
    `ROWBLY_OUTBOX` also gives `VALIDATION`.
  - A blob or a `blobs` folder that is a symlink, or a path that resolves outside `blobs/`, gives a
    `VALIDATION` error.
  - A hash without a file gives `NOT_FOUND`.
  - An error writes nothing to stdout. The error output is the usual output, also with `--json`.
    See [storage.md](storage.md#outbox-of-a-remote-worker).
- `host serve`, `host submit`, `host attach`, `host run-paths`, `host prepare`, `host inbound`,
  `host cache-missing`, `host cache-put`, `host ping`, `host runs` and `host session-bytes` are hidden. The main
  machine runs them on a worker host over SSH. The data goes on stdin. The output is JSON, but `host session-bytes`
  writes raw bytes. See [native-factory/host-agent.md](native-factory/host-agent.md).
  - `host serve --detach` reads `{ "projectId": "<id>", "maxWorkers": <n> }`. It writes the machine
    limit and starts a detached host agent, if no live agent holds the claim. It writes
    `{ "started": boolean, "owner": <Owner> }`.
  - `host serve <project-id>` is the host agent itself. The detached start runs it.
    It writes the CLI shim of the workers to `agent/bin/rowbly`, then it runs the agent with the
    worker runner.
  - `host submit <project-id>` reads one command. It writes the command to a file and writes the
    current receipt, or `null`.
  - `host attach <project-id>` writes frames: first the hello frame, then `status`, `receipt` and
    `run` frames. It stops at the end of stdin.
  - `host run-paths <project-id>` reads `{ "threadId": "<id>", "storyId": "<id>", "clone": "<path>" }`.
    It writes the absolute run paths of the host: `{ clone, copy, worktree, lock, shim, outbox }`.
  - `host prepare <project-id>` reads the copy and the launch data of one Thread (32 MiB or less).
    It writes the copy to the Thread folder and writes `{ threadId, copy, files, attachments }`.
    It gives `CONFLICT` while the Thread has active work.
  - `host inbound <project-id>` reads `{ "threadId": "<id>", "updates": [...] }` (32 MiB or less). It
    applies the inbound updates to the copy of the Thread in `seq` order and writes
    `{ threadId, appliedSeq }`. A Thread that is not prepared gives `NOT_FOUND`.
  - `host cache-missing <project-id>` reads `{ "ids": [<attachment id>, …] }`. It writes
    `{ "missing": [<id>, …] }` with the ids that are not in the attachment cache.
  - `host cache-put <project-id> <attachment-id>` reads the bytes of an attachment file of any
    type (10 MiB or less). It puts them in the attachment cache and writes `{ id, added }`.
  - `host ping <project-id>` is the heartbeat of the main machine. It writes
    `{ protocol, rowbly, agent, slots, pending }`: the versions of the host, and the status values of
    the host agent. It does not start the agent.
  - `host runs <project-id>` reads `{ "threadIds": [<thread id>, …] }` (1000 ids or less). It writes
    `{ "runs": [<run state>, …] }`: the `run.json` of each requested Thread that has one on the host. A
    Thread without `run.json` is not in the list. The main machine uses it after a restart of the
    daemon. It does not start the agent.
  - `host session-bytes <project-id>` reads `{ "threadId": "<id>", "file": "sessions/<thread-id>/<name>.jsonl",
    "offset": <n> }`. It writes the complete session lines of the Thread from `offset` to stdout, a maximum of
    4 MiB. A window without a newline in a file that continues gives the full window. A `file` that is absolute,
    that has a `..` part or that is not below `sessions/<thread-id>/` gives `VALIDATION`. A missing file gives
    `NOT_FOUND`. The main machine uses it to fill a gap of the session mirror of a remote Thread.
  - A bad project id, a bad input or bad JSON gives `VALIDATION`.
- `host outbox [project-id]` and `host outbox-ack [project-id]` are hidden. The main machine runs them
  on a worker host to apply the outbox. Each command reads one JSON object on stdin. With a project
  id, the command uses the outbox folder of the host agent of that Project. Without it, the command
  reads the outbox folder from `ROWBLY_OUTBOX`. A bad project id gives `VALIDATION`. They do not need `ROWBLY_THREAD_ID`. Use `--json` to get the JSON output.
  - `host outbox` reads `{ "afterSeq": <n> }`. It gives `{ "entries": [...] }`: the complete entries
    with a `seq` greater than `afterSeq`, in `seq` order.
  - `host outbox-ack` reads `{ "seq": <n> }`. It removes the entries with a `seq` equal to or less
    than `seq`, and each file of `blobs/` that no remaining entry points to. It gives `{ "removed": <n>, "blobs":
    [<sha256>, ...] }`.
  - Text that is not a JSON object, a value that is not a whole number of 0 or more, or a missing
    `ROWBLY_OUTBOX` gives a `VALIDATION` error.
    See [storage.md](storage.md#apply-on-the-main-machine).

### Release a remote Thread

`rowbly thread release <id>` releases a worker that runs on a worker host. The command sends the
factory command `release` with `sendFactoryCommand`, as `rowbly thread cancel <id>` sends `cancel`.
The command needs a running factory. `--json` gives the receipt of the command.

- The manager action is `releaseWorker` in `src/services/factory-manager/worker-reservation.ts`. It
  does the same run checks as a cancel: `Worker run changed` and `Worker is not active`.
- A release stops the worker as a cancel. The Thread becomes `cancelled`, and the host gets
  `cancel-thread`.
- A release does not hold the Story for the user. The scan does not give `cancelled by user`. Thus the
  policy can start a new worker for the Story.
- When the host is offline, the Thread becomes abandoned with the reason `release`, and the Story does
  not wait for that host. See [native-factory/README.md](native-factory/README.md#abandoned-threads).
- A Thread on the main machine (`host` is `local`) gives a `CONFLICT` error.

### Held entries

`rowbly thread held <id> [--apply | --discard]` shows or changes the held outbox entries of an
abandoned remote Thread. The command does not need a running factory. The service is
`heldAction` in `src/services/outbox-apply/held-actions.ts`. See
[native-factory/README.md](native-factory/README.md#abandoned-threads).

- Without an option, the command lists the held entries: the `seq`, the Story, and the paths or the
  attachment id of each entry. A Thread without held entries gives an empty list.
- `--apply` applies the held entries under the Project write lock, with the same compare-and-set as
  the outbox apply. The applied entries leave the held folder. An entry with a conflict stays held,
  and the result lists the conflict. A second `--apply` has no new effect and gives no error.
- `--discard` deletes the held folder of the Thread under the Project write lock. The canonical
  Story does not change.
- `--apply` and `--discard` together give a `VALIDATION` error.
- `--json` gives `{ action, threadId, host, ... }`: `entries` for a list, `applied` and `conflicts`
  for an apply, and `discarded` for a discard. `host` is `null` for a Thread of the main machine.

### Connection lost

`thread list`, `thread show` and `status` show the remote Threads that lost the connection to their
worker host. The service `thread-connection` reads only the `hosts` list of the factory status. It does
not open SSH, and it does not load Pi.

- A remote Thread has a `host` that is not `local`, and its status is `running` or `pending`. Its
  connection is lost when the `hosts` list gives its host a state other than `connected` or
  `degraded`, or when the list does not have its host. Then `hostState` is `unknown`.
- Without a factory that runs, there is no `hosts` list. Then no Thread has a lost connection.
- `thread list` adds `connection lost (last contact <duration> ago)` at the end of the line of the
  Thread. Without `lastSeenAt` of the host, it adds `connection lost (no contact)`.
- `thread list --json` and `thread show` give a `connection` field for each Thread with a lost
  connection: `{ "state": "lost", "host": <id>, "hostState": <state>, "lastSeenAt"?: <ISO text> }`.
  A Thread without a lost connection has no `connection` field.
- `status` shows one line for each Thread with a lost connection, below the `Threads` line: the Thread
  ID, the Story ID, the host and the time since the last contact. `status --json` gives the same
  facts in the `connectionLost` list: `{ threadId, storyId?, host, hostState, lastSeenAt?,
  lastContactMs? }`. The list is not there when no Thread lost its connection.

## Output and errors

`run(command, call, text)` in `src/commands/output/` connects a command to a service:

1. It reads `--json` and `--cwd`, and makes the `ServiceContext`.
2. It calls the service.
3. It prints `text(result)`, or the result as JSON with `--json`.
4. If the service throws a `RowblyError`, it prints the message, each issue and the hint to stderr.
   With `--json`, it prints `{ "error": { code, message, hint, details } }`. Then it sets exit code 1.
5. It throws each other error again, because that error is a bug.

`runWithoutContext(command, call, text)` does the same work, but it does not make a `ServiceContext`.
Thus it does not need `ROWBLY_THREAD_ID` when `ROWBLY_OUTBOX` is set. The hidden `host outbox` and
`host outbox-ack` commands use it. `runBytes(command, call)` writes raw bytes to stdout, for
`host blob`.

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
