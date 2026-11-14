<p align="center">
  <img src="https://raw.githubusercontent.com/sgolovine/rowbly/main/assets/header.png" alt="rowbly: a file-backed Kanban board for you and your agent, right in your terminal" width="100%">
</p>

<p align="center">
  <a href="https://github.com/sgolovine/rowbly/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sgolovine/rowbly/ci.yml?branch=main&label=build" alt="Build status"></a>
  <a href="https://www.npmjs.com/package/rowbly"><img src="https://img.shields.io/npm/v/rowbly?color=f5b841" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/rowbly"><img src="https://img.shields.io/npm/dm/rowbly?color=blue" alt="npm downloads"></a>
  <a href="https://github.com/sgolovine/rowbly/blob/main/LICENSE.md"><img src="https://img.shields.io/npm/l/rowbly" alt="License"></a>
</p>

# Rowbly

Rowbly keeps a Kanban board in Markdown and JSON files in your repository.
Its native factory runs a Pi supervisor and independent workers. Each worker has a Story, a worktree and a separate conversation.
The terminal UI and CLI use the same services.

## Prerequisites

Rowbly must run on Node >=22.19.0. Native factory execution must use Linux, Git, local files and util-linux `flock`.
You can use the board and read-only history without provider credentials.
Other platforms have no native execution guarantee. Multi-host, NFS and copied-runtime ownership are not supported.

## First start

1. Install Rowbly:

   ```sh
   npm install -g rowbly
   ```

2. Open a terminal in your repository.
3. Run `rowbly` to create a Project through the TUI.

4. Select defaults or customize the name, Stages, skills and harnesses.
5. Press `?` to see the keys.

Use `npx rowbly` without a global install. Use `rowbly init` for the CLI setup questions.
Agents can use `rowbly init --defaults --harness codex` without interactive questions.
Replace `codex` with the correct harness ID from the table below.

Run `rowbly doctor` to examine the Project files. Run `rowbly --help` to see the commands.

## Provider sign-in and models

1. Run `rowbly auth providers` to see provider IDs and login methods.
2. Run `rowbly auth login` in an interactive terminal.
3. Select a provider and follow its account or API-key prompts.
4. Run `rowbly model list` to see configured models and supported thinking levels.
5. Set the factory models and worker limit:

   ```sh
   rowbly factory configure --supervisor <provider/model> --worker <provider/model> --max-workers 4
   ```

`--supervisor-thinking` and `--worker-thinking` select a supported thinking level for each role.
Without explicit choices, Pi selects default models. Rowbly does not change global Pi settings.
Factory preferences stay in `.rowbly/factory.json`. Credentials stay in Pi storage, outside the Project.

API keys use masked prompts. Do not put secrets in command arguments or Project files.
`rowbly auth status` reports configured status, without a health check.
A model list does not prove provider access, quota or credential health.
Use `rowbly auth logout <provider>` to remove a stored credential.

In the TUI, open Settings and select AI in the Factory group. The section has three tabs: Providers,
Models and Limits. Use `←` and `→` to change the tab.

- **Providers** shows the signed-in providers. The `d` key signs out with confirmation, and `r` reloads.
  The `n` key opens a page with the other providers. On that page, Enter signs in and Escape goes back.
- **Models** shows the supervisor model and the worker model. The `s` and `w` keys change them. The picker
  offers supported thinking levels and `Pi default`.
- **Limits** shows the worker limit. The `l` key edits it.

Escape cancels sign-in and returns focus.

## Factory controls

1. Create a Story and put it in a Stage whose prompt gives an agent work.
2. Press `f` to open Factory controls.
3. Press `s` to start the native factory.

The header shows Factory status and worker counts when space permits.
Factory controls show the supervisor model, worker counts, queue reasons, provider pauses and attention items.
Enter opens the supervisor conversation. The `a` key opens the AI section of Settings.

The factory runs in a separate daemon. Close the TUI to leave the factory active.

The same controls are available through the CLI:

```sh
rowbly factory start
rowbly factory status
rowbly factory logs --tail 20
rowbly factory stop
rowbly factory restart
```

Use `rowbly factory start --foreground` to run in the current terminal.
Native execution must use a Git repository. Workers preserve existing branch work and dirty worktrees.
The supervisor receives bounded worker summaries. It reads transcript excerpts only through explicit inspection.

A Project without `state.json` remains valid and shows no activity status line below the Story list.

## Threads and conversations

Press `t`, or click the `Stories`/`Threads` Switch in the header, to see the worker Threads of all Stories.
The Factory view shows the sections "Active Threads" and "Inactive Threads". The Stage sidebar filters the Threads.
Press `enter` on a Thread to see its metadata and its conversation.

Open a Story and select its Threads tab. The tab shows active and historical worker attempts.
A pending Thread is a durable reservation that occupies a worker slot.
A Story that waits for capacity has a queue note, without a fictitious Thread.
Select a Thread to read its conversation without agent activation.

Use `x` to interrupt with confirmation. Use `r` to resume an eligible Thread through the active factory.

The viewer supports arrows, `j`/`k`, Page Up, Page Down, Home, End and the mouse wheel.
Scroll up to stop follow. Press End or `f` to follow again. Escape returns to the previous view.

Only finalized Pi messages appear. Unknown session formats show a placeholder.
Read-only history works while the factory is off.

```sh
rowbly thread list --story APP-01
rowbly thread show <id>
rowbly thread log <id> --tail 20
rowbly thread cancel <id>
rowbly thread resume <id>
```

`thread log` has a maximum of 100 entries. Metadata lists do not load transcripts.
Conversation reads use bounded pages from the selected current-format Pi history.
Thread history stays after a Story is deleted.

## Stop, resume and recovery

Press `x` in Factory controls and confirm to stop. The CLI equivalent is `rowbly factory stop`.
Normal stop aborts Pi sessions and preserves histories and worktrees.
Start again to let the supervisor select eligible interrupted Threads. A start does not automatically resume every Thread.

Before an explicit resume, make sure that these conditions apply:

- The factory is active.
- The Story is in the original Stage.
- The Thread has a session file.
- The policy permits the resume.
- The original worktree is present.

Completed Threads cannot resume. Each Thread has at most three runs; retries create new Threads.
Cancellation holds the Story and Stage until release, explicit resume or a material Story change.

After definite daemon death, recovery marks active runs interrupted and repairs missing native state projections.
An old heartbeat does not prove death. Live or uncertain owners prevent takeover.
Shell descendants started by a crashed daemon are not tracked. Normal stop relies on Pi abort for shell children.

Do not assume exactly-once shell effects. Examine uncertain external effects before a resume.
Stop all relevant factory processes before offline repair of a lifecycle guard left after a crash.
See [runtime files and locks](docs/architecture/native-factory/runtime-and-locks.md) and
[recovery](docs/architecture/native-factory/recovery.md) for the lock contract and recovery limits.

## Files and compatibility

Stories, Stage prompts, Specs and Project instructions remain ordinary files under `.rowbly/`.
Existing Projects need no migration. Without factory settings, the worker limit is four.
`.rowbly/.gitignore` excludes `/state.json*` and `/runtime/`.
The native factory or the external supervisor writes v1 `state.json`; unknown v1 keys stay intact.

Runtime metadata, command receipts, operational logs and Pi histories stay in `.rowbly/runtime/`.
Do not commit runtime files or credentials. Doctor reports tracked runtime files and corrupt or orphan Threads.
`rowbly doctor --fix` can add missing ignore rules. It does not repair conversations.

The external factory skill remains available when the native factory is off.
Never run both supervisors together. Updated external scripts refuse a live or uncertain native owner.
Old installed copies do not honor this ownership protocol.
Stop external workers before `rowbly factory start --adopt-external` marks their active attempts interrupted.

That option does not stop external workers or import their conversations.

| Path                    | Support and limits                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Existing Projects       | No Story, Stage, Spec or config migration. Missing runtime files remain valid.              |
| Native execution        | Linux, Git, local files and util-linux `flock`; minimum Node 22.19.0.                       |
| External harness        | Retained when native execution is off; old copies cannot protect native ownership.          |
| Peek                    | Current Pi v3 only; unknown versions show a placeholder; no agent activation.               |
| Recovery                | Definite local owner death only; no shell descendant tracking after a daemon crash.         |
| Authentication evidence | Faux and scripted tests; real login, entitlement and refresh need separate live validation. |

## Skills

| Skill     | Function                                                                      |
| --------- | ----------------------------------------------------------------------------- |
| `factory` | Starts the native factory, or supervises workers through an external harness. |
| `refine`  | Makes a Story ready for development without source code changes.              |
| `develop` | Builds a refined Story in a Git worktree, or repairs review findings.         |
| `review`  | Examines a Story pull request and reports if it is ready to merge.            |

Install skills for your harness:

```sh
rowbly skill install factory --harness claude-code --harness codex
```

| Harness          | Project skills folder |
| ---------------- | --------------------- |
| `claude-code`    | `.claude/skills`      |
| `codex`          | `.agents/skills`      |
| `gemini-cli`     | `.gemini/skills`      |
| `github-copilot` | `.github/skills`      |
| `cursor`         | `.cursor/skills`      |

Run `rowbly skill list` to see installed skills. Run `rowbly skill remove` to remove a skill.
Keep local changes to an installed skill in a different place. Removal deletes the tracked folder and its local changes.

## Development and validation

Rowbly uses TypeScript, Commander.js, Ink and the pinned Pi SDK 1.5.2. It uses pnpm as the package manager.
Pi loads on demand for authentication, model selection and native execution.
The board, help, doctor, factory status, metadata and read-only history paths do not import Pi runtime values.

```sh
git clone https://github.com/sgolovine/rowbly.git
cd rowbly
pnpm install
pnpm dev
```

Run these checks before a change is complete:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:factory
```

Automated session tests use Pi's faux provider, in-memory credentials and no live provider requests.
Daemon tests isolate HOME and Pi directories and block network access.
These tests do not prove real provider entitlement, browser login or token refresh.
Live provider validation is separate. See [AGENTS.md](AGENTS.md) for contribution rules, and
[docs/architecture](docs/architecture/README.md) for the architecture.

## License

Rowbly uses the [MIT License](LICENSE.md).
