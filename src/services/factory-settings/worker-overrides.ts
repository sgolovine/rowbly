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
