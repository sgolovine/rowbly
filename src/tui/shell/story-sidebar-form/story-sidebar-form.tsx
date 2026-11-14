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
  /** `esc` in the form or the Thread. */
  onBack(): void;
  /** `tab` or `shift+tab` in a Thread. A Story form keeps `tab` for its fields. */
  onTab(step: 1 | -1): void;
  onSaved(story: Story): void;
  onDeleted(id: string): void;
  /** The keys of the tab of the edit form, or the keys of the Thread. */
  onHints(hints: readonly KeyHint[]): void;
}

/**
 * The content of the Story sidebar: the form of a new Story, the edit form of a Story with its tabs, or a Thread
 * of the Factory view with its conversation.
 */
export function StorySidebarForm({ pane, board, ctx, cursorStage, ...on }: StorySidebarFormProps) {
  if (pane.kind === "thread") {
    return (
      <ThreadPane
        ctx={ctx}
        root={board.project.root}
        thread={pane.thread}
        stages={stageNames(board)}
        onBack={on.onBack}
        onTab={on.onTab}
        onHints={on.onHints}
      />
    );
  }

  if (pane.kind === "new") {
    return (
      <NewStoryForm
        ctx={ctx}
        stages={board.stages}
        customFields={board.project.customFields}
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
      stages={board.stages}
      customFields={board.project.customFields}
      specs={board.project.features?.specs === true}
      onSaved={on.onSaved}
      onDeleted={on.onDeleted}
      onBack={on.onBack}
      onHints={on.onHints}
    />
  );
}
