import {
  type InstalledSkill,
  type ProjectConfig,
  SKILL_HARNESSES,
  type SkillHarness,
  throwIfIssues,
} from "../config/config.js";
import { ValidationError } from "../errors/errors.js";

/** Checks the harness names, and gives each harness one time. */
export function parseHarnesses(harnesses: string[]): SkillHarness[] {
  const hint = `Harnesses: ${SKILL_HARNESSES.join(", ")}`;

  if (harnesses.length === 0) {
    throw new ValidationError("Give at least one harness", { hint });
  }

  const unknown = harnesses.filter((harness) => !SKILL_HARNESSES.includes(harness as SkillHarness));

  throwIfIssues(
    `Unknown harness: ${unknown.join(", ")}`,
    unknown.map((harness) => ({ path: ["harnesses"], message: `Unknown harness "${harness}"` })),
    hint,
  );

  return [...new Set(harnesses)] as SkillHarness[];
}

/** The config entry of a tracked skill. */
export function findSkill(config: ProjectConfig, name: string): InstalledSkill | undefined {
  return config.skills?.find((skill) => skill.name === name);
}

/** Adds `added` to the harnesses of the skill, and adds the skill if it is new. */
export function trackHarnesses(config: ProjectConfig, name: string, added: SkillHarness[]): ProjectConfig {
  const known = findSkill(config, name)?.harnesses ?? [];
  const harnesses = SKILL_HARNESSES.filter((harness) => known.includes(harness) || added.includes(harness));
  const others = config.skills?.filter((skill) => skill.name !== name) ?? [];

  return { ...config, skills: [...others, { name, harnesses }] };
}
