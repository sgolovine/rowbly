import type { Command } from "commander";
import { registerAttachmentCommands } from "../attachment/attachment.js";
import { registerCustomFieldCommands } from "../customField/customField.js";
import { registerDoctor } from "../doctor/doctor.js";
import { registerInit } from "../init/init.js";
import { registerProjectCommands } from "../project/project.js";
import { registerSkillCommands } from "../skill/skill.js";
import { registerSpecCommands } from "../spec/spec.js";
import { registerStageCommands } from "../stage/stage.js";
import { registerStoryCommands } from "../story/story.js";

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
  registerProjectCommands(program);
  registerDoctor(program);
  registerStoryCommands(program);
  registerStageCommands(program);
  registerCustomFieldCommands(program);
  registerSpecCommands(program);
  registerSkillCommands(program);
}
