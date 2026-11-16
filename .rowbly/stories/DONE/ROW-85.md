---
title: Add the SSH transport for worker hosts
stage: DONE
position: 3
createdAt: 2026-11-16T19:45:02.850Z
updatedAt: 2026-11-16T20:22:19.058Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-85
pull_request: https://github.com/sgolovine/rowbly/pull/270
---

## Goal

Make the SSH transport that the main machine uses to talk to a worker host. Later Stories (ROW-86, ROW-87, ROW-88, ROW-89, ROW-94) use it to install Rowbly, run checks, start the host agent and read the live channel.

Read the Spec `remote-worker-hosts`, section "Transport".

## Scope

In scope:

- A `HostTransport` interface and an SSH implementation. The SSH implementation runs a fixed remote Rowbly command with `-o BatchMode=yes`, `ServerAliveInterval` and connection reuse (ControlMaster).
- The data goes on stdin as JSON. It never goes in the SSH arguments, because SSH joins the arguments into a shell string.
- Three kinds of call:
  - a request call: send one JSON value on stdin, get one JSON value from stdout;
  - a raw bytes call: get stdout as bytes (for PNG files), with a size limit;
  - a channel: a long-lived connection with framed JSON lines in both directions.
- A handshake that compares the protocol version and the Rowbly version.
- A fake in-process transport for tests, with a way to cut and restore the connection.
- Clear errors: host unreachable, authentication failed, version mismatch, timeout, and a protocol error for a bad frame.

Not in scope:

- The host agent (`rowbly host serve`, `rowbly host attach`) and the commands that it accepts. ROW-89 adds them.
- The host registry and `~/.rowblyrc.json` (ROW-84). The transport gets the SSH target as an argument.
- The install of Rowbly on the host (ROW-86), heartbeats and the host states in `status.json`.
- A CLI command. This Story adds services only.

## Acceptance criteria

- [ ] No test uses real SSH. The SSH implementation tests use a stub `ssh` executable (a small Node script) that records its arguments and stdin, and the fake transport.
- [ ] The transport does not load Pi. The `import-boundary` test (`src/services/pi-runtime/import-boundary.test.ts`) imports the transport modules while Pi is mocked to throw.
- [ ] A test proves that Story text with quotes, `$`, `;`, a backtick and a newline goes on stdin and does not change the remote command: the SSH arguments are equal for two different payloads.
- [ ] A remote command token that has a character outside `[A-Za-z0-9._/=:-]`, or an SSH target that starts with `-` or has whitespace or a control character, gives a `ValidationError` before SSH starts.
- [ ] The SSH arguments contain `-o BatchMode=yes`, `-o ServerAliveInterval=<n>`, `-o ControlMaster=auto`, `-o ControlPath=<path>` and `-o ControlPersist=<n>`, then `--`, the target and the command tokens. A test examines the arguments.
- [ ] The handshake accepts equal versions. It gives a version mismatch error with the local and remote protocol and Rowbly versions in `details` when one is different. A test covers each case.
- [ ] Each error has its own `RowblyError` subclass and `code`: `HOST_UNREACHABLE`, `HOST_AUTH_FAILED`, `HOST_VERSION_MISMATCH`, `HOST_TIMEOUT`, `HOST_PROTOCOL`. Tests cover the classification of SSH exit code 255 with the stderr text of an auth failure and of an unreachable host, a timeout, and a bad JSON line.
- [ ] The channel splits frames that arrive in parts or several in one chunk, and refuses a line that is longer than the limit. A test covers each case.
- [ ] The raw bytes call returns the exact bytes, and it fails when the output is larger than the limit.
- [ ] The fake transport: `disconnect()` makes new calls fail with the unreachable error and closes the open channels; `reconnect()` makes calls work again. A test covers both.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- New service folder `src/services/host-transport/`, for example:
  - `host-transport.ts`: the `HostTransport` interface, the request, bytes and channel types, the protocol version constant (`HOST_PROTOCOL_VERSION = 1`) and the handshake function.
  - `host-errors.ts`: the error classes, which extend `RowblyError` from `src/services/errors/errors.ts`.
  - `json-lines.ts`: the frame encoder and decoder.
  - `ssh-transport.ts`: the SSH implementation with `node:child_process` `spawn`. Never use `shell: true`. Give the SSH executable as an option (default `ssh`) so that tests can use a stub.
  - A test file next to each source file.
- The remote command is a list of fixed tokens, for example `[<remote rowbly executable>, "host", "attach"]`. The caller gives the remote executable path (ROW-86 decides the install folder). Validate each token, then pass the tokens as separate arguments after the target.
- Pass `--` before the target so that a target cannot become an SSH option.
- Classify an SSH failure from exit code 255 and stderr: "Permission denied" or "Host key verification failed" is auth failed; "Could not resolve hostname", "Connection refused", "No route to host", "Connection timed out" and "Connection closed" are unreachable. Other exit codes are the result of the remote command, not a transport failure.
- The timeout kills the child process and gives `HOST_TIMEOUT`. A channel has no total timeout; it closes when the child exits.
- The handshake frame: the remote side sends `{ "type": "hello", "protocol": <n>, "rowbly": "<version>" }` as the first line of a channel. The Rowbly version of the main machine comes from `package.json` (as `src/cli-main.ts` does).
- The ControlPath folder is private (mode 0700). Use `%C` in the path to keep it short, because a Unix socket path has a limit of about 108 bytes.
- The service does not print, prompt or exit, and does not import `commander`, `ink`, `react` or Pi.
- Put the fake transport in `src/services/test-project/` (for example `fake-host-transport.ts`). Knip excludes this folder from the production check, so a test-only export does not fail `pnpm knip`.
- Add a short STE page `docs/architecture/native-factory/host-transport.md` and a link to it from `docs/architecture/native-factory/README.md`.

## Assumptions

- The transport gets the SSH target and the remote executable path as arguments, and does not read the host registry. Reason: this Story does not depend on ROW-84, and ROW-86 decides the install folder.
- The protocol version starts at 1 and the handshake frame shape is set in this Story. ROW-89 sends it. Reason: the host agent is not in scope, but the transport must define the contract.
- The ControlPath folder is `<os.tmpdir()>/rowbly-ssh-<uid>/` with `ControlPersist=60` and `ServerAliveInterval=15`, `ServerAliveCountMax=3`. Reason: a short path under the socket limit, and the Spec gives no values.
- The default line limit of a channel is 1 MiB and the default bytes limit is 10 MiB. Reason: the Spec limits PNG files to 10 MiB.
- The fake transport is in `src/services/test-project/`. Reason: Knip excludes that folder from the production check, and other test helpers are there.
- An error of the remote command (an exit code other than 255) is not a transport error. The transport gives the exit code and stderr to the caller. Reason: the commands of the host agent define their own errors in later Stories.
