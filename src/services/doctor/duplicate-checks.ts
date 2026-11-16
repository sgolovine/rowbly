import {
  type CopyGroup,
  type CopyRemoval,
  copyNotice,
  type DuplicateGroup,
  findDuplicateStoryIds,
  renumberNotice,
  repairDuplicateStoryIds,
  type StoryRenumber,
} from "../story-renumber/story-renumber.js";
import { type DoctorIssue, type DoctorRun, rel } from "./doctor-run.js";

/** A Story file that the repair removes or gives a new number, and the Story that keeps the ID. */
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

function attemptsText(count: number): string[] {
  return count > 0 ? [`${count} ${count === 1 ? "attempt" : "attempts"} without storyUid`] : [];
}

/** The references to the old ID that stayed with the Story that keeps the ID, as one sentence, or `""`. */
function stayedText(run: DoctorRun, change: StoryRenumber): string {
  const { stayed } = change;
  const refs = [
    ...stayed.dependents.map((path) => `${rel(run, path)} (dependsOn)`),
    ...stayed.specs.map((path) => `${rel(run, path)} (Spec link)`),
    ...stayed.attachments.map((name) => `attachment ${name}`),
    ...attemptsText(stayed.attempts),
  ];

  return refs.length > 0 ? `. These references stayed with ${change.from}: ${refs.join(", ")}` : "";
}

function movedText(change: StoryRenumber): string {
  const count = change.movedAttachments.length;

  return count > 0 ? `. ${count} ${count === 1 ? "attachment" : "attachments"} moved to ${change.to}` : "";
}

function fixedIssue(run: DoctorRun, change: StoryRenumber): DoctorIssue {
  const kept = `Give it the next free number. ${rel(run, change.keptPath)} keeps ${change.from}`;

  return {
    severity: "error",
    message: renumberNotice(change),
    file: rel(run, change.previousPath),
    fix: `${kept}${movedText(change)}${stayedText(run, change)}`,
    fixed: true,
  };
}

function removedIssue(run: DoctorRun, removal: CopyRemoval): DoctorIssue {
  return {
    severity: "error",
    message: copyNotice(removal),
    file: rel(run, removal.path),
    fix: `Remove the old copy. ${rel(run, removal.keptPath)} is the newest copy`,
    fixed: true,
  };
}

function plannedRemovals(run: DoctorRun, group: CopyGroup): [string, PlannedFix | undefined][] {
  const keptPath = group.keep.path;
  const fix = `Remove the old copy. ${rel(run, keptPath)} is the newest copy`;
  const remove = group.remove.map((file): [string, PlannedFix] => [file.path, { keptId: group.id, keptPath, fix }]);

  return [[keptPath, undefined], ...remove];
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
 * With `--fix`, removes the old copies of each Story, then gives the newer Story of each duplicate Story ID the next free number. Without it, plans the repair
 * and changes no file.
 */
export async function repairDuplicates(run: DoctorRun): Promise<DuplicateRepair> {
  if (run.fix) {
    const result = await repairDuplicateStoryIds(run.ctx);

    const removed = result.removed.map((removal) => removedIssue(run, removal));

    return { issues: [...removed, ...result.changes.map((change) => fixedIssue(run, change))], planned: new Map() };
  }

  const plan = await findDuplicateStoryIds(run.ctx);
  const copies = plan.copies.flatMap((group) => plannedRemovals(run, group));

  return { issues: [], planned: new Map([...copies, ...plan.groups.flatMap(plannedFixes)]) };
}
