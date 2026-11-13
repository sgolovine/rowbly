import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ConflictError } from "../errors/errors.js";
import type { Story } from "../story/story.js";

interface WorkerWorktree {
  readonly path: string;
  readonly branch: string | undefined;
}

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]) {
  return (await exec("git", ["-C", cwd, ...args])).stdout.trim();
}

function pullRequestOf(story: Story): string | undefined {
  const pr = story.fields.pull_request;

  return typeof pr === "string" && pr ? pr : undefined;
}

/** Gives the branch of the Story. A pull request gives its head branch, and the branch is fetched. */
async function requiredBranch(root: string, story: Story): Promise<string> {
  const pr = pullRequestOf(story);

  if (!pr) {
    if (story.stage === "IN_REVIEW") {
      throw new ConflictError("Review requires a pull_request field");
    }

    return `story/${story.id}`;
  }

  const { stdout } = await exec("gh", ["pr", "view", pr, "--json", "headRefName", "--jq", ".headRefName"], {
    cwd: root,
  });
  const branch = stdout.trim();

  if (!branch || branch.startsWith("-")) {
    throw new ConflictError("Invalid pull request branch");
  }

  await git(root, "fetch", "origin", branch);

  return branch;
}

function worktreePath(root: string, story: Story): string {
  return typeof story.fields.worktree === "string" && story.fields.worktree
    ? resolve(story.fields.worktree)
    : join(dirname(root), `${basename(root)}-worktrees`, story.id);
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        return false;
      }

      throw e;
    },
  );
}

async function hasLocalBranch(root: string, branch: string): Promise<boolean> {
  return git(root, "show-ref", "--verify", `refs/heads/${branch}`).then(
    () => true,
    () => false,
  );
}

/** Switches a detached worktree to the required branch. A worktree on a different branch stays as it is. */
async function switchBranch(root: string, path: string, branch: string, current: string): Promise<void> {
  if (current) {
    throw new ConflictError("Story worktree branch differs from the required branch; preserve and inspect it");
  }

  const known = await hasLocalBranch(root, branch);

  try {
    await git(path, "switch", ...(known ? [branch] : ["-c", branch]));
  } catch (cause) {
    throw new ConflictError("Cannot select the required Story worktree branch; preserve and inspect it", {
      cause,
      hint: `Inspect ${path} before retry. Git refused the branch switch: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/** Uses an existing worktree of the same repository. Existing work is never reset. */
async function reuseWorktree(
  root: string,
  common: string,
  path: string,
  story: Story,
  branch: string,
): Promise<WorkerWorktree> {
  const other = await realpath(resolve(path, await git(path, "rev-parse", "--git-common-dir")));

  if (common !== other || (await realpath(path)) === (await realpath(root))) {
    throw new ConflictError("Story worktree belongs to another repository or is the main checkout");
  }

  const current = await git(path, "branch", "--show-current");

  if (story.stage !== "IN_REFINEMENT" && current !== branch) {
    await switchBranch(root, path, branch, current);

    return { path, branch };
  }

  return { path, branch: current || undefined };
}

/** A local branch can contain work that is not pushed yet, so it has priority over the fetched head. */
function startPoint(known: boolean, branch: string, story: Story): string {
  if (known) {
    return branch;
  }

  return pullRequestOf(story) ? "FETCH_HEAD" : "HEAD";
}

async function addWorktree(root: string, path: string, story: Story, branch: string): Promise<WorkerWorktree> {
  await mkdir(dirname(path), { recursive: true });

  if (story.stage === "IN_REFINEMENT") {
    await git(root, "worktree", "add", "--detach", path, "HEAD");

    return { path, branch: undefined };
  }

  const known = await hasLocalBranch(root, branch);

  await git(root, "worktree", "add", ...(known ? [] : ["-b", branch]), path, startPoint(known, branch, story));

  return { path, branch };
}

/** Prepares one isolated worktree per Story. Existing work is never reset or removed. */
export async function prepareWorkerWorktree(root: string, story: Story): Promise<WorkerWorktree> {
  const common = await realpath(resolve(root, await git(root, "rev-parse", "--git-common-dir")));
  const branch = await requiredBranch(root, story);
  const path = worktreePath(root, story);

  if (await pathExists(path)) {
    return reuseWorktree(root, common, path, story, branch);
  }

  return addWorktree(root, path, story, branch);
}
