import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import type { ContextMenuItem } from "../../components/index.js";

/** What an item of the Story menu does. */
export type StoryMenuAction = "open" | "next" | "previous" | "backlog" | "delete" | "force";

/** One item of the Story menu. */
export interface StoryMenuItem extends ContextMenuItem {
  readonly action: StoryMenuAction;
}

/**
 * The items of the context menu of the Story in the Stage `stageKey`, in menu order. A move past the first or the last
 * Stage does not apply, and `Force assignment` applies only when `forceable` (see `canForceAssignment`).
 */
export function storyMenuItems(
  stages: readonly Stage[],
  stageKey: string,
  forceable: boolean,
): readonly StoryMenuItem[] {
  const at = stages.findIndex((stage) => stage.key === stageKey);
  const first = at <= 0;
  const last = at < 0 || at >= stages.length - 1;

  return [
    { action: "open", label: "Open", keyName: "enter" },
    { action: "next", label: "Move to next Stage", keyName: "shift+↓", disabled: last },
    { action: "previous", label: "Move to previous Stage", keyName: "shift+↑", disabled: first },
    { action: "backlog", label: "Move to Backlog", disabled: first },
    { action: "delete", label: "Delete", keyName: "d" },
    { action: "force", label: "Force assignment", keyName: "ctrl+r", disabled: !forceable },
  ];
}

/** The Story `id` of `stories`, or `undefined` when it does not exist any more. */
export function menuStory(stories: readonly Story[], id: string): Story | undefined {
  return stories.find((story) => story.id === id);
}
