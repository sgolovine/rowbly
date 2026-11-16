---
title: Add host check and host login
stage: CHANGELOG
position: 6
dependsOn:
  - ROW-84
  - ROW-85
  - ROW-86
createdAt: 2026-11-16T19:45:03.991Z
updatedAt: 2026-11-16T21:43:12.567Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-87
pull_request: https://github.com/sgolovine/rowbly/pull/281
---

## Goal

The user can see if a worker host is ready, and can log in to Pi on it.

Read the Spec `remote-worker-hosts`, section "Setup of a worker host" (step 2 and step 4) and decision 5.

## Scope

In scope:

- A new service `src/services/host-check/` with a test next to each source file. It uses the `HostTransport` of ROW-85 and does not open SSH itself.
- `rowbly host check <id>` with `--json`. It shows one item for each check, in this order:
  1. `ssh`: SSH without a password (the first remote call passes).
  2. `linux`: `uname -s` gives `Linux`.
  3. `flock`: `flock --version` passes.
  4. `git`: `git --version` passes.
  5. `node`: Node 22.19 or later (`checkHostNode` of ROW-86).
  6. `rowbly`: the remote executable of the local build prints the local version.
  7. `pi-login`: Pi has at least one configured provider on the host.
  8. `models`: each worker model in the factory settings of the current Project is in the model list of the host.
  9. `clone`: the clone of the current Project on the host (see "Assumptions" for the relation to ROW-88).
  10. `git-push`: Git push access from the clone.
  11. `gh`: `gh auth status` passes.
  12. `git-identity`: `user.name` and `user.email` have values on the host.
  13. `local-ahead`: a warning when the local branch of the Project root has commits that are not on `origin`, because remote worktrees start from `origin`.
- `rowbly host login <id>` runs `ssh -t <target> <remote rowbly> auth login`. It must run in a terminal.
- `host add` runs the check at the end and shows the items that the user must do.
- A short form of the check for the main machine: SSH, the Rowbly version and the Pi providers of the host. A failed short check makes the host not ready. It also gives the provider list of the host for the placement (ROW-95).

Not in scope:

- A fix for a failed item. The check does not install Rowbly, does not log in and does not clone. Credentials never go over SSH.
- The call of the short check from the dispatch or the heartbeat. ROW-96 and ROW-97 call it. This Story only gives the function.
- The real `workerHosts` list of the manager (ROW-96, ROW-97).
- A `[provider]` argument of `host login`.

## Acceptance criteria

- [ ] In a Project with a worker model in the factory settings and a clone on the host, `checkHost` with a fake transport where each remote command passes gives `ready: true` and 13 items with the ids above, in this order, each with `state: "ok"`. A service test examines this.
- [ ] Each item has `{ id, label, state, detail, action? }`. `state` is `ok`, `warning`, `fail` or `skipped`. A `fail` item has an `action` text that tells the user what to do on the host (for example `rowbly host login <id>`, `gh auth login`, `git config --global user.email …`). `ready` is `true` only when no item is `fail`.
- [ ] When the first remote call gives `HostAuthFailedError` or `HostUnreachableError`, the `ssh` item is `fail` with the error message and hint, each other item is `skipped`, and `checkHost` does not throw. A test covers each error.
- [ ] A test covers a `fail` for each of: not Linux, no `flock`, no Git, Node missing, Node too old, a different or missing remote Rowbly version, no configured Pi provider, a worker model that the host does not have, no `gh` login, no Git identity, and no push access.
- [ ] `local-ahead` is a `warning` (not a `fail`) when `git rev-list --count HEAD --not --remotes=origin` in the local Project root is more than 0. A test with a temporary local Git repository covers this.
- [ ] Outside a Project, the items `models`, `clone`, `git-push` and `local-ahead` are `skipped` with a reason. A test covers this.
- [ ] `git-push` is `skipped` with the action `rowbly host use <id>` when the host has no clone of the current Project.
- [ ] `rowbly host check <id> --json` prints `{ host, ready, items }`. Text output prints one line for each item with its state and, for a `fail` or `warning`, its action. Exit code is 0 also when items fail. `host check` with an unknown id gives `NOT_FOUND`. A CLI test covers this with a fake transport.
- [ ] `addHost` gives the check result in a new `check` key, after the install. `host add` text output lists the `fail` and `warning` items with their actions. A failed item does not make `host add` fail, and `~/.rowblyrc.json` has the host. A test covers this.
- [ ] `rowbly host login <id>` with `--json`, or when stdin or stdout is not a TTY, gives `VALIDATION` with the hint to run it in a terminal without `--json`. It starts no process. A test covers this.
- [ ] A pure function gives the arguments of the login: `-t`, the same `-o` options as `sshArguments` of `src/services/host-transport/ssh-transport.ts`, `--`, the target, the remote executable, `auth` and `login`. It validates the target and the tokens. A unit test examines the arguments.
- [ ] `quickHostCheck(transport, build)` gives `{ ready, providers, problems }`. It is not `ready` for an SSH error, a different Rowbly version or no configured provider. It does not install. A test covers each case.
- [ ] The check does not load Pi on the main machine. Add the new modules to `src/services/pi-runtime/import-boundary.test.ts`.
- [ ] Tests use the fake transport (`src/services/test-project/fake-host-transport.ts`). No test uses real SSH.
- [ ] Documentation in STE: `host check` and `host login` in `docs/architecture/cli.md` and `skills/rowbly-reference.md` (then copy it to each `skills/<name>/references/rowbly-reference.md`), and the check items in a new section of `docs/architecture/native-factory/host-install.md` or a new page `host-check.md` with a link from `docs/architecture/native-factory/README.md`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Base branch: merge `origin/main` into the Story branch first. Then examine if `src/services/host-project/` (ROW-88) exists.
- Files:
  - `src/services/host-check/host-check.ts`: `checkHost(input, ctx, deps)`, `quickHostCheck(transport, build)` and the item types.
  - `src/services/host-check/host-items.ts` (or similar): one small function for each item. Keep each function short (code style).
  - `src/services/host-check/host-login.ts`: the pure function for the login arguments (`hostLoginArguments(settings, remoteExecutable)`), and a service function that finds the host and gives `{ executable, args }`.
  - `src/commands/host/host.ts`: the `check <id>` and `login <id>` subcommands, thin, with `run()` of `src/commands/output/output.ts`. The `login` command checks the terminal as `requireTerminal` in `src/commands/auth/auth.ts`, then spawns the SSH process with `stdio: "inherit"` and sets the exit code of the process. The service does not print, prompt, spawn an interactive process or exit.
  - `src/services/host/host.ts`: `addHost` calls `checkHost` with the same transport and build after the install, and adds `check` to `AddedHost`.
- Dependency injection: `checkHost` gets an optional `deps` with `transportFor(target)` and `build()`, the same as `AddHostDeps`. The local Git facts (`local-ahead`) come from a function that a test can replace, or from a temporary Git repository.
- Remote commands are fixed tokens through `transport.bytes(command, null, options)` or `transport.request`. The data never goes in the arguments. Examples:
  - `["uname", "-s"]`, `["flock", "--version"]`, `["git", "--version"]`, `["gh", "auth", "status"]`.
  - `["git", "config", "--get", "user.name"]` and `["git", "config", "--get", "user.email"]`. With a clone, add `-C <clone>` so that a local value of the clone counts.
  - Rowbly version: use the same command as `remoteVersion` in `src/services/host-install/host-install.ts` (`<remoteRowblyPath(build.id)> --version`). Export a helper there; do not copy it.
  - Pi: `[<remote rowbly>, "--json", "auth", "status"]` (a provider with `configured: true` passes) and `[<remote rowbly>, "--json", "model", "list"]` (the list of `{ provider, modelId }`). Parse the JSON of stdout with a schema. Bad JSON is a `fail` with the text, not a throw. These commands load Pi on the host only.
  - Push: `["env", "GIT_TERMINAL_PROMPT=0", "git", "-C", <clone>, "push", "--dry-run", "--no-verify", "origin", "HEAD:refs/heads/rowbly-push-check"]`. A dry-run push authenticates with the remote and writes nothing.
- Models: read `getFactorySettings` of the current Project (it does not load Pi). Collect `workerModel`, each value of `stageWorkerModels` and each value of `storyWorkerModels`. Without a worker model, the item is `warning`: the default Pi model of the host is used.
- Local ahead: `execFile("git", ["-C", root, "rev-list", "--count", "HEAD", "--not", "--remotes=origin"])` in the local Project root (`findProject(ctx).root`), never `shell: true`. This is the same rule as the unpushed check of ROW-95 in `src/services/worker-worktree/worker-worktree.ts`; use that function if it fits.
- A check of one item that fails does not stop the other items, except the `ssh` item. When Node or the Rowbly version fails, the Pi items are `skipped`, because they need the remote executable.
- The `host login` arguments use `sshSettings` and the `-o` options of `sshArguments`. Export a helper in `ssh-transport.ts` for the shared options; do not copy them. Add `-t` for the terminal.
- Errors: a transport error during a later item (for example a timeout) makes that item `fail` with the error code. It does not throw.
- The service does not import `commander`, `ink`, `react` or Pi. Read the `rowbly-code-style` skill.

## Assumptions

- The clone item uses `hostProjectFor` and `cloneStatus` of ROW-88 (`src/services/host-project/`) when that service is on the base branch after the merge of `origin/main`. If it is not there, the `clone` item and the `git-push` item are `skipped` with the reason `host use is not available`, and ROW-88 adds the clone item (see the assumption in ROW-88). Reason: ROW-88 is not an upstream Story, and each order of the two merges must give a correct result.
- The check never installs, logs in or clones. Reason: the Story puts each fix out of scope. `host add` installs before the check, so the `rowbly` item passes after `host add`.
- `host check` exits with code 0 when items fail, and gives `ready: false`. Reason: the check result is the output; a check that failed to run (unknown host, invalid file) still gives an error.
- The `ssh` item fails and all other items are `skipped` for an SSH error. Reason: no remote check can run without SSH.
- "The configured models" are the worker models of the factory settings of the current Project. Reason: the supervisor stays on the main machine (Spec decision 1), so only worker models must be on the host.
- "Local `main` is ahead of `origin`" means the current `HEAD` of the local Project root has commits that are not on an `origin` branch. Reason: local worktrees start from `HEAD` of the Project root (`prepareWorkerWorktree`), and the same Git rule is in `worker-worktree.ts`. It is a `warning`, as the Story says.
- The push check is `git push --dry-run` to a new branch name in the clone. Reason: it examines the write access of the credentials on the host and writes nothing on the remote.
- The Git identity is read in the clone when it exists, else in the global config. Reason: Git uses the local value of the clone first.
- The short check is SSH, the Rowbly version and the Pi providers only. Reason: these are the conditions that the Spec uses for "not ready" in "Placement" and "Version", and they are cheap. The short check returns the provider list, because ROW-95 needs "the providers of a host" from this Story.
- The short check is not called from the manager in this Story. Reason: no dispatch to a host exists before ROW-96, and the heartbeat comes in ROW-97.
- `host login` has no `[provider]` argument. Reason: the Story gives the exact command `auth login`, and the remote `auth login` asks for the provider.
- `host login` keeps `BatchMode=yes`. Reason: the Spec requires SSH with a key and without a password; the remote `auth login` prompt is not an SSH prompt, so `-t` is sufficient.
