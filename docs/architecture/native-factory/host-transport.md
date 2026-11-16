# Host transport

The host transport connects the main machine to a worker host over SSH. The code is in
`src/services/host-transport/`. Later Stories use it to install Rowbly, run checks, start the host
agent and read the live channel. [host-install.md](host-install.md) installs Rowbly on the host. See the Spec `remote-worker-hosts`, section "Transport".

The transport does not read the host registry. The caller gives the SSH target and the path of the
remote Rowbly executable. The transport does not load Pi.

## Modules

| File                | Contents                                                                               |
| ------------------- | -------------------------------------------------------------------------------------- |
| `host-transport.ts` | The `HostTransport` interface, the call types, `HOST_PROTOCOL_VERSION` and the limits. |
| `host-handshake.ts` | `checkHello` and `openHostChannel`, which compare the versions.                        |
| `host-errors.ts`    | The error classes and the classification of an SSH exit.                               |
| `json-lines.ts`     | The frame encoder and decoder.                                                         |
| `ssh-transport.ts`  | The SSH arguments, the validation and `createSshTransport`.                            |
| `ssh-process.ts`    | One SSH process for a request call, a bytes call or an upload call.                    |
| `ssh-channel.ts`    | One SSH process for a channel.                                                         |

The fake transport for tests is in `src/services/test-project/fake-host-transport.ts`.

## Calls

Each call runs a fixed remote command, for example `[<remote rowbly>, "host", "attach"]`.

- **Request call.** The transport sends one JSON value on stdin. It reads one JSON value from stdout.
- **Bytes call.** The transport sends one JSON value on stdin. It gives the exact bytes of stdout, for
  example an attachment file. Stdout must not be larger than the limit (default 10 MiB).
- **Upload call.** The transport sends the exact bytes of a buffer on stdin, for example a package
  file. It gives the exit code and the stderr. [host-install.md](host-install.md) uses it with `dd`.
- **Channel.** A long-lived connection. Each frame is one JSON value on one line, in the two directions.
  A line must not be longer than the limit (default 1 MiB). A channel has no total time limit. It
  closes when the SSH process stops.

A request call, a bytes call and an upload call have a time limit (default 30 seconds). At the limit, the transport
stops the SSH process and gives `HOST_TIMEOUT`.

An exit code other than 255 is the result of the remote command. The transport gives the exit code
and the stderr text to the caller. It is not a transport error.

## Safety of the command

SSH joins its arguments into one shell string on the host. Thus:

- The data of a call goes on stdin. It never goes in the SSH arguments.
- Each token of the remote command can have only the characters `A-Z`, `a-z`, `0-9` and `. _ / = : @ -`.
  A different character gives `ValidationError` before SSH starts. `@` has no special meaning in
  `sh`, `bash`, `zsh` or `fish`. npm needs it in a package spec, for example `rowbly@0.18.0`.
- The SSH target must not start with `-`, and it must not have whitespace or a control character.
- The arguments have `--` before the target, so that the target cannot be an SSH option.
- The transport uses `spawn` without a shell.

## Clone of a Project

`rowbly host use` makes a clone of the repository of a Project on the host. The code is in
`src/services/host-project/`. It uses the transport and does not open SSH itself. See the Spec
`remote-worker-hosts`, section "Setup of a worker host", step 3.

- **Managed folder.** Rowbly clones into `.local/share/rowbly/projects/<project-id>/repo`, relative
  to the home folder of the SSH user. `<project-id>` is `<name>-<hash>`. `<name>` is the base name of
  the local Project root in dash-case. `<hash>` is the first 12 hex characters of the SHA-256 of the
  local root path. Thus two Projects with the same name do not share a folder.
- **Existing clone.** With `--path`, Rowbly uses a clean clone of the same repository at that path.
- **Worktrees.** The worktrees of the remote workers go next to the clone, in the layout of the main
  machine: `<clone>-worktrees/<story-id>`. `remoteWorktreesDir` gives this folder.
- **Commands.** Each step is a bytes call with fixed tokens: `test -e`, `git -C <path> rev-parse`,
  `git -C <path> remote get-url origin`, `git -C <path> status --porcelain` and
  `env GIT_TERMINAL_PROMPT=0 git clone -- <url> <path>`. The clone has a time limit of 30 minutes.
- **Clone status.** `cloneStatus` gives `ok`, `missing`, `not-a-repository` or `different-repository`
  for the clone of a Project. `host check` can use it for its clone item.

## SSH options

The transport gives these options to SSH:

- `BatchMode=yes`: SSH does not ask for a password.
- `ServerAliveInterval=15` and `ServerAliveCountMax=3`: SSH finds a dead connection.
- `ControlMaster=auto`, `ControlPath=<folder>/%C` and `ControlPersist=60`: the calls share one connection.

The ControlPath folder is `<tmpdir>/rowbly-ssh-<uid>/`, with mode 0700. The `%C` token keeps the path
short, because the path of a Unix socket has a limit of about 108 bytes.

## Handshake

The host sends a hello frame as the first line of a channel:

```json
{ "type": "hello", "protocol": 2, "rowbly": "0.4.0" }
```

`openHostChannel` compares the frame with `HOST_PROTOCOL_VERSION` and the version in `package.json`.
If the versions are equal, it gives the channel. If one version is different, it closes the channel and
gives `HOST_VERSION_MISMATCH`. The `details` of the error have `localProtocol`, `remoteProtocol`,
`localRowbly` and `remoteRowbly`. If no hello comes in 15 seconds, it gives `HOST_TIMEOUT`.

## Errors

Each error extends `RowblyError`.

| Code                      | Cause                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST_UNREACHABLE`        | SSH exit 255 with "Could not resolve hostname", "Connection refused", "No route to host", "Connection timed out", "Connection closed" or a different text. Also when the SSH executable cannot start. |
| `HOST_AUTH_FAILED`        | SSH exit 255 with "Permission denied" or "Host key verification failed".                                                                                                                              |
| `HOST_VERSION_MISMATCH`   | The hello frame has a different protocol version or Rowbly version.                                                                                                                                   |
| `HOST_TIMEOUT`            | A call or the hello frame did not complete in its time limit.                                                                                                                                         |
| `HOST_PROTOCOL`           | A line is not JSON, a line or an output is larger than its limit, or the first frame is not a hello.                                                                                                  |
| `HOST_NO_FREE_SLOT`       | The host agent has no free machine slot for a `launch`. See [host-agent.md](host-agent.md#machine-limit).                                                                                             |
| `HOST_WORKER_UNAVAILABLE` | The host agent has no worker runner for a `launch`. See [host-agent.md](host-agent.md#worker-runner).                                                                                                 |

## Tests

No test uses real SSH.

- The SSH tests use a stub `ssh` executable. It is a small Node script that records its arguments and stdin.
- Other tests use `createFakeHostTransport`. It records each upload with its exact bytes in `uploads`. `disconnect()` closes the open channels with
  `HOST_UNREACHABLE`, and new calls fail with the same error. `reconnect()` makes the calls work again.
