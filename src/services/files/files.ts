import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether something is at `path`. Unlike `pathExists`, a broken symlink counts, and so does a file in place of a parent folder. */
export async function pathOccupied(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    if (code === "ENOTDIR") return true;
    throw error;
  }
}

/** Whether `path` is a folder, or a recursive `mkdir` can make it: no file or broken symlink is in the way. */
export async function canCreateFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR") return false;
    if (code !== "ENOENT") throw error;
  }
  if (await pathOccupied(path)) return false;
  return canCreateFolder(dirname(path));
}

/** The names of the `.md` files in `dir`, sorted; none when `dir` does not exist. */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export interface AtomicWriteOptions {
  mode?: number;
  durable?: boolean;
}

/** Writes a complete file through an exclusive temporary file and atomic rename. */
export async function writeFileAtomic(path: string, content: string, options: AtomicWriteOptions = {}): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temp = join(parent, `.${randomUUID()}.tmp`);
  let created = false;
  try {
    const file = await open(temp, "wx", options.mode);
    created = true;
    try {
      await file.writeFile(content, "utf8");
      if (options.durable) await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
    if (options.durable) {
      const directory = await open(parent, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    if (created) await rm(temp, { force: true });
  }
}
