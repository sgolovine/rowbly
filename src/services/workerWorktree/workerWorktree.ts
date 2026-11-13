import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ConflictError } from "../errors/errors.js";
import type { Story } from "../story/story.js";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  return (await exec("git", ["-C", cwd, ...args])).stdout.trim();
}
/** Prepares one isolated worktree per Story. Existing work is never reset or removed. */
export async function prepareWorkerWorktree(root: string, story: Story) {
  const common = await realpath(resolve(root, await git(root, "rev-parse", "--git-common-dir")));
  let branch = `story/${story.id}`;
  const pr = story.fields.pull_request;
  if (typeof pr === "string" && pr) {
    const { stdout } = await exec("gh", ["pr", "view", pr, "--json", "headRefName", "--jq", ".headRefName"], {
      cwd: root,
    });
    branch = stdout.trim();
    if (!branch || branch.startsWith("-")) throw new ConflictError("Invalid pull request branch");
    await git(root, "fetch", "origin", branch);
    // A local continuation can contain work that is not pushed yet.
    await git(root, "show-ref", "--verify", `refs/heads/${branch}`).catch(() =>
      git(root, "branch", branch, "FETCH_HEAD"),
    );
  } else if (story.stage === "IN_REVIEW") {
    throw new ConflictError("Review requires a pull_request field");
  }
  const path =
    typeof story.fields.worktree === "string" && story.fields.worktree
      ? resolve(story.fields.worktree)
      : join(dirname(root), `${basename(root)}-worktrees`, story.id);
  const exists = await stat(path).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return false;
      throw e;
    },
  );
  if (exists) {
    const other = await realpath(resolve(path, await git(path, "rev-parse", "--git-common-dir")));
    if (common !== other || (await realpath(path)) === (await realpath(root)))
      throw new ConflictError("Story worktree belongs to another repository or is the main checkout");
    const current = await git(path, "branch", "--show-current");
    if (story.stage !== "IN_REFINEMENT" && current !== branch)
      throw new ConflictError("Story worktree branch differs from the required branch; preserve and inspect it");
    return { path, branch: current || undefined };
  }
  await mkdir(dirname(path), { recursive: true });
  if (story.stage === "IN_REFINEMENT") {
    await git(root, "worktree", "add", "--detach", path, "HEAD");
    return { path, branch: undefined };
  }
  const known = await git(root, "show-ref", "--verify", `refs/heads/${branch}`).then(
    () => true,
    () => false,
  );
  await git(root, "worktree", "add", ...(known ? [] : ["-b", branch]), path, known ? branch : "HEAD");
  return { path, branch };
}
