---
title: Install the exact Rowbly version on a worker host
stage: IN_DEVELOPMENT
position: 5
dependsOn:
  - ROW-84
  - ROW-85
createdAt: 2026-11-16T19:45:03.438Z
updatedAt: 2026-11-16T21:16:00.304Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-86
pull_request: https://github.com/sgolovine/rowbly/pull/277
---

## Goal

Each worker host must run the exact Rowbly version of the main machine. Rowbly installs that version on the host. The user does not install Rowbly on the host by hand.

Read the Spec `remote-worker-hosts`, sections "Setup of a worker host", "Version" and "Transport".

## Scope

In scope:

- A new service `src/services/host-install/` with a test next to each source file. It uses the `HostTransport` of ROW-85 and does not open SSH itself.
- The Node check. The service runs `node --version` on the host. Node 22.19.0 or later is necessary. A missing `node` (exit code 127 or no output) or an old version gives a clear error with a hint.
- The build of the main machine (`localBuild()`):
  - A released build (installed from npm) has the build id `<version>`, for example `0.18.0`.
  - An unreleased build (`pnpm dev`, or a local `dist/` in a Git checkout) has the build id `<version>-dev-<hash>`. `<hash>` is the first 12 hex characters of the `sha256` of the package that `npm pack` makes.
- One private folder on the host for each build id, separate from a global install: `.local/share/rowbly/versions/<build-id>/` (relative to the home folder of the SSH user). The remote executable is `.local/share/rowbly/versions/<build-id>/node_modules/.bin/rowbly`. Export a function that gives this path, because later Stories (ROW-87, ROW-88, ROW-89) run it.
- The install:
  - A released build: `npm install --prefix <dir> --no-save --omit=dev rowbly@<version>`.
  - An unreleased build: `npm pack` on the main machine, then an upload of the package to `.local/share/rowbly/packages/<build-id>.tgz` on the host, then `npm install --prefix <dir> --no-save --omit=dev <package path>`.
  - After the install, the service runs `<remote executable> --version`. The installed version must be equal to the local version.
- `ensureHostVersion(transport, options)`: the step for each connection. It runs the Node check, runs `<remote executable> --version`, and installs the build only when the version is missing or different. It gives a result with `state: "ready" | "version-mismatch"`, the local and remote versions, the build id, the remote executable and `installed: boolean`.
- A transport change for the upload. The transport sends only JSON on stdin now. Add `upload(command, data: Buffer, options)` to `HostTransport`: it writes the exact bytes on stdin and gives the exit code and stderr. Add it to the SSH transport and to the fake transport (`src/services/test-project/fake-host-transport.ts`). The remote command of the upload is `dd of=<path> status=none` after `mkdir -p .local/share/rowbly/packages`.
- Add `@` to the safe characters of a remote command token in `src/services/host-transport/ssh-transport.ts`, because the npm package spec is `rowbly@<version>`. `@` has no special meaning in `sh`, `bash`, `zsh` or `fish`.
- `rowbly host add` runs `ensureHostVersion` before it records the host. If the Node check or the install fails, `host add` fails and `~/.rowblyrc.json` does not change. The JSON result of `host add` has an `install` object with the result.
- Documentation in STE: the install folder and the version rule in `docs/architecture/native-factory/host-transport.md` (or a new page `host-install.md` with a link from `docs/architecture/native-factory/README.md`), and the change of `host add` in `docs/architecture/cli.md` and `skills/rowbly-reference.md` (then copy it to each `skills/<name>/references/rowbly-reference.md`).

Not in scope:

- The removal of old versions from the host.
- The host states in `status.json`, the heartbeat and the reconnect loop. ROW-97 adds them and calls `ensureHostVersion` on each connection.
- The placement that refuses a host. ROW-95 refuses a host with the state `version-mismatch`.
- The other `host add` checks (Linux, `flock`, Git, Pi login). ROW-87 adds them.
- The host agent and its handshake. ROW-89 adds them. The handshake of ROW-85 already compares the versions.

## Acceptance criteria

- [ ] `ensureHostVersion` with a host that has the same build gives `state: "ready"` and `installed: false`, and runs no install command. A test with the fake transport examines the commands.
- [ ] `ensureHostVersion` with a host that has a different version or no Rowbly installs the build, then gives `state: "ready"` and `installed: true`. A test examines the `npm install` command with the private folder of the build id.
- [ ] When the version after the install is still different, or the install command fails, `ensureHostVersion` gives `state: "version-mismatch"` with the local and remote versions and the stderr of the install. The host gets no work (the caller reads the state). A test covers each case.
- [ ] A missing `node` gives an error with the code `HOST_NODE_MISSING`. A Node version below 22.19.0 (for example `v22.18.0` and `v20.11.1`) gives an error with the code `HOST_NODE_TOO_OLD` and the found version in `details`. `v22.19.0` and `v24.1.0` pass. A test covers each case.
- [ ] An unreleased build uploads the package with `upload`, and installs from the package path. The `npm install` command has no `rowbly@<version>` spec. A test uses a fake build with fixed bytes.
- [ ] A released build installs `rowbly@<version>` and does not call `upload`.
- [ ] The SSH transport `upload` writes the exact bytes on stdin. A test with the stub `ssh` executable compares the bytes. The fake transport records the uploaded bytes.
- [ ] A token with `@` passes `validateCommand`. A token with a space, `$`, `;`, a quote or a backtick still fails. A test covers each case.
- [ ] `host add` with a fake transport records the host and gives the `install` result. `host add` with a failed Node check or a failed install gives the error, and the bytes of `~/.rowblyrc.json` do not change. A test covers each case.
- [ ] No test uses real SSH, real `npm install` or real `npm pack`. The tests use the fake transport and a fake build.
- [ ] The install service does not load Pi. Add its modules to `src/services/pi-runtime/import-boundary.test.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Base branch: the worktree base must contain ROW-84 (PR #272, `src/services/host/`, `src/services/user-rc/`, `src/commands/host/`). If these folders are missing, merge `origin/main` into the Story branch first.
- Files:
  - `src/services/host-install/host-install.ts`: `ensureHostVersion`, `installBuild`, `remoteRowblyPath(buildId)`, the result type.
  - `src/services/host-install/node-check.ts`: `checkHostNode(transport)` and a pure `parseNodeVersion` / compare function.
  - `src/services/host-install/local-build.ts`: `localBuild()`. It gives `{ id, version, released, pack?: () => Promise<Buffer> }`. Use `packageDir()` of `src/services/files/files.ts` and the version of `package.json`.
  - New error classes with the codes `HOST_NODE_MISSING`, `HOST_NODE_TOO_OLD` and `HOST_INSTALL_FAILED` in `src/services/host-transport/host-errors.ts` or in the new folder. Each extends `RowblyError` and has a hint.
- The remote commands are fixed tokens (`RemoteCommand`) and go through `transport.bytes(...)` or `transport.upload(...)`. `node --version` and `rowbly --version` print text, not JSON, so read them with `bytes` and a small limit. The data never goes in the arguments.
- The remote paths are relative to the home folder, because SSH starts the remote command there and `~` is not a safe token. Validate the build id against the safe token characters before use. A `+` in a version is not safe, so refuse such a version with a `ValidationError`.
- `node`, `npm` and `dd` must be on the `PATH` of a non-interactive SSH session. The hint of `HOST_NODE_MISSING` says this (for example, a Node from `nvm` that only `.bashrc` loads).
- `npm install` can take minutes. Use a long timeout for the install call (for example 10 minutes), not the default 30 seconds of the transport.
- `npm pack`: run it on the main machine with `spawn` (never `shell: true`), with `--ignore-scripts --pack-destination <private temp dir>` in the package folder. An unreleased build needs `dist/cli.js`. If it is missing, give a `ValidationError` with the hint `Run pnpm build`.
- Unreleased build detection: the package folder has a `.git` entry (a file in a worktree, a folder in a clone), or the running module is under `src/`. A package from npm has neither.
- Dependency injection for tests: `addHost` gets an optional third argument with `transport` (or a `transportFor(target)` factory) and `build`. The default is `createSshTransport({ target })` and `localBuild()`. The command stays thin.
- The service does not print, prompt or exit, and does not import `commander`, `ink`, `react` or Pi. Read the `rowbly-code-style` skill.
- Safety rule: keep all other keys of `~/.rowblyrc.json` when `host add` writes it, and do not write it if Rowbly cannot read it (the `user-rc` module of ROW-84 does this).

## Assumptions

- "Each connection" means a call of `ensureHostVersion`. This Story gives the function and its `version-mismatch` state. ROW-97 calls it on each connection and sets the host state, and ROW-95 refuses the host in placement. Reason: the heartbeat, the host states and the placement are in those Stories, and the smallest scope gives them one function to call.
- `host add` installs before it records the host, and records nothing when the install fails. Reason: the Spec puts the Node check and the install in `host add`, and a host that cannot run Rowbly is not useful. The user can run `host add` again after a fix.
- The install folder is `~/.local/share/rowbly/versions/<build-id>/`. Reason: ROW-85 left the folder to this Story, and ROW-88 uses `~/.local/share/rowbly/projects/` for the clones. One root keeps the Rowbly files of the host together.
- An unreleased build has its own build id with a hash of the package. Reason: an unreleased build can have the same `package.json` version as a released build, but different code.
- The upload is a new `upload` method of the transport, with `dd` on the host. Reason: the transport sends only JSON on stdin, and the host has no Rowbly before the install, so a Rowbly command cannot receive the package.
- `@` becomes a safe token character. Reason: `npm install` needs `rowbly@<version>`, and `@` has no special meaning in the usual remote shells. The other dangerous characters stay refused.
- An interrupted install leaves a folder that the `--version` check does not accept, so the next connection installs again. Reason: the version check is the authority, and an atomic rename adds work that the Spec does not ask for.

## Review findings

- The merge of `origin/main` into `story/ROW-86` has conflicts in these files:
  - `docs/architecture/service-layer.md`
  - `src/commands/host/host.ts`
- Merge `origin/main` into the branch, repair the conflicts, and run the checks again. Then the Changelog Stage can add the entry.
