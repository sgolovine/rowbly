// The dependency facts of the factory status. This module does no I/O.
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
