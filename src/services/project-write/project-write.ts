import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { formatAuthor, type GitSettings } from "../factory-settings/git-settings.js";
import { bundledSkills } from "../skill/skill.js";
import { Store } from "../store/store.js";

/** The output of the flock helper that the event listeners collect. */
interface LockState {
  readonly failure: Error | undefined;
  readonly errorText: string;
  readonly output: string;
  readonly acquired: boolean;
}

const LOCK_HELPER =
  'process.stdout.write("locked\\n"); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));';

/** Uses the same Git common-directory path as commit-project.mjs. */
export async function projectWriteLockPath(root: string): Promise<string> {
  const { dir } = await bundledSkills();
  const module: typeof import("../../../skills/factory/scripts/commit-project.mjs") = await import(
    pathToFileURL(join(dir, "factory", "scripts", "commit-project.mjs")).href
  );

  return module.lockPath(root);
}

/** Keeps only the last 2000 characters, because flock can write without a limit. */
function recordErrorText(lock: Store<LockState>, chunk: Buffer): void {
  lock.update((state) => ({ errorText: (state.errorText + chunk.toString()).slice(-2000) }));
}

function recordFailure(lock: Store<LockState>, error: Error, resolve: () => void): void {
  lock.update(() => ({ failure: error }));
  resolve();
}

/** Resolves when the helper reports the lock. The output can arrive in more than one chunk. */
function recordOutput(lock: Store<LockState>, chunk: Buffer, resolve: () => void): void {
  const { output } = lock.update((state) => ({ output: state.output + chunk.toString() }));

  if (output.includes("locked\n")) {
    lock.update(() => ({ acquired: true }));
    resolve();
  }
}

function waitForEnd(child: ChildProcessWithoutNullStreams, lock: Store<LockState>): Promise<void> {
  return new Promise<void>((resolve) => {
    child.once("error", (error) => recordFailure(lock, error, resolve));
    child.once("close", () => resolve());
  });
}

function waitForLock(child: ChildProcessWithoutNullStreams, lock: Store<LockState>): Promise<void> {
  return new Promise<void>((resolve) => {
    child.stdout.on("data", (chunk: Buffer) => recordOutput(lock, chunk, resolve));
  });
}

/** Holds the kernel lock through a pipe. Parent exit releases the lock through EOF. */
export async function projectWrite<T>(root: string, action: () => Promise<T>, waitSeconds = 60): Promise<T> {
  if (process.platform !== "linux") {
    throw new ValidationError("Native factory writes require Linux and util-linux flock");
  }

  const path = await projectWriteLockPath(root);
  const child = spawn("flock", ["-w", String(waitSeconds), path, process.execPath, "-e", LOCK_HELPER], {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lock = new Store<LockState>({ failure: undefined, errorText: "", output: "", acquired: false });

  child.stderr.on("data", (chunk: Buffer) => recordErrorText(lock, chunk));

  const ended = waitForEnd(child, lock);

  // A missing flock binary can close stdin before the caller ends the pipe.
  child.stdin.on("error", () => {});

  const ready = waitForLock(child, lock);

  try {
    await Promise.race([ready, ended]);

    if (!lock.current.acquired) {
      throw new ConflictError("Project write lock is unavailable", {
        cause: lock.current.failure,
        hint: lock.current.errorText || `Check flock and the lock at ${path}`,
      });
    }

    return await action();
  } finally {
    child.stdin.end();
    await ended;
  }
}

/** The `commit-project.mjs` flags of the message and the author. A value that is not set keeps the default. */
function commitFlags(git: GitSettings | undefined): string[] {
  const author = formatAuthor(git);

  return [...(git?.commitMessage ? ["--message", git.commitMessage] : []), ...(author ? ["--author", author] : [])];
}

/** Commits canonical files while projectWrite holds the shared kernel lock. The Git settings set the message and the author. */
export async function commitCanonicalProject(root: string, git?: GitSettings) {
  const { dir } = await bundledSkills();

  return projectWrite(root, async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [join(dir, "factory/scripts/commit-project.mjs"), "--root", root, "--locked", ...commitFlags(git)],
      { timeout: 60_000 },
    );

    return JSON.parse(stdout) as { status: string; detail?: string };
  });
}
