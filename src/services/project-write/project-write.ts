import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { bundledSkills } from "../skill/skill.js";

/** Uses the same Git common-directory path as commit-project.mjs. */
export async function projectWriteLockPath(root: string): Promise<string> {
  const { dir } = await bundledSkills();
  const module: typeof import("../../../skills/factory/scripts/commit-project.mjs") = await import(
    pathToFileURL(join(dir, "factory", "scripts", "commit-project.mjs")).href
  );
  return module.lockPath(root);
}

/** Holds the kernel lock through a pipe. Parent exit releases the lock through EOF. */
export async function projectWrite<T>(root: string, action: () => Promise<T>, waitSeconds = 60): Promise<T> {
  if (process.platform !== "linux") {
    throw new ValidationError("Native factory writes require Linux and util-linux flock");
  }
  const path = await projectWriteLockPath(root);
  const helper =
    'process.stdout.write("locked\\n"); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));';
  const child = spawn("flock", ["-w", String(waitSeconds), path, process.execPath, "-e", helper], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let failure: Error | undefined;
  let errorText = "";
  child.stderr.on("data", (chunk: Buffer) => {
    errorText = (errorText + chunk.toString()).slice(-2000);
  });
  const ended = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      failure = error;
      resolve();
    });
    child.once("close", () => resolve());
  });
  // A missing flock binary can close stdin before the caller ends the pipe.
  child.stdin.on("error", () => {});
  let acquired = false;
  const ready = new Promise<void>((resolve) => {
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("locked\n")) {
        acquired = true;
        resolve();
      }
    });
  });
  try {
    await Promise.race([ready, ended]);
    if (!acquired) {
      throw new ConflictError("Project write lock is unavailable", {
        cause: failure,
        hint: errorText || `Check flock and the lock at ${path}`,
      });
    }
    return await action();
  } finally {
    child.stdin.end();
    await ended;
  }
}

/** Commits canonical files while projectWrite holds the shared kernel lock. */
export async function commitCanonicalProject(root: string) {
  const { dir } = await bundledSkills();
  return projectWrite(root, async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [join(dir, "factory/scripts/commit-project.mjs"), "--root", root, "--locked"],
      { timeout: 60_000 },
    );
    return JSON.parse(stdout) as { status: string; detail?: string };
  });
}
