import { readConfig } from "../config/config.js";
import { mapInOrder } from "../in-order/in-order.js";
import { refuseRemoteWrite } from "../outbox/outbox.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { type DuplicatePlan, planDuplicates, type UnrepairedDuplicate } from "./duplicate-plan.js";
import { type RenumberOutcome, renumberStory, type StoryRenumber } from "./renumber-file.js";

export type { DuplicateGroup, DuplicatePlan } from "./duplicate-plan.js";
export type { StoryRenumber } from "./renumber-file.js";

/** The changes of one repair, and the duplicate IDs that it did not change. */
export interface RenumberResult {
  readonly changes: readonly StoryRenumber[];
  readonly unrepaired: readonly UnrepairedDuplicate[];
}

/** The notice for one change, for example `ROW-77 → ROW-79: duplicate ID`. */
export function renumberNotice(change: Pick<StoryRenumber, "from" | "to">): string {
  return `${change.from} → ${change.to}: duplicate ID`;
}

/**
 * Finds the Story files of the Project with the same Story ID, and gives the plan of the repair. No file changes.
 */
export async function findDuplicateStoryIds(ctx: ServiceContext = {}): Promise<DuplicatePlan> {
  const paths = await findProject(ctx);

  return planDuplicates(paths, await readConfig(paths));
}

/**
 * Gives the newer Story of each duplicate Story ID the next free number. The service takes no lock: an exclusive
 * create and a check of the old file make two repairs at the same time safe. References to the ID do not change.
 */
export async function repairDuplicateStoryIds(ctx: ServiceContext = {}, plan?: DuplicatePlan): Promise<RenumberResult> {
  refuseRemoteWrite(ctx, "renumber Stories");

  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const env = { paths, config, now: ctx.now?.() ?? new Date() };

  const planned = plan ?? (await planDuplicates(paths, config));
  const steps = planned.groups.flatMap((group) => group.renumber.map((file) => ({ group, file })));
  const outcomes: RenumberOutcome[] = await mapInOrder(steps, (step) => renumberStory(env, step.group, step.file));

  return {
    changes: outcomes.flatMap((outcome) => ("change" in outcome ? [outcome.change] : [])),
    unrepaired: [
      ...planned.unrepaired,
      ...outcomes.flatMap((outcome) => ("unrepaired" in outcome ? [outcome.unrepaired] : [])),
    ],
  };
}
