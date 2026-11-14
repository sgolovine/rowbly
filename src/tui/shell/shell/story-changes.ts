import { updateStage } from "../../../services/stage/stage.js";
import { deleteStory, type Story, updateStory } from "../../../services/story/story.js";
import { showToast } from "../../hooks/index.js";
import { closeOverlay, fold } from "./shell-selection.js";
import type { ShellEnv, ShellView } from "./shell-state.js";
import { closeDeletedStory } from "./story-pane.js";

/** A Stage and a 1-based position in it. */
interface Place {
  readonly key: string;
  readonly position: number;
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

/** Puts the Story `story` at the 1-based `position` in the Stage `key`. The selection stays on the Story. */
function placeStory(env: ShellEnv, story: Story, key: string, position: number): void {
  if (key === story.stage && position === story.position) {
    return;
  }

  updateStory({ id: story.id, stage: key, position }, env.ctx).then(
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
  env.reload();
}

/**
 * Moves the Story `story` `delta` Stages along the board order: to the top of the next Stage, or to the
 * bottom of the previous Stage.
 */
export function moveStoryStage(env: ShellEnv, story: Story, delta: -1 | 1): void {
  const { stages, stories } = env.view;
  const to = stages[stages.findIndex((s) => s.key === story.stage) + delta];

  if (!to) {
    return;
  }

  placeStory(env, story, to.key, delta > 0 ? 1 : stories.filter((s) => s.stage === to.key).length + 1);
}

/** Moves the Story `story` one place up or down in its Stage, and past the end into the next Stage. */
export function shiftStory(env: ShellEnv, story: Story, delta: -1 | 1): void {
  const count = env.view.stories.filter((s) => s.stage === story.stage).length;
  const position = story.position + delta;

  if (position >= 1 && position <= count) {
    placeStory(env, story, story.stage, position);

    return;
  }

  moveStoryStage(env, story, delta);
}

/**
 * The place of the Story `story` that was dropped in the gap before the row at `gap`. It goes below the
 * Story above the gap, or to the top of the Stage whose heading is above the gap.
 */
function dropPlace(view: ShellView, story: Story, gap: number): Place {
  const above = view.rows
    .slice(0, gap)
    .filter((r) => r.id !== story.id)
    .at(-1);

  if (!above) {
    return { key: view.stage?.key ?? story.stage, position: 1 };
  }

  if (above.kind === "stage") {
    return { key: above.key, position: 1 };
  }

  const peers = view.stories.filter((s) => s.stage === above.story.stage && s.id !== story.id);

  return { key: above.story.stage, position: peers.indexOf(above.story) + 2 };
}

/** The Story `id` was dropped in the gap before the row at `gap`. */
export function dropStory(env: ShellEnv, id: string, gap: number): void {
  const story = env.view.stories.find((s) => s.id === id);

  env.setPane("stories");

  if (!story) {
    return;
  }

  const place = dropPlace(env.view, story, gap);

  placeStory(env, story, place.key, place.position);
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
  env.reload();
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
