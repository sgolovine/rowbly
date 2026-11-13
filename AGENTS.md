# AGENTS.md

Instructions for agents and contributors who work on Rowbly.

## What Rowbly is

Rowbly is one executable, `rowbly`. It has two modes:

| Command                            | Mode | Result                                          |
| ---------------------------------- | ---- | ----------------------------------------------- |
| `rowbly`                           | TUI  | Starts the interactive terminal UI (React Ink). |
| `rowbly <command> [--flag value…]` | CLI  | Runs one command and stops (Commander.js).      |
| `rowbly --help` / `rowbly -h`      | CLI  | Shows the usage text.                           |
| `rowbly --version` / `rowbly -v`   | CLI  | Shows the version from `package.json`.          |

`src/cli.ts` selects the mode. If there are no arguments, it starts the TUI. If there are arguments,
Commander parses them.

## Domain concepts

Rowbly has these concepts. Use these names in code, services, commands and UI text.

```
Project ── configuration: custom field definitions, stages (each with an optional prompt)
  ├── Factory ── native supervisor and independent workers
  │     └── Thread ── one Pi session, with one or more runs
  └── Story ── custom field values, exactly one stage
        ├── Thread ── the history of one worker attempt
        └── Spec ── a Markdown document, linked to one or more stories
```

- **Project.** The project is the top-level concept. Rowbly keeps all of its data in a project. Data
  at the "top level" is data at the project level. Each project has a configuration that sets how
  the project operates. The configuration contains the custom fields and the stages of the project.
- **Story.** A project contains stories. You define each custom field one time, at the project level.
  The field then applies to all stories in that project, and each story has its own values for it.
  Each story is in a stage.
- **Stage.** You define stages at the project level, and they apply to all stories of the project.
  Each story in a project **must** have a stage. Each project from `rowbly init` or the TUI starts with the stages that
  onboarding selects. Users can add more stages. Each stage can have a prompt. The prompt tells agents what
  to do with a story while the story is in that stage.
- **Factory.** The native factory runs a Pi supervisor and independent Pi workers in a separate daemon.
  The manager controls ownership, worker slots, worktrees, sessions, commands and recovery.
  The external factory skill remains available when the native factory is off.
  Never run native and external supervisors together.
- **Thread.** A Thread holds metadata for one Pi session. A worker Thread belongs to one Story and one Stage attempt.
  A resume adds a run to the same Thread. A retry creates a new Thread.
  Supervisor Threads belong to the Factory. History stays after a Story is deleted.
- **Factory activity.** The activity shows workers from `.rowbly/state.json` for the current Story Stage.
  The native factory and the external supervisor both write this file under the shared state lock.
  The activity reader does not check worker liveness. Native factory controls check daemon ownership separately.
- **Spec.** A spec is a Markdown document that describes the work of a story. A spec must have a link
  to at least one story, and a story can have many specs. Specs are an optional feature. Each project
  starts with specs off. Turn them on in the Specs section of Settings or with
  `rowbly project update --specs on`. When specs are on, an open story has a General tab and a Specs tab.

## Stack

- **TypeScript** (ESM, `"type": "module"`), Node >= 22.19.0
- **Pi** (`@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`), pinned to 1.5.2, supplies sessions, authentication and models.
- **Commander.js** to parse arguments
- **Ink** and **React** for the TUI. `marked`, `marked-terminal`, `wrap-ansi` and `chalk` render
  Markdown in the TUI.
- **agentic-tui** (dev) runs the built CLI in a PTY for screenshots and layout checks
- **Vitest** and **ink-testing-library** (dev) for the tests
- **tsup** bundles `src/cli.ts` into `dist/cli.js`, with a `#!/usr/bin/env node` banner
- **tsx** runs the source directly during development
- **Biome** for lint and format (`biome.json`)
- **Knip** (dev) to find dead code (`knip.json`)
- **pnpm** as the package manager

## Scripts

```sh
pnpm dev              # run from source: launches the TUI
pnpm dev --help       # run from source with CLI args
pnpm build            # bundle to dist/
pnpm start            # run the built bundle
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run: run all tests one time
pnpm test:watch       # vitest: run the tests again when a file changes
pnpm test:factory     # node --test: run the tests of the factory skill scripts
pnpm lint             # biome check: lint, formatting and import order
pnpm lint:fix         # biome check --write: apply safe fixes and format
pnpm format           # biome format --write
pnpm knip             # knip: find unused files, exports and dependencies
pnpm knip:production  # knip --production: also find code that only the tests use
pnpm link --global    # put `rowbly` on your PATH for local testing
```

## Layout

```
src/
  cli.ts              # entry point: builds the Commander program, picks TUI vs CLI
  commands/           # one folder per module: <name>/<name>.ts, and <name>/<name>.test.ts when the module has a test
    register-commands/ # registerCommands(): attaches every subcommand to the program
    output/           # run(): calls a service, prints text or --json, turns RowblyErrors into exit code 1
    test-cli/          # runCli(), createProgram(): run commands in tests
    init/             # the `rowbly init` command: flags and JSON input
    init-wizard/       # askOnboarding(): the @clack/prompts questions of `rowbly init`
    auth/ auth-wizard/ model/ factory/ factory-runner/ thread/ # native factory commands and foreground adapters
    <area>/           # one folder per area: project (project update, project get-instructions), doctor, story, stage, customField, spec, skill
  tui/
    index.tsx         # renderTui(): mounts the Ink app and waits for exit
    app.tsx           # root TUI component: TuiProviders around the Shell
    tui-providers.tsx  # the contexts every shared component reads; wrap the app in it
    shell/            # the frame: Shell, Header, ProjectSwitcher, StoryFinder, HelpModal
    screens/          # stories/ (StoryList, StoryRow, NewStoryModal), stages/ (StageFormModal), onboarding/ (Onboarding and its steps), settings/ (SettingsModal, sections)
    terminal.ts       # runFullScreen(): alternate screen, mouse, kitty keys, terminal restore
    theme.ts          # the design tokens as hex values, and date formatting
    keymap.ts         # KeyHint, global keys, form keys, moveDelta (arrows + j/k)
    mouse.ts          # MouseStdin: takes SGR mouse reports out of stdin before Ink reads it
    components/       # the shared component library: one folder per component (barrel: components/index.ts)
    hooks/            # contexts and hooks: focus, key capture, hints, layout, mouse, toasts, useAsync
    testing/          # renderTui(): renders a component in TuiProviders for tests; keys for stdin
  services/           # one folder per module: <name>/<name>.ts, and <name>/<name>.test.ts when the module has a test
    errors/           # RowblyError, ValidationError, NotFoundError, ConflictError: the typed errors services throw
    workspace/        # findProject(): the nearest .rowbly/ at or above ctx.cwd; hasProject(): a project in ctx.cwd; ServiceContext
    config/           # ProjectConfig types, validation, key rules, read/write of rowbly.config.json
    fields/           # custom field value checks and parsing text input by field type
    markdown/         # YAML frontmatter + body parsing and writing
    story-files/       # raw story file IO shared by the domain services
    spec-files/        # raw spec file IO shared by the domain services
    project/ story/ stage/ custom-field/ spec/ skill/ doctor/   # the domain services
    onboarding/       # planOnboarding(), applyOnboarding(): the setup that the TUI and `rowbly init` share
    pi-runtime/        # lazy Pi imports, session adapter, runtime and model catalog
    agent-auth/        # provider status, model checks, login and logout
    factory-settings/  # optional factory.json and role model choices
    factory/          # daemon client, status, controls and operational logs
    factory-manager/   # serial supervisor loop, tools, reservations and worker lifecycle
    factory-worker/    # independent worker session, result and activity
    factory-ownership/ # daemon ownership and process identity
    factory-control/   # durable commands and receipts
    factory-recovery/  # dead-owner reconciliation and resume eligibility
    factory-policy/ factory-state/ # shared v1 policy and state transactions
    project-write/     # shared kernel flock for canonical factory writes
    runtime-files/     # private runtime paths and ignore rules
    thread/           # metadata, runs, state projection and watches
    conversation/     # read-only selected-file Pi v3 history and bounded pages
    supervisor-digest/ # bounded operational facts without worker transcripts
    worker-worktree/   # one worktree per Story, with existing work preserved
    story-watch/       # watchStories(): calls a function when the files of the stories folder change
    known-project/     # listKnownProjects(), recordProject(), forgetProject(): the projects in ~/.rowblyrc.json
    test-project/      # useTempDir(), useTestProject(): temporary projects for service tests
skills/               # the bundled skills; `rowbly skill install` copies them into a project
stages/               # the default stage prompts; onboarding copies them into a project
biome-plugins/        # GritQL lint plugins for the strict code style (see "Code style" below)
.agents/skills/       # agent skills for developing Rowbly (see "Agent skills" below)
```

## Storage

Rowbly keeps a project in `.rowbly/`, in the directory where Rowbly runs. Services find the nearest
`.rowbly/` at or above `ctx.cwd`. The `-C <dir>` option of the CLI sets this directory. The TUI opens
only a project in the directory where it runs. If that directory has no project, the TUI shows the
onboarding steps, also when a parent directory has a project. Users can
edit these files by hand. `rowbly doctor` compares the files with the config, and `--fix` repairs
the problems that it can repair.

```
.rowbly/
  rowbly.config.json  # projectName, projectKey, customFields [{key,label,type,options?}], stages [{key,label,enabled}], features? {specs}, skills? [{name,harnesses}]
  ROWBLY.md           # optional; the whole file is the instructions for all agents of the project
  stories/ROW-01.md   # <projectKey>-<n>.md; frontmatter: title, stage, position?, one key per custom field (null = unset)
  stages/BACKLOG.md   # <stage key>.md; the whole file is the stage's prompt
  specs/login-page.md # <slug>.md; frontmatter: title, stories (a list of story IDs); the body is the spec
  factory.json        # optional committed settings: version, maxWorkers, supervisorModel, workerModel
  .gitignore          # /state.json* and /runtime/; existing text stays
  state.json          # v1 policy state; native factory or external supervisor writes it
  runtime/            # private, ignored; directories use mode 0700
    factory.lock      # daemon owner: token, PID, host, start time and Linux process identity
    lifecycle.guard   # short exclusive gate for ownership changes
    status.json       # heartbeat, workers, queue, holds, provider pauses and attention
    control/<id>.json # immutable stop, cancel or resume request
    receipts/<id>.json # accepted, completed or rejected command result
    threads/<id>.json # small Thread metadata, with runs and exact session reference
    sessions/<id>/<pi-name>.jsonl # native Pi history; file reference starts as null
    bin/rowbly        # exact-version CLI shim for workers
    logs/<id>.jsonl   # operational logs; no transcript bodies
```

The order of `stages` in the config is the order of the board. The custom field types are `string`,
`number`, `boolean`, `url`, `date` (YYYY-MM-DD) and `select` (with `options`). If a service renames
or removes a stage or a field, it also writes the changes to the stories that use it. This keeps the
files consistent.

The `position` of a story sets its order in its stage. A story without a `position` comes after the
stories that have one, in the order of their numbers. When a story moves, the service writes a new
`position` to each story of the stage that changes place.

`src/services/factory-activity/factory-activity.ts` reads `.rowbly/state.json` and gives the factory
activity of each story. The format is version 1 of the factory skill
(`skills/factory/references/supervisor-policy.md`). The service uses only the attempts of a story in
its current stage:

- No `preparing` or `running` attempt gives no activity.
- One active attempt that is also the last attempt gives the `model` of the attempt, or its `workerId`.
- Two active attempts, or an active attempt before a later attempt, give `conflict`.
- An attempt without `stage`, `workerId` or `status` gives `unknown`.

A problem with the file never stops the load of the project. The service gives a status in place of an
error: `ok`, `missing`, `unavailable` or `incomplete`. An `unavailable` file gives no activity. The TUI
shows the activity as `▶` in the story row, and shows each file problem in one line below the Story
list. A Project without `state.json` shows no status line.
The activity service and the TUI never write `state.json` directly.

### Native runtime, locks and recovery

Existing Projects need no migration of Stories, Stages, Specs or config.
Without `factory.json`, the worker limit is four and Pi selects default models.
Explicit model choices must be available and must support the selected thinking level.
Rowbly does not write global Pi settings. Credentials stay in Pi storage, outside the Project.

Initialization creates `.rowbly/.gitignore`. Native start and `doctor --fix` add missing runtime ignore rules.
Canonical factory commits exclude runtime files, also when Git already tracks them.
Do not commit runtime files or credentials.

The factory uses three locks:

1. `runtime/factory.lock` holds daemon ownership. `lifecycle.guard` serializes owner creation, takeover and release.
   Linux boot ID and process start ticks protect against PID reuse.
   A live, foreign, corrupt or uncertain owner prevents takeover. An old heartbeat does not prove death.
2. `state.json.lock` serializes v1 state transactions and Thread metadata writes.
   The shared scripts preserve unknown v1 keys. Do not hold this lock across model, Git or subprocess work.
3. The Git common directory holds the Project write lock from `commit-project.mjs::lockPath(root)`.
   Native factory writers use util-linux `flock -w 60` for canonical changes and commits.
   Workers use the exact CLI shim under the same lock. There is no unlocked fallback.

Never acquire the Project write lock while the state lock is held.
No kernel lock spans a model request. Existing human CLI and TUI writes retain their previous concurrency limits.
A crash inside a lifecycle guard can leave the guard in place. Do not remove a guard because of its age.

Offline repair must first establish that all relevant factory processes have stopped.

Native execution requires Linux, Git, local files and util-linux `flock`.
The board, metadata and Peek remain separate from native execution prerequisites.
There is no ownership guarantee across hosts, NFS, PID namespaces or copied runtime directories.
Old external skill copies do not honor native ownership. Never run both supervisors together.

Updated external scripts refuse a live or uncertain native owner.
Native start preserves external active attempts. `--adopt-external` marks them interrupted; it does not stop external workers.
Stop external workers before this explicit adoption.

Normal stop aborts Pi sessions and preserves histories and worktrees. A restart waits for stop and ownership release.
After definite owner death, recovery marks active runs interrupted and repairs missing native state projections.
A worker can resume only with a session file and its Story in the original Stage.

The manager also checks policy eligibility and the original worktree. Completed Threads cannot resume.
Each Thread has at most three runs. A retry uses a new Thread.
A cancellation holds the Story and Stage until release, explicit resume or a material Story change.

A later start lets the supervisor select eligible interrupted Threads; it does not resume all Threads automatically.
Shell descendants started by a crashed daemon are not tracked. Normal stop relies on Pi abort for shell children.
Do not assume exactly-once shell effects. Dirty worktrees and malformed runtime files stay on disk.

Doctor reports corrupt and orphan Threads. It does not repair their histories or take over a live daemon.

### Native commands and TUI controls

| Commands                                                                  | Purpose                                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `auth providers`, `auth status`                                           | Show login methods and configured status, without a health check.            |
| `auth login [provider] [--type oauth\|api_key]`, `auth logout <provider>` | Sign in through an interactive prompt, or remove a stored credential.        |
| `model list [--provider <id>]`                                            | Show configured models and supported thinking levels.                        |
| `factory configure`                                                       | Set `--max-workers`, `--supervisor`, `--worker` and the role thinking flags. |
| `factory start [--foreground] [--max-workers <n>] [--adopt-external]`     | Start a detached daemon, or use the foreground path.                         |
| `factory status`, `factory stop`, `factory restart [--adopt-external]`    | Observe or control the native daemon.                                        |
| `factory logs [--tail <n>]`                                               | Read bounded operational logs. There is no follow mode.                      |
| `thread list [--story <id>]`, `thread show <id>`                          | Read active and historical metadata.                                         |
| `thread log <id> [--tail <n>]`                                            | Read a bounded conversation tail: default 20, maximum 100 entries.           |
| `thread cancel <id>`, `thread resume <id>`                                | Send guarded commands to the native daemon.                                  |

CLI login requires a terminal without `--json`. API keys use a masked prompt, never an argument.
Configured models do not prove provider access, quota or credential health.
The Pi SDK loads on demand for authentication, model selection and native execution.
The board, help, doctor, metadata, status and read-only conversation paths do not import Pi runtime values.

`tsup` keeps Pi external. Keep the lazy boundary in `piRuntime` and its import tests.
Peek reads current Pi v3 histories without SDK session creation or file writes.
Unknown formats show a placeholder. Only finalized messages appear; token deltas do not appear.

In the TUI, `f` opens Factory controls. The header shows active and pending counts when space permits.
In Factory controls, `s` starts, `x` requests stop with confirmation, and `enter` opens the supervisor conversation.
The `a` key opens Settings at the AI section. Close the TUI without a stop to leave the daemon active.

The Story Threads tab shows all statuses and a queue note when the Story waits for a worker slot.
Select a Thread to Peek. Use `x` to interrupt with confirmation, or `r` to resume an eligible Thread.
The viewer uses arrows or `j`/`k`, Page Up, Page Down, Home, End and the mouse wheel.

Scroll up to stop follow. Use End or `f` to follow again. Escape returns to the previous view.
Settings has a Factory group with an AI section for providers, role models and the worker limit.
There, Enter signs in, `d` signs out with confirmation, `s`/`w` selects role models, `l` sets the limit, and `r` reloads.

The model picker offers supported thinking levels and `Pi default`. Escape cancels authentication and restores focus.

Older versions of Rowbly wrote an agent lock to the `agentLock` key of a story. Rowbly does not use
this key now. `rowbly doctor` shows a warning for each story file with an `agentLock` key. To remove
the keys, run `rowbly doctor --fix`. The command keeps all other frontmatter and the description.

The `stories` list of a spec holds the links to its stories. If a service deletes a story, it also
removes the story from each spec. A spec that loses its last story stays in `specs/`. `rowbly doctor`
shows a warning for each orphan spec, and for each link to a story that does not exist. `--fix`
removes a link to a story that does not exist. It does not delete an orphan spec.

The `skills` list of the config holds the bundled skills that a project has installed. Each entry
has the `name` of a skill and the `harnesses` that have a copy. `rowbly skill install` copies a folder
from the `skills/` folder of the Rowbly package to the project skills folder of each harness:

| Harness          | Project skills folder |
| ---------------- | --------------------- |
| `claude-code`    | `.claude/skills`      |
| `codex`          | `.agents/skills`      |
| `gemini-cli`     | `.gemini/skills`      |
| `github-copilot` | `.github/skills`      |
| `cursor`         | `.cursor/skills`      |

`rowbly skill list` shows the installed skills. `rowbly skill remove` deletes only the folders that
the config tracks. It keeps a folder that a different tracked harness uses through a symlink, at the
skill or at the skills folder. If the path of the skill is a symlink, it deletes only the link.
`skill install` checks each target before it writes. The command uses the same rule as `skill list` and
`doctor`: a skill is present if its folder has a `SKILL.md`. If other content is at a target, the
command stops and changes nothing. If nothing is at the path of a tracked skill, the command copies it again.

`rowbly doctor` shows an error if a tracked skill is not installed for a harness. `--fix` installs the
skill again if nothing is at its path and the Rowbly package still has the skill. `--fix` does not change a
folder that has no `SKILL.md`, because the folder can contain the work of a user. If a file or a broken
symlink prevents the creation of the skills folder, `doctor` shows an error with the path and offers no fix.

Harnesses can read the same folders. For example, Cursor also reads `.claude/skills` and
`.agents/skills`. A skill can then stay visible to a harness after you remove the skill for that harness.

Keep your changes to a tracked skill in a different place. `rowbly skill remove` deletes the folder and
all local changes in it.

`ROWBLY.md` holds the top-level instructions of a project, as a `CLAUDE.md` or `AGENTS.md` file does.
Initialization creates the file with only `# ROWBLY INSTRUCTIONS` and a final newline.
Existing Projects can omit the file. Rowbly does not parse or enforce its text.
`rowbly project get-instructions` shows the text. A supervisor gives the text to each worker that it starts.

Rowbly also keeps one file for each user, `~/.rowblyrc.json`. The TUI adds a project to this file when
the project opens. The Project switcher in the header reads the list.

```
~/.rowblyrc.json      # projects [{path,name}], with the most recent project first
```

Rowbly v1 uses the same file for its own keys. Keep all other keys when you write the file. If Rowbly
cannot read the file, do not write it. A write would remove the data that the user has in the file.

## Onboarding

Onboarding creates a project. `rowbly` with no project shows the steps on the screen, in the Story panel.
Do not use a Modal for these steps. `rowbly init` asks the same questions through `@clack/prompts`. The
two front ends call `planOnboarding` and `applyOnboarding` in `src/services/onboarding/onboarding.ts`.

The first question is "defaults" or "customize". The defaults go directly to the summary. The steps are:

| Step         | Default                                                  | Customization                                     |
| ------------ | -------------------------------------------------------- | ------------------------------------------------- |
| Name and key | The name of the directory, and the first 3 letters of it | Any valid name and key                            |
| Stages       | All files in `stages/`, in the order of `DEFAULT_STAGES` | Remove other default stages, or add custom stages |
| Agent skills | All folders in `skills/`, for all harnesses              | Select the skills and the harnesses               |

The last step is always a summary. It also tells the user where to edit each item.

- Backlog and Done are always enabled. The user cannot remove them. If flags or JSON leave one out, Rowbly adds it.
- A custom stage gets a placeholder prompt. A default stage gets its file from `stages/`.
- A skill that a selected default stage uses shows `(required)`. The user cannot remove it.
- The `factory` skill also shows `(required)`, because the factory cannot run without it. The user can
  remove it. Then the summary and the output of `rowbly init` show a warning.
- The custom fields of the skills (`worktree`, `pull_request`) are added with the skills that use them.
- If a skill install fails, `applyOnboarding` removes the new project and the skills that it installed.

`rowbly init` asks questions only in a terminal, with no choice flags and no `--json`. Otherwise it
uses the flags, the `--input` JSON and the defaults, in this priority. The `--input` value is inline JSON,
a file path, or `-` for stdin. The JSON keys are `name`, `key`, `stages`, `skills` and `harnesses`.

The prompts in `.rowbly/stages/` of this repository are the prompts of the Rowbly project itself. The
default prompts for new projects are in `stages/`. A change to one does not change the other.

## Bundled skills

The skills in `skills/` are a part of the product: `factory`, `refine`, `develop` and `review`.
`rowbly skill install` copies them into a project. The default stage prompts in `stages/` use them.

The folders `.agents/skills/<name>` and `.claude/skills/<name>` of this repository are installed copies.
After a change in `skills/<name>/`, copy the folder to the two installed copies.
A test in `pnpm test:factory` compares the `factory` copies with the bundled files.

The factory runs with no person present, and agents with small models can run it.
Obey these rules when you change a bundled skill or a file in `stages/`:

- Do not add a step that asks a person a question or that waits for a person.
- Do not add a condition that stops the factory because of one story, one stage, one worker or one check.
- Give each problem an action that lets the work continue: a fallback, a new worker or a record in the story.
- Put each rule that has no judgement in a script of `skills/factory/scripts/`, not in the text of a skill.
- Give the exact command line for each step of a skill.

| File in `skills/factory/`       | Function                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `scripts/factory.mjs`           | The tool of the supervisor. Each command prints the next actions as JSON.           |
| `scripts/supervisor-policy.mjs` | The assignment rules: new workers, delays, the limit of workers and parked stories. |
| `scripts/factory-state.mjs`     | Reads and replaces `.rowbly/state.json`.                                            |
| `scripts/commit-project.mjs`    | Commits the changed files of `.rowbly/` under the shared write lock.                |
| `references/worker-message.md`  | The template of the first message that each worker gets.                            |

## Architecture: one service layer, two front ends

The CLI and the TUI are **thin front ends**. The services in `src/services/` do all of the real work.
The two front ends call the same service functions.

```
 rowbly story create --name foobar          TUI "Create story" screen
              │                                       │
   src/commands/story/story.ts             src/tui/screens/create-story.tsx
              │                                       │
              └────────► src/services/story/story.ts ◄┘
                                createStory({ name })
```

For example, a user can run `rowbly story create --name foobar`, or create the same story in the TUI.
The two paths must both call the same `createStory` service. A front end must not contain logic of
its own to create a story.

### Rules for services

- **Plain TypeScript, no UI.** Do not import `commander`, `ink` or `react` in a service. A service
  must not read `process.argv`, write to stdout or stderr, prompt the user or call `process.exit`.
  It takes typed inputs and gives typed results.
- **Throw typed errors.** For an expected failure (not found, validation and others), throw an error.
  Do not print a message. Use a subclass of `RowblyError` from `src/services/errors/errors.ts`, with an
  optional `hint`. Each front end shows the errors in its own way. The CLI prints a message and sets
  an exit code. The TUI shows a toast with the hint. If a `ValidationError` has `details.issues`
  (`{ path: [field], message }`), a TUI `Form` shows each message below its field.
- **One module per domain.** For example, use `src/services/story/story.ts` and `src/services/board/board.ts`.
  Put each module and its test in a folder that has the name of the module.
  Each module exports functions such as `createStory` and `listStories`. Export the input and output
  types with the functions, so that the two front ends use the same types.
- **Inject dependencies** if this makes tests easier. For example, inject file system paths or the
  clock. Do not use globals for them.
- **Async by default.** Return a `Promise`. Then the callers do not change if an implementation
  starts to do I/O.

## Code style

**Read `.agents/skills/rowbly-code-style/SKILL.md` before you write or change TypeScript in `src/`.**
`src/services/factory-manager/` is the reference implementation of the style. The rules in short:

- Put each function at the top level. A callback argument can stay inline.
- Do not change an object, an array, a Map or a Set. Make a new value.
- Use `const`, not `let`. Do not assign to a parameter or a property.
- Put shared state that changes in a `Store`, and read it again after each `await`.
- Use `{` and `}` for each `if`, `else`, `for` and `while`.
- Put the declarations at the top of a function, in groups. Put a blank line between groups.
- Give each file one concern. A module folder can have many files.

The strict override in `biome.json` enforces part of the style. It uses Biome rules and the GritQL
plugins in `biome-plugins/`. It applies only to the folders in its `includes` list.
Write all new modules in the strict style. To move a folder to the style, follow the skill.

### Add a CLI command

1. Write or extend the service in `src/services/`.
2. Create `src/commands/<command>/<command>.ts`. Export a function that registers the action on its resource command:

   ```ts
   import type { Command } from "commander";
   import { createStory } from "../../services/story/story.js";

   export function registerCreateStory(story: Command): void {
     story
       .command("create")
       .description("Create a new story")
       .requiredOption("--title <title>", "story title")
       .action(async (opts: { title: string }) => {
         const story = await createStory({ title: opts.title });
         console.log(`Created ${story.id}`);
       });
   }
   ```

3. Pass the resource command to this function from `registerCommands` in `src/commands/register-commands/register-commands.ts`.

The command file only changes flags into service input and formats the service output. Commander
gives `--help` for each subcommand automatically.

### Add a TUI feature

Put screens and components in `src/tui/`. Call the same service functions from them, for example in
an event handler or in an effect. `useAsync` records the loading, error and data states, and shows a
toast if a call fails. Keep the loading, error and result states in the component. If a CLI command
also uses a part of the logic, put that logic in the service, not in the component.

For a change that comes from outside the TUI, use `refresh` from `useAsync`. It does not show a loading
state or a toast.

## TUI design system and component library

The TUI has a design language from Rowbly v1. **Read `.agents/skills/rowbly-tui-design/SKILL.md`
before you build or change TUI code.** The skill contains:

- The tokens (`tokens.json`) and the principles.
- One guideline for each component (`components/*.md`).
- HTML previews (`previews/*.html`).
- Instructions for the library: providers, focus, key capture, key hints, layout, Modals and the
  mouse.

The rules:

- **Build from the library.** `src/tui/components/` has Panel, Button, Modal, Form, SelectList,
  TextInput, TextArea, Tabs, Sidebar, Toasts, KeyHints, MarkdownView and more. Use
  these components before you write a new component. Extend a component. Do not make a fork of it.
- **Tokens only.** Each colour comes from `theme` in `src/tui/theme.ts`. Do not write a hex value or
  an Ink colour name in a component. Do not use the `dimColor` of Ink. Use `theme.inkFaint`.
- **Focus is the only accent.** Only one region has the focus at a time. Its frame is `accent`, and
  all other frames are `border`. Gate each `useInput` on `useIsActive()`.
- **Each action has a key, and the key is visible.** Each control that you can click also has a key.
  Each screen declares its keys with `useKeyHints`. On each screen that can create a record, `n`
  creates the record and shows a `new …` hint.
- **The v1 screens are patterns, not code.** We did not port the Board, Story and Settings screens.
  Their guidelines (`StoryCard`, `StageColumn`, `StoryModal`, `SettingsModal`, `Header`, `ListRow`)
  show how v1 used the library. Adapt them. The new UI can be different where the user asks for it.

### TUI code organization (`src/tui/`)

- **One component per file.** Put each React component in its own `PascalCase.tsx` file, with the
  name of the component. Do not add a new component to a file that exists. A small private helper
  (a constant or a pure function) can stay in the file of the only component that uses it.
- **One folder per component in `components/`.** Put each component in its own folder, with its test
  and an `index.ts` that exports it:

  ```
  components/button/
    button.tsx
    button.test.tsx
    index.ts          # export * from "./button.js";
  ```

  A component imports a different component through the folder (`'../button/index.js'`). Add each
  component folder to `components/index.ts`. The `camelCase.ts` helpers stay in `components/`, with
  their tests next to them.
- **Group by area, with a barrel.** Each folder has an `index.ts` that exports the items that the
  other parts of the app use. Import from the folder (`'../components/index.js'`). Do not import from
  the files in a different folder.
  - `components/`: reusable UI parts.
  - `shell/`: the frame of the app, when we build it. This is the shell, the header, the sidebars, the
    footer and the overlays.
  - `screens/<area>/`: the screens and their screen-specific parts. Register them in the `index.ts`
    of the area.
  - `hooks/`: contexts and hooks.
- **Keep `app.tsx` thin.** It only puts the providers (`TuiProviders`) around the shell.
- Put each pure helper or constant that more than one file uses in its own `camelCase.ts` file, for
  example `components/shell-layout.ts`.

## Tests

Vitest runs the tests. The tests are in `*.test.ts` and `*.test.tsx` files, next to the file that
they test. A component test is in the folder of its component.

- **Each component has a test.** When you add a component, add `<Name>.test.tsx` in the same folder.
  When you change a component, update its test.
- **Render through `renderTui`.** `renderTui` from `src/tui/testing/` renders a component in
  `TuiProviders`, through ink-testing-library. Use `press` and `keys` to send keys, `click` and
  `mouse` to send mouse events, and `frame` to read the screen without colours.
- **Test the behaviour.** Examine the text, the keys and the mouse actions. Do not examine the
  colours.
- Call `cleanup` from ink-testing-library in `afterEach`.
- **Each service has a test.** Use `useTestProject()` or `useTempDir()` from `src/services/test-project/test-project.ts`.
  They give each test a new project in a temporary directory.

Native session tests use Pi's faux provider and in-memory credentials. They make no live provider requests.
Daemon tests use private HOME and Pi agent directories, temporary Git Projects and a loader that blocks network access.

Keep live credentials out of tests. Do not add a production faux-provider flag.
Scripted authentication tests do not prove real OAuth login, provider entitlement or token refresh.
Live provider validation is separate from the automated checks.

The tests of `skills/factory/scripts/` are separate from the Vitest tests. They use `node:test`. Run them with
`pnpm test:factory`. The lint job of CI also runs them.

## Screenshots

Use agentic-tui (`pnpm exec agentic-tui`, a devDependency) for all screenshots of Rowbly. Also use
it to examine each change to the TUI layout in a real terminal. Follow
`.agents/skills/rowbly-screenshots/SKILL.md`. The full reference for the tool is
`.agents/skills/agentic-tui/SKILL.md`. Do not draw screens by hand. Do not commit screenshots.

## Agent skills

The skills for the development of Rowbly are in `.agents/skills/<name>/SKILL.md`. For Claude Code,
`.claude/skills/<name>` links to them.

| Skill                | Use it for                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `rowbly-tui-design`  | All TUI screens, components, modals, forms, lists, colours, borders and key hints        |
| `rowbly-screenshots` | Screenshots and real-terminal checks of the TUI or the CLI                               |
| `rowbly-code-style`  | The TypeScript style: top-level functions, immutable state, layout and files             |
| `agentic-tui`        | The PTY tool. This is an unchanged copy from `@codebolt/agentic-tui` (see `UPSTREAM.md`) |

## Conventions

- Use `.js` extensions in relative imports (`./tui/index.js`), also for `.ts` and `.tsx` sources.
  The NodeNext ESM resolution makes this necessary.
- `--version` reads the version from `package.json`. Change the version only in that file.
- Keep `src/cli.ts` small. It only connects the parts.
- Biome sets the format: double quotes, semicolons, 2-space indent and 120 columns. Do not format by
  hand. Run `pnpm lint:fix`.
- When the user tells you about a lint problem that Biome can find, do these steps:
  1. Repair the problem.
  2. Add a Biome rule to `biome.json` that finds the same problem. Then `pnpm lint` stops the problem
     in the future.
  3. Run `pnpm lint` and repair all other code that the new rule finds.

  If Biome has no rule for the problem, write a GritQL plugin in `biome-plugins/`, if the problem
  has a pattern in the syntax. If a plugin cannot find the problem, repair it and tell the user.
  A rule of the strict code style goes into the strict override. Repair only the folders in its list.
- Write all documentation in STE. See "Documentation language: ASD-STE100".
- Before you complete a change, run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
  If you change a script in `skills/factory/scripts/`, also run `pnpm test:factory`.

## Documentation language: ASD-STE100

Write all documentation in ASD-STE100 Simplified Technical English (STE). This rule applies to
`AGENTS.md`, to all files in `.agents/skills/` and to all other Markdown documents in this
repository. It applies to new text and to changes in old text.

The STE rules apply to prose. Do not change code blocks, commands, file paths, identifiers, key names
or text that the UI shows.

Exception: `.agents/skills/agentic-tui/SKILL.md` is a copy of an upstream file. Do not change it. Its
`UPSTREAM.md` is our file, and the STE rules apply to it.

### Words

- Use only the words in the STE dictionary, and use each word only with its approved meaning.
- Use one word for one meaning. If you use "stage" for a concept, do not also call it "column" or
  "step".
- You can use technical names and technical verbs. Technical names include file names, commands,
  flags, components, keys and the domain concepts (Project, Story, Stage). Technical verbs include
  "run", "build", "render", "commit" and "push".
- Use the approved word, not the unapproved word:

  | Do not use       | Use                                 |
  | ---------------- | ----------------------------------- |
  | should, shall    | must, or a command                  |
  | may, might       | can                                 |
  | ensure           | make sure                           |
  | need, require    | must, or "it is necessary"          |
  | allow            | let, or can                         |
  | avoid            | do not use, or prevent              |
  | via              | through                             |
  | e.g., i.e., etc. | for example, that is, the full list |

### Sentences

- A procedural sentence (an instruction) has a maximum of 20 words. A descriptive sentence has a
  maximum of 25 words.
- Write one instruction in each sentence.
- Write instructions as commands: "Run `pnpm lint`", not "You should run `pnpm lint`".
- Use the active voice. Use the passive voice only in descriptive text, and only when it is necessary.
- Use only the simple tenses: present, past and future.
- Do not use the "-ing" form of a verb, except in a technical name.
- Do not leave out words such as "the", "a" or verbs to make a sentence shorter. Headings, table
  cells and list labels can be short phrases.
- Do not use a noun cluster of more than three words. A technical name is not a noun cluster.
- Use a vertical list for a sequence of steps or for three or more items.

### Paragraphs and warnings

- Write about one topic in each paragraph. Start with the topic sentence.
- A paragraph has a maximum of six sentences.
- Start a warning with a command. Then give the reason in a second sentence.

## Commits

When a turn changes files, commit the changes before you give control back to the user.

- Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<optional scope>): <summary>`.
  For example, `feat(story): add story create command` or `fix(tui): keep focus after closing a modal`.
  The usual types are `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build` and `ci`. Mark a
  breaking change with `!` (`feat!: …`) or with a `BREAKING CHANGE:` footer.
- Keep the summary short. Write it in the imperative and in lower case, with no period at the end.
  Add a body if the reason for the change is not clear from the summary.
- Commit only the changes that you made in that turn. Stage each file by its name. Do not use
  `git add -A`.
- Do the checks in "Conventions" first. If they fail and you cannot repair the problem, tell the
  user. Do not commit code that does not work.
- Do not push, amend or rewrite the history if the user does not tell you to do it.
