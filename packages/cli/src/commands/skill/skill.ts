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

function installLine(name: string, { harness, path, status }: InstallSkillResult["harnesses"][number]): string {
  if (status === "installed") {
    return `Installed ${name} for ${harness}: ${path}`;
  }

  if (status === "shared") {
    return `Recorded ${name} for ${harness}, in a folder that it shares: ${path}`;
  }

  return `${name} is already installed for ${harness}: ${path}`;
}

function formatInstall({ name, harnesses }: InstallSkillResult): string {
  return harnesses.map((result) => installLine(name, result)).join("\n");
}

function removalLine(name: string, { harness, path, status }: RemoveSkillResult["harnesses"][number]): string {
  if (status === "removed") {
    return `Removed ${name} from ${harness}: ${path}`;
  }

  if (status === "shared") {
    return `Untracked ${name} for ${harness}. Another harness uses the folder: ${path}`;
  }

  return `Untracked ${name} for ${harness}. The folder was already missing: ${path}`;
}

function formatRemoval({ name, harnesses }: RemoveSkillResult): string {
  return harnesses.map((result) => removalLine(name, result)).join("\n");
}

function skillLine({ name, harnesses }: SkillStatus): string {
  const states = harnesses.map(({ harness, installed }) => (installed ? harness : `${harness} (missing)`));

  return `${name}  ${states.join(", ")}`;
}

function formatSkills(skills: SkillStatus[]): string {
  if (skills.length === 0) {
    return "No skills installed.";
  }

  return skills.map((skill) => skillLine(skill)).join("\n");
}

/** Registers the `rowbly skill` subcommands on the `skill` command. */
export function registerSkillCommands(program: Command): void {
  program
    .command("install")
    .description("Install a bundled skill for one or more coding harnesses")
    .argument("<name>", "bundled skill name")
    .requiredOption("--harness <id>", HARNESS_HELP, collect)
    .action((name: string, opts: { harness: string[] }, command: Command) =>
      run(
        command,
        (ctx) => installSkill({ name, harnesses: opts.harness }, ctx),
        (result) => formatInstall(result),
      ),
    );

  program
    .command("list")
    .description("List the installed skills")
    .action((_opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => listSkills(ctx),
        (skills) => formatSkills(skills),
      ),
    );

  program
    .command("remove")
    .description("Remove an installed skill from all harnesses, or from the named harnesses")
    .argument("<name>", "installed skill name")
    .option("--harness <id>", HARNESS_HELP, collect)
    .action((name: string, opts: { harness?: string[] }, command: Command) =>
      run(
        command,
        (ctx) => removeSkill({ name, harnesses: opts.harness }, ctx),
        (result) => formatRemoval(result),
      ),
    );
}
