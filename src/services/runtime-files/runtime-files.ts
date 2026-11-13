import { chmod, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { type ProjectPaths, runtimePaths } from "../workspace/workspace.js";

const RUNTIME_IGNORE_RULES = ["/state.json*", "/runtime/"];

/** Reads the ignore file of the Project. An absent file gives empty text. */
async function readIgnoreText(paths: ProjectPaths): Promise<string> {
  return readFile(paths.ignoreFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  });
}

/** Gives the runtime ignore rules that the ignore file of the Project does not have. */
export async function missingRuntimeIgnores(paths: ProjectPaths): Promise<string[]> {
  const text = await readIgnoreText(paths);

  const rules = text.split(/\r?\n/).map((line) => line.trim());

  return RUNTIME_IGNORE_RULES.filter((rule) => !rules.includes(rule));
}

/** Adds missing rules and keeps all existing ignore text. */
export async function ensureRuntimeIgnores(paths: ProjectPaths): Promise<void> {
  const missing = await missingRuntimeIgnores(paths);

  if (!missing.length) {
    return;
  }

  const text = await readIgnoreText(paths);

  await writeFileAtomic(paths.ignoreFile, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
}

/** Gives the runtime root and each path below it, down to the full path of `rel`. */
function pathsToCheck(root: string, rel: string): string[] {
  const parts = rel.split(sep);

  return [root, ...parts.map((_, index) => resolve(root, ...parts.slice(0, index + 1)))];
}

/** Rejects a symlink at `path`. An absent path is accepted. */
async function assertNotSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new ValidationError("Runtime paths must not contain symlinks");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/** Rejects absolute references, traversal and symlinks, including a symlink at the runtime root. */
export async function runtimePath(paths: ProjectPaths, reference: string): Promise<string> {
  const root = paths.runtimeDir;
  const path = resolve(root, reference);
  const rel = relative(root, path);

  if (!reference || isAbsolute(reference) || rel === ".." || rel.startsWith(`..${sep}`) || !rel) {
    throw new ValidationError("Invalid runtime path");
  }

  // Resolve the Project itself, but do not accept links inside its private runtime tree.
  const project = await realpath(paths.dir);

  if (project !== resolve(paths.dir)) {
    throw new ValidationError("The Project directory must not be a symlink");
  }

  await mapInOrder(pathsToCheck(root, rel), (current) => assertNotSymlink(current));

  return path;
}

/** Checks the path of one runtime directory, then creates it with mode 0700. */
async function prepareRuntimeDir(paths: ProjectPaths, path: string): Promise<void> {
  await runtimePath(paths, `${relative(paths.runtimeDir, path) || "."}/.check`);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

/** Creates the private runtime directories with mode 0700 and adds the runtime ignore rules. */
export async function prepareRuntime(paths: ProjectPaths): Promise<void> {
  await runtimePath(paths, "status.json");
  await ensureRuntimeIgnores(paths);

  const dirs = Object.entries(runtimePaths(paths))
    .filter(([key]) => key === "dir" || key.endsWith("Dir"))
    .map(([, path]) => path);

  await mapInOrder(dirs, (path) => prepareRuntimeDir(paths, path));
}
