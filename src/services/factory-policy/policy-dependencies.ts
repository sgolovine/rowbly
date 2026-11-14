// The dependency rules of the factory policy. This module does no I/O.
import { blocksOf, type DependencyStory, isComplete } from "../story-dependency/story-dependency.js";
import type { PolicyStage, PolicyStory } from "./policy-types.js";

/** Gives the Stories of a scan with a mandatory `dependsOn` list. */
export function dependencyStories(stories: readonly PolicyStory[]): DependencyStory[] {
  return stories.map((story) => ({ id: story.id, stage: story.stage, dependsOn: story.dependsOn ?? [] }));
}

/** Whether the Story `id` exists and is not complete. */
function isOpen(stories: readonly DependencyStory[], stages: readonly PolicyStage[], id: string): boolean {
  const story = stories.find((candidate) => candidate.id === id);

  return story !== undefined && !isComplete(stages, story.stage);
}

/** One level of a breadth-first search for the downstream Stories. The set of visited IDs stops a cycle. */
function collectDownstream(
  stories: readonly DependencyStory[],
  stages: readonly PolicyStage[],
  frontier: readonly string[],
  seen: ReadonlySet<string>,
): ReadonlySet<string> {
  if (frontier.length === 0) {
    return seen;
  }

  const found = frontier.flatMap((id) => blocksOf(stories, id));
  const fresh = [...new Set(found)].filter((id) => !seen.has(id) && isOpen(stories, stages, id));

  return collectDownstream(stories, stages, fresh, new Set([...seen, ...fresh]));
}

/** The number of direct and indirect downstream Stories of the Story `id` that are not complete. */
export function downstreamCount(
  stories: readonly DependencyStory[],
  stages: readonly PolicyStage[],
  id: string,
): number {
  return collectDownstream(stories, stages, [id], new Set([id])).size - 1;
}
