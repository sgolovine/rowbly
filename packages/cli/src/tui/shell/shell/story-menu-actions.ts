import type { Story } from "../../../services/story/story.js";
import type { StoryMenuAction } from "../story-menu/index.js";
import type { ShellEnv } from "./shell-state.js";
import { moveStoryStage, moveStoryToBacklog } from "./story-changes.js";
import { editStory } from "./story-pane.js";

/** The operations of the Story menu. `Force assignment` runs in the menu, with the hook of the Story view. */
const STORY_ACTIONS: Readonly<Record<Exclude<StoryMenuAction, "force">, (env: ShellEnv, story: Story) => void>> = {
  open: editStory,
  next: (env, story) => moveStoryStage(env, story, 1),
  previous: (env, story) => moveStoryStage(env, story, -1),
  backlog: moveStoryToBacklog,
  delete: (env, story) => env.setOverlay({ kind: "deleteStory", story }),
};

/**
 * A right click on the row at `index` of the Story list: the cursor goes to the row, and the menu of its Story opens at
 * the cell `x`, `y`. The multi-selection stays. A Stage heading has no menu, and no menu opens over an overlay.
 */
export function openStoryMenu(env: ShellEnv, index: number, x: number, y: number): void {
  const row = env.view.rows[index];

  if (!env.view.idle || row?.kind !== "story") {
    return;
  }

  env.setPane("stories");
  env.setSelectedId(row.id);
  env.setOverlay({ kind: "storyMenu", story: row.story, x, y });
}

/** Runs the item `action` of the Story menu on the Story `story`, with the same operation as its key. */
export function runStoryAction(env: ShellEnv, action: StoryMenuAction, story: Story): void {
  if (action !== "force") {
    STORY_ACTIONS[action](env, story);
  }
}
