import type { Command } from "commander";
import { registerAttachmentCommands } from "../attachment/attachment.js";
import { registerAuthCommands } from "../auth/auth.js";
import { registerCustomFieldCommands } from "../custom-field/custom-field.js";
import { registerDoctor } from "../doctor/doctor.js";
import { registerFactoryCommands } from "../factory/factory.js";
import { registerInit } from "../init/init.js";
import { registerModelCommands } from "../model/model.js";
import { registerProjectCommands } from "../project/project.js";
import { registerSkillCommands } from "../skill/skill.js";
import { registerSpecCommands } from "../spec/spec.js";
import { registerStageCommands } from "../stage/stage.js";
import { registerStoryCommands } from "../story/story.js";
import { registerThreadCommands } from "../thread/thread.js";

/**
 * Registers every CLI subcommand on the root program.
 * Each command lives in its own file in this folder and calls into src/services.
 */
export function registerCommands(program: Command): void {
  program
    .option("--json", "print results and errors as JSON")
    .option("-C, --cwd <dir>", "run as if Rowbly was started in <dir>");

  registerAttachmentCommands(program);
  registerInit(program);
  registerProjectCommands(resource(program, "project", "Manage the project"));
  registerDoctor(program);
  registerStoryCommands(resource(program, "story", "Manage stories"));
  registerStageCommands(resource(program, "stage", "Manage stages"));
  registerCustomFieldCommands(resource(program, "custom-field", "Manage custom fields"));
  registerSpecCommands(resource(program, "spec", "Manage specs"));
  registerSkillCommands(resource(program, "skill", "Manage agent skills"));
  registerFactoryCommands(resource(program, "factory", "Control the native factory"));
  registerAuthCommands(resource(program, "auth", "Manage provider authentication"));
  registerModelCommands(resource(program, "model", "List available models"));
  registerThreadCommands(resource(program, "thread", "Inspect agent threads"));
}

/** Prints the help when no action is given, and rejects an unknown action. `help` stops the command. */
function resourceAction(command: Command): void {
  const [action] = command.args;

  if (action === undefined) {
    command.help();
  }

  command.error(`error: unknown command '${action}'`, { code: "commander.unknownCommand" });
}

/** Creates a resource command that prints help when no action is given, and rejects an unknown action. */
function resource(program: Command, name: string, description: string): Command {
  const command = program.command(name).description(description).argument("[action...]");

  command.action(() => resourceAction(command));

  return command;
}
