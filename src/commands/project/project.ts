import { type Command, InvalidArgumentError } from "commander";
import { compactThreads, type DisplayConfig, storySidebarBehavior } from "../../services/config/config.js";
import { type Project, updateProject } from "../../services/project/project.js";
import { run } from "../output/output.js";

function describe(project: Project): string {
  const specs = project.features?.specs ? "\nSpecs: on" : "";
  const compact = project.display === undefined ? "" : `\nCompact threads: ${compactThreads(project) ? "on" : "off"}`;
  const timeZone = project.display?.timeZone === undefined ? "" : `\nTime zone: ${project.display.timeZone}`;
  const sidebar =
    project.display?.storySidebar === undefined ? "" : `\nStory sidebar: ${storySidebarBehavior(project)}`;

  return `${project.projectName} (${project.projectKey}) in ${project.root}${specs}${compact}${timeZone}${sidebar}`;
}

/** Parses `on` or `off`. */
function parseSwitch(value: string): boolean {
  if (value === "on" || value === "off") {
    return value === "on";
  }

  throw new InvalidArgumentError("Expected on or off.");
}

interface UpdateOptions {
  name?: string;
  key?: string;
  specs?: boolean;
  compactThreads?: boolean;
  timeZone?: string;
}

/** The display options of the flags, or `undefined` when no display flag is given. */
function displayOptions(opts: UpdateOptions): DisplayConfig | undefined {
  const display = {
    ...(opts.compactThreads === undefined ? {} : { compactThreads: opts.compactThreads }),
    ...(opts.timeZone === undefined ? {} : { timeZone: opts.timeZone.trim() }),
  };

  return Object.keys(display).length === 0 ? undefined : display;
}

function registerUpdate(program: Command): void {
  program
    .command("update")
    .description("Update the project's name, key, features or display options")
    .option("--name <name>", "new project name")
    .option("--key <key>", "new story ID prefix; renames every story file")
    .option("--specs <on|off>", "turn specs on or off", parseSwitch)
    .option("--compact-threads <on|off>", "show each Thread on one line in the TUI", parseSwitch)
    .option(
      "--time-zone <zone>",
      'time zone of the Story times in the TUI, for example Europe/Berlin; "" for the system zone',
    )
    .action((opts: UpdateOptions, command: Command) =>
      run(
        command,
        (ctx) =>
          updateProject(
            {
              name: opts.name,
              key: opts.key,
              features: opts.specs === undefined ? undefined : { specs: opts.specs },
              display: displayOptions(opts),
            },
            ctx,
          ),
        (project) => `Updated ${describe(project)}`,
      ),
    );
}

/** Registers the `rowbly project` subcommands on the `project` command. */
export function registerProjectCommands(program: Command): void {
  registerUpdate(program);
}
