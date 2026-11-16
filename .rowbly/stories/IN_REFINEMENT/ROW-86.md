---
title: Install the exact Rowbly version on a worker host
stage: IN_REFINEMENT
position: 5
dependsOn:
  - ROW-84
  - ROW-85
createdAt: 2026-11-16T19:45:03.438Z
updatedAt: 2026-11-16T20:06:50.895Z
worktree: null
pull_request: null
---

## Goal

Each worker host runs the exact Rowbly version of the main machine. Rowbly installs it.

Read the Spec `remote-worker-hosts`, section "Version".

## Scope

In scope:

- Install the exact version in a private folder on the host for each version, separate from a global install. For example `npm install --prefix <dir> rowbly@<version>`.
- An unreleased build (`pnpm dev` or a local `dist/`) goes to the host as a package that `npm pack` makes.
- `host add` installs the version. Each connection compares the versions and installs the correct version if necessary.
- Examine Node 22.19 or later on the host first. Give a clear error if Node is missing or old.

Not in scope:

- The removal of old versions from the host.

## Acceptance criteria

- A host with a different version gets no work, and the host state is `version-mismatch`.
- Tests use the fake transport and a fake install step.
