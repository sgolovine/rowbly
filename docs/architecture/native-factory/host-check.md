# Host check

The host check shows if a worker host is ready for factory workers. It also gives the user an action
for each item that fails. The code is in `src/services/host-check/`. See the Spec
`remote-worker-hosts`, section "Setup of a worker host", step 2 and step 4.

The service uses the `HostTransport` of [host-transport.md](host-transport.md). It does not open SSH
itself, and it does not load Pi on the main machine. The Pi commands run on the host only.

The check does not repair an item. It does not install Rowbly, it does not log in and it does not
clone. Credentials never go over SSH.

## Modules

| File               | Contents                                                                               |
| ------------------ | -------------------------------------------------------------------------------------- |
| `host-check.ts`    | `checkHost`, `runHostCheck`, `quickHostCheck` and `findHost`.                          |
| `check-item.ts`    | The item ids, the item type, the labels and `runRemote`.                               |
| `host-items.ts`    | The items `linux`, `flock`, `git`, `node`, `rowbly`, `gh` and `git-identity`.          |
| `pi-items.ts`      | The items `pi-login` and `models`, and `hostProviders`.                                |
| `project-items.ts` | The items `clone`, `git-push` and `local-ahead`, and the worker models of the Project. |
| `clone-finder.ts`  | `hostCloneFinder`: the clone of the Project from the records of `rowbly host use`.     |
| `host-login.ts`    | `hostLoginArguments` and `hostLogin`: the SSH process of `rowbly host login`.          |

## Items

`checkHost({ id }, ctx, deps)` finds the host in `~/.rowblyrc.json`. An unknown id gives `NOT_FOUND`.
The result is `{ host, ready, items }`. Each item is `{ id, label, state, detail, action? }`.

- `state` is `ok`, `warning`, `fail` or `skipped`.
- A `fail` item has an `action`. The action tells the user what to do on the host.
- `ready` is `true` only when no item is `fail`. A `warning` does not make the host not ready.

The items come in this order:

| Id             | Remote command or local step                                 | `ok` when                                      |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `ssh`          | `uname -s`, the first remote call                            | The call has no transport error.               |
| `linux`        | The output of `uname -s`                                     | The output is `Linux`.                         |
| `flock`        | `flock --version`                                            | The exit code is 0.                            |
| `git`          | `git --version`                                              | The exit code is 0.                            |
| `node`         | `node --version` (`checkHostNode` of the install)            | Node is 22.19.0 or later.                      |
| `rowbly`       | `<remote rowbly> --version`                                  | It prints the version of the main machine.     |
| `pi-login`     | `<remote rowbly> --json auth status`                         | Pi has one or more configured providers.       |
| `models`       | `<remote rowbly> --json model list`                          | The host has each worker model of the Project. |
| `clone`        | The clone finder of `rowbly host use`                        | The host has a clone of the Project.           |
| `git-push`     | `env GIT_TERMINAL_PROMPT=0 git -C <clone> push --dry-run …`  | The dry-run push to `origin` passes.           |
| `gh`           | `gh auth status`                                             | The exit code is 0.                            |
| `git-identity` | `git [-C <clone>] config --get user.name` and `user.email`   | The two values are set.                        |
| `local-ahead`  | `git -C <root> rev-list --count HEAD --not --remotes=origin` | The count is 0. Else the item is a `warning`.  |

These rules apply:

- Each remote command has fixed tokens. The data never goes in the arguments.
- If the first call gives a transport error, for example `HOST_AUTH_FAILED` or `HOST_UNREACHABLE`,
  the `ssh` item is `fail` with the message and the hint of the error. Each other item is `skipped`.
  `checkHost` does not throw.
- A transport error in a later item, for example `HOST_TIMEOUT`, makes only that item `fail`. The
  detail has the error code.
- If `node` or `rowbly` is not `ok`, `pi-login` and `models` are `skipped`, because they need the
  remote executable.
- The check reads the JSON of the remote Rowbly with a schema. Bad JSON makes the item `fail` with the
  text. It does not throw.
- The worker models are `workerModel`, each value of `stageWorkerModels` and each value of
  `storyWorkerModels` of the factory settings. Without a worker model, `models` is a `warning`: the
  host uses its default Pi model. The supervisor model setting is not in
  the check.
- Outside a Project, `models`, `clone`, `git-push` and `local-ahead` are `skipped`.
- The `clone` item reads the record of the current Project on the host (`hostProjectFor`), then runs
  `cloneStatus` with the local `origin` URL. A test can replace this finder with the dependency
  `cloneFor`.
  - If the host does not use the Project, or the folder is missing, `clone` is `fail` with the action
    `Run rowbly host use <id>.`
  - If the folder is not a Git clone, or its `origin` is a different repository, `clone` is `fail` with
    `VALIDATION` and the action `Run rowbly host unuse <id>, then rowbly host use <id>.`
  - A local Project without `origin` makes `clone` `fail` with `VALIDATION`.
  - Without a clone, `git-push` is `skipped` with the action `Run rowbly host use <id>.`
- With a clone, `git-identity` reads the config in the clone, because Git uses a value of the clone
  first.
- `local-ahead` runs `git` on the main machine without a shell. Remote worktrees start from `origin`,
  so local commits that are not on `origin` give a `warning`. If Git cannot count, the item is
  `skipped`.

`addHost` runs the check with the same transport and build after the install and the write of the
file. It gives the result in the `check` key. A failed item does not make `host add` fail.

## Short check

`quickHostCheck(transport, build)` is the short check for the main machine. It gives
`{ ready, providers, problems }`.

1. It runs `<remote rowbly> --version`. An SSH error, a different version or an executable that
   cannot run makes the host not ready.
2. It runs `<remote rowbly> --json auth status`. `providers` are the ids of the configured providers.
   Without a configured provider, the host is not ready.

The short check does not install. The placement uses `providers`. The dispatch and the heartbeat do
not call the short check at this time.

## Login

`rowbly host login <id>` runs `ssh -t <options> -- <target> <remote rowbly> auth login` in the
terminal of the user. The remote `auth login` asks for the provider and the secret on the host.

- `hostLoginArguments(settings, remoteExecutable)` is a pure function. It gives `-t`, the `-o` options
  of `sshOptions` (the same options as each SSH call, with `BatchMode=yes`), `--`, the target, the
  remote executable, `auth` and `login`. It validates the target and the tokens.
- `hostLogin({ id }, ctx)` finds the host and gives `{ host, executable, args }`. It does not start
  the process.
- The command starts SSH with `stdio: "inherit"` and sets the exit code of SSH. With `--json`, or when
  stdin or stdout is not a terminal, it gives `VALIDATION` and starts no process.
