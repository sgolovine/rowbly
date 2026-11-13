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
  - `h` opens the history.
  - `a` opens Settings at the AI section.
- Close the TUI without a stop to leave the daemon active.

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

- [recovery.md](recovery.md): what stop, cancel and resume do.
- [pi-runtime-and-auth.md](pi-runtime-and-auth.md): authentication and model rules.
- [../tui.md](../tui.md): the structure of the TUI.
