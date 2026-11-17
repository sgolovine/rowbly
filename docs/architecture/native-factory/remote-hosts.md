# Remote worker hosts

The native factory can run workers on worker hosts over SSH. The supervisor, the board and the
canonical `.rowbly/` files stay on the main machine. A remote worker writes to a copy of the Project
files, and the main machine applies its changes from an outbox. This page is an overview. The
details are on the pages in "Where to find the details".

Read this page first when you start a task on worker hosts. Then read only the page or the section
for your task.

## Terms

These terms come from the Spec `remote-worker-hosts`.

- **Main machine.** The machine that runs the daemon, the supervisor and the board. It has the host
  id `local`.
- **Worker host.** A remote machine that runs workers only. It never runs a supervisor.
- **Host agent.** The `rowbly host serve` process on a worker host. It runs the remote workers of one
  Project.
- **Copy.** The copy of the canonical `.rowbly/` files that a remote Thread uses.
- **Outbox.** The journal of the canonical changes of the remote workers on a host.
- **Inbound update.** A change on the main machine that goes to the copy of a running remote Thread.

## Flow of one remote worker

1. **Placement.** The manager selects a machine for the new worker with `placeWorker`. The
   `placement` factory setting gives the order of the machines. A host must be `connected`, must have
   a free slot and must have the provider of the worker model.
2. **Prepare.** The remote executor builds the copy and uploads the missing attachment files. Then
   it sends the copy and the worker message with `host prepare`. It keeps the copy that it sent as the
   base of the Thread.
3. **Launch.** The executor starts the host agent with `host serve --detach` and submits a `launch`
   command. The host agent runs the Pi session of the worker on the host, in a worktree of the host
   clone.
4. **Outbox and apply.** The CLI of the worker writes to the copy. It also adds one outbox entry for
   each Story write and each attachment write. The main machine applies the entries in `seq` order as
   a compare-and-set, then sends an acknowledgement.
5. **Inbound updates.** At each sync, the main machine compares the canonical files with the base of
   each running remote Thread. It sends each difference to the copy as an inbound update.
6. **Session mirror.** The main machine keeps a copy of the session file of each remote Thread. Peek,
   `rowbly thread log` and `inspect_worker` read this mirror.
7. **End of the Thread.** The main machine applies all outbox entries of the Thread before it
   completes the Thread. Until then, the policy skips the Story with the reason
   `waiting for host sync`.
8. **Disconnect and reconnect.** A disconnect does not make a remote Thread `failed` or
   `interrupted`. The Thread shows `connection lost`. On reconnect, stop and cancel commands go first.
   Then the main machine reads the run states, the session lines and the outbox.
9. **Abandoned Threads and held entries.** A cancel while the host is offline makes the Thread
   abandoned. The later outbox entries of that Thread become held. The user applies or discards them
   with `rowbly thread held <id> --apply` or `--discard`.

## Limits of version 1

- The supervisor runs only on the main machine. The factory does not continue while the main
  machine is off.
- A worker host must be a Linux machine. macOS and Windows worker hosts are not supported.
- A remote worker can only change the fields of a Story, move a Story to a different Stage, and add
  or remove an attachment.
- Each other write of a remote worker gives `CONFLICT` with the text "A remote worker cannot …".
  For example, a remote worker cannot create or delete a Story, change a Stage, a Spec, a tag, a
  custom field, a user prompt or the factory settings.
- A remote Thread resumes only on its own host, because its session and its worktree are there.
- A remote worker cannot get a steering message.
- The daemon ownership has no guarantee across machines. Worker hosts are supported only through the
  host agent. See [README.md](README.md#prerequisites-and-limits).

## Where to find the details

| Part                        | Page and section                                                                                                                                   | Module in `src/services/`                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Host registry and commands  | [cli.md](../cli.md#worker-hosts), [storage.md](../storage.md#rowblyrcjson)                                                                         | `host/`, `host-project/`, `user-rc/`                                       |
| SSH transport and handshake | [host-transport.md](host-transport.md)                                                                                                             | `host-transport/`                                                          |
| Install of Rowbly on a host | [host-install.md](host-install.md)                                                                                                                 | `host-install/`                                                            |
| Host check and login        | [host-check.md](host-check.md)                                                                                                                     | `host-check/`                                                              |
| Hosts of the daemon         | [README.md](README.md#worker-hosts-of-the-registry)                                                                                                | `worker-hosts/`                                                            |
| Placement                   | [README.md](README.md#placement), [pi-runtime-and-auth.md](pi-runtime-and-auth.md#placement)                                                       | `factory-manager/placement.ts`, `factory-manager/host-slots.ts`            |
| Placement flag              | [controls.md](controls.md#the-placement-flag-of-factory-configure)                                                                                 | `factory-settings/`                                                        |
| Dispatch and the copy       | [README.md](README.md#dispatch-to-a-worker-host)                                                                                                   | `factory-manager/remote-dispatch.ts`, `remote-executor/`, `thread-copy/`   |
| Host agent                  | [host-agent.md](host-agent.md)                                                                                                                     | `host-agent/`                                                              |
| Checks on a host            | [host-agent.md](host-agent.md#checks)                                                                                                              | `host-agent/host-checks.ts`                                                |
| Outbox record               | [storage.md](../storage.md#outbox-of-a-remote-worker)                                                                                              | `outbox/`                                                                  |
| Outbox apply                | [storage.md](../storage.md#apply-on-the-main-machine)                                                                                              | `outbox-apply/`                                                            |
| Inbound updates             | [README.md](README.md#inbound-updates), [host-agent.md](host-agent.md#inbound-updates)                                                             | `inbound/`, `remote-executor/remote-inbound.ts`                            |
| Session mirror              | [README.md](README.md#session-mirror)                                                                                                              | `remote-executor/session-mirror.ts`                                        |
| Heartbeat and disconnects   | [README.md](README.md#disconnects-and-reconnects)                                                                                                  | `factory-manager/host-heartbeat.ts`, `remote-executor/remote-heartbeat.ts` |
| Adopt at the start          | [recovery.md](recovery.md#adopt-remote-threads-at-start)                                                                                           | `factory-manager/worker-adopt.ts`                                          |
| Abandoned Threads           | [README.md](README.md#abandoned-threads), [storage.md](../storage.md#held-entries-of-an-abandoned-thread)                                          | `factory-manager/abandoned-threads.ts`, `outbox-apply/held-entries.ts`     |
| Held entries command        | [cli.md](../cli.md#held-entries)                                                                                                                   | `outbox-apply/held-actions.ts`                                             |
| Connection lost             | [cli.md](../cli.md#connection-lost)                                                                                                                | `thread-connection/`                                                       |
| Runtime files and locks     | [runtime-and-locks.md](runtime-and-locks.md#factory-files-in-rowbly)                                                                               | `runtime-files/`, `outbox-apply/host-files.ts`                             |
| TUI                         | [tui.md](../tui.md#the-factory-controls), [tui.md](../tui.md#the-hosts-section-of-settings), [controls.md](controls.md#the-threads-tab-of-a-story) | `src/tui/` (not a service)                                                 |

The end-to-end tests of the remote factory are in `factory-manager/remote-factory-e2e.test.ts`,
`factory-manager/remote-full-run.test.ts` and `factory-manager/remote-reconnect.test.ts`. They use a
fake in-process transport and a faux Pi provider. They do not use real SSH.

## Related

- [README.md](README.md): the native factory.
- [runtime-and-locks.md](runtime-and-locks.md): the files in `runtime/hosts/<host>/` and the locks.
- [recovery.md](recovery.md): the recovery rules of remote Threads.
- [../../../README.md](../../../README.md#remote-worker-hosts): the user guide of worker hosts.
