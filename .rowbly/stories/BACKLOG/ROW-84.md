---
title: Add the worker host registry and host add, list and remove
stage: BACKLOG
createdAt: 2026-11-16T19:45:02.241Z
updatedAt: 2026-11-16T19:45:02.241Z
worktree: null
pull_request: null
---

## Goal

The user can record worker hosts. A host has an id, an SSH target, a worker limit and an on/off switch.

Read the Spec `remote-worker-hosts` for the full design.

## Scope

In scope:

- A `host` service that reads and writes the hosts in `~/.rowblyrc.json`. The hosts belong to the user, not to a Project.
- `rowbly host add <id> --ssh <target> --max-workers <n>`, `rowbly host list` and `rowbly host remove <id>`, with `--json`.
- Validation: a dash-case id, `local` is reserved, a non-empty SSH target, a worker limit of 1 or more.
- `host remove` refuses while a Thread on that host is active. `--purge` is recorded for the later clean-up of the clone and the worktrees.

Not in scope:

- SSH checks, install of Rowbly on the host, or a clone. Later Stories add them to `host add`.

## Acceptance criteria

- Obey the safety rule: Rowbly does not write `~/.rowblyrc.json` if it cannot read it, and a write keeps all other keys.
- The SSH target is never given to a shell without quotes.
- Tests cover add, list, remove, the validation and an unreadable `~/.rowblyrc.json`.
