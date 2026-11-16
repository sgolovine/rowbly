---
title: Add host use to clone the Project on a worker host
stage: IN_REFINEMENT
position: 7
dependsOn:
  - ROW-84
  - ROW-85
  - ROW-86
createdAt: 2026-11-16T19:45:04.969Z
updatedAt: 2026-11-16T20:06:51.950Z
worktree: null
pull_request: null
---

## Goal

The user turns a worker host on for one Project. The host gets a clone of the repository.

Read the Spec `remote-worker-hosts`, section "Setup of a worker host".

## Scope

In scope:

- `rowbly host use <id>` in a Project, and `rowbly host unuse <id>`.
- By default, Rowbly clones the repository from the `origin` URL into a managed folder on the host, for example `~/.local/share/rowbly/projects/<project-id>/repo`.
- `--path <dir>` uses an existing clone. Rowbly examines that it is the same repository and that it is clean.
- The worktrees of the remote workers go next to the clone, in the same layout as on the main machine.
- The record of the Projects of each host is in `~/.rowblyrc.json`.

Not in scope:

- The `git fetch` before a launch. The host agent does it.

## Acceptance criteria

- A clone that fails because the host has no Git access gives a clear error with the hint to fix the access on the host.
- `host check` reports the clone of the current Project.
- Tests use the fake transport.
