---
title: Remote worker hosts
stories:
  - ROW-82
  - ROW-83
  - ROW-84
  - ROW-85
  - ROW-86
  - ROW-87
  - ROW-88
  - ROW-89
  - ROW-90
  - ROW-91
  - ROW-92
  - ROW-93
  - ROW-94
  - ROW-95
  - ROW-96
  - ROW-97
  - ROW-98
  - ROW-99
  - ROW-100
  - ROW-101
  - ROW-102
  - ROW-103
  - ROW-104
  - ROW-105
---

# Remote worker hosts

## Problem

The native factory runs all workers on one machine. Each worker is a Pi session inside the local
daemon (`launchWorker` in `src/services/factory-manager/worker-launch.ts`). Its tools run in a local
worktree. It writes canonical Project changes through the CLI shim under a local `flock`. Thus the
user cannot use the workers of a second machine.

## Goal

The factory can run workers on remote machines over SSH. The user sets a worker limit for each
machine. The factory places each worker on a machine that has a free slot. A remote worker continues
when the connection stops. Its changes come back to the board when the connection returns. The TUI
shows the connection of each machine and of each remote Thread.

## Terms

- **Main machine.** The machine that runs the daemon, the supervisor and the board. The current
  local machine. It has the host id `local`.
- **Worker host.** A remote machine that runs workers only. It never runs a supervisor.
- **Host agent.** The `rowbly host serve` process on a worker host. It runs the remote workers of one
  Project.
- **Copy.** The copy of the canonical `.rowbly/` files that a remote Thread uses.
- **Outbox.** The journal of the canonical changes of the remote workers on a host.
- **Inbound update.** A change on the main machine that goes to the copy of a running remote Thread.

## Decisions

1. A worker host runs workers only. The supervisor stays on the main machine.
2. When the connection stops, the remote workers complete their Story and stop. No new work starts
   on that host until the connection returns.
3. The placement policy is a factory setting: `prefer-local` (default), `most-free` or
   `prefer-remote`.
4. Each worker host has its own worker limit. The limit applies to the full machine, for all
   Projects. The host agent enforces it.
5. Credentials never go over SSH. The user logs in to Pi, `gh` and Git on the worker host.
6. A remote host never reads the board itself. The main machine sends a copy with each launch, and
   inbound updates while the host is connected.
7. Only the main machine creates Stories. Thus two machines cannot give the same Story key.
8. Remote canonical writes go through the outbox. The main machine applies each entry as a
   compare-and-set.
9. Attachments go in both directions in the first version.
10. A remote Thread that the user cancels or releases while its host is offline becomes abandoned.
    Its later changes are held. The user applies or discards them.

## Setup of a worker host

The user must have SSH access with a key and without a password. This is a prerequisite.

1. `rowbly host add <id> --ssh <target> --max-workers <n>` records the host in `~/.rowblyrc.json`.
   It examines SSH (`ssh -o BatchMode=yes`), Linux, `flock`, Git and Node 22.19 or later. It
   installs the exact Rowbly version in a private folder on the host.
2. The user logs in on the host: `rowbly host login <id>` (Pi), `gh auth login`, Git push access and
   the Git identity. SSH agent forwarding is not sufficient, because the work continues after a
   disconnect.
3. `rowbly host use <id>` turns the host on for the current Project. Rowbly clones the repository
   from `origin` into a managed folder on the host. `--path <dir>` uses an existing clean clone of
   the same repository.
4. `rowbly host check <id>` shows a checklist: SSH, version, Pi login and models, Git push, `gh`, the
   clone, and a warning when local `main` is ahead of `origin`.

`rowbly host remove <id>` refuses while a Thread is active. It keeps the clone and the worktrees
unless the user gives `--purge`.

## Version

The host agent must run the same Rowbly version as the main machine. On each connection, the main
machine compares the versions. If they differ, it installs the correct version. An unreleased build
goes to the host as a package that `npm pack` makes. A host with a different version gets no work.

## Transport

- The main machine runs a fixed remote command over SSH. The data goes on stdin, never in the
  arguments, because SSH joins the arguments into a shell string.
- Commands are durable files with receipts on the host, as in `factory-control/`. Each command has
  a request id. A command that arrives two times has one effect.
- A long-lived channel (`rowbly host attach`) streams JSON lines: status, activity, results, session
  lines and outbox entries.
- Each connection starts with a handshake that compares the protocol and Rowbly versions.
- SSH uses `ServerAliveInterval` and connection reuse.
- Tests use a fake in-process transport. Tests never use real SSH.
- The transport and the host status do not load Pi.

## Placement

- `prefer-local` uses the main machine first. It uses a worker host only when the main machine has
  no free slot.
- `most-free` uses the machine with the most free slots. A tie goes to the main machine.
- `prefer-remote` uses a worker host first.
- A host that is disconnected, not ready, or has a different version gets no new work.
- A host must have the provider of the worker model.
- Affinity: when a Story has a worktree on a host, its next Stages go to that host when it has a
  free slot. A Story can go to a different machine only when its branch is pushed and its old
  worktree is clean.
- A Story whose branch has local commits that are not pushed, or a dirty local worktree, stays on
  the main machine.
- `start_worker` can take an optional host. The manager decides when the supervisor gives no host.

## The copy and inbound updates

- Each launch to a host contains a copy of the tracked `.rowbly/` files: Stories, Stages, config
  and prompts. It does not contain `state.json` or `runtime/`.
- The copy contains the PNG files of the Story and of its upstream Stories. The host keeps a cache
  of PNG files by attachment id. Attachment content never changes, so a cache entry never becomes
  old. The main machine sends only the ids that the host does not have.
- When a worker reads a PNG that is not on the host, the host gets it from the main machine. If the
  host is offline, the read fails with a clear error.
- The worker command prefix uses the copy (`-C <copy>`).
- The main machine keeps a base for each remote Thread: the values that it sent last.
- At each scan, the main machine compares the canonical files with each base. Each difference
  becomes an inbound update with `before` and `after` values. Then the base becomes the current
  values.
- The host applies each field change as a compare-and-set against the copy. If the worker changed
  the field, the value of the worker stays in the copy.
- A new Story or attachment goes into the copy. A deleted Story goes out of the copy. Config and
  Stage prompt files are replaced.
- Inbound updates have their own sequence numbers and acknowledgements. They wait in the queue while
  the host is offline. The main machine drops the updates of an abandoned Thread.
- The worker gets no message about an inbound update. This is the same as for a local worker.

## The outbox

### Record

- The host agent puts an outbox setting in the environment of each remote worker. The CLI then
  writes to the copy and adds one entry to the outbox for each write.
- The service layer records the writes, not the commands. The front ends stay thin.
- A field entry has the field changes of one write, each with `before` and `after`:

```json
{ "seq": 7, "opId": "rook-7f3a", "threadId": "…", "storyId": "ROW-5",
  "changes": [
    { "path": "fields.pull_request", "before": null, "after": "https://github.com/…/pull/261" },
    { "path": "stage", "before": "IN_DEVELOPMENT", "after": "CHANGELOG" }
  ] }
```

- Derived values, for example `updatedAt` and `position`, are not in an entry. The services
  calculate them again.
- An `attachment.add` entry has the attachment record and the `sha256` of the PNG. The host writes
  the PNG to `outbox/blobs/<sha256>.png` before it writes the entry.
- An `attachment.remove` entry has the id and the `sha256`.
- Version 1 permits Story field changes, Stage moves and attachments.
  It refuses a new Story, Stage or Spec and each config change. The worker gets a clear error.

### Apply

The main machine applies the entries in `seq` order, under the Project write lock. It does not hold
the state lock. For each field change:

| Value on the main machine | Action                                            |
| ------------------------- | ------------------------------------------------- |
| Equal to `before`         | Write `after`.                                    |
| Equal to `after`          | The change is already there. Skip it.             |
| Other                     | Conflict. Do not write. Set an attention entry.   |

- For `attachment.add`, the main machine gets the PNG with the fixed command
  `rowbly host blob <sha256>`. It examines the hash, the size (10 MiB or less) and the PNG format.
  Then it adds the attachment with the id of the host. An attachment with the same id and hash is
  already there, so the entry is skipped. If the Story was deleted, the entry is a conflict and the
  PNG stays for recovery.
- For `attachment.remove`, an attachment that is there is removed. An attachment that is not there
  is skipped.
- The main machine records the last applied `seq` for each host. Then it sends an acknowledgement.
  The host removes the acknowledged entries and their PNG files.
- The next scan commits the result with the usual canonical commit.

### Order at the end of a Thread

The main machine applies all outbox entries of a remote Thread before it completes the Thread.
While a remote Thread has entries that are not applied, or its final status did not arrive, the
policy skips its Story with the reason `waiting for host sync`.

## Disconnects

- The main machine sends a heartbeat to each host. The host states are `connected`, `degraded`,
  `disconnected`, `version-mismatch` and `auth-failed`.
- A disconnect does not change the status of a remote Thread to failed or interrupted. The Thread
  keeps its last status and shows `connection lost`.
- The host agent continues the running workers. It starts no new work. It stops when it has no work
  and its outbox is empty.
- Stop, cancel and inbound updates wait in a queue for each host. On reconnect, stop and cancel go
  first. Then the main machine reads the run states, the results, the session lines and the outbox.
- The recovery after the death of the local owner does not mark remote runs as interrupted. At
  start, the daemon asks each host for its runs.
- A remote Thread can resume only on its own host, because its session and worktree are there.
- `factory stop` sends a stop to each host. A stop is not an abandon. Outbox entries that the host
  wrote before the stop arrived are applied as usual.

## Abandoned Threads

- When the user cancels or releases a remote Thread while its host is offline, the main machine
  marks the Thread `cancelled` with an `abandoned` note: the time, the reason and the last applied
  `seq`.
- The main machine puts a stop for the Thread in the queue of the host.
- The Story does not wait on `waiting for host sync` for this Thread. The usual cancel and release
  rules apply.
- On reconnect, the stop goes first. Then each outbox entry of the Thread that is not applied
  becomes held. The main machine never applies a held entry automatically.
- The main machine moves the held entries and their PNG files to
  `runtime/hosts/<host>/held/<threadId>/`, then sends the acknowledgement.
- The final result of the worker goes to `remoteOutcome`. The Thread stays `cancelled`.
- There is one attention entry for each Thread, with the key `abandoned:<threadId>`. A dismiss does
  not remove the held entries.
- `rowbly thread held <id>` lists the held entries. `--apply` applies them with the same
  compare-and-set. `--discard` deletes them. The TUI has a key for each action and asks for a
  confirmation before a discard.
- The user can resume an abandoned Thread only after its held entries are applied or discarded, and
  only while its host is connected.

## Status and TUI

- `status.json` and `rowbly factory status --json` have a `hosts` list: the id, the state,
  `lastSeenAt`, the latency and the used and maximum slots.
- A host that stays disconnected gets the attention entry `host:<id>`.
- A remote Thread has its host. When its host is not connected, it shows `connection lost` and the
  time since the last contact.
- The TUI reads `status.json` only. It never opens SSH.
- The Factory view shows the hosts, the `▶` marker shows the host, and the Threads tab has a host
  column.
- Settings has a Hosts section and the placement setting.

## Session mirror

The main machine keeps a mirror of the session file of each remote Thread. It adds the lines from the
live channel and gets the missing lines after a reconnect. Peek and `inspect_worker` read the mirror.
Thus they work while the host is offline, with the last lines that arrived.

## Checks

`run_check` runs in the check queue of the host agent, on the host of the worker. The check queue
uses the process identity of `/proc`, so it must run on the same machine as the check.

## Not in version 1

- A supervisor on a worker host, or a factory that continues while the main machine is off.
- New Stories, Stages, Specs or config changes from a remote worker.
- macOS or Windows worker hosts.
