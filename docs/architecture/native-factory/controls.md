# Native commands and TUI controls

Users control the native factory through CLI commands and TUI keys. Both front ends call the same
services: `agent-auth/`, `factory-settings/`, `factory/`, `thread/` and `conversation/`. This page
lists the commands and the keys.

Read this when you add or change a native command, a factory key, the Threads tab, the conversation
viewer or the AI section of Settings.

## CLI commands

| Commands                                                                   | Purpose                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `auth providers`, `auth status`                                            | Show login methods and configured status, without a health check.     |
| `auth login [provider] [--type oauth\|api_key]`, `auth logout <provider>`  | Sign in through an interactive prompt, or remove a stored credential. |
| `model list [--provider <id>]`                                             | Show configured models and supported thinking levels.                 |
| `factory configure`                                                        | Set workers, the worker model, thinking level, commits, sync, checks. |
| `factory configure --pull-upstream on\|off`                                | Turn on or turn off the move of stuck upstream Stories.               |
| `factory configure --placement <policy>`                                   | Set the placement policy of new workers.                              |
| `factory configure --stage <key> [--story <id>] --worker <provider/model>` | Set a worker model override for a Stage, or for a Story in a Stage.   |
| `factory configure --stage <key> [--story <id>] --clear-worker`            | Remove a worker model override.                                       |
| `factory configure --stage <key> --class work\|hold`                       | Set the class of a Stage in `factory.stageClasses`.                   |
| `factory configure --stage <key> --clear-class`                            | Remove the class of a Stage. The manager uses its rule again.         |
| `factory configure --fallback-worker <provider/model>` (repeat)            | Replace the fallback worker models, in the given order.               |
| `factory configure --clear-fallback-workers`                               | Remove the fallback worker models.                                    |
| `factory start [--foreground] [--max-workers <n>] [--adopt-external]`      | Start a detached daemon, or use the foreground path.                  |
| `factory status`, `factory stop`, `factory restart [--adopt-external]`     | Observe or control the native daemon.                                 |
| `factory release <story-id>`                                               | Force the live factory to evaluate a Story for a worker. See below.   |
| `factory logs [--tail <n>]`                                                | Read bounded operational logs. There is no follow mode.               |
| `factory check add <key> --command <command> [options]`                    | Add a check that the factory runs for its workers.                    |
| `factory check update <key> [options]`, `factory check remove <key>`       | Change or remove a check.                                             |
| `factory check list`                                                       | Show the checks with their defaults.                                  |
| `thread list [--story <id>]`, `thread show <id>`                           | Read active and historical metadata.                                  |
| `thread log <id> [--tail <n>]`                                             | Read a bounded conversation tail: default 20, maximum 100 entries.    |
| `thread cancel <id>`, `thread resume <id>`                                 | Send guarded commands to the native daemon.                           |
| `thread steer <id> --message <text>`                                       | Send a message of 1 to 4000 characters to a running worker.           |

These inputs of `factory configure` give the error code `VALIDATION`, and the command does not write
`rowbly.config.json`:

- `--story` without `--stage`.
- `--clear-worker` without `--stage`.
- `--clear-worker` together with `--worker` or `--worker-thinking`.
- `--pull-upstream` with a value that is not `on` or `off`.
- `--placement` with a value that is not `prefer-local`, `most-free` or `prefer-remote`.
- `--stage` together with `--max-workers`, `--pull-upstream`, `--placement`, a check flag or a Git flag (`--commit-message`, `--commit-author`,
  `--git-push`, `--no-git-push`, `--git-pull`, `--no-git-pull` or `--git-sync-interval`).
- `--stage` without `--worker` and without `--clear-worker`.
- `--class` with a value that is not `work` or `hold`.
- `--class` or `--clear-class` without `--stage`.
- `--class` together with `--clear-class`.
- `--class` or `--clear-class` together with a flag other than `--stage`, for example `--story` or
  `--worker`.
- `--fallback-worker` with a value that is not `provider/model`.
- `--fallback-worker` together with `--clear-fallback-workers`.
- `--fallback-worker` or `--clear-fallback-workers` together with `--stage`, `--story` or
  `--clear-worker`.
- An unknown Stage key.

An unknown Story ID gives `NOT_FOUND`. For the order of priority of the overrides, see
[pi-runtime-and-auth.md](pi-runtime-and-auth.md#worker-model-overrides). For the fallback worker
models, see [pi-runtime-and-auth.md](pi-runtime-and-auth.md#fallback-worker-models).

`--fallback-worker` writes `factory.fallbackWorkerModels`. Each `--fallback-worker` adds one model to
the new list. The new list replaces the full list. The command validates each model with
`validateModelChoice` before the config changes, as `--worker` does. `--clear-fallback-workers`
removes the key. The other keys of `rowbly.config.json` do not change.

`factory start` and `factory restart` give the error code `VALIDATION` (exit 1) when
`factory.workerModel` is not set. The hint tells you to run
`rowbly factory configure --worker <provider/model>`. `rowbly model list` shows the models. A restart
does this check before the stop, so a live factory continues. With `--json`, the error object goes
to stderr, and stdout is empty.

`factory run` and `factory watchdog` are hidden commands. `factory start` starts a detached
`factory watchdog`, and the watchdog starts `factory run` as its child. See
[recovery.md](recovery.md#automatic-restart-after-a-crash).

### The Git sync flags of `factory configure`

| Flag                            | Key in `factory`          | Effect                                                   |
| ------------------------------- | ------------------------- | -------------------------------------------------------- |
| `--git-push`, `--no-git-push`   | `git.push`                | Turn on or turn off the push of the canonical branch.    |
| `--git-pull`, `--no-git-pull`   | `git.pull`                | Turn on or turn off the pull of the upstream branch.     |
| `--git-sync-interval <seconds>` | `git.syncIntervalSeconds` | Set the time between two syncs. Use 60 to 86400 seconds. |

- A flag that you do not give does not change its key.
- The `--commit-message` and `--commit-author` flags set the commit keys of the same `git` section.
  See [pi-runtime-and-auth.md](pi-runtime-and-auth.md#factory-settings).
- An interval out of the range gives a `VALIDATION` error and exit code 1. The config does not change.
- The command prints all the settings. See [runtime-and-locks.md](runtime-and-locks.md#git-sync-of-the-canonical-checkout)
  for the sync.

### The pull-upstream flag of `factory configure`

| Flag                      | Key in `factory`            | Effect                                                  |
| ------------------------- | --------------------------- | ------------------------------------------------------- |
| `--pull-upstream on\|off` | `dependencies.pullUpstream` | Turn on or turn off the move of stuck upstream Stories. |

- The default is `off`. The other keys of the config do not change.
- When the setting is `on`, the manager moves each stuck upstream Story in the first Stage to the
  first enabled `work` Stage. See [README.md](README.md#parts-of-the-factory).
- The command prints all the settings.

### The placement flag of `factory configure`

| Flag                   | Key in `factory` | Effect                                                                  |
| ---------------------- | ---------------- | ----------------------------------------------------------------------- |
| `--placement <policy>` | `placement`      | Set `prefer-local`, `most-free` or `prefer-remote` for the new workers. |

- The default is `prefer-local`. The other keys of the config do not change.
- See [pi-runtime-and-auth.md](pi-runtime-and-auth.md#placement) for the policies and
  [README.md](README.md#placement) for the rules.
- The command prints all the settings.

### The check commands

| Flag                          | Key in `factory`         | Effect                                                  |
| ----------------------------- | ------------------------ | ------------------------------------------------------- |
| `--max-checks <n>`            | `checks.maxConcurrent`   | Set the number of checks at the same time. Use 1 to 32. |
| `--check-memory-reserve <mb>` | `checks.reserveMemoryMb` | Set the memory that the check queue always keeps free.  |

`factory check add` and `factory check update` take these options:

- `--command <command>`: the full check. `add` must have it.
- `--label <text>`: the name that the TUI shows. `--clear-label` uses the key again.
- `--narrow-command <command>`: the narrow form. It must contain `{files}`. `--clear-narrow-command` removes it.
- `--memory-mb <mb>` and `--timeout-minutes <n>`: the first estimate and the timeout. The
  `--clear-memory-mb` and `--clear-timeout-minutes` flags use the defaults again.
- `--block <text>`: text that the worker bash tool rejects. Repeat the flag for more text.
  `--clear-block` removes all block text.

A duplicate key gives `CONFLICT`. An unknown key gives `NOT_FOUND`. A value out of range gives
`VALIDATION`. In each case, `rowbly.config.json` does not change. See [checks.md](checks.md#settings).

### The release command

`rowbly factory release <story-id>` forces the live factory to evaluate a Story for a worker again. The
result is the same as a move of the Story out of its Stage and back, for example to Backlog and back. Use
it when the factory does not start a worker for a Story in a work Stage. The command does not move the
Story and does not change the Story file. It changes only the factory state.

The command sends the control command `release-story` to the daemon and waits for the receipt. The JSON
output is the receipt with `storyId` and `released`.

- `released: true` tells that the daemon changed its state. The next pass evaluates the Story.
- A Story that does not exist, that is not in a work Stage, or that has an active worker gives
  `released: false`. The factory state does not change.
- The command does not start a second worker. A Story with a pending or running worker Thread, or with an
  attempt whose stop is not confirmed, gives `released: false`.
- Without a live daemon, the command gives `CONFLICT` with the text `Factory is not running`.
- A Story ID that is empty or longer than 128 characters gives `VALIDATION`.
- The command does not load Pi.
- The Story view of the TUI has the `Force assignment` Button and the key `ctrl+r` for this command. See
  [Force assignment in the TUI](#force-assignment-in-the-tui).
- The control command `release-story` is not the control command `release`. `rowbly thread release <id>`
  sends `release` with a Thread ID. See [README.md](README.md#abandoned-threads).

See [recovery.md](recovery.md#release-a-parked-story).

### Force assignment in the TUI

The Story view shows a `Force assignment` Button at the top, above the tabs, when all of these
conditions are true:

- The factory is live.
- The factory status has a queue entry for the Story. The status queue leaves out `hold stage` and
  `stage unavailable`, so a queue entry tells that the Story is in a work Stage.
- The Story has no pending or running Thread.

A click on the Button, or `ctrl+r`, calls `releaseFactoryStory`. The key hints show `ctrl+r force
assignment` while the Button shows. A change of state shows an `info` toast. A result with
`released: false` shows a `warning` toast. A failure shows an error toast with the reason.
`useForceAssignment` in `src/tui/screens/stories/force-assignment/` reads the shared factory status and
the Threads of the Story.

## Factory controls in the TUI

- `f` opens Factory controls. It is a global key of the shell.
- The header shows the active and pending counts when space permits.
- When the live factory has checks, the `Checks` row shows the running and queued checks, the limit
  and the free memory.
- When the live factory has a worker host, the `Hosts` list shows each host: the id, the connection
  state, `<used>/<max>` slots and, for a host that is not `connected` or `degraded`, the time since
  the last contact or `no contact`. Without a worker host, the list does not show.
- When the factory settings have no worker model, Factory controls show the notice
  `No worker model is set. The factory cannot start a worker without one. Press a to select it in Settings › AI.`
  The `s` key stays available. A start shows the error of the service and its hint in a toast.
- In Factory controls:
  - `s` starts the factory.
  - `x` requests a stop, with confirmation.
  - `w` opens the list of all warnings (`Factory › Attention`). The key works only when the live
    factory has warnings.
  - A click on a row of the `Attention` list selects the row. A click on the selected row opens the
    detail view of that warning.
  - The `Attention` list shows five rows at a time. When it has more rows, `↑/↓` and the mouse
    wheel scroll the list by one row. A `↑ n more` row and a `↓ n more` row give the number of hidden
    rows above and below.
  - `d` (or the `Dismiss all` button) asks for confirmation, then sends one `dismiss` command for
    each attention entry, one after the other. The button and the key show only when the live
    factory has an attention entry. A pending toast shows during the work, then an info toast gives
    the number of dismissed warnings. If a command fails, an error toast shows and that warning stays.
    Other warnings (heartbeat, Thread file issues, providers and the watchdog) stay in the list.
  - `h` opens the history of the old supervisor Threads (`Factory › Old supervisor Threads`). The
    factory does not create supervisor Threads now. In the history, `enter` shows the read-only
    conversation of the selected Thread, and `esc` goes back to the history.
  - `a` opens Settings at the AI section.
- In the list of the warnings, `↑/↓` selects a row, `enter` opens the detail view and `esc` goes back.
- The detail view (`Factory › Attention › <title>`) shows the full text of the warning, its kind,
  its Story and its related Thread. A Thread file issue shows the file and the message.
  - `o` (or the `Story` button) closes the Factory controls and opens the Story in the Story sidebar.
  - `t` (or the `Thread` button) closes the Factory controls and opens the related Thread in the
    Story sidebar.
  - `d` (or the `Dismiss` button) sends a `dismiss` command to the daemon. Only an attention entry
    has this action. If the command fails, an error toast shows and the warning stays.
  - `esc` goes back.
- The related Thread of an entry with a Story is the newest Thread of that Story. Other warnings have
  no Thread.
- Close the TUI without a stop to leave the daemon active.

## The Checks view

- When the live factory status has `checks`, the header shows the `Checks` Button after the view
  mode Switch. The note of the Button is `<running>/<queued>`, for example `Checks 2/1`.
- When the factory is not live, or its status has no `checks`, the Button does not show.
- `c` or a click on the Button opens the Checks Modal (`Factory › Checks`). `c` is a global key of
  the shell. When the Button does not show, `c` does nothing.
- The Modal shows the summary line of the `Checks` row at the top. Then it shows one row for each
  check job in the queue, for all Threads. The running jobs come first. Then the queued jobs come,
  in the order of the queue.
- Each row shows the Story ID, the Stage label, the check key, the scope (`full` or `narrow`), the
  status (`running` or `queued`) and the time. The time of a running job starts at `startedAt`. The
  time of a queued job starts at `queuedAt`.
- When the queue has no jobs, the Modal shows `No checks run or wait.`
- The Modal is read-only. It does not show the finished checks. `↑/↓` selects a row, `/` filters,
  and `esc` or the `✕` closes the Modal.

## The Factory view

- `t` or the Switch in the header changes the right Panel to the Factory view and back.
- The view shows the worker Threads of all Stories in "Active Threads" and "Inactive Threads".
- The Stage sidebar filters the Threads by their Stage.
- `enter` or a click on a Thread opens the Thread in the Story sidebar, on the right of the Thread
  list: the Thread metadata and its conversation.
- The view and the Thread in the Story sidebar are read-only, except for the steering input. Use the Threads tab of a Story to interrupt or resume a Thread, or to apply or discard held entries.
- Each row shows the host column and `connection lost (…)` with the rules of the Threads tab.
- A running worker Thread shows a steering input under its conversation. See
  [Steering input](#steering-input).

See [../tui.md](../tui.md#the-factory-view) for the structure.

## The Threads tab of a Story

- The tab shows all Thread statuses, and a queue note when the Story waits for a worker slot.
- Select a Thread to Peek at its conversation.
- `x` interrupts an active Thread, with confirmation.
- `r` resumes an eligible Thread through the active factory.
- When the list has a remote Thread, each row shows the host of its Thread. A remote Thread with a
  lost connection shows `connection lost (…)` in `danger`.
- An abandoned remote Thread shows `abandoned` and the number of its held entries.
- `a` applies the held entries of the selected abandoned Thread. A toast gives the number of applied
  entries and the number of conflicts. An entry with a conflict stays held.
- `d` discards the held entries of the selected abandoned Thread, with confirmation. A toast gives
  the number of discarded entries.
- `a` and `d` do not need a running factory. They do nothing on a Thread that is not abandoned or
  that has no held entries. The key hints show them only for an abandoned Thread with held entries.
  After the action, the tab reads the Threads again.
- A running Thread shows a steering input under its conversation. See [Steering input](#steering-input).

## Steering input

A running worker Thread shows a one-line text input under its conversation, with the placeholder
`Send a message to the agent`. The input shows in the Threads tab of a Story and in the Thread of the
Factory view. A Thread that does not run does not show the input.

- `m` in the Thread region, or a click on the input, gives the focus to the input.
- `enter` sends the message through the running factory. If the factory accepts the message, the
  input becomes empty and an `info` toast shows `Sent message to <story> <thread>`.
- If the factory rejects the message, an error toast shows the reason, and the text stays.
- `esc` gives the focus back to the Thread region. The text stays.
- While the input has the focus, the other keys of the Thread region (`x`, `r`, `tab`, `o` and the
  conversation keys) do not act.
- The agent gets the message after its current tool calls. When the session history has the
  message, the conversation shows it as a user message.

## The Models tab of a Story

The Models tab shows the worker model of the Story in each Stage. Enter sets or removes the Story
override of the selected Stage. See [../tui.md](../tui.md#worker-model-overrides).

## The conversation viewer

- Arrows or `j`/`k`, Page Up, Page Down, Home, End and the mouse wheel move the view.
- Scroll up to stop follow. Use End or `f` to follow again.
- Escape goes back to the previous view.

## The AI section of Settings

Settings has a Factory group with an AI section. The section has four tabs: Providers, Models, Limits
and Checks.
`←` and `→` change the tab.

- The Providers tab shows only the signed-in providers. `d` signs out, with confirmation. `r` reloads.
- `n` opens the page of the other providers. On that page, Enter signs in and Escape goes back to the Providers tab.
- The Models tab shows the worker model in a card. `w` selects the worker model.
- Under the card, the Models tab shows one row for each Stage, with the worker model override of the Stage.
  `↑/↓` select a Stage. Enter or a click opens the model picker of the Stage.
  See [../tui.md](../tui.md#worker-model-overrides).
- The Limits tab shows each limit in its own card. `l` sets the worker limit.
- The Checks tab shows the check limits in a card, and one row for each check. `c` sets the check
  limits. `n` adds a check. `↑/↓` select a check. Enter or a click edits the check. `d` removes the
  check, with confirmation. See [checks.md](checks.md).
- `s`, `w` and `l` also work on the other tabs.
- The picker of the worker model offers the available models and their supported thinking levels. It
  has no option to clear the worker model, because the factory does not start without it. The picker
  of an override has the first option `No override`.
- When the worker model is not set, the card shows `Not set`. The text of the card tells that the
  factory does not start without a worker model.
- Escape cancels authentication and restores the focus.

## Related

- [recovery.md](recovery.md): what stop, cancel, resume and dismiss do.
- [pi-runtime-and-auth.md](pi-runtime-and-auth.md): authentication and model rules.
- [../tui.md](../tui.md): the structure of the TUI.
