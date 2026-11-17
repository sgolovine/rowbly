import { mapInOrder } from "../in-order/in-order.js";
import { removeStoryFile } from "../story-files/story-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import type { CopyGroup, PlannedFile } from "./copy-plan.js";
import type { UnrepairedDuplicate } from "./duplicate-plan.js";
import { readText } from "./renumber-file.js";

/** One old copy of a Story that the repair removed. */
export interface CopyRemoval {
  /** The canonical ID of the Story: `ROW-78`. */
  readonly id: string;
  /** The Stage of the removed copy, or `null` when its frontmatter has no Stage. */
  readonly stage: string | null;
  /** The path of the removed copy. */
  readonly path: string;
  /** The path of the copy that stays. */
  readonly keptPath: string;
}

export type CopyOutcome = { readonly removed: CopyRemoval } | { readonly unrepaired: UnrepairedDuplicate };

/** The notice for one removed copy, for example `ROW-78: removed the old copy in DONE`. */
export function copyNotice(removal: Pick<CopyRemoval, "id" | "stage">): string {
  return `${removal.id}: removed the old copy in ${removal.stage ?? "an unknown Stage"}`;
}

async function unchanged(file: PlannedFile): Promise<boolean> {
  return (await readText(file.path)) === file.text;
}

function notRepaired(group: CopyGroup, paths: readonly string[], reason: string): CopyOutcome {
  return { unrepaired: { id: group.id, paths, reason } };
}

/** Removes one old copy, only when its text did not change since the plan. */
async function removeCopy(paths: ProjectPaths, group: CopyGroup, file: PlannedFile): Promise<CopyOutcome> {
  if (!(await unchanged(file))) {
    return notRepaired(group, [group.keep.path, file.path], "A copy of the Story changed during the repair");
  }

  await removeStoryFile(paths, file.path);

  return { removed: { id: group.id, stage: file.stage, path: file.path, keptPath: group.keep.path } };
}

/**
 * Removes the old copies of one Story. When a copy changed or disappeared after the plan, it removes no file of the
 * group. It reads each file again before the remove, so that a second process that runs the repair does not lose an edit.
 */
export async function removeCopies(paths: ProjectPaths, group: CopyGroup): Promise<CopyOutcome[]> {
  const files = [group.keep, ...group.remove];
  const checks = await mapInOrder(files, unchanged);

  if (checks.includes(false)) {
    const reason = "A copy of the Story changed after the plan";

    return [
      notRepaired(
        group,
        files.map((file) => file.path),
        reason,
      ),
    ];
  }

  return mapInOrder(group.remove, (file) => removeCopy(paths, group, file));
}
