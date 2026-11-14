import { join } from "node:path";
import { readConfig, type SkillHarness } from "../config/config.js";
import { pathExists } from "../files/files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { SKILL_FILE, skillPath } from "./skill-paths.js";

export { packageDir } from "../files/files.js";
export { bundledSkills, copySkill } from "./bundled-skills.js";
export { type InstallSkillResult, installSkill } from "./skill-install.js";
export { HARNESS_SKILL_DIRS, SKILL_FILE, skillPath } from "./skill-paths.js";
export { type RemoveSkillResult, removeSkill } from "./skill-remove.js";

export interface SkillStatus {
  name: string;
  harnesses: { harness: SkillHarness; path: string; installed: boolean }[];
}

async function harnessStatus(paths: ProjectPaths, harness: SkillHarness, name: string) {
  const path = skillPath(paths, harness, name);

  return { harness, path, installed: await pathExists(join(path, SKILL_FILE)) };
}

/** The installed skills, and whether each harness has its copy. */
export async function listSkills(ctx: ServiceContext = {}): Promise<SkillStatus[]> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);

  return Promise.all(
    (config.skills ?? []).map(async ({ name, harnesses }) => ({
      name,
      harnesses: await Promise.all(harnesses.map((harness) => harnessStatus(paths, harness, name))),
    })),
  );
}
