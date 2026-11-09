import { type Command, InvalidArgumentError } from "commander";
import { getInstructions, initProject, type Project, updateProject } from "../../services/project/project.js";
import { run } from "../output/output.js";

function describe(project: Project): string {
  const specs = project.features?.specs ? "\nSpecs: on" : "";
  return `${project.projectName} (${project.projectKey}) in ${project.root}${specs}`;
}

/** Parses `on` or `off`. */
function parseSwitch(value: string): boolean {
  if (value === "on" || value === "off") return value === "on";
  throw new InvalidArgumentError("Expected on or off.");
}

export function registerProjectCommands(program: Command): void {
  program
    .command("init")
    .description("Create a Rowbly project in the current directory")
    .option("--name <name>", "project name (default: the directory's name)")
    .option("--key <key>", "story ID prefix, e.g. ROW (default: made from the name)")
    .action((opts: { name?: string; key?: string }, command: Command) =>
      run(
        command,
        (ctx) => initProject({ name: opts.name, key: opts.key }, ctx),
        (project) => `Created ${describe(project)}\nStages: ${project.stages.map((stage) => stage.key).join(", ")}`,
      ),
    );

  program
    .command("update-project")
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
