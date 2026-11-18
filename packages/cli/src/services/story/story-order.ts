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

/** The time of the last change of `story` in milliseconds. A Story with no valid `updatedAt` gives negative infinity. */
function updatedTime(story: Story): number {
  const time = story.updatedAt === null ? Number.NaN : Date.parse(story.updatedAt);

  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Compares the `updatedAt` times of two Stories: the most recent first. Two missing times are equal. */
function compareUpdated(a: Story, b: Story): number {
  const first = updatedTime(a);
  const second = updatedTime(b);

  return first === second ? 0 : Math.sign(second - first);
}

/** Compares two Stories in board order: by Stage, then by `updatedAt` with the most recent first, then by number. */
function compareBoard(stages: readonly StageKey[], a: Story, b: Story): number {
  return stageOrder(stages, a) - stageOrder(stages, b) || compareUpdated(a, b) || a.number - b.number;
}

/**
 * Removes the Story of the file `path` from `stories`, and sets the positions again. A different copy of the same
 * Story, for example the new file after a Stage move, stays. An unknown path gives the same Stories.
 */
export function withoutStoryAt(stories: readonly Story[], path: string): Story[] {
  if (!stories.some((s) => s.path === path)) {
    return [...stories];
  }

  return withPositions(stories.filter((s) => s.path !== path));
}

/**
 * Puts `story` at its place in the board order of `stories`, after a change that a different process made. The old
 * copy of the same file goes out. The place is the place of a full read (see `searchStories`): by Stage in the order of
 * `stages`, then by `updatedAt` with the most recent first, then by number. The other Stories keep their references
 * when their position does not change.
 */
export function withStoryInOrder(stories: readonly Story[], stages: readonly StageKey[], story: Story): Story[] {
  const others = stories.filter((s) => s.path !== story.path);
  const found = others.findIndex((s) => compareBoard(stages, story, s) < 0);
  const at = found === -1 ? others.length : found;

  return withPositions(others.toSpliced(at, 0, story));
}

/** The result of the read of one changed Story file. `story` is `undefined` when the file does not exist. */
export interface StoryRead {
  readonly path: string;
  readonly story: Story | undefined;
}

function withStoryRead(stories: readonly Story[], stages: readonly StageKey[], read: StoryRead): Story[] {
  return read.story ? withStoryInOrder(stories, stages, read.story) : withoutStoryAt(stories, read.path);
}

/** Applies the reads of changed Story files to `stories`, in order: it puts each read Story, and removes each missing file. */
export function withStoryReads(
  stories: readonly Story[],
  stages: readonly StageKey[],
  reads: readonly StoryRead[],
): Story[] {
  return reads.reduce<Story[]>((result, read) => withStoryRead(result, stages, read), [...stories]);
}
