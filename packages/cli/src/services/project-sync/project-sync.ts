import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectWrite } from "../project-write/project-write.js";

/** The result of one sync step. A failed step has the Git error in `detail`. */
export interface SyncStep {
  readonly status: "ok" | "skipped" | "failed";
  readonly detail?: string;
}

/** The steps of one sync. A step that is off is absent. */
export interface SyncResult {
  readonly pull?: SyncStep;
  readonly push?: SyncStep;
}

export interface SyncOptions {
  readonly push: boolean;
  readonly pull: boolean;
}

const GIT_TIMEOUT_MS = 120_000;
const DETAIL_LIMIT = 2000;
const run = promisify(execFile);

/** Runs one Git command in the checkout. Git must not ask for credentials, because no person answers. */
async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", root, ...args], {
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

  return stdout.trim();
}

/** Gives the most useful text of a Git failure. */
function describeError(error: unknown): string {
  const failure = error as { stderr?: string; stdout?: string; killed?: boolean; message?: string };
  const text = failure.killed
    ? `Git did not complete in ${GIT_TIMEOUT_MS / 1000} seconds`
    : failure.stderr?.trim() || failure.stdout?.trim() || failure.message || String(error);

  return text.slice(0, DETAIL_LIMIT);
}

function failed(error: unknown): SyncStep {
  return { status: "failed", detail: describeError(error) };
}

/** Runs a Git command and replaces its failure with a clear message. */
async function gitOrFail(root: string, args: readonly string[], message: string): Promise<string> {
  try {
    return await git(root, args);
  } catch {
    throw new Error(message);
  }
}

/** Fails when HEAD is detached or the branch has no upstream. Both steps need a branch with an upstream. */
async function requireUpstream(root: string): Promise<void> {
  await gitOrFail(root, ["symbolic-ref", "-q", "HEAD"], "HEAD is detached. Sync needs a branch.");
  await gitOrFail(root, ["rev-parse", "--abbrev-ref", "@{u}"], "The current branch has no upstream branch.");
}

/** Fails when a merge is in progress, because `git merge --abort` must not stop the merge of a person. */
async function requireNoMerge(root: string): Promise<void> {
  const merging = await git(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).then(
    () => true,
    () => false,
  );

  if (merging) {
    throw new Error("A merge is in progress in the canonical checkout. Complete or stop it.");
  }
}

/** Merges the upstream after a failed fast-forward. A merge failure restores the checkout. */
async function mergeUpstream(root: string): Promise<SyncStep> {
  try {
    await git(root, ["merge", "--no-edit", "@{u}"]);

    return { status: "ok", detail: "merged" };
  } catch (error) {
    await git(root, ["merge", "--abort"]).catch(() => "");

    return failed(error);
  }
}

/** Fetches the upstream, then fast-forwards the branch, or merges it when the branches diverged. */
async function pullUpstream(root: string): Promise<SyncStep> {
  await requireUpstream(root);
  await requireNoMerge(root);
  await git(root, ["fetch", "--quiet"]);

  const fastForward = await git(root, ["merge", "--ff-only", "--quiet", "@{u}"]).then(
    () => true,
    () => false,
  );

  if (fastForward) {
    return { status: "ok", detail: "fast-forward" };
  }

  return mergeUpstream(root);
}

/** Pushes the local commits to the upstream. The push never uses force. */
async function pushUpstream(root: string): Promise<SyncStep> {
  await requireUpstream(root);

  const ahead = Number(await git(root, ["rev-list", "--count", "@{u}..HEAD"]));

  if (ahead === 0) {
    return { status: "skipped", detail: "no local commits" };
  }

  await git(root, ["push", "--quiet"]);

  return { status: "ok", detail: `${ahead} commits` };
}

function step(task: (root: string) => Promise<SyncStep>, root: string): Promise<SyncStep> {
  return task(root).catch(failed);
}

/** Pull runs first. Push runs also after a failed pull, because the push of local commits does not need it. */
async function syncLocked(root: string, options: SyncOptions): Promise<SyncResult> {
  const pull = options.pull ? await step(pullUpstream, root) : undefined;
  const push = options.push ? await step(pushUpstream, root) : undefined;

  return { ...(pull ? { pull } : {}), ...(push ? { push } : {}) };
}

/** Gives a failure for each step that is on, when the sync could not start. */
function failedSteps(options: SyncOptions, error: unknown): SyncResult {
  const result = failed(error);

  return { ...(options.pull ? { pull: result } : {}), ...(options.push ? { push: result } : {}) };
}

/**
 * Pulls and pushes the branch of the canonical checkout while the Project write lock is held.
 * A failure gives a failed step. The function does not throw.
 */
export async function syncCanonicalProject(root: string, options: SyncOptions): Promise<SyncResult> {
  if (!options.push && !options.pull) {
    return {};
  }

  return projectWrite(root, () => syncLocked(root, options)).catch((error: unknown) => failedSteps(options, error));
}
