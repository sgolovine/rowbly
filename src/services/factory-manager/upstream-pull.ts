// The manager rule that selects the stuck upstream Stories to move out of the first Stage. This module does no I/O.
import { type DependencyStory, waitingFor } from "../story-dependency/story-dependency.js";
import { type ClassifiedStage, workStageKeys } from "./dependency-facts.js";

/** A Stage that can be off. A Stage without `enabled` is on. */
type PullStage = ClassifiedStage & { readonly enabled?: boolean };

/** The Stories that the manager moves in one pass, and the Stages of the move. */
export interface UpstreamPull {
  /** The IDs of the upstream Stories to move, in the order of the Stories. */
  readonly moves: readonly string[];
  /** The IDs of the blocked downstream Stories in a `work` Stage that wait for a moved Story. */
  readonly waiting: readonly string[];
  readonly from: PullStage;
  readonly to: PullStage;
}

/** The upstream Stories that are not complete, also the indirect ones. A cycle stops at a Story that it found. */
function upstreamClosure(
  stories: readonly DependencyStory[],
  stages: readonly PullStage[],
  frontier: readonly string[],
  found: ReadonlySet<string>,
): ReadonlySet<string> {
  const next = [...new Set(frontier.flatMap((id) => waitingFor(stories, stages, id)))].filter((id) => !found.has(id));

  return next.length === 0 ? found : upstreamClosure(stories, stages, next, new Set([...found, ...next]));
}

/** Whether the Story `id` is in the Stage `stageKey` and is not parked. */
function isMovable(
  stories: readonly DependencyStory[],
  stageKey: string,
  parked: Readonly<Record<string, unknown>>,
  id: string,
): boolean {
  return parked[id] === undefined && stories.some((story) => story.id === id && story.stage === stageKey);
}

/** The first enabled `work` Stage that is not the first Stage of the board. */
function targetStage(stages: readonly PullStage[]): PullStage | undefined {
  return stages.slice(1).find((stage) => stage.enabled !== false && stage.promptClass === "work");
}

/**
 * Selects each upstream Story in the first Stage that a blocked Story in a `work` Stage waits for, directly or
 * through other upstream Stories. A parked Story does not move. The target is the first enabled `work` Stage.
 * Gives `undefined` when no Story moves.
 */
export function upstreamPull(
  stories: readonly DependencyStory[],
  stages: readonly PullStage[],
  parked: Readonly<Record<string, unknown>>,
): UpstreamPull | undefined {
  const from = stages[0];
  const to = targetStage(stages);
  const work = workStageKeys(stages);

  if (!from || !to) {
    return undefined;
  }

  const chains = stories
    .filter((story) => work.has(story.stage))
    .map((story) => ({ id: story.id, upstream: upstreamClosure(stories, stages, [story.id], new Set()) }))
    .map(({ id, upstream }) => ({
      id,
      upstream: [...upstream].filter((id) => isMovable(stories, from.key, parked, id)),
    }))
    .filter(({ upstream }) => upstream.length > 0);
  const moving = new Set(chains.flatMap(({ upstream }) => upstream));
  const moves = stories.filter((story) => moving.has(story.id)).map((story) => story.id);

  return moves.length === 0 ? undefined : { moves, waiting: chains.map(({ id }) => id), from, to };
}

/** The subject of the canonical commit of a move, for example `chore(rowbly): move ROW-04 out of Backlog for ROW-05`. */
export function pullMessage(pull: UpstreamPull): string {
  return `chore(rowbly): move ${pull.moves.join(", ")} out of ${pull.from.label} for ${pull.waiting.join(", ")}`;
}
