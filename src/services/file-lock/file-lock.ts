import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { Store } from "../store/store.js";

/** The output of the flock helper that the event listeners collect. */
interface LockState {
  readonly failure: Error | undefined;
  readonly errorText: string;
  readonly output: string;
  readonly acquired: boolean;
}

/** The options of a file lock. */
export interface FileLockOptions {
  /** The time in seconds that flock waits for the lock. */
  readonly waitSeconds?: number;
  /** The name of the lock in the error message, for example `Project write lock`. */
  readonly label?: string;
}

const LOCK_HELPER =
  'process.stdout.write("locked\\n"); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));';

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

/**
 * Runs `action` while it holds an exclusive kernel lock on the file at `path`. A flock helper holds the lock through
 * a pipe, so that the exit of the parent releases the lock through EOF. A lock that does not come in time gives a
 * `ConflictError`.
 */
export async function withFileLock<T>(
  path: string,
  action: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  if (process.platform !== "linux") {
    throw new ValidationError("Native factory writes require Linux and util-linux flock");
  }

  const { waitSeconds = 60, label = "File lock" } = options;
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
      throw new ConflictError(`${label} is unavailable`, {
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
