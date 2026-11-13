import type { Dirent } from "node:fs";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSkillName } from "../config/config.js";
import { ConflictError, NotFoundError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { isMissing, SKILL_FILE } from "./skill-paths.js";

/** Walks up from `dir` to the first folder with a `package.json`. */
async function findPackageDir(dir: string): Promise<string> {
  if (await pathExists(join(dir, "package.json"))) {
    return dir;
  }

  const parent = dirname(dir);

  if (parent === dir) {
    throw new NotFoundError("Rowbly cannot find its package folder");
  }

  return findPackageDir(parent);
}

/** The folder of the first `package.json` above this file, in both `src/` and `dist/`. */
export async function packageDir(): Promise<string> {
  return findPackageDir(dirname(fileURLToPath(import.meta.url)));
}

/** The entries of the bundled skills folder. An absent folder has no entries. */
async function readSkillEntries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function isBundledSkill(dir: string, entry: Dirent): Promise<boolean> {
  return entry.isDirectory() && isSkillName(entry.name) && (await pathExists(join(dir, entry.name, SKILL_FILE)));
}

/** The folder of the bundled skills, and the skills in it: its subfolders that have a `SKILL.md`. */
export async function bundledSkills(ctx: ServiceContext = {}): Promise<{ dir: string; names: string[] }> {
  const dir = ctx.skillsDir ?? join(await packageDir(), "skills");
  const entries = await readSkillEntries(dir);

  const bundled = await mapInOrder(entries, (entry) => isBundledSkill(dir, entry));
  const names = entries.filter((_, index) => bundled[index]).map((entry) => entry.name);

  return { dir, names: names.toSorted() };
}

/** Creates the parent folder. Gives the first folder that it created, or `undefined` if the folder exists. */
async function createParent(parent: string): Promise<string | undefined> {
  try {
    return await mkdir(parent, { recursive: true });
  } catch (error) {
    if (!isMissing(error) && (error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }

    throw new ConflictError(`Rowbly cannot create the folder ${parent}`, {
      hint: "A file or a broken symlink is in its place. Move it, then try again.",
    });
  }
}

/**
 * Copies a skill through a hidden sibling folder and a rename, so a harness never sees half a skill.
 * Symlinks become real files, so that the copy does not depend on the Rowbly package.
 * @returns The path to delete to undo the copy.
 */
export async function copySkill(source: string, target: string): Promise<string> {
  const parent = dirname(target);
  const firstCreated = await createParent(parent);
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
