import { compactThreads, projectTags, storyTimeZone } from "../../../services/config/config.js";
import type { Story } from "../../../services/story/story.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import type { KeyHint } from "../../keymap.js";
import { EditStoryForm, NewStoryForm } from "../../screens/stories/index.js";
import { ThreadPane } from "../../screens/threads/index.js";
import type { OverlayBoard, SidePane } from "../overlay.js";
import { stageNames } from "../story-sidebar/story-sidebar-view.js";

export interface StorySidebarFormProps {
  readonly pane: SidePane;
  readonly board: OverlayBoard;
  readonly ctx: ServiceContext;
  /** The Stage that a new Story starts in. */
  readonly cursorStage: string | undefined;
  /** The Story sidebar takes the mouse. */
  readonly clickable: boolean;
  /** `esc` in the form or the Thread. */
  onBack(): void;
  /** `tab` or `shift+tab` in a Thread. A Story form keeps `tab` for its fields. */
  onTab(step: 1 | -1): void;
  /** A wheel notch over the conversation of a Thread while the sidebar does not have the focus. */
  onFocus(): void;
  onSaved(story: Story): void;
  onDeleted(id: string): void;
  /**
   * `o` or the `Open Story` Button of a Thread opens the Story of the Thread. A click on an item of the `Depends on`
   * or `Blocks` list of the edit form opens that Story.
   */
  onOpenStory(story: Story): void;
  /** The keys of the tab of the edit form, or the keys of the Thread. */
  onHints(hints: readonly KeyHint[]): void;
}

/** Opens the Story `id` of a Thread, or `undefined` when the board does not have that Story. */
function openStoryHandler(
  stories: readonly Story[],
  id: string | undefined,
  onOpenStory: (story: Story) => void,
): (() => void) | undefined {
  const story = id === undefined ? undefined : stories.find((s) => s.id === id);

  return story ? () => onOpenStory(story) : undefined;
}

/**
 * The content of the Story sidebar: the form of a new Story, the edit form of a Story with its tabs, or a Thread
 * of the Factory view with its conversation.
 */
export function StorySidebarForm({ pane, board, ctx, cursorStage, clickable, ...on }: StorySidebarFormProps) {
  if (pane.kind === "thread") {
    return (
      <ThreadPane
        ctx={ctx}
        root={board.project.root}
        thread={pane.thread}
        stages={stageNames(board)}
        onBack={on.onBack}
        onTab={on.onTab}
        onFocus={on.onFocus}
        clickable={clickable}
        onOpenStory={openStoryHandler(board.stories, pane.thread.storyId, on.onOpenStory)}
        onHints={on.onHints}
      />
    );
  }

  if (pane.kind === "new") {
    return (
      <NewStoryForm
        ctx={ctx}
        stories={board.stories}
        stages={board.stages}
        customFields={board.project.customFields}
        tags={projectTags(board.project)}
        stage={cursorStage}
        onCreated={on.onSaved}
        onBack={on.onBack}
      />
    );
  }

  return (
    <EditStoryForm
      ctx={ctx}
      story={pane.story}
      stories={board.stories}
      stages={board.stages}
      customFields={board.project.customFields}
      tags={projectTags(board.project)}
      specs={board.project.features?.specs === true}
      compactThreads={compactThreads(board.project)}
      timeZone={storyTimeZone(board.project)}
      onSaved={on.onSaved}
      onDeleted={on.onDeleted}
      onBack={on.onBack}
      onHints={on.onHints}
      onOpenStory={on.onOpenStory}
      clickable={clickable}
    />
  );
}
