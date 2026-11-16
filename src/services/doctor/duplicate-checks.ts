import {
  type DuplicateGroup,
  findDuplicateStoryIds,
  renumberNotice,
  repairDuplicateStoryIds,
  type StoryRenumber,
} from "../story-renumber/story-renumber.js";
import { type DoctorIssue, type DoctorRun, rel } from "./doctor-run.js";

/** A Story file that the repair gives a new number, and the Story that keeps the ID. */
export interface PlannedFix {
  readonly keptId: string;
  readonly keptPath: string;
  readonly fix: string;
}

/** The fixed issues of the repair, or the planned fix of each Story file that `--fix` gives a new number. */
export interface DuplicateRepair {
  readonly issues: readonly DoctorIssue[];
  /** Each Story file of a group that `--fix` can repair → its fix, or `undefined` for the Story that keeps the ID. */
  readonly planned: ReadonlyMap<string, PlannedFix | undefined>;
}

function fixedIssue(run: DoctorRun, change: StoryRenumber): DoctorIssue {
  return {
    severity: "error",
    message: renumberNotice(change),
    file: rel(run, change.previousPath),
    fix: `Give it the next free number. ${rel(run, change.keptPath)} keeps ${change.from}`,
    fixed: true,
  };
}

function plannedFixes(group: DuplicateGroup): [string, PlannedFix | undefined][] {
  const keptPath = group.keep.path;
  const renumber = group.renumber.map((file): [string, PlannedFix] => [
    file.path,
    { keptId: group.keep.id, keptPath, fix: renumberNotice({ from: file.id, to: file.to }) },
  ]);

  return [[keptPath, undefined], ...renumber];
}

/**
 * With `--fix`, gives the newer Story of each duplicate Story ID the next free number. Without it, plans the repair
 * and changes no file.
 */
export async function repairDuplicates(run: DoctorRun): Promise<DuplicateRepair> {
  if (run.fix) {
    const result = await repairDuplicateStoryIds(run.ctx);

    return { issues: result.changes.map((change) => fixedIssue(run, change)), planned: new Map() };
  }

  const plan = await findDuplicateStoryIds(run.ctx);

  return { issues: [], planned: new Map(plan.groups.flatMap(plannedFixes)) };
}
