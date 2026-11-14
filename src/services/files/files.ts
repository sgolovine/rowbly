import { randomUUID } from "node:crypto";
import { access, type FileHandle, lstat, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NotFoundError } from "../errors/errors.js";

/** Whether `path` is accessible. A broken symlink does not count. */
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

    if (code === "ENOENT") {
      return false;
    }

    if (code === "ENOTDIR") {
      return true;
    }

    throw error;
  }
}

/** Whether `path` is a folder, or a recursive `mkdir` can make it: no file or broken symlink is in the way. */
export async function canCreateFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOTDIR") {
      return false;
    }

    if (code !== "ENOENT") {
      throw error;
    }
  }

  if (await pathOccupied(path)) {
    return false;
  }

  return canCreateFolder(dirname(path));
}

/** The names of the `.md` files in `dir`, sorted; none when `dir` does not exist. */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .toSorted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export interface AtomicWriteOptions {
  mode?: number;
  durable?: boolean;
}

/** Writes the content, and syncs it to the disk when the write must be durable. */
async function writeTemp(file: FileHandle, content: string, durable: boolean | undefined): Promise<void> {
  try {
    await file.writeFile(content, "utf8");

    if (durable) {
      await file.sync();
    }
  } finally {
    await file.close();
  }
}

/** Syncs the folder so that the rename survives a crash. */
async function syncDirectory(parent: string): Promise<void> {
  const directory = await open(parent, "r");

  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/** Writes a complete file through an exclusive temporary file and atomic rename. */
export async function writeFileAtomic(path: string, content: string, options: AtomicWriteOptions = {}): Promise<void> {
  const parent = dirname(path);

  await mkdir(parent, { recursive: true });

  const temp = join(parent, `.${randomUUID()}.tmp`);
  // Open outside the cleanup, so that a failed exclusive open never removes a file of a different writer.
  const file = await open(temp, "wx", options.mode);

  try {
    await writeTemp(file, content, options.durable);
    await rename(temp, path);

    if (options.durable) {
      await syncDirectory(parent);
    }
  } finally {
    await rm(temp, { force: true });
  }
}

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
