---
title: Add the worker host registry and host add, list and remove
stage: CHANGELOG
position: 4
dependsOn:
  - ROW-83
createdAt: 2026-11-16T19:45:02.241Z
updatedAt: 2026-11-16T20:27:01.079Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-84
pull_request: https://github.com/sgolovine/rowbly/pull/272
---

## Goal

The user can record worker hosts. A worker host is a remote machine that runs factory workers only. A host has an id, an SSH target, a worker limit and an on/off switch. The hosts belong to the user, not to a Project, so Rowbly keeps them in `~/.rowblyrc.json`.

Read the Spec `remote-worker-hosts` for the full design (sections "Terms", "Decisions" and "Setup of a worker host").

## Scope

In scope:

- A new `host` service in `src/services/host/host.ts` with a test next to it. It reads and writes the `hosts` key of `~/.rowblyrc.json`. Functions: `addHost`, `listHosts` and `removeHost`, each with a `ServiceContext`.
- A shared module for the read and the write of `~/.rowblyrc.json` (for example `src/services/user-rc/user-rc.ts`). Move the read, parse and atomic write code of `src/services/known-project/known-project.ts` into it. `known-project` and `host` both use it. The behaviour of `known-project` does not change.
- A new CLI resource `rowbly host` in `src/commands/host/host.ts`, registered in `src/commands/register-commands/register-commands.ts` with `resource(program, "host", "Manage worker hosts")`:
  - `rowbly host add <id> --ssh <target> --max-workers <n>`
  - `rowbly host list`
  - `rowbly host remove <id> [--purge]`
  - Each command supports `--json` through `run()` of `src/commands/output/output.ts`. The commands do not need a Project.
- Validation in the service (`ValidationError`):
  - The id is dash-case: `^[a-z0-9]+(-[a-z0-9]+)*$`.
  - The id `local` is reserved for the main machine.
  - The SSH target is not empty, does not start with `-`, and has no whitespace or control characters.
  - `--max-workers` is an integer of 1 or more.
- `host add` with an id that exists gives `CONFLICT`. `host remove` with an unknown id gives `NOT_FOUND`.
- `host remove` refuses with `CONFLICT` while a Thread on that host is active (status `pending` or `running`). The check reads the Threads of each known Project in the `projects` list of `~/.rowblyrc.json` that is not missing, with `listThreads`, and compares the `host` field of each Thread (added by ROW-83).
- `--purge` is accepted and is given back in the result (`purge: true|false`). It does no work now, because no clone or worktree exists on a host yet.
- Documentation: the `host` commands in `docs/architecture/cli.md`, the `hosts` key in `docs/architecture/storage.md`, and the `host` commands in `skills/rowbly-reference.md` (then copy it to each `skills/<name>/references/rowbly-reference.md`). Write in STE.

Not in scope:

- SSH checks, the install of Rowbly on the host, the clone, `host use`, `host check` and `host login`. ROW-86, ROW-87 and ROW-88 add them.
- The clean-up work of `--purge`. A later Story adds it when clones and worktrees exist on a host.
- A command to change a host (worker limit or on/off switch). ROW-103 adds the change in the TUI Settings.
- TUI changes.

## Acceptance criteria

- [ ] `rowbly host add mini --ssh user@mini.lan --max-workers 2 --json` writes `{ "id": "mini", "ssh": "user@mini.lan", "maxWorkers": 2, "enabled": true }` into the `hosts` array of `~/.rowblyrc.json` and prints the host as JSON. A service test examines this.
- [ ] `rowbly host list --json` prints the array of hosts in the order of the file. With no `hosts` key it prints `[]`.
- [ ] `rowbly host remove mini --json` removes the host from the file and prints the removed host with `purge`.
- [ ] `host add` gives `VALIDATION` for an id that is not dash-case, for the id `local`, for an empty SSH target, for an SSH target that starts with `-` or has whitespace, and for a worker limit below 1 or not an integer. A test covers each case.
- [ ] `host add` gives `CONFLICT` for an id that exists. `host remove` gives `NOT_FOUND` for an unknown id.
- [ ] `host remove` gives `CONFLICT` while a known Project has a `pending` or `running` Thread with that `host`. A test uses `useTestProject` and a Thread record with the host.
- [ ] Safety rule: when `~/.rowblyrc.json` has invalid JSON, is not an object, or has an invalid `hosts` value, each host command fails with `VALIDATION` and the file bytes do not change. A test examines the bytes.
- [ ] A write keeps all other keys of `~/.rowblyrc.json` (for example `projects` and `deviceId`). A test examines this.
- [ ] The existing `known-project` tests pass with no change of behaviour.
- [ ] No code in this Story gives the SSH target to a shell or to a child process. A person examines this in the review.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `~/.rowblyrc.json` today: `known-project.ts` has `readRc` (gives `{}` for a missing file, throws `ValidationError` "<file> is invalid" with the hint "Fix the file by hand." for bad JSON or a non-object) and `writeRc` (writes through a symlink with `realpath`, then `writeFileAtomic`). `getDeviceId` writes with mode `0o600`. Keep these behaviours in the shared module, and use `ctx.home ?? homedir()` for the path.
- Record shape in the file: `"hosts": [{ "id": string, "ssh": string, "maxWorkers": number, "enabled": boolean }]`. A missing `hosts` key is an empty list. An entry that does not have this shape makes the whole `hosts` value invalid.
- The SSH target goes later to `ssh` as one argument of `spawn`/`execFile`, never in a shell string (Spec, "Transport"). The validation (no leading `-`, no whitespace) prevents option injection and argument splitting for these later Stories.
- Errors: `src/services/errors/errors.ts` (`ValidationError`, `NotFoundError`, `ConflictError`). See `docs/architecture/service-layer.md`.
- Thread lookup: `listThreads` in `src/services/thread/thread-list.ts` with `ctx.cwd` set to the Project path. Do not load Pi (keep the lazy boundary of `src/services/pi-runtime/`).
- The service must not import `commander`, `ink` or `react`. The command stays thin. Read the `rowbly-code-style` skill.
- The `register-commands` test and `tui-boundary.test.ts` can need an update for the new resource.

## Assumptions

- The Story depends on ROW-83, because ROW-83 adds the `host` field to `ThreadRecord` that the `host remove` check reads. Reason: the smallest scope that does not add a second definition of the field.
- A new host is on (`enabled: true`). This Story adds no command to turn it off. Reason: the Story names the switch, but no command for it. ROW-103 adds changes in Settings.
- `host remove` checks the active Threads of all known Projects in `~/.rowblyrc.json`, not only the current Project. Reason: a host belongs to the user and serves all Projects (Spec, decision 4). A known Project that is missing is skipped.
- `--purge` does no clean-up now and only appears in the result. Reason: no clone or worktree exists on a host before ROW-88.
- The SSH target must not start with `-` and must not have whitespace or control characters. Reason: the acceptance criterion "never given to a shell without quotes", and safe use as one `ssh` argument later.
- A shared rc module replaces the private rc code in `known-project.ts`. Reason: two services write the same file, and the safety rule must apply in one place.
