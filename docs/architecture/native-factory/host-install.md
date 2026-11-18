# Host install

Each worker host must run the exact Rowbly build of the main machine. Rowbly installs that build on
the host. The user does not install Rowbly on the host. The code is in `src/services/host-install/`.
See the Spec `remote-worker-hosts`, sections "Setup of a worker host" and "Version".

The service uses the `HostTransport` of [host-transport.md](host-transport.md). It does not open SSH
itself, and it does not load Pi.

## Modules

| File                     | Contents                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `host-install.ts`        | `ensureHostVersion`, `installBuild`, `remoteRowblyPath` and the other remote paths.   |
| `node-check.ts`          | `checkHostNode`, `parseNodeVersion` and the compare of Node versions.                 |
| `local-build.ts`         | `localBuild`: the build of the main machine, its build id and its package.            |
| `host-install-errors.ts` | The error classes `HOST_NODE_MISSING`, `HOST_NODE_TOO_OLD` and `HOST_INSTALL_FAILED`. |

## Build id

`localBuild()` gives the build of the main machine:

- A released build (installed from npm) has the build id `<version>`, for example `0.18.0`.
- An unreleased build has the build id `<version>-dev-<hash>`. `<hash>` is the first 12 hex
  characters of the `sha256` of the package that `npm pack` makes. An unreleased build can have the
  same version as a released build, but different code. Thus it gets its own id.

A build is unreleased when the package folder has the file `src/cli.ts`, or when the code runs from
`src/`. A package from npm has only `src/config/prompts/`, thus it does not have `src/cli.ts`. In the
repository, the package folder is `packages/cli/`. This folder does not have a `.git` entry, thus
Rowbly does not use `.git` to find an unreleased build.
An unreleased build must have `dist/cli.js`. If it does not, `localBuild()` gives `VALIDATION` with
the hint `Run pnpm build`.

`npm pack` runs on the main machine without a shell and without scripts, in a private temporary
folder. It runs one time for each call of `localBuild()`.

A build id can have only the characters `A-Z`, `a-z`, `0-9` and `. _ -`. A version with `+` gives
`VALIDATION`, because `+` is not a safe token of a remote command.

## Folders on the host

All paths are relative to the home folder of the SSH user, because SSH starts the remote command
there, and `~` is not a safe token.

| Path                                                               | Contents                                     |
| ------------------------------------------------------------------ | -------------------------------------------- |
| `.local/share/rowbly/versions/<build-id>/`                         | The private install of one build.            |
| `.local/share/rowbly/versions/<build-id>/node_modules/.bin/rowbly` | The remote executable.                       |
| `.local/share/rowbly/packages/<build-id>.tgz`                      | The uploaded package of an unreleased build. |

Each build has its own folder, separate from a global install. Rowbly does not remove old folders.
Use `remoteRowblyPath(buildId)` to get the remote executable.

## Version rule

`ensureHostVersion(transport, { build })` is the version step of each connection:

1. It runs `node --version`. Node 22.19.0 or later is necessary.
2. It runs `<remote executable> --version`. If the output is equal to the local version, the result
   is `ready` and `installed: false`. It runs no install command.
3. Otherwise it installs the build:
   - A released build: `npm install --prefix <dir> --no-save --omit=dev rowbly@<version>`.
   - An unreleased build: `mkdir -p .local/share/rowbly/packages`, then an upload of the package with
     `dd of=<package path> status=none`, then `npm install --prefix <dir> --no-save --omit=dev ./<package path>`.
4. It runs `<remote executable> --version` again. If the version is equal, the result is `ready` and
   `installed: true`.

If the install fails, or the version after the install is still different, the result is
`version-mismatch`. The result has the local version, the remote version and the stderr of the failed
step. A host with `version-mismatch` gets no work. The caller reads the state.

The install has a time limit of 10 minutes, because `npm install` can take minutes. An interrupted
install leaves a folder that the version check does not accept, so the next connection installs again.

`node`, `npm` and `dd` must be on the `PATH` of a non-interactive SSH session. A Node that only
`.bashrc` loads, for example from `nvm`, is not sufficient.

## Result

| Field              | Contents                                                          |
| ------------------ | ----------------------------------------------------------------- |
| `state`            | `ready` or `version-mismatch`.                                    |
| `buildId`          | The build id of the main machine.                                 |
| `localVersion`     | The version of the main machine.                                  |
| `remoteVersion`    | The version that the remote executable prints, or `null`.         |
| `remoteExecutable` | The path of the remote executable.                                |
| `installed`        | `true` when this call installed the build.                        |
| `nodeVersion`      | The output of `node --version` on the host.                       |
| `stderr`           | The stderr of a failed install step. It is empty without failure. |

## Errors

| Code                  | Cause                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `HOST_NODE_MISSING`   | `node --version` exits with a code other than 0 (127 when no `node`), or gives no version. |
| `HOST_NODE_TOO_OLD`   | The Node version is below 22.19.0. `details.found` has the found version.                  |
| `HOST_INSTALL_FAILED` | `host add` gets `version-mismatch`. `details.install` has the result.                      |

## Host add

`rowbly host add` runs `ensureHostVersion` before it records the host. If the Node check or the
install fails, `host add` fails and `~/.rowblyrc.json` does not change. The JSON result has an
`install` object with the result. `addHost` gets an optional third argument with `transportFor` and
`build`. Tests use it to give a fake transport and a fake build.

## Tests

No test uses real SSH, real `npm install` or real `npm pack`. The tests use
`createFakeHostTransport` and a fake build. The fake transport records each upload with its exact
bytes in `uploads`.
