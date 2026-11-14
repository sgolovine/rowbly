# Native commands and TUI controls

Users control the native factory through CLI commands and TUI keys. Both front ends call the same
services: `agent-auth/`, `factory-settings/`, `factory/`, `thread/` and `conversation/`. This page
lists the commands and the keys.

Read this when you add or change a native command, a factory key, the Threads tab, the conversation
viewer or the AI section of Settings.

## CLI commands

| Commands                                                                  | Purpose                                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `auth providers`, `auth status`                                           | Show login methods and configured status, without a health check.            |
| `auth login [provider] [--type oauth\|api_key]`, `auth logout <provider>` | Sign in through an interactive prompt, or remove a stored credential.        |
| `model list [--provider <id>]`                                            | Show configured models and supported thinking levels.                        |
| `factory configure`                                                       | Set `--max-workers`, `--supervisor`, `--worker` and the role thinking flags. |
| `factory start [--foreground] [--max-workers <n>] [--adopt-external]`     | Start a detached daemon, or use the foreground path.                         |
| `factory status`, `factory stop`, `factory restart [--adopt-external]`    | Observe or control the native daemon.                                        |
| `factory logs [--tail <n>]`                                               | Read bounded operational logs. There is no follow mode.                      |
| `thread list [--story <id>]`, `thread show <id>`                          | Read active and historical metadata.                                         |
| `thread log <id> [--tail <n>]`                                            | Read a bounded conversation tail: default 20, maximum 100 entries.           |
| `thread cancel <id>`, `thread resume <id>`                                | Send guarded commands to the native daemon.                                  |

`factory run` is a hidden command. `factory start` uses it to start the detached daemon.

## Factory controls in the TUI

- `f` opens Factory controls. It is a global key of the shell.
- The header shows the active and pending counts when space permits.
- In Factory controls:
  - `s` starts the factory.
  - `x` requests a stop, with confirmation.
  - `enter` opens the supervisor conversation.
  - `w` opens the list of all warnings (`Factory › Attention`). The key works only when the live
    factory has warnings.
  - A click on a row of the `Attention` list opens the detail view of that warning.
  - `h` opens the history.
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
- The related Thread of the `supervisor` entry is the supervisor Thread of the status file. The
  related Thread of an entry with a Story is the newest Thread of that Story. Other warnings have no
  Thread.
- Close the TUI without a stop to leave the daemon active.

## The Factory view

- `t` or the Switch in the header changes the right Panel to the Factory view and back.
- The view shows the worker Threads of all Stories in "Active Threads" and "Inactive Threads".
- The Stage sidebar filters the Threads by their Stage.
- `enter` or a click on a Thread opens the Thread in the Story sidebar, on the right of the Thread
  list: the Thread metadata and its conversation.
- The view and the Thread in the Story sidebar are read-only. Use the Threads tab of a Story to interrupt or resume a Thread.

See [../tui.md](../tui.md#the-factory-view) for the structure.

## The Threads tab of a Story

- The tab shows all Thread statuses, and a queue note when the Story waits for a worker slot.
- Select a Thread to Peek at its conversation.
- `x` interrupts an active Thread, with confirmation.
- `r` resumes an eligible Thread through the active factory.

## The conversation viewer

- Arrows or `j`/`k`, Page Up, Page Down, Home, End and the mouse wheel move the view.
- Scroll up to stop follow. Use End or `f` to follow again.
- Escape goes back to the previous view.

## The AI section of Settings

Settings has a Factory group with an AI section for providers, role models and the worker limit.

- Enter signs in to the selected provider.
- `d` signs out, with confirmation.
- `s` and `w` select the supervisor and worker models.
- `l` sets the worker limit.
- `r` reloads.
- The model picker offers the supported thinking levels and `Pi default`.
- Escape cancels authentication and restores the focus.

## Related

- [recovery.md](recovery.md): what stop, cancel, resume and dismiss do.
- [pi-runtime-and-auth.md](pi-runtime-and-auth.md): authentication and model rules.
- [../tui.md](../tui.md): the structure of the TUI.
