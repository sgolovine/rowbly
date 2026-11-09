import { access, lstat, mkdir, readdir, rename, writeFile } from "node:fs/promises";
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

/** Writes through a temporary file and a rename, so a reader never sees a half-written file. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${Date.now()}-${process.pid}.tmp`);
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}
