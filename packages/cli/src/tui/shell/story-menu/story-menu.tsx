import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { ContextMenu } from "../../components/index.js";
import { useForceAssignment } from "../../screens/stories/index.js";
import { menuStory, type StoryMenuAction, type StoryMenuItem, storyMenuItems } from "./story-menu-items.js";

export interface StoryMenuProps {
  readonly ctx: ServiceContext;
  /** The Story of the right click, as it was when the menu opened. */
  readonly story: Story;
  /** The cell of the right click on the screen. */
  readonly x: number;
  readonly y: number;
  readonly stages: readonly Stage[];
  /** The Stories of the board now, to make sure that the Story still exists before an item runs. */
  readonly stories: readonly Story[];
  onClose(): void;
  /** Runs an item other than `Force assignment` on the Story. */
  onAction(action: StoryMenuAction, story: Story): void;
}

interface StoryMenuEnv {
  readonly items: readonly StoryMenuItem[];
  readonly storyId: string;
  readonly stories: readonly Story[];
  readonly force: () => void;
  readonly onAction: (action: StoryMenuAction, story: Story) => void;
}

/** Runs the item at `index` on the Story, only when the Story still exists. */
function runStoryItem(env: StoryMenuEnv, index: number): void {
  const item = env.items[index];
  const story = menuStory(env.stories, env.storyId);

  if (!item || !story) {
    return;
  }

  if (item.action === "force") {
    env.force();

    return;
  }

  env.onAction(item.action, story);
}

/**
 * The context menu of one Story of the Story list: Open, the moves to the next Stage, the previous Stage and the
 * Backlog, Delete, and Force assignment. `Force assignment` sends the same request as the Button of the Story view.
 */
export function StoryMenu({ ctx, story, x, y, stages, stories, onClose, onAction }: StoryMenuProps) {
  const force = useForceAssignment(ctx, story.id);

  const items = storyMenuItems(stages, story.stage, force.shown);
  const env: StoryMenuEnv = { items, storyId: story.id, stories, force: force.send, onAction };

  return <ContextMenu items={items} x={x} y={y} onClose={onClose} onRun={(index) => runStoryItem(env, index)} />;
}
