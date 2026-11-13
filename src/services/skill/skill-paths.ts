import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SkillHarness } from "../config/config.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/** Where each harness reads project skills, relative to the project root. */
export const HARNESS_SKILL_DIRS: Record<SkillHarness, string> = {
  "claude-code": ".claude/skills",
  codex: ".agents/skills",
  "gemini-cli": ".gemini/skills",
  "github-copilot": ".github/skills",
  cursor: ".cursor/skills",
};

export const SKILL_FILE = "SKILL.md";

/** The skills folder of one harness. */
export function harnessSkillsDir(paths: ProjectPaths, harness: SkillHarness): string {
  return join(paths.root, HARNESS_SKILL_DIRS[harness]);
}

/** The folder of a skill for one harness. */
export function skillPath(paths: ProjectPaths, harness: SkillHarness, name: string): string {
  return join(harnessSkillsDir(paths, harness), name);
}

/** Whether a file system error means that nothing is at the path. */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;

  return code === "ENOENT" || code === "ENOTDIR";
}

/** Resolves symlinks, also for a path that does not exist yet: its nearest existing folder, plus the rest. */
export async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }

    const parent = dirname(path);

    return parent === path ? path : join(await physicalPath(parent), basename(path));
  }
}

/** The physical place of the entry of a skill in a skills folder. It follows the links above the entry, but not the entry. */
export async function skillEntry(paths: ProjectPaths, harness: SkillHarness, name: string): Promise<string> {
  return join(await physicalPath(harnessSkillsDir(paths, harness)), name);
}
