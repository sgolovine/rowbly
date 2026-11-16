import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConflictError } from "../errors/errors.js";

const run = promisify(execFile);

const GIT_TIMEOUT_MS = 300_000;
const DETAIL_LIMIT = 2000;

/** Runs one Git command in the clone. Git must not ask for credentials, because no person answers. */
async function git(clone: string, args: readonly string[]): Promise<void> {
  await run("git", ["-C", clone, ...args], {
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

/** Gives the most useful text of a Git failure. */
function gitDetail(error: unknown): string {
  const failure = error as { stderr?: string; message?: string };

  return (failure.stderr?.trim() || failure.message || String(error)).slice(0, DETAIL_LIMIT);
}

/**
 * Fetches `origin` in the clone, then fast-forwards the current branch of the clone to its upstream. A new worktree
 * then starts from the newest base. Rowbly never resets the clone, so a clone that cannot fast-forward gives an error.
 */
export async function updateClone(clone: string): Promise<void> {
  try {
    await git(clone, ["fetch", "origin"]);
  } catch (error) {
    throw new ConflictError(`Cannot fetch origin in the clone ${clone}: ${gitDetail(error)}`, {
      details: { clone },
    });
  }

  try {
    await git(clone, ["merge", "--ff-only", "@{upstream}"]);
  } catch (error) {
    throw new ConflictError(`The clone ${clone} cannot fast-forward to its upstream: ${gitDetail(error)}`, {
      details: { clone },
      hint: "Make the clone on the worker host a clean clone whose branch can fast-forward to origin.",
    });
  }
}
