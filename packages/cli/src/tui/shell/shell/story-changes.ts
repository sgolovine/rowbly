import { mapInOrder } from "../../../services/in-order/in-order.js";
import { type Stage, updateStage } from "../../../services/stage/stage.js";
import { deleteStory, type Story, updateStory } from "../../../services/story/story.js";
import { showToast } from "../../hooks/index.js";
import { closeOverlay, fold } from "./shell-selection.js";
import type { ShellEnv, ShellView } from "./shell-state.js";
import { closeDeletedStory } from "./story-pane.js";

/** A Story of the multi-selection and its new Stage. */
interface MarkedMove {
  readonly story: Story;
  readonly to: string;
}

/** Moves the Stage `key` to the 1-based `position` in board order. The selection stays on the Stage. */
export function moveStage(env: ShellEnv, key: string, position: number): void {
  const { stages } = env.view;
  const from = stages.findIndex((s) => s.key === key) + 1;
  const to = Math.max(1, Math.min(stages.length, position));

  if (from === 0 || from === to) {
    return;
  }

  updateStage({ key, position: to }, env.ctx).then(env.reload, (err: unknown) => env.toast.error(err));
}

/**
 * Moves the Story `story` to the Stage `key`. A Story in a Stage is in `updatedAt` order, so the moved Story goes to
 * the top of the Stage. The selection stays on the Story.
 */
function placeStory(env: ShellEnv, story: Story, key: string): void {
  if (key === story.stage) {
    return;
  }

  updateStory({ id: story.id, stage: key }, env.ctx).then(
    (moved) => storyPlaced(env, moved),
    (err: unknown) => env.toast.error(err),
  );
}

function storyPlaced(env: ShellEnv, moved: Story): void {
  // A Stage filter follows the Story to its new Stage.
  if (env.stageKey !== null) {
    env.setStageKey(moved.stage);
  }

  fold(env, moved.stage, false);
  env.setSelectedId(moved.id);
  env.putOnBoard(moved);
}

/** Moves the Story `story` `delta` Stages along the board order, to the top of that Stage. */
export function moveStoryStage(env: ShellEnv, story: Story, delta: -1 | 1): void {
  const { stages } = env.view;
  const to = stages[stages.findIndex((s) => s.key === story.stage) + delta];

  if (!to) {
    return;
  }

  placeStory(env, story, to.key);
}

/** Moves the Story `story` to the top of the first Stage of the board, the Backlog. */
export function moveStoryToBacklog(env: ShellEnv, story: Story): void {
  const [backlog] = env.view.stages;

  if (!backlog) {
    return;
  }

  placeStory(env, story, backlog.key);
}

/** The selected Stories in list order: by the order of their Stages, then by their positions. */
function markedInOrder(view: ShellView): readonly Story[] {
  const order = new Map(view.stages.map((stage, index) => [stage.key, index]));

  return view.stories
    .filter((story) => view.marked.has(story.id))
    .toSorted((a, b) => (order.get(a.stage) ?? 0) - (order.get(b.stage) ?? 0) || a.position - b.position);
}

/** The Stage `delta` Stages from the Stage of the Story `story`, or `undefined` past the first or the last Stage. */
function nextStage(stages: readonly Stage[], story: Story, delta: -1 | 1): Stage | undefined {
  const at = stages.findIndex((s) => s.key === story.stage);

  return at < 0 ? undefined : stages[at + delta];
}

/**
 * The moves of the selected Stories, in the order of the writes. Each Story moves one Stage from its own Stage. A
 * Story in the first or the last Stage that cannot move is not in the list. A Stage shows the most recent Story at the
 * top, so the writes go in reverse list order. Thus the Stories keep their relative order in the target Stage.
 */
function markedMoves(view: ShellView, delta: -1 | 1): readonly MarkedMove[] {
  return markedInOrder(view)
    .flatMap((story) => {
      const to = nextStage(view.stages, story, delta);

      return to ? [{ story, to: to.key }] : [];
    })
    .toReversed();
}

/** Writes one move. The calls run one at a time, so that each Story gets a later `updatedAt` than the one before. */
function writeMove(env: ShellEnv, move: MarkedMove): Promise<Story> {
  return updateStory({ id: move.story.id, stage: move.to }, env.ctx);
}

/** The selected Stories moved. A Stage filter follows the first Story, and each target Stage section expands. */
function markedPlaced(env: ShellEnv, moved: readonly Story[]): void {
  const first = moved.at(-1);

  if (first && env.stageKey !== null) {
    env.setStageKey(first.stage);
  }

  // The order of the writes: each Story goes to the top of its Stage, so the Stories keep their relative order.
  for (const story of moved) {
    fold(env, story.stage, false);
    env.putOnBoard(story);
  }
}

/** A move failed. The Stories that moved before the failure stay moved. */
function markedFailed(env: ShellEnv, err: unknown): void {
  env.toast.error(err);
  env.reload();
}

/** Moves each selected Story one Stage along the board order, to the top of that Stage. The Stories stay selected. */
export function moveMarkedStories(env: ShellEnv, delta: -1 | 1): void {
  const moves = markedMoves(env.view, delta);

  if (moves.length === 0) {
    return;
  }

  mapInOrder(moves, (move) => writeMove(env, move)).then(
    (moved) => markedPlaced(env, moved),
    (err: unknown) => markedFailed(env, err),
  );
}

/**
 * The Stage of the Story `story` that was dropped in the gap before the row at `gap`: the Stage of the row above the
 * gap, or the selected Stage when no row is above the gap.
 */
function dropStage(view: ShellView, story: Story, gap: number): string {
  const above = view.rows
    .slice(0, gap)
    .filter((r) => r.id !== story.id)
    .at(-1);

  if (!above) {
    return view.stage?.key ?? story.stage;
  }

  return above.kind === "stage" ? above.key : above.story.stage;
}

/** The Story `id` was dropped in the gap before the row at `gap`. A drop in its own Stage does nothing. */
export function dropStory(env: ShellEnv, id: string, gap: number): void {
  const story = env.view.stories.find((s) => s.id === id);

  env.setPane("stories");

  if (!story) {
    return;
  }

  placeStory(env, story, dropStage(env.view, story, gap));
}

/**
 * After the Story `id` is deleted, selects the row below it (or above it, at the end of the list). The Story
 * sidebar closes when it edits that Story.
 */
export function afterDelete(env: ShellEnv, id: string): void {
  const { rows } = env.view;
  const at = rows.findIndex((r) => r.id === id);
  const next = rows[at + 1] ?? rows[at - 1];

  env.setSelectedId(at >= 0 && next ? next.id : null);
  closeOverlay(env);
  closeDeletedStory(env, id);
  env.takeFromBoard(id);
}

/** Deletes the Story `story` after the confirmation. */
export function removeStory(env: ShellEnv, story: Story): void {
  deleteStory({ id: story.id }, env.ctx).then(
    ({ id }) => storyRemoved(env, id),
    (err: unknown) => removeFailed(env, err),
  );
}

function storyRemoved(env: ShellEnv, id: string): void {
  showToast(env.toast, "info", `Deleted ${id}`);
  afterDelete(env, id);
}

function removeFailed(env: ShellEnv, err: unknown): void {
  env.toast.error(err);
  closeOverlay(env);
}
