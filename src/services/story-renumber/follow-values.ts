import { pathExists } from "../files/files.js";
import { defaultBranch, defaultWorktreePath, hasLocalBranch } from "../worker-worktree/worker-worktree.js";
import type { PlannedRenumber } from "./duplicate-plan.js";
import type { RenumberEnv } from "./renumber-file.js";

/** The frontmatter values that the repair writes into a Story that gets a new number. */
export interface FollowValues {
  readonly worktree?: string;
  readonly branch?: string;
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim() !== "" : value !== null && value !== undefined;
}

/**
 * The `worktree` key: the default worktree of the old ID, when the Story has no worktree and the folder exists. The
 * key is written only when the config has the `worktree` field, because `doctor --fix` removes an unknown key.
 */
async function followWorktree(
  env: RenumberEnv,
  file: PlannedRenumber,
  data: Readonly<Record<string, unknown>>,
): Promise<FollowValues> {
  const path = defaultWorktreePath(env.paths.root, file.id);
  const configured = env.config.customFields.some((field) => field.key === "worktree");

  if (!configured || hasValue(data.worktree) || !(await pathExists(path))) {
    return {};
  }

  return { worktree: path };
}

/** The `branch` key: the default branch of the old ID, when the Story has no pull request and the branch exists. */
async function followBranch(
  env: RenumberEnv,
  file: PlannedRenumber,
  data: Readonly<Record<string, unknown>>,
): Promise<FollowValues> {
  const branch = defaultBranch(file.id);

  if (hasValue(data.pull_request) || hasValue(data.branch) || !(await hasLocalBranch(env.paths.root, branch))) {
    return {};
  }

  return { branch };
}

/**
 * The frontmatter values that Rowbly calculates from the old Story ID, for a Story that gets a new number. With them,
 * the Story keeps its worktree and its branch after the re-number. A Story of a group of the ROW-81 rules gets none.
 */
export async function followValues(
  env: RenumberEnv,
  file: PlannedRenumber,
  data: Readonly<Record<string, unknown>>,
): Promise<FollowValues> {
  if (file.storyUid === undefined) {
    return {};
  }

  return { ...(await followWorktree(env, file, data)), ...(await followBranch(env, file, data)) };
}
