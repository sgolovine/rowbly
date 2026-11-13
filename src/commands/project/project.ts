import { type Command, InvalidArgumentError } from "commander";
import { getInstructions, type Project, updateProject } from "../../services/project/project.js";
import { run } from "../output/output.js";

function describe(project: Project): string {
  const specs = project.features?.specs ? "\nSpecs: on" : "";
  return `${project.projectName} (${project.projectKey}) in ${project.root}${specs}`;
}

/** Parses `on` or `off`. */
function parseSwitch(value: string): boolean {
  if (value === "on" || value === "off") {
    return value === "on";
  }
  throw new InvalidArgumentError("Expected on or off.");
}

export function registerProjectCommands(program: Command): void {
  program
    .command("update")
    .description("Update the project's name, key or features")
    .option("--name <name>", "new project name")
    .option("--key <key>", "new story ID prefix; renames every story file")
    .option("--specs <on|off>", "turn specs on or off", parseSwitch)
    .action((opts: { name?: string; key?: string; specs?: boolean }, command: Command) =>
      run(
        command,
        (ctx) =>
          updateProject(
            {
              name: opts.name,
              key: opts.key,
              features: opts.specs === undefined ? undefined : { specs: opts.specs },
            },
            ctx,
          ),
        (project) => `Updated ${describe(project)}`,
      ),
    );

  program
    .command("get-instructions")
    .description("Show the project's instructions for agents, from .rowbly/ROWBLY.md")
    .action((_opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => getInstructions(ctx),
        (result) => result.instructions || "(no instructions)",
      ),
    );
}
