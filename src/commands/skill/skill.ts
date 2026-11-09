import type { Command } from "commander";
import { SKILL_HARNESSES } from "../../services/config/config.js";
import {
  type InstallSkillResult,
  installSkill,
  listSkills,
  type RemoveSkillResult,
  removeSkill,
  type SkillStatus,
} from "../../services/skill/skill.js";
import { collect, run } from "../output/output.js";

const HARNESS_HELP = `one of ${SKILL_HARNESSES.join(", ")} (repeatable)`;

function formatInstall({ name, harnesses }: InstallSkillResult): string {
  return harnesses
    .map(({ harness, path, status }) => {
      if (status === "installed") return `Installed ${name} for ${harness}: ${path}`;
      if (status === "shared") return `Recorded ${name} for ${harness}, in a folder that it shares: ${path}`;
      return `${name} is already installed for ${harness}: ${path}`;
    })
    .join("\n");
}

function formatRemoval({ name, harnesses }: RemoveSkillResult): string {
  return harnesses
    .map(({ harness, path, status }) => {
      if (status === "removed") return `Removed ${name} from ${harness}: ${path}`;
      if (status === "shared") return `Untracked ${name} for ${harness}. Another harness uses the folder: ${path}`;
      return `Untracked ${name} for ${harness}. The folder was already missing: ${path}`;
    })
    .join("\n");
}

function formatSkills(skills: SkillStatus[]): string {
  if (skills.length === 0) return "No skills installed.";
  return skills
    .map(({ name, harnesses }) => {
      const states = harnesses.map(({ harness, installed }) => (installed ? harness : `${harness} (missing)`));
      return `${name}  ${states.join(", ")}`;
    })
    .join("\n");
}

export function registerSkillCommands(program: Command): void {
  program
    .command("install-skill")
    .description("Install a bundled skill for one or more coding harnesses")
    .argument("<name>", "bundled skill name")
    .requiredOption("--harness <id>", HARNESS_HELP, collect)
    .action((name: string, opts: { harness: string[] }, command: Command) =>
      run(command, (ctx) => installSkill({ name, harnesses: opts.harness }, ctx), formatInstall),
    );

  program
    .command("list-skills")
    .description("List the installed skills")
    .action((_opts: unknown, command: Command) => run(command, (ctx) => listSkills(ctx), formatSkills));

  program
    .command("remove-skill")
    .description("Remove an installed skill from all harnesses, or from the named harnesses")
    .argument("<name>", "installed skill name")
    .option("--harness <id>", HARNESS_HELP, collect)
    .action((name: string, opts: { harness?: string[] }, command: Command) =>
      run(command, (ctx) => removeSkill({ name, harnesses: opts.harness }, ctx), formatRemoval),
    );
}
