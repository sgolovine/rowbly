---
title: Add host use to clone the Project on a worker host
stage: IN_DEVELOPMENT
position: 7
dependsOn:
  - ROW-84
  - ROW-85
  - ROW-86
createdAt: 2026-11-16T19:45:04.969Z
updatedAt: 2026-11-16T21:33:16.480Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-88
pull_request: https://github.com/sgolovine/rowbly/pull/279
---

## Goal

The user turns a worker host on for one Project. The host then has a clone of the repository of the Project. Later Stories (ROW-92, ROW-96) make the worker worktrees from that clone.

Read the Spec `remote-worker-hosts`, section "Setup of a worker host", step 3.

## Scope

In scope:

- A new service `src/services/host-project/` (with a test next to each source file). It uses the `HostTransport` of ROW-85 and does not open SSH itself.
- `rowbly host use <id> [--path <dir>]` in a Project. It turns the host on for the current Project.
  - Without `--path`, Rowbly clones the repository from the local `origin` URL into the managed folder `.local/share/rowbly/projects/<project-id>/repo` on the host (relative to the home folder of the SSH user, below `HOST_ROOT` of `src/services/host-install/host-install.ts`).
  - When the managed folder already has a clone of the same repository (for example after `host unuse`, then `host use` again), Rowbly uses it again and does not clone.
  - `--path <dir>` uses an existing clone. Rowbly examines that it is a Git work tree, that it is the same repository, and that it is clean. It does not clone.
- `rowbly host unuse <id>` in a Project. It turns the host off for the current Project. It removes only the record. The clone and the worktrees stay on the host.
- The record of the Projects of each host, in the host entry of `~/.rowblyrc.json`.
- A function that gives the clone of the current Project on a host, and a function that examines the clone over the transport. ROW-87 (`host check`) and the dispatch Stories use them.
- The worktree layout of the host: the worktrees of the remote workers go next to the clone, in the same layout as on the main machine: `<clone>-worktrees/<story-id>` (see `worktreePath` in `src/services/worker-worktree/worker-worktree.ts`). Export a function that gives this folder. This Story creates no worktree.
- Documentation in STE: the `host use` and `host unuse` commands in `docs/architecture/cli.md` and `skills/rowbly-reference.md` (then copy it to each `skills/<name>/references/rowbly-reference.md`), the `projects` key of a host in `docs/architecture/storage.md`, and the managed clone folder in `docs/architecture/native-factory/host-transport.md`.

Not in scope:

- The `git fetch` before a launch. The host agent does it (ROW-92).
- The creation of worker worktrees on the host (ROW-92).
- The `host check` command and its output. ROW-87 adds it and shows the clone item with the function of this Story.
- The removal of the clone and the worktrees with `host remove --purge`.
- A change of the shape of `host list` output.

## Acceptance criteria

- [ ] `host use mini` in a Project with the fake transport runs `git clone` with the local `origin` URL into `.local/share/rowbly/projects/<project-id>/repo`. Then `~/.rowblyrc.json` has `{ "root": "<local Project root>", "path": ".local/share/rowbly/projects/<project-id>/repo", "managed": true }` in the `projects` array of the host `mini`. A service test examines the commands and the file.
- [ ] `host use` with a managed folder that already has a clone with the same `origin` runs no `git clone` and records the Project. A test covers this.
- [ ] `host use` with a managed folder that exists but is not a clone of the same repository gives `CONFLICT` and does not change `~/.rowblyrc.json`. A test covers this.
- [ ] `host use mini --path work/rowbly` runs no `git clone`. It records `managed: false` with the path. A test covers this.
- [ ] `host use --path` gives `VALIDATION` when the folder is not a Git work tree, when its `origin` is a different repository, or when `git status --porcelain` is not empty. The file does not change. A test covers each case.
- [ ] Same repository: `git@github.com:o/r.git`, `ssh://git@github.com/o/r`, and `https://github.com/o/r.git` are the same repository. `https://github.com/o/other.git` and `https://gitlab.com/o/r.git` are different. A unit test of the pure compare function covers each case.
- [ ] A clone that fails because the host has no Git access (stderr has, for example, `Permission denied (publickey)`, `Authentication failed`, `could not read Username`, `Repository not found` or `Host key verification failed`) gives the error code `HOST_GIT_ACCESS` with the clone stderr in `details` and a hint that tells the user to fix the Git access on the host (for example: log in with `ssh <target>`, then run `git ls-remote <url>`). Another clone failure gives `HOST_CLONE_FAILED` with the stderr. The file does not change. A test covers each case.
- [ ] `host use` with an unknown host gives `NOT_FOUND`. `host use` outside a Project gives the usual Project error. `host use` for a Project that the host already uses gives `CONFLICT` with a hint to run `host unuse` first.
- [ ] A local Project without an `origin` remote gives `VALIDATION` with a hint to add `origin`. A test covers this.
- [ ] An `origin` URL or a `--path` with a character that is not a safe remote token (see `SAFE_TOKEN` in `src/services/host-transport/ssh-transport.ts`) gives `VALIDATION` before any remote command. A leading `~/` in `--path` becomes a path relative to the home folder. A test covers each case.
- [ ] `host unuse mini` removes only the record of the current Project and keeps all other keys and Projects. It runs no remote command. It gives `NOT_FOUND` when the host does not use the Project, and `CONFLICT` while a `pending` or `running` Thread of the current Project has that host. A test covers each case.
- [ ] The clone status function gives `ok` for a clone with the same `origin`, and a problem (`missing`, `not-a-repository` or `different-repository`) otherwise, with the path. A test with the fake transport covers each case. ROW-87 uses this function for the clone item of `host check`.
- [ ] Safety rule: an invalid `projects` value in a host entry makes each host command fail with `VALIDATION`, and the bytes of `~/.rowblyrc.json` do not change. A write keeps all other keys. A test examines the bytes.
- [ ] `host list --json` still gives `{ id, ssh, maxWorkers, enabled }` for each host. The existing host tests pass.
- [ ] No test uses real SSH or a real remote clone. Tests use the fake transport (`src/services/test-project/fake-host-transport.ts`). A local `git` in a temporary repository is permitted for the local `origin` URL.
- [ ] The new service does not load Pi. Add its modules to `src/services/pi-runtime/import-boundary.test.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Base branch: the worktree of this Story was made before the merge of ROW-86 (PR #277). Merge `origin/main` into the Story branch first, so that `src/services/host-install/` exists.
- Files:
  - `src/services/host-project/host-project.ts`: `useHost(input, ctx, deps)`, `unuseHost(input, ctx)`, `hostProjectFor(hostId, ctx)` and `remoteWorktreesDir(path)`.
  - `src/services/host-project/host-clone.ts`: the remote Git commands and `cloneStatus(transport, record)`.
  - `src/services/host-project/repo-url.ts`: the pure `sameRepository(a, b)` and the normalization of a URL to `host/owner/repo` (lower case, no `.git`, no trailing `/`, no user, scp form and `ssh://` and `https://` forms).
  - `src/commands/host/host.ts`: the `use <id>` and `unuse <id>` subcommands, thin, with `run()` of `src/commands/output/output.ts`.
  - The new error codes `HOST_GIT_ACCESS` and `HOST_CLONE_FAILED`, as `RowblyError` classes with a hint, next to `src/services/host-install/host-install-errors.ts`.
- Record shape: each host entry can have `"projects": [{ "root": string, "path": string, "managed": boolean }]`. A missing key is an empty list. `root` is the absolute path of the local Project root (`findProject(ctx).root`), the same value as the `projects` list of known Projects. `path` is relative to the home folder of the SSH user, or absolute. Validate the key in `src/services/host/host-rules.ts` (`rcHosts`). `hostView` keeps its four fields.
- Project id: `<name>-<hash>`. `<name>` is the base name of the local root in dash-case (only `a-z`, `0-9` and `-`). `<hash>` is the first 12 hex characters of the `sha256` of the local root path. Thus two Projects with the same name do not share a folder.
- Remote commands are fixed tokens and go through `transport.bytes(command, null, { timeoutMs, limit })`. The data never goes in the arguments. Examples:
  - `["test", "-e", <path>]` to find if the managed folder exists.
  - `["git", "-C", <path>, "rev-parse", "--is-inside-work-tree"]`.
  - `["git", "-C", <path>, "remote", "get-url", "origin"]`.
  - `["git", "-C", <path>, "status", "--porcelain"]`.
  - `["env", "GIT_TERMINAL_PROMPT=0", "git", "clone", "--", <url>, <path>]`. `GIT_TERMINAL_PROMPT=0` stops a credential prompt. `git clone` makes the parent folders.
- Use a long timeout for the clone (for example 30 minutes, as a constant). The other calls use the default timeout.
- Read the local `origin` URL with `execFile("git", ["-C", root, "remote", "get-url", "origin"])` (never `shell: true`).
- `host use` writes the record only after the remote steps pass. It reads `~/.rowblyrc.json` again before the write, because the clone can take minutes (the same pattern as `addHost`).
- `host unuse` uses the active Thread check of `src/services/host/host.ts` for the current Project only. Export a small helper there, or move it to a shared module. Do not copy it.
- Dependency injection for tests: `useHost` gets an optional `deps` argument with `transportFor(target)`. The default is `createSshTransport({ target })`.
- The service does not print, prompt or exit, and does not import `commander`, `ink`, `react` or Pi. Read the `rowbly-code-style` skill.
- Safety rule: keep all other keys of `~/.rowblyrc.json` and do not write it if Rowbly cannot read it (use `src/services/user-rc/user-rc.ts`).

## Assumptions

- `host check` (ROW-87) is not on the base branch of this Story, and ROW-87 does not depend on this Story. This Story gives the clone status function, and ROW-87 shows it as the clone item. Reason: the smallest scope that satisfies "`host check` reports the clone of the current Project" without a second `host check` command. If ROW-87 is merged before this Story is developed, add the clone item to it in this Story.
- The Project record goes in the host entry (`hosts[].projects`), keyed by the local Project root. Reason: the Story puts the record in `~/.rowblyrc.json`, and the known Projects list already uses the root path as the key. Rowbly has no other Project id.
- The managed folder is `.local/share/rowbly/projects/<name>-<hash>/repo`, relative to the home folder. Reason: the Story gives this example, ROW-86 uses the same root for versions, and `~` is not a safe remote token.
- The worktrees go to `<clone>-worktrees/<story-id>`. Reason: this is the layout of `worktreePath` on the main machine, so the same code can make them on the host.
- "The same repository" means the normalized `origin` URLs are equal. Reason: it is a check that needs no network and no fetch. The host can use a different URL form (SSH or HTTPS) for the same repository.
- `--path` must be clean (`git status --porcelain` is empty), and a managed clone that exists is used again without this check. Reason: the Spec asks for a clean clone only for `--path`. A managed clone belongs to Rowbly, and its worktrees can have work.
- `host unuse` keeps the clone and the worktrees. Reason: the Spec keeps them for `host remove` unless the user gives `--purge`, and a later Story adds the clean-up.
- `host unuse` refuses while an active Thread of the current Project is on the host. Reason: the same rule as `host remove`, so that a running worker keeps its clone record.
- `host use` does not run `ensureHostVersion`. Reason: Git does not need Rowbly on the host, and `host add` and each connection (ROW-97) already install the version.
- A clone failure is a Git access failure when its stderr has one of the known Git authentication messages. Reason: Git has no exit code for an access failure. Other failures get a separate code, so the hint is not wrong.

## Review findings

- The merge of `origin/main` (9baa754a) into `story/ROW-88` has conflicts in files other than `CHANGELOG.md`. The changelog worker stopped the merge (`git merge --abort`) and did not write the changelog entry.
- Files with conflicts:
  - `src/commands/host/host.test.ts`
  - `src/commands/register-commands/register-commands.test.ts`
- Merge `origin/main` into the Story branch, repair these conflicts, run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`, and push the branch.
