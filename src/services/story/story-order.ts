import type { Story } from "./story-types.js";

/** A Stage of the board order. Only its key is necessary. */
interface StageKey {
  readonly key: string;
}

/** The index of the Stage of `story` in `stages`. A Story of an unknown Stage goes after all known Stages. */
function stageOrder(stages: readonly StageKey[], story: Story): number {
  const index = stages.findIndex((s) => s.key === story.stage);

  return index === -1 ? stages.length : index;
}

/**
 * Sets the 1-based `position` of each Story in its Stage. A Story that has the correct position keeps its reference,
 * so a memo child that shows it does not render again.
 */
function withPositions(stories: readonly Story[]): Story[] {
  const stages = new Set(stories.map((story) => story.stage));
  const positions = new Map(
    [...stages].flatMap((stage) =>
      stories.filter((s) => s.stage === stage).map((s, index): [string, number] => [s.id, index + 1]),
    ),
  );

  return stories.map((story) => {
    const position = positions.get(story.id) ?? story.position;

    return position === story.position ? story : { ...story, position };
  });
}

/**
 * Removes the Story `id` from `stories`, and sets the positions in its Stage again. An unknown ID gives the same
 * Stories. The order of the other Stories does not change.
 */
export function withoutStory(stories: readonly Story[], id: string): Story[] {
  if (!stories.some((s) => s.id === id)) {
    return [...stories];
  }

  return withPositions(stories.filter((s) => s.id !== id));
}

/**
 * Puts `story` on the board order of `stories`, after a write that gave it the most recent `updatedAt`. The old copy
 * with the same ID goes out. The Story goes to the top of its Stage, and the Stages are in the order of `stages`. A
 * Story of an unknown Stage goes after all known Stages. The result has the order of `searchStories({})` after the
 * same write.
 */
export function withStory(stories: readonly Story[], stages: readonly StageKey[], story: Story): Story[] {
  const others = stories.filter((s) => s.id !== story.id);
  const order = stageOrder(stages, story);
  const found = others.findIndex((s) => stageOrder(stages, s) >= order);
  const at = found === -1 ? others.length : found;

  return withPositions(others.toSpliced(at, 0, story));
}
