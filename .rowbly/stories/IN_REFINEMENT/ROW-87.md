---
title: Add host check and host login
stage: IN_REFINEMENT
position: 6
dependsOn:
  - ROW-84
  - ROW-85
  - ROW-86
createdAt: 2026-11-16T19:45:03.991Z
updatedAt: 2026-11-16T21:28:35.964Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-87
pull_request: null
---

## Goal

The user can see if a worker host is ready, and can log in to Pi on it.

Read the Spec `remote-worker-hosts`, section "Setup of a worker host".

## Scope

In scope:

- `rowbly host check <id>` with `--json`. It shows one line for each item: SSH without a password, Linux, `flock`, Git, Node, the Rowbly version, Pi login and the configured models, Git push access, `gh` login, the Git identity and the clone of the current Project.
- A warning when the local `main` branch is ahead of `origin`, because remote worktrees start from `origin`.
- `rowbly host login <id>` runs `ssh -t <target> <rowbly> auth login`. It must run in a terminal.
- `host add` runs the checks at the end and shows the items that the user must do.
- The main machine uses a short form of the check before it sends work to a host. A failed check makes the host not ready.

Not in scope:

- A fix for a failed item. Credentials never go over SSH.

## Acceptance criteria

- The check does not load Pi on the main machine.
- Tests use the fake transport.
