import { readConfig } from "../config/config.js";
import { ValidationError } from "../errors/errors.js";
import { lookupStage, unknownStageIssues } from "../stage/stage.js";
import { getStory } from "../story/story.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import type { FactorySettings, ModelChoice } from "./factory-settings.js";

/** The worker model of each Stage, by Stage key. */
export type StageWorkerModels = Readonly<Record<string, ModelChoice>>;

/** The worker models of each Story, by Story ID and then by Stage key. */
export type StoryWorkerModels = Readonly<Record<string, StageWorkerModels>>;

/** The override maps of the factory settings. An empty map is not kept. */
export type WorkerOverrideMaps = Pick<FactorySettings, "stageWorkerModels" | "storyWorkerModels">;

/** The Stage, and the optional Story, of one worker model override. */
export interface OverrideTarget {
  readonly stage: string;
  readonly storyId?: string;
}

/** Gives the Story override for the Stage, else the Stage override. It does not use `workerModel`. */
export function workerOverride(settings: FactorySettings, storyId: string, stage: string): ModelChoice | undefined {
  return settings.storyWorkerModels?.[storyId]?.[stage] ?? settings.stageWorkerModels?.[stage];
}

/** Gives the worker model of a Story in a Stage: the Story override, the Stage override, then `workerModel`. */
export function resolveWorkerModel(settings: FactorySettings, storyId: string, stage: string): ModelChoice | undefined {
  return workerOverride(settings, storyId, stage) ?? settings.workerModel;
}

/** Tells if the settings have the override of the target. */
export function hasWorkerOverride(settings: FactorySettings, target: OverrideTarget): boolean {
  const map = target.storyId ? settings.storyWorkerModels?.[target.storyId] : settings.stageWorkerModels;

  return map?.[target.stage] !== undefined;
}

function withKey<T>(map: Readonly<Record<string, T>> | undefined, key: string, value: T | undefined) {
  const others = Object.entries(map ?? {}).filter(([k]) => k !== key);
  const entries = value === undefined ? others : [...others, [key, value] as const];

  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Gives the override maps with the override of the target set to the choice, or removed without a choice. */
export function withWorkerOverride(
  settings: FactorySettings,
  target: OverrideTarget,
  choice: ModelChoice | undefined,
): WorkerOverrideMaps {
  if (!target.storyId) {
    return {
      stageWorkerModels: withKey(settings.stageWorkerModels, target.stage, choice),
      storyWorkerModels: settings.storyWorkerModels,
    };
  }

  const story = withKey(settings.storyWorkerModels?.[target.storyId], target.stage, choice);

  return {
    stageWorkerModels: settings.stageWorkerModels,
    storyWorkerModels: withKey(settings.storyWorkerModels, target.storyId, story),
  };
}

/** Whether the configure flags select a worker model override in place of the default models. */
export function isOverrideInput(input: { stage?: string; story?: string; clearWorker?: boolean }): boolean {
  return input.stage !== undefined || input.story !== undefined || !!input.clearWorker;
}

/** Checks the Stage key and the Story ID of an override target, and gives their canonical keys. */
export async function checkedTarget(target: OverrideTarget, ctx: ServiceContext): Promise<OverrideTarget> {
  const config = await readConfig(await findProject(ctx));
  const stage = lookupStage(config, target.stage);

  if (!stage) {
    throw new ValidationError("Unknown stage", {
      details: { issues: unknownStageIssues(config, target.stage, ["stage"]) },
    });
  }

  const story = target.storyId === undefined ? undefined : await getStory({ id: target.storyId }, ctx);

  return { stage: stage.key, storyId: story?.id };
}
