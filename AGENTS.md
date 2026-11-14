# AGENTS.md

Instructions for agents and contributors who work on Rowbly. This file is small on purpose. It gives
the rules for each task and tells you where to read more. Read only the pages that are necessary for your task.

## What Rowbly is

Rowbly is one executable, `rowbly`. It keeps a Kanban board of Stories in Markdown and JSON files in
`.rowbly/`. `rowbly` with no arguments starts the interactive TUI (React Ink). `rowbly <command>`
runs one CLI command (Commander.js) and stops. A native factory runs Pi agents on the Stories in a
separate daemon. Start with [docs/architecture/README.md](docs/architecture/README.md) for the full
picture.

## Rules for each task

1. **Services do the work. Front ends stay thin.** The CLI (`src/commands/`) and the TUI (`src/tui/`)
   call the same functions in `src/services/`. Do not put domain logic in a command or a component.
   A service does not import `commander`, `ink` or `react`, and it does not print, prompt or exit.
   See [the service layer](docs/architecture/service-layer.md).
2. **Code style.** Read [`.agents/skills/rowbly-code-style/SKILL.md`](.agents/skills/rowbly-code-style/SKILL.md)
   before you write or change TypeScript in `src/`. The strict style applies to all non-test
   TypeScript in `src/`. All files and folders use dash-case names.
3. **TUI design.** Read [`.agents/skills/rowbly-tui-design/SKILL.md`](.agents/skills/rowbly-tui-design/SKILL.md)
   before you build or change TUI code. Build from `src/tui/components/`. Use only the colours in
   `theme`.
4. **Tests.** Each service and each component has a test next to it. Update the test when you change
   the code. See [testing](docs/architecture/testing.md).
5. **Imports.** Use `.js` extensions in relative imports, also for `.ts` and `.tsx` sources.
6. **Documentation language.** Write all Markdown in ASD-STE100 Simplified Technical English (STE).
   See [the STE rules](docs/contributing/documentation-language.md).

## Safety rules

Obey these rules. If you do not obey them, you can cause damage to user data or to a live factory.

- Never run the native factory and an old copy of the external `factory` skill together.
  They both write `.rowbly/state.json` and start workers.
- Do not commit `.rowbly/state.json*`, `.rowbly/runtime/` or credentials.
  Runtime files hold private sessions and process identity.
- Never take the Project write lock while you hold the state lock. This order prevents a deadlock.
- Do not remove a `lifecycle.guard` because of its age. Stop all factory processes before offline repair.
- Do not write `~/.rowblyrc.json` if Rowbly cannot read it. A write can delete the data of the user.
  Keep all other keys when you write the file.
- Keep the Pi SDK behind the lazy boundary in `src/services/pi-runtime/`.
  The board, help, doctor, status and history paths must not load Pi.
- Keep live credentials out of tests. Do not add a production faux-provider flag.
- Do not read or import a file in `skills/` from the code in `src/`. The bundled skills are for users only.
- After a change to `skills/rowbly-reference.md`, copy it to each `skills/<name>/references/rowbly-reference.md`.
- Do not change `.agents/skills/agentic-tui/`. It is an unchanged copy of an upstream skill.

## Checks before you complete a change

Run all of these commands. Do not commit code that fails them.

```sh
pnpm lint        # Biome, the strict style and the dash-case name check
pnpm typecheck
pnpm test        # Vitest, then the node:test suite of scripts/
pnpm build
```

If a check fails and you cannot repair the problem, tell the user.

## Prompts

The factory agents get prompts at two levels. See [prompts.md](docs/architecture/prompts.md) for the full rules.

- **System prompts** are in `src/config/prompts/` of the package: `SYSTEM.md` (the supervisor and all
  workers), `SUPERVISOR.md` (the supervisor only) and `WORKER.md` (all workers). Users cannot change them.
- **User prompts** are in `.rowbly/prompts/` of each Project, with the same three file names. They are
  the Project prompt, the Supervisor prompt and the Worker prompt.
- **Stage prompts** are in `.rowbly/stages/<KEY>.md`. Only the workers of that Stage get them.
- **Priority.** The system prompts come first. A user prompt cannot remove a system rule. Then the
  Stage prompt, the Supervisor or Worker prompt, and the Project prompt follow, in this order.
- `src/services/messages/messages.ts` is the only place that builds the messages of the factory agents.
  Do not build a message in a different module.
- Never assume that a user prompt exists. A missing file has no text. `rowbly doctor` shows a warning
  for each missing user prompt, and `--fix` creates an empty file.

## Commits

When a turn changes files, commit the changes before you give control back to the user.

- Use Conventional Commits, for example `fix(tui): keep focus after closing a modal`.
- Stage each file by its name. Do not use `git add -A`. Commit only the changes of your turn.
- Do not push, amend or rewrite the history if the user does not tell you to do it.

See [commit rules](docs/contributing/commits.md) for the full rules.

## Where to read more

| If your task is about …                                      | Read                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| An overview of the system, or you do not know where to start | [docs/architecture/README.md](docs/architecture/README.md)               |
| Project, Story, Stage, Spec, Factory or Thread               | [domain-concepts.md](docs/architecture/domain-concepts.md)               |
| Files in `.rowbly/`, config, positions, attachments, doctor  | [storage.md](docs/architecture/storage.md)                               |
| A prompt, `rowbly prompt` or the message of a factory agent  | [prompts.md](docs/architecture/prompts.md)                               |
| A new or changed service, errors, `ServiceContext`           | [service-layer.md](docs/architecture/service-layer.md)                   |
| A CLI command, flags, `--json` or exit codes                 | [cli.md](docs/architecture/cli.md)                                       |
| A TUI screen, component, hook, keys or mouse                 | [tui.md](docs/architecture/tui.md) and the `rowbly-tui-design` skill     |
| The native factory, daemon, locks, recovery, Threads, Pi     | [native-factory/README.md](docs/architecture/native-factory/README.md)   |
| `rowbly init` or the onboarding steps of the TUI             | [onboarding.md](docs/architecture/onboarding.md)                         |
| A bundled skill in `skills/` or a stage prompt in `stages/`  | [skills-and-stages.md](docs/architecture/skills-and-stages.md)           |
| Tests, `renderTui`, `useTestProject`, faux provider          | [testing.md](docs/architecture/testing.md)                               |
| Scripts, Biome, Knip, tsup, CI                               | [tooling.md](docs/architecture/tooling.md)                               |
| Screenshots or a check of the TUI in a real terminal         | [`rowbly-screenshots` skill](.agents/skills/rowbly-screenshots/SKILL.md) |
| TypeScript style, `Store`, React handler patterns            | [`rowbly-code-style` skill](.agents/skills/rowbly-code-style/SKILL.md)   |
| A lint problem that a user reports                           | [lint-rules.md](docs/contributing/lint-rules.md)                         |
| Documentation text                                           | [documentation-language.md](docs/contributing/documentation-language.md) |
