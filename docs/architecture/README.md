# Rowbly architecture

This folder describes how Rowbly works. This page gives a one-screen overview and a map of the other
pages. Read this page first. Then read only the page that is necessary for your task.

## The system

Rowbly is one executable, `rowbly`. `src/cli.ts` selects one of two front ends. Both front ends call
the same service layer. The services read and write files in `.rowbly/`. The native factory is a
separate daemon process that uses the same services and the Pi SDK.

```
             rowbly                         rowbly <command> [--flag value…]
               │                                         │
      src/tui/  (Ink TUI)                     src/commands/  (Commander CLI)
               │                                         │
               └──────────────►  src/services/  ◄────────┘
                                    │        │
                    .rowbly/ files ◄┘        └► native factory daemon
                    (Stories, Stages,            (Pi supervisor and workers,
                     Specs, prompts, config)      .rowbly/runtime/, state.json)
```

| Command                            | Mode | Result                                          |
| ---------------------------------- | ---- | ----------------------------------------------- |
| `rowbly`                           | TUI  | Starts the interactive terminal UI (React Ink). |
| `rowbly <command> [--flag value…]` | CLI  | Runs one command and stops (Commander.js).      |
| `rowbly --help` / `rowbly -h`      | CLI  | Shows the usage text.                           |
| `rowbly --version` / `rowbly -v`   | CLI  | Shows the version from `package.json`.          |

## The main concepts

- **Project**: the top-level container, with a config of custom fields and Stages.
- **Story**: one work item, with custom field values and exactly one Stage.
- **Stage**: a step of the board, with an optional prompt for agents.
- **Spec**: an optional Markdown document, linked to one or more Stories.
- **Factory**: the native daemon that runs a Pi supervisor and Pi workers on Stories.
- **Thread**: the metadata and history of one Pi session.

See [domain-concepts.md](domain-concepts.md) for the full definitions.

## Stack

- **TypeScript** (ESM, `"type": "module"`), Node >= 22.19.0.
- **Pi** (`@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`), pinned to 1.5.2. Pi supplies
  sessions, authentication and models.
- **Commander.js** parses the arguments. `@clack/prompts` asks the questions of `rowbly init` and
  `rowbly auth login`.
- **Ink** and **React** draw the TUI. `marked`, `marked-terminal`, `wrap-ansi` and `chalk` render
  Markdown in the TUI.
- **Zod** defines the parameter schemas of the Pi tools.
- **gray-matter** and **yaml** parse and write the frontmatter of Story and Spec files.
- **@mariozechner/clipboard** reads PNG images from the clipboard (with `wl-paste` on Wayland).
- **Vitest** and **ink-testing-library** (dev) run the tests.
- **tsup** bundles the CLI. **tsx** runs the source during development.
- **Biome** lints and formats. **Knip** (dev) finds dead code. **agentic-tui** (dev) runs the CLI in a
  PTY for screenshots.
- **pnpm** is the package manager.

## Map of the pages

| Page                                                 | Read it when …                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| [domain-concepts.md](domain-concepts.md)             | You must know what a Project, Story, Stage, Spec, Factory or Thread is.         |
| [storage.md](storage.md)                             | You read or write a file in `.rowbly/` or `~/.rowblyrc.json`, or change doctor. |
| [service-layer.md](service-layer.md)                 | You add or change a service, an error or a module in `src/services/`.           |
| [cli.md](cli.md)                                     | You add or change a CLI command.                                                |
| [tui.md](tui.md)                                     | You add or change a TUI screen, component or hook.                              |
| [native-factory/README.md](native-factory/README.md) | You work on the daemon, locks, recovery, Threads, Pi, auth or models.           |
| [prompts.md](prompts.md)                             | You change a prompt, the `prompt` commands or the message of a factory agent.   |
| [onboarding.md](onboarding.md)                       | You change `rowbly init` or the onboarding steps of the TUI.                    |
| [skills-and-stages.md](skills-and-stages.md)         | You change a bundled skill, a stage prompt or the `skill` commands.             |
| [testing.md](testing.md)                             | You write or change a test.                                                     |
| [tooling.md](tooling.md)                             | You change a script, the lint setup, the build or CI.                           |

The process rules for contributors are in [../contributing/](../contributing/README.md).

## Related

- [AGENTS.md](../../AGENTS.md): the rules for each task.
- [README.md](../../README.md): the user guide.
