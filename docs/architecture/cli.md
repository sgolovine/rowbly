# CLI

The CLI is one of the two thin front ends of Rowbly. Commander.js parses the arguments, and each
command calls a service. The `output` module prints the result as text or as JSON and turns a
`RowblyError` into exit code 1.

Read this when you add or change a CLI command, a flag, the text or JSON output, or an exit code.

## Mode selection

`src/cli.ts` is the entry point. It builds the Commander program and selects the mode:

- With no arguments, it starts the TUI through `renderTui()`. It gives the TUI the Node executable,
  the Node flags and the entry file. The Factory controls use them to start the daemon.
- With arguments, Commander parses them and runs one command.

Keep `src/cli.ts` small. It only connects the parts. `--version` (`-v`) reads the version from
`package.json`. Change the version only in that file.

## Layout of `src/commands/`

Each command module is a folder: `<name>/<name>.ts`, and `<name>/<name>.test.ts` when the module has a
test.

| Folder                                                 | Function                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `register-commands/`                                   | `registerCommands()`: adds the global options and attaches each command.         |
| `output/`                                              | `run()`, `collect()`, `parseFieldFlags()`, `parsePosition()`, `formatValue()`.   |
| `test-cli/`                                            | `runCli()`, `createProgram()`: run commands in tests.                            |
| `init/`                                                | The `rowbly init` command: flags and JSON input.                                 |
| `init-wizard/`                                         | `askOnboarding()`: the `@clack/prompts` questions of `rowbly init`.              |
| `project/`                                             | `project update`, `project get-instructions`.                                    |
| `doctor/`                                              | `rowbly doctor [--fix]`.                                                         |
| `story/`, `stage/`, `custom-field/`, `spec/`, `skill/` | The commands of each resource.                                                   |
| `attachment/`                                          | `add-attachment`, `list-attachments`, `open-attachment`, `remove-attachment`.    |
| `auth/`, `auth-wizard/`                                | `auth providers`, `status`, `login`, `logout`, and the interactive login prompt. |
| `model/`                                               | `model list`.                                                                    |
| `factory/`, `factory-runner/`                          | `factory` commands, and the foreground adapter that runs the daemon.             |
| `thread/`                                              | `thread list`, `show`, `log`, `cancel`, `resume`.                                |

The native commands are in [native-factory/controls.md](native-factory/controls.md).

## Global options and resource commands

`registerCommands()` adds two global options:

- `--json` prints the results and the errors as JSON.
- `-C, --cwd <dir>` runs as if Rowbly started in `<dir>`.

Most commands belong to a resource command, for example `story`, `stage`, `custom-field`, `spec`,
`skill`, `project`, `factory`, `auth`, `model` and `thread`. A resource command with no action prints
its help. A resource command with an unknown action gives an error. `init`, `doctor` and the
attachment commands are at the top level. Commander gives `--help` for each subcommand automatically.

## Output and errors

`run(command, call, text)` in `src/commands/output/` connects a command to a service:

1. It reads `--json` and `--cwd`, and makes the `ServiceContext`.
2. It calls the service.
3. It prints `text(result)`, or the result as JSON with `--json`.
4. If the service throws a `RowblyError`, it prints the message, each issue and the hint to stderr.
   With `--json`, it prints `{ "error": { code, message, hint, details } }`. Then it sets exit code 1.
5. It throws each other error again, because that error is a bug.

## Add a CLI command

1. Write or extend the service in `src/services/`. See [service-layer.md](service-layer.md).
2. Add the command to the module of its resource, for example `src/commands/story/`. For a new
   resource, create `src/commands/<resource>/<resource>.ts`. Export a function that registers the
   actions on the resource command:

   ```ts
   import type { Command } from "commander";
   import { createStory } from "../../services/story/story.js";
   import { run } from "../output/output.js";

   export function registerStoryCommands(program: Command): void {
     program
       .command("create")
       .description("Create a story")
       .requiredOption("--title <title>", "story title")
       .action((opts: { title: string }, command: Command) =>
         run(
           command,
           (ctx) => createStory({ title: opts.title }, ctx),
           (story) => `Created ${story.id} in ${story.stage}`,
         ),
       );
   }
   ```

3. Pass the resource command to this function from `registerCommands()` in
   `src/commands/register-commands/`.
4. Add a test that calls `runCli()` from `src/commands/test-cli/`.

The command file only changes flags into service input and formats the service output.

## Interactive prompts

Only `rowbly init` and `rowbly auth login` ask questions, through `@clack/prompts`.

- `rowbly init` asks questions only in a terminal, with no choice flags and no `--json`. See
  [onboarding.md](onboarding.md).
- `rowbly auth login` must run in a terminal without `--json`. API keys use a masked prompt, never an
  argument.

## Related

- [service-layer.md](service-layer.md): the services that the commands call.
- [native-factory/controls.md](native-factory/controls.md): the `auth`, `model`, `factory` and `thread` commands.
- [testing.md](testing.md): `runCli()` in tests.
