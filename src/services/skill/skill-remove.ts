import { lstat, rm } from "node:fs/promises";
import { readConfig, type SkillHarness, writeConfig } from "../config/config.js";
import { NotFoundError } from "../errors/errors.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { mapInOrder } from "./map-in-order.js";
import { findSkill, parseHarnesses } from "./skill-config.js";
import { isMissing, physicalPath, skillEntry, skillPath } from "./skill-paths.js";

export interface RemoveSkillInput {
  name: string;
  /** Leave out to remove the skill from every harness that has it. */
  harnesses?: string[];
}

interface SkillRemoval {
  harness: SkillHarness;
  path: string;
  /** `shared`: another tracked harness still uses the folder, so Rowbly kept it. */
  status: "removed" | "missing" | "shared";
}

export interface RemoveSkillResult {
  name: string;
  harnesses: SkillRemoval[];
}

/** Deletes `path`; gives `false` if there is nothing to delete. */
async function deleteIfPresent(path: string): Promise<boolean> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }

  await rm(path, { recursive: true });

  return true;
}

/** Keeps the entry when a remaining harness uses it. */
async function removeFor(
  paths: ProjectPaths,
  kept: ReadonlySet<string>,
  harness: SkillHarness,
  name: string,
): Promise<SkillRemoval> {
  const path = skillPath(paths, harness, name);

  if (kept.has(await skillEntry(paths, harness, name))) {
    return { harness, path, status: "shared" };
  }

  return { harness, path, status: (await deleteIfPresent(path)) ? "removed" : "missing" };
}

/**
 * Removes a skill from tracked harnesses. It keeps a folder that another tracked harness still uses,
 * through a symlink at the skill or at its skills folder. For a symlink at the skill, it deletes only the link.
 */
export async function removeSkill(input: RemoveSkillInput, ctx: ServiceContext = {}): Promise<RemoveSkillResult> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const { name } = input;
  const skill = findSkill(config, name);

  if (!skill) {
    throw new NotFoundError(`Skill "${name}" is not installed`, {
      hint: "Run `rowbly skill list` to see the installed skills.",
    });
  }

  const targets = input.harnesses === undefined ? skill.harnesses : parseHarnesses(input.harnesses);
  const untracked = targets.filter((harness) => !skill.harnesses.includes(harness));

  if (untracked.length > 0) {
    throw new NotFoundError(`Skill "${name}" is not installed for ${untracked.join(", ")}`, {
      hint: `It is installed for ${skill.harnesses.join(", ")}.`,
    });
  }

  const remaining = skill.harnesses.filter((harness) => !targets.includes(harness));
  const kept = new Set(
    await Promise.all(remaining.flatMap((h) => [skillEntry(paths, h, name), physicalPath(skillPath(paths, h, name))])),
  );
  const results = await mapInOrder(targets, (harness) => removeFor(paths, kept, harness, name));

  const others = config.skills?.filter((other) => other.name !== name) ?? [];
  const skills = remaining.length > 0 ? [...others, { name, harnesses: remaining }] : others;

  await writeConfig(paths, { ...config, skills: skills.length > 0 ? skills : undefined });

  return { name, harnesses: results };
}
