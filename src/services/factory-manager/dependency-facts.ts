// The dependency facts that the supervisor reads. This module does no I/O.
import {
  blocksOf,
  type DependencyStage,
  type DependencyStory,
  waitingFor,
} from "../story-dependency/story-dependency.js";

/** The dependency lists of one Story. */
export interface DependencyLists {
  readonly dependsOn: readonly string[];
  readonly blocks: readonly string[];
  readonly waitingFor: readonly string[];
}

/** A Stage with the class of its prompt. */
export interface ClassifiedStage extends DependencyStage {
  readonly label: string;
  readonly promptClass: string;
}

/** Gives the upstream, the downstream and the waiting Story IDs of the Story `id`. */
export function dependencyLists(
  stories: readonly DependencyStory[],
  stages: readonly DependencyStage[],
  id: string,
): DependencyLists {
  const story = stories.find((candidate) => candidate.id === id);

  return {
    dependsOn: [...(story?.dependsOn ?? [])],
    blocks: blocksOf(stories, id),
    waitingFor: waitingFor(stories, stages, id),
  };
}

/** The keys of the Stages with the prompt class `work`. */
export function workStageKeys(stages: readonly ClassifiedStage[]): ReadonlySet<string> {
  return new Set(stages.filter((stage) => stage.promptClass === "work").map((stage) => stage.key));
}

/** One digest item for each blocked Story in a `work` Stage, for example `ROW-03 waits for ROW-01, ROW-02`. */
export function blockedItems(stories: readonly DependencyStory[], stages: readonly ClassifiedStage[]): string[] {
  const work = workStageKeys(stages);

  return stories
    .filter((story) => work.has(story.stage))
    .map((story) => ({ id: story.id, upstream: waitingFor(stories, stages, story.id) }))
    .filter(({ upstream }) => upstream.length > 0)
    .map(({ id, upstream }) => `${id} waits for ${upstream.join(", ")}`);
}
