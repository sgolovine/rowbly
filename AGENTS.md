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

Rowbly has four concepts. Use these names in code, services, commands and UI text.

```
Project ── configuration: custom field definitions, stages (each with an optional prompt)
  └── Story ── custom field values, exactly one stage
        └── Spec ── a Markdown document, linked to one or more stories
```

- **Project.** The project is the top-level concept. Rowbly keeps all of its data in a project. Data
  at the "top level" is data at the project level. Each project has a configuration that sets how
  the project operates. The configuration contains the custom fields and the stages of the project.
- **Story.** A project contains stories. You define each custom field one time, at the project level.
  The field then applies to all stories in that project, and each story has its own values for it.
  Each story is in a stage.
- **Stage.** You define stages at the project level, and they apply to all stories of the project.
  Each story in a project **must** have a stage. Each new project has two default stages, **Backlog**
  and **Done**. Users can add more stages. Each stage can have a prompt. The prompt tells agents what
  to do with a story while the story is in that stage.
- **Agent lock.** An agent lock records that an agent works on a story. A story has a maximum of one
  lock. The lock applies only while the story stays in the stage where the agent took the lock. A lock
  is a record of work and does not give mutual exclusion, because two writers can race and separate
  checkouts do not share files.
- **Spec.** A spec is a Markdown document that describes the work of a story. A spec must have a link
  to at least one story, and a story can have many specs. Specs are an optional feature. Each project
  starts with specs off. Turn them on in the Specs section of Settings or with
  `rowbly update-project --specs on`. When specs are on, an open story has a General tab and a Specs tab.

## Stack

- **TypeScript** (ESM, `"type": "module"`), Node >= 22
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
    registerCommands/ # registerCommands(): attaches every subcommand to the program
    output/           # run(): calls a service, prints text or --json, turns RowblyErrors into exit code 1
    testCli/          # runCli(), createProgram(): run commands in tests
    <area>/           # one folder per area: project (init, update-project, get-instructions), doctor, story, stage, customField, spec
  tui/
    index.tsx         # renderTui(): mounts the Ink app and waits for exit
    App.tsx           # root TUI component: TuiProviders around the Shell
    TuiProviders.tsx  # the contexts every shared component reads; wrap the app in it
    shell/            # the frame: Shell, Header, ProjectSwitcher, StoryFinder, HelpModal
    screens/          # stories/ (StoryList, StoryRow, NewStoryModal), stages/ (StageFormModal), projects/ (NewProjectModal), settings/ (SettingsModal, sections)
    terminal.ts       # runFullScreen(): alternate screen, mouse, kitty keys, terminal restore
    theme.ts          # the design tokens as hex values, and date formatting
    keymap.ts         # KeyHint, global keys, form keys, moveDelta (arrows + j/k)
    mouse.ts          # MouseStdin: takes SGR mouse reports out of stdin before Ink reads it
    components/       # the shared component library: one folder per component (barrel: components/index.ts)
    hooks/            # contexts and hooks: focus, key capture, hints, layout, mouse, toasts, useAsync
    testing/          # renderTui(): renders a component in TuiProviders for tests; keys for stdin
  services/           # one folder per module: <name>/<name>.ts, and <name>/<name>.test.ts when the module has a test
    errors/           # RowblyError, ValidationError, NotFoundError, ConflictError: the typed errors services throw
    workspace/        # findProject(): the nearest .rowbly/ at or above ctx.cwd; ServiceContext
    config/           # ProjectConfig types, validation, key rules, read/write of rowbly.config.json
    fields/           # custom field value checks and parsing text input by field type
    markdown/         # YAML frontmatter + body parsing and writing
    storyFiles/       # raw story file IO shared by the domain services
    specFiles/        # raw spec file IO shared by the domain services
    project/ story/ stage/ customField/ spec/ doctor/   # the domain services
    storyWatch/       # watchStories(): calls a function when the files of the stories folder change
    knownProject/     # listKnownProjects(), recordProject(): the projects in ~/.rowblyrc.json
    testProject/      # useTempDir(), useTestProject(): temporary projects for service tests
.agents/skills/       # agent skills for developing Rowbly (see "Agent skills" below)
```

## Storage

Rowbly keeps a project in `.rowbly/`, in the directory where Rowbly runs. Services find the nearest
`.rowbly/` at or above `ctx.cwd`. The `-C <dir>` option of the CLI sets this directory. Users can
edit these files by hand. `rowbly doctor` compares the files with the config, and `--fix` repairs
the problems that it can repair.

```
.rowbly/
  rowbly.config.json  # projectName, projectKey, customFields [{key,label,type,options?}], stages [{key,label,enabled}], features? {specs}
  ROWBLY.md           # optional; the whole file is the instructions for all agents of the project
  stories/ROW-01.md   # <projectKey>-<n>.md; frontmatter: title, stage, position?, one key per custom field (null = unset), agentLock?
  stages/BACKLOG.md   # <stage key>.md; the whole file is the stage's prompt
  specs/login-page.md # <slug>.md; frontmatter: title, stories (a list of story IDs); the body is the spec
```

The order of `stages` in the config is the order of the board. The custom field types are `string`,
`number`, `boolean`, `url`, `date` (YYYY-MM-DD) and `select` (with `options`). If a service renames
or removes a stage or a field, it also writes the changes to the stories that use it. This keeps the
files consistent.

The `position` of a story sets its order in its stage. A story without a `position` comes after the
stories that have one, in the order of their numbers. When a story moves, the service writes a new
`position` to each story of the stage that changes place.

The `agentLock` key of a story holds the lock of an agent: `agent`, `stage` and `lockedAt` (ISO-8601).
`rowbly lock-story` and `rowbly unlock-story` write the key. If a different agent holds the lock,
`lock-story` stops with an error. A change of the story's stage removes the key, and a rename of the
stage key keeps the lock. Rowbly ignores a lock if its `stage` is not the stage of the story.
`rowbly doctor` shows an error for a malformed lock and a warning for a stale lock, and `--fix` removes
only the stale lock.

The `stories` list of a spec holds the links to its stories. If a service deletes a story, it also
removes the story from each spec. A spec that loses its last story stays in `specs/`. `rowbly doctor`
shows a warning for each orphan spec, and for each link to a story that does not exist. `--fix`
removes a link to a story that does not exist. It does not delete an orphan spec.

`ROWBLY.md` holds the top-level instructions of a project, as a `CLAUDE.md` or `AGENTS.md` file does.
Rowbly does not create, parse or enforce it. `rowbly get-instructions` shows the text. A supervisor
gives the text to each worker that it starts.

Rowbly also keeps one file for each user, `~/.rowblyrc.json`. The TUI adds a project to this file when
the project opens. The Project switcher in the header reads the list.

```
~/.rowblyrc.json      # projects [{path,name}], with the most recent project first
```

Rowbly v1 uses the same file for its own keys. Keep all other keys when you write the file. If Rowbly
cannot read the file, do not write it. A write would remove the data that the user has in the file.

## Architecture: one service layer, two front ends

The CLI and the TUI are **thin front ends**. The services in `src/services/` do all of the real work.
The two front ends call the same service functions.

```
 rowbly create-story --name foobar          TUI "Create story" screen
              │                                       │
   src/commands/story/story.ts             src/tui/screens/CreateStory.tsx
              │                                       │
              └────────► src/services/story/story.ts ◄┘
                                createStory({ name })
```

For example, a user can run `rowbly create-story --name foobar`, or create the same story in the TUI.
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

### Add a CLI command

1. Write or extend the service in `src/services/`.
2. Create `src/commands/<command>/<command>.ts`. Export a function from it that registers the subcommand:

   ```ts
   import type { Command } from "commander";
   import { createStory } from "../../services/story/story.js";

   export function registerCreateStory(program: Command): void {
     program
       .command("create-story")
       .description("Create a new story")
       .requiredOption("--name <name>", "story name")
       .action(async (opts: { name: string }) => {
         const story = await createStory({ name: opts.name });
         console.log(`Created ${story.name}`);
       });
   }
   ```

3. Call the function from `registerCommands` in `src/commands/registerCommands/registerCommands.ts`.

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
  components/Button/
    Button.tsx
    Button.test.tsx
    index.ts          # export * from "./Button.js";
  ```

  A component imports a different component through the folder (`'../Button/index.js'`). Add each
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
- **Keep `App.tsx` thin.** It only puts the providers (`TuiProviders`) around the shell.
- Put each pure helper or constant that more than one file uses in its own `camelCase.ts` file, for
  example `components/shellLayout.ts`.

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
- **Each service has a test.** Use `useTestProject()` or `useTempDir()` from `src/services/testProject/testProject.ts`.
  They give each test a new project in a temporary directory.

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

  If Biome has no rule for the problem, repair the problem and tell the user.
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
  For example, `feat(story): add create-story command` or `fix(tui): keep focus after closing a modal`.
  The usual types are `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build` and `ci`. Mark a
  breaking change with `!` (`feat!: …`) or with a `BREAKING CHANGE:` footer.
- Keep the summary short. Write it in the imperative and in lower case, with no period at the end.
  Add a body if the reason for the change is not clear from the summary.
- Commit only the changes that you made in that turn. Stage each file by its name. Do not use
  `git add -A`.
- Do the checks in "Conventions" first. If they fail and you cannot repair the problem, tell the
  user. Do not commit code that does not work.
- Do not push, amend or rewrite the history if the user does not tell you to do it.
