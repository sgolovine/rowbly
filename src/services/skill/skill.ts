import { cp, lstat, mkdir, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type InstalledSkill,
  isSkillName,
  type ProjectConfig,
  readConfig,
  SKILL_HARNESSES,
  type SkillHarness,
  throwIfIssues,
  writeConfig,
} from "../config/config.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { pathExists, pathOccupied } from "../files/files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

/** Where each harness reads project skills, relative to the project root. */
const HARNESS_SKILL_DIRS: Record<SkillHarness, string> = {
  "claude-code": ".claude/skills",
  codex: ".agents/skills",
  "gemini-cli": ".gemini/skills",
  "github-copilot": ".github/skills",
  cursor: ".cursor/skills",
};

export const SKILL_FILE = "SKILL.md";

export interface InstallSkillInput {
  name: string;
  harnesses: string[];
}

export interface RemoveSkillInput {
  name: string;
  /** Leave out to remove the skill from every harness that has it. */
  harnesses?: string[];
}

interface SkillInstallation {
  harness: SkillHarness;
  path: string;
  /** `shared`: the folder of another tracked harness is the same folder, so Rowbly copied nothing. */
  status: "installed" | "shared" | "already-installed";
}

export interface InstallSkillResult {
  name: string;
  harnesses: SkillInstallation[];
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

export interface SkillStatus {
  name: string;
  harnesses: { harness: SkillHarness; path: string; installed: boolean }[];
}

function harnessSkillsDir(paths: ProjectPaths, harness: SkillHarness): string {
  return join(paths.root, HARNESS_SKILL_DIRS[harness]);
}

/** The folder of a skill for one harness. */
export function skillPath(paths: ProjectPaths, harness: SkillHarness, name: string): string {
  return join(harnessSkillsDir(paths, harness), name);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Resolves symlinks, also for a path that does not exist yet: its nearest existing folder, plus the rest. */
async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
    const parent = dirname(path);
    return parent === path ? path : join(await physicalPath(parent), basename(path));
  }
}

/** The `skills/` folder next to the first `package.json` above this file, in both `src/` and `dist/`. */
async function defaultSkillsDir(): Promise<string> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (await pathExists(join(dir, "package.json"))) return join(dir, "skills");
    const parent = dirname(dir);
    if (parent === dir) throw new NotFoundError("Rowbly cannot find its bundled skills");
    dir = parent;
  }
}

/** The folder of the bundled skills, and the skills in it: its subfolders that have a `SKILL.md`. */
export async function bundledSkills(ctx: ServiceContext = {}): Promise<{ dir: string; names: string[] }> {
  const dir = ctx.skillsDir ?? (await defaultSkillsDir());
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { dir, names: [] };
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && isSkillName(entry.name) && (await pathExists(join(dir, entry.name, SKILL_FILE)))) {
      names.push(entry.name);
    }
  }
  return { dir, names: names.sort() };
}

/**
 * Copies a skill through a hidden sibling folder and a rename, so a harness never sees half a skill.
 * Symlinks become real files, so that the copy does not depend on the Rowbly package.
 * @returns The path to delete to undo the copy.
 */
export async function copySkill(source: string, target: string): Promise<string> {
  const parent = dirname(target);
  let firstCreated: string | undefined;
  try {
    firstCreated = await mkdir(parent, { recursive: true });
  } catch (error) {
    if (!isMissing(error) && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new ConflictError(`Rowbly cannot create the folder ${parent}`, {
      hint: "A file or a broken symlink is in its place. Move it, then try again.",
    });
  }
  const temp = join(parent, `.${basename(target)}-${process.pid}-${Date.now()}.tmp`);
  try {
    await cp(source, temp, { recursive: true, dereference: true });
    await rename(temp, target);
  } catch (error) {
    await rm(firstCreated ?? temp, { recursive: true, force: true });
    throw error;
  }
  return firstCreated ?? target;
}

function parseHarnesses(harnesses: string[]): SkillHarness[] {
  const hint = `Harnesses: ${SKILL_HARNESSES.join(", ")}`;
  if (harnesses.length === 0) throw new ValidationError("Give at least one harness", { hint });
  const unknown = harnesses.filter((harness) => !SKILL_HARNESSES.includes(harness as SkillHarness));
  throwIfIssues(
    `Unknown harness: ${unknown.join(", ")}`,
    unknown.map((harness) => ({ path: ["harnesses"], message: `Unknown harness "${harness}"` })),
    hint,
  );
  return [...new Set(harnesses)] as SkillHarness[];
}

function findSkill(config: ProjectConfig, name: string): InstalledSkill | undefined {
  return config.skills?.find((skill) => skill.name === name);
}

/** Adds `added` to the harnesses of the skill, and adds the skill if it is new. */
function trackHarnesses(config: ProjectConfig, name: string, added: SkillHarness[]): ProjectConfig {
  const known = findSkill(config, name)?.harnesses ?? [];
  const harnesses = SKILL_HARNESSES.filter((harness) => known.includes(harness) || added.includes(harness));
  const others = config.skills?.filter((skill) => skill.name !== name) ?? [];
  return { ...config, skills: [...others, { name, harnesses }] };
}

/** Installs a bundled skill for each harness. Any conflict stops the install before it writes anything. */
export async function installSkill(input: InstallSkillInput, ctx: ServiceContext = {}): Promise<InstallSkillResult> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const { name } = input;
  const bundled = await bundledSkills(ctx);
  if (!bundled.names.includes(name)) {
    throw new NotFoundError(`Unknown skill "${name}"`, {
      hint: bundled.names.length > 0 ? `Bundled skills: ${bundled.names.join(", ")}` : "Rowbly has no bundled skills.",
    });
  }
  const harnesses = parseHarnesses(input.harnesses);
  const tracked = findSkill(config, name)?.harnesses ?? [];
  const trackedDirs = new Set(await Promise.all(tracked.map((h) => physicalPath(harnessSkillsDir(paths, h)))));

  const results: SkillInstallation[] = [];
  const copies: string[] = [];
  const conflicts: string[] = [];
  const claimedDirs = new Set<string>();
  for (const harness of harnesses) {
    const path = skillPath(paths, harness, name);
    const dir = await physicalPath(harnessSkillsDir(paths, harness));
    if (await pathOccupied(path)) {
      if (tracked.includes(harness)) results.push({ harness, path, status: "already-installed" });
      else if (trackedDirs.has(dir)) results.push({ harness, path, status: "shared" });
      else conflicts.push(relative(paths.root, path));
    } else if (claimedDirs.has(dir)) {
      results.push({ harness, path, status: "shared" });
    } else {
      claimedDirs.add(dir);
      copies.push(path);
      results.push({ harness, path, status: "installed" });
    }
  }
  if (conflicts.length > 0) {
    throw new ConflictError(`Rowbly does not track ${conflicts.join(", ")}, but it already exists`, {
      details: { conflicts },
      hint: "Move or delete it, then run `rowbly install-skill` again.",
    });
  }

  const undo: string[] = [];
  try {
    for (const path of copies) undo.push(await copySkill(join(bundled.dir, name), path));
    const added = harnesses.filter((harness) => !tracked.includes(harness));
    if (added.length > 0) await writeConfig(paths, trackHarnesses(config, name, added));
  } catch (error) {
    await Promise.all(undo.map((path) => rm(path, { recursive: true, force: true })));
    throw error;
  }
  return { name, harnesses: results };
}

/** The installed skills, and whether each harness has its copy. */
export async function listSkills(ctx: ServiceContext = {}): Promise<SkillStatus[]> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  return Promise.all(
    (config.skills ?? []).map(async ({ name, harnesses }) => ({
      name,
      harnesses: await Promise.all(
        harnesses.map(async (harness) => {
          const path = skillPath(paths, harness, name);
          return { harness, path, installed: await pathExists(join(path, SKILL_FILE)) };
        }),
      ),
    })),
  );
}

/** Deletes `path`; gives `false` if there is nothing to delete. */
async function deleteIfPresent(path: string): Promise<boolean> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  await rm(path, { recursive: true });
  return true;
}

/** Removes a skill from tracked harnesses. It keeps a folder that another tracked harness still uses. */
export async function removeSkill(input: RemoveSkillInput, ctx: ServiceContext = {}): Promise<RemoveSkillResult> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const { name } = input;
  const skill = findSkill(config, name);
  if (!skill) {
    throw new NotFoundError(`Skill "${name}" is not installed`, {
      hint: "Run `rowbly list-skills` to see the installed skills.",
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
  const keptDirs = new Set(await Promise.all(remaining.map((h) => physicalPath(harnessSkillsDir(paths, h)))));
  const results: SkillRemoval[] = [];
  for (const harness of targets) {
    const path = skillPath(paths, harness, name);
    if (keptDirs.has(await physicalPath(harnessSkillsDir(paths, harness)))) {
      results.push({ harness, path, status: "shared" });
    } else {
      results.push({ harness, path, status: (await deleteIfPresent(path)) ? "removed" : "missing" });
    }
  }

  const others = config.skills?.filter((other) => other.name !== name) ?? [];
  const skills = remaining.length > 0 ? [...others, { name, harnesses: remaining }] : others;
  await writeConfig(paths, { ...config, skills: skills.length > 0 ? skills : undefined });
  return { name, harnesses: results };
}
